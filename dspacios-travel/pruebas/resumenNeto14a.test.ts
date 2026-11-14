// #14-A (N4) — resumen NETO por adulto, por niño y por servicio: ejemplos numéricos aprobados + propiedades de exactitud (nunca se pierde ni se crea un centavo).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resumenNetoCarrito } from "../lib/cotizacion/resumenNeto.ts";
import type { ServicioEntrada, UnidadBase } from "../lib/cotizacion/resumenCarrito.ts";

const unidad = (ref: string, adultos: number, tarifaAdulto: number, ninos = 0, tarifaNino = 0): UnidadBase => ({
  ref, paquete: { id: 1, nombre: null }, hotel: `Hotel ${ref}`, categoria: "Estándar", regimen: "Desayuno", paxTotal: adultos + ninos, infantes: 0, grupoIncluido: 0,
  personas: [
    { clave: "adulto:doble", etiqueta: "Adulto · Doble", tipo: "adulto", cantidad: adultos, tarifa: tarifaAdulto },
    ...(ninos ? [{ clave: "nino", etiqueta: "Niño", tipo: "nino" as const, cantidad: ninos, tarifa: tarifaNino }] : []),
  ],
});
const cent = (p: number) => Math.round(p * 100);
type Entrada = Parameters<typeof resumenNetoCarrito>[0];
const base = (o: Partial<Entrada> & Pick<Entrada, "unidades" | "comisionTotalAliado" | "exigible">): Entrada =>
  ({ servicios: [], impuestoPorUnidad: {}, impuestoServicio: {}, recobroTotal: 0, participacion: 0, moneda: "COP", ...o });
const grupos = (r: ReturnType<typeof resumenNetoCarrito>) => { assert.ok(r.ok, r.ok ? "" : r.motivo); return r.resumen.unidades.flatMap((u) => u.grupos.map((g) => [g.tipo, g.cantidad, g.tarifaCentavos])); };

describe("resumenNetoCarrito — solo hoteles", () => {
  test("2 adultos de 500.000, BNC 200.000, recobro 100.000 y participación 50.000: 485.000 por adulto, total 970.000 (ordinaria 80.000 + participación 50.000)", () => {
    const r = resumenNetoCarrito(base({ unidades: [unidad("item-0", 2, 500_000)], impuestoPorUnidad: { "item-0": 200_000 }, recobroTotal: 100_000, participacion: 50_000, comisionTotalAliado: 130_000, exigible: 970_000 }));
    assert.deepEqual(grupos(r), [["adulto", 2, cent(485_000)]]);
  });

  test("sin participación el recobro se queda en la base: ordinaria 90.000 ⇒ 505.000 por adulto, total 1.010.000", () => {
    const r = resumenNetoCarrito(base({ unidades: [unidad("item-0", 2, 500_000)], impuestoPorUnidad: { "item-0": 200_000 }, recobroTotal: 100_000, comisionTotalAliado: 90_000, exigible: 1_010_000 }));
    assert.deepEqual(grupos(r), [["adulto", 2, cent(505_000)]]);
  });

  test("sin recobro conserva la regla vigente: comisión 80.000 ⇒ 460.000 por adulto, total 920.000", () => {
    const r = resumenNetoCarrito(base({ unidades: [unidad("item-0", 2, 500_000)], impuestoPorUnidad: { "item-0": 200_000 }, comisionTotalAliado: 80_000, exigible: 920_000 }));
    assert.deepEqual(grupos(r), [["adulto", 2, cent(460_000)]]);
  });

  test("adultos y niño: la ordinaria se reparte entre TODOS (el niño también la lleva) y la participación solo a los adultos; suma exacta", () => {
    const r = resumenNetoCarrito(base({ unidades: [unidad("item-0", 2, 500_000, 1, 200_000)], impuestoPorUnidad: { "item-0": 200_000 }, recobroTotal: 100_000, participacion: 50_000, comisionTotalAliado: 150_000, exigible: 1_150_000 }));
    assert.ok(r.ok);
    const g = r.resumen.unidades[0].grupos;
    assert.ok(g.find((x) => x.tipo === "nino")!.tarifaCentavos < cent(200_000), "el niño lleva parte de la comisión");
    assert.equal(g.reduce((s, x) => s + x.subtotalCentavos, 0) + r.resumen.unidades[0].ajusteCentavos, cent(1_150_000));
  });

  test("varios hoteles: no hay reparto único por pasajero (la comisión se liquida por contrato y los contratos se agrupan después); se devuelve el motivo, no un resumen que podría no cuadrar", () => {
    const total = 1_700_000.01, comision = 140_000;
    const r = resumenNetoCarrito(base({ unidades: [unidad("item-0", 2, 500_000), unidad("item-1", 2, 300_000)], impuestoPorUnidad: { "item-0": 200_000, "item-1": 100_000 }, recobroTotal: 100_000.01, comisionTotalAliado: comision, exigible: Math.round((total - comision) * 100) / 100 }));
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.motivo, /varios hoteles.*cada contrato muestra su total exigible/);
  });

  test("si el total no cuadra con lo exigible no se genera (nunca un reparto que no suma)", () => {
    const r = resumenNetoCarrito(base({ unidades: [unidad("item-0", 2, 500_000)], impuestoPorUnidad: { "item-0": 200_000 }, comisionTotalAliado: 80_000, exigible: 919_999 }));
    assert.equal(r.ok, false);
  });
});

describe("resumenNetoCarrito — hoteles con servicios adicionales", () => {
  const tour = (precio: number, pax: number, hotelRef = "item-0"): ServicioEntrada => ({ id: "tour-0", nombre: "Islas del Rosario", precio, pax, hotelRef, cubre: null });

  test("2 adultos + 1 niño + tour de 300.000 (3 pax): la comisión se reparte entre hotel y tour sobre lo comisionable; el tour queda en su NETO y todo suma el exigible", () => {
    // PVP 1.200.000 hotel (BNC 200.000 ⇒ base 1.000.000) + 300.000 tour (sin BNC) = 1.500.000; base total 1.300.000; 10 % = 130.000; exigible 1.370.000.
    const r = resumenNetoCarrito(base({ unidades: [unidad("item-0", 2, 500_000, 1, 200_000)], servicios: [tour(300_000, 3)], impuestoPorUnidad: { "item-0": 200_000 }, comisionTotalAliado: 130_000, exigible: 1_370_000 }));
    assert.ok(r.ok, r.ok ? "" : r.motivo);
    const u = r.resumen.unidades[0];
    assert.equal(u.totalCentavos, cent(1_370_000));
    assert.equal(u.grupos.reduce((s, g) => s + g.subtotalCentavos, 0) + u.ajusteCentavos, cent(1_370_000));
    // El tour lleva su parte: 130.000 × 300.000 / 1.300.000 = 30.000 ⇒ NETO 270.000 entre 3 pasajeros (90.000 c/u) dentro de cada tarifa.
    const adulto = u.grupos.find((g) => g.tipo === "adulto")!, nino = u.grupos.find((g) => g.tipo === "nino")!;
    assert.deepEqual(adulto.incluye, ["Islas del Rosario"]);
    // Hotel: 1.000.000 base ⇒ 100.000 de ordinaria entre adultos y niño por peso (adultos 416.666,67 c/u; niño 166.666,66): niño = 200.000 − 16.666,67 + 90.000.
    assert.ok(nino.tarifaCentavos > cent(272_000) && nino.tarifaCentavos < cent(274_000), `niño ${nino.tarifaCentavos}`);
  });

  test("el valor no comisionable de un servicio queda ÍNTEGRO: un tour de 300.000 que es todo no comisionable no lleva comisión", () => {
    const r = resumenNetoCarrito(base({ unidades: [unidad("item-0", 2, 500_000)], servicios: [tour(300_000, 2)], impuestoPorUnidad: { "item-0": 200_000 }, impuestoServicio: { "tour-0": 300_000 }, comisionTotalAliado: 80_000, exigible: 1_220_000 }));
    assert.ok(r.ok, r.ok ? "" : r.motivo);
    const adulto = r.resumen.unidades[0].grupos[0];
    // Cada adulto: 500.000 − 40.000 de comisión + 150.000 del tour (íntegro) = 610.000.
    assert.equal(adulto.tarifaCentavos, cent(610_000));
  });

  test("con recobro, participación y servicio: la participación solo sale de los adultos y todo suma exacto", () => {
    // Hotel 1.000.000 (BNC 200.000) + tour 300.000 + recobro 100.000 ⇒ 1.400.000; participación 50.000 ⇒ base = 1.400.000 − 200.000 − 100.000 = 1.100.000; ordinaria 110.000; exigible 1.240.000.
    const r = resumenNetoCarrito(base({ unidades: [unidad("item-0", 2, 500_000)], servicios: [tour(300_000, 2)], impuestoPorUnidad: { "item-0": 200_000 }, recobroTotal: 100_000, participacion: 50_000, comisionTotalAliado: 160_000, exigible: 1_240_000 }));
    assert.ok(r.ok, r.ok ? "" : r.motivo);
    assert.equal(r.resumen.totalCentavos, cent(1_240_000));
  });

  test("sin regla aplicable NO se inventa: servicio incluido por grupo, servicio sin hotel, cobertura parcial sin pasajeros elegidos", () => {
    const e = { comisionTotalAliado: 80_000, exigible: 1_000_000, impuestoPorUnidad: { "item-0": 200_000 } };
    const conGrupo = resumenNetoCarrito(base({ ...e, unidades: [{ ...unidad("item-0", 2, 500_000), grupoIncluido: 10_000 }] }));
    assert.equal(conGrupo.ok, false); assert.match(conGrupo.ok ? "" : conGrupo.motivo, /servicio incluido por grupo/);
    const sinHotel = resumenNetoCarrito(base({ ...e, unidades: [unidad("item-0", 2, 500_000)], servicios: [{ ...tour(100_000, 2), hotelRef: null }] }));
    assert.equal(sinHotel.ok, false); assert.match(sinHotel.ok ? "" : sinHotel.motivo, /no está asignado a un hotel/);
    const parcial = resumenNetoCarrito(base({ ...e, unidades: [unidad("item-0", 2, 500_000)], servicios: [tour(100_000, 1)] }));
    assert.equal(parcial.ok, false); assert.match(parcial.ok ? "" : parcial.motivo, /selecciona los pasajeros cubiertos/);
  });

  test("propiedad: para cualquier combinación de adultos/niños, servicios, recobro y comisión, Σ tarifas + ajuste = exigible exacto", () => {
    let s = 7;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    let generados = 0;
    for (let i = 0; i < 300; i++) {
      const adultos = 1 + Math.floor(rnd() * 4), ninos = Math.floor(rnd() * 3);
      const tarifaA = 100_000 + Math.floor(rnd() * 900_000) + Math.round(rnd() * 99) / 100, tarifaN = 50_000 + Math.floor(rnd() * 200_000);
      const pvpHotel = Math.round((adultos * tarifaA + ninos * tarifaN) * 100) / 100;
      const bnc = Math.floor(rnd() * pvpHotel * 0.3);
      const precioTour = rnd() < 0.6 ? 50_000 + Math.floor(rnd() * 400_000) + Math.round(rnd() * 99) / 100 : 0;
      const bncTour = precioTour && rnd() < 0.4 ? Math.floor(rnd() * precioTour * 0.5) : 0;
      const recobro = rnd() < 0.5 ? 0 : Math.floor(rnd() * 200_000) + Math.round(rnd() * 99) / 100;
      const part = recobro > 0 && rnd() < 0.6 ? Math.floor(rnd() * recobro) : 0;
      const total = Math.round((pvpHotel + precioTour + recobro) * 100) / 100;
      const baseCom = Math.max(total - bnc - bncTour - (part > 0 ? recobro : 0), 0);
      const ordinaria = Math.round(baseCom * 0.1);
      const exigible = Math.round((total - ordinaria - part) * 100) / 100;
      const r = resumenNetoCarrito(base({
        unidades: [unidad("item-0", adultos, tarifaA, ninos, tarifaN)], servicios: precioTour ? [tour(precioTour, adultos + ninos)] : [],
        impuestoPorUnidad: { "item-0": bnc }, impuestoServicio: bncTour ? { "tour-0": bncTour } : {}, recobroTotal: recobro, participacion: part, comisionTotalAliado: ordinaria + part, exigible,
      }));
      // Una base degenerada puede no tener a quién repartir: se rechaza, nunca se genera un resumen que no suma.
      if (r.ok) { generados++; assert.equal(r.resumen.totalCentavos, cent(exigible), `iteración ${i}`); }
    }
    assert.ok(generados > 200, `se generaron ${generados} de 300`);
  });
});
