import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registrarFinancieroContrato, type CxPFinanciera, type DepsFinanciero } from "../lib/reservar/financieroContrato.ts";

// #75 · parte 1 — obligaciones al CONFIRMAR (migración 288). El comportamiento transaccional (una sola materialización, carreras, fallos del abono) se prueba contra
// Postgres real en supabase/scripts/test_288_obligaciones_al_confirmar.sh. Aquí: lo que decide la aplicación.
function leer(rel: string): string { return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n"); }

const fila = (servicio: string): CxPFinanciera => ({
  tipo_proveedor: "hotel", servicio, proveedor: "P", valor_total: 100000, fecha_obligacion: "2026-12-01", aplica_retencion: false, pct_retencion: 0, observaciones: "x", servicio_id: null,
});

function deps(respuesta: Record<string, unknown>) {
  const asientos: number[] = [];
  const llamadas: string[] = [];
  const d: DepsFinanciero = {
    rpc: async (fn: string) => { llamadas.push(fn); return { data: fn === "registrar_financiero_contrato" ? respuesta : { ok: true }, error: null }; },
    guardarPendiente: async () => ({ ok: true }),
    postearAsiento: async (c: { id: number }) => { asientos.push(c.id); return { ok: true }; },
    eliminarAsiento: async () => undefined,
  } as unknown as DepsFinanciero;
  return { d, asientos, llamadas };
}

describe("registrarFinancieroContrato con un contrato PENDIENTE (CxP trasladadas a «previstas»)", () => {
  test("las previstas cuentan para la coherencia, NO generan asiento y no se revierte el contrato", async () => {
    const { d, asientos, llamadas } = deps({ creadas: [], eliminadas: [], previstas: [{ clave: "cxp:1:hotel" }, { clave: "cxp:2:aereo" }] });
    const r = await registrarFinancieroContrato(d, { numeroContrato: "DTM-1", tenant: "mayorista", costos: {}, cxp: [fila("a"), fila("b")], fecha: "2026-12-01" });
    assert.equal(r.ok, true);
    assert.deepEqual(asientos, [], "una obligación prevista no es exigible: sin asiento contable");
    assert.ok(!llamadas.includes("revertir_contrato_incompleto"));
  });

  test("si no coincide el total (creadas + previstas ≠ enviadas) se reporta fallo y se revierte, como siempre", async () => {
    const { d, llamadas } = deps({ creadas: [], eliminadas: [], previstas: [{ clave: "cxp:1:hotel" }] });
    const r = await registrarFinancieroContrato(d, { numeroContrato: "DTM-1", tenant: "mayorista", costos: {}, cxp: [fila("a"), fila("b")], fecha: "2026-12-01" });
    assert.equal(r.ok, false);
    assert.ok(llamadas.includes("revertir_contrato_incompleto"));
  });

  test("mezcla: las CxP #63 (que no se trasladan) siguen contando y generando su asiento", async () => {
    const { d, asientos } = deps({ creadas: [{ id: 7, tipo_proveedor: "hotel", servicio: "H", valor_total: 1 }], eliminadas: [], previstas: [{ clave: "cxp:2:aereo" }] });
    const r = await registrarFinancieroContrato(d, { numeroContrato: "DTM-1", tenant: "mayorista", costos: {}, cxp: [fila("a"), fila("b")], fecha: "2026-12-01" });
    assert.equal(r.ok, true);
    assert.deepEqual(asientos, [7]);
  });

  test("base anterior a la 288 (sin «previstas»): comportamiento de siempre", async () => {
    const { d, asientos } = deps({ creadas: [{ id: 5, tipo_proveedor: "hotel", servicio: "H", valor_total: 1 }], eliminadas: [] });
    const r = await registrarFinancieroContrato(d, { numeroContrato: "DTM-1", tenant: "mayorista", costos: {}, cxp: [fila("a")], fecha: "2026-12-01" });
    assert.equal(r.ok, true);
    assert.deepEqual(asientos, [5]);
  });
});

describe("cableado de la aplicación (288)", () => {
  test("asientosObligaciones: lee los ids materializados de confirmar_venta y de registrar_abono", async () => {
    const m = await import("../lib/reservar/asientosObligaciones.ts").catch(() => null);
    // El módulo es server-only: si no se puede importar fuera de Next, se valida su texto.
    const src = leer("lib/reservar/asientosObligaciones.ts");
    assert.match(src, /export function idsCxpMaterializadas/);
    assert.match(src, /obligaciones\?\.cxp/);
    assert.match(src, /confirmacion/);
    void m;
  });

  test("confirmación interna y por pago postean el asiento de lo materializado", () => {
    assert.match(leer("app/(dashboard)/dashboard/reservar/actions.ts"), /postearAsientosDeObligaciones\(numeroContrato, idsCxpMaterializadas\(confData\), id\)/);
    const c = leer("app/(dashboard)/dashboard/contratos/actions.ts");
    assert.match(c, /postearAsientosDeObligaciones\(numeroContrato, idsCxpMaterializadas\(rc\), id\)/);
    assert.match(c, /postearAsientosDeObligaciones\(numeroContrato, idsCxpMaterializadas\(r\.data\.confirmacion\), id\)/);
    assert.match(c, /r\.data\.confirmacion_error/, "un fallo de la confirmación por pago se informa; el abono queda registrado");
  });

  test("D1: ni «Completar proveedores» ni la CxP manual crean obligaciones reales en un pendiente", () => {
    assert.match(leer("lib/reservar/asegurarCuentasPorPagar.ts"), /estado === "pendiente"\) return \{ ok: true, creadas: 0 \}/);
    assert.match(leer("app/(dashboard)/dashboard/contratos/[numero]/gestion-actions.ts"), /estado === "pendiente"\) \{\s*return \{ ok: false, error: "Este contrato está pendiente/);
  });

  test("programa y edición de servicios escriben PREVISTAS por la RPC (no CxP directas) mientras el contrato esté pendiente", () => {
    const r = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    assert.match(r, /rpc\("prevista_cxp_aplicar"/);
    assert.match(r, /quedoPrevista\s*\?\s*\{ data: null, error: null \}/);
    const c = leer("app/(dashboard)/dashboard/contratos/actions.ts");
    assert.match(c, /rpc\("pendiente_aplicar_servicios"/, "ítems, precio, resumen y obligaciones: UNA transacción");
    assert.doesNotMatch(c, /from\("contrato_items"\)\.insert\(\s*nuevos\.map/, "ya no escribe los ítems por separado");
    assert.doesNotMatch(c, /plan\.insertar\.length\) \{\s*const \{ data: creadas, error \} = await admin\.from\("cuentas_por_pagar"\)\.insert/, "ya no inserta CxP reales al editar servicios de un pendiente");
  });

  test("la 288 envuelve (no reescribe) y NO toca registrar_comision_b2b_reserva: la comisión es de #97", () => {
    const sql = leer("supabase/migrations/20260601000288_obligaciones_al_confirmar.sql");
    assert.match(sql, /p75_priv\.registrar_financiero_base/);
    assert.match(sql, /p75_priv\.registrar_abono_base/);
    assert.doesNotMatch(sql, /create or replace function public\.registrar_comision_b2b_reserva/i);
    assert.match(sql, /to_regprocedure\('public\.materializar_comision_b2b\(text\)'\)/);
    assert.match(sql, /md5\(replace\(p\.prosrc, chr\(13\), ''\)\)/, "comprueba las definiciones remotas antes de reemplazarlas");
  });
});

describe("Parte 1b — cableado de los escritores restantes (288)", () => {
  test("la conversión de cotización traslada sus CxP y evalúa el mínimo al FINAL (no antes del plan de comisión de #97)", () => {
    const sql = leer("supabase/migrations/20260601000288_obligaciones_al_confirmar.sql");
    assert.match(sql, /p75_priv\.convertir_cotizacion_base/);
    assert.match(sql, /perform p75_priv\.trasladar_cxp_a_previstas\(v_n\)/);
    const ini = sql.indexOf("create or replace function public.convertir_cotizacion_a_contrato");
    const envoltorio = sql.slice(ini, sql.indexOf("end $function$;", ini)).replace(/--.*/g, "");
    assert.doesNotMatch(envoltorio, /confirmar_venta/, "confirmar dentro de la conversión dejaría la comisión de #97 sin materializar");
    assert.match(sql, /function public\.confirmar_tras_conversion/);
    const m = leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
    assert.match(m, /rpc\("confirmar_tras_conversion"/);
    assert.match(m, /postearAsientosDeObligaciones\(numero, idsCxpMaterializadas\(conf\)/);
  });

  test("oferta #63: el traslado respeta su trigger de borrado y la materialización usa su modo de escritura", () => {
    const sql = leer("supabase/migrations/20260601000288_obligaciones_al_confirmar.sql");
    assert.match(sql, /app\.p75_traslado/);
    assert.match(sql, /set_config\('app\.p63_h', 'on', true\)/);
    assert.match(sql, /\('public\.trg_cxp_borrada_63\(\)'/, "comprueba por md5 la definición del trigger que reemplaza");
  });

  test("el contrato manual de Mayorista nace PENDIENTE (Minorista conserva «activo»)", () => {
    assert.match(leer("app/(dashboard)/dashboard/contratos/actions.ts"), /estado: tenant === "minorista" \? "activo" : "pendiente"/);
  });

  test("abono con confirmación fallida: el servidor lo marca y la pantalla lo informa sin permitir otro registro", () => {
    assert.match(leer("app/(dashboard)/dashboard/contratos/actions.ts"), /confirmacionPendiente: true, error: `Abono registrado; confirmación pendiente/);
    const hook = leer("components/contrato/useRegistroAbono.ts");
    assert.match(hook, /sinConfirmar/);
    assert.match(hook, /reintentarConfirmacion/);
    assert.match(leer("components/contrato/ConfirmacionPendienteAbono.tsx"), /Abono registrado; confirmación pendiente/);
    assert.match(leer("app/(dashboard)/dashboard/contratos/[numero]/AbonoForm.tsx"), /disabled=\{pending \|\| !!reg\.confirmacionPendiente\}/);
    assert.match(leer("app/(dashboard)/dashboard/cartera/CarteraList.tsx"), /disabled=\{pending \|\| !!reg\.confirmacionPendiente\}/);
  });

  test("previstas y documentos: la ficha las rotula aparte y el documento aclara que no hay obligaciones exigibles", () => {
    const p = leer("app/(dashboard)/dashboard/contratos/[numero]/page.tsx");
    assert.match(p, /<ObligacionesPrevistasPanel/);
    assert.match(p, /estado_confirmacion_pago/);
    assert.match(p, /venta\.estado === "pendiente" && verFinanzas/, "las previstas llevan costos: solo finanzas");
    assert.match(leer("components/contrato/ContratoDocumento.tsx"), /mientras esté pendiente no hay obligaciones exigibles/);
  });

  test("edición de servicios: UNA llamada atómica (sin escrituras sueltas de ítems/precio/resumen)", () => {
    const c = leer("app/(dashboard)/dashboard/contratos/actions.ts");
    const f = c.slice(c.indexOf("export async function actualizarServiciosContrato"), c.indexOf("// #30 (entrega B): vista previa del NETO"));
    assert.match(f, /rpc\("pendiente_aplicar_servicios"/);
    assert.doesNotMatch(f, /from\("contrato_items"\)\.delete/);
    assert.doesNotMatch(f, /from\("ventas"\)\.update\(\{ precio_venta/);
    assert.doesNotMatch(f, /from\("ventas"\)\.update\(\{\s*costo_receptivo/);
  });
});
