// 262 — traslados por ALCANCE: recorrido de venta REAL contra PostgreSQL por HTTP, sin simular dinero ni catálogo:
//   generarTarifario → buscarReceptivos → crearSolicitudReserva (cotización) → convertirCotizacionCarrito → ventas / contrato_items / cuentas_por_pagar.
// Lo ÚNICO simulado: la sesión (auth.getUser; el cliente de sesión es PostgREST real con JWT `authenticated`), la numeración (RPC real) y dos efectos laterales ajenos.
// SOLO base LOCAL desechable. Lo lanza supabase/scripts/test_262_venta_alcance.sh.
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import fs from "node:fs";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG262_CONTENEDOR ?? "";
const DB = process.env.PG262_BASE ?? "";
const PGRST = process.env.PG262_POSTGREST ?? "";
const SECRETO = process.env.PG262_JWT_SECRET ?? "";
if (!CT || !DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG262_*: usa supabase/scripts/test_262_venta_alcance.sh.");

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
const UID_ADMIN = "00000000-0000-0000-0000-000000262003";
const UID_SUPER = "00000000-0000-0000-0000-000000262001";
let uidSesion = UID_ADMIN;
// sesión VIVA en auth.sessions (la exigen agencia_activa_sesion() y puede_escribir_catalogo_global(), de las que dependen las policies de catálogo global)
const sidDe = (uid: string) => uid.replace(/^00000000/, "5e550000");
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-262";
const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
let usarClienteSesion: ReturnType<typeof clienteLocal> | null = null;
const clienteSesion = () => usarClienteSesion ?? clienteLocal(jwt({ role: "authenticated", sub: uidSesion, session_id: sidDe(uidSesion) }), { id: uidSesion, email: `${uidSesion}@x.test` });

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
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { buscarReceptivos, liquidarServicioPuntual } = await import("../lib/reservar/cotizar.ts");
const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const { convertirCotizacionCarrito } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { reconciliarFinancieroPendienteCron } = await import("../app/(dashboard)/dashboard/reservar/reconciliacion-actions.ts");
const { crearCotizacion, convertirCotizacion } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { eliminarServicio } = await import("../app/(dashboard)/dashboard/producto/servicios/actions.ts");
const { MENSAJE_SERVICIO_CON_OBLIGACIONES, MENSAJE_SERVICIO_PUBLICADO, esRechazoServicioPublicado, mensajeErrorEliminarServicio, esRechazoServicioConObligaciones } = await import("../lib/servicios/eliminarServicio.ts");
const { crearComparativaCarrito, elegirOpcionComparativa } = await import("../app/tarifario/checkout/actions.ts");
const { crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");
const { guardarServiciosContrato } = await import("../app/(dashboard)/dashboard/contratos/[numero]/contenido-actions.ts");

// ── Semilla ───────────────────────────────────────────────────────────────
// Paquete de SERVICIOS 6201, markup 20 %: PVP = ceil_mil(neto / 0.8). Vigencia ALTA 2030 en todos; sin GENERAL vendible.
//  6201 traslado por persona: trayecto 100.000 · ida y regreso 170.000 por persona · franja 19:00–06:00 de 30.000 por GRUPO (tramo «ambos» = cada tramo)
//  6202 traslado por GRUPO: trayecto 1–4 = 200.000, 5–8 = 300.000 · ida y regreso 1–4 = 350.000, 5–8 = 500.000
//  6203 traslado con SOLO precio de un trayecto (90.000/persona): ida y regreso no tiene tarifa propia
//  6204 traslado cuya única vigencia es GENERAL (no vendible)
//  6205 LEGADO sin clasificar, 50.000/persona · 6206 tour clasificado «tour», 40.000/persona
//  6207 sin clasificar al cotizar (se clasificará como traslado después) · 6208 traslado persona para el escenario «el precio cambió»
const PAQ = 6201, S_TR = 6201, S_GR = 6202, S_SIN = 6203, S_GEN = 6204, S_LEG = 6205, S_TOUR = 6206, S_PRE = 6207, S_CAMB = 6208;
const ALTA = (s: number) => 620000 + s; // id de la vigencia ALTA del servicio s
const H_DIA = { llegada: "10:00", salida: "11:00" }, H_NOCHE = { llegada: "21:00", salida: "22:00" }, H_MIXTA = { llegada: "10:00", salida: "22:00" };
const pvp = (neto: number) => Math.ceil((neto * 10) / 8 / 1000) * 1000; // neto / (1 - 0,20) redondeado al millar hacia arriba, sin flotantes

before(() => {
  sql(`
    create table if not exists public.t_pay262 (numero text primary key, costos jsonb, cxp jsonb);
    create or replace function public.t_copiar_pay262() returns trigger language plpgsql as $f$ begin insert into public.t_pay262 values (new.numero_contrato, new.costos, new.cxp) on conflict (numero) do update set costos = excluded.costos, cxp = excluded.cxp; return new; end $f$;
    drop trigger if exists t_copiar_pay262 on public.contrato_financiero_pendiente;
    create trigger t_copiar_pay262 after insert or update on public.contrato_financiero_pendiente for each row execute function public.t_copiar_pay262();
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin262@x.test'), ('${UID_SUPER}', 'super262@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_ADMIN}', 'admin262@x.test', 'Admin 262', 'administracion', true, 'mayorista'), ('${UID_SUPER}', 'super262@x.test', 'Super 262', 'superadmin', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into public.destinos (id, nombre) values (6201, 'CARTAGENA 262') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (6201, 'Transportes 262') on conflict do nothing;
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
      values (${PAQ}, 'Servicios 262', 'servicios', 3, 6201, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true) on conflict do nothing;
    insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion, tipo_receptivo) values
      (${S_TR},   'Traslado persona 262', 6201, 6201, 0, 'tour_traslado', 'COP', 'persona', 'paquete', 'traslado'),
      (${S_GR},   'Traslado grupo 262',   6201, 6201, 0, 'tour_traslado', 'COP', 'grupo',   'paquete', 'traslado'),
      (${S_SIN},  'Traslado un solo precio 262', 6201, 6201, 0, 'tour_traslado', 'COP', 'persona', 'paquete', 'traslado'),
      (${S_GEN},  'Traslado solo GENERAL 262', 6201, 6201, 80000, 'tour_traslado', 'COP', 'persona', 'paquete', 'traslado'),
      (${S_LEG},  'Tour legado 262',      6201, 6201, 50000, 'tour_traslado', 'COP', 'persona', 'paquete', null),
      (${S_TOUR}, 'Tour clasificado 262', 6201, 6201, 40000, 'tour_traslado', 'COP', 'persona', 'paquete', 'tour'),
      (${S_PRE},  'Traslado anterior 262', 6201, 6201, 100000, 'tour_traslado', 'COP', 'persona', 'paquete', null),
      (${S_CAMB}, 'Traslado cambiante 262', 6201, 6201, 0, 'tour_traslado', 'COP', 'persona', 'paquete', 'traslado');
    insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values
      ${[S_TR, S_GR, S_SIN, S_LEG, S_TOUR, S_PRE, S_CAMB].map((s) => `(${ALTA(s)}, ${s}, 'ALTA', '2030-01-01', '2030-12-31', ${s === S_LEG ? 50000 : s === S_TOUR ? 40000 : s === S_PRE ? 100000 : 0})`).join(",")},
      (${ALTA(S_GEN)}, ${S_GEN}, 'GENERAL', null, null, 80000);
    insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, pax_desde, pax_hasta, precio) values
      (${ALTA(S_TR)}, 'trayecto', null, null, 100000), (${ALTA(S_TR)}, 'ida_regreso', null, null, 170000),
      (${ALTA(S_GR)}, 'trayecto', 1, 4, 200000), (${ALTA(S_GR)}, 'trayecto', 5, 8, 300000), (${ALTA(S_GR)}, 'ida_regreso', 1, 4, 350000), (${ALTA(S_GR)}, 'ida_regreso', 5, 8, 500000),
      (${ALTA(S_SIN)}, 'trayecto', null, null, 90000),
      (${ALTA(S_CAMB)}, 'trayecto', null, null, 100000);
    insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values
      (${ALTA(S_TR)}, '19:00', '06:00', 'ambos', 'monto', 30000, 'grupo');
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values
      ${[S_TR, S_SIN, S_GEN, S_LEG, S_TOUR, S_PRE, S_CAMB].map((s) => `(${PAQ}, ${s}, 'persona', false)`).join(",")}, (${PAQ}, ${S_GR}, 'grupo', false);
  `);
});

// ── utilidades ────────────────────────────────────────────────────────────
const PAX = Array.from({ length: 9 }, (_, i) => ({ nombres: `Pax${i + 1}`, apellidos: "Prueba", tipoDoc: "CC", numeroDoc: `${1000 + i}`, fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false }));
const CLIENTE = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };
type Res = { ok: boolean; error?: string; numeros?: string[] };
const tour = (servicioId: number, pax: number, extra: Record<string, unknown> = {}) => ({ servicioId, paqueteId: PAQ, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax, ...extra });
async function cotizar(tours: unknown[]) {
  const r = (await crearSolicitudReserva({ items: [], tours, hotelDeTour: tours.map(() => null), cliente: CLIENTE } as never)) as { ok: boolean; error?: string; cotizacion?: { id: number } };
  return r;
}
async function cotizarOk(tours: unknown[]) { const r = await cotizar(tours); assert.equal(r.ok, true, r.error); return Number(r.cotizacion!.id); }
async function convertir(id: number, nTours = 1, pax: number | number[] = 2, o: { asignaciones?: number[][]; extra?: Record<string, unknown> } = {}): Promise<Res> {
  const porTour = Array.from({ length: nTours }, (_, k) => (Array.isArray(pax) ? pax[k] : pax));
  return (await convertirCotizacionCarrito(id, {
    agrupar: "todo", pasajeros: PAX.slice(0, Math.max(...porTour)), asesorInterno: "Asesor 262", asignaciones: o.asignaciones ?? [], asignacionesTours: porTour.map((n) => Array.from({ length: n }, (_, i) => i + 1)), monedaCobro: "COP", ...(o.extra ?? {}),
  })) as Res;
}
const tourCot = (id: number) => JSON.parse(sql(`select (payload->'tours'->0)::text from public.cotizaciones where id = ${id}`)) as Record<string, unknown>;
const setTourCot = (id: number, clave: string, valor: unknown) => sql(`update public.cotizaciones set payload = jsonb_set(payload, '{tours,0,${clave}}', ${lit(JSON.stringify(valor))}::jsonb) where id = ${id}`);
const foto = () => ({
  ventas: sql("select count(*) from public.ventas"), cxp: sql("select count(*) from public.cuentas_por_pagar"), items: sql("select count(*) from public.contrato_items"),
  pas: sql("select count(*) from public.contrato_pasajeros"), serv: sql("select count(*) from public.contrato_servicios"),
  ultimo: sql("select coalesce(max(substring(numero_contrato from 5)::int), 0) from public.ventas where numero_contrato ~ '^DTM-[0-9]+$'"),
});
async function noEscribe(que: string, id: number, esperaError: RegExp, nTours = 1, pax = 2) {
  const antes = foto();
  const r = await convertir(id, nTours, pax);
  assert.equal(r.ok, false, `${que}: debe fallar`);
  assert.match(r.error ?? "", esperaError, `${que}: mensaje (fue «${r.error}»)`);
  assert.deepEqual(foto(), antes, `${que}: ni contrato, ni ventas, ni CxP, ni ítems, ni pasajeros, ni número reservado`);
  assert.equal(sql(`select estado from public.cotizaciones where id = ${id}`), "abierta", `${que}: la cotización sigue abierta`);
}
const itemDe = (n: string) => sql(`select descripcion || '|' || tarifa_adulto::bigint from public.contrato_items where numero_contrato = ${lit(n)} and descripcion like 'Servicio ·%'`);
const cxpDe = (n: string) => sql(`select coalesce(string_agg(servicio || '|' || tipo_proveedor || '|' || valor_total::bigint || '|' || coalesce(servicio_id::text,'-') || '|' || moneda, ' ; ' order by id), '') from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`);
const precioVenta = (n: string) => Number(sql(`select precio_venta from public.ventas where numero_contrato = ${lit(n)}`));
type Esp = { s: number; alcance: string; costo: number };
type Linea = { clave_enlace: string; id: number; servicio_id: number; alcance_traslado: string; costo: number; tipo: string; descripcion: string };
type Cxp = { observaciones: string; id: number; contrato_servicio_id: number | null; alcance_traslado: string | null; servicio_id: number | null; valor_total: number; servicio: string };
const lineasAlcance = (n: string) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('id', id, 'servicio_id', servicio_id, 'alcance_traslado', alcance_traslado, 'costo', costo::float8, 'clave_enlace', clave_enlace, 'tipo', tipo, 'descripcion', descripcion) order by id)::text, '[]') from public.contrato_servicios where numero_contrato = ${lit(n)} and alcance_traslado is not null`)) as Linea[];
const cxpsDe = (n: string) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('id', id, 'contrato_servicio_id', contrato_servicio_id, 'alcance_traslado', alcance_traslado, 'servicio_id', servicio_id, 'valor_total', valor_total::float8, 'servicio', servicio, 'observaciones', observaciones) order by id)::text, '[]') from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`)) as Cxp[];
/** Línea de contrato_servicios == alcance congelado en payload.tours[] de la cotización; CxP enlazada a SU línea con alcance, servicio y valor correctos. */
function verificarEnlace(n: string, cotId: number, esperados: Esp[]) {
  const tours = JSON.parse(sql(`select (payload->'tours')::text from public.cotizaciones where id = ${cotId}`)) as Array<{ servicioId: number; alcance?: string }>;
  const delPayload = tours.filter((t) => t.alcance).map((t) => `${t.servicioId}:${t.alcance}`).sort();
  const ls = lineasAlcance(n);
  assert.deepEqual(ls.map((l) => `${l.servicio_id}:${l.alcance_traslado}`).sort(), delPayload, "alcance/servicio de las líneas == payload.tours[] de la cotización");
  assert.deepEqual(esperados.map((e) => `${e.s}:${e.alcance}`).sort(), delPayload, "lo esperado por el test == payload");
  const cx = cxpsDe(n);
  const usadas = new Set<number>();
  for (const e of esperados) {
    const l = ls.find((x) => !usadas.has(x.id) && x.servicio_id === e.s && x.alcance_traslado === e.alcance && Number(x.costo) === e.costo);
    assert.ok(l, `línea ${e.s}/${e.alcance} con costo ${e.costo}: ${JSON.stringify(ls)}`);
    usadas.add(l.id);
    assert.equal(l.tipo, "traslado");
    const c = cx.find((x) => x.contrato_servicio_id === l.id);
    assert.ok(c, `CxP enlazada a la línea ${l.id}: ${JSON.stringify(cx)}`);
    assert.match(l.clave_enlace, /^[0-9a-f-]{36}$/, "toda línea con alcance trae su clave_enlace");
    assert.ok(c.observaciones.endsWith(` · enlace:${l.clave_enlace}`), `observaciones termina en la clave de SU línea: ${c.observaciones}`);
    assert.equal(c.alcance_traslado, e.alcance); assert.equal(c.servicio_id, e.s); assert.equal(Number(c.valor_total), e.costo); assert.equal(c.servicio, l.descripcion);
  }
  assert.equal(new Set(ls.map((l) => l.clave_enlace)).size, ls.length, "las claves de las líneas son distintas");
  assert.equal(cx.filter((x) => x.contrato_servicio_id != null).length, esperados.length, "ninguna CxP más enlazada; ninguna línea con dos CxP");
  assert.equal(cx.filter((x) => x.contrato_servicio_id == null && x.alcance_traslado != null).length, 0);
}
/** Sin líneas con alcance ni columnas pobladas (legado/tour). */
function verificarSinEnlace(n: string) {
  assert.equal(sql(`select count(*) from public.contrato_servicios where numero_contrato = ${lit(n)}`), "0");
  assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and (alcance_traslado is not null or contrato_servicio_id is not null)`), "0");
}
/** Payload financiero tal como el app lo persistió en contrato_financiero_pendiente antes de llamar a la RPC (copiado por un trigger de prueba, solo en la base local). */
const payloadGuardado = (n: string) => JSON.parse(sql(`select coalesce((select json_build_object('costos', costos, 'cxp', cxp)::text from public.t_pay262 where numero = ${lit(n)}), 'null')`)) as { costos: unknown; cxp: Array<{ observaciones?: string }> } | null;
/** Reentrada REAL: se borran las CxP del contrato, se deja el contrato 'pendiente' con el payload persistido y se ejecuta el cron real (reconciliarFinancieroPendienteCron). El vínculo debe reconstruirse por la clave. */
async function reentrada(n: string) {
  const antes = cxpsDe(n);
  const pay = payloadGuardado(n);
  assert.ok(pay && pay.cxp.length === antes.length, `payload persistido por la app: ${JSON.stringify(pay)?.slice(0, 200)}`);
  assert.ok(pay.cxp.filter((x) => /enlace:/.test(x.observaciones ?? "")).length === antes.filter((x) => x.alcance_traslado).length, "el payload persistido lleva la clave en las observaciones de cada traslado por alcance");
  sql(`delete from public.cuentas_por_pagar where numero_contrato = ${lit(n)};
       update public.ventas set financiero_estado = 'pendiente', financiero_actualizado_en = now() - interval '1 hour' where numero_contrato = ${lit(n)};
       insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) select numero, 'mayorista', costos, cxp from public.t_pay262 where numero = ${lit(n)} on conflict (numero_contrato) do update set costos = excluded.costos, cxp = excluded.cxp;`);
  const rr = await reconciliarFinancieroPendienteCron(process.env.CRON_SECRET ?? null, 1);
  assert.equal(rr.ok, true, JSON.stringify(rr));
  assert.equal(sql(`select financiero_estado from public.ventas where numero_contrato = ${lit(n)}`), "completo", "el cron completó el contrato: " + JSON.stringify(rr).slice(0, 300));
  assert.equal(sql(`select count(*) from public.contrato_financiero_pendiente where numero_contrato = ${lit(n)}`), "0");
  const despues = cxpsDe(n);
  assert.equal(despues.length, antes.length, "mismo número de CxP tras la reentrada");
  assert.ok(despues.every((d) => !antes.some((a) => a.id === d.id)), "las CxP son NUEVAS (se borraron y recrearon)");
  for (let i = 0; i < antes.length; i++) {
    assert.equal(despues[i].servicio, antes[i].servicio);
    assert.equal(despues[i].contrato_servicio_id, antes[i].contrato_servicio_id, "mismo vínculo a la misma línea tras la reentrada (por clave)");
    assert.equal(despues[i].alcance_traslado, antes[i].alcance_traslado); assert.equal(despues[i].observaciones, antes[i].observaciones);
  }
}
const generar = async () => { const r = await generarTarifario(PAQ); assert.equal(r.ok, true, JSON.stringify(r)); };
const buscar = async (extra: Record<string, unknown> = {}) => {
  const r = await buscarReceptivos({ fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, paqueteId: PAQ, destino: "CARTAGENA 262", ...extra });
  assert.equal(r.ok, true, JSON.stringify(r)); return (r as { resultados: Array<Record<string, unknown>> }).resultados;
};
const resDe = (rs: Array<Record<string, unknown>>, id: number) => rs.find((x) => x.servicioId === id);

describe("262 · publicación y búsqueda de receptivos", () => {
  test("B0 generarTarifario publica los servicios vendibles; GENERAL no se publica", async () => {
    await generar();
    const pub = sql(`select string_agg(servicio_id::text, ',' order by servicio_id) from (select distinct servicio_id from public.tarifario_resultado_publicable where paquete_id = ${PAQ} and modulo = 'servicios') x`);
    console.log("      servicios publicados:", pub, "· diagnóstico:", sql(`select coalesce(tarifario_diagnostico,'-') from public.armado_paquetes where id = ${PAQ}`).slice(0, 400));
    assert.ok(!pub.split(",").includes(String(S_GEN)), "el traslado con solo GENERAL no se publica");
    // Antes era un defecto (rangos solo por alcance no se publicaban); ahora DEBE publicarse SIN espejo en servicio_tarifa_pax.
    assert.equal(sql(`select count(*) from public.servicio_tarifa_pax where servicio_id = ${S_GR}`), "0", "no hay rangos legados: no hace falta el rodeo");
    assert.ok(pub.split(",").includes(String(S_GR)), "el traslado por grupo con rangos SOLO por alcance se publica");
  });
  test("B1 sin alcance: el traslado se muestra pero NO se vende (requiereAlcance, total 0); tour/legado no se afectan", async () => {
    const rs = await buscar();
    const t = resDe(rs, S_TR);
    assert.ok(t, "el traslado aparece en la búsqueda"); assert.equal(t.requiereAlcance, true); assert.equal(t.total, 0);
    assert.equal(resDe(rs, S_LEG)?.total, pvp(2 * 50000), "legado sin cambios: 50.000×2 con markup");
    assert.equal(resDe(rs, S_LEG)?.requiereAlcance, undefined);
    assert.equal(resDe(rs, S_TOUR)?.total, pvp(2 * 40000), "tour clasificado sin cambios");
    assert.equal(resDe(rs, S_TOUR)?.requiereAlcance, undefined);
    assert.equal(resDe(rs, S_GEN), undefined, "GENERAL no vendible: no aparece");
  });
  test("B2 con alcance: cada alcance con SU precio (sin derivar): llegada = salida = un trayecto; ida y regreso aparte", async () => {
    const ll = resDe(await buscar({ alcance: "llegada", horas: H_DIA }), S_TR);
    const sa = resDe(await buscar({ alcance: "salida", horas: H_DIA }), S_TR);
    const ir = resDe(await buscar({ alcance: "ida_regreso", horas: H_DIA }), S_TR);
    assert.equal(ll?.total, pvp(200000)); assert.equal(sa?.total, pvp(200000)); assert.equal(ir?.total, pvp(340000));
    assert.equal(ll?.alcance, "llegada"); assert.equal(ir?.alcance, "ida_regreso");
    assert.notEqual(ir?.total, (ll?.total as number) * 2, "ida y regreso NO es el doble de un trayecto");
    assert.notEqual(ir?.total, undefined);
  });
  test("B3 suplemento nocturno solo en los tramos del alcance vendido", async () => {
    // llegada de día + salida de noche: un trayecto de llegada NO cobra la salida nocturna
    assert.equal(resDe(await buscar({ alcance: "llegada", horas: H_MIXTA }), S_TR)?.total, pvp(200000));
    assert.equal(resDe(await buscar({ alcance: "salida", horas: H_MIXTA }), S_TR)?.total, pvp(200000 + 30000));
    assert.equal(resDe(await buscar({ alcance: "llegada", horas: H_NOCHE }), S_TR)?.total, pvp(200000 + 30000));
    assert.equal(resDe(await buscar({ alcance: "ida_regreso", horas: H_NOCHE }), S_TR)?.total, pvp(340000 + 60000));
    assert.equal(resDe(await buscar({ alcance: "ida_regreso", horas: H_MIXTA }), S_TR)?.total, pvp(340000 + 30000));
  });
  test("B4 modo grupo por rangos de pasajeros y alcance sin tarifa propia (no se vende)", async () => {
    assert.equal(resDe(await buscar({ alcance: "llegada", pax: 3 }), S_GR)?.total, pvp(200000));
    assert.equal(resDe(await buscar({ alcance: "llegada", pax: 6 }), S_GR)?.total, pvp(300000));
    assert.equal(resDe(await buscar({ alcance: "ida_regreso", pax: 3 }), S_GR)?.total, pvp(350000));
    assert.equal(resDe(await buscar({ alcance: "ida_regreso", pax: 6 }), S_GR)?.total, pvp(500000));
    const fuera = resDe(await buscar({ alcance: "llegada", pax: 9 }), S_GR);
    assert.equal(fuera?.total, 0, "9 pax: ningún rango cubre"); assert.ok(fuera?.sinTarifaAlcance, "explica que no hay tarifa");
    const sinIR = resDe(await buscar({ alcance: "ida_regreso" }), S_SIN);
    assert.equal(sinIR?.total, 0, "sin precio propio de ida y regreso no se vende"); assert.ok(sinIR?.sinTarifaAlcance);
    assert.equal(resDe(await buscar({ alcance: "llegada" }), S_SIN)?.total, pvp(180000), "el trayecto sí tiene precio");
  });
  test("B5 alcance en un servicio que no es traslado: no aplica (tour/legado no se afectan ni aceptan alcance)", async () => {
    const rs = await buscar({ alcance: "llegada" });
    console.log("      legado con alcance →", JSON.stringify(resDe(rs, S_LEG)), " tour con alcance →", JSON.stringify(resDe(rs, S_TOUR)));
    for (const s of [S_LEG, S_TOUR]) { const x = resDe(rs, s); assert.ok(x === undefined || x.total === pvp(2 * (s === S_LEG ? 50000 : 40000)) || x.total === 0); }
  });
});

describe("262 · cotización y conversión REAL a contrato y CxP", () => {
  test("V1 LLEGADA nocturna, 2 pax: PVP congelado, ítem con etiqueta, CxP = 100.000×2 + 30.000 = 230.000", async () => {
    const id = await cotizarOk([tour(S_TR, 2, { alcance: "llegada", horas: H_NOCHE })]);
    const t = tourCot(id);
    assert.equal(t.alcance, "llegada"); assert.equal(t.precio, pvp(230000)); assert.deepEqual(t.horas, { llegada: "21:00" }, "solo se congela la hora del tramo vendido");
    const r = await convertir(id); assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    assert.equal(itemDe(n), `Servicio · Traslado persona 262 (Un trayecto: llegada) — CARTAGENA 262|${pvp(230000)}`);
    assert.equal(precioVenta(n), pvp(230000));
    assert.equal(cxpDe(n), `Traslado persona 262 · Un trayecto: llegada|otro|230000|${S_TR}|COP`.replace("|otro|", `|${sql(`select tipo_proveedor from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`)}|`));
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`), "1");
    verificarEnlace(n, id, [{ s: S_TR, alcance: "llegada", costo: 230000 }]);
    await reentrada(n); verificarEnlace(n, id, [{ s: S_TR, alcance: "llegada", costo: 230000 }]);
  });
  test("V2 SALIDA con llegada nocturna y salida de día: sin suplemento → CxP 200.000 (tramo no vendido no cuenta)", async () => {
    const id = await cotizarOk([tour(S_TR, 2, { alcance: "salida", horas: { llegada: "21:00", salida: "10:00" } })]);
    const r = await convertir(id); assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    assert.match(itemDe(n), /\(Un trayecto: salida\)/); assert.match(itemDe(n), new RegExp(`\\|${pvp(200000)}$`));
    assert.match(cxpDe(n), /^Traslado persona 262 · Un trayecto: salida\|[a-z_]+\|200000\|6201\|COP$/);
    verificarEnlace(n, id, [{ s: S_TR, alcance: "salida", costo: 200000 }]);
  });
  test("V3 IDA Y REGRESO con ambas horas nocturnas: CxP = 170.000×2 + 2×30.000 = 400.000; sin suplemento 340.000", async () => {
    const id = await cotizarOk([tour(S_TR, 2, { alcance: "ida_regreso", horas: H_NOCHE })]);
    const r = await convertir(id); assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    assert.match(itemDe(n), /\(Ida y regreso\)/); assert.match(itemDe(n), new RegExp(`\\|${pvp(400000)}$`));
    assert.match(cxpDe(n), /^Traslado persona 262 · Ida y regreso\|[a-z_]+\|400000\|6201\|COP$/);
    const id2 = await cotizarOk([tour(S_TR, 2, { alcance: "ida_regreso", horas: H_DIA })]);
    const r2 = await convertir(id2); assert.equal(r2.ok, true, r2.error);
    assert.match(cxpDe(r2.numeros![0]), /\|340000\|6201\|COP$/);
    verificarEnlace(n, id, [{ s: S_TR, alcance: "ida_regreso", costo: 400000 }]); verificarEnlace(r2.numeros![0], id2, [{ s: S_TR, alcance: "ida_regreso", costo: 340000 }]);
  });
  test("V4 modo GRUPO: 3 pax → rango 1–4 (200.000 el grupo) y 6 pax → rango 5–8 (300.000); 9 pax no se cotiza", async () => {
    const a = await cotizarOk([tour(S_GR, 3, { alcance: "llegada" })]);
    const ra = await convertir(a, 1, 3); assert.equal(ra.ok, true, ra.error);
    verificarEnlace(ra.numeros![0], a, [{ s: S_GR, alcance: "llegada", costo: 200000 }]);
    assert.match(cxpDe(ra.numeros![0]), /\|200000\|6202\|COP$/); assert.equal(precioVenta(ra.numeros![0]), pvp(200000));
    const b = await cotizarOk([tour(S_GR, 6, { alcance: "ida_regreso" })]);
    const rb = await convertir(b, 1, 6); assert.equal(rb.ok, true, rb.error);
    verificarEnlace(rb.numeros![0], b, [{ s: S_GR, alcance: "ida_regreso", costo: 500000 }]);
    assert.match(cxpDe(rb.numeros![0]), /\|500000\|6202\|COP$/); assert.equal(precioVenta(rb.numeros![0]), pvp(500000));
    const c = await cotizar([tour(S_GR, 9, { alcance: "llegada" })]);
    console.log("      9 pax en grupo →", c.ok ? "COTIZÓ (!)" : c.error);
    assert.equal(c.ok, false, "ningún rango cubre 9 pasajeros: no se cotiza");
  });
  test("V5 alcance SIN tarifa propia (ida y regreso del servicio con un solo precio) y GENERAL: no se cotiza", async () => {
    const a = await cotizar([tour(S_SIN, 2, { alcance: "ida_regreso" })]); console.log("      sin tarifa ida_regreso →", a.ok ? "COTIZÓ (!)" : a.error);
    assert.equal(a.ok, false);
    const g = await cotizar([tour(S_GEN, 2, { alcance: "llegada" })]); console.log("      solo GENERAL →", g.ok ? "COTIZÓ (!)" : g.error);
    assert.equal(g.ok, false);
    const g2 = await liquidarServicioPuntual({ paqueteId: PAQ, servicioId: S_GEN, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, alcance: "llegada" });
    assert.equal(g2.ok, false, "GENERAL no es vendible");
  });
  test("V6 traslado SIN alcance al cotizar: se rechaza (se debe elegir llegada/salida/ida y regreso)", async () => {
    const r = await cotizar([tour(S_TR, 2, { horas: H_DIA })]); console.log("      sin alcance →", r.ok ? "COTIZÓ (!)" : r.error);
    assert.equal(r.ok, false);
  });
  test("V7 cotización ANTERIOR sin alcance sobre un servicio que luego se clasifica como traslado: la conversión FALLA y no escribe nada", async () => {
    const id = await cotizarOk([tour(S_PRE, 2)]);
    assert.equal(tourCot(id).alcance, undefined);
    sql(`update public.servicios_adicionales set tipo_receptivo = 'traslado' where id = ${S_PRE};
         insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, precio) values (${ALTA(S_PRE)}, 'trayecto', 100000), (${ALTA(S_PRE)}, 'ida_regreso', 170000);`);
    await noEscribe("cotización anterior sin alcance", id, /sin indicar si es de llegada, de salida o de ida y regreso/);
  });
  test("V8 alcance alterado: valor ajeno y alcance en un servicio que no es traslado → FALLAN sin escribir", async () => {
    const id = await cotizarOk([tour(S_TR, 2, { alcance: "llegada", horas: H_DIA })]);
    setTourCot(id, "alcance", "mitad");
    await noEscribe("valor ajeno", id, /alcance inválido/);
    setTourCot(id, "alcance", "ida_regreso");
    await noEscribe("alcance cambiado a ida_regreso (precio cotizado era de un trayecto)", id, /ya no se puede vender con ese alcance|cambió desde que se cotizó/);
    const idTour = await cotizarOk([tour(S_TOUR, 2)]);
    setTourCot(idTour, "alcance", "llegada");
    await noEscribe("alcance en un tour", idTour, /no es un traslado y no admite alcance/);
    const idLeg = await cotizarOk([tour(S_LEG, 2)]);
    setTourCot(idLeg, "alcance", "llegada");
    await noEscribe("alcance en un servicio legado sin clasificar", idLeg, /no es un traslado y no admite alcance/);
    const rt = await cotizar([tour(S_TOUR, 2, { alcance: "llegada" })]); console.log("      cotizar un tour con alcance →", rt.ok ? "COTIZÓ (!)" : rt.error);
    assert.equal(rt.ok, false);
  });
  test("V9 precio cambiado en el catálogo tras cotizar: FALLA pidiendo recotizar; al restaurar el precio la misma cotización convierte", async () => {
    const id = await cotizarOk([tour(S_CAMB, 2, { alcance: "llegada", horas: H_DIA })]);
    sql(`update public.servicio_precio_alcance set precio = 110000 where servicio_temporada_id = ${ALTA(S_CAMB)} and alcance = 'trayecto'`);
    await noEscribe("precio subió", id, /ya no se puede vender con ese alcance|cambió desde que se cotizó/);
    sql(`delete from public.servicio_precio_alcance where servicio_temporada_id = ${ALTA(S_CAMB)}`);
    await noEscribe("ya no hay tarifa propia", id, /ya no se puede vender con ese alcance/);
    sql(`insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, precio) values (${ALTA(S_CAMB)}, 'trayecto', 100000)`);
    const r = await convertir(id); assert.equal(r.ok, true, `restaurado el precio debe convertir: ${r.error}`);
    assert.match(cxpDe(r.numeros![0]), /\|200000\|6208\|COP$/);
  });
  test("V10 horario cambiado a nocturno no aplica en porción terrestre (la hora capturada es la vigente) y el suplemento ya cotizado se conserva", async () => {
    const id = await cotizarOk([tour(S_TR, 2, { alcance: "llegada", horas: H_NOCHE })]);
    const t = tourCot(id); assert.deepEqual(t.suplementos, [{ tramo: "llegada", hora: "21:00" }]);
  });
  test("V11 LEGADO sin clasificar y tour clasificado: se convierten igual que antes (sin etiqueta de alcance, costo = precio×pax)", async () => {
    const id = await cotizarOk([tour(S_LEG, 2)]);
    assert.equal(tourCot(id).alcance, undefined); assert.equal(tourCot(id).precio, pvp(100000));
    const r = await convertir(id); assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    assert.equal(itemDe(n), `Servicio · Tour legado 262 — CARTAGENA 262|${pvp(100000)}`);
    assert.match(cxpDe(n), /^Tour legado 262\|[a-z_]+\|100000\|6205\|COP$/);
    const id2 = await cotizarOk([tour(S_TOUR, 2)]);
    const r2 = await convertir(id2); assert.equal(r2.ok, true, r2.error);
    assert.match(cxpDe(r2.numeros![0]), /^Tour clasificado 262\|[a-z_]+\|80000\|6206\|COP$/);
    verificarSinEnlace(n); verificarSinEnlace(r2.numeros![0]);
    await reentrada(n); verificarSinEnlace(n);
  });
  test("V12 reintento sobre cotización ya convertida: mismos números, sin escrituras nuevas", async () => {
    const id = await cotizarOk([tour(S_TR, 2, { alcance: "ida_regreso", horas: H_DIA })]);
    const r = await convertir(id); assert.equal(r.ok, true, r.error);
    const antes = foto();
    const r2 = await convertir(id); assert.equal(r2.ok, true, r2.error); assert.deepEqual(r2.numeros, r.numeros); assert.deepEqual(foto(), antes);
  });
  test("V13 un carrito con DOS traslados de distinto alcance (y un tour): cada línea con su precio y su CxP", async () => {
    const id = await cotizarOk([tour(S_TR, 2, { alcance: "llegada", horas: H_DIA }), tour(S_TR, 2, { alcance: "ida_regreso", horas: H_NOCHE }), tour(S_TOUR, 2)]);
    const r = await convertir(id, 3); assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    assert.equal(precioVenta(n), pvp(200000) + pvp(400000) + pvp(80000));
    const cxp = cxpDe(n);
    assert.match(cxp, /Traslado persona 262 · Un trayecto: llegada\|[a-z_]+\|200000\|6201\|COP/);
    assert.match(cxp, /Traslado persona 262 · Ida y regreso\|[a-z_]+\|400000\|6201\|COP/);
    assert.match(cxp, /Tour clasificado 262\|[a-z_]+\|80000\|6206\|COP/);
    const esp = [{ s: S_TR, alcance: "llegada", costo: 200000 }, { s: S_TR, alcance: "ida_regreso", costo: 400000 }];
    verificarEnlace(n, id, esp);
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and servicio_id = ${S_TOUR} and contrato_servicio_id is null and alcance_traslado is null`), "1", "el tour del mismo carrito queda sin enlace");
    await reentrada(n); verificarEnlace(n, id, esp);
    // (vi) editar los servicios del contrato con la acción real (superadmin): no borra ni duplica las líneas con alcance; la CxP sigue enlazada
    const ids = lineasAlcance(n).map((l) => l.id);
    uidSesion = UID_SUPER;
    try {
      for (const lista of [[{ tipo: "otro", descripcion: "Extra manual 262", proveedor: "", costo: 5 }], [{ tipo: "otro", descripcion: "Extra manual 262", proveedor: "", costo: 6 }], []]) {
        const g = await guardarServiciosContrato(n, lista as never); assert.equal(g.ok, true, JSON.stringify(g));
        assert.deepEqual(lineasAlcance(n).map((l) => l.id), ids, "las líneas con alcance siguen, con los mismos ids, sin duplicarse");
        assert.equal(sql(`select count(*) from public.contrato_servicios where numero_contrato = ${lit(n)} and alcance_traslado is null`), String(lista.length), "solo existen las líneas manuales enviadas");
        verificarEnlace(n, id, esp);
      }
    } finally { uidSesion = UID_ADMIN; }
  });
  test("V14 DOS traslados idénticos (mismo servicio y alcance, distinto pax) en un carrito: dos líneas, cada CxP con SU línea y SU valor", async () => {
    const id = await cotizarOk([tour(S_TR, 2, { alcance: "llegada", horas: H_DIA }), tour(S_TR, 3, { alcance: "llegada", horas: H_NOCHE })]);
    const r = await convertir(id, 2, [2, 3]); assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    const esp = [{ s: S_TR, alcance: "llegada", costo: 200000 }, { s: S_TR, alcance: "llegada", costo: 330000 }];
    verificarEnlace(n, id, esp);
    await reentrada(n); verificarEnlace(n, id, esp);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Recorridos adicionales (tercera ronda): combo, asistencia médica, USD, cambio de horario del vuelo, comparativa, reintento por el cron, #63.
const S_COMBO = 6209, S_ASIS = 6210, S_USD = 6211, PAQ_USD = 6202, PAQ_BQ = 6203, PAQ_PT = 6204, HOT1 = 6210, HOT2 = 6211, BQ = 6210;
before(() => {
  sql(`
    insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion, tipo_receptivo, combo_incluye_traslado, combo_traslado_alcance) values
      (${S_COMBO}, 'Combo con traslado 262', 6201, 6201, 50000, 'tour_traslado', 'COP', 'persona', 'paquete', 'combo', true, 'trayecto_llegada'),
      (${S_ASIS},  'Asistencia médica 262', 6201, 6201, 30000, 'asistencia', 'COP', 'persona', 'paquete', 'asistencia_medica', null, null),
      (${S_USD},   'Traslado USD 262', 6201, 6201, 0, 'tour_traslado', 'USD', 'persona', 'paquete', 'traslado', null, null);
    insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values
      (${ALTA(S_COMBO)}, ${S_COMBO}, 'ALTA', '2030-01-01', '2030-12-31', 50000), (${ALTA(S_ASIS)}, ${S_ASIS}, 'ALTA', '2030-01-01', '2030-12-31', 30000), (${ALTA(S_USD)}, ${S_USD}, 'ALTA', '2030-01-01', '2030-12-31', 0);
    insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values (${ALTA(S_COMBO)}, '19:00', '06:00', 'ambos', 'monto', 30000, 'grupo');
    insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, precio) values (${ALTA(S_USD)}, 'trayecto', 40), (${ALTA(S_USD)}, 'ida_regreso', 70);
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (${PAQ}, ${S_COMBO}, 'persona', false), (${PAQ}, ${S_ASIS}, 'persona', false);
    -- paquete USD de servicios
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
      values (${PAQ_USD}, 'Servicios USD 262', 'servicios', 3, 6201, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'USD', 'USD', true);
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (${PAQ_USD}, ${S_USD}, 'persona', false);
    -- hoteles, bloqueo (horas del vuelo acreditadas) y paquete de porción para la comparativa
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
      values (${HOT1}, 6201, 'Hotel Uno 262', 6201, 'COP', 0, 5, 6, 12, 1, 6, true), (${HOT2}, 6201, 'Hotel Dos 262', 6201, 'COP', 0, 5, 6, 12, 1, 6, true);
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
      values (${HOT1}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (${HOT2}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (${HOT1}, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa'), (${HOT2}, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa');
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante)
      values (${HOT1}, 'Estandar', 'Desayuno', 'ALTA', 150000, 100000, 50000, 30000, 40000), (${HOT2}, 'Estandar', 'Desayuno', 'ALTA', 160000, 110000, 50000, 30000, 40000);
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo) values
      (${PAQ_BQ}, 'Bloqueo 262', 'bloqueo', 3, 6201, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true),
      (${PAQ_PT}, 'Porción 262', 'porcion_terrestre', 3, 6201, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (${PAQ_BQ}, ${HOT1}, array['Estandar'], array['Desayuno']), (${PAQ_PT}, ${HOT1}, array['Estandar'], array['Desayuno']), (${PAQ_PT}, ${HOT2}, array['Estandar'], array['Desayuno']);
    insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, vuelo_ida, fecha_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, cupos_total, tarifa_para_empaquetar, fee_infante, destino_id, proveedor_id, moneda, origen)
      values (${BQ}, 'HOR262', 'Aerolínea 262', 'BOG - CTG - BOG', 'AV62', '2030-06-01', '21:00', 'AV63', '2030-06-04', '22:00', 10, 300000, 0, 6201, 6201, 'COP', 'BOG');
    insert into public.sillas (bloqueo_id, numero_silla, estado) select ${BQ}, g, 'disponible' from generate_series(1, 10) g;
    insert into public.armado_vuelos (paquete_id, bloqueo_id, aplica_mk, ta) values (${PAQ_BQ}, ${BQ}, true, 0);
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (${PAQ_BQ}, ${S_TR}, 'persona', false), (${PAQ_PT}, ${S_TR}, 'persona', false);
  `);
});

describe("262 · combo, asistencia médica y USD", () => {
  test("X0 se publican los paquetes de servicios USD y los del hotel", async () => {
    await generar();
    for (const pq of [PAQ_USD, PAQ_BQ, PAQ_PT]) { const g = await generarTarifario(pq); assert.equal(g.ok, true, JSON.stringify(g)); }
    console.log("      USD publicado:", sql(`select count(*) from public.tarifario_resultado_publicable where paquete_id = ${PAQ_USD} and servicio_id = ${S_USD}`), " bloqueo:", sql(`select count(*) from public.tarifario_resultado_publicable where paquete_id = ${PAQ_BQ}`), " porción:", sql(`select count(*) from public.tarifario_resultado_publicable where paquete_id = ${PAQ_PT}`));
  });
  test("X1 COMBO con traslado (llegada): su tarifa normal + suplemento SOLO en el tramo declarado; sin alcance, sin línea de servicio; CxP normal sin enlace", async () => {
    const rs = await buscar();
    assert.equal(resDe(rs, S_COMBO)?.requiereAlcance, undefined, "un combo no pide alcance");
    const h = { llegada: "21:00", salida: "22:00" };
    const id = await cotizarOk([tour(S_COMBO, 2, { horas: h })]);
    const t = tourCot(id);
    assert.equal(t.alcance, undefined); assert.equal(t.precio, pvp(2 * 50000 + 30000), "solo se cobra el suplemento de la llegada (30.000), no el de la salida");
    assert.deepEqual(t.suplementos, [{ tramo: "llegada", hora: "21:00" }]); assert.deepEqual(t.horas, { llegada: "21:00" });
    const r = await convertir(id); assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    assert.match(cxpDe(n), /^Combo con traslado 262\|[a-z_]+\|130000\|6209\|COP$/);
    verificarSinEnlace(n);
    const id2 = await cotizarOk([tour(S_COMBO, 2, { horas: { llegada: "10:00", salida: "22:00" } })]);
    assert.equal(tourCot(id2).precio, pvp(100000), "salida nocturna no cuenta para un combo cuyo traslado es de llegada");
    const rc = await cotizar([tour(S_COMBO, 2, { alcance: "llegada", horas: h })]); assert.equal(rc.ok, false, "un combo rechaza un alcance enviado");
  });
  test("X2 ASISTENCIA MÉDICA clasificada: se convierte como siempre; un alcance se rechaza al cotizar y al convertir", async () => {
    const id = await cotizarOk([tour(S_ASIS, 2)]);
    const r = await convertir(id); assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    assert.match(cxpDe(n), /^Asistencia médica 262\|asistencia\|60000\|6210\|COP$/); verificarSinEnlace(n);
    assert.equal((await cotizar([tour(S_ASIS, 2, { alcance: "llegada" })])).ok, false, "cotizar con alcance se rechaza");
    const id2 = await cotizarOk([tour(S_ASIS, 2)]);
    setTourCot(id2, "alcance", "llegada");
    await noEscribe("alcance inyectado en asistencia médica", id2, /no es un traslado y no admite alcance/);
  });
  test("X3 USD con TRM de costos: CxP en USD con valor_cop_costo/trm_costo, enlace por clave e importes correctos; sin TRM no se numera", async () => {
    const id = await cotizarOk([{ servicioId: S_USD, paqueteId: PAQ_USD, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, alcance: "llegada" }]);
    const t = tourCot(id); assert.equal(t.moneda, "USD"); assert.equal(t.precio, Math.ceil((2 * 40) / 0.8), "80 USD neto → 100 USD");
    await noEscribe("USD sin TRM de costos", id, /TRM de costos|TRM/, 1, 2);
    const r = await convertir(id, 1, 2, { extra: { monedaCobro: "USD", trmCosto: 4000 } });
    assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    const c = JSON.parse(sql(`select json_build_object('moneda', moneda, 'valor', valor_total::float8, 'cop', valor_cop_costo::float8, 'trm', trm_costo::float8, 'cs', contrato_servicio_id, 'alc', alcance_traslado, 'obs', observaciones)::text from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`));
    assert.equal(c.moneda, "USD"); assert.equal(c.valor, 80); assert.equal(c.cop, 320000); assert.equal(c.trm, 4000); assert.equal(c.alc, "llegada");
    verificarEnlace(n, id, [{ s: S_USD, alcance: "llegada", costo: 80 }]);
    assert.equal(precioVenta(n), 100);
    await reentrada(n);
    const c2 = JSON.parse(sql(`select json_build_object('cop', valor_cop_costo::float8, 'trm', trm_costo::float8)::text from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`));
    assert.deepEqual(c2, { cop: 320000, trm: 4000 }, "la reentrada conserva el equivalente en COP y la TRM");
  });
});

describe("262 · reintento por el cron con CxP presentes y #63", () => {
  test("X5 #63: convertirCotizacionCarrito nunca fija ventas.aceptacion_63_id ni delega en p63_registrar_financiero (solo reservarDesdeTarifarioInterno lo hace)", async () => {
    const fuente = fs.readFileSync(new URL("../app/(dashboard)/dashboard/reservar/actions.ts", import.meta.url), "utf8");
    const ini = fuente.indexOf("export async function convertirCotizacionCarrito"); assert.ok(ini > 0);
    const cuerpo = fuente.slice(ini);
    assert.ok(!/aceptacion_63|aceptacion63|p63_registrar_financiero/.test(cuerpo), "la conversión del carrito no toca la oferta #63");
    assert.equal(sql("select count(*) from public.ventas where aceptacion_63_id is not null"), "0", "ninguna venta de esta base quedó ligada a #63");
    // Si un contrato LIGADO a una aceptación recibiera el payload del carrito, p63 exige que el payload sea el derivado de la oferta: el del carrito (con clave de enlace) no lo es.
    assert.ok(sql("select pg_get_functiondef('public.p63_registrar_financiero(text,text,jsonb,jsonb,bigint)'::regprocedure) like '%p63_payload_alterno%'") === "t");
  });
});

describe("262 · cambio de horario entre cotizar y convertir (vuelo de un bloqueo)", () => {
  const itemBq = { modulo: "bloqueo", paqueteId: PAQ_BQ, hotelId: HOT1, bloqueoId: BQ, hotelNombre: "Hotel Uno 262", destino: "CARTAGENA 262", categoria: "Estandar", regimen: "Desayuno", fechaIda: null, fechaRegreso: null, noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0, itemId: "hbq" };
  const tourBq = (extra: Record<string, unknown> = {}) => ({ servicioId: S_TR, paqueteId: PAQ_BQ, fechaIda: "2030-06-01", fechaRegreso: "2030-06-04", pax: 2, alcance: "ida_regreso", hotelItemId: "hbq", ...extra });
  const cotBq = async () => {
    const r = (await crearSolicitudReserva({ items: [itemBq], tours: [tourBq()], cliente: CLIENTE } as never)) as { ok: boolean; error?: string; cotizacion?: { id: number } };
    assert.equal(r.ok, true, r.error); return Number(r.cotizacion!.id);
  };
  const convBq = (id: number) => convertir(id, 1, 2, { asignaciones: [[1, 2]] });
  const setHoras = (ll: string, sa: string) => sql(`update public.bloqueos_vuelo set hora_llegada_ida = '${ll}', hora_salida_reg = '${sa}' where id = ${BQ}`);
  const sillas = () => sql(`select count(*) from public.sillas where bloqueo_id = ${BQ} and estado <> 'disponible'`);
  test("H1 la cotización toma las horas del vuelo (21:00 / 22:00) y cobra el suplemento de ambos tramos", async () => {
    const id = await cotBq(); const t = tourCot(id);
    assert.deepEqual(t.horas, { llegada: "21:00", salida: "22:00" }); assert.equal(t.alcance, "ida_regreso");
    assert.equal((t.suplementos as unknown[]).length, 2);
    console.log("      precio del traslado congelado:", t.precio, "(esperado", pvp(340000 + 60000) + ")");
    assert.equal(t.precio, pvp(400000));
  });
  test("H2 el vuelo pasa a horario DIURNO (cambia el suplemento): la conversión FALLA pidiendo recotizar y no escribe nada", async () => {
    const id = await cotBq(); const antes = { ...foto(), sillas: sillas() };
    setHoras("10:00", "11:00");
    try {
      const r = await convBq(id); assert.equal(r.ok, false); assert.match(r.error ?? "", /horario del traslado .* cambió desde que se cotizó/);
      assert.deepEqual({ ...foto(), sillas: sillas() }, antes, "ni contrato, ni CxP, ni sillas");
    } finally { setHoras("21:00", "22:00"); }
    const ok = await convBq(id); assert.equal(ok.ok, true, ok.error);
    const n = ok.numeros![0]; verificarEnlace(n, id, [{ s: S_TR, alcance: "ida_regreso", costo: 400000 }]);
  });
  test("H3 el vuelo cambia de hora PERO sigue siendo nocturno (el suplemento no cambiaría): igual se exige recotizar (la comparación es por hora, no por importe)", async () => {
    const id = await cotBq(); const antes = { ...foto(), sillas: sillas() };
    setHoras("22:30", "23:00");
    try {
      const r = await convBq(id);
      console.log("      resultado con hora distinta y mismo suplemento →", r.ok ? "CONVIRTIÓ" : r.error);
      assert.equal(r.ok, false); assert.match(r.error ?? "", /horario del traslado .* cambió/);
      assert.deepEqual({ ...foto(), sillas: sillas() }, antes);
    } finally { setHoras("21:00", "22:00"); }
  });
  test("H4 cambia solo el tramo NO vendido de un traslado de llegada: no exige recotizar", async () => {
    const r0 = (await crearSolicitudReserva({ items: [itemBq], tours: [tourBq({ alcance: "llegada" })], cliente: CLIENTE } as never)) as { ok: boolean; error?: string; cotizacion?: { id: number } };
    assert.equal(r0.ok, true, r0.error); const id = Number(r0.cotizacion!.id);
    assert.deepEqual(tourCot(id).horas, { llegada: "21:00" });
    setHoras("21:00", "07:00");
    try { const r = await convBq(id); assert.equal(r.ok, true, r.error); verificarEnlace(r.numeros![0], id, [{ s: S_TR, alcance: "llegada", costo: 230000 }]); }
    finally { setHoras("21:00", "22:00"); }
  });
});

describe("262 · comparativa con un traslado por alcance", () => {
  const itemP = (hotelId: number, nombre: string) => ({ modulo: "porcion_terrestre", paqueteId: PAQ_PT, hotelId, bloqueoId: null, hotelNombre: nombre, destino: "CARTAGENA 262", categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0, itemId: "h" + hotelId });
  test("C1 crear la comparativa con un traslado de ida y regreso (horas capturadas) → elegir una opción → convertir: alcance, horas y precio sobreviven", async () => {
    const tours = [{ servicioId: S_TR, paqueteId: PAQ_PT, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, alcance: "ida_regreso", horas: H_NOCHE, hotelItemId: "h" + HOT1 }];
    const c = await crearComparativaCarrito({ items: [itemP(HOT1, "Hotel Uno 262"), itemP(HOT2, "Hotel Dos 262")], tours, cliente: { ...CLIENTE, tipoDoc: "CC" } }) as { ok: boolean; id?: number; error?: string };
    console.log("      crearComparativaCarrito →", c.ok ? `ok id ${c.id}` : c.error);
    if (!c.ok) { assert.fail("no se pudo crear la comparativa con un traslado: " + c.error); }
    const ops = JSON.parse(sql(`select coalesce(json_agg(json_build_object('op', opcion_ref, 'ac', acomodacion_ref, 'total', total, 'tours', plantilla_hija->'payload'->'tours') order by orden), '[]')::text from public.cotizacion_opciones where cotizacion_id = ${c.id}`)) as Array<{ op: string; ac: string; total: number; tours: Array<Record<string, unknown>> }>;
    console.log("      plantillas de las opciones — tours congelados:", JSON.stringify(ops.map((o) => o.tours)).slice(0, 300));
    assert.ok(ops.length >= 1);
    for (const o of ops) { for (const t of o.tours) { assert.equal(t.alcance, "ida_regreso", "la plantilla conserva el alcance"); assert.deepEqual(t.horas, { llegada: "21:00", salida: "22:00" }, "la plantilla conserva las horas capturadas"); } }
    const m = JSON.parse(sql(`select json_build_object('token', share_token, 'version', version)::text from public.cotizaciones where id = ${c.id}`)) as { token: string; version: number };
    const e = await elegirOpcionComparativa({ token: m.token, version: m.version, opcionRef: ops[0].op, acomodacionRef: ops[0].ac, clave: crypto.randomUUID() }) as { ok: boolean; hijaId?: number; error?: string };
    console.log("      elegirOpcionComparativa →", e.ok ? `ok hija ${e.hijaId}` : e.error);
    assert.equal(e.ok, true, "elegir una opción con traslado con franjas y horas capturadas: " + e.error);
    const th = tourCot(e.hijaId!); console.log("      tour de la hija:", JSON.stringify(th));
    assert.equal(th.alcance, "ida_regreso"); assert.deepEqual(th.horas, { llegada: "21:00", salida: "22:00" }); assert.equal(th.precio, pvp(400000));
    const r = await convertir(e.hijaId!, 1, 2, { asignaciones: [[1, 2]] }); assert.equal(r.ok, true, r.error);
    verificarEnlace(r.numeros![0], e.hijaId!, [{ s: S_TR, alcance: "ida_regreso", costo: 400000 }]);
  });
});

describe("262 · dos traslados idénticos (mismo servicio, alcance y pax)", () => {
  test("V15 dos líneas, dos claves distintas, cada CxP en SU línea con su valor", async () => {
    const id = await cotizarOk([tour(S_TR, 2, { alcance: "llegada", horas: H_DIA }), tour(S_TR, 2, { alcance: "llegada", horas: H_DIA })]);
    const r = await convertir(id, 2, [2, 2]); assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    const esp = [{ s: S_TR, alcance: "llegada", costo: 200000 }, { s: S_TR, alcance: "llegada", costo: 200000 }];
    verificarEnlace(n, id, esp);
    const ls = lineasAlcance(n); assert.equal(ls.length, 2); assert.notEqual(ls[0].clave_enlace, ls[1].clave_enlace);
    const cx = cxpsDe(n); assert.deepEqual(cx.map((c) => c.contrato_servicio_id).sort(), ls.map((l) => l.id).sort());
    await reentrada(n); verificarEnlace(n, id, esp);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Cuarta ronda: borrado de servicios con obligaciones y ruta de oferta #63 (crearCotizacion -> convertirCotizacion -> aceptar_oferta_63 -> p63_registrar_financiero).
const PAQ_63 = 6205, PAQ_63I = 6206, SAL_63 = 6205, SAL_63I = 6206, S_INC = 6212;
const ROL_HTTP = (rol: string) => ({ superadmin: "00000000-0000-0000-0000-000000262001", gerencia: "00000000-0000-0000-0000-000000262010", operaciones: "00000000-0000-0000-0000-000000262011", administracion: UID_ADMIN, venta: "00000000-0000-0000-0000-000000262012" } as Record<string, string>)[rol];
before(() => {
  sql(`
    insert into auth.users (id, email) values ('${ROL_HTTP("gerencia")}', 'ger262@x.test'), ('${ROL_HTTP("operaciones")}', 'ope262@x.test'), ('${ROL_HTTP("venta")}', 'ven262@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${ROL_HTTP("gerencia")}', 'ger262@x.test', 'Ger 262', 'gerencia', true, 'mayorista'), ('${ROL_HTTP("operaciones")}', 'ope262@x.test', 'Ope 262', 'operaciones', true, 'mayorista'), ('${ROL_HTTP("venta")}', 'ven262@x.test', 'Ven 262', 'venta', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into auth.sessions (id, user_id) select ('5e550000' || substr(id::text, 9))::uuid, id from public.usuarios where email like '%262@x.test' or id in ('${UID_ADMIN}', '${UID_SUPER}') on conflict do nothing;
    insert into public.sesion_agencia (session_id, user_id, tenant) select ('5e550000' || substr(id::text, 9))::uuid, id, 'mayorista' from public.usuarios where id = '${UID_SUPER}' on conflict do nothing;
    -- servicio traslado clasificado que irá INCLUIDO en un paquete (debe rechazarse)
    insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion, tipo_receptivo) values (${S_INC}, 'Traslado incluido 262', 6201, 6201, 0, 'tour_traslado', 'COP', 'persona', 'paquete', 'traslado');
    insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (${ALTA(S_INC)}, ${S_INC}, 'ALTA', '2030-01-01', '2030-12-31', 0);
    insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, precio) values (${ALTA(S_INC)}, 'trayecto', 40000), (${ALTA(S_INC)}, 'ida_regreso', 70000);
    -- paquetes dinámicos en modo oferta #63 (COP con TRM), con salida manual
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, modo_oferta, trm_oferta, activo) values
      (${PAQ_63}, 'Dinámico 63', 'dinamico', 3, 6201, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', 'cop_trm_63', 4000, true),
      (${PAQ_63I}, 'Dinámico 63 con traslado incluido', 'dinamico', 3, 6201, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', 'cop_trm_63', 4000, true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (${PAQ_63}, ${HOT1}, array['Estandar'], array['Desayuno']), (${PAQ_63I}, ${HOT1}, array['Estandar'], array['Desayuno']);
    insert into public.salidas_dinamicas (id, paquete_id, aerolinea, ruta, origen, fecha_ida, fecha_regreso, valor_tiquete, aplica_mk, ta, fee_infante, activo, moneda) values
      (${SAL_63}, ${PAQ_63}, 'Aerolínea 262', 'BOG - CTG - BOG', 'BOG', '2030-03-01', '2030-03-04', 300000, true, 0, 0, true, 'COP'),
      (${SAL_63I}, ${PAQ_63I}, 'Aerolínea 262', 'BOG - CTG - BOG', 'BOG', '2030-03-01', '2030-03-04', 300000, true, 0, 0, true, 'COP');
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values
      (${PAQ_63}, ${S_TR}, 'persona', false), (${PAQ_63}, ${S_LEG}, 'persona', false), (${PAQ_63}, ${S_TOUR}, 'persona', false), (${PAQ_63}, ${S_ASIS}, 'persona', false),
      (${PAQ_63I}, ${S_INC}, 'persona', true);
  `);
});

describe("262 · borrar un servicio con obligaciones (HTTP + acción real eliminarServicio)", () => {
  const SRV_BAJA = 6290, SRV_SIN = 6291;
  const httpDel = async (rol: string, id: number) => {
    const t = jwt({ role: "authenticated", sub: ROL_HTTP(rol), session_id: sidDe(ROL_HTTP(rol)) });
    const r = await fetch(`${PGRST}/servicios_adicionales?id=eq.${id}`, { method: "DELETE", headers: { authorization: `Bearer ${t}`, prefer: "return=representation" } });
    const tx = await r.text(); let j: unknown; try { j = JSON.parse(tx); } catch { j = tx; }
    return { s: r.status, j, tx };
  };
  let numeroEnl = "";
  test("E0 prepara un contrato con una línea de traslado enlazada a su CxP (conversión real del carrito) sobre un servicio exclusivo", async () => {
    sql(`insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion, tipo_receptivo) values
          (${SRV_BAJA}, 'Traslado a dar de baja 262', 6201, 6201, 0, 'tour_traslado', 'COP', 'persona', 'paquete', 'traslado'), (${SRV_SIN}, 'Servicio sin enlace 262', 6201, 6201, 10, 'otro', 'COP', 'persona', 'paquete', null);
         insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (${ALTA(SRV_BAJA)}, ${SRV_BAJA}, 'ALTA', '2030-01-01', '2030-12-31', 0);
         insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, precio) values (${ALTA(SRV_BAJA)}, 'trayecto', 50000), (${ALTA(SRV_BAJA)}, 'ida_regreso', 80000);
         insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (${PAQ}, ${SRV_BAJA}, 'persona', false);`);
    await generar();
    const id = await cotizarOk([tour(SRV_BAJA, 2, { alcance: "llegada", horas: H_DIA })]);
    const r = await convertir(id); assert.equal(r.ok, true, r.error); numeroEnl = r.numeros![0];
    verificarEnlace(numeroEnl, id, [{ s: SRV_BAJA, alcance: "llegada", costo: 100000 }]);
  });
  test("E0b HALLAZGO previo a la 262: un servicio PUBLICADO en un tarifario no se puede borrar (FK tarifario_resultado NO ACTION, 23503), con o sin enlace; ese error sale antes que el de la línea protegida", async () => {
    const d = await httpDel("superadmin", SRV_BAJA);
    console.log("      DELETE de un servicio publicado →", d.s, String((d.j as { message?: string }).message).slice(0, 140));
    assert.equal((d.j as { code?: string }).code, "23503"); assert.match(String((d.j as { message?: string }).message), /tarifario_resultado_servicio_id_fkey/);
    sql(`delete from public.tarifario_resultado where servicio_id = ${SRV_BAJA}`); // se despublica: ahora solo la línea protegida puede impedir el borrado
    assert.equal(sql(`select count(*) from public.tarifario_resultado where servicio_id = ${SRV_BAJA}`), "0");
  });
  test("E1 DELETE por HTTP de un servicio CON línea enlazada: superadmin, gerencia, operaciones y administracion reciben 403/42501 y nada cambia", async () => {
    const antes = { cx: cxpsDe(numeroEnl), ln: lineasAlcance(numeroEnl) };
    for (const rol of ["superadmin", "gerencia", "operaciones", "administracion"]) {
      const d = await httpDel(rol, SRV_BAJA);
      const j = d.j as { code?: string; message?: string };
      assert.equal(d.s, 403, `${rol}: HTTP ${d.s} ${d.tx}`); assert.equal(j.code, "42501"); assert.match(String(j.message), /cuenta por pagar enlazada/);
      assert.equal(esRechazoServicioConObligaciones({ code: j.code, message: j.message }), true);
      assert.equal(mensajeErrorEliminarServicio({ code: j.code, message: j.message }), MENSAJE_SERVICIO_CON_OBLIGACIONES);
    }
    assert.deepEqual({ cx: cxpsDe(numeroEnl), ln: lineasAlcance(numeroEnl) }, antes, "la línea, la CxP y el vínculo quedan intactos");
    assert.equal(sql(`select count(*) from public.servicios_adicionales where id = ${SRV_BAJA}`), "1", "el servicio sigue existiendo");
    const dv = await httpDel("venta", SRV_BAJA); assert.ok(dv.s >= 400 || (Array.isArray(dv.j) && dv.j.length === 0), "venta no borra (RLS)");
  });
  test("E2 DELETE por HTTP de un servicio SIN enlace: se elimina", async () => {
    const d = await httpDel("operaciones", SRV_SIN); assert.ok(d.s === 200 || d.s === 204, `HTTP ${d.s} ${d.tx}`);
    assert.equal(sql(`select count(*) from public.servicios_adicionales where id = ${SRV_SIN}`), "0");
  });
  test("E3 acción REAL eliminarServicio (sesión superadmin): con enlace → aviso previo con MENSAJE_SERVICIO_CON_OBLIGACIONES; sin enlace → ok", async () => {
    uidSesion = UID_SUPER;
    try {
      const r = await eliminarServicio(SRV_BAJA);
      assert.deepEqual(r, { ok: false, error: MENSAJE_SERVICIO_CON_OBLIGACIONES }, "aviso previo");
      assert.equal(sql(`select count(*) from public.servicios_adicionales where id = ${SRV_BAJA}`), "1");
      sql(`insert into public.servicios_adicionales (id, nombre, proveedor_id, precio_persona, categoria, moneda, tipo_tarifa) values (6292, 'Libre 262', 6201, 1, 'otro', 'COP', 'persona')`);
      assert.deepEqual(await eliminarServicio(6292), { ok: true });
      assert.equal(sql("select count(*) from public.servicios_adicionales where id = 6292"), "0");
    } finally { uidSesion = UID_ADMIN; }
  });
  test("E4 acción REAL con el aviso previo NO disponible (la lectura de cuentas_por_pagar falla): el error 42501 de la BASE se traduce al mismo mensaje y no se borra nada", async () => {
    // Se hace fallar SOLO la lectura previa de cuentas_por_pagar (como si la RLS no dejara leer); el DELETE sigue siendo el real contra la base.
    const real = clienteLocal(jwt({ role: "authenticated", sub: UID_SUPER, session_id: sidDe(UID_SUPER) }), { id: UID_SUPER, email: `${UID_SUPER}@x.test` });
    const original = real.from.bind(real);
    (real as unknown as { from: (t: string) => unknown }).from = (t: string) => t === "cuentas_por_pagar"
      ? { select: () => ({ eq: () => ({ not: () => ({ limit: async () => ({ data: null, error: { message: "sin permiso de lectura (simulado)" } }) }) }) }) }
      : original(t as never);
    usarClienteSesion = real;
    try {
      const antes = { cx: cxpsDe(numeroEnl), ln: lineasAlcance(numeroEnl) };
      const r = await eliminarServicio(SRV_BAJA);
      assert.deepEqual(r, { ok: false, error: MENSAJE_SERVICIO_CON_OBLIGACIONES }, "traducción del rechazo de la base");
      assert.deepEqual({ cx: cxpsDe(numeroEnl), ln: lineasAlcance(numeroEnl) }, antes);
      assert.equal(sql(`select count(*) from public.servicios_adicionales where id = ${SRV_BAJA}`), "1", "la protección de la base sigue activa");
    } finally { usarClienteSesion = null; }
  });
});

describe("262 · ruta de oferta #63 (crearCotizacion -> convertirCotizacion -> aceptar_oferta_63 -> p63_registrar_financiero)", () => {
  const inp = (paq: number, sal: number, servicios: number[]) => ({
    paqueteId: paq, bloqueoId: null, salidaId: sal, modulo: "dinamico", hotelId: HOT1, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", categoria: "Estandar", regimen: "Desayuno",
    habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [], cantidadMenores: 0, cliente: { ...CLIENTE, tipoDoc: "CC" }, tipoAsesor: "interno", asesorInterno: "Asesor 262",
    agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: PAX.slice(0, 2), servicios,
  });
  const cuentas = () => ({ cot: sql("select count(*) from public.cotizaciones"), ofe: sql("select count(*) from public.p63_oferta"), ace: sql("select count(*) from public.p63_aceptacion"), ventas: sql("select count(*) from public.ventas"), cxp: sql("select count(*) from public.cuentas_por_pagar") });
  test("O0 se publica el paquete dinámico en modo #63 (COP con TRM)", async () => {
    const g = await generarTarifario(PAQ_63); assert.equal(g.ok, true, JSON.stringify(g));
    console.log("      filas publicadas:", sql(`select modulo||':'||count(*) from public.tarifario_resultado_publicable where paquete_id = ${PAQ_63} group by modulo`));
  });
  const conv63 = async (id: number) => convertirCotizacion(id, PAX.slice(0, 2) as never, false, "Asesor 262", null, "COP", null) as Promise<{ ok: boolean; numero?: string; error?: string }>;
  const cxp63 = (n: string) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('servicio', servicio, 'tipo', tipo_proveedor, 'valor', valor_total::float8, 'cop63', valor_cop_63::float8, 'trm63', trm_63::float8, 'obl', obligacion_63, 'acep', aceptacion_63_id, 'sid', servicio_id) order by id)::text, '[]') from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`)) as Array<{ servicio: string; tipo: string; valor: number; cop63: number | null; trm63: number | null; obl: string | null; acep: number | null; sid: number | null }>;
  let numeroOk = "", cotOk = 0;
  test("O1 servicios NO traslado (legado, tour clasificado, asistencia médica) por la ruta #63: contrato con aceptación, CxP con obligacion_63 y valor_cop_63 y los importes de siempre", async () => {
    const c = await crearCotizacion(inp(PAQ_63, SAL_63, [S_LEG, S_TOUR, S_ASIS]) as never) as { ok: boolean; id?: number; error?: string };
    assert.equal(c.ok, true, c.error); cotOk = c.id!;
    assert.equal(sql(`select count(*) from public.p63_oferta o where o.cotizacion_id = ${cotOk}`), "1", "es una oferta #63 real");
    const r = await conv63(cotOk); assert.equal(r.ok, true, r.error); numeroOk = r.numero!;
    assert.notEqual(sql(`select coalesce(aceptacion_63_id::text,'-') from public.ventas where numero_contrato = ${lit(numeroOk)}`), "-", "ventas.aceptacion_63_id fijado");
    assert.equal(sql(`select financiero_estado from public.ventas where numero_contrato = ${lit(numeroOk)}`), "completo");
    const cx = cxp63(numeroOk); console.log("      CxP #63:", JSON.stringify(cx.map((x) => [x.servicio, x.tipo, x.valor, x.cop63, x.obl])));
    const por = (sid: number) => cx.find((x) => x.sid === sid);
    assert.equal(por(S_LEG)?.valor, 100000); assert.equal(por(S_TOUR)?.valor, 80000); assert.equal(por(S_ASIS)?.valor, 60000);
    for (const x of cx) { assert.ok(x.obl, `${x.servicio}: obligacion_63`); assert.equal(x.cop63, x.valor, `${x.servicio}: valor_cop_63 = valor (COP)`); assert.ok(x.acep); }
    assert.equal(sql(`select count(*) from public.contrato_servicios where numero_contrato = ${lit(numeroOk)} and (alcance_traslado is not null or clave_enlace is not null)`), "0", "ninguna línea por alcance");
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(numeroOk)} and (contrato_servicio_id is not null or alcance_traslado is not null)`), "0");
  });
  test("O2 servicio OPCIONAL clasificado traslado en input.servicios: crearCotizacion lo rechaza (MENSAJE_TRASLADO_POR_ALCANCE_SOLO_CARRITO) sin escribir nada", async () => {
    for (const lista of [[S_TR], [S_LEG, S_TR]]) {
      const antes = cuentas();
      const c = await crearCotizacion(inp(PAQ_63, SAL_63, lista) as never) as { ok: boolean; error?: string };
      console.log("      →", c.ok ? "COTIZÓ (!)" : c.error);
      assert.equal(c.ok, false); assert.match(c.error ?? "", /carrito/i);
      assert.deepEqual(cuentas(), antes, "ni cotización, ni oferta, ni aceptación, ni venta, ni CxP");
    }
  });
  test("O3 cotización #63 YA creada y luego alterada para incluir un traslado: la conversión lo rechaza antes de aceptar la oferta (sin aceptación, sin número, sin CxP)", async () => {
    const c = await crearCotizacion(inp(PAQ_63, SAL_63, [S_LEG]) as never) as { ok: boolean; id?: number };
    assert.equal(c.ok, true);
    sql(`update public.cotizaciones set payload = jsonb_set(payload, '{servicios}', '[${S_LEG},${S_TR}]'::jsonb) where id = ${c.id}`);
    const antes = cuentas();
    const r = await conv63(c.id!); console.log("      conversión alterada →", r.ok ? "CONVIRTIÓ (!)" : r.error);
    assert.equal(r.ok, false);
    assert.deepEqual(cuentas(), antes, "nada escrito");
  });
  test("O4 traslado por alcance INCLUIDO en un paquete: se rechaza al publicar o, a más tardar, al cotizar (#63), sin escribir nada", async () => {
    const g = await generarTarifario(PAQ_63I);
    console.log("      generarTarifario(paquete con traslado incluido) →", g.ok ? "ok" : (g as { error?: string }).error, "· diagnóstico:", sql("select coalesce(tarifario_diagnostico, '-') from public.armado_paquetes where id = " + PAQ_63I).slice(0, 400), "· filas publicadas:", sql("select count(*) from public.tarifario_resultado_publicable where paquete_id = " + PAQ_63I));
    const antes = cuentas();
    const c = await crearCotizacion(inp(PAQ_63I, SAL_63I, []) as never) as { ok: boolean; error?: string };
    console.log("      crearCotizacion sobre ese paquete →", c.ok ? "COTIZÓ (!)" : c.error);
    if (!g.ok) assert.match(String((g as { error?: string }).error), /no puede ir incluido/);
    assert.equal(c.ok, false, "no se puede cotizar un paquete con un traslado por alcance incluido");
    assert.deepEqual(cuentas(), antes);
  });
  test("O5 SEGURIDAD DEL ENLACE sobre un contrato ligado a una aceptación #63 con el financiero pendiente", async () => {
    const n = numeroOk; const acep = Number(sql(`select aceptacion_63_id from public.ventas where numero_contrato = ${lit(n)}`));
    // Se devuelve el contrato (ya convertido) a 'materializando'/'pendiente' con el payload derivado de la oferta guardado; los triggers de la 265 NO se tocan.
    sql(`set session_replication_role = replica;
         delete from public.cuentas_por_pagar where numero_contrato = ${lit(n)};
         update public.p63_aceptacion set estado = 'materializando' where id = ${acep};
         update public.ventas set financiero_estado = 'pendiente' where numero_contrato = ${lit(n)};
         insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) select '${n}', 'mayorista', d -> 'costos', d -> 'cxp' from (select public.p63_financiero_derivado(${acep}) d) q on conflict (numero_contrato) do update set costos = excluded.costos, cxp = excluded.cxp;
         set session_replication_role = origin;`);
    const derivado = JSON.parse(sql(`select p63_financiero_derivado(${acep})::text`)) as { costos: unknown; cxp: Array<Record<string, unknown>> };
    console.log("      derivado de la oferta:", derivado.cxp.length, "obligaciones; claves de la 1ª:", Object.keys(derivado.cxp[0]).join(","));
    const clave = crypto.randomUUID();
    sql(`insert into public.contrato_servicios (numero_contrato, tipo, descripcion, costo, servicio_id, alcance_traslado, clave_enlace) values (${lit(n)}, 'traslado', 'Traslado persona 262 · Un trayecto: llegada', 100000, ${S_TR}, 'llegada', '${clave}')`);
    const rpc = async (cxp: unknown) => clienteLocal(TOKEN_SERVICIO).rpc("registrar_financiero_contrato", { p_numero_contrato: n, p_tenant: "mayorista", p_costos: derivado.costos as never, p_cxp: cxp as never });
    const est = () => sql(`select financiero_estado||'/'||(select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)})||'/'||(select estado from public.p63_aceptacion where id = ${acep}) from public.ventas where numero_contrato = ${lit(n)}`);
    assert.equal(est(), "pendiente/0/materializando");
    // (1) payload del carrito: lo derivado MÁS una CxP del traslado con la clave en observaciones
    const conClave = [...derivado.cxp, { tipo_proveedor: "receptivo", proveedor: "P", servicio: "Traslado persona 262 · Un trayecto: llegada", servicio_id: S_TR, valor_total: 100000, moneda: "COP", observaciones: `Generado automáticamente desde el carrito (tarifario) · enlace:${clave}` }];
    const r1 = await rpc(conClave); console.log("      p_cxp con la clave →", r1.error?.message?.slice(0, 160) ?? "OK (!)");
    assert.ok(r1.error && /p63_payload_alterno/.test(r1.error.message), "p63 exige que el payload sea EXACTAMENTE el derivado de la oferta: el del carrito (con traslado y clave) no lo es");
    assert.equal(est(), "pendiente/0/materializando", "revierte todo");
    // (2) payload exactamente derivado (sin la CxP del traslado): p63 inserta lo derivado y al completar, el trigger de la 265 impide dejar el traslado sin CxP
    const r2 = await rpc(derivado.cxp); console.log("      p_cxp derivado, con la línea de traslado sin CxP →", r2.error?.message?.slice(0, 160) ?? "OK (!)");
    assert.ok(r2.error && /financiero incompleto: un traslado por alcance/.test(r2.error.message), "ventas_completo_exige_enlaces rechaza");
    assert.equal(est(), "pendiente/0/materializando", "la RPC revierte: ninguna CxP, sigue pendiente, la aceptación sigue materializando");
    // (3) control: sin la línea con alcance el mismo payload completa el contrato (el bloqueo era por el traslado, no por otra causa)
    sql(`delete from public.contrato_servicios where numero_contrato = ${lit(n)} and alcance_traslado is not null`);
    const r3 = await rpc(derivado.cxp); assert.equal(r3.error, null, r3.error?.message);
    assert.match(est(), /^completo\/\d+\/completa$/);
    const filas = cxp63(n); assert.ok(filas.every((x) => x.obl && x.acep === acep), "p63 copia obligacion_63 y aceptacion_63_id; las observaciones salen del derivado");
    console.log("      observaciones de las CxP creadas por p63:", JSON.stringify([...new Set(JSON.parse(sql(`select json_agg(observaciones)::text from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`)) as string[])]));
  });
});

// ═════════════════════════════════════════════════════════════════════
// Quinta ronda · B. Reentrada del cron con las CxP del carrito YA existentes (OBS_AUTO empieza por marca_cxp_automatica()).
describe("262 · reentrada del cron con CxP presentes (reemplazo exacto, asientos, idempotencia y fallo cerrado con pagos)", () => {
  type Fila = { id: number; servicio: string; valor: number; moneda: string; sid: number | null; alc: string | null; obs: string; cs: number | null; clave: string | null };
  const filas = (n: string) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('id', c.id, 'servicio', c.servicio, 'valor', c.valor_total::float8, 'moneda', c.moneda, 'sid', c.servicio_id, 'alc', c.alcance_traslado, 'obs', c.observaciones, 'cs', c.contrato_servicio_id, 'clave', l.clave_enlace) order by c.servicio, c.valor_total, c.id)::text, '[]') from public.cuentas_por_pagar c left join public.contrato_servicios l on l.id = c.contrato_servicio_id where c.numero_contrato = ${lit(n)}`)) as Fila[];
  /** Huella SIN el id de la CxP (cambia al recrearla): todo lo demás, ordenado por servicio/valor. */
  const huella = (f: Fila[]) => createHash("md5").update(f.map((x) => [x.servicio, x.valor, x.moneda, x.sid, x.alc, x.obs, x.cs, x.clave].join("¦")).join("\n")).digest("hex");
  const asientos = (n: string) => JSON.parse(sql(`select coalesce(json_agg(a.referencia order by a.referencia)::text, '[]') from public.asientos_contables a where a.origen = 'cxp' and a.referencia in (select 'cxp:' || id from public.cuentas_por_pagar where numero_contrato = ${lit(n)})`)) as string[];
  const asientosHuerfanos = (idsViejos: number[]) => Number(sql(`select count(*) from public.asientos_contables where origen = 'cxp' and referencia in (${idsViejos.map((i) => `'cxp:${i}'`).join(",") || "'-'"})`));
  const dejarPendiente = (n: string) => sql(`update public.ventas set financiero_estado = 'pendiente', financiero_actualizado_en = now() - interval '1 hour' where numero_contrato = ${lit(n)};
      insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) select numero, 'mayorista', costos, cxp from public.t_pay262 where numero = ${lit(n)} on conflict (numero_contrato) do update set costos = excluded.costos, cxp = excluded.cxp, intentos = 0, ultimo_error = null;`);
  const cron = async () => reconciliarFinancieroPendienteCron(process.env.CRON_SECRET ?? null, 1);
  let n = "", cotId = 0;
  test("R1 contrato de carrito (2 traslados idénticos de distinto pax + 1 de otro alcance + tour + legado) y su huella inicial", async () => {
    cotId = await cotizarOk([
      tour(S_TR, 2, { alcance: "llegada", horas: H_DIA }), tour(S_TR, 3, { alcance: "llegada", horas: H_NOCHE }), tour(S_TR, 2, { alcance: "ida_regreso", horas: H_DIA }), tour(S_TOUR, 2), tour(S_LEG, 2),
    ]);
    const r = await convertir(cotId, 5, [2, 3, 2, 2, 2]); assert.equal(r.ok, true, r.error); n = r.numeros![0];
    verificarEnlace(n, cotId, [{ s: S_TR, alcance: "llegada", costo: 200000 }, { s: S_TR, alcance: "llegada", costo: 330000 }, { s: S_TR, alcance: "ida_regreso", costo: 340000 }]);
    const f = filas(n); assert.equal(f.length, 5);
    assert.ok(f.every((x) => x.obs.startsWith(sql("select public.marca_cxp_automatica()"))), "ahora TODAS las observaciones del carrito empiezan por marca_cxp_automatica()");
    assert.equal(asientos(n).length, 5, "un asiento contable de devengo por CxP: " + JSON.stringify(asientos(n)));
  });
  test("R2 reentrada con las CxP PRESENTES: la RPC las reconoce y reemplaza; el conjunto final es exactamente el mismo, enlazado a las mismas líneas", async () => {
    const antes = filas(n); const h0 = huella(antes); const idsViejos = antes.map((x) => x.id);
    const lineasAntes = lineasAlcance(n).map((l) => `${l.id}:${l.clave_enlace}`).join(",");
    dejarPendiente(n);
    const rr = await cron(); console.log("      cron →", JSON.stringify(rr).slice(0, 300));
    assert.equal(rr.ok, true);
    assert.equal(sql(`select financiero_estado from public.ventas where numero_contrato = ${lit(n)}`), "completo");
    const despues = filas(n);
    assert.equal(despues.length, antes.length, "mismo número de CxP (sin duplicados ni pérdida)");
    assert.equal(huella(despues), h0, "huella md5 (servicio, valor_total, moneda, servicio_id, alcance, observaciones con la clave, línea enlazada y su clave) idéntica");
    assert.ok(despues.every((d) => !idsViejos.includes(d.id)), "las CxP son nuevas: las anteriores se reemplazaron");
    assert.equal(lineasAlcance(n).map((l) => `${l.id}:${l.clave_enlace}`).join(","), lineasAntes, "las líneas de contrato_servicios no cambian (mismos ids y claves)");
    const as = asientos(n);
    assert.deepEqual(as, despues.map((d) => `cxp:${d.id}`).sort(), "1 asiento por CxP vigente");
    assert.equal(asientosHuerfanos(idsViejos), 0, "ningún asiento huérfano de las CxP reemplazadas");
    assert.equal(sql(`select count(*) from public.contrato_financiero_pendiente where numero_contrato = ${lit(n)}`), "0");
  });
  test("R3 repetir el cron no cambia nada", async () => {
    const f1 = filas(n); const a1 = asientos(n);
    const rr = await cron(); assert.equal(rr.ok, true);
    const f2 = filas(n); assert.deepEqual(f2.map((x) => x.id), f1.map((x) => x.id)); assert.equal(huella(f2), huella(f1)); assert.deepEqual(asientos(n), a1);
    // y sobre un contrato ya 'completo' una llamada directa a la RPC es un no-op (ya_completo)
    const r = await clienteLocal(TOKEN_SERVICIO).rpc("registrar_financiero_contrato", { p_numero_contrato: n, p_tenant: "mayorista", p_costos: {} as never, p_cxp: [] as never });
    assert.equal((r.data as { ya_completo?: boolean } | null)?.ya_completo, true);
    assert.deepEqual(filas(n).map((x) => x.id), f1.map((x) => x.id));
  });
  test("R4 con un PAGO en una CxP la reentrada falla CERRADA: sin duplicar ni perder, el contrato sigue pendiente con ultimo_error", async () => {
    const f = filas(n); const h0 = huella(f); const ids0 = f.map((x) => x.id); const a0 = asientos(n);
    const conPago = f.find((x) => x.servicio.includes("ida y regreso") || x.servicio.endsWith("Ida y regreso"))!;
    sql(`insert into public.cxp_pagos (cuenta_por_pagar_id, valor, tenant) values (${conPago.id}, 1000, 'mayorista')`);
    dejarPendiente(n);
    const rr = await cron(); console.log("      cron con pago →", JSON.stringify(rr).slice(0, 700));
    const g = filas(n);
    assert.deepEqual(g.map((x) => x.id), ids0, "ni se borró ni se duplicó ninguna CxP (la RPC es atómica)");
    assert.equal(huella(g), h0); assert.deepEqual(asientos(n), a0, "los asientos no cambian");
    assert.equal(sql(`select financiero_estado from public.ventas where numero_contrato = ${lit(n)}`), "pendiente", "el contrato sigue pendiente");
    const err = sql(`select coalesce(ultimo_error, '-') from public.contrato_financiero_pendiente where numero_contrato = ${lit(n)}`);
    console.log("      ultimo_error:", err.slice(0, 500));
    assert.notEqual(err, "-", "queda ultimo_error"); assert.match(err, /ya tiene una cuenta por pagar|23505|enlace/i, "la causa: la CxP con pago no se reemplaza y su clave ya está usada");
    assert.equal(sql(`select count(*) from public.contrato_servicios where numero_contrato = ${lit(n)} and alcance_traslado is not null`), "3", "las líneas siguen");
    console.log("      ¿el cron deshizo el contrato? ventas =", sql(`select count(*) from public.ventas where numero_contrato = ${lit(n)}`), "· texto:", /tampoco se pudo deshacer/.test(JSON.stringify(rr)) ? "NO pudo deshacerlo (FK)" : "sin intento de deshacer");
  });
  test("R5 con una RETENCIÓN en otra CxP pasa lo mismo (nunca se reemplaza una CxP con retención)", async () => {
    sql(`delete from public.cxp_pagos where cuenta_por_pagar_id in (select id from public.cuentas_por_pagar where numero_contrato = ${lit(n)})`);
    const f = filas(n); const h0 = huella(f); const ids0 = f.map((x) => x.id);
    const conRet = f.find((x) => x.alc === "llegada" && x.valor === 200000)!;
    sql(`insert into public.retenciones_cxp (cuenta_por_pagar_id, valor, fecha_practica, mes_declaracion, tenant) values (${conRet.id}, 500, current_date, date_trunc('month', current_date)::date, 'mayorista')`);
    dejarPendiente(n);
    await cron();
    assert.deepEqual(filas(n).map((x) => x.id), ids0); assert.equal(huella(filas(n)), h0);
    assert.equal(sql(`select financiero_estado from public.ventas where numero_contrato = ${lit(n)}`), "pendiente");
    assert.match(sql(`select coalesce(ultimo_error, '-') from public.contrato_financiero_pendiente where numero_contrato = ${lit(n)}`), /ya tiene una cuenta por pagar|23505|enlace/i);
    sql(`delete from public.retenciones_cxp where cuenta_por_pagar_id = ${conRet.id}`);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Quinta ronda · C. Borrado de un servicio PUBLICADO en tarifario_resultado.
describe("262 · borrar un servicio publicado (23503 traducido) y prioridad de las obligaciones", () => {
  const SP = 6293, SPL = 6294, SLIB = 6295;
  const httpDel = async (rol: string, id: number) => {
    const r = await fetch(`${PGRST}/servicios_adicionales?id=eq.${id}`, { method: "DELETE", headers: { authorization: `Bearer ${jwt({ role: "authenticated", sub: ROL_HTTP(rol), session_id: sidDe(ROL_HTTP(rol)) })}`, prefer: "return=representation" } });
    const tx = await r.text(); let j: { code?: string; message?: string } = {}; try { j = JSON.parse(tx); } catch { /* texto */ }
    return { s: r.status, j, tx };
  };
  /** Huella md5 + conteos de TODO lo que cuelga del servicio. */
  const huellaServicio = (id: number) => sql(`select
    (select count(*) from public.servicio_temporadas where servicio_id = ${id}) || '/' || (select count(*) from public.servicio_tarifa_pax where servicio_id = ${id}) || '/' ||
    (select count(*) from public.servicio_precio_alcance where servicio_temporada_id in (select id from public.servicio_temporadas where servicio_id = ${id})) || '/' ||
    (select count(*) from public.servicio_suplementos_franja where servicio_temporada_id in (select id from public.servicio_temporadas where servicio_id = ${id})) || '/' ||
    (select count(*) from public.armado_servicios where servicio_id = ${id}) || '/' || (select count(*) from public.tarifario_resultado where servicio_id = ${id}) || '/' ||
    md5(coalesce((select string_agg(t::text, '|' order by t.id) from public.servicios_adicionales t where id = ${id}), '') || coalesce((select string_agg(t::text, '|' order by t.id) from public.servicio_temporadas t where servicio_id = ${id}), '')
      || coalesce((select string_agg(t::text, '|' order by t.id) from public.servicio_tarifa_pax t where servicio_id = ${id}), '')
      || coalesce((select string_agg(t::text, '|' order by t.id) from public.servicio_precio_alcance t where servicio_temporada_id in (select id from public.servicio_temporadas where servicio_id = ${id})), '')
      || coalesce((select string_agg(t::text, '|' order by t.id) from public.servicio_suplementos_franja t where servicio_temporada_id in (select id from public.servicio_temporadas where servicio_id = ${id})), '')
      || coalesce((select string_agg(t::text, '|' order by t.paquete_id) from public.armado_servicios t where servicio_id = ${id}), '')
      || coalesce((select string_agg(t.id::text || ':' || t.precio_pvp, '|' order by t.id) from public.tarifario_resultado t where servicio_id = ${id}), ''))`);
  test("P0 prepara dos traslados publicados (uno sin contratos y otro con una CxP enlazada) y uno sin publicar", async () => {
    sql(`insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion, tipo_receptivo) values
         (${SP}, 'Publicado sin contratos 262', 6201, 6201, 0, 'tour_traslado', 'COP', 'persona', 'paquete', 'traslado'), (${SPL}, 'Publicado con CxP 262', 6201, 6201, 0, 'tour_traslado', 'COP', 'persona', 'paquete', 'traslado'),
         (${SLIB}, 'Sin publicar 262', 6201, 6201, 5, 'otro', 'COP', 'persona', 'paquete', null);
         insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (${ALTA(SP)}, ${SP}, 'ALTA', '2030-01-01', '2030-12-31', 0), (${ALTA(SPL)}, ${SPL}, 'ALTA', '2030-01-01', '2030-12-31', 0), (${ALTA(SLIB)}, ${SLIB}, 'ALTA', '2030-01-01', '2030-12-31', 5);
         insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, precio) values (${ALTA(SP)}, 'trayecto', 10000), (${ALTA(SP)}, 'ida_regreso', 18000), (${ALTA(SPL)}, 'trayecto', 20000), (${ALTA(SPL)}, 'ida_regreso', 36000);
         insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro, pax_desde, pax_hasta) values (${ALTA(SP)}, '19:00', '06:00', 'ambos', 'monto', 5000, 'grupo', 1, 4);
         insert into public.servicio_tarifa_pax (servicio_id, pax_desde, pax_hasta, precio, temporada) values (${SP}, 1, 4, 1, 'ALTA');
         insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (${PAQ}, ${SP}, 'persona', false), (${PAQ}, ${SPL}, 'persona', false);`);
    await generar();
    assert.ok(Number(sql(`select count(*) from public.tarifario_resultado where servicio_id = ${SP}`)) > 0, "SP publicado");
    assert.ok(Number(sql(`select count(*) from public.tarifario_resultado where servicio_id = ${SPL}`)) > 0, "SPL publicado");
    const id = await cotizarOk([tour(SPL, 2, { alcance: "llegada", horas: H_DIA })]);
    const r = await convertir(id); assert.equal(r.ok, true, r.error);
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where servicio_id = ${SPL} and contrato_servicio_id is not null`), "1");
  });
  test("P1 servicio PUBLICADO sin contratos: DELETE por HTTP da 23503 de tarifario_resultado; la acción real devuelve MENSAJE_SERVICIO_PUBLICADO; NADA se pierde (conteos y md5)", async () => {
    const h0 = huellaServicio(SP); console.log("      huella antes:", h0);
    for (const rol of ["superadmin", "gerencia", "operaciones"]) {
      const d = await httpDel(rol, SP);
      assert.equal(d.s, 409, `${rol}: HTTP ${d.s} ${d.tx}`); assert.equal(d.j.code, "23503"); assert.match(String(d.j.message), /tarifario_resultado_servicio_id_fkey/);
      assert.equal(esRechazoServicioPublicado({ code: d.j.code, message: d.j.message }), true); assert.equal(esRechazoServicioConObligaciones({ code: d.j.code, message: d.j.message }), false);
      assert.equal(mensajeErrorEliminarServicio({ code: d.j.code, message: d.j.message }), MENSAJE_SERVICIO_PUBLICADO);
    }
    uidSesion = UID_SUPER;
    try { assert.deepEqual(await eliminarServicio(SP), { ok: false, error: MENSAJE_SERVICIO_PUBLICADO }); } finally { uidSesion = UID_ADMIN; }
    assert.equal(huellaServicio(SP), h0, "tarifas, vigencias, precios por alcance, franjas, rangos, armado y filas publicadas intactos");
    assert.equal(sql(`select count(*) from public.servicios_adicionales where id = ${SP}`), "1");
  });
  test("P2 publicado Y con CxP enlazada: la acción real da el mensaje de OBLIGACIONES (prioridad por el aviso previo); sin aviso previo, la base responde primero la FK publicada; nada cambia", async () => {
    const h0 = huellaServicio(SPL); const cx0 = sql(`select md5(string_agg(c::text, '|' order by id)) from public.cuentas_por_pagar c where servicio_id = ${SPL}`);
    uidSesion = UID_SUPER;
    try { assert.deepEqual(await eliminarServicio(SPL), { ok: false, error: MENSAJE_SERVICIO_CON_OBLIGACIONES }); } finally { uidSesion = UID_ADMIN; }
    const real = clienteLocal(jwt({ role: "authenticated", sub: UID_SUPER, session_id: sidDe(UID_SUPER) }), { id: UID_SUPER, email: `${UID_SUPER}@x.test` });
    const original = real.from.bind(real);
    (real as unknown as { from: (t: string) => unknown }).from = (t: string) => t === "cuentas_por_pagar"
      ? { select: () => ({ eq: () => ({ not: () => ({ limit: async () => ({ data: null, error: { message: "sin permiso de lectura (simulado)" } }) }) }) }) }
      : original(t as never);
    usarClienteSesion = real;
    try {
      const r = await eliminarServicio(SPL);
      console.log("      sin aviso previo, publicado + enlazado →", JSON.stringify(r).slice(0, 160));
      assert.equal(r.ok, false);
    } finally { usarClienteSesion = null; }
    assert.equal(huellaServicio(SPL), h0); assert.equal(sql(`select md5(string_agg(c::text, '|' order by id)) from public.cuentas_por_pagar c where servicio_id = ${SPL}`), cx0);
  });
  test("P3 un servicio SIN publicar y sin enlace se elimina (HTTP y acción real)", async () => {
    const d = await httpDel("operaciones", SLIB); assert.ok(d.s === 200 || d.s === 204, `HTTP ${d.s} ${d.tx}`);
    assert.equal(sql(`select count(*) from public.servicios_adicionales where id = ${SLIB}`), "0");
    sql(`insert into public.servicios_adicionales (id, nombre, proveedor_id, precio_persona, categoria, moneda, tipo_tarifa) values (6296, 'Libre 2 262', 6201, 1, 'otro', 'COP', 'persona')`);
    uidSesion = UID_SUPER; try { assert.deepEqual(await eliminarServicio(6296), { ok: true }); } finally { uidSesion = UID_ADMIN; }
  });
});

// ═════════════════════════════════════════════════════════════════════
// Quinta ronda · A. Traslado por alcance y oferta #63 (COP con TRM y USD): incompatibilidad desde el armado, publicación y venta de los demás servicios.
const { setServicio, setServicios } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const { mensajeTrasladoIncluido, MENSAJE_TRASLADO_POR_ALCANCE_SOLO_CARRITO: MSG_SOLO_CARRITO } = await import("../lib/servicios/alcanceContexto.ts");
const { MENSAJE_PAQUETE_NO_DISPONIBLE_CLIENTE } = await import("../lib/reservar/tarifarioNoVendible.ts");
const HOT_USD = 6212, PAQ_U63 = 6207, SAL_U63 = 6207, SU_LEG = 6213, SU_TOUR = 6214, SU_ASIS = 6215;
before(() => {
  sql(`
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
      values (${HOT_USD}, 6201, 'Hotel USD 262', 6201, 'USD', 0, 5, 6, 12, 1, 6, true);
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (${HOT_USD}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (${HOT_USD}, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa');
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante) values (${HOT_USD}, 'Estandar', 'Desayuno', 'ALTA', 150, 100, 50, 30, 40);
    insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion, tipo_receptivo) values
      (${SU_LEG}, 'Tour legado USD 262', 6201, 6201, 20, 'tour_traslado', 'USD', 'persona', 'paquete', null),
      (${SU_TOUR}, 'Tour clasificado USD 262', 6201, 6201, 30, 'tour_traslado', 'USD', 'persona', 'paquete', 'tour'),
      (${SU_ASIS}, 'Asistencia médica USD 262', 6201, 6201, 10, 'asistencia', 'USD', 'persona', 'paquete', 'asistencia_medica');
    insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values
      (${ALTA(SU_LEG)}, ${SU_LEG}, 'ALTA', '2030-01-01', '2030-12-31', 20), (${ALTA(SU_TOUR)}, ${SU_TOUR}, 'ALTA', '2030-01-01', '2030-12-31', 30), (${ALTA(SU_ASIS)}, ${SU_ASIS}, 'ALTA', '2030-01-01', '2030-12-31', 10);
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, modo_oferta, trm_oferta, activo)
      values (${PAQ_U63}, 'Dinámico 63 USD', 'dinamico', 3, 6201, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'USD', 'USD', 'cop_trm_63', null, true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (${PAQ_U63}, ${HOT_USD}, array['Estandar'], array['Desayuno']);
    insert into public.salidas_dinamicas (id, paquete_id, aerolinea, ruta, origen, fecha_ida, fecha_regreso, valor_tiquete, aplica_mk, ta, fee_infante, activo, moneda)
      values (${SAL_U63}, ${PAQ_U63}, 'Aerolínea 262', 'BOG - CTG - BOG', 'BOG', '2030-03-01', '2030-03-04', 150, true, 0, 0, true, 'USD');
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (${PAQ_U63}, ${SU_LEG}, 'persona', false), (${PAQ_U63}, ${SU_TOUR}, 'persona', false), (${PAQ_U63}, ${SU_ASIS}, 'persona', false), (${PAQ_U63}, ${S_USD}, 'persona', false);
  `);
});

describe("262 · traslado por alcance incompatible con la ruta de oferta #63 desde el armado (COP y USD)", () => {
  const filasPub = (paq: number) => sql(`select count(*) from public.tarifario_resultado where paquete_id = ${paq}`);
  test("I1 marcar INCLUIDO un traslado por las acciones reales (setServicio y setServicios) falla con el mensaje y no escribe; como opcional sí se puede armar", async () => {
    const msg = mensajeTrasladoIncluido("Traslado persona 262");
    for (const paq of [PAQ_63, PAQ_U63]) {
      const antes = sql(`select count(*) from public.armado_servicios where paquete_id = ${paq} and incluido`);
      const a = await setServicio(paq, S_TR, true, "persona", true) as { ok: boolean; error?: string };
      assert.equal(a.ok, false); assert.equal(a.error, msg);
      const b = await setServicios(paq, [{ servicioId: S_TR, modo: "persona", incluido: true }], true) as { ok: boolean; error?: string };
      assert.equal(b.ok, false); assert.match(String(b.error), /no puede ir incluido/);
      assert.equal(sql(`select count(*) from public.armado_servicios where paquete_id = ${paq} and incluido`), antes, `paquete ${paq}: no se marcó como incluido`);
    }
    const opc = await setServicio(PAQ_63, S_TR, true, "persona", false) as { ok: boolean }; assert.equal(opc.ok, true, "como opcional se permite");
  });
  test("I2 armado LEGADO con el traslado ya incluido: generarTarifario devuelve ok:false con el motivo, marca el error de la generación y deja las filas anteriores sin exponerlas (snapshot no publicable)", async () => {
    // paquete 6206 (traslado incluido insertado antes de la regla): primero se publica sin el incluido, luego se vuelve a dejar incluido por SQL (como un armado anterior)
    sql(`update public.armado_servicios set incluido = false where paquete_id = ${PAQ_63I} and servicio_id = ${S_INC}`);
    const g0 = await generarTarifario(PAQ_63I); assert.equal(g0.ok, true, JSON.stringify(g0));
    const pub0 = filasPub(PAQ_63I); const est0 = sql(`select tarifario_estado||'/'||tarifario_snapshot_publicable||'/'||tarifario_generacion_publicada from public.armado_paquetes where id = ${PAQ_63I}`);
    assert.ok(Number(pub0) > 0, "hay publicación previa: " + pub0);
    sql(`update public.armado_servicios set incluido = true where paquete_id = ${PAQ_63I} and servicio_id = ${S_INC}`);
    const g1 = await generarTarifario(PAQ_63I) as { ok: boolean; error?: string };
    console.log("      generarTarifario con el traslado incluido →", g1.ok ? "ok (!)" : g1.error);
    assert.equal(g1.ok, false); assert.equal(g1.error, mensajeTrasladoIncluido("Traslado incluido 262"));
    const fila = sql(`select tarifario_estado||'|'||coalesce(tarifario_error,'-')||'|'||tarifario_snapshot_publicable||'|'||tarifario_generacion_publicada||'|'||tarifario_generacion from public.armado_paquetes where id = ${PAQ_63I}`);
    console.log("      estado tras el fallo:", fila.slice(0, 260), "· filas publicadas antes/después:", pub0, "/", filasPub(PAQ_63I), "· antes:", est0);
    assert.match(fila, /^fallido[|]/); assert.match(fila, /no puede ir incluido/); assert.match(fila, /[|]false[|]/, 'snapshot_publicable = false: la publicación anterior deja de ser vendible');
    assert.equal(sql(`select count(*) from public.tarifario_resultado_publicable where paquete_id = ${PAQ_63I}`), '0', 'la vista pública ya no expone la publicación anterior');
    assert.equal(filasPub(PAQ_63I), pub0, "las filas de tarifario_resultado se conservan; solo se desmarca el snapshot como publicable, como con cualquier otro fallo de negocio");
    const c = await crearCotizacion({ ...inpOferta(PAQ_63I, SAL_63I, []) } as never) as { ok: boolean; error?: string };
    console.log("      ¿se puede cotizar con la publicación anterior? →", c.ok ? "SÍ (usa la publicación previa)" : c.error);
    // Generación fallida: el cliente ve el aviso neutro del paquete, NO el genérico «No se encontró la tarifa seleccionada».
    assert.equal(c.ok, false); assert.equal(c.error, MENSAJE_PAQUETE_NO_DISPONIBLE_CLIENTE); assert.doesNotMatch(String(c.error), /No se encontró la tarifa/);
    sql(`update public.armado_servicios set incluido = false where paquete_id = ${PAQ_63I} and servicio_id = ${S_INC}`);
  });
});

const inpOferta = (paq: number, sal: number, servicios: number[], hotelId = HOT1) => ({
  paqueteId: paq, bloqueoId: null, salidaId: sal, modulo: "dinamico", hotelId, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", categoria: "Estandar", regimen: "Desayuno",
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [], cantidadMenores: 0, cliente: { ...CLIENTE, tipoDoc: "CC" }, tipoAsesor: "interno", asesorInterno: "Asesor 262",
  agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: PAX.slice(0, 2), servicios,
});

describe("262 · oferta #63 en USD de extremo a extremo (TRM provisional congelada)", () => {
  const cx = (n: string) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('servicio', servicio, 'tipo', tipo_proveedor, 'moneda', moneda, 'valor', valor_total::float8, 'cop63', valor_cop_63::float8, 'trm63', trm_63::float8, 'obl', obligacion_63, 'sid', servicio_id) order by id)::text, '[]') from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`)) as Array<{ servicio: string; tipo: string; moneda: string; valor: number; cop63: number; trm63: number; obl: string | null; sid: number | null }>;
  const cuentas = () => ({ cot: sql("select count(*) from public.cotizaciones"), ace: sql("select count(*) from public.p63_aceptacion"), ventas: sql("select count(*) from public.ventas"), cxp: sql("select count(*) from public.cuentas_por_pagar") });
  let cot = 0;
  test("U0 publica el paquete USD en modo oferta #63 (sin TRM de publicación)", async () => {
    const g = await generarTarifario(PAQ_U63); assert.equal(g.ok, true, JSON.stringify(g));
    console.log("      filas USD publicadas:", sql(`select modulo::text||':'||count(*) from public.tarifario_resultado_publicable where paquete_id = ${PAQ_U63} group by modulo`).replace(/\n/g, " "));
  });
  test("U1 crearCotizacion USD con legado + tour + asistencia → oferta #63; convertir SIN TRM provisional se rechaza; con TRM provisional 4000 el contrato congela valor_cop_63/trm_63 coherentes", async () => {
    const c = await crearCotizacion(inpOferta(PAQ_U63, SAL_U63, [SU_LEG, SU_TOUR, SU_ASIS], HOT_USD) as never) as { ok: boolean; id?: number; error?: string };
    assert.equal(c.ok, true, c.error); cot = c.id!;
    assert.equal(sql(`select moneda from public.cotizaciones where id = ${cot}`), "USD");
    const antes = cuentas();
    const sinTrm = await convertirCotizacion(cot, PAX.slice(0, 2) as never, false, "Asesor 262", null, "USD", null) as { ok: boolean; error?: string };
    console.log("      sin TRM provisional →", sinTrm.ok ? "CONVIRTIÓ (!)" : sinTrm.error);
    assert.equal(sinTrm.ok, false); assert.deepEqual(cuentas(), antes, "nada escrito sin TRM provisional");
    const r = await convertirCotizacion(cot, PAX.slice(0, 2) as never, false, "Asesor 262", 4000, "USD", null) as { ok: boolean; numero?: string; error?: string };
    assert.equal(r.ok, true, r.error);
    const n = r.numero!; const f = cx(n);
    console.log("      CxP #63 USD:", JSON.stringify(f.map((x) => [x.servicio, x.moneda, x.valor, x.cop63, x.trm63])));
    assert.equal(sql(`select coalesce(trm_provisional::text,'-') from public.p63_aceptacion where numero_contrato = ${lit(n)}`).replace(/\.0+$/, ""), "4000", "TRM provisional congelada en la aceptación");
    for (const x of f) { assert.equal(x.moneda, "USD"); assert.equal(x.trm63, 4000); assert.equal(x.cop63, x.valor * 4000, `${x.servicio}: valor_cop_63 = valor × TRM`); assert.ok(x.obl); }
    const por = (sid: number) => f.find((x) => x.sid === sid);
    assert.equal(por(SU_LEG)?.valor, 40); assert.equal(por(SU_TOUR)?.valor, 60); assert.equal(por(SU_ASIS)?.valor, 20);
    assert.equal(f.find((x) => x.tipo === "hotel")?.valor, 600); assert.equal(f.find((x) => x.tipo === "aereo")?.valor, 300);
    assert.equal(sql(`select financiero_estado from public.ventas where numero_contrato = ${lit(n)}`), "completo");
    assert.equal(sql(`select count(*) from public.contrato_servicios where numero_contrato = ${lit(n)} and (alcance_traslado is not null or clave_enlace is not null)`), "0");
  });
  test("U2 un traslado por alcance como OPCIONAL en la oferta USD se rechaza con el mismo mensaje y sin escribir (cotizar y convertir una cotización alterada)", async () => {
    const antes = cuentas();
    const c = await crearCotizacion(inpOferta(PAQ_U63, SAL_U63, [SU_LEG, S_USD], HOT_USD) as never) as { ok: boolean; error?: string };
    console.log("      →", c.ok ? "COTIZÓ (!)" : c.error);
    assert.equal(c.ok, false); assert.match(c.error ?? "", /carrito/i); assert.ok((c.error ?? "").startsWith(MSG_SOLO_CARRITO)); assert.deepEqual(cuentas(), antes);
    const ok = await crearCotizacion(inpOferta(PAQ_U63, SAL_U63, [SU_LEG], HOT_USD) as never) as { ok: boolean; id?: number };
    assert.equal(ok.ok, true);
    sql(`update public.cotizaciones set payload = jsonb_set(payload, '{servicios}', '[${SU_LEG},${S_USD}]'::jsonb) where id = ${ok.id}`);
    const a2 = cuentas();
    const r = await convertirCotizacion(ok.id!, PAX.slice(0, 2) as never, false, "Asesor 262", 4000, "USD", null) as { ok: boolean; error?: string };
    assert.equal(r.ok, false); assert.ok((r.error ?? "").startsWith(MSG_SOLO_CARRITO)); assert.deepEqual({ ...cuentas(), cot: a2.cot }, { ...a2, cot: a2.cot });
  });
});

// ═════════════════════════════════════════════════════════════════════
// Quinta ronda · D. Salida dinámica VINCULADA a Empaquetados (vuelo de sistema con horas) + oferta #63 en COP.
const EMP = 6220, PAQ_V = 6208, SAL_V = 6208;
before(() => {
  sql(`
    insert into public.empaquetados (id, aerolinea, ruta, origen, destino_id, fecha_ida, fecha_regreso, hora_llegada_ida, hora_salida_reg, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo, moneda)
      values (${EMP}, 'Aerolínea 262', 'BOG - CTG - BOG', 'BOG', 6201, '2030-03-01', '2030-03-04', '21:00', '22:00', 250000, 300000, 0, true, 'COP');
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, modo_oferta, trm_oferta, activo)
      values (${PAQ_V}, 'Dinámico vinculado 262', 'dinamico', 3, 6201, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', 'cop_trm_63', 4000, true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (${PAQ_V}, ${HOT1}, array['Estandar'], array['Desayuno']);
    insert into public.salidas_dinamicas (id, paquete_id, aerolinea, ruta, origen, fecha_ida, fecha_regreso, valor_tiquete, aplica_mk, ta, fee_infante, activo, moneda, empaquetado_id)
      values (${SAL_V}, ${PAQ_V}, 'Aerolínea 262', 'BOG - CTG - BOG', 'BOG', '2030-03-01', '2030-03-04', 300000, false, 0, 0, true, 'COP', ${EMP});
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (${PAQ_V}, ${S_LEG}, 'persona', false), (${PAQ_V}, ${S_TOUR}, 'persona', false), (${PAQ_V}, ${S_ASIS}, 'persona', false), (${PAQ_V}, ${S_TR}, 'persona', false);
  `);
});

describe("262 · salida dinámica vinculada a Empaquetados (oferta #63)", () => {
  const cuentas = () => ({ cot: sql("select count(*) from public.cotizaciones"), ace: sql("select count(*) from public.p63_aceptacion"), ventas: sql("select count(*) from public.ventas"), cxp: sql("select count(*) from public.cuentas_por_pagar"), sillas: sql("select count(*) from public.sillas where estado <> 'disponible'") });
  const cx = (n: string) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('servicio', servicio, 'tipo', tipo_proveedor, 'valor', valor_total::float8, 'cop63', valor_cop_63::float8, 'obl', obligacion_63, 'sid', servicio_id) order by id)::text, '[]') from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`)) as Array<{ servicio: string; tipo: string; valor: number; cop63: number; obl: string | null; sid: number | null }>;
  test("V0 se publica el paquete vinculado", async () => {
    const g = await generarTarifario(PAQ_V) as { ok: boolean; error?: string }; console.log("      generarTarifario vinculado →", g.ok ? "ok" : g.error);
    assert.equal(g.ok, true, g.error);
    console.log("      filas:", sql(`select modulo::text||':'||count(*) from public.tarifario_resultado_publicable where paquete_id = ${PAQ_V} group by modulo`).replace(/\n/g, " "));
  });
  test("V1 venta de la salida vinculada con legado + tour + asistencia: contrato, aceptación #63 y CxP con sus importes", async () => {
    const c = await crearCotizacion(inpOferta(PAQ_V, SAL_V, [S_LEG, S_TOUR, S_ASIS]) as never) as { ok: boolean; id?: number; error?: string };
    assert.equal(c.ok, true, c.error);
    const r = await convertirCotizacion(c.id!, PAX.slice(0, 2) as never, false, "Asesor 262", null, "COP", null) as { ok: boolean; numero?: string; error?: string };
    assert.equal(r.ok, true, r.error);
    const f = cx(r.numero!); console.log("      CxP vinculada:", JSON.stringify(f.map((x) => [x.servicio, x.tipo, x.valor, x.cop63])));
    const por = (sid: number) => f.find((x) => x.sid === sid);
    assert.equal(por(S_LEG)?.valor, 100000); assert.equal(por(S_TOUR)?.valor, 80000); assert.equal(por(S_ASIS)?.valor, 60000);
    assert.ok(f.every((x) => x.obl && x.cop63 === x.valor));
    assert.equal(f.find((x) => x.tipo === "aereo")?.valor, 500000, "aéreo del empaquetado: tarifa_proveedor 250.000 × 2");
    assert.equal(sql(`select financiero_estado from public.ventas where numero_contrato = ${lit(r.numero!)}`), "completo");
  });
  test("V2 un traslado por alcance como opcional de esa ruta se rechaza con el mensaje y sin escribir", async () => {
    const antes = cuentas();
    const c = await crearCotizacion(inpOferta(PAQ_V, SAL_V, [S_LEG, S_TR]) as never) as { ok: boolean; error?: string };
    assert.equal(c.ok, false); assert.ok((c.error ?? "").startsWith(MSG_SOLO_CARRITO)); assert.deepEqual(cuentas(), antes);
  });
  test("V3 traslado por alcance en el CARRITO ligado a un hotel con salida dinámica vinculada: cotiza solo con horas capturadas (las del empaquetado no se acreditan) y el carrito no convierte salidas dinámicas", async () => {
    const item = { modulo: "dinamico", paqueteId: PAQ_V, hotelId: HOT1, bloqueoId: null, salidaId: SAL_V, hotelNombre: "Hotel Uno 262", destino: "CARTAGENA 262", categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0, itemId: "hv" };
    const t = { servicioId: S_TR, paqueteId: PAQ_V, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, alcance: "ida_regreso", hotelItemId: "hv" };
    const s1 = (await crearSolicitudReserva({ items: [item], tours: [t], cliente: CLIENTE } as never)) as { ok: boolean; error?: string; cotizacion?: { id: number } };
    console.log("      cotizar carrito vinculado, sin horas capturadas →", s1.ok ? "ok" : s1.error);
    const s2 = (await crearSolicitudReserva({ items: [item], tours: [{ ...t, horas: H_NOCHE }], cliente: CLIENTE } as never)) as { ok: boolean; error?: string; cotizacion?: { id: number } };
    console.log("      cotizar carrito vinculado, con horas capturadas por el asesor →", s2.ok ? "ok" : s2.error);
    const antes = cuentas();
    assert.equal(s1.ok, false, "las horas del empaquetado NO se acreditan: sin hora capturada no se cotiza el traslado con franjas");
    assert.match(String(s1.error), /hora de llegada y de salida/);
    assert.equal(s2.ok, true, s2.error);
    const tt = tourCot(s2.cotizacion!.id);
    assert.deepEqual(tt.horas, H_NOCHE); assert.equal(tt.alcance, "ida_regreso"); assert.equal(tt.precio, pvp(400000));
    const r = await convertir(s2.cotizacion!.id, 1, 2, { asignaciones: [[1, 2]] });
    assert.equal(r.ok, false); assert.match(r.error ?? "", /es una salida dinámica; genera su contrato desde Reservar/, "convertirCotizacionCarrito no convierte ítems de salida dinámica (con o sin traslado)");
    assert.deepEqual(cuentas(), antes, "nada escrito");
    // Las horas que se acreditan son las de la FILA de la salida dinámica (salidas_dinamicas.hora_*), no las del vuelo del empaquetado vinculado.
    sql(`update public.salidas_dinamicas set hora_llegada_ida = '21:00', hora_salida_reg = '22:00' where id = ${SAL_V}`);
    sql(`update public.empaquetados set hora_llegada_ida = '10:00', hora_salida_reg = '11:00' where id = ${EMP}`);
    assert.equal((await generarTarifario(PAQ_V)).ok, true);
    const s3 = (await crearSolicitudReserva({ items: [item], tours: [t], cliente: CLIENTE } as never)) as { ok: boolean; error?: string; cotizacion?: { id: number } };
    assert.equal(s3.ok, true, s3.error); assert.deepEqual(tourCot(s3.cotizacion!.id).horas, { llegada: "21:00", salida: "22:00" }, "horas de la fila de la salida, aunque el empaquetado diga 10:00/11:00");
    sql(`update public.empaquetados set hora_llegada_ida = '21:00', hora_salida_reg = '22:00' where id = ${EMP}`);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Sexta ronda · CxP creadas con el TEXTO ANTERIOR de OBS_AUTO («…desde el carrito (tarifario)») en un contrato 'pendiente': ¿qué hace el cron real?
describe("262 · reintento del cron sobre CxP con el texto ANTERIOR (no reconocidas por el DELETE de la RPC)", () => {
  const VIEJO = "Generado automáticamente desde el carrito (tarifario)", NUEVO = "Generado automáticamente desde el tarifario (carrito)";
  type Fila = { id: number; servicio: string; valor: number; moneda: string; sid: number | null; obs: string; alc: string | null; cs: number | null };
  const snap = (n: string, idsRef: number[] = []) => {
    const cxp = JSON.parse(sql(`select coalesce(json_agg(json_build_object('id', id, 'servicio', servicio, 'valor', valor_total::float8, 'moneda', moneda, 'sid', servicio_id, 'obs', observaciones, 'alc', alcance_traslado, 'cs', contrato_servicio_id) order by servicio, valor_total, id)::text, '[]') from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`)) as Fila[];
    const lineas = JSON.parse(sql(`select coalesce(json_agg(json_build_object('id', id, 'clave', clave_enlace) order by id)::text, '[]') from public.contrato_servicios where numero_contrato = ${lit(n)} and alcance_traslado is not null`)) as Array<{ id: number; clave: string }>;
    const asientos = JSON.parse(sql(`select coalesce(json_agg(referencia order by referencia)::text, '[]') from public.asientos_contables where origen = 'cxp' and referencia in (${[...cxp.map((c) => c.id), ...idsRef].map((i) => `'cxp:${i}'`).join(",") || "'-'"})`)) as string[];
    const huerfanos = idsRef.filter((i) => !cxp.some((c) => c.id === i) && asientos.includes(`cxp:${i}`));
    return {
      estado: sql(`select financiero_estado from public.ventas where numero_contrato = ${lit(n)}`),
      error: sql(`select coalesce(left(ultimo_error, 240), '-') from public.contrato_financiero_pendiente where numero_contrato = ${lit(n)}`) || "(sin fila pendiente)",
      cxp, lineas, asientos, huerfanos,
      md5cxp: createHash("md5").update(cxp.map((c) => [c.servicio, c.valor, c.moneda, c.sid, c.obs, c.alc, c.cs].join("¦")).join("\n")).digest("hex").slice(0, 10),
      md5lin: createHash("md5").update(lineas.map((l) => `${l.id}:${l.clave}`).join(",")).digest("hex").slice(0, 10),
    };
  };
  type Snap = ReturnType<typeof snap>;
  const imprimir = (titulo: string, s: Snap) => {
    console.log(`      [${titulo}] estado=${s.estado} · ultimo_error=${s.error} · CxP=${s.cxp.length} md5cxp=${s.md5cxp} · líneas=${s.lineas.length} md5lin=${s.md5lin} · asientos=${s.asientos.length} huérfanos=${s.huerfanos.length}`);
    for (const c of s.cxp) console.log(`         id=${c.id} | ${c.servicio} | ${c.valor} ${c.moneda} | sid=${c.sid} | alc=${c.alc ?? "-"} | cs=${c.cs ?? "-"} | ${c.obs.slice(0, 95)}`);
  };
  const cron = () => reconciliarFinancieroPendienteCron(process.env.CRON_SECRET ?? null, 1);
  /** Convierte con el código nuevo y reescribe el texto de las CxP, del payload persistido y del asiento al de ANTES del cambio; deja el contrato pendiente. */
  async function contratoConTextoAnterior(tours: unknown[], pax: number[]) {
    const id = await cotizarOk(tours); const r = await convertir(id, tours.length, pax); assert.equal(r.ok, true, r.error); const n = r.numeros![0];
    sql(`update public.cuentas_por_pagar set observaciones = replace(observaciones, '${NUEVO}', '${VIEJO}') where numero_contrato = ${lit(n)};
         update public.t_pay262 set cxp = replace(cxp::text, '${NUEVO}', '${VIEJO}')::jsonb where numero = ${lit(n)};
         update public.ventas set financiero_estado = 'pendiente', financiero_actualizado_en = now() - interval '1 hour' where numero_contrato = ${lit(n)};
         insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) select numero, 'mayorista', costos, cxp from public.t_pay262 where numero = ${lit(n)} on conflict (numero_contrato) do update set costos = excluded.costos, cxp = excluded.cxp, intentos = 0, ultimo_error = null;`);
    const s = snap(n); assert.ok(s.cxp.every((c) => c.obs.startsWith(VIEJO)), "todas las CxP llevan el texto anterior"); assert.equal(s.asientos.length, s.cxp.length, "1 asiento por CxP");
    return n;
  }
  const correr = async (n: string, etiqueta: string) => {
    // aísla el escenario: los demás contratos pendientes de pruebas anteriores no entran en esta pasada del cron
    sql(`update public.ventas set financiero_actualizado_en = now() where financiero_estado = 'pendiente' and numero_contrato <> ${lit(n)}`);
    const a = snap(n); imprimir(`${etiqueta} · ANTES`, a);
    const rr = await cron(); console.log(`      cron#1 → ${JSON.stringify(rr).slice(0, 420)}`);
    const b = snap(n, a.cxp.map((c) => c.id)); imprimir(`${etiqueta} · DESPUÉS del cron #1`, b);
    const rr2 = await cron();
    const c = snap(n, a.cxp.map((x) => x.id)); imprimir(`${etiqueta} · DESPUÉS del cron #2`, c);
    return { a, b, c, rr, rr2 };
  };
  test("T-A contrato SOLO con tour + legado (sin alcance, sin clave: como las CxP históricas reales), pendiente con el texto anterior", async () => {
    const n = await contratoConTextoAnterior([tour(S_TOUR, 2), tour(S_LEG, 2)], [2, 2]);
    const { a, b, c } = await correr(n, "A");
    // con el código nuevo: el reintento se NIEGA (antes duplicaba las obligaciones)
    assert.equal(b.estado, "pendiente", "A: no se completa"); assert.deepEqual(b.cxp.map((x) => x.id), a.cxp.map((x) => x.id), "A: no se escribió ni se borró ninguna CxP"); assert.equal(b.md5cxp, a.md5cxp);
    assert.match(b.error, /texto anterior del carrito/); assert.match(b.error, /No se escribió nada/); assert.equal(b.asientos.length, a.asientos.length); assert.equal(b.huerfanos.length, 0);
    assert.deepEqual(c.cxp.map((x) => x.id), b.cxp.map((x) => x.id), "el segundo cron no cambia nada"); assert.equal(c.md5cxp, a.md5cxp);
  });
  test("T-B contrato con traslados por alcance (clave y línea) + tour + legado con el texto anterior", async () => {
    const n = await contratoConTextoAnterior([tour(S_TR, 2, { alcance: "llegada", horas: H_DIA }), tour(S_TR, 2, { alcance: "ida_regreso", horas: H_DIA }), tour(S_TOUR, 2), tour(S_LEG, 2)], [2, 2, 2, 2]);
    const { a, b, c } = await correr(n, "B");
    assert.equal(b.estado, "pendiente", "B: no se completa"); assert.deepEqual(b.cxp.map((x) => x.id), a.cxp.map((x) => x.id), "B: ninguna CxP se escribe ni se borra"); assert.equal(b.md5cxp, a.md5cxp); assert.equal(b.md5lin, a.md5lin);
    assert.deepEqual(c.cxp.map((x) => x.id), b.cxp.map((x) => x.id));
  });
  test("T-C variante de A con un PAGO en una CxP", async () => {
    const n = await contratoConTextoAnterior([tour(S_TOUR, 2), tour(S_LEG, 2)], [2, 2]);
    const f = snap(n).cxp[0]; sql(`insert into public.cxp_pagos (cuenta_por_pagar_id, valor, tenant) values (${f.id}, 1000, 'mayorista')`);
    const { a, b, c } = await correr(n, "C");
    console.log(`      C → CxP antes ${a.cxp.length}, después ${b.cxp.length}; estado ${b.estado}`);
    assert.equal(b.estado, "pendiente"); assert.equal(b.md5cxp, a.md5cxp); assert.match(b.error, /texto anterior del carrito/);
    assert.equal(sql(`select count(*) from public.cxp_pagos where cuenta_por_pagar_id = ${f.id}`), "1", "el pago sigue");
    assert.deepEqual(c.cxp.map((x) => x.id), b.cxp.map((x) => x.id), "el segundo cron no cambia nada");
  });
});
