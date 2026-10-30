// #57 — Dos controles de la liquidación compartida, antes de numerar y de escribir:
//   1) Modalidad nueva: el PVP sale del neto RECALCULADO (tarifa + regla 161) pero
//      la CxP sale del neto PERSISTIDO. Si no coinciden al centavo, la reserva se
//      rechaza y se pide actualizar la salida y recotizar (no se elige uno).
//   2) El precio exigible debe cubrir el costo del programa y la asistencia de los
//      pasajeros a quienes se les cobra. El fee bancario no es costo.
// Los valores salen de ejecutar `lib/calc/programaPrecio.ts` (no de fórmulas aquí).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { calcularNetoProgramaConModalidad } from "../lib/calc/programaPrecio.ts";
import {
  evaluarCoberturaCosto,
  liquidarSeleccion,
  precioUnitarioSalida,
  type ProgramaPrecioCabecera,
  type SalidaPrecio,
} from "../lib/programas/precioReserva57.ts";

type Fila = Record<string, unknown>;

const programa = (over: Partial<ProgramaPrecioCabecera> = {}): ProgramaPrecioCabecera => ({
  moneda: "USD", pct_mk: 0.15, pct_fee_tarjeta: 0.03, asistencia_medica_dia: 4, dias: 8,
  regla_comisionable: false, regla_comisionable_modalidad_mk: "historica", regla_comisionable_modo: "pct",
  regla_comisionable_valor: 0, regla_comisionable_pct_comision: 0, regla_comisionable_impuesto_por_acomodacion: false,
  ...over,
});
const nueva = (modo: string, valor: number, pct: number, over: Partial<ProgramaPrecioCabecera> = {}) =>
  programa({
    regla_comisionable: true, regla_comisionable_modalidad_mk: "base_neta_impuestos_al_final",
    regla_comisionable_modo: modo, regla_comisionable_valor: valor, regla_comisionable_pct_comision: pct, ...over,
  });
const salida = (over: Fila = {}): SalidaPrecio => ({
  noches: null, bajo_solicitud: false,
  neto_sencilla: 1400, neto_doble: 1000, neto_triple: 900, neto_multiple: 850, neto_nino: 700,
  tarifa_sencilla: null, tarifa_doble: null, tarifa_triple: null, tarifa_multiple: null,
  impuesto_sencilla: null, impuesto_doble: null, impuesto_triple: null, impuesto_multiple: null,
  ...over,
}) as SalidaPrecio;
const reservar = (prog: ProgramaPrecioCabecera, sal: SalidaPrecio, habitaciones: Record<string, number> = { doble: 1 }, ninos = 0) =>
  liquidarSeleccion({ programa: prog, fuente: { modo: "salida", salida: sal }, habitaciones, ninos });
const netoReal = (tarifa: number, modo: "pct" | "impuesto" | "ninguno", valor: number, pct: number) =>
  calcularNetoProgramaConModalidad({ tarifa, modo, valor, pctComision: pct }, "base_neta_impuestos_al_final").neto;

describe("modalidad nueva: neto vigente / obsoleto", () => {
  test("vigente: el persistido == el recalculado → se liquida (USD, modo pct)", () => {
    assert.equal(netoReal(1000, "pct", 3, 10), 903);
    const r = reservar(nueva("pct", 3, 10), salida({ tarifa_doble: 1000, neto_doble: 903 }));
    assert.ok(r.ok, JSON.stringify(r));
    if (r.ok) { assert.equal(r.lineas[0].via, "modalidad_nueva"); assert.equal(r.precioVenta, 1129 * 2); }
    const u = precioUnitarioSalida(nueva("pct", 3, 10), salida({ tarifa_doble: 1000, neto_doble: 903 }), "doble")!;
    assert.deepEqual([u.netoRecalculado, u.netoVigente], [903, true]);
  });

  test("obsoleto en cualquier sentido: se rechaza pidiendo actualizar y recotizar; no se elige un neto en silencio", () => {
    for (const persistido of [900, 910, 902.99, 903.01]) {
      const r = reservar(nueva("pct", 3, 10), salida({ tarifa_doble: 1000, neto_doble: persistido }));
      assert.equal(r.ok, false, `persistido ${persistido}`);
      if (!r.ok) {
        assert.equal(r.codigo, "neto_obsoleto");
        assert.match(r.error, /doble/);
        assert.match(r.error, /no coincide con el recalculado/);
        assert.match(r.error, /Actualiza las tarifas de la salida.*vuelve a cotizar/);
        assert.match(r.error, /no se creó ningún contrato/);
        // El mensaje va al usuario (incluido `venta`): sin cifras de costo. El detalle es solo para el log.
        assert.doesNotMatch(r.error, /\d/, "el mensaje no debe traer cifras");
        assert.match(r.detalle ?? "", /neto_persistido=.*neto_recalculado=/);
      }
    }
  });

  test("la comparación es al centavo: 903,004 es el mismo centavo; 903,01 no", () => {
    assert.ok(reservar(nueva("pct", 3, 10), salida({ tarifa_doble: 1000, neto_doble: 903.004 })).ok);
    assert.equal(reservar(nueva("pct", 3, 10), salida({ tarifa_doble: 1000, neto_doble: 903.01 })).ok, false);
  });

  test("COP, modo impuesto: vigente pasa, obsoleto no", () => {
    const prog = nueva("impuesto", 150_000, 10, { moneda: "COP", asistencia_medica_dia: 4500, pct_fee_tarjeta: 0.035 });
    const vigente = netoReal(2_500_000, "impuesto", 150_000, 10);
    assert.equal(vigente, 2_265_000);
    assert.ok(reservar(prog, salida({ tarifa_doble: 2_500_000, neto_doble: vigente })).ok);
    const viejo = reservar(prog, salida({ tarifa_doble: 2_500_000, neto_doble: 2_250_000 }));
    assert.equal(viejo.ok, false);
    if (!viejo.ok) assert.equal(viejo.codigo, "neto_obsoleto");
  });

  test("COP, modo ninguno: el neto es tarifa − comisión", () => {
    const prog = nueva("ninguno", 0, 12.5, { moneda: "COP" });
    assert.equal(netoReal(3_000_000, "ninguno", 0, 12.5), 2_625_000);
    assert.ok(reservar(prog, salida({ tarifa_triple: 3_000_000, neto_triple: 2_625_000 }), { triple: 1 }).ok);
    assert.equal(reservar(prog, salida({ tarifa_triple: 3_000_000, neto_triple: 2_700_000 }), { triple: 1 }).ok, false);
  });

  test("impuesto por acomodación: un neto calculado con el impuesto general queda obsoleto si la acomodación tiene el suyo", () => {
    const prog = nueva("impuesto", 50, 10, { regla_comisionable_impuesto_por_acomodacion: true });
    const conSuyo = netoReal(1000, "impuesto", 100, 10);
    const conGeneral = netoReal(1000, "impuesto", 50, 10);
    assert.notEqual(conSuyo, conGeneral);
    assert.ok(reservar(prog, salida({ tarifa_doble: 1000, impuesto_doble: 100, neto_doble: conSuyo })).ok);
    assert.equal(reservar(prog, salida({ tarifa_doble: 1000, impuesto_doble: 100, neto_doble: conGeneral })).ok, false);
  });

  test("solo importa lo que se reserva: una acomodación obsoleta que NO se selecciona no bloquea", () => {
    const sal = salida({ tarifa_doble: 1000, neto_doble: 903, tarifa_sencilla: 1500, neto_sencilla: 1 });
    assert.ok(reservar(nueva("pct", 3, 10), sal, { doble: 1 }).ok);
    assert.equal(reservar(nueva("pct", 3, 10), sal, { sencilla: 1 }).ok, false);
    assert.equal(reservar(nueva("pct", 3, 10), sal, { doble: 1, sencilla: 1 }).ok, false);
  });

  test("niños: el niño no tiene tarifa de proveedor (no se compara), pero un adulto obsoleto bloquea la reserva con niños", () => {
    const vigente = salida({ tarifa_doble: 1000, neto_doble: 903, neto_nino: 700 });
    const obsoleto = salida({ tarifa_doble: 1000, neto_doble: 850, neto_nino: 700 });
    const ok = reservar(nueva("pct", 3, 10), vigente, { doble: 1 }, 2);
    assert.ok(ok.ok);
    if (ok.ok) { assert.equal(ok.nino?.cantidad, 2); assert.equal(ok.totalPax, 4); }
    const mal = reservar(nueva("pct", 3, 10), obsoleto, { doble: 1 }, 2);
    assert.equal(mal.ok, false);
    if (!mal.ok) assert.equal(mal.codigo, "neto_obsoleto");
    // Solo niños: ninguna acomodación de adulto entra a la reserva.
    assert.ok(reservar(nueva("pct", 3, 10), obsoleto, {}, 1).ok);
  });

  test("fuera de la modalidad nueva no se compara: histórica (con regla activa y tarifa) y modo categoría usan el persistido para PVP y CxP", () => {
    const hist = nueva("pct", 3, 10, { regla_comisionable_modalidad_mk: "historica" });
    const u = precioUnitarioSalida(hist, salida({ tarifa_doble: 1000, neto_doble: 850 }), "doble")!;
    assert.deepEqual([u.via, u.netoRecalculado, u.netoVigente], ["historica", null, null]);
    assert.ok(reservar(hist, salida({ tarifa_doble: 1000, neto_doble: 850 })).ok);
    const cat = liquidarSeleccion({ programa: nueva("pct", 3, 10), fuente: { modo: "categoria", precios: [{ acomodacion: "doble", neto: 850, bajo_solicitud: false }] }, habitaciones: { doble: 1 }, ninos: 0 });
    assert.ok(cat.ok);
  });

  test("sin tarifa de proveedor en la acomodación (neto cargado a mano) no hay nada que comparar", () => {
    assert.ok(reservar(nueva("pct", 3, 10), salida({ tarifa_doble: null, neto_doble: 850 })).ok);
  });
});

describe("cobertura del costo (neto + asistencia de quienes pagan; sin fee)", () => {
  test("USD: 2 hab. dobles + 1 niño, 8 días de asistencia: costo = neto 4.700 + asistencia 4×8×5 = 160 → 4.860; el precio (5.896) lo cubre", () => {
    const r = reservar(programa(), salida(), { doble: 2 }, 1);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.costoNeto, 4700);
      assert.equal(r.costoAsistencia, 160);
      assert.equal(r.costoAtribuible, 4860);
      assert.equal(r.precioVenta, 5896);
      assert.ok(r.precioVenta >= r.costoAtribuible);
    }
  });

  test("los infantes no pagan: no suman asistencia al costo atribuible", () => {
    const sin = liquidarSeleccion({ programa: programa(), fuente: { modo: "salida", salida: salida() }, habitaciones: { doble: 1 }, ninos: 0 });
    const con = liquidarSeleccion({ programa: programa(), fuente: { modo: "salida", salida: salida() }, habitaciones: { doble: 1 }, ninos: 0, infantes: 3 });
    assert.ok(sin.ok && con.ok);
    if (sin.ok && con.ok) { assert.equal(con.costoAtribuible, sin.costoAtribuible); assert.equal(con.totalPax, sin.totalPax + 3); }
  });

  test("el fee bancario NO es costo: con 0 % y 3,5 % de fee el costo atribuible es el mismo y el precio sube", () => {
    const a = reservar(programa({ pct_fee_tarjeta: 0 }), salida());
    const b = reservar(programa({ pct_fee_tarjeta: 0.035 }), salida());
    assert.ok(a.ok && b.ok);
    if (a.ok && b.ok) { assert.equal(a.costoAtribuible, b.costoAtribuible); assert.ok(b.precioVenta > a.precioVenta); }
  });

  test("COP: la asistencia diaria se cuenta por pasajero cobrado y por las noches explícitas de la salida", () => {
    const prog = programa({ moneda: "COP", asistencia_medica_dia: 4500, pct_mk: 0.1, pct_fee_tarjeta: 0 });
    const r = reservar(prog, salida({ noches: 5, neto_doble: 1_000_000, neto_nino: 600_000 }), { doble: 1 }, 1);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.costoAsistencia, 4500 * 5 * 3, "3 pasajeros cobrados × 5 noches");
      assert.equal(r.costoAtribuible, 2_000_000 + 600_000 + 67_500);
      assert.ok(r.precioVenta >= r.costoAtribuible);
    }
  });

  test("borde al centavo: el precio igual al costo cubre; un centavo menos no", () => {
    const args = { lineas: [{ netoUnit: 1000, pax: 4 }], nino: { cantidad: 1, netoUnit: 700 }, asistenciaDia: 4, dias: 8, moneda: "USD" };
    assert.deepEqual(evaluarCoberturaCosto({ ...args, precioCentavos: 486_000 }), { ok: true, costoAtribuible: 4860, costoAsistencia: 160 });
    const menos = evaluarCoberturaCosto({ ...args, precioCentavos: 485_999 });
    assert.equal(menos.ok, false);
    if (!menos.ok) {
      assert.match(menos.error, /no cubre el costo del programa y la asistencia/);
      assert.match(menos.error, /no se creó ningún contrato/);
      assert.doesNotMatch(menos.error, /\d/, "el mensaje no debe traer cifras de costo");
      assert.match(menos.detalle, /costo_atribuible=4\.860/);
    }
    assert.equal(evaluarCoberturaCosto({ ...args, precioCentavos: 486_001 }).ok, true);
  });

  test("sin días de asistencia (NULL) la asistencia es 0 y el costo es solo el neto", () => {
    const r = evaluarCoberturaCosto({ precioCentavos: 200_000, lineas: [{ netoUnit: 1000, pax: 2 }], nino: null, asistenciaDia: 4, dias: null, moneda: "USD" });
    assert.deepEqual(r, { ok: true, costoAtribuible: 2000, costoAsistencia: 0 });
  });
});
