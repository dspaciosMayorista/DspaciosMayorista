import { test } from "node:test";
import assert from "node:assert/strict";
import { galeriaPorHotel } from "../lib/tarifario/fotosHotel.ts";

const f = (hotel_id: number, n: number, es_portada = false, orden = n) => ({ hotel_id, url: `u${hotel_id}-${n}`, es_portada, orden, id: n });

test("18 fotos: todas, sin repetir", () => {
  const g = galeriaPorHotel(Array.from({ length: 18 }, (_, i) => f(1, i + 1)));
  assert.equal(g[1].length, 18);
  assert.equal(new Set(g[1]).size, 18);
});

test("portada en medio va primero; el resto conserva su orden", () => {
  const g = galeriaPorHotel([f(1, 1), f(1, 2), f(1, 3, true), f(1, 4)]);
  assert.deepEqual(g[1], ["u1-3", "u1-1", "u1-2", "u1-4"]);
});

test("sin portada marcada: abre la primera por orden; empates por id", () => {
  const g = galeriaPorHotel([{ ...f(1, 2), orden: 0 }, { ...f(1, 1), orden: 0 }]);
  assert.deepEqual(g[1], ["u1-1", "u1-2"]);
});

test("URL duplicada se colapsa y hoteles no se mezclan", () => {
  const g = galeriaPorHotel([f(1, 1), { ...f(1, 2), url: "u1-1" }, f(2, 1)]);
  assert.deepEqual(g[1], ["u1-1"]);
  assert.deepEqual(g[2], ["u2-1"]);
});

test("hotel sin fotos no aparece", () => {
  assert.deepEqual(galeriaPorHotel([]), {});
});

test("leerFotosHotel pagina: 2.500 fotos con tope de 1.000 por respuesta llegan completas", async () => {
  const { leerFotosHotel } = await import("../lib/tarifario/fotosHotel.ts");
  const todas = Array.from({ length: 2500 }, (_, i) => f(Math.floor(i / 18) + 1, i + 1));
  const sb = { from: () => {
    let d = 0, h = 0;
    const q = { select: () => q, in: () => q, order: () => q, range: (a: number, b: number) => { d = a; h = Math.min(b, d + 999); return q; },
      then: (ok: (v: unknown) => void) => ok({ data: todas.slice(d, h + 1), error: null }) };
    return q;
  } };
  const r = await leerFotosHotel(sb as never, [1]);
  assert.equal(r.error, null);
  assert.equal(r.data.length, 2500);
});
