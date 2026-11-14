import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluarHotelPorFechas,
  type DatosHotelPaquete,
  type FilaTemporadaHotelRaw,
  type FilaTarifaHotelRaw,
} from "../lib/reservar/liquidacionHotel.ts";

// ─────────────────────────────────────────────────────────────────────────
// CARACTERIZACIÓN #43/#60 (entrega E3) — evaluador por fechas (`evaluarHotelPorFechas`): cotización por fechas,
// carrito y el mapa de netos por combinación. Documenta el comportamiento ACTUAL, incluidos casos que el diseño
// (docs/tecnico/vigencias-por-dia-43-60.md) propone cambiar solo para vigencias con grupos y con decisión del dueño.
// «RIESGO CONOCIDO» = no aprobado como deseado; si una entrega futura lo altera para un hotel SIN grupos, debe fallar.
// Sin Supabase ni reloj: fechas fijas de 2027 y `fechaReserva` explícita.
// ─────────────────────────────────────────────────────────────────────────

const vigencia = (over: Partial<FilaTemporadaHotelRaw> & { nombre: string }): FilaTemporadaHotelRaw => ({
  fecha_inicio: "2027-03-01", fecha_fin: "2027-03-31", prioridad: 1, compra_inicio: null, compra_fin: null,
  tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null, ...over,
});
const tarifa = (temporada: string, over: Partial<FilaTarifaHotelRaw> = {}): FilaTarifaHotelRaw => ({
  tipo_habitacion: "Estandar", alimentacion: "PAM", temporada,
  neto_sencilla: null, neto_doble: 100_000, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, ...over,
});
function datos(over: Partial<DatosHotelPaquete> = {}): DatosHotelPaquete {
  return {
    paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2027-01-01", fecha_viaje_fin: "2027-12-31" },
    armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel Test", hotel_moneda: "COP" },
    temporadas: [vigencia({ nombre: "ALTA" })], tarifas: [tarifa("ALTA")], serviciosIncluidos: [], blackouts: [], ...over,
  };
}
const combo = (d: DatosHotelPaquete, ida: string, noches: number) => evaluarHotelPorFechas(d, ida, noches)?.combos[0];

describe("1. Acomodaciones: solo se publica la que tiene precio de habitación > 0", () => {
  test("sencilla con precio y doble SIN precio → la doble no aparece (falta de cobertura silenciosa)", () => {
    const c = combo(datos({ tarifas: [tarifa("ALTA", { neto_sencilla: 150_000, neto_doble: null })] }), "2027-03-05", 3);
    assert.ok(c);
    assert.equal(c!.precios["sencilla"], 563_000); // 450.000 / 0,8 = 562.500, redondeado hacia arriba al millar
    assert.equal(c!.precios["doble"], undefined);
  });
  test("un neto de habitación en 0 significa «no aplica»: no se publica", () => {
    const c = combo(datos({ tarifas: [tarifa("ALTA", { neto_sencilla: 150_000, neto_doble: 0 })] }), "2027-03-05", 3);
    assert.equal(c!.precios["doble"], undefined);
  });
  test("niño sin tarifa → no se publica (la reserva con niños fallaría); infante sin tarifa → se publica con hotel en 0", () => {
    const c = combo(datos(), "2027-03-05", 3);
    assert.equal(c!.precios["nino"], undefined);
    assert.equal(c!.netos?.["infante"], 0);
    assert.ok(c!.precios["infante"] != null);
  });
});

describe("2. RIESGO CONOCIDO — filas duplicadas para la misma (categoría, régimen, temporada): gana la ÚLTIMA en silencio", () => {
  test("100.000 y luego 120.000 → se usa 120.000 (3 noches = 360.000 neto → 450.000 con markup)", () => {
    const c = combo(datos({ tarifas: [tarifa("ALTA", { neto_doble: 100_000 }), tarifa("ALTA", { neto_doble: 120_000 })] }), "2027-03-05", 3);
    assert.equal(c!.precios["doble"], 450_000);
    assert.equal(c!.netos?.["doble"], 360_000);
  });
  test("con el orden invertido gana la otra: el resultado depende del orden de lectura", () => {
    const c = combo(datos({ tarifas: [tarifa("ALTA", { neto_doble: 120_000 }), tarifa("ALTA", { neto_doble: 100_000 })] }), "2027-03-05", 3);
    assert.equal(c!.precios["doble"], 375_000);
  });
});

describe("3. RIESGO CONOCIDO — por acomodación, la base prioritaria sin precio cae a la inferior", () => {
  // ALTA (prioridad 1): sencilla 150.000 y doble 100.000. PUENTE (prioridad 3, 5–7 mar): solo doble 200.000.
  const d = datos({
    temporadas: [vigencia({ nombre: "ALTA" }), vigencia({ nombre: "PUENTE", fecha_inicio: "2027-03-05", fecha_fin: "2027-03-07", prioridad: 3 })],
    tarifas: [tarifa("ALTA", { neto_sencilla: 150_000, neto_doble: 100_000 }), tarifa("PUENTE", { neto_sencilla: null, neto_doble: 200_000 })],
  });
  test("4 noches desde el 4 mar: doble = 100.000 + 3 × 200.000 = 700.000 neto; sencilla = 4 × 150.000 = 600.000 (se vende a precio ALTA durante PUENTE)", () => {
    const c = combo(d, "2027-03-04", 4);
    assert.equal(c!.netos?.["doble"], 700_000);
    assert.equal(c!.netos?.["sencilla"], 600_000);
  });
});

describe("4. «N noches, 1 gratis» dentro del evaluador: descuenta el promedio y respeta min_noches", () => {
  const d = datos({ temporadas: [vigencia({ nombre: "ALTA" }), vigencia({ nombre: "GRATIS", prioridad: 5, tipo: "promo_noche_gratis", min_noches: 3 })] });
  test("3 noches a 100.000: se pagan 2 (200.000 neto → 250.000 con markup)", () => {
    const c = combo(d, "2027-03-05", 3);
    assert.equal(c!.netos?.["doble"], 200_000);
    assert.equal(c!.precios["doble"], 250_000);
  });
  test("2 noches (menos que min_noches): sin descuento", () => {
    assert.equal(combo(d, "2027-03-05", 2)!.netos?.["doble"], 200_000 + 0); // 2 × 100.000, sin bonificación
  });
});

describe("5. RIESGO CONOCIDO — EBB / Long Stay (#90) se acumula con una promoción materializada", () => {
  // ALTA 100.000; PROMO (descuento_pct, prioridad 2) con su propia fila final 80.000. Markup 20 %. EBB 12 % a ≥ 30 días.
  const temporadas = [vigencia({ nombre: "ALTA" }), vigencia({ nombre: "PROMO", prioridad: 2, tipo: "descuento_pct", descuento_valor: 20 })];
  const promo = tarifa("PROMO", { neto_doble: 80_000, precio_final_autoritativo: true, temporada_base: "ALTA" });
  const ebb = { reglasDescuento: [{ tipo: "ebb" as const, umbral: 30, pct: 12 }], fechaReserva: "2027-01-04" }; // 60 días antes del 5 mar
  test("sin reglas: la promo gana: 3 × 80.000 = 240.000 neto → 300.000", () => {
    assert.equal(combo(datos({ temporadas, tarifas: [tarifa("ALTA"), promo] }), "2027-03-05", 3)!.precios["doble"], 300_000);
  });
  test("con EBB 12 %: se descuenta SOBRE el total de la promo: 240.000 × 0,88 = 211.200 → 264.000", () => {
    const c = combo(datos({ temporadas, tarifas: [tarifa("ALTA"), promo], ...ebb }), "2027-03-05", 3);
    assert.equal(c!.netos?.["doble"], 211_200);
    assert.equal(c!.precios["doble"], 264_000);
  });
  test("referencia: sin la promo, EBB sobre la base da 300.000 × 0,88 = 264.000 neto → 330.000", () => {
    const c = combo(datos({ tarifas: [tarifa("ALTA")], ...ebb }), "2027-03-05", 3);
    assert.equal(c!.precios["doble"], 330_000);
  });
});

describe("6. Empate de prioridad en el evaluador: el orden de las vigencias decide", () => {
  const A = vigencia({ nombre: "TEMP-A" }), B = vigencia({ nombre: "TEMP-B" });
  const tarifas = [tarifa("TEMP-A", { neto_doble: 100_000 }), tarifa("TEMP-B", { neto_doble: 150_000 })];
  test("A,B → 100.000 por noche; B,A → 150.000 por noche", () => {
    assert.equal(combo(datos({ temporadas: [A, B], tarifas }), "2027-03-05", 2)!.netos?.["doble"], 200_000);
    assert.equal(combo(datos({ temporadas: [B, A], tarifas }), "2027-03-05", 2)!.netos?.["doble"], 300_000);
  });
});
