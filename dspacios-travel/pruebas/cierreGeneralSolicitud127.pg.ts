// #127 G2 — a PRICED-UNDER-REQUEST hotel (synthetic rates loaded by an operator) must not sell through a general hotel closure. REAL actions against disposable PostgreSQL over HTTP.
//   crearSolicitudHotel (anonymous visitor) → asignarNetaSolicitud (operator loads the net rate: pricing) → convertirCotizacion (reservation/conversion), with `hotel_blackouts` rows.
// Before the fix `aplicarNetaSolicitud` emptied the closure list: same stay, same data → 0 combos without the request transform, 1 combo with it (Codex probe).
// Fixture/harness pattern of hotelASolicitud270.pg.ts (hotel marked `tarifa_bajo_solicitud`, bloqueo + porción packages, included assistance, 20 % markup).
//   MSYS_NO_PATHCONV=1 sh supabase/scripts/test_pg_local.sh pg127 plantilla127 PG127 pruebas/cierreGeneralSolicitud127.pg.ts
// Hand arithmetic (NETA total 1.200.000 for 2 adults, markup 20 %): hotel 1.200.000 / 0,8 = 1.500.000 = 750.000 p.p.; included assistance 20.000 / 0,8 = 25.000 p.p.;
//   bloqueo flight 400.000 / 0,8 = 500.000 p.p.  → bloqueo total (750.000 + 25.000 + 500.000) × 2 = 2.550.000 · porción total (750.000 + 25.000) × 2 = 1.550.000.
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG127_CONTENEDOR ?? "";
const DB = process.env.PG127_BASE ?? "";
const PGRST = process.env.PG127_POSTGREST ?? "";
const SECRETO = process.env.PG127_JWT_SECRET ?? "";
if (!CT || !DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG127_*: usa supabase/scripts/test_pg_local.sh.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(specifier, context, nextResolve) {
  const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
  try { return nextResolve(specifier, context); } catch (e) {
    if (specifier.startsWith(".") && !/.[a-z]+$/.test(specifier)) { for (const suf of [".ts", "/index.ts"]) { try { return nextResolve(specifier + suf, context); } catch { /* next */ } } }
    throw e;
  }
} });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const UID_SUPER = "00000000-0000-0000-0000-000000127201";
let uidSesion: string | null = UID_SUPER; // null = anonymous visitor of the public tariff
const sidDe = (uid: string) => uid.replace(/^00000000/, "5e550000");
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string } | null) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario ?? null }, error: null });
  return sb;
}
const clienteSesion = () => (uidSesion == null
  ? clienteLocal(jwt({ role: "anon" }), null)
  : clienteLocal(jwt({ role: "authenticated", sub: uidSesion, session_id: sidDe(uidSesion) }), { id: uidSesion, email: `${uidSesion}@x.test` }));
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
const lit = (v: unknown) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const num = (q: string) => Number(sql(q));
async function renombrarTabla(oculta: boolean) {
  sql(oculta ? "alter table public.hotel_blackouts rename to hotel_blackouts_x" : "alter table public.hotel_blackouts_x rename to hotel_blackouts");
  sql("notify pgrst, 'reload schema'");
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${PGRST}/hotel_blackouts?select=id&limit=1`, { headers: { apikey: TOKEN_SERVICIO, authorization: `Bearer ${TOKEN_SERVICIO}` } });
    if ((r.status === 200) === !oculta) return;
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error("PostgREST no actualizó su caché de esquema");
}

mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/cotizacion/acceso", { namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, interno: true, tenant: "mayorista" }), autorizaTenant: () => true } });
mock.module("@/lib/contrato/congelarCondicionesContrato", { namedExports: { componenteHotelReal: async () => null, componentePaqueteReal: async () => null, trmReferenciaAproximada: async () => null, congelarCondicionesContratoBestEffort: async () => {} } });
const { interpretarRespuestaNumeroContrato } = await import("../lib/contrato/numeracionPuro.ts");
mock.module("@/lib/contrato/numeracion", { namedExports: { siguienteNumeroContrato: async (tenant: string) => { const { data, error } = await clienteLocal(TOKEN_SERVICIO).rpc("siguiente_numero_contrato_para_tenant", { p_tenant: tenant }); return interpretarRespuestaNumeroContrato(data, error as never); } } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { crearSolicitudHotel } = await import("../app/tarifario/solicitudHotelActions.ts");
const { asignarNetaSolicitud, convertirCotizacion } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");

const D = 7701, PROV = 7701, S_ASIS = 7701, P1 = 7711, P3 = 7713, H1 = 7721, H3 = 7723, B1 = 7731;
const NETA = 1_200_000;
const PVP = { bloqueo: (750_000 + 25_000 + 500_000) * 2, porcion: (750_000 + 25_000) * 2 };
const PAX = Array.from({ length: 2 }, (_, i) => ({ nombres: `Pax${i + 1}`, apellidos: "Cierre 127", tipoDoc: "CC", numeroDoc: `${7700 + i}`, fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false }));
let docs = 0;
const cliente = () => ({ nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: `1270${++docs}`, telefono: "3000000000", email: `ana127${docs}@example.com` });
type R = { ok: boolean; error?: string; id?: number; numero?: string; codigo?: string };

before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_SUPER}', 'super127s@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_SUPER}', 'super127s@x.test', 'Super 127', 'superadmin', true, 'mayorista') on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into auth.sessions (id, user_id) select ('5e550000' || substr(id::text, 9))::uuid, id from public.usuarios where id = '${UID_SUPER}' on conflict do nothing;
    insert into public.sesion_agencia (session_id, user_id, tenant) select ('5e550000' || substr(id::text, 9))::uuid, id, 'mayorista' from public.usuarios where id = '${UID_SUPER}' on conflict do nothing;
    insert into public.destinos (id, nombre) values (${D}, 'CARTAGENA 127 SOLICITUD') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (${PROV}, 'Proveedor 127 solicitud') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) overriding system value values (${H1}, ${D}, 'Hotel Bloqueo 127 solicitud', ${PROV}, 'COP'), (${H3}, ${D}, 'Hotel Porcion 127 solicitud', ${PROV}, 'COP');
    insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, vuelo_ida, vuelo_regreso, fecha_ida, fecha_regreso, cupos_total, tarifa_para_empaquetar, tarifa_neta, fee_infante, destino_id, moneda) overriding system value
      values (${B1}, 'R127S', 'AVIANCA', 'BOG-CTG', 'AV127', 'AV128', '2030-03-10', '2030-03-13', 80, 400000, 400000, 50000, ${D}, 'COP');
    insert into public.sillas (bloqueo_id, numero_silla) select ${B1}, g from generate_series(1, 80) g;
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo) overriding system value values
      (${P1}, 'Bloqueo 127 solicitud', 'bloqueo', 3, ${D}, 0.2, 'tiquete', 0, '2030-03-01', '2030-03-31', 'COP', 'COP', true),
      (${P3}, 'Porcion 127 solicitud', 'porcion_terrestre', 3, ${D}, 0.2, 'fijo', 0, '2030-05-01', '2030-05-31', 'COP', 'COP', true);
    insert into public.armado_vuelos (paquete_id, bloqueo_id, aplica_mk, ta) values (${P1}, ${B1}, true, 0);
    insert into public.armado_hoteles (paquete_id, hotel_id) values (${P1}, ${H1}), (${P3}, ${H3});
    insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion) values (${S_ASIS}, 'Asistencia 127 solicitud', ${PROV}, ${D}, 0, 'asistencia', 'COP', 'persona', 'paquete');
    insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (771001, ${S_ASIS}, 'ALTA', '2030-01-01', '2030-12-31', 20000);
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (${P1}, ${S_ASIS}, 'persona', true), (${P3}, ${S_ASIS}, 'persona', true);
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (${H1}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (${H3}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
    insert into public.categorias_habitacion (nombre) values ('Estandar'), ('Suite') on conflict do nothing;
    insert into public.planes_alimentacion (codigo, nombre) values ('PC', 'Pension completa') on conflict do nothing;
    insert into public.hotel_categorias (hotel_id, categoria_id) select h, c.id from unnest(array[${H1}, ${H3}]) h, public.categorias_habitacion c where c.nombre in ('Estandar', 'Suite') on conflict do nothing;
    insert into public.hotel_regimenes (hotel_id, plan_id) select h, p.id from unnest(array[${H1}, ${H3}]) h, public.planes_alimentacion p where p.codigo = 'PC' on conflict do nothing;
    update public.hoteles set tarifa_bajo_solicitud = true where id in (${H1}, ${H3});
  `);
});

const foto = () => ({ ventas: sql("select count(*) from public.ventas"), cxp: sql("select count(*) from public.cuentas_por_pagar"), items: sql("select count(*) from public.contrato_items"), sillas: sql("select count(*) from public.sillas where estado <> 'disponible'"), numero: sql("select coalesce(max(substring(numero_contrato from 5)::int), 0) from public.ventas where numero_contrato ~ '^DTM-[0-9]+$'") });
const entradaBloqueo = (extra: Record<string, unknown> = {}) => ({ paqueteId: P1, hotelId: H1, bloqueoId: B1, fechaIda: "2030-03-10", fechaRegreso: "2030-03-13", habitaciones: { doble: 1 }, categoria: "Estandar", regimen: "PC", cliente: cliente(), ...extra });
const entradaPorcion = (extra: Record<string, unknown> = {}) => ({ paqueteId: P3, hotelId: H3, fechaIda: "2030-05-10", fechaRegreso: "2030-05-13", habitaciones: { doble: 1 }, categoria: "Estandar", regimen: "PC", cliente: cliente(), ...extra });
async function solicitud(raw: Record<string, unknown>): Promise<number> {
  uidSesion = null;
  const r = (await crearSolicitudHotel(raw)) as R;
  uidSesion = UID_SUPER;
  assert.equal(r.ok, true, r.error);
  return num(`select id from public.cotizaciones where codigo = ${lit(r.codigo)}`);
}
const cierre = (hotel: number, ini: string, fin: string, extra = "true, null, null") => sql(`insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total, acomodaciones, categorias) values (${hotel}, '${ini}', '${fin}', ${extra})`);
const limpiar = () => sql(`delete from public.hotel_blackouts where hotel_id in (${H1}, ${H3})`);
const estado = (id: number) => sql(`select estado || '|' || round(precio_venta)::text from public.cotizaciones where id = ${id}`);
const valorar = async (id: number) => (await asignarNetaSolicitud(id, NETA)) as R;
const convertir = async (id: number) => (await convertirCotizacion(id, PAX as never, false, "Asesor 127", null, "COP", null)) as R;

describe("#127 G2 · hotel under request: the synthetic rates never remove a general closure", () => {
  test("Q0 baseline without closure: the request is priced at the hand-calculated total and converts to a contract with its seats", async () => {
    const id = await solicitud(entradaBloqueo());
    assert.equal(estado(id), "pendiente_tarifa|0");
    const v = await valorar(id); assert.equal(v.ok, true, v.error);
    assert.equal(estado(id), `abierta|${PVP.bloqueo}`);
    const antes = foto();
    const c = await convertir(id); assert.equal(c.ok, true, c.error);
    assert.equal(num(`select precio_venta from public.ventas where numero_contrato = ${lit(c.numero)}`), PVP.bloqueo);
    assert.equal(num(`select count(*) from public.sillas where numero_contrato = ${lit(c.numero)}`), 2);
    assert.equal(Number(foto().ventas) - Number(antes.ventas), 1);
  });

  test("Q1 PRICING: a total closure over one occupied night rejects the valuation — still pending, no price, no frozen rate row", async () => {
    cierre(H1, "2030-03-11", "2030-03-11");
    const id = await solicitud(entradaBloqueo());
    const r = await valorar(id);
    assert.equal(r.ok, false, "the closed stay must not be priced just because the rates are synthetic");
    assert.equal(estado(id), "pendiente_tarifa|0");
    assert.equal(num(`select count(*) from public.cotizacion_tarifa_solicitud where cotizacion_id = ${id}`), 0);
    limpiar();
  });

  test("Q2 STALE QUOTATION: priced BEFORE the closure, then the hotel closes — conversion is rejected and writes nothing; reopening lets the SAME quotation convert at the SAME price", async () => {
    const id = await solicitud(entradaBloqueo());
    assert.equal((await valorar(id)).ok, true);
    assert.equal(estado(id), `abierta|${PVP.bloqueo}`);
    cierre(H1, "2030-03-10", "2030-03-13");
    const antes = foto();
    const c = await convertir(id);
    assert.equal(c.ok, false, "a priced-under-request quotation must not become a contract through a closed stay");
    assert.deepEqual(foto(), antes, "no contract, CxP, items, seats or contract number consumed");
    assert.equal(estado(id), `abierta|${PVP.bloqueo}`, "the quotation itself is untouched");
    limpiar();
    const ok = await convertir(id); assert.equal(ok.ok, true, ok.error);
    assert.equal(num(`select precio_venta from public.ventas where numero_contrato = ${lit(ok.numero)}`), PVP.bloqueo, "reopening restores the exact frozen price");
  });

  test("Q3 inclusive endpoints and check-out boundary through the under-request path", async () => {
    cierre(H1, "2030-03-13", "2030-03-20"); // starts on the check-out day: not an occupied night
    const a = await solicitud(entradaBloqueo()); assert.equal((await valorar(a)).ok, true, "check-out day is not an occupied night");
    limpiar();
    cierre(H1, "2030-03-01", "2030-03-10"); // ends on the first night (inclusive)
    const b = await solicitud(entradaBloqueo()); assert.equal((await valorar(b)).ok, false, "closure end is inclusive");
    limpiar();
    cierre(H1, "2030-03-01", "2030-03-09");
    const c = await solicitud(entradaBloqueo()); assert.equal((await valorar(c)).ok, true, "closure ended the day before");
    limpiar();
  });

  test("Q4 partial closures: the requested category / accommodation closed → rejected; another category open → priced at the same total", async () => {
    cierre(H1, "2030-03-01", "2030-03-31", "false, null, array['Estandar']");
    const a = await solicitud(entradaBloqueo()); assert.equal((await valorar(a)).ok, false, "the requested category is closed");
    limpiar();
    cierre(H1, "2030-03-01", "2030-03-31", "false, null, array['Suite']");
    const b = await solicitud(entradaBloqueo()); const rb = await valorar(b); assert.equal(rb.ok, true, rb.error); assert.equal(estado(b), `abierta|${PVP.bloqueo}`);
    limpiar();
    cierre(H1, "2030-03-01", "2030-03-31", "false, array['doble'], null");
    const c = await solicitud(entradaBloqueo()); assert.equal((await valorar(c)).ok, false, "the requested double room is closed");
    limpiar();
  });

  test("Q5 READ FAILURE: if the closures cannot be read nothing is priced or converted (fail closed), and the data is untouched", async () => {
    const pendiente = await solicitud(entradaBloqueo());
    const valorada = await solicitud(entradaBloqueo()); assert.equal((await valorar(valorada)).ok, true);
    await renombrarTabla(true);
    try {
      const antes = foto();
      assert.equal((await valorar(pendiente)).ok, false);
      assert.equal(estado(pendiente), "pendiente_tarifa|0");
      assert.equal((await convertir(valorada)).ok, false);
      assert.deepEqual(foto(), antes);
    } finally { await renombrarTabla(false); }
    assert.equal((await convertir(valorada)).ok, true, "once the table is readable again the quotation converts");
    assert.equal((await valorar(pendiente)).ok, true);
  });

  test("Q6 PORCIÓN terrestre under request: closure → valuation rejected, stale priced quotation not convertible; reopening restores the same total", async () => {
    cierre(H3, "2030-05-11", "2030-05-12");
    const bloqueada = await solicitud(entradaPorcion());
    assert.equal((await valorar(bloqueada)).ok, false);
    assert.equal(estado(bloqueada), "pendiente_tarifa|0");
    limpiar();
    const id = await solicitud(entradaPorcion());
    assert.equal((await valorar(id)).ok, true); assert.equal(estado(id), `abierta|${PVP.porcion}`);
    cierre(H3, "2030-05-12", "2030-05-12");
    const antes = foto();
    assert.equal((await convertir(id)).ok, false); assert.deepEqual(foto(), antes);
    limpiar();
    const ok = await convertir(id); assert.equal(ok.ok, true, ok.error);
    assert.equal(num(`select precio_venta from public.ventas where numero_contrato = ${lit(ok.numero)}`), PVP.porcion);
  });

  test("Q7 an unrelated hotel's closure never blocks this one (unaffected prices identical)", async () => {
    cierre(H3, "2030-03-01", "2030-03-31"); // the porción hotel is closed in MARCH: the bloqueo hotel is another hotel
    const id = await solicitud(entradaBloqueo()); const r = await valorar(id);
    assert.equal(r.ok, true, r.error); assert.equal(estado(id), `abierta|${PVP.bloqueo}`);
    limpiar();
  });
});
