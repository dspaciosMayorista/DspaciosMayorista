import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { identidadDe, parseIdentidad, unirIdentidades, cabecerasIdentidad, uidDeclarado, esErrorIdentidad, mensajeSiIdentidad, MENSAJE_IDENTIDAD, CABECERA_IDENTIDAD, IDENTIDAD_VACIA } from "../lib/contrato/identidad.ts";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("identidad del contrato (#75): módulo puro", () => {
  test("identidadDe: par válido, o vacía si falta número o uid inválido", () => {
    assert.deepEqual({ ...identidadDe("DTM-0042", U1) }, { "DTM-0042": U1 });
    assert.deepEqual({ ...identidadDe("DTM-0042", "no-es-uuid") }, {});
    assert.deepEqual({ ...identidadDe("", U1) }, {});
    assert.deepEqual({ ...identidadDe("DTM-0042", null) }, {});
    assert.equal(identidadDe("DTM-0042", U1.toUpperCase())["DTM-0042"], U1);
  });
  test("parseIdentidad: entrada del navegador, nunca lanza y descarta lo inválido", () => {
    assert.deepEqual({ ...parseIdentidad({ "DTM-1": U1, "DTM-2": "x", "": U2 }) }, { "DTM-1": U1 });
    for (const malo of [undefined, null, 5, "texto", [U1], true]) assert.deepEqual({ ...parseIdentidad(malo) }, {});
  });
  test("unirIdentidades: une varios contratos; ante el mismo número gana el primero", () => {
    assert.deepEqual({ ...unirIdentidades(identidadDe("A", U1), identidadDe("B", U2)) }, { A: U1, B: U2 });
    assert.deepEqual({ ...unirIdentidades(identidadDe("A", U1), identidadDe("A", U2)) }, { A: U1 });
    assert.deepEqual({ ...unirIdentidades(undefined, null) }, {});
  });
  test("cabecerasIdentidad: {} sin identidad; JSON del mapa en x-contratos", () => {
    assert.deepEqual(cabecerasIdentidad(IDENTIDAD_VACIA), {});
    assert.deepEqual(cabecerasIdentidad(undefined), {});
    const h = cabecerasIdentidad(identidadDe("DTM-1", U1));
    assert.deepEqual(JSON.parse(h[CABECERA_IDENTIDAD]), { "DTM-1": U1 });
  });
  test("uidDeclarado", () => {
    assert.equal(uidDeclarado(identidadDe("A", U1), "A"), U1);
    assert.equal(uidDeclarado(identidadDe("A", U1), "B"), null);
    assert.equal(uidDeclarado(undefined, "A"), null);
  });
  test("esErrorIdentidad / mensajeSiIdentidad: por SQLSTATE o por código en el mensaje; otros errores no", () => {
    assert.ok(esErrorIdentidad({ code: "F4601", message: "x" }));
    assert.ok(esErrorIdentidad({ code: "F4602" }));
    assert.ok(esErrorIdentidad({ code: "F4521" }));
    assert.ok(esErrorIdentidad({ message: "ERROR: CONTRATO_CAMBIO: el contrato…" }));
    assert.ok(esErrorIdentidad("IDENTIDAD_REQUERIDA: …"));
    assert.ok(esErrorIdentidad({ message: "SOPORTE_IDENTIDAD: …" }));
    assert.ok(!esErrorIdentidad({ code: "23505", message: "duplicate key" }));
    assert.ok(!esErrorIdentidad(null));
    assert.equal(mensajeSiIdentidad({ code: "F4601" }), MENSAJE_IDENTIDAD);
    assert.equal(mensajeSiIdentidad({ message: "otro" }), null);
  });
});
