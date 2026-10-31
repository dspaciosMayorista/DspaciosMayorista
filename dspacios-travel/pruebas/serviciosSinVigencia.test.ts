import { test } from "node:test";
import assert from "node:assert/strict";
import { serviciosSinVigencia } from "../lib/tarifario/serviciosSinVigencia.ts";

const v = (a: string | null, b: string | null) => ({ fecha_inicio: a, fecha_fin: b });
test("lista los servicios sin vigencia, con fechas vacías o invertidas", () => {
  const s = [{ id: 1, nombre: "A" }, { id: 2, nombre: "B" }, { id: 3, nombre: "C" }, { id: 4, nombre: "D" }];
  const r = serviciosSinVigencia(s, { 1: [v("2026-01-01", "2026-12-31")], 2: [], 3: [v(null, null)], 4: [v("2026-05-02", "2026-05-01")] });
  assert.deepEqual(r.map((x) => x.id), [2, 3, 4]);
});
test("asistencia sin ninguna vigencia usa su base permanente y no se lista; con vigencia inválida sí", () => {
  const s = [{ id: 1, nombre: "As", categoria: "asistencia" }, { id: 2, nombre: "As2", categoria: "asistencia" }];
  assert.deepEqual(serviciosSinVigencia(s, { 2: [v(null, null)] }).map((x) => x.id), [2]);
});
