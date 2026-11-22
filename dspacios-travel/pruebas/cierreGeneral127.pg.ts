// #127 — general hotel closure (`hotel_blackouts`) vs published tariffs: REAL actions against disposable PostgreSQL over HTTP (PostgREST), nothing about pricing is simulated.
//   generarTarifario → tarifario_resultado / public view → display filter (cargarDatosTarifario) → crearSolicitudReserva (cart) / crearCotizacion → convertirCotizacion(Carrito) → ventas / CxP / sillas,
//   crearBlackout / eliminarBlackout (real server actions, which regenerate), cotizarPorFechas (live porción) and the 315 triggers.
// Only the session (auth.getUser), the contract numbering RPC wrapper and a few unrelated side effects are replaced, exactly like pvpInfanteFijo254.pg.ts.
//
// Owner case reproduced: hotel «Grand Sirenis» stay 2026-12-30 → 2027-01-02 (3 nights), double room, total closure 2026-12-29 → 2027-01-09.
// Hand arithmetic (per person, 3 nights, markup 20 %, flight 200.000 net → 250.000 with markup):
//   Estandar double  100.000 × 3 / 0,8 = 375.000 + 250.000 = 625.000      Suite double  200.000 × 3 / 0,8 = 750.000 + 250.000 = 1.000.000
//   Estandar single  160.000 × 3 / 0,8 = 600.000 + 250.000 = 850.000      Suite single  320.000 × 3 / 0,8 = 1.200.000 + 250.000 = 1.450.000
//   Porción hotel (no flight): ALTA 100.000/night → 375.000 · BAJA 60.000/night (inside the closure) → 225.000
//
// SOLO base LOCAL desechable:  MSYS_NO_PATHCONV=1 sh supabase/scripts/test_pg_local.sh pg127 plantilla127 PG127 pruebas/cierreGeneral127.pg.ts
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG127_CONTENEDOR ?? "pg127";
const DB = process.env.PG127_BASE ?? "";
const PGRST = process.env.PG127_POSTGREST ?? "";
const SECRETO = process.env.PG127_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG127_BASE (desechable), PG127_POSTGREST y PG127_JWT_SECRET: usa supabase/scripts/test_pg_local.sh.");

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
const UID_ADMIN = "00000000-0000-0000-0000-000000127001";
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-127";

// Every PostgREST request is counted by table so the workload per action can be asserted (no per-card fan-out).
const peticiones: string[] = [];
const fetchLocal: typeof fetch = (input, init) => { const u = String(input); peticiones.push(u.replace(PGRST, "").replace(/\?.*$/, "").replace(/^\/(rest\/v1\/)?/, "")); return fetch(u.replace("/rest/v1/", "/"), init); };
const lecturasDe = (tabla: string) => peticiones.filter((p) => p === tabla || p === `rpc/${tabla}`).length;
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
// Catalogue writes (hotel_blackouts) need a LIVE session in auth.sessions: agencia_activa_sesion() / puede_escribir_catalogo_global() (migration 237).
const SESION_ADMIN = "5e127000-0000-0000-0000-000000127001";
const clienteSesion = () => clienteLocal(jwt({ role: "authenticated", sub: UID_ADMIN, session_id: SESION_ADMIN }), { id: UID_ADMIN, email: "admin127@x.test" });
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
}
const num = (q: string) => Number(sql(q));
const lit = (v: unknown) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/cotizacion/acceso", { namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, tenant: "mayorista" }), autorizaTenant: () => true } });
mock.module("@/lib/contrato/congelarCondicionesContrato", { namedExports: { componenteHotelReal: async () => null, componentePaqueteReal: async () => null, trmReferenciaAproximada: async () => null, congelarCondicionesContratoBestEffort: async () => {} } });
const { interpretarRespuestaNumeroContrato } = await import("../lib/contrato/numeracionPuro.ts");
mock.module("@/lib/contrato/numeracion", { namedExports: { siguienteNumeroContrato: async (tenant: string) => { const { data, error } = await clienteLocal(TOKEN_SERVICIO).rpc("siguiente_numero_contrato_para_tenant", { p_tenant: tenant }); return interpretarRespuestaNumeroContrato(data, error as never); } } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[], set: () => undefined };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const { crearBlackout, eliminarBlackout } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/blackouts-actions.ts");
const { crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");
const { crearCotizacion, convertirCotizacion, convertirCotizacionCarrito, cotizarPorFechas } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { cargarDatosTarifario } = await import("../lib/tarifario/datos.ts");
const { filtrarTarifarioVencidas } = await import("../lib/tarifario/vigencia.ts");
const { estadiaCerrada } = await import("../lib/tarifario/cierresHotel.ts");
const { filaCerradaPorCierre } = await import("../lib/tarifario/vigencia.ts");

// ── Semilla (todo sintético, ids 127xx) ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const DEST = 12701, PQ_BLOQ = 12701, PQ_POR = 12702;
const H1 = 12701, H2 = 12702, H3 = 12703; // H1 «Grand Sirenis 127» (the closed hotel) · H2 unaffected, same package · H3 porción hotel
// Flight blocks = the five stays of the matrix. closure under test: 2026-12-29 → 2027-01-09 (inclusive).
const STAYS = {
  A: { bq: 12701, ida: "2026-12-30", reg: "2027-01-02", cerrada: true, nota: "owner case: nights 30, 31, 01" },
  B: { bq: 12702, ida: "2026-12-26", reg: "2026-12-29", cerrada: false, nota: "check-out on the first closed day (nights 26, 27, 28)" },
  C: { bq: 12703, ida: "2027-01-09", reg: "2027-01-12", cerrada: true, nota: "first night is the LAST closed night (inclusive end)" },
  D: { bq: 12704, ida: "2027-01-10", reg: "2027-01-13", cerrada: false, nota: "first night after the closure" },
  E: { bq: 12705, ida: "2026-12-27", reg: "2026-12-30", cerrada: true, nota: "night 29 is the FIRST closed night (inclusive start)" },
} as const;
type Clave = keyof typeof STAYS;
const CLAVES = Object.keys(STAYS) as Clave[];
const PVP = { estandarDoble: 625_000, suiteDoble: 1_000_000, estandarSencilla: 850_000, suiteSencilla: 1_450_000 };

const CLIENTE = { nombres: "Cliente", apellidos: "Cierre 127", numeroDoc: "127000", telefono: "3001234567", email: "cierre127@example.com" };
const PAX2 = [1, 2].map((i) => ({ nombres: `Pax${i}`, apellidos: "Cierre 127", tipoDoc: "CC", numeroDoc: `12700${i}`, fechaNacimiento: "1985-03-04", nacionalidad: "Colombiana", esInfante: false }));

before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin127@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_ADMIN}', 'admin127@x.test', 'Admin 127', 'administracion', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into auth.sessions (id, user_id) values ('${SESION_ADMIN}', '${UID_ADMIN}') on conflict do nothing;
    insert into public.destinos (id, nombre) values (${DEST}, 'CARTAGENA 127') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (12701, 'Proveedor Hotel 127'), (12702, 'Aerolínea 127') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
      values (${H1}, ${DEST}, 'Grand Sirenis 127', 12701, 'COP', 0, 5, 6, 12, 1, 6, true), (${H2}, ${DEST}, 'Hotel Otro 127', 12701, 'COP', 0, 5, 6, 12, 1, 6, true),
             (${H3}, ${DEST}, 'Hotel Porcion 127', 12701, 'COP', 0, 5, 6, 12, 1, 6, true) on conflict do nothing;
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
      select h, a.acomodacion::public.acomodacion_tipo, a.pax_tarifa, a.pax_max, a.adt_min, a.adt_max, a.chd_min, a.chd_max, a.inf_min, a.inf_max from unnest(array[${H1}, ${H2}, ${H3}]) h,
        (values ('doble', 2, 4, 2, 2, 0, 2, 0, 2), ('sencilla', 1, 2, 1, 1, 0, 1, 0, 1)) a(acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) on conflict do nothing;
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
      (${H1}, 'ALTA', '2026-11-25', '2027-03-31', 1, 'tarifa'), (${H2}, 'ALTA', '2026-11-25', '2027-03-31', 1, 'tarifa'), (${H3}, 'ALTA', '2026-11-25', '2027-03-31', 1, 'tarifa'),
      (${H3}, 'BAJA', '2026-12-29', '2027-01-09', 2, 'tarifa');
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante) values
      (${H1}, 'Estandar', 'PAM', 'ALTA', 160000, 100000, 50000, 30000, 40000), (${H1}, 'Suite', 'PAM', 'ALTA', 320000, 200000, 100000, 60000, 80000),
      (${H2}, 'Estandar', 'PAM', 'ALTA', 160000, 100000, 50000, 30000, 40000),
      (${H3}, 'Estandar', 'PAM', 'ALTA', 160000, 100000, 50000, 30000, 40000), (${H3}, 'Estandar', 'PAM', 'BAJA', 96000, 60000, 30000, 18000, 24000);
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo) values
      (${PQ_BLOQ}, 'Bloqueo 127', 'bloqueo', 3, ${DEST}, 0.2, 'fijo', 0, '2026-11-25', '2027-03-31', 'COP', 'COP', true),
      (${PQ_POR}, 'Porcion 127', 'porcion_terrestre', 3, ${DEST}, 0.2, 'fijo', 0, '2026-12-01', '2027-03-31', 'COP', 'COP', true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values
      (${PQ_BLOQ}, ${H1}, array['Estandar','Suite'], array['PAM']), (${PQ_BLOQ}, ${H2}, array['Estandar'], array['PAM']), (${PQ_POR}, ${H3}, array['Estandar'], array['PAM']);
    insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, vuelo_ida, fecha_ida, vuelo_regreso, fecha_regreso, cupos_total, tarifa_para_empaquetar, fee_infante, destino_id, proveedor_id, moneda, origen) values
      ${CLAVES.map((k) => `(${STAYS[k].bq}, 'R127${k}', 'Aerolínea 127', 'BOG - CTG - BOG', 'AV${k}1', '${STAYS[k].ida}', 'AV${k}2', '${STAYS[k].reg}', 10, 200000, 0, ${DEST}, 12702, 'COP', 'BOG')`).join(", ")};
    insert into public.sillas (bloqueo_id, numero_silla, estado) select b, g, 'disponible' from unnest(array[${CLAVES.map((k) => STAYS[k].bq).join(",")}]) b, generate_series(1, 10) g;
    insert into public.armado_vuelos (paquete_id, bloqueo_id, aplica_mk, ta) select ${PQ_BLOQ}, b, true, 0 from unnest(array[${CLAVES.map((k) => STAYS[k].bq).join(",")}]) b;
  `);
});

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const generar = async (pq: number) => { const g = (await generarTarifario(pq)) as { ok?: boolean; error?: string }; assert.equal(g.ok, true, `generarTarifario(${pq}): ${g.error}`); };
/** Published (visible) price of a stay/hotel/category/accommodation, or null when no visible row exists. */
const visible = (pq: number, hotel: number, bq: number | null, cat: string, acom: string): number | null => {
  const v = sql(`select precio_pvp from public.tarifario_resultado_publicable where paquete_id = ${pq} and hotel_id = ${hotel} and ${bq == null ? "bloqueo_id is null" : `bloqueo_id = ${bq}`} and categoria = ${lit(cat)} and acomodacion = ${lit(acom)}`);
  return v === "" ? null : Number(v);
};
/** Row physically present in tarifario_resultado (hidden or not). */
const fisica = (pq: number, hotel: number, bq: number, cat: string, acom: string): number => num(`select count(*) from public.tarifario_resultado where paquete_id = ${pq} and hotel_id = ${hotel} and bloqueo_id = ${bq} and categoria = ${lit(cat)} and acomodacion = ${lit(acom)}`);
const cierre = (ini: string, fin: string, extra = "true, null, null") => sql(`insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total, acomodaciones, categorias) values (${H1}, '${ini}', '${fin}', ${extra}) returning id`);
const borrarCierres = () => sql(`delete from public.hotel_blackouts where hotel_id = ${H1}`);
const cuentas = () => ({
  ventas: num("select count(*) from public.ventas"), cxp: num("select count(*) from public.cuentas_por_pagar"), cot: num("select count(*) from public.cotizaciones"),
  sillas: num("select count(*) from public.sillas where estado <> 'disponible'"), ultimo: sql("select coalesce(max(substring(numero_contrato from 5)::int), 0) from public.ventas where numero_contrato ~ '^DTM-[0-9]+$'"),
});
type Res = { ok: boolean; error?: string; id?: number; numero?: string; numeros?: string[]; cotizacion?: { id: number } };
const itemCarrito = (k: Clave, hotel = H1, cat = "Estandar", hab: Record<string, number> = { doble: 1 }) => ({
  modulo: "bloqueo", paqueteId: PQ_BLOQ, hotelId: hotel, bloqueoId: STAYS[k].bq, hotelNombre: "Grand Sirenis 127", destino: "CARTAGENA 127", categoria: cat, regimen: "PAM", fechaIda: null, fechaRegreso: null,
  noches: 3, habitaciones: hab, ninos: 0, ninos2: 0, infantes: 0, pax: Object.entries(hab).reduce((s, [a, n]) => s + n * (a === "doble" ? 2 : 1), 0), precio: 1, edadesMenores: [], cantidadMenores: 0,
});
const carrito = async (k: Clave, hotel = H1, cat = "Estandar", hab: Record<string, number> = { doble: 1 }) =>
  (await crearSolicitudReserva({ items: [itemCarrito(k, hotel, cat, hab)], tours: [], hotelDeTour: [], cliente: CLIENTE } as never)) as unknown as Res;
const convertirCarrito = async (id: number, pax = PAX2) =>
  (await convertirCotizacionCarrito(id, { agrupar: "todo", pasajeros: pax, asesorInterno: "Asesor 127", asignaciones: [pax.map((_, i) => i + 1)], asignacionesTours: [], monedaCobro: "COP" } as never)) as unknown as Res;
const inputDirecto = (k: Clave, hotel = H1, cat = "Estandar", hab: Record<string, number> = { doble: 1 }) => ({
  paqueteId: PQ_BLOQ, bloqueoId: STAYS[k].bq, salidaId: null, modulo: "bloqueo", hotelId: hotel, fechaIda: null, fechaRegreso: null, categoria: cat, regimen: "PAM", habitaciones: hab,
  ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [], cantidadMenores: 0, cliente: { ...CLIENTE, tipoDoc: "CC" }, tipoAsesor: "interno", asesorInterno: "Asesor 127", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: PAX2, servicios: [],
});
const cotizar = async (k: Clave, hotel = H1, cat = "Estandar", hab: Record<string, number> = { doble: 1 }) => (await crearCotizacion(inputDirecto(k, hotel, cat, hab) as never)) as unknown as Res;
/** Rename the closure table away/back and wait until PostgREST agrees (its schema cache reloads asynchronously after DDL). */
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
const CERRADO = /cierre de ventas vigente/;
// After a REGENERATION the closed row no longer exists, so the sale reports a missing tariff instead of the closure message: both are a correct rejection.
const NO_VENDIBLE = /cierre de ventas vigente|No se encontró la tarifa/;

describe("#127 · reproduction: a general closure the published tariff never heard of (owner case, before any fix is exercised)", () => {
  test("R0 baseline: every stay of both hotels is published at the hand-calculated price (flight 250.000 + hotel)", async () => {
    await generar(PQ_BLOQ);
    for (const k of CLAVES) {
      assert.equal(visible(PQ_BLOQ, H1, STAYS[k].bq, "Estandar", "doble"), PVP.estandarDoble, `H1 Estandar doble ${k}`);
      assert.equal(visible(PQ_BLOQ, H1, STAYS[k].bq, "Suite", "doble"), PVP.suiteDoble, `H1 Suite doble ${k}`);
      assert.equal(visible(PQ_BLOQ, H1, STAYS[k].bq, "Estandar", "sencilla"), PVP.estandarSencilla, `H1 Estandar sencilla ${k}`);
      assert.equal(visible(PQ_BLOQ, H1, STAYS[k].bq, "Suite", "sencilla"), PVP.suiteSencilla, `H1 Suite sencilla ${k}`);
      assert.equal(visible(PQ_BLOQ, H2, STAYS[k].bq, "Estandar", "doble"), PVP.estandarDoble, `H2 ${k}`);
    }
  });

  test("R1 a quotation opened BEFORE the closure exists (cart/quote of the owner stay A) — it is valid now", async () => {
    const r = await carrito("A");
    assert.equal(r.ok, true, r.error);
    cotizacionAbiertaAntes.carrito = r.cotizacion!.id;
    const q = await cotizar("A");
    assert.equal(q.ok, true, q.error);
    cotizacionAbiertaAntes.directa = (q as { id?: number }).id ?? num("select max(id) from public.cotizaciones");
  });

  test("R2 the closure is saved with the pre-fix path (direct insert, no regeneration, no 315): the stale owner row is STILL published and visible — the defect", () => {
    cierre("2026-12-29", "2027-01-09");
    assert.equal(visible(PQ_BLOQ, H1, STAYS.A.bq, "Estandar", "doble"), PVP.estandarDoble, "the closed owner stay is still visible in the published view");
  });
});
const cotizacionAbiertaAntes: { carrito: number; directa: number } = { carrito: 0, directa: 0 };

describe("#127 · stale published rows: every consumer rejects/hides the closed stay (no regeneration happened)", () => {
  test("S1 display (cargarDatosTarifario → Vista Booking / table / summary source): closed stays of the closed hotel are hidden, the rest stays, other hotel untouched", async () => {
    const d = await cargarDatosTarifario(clienteSesion() as never, "test127", "s1", clienteLocal(TOKEN_SERVICIO) as never);
    assert.equal(d.ok, true);
    if (!d.ok) return;
    const filas = d.datos.filasVisibles.filter((f) => f.paquete_id === PQ_BLOQ);
    const por = (hotel: number, k: Clave) => filas.filter((f) => f.hotel_id === hotel && f.bloqueo_id === STAYS[k].bq).length;
    for (const k of CLAVES) {
      assert.equal(por(H1, k) > 0, !STAYS[k].cerrada, `H1 stay ${k} (${STAYS[k].nota}) visible=${!STAYS[k].cerrada}`);
      assert.equal(por(H2, k) > 0, true, `H2 stay ${k} is unaffected`);
    }
  });

  test("S2 cart/quotation for the owner stay is rejected with the closure message and creates nothing; the open stays still quote at the unchanged price", async () => {
    const antes = cuentas();
    const r = await carrito("A");
    assert.equal(r.ok, false);
    assert.match(String(r.error), CERRADO);
    const q = await cotizar("A");
    assert.equal(q.ok, false);
    assert.match(String(q.error), CERRADO);
    assert.deepEqual(cuentas(), antes, "nothing persisted by the rejected attempts");
    for (const k of ["B", "D"] as Clave[]) {
      const ok = await carrito(k);
      assert.equal(ok.ok, true, `${k}: ${ok.error}`);
      const precio = num(`select precio_venta from public.cotizaciones where id = ${ok.cotizacion!.id}`);
      assert.equal(precio, PVP.estandarDoble * 2, `${k}: 2 adults × 625.000, price unchanged by the closure of another stay`);
    }
  });

  test("S3 boundaries through the real sales path: A, C and E are rejected (any occupied night, both endpoints inclusive); B (check-out on the first closed day) and D sell", async () => {
    for (const k of CLAVES) {
      const r = await carrito(k);
      assert.equal(r.ok, !STAYS[k].cerrada, `${k} ${STAYS[k].nota}: ${r.error}`);
      if (STAYS[k].cerrada) assert.match(String(r.error), CERRADO);
    }
  });

  test("S4 cart opened BEFORE the closure: converting the quotation of the owner stay is rejected and nothing is created (no contract, CxP, seat, or number)", async () => {
    const antes = cuentas();
    const c1 = await convertirCarrito(cotizacionAbiertaAntes.carrito);
    assert.equal(c1.ok, false, "cart conversion must refuse the now-closed stay");
    assert.match(String(c1.error), CERRADO);
    const c2 = (await convertirCotizacion(cotizacionAbiertaAntes.directa, PAX2 as never, false, "Asesor 127", null, "COP", null)) as Res;
    assert.equal(c2.ok, false, "direct conversion must refuse the now-closed stay");
    assert.match(String(c2.error), CERRADO);
    assert.deepEqual(cuentas(), antes);
  });

  test("S5 a cart opened before the closure for an UNAFFECTED stay (D) still converts to a contract at the original price, with its seats and unchanged costs", async () => {
    const r = await carrito("D");
    assert.equal(r.ok, true, r.error);
    const antes = cuentas();
    const c = await convertirCarrito(r.cotizacion!.id);
    assert.equal(c.ok, true, c.error);
    const n = c.numeros![0];
    assert.equal(num(`select precio_venta from public.ventas where numero_contrato = ${lit(n)}`), PVP.estandarDoble * 2);
    assert.equal(cuentas().ventas - antes.ventas, 1);
    assert.equal(cuentas().sillas - antes.sillas, 2);
    // Provider payables are only PLANNED until the contract is confirmed (migration 288): the persisted contract costs are the preserved facts here.
    assert.deepEqual(sql(`select costo_aereo || '/' || costo_hotel from public.ventas where numero_contrato = ${lit(n)}`), "400000.00/600000.00", "flight 2 × 200.000 and hotel 2 × 100.000 × 3 nights, unchanged by the closure of other stays");
  });

  test("S6 the display filter alone (published rows → filtrarTarifarioVencidas) hides exactly the closed rows, one closure read for the whole set", async () => {
    const filas = JSON.parse(sql(`select coalesce(json_agg(row_to_json(t)), '[]') from (select modulo, hotel_id, categoria, regimen, acomodacion, fecha_ida, fecha_regreso, noches, bloqueo_id from public.tarifario_resultado_publicable where paquete_id = ${PQ_BLOQ}) t`)) as Record<string, unknown>[];
    const antes = lecturasDe("hotel_blackouts");
    const r = await filtrarTarifarioVencidas(clienteLocal(TOKEN_SERVICIO) as never, filas as never);
    assert.equal(r.error, null);
    assert.equal(lecturasDe("hotel_blackouts") - antes, 2, "ONE closure read (+ the empty page that ends pagination) for all hotels/rows");
    const sobreviven = (r.filas as unknown as Record<string, unknown>[]);
    for (const f of filas) {
      const k = CLAVES.find((x) => STAYS[x].bq === f.bloqueo_id)!;
      const esperadaOculta = f.hotel_id === H1 && STAYS[k].cerrada;
      assert.equal(sobreviven.includes(f), !esperadaOculta, `H${f.hotel_id === H1 ? 1 : 2} ${k} ${String(f.categoria)}/${String(f.acomodacion)}`);
    }
  });
});

describe("#127 · generation itself respects the closure (not just a cache refresh)", () => {
  test("G1 regenerating removes the closed rows physically (generation does not publish them) and leaves every other price byte-for-byte identical", async () => {
    const antes: Record<string, number | null> = {};
    for (const k of CLAVES) for (const h of [H1, H2]) antes[`${h}${k}`] = visible(PQ_BLOQ, h, STAYS[k].bq, "Estandar", "doble");
    await generar(PQ_BLOQ);
    for (const k of CLAVES) {
      for (const acom of ["doble", "sencilla"]) for (const cat of ["Estandar", "Suite"]) {
        assert.equal(fisica(PQ_BLOQ, H1, STAYS[k].bq, cat, acom), STAYS[k].cerrada ? 0 : 1, `H1 ${k} ${cat}/${acom} physical rows`);
      }
      assert.equal(fisica(PQ_BLOQ, H1, STAYS[k].bq, "Estandar", "nino"), STAYS[k].cerrada ? 0 : 1, `children classes follow the stay too (${k})`);
      assert.equal(fisica(PQ_BLOQ, H1, STAYS[k].bq, "Estandar", "infante"), STAYS[k].cerrada ? 0 : 1, `synthetic infante row follows the stay too (${k})`);
      assert.equal(visible(PQ_BLOQ, H2, STAYS[k].bq, "Estandar", "doble"), antes[`${H2}${k}`], `unaffected hotel ${k} unchanged`);
      if (!STAYS[k].cerrada) assert.equal(visible(PQ_BLOQ, H1, STAYS[k].bq, "Estandar", "doble"), PVP.estandarDoble, `open stay ${k}: same price (hotel + flight)`);
    }
  });

  test("G2 generation fails CLOSED when the closure table cannot be read: ok:false, never «no closures»", async () => {
    await renombrarTabla(true);
    try {
      const g = (await generarTarifario(PQ_BLOQ)) as { ok?: boolean; error?: string };
      assert.equal(g.ok, false, "must not publish when closures are unknown");
    } finally { await renombrarTabla(false); }
  });
});

describe("#127 · failures of the closure read fail closed at every consumer", () => {
  test("F1 sales (cart + direct quote), display filter and display loader all refuse instead of assuming no closures", async () => {
    borrarCierres(); await generar(PQ_BLOQ);
    await renombrarTabla(true);
    try {
      const antes = cuentas();
      const c = await carrito("B"); assert.equal(c.ok, false); assert.match(String(c.error), /No se pudo validar la disponibilidad/);
      const q = await cotizar("B"); assert.equal(q.ok, false); assert.match(String(q.error), /No se pudo validar la disponibilidad/);
      assert.deepEqual(cuentas(), antes);
      const d = await cargarDatosTarifario(clienteSesion() as never, "test127", "f1", clienteLocal(TOKEN_SERVICIO) as never);
      if (d.ok) assert.equal(d.datos.filasVisibles.filter((f) => f.paquete_id === PQ_BLOQ && f.hotel_id === H1).length, 0, "hotel rows hidden when closures are unknown");
    } finally { await renombrarTabla(false); }
    const ok = await carrito("B"); assert.equal(ok.ok, true, ok.error);
  });
});

describe("#127 · real server actions: saving / reopening a closure regenerates the tariffs", () => {
  test("A1 crearBlackout (real action) publishes nothing stale: closed rows disappear, open ones keep the price; eliminarBlackout brings the owner stay back at 625.000", async () => {
    const r = await crearBlackout({ hotelId: H1, fechaInicio: "2026-12-29", fechaFin: "2027-01-09", total: true, acomodaciones: [], categorias: [], motivo: "cierre 127" });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    for (const k of CLAVES) assert.equal(visible(PQ_BLOQ, H1, STAYS[k].bq, "Estandar", "doble"), STAYS[k].cerrada ? null : PVP.estandarDoble, `after save ${k}`);
    assert.equal(visible(PQ_BLOQ, H2, STAYS.A.bq, "Estandar", "doble"), PVP.estandarDoble, "other hotel of the same package is untouched");
    const id = num(`select id from public.hotel_blackouts where hotel_id = ${H1} and motivo = 'cierre 127'`);
    const e = await eliminarBlackout(id, H1);
    assert.equal(e.ok, true, e.ok ? "" : e.error);
    for (const k of CLAVES) assert.equal(visible(PQ_BLOQ, H1, STAYS[k].bq, "Estandar", "doble"), PVP.estandarDoble, `after reopening ${k}`);
    const ok = await carrito("A"); assert.equal(ok.ok, true, `owner stay sells again after reopening: ${ok.error}`);
  });
});

describe("#127 · partial closures: category / accommodation, through generation and sales", () => {
  test("P1 category closure (Suite only): Suite rows of closed stays vanish, Estandar stays; sales of Suite rejected, Estandar accepted", async () => {
    borrarCierres();
    cierre("2026-12-29", "2027-01-09", "false, null, array['Suite']"); await generar(PQ_BLOQ);
    assert.equal(visible(PQ_BLOQ, H1, STAYS.A.bq, "Suite", "doble"), null);
    assert.equal(visible(PQ_BLOQ, H1, STAYS.A.bq, "Estandar", "doble"), PVP.estandarDoble);
    assert.equal(visible(PQ_BLOQ, H1, STAYS.B.bq, "Suite", "doble"), PVP.suiteDoble, "open stay keeps the Suite");
    const s = await carrito("A", H1, "Suite"); assert.equal(s.ok, false); assert.match(String(s.error), NO_VENDIBLE);
    const e = await carrito("A", H1, "Estandar"); assert.equal(e.ok, true, e.error);
  });
  test("P2 accommodation closure (doble only, every category): doble rows vanish, sencilla stays; a double-room sale is rejected, a single-room sale accepted", async () => {
    borrarCierres();
    cierre("2026-12-29", "2027-01-09", "false, array['doble'], null"); await generar(PQ_BLOQ);
    assert.equal(visible(PQ_BLOQ, H1, STAYS.A.bq, "Estandar", "doble"), null);
    assert.equal(visible(PQ_BLOQ, H1, STAYS.A.bq, "Suite", "doble"), null);
    assert.equal(visible(PQ_BLOQ, H1, STAYS.A.bq, "Estandar", "sencilla"), PVP.estandarSencilla);
    const d = await carrito("A", H1, "Estandar", { doble: 1 }); assert.equal(d.ok, false); assert.match(String(d.error), NO_VENDIBLE);
    const s = await carrito("A", H1, "Estandar", { sencilla: 1 }); assert.equal(s.ok, true, s.error);
    const mixta = await carrito("A", H1, "Estandar", { doble: 1, sencilla: 1 });
    assert.equal(mixta.ok, false, "a closed room is never silently dropped from a mixed request");
  });
  test("P3 intersection (Suite + doble): only Suite/doble is closed", async () => {
    borrarCierres();
    cierre("2026-12-29", "2027-01-09", "false, array['doble'], array['Suite']"); await generar(PQ_BLOQ);
    assert.equal(visible(PQ_BLOQ, H1, STAYS.A.bq, "Suite", "doble"), null);
    assert.equal(visible(PQ_BLOQ, H1, STAYS.A.bq, "Suite", "sencilla"), PVP.suiteSencilla);
    assert.equal(visible(PQ_BLOQ, H1, STAYS.A.bq, "Estandar", "doble"), PVP.estandarDoble);
  });
  test("P4 stale partial closure (no regeneration): sales reject the closed accommodation, the display hides only its row", async () => {
    borrarCierres(); await generar(PQ_BLOQ);
    cierre("2026-12-29", "2027-01-09", "false, array['doble'], array['Suite']");
    const d = await carrito("A", H1, "Suite", { doble: 1 }); assert.equal(d.ok, false); assert.match(String(d.error), CERRADO);
    const s = await carrito("A", H1, "Suite", { sencilla: 1 }); assert.equal(s.ok, true, s.error);
    const datos = await cargarDatosTarifario(clienteSesion() as never, "test127", "p4", clienteLocal(TOKEN_SERVICIO) as never);
    assert.equal(datos.ok, true);
    if (!datos.ok) return;
    const a = datos.datos.filasVisibles.filter((f) => f.paquete_id === PQ_BLOQ && f.hotel_id === H1 && f.bloqueo_id === STAYS.A.bq && f.categoria === "Suite");
    assert.equal(a.some((f) => f.acomodacion === "doble"), false, "Suite/doble hidden");
    assert.equal(a.some((f) => f.acomodacion === "sencilla"), true, "Suite/sencilla still shown");
    borrarCierres(); await generar(PQ_BLOQ);
  });
});

describe("#127 · porción terrestre («from» window + live search)", () => {
  const desde = () => num(`select min(precio_pvp) from public.tarifario_resultado_publicable where paquete_id = ${PQ_POR} and hotel_id = ${H3} and acomodacion = 'doble'`);
  test("T1 baseline: the «desde» is the cheapest entry (BAJA 60.000/night × 3 / 0,8 = 225.000)", async () => {
    await generar(PQ_POR);
    assert.equal(desde(), 225_000);
  });
  test("T2 with the closure covering the BAJA season, regeneration excludes those entries: «desde» becomes the ALTA price 375.000 (not the unsellable 225.000)", async () => {
    sql(`insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total) values (${H3}, '2026-12-29', '2027-01-09', true)`);
    await generar(PQ_POR);
    assert.equal(desde(), 375_000);
  });
  test("T3 live search by dates: a stay inside the closure returns no offer, boundaries as before, an outside stay prices from the normal season", async () => {
    const buscar = async (ida: string, reg: string) => (await cotizarPorFechas({ paqueteId: PQ_POR, hotelId: H3, fechaIda: ida, fechaRegreso: reg } as never)) as unknown as { ok: boolean; combos?: { categoria: string; precios: Record<string, number> }[]; error?: string };
    const dentro = await buscar("2026-12-30", "2027-01-02");
    assert.ok(!dentro.ok || (dentro.combos ?? []).length === 0, `inside the closure: ${JSON.stringify(dentro).slice(0, 160)}`);
    const salida = await buscar("2026-12-26", "2026-12-29");
    assert.equal(salida.ok, true, salida.error); assert.equal(salida.combos?.[0]?.precios?.doble, 375_000, "check-out on the first closed day sells");
    const despues = await buscar("2027-01-10", "2027-01-13");
    assert.equal(despues.ok, true, despues.error); assert.equal(despues.combos?.[0]?.precios?.doble, 375_000);
  });
  test("T4 porción cart for a closed stay is rejected by the live path, an open stay is accepted", async () => {
    const item = (ida: string, reg: string) => ({ modulo: "porcion_terrestre", paqueteId: PQ_POR, hotelId: H3, bloqueoId: null, hotelNombre: "Hotel Porcion 127", destino: "CARTAGENA 127", categoria: "Estandar", regimen: "PAM", fechaIda: ida, fechaRegreso: reg, noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0 });
    const r = async (ida: string, reg: string) => (await crearSolicitudReserva({ items: [item(ida, reg)], tours: [], hotelDeTour: [], cliente: CLIENTE } as never)) as unknown as Res;
    assert.equal((await r("2026-12-30", "2027-01-02")).ok, false);
    assert.equal((await r("2027-01-10", "2027-01-13")).ok, true);
  });
  test("T5 stale «desde» row (closure saved after publishing, no regeneration): the display filter hides it only when NO entry of the window is sellable", async () => {
    sql(`delete from public.hotel_blackouts where hotel_id = ${H3}`); await generar(PQ_POR);
    sql(`insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total) values (${H3}, '2026-12-01', '2027-03-31', true)`);
    const filas = JSON.parse(sql(`select coalesce(json_agg(row_to_json(t)), '[]') from (select modulo, hotel_id, categoria, regimen, acomodacion, fecha_ida, fecha_regreso, noches, desde_entrada from public.tarifario_resultado_publicable where paquete_id = ${PQ_POR}) t`)) as Record<string, unknown>[];
    assert.ok(filas.length > 0);
    const r = await filtrarTarifarioVencidas(clienteLocal(TOKEN_SERVICIO) as never, filas as never);
    assert.equal(r.filas.length, 0, "the whole window is closed → no sellable entry → hidden");
    sql(`delete from public.hotel_blackouts where hotel_id = ${H3}`);
  });
});

describe("#127 G1 · porción «from» price provenance: an open date somewhere in the window does NOT prove the old published price is still attainable", () => {
  // Window 2026-12-01 → 2027-03-31, 3 nights. ALTA 100.000/night → 375.000; BAJA 60.000/night (entries 29-Dec → 09-Jan) → 225.000. The closure closes ONLY the BAJA nights: plenty of ALTA entries stay open.
  const publico = () => num(`select coalesce(min(precio_pvp), 0) from public.tarifario_resultado_publicable where paquete_id = ${PQ_POR} and hotel_id = ${H3} and acomodacion = 'doble'`);
  const testigo = () => sql(`select coalesce(string_agg(distinct desde_entrada::text, ','), '') from public.tarifario_resultado where paquete_id = ${PQ_POR} and hotel_id = ${H3} and acomodacion = 'doble'`);
  const filtro = async () => {
    const d = await cargarDatosTarifario(clienteSesion() as never, "test127", "g1", clienteLocal(TOKEN_SERVICIO) as never);
    assert.equal(d.ok, true);
    return d.ok ? d.datos.filasVisibles.filter((f) => f.paquete_id === PQ_POR && f.hotel_id === H3 && f.acomodacion === "doble").map((f) => Number(f.precio_pvp)) : [];
  };
  const cierreBaja = () => sql(`insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total) values (${H3}, '2026-12-29', '2027-01-09', true)`);
  const limpiarH3 = () => sql(`delete from public.hotel_blackouts where hotel_id = ${H3}`);
  const romperRegeneracion = (romper: boolean) => sql(romper ? "revoke execute on function public.iniciar_generacion_tarifario(bigint) from authenticated" : "grant execute on function public.iniciar_generacion_tarifario(bigint) to authenticated");

  test("G1-0 baseline: no closure → 225.000 «from», no witness (nothing changes for a hotel without closures)", async () => {
    limpiarH3(); await generar(PQ_POR);
    assert.equal(publico(), 225_000); assert.equal(testigo(), "");
    assert.deepEqual(await filtro(), [225_000]);
  });
  test("G1-1 PARTIAL-window closure + NO regeneration: the stale 225.000 row is NOT shown anywhere (it was shown before this correction)", async () => {
    cierreBaja();
    assert.equal(publico(), 225_000, "the row is still physically published (no 315 yet): the display layer must hide it");
    assert.deepEqual(await filtro(), [], "no stale price survives in the display loader");
  });
  test("G1-2 FAILED regeneration (package cannot publish) keeps it hidden — fail closed", async () => {
    romperRegeneracion(true);
    try { const g = (await generarTarifario(PQ_POR)) as { ok?: boolean }; assert.equal(g.ok, false, "regeneration must fail in this scenario"); }
    finally { romperRegeneracion(false); }
    assert.equal(publico(), 225_000, "the old physical row is still there after the failed attempt");
    assert.deepEqual(await filtro(), []);
  });
  test("G1-3 VERIFIED regeneration under the closure: the price becomes 375.000 and carries its SELLABLE WITNESS (earliest entry that reproduces it); it is visible", async () => {
    await generar(PQ_POR);
    assert.equal(publico(), 375_000);
    assert.equal(testigo(), "2026-12-01", "witness = 01-Dec (ALTA 100.000 × 3 / 0,8): sellable, outside the closure");
    assert.deepEqual(await filtro(), [375_000]);
    // the witness must be real: the SAME price, quoted by the authoritative live search for that stay
    const r = (await cotizarPorFechas({ paqueteId: PQ_POR, hotelId: H3, fechaIda: "2026-12-01", fechaRegreso: "2026-12-04" } as never)) as { ok: boolean; combos?: { precios: Record<string, number> }[] };
    assert.equal(r.ok, true); assert.equal(r.combos?.[0]?.precios?.doble, 375_000);
  });
  test("G1-4 REOPENING without regeneration: the witnessed 375.000 row stays attainable and visible; regenerating restores the true 225.000 (no witness needed again)", async () => {
    limpiarH3();
    assert.deepEqual(await filtro(), [375_000], "the witness stay is still sellable: the row is safe (just higher than the true minimum)");
    await generar(PQ_POR);
    assert.equal(publico(), 225_000); assert.equal(testigo(), "");
    assert.deepEqual(await filtro(), [225_000]);
  });
  test("G1-5 UNAFFECTED prices: a closure outside the window, on another category, or on another hotel leaves the row, the price and the (absent) witness exactly as they were", async () => {
    for (const [hotel, ini, fin, extra] of [[H3, "2027-04-10", "2027-04-20", "true, null, null"], [H3, "2026-12-29", "2027-01-09", "false, null, array['Suite']"], [H1, "2026-12-29", "2027-01-09", "true, null, null"]] as const) {
      sql(`insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total, acomodaciones, categorias) values (${hotel}, '${ini}', '${fin}', ${extra})`);
      assert.deepEqual(await filtro(), [225_000], `display unaffected by ${hotel}/${ini}/${extra}`);
      await generar(PQ_POR);
      assert.equal(publico(), 225_000); assert.equal(testigo(), "");
      sql(`delete from public.hotel_blackouts where hotel_id = ${hotel}`);
    }
    await generar(PQ_BLOQ); // the closure of H1 above must not leave the bloqueo package with stale state for later suites
  });
  test("G1-6 a closure that covers EVERY sellable entry: the generation reports there is nothing to publish and the old row is NOT advertised; reopening restores it", async () => {
    sql(`insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total) values (${H3}, '2026-11-01', '2027-12-31', true)`);
    const g = (await generarTarifario(PQ_POR)) as { ok?: boolean; error?: string };
    assert.equal(g.ok, false); assert.match(String(g.error), /No se generaron tarifas/);
    assert.deepEqual(await filtro(), [], "the previous 225.000 row is still physically published but the display layer refuses it (touched, no witness)");
    limpiarH3(); await generar(PQ_POR);
    assert.equal(publico(), 225_000); assert.deepEqual(await filtro(), [225_000]);
  });
});

describe("#127 · migration 315: the database hides closed rows the moment a closure is saved", () => {
  before(() => {
    borrarCierres();
    sql(readFileSync(new URL("../supabase/migrations/20260601000315_tarifario_oculta_por_cierre_general.sql", import.meta.url), "utf8"));
  });
  test("M0 the 315 is idempotent (re-applying changes nothing) and its functions are not callable by app roles", () => {
    sql(readFileSync(new URL("../supabase/migrations/20260601000315_tarifario_oculta_por_cierre_general.sql", import.meta.url), "utf8"));
    assert.equal(num("select count(*) from pg_trigger where tgname like 'tarifario_trg_hotel_blackouts_%'"), 3);
    assert.equal(num(`select count(*) from pg_proc p where proname in ('tarifario_estadia_cerrada_general','tarifario_fila_cerrada_general','tarifario_cierre_general_aplicar') and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))`), 0);
  });
  test("M1 INSERT of a total closure (plain SQL, NO regeneration): the owner rows are hidden from the public view immediately; other stays/hotels stay visible; the package is marked pending", async () => {
    await generar(PQ_BLOQ);
    for (const k of CLAVES) assert.equal(visible(PQ_BLOQ, H1, STAYS[k].bq, "Estandar", "doble"), PVP.estandarDoble);
    cierre("2026-12-29", "2027-01-09");
    for (const k of CLAVES) {
      assert.equal(visible(PQ_BLOQ, H1, STAYS[k].bq, "Estandar", "doble"), STAYS[k].cerrada ? null : PVP.estandarDoble, `H1 ${k} ${STAYS[k].nota}`);
      assert.equal(visible(PQ_BLOQ, H2, STAYS[k].bq, "Estandar", "doble"), PVP.estandarDoble, `H2 ${k}`);
    }
    assert.equal(sql(`select tarifario_estado from public.armado_paquetes where id = ${PQ_BLOQ}`), "pendiente");
    assert.ok(num("select count(*) from public.tarifario_fila_oculta where motivo = 'cierre general del hotel'") > 0);
  });
  test("M2 the trigger and the application rule agree on every stay / category / accommodation (SQL function vs estadiaCerrada, 7 closure shapes)", () => {
    const formas: { ini: string; fin: string; sqlExtra: string; ts: { total: boolean; acomodaciones: string[] | null; categorias: string[] | null } }[] = [
      { ini: "2026-12-29", fin: "2027-01-09", sqlExtra: "true, null, null", ts: { total: true, acomodaciones: null, categorias: null } },
      { ini: "2026-12-29", fin: "2027-01-09", sqlExtra: "false, null, array['Suite']", ts: { total: false, acomodaciones: null, categorias: ["Suite"] } },
      { ini: "2026-12-29", fin: "2027-01-09", sqlExtra: "false, array['doble'], null", ts: { total: false, acomodaciones: ["doble"], categorias: null } },
      { ini: "2026-12-29", fin: "2027-01-09", sqlExtra: "false, array['doble','nino'], array['Suite']", ts: { total: false, acomodaciones: ["doble", "nino"], categorias: ["Suite"] } },
      { ini: "2026-12-31", fin: "2026-12-31", sqlExtra: "true, null, null", ts: { total: true, acomodaciones: null, categorias: null } },
      { ini: "2026-12-29", fin: "2027-01-09", sqlExtra: "false, array[]::text[], array[]::text[]", ts: { total: false, acomodaciones: [], categorias: [] } },
      { ini: "2026-12-29", fin: "2027-01-09", sqlExtra: "false, null, null", ts: { total: false, acomodaciones: null, categorias: null } },
    ];
    const idas = ["2026-12-26", "2026-12-27", "2026-12-28", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-08", "2027-01-09", "2027-01-10"];
    const ventanas = [["2026-12-30", "2027-01-05"], ["2026-12-26", "2026-12-26"], ["2026-12-01", "2027-03-31"], ["2027-01-10", "2027-01-20"], ["2026-12-28", "2026-12-28"]] as const;
    let comparados = 0;
    for (const f of formas) {
      const cierres = [{ fecha_inicio: f.ini, fecha_fin: f.fin, ...f.ts }];
      // ONE database round trip per closure shape: rows inserted with triggers disabled (this test compares the predicate, not the hiding) and every case evaluated in SQL.
      const salida = sql(`
        set session_replication_role = replica;
        delete from public.hotel_blackouts where hotel_id = ${H1};
        insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total, acomodaciones, categorias) values (${H1}, '${f.ini}', '${f.fin}', ${f.sqlExtra});
        select 'E|' || i || '|' || n || '|' || c || '|' || a || '|' || public.tarifario_estadia_cerrada_general(${H1}, c, a, i::date, n)
          from unnest(array[${idas.map((x) => "'" + x + "'").join(",")}]) i, unnest(array[1,2,3,5]) n, unnest(array['Estandar','Suite']) c, unnest(array['sencilla','doble','nino','infante']) a;
        select 'V|' || v.d || '|' || v.h || '|' || public.tarifario_fila_cerrada_general(${H1}, 'Suite', 'doble', 'porcion_terrestre', v.d::date, v.h::date, 3, null)
          from (values ${ventanas.map(([d, h]) => "('" + d + "', '" + h + "')").join(",")}) v(d, h);
        delete from public.hotel_blackouts where hotel_id = ${H1};`);
      for (const linea of salida.split("\n").filter(Boolean)) {
        const [tipo, ...r] = linea.split("|");
        if (tipo === "E") {
          const [ida, noches, cat, acom, resultado] = r;
          assert.equal(resultado === "true", estadiaCerrada(cierres, cat, acom, ida, Number(noches)), `${f.sqlExtra} ${ida} ${noches}n ${cat}/${acom}`);
        } else {
          const [d, h, resultado] = r;
          assert.equal(resultado === "true", filaCerradaPorCierre({ modulo: "porcion_terrestre", hotel_id: H1, categoria: "Suite", acomodacion: "doble", fecha_ida: d, fecha_regreso: h, noches: 3 }, cierres), `window ${d}..${h} ${f.sqlExtra}`);
        }
        comparados++;
      }
    }
    assert.equal(comparados, formas.length * (idas.length * 4 * 2 * 4 + ventanas.length));
    assert.ok(comparados > 2000, `${comparados} comparisons`);
  });
  test("M3 UPDATE widening a closure hides the newly closed stay (D) immediately; DELETE (reopen) keeps rows hidden (fail closed) until regeneration restores them", async () => {
    borrarCierres(); await generar(PQ_BLOQ);
    const id = cierre("2026-12-29", "2027-01-09");
    assert.equal(visible(PQ_BLOQ, H1, STAYS.D.bq, "Estandar", "doble"), PVP.estandarDoble);
    sql(`update public.hotel_blackouts set fecha_fin = '2027-01-10' where id = ${id}`);
    assert.equal(visible(PQ_BLOQ, H1, STAYS.D.bq, "Estandar", "doble"), null, "D (first night 10-Jan) now touches the closure");
    sql(`delete from public.hotel_blackouts where id = ${id}`);
    assert.equal(visible(PQ_BLOQ, H1, STAYS.A.bq, "Estandar", "doble"), null, "hidden rows stay hidden after reopening until regenerated");
    assert.equal(sql(`select tarifario_estado from public.armado_paquetes where id = ${PQ_BLOQ}`), "pendiente");
    await generar(PQ_BLOQ);
    for (const k of CLAVES) assert.equal(visible(PQ_BLOQ, H1, STAYS[k].bq, "Estandar", "doble"), PVP.estandarDoble, `restored ${k}`);
  });
  test("M3b G1 in the DATABASE: a partial-window closure hides the stale 225.000 row immediately (no app filter involved); a failed regeneration keeps it hidden; the verified regeneration shows 375.000 with its witness; reopening keeps the witnessed row", async () => {
    const vista = () => num(`select coalesce(min(precio_pvp), 0) from public.tarifario_resultado_publicable where paquete_id = ${PQ_POR} and hotel_id = ${H3} and acomodacion = 'doble'`);
    sql(`delete from public.hotel_blackouts where hotel_id = ${H3}`); await generar(PQ_POR);
    assert.equal(vista(), 225_000);
    sql(`insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total) values (${H3}, '2026-12-29', '2027-01-09', true)`);
    assert.equal(vista(), 0, "315 hides every «from» row of the combination that the closure touches, until a verified regeneration");
    sql("revoke execute on function public.iniciar_generacion_tarifario(bigint) from authenticated");
    try { assert.equal(((await generarTarifario(PQ_POR)) as { ok?: boolean }).ok, false); } finally { sql("grant execute on function public.iniciar_generacion_tarifario(bigint) to authenticated"); }
    assert.equal(vista(), 0, "failed regeneration: still hidden");
    await generar(PQ_POR);
    assert.equal(vista(), 375_000, "verified regeneration: visible, with its witness");
    assert.equal(sql(`select string_agg(distinct desde_entrada::text, ',') from public.tarifario_resultado_publicable where paquete_id = ${PQ_POR} and hotel_id = ${H3} and acomodacion = 'doble'`), "2026-12-01");
    sql(`delete from public.hotel_blackouts where hotel_id = ${H3}`);
    assert.equal(vista(), 375_000, "reopened: the witnessed row is still attainable");
    await generar(PQ_POR);
    assert.equal(vista(), 225_000);
  });
  test("M4 an unaffected hotel (no closure) never hides anything; a closure of a hotel in NO package touches no package", async () => {
    sql("insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, activo) values (12799, 12701, 'Hotel sin paquete 127', 12701, 'COP', true) on conflict do nothing");
    const antes = num("select count(*) from public.tarifario_fila_oculta");
    sql("insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total) values (12799, '2026-12-29', '2027-01-09', true)");
    assert.equal(num("select count(*) from public.tarifario_fila_oculta"), antes);
    sql("delete from public.hotel_blackouts where hotel_id = 12799");
  });
});

describe("#127 · workload (local measurement)", () => {
  test("W1 one generation reads closures with ONE paginated query set (page + empty page) regardless of hotels/stays; one sale reads them once per action; the display filter once per row set", async () => {
    borrarCierres();
    cierre("2026-12-29", "2027-01-09");
    let a = lecturasDe("hotel_blackouts");
    await generar(PQ_BLOQ);
    const gen = lecturasDe("hotel_blackouts") - a;
    a = lecturasDe("hotel_blackouts");
    await carrito("B");
    const venta = lecturasDe("hotel_blackouts") - a;
    console.log(`      carga medida: closure reads per generation (3 hotel-stays × 5 stays, 2 hotels) = ${gen}; per cart sale = ${venta}`);
    assert.equal(gen, 2, "generation: 1 page with rows + 1 empty page, for ALL hotels and ALL stays of the package");
    assert.ok(venta >= 1 && venta <= 4, `a sale reads the closures a bounded number of times (${venta})`);
    borrarCierres();
  });
});
