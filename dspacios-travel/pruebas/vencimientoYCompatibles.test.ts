// Fechas de negocio (America/Bogota) con RELOJ FIJO:
//  - Vencimiento de reservas (liberarVencidas): un plazo de hoy no se libera
//    hoy, ni siquiera desde las 7 p. m., cuando la fecha UTC ya es mañana.
//  - Records destino de "Mover"/"Trasladar": ayer no se ofrece; hoy y mañana sí.
// Más guardas de cableado: liberarVencidas usa la fecha de negocio y la RPC
// atómica; la página del record usa el filtro puro.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fechaCorteVencimiento, plazoVencido } from "../lib/reservar/vencimiento.ts";
import { filtrarCompatibles, describirDestinos, vueloNoSalido, type RecordVuelo } from "../lib/vuelos/compatibles.ts";

// 1 de octubre de 2026 en Bogotá (UTC−5, sin horario de verano).
const A_LAS_18_59 = new Date("2026-10-01T23:59:00Z");   // 6:59 p. m. Bogotá
const A_LAS_19_00 = new Date("2026-10-02T00:00:00Z");   // 7:00 p. m. Bogotá — la fecha UTC ya es el 2
const A_LAS_23_59 = new Date("2026-10-02T04:59:59Z");   // 11:59 p. m. Bogotá
const MEDIANOCHE = new Date("2026-10-02T05:00:00Z");    // 12:00 a. m. del 2 en Bogotá

describe("vencimiento de reservas (liberarVencidas)", () => {
  test("6:59 p. m. y 7:00 p. m. de Bogotá siguen siendo el mismo día de corte", () => {
    assert.equal(fechaCorteVencimiento(A_LAS_18_59), "2026-10-01");
    assert.equal(fechaCorteVencimiento(A_LAS_19_00), "2026-10-01", "a las 7 p. m. la fecha UTC ya es 2026-10-02: no se usa");
    assert.equal(A_LAS_19_00.toISOString().slice(0, 10), "2026-10-02", "esto era lo que usaba el código anterior");
    assert.equal(fechaCorteVencimiento(A_LAS_23_59), "2026-10-01");
    assert.equal(fechaCorteVencimiento(MEDIANOCHE), "2026-10-02");
  });
  test("un plazo de HOY no vence hoy a ninguna hora; el de ayer sí; vence al día siguiente", () => {
    for (const instante of [A_LAS_18_59, A_LAS_19_00, A_LAS_23_59]) {
      const corte = fechaCorteVencimiento(instante);
      assert.equal(plazoVencido("2026-10-01", corte), false, `plazo de hoy a las ${instante.toISOString()}`);
      assert.equal(plazoVencido("2026-09-30", corte), true);
      assert.equal(plazoVencido("2026-10-02", corte), false);
    }
    assert.equal(plazoVencido("2026-10-01", fechaCorteVencimiento(MEDIANOCHE)), true);
    assert.equal(plazoVencido(null, "2026-10-01"), false);
  });
  test("liberarVencidas usa la fecha de negocio y la RPC atómica (sin UPDATE directo ni toISOString)", () => {
    const src = readFileSync(new URL("../lib/reservar/liberarVencidas.ts", import.meta.url), "utf8");
    assert.match(src, /admin\.rpc\("liberar_vencidas", \{ p_hoy: fechaCorteVencimiento\(instante\) \}\)/);
    assert.doesNotMatch(src, /toISOString/);
    assert.doesNotMatch(src, /from\("sillas"\)|from\("ventas"\)/, "ya no escribe sillas ni ventas directamente");
  });
});

describe("records destino compatibles (Mover / Trasladar)", () => {
  const origen: RecordVuelo = { id: 1, record: "Y", fecha_ida: "2026-10-10", fecha_regreso: "2026-10-14", destino_id: 7, proveedor_id: 8, tarifa_neta: 400000 };
  const rec = (id: number, fecha: string, extra: Partial<RecordVuelo> = {}): RecordVuelo =>
    ({ id, record: `R${id}`, fecha_ida: fecha, fecha_regreso: null, destino_id: 7, proveedor_id: 8, tarifa_neta: 400000, ...extra });
  const otros = [
    rec(2, "2026-09-30"),   // ayer
    rec(3, "2026-10-01"),   // hoy
    rec(4, "2026-10-02"),   // mañana
    rec(5, "2026-10-02", { destino_id: 9 }),
    rec(6, "2026-10-02", { proveedor_id: 10 }),
    rec(7, "2026-10-02", { fecha_ida: null }),
    rec(1, "2026-10-10"),   // el mismo record
  ];
  for (const [nombre, instante] of [["6:59 p. m.", A_LAS_18_59], ["7:00 p. m.", A_LAS_19_00], ["11:59 p. m.", A_LAS_23_59]] as const) {
    test(`a las ${nombre} de Bogotá del 1-oct: ayer fuera; hoy y mañana dentro`, () => {
      assert.deepEqual(filtrarCompatibles(origen, otros, instante).map((o) => o.id), [3, 4]);
    });
  }
  test("a medianoche (ya es 2-oct en Bogotá) el record de 'hoy' (1-oct) también sale", () => {
    assert.deepEqual(filtrarCompatibles(origen, otros, MEDIANOCHE).map((o) => o.id), [4]);
  });
  test("vueloNoSalido y la descripción (tarifa distinta, mismas fechas)", () => {
    assert.equal(vueloNoSalido("2026-10-01", A_LAS_19_00), true);
    assert.equal(vueloNoSalido("2026-09-30", A_LAS_19_00), false);
    assert.equal(vueloNoSalido(null, A_LAS_19_00), false);
    const d = describirDestinos(origen, [rec(3, "2026-10-10", { fecha_regreso: "2026-10-14", tarifa_neta: "450000" })], new Map([[3, 2]]));
    assert.deepEqual(d, [{ id: 3, record: "R3", fecha_ida: "2026-10-10", libres: 2, tarifaDistinta: true, mismasFechas: true }]);
  });
  test("la página del record ofrece solo los compatibles del filtro puro (fecha de Bogotá)", () => {
    const page = readFileSync(new URL("../app/(dashboard)/dashboard/vuelos/[id]/page.tsx", import.meta.url), "utf8");
    assert.match(page, /const compatibles = filtrarCompatibles\(b, otros \?\? \[\]\);/);
    assert.match(page, /const destinosCompatibles = describirDestinos\(b, compatibles, libresPorRecord\);/);
    assert.doesNotMatch(page, /toLocaleDateString|toISOString/, "sin fechas calculadas a mano en la página");
  });
});
