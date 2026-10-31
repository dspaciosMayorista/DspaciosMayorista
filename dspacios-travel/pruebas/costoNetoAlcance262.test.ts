// costoNetoServicio con ALCANCE (262): el neto sale de los precios PROPIOS del alcance vendido en la vigencia aplicable; nunca de la mitad/doble de otro
// alcance, de GENERAL ni de los rangos/persona de la tarifa clásica. El suplemento solo cuenta para los tramos vendidos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { costoNetoServicio } from "../lib/calc/servicioTarifa.ts";
import type { FilaPrecioAlcance } from "../lib/calc/servicioAlcance.ts";
import type { FranjaSuplemento } from "../lib/calc/trasladoFranjas.ts";

const ALTA = { nombre: "ALTA", fecha_inicio: "2030-01-01", fecha_fin: "2030-12-31", precio_persona: 999999, recargo_individual: 50000 };
const GENERAL = { nombre: "GENERAL", fecha_inicio: null, fecha_fin: null, precio_persona: 777777 };
const fecha = new Date("2030-05-10T12:00:00");
const base = { grupos: [], franjasPorTemporada: new Map<string, FranjaSuplemento[]>(), modo: "persona" as const, pax: 2, fecha, liquidacion: "paquete", numNoches: 3, hoy: "2029-06-01" };
const precios = (filas: FilaPrecioAlcance[]) => new Map([["ALTA", filas]]);
const P = (alcance: FilaPrecioAlcance["alcance"], precio: number, d: number | null = null, h: number | null = null): FilaPrecioAlcance => ({ alcance, pax_desde: d, pax_hasta: h, precio });

test("por persona: cada alcance cobra SU precio (trayecto 100.000, ida y regreso 170.000 ≠ 2 × 100.000) y no toca precio_persona de la tarifa clásica", () => {
  const pa = precios([P("trayecto", 100000), P("ida_regreso", 170000)]);
  const t = costoNetoServicio({ ...base, temporadas: [ALTA], alcance: "llegada", preciosAlcancePorTemporada: pa });
  const ir = costoNetoServicio({ ...base, temporadas: [ALTA], alcance: "ida_regreso", preciosAlcancePorTemporada: pa });
  assert.equal(t.ok && t.costoNeto, 200000, "2 pax × 100.000, no 999.999");
  assert.equal(ir.ok && ir.costoNeto, 340000, "2 pax × 170.000");
});

test("sin precio de ida y regreso NO se deriva del trayecto (falla), aunque el trayecto exista", () => {
  const r = costoNetoServicio({ ...base, temporadas: [ALTA], alcance: "ida_regreso", preciosAlcancePorTemporada: precios([P("trayecto", 100000)]) });
  assert.equal(r.ok, false); assert.equal(!r.ok && r.motivo, "sin_precio_alcance");
  const mitad = costoNetoServicio({ ...base, temporadas: [ALTA], alcance: "salida", preciosAlcancePorTemporada: precios([P("ida_regreso", 170000)]) });
  assert.equal(!mitad.ok && mitad.motivo, "sin_precio_alcance", "tampoco el trayecto sale como la mitad de ida y regreso");
});

test("GENERAL es histórico: una vigencia GENERAL (con precios de alcance o sin ellos) no vende", () => {
  const r = costoNetoServicio({ ...base, temporadas: [GENERAL], alcance: "llegada", preciosAlcancePorTemporada: new Map([["GENERAL", [P("trayecto", 1)]]]) });
  assert.equal(r.ok, false); assert.equal(!r.ok && r.motivo, "sin_vigencia");
});

test("sin vigencia que cubra la fecha falla; la vigencia sin precios de alcance falla con sin_precio_alcance", () => {
  assert.equal((costoNetoServicio({ ...base, temporadas: [ALTA], fecha: new Date("2031-02-01T12:00:00"), alcance: "llegada", preciosAlcancePorTemporada: precios([P("trayecto", 1)]) }) as { motivo?: string }).motivo, "sin_vigencia");
  assert.equal((costoNetoServicio({ ...base, temporadas: [ALTA], alcance: "llegada", preciosAlcancePorTemporada: new Map() }) as { motivo?: string }).motivo, "sin_precio_alcance");
});

test("modo grupo: el rango de la vigencia que cubre el grupo, por alcance; fuera de todo rango falla (no usa el más cercano)", () => {
  const pa = precios([P("trayecto", 45000, 1, 4), P("trayecto", 80000, 5, 12), P("ida_regreso", 150000, 1, 12)]);
  const g = (pax: number, alcance: "llegada" | "ida_regreso") => costoNetoServicio({ ...base, temporadas: [ALTA], modo: "grupo", pax, alcance, preciosAlcancePorTemporada: pa });
  assert.equal((g(3, "llegada") as { costoNeto?: number }).costoNeto, 45000);
  assert.equal((g(8, "llegada") as { costoNeto?: number }).costoNeto, 80000);
  assert.equal((g(8, "ida_regreso") as { costoNeto?: number }).costoNeto, 150000);
  assert.equal((g(20, "llegada") as { motivo?: string }).motivo, "sin_precio_alcance");
});

test("1 pasajero por persona: el recargo individual de la tarifa clásica NO se suma al precio del alcance", () => {
  const r = costoNetoServicio({ ...base, temporadas: [ALTA], pax: 1, alcance: "llegada", preciosAlcancePorTemporada: precios([P("trayecto", 100000)]) });
  assert.equal(r.ok && r.costoNeto, 100000); assert.equal(r.ok && r.recargoIndividual, 0);
});

const NOCHE: FranjaSuplemento = { hora_desde: "19:00", hora_hasta: "06:00", tramo: "ambos", tipo: "monto", valor: 30000, cobro: "grupo" };
const franjas = new Map([["ALTA", [NOCHE]]]);

test("el suplemento solo cuenta para los tramos vendidos: trayecto de llegada cobra la llegada y NO pide la hora de salida; ida y regreso cobra ambos", () => {
  const pa = precios([P("trayecto", 100000), P("ida_regreso", 170000)]);
  const llegada = costoNetoServicio({ ...base, temporadas: [ALTA], franjasPorTemporada: franjas, horas: { llegada: "22:00" }, alcance: "llegada", preciosAlcancePorTemporada: pa });
  assert.equal(llegada.ok && llegada.costoNeto, 230000, "200.000 + 30.000 de la llegada");
  const sinHora = costoNetoServicio({ ...base, temporadas: [ALTA], franjasPorTemporada: franjas, alcance: "llegada", preciosAlcancePorTemporada: pa });
  assert.equal(!sinHora.ok && sinHora.motivo, "hora_requerida");
  assert.deepEqual(!sinHora.ok && sinHora.pendientes, ["llegada"], "la salida no se pide");
  const ambos = costoNetoServicio({ ...base, temporadas: [ALTA], franjasPorTemporada: franjas, horas: { llegada: "22:00", salida: "05:00" }, alcance: "ida_regreso", preciosAlcancePorTemporada: pa });
  assert.equal(ambos.ok && ambos.costoNeto, 340000 + 60000, "un suplemento por tramo");
});

test("sin alcance el comportamiento anterior no cambia (tarifa clásica de la vigencia)", () => {
  const r = costoNetoServicio({ ...base, temporadas: [ALTA] });
  assert.equal(r.ok && r.costoNeto, 999999 * 2);
});
