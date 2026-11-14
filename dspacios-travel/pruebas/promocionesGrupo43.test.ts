import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { liquidarHotelNoches, liquidarHotelNochesConTemporadas, liquidarHotelMasBarato, minNochesAplicable, toTemporadaRango } from "../lib/calc/paquetes.ts";
import { evaluarHotelPorFechas, type DatosHotelPaquete, type FilaTemporadaHotelRaw, type FilaTarifaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";
import { basesPromoDeFilas, filasPorClave, netosDeColumna } from "../lib/calc/netosPorTemporada.ts";
import { netoConRegla, nocheABonificar, repartirExacto } from "../lib/calc/promocionesGrupo.ts";
import { validarCamposPromo } from "../lib/hoteles/promocionesVigencia.ts";

// ─────────────────────────────────────────────────────────────────────────
// #43/#60 entrega 4 — promociones por grupo (especificación §4; historial O, P, S, T, X, Y; diseño AI).
// Fechas: el 1 de enero de 2027 es viernes ⇒ lun 4, mar 5, mié 6, jue 7, vie 8, sáb 9, dom 10.
// Los grupos activos y las reglas solo existen aquí, en memoria (la 300 no está aplicada).
// ─────────────────────────────────────────────────────────────────────────
const HOY = "2026-11-12";
const SEM = { id: "g-sem", dias: [1, 2, 3, 4], activo: true };
const FS = { id: "g-fs", dias: [5, 6, 7], activo: true };
const TODOS = { id: "g-todos", dias: [1, 2, 3, 4, 5, 6, 7], activo: true };

const vig = (over: Partial<FilaTemporadaHotelRaw> & { nombre: string }): FilaTemporadaHotelRaw => ({
  fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", prioridad: 1, compra_inicio: null, compra_fin: null,
  tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null, ...over,
});
const tar = (temporada: string, over: Partial<FilaTarifaHotelRaw> = {}): FilaTarifaHotelRaw => ({
  tipo_habitacion: "Estandar", alimentacion: "PAM", temporada,
  neto_sencilla: null, neto_doble: null, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, ...over,
});
const COL: Record<string, string> = { sencilla: "neto_sencilla", doble: "neto_doble", triple: "neto_triple", multiple: "neto_multiple", nino: "neto_nino", nino2: "neto_nino2", infante: "neto_infante" };

/** Liquida como todos los cargadores: armado compartido (netos + vínculo de promociones) + motor. */
const OCC: Record<string, number> = { sencilla: 1, doble: 2, triple: 3, multiple: 4 };
function liquidar(vigs: FilaTemporadaHotelRaw[], tarifas: FilaTarifaHotelRaw[], ida: string, n: number, acom = "doble", ocupantes = OCC[acom]) {
  const porClave = filasPorClave(tarifas);
  return liquidarHotelNoches({
    fechaIda: ida, numNoches: n, temporadas: vigs.map(toTemporadaRango), netoPorTemporada: netosDeColumna(porClave, COL[acom]),
    hoy: HOY, regimen: "PAM", basePromoPorClave: basesPromoDeFilas(porClave), acomodacion: acom, ocupantes,
  });
}
const cerca = (a: number | null, b: number) => assert.ok(a != null && Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

// Base con grupos: Semana (L–J) 100.000, Fin de semana (V–D) 150.000 por persona y noche (doble).
const ALTA = vig({ id: 1, nombre: "ALTA", hotel_temporada_grupos: [SEM, FS] });
const TAR_ALTA = [tar("ALTA", { grupo_id: "g-sem", neto_doble: 100_000, neto_sencilla: 120_000 }), tar("ALTA", { grupo_id: "g-fs", neto_doble: 150_000, neto_sencilla: 170_000 })];
const promo = (over: Partial<FilaTemporadaHotelRaw> & { nombre: string; reglas: unknown[] }) =>
  vig({ id: 10, tipo: "descuento_pct", prioridad: 2, promo_base_id: 1, hotel_promocion_reglas: over.reglas, ...over });

describe("1. Por noche (Y.2, §4 «promoción por grupo»)", () => {
  test("−10 % solo lun–mié en Semana; entrada lunes, salida sábado ⇒ 520.000", () => {
    const p = promo({ nombre: "P", reglas: [{ grupo_id: "g-sem", valor: 10, dias: [1, 2, 3] }] });
    assert.equal(liquidar([ALTA, p], TAR_ALTA, "2027-01-04", 5), 520_000);
  });
  test("«Todos los días del grupo» ⇒ 90.000 × 4 + 150.000 = 510.000", () => {
    const p = promo({ nombre: "P", reglas: [{ grupo_id: "g-sem", valor: 10, dias: null }] });
    assert.equal(liquidar([ALTA, p], TAR_ALTA, "2027-01-04", 5), 510_000);
  });
  test("−10 % L–J y −5 % V–D, jueves → domingo ⇒ 375.000 (sin promoción 400.000)", () => {
    const p = promo({ nombre: "P", reglas: [{ grupo_id: "g-sem", valor: 10, dias: null }, { grupo_id: "g-fs", valor: 5, dias: null }] });
    assert.equal(liquidar([ALTA, p], TAR_ALTA, "2027-01-07", 3), 375_000);
    assert.equal(liquidar([ALTA], TAR_ALTA, "2027-01-07", 3), 400_000);
  });
  test("grupo sin regla conserva la base; el procedente dice qué ganó cada noche", () => {
    const p = promo({ nombre: "P", reglas: [{ grupo_id: "g-fs", valor: 5, dias: [6] }] });
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2027-01-07", numNoches: 3, temporadas: [ALTA, p].map(toTemporadaRango), netoPorTemporada: netosDeColumna(filasPorClave(TAR_ALTA), "neto_doble"),
      hoy: HOY, regimen: "PAM", basePromoPorClave: {}, acomodacion: "doble",
    });
    assert.equal(r?.total, 100_000 + 150_000 + 142_500);
    assert.deepEqual(r?.procedencia.map((x) => x.temporadaGanadora), ["ALTA", "P"]);
    assert.deepEqual(r?.temporadasTarifa, ["ALTA"]); // la edad y las condiciones se leen de la fila de la base
  });
  test("una regla de un grupo PREPARADO (inactivo) no aplica: la base se vende «todos los días»", () => {
    const alta = vig({ id: 1, nombre: "ALTA", hotel_temporada_grupos: [{ ...SEM, activo: false }] });
    const p = promo({ nombre: "P", reglas: [{ grupo_id: "g-sem", valor: 10, dias: null }] });
    assert.equal(liquidar([alta, p], [tar("ALTA", { neto_doble: 100_000 })], "2027-01-04", 2), 200_000);
  });
  test("base sin grupos con una regla de todos los días (lun–mié): solo esas noches", () => {
    const baja = vig({ id: 1, nombre: "BAJA" });
    const p = promo({ nombre: "P", reglas: [{ grupo_id: null, valor: 10, dias: [1, 2, 3] }] });
    assert.equal(liquidar([baja, p], [tar("BAJA", { neto_doble: 100_000 })], "2027-01-04", 5), 3 * 90_000 + 2 * 100_000);
  });
  test("mínimo de noches de la promoción: estadía más corta ⇒ no aplica", () => {
    const p = promo({ nombre: "P", min_noches: 3, reglas: [{ grupo_id: "g-sem", valor: 10, dias: null }] });
    assert.equal(liquidar([ALTA, p], TAR_ALTA, "2027-01-04", 2), 200_000);
    assert.equal(liquidar([ALTA, p], TAR_ALTA, "2027-01-04", 3), 270_000);
  });
  test("la promoción con reglas no fija el mínimo de noches para vender (minNochesAplicable)", () => {
    const p = promo({ nombre: "P", min_noches: 5, reglas: [{ grupo_id: "g-sem", valor: 10, dias: null }] });
    assert.equal(minNochesAplicable([ALTA, p].map(toTemporadaRango), "2027-01-04", HOY), 1);
  });
  test("fuera de compra u otro régimen ⇒ se cobra la base (O.4.6)", () => {
    const fuera = promo({ nombre: "P", compra_fin: "2026-01-01", reglas: [{ grupo_id: "g-sem", valor: 10, dias: null }] });
    const otroReg = promo({ nombre: "P", regimen_restringido: "PC", reglas: [{ grupo_id: "g-sem", valor: 10, dias: null }] });
    assert.equal(liquidar([ALTA, fuera], TAR_ALTA, "2027-01-04", 2), 200_000);
    assert.equal(liquidar([ALTA, otroReg], TAR_ALTA, "2027-01-04", 2), 200_000);
  });
  test("invertir el orden de lectura no cambia el resultado (X.4.11)", () => {
    const p = promo({ nombre: "P", reglas: [{ grupo_id: "g-sem", valor: 10, dias: null }, { grupo_id: "g-fs", valor: 5, dias: null }] });
    assert.equal(liquidar([p, ALTA], [...TAR_ALTA].reverse(), "2027-01-07", 3), 375_000);
  });
});

describe("2. Base primero, luego su promoción (N1, X.2/X.4)", () => {
  // ALTA prioridad 1 (todos los días, como grupo); PUENTE prioridad 3, 10–12 ene; promociones de ALTA prioridad 4.
  const altaG = vig({ id: 1, nombre: "ALTA", hotel_temporada_grupos: [TODOS] });
  const puente = vig({ id: 2, nombre: "PUENTE", prioridad: 3, fecha_inicio: "2027-01-10", fecha_fin: "2027-01-12" });
  const tarifas = [tar("ALTA", { grupo_id: "g-todos", neto_doble: 100_000 }), tar("PUENTE", { neto_doble: 200_000 })];
  test("promoción EXISTENTE (fila de PROMO-ALTA calculada desde ALTA) ⇒ 690.000, no 360.000", () => {
    const pa = vig({ id: 3, nombre: "PROMO-ALTA", tipo: "descuento_pct", prioridad: 4 });
    const t = [...tarifas, tar("PROMO-ALTA", { neto_doble: 90_000, temporada_base: "ALTA", precio_final_autoritativo: true })];
    assert.equal(liquidar([altaG, puente, pa], t, "2027-01-09", 4), 690_000);
  });
  test("mismos datos SIN grupos ⇒ 360.000 (legado intacto)", () => {
    const pa = vig({ id: 3, nombre: "PROMO-ALTA", tipo: "descuento_pct", prioridad: 4 });
    const alta = vig({ id: 1, nombre: "ALTA" });
    const t = [tar("ALTA", { neto_doble: 100_000 }), tar("PUENTE", { neto_doble: 200_000 }), tar("PROMO-ALTA", { neto_doble: 90_000, temporada_base: "ALTA" })];
    assert.equal(liquidar([alta, puente, pa], t, "2027-01-09", 4), 360_000);
  });
  test("promoción NUEVA con reglas vinculada a ALTA ⇒ 690.000; subir su prioridad a 9 no cambia nada", () => {
    for (const prioridad of [4, 9]) {
      const pa = promo({ id: 3, nombre: "PROMO-ALTA", prioridad, reglas: [{ grupo_id: "g-todos", valor: 10, dias: null }] });
      assert.equal(liquidar([altaG, puente, pa], tarifas, "2027-01-09", 4), 690_000);
    }
  });
  test("con otra promoción vinculada a PUENTE (−10 %) ⇒ 90.000 + 3 × 180.000 = 630.000", () => {
    const pa = promo({ id: 3, nombre: "PROMO-ALTA", prioridad: 4, reglas: [{ grupo_id: "g-todos", valor: 10, dias: null }] });
    const pp = promo({ id: 4, nombre: "PROMO-PUENTE", prioridad: 5, promo_base_id: 2, reglas: [{ grupo_id: null, valor: 10, dias: null }] });
    assert.equal(liquidar([altaG, puente, pa, pp], tarifas, "2027-01-09", 4), 630_000);
  });
  test("promoción existente SIN vínculo en una noche de base con grupos: no aplica (X.3.5)", () => {
    const suelta = vig({ id: 3, nombre: "SUELTA", tipo: "descuento_pct", prioridad: 4 });
    assert.equal(liquidar([altaG, suelta], [...tarifas, tar("SUELTA", { neto_doble: 50_000 })], "2027-01-04", 2), 200_000);
  });
  test("promoción de prioridad IGUAL a su base: empate (la noche no se vende); MENOR: no aplica", () => {
    const igual = promo({ id: 3, nombre: "IGUAL", prioridad: 1, reglas: [{ grupo_id: "g-todos", valor: 10, dias: null }] });
    const menor = promo({ id: 3, nombre: "MENOR", prioridad: 0, reglas: [{ grupo_id: "g-todos", valor: 10, dias: null }] });
    assert.equal(liquidar([altaG, igual], tarifas, "2027-01-04", 2), null);
    assert.equal(liquidar([altaG, menor], tarifas, "2027-01-04", 2), 200_000);
  });
  test("dos promociones de la misma base: gana la de mayor prioridad; con igual prioridad, empate", () => {
    const a = promo({ id: 3, nombre: "A", prioridad: 4, reglas: [{ grupo_id: "g-todos", valor: 10, dias: null }] });
    const b = promo({ id: 4, nombre: "B", prioridad: 5, reglas: [{ grupo_id: "g-todos", valor: 20, dias: null }] });
    assert.equal(liquidar([altaG, a, b], tarifas, "2027-01-04", 1), 80_000);
    assert.equal(liquidar([altaG, a, { ...b, prioridad: 4 }], tarifas, "2027-01-04", 1), null);
  });
});

describe("3. La promoción no crea disponibilidad; la estadía exige todas sus noches (O.4)", () => {
  // El viernes, el Fin de semana NO tiene doble (sí sencilla).
  const t = [tar("ALTA", { grupo_id: "g-sem", neto_doble: 100_000, neto_sencilla: 120_000 }), tar("ALTA", { grupo_id: "g-fs", neto_doble: null, neto_sencilla: 170_000 })];
  const p = promo({ nombre: "P", reglas: [{ grupo_id: "g-fs", valor: 10, dias: null }] });
  test("doble jueves → domingo: la promoción del Fin de semana no la habilita ⇒ no se ofrece", () => {
    assert.equal(liquidar([ALTA, p], t, "2027-01-07", 3, "doble"), null);
  });
  test("la misma estadía en sencilla sí se vende: 120.000 + 2 × 153.000", () => {
    assert.equal(liquidar([ALTA, p], t, "2027-01-07", 3, "sencilla"), 120_000 + 2 * 153_000);
  });
  test("falta la primera o la última noche ⇒ no se ofrece (nunca una estadía parcial)", () => {
    assert.equal(liquidar([ALTA, p], t, "2027-01-08", 2, "doble"), null);
    assert.equal(liquidar([ALTA, p], t, "2027-01-06", 3, "doble"), null);
  });
});

describe("4. Monto fijo con unidad (S.2, T.3, T.6)", () => {
  const base = vig({ id: 1, nombre: "BASE" });
  const monto = (unidad: string, valor = 20_000, over: Partial<FilaTemporadaHotelRaw> = {}) =>
    vig({ id: 10, nombre: "MONTO", tipo: "descuento_monto", prioridad: 2, descuento_unidad: unidad, ...(unidad === "persona_estadia"
      ? { descuento_valor: valor } : { promo_base_id: 1, hotel_promocion_reglas: [{ grupo_id: null, valor, dias: null }] }), ...over });
  test("ejemplo aprobado: habitación 800.000, 2 adultos, 3 noches, 20.000 ⇒ 680.000 / 740.000 / 760.000", () => {
    const t = [tar("BASE", { neto_doble: 400_000 / 3 })];
    cerca(2 * (liquidar([base, monto("persona_noche")], t, "2027-01-04", 3) ?? NaN), 680_000);
    cerca(2 * (liquidar([base, monto("habitacion_noche")], t, "2027-01-04", 3) ?? NaN), 740_000);
    cerca(2 * (liquidar([base, monto("persona_estadia")], t, "2027-01-04", 3) ?? NaN), 760_000);
  });
  test("persona/noche: 100.000 ⇒ 80.000; niño 60.000 ⇒ 40.000; 15.000 ⇒ 15.000; 20.000 ⇒ 0; gratis 0 ⇒ 0", () => {
    for (const [neto, esperado] of [[100_000, 80_000], [60_000, 40_000], [15_000, 15_000], [20_000, 0], [0, 0]]) {
      assert.equal(liquidar([base, monto("persona_noche")], [tar("BASE", { neto_nino: neto })], "2027-01-04", 1, "nino"), esperado);
    }
  });
  test("persona/noche, noches de 60.000 y 15.000 del mismo niño: cada noche por separado, sin trasladar sobrantes", () => {
    const sem = vig({ id: 1, nombre: "BASE", hotel_temporada_grupos: [SEM, FS] });
    const m = monto("persona_noche", 20_000, { hotel_promocion_reglas: [{ grupo_id: "g-sem", valor: 20_000, dias: null }, { grupo_id: "g-fs", valor: 20_000, dias: null }] });
    const t = [tar("BASE", { grupo_id: "g-sem", neto_nino: 60_000 }), tar("BASE", { grupo_id: "g-fs", neto_nino: 15_000 })];
    assert.equal(liquidar([sem, m], t, "2027-01-07", 2, "nino"), 40_000 + 15_000);
  });
  test("habitación/noche: una vez por habitación y noche, nunca por pasajero; niños e infantes no lo reciben", () => {
    const t = [tar("BASE", { neto_doble: 100_000, neto_triple: 90_000, neto_sencilla: 15_000, neto_nino: 50_000 })];
    assert.equal(liquidar([base, monto("habitacion_noche")], t, "2027-01-04", 1, "doble"), 90_000);            // (200.000 − 20.000) / 2
    cerca(liquidar([base, monto("habitacion_noche")], t, "2027-01-04", 1, "triple"), (270_000 - 20_000) / 3);
    assert.equal(liquidar([base, monto("habitacion_noche")], t, "2027-01-04", 1, "sencilla"), 15_000);         // supera la habitación: no aplica
    assert.equal(liquidar([base, monto("habitacion_noche")], t, "2027-01-04", 1, "nino"), 50_000);
    assert.equal(liquidar([base, monto("habitacion_noche", 30_000)], [tar("BASE", { neto_sencilla: 30_000 })], "2027-01-04", 1, "sencilla"), 0);
  });
  test("persona/estadía (Y.2): base 550.000, 20.000 con entradas lun–mié ⇒ 530.000; entrada jueves ⇒ sin descuento", () => {
    const sem = vig({ id: 1, nombre: "BASE", hotel_temporada_grupos: [SEM, FS] });
    const t = [tar("BASE", { grupo_id: "g-sem", neto_sencilla: 100_000 }), tar("BASE", { grupo_id: "g-fs", neto_sencilla: 150_000 })];
    const m = monto("persona_estadia", 20_000, { dias_promo: [1, 2, 3] });
    assert.equal(liquidar([sem, m], t, "2027-01-04", 5, "sencilla"), 530_000);
    assert.equal(liquidar([sem, m], t, "2027-01-07", 5, "sencilla"), 100_000 + 3 * 150_000 + 100_000);
  });
  test("persona/estadía: mayor que el total de la persona ⇒ no aplica; igual ⇒ 0; una sola vez sin importar las noches", () => {
    assert.equal(liquidar([base, monto("persona_estadia", 50_000)], [tar("BASE", { neto_nino: 15_000 })], "2027-01-04", 3, "nino"), 45_000);
    assert.equal(liquidar([base, monto("persona_estadia", 45_000)], [tar("BASE", { neto_nino: 15_000 })], "2027-01-04", 3, "nino"), 0);
    assert.equal(liquidar([base, monto("persona_estadia", 10_000)], [tar("BASE", { neto_doble: 100_000 })], "2027-01-04", 4, "doble"), 390_000);
  });
  test("aritmética pura: la comparación respeta la unidad y no mezcla", () => {
    assert.equal(netoConRegla("descuento_monto", "habitacion_noche", 150_000, 100_000, "doble", 2), 25_000);
    assert.equal(netoConRegla("descuento_monto", "habitacion_noche", 150_000, 100_000, "doble"), null, "sin ocupantes del hotel no se supone ninguno"); // 150.000 ≤ 200.000 (habitación)
    assert.equal(netoConRegla("descuento_monto", "persona_noche", 150_000, 100_000, "doble"), null);    // 150.000 > 100.000 (persona)
    assert.equal(netoConRegla("descuento_monto", "persona_estadia", 1, 100_000, "doble"), null);       // se resuelve en la estadía
    assert.equal(netoConRegla("descuento_pct", null, 100, 100_000, "doble"), null);
  });
});

describe("5. «N noches, 1 gratis» con noche elegida y días (P.2, Y.2)", () => {
  const t = [tar("ALTA", { grupo_id: "g-sem", neto_doble: 100_000 }), tar("ALTA", { grupo_id: "g-fs", neto_doble: 150_000 })];
  const ng = (regla: string | null, dias: number[] | null = null, min = 3) =>
    vig({ id: 20, nombre: "GRATIS", tipo: "promo_noche_gratis", prioridad: 2, min_noches: min, noche_gratis_regla: regla, dias_promo: dias });
  test("jue 100.000 + vie 150.000 + sáb 150.000: más barata 300.000; más cara 250.000; última 250.000", () => {
    assert.equal(liquidar([ALTA, ng("mas_barata")], t, "2027-01-07", 3), 300_000);
    assert.equal(liquidar([ALTA, ng("mas_cara")], t, "2027-01-07", 3), 250_000);
    assert.equal(liquidar([ALTA, ng("ultima")], t, "2027-01-07", 3), 250_000);
  });
  test("existente (sin regla): promedio heredado 266.667", () => {
    cerca(liquidar([ALTA, ng(null)], t, "2027-01-07", 3), 400_000 * 2 / 3);
  });
  test("días permitidos lun–jue: más barata 300.000; más cara 300.000; última (sábado) no aplica ⇒ 400.000", () => {
    assert.equal(liquidar([ALTA, ng("mas_barata", [1, 2, 3, 4])], t, "2027-01-07", 3), 300_000);
    assert.equal(liquidar([ALTA, ng("mas_cara", [1, 2, 3, 4])], t, "2027-01-07", 3), 300_000);
    assert.equal(liquidar([ALTA, ng("ultima", [1, 2, 3, 4])], t, "2027-01-07", 3), 400_000);
  });
  test("sin ninguna noche permitida ⇒ no aplica; por debajo del mínimo ⇒ no aplica; 4 noches ⇒ una sola bonificada", () => {
    assert.equal(liquidar([ALTA, ng("mas_barata", [2])], t, "2027-01-07", 3), 400_000);
    assert.equal(liquidar([ALTA, ng("mas_barata", null, 4)], t, "2027-01-07", 3), 400_000);
    assert.equal(liquidar([ALTA, ng("mas_barata")], t, "2027-01-07", 4), 550_000 - 100_000);
  });
  test("se elige sobre los precios YA resueltos (base o promoción por noche)", () => {
    const p = promo({ nombre: "P", reglas: [{ grupo_id: "g-fs", valor: 50, dias: [5] }] }); // viernes a 75.000
    assert.equal(liquidar([ALTA, p, ng("mas_barata")], t, "2027-01-07", 3), 100_000 + 150_000);
  });
  test("empate de importe: se bonifica una sola (la primera del calendario)", () => {
    assert.equal(nocheABonificar([150_000, 150_000, 100_000], [5, 6, 7], "mas_cara", null), 0);
    assert.equal(liquidar([ALTA, ng("mas_cara")], t, "2027-01-08", 3), 300_000);
  });
  test("una sola promoción de estadía: la de mayor prioridad que aplica (sin acumulación nueva, entrega 5)", () => {
    const m = vig({ id: 21, nombre: "ESTADIA", tipo: "descuento_monto", prioridad: 3, descuento_unidad: "persona_estadia", descuento_valor: 10_000 });
    assert.equal(liquidar([ALTA, ng("mas_barata"), m], t, "2027-01-07", 3), 390_000);
    const mNoAplica = { ...m, dias_promo: [1] }; // entrada jueves no permitida ⇒ pasa a la siguiente
    assert.equal(liquidar([ALTA, ng("mas_barata"), mNoAplica], t, "2027-01-07", 3), 300_000);
  });
  test("«desde» de ventana (hotel SIN grupos): misma regla sobre N noches iguales", () => {
    const baja = vig({ id: 1, nombre: "BAJA" });
    const r = liquidarHotelMasBarato({
      desde: "2027-01-04", hasta: "2027-01-10", numNoches: 3, temporadas: [baja, ng("ultima", [1, 2, 3, 4, 5, 6, 7])].map(toTemporadaRango),
      netoPorTemporada: { BAJA: 100_000 }, hoy: HOY, regimen: "PAM",
    });
    assert.equal(r, 200_000);
  });
});

describe("6. Reparto exacto de presentación (T.3)", () => {
  const suma = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100);
  test("20.000 entre 3 = 6.666,67 + 6.666,67 + 6.666,66", () => {
    assert.deepEqual(repartirExacto(20_000, 3), [6666.67, 6666.67, 6666.66]);
    assert.equal(suma(repartirExacto(20_000, 3)), 2_000_000);
  });
  test("10.000,01 entre 3 y 20.000 entre 4; pesos enteros", () => {
    assert.equal(suma(repartirExacto(10_000.01, 3)), 1_000_001);
    assert.deepEqual(repartirExacto(20_000, 4), [5000, 5000, 5000, 5000]);
    assert.deepEqual(repartirExacto(20_000, 3, 0), [6667, 6667, 6666]);
  });
});

describe("7. Paridad: cotización por fechas (evaluarHotelPorFechas) = motor de los demás recorridos", () => {
  const vigs = [ALTA, promo({ nombre: "P", reglas: [{ grupo_id: "g-sem", valor: 10, dias: [1, 2, 3] }] }),
    vig({ id: 20, nombre: "GRATIS", tipo: "promo_noche_gratis", prioridad: 3, min_noches: 5, noche_gratis_regla: "ultima", dias_promo: [5] })];
  const datos: DatosHotelPaquete = {
    paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2027-01-01", fecha_viaje_fin: "2027-12-31" },
    armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel Test", hotel_moneda: "COP" },
    temporadas: vigs, tarifas: TAR_ALTA, serviciosIncluidos: [], blackouts: [],
  };
  test("lun → sáb: 3 × 90.000 + 100.000 + 150.000 − viernes bonificado = 370.000", () => {
    assert.equal(liquidar(vigs, TAR_ALTA, "2027-01-04", 5), 370_000);
    assert.equal(evaluarHotelPorFechas(datos, "2027-01-04", 5)?.combos[0]?.netos?.["doble"], 370_000);
  });
});

describe("8. Validación de servidor y formulario: sin valores por defecto (P.1.3, S.2, Y.1)", () => {
  test("noche gratis NUEVA sin regla o sin elegir días ⇒ rechazo", () => {
    assert.equal(validarCamposPromo({ tipo: "promo_noche_gratis" }).ok, false);
    assert.equal(validarCamposPromo({ tipo: "promo_noche_gratis", nocheGratisRegla: "ultima" }).ok, false);
    assert.equal(validarCamposPromo({ tipo: "promo_noche_gratis", nocheGratisRegla: "ultima", diasPromo: [] }).ok, false);
    assert.equal(validarCamposPromo({ tipo: "promo_noche_gratis", nocheGratisRegla: "primera" as never, diasPromo: "todos" }).ok, false);
    assert.deepEqual(validarCamposPromo({ tipo: "promo_noche_gratis", nocheGratisRegla: "ultima", diasPromo: [5, 1] }),
      { ok: true, columnas: { descuento_unidad: null, noche_gratis_regla: "ultima", dias_promo: [1, 5] } });
  });
  test("noche gratis EXISTENTE (promedio) se edita tal cual; ya elegida no vuelve a promedio", () => {
    const heredada = { tipo: "promo_noche_gratis", descuento_unidad: null, noche_gratis_regla: null };
    assert.equal(validarCamposPromo({ tipo: "promo_noche_gratis" }, heredada).ok, true);
    assert.equal(validarCamposPromo({ tipo: "promo_noche_gratis" }, { ...heredada, noche_gratis_regla: "ultima" }).ok, false);
  });
  test("monto NUEVO sin unidad ⇒ rechazo; existente queda en «unidad anterior»; persona/estadía exige elegir días", () => {
    assert.equal(validarCamposPromo({ tipo: "descuento_monto" }).ok, false);
    assert.equal(validarCamposPromo({ tipo: "descuento_monto" }, { tipo: "descuento_monto", descuento_unidad: null, noche_gratis_regla: null }).ok, true);
    assert.equal(validarCamposPromo({ tipo: "descuento_monto", descuentoUnidad: "persona_estadia" }).ok, false);
    assert.equal(validarCamposPromo({ tipo: "descuento_monto", descuentoUnidad: "persona_estadia", diasPromo: "todos" }).ok, true);
    assert.equal(validarCamposPromo({ tipo: "descuento_monto", descuentoUnidad: "habitacion_noche", diasPromo: [1] }).ok, false);
  });
  test("cambiar el tipo de una existente a noche gratis cuenta como nueva", () => {
    assert.equal(validarCamposPromo({ tipo: "promo_noche_gratis" }, { tipo: "descuento_pct", descuento_unidad: null, noche_gratis_regla: null }).ok, false);
  });
  test("una base o una promoción de porcentaje no llevan esas elecciones", () => {
    assert.equal(validarCamposPromo({ tipo: "tarifa", nocheGratisRegla: "ultima" }).ok, false);
    assert.equal(validarCamposPromo({ tipo: "descuento_pct" }).ok, true);
  });
});
