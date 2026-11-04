import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolverDescuentoHotel, etiquetaReglaGanadora, type ReglaDescuentoHotel } from "../lib/calc/descuentoHotel.ts";
import { marcar, redondearVenta } from "../lib/calc/paquetes.ts";
import { evaluarHotelPorFechas, type DatosHotelPaquete, type FilaTemporadaHotelRaw, type FilaTarifaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";

// #90 — Etiqueta de la regla ganadora: sale de la regla que usó el cálculo, solo cuando hubo descuento, y no cambia ningún importe.
const REGLAS: ReglaDescuentoHotel[] = [
  { tipo: "ebb", umbral: 30, pct: 18 }, { tipo: "ebb", umbral: 60, pct: 23 }, { tipo: "ebb", umbral: 90, pct: 28 }, { tipo: "long_stay", umbral: 4, pct: 25 },
];
const RESERVA = "2026-03-01";
const ida = (dias: number) => new Date(Date.parse(`${RESERVA}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const resolver = (dias: number, noches: number, reglas = REGLAS) => resolverDescuentoHotel(reglas, { fechaReserva: RESERVA, fechaIda: ida(dias), numNoches: noches });

describe("etiqueta de la regla ganadora", () => {
  test("EBB lleva su escalón (1/2/3), los días mínimos y el porcentaje", () => {
    assert.equal(resolver(30, 3)?.etiqueta, "EBB 1 · 30+ días · 18 %");
    assert.equal(resolver(75, 3)?.etiqueta, "EBB 2 · 60+ días · 23 %");
    assert.equal(resolver(90, 3)?.etiqueta, "EBB 3 · 90+ días · 28 %");
  });
  test("Long Stay lleva solo su porcentaje", () => assert.equal(resolver(10, 4)?.etiqueta, "Long Stay · 25 %"));
  test("sin descuento no hay etiqueta (ni objeto)", () => assert.equal(resolver(29, 3), null));
  test("EBB y Long Stay simultáneos: solo la ganadora (mayor %), nunca las dos", () => {
    assert.equal(resolver(90, 4)?.etiqueta, "EBB 3 · 90+ días · 28 %"); // 28 > 25
    assert.equal(resolver(45, 4)?.etiqueta, "Long Stay · 25 %");          // 25 > 18
    assert.doesNotMatch(resolver(90, 4)!.etiqueta!, /Long Stay/);
  });
  test("el escalón cuenta solo las reglas EBB vigentes del hotel: una inactiva no ocupa número", () => {
    const sin90 = REGLAS.map((r) => (r.umbral === 90 ? { ...r, activa: false } : r));
    assert.equal(resolver(95, 3, sin90)?.etiqueta, "EBB 2 · 60+ días · 23 %");
    assert.equal(resolver(95, 3, REGLAS.map((r) => ({ ...r, activa: false }))), null);
  });
  test("porcentaje con decimales y regla única", () => {
    assert.equal(etiquetaReglaGanadora({ tipo: "ebb", umbral: 45, pct: 12.5 }, [{ tipo: "ebb", umbral: 45, pct: 12.5 }]), "EBB 1 · 45+ días · 12,5 %");
  });
});

describe("la etiqueta no cambia el total (motor en vivo)", () => {
  const temp: FilaTemporadaHotelRaw = { nombre: "ANUAL", fecha_inicio: "2026-01-01", fecha_fin: "2027-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null };
  const tar = (): FilaTarifaHotelRaw => ({ tipo_habitacion: "Estandar", alimentacion: "FULL", temporada: "ANUAL", neto_sencilla: 150_000, neto_doble: 100_001, neto_triple: 90_000, neto_multiple: null, neto_nino: 50_000, neto_nino2: 30_000, neto_infante: 20_000 });
  const datos = (reglas: ReglaDescuentoHotel[]): DatosHotelPaquete => ({
    paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "San Andres", fecha_viaje_inicio: "2026-01-01", fecha_viaje_fin: "2027-12-31" },
    armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel X", hotel_moneda: "COP" },
    temporadas: [temp], tarifas: [tar()], serviciosIncluidos: [], blackouts: [], reglasDescuento: reglas, fechaReserva: RESERVA,
  });
  test("90 días y 4 noches: etiqueta de la ganadora y precio == fórmula independiente (neta × (1 − 28 %), markup, redondeo)", () => {
    const r = evaluarHotelPorFechas(datos(REGLAS), ida(90), 4)!;
    assert.equal(r.descuentoHotel?.etiqueta, "EBB 3 · 90+ días · 28 %");
    const netaDescontada = Math.round(100_001 * 4 * (1 - 0.28));
    assert.equal(r.combos[0].precios.doble, redondearVenta(marcar(netaDescontada, 0.2), "COP"));
  });
  test("sin descuento: sin etiqueta y precio base", () => {
    const r = evaluarHotelPorFechas(datos(REGLAS), ida(29), 3)!;
    assert.equal(r.descuentoHotel, null);
    assert.equal(r.combos[0].precios.doble, redondearVenta(marcar(100_001 * 3, 0.2), "COP"));
  });
});

describe("dónde se muestra", () => {
  const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  test("cotización por fechas: Reservar, Vista Booking (solo tras cotizar) y composición de la cotización", () => {
    assert.match(leer("app/(dashboard)/dashboard/reservar/nuevo/ReservaForm.tsx"), /<EtiquetaDescuentoHotel descuento=\{descuentoHotel\}/);
    assert.match(leer("app/tarifario/VistaBooking.tsx"), /combos && descuentoHotel && .*EtiquetaDescuentoHotel/);
    assert.match(leer("components/cotizacion/ComposicionPrecio.tsx"), /c\.descuentoHotel && .*EtiquetaDescuentoHotel/);
  });
  test("resumen de la cotización (venta y cliente): el snapshot guarda la etiqueta del cálculo y el documento la muestra", () => {
    assert.ok(leer("app/(dashboard)/dashboard/reservar/actions.ts").includes("comp.data.descuentoHotel?.etiqueta ? { descuento_hotel"));
    assert.ok(leer("lib/reservar/hotelSnapPersona.ts").includes("comp.descuentoHotel?.etiqueta ? { descuento_hotel"));
    assert.ok(leer("components/contrato/ContratoDocumento.tsx").includes("h.descuento_hotel?.etiqueta && ("));
  });
  test("la vitrina con precio base NO la usa", () => {
    for (const f of ["app/tarifario/TarifarioPublic.tsx", "app/tarifario/BuscadorBooking.tsx", "components/cotizacion/CondicionesPanel.tsx"]) assert.doesNotMatch(leer(f), /EtiquetaDescuentoHotel/, f);
  });
  test("no se confunde con la promoción de temporadas (es_promocion)", () => {
    const c = leer("components/cotizacion/EtiquetaDescuentoHotel.tsx");
    assert.doesNotMatch(c, /es_promocion|esPromocion/);
  });
});
