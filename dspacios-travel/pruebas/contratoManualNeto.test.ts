// #30 (entrega B) — contrato MANUAL B2B en NETO: el plan (mismo cálculo que la
// reserva de #38), la comprobación de lo que vio el asesor, la regla del asesor
// `venta`, la llamada al RPC atómico sin tragarse errores y el orden de los
// pasos dentro de `crearContrato` (validar antes de numerar; NETO como último
// paso obligatorio, antes de lo best-effort; reversión si falla).
//
// La parte de la base (permisos, tenant, carreras, atomicidad) se prueba contra
// Postgres real: supabase/scripts/test_206_contrato_manual_neto.sql y
// test_206_carrera.sh (migración 206).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  planNetoContratoManual,
  comisionCoincide,
  esAsesorPropio,
  aplicarNetoContratoManual,
} from "@/lib/contrato/netoManual";
import { planComisionReserva } from "@/lib/reservar/comisionReserva";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

type Respuesta = { data: unknown; error: unknown };
function sbFalso(tablas: Record<string, Respuesta>, rpc?: (fn: string, args: unknown) => Promise<Respuesta>) {
  const llamadas: { fn: string; args: unknown }[] = [];
  const sb = {
    from(tabla: string) {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => tablas[tabla] ?? { data: null, error: null } };
      return q;
    },
    async rpc(fn: string, args: unknown) {
      llamadas.push({ fn, args });
      if (!rpc) throw new Error("sin rpc");
      return rpc(fn, args);
    },
  };
  return { sb: sb as unknown as Parameters<typeof planNetoContratoManual>[0], llamadas };
}
const AGENCIA = { id: 7, tipo: "agencia", pct_comision: 0.1 };

// ── Plan NETO: el mismo de la reserva (#38) ────────────────────────────────

test("plan NETO manual = plan de la reserva: base PVP − BNC, % del aliado, total PVP − comisión", async () => {
  const { sb } = sbFalso({ aliados: { data: AGENCIA, error: null } });
  const r = await planNetoContratoManual(sb, { tipoVenta: "agencia", aliadoId: 7, precioVenta: 2_000_000, impuesto: 400_000 });
  assert.ok(r.ok);
  assert.deepEqual(r.plan, { pct: 0.1, base: 1_600_000, comision: 160_000, pvp: 2_000_000, totalExigible: 1_840_000 });
  const reserva = planComisionReserva({ modoCompra: "neta", precioVenta: 2_000_000, impuesto: 400_000, pct: 0.1 });
  assert.ok(reserva.ok);
  assert.equal(r.plan.totalExigible, reserva.plan.precioFinal);
  assert.equal(r.plan.comision, reserva.plan.comision);
});

test("plan NETO: sin % propio usa el parámetro de su tipo; si no se puede leer, no adivina", async () => {
  const conParam = sbFalso({
    aliados: { data: { id: 8, tipo: "freelance", pct_comision: null }, error: null },
    parametros_tributarios: { data: { valor: 0.08 }, error: null },
  });
  const r = await planNetoContratoManual(conParam.sb, { tipoVenta: "freelance", aliadoId: 8, precioVenta: 1_000_000, impuesto: 0 });
  assert.ok(r.ok);
  assert.equal(r.plan.comision, 80_000);
  const sinParam = sbFalso({
    aliados: { data: { id: 8, tipo: "freelance", pct_comision: null }, error: null },
    parametros_tributarios: { data: null, error: { message: "timeout" } },
  });
  const r2 = await planNetoContratoManual(sinParam.sb, { tipoVenta: "freelance", aliadoId: 8, precioVenta: 1_000_000, impuesto: 0 });
  assert.equal(r2.ok, false);
});

test("plan NETO: venta directa, aliado de otro tipo, sin aliado o sin precio → rechazo", async () => {
  const { sb } = sbFalso({ aliados: { data: AGENCIA, error: null } });
  const casos = [
    { tipoVenta: "interno", aliadoId: 7, precioVenta: 2_000_000, impuesto: 0, error: /venta directa no tiene modalidad NETO/ },
    { tipoVenta: "freelance", aliadoId: 7, precioVenta: 2_000_000, impuesto: 0, error: /es de tipo "agencia"/ },
    { tipoVenta: "agencia", aliadoId: null, precioVenta: 2_000_000, impuesto: 0, error: /falta la agencia del catálogo/ },
    { tipoVenta: "agencia", aliadoId: 7, precioVenta: 0, impuesto: 0, error: /precio de venta mayor a cero/ },
  ];
  for (const c of casos) {
    const r = await planNetoContratoManual(sb, c);
    assert.equal(r.ok, false, JSON.stringify(c));
    assert.match((r as { error: string }).error, c.error);
  }
});

test("plan NETO en USD redondea la comisión al dólar, igual que la reserva", async () => {
  const { sb } = sbFalso({ aliados: { data: { ...AGENCIA, pct_comision: 0.12 }, error: null } });
  const r = await planNetoContratoManual(sb, { tipoVenta: "agencia", aliadoId: 7, precioVenta: 2_345, impuesto: 300 });
  assert.ok(r.ok);
  assert.deepEqual([r.plan.comision, r.plan.totalExigible], [245, 2_100]);
});

test("lo que vio el asesor: ±1 por redondeo; nulo o distinto → no coincide", () => {
  assert.equal(comisionCoincide(160_000, 160_000), true);
  assert.equal(comisionCoincide(160_001, 160_000), true);
  assert.equal(comisionCoincide(159_998, 160_000), false);
  assert.equal(comisionCoincide(null, 160_000), false);
  assert.equal(comisionCoincide(undefined, 0), false);
});

test("asesor `venta`: solo su propio contrato (nombre o correo, sin mayúsculas ni espacios)", () => {
  const yo = { nombre: "Ana Pérez", email: "ana@dspacios.co" };
  assert.equal(esAsesorPropio("  ana pérez ", yo), true);
  assert.equal(esAsesorPropio("ANA@DSPACIOS.CO", yo), true);
  assert.equal(esAsesorPropio("Luis Gómez", yo), false);
  assert.equal(esAsesorPropio("", yo), false);
  assert.equal(esAsesorPropio("Ana Pérez", null), false);
});

// ── RPC atómico: nunca se traga un error ───────────────────────────────────

test("aplicar NETO: llama al RPC con número, aliado y la comisión que vio el asesor", async () => {
  const { sb, llamadas } = sbFalso({}, async () => ({ data: 91, error: null }));
  assert.deepEqual(await aplicarNetoContratoManual(sb, "DTM-0900", 7, 160_000), { ok: true, id: 91 });
  assert.deepEqual(llamadas, [{ fn: "aplicar_neto_contrato_manual", args: { p_numero: "DTM-0900", p_aliado_id: 7, p_comision_esperada: 160_000 } }]);
});

test("aplicar NETO: error de la base, excepción de red o respuesta vacía → fallo explícito", async () => {
  const conError = sbFalso({}, async () => ({ data: null, error: { message: "La comisión del contrato DTM-0900 (150000) no coincide" } }));
  assert.deepEqual(await aplicarNetoContratoManual(conError.sb, "DTM-0900", 7, 150_000), { ok: false, error: "La comisión del contrato DTM-0900 (150000) no coincide" });
  const red = sbFalso({}, async () => { throw new Error("fetch failed"); });
  assert.deepEqual(await aplicarNetoContratoManual(red.sb, "DTM-0900", 7, 160_000), { ok: false, error: "fetch failed" });
  const vacio = sbFalso({}, async () => ({ data: null, error: null }));
  assert.equal((await aplicarNetoContratoManual(vacio.sb, "DTM-0900", 7, 160_000)).ok, false);
});

// ── crearContrato: orden de los pasos ──────────────────────────────────────

const ACCIONES = "app/(dashboard)/dashboard/contratos/actions.ts";
function cuerpoCrearContrato() {
  const src = leer(ACCIONES);
  const ini = src.indexOf("async function crearContratoInterno");
  return src.slice(ini, src.indexOf("export type VentaEditInput"));
}

test("crearContrato: todo lo del NETO se valida ANTES de numerar (no gasta un consecutivo)", () => {
  const c = cuerpoCrearContrato();
  const iNumero = c.indexOf("siguienteNumeroContrato(tenant)");
  for (const paso of ["planNetoContratoManual(sb,", "comisionCoincide(input.comisionNetoEsperada", "esAsesorPropio(input.asesorNombre", "Una venta directa no tiene modalidad NETO"]) {
    const i = c.indexOf(paso);
    assert.ok(i > 0 && i < iNumero, `${paso} va antes de numerar`);
  }
  assert.match(c, /if \(ctx\.rol === "venta"\) \{/);
});

test("crearContrato: NETO es el último paso obligatorio (después de las hijas, antes de lo best-effort) y revierte si falla", () => {
  const c = cuerpoCrearContrato();
  const iHijas = c.indexOf('"insert_hijas", Math.round(performance.now() - _tHijas0), "ok")');
  const iNeto = c.indexOf("aplicarNetoContratoManual(sb, numero, input.aliadoId as number, comisionNeto)");
  const iCxp = c.indexOf("const _tCxp0");
  assert.ok(iHijas > 0 && iNeto > iHijas && iCxp > iNeto, "hijas → NETO → CxP");
  const bloque = c.slice(iNeto, iCxp);
  assert.match(bloque, /if \(!neto\.ok\) \{/);
  assert.match(bloque, /const rev = await revertirContratoManual\(numero, tenant\);/);
  assert.match(bloque, /así que no se creó/);
  assert.match(bloque, /tampoco se pudo deshacer el contrato \$\{numero\}/);
  assert.match(bloque, /Quedó como PVP con la comisión por definir/);
});

test("crearContrato: en PVP no se llama al RPC ni se crea comisión (sigue 'Por definir', #38)", () => {
  const c = cuerpoCrearContrato();
  assert.match(c, /const modoCompraManual = input\.modoCompra \?\? "pvp";/);
  assert.match(c, /if \(modoCompraManual === "neto"\) \{/);
  assert.match(c, /if \(planNeto\) \{/);
  // El insert de la venta no escribe modalidad: nace PVP "Por definir".
  const insert = c.slice(c.indexOf('sb.from("ventas").insert({'), c.indexOf('registrarEtapa("crear_contrato", flujoId, "insert_venta"'));
  assert.doesNotMatch(insert, /modo_compra|comision_b2b|comision_estado/);
});

test("vista previa: solo lectura, misma puerta que crearContrato, mismo plan que el servidor", () => {
  const src = leer(ACCIONES);
  const ini = src.indexOf("export async function previsualizarNetoContrato");
  const cuerpo = src.slice(ini);
  // El plan revela % y comisión del aliado: sesión + activo + rol con
  // escritura sobre ventas (contextoCrearContrato), no solo "hay sesión".
  // Ejecución real por rol: pruebas/contratoManualNeto206.pg.ts (P3).
  assert.match(cuerpo, /const ctx = await contextoCrearContrato\("previsualizar_neto", generarFlujoId\(\)\);/);
  assert.match(cuerpo, /if \(!ctx\.ok\) return \{ ok: false, error: ctx\.error \};/);
  assert.match(cuerpo, /return planNetoContratoManual\(ctx\.sb,/);
  assert.doesNotMatch(cuerpo.slice(0, cuerpo.indexOf("return planNetoContratoManual")), /auth\.getUser\(\)/, "no basta con tener sesión");
  assert.doesNotMatch(cuerpo, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});

test("formulario: elige PVP/NETO solo en B2B y envía la comisión que mostró", () => {
  const f = leer("app/(dashboard)/dashboard/contratos/NuevoContratoForm.tsx");
  assert.match(f, /const pideNeto = tipoVenta !== "interno" && modoCompra === "neto";/);
  assert.match(f, /modoCompra: tipoVenta === "interno" \? undefined : modoCompra,/);
  assert.match(f, /comisionNetoEsperada: pideNeto \? planNeto\?\.comision \?\? null : null,/);
  assert.match(f, /if \(pideNeto && !planNeto\) \{ setError\(/);
  assert.match(f, /setAliadoId\(""\); setModoCompra\("pvp"\);/, "cambiar el tipo de venta vuelve a PVP");
  assert.doesNotMatch(f, /La comisión B2B se crea sola/, "texto de #38 desactualizado");
});
