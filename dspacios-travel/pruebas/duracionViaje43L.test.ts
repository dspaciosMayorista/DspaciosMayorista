import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import {
  MAX_NOCHES_VIAJE, mensajeNochesViaje, nochesEntre, validarNochesViaje, validarFechasViaje, validarNochesAlEditar, validarFechasAlEditar,
} from "../lib/reglas/duracionViaje.ts";
import { validarRangoFechasConsulta, MAX_NOCHES_CONSULTA } from "../lib/reservar/edadesMenores.ts";

// ─────────────────────────────────────────────────────────────────────────
// #43/#60 entrega L — estadía máxima global de 30 noches (§3.8; historial AA.2–AA.5). Un solo valor; 30 se acepta, 31 se rechaza con
// el mensaje y sin recortar; los productos antiguos de más de 30 noches se conservan al editarlos si su duración no cambia (los decide el
// dueño tras el diagnóstico); EBB / Long Stay / compra no se confunden con la duración.
// ─────────────────────────────────────────────────────────────────────────
const leer = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const MSG31 = "La estadía máxima es de 30 noches; elegiste 31. Ajusta las fechas.";

describe("regla pura", () => {
  test("un solo valor: 30; las consultas usan el mismo", () => {
    assert.equal(MAX_NOCHES_VIAJE, 30);
    assert.equal(MAX_NOCHES_CONSULTA, MAX_NOCHES_VIAJE);
  });
  test("la salida no cuenta como noche: 1 → 31 = 30 (válida); 1 → 32 = 31 (rechazada con el mensaje)", () => {
    assert.equal(nochesEntre("2027-03-01", "2027-03-31"), 30);
    assert.deepEqual(validarFechasViaje("2027-03-01", "2027-03-31"), { ok: true });
    assert.deepEqual(validarFechasViaje("2027-03-01", "2027-04-01"), { ok: false, error: MSG31 });
    assert.deepEqual(validarNochesViaje(31), { ok: false, error: MSG31 });
    assert.equal(mensajeNochesViaje(45), "La estadía máxima es de 30 noches; elegiste 45. Ajusta las fechas.");
  });
  test("fechas ausentes o inválidas no deciden (las valida quien llama con su regla de siempre)", () => {
    assert.deepEqual(validarFechasViaje("2027-03-01", null), { ok: true });
    assert.deepEqual(validarFechasViaje("no", "2027-04-01"), { ok: true });
  });
  test("al editar: un producto antiguo de 40 noches se conserva si no cambia; cambiarlo a 35 o pasar de 20 a 31 se rechaza", () => {
    assert.deepEqual(validarNochesAlEditar(40, 40), { ok: true });
    assert.equal(validarNochesAlEditar(35, 40).ok, false);
    assert.equal(validarNochesAlEditar(31, 20).ok, false);
    assert.deepEqual(validarNochesAlEditar(30, 40), { ok: true });
    assert.deepEqual(validarFechasAlEditar("2027-03-01", "2027-04-10", "2027-05-01", "2027-06-10"), { ok: true }); // mismas 40 noches
    assert.equal(validarFechasAlEditar("2027-03-01", "2027-04-11", "2027-05-01", "2027-06-10").ok, false);
  });
});

describe("consultas por fechas (hoteles, receptivos, tarjeta, carrito): mismo validador", () => {
  test("30 noches pasa; 31 se rechaza con el mensaje de la estadía máxima (antes permitía 60)", () => {
    assert.equal(validarRangoFechasConsulta("2027-03-01", "2027-03-31", "2027-01-01").ok, true);
    assert.deepEqual(validarRangoFechasConsulta("2027-03-01", "2027-04-01", "2027-01-01"), { ok: false, error: MSG31 });
    assert.equal(validarRangoFechasConsulta("2027-03-01", "2027-04-20", "2027-01-01").ok, false, "50 noches: antes válido, ahora no");
  });
  test("buscarReceptivos, buscarHoteles, cotizarPorFechas, la tarjeta y la búsqueda por unidad usan validarRangoFechasConsulta", () => {
    const cot = leer("lib/reservar/cotizar.ts");
    assert.ok((cot.match(/validarRangoFechasConsulta\(/g) ?? []).length >= 2);
    assert.match(leer("lib/tarifario/entradaTarjeta.ts"), /validarRangoFechasConsulta\(/);
    assert.match(leer("app/tarifario/busquedaUnidadActions.ts"), /validarRangoFechasConsulta\(/);
    assert.match(leer("lib/reservar/edadesMenores.ts"), /const vViaje = validarFechasViaje\(fechaIda, fechaRegreso\);/, "ítem del carrito");
  });
});

// ── Acciones del servidor llamadas directamente (no dependen del formulario) ──
const est = { rpc: [] as string[], escrituras: [] as string[] };
(globalThis as unknown as { __L: typeof est }).__L = est;
type ResolveHook = (s: string, c: { parentURL?: string }, n: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
registerHooks({
  resolve(s, c, n) {
    if (s === "server-only") return { url: datos("export {}"), shortCircuit: true };
    if (s === "next/cache") return { url: datos("export function revalidatePath(){} export function revalidateTag(){} export function unstable_noStore(){}"), shortCircuit: true };
    if (s === "next/headers") return { url: datos("export async function cookies(){ return { getAll: () => [], get: () => undefined, set(){} }; } export async function headers(){ return new Map(); }"), shortCircuit: true };
    // Importaciones relativas sin extensión entre acciones (p. ej. vuelos → ../paquetes/actions), como las resuelve Next.
    if (s.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(s)) { for (const ext of [".ts", ".tsx", "/index.ts"]) { try { return n(s + ext, c); } catch { /* siguiente */ } } }
    return n(s, c);
  },
});
function consulta(tabla: string) {
  const b: Record<string, unknown> = {};
  const fin = () => ({ data: null, error: { message: "sin datos en la prueba" } });
  for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = () => b;
  for (const m of ["insert", "update", "upsert", "delete"]) b[m] = () => { est.escrituras.push(`${tabla}.${m}`); return b; };
  b.maybeSingle = () => Promise.resolve(fin()); b.single = () => Promise.resolve(fin());
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(fin()).then(res, rej);
  return b;
}
const cliente = { rpc: async (fn: string) => { est.rpc.push(fn); return { data: null, error: { message: "sin datos en la prueba" } }; }, from: (t: string) => consulta(t),
  auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => cliente } });
beforeEach(() => { est.rpc.length = 0; est.escrituras.length = 0; });

const vuelos = await import("../app/(dashboard)/dashboard/vuelos/actions.ts");
const empaq = await import("../app/(dashboard)/dashboard/vuelos/empaquetados-actions.ts");
const paquetes = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const programas = await import("../app/(dashboard)/dashboard/producto/programas/actions.ts");
const manual = await import("../app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");

describe("acciones con 31 noches: rechazadas con el mensaje, sin escribir nada", () => {
  test("bloqueo nuevo", async () => {
    const r = await vuelos.crearBloqueo({ record: "L31ABC", modalidadEmision: "grupo", moneda: "COP", cuposTotal: 2, fechaIda: "2027-03-01", fechaRegreso: "2027-04-01" } as never);
    assert.deepEqual(r, { ok: false, error: MSG31 });
    assert.deepEqual(est.rpc, []);
  });
  test("bloqueo nuevo con 30 noches: pasa la regla (llega a la RPC de siempre)", async () => {
    await vuelos.crearBloqueo({ record: "L30ABC", modalidadEmision: "grupo", moneda: "COP", cuposTotal: 2, fechaIda: "2027-03-01", fechaRegreso: "2027-03-31" } as never);
    assert.deepEqual(est.rpc, ["crear_bloqueo"]);
  });
  test("empaquetado nuevo", async () => {
    const r = await empaq.crearEmpaquetado({ fechaIda: "2027-03-01", fechaRegreso: "2027-04-01", tarifaProveedor: 0, tarifaParaEmpaquetar: 0, feeInfante: 0 } as never);
    assert.deepEqual(r, { ok: false, error: MSG31 });
    assert.deepEqual(est.escrituras, []);
  });
  test("salida dinámica nueva", async () => {
    const r = await paquetes.crearSalidaDinamica(1, { fechaIda: "2027-03-01", fechaRegreso: "2027-04-01" } as never);
    assert.deepEqual(r, { ok: false, error: MSG31 });
    assert.deepEqual(est.escrituras, []);
  });
  test("paquete nuevo con 31 noches", async () => {
    const r = await paquetes.crearPaquete({ nombre: "L", tipo: "porcion_terrestre", noches: 31, monedaPublicacion: "COP", condicionPagoTipo: "normal" } as never);
    assert.equal(r.ok, false);
    if (!r.ok && r.error === MSG31) assert.deepEqual(est.escrituras, []);
    else assert.fail(`se esperaba el rechazo por estadía máxima; llegó: ${JSON.stringify(r)}`);
  });
  test("programa nuevo con 31 noches", async () => {
    const r = await programas.crearPrograma({ nombre: "L", noches: 31, dias: 32, condicionPagoTipo: "normal" } as never);
    assert.equal(r.ok, false);
    if (!r.ok && r.error === MSG31) assert.deepEqual(est.escrituras, []);
    else assert.fail(`se esperaba el rechazo por estadía máxima; llegó: ${JSON.stringify(r)}`);
  });
  test("cotización manual nueva", async () => {
    const r = await manual.crearCotizacionManual({ cliente: { nombres: "A", apellidos: "B" }, fechaIda: "2027-03-01", fechaRegreso: "2027-04-01" } as never);
    assert.deepEqual(r, { ok: false, error: MSG31 });
    assert.deepEqual(est.escrituras, []);
  });
});

describe("cableado de los demás puntos (edición, carga masiva, reserva, contrato manual)", () => {
  test("editar bloqueo, empaquetado, salida, paquete y programa: validarFechasAlEditar / validarNochesAlEditar con lo guardado", () => {
    assert.match(leer("app/(dashboard)/dashboard/vuelos/actions.ts"), /validarFechasAlEditar\(input\.fechaIda, input\.fechaRegreso, prev\?\.fecha_ida, prev\?\.fecha_regreso\)/);
    assert.match(leer("app/(dashboard)/dashboard/vuelos/empaquetados-actions.ts"), /validarFechasAlEditar\(input\.fechaIda, input\.fechaRegreso, prev\?\.fecha_ida, prev\?\.fecha_regreso\)/);
    const paq = leer("app/(dashboard)/dashboard/paquetes/actions.ts");
    assert.match(paq, /validarFechasAlEditar\(input\.fechaIda, input\.fechaRegreso, prev\?\.fecha_ida, prev\?\.fecha_regreso\)/);
    assert.match(paq, /validarNochesAlEditar\(Number\(c\.noches\) \|\| 3, /);
    const prog = leer("app/(dashboard)/dashboard/producto/programas/actions.ts");
    assert.match(prog, /validarNochesAlEditar\(input\.noches == null \? null : Number\(input\.noches\), prev\?\.noches \?\? null\)/);
    assert.match(prog, /validarNochesAlEditar\(num\(s\.noches\), previas\.get\(/, "salidas del programa");
  });
  test("carga masiva de bloqueos: la fila de 31 noches se lista como rechazada y las demás siguen", () => {
    assert.match(leer("app/(dashboard)/dashboard/vuelos/actions.ts"), /if \(!vNoches\.ok\) \{ errores\.push\(`Fila \$\{linea\} \(\$\{record\}\): \$\{vNoches\.error\}`\); continue; \}/);
  });
  test("reserva por fechas (computarReserva) y programa (noches incluidas + adicionales) validan la estadía", () => {
    assert.match(leer("lib/reservar/computo.ts"), /const vViaje = validarNochesViaje\(numNoches\);/);
    assert.match(leer("app/(dashboard)/dashboard/reservar/actions.ts"), /validarNochesViaje\(nochesIncluidas \+ est\.nochesAdicionales\)/);
  });
  test("contrato manual nuevo: se rechaza ANTES de reservar el consecutivo", () => {
    const k = leer("app/(dashboard)/dashboard/contratos/actions.ts");
    const i = k.indexOf("validarFechasViaje(input.fechaSalida, input.fechaRegreso)");
    assert.ok(i > 0 && i < k.indexOf("tipoDocumentoCliente(input.clienteTipoDocumento"), "antes de numerar");
  });
  test("una sola definición: el número 30 de duración solo vive en lib/reglas/duracionViaje.ts", () => {
    assert.match(leer("lib/reglas/duracionViaje.ts"), /export const MAX_NOCHES_VIAJE = 30;/);
    assert.doesNotMatch(leer("lib/reservar/edadesMenores.ts"), /MAX_NOCHES_CONSULTA = \d/);
  });
});
