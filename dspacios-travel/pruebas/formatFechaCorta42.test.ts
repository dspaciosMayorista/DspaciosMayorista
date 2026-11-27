// #42 — fecha corta para tablas angostas: «1 dic 2026», sin corrimiento de zona horaria. Valores a mano.
import test from "node:test";
import assert from "node:assert/strict";
import { formatFechaCorta } from "../lib/utils.ts";

test("formatFechaCorta: día sin cero, mes abreviado en español, año; sin Date (no se corre un día)", () => {
  assert.equal(formatFechaCorta("2026-12-01"), "1 dic 2026");
  assert.equal(formatFechaCorta("2027-01-31"), "31 ene 2027");
  assert.equal(formatFechaCorta("2027-02-01T00:00:00+00:00"), "1 feb 2027");
});
test("formatFechaCorta: vacío o inválido → «—»", () => {
  for (const v of [null, undefined, "", "01/02/2027", "xx"]) assert.equal(formatFechaCorta(v), "—");
});
