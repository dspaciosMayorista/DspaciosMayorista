import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import {
  evaluarSalidaDinamica,
  salidaDinamicaVigente,
  verificarSalidaDinamicaVigente,
  salidasDinamicasVigentes,
  seleccionarSalidasVigentes,
  mensajeSalidaNoVigente,
  type MotivoSalidaNoVigente,
  type SalidaParaVigencia,
} from "../lib/reservar/salidaDinamicaVigente.ts";
import { hoyBogota } from "../lib/reservar/origen.ts";

// #62 — regla ÚNICA de elegibilidad de una salida dinámica. Ejecución real de
// las funciones del helper (puras y las que leen con un cliente simulado).
// Los consumidores (computarReserva / cargarDatosTarifario / generarTarifario)
// se ejecutan en pruebas/salidaDinamicaFlujos62.test.ts.

const HOY = "2026-10-19";
const base: SalidaParaVigencia = { id: 7, activo: true, compra_inicio: null, compra_fin: null, fecha_ida: "2026-12-01" };

function motivo(s: SalidaParaVigencia | null | undefined, hoy = HOY): MotivoSalidaNoVigente | "ok" {
  const r = evaluarSalidaDinamica(s, hoy);
  return r.ok ? "ok" : r.motivo;
}

describe("evaluarSalidaDinamica() — estado y existencia", () => {
  test("activa, sin ventana, viaje futuro: ok", () => assert.equal(motivo(base), "ok"));
  test("fila inexistente o invisible (null/undefined): no_existe", () => {
    assert.equal(motivo(null), "no_existe");
    assert.equal(motivo(undefined), "no_existe");
  });
  test("activo=false: inactiva", () => assert.equal(motivo({ ...base, activo: false }), "inactiva"));
  test("activo null/undefined: inactiva (falla cerrado, no se asume activa)", () => {
    assert.equal(motivo({ ...base, activo: null }), "inactiva");
    assert.equal(motivo({ ...base, activo: undefined }), "inactiva");
  });
});

describe("evaluarSalidaDinamica() — ventana de compra con límites INCLUSIVOS", () => {
  test("compra_inicio = hoy: ok (ya abrió)", () => assert.equal(motivo({ ...base, compra_inicio: HOY }), "ok"));
  test("compra_inicio = mañana: compra_no_iniciada", () => assert.equal(motivo({ ...base, compra_inicio: "2026-10-20" }), "compra_no_iniciada"));
  test("compra_fin = hoy: ok (último día de compra)", () => assert.equal(motivo({ ...base, compra_fin: HOY }), "ok"));
  test("compra_fin = ayer: compra_vencida", () => assert.equal(motivo({ ...base, compra_fin: "2026-10-18" }), "compra_vencida"));
  test("compra_inicio = compra_fin = hoy: ok (ventana de un solo día)", () => {
    assert.equal(motivo({ ...base, compra_inicio: HOY, compra_fin: HOY }), "ok");
  });
  test("ventana ya cerrada Y viaje pasado: reporta la compra vencida primero (orden determinista)", () => {
    assert.equal(motivo({ ...base, compra_fin: "2026-10-01", fecha_ida: "2026-10-05" }), "compra_vencida");
  });
});

describe("evaluarSalidaDinamica() — viaje", () => {
  test("fecha_ida = hoy: ok (el viaje que sale hoy sigue vigente; coincide con el filtro de fecha existente)", () => {
    assert.equal(motivo({ ...base, fecha_ida: HOY }), "ok");
  });
  test("fecha_ida = ayer: viaje_pasado", () => assert.equal(motivo({ ...base, fecha_ida: "2026-10-18" }), "viaje_pasado"));
  test("fecha_ida ausente o mal formada: sin_fecha_ida (no se interpreta como futura)", () => {
    for (const f of [null, undefined, "", "01/12/2026", "2026-12-1", "mañana"]) {
      assert.equal(motivo({ ...base, fecha_ida: f as string | null | undefined }), "sin_fecha_ida", String(f));
    }
  });
});

describe("cambio de día en Bogotá (UTC-5) con hoyBogota()", () => {
  // La salida cierra su compra el 19: el último instante válido es 23:59:59
  // hora de Bogotá, que ya es el día 20 en UTC.
  const salida = { ...base, compra_fin: "2026-10-19", fecha_ida: "2026-12-01" };

  test("2026-10-20T04:59:59Z = 19/oct 23:59:59 Bogotá: aún vigente", () => {
    const hoy = hoyBogota(new Date("2026-10-20T04:59:59Z"));
    assert.equal(hoy, "2026-10-19");
    assert.equal(motivo(salida, hoy), "ok");
  });
  test("2026-10-20T05:00:00Z = 20/oct 00:00:00 Bogotá: compra_vencida", () => {
    const hoy = hoyBogota(new Date("2026-10-20T05:00:00Z"));
    assert.equal(hoy, "2026-10-20");
    assert.equal(motivo(salida, hoy), "compra_vencida");
  });
  test("viaje del 19 evaluado a las 23:59:59 Bogotá (04:59:59Z del 20): ok; un segundo después: viaje_pasado", () => {
    const s = { ...base, fecha_ida: "2026-10-19" };
    assert.equal(motivo(s, hoyBogota(new Date("2026-10-20T04:59:59Z"))), "ok");
    assert.equal(motivo(s, hoyBogota(new Date("2026-10-20T05:00:00Z"))), "viaje_pasado");
  });
  test("compra_inicio = 20/oct: a las 23:59:59 del 19 Bogotá todavía no abre; a las 00:00:00 del 20 abre", () => {
    const s = { ...base, compra_inicio: "2026-10-20" };
    assert.equal(motivo(s, hoyBogota(new Date("2026-10-20T04:59:59Z"))), "compra_no_iniciada");
    assert.equal(motivo(s, hoyBogota(new Date("2026-10-20T05:00:00Z"))), "ok");
  });
});

describe("salidaDinamicaVigente() y mensajes", () => {
  test("booleano coherente con la evaluación", () => {
    assert.equal(salidaDinamicaVigente(base, HOY), true);
    assert.equal(salidaDinamicaVigente({ ...base, activo: false }, HOY), false);
    assert.equal(salidaDinamicaVigente(null, HOY), false);
  });
  test("cada motivo tiene un mensaje de negocio propio, sin texto de Postgres", () => {
    const motivos: MotivoSalidaNoVigente[] = ["no_existe", "inactiva", "sin_fecha_ida", "compra_no_iniciada", "compra_vencida", "viaje_pasado", "error_lectura"];
    const textos = new Set(motivos.map(mensajeSalidaNoVigente));
    assert.equal(textos.size, motivos.length, "mensajes distintos por motivo");
    for (const t of textos) assert.match(t, /^[A-ZÁÉÍÓÚ].+\.$/);
  });
});

// ─── Lectura con cliente simulado ──────────────────────────────────────────
type Respuesta = { data: unknown; error: unknown };
function clienteSalidas(respuesta: Respuesta, consultas: { tabla?: string; columnas?: string; filtros: [string, unknown][] } = { filtros: [] }) {
  const b: Record<string, unknown> = {};
  b.select = (c: string) => { consultas.columnas = c; return b; };
  b.eq = (col: string, v: unknown) => { consultas.filtros.push([`eq:${col}`, v]); return b; };
  b.in = (col: string, v: unknown) => { consultas.filtros.push([`in:${col}`, v]); return b; };
  b.maybeSingle = async () => respuesta;
  b.then = (res: (v: Respuesta) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(respuesta).then(res, rej);
  return { from(t: string) { consultas.tabla = t; return b; } } as unknown as SupabaseClient<Database>;
}

describe("verificarSalidaDinamicaVigente() — lee la fila viva y falla cerrado", () => {
  test("fila vigente: ok, consulta solo las columnas de vigencia de ESA salida (sin costo ni tiquete)", async () => {
    const q: { tabla?: string; columnas?: string; filtros: [string, unknown][] } = { filtros: [] };
    const r = await verificarSalidaDinamicaVigente(clienteSalidas({ data: { ...base, id: 7 }, error: null }, q), 7, HOY);
    assert.equal(r.ok, true);
    assert.equal(q.tabla, "salidas_dinamicas");
    assert.deepEqual(q.filtros, [["eq:id", 7]]);
    assert.doesNotMatch(q.columnas ?? "", /valor_tiquete|fee_infante|\*/);
  });
  test("sin fila (eliminada o invisible por RLS): no_existe", async () => {
    const r = await verificarSalidaDinamicaVigente(clienteSalidas({ data: null, error: null }), 7, HOY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "no_existe");
  });
  test("error de consulta: error_lectura, y el mensaje NO contiene el texto crudo del error", async () => {
    const r = await verificarSalidaDinamicaVigente(clienteSalidas({ data: null, error: { message: "permission denied for table salidas_dinamicas" } }), 7, HOY);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.motivo, "error_lectura");
      assert.doesNotMatch(r.error, /permission denied|salidas_dinamicas/);
    }
  });
  test("fila desactivada / vencida: rechaza con su motivo", async () => {
    const a = await verificarSalidaDinamicaVigente(clienteSalidas({ data: { ...base, activo: false }, error: null }), 7, HOY);
    const b = await verificarSalidaDinamicaVigente(clienteSalidas({ data: { ...base, compra_fin: "2026-10-18" }, error: null }), 7, HOY);
    assert.deepEqual([a.ok, b.ok], [false, false]);
    if (!a.ok && !b.ok) assert.deepEqual([a.motivo, b.motivo], ["inactiva", "compra_vencida"]);
  });
});

describe("salidasDinamicasVigentes() — carga de ofertas", () => {
  test("lista vacía: ok sin consultar", async () => {
    let consultado = false;
    const sb = { from() { consultado = true; throw new Error("no debe consultar"); } } as unknown as SupabaseClient<Database>;
    const r = await salidasDinamicasVigentes(sb, [], HOY);
    assert.equal(r.ok, true);
    assert.equal(consultado, false);
  });
  test("devuelve el conjunto de ids elegibles; las ausentes (eliminadas/invisibles) no entran", async () => {
    const q: { tabla?: string; columnas?: string; filtros: [string, unknown][] } = { filtros: [] };
    const data = [
      { ...base, id: 1 },
      { ...base, id: 2, activo: false },
      { ...base, id: 3, compra_fin: "2026-10-18" },
      { ...base, id: 4, fecha_ida: "2026-10-18" },
      // id 5 pedida pero ausente en la respuesta
    ];
    const r = await salidasDinamicasVigentes(clienteSalidas({ data, error: null }, q), [1, 2, 3, 4, 5], HOY);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual([...r.vigentes], [1]);
    assert.deepEqual(q.filtros, [["in:id", [1, 2, 3, 4, 5]]]);
  });
  test("error de consulta: ok:false con el error (el llamador oculta todo)", async () => {
    const r = await salidasDinamicasVigentes(clienteSalidas({ data: null, error: { code: "42501" } }), [1], HOY);
    assert.equal(r.ok, false);
  });
});

describe("seleccionarSalidasVigentes() — generación", () => {
  test("filtra conservando el orden y cuenta descartadas", () => {
    const filas = [
      { ...base, id: 1 }, { ...base, id: 2, activo: false }, { ...base, id: 3, fecha_ida: "2026-10-01" }, { ...base, id: 4 },
    ];
    const r = seleccionarSalidasVigentes(filas, HOY);
    assert.deepEqual(r.vigentes.map((s) => s.id), [1, 4]);
    assert.equal(r.descartadas, 2);
  });
  test("conserva el tipo de fila del llamador (no recorta columnas)", () => {
    const r = seleccionarSalidasVigentes([{ ...base, id: 9, valor_tiquete: 123, ruta: "BOG-CTG" }], HOY);
    assert.equal(r.vigentes[0].valor_tiquete, 123);
    assert.equal(r.vigentes[0].ruta, "BOG-CTG");
  });
});
