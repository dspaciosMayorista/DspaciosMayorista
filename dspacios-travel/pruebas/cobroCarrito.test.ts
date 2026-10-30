// #90 F — reglas PURAS de la moneda de cobro de un carrito (lib/finanzas/cobroCarrito.ts). La ejecución del servidor está en cobroCarritoConversion.test.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  cobroDeContratoCarrito, compararConCongelado, leerCobroCongelado, monedaOfertaDeCotizacion, resolverMonedaOferta, totalesACobrar, validarEleccionCarrito,
  MENSAJE_COBRO_CARRITO_CAMBIO, MENSAJE_COBRO_CARRITO_HISTORICO, MENSAJE_COBRO_CARRITO_TOTAL_INVALIDO,
} from "../lib/finanzas/cobroCarrito.ts";
import { MENSAJE_COBRO_REQUERIDO, MENSAJE_COBRO_SOLO_INTERNO, MENSAJE_TRM_COBRO_REQUERIDA } from "../lib/finanzas/cobro.ts";

describe("validarEleccionCarrito: elección obligatoria y expresa", () => {
  const base = { monedaOferta: "COP", esInterno: true };
  test("omitida / vacía / null se rechaza (sin valor por defecto), también para la misma moneda", () => {
    for (const v of [undefined, null, "", "  "]) assert.deepEqual(validarEleccionCarrito({ ...base, monedaCobro: v, trmCobro: null }), { ok: false, error: MENSAJE_COBRO_REQUERIDO });
  });
  test("la misma moneda se registra, sin TRM aunque llegue una", () => {
    assert.deepEqual(validarEleccionCarrito({ ...base, monedaCobro: "cop", trmCobro: 4000 }), { ok: true, eleccion: { monedaCobro: "COP", trmCobro: null } });
  });
  test("otra moneda: exige TRM positiva y personal interno", () => {
    assert.deepEqual(validarEleccionCarrito({ ...base, monedaCobro: "USD", trmCobro: null }), { ok: false, error: MENSAJE_TRM_COBRO_REQUERIDA });
    assert.equal(validarEleccionCarrito({ ...base, monedaCobro: "USD", trmCobro: 0 }).ok, false);
    assert.equal(validarEleccionCarrito({ ...base, monedaCobro: "USD", trmCobro: "abc" }).ok, false);
    assert.deepEqual(validarEleccionCarrito({ ...base, esInterno: false, monedaCobro: "USD", trmCobro: 4000 }), { ok: false, error: MENSAJE_COBRO_SOLO_INTERNO });
    assert.deepEqual(validarEleccionCarrito({ ...base, monedaCobro: "USD", trmCobro: "4000,5" }), { ok: true, eleccion: { monedaCobro: "USD", trmCobro: 4000.5 } });
  });
});

describe("cobroDeContratoCarrito: una sola conversión por contrato, hacia arriba", () => {
  test("COP → USD al dólar entero hacia arriba (y a centavos antes de redondear)", () => {
    assert.deepEqual(cobroDeContratoCarrito({ precioVenta: 600_000, monedaContrato: "COP", eleccion: { monedaCobro: "USD", trmCobro: 4100 } }),
      { ok: true, cobro: { moneda_cobro: "USD", trm_cobro: 4100, total_cobro: 147 } });
    assert.equal((cobroDeContratoCarrito({ precioVenta: 4_000_000, monedaContrato: "COP", eleccion: { monedaCobro: "USD", trmCobro: 4000 } }) as { cobro: { total_cobro: number } }).cobro.total_cobro, 1000, "exacto no sube");
  });
  test("USD → COP al mil hacia arriba", () => {
    assert.deepEqual(cobroDeContratoCarrito({ precioVenta: 300, monedaContrato: "USD", eleccion: { monedaCobro: "COP", trmCobro: 4100.5 } }),
      { ok: true, cobro: { moneda_cobro: "COP", trm_cobro: 4100.5, total_cobro: 1_231_000 } });
  });
  test("misma moneda: sin TRM ni total (coherente con ventas_cobro_chk)", () => {
    assert.deepEqual(cobroDeContratoCarrito({ precioVenta: 1, monedaContrato: "USD", eleccion: { monedaCobro: "USD", trmCobro: null } }),
      { ok: true, cobro: { moneda_cobro: "USD", trm_cobro: null, total_cobro: null } });
  });
  test("un total no positivo no se convierte (la base exigiría total_cobro > 0)", () => {
    assert.deepEqual(cobroDeContratoCarrito({ precioVenta: 0, monedaContrato: "COP", eleccion: { monedaCobro: "USD", trmCobro: 4000 } }), { ok: false, error: MENSAJE_COBRO_CARRITO_TOTAL_INVALIDO });
  });
  test("cada contrato se convierte por separado (la suma de los redondeos no es el redondeo de la suma)", () => {
    const e = { monedaCobro: "USD" as const, trmCobro: 4000 };
    const t = (p: number) => (cobroDeContratoCarrito({ precioVenta: p, monedaContrato: "COP", eleccion: e }) as { cobro: { total_cobro: number } }).cobro.total_cobro;
    assert.deepEqual([t(600_100), t(400_100), t(1_000_200)], [151, 101, 251]);
  });
});

describe("congelado y reintentos", () => {
  const e = (monedaCobro: "COP" | "USD", trmCobro: number | null) => ({ monedaCobro, trmCobro });
  test("leerCobroCongelado no confía en la forma", () => {
    assert.equal(leerCobroCongelado(null), null);
    assert.equal(leerCobroCongelado({ cobro: { moneda: "EUR" } }), null);
    assert.deepEqual(leerCobroCongelado({ cobro: { moneda: "USD", trm: "4000" } }), { moneda: "USD", trm: 4000 });
    assert.deepEqual(leerCobroCongelado({ cobro: { moneda: "COP" } }), { moneda: "COP", trm: null });
  });
  test("con elección congelada: solo la misma moneda y la misma TRM", () => {
    const congelado = { moneda: "USD" as const, trm: 4000 };
    const cmp = (el: ReturnType<typeof e>) => compararConCongelado({ eleccion: el, congelado, hayContratos: true, monedaOferta: "COP" });
    assert.deepEqual(cmp(e("USD", 4000)), { ok: true });
    assert.deepEqual(cmp(e("USD", 4000.00001)), { ok: true }, "a 4 decimales");
    assert.deepEqual(cmp(e("USD", 4100)), { ok: false, error: MENSAJE_COBRO_CARRITO_CAMBIO });
    assert.deepEqual(cmp(e("COP", null)), { ok: false, error: MENSAJE_COBRO_CARRITO_CAMBIO });
  });
  test("sin elección congelada pero con contratos (previos a este cambio): solo la moneda de la oferta, sin TRM", () => {
    const cmp = (el: ReturnType<typeof e>) => compararConCongelado({ eleccion: el, congelado: null, hayContratos: true, monedaOferta: "COP" });
    assert.deepEqual(cmp(e("COP", null)), { ok: true });
    assert.deepEqual(cmp(e("USD", 4000)), { ok: false, error: MENSAJE_COBRO_CARRITO_HISTORICO });
  });
  test("sin contratos creados la elección es libre", () => {
    assert.deepEqual(compararConCongelado({ eleccion: e("USD", 4000), congelado: null, hayContratos: false, monedaOferta: "COP" }), { ok: true });
  });
});

describe("totalesACobrar (vista previa)", () => {
  test("misma moneda: los mismos totales; otra: convertidos por contrato; sin TRM válida: null", () => {
    assert.deepEqual(totalesACobrar([600_100, 400_100], "COP", "COP", null), [600_100, 400_100]);
    assert.deepEqual(totalesACobrar([600_100, 400_100], "COP", "USD", 4000), [151, 101]);
    assert.deepEqual(totalesACobrar([600_100], "COP", "USD", null), [null]);
    assert.deepEqual(totalesACobrar([300], "USD", "COP", 4100), [1_230_000]);
  });
});

describe("resolverMonedaOferta: todas las unidades de cada grupo en la moneda de la cotización", () => {
  const u = (origen: string, moneda: unknown) => ({ origen, moneda });
  test("un grupo de SOLO tours toma la moneda de la cotización (no un COP supuesto)", () => {
    assert.deepEqual(resolverMonedaOferta({ monedaCotizacion: "USD", grupos: [{ etiqueta: "SANTA MARTA", unidades: [u("Tour A", "USD"), u("Tour B", "USD")] }] }), { ok: true, moneda: "USD" });
    assert.deepEqual(resolverMonedaOferta({ monedaCotizacion: "usd", grupos: [{ etiqueta: "", unidades: [u("Tour A", undefined), u("Tour B", "")] }] }), { ok: true, moneda: "USD" }, "un tour sin moneda declarada hereda la de la cotización");
  });
  test("hotel USD en un grupo y solo tours USD en otro: ambos USD", () => {
    assert.deepEqual(resolverMonedaOferta({ monedaCotizacion: "USD", grupos: [
      { etiqueta: "CARTAGENA", unidades: [u("Hotel", "USD")] }, { etiqueta: "SANTA MARTA", unidades: [u("Tour", "USD")] },
    ] }), { ok: true, moneda: "USD" });
  });
  test("una unidad en OTRA moneda (en cualquier grupo) se rechaza y nombra la unidad, sin sumar nada", () => {
    const r = resolverMonedaOferta({ monedaCotizacion: "USD", grupos: [
      { etiqueta: "CARTAGENA", unidades: [u("Hotel", "USD")] }, { etiqueta: "SANTA MARTA", unidades: [u("Tour Rosario", "COP")] },
    ] });
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /Tour Rosario \(contrato SANTA MARTA\): su moneda \(COP\) no coincide con la de la cotización \(USD\)/);
    assert.equal(resolverMonedaOferta({ monedaCotizacion: "USD", grupos: [{ etiqueta: "", unidades: [u("Hotel", "USD"), u("Tour", "COP")] }] }).ok, false, "mezcla dentro del mismo grupo");
    assert.equal(resolverMonedaOferta({ monedaCotizacion: "COP", grupos: [{ etiqueta: "", unidades: [u("Tour", "EUR")] }] }).ok, false, "moneda desconocida");
    assert.equal(resolverMonedaOferta({ monedaCotizacion: "EUR", grupos: [] }).ok, false, "cotización con moneda desconocida");
  });
  test("cotización sin moneda (dato histórico): manda la primera moneda explícita; si discrepan se rechaza; sin ninguna, COP", () => {
    assert.deepEqual(resolverMonedaOferta({ monedaCotizacion: null, grupos: [{ etiqueta: "", unidades: [u("Tour", "USD"), u("Tour 2", "USD")] }] }), { ok: true, moneda: "USD" });
    assert.equal(resolverMonedaOferta({ monedaCotizacion: null, grupos: [{ etiqueta: "A", unidades: [u("Tour", "USD")] }, { etiqueta: "B", unidades: [u("Tour 2", "COP")] }] }).ok, false);
    assert.deepEqual(resolverMonedaOferta({ monedaCotizacion: undefined, grupos: [{ etiqueta: "", unidades: [u("Tour", undefined)] }] }), { ok: true, moneda: "COP" });
  });
});

describe("monedaOfertaDeCotizacion (la moneda con la que se valida la elección de cobro)", () => {
  test("la de la cotización; si falta, la primera explícita del payload; si ninguna, COP", () => {
    assert.equal(monedaOfertaDeCotizacion("usd", { tours: [{ moneda: "COP" }] }), "USD");
    assert.equal(monedaOfertaDeCotizacion(null, { tours: [{ nombre: "x" }, { moneda: "USD" }] }), "USD");
    assert.equal(monedaOfertaDeCotizacion(null, { items: [{ moneda: "COP" }], tours: [{ moneda: "USD" }] }), "COP");
    assert.equal(monedaOfertaDeCotizacion(undefined, {}), "COP");
    assert.equal(monedaOfertaDeCotizacion("EUR", null), "COP");
  });
});
