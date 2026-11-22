// #84 (ADL-039) — Valor VIGENTE del contrato de una cotización convertida: cargador REAL contra una base en memoria.
// Aislamiento por ids (aliado A / B / otra agencia / sin sesión de aliado), sin columnas de costo, valores inválidos sin inventar ceros, lectura incompleta
// que falla cerrada, lotes de 100 con tope de filas del proyecto, y el número de lecturas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cargarValorContratos, contratoEsDelAliado } from "../lib/portal/valorContrato.ts";
import { supabaseEnMemoria } from "./support/memoriaSupabase.ts";

type Fila = Record<string, unknown>;
const A = { userId: "u-a", aliadoId: 7 }, B = { userId: "u-b", aliadoId: 8 }, SIN_FICHA = { userId: "u-c", aliadoId: null };
const venta = (n: string, extra: Fila = {}): Fila => ({
  numero_contrato: n, precio_venta: 4520000, moneda: "COP", estado: "confirmado", aliado_id: 7, b2b_usuario_id: null, tenant: "mayorista",
  costo_hotel: 3200000, costo_aereo: 800000, costo_receptivo: 0, otros_costos: 0, comision_b2b: 480000, observaciones: "interno", ...extra,
});
function admin(ventas: Fila[], opts = {}) {
  const base = supabaseEnMemoria({ ventas }, opts);
  const log: { tabla: string; columnas: string }[] = [];
  return {
    cliente: { from: (t: string) => { const q = base.from(t); const sel = q.select; q.select = (c?: string, o?: { count?: string }) => { log.push({ tabla: t, columnas: String(c) }); return sel(c, o); }; return q; } } as never,
    log,
  };
}

test("V84-1 el aliado ve el valor VIGENTE (lo que hoy dice el contrato) de su contrato, con moneda y vista", async () => {
  const { cliente } = admin([venta("00-0451", { precio_venta: 4700000 }), venta("00-0452", { precio_venta: 2260, moneda: "USD", aliado_id: null, b2b_usuario_id: "u-a" })]);
  const r = await cargarValorContratos(cliente, A, ["00-0451", "00-0452"]);
  assert.equal(r.error, false);
  assert.deepEqual(r.mapa.get("00-0451"), { numero: "00-0451", valor: 4700000, moneda: "COP", anulado: false, vista: "asistidas" });
  assert.deepEqual(r.mapa.get("00-0452"), { numero: "00-0452", valor: 2260, moneda: "USD", anulado: false, vista: "directas" });
});

test("V84-2 aislamiento: B, un usuario sin ficha ni vínculo y una sesión sin aliado NO obtienen el contrato de A, aunque pidan su número", async () => {
  const { cliente } = admin([venta("00-0451"), venta("00-0460", { aliado_id: 8 })]);
  const b = await cargarValorContratos(cliente, B, ["00-0451", "00-0460"]);
  assert.deepEqual([...b.mapa.keys()], ["00-0460"]);
  assert.equal((await cargarValorContratos(cliente, SIN_FICHA, ["00-0451"])).mapa.size, 0);
  assert.equal((await cargarValorContratos(cliente, { userId: "", aliadoId: null }, ["00-0451"])).mapa.size, 0);
  // La pertenencia es por id: un nombre parecido no sirve, y aliado_id nulo en ambos lados no empareja.
  assert.equal(contratoEsDelAliado({ aliado_id: null, b2b_usuario_id: null }, { userId: "u-a", aliadoId: null }), false);
  assert.equal(contratoEsDelAliado({ aliado_id: 7, b2b_usuario_id: null }, { userId: "u-a", aliadoId: 70 }), false);
});

test("V84-3 solo se piden columnas sin costos ni márgenes: ninguna columna financiera interna viaja del contrato a la pantalla", async () => {
  const { cliente, log } = admin([venta("00-0451")]);
  const r = await cargarValorContratos(cliente, A, ["00-0451"]);
  assert.equal(log.length, 1);
  assert.equal(log[0].tabla, "ventas");
  assert.ok(!/costo|margen|comision|otros|observ|precio_neto|utilidad|retencion/i.test(log[0].columnas), `columnas pedidas: ${log[0].columnas}`);
  assert.deepEqual(Object.keys(r.mapa.get("00-0451") ?? {}).sort(), ["anulado", "moneda", "numero", "valor", "vista"]);
  assert.ok(!JSON.stringify([...r.mapa.values()]).includes("3200000"), "el costo del hotel no aparece en la salida");
});

test("V84-4 dato ausente o inválido: no se inventa un cero (la fila conserva solo el valor cotizado); un contrato anulado se marca", async () => {
  const { cliente } = admin([
    venta("00-1", { precio_venta: null }), venta("00-2", { precio_venta: "" }), venta("00-3", { precio_venta: "abc" }), venta("00-4", { precio_venta: -5 }),
    venta("00-5", { precio_venta: "1250000.50" }), venta("00-6", { estado: "anulado" }), venta("00-7", { moneda: null }),
  ]);
  const r = await cargarValorContratos(cliente, A, ["00-1", "00-2", "00-3", "00-4", "00-5", "00-6", "00-7"]);
  assert.deepEqual([...r.mapa.keys()].sort(), ["00-5", "00-6", "00-7"]);
  assert.equal(r.mapa.get("00-5")?.valor, 1250000.5);
  assert.equal(r.mapa.get("00-6")?.anulado, true);
  assert.equal(r.mapa.get("00-7")?.moneda, "COP");
});

test("V84-5 lectura incompleta o con error falla cerrada: mapa vacío y error=true, nunca valores a medias", async () => {
  const filas = [venta("00-0451"), venta("00-0452")];
  for (const fallo of ["error", "sin_conteo", "vacia", "fila_ajena", "conteo_cambia"] as const) {
    const { cliente } = admin(filas, { fallar: () => fallo });
    assert.deepEqual(await cargarValorContratos(cliente, A, ["00-0451", "00-0452"]), { mapa: new Map(), error: true }, fallo);
  }
});

test("V84-6 muchos contratos: lotes de 100 con el tope de filas del proyecto (1000) y UNA lectura por lote; sin convertidas no se lee nada", async () => {
  const n = 250;
  const { cliente, log } = admin(Array.from({ length: n }, (_, i) => venta(`00-${String(i).padStart(4, "0")}`)), { maxFilas: 1000 });
  const nums = Array.from({ length: n }, (_, i) => `00-${String(i).padStart(4, "0")}`);
  const r = await cargarValorContratos(cliente, A, [...nums, ...nums, null, undefined, ""]);
  assert.equal(r.mapa.size, n); assert.equal(r.error, false);
  assert.equal(log.length, 3, "250 números = 3 lotes de 100, repetidos y vacíos descartados");
  const vacio = admin([]);
  assert.deepEqual(await cargarValorContratos(vacio.cliente, A, [null, undefined]), { mapa: new Map(), error: false });
  assert.equal(vacio.log.length, 0);
});
