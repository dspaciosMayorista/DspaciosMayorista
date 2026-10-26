// #102 · migración 238 — trayecto REAL por HTTP contra PostgreSQL de la COTIZACIÓN ASISTIDA B2B del carrito:
//   crearSolicitudReserva (app/tarifario/checkout/actions.ts) → cotizaciones (plan B2B CONGELADO en payload.b2bAsistido)
//   → convertirCotizacionCarrito (app/(dashboard)/dashboard/reservar/actions.ts) → ventas B2B / numeración / pasajeros / contrato_* /
//   registrar_comision_b2b_reserva (205) → aliados_b2b / registrar_financiero_contrato / CxP → devengo contable → cobro y portal.
// SIN simulaciones de dinero ni de permisos: la sesión es un cliente PostgREST real con el JWT `authenticated` de un usuario real de la base (RLS incluida).
// Lo ÚNICO simulado: el motor de PRECIOS de la reserva (computarReserva), la liquidación PVP de servicios (liquidarServicioPuntual), la cookie de agencia
// (contextoCotizacion) y la sesión (auth.getUser).
//
// SOLO base LOCAL desechable. No corre en `npm run test:*`: la lanza supabase/scripts/test_238_asistida_b2b.sh, que crea la base (001-237 + 238),
// levanta un PostgREST propio y lo borra todo al final. Nada aquí habla con Supabase remoto.
import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG102_CONTENEDOR ?? "pg238";
const DB = process.env.PG102_BASE ?? "";
const PGRST = process.env.PG102_POSTGREST ?? "";
const SECRETO = process.env.PG102_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) {
  throw new Error("Faltan PG102_BASE (desechable), PG102_POSTGREST y PG102_JWT_SECRET: usa supabase/scripts/test_238_asistida_b2b.sh.");
}

// ── "server-only" y "next/cache" como módulos mínimos ──
type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = {
  "server-only": "export {}",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const src = MODULOS_MINIMOS[specifier];
    if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// ── JWT (HS256) con el secreto del PostgREST local ───────────────────────
const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}

// Usuarios de la prueba (todos reales en auth.users / usuarios).
const U = {
  VENTA: "00000000-0000-0000-0000-000000102001",
  ADMIN: "00000000-0000-0000-0000-000000102002",
  CTRL: "00000000-0000-0000-0000-000000102003",
  MINORISTA: "00000000-0000-0000-0000-000000102004",
  AGENCIA: "00000000-0000-0000-0000-000000102005",
  GERENCIA: "00000000-0000-0000-0000-000000102006",
  SUPER: "00000000-0000-0000-0000-000000102007",
  OPERACIONES: "00000000-0000-0000-0000-000000102008",
  INACTIVO: "00000000-0000-0000-0000-000000102009",
} as const;
const SESIONES: Record<string, { rol: string; tenant: string; activo: boolean; email: string; nombre: string }> = Object.fromEntries(
  ([
    [U.VENTA, "venta", "mayorista", true], [U.ADMIN, "administracion", "mayorista", true], [U.CTRL, "control_vuelo", "mayorista", true],
    [U.MINORISTA, "venta", "minorista", true], [U.AGENCIA, "agencia", "mayorista", true], [U.GERENCIA, "gerencia", "mayorista", true],
    [U.SUPER, "superadmin", "mayorista", true], [U.OPERACIONES, "operaciones", "mayorista", true], [U.INACTIVO, "venta", "mayorista", false],
  ] as const).map(([id, rol, tenant, activo], i) => [id, { rol, tenant, activo, email: `u102_${i}@x.test`, nombre: `Usuario 102 ${rol}${tenant === "minorista" ? " min" : ""}${activo ? "" : " inactivo"}` }]),
);
const TOKEN_SERVICIO = jwt({ role: "service_role" });
let uidSesion: string = U.VENTA;

process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;

// supabase-js antepone /rest/v1 a las rutas de PostgREST; el PostgREST local las sirve en la raíz.
const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteSesion = () => clienteLocal(jwt({ role: "authenticated", sub: uidSesion }), { id: uidSesion, email: SESIONES[uidSesion].email });

// ── SQL directo (superusuario del contenedor) para sembrar y comprobar ────
function psql(q: string, ...extra: string[]): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", ...extra],
    { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
const sql = (q: string) => psql(q);
const fila = (q: string) => sql(q).split("|");
const lit = (v: unknown) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const json = <T = Record<string, unknown>>(q: string): T => JSON.parse(sql(q)) as T;
/** SQL de mantenimiento que se salta el disparador de la frontera (session_replication_role = replica): simula una base ya manipulada por quien tenga permisos de dueño. */
const sinFrontera = (q: string) => sql(`set session_replication_role = replica; ${q}`);
/** Ejecuta SQL que DEBE fallar y devuelve el mensaje de la base. */
function sqlFalla(q: string): string {
  try { sql(q); } catch (e) { return String((e as { stderr?: string; message?: string }).stderr ?? (e as Error).message); }
  assert.fail(`se esperaba que la base rechazara: ${q}`);
}

// ── Motor de reserva simulado, por hotel (el precio NO es lo que se prueba) ──
type HotelSim = { nombre: string; destino: string; moneda: string; pvp: number; neto: number; impuesto: number };
let HOTELES: Record<number, HotelSim> = {};
type ServicioSim = { nombre: string; moneda: string; total: number; paqueteId: number };
const SERVICIOS: Record<number, ServicioSim> = {};
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async (_sb: unknown, r: { hotelId: number }) => {
      const h = HOTELES[r.hotelId];
      return {
        ok: true,
        data: {
          origen: { tipo: "ninguno" },
          meta: { hotel_nombre: h.nombre, destino_nombre: h.destino, fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04" },
          precioVenta: h.pvp * 2, monedaReserva: h.moneda, impuestoTotal: h.impuesto,
          lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: h.pvp }], pvpPorAcom: { doble: h.pvp }, netoPorAcom: { doble: h.neto },
          numNinos: 0, numNinos2: 0, numInfantes: 0, numMenoresDeDos: 0, totalPax: 2, paxConSilla: 2, edadesMenoresUsadas: [], lineasMenores: [],
          serviciosIncluidos: [], serviciosItems: [], distribucionMenores: null, condicionesTarifa: [], notaNino: null, cargoMascota: null, notaMascota: null,
          oferta63: null, vigencias63: [],
        },
      };
    },
  },
});
mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/reservar/cotizar", {
  namedExports: {
    // PVP del servicio (la liquidación real es otro frente); el COSTO del servicio sí se liquida de verdad al convertir (liquidarCostoTour).
    liquidarServicioPuntual: async (t: { servicioId: number }) => {
      const s = SERVICIOS[t.servicioId];
      if (!s) return { ok: false, tipo: "no_disponible", mensaje: "servicio no disponible" };
      return { ok: true, resultado: { servicioId: t.servicioId, paqueteId: s.paqueteId, nombre: s.nombre, destino: "CARTAGENA", descripcion: null, noches: 3, pax: 2, total: s.total, moneda: s.moneda, categoria: "tour_traslado" } };
    },
    cotizarPorFechas: async () => { throw new Error("no se usa"); },
    buscarHoteles: async () => { throw new Error("no se usa"); },
    buscarReceptivos: async () => { throw new Error("no se usa"); },
  },
});
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
// Contexto de cotización: el MISMO criterio que el real (activo + tenant del usuario; solo superadmin cruza), tomado de la sesión de la prueba.
const { autorizaTenant } = await import("../lib/cotizacion/accesoPuro.ts");
mock.module("@/lib/cotizacion/acceso", {
  namedExports: {
    contextoCotizacion: async () => {
      const s = SESIONES[uidSesion];
      return s.activo ? { ok: true, superadmin: s.rol === "superadmin", tenant: s.tenant } : { ok: false, motivo: "usuario_inactivo" };
    },
    autorizaTenant,
  },
});
mock.module("@/lib/contrato/congelarCondicionesContrato", {
  namedExports: { componenteHotelReal: async () => null, componentePaqueteReal: async () => null, trmReferenciaAproximada: async () => null, congelarCondicionesContratoBestEffort: async () => {} },
});
const { interpretarRespuestaNumeroContrato } = await import("../lib/contrato/numeracionPuro.ts");
mock.module("@/lib/contrato/numeracion", {
  namedExports: {
    siguienteNumeroContrato: async (tenant: string) => {
      const { data, error } = await clienteLocal(TOKEN_SERVICIO).rpc("siguiente_numero_contrato_para_tenant", { p_tenant: tenant });
      return interpretarRespuestaNumeroContrato(data, error as never);
    },
  },
});
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { crearSolicitudReserva, getContextoAsistenciaB2B } = await import("../app/tarifario/checkout/actions.ts");
const { convertirCotizacionCarrito } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { netoTotalExigibleDeContrato } = await import("../lib/contrato/netoContrato.server.ts");
const { contratosDelPortalB2B } = await import("../lib/auth/contratosPortalB2B.ts");
const { comisionVisibleAliado, evidenciaSinFicha, calcularComisionFila, estadoComisionFila } = await import("../lib/finanzas/comisionB2B.ts");
const { cobroDeContratoCarrito } = await import("../lib/finanzas/cobroCarrito.ts");
const { desgloseNetoB2B } = await import("../lib/finanzas/netoB2B.ts");
const { leerPlanB2BDePayload, MENSAJE_TERMINOS_CAMBIARON } = await import("../lib/cotizacion/asistidaB2B.ts");
type PlanB2B = import("../lib/cotizacion/asistidaB2B.ts").PlanB2BCotizacion;

// ── Catálogo de aliados de la prueba ──────────────────────────────────────
const A = {
  AG10: 10201,       // agencia, 10 % propio
  FL_GENERAL: 10202, // freelance, sin % propio → parámetro general 11 %
  AG0: 10203,        // agencia, 0 % EXPLÍCITO
  INACTIVO: 10204,   // agencia desactivada
  AG_GENERAL: 10205, // agencia, sin % propio → parámetro general 12 %
  OTRO: 10206,       // tipo distinto de agencia/freelance
} as const;
const ALIADOS_NOMBRE = { [A.AG10]: "Viajes Aurora 102", [A.FL_GENERAL]: "Lucía Gómez 102", [A.AG0]: "Agencia Cero 102", [A.INACTIVO]: "Agencia Inactiva 102", [A.AG_GENERAL]: "Agencia General 102", [A.OTRO]: "Proveedor Raro 102" } as const;

const PASAJEROS = [
  { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false },
  { nombres: "Luis", apellidos: "Gómez", tipoDoc: "CC", numeroDoc: "456", fechaNacimiento: "1988-05-05", nacionalidad: "Colombiana", esInfante: false },
];
const CLIENTE = { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };

before(() => {
  sql(`
    insert into auth.users (id, email) values ${Object.entries(SESIONES).map(([id, s]) => `('${id}', '${s.email}')`).join(", ")} on conflict do nothing;
    insert into public.aliados (id, nombre, tipo, pct_comision, activo) values
      (${A.AG10}, ${lit(ALIADOS_NOMBRE[A.AG10])}, 'agencia', 0.10, true),
      (${A.FL_GENERAL}, ${lit(ALIADOS_NOMBRE[A.FL_GENERAL])}, 'freelance', null, true),
      (${A.AG0}, ${lit(ALIADOS_NOMBRE[A.AG0])}, 'agencia', 0, true),
      (${A.INACTIVO}, ${lit(ALIADOS_NOMBRE[A.INACTIVO])}, 'agencia', 0.10, false),
      (${A.AG_GENERAL}, ${lit(ALIADOS_NOMBRE[A.AG_GENERAL])}, 'agencia', null, true),
      (${A.OTRO}, ${lit(ALIADOS_NOMBRE[A.OTRO])}, 'otro', 0.10, true) on conflict (id) do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
      ${Object.entries(SESIONES).map(([id, s]) => `('${id}', '${s.email}', ${lit(s.nombre)}, '${s.rol}', ${s.activo}, '${s.tenant}', ${s.rol === "agencia" ? A.AG10 : "null"})`).join(", ")}
      on conflict (id) do update set nombre = excluded.nombre, email = excluded.email, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id;
    insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion) values
      ('COMISION_AGENCIA', 0.12, 'base_comisionable', 'Comisión agencia'), ('COMISION_FREELANCE', 0.11, 'base_comisionable', 'Comisión freelance')
      on conflict (parametro) do update set valor = excluded.valor;
    insert into public.destinos (id, nombre) values (10201, 'CARTAGENA 102'), (10202, 'SANTA MARTA 102') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (10201, 'Proveedor Hotel 102'), (10202, 'Tours Rosario 102') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) values
      (10201, 10201, 'Hotel Aurora 102', 10201, 'COP'), (10202, 10202, 'Hotel Rodadero 102', 10201, 'COP'),
      (10203, 10201, 'Hotel Dubái 102', 10201, 'USD'), (10204, 10201, 'Hotel Solo Impuesto 102', 10201, 'COP') on conflict do nothing;
    insert into public.armado_paquetes (id, nombre, tipo, moneda) values (10201, 'Paquete COP 102', 'porcion_terrestre', 'COP'), (10202, 'Paquete USD 102', 'porcion_terrestre', 'USD') on conflict do nothing;
  `);
});

let servicioSeq = 10300;
/** Crea un servicio del catálogo (con su proveedor) dentro del paquete COP y lo registra en el simulador de PVP. Devuelve su id. */
function servicio(nombre: string, precioPersonaNeto: number, pvp: number): number {
  const id = ++servicioSeq;
  sql(`
    insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa)
      values (${id}, ${lit(nombre)}, 10202, 10201, ${precioPersonaNeto}, 'tour_traslado', 'COP', 'persona');
    insert into public.armado_servicios (paquete_id, servicio_id, modo) values (10201, ${id}, 'persona');
  `);
  SERVICIOS[id] = { nombre, moneda: "COP", total: pvp, paqueteId: 10201 };
  return id;
}

beforeEach(() => {
  HOTELES = {
    10201: { nombre: "Hotel Aurora 102", destino: "CARTAGENA", moneda: "COP", pvp: 500_000, neto: 300_000, impuesto: 200_000 },       // PVP 1.000.000 · imp 200.000
    10202: { nombre: "Hotel Rodadero 102", destino: "SANTA MARTA", moneda: "COP", pvp: 300_000, neto: 180_000, impuesto: 100_000 },   // PVP   600.000 · imp 100.000
    10203: { nombre: "Hotel Dubái 102", destino: "CARTAGENA", moneda: "USD", pvp: 150, neto: 100, impuesto: 30 },                     // PVP USD 300 · imp 30
    10204: { nombre: "Hotel Solo Impuesto 102", destino: "CARTAGENA", moneda: "COP", pvp: 250_000, neto: 150_000, impuesto: 500_000 }, // PVP 500.000 · imp 500.000 (base 0)
  };
  uidSesion = U.VENTA;
  sql("drop trigger if exists t102_falla_comision on public.aliados_b2b");
});

// ── Entradas del navegador ────────────────────────────────────────────────
const itemEntrada = (hotelId: number, paqueteId = 10201, bloqueoId: number | null = null) => ({
  itemId: `h${hotelId}`, modulo: bloqueoId == null ? "porcion_terrestre" : "bloqueo", paqueteId, hotelId, bloqueoId,
  hotelNombre: HOTELES[hotelId].nombre, destino: HOTELES[hotelId].destino, categoria: "Estandar", regimen: "Desayuno",
  fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1,
  edadesMenores: [], cantidadMenores: 0,
});
const tourEntrada = (servicioId: number, hotelId: number | null = null, paqueteId = 10201) =>
  ({ servicioId, paqueteId, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, hotelItemId: hotelId == null ? null : `h${hotelId}` });
type Asistencia = { canal: "b2b"; aliadoId: number; modo: "comisionable" | "neta" } | { canal: "b2c" } | Record<string, unknown>;
type RespCotizar = { ok: boolean; error?: string; cotizacion?: { id: number; codigo: string; url: string }; b2bAsistido?: PlanB2B; mensaje?: string };
async function cotizar(sesion: string, o: { hoteles?: number[]; tours?: ReturnType<typeof tourEntrada>[]; asistencia?: Asistencia; paqueteId?: number; bloqueoId?: number; extra?: Record<string, unknown> }): Promise<RespCotizar> {
  uidSesion = sesion;
  const entrada = {
    items: (o.hoteles ?? [10201]).map((h) => itemEntrada(h, o.paqueteId, o.bloqueoId ?? null)), tours: o.tours ?? [], cliente: CLIENTE,
    ...(o.asistencia !== undefined ? { asistencia: o.asistencia } : {}), ...(o.extra ?? {}),
  };
  return (await crearSolicitudReserva(entrada)) as unknown as RespCotizar;
}
const b2b = (aliadoId: number, modo: "comisionable" | "neta"): Asistencia => ({ canal: "b2b", aliadoId, modo });

type RespConvertir = { ok: boolean; error?: string; numeros?: string[] };
async function convertir(sesion: string, id: number, nItems: number, eleccion: { monedaCobro?: string | null; trmCobro?: number | string | null; trmCosto?: number | string | null } = { monedaCobro: "COP" },
  agrupar: "todo" | "por_destino" = "todo", nTours = 0): Promise<RespConvertir> {
  uidSesion = sesion;
  return convertirCotizacionCarrito(id, {
    agrupar, pasajeros: PASAJEROS, asesorInterno: SESIONES[sesion].nombre,
    asignaciones: Array.from({ length: nItems }, () => [1, 2]), asignacionesTours: Array.from({ length: nTours }, () => [1, 2]), ...eleccion,
  }) as Promise<RespConvertir>;
}

// ── Lecturas de verificación ──────────────────────────────────────────────
const totalVentas = () => Number(sql("select count(*) from public.ventas"));
const totalCotizaciones = () => Number(sql("select count(*) from public.cotizaciones"));
const totalComisiones = () => Number(sql("select count(*) from public.aliados_b2b"));
const totalCxp = () => Number(sql("select count(*) from public.cuentas_por_pagar"));
const ultimoNumero = () => sql("select coalesce(max(substring(numero_contrato from 5)::int), 0) from public.ventas where numero_contrato ~ '^DTM-[0-9]+$'");
const foto = () => ({ ventas: totalVentas(), comisiones: totalComisiones(), cxp: totalCxp(), ultimo: ultimoNumero() });
const estadoCot = (id: number) => sql(`select estado from public.cotizaciones where id = ${id}`);
const payloadCot = (id: number) => json<{ b2bAsistido?: Record<string, unknown> }>(`select payload::text from public.cotizaciones where id = ${id}`);
const detalleCot = (id: number) => json<Record<string, unknown>>(`select coalesce(detalle, '{}'::jsonb)::text from public.cotizaciones where id = ${id}`);
function sinEscribir(que: string, antes: ReturnType<typeof foto>, id: number) {
  assert.deepEqual(foto(), antes, `${que}: no se creó contrato, comisión, CxP ni número`);
  assert.equal(estadoCot(id), "abierta", `${que}: la cotización sigue abierta`);
}
type VentaDb = {
  numero_contrato: string; canal: string; tipo_asesor: string; modo_compra: string | null; comision_b2b: number | null; comision_estado: string | null;
  precio_venta: number; impuesto: number; aliado_id: number | null; agencia_nombre: string | null; freelance_nombre: string | null; moneda: string; moneda_cobro: string | null;
  trm_cobro: number | null; total_cobro: number | null; asesor: string | null; financiero_estado: string; tenant: string; estado: string; b2b_usuario_id: string | null;
};
const ventaDe = (n: string) => json<VentaDb>(`select row_to_json(t)::text from (select numero_contrato, canal, tipo_asesor, modo_compra, comision_b2b, comision_estado, precio_venta, impuesto, aliado_id, agencia_nombre, freelance_nombre, moneda, moneda_cobro, trm_cobro, total_cobro, asesor, financiero_estado, tenant, estado, b2b_usuario_id from public.ventas where numero_contrato = ${lit(n)}) t`);
type ComisionDb = { id: number; numero_contrato: string; aliado_id: number | null; aliado: string; tipo_aliado: string | null; precio_venta: number; base_comision: number; pct_comision: number; estado: string; descontada_en_precio: boolean; tenant: string; nit: string | null; aplica_retencion: boolean; pct_retencion: number; recobro_total: number; pct_recobro_aliado: number; base_explicita: boolean; comision_valor: number | null };
const comisionesDe = (n: string) => json<ComisionDb[]>(`select coalesce(json_agg(row_to_json(t) order by id), '[]'::json)::text from (select id, numero_contrato, aliado_id, aliado, tipo_aliado, precio_venta, base_comision, pct_comision, estado, descontada_en_precio, tenant, nit, aplica_retencion, pct_retencion, recobro_total, pct_recobro_aliado, base_explicita, comision_valor from public.aliados_b2b where numero_contrato = ${lit(n)}) t`);
const cxpDe = (n: string) => sql(`select string_agg(servicio || '|' || tipo_proveedor || '|' || valor_total || '|' || moneda, ';' order by id) from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`);
const asientoDe = (cuentaId: number) => sql(`select coalesce(sum(l.debe), 0) || '/' || coalesce(sum(l.haber), 0) from public.asientos_contables a join public.asiento_lineas l on l.asiento_id = a.id where a.origen = 'cxp' and a.referencia = 'cxp:${cuentaId}'`);
const cxpIds = (n: string) => sql(`select string_agg(id::text, ',' order by id) from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`).split(",").filter(Boolean).map(Number);
const num = (v: unknown) => Number(v);

async function cotizarOk(sesion: string, o: Parameters<typeof cotizar>[1]): Promise<{ id: number; plan: PlanB2B | null }> {
  const r = await cotizar(sesion, o);
  assert.equal(r.ok, true, r.error);
  return { id: r.cotizacion!.id, plan: r.b2bAsistido ?? null };
}

// ═════════════════════════════════════════════════════════════════════════
describe("102 · migración 238 y catálogo", () => {
  test("M1 aliados.activo existe, es boolean NOT NULL con default true y los aliados nuevos nacen activos", () => {
    assert.deepEqual(fila("select data_type, is_nullable, column_default from information_schema.columns where table_name = 'aliados' and column_name = 'activo'"), ["boolean", "NO", "true"]);
    const id = Number(sql("insert into public.aliados (nombre, tipo) values ('Aliado por defecto 102', 'agencia') returning id"));
    assert.equal(sql(`select activo from public.aliados where id = ${id}`), "t");
  });

  test("M2 el postcheck integral (UNA consulta) sale todo OK con la 238 aplicada", () => {
    const salida = execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-F", "|"],
      { input: leerArchivo("supabase/scripts/postcheck_238_cotizacion_asistida_b2b.sql"), encoding: "utf8" });
    assert.ok(!/\|REVISAR\s*$/m.test(salida), salida);
    assert.match(salida, /columna_aliados_activo_existe\|true\|true\|OK/);
  });

  test("M3 el selector del checkout: el personal ve solo aliados ACTIVOS de tipo agencia/freelance con su % y de dónde sale; los demás roles, nada", async () => {
    uidSesion = U.VENTA;
    const ctx = (await getContextoAsistenciaB2B()) as { puede: boolean; aliados?: { id: number; nombre: string; tipo: string; pct: number; pctOrigen: string }[] };
    assert.equal(ctx.puede, true);
    const porId = new Map(ctx.aliados!.map((a) => [a.id, a]));
    assert.deepEqual(porId.get(A.AG10), { id: A.AG10, nombre: ALIADOS_NOMBRE[A.AG10], tipo: "agencia", pct: 0.1, pctOrigen: "aliado" });
    assert.deepEqual(porId.get(A.FL_GENERAL), { id: A.FL_GENERAL, nombre: ALIADOS_NOMBRE[A.FL_GENERAL], tipo: "freelance", pct: 0.11, pctOrigen: "general" });
    assert.deepEqual(porId.get(A.AG0), { id: A.AG0, nombre: ALIADOS_NOMBRE[A.AG0], tipo: "agencia", pct: 0, pctOrigen: "aliado" });
    assert.equal(porId.get(A.AG_GENERAL)?.pct, 0.12);
    assert.equal(porId.has(A.INACTIVO), false, "el inactivo no se ofrece");
    assert.equal(porId.has(A.OTRO), false, "un tipo distinto de agencia/freelance no se ofrece");
    for (const u of [U.CTRL, U.AGENCIA, U.MINORISTA, U.INACTIVO]) {
      uidSesion = u;
      assert.deepEqual(await getContextoAsistenciaB2B(), { puede: false }, SESIONES[u].rol);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("102 · crear la cotización: se congela el plan y el servidor decide", () => {
  test("A1 venta cotiza PVP con comisión (agencia 10 %): se congelan PVP, impuesto, base, %, comisión y total exigible; el autor interno y el aliado van por separado", async () => {
    const { id, plan } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable") });
    assert.ok(plan);
    assert.deepEqual(
      { pvp: plan.pvp, impuesto: plan.impuesto, base: plan.base, pct: plan.pct, origen: plan.pct_origen, comision: plan.comision, estado: plan.comision_estado, total: plan.total_exigible, modo: plan.modo_compra, tipo: plan.tipo_asesor, aliado: plan.aliado_id },
      { pvp: 1_000_000, impuesto: 200_000, base: 800_000, pct: 0.1, origen: "aliado", comision: 80_000, estado: "pendiente", total: 1_000_000, modo: "comisionable", tipo: "agencia", aliado: A.AG10 });
    const guardado = leerPlanB2BDePayload(payloadCot(id));
    assert.ok(guardado.ok && guardado.plan, "el plan quedó guardado y se relee íntegro");
    assert.deepEqual(guardado.plan, plan);
    assert.equal(guardado.plan!.asistido_por.id, U.VENTA, "el autor interno queda sellado en el plan");
    assert.equal(guardado.plan!.asistido_por.rol, "venta");
    const [tenant, tipo, estado, autor, aliadoCol, precio] = fila(`select tenant, tipo, estado, coalesce(creado_por_id::text, '-'), coalesce(aliado_id::text, '-'), precio_venta from public.cotizaciones where id = ${id}`);
    assert.deepEqual([tenant, tipo, estado, Number(precio)], ["mayorista", "carrito", "abierta", 1_000_000]);
    assert.equal(autor, U.VENTA, "creado_por_id = el empleado que asistió");
    assert.equal(aliadoCol, "-", "el beneficiario NO se escribe como dueño de la cotización: vive en el plan congelado");
  });

  test("A2 NETO con freelance y porcentaje GENERAL: lo exigible es PVP − comisión y el documento externo recibe SOLO el total exigible", async () => {
    const { id, plan } = await cotizarOk(U.GERENCIA, { asistencia: b2b(A.FL_GENERAL, "neta") });
    assert.ok(plan);
    assert.deepEqual({ pct: plan.pct, origen: plan.pct_origen, comision: plan.comision, estado: plan.comision_estado, total: plan.total_exigible, tipo: plan.tipo_asesor }, { pct: 0.11, origen: "general", comision: 88_000, estado: "descontada", total: 912_000, tipo: "freelance" });
    const d = detalleCot(id);
    assert.deepEqual(d.b2bExterno, { netoTotalExigible: 912_000 });
    const texto = JSON.stringify(d);
    assert.doesNotMatch(texto, /comision|Comisi|pct|porcentaje|b2bAsistido|Lucía Gómez/i, "el detalle (lo que ve el comprador) no lleva comisión, porcentaje ni aliado");
    assert.equal(num(sql(`select precio_venta from public.cotizaciones where id = ${id}`)), 1_000_000, "el PVP de la cotización no se toca; el exigible es el del plan");
  });

  test("A3 PVP con comisión: el detalle externo es el de siempre (sin dato B2B)", async () => {
    const { id } = await cotizarOk(U.OPERACIONES, { asistencia: b2b(A.AG10, "comisionable") });
    assert.equal(detalleCot(id).b2bExterno, undefined);
  });

  test("A4 porcentaje 0 EXPLÍCITO del aliado: comisión 0 y en NETO se cobra el PVP completo", async () => {
    for (const modo of ["comisionable", "neta"] as const) {
      const { plan } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG0, modo) });
      assert.deepEqual({ pct: plan!.pct, origen: plan!.pct_origen, comision: plan!.comision, total: plan!.total_exigible }, { pct: 0, origen: "aliado", comision: 0, total: 1_000_000 }, modo);
    }
  });

  test("A5 base 0 (el impuesto cubre todo el PVP): comisión 0, total exigible = PVP, nunca negativo", async () => {
    for (const modo of ["comisionable", "neta"] as const) {
      const { plan } = await cotizarOk(U.VENTA, { hoteles: [10204], asistencia: b2b(A.AG10, modo) });
      assert.deepEqual({ pvp: plan!.pvp, impuesto: plan!.impuesto, base: plan!.base, comision: plan!.comision, total: plan!.total_exigible }, { pvp: 500_000, impuesto: 500_000, base: 0, comision: 0, total: 500_000 }, modo);
    }
  });

  test("A6 USD: el plan queda en dólares (moneda de la cotización) con la comisión redondeada como la base de datos", async () => {
    const { plan } = await cotizarOk(U.VENTA, { hoteles: [10203], paqueteId: 10202, asistencia: b2b(A.AG10, "neta") });
    // PVP USD 300 · impuesto 30 → base 270 → 10 % = 27 → exigible 273
    assert.deepEqual({ moneda: plan!.moneda, pvp: plan!.pvp, impuesto: plan!.impuesto, base: plan!.base, comision: plan!.comision, total: plan!.total_exigible }, { moneda: "USD", pvp: 300, impuesto: 30, base: 270, comision: 27, total: 273 });
  });

  test("A7 sin asistencia (o canal b2c): cotización B2C de siempre, sin plan ni dato externo", async () => {
    for (const asistencia of [undefined, { canal: "b2c" }] as const) {
      const { id, plan } = await cotizarOk(U.VENTA, { asistencia });
      assert.equal(plan, null);
      assert.equal(payloadCot(id).b2bAsistido, undefined);
      assert.equal(detalleCot(id).b2bExterno, undefined);
    }
  });

  test("A8 el navegador solo elige: porcentaje, base, comisión, total o tipo enviados NO cambian nada", async () => {
    const { plan } = await cotizarOk(U.VENTA, {
      asistencia: { canal: "b2b", aliadoId: A.AG10, modo: "neta", pct: 0.99, pctComision: 0.99, base: 1, comision: 1, total: 1, totalExigible: 1, tipoAsesor: "freelance", tipo_asesor: "freelance" },
      extra: { pctComision: 0.99, tipoAsesor: "freelance", comision: 1 },
    });
    assert.deepEqual({ pct: plan!.pct, comision: plan!.comision, total: plan!.total_exigible, tipo: plan!.tipo_asesor }, { pct: 0.1, comision: 80_000, total: 920_000, tipo: "agencia" });
  });

  test("A9 rechazos ANTES de crear nada: aliado inactivo / inexistente / de otro tipo, modalidad o aliado inválidos", async () => {
    const antes = totalCotizaciones();
    const casos: [string, Asistencia, RegExp][] = [
      ["aliado inactivo", b2b(A.INACTIVO, "neta"), /inactivo/],
      ["aliado inexistente", b2b(99999, "neta"), /no existe/],
      ["aliado de tipo distinto", b2b(A.OTRO, "neta"), /no es una agencia ni un freelance/],
      ["modalidad inválida", { canal: "b2b", aliadoId: A.AG10, modo: "NETO" }, /modalidad/],
      ["sin aliado", { canal: "b2b", modo: "neta" }, /Elige el aliado/],
      ["aliado como texto", { canal: "b2b", aliadoId: "10201", modo: "neta" }, /Elige el aliado/],
      ["canal desconocido", { canal: "agencia", aliadoId: A.AG10, modo: "neta" }, /cliente final \(B2C\) o para un aliado/],
    ];
    for (const [nombre, asistencia, esperado] of casos) {
      const r = await cotizar(U.VENTA, { asistencia });
      assert.equal(r.ok, false, nombre);
      assert.match(r.error ?? "", esperado, nombre);
    }
    assert.equal(totalCotizaciones(), antes, "ninguna de las cotizaciones rechazadas dejó una fila");
  });

  test("A10 quién NO puede asistir: control_vuelo, un aliado logueado (agencia), personal de Minorista y un usuario inactivo — se rechaza, no se ignora", async () => {
    const antes = totalCotizaciones();
    for (const [u, esperado] of [
      [U.CTRL, /Tu rol no puede cotizar/], [U.AGENCIA, /Tu rol no puede cotizar/], [U.MINORISTA, /solo está disponible para el personal de Mayorista/], [U.INACTIVO, /sesión no es válida/],
    ] as const) {
      const r = await cotizar(u, { asistencia: b2b(A.AG10, "neta") });
      assert.equal(r.ok, false, SESIONES[u].rol);
      assert.match(r.error ?? "", esperado, SESIONES[u].rol);
    }
    assert.equal(totalCotizaciones(), antes);
  });

  test("A11 un visitante o un aliado logueado SIN asistencia conserva su flujo de siempre (no queda marcada B2B)", async () => {
    for (const u of [U.CTRL, U.AGENCIA]) {
      const { id, plan } = await cotizarOk(u, {});
      assert.equal(plan, null, SESIONES[u].rol);
      assert.equal(payloadCot(id).b2bAsistido, undefined);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("102 · convertir: el contrato nace B2B y coincide con la cotización", () => {
  test("B1 PVP con comisión: contrato B2B del aliado, comisión PENDIENTE, cobro = PVP, CxP y saldo; la fila de comisión la crea la base", async () => {
    const sid = servicio("Islas del Rosario 102", 100_000, 300_000);
    const { id, plan } = await cotizarOk(U.VENTA, { hoteles: [10201], tours: [tourEntrada(sid, 10201)], asistencia: b2b(A.AG10, "comisionable") });
    // PVP hotel 1.000.000 + servicio 300.000 = 1.300.000 · impuesto 200.000 → base 1.100.000 · 10 % = 110.000
    assert.deepEqual({ pvp: plan!.pvp, base: plan!.base, comision: plan!.comision, total: plan!.total_exigible }, { pvp: 1_300_000, base: 1_100_000, comision: 110_000, total: 1_300_000 });
    const r = await convertir(U.VENTA, id, 1, { monedaCobro: "COP" }, "todo", 1);
    assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    const v = ventaDe(n);
    assert.deepEqual(
      { canal: v.canal, tipo: v.tipo_asesor, modo: v.modo_compra, com: num(v.comision_b2b), estado: v.comision_estado, precio: num(v.precio_venta), imp: num(v.impuesto), aliado: v.aliado_id, agencia: v.agencia_nombre, free: v.freelance_nombre, asesor: v.asesor, tenant: v.tenant, fin: v.financiero_estado, cobro: v.moneda_cobro },
      { canal: "B2B", tipo: "agencia", modo: "comisionable", com: 110_000, estado: "pendiente", precio: 1_300_000, imp: 200_000, aliado: A.AG10, agencia: ALIADOS_NOMBRE[A.AG10], free: null, asesor: SESIONES[U.VENTA].nombre, tenant: "mayorista", fin: "completo", cobro: "COP" });
    assert.equal(v.total_cobro, null, "sin conversión de moneda no hay total convertido");
    assert.equal(v.b2b_usuario_id, null, "el empleado que asiste no se hace pasar por el aliado");
    const [c] = comisionesDe(n);
    assert.equal(comisionesDe(n).length, 1);
    assert.deepEqual(
      { aliado: c.aliado_id, nombre: c.aliado, tipo: c.tipo_aliado, bruto: num(c.precio_venta), base: num(c.base_comision), pct: num(c.pct_comision), estado: c.estado, desc: c.descontada_en_precio, tenant: c.tenant },
      { aliado: A.AG10, nombre: ALIADOS_NOMBRE[A.AG10], tipo: "agencia", bruto: 1_300_000, base: 1_100_000, pct: 0.1, estado: "pendiente", desc: false, tenant: "mayorista" });
    // Coincide con la cotización congelada.
    assert.equal(num(v.comision_b2b), plan!.comision);
    assert.equal(num(v.precio_venta), plan!.total_exigible);
    assert.equal(estadoCot(id), "convertida");
    // CxP: hotel (300.000 × 2) y servicio (100.000 × 2) — independientes de la comisión.
    assert.equal(cxpDe(n), "Hotel Hotel Aurora 102|hotel|600000.00|COP;Islas del Rosario 102|receptivo|200000.00|COP");
    for (const cid of cxpIds(n)) {
      const [debe, haber] = asientoDe(cid).split("/").map(Number);
      assert.ok(debe > 0 && debe === haber, `devengo de la CxP ${cid} cuadrado: ${debe}/${haber}`);
    }
    // Cobro/saldo: nada abonado ⇒ el saldo es lo exigible.
    assert.equal(num(sql(`select coalesce(sum(valor_abono), 0) from public.abonos where numero_contrato = ${lit(n)}`)), 0);
    assert.equal(await netoTotalExigibleDeContrato(n), null, "no es NETO: el documento del contrato suma los ítems como siempre");
  });

  test("B2 NETO: precio_venta = PVP − comisión, comisión DESCONTADA y marcada pagada en el precio; no se puede pagar otra vez ni agregar otra", async () => {
    const { id, plan } = await cotizarOk(U.ADMIN, { asistencia: b2b(A.AG10, "neta") });
    const r = await convertir(U.ADMIN, id, 1);
    assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    const v = ventaDe(n);
    assert.deepEqual({ precio: num(v.precio_venta), com: num(v.comision_b2b), estado: v.comision_estado, modo: v.modo_compra, canal: v.canal }, { precio: 920_000, com: 80_000, estado: "descontada", modo: "neta", canal: "B2B" });
    assert.equal(num(v.precio_venta), plan!.total_exigible);
    const [c] = comisionesDe(n);
    assert.deepEqual({ desc: c.descontada_en_precio, estado: c.estado, bruto: num(c.precio_venta), base: num(c.base_comision) }, { desc: true, estado: "pagada", bruto: 1_000_000, base: 800_000 });
    // Documento del contrato: total exigible y desglose (PVP original − descuento = total).
    assert.equal(await netoTotalExigibleDeContrato(n), 920_000);
    assert.deepEqual(desgloseNetoB2B({ precio_venta: v.precio_venta, impuesto: v.impuesto, comision_b2b: v.comision_b2b, comision_estado: v.comision_estado }), { pvpOriginal: 1_000_000, descuentoComision: 80_000, totalExigible: 920_000 });
    // Sin doble pago: la comisión ya está en el precio.
    const intentoPago = sqlFalla(`insert into public.comision_b2b_pagos (aliado_b2b_id, valor) values (${c.id}, 80000)`);
    assert.match(intentoPago, /se descontó del precio de venta \(modo neta\): no admite abonos/);
    const segunda = sqlFalla(`insert into public.aliados_b2b (numero_contrato, tenant, aliado, tipo_aliado, aliado_id, precio_venta, base_comision, pct_comision, estado)
                              values (${lit(n)}, 'mayorista', 'Otra', 'agencia', ${A.AG10}, 1000000, 800000, 0.1, 'pendiente')`);
    assert.match(segunda, /se vendió en modo neta: la comisión B2B ya se descontó del precio/);
    assert.equal(comisionesDe(n).length, 1);
    assert.equal(num(sql(`select count(*) from public.comision_b2b_pagos where aliado_b2b_id = ${c.id}`)), 0, "ningún pago quedó registrado");
  });

  test("B3 porcentaje 0 explícito y base 0: el contrato nace B2B con comisión 0 y cobra el PVP completo, también en NETO", async () => {
    for (const [hoteles, aliado, esperadoPrecio] of [[[10201], A.AG0, 1_000_000], [[10204], A.AG10, 500_000]] as const) {
      const { id } = await cotizarOk(U.VENTA, { hoteles: [...hoteles], asistencia: b2b(aliado, "neta") });
      const r = await convertir(U.VENTA, id, 1);
      assert.equal(r.ok, true, r.error);
      const v = ventaDe(r.numeros![0]);
      assert.deepEqual({ precio: num(v.precio_venta), com: num(v.comision_b2b), estado: v.comision_estado, canal: v.canal }, { precio: esperadoPrecio, com: 0, estado: "descontada", canal: "B2B" });
      const [c] = comisionesDe(r.numeros![0]);
      assert.equal(num(c.pct_comision), aliado === A.AG0 ? 0 : 0.1);
    }
  });

  test("B4 freelance con porcentaje general: el contrato queda como freelance (nombre del aliado en freelance_nombre)", async () => {
    const { id } = await cotizarOk(U.GERENCIA, { asistencia: b2b(A.FL_GENERAL, "comisionable") });
    const r = await convertir(U.GERENCIA, id, 1);
    assert.equal(r.ok, true, r.error);
    const v = ventaDe(r.numeros![0]);
    assert.deepEqual({ tipo: v.tipo_asesor, free: v.freelance_nombre, agencia: v.agencia_nombre, com: num(v.comision_b2b) }, { tipo: "freelance", free: ALIADOS_NOMBRE[A.FL_GENERAL], agencia: null, com: 88_000 });
    assert.equal(num(comisionesDe(r.numeros![0])[0].pct_comision), 0.11);
  });

  test("B5 USD con moneda de COBRO COP: el total a cobrar sale del EXIGIBLE (NETO), no del PVP; la TRM queda congelada", async () => {
    const { id, plan } = await cotizarOk(U.VENTA, { hoteles: [10203], paqueteId: 10202, asistencia: b2b(A.AG10, "neta") });
    const r = await convertir(U.VENTA, id, 1, { monedaCobro: "COP", trmCobro: 4100, trmCosto: 3900 });
    assert.equal(r.ok, true, r.error);
    const v = ventaDe(r.numeros![0]);
    assert.deepEqual({ moneda: v.moneda, precio: num(v.precio_venta), com: num(v.comision_b2b), mc: v.moneda_cobro, trm: num(v.trm_cobro) }, { moneda: "USD", precio: 273, com: 27, mc: "COP", trm: 4100 });
    const esperado = cobroDeContratoCarrito({ precioVenta: plan!.total_exigible, monedaContrato: "USD", eleccion: { monedaCobro: "COP", trmCobro: 4100 } });
    assert.ok(esperado.ok);
    assert.equal(num(v.total_cobro), esperado.ok ? esperado.cobro.total_cobro : -1, "273 USD × 4.100, redondeado como el resto del carrito");
    assert.ok(num(v.total_cobro) < 300 * 4100, "no se cobra sobre el PVP completo");
    assert.equal(cxpDe(r.numeros![0]), "Hotel Hotel Dubái 102|hotel|200.00|USD");
  });

  test("B6 «1 contrato por destino»: dos contratos B2B del mismo aliado, cada uno con SU comisión; suman la cotización", async () => {
    const sid = servicio("Tour Cartagena 102", 100_000, 300_000);
    const { id, plan } = await cotizarOk(U.VENTA, { hoteles: [10201, 10202], tours: [tourEntrada(sid, 10201)], asistencia: b2b(A.AG10, "neta") });
    // Cartagena: PVP 1.300.000 · imp 200.000 → comisión 110.000 · exigible 1.190.000 · Santa Marta: PVP 600.000 · imp 100.000 → 50.000 · 550.000
    assert.deepEqual({ pvp: plan!.pvp, comision: plan!.comision, total: plan!.total_exigible }, { pvp: 1_900_000, comision: 160_000, total: 1_740_000 });
    const r = await convertir(U.VENTA, id, 2, { monedaCobro: "COP" }, "por_destino", 1);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.numeros!.length, 2);
    const ventas = r.numeros!.map(ventaDe);
    assert.deepEqual(ventas.map((v) => [v.canal, v.aliado_id, v.modo_compra, num(v.precio_venta), num(v.comision_b2b), v.comision_estado]), [
      ["B2B", A.AG10, "neta", 1_190_000, 110_000, "descontada"], ["B2B", A.AG10, "neta", 550_000, 50_000, "descontada"],
    ]);
    assert.equal(ventas.reduce((s, v) => s + num(v.precio_venta), 0), plan!.total_exigible);
    assert.equal(ventas.reduce((s, v) => s + num(v.comision_b2b), 0), plan!.comision);
    for (const n of r.numeros!) assert.equal(comisionesDe(n).length, 1, `una comisión por contrato (${n})`);
  });

  test("B7 reintento y doble ejecución secuencial sobre la cotización ya convertida: los mismos números, sin contratos ni comisiones nuevos", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable") });
    const r1 = await convertir(U.VENTA, id, 1);
    assert.equal(r1.ok, true, r1.error);
    const antes = foto();
    for (let i = 0; i < 2; i++) {
      const r = await convertir(U.VENTA, id, 1);
      assert.equal(r.ok, true, r.error);
      assert.deepEqual(r.numeros, r1.numeros);
    }
    assert.deepEqual(foto(), antes);
    assert.equal(comisionesDe(r1.numeros![0]).length, 1);
  });

  test("B8 un reintento tras un cambio POSTERIOR en el aliado no toca contratos ya creados: devuelve los mismos números", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable") });
    const r1 = await convertir(U.VENTA, id, 1);
    assert.equal(r1.ok, true, r1.error);
    sql(`update public.aliados set pct_comision = 0.2 where id = ${A.AG10}`);
    try {
      const antes = foto();
      const r2 = await convertir(U.VENTA, id, 1);
      assert.equal(r2.ok, true, r2.error);
      assert.deepEqual(r2.numeros, r1.numeros);
      assert.deepEqual(foto(), antes);
    } finally {
      sql(`update public.aliados set pct_comision = 0.10 where id = ${A.AG10}`);
    }
  });

  test("B9 una cotización B2C no cambia: contrato B2C / interno, sin aliado, sin comisión B2B", async () => {
    const { id } = await cotizarOk(U.VENTA, {});
    const r = await convertir(U.VENTA, id, 1);
    assert.equal(r.ok, true, r.error);
    const v = ventaDe(r.numeros![0]);
    assert.deepEqual({ canal: v.canal, tipo: v.tipo_asesor, aliado: v.aliado_id, modo: v.modo_compra, com: v.comision_b2b, estado: v.comision_estado, precio: num(v.precio_venta), imp: num(v.impuesto) },
      { canal: "B2C", tipo: "interno", aliado: null, modo: null, com: null, estado: null, precio: 1_000_000, imp: 0 });
    assert.equal(comisionesDe(r.numeros![0]).length, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("102 · convertir: se rechaza ANTES de numerar si algo cambió", () => {
  test("C1 cambió el PORCENTAJE del aliado después de cotizar (incluido a 0): ni número, ni contrato, ni comisión; con el porcentaje original la MISMA cotización convierte", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "neta") });
    const antes = foto();
    for (const nuevo of ["0.12", "0", "null"]) {
      sql(`update public.aliados set pct_comision = ${nuevo} where id = ${A.AG10}`);
      const r = await convertir(U.VENTA, id, 1);
      assert.equal(r.ok, false, nuevo);
      assert.equal(r.error, MENSAJE_TERMINOS_CAMBIARON, nuevo);
      sinEscribir(`pct=${nuevo}`, antes, id);
    }
    sql(`update public.aliados set pct_comision = 0.10 where id = ${A.AG10}`);
    const ok = await convertir(U.VENTA, id, 1);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(num(ventaDe(ok.numeros![0]).comision_b2b), 80_000, "con el porcentaje congelado");
  });

  test("C2 cambió el PARÁMETRO general de un aliado sin porcentaje propio: se rechaza igual", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG_GENERAL, "comisionable") });
    const antes = foto();
    sql("update public.parametros_tributarios set valor = 0.15 where parametro = 'COMISION_AGENCIA'");
    try {
      const r = await convertir(U.VENTA, id, 1);
      assert.equal(r.ok, false);
      assert.equal(r.error, MENSAJE_TERMINOS_CAMBIARON);
      sinEscribir("parámetro general", antes, id);
    } finally {
      sql("update public.parametros_tributarios set valor = 0.12 where parametro = 'COMISION_AGENCIA'");
    }
    const ok = await convertir(U.VENTA, id, 1);
    assert.equal(ok.ok, true, ok.error);
  });

  test("C3 cambió el IMPUESTO o el PRECIO de una unidad: se rechaza antes de numerar (no se recalcula la comisión en silencio)", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "neta") });
    const antes = foto();
    HOTELES[10201].impuesto = 150_000;
    let r = await convertir(U.VENTA, id, 1);
    assert.equal(r.ok, false);
    assert.equal(r.error, MENSAJE_TERMINOS_CAMBIARON);
    sinEscribir("impuesto", antes, id);
    HOTELES[10201].impuesto = 200_000;
    HOTELES[10201].pvp = 520_000;
    r = await convertir(U.VENTA, id, 1);
    assert.equal(r.ok, false);
    assert.equal(r.error, MENSAJE_TERMINOS_CAMBIARON);
    sinEscribir("precio", antes, id);
    HOTELES[10201].pvp = 500_000;
    const ok = await convertir(U.VENTA, id, 1);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(num(ventaDe(ok.numeros![0]).precio_venta), 920_000);
  });

  test("C4 el aliado se desactivó o cambió de tipo: se rechaza; reactivado, convierte", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable") });
    const antes = foto();
    sql(`update public.aliados set activo = false where id = ${A.AG10}`);
    let r = await convertir(U.VENTA, id, 1);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /inactivo/);
    sinEscribir("aliado inactivo", antes, id);
    sql(`update public.aliados set activo = true, tipo = 'freelance' where id = ${A.AG10}`);
    r = await convertir(U.VENTA, id, 1);
    assert.equal(r.ok, false);
    assert.equal(r.error, MENSAJE_TERMINOS_CAMBIARON);
    sinEscribir("aliado de otro tipo", antes, id);
    sql(`update public.aliados set tipo = 'agencia' where id = ${A.AG10}`);
    const ok = await convertir(U.VENTA, id, 1);
    assert.equal(ok.ok, true, ok.error);
  });

  test("C5 un plan congelado manipulado (comisión, total o modalidad alterados) jamás se convierte — ni como B2C", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "neta") });
    const antes = foto();
    const original = sql(`select payload::text from public.cotizaciones where id = ${id}`);
    for (const parche of [
      `jsonb_set(payload, '{b2bAsistido,comision}', '1')`,
      `jsonb_set(payload, '{b2bAsistido,total_exigible}', '1000000')`,
      `jsonb_set(payload, '{b2bAsistido,modo_compra}', '"comisionable"')`,
      `jsonb_set(payload, '{b2bAsistido,pct}', '0.5')`,
      `jsonb_set(payload, '{b2bAsistido,aliado_id}', '0')`,
      `jsonb_set(payload, '{b2bAsistido}', '"texto"')`,
    ]) {
      sinFrontera(`update public.cotizaciones set payload = ${parche} where id = ${id}`);
      const r = await convertir(U.VENTA, id, 1);
      assert.equal(r.ok, false, parche);
      assert.match(r.error ?? "", /incompletos o no son consistentes/, parche);
      sinEscribir(parche, antes, id);
      sinFrontera(`update public.cotizaciones set payload = ${lit(original)}::jsonb where id = ${id}`);
    }
    const ok = await convertir(U.VENTA, id, 1);
    assert.equal(ok.ok, true, ok.error);
  });

  test("C6 convierte quien NO puede: control_vuelo, un aliado logueado, personal de Minorista o un usuario inactivo — nada se crea ni se devuelve", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable") });
    const antes = foto();
    for (const u of [U.CTRL, U.AGENCIA, U.MINORISTA, U.INACTIVO]) {
      const r = await convertir(u, id, 1);
      assert.equal(r.ok, false, SESIONES[u].rol);
      sinEscribir(SESIONES[u].rol, antes, id);
    }
  });

  test("C7 el aliado no se puede cambiar convirtiendo: el contrato es del aliado congelado aunque el navegador mande otro dato", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable") });
    uidSesion = U.VENTA;
    const r = (await convertirCotizacionCarrito(id, {
      agrupar: "todo", pasajeros: PASAJEROS, asesorInterno: SESIONES[U.VENTA].nombre, asignaciones: [[1, 2]], asignacionesTours: [], monedaCobro: "COP",
      // Datos que un navegador manipulado intentaría colar (la firma no los acepta y la conversión no los lee).
      aliadoId: A.FL_GENERAL, tipoAsesor: "freelance", modoCompra: "neta", pctComision: 0.9,
    } as never)) as RespConvertir;
    assert.equal(r.ok, true, r.error);
    const v = ventaDe(r.numeros![0]);
    assert.deepEqual({ aliado: v.aliado_id, tipo: v.tipo_asesor, modo: v.modo_compra, com: num(v.comision_b2b) }, { aliado: A.AG10, tipo: "agencia", modo: "comisionable", com: 80_000 });
  });

  test("C8 si la base rechaza la comisión, el contrato se REVIERTE completo (nunca un contrato B2B sin comisión) y un reintento posterior convierte", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "neta") });
    const antes = foto();
    sql(`
      create or replace function public.t102_falla_comision() returns trigger language plpgsql as $f$
      begin raise exception 'falla simulada 102 al registrar la comisión'; end $f$;
      create trigger t102_falla_comision before insert on public.aliados_b2b for each row execute function public.t102_falla_comision();
    `);
    const r = await convertir(U.VENTA, id, 1);
    sql("drop trigger if exists t102_falla_comision on public.aliados_b2b");
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /falla simulada 102/);
    assert.equal(totalVentas(), antes.ventas, "el contrato creado a medias se revirtió");
    assert.equal(totalComisiones(), antes.comisiones);
    assert.equal(totalCxp(), antes.cxp);
    assert.equal(estadoCot(id), "abierta");
    const ok = await convertir(U.VENTA, id, 1);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(comisionesDe(ok.numeros![0]).length, 1);
  });

  test("C9 «por destino» con un fallo a mitad: el 1.er contrato B2B queda completo; el reintento (mismo plan) completa SOLO el 2.º sin duplicar comisiones", async () => {
    const { id } = await cotizarOk(U.VENTA, { hoteles: [10201, 10202], asistencia: b2b(A.AG10, "comisionable") });
    sql(`
      create or replace function public.t102_falla_segunda() returns trigger language plpgsql as $f$
      begin
        if NEW.precio_venta = 600000 then raise exception 'falla simulada 102 segunda comisión'; end if;
        return NEW;
      end $f$;
      create trigger t102_falla_comision before insert on public.aliados_b2b for each row execute function public.t102_falla_segunda();
    `);
    const r1 = await convertir(U.VENTA, id, 2, { monedaCobro: "COP" }, "por_destino");
    sql("drop trigger if exists t102_falla_comision on public.aliados_b2b");
    assert.equal(r1.ok, false);
    assert.match(r1.error ?? "", /sí quedaron completos/);
    const primero = (detalleCot(id) as { contratos?: string[] }).contratos![0];
    assert.equal(comisionesDe(primero).length, 1);
    const ok = await convertir(U.VENTA, id, 2, { monedaCobro: "COP" }, "por_destino");
    assert.equal(ok.ok, true, ok.error);
    assert.equal(ok.numeros!.length, 2);
    assert.equal(ok.numeros![0], primero);
    assert.equal(comisionesDe(primero).length, 1, "la comisión del primero no se duplicó");
    assert.equal(comisionesDe(ok.numeros![1]).length, 1);
    assert.equal(num(ventaDe(ok.numeros![1]).comision_b2b), 50_000);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("102 · portal, pagos de comisión y no duplicidad", () => {
  test("D1 el portal del aliado ve SU comisión del contrato asistido: PVP con comisión = pendiente y cobrable; NETO = descontada, no cobrable", async () => {
    const sid = servicio("Tour D1 102", 100_000, 300_000);
    const { id: idPvp } = await cotizarOk(U.VENTA, { hoteles: [10201], tours: [tourEntrada(sid, 10201)], asistencia: b2b(A.AG10, "comisionable") });
    const { id: idNeto } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "neta") });
    const nPvp = (await convertir(U.VENTA, idPvp, 1, { monedaCobro: "COP" }, "todo", 1)).numeros![0];
    const nNeto = (await convertir(U.VENTA, idNeto, 1)).numeros![0];
    const usuarioAliado = { aliadoId: A.AG10, ...evidenciaSinFicha({ via: "aliado_id", documentoFicha: null, nombreUsuario: null }) };
    const filaPortal = (n: string) => ({ filas: comisionesDe(n), venta: ventaDe(n) });
    const pvp = filaPortal(nPvp);
    const vPvp = comisionVisibleAliado(pvp.filas, { aliado_id: pvp.venta.aliado_id, tipo_asesor: pvp.venta.tipo_asesor, modo_compra: pvp.venta.modo_compra, comision_b2b: pvp.venta.comision_b2b, comision_estado: pvp.venta.comision_estado }, usuarioAliado);
    assert.deepEqual({ total: vPvp.total, fuente: vPvp.fuente, tipo: vPvp.tipo, cobrable: vPvp.cobrable }, { total: 110_000, fuente: "filas", tipo: "agencia", cobrable: true });
    const neto = filaPortal(nNeto);
    const vNeto = comisionVisibleAliado(neto.filas, { aliado_id: neto.venta.aliado_id, tipo_asesor: neto.venta.tipo_asesor, modo_compra: neto.venta.modo_compra, comision_b2b: neto.venta.comision_b2b, comision_estado: neto.venta.comision_estado }, usuarioAliado);
    assert.deepEqual({ total: vNeto.total, fuente: vNeto.fuente, cobrable: vNeto.cobrable }, { total: 80_000, fuente: "descontada", cobrable: false });
    // Listado REAL del portal B2B (misma función que la página): el aliado vinculado a su ficha ve SUS dos contratos asistidos; otro aliado, ninguno.
    const admin = clienteLocal(TOKEN_SERVICIO);
    const columnas = "numero_contrato, tenant, aliado_id, b2b_usuario_id, agencia_nombre, freelance_nombre, fecha_salida";
    const consultas = {
      porB2bUsuario: async (usuarioId: string) => ((await admin.from("ventas").select(columnas).eq("b2b_usuario_id", usuarioId)).data ?? []),
      porAliadoId: async (aliadoId: number) => ((await admin.from("ventas").select(columnas).eq("aliado_id", aliadoId)).data ?? []),
      porNombreSinIds: async () => ({ completa: true, filas: [] }),
      verificarFichas: async () => ({ completa: true as const, conFicha: new Set<string>() }),
    };
    const perfilAliado = (id: string, nombre: string, aliadoId: number | null) => ({ id, rol: "agencia", tenant: "mayorista", activo: true, nombre, aliadoId, accesoLegacyNombre: false });
    const propio = await contratosDelPortalB2B(perfilAliado(U.AGENCIA, "Usuario 102 agencia", A.AG10), consultas);
    const verPropios = propio.contratos.map((c) => c.numero_contrato);
    assert.ok(verPropios.includes(nPvp) && verPropios.includes(nNeto), `el aliado ve sus contratos asistidos: ${verPropios.join(",")}`);
    const ajeno = await contratosDelPortalB2B(perfilAliado("00000000-0000-0000-0000-0000000fffff", "Lucía Gómez 102", A.FL_GENERAL), consultas);
    assert.equal(ajeno.contratos.some((c) => [nPvp, nNeto].includes(c.numero_contrato)), false, "otro aliado no ve contratos asistidos de este aliado");
  });

  test("D2 PVP con comisión: la comisión admite abonos (a diferencia de NETO) y su estado sale de lo abonado con la regla de siempre", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable") });
    const n = (await convertir(U.VENTA, id, 1)).numeros![0];
    const [c] = comisionesDe(n);
    const total = calcularComisionFila(c).totalPagar;
    assert.equal(total, 80_000);
    const pagado = () => num(sql(`select coalesce(sum(valor), 0) from public.comision_b2b_pagos where aliado_b2b_id = ${c.id}`));
    assert.equal(estadoComisionFila(total, pagado(), false), "pendiente");
    sql(`insert into public.comision_b2b_pagos (aliado_b2b_id, valor) values (${c.id}, 30000)`);
    assert.equal(estadoComisionFila(total, pagado(), false), "parcial");
    sql(`insert into public.comision_b2b_pagos (aliado_b2b_id, valor) values (${c.id}, 50000)`);
    assert.equal(pagado(), 80_000);
    assert.equal(estadoComisionFila(total, pagado(), false), "pagada");
  });

  test("D3 el cambio de estado de la cotización y de los contratos es consistente: una cotización B2B abierta no aparece como contrato hasta convertir", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable") });
    assert.equal(estadoCot(id), "abierta");
    assert.equal(sql(`select count(*) from public.ventas where cliente = 'Ana Pérez' and aliado_id = ${A.AG10} and numero_contrato in (select jsonb_array_elements_text(coalesce(detalle->'contratos', '[]'::jsonb)) from public.cotizaciones where id = ${id})`), "0");
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("102 · doble clic simultáneo", () => {
  test("E1 dos conversiones CONCURRENTES de la misma cotización B2B no dejan dos contratos ni dos comisiones", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "neta") });
    const antes = foto();
    const [r1, r2] = await Promise.all([convertir(U.VENTA, id, 1), convertir(U.VENTA, id, 1)]);
    const creados = foto().ventas - antes.ventas;
    const comisiones = foto().comisiones - antes.comisiones;
    assert.ok(creados >= 1, "al menos uno convirtió");
    assert.equal(creados, 1, `exactamente UN contrato (resultados: ${JSON.stringify([r1, r2])})`);
    assert.equal(comisiones, 1, "exactamente UNA comisión");
    assert.equal(estadoCot(id), "convertida");
    // El que pierde la carrera no devuelve un error técnico: o ve la cotización ya convertida (mismos números) o recibe el aviso claro.
    for (const r of [r1, r2]) {
      if (r.ok) assert.equal(r.numeros!.length, 1);
      else assert.match(r.error ?? "", /ya se está convirtiendo \(o ya se convirtió\)/);
    }
    const [n] = (detalleCot(id) as { contratos: string[] }).contratos;
    assert.equal(comisionesDe(n).length, 1);
    assert.equal(sql(`select grupo_conversion || '|' || cotizacion_origen_id from public.ventas where numero_contrato = ${lit(n)}`), `__sin_destino__|${id}`);
  });

  test("E2 el candado vive en la base: dos contratos del mismo grupo de la misma cotización no caben, uno sin marca sí, y la marca va completa o no va", () => {
    const idc = Number(sql("select coalesce(max(id), 0) + 9000 from public.cotizaciones"));
    const base = (n: string, marca: string) => `insert into public.ventas (numero_contrato, tenant, cliente, ${marca}) values ('${n}', 'mayorista', 'Cliente candado 102', `;
    sql(`${base("DTM-9101", "cotizacion_origen_id, grupo_conversion")}${idc}, 'CARTAGENA')`);
    assert.match(sqlFalla(`${base("DTM-9102", "cotizacion_origen_id, grupo_conversion")}${idc}, 'CARTAGENA')`), /ux_ventas_conversion_cotizacion_grupo/, "mismo grupo de la misma cotización");
    sql(`${base("DTM-9103", "cotizacion_origen_id, grupo_conversion")}${idc}, 'SANTA MARTA')`); // otro grupo de la misma cotización: permitido
    sql(`${base("DTM-9104", "cotizacion_origen_id, grupo_conversion")}${idc + 1}, 'CARTAGENA')`); // misma clave, otra cotización: permitido
    sql(`insert into public.ventas (numero_contrato, tenant, cliente) values ('DTM-9105', 'mayorista', 'Sin marca 1'), ('DTM-9106', 'mayorista', 'Sin marca 2')`); // contratos de siempre: sin marca, sin límite
    assert.match(sqlFalla(`insert into public.ventas (numero_contrato, tenant, cliente, cotizacion_origen_id) values ('DTM-9107', 'mayorista', 'Marca a medias', ${idc + 2})`), /ventas_conversion_par_chk/, "la marca va completa o no va");
    // Revertir un contrato libera el par (así lo hace revertir_contrato_incompleto al borrar la fila): el reintento funciona.
    sql("delete from public.ventas where numero_contrato = 'DTM-9101'");
    sql(`${base("DTM-9108", "cotizacion_origen_id, grupo_conversion")}${idc}, 'CARTAGENA')`);
    sql("delete from public.ventas where numero_contrato between 'DTM-9101' and 'DTM-9108'");
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("102 · Bloqueo: cupos, pasajeros y vuelo se conservan con la venta B2B", () => {
  let bloqueoSeq = 10400;
  /** Bloqueo con `n` sillas disponibles (cupos_total = n). Devuelve su id. */
  function bloqueo(n: number): number {
    const id = ++bloqueoSeq;
    sql(`
      insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, vuelo_ida, fecha_ida, vuelo_regreso, fecha_regreso, cupos_total, tarifa_para_empaquetar, fee_infante, proveedor_id, moneda)
        values (${id}, 'L102${id}', 'AVIANCA', 'BOG-CTG', 'AV102', '2030-03-01', 'AV103', '2030-03-04', ${n}, 400000, 0, 10202, 'COP');
      insert into public.sillas (bloqueo_id, numero_silla, estado) select ${id}, g, 'disponible' from generate_series(1, ${n}) g;
    `);
    return id;
  }
  const sillasDe = (id: number) => sql(`select string_agg(estado::text || ':' || coalesce(numero_contrato, '-') || ':' || coalesce(pasajero_nombres, '-'), ',' order by numero_silla) from public.sillas where bloqueo_id = ${id}`).split(",");
  const disponibles = (id: number) => Number(sql(`select cupos_disponibles from public.cupos_por_bloqueo where id = ${id}`));

  test("K1 NETO con Bloqueo: el contrato nace B2B, las 2 sillas se reservan a SU número con los datos de los pasajeros, hay vuelo, CxP aérea y comisión", async () => {
    const bq = bloqueo(4);
    const { id, plan } = await cotizarOk(U.VENTA, { bloqueoId: bq, asistencia: b2b(A.AG10, "neta") });
    assert.equal(plan!.total_exigible, 920_000);
    assert.equal(disponibles(bq), 4, "cotizar no toma cupos");
    const r = await convertir(U.VENTA, id, 1);
    assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    const v = ventaDe(n);
    assert.deepEqual({ canal: v.canal, precio: num(v.precio_venta), com: num(v.comision_b2b), estado: v.comision_estado }, { canal: "B2B", precio: 920_000, com: 80_000, estado: "descontada" });
    assert.equal(disponibles(bq), 2, "se descontaron exactamente 2 cupos");
    const sillas = sillasDe(bq);
    assert.equal(sillas.filter((x) => x.startsWith(`disponible:`)).length, 2);
    const mias = sillas.filter((x) => x.includes(n));
    assert.equal(mias.length, 2, "las dos sillas quedaron a nombre de ESTE contrato");
    assert.ok(mias.some((x) => x.endsWith(":Ana")) && mias.some((x) => x.endsWith(":Luis")), "datos de pasajero copiados al manifiesto del vuelo");
    assert.equal(sql(`select count(*) from public.contrato_vuelos where numero_contrato = ${lit(n)}`), "2", "tramos de ida y regreso");
    assert.equal(sql(`select count(*) from public.contrato_pasajeros where numero_contrato = ${lit(n)}`), "2");
    assert.match(cxpDe(n)!, /Aéreo AVIANCA\|aereo\|800000\.00\|COP/, "CxP aérea: 400.000 × 2 pax con silla");
    assert.equal(comisionesDe(n).length, 1);
  });

  test("K2 si la base rechaza la comisión, las sillas vuelven a quedar disponibles (cupos intactos) y un reintento las toma", async () => {
    const bq = bloqueo(4);
    const { id } = await cotizarOk(U.VENTA, { bloqueoId: bq, asistencia: b2b(A.AG10, "comisionable") });
    sql(`
      create or replace function public.t102_falla_comision() returns trigger language plpgsql as $f$
      begin raise exception 'falla simulada 102 con bloqueo'; end $f$;
      create trigger t102_falla_comision before insert on public.aliados_b2b for each row execute function public.t102_falla_comision();
    `);
    const r = await convertir(U.VENTA, id, 1);
    sql("drop trigger if exists t102_falla_comision on public.aliados_b2b");
    assert.equal(r.ok, false);
    assert.equal(disponibles(bq), 4, "ninguna silla quedó tomada");
    assert.ok(sillasDe(bq).every((x) => x.startsWith("disponible:-:")), sillasDe(bq).join(","));
    assert.equal(estadoCot(id), "abierta");
    const ok = await convertir(U.VENTA, id, 1);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(disponibles(bq), 2);
  });

  test("K3 sin cupos suficientes se rechaza ANTES de numerar y no se toca nada (la guarda de cupos sigue vigente en B2B)", async () => {
    const bq = bloqueo(1);
    const { id } = await cotizarOk(U.VENTA, { bloqueoId: bq, asistencia: b2b(A.AG10, "neta") });
    const antes = foto();
    const r = await convertir(U.VENTA, id, 1);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /No hay cupos suficientes en el bloqueo \(disponibles: 1, requeridos por esta operación: 2\)/);
    sinEscribir("cupos", antes, id);
    assert.equal(disponibles(bq), 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("102 · frontera SQL del plan congelado (payload.b2bAsistido)", () => {
  /** PATCH del payload como lo haría el propio rol comercial con su token (la política «cotizaciones: actualizar» se lo permite). */
  async function parchear(sesion: string, id: number, cambios: Record<string, unknown>) {
    uidSesion = sesion;
    const r = await clienteSesion().from("cotizaciones").update(cambios as never).eq("id", id).select("id");
    return { error: r.error, filas: r.data?.length ?? 0 };
  }
  const sinB2B = (p: Record<string, unknown>) => { const { b2bAsistido: _quitado, ...resto } = p; return resto; };

  test("F1 un UPDATE autorizado no puede BORRAR el bloque: la cotización no se convierte como B2C, y como B2B convierte igual", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "neta") });
    const antes = payloadCot(id);
    for (const sesion of [U.VENTA, U.GERENCIA, U.ADMIN]) {
      const r = await parchear(sesion, id, { payload: sinB2B(antes as Record<string, unknown>) });
      assert.match(r.error?.message ?? "", /B2B_ASISTIDO_INMUTABLE/, SESIONES[sesion].rol);
      assert.equal(r.filas, 0);
    }
    assert.deepEqual(payloadCot(id), antes, "el payload quedó intacto");
    const ok = await convertir(U.VENTA, id, 1);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(ventaDe(ok.numeros![0]).canal, "B2B");
    assert.equal(comisionesDe(ok.numeros![0]).length, 1);
  });

  test("F2 tampoco se puede REESCRIBIR con un bloque coherente (otro % o modalidad): el código lo aceptaría, la base no", async () => {
    const { id, plan } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "neta") });
    const rehecho = { ...plan!, pct: 0, comision: 0, total_exigible: plan!.pvp, modo_compra: "comisionable" as const, comision_estado: "pendiente" as const };
    const lectura = leerPlanB2BDePayload({ b2bAsistido: JSON.parse(JSON.stringify(rehecho)) });
    assert.equal(lectura.ok, true, "el bloque rehecho es coherente consigo mismo: solo la base lo frena");
    const antes = payloadCot(id);
    const r = await parchear(U.VENTA, id, { payload: { ...antes, b2bAsistido: rehecho } });
    assert.match(r.error?.message ?? "", /B2B_ASISTIDO_INMUTABLE/);
    assert.deepEqual(payloadCot(id), antes);
    const r2 = await parchear(U.VENTA, id, { payload: { ...antes, b2bAsistido: "texto" } });
    assert.match(r2.error?.message ?? "", /B2B_ASISTIDO_INMUTABLE/);
    assert.deepEqual(payloadCot(id), antes);
  });

  test("F3 tampoco se puede AGREGAR a una cotización B2C (saltaría la autorización del actor), ni con service_role ni como superusuario", async () => {
    const { id: idB2b, plan } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable") });
    const { id } = await cotizarOk(U.VENTA, {});
    const antes = payloadCot(id);
    assert.equal(antes.b2bAsistido, undefined);
    const r = await parchear(U.VENTA, id, { payload: { ...antes, b2bAsistido: plan } });
    assert.match(r.error?.message ?? "", /B2B_ASISTIDO_INMUTABLE/);
    const admin = await clienteLocal(TOKEN_SERVICIO).from("cotizaciones").update({ payload: { ...antes, b2bAsistido: plan } } as never).eq("id", id);
    assert.match(admin.error?.message ?? "", /B2B_ASISTIDO_INMUTABLE/);
    assert.deepEqual(payloadCot(id), antes);
    assert.match(sqlFalla(`update public.cotizaciones set payload = payload - 'b2bAsistido' where id = ${idB2b}`), /B2B_ASISTIDO_INMUTABLE/);
  });

  test("F4 los cambios operativos legítimos siguen pasando: detalle, estado, vigencia, otras llaves del payload, y reescribir el MISMO bloque", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable") });
    const p = payloadCot(id) as Record<string, unknown>;
    const mismoBloque = JSON.parse(JSON.stringify(p.b2bAsistido)) as Record<string, unknown>;
    const reordenado = Object.fromEntries(Object.entries(mismoBloque).reverse());
    let r = await parchear(U.VENTA, id, { payload: { ...p, b2bAsistido: reordenado, nota_operativa: "ok" } });
    assert.equal(r.error, null, r.error?.message);
    assert.equal(r.filas, 1);
    assert.equal(sql(`select payload ->> 'nota_operativa' from public.cotizaciones where id = ${id}`), "ok");
    r = await parchear(U.VENTA, id, { detalle: { ...detalleCot(id), progreso: "x" }, vigencia_hasta: "2031-01-01" });
    assert.equal(r.error, null, r.error?.message);
    r = await parchear(U.GERENCIA, id, { estado: "abierta" });
    assert.equal(r.error, null, r.error?.message);
    assert.deepEqual((payloadCot(id) as { b2bAsistido: unknown }).b2bAsistido, mismoBloque);
    // Y la conversión real (que reescribe detalle y estado) sigue funcionando.
    const ok = await convertir(U.VENTA, id, 1);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(estadoCot(id), "convertida");
  });

  test("F5 el disparador es de fila, BEFORE UPDATE, está habilitado y su función no la ejecutan los clientes", () => {
    assert.equal(sql("select tgenabled::text || ':' || (tgtype & 31)::text from pg_trigger where tgrelid = 'public.cotizaciones'::regclass and tgname = 'trg_cot_b2b_asistido_inmutable'"), "O:19");
    assert.equal(sql("select (has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE'))::text from pg_proc where proname = 'tg_cot_b2b_asistido_inmutable'"), "false");
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("102 · cobertura exacta de las unidades antes de numerar", () => {
  const MSG_INVALIDA = /incompletos o no son consistentes/;

  test("G1 «por destino»: un hotel quitado del payload deja un grupo que por sí solo parece válido; sumados no cubren el plan ⇒ ni número ni contrato", async () => {
    const { id } = await cotizarOk(U.VENTA, { hoteles: [10201, 10202], asistencia: b2b(A.AG10, "comisionable") });
    sinFrontera(`update public.cotizaciones set payload = jsonb_set(payload, '{items}', (payload -> 'items') - 1) where id = ${id}`);
    const antes = foto();
    const r = await convertir(U.VENTA, id, 1, { monedaCobro: "COP" }, "por_destino");
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", MSG_INVALIDA);
    sinEscribir("hotel quitado", antes, id);
  });

  test("G2 un tour quitado del payload: la comisión se calcularía sobre menos PVP que el congelado ⇒ se rechaza antes de numerar", async () => {
    const sid = servicio("Tour quitado 102", 100_000, 300_000);
    const { id } = await cotizarOk(U.VENTA, { hoteles: [10201], tours: [tourEntrada(sid, 10201)], asistencia: b2b(A.AG10, "comisionable") });
    sinFrontera(`update public.cotizaciones set payload = jsonb_set(payload, '{tours}', '[]'::jsonb) where id = ${id}`);
    const antes = foto();
    const r = await convertir(U.VENTA, id, 1, { monedaCobro: "COP" }, "todo", 0);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", MSG_INVALIDA);
    sinEscribir("tour quitado", antes, id);
  });

  test("G3 en un REINTENTO tras el primer contrato, el conjunto completo se sigue verificando: quitar la unidad ya convertida no deja convertir el resto", async () => {
    const { id } = await cotizarOk(U.VENTA, { hoteles: [10201, 10202], asistencia: b2b(A.AG10, "comisionable") });
    sql(`
      create or replace function public.t102_falla_segunda() returns trigger language plpgsql as $f$
      begin
        if NEW.precio_venta = 600000 then raise exception 'falla simulada 102 segunda comisión'; end if;
        return NEW;
      end $f$;
      create trigger t102_falla_comision before insert on public.aliados_b2b for each row execute function public.t102_falla_segunda();
    `);
    const r1 = await convertir(U.VENTA, id, 2, { monedaCobro: "COP" }, "por_destino");
    sql("drop trigger if exists t102_falla_comision on public.aliados_b2b");
    assert.equal(r1.ok, false);
    const antes = foto();
    sinFrontera(`update public.cotizaciones set payload = jsonb_set(payload, '{items}', (payload -> 'items') - 0) where id = ${id}`);
    const r = await convertir(U.VENTA, id, 1, { monedaCobro: "COP" }, "por_destino");
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", MSG_INVALIDA);
    assert.deepEqual(foto(), antes, "no se creó nada nuevo");
  });

  test("G4 lo legítimo se conserva: «por destino» con un tour y su reintento completo convierten y suman la cotización", async () => {
    const sid = servicio("Tour G4 102", 100_000, 300_000);
    const { id, plan } = await cotizarOk(U.VENTA, { hoteles: [10201, 10202], tours: [tourEntrada(sid, 10201)], asistencia: b2b(A.AG10, "comisionable") });
    const ok = await convertir(U.VENTA, id, 2, { monedaCobro: "COP" }, "por_destino", 1);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(ok.numeros!.length, 2);
    const total = ok.numeros!.reduce((s, n) => s + num(ventaDe(n).precio_venta), 0);
    assert.equal(total, plan!.total_exigible);
    const otra = await convertir(U.VENTA, id, 2, { monedaCobro: "COP" }, "por_destino", 1);
    assert.equal(otra.ok, true, otra.error);
    assert.deepEqual(otra.numeros, ok.numeros);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("102 · regla de PVP de los tours: se congela al cotizar; el catálogo solo mueve su costo", () => {
  test("H1 cambió el catálogo del tour (PVP vigente y costo) después de cotizar: el contrato conserva el PVP COTIZADO y la comisión congelada; la CxP toma el costo VIVO", async () => {
    const sid = servicio("Tour catálogo 102", 100_000, 300_000);
    const { id, plan } = await cotizarOk(U.VENTA, { hoteles: [10201], tours: [tourEntrada(sid, 10201)], asistencia: b2b(A.AG10, "comisionable") });
    assert.deepEqual({ pvp: plan!.pvp, comision: plan!.comision }, { pvp: 1_300_000, comision: 110_000 });
    // El catálogo cambia: el PVP vigente del servicio sube a 450.000 y su costo neto a 150.000 por persona.
    SERVICIOS[sid].total = 450_000;
    sql(`update public.servicios_adicionales set precio_persona = 150000 where id = ${sid}`);
    const r = await convertir(U.VENTA, id, 1, { monedaCobro: "COP" }, "todo", 1);
    assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    const v = ventaDe(n);
    assert.equal(num(v.precio_venta), 1_300_000, "el PVP del tour es el cotizado (300.000), no el vigente (450.000)");
    assert.equal(num(v.comision_b2b), 110_000, "la comisión es la congelada");
    assert.equal(cxpDe(n), "Hotel Hotel Aurora 102|hotel|600000.00|COP;Tour catálogo 102|receptivo|300000.00|COP", "el costo del tour sí es el vigente: 150.000 × 2");
  });

  test("H2 alterar el PVP del tour en el payload de la cotización no sirve: ya no coincide con lo congelado ⇒ se rechaza antes de numerar", async () => {
    const sid = servicio("Tour alterado 102", 100_000, 300_000);
    const { id } = await cotizarOk(U.VENTA, { hoteles: [10201], tours: [tourEntrada(sid, 10201)], asistencia: b2b(A.AG10, "comisionable") });
    sinFrontera(`update public.cotizaciones set payload = jsonb_set(payload, '{tours,0,precio}', '100000') where id = ${id}`);
    const antes = foto();
    const r = await convertir(U.VENTA, id, 1, { monedaCobro: "COP" }, "todo", 1);
    assert.equal(r.ok, false);
    assert.equal(r.error, MENSAJE_TERMINOS_CAMBIARON);
    sinEscribir("tour alterado", antes, id);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("102 · las unidades económicas de la cotización asistida también quedan congeladas", () => {
  type PayloadCot = { items: Record<string, unknown>[]; tours: Record<string, unknown>[]; serviciosIncluidos?: unknown[]; cliente?: Record<string, unknown>; [k: string]: unknown };
  async function parchear(sesion: string, id: number, cambios: Record<string, unknown>) {
    uidSesion = sesion;
    const r = await clienteSesion().from("cotizaciones").update(cambios as never).eq("id", id).select("id");
    return { error: r.error, filas: r.data?.length ?? 0 };
  }
  const payloadDe = (id: number) => payloadCot(id) as unknown as PayloadCot;
  const conTour0 = (p: PayloadCot, cambios: Record<string, unknown>): PayloadCot => ({ ...p, tours: [{ ...p.tours[0], ...cambios }, ...p.tours.slice(1)] });
  /** Lo que el cliente ve en el contrato y lo que se le debe al proveedor: lo que NO puede cambiar por una edición posterior de la cotización. */
  const huella = (n: string) => ({
    destino: sql(`select destino from public.ventas where numero_contrato = ${lit(n)}`),
    servicios: sql(`select coalesce(string_agg(descripcion || '|' || tarifa_adulto, ';' order by id), '') from public.contrato_items where numero_contrato = ${lit(n)} and descripcion like 'Servicio ·%'`),
    cxp: cxpDe(n),
    precio: num(ventaDe(n).precio_venta),
  });

  test("F6 cambiar por Data API la identidad de payload.tours[0] (servicioId, paqueteId, nombre, destino) manteniendo tour-0 y el PVP: se rechaza, y el contrato/CxP son los cotizados", async () => {
    const sidA = servicio("Tour cotizado 102", 100_000, 300_000);
    const sidB = servicio("Tour sustituto 102", 400_000, 300_000); // otro costo neto por persona, mismo PVP simulado
    const variantes: [string, Record<string, unknown>][] = [
      ["servicioId", { servicioId: sidB }],
      ["nombre", { nombre: "Tour distinto 102" }],
      ["destino", { destino: "SANTA MARTA" }],
      ["paqueteId", { paqueteId: 10202 }],
    ];
    // Referencia: lo que produce la cotización sin tocar.
    const ref = await cotizarOk(U.VENTA, { hoteles: [10201], tours: [tourEntrada(sidA, 10201)], asistencia: b2b(A.AG10, "comisionable") });
    const okRef = await convertir(U.VENTA, ref.id, 1, { monedaCobro: "COP" }, "todo", 1);
    assert.equal(okRef.ok, true, okRef.error);
    const esperado = huella(okRef.numeros![0]);
    for (const [campo, cambio] of variantes) {
      const { id } = await cotizarOk(U.VENTA, { hoteles: [10201], tours: [tourEntrada(sidA, 10201)], asistencia: b2b(A.AG10, "comisionable") });
      const antes = payloadDe(id);
      const r = await parchear(U.VENTA, id, { payload: conTour0(antes, cambio) });
      const rechazado = /B2B_ASISTIDO_INMUTABLE/.test(r.error?.message ?? "") && r.filas === 0;
      const ok = await convertir(U.VENTA, id, 1, { monedaCobro: "COP" }, "todo", 1);
      const obtenido = ok.ok ? huella(ok.numeros![0]) : { error: ok.error };
      assert.deepEqual({ campo, rechazado, tour0: payloadDe(id).tours[0], ...obtenido }, { campo, rechazado: true, tour0: antes.tours[0], ...esperado }, `variante ${campo}`);
    }
  });

  test("F7 items, tours y serviciosIncluidos de una cotización asistida no se agregan, quitan, reordenan ni reescriben", async () => {
    const sid = servicio("Tour F7 102", 100_000, 300_000);
    const { id } = await cotizarOk(U.VENTA, { hoteles: [10201, 10202], tours: [tourEntrada(sid, 10201)], asistencia: b2b(A.AG10, "comisionable") });
    const p = payloadDe(id);
    const intentos: [string, Record<string, unknown>][] = [
      ["precio de un ítem", { ...p, items: [{ ...p.items[0], precio: 1 }, ...p.items.slice(1)] }],
      ["hotel de un ítem", { ...p, items: [{ ...p.items[0], hotelId: 10203 }, ...p.items.slice(1)] }],
      ["quitar un ítem", { ...p, items: p.items.slice(1) }],
      ["reordenar ítems", { ...p, items: [...p.items].reverse() }],
      ["quitar los tours", { ...p, tours: [] }],
      ["pax de un tour", { ...p, tours: [{ ...p.tours[0], pax: 9 }] }],
      ["serviciosIncluidos", { ...p, serviciosIncluidos: [{ ref: "item-0", servicioId: 1 }] }],
    ];
    for (const [que, payload] of intentos) {
      const r = await parchear(U.VENTA, id, { payload });
      assert.match(r.error?.message ?? "", /B2B_ASISTIDO_INMUTABLE/, que);
    }
    assert.deepEqual(payloadDe(id), p, "el payload quedó intacto");
  });

  test("F8 lo legítimo en una cotización asistida sigue pasando: cliente, pasajeros, otras llaves y progreso/estado de la conversión", async () => {
    const sid = servicio("Tour F8 102", 100_000, 300_000);
    const { id } = await cotizarOk(U.VENTA, { hoteles: [10201], tours: [tourEntrada(sid, 10201)], asistencia: b2b(A.AG10, "neta") });
    const p = payloadDe(id);
    let r = await parchear(U.VENTA, id, { payload: { ...p, cliente: { ...(p.cliente ?? {}), telefono: "3111111111" }, pasajeros: [{ ref: "p-1", nombres: "Ana" }], nota_operativa: "x" } });
    assert.equal(r.error, null, r.error?.message);
    assert.equal(r.filas, 1);
    // Mismas unidades con otro orden de llaves y otro contenido de lo no económico: iguales para jsonb.
    r = await parchear(U.GERENCIA, id, { payload: { ...payloadDe(id), items: p.items.map((i) => Object.fromEntries(Object.entries(i).reverse())) } });
    assert.equal(r.error, null, r.error?.message);
    r = await parchear(U.VENTA, id, { detalle: { ...detalleCot(id), progreso: "x" }, vigencia_hasta: "2031-01-01" });
    assert.equal(r.error, null, r.error?.message);
    const ok = await convertir(U.VENTA, id, 1, { monedaCobro: "COP" }, "todo", 1);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(estadoCot(id), "convertida");
    assert.deepEqual(payloadDe(id).tours, p.tours);
  });

  test("G5 reintento «por destino»: entre el primer intento (1.er contrato creado, 2.º fallido) y el reintento no se puede alterar ni la unidad ya convertida ni la pendiente; el reintento completa solo el 2.º", async () => {
    const sid = servicio("Tour G5 102", 100_000, 300_000);
    const { id, plan } = await cotizarOk(U.VENTA, { hoteles: [10201, 10202], tours: [tourEntrada(sid, 10201)], asistencia: b2b(A.AG10, "comisionable") });
    sql(`
      create or replace function public.t102_falla_segunda() returns trigger language plpgsql as $f$
      begin
        if NEW.precio_venta = 600000 then raise exception 'falla simulada 102 segunda comisión'; end if;
        return NEW;
      end $f$;
      create trigger t102_falla_comision before insert on public.aliados_b2b for each row execute function public.t102_falla_segunda();
    `);
    const r1 = await convertir(U.VENTA, id, 2, { monedaCobro: "COP" }, "por_destino", 1);
    sql("drop trigger if exists t102_falla_comision on public.aliados_b2b");
    assert.equal(r1.ok, false);
    const primero = (detalleCot(id) as { contratos?: string[] }).contratos![0];
    const huellaPrimero = huella(primero);
    const p = payloadDe(id);
    for (const [que, payload] of [
      ["tour ya convertido: otro servicio", conTour0(p, { servicioId: sid + 1 })],
      ["hotel pendiente: otro precio", { ...p, items: [p.items[0], { ...p.items[1], precio: 1 }] }],
      ["quitar el hotel pendiente", { ...p, items: [p.items[0]] }],
    ] as [string, Record<string, unknown>][]) {
      const r = await parchear(U.VENTA, id, { payload });
      assert.match(r.error?.message ?? "", /B2B_ASISTIDO_INMUTABLE/, que);
    }
    const ok = await convertir(U.VENTA, id, 2, { monedaCobro: "COP" }, "por_destino", 1);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(ok.numeros!.length, 2);
    assert.equal(ok.numeros![0], primero);
    assert.deepEqual(huella(primero), huellaPrimero, "el primer contrato no cambió");
    assert.equal(comisionesDe(primero).length, 1, "su comisión no se duplicó");
    assert.equal(comisionesDe(ok.numeros![1]).length, 1);
    assert.equal(ok.numeros!.reduce((s, n) => s + num(ventaDe(n).precio_venta), 0), plan!.total_exigible);
  });
});

function leerArchivo(rel: string): string {
  return execFileSync("node", ["-e", `process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(rel)}, "utf8").replace(/\\r\\n/g, "\\n"))`], { encoding: "utf8", cwd: new URL("..", import.meta.url) });
}
