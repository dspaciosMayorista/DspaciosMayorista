import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolverTarifaServicio, costoNetoServicio, type TemporadaServicioFila } from "../lib/calc/servicioTarifa.ts";
import { marcar, redondearVenta } from "../lib/calc/paquetes.ts";
import {
  construirContextoServicios, calcularPrecioServicioDetallado, calcularResultadoServicio, resolverLiquidacionServicioPuntual,
  separarFranjas, type DatosServicioPar, type FilaTemporadaConFranjas,
} from "../lib/reservar/liquidacionServicio.ts";
import type { FranjaSuplemento } from "../lib/calc/trasladoFranjas.ts";

const HOY = "2026-10-28";
const FECHA = new Date("2026-12-20T00:00:00");
const NAV: TemporadaServicioFila & { id: number } = { id: 7, nombre: "NAVIDAD", fecha_inicio: "2026-12-15", fecha_fin: "2026-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: 100_000, recargo_individual: 20_000 };
const temp = (o: Partial<TemporadaServicioFila> = {}) => ({ servicio_id: 1, ...NAV, ...o });
const RANGOS = [
  { pax_desde: 1, pax_hasta: 4, precio: 300_000, temporada: "NAVIDAD" },
  { pax_desde: 5, pax_hasta: 8, precio: 500_000, temporada: "NAVIDAD" },
  // Rangos GENERAL y de otra temporada que NO deben contar jamás.
  { pax_desde: 1, pax_hasta: 50, precio: 1_000, temporada: "GENERAL" },
  { pax_desde: 9, pax_hasta: 20, precio: 900_000, temporada: "OTRA" },
];
const noFranjas = new Map<string, FranjaSuplemento[]>();

describe("tarifa SIN «GENERAL»", () => {
  test("vigencia ausente: sin tarifa aunque exista precio general o rangos GENERAL", () => {
    const r = resolverTarifaServicio({ temporadas: [], grupos: RANGOS, modo: "grupo", pax: 3, fecha: FECHA, hoy: HOY });
    assert.deepEqual(r, { ok: false, motivo: "sin_vigencia" });
  });
  test("fecha fuera de toda vigencia", () => {
    const r = resolverTarifaServicio({ temporadas: [temp()], grupos: RANGOS, modo: "persona", pax: 2, fecha: new Date("2027-03-01T00:00:00"), hoy: HOY });
    assert.deepEqual(r, { ok: false, motivo: "sin_vigencia" });
  });
  test("vigencia sin fechas nunca aplica (no es una tarifa general disfrazada)", () => {
    const r = resolverTarifaServicio({ temporadas: [temp({ fecha_inicio: null, fecha_fin: null })], grupos: [], modo: "persona", pax: 2, fecha: FECHA, hoy: HOY });
    assert.equal(r.ok, false);
  });
  test("vigencia con ventana de compra cerrada", () => {
    const r = resolverTarifaServicio({ temporadas: [temp({ compra_inicio: "2026-01-01", compra_fin: "2026-09-30" })], grupos: [], modo: "persona", pax: 2, fecha: FECHA, hoy: HOY });
    assert.equal(r.ok, false);
  });
  test("modo persona: precio de la vigencia; sin precio => sin_precio_persona", () => {
    const ok = resolverTarifaServicio({ temporadas: [temp()], grupos: [], modo: "persona", pax: 2, fecha: FECHA, hoy: HOY });
    assert.ok(ok.ok && ok.netoPersona === 100_000 && ok.recargoIndividual === 20_000 && ok.temporada === "NAVIDAD");
    const sin = resolverTarifaServicio({ temporadas: [temp({ precio_persona: null })], grupos: [], modo: "persona", pax: 2, fecha: FECHA, hoy: HOY });
    assert.deepEqual(sin, { ok: false, motivo: "sin_precio_persona" });
  });
  test("precio 0 en la vigencia es un dato real (costo 0, sin CxP) pero la venta no se cotiza con total 0", () => {
    const t0 = [temp({ precio_persona: 0, recargo_individual: 0 })];
    const costo = costoNetoServicio({ temporadas: t0, grupos: [], franjasPorTemporada: noFranjas, modo: "persona", pax: 2, fecha: FECHA, liquidacion: null, numNoches: 1, hoy: HOY });
    assert.ok(costo.ok && costo.costoNeto === 0);
  });
  test("modo grupo: usa SOLO rangos de la vigencia; pax sin cobertura NO cae al rango más alto", () => {
    const en = resolverTarifaServicio({ temporadas: [temp()], grupos: RANGOS, modo: "grupo", pax: 6, fecha: FECHA, hoy: HOY });
    assert.ok(en.ok && en.netoGrupo === 500_000);
    for (const pax of [9, 20, 50]) {
      const fuera = resolverTarifaServicio({ temporadas: [temp()], grupos: RANGOS, modo: "grupo", pax, fecha: FECHA, hoy: HOY });
      assert.deepEqual(fuera, { ok: false, motivo: "sin_rango_pax" }, `pax ${pax}`);
    }
  });
  test("límites de rango inclusivos (4 y 5)", () => {
    const a = resolverTarifaServicio({ temporadas: [temp()], grupos: RANGOS, modo: "grupo", pax: 4, fecha: FECHA, hoy: HOY });
    const b = resolverTarifaServicio({ temporadas: [temp()], grupos: RANGOS, modo: "grupo", pax: 5, fecha: FECHA, hoy: HOY });
    assert.ok(a.ok && a.netoGrupo === 300_000 && b.ok && b.netoGrupo === 500_000);
  });
});

const NOCTURNA: FranjaSuplemento = { id: 1, hora_desde: "19:00", hora_hasta: "06:00", tramo: "ambos", tipo: "monto", valor: 40_000, cobro: "grupo" };
const franjasNav = new Map<string, FranjaSuplemento[]>([["NAVIDAD", [NOCTURNA]]]);
const base = { temporadas: [temp()], grupos: RANGOS, fecha: FECHA, hoy: HOY, liquidacion: null, numNoches: 3 };

describe("costo neto = tarifa + recargo + suplementos (antes del margen)", () => {
  test("grupo, ida y vuelta nocturnos: suma dos suplementos", () => {
    const r = costoNetoServicio({ ...base, franjasPorTemporada: franjasNav, modo: "grupo", pax: 3, horas: { llegada: "21:00", salida: "04:30" } });
    assert.ok(r.ok);
    assert.equal(r.ok && r.netoBase, 300_000);
    assert.equal(r.ok && r.netoSuplementos, 80_000);
    assert.equal(r.ok && r.costoNeto, 380_000);
  });
  test("persona 1 pax: recargo individual + suplemento; el % se calcula sobre el neto base sin recargo", () => {
    const pct = new Map([["NAVIDAD", [{ ...NOCTURNA, tipo: "porcentaje" as const, valor: 10, tramo: "llegada" as const }]]]);
    const r = costoNetoServicio({ ...base, franjasPorTemporada: pct, modo: "persona", pax: 1, horas: { llegada: "23:00" } });
    assert.ok(r.ok && r.netoBase === 100_000 && r.recargoIndividual === 20_000 && r.netoSuplementos === 10_000 && r.costoNeto === 130_000);
  });
  test("liquidación por noche multiplica la base y el % la toma ya multiplicada", () => {
    const pct = new Map([["NAVIDAD", [{ ...NOCTURNA, tipo: "porcentaje" as const, valor: 10, tramo: "llegada" as const }]]]);
    const r = costoNetoServicio({ ...base, franjasPorTemporada: pct, liquidacion: "noche", modo: "persona", pax: 2, horas: { llegada: "23:00" } });
    assert.ok(r.ok && r.netoBase === 600_000 && r.netoSuplementos === 60_000);
  });
  test("hora faltante: falla (cotizar) o devuelve tarifa sin suplemento + pendientes (búsqueda)", () => {
    const falla = costoNetoServicio({ ...base, franjasPorTemporada: franjasNav, modo: "grupo", pax: 3, horas: { llegada: "21:00" } });
    assert.deepEqual(falla, { ok: false, motivo: "hora_requerida", pendientes: ["salida"] });
    const busca = costoNetoServicio({ ...base, franjasPorTemporada: franjasNav, modo: "grupo", pax: 3, horas: {}, permitirSinHora: true });
    assert.ok(busca.ok && busca.netoSuplementos === 0 && busca.pendientes.length === 2 && busca.costoNeto === 300_000);
  });
  test("sin franjas configuradas no se exige hora", () => {
    const r = costoNetoServicio({ ...base, franjasPorTemporada: noFranjas, modo: "grupo", pax: 3 });
    assert.ok(r.ok && r.costoNeto === 300_000);
  });
  test("franja con solape guardada por error: falla cerrado", () => {
    const mal = new Map([["NAVIDAD", [NOCTURNA, { ...NOCTURNA, id: 2, hora_desde: "20:00", hora_hasta: "21:00" }]]]);
    const r = costoNetoServicio({ ...base, franjasPorTemporada: mal, modo: "grupo", pax: 3, horas: { llegada: "20:30", salida: "10:00" } });
    assert.ok(!r.ok && r.motivo === "franja_invalida");
  });
});

const PAR: DatosServicioPar = { servicioId: 1, paqueteId: 10, nombre: "Traslado aeropuerto", destino: "Cartagena", descripcion: null };
const filasTemp: FilaTemporadaConFranjas[] = [{
  ...temp(), servicio_suplementos_franja: [{ id: 1, hora_desde: "19:00", hora_hasta: "06:00", tramo: "ambos", tipo: "monto", valor: "40000", cobro: "grupo" }],
}];
function ctx(modoGrupo = true) {
  const { temporadas, franjas } = separarFranjas(filasTemp);
  return construirContextoServicios({
    paquetes: [{ id: 10, pct_mk: 0.2 }], armado: [{ paquete_id: 10, servicio_id: 1, modo: modoGrupo ? "grupo" : "persona" }],
    servicios: [{ id: 1, precio_persona: 999_999, recargo_individual: 888, liquidacion: null, moneda: "COP" }],
    grupos: RANGOS.map((g) => ({ ...g, servicio_id: 1 })), temporadas, franjas,
  });
}

describe("venta: paridad con el costo y sin GENERAL", () => {
  test("el precio de venta es el costo neto con suplementos + margen redondeado (misma aritmética que el costo/CxP)", () => {
    const horas = { llegada: "21:00", salida: "04:30" };
    const v = calcularPrecioServicioDetallado(PAR, ctx(), FECHA, 3, 3, "grupo", 0.2, { horas, hoy: HOY });
    const c = costoNetoServicio({ ...base, franjasPorTemporada: franjasNav, modo: "grupo", pax: 3, horas });
    assert.ok(v.ok && c.ok);
    assert.equal(v.ok && v.costoNeto, c.ok && c.costoNeto);
    assert.equal(v.ok && v.resultado.total, redondearVenta(marcar(380_000, 0.2), "COP"));
    assert.deepEqual(v.ok && v.resultado.suplementos, [{ tramo: "llegada", hora: "21:00" }, { tramo: "salida", hora: "04:30" }]);
  });
  test("el precio general del servicio (999.999) y los rangos GENERAL nunca se usan", () => {
    const sinVig = construirContextoServicios({
      paquetes: [{ id: 10, pct_mk: 0.2 }], armado: [{ paquete_id: 10, servicio_id: 1, modo: "persona" }],
      servicios: [{ id: 1, precio_persona: 999_999, recargo_individual: 888, liquidacion: null, moneda: "COP" }],
      grupos: RANGOS.map((g) => ({ ...g, servicio_id: 1 })), temporadas: [],
    });
    const r = calcularPrecioServicioDetallado(PAR, sinVig, FECHA, 3, 2, "persona", 0.2, { hoy: HOY });
    assert.deepEqual(r.ok, false);
    assert.equal(calcularResultadoServicio(PAR, sinVig, FECHA, 3, 2), null);
  });
  test("búsqueda con hora desconocida: muestra tarifa sin suplemento y marca requiereHora", () => {
    const r = calcularResultadoServicio(PAR, ctx(), FECHA, 3, 3);
    assert.ok(r);
    assert.deepEqual(r.requiereHora, ["llegada", "salida"]);
    assert.equal(r.suplementos, undefined);
  });
  test("checkout (puntual): hora faltante => requiere_hora con tramos; con horas cotiza", () => {
    const entrada = {
      par: PAR, fechaIdaDate: FECHA, numNoches: 3, pax: 3, filaTarifarioEncontrada: true, filaTarifarioError: null,
      paquete: { id: 10, pct_mk: 0.2 }, paqueteError: null, armado: { paquete_id: 10, servicio_id: 1, modo: "grupo" }, armadoError: null,
      servicio: { id: 1, precio_persona: null, recargo_individual: null, liquidacion: null, moneda: "COP" }, servicioError: null,
      grupos: RANGOS.map((g) => ({ ...g, servicio_id: 1 })), gruposError: null, ...separarFranjas(filasTemp), temporadasError: null,
    };
    const sin = resolverLiquidacionServicioPuntual({ ...entrada, horas: { llegada: "21:00" } });
    assert.ok(!sin.ok && sin.tipo === "requiere_hora" && sin.codigo === "hora_requerida");
    assert.deepEqual(!sin.ok && sin.tramosPendientes, ["salida"]);
    assert.doesNotMatch(!sin.ok ? sin.mensajePublico : "", /statement|postgres/i);
    const con = resolverLiquidacionServicioPuntual({ ...entrada, horas: { llegada: "21:00", salida: "10:00" } });
    assert.ok(con.ok);
    assert.equal(con.ok && con.resultado.total, redondearVenta(marcar(340_000, 0.2), "COP"));
  });
  test("checkout: sin vigencia y sin rango son no_disponible con motivos distintos", () => {
    const e = {
      par: PAR, fechaIdaDate: FECHA, numNoches: 3, pax: 3, filaTarifarioEncontrada: true, filaTarifarioError: null,
      paquete: { id: 10, pct_mk: 0.2 }, paqueteError: null, armado: { paquete_id: 10, servicio_id: 1, modo: "grupo" }, armadoError: null,
      servicio: { id: 1, precio_persona: 5, recargo_individual: null, liquidacion: null, moneda: "COP" }, servicioError: null,
      grupos: RANGOS.map((g) => ({ ...g, servicio_id: 1 })), gruposError: null, temporadas: [], temporadasError: null,
    };
    const a = resolverLiquidacionServicioPuntual(e);
    assert.ok(!a.ok && a.tipo === "no_disponible" && a.codigo === "sin_tarifa_vigente");
    const b = resolverLiquidacionServicioPuntual({ ...e, pax: 12, temporadas: [temp()] });
    assert.ok(!b.ok && b.tipo === "no_disponible" && b.codigo === "sin_rango_pax");
  });
});
