import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluarHotelPorFechas, type DatosHotelPaquete, type FilaTemporadaHotelRaw, type FilaTarifaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";
import { calcularBeneficioNinoGratis, evaluarNinoGratis, validarNinoGratis, type HabitacionOcupada } from "../lib/hoteles/ninoGratis.ts";
import { distribuirPorHabitaciones, type HabitacionConsultada } from "../lib/reservar/distribucionHabitaciones.ts";
import { armarItems63 } from "../lib/reservar/aceptacion63.ts";
import { construirComposicion, type BaseMotor } from "../lib/cotizacion/composicionPrecio.ts";
import { costoHotelPersona } from "../lib/reservar/costosObligacionesCarrito.ts";
import { marcar } from "../lib/calc/paquetes.ts";

// #125 — «Un niño gratis por habitación» en los consumidores de precio, con el MOTOR REAL (sin mocks de precio).
// Calendario (2026-12): BASE A = 1–5 dic, BASE B = 6–12 dic (prioridad 1). Promoción PRE BF = 4–8 dic, prioridad 5, −10 %, sigue la base ganadora, con niño gratis.
// Netos por persona y noche — A: doble 100.000, niño 50.000, niño 2 60.000, infante 20.000; B: doble 150.000, niño 75.000, niño 2 90.000, infante 30.000. Markup 20 %.
const FECHA_RESERVA = "2026-11-17";
const PCT_MK = 0.2;
const c2 = (n: number) => Math.round(n * 100) / 100;

const vig = (o: Partial<FilaTemporadaHotelRaw> & { nombre: string }): FilaTemporadaHotelRaw => ({
  fecha_inicio: null, fecha_fin: null, prioridad: 1, compra_inicio: null, compra_fin: null,
  tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null, ...o,
});
const tar = (temporada: string, o: Partial<FilaTarifaHotelRaw>): FilaTarifaHotelRaw => ({
  tipo_habitacion: "Estandar", alimentacion: "PAM", temporada,
  neto_sencilla: null, neto_doble: null, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, ...o,
});
const A = vig({ id: 1, nombre: "BASE A", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-05" });
const B = vig({ id: 2, nombre: "BASE B", fecha_inicio: "2026-12-06", fecha_fin: "2026-12-12" });
const PROMO_BASE = { id: 10, nombre: "PRE BF", fecha_inicio: "2026-12-04", fecha_fin: "2026-12-08", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 };
const REGLA = { hotel_promocion_reglas: [{ grupo_id: null, valor: 10, dias: null }] };
const promoSigue = (o: Partial<FilaTemporadaHotelRaw> = {}) => vig({ ...PROMO_BASE, ...REGLA, promo_sigue_base: true, nino_gratis: true, ...o } as FilaTemporadaHotelRaw);
const TAR = [
  tar("BASE A", { neto_doble: 100_000, neto_nino: 50_000, neto_nino2: 60_000, neto_infante: 20_000 }),
  tar("BASE B", { neto_doble: 150_000, neto_nino: 75_000, neto_nino2: 90_000, neto_infante: 30_000 }),
];

function evaluar(temporadas: FilaTemporadaHotelRaw[], ida = "2026-12-04", noches = 5, tarifas = TAR) {
  const datos: DatosHotelPaquete = {
    paquete: { pct_mk: PCT_MK, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2026-12-01", fecha_viaje_fin: "2026-12-31" },
    armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel Test", hotel_moneda: "COP" },
    temporadas, tarifas, serviciosIncluidos: [], blackouts: [], fechaReserva: FECHA_RESERVA,
  };
  return evaluarHotelPorFechas(datos, ida, noches);
}
const combo = (r: ReturnType<typeof evaluar>) => r!.combos[0];

const CFG_DOBLE = { pax_tarifa: 2, pax_max: 4, adt_min: 2, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 };
const sala = (n: number, cfg = CFG_DOBLE): HabitacionConsultada[] => Array.from({ length: n }, () => ({ acom: "doble" as const, config: cfg }));
const reparto = (n: number, ninos: number, infantes = 0, cfg = CFG_DOBLE): HabitacionOcupada[] => {
  const r = distribuirPorHabitaciones({ adultosDeclarados: 2 * n, ninos, infantes, habitaciones: sala(n, cfg) });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.habitaciones.map((h) => ({ indice: h.indice, adultos: h.adultos, nino: h.nino, nino2: h.nino2, infantes: h.infantes }));
};
const beneficio = (rooms: HabitacionOcupada[], c: NonNullable<ReturnType<typeof combo>>, edades?: number[] | null) =>
  calcularBeneficioNinoGratis({ habitaciones: rooms, edades, nochesNino: c.ninoGratisNoches?.nino, nochesNino2: c.ninoGratisNoches?.nino2, pctMk: PCT_MK });

describe("#125 motor → combo: noches ganadas por la promoción con niño gratis", () => {
  test("estadía que cruza dos bases (4–8 dic): una noche por base, con el neto de la CLASE ya con el −10 %", () => {
    const c = combo(evaluar([A, B, promoSigue()]));
    assert.deepEqual(c.ninoGratisNoches?.nino?.map((n) => n.neto), [45_000, 45_000, 67_500, 67_500, 67_500]); // A,A,B,B,B × 0,9
    assert.deepEqual(c.ninoGratisNoches?.nino2?.map((n) => n.neto), [54_000, 54_000, 81_000, 81_000, 81_000]);
    assert.equal(c.netos?.doble, 2 * 90_000 + 3 * 135_000); // 585.000: el % sigue la base de cada noche
  });
  test("la promoción solo gana parte de la estadía (2–6 dic): solo se registran sus noches (4, 5 en A y 6 en B)", () => {
    const c = combo(evaluar([A, B, promoSigue()], "2026-12-02", 5));
    assert.deepEqual(c.ninoGratisNoches?.nino?.map((n) => n.neto), [45_000, 45_000, 67_500]);
    assert.equal(c.netos?.nino, 2 * 50_000 + 45_000 * 2 + 67_500); // noches 2,3 base A sin promoción
  });
  test("infante conserva su tarifa base y nunca es «gratis»: 20.000×2 + 30.000×3; sin noches de niño gratis para infante", () => {
    const c = combo(evaluar([A, B, promoSigue()]));
    assert.equal(c.netos?.infante, 2 * 20_000 + 3 * 30_000);
    assert.equal((c.ninoGratisNoches as Record<string, unknown>)?.infante, undefined);
  });
  test("promoción SIN niño gratis (o vinculada a una sola base, o sin el modo nuevo): ninguna noche registrada y el resto del combo idéntico", () => {
    const sinNG = combo(evaluar([A, B, promoSigue({ nino_gratis: false } as Partial<FilaTemporadaHotelRaw>)]));
    const conNG = combo(evaluar([A, B, promoSigue()]));
    assert.equal(sinNG.ninoGratisNoches, undefined);
    const { ninoGratisNoches: _omitido, ...resto } = conNG;
    assert.deepEqual(resto, sinNG); // el beneficio NO cambia precios ni netos del combo: se aplica por habitación después
    const vinculada = combo(evaluar([A, B, vig({ ...PROMO_BASE, ...REGLA, promo_base_id: 1 } as FilaTemporadaHotelRaw)]));
    assert.equal(vinculada.ninoGratisNoches, undefined);
    const sinPromo = combo(evaluar([A, B]));
    assert.equal(sinPromo.ninoGratisNoches, undefined);
  });
});

describe("#125 beneficio por habitación (reparto real distribuirPorHabitaciones)", () => {
  const c = combo(evaluar([A, B, promoSigue()]));
  const VENTA_NINO = -c2(marcar(2 * 45_000 + 3 * 67_500, PCT_MK)); // 292.500 / 0,8 = 365.625

  test("una habitación, 2 adultos y 1 niño elegible: un niño gratis (Niño 1)", () => {
    const b = beneficio(reparto(1, 1), c)!;
    assert.equal(b.total, VENTA_NINO);
    assert.equal(b.costoNeto, 292_500);
    assert.deepEqual(b.ninos.map((n) => [n.clase, n.habitacion]), [["nino", 0]]);
  });
  test("una habitación, 2 adultos y 2 niños elegibles: exactamente UNO gratis; el segundo paga su tarifa promocional de niño", () => {
    const rooms = reparto(1, 2);
    assert.deepEqual([rooms[0].nino, rooms[0].nino2], [1, 1]);
    const b = beneficio(rooms, c)!;
    assert.equal(b.total, VENTA_NINO);
    assert.deepEqual(b.ninos.map((n) => [n.clase, n.habitacion]), [["nino", 0]]);
    // el Niño 2 sigue pagando: su neto promocional queda en netos.nino2 (no se toca)
    assert.equal(c.netos?.nino2, 2 * 54_000 + 3 * 81_000);
  });
  test("dos habitaciones que califican: un niño gratis POR habitación (2×), nunca juntando cupos", () => {
    // El reparto del sistema llena la primera habitación (orden de captura); con `chd_min: 1` cada habitación recibe uno (comportamiento existente, no de #125).
    const rooms = reparto(2, 2, 0, { ...CFG_DOBLE, chd_min: 1 });
    assert.deepEqual(rooms.map((r) => r.nino + r.nino2), [1, 1]);
    const b = beneficio(rooms, c)!;
    assert.equal(b.total, 2 * VENTA_NINO);
    assert.equal(b.costoNeto, 2 * 292_500);
  });
  test("dos habitaciones, una con 2 niños y otra sin: solo UNO gratis (no se traspasa el cupo de la habitación vacía)", () => {
    const rooms: HabitacionOcupada[] = [{ indice: 0, adultos: 2, nino: 1, nino2: 1, infantes: 0 }, { indice: 1, adultos: 2, nino: 0, nino2: 0, infantes: 0 }];
    const b = beneficio(rooms, c)!;
    assert.equal(b.total, VENTA_NINO);
    assert.equal(b.sinBeneficio.find((h) => h.indice === 1)?.motivo, "sin_nino");
  });
  test("habitación con menos de 2 adultos (hotel a solicitud, 1 adulto real): sin beneficio y con motivo", () => {
    const rooms: HabitacionOcupada[] = [{ indice: 0, adultos: 1, nino: 1, nino2: 0, infantes: 0 }];
    const b = beneficio(rooms, c)!;
    assert.equal(b.total, 0);
    assert.equal(b.sinBeneficio[0].motivo, "adultos_insuficientes");
  });
  test("una habitación califica y otra no (1 adulto): solo la primera recibe el niño gratis", () => {
    const rooms: HabitacionOcupada[] = [{ indice: 0, adultos: 2, nino: 1, nino2: 0, infantes: 0 }, { indice: 1, adultos: 1, nino: 1, nino2: 0, infantes: 0 }];
    assert.equal(beneficio(rooms, c)!.total, VENTA_NINO);
  });
  test("infante: no es elegible aunque la habitación califique; habitación con solo infante no recibe beneficio", () => {
    const rooms = reparto(1, 0, 1);
    assert.equal(rooms[0].infantes, 1);
    const b = beneficio(rooms, c)!;
    assert.equal(b.total, 0);
    assert.equal(b.sinBeneficio[0].motivo, "sin_nino");
    // con un niño y un infante: el infante conserva su tarifa y el niño es el gratis
    const mix = beneficio([{ indice: 0, adultos: 2, nino: 1, nino2: 0, infantes: 1 }], c)!;
    assert.equal(mix.total, VENTA_NINO);
  });
  test("solo Niño 2 en la habitación: ese niño es el gratis, con SU neto promocional (81.000 en B, 54.000 en A)", () => {
    const b = beneficio([{ indice: 0, adultos: 2, nino: 0, nino2: 1, infantes: 0 }], c)!;
    assert.equal(b.total, -c2(marcar(2 * 54_000 + 3 * 81_000, PCT_MK)));
    assert.deepEqual(b.ninos.map((n) => n.clase), ["nino2"]);
  });
  test("estadía parcialmente promocionada: solo se perdona el alojamiento de las noches que ganó la promoción (4, 5 y 6 dic)", () => {
    const cp = combo(evaluar([A, B, promoSigue()], "2026-12-02", 5));
    const b = beneficio(reparto(1, 1), cp)!;
    assert.equal(b.total, -c2(marcar(45_000 * 2 + 67_500, PCT_MK)));
    assert.ok(Math.abs(b.total) < c2(marcar(cp.netos!.nino, PCT_MK)), "menos que el hotel completo del niño");
  });
});

describe("#125 edad propia de la promoción, fallback a la del hotel y bordes", () => {
  const conEdad = (min: number, max: number) => combo(evaluar([A, B, promoSigue({ nino_gratis_edad_min: min, nino_gratis_edad_max: max } as Partial<FilaTemporadaHotelRaw>)]));
  const una = reparto(1, 1);
  test("sin edad propia rige la regla del hotel (todo menor de tarifa Niño califica; no hace falta la edad exacta)", () => {
    assert.equal(beneficio(una, combo(evaluar([A, B, promoSigue()])), null)!.total, -365_625);
  });
  test("con edad propia 5–10: 5 y 10 califican (extremos incluidos); 4 y 11 no", () => {
    const c = conEdad(5, 10);
    assert.equal(c.ninoGratisNoches?.nino?.[0].edadMin, 5);
    for (const e of [5, 7, 10]) assert.equal(beneficio(una, c, [e])!.total, -365_625, `edad ${e}`);
    for (const e of [4, 11]) {
      const b = beneficio(una, c, [e])!;
      assert.equal(b.total, 0, `edad ${e}`);
      assert.equal(b.sinBeneficio[0].motivo, "sin_nino_elegible");
    }
  });
  test("con edad propia y sin edades exactas disponibles: no se concede (no se adivina)", () => {
    const b = beneficio(una, conEdad(5, 10), null)!;
    assert.equal(b.total, 0);
    assert.match(b.bloqueo ?? "", /edad de cada niño/); // F4: no se concede ni se retiene en silencio: se pide la edad
  });
  test("edades mixtas con menores en varias habitaciones: solo donde es seguro bajo cualquier reparto (sin inventar)", () => {
    const rooms: HabitacionOcupada[] = [{ indice: 0, adultos: 2, nino: 1, nino2: 1, infantes: 0 }, { indice: 1, adultos: 2, nino: 1, nino2: 0, infantes: 0 }];
    const b = beneficio(rooms, conEdad(5, 10), [4, 7, 8])!; // F2: cada edad queda atada a su habitación y ranura (orden declarado): hab. 0 = Niño 1 (4, no elegible) + Niño 2 (7, elegible); hab. 1 = Niño 1 (8)
    assert.deepEqual(b.ninos.map((n) => [n.habitacion, n.clase, n.edad]), [[0, "nino2", 7], [1, "nino", 8]]);
    assert.equal(b.total, -(438_750 + 365_625)); // se condona la tarifa REAL de cada niño elegido (Niño 2: 351.000 / 0,8; Niño 1: 292.500 / 0,8)
    assert.equal(b.sinBeneficio.length, 0);
  });
  test("validación única de la configuración: ambos extremos o ninguno, enteros 0–17, mínimo ≤ máximo, solo % con reglas", () => {
    const ok = { tipo: "descuento_pct", conReglas: true };
    assert.equal(validarNinoGratis({ activo: true }, ok).ok, true);
    assert.equal(validarNinoGratis({ activo: true, edadMin: 5, edadMax: 10 }, ok).ok, true);
    assert.equal(validarNinoGratis({ activo: true, edadMin: 5 }, ok).ok, false);
    assert.equal(validarNinoGratis({ activo: true, edadMin: 11, edadMax: 10 }, ok).ok, false);
    assert.equal(validarNinoGratis({ activo: true, edadMin: 1.5, edadMax: 4 }, ok).ok, false);
    assert.equal(validarNinoGratis({ activo: true, edadMin: 0, edadMax: 18 }, ok).ok, false);
    assert.equal(validarNinoGratis({ activo: true }, { tipo: "descuento_monto", conReglas: true }).ok, false);
    assert.equal(validarNinoGratis({ activo: true }, { tipo: "descuento_pct", conReglas: false }).ok, false);
    assert.equal(validarNinoGratis({ activo: false, edadMin: 5, edadMax: 6 }, ok).ok, false);
  });
});

describe("#125 solo el alojamiento promocionado: hoteles, vuelo y servicios no reciben el beneficio", () => {
  test("dos hoteles: solo el que tiene la promoción aporta noches y beneficio; el otro no cambia", () => {
    const conPromo = combo(evaluar([A, B, promoSigue()]));
    const otro = combo(evaluar([A, B])); // otro hotel, sin promoción
    const rooms = reparto(1, 1);
    assert.equal(beneficio(rooms, otro), null);
    assert.equal(beneficio(rooms, conPromo)!.total, -365_625);
  });
  test("composición con vuelo y servicio incluido: el beneficio es una línea aparte igual al hotel de las noches promocionadas; vuelo, servicio y redondeo de las líneas no se tocan y todo cuadra", () => {
    const c = combo(evaluar([A, B, promoSigue()]));
    const nochesNino = c.ninoGratisNoches!.nino!;
    const hotelNinoVenta = c2(marcar(c.netos!.nino, PCT_MK));
    const VUELO = 400_000, SERV_NETO = 50_000;
    const base: BaseMotor = {
      pctMk: PCT_MK, impuesto: 0, vuelo: VUELO, vueloNeto: 300_000, feeInfante: 0,
      servicios: [{ nombre: "Asistencia médica", neto: SERV_NETO, netoMenor: SERV_NETO }],
      netos: { doble: c.netos!.doble, nino: c.netos!.nino },
    };
    const pvpDoble = Math.ceil((marcar(c.netos!.doble, PCT_MK) + marcar(SERV_NETO, PCT_MK) + VUELO) / 1000) * 1000;
    const pvpNino = Math.ceil((hotelNinoVenta + marcar(SERV_NETO, PCT_MK) + VUELO) / 1000) * 1000;
    const b = beneficio(reparto(1, 1), c)!;
    assert.equal(-b.total, c2(marcar(nochesNino.reduce((t, n) => t + n.neto, 0), PCT_MK)), "solo el hotel de las noches ganadas");
    assert.ok(-b.total < pvpNino, "nunca el PVP del niño (incluye vuelo y servicio)");
    const total = 2 * pvpDoble + pvpNino + b.total;
    const comp = construirComposicion({
      base, moneda: "COP", trm: null,
      lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: pvpDoble }],
      lineasMenores: [{ clase: "nino", cantidad: 1, tarifa: pvpNino, menorDeDos: false }],
      adicionales: [{ tipo: "nino_gratis", nombre: b.descripcion, total: b.total }], total,
    });
    assert.equal(comp.cuadra, true);
    const lineaNino = comp.lineas.find((l) => l.clave === "nino")!;
    assert.equal(lineaNino.total, pvpNino, "la línea del niño conserva su precio completo (vuelo + servicio + hotel)");
    assert.ok(lineaNino.componentes?.some((x) => x.tipo === "vuelo" && x.venta === VUELO));
    assert.ok(lineaNino.componentes?.some((x) => x.tipo === "servicio"));
    assert.equal(comp.adicionales[0].total, b.total);
  });
  test("ítems de contrato: línea firmada «Niño gratis…» (solo descripción e importe) y la suma de ítems = total cotizado", () => {
    const c = combo(evaluar([A, B, promoSigue()]));
    const b = beneficio(reparto(1, 1), c)!;
    const pvpDoble = 800_000, pvpNino = 500_000;
    const items = armarItems63({
      categoria: "Estandar", regimen: "PAM",
      lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: pvpDoble }],
      lineasMenores: [{ clase: "nino", cantidad: 1, tarifa: pvpNino, menorDeDos: false }],
      serviciosItems: [{ nombre: "Tour", precio: 100_000 }], cargoMascota: null,
      beneficioNinoGratis: { total: b.total, descripcion: b.descripcion },
    });
    const gratis = items.find((i) => i.orden === 203)!;
    assert.equal(gratis.tarifa_adulto, b.total);
    assert.equal(gratis.descripcion, b.descripcion);
    assert.equal(gratis.descripcion, "Niño gratis por habitación · PRE BF (hab. 1: niño (Niño 1))");
    assert.deepEqual(Object.keys(gratis).sort(), ["adultos", "descripcion", "ninos", "orden", "tarifa_adulto", "tarifa_nino"]); // sin neto ni detalle por noche
    const suma = items.reduce((t, i) => t + i.adultos * i.tarifa_adulto + i.ninos * i.tarifa_nino, 0); // misma fórmula que valorVisibleContratoItem
    assert.equal(gratis.adultos, 1);
    assert.equal(suma, 2 * pvpDoble + pvpNino + 100_000 + b.total);
    const sinBeneficio = armarItems63({ categoria: "E", regimen: "P", lineasHab: [], lineasMenores: [], serviciosItems: [], cargoMascota: null });
    assert.deepEqual(sinBeneficio, [], "sin beneficio la salida es la de siempre");
  });
  test("costo del hotel: se descuenta el neto de las noches del niño gratis (CxP refleja lo que el hotel NO cobra)", () => {
    const c = combo(evaluar([A, B, promoSigue()]));
    const b = beneficio(reparto(1, 1), c)!;
    const comp = { lineasHab: [{ acom: "doble", pax: 2, habitaciones: 1 }], netoPorAcom: { doble: c.netos!.doble, nino: c.netos!.nino }, numNinos: 1, numNinos2: 0 };
    const antes = costoHotelPersona(comp, 0);
    const despues = costoHotelPersona({ ...comp, beneficioNinoGratis: { costoNeto: b.costoNeto } }, 0);
    assert.equal(antes, 2 * c.netos!.doble + c.netos!.nino);
    assert.equal(despues, antes - 292_500);
    assert.equal(costoHotelPersona({ ...comp, beneficioNinoGratis: null }, 0), antes, "sin beneficio idéntico a hoy");
  });
});

describe("#125 evaluarNinoGratis — reglas puras", () => {
  test("sin habitaciones con niños no hay nada gratis; el resultado nunca junta cupos entre habitaciones", () => {
    const ev = evaluarNinoGratis({ habitaciones: [{ indice: 0, adultos: 2, nino: 0, nino2: 0, infantes: 0 }, { indice: 1, adultos: 2, nino: 1, nino2: 0, infantes: 0 }] });
    assert.deepEqual(ev.gratis, { nino: 1, nino2: 0 });
    assert.deepEqual(ev.habitaciones.map((h) => h.gratis?.clase ?? null), [null, "nino"]);
  });
});
