// #127 — general hotel closure on UNIT-priced hotels (modelo_tarifario = 'unidad', computarReservaBernalo + unit search). REAL actions against disposable PostgreSQL over HTTP.
// The unit model has no per-person accommodations, so only a TOTAL closure, or a closure that closes the whole category in every room accommodation, closes the stay; an
// accommodation-only closure cannot be honoured by a unit tariff: it is NOT applied (the system has no accommodation ↔ unit mapping and none was approved), it is REJECTED on save and
// flagged in the hotel screen. The test below pins the not-applied behaviour and the rejection so neither can change silently.
// Fixture/harness pattern of edadesHotelUnidadU1.pg.ts.
//   MSYS_NO_PATHCONV=1 sh supabase/scripts/test_pg_local.sh pg127 plantilla127 PG127 pruebas/cierreGeneralUnidad127.pg.ts
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
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
const UID_ADMIN = "00000000-0000-0000-0000-000000127101";
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
const solicitudes: string[] = [];
const fetchLocal: typeof fetch = (input, init) => { solicitudes.push(String(input)); return fetch(String(input).replace("/rest/v1/", "/"), init); };
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
}
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

mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/cotizacion/acceso", { namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, tenant: "mayorista" }), autorizaTenant: () => true } });
mock.module("@/lib/contrato/congelarCondicionesContrato", { namedExports: { componenteHotelReal: async () => null, componentePaqueteReal: async () => null, trmReferenciaAproximada: async () => null, congelarCondicionesContratoBestEffort: async () => {} } });
// Service-role client to skip the catalogue RLS (needs an agency session already covered by other suites); the closure rule under test lives in the real action code.
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteLocal(TOKEN_SERVICIO) } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { crearTarifaUnidadBorrador, publicarTarifaUnidad } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/tarifasUnidadActions.ts");
const { computarReservaBernalo } = await import("../lib/reservar/computoReservaBernalo.ts");
const { buscarAlojamientosUnidadPorFechas } = await import("../app/tarifario/busquedaUnidadActions.ts");
const { validarHabitacionesOcupacion } = await import("../lib/reservar/ocupacionPorHabitacion.ts");
const { crearBlackout } = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/blackouts-actions.ts");
const { MENSAJE_CIERRE_UNIDAD_NO_SOPORTADO } = await import("../lib/tarifario/cierresHotel.ts");

const DEST = 12731, PAQ = 12731, H_CERRADO = 12731, H_OTRO = 12732;
const IDA = "2030-06-10", REG = "2030-06-13"; // nights 10, 11, 12 · check-out 13
const REGLAS = [{ categoria: "infante" as const, edadMinAnios: 0, edadMaxAnios: 2 }, { categoria: "nino" as const, edadMinAnios: 3, edadMaxAnios: 10 }, { categoria: "adulto" as const, edadMinAnios: 11, edadMaxAnios: 17 }];
const entrada = (version: string) => ({
  versionTarifario: version, temporada: "ALTA", comisionPct: 20, categoria: "Estandar", alimentacion: "PAM", unidadCobro: "persona" as const, valorBase: 100000, nino: 50000, infante: 0,
  periodicidadInfante: "por_noche" as const, capacidad: { minPax: 1, maxPax: 6, paxIncluidos: 0 }, suplementos: { adultoAdicional: null, personaSola: null, menorAdicionalNino: null, menorAdicionalInfante: null },
  reglasEdad: REGLAS, fuenteDocumento: null, fuentePagina: null,
});

before(async () => {
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin127u@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_ADMIN}', 'admin127u@x.test', 'Admin 127 U', 'administracion', true, 'mayorista') on conflict (id) do update set rol = excluded.rol, activo = true;
    insert into public.destinos (id, nombre) values (${DEST}, 'CARTAGENA U127') on conflict do nothing;
    insert into public.proveedores (id, nombre, tipo) values (12731, 'Proveedor Hotel U127', 'hotelero') on conflict do nothing;
    insert into public.categorias_habitacion (nombre) values ('Estandar') on conflict do nothing;
    insert into public.planes_alimentacion (codigo, nombre) values ('PAM', 'Pension alimenticia media') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, modelo_tarifario, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo, adults_only) values
      (${H_CERRADO}, ${DEST}, 'U127 Hotel cerrado', 12731, 'COP', 'unidad', 0, 2, 3, 10, 1, 6, true, false), (${H_OTRO}, ${DEST}, 'U127 Hotel otro', 12731, 'COP', 'unidad', 0, 2, 3, 10, 1, 6, true, false);
    insert into public.hotel_categorias (hotel_id, categoria_id) select h, (select id from public.categorias_habitacion where nombre = 'Estandar') from unnest(array[${H_CERRADO},${H_OTRO}]) h;
    insert into public.hotel_regimenes (hotel_id, plan_id) select h, (select id from public.planes_alimentacion where codigo = 'PAM') from unnest(array[${H_CERRADO},${H_OTRO}]) h;
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) select h, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa' from unnest(array[${H_CERRADO},${H_OTRO}]) h;
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
      values (${PAQ}, 'Porción U127', 'porcion_terrestre', 3, ${DEST}, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) select ${PAQ}, h, array['Estandar'], array['PAM'] from unnest(array[${H_CERRADO},${H_OTRO}]) h;
  `);
  for (const h of [H_CERRADO, H_OTRO]) {
    const c = await crearTarifaUnidadBorrador(h, entrada(`u127-${h}`));
    assert.equal(c.ok, true, JSON.stringify(c));
    const p = await publicarTarifaUnidad((c as { id: number }).id, h);
    assert.equal(p.ok, true, JSON.stringify(p));
  }
});

const hab = () => { const v = validarHabitacionesOcupacion([{ id: "h1", acom: "doble", adultos: 2, cantidadMenores: 0, edadesMenores: [] }]); assert.equal(v.ok, true); return (v as { ok: true; habitaciones: never[] }).habitaciones; };
const cotizar = (hotelId: number, ida = IDA, reg = REG, categoria = "Estandar") => computarReservaBernalo({ paqueteId: PAQ, hotelId, categoria, alimentacion: "PAM", salida: { tipo: "sin_vuelo", fechaIda: ida, fechaRegreso: reg }, habitaciones: hab() } as never) as Promise<{ ok: boolean; codigo?: string; mensaje?: string; precioVenta?: number }>;
const cierre = (ini: string, fin: string, extra = "true, null, null") => sql(`insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total, acomodaciones, categorias) values (${H_CERRADO}, '${ini}', '${fin}', ${extra})`);
const limpiar = () => sql(`delete from public.hotel_blackouts where hotel_id = ${H_CERRADO}`);
const buscar = () => buscarAlojamientosUnidadPorFechas({ fechaIda: IDA, fechaRegreso: REG, destino: "CARTAGENA U127", destinoId: DEST, habitaciones: [{ acom: "doble" }], adultos: 2, cantidadMenores: 0, edadesMenores: [] } as never);
const CERRADO = /cierre de ventas vigente/;

describe("#127 · unit-priced hotels (computarReservaBernalo and unit search)", () => {
  let precioBase = 0;
  test("U0 baseline: both hotels quote the same positive price", async () => {
    const a = await cotizar(H_CERRADO), b = await cotizar(H_OTRO);
    assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(b.ok, true, JSON.stringify(b));
    precioBase = a.precioVenta!;
    assert.ok(precioBase > 0); assert.equal(b.precioVenta, precioBase);
  });
  test("U1 total closure touching ONE occupied night rejects the stay (and only that hotel); price of the other hotel unchanged", async () => {
    cierre("2030-06-12", "2030-06-12");
    const r = await cotizar(H_CERRADO);
    assert.equal(r.ok, false); assert.equal(r.codigo, "no_cotizable"); assert.match(String(r.mensaje), CERRADO);
    const o = await cotizar(H_OTRO); assert.equal(o.ok, true); assert.equal(o.precioVenta, precioBase);
    limpiar();
  });
  test("U2 boundaries: closure starting on the CHECK-OUT day sells; closure ending on the FIRST night rejects; closure ending the day before sells", async () => {
    cierre("2030-06-13", "2030-06-20");
    assert.equal((await cotizar(H_CERRADO)).ok, true, "check-out day is not an occupied night"); limpiar();
    cierre("2030-06-01", "2030-06-10");
    assert.equal((await cotizar(H_CERRADO)).ok, false, "last closed night = first night of the stay (inclusive end)"); limpiar();
    cierre("2030-06-01", "2030-06-09");
    assert.equal((await cotizar(H_CERRADO)).ok, true, "closure ended the day before the stay"); limpiar();
  });
  test("U3 category closure (Estandar, every accommodation) rejects; an accommodation-only closure does NOT close a unit tariff (documented limit)", async () => {
    cierre("2030-06-01", "2030-06-30", "false, null, array['Estandar']");
    assert.equal((await cotizar(H_CERRADO)).ok, false); limpiar();
    cierre("2030-06-01", "2030-06-30", "false, array['doble'], null");
    assert.equal((await cotizar(H_CERRADO)).ok, true, "a unit tariff is not priced per accommodation"); limpiar();
    cierre("2030-06-01", "2030-06-30", "false, null, array['Suite']");
    assert.equal((await cotizar(H_CERRADO)).ok, true, "closing another category leaves Estandar sellable"); limpiar();
  });
  test("U3b the unsupported dimension is REPORTED, not hidden: saving an accommodation-only closure on a unit hotel is rejected with the explicit message; total and category closures are accepted", async () => {
    const solo = await crearBlackout({ hotelId: H_CERRADO, fechaInicio: "2030-08-01", fechaFin: "2030-08-05", total: false, acomodaciones: ["doble"], categorias: [], motivo: "u" });
    assert.equal(solo.ok, false); assert.equal((solo as { error: string }).error, MENSAJE_CIERRE_UNIDAD_NO_SOPORTADO);
    const mixto = await crearBlackout({ hotelId: H_CERRADO, fechaInicio: "2030-08-01", fechaFin: "2030-08-05", total: false, acomodaciones: ["doble"], categorias: ["Estandar"], motivo: "u" });
    assert.equal(mixto.ok, false, "category + accommodation is also an accommodation dimension");
    assert.equal(Number(sql(`select count(*) from public.hotel_blackouts where hotel_id = ${H_CERRADO}`)), 0, "nothing was stored by the rejected attempts");
    const total = await crearBlackout({ hotelId: H_CERRADO, fechaInicio: "2030-08-01", fechaFin: "2030-08-05", total: true, acomodaciones: [], categorias: [], motivo: "u" }); assert.equal(total.ok, true);
    const cat = await crearBlackout({ hotelId: H_CERRADO, fechaInicio: "2030-09-01", fechaFin: "2030-09-05", total: false, acomodaciones: [], categorias: ["Estandar"], motivo: "u" }); assert.equal(cat.ok, true);
    limpiar();
  });
  test("U4 unit search: the closed hotel is reported unavailable (not offered), the other one is; reopening restores it", async () => {
    cierre("2030-06-12", "2030-06-12");
    const r = await buscar(); assert.equal(r.ok, true, JSON.stringify(r));
    const estado = new Map((r as Extract<typeof r, { ok: true }>).disponibilidad.map((d) => [d.hotelId, d.estado]));
    assert.notEqual(estado.get(H_CERRADO), "disponible"); assert.equal(estado.get(H_OTRO), "disponible");
    limpiar();
    const r2 = await buscar(); const e2 = new Map((r2 as Extract<typeof r2, { ok: true }>).disponibilidad.map((d) => [d.hotelId, d.estado]));
    assert.equal(e2.get(H_CERRADO), "disponible");
  });
  test("U5 a failure reading closures fails CLOSED with a retry message (never «no closures»)", async () => {
    await renombrarTabla(true);
    try { const r = await cotizar(H_CERRADO); assert.equal(r.ok, false); assert.match(String(r.mensaje), /No se pudo validar la disponibilidad/); }
    finally { await renombrarTabla(false); }
    assert.equal((await cotizar(H_CERRADO)).ok, true);
  });
  test("U6 workload: a unit quotation reads the closures ONCE (page + empty page)", async () => {
    cierre("2030-07-01", "2030-07-02");
    solicitudes.length = 0;
    await cotizar(H_CERRADO);
    const n = solicitudes.filter((u) => /\/hotel_blackouts\?/.test(u)).length;
    console.log(`      lecturas de hotel_blackouts por cotización por unidad: ${n}`);
    assert.equal(n, 2);
    limpiar();
  });
});
