// #43-1b — Libro diario legible y balance de prueba: lógica pura.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  etiquetaOrigen, filtrarAsientos, resumenAsientos, totalesAsiento, contratoDeReferencia,
  rangoMes, esFechaIso, asientosACsv, type AsientoVista,
} from "../lib/contabilidad/libroDiario.ts";
import { balanceDePrueba, saldoSegunNaturaleza, type CuentaPuc } from "../lib/contabilidad/balancePrueba.ts";

const linea = (cuenta_codigo: string, cuenta_nombre: string, debe: number, haber: number, extra: Partial<AsientoVista["lineas"][number]> = {}) =>
  ({ cuenta_codigo, cuenta_nombre, tercero: null, descripcion: null, debe, haber, ...extra });
const asientos: AsientoVista[] = [
  { id: 1, numero: 10, fecha: "2026-10-02", descripcion: "Abono contrato 00-0451", origen: "abono", referencia: "abono:45",
    lineas: [linea("111005", "Bancos COP", 500000, 0), linea("280505", "Anticipos de clientes", 0, 500000, { tercero: "00-0451" })] },
  { id: 2, numero: 11, fecha: "2026-10-05", descripcion: "Arriendo oficina octubre", origen: "manual", referencia: null,
    lineas: [linea("512010", "Arrendamientos", 2000000, 0, { descripcion: "Canon octubre" }), linea("111005", "Bancos COP", 0, 2000000, { tercero: "Inmobiliaria Ñandú" })] },
  { id: 3, numero: 12, fecha: "2026-10-09", descripcion: "Factura MIN-00-0120", origen: "facturacion", referencia: "MIN-00-0120",
    lineas: [linea("130505", "Clientes", 1190000, 0), linea("413505", "Ingresos propios", 0, 1000000)] },
];

describe("libro diario", () => {
  test("orígenes en lenguaje claro, también los desconocidos", () => {
    assert.equal(etiquetaOrigen("pago_proveedor"), "Pago a proveedor");
    assert.equal(etiquetaOrigen("facturacion_reversion"), "Reversión de factura");
    assert.equal(etiquetaOrigen("nomina_mensual"), "Nomina mensual");
    assert.equal(etiquetaOrigen(""), "Sin origen");
  });

  test("totales y descuadre (tolerancia de un peso)", () => {
    assert.deepEqual(totalesAsiento(asientos[0]), { debe: 500000, haber: 500000, cuadra: true });
    assert.equal(totalesAsiento(asientos[2]).cuadra, false);
    assert.equal(totalesAsiento({ lineas: [linea("1", "a", 100.5, 0), linea("2", "b", 0, 100)] }).cuadra, true);
  });

  test("filtros: texto (cabecera o detalle), cuenta por código o nombre, tercero sin tildes, origen y descuadrados", () => {
    const ids = (f: Parameters<typeof filtrarAsientos>[1]) => filtrarAsientos(asientos, f).map((a) => a.id);
    assert.deepEqual(ids({}), [1, 2, 3]);
    assert.deepEqual(ids({ texto: "canon" }), [2], "busca en el detalle de las líneas");
    assert.deepEqual(ids({ texto: "11" }), [2], "busca por número de asiento");
    assert.deepEqual(ids({ cuenta: "1110" }), [1, 2], "prefijo de código");
    assert.deepEqual(ids({ cuenta: "arrend" }), [2], "nombre de la cuenta");
    assert.deepEqual(ids({ tercero: "nandu" }), [2], "sin tildes ni eñes");
    assert.deepEqual(ids({ origen: "abono" }), [1]);
    assert.deepEqual(ids({ soloDescuadrados: true }), [3]);
  });

  test("resumen", () => {
    assert.deepEqual(resumenAsientos(asientos), { cantidad: 3, debitos: 3690000, creditos: 3500000, descuadrados: 1 });
  });

  test("referencia de contrato enlazable solo si tiene el formato de número de contrato", () => {
    assert.equal(contratoDeReferencia("00-0451"), "00-0451");
    assert.equal(contratoDeReferencia("MIN-00-0120"), "MIN-00-0120");
    assert.equal(contratoDeReferencia("abono:45"), null);
    assert.equal(contratoDeReferencia(null), null);
  });

  test("rangos de mes y validación de fechas", () => {
    assert.deepEqual(rangoMes("2026-10-17"), { desde: "2026-10-01", hasta: "2026-10-31" });
    assert.deepEqual(rangoMes("2026-03-15", -1), { desde: "2026-02-01", hasta: "2026-02-28" });
    assert.deepEqual(rangoMes("2026-01-10", -1), { desde: "2025-12-01", hasta: "2025-12-31" });
    assert.equal(esFechaIso("2026-02-29"), false);
    assert.equal(esFechaIso("2028-02-29"), true);
    assert.equal(esFechaIso("2026-1-01"), false);
    assert.equal(esFechaIso(undefined), false);
  });

  test("CSV para Excel en español: una fila por línea, coma decimal y comillas cuando hace falta", () => {
    const csv = asientosACsv([{ ...asientos[1], descripcion: 'Arriendo; "oficina"' }]);
    const filas = csv.replace(/^﻿/, "").split("\r\n");
    assert.equal(filas[0], "sep=;");
    assert.match(filas[1], /^Número;Fecha;Descripción;Origen/);
    assert.equal(filas.length, 5, "cabecera + 2 líneas + fila vacía final");
    assert.equal(filas[2], '11;2026-10-05;"Arriendo; ""oficina""";Manual;;512010;Arrendamientos;;Canon octubre;2000000,00;0,00');
    assert.match(filas[3], /Inmobiliaria Ñandú;;0,00;2000000,00$/);
  });
});

describe("balance de prueba", () => {
  // 1 Activo > 11 Disponible > 1110 Bancos > 111005 Bancos COP; 4 Ingresos > 4135 > 413505.
  const cuentas: CuentaPuc[] = [
    { id: 1, codigo: "1", nombre: "Activo", nivel: 1, padre_id: null, naturaleza: "debito" },
    { id: 2, codigo: "11", nombre: "Disponible", nivel: 2, padre_id: 1, naturaleza: "debito" },
    { id: 3, codigo: "1110", nombre: "Bancos", nivel: 3, padre_id: 2, naturaleza: "debito" },
    { id: 4, codigo: "111005", nombre: "Bancos COP", nivel: 4, padre_id: 3, naturaleza: "debito" },
    { id: 5, codigo: "4", nombre: "Ingresos", nivel: 1, padre_id: null, naturaleza: "credito" },
    { id: 6, codigo: "4135", nombre: "Comercio", nivel: 3, padre_id: 5, naturaleza: "credito" },
    { id: 7, codigo: "413505", nombre: "Ingresos propios", nivel: 4, padre_id: 6, naturaleza: "credito" },
    { id: 8, codigo: "2", nombre: "Pasivo", nivel: 1, padre_id: null, naturaleza: "credito" },
  ];
  const movimientos = [
    { cuenta_id: 4, fecha: "2026-09-20", debe: 300000, haber: 0 },      // antes del periodo
    { cuenta_id: 7, fecha: "2026-09-20", debe: 0, haber: 300000 },
    { cuenta_id: 4, fecha: "2026-10-05", debe: 1000000, haber: 0 },     // en el periodo
    { cuenta_id: 7, fecha: "2026-10-05", debe: 0, haber: 1000000 },
    { cuenta_id: 4, fecha: "2026-10-20", debe: 0, haber: 200000 },
    { cuenta_id: 7, fecha: "2026-10-20", debe: 200000, haber: 0 },
    { cuenta_id: 4, fecha: "2026-11-02", debe: 999, haber: 0 },          // después: no cuenta
  ];
  const opciones = { desde: "2026-10-01", hasta: "2026-10-31" };

  test("saldo según naturaleza", () => {
    assert.equal(saldoSegunNaturaleza("debito", 100, 30), 70);
    assert.equal(saldoSegunNaturaleza("credito", 100, 30), -70);
  });

  test("cada cuenta suma sus subcuentas; saldo inicial, movimientos y saldo final", () => {
    const { filas, totales, lineasSinCuenta } = balanceDePrueba(cuentas, movimientos, opciones);
    const f = (codigo: string) => filas.find((x) => x.codigo === codigo)!;
    assert.deepEqual([f("111005").saldoInicial, f("111005").debitos, f("111005").creditos, f("111005").saldoFinal], [300000, 1000000, 200000, 1100000]);
    assert.deepEqual([f("1").saldoInicial, f("1").saldoFinal], [300000, 1100000], "la clase acumula toda la rama");
    assert.deepEqual([f("413505").saldoInicial, f("413505").saldoFinal], [300000, 1100000], "las de naturaleza crédito quedan en positivo");
    assert.deepEqual(totales, { debitos: 1200000, creditos: 1200000, cuadra: true });
    assert.equal(lineasSinCuenta, 0);
    assert.deepEqual(filas.map((x) => x.codigo), ["1", "11", "1110", "111005", "2", "4", "4135", "413505"]);
  });

  test("nivel máximo y solo con movimiento", () => {
    const r = balanceDePrueba(cuentas, movimientos, { ...opciones, nivelMax: 2, soloConMovimiento: true });
    assert.deepEqual(r.filas.map((x) => x.codigo), ["1", "11", "4"], "sin el Pasivo vacío ni niveles 3-4");
  });

  test("líneas de una cuenta inexistente cuentan en los totales y se reportan; un ciclo en el PUC no cuelga", () => {
    const conCiclo: CuentaPuc[] = [
      { id: 1, codigo: "9", nombre: "A", nivel: 1, padre_id: 2, naturaleza: "debito" },
      { id: 2, codigo: "91", nombre: "B", nivel: 2, padre_id: 1, naturaleza: "debito" },
    ];
    const r = balanceDePrueba(conCiclo, [
      { cuenta_id: 2, fecha: "2026-10-01", debe: 50, haber: 0 },
      { cuenta_id: 99, fecha: "2026-10-01", debe: 0, haber: 50 },
    ], opciones);
    assert.equal(r.lineasSinCuenta, 1);
    assert.deepEqual(r.totales, { debitos: 50, creditos: 50, cuadra: true });
    assert.deepEqual(r.filas.map((x) => [x.codigo, x.debitos]), [["9", 50], ["91", 50]]);
  });

  test("un libro descuadrado se reporta", () => {
    const r = balanceDePrueba(cuentas, [{ cuenta_id: 4, fecha: "2026-10-01", debe: 10, haber: 0 }], opciones);
    assert.equal(r.totales.cuadra, false);
  });
});
