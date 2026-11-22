// #127 V1 — DINÁMICO (manual system departures, `salidas_dinamicas`) and EMPAQUETADO (system ticket, `empaquetados`) with REAL actions against disposable PostgreSQL over HTTP:
//   generation → published view → display loader → quotation (crearCotizacion) → conversion (convertirCotizacion), with a general closure, NO regeneration (stale rows), reopening and the 315 trigger.
// Both modules share `filasHoteles`/`computarReserva` with bloqueo, but a shared path is not evidence: this suite exercises each source end to end.
// Hand arithmetic (markup 20 %, hotel double 100.000 p.p./night × 3 nights): hotel 100.000 × 3 / 0,8 = 375.000.
//   Dinámico: ticket 300.000 with markup → 375.000 → 750.000 p.p. · Empaquetado: ticket 300.000 + TA 20.000 (no markup) = 320.000 → 695.000 p.p.
//   MSYS_NO_PATHCONV=1 sh supabase/scripts/test_pg_local.sh pg127 plantilla127 PG127 pruebas/cierreGeneralDinEmp127.pg.ts
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
registerHooks({ resolve(specifier, context, nextResolve) { const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true }; return nextResolve(specifier, context); } });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const UID_ADMIN = "00000000-0000-0000-0000-000000127301";
const SESION_ADMIN = "5e127000-0000-0000-0000-000000127301";
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
const clienteSesion = () => clienteLocal(jwt({ role: "authenticated", sub: UID_ADMIN, session_id: SESION_ADMIN }), { id: UID_ADMIN, email: "admin127d@x.test" });
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
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
const { crearCotizacion, convertirCotizacion } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { cargarDatosTarifario } = await import("../lib/tarifario/datos.ts");

const DEST = 12741, HD = 12741, HE = 12742, PQ_DIN = 12741, PQ_EMP = 12742;
const SAL = { abierta: 12741, cerrada: 12742 };  // dinámico departures: 20-Mar (open) / 10-Mar (inside the closure)
const EMPQ = { abierto: 12741, cerrado: 12742 }; // empaquetado sources: 20-Apr (open) / 10-Apr (inside the closure)
const FECHAS = {
  din: { cerrada: ["2030-03-10", "2030-03-13"], abierta: ["2030-03-20", "2030-03-23"] },
  emp: { cerrado: ["2030-04-10", "2030-04-13"], abierto: ["2030-04-20", "2030-04-23"] },
} as const;
const PVP = { din: 750_000, emp: 695_000 }; // per person, double room
const CLIENTE = { nombres: "Cliente", apellidos: "DinEmp 127", numeroDoc: "127800", telefono: "3001234567", email: "dinemp127@example.com", tipoDoc: "CC" };
const PAX = [1, 2].map((i) => ({ nombres: `Pax${i}`, apellidos: "DinEmp 127", tipoDoc: "CC", numeroDoc: `12780${i}`, fechaNacimiento: "1985-03-04", nacionalidad: "Colombiana", esInfante: false }));

before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin127d@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_ADMIN}', 'admin127d@x.test', 'Admin 127 D', 'administracion', true, 'mayorista') on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into auth.sessions (id, user_id) values ('${SESION_ADMIN}', '${UID_ADMIN}') on conflict do nothing;
    insert into public.destinos (id, nombre) values (${DEST}, 'CARTAGENA 127 DIN-EMP') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (12741, 'Proveedor Hotel 127 DE'), (12742, 'Aerolínea 127 DE') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
      values (${HD}, ${DEST}, 'Hotel Dinamico 127', 12741, 'COP', 0, 5, 6, 12, 1, 6, true), (${HE}, ${DEST}, 'Hotel Empaquetado 127', 12741, 'COP', 0, 5, 6, 12, 1, 6, true) on conflict do nothing;
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (${HD}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (${HE}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2) on conflict do nothing;
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (${HD}, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa'), (${HE}, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa');
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante) values
      (${HD}, 'Estandar', 'PAM', 'ALTA', 160000, 100000, 50000, 30000, 40000), (${HE}, 'Estandar', 'PAM', 'ALTA', 160000, 100000, 50000, 30000, 40000);
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo) values
      (${PQ_DIN}, 'Dinamico 127', 'dinamico', 3, ${DEST}, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true),
      (${PQ_EMP}, 'Empaquetado 127', 'bloqueo', 3, ${DEST}, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (${PQ_DIN}, ${HD}, array['Estandar'], array['PAM']), (${PQ_EMP}, ${HE}, array['Estandar'], array['PAM']);
    insert into public.salidas_dinamicas (id, paquete_id, aerolinea, ruta, origen, fecha_ida, fecha_regreso, valor_tiquete, aplica_mk, ta, fee_infante, activo, moneda) values
      (${SAL.abierta}, ${PQ_DIN}, 'Aerolínea 127', 'BOG - CTG - BOG', 'BOG', '${FECHAS.din.abierta[0]}', '${FECHAS.din.abierta[1]}', 300000, true, 0, 0, true, 'COP'),
      (${SAL.cerrada}, ${PQ_DIN}, 'Aerolínea 127', 'BOG - CTG - BOG', 'BOG', '${FECHAS.din.cerrada[0]}', '${FECHAS.din.cerrada[1]}', 300000, true, 0, 0, true, 'COP');
    insert into public.empaquetados (id, aerolinea, ruta, origen, destino_id, fecha_ida, fecha_regreso, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo, moneda) overriding system value values
      (${EMPQ.abierto}, 'Aerolínea 127', 'BOG - CTG - BOG', 'BOG', ${DEST}, '${FECHAS.emp.abierto[0]}', '${FECHAS.emp.abierto[1]}', 280000, 300000, 0, true, 'COP'),
      (${EMPQ.cerrado}, 'Aerolínea 127', 'BOG - CTG - BOG', 'BOG', ${DEST}, '${FECHAS.emp.cerrado[0]}', '${FECHAS.emp.cerrado[1]}', 280000, 300000, 0, true, 'COP');
    insert into public.armado_empaquetados (paquete_id, empaquetado_id, aplica_mk, ta) values (${PQ_EMP}, ${EMPQ.abierto}, false, 20000), (${PQ_EMP}, ${EMPQ.cerrado}, false, 20000);
  `);
});

const generar = async (pq: number) => { const g = (await generarTarifario(pq)) as { ok?: boolean; error?: string }; assert.equal(g.ok, true, `generarTarifario(${pq}): ${g.error}`); };
const visible = (pq: number, hotel: number, campo: "salida_id" | "empaquetado_id", id: number): number | null => {
  const v = sql(`select precio_pvp from public.tarifario_resultado_publicable where paquete_id = ${pq} and hotel_id = ${hotel} and ${campo} = ${id} and categoria = 'Estandar' and acomodacion = 'doble'`);
  return v === "" ? null : Number(v);
};
const cierre = (hotel: number, ini: string, fin: string, extra = "true, null, null") => sql(`insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total, acomodaciones, categorias) values (${hotel}, '${ini}', '${fin}', ${extra})`);
const limpiar = () => sql(`delete from public.hotel_blackouts where hotel_id in (${HD}, ${HE})`);
const cuentas = () => ({ ventas: sql("select count(*) from public.ventas"), cxp: sql("select count(*) from public.cuentas_por_pagar"), cot: sql("select count(*) from public.cotizaciones"), ult: sql("select coalesce(max(substring(numero_contrato from 5)::int), 0) from public.ventas where numero_contrato ~ '^DTM-[0-9]+$'") });
type Res = { ok: boolean; error?: string; id?: number; numero?: string };
const inpDin = (clave: "abierta" | "cerrada") => ({
  paqueteId: PQ_DIN, bloqueoId: null, salidaId: SAL[clave], modulo: "dinamico", hotelId: HD, fechaIda: FECHAS.din[clave][0], fechaRegreso: FECHAS.din[clave][1], categoria: "Estandar", regimen: "PAM", habitaciones: { doble: 1 },
  ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [], cantidadMenores: 0, cliente: CLIENTE, tipoAsesor: "interno", asesorInterno: "Asesor 127", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: PAX, servicios: [],
});
const inpEmp = (clave: "abierto" | "cerrado") => ({
  paqueteId: PQ_EMP, bloqueoId: null, empaquetadoId: EMPQ[clave], salidaId: null, modulo: "bloqueo", hotelId: HE, fechaIda: null, fechaRegreso: null, categoria: "Estandar", regimen: "PAM", habitaciones: { doble: 1 },
  ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [], cantidadMenores: 0, cliente: CLIENTE, tipoAsesor: "interno", asesorInterno: "Asesor 127", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: PAX, servicios: [],
});
const cotizar = async (i: unknown) => (await crearCotizacion(i as never)) as Res;
const convertir = async (id: number) => (await convertirCotizacion(id, PAX as never, false, "Asesor 127", null, "COP", null)) as Res;
const CERRADO = /cierre de ventas vigente/;
const NO_VENDIBLE = /cierre de ventas vigente|No se encontró la tarifa/;

describe("#127 V1 · DINÁMICO (salidas manuales) con cierre general: publicación, vitrina, cotización y conversión", () => {
  test("DIN0 baseline: both departures are published at the hand-calculated 750.000 p.p.", async () => {
    await generar(PQ_DIN);
    assert.equal(visible(PQ_DIN, HD, "salida_id", SAL.abierta), PVP.din); assert.equal(visible(PQ_DIN, HD, "salida_id", SAL.cerrada), PVP.din);
    assert.equal(num(`select count(*) from public.tarifario_resultado_publicable where paquete_id = ${PQ_DIN} and modulo = 'dinamico'`) > 0, true, "rows are of the dinámico module");
  });
  test("DIN1 a quotation opened BEFORE the closure; then the closure is saved with NO regeneration (stale published row): display hides it, quotation and conversion refuse, the open departure is unaffected", async () => {
    const previa = await cotizar(inpDin("cerrada")); assert.equal(previa.ok, true, previa.error);
    const previaId = previa.id ?? num("select max(id) from public.cotizaciones");
    cierre(HD, "2030-03-09", "2030-03-11");
    assert.equal(visible(PQ_DIN, HD, "salida_id", SAL.cerrada), PVP.din, "the stale row is still in the published view (no 315, no regeneration)");
    const d = await cargarDatosTarifario(clienteSesion() as never, "test127", "din", clienteLocal(TOKEN_SERVICIO) as never);
    assert.equal(d.ok, true);
    if (d.ok) {
      const filas = d.datos.filasVisibles.filter((f) => f.paquete_id === PQ_DIN && f.hotel_id === HD);
      assert.equal(filas.some((f) => f.salida_id === SAL.cerrada), false, "the closed dinámico departure is hidden by the display layer");
      assert.equal(filas.some((f) => f.salida_id === SAL.abierta), true, "the open departure remains");
    }
    const antes = cuentas();
    const q = await cotizar(inpDin("cerrada")); assert.equal(q.ok, false); assert.match(String(q.error), CERRADO);
    const c = await convertir(previaId); assert.equal(c.ok, false); assert.match(String(c.error), CERRADO);
    assert.deepEqual(cuentas(), antes, "nothing persisted by the rejected quotation / conversion");
    const ok = await cotizar(inpDin("abierta")); assert.equal(ok.ok, true, ok.error);
    assert.equal(num(`select precio_venta from public.cotizaciones where id = ${ok.id ?? "(select max(id) from public.cotizaciones)"}`), PVP.din * 2, "open departure keeps its price (2 × 750.000)");
    limpiar();
  });
  test("DIN2 generation itself: the closed departure is not published, the open one is byte-for-byte the same price", async () => {
    cierre(HD, "2030-03-09", "2030-03-11"); await generar(PQ_DIN);
    assert.equal(visible(PQ_DIN, HD, "salida_id", SAL.cerrada), null);
    assert.equal(num(`select count(*) from public.tarifario_resultado where paquete_id = ${PQ_DIN} and salida_id = ${SAL.cerrada}`), 0);
    assert.equal(visible(PQ_DIN, HD, "salida_id", SAL.abierta), PVP.din);
    const s = await cotizar(inpDin("cerrada")); assert.equal(s.ok, false); assert.match(String(s.error), NO_VENDIBLE);
  });
  test("DIN3 reopening + regeneration restores the departure; boundary check-out day (closure starting on 13-Mar) does not close it", async () => {
    limpiar(); await generar(PQ_DIN);
    assert.equal(visible(PQ_DIN, HD, "salida_id", SAL.cerrada), PVP.din);
    cierre(HD, "2030-03-13", "2030-03-20"); // starts on the check-out day of the 10-13 stay (not an occupied night)... and ends on the first night of the 20-23 stay (inclusive)
    await generar(PQ_DIN);
    assert.equal(visible(PQ_DIN, HD, "salida_id", SAL.cerrada), PVP.din, "check-out day is not an occupied night");
    assert.equal(visible(PQ_DIN, HD, "salida_id", SAL.abierta), null, "the closure end (20-Mar) is inclusive: that stay's first night is closed");
    limpiar(); await generar(PQ_DIN);
  });
});

describe("#127 V1 · EMPAQUETADO (vuelo de sistema, aplica TA sin markup) con cierre general", () => {
  test("EMP0 baseline: both system tickets are published at 695.000 p.p. (375.000 hotel + 320.000 ticket with TA)", async () => {
    await generar(PQ_EMP);
    assert.equal(visible(PQ_EMP, HE, "empaquetado_id", EMPQ.abierto), PVP.emp); assert.equal(visible(PQ_EMP, HE, "empaquetado_id", EMPQ.cerrado), PVP.emp);
  });
  test("EMP1 stale closure without regeneration: display hides it; quotation and conversion refuse; the open source is unaffected", async () => {
    const previa = await cotizar(inpEmp("cerrado")); assert.equal(previa.ok, true, previa.error);
    const previaId = previa.id ?? num("select max(id) from public.cotizaciones");
    cierre(HE, "2030-04-12", "2030-04-12"); // ONE occupied night (the 12th) is enough
    const d = await cargarDatosTarifario(clienteSesion() as never, "test127", "emp", clienteLocal(TOKEN_SERVICIO) as never);
    assert.equal(d.ok, true);
    if (d.ok) {
      const filas = d.datos.filasVisibles.filter((f) => f.paquete_id === PQ_EMP && f.hotel_id === HE);
      assert.equal(filas.some((f) => f.empaquetado_id === EMPQ.cerrado), false, "the closed empaquetado stay is hidden");
      assert.equal(filas.some((f) => f.empaquetado_id === EMPQ.abierto), true, "the open one remains");
    }
    const antes = cuentas();
    const q = await cotizar(inpEmp("cerrado")); assert.equal(q.ok, false); assert.match(String(q.error), CERRADO);
    const c = await convertir(previaId); assert.equal(c.ok, false); assert.match(String(c.error), CERRADO);
    assert.deepEqual(cuentas(), antes);
    const ok = await cotizar(inpEmp("abierto")); assert.equal(ok.ok, true, ok.error);
    assert.equal(num(`select precio_venta from public.cotizaciones where id = ${ok.id ?? "(select max(id) from public.cotizaciones)"}`), PVP.emp * 2);
    limpiar();
  });
  test("EMP2 generation under the closure drops the closed source and keeps the open one; reopening + regeneration restores it", async () => {
    cierre(HE, "2030-04-12", "2030-04-12"); await generar(PQ_EMP);
    assert.equal(visible(PQ_EMP, HE, "empaquetado_id", EMPQ.cerrado), null);
    assert.equal(visible(PQ_EMP, HE, "empaquetado_id", EMPQ.abierto), PVP.emp);
    limpiar(); await generar(PQ_EMP);
    assert.equal(visible(PQ_EMP, HE, "empaquetado_id", EMPQ.cerrado), PVP.emp);
  });
});

describe("#127 V1 · migration 315 hides dinámico and empaquetado rows at once; read failure fails closed", () => {
  before(() => { sql(readFileSync(new URL("../supabase/migrations/20260601000315_tarifario_oculta_por_cierre_general.sql", import.meta.url), "utf8")); });
  test("DB1 saving the closure hides the closed stay of BOTH modules immediately (no regeneration); reopening needs the verified regeneration", async () => {
    await generar(PQ_DIN); await generar(PQ_EMP);
    cierre(HD, "2030-03-11", "2030-03-11"); cierre(HE, "2030-04-11", "2030-04-11");
    assert.equal(visible(PQ_DIN, HD, "salida_id", SAL.cerrada), null); assert.equal(visible(PQ_DIN, HD, "salida_id", SAL.abierta), PVP.din);
    assert.equal(visible(PQ_EMP, HE, "empaquetado_id", EMPQ.cerrado), null); assert.equal(visible(PQ_EMP, HE, "empaquetado_id", EMPQ.abierto), PVP.emp);
    limpiar();
    assert.equal(visible(PQ_DIN, HD, "salida_id", SAL.cerrada), null, "hidden rows stay hidden until regenerated (fail closed)");
    await generar(PQ_DIN); await generar(PQ_EMP);
    assert.equal(visible(PQ_DIN, HD, "salida_id", SAL.cerrada), PVP.din); assert.equal(visible(PQ_EMP, HE, "empaquetado_id", EMPQ.cerrado), PVP.emp);
  });
  test("DB2 closure table unreadable: sales of both modules fail closed (nothing persisted)", async () => {
    sql("alter table public.hotel_blackouts rename to hotel_blackouts_x"); sql("notify pgrst, 'reload schema'");
    for (let i = 0; i < 60; i++) { const r = await fetch(`${PGRST}/hotel_blackouts?select=id&limit=1`, { headers: { apikey: TOKEN_SERVICIO, authorization: `Bearer ${TOKEN_SERVICIO}` } }); if (r.status !== 200) break; await new Promise((res) => setTimeout(res, 250)); }
    try {
      const antes = cuentas();
      const a = await cotizar(inpDin("abierta")); assert.equal(a.ok, false); assert.match(String(a.error), /No se pudo validar la disponibilidad/);
      const b = await cotizar(inpEmp("abierto")); assert.equal(b.ok, false); assert.match(String(b.error), /No se pudo validar la disponibilidad/);
      assert.deepEqual(cuentas(), antes);
    } finally {
      sql("alter table public.hotel_blackouts_x rename to hotel_blackouts"); sql("notify pgrst, 'reload schema'");
      for (let i = 0; i < 60; i++) { const r = await fetch(`${PGRST}/hotel_blackouts?select=id&limit=1`, { headers: { apikey: TOKEN_SERVICIO, authorization: `Bearer ${TOKEN_SERVICIO}` } }); if (r.status === 200) break; await new Promise((res) => setTimeout(res, 250)); }
    }
    assert.equal((await cotizar(inpDin("abierta"))).ok, true);
  });
});
