// #65 — Actividad de la semana del inicio del portal B2B: semana lunes-domingo, solo cuenta fechas de la semana.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actividadSemana } from "../components/portal/actividadSemana.ts";

test("la semana va de lunes a domingo y cuenta salidas y pagos por día", () => {
  // 2026-10-29 es jueves → semana 26/10 a 01/11.
  const r = actividadSemana({
    hoy: "2026-10-29",
    salidas: ["2026-10-26", "2026-10-26", "2026-11-01", "2026-11-02", null],
    pagos: ["2026-10-29T15:00:00Z", "2026-10-25", undefined],
  });
  assert.deepEqual(r.dias.map((d) => d.iso), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  assert.equal(r.dias[0].salidas, 2);
  assert.equal(r.dias[6].salidas, 1);
  assert.equal(r.dias[3].pagos, 1);
  assert.equal(r.total, 4);
});

test("un domingo pertenece a la semana que termina ese día; sin datos el total es 0", () => {
  const r = actividadSemana({ hoy: "2026-11-01", salidas: [], pagos: [] });
  assert.equal(r.dias[0].iso, "2026-10-26");
  assert.equal(r.dias[6].iso, "2026-11-01");
  assert.equal(r.total, 0);
});
