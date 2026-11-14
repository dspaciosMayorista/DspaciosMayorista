import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liquidarHotelNochesConTemporadas, toTemporadaRango } from "../lib/calc/paquetes.ts";
import { evaluarHotelPorFechas, type DatosHotelPaquete, type FilaTemporadaHotelRaw, type FilaTarifaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";
import { costoHotelPersona } from "../lib/reservar/costosObligacionesCarrito.ts";
import { construirComposicion, leerComposicion, type BaseMotor } from "../lib/cotizacion/composicionPrecio.ts";
import { aplicarDescuentoNeta } from "../lib/calc/descuentoHotel.ts";
import { basesPromoDeFilas, filasPorClave, netosDeColumna } from "../lib/calc/netosPorTemporada.ts";

// ─────────────────────────────────────────────────────────────────────────
// #43/#60 entrega 4 — REPARTO EXACTO del descuento por habitación y OCUPACIÓN del hotel por el recorrido real:
// motor → cotización por fechas (evaluarHotelPorFechas, misma función que cotizar/carrito/reserva por fechas) →
// costo del hotel de la reserva y del carrito (costoHotelPersona, fuente única de reservar/actions y del carrito)
// → composición que se guarda (construirComposicion) y se vuelve a leer (leerComposicion).
// 1 de enero de 2027 = viernes ⇒ lun 4 … jue 7.
// ─────────────────────────────────────────────────────────────────────────
const HOY = "2026-11-12";
const vig = (over: Partial<FilaTemporadaHotelRaw> & { nombre: string }): FilaTemporadaHotelRaw => ({
  fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", prioridad: 1, compra_inicio: null, compra_fin: null,
  tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null, ...over,
});
const tar = (temporada: string, over: Partial<FilaTarifaHotelRaw> = {}): FilaTarifaHotelRaw => ({
  tipo_habitacion: "Estandar", alimentacion: "PAM", temporada,
  neto_sencilla: null, neto_doble: null, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, ...over,
});
const BASE = vig({ id: 1, nombre: "BASE" });
const PROMO = (valor: number) => vig({ id: 10, nombre: "HAB", tipo: "descuento_monto", prioridad: 2, descuento_unidad: "habitacion_noche",
  promo_base_id: 1, hotel_promocion_reglas: [{ grupo_id: null, valor, dias: null }] });
const datos = (tarifas: FilaTarifaHotelRaw[], valor: number, extra: Partial<DatosHotelPaquete> = {}, pax?: Record<string, number>, moneda = "COP"): DatosHotelPaquete => ({
  paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "D", fecha_viaje_inicio: "2027-01-01", fecha_viaje_fin: "2027-12-31" },
  armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "H", hotel_moneda: moneda, ...(pax ? { hotel_pax_tarifa: pax } : {}) },
  temporadas: [BASE, PROMO(valor)], tarifas, serviciosIncluidos: [], blackouts: [], ...extra,
});

describe("1. Motor: el total de UNA habitación es exacto (sin pasar por la tarifa por persona)", () => {
  test("triple, 100.000 por persona, −20.000 por habitación y noche, 3 noches ⇒ 840.000 por habitación; descuento 60.000", () => {
    const porClave = filasPorClave([tar("BASE", { neto_triple: 100_000 })]);
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2027-01-04", numNoches: 3, temporadas: [BASE, PROMO(20_000)].map(toTemporadaRango), netoPorTemporada: netosDeColumna(porClave, "neto_triple"),
      hoy: HOY, regimen: "PAM", basePromoPorClave: basesPromoDeFilas(porClave), acomodacion: "triple", ocupantes: 3,
    });
    assert.deepEqual(r?.habitacion, { ocupantes: 3, total: 840_000, descuento: 60_000 });
    assert.equal(r!.total * 3, 840_000);
  });
  test("sin ocupantes del hotel el descuento por habitación NO aplica (nunca se supone 1/2/3/4)", () => {
    const porClave = filasPorClave([tar("BASE", { neto_triple: 100_000 })]);
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2027-01-04", numNoches: 1, temporadas: [BASE, PROMO(20_000)].map(toTemporadaRango), netoPorTemporada: netosDeColumna(porClave, "neto_triple"),
      hoy: HOY, regimen: "PAM", basePromoPorClave: basesPromoDeFilas(porClave), acomodacion: "triple",
    });
    assert.equal(r?.total, 100_000);
    assert.equal(r?.habitacion, undefined);
  });
  test("sin descuento por habitación el resultado es el de siempre (sin campo habitacion)", () => {
    const porClave = filasPorClave([tar("BASE", { neto_triple: 100_000 / 3 })]);
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2027-01-04", numNoches: 3, temporadas: [BASE].map(toTemporadaRango), netoPorTemporada: netosDeColumna(porClave, "neto_triple"),
      hoy: HOY, regimen: "PAM", basePromoPorClave: {}, acomodacion: "triple", ocupantes: 3,
    });
    assert.equal(r?.total, 100_000 / 3 + 100_000 / 3 + 100_000 / 3);
    assert.equal(r?.habitacion, undefined);
  });
});

describe("2. Ocupación autoritativa del hotel (no estándar)", () => {
  test("una «doble» que el hotel tarifa con 3 personas: la habitación es 3 × 100.000 − 20.000 = 280.000 (no 180.000)", () => {
    const ev = evaluarHotelPorFechas(datos([tar("BASE", { neto_doble: 100_000 })], 20_000, {}, { doble: 3 }), "2027-01-04", 1);
    assert.deepEqual(ev?.combos[0]?.netosHabitacion?.doble, { ocupantes: 3, total: 280_000, descuento: 20_000 });
  });
  test("sin fila de configuración rige el valor por defecto de la reserva (doble = 2)", () => {
    const ev = evaluarHotelPorFechas(datos([tar("BASE", { neto_doble: 100_000 })], 20_000), "2027-01-04", 1);
    assert.deepEqual(ev?.combos[0]?.netosHabitacion?.doble, { ocupantes: 2, total: 180_000, descuento: 20_000 });
  });
  test("niños e infantes no son ocupantes tarifados: no reciben el descuento por habitación", () => {
    const ev = evaluarHotelPorFechas(datos([tar("BASE", { neto_doble: 100_000, neto_nino: 50_000 })], 20_000, {}, { doble: 3 }), "2027-01-04", 1);
    assert.equal(ev?.combos[0]?.netos?.nino, 50_000);
    assert.equal(ev?.combos[0]?.netosHabitacion?.nino, undefined);
  });
});

describe("3. USD, triple y varias habitaciones: el costo de la reserva/carrito no pierde centavos", () => {
  // 33,33 USD por persona; habitación triple 99,99; −10 USD por habitación y noche; EBB 10 %.
  const ebb = { reglasDescuento: [{ tipo: "ebb" as const, umbral: 30, pct: 10, activa: true }], fechaReserva: HOY };
  const ev = evaluarHotelPorFechas(datos([tar("BASE", { neto_triple: 33.33 })], 10, ebb, { triple: 3 }, "USD"), "2027-01-04", 1);
  const combo = ev!.combos[0]!;
  test("cotización: la habitación queda en 80,99 (99,99 − 10 = 89,99 y −10 % redondeado UNA vez)", () => {
    assert.equal(combo.netosHabitacion?.triple?.total, 80.99);
  });
  test("reserva/carrito: 2 habitaciones triples cuestan exactamente 161,98 (por persona redondeada × pax daría 162,00)", () => {
    const lineasHab = [{ acom: "triple", pax: 6, habitaciones: 2 }];
    const exacto = costoHotelPersona({ lineasHab, netoPorAcom: combo.netos!, numNinos: 0, numNinos2: 0, netoHabitacionPorAcom: combo.netosHabitacion }, 0);
    assert.equal(Math.round(exacto * 100) / 100, 161.98);
    const porPersona = costoHotelPersona({ lineasHab, netoPorAcom: combo.netos!, numNinos: 0, numNinos2: 0 }, 0);
    assert.equal(Math.round(porPersona * 100) / 100, 162, "la vía por persona pierde el centavo: por eso no se usa");
    assert.equal(aplicarDescuentoNeta(89.99 / 3, { tipo: "ebb", umbral: 30, pct: 10, etiqueta: "" }, "USD"), 27);
  });
  test("varias acomodaciones: la que no tiene descuento por habitación sigue con tarifa por persona × pax", () => {
    const lineasHab = [{ acom: "triple", pax: 3, habitaciones: 1 }, { acom: "sencilla", pax: 2, habitaciones: 2 }];
    const c = costoHotelPersona({ lineasHab, netoPorAcom: { ...combo.netos!, sencilla: 50 }, numNinos: 0, numNinos2: 0, netoHabitacionPorAcom: combo.netosHabitacion }, 0);
    assert.equal(Math.round(c * 100) / 100, 80.99 + 100);
  });
  test("composición guardada y releída: neto exacto por habitación, descuento y su reparto por ocupante (suma exacta)", () => {
    const base: BaseMotor = { pctMk: 0.2, impuesto: 0, vuelo: 0, vueloNeto: null, feeInfante: 0, servicios: [], netos: combo.netos!, netosHabitacion: combo.netosHabitacion };
    const comp = construirComposicion({ base, moneda: "USD", trm: null, lineasHab: [{ acom: "triple", habitaciones: 2, pax: 6, pvp: combo.precios.triple }], lineasMenores: [], adicionales: [], total: 6 * combo.precios.triple });
    const leida = leerComposicion(JSON.parse(JSON.stringify(comp)));
    const h = leida?.lineas[0]?.habitacion;
    assert.deepEqual(h, { habitaciones: 2, ocupantes: 3, netoPorHabitacion: 80.99, descuento: 10, repartoDescuento: [3.34, 3.33, 3.33], netoHotelLinea: 161.98 });
    assert.equal(Math.round(h!.repartoDescuento.reduce((a, b) => a + b, 0) * 100), 1000);
  });
  test("COP: 20.000 entre 3 ocupantes en la composición = 6.667 + 6.667 + 6.666 (pesos enteros)", () => {
    const evc = evaluarHotelPorFechas(datos([tar("BASE", { neto_triple: 100_000 })], 20_000, {}, { triple: 3 }), "2027-01-04", 1)!;
    const c = evc.combos[0]!;
    const comp = construirComposicion({ base: { pctMk: 0.2, impuesto: 0, vuelo: 0, vueloNeto: null, feeInfante: 0, servicios: [], netos: c.netos!, netosHabitacion: c.netosHabitacion },
      moneda: "COP", trm: null, lineasHab: [{ acom: "triple", habitaciones: 1, pax: 3, pvp: c.precios.triple }], lineasMenores: [], adicionales: [], total: 3 * c.precios.triple });
    assert.deepEqual(comp.lineas[0].habitacion?.repartoDescuento, [6667, 6667, 6666]);
    assert.equal(comp.lineas[0].habitacion?.netoHotelLinea, 280_000);
  });
});

describe("4. Cableado: los recorridos reales usan el total de habitación y la ocupación del hotel", () => {
  const leer = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  test("reserva: el costo del hotel sale de costoHotelPersona con netoHabitacionPorAcom (misma función que el carrito)", () => {
    assert.match(leer("app/(dashboard)/dashboard/reservar/actions.ts"), /costoHotelTotal = costoHotelPersona\(\{ lineasHab, netoPorAcom, numNinos, numNinos2, netoHabitacionPorAcom: p\.data\.netoHabitacionPorAcom \}, numInfantes\);/);
  });
  test("reserva (computo): ocupantes = paxTarifa del hotel; EBB una vez sobre el total de la habitación; composición con netosHabitacion", () => {
    const c = leer("lib/reservar/computo.ts");
    assert.match(c, /acomodacion: l\.acom, ocupantes: paxTarifa\(l\.acom\) \}\);/);
    // Entrega 5: el EBB / Long Stay es el que decidió la precedencia para ESA acomodación (`lp.descuento`).
    assert.match(c, /netoHabitacionPorAcom\[l\.acom\] = \{ \.\.\.r\.habitacion, total: aplicarDescuentoNeta\(r\.habitacion\.total, lp\.descuento, monedaHotelOrigen63\) \};/);
    assert.match(c, /netosHabitacion: \{ \.\.\.combo\.netosHabitacion \}/);
  });
  test("cotización y generación leen la ocupación del hotel en la lectura que ya hacen (0 solicitudes nuevas)", () => {
    assert.match(leer("lib/reservar/cotizar.ts"), /hoteles\(nombre, moneda, adults_only, hotel_acomodaciones\(acomodacion, pax_tarifa\)\)/);
    assert.match(leer("app/(dashboard)/dashboard/paquetes/actions.ts"), /tarifa_bajo_solicitud, hotel_acomodaciones\(acomodacion, pax_tarifa\)\)/);
    assert.match(leer("app/(dashboard)/dashboard/paquetes/actions.ts"), /acomodacion: acom, ocupantes: ocupantesDe\(acom\) \}\)/);
  });
  test("las acciones ya no imponen la ocupación estándar", () => {
    assert.doesNotMatch(leer("app/(dashboard)/dashboard/producto/hoteles/actions.ts"), /paxEstandarParaHabitacion|OCUPANTES_HABITACION/);
  });
});
