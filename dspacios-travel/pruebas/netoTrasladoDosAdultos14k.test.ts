// Regresión del caso reportado: NETO, 2 adultos con la MISMA tarifa y un traslado manual que cubre a ambos, total exigible $997.040. El desglose por pasajero debe salir 2 × $498.520 con el traslado en
// «Servicios incluidos». Causa: el checkout B2B no declaraba a qué hotel pertenece un servicio que cubre a todos, el servidor respondía «no está asignado a un hotel» y no generaba el resumen.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resumenNetoCarrito } from "../lib/cotizacion/resumenNeto.ts";
import { filasDeUnidad } from "../lib/cotizacion/filasResumen.ts";
import { coberturaTotalB2B, leerCobertura } from "../lib/cotizacion/coberturaEntrada.ts";

const unidad = {
  ref: "item-0", paquete: { id: 1, nombre: "Paquete" }, hotel: "Hotel", categoria: "Estándar", regimen: "Desayuno", paxTotal: 2, infantes: 0, grupoIncluido: 0,
  personas: [{ clave: "adulto:doble", etiqueta: "Adulto", tipo: "adulto" as const, cantidad: 2, tarifa: 375_000 }],
};
const traslado = (hotelRef: string | null, precio: number, pax = 2) => ({ id: "manual-0", nombre: "Traslado privado", precio, pax, hotelRef, cubre: null });

describe("NETO · 2 adultos con el mismo traslado: 2 × 498.520 = 997.040", () => {
  test("sin recobro: un grupo de 2 adultos a 498.520 con el traslado y el total exacto", () => {
    // PVP 750.000 + 348.933 = 1.098.933; impuesto del hotel 80.000; base 1.018.933; ordinaria 10 % = 101.893; exigible 997.040
    const r = resumenNetoCarrito({ unidades: [unidad], servicios: [traslado("item-0", 348_933)], impuestoPorUnidad: { "item-0": 80_000 }, impuestoServicio: {}, recobroTotal: 0, participacion: 0, comisionTotalAliado: 101_893, moneda: "COP", exigible: 997_040 });
    assert.ok(r.ok, r.ok ? "" : r.motivo);
    const [u] = r.resumen.unidades;
    assert.equal(r.resumen.totalCentavos, 99_704_000);
    assert.deepEqual(u.grupos.map((g) => [g.tipo, g.cantidad, g.tarifaCentavos, g.subtotalCentavos, g.incluye]), [["adulto", 2, 49_852_000, 99_704_000, ["Traslado privado"]]]);
    assert.deepEqual(filasDeUnidad(u).map((f) => [f.adultos, f.ninos, f.tarifaAdulto, f.total, f.ajuste]), [[2, 0, 49_852_000, 99_704_000, false]]);
  });

  test("con recobro (100.000, participación 50.000): el mismo desglose y el recobro no aparece en ninguna tarifa visible por separado", () => {
    // PVP 750.000 + 100.000 de recobro + 293.378 = 1.143.378; base 1.143.378 − 80.000 − 100.000 = 963.378; ordinaria 96.338; comisión 146.338; exigible 997.040
    const r = resumenNetoCarrito({ unidades: [unidad], servicios: [traslado("item-0", 293_378)], impuestoPorUnidad: { "item-0": 80_000 }, impuestoServicio: {}, recobroTotal: 100_000, participacion: 50_000, comisionTotalAliado: 146_338, moneda: "COP", exigible: 997_040 });
    assert.ok(r.ok, r.ok ? "" : r.motivo);
    const [u] = r.resumen.unidades;
    assert.equal(r.resumen.totalCentavos, 99_704_000);
    assert.deepEqual(u.grupos.map((g) => [g.cantidad, g.tarifaCentavos, g.incluye]), [[2, 49_852_000, ["Traslado privado"]]]);
    assert.deepEqual(filasDeUnidad(u).map((f) => [f.adultos, f.tarifaAdulto, f.total]), [[2, 49_852_000, 99_704_000]]);
  });

  test("el servicio sin hotel declarado NO se asigna por ser el único hotel: sin resumen y con el motivo (el origen es la declaración del carrito)", () => {
    const r = resumenNetoCarrito({ unidades: [unidad], servicios: [traslado(null, 348_933)], impuestoPorUnidad: { "item-0": 80_000 }, impuestoServicio: {}, recobroTotal: 0, participacion: 0, comisionTotalAliado: 101_893, moneda: "COP", exigible: 997_040 });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.motivo, /no está asignado a un hotel/);
  });
});

describe("el carrito B2B declara la cobertura total de los servicios del único hotel", () => {
  test("un servicio que cubre a todos los pasajeros del hotel queda asignado al hotel 0; uno que cubre a menos o ya está ligado a un hotel NO se declara", () => {
    assert.deepEqual(coberturaTotalB2B(2, [], [{ pax: 2 }]), { cupos: {}, tours: {}, manuales: { 0: { hotel: 0, cubre: null } } });
    assert.deepEqual(coberturaTotalB2B(2, [{ pax: 2, ligado: false }, { pax: 2, ligado: true }, { pax: 1, ligado: false }], [{ pax: 1 }, { pax: 2 }]), { cupos: {}, tours: { 0: { hotel: 0, cubre: null } }, manuales: { 1: { hotel: 0, cubre: null } } });
    assert.equal(coberturaTotalB2B(2, [{ pax: 1, ligado: false }], [{ pax: 1 }]), null, "nada que declarar");
  });
  test("lo que declara lo acepta la lectura del servidor", () => {
    const c = coberturaTotalB2B(2, [], [{ pax: 2 }]);
    const l = leerCobertura({ cobertura: c });
    assert.ok(l.ok && l.cobertura?.manuales[0]?.hotel === 0);
  });
  test("el envío del checkout la usa en la venta B2B (y la normal conserva su cobertura elegida)", () => {
    const fuente = fs.readFileSync(new URL("../app/tarifario/checkout/page.tsx", import.meta.url), "utf8");
    assert.match(fuente, /armarEntrada\(itemsNormalizados, activoCob \? cob\.cobertura : coberturaB2B,/);
    assert.match(fuente, /coberturaB2B = hayB2B && /);
  });
});
