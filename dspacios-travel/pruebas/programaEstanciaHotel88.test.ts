// #88 — Programas por hotel y vigencia con noches adicionales: motor PURO.
// Corre en test:unit (glob pruebas/**/*.test.ts). Cada cifra esperada está
// derivada a mano en el comentario de su caso (USD, mk 15 %, fee 3 %, asistencia 4/día).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fechaRegresoEstancia, fechasNochesAdicionales, itinerarioConNochesExtra, liquidarNochesAdicionales, nocheTarifaConPvp,
  primerSolape, pvpNocheUnidad, resolverVigencia, validarHotelesParaGuardar, validarOcupacionHotel, vacioPorAcom,
  type BaseHotelFila, type HotelEstancia, type NocheTarifaFila, type PorAcom,
} from "../lib/programas/estanciaHotel88.ts";
import {
  construirTablaHotelPvp, cotizarEstanciaDesdePvp, liquidarSeleccion, resolverBaseHotel, salidaPrecioDesdeBase, tarifasNocheConPvp,
  type EntradaLiquidacion, type ProgramaPrecioCabecera,
} from "../lib/programas/precioReserva57.ts";
import { pvpPrograma } from "../lib/calc/programaPrecio.ts";

const PROGRAMA: ProgramaPrecioCabecera = { moneda: "USD", pct_mk: 0.15, pct_fee_tarjeta: 0.03, asistencia_medica_dia: 4, dias: 4 };
const OPT = { pctMk: 0.15, pctFee: 0.03, asistenciaDia: 4, dias: 4, moneda: "USD" };
const por = (o: Partial<PorAcom>): PorAcom => ({ ...vacioPorAcom(), ...o });

const HOTEL: HotelEstancia = { id: 1, nombre: "Hotel Centro", zona: "Centro", tipoHabitacion: "Estándar", maxPaxHabitacion: 4, maxMenoresHabitacion: 2, proveedorId: null };
const HOTEL2: HotelEstancia = { id: 2, nombre: "Hotel Playa", zona: "Playa", tipoHabitacion: "Vista mar", maxPaxHabitacion: 3, maxMenoresHabitacion: 1, proveedorId: 77 };

// Base: netos por persona para TODA la estancia (3 noches / 4 días).
const BASE: BaseHotelFila[] = [
  { id: 1, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: por({ sencilla: 800, doble: 600, triple: 520, nino: 400 }) },
  { id: 2, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-31", modalidad: "regular", bajoSolicitud: false, neto: por({ sencilla: 700, doble: 450, triple: 400, nino: 300 }) },
  { id: 3, hotelId: 1, desde: "2027-04-01", hasta: "2027-04-30", modalidad: "privado", bajoSolicitud: false, neto: por({ sencilla: 900, doble: 700, triple: 600, nino: 450 }) },
  { id: 4, hotelId: 2, desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: por({ sencilla: 1000, doble: 800, triple: 700, nino: 500 }) },
];
// Noches (por persona): vigencia A hasta el 4/mar y B desde el 5/mar.
const NOCHES: NocheTarifaFila[] = [
  { id: 1, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-04", unidad: "persona", neto: por({ sencilla: 130, doble: 100, triple: 90, nino: 60 }) },
  { id: 2, hotelId: 1, desde: "2027-03-05", hasta: "2027-03-31", unidad: "persona", neto: por({ sencilla: 150, doble: 120, triple: 100, nino: 70 }) },
  // Hotel 2 cobra por HABITACIÓN (el menor siempre por persona).
  { id: 3, hotelId: 2, desde: "2027-03-01", hasta: "2027-03-31", unidad: "habitacion", neto: por({ sencilla: 110, doble: 180, triple: 250, nino: 50 }) },
];

function entrada(over: Partial<EntradaLiquidacion> & { hotel?: HotelEstancia; fecha?: string; k?: number; modalidad?: "privado" | "regular"; noches?: NocheTarifaFila[]; incluidas?: number }): EntradaLiquidacion {
  const hotel = over.hotel ?? HOTEL;
  const fecha = over.fecha ?? "2027-03-01";
  const base = resolverBaseHotel(BASE.filter((b) => b.hotelId === hotel.id), over.modalidad ?? "privado", fecha, hotel.nombre);
  assert.ok(base.ok, "la base debe resolverse en estas pruebas");
  return {
    programa: PROGRAMA,
    fuente: { modo: "salida", salida: salidaPrecioDesdeBase(base.fila) },
    habitaciones: over.habitaciones ?? { doble: 1 },
    ninos: over.ninos ?? 0,
    infantes: over.infantes ?? 0,
    estancia: {
      hotel,
      tarifasNoche: tarifasNocheConPvp(PROGRAMA, (over.noches ?? NOCHES).filter((n) => n.hotelId === hotel.id)),
      fechaEntrada: fecha,
      nochesIncluidas: over.incluidas ?? 3,
      nochesAdicionales: over.k ?? 0,
    },
  };
}
function ok(e: EntradaLiquidacion) {
  const r = liquidarSeleccion(e);
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  if (!r.ok) throw new Error("no ok");
  return r;
}

// ── Orden de redondeo ───────────────────────────────────────────────────────
test("redondeo BASE (regla existente): (neto + asistencia×días) → /(1−mk) → /(1−fee) → UN techo por persona; total = Σ PVP × pax", () => {
  // (600 + 4×4) / 0.85 / 0.97 = 747,1… → 748 por persona; doble = 2 pax.
  assert.equal(pvpPrograma(600, OPT), 748);
  const r = ok(entrada({ k: 0 }));
  assert.equal(r.precioVenta, 748 * 2);
  assert.equal(r.precioBase, 1496);
});

test("redondeo de NOCHES: cada noche se redondea por separado (la ficha publica un PVP por noche) y el total cuadra con esa tabla", () => {
  // 100 neto + 4 asistencia (1 día) = 104 / 0.8245 = 126,1 → 127 por noche y persona.
  assert.equal(pvpNocheUnidad(100, "persona", "doble", OPT), 127);
  // 3 noches: 3 × 127 = 381. Con UN solo techo por el bloque sería ceil(312/0.8245)=379: la diferencia
  // (2 USD por persona) es el costo de que ficha, desglose por fecha y total digan lo mismo.
  assert.equal(3 * 127, 381);
  assert.equal(pvpPrograma(300, { ...OPT, dias: 3 }), 379);
});

// ── Vigencias ───────────────────────────────────────────────────────────────
test("la vigencia base se decide por la fecha de ENTRADA, aunque las noches incluidas terminen en otra vigencia", () => {
  // Entrada 30/mar, 3 noches incluidas: termina el 2/abr (otra vigencia). La base es la de marzo.
  const b = resolverBaseHotel(BASE.filter((x) => x.hotelId === 1), "privado", "2027-03-30", "Hotel Centro");
  assert.ok(b.ok && b.fila.id === 1);
  const r = ok(entrada({ fecha: "2027-03-30", k: 0 }));
  assert.equal(r.precioBase, 748 * 2, "precio de marzo, no el de abril (700 → 877)");
});

test("límites de vigencia: los extremos están incluidos; fuera de ellos no hay tarifa y nunca se usa una cercana", () => {
  const f = [{ desde: "2027-03-01", hasta: "2027-03-04" }, { desde: "2027-03-06", hasta: "2027-03-10" }];
  assert.ok(resolverVigencia(f, "2027-03-01", "x").ok);
  assert.ok(resolverVigencia(f, "2027-03-04", "x").ok);
  const hueco = resolverVigencia(f, "2027-03-05", "tarifa de prueba");
  assert.equal(hueco.ok, false);
  if (!hueco.ok) { assert.equal(hueco.codigo, "sin_tarifa"); assert.match(hueco.error, /05\/03\/2027/); }
  assert.equal(resolverVigencia(f, "2027-03-11", "x").ok, false);
});

test("dos vigencias que cubren la misma fecha son AMBIGUAS: se bloquea, no se elige ninguna", () => {
  const f = [{ desde: "2027-03-01", hasta: "2027-03-10" }, { desde: "2027-03-10", hasta: "2027-03-20" }];
  const r = resolverVigencia(f, "2027-03-10", "tarifa de prueba");
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.codigo, "ambigua"); assert.match(r.error, /a la vez/); }
  assert.deepEqual(primerSolape(f)?.map((x) => x.desde), ["2027-03-01", "2027-03-10"]);
  assert.equal(primerSolape([{ desde: "2027-03-01", hasta: "2027-03-09" }, { desde: "2027-03-10", hasta: "2027-03-20" }]), null);
});

// ── Fechas ──────────────────────────────────────────────────────────────────
test("fechas exactas de las noches adicionales y fecha de regreso (4 días / 3 noches)", () => {
  assert.deepEqual(fechasNochesAdicionales("2027-03-01", 3, 2), ["2027-03-04", "2027-03-05"]);
  assert.deepEqual(fechasNochesAdicionales("2027-03-01", 3, 0), []);
  assert.equal(fechaRegresoEstancia("2027-03-01", 3, 0), "2027-03-04");
  assert.equal(fechaRegresoEstancia("2027-03-01", 3, 2), "2027-03-06");
  // Cruce de mes/año y bisiesto sin usar la zona horaria.
  assert.deepEqual(fechasNochesAdicionales("2027-12-30", 3, 2), ["2028-01-02", "2028-01-03"]);
  assert.equal(fechaRegresoEstancia("2028-02-27", 1, 2), "2028-03-01");
});

// ── Cero, una y varias noches ───────────────────────────────────────────────
test("cero noches: no se exige ninguna tarifa de noche y el total es el de la base", () => {
  const sinTarifas = entrada({ k: 0, noches: [] });
  const r = ok(sinTarifas);
  assert.equal(r.precioVenta, 1496);
  assert.equal(r.estancia?.nochesAdicionales, 0);
  assert.equal(r.estancia?.precioNoches, 0);
  assert.equal(r.costoNeto, 1200);
  assert.equal(r.costoNetoBase, 1200);
});

test("una noche, tarifa por persona, doble: 127 × 2 pax; costo 100 × 2; la base no cambia", () => {
  const r = ok(entrada({ k: 1 })); // noche del 4/mar → vigencia A
  assert.equal(r.estancia?.noches.length, 1);
  assert.equal(r.estancia?.noches[0].fecha, "2027-03-04");
  assert.equal(r.estancia?.noches[0].vigenciaHasta, "2027-03-04");
  assert.equal(r.estancia?.precioNoches, 254);
  assert.equal(r.precioBase, 1496);
  assert.equal(r.precioVenta, 1496 + 254);
  assert.equal(r.costoNetoBase, 1200);
  assert.equal(r.estancia?.costoNetoNoches, 200);
  assert.equal(r.costoNeto, 1400);
});

test("varias noches cruzando vigencias: cada noche usa SU vigencia (4/mar → A; 5 y 6/mar → B)", () => {
  const r = ok(entrada({ k: 3 })); // 4, 5 y 6 de marzo
  const [n1, n2, n3] = r.estancia!.noches;
  assert.deepEqual([n1.fecha, n2.fecha, n3.fecha], ["2027-03-04", "2027-03-05", "2027-03-06"]);
  assert.deepEqual([n1.tarifaId, n2.tarifaId, n3.tarifaId], [1, 2, 2]);
  // Doble por persona: A 127 (neto 100); B 120 neto → (124/0.8245=150,4) 151. Por 2 pax.
  assert.equal(n1.pvpCentavos, 127 * 2 * 100);
  assert.equal(n2.pvpCentavos, 151 * 2 * 100);
  assert.equal(r.estancia?.precioNoches, (127 + 151 + 151) * 2);
  assert.equal(r.precioVenta, 1496 + 858);
  assert.equal(r.estancia?.costoNetoNoches, (100 + 120 + 120) * 2);
  assert.equal(r.costoNeto, 1200 + 680);
});

test("SGL y DBL a la vez, tarifa por persona: sencilla 1 pax y doble 2 pax en cada noche", () => {
  const r = ok(entrada({ k: 1, habitaciones: { sencilla: 1, doble: 1 } }));
  // Noche del 4/mar (A): sencilla (134/0.8245=162,5) 163 × 1 + doble 127 × 2.
  assert.equal(r.estancia?.precioNoches, 163 + 254);
  assert.equal(r.estancia?.costoNetoNoches, 130 + 200);
  assert.equal(r.precioBase, 990 + 748 * 2);
});

test("tarifa por HABITACIÓN: se cobra por habitación y no por persona; la asistencia es de cada ocupante", () => {
  // Hotel 2, 1 doble, 2 noches (4 y 5/mar): (180 + 4×2) / 0.8245 = 228,0 → 229 por habitación y noche.
  assert.equal(pvpNocheUnidad(180, "habitacion", "doble", OPT), 229);
  const r = ok(entrada({ hotel: HOTEL2, k: 2 }));
  assert.equal(r.estancia?.precioNoches, 229 * 2);
  assert.equal(r.estancia?.costoNetoNoches, 180 * 2);
  assert.equal(r.estancia?.noches[0].lineas[0].unidad, "habitacion");
  assert.equal(r.estancia?.noches[0].lineas[0].cantidad, 1);
  // Dos habitaciones dobles duplican; una sencilla cuesta su propia tarifa de habitación (139).
  const r2 = ok(entrada({ hotel: HOTEL2, k: 1, habitaciones: { doble: 2, sencilla: 1 } }));
  assert.equal(r2.estancia?.precioNoches, 229 * 2 + 139);
  assert.equal(r2.estancia?.costoNetoNoches, 180 * 2 + 110);
});

test("privados vs regulares: la base cambia; la tarifa nocturna es la misma", () => {
  const priv = ok(entrada({ k: 2, modalidad: "privado" }));
  const reg = ok(entrada({ k: 2, modalidad: "regular" }));
  assert.equal(priv.estancia?.precioNoches, reg.estancia?.precioNoches);
  // (450 + 16)/0.8245 = 565,2 → 566 por persona.
  assert.equal(reg.precioBase, 566 * 2);
  assert.notEqual(priv.precioBase, reg.precioBase);
});

test("cambio de fecha de entrada y de acomodación recalculan base, vigencias de noche y total", () => {
  const a = ok(entrada({ fecha: "2027-03-01", k: 1 }));
  const b = ok(entrada({ fecha: "2027-04-01", k: 1, noches: [{ ...NOCHES[1], hasta: "2027-04-30" }] }));
  assert.notEqual(a.precioVenta, b.precioVenta);
  assert.equal(b.estancia?.noches[0].fecha, "2027-04-04");
  const c = ok(entrada({ k: 1, habitaciones: { triple: 1 } }));
  assert.equal(c.estancia?.precioNoches, 115 * 3, "triple 90 → (94/0.8245=114,01) 115 por persona × 3");
});

// ── Menores e infantes ──────────────────────────────────────────────────────
test("menor CON tarifa adicional explícita: se cobra por persona y noche", () => {
  const r = ok(entrada({ k: 1, ninos: 1 }));
  // Menor A: (60 + 4)/0.8245 = 77,6 → 78. Base menor: (400 + 16)/0.8245 = 504,5 → 505.
  assert.equal(r.estancia?.precioNoches, 254 + 78);
  assert.equal(r.precioBase, 1496 + 505);
  assert.equal(r.estancia?.costoNetoNoches, 200 + 60);
});

test("menor SIN tarifa adicional: la selección no se cotiza (ni 0 ni otra tarifa de respaldo)", () => {
  const sin = NOCHES.map((n) => (n.hotelId === 1 ? { ...n, neto: { ...n.neto, nino: null } } : n));
  const r = liquidarSeleccion(entrada({ k: 1, ninos: 1, noches: sin }));
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.codigo, "noches_adicionales"); assert.match(r.error, /tarifa adicional de menor/); assert.match(r.error, /04\/03\/2027/); }
  // Sin menores esa misma tarifa sí cotiza; y con 0 noches adicionales tampoco estorba.
  assert.equal(liquidarSeleccion(entrada({ k: 1, ninos: 0, noches: sin })).ok, true);
  assert.equal(liquidarSeleccion(entrada({ k: 0, ninos: 1, noches: sin })).ok, true);
});

test("menor con tarifa adicional EXPLÍCITA de $0: gratis en alojamiento, sigue pagando la asistencia de la noche", () => {
  const gratis = NOCHES.map((n) => (n.hotelId === 1 ? { ...n, neto: { ...n.neto, nino: 0 } } : n));
  const r = ok(entrada({ k: 1, ninos: 1, noches: gratis }));
  // asistencia 4 / 0.8245 = 4,85 → 5 (la fórmula, sin la guarda de neto 0).
  assert.equal(r.estancia?.precioNoches, 254 + 5);
  assert.equal(r.estancia?.costoNetoNoches, 200);
});

test("infantes: conservan la regla existente (no pagan ni tienen tarifa)", () => {
  const sin = ok(entrada({ k: 2 }));
  const con = ok(entrada({ k: 2, infantes: 1 }));
  assert.equal(con.precioVenta, sin.precioVenta);
  assert.equal(con.costoNeto, sin.costoNeto);
  assert.equal(con.totalPax, sin.totalPax + 1);
});

// ── Faltantes y ambigüedades en la liquidación ──────────────────────────────
test("falta la tarifa de UNA fecha extra: se bloquea con la fecha exacta, sin usar la vigencia cercana", () => {
  const corta = NOCHES.map((n) => (n.id === 2 ? { ...n, hasta: "2027-03-05" } : n)); // B termina el 5/mar
  const r = liquidarSeleccion(entrada({ k: 3, noches: corta })); // faltaría el 6/mar
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.codigo, "noches_adicionales"); assert.match(r.error, /06\/03\/2027/); }
  assert.equal(liquidarSeleccion(entrada({ k: 2, noches: corta })).ok, true, "con 2 noches (4 y 5/mar) sí alcanza");
});

test("dos tarifas de noche que cubren la misma fecha: ambigua, se bloquea", () => {
  const solapadas = [...NOCHES, { id: 9, hotelId: 1, desde: "2027-03-05", hasta: "2027-03-10", unidad: "persona" as const, neto: por({ doble: 999 }) }];
  const r = liquidarSeleccion(entrada({ k: 2, noches: solapadas }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /a la vez/);
});

test("acomodación sin tarifa de noche: se bloquea (la múltiple no tiene tarifa)", () => {
  const r = liquidarSeleccion(entrada({ k: 1, habitaciones: { doble: 1, multiple: 1 } }));
  // La base múltiple tampoco existe: el primer rechazo es de la base, por la regla de siempre.
  assert.equal(r.ok, false);
  const sinTriple = NOCHES.map((n) => (n.hotelId === 1 ? { ...n, neto: { ...n.neto, triple: null } } : n));
  const r2 = liquidarSeleccion(entrada({ k: 1, habitaciones: { triple: 1 }, noches: sinTriple }));
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.match(r2.error, /no tiene tarifa de noche adicional para Triple/);
});

test("noches adicionales inválidas: negativas, fraccionarias o sobre el tope", () => {
  for (const k of [-1, 1.5, 31]) {
    const r = liquidarSeleccion(entrada({ k }));
    assert.equal(r.ok, false, `k=${k}`);
  }
});

test("dos hoteles: cada uno liquida con SUS tarifas (el otro nunca se usa de respaldo)", () => {
  const h1 = ok(entrada({ k: 1 }));
  const h2 = ok(entrada({ hotel: HOTEL2, k: 1 }));
  assert.equal(h1.estancia?.noches[0].tarifaId, 1);
  assert.equal(h2.estancia?.noches[0].tarifaId, 3);
  assert.notEqual(h1.precioVenta, h2.precioVenta);
  // Un hotel sin tarifas de noche cargadas no hereda las del otro.
  const sinTarifas = liquidarSeleccion({ ...entrada({ hotel: HOTEL2, k: 1 }), estancia: { ...entrada({ hotel: HOTEL2, k: 1 }).estancia!, tarifasNoche: [] } });
  assert.equal(sinTarifas.ok, false);
});

// ── Ocupación ───────────────────────────────────────────────────────────────
test("ocupación inválida: menores sin habitación, más menores o más personas de las que admite el hotel", () => {
  const H6 = { ...HOTEL, maxPaxHabitacion: 6 }; // sin el tope de personas de por medio
  assert.equal(validarOcupacionHotel(HOTEL, { doble: 1 }, 2, 0), null);
  assert.match(validarOcupacionHotel(H6, { doble: 1 }, 3, 0) ?? "", /máximo 2 menor/);
  assert.match(validarOcupacionHotel(H6, { doble: 1 }, 2, 1) ?? "", /máximo 2 menor/, "los infantes también cuentan como menores del cuarto");
  assert.match(validarOcupacionHotel(HOTEL, { doble: 1 }, 2, 1) ?? "", /máximo 4 persona/, "2 adultos + 3 menores no caben en una habitación de 4");
  assert.match(validarOcupacionHotel(HOTEL, {}, 1, 0) ?? "", /al menos una habitación/);
  assert.match(validarOcupacionHotel(HOTEL2, { triple: 1 }, 1, 0) ?? "", /máximo 3 persona/, "triple + 1 menor = 4 en una habitación que admite 3");
  assert.equal(validarOcupacionHotel({ nombre: "X", maxPaxHabitacion: null, maxMenoresHabitacion: null }, { doble: 1 }, 5, 5), null);
  const r = liquidarSeleccion(entrada({ k: 1, ninos: 3 }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.codigo, "ocupacion_invalida");
});

test("tope por habitación: maxPaxHabitacion=2 rechaza una triple aunque la sencilla deje cupo; reserva rechaza antes de numerar", async () => {
  const H2: HotelEstancia = { ...HOTEL, maxPaxHabitacion: 2, maxMenoresHabitacion: null };
  const hab = { triple: 1, sencilla: 1 }; // 4 ocupantes en 2 habitaciones (cupo agregado 4): el total solo no lo detecta
  assert.match(validarOcupacionHotel(H2, hab, 0, 0) ?? "", /máximo 2 persona.*Triple es para 3/);
  assert.match(validarOcupacionHotel(H2, { multiple: 1, doble: 1 }, 0, 0) ?? "", /máximo 2 persona/);
  assert.equal(validarOcupacionHotel(H2, { doble: 1, sencilla: 1 }, 0, 0), null);
  // Se conserva el total de adultos + menores.
  assert.match(validarOcupacionHotel(H2, { doble: 1 }, 1, 0) ?? "", /3 ocupantes no caben en 1 habitación/);
  // Liquidación (servidor) y cotización del navegador rechazan igual.
  const r = liquidarSeleccion(entrada({ hotel: H2, k: 1, habitaciones: hab }));
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.codigo, "ocupacion_invalida");
  const c = cotizarEstanciaDesdePvp(construirTablaHotelPvp(PROGRAMA, H2, BASE, NOCHES), 3, { modalidad: "privado", fechaEntrada: "2027-03-29", nochesAdicionales: 1, habitaciones: hab, ninos: 0 });
  assert.equal(c.ok, false);
  // En reservarPrograma la liquidación (que valida la ocupación) ocurre ANTES de numerar el contrato.
  const { readFileSync } = await import("node:fs");
  const res = readFileSync(new URL("../app/(dashboard)/dashboard/reservar/actions.ts", import.meta.url), "utf8");
  const iLiq = res.indexOf("const liq = liquidarSeleccion({");
  const iNum = res.indexOf('medir("numero_contrato"');
  assert.ok(iLiq > 0 && iNum > iLiq, "liquidarSeleccion debe ir antes de siguienteNumeroContrato");
  assert.match(res.slice(iLiq, iNum), /if \(!liq\.ok\)/);
});

// ── Costos y cobertura ──────────────────────────────────────────────────────
test("la asistencia de las noches extra amplía el costo atribuible (adultos y menores; no infantes)", () => {
  const r = ok(entrada({ k: 3, ninos: 1, infantes: 1 }));
  // Asistencia base: 4/día × 4 días × (2 adultos + 1 menor) = 48; extra: 4 × 3 noches × 3 = 36.
  assert.equal(r.costoAsistencia, 48 + 36);
  assert.equal(r.costoAtribuible, r.costoNeto + 84);
  assert.equal(r.diasAsistencia, 4);
});

test("sin neto cargado en la tarifa de noche no se puede registrar el costo: falla cerrado", () => {
  const e = entrada({ k: 1 });
  const sinNeto = { ...e, estancia: { ...e.estancia!, tarifasNoche: e.estancia!.tarifasNoche.map((t) => ({ ...t, neto: undefined })) } };
  const r = liquidarSeleccion(sinNeto);
  assert.equal(r.ok, false);
});

// ── Paridad ficha/formulario ↔ servidor ─────────────────────────────────────
test("el total del navegador (solo PVP) coincide con el del servidor y la tabla no lleva ningún neto", () => {
  const casos: { hotel: HotelEstancia; k: number; hab: Record<string, number>; ninos: number; mod: "privado" | "regular"; fecha: string }[] = [
    { hotel: HOTEL, k: 0, hab: { doble: 1 }, ninos: 0, mod: "privado", fecha: "2027-03-01" },
    { hotel: HOTEL, k: 1, hab: { doble: 1 }, ninos: 0, mod: "privado", fecha: "2027-03-01" },
    { hotel: HOTEL, k: 3, hab: { sencilla: 1, doble: 2 }, ninos: 1, mod: "regular", fecha: "2027-03-01" },
    { hotel: HOTEL, k: 2, hab: { triple: 1 }, ninos: 0, mod: "privado", fecha: "2027-03-27" },
    { hotel: HOTEL2, k: 2, hab: { doble: 1, sencilla: 1 }, ninos: 1, mod: "privado", fecha: "2027-03-01" },
  ];
  for (const c of casos) {
    const servidor = ok(entrada({ hotel: c.hotel, k: c.k, habitaciones: c.hab, ninos: c.ninos, modalidad: c.mod, fecha: c.fecha }));
    const tabla = construirTablaHotelPvp(PROGRAMA, c.hotel, BASE, NOCHES);
    assert.doesNotMatch(JSON.stringify(tabla), /neto/i, "la tabla que viaja al navegador no puede llevar netos");
    assert.equal(tabla.hotel.proveedorId, null, "ni el proveedor interno del hotel");
    const cliente = cotizarEstanciaDesdePvp(tabla, 3, { modalidad: c.mod, fechaEntrada: c.fecha, nochesAdicionales: c.k, habitaciones: c.hab, ninos: c.ninos });
    assert.equal(cliente.ok, true, cliente.ok ? "" : cliente.error);
    if (!cliente.ok) continue;
    assert.equal(cliente.total, servidor.precioVenta, JSON.stringify(c));
    assert.equal(cliente.totalBase, servidor.precioBase);
    assert.equal(cliente.totalNoches, servidor.estancia?.precioNoches);
  }
});

test("el navegador y el servidor rechazan lo mismo (falta de tarifa y ocupación)", () => {
  const tabla = construirTablaHotelPvp(PROGRAMA, HOTEL, BASE, NOCHES);
  const lejos = cotizarEstanciaDesdePvp(tabla, 3, { modalidad: "privado", fechaEntrada: "2027-03-29", nochesAdicionales: 5, habitaciones: { doble: 1 }, ninos: 0 });
  assert.equal(lejos.ok, false);
  const srv = liquidarSeleccion(entrada({ fecha: "2027-03-29", k: 5 }));
  assert.equal(srv.ok, false);
  if (!lejos.ok && !srv.ok) assert.equal(lejos.error, srv.error);
  const fueraDeBase = cotizarEstanciaDesdePvp(tabla, 3, { modalidad: "privado", fechaEntrada: "2027-05-10", nochesAdicionales: 0, habitaciones: { doble: 1 }, ninos: 0 });
  assert.equal(fueraDeBase.ok, false);
});

// ── Itinerario ──────────────────────────────────────────────────────────────
const DIAS = [
  { dia: 1, titulo: "Llegada", desayuno: false, almuerzo: false, cena: true, descripcion: "Traslado al hotel" },
  { dia: 2, titulo: "Tour ciudad", desayuno: true, almuerzo: true, cena: false, descripcion: "Tour de ciudad" },
  { dia: 3, titulo: "Playa", desayuno: true, almuerzo: false, cena: false, descripcion: "Día de playa" },
  { dia: 4, titulo: "Salida", desayuno: true, almuerzo: false, cena: false, descripcion: "Traslado al aeropuerto" },
];

test("itinerario: 4 días / 3 noches con 1 extra → el día 4 pasa a ser libre y la recogida pasa al día 5", () => {
  const it = itinerarioConNochesExtra(DIAS, 1, "2027-03-01", "Hotel Centro")!;
  assert.deepEqual(it.map((d) => [d.dia, d.titulo, d.libre]), [[1, "Llegada", false], [2, "Tour ciudad", false], [3, "Playa", false], [4, "Día libre", true], [5, "Salida", false]]);
  assert.deepEqual(it.map((d) => d.fecha), ["2027-03-01", "2027-03-02", "2027-03-03", "2027-03-04", "2027-03-05"]);
  assert.equal(it[4].descripcion, "Traslado al aeropuerto", "el último día conserva su contenido");
  assert.equal(it[3].descripcion?.includes("Hotel Centro"), true);
  assert.equal(it[0].descripcion, "Traslado al hotel");
});

test("itinerario con varias noches: orden original intacto, nada duplicado y regreso coherente con la estancia", () => {
  const it = itinerarioConNochesExtra(DIAS, 3, "2027-03-01", null)!;
  assert.equal(it.length, DIAS.length + 3);
  assert.deepEqual(it.map((d) => d.dia), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(it.filter((d) => d.titulo === "Tour ciudad").length, 1, "el tour no se duplica");
  assert.equal(it.filter((d) => d.titulo === "Salida").length, 1);
  assert.equal(it.at(-1)!.fecha, fechaRegresoEstancia("2027-03-01", 3, 3), "la recogida cae en la fecha de regreso desplazada");
  assert.deepEqual(itinerarioConNochesExtra(DIAS, 0, "2027-03-01", null)!.map((d) => d.dia), [1, 2, 3, 4]);
  // Sin días no hay nada que desplazar con seguridad: no se inventa una recogida.
  assert.equal(itinerarioConNochesExtra([], 2, "2027-03-01", null), null);
});

// ── Validación al guardar el catálogo ───────────────────────────────────────
const hotelOk = () => ({
  nombre: "Hotel Centro",
  base: [{ desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", neto: por({ doble: 600 }) }],
  noches: [{ desde: "2027-03-01", hasta: "2027-03-31", unidad: "persona", neto: por({ doble: 100 }) }],
});

test("al guardar: solapes, unidad de cobro obligatoria, fechas y valores válidos", () => {
  assert.equal(validarHotelesParaGuardar([hotelOk()]), null);
  const h = hotelOk();
  assert.match(validarHotelesParaGuardar([{ ...h, base: [...h.base, { ...h.base[0], desde: "2027-03-15", hasta: "2027-04-15" }] }]) ?? "", /se solapan/);
  // Privado y regular pueden compartir fechas: son matrices distintas.
  assert.equal(validarHotelesParaGuardar([{ ...h, base: [...h.base, { ...h.base[0], modalidad: "regular" }] }]), null);
  assert.match(validarHotelesParaGuardar([{ ...h, noches: [{ ...h.noches[0], unidad: "" }] }]) ?? "", /unidad de cobro/);
  assert.match(validarHotelesParaGuardar([{ ...h, noches: [h.noches[0], { ...h.noches[0], desde: "2027-03-20" }] }]) ?? "", /noche adicional se solapan/);
  assert.match(validarHotelesParaGuardar([{ ...h, base: [{ ...h.base[0], modalidad: "x" }] }]) ?? "", /modalidad de servicios/);
  assert.match(validarHotelesParaGuardar([{ ...h, base: [{ ...h.base[0], desde: "2027-04-01" }] }]) ?? "", /termina antes/);
  assert.match(validarHotelesParaGuardar([{ ...h, noches: [{ ...h.noches[0], neto: por({ doble: -1 }) }] }]) ?? "", /negativas/);
  assert.match(validarHotelesParaGuardar([{ ...h, noches: [{ ...h.noches[0], neto: vacioPorAcom() }] }]) ?? "", /ningún valor/);
  assert.match(validarHotelesParaGuardar([h, h]) ?? "", /repetido/);
  assert.match(validarHotelesParaGuardar([{ ...h, nombre: " " }]) ?? "", /no tiene nombre/);
});

test("la tarifa de noche con PVP deja pasar el neto solo en el servidor", () => {
  const conPvp = nocheTarifaConPvp(NOCHES[0], OPT);
  assert.ok(conPvp.neto);
  const t = construirTablaHotelPvp(PROGRAMA, HOTEL, BASE, NOCHES);
  assert.ok(t.noches.every((n) => n.neto === undefined));
  const r = liquidarNochesAdicionales({
    tarifas: t.noches, hotelNombre: "H", fechaEntrada: "2027-03-01", nochesIncluidas: 3, nochesAdicionales: 1,
    habitaciones: { doble: 1 }, ninos: 0, asistenciaDia: 4,
  });
  assert.ok(r.ok && r.netoCentavos === null, "sin neto el costo es null, nunca 0 inventado");
});

// ── Confirmar la venta no duplica el costo del programa ─────────────────────
test("cobertura de CxP: la obligación de tipo «programa» cubre costo_receptivo (antes, confirmar la venta lo duplicaba)", async () => {
  const { faltantesCxP } = await import("../lib/reservar/cxpCobertura.ts");
  const costos = { costo_hotel: 0, costo_aereo: 0, costo_receptivo: 1880, costo_asistencia: 0, otros_costos: 0 };
  assert.deepEqual(faltantesCxP([{ tipo_proveedor: "programa", valor_total: 1880 }], costos), []);
  // Dos obligaciones (programa + hotel con otro proveedor): suman lo mismo, nada falta.
  assert.deepEqual(faltantesCxP([{ tipo_proveedor: "programa", valor_total: 1200 }, { tipo_proveedor: "programa", valor_total: 680 }], costos), []);
  // Si el contrato guarda más costo que las obligaciones, solo falta la DIFERENCIA (por monto, no por etiqueta).
  assert.deepEqual(faltantesCxP([{ tipo_proveedor: "programa", valor_total: 1200 }], costos), [{ tipo: "receptivo", valor: 680 }]);
  // Sin ninguna obligación, falta todo (comportamiento de siempre).
  assert.deepEqual(faltantesCxP([], costos), [{ tipo: "receptivo", valor: 1880 }]);
});

// ── Noches incluidas del programa ───────────────────────────────────────────
test("noches incluidas = días − 1; días ausentes o noches incoherentes no se adivinan", async () => {
  const { nochesIncluidasPrograma } = await import("../lib/programas/estanciaHotel88.ts");
  assert.deepEqual(nochesIncluidasPrograma({ dias: 4, noches: 3 }), { ok: true, noches: 3 });
  assert.deepEqual(nochesIncluidasPrograma({ dias: 4, noches: null }), { ok: true, noches: 3 });
  assert.deepEqual(nochesIncluidasPrograma({ dias: 1, noches: 0 }), { ok: true, noches: 0 });
  const incoherente = nochesIncluidasPrograma({ dias: 4, noches: 5 });
  assert.equal(incoherente.ok, false);
  assert.match(incoherente.ok ? "" : incoherente.error, /4 días corresponden a 3 noches y figuran 5/);
  for (const dias of [null, 0, 2.5]) assert.equal(nochesIncluidasPrograma({ dias: dias as never, noches: 3 }).ok, false, String(dias));
});

// ── Correcciones previas al PR: itinerario completo y exclusión de aéreo ────
test("validarItinerarioCompleto: exige los días 1..N exactos antes de desplazar el último", async () => {
  const { validarItinerarioCompleto } = await import("../lib/programas/estanciaHotel88.ts");
  assert.equal(validarItinerarioCompleto([{ dia: 1 }, { dia: 2 }, { dia: 3 }], 3), null);
  assert.match(validarItinerarioCompleto([{ dia: 1 }, { dia: 3 }], 3) ?? "", /faltan los días 2/);
  assert.match(validarItinerarioCompleto([{ dia: 1 }, { dia: 1 }, { dia: 2 }], 2) ?? "", /se repiten los días 1/);
  assert.match(validarItinerarioCompleto([{ dia: 1 }, { dia: 5 }], 2) ?? "", /fuera de 1–2/);
  assert.match(validarItinerarioCompleto([], null) ?? "", /no tiene configurados sus días/);
});

test("errorModoHotelConAereo: rechaza si CUALQUIERA de los dos campos marca aéreo (igual que programas_modo_hotel_terrestre_chk)", async () => {
  const { errorModoHotelConAereo } = await import("../lib/programas/estanciaHotel88.ts");
  assert.match(errorModoHotelConAereo({ tipo_transporte: "aereo" }) ?? "", /solo para programas terrestres/);
  assert.match(errorModoHotelConAereo({ incluye_aereo: true }) ?? "", /solo para programas terrestres/);
  assert.match(errorModoHotelConAereo({ tipo_transporte: "ninguno", incluye_aereo: true }) ?? "", /solo para programas terrestres/);
  assert.match(errorModoHotelConAereo({ tipo_transporte: "terrestre", incluye_aereo: true }) ?? "", /solo para programas terrestres/);
  assert.equal(errorModoHotelConAereo({ tipo_transporte: "terrestre" }), null);
  assert.equal(errorModoHotelConAereo({ tipo_transporte: "ninguno", incluye_aereo: false }), null);
  assert.equal(errorModoHotelConAereo({ tipo_transporte: null, incluye_aereo: null }), null);
});

test("modo hotel + aéreo: creación, edición y reserva validan ambos campos ANTES de escribir", async () => {
  const { readFileSync } = await import("node:fs");
  const leer = (r: string) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8");
  const prod = leer("app/(dashboard)/dashboard/producto/programas/actions.ts");
  // El validador de cabecera pasa los dos campos reales...
  assert.ok(prod.includes('errorModoHotelConAereo({ tipo_transporte: input.tipoTransporte, incluye_aereo: input.tipoTransporte === "aereo" })'));
  // ...y crear y editar lo ejecutan antes de tocar la base.
  for (const fn of ["crearPrograma", "guardarCabecera"]) {
    const cuerpo = prod.slice(prod.indexOf(`export async function ${fn}(`));
    const iVal = cuerpo.indexOf("validarCondicionYRestriccionPrograma(input)");
    const iEscritura = cuerpo.search(/\.(insert|update)\(/);
    assert.ok(iVal > 0 && iVal < iEscritura, `${fn} debe validar antes de escribir`);
  }
  // Reserva: lee ambos campos del programa y rechaza antes de procesar la estancia.
  const res = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  assert.match(res, /tipo_transporte, incluye_aereo,/);
  const iAereo = res.indexOf("errorModoHotelConAereo(prog)");
  assert.ok(iAereo > 0 && iAereo < res.indexOf("const est = input.estancia;"), "reservar rechaza antes de procesar la estancia");
});
