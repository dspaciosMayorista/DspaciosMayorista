// 270 (#120) — recorrido REAL de un hotel «bajo solicitud» contra PostgreSQL + PostgREST locales (sin simular dinero ni catálogo):
//   crearSolicitudHotel (sin importes) → no se convierte pendiente → asignarNetaSolicitud (markup del paquete + inclusiones + vuelo) → convertirCotizacion → ventas / items / CxP / sillas / vuelos.
// Lo ÚNICO simulado (igual que alcance262.pg.ts): la sesión (el cliente de sesión es PostgREST real con JWT `authenticated`), la numeración (RPC real) y efectos laterales ajenos.
// SOLO base LOCAL desechable. Lo lanza supabase/scripts/test_270_e2e.sh.
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG270_CONTENEDOR ?? "";
const DB = process.env.PG270_BASE ?? "";
const PGRST = process.env.PG270_POSTGREST ?? "";
const SECRETO = process.env.PG270_JWT_SECRET ?? "";
if (!CT || !DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG270_*: usa supabase/scripts/test_270_e2e.sh.");

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
const UID_SUPER = "00000000-0000-0000-0000-000000270001";
const UID_VENTA = "00000000-0000-0000-0000-000000270002";
let uidSesion: string | null = UID_SUPER; // null = visitante anónimo (tarifario público)
const sidDe = (uid: string) => uid.replace(/^00000000/, "5e550000");
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-270";
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
function sqlError(q: string): string { try { sql(q); return ""; } catch (e) { return String((e as { stderr?: unknown }).stderr ?? e); } }
const lit = (v: unknown) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/cotizacion/acceso", { namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, interno: true, tenant: "mayorista" }), autorizaTenant: () => true } });
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

const { crearSolicitudHotel, validarOcupacionSolicitud } = await import("../app/tarifario/solicitudHotelActions.ts");
const { asignarNetaSolicitud, convertirCotizacion, crearCotizacion } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { setHotelBajoSolicitud } = await import("../app/(dashboard)/dashboard/producto/hoteles/actions.ts");
const { cargarHotelesBajoSolicitud } = await import("../lib/tarifario/datosSolicitud.ts");
const { contieneImportes, MENSAJE_HOTEL_SOLO_SOLICITUD } = await import("../lib/reservar/solicitudHotel.ts");

// ── Semilla ───────────────────────────────────────────────────────────────
// Markup del paquete 20 %: PVP = ceil_mil(neto / 0.8). Neta del hotel (TOTAL de la estadía): 1.200.000 con 1 habitación doble (2 personas) → 600.000 por persona → 750.000 con markup.
// Asistencia médica INCLUIDA (20.000 neto por persona → 25.000 con markup). Vuelo por persona:
//   bloqueo P1 (hotel ÚNICO H1): tarifa 400.000 con markup → 500.000 (aplica_mk) ... ver PVP_ESPERADO
//   empaquetado P2: tarifa 300.000 + TA 20.000 (sin markup) = 320.000
//   porción terrestre P3 (H3 a solicitud + H3b tarifado, neto 300.000/noche/persona × 3 noches): sin vuelo.
const D = 7001, PROV = 7001, S_ASIS = 7001;
const P1 = 7101, P2 = 7102, P3 = 7103, H1 = 7201, H2 = 7202, H3 = 7203, H3B = 7204, H4 = 7205, B1 = 7301, E1 = 7401;
const P6 = 7106, H5 = 7206, B2 = 7302, S_USD = 7002; // cierre #120: bloqueo en USD (hotel USD, vuelo USD, asistencia USD) para el ajuste positivo en dólares
const P7 = 7107, H6 = 7207; // cierre #120: porción terrestre en USD con un hotel TARIFADO de siempre (mismo camino de conversión que el de solicitud)
const NETA = 1_200_000;
// por persona: hotel 750.000 + asistencia 25.000 + vuelo → ceil al millar; 2 personas
const PVP_ESPERADO = { bloqueo: (750_000 + 25_000 + 500_000) * 2, empaquetado: (750_000 + 25_000 + 320_000) * 2, porcion: (750_000 + 25_000) * 2 };
const PVP_TARIFADO_H3B = (Math.ceil((300_000 * 3 * 10) / 8 / 1000) * 1000 + 25_000) * 2; // hotel tarifado de siempre en el mismo paquete

before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_SUPER}', 'super270@x.test'), ('${UID_VENTA}', 'venta270@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_SUPER}', 'super270@x.test', 'Super 270', 'superadmin', true, 'mayorista'), ('${UID_VENTA}', 'venta270@x.test', 'Venta 270', 'venta', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into auth.sessions (id, user_id) select ('5e550000' || substr(id::text, 9))::uuid, id from public.usuarios where id in ('${UID_SUPER}', '${UID_VENTA}') on conflict do nothing;
    insert into public.sesion_agencia (session_id, user_id, tenant) select ('5e550000' || substr(id::text, 9))::uuid, id, 'mayorista' from public.usuarios where id = '${UID_SUPER}' on conflict do nothing;
    insert into public.destinos (id, nombre) values (${D}, 'CARTAGENA 270') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (${PROV}, 'Proveedor 270') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) overriding system value values
      (${H1}, ${D}, 'Hotel Bloqueo 270', ${PROV}, 'COP'), (${H2}, ${D}, 'Hotel Empaquetado 270', ${PROV}, 'COP'), (${H3}, ${D}, 'Hotel Porcion 270', ${PROV}, 'COP'), (${H3B}, ${D}, 'Hotel Tarifado 270', ${PROV}, 'COP'), (${H4}, ${D}, 'Hotel Sin Acomodaciones 270', ${PROV}, 'COP');
    insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, vuelo_ida, vuelo_regreso, fecha_ida, fecha_regreso, cupos_total, tarifa_para_empaquetar, tarifa_neta, fee_infante, destino_id, moneda) overriding system value
      values (${B1}, 'R270A', 'AVIANCA', 'BOG-CTG', 'AV123', 'AV124', '2030-03-10', '2030-03-13', 80, 400000, 400000, 50000, ${D}, 'COP');
    insert into public.sillas (bloqueo_id, numero_silla) select ${B1}, g from generate_series(1, 80) g;
    insert into public.empaquetados (id, ruta, aerolinea, fecha_ida, fecha_regreso, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, destino_id, activo, moneda) overriding system value
      values (${E1}, 'BOG-CTG', 'AVIANCA', '2030-04-10', '2030-04-13', 280000, 300000, 0, ${D}, true, 'COP');
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo) overriding system value values
      (${P1}, 'Bloqueo 270', 'bloqueo', 3, ${D}, 0.2, 'tiquete', 0, '2030-03-01', '2030-03-31', 'COP', 'COP', true),
      (${P2}, 'Empaquetado 270', 'bloqueo', 3, ${D}, 0.2, 'tiquete', 0, '2030-04-01', '2030-04-30', 'COP', 'COP', true),
      (${P3}, 'Porcion terrestre 270', 'porcion_terrestre', 3, ${D}, 0.2, 'fijo', 0, '2030-05-01', '2030-05-31', 'COP', 'COP', true);
    insert into public.armado_vuelos (paquete_id, bloqueo_id, aplica_mk, ta) values (${P1}, ${B1}, true, 0);
    insert into public.armado_empaquetados (paquete_id, empaquetado_id, aplica_mk, ta) values (${P2}, ${E1}, false, 20000);
    insert into public.armado_hoteles (paquete_id, hotel_id) values (${P1}, ${H1}), (${P2}, ${H2}), (${P3}, ${H3}), (${P3}, ${H3B}), (${P3}, ${H4});
    insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion) values
      (${S_ASIS}, 'Asistencia médica 270', ${PROV}, ${D}, 0, 'asistencia', 'COP', 'persona', 'paquete');
    insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (770001, ${S_ASIS}, 'ALTA', '2030-01-01', '2030-12-31', 20000);
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (${P1}, ${S_ASIS}, 'persona', true), (${P2}, ${S_ASIS}, 'persona', true), (${P3}, ${S_ASIS}, 'persona', true);
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, tipo, prioridad) values (${H3B}, 'ALTA', '2030-05-01', '2030-05-31', 'tarifa', 1);
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante)
      values (${H3B}, 'Estandar', 'PC', 'ALTA', 300000, 300000, 300000, 300000, 150000, 150000, 0);
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (${H1}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (${H2}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (${H3}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
    -- Cierre #120: bloqueo en USD con hotel USD (a solicitud solo dentro de su prueba), vuelo USD y asistencia INCLUIDA en USD.
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) overriding system value values (${H5}, ${D}, 'Hotel USD 270', ${PROV}, 'USD');
    insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, vuelo_ida, vuelo_regreso, fecha_ida, fecha_regreso, cupos_total, tarifa_para_empaquetar, tarifa_neta, fee_infante, destino_id, moneda) overriding system value
      values (${B2}, 'R270U', 'AVIANCA', 'BOG-CTG', 'AV223', 'AV224', '2030-07-10', '2030-07-13', 10, 400, 400, 50, ${D}, 'USD');
    insert into public.sillas (bloqueo_id, numero_silla) select ${B2}, g from generate_series(1, 10) g;
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo) overriding system value values
      (${P6}, 'Bloqueo USD 270', 'bloqueo', 3, ${D}, 0.2, 'tiquete', 0, '2030-07-01', '2030-07-31', 'USD', 'USD', true);
    insert into public.armado_vuelos (paquete_id, bloqueo_id, aplica_mk, ta) values (${P6}, ${B2}, true, 0);
    insert into public.armado_hoteles (paquete_id, hotel_id) values (${P6}, ${H5});
    insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion) values
      (${S_USD}, 'Asistencia USD 270', ${PROV}, ${D}, 0, 'asistencia', 'USD', 'persona', 'paquete');
    insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (770002, ${S_USD}, 'ALTA', '2030-01-01', '2030-12-31', 20);
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (${P6}, ${S_USD}, 'persona', true);
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (${H5}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
    -- Cierre #120: hotel TARIFADO en USD (porción terrestre USD) con asistencia incluida en USD: mismo camino de conversión por persona.
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) overriding system value values (${H6}, ${D}, 'Hotel USD Tarifado 270', ${PROV}, 'USD');
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo) overriding system value values
      (${P7}, 'Porcion USD 270', 'porcion_terrestre', 3, ${D}, 0.2, 'fijo', 0, '2030-08-01', '2030-08-31', 'USD', 'USD', true);
    insert into public.armado_hoteles (paquete_id, hotel_id) values (${P7}, ${H6});
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (${P7}, ${S_USD}, 'persona', true);
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, tipo, prioridad) values (${H6}, 'ALTA', '2030-08-01', '2030-08-31', 'tarifa', 1);
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante)
      values (${H6}, 'Estandar', 'PC', 'ALTA', 100, 100, 100, 100, 50, 50, 0);
    -- Solo AHORA se marcan los tres hoteles sin tarifa (la base impide marcar uno con tarifas).
    update public.hoteles set tarifa_bajo_solicitud = true where id in (${H1}, ${H2}, ${H3}, ${H4});
  `);
});

// ── utilidades ────────────────────────────────────────────────────────────
const PAX = Array.from({ length: 4 }, (_, i) => ({ nombres: `Pax${i + 1}`, apellidos: "Prueba", tipoDoc: "CC", numeroDoc: `${2000 + i}`, fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false }));
const CLIENTE = { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };
type R = { ok: boolean; error?: string; id?: number; numero?: string; codigo?: string; url?: string; waUrl?: string | null; repetida?: boolean };
const num = (q: string) => Number(sql(q));
const foto = () => ({ ventas: sql("select count(*) from public.ventas"), cxp: sql("select count(*) from public.cuentas_por_pagar"), items: sql("select count(*) from public.contrato_items"), pas: sql("select count(*) from public.contrato_pasajeros"), sillas: sql("select count(*) from public.sillas where numero_contrato is not null") });
const entrada = (paqueteId: number, hotelId: number, extra: Record<string, unknown>) => ({ paqueteId, hotelId, habitaciones: { doble: 1 }, categoria: "Estandar", regimen: "PC", cliente: CLIENTE, ...extra });
async function solicitud(raw: Record<string, unknown>): Promise<R & { id: number }> {
  uidSesion = null; // visitante anónimo del tarifario público
  const r = await crearSolicitudHotel(raw) as R;
  uidSesion = UID_SUPER;
  assert.equal(r.ok, true, r.error);
  const id = num(`select id from public.cotizaciones where codigo = ${lit(r.codigo)}`);
  return { ...r, id };
}

// Un flujo completo por tipo de paquete.
async function flujo(que: string, raw: Record<string, unknown>, esperado: number, o: { vuelo: boolean; sillas: boolean; hotelId: number }) {
  // 1) La solicitud nace SIN importes y sin tocar ventas/CxP/contrato/sillas.
  const antes = foto();
  const s = await solicitud(raw);
  assert.deepEqual(foto(), antes, `${que}: la solicitud no crea contrato, venta, CxP, pasajeros ni sillas`);
  const fila = JSON.parse(sql(`select json_build_object('estado', estado, 'precio', precio_venta, 'numero', numero_contrato, 'payload', payload, 'detalle', detalle, 'tipo', tipo, 'paquete', paquete_armado_id) from public.cotizaciones where id = ${s.id}`)) as Record<string, unknown>;
  assert.equal(fila.estado, "pendiente_tarifa"); assert.equal(Number(fila.precio), 0); assert.equal(fila.numero, null); assert.equal(fila.tipo, "tarifario");
  assert.equal(contieneImportes(fila.payload), false, `${que}: el payload no lleva importes`);
  assert.equal(contieneImportes(fila.detalle), false, `${que}: el detalle no lleva importes`);
  assert.equal(num(`select count(*) from public.crm_contactos where documento = '123'`) >= 1, true, `${que}: el cliente entró al CRM al crear la solicitud (aún sin precio)`);
  assert.equal(num(`select count(*) from public.cotizacion_tarifa_solicitud where cotizacion_id = ${s.id}`), 0);
  // reintento / doble clic = la misma cotización
  uidSesion = null; const otra = await crearSolicitudHotel(raw) as R; uidSesion = UID_SUPER;
  assert.equal(otra.ok && otra.codigo === s.codigo && otra.repetida === true, true, `${que}: la misma solicitud no duplica`);
  assert.equal(num(`select count(*) from public.cotizaciones where estado = 'pendiente_tarifa' and paquete_armado_id = ${fila.paquete}`) >= 1, true);

  // 2) Una solicitud pendiente NO se convierte (código y base).
  const conv0 = await convertirCotizacion(s.id, PAX.slice(0, 2) as never, false, "Asesor 270", null, "COP", null) as R;
  assert.equal(conv0.ok, false); assert.match(conv0.error ?? "", /espera la tarifa del hotel/);
  assert.deepEqual(foto(), antes, `${que}: convertir una pendiente no escribe nada`);
  assert.match(sqlError(`update public.cotizaciones set estado = 'convertida' where id = ${s.id}`), /COTIZACION_PENDIENTE_TARIFA/);
  assert.match(sqlError(`update public.cotizaciones set estado = 'abierta', precio_venta = 1000 where id = ${s.id}`), /COTIZACION_PENDIENTE_TARIFA/);
  // el cómputo directo de un hotel a solicitud, sin neta, tampoco da precio
  const c0 = await crearCotizacion({ paqueteId: Number(fila.paquete), bloqueoId: raw.bloqueoId ?? null, empaquetadoId: raw.empaquetadoId ?? null, modulo: (fila.payload as { modulo: string }).modulo, hotelId: o.hotelId, fechaIda: (fila.payload as { fechaIda: string }).fechaIda, fechaRegreso: (fila.payload as { fechaRegreso: string }).fechaRegreso, categoria: "Estandar", regimen: "PC", habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, cliente: CLIENTE, tipoAsesor: "interno", asesorInterno: "Asesor 270", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: [] } as never) as R;
  assert.equal(c0.ok, false); assert.equal(c0.error, MENSAJE_HOTEL_SOLO_SOLICITUD);

  // 3) Un usuario sin rol de producto NO carga la neta.
  uidSesion = UID_VENTA; const sinPermiso = await asignarNetaSolicitud(s.id, NETA) as R; uidSesion = UID_SUPER;
  assert.equal(sinPermiso.ok, false); assert.match(sinPermiso.error ?? "", /No tienes permiso/);
  // neta inválida
  for (const mala of [0, -5, "abc", ""]) { const r = await asignarNetaSolicitud(s.id, mala) as R; assert.equal(r.ok, false, String(mala)); }

  // 4) La neta TOTAL → markup del paquete + inclusiones + vuelo → precio completo congelado.
  const v = await asignarNetaSolicitud(s.id, NETA) as R;
  assert.equal(v.ok, true, v.error);
  const congelado = JSON.parse(sql(`select json_build_object('estado', c.estado, 'precio', c.precio_venta, 'neta', t.neta, 'tprecio', t.precio_venta, 'pct', t.pct_mk, 'vig', c.vigencia_hasta, 'payload', c.payload::text, 'detalle', c.detalle::text, 'items', c.detalle->'items', 'venta', c.detalle->'venta')
    from public.cotizaciones c join public.cotizacion_tarifa_solicitud t on t.cotizacion_id = c.id where c.id = ${s.id}`)) as Record<string, any>;
  assert.equal(congelado.estado, "abierta");
  assert.equal(Number(congelado.precio), esperado, `${que}: precio completo (hotel con markup + asistencia incluida${o.vuelo ? " + vuelo" : ""})`);
  assert.equal(Number(congelado.tprecio), esperado); assert.equal(Number(congelado.neta), NETA); assert.equal(Number(congelado.pct), 0.2);
  assert.ok(congelado.vig, "la cotización valorada queda con vigencia");
  assert.equal(String(congelado.payload).includes(String(NETA)), false, `${que}: la neta NO viaja en el payload`);
  assert.equal(String(congelado.detalle).includes(String(NETA)), false, `${que}: la neta NO viaja en el detalle`);
  const sumaItems = (congelado.items as { adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number }[]).reduce((a, i) => a + i.adultos * i.tarifa_adulto + i.ninos * i.tarifa_nino, 0);
  assert.equal(sumaItems, esperado, `${que}: los ítems del documento suman el total completo`);
  assert.ok(congelado.venta.asistencia_medica, `${que}: la asistencia INCLUIDA del paquete aparece en la cotización`);
  assert.equal(num(`select count(*) from public.cotizacion_tarifa_solicitud where cotizacion_id = ${s.id}`), 1);
  assert.equal(num(`select count(*) from public.cotizacion_participantes where cotizacion_id = ${s.id} and activo`) >= 1, true, `${que}: el titular queda en el registro de personas al valorar la solicitud`);
  assert.equal(num(`select count(*) from public.crm_contactos where documento = '123' and origen like '%tarifario%'`) >= 1 || num(`select count(*) from public.crm_contactos where documento = '123'`) >= 1, true, `${que}: el cliente entró al CRM al crear la solicitud`);

  // 5) Idempotencia: misma neta = nada nuevo; otra neta = rechazo; el precio no se mueve.
  const igual = await asignarNetaSolicitud(s.id, NETA) as R; assert.equal(igual.ok, true);
  const otraNeta = await asignarNetaSolicitud(s.id, NETA + 1) as R; assert.equal(otraNeta.ok, false); assert.match(otraNeta.error ?? "", /otra neta/);
  assert.equal(num(`select precio_venta from public.cotizaciones where id = ${s.id}`), esperado);
  assert.equal(num(`select count(*) from public.cotizacion_tarifa_solicitud where cotizacion_id = ${s.id}`), 1);
  // no se puede desmarcar el hotel mientras la cotización valorada siga abierta
  const des = await setHotelBajoSolicitud(o.hotelId, false) as R; assert.equal(des.ok, false); assert.match(des.error ?? "", /solicitudes pendientes de tarifa o cotizaciones valoradas/);

  // 6) Conversión: total convertido == total congelado; neta = costo del hotel; CxP; vuelo y sillas cuando aplica.
  const conv = await convertirCotizacion(s.id, PAX.slice(0, 2) as never, false, "Asesor 270", null, "COP", null) as R;
  assert.equal(conv.ok, true, conv.error);
  const n = conv.numero!;
  const venta = JSON.parse(sql(`select json_build_object('precio', precio_venta, 'costo_hotel', costo_hotel, 'estado', estado, 'pax', pax) from public.ventas where numero_contrato = ${lit(n)}`)) as Record<string, number | string>;
  assert.equal(Number(venta.precio), esperado, `${que}: total convertido == total congelado`);
  assert.equal(Number(venta.costo_hotel), NETA, `${que}: el costo del hotel del contrato es la neta TOTAL cargada`);
  assert.equal(num(`select coalesce(sum(adultos * tarifa_adulto + ninos * tarifa_nino), 0) from public.contrato_items where numero_contrato = ${lit(n)}`), esperado, `${que}: los ítems del contrato suman el total`);
  assert.equal(num(`select count(*) from public.contrato_pasajeros where numero_contrato = ${lit(n)}`), 2);
  assert.equal(num(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and tipo_proveedor = 'hotel'`), NETA, `${que}: CxP del hotel = neta`);
  assert.equal(num(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and tipo_proveedor = 'hotel'`), 1, `${que}: una sola CxP de hotel`);
  assert.equal(num(`select count(*) from public.contrato_vuelos where numero_contrato = ${lit(n)}`) > 0, o.vuelo, `${que}: vuelo del contrato`);
  assert.equal(num(`select count(*) from public.sillas where numero_contrato = ${lit(n)}`), o.sillas ? 2 : 0, `${que}: sillas del bloqueo`);
  assert.equal(sql(`select estado || '|' || numero_contrato from public.cotizaciones where id = ${s.id}`), `convertida|${n}`);
  const cxpAntes = sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`);
  // 7) Reintento de la conversión: mismo contrato, sin duplicados.
  const otraVez = await convertirCotizacion(s.id, PAX.slice(0, 2) as never, false, "Asesor 270", null, "COP", null) as R;
  assert.equal(otraVez.ok && otraVez.numero === n, true, `${que}: el reintento devuelve el mismo contrato`);
  assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`), cxpAntes);
  assert.equal(sql("select count(*) from public.ventas"), String(Number(antes.ventas) + 1));
  return { id: s.id, numero: n };
}

describe("hotel bajo solicitud — de la solicitud al contrato (Postgres + PostgREST reales)", () => {
  test("BLOQUEO con el hotel como ÚNICO seleccionado: la tarjeta y el paquete aparecen a solicitud; flujo completo con vuelo y sillas", async () => {
    // el paquete solo tiene este hotel y no tiene filas de precio publicadas: aun así aparece
    const lista = await cargarHotelesBajoSolicitud();
    assert.equal(lista.ok, true);
    const h1 = lista.ok ? lista.hoteles.filter((h) => h.paqueteId === P1) : [];
    assert.equal(h1.length, 1, "el único hotel del paquete de bloqueo se descubre aunque no haya tarifario_resultado");
    assert.equal(num(`select count(*) from public.tarifario_resultado where paquete_id = ${P1}`), 0);
    assert.equal(h1[0].salidas.length, 1); assert.equal(h1[0].tipo, "bloqueo");
    await flujo("bloqueo", entrada(P1, H1, { bloqueoId: B1, fechaIda: "2030-03-10", fechaRegreso: "2030-03-13" }), PVP_ESPERADO.bloqueo, { vuelo: true, sillas: true, hotelId: H1 });
  });

  test("EMPAQUETADO (vuelo por Sistema, aplica TA sin markup): flujo completo", async () => {
    await flujo("empaquetado", entrada(P2, H2, { empaquetadoId: E1, fechaIda: "2030-04-10", fechaRegreso: "2030-04-13" }), PVP_ESPERADO.empaquetado, { vuelo: true, sillas: false, hotelId: H2 });
  });

  test("PORCIÓN TERRESTRE con un hotel tarifado de siempre en el MISMO paquete: el tarifado se vende normal e independiente; el de solicitud, por su camino", async () => {
    // el hotel tarifado (H3B) cotiza con su tarifa real, sin neta
    const normal = await crearCotizacion({ paqueteId: P3, bloqueoId: null, modulo: "porcion_terrestre", hotelId: H3B, fechaIda: "2030-05-10", fechaRegreso: "2030-05-13", categoria: "Estandar", regimen: "PC", habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, cliente: CLIENTE, tipoAsesor: "interno", asesorInterno: "Asesor 270", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: [] } as never) as R;
    assert.equal(normal.ok, true, normal.error);
    assert.equal(num(`select precio_venta from public.cotizaciones where id = ${normal.id}`), PVP_TARIFADO_H3B, "el hotel tarifado conserva su precio de siempre");
    assert.equal(sql(`select estado from public.cotizaciones where id = ${normal.id}`), "abierta");
    // REGRESIÓN: un `adultosReales` colado desde el navegador en un hotel TARIFADO se ignora por completo (mismo precio de siempre): la ocupación real solo existe en hoteles a solicitud
    const colado = await crearCotizacion({ paqueteId: P3, bloqueoId: null, modulo: "porcion_terrestre", hotelId: H3B, fechaIda: "2030-05-10", fechaRegreso: "2030-05-13", categoria: "Estandar", regimen: "PC", habitaciones: { doble: 1 }, adultosReales: 1, ninos: 0, ninos2: 0, infantes: 0, cliente: { ...CLIENTE, numeroDoc: "949" }, tipoAsesor: "interno", asesorInterno: "Asesor 270", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: [] } as never) as R;
    assert.equal(colado.ok, true, colado.error);
    assert.equal(num(`select precio_venta from public.cotizaciones where id = ${colado.id}`), PVP_TARIFADO_H3B, "el hotel tarifado ignora adultosReales: 2 plazas de adulto como siempre");
    // y el hotel tarifado jamás acepta una neta
    const neta = await asignarNetaSolicitud(normal.id!, NETA) as R; assert.equal(neta.ok, false);
    await flujo("porción terrestre", entrada(P3, H3, { fechaIda: "2030-05-10", fechaRegreso: "2030-05-13" }), PVP_ESPERADO.porcion, { vuelo: false, sillas: false, hotelId: H3 });
  });

  // ── Regla de reparto CONFIRMADA: adultos / distribuir con niños e infantes ────────────────────────────────────────────────────────────
  // Viajeros: 1 doble = 2 adultos + 1 niño de 7 años + 1 infante de 1 año. Neta TOTAL 1.200.000. Markup 20 %; asistencia incluida 25.000 por persona.
  const PAX4 = (ida: string) => [
    ...PAX.slice(0, 2),
    { nombres: "Nina", apellidos: "Prueba", tipoDoc: "TI", numeroDoc: `3001${ida.slice(-2)}`, fechaNacimiento: "2023-01-01", nacionalidad: "Colombiana", esInfante: false },
    { nombres: "Bebe", apellidos: "Prueba", tipoDoc: "RC", numeroDoc: `3002${ida.slice(-2)}`, fechaNacimiento: "2029-08-01", nacionalidad: "Colombiana", esInfante: true, responsableIndex: 0 },
  ];
  const privada = (id: number) => JSON.parse(sql(`select json_build_object('modo', modo, 'adultos', adultos, 'ninos', ninos, 'infantes', infantes, 'na', neta_adulto, 'nn', neta_nino, 'ni', neta_infante, 'neta', neta, 'precio', precio_venta) from public.cotizacion_tarifa_solicitud where cotizacion_id = ${id}`)) as Record<string, number | string>;
  const lineas = (n: string) => JSON.parse(sql(`select json_build_object(
      'adulto', (select max(tarifa_adulto) from public.contrato_items where numero_contrato = ${lit(n)} and adultos > 0 and ninos = 0 and descripcion like '%hab%'),
      'nino', (select max(tarifa_nino) from public.contrato_items where numero_contrato = ${lit(n)} and descripcion like 'Niño 1%'),
      'infante', (select max(tarifa_nino) from public.contrato_items where numero_contrato = ${lit(n)} and descripcion like 'Infante%'))`)) as { adulto: number; nino: number; infante: number };

  async function conNinos(que: string, raw: Record<string, unknown>, entrada: unknown, e: { total: number; adulto: number; nino: number; infante: number; costoAereo: number; sillas: number; vuelo: boolean; modo: "adultos" | "distribuir"; na: number; nn: number }) {
    const s = await solicitud({ ...raw, edadesMenores: [7, 1] });
    const rn = await asignarNetaSolicitud(s.id, entrada) as R;
    assert.equal(rn.ok, true, rn.error);
    // Elección CONGELADA y PRIVADA (ni en payload ni en detalle públicos)
    const p = privada(s.id);
    assert.deepEqual([p.modo, Number(p.adultos), Number(p.ninos), Number(p.infantes), Number(p.neta), Number(p.ni)], [e.modo, 2, 1, 1, NETA, 0], `${que}: elección congelada`);
    assert.ok(Math.abs(Number(p.na) - e.na) < 0.01 && Math.abs(Number(p.nn) - e.nn) < 0.01, `${que}: netas por tipo congeladas (${p.na}/${p.nn})`);
    const pub = sql(`select payload::text || detalle::text from public.cotizaciones where id = ${s.id}`);
    assert.equal(/netaAdulto|netaNino|distribuir|neta_adulto|neta_nino/.test(pub), false, `${que}: la elección no viaja en payload/detalle`);
    assert.equal(num(`select precio_venta from public.cotizaciones where id = ${s.id}`), e.total, `${que}: total congelado`);
    // el documento valorado muestra cada tipo con su PVP del motor
    const items = JSON.parse(sql(`select (detalle->'items')::text from public.cotizaciones where id = ${s.id}`)) as { descripcion: string; adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number }[];
    assert.equal(items.reduce((a, i) => a + i.adultos * i.tarifa_adulto + i.ninos * i.tarifa_nino, 0), e.total, `${que}: los ítems del documento suman el total`);
    // reintento: MISMA elección = no-op; OTRA distribución u otra neta = rechazo (y nada cambia)
    assert.equal((await asignarNetaSolicitud(s.id, entrada) as R).ok, true, `${que}: la misma elección es un no-op`);
    const otra = typeof entrada === "object" && (entrada as { modo?: string }).modo === "distribuir"
      ? { netaTotal: NETA, modo: "distribuir", netaAdulto: 500_000, netaNino: 200_000 }
      : { netaTotal: NETA, modo: "distribuir", netaAdulto: 450_000, netaNino: 300_000 };
    const rr = await asignarNetaSolicitud(s.id, otra) as R;
    assert.equal(rr.ok, false); assert.match(rr.error ?? "", /otra neta u otra distribución/, `${que}: reintento con otra distribución`);
    assert.equal(await asignarNetaSolicitud(s.id, NETA + 1).then((r) => (r as R).ok), false, `${que}: reintento con otra neta`);
    assert.deepEqual(privada(s.id), p, `${que}: la elección congelada no cambió`);
    assert.equal(num(`select count(*) from public.cotizacion_tarifa_solicitud where cotizacion_id = ${s.id}`), 1);

    // conversión: total convertido == total congelado; neta EXACTA en costo y CxP; vuelo, sillas y CxP aérea
    const ida = String((JSON.parse(sql(`select payload::text from public.cotizaciones where id = ${s.id}`)) as { fechaIda: string }).fechaIda);
    const conv = await convertirCotizacion(s.id, PAX4(ida) as never, false, "Asesor 270", null, "COP", null) as R;
    assert.equal(conv.ok, true, conv.error);
    const n = conv.numero!;
    assert.equal(num(`select precio_venta from public.ventas where numero_contrato = ${lit(n)}`), e.total, `${que}: total convertido == total congelado`);
    assert.equal(num(`select costo_hotel from public.ventas where numero_contrato = ${lit(n)}`), NETA, `${que}: costo del hotel = neta TOTAL exacta`);
    assert.equal(num(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and tipo_proveedor = 'hotel'`), NETA, `${que}: CxP del hotel = neta TOTAL exacta`);
    assert.equal(num(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and tipo_proveedor = 'hotel'`), 1);
    const l = lineas(n);
    assert.deepEqual([Number(l.adulto), Number(l.nino), Number(l.infante)], [e.adulto, e.nino, e.infante], `${que}: PVP por tipo en el contrato (adulto / niño / infante)`);
    assert.equal(num(`select coalesce(sum(adultos * tarifa_adulto + ninos * tarifa_nino), 0) from public.contrato_items where numero_contrato = ${lit(n)}`), e.total, `${que}: ítems del contrato = total`);
    const cxp = sql(`select coalesce(string_agg(tipo_proveedor || '=' || valor_total::bigint, ' ; ' order by id), '') from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`);
    console.log(`  [${que}] CxP: ${cxp}`);
    if (e.vuelo) {
      assert.equal(num(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and tipo_proveedor ilike 'a%reo'`), e.costoAereo, `${que}: CxP aérea`);
      assert.equal(num(`select costo_aereo from public.ventas where numero_contrato = ${lit(n)}`), e.costoAereo, `${que}: costo aéreo del contrato`);
      assert.equal(num(`select count(*) from public.contrato_vuelos where numero_contrato = ${lit(n)}`) > 0, true);
    }
    assert.equal(num(`select count(*) from public.sillas where numero_contrato = ${lit(n)}`), e.sillas, `${que}: sillas (el infante menor de 2 años no ocupa silla)`);
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`), String(cxp ? cxp.split(" ; ").length : 0), `${que}: sin CxP duplicadas`);
    const otraVez = await convertirCotizacion(s.id, PAX4(ida) as never, false, "Asesor 270", null, "COP", null) as R;
    assert.equal(otraVez.ok && otraVez.numero === n, true, `${que}: el reintento devuelve el mismo contrato`);
    return { id: s.id, numero: n };
  }

  test("BLOQUEO con niño e infante · opción «CARGAR HOTEL A LOS ADULTOS»: los adultos cargan todo el hotel; niño e infante solo servicios y vuelo", async () => {
    // adultos 2 × (750.000 + 25.000 + 500.000) + niño (25.000 + 500.000) + infante menor de 2 (25.000 + fee 50.000) = 3.150.000
    await conNinos("bloqueo/adultos", { ...entrada(P1, H1, { bloqueoId: B1, fechaIda: "2030-03-10", fechaRegreso: "2030-03-13" }), cliente: { ...CLIENTE, numeroDoc: "811" } }, { netaTotal: NETA, modo: "adultos" },
      { total: 3_150_000, adulto: 1_275_000, nino: 525_000, infante: 75_000, costoAereo: 3 * 400_000 + 50_000, sillas: 3, vuelo: true, modo: "adultos", na: 600_000, nn: 0 });
  });

  test("BLOQUEO con niño e infante · opción «DISTRIBUIR» (450.000 por adulto, 300.000 por niño, infante $0): importes por tipo con el motor", async () => {
    // adulto: 450.000/0,8 = 562.500 + 25.000 + 500.000 = 1.087.500 → 1.088.000 · niño: 300.000/0,8 = 375.000 + 25.000 + 500.000 = 900.000 · infante 75.000
    await conNinos("bloqueo/distribuir", { ...entrada(P1, H1, { bloqueoId: B1, fechaIda: "2030-03-10", fechaRegreso: "2030-03-13" }), cliente: { ...CLIENTE, numeroDoc: "812" } },
      { netaTotal: NETA, modo: "distribuir", netaAdulto: 450_000, netaNino: 300_000, netaInfante: 0 },
      // total = el de «adultos» (3.150.000): la suma por viajero (3.151.000) se corrige con la línea explícita «Ajuste de redondeo» de −1.000
      { total: 3_150_000, adulto: 1_088_000, nino: 900_000, infante: 75_000, costoAereo: 3 * 400_000 + 50_000, sillas: 3, vuelo: true, modo: "distribuir", na: 450_000, nn: 300_000 });
  });

  test("EMPAQUETADO con niño e infante · «DISTRIBUIR» (vuelo por Sistema: costo + TA): CxP aérea y totales", async () => {
    // vuelo 320.000 por persona (300.000 + TA 20.000); adulto 562.500 + 25.000 + 320.000 = 907.500 → 908.000 · niño 375.000 + 25.000 + 320.000 = 720.000 · infante (menor de 2): 25.000 + fee 0 = 25.000
    await conNinos("empaquetado/distribuir", { ...entrada(P2, H2, { empaquetadoId: E1, fechaIda: "2030-04-10", fechaRegreso: "2030-04-13" }), cliente: { ...CLIENTE, numeroDoc: "813" } },
      { netaTotal: NETA, modo: "distribuir", netaAdulto: 450_000, netaNino: 300_000 },
      // total = el de «adultos» (2.560.000); suma por viajero 2.561.000 → ajuste explícito de −1.000
      { total: 2_560_000, adulto: 908_000, nino: 720_000, infante: 25_000, costoAereo: 280_000 * 3, sillas: 0, vuelo: true, modo: "distribuir", na: 450_000, nn: 300_000 });
  });

  test("PORCIÓN TERRESTRE con niño e infante · «ADULTOS» y neta total con centavos EXACTA en costo y CxP (distribuir 333.333,33 / 333.333,33)", async () => {
    await conNinos("porción/adultos", { ...entrada(P3, H3, { fechaIda: "2030-05-14", fechaRegreso: "2030-05-17" }), cliente: { ...CLIENTE, numeroDoc: "814" } }, { netaTotal: NETA, modo: "adultos" },
      { total: 2 * 775_000 + 25_000 + 25_000, adulto: 775_000, nino: 25_000, infante: 25_000, costoAereo: 0, sillas: 0, vuelo: false, modo: "adultos", na: 600_000, nn: 0 });
    // neta 1.000.000 repartida 333.333,33 por adulto y por niño: suma 999.999,99 (un centavo de redondeo) → el costo del contrato y la CxP siguen siendo EXACTAMENTE 1.000.000
    const s = await solicitud({ ...entrada(P3, H3, { fechaIda: "2030-05-18", fechaRegreso: "2030-05-21" }), cliente: { ...CLIENTE, numeroDoc: "815" }, edadesMenores: [7, 1] });
    const rv = await asignarNetaSolicitud(s.id, { netaTotal: 1_000_000, modo: "distribuir", netaAdulto: 333_333.33, netaNino: 333_333.33 }) as R;
    assert.equal(rv.ok, true, rv.error);
    const conv = await convertirCotizacion(s.id, PAX4("18") as never, false, "Asesor 270", null, "COP", null) as R;
    assert.equal(conv.ok, true, conv.error);
    assert.equal(num(`select costo_hotel from public.ventas where numero_contrato = ${lit(conv.numero)}`), 1_000_000);
    assert.equal(num(`select valor_total from public.cuentas_por_pagar where numero_contrato = ${lit(conv.numero)} and tipo_proveedor = 'hotel'`), 1_000_000);
  });

  // ── Reglas confirmadas (cierre #120): (1) el MISMO total en «adultos» y en «distribuir»; (2) ocupación REAL (1 adulto + 1 niño en una doble = 2 viajeros) ──────────────────
  // El total de referencia es el de «Cargar hotel a los adultos» con la misma neta. «Distribuir» cambia importes por viajero, no el total vendido: el residuo de redondeo por persona va a UNA
  // línea explícita «Ajuste de redondeo del reparto del hotel» (puede ser ±); costo del hotel, CxP y neta quedan EXACTAS.
  const cielo = (x: number) => Math.ceil(Math.round(x * 100) / 100 / 1000) * 1000;
  const ESC = {
    bloqueo: { P: P1, H: H1, V: 500_000, feePvp: 50_000, costoAereo: (seats: number, I: number) => 400_000 * seats + 50_000 * I, sillas: true, vuelo: true, extra: { bloqueoId: B1, fechaIda: "2030-03-10", fechaRegreso: "2030-03-13" } },
    empaquetado: { P: P2, H: H2, V: 320_000, feePvp: 0, costoAereo: (seats: number, _i: number) => 280_000 * seats, sillas: false, vuelo: true, extra: { empaquetadoId: E1, fechaIda: "2030-04-10", fechaRegreso: "2030-04-13" } },
    "porción terrestre": { P: P3, H: H3, V: 0, feePvp: 0, costoAereo: (_s: number, _i: number) => 0, sillas: false, vuelo: false, extra: { fechaIda: "2030-05-10", fechaRegreso: "2030-05-13" } },
  };
  function esperado(A: number, I: number, e: (typeof ESC)[keyof typeof ESC], modo: "adultos" | "distribuir", na: number, nn: number) {
    const base = 25_000 + e.V;
    const pvpA = (neta: number) => cielo(neta * 1.25 + base);
    const pa = modo === "adultos" ? pvpA(NETA / A) : pvpA(na), pn = modo === "adultos" ? cielo(base) : pvpA(nn);
    const pi = 25_000 + e.feePvp;
    const suma = A * pa + pn + I * pi;
    const T = A * pvpA(NETA / A) + cielo(base) + I * pi; // total de referencia: «Cargar hotel a los adultos»
    return { pa, pn, pi, suma, T, ajuste: T - suma };
  }
  let docSeq = 900;
  async function viajeros(nombre: keyof typeof ESC, A: number, conInfante: boolean, modo: "adultos" | "distribuir") {
    const e = ESC[nombre]; const I = conInfante ? 1 : 0;
    const [na, nn] = A === 1 ? [701_000, 499_000] : [450_000, 300_000]; // suman la neta; con markup NO caen en múltiplos de mil
    const que = `${nombre}/${A} adulto(s)+niño${conInfante ? "+infante" : ""}/${modo}`;
    const doc = String(docSeq++);
    const x = esperado(A, I, e, modo, na, nn);
    const raw = { ...entrada(e.P, e.H, e.extra), cliente: { ...CLIENTE, numeroDoc: doc }, edadesMenores: conInfante ? [7, 1] : [7], ...(A === 1 ? { adultos: 1 } : {}) };
    const s = await solicitud(raw);
    const entradaNeta = modo === "adultos" ? { netaTotal: NETA, modo } : { netaTotal: NETA, modo, netaAdulto: na, netaNino: nn };
    const rn = await asignarNetaSolicitud(s.id, entradaNeta) as R;
    assert.equal(rn.ok, true, `${que}: ${rn.error}`);
    const p = privada(s.id);
    assert.deepEqual([p.modo, Number(p.adultos), Number(p.ninos), Number(p.infantes), Number(p.neta)], [modo, A, 1, I, NETA], `${que}: conteos REALES congelados`);
    // La ficha interna muestra «Pasajeros» y pide al convertir tantas filas de pasajero como `cotizaciones.pax`: debe ser el número de personas REALES (hallazgo del navegador).
    assert.equal(num(`select pax from public.cotizaciones where id = ${s.id}`), A + 1 + I, `${que}: cotizaciones.pax = personas REALES (alimenta «Pasajeros» y el formulario de pasajeros)`);
    const totalCongelado = num(`select precio_venta from public.cotizaciones where id = ${s.id}`);
    assert.equal(totalCongelado, x.T, `${que}: el total congelado es el de referencia («adultos»)`);
    const itemsCot = JSON.parse(sql(`select (detalle->'items')::text from public.cotizaciones where id = ${s.id}`)) as { descripcion: string; adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number }[];
    assert.equal(itemsCot.reduce((a, i) => a + i.adultos * i.tarifa_adulto + i.ninos * i.tarifa_nino, 0), x.T, `${que}: los ítems de la cotización suman el total`);
    const ajustes = itemsCot.filter((i) => /Ajuste de redondeo/.test(i.descripcion));
    assert.equal(ajustes.length, x.ajuste === 0 ? 0 : 1, `${que}: la línea explícita de ajuste aparece solo si hay residuo`);
    if (ajustes.length) assert.equal(ajustes[0].adultos * ajustes[0].tarifa_adulto, x.ajuste, `${que}: ajuste de redondeo = ${x.ajuste}`);
    assert.equal(itemsCot.filter((i) => /hab/.test(i.descripcion)).reduce((a, i) => a + i.adultos, 0), A, `${que}: la línea del hotel lleva los adultos REALES (sin pasajero ficticio)`);
    const pax = [...PAX.slice(0, A),
      { nombres: "Nina", apellidos: "Prueba", tipoDoc: "TI", numeroDoc: `3001${doc}`, fechaNacimiento: "2023-01-01", nacionalidad: "Colombiana", esInfante: false },
      ...(conInfante ? [{ nombres: "Bebe", apellidos: "Prueba", tipoDoc: "RC", numeroDoc: `3002${doc}`, fechaNacimiento: "2029-08-01", nacionalidad: "Colombiana", esInfante: true, responsableIndex: 0 }] : [])];
    const conv = await convertirCotizacion(s.id, pax as never, false, "Asesor 270", null, "COP", null) as R;
    assert.equal(conv.ok, true, `${que}: ${conv.error}`);
    const n = conv.numero!;
    assert.equal(num(`select precio_venta from public.ventas where numero_contrato = ${lit(n)}`), totalCongelado, `${que}: total convertido == total congelado`);
    assert.equal(num(`select costo_hotel from public.ventas where numero_contrato = ${lit(n)}`), NETA, `${que}: costo del hotel = neta TOTAL exacta`);
    assert.equal(num(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and tipo_proveedor = 'hotel'`), NETA, `${que}: CxP del hotel = neta TOTAL exacta`);
    assert.equal(num(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and tipo_proveedor = 'hotel'`), 1);
    assert.equal(num(`select coalesce(sum(adultos * tarifa_adulto + ninos * tarifa_nino), 0) from public.contrato_items where numero_contrato = ${lit(n)}`), totalCongelado, `${que}: ítems del contrato = total`);
    assert.equal(num(`select count(*) from public.contrato_items where numero_contrato = ${lit(n)} and descripcion like 'Ajuste de redondeo%'`), x.ajuste === 0 ? 0 : 1, `${que}: ajuste en el contrato`);
    const l = lineas(n);
    assert.equal(Number(l.adulto), x.pa, `${que}: PVP por adulto`);
    assert.equal(Number(l.nino), x.pn, `${que}: PVP por niño`);
    if (I) assert.equal(Number(l.infante), x.pi, `${que}: PVP por infante`);
    assert.equal(num(`select count(*) from public.contrato_pasajeros where numero_contrato = ${lit(n)}`), A + 1 + I, `${que}: pasajeros = personas REALES`);
    assert.equal(num(`select pax from public.ventas where numero_contrato = ${lit(n)}`), A + 1 + I, `${que}: pax del contrato = personas reales`);
    const seats = A + 1; // el niño de 7 años ocupa silla; el infante menor de 2 no
    assert.equal(num(`select count(*) from public.sillas where numero_contrato = ${lit(n)}`), e.sillas ? seats : 0, `${que}: sillas = personas reales con silla`);
    if (e.vuelo) {
      assert.equal(num(`select costo_aereo from public.ventas where numero_contrato = ${lit(n)}`), e.costoAereo(seats, I), `${que}: costo aéreo`);
      assert.equal(num(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and tipo_proveedor ilike 'a%reo'`), e.costoAereo(seats, I), `${que}: CxP aérea`);
    }
    const otraVez = await convertirCotizacion(s.id, pax as never, false, "Asesor 270", null, "COP", null) as R;
    assert.equal(otraVez.ok && otraVez.numero === n, true, `${que}: el reintento devuelve el mismo contrato`);
    return totalCongelado;
  }

  for (const nombre of Object.keys(ESC) as (keyof typeof ESC)[]) {
    for (const A of [2, 1]) {
      for (const conInfante of [false, true]) {
        test(`${nombre.toUpperCase()} · ${A} adulto(s) real(es) + 1 niño${conInfante ? " + 1 infante" : ""}: el MISMO total en «adultos» y en «distribuir»; neta/CxP exactas; pasajeros y sillas reales; conversión = congelado`, async () => {
          const ta = await viajeros(nombre, A, conInfante, "adultos");
          const td = await viajeros(nombre, A, conInfante, "distribuir");
          assert.equal(td, ta, `total en «distribuir» (${td}) == total en «adultos» (${ta})`);
        });
      }
    }
  }

  // ── Cierre #120 · AJUSTE POSITIVO real, en COP y en USD, hasta contrato y CxP, con REINTENTO de conversión ───────────────────────────────────────────────────────
  // Neta TOTAL 1.000.800 (USD 1.000,80), 2 adultos + 1 niño + 1 infante menor de 2 años, bloqueo con vuelo y asistencia incluida; markup 20 %.
  //   «adultos»: 500.400 por adulto → ×1,25 = 625.500 + asistencia 25.000 + vuelo 500.000 = 1.150.500 → 1.151.000 (se pierden 500 por adulto al redondear)
  //   «distribuir» 400.000 por adulto (→ 1.025.000 exacto) y 200.800 por niño (→ 776.000 exacto): sin pérdida de redondeo → suma por viajero 1.000 MENOR que el de referencia → ajuste POSITIVO de +1.000.
  async function ajustePositivo(que: string, c: { P: number; H: number; extra: Record<string, unknown>; neta: number; na: number; nn: number; moneda: "COP" | "USD"; docBase: number; esp: { T: number; S: number; ajuste: number; pa: number; pn: number; pi: number; costoAereo: number; asistencia: number } }) {
    const crear = async (modo: "adultos" | "distribuir") => {
      const doc = String(c.docBase + (modo === "adultos" ? 0 : 1));
      const s = await solicitud({ ...entrada(c.P, c.H, c.extra), cliente: { ...CLIENTE, numeroDoc: doc }, edadesMenores: [7, 1] });
      const entradaNeta = modo === "adultos" ? { netaTotal: c.neta, modo } : { netaTotal: c.neta, modo, netaAdulto: c.na, netaNino: c.nn };
      const rn = await asignarNetaSolicitud(s.id, entradaNeta) as R;
      assert.equal(rn.ok, true, `${que}/${modo}: ${rn.error}`);
      return { id: s.id, doc };
    };
    const ref = await crear("adultos"); const dist = await crear("distribuir");
    const precio = (id: number) => num(`select precio_venta from public.cotizaciones where id = ${id}`);
    const itemsDe = (id: number) => JSON.parse(sql(`select (detalle->'items')::text from public.cotizaciones where id = ${id}`)) as { descripcion: string; adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number }[];
    const suma = (its: { adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number }[]) => its.reduce((a, i) => a + i.adultos * i.tarifa_adulto + i.ninos * i.tarifa_nino, 0);
    assert.equal(precio(ref.id), c.esp.T, `${que}: total de REFERENCIA («adultos»)`);
    const itemsDist = itemsDe(dist.id);
    const lineaAjuste = itemsDist.filter((i) => /Ajuste de redondeo/.test(i.descripcion));
    const sinAjuste = itemsDist.filter((i) => !/Ajuste de redondeo/.test(i.descripcion));
    assert.equal(suma(sinAjuste), c.esp.S, `${que}: suma por viajero en «distribuir» (sin ajuste)`);
    assert.equal(lineaAjuste.length, 1, `${que}: UNA línea de ajuste`);
    assert.equal(lineaAjuste[0].adultos * lineaAjuste[0].tarifa_adulto, c.esp.ajuste, `${que}: ajuste POSITIVO`);
    assert.ok(c.esp.ajuste > 0);
    assert.equal(precio(dist.id), c.esp.T, `${que}: total congelado en «distribuir» == referencia`);
    assert.equal(suma(itemsDist), c.esp.T);
    assert.equal(sql(`select moneda from public.cotizaciones where id = ${dist.id}`), c.moneda, `${que}: moneda de la cotización`);
    const pax = [...PAX.slice(0, 2),
      { nombres: "Nina", apellidos: "Prueba", tipoDoc: "TI", numeroDoc: `3001${dist.doc}`, fechaNacimiento: "2023-01-01", nacionalidad: "Colombiana", esInfante: false },
      { nombres: "Bebe", apellidos: "Prueba", tipoDoc: "RC", numeroDoc: `3002${dist.doc}`, fechaNacimiento: "2029-08-01", nacionalidad: "Colombiana", esInfante: true, responsableIndex: 0 }];
    const conv = await convertirCotizacion(dist.id, pax as never, false, "Asesor 270", null, "COP", null, c.moneda === "USD" ? TRM_COSTO : undefined) as R;
    assert.equal(conv.ok, true, `${que}: ${conv.error}`);
    const n = conv.numero!;
    const venta = JSON.parse(sql(`select json_build_object('precio', precio_venta, 'costo_hotel', costo_hotel, 'costo_aereo', costo_aereo, 'moneda', moneda, 'pax', pax, 'trm_contrato', to_jsonb(v)->>'trm_contrato') from public.ventas v where numero_contrato = ${lit(n)}`)) as Record<string, string | number | null>;
    assert.equal(Number(venta.precio), c.esp.T, `${que}: precio_venta convertido == congelado == referencia`);
    assert.equal(Number(venta.costo_hotel), c.neta, `${que}: costo del hotel = neta TOTAL exacta`);
    assert.equal(venta.moneda, c.moneda, `${que}: moneda del contrato`);
    assert.equal(Number(venta.pax), 4, `${que}: 4 personas reales`);
    assert.equal(num(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and tipo_proveedor = 'hotel'`), c.neta, `${que}: CxP del hotel = neta exacta`);
    assert.equal(num(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and tipo_proveedor = 'hotel'`), 1);
    assert.equal(num(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and tipo_proveedor ilike 'a%reo'`), c.esp.costoAereo, `${que}: CxP aérea`);
    assert.equal(Number(venta.costo_aereo), c.esp.costoAereo, `${que}: costo aéreo`);
    assert.equal(num(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and tipo_proveedor = 'asistencia'`), c.esp.asistencia, `${que}: CxP de asistencia`);
    assert.equal(num(`select coalesce(sum(adultos * tarifa_adulto + ninos * tarifa_nino), 0) from public.contrato_items where numero_contrato = ${lit(n)}`), c.esp.T, `${que}: ítems del contrato = total`);
    const cxp = sql(`select coalesce(string_agg(tipo_proveedor || '=' || valor_total || '|moneda:' || coalesce(to_jsonb(c)->>'moneda', '-') || '|trm_costo:' || coalesce(to_jsonb(c)->>'trm_costo', '-') || '|valor_cop_costo:' || coalesce(to_jsonb(c)->>'valor_cop_costo', '-'), ' ; ' order by id), '') from public.cuentas_por_pagar c where numero_contrato = ${lit(n)}`);
    const foto2 = () => JSON.stringify([
      num(`select count(*) from public.ventas where numero_contrato = ${lit(n)}`), num(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`),
      num(`select count(*) from public.contrato_items where numero_contrato = ${lit(n)}`), num(`select count(*) from public.contrato_items where numero_contrato = ${lit(n)} and descripcion like 'Ajuste de redondeo%'`),
      num(`select count(*) from public.contrato_pasajeros where numero_contrato = ${lit(n)}`), num(`select count(*) from public.sillas where numero_contrato = ${lit(n)}`),
      num(`select count(*) from public.contrato_vuelos where numero_contrato = ${lit(n)}`), num(`select count(*) from public.abonos where numero_contrato = ${lit(n)}`),
      num(`select count(*) from public.cxp_pagos where cuenta_por_pagar_id in (select id from public.cuentas_por_pagar where numero_contrato = ${lit(n)})`),
      num(`select count(*) from public.ventas`), num(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`), num(`select precio_venta from public.ventas where numero_contrato = ${lit(n)}`),
    ]);
    if (c.moneda === "USD") verificarCxpUsd(que, n, TRM_COSTO); else for (const f of cxpDe(n)) { assert.equal(f.moneda, "COP"); assert.equal(f.trm, null); assert.equal(f.cop, null); }
    const antes = foto2();
    assert.deepEqual(JSON.parse(antes).slice(0, 9), [1, 3, JSON.parse(antes)[2], 1, 4, 3, 2, 0, 0], `${que}: 1 venta, 3 CxP (aérea, hotel, asistencia), 1 línea de ajuste, 4 pasajeros, 3 sillas, 2 tramos de vuelo, sin abonos ni pagos`);
    const otraVez = await convertirCotizacion(dist.id, pax as never, false, "Asesor 270", null, "COP", null, c.moneda === "USD" ? TRM_COSTO : undefined) as R;
    assert.equal(otraVez.ok && otraVez.numero === n, true, `${que}: el reintento devuelve el MISMO contrato`);
    assert.equal(foto2(), antes, `${que}: el reintento no crea segunda venta, CxP, ajuste, pasajero, silla ni vuelo`);
    // la cotización de REFERENCIA («adultos») solo sirvió para medir el total: se descarta (una valorada y abierta impediría desmarcar el hotel en las pruebas siguientes)
    sql(`update public.cotizaciones set estado = 'descartada' where id = ${ref.id}`);
    console.log(`  [AJUSTEPOS ${que}] neta=${c.neta} reparto=adulto ${c.na} × 2 + niño ${c.nn} × 1 + infante 0 · referencia(adultos)=${c.esp.T} · suma por viajero(distribuir)=${c.esp.S} · ajuste=+${c.esp.ajuste} · congelado=${precio(dist.id)} · convertido=${venta.precio} · costo_hotel=${venta.costo_hotel} · moneda=${venta.moneda} · trm_contrato=${venta.trm_contrato} · CxP: ${cxp} · contrato=${n}`);
    return n;
  }

  test("AJUSTEPOS en COP: residuo POSITIVO real (+1.000) hasta contrato y CxP; el reintento de conversión no duplica nada", async () => {
    await ajustePositivo("COP/bloqueo", {
      P: P1, H: H1, extra: { bloqueoId: B1, fechaIda: "2030-03-10", fechaRegreso: "2030-03-13" }, neta: 1_000_800, na: 400_000, nn: 200_800, moneda: "COP", docBase: 960,
      esp: { T: 2_902_000, S: 2_901_000, ajuste: 1_000, pa: 1_025_000, pn: 776_000, pi: 75_000, costoAereo: 3 * 400_000 + 50_000, asistencia: 80_000 },
    });
  });

  test("AJUSTEPOS en USD: residuo POSITIVO real (+1 USD) hasta contrato y CxP, moneda USD; el reintento no duplica nada", async () => {
    sql(`update public.hoteles set tarifa_bajo_solicitud = true where id = ${H5}`);
    try {
      await ajustePositivo("USD/bloqueo", {
        P: P6, H: H5, extra: { bloqueoId: B2, fechaIda: "2030-07-10", fechaRegreso: "2030-07-13" }, neta: 1000.8, na: 400, nn: 200.8, moneda: "USD", docBase: 970,
        esp: { T: 2902, S: 2901, ajuste: 1, pa: 1025, pn: 776, pi: 75, costoAereo: 3 * 400 + 50, asistencia: 80 },
      });
    } finally { sql(`update public.hoteles set tarifa_bajo_solicitud = false where id = ${H5}`); }
  });

  // ── Cierre #120 · TRM DE COSTOS: una reserva por persona con hotel en USD debe deber a sus proveedores en USD (moneda de la CxP) con su equivalente en COP congelado a la TRM de costos ──
  // (el carrito y los programas ya lo hacían: migración 236). Misma regla para el hotel a solicitud y para el hotel TARIFADO: es el mismo camino de conversión. En COP nada cambia.
  const TRM_COSTO = 4000.5;
  type FilaCxP = { tipo: string; valor: string; moneda: string | null; trm: string | null; cop: string | null };
  const cxpDe = (n: string) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('tipo', tipo_proveedor, 'valor', valor_total, 'moneda', moneda, 'trm', trm_costo, 'cop', valor_cop_costo) order by id), '[]'::json) from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`)) as FilaCxP[];
  function verificarCxpUsd(que: string, n: string, trm: number) {
    const filas = cxpDe(n);
    assert.ok(filas.length >= 2, `${que}: hay CxP (${filas.map((f) => f.tipo).join(", ")})`);
    for (const f of filas) {
      assert.equal(f.moneda, "USD", `${que}: la CxP de ${f.tipo} se debe en USD (importe ${f.valor} en dólares)`);
      assert.equal(Number(f.trm), trm, `${que}: la CxP de ${f.tipo} lleva la TRM de costos congelada`);
      assert.ok(Math.abs(Number(f.cop) - Math.round(Number(f.valor) * trm * 100) / 100) <= 0.01, `${que}: equivalente en COP de ${f.tipo} = ${f.valor} × ${trm} (${f.cop})`);
    }
    assert.equal(sql(`select moneda from public.ventas where numero_contrato = ${lit(n)}`), "USD", `${que}: el contrato está en USD`);
  }
  const sinCambios = (que: string, antes: ReturnType<typeof foto>) => assert.deepEqual(foto(), antes, `${que}: no se escribió contrato, venta, CxP, pasajeros ni sillas`);

  test("TRMCOSTO hotel a SOLICITUD en USD: sin TRM de costos no se numera nada; con ella, CxP en USD con equivalente congelado; el reintento no duplica", async () => {
    sql(`update public.hoteles set tarifa_bajo_solicitud = true where id = ${H5}`);
    try {
      const s = await solicitud({ ...entrada(P6, H5, { bloqueoId: B2, fechaIda: "2030-07-10", fechaRegreso: "2030-07-13" }), cliente: { ...CLIENTE, numeroDoc: "980" } });
      assert.equal(((await asignarNetaSolicitud(s.id, 1000)) as R).ok, true);
      const antes = foto();
      const sinTrm = await convertirCotizacion(s.id, PAX.slice(0, 2) as never, false, "Asesor 270", null, "COP", null) as R;
      assert.equal(sinTrm.ok, false, "sin TRM de costos no se convierte un contrato con proveedores en USD"); assert.match(sinTrm.error ?? "", /TRM de costos/);
      sinCambios("sin TRM", antes);
      for (const mala of ["abc", 0, -5, ""]) { const r = await convertirCotizacion(s.id, PAX.slice(0, 2) as never, false, "Asesor 270", null, "COP", null, mala) as R; assert.equal(r.ok, false, `TRM ${String(mala)}`); }
      sinCambios("TRM inválida", antes);
      const conv = await convertirCotizacion(s.id, PAX.slice(0, 2) as never, false, "Asesor 270", null, "COP", null, TRM_COSTO) as R;
      assert.equal(conv.ok, true, conv.error);
      const n = conv.numero!;
      verificarCxpUsd("solicitud USD", n, TRM_COSTO);
      assert.equal(num(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and tipo_proveedor = 'hotel'`), 1000, "CxP del hotel = neta exacta (USD)");
      // el devengo contable usa el equivalente en COP a la TRM de costos, no el nominal en dólares
      const devengo = num(`select coalesce(sum(l.debe), 0) from public.asiento_lineas l join public.asientos_contables a on a.id = l.asiento_id where a.origen = 'cxp' and a.referencia in (select 'cxp:' || id from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and tipo_proveedor = 'hotel')`);
      assert.equal(devengo, 1000 * TRM_COSTO, "el devengo contable del hotel es el equivalente en COP (1.000 USD × TRM de costos), no el nominal en dólares");
      const antesRetry = foto();
      const otraVez = await convertirCotizacion(s.id, PAX.slice(0, 2) as never, false, "Asesor 270", null, "COP", null, TRM_COSTO) as R;
      assert.equal(otraVez.ok && otraVez.numero === n, true, "el reintento devuelve el mismo contrato");
      assert.deepEqual(foto(), antesRetry, "el reintento no duplica venta, CxP, pasajeros ni sillas");
      const otraTrm = await convertirCotizacion(s.id, PAX.slice(0, 2) as never, false, "Asesor 270", null, "COP", null, 3900) as R;
      assert.equal(otraTrm.ok && otraTrm.numero === n, true, "convertida: un reintento no cambia nada ni siquiera con otra TRM");
      assert.deepEqual(cxpDe(n).map((f) => Number(f.trm)), cxpDe(n).map(() => TRM_COSTO), "la TRM congelada no cambia");
    } finally { sql(`update public.cotizaciones set estado = 'descartada' where estado = 'abierta' and hotel is not null and paquete_armado_id = ${P6}`); sql(`update public.hoteles set tarifa_bajo_solicitud = false where id = ${H5}`); }
  });

  test("TRMCOSTO hotel TARIFADO en USD (mismo camino): sin TRM no se convierte; con ella, CxP en USD con equivalente; el reintento no duplica", async () => {
    const q = await crearCotizacion({ paqueteId: P7, bloqueoId: null, modulo: "porcion_terrestre", hotelId: H6, fechaIda: "2030-08-10", fechaRegreso: "2030-08-13", categoria: "Estandar", regimen: "PC", habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, cliente: { ...CLIENTE, numeroDoc: "981" }, tipoAsesor: "interno", asesorInterno: "Asesor 270", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: [] } as never) as R;
    assert.equal(q.ok, true, q.error);
    const antes = foto();
    const sinTrm = await convertirCotizacion(q.id!, PAX.slice(0, 2) as never, false, "Asesor 270", null, "COP", null) as R;
    assert.equal(sinTrm.ok, false, "sin TRM de costos no se convierte un contrato con proveedores en USD"); assert.match(sinTrm.error ?? "", /TRM de costos/);
    sinCambios("tarifado sin TRM", antes);
    const conv = await convertirCotizacion(q.id!, PAX.slice(0, 2) as never, false, "Asesor 270", null, "COP", null, TRM_COSTO) as R;
    assert.equal(conv.ok, true, conv.error);
    const n = conv.numero!;
    verificarCxpUsd("tarifado USD", n, TRM_COSTO);
    const antesRetry = foto();
    const otraVez = await convertirCotizacion(q.id!, PAX.slice(0, 2) as never, false, "Asesor 270", null, "COP", null, TRM_COSTO) as R;
    assert.equal(otraVez.ok && otraVez.numero === n, true);
    assert.deepEqual(foto(), antesRetry, "el reintento no duplica nada");
  });

  test("TRMCOSTO en COP NADA cambia: la CxP sigue en COP, sin TRM de costos ni equivalente, y no se pide TRM", async () => {
    const q = await crearCotizacion({ paqueteId: P3, bloqueoId: null, modulo: "porcion_terrestre", hotelId: H3B, fechaIda: "2030-05-20", fechaRegreso: "2030-05-23", categoria: "Estandar", regimen: "PC", habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, cliente: { ...CLIENTE, numeroDoc: "982" }, tipoAsesor: "interno", asesorInterno: "Asesor 270", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: [] } as never) as R;
    assert.equal(q.ok, true, q.error);
    const conv = await convertirCotizacion(q.id!, PAX.slice(0, 2) as never, false, "Asesor 270", null, "COP", null) as R;
    assert.equal(conv.ok, true, conv.error);
    const filas = cxpDe(conv.numero!);
    assert.ok(filas.length >= 2);
    for (const f of filas) { assert.equal(f.moneda, "COP"); assert.equal(f.trm, null); assert.equal(f.cop, null); }
    assert.equal(num(`select count(*) from public.cotizaciones where id = ${q.id} and detalle ? 'costo'`), 0, "una conversión en COP no congela TRM de costos");
    // una TRM mandada de más en COP se ignora (no se guarda ni cambia nada)
    const q2 = await crearCotizacion({ paqueteId: P3, bloqueoId: null, modulo: "porcion_terrestre", hotelId: H3B, fechaIda: "2030-05-24", fechaRegreso: "2030-05-27", categoria: "Estandar", regimen: "PC", habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, cliente: { ...CLIENTE, numeroDoc: "983" }, tipoAsesor: "interno", asesorInterno: "Asesor 270", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: [] } as never) as R;
    const conv2 = await convertirCotizacion(q2.id!, PAX.slice(0, 2) as never, false, "Asesor 270", null, "COP", null, 4321) as R;
    assert.equal(conv2.ok, true, conv2.error);
    for (const f of cxpDe(conv2.numero!)) { assert.equal(f.moneda, "COP"); assert.equal(f.trm, null); assert.equal(f.cop, null); }
  });

  test("OCUPACIÓN REAL: avisos y rechazos (sin pasajero ficticio, sin silla ni ítem extra); hotel sin hotel_acomodaciones", async () => {
    uidSesion = null;
    type Oc = { ok: boolean; error?: string; adultos?: number; ninos?: number; infantes?: number };
    const v = (p: Record<string, unknown>) => validarOcupacionSolicitud({ paqueteId: P3, hotelId: H3, habitaciones: { doble: 1 }, ...p }) as Promise<Oc>;
    const uno = await v({ edadesMenores: [7], adultos: 1 });
    assert.deepEqual([uno.ok, uno.adultos, uno.ninos, uno.infantes], [true, 1, 1, 0]);
    const conInf = await v({ edadesMenores: [7, 1], adultos: 1 });
    assert.deepEqual([conInf.ok, conInf.adultos, conInf.ninos, conInf.infantes], [true, 1, 1, 1]);
    const malos: [string, Record<string, unknown>, RegExp][] = [
      ["1 adulto sin niño que ocupe la plaza", { edadesMenores: [], adultos: 1 }, /niño/],
      ["1 adulto + solo un infante", { edadesMenores: [1], adultos: 1 }, /niño/],
      ["más adultos que plazas", { edadesMenores: [7], adultos: 3 }, /son para 2 adulto/],
      ["cero adultos", { edadesMenores: [7], adultos: 0 }, /de 1 en adelante/],
    ];
    for (const [que, p, patron] of malos) { const r = await v(p); assert.equal(r.ok, false, que); assert.match(r.error ?? "", patron, que); }
    // hotel SIN hotel_acomodaciones (defaults del motor, doble de 2): 1 adulto + 1 niño CABE (2 personas reales); 1 adulto + 2 niños no
    const sin = (edades: number[]) => validarOcupacionSolicitud({ paqueteId: P3, hotelId: H4, habitaciones: { doble: 1 }, edadesMenores: edades, adultos: 1 }) as Promise<Oc>;
    const s1 = await sin([7]); assert.deepEqual([s1.ok, s1.adultos, s1.ninos], [true, 1, 1]);
    assert.equal((await sin([7, 8])).ok, false);
    // crear la solicitud lo vuelve a exigir en el servidor (no se llega a la valoración con un pedido imposible)
    const antes = num("select count(*) from public.cotizaciones");
    const r = await crearSolicitudHotel({ ...entrada(P3, H3, { fechaIda: "2030-05-10", fechaRegreso: "2030-05-13" }), cliente: { ...CLIENTE, numeroDoc: "950" }, edadesMenores: [], adultos: 1 }) as R;
    uidSesion = UID_SUPER;
    assert.equal(r.ok, false); assert.match(r.error ?? "", /niño/);
    assert.equal(num("select count(*) from public.cotizaciones"), antes, "no se creó ninguna cotización");
    // convertir con MÁS adultos reales que los declarados se rechaza (ni se numera ni se escribe nada)
    const s = await solicitud({ ...entrada(P3, H3, { fechaIda: "2030-05-10", fechaRegreso: "2030-05-13" }), cliente: { ...CLIENTE, numeroDoc: "951" }, edadesMenores: [7], adultos: 1 });
    assert.equal(((await asignarNetaSolicitud(s.id, NETA)) as R).ok, true);
    const fotoAntes = foto();
    const mal = await convertirCotizacion(s.id, [...PAX.slice(0, 2), { nombres: "Nina", apellidos: "Prueba", tipoDoc: "TI", numeroDoc: "395101", fechaNacimiento: "2023-01-01", nacionalidad: "Colombiana", esInfante: false }] as never, false, "Asesor 270", null, "COP", null) as R;
    assert.equal(mal.ok, false); assert.match(mal.error ?? "", /adulto/);
    assert.deepEqual(foto(), fotoAntes, "el rechazo no escribe contrato, venta, CxP, pasajeros ni sillas");
    // con los viajeros REALES (1 adulto + 1 niño) sí se convierte: 2 pasajeros, sin ninguno ficticio
    const nina = { nombres: "Nina", apellidos: "Prueba", tipoDoc: "TI", numeroDoc: "395101", fechaNacimiento: "2023-01-01", nacionalidad: "Colombiana", esInfante: false };
    const bien = await convertirCotizacion(s.id, [PAX[0], nina] as never, false, "Asesor 270", null, "COP", null) as R;
    assert.equal(bien.ok, true, bien.error);
    assert.equal(num(`select count(*) from public.contrato_pasajeros where numero_contrato = ${lit(bien.numero)}`), 2);
  });

  test("RECHAZOS: suma que no cuadra, infante con neta ≠ 0, distribución sin niños, modo inválido; la solicitud sigue pendiente y nada se escribe", async () => {
    const antes = foto();
    const conNin = await solicitud({ ...entrada(P3, H3, { fechaIda: "2030-05-22", fechaRegreso: "2030-05-25" }), cliente: { ...CLIENTE, numeroDoc: "816" }, edadesMenores: [7, 1] });
    const casos: [string, unknown, RegExp][] = [
      ["suma que no cuadra", { netaTotal: NETA, modo: "distribuir", netaAdulto: 500_000, netaNino: 199_000 }, /no cuadra/],
      ["infante con neta ≠ 0 (distribuir)", { netaTotal: NETA, modo: "distribuir", netaAdulto: 500_000, netaNino: 200_000, netaInfante: 1000 }, /infantes siempre van con neta hotelera \$0/],
      ["infante con neta ≠ 0 (adultos)", { netaTotal: NETA, modo: "adultos", netaInfante: 5 }, /infantes siempre/],
      ["modo inválido", { netaTotal: NETA, modo: "mitad" }, /Elige cómo cargar/],
      ["importes por tipo en «adultos»", { netaTotal: NETA, modo: "adultos", netaAdulto: 600_000 }, /no lleva importes/],
      ["niño en 0 al distribuir", { netaTotal: NETA, modo: "distribuir", netaAdulto: 600_000, netaNino: 0 }, /neta por adulto y por niño/],
    ];
    for (const [que, entradaMala, patron] of casos) {
      const r = await asignarNetaSolicitud(conNin.id, entradaMala) as R;
      assert.equal(r.ok, false, que); assert.match(r.error ?? "", patron, que);
    }
    assert.equal(sql(`select estado from public.cotizaciones where id = ${conNin.id}`), "pendiente_tarifa", "sigue pendiente tras los rechazos");
    assert.equal(num(`select count(*) from public.cotizacion_tarifa_solicitud where cotizacion_id = ${conNin.id}`), 0);
    // distribución SIN niños: no hay nada que distribuir
    const sinNin = await solicitud({ ...entrada(P3, H3, { fechaIda: "2030-05-26", fechaRegreso: "2030-05-29" }), cliente: { ...CLIENTE, numeroDoc: "817" } });
    const rs = await asignarNetaSolicitud(sinNin.id, { netaTotal: NETA, modo: "distribuir", netaAdulto: 600_000, netaNino: 1 }) as R;
    assert.equal(rs.ok, false); assert.match(rs.error ?? "", /No hay niños/);
    assert.equal(sql(`select estado from public.cotizaciones where id = ${sinNin.id}`), "pendiente_tarifa");
    assert.deepEqual(foto(), antes, "los rechazos no escriben contratos, ventas, CxP ni sillas");
    // defensa en la base: la RPC rechaza lo mismo aunque se salte la aplicación (infante ≠ 0, suma que no cuadra, distribución sin niños)
    assert.match(sqlError(`begin; select set_config('request.jwt.claim.sub', '${UID_SUPER}', true); set local role authenticated;
      select public.cargar_neta_solicitud(${conNin.id}, 'hotel', ${NETA}, 'COP', 0.2, 1000, '{}'::jsonb, null, 'distribuir', 2, 1, 1, 500000, 200000, 7); rollback;`), /infantes siempre van con neta hotelera \$0/);
    assert.match(sqlError(`begin; select set_config('request.jwt.claim.sub', '${UID_SUPER}', true); set local role authenticated;
      select public.cargar_neta_solicitud(${conNin.id}, 'hotel', ${NETA}, 'COP', 0.2, 1000, '{}'::jsonb, null, 'distribuir', 2, 1, 1, 500000, 100000, 0); rollback;`), /no cuadra/);
    assert.match(sqlError(`begin; select set_config('request.jwt.claim.sub', '${UID_SUPER}', true); set local role authenticated;
      select public.cargar_neta_solicitud(${sinNin.id}, 'hotel', ${NETA}, 'COP', 0.2, 1000, '{}'::jsonb, null, 'distribuir', 2, 0, 0, 600000, 1, 0); rollback;`), /no hay niños/);
    assert.equal(sql(`select estado from public.cotizaciones where id = ${conNin.id}`), "pendiente_tarifa");
  });

  test("ACOMODACIÓN: el aviso ANTES de enviar y el rechazo al crear (hotel sin hotel_acomodaciones = defaults del motor: una doble no admite menores)", async () => {
    uidSesion = null;
    const sinConfig = await validarOcupacionSolicitud({ paqueteId: P3, hotelId: H4, habitaciones: { doble: 1 }, edadesMenores: [7] }) as { ok: boolean; error?: string };
    assert.equal(sinConfig.ok, false); assert.match(sinConfig.error ?? "", /admite máximo 0 niño/);
    const sinMenores = await validarOcupacionSolicitud({ paqueteId: P3, hotelId: H4, habitaciones: { doble: 1 }, edadesMenores: [] }) as { ok: boolean; adultos?: number };
    assert.deepEqual([sinMenores.ok, sinMenores.adultos], [true, 2]);
    const conConfig = await validarOcupacionSolicitud({ paqueteId: P3, hotelId: H3, habitaciones: { doble: 1 }, edadesMenores: [7, 1] }) as { ok: boolean; adultos?: number; ninos?: number; infantes?: number };
    assert.deepEqual([conConfig.ok, conConfig.adultos, conConfig.ninos, conConfig.infantes], [true, 2, 1, 1]);
    const exceso = await validarOcupacionSolicitud({ paqueteId: P3, hotelId: H3, habitaciones: { doble: 1 }, edadesMenores: [5, 6, 7] }) as { ok: boolean; error?: string };
    assert.equal(exceso.ok, false);
    // un hotel tarifado (o no seleccionado) no se consulta por aquí
    assert.equal(((await validarOcupacionSolicitud({ paqueteId: P3, hotelId: H3B, habitaciones: { doble: 1 }, edadesMenores: [] })) as { ok: boolean }).ok, false);
    // y crear la solicitud lo vuelve a exigir en el servidor (no se llega a la valoración con un pedido imposible)
    const antes = num("select count(*) from public.cotizaciones");
    const r = await crearSolicitudHotel(entrada(P3, H4, { fechaIda: "2030-05-10", fechaRegreso: "2030-05-13", edadesMenores: [7] })) as R;
    uidSesion = UID_SUPER;
    assert.equal(r.ok, false); assert.match(r.error ?? "", /admite máximo 0 niño/);
    assert.equal(num("select count(*) from public.cotizaciones"), antes, "no se creó ninguna cotización");
  });

  test("REACREDITACIÓN al convertir: si cambió la clasificación por edad desde la valoración, no se convierte (ni se numera)", async () => {
    const s = await solicitud({ ...entrada(P3, H3, { fechaIda: "2030-05-02", fechaRegreso: "2030-05-05" }), cliente: { ...CLIENTE, numeroDoc: "818" }, edadesMenores: [7, 1] });
    assert.equal(((await asignarNetaSolicitud(s.id, { netaTotal: NETA, modo: "distribuir", netaAdulto: 450_000, netaNino: 300_000 })) as R).ok, true);
    const original = sql(`select coalesce(edad_infante_max::text, 'null') from public.hoteles where id = ${H3}`);
    const originalMin = sql(`select coalesce(edad_nino_min::text, 'null') from public.hoteles where id = ${H3}`);
    try {
      sql(`update public.hoteles set edad_infante_max = 0 where id = ${H3}`); // el niño de 1 año pasa a «niño»: 2 niños, 0 infantes
      const antes = foto();
      const r = await convertirCotizacion(s.id, PAX4("02") as never, false, "Asesor 270", null, "COP", null) as R;
      assert.equal(r.ok, false); assert.match(r.error ?? "", /clasificación de los viajeros cambió/);
      assert.deepEqual(foto(), antes);
    } finally {
      sql(`update public.hoteles set edad_infante_max = ${original === "null" ? "null" : original}, edad_nino_min = ${originalMin === "null" ? "null" : originalMin} where id = ${H3}`);
    }
    const ok = await convertirCotizacion(s.id, PAX4("02") as never, false, "Asesor 270", null, "COP", null) as R;
    assert.equal(ok.ok, true, ok.error);
  });

  test("el hotel tarifado no admite la marca ni el cambio de tarifas: desmarcar tras convertir sí se permite", async () => {
    // Las solicitudes de los rechazos siguen PENDIENTES: con ellas el hotel NO se puede desmarcar; al descartarlas, sí.
    const bloqueado = await setHotelBajoSolicitud(H3, false) as R; assert.equal(bloqueado.ok, false); assert.match(bloqueado.error ?? "", /solicitudes pendientes de tarifa/);
    sql("update public.cotizaciones set estado = 'descartada' where estado = 'pendiente_tarifa'");
    // CHECK de la 271: la regla vive también en la base (aunque alguien escriba la tabla saltándose la RPC)
    const cot = num("select min(id) from public.cotizaciones where estado = 'convertida'");
    const malos: [string, string, RegExp][] = [
      ['infante con neta ≠ 0', "'adultos', 2, 1, 1, 500, 0, 7", /cts_infante_cero_check/],
      ['modo adultos con neta por niño', "'adultos', 2, 1, 1, 500, 100, 0", /cts_modo_adultos_check/],
      ['distribuir sin niños', "'distribuir', 2, 0, 0, 500, 100, 0", /cts_modo_distribuir_check/],
      ['distribuir que no cuadra', "'distribuir', 2, 1, 1, 400, 100, 0", /cts_modo_distribuir_check/],
      ['modo inventado', "'mitad', 2, 1, 1, 500, 0, 0", /cts_modo_check/],
      ['sin adultos', "'adultos', 0, 1, 1, 500, 0, 0", /cts_conteos_check/],
    ];
    malos.forEach(([que, cols, patron], i) => assert.match(sqlError(`insert into public.cotizacion_tarifa_solicitud (cotizacion_id, item_ref, tenant, paquete_id, hotel_id, neta, moneda, precio_venta, modo, adultos, ninos, infantes, neta_adulto, neta_nino, neta_infante) values (${cot}, 'chk_${i}', 'mayorista', ${P3}, ${H3}, 1000, 'COP', 1000, ${cols})`), patron, que));
    const marcar = await setHotelBajoSolicitud(H3B, true) as R; assert.equal(marcar.ok, false); assert.match(marcar.error ?? "", /ya tiene tarifas/);
    assert.match(sqlError(`insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada) values (${H1}, 'X', 'PC', 'Z')`), /HOTEL_BAJO_SOLICITUD/);
    // las cotizaciones de H1/H2/H3 ya están convertidas: la marca se puede quitar (y volver a poner)
    for (const h of [H1, H2, H3, H4]) { const r = await setHotelBajoSolicitud(h, false) as R; assert.equal(r.ok, true, r.error); }
    assert.equal(num(`select count(*) from public.hoteles where tarifa_bajo_solicitud`), 0);
    const lista = await cargarHotelesBajoSolicitud();
    assert.equal(lista.ok && lista.hoteles.length, 0, "desmarcado: la tarjeta deja de ofrecerse");
    // un hotel desmarcado sin tarifas vuelve a no tener precio (no queda un hotel «medio a solicitud»)
    const c = await crearCotizacion({ paqueteId: P3, bloqueoId: null, modulo: "porcion_terrestre", hotelId: H3, fechaIda: "2030-05-10", fechaRegreso: "2030-05-13", categoria: "Estandar", regimen: "PC", habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, cliente: CLIENTE, tipoAsesor: "interno", asesorInterno: "Asesor 270", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: [] } as never) as R;
    assert.equal(c.ok, false);
  });
});
