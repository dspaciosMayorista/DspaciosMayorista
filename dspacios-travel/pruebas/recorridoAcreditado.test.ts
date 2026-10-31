import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { crearClienteFalso } from "./support/fakeSupabase.ts";
import { horasAcreditadasDelRecorrido } from "../lib/reservar/horasRecorrido.ts";

const tablas = {
  armado_vuelos: [{ paquete_id: 9, bloqueo_id: 5 }, { paquete_id: 8, bloqueo_id: 6 }],
  bloqueos_vuelo: [
    { id: 5, fecha_ida: "2026-12-10", fecha_regreso: "2026-12-14", hora_llegada_ida: "21:30:00", hora_salida_reg: "06:15:00" },
    { id: 6, fecha_ida: "2026-12-10", fecha_regreso: "2026-12-14", hora_llegada_ida: "08:00:00", hora_salida_reg: "09:00:00" },
  ],
  salidas_dinamicas: [
    { id: 70, paquete_id: 9, fecha_ida: "2026-12-10", fecha_regreso: "2026-12-14", hora_llegada_ida: "22:05", hora_salida_reg: "05:40" },
    { id: 71, paquete_id: 8, fecha_ida: "2026-12-10", fecha_regreso: "2026-12-14", hora_llegada_ida: "10:00", hora_salida_reg: "11:00" },
  ],
};
const admin = () => crearClienteFalso(tablas) as unknown as Parameters<typeof horasAcreditadasDelRecorrido>[0];
const F = { fechaIda: "2026-12-10", fechaRegreso: "2026-12-14" };

describe("bloqueo", () => {
  test("ID válido del paquete y de las fechas consultadas: devuelve sus horas", async () => {
    const r = await horasAcreditadasDelRecorrido(admin(), { paqueteId: 9, recorrido: { modulo: "bloqueo", bloqueoId: 5 }, ...F });
    assert.deepEqual(r, { ok: true, horas: { llegada: "21:30", salida: "06:15" } });
  });
  test("ID existente pero de OTRO paquete: falla y no devuelve horas", async () => {
    const r = await horasAcreditadasDelRecorrido(admin(), { paqueteId: 9, recorrido: { modulo: "bloqueo", bloqueoId: 6 }, ...F });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "no_corresponde");
    assert.equal("horas" in r, false);
  });
  test("ID inexistente: falla", async () => {
    const r = await horasAcreditadasDelRecorrido(admin(), { paqueteId: 9, recorrido: { modulo: "bloqueo", bloqueoId: 999 }, ...F });
    assert.equal(!r.ok && r.motivo, "no_corresponde");
  });
  test("del paquete pero de OTRAS fechas (otra opción): falla", async () => {
    const r = await horasAcreditadasDelRecorrido(admin(), { paqueteId: 9, recorrido: { modulo: "bloqueo", bloqueoId: 5 }, fechaIda: "2026-12-11", fechaRegreso: "2026-12-15" });
    assert.equal(!r.ok && r.motivo, "no_corresponde");
  });
});

describe("salida dinámica", () => {
  test("ID válido del paquete y fechas: devuelve sus horas", async () => {
    const r = await horasAcreditadasDelRecorrido(admin(), { paqueteId: 9, recorrido: { modulo: "dinamico", salidaId: 70 }, ...F });
    assert.deepEqual(r, { ok: true, horas: { llegada: "22:05", salida: "05:40" } });
  });
  test("salida de OTRO paquete: falla", async () => {
    const r = await horasAcreditadasDelRecorrido(admin(), { paqueteId: 9, recorrido: { modulo: "dinamico", salidaId: 71 }, ...F });
    assert.equal(!r.ok && r.motivo, "no_corresponde");
  });
  test("salida inexistente: falla", async () => {
    const r = await horasAcreditadasDelRecorrido(admin(), { paqueteId: 9, recorrido: { modulo: "dinamico", salidaId: 999 }, ...F });
    assert.equal(!r.ok && r.motivo, "no_corresponde");
  });
});

test("un error de lectura se informa como tal (no como «no corresponde»)", async () => {
  const roto = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }), maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }) }) };
  const r = await horasAcreditadasDelRecorrido(roto as never, { paqueteId: 9, recorrido: { modulo: "bloqueo", bloqueoId: 5 }, ...F });
  assert.equal(!r.ok && r.motivo, "lectura");
});

describe("cableado", () => {
  const cotizar = readFileSync(new URL("../lib/reservar/cotizar.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const checkout = readFileSync(new URL("../app/tarifario/checkout/actions.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  test("buscarReceptivos acredita el recorrido con el paquete y las fechas consultados y ya no usa horasDelRecorrido a ciegas", () => {
    assert.match(cotizar, /horasAcreditadasDelRecorrido\(createAdminClient\(\), \{\s*paqueteId: vPaquete\.paqueteId, fechaIda: vRango\.fechaIda, fechaRegreso: vRango\.fechaRegreso/);
    assert.equal(/horasDelRecorrido\(/.test(cotizar), false);
    assert.match(cotizar, /if \(vPaquete\.paqueteId == null\) return \{ ok: false/);
  });
  test("el checkout conserva su validación final desde el ítem del carrito", () => {
    assert.match(checkout, /horasDelRecorrido\(adminHoras, \{ modulo: it\.modulo, bloqueoId: it\.bloqueoId, salidaId: it\.salidaId \}\)/);
  });
});
