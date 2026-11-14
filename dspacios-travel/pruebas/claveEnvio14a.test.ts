// #14-A — identidad de la intención de envío: UNA por contenido en el almacén del navegador, coordinada entre pestañas con un candado (Web Locks), FIJADA por cada formulario abierto;
// «Es otra compra» crea otra identidad solo para quien la pide (las pestañas abiertas antes no se vuelven compras nuevas); sin época ni caducidad por hora; sin deduplicación entre navegadores.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { claveParaEnvio, coordinacionDisponible, crearContextoEnvio, enviarConClave, huellaDeEntrada, nuevaCompra, RETENCION_MS, CLAVE_ALMACEN, type Candado } from "../lib/cotizacion/claveEnvio.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const memoria = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
/** Un candado en exclusión mutua compartido entre pestañas del mismo navegador (lo que hace `navigator.locks`). */
const nuevoCandado = (): Candado => { let cola: Promise<unknown> = Promise.resolve(); return <T,>(fn: () => T) => { const p = cola.then(fn); cola = p.catch(() => undefined); return p; }; };
let n = 0; const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const entrada = (extra: object = {}) => ({ items: [{ hotelId: 1, pax: 2 }], cliente: { nombres: "Ana", numeroDoc: "123" }, ...extra });
/** Un NAVEGADOR: su almacén, su candado y un reloj. `pestana(t)` abre un formulario en el instante t. */
function navegador() {
  const almacen = memoria(); const candado = nuevoCandado(); const reloj = { t: 0 };
  return { almacen, reloj, pestana: (t: number) => { reloj.t = t; return crearContextoEnvio(almacen, uuid, { candado, ahora: () => reloj.t }); } };
}
const usar = (ctx: ReturnType<typeof crearContextoEnvio>, t: number, e: unknown = entrada(), reloj?: { t: number }) => { if (reloj) reloj.t = t; return claveParaEnvio(e, ctx); };

describe("identidad de la intención de envío", () => {
  test("DOS pestañas del mismo navegador que arrancan con el almacén VACÍO y envían a la vez obtienen la MISMA identidad (UUID válido), con el candado y sin él", async () => {
    const b = navegador();
    const A = b.pestana(0), B = b.pestana(0);
    const [ka, kb] = await Promise.all([claveParaEnvio(entrada(), A), claveParaEnvio(entrada(), B)]);
    assert.match(ka, UUID);
    assert.equal(ka, kb);
    // Sin candado (sin Web Locks): escribir-y-releer converge igual para pestañas que se ejecutan una tras otra.
    const almacen = memoria();
    const sinCandado: Candado = (fn) => Promise.resolve().then(fn);
    const C = crearContextoEnvio(almacen, uuid, { candado: sinCandado, ahora: () => 5 }), D = crearContextoEnvio(almacen, uuid, { candado: sinCandado, ahora: () => 5 });
    const [kc, kd] = await Promise.all([claveParaEnvio(entrada(), C), claveParaEnvio(entrada(), D)]);
    assert.equal(kc, kd);
  });

  test("NO hay deduplicación entre navegadores: dos navegadores (almacenes distintos) tienen identidades distintas para el mismo contenido", async () => {
    const k1 = await claveParaEnvio(entrada(), navegador().pestana(0));
    const k2 = await claveParaEnvio(entrada(), navegador().pestana(0));
    assert.notEqual(k1, k2);
  });

  test("una pestaña ANTIGUA que envía después del éxito de la otra usa la misma identidad (el servidor la reconoce como cumplida), y una abierta después también", async () => {
    const b = navegador();
    const vieja = b.pestana(0), nueva = b.pestana(10);
    const k1 = await usar(nueva, 20, entrada(), b.reloj);
    assert.equal(await usar(vieja, 30, entrada(), b.reloj), k1);
    assert.equal(await usar(b.pestana(40), 50, entrada(), b.reloj), k1);
  });

  test("REPRODUCCIÓN A — «Es otra compra» crea OTRA intención solo para el formulario que la pide: la pestaña antigua (con o sin identidad fijada) NO se vuelve una compra nueva; las abiertas después usan la nueva", async () => {
    const b = navegador();
    const pinned = b.pestana(0), sinFijar = b.pestana(0), quienPide = b.pestana(0);
    const original = await usar(pinned, 10, entrada(), b.reloj); // esta pestaña ya fijó la original
    assert.equal(await usar(quienPide, 11, entrada(), b.reloj), original);
    b.reloj.t = 100;
    const nueva = await nuevaCompra(entrada(), quienPide);
    assert.notEqual(nueva, original);
    assert.equal(await usar(quienPide, 101, entrada(), b.reloj), nueva, "quien pide la compra nueva la usa en su siguiente envío");
    assert.equal(await usar(pinned, 102, entrada(), b.reloj), original, "la pestaña que ya había fijado la identidad la conserva");
    assert.equal(await usar(sinFijar, 103, entrada(), b.reloj), original, "la que aún no había fijado nada pero se abrió ANTES de la compra nueva también: sigue siendo la intención original");
    assert.equal(await usar(b.pestana(200), 201, entrada(), b.reloj), nueva, "una pestaña abierta DESPUÉS sí usa la nueva");
    // Dos compras nuevas: cada pestaña conserva la identidad que regía cuando se abrió.
    const intermedia = b.pestana(300);
    b.reloj.t = 400;
    const tercera = await nuevaCompra(entrada(), b.pestana(350));
    assert.equal(new Set([original, nueva, tercera]).size, 3);
    assert.equal(await usar(intermedia, 401, entrada(), b.reloj), nueva, "abierta entre la primera y la segunda compra nueva: la segunda identidad");
  });

  test("REPRODUCCIÓN B — el cambio de hora no rompe la protección: dos pestañas que envían a ambos lados de la hora (59:59 y 60:01), una pestaña olvidada 61 minutos y otra 23 horas después siguen siendo la misma intención", async () => {
    const H = 60 * 60_000;
    const b = navegador();
    const A = b.pestana(H - 5000), B = b.pestana(H - 4000);
    const kA = await usar(A, H - 1000, entrada(), b.reloj); // 59:59
    assert.equal(await usar(B, H + 1000, entrada(), b.reloj), kA, "60:01: misma identidad (no hay época)");
    const olvidada = b.pestana(H - 3000);
    assert.equal(await usar(olvidada, H + 61 * 60_000, entrada(), b.reloj), kA, "61 minutos después");
    assert.equal(await usar(b.pestana(H), 23 * H, entrada(), b.reloj), kA, "23 horas después sigue vigente (cada uso la renueva)");
    // Sin uso durante más de la retención el contenido se olvida: compra nueva natural.
    const lejos = 23 * H + RETENCION_MS + 1;
    const nueva = await usar(b.pestana(lejos), lejos + 1, entrada(), b.reloj);
    assert.notEqual(nueva, kA);
    assert.equal(Object.keys(JSON.parse(b.almacen.m.get(CLAVE_ALMACEN)!)).length, 1, "el almacén se limpia");
  });

  test("otro contenido (titular, recobro, aliado, hotel) = otra identidad; lo que no define la intención (vistos, la propia clave) no la cambia", async () => {
    const b = navegador(); const P = b.pestana(0);
    const a = await claveParaEnvio(entrada(), P);
    const luis = await claveParaEnvio(entrada({ cliente: { nombres: "Luis", numeroDoc: "456" } }), P);
    const recobro = await claveParaEnvio(entrada({ recobro: { total: 100000 } }), P);
    const hotel = await claveParaEnvio({ ...entrada(), items: [{ hotelId: 2, pax: 2 }] }, P);
    assert.equal(new Set([a, luis, recobro, hotel]).size, 4);
    assert.notEqual(huellaDeEntrada(entrada({ recobro: { total: 100000 } })), huellaDeEntrada(entrada({ recobro: { total: 100001 } })));
    assert.equal(await claveParaEnvio(entrada({ vistos: { comision: 1 }, claveEnvio: "x" }), P), a);
  });

  test("enviarConClave: si el servidor responde «clave en uso» (otro usuario u otro contenido) pasa a una identidad nueva y reintenta; se detiene a los 3 envíos", async () => {
    const b = navegador(); const P = b.pestana(0);
    const vistas: string[] = [];
    const r = await enviarConClave(entrada(), P, async (k) => { vistas.push(k); return vistas.length < 3 ? { ok: false, tipo: "clave_en_uso" } : { ok: true }; }, (x) => (x as { tipo?: string }).tipo === "clave_en_uso");
    assert.deepEqual(r, { ok: true });
    assert.equal(new Set(vistas).size, 3);
    const siempre: string[] = [];
    const r2 = await enviarConClave(entrada({ x: 1 }), P, async (k) => { siempre.push(k); return { ok: false, tipo: "clave_en_uso" }; }, () => true);
    assert.equal(r2.ok, false);
    assert.equal(siempre.length, 3, "no reintenta sin fin");
  });

  test("sin almacén o con almacén ilegible no falla: la identidad se conserva en el formulario (doble clic y reintentos), pero no se comparte", async () => {
    const sin = crearContextoEnvio(null, uuid, { candado: nuevoCandado() });
    const k = await claveParaEnvio(entrada(), sin);
    assert.match(k, UUID);
    assert.equal(await claveParaEnvio(entrada(), sin), k, "el reintento del MISMO formulario lleva la misma identidad");
    const roto = { getItem: () => "{no es json", setItem: () => { throw new Error("lleno"); }, removeItem: () => { throw new Error("x"); } };
    const conRoto = crearContextoEnvio(roto, uuid, { candado: nuevoCandado() });
    assert.match(await claveParaEnvio(entrada(), conRoto), UUID);
    await assert.doesNotReject(() => nuevaCompra(entrada(), conRoto));
  });

  test("coordinación entre pestañas: solo hay garantía con un almacén que FUNCIONA y Web Locks; si falta cualquiera de los dos se declara no disponible (la interfaz avisa, no promete)", () => {
    assert.equal(coordinacionDisponible(memoria(), true), true);
    assert.equal(coordinacionDisponible(memoria(), false), false, "sin navigator.locks");
    assert.equal(coordinacionDisponible(null, true), false, "sin localStorage");
    const lleno = { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); }, removeItem: () => {} };
    assert.equal(coordinacionDisponible(lleno, true), false, "localStorage que falla al escribir");
    const mudo = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    assert.equal(coordinacionDisponible(mudo, true), false, "localStorage que no devuelve lo escrito");
  });
});
