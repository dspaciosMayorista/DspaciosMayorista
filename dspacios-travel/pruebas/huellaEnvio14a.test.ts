// #14-A — huella del contenido de un envío: determinista, insensible al orden de las claves, sensible a cualquier cambio de contenido, ajena a `vistos` y a la propia clave.
import { test } from "node:test";
import assert from "node:assert/strict";
import { huellaDeEnvio } from "../lib/cotizacion/huellaEnvio.ts";

const base = { items: [{ hotelId: 1, pax: 2 }], cliente: { nombres: "Ana", numeroDoc: "123" }, recobro: { total: 100000 } };

test("64 hex, determinista y sin importar el orden de las claves", () => {
  const h = huellaDeEnvio(base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, huellaDeEnvio(structuredClone(base)));
  assert.equal(h, huellaDeEnvio({ recobro: { total: 100000 }, cliente: { numeroDoc: "123", nombres: "Ana" }, items: [{ pax: 2, hotelId: 1 }] }));
});
test("cualquier cambio de contenido cambia la huella (otra compra ≠ misma intención)", () => {
  const h = huellaDeEnvio(base);
  for (const cambio of [{ ...base, recobro: { total: 100001 } }, { ...base, cliente: { nombres: "Luis", numeroDoc: "123" } }, { ...base, items: [{ hotelId: 2, pax: 2 }] }, { ...base, items: [{ hotelId: 1, pax: 3 }] }]) assert.notEqual(huellaDeEnvio(cambio), h);
  assert.notEqual(huellaDeEnvio({ ...base, items: [{ hotelId: 1, pax: 2 }, { hotelId: 2, pax: 2 }] }), h);
});
test("no cuentan los vistos ni la propia clave (a cualquier profundidad)", () => {
  const h = huellaDeEnvio(base);
  assert.equal(h, huellaDeEnvio({ ...base, vistos: { comision: 1 }, claveEnvio: "x", asistencia: undefined }));
  assert.equal(huellaDeEnvio({ ...base, asistencia: { aliadoId: 7, modo: "neta" } }), huellaDeEnvio({ ...base, asistencia: { aliadoId: 7, modo: "neta", vistos: { total: 9 } } }));
  assert.notEqual(huellaDeEnvio({ ...base, asistencia: { aliadoId: 7, modo: "neta" } }), huellaDeEnvio({ ...base, asistencia: { aliadoId: 8, modo: "neta" } }));
});
