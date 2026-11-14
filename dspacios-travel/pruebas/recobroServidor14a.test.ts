// #14-A — permisos y manipulación del formulario (lectura y decisión del recobro en servidor), recobro dentro de la tarifa de adulto y resumen #94 con recobro oculto.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { construirResumenCarrito, type UnidadBase } from "../lib/cotizacion/resumenCarrito.ts";
import { aplicarRecobroAFilasAdulto, decidirRecobro, leerRecobroEntrada, pctParticipacionDeParametro } from "../lib/cotizacion/recobroCarrito.ts";

describe("leerRecobroEntrada y decidirRecobro (permisos y manipulación del formulario)", () => {
  const leer = (raw: unknown) => { const r = leerRecobroEntrada(raw); assert.ok(r.ok, r.ok ? "" : r.error); return r.valor; };
  test("ausente, null o total vacío ⇒ sin recobro; formas raras o negativos ⇒ error (no se leen como 0)", () => {
    assert.equal(leer({}).total, 0); assert.equal(leer({ recobro: null }).total, 0); assert.equal(leer({ recobro: { total: "" } }).total, 0);
    for (const raro of [{ recobro: "100" }, { recobro: [] }, { recobro: { total: -1 } }, { recobro: { total: "x" } }, { recobro: { total: 5, participacion: "mitad" } }, { recobro: { total: 5, participacion: { modo: "pct", pct: 2 } } }, { recobro: { total: 5, participacion: { modo: "valor", valor: -1 } } }, { recobro: { total: 5, participacion: { modo: "otro" } } }]) {
      assert.equal(leerRecobroEntrada(raro).ok, false, JSON.stringify(raro));
    }
  });
  test("asistida: la distribución la fija el personal (valor o %); sin distribución = 0 (el recobro queda en la base)", () => {
    const con = decidirRecobro({ entrada: leer({ recobro: { total: 100000, participacion: { modo: "pct", pct: 0.4 } } }), captura: "asistida" }); assert.ok(con.ok && con.valor);
    assert.deepEqual(con.valor, { total: 100000, participacion: 40000, pct_participacion: 0.4, origen_participacion: "formulario" });
    const sin = decidirRecobro({ entrada: leer({ recobro: { total: 100000 } }), captura: "asistida" }); assert.ok(sin.ok && sin.valor?.participacion === 0);
    const valor = decidirRecobro({ entrada: leer({ recobro: { total: 100000, participacion: { modo: "valor", valor: 250000 } } }), captura: "asistida" }); assert.ok(valor.ok && valor.valor?.participacion === 100000, "se acota al recobro");
  });
  test("interno a cliente final: 100 % empresa; una distribución > 0 se RECHAZA", () => {
    const ok = decidirRecobro({ entrada: leer({ recobro: { total: 50000 } }), captura: "interno_cliente_final" }); assert.ok(ok.ok && ok.valor?.participacion === 0);
    assert.equal(decidirRecobro({ entrada: leer({ recobro: { total: 50000, participacion: { modo: "valor", valor: 1 } } }), captura: "interno_cliente_final" }).ok, false);
  });
  test("aliado directo: la distribución sale SOLO del parámetro (50 % ⇒ 50.000); enviarla desde el formulario o un parámetro inválido ⇒ error", () => {
    const ok = decidirRecobro({ entrada: leer({ recobro: { total: 100000 } }), captura: "aliado_directo", pctParametro: pctParticipacionDeParametro("0.5") }); assert.ok(ok.ok);
    assert.deepEqual(ok.valor, { total: 100000, participacion: 50000, pct_participacion: 0.5, origen_participacion: "parametro" });
    assert.equal(decidirRecobro({ entrada: leer({ recobro: { total: 100000, participacion: { modo: "pct", pct: 1 } } }), captura: "aliado_directo", pctParametro: pctParticipacionDeParametro("0.5") }).ok, false, "el aliado no fija su distribución");
    assert.equal(decidirRecobro({ entrada: leer({ recobro: { total: 100000 } }), captura: "aliado_directo", pctParametro: pctParticipacionDeParametro(undefined) }).ok, false, "parámetro ausente");
    assert.equal(decidirRecobro({ entrada: leer({ recobro: { total: 100000 } }), captura: "aliado_directo", pctParametro: null }).ok, false);
  });
  test("sin permiso (visitante, B2C con sesión, rol ajeno, aliado sin ficha): error; con recobro 0 nunca estorba", () => {
    assert.equal(decidirRecobro({ entrada: leer({ recobro: { total: 1 } }), captura: "sin_permiso" }).ok, false);
    const cero = decidirRecobro({ entrada: leer({}), captura: "sin_permiso" }); assert.ok(cero.ok && cero.valor === null);
  });
});

describe("aplicarRecobroAFilasAdulto: el recobro entra a la tarifa de adulto sin nombrarse y la suma es exacta", () => {
  test("A 2 adultos + B 1 adulto: 33.333,34 / 33.333,33 / 33.333,33 ⇒ filas partidas por centavos y total del documento = PVP + 100.000", () => {
    const filas = [{ adultos: 2, tarifa_adulto: 1000000, descripcion: "A" }, { adultos: 1, tarifa_adulto: 500000, descripcion: "B" }];
    const r = aplicarRecobroAFilasAdulto(filas, [BigInt(3333334), BigInt(3333333), BigInt(3333333)]); assert.ok(r.ok);
    assert.deepEqual(r.valor.map((f) => [f.adultos, f.tarifa_adulto]), [[1, 1033333.34], [1, 1033333.33], [1, 533333.33]]);
    const total = r.valor.reduce((s, f) => s + Math.round(f.adultos * f.tarifa_adulto * 100), 0);
    assert.equal(total, Math.round((2 * 1000000 + 500000) * 100) + 10000000);
    assert.ok(r.valor.every((f) => !/recobro/i.test(JSON.stringify(f))), "ninguna fila menciona el recobro");
  });
  test("adultos con el mismo recobro conservan UNA fila; filas sin adultos (niños) no se tocan; cantidad que no cuadra ⇒ error", () => {
    const filas = [{ adultos: 2, tarifa_adulto: 1000000 }, { adultos: 0, tarifa_adulto: 0, ninos: 1, tarifa_nino: 500000 }];
    const r = aplicarRecobroAFilasAdulto(filas, [BigInt(5000000), BigInt(5000000)]); assert.ok(r.ok);
    assert.deepEqual(r.valor.map((f) => [f.adultos, f.tarifa_adulto]), [[2, 1050000], [0, 0]]);
    assert.equal(aplicarRecobroAFilasAdulto(filas, [BigInt(1)]).ok, false);
  });
});

describe("resumen #94 con recobro oculto", () => {
  const unidad: UnidadBase = {
    ref: "item-0", paquete: { id: 1, nombre: "P" }, hotel: "Hotel", categoria: "E", regimen: "PC", paxTotal: 3, infantes: 0, grupoIncluido: 0,
    personas: [{ clave: "adulto:doble", etiqueta: "Adulto", tipo: "adulto", cantidad: 2, tarifa: 1000000 }, { clave: "nino", etiqueta: "Niño", tipo: "nino", cantidad: 1, tarifa: 500000 }],
  };
  test("PVP: adultos 2 × 1.050.000, niño 500.000, total 2.600.000 y NINGÚN nombre de recobro en «incluye»", () => {
    const r = construirResumenCarrito({ unidades: [unidad], servicios: [], modalidad: "pvp", moneda: "COP", total: 2600000, recobroPorUnidad: { "item-0": 100000 } }); assert.ok(r.ok, r.ok ? "" : r.motivo);
    const g = r.resumen.unidades[0].grupos;
    assert.deepEqual(g.map((x) => [x.tipo, x.cantidad, x.tarifaCentavos / 100]), [["adulto", 2, 1050000], ["nino", 1, 500000]]);
    assert.equal(r.resumen.totalCentavos, 260000000);
    assert.ok(g.every((x) => x.incluye.length === 0));
    assert.equal(r.resumen.unidades[0].ajusteCentavos, 0);
  });
  test("recobro que no divide exacto: el residuo queda DENTRO de las tarifas (3 adultos, 100.000 ⇒ 33.333,34 + 33.333,33 + 33.333,33) y la suma es exacta, sin ajuste", () => {
    const u3: UnidadBase = { ...unidad, paxTotal: 3, personas: [{ clave: "adulto:triple", etiqueta: "Adulto", tipo: "adulto", cantidad: 3, tarifa: 800000 }] };
    const r = construirResumenCarrito({ unidades: [u3], servicios: [], modalidad: "pvp", moneda: "COP", total: 2500000, recobroPorUnidad: { "item-0": 100000 } }); assert.ok(r.ok, r.ok ? "" : r.motivo);
    assert.deepEqual(r.resumen.unidades[0].grupos.map((g) => [g.cantidad, g.tarifaCentavos]), [[1, 83333334], [2, 83333333]]);
    assert.equal(r.resumen.unidades[0].ajusteCentavos, 0);
    assert.equal(r.resumen.totalCentavos, 250000000);
  });
  test("sin recobro el resumen es el de siempre", () => {
    const r = construirResumenCarrito({ unidades: [unidad], servicios: [], modalidad: "pvp", moneda: "COP", total: 2500000 }); assert.ok(r.ok);
    assert.equal(r.resumen.unidades[0].grupos[0].tarifaCentavos, 100000000);
  });
});
