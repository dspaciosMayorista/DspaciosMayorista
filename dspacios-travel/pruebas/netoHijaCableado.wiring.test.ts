// #50 (T1) — PRUEBAS DE CABLEADO: ninguna ruta de la app se salta la puerta controlada de #39 ni la
// validación previa de #50. Sin base de datos: leen el código fuente (patrón de documentosContrato.wiring.test.ts).
//
// Si alguna de estas pruebas se pone roja, alguien volvió a abrir una ruta que gasta un consecutivo o mueve dinero
// sin pasar por el wrapper (G1: la 198 directo solo deja el hueco documentado, nunca un contrato mal interpretado).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(join(raiz, dir))) {
    if (e === "node_modules" || e === ".next") continue;
    const rel = join(dir, e);
    const st = statSync(join(raiz, rel));
    if (st.isDirectory()) archivos(rel, salida);
    else if (/\.(ts|tsx)$/.test(e)) salida.push(rel.replace(/\\/g, "/"));
  }
  return salida;
}
const FUENTES = ["app", "lib", "components"].flatMap((d) => archivos(d));
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const llamaRpc = (src: string, nombre: string) => new RegExp(`\\.rpc\\(\\s*["'\`]${nombre}["'\`]`).test(sinComentarios(src));

test("ninguna ruta llama la 198 ni registrar_pago_previo directo (la puerta es el wrapper)", () => {
  const PROHIBIDAS = ["convertir_cotizacion_a_contrato", "registrar_pago_previo", "anular_pago_previo", "transferir_pagos_previos_a_abonos"];
  const infractores: string[] = [];
  for (const f of FUENTES) {
    const src = leer(f);
    for (const nombre of PROHIBIDAS) if (llamaRpc(src, nombre)) infractores.push(`${f} → ${nombre}`);
  }
  assert.deepEqual(infractores, [], infractores.join("\n"));
  // Las únicas puertas vigentes llaman a los wrappers.
  assert.ok(llamaRpc(leer("app/(dashboard)/dashboard/cotizaciones/pagos-actions.ts"), "registrar_pago_previo_rev"));
  assert.ok(llamaRpc(leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts"), "convertir_cotizacion_manual_controlada"));
});

test("solo checkout/actions.ts llama al recibo n50 y solo manual-actions.ts a la RPC de resolver n50", () => {
  const recibo = FUENTES.filter((f) => llamaRpc(leer(f), "registrar_validacion_comparativa_n50"));
  const resolver = FUENTES.filter((f) => llamaRpc(leer(f), "resolver_solicitud_comparativa_n50"));
  assert.deepEqual(recibo, ["app/tarifario/checkout/actions.ts"]);
  assert.deepEqual(resolver, ["app/(dashboard)/dashboard/cotizaciones/manual-actions.ts"]);
});

test("las dos acciones validan la modalidad con leerEntradaModalidad antes de llamar a la base", () => {
  const checkout = leer("app/tarifario/checkout/actions.ts");
  const manual = leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
  for (const [nombre, src] of [["checkout", checkout], ["manual", manual]] as const) {
    assert.match(src, /leerEntradaModalidad\(/, nombre);
    assert.match(src, /from "@\/lib\/cotizacion\/netoHija"/, nombre);
  }
  // En checkout, la lectura precede al primer acceso a la base de la función.
  const f = checkout.slice(checkout.indexOf("export async function elegirOpcionComparativa"), checkout.indexOf("export async function solicitarOpcionComparativa"));
  assert.ok(f.indexOf("leerEntradaModalidad(") > 0 && f.indexOf("leerEntradaModalidad(") < f.indexOf("createAdminClient()"), "se valida antes de crear clientes");
  assert.ok(f.indexOf("leerEntradaModalidad(") < f.indexOf("registrar_validacion_comparativa"), "y antes del recibo");
});

test("D-1: solicitarOpcionComparativa y actorComparativa no se tocaron (toda hija es asistida, sin origen b2b_sesion)", () => {
  const checkout = leer("app/tarifario/checkout/actions.ts");
  const sol = checkout.slice(checkout.indexOf("export async function solicitarOpcionComparativa"), checkout.indexOf("export type ResumenOpcionComparativa"));
  assert.doesNotMatch(sol, /modalidad|leerEntradaModalidad|solicitante_id|b2b_sesion|actorComparativa/i);
  assert.doesNotMatch(leer("supabase/migrations/20260601000222_neto_hija_manual.sql"), /solicitante_id|b2b_sesion|registrar_solicitud_comparativa\s*\(/);
});

test("el selector de modalidad es de cliente y carga la acción de servidor de forma perezosa (sin service-role en el navegador)", () => {
  const ui = leer("lib/cotizacion/comparativaAcciones.tsx");
  assert.match(ui, /^"use client";/);
  assert.doesNotMatch(sinComentarios(ui), /createAdminClient|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(ui, /import\("@\/app\/\(dashboard\)\/dashboard\/cotizaciones\/pagos-actions"\)/);
  assert.doesNotMatch(ui, /import \{[^}]*contextoModalidadNeto[^}]*\} from/, "no hay import estático de la acción");
});

test("pagos-actions: contextoModalidadNeto no usa server-only (se carga también desde pruebas) y respeta tenant y rol", () => {
  const src = leer("app/(dashboard)/dashboard/cotizaciones/pagos-actions.ts");
  assert.doesNotMatch(src, /lib\/cotizacion\/acceso/);
  assert.match(src, /perfil\?\.tenant !== madre\.tenant/);
  assert.match(src, /puedeFijarNeto\(rol\)/);
  assert.match(src, /if \(!puedeNeto\) return base;/, "venta no recibe cuentas");
});

test("la migración 222 respeta las reglas de la reserva: no edita la 198 ni migraciones anteriores y conserva los wrappers INVOKER", () => {
  const sql = leer("supabase/migrations/20260601000222_neto_hija_manual.sql");
  assert.doesNotMatch(sql, /create or replace function public\.(convertir_cotizacion_a_contrato|registrar_pago_previo|anular_pago_previo|transferir_pagos_previos_a_abonos)\s*\(/i);
  assert.match(sql, /edc9975010746e53e4af6a75ad9763dc/);
  for (const nombre of ["registrar_pago_previo_rev", "convertir_cotizacion_manual_controlada"]) {
    const i = sql.indexOf(`create or replace function public.${nombre}(`);
    assert.ok(i > 0, nombre);
    assert.match(sql.slice(i, i + 1800), /security invoker/, `${nombre} sigue INVOKER`);
  }
  assert.doesNotMatch(sql, /drop trigger|alter table public\.(cotizaciones|cotizacion_servicios|cotizacion_pagos_previos|cotizacion_condiciones)\b/i, "no toca los disparadores ni las tablas de la frontera");
  assert.doesNotMatch(sql, /current_setting/);
  const cierre = leer("supabase/migrations/20260601000223_neto_hija_manual_cierre.sql");
  assert.match(cierre, /update p50_priv\.config set exigir_modalidad = true/);
  assert.doesNotMatch(cierre, /create (or replace )?function/i, "la 223 es solo el interruptor");
});

test("Q-5: PVP sin aliado del catálogo se permite sin sello; solo NETO exige aliado, y la 223 no deja sin salida a esas madres", () => {
  const sql = leer("supabase/migrations/20260601000222_neto_hija_manual.sql");
  const sellar = sql.slice(sql.indexOf("create or replace function p50_priv.sellar_hija("), sql.indexOf("-- 4.7 "));
  // sin aliado: PVP retorna antes de sellar; NETO falla con mensaje de NETO.
  assert.match(sellar, /if h\.aliado_id is null then\s+if p_modalidad = 'pvp' then\s+return;/);
  assert.match(sellar, /el precio NETO necesita la agencia o freelance/);
  // la modalidad solo se exige cuando hay aliado (si no, la 223 las dejaría sin salida).
  const req = sql.slice(sql.indexOf("create or replace function p50_priv.requiere_modalidad("), sql.indexOf("-- 4.9 "));
  assert.match(req, /h\.aliado_id is not null/);
  // el reintento de un PVP sin sello cuenta como la misma modalidad.
  const coincide = sql.slice(sql.indexOf("create or replace function p50_priv.modalidad_coincide("), sql.indexOf("-- 4.8 "));
  assert.match(coincide, /p_modalidad = 'pvp'[\s\S]*h\.aliado_id is null/);
  // la cabecera ya no afirma comportamiento idéntico y nombra COMPARATIVA_CLAVE en el desfase de despliegue (Q-9b).
  const cab = sql.slice(0, sql.indexOf("-- ── Diseño B"));
  assert.doesNotMatch(cab, /idéntic/i);
  assert.match(cab, /COMPARATIVA_CLAVE/);
  // preflight de la 223: cuenta, solo como INFO, las madres B2B abiertas sin aliado.
  const pre = leer("supabase/scripts/preflight_223_neto_hija_manual_cierre.sql");
  assert.match(pre, /select 'Q3',\s+'INFO'/);
  assert.match(pre, /q\.aliado_id is null/);
});

test("Q-8: ningún consumidor de dinero ni documento lee detalle.recobro.aliado de la hija (la 198 lee payload.recobroAliado)", () => {
  const lectores = FUENTES.filter((f) => /detalleM?\??\.recobro\??\.aliado/.test(sinComentarios(leer(f))));
  // Único lector: la ficha de la cotización, solo para MOSTRAR la participación declarada (page.tsx).
  assert.deepEqual(lectores, ["app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx"]);
  const m198 = readdirSync(join(raiz, "supabase/migrations")).filter((n) => /000198_/.test(n));
  assert.ok(m198.length > 0);
  for (const n of m198) assert.doesNotMatch(leer(`supabase/migrations/${n}`), /detalle\s*->\s*'recobro'/, n);
});

test("la 223 y la 222 son números reservados: nada más usa esos números", () => {
  const nums = readdirSync(join(raiz, "supabase/migrations")).filter((n) => /^20260601000(222|223)_/.test(n));
  assert.deepEqual(nums.sort(), ["20260601000222_neto_hija_manual.sql", "20260601000223_neto_hija_manual_cierre.sql"]);
});

test("package.json registra la prueba React de #50 en test:react", () => {
  const pkg = JSON.parse(leer("package.json")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts["test:react"], /pruebas\/netoHijaModalidad\.react\.ts/);
});

test("el workflow de #50 es de solo lectura, sin secretos ni pull_request_target y con acciones fijadas por SHA", () => {
  const wf = readFileSync(join(raiz, "..", ".github/workflows/test-222-223-neto-50.yml"), "utf8");
  const codigo = wf.replace(/^\s*#.*$/gm, ""); // los comentarios pueden nombrar lo que NO se usa
  assert.match(codigo, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(codigo, /pull_request_target|secrets\./);
  for (const m of codigo.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `acción sin SHA: ${m[1]}`);
  assert.doesNotMatch(codigo, /supabase\.co|SUPABASE_URL|SERVICE_ROLE/i, "sin Supabase remoto");
});
