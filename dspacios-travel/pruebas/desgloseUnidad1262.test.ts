// O-2 — desglose informativo adulto/menores de un alojamiento por unidad. El total sigue siendo el de la unidad.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { desgloseInformativoUnidad, type CargoMenorUnidad } from "../lib/reservar/cargosMenoresUnidad.ts";

const doble = (adultos = 2) => ({ acom: "doble", adultos });
const nino = (cargoVenta: number | null, cobro: CargoMenorUnidad["cobro"] = "por_noche", edad = 8): CargoMenorUnidad => ({ habitacion: 1, edad, clase: "nino", cobro, cargoVenta, noches: 3 });
const infante = (cobro: CargoMenorUnidad["cobro"] = "por_noche", cargoVenta: number | null = 0): CargoMenorUnidad => ({ habitacion: 1, edad: 2, clase: "infante", cobro, cargoVenta, noches: 3 });

describe("desgloseInformativoUnidad", () => {
  test("ejemplo del dueño: 2 adultos + niño de 8 (150.000 por 3 noches) + infante de 2 sin cargo = 750.000 → base 600.000, ≈ 300.000 por adulto", () => {
    const d = desgloseInformativoUnidad({ precioVenta: 750_000, ocupacion: [doble()], menores: [nino(150_000), infante()] })!;
    assert.equal(d.total, 750_000);
    assert.equal(d.baseUnidad, 600_000);
    assert.equal(d.cargosPropios, 150_000);
    assert.equal(d.menoresSinCargo, 1);
    assert.equal(d.adultos, 2);
    assert.equal(d.equivalentePorAdulto, 300_000);
    assert.equal(d.baseUnidad + d.cargosPropios, d.total, "las piezas suman el total: nada se cuenta dos veces");
  });
  test("solo adultos: base = total y equivalente = total ÷ adultos", () => {
    const d = desgloseInformativoUnidad({ precioVenta: 600_000, ocupacion: [doble()] })!;
    assert.deepEqual([d.baseUnidad, d.cargosPropios, d.menoresSinCargo, d.equivalentePorAdulto], [600_000, 0, 0, 300_000]);
  });
  test("menores incluidos en la unidad no restan ni suman: la base ya los contiene", () => {
    const d = desgloseInformativoUnidad({ precioVenta: 600_000, ocupacion: [doble()], menores: [nino(null, "incluido"), infante("incluido", null)] })!;
    assert.equal(d.baseUnidad, 600_000);
    assert.equal(d.menoresSinCargo, 2);
    assert.equal(d.equivalentePorAdulto, 300_000);
  });
  test("cargo por estadía y cargo por noche se suman igual (el importe ya es el total de la estadía)", () => {
    const d = desgloseInformativoUnidad({ precioVenta: 700_000, ocupacion: [doble()], menores: [nino(60_000, "por_estadia"), infante("por_noche", 40_000)] })!;
    assert.equal(d.cargosPropios, 100_000);
    assert.equal(d.baseUnidad, 600_000);
  });
  test("habitaciones con tarifas distintas: se muestra la base pero NO se reparte entre adultos", () => {
    const d = desgloseInformativoUnidad({ precioVenta: 900_000, ocupacion: [doble(), { acom: "sencilla", adultos: 1 }] })!;
    assert.equal(d.equivalentePorAdulto, null);
    assert.equal(d.sinEquivalente, "habitaciones_distintas");
    assert.equal(d.baseUnidad, 900_000);
  });
  test("dos habitaciones iguales sí: misma tarifa, equivalente por adulto sobre la base total", () => {
    const d = desgloseInformativoUnidad({ precioVenta: 1_200_000, ocupacion: [doble(), doble()] })!;
    assert.equal(d.equivalentePorAdulto, 300_000);
  });
  test("un menor que paga como adulto no tiene tarifa propia: no hay equivalente (no se inventa)", () => {
    const m: CargoMenorUnidad = { habitacion: 1, edad: 14, clase: "como_adulto", cobro: "como_adulto", cargoVenta: null, noches: 3 };
    const d = desgloseInformativoUnidad({ precioVenta: 900_000, ocupacion: [doble()], menores: [m] })!;
    assert.equal(d.equivalentePorAdulto, null);
    assert.equal(d.sinEquivalente, "menor_paga_como_adulto");
  });
  test("datos incoherentes o vacíos no producen números inventados", () => {
    assert.equal(desgloseInformativoUnidad({ precioVenta: 100_000, ocupacion: [doble()], menores: [nino(150_000)] }), null, "cargos > total");
    assert.equal(desgloseInformativoUnidad({ precioVenta: 0, ocupacion: [doble()] }), null);
    assert.equal(desgloseInformativoUnidad({ precioVenta: 500_000, ocupacion: [] }), null);
  });
  test("USD: el mismo cálculo con importes en dólares enteros", () => {
    const d = desgloseInformativoUnidad({ precioVenta: 750, ocupacion: [doble()], menores: [nino(150)] })!;
    assert.deepEqual([d.baseUnidad, d.equivalentePorAdulto], [600, 300]);
  });
});
