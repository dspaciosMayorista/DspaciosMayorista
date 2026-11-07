// #94/#52 — resumen de precios del cliente: cobertura total/parcial, tarifas distintas por tipo y habitación, ajuste de redondeo, varias unidades y
// aplicabilidad frente al acuerdo (modalidad, moneda, total). Lógica pura: no lee tarifas vigentes ni recalcula nada.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resumenUnidad, resumenCotizacion, resumenAplicable, type Cupo, type ServicioCobertura } from "../lib/cotizacion/resumenPrecios.ts";

const meta = { ref: "item-0", paquete: { id: 7, nombre: "Cartagena Esencial" }, hotel: "Hotel Almirante", categoria: "Estándar", regimen: "PC" };
const adultos = (n: number, base = 30_000_000): Cupo[] => Array.from({ length: n }, (_, i) => ({ id: `a${i + 1}`, tipo: "adulto" as const, baseCentavos: base }));
const total = (precio: number, id: string, nombre: string, cubre: "todos" | string[]): ServicioCobertura => ({ id, nombre, modo: "total", precioCentavos: precio * 100, cubre });
const ok = (r: ReturnType<typeof resumenUnidad>) => { assert.ok(r.ok, r.ok ? "" : r.error); return (r as Extract<typeof r, { ok: true }>).valor; };

describe("cobertura de 3 adultos, vuelo para 2 y tour para 2", () => {
  test("Caso A: los mismos pasajeros tienen vuelo y tour → dos grupos", () => {
    const u = ok(resumenUnidad({ ...meta, cupos: adultos(3), servicios: [total(1_200_000, "v", "Vuelo", ["a1", "a2"]), total(200_000, "t", "Tour", ["a1", "a2"])] }));
    assert.deepEqual(u.grupos.map((g) => [g.cantidad, g.tarifaCentavos / 100, g.subtotalCentavos / 100, g.incluye]), [[2, 1_000_000, 2_000_000, ["Vuelo", "Tour"]], [1, 300_000, 300_000, []]]);
    assert.equal(u.totalCentavos, 230_000_000);
    assert.equal(u.ajusteCentavos, 0);
  });
  test("Caso B: pasajeros distintos → tres grupos con su precio completo", () => {
    const u = ok(resumenUnidad({ ...meta, cupos: adultos(3), servicios: [total(1_200_000, "v", "Vuelo", ["a1", "a2"]), total(200_000, "t", "Tour", ["a2", "a3"])] }));
    assert.deepEqual(u.grupos.map((g) => [g.tarifaCentavos / 100, g.incluye]), [[1_000_000, ["Vuelo", "Tour"]], [900_000, ["Vuelo"]], [400_000, ["Tour"]]]);
    assert.equal(u.totalCentavos, 230_000_000);
  });
  test("cobertura total («todos»): un solo grupo", () => {
    const u = ok(resumenUnidad({ ...meta, cupos: adultos(3), servicios: [total(1_800_000, "v", "Vuelo", "todos")] }));
    assert.equal(u.grupos.length, 1);
    assert.equal(u.grupos[0].tarifaCentavos / 100, 900_000);
    assert.equal(u.totalCentavos, (3 * 300_000 + 1_800_000) * 100);
  });
  test("el id del cupo es la identidad: reordenar la lista no cambia a quién se cobra", () => {
    const servicios = [total(1_200_000, "v", "Vuelo", ["a1", "a2"])];
    const a = ok(resumenUnidad({ ...meta, cupos: adultos(3), servicios }));
    const b = ok(resumenUnidad({ ...meta, cupos: [...adultos(3)].reverse(), servicios }));
    assert.deepEqual(a.grupos.map((g) => [g.tarifaCentavos, g.cantidad]), b.grupos.map((g) => [g.tarifaCentavos, g.cantidad]));
    assert.deepEqual([...a.grupos.find((g) => g.incluye.length)!.cupos].sort(), ["a1", "a2"]);
  });
});

describe("tarifas distintas se conservan", () => {
  const cupos: Cupo[] = [
    { id: "a1", tipo: "adulto", baseCentavos: 50_000_000 }, // sencilla
    { id: "a2", tipo: "adulto", baseCentavos: 30_000_000 }, // doble
    { id: "a3", tipo: "adulto", baseCentavos: 30_000_000 },
    { id: "n1", tipo: "nino", baseCentavos: 15_000_000 },
    { id: "i1", tipo: "infante", baseCentavos: 0 },
  ];
  test("sin servicios: una fila por tarifa, la del infante en cero se conserva", () => {
    const u = ok(resumenUnidad({ ...meta, cupos, servicios: [] }));
    assert.deepEqual(u.grupos.map((g) => [g.tipo, g.cantidad, g.tarifaCentavos / 100]), [["adulto", 1, 500_000], ["adulto", 2, 300_000], ["nino", 1, 150_000], ["infante", 1, 0]]);
  });
  test("servicio con tarifas POR TIPO: cada pasajero paga la de su tipo, sin promedio", () => {
    const tour: ServicioCobertura = { id: "t", nombre: "Tour", modo: "por_tipo", tarifasCentavos: { adulto: 10_000_000, nino: 6_000_000 }, cubre: ["a2", "a3", "n1"] };
    const u = ok(resumenUnidad({ ...meta, cupos, servicios: [tour] }));
    const por = Object.fromEntries(u.grupos.map((g) => [`${g.tipo}${g.incluye.length}`, g.tarifaCentavos / 100]));
    assert.equal(por.adulto1, 400_000); // doble 300.000 + tour adulto 100.000
    assert.equal(por.adulto0, 500_000); // sencilla sin tour
    assert.equal(por.nino1, 210_000);  // niño 150.000 + tour niño 60.000
    assert.equal(u.totalCentavos, (500_000 + 2 * 400_000 + 210_000 + 0) * 100);
  });
  test("servicio por tipo sin tarifa para un tipo cubierto: se rechaza, no se asume gratis", () => {
    const r = resumenUnidad({ ...meta, cupos, servicios: [{ id: "t", nombre: "Tour", modo: "por_tipo", tarifasCentavos: { adulto: 1_000_000 }, cubre: ["n1"] }] });
    assert.equal(r.ok, false);
  });
  test("precio total que cubre adultos y un niño: se reparte por igual entre los cubiertos", () => {
    const u = ok(resumenUnidad({ ...meta, cupos, servicios: [total(300_000, "x", "Traslado", ["a2", "n1"])] }));
    assert.equal(u.grupos.find((g) => g.tipo === "nino")!.tarifaCentavos / 100, 150_000 + 150_000);
    assert.equal(u.grupos.find((g) => g.tipo === "adulto" && g.incluye.length)!.tarifaCentavos / 100, 300_000 + 150_000);
  });
});

describe("redondeo y validaciones", () => {
  test("el residuo menor a un centavo por pasajero sale como ajuste explícito y el total cuadra", () => {
    const u = ok(resumenUnidad({ ...meta, cupos: adultos(3, 0), servicios: [{ id: "v", nombre: "Vuelo", modo: "total", precioCentavos: 1000, cubre: "todos" }] }));
    assert.equal(u.grupos[0].tarifaCentavos, 333);
    assert.equal(u.ajusteCentavos, 1);
    assert.equal(u.totalCentavos, 1000);
  });
  test("servicio parcial sin cupos seleccionados o con un cupo inexistente: error explícito", () => {
    assert.equal(resumenUnidad({ ...meta, cupos: adultos(2), servicios: [total(100, "v", "Vuelo", [])] }).ok, false);
    assert.equal(resumenUnidad({ ...meta, cupos: adultos(2), servicios: [total(100, "v", "Vuelo", ["a9"])] }).ok, false);
    assert.equal(resumenUnidad({ ...meta, cupos: adultos(2), servicios: [total(100, "v", "Vuelo", ["a1", "a1"])] }).ok, false);
  });
  test("ids duplicados o importes no enteros se rechazan", () => {
    assert.equal(resumenUnidad({ ...meta, cupos: [...adultos(1), ...adultos(1)], servicios: [] }).ok, false);
    assert.equal(resumenUnidad({ ...meta, cupos: adultos(1, 10.5), servicios: [] }).ok, false);
  });
});

describe("varias unidades y aplicabilidad frente al acuerdo", () => {
  const u1 = ok(resumenUnidad({ ...meta, cupos: adultos(2), servicios: [] }));
  const u2 = ok(resumenUnidad({ ...meta, ref: "item-1", hotel: "Hotel Sol", cupos: adultos(1, 20_000_000), servicios: [total(100_000, "t", "Tour", "todos")] }));
  const r = resumenCotizacion({ modalidad: "pvp", moneda: "COP", unidades: [u1, u2] });
  test("el total general suma las unidades", () => assert.equal(r.totalCentavos, 60_000_000 + 20_000_000 + 10_000_000));
  test("aplica cuando modalidad, moneda y total coinciden", () => {
    assert.ok(resumenAplicable(JSON.parse(JSON.stringify(r)), { modalidad: "pvp", moneda: "COP", totalCentavos: r.totalCentavos }));
  });
  test("no aplica si cambió el total, la moneda o la modalidad (acuerdo corregido o NETO/PVP distinto)", () => {
    const a = { modalidad: "pvp" as const, moneda: "COP", totalCentavos: r.totalCentavos };
    assert.equal(resumenAplicable(r, { ...a, totalCentavos: a.totalCentavos + 100 }), null);
    assert.equal(resumenAplicable(r, { ...a, moneda: "USD" }), null);
    assert.equal(resumenAplicable(r, { ...a, modalidad: "neto" }), null);
  });
  test("no aplica si el JSON fue alterado (tarifa que ya no multiplica a su subtotal, o filas que no suman)", () => {
    const a = { modalidad: "pvp" as const, moneda: "COP", totalCentavos: r.totalCentavos };
    const alterado = JSON.parse(JSON.stringify(r));
    alterado.unidades[0].grupos[0].tarifaCentavos += 1;
    assert.equal(resumenAplicable(alterado, a), null);
    assert.equal(resumenAplicable({ version: 2 }, a), null);
    assert.equal(resumenAplicable(null, a), null);
  });
});
