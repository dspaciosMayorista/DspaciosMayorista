// #103 R2-5 — pure decision of the automatic regeneration recovery (no network, no SQL).
import { test } from "node:test";
import assert from "node:assert/strict";
import { clasificarPendientes, debeReanudarSolo, GRACIA_AUTO_REANUDAR_MS, type FilaPendiente } from "../lib/tarifario/pendientes.ts";

const AHORA = 1_000_000_000_000;
const fila = (p: Partial<FilaPendiente>): FilaPendiente => ({ id: 1, estado: "pendiente", revisionFuente: 5, revisionPublicada: 3, ultimoCambioMs: AHORA - 10 * 60_000, ...p });
const decide = (filas: FilaPendiente[]) => debeReanudarSolo(clasificarPendientes(filas, AHORA));

test("R2-5 an old debt with nothing alive resumes by itself; a young one, a live computation, an up-to-date package and a `fallido`-only debt do not", () => {
  assert.equal(decide([fila({})]), true);
  assert.equal(decide([fila({ ultimoCambioMs: AHORA - (GRACIA_AUTO_REANUDAR_MS - 1000) })]), false, "younger than the grace: the deferred run owns it");
  assert.equal(decide([fila({ ultimoCambioMs: AHORA - GRACIA_AUTO_REANUDAR_MS })]), true, "exactly at the grace");
  assert.equal(decide([fila({}), fila({ id: 2, estado: "recalculando", ultimoCambioMs: AHORA - 5000 })]), false, "one live computation holds everything back");
  assert.equal(decide([fila({ revisionFuente: 3 })]), false, "nothing owed");
  assert.equal(decide([fila({ estado: "fallido" })]), false, "a failing computation is left to a person");
  assert.equal(decide([fila({ estado: "fallido" }), fila({ id: 2 })]), true, "the rest is still resumed");
});

test("R2-5 a debt with UNKNOWN change time counts as old (found by the compiled-app walkthrough), never as young", () => {
  assert.equal(decide([fila({ ultimoCambioMs: null })]), true);
  const c = clasificarPendientes([fila({ ultimoCambioMs: null })], AHORA);
  assert.equal(c.masAntiguaMs, Number.POSITIVE_INFINITY);
  assert.equal(decide([fila({ ultimoCambioMs: null, estado: "recalculando" })]), true, "`recalculando` with no known change time is not trusted as alive");
});
