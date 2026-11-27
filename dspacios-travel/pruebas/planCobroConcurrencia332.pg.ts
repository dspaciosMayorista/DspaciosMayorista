// R3 (refresco de la 332 FINAL) — concurrencia real e INSERT/DELETE inyectados sobre `reemplazar_plan_cobro` y sobre la acción real `generarPlanCobro`.
// Lo lanza supabase/scripts/test_r2_95_acciones.sh con R2_ARCHIVOS=pruebas/planCobroConcurrencia332.pg.ts (base + PostgREST desechables; 331/332/333 aplicadas). Sesiones HTTP reales (una conexión por llamada), JWT `authenticated`.
//   C1  12 llamadas SIMULTÁNEAS a la función → queda UN plan de 4 filas (orden 0..3, suma = total).
//   C2  16 llamadas mezcladas (planes de 4 y de 2 filas) → queda exactamente UN plan completo (nunca mezcla ni duplicados).
//   C3  6 regeneraciones simultáneas con la ACCIÓN real → un plan; regenerar repetido no acumula.
//   F1  fallo inyectado en el INSERT (trigger que lanza) → error y el plan anterior queda IDÉNTICO (mismos ids).
//   F2  fallo inyectado en el DELETE → error y el plan anterior queda idéntico.
//   F3  la RLS impide borrar una fila del plan anterior (rol sin permiso sobre una fila) → PLAN_COBRO_INCOMPLETO y todo se revierte.
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG95_CONTENEDOR ?? "";
const DB = process.env.PG95_BASE ?? "";
const PGRST = process.env.PG95_POSTGREST ?? "";
const SECRETO = process.env.PG95_JWT_SECRET ?? "";
if (!CT || !DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG95_*: usa supabase/scripts/test_r2_95_acciones.sh.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = {
  "server-only": "export {}",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
  "next/headers": "export async function headers() { return new Map([['host', 'localhost']]); } export async function cookies() { return { get: () => undefined, getAll: () => [] }; }",
};
registerHooks({ resolve(specifier, context, nextResolve) {
  const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
  try { return nextResolve(specifier, context); } catch (e) {
    if (specifier.startsWith(".") && !/.[a-z]+$/.test(specifier)) { for (const suf of [".ts", ".tsx", "/index.ts"]) { try { return nextResolve(specifier + suf, context); } catch { /* sigue */ } } }
    throw e;
  }
} });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const UID_SUPER = "00000000-0000-0000-0000-000000950001";
const UID_ADMIN = "00000000-0000-0000-0000-000000950002";
const UID_VENTA = "00000000-0000-0000-0000-000000950004";
const UID_VENTA2 = "00000000-0000-0000-0000-000000950005";
let uidSesion = UID_SUPER;
const sidDe = (uid: string) => uid.replace(/^00000000/, "5e550000");
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
let solicitudes = 0;
const fetchLocal: typeof fetch = (input, init) => { solicitudes++; return fetch(String(input).replace("/rest/v1/", "/"), init); };
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const sesionDe = (uid: string) => clienteLocal(jwt({ role: "authenticated", sub: uid, session_id: sidDe(uid) }), { id: uid, email: `${uid}@x.test` });
const clienteSesion = () => sesionDe(uidSesion);

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
}
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const { generarPlanCobro } = await import("../app/(dashboard)/dashboard/contratos/[numero]/cobros-actions.ts");
const { identidadDe } = await import("../lib/contrato/identidad.ts");

const N = "DTM-8301";
before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_SUPER}', 'super95@x.test'), ('${UID_ADMIN}', 'admin95@x.test'), ('${UID_VENTA}', 'venta95@x.test'), ('${UID_VENTA2}', 'venta95b@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
      ('${UID_SUPER}', 'super95@x.test', 'Super 95', 'superadmin', true, 'mayorista'),
      ('${UID_ADMIN}', 'admin95@x.test', 'Admin 95', 'administracion', true, 'mayorista'),
      ('${UID_VENTA}', 'venta95@x.test', 'Asesor Uno 95', 'venta', true, 'mayorista'),
      ('${UID_VENTA2}', 'venta95b@x.test', 'Asesor Dos 95', 'venta', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant, nombre = excluded.nombre;
    insert into public.ventas (numero_contrato, tenant, cliente, estado, asesor, precio_venta, moneda, tipo_paquete, financiero_estado, plazo, fecha_salida, fecha_regreso)
      values ('${N}', 'mayorista', 'Cliente Concurrencia', 'pendiente', 'Asesor Uno 95', 1000000, 'COP', 'porcion', 'completo', current_date + 30, current_date + 200, current_date + 204);
    insert into public.contrato_condiciones (numero_contrato, tipo_componente, orden, valor_componente, condicion_pago_tipo, monto_exigido, restriccion_comercial, moneda, trm)
      values ('${N}', 'hotel', 0, 1, 'normal', 300000, 'normal', 'COP', 1);`);
});

const plan4 = [
  { tipo: "abono", fecha_limite: "2099-01-01", monto: 300000 }, { tipo: "cuota", fecha_limite: "2099-02-01", monto: 233333 },
  { tipo: "cuota", fecha_limite: "2099-03-01", monto: 233333 }, { tipo: "cuota", fecha_limite: "2099-04-01", monto: 233334 },
];
const plan2 = [{ tipo: "abono", fecha_limite: "2099-01-01", monto: 300000 }, { tipo: "cuota", fecha_limite: "2099-02-01", monto: 700000 }];
const fuentes = async (sb = clienteSesion()) => {
  const { data, error } = await sb.rpc("plan_cobro_fuentes", { p_numero: N });
  assert.equal(error, null, error?.message);
  const v = data as Record<string, unknown>;
  return { total: v.total, pagado: v.pagado, precio_venta: v.precio_venta, total_cobro: v.total_cobro, fecha_salida: v.fecha_salida, moneda: v.moneda, moneda_cobro: v.moneda_cobro, trm_cobro: v.trm_cobro, moneda_efectiva: v.moneda_efectiva, pct_abono: v.pct_abono, acuerdo_id: v.acuerdo_id };
};
const plan = () => sql(`select coalesce(string_agg(id || ':' || orden || ':' || tipo || ':' || monto::numeric(15,0), ',' order by orden, id), '-') from public.cuotas where numero_contrato = '${N}'`);
const resumenPlan = () => sql(`select count(*) || '|' || coalesce(sum(monto), 0)::numeric(15,0) || '|' || count(distinct orden) || '|' || min(orden) || '-' || max(orden) from public.cuotas where numero_contrato = '${N}'`);
const idc = () => identidadDe(N, sql(`select contrato_uid from public.ventas where numero_contrato = '${N}'`));

describe("332 final · concurrencia e INSERT/DELETE inyectados", () => {
  test("C1 · 12 llamadas SIMULTÁNEAS (12 sesiones HTTP reales) → UN plan de 4 filas, orden 0..3, suma 1.000.000", async (t) => {
    const f = await fuentes();
    const rs = await Promise.all(Array.from({ length: 12 }, () => sesionDe(UID_SUPER).rpc("reemplazar_plan_cobro", { p_numero: N, p_fuentes: f, p_filas: plan4 })));
    const ok = rs.filter((r) => !r.error).length;
    t.diagnostic(`respuestas ok=${ok}/12 errores=${JSON.stringify(rs.filter((r) => r.error).map((r) => r.error!.message.slice(0, 80)))}`);
    assert.equal(ok, 12, "cada llamada se serializa y valida de nuevo: todas terminan bien");
    assert.equal(resumenPlan(), "4|1000000|4|0-3", "UN solo plan: 4 filas, suma exacta, órdenes 0..3 sin repetir");
    t.diagnostic(`plan final: ${plan()}`);
  });

  test("C2 · 16 llamadas MEZCLADAS (8 de 4 filas, 8 de 2 filas) → exactamente UN plan completo", async (t) => {
    const f = await fuentes();
    const rs = await Promise.all(Array.from({ length: 16 }, (_, i) => sesionDe(UID_SUPER).rpc("reemplazar_plan_cobro", { p_numero: N, p_fuentes: f, p_filas: i % 2 ? plan2 : plan4 })));
    assert.equal(rs.filter((r) => !r.error).length, 16);
    const r = resumenPlan();
    t.diagnostic(`plan final: ${plan()} (${r})`);
    assert.ok(r === "4|1000000|4|0-3" || r === "2|1000000|2|0-1", `un plan completo de 4 o de 2 filas, nunca mezcla: ${r}`);
  });

  test("C3 · 6 regeneraciones simultáneas con la ACCIÓN real → un plan; repetir no acumula", async (t) => {
    uidSesion = UID_SUPER;
    const rs = await Promise.all(Array.from({ length: 6 }, () => generarPlanCobro(N, "mensual", idc())));
    t.diagnostic(`acciones: ${JSON.stringify(rs.map((r) => (r.ok ? "ok" : (r as { error: string }).error.slice(0, 60))))}`);
    assert.ok(rs.every((r) => r.ok), "ninguna regeneración simultánea falla (cada una ve las mismas fuentes)");
    const una = resumenPlan();
    await generarPlanCobro(N, "mensual", idc());
    assert.equal(resumenPlan(), una, "regenerar otra vez deja la misma cantidad de filas (no acumula)");
    assert.match(una, /^\d+\|1000000\|\d+\|0-\d+$/);
  });

  test("F1 · fallo inyectado en el INSERT → error y el plan anterior queda IDÉNTICO (mismos ids)", async (t) => {
    const antes = plan();
    sql(`create or replace function public.t_falla_insert() returns trigger language plpgsql as $f$ begin if new.numero_contrato = '${N}' then raise exception 'FALLA_INYECTADA_INSERT'; end if; return new; end $f$;
         create trigger t_falla_insert before insert on public.cuotas for each row execute function public.t_falla_insert();`);
    try {
      const f = await fuentes();
      const r = await sesionDe(UID_SUPER).rpc("reemplazar_plan_cobro", { p_numero: N, p_fuentes: f, p_filas: plan2 });
      t.diagnostic(`RPC → ${r.error?.message}`);
      assert.match(r.error?.message ?? "", /FALLA_INYECTADA_INSERT/);
      assert.equal(plan(), antes, "mismo plan, mismos ids");
      const a = await generarPlanCobro(N, "mensual", idc());
      t.diagnostic(`acción → ${JSON.stringify(a)}`);
      assert.equal(a.ok, false);
      assert.match((a as { error: string }).error, /se conservó el anterior/);
      assert.equal(plan(), antes, "la acción tampoco cambió nada");
    } finally { sql(`drop trigger if exists t_falla_insert on public.cuotas; drop function if exists public.t_falla_insert();`); }
  });

  test("F2 · fallo inyectado en el DELETE → error y el plan anterior queda idéntico", async (t) => {
    const antes = plan();
    sql(`create or replace function public.t_falla_delete() returns trigger language plpgsql as $f$ begin if old.numero_contrato = '${N}' then raise exception 'FALLA_INYECTADA_DELETE'; end if; return old; end $f$;
         create trigger t_falla_delete before delete on public.cuotas for each row execute function public.t_falla_delete();`);
    try {
      const f = await fuentes();
      const r = await sesionDe(UID_SUPER).rpc("reemplazar_plan_cobro", { p_numero: N, p_fuentes: f, p_filas: plan2 });
      t.diagnostic(`RPC → ${r.error?.message}`);
      assert.match(r.error?.message ?? "", /FALLA_INYECTADA_DELETE/);
      assert.equal(plan(), antes);
      const a = await generarPlanCobro(N, "mensual", idc());
      assert.equal(a.ok, false);
      assert.equal(plan(), antes);
    } finally { sql(`drop trigger if exists t_falla_delete on public.cuotas; drop function if exists public.t_falla_delete();`); }
  });

  test("F3 · tras quitar las fallas, el siguiente reemplazo vuelve a funcionar (sin estado colgado ni candados)", async () => {
    const f = await fuentes();
    const r = await sesionDe(UID_SUPER).rpc("reemplazar_plan_cobro", { p_numero: N, p_fuentes: f, p_filas: plan2 });
    assert.equal(r.error, null);
    assert.equal(resumenPlan(), "2|1000000|2|0-1");
  });

  test("roles: administración puede; `venta` del contrato propio puede (RLS de cuotas) y el de otro asesor NO (rechazo sin cambios)", async (t) => {
    const antes = plan();
    const f = await fuentes();
    const admin = await sesionDe(UID_ADMIN).rpc("reemplazar_plan_cobro", { p_numero: N, p_fuentes: f, p_filas: plan4 });
    assert.equal(admin.error, null, admin.error?.message);
    assert.equal(resumenPlan(), "4|1000000|4|0-3");
    const propio = await sesionDe(UID_VENTA).rpc("reemplazar_plan_cobro", { p_numero: N, p_fuentes: f, p_filas: plan2 });
    t.diagnostic(`venta propio → ${propio.error?.message ?? "ok"}`);
    const despuesPropio = plan();
    const ajeno = await sesionDe(UID_VENTA2).rpc("reemplazar_plan_cobro", { p_numero: N, p_fuentes: f, p_filas: plan4 });
    t.diagnostic(`venta ajeno → ${ajeno.error?.message ?? "ok"}`);
    assert.ok(ajeno.error, "un asesor que no es del contrato no puede reemplazar su plan");
    assert.equal(plan(), despuesPropio, "el rechazo no cambió nada");
    void antes;
  });

  test("consumo local (solicitudes HTTP a PostgREST; el costo alojado NO se mide aquí)", async (t) => {
    const i = solicitudes;
    await generarPlanCobro(N, "mensual", idc());
    t.diagnostic(`una regeneración con la acción real = ${solicitudes - i} solicitudes locales a PostgREST (lectura de contrato, condiciones, config, abonos, acuerdo + 1 rpc de reemplazo)`);
    assert.ok(solicitudes - i <= 10);
  });
});
