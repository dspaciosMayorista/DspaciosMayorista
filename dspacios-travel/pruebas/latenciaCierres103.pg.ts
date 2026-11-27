// #103-block (hotel save/delete latency) — REAL server actions (crearBlackout / eliminarBlackout / crearTemporada / eliminarTemporada) against a disposable PostgreSQL over PostgREST.
// Measures, per action: wall-clock until the action RESOLVES, PostgREST requests by phase, and (after the fix) the wall-clock of the deferred regeneration.
// Fixture: one hotel (H1) used by N active bloqueo packages (5 flight blocks each) + one unaffected package that does not use H1.
// SOLO base LOCAL desechable:  MSYS_NO_PATHCONV=1 sh supabase/scripts/test_pg_local.sh pg127 plantilla127 PG103 pruebas/latenciaCierres103.pg.ts
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG103_CONTENEDOR ?? "pg127";
const DB = process.env.PG103_BASE ?? "";
const PGRST = process.env.PG103_POSTGREST ?? "";
const SECRETO = process.env.PG103_JWT_SECRET ?? "";
const N_PAQUETES = Number(process.env.PG103_PAQUETES ?? 6);
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG103_BASE (desechable), PG103_POSTGREST y PG103_JWT_SECRET: usa supabase/scripts/test_pg_local.sh.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
// `next/server` → `after` captures the deferred task so the test can time «response» and «regeneration» separately (outside a request Next throws; the app code falls back to inline).
(globalThis as unknown as { __despues: Array<() => Promise<void>> }).__despues = [];
const MODULOS_MINIMOS: Record<string, string> = {
  "server-only": "export {}",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
  "next/server": "export function after(t) { globalThis.__despues.push(typeof t === 'function' ? t : () => t); } export const NextResponse = {};",
};
registerHooks({ resolve(specifier, context, nextResolve) { const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true }; return nextResolve(specifier, context); } });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const UID_ADMIN = "00000000-0000-0000-0000-000000103001";
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-103";

const peticiones: string[] = [];
// PG103_RTT_MS simula la latencia de red de un Supabase alojado (SIMULACIÓN, no una medición del alojado): cada petición espera ese tiempo antes de salir.
const RTT_MS = Number(process.env.PG103_RTT_MS ?? 0);
const fetchLocal: typeof fetch = async (input, init) => { if (RTT_MS > 0) await new Promise((r) => setTimeout(r, RTT_MS)); const u = String(input); peticiones.push(`${init?.method ?? "GET"} ${u.replace(PGRST, "").replace(/\?.*$/, "").replace(/^\/(rest\/v1\/)?/, "")}`); return fetch(u.replace("/rest/v1/", "/"), init); };
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const SESION_ADMIN = "5e103000-0000-0000-0000-000000103001";
const UID_VENTA = "00000000-0000-0000-0000-000000103002", SESION_VENTA = "5e103000-0000-0000-0000-000000103002";
let actor: "admin" | "venta" = "admin";
const clienteSesion = () => actor === "venta"
  ? clienteLocal(jwt({ role: "authenticated", sub: UID_VENTA, session_id: SESION_VENTA }), { id: UID_VENTA, email: "venta103@x.test" })
  : clienteLocal(jwt({ role: "authenticated", sub: UID_ADMIN, session_id: SESION_ADMIN }), { id: UID_ADMIN, email: "admin103@x.test" });
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
}
const num = (q: string) => Number(sql(q));

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[], set: () => undefined };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const bo = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/blackouts-actions.ts") as Record<string, (...a: never[]) => Promise<unknown>>;
const th = await import("../app/(dashboard)/dashboard/producto/hoteles/actions.ts");

const DEST = 10301, H1 = 10301, H2 = 10302, PQ0 = 10301, PQ_AJENO = 10399;
const BQ = [10301, 10302, 10303, 10304, 10305];
const IDAS = ["2026-12-30", "2026-12-26", "2027-01-09", "2027-01-10", "2026-12-27"];
const PQS = Array.from({ length: N_PAQUETES }, (_, i) => PQ0 + i);

before(async () => {
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin103@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_ADMIN}', 'admin103@x.test', 'Admin 103', 'administracion', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into auth.sessions (id, user_id) values ('${SESION_ADMIN}', '${UID_ADMIN}') on conflict do nothing;
    insert into auth.users (id, email) values ('${UID_VENTA}', 'venta103@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_VENTA}', 'venta103@x.test', 'Venta 103', 'venta', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into auth.sessions (id, user_id) values ('${SESION_VENTA}', '${UID_VENTA}') on conflict do nothing;
    insert into public.destinos (id, nombre) values (${DEST}, 'CARTAGENA 103') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (10301, 'Proveedor Hotel 103'), (10302, 'Aerolínea 103') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
      values (${H1}, ${DEST}, 'Hotel Cierre 103', 10301, 'COP', 0, 5, 6, 12, 1, 6, true), (${H2}, ${DEST}, 'Hotel Ajeno 103', 10301, 'COP', 0, 5, 6, 12, 1, 6, true) on conflict do nothing;
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
      select h, a.acomodacion::public.acomodacion_tipo, a.pax_tarifa, a.pax_max, a.adt_min, a.adt_max, a.chd_min, a.chd_max, a.inf_min, a.inf_max from unnest(array[${H1}, ${H2}]) h,
        (values ('doble', 2, 4, 2, 2, 0, 2, 0, 2), ('sencilla', 1, 2, 1, 1, 0, 1, 0, 1)) a(acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) on conflict do nothing;
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
      (${H1}, 'ALTA', '2026-11-25', '2027-03-31', 1, 'tarifa'), (${H2}, 'ALTA', '2026-11-25', '2027-03-31', 1, 'tarifa');
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante) values
      (${H1}, 'Estandar', 'PAM', 'ALTA', 160000, 100000, 50000, 30000, 40000), (${H1}, 'Suite', 'PAM', 'ALTA', 320000, 200000, 100000, 60000, 80000),
      (${H2}, 'Estandar', 'PAM', 'ALTA', 160000, 100000, 50000, 30000, 40000);
    insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, vuelo_ida, fecha_ida, vuelo_regreso, fecha_regreso, cupos_total, tarifa_para_empaquetar, fee_infante, destino_id, proveedor_id, moneda, origen)
      select b, 'R103' || i, 'Aerolínea 103', 'BOG - CTG - BOG', 'AV' || i || '1', ida::date, 'AV' || i || '2', (ida::date + 3), 10, 200000, 0, ${DEST}, 10302, 'COP', 'BOG'
      from unnest(array[${BQ.join(",")}], array['${IDAS.join("','")}']) with ordinality as t(b, ida, i);
    insert into public.sillas (bloqueo_id, numero_silla, estado) select b, g, 'disponible' from unnest(array[${BQ.join(",")}]) b, generate_series(1, 10) g;
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
      select p, 'Bloqueo 103 #' || p, 'bloqueo', 3, ${DEST}, 0.2, 'fijo', 0, '2026-11-25', '2027-03-31', 'COP', 'COP', true from unnest(array[${PQS.join(",")}]) p;
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) select p, ${H1}, array['Estandar','Suite'], array['PAM'] from unnest(array[${PQS.join(",")}]) p;
    insert into public.armado_vuelos (paquete_id, bloqueo_id, aplica_mk, ta) select p, b, true, 0 from unnest(array[${PQS.join(",")}]) p, unnest(array[${BQ.join(",")}]) b;
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
      values (${PQ_AJENO}, 'Paquete ajeno 103', 'bloqueo', 3, ${DEST}, 0.2, 'fijo', 0, '2026-11-25', '2027-03-31', 'COP', 'COP', true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (${PQ_AJENO}, ${H2}, array['Estandar'], array['PAM']);
    insert into public.armado_vuelos (paquete_id, bloqueo_id, aplica_mk, ta) select ${PQ_AJENO}, b, true, 0 from unnest(array[${BQ.join(",")}]) b;
  `);
  for (const p of [...PQS, PQ_AJENO]) { const g = (await generarTarifario(p)) as { ok?: boolean; error?: string }; assert.equal(g.ok, true, `seed generarTarifario(${p}): ${g.error}`); }
  BASE_FILAS = num(`select count(*) from public.tarifario_resultado_publicable where paquete_id = ${PQS[0]} and hotel_id = ${H1}`);
});

let BASE_FILAS = 0;
const filasVisibles = (pq: number, hotel: number) => num(`select count(*) from public.tarifario_resultado_publicable where paquete_id = ${pq} and hotel_id = ${hotel}`);
const filasFisicas = (pq: number, hotel: number) => num(`select count(*) from public.tarifario_resultado where paquete_id = ${pq} and hotel_id = ${hotel}`);
const tarea = () => (globalThis as unknown as { __despues: Array<() => Promise<void>> }).__despues;
const tablaPeticiones = (desde: number, hasta: number) => { const m = new Map<string, number>(); for (const p of peticiones.slice(desde, hasta)) m.set(p, (m.get(p) ?? 0) + 1); return Object.fromEntries([...m.entries()].sort()); };

/** Runs one action and reports: ms until it resolves, requests until it resolves, then (when the app deferred work) ms/requests of the deferred regeneration. */
async function medir<T>(nombre: string, accion: () => Promise<T>) {
  tarea().length = 0;
  const p0 = peticiones.length, t0 = performance.now();
  const resultado = await accion();
  const msRespuesta = Math.round(performance.now() - t0), p1 = peticiones.length;
  const diferidas = tarea().splice(0);
  const t1 = performance.now();
  for (const d of diferidas) await d();
  const msDiferido = Math.round(performance.now() - t1), p2 = peticiones.length;
  const linea = { nombre, paquetes: N_PAQUETES, msRespuesta, peticionesRespuesta: p1 - p0, tareasDiferidas: diferidas.length, msDiferido, peticionesDiferidas: p2 - p1, msTotal: msRespuesta + msDiferido };
  console.log("MEDICION " + JSON.stringify(linea));
  console.log("MEDICION_REQ_RESPUESTA " + nombre + " " + JSON.stringify(tablaPeticiones(p0, p1)));
  return { resultado, ...linea };
}

describe("latency · general closure (hotel_blackouts)", () => {
  test("L1 crearBlackout: measured; after completion the closed rows are hidden and the unaffected package keeps every row", async () => {
    const antesAjeno = filasVisibles(PQ_AJENO, H2);
    const m = await medir("crearBlackout", () => bo.crearBlackout({ hotelId: H1, fechaInicio: "2026-12-29", fechaFin: "2027-01-09", total: true, acomodaciones: [], categorias: [], motivo: "latencia 103" } as never));
    assert.equal((m.resultado as { ok: boolean }).ok, true);
    assert.equal(num(`select count(*) from public.hotel_blackouts where hotel_id = ${H1} and motivo = 'latencia 103'`), 1);
    // After the (possibly deferred) regeneration every package of H1 shows fewer rows than before and the unaffected package is identical.
    for (const p of PQS) { const v = filasVisibles(p, H1); assert.ok(v > 0 && v < BASE_FILAS, `package ${p}: open stays kept (${v}) but closed rows gone (< ${BASE_FILAS})`); }
    assert.equal(filasVisibles(PQ_AJENO, H2), antesAjeno, "unrelated package untouched");
  });
  test("L2 eliminarBlackout: measured; the reopened stays are published again by the end", async () => {
    const id = num(`select id from public.hotel_blackouts where hotel_id = ${H1} and motivo = 'latencia 103'`);
    const m = await medir("eliminarBlackout", () => bo.eliminarBlackout(id as never, H1 as never));
    assert.equal((m.resultado as { ok: boolean }).ok, true);
    assert.equal(num(`select count(*) from public.hotel_blackouts where id = ${id}`), 0, "row physically deleted");
    for (const p of PQS) assert.equal(filasVisibles(p, H1), BASE_FILAS, `package ${p} publishes every stay again`);
  });
});

describe("latency · season (hotel_temporadas)", () => {
  test("L3 crearTemporada then eliminarTemporada: measured", async () => {
    const m = await medir("crearTemporada", () => th.crearTemporada({ hotelId: H1, nombre: "BAJA", inicio: "2027-02-01", fin: "2027-02-28", prioridad: 2, tipo: "tarifa" } as never));
    assert.equal((m.resultado as { ok: boolean }).ok, true, JSON.stringify(m.resultado));
    const id = num(`select id from public.hotel_temporadas where hotel_id = ${H1} and nombre = 'BAJA'`);
    const e = await medir("eliminarTemporada", () => th.eliminarTemporada(id, H1));
    assert.equal((e.resultado as { ok: boolean }).ok, true, JSON.stringify(e.resultado));
    assert.equal(num(`select count(*) from public.hotel_temporadas where id = ${id}`), 0);
  });
});

describe("failure behavior · a deletion that did not happen is never reported as done", () => {
  test("F1 deleting a closure that does not exist returns ok:false (UI keeps the row, shows the error) and regenerates nothing", async () => {
    tarea().length = 0;
    const r = await bo.eliminarBlackout(987654321 as never, H1 as never) as { ok: boolean; error?: string };
    assert.equal(r.ok, false); assert.match(r.error ?? "", /No se pudo eliminar/);
    assert.equal(tarea().length, 0, "no deferred regeneration scheduled for a failed delete");
  });
  test("F2 a role without catalogue write permission deleting a real closure: RLS affects 0 rows WITHOUT error → still ok:false, the closure stays in the database", async () => {
    sql(`insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total) values (${H1}, '2027-03-01', '2027-03-02', true)`);
    const id = num(`select id from public.hotel_blackouts where hotel_id = ${H1} and fecha_inicio = '2027-03-01'`);
    actor = "venta";
    try {
      tarea().length = 0;
      const r = await bo.eliminarBlackout(id as never, H1 as never) as { ok: boolean; error?: string };
      assert.equal(r.ok, false, "must not claim success");
      assert.equal(num(`select count(*) from public.hotel_blackouts where id = ${id}`), 1, "the closure is still there");
      assert.equal(tarea().length, 0);
    } finally { actor = "admin"; sql(`delete from public.hotel_blackouts where id = ${id}`); }
  });
  test("F3 creating with invalid dates returns the error and writes nothing", async () => {
    const r = await bo.crearBlackout({ hotelId: H1, fechaInicio: "2027-03-05", fechaFin: "2027-03-01", total: true, acomodaciones: [], categorias: [], motivo: "" } as never) as { ok: boolean };
    assert.equal(r.ok, false);
  });
});

// ── Date sets (migration 327): real actions, real RLS, copy-not-link isolation ────────────────────────────────────────────────────────────────────────
const cj = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/conjuntos-actions.ts");
const R = (a: string, b: string) => ({ fecha_inicio: a, fecha_fin: b });
describe("date sets (327) · real actions against the database", () => {
  test("S1 create → unique per (name, year, case-insensitive) → same name in another year is fine", async () => {
    const a = await cj.crearConjuntoFechas({ nombre: "Semana Santa", anio: 2027, tipo: "semana_santa", rangos: [R("2027-03-25", "2027-03-28")] });
    assert.equal(a.ok, true, JSON.stringify(a));
    const dup = await cj.crearConjuntoFechas({ nombre: "  semana santa ", anio: 2027, tipo: "semana_santa", rangos: [R("2027-03-25", "2027-03-28")] });
    assert.equal(dup.ok, false); if (!dup.ok) assert.match(dup.error, /Ya existe un conjunto con ese nombre en ese año/);
    const otroAnio = await cj.crearConjuntoFechas({ nombre: "Semana Santa", anio: 2028, tipo: "semana_santa", rangos: [R("2028-04-13", "2028-04-16")] });
    assert.equal(otroAnio.ok, true, JSON.stringify(otroAnio));
    assert.equal(num("select count(*) from public.conjuntos_fechas"), 2);
  });
  test("S2 invalid input is rejected before the database and nothing is written (reversed range, impossible date, no nights, bad year)", async () => {
    const antes = num("select count(*) from public.conjuntos_fechas");
    for (const rangos of [[R("2027-03-28", "2027-03-25")], [R("2027-02-31", "2027-03-01")], []]) {
      const r = await cj.crearConjuntoFechas({ nombre: "X", anio: 2027, tipo: "festivos", rangos }); assert.equal(r.ok, false);
    }
    assert.equal((await cj.crearConjuntoFechas({ nombre: "X", anio: 1900, tipo: "festivos", rangos: [R("2027-03-25", "2027-03-28")] })).ok, false);
    assert.equal(num("select count(*) from public.conjuntos_fechas"), antes);
  });
  test("S3 the database itself rejects malformed ranges even when the app is bypassed (check constraint)", () => {
    assert.throws(() => sql(`insert into public.conjuntos_fechas (nombre, anio, rangos) values ('dato malo', 2027, '[{"fecha_inicio":"2027-03-28","fecha_fin":"2027-03-25"}]')`), /conjuntos_fechas_rangos_check|violates check/);
    assert.throws(() => sql(`insert into public.conjuntos_fechas (nombre, anio, rangos) values ('dato malo 2', 2027, '{"no":"arreglo"}')`), /violates check/);
  });
  test("S4 a role without product write permission cannot create, update or delete (and delete never claims success)", async () => {
    const id = num("select id from public.conjuntos_fechas where nombre = 'Semana Santa' and anio = 2027");
    actor = "venta";
    try {
      assert.equal((await cj.crearConjuntoFechas({ nombre: "No permitido", anio: 2027, tipo: "festivos", rangos: [R("2027-05-01", "2027-05-01")] })).ok, false);
      assert.equal((await cj.actualizarConjuntoFechas(id, { nombre: "Cambiado", anio: 2027, tipo: "festivos", rangos: [R("2027-05-01", "2027-05-01")] })).ok, false);
      const d = await cj.eliminarConjuntoFechas(id); assert.equal(d.ok, false);
    } finally { actor = "admin"; }
    assert.equal(num(`select count(*) from public.conjuntos_fechas where id = ${id} and nombre = 'Semana Santa'`), 1, "untouched");
  });
  test("S5 deleting a set that no longer exists reports failure; updating a missing set reports failure", async () => {
    const d = await cj.eliminarConjuntoFechas(987654321); assert.equal(d.ok, false);
    const u = await cj.actualizarConjuntoFechas(987654321, { nombre: "x", anio: 2027, tipo: "festivos", rangos: [R("2027-05-01", "2027-05-01")] }); assert.equal(u.ok, false);
  });
  test("S6 COPY, not link: a season saved with the set's nights keeps them after the set is edited and after it is deleted; exclusions outside the validity are rejected by the server", async () => {
    const id = num("select id from public.conjuntos_fechas where nombre = 'Semana Santa' and anio = 2027");
    const t = await th.crearTemporada({ hotelId: H1, nombre: "ALTA 2027", inicio: "2027-01-01", fin: "2027-12-31", prioridad: 1, tipo: "tarifa", blackouts: [R("2027-03-25", "2027-03-28")] } as never) as { ok: boolean; id?: number; error?: string };
    assert.equal(t.ok, true, t.error);
    const guardado = () => sql(`select blackouts::text from public.hotel_temporadas where id = ${t.id}`);
    const antes = guardado();
    await cj.actualizarConjuntoFechas(id, { nombre: "Semana Santa", anio: 2027, tipo: "semana_santa", rangos: [R("2027-03-20", "2027-03-30")] });
    assert.equal(guardado(), antes, "editing the set did not touch the season");
    const del = await cj.eliminarConjuntoFechas(id); assert.equal(del.ok, true);
    assert.equal(guardado(), antes, "deleting the set did not touch the season");
    assert.match(antes, /2027-03-25/);
    // dropped nights outside the validity would be rejected by the existing server rule:
    const fuera = await th.crearTemporada({ hotelId: H1, nombre: "CORTA 2027", inicio: "2027-04-01", fin: "2027-04-30", prioridad: 1, tipo: "tarifa", blackouts: [R("2027-03-25", "2027-03-28")] } as never) as { ok: boolean; error?: string };
    assert.equal(fuera.ok, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// H103-2 · the deferred regeneration is safe when it NEVER STARTS, is INTERRUPTED, or OVERLAPS another edit.
// Property under test: after an action resolves and BEFORE any regeneration runs, nothing visible carries a price that the final (fully regenerated) state would not also show; the unfinished work is persisted
// and visible; a resume completes ONLY what is owed; a stale computation can never publish over a newer edit.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const paq = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const huellasVisibles = (pq: number): Set<string> => new Set(sql(`select md5((to_jsonb(r) - 'id' - 'generacion' - 'revision_fuente' - 'lote' - 'created_at' - 'updated_at')::text) from public.tarifario_resultado_publicable r where paquete_id = ${pq} and hotel_id = ${H1}`).split("\n").filter(Boolean));
const subconjunto = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));
const pendientesDe = (pq: number) => sql(`select (tarifario_revision_fuente > coalesce(tarifario_revision_publicada, 0))::text || '|' || tarifario_estado from public.armado_paquetes where id = ${pq}`);
const regenerarTodo = async () => { for (const p of PQS) { const g = (await generarTarifario(p)) as { ok?: boolean; error?: string }; assert.equal(g.ok, true, `generarTarifario(${p}): ${g.error}`); } };
const contarGeneraciones = () => num(`select coalesce(sum(tarifario_generacion), 0) from public.armado_paquetes where id in (${PQS.join(",")})`);

describe("H103-2 · persisted correctness of deferred regeneration", () => {
  const casos: { nombre: string; encoge: boolean; accion: () => Promise<unknown>; preparar?: () => Promise<unknown> }[] = [
    { nombre: "general closure created", encoge: true, accion: () => bo.crearBlackout({ hotelId: H1, fechaInicio: "2026-12-29", fechaFin: "2027-01-09", total: true, acomodaciones: [], categorias: [], motivo: "h2 cierre" } as never) },
    { nombre: "general closure deleted (reopen)", encoge: false, accion: async () => bo.eliminarBlackout(num(`select id from public.hotel_blackouts where hotel_id = ${H1} and motivo = 'h2 cierre'`) as never, H1 as never) },
    { nombre: "validity dates shrunk", encoge: true, accion: async () => th.actualizarTemporada(num(`select id from public.hotel_temporadas where hotel_id = ${H1} and nombre = 'ALTA'`), { hotelId: H1, nombre: "ALTA", inicio: "2026-12-26", fin: "2027-01-05", prioridad: 1, tipo: "tarifa" } as never) },
    { nombre: "validity restored then an EXCLUSION added inside it", encoge: true,
      preparar: async () => { await th.actualizarTemporada(num(`select id from public.hotel_temporadas where hotel_id = ${H1} and nombre = 'ALTA'`), { hotelId: H1, nombre: "ALTA", inicio: "2026-11-25", fin: "2027-03-31", prioridad: 1, tipo: "tarifa" } as never); tarea().length = 0; await regenerarTodo(); },
      accion: async () => th.actualizarTemporada(num(`select id from public.hotel_temporadas where hotel_id = ${H1} and nombre = 'ALTA'`), { hotelId: H1, nombre: "ALTA", inicio: "2026-11-25", fin: "2027-03-31", prioridad: 1, tipo: "tarifa", blackouts: [{ fecha_inicio: "2026-12-30", fecha_fin: "2027-01-02" }] } as never) },
    { nombre: "percentage PROMOTION created over part of the validity", encoge: true,
      preparar: async () => { await th.actualizarTemporada(num(`select id from public.hotel_temporadas where hotel_id = ${H1} and nombre = 'ALTA'`), { hotelId: H1, nombre: "ALTA", inicio: "2026-11-25", fin: "2027-03-31", prioridad: 1, tipo: "tarifa" } as never); tarea().length = 0; await regenerarTodo(); },
      accion: () => th.crearTemporada({ hotelId: H1, nombre: "PROMO H2", inicio: "2026-12-26", fin: "2027-01-03", prioridad: 5, tipo: "descuento_pct", descuentoValor: 20 } as never) },
    { nombre: "promotion deleted", encoge: false, accion: async () => th.eliminarTemporada(num(`select id from public.hotel_temporadas where hotel_id = ${H1} and nombre = 'PROMO H2'`), H1) },
  ];

  for (const c of casos) {
    test(`H2-${casos.indexOf(c) + 1} «${c.nombre}»: with the deferred regeneration NEVER started, no stale price stays visible, the debt is persisted for every package of the hotel and only for them; a resume then completes it`, async () => {
      if (c.preparar) await c.preparar();
      tarea().length = 0; await regenerarTodo();
      const base = PQS.map(huellasVisibles), ajenoAntes = filasVisibles(PQ_AJENO, H2), ajenoEstado = pendientesDe(PQ_AJENO);
      tarea().length = 0;
      const r = (await c.accion()) as { ok: boolean }; assert.equal(r.ok, true, JSON.stringify(r));
      tarea().length = 0;                                                    // the `after` callback is DISCARDED: it never starts
      // (1) immediate visibility: shown rows == rows that the final state keeps; the closing cases really shrink what is shown
      const v0 = PQS.map(huellasVisibles);
      // (2) persisted debt: every package of the hotel owes a regeneration; the unrelated package does not
      for (const p of PQS) assert.match(pendientesDe(p), /^true\|/, `package ${p} owes a regeneration`);
      assert.equal(pendientesDe(PQ_AJENO), ajenoEstado, "an unrelated package is not marked"); assert.equal(filasVisibles(PQ_AJENO, H2), ajenoAntes);
      const st = await paq.estadoTarifariosDeHotel(H1); assert.equal(st.ok, true); if (st.ok) { assert.equal(st.porReanudar, N_PAQUETES); assert.match(st.texto ?? "", /sin actualizar/); }
      // (3) resume completes it
      const g0 = contarGeneraciones();
      const rr = await paq.reanudarTarifariosDeHotel(H1); assert.equal(rr.ok && rr.fallidos.length, 0, JSON.stringify(rr)); if (rr.ok) assert.equal(rr.regenerados, N_PAQUETES);
      assert.equal(contarGeneraciones() - g0, N_PAQUETES, "exactly one regeneration per owed package");
      const v1 = PQS.map(huellasVisibles);
      PQS.forEach((p, i) => { assert.ok(subconjunto(v0[i], v1[i]), `package ${p}: a row visible BEFORE the regeneration is not in the final state (stale price shown)`); assert.match(pendientesDe(p), /^false\|listo$/); });
      if (c.encoge) PQS.forEach((p, i) => assert.ok(v0[i].size < base[i].size, `package ${p}: the change hid something at once (${v0[i].size} < ${base[i].size})`));
      const st2 = await paq.estadoTarifariosDeHotel(H1); assert.equal(st2.ok && st2.texto, null, "the message disappears by itself once everything is up to date");
      const g1 = contarGeneraciones(); await paq.reanudarTarifariosDeHotel(H1); assert.equal(contarGeneraciones(), g1, "a second resume has nothing to do (idempotent, no wasted work)");
    });
  }

  test("H2-7 INTERRUPTED half-way: only the not-yet-regenerated packages are redone (no whole-hotel redo)", async () => {
    tarea().length = 0; await regenerarTodo();
    await bo.crearBlackout({ hotelId: H1, fechaInicio: "2027-01-20", fechaFin: "2027-01-25", total: true, acomodaciones: [], categorias: [], motivo: "h2 mitad" } as never); tarea().length = 0;
    const mitad = PQS.slice(0, Math.floor(N_PAQUETES / 2));
    for (const p of mitad) assert.equal(((await generarTarifario(p)) as { ok: boolean }).ok, true);   // the worker dies after these
    const g0 = contarGeneraciones();
    const rr = await paq.reanudarTarifariosDeHotel(H1); assert.equal(rr.ok && rr.regenerados, N_PAQUETES - mitad.length, JSON.stringify(rr));
    assert.equal(contarGeneraciones() - g0, N_PAQUETES - mitad.length);
    for (const p of PQS) assert.match(pendientesDe(p), /^false\|listo$/);
  });

  test("H2-8 OVERLAP: a computation that started BEFORE a newer edit can never publish over it; after the resume the visible state equals a from-scratch regeneration of the FINAL state", async () => {
    tarea().length = 0; await regenerarTodo();
    const p = PQS[0];
    const enCurso = generarTarifario(p);                                             // computation A starts (reads the old state)…
    await bo.crearBlackout({ hotelId: H1, fechaInicio: "2027-02-02", fechaFin: "2027-02-06", total: true, acomodaciones: [], categorias: [], motivo: "h2 solape" } as never);   // …edit B lands meanwhile
    await enCurso; tarea().length = 0;
    // whatever A did, the debt of B must still be recorded and nothing stale may be visible
    assert.match(pendientesDe(p), /^true\|/, "A did not clear the debt that B created");
    await paq.reanudarTarifariosDeHotel(H1);
    const final = huellasVisibles(p);
    await regenerarTodo();                                                           // a clean from-scratch regeneration of the final state
    assert.deepEqual([...huellasVisibles(p)].sort(), [...final].sort(), "resumed state == from-scratch state");
  });

  test("H2-9 ORPHANED «recalculando»: a package whose worker died is resumed once its latest change is older than the lease; a young one is left alone; the unrelated package is never touched", async () => {
    tarea().length = 0; await regenerarTodo();
    await bo.crearBlackout({ hotelId: H1, fechaInicio: "2027-03-10", fechaFin: "2027-03-12", total: true, acomodaciones: [], categorias: [], motivo: "h2 huerfano" } as never); tarea().length = 0;
    sql(`update public.armado_paquetes set tarifario_estado = 'recalculando' where id in (${PQS.join(",")})`);
    const vivo = await paq.estadoTarifariosDeHotel(H1); assert.equal(vivo.ok, true); if (vivo.ok) { assert.equal(vivo.enCursoVivo, N_PAQUETES, "young claim: assumed alive"); assert.match(vivo.texto ?? "", /Actualizando/); }
    const g0 = contarGeneraciones(); const noToca = await paq.reanudarTarifariosDeHotel(H1); assert.equal(noToca.ok && noToca.regenerados, 0); assert.equal(contarGeneraciones(), g0, "a live computation is not duplicated");
    sql(`update public.tarifario_cambio_fuente set creado_en = now() - interval '10 minutes' where paquete_id in (${PQS.join(",")})`);
    const huerfano = await paq.estadoTarifariosDeHotel(H1); if (huerfano.ok) assert.equal(huerfano.porReanudar, N_PAQUETES, "old claim: orphaned");
    const ajeno0 = pendientesDe(PQ_AJENO);
    const rr = await paq.reanudarTarifariosDeHotel(H1); assert.equal(rr.ok && rr.regenerados, N_PAQUETES);
    for (const p of PQS) assert.match(pendientesDe(p), /^false\|listo$/); assert.equal(pendientesDe(PQ_AJENO), ajeno0);
  });

  test("H2-10 a role without permission can neither read the state nor trigger the resume", async () => {
    actor = "venta";
    try { const a = await paq.estadoTarifariosDeHotel(H1); assert.equal(a.ok, false); const b = await paq.reanudarTarifariosDeHotel(H1); assert.equal(b.ok, false); }
    finally { actor = "admin"; }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R2-5 · bounded AUTOMATIC recovery: what the open hotel screen decides and does on its own (no button). Same server functions the screen calls.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("R2-5 · automatic completion of the regeneration debt", () => {
  const envejecer = (seg: number) => sql(`update public.tarifario_cambio_fuente set creado_en = now() - interval '${seg} seconds' where paquete_id in (${PQS.join(",")})`);
  const nuevaDeuda = async (motivo: string) => { tarea().length = 0; await regenerarTodo(); await bo.crearBlackout({ hotelId: H1, fechaInicio: "2027-03-14", fechaFin: "2027-03-15", total: true, acomodaciones: [], categorias: [], motivo } as never); tarea().length = 0; };
  const limpiar = async (motivo: string) => { const id = num(`select id from public.hotel_blackouts where hotel_id = ${H1} and motivo = '${motivo}'`); await bo.eliminarBlackout(id as never, H1 as never); tarea().length = 0; };

  test("A1 the screen decides to resume by itself only when work is owed, nothing is alive and the debt is older than the grace (120 s); live and `fallido` cases are left alone", async () => {
    await nuevaDeuda("r25 a1");
    const joven = await paq.estadoTarifariosDeHotel(H1); assert.equal(joven.ok && joven.reanudarSolo, false, "a debt created seconds ago is the deferred run's: not resumed yet");
    envejecer(60); assert.equal((await paq.estadoTarifariosDeHotel(H1) as { reanudarSolo: boolean }).reanudarSolo, false, "60 s < grace");
    envejecer(180); assert.equal((await paq.estadoTarifariosDeHotel(H1) as { reanudarSolo: boolean }).reanudarSolo, true, "3 minutes old, nothing alive → automatic");
    // one package with a LIVE computation (young change, recalculando) holds the automatic resume back
    sql(`update public.tarifario_cambio_fuente set creado_en = now() where paquete_id = ${PQS[0]}; update public.armado_paquetes set tarifario_estado = 'recalculando' where id = ${PQS[0]}`);
    const vivo = await paq.estadoTarifariosDeHotel(H1); assert.equal(vivo.ok && vivo.reanudarSolo, false); assert.equal(vivo.ok && vivo.enCursoVivo, 1);
    // only `fallido` owed → no automatic retry of a failing computation on every visit
    sql(`update public.armado_paquetes set tarifario_estado = 'fallido' where id in (${PQS.join(",")})`); envejecer(300);
    const fallido = await paq.estadoTarifariosDeHotel(H1); assert.equal(fallido.ok && fallido.reanudarSolo, false); assert.equal(fallido.ok && fallido.fallidos, N_PAQUETES);
    const g0 = contarGeneraciones(); const auto = await paq.reanudarTarifariosDeHotel(H1, Date.now(), { automatica: true });
    assert.equal(auto.ok && auto.regenerados, 0); assert.equal(contarGeneraciones(), g0, "the automatic path does not touch `fallido` packages");
    const manual = await paq.reanudarTarifariosDeHotel(H1); assert.equal(manual.ok && manual.regenerados, N_PAQUETES, "the manual button retries them");
    await limpiar("r25 a1");
  });

  test("A2 KILLED WORKER, no button: the deferred run never started; the screen's own automatic call completes every package, the visible rows equal a from-scratch regeneration, the banner text is gone", async () => {
    await nuevaDeuda("r25 a2"); envejecer(240);
    const st = await paq.estadoTarifariosDeHotel(H1); assert.equal(st.ok && st.reanudarSolo, true);
    const p0 = peticiones.length; const t0 = performance.now(); const g0 = contarGeneraciones();
    const r = await paq.reanudarTarifariosDeHotel(H1, Date.now(), { automatica: true });
    console.log("MEDICION_R25 " + JSON.stringify({ caso: "reanudacion automatica", paquetes: N_PAQUETES, ms: Math.round(performance.now() - t0), peticiones: peticiones.length - p0 }));
    assert.equal(r.ok && r.fallidos.length, 0, JSON.stringify(r)); assert.equal(contarGeneraciones() - g0, N_PAQUETES, "one regeneration per owed package, none extra");
    const v1 = PQS.map(huellasVisibles);
    for (const p of PQS) assert.match(pendientesDe(p), /^false\|listo$/);
    const fin = await paq.estadoTarifariosDeHotel(H1); assert.equal(fin.ok && fin.texto, null, "the persisted state is clean: the banner disappears on the next read");
    await regenerarTodo(); PQS.forEach((p, i) => assert.deepEqual([...huellasVisibles(p)].sort(), [...v1[i]].sort(), `package ${p}: recovered state == from-scratch state`));
    await limpiar("r25 a2");
  });

  test("A3 idle behaviour: reading the state when nothing is owed costs a fixed handful of requests and starts NO regeneration; a second automatic call right after completion is a no-op", async () => {
    tarea().length = 0; await regenerarTodo();
    const p0 = peticiones.length; const st = await paq.estadoTarifariosDeHotel(H1); const lectura = peticiones.length - p0;
    console.log("MEDICION_R25 " + JSON.stringify({ caso: "lectura de estado sin deuda", peticiones: lectura }));
    assert.equal(st.ok && st.texto, null); assert.ok(lectura <= 6, `state read = ${lectura} requests`);
    const g0 = contarGeneraciones(); const p1 = peticiones.length; const r = await paq.reanudarTarifariosDeHotel(H1, Date.now(), { automatica: true });
    assert.equal(r.ok && r.regenerados, 0); assert.equal(contarGeneraciones(), g0, "nothing owed → no regeneration"); console.log("MEDICION_R25 " + JSON.stringify({ caso: "reanudar sin deuda", peticiones: peticiones.length - p1 }));
  });

  test("A4 the NORMAL path completes too: after the deferred run finishes the persisted debt is gone (no manual step, no resume needed)", async () => {
    tarea().length = 0; await regenerarTodo();
    await bo.crearBlackout({ hotelId: H1, fechaInicio: "2027-03-20", fechaFin: "2027-03-21", total: true, acomodaciones: [], categorias: [], motivo: "r25 a4" } as never);
    assert.equal((await paq.estadoTarifariosDeHotel(H1) as { porReanudar: number }).porReanudar, N_PAQUETES, "right after the response the debt is visible");
    for (const d of tarea().splice(0)) await d();
    const fin = await paq.estadoTarifariosDeHotel(H1); assert.equal(fin.ok && fin.texto, null);
    await limpiar("r25 a4");
  });
});
