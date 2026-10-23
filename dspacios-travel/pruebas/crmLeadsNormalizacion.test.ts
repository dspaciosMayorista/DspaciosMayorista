import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarDocumentoLead,
  normalizarEmailLead,
  normalizarTelefonoLead,
} from "../lib/crm/leads.ts";

describe("CRM leads: normalizacion", () => {
  test("telefono colombiano de 10 digitos se guarda con prefijo 57", () => {
    assert.equal(normalizarTelefonoLead("300 123 4567"), "573001234567");
  });

  test("telefono con +57 conserva el mismo valor normalizado", () => {
    assert.equal(normalizarTelefonoLead("+57 300 123 4567"), "573001234567");
  });

  test("email se compara con trim y lower", () => {
    assert.equal(normalizarEmailLead("  ANA@DSPACIOS.COM  "), "ana@dspacios.com");
  });

  test("documento elimina signos y compara en minusculas", () => {
    assert.equal(normalizarDocumentoLead(" NIT 900.123-4 "), "nit9001234");
  });

  test("valores vacios normalizan a null", () => {
    assert.equal(normalizarTelefonoLead(" -- "), null);
    assert.equal(normalizarEmailLead(" "), null);
    assert.equal(normalizarDocumentoLead("."), null);
  });
});
