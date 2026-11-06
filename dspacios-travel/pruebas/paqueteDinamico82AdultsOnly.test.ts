// #82 — ADULTS ONLY en el cálculo y en el SERVIDOR (guardarPaqueteTotal y publicarPaqueteTotal reales con clientes Supabase falsos, sin red ni base):
//  · la condición sale de la FICHA leída en el servidor (el navegador no cuenta); un hotel manual nunca es «solo adultos»;
//  · no se exigen importes de niño, niño 2 ni infante de ese hotel, y los que ya existan NO se borran;
//  · ausencia ≠ gratis: con menores el cálculo rechaza; el resto de hoteles de un paquete mixto sigue exigiendo sus importes;
//  · PVP general solo omite menores para un hotel solo adultos, por opción; un paquete sin hoteles los sigue exigiendo.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { if (s === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }; return n(s === "next/cache" ? s + ".js" : s, c); }'));

type Fila = Record<string, unknown>;
let soloAdultos: Record<number, boolean> = {};
let errorAdultos = false;
let paqueteRow: Fila = {};
let filasHoteles: Fila[] = [];
const escrituras: string[] = [];
let rpcs: { fn: string; args: Fila }[] = [];

function constructor(tabla: string, resolver: (t: string, select: string, maybe: boolean) => { data: unknown; error: unknown }) {
  let select = ""; let maybe = false;
  const b: Record<string, unknown> = new Proxy({}, {
    get(_o, prop: string) {
      if (prop === "then") return (ok: (v: unknown) => unknown) => ok(resolver(tabla, select, maybe));
      if (prop === "insert" || prop === "update" || prop === "delete" || prop === "upsert") return () => { escrituras.push(`${tabla}.${prop}`); return b; };
      return (...a: unknown[]) => { if (prop === "select") select = String(a[0] ?? ""); if (prop === "maybeSingle" || prop === "single") maybe = true; return b; };
    },
  });
  return b;
}
const catalogos = (t: string, select: string, maybe: boolean) => {
  const una = (x: unknown) => ({ data: maybe ? x : [x].filter(Boolean), error: null });
  switch (t) {
    case "usuarios": return una({ rol: "superadmin" });
    case "paquete_din": return una(select === "*" ? paqueteRow : { tenant: "mayorista" });
    case "paquete_din_hoteles": return { data: filasHoteles, error: null };
    case "hoteles":
      if (select.includes("adults_only")) return errorAdultos ? { data: null, error: { message: "timeout" } } : { data: Object.entries(soloAdultos).map(([id, a]) => ({ id: Number(id), adults_only: a })), error: null };
      if (select.includes("estrellas")) return { data: [{ id: 5, estrellas: 4, descripcion: "d", ubicacion: "u" }, { id: 6, estrellas: 3, descripcion: "d", ubicacion: "u" }], error: null };
      return { data: [], error: null };
    default: return { data: [], error: null };
  }
};
const cliente = () => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  from: (t: string) => constructor(t, catalogos),
  rpc: async (fn: string, args: Fila) => { rpcs.push({ fn, args }); return fn === "hotel_vinculable_din" ? { data: true, error: null } : { data: 99, error: null }; },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => cliente() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => cliente() } });
mock.module("@/lib/cotizacion/acceso", { namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, tenant: "mayorista" }), autorizaTenant: () => true } });

const { guardarPaqueteTotal, publicarPaqueteTotal } = await import("../app/(dashboard)/dashboard/paquetes/total/actions.ts");
const { liquidarPaquete, validarPaquete } = await import("../lib/paqueteDinamico/calculo.ts");
const { armarPaqueteCalc, opcionesDelPaquete } = await import("../lib/paqueteDinamico/modelo.ts");

const CUATRO = { sencilla: 100000, doble: 80000, triple: 70000, multiple: 60000 };
const SIETE = { ...CUATRO, nino: 50000, nino2: 40000, infante: 0 };
const hotel = (o: Fila = {}) => ({ hotelId: 5, nombre: "H5", categoria: "Estándar", regimen: "PC", descripcion: "", fotoUrl: "", proveedor: "P", estrellas: null, ubicacion: "", neto: CUATRO, pvp: {}, pvpGeneral: null, capacidadNinos: null, edadInfanteMax: null, edadNinoMax: null, ...o });
const entrada = (o: Fila = {}) => ({
  nombre: "Paquete", destinoId: 1, multidestino: false, destinosExtra: [], moneda: "COP", esquema: "neta_markup", pvpModo: null, pctMkPct: 20,
  usaVuelo: false, usaHotel: true, usaServicios: false, noches: 3, compraInicio: "", compraFin: "", viajeInicio: "", viajeFin: "", pvpGeneral: null, totalDeclarado: null,
  descripcion: "", incluye: "", noIncluye: "", vuelos: [], servicios: [], hoteles: [hotel()], ...o,
});
const reiniciar = (ao: Record<number, boolean>) => { soloAdultos = ao; errorAdultos = false; escrituras.length = 0; rpcs = []; };
const hotelesRpc = () => (rpcs.find((x) => x.fn === "guardar_paquete_din")?.args.p_hoteles as Fila[] | undefined) ?? [];
const err = (r: unknown) => (r as { error: string }).error;

test("SERVIDOR: ficha solo adultos con importes de sencilla a múltiple → se guarda sin exigir menores, aunque el navegador diga lo contrario", async () => {
  reiniciar({ 5: true });
  const r = await guardarPaqueteTotal(entrada({ hoteles: [hotel({ adultsOnly: false })] }) as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(hotelesRpc()[0].neto, CUATRO, "no se inventan importes de menores (ni gratis ni de otro tipo)");
});

test("SERVIDOR: ficha que admite menores sin importes de menores → rechazo (Adults Only no se asume)", async () => {
  reiniciar({ 5: false });
  const r = await guardarPaqueteTotal(entrada() as never);
  assert.equal(r.ok, false); assert.match(err(r), /Falta el precio del hotel para «nino»/);
  assert.equal(rpcs.some((x) => x.fn === "guardar_paquete_din"), false);
});

test("SERVIDOR: el valor del navegador NO manda: adultsOnly:true sobre una ficha que admite menores, o sobre un hotel manual, sigue exigiendo los siete importes", async () => {
  reiniciar({ 5: false });
  let r = await guardarPaqueteTotal(entrada({ hoteles: [hotel({ adultsOnly: true })] }) as never);
  assert.equal(r.ok, false); assert.match(err(r), /Falta el precio del hotel para «nino»/);
  r = await guardarPaqueteTotal(entrada({ hoteles: [hotel({ hotelId: null, adultsOnly: true, capacidadNinos: 2, edadInfanteMax: 2, edadNinoMax: 10 })] }) as never);
  assert.equal(r.ok, false); assert.match(err(r), /Falta el precio del hotel para «nino»/);
});

test("SERVIDOR: los importes de menores que ya existían se CONSERVAN (no se borran) aunque el hotel sea solo adultos", async () => {
  reiniciar({ 5: true });
  const r = await guardarPaqueteTotal(entrada({ hoteles: [hotel({ neto: { ...CUATRO, nino: 99, nino2: 98, infante: 97 } })] }) as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([hotelesRpc()[0].neto as Fila].map((x) => [x.nino, x.nino2, x.infante])[0], [99, 98, 97]);
});

test("SERVIDOR — paquete MIXTO: solo se omiten los menores del hotel solo adultos; el hotel que admite menores sigue exigiéndolos", async () => {
  reiniciar({ 5: true, 6: false });
  const mixto = (neto6: Fila) => entrada({ hoteles: [hotel(), hotel({ hotelId: 6, nombre: "H6", neto: neto6 })] });
  let r = await guardarPaqueteTotal(mixto(SIETE) as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(hotelesRpc().length, 2);
  r = await guardarPaqueteTotal(mixto(CUATRO) as never);
  assert.equal(r.ok, false); assert.match(err(r), /H6: Falta el precio del hotel para «nino»/, "el mensaje señala el hotel que sí los exige");
  assert.doesNotMatch(err(r), /H5/);
});

test("SERVIDOR: si no se puede leer la condición de la ficha, el guardado se detiene (no se asume ni una cosa ni la otra)", async () => {
  reiniciar({ 5: true }); errorAdultos = true;
  const r = await guardarPaqueteTotal(entrada() as never);
  assert.equal(r.ok, false); assert.match(err(r), /No se pudo leer si la ficha del hotel es solo para adultos/);
  assert.deepEqual(escrituras, []); assert.equal(rpcs.some((x) => x.fn === "guardar_paquete_din"), false);
});

test("SERVIDOR — publicar: relee la ficha; solo adultos publica sin importes de menores y una ficha que admite menores no", async () => {
  paqueteRow = { id: 7, tenant: "mayorista", activo: true, compra_fin: null, compra_inicio: null, usa_hotel: true, usa_vuelo: false, usa_servicios: false, esquema: "neta_markup", pvp_modo: null, pct_mk: 0.2, moneda: "COP", noches: 3, nombre: "P", pvp_general: null, total_declarado: null };
  filasHoteles = [{ id: 1, paquete_id: 7, hotel_id: 5, nombre: "H5", neto: CUATRO, pvp: {}, pvp_general: null }];
  reiniciar({ 5: true });
  let r = await publicarPaqueteTotal(7, true);
  assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(escrituras.includes("paquete_din.update"), "se publicó");
  reiniciar({ 5: false });
  r = await publicarPaqueteTotal(7, true);
  assert.equal(r.ok, false); assert.match(err(r), /No se puede publicar: Falta el precio del hotel para «nino»/);
  assert.ok(!escrituras.includes("paquete_din.update"));
});

// ───────────────────────── cálculo puro ─────────────────────────
const fila = (o: Fila = {}) => ({ id: 1, nombre: "P", moneda: "COP", esquema: "neta_markup", pvp_modo: null, pct_mk: 0.2, usa_vuelo: false, usa_hotel: true, usa_servicios: false, noches: 3, pvp_general: null, total_declarado: null, ...o }) as never;
const hfila = (o: Fila = {}) => ({ id: 9, hotel_id: 5, nombre: "H", categoria: "c", regimen: "r", descripcion: null, foto_url: null, proveedor: "", neto: CUATRO, pvp: {}, pvp_general: null, adults_only: true, ...o }) as never;
const comp = (o: Fila = {}) => ({ habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, ...o });

test("CÁLCULO: hotel solo adultos no exige menores; sin la marca se exigen; liquida a adultos con el precio real", () => {
  const con = armarPaqueteCalc(fila(), hfila(), null, []);
  assert.deepEqual(validarPaquete(con), []);
  assert.equal(liquidarPaquete(con, comp()).total, Math.round(80000 / 0.8) * 2);
  const sin = armarPaqueteCalc(fila(), hfila({ adults_only: false }), null, []);
  assert.match(validarPaquete(sin)[0], /Falta el precio del hotel para «nino»/);
});

test("CÁLCULO: ausencia de importes de menores NO es «gratis»: con menores se rechaza (también con importes históricos presentes)", () => {
  const solo = armarPaqueteCalc(fila(), hfila(), null, []);
  for (const m of [{ ninos: 1 }, { ninos2: 1 }, { infantes: 1 }]) assert.throws(() => liquidarPaquete(solo, comp(m)), /Este hotel es solo para adultos: no admite menores\./);
  const historico = armarPaqueteCalc(fila(), hfila({ neto: SIETE }), null, []);
  assert.throws(() => liquidarPaquete(historico, comp({ ninos: 1 })), /solo para adultos/, "los importes históricos no habilitan menores");
  assert.equal(liquidarPaquete(historico, comp()).total, Math.round(80000 / 0.8) * 2, "y no cambian el precio a adultos");
});

test("CÁLCULO — precio general: se omiten menores solo para la opción del hotel solo adultos; sin hoteles o con hotel que admite menores se exigen", () => {
  const gen = (o: Fila = {}) => fila({ esquema: "solo_pvp", pvp_modo: "general", pvp_general: CUATRO, ...o });
  assert.deepEqual(validarPaquete(armarPaqueteCalc(gen(), hfila(), null, [])), []);
  assert.match(validarPaquete(armarPaqueteCalc(gen(), hfila({ adults_only: false }), null, []))[0], /Falta el precio general de «nino»/);
  assert.match(validarPaquete(armarPaqueteCalc(gen({ usa_hotel: false, usa_servicios: true }), null, null, [{ id: 1, servicio_id: null, nombre: "S", proveedor: "", neto: null, pvp: 10 }]))[0], /Falta el precio general de «nino»/, "sin hoteles no aplica la condición");
  // mixto: cada opción por su hotel
  const ops = opcionesDelPaquete(gen(), [hfila(), hfila({ id: 10, adults_only: false })], [], []);
  assert.deepEqual(ops.map((o) => validarPaquete(o.calc).length > 0), [false, true]);
});

test("CÁLCULO: vuelos y servicios conservan sus reglas de menores (infante del vuelo, niños en servicios) con un hotel solo adultos", () => {
  const p = armarPaqueteCalc(fila({ usa_vuelo: true }), hfila(), { id: 1, empaquetado_id: null, destino_id: null, aerolinea: "A", ruta: "BOG - CTG", fecha_ida: null, fecha_regreso: null, proveedor: "A", neto: { adulto: 400000 }, pvp: {} }, []);
  assert.match(validarPaquete(p)[0], /Falta el fee\/PVP de infante del vuelo/, "el vuelo sigue exigiendo su importe de infante: no se eliminan tarifas de otros componentes");
});

test("CABLEADO: la condición se lee de la ficha en seleccion.ts, cargarPublico.ts y actions.ts; publico.ts la conserva en la copia pública", () => {
  const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
  assert.match(leer("lib/paqueteDinamico/seleccion.ts"), /adults_only: reglas\?\.adultsOnly === true/);
  assert.match(leer("lib/paqueteDinamico/cargarPublico.ts"), /x\.adults_only = reglasHotel\.get\(x\.id\)\?\.adultsOnly === true/);
  assert.match(leer("lib/paqueteDinamico/publico.ts"), /adultsOnly: true/);
  const a = leer("app/(dashboard)/dashboard/paquetes/total/actions.ts");
  assert.match(a, /select\("id, adults_only"\)/); assert.match(a, /adultsOnly: soloAdultos\.get\(h\.hotelId\) === true/); assert.match(a, /\{ \.\.\.h, adultsOnly: false \}/);
});
