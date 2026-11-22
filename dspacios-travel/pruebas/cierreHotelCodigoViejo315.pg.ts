// REL-2 · OLD source × FINAL database: what the code serving users TODAY does when the general hotel closure (migration 315) is written through it.
// This file is copied into the OLD tree (commit 312608a5922d4424ac912153394f4aee99357cb2, origin/main after #449) and run THERE, so every import below resolves to the OLD modules:
//   crearBlackout / eliminarBlackout (old catalogue actions, no regeneration, no closure helper) and cargarDatosTarifario (old public loader reading the published view).
// Database = clone of the template with the complete chain 001–326 (rel2_plantillas.sh). Only the session (auth.getUser) and next/cache are replaced.
// Purpose: show that 315's effect on old code is the INTENDED one (a closure written by old code hides the affected published rows through the trigger) and that nothing else changes
// (no error for old code, unaffected rows and other hotels stay visible, rows are hidden not deleted).
// Launch from the OLD tree (cwd = dspacios-travel of that tree), disposable database only:
//   MSYS_NO_PATHCONV=1 sh supabase/scripts/test_pg_local.sh pgb2b plantilla_rel2_final PG315 pruebas/cierreHotelCodigoViejo315.pg.ts
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG315_CONTENEDOR ?? "pgb2b";
const DB = process.env.PG315_BASE ?? "";
const PGRST = process.env.PG315_POSTGREST ?? "";
const SECRETO = process.env.PG315_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG315_BASE (desechable), PG315_POSTGREST y PG315_JWT_SECRET: usa supabase/scripts/test_pg_local.sh.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(specifier, context, nextResolve) { const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true }; return nextResolve(specifier, context); } });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const UID_ADMIN = "00000000-0000-0000-0000-000000315001";
const SESION_ADMIN = "5e315000-0000-0000-0000-000000315001"; // catalogue writes need a LIVE row in auth.sessions (migration 237)
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteSesion = () => clienteLocal(jwt({ role: "authenticated", sub: UID_ADMIN, session_id: SESION_ADMIN }), { id: UID_ADMIN, email: "admin315@x.test" });
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
}
const num = (q: string) => Number(sql(q));

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[], set: () => undefined };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

// OLD modules (this file runs inside the old tree).
const { crearBlackout, eliminarBlackout } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/blackouts-actions.ts");
const { cargarDatosTarifario } = await import("../lib/tarifario/datos.ts");
const { cargarFilasTarifarioPaginado } = await import("../lib/tarifario/paginacion.ts");

const OLD_COMMIT = "312608a5922d4424ac912153394f4aee99357cb2";
const DEST = 31501, PQ = 31501, HA = 31501, HB = 31502; // HA = hotel that gets closed · HB = control hotel in the same package
// Published window rows (porción terrestre, «desde» window without witness): the closure 2026-12-29 → 2027-01-09 touches the first, not the second.
const FILA = { dentro: 31501, fuera: 31502, otroHotel: 31503 };

before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin315@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_ADMIN}', 'admin315@x.test', 'Admin 315', 'administracion', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into auth.sessions (id, user_id) values ('${SESION_ADMIN}', '${UID_ADMIN}') on conflict do nothing;
    insert into public.destinos (id, nombre) values (${DEST}, 'CARTAGENA 315') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (31501, 'Proveedor Hotel 315') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, activo) values (${HA}, ${DEST}, 'Hotel Cerrado 315', 31501, 'COP', true), (${HB}, ${DEST}, 'Hotel Control 315', 31501, 'COP', true) on conflict do nothing;
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, moneda, activo) values (${PQ}, 'Porcion 315', 'porcion_terrestre', 3, ${DEST}, 0.2, 'COP', true) on conflict do nothing;
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (${PQ}, ${HA}, array['Estandar'], array['PAM']), (${PQ}, ${HB}, array['Estandar'], array['PAM']);
    -- inserting armado_hoteles marks the package snapshot as not publishable (migration 260); this fixture stands for an ALREADY PUBLISHED tariff, so restore it.
    update public.armado_paquetes set tarifario_snapshot_publicable = true where id = ${PQ};
    insert into public.tarifario_resultado (id, paquete_id, modulo, hotel_id, hotel_nombre, destino_id, categoria, regimen, acomodacion, noches, fecha_ida, fecha_regreso, base_comisionable, impuesto, precio_pvp, moneda) values
      (${FILA.dentro},    ${PQ}, 'porcion_terrestre', ${HA}, 'Hotel Cerrado 315', ${DEST}, 'Estandar', 'PAM', 'doble', 3, '2026-12-20', '2027-01-20', 375000, 0, 375000, 'COP'),
      (${FILA.fuera},     ${PQ}, 'porcion_terrestre', ${HA}, 'Hotel Cerrado 315', ${DEST}, 'Estandar', 'PAM', 'doble', 3, '2027-03-01', '2027-03-20', 375000, 0, 375000, 'COP'),
      (${FILA.otroHotel}, ${PQ}, 'porcion_terrestre', ${HB}, 'Hotel Control 315', ${DEST}, 'Estandar', 'PAM', 'doble', 3, '2026-12-20', '2027-01-20', 375000, 0, 375000, 'COP');
  `);
});

const visibles = () => sql(`select coalesce(string_agg(id::text, ',' order by id), '') from public.tarifario_resultado_publicable where paquete_id = ${PQ}`);
const fisicas = () => num(`select count(*) from public.tarifario_resultado where paquete_id = ${PQ}`);
const ocultas = () => sql(`select coalesce(string_agg(fila_id::text, ',' order by fila_id), '') from public.tarifario_fila_oculta where paquete_id = ${PQ}`);
// OLD read path of the published view (the paginated loader every old tariff page uses) + the whole old public loader must keep working without error.
const idsDelCargador = async () => {
  const pag = await cargarFilasTarifarioPaginado<{ id: number }>(clienteLocal(TOKEN_SERVICIO) as never, "id");
  assert.equal(pag.ok, true, "el cargador paginado VIEJO debe seguir leyendo la vista sin error");
  const r = (await cargarDatosTarifario(clienteLocal(TOKEN_SERVICIO) as never, "rel2-315", "1")) as unknown as { ok: boolean };
  assert.equal(r.ok, true, "el cargador público VIEJO completo debe seguir sin error");
  return (pag.ok ? pag.filas : []).map((f) => f.id).filter((id) => Object.values(FILA).includes(id)).sort((a, b) => a - b).join(",");
};

describe("R2-315 · código VIEJO (312608a59) × base con la cadena final 001–326", () => {
  test("S0 procedencia: es el árbol viejo exacto y la base lleva la cadena completa", () => {
    const marca = readFileSync(".release-source-commit", "utf8").trim();
    assert.equal(marca, OLD_COMMIT, "el árbol de ejecución no es el commit viejo declarado");
    assert.equal(existsSync("lib/tarifario/cierresHotel.ts"), false, "el árbol viejo NO debe tener el helper de cierres del bloque nuevo");
    assert.equal(existsSync("supabase/migrations/20260601000315_cierre_general_tarifario.sql"), false, "el árbol viejo NO debe traer la 315");
    assert.equal(num("select count(*) from pg_trigger where tgrelid = 'public.hotel_blackouts'::regclass and tgname like 'tarifario_trg_hotel_blackouts_%'"), 3, "315: 3 disparadores en la base");
    assert.equal(num("select count(*) from pg_proc where proname = 'registrar_abono_moneda'"), 1, "313 presente");
    assert.equal(num("select count(*) from information_schema.tables where table_name in ('recuperaciones_consumidas','registro_b2b_estado','cotizacion_evidencias','cotizacion_pasajeros_aliado')"), 4, "316/324/325 presentes");
  });

  test("S1 antes de cualquier cierre: las tres filas publicadas se ven, por la vista y por el cargador VIEJO", async () => {
    assert.equal(visibles(), `${FILA.dentro},${FILA.fuera},${FILA.otroHotel}`);
    assert.equal(ocultas(), "");
    assert.equal(await idsDelCargador(), `${FILA.dentro},${FILA.fuera},${FILA.otroHotel}`);
  });

  test("S2 el código VIEJO escribe el cierre (sin error): el disparador de la 315 oculta SOLO la fila afectada, no la borra", async () => {
    const r = await crearBlackout({ hotelId: HA, fechaInicio: "2026-12-29", fechaFin: "2027-01-09", total: true, acomodaciones: [], motivo: "Cierre REL-2" });
    assert.deepEqual(r, { ok: true }, "la acción vieja no debe fallar por la 315");
    assert.equal(num(`select count(*) from public.hotel_blackouts where hotel_id = ${HA}`), 1);
    assert.equal(ocultas(), `${FILA.dentro}`, "efecto INTENCIONAL de la 315: la fila cuya ventana toca el cierre queda oculta");
    assert.equal(visibles(), `${FILA.fuera},${FILA.otroHotel}`, "la fila fuera de fechas y la del otro hotel siguen visibles");
    assert.equal(fisicas(), 3, "ocultar no borra: las tres filas siguen físicas");
    assert.equal(sql(`select motivo from public.tarifario_fila_oculta where fila_id = ${FILA.dentro}`), "cierre general del hotel");
    assert.equal(await idsDelCargador(), `${FILA.fuera},${FILA.otroHotel}`, "el cargador VIEJO ya no muestra la fila cerrada y sigue funcionando");
  });

  test("S3 el código VIEJO borra el cierre (sin error): la fila permanece oculta hasta regenerar (comportamiento de la 315, no una regresión del código viejo)", async () => {
    const id = num(`select id from public.hotel_blackouts where hotel_id = ${HA}`);
    const r = await eliminarBlackout(id, HA);
    assert.deepEqual(r, { ok: true });
    assert.equal(num(`select count(*) from public.hotel_blackouts where hotel_id = ${HA}`), 0);
    assert.equal(ocultas(), `${FILA.dentro}`, "la 315 no vuelve a mostrar sola: exige una regeneración verificada que republique la fila");
    assert.equal(visibles(), `${FILA.fuera},${FILA.otroHotel}`);
    assert.equal(fisicas(), 3);
  });
});
