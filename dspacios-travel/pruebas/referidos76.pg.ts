// #76 — Referidos. Recorrido REAL: Server Actions de «Referidos» (CRM) y de aprobación B2B, el módulo de servidor que lee catálogo/contratos y `anular_abono` (la reversa financiera real) → PostgREST propio →
// PostgreSQL local (migraciones reales + 340/341). Lo único simulado es la sesión (JWT firmado, GoTrue falso). SOLO base LOCAL desechable; lo lanza supabase/scripts/test_76_referidos.sh con test_pg_local.sh.
// Afirma la conducta DESEADA (decisiones del dueño, 2026-11-24): solo superadmin/gerencia asignan; 1 % o 2 %; código = regla guardada; atribución futura con foto por contrato; participación pagable SOLO con el
// contrato 100 % pagado (la reversa de un pago la revierte); la participación del referidor no toca la comisión del aliado.
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG76_CONTENEDOR ?? "";
const DB = process.env.PG76_BASE ?? "";
const PGRST = process.env.PG76_POSTGREST ?? "";
const SECRETO = process.env.PG76_JWT_SECRET ?? "";
if (!CT || !DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG76_*: usa supabase/scripts/test_76_referidos.sh.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(specifier, context, nextResolve) {
  const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
  try { return nextResolve(specifier, context); } catch (e) {
    if (specifier.startsWith(".") && !/.[a-z]+$/.test(specifier)) { for (const suf of [".ts", "/index.ts"]) { try { return nextResolve(specifier + suf, context); } catch { /* sigue */ } } }
    throw e;
  }
} });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const uid = (n: number) => `00000000-0000-0000-0000-0000009076${String(n).padStart(2, "0")}`;
const U = {
  super: { id: uid(1), email: "t76-super@x.test", nombre: "T76 Super", rol: "superadmin", tenant: "mayorista", activo: true },
  gerencia: { id: uid(2), email: "t76-gerencia@x.test", nombre: "T76 Gerencia", rol: "gerencia", tenant: "mayorista", activo: true },
  admin: { id: uid(3), email: "t76-admin@x.test", nombre: "T76 Admin", rol: "administracion", tenant: "mayorista", activo: true },
  adminMin: { id: uid(4), email: "t76-admmin@x.test", nombre: "T76 AdmMin", rol: "administracion", tenant: "minorista", activo: true },
  oper: { id: uid(5), email: "t76-oper@x.test", nombre: "T76 Oper", rol: "operaciones", tenant: "mayorista", activo: true },
  venta: { id: uid(6), email: "t76-venta@x.test", nombre: "T76 Venta", rol: "venta", tenant: "mayorista", activo: true },
  agencia: { id: uid(7), email: "t76-agencia@x.test", nombre: "T76 Agencia", rol: "agencia", tenant: "mayorista", activo: true },
  inactivo: { id: uid(8), email: "t76-inactivo@x.test", nombre: "T76 Inactivo", rol: "gerencia", tenant: "mayorista", activo: false },
} as const;
type Quien = keyof typeof U;
let sesion: Quien | null = "super"; // null = sin sesión
const sidDe = (id: string) => id.replace(/^00000000/, "5e550000");
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-76";

let solicitudes = 0;
const fetchLocal: typeof fetch = (input, init) => { solicitudes++; return fetch(String(input).replace("/rest/v1/", "/"), init); };
async function medir<T>(fn: () => Promise<T>): Promise<{ r: T; n: number }> { const a = solicitudes; const r = await fn(); return { r, n: solicitudes - a }; }
function clienteLocal(token: string, usuario?: { id: string; email: string } | null) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario ?? null }, error: null });
  return sb;
}
const clienteSesion = () => {
  if (sesion == null) return clienteLocal(jwt({ role: "anon" }), null);
  const u = U[sesion];
  return clienteLocal(jwt({ role: "authenticated", sub: u.id, session_id: sidDe(u.id) }), { id: u.id, email: u.email });
};
async function como<T>(quien: Quien | null, fn: () => Promise<T>): Promise<T> { const antes = sesion; sesion = quien; try { return await fn(); } finally { sesion = antes; } }
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
const num = (q: string) => Number(sql(q));

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

// El cargador React compartido sustituye `@/lib/supabase/server` por un stub SOLO para `lib/roles.ts` (lo usa `puedeAprobar` en la acción de aprobación B2B). Se le entrega un cliente que sigue la sesión de la prueba.
const stubSupabase = await import("./support/stubs/supabaseServerStub.mjs") as unknown as { __setClient: (c: unknown) => void };
stubSupabase.__setClient(new Proxy({}, { get: (_t, p) => { const c = clienteSesion() as unknown as Record<string | symbol, unknown>; const v = c[p]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v; } }));
const A = await import("../app/(crm)/crm/referidos/actions.ts");
const S = await import("../lib/referidos/servidor.ts");
const B2B = await import("../app/(dashboard)/dashboard/usuarios/b2b/actions.ts");

const ALIADOS = [9601, 9602, 9603, 9604, 9605, 9606];
before(() => {
  const us = Object.values(U);
  sql(`
    insert into auth.users (id, email) values ${us.map((u) => `('${u.id}', '${u.email}')`).join(", ")} on conflict do nothing;
    insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion, activo) values
      ${ALIADOS.map((id, i) => `(${id}, 'Aliado ${id}', '${id}0', '${i % 2 ? "freelance" : "agencia"}', 0.1, false, 0, true)`).join(", ")} on conflict (id) do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
      ${us.map((u) => `('${u.id}', '${u.email}', '${u.nombre}', '${u.rol}', ${u.activo}, '${u.tenant}', ${u.rol === "agencia" ? 9601 : "null"})`).join(", ")}
      on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id, nombre = excluded.nombre;
    insert into auth.sessions (id, user_id) select ('5e550000' || substr(id::text, 9))::uuid, id from public.usuarios where id in (${us.map((u) => `'${u.id}'`).join(", ")}) on conflict do nothing;
    insert into public.sesion_agencia (session_id, user_id, tenant) select ('5e550000' || substr(id::text, 9))::uuid, id, tenant from public.usuarios where id in (${us.map((u) => `'${u.id}'`).join(", ")}) on conflict do nothing;
  `);
});

// La comisión del aliado nace como en registrar_comision_b2b_reserva (205): precio_venta = PVP bruto, base_comision = base GUARDADA (explícita), % del aliado. Es la evidencia de la base del referido.
const filaComision = (numero: string, aliado: number, base: number, bruto: number, neto: boolean, pct = 0.11) =>
  sql(`insert into public.aliados_b2b (numero_contrato, tenant, aliado, aliado_id, precio_venta, base_comision, base_explicita, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado, descontada_en_precio)
        select '${numero}', v.tenant, a.nombre, a.id, ${bruto}, ${base}, true, ${pct}, 0, 0, false, 0, '${neto ? "pagada" : "pendiente"}', ${neto} from public.ventas v, public.aliados a where v.numero_contrato = '${numero}' and a.id = ${aliado}`);
const venta = (numero: string, aliado: number, precio: number, imp = 0, moneda = "COP", tenant = "mayorista") => {
  sql(`insert into public.ventas (numero_contrato, tenant, tipo_paquete, estado, cliente, asesor, precio_venta, impuesto, moneda, aliado_id, created_at) values ('${numero}', '${tenant}', 'bloqueo', 'confirmado', 'Cliente ${numero}', 'Asesor', ${precio}, ${imp}, '${moneda}', ${aliado}, clock_timestamp())`);
  filaComision(numero, aliado, Math.max(0, precio - imp), precio, false);
};
// Contrato que tiene aliado y asignación pero NO tiene guardada la comisión del aliado (no hay evidencia de la base).
const ventaSinComision = (numero: string, aliado: number, precio: number, imp = 0) =>
  sql(`insert into public.ventas (numero_contrato, tenant, tipo_paquete, estado, cliente, asesor, precio_venta, impuesto, moneda, aliado_id, created_at) values ('${numero}', 'mayorista', 'bloqueo', 'confirmado', 'Cliente ${numero}', 'Asesor', ${precio}, ${imp}, 'COP', ${aliado}, clock_timestamp())`);
// Contrato NETO real de la reserva: precio_venta = PVP − comisión; la fila nace «descontada en el precio» con la base ORIGINAL guardada.
const ventaNeta = (numero: string, aliado: number, pvp: number, imp: number, pct = 0.11, moneda = "COP") => {
  const base = Math.max(0, pvp - imp), com = Math.round(base * pct);
  sql(`insert into public.ventas (numero_contrato, tenant, tipo_paquete, estado, cliente, asesor, precio_venta, impuesto, moneda, aliado_id, comision_estado, modo_compra, comision_b2b, created_at) values ('${numero}', 'mayorista', 'bloqueo', 'confirmado', 'Cliente ${numero}', 'Asesor', ${pvp - com}, ${imp}, '${moneda}', ${aliado}, 'descontada', 'neta', ${com}, clock_timestamp())`);
  filaComision(numero, aliado, base, pvp, true, pct);
  return { base, com, cobrado: pvp - com };
};
const abono = (numero: string, valor: number) => num(`insert into public.abonos (numero_contrato, cliente, fecha_abono, valor_abono, forma_pago, tenant) values ('${numero}', 'C', current_date, ${valor}, 'transferencia', 'mayorista') returning id`);
const fila = async (quien: Quien, numero: string) => {
  const r = await como(quien, async () => { const a = await S.actorReferidos(); return a ? S.cargarContratosReferidos(a) : null; });
  return r && r.ok ? r.datos.find((c) => c.numero_contrato === numero) ?? null : null;
};
const filas = (n: string) => num(`select count(*) from public.${n}`);
const R: Record<string, number> = {};

describe("permisos", () => {
  test("P1 sin permiso NO se crea nada: operaciones, venta, aliado, inactivo, sin sesión y administración (solo consulta)", async () => {
    for (const q of ["oper", "venta", "agencia", "inactivo", "admin", "adminMin", null] as const) {
      const r = await como(q, () => A.guardarReferidorAction({ tenant: "mayorista", nombre: "No Debe Existir" }));
      assert.deepEqual(r, { ok: false, error: "No tienes permiso para esta operación." }, String(q));
    }
    assert.equal(filas("referidores"), 0);
    for (const q of ["oper", "venta", "agencia", "inactivo", null] as const) assert.equal(await como(q, () => S.actorReferidos()), null, `${q} no entra a Referidos`);
    const adm = await como("admin", () => S.actorReferidos()); assert.deepEqual(adm?.acceso, { ok: true, gestiona: false });
  });

  test("P2 superadmin y gerencia crean referidores; datos inválidos se rechazan con su mensaje (sin tocar la base)", async () => {
    const a = await como("super", () => A.guardarReferidorAction({ tenant: "mayorista", nombre: "Odair Referidor", tipoDocumento: "CC", documento: "7601001", email: "odair@x.test" }));
    assert.equal(a.ok, true); R.r1 = num(`select id from public.referidores where documento = '7601001'`);
    const b = await como("gerencia", () => A.guardarReferidorAction({ tenant: "minorista", nombre: "Referidora Minorista" }));
    assert.equal(b.ok, true); R.rMin = num(`select id from public.referidores where nombre = 'Referidora Minorista'`);
    const c = await como("gerencia", () => A.guardarReferidorAction({ tenant: "mayorista", nombre: "Segundo Referidor" })); assert.equal(c.ok, true); R.r2 = num(`select id from public.referidores where nombre = 'Segundo Referidor'`);
    assert.deepEqual(await como("super", () => A.guardarReferidorAction({ tenant: "otra", nombre: "Agencia Rara" })), { ok: false, error: "Elige la agencia del referidor." });
    const corto = await como("super", () => A.guardarReferidorAction({ tenant: "mayorista", nombre: "ab" })); assert.equal(corto.ok, false);
    const dup = await como("super", () => A.guardarReferidorAction({ tenant: "mayorista", nombre: "Otro Nombre", tipoDocumento: "CC", documento: "7601001" }));
    assert.deepEqual(dup, { ok: false, error: "Ya existe un referidor con ese documento en esa agencia." });
  });

  test("P3 la tarifa solo puede ser 1 % o 2 %: lo rechaza la acción Y, aunque se salte la acción, la base (check y función)", async () => {
    for (const pct of [0.03, 0.015, "abc", 1, 0]) {
      const r = await como("super", () => A.definirCodigoAction({ referidorId: R.r1, codigo: "ODAIR-X", pct: pct as never })); assert.equal(r.ok, false, String(pct));
    }
    const admin = clienteLocal(TOKEN_SERVICIO);
    const directo = await (admin as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<{ error: { code?: string } | null }> }).rpc("referidor_codigo_definir", { p_actor: U.super.id, p_referidor_id: R.r1, p_codigo: "ODAIR-X", p_pct: 0.03, p_activo: true });
    assert.equal(directo.error?.code, "F4704", "la base lo rechaza aunque se llame directo");
    assert.equal(num(`select count(*) from public.referidor_codigos`), 0);
    // La restricción de la TABLA (no solo la función) también cierra el paso: un INSERT directo con 5 % viola el check. Se prueba como dueño de la tabla para no confundirlo con un permiso denegado.
    assert.throws(() => sql(`insert into public.aliado_referidores (aliado_id, referidor_id, tenant, pct, origen, asignado_por) values (9601, ${R.r1}, 'mayorista', 0.05, 'manual', '${U.super.id}')`), /aliado_referidores_pct_check|check constraint/);
  });
});

describe("asignación manual y por código; agencia y freelance; ambos porcentajes", () => {
  test("A1 gerencia asigna 1 % a la AGENCIA y 2 % al FREELANCE; administración NO; repetir no cambia nada", async () => {
    const a = await como("gerencia", () => A.asignarReferidoAction({ aliadoId: 9601, referidorId: R.r1, pct: 0.01 })); assert.deepEqual(a, { ok: true, estado: "asignada" });
    const f = await como("gerencia", () => A.asignarReferidoAction({ aliadoId: 9602, referidorId: R.r1, pct: "0,02" })); assert.deepEqual(f, { ok: true, estado: "asignada" });
    assert.deepEqual(await como("admin", () => A.asignarReferidoAction({ aliadoId: 9603, referidorId: R.r1, pct: 0.01 })), { ok: false, error: "No tienes permiso para esta operación." });
    assert.deepEqual(await como("gerencia", () => A.asignarReferidoAction({ aliadoId: 9601, referidorId: R.r1, pct: 0.01 })), { ok: true, estado: "sin_cambio" });
    assert.equal(num(`select count(*) from public.aliado_referidores where aliado_id in (9601, 9602)`), 2);
    assert.equal(num(`select pct * 100 from public.aliado_referidores where aliado_id = 9602`), 2);
  });

  test("A2 el código resuelve la regla GUARDADA: referidor y % salen de la base; administración NO aplica ni define códigos", async () => {
    assert.equal((await como("super", () => A.definirCodigoAction({ referidorId: R.r1, codigo: "odair-2", pct: 0.02 }))).ok, true);
    assert.equal((await como("super", () => A.definirCodigoAction({ referidorId: R.r1, codigo: "ODAIR-1", pct: 0.01 }))).ok, true);
    assert.deepEqual(await como("admin", () => A.definirCodigoAction({ referidorId: R.r1, codigo: "NOPE-1", pct: 0.01 })), { ok: false, error: "No tienes permiso para esta operación." });
    assert.deepEqual(await como("admin", () => A.aplicarCodigoAction({ aliadoId: 9604, codigo: "ODAIR-2" })), { ok: false, error: "No tienes permiso para esta operación." });
    assert.equal(num(`select count(*) from public.aliado_referidores where aliado_id = 9604`), 0, "administración no asignó nada");
    const r = await como("gerencia", () => A.aplicarCodigoAction({ aliadoId: 9604, codigo: " Odair-2 " })); assert.deepEqual(r, { ok: true, estado: "asignada" });
    assert.equal(sql(`select pct || '|' || origen || '|' || codigo from public.aliado_referidores where aliado_id = 9604 and vigente_hasta is null`), "0.0200|codigo|ODAIR-2");
    assert.deepEqual(await como("gerencia", () => A.aplicarCodigoAction({ aliadoId: 9604, codigo: "NOEXISTE" })), { ok: false, error: "El código de referido no es válido." });
    assert.deepEqual(await como("gerencia", () => A.aplicarCodigoAction({ aliadoId: 9604, codigo: "x" })), { ok: false, error: "El código de referido no es válido." });
  });

  test("A3 duplicados y operaciones CONCURRENTES por la vía real: 8 iguales → 1 fila; 8 en conflicto → 1 vigente, sin errores", async () => {
    const iguales = await Promise.all(Array.from({ length: 8 }, () => como("super", () => A.asignarReferidoAction({ aliadoId: 9603, referidorId: R.r1, pct: 0.01 }))));
    assert.ok(iguales.every((x) => x.ok), JSON.stringify(iguales.filter((x) => !x.ok)));
    assert.equal(iguales.filter((x) => x.ok && x.estado === "asignada").length, 1); assert.equal(num(`select count(*) from public.aliado_referidores where aliado_id = 9603`), 1);
    const conflicto = await Promise.all(Array.from({ length: 8 }, (_, i) => como("super", () => A.asignarReferidoAction({ aliadoId: 9605, referidorId: i % 2 ? R.r1 : R.r2, pct: i % 2 ? 0.01 : 0.02 }))));
    assert.ok(conflicto.every((x) => x.ok), JSON.stringify(conflicto.filter((x) => !x.ok)));
    assert.equal(num(`select count(*) from public.aliado_referidores where aliado_id = 9605 and vigente_hasta is null`), 1);
    assert.equal(num(`select count(*) from public.aliado_referidores where aliado_id = 9605 and vigente_hasta < vigente_desde`), 0);
  });
});

describe("atribución por contrato, elegibilidad y reversa de pagos", () => {
  test("C1 el contrato guarda la FOTO vigente; la participación sale de la base comisionable (PVP − impuesto) al 1 % y al 2 %", async () => {
    venta("DTM-7601", 9601, 1_000_000, 200_000);   // agencia 1 %: base 800.000 → 8.000
    venta("DTM-7602", 9602, 3_000_000, 0);          // freelance 2 %: base 3.000.000 → 60.000
    const a = await fila("gerencia", "DTM-7601"), f = await fila("gerencia", "DTM-7602");
    assert.deepEqual([a?.pct, a?.base, a?.comision, a?.estado], [0.01, 800_000, 8_000, "pendiente_pago"]);
    assert.deepEqual([f?.pct, f?.base, f?.comision, f?.estado], [0.02, 3_000_000, 60_000, "pendiente_pago"]);
    assert.equal(a?.referidor_id, R.r1);
  });

  test("C2 pago parcial NO habilita; 100 % pagado SÍ; la reversa financiera real (anular_abono) lo devuelve a pendiente; pagar de nuevo lo habilita", async () => {
    const parcial = abono("DTM-7601", 300_000);
    assert.equal((await fila("gerencia", "DTM-7601"))?.estado, "pendiente_pago", "parcial");
    const resto = abono("DTM-7601", 700_000);
    assert.equal((await fila("gerencia", "DTM-7601"))?.estado, "elegible", "100 % pagado");
    const admin = clienteLocal(TOKEN_SERVICIO) as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }> };
    const anulado = await admin.rpc("anular_abono", { p_abono_id: resto, p_numero: "DTM-7601", p_tenant: "mayorista", p_actor: U.gerencia.id, p_motivo: "reversa de prueba" });
    assert.equal(anulado.error, null, anulado.error?.message);
    assert.equal((await fila("gerencia", "DTM-7601"))?.estado, "pendiente_pago", "tras anular el pago");
    abono("DTM-7601", 700_000);
    assert.equal((await fila("gerencia", "DTM-7601"))?.estado, "elegible", "pagado otra vez");
    assert.ok(parcial > 0);
  });

  test("C3 un comprobante o saldo pendiente NO bastan: sin abonos completos el contrato sigue pendiente aunque haya evidencia", async () => {
    venta("DTM-7603", 9601, 1_000_000, 0);
    abono("DTM-7603", 400_000);   // saldo pendiente 600.000 (aunque hubiera soportes adjuntos, la elegibilidad no los lee)
    assert.equal((await fila("gerencia", "DTM-7603"))?.estado, "pendiente_pago");
  });

  test("C4 un cambio FUTURO de asignación no toca lo ya atribuido; el contrato nuevo toma la nueva; quitar corta lo siguiente", async () => {
    const cambia = await como("super", () => A.asignarReferidoAction({ aliadoId: 9601, referidorId: R.r2, pct: 0.02, motivo: "cambio de acuerdo" })); assert.deepEqual(cambia, { ok: true, estado: "cambiada" });
    venta("DTM-7604", 9601, 500_000, 0);
    const viejo = await fila("gerencia", "DTM-7601"), nuevo = await fila("gerencia", "DTM-7604");
    assert.deepEqual([viejo?.referidor_id, viejo?.pct, viejo?.comision], [R.r1, 0.01, 8_000], "el contrato anterior conserva su foto y su monto");
    assert.deepEqual([nuevo?.referidor_id, nuevo?.pct, nuevo?.comision], [R.r2, 0.02, 10_000]);
    const quita = await como("super", () => A.quitarReferidoAction({ aliadoId: 9601, tenant: "mayorista", motivo: "fin" })); assert.deepEqual(quita, { ok: true, estado: "quitada" });
    venta("DTM-7605", 9601, 500_000, 0);
    assert.equal(await fila("gerencia", "DTM-7605"), null, "compra posterior a quitar: sin atribución");
    assert.equal((await fila("gerencia", "DTM-7604"))?.referidor_id, R.r2, "lo atribuido sigue ahí");
    assert.equal(num(`select count(*) from public.aliado_referidores where aliado_id = 9601`), 2, "historial íntegro");
  });

  test("C5 la participación del referidor NO toca la comisión del aliado: ni filas ni cambios en aliados_b2b", async () => {
    venta("DTM-7606", 9602, 1_000_000, 0);
    abono("DTM-7606", 1_000_000);
    const antes = sql(`select md5(string_agg(to_jsonb(a)::text, '|' order by id)) from public.aliados_b2b a`);
    await como("super", () => A.asignarReferidoAction({ aliadoId: 9602, referidorId: R.r2, pct: 0.01 }));
    assert.equal(sql(`select md5(string_agg(to_jsonb(a)::text, '|' order by id)) from public.aliados_b2b a`), antes);
    assert.equal(num(`select count(*) from public.aliados_b2b where numero_contrato = 'DTM-7606'`), 1, "solo la comisión del aliado del propio contrato; el referido no crea ninguna");
  });

  test("C6 cancelado y base guardada 0 llevan su estado explícito; sin comisión del aliado guardada NO hay cero calculado (sin evidencia)", async () => {
    sql(`insert into public.ventas (numero_contrato, tenant, tipo_paquete, estado, cliente, asesor, precio_venta, impuesto, moneda, aliado_id, created_at) values ('DTM-7608', 'mayorista', 'bloqueo', 'cancelado', 'C', 'A', 1000000, 0, 'COP', 9603, clock_timestamp()), ('DTM-7609', 'mayorista', 'bloqueo', 'confirmado', 'C', 'A', 100000, 100000, 'COP', 9603, clock_timestamp())`);
    filaComision("DTM-7609", 9603, 0, 100000, false);
    assert.equal((await fila("gerencia", "DTM-7608"))?.estado, "cancelado"); assert.equal((await fila("gerencia", "DTM-7609"))?.estado, "sin_base");
    assert.equal((await fila("gerencia", "DTM-7609"))?.comision, 0, "0 GUARDADO: la base guardada es 0");
    ventaSinComision("DTM-7610", 9603, 2_000_000, 200_000);
    const sin = await fila("gerencia", "DTM-7610");
    assert.deepEqual([sin?.estado, sin?.base, sin?.comision], ["sin_evidencia_base", null, null], "ni 0 ni PVP − impuesto: falta la evidencia");
  });

  test("C6b (C76-1) una comisión SIN aliado_id (beneficiario en texto libre) no es evidencia: sola → sin evidencia; junto a la correcta → manda la correcta", async () => {
    const libre = (numero: string) => sql(`insert into public.aliados_b2b (numero_contrato, tenant, aliado, aliado_id, precio_venta, base_comision, base_explicita, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado) values ('${numero}', 'mayorista', 'Beneficiario libre', null, 2000000, 1000000, true, 0.05, 0, 0, false, 0, 'pendiente')`);
    ventaSinComision("DTM-7611", 9603, 2_000_000, 200_000); libre("DTM-7611");
    const sola = await fila("gerencia", "DTM-7611");
    assert.deepEqual([sola?.estado, sola?.base, sola?.comision], ["sin_evidencia_base", null, null], "sola, la fila sin id NO da 1.000.000 × % ni ningún monto");
    ventaSinComision("DTM-7612", 9603, 2_000_000, 200_000); filaComision("DTM-7612", 9603, 1_800_000, 2_000_000, false); libre("DTM-7612");
    const junto = await fila("gerencia", "DTM-7612");
    assert.deepEqual([junto?.estado, junto?.base], ["pendiente_pago", 1_800_000], "la base de la fila identificada sigue usable (sin base_ambigua)");
  });

  test("C7 MISMA base ⇒ MISMO monto en ordinario y NETO (real actions): 2 % de la base guardada 2.600.000 = 52.000; elegible solo con el contrato 100 % pagado", async () => {
    assert.equal((await como("super", () => A.asignarReferidoAction({ aliadoId: 9604, referidorId: R.r1, pct: 0.02 }))).ok, true);
    assert.equal((await como("super", () => A.asignarReferidoAction({ aliadoId: 9605, referidorId: R.r1, pct: 0.02 }))).ok, true);
    venta("DTM-7620", 9604, 3_000_000, 400_000);                       // ordinario: cobra 3.000.000
    const n = ventaNeta("DTM-7621", 9605, 3_000_000, 400_000);          // NETO: comisión 286.000, cobra 2.714.000
    assert.deepEqual([n.base, n.com, n.cobrado], [2_600_000, 286_000, 2_714_000]);
    const o = await fila("gerencia", "DTM-7620"), t = await fila("gerencia", "DTM-7621");
    assert.deepEqual([o?.base, o?.comision, o?.estado, o?.neto], [2_600_000, 52_000, "pendiente_pago", false]);
    assert.deepEqual([t?.base, t?.comision, t?.estado, t?.neto], [2_600_000, 52_000, "pendiente_pago", true], "NETO: la base ORIGINAL guardada, mismo monto");
    assert.notEqual(t?.comision, 46_280, "no se calcula sobre lo cobrado en NETO (2.714.000 − 400.000)"); assert.notEqual(t?.comision, 5_720, "ni sobre el monto de la comisión del aliado");
    // Pago parcial y total (sobre lo que el comprador DEBE pagar).
    abono("DTM-7620", 1_000_000); abono("DTM-7621", 1_000_000);
    assert.equal((await fila("gerencia", "DTM-7620"))?.estado, "pendiente_pago"); assert.equal((await fila("gerencia", "DTM-7621"))?.estado, "pendiente_pago");
    abono("DTM-7620", 1_999_999); abono("DTM-7621", 1_713_999);
    assert.equal((await fila("gerencia", "DTM-7620"))?.estado, "pendiente_pago", "2.999.999 de 3.000.000"); assert.equal((await fila("gerencia", "DTM-7621"))?.estado, "pendiente_pago", "2.713.999 de 2.714.000");
    const ultimo = abono("DTM-7620", 1); abono("DTM-7621", 1);
    const o2 = await fila("gerencia", "DTM-7620"), t2 = await fila("gerencia", "DTM-7621");
    assert.deepEqual([o2?.estado, o2?.comision], ["elegible", 52_000]); assert.deepEqual([t2?.estado, t2?.comision], ["elegible", 52_000], "NETO elegible con 2.714.000 pagados (el total exigible), mismo monto");
    // Reversa financiera REAL: anular el último peso del ordinario lo devuelve a pendiente (misma regla).
    const admin = clienteLocal(TOKEN_SERVICIO) as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<{ error: { message?: string } | null }> };
    const r = await admin.rpc("anular_abono", { p_abono_id: ultimo, p_numero: "DTM-7620", p_tenant: "mayorista", p_actor: U.gerencia.id, p_motivo: "reversa C7" });
    assert.equal(r.error, null, r.error?.message);
    const o3 = await fila("gerencia", "DTM-7620"); assert.deepEqual([o3?.estado, o3?.comision], ["pendiente_pago", 52_000]);
  });
});

describe("lectura autorizada y aprobación B2B con código", () => {
  test("L1 qué ve cada rol: administración solo su agencia, gerencia las dos; los demás, nada; el catálogo igual", async () => {
    venta("MIN-00-7690", 9604, 400_000, 0, "COP", "minorista");   // minorista: la asignación de 9604 es de mayorista → sin atribución
    sql(`select public.referido_asignar('${U.gerencia.id}', 9604, ${R.rMin}, 0.01, 'minorista')`);
    venta("MIN-00-7691", 9604, 400_000, 0, "COP", "minorista");
    const ver = async (q: Quien) => como(q, async () => { const a = await S.actorReferidos(); return a ? S.cargarContratosReferidos(a) : null; });
    const g = await ver("gerencia"), ad = await ver("admin"), am = await ver("adminMin");
    assert.ok(g && g.ok && g.datos.some((c) => c.tenant === "minorista") && g.datos.some((c) => c.tenant === "mayorista"));
    assert.ok(ad && ad.ok && ad.datos.length > 0 && ad.datos.every((c) => c.tenant === "mayorista"));
    assert.ok(am && am.ok && am.datos.length === 1 && am.datos[0].numero_contrato === "MIN-00-7691" && am.datos.every((c) => c.tenant === "minorista"));
    for (const q of ["oper", "venta", "agencia", "inactivo"] as const) assert.equal(await ver(q), null, q);
    const cat = await como("admin", async () => { const a = await S.actorReferidos(); return a ? S.cargarCatalogoReferidos(a) : null; });
    assert.ok(cat && cat.ok && cat.datos.referidores.every((r) => r.tenant === "mayorista"));
  });

  test("L2 consumo: cargar la pantalla = 1 lectura de perfil + 3 llamadas a funciones (catálogo, contratos y códigos por confirmar); sin sondeos", async () => {
    const { n } = await medir(() => como("gerencia", async () => { const a = await S.actorReferidos(); await S.cargarCatalogoReferidos(a!); await S.cargarContratosReferidos(a!); await S.cargarCandidatosReferidos(a!); }));
    console.log(`  [consumo] pantalla Referidos: ${n} solicitudes HTTP a PostgREST (sesión + perfil + catálogo + contratos + códigos por confirmar)`);
    assert.ok(n <= 5, `solicitudes: ${n}`);
    // La página de aprobaciones B2B: perfil + candidatos (todos los aprobadores) y, solo para quien decide, el catálogo.
    const adm = await medir(() => como("admin", async () => { const a = await S.actorReferidos(); await S.cargarCandidatosReferidos(a!); }));
    const ger = await medir(() => como("gerencia", async () => { const a = await S.actorReferidos(); await Promise.all([S.cargarCandidatosReferidos(a!), S.cargarCatalogoReferidos(a!)]); }));
    console.log(`  [consumo] aprobaciones B2B: administración ${adm.n} / gerencia ${ger.n} solicitudes HTTP (sesión + perfil + candidatos [+ catálogo])`);
    assert.ok(adm.n <= 3 && ger.n <= 4, `administración ${adm.n}, gerencia ${ger.n}`);
  });


  // ── Código escrito en el registro público (migración 342): CANDIDATO; solo superadmin/gerencia deciden ──────────────────────────────────────
  // La plantilla local trae un auth.users simplificado: en Supabase esta columna ya existe.
  const registrar = (n: number, datos: Record<string, unknown>) => {
    const uidB = `00000000-0000-0000-0000-0000009077${String(n).padStart(2, "0")}`;
    sql(`
      alter table auth.users add column if not exists email_confirmed_at timestamptz;
      insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ('${uidB}', 'reg76-${n}@x.test', now(), '{"registro_b2b_codigo": true}'::jsonb) on conflict (id) do nothing;
      insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${uidB}', 'reg76-${n}@x.test', 'Registro ${n}', 'freelance', false, 'mayorista')
        on conflict (id) do update set rol = 'freelance', activo = false, aliado_id = null;
      select public.registro_b2b_iniciar('${uidB}', '${JSON.stringify(datos)}'::jsonb);
      select public.registro_b2b_completar('${uidB}', null);
    `);
    return num(`select id from public.b2b_solicitudes where usuario_id = '${uidB}'`);
  };
  const estadoCand = (id: number) => sql(`select referido_estado || '|' || estado from public.b2b_solicitudes where id = ${id}`);
  const vigente = (aliado: number) => sql(`select coalesce((select referidor_id || '|' || pct || '|' || origen || '|' || coalesce(codigo, '-') from public.aliado_referidores where aliado_id = ${aliado} and vigente_hasta is null), 'ninguna')`);
  const candidato = (pct: 0.01 | 0.02, ref = R.r1) => ({ decision: "confirmar_codigo", referidorId: ref, pct });

  test("B1 el registro guarda el código como CANDIDATO y no asigna nada hasta que se confirme", async () => {
    const asignacionesAntes = num("select count(*) from public.aliado_referidores");
    const id = registrar(1, { nit: "77001", codigo_referido: " odair-1 " });
    assert.equal(sql(`select codigo_referido from public.b2b_solicitudes where id = ${id}`), "ODAIR-1");
    assert.equal(estadoCand(id), "candidato|pendiente");
    assert.equal(num("select count(*) from public.aliado_referidores"), asignacionesAntes, "registrarse con un código no asigna nada");
    assert.equal(estadoCand(registrar(2, { nit: "77002", codigo_referido: "a b" })), "sin_codigo|pendiente", "formato inválido: se registra sin candidato");
    R.c1 = id;
  });

  test("B2 gerencia APRUEBA y confirma en el mismo paso: referidor y % salen de la regla guardada (no del navegador)", async () => {
    const r = await como("gerencia", () => B2B.aprobarSolicitudB2B(R.c1, 9606, candidato(0.01)));
    assert.deepEqual(r, { ok: true, aviso: "Registro aprobado y referido asignado para las compras futuras del aliado." });
    assert.equal(estadoCand(R.c1), "confirmado|aprobada");
    assert.equal(vigente(9606), `${R.r1}|0.0100|codigo|ODAIR-1`);
  });

  test("B3 administración APRUEBA pero NO decide: con una decisión se rechaza ANTES de aprobar; sin ella, el candidato queda por confirmar", async () => {
    const id = registrar(3, { nit: "77003", codigo_referido: "ODAIR-2" });
    const bloqueada = await como("admin", () => B2B.aprobarSolicitudB2B(id, 9601, candidato(0.02)));
    assert.equal(bloqueada.ok, false); assert.match((bloqueada as { error: string }).error, /Solo superadmin o gerencia/);
    assert.equal(estadoCand(id), "candidato|pendiente", "no se aprobó nada");
    for (const trampa of [{ decision: "descartar" }, { decision: "asignar_otro", referidorId: R.r2, pct: 0.02 }]) {
      const t = await como("admin", () => B2B.aprobarSolicitudB2B(id, 9601, trampa)); assert.equal(t.ok, false);
    }
    assert.equal(estadoCand(id), "candidato|pendiente");
    const antes = vigente(9601);
    const aprobada = await como("admin", () => B2B.aprobarSolicitudB2B(id, 9601)); assert.deepEqual(aprobada, { ok: true });
    assert.equal(estadoCand(id), "candidato|aprobada", "aprobado, el código sigue por confirmar"); assert.equal(vigente(9601), antes, "la asignación existente no cambió");
    // Administración tampoco puede decidir después por la acción del CRM.
    const d = await como("admin", () => A.decidirCandidatoAction({ solicitudId: id, decision: candidato(0.02) })); assert.deepEqual(d, { ok: false, error: "No tienes permiso para esta operación." });
    R.c3 = id;
  });

  test("B4 más tarde, superadmin/gerencia confirman desde CRM; si la regla cambió mientras miraban, NO se asigna nada", async () => {
    const antes = vigente(9601);
    const vieja = await como("gerencia", () => A.decidirCandidatoAction({ solicitudId: R.c3, decision: candidato(0.01) }));   // vio 1 %, la regla guardada es 2 %
    assert.deepEqual(vieja, { ok: false, error: "La regla del código cambió mientras revisabas. Recarga la página y confirma de nuevo." });
    assert.equal(vigente(9601), antes); assert.equal(estadoCand(R.c3), "candidato|aprobada");
    const filasAntes = num("select count(*) from public.aliado_referidores where aliado_id = 9601");
    const ok = await como("gerencia", () => A.decidirCandidatoAction({ solicitudId: R.c3, decision: candidato(0.02) }));
    assert.equal(ok.ok, true);
    // 9601 ya tenía referidor (asignación manual de A1): la decisión explícita lo reemplaza SOLO hacia adelante y el historial queda.
    assert.equal(vigente(9601), `${R.r1}|0.0200|codigo|ODAIR-2`); assert.equal(estadoCand(R.c3), "confirmado|aprobada");
    assert.equal(num("select count(*) from public.aliado_referidores where aliado_id = 9601"), filasAntes + 1);
  });

  test("B5 decisiones concurrentes sobre el MISMO candidato: una sola asignación, el resto «ya decidida»", async () => {
    sql("insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion, activo) values (9607, 'Aliado 9607', '96070', 'freelance', 0.1, false, 0, true) on conflict (id) do nothing");   // ficha SIN referidor previo
    const id = registrar(5, { nit: "77005", codigo_referido: "ODAIR-1" });
    assert.equal((await como("admin", () => B2B.aprobarSolicitudB2B(id, 9607))).ok, true);
    const antes = num("select count(*) from public.aliado_referidores where aliado_id = 9607");
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => como(i % 2 ? "super" : "gerencia", () => A.decidirCandidatoAction({ solicitudId: id, decision: candidato(0.01) }))));
    assert.ok(rs.every((x) => x.ok), JSON.stringify(rs.filter((x) => !x.ok)));
    assert.equal(rs.filter((x) => x.ok && x.estado !== "ya_decidida").length, 1, "exactamente una decisión efectiva");
    assert.equal(num("select count(*) from public.aliado_referidores where aliado_id = 9607 and vigente_hasta is null"), 1);
    assert.equal(num("select count(*) from public.aliado_referidores where aliado_id = 9607") - antes, 1, "sin filas duplicadas");
  });

  test("B6 una alternativa explícita (otro referidor, 2 %) y el descarte; porcentajes fuera de 1 %/2 % no pasan", async () => {
    const a = registrar(6, { nit: "77006", codigo_referido: "ODAIR-1" });
    assert.equal((await como("admin", () => B2B.aprobarSolicitudB2B(a, 9602))).ok, true);
    const mala = await como("gerencia", () => A.decidirCandidatoAction({ solicitudId: a, decision: { decision: "asignar_otro", referidorId: R.r2, pct: 0.03 } }));
    assert.deepEqual(mala, { ok: false, error: "Elige qué hacer con el código de referido." });
    const otra = await como("gerencia", () => A.decidirCandidatoAction({ solicitudId: a, decision: { decision: "asignar_otro", referidorId: R.r2, pct: 0.02 } }));
    assert.equal(otra.ok, true); assert.equal(estadoCand(a), "reemplazado|aprobada");
    assert.equal(vigente(9602), `${R.r2}|0.0200|manual|-`);
    const b = registrar(7, { nit: "77007", codigo_referido: "ODAIR-1" });
    assert.equal((await como("admin", () => B2B.aprobarSolicitudB2B(b, 9603))).ok, true);
    const antes = vigente(9603);
    const desc = await como("super", () => A.decidirCandidatoAction({ solicitudId: b, decision: { decision: "descartar" } })); assert.deepEqual(desc, { ok: true, estado: "descartada" });
    assert.equal(estadoCand(b), "descartado|aprobada"); assert.equal(vigente(9603), antes, "descartar no toca la asignación vigente");
  });

  test("B7 aprobado SIN enlazar ficha: se aprueba, pero no hay a quién asignar; roles sin permiso no leen ni deciden", async () => {
    const id = registrar(8, { nit: "77008", codigo_referido: "ODAIR-1" });
    const r = await como("gerencia", () => B2B.aprobarSolicitudB2B(id, null, candidato(0.01)));
    assert.equal(r.ok, true); assert.match((r as { aviso?: string }).aviso ?? "", /aprobado y enlazado a una ficha de aliado/i);
    assert.equal(estadoCand(id), "candidato|aprobada", "la aprobación se mantuvo y el código quedó por confirmar");
    for (const q of ["oper", "venta", "agencia", "inactivo", null] as const) {
      assert.equal(await como(q, () => S.actorReferidos()), null, String(q));
      assert.deepEqual(await como(q, () => A.decidirCandidatoAction({ solicitudId: id, decision: candidato(0.01) })), { ok: false, error: "No tienes permiso para esta operación." }, String(q));
    }
    const verAdmin = await como("admin", async () => { const a = await S.actorReferidos(); return a ? S.cargarCandidatosReferidos(a) : null; });
    assert.ok(verAdmin && verAdmin.ok && verAdmin.datos.some((c) => c.solicitud_id === id && c.referido_estado === "candidato"), "administración VE el candidato");
    const verMin = await como("adminMin", async () => { const a = await S.actorReferidos(); return a ? S.cargarCandidatosReferidos(a) : null; });
    assert.ok(verMin && verMin.ok && !verMin.datos.some((c) => c.solicitud_id === id), "administración de otra agencia NO lo ve");
  });
});
