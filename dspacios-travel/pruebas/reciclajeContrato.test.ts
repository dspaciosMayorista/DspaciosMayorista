import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { esNumeroReciclable } from "../lib/contrato/reciclaje.ts";

// Migración 159: un contrato DTM- (mayorista) nunca debe ofrecer/permitir
// reciclar su consecutivo — usa una secuencia dedicada que nunca lee de
// numeros_contrato_liberados. Minorista (MIN-...) conserva su
// comportamiento actual sin cambios.
describe("esNumeroReciclable — migración 159", () => {
  test("un contrato DTM- NO es reciclable", () => {
    assert.equal(esNumeroReciclable("DTM-0001"), false);
    assert.equal(esNumeroReciclable("DTM-9999"), false);
  });

  test("un contrato minorista (MIN-...) SÍ es reciclable, sin cambios", () => {
    assert.equal(esNumeroReciclable("MIN-00-0533"), true);
    assert.equal(esNumeroReciclable("MIN-ABC123"), true);
  });

  test("un contrato mayorista histórico crudo (00-NNNN, previo a la 159) SÍ es reciclable", () => {
    assert.equal(esNumeroReciclable("00-0482"), true);
  });

  test("es sensible a mayúsculas en el prefijo (el formato real siempre es DTM- en mayúscula)", () => {
    assert.equal(esNumeroReciclable("dtm-0001"), true);
  });
});
