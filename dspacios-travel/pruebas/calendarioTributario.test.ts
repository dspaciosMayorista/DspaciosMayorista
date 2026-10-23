// #43-1a — Calendario tributario: lógica pura (lib/contabilidad/calendarioTributario.ts).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  periodosPorAnio, etiquetaPeriodo, digitosNit, diasEntre, estadoDe, resolverVencimientos,
  alertasTributarias, validarVencimiento, digitosDeRegla, esPeriodicidad,
  type Obligacion, type Vencimiento, type Cumplimiento,
} from "../lib/contabilidad/calendarioTributario.ts";

describe("periodos y etiquetas", () => {
  test("periodos por periodicidad", () => {
    assert.deepEqual(["mensual", "bimestral", "cuatrimestral", "semestral", "anual"].map((p) => periodosPorAnio(p as never)), [12, 6, 3, 2, 1]);
    assert.equal(esPeriodicidad("trimestral"), false);
  });
  test("etiquetas legibles por periodo", () => {
    assert.equal(etiquetaPeriodo("mensual", 1, 2026), "Enero 2026");
    assert.equal(etiquetaPeriodo("mensual", 12, 2026), "Diciembre 2026");
    assert.equal(etiquetaPeriodo("bimestral", 3, 2026), "Bimestre 3 (may–jun) 2026");
    assert.equal(etiquetaPeriodo("cuatrimestral", 1, 2026), "Cuatrimestre 1 (ene–abr) 2026");
    assert.equal(etiquetaPeriodo("cuatrimestral", 3, 2026), "Cuatrimestre 3 (sep–dic) 2026");
    assert.equal(etiquetaPeriodo("semestral", 2, 2026), "Semestre 2 (jul–dic) 2026");
    assert.equal(etiquetaPeriodo("anual", 1, 2025), "Año 2025");
  });
});

describe("dígitos del NIT", () => {
  test("regla 0 no necesita NIT", () => assert.equal(digitosNit(null, 0), "*"));
  test("último dígito, sin DV, con puntos o espacios", () => {
    assert.equal(digitosNit("900.123.457", 1), "7");
    assert.equal(digitosNit("900123457-3", 1), "7", "el DV no cuenta");
    assert.equal(digitosNit(" 900 123 450 ", 1), "0");
  });
  test("últimos dos dígitos", () => {
    assert.equal(digitosNit("900123457", 2), "57");
    assert.equal(digitosNit("900123405-1", 2), "05");
  });
  test("sin NIT o sin dígitos suficientes: null", () => {
    assert.equal(digitosNit(null, 1), null);
    assert.equal(digitosNit("", 1), null);
    assert.equal(digitosNit("-5", 1), null);
    assert.equal(digitosNit("7", 2), null);
  });
  test("orden de dígitos como lo publica la DIAN", () => {
    assert.deepEqual(digitosDeRegla(1), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]);
    assert.equal(digitosDeRegla(2).length, 100);
    assert.equal(digitosDeRegla(2)[0], "01");
    assert.equal(digitosDeRegla(2)[99], "00");
    assert.deepEqual(digitosDeRegla(0), ["*"]);
  });
});

describe("estados", () => {
  const conPago = { requierePago: true, diasAviso: 10 };
  const sinPago = { requierePago: false, diasAviso: 10 };
  test("días entre fechas, incluido cambio de año y bisiesto", () => {
    assert.equal(diasEntre("2026-10-17", "2026-10-27"), 10);
    assert.equal(diasEntre("2026-12-31", "2027-01-01"), 1);
    assert.equal(diasEntre("2028-02-28", "2028-03-01"), 2);
    assert.equal(diasEntre("2026-10-17", "2026-10-10"), -7);
  });
  test("próxima dentro del aviso, futura fuera, vencida si pasó", () => {
    assert.equal(estadoDe(conPago, "2026-10-27", "2026-10-17", undefined), "proxima");
    assert.equal(estadoDe(conPago, "2026-10-17", "2026-10-17", undefined), "proxima", "vence hoy");
    assert.equal(estadoDe(conPago, "2026-10-28", "2026-10-17", undefined), "futura");
    assert.equal(estadoDe(conPago, "2026-10-16", "2026-10-17", undefined), "vencida");
  });
  test("cumplida exige pago solo si la obligación lo requiere", () => {
    const presentada = { presentadaEn: "2026-10-10", pagadaEn: null };
    assert.equal(estadoDe(conPago, "2026-10-16", "2026-10-17", presentada), "falta_pago");
    assert.equal(estadoDe(sinPago, "2026-10-16", "2026-10-17", presentada), "cumplida");
    assert.equal(estadoDe(conPago, "2026-10-16", "2026-10-17", { presentadaEn: "2026-10-10", pagadaEn: "2026-10-11" }), "cumplida");
    assert.equal(estadoDe(conPago, "2026-10-16", "2026-10-17", { presentadaEn: null, pagadaEn: "2026-10-11" }), "vencida",
      "un pago sin presentación no la cumple");
  });
});

describe("resolverVencimientos", () => {
  const ob = (id: number, extra: Partial<Obligacion> = {}): Obligacion => ({
    id, nombre: `Obligación ${id}`, periodicidad: "mensual", reglaDigitos: 1, diasAviso: 10, requierePago: true, activa: true, ...extra,
  });
  const v = (obligacionId: number, periodo: number, digitos: string, fecha: string, anio = 2026): Vencimiento =>
    ({ obligacionId, anio, periodo, digitos, fecha });

  test("elige la fecha del dígito de la agencia e ignora las demás", () => {
    const r = resolverVencimientos({
      obligaciones: [ob(1)],
      vencimientos: [v(1, 10, "7", "2026-11-20"), v(1, 10, "8", "2026-11-21"), v(1, 11, "7", "2026-12-18")],
      cumplimientos: [], nit: "900123457-1", hoy: "2026-11-15",
    });
    assert.deepEqual(r.items.map((i) => [i.periodo, i.fecha, i.estado]), [[10, "2026-11-20", "proxima"], [11, "2026-12-18", "futura"]]);
    assert.equal(r.sinResolver.length, 0);
    assert.equal(r.items[0].etiqueta, "Octubre 2026");
  });

  test("regla 0 usa la fecha común; regla 2 los dos últimos dígitos", () => {
    const r = resolverVencimientos({
      obligaciones: [ob(1, { reglaDigitos: 0, periodicidad: "anual" }), ob(2, { reglaDigitos: 2, periodicidad: "anual" })],
      vencimientos: [v(1, 1, "*", "2026-04-30"), v(2, 1, "57", "2026-05-12"), v(2, 1, "56", "2026-05-11")],
      cumplimientos: [], nit: "900123457", hoy: "2026-01-10",
    });
    assert.deepEqual(r.items.map((i) => [i.obligacionId, i.fecha]), [[1, "2026-04-30"], [2, "2026-05-12"]]);
  });

  test("sin NIT o sin fechas para los dígitos: queda como pendiente de configurar, no como 'sin vencimientos'", () => {
    const r = resolverVencimientos({
      obligaciones: [ob(1), ob(2), ob(3, { reglaDigitos: 0 })],
      vencimientos: [v(2, 1, "3", "2026-02-10")],
      cumplimientos: [], nit: null, hoy: "2026-01-10",
    });
    assert.deepEqual(r.sinResolver.map((s) => s.obligacionId).sort(), [1, 2, 3]);
    assert.match(r.sinResolver.find((s) => s.obligacionId === 1)!.motivo, /NIT/);
    assert.match(r.sinResolver.find((s) => s.obligacionId === 3)!.motivo, /No hay fechas/);
    const r2 = resolverVencimientos({ obligaciones: [ob(2)], vencimientos: [v(2, 1, "3", "2026-02-10")], cumplimientos: [], nit: "900123457", hoy: "2026-01-10" });
    assert.match(r2.sinResolver[0].motivo, /dígitos 7/);
  });

  test("las inactivas no aparecen y las constancias marcan el estado", () => {
    const cumplimientos: Cumplimiento[] = [{ obligacionId: 1, anio: 2026, periodo: 9, presentadaEn: "2026-10-09", pagadaEn: "2026-10-09" }];
    const r = resolverVencimientos({
      obligaciones: [ob(1), ob(2, { activa: false })],
      vencimientos: [v(1, 9, "7", "2026-10-13"), v(1, 10, "7", "2026-11-13"), v(2, 9, "7", "2026-10-13")],
      cumplimientos, nit: "900123457", hoy: "2026-10-17",
    });
    assert.deepEqual(r.items.map((i) => [i.periodo, i.estado]), [[9, "cumplida"], [10, "futura"]]);
  });

  test("alertas: vencidas sin cumplir, presentadas sin pago y próximas", () => {
    const r = resolverVencimientos({
      obligaciones: [ob(1), ob(2, { requierePago: false })],
      vencimientos: [v(1, 8, "7", "2026-09-10"), v(1, 9, "7", "2026-10-13"), v(1, 10, "7", "2026-10-20"),
        v(1, 11, "7", "2026-12-15"), v(2, 9, "7", "2026-10-01")],
      cumplimientos: [{ obligacionId: 1, anio: 2026, periodo: 9, presentadaEn: "2026-10-12", pagadaEn: null },
        { obligacionId: 2, anio: 2026, periodo: 9, presentadaEn: "2026-09-30", pagadaEn: null }],
      nit: "900123457", hoy: "2026-10-17",
    });
    assert.deepEqual(alertasTributarias(r.items).map((i) => [i.obligacionId, i.periodo, i.estado]),
      [[1, 8, "vencida"], [1, 9, "falta_pago"], [1, 10, "proxima"]]);
  });
});

describe("validarVencimiento", () => {
  test("periodo y dígitos según la obligación", () => {
    const bim = { periodicidad: "bimestral" as const, reglaDigitos: 1 as const };
    assert.equal(validarVencimiento(bim, { periodo: 6, digitos: "3", fecha: "2027-01-12" }), null);
    assert.match(validarVencimiento(bim, { periodo: 7, digitos: "3", fecha: "2027-01-12" })!, /fuera de rango/);
    assert.match(validarVencimiento(bim, { periodo: 1, digitos: "*", fecha: "2026-03-10" })!, /dígitos/);
    assert.match(validarVencimiento({ periodicidad: "anual", reglaDigitos: 2 }, { periodo: 1, digitos: "7", fecha: "2026-05-10" })!, /dígitos/);
    assert.equal(validarVencimiento({ periodicidad: "anual", reglaDigitos: 0 }, { periodo: 1, digitos: "*", fecha: "2026-05-10" }), null);
    assert.match(validarVencimiento({ periodicidad: "anual", reglaDigitos: 0 }, { periodo: 1, digitos: "*", fecha: "10/05/2026" })!, /Fecha/);
  });
});
