// #90 I — TRM de COSTOS del carrito y devengo por el equivalente en COP (lib/finanzas/costoTrmCarrito.ts, lib/reservar/importeObligacion63.ts).
// El recorrido completo contra Postgres está en supabase/scripts/test_236_cxp_equivalente_costo.sql y pruebas/carritoCostoUsd236.pg.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  compararTrmCostoConCongelada, decidirTrmCosto, equivalenteCopCosto, leerTrmCostoCongelada, validarTrmCosto,
  MENSAJE_TRM_COSTO_CAMBIO, MENSAJE_TRM_COSTO_INVALIDA, MENSAJE_TRM_COSTO_REQUERIDA, MENSAJE_TRM_COSTO_SOLO_INTERNO,
} from "../lib/finanzas/costoTrmCarrito.ts";
import { resolverImporteContable63 } from "../lib/reservar/importeObligacion63.ts";

describe("validarTrmCosto", () => {
  test("acepta número o texto (coma decimal) positivo y lo deja a 4 decimales", () => {
    assert.deepEqual(validarTrmCosto(3900), { ok: true, trm: 3900 });
    assert.deepEqual(validarTrmCosto("4050,5"), { ok: true, trm: 4050.5 });
    assert.deepEqual(validarTrmCosto("4050.123456"), { ok: true, trm: 4050.1235 });
  });
  test("vacía/ausente → requerida; cero, negativa, NaN, texto, booleano o desbordada → inválida", () => {
    for (const v of [undefined, null, "", "  "]) assert.deepEqual(validarTrmCosto(v), { ok: false, error: MENSAJE_TRM_COSTO_REQUERIDA }, String(v));
    for (const v of [0, -1, "0", "abc", NaN, Infinity, 1e11, 0.00001]) assert.deepEqual(validarTrmCosto(v), { ok: false, error: MENSAJE_TRM_COSTO_INVALIDA }, String(v));
    assert.deepEqual(validarTrmCosto(true), { ok: false, error: MENSAJE_TRM_COSTO_REQUERIDA });
  });
});

describe("equivalenteCopCosto", () => {
  test("USD × TRM a centavos, sin error de coma flotante", () => {
    assert.equal(equivalenteCopCosto(210, 3900), 819_000);
    assert.equal(equivalenteCopCosto(100.25, 4050.1234), 406_024.87);
    assert.equal(equivalenteCopCosto(0.1, 3), 0.3);
    assert.equal(equivalenteCopCosto(1.005, 100), 100.5);
    assert.equal(equivalenteCopCosto(-5, 4000), 0, "nunca negativo");
  });
});

describe("decidirTrmCosto: cuándo se pide, quién la pone y que un reintento no la cambia", () => {
  test("sin obligaciones en USD no se pide ni se guarda una nueva (se conserva la congelada, si la hay)", () => {
    assert.deepEqual(decidirTrmCosto({ requiere: false, recibida: 3900, esInterno: true, congelada: null }), { ok: true, trm: null });
    assert.deepEqual(decidirTrmCosto({ requiere: false, recibida: undefined, esInterno: false, congelada: 3900 }), { ok: true, trm: 3900 });
  });
  test("con obligaciones en USD: solo personal interno, TRM obligatoria y válida", () => {
    assert.deepEqual(decidirTrmCosto({ requiere: true, recibida: 3900, esInterno: false, congelada: null }), { ok: false, error: MENSAJE_TRM_COSTO_SOLO_INTERNO });
    assert.deepEqual(decidirTrmCosto({ requiere: true, recibida: undefined, esInterno: true, congelada: null }), { ok: false, error: MENSAJE_TRM_COSTO_REQUERIDA });
    assert.deepEqual(decidirTrmCosto({ requiere: true, recibida: "x", esInterno: true, congelada: null }), { ok: false, error: MENSAJE_TRM_COSTO_INVALIDA });
    assert.deepEqual(decidirTrmCosto({ requiere: true, recibida: "3900", esInterno: true, congelada: null }), { ok: true, trm: 3900 });
  });
  test("reintento: con una TRM ya congelada solo vale la misma (a 4 decimales); otra se rechaza", () => {
    assert.deepEqual(decidirTrmCosto({ requiere: true, recibida: 3900.00001, esInterno: true, congelada: 3900 }), { ok: true, trm: 3900 });
    assert.deepEqual(decidirTrmCosto({ requiere: true, recibida: 3901, esInterno: true, congelada: 3900 }), { ok: false, error: MENSAJE_TRM_COSTO_CAMBIO });
  });
  test("leerTrmCostoCongelada no confía en la forma del detalle", () => {
    assert.equal(leerTrmCostoCongelada({ costo: { trm: 3900 } }), 3900);
    for (const d of [null, undefined, {}, { costo: null }, { costo: { trm: 0 } }, { costo: { trm: "x" } }, { costo: "3900" }, { cobro: { trm: 3900 } }]) assert.equal(leerTrmCostoCongelada(d), null, JSON.stringify(d));
  });
});

describe("compararTrmCostoConCongelada: un reintento no cambia la TRM congelada (aunque no haya CxP USD pendientes)", () => {
  test("misma TRM (a 4 decimales) → ok; distinta o inválida → rechazada; sin congelada o sin recibida → nada que comparar", () => {
    assert.deepEqual(compararTrmCostoConCongelada({ congelada: 3900, recibida: "3900,00001" }), { ok: true });
    assert.deepEqual(compararTrmCostoConCongelada({ congelada: 3900, recibida: 3901 }), { ok: false, error: MENSAJE_TRM_COSTO_CAMBIO });
    assert.deepEqual(compararTrmCostoConCongelada({ congelada: 3900, recibida: "abc" }), { ok: false, error: MENSAJE_TRM_COSTO_INVALIDA });
    for (const r of [undefined, null, "", "  "]) assert.deepEqual(compararTrmCostoConCongelada({ congelada: 3900, recibida: r }), { ok: true });
    assert.deepEqual(compararTrmCostoConCongelada({ congelada: null, recibida: 4000 }), { ok: true });
  });
  test("el servidor la aplica antes del retorno de «ya convertida» y de cualquier numeración", () => {
    const src = fs.readFileSync(new URL("../app/(dashboard)/dashboard/reservar/actions.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const cuerpo = src.slice(src.indexOf("export async function convertirCotizacionCarrito("));
    const i = cuerpo.indexOf("compararTrmCostoConCongelada(");
    assert.ok(i > 0 && i < cuerpo.indexOf("contratosPrevios") && i < cuerpo.indexOf("siguienteNumeroContrato(tenantCotizacion)"));
  });
});

describe("devengo: resolverImporteContable63 con la familia de costos (migración 236)", () => {
  const ctx = { numeroContrato: "DTM-0900", tenant: "mayorista", valorTotal: 210 };
  const base = { numero_contrato: "DTM-0900", tenant: "mayorista", moneda: "USD", valor_cop_costo: 819_000, trm_costo: 3900, aceptacion_63_id: null, obligacion_63: null, valor_cop_63: null, trm_63: null };
  test("USD con equivalente coherente → se devenga por el equivalente en COP, nunca por el nominal", () => {
    assert.deepEqual(resolverImporteContable63(base, ctx), { ok: true, importe: 819_000 });
    assert.deepEqual(resolverImporteContable63({ ...base, valor_cop_costo: "819000.00", trm_costo: "3900.0000" }, ctx), { ok: true, importe: 819_000 }, "numeric llega como texto");
  });
  test("FAIL-CLOSED: par incompleto, no USD, otro contrato/agencia, valor editado, TRM/equivalente inválidos, o las dos familias a la vez", () => {
    const casos: Array<[string, Parameters<typeof resolverImporteContable63>[0], typeof ctx]> = [
      ["sin TRM", { ...base, trm_costo: null }, ctx],
      ["sin equivalente", { ...base, valor_cop_costo: null }, ctx],
      ["TRM cero", { ...base, trm_costo: 0 }, ctx],
      ["equivalente negativo", { ...base, valor_cop_costo: -1 }, ctx],
      ["moneda COP", { ...base, moneda: "COP" }, ctx],
      ["moneda ausente", { ...base, moneda: null }, ctx],
      ["otro contrato", { ...base, numero_contrato: "DTM-0901" }, ctx],
      ["otra agencia", { ...base, tenant: "minorista" }, ctx],
      ["valor editado después", base, { ...ctx, valorTotal: 250 }],
      ["equivalente que no corresponde", { ...base, valor_cop_costo: 800_000 }, ctx],
      ["marca #63 a la vez", { ...base, aceptacion_63_id: 5, obligacion_63: "hotel" }, ctx],
      ["equivalente #63 a la vez", { ...base, valor_cop_63: 819_000, trm_63: 3900 }, ctx],
    ];
    for (const [que, fila, c] of casos) assert.equal(resolverImporteContable63(fila, c).ok, false, que);
  });
  test("tolerancia de un centavo por el redondeo de la base", () => {
    assert.equal(resolverImporteContable63({ ...base, valor_cop_costo: 819_000.01 }, ctx).ok, true);
    assert.equal(resolverImporteContable63({ ...base, valor_cop_costo: 819_000.02 }, ctx).ok, false);
  });
  test("las rutas de siempre y de #63 siguen igual", () => {
    assert.deepEqual(resolverImporteContable63({ numero_contrato: "DTM-0900", tenant: "mayorista", moneda: "COP" }, { ...ctx, valorTotal: 420_000 }), { ok: true, importe: 420_000 });
    assert.deepEqual(resolverImporteContable63({ numero_contrato: "DTM-0900", tenant: "mayorista", moneda: "USD", aceptacion_63_id: 5, obligacion_63: "hotel", valor_cop_63: 819_000, trm_63: 3900 }, ctx), { ok: true, importe: 819_000 });
    assert.equal(resolverImporteContable63({ numero_contrato: "DTM-0900", tenant: "mayorista", moneda: "USD", valor_cop_63: 819_000, trm_63: 3900 }, ctx).ok, false, "equivalente #63 SIN marca sigue rechazado");
    assert.equal(resolverImporteContable63(null, ctx).ok, false);
  });
});

describe("cableado: el servidor usa las mismas piezas y el lector contable lee las columnas nuevas", () => {
  const leer = (ruta: string) => fs.readFileSync(new URL(ruta, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  test("convertirCotizacionCarrito: decide la TRM antes de numerar y la congela en detalle.costo; pushCxP arma el equivalente con la TRM de costos", () => {
    const src = leer("../app/(dashboard)/dashboard/reservar/actions.ts");
    const cuerpo = src.slice(src.indexOf("export async function convertirCotizacionCarrito("));
    const iDecide = cuerpo.indexOf("decidirTrmCosto(");
    const iNumera = cuerpo.indexOf("siguienteNumeroContrato(tenantCotizacion)");
    assert.ok(iDecide > 0 && iNumera > iDecide, "la TRM de costos se decide antes de reservar el primer número");
    assert.match(cuerpo, /detalleBase\.costo = \{ trm: trmCostoConversion \}/);
    const iSonda = cuerpo.indexOf('select("valor_cop_costo, trm_costo")');
    assert.ok(iDecide < iSonda && iSonda < iNumera, "la comprobación de que la base ya tiene la 236 va después de decidir la TRM y antes de numerar");
    assert.match(cuerpo, /valor_cop_costo: equivalenteCopCosto\(valorTotal, trmCostoConversion as number\), trm_costo: trmCostoConversion as number/);
    assert.doesNotMatch(cuerpo, /trmCobro[^;\n]*equivalenteCopCosto|equivalenteCopCosto[^;\n]*trmCobro/, "la TRM de cobro nunca entra al equivalente de costos");
  });
  test("asientos.ts lee valor_cop_costo y trm_costo al devengar", () => {
    assert.match(leer("../lib/contabilidad/asientos.ts"), /select\("numero_contrato, tenant, aceptacion_63_id, obligacion_63, valor_cop_63, trm_63, moneda, valor_cop_costo, trm_costo"\)/);
  });
  test("editar el valor de una CxP con equivalente se rechaza con un mensaje claro antes de tocar la base", () => {
    assert.match(leer("../app/(dashboard)/dashboard/contratos/[numero]/gestion-actions.ts"), /previaAc\?\.valor_cop_costo != null && Number\(previaAc\.valor_total\) !== Number\(input\.valorTotal\)/);
  });
});
