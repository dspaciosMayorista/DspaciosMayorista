// #13 / B3-3 — Repetición de la pasada diaria con tope y con garantía de avance. La llamada a base se inyecta (la prueba real con 499/500/501/505 ventanas está en bloque3_11_13_36.pg.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MAX_PASADAS_COMPRA, generarAvisosCompraCon } from "../lib/avisos/generarCompra.ts";

const pasada = (creados: number, archivados: number, pendientes: number) => ({ data: { hoy: "2026-11-25", dias: 5, ventanas: 505, creados, archivados, pendientes, truncado: pendientes > 0 }, error: null });
const guion = (...r: ReturnType<typeof pasada>[]) => { let i = 0; const llamadas = { n: 0 }; return { llamar: async () => { llamadas.n++; return r[Math.min(i++, r.length - 1)]; }, llamadas }; };

describe("generarAvisosCompraCon", () => {
  test("repite mientras haya pendientes y la pasada avance; suma lo hecho y devuelve el estado de la última", async () => {
    const g = guion(pasada(500, 0, 2025), pasada(500, 0, 1525), pasada(500, 0, 1025), pasada(500, 0, 525), pasada(500, 0, 25), pasada(25, 0, 0));
    const r = await generarAvisosCompraCon(g.llamar);
    assert.deepEqual(r.ok && [r.pasadas, r.creados, r.archivados, r.pendientes, r.truncado], [6, 2025 + 500, 0, 0, false]); assert.equal(g.llamadas.n, 6);
  });
  test("sin pendientes: una sola pasada", async () => {
    const g = guion(pasada(30, 0, 0)); const r = await generarAvisosCompraCon(g.llamar); assert.deepEqual(r.ok && [r.pasadas, r.truncado], [1, false]); assert.equal(g.llamadas.n, 1);
  });
  test("una pasada sin avance (pendientes pero 0 creados y 0 archivados) CORTA el ciclo: no hay bucle y se informa lo pendiente", async () => {
    const g = guion(pasada(0, 0, 40)); const r = await generarAvisosCompraCon(g.llamar);
    assert.deepEqual(r.ok && [r.pasadas, r.pendientes, r.truncado], [1, 40, true]); assert.equal(g.llamadas.n, 1);
  });
  test("tope de pasadas: nunca más de MAX_PASADAS_COMPRA por ejecución aunque siempre quede algo (acotado)", async () => {
    const g = guion(pasada(500, 0, 99999)); const r = await generarAvisosCompraCon(g.llamar);
    assert.equal(MAX_PASADAS_COMPRA, 20); assert.deepEqual(r.ok && [r.pasadas, r.creados, r.truncado], [20, 10000, true]); assert.equal(g.llamadas.n, 20);
    const g2 = guion(pasada(500, 0, 99999)); const r2 = await generarAvisosCompraCon(g2.llamar, 3); assert.equal(r2.ok && r2.pasadas, 3);
  });
  test("el archivo cuenta como avance (solo obsoletos pendientes) y un error de la base se devuelve sin seguir", async () => {
    const g = guion(pasada(0, 500, 230), pasada(0, 230, 0)); const r = await generarAvisosCompraCon(g.llamar); assert.deepEqual(r.ok && [r.pasadas, r.archivados, r.truncado], [2, 730, false]);
    let n = 0; const e = await generarAvisosCompraCon(async () => { n++; return n === 1 ? pasada(500, 0, 5) : { data: null, error: { message: "boom" } }; });
    assert.deepEqual(e, { ok: false, error: "boom" });
  });
});
