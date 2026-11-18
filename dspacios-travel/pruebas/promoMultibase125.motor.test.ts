import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { liquidarHotelNoches, liquidarHotelNochesConTemporadas, liquidarHotelMasBarato, toTemporadaRango, marcar, type TemporadaRango } from "../lib/calc/paquetes.ts";
import { evaluarHotelPorFechas, type DatosHotelPaquete, type FilaTemporadaHotelRaw, type FilaTarifaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";
import { basesPromoDeFilas, filasPorClave, netosDeColumna } from "../lib/calc/netosPorTemporada.ts";
import { planPromoPorNoche } from "../lib/calc/promoCalculadora.ts";
import { aplicarDescuentoNeta } from "../lib/calc/descuentoHotel.ts";
import { evaluarNinoGratis, calcularBeneficioNinoGratis, validarNinoGratis, asignarMenores, type HabitacionOcupada } from "../lib/hoteles/ninoGratis.ts";

// #125 — motor compartido: promoción «seguir la base ganadora» + «un niño gratis por habitación».
// Calendario 2026-12: BASE A = 1–5 (doble 100.000 / niño 50.000 / infante 20.000), BASE B = 6–12 (150.000 / 75.000 / 30.000), ambas prioridad 1.
// Promoción PRE BF = 4–8, prioridad 5, −10 %. Una estadía de 5 noches desde el 4 duerme 4, 5 (A) y 6, 7, 8 (B).
const HOY = "2026-11-17";
const raw = (o: Partial<FilaTemporadaHotelRaw> & { nombre: string }): FilaTemporadaHotelRaw => ({
  fecha_inicio: null, fecha_fin: null, prioridad: 1, compra_inicio: null, compra_fin: null,
  tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null, ...o,
});
const tar = (temporada: string, o: Partial<FilaTarifaHotelRaw>): FilaTarifaHotelRaw =>
  ({ tipo_habitacion: "Estandar", alimentacion: "PAM", temporada, neto_sencilla: null, neto_doble: null, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, ...o });
const COL: Record<string, string> = { doble: "neto_doble", nino: "neto_nino", nino2: "neto_nino2", infante: "neto_infante" };
const RA = raw({ id: 1, nombre: "BASE A", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-05" });
const RB = raw({ id: 2, nombre: "BASE B", fecha_inicio: "2026-12-06", fecha_fin: "2026-12-12" });
const TAR = [
  tar("BASE A", { neto_doble: 100_000, neto_nino: 50_000, neto_nino2: 40_000, neto_infante: 20_000 }),
  tar("BASE B", { neto_doble: 150_000, neto_nino: 75_000, neto_nino2: 60_000, neto_infante: 30_000 }),
];
const SIGUE = (o: Partial<FilaTemporadaHotelRaw> = {}) => raw({
  id: 10, nombre: "PRE BF", fecha_inicio: "2026-12-04", fecha_fin: "2026-12-08", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10,
  promo_sigue_base: true, hotel_promocion_reglas: [{ grupo_id: null, valor: 10, dias: null }], ...o,
} as Partial<FilaTemporadaHotelRaw> & { nombre: string });
function detalle(vigs: FilaTemporadaHotelRaw[], tarifas: FilaTarifaHotelRaw[], acom: keyof typeof COL, ida = "2026-12-04", n = 5, ocupantes = 2) {
  const porClave = filasPorClave(tarifas);
  return liquidarHotelNochesConTemporadas({
    fechaIda: ida, numNoches: n, temporadas: vigs.map(toTemporadaRango), netoPorTemporada: netosDeColumna(porClave, COL[acom]),
    hoy: HOY, regimen: "PAM", basePromoPorClave: basesPromoDeFilas(porClave), acomodacion: acom, ocupantes: acom === "doble" ? ocupantes : undefined,
  });
}
const total = (v: FilaTemporadaHotelRaw[], t: FilaTarifaHotelRaw[], acom: keyof typeof COL, ida?: string, n?: number) => detalle(v, t, acom, ida, n)?.total ?? null;

describe("#125 modo «seguir la base ganadora» — un solo cálculo para hotel, paquete y tarifario", () => {
  test("cruza A→B: el % se aplica a la base que gana cada noche — 2×90.000 + 3×135.000 = 585.000", () => {
    assert.equal(total([RA, RB, SIGUE()], TAR, "doble"), 585_000);
  });
  test("la cotización por fechas del hotel (evaluarHotelPorFechas) da el mismo neto que el motor", () => {
    const datos: DatosHotelPaquete = {
      paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2026-12-01", fecha_viaje_fin: "2026-12-31" },
      armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel Test", hotel_moneda: "COP" },
      temporadas: [RA, RB, SIGUE()], tarifas: TAR, serviciosIncluidos: [], blackouts: [],
    };
    assert.equal(evaluarHotelPorFechas(datos, "2026-12-04", 5)?.combos[0]?.netos?.["doble"], 585_000);
  });
  test("estadía enteramente en una base: mismo resultado que la promoción vinculada a esa base (compatibilidad numérica)", () => {
    const vinculada = SIGUE({ promo_sigue_base: false, promo_base_id: 1, fecha_inicio: "2026-12-01", fecha_fin: "2026-12-03" } as never);
    const sigue = SIGUE({ fecha_inicio: "2026-12-01", fecha_fin: "2026-12-03" });
    assert.equal(total([RA, RB, vinculada], TAR, "doble", "2026-12-01", 3), 270_000);
    assert.equal(total([RA, RB, sigue], TAR, "doble", "2026-12-01", 3), 270_000);
  });
  test("las noches fuera de las fechas de la promoción conservan la base (estadía 2→7 dic: 2 noches base A, 3 con promo)", () => {
    // 2, 3 (A sin promo: 100.000 c/u) ; 4, 5 (A con promo: 90.000) ; 6 (B con promo: 135.000)
    assert.equal(total([RA, RB, SIGUE()], TAR, "doble", "2026-12-02", 5), 2 * 100_000 + 2 * 90_000 + 135_000);
  });
  test("empate genuino de prioridad entre dos bases la misma noche ⇒ la noche NO se vende (null)", () => {
    const B2 = raw({ id: 3, nombre: "BASE B2", fecha_inicio: "2026-12-04", fecha_fin: "2026-12-05" });
    assert.equal(total([RA, RB, B2, SIGUE()], [...TAR, tar("BASE B2", { neto_doble: 110_000 })], "doble"), null);
  });
  test("tarifa base faltante para la acomodación en una noche ⇒ null (no se inventa precio)", () => {
    assert.equal(total([RA, RB, SIGUE()], [TAR[0], tar("BASE B", { neto_nino: 75_000 })], "doble"), null);
  });
  test("noche sin ninguna base ⇒ null (la promoción no crea disponibilidad)", () => {
    assert.equal(total([RA, SIGUE()], TAR, "doble"), null);
  });
  test("promoción con prioridad igual a la de la base ganadora ⇒ empate, no se vende (nunca se elige una)", () => {
    assert.equal(total([RA, RB, SIGUE({ prioridad: 1 })], TAR, "doble"), null);
  });
  test("un solo descuento: el valor de la regla se aplica una vez (no hay fila propia de la promoción que lo repita)", () => {
    const conFilaVieja = [...TAR, tar("PRE BF", { neto_doble: 50_000, temporada_base: "BASE A", precio_final_autoritativo: true } as Partial<FilaTarifaHotelRaw>)];
    assert.equal(total([RA, RB, SIGUE()], conFilaVieja, "doble"), 585_000);
  });
  test("base con grupos de días: la regla única aplica al grupo que gana la noche", () => {
    // 2027-01-04 lunes … 2027-01-10 domingo. Semana L–J y fin de semana V–D.
    const A = raw({ id: 1, nombre: "ALTA", fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", hotel_temporada_grupos: [{ id: "g-sem", dias: [1, 2, 3, 4], activo: true }, { id: "g-fs", dias: [5, 6, 7], activo: true }] } as never);
    const t = [tar("ALTA", { grupo_id: "g-sem", neto_doble: 100_000 }), tar("ALTA", { grupo_id: "g-fs", neto_doble: 150_000 })];
    const p = SIGUE({ fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31" });
    assert.equal(total([A, p], t, "doble", "2027-01-07", 3), 90_000 + 135_000 + 135_000); // jue (sem) + vie + sáb (fin de semana)
  });
});

describe("#125 infantes y menores en el modo nuevo", () => {
  test("INFANTE conserva su tarifa base; adultos, Niño 1 y Niño 2 reciben el %", () => {
    assert.equal(total([RA, RB, SIGUE()], TAR, "infante"), 2 * 20_000 + 3 * 30_000);
    assert.equal(total([RA, RB, SIGUE()], TAR, "nino"), 2 * 45_000 + 3 * 67_500);
    assert.equal(total([RA, RB, SIGUE()], TAR, "nino2"), 2 * 36_000 + 3 * 54_000);
  });
  test("promoción vinculada EXISTENTE: su comportamiento con infante NO cambia (sigue descontando, 20.000 → 18.000)", () => {
    const vinculada = SIGUE({ promo_sigue_base: false, promo_base_id: 1, fecha_inicio: "2026-12-01", fecha_fin: "2026-12-03" } as never);
    assert.equal(total([RA, RB, vinculada], TAR, "infante", "2026-12-01", 3), 3 * 18_000);
  });
});

describe("#125 plan por noche (vista previa con fecha)", () => {
  const vig = (v: Partial<TemporadaRango> & { nombre: string }): TemporadaRango =>
    ({ fecha_inicio: null, fecha_fin: null, prioridad: 1, tipo: "tarifa", compra_inicio: null, compra_fin: null, regimen_restringido: null, ...v });
  const A = vig({ nombre: "BASE A", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-05" });
  const B = vig({ nombre: "BASE B", fecha_inicio: "2026-12-06", fecha_fin: "2026-12-12" });
  const P = vig({ nombre: "PRE BF", fecha_inicio: "2026-12-04", fecha_fin: "2026-12-08", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 });
  const valor = (b: string) => (b === "BASE A" ? 100_000 : b === "BASE B" ? 150_000 : null);
  test("dos tramos: A (4–5) y B (6–8) con base, % y resultado", () => {
    const p = planPromoPorNoche({ promo: "PRE BF", vigencias: [A, B, P], regimen: "PAM", pct: 10, valorBase: valor });
    assert.equal(p.noches, 5);
    assert.deepEqual(p.tramos.map((t) => [t.desde, t.hasta, t.noches, t.base, t.netoBase, t.netoPromo, t.estado]), [
      ["2026-12-04", "2026-12-05", 2, "BASE A", 100_000, 90_000, "ok"],
      ["2026-12-06", "2026-12-08", 3, "BASE B", 150_000, 135_000, "ok"],
    ]);
    assert.equal(p.todoOk, true);
  });
  test("niño gratis: muestra la tarifa de niño de la base y con la promoción", () => {
    const p = planPromoPorNoche({ promo: "PRE BF", vigencias: [A, B, P], regimen: "PAM", pct: 10, ninoGratis: true, valorBase: valor, valorNinoBase: (b) => (b === "BASE A" ? 50_000 : 75_000) });
    assert.deepEqual(p.tramos.map((t) => [t.ninoGratis, t.netoNinoBase, t.netoNinoPromo]), [[true, 50_000, 45_000], [true, 75_000, 67_500]]);
  });
  test("empate, noche sin base, prioridad insuficiente y tarifa faltante quedan señalados por tramo", () => {
    const B2 = vig({ nombre: "BASE B2", fecha_inicio: "2026-12-04", fecha_fin: "2026-12-05" });
    assert.equal(planPromoPorNoche({ promo: "PRE BF", vigencias: [A, B2, P], regimen: "PAM", pct: 10 }).tramos[0].estado, "base_empatada");
    assert.equal(planPromoPorNoche({ promo: "PRE BF", vigencias: [A, P], regimen: "PAM", pct: 10 }).tramos.at(-1)?.estado, "sin_base");
    assert.equal(planPromoPorNoche({ promo: "PRE BF", vigencias: [A, B, { ...P, prioridad: 1 }], regimen: "PAM", pct: 10 }).tramos[0].estado, "prioridad_insuficiente");
    const sinB = planPromoPorNoche({ promo: "PRE BF", vigencias: [A, B, P], regimen: "PAM", pct: 10, valorBase: (b) => (b === "BASE A" ? 100_000 : null) });
    assert.equal(sinB.tramos[1].estado, "sin_valor_base");
    assert.equal(sinB.todoOk, false);
  });
  test("acotado: un rango largo se agrupa en tramos y nunca excede el máximo", () => {
    const bases = Array.from({ length: 100 }, (_, i) => vig({ nombre: `B${i}`, fecha_inicio: new Date(Date.UTC(2027, 0, 1 + i * 2)).toISOString().slice(0, 10), fecha_fin: new Date(Date.UTC(2027, 0, 2 + i * 2)).toISOString().slice(0, 10) }));
    const p = planPromoPorNoche({ promo: "LARGA", vigencias: [...bases, vig({ nombre: "LARGA", fecha_inicio: "2027-01-01", fecha_fin: "2027-07-30", prioridad: 5, tipo: "descuento_pct", descuento_valor: 5 })], regimen: "PAM", pct: 5, maxSegmentos: 20 });
    assert.equal(p.tramos.length, 20);
    assert.equal(p.truncado, true);
  });
});

const hab = (indice: number, adultos: number, nino: number, nino2 = 0, infantes = 0): HabitacionOcupada => ({ indice, adultos, nino, nino2, infantes });

describe("#125 un niño gratis por habitación — elegibilidad por habitación", () => {
  const gratis = (h: HabitacionOcupada[], extra: Parameters<typeof evaluarNinoGratis>[0] extends infer T ? Partial<T> : never = {}) => evaluarNinoGratis({ habitaciones: h, ...extra });
  test("1 habitación con 2 adultos y 1 niño ⇒ 1 niño gratis (ranura Niño 1)", () => {
    const r = gratis([hab(0, 2, 1)]);
    assert.deepEqual(r.gratis, { nino: 1, nino2: 0 });
    assert.equal(r.habitaciones[0].motivo, "ok");
  });
  test("2 adultos y 2 niños ⇒ exactamente UNO gratis; el otro paga su tarifa de niño", () => {
    assert.deepEqual(gratis([hab(0, 2, 1, 1)]).gratis, { nino: 1, nino2: 0 });
  });
  test("solo Niño 2 en la habitación ⇒ ese es el gratis", () => {
    assert.deepEqual(gratis([hab(0, 2, 0, 1)]).gratis, { nino: 0, nino2: 1 });
  });
  test("dos habitaciones que califican ⇒ un niño gratis por habitación, sin juntar cupos", () => {
    assert.deepEqual(gratis([hab(0, 2, 1), hab(1, 2, 1, 1)]).gratis, { nino: 2, nino2: 0 });
  });
  test("una habitación con menos de 2 adultos no recibe beneficio y NO se compensa con otra", () => {
    const r = gratis([hab(0, 1, 1), hab(1, 2, 0)]);
    assert.deepEqual(r.gratis, { nino: 0, nino2: 0 });
    assert.deepEqual(r.habitaciones.map((h) => h.motivo), ["adultos_insuficientes", "sin_nino"]);
  });
  test("tres adultos repartidos 1+2: solo la habitación con 2 adultos califica", () => {
    assert.deepEqual(gratis([hab(0, 1, 1), hab(1, 2, 1)]).gratis, { nino: 1, nino2: 0 });
  });
  test("infantes nunca son elegibles ni cuentan como niño", () => {
    const r = gratis([hab(0, 2, 0, 0, 2)]);
    assert.equal(r.gratis.nino + r.gratis.nino2, 0);
    assert.equal(r.habitaciones[0].motivo, "sin_nino");
  });
});

describe("#125 un niño gratis — edad propia de la promoción vs regla del hotel", () => {
  const e = (edades: number[], min: number | null, max: number | null, h: HabitacionOcupada[] = [hab(0, 2, 1)]) =>
    evaluarNinoGratis({ habitaciones: h, edad: { edadMin: min, edadMax: max }, edades });
  test("sin edad propia rige la regla del hotel: todo niño clasificado como Niño es elegible", () => {
    assert.deepEqual(evaluarNinoGratis({ habitaciones: [hab(0, 2, 1)] }).gratis, { nino: 1, nino2: 0 });
  });
  test("límites inclusivos: min y max entran; min−1 y max+1 no", () => {
    assert.equal(e([3], 3, 12).gratis.nino, 1);
    assert.equal(e([12], 3, 12).gratis.nino, 1);
    assert.equal(e([2], 3, 12).gratis.nino, 0);
    assert.equal(e([13], 3, 12).gratis.nino, 0);
    assert.equal(e([2], 3, 12).habitaciones[0].motivo, "sin_nino_elegible");
  });
  test("la edad propia puede ser más estrecha que la del hotel (niño de 9 con rango 3–8 no es elegible)", () => {
    assert.equal(e([9], 3, 8).gratis.nino, 0);
  });
  test("F4: con edad propia y sin edades exactas el beneficio NO se resuelve: sinResolver + bloqueo con explicación (no se concede ni se retiene en silencio)", () => {
    const r = evaluarNinoGratis({ habitaciones: [hab(0, 2, 1)], edad: { edadMin: 3, edadMax: 12 }, edades: null });
    assert.equal(r.sinResolver, true);
    assert.equal(r.habitaciones[0].motivo, "edades_no_disponibles");
    const nn = [{ indice: 0, neto: 100, promocion: "P", edadMin: 3, edadMax: 12 }];
    const b = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1)], edades: null, nochesNino: nn, pctMk: 0 });
    assert.match(b?.bloqueo ?? "", /3–12 años.*edad de cada niño/);
  });
  test("F2: cada edad queda atada a una habitación y a una ranura (orden declarado → habitaciones en orden → Niño 1 antes que Niño 2)", () => {
    const m = asignarMenores([hab(0, 2, 1, 1), hab(1, 2, 1)], [14, 8, 6]);
    assert.deepEqual(m.map((x) => [x.orden, x.edad, x.habitacion, x.clase]), [[0, 14, 0, "nino"], [1, 8, 0, "nino2"], [2, 6, 1, "nino"]]);
  });
  test("F2: el niño gratis es el primer niño ELEGIBLE de la habitación y se condona SU tarifa real, no «la primera»", () => {
    // edades [14, 8], rango 3–12: el de 8 años ocupa la ranura Niño 2 ⇒ gratis = Niño 2
    const r = e([14, 8], 3, 12, [hab(0, 2, 1, 1)]);
    assert.deepEqual(r.habitaciones[0].gratis, { orden: 1, edad: 8, habitacion: 0, clase: "nino2" });
    // [8, 14]: el de 8 ocupa Niño 1
    assert.equal(e([8, 14], 3, 12, [hab(0, 2, 1, 1)]).habitaciones[0].gratis?.clase, "nino");
    // los dos elegibles: el primero declarado
    assert.equal(e([8, 10], 3, 12, [hab(0, 2, 1, 1)]).habitaciones[0].gratis?.orden, 0);
    // ninguno elegible
    assert.equal(e([14, 15], 3, 12, [hab(0, 2, 1, 1)]).habitaciones[0].motivo, "sin_nino_elegible");
  });
  test("F2: varias habitaciones con edades mixtas se resuelven por la asignación (ya no se retiene ni se concede por conteo global)", () => {
    const a = e([5, 15], 3, 12, [hab(0, 2, 1), hab(1, 2, 1)]);
    assert.deepEqual(a.habitaciones.map((h) => h.gratis?.edad ?? null), [5, null]);
    assert.equal(a.habitaciones[1].motivo, "sin_nino_elegible");
    const b = e([15, 5], 3, 12, [hab(0, 2, 1), hab(1, 2, 1)]);
    assert.deepEqual(b.habitaciones.map((h) => h.gratis?.edad ?? null), [null, 5]);
    assert.deepEqual(e([5, 6], 3, 12, [hab(0, 2, 1), hab(1, 2, 1)]).gratis, { nino: 2, nino2: 0 });
  });
  test("F2 (importe): con niños [14, 8] y rango 3–12 se condona Niño 2 (50), no Niño 1 (100)", () => {
    const n1 = [{ indice: 0, neto: 100, promocion: "P", edadMin: 3, edadMax: 12 }];
    const n2 = [{ indice: 0, neto: 50, promocion: "P", edadMin: 3, edadMax: 12 }];
    const b = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1, 1)], edades: [14, 8], nochesNino: n1, nochesNino2: n2, pctMk: 0 })!;
    assert.equal(b.costoNeto, 50);
    assert.equal(b.total, -50);
    assert.deepEqual(b.ninos.map((x) => [x.clase, x.edad, x.habitacion]), [["nino2", 8, 0]]);
    assert.match(b.descripcion, /hab\. 1: niño de 8 años \(Niño 2\)/);
  });
  test("validación única de la configuración (formulario, acción y base)", () => {
    const ok = (a: Parameters<typeof validarNinoGratis>[0], tipo = "descuento_pct", conReglas = true) => validarNinoGratis(a, { tipo, conReglas }).ok;
    assert.equal(ok({ activo: true }), true);
    assert.equal(ok({ activo: true, edadMin: 3, edadMax: 12 }), true);
    assert.equal(ok({ activo: true, edadMin: 3 }), false);
    assert.equal(ok({ activo: true, edadMin: 12, edadMax: 3 }), false);
    assert.equal(ok({ activo: true, edadMin: 3.5, edadMax: 12 }), false);
    assert.equal(ok({ activo: true, edadMin: 0, edadMax: 18 }), false);
    assert.equal(ok({ activo: false, edadMin: 3, edadMax: 12 }), false);
    assert.equal(ok({ activo: true }, "descuento_monto"), false);
    assert.equal(ok({ activo: true }, "descuento_pct", false), false);
    assert.equal(ok({ activo: false }), true);
  });
});

describe("#125 un niño gratis — importe: SOLO el alojamiento de las noches de la promoción", () => {
  const nochesNino = detalle([RA, RB, SIGUE({ nino_gratis: true } as never)], TAR, "nino")?.ninoGratisNoches;
  const nochesNino2 = detalle([RA, RB, SIGUE({ nino_gratis: true } as never)], TAR, "nino2")?.ninoGratisNoches;
  test("el motor entrega las 5 noches ganadas por la promoción con su neto de niño ya con el % (sin infante)", () => {
    assert.deepEqual(nochesNino?.map((n) => n.neto), [45_000, 45_000, 67_500, 67_500, 67_500]);
    assert.equal(nochesNino?.[0].promocion, "PRE BF");
    assert.equal(detalle([RA, RB, SIGUE({ nino_gratis: true } as never)], TAR, "infante")?.ninoGratisNoches, undefined);
  });
  test("una habitación 2 adultos + 1 niño: gratis = hotel con markup de las 5 noches del niño (45.000×2 + 67.500×3 = 292.500)", () => {
    const b = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1)], nochesNino, nochesNino2, pctMk: 0.2 });
    assert.equal(b?.costoNeto, 292_500);
    assert.equal(b?.total, -Math.round(marcar(292_500, 0.2) * 100) / 100);
  });
  test("dos habitaciones calificadas duplican el importe; con dos niños en una habitación sigue siendo uno solo", () => {
    const uno = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1)], nochesNino, nochesNino2, pctMk: 0.2 })!;
    const dos = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1), hab(1, 2, 1)], nochesNino, nochesNino2, pctMk: 0.2 })!;
    const dosNinos = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1, 1)], nochesNino, nochesNino2, pctMk: 0.2 })!;
    assert.equal(dos.total, uno.total * 2);
    assert.equal(dosNinos.total, uno.total);
  });
  test("sin 2 adultos el importe es 0 y la habitación queda explicada", () => {
    const b = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 1, 1)], nochesNino, nochesNino2, pctMk: 0.2 })!;
    assert.equal(b.total, 0);
    assert.equal(b.sinBeneficio[0].motivo, "adultos_insuficientes");
  });
  test("estadía que solo en parte cae en la promoción: gratis únicamente esas noches (2→7 dic: 4, 5 y 6)", () => {
    const n = detalle([RA, RB, SIGUE({ nino_gratis: true } as never)], TAR, "nino", "2026-12-02", 5)?.ninoGratisNoches;
    assert.deepEqual(n?.map((x) => x.neto), [45_000, 45_000, 67_500]);
  });
  test("ajuste del neto (EBB / moneda) se aplica a cada noche igual que al neto de esa clase", () => {
    const b = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1)], nochesNino, nochesNino2, pctMk: 0, ajustarNeto: (n) => n * 0.9 })!;
    assert.equal(b.costoNeto, 263_250);
  });
  test("sin promoción con niño gratis: no hay beneficio (null) y el motor no agrega nada", () => {
    assert.equal(detalle([RA, RB, SIGUE()], TAR, "nino")?.ninoGratisNoches, undefined);
    assert.equal(calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1)], pctMk: 0.2 }), null);
  });
  test("la promoción ni siquiera necesita nino_gratis para el precio: el total de adultos es el mismo con o sin el beneficio", () => {
    assert.equal(total([RA, RB, SIGUE({ nino_gratis: true } as never)], TAR, "doble"), 585_000);
    assert.equal(liquidarHotelNoches({ fechaIda: "2026-12-04", numNoches: 5, temporadas: [RA, RB, SIGUE()].map(toTemporadaRango), netoPorTemporada: netosDeColumna(filasPorClave(TAR), "neto_doble"), hoy: HOY, regimen: "PAM", basePromoPorClave: {}, acomodacion: "doble", ocupantes: 2 }), 585_000);
  });
});

describe("#125 Tarifario («desde») y paquete usan el mismo motor que el hotel", () => {
  test("«desde» de la ventana 1–12 dic para 5 noches = noche más barata (A con promo 90.000) × 5, igual que el motor de la estadía", () => {
    const temporadas = [RA, RB, SIGUE()].map(toTemporadaRango);
    const porClave = filasPorClave(TAR);
    const desde = liquidarHotelMasBarato({ desde: "2026-12-01", hasta: "2026-12-12", numNoches: 5, temporadas, netoPorTemporada: netosDeColumna(porClave, "neto_doble"),
      hoy: HOY, regimen: "PAM", basePromoPorClave: basesPromoDeFilas(porClave), acomodacion: "doble", ocupantes: 2 });
    assert.equal(desde, 5 * 90_000);
  });
});

// ── F1 (auditoría): el niño gratis se calcula sobre el alojamiento realmente PAGADERO tras la promoción de ESTADÍA ──────────────────────────────────
describe("#125 F1 — niño gratis frente a las promociones de estadía y EBB / Long Stay", () => {
  const BASE = raw({ id: 1, nombre: "BASE X", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-10" });
  const TARX = [tar("BASE X", { neto_doble: 200_000, neto_nino: 100_000, neto_nino2: 80_000 })];
  const FOLLOW = SIGUE({ nombre: "SIGUE X", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-10", nino_gratis: true } as never);
  const estadia = (o: Partial<FilaTemporadaHotelRaw>) => raw({ id: 20, nombre: "ESTADIA", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-10", prioridad: 4, min_noches: 2, ...o } as never);
  const GRATIS_PROMEDIO = estadia({ tipo: "promo_noche_gratis" });
  const GRATIS_ULTIMA = estadia({ tipo: "promo_noche_gratis", noche_gratis_regla: "ultima", dias_promo: [1, 2, 3, 4, 5, 6, 7] } as never);
  const MONTO_PERSONA = estadia({ tipo: "descuento_monto", descuento_valor: 30_000, descuento_unidad: "persona_estadia", dias_promo: [1, 2, 3, 4, 5, 6, 7] } as never);
  const suma = (n?: { neto: number }[]) => (n ?? []).reduce((t, x) => t + x.neto, 0);
  const prueba = (nombre: string, extra: FilaTemporadaHotelRaw[], ida: string, noches: number) => test(nombre, () => {
    const vigs = [BASE, FOLLOW, ...extra];
    const r = detalle(vigs, TARX, "nino", ida, noches)!;
    assert.ok(r.ninoGratisNoches?.length, "el motor reporta las noches con niño gratis");
    // todas las noches son de la promoción ⇒ lo condonable = TODO lo que el niño pagaría de alojamiento, ni más ni menos
    assert.ok(Math.abs(suma(r.ninoGratisNoches) - r.total) < 1e-6, `Σ noches ${suma(r.ninoGratisNoches)} = total pagadero ${r.total}`);
    const b = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1)], nochesNino: r.ninoGratisNoches, pctMk: 0 })!;
    assert.equal(b.costoNeto, Math.round(r.total * 100) / 100);
    assert.ok(b.costoNeto <= r.total + 1e-6, "nunca se condona más que lo pagadero");
  });
  test("reproducción de la auditoría: 2 noches, adulto 200.000, niño 100.000, −10 %, una noche gratis de estadía: el niño paga 90.000 y se condona 90.000 (antes 180.000)", () => {
    const vigs = [BASE, FOLLOW, GRATIS_PROMEDIO];
    const nino = detalle(vigs, TARX, "nino", "2026-12-04", 2)!;
    assert.equal(nino.total, 90_000);
    assert.deepEqual(nino.ninoGratisNoches?.map((n) => n.neto), [45_000, 45_000]);
    const b = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1)], nochesNino: nino.ninoGratisNoches, pctMk: 0 })!;
    assert.equal(b.costoNeto, 90_000);
    // 2 adultos + 1 niño gratis: el costo del hotel = adultos 2 × 180.000 + niño (90.000 − 90.000) = 360.000 (antes 270.000)
    const doble = detalle(vigs, TARX, "doble", "2026-12-04", 2)!;
    assert.equal(doble.total, 180_000);
    assert.equal(2 * doble.total + nino.total - b.costoNeto, 360_000);
  });
  prueba("noche gratis «promedio» de la estadía (3 noches)", [GRATIS_PROMEDIO], "2026-12-04", 3);
  prueba("noche gratis elegida «última» (3 noches): esa noche queda en 0", [GRATIS_ULTIMA], "2026-12-04", 3);
  prueba("monto fijo por persona de la estadía (3 noches)", [MONTO_PERSONA], "2026-12-04", 3);
  test("noche gratis «última»: la noche libre no se condona dos veces (queda en 0 en la lista)", () => {
    const r = detalle([BASE, FOLLOW, GRATIS_ULTIMA], TARX, "nino", "2026-12-04", 3)!;
    assert.deepEqual(r.ninoGratisNoches?.map((n) => [n.indice, n.neto]), [[0, 90_000], [1, 90_000], [2, 0]]);
  });
  test("estadía PARCIAL: solo las noches de la promoción se condonan; las demás las paga el niño (estadía 2→6 dic, la promoción cubre 4–6)", () => {
    const parcial = { ...FOLLOW, fecha_inicio: "2026-12-04" } as FilaTemporadaHotelRaw;
    const r = detalle([BASE, parcial, GRATIS_PROMEDIO], TARX, "nino", "2026-12-02", 4)!; // noches 2, 3 (base) y 4, 5 (promo)
    // base: 100.000 × 2 + promo 90.000 × 2 = 380.000; noche gratis promedio ⇒ × 3/4 = 285.000; promoción: 180.000 × 3/4 = 135.000
    assert.equal(r.total, 285_000);
    assert.deepEqual(r.ninoGratisNoches?.map((n) => [n.indice, n.neto]), [[2, 67_500], [3, 67_500]]);
    const b = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1)], nochesNino: r.ninoGratisNoches, pctMk: 0 })!;
    assert.equal(b.costoNeto, 135_000);
    assert.equal(r.total - b.costoNeto, 150_000, "las 2 noches fuera de la promoción siguen a cargo del niño, también con la noche gratis repartida");
  });
  test("EBB / Long Stay legítimo: el descuento se aplica sobre la SUMA pagadera (igual que al neto de la clase) y el niño gratis iguala exactamente su alojamiento", () => {
    const r = detalle([BASE, FOLLOW, GRATIS_PROMEDIO], TARX, "nino", "2026-12-04", 3)!;
    const d = { etiqueta: "EBB", tipo: "ebb" as const, umbral: 30, pct: 12 };
    const pagadero = aplicarDescuentoNeta(r.total, d, "COP");
    const b = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1)], nochesNino: r.ninoGratisNoches, pctMk: 0, ajustarNeto: (n) => aplicarDescuentoNeta(n, d, "COP") })!;
    assert.equal(b.costoNeto, pagadero);
  });
  test("sin promoción de estadía el resultado no cambia (compatibilidad): Σ noches = total", () => {
    const r = detalle([BASE, FOLLOW], TARX, "nino", "2026-12-04", 3)!;
    assert.deepEqual(r.ninoGratisNoches?.map((n) => n.neto), [90_000, 90_000, 90_000]);
    assert.equal(r.total, 270_000);
  });
});
