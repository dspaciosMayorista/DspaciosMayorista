// Vista explicativa de promociones dinámicas por grupo («Tarifas generadas»): misma cuenta que el motor, solo lectura.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { textoDescuento } from "../lib/hoteles/tarifasVista.ts";
import { promocionesDinamicasHotel, type VigenciaPromoFicha, type FilaTarifaFicha } from "../lib/hoteles/promocionesDinamicas.ts";

const SEMANA = "00000000-0000-4000-8000-0000000c0901", FINDE = "00000000-0000-4000-8000-0000000c0902";
const ALTA: VigenciaPromoFicha = { id: 1, nombre: "ALTA", tipo: "tarifa", prioridad: 1, descuento_valor: null, regimen_restringido: null,
  hotel_temporada_grupos: [{ id: SEMANA, nombre: "Semana", dias: [1, 2, 3, 4], activo: true }, { id: FINDE, nombre: "Fin de semana", dias: [5, 6, 7], activo: true }] };
const promo = (o: Partial<VigenciaPromoFicha> = {}): VigenciaPromoFicha => ({ id: 2, nombre: "Promo", tipo: "descuento_pct", prioridad: 2, descuento_valor: 10,
  regimen_restringido: null, promo_base_id: 1, hotel_promocion_reglas: [{ grupo_id: SEMANA, valor: 10, dias: null }], hotel_promocion_combinacion: null, ...o });
const fila = (grupo: string, doble: number, o: Partial<FilaTarifaFicha> = {}): FilaTarifaFicha => ({ temporada: "ALTA", grupo_id: grupo, tipo_habitacion: "Estándar", alimentacion: "PAM", neto_doble: doble, ...o });

describe("promociones dinámicas por grupo", () => {
  test("ALTA · Semana · Doble: 100.000 − 10 % = 90.000; el Fin de semana sin regla no aparece", () => {
    const [p] = promocionesDinamicasHotel([ALTA, promo()], [fila(SEMANA, 100_000), fila(FINDE, 150_000)], []);
    assert.equal(p.estado, "vende");
    assert.deepEqual(p.lineas.map((l) => [l.base, l.grupo, l.categoria, l.regimen, l.acomodacion, l.netoBase, l.valor, l.netoResultante]),
      [["ALTA", "Semana", "Estándar", "PAM", "Doble", 100_000, 10, 90_000]]);
  });
  test("cambiar la base a 120.000 da 108.000 (se recalcula de la fila base; no hay fila promocional)", () => {
    const [p] = promocionesDinamicasHotel([ALTA, promo()], [fila(SEMANA, 120_000)], []);
    assert.equal(p.lineas[0].netoResultante, 108_000);
  });
  test("solo las filas de SU base: otra vigencia o una promoción materializada no entran", () => {
    const [p] = promocionesDinamicasHotel([ALTA, promo()], [fila(SEMANA, 100_000), fila(SEMANA, 999, { temporada: "MEDIA" }), fila(SEMANA, 80_000, { temporada: "Promo" })], []);
    assert.equal(p.lineas.length, 1);
  });
  test("régimen restringido: solo ese régimen", () => {
    const [p] = promocionesDinamicasHotel([ALTA, promo({ regimen_restringido: "PC" })], [fila(SEMANA, 100_000), fila(SEMANA, 90_000, { alimentacion: "PC" })], []);
    assert.deepEqual(p.lineas.map((l) => l.regimen), ["PC"]);
  });
  test("monto por habitación y noche: sobre la habitación completa (pax_tarifa); niño no es habitación", () => {
    const p = promocionesDinamicasHotel([ALTA, promo({ tipo: "descuento_monto", descuento_unidad: "habitacion_noche", hotel_promocion_reglas: [{ grupo_id: SEMANA, valor: 20_000, dias: null }] })],
      [fila(SEMANA, 100_000, { neto_nino: 40_000 })], [])[0];
    const doble = p.lineas.find((l) => l.acomodacion === "Doble")!, nino = p.lineas.find((l) => l.acomodacion === "Niño 1")!;
    assert.equal(doble.netoResultante, 90_000, "(2 × 100.000 − 20.000) / 2");
    assert.deepEqual(doble.habitacion, { ocupantes: 2, baseHabitacion: 200_000, resultadoHabitacion: 180_000, porPersona: [90_000, 90_000] });
    assert.equal(nino.netoResultante, null);
    assert.match(nino.motivoNoAplica ?? "", /no es habitación/);
  });
  test("triple con monto por habitación: el cálculo vigente (83.333,33 por persona) y el reparto exacto del total (COP sin decimales; USD con centavos)", () => {
    const vig = [ALTA, promo({ tipo: "descuento_monto", descuento_unidad: "habitacion_noche", hotel_promocion_reglas: [{ grupo_id: SEMANA, valor: 20_000, dias: null }] })];
    const triple = promocionesDinamicasHotel(vig, [fila(SEMANA, 100_000, { neto_doble: null, neto_triple: 90_000 })], [])[0].lineas[0];
    assert.ok(Math.abs((triple.netoResultante ?? 0) - 250_000 / 3) < 1e-6, "el neto por persona del motor no cambia");
    assert.deepEqual(triple.habitacion, { ocupantes: 3, baseHabitacion: 270_000, resultadoHabitacion: 250_000, porPersona: [83_334, 83_333, 83_333] });
    const vigUsd = [ALTA, promo({ tipo: "descuento_monto", descuento_unidad: "habitacion_noche", hotel_promocion_reglas: [{ grupo_id: SEMANA, valor: 20, dias: null }] })];
    const usd = promocionesDinamicasHotel(vigUsd, [fila(SEMANA, 100, { neto_doble: null, neto_triple: 90 })], [], "USD")[0].lineas[0];
    assert.deepEqual(usd.habitacion?.porPersona, [83.34, 83.33, 83.33]);
  });
  test("pax_tarifa del hotel: una doble configurada con 3 ocupantes tarifados reparte entre 3", () => {
    const vig = [ALTA, promo({ tipo: "descuento_monto", descuento_unidad: "habitacion_noche", hotel_promocion_reglas: [{ grupo_id: SEMANA, valor: 20_000, dias: null }] })];
    const l = promocionesDinamicasHotel(vig, [fila(SEMANA, 100_000)], [{ acomodacion: "doble", pax_tarifa: 3 } as never])[0].lineas[0];
    assert.deepEqual(l.habitacion, { ocupantes: 3, baseHabitacion: 300_000, resultadoHabitacion: 280_000, porPersona: [93_334, 93_333, 93_333] });
  });
  test("igual que el motor: prioridad menor no aplica, igual es empate, combinación pendiente no se vende", () => {
    const [menor] = promocionesDinamicasHotel([{ ...ALTA, prioridad: 3 }, promo()], [fila(SEMANA, 100_000)], []);
    assert.match(menor.motivo ?? "", /menor que su base/);
    const [empate] = promocionesDinamicasHotel([{ ...ALTA, prioridad: 2 }, promo()], [fila(SEMANA, 100_000)], []);
    assert.match(empate.motivo ?? "", /empate/);
    const [pend] = promocionesDinamicasHotel([ALTA, promo({ hotel_promocion_combinacion: { estado: "pendiente" } })], [fila(SEMANA, 100_000)], []);
    assert.equal(pend.estado, "no_vende");
  });
  test("una promoción sin reglas o sin base no es dinámica (no aparece)", () => {
    assert.equal(promocionesDinamicasHotel([ALTA, promo({ hotel_promocion_reglas: [] })], [fila(SEMANA, 100_000)], []).length, 0);
    assert.equal(promocionesDinamicasHotel([ALTA, promo({ promo_base_id: null })], [fila(SEMANA, 100_000)], []).length, 0);
  });
  test("texto del descuento", () => {
    assert.equal(textoDescuento("descuento_pct", null, 10, String), "10 %");
    assert.equal(textoDescuento("descuento_monto", "habitacion_noche", 20000, (n) => n.toLocaleString("es-CO")), "20.000 por habitación y noche");
  });
});
