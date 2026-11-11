// #43 — validación de fechas de vigencias de hotel EN EL SERVIDOR. Ejecuta las Server Actions REALES
// (crearTemporada, actualizarTemporada, cargarTemporadasMasivo, copiarTemporadasDesdeHotel) con un cliente de Supabase
// simulado en memoria: no toca ninguna base, no regenera ni publica nada. Las llamadas son DIRECTAS a la acción, es decir,
// lo que haría quien salte el formulario.
//
// Decisión del dueño (hotel 53, vigencia ALTA id 140): `0206-12-24` es un error de captura, debía ser 2026-12-24.
// Reglas: al crear o al cambiar fechas se rechazan años anteriores al año vigente en Bogotá, fechas inexistentes y rangos
// con fin anterior al inicio (viaje, compra y blackouts según corresponda). Nada se corrige automáticamente. Lo guardado
// que no cambia se puede seguir editando.
import { test, describe, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";

type Llamada = { tabla: string; op: string; datos: unknown; filtros: [string, unknown][] };
type Programa = Record<string, unknown | ((st: Estado, unica: boolean) => unknown)>;
type Estado = { tabla: string; op: string; datos: unknown; filtros: [string, unknown][] };
const estado = { llamadas: [] as Llamada[], programa: {} as Programa, revalida: [] as string[], regen: [] as unknown[][] };
(globalThis as unknown as { __v43: typeof estado }).__v43 = estado;

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const MINIMOS: Record<string, string> = {
  "server-only": "export {}",
  "next/cache": "export function revalidatePath(p) { globalThis.__v43.revalida.push(p) } export function revalidateTag() {}",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (MINIMOS[specifier] != null) return { url: datos(MINIMOS[specifier]), shortCircuit: true };
    // La regeneración del tarifario publicado se sustituye: aquí no se publica nada.
    if (specifier === "../../paquetes/actions" && (context.parentURL ?? "").endsWith("/producto/hoteles/actions.ts")) {
      return { url: datos("export async function regenerarTarifariosDeHotel(...a) { globalThis.__v43.regen.push(a) }"), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

function constructor_(tabla: string) {
  const st: Estado = { tabla, op: "select", datos: undefined, filtros: [] };
  const resolver = (unica: boolean) => {
    estado.llamadas.push({ tabla: st.tabla, op: st.op, datos: st.datos, filtros: [...st.filtros] });
    const p = estado.programa[`${st.tabla}.${st.op}`];
    if (typeof p === "function") return (p as (e: Estado, u: boolean) => unknown)(st, unica);
    if (p !== undefined) return p;
    return st.op === "select" ? { data: unica ? null : [], error: null } : { data: null, error: null };
  };
  const b: Record<string, unknown> = {
    select() { return b; },
    insert(d: unknown) { st.op = "insert"; st.datos = d; return b; },
    update(d: unknown) { st.op = "update"; st.datos = d; return b; },
    delete() { st.op = "delete"; return b; },
    eq(c: string, v: unknown) { st.filtros.push([c, v]); return b; },
    maybeSingle() { return Promise.resolve(resolver(true)); },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return Promise.resolve(resolver(false)).then(res, rej); },
  };
  return b;
}
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({ from: (t: string) => constructor_(t) }) } });

const acc = await import("../app/(dashboard)/dashboard/producto/hoteles/actions.ts");

// "Hoy" fijo en Bogotá: 10-nov-2026 a mediodía.
const AHORA = new Date("2026-11-10T17:00:00Z");
beforeEach(() => {
  estado.llamadas.length = 0; estado.programa = {}; estado.revalida.length = 0; estado.regen.length = 0;
  mock.timers.enable({ apis: ["Date"], now: AHORA });
});
afterEach(() => { mock.timers.reset(); });

const base = (over: Record<string, unknown> = {}) => ({
  hotelId: 53, nombre: "ALTA", inicio: "2026-12-24", fin: "2027-01-03", prioridad: 2, minNoches: 1, tipo: "tarifa",
  compraInicio: "", compraFin: "", rangos: [], blackouts: [], ...over,
});
const escrituras = () => estado.llamadas.filter((l) => l.op === "insert" || l.op === "update" || l.op === "delete");
function sinEscrituraNiPublicacion() {
  assert.deepEqual(escrituras(), [], "no se debe escribir nada en la base");
  assert.equal(estado.regen.length, 0, "no se debe regenerar el tarifario publicado");
  assert.equal(estado.revalida.length, 0, "no se debe revalidar ni publicar nada");
}
const rechazada = (r: { ok: boolean; error?: string }, patron: RegExp) => {
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", patron);
};

describe("crearTemporada — llamada directa al servidor", () => {
  test("REPRODUCCIÓN hotel 53: 0206-12-24 → 2027-01-03 es RECHAZADA (antes del cambio se guardaba tal cual)", async () => {
    const r = await acc.crearTemporada(base({ inicio: "0206-12-24" }));
    rechazada(r, /0206-12-24/);
    sinEscrituraNiPublicacion();
  });
  test("no se corrige solo: el error nombra el valor y no se escribe ninguna versión «corregida»", async () => {
    const r = await acc.crearTemporada(base({ inicio: "0206-12-24" }));
    assert.equal(r.ok, false);
    assert.doesNotMatch(r.ok ? "" : r.error, /2026-12-24/, "el mensaje no propone ni aplica un año");
    sinEscrituraNiPublicacion();
  });
  test("62026-06-29 (año de cinco dígitos, hotel 9) es rechazada", async () => {
    const r = await acc.crearTemporada(base({ inicio: "2026-11-20", fin: "62026-06-29" }));
    rechazada(r, /62026-06-29/);
    sinEscrituraNiPublicacion();
  });
  test("fechas inexistentes: 2027-02-30, 2027-04-31, 2027-13-01 y 2027-02-29 son rechazadas; 2028-02-29 (bisiesto) es válida", async () => {
    for (const mala of ["2027-02-30", "2027-04-31", "2027-13-01", "2027-02-29"]) {
      const r = await acc.crearTemporada(base({ inicio: "2027-01-10", fin: mala }));
      rechazada(r, new RegExp(mala));
    }
    sinEscrituraNiPublicacion();
    const ok = await acc.crearTemporada(base({ inicio: "2028-02-01", fin: "2028-02-29" }));
    assert.equal(ok.ok, true);
  });
  test("rango con fin anterior al inicio es rechazado", async () => {
    const r = await acc.crearTemporada(base({ inicio: "2027-03-10", fin: "2027-03-01" }));
    rechazada(r, /fin|final/i);
    sinEscrituraNiPublicacion();
  });
  test("año anterior al vigente (2025 en 2026) es rechazado; el año vigente y los siguientes se aceptan", async () => {
    rechazada(await acc.crearTemporada(base({ inicio: "2025-12-20", fin: "2026-01-05" })), /2025-12-20/);
    sinEscrituraNiPublicacion();
    assert.equal((await acc.crearTemporada(base({ inicio: "2026-01-01", fin: "2026-02-01" }))).ok, true);
    assert.equal((await acc.crearTemporada(base({ inicio: "2027-06-01", fin: "2027-06-30" }))).ok, true);
  });
  test("rangos adicionales y blackouts también se validan", async () => {
    rechazada(await acc.crearTemporada(base({ rangos: [{ fecha_inicio: "0206-03-01", fecha_fin: "2027-03-05" }] })), /0206-03-01/);
    rechazada(await acc.crearTemporada(base({ blackouts: [{ fecha_inicio: "2027-01-01", fecha_fin: "2027-01-02" }, { fecha_inicio: "2025-12-30", fecha_fin: "2027-01-01" }] })), /2025-12-30/);
    sinEscrituraNiPublicacion();
  });
  test("compra: fecha inexistente y año de fin anterior al vigente son rechazados; empezar en un año anterior es válido", async () => {
    rechazada(await acc.crearTemporada(base({ compraInicio: "2026-02-30", compraFin: "2026-12-31" })), /2026-02-30/);
    rechazada(await acc.crearTemporada(base({ compraInicio: "2025-01-01", compraFin: "2025-12-31" })), /2025-12-31/);
    rechazada(await acc.crearTemporada(base({ compraInicio: "0206-10-01", compraFin: "2026-12-31" })), /0206-10-01/);
    sinEscrituraNiPublicacion();
    assert.equal((await acc.crearTemporada(base({ compraInicio: "2025-10-01", compraFin: "2027-04-30" }))).ok, true);
  });
  test("una vigencia válida se guarda una sola vez, con las fechas tal cual y una sola regeneración", async () => {
    const r = await acc.crearTemporada(base());
    assert.equal(r.ok, true);
    const ins = escrituras();
    assert.equal(ins.length, 1);
    assert.equal((ins[0].datos as { fecha_inicio: string }).fecha_inicio, "2026-12-24");
    assert.equal(estado.regen.length, 1);
  });
});

describe("límite de cambio de año (reloj de Bogotá, UTC−5)", () => {
  const intentar = () => acc.crearTemporada(base({ inicio: "2026-12-30", fin: "2027-01-03" }));
  test("31-dic-2026 23:59:59 en Bogotá (= 1-ene-2027 04:59:59 UTC) todavía es 2026: se acepta un rango que empieza en 2026", async () => {
    mock.timers.reset(); mock.timers.enable({ apis: ["Date"], now: new Date("2027-01-01T04:59:59Z") });
    assert.equal((await intentar()).ok, true);
  });
  test("1-ene-2027 00:00:00 en Bogotá (= 05:00:00 UTC) ya es 2027: el mismo rango se rechaza", async () => {
    mock.timers.reset(); mock.timers.enable({ apis: ["Date"], now: new Date("2027-01-01T05:00:00Z") });
    rechazada(await intentar(), /2026-12-30/);
    sinEscrituraNiPublicacion();
  });
  test("a las 23:30 del 31-dic en Bogotá el servidor (UTC) ya está en 2027 pero el año vigente sigue siendo 2026", async () => {
    mock.timers.reset(); mock.timers.enable({ apis: ["Date"], now: new Date("2027-01-01T04:30:00Z") });
    assert.equal((await acc.crearTemporada(base({ inicio: "2026-12-31", fin: "2027-01-02" }))).ok, true);
  });
});

describe("actualizarTemporada — hotel 53, ALTA id 140 con el dato histórico 0206-12-24", () => {
  const guardada = {
    id: 140, hotel_id: 53, nombre: "ALTA", fecha_inicio: "0206-12-24", fecha_fin: "2027-01-03",
    rangos: [{ fecha_inicio: "0206-12-24", fecha_fin: "2027-01-03" }], blackouts: [], compra_inicio: "2026-07-24", compra_fin: "2027-04-30",
  };
  beforeEach(() => {
    estado.programa["hotel_temporadas.select"] = (_st: Estado, unica: boolean) => ({ data: unica ? guardada : [guardada], error: null });
    estado.programa["hotel_temporadas.update"] = () => ({ data: { hotel_id: 53 }, error: null });
  });
  const editar = (over: Record<string, unknown>) => acc.actualizarTemporada(140, base({
    inicio: "0206-12-24", fin: "2027-01-03", compraInicio: "2026-07-24", compraFin: "2027-04-30", ...over,
  }));
  test("editar otro campo SIN tocar las fechas antiguas se permite (conserva históricos)", async () => {
    const r = await editar({ prioridad: 5 });
    assert.equal(r.ok, true);
    const up = escrituras().find((l) => l.op === "update")!;
    assert.equal((up.datos as { prioridad: number }).prioridad, 5);
    assert.equal((up.datos as { fecha_inicio: string }).fecha_inicio, "0206-12-24", "la fecha antigua queda como estaba");
  });
  test("cambiar SOLO el fin mientras el inicio sigue siendo 0206 se rechaza (el rango cambió)", async () => {
    rechazada(await editar({ fin: "2027-01-05" }), /0206-12-24/);
    assert.equal(escrituras().length, 0);
  });
  test("cambiar el inicio a otra fecha mala se rechaza", async () => {
    rechazada(await editar({ inicio: "0206-12-25" }), /0206-12-25/);
    rechazada(await editar({ inicio: "2026-02-30" }), /2026-02-30/);
    assert.equal(escrituras().length, 0);
  });
  test("la corrección legítima a 2026-12-24 SE ACEPTA y se escribe exactamente esa fecha", async () => {
    const r = await editar({ inicio: "2026-12-24" });
    assert.equal(r.ok, true);
    const up = escrituras().find((l) => l.op === "update")!;
    const d = up.datos as { fecha_inicio: string; rangos: { fecha_inicio: string; fecha_fin: string }[] };
    assert.equal(d.fecha_inicio, "2026-12-24");
    assert.deepEqual(d.rangos, [{ fecha_inicio: "2026-12-24", fecha_fin: "2027-01-03" }]);
  });
  test("agregar un rango nuevo con año anterior se rechaza aunque el rango antiguo no cambie", async () => {
    rechazada(await editar({ rangos: [{ fecha_inicio: "2025-05-01", fecha_fin: "2025-05-10" }] }), /2025-05-01/);
    assert.equal(escrituras().length, 0);
  });
  test("rechazar no regenera ni revalida; aceptar lo hace una sola vez", async () => {
    await editar({ fin: "2027-01-05" });
    assert.equal(estado.regen.length + estado.revalida.length, 0);
    await editar({ prioridad: 3 });
    assert.equal(estado.regen.length, 1);
  });
});

describe("cargas masivas y copia (crean vigencias)", () => {
  test("cargarTemporadasMasivo: la fila con 0206 se rechaza con error, la válida se inserta; no se corrige nada", async () => {
    estado.programa["hoteles.select"] = { data: [{ id: 53, nombre: "H53", destino_id: 1, destinos: { nombre: "X" } }], error: null };
    estado.programa["hotel_temporadas.select"] = { data: [], error: null };
    const res = await acc.cargarTemporadasMasivo([
      { hotel: "H53", temporada: "ALTA", fecha_inicio: "0206-12-24", fecha_fin: "2027-01-03" },
      { hotel: "H53", temporada: "MEDIA", fecha_inicio: "2027-02-01", fecha_fin: "2027-03-31" },
    ]);
    assert.equal(res.insertados, 1);
    assert.equal(res.errores.length, 1);
    assert.match(res.errores[0], /0206-12-24/);
    const ins = escrituras().filter((l) => l.op === "insert");
    assert.equal(ins.length, 1);
    assert.equal((ins[0].datos as { nombre: string }).nombre, "MEDIA");
  });
  test("cargarTemporadasMasivo: la fecha de compra mal escrita ya no se descarta en silencio", async () => {
    estado.programa["hoteles.select"] = { data: [{ id: 53, nombre: "H53", destino_id: 1, destinos: { nombre: "X" } }], error: null };
    estado.programa["hotel_temporadas.select"] = { data: [], error: null };
    const res = await acc.cargarTemporadasMasivo([
      { hotel: "H53", temporada: "ALTA", fecha_inicio: "2027-02-01", fecha_fin: "2027-03-31", compra_inicio: "2026-02-30", compra_fin: "2027-01-31" },
    ]);
    assert.equal(res.insertados, 0);
    assert.match(res.errores[0], /2026-02-30/);
  });
  test("cargarTemporadasMasivo: un duplicado exacto histórico se omite como siempre (no cuenta como error)", async () => {
    estado.programa["hoteles.select"] = { data: [{ id: 53, nombre: "H53", destino_id: 1, destinos: { nombre: "X" } }], error: null };
    estado.programa["hotel_temporadas.select"] = { data: [{ nombre: "VIEJA", fecha_inicio: "2024-01-01", fecha_fin: "2024-02-01" }], error: null };
    const res = await acc.cargarTemporadasMasivo([{ hotel: "H53", temporada: "VIEJA", fecha_inicio: "2024-01-01", fecha_fin: "2024-02-01" }]);
    assert.deepEqual(res.errores, []);
    assert.equal(res.insertados, 0);
  });
  test("copiarTemporadasDesdeHotel: copia solo las vigencias válidas, informa las omitidas y no las corrige", async () => {
    const buena = { nombre: "MEDIA", fecha_inicio: "2027-02-01", fecha_fin: "2027-03-31", rangos: [], blackouts: [], compra_inicio: null, compra_fin: null };
    const mala = { nombre: "ALTA", fecha_inicio: "0206-12-24", fecha_fin: "2027-01-03", rangos: [{ fecha_inicio: "0206-12-24", fecha_fin: "2027-01-03" }], blackouts: [], compra_inicio: null, compra_fin: null };
    const pasada = { nombre: "2025", fecha_inicio: "2025-01-01", fecha_fin: "2025-03-01", rangos: [], blackouts: [], compra_inicio: null, compra_fin: null };
    estado.programa["hotel_temporadas.select"] = { data: [buena, mala, pasada], error: null };
    const r = await acc.copiarTemporadasDesdeHotel(60, 53) as { ok: boolean; copiadas?: number; omitidas?: string[] };
    assert.equal(r.ok, true);
    assert.equal(r.copiadas, 1);
    assert.equal(r.omitidas?.length, 2);
    const ins = escrituras().filter((l) => l.op === "insert");
    assert.deepEqual((ins[0].datos as { nombre: string }[]).map((f) => f.nombre), ["MEDIA"]);
  });
  test("copiarTemporadasDesdeHotel: si ninguna vigencia cumple, falla sin escribir", async () => {
    const mala = { nombre: "ALTA", fecha_inicio: "0206-12-24", fecha_fin: "2027-01-03", rangos: [], blackouts: [], compra_inicio: null, compra_fin: null };
    estado.programa["hotel_temporadas.select"] = { data: [mala], error: null };
    const r = await acc.copiarTemporadasDesdeHotel(60, 53);
    assert.equal(r.ok, false);
    assert.equal(escrituras().length, 0);
  });
});
