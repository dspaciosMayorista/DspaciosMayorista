import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reglaConfirmacion, textoMinimoConfirmar, ROTULO_MINIMO_CONFIRMAR, ROTULO_MINIMO_CONVERTIR } from "../lib/contrato/reglaConfirmacion.ts";
import { resolverCondicionesContrato } from "../lib/contrato/condicionesContrato.ts";

// #75 · Parte 3 — la regla ÚNICA del mínimo para confirmar. Los mismos casos que supabase/scripts/test_288c_regla_confirmacion.sh (Postgres real): si la base y esta función
// divergen, una de las dos pruebas falla. Aquí se prueba lo que PRESENTAN la pantalla y el documento.
function leer(rel: string): string { return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n"); }

describe("reglaConfirmacion (espejo de p75_priv.regla_confirmacion)", () => {
  test("condición congelada ≠ 30 %: exigido 500.000 de 1.000.000 → regla condicion_congelada", () => {
    const r = reglaConfirmacion({ netoAliado: false, totalCobro: 1_000_000, monedaCobro: "COP", condiciones: [{ monto_exigido: 500_000, moneda: "COP", trm: 1 }], pctLegacy: 0.3 });
    assert.deepEqual(r, { regla: "condicion_congelada", minimo: 500_000, moneda: "COP", trm: 1 });
  });
  test("varias filas suman; la moneda y la TRM son las CONGELADAS de las condiciones (USD, TRM 4000)", () => {
    const r = reglaConfirmacion({ netoAliado: false, totalCobro: 4_000_000, monedaCobro: "COP", condiciones: [{ monto_exigido: 100, moneda: "USD", trm: 4000 }, { monto_exigido: "200", moneda: "usd", trm: "4000" }] });
    assert.deepEqual(r, { regla: "condicion_congelada", minimo: 300, moneda: "USD", trm: 4000 });
  });
  test("NETO aliado: el total NETO exigible, aunque las condiciones pidan menos", () => {
    const r = reglaConfirmacion({ netoAliado: true, totalCobro: 900_000, monedaCobro: "COP", condiciones: [{ monto_exigido: 300_000, moneda: "COP", trm: 1 }] });
    assert.deepEqual(r, { regla: "neto_total", minimo: 900_000, moneda: "COP", trm: null });
  });
  test("NETO en la moneda de COBRO (contrato USD cobrado en COP)", () => {
    const r = reglaConfirmacion({ netoAliado: true, totalCobro: 4_000_000, monedaCobro: "COP", condiciones: [] });
    assert.equal(r.moneda, "COP");
    assert.equal(r.minimo, 4_000_000);
  });
  test("legacy_pct SOLO sin condiciones y sin NETO (30 % por defecto o el configurado)", () => {
    assert.deepEqual(reglaConfirmacion({ netoAliado: false, totalCobro: 1_000_000, monedaCobro: "COP", condiciones: [] }), { regla: "legacy_pct", minimo: 300_000, moneda: "COP", trm: null });
    assert.equal(reglaConfirmacion({ netoAliado: false, totalCobro: 1_000_000, monedaCobro: "COP", condiciones: [], pctLegacy: 0.5 }).minimo, 500_000);
  });
  test("con condiciones o NETO jamás se usa legacy_pct", () => {
    for (const e of [
      { netoAliado: true, condiciones: [] },
      { netoAliado: false, condiciones: [{ monto_exigido: 0, moneda: "COP", trm: 1 }] },
    ]) assert.notEqual(reglaConfirmacion({ totalCobro: 1_000_000, monedaCobro: "COP", pctLegacy: 0.3, ...e }).regla, "legacy_pct");
  });
});

describe("pantalla y documento leen la MISMA regla", () => {
  const fila = (monto: number) => ({
    id: 1, tipo_componente: "hotel", referencia_externa: null, orden: 0, valor_componente: 1_000_000, condicion_pago_tipo: "normal", condicion_pago_pct_aplicable: null,
    condicion_pago_dias_saldo: null, condicion_pago_fecha_limite: null, monto_exigido: monto, restriccion_comercial: "normal", moneda: "COP", trm: 1,
  });
  test("contrato con condiciones: el texto sigue siendo el de siempre y trae la regla condicion_congelada", () => {
    const r = resolverCondicionesContrato([fila(500_000)] as never, [], { monedaContrato: "COP", precioVenta: 1_000_000 });
    assert.match(r.resumen!.texto, /Pago mínimo requerido: \$500\.000 COP \(50 % informativo\)/);
    assert.equal(r.resumen!.minimoConfirmar.regla, "condicion_congelada");
    assert.equal(r.resumen!.minimoConfirmar.minimo, 500_000);
  });
  test("NETO aliado: el documento exige el TOTAL NETO, no la suma de condiciones, y lo dice", () => {
    const r = resolverCondicionesContrato([fila(300_000)] as never, [], { monedaContrato: "COP", precioVenta: 900_000, netoTotalExigible: 900_000 });
    assert.match(r.resumen!.texto, new RegExp(`${ROTULO_MINIMO_CONFIRMAR}: \\$900\\.000 COP \\(total NETO exigible\\)`));
    assert.equal(r.resumen!.minimoConfirmar.regla, "neto_total");
    assert.equal(r.resumen!.montoMinimoExigidoTotal, 300_000, "la suma de condiciones se conserva como dato (es el mínimo para CONVERTIR), no se confunde");
  });
  test("los rótulos de confirmar y de convertir son distintos", () => {
    assert.notEqual(ROTULO_MINIMO_CONFIRMAR, ROTULO_MINIMO_CONVERTIR);
    assert.match(textoMinimoConfirmar({ regla: "legacy_pct", minimo: 300_000, moneda: "COP", trm: null }), /regla histórica/);
  });
});

describe("cableado: ya no hay una regla paralela del 30 % para contratos con condiciones o NETO", () => {
  test("recalcularEstadoAbono decide por la base (reintentar_confirmacion_pago), sin pct_abono propio", () => {
    const c = leer("app/(dashboard)/dashboard/contratos/actions.ts");
    const f = c.slice(c.indexOf("async function recalcularEstadoAbono"), c.indexOf("// `confirmacion` solo viene con ok=false"));
    assert.match(f, /rpc\("reintentar_confirmacion_pago"/);
    assert.doesNotMatch(f.replace(/\/\/.*/g, ""), /config_cobros|pct_abono|pctMin|alcanzaMinimo/);
  });
  test("el plan de cobro toma su primer pago de la regla única", () => {
    const c = leer("app/(dashboard)/dashboard/contratos/[numero]/cobros-actions.ts");
    assert.match(c, /reglaConfirmacion\(/);
    assert.match(c, /contrato_condiciones/);
  });
  test("las tres páginas con documento/condiciones pasan el total NETO", () => {
    for (const p of ["app/(dashboard)/dashboard/contratos/[numero]/page.tsx", "app/c/[token]/page.tsx", "app/contrato/[numero]/page.tsx"])
      assert.match(leer(p), /netoTotalExigible:/, p);
  });
  test("la base: una sola función de regla, usada por el abono, el reintento y la conversión; nada de 0.3 fuera del caso legacy", () => {
    const sql = leer("supabase/migrations/20260601000288_obligaciones_al_confirmar.sql");
    assert.match(sql, /function p75_priv\.regla_confirmacion/);
    assert.match(sql, /p75_priv\.estado_minimo\(p_numero\)/);
    assert.doesNotMatch(sql, /minimo_confirmacion/);
    const sinComentarios = sql.replace(/--.*/g, "");
    assert.equal((sinComentarios.match(/0\.3/g) ?? []).length, 1, "el 0.3 solo aparece en la rama legacy_pct");
  });
});
