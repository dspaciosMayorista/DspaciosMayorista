// #94 — conversión REAL del carrito contra PostgreSQL + PostgREST locales: el resumen de precios por pasajero llega al contrato (migración 304),
// fallo de guardado con reintento, histórico sin snapshot e inconsistencias. Lo ÚNICO simulado: la sesión (auth.getUser) y la numeración (RPC real).
// SOLO base LOCAL desechable. La lanza supabase/scripts/test_304_conversion_resumen.sh.
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import fs from "node:fs";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";
import { cabecerasIdentidad, type IdentidadContrato } from "../lib/contrato/identidad.ts";

const CT = process.env.PG94_CONTENEDOR ?? "";
const DB = process.env.PG94_BASE ?? "";
const PGRST = process.env.PG94_POSTGREST ?? "";
const SECRETO = process.env.PG94_JWT_SECRET ?? "";
if (!CT || !DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG94_*: usa supabase/scripts/test_304_conversion_resumen.sh.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(specifier, context, nextResolve) {
  const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
  try { return nextResolve(specifier, context); } catch (e) {
    // los módulos de la app importan rutas relativas SIN extensión (resuelve Next/webpack); aquí se prueba con .ts
    if (specifier.startsWith(".") && !/.[a-z]+$/.test(specifier)) { for (const suf of [".ts", "/index.ts"]) { try { return nextResolve(specifier + suf, context); } catch { /* sigue */ } } }
    throw e;
  }
} });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const UID_ADMIN = "00000000-0000-0000-0000-000000094003";
const UID_SUPER = "00000000-0000-0000-0000-000000094001";
let uidSesion = UID_ADMIN;
// sesión VIVA en auth.sessions (la exigen agencia_activa_sesion() y puede_escribir_catalogo_global(), de las que dependen las policies de catálogo global)
const sidDe = (uid: string) => uid.replace(/^00000000/, "5e550000");
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-94";
// Contador de solicitudes HTTP a PostgREST (validación de consumo, #75): toda llamada de la app pasa por aquí.
const solicitudesHttp = { n: 0, rutas: [] as string[] };
const fetchLocal: typeof fetch = (input, init) => {
  solicitudesHttp.n++;
  solicitudesHttp.rutas.push(`${init?.method ?? "GET"} ${String(input).replace(/^https?:\/\/[^/]+/, "").replace("/rest/v1/", "/").split("?")[0]}`);
  return fetch(String(input).replace("/rest/v1/", "/"), init);
};
function clienteLocal(token: string, usuario?: { id: string; email: string }, cab?: Record<string, string>) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: cab, fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
let usarClienteSesion: ReturnType<typeof clienteLocal> | null = null;
const clienteSesion = (identidad?: IdentidadContrato) => usarClienteSesion ?? clienteLocal(jwt({ role: "authenticated", sub: uidSesion, session_id: sidDe(uidSesion) }), { id: uidSesion, email: `${uidSesion}@x.test` }, cabecerasIdentidad(identidad));

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
}
const lit = (v: unknown) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/cotizacion/acceso", { namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, tenant: "mayorista" }), autorizaTenant: () => true } });
mock.module("@/lib/contrato/congelarCondicionesContrato", {
  namedExports: { componenteHotelReal: async () => null, componentePaqueteReal: async () => null, trmReferenciaAproximada: async () => null, congelarCondicionesContratoBestEffort: async () => {} },
});
const { interpretarRespuestaNumeroContrato } = await import("../lib/contrato/numeracionPuro.ts");
mock.module("@/lib/contrato/numeracion", {
  namedExports: { siguienteNumeroContrato: async (tenant: string) => { const { data, error } = await clienteLocal(TOKEN_SERVICIO).rpc("siguiente_numero_contrato_para_tenant", { p_tenant: tenant }); return interpretarRespuestaNumeroContrato(data, error as never); } },
});
mock.module("@/lib/supabase/server", { namedExports: { createClient: async (identidad?: IdentidadContrato) => clienteSesion(identidad) } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: (identidad?: IdentidadContrato) => clienteLocal(TOKEN_SERVICIO, undefined, cabecerasIdentidad(identidad)) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });
const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const { convertirCotizacionCarrito } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");
const { leerResumenContrato } = await import("../lib/contrato/resumenPreciosContrato.ts");
const { resumenAplicable } = await import("../lib/cotizacion/resumenPrecios.ts");

// ── Semilla mínima: un hotel con vuelo bloqueado (paquete de bloqueo), publicado por el generador REAL ──
const PAQ_BQ = 9403, HOT1 = 9410, BQ = 9410;
before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin94@x.test'), ('${UID_SUPER}', 'super94@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_ADMIN}', 'admin94@x.test', 'Admin 94', 'administracion', true, 'mayorista'), ('${UID_SUPER}', 'super94@x.test', 'Super 94', 'superadmin', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into auth.sessions (id, user_id) select ('5e550000' || substr(id::text, 9))::uuid, id from public.usuarios where id in ('${UID_ADMIN}', '${UID_SUPER}') on conflict do nothing;
    insert into public.destinos (id, nombre) values (9401, 'CARTAGENA 94') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (9401, 'Hoteles 94') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
      values (${HOT1}, 9401, 'Hotel Uno 94', 9401, 'COP', 0, 5, 6, 12, 1, 6, true);
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (${HOT1}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (${HOT1}, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa');
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante)
      values (${HOT1}, 'Estandar', 'Desayuno', 'ALTA', 150000, 100000, 50000, 30000, 40000);
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
      values (${PAQ_BQ}, 'Bloqueo 94', 'bloqueo', 3, 9401, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (${PAQ_BQ}, ${HOT1}, array['Estandar'], array['Desayuno']);
    insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, cupos_total, tarifa_para_empaquetar, fee_infante, destino_id, proveedor_id, moneda, origen)
      values (${BQ}, 'R94', 'Aerolínea 94', 'BOG - CTG - BOG', 'AV94', '2030-06-01', '21:00', 'AV95', '2030-06-04', '22:00', 20, 300000, 0, 9401, 9401, 'COP', 'BOG');
    insert into public.sillas (bloqueo_id, numero_silla, estado) select ${BQ}, g, 'disponible' from generate_series(1, 20) g;
    insert into public.armado_vuelos (paquete_id, bloqueo_id, aplica_mk, ta) values (${PAQ_BQ}, ${BQ}, true, 0);
  `);
});

const PAX = Array.from({ length: 6 }, (_, i) => ({ nombres: `Pax${i + 1}`, apellidos: "Prueba", tipoDoc: "CC", numeroDoc: `${9000 + i}`, fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false }));
const CLIENTE = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com", tipoDoc: "CC" };
const itemHotel = { modulo: "bloqueo", paqueteId: PAQ_BQ, hotelId: HOT1, bloqueoId: BQ, hotelNombre: "Hotel Uno 94", destino: "CARTAGENA 94", categoria: "Estandar", regimen: "Desayuno", fechaIda: null, fechaRegreso: null, noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0, itemId: "h94" };
type Res = { ok: boolean; error?: string; numeros?: string[] };
const convertir = (id: number) => convertirCotizacionCarrito(id, { agrupar: "todo", pasajeros: PAX.slice(0, 2), asesorInterno: "Asesor 94", asignaciones: [[1, 2]], asignacionesTours: [], monedaCobro: "COP" } as never) as Promise<Res>;
async function cotizar() {
  const r = (await crearSolicitudReserva({ items: [itemHotel], tours: [], cliente: CLIENTE } as never)) as { ok: boolean; error?: string; cotizacion?: { id: number } };
  assert.equal(r.ok, true, r.error);
  return Number(r.cotizacion!.id);
}
const detalleDe = (id: number) => JSON.parse(sql(`select detalle::text from public.cotizaciones where id = ${id}`)) as Record<string, unknown>;
const foto = () => ({
  ventas: sql("select count(*) from public.ventas"), resumenes: sql("select count(*) from public.contrato_resumen_precios"), cxp: sql("select count(*) from public.cuentas_por_pagar"),
  items: sql("select count(*) from public.contrato_items"), pas: sql("select count(*) from public.contrato_pasajeros"),
  ultimo: sql("select coalesce(max(substring(numero_contrato from 5)::int), 0) from public.ventas where numero_contrato ~ '^DTM-[0-9]+$'"),
});
const clienteInterno = () => clienteLocal(jwt({ role: "authenticated", sub: UID_SUPER, session_id: sidDe(UID_SUPER) }), { id: UID_SUPER, email: "super94@x.test" });
const precioCentavos = (n: string) => Math.round(Number(sql(`select precio_venta from public.ventas where numero_contrato = ${lit(n)}`)) * 100);

describe("#94 · conversión REAL: el resumen de precios llega al contrato", () => {
  let idCot = 0, numero = "";
  test("R0 se publica el tarifario con el generador real", async () => {
    const g = await generarTarifario(PAQ_BQ); assert.equal(g.ok, true, JSON.stringify(g));
  });
  test("R1 la cotización nueva trae un resumen de precios VÁLIDO (y la base lo acepta)", async () => {
    idCot = await cotizar();
    const d = detalleDe(idCot);
    assert.ok(d.resumenPrecios, `la cotización debe traer resumenPrecios (resumenPendiente=${String(d.resumenPendiente)})`);
    assert.equal(sql(`select public.p94_resumen_valido((detalle->'resumenPrecios')) from public.cotizaciones where id = ${idCot}`), "t", "el validador de la base acepta el resumen que genera la aplicación");
  });
  test("R2 convertir: el contrato nace con su resumen, que cuadra con lo exigible", async () => {
    const r = await convertir(idCot); assert.equal(r.ok, true, r.error);
    numero = r.numeros![0];
    assert.equal(sql(`select count(*) from public.contrato_resumen_precios where numero_contrato = ${lit(numero)}`), "1");
    const fila = JSON.parse(sql(`select resumen::text from public.contrato_resumen_precios where numero_contrato = ${lit(numero)}`));
    const ok = resumenAplicable(fila, { modalidad: "pvp", moneda: "COP", totalCentavos: precioCentavos(numero) });
    assert.ok(ok, "el resumen guardado es aplicable al total del contrato");
    assert.equal(fila.unidades.length, 1);
  });
  test("R3 se relee desde las DOS rutas de documento: sesión interna (RLS real) y enlace público (servicio)", async () => {
    const interno = await leerResumenContrato(clienteInterno(), numero);
    const publico = await leerResumenContrato(clienteLocal(TOKEN_SERVICIO), numero);
    assert.ok(interno, "la ficha/impresión interna lo lee con RLS");
    assert.ok(publico, "el enlace público lo lee con la llave de servicio");
    assert.deepEqual(interno, publico, "ambas rutas ven el mismo resumen");
    const ajeno = await leerResumenContrato(clienteLocal(jwt({ role: "authenticated", sub: UID_ADMIN, session_id: sidDe(UID_ADMIN) }), { id: UID_ADMIN, email: "a@x.test" }), "DTM-0000");
    assert.equal(ajeno, null, "un contrato sin fila (o ajeno) no devuelve nada");
  });
  test("R4 un error de lectura NO se disfraza de contrato histórico", async () => {
    const roto = clienteLocal("token-invalido");
    await assert.rejects(() => leerResumenContrato(roto, numero), /No se pudo leer el resumen de precios/);
  });
});

describe("#94 · fallo de guardado y reintento (sin duplicar ni revertir a ciegas)", () => {
  test("F1 si falla guardar el resumen, la conversión se rechaza: sin contrato, sin CxP, sin ítems y la cotización sigue abierta", async () => {
    const id = await cotizar();
    sql(`create or replace function public.t_falla_resumen94() returns trigger language plpgsql as $f$ begin raise exception 'FALLA_SIMULADA_94'; end $f$;
         drop trigger if exists t_falla_resumen94 on public.contrato_resumen_precios;
         create trigger t_falla_resumen94 before insert on public.contrato_resumen_precios for each row execute function public.t_falla_resumen94();`);
    const antes = foto();
    const r = await convertir(id);
    assert.equal(r.ok, false, "debe fallar");
    assert.match(r.error ?? "", /No se pudo guardar el resumen de precios del contrato/, `mensaje claro (fue «${r.error}»)`);
    const despues = foto();
    assert.equal(despues.ventas, antes.ventas, "ningún contrato quedó vivo (se revirtió el grupo incompleto)");
    assert.equal(despues.resumenes, antes.resumenes); assert.equal(despues.cxp, antes.cxp); assert.equal(despues.items, antes.items); assert.equal(despues.pas, antes.pas);
    assert.equal(sql(`select estado from public.cotizaciones where id = ${id}`), "abierta", "la cotización sigue abierta para reintentar");
    assert.equal(sql(`select coalesce(detalle->'contratos', 'null'::jsonb)::text from public.cotizaciones where id = ${id}`), "null", "no quedó progreso falso en la cotización");
    (globalThis as unknown as { __id94: number }).__id94 = id;
  });
  test("F2 reintentar la MISMA cotización, ya sin la falla: se crea UN solo contrato con su resumen (sin duplicados)", async () => {
    const id = (globalThis as unknown as { __id94: number }).__id94;
    sql("drop trigger if exists t_falla_resumen94 on public.contrato_resumen_precios; drop function if exists public.t_falla_resumen94();");
    const antes = foto();
    const r = await convertir(id); assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    const despues = foto();
    assert.equal(Number(despues.ventas), Number(antes.ventas) + 1, "exactamente un contrato nuevo");
    assert.equal(Number(despues.resumenes), Number(antes.resumenes) + 1, "exactamente un resumen nuevo");
    assert.equal(sql(`select jsonb_array_length(detalle->'contratos') from public.cotizaciones where id = ${id}`), "1", "la cotización registra UN solo contrato");
    assert.equal(sql(`select (detalle->'contratos'->>0) from public.cotizaciones where id = ${id}`), n, "y es el recién creado");
    assert.ok(await leerResumenContrato(clienteLocal(TOKEN_SERVICIO), n));
    const r2 = await convertir(id);
    assert.equal(Number(foto().ventas), Number(despues.ventas), "un tercer intento no duplica nada");
    void r2;
  });
});

describe("#94 · distinguir histórico, inconsistente y no aplicable", () => {
  test("H1 una cotización SIN resumen (histórica) convierte como siempre y el contrato queda sin fila", async () => {
    const id = await cotizar();
    sql(`update public.cotizaciones set detalle = detalle - 'resumenPrecios' where id = ${id}`);
    const r = await convertir(id); assert.equal(r.ok, true, r.error);
    assert.equal(sql(`select count(*) from public.contrato_resumen_precios where numero_contrato = ${lit(r.numeros![0])}`), "0");
    assert.equal(await leerResumenContrato(clienteLocal(TOKEN_SERVICIO), r.numeros![0]), null, "sin snapshot ⇒ null, no error");
  });
  test("H2 resumen NUEVO que no cuadra con el contrato: se rechaza ANTES de numerar (sin gastar consecutivo ni escribir nada)", async () => {
    const id = await cotizar();
    // Mismo formato válido pero con otro total: la estructura suma, el acuerdo no.
    sql(`update public.cotizaciones set detalle = jsonb_set(jsonb_set(jsonb_set(detalle, '{resumenPrecios,totalCentavos}', '1000000'::jsonb), '{resumenPrecios,unidades,0,totalCentavos}', '1000000'::jsonb), '{resumenPrecios,unidades,0,grupos}', '[{"tipo":"adulto","cantidad":1,"tarifaCentavos":1000000,"subtotalCentavos":1000000,"incluye":[],"cupos":["x"]}]'::jsonb) where id = ${id}`);
    const antes = foto();
    const r = await convertir(id);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /no coincide con el total de este contrato/);
    assert.deepEqual(foto(), antes, "ni contrato, ni resumen, ni CxP, ni número reservado");
    assert.equal(sql(`select estado from public.cotizaciones where id = ${id}`), "abierta");
  });
  test("H3 resumen con estructura inválida (nulos): también se rechaza antes de numerar", async () => {
    const id = await cotizar();
    sql(`update public.cotizaciones set detalle = jsonb_set(detalle, '{resumenPrecios,moneda}', 'null'::jsonb) where id = ${id}`);
    const antes = foto();
    const r = await convertir(id);
    assert.equal(r.ok, false); assert.deepEqual(foto(), antes);
  });
});
