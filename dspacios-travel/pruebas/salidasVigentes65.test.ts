// #65 — Un contrato anulado o cancelado no cuenta como salida en NINGUNA de las tres vistas del inicio
// (Próximas salidas, serie «Salidas» de la gráfica, indicador de 30 días): las tres usan salidasVigentes().
import { test } from "node:test";
import assert from "node:assert/strict";
import { salidasVigentes, resumenInicio, contratoAnulado, type VentaPortal } from "../lib/portal/b2bPortal.ts";
import { actividadSemana } from "../components/portal/actividadSemana.ts";

// Jueves 2026-10-29: semana 26/10–01/11; ventana de 30 días hasta 2026-11-28.
const HOY = "2026-10-29";
const v = (n: string, estado: string | null, fecha: string, relacion: VentaPortal["relacion"] = "propio"): VentaPortal =>
  ({ numero_contrato: n, estado, fecha_salida: fecha, relacion });

const VENTAS = [
  v("A-1", "confirmado", "2026-10-30"),     // vigente, esta semana y próxima
  v("A-2", "pendiente", "2026-11-10"),      // vigente, dentro de 30 días
  v("A-3", "anulado", "2026-10-31"),        // anulado, esta semana
  v("A-4", "Cancelado", "2026-11-12"),      // cancelado (mayúscula), dentro de 30 días
  v("A-5", "ANULADA", "2026-11-15"),        // anulada, otra grafía
  v("A-6", "confirmado", "2026-12-20"),     // vigente pero fuera de 30 días
  v("A-7", "confirmado", "2026-11-05", "participacion"), // participación: nunca cuenta como salida propia
  v("A-8", null, "2026-11-06"),             // sin estado: no es anulado
];

test("contratoAnulado reconoce anulado/cancelado en cualquier grafía y no marca los demás", () => {
  for (const e of ["anulado", "Anulada", "ANULADO", "cancelado", "Cancelada"]) assert.equal(contratoAnulado({ estado: e }), true, e);
  for (const e of ["confirmado", "pendiente", "activo", "", null]) assert.equal(contratoAnulado({ estado: e }), false, String(e));
});

test("salidasVigentes: solo propios con fecha y sin anular", () => {
  assert.deepEqual(salidasVigentes(VENTAS).map((x) => x.numero_contrato), ["A-1", "A-2", "A-6", "A-8"]);
});

test("«Próximas salidas» (mismo filtro de la página) no incluye anulados ni cancelados", () => {
  const proximas = salidasVigentes(VENTAS).filter((x) => (x.fecha_salida as string) >= HOY).map((x) => x.numero_contrato);
  assert.deepEqual(proximas, ["A-1", "A-2", "A-6", "A-8"]);
  for (const n of ["A-3", "A-4", "A-5"]) assert.ok(!proximas.includes(n), n);
});

test("serie «Salidas» de la gráfica: el anulado de esta semana (A-3, 31/10) no suma", () => {
  const sem = actividadSemana({ hoy: HOY, salidas: salidasVigentes(VENTAS).map((x) => x.fecha_salida), pagos: [] });
  assert.equal(sem.dias.find((d) => d.iso === "2026-10-30")?.salidas, 1); // A-1
  assert.equal(sem.dias.find((d) => d.iso === "2026-10-31")?.salidas, 0); // A-3 anulado
  assert.equal(sem.total, 1);
});

test("indicador de 30 días aplica la misma regla: cuenta A-1, A-2 y A-8, no los anulados/cancelados ni la participación", () => {
  const r = resumenInicio({ ventas: VENTAS, cartera: [], cotizaciones: [], comisiones: [], hoy: HOY });
  assert.equal(r.salidasProximas, 3);
});

test("el indicador y «Próximas salidas» coinciden sobre el mismo conjunto (sin criterios distintos)", () => {
  const tope = "2026-11-28";
  const lista = salidasVigentes(VENTAS).filter((x) => (x.fecha_salida as string) >= HOY && (x.fecha_salida as string) <= tope);
  assert.equal(resumenInicio({ ventas: VENTAS, cartera: [], cotizaciones: [], comisiones: [], hoy: HOY }).salidasProximas, lista.length);
});
