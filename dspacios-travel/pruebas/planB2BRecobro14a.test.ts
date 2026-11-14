// #14-A — plan congelado con recobro: construir, releer del payload, detectar manipulaciones, comparar y repartir por contrato. Sin recobro = la regla vigente. Datos sintéticos.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compararPlanesB2B, construirPlanB2B, leerPlanB2BDePayload, planDeGrupoB2B, planesDeGruposB2B, type AliadoAsistencia, type LineaB2B, type PlanB2BCotizacion } from "../lib/cotizacion/asistidaB2B.ts";

const ALIADO: AliadoAsistencia = { id: 7, nombre: "Agencia Prueba", tipo: "agencia", pctAliado: 0.1 };
const ACTOR = { id: "u1", email: "a@x.test", rol: "operaciones" as const };
const ALIADO_ACTOR = { id: "u2", email: "al@x.test", rol: "agencia" as const };
const base = (modo: "comisionable" | "neta", lineas: LineaB2B[], recobro: { total: number; participacion: number } | null, origen?: "asistida" | "aliado_directo") => {
  const r = construirPlanB2B({
    aliado: ALIADO, pct: 0.1, pctOrigen: "aliado", modo, moneda: "COP", lineas, actor: origen === "aliado_directo" ? ALIADO_ACTOR : ACTOR, congeladoEn: "2030-01-01T00:00:00Z",
    ...(origen ? { origen } : {}),
    ...(recobro ? { recobro: { total: recobro.total, participacion: recobro.participacion, pct_participacion: null, origen_participacion: origen === "aliado_directo" ? "parametro" as const : "formulario" as const } } : {}),
  });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.plan;
};
const roundtrip = (p: PlanB2BCotizacion) => leerPlanB2BDePayload({ b2bAsistido: JSON.parse(JSON.stringify(p)) });
const unaUnidad = (recobro: number): LineaB2B[] => [{ clave: "item-0", pvp: 2500000, impuesto: 0, ...(recobro ? { recobro } : {}) }];

describe("sin recobro: la regla vigente (y el aliado se identifica igual)", () => {
  test("comisionable: base = PVP − impuesto, comisión 10 %, total exigible = PVP; relee idéntico", () => {
    const p = base("comisionable", unaUnidad(0), null);
    assert.deepEqual([p.pvp, p.base, p.comision, p.total_exigible, p.comision_estado], [2500000, 2500000, 250000, 2500000, "pendiente"]);
    assert.equal(p.recobro, undefined);
    const r = roundtrip(p); assert.ok(r.ok && r.plan);
  });
  test("NETO: exigible = PVP − comisión, descontada", () => {
    const p = base("neta", unaUnidad(0), null);
    assert.deepEqual([p.total_exigible, p.comision, p.comision_estado], [2250000, 250000, "descontada"]);
  });
  test("aliado directo SIN recobro: el plan se sella igual (identidad, modalidad y comisión se conservan) y su actor es el aliado", () => {
    const p = base("comisionable", unaUnidad(0), null, "aliado_directo");
    assert.equal(p.origen, "aliado_directo"); assert.equal(p.asistido_por.rol, "agencia"); assert.equal(p.comision, 250000);
    const r = roundtrip(p); assert.ok(r.ok && r.plan); assert.equal(r.plan?.origen, "aliado_directo");
  });
  test("un rol de aliado como autor SOLO vale con origen «aliado_directo»; en una venta asistida se rechaza", () => {
    const p = base("comisionable", unaUnidad(0), null, "aliado_directo");
    const mal = { ...JSON.parse(JSON.stringify(p)), origen: "asistida" };
    assert.equal(leerPlanB2BDePayload({ b2bAsistido: mal }).ok, false);
    const sinOrigen = JSON.parse(JSON.stringify(p)); delete sinOrigen.origen;
    assert.equal(leerPlanB2BDePayload({ b2bAsistido: sinOrigen }).ok, false);
    assert.equal(leerPlanB2BDePayload({ b2bAsistido: { ...JSON.parse(JSON.stringify(p)), origen: "otro" } }).ok, false);
  });
});

describe("con recobro 100.000 (2 adultos 1.000.000 + niño 500.000, 10 %, BNC 0)", () => {
  test("A · aliado directo 50.000: PVP 2.600.000, base 2.500.000, comisión total 300.000", () => {
    const p = base("comisionable", unaUnidad(100000), { total: 100000, participacion: 50000 }, "aliado_directo");
    assert.deepEqual([p.pvp, p.base, p.comision, p.total_exigible], [2600000, 2500000, 300000, 2600000]);
    assert.deepEqual(p.recobro, { total: 100000, participacion: 50000, pct_participacion: null, origen_participacion: "parametro" });
    const r = roundtrip(p); assert.ok(r.ok && r.plan?.recobro?.participacion === 50000);
  });
  test("B1 · asistida con distribución 40.000: comisión 290.000", () => {
    const p = base("comisionable", unaUnidad(100000), { total: 100000, participacion: 40000 });
    assert.equal(p.comision, 290000); assert.equal(p.base, 2500000);
  });
  test("B2 · asistida SIN distribución: el recobro queda en la base ⇒ base 2.600.000, comisión 260.000", () => {
    const p = base("comisionable", unaUnidad(100000), { total: 100000, participacion: 0 });
    assert.deepEqual([p.base, p.comision, p.total_exigible], [2600000, 260000, 2600000]);
  });
  test("NETO con distribución: exigible 2.310.000, comisión descontada 290.000; sin distribución: 2.340.000 y 260.000", () => {
    const n1 = base("neta", unaUnidad(100000), { total: 100000, participacion: 40000 });
    assert.deepEqual([n1.total_exigible, n1.comision, n1.comision_estado], [2310000, 290000, "descontada"]);
    const n2 = base("neta", unaUnidad(100000), { total: 100000, participacion: 0 });
    assert.deepEqual([n2.total_exigible, n2.comision], [2340000, 260000]);
  });
  test("valor no comisionable fuera de la base: impuesto 200.000 ⇒ base 2.300.000, comisión 230.000 + 40.000", () => {
    const p = base("comisionable", [{ clave: "item-0", pvp: 2500000, impuesto: 200000, recobro: 100000 }], { total: 100000, participacion: 40000 });
    assert.deepEqual([p.base, p.comision], [2300000, 270000]);
  });
  test("manipulación del payload guardado ⇒ rechazado (nunca se convierte): recobro, participación, comisión, total o líneas alterados", () => {
    const p = base("comisionable", unaUnidad(100000), { total: 100000, participacion: 40000 });
    const clon = () => JSON.parse(JSON.stringify(p));
    const casos: Array<[string, (x: any) => void]> = [
      ["participación 100.000", (x) => { x.recobro.participacion = 100000; }],
      ["participación > recobro", (x) => { x.recobro.participacion = 100001; }],
      ["recobro total distinto de Σ líneas", (x) => { x.recobro.total = 90000; }],
      ["recobro de la línea alterado", (x) => { x.lineas[0].recobro = 1; }],
      ["comisión alterada", (x) => { x.comision = 250000; }],
      ["total exigible alterado", (x) => { x.total_exigible = 1; }],
      ["se quita el bloque de recobro pero quedan líneas con recobro", (x) => { delete x.recobro; }],
      ["origen de participación inválido", (x) => { x.recobro.origen_participacion = "navegador"; }],
      ["recobro negativo en una línea", (x) => { x.lineas[0].recobro = -5; }],
    ];
    for (const [nombre, f] of casos) { const x = clon(); f(x); assert.equal(leerPlanB2BDePayload({ b2bAsistido: x }).ok, false, nombre); }
  });
  test("compararPlanesB2B detecta un cambio del recobro o de la participación", () => {
    const a = base("comisionable", unaUnidad(100000), { total: 100000, participacion: 40000 });
    assert.equal(compararPlanesB2B(a, a).ok, true);
    const b = base("comisionable", unaUnidad(100000), { total: 100000, participacion: 50000 });
    assert.equal(compararPlanesB2B(a, b).ok, false);
    const c = base("comisionable", unaUnidad(0), null);
    assert.equal(compararPlanesB2B(a, c).ok, false);
  });
});

describe("planesDeGruposB2B", () => {
  test("sin recobro equivale EXACTO a planDeGrupoB2B por contrato (regla vigente)", () => {
    const lineas: LineaB2B[] = [{ clave: "item-0", pvp: 2000000, impuesto: 100000 }, { clave: "item-1", pvp: 900000, impuesto: 0 }];
    const plan = base("neta", lineas, null);
    const r = planesDeGruposB2B(plan, [[lineas[0]], [lineas[1]]]); assert.ok(r.ok);
    r.planes.forEach((p, i) => { const e = planDeGrupoB2B(plan, [lineas[i]]); assert.ok(e.ok); assert.equal(p.comision, e.plan.comision); assert.equal(p.precioFinal, e.plan.precioFinal); assert.equal(p.recobro, undefined); });
  });
  test("con recobro y dos contratos: A 66.666,67 + B 33.333,33 = 100.000; participación 26.667 + 13.333; ordinarias 200.000 + 90.000; totales exactos", () => {
    const lineas: LineaB2B[] = [{ clave: "item-0", pvp: 2000000, impuesto: 0, recobro: 66666.67 }, { clave: "item-1", pvp: 900000, impuesto: 0, recobro: 33333.33 }];
    const plan = base("comisionable", lineas, { total: 100000, participacion: 40000 });
    const r = planesDeGruposB2B(plan, [[lineas[0]], [lineas[1]]]); assert.ok(r.ok);
    const [A, B] = r.planes;
    assert.deepEqual([A.recobro?.aliado, B.recobro?.aliado], [26667, 13333]);
    assert.deepEqual([A.base, B.base], [2000000, 900000]);
    assert.deepEqual([A.comision, B.comision], [200000, 90000]);
    assert.deepEqual([A.totalAliado, B.totalAliado], [226667, 103333]);
    assert.equal(Math.round((A.precioFinal + B.precioFinal) * 100), Math.round(plan.pvp * 100), "los contratos suman el PVP con recobro del plan");
    assert.equal(Math.round(((A.recobro?.total ?? 0) + (B.recobro?.total ?? 0)) * 100), 10000000);
  });
  test("NETO por contrato: comision_b2b = ordinaria + participación y precioFinal = PVP con recobro − eso", () => {
    const lineas: LineaB2B[] = [{ clave: "item-0", pvp: 2500000, impuesto: 0, recobro: 100000 }];
    const plan = base("neta", lineas, { total: 100000, participacion: 40000 });
    const r = planesDeGruposB2B(plan, [lineas]); assert.ok(r.ok);
    assert.deepEqual([r.planes[0].comision, r.planes[0].precioFinal, r.planes[0].recobro?.empresa], [290000, 2310000, 60000]);
  });
});
