// #126-D — la etiqueta de promoción sale de la procedencia REAL del motor: solo si la promoción ganó, con el alcance honesto.
// Calendario 2026-12 (igual al de promoMultibase125): BASE A = 1–5, BASE B = 6–12, promoción PRE BF = 4–8 (−10 %, sigue la base ganadora).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluarHotelPorFechas, type DatosHotelPaquete, type FilaTemporadaHotelRaw, type FilaTarifaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";
import { promocionMostrada, promocionesAplicadasDe } from "../lib/calc/promoMostrada.ts";

const raw = (o: Partial<FilaTemporadaHotelRaw> & { nombre: string }): FilaTemporadaHotelRaw => ({
  fecha_inicio: null, fecha_fin: null, prioridad: 1, compra_inicio: null, compra_fin: null,
  tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null, ...o,
});
const tar = (temporada: string, o: Partial<FilaTarifaHotelRaw>): FilaTarifaHotelRaw =>
  ({ tipo_habitacion: "Estandar", alimentacion: "PAM", temporada, neto_sencilla: null, neto_doble: null, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, ...o });
const RA = raw({ id: 1, nombre: "BASE A", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-05" });
const RB = raw({ id: 2, nombre: "BASE B", fecha_inicio: "2026-12-06", fecha_fin: "2026-12-12" });
const TAR = [
  tar("BASE A", { neto_doble: 100_000, neto_triple: 90_000, neto_nino: 50_000, neto_infante: 20_000 }),
  tar("BASE B", { neto_doble: 150_000, neto_triple: 140_000, neto_nino: 75_000, neto_infante: 30_000 }),
];
const SIGUE = (o: Partial<FilaTemporadaHotelRaw> = {}) => raw({
  id: 10, nombre: "PRE BF", fecha_inicio: "2026-12-04", fecha_fin: "2026-12-08", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10,
  promo_sigue_base: true, hotel_promocion_reglas: [{ grupo_id: null, valor: 10, dias: null }], ...o,
} as Partial<FilaTemporadaHotelRaw> & { nombre: string });
function evaluar(vigs: FilaTemporadaHotelRaw[], ida: string, noches: number, tarifas = TAR) {
  const datos: DatosHotelPaquete = {
    paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2026-12-01", fecha_viaje_fin: "2026-12-31" },
    armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel Test", hotel_moneda: "COP" },
    temporadas: vigs, tarifas, serviciosIncluidos: [], blackouts: [], fechaReserva: "2026-11-17",
  };
  return evaluarHotelPorFechas(datos, ida, noches);
}
const etiqueta = (vigs: FilaTemporadaHotelRaw[], ida: string, noches: number, acoms = ["doble"]) =>
  promocionMostrada(evaluar(vigs, ida, noches)?.combos[0]?.promosPorAcom, acoms)?.etiqueta ?? null;

describe("etiqueta de promoción — solo cuando de verdad aplica y con su alcance", () => {
  test("estadía entera dentro de la promoción (4→9 dic, noches 4–8): «Promoción PRE BF» sin calificativos", () => {
    assert.equal(etiqueta([RA, RB, SIGUE()], "2026-12-04", 5), "Promoción PRE BF");
  });
  test("estadía que solo roza la promoción (2→7 dic: noches 2 y 3 son base): se dice que cubre algunas noches, nunca toda la estadía", () => {
    assert.equal(etiqueta([RA, RB, SIGUE()], "2026-12-02", 5), "Promoción PRE BF · solo en algunas noches");
  });
  test("estadía fuera de las fechas de la promoción (9→12 dic): sin etiqueta aunque el hotel la tenga configurada", () => {
    assert.equal(etiqueta([RA, RB, SIGUE()], "2026-12-09", 3), null);
  });
  test("límites de fecha: la noche 8 aún tiene promoción; la 9 ya no (estadías de 1 noche)", () => {
    assert.equal(etiqueta([RA, RB, SIGUE()], "2026-12-08", 1), "Promoción PRE BF");
    assert.equal(etiqueta([RA, RB, SIGUE()], "2026-12-09", 1), null);
    assert.equal(etiqueta([RA, RB, SIGUE()], "2026-12-03", 1), null);
    assert.equal(etiqueta([RA, RB, SIGUE()], "2026-12-04", 1), "Promoción PRE BF");
  });
  test("promoción con vigencia de compra vencida (comprar hasta 2026-11-01; hoy 2026-11-17): no se anuncia", () => {
    assert.equal(etiqueta([RA, RB, SIGUE({ compra_fin: "2026-11-01" })], "2026-12-04", 5), null);
  });
  test("sin ninguna promoción configurada: sin etiqueta", () => {
    assert.equal(etiqueta([RA, RB], "2026-12-04", 5), null);
  });
  test("«N noches, 1 gratis»: se rotula como promoción aplicada a la estadía (no noche a noche) y no aparece en estadías más cortas que su mínimo", () => {
    const GRATIS = raw({ id: 11, nombre: "UNA GRATIS", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-12", prioridad: 6, tipo: "promo_noche_gratis", min_noches: 3 });
    assert.equal(etiqueta([RA, RB, GRATIS], "2026-12-06", 3), "Promoción UNA GRATIS · aplicada a la estadía");
    assert.equal(etiqueta([RA, RB, GRATIS], "2026-12-06", 2), null);
  });
  test("etiqueta nunca habla de niños gratis ni de «gratis» salvo en el nombre de la promoción configurada por el hotel", () => {
    const e = etiqueta([RA, RB, SIGUE({ nino_gratis: true } as never)], "2026-12-04", 5) ?? "";
    assert.doesNotMatch(e, /niñ|gratis/i);
  });
  test("ocupación mixta: si la promoción solo cubre una acomodación usada, la etiqueta lo dice", () => {
    // Triple sin tarifa base B en el rango pedido ⇒ el combo solo trae «doble»; se simula la mezcla con los datos de salida del motor.
    const porAcom = { doble: [{ nombre: "PRE BF", alcance: "toda" as const }], triple: [] };
    assert.equal(promocionMostrada(porAcom, ["doble", "triple"])?.etiqueta, "Promoción PRE BF (solo en Doble)");
    assert.equal(promocionMostrada(porAcom, ["triple"]), null);
    assert.equal(promocionMostrada(undefined, ["doble"]), null);
  });
  test("procedencia: base ganadora + promoción de estadía = «estadia»; solo promoción = «toda»; solo base = ninguna", () => {
    const t = [{ nombre: "G", fecha_inicio: null, fecha_fin: null, tipo: "promo_noche_gratis" as const }, { nombre: "P", fecha_inicio: null, fecha_fin: null, tipo: "descuento_pct" as const }];
    const base = { temporadaGanadora: "A", esPromocion: false, precioFinalAutoritativo: false };
    const promo = (n: string) => ({ temporadaGanadora: n, esPromocion: true, precioFinalAutoritativo: false });
    assert.deepEqual(promocionesAplicadasDe([base, promo("G")], t), [{ nombre: "G", alcance: "estadia" }]);
    assert.deepEqual(promocionesAplicadasDe([promo("P")], t), [{ nombre: "P", alcance: "toda" }]);
    assert.deepEqual(promocionesAplicadasDe([base, promo("P")], t), [{ nombre: "P", alcance: "algunas_noches" }]);
    assert.deepEqual(promocionesAplicadasDe([base], t), []);
  });
});

describe("etiqueta — varias promociones", () => {
  test("misma situación en todas: una sola frase, sin repetir el calificativo", () => {
    const porAcom = { doble: [{ nombre: "PROMO UNO", alcance: "algunas_noches" as const }, { nombre: "PROMO DOS", alcance: "algunas_noches" as const }] };
    assert.equal(promocionMostrada(porAcom, ["doble"])?.etiqueta, "Promociones PROMO UNO y PROMO DOS · cada una en algunas noches");
    const completas = { doble: [{ nombre: "A", alcance: "toda" as const }, { nombre: "B", alcance: "toda" as const }] };
    assert.equal(promocionMostrada(completas, ["doble"])?.etiqueta, "Promociones A y B");
  });
  test("alcances distintos o restricción por acomodación: cada una con su texto (no se mezclan)", () => {
    const mixto = { doble: [{ nombre: "A", alcance: "toda" as const }, { nombre: "B", alcance: "algunas_noches" as const }] };
    assert.equal(promocionMostrada(mixto, ["doble"])?.etiqueta, "Promoción A · Promoción B · solo en algunas noches");
  });
});

// F2 (Codex ronda 1) — dos promociones SUCESIVAS que juntas cubren toda la estadía, sin ninguna noche base: ninguna cubre sola toda la estadía.
// Calendario: BASE 1–10 dic, PROMO UNO solo la noche del 4, PROMO DOS solo la noche del 5 (ambas «siguen la base», prioridad 5).
describe("etiqueta — promociones sucesivas sin noches base (motor real)", () => {
  const BASE = raw({ id: 5, nombre: "BASE", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-10" });
  const TARS = [tar("BASE", { neto_doble: 100_000, neto_triple: 90_000, neto_nino: 50_000, neto_infante: 20_000 })];
  const UNO = SIGUE({ id: 20, nombre: "PROMO UNO", fecha_inicio: "2026-12-04", fecha_fin: "2026-12-04" });
  const DOS = SIGUE({ id: 21, nombre: "PROMO DOS", fecha_inicio: "2026-12-05", fecha_fin: "2026-12-05" });
  const promos = (ida: string, noches: number, vigs = [BASE, UNO, DOS]) => evaluar(vigs, ida, noches, TARS)?.combos[0]?.promosPorAcom?.doble;
  const etiq = (ida: string, noches: number, vigs = [BASE, UNO, DOS]) => promocionMostrada(evaluar(vigs, ida, noches, TARS)?.combos[0]?.promosPorAcom, ["doble"])?.etiqueta ?? null;

  test("estadía 4→6 (noches 4 y 5): ninguna noche base, pero cada promoción solo cubre UNA de las dos noches", () => {
    assert.deepEqual(promos("2026-12-04", 2), [{ nombre: "PROMO UNO", alcance: "algunas_noches" }, { nombre: "PROMO DOS", alcance: "algunas_noches" }]);
    assert.equal(etiq("2026-12-04", 2), "Promociones PROMO UNO y PROMO DOS · cada una en algunas noches");
  });
  test("el motor confirma que de verdad no hay noche base: 1 noche cada una (suma = 2 noches)", () => {
    const e = evaluar([BASE, UNO, DOS], "2026-12-04", 2, TARS);
    assert.ok(e?.combos[0]);
    assert.deepEqual(e!.combos[0].promosPorAcom?.doble.map((p) => p.nombre), ["PROMO UNO", "PROMO DOS"]);
  });
  test("con una noche base alrededor (3→7) siguen siendo parciales; una sola noche (4→5) de una única promoción sí es toda la estadía", () => {
    assert.equal(etiq("2026-12-03", 4), "Promociones PROMO UNO y PROMO DOS · cada una en algunas noches");
    assert.equal(etiq("2026-12-04", 1), "Promoción PROMO UNO");
    assert.equal(etiq("2026-12-05", 1), "Promoción PROMO DOS");
  });
  test("una promoción que gana TODAS las noches sin base (PRE BF 4–8, estadía 4→6) sigue siendo toda la estadía", () => {
    assert.equal(promocionMostrada(evaluar([RA, RB, SIGUE()], "2026-12-04", 2)?.combos[0]?.promosPorAcom, ["doble"])?.etiqueta, "Promoción PRE BF");
  });
  test("sin el conteo de noches (llamador antiguo) se es conservador: dos promociones nunca son «toda la estadía»", () => {
    const t = [{ nombre: "P1", fecha_inicio: null, fecha_fin: null, tipo: "descuento_pct" as const }, { nombre: "P2", fecha_inicio: null, fecha_fin: null, tipo: "descuento_pct" as const }];
    const g = (n: string) => ({ temporadaGanadora: n, esPromocion: true, precioFinalAutoritativo: false });
    assert.deepEqual(promocionesAplicadasDe([g("P1"), g("P2")], t).map((p) => p.alcance), ["algunas_noches", "algunas_noches"]);
    assert.deepEqual(promocionesAplicadasDe([g("P1")], t).map((p) => p.alcance), ["toda"]);
    assert.deepEqual(promocionesAplicadasDe([g("P1"), g("P2")], t, { P1: 1, P2: 1 }).map((p) => p.alcance), ["algunas_noches", "algunas_noches"]);
    assert.deepEqual(promocionesAplicadasDe([g("P1")], t, { P1: 3 }).map((p) => p.alcance), ["toda"]);
    assert.deepEqual(promocionesAplicadasDe([g("P1")], t, { P1: 2, BASE: 1 }).map((p) => p.alcance), ["algunas_noches"]);
  });
});
