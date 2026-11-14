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
let solicitudesPostgrest = 0; // consumo (#14-A): cada llamada HTTP a PostgREST equivale a una solicitud a Supabase en producción
const fetchLocal: typeof fetch = (input, init) => { solicitudesPostgrest++; return fetch(String(input).replace("/rest/v1/", "/"), init); };
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
type HotelSim = { nombre: string; destino: string; moneda: string; pvp: number; neto: number; impuesto: number; /** PVP de UN niño acompañante (#14-A); ausente = solo 2 adultos. */ nino?: number };
let HOTELES: Record<number, HotelSim> = {};
type ServicioSim = { nombre: string; moneda: string; total: number; paqueteId: number; pax?: number };
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
          precioVenta: h.pvp * 2 + (h.nino ?? 0), monedaReserva: h.moneda, impuestoTotal: h.impuesto,
          lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: h.pvp }], pvpPorAcom: { doble: h.pvp }, netoPorAcom: { doble: h.neto },
          numNinos: h.nino ? 1 : 0, numNinos2: 0, numInfantes: 0, numMenoresDeDos: 0, totalPax: h.nino ? 3 : 2, paxConSilla: h.nino ? 3 : 2, edadesMenoresUsadas: h.nino ? [8] : [],
          lineasMenores: h.nino ? [{ clase: "nino", cantidad: 1, tarifa: h.nino, menorDeDos: false }] : [],
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
      return { ok: true, resultado: { servicioId: t.servicioId, paqueteId: s.paqueteId, nombre: s.nombre, destino: "CARTAGENA", descripcion: null, noches: 3, pax: s.pax ?? 2, total: s.total, moneda: s.moneda, categoria: "tour_traslado" } };
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

const { crearSolicitudReserva, getContextoAsistenciaB2B, previsualizarTerminosB2BAsistido } = await import("../app/tarifario/checkout/actions.ts");
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
    insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (${id}, 'VIG 2030', '2030-01-01', '2030-12-31', ${precioPersonaNeto});
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

  test("M2b el postcheck integral de la 239 (UNA consulta) sale todo OK y la vista ventas_basica expone el titular sin columnas financieras", () => {
    const salida = execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-F", "|"],
      { input: leerArchivo("supabase/scripts/postcheck_239_titular_reserva.sql"), encoding: "utf8" });
    assert.ok(!/\|REVISAR\s*$/m.test(salida), salida);
    assert.match(salida, /ventas_basica_expone_el_titular\|4\|4\|OK/);
    assert.match(salida, /documento_del_titular_enmascarado_para_venta_ajena\|true\|true\|OK/);
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
    assert.doesNotMatch(texto, /comision|Comisi|pct|porcentaje|b2bAsistido|88000|0\.11/i, "el detalle (lo que ve el comprador) no lleva comisión, porcentaje ni base");
    assert.match(texto, /Lucía Gómez 102/, "el aliado SÍ aparece, pero como el cliente de la cotización NETO (Preview #403), nunca como términos");
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

  test("A11 un usuario sin permiso de cotizar conserva su flujo de siempre (no queda marcado B2B); un aliado con ficha vinculada sella SU plan «aliado_directo» (#14-A)", async () => {
    const c = await cotizarOk(U.CTRL, {});
    assert.equal(c.plan, null, "control_vuelo");
    assert.equal(payloadCot(c.id).b2bAsistido, undefined);
    const al = await cotizarOk(U.AGENCIA, {});
    assert.ok(al.plan, "el aliado con ficha queda con plan congelado");
    assert.equal(al.plan!.origen, "aliado_directo");
    assert.equal(al.plan!.aliado_id, A.AG10);
    assert.equal(al.plan!.modo_compra, "comisionable");
    assert.equal(al.plan!.recobro ?? null, null, "sin recobro no hay bloque de recobro");
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
      porB2bUsuario: async (usuarioId: string) => ({ completa: true, filas: ((await admin.from("ventas").select(columnas).eq("b2b_usuario_id", usuarioId)).data ?? []) }),
      porAliadoId: async (aliadoId: number) => ({ completa: true, filas: ((await admin.from("ventas").select(columnas).eq("aliado_id", aliadoId)).data ?? []) }),
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
    sql(`update public.servicios_adicionales set precio_persona = 150000 where id = ${sid}; update public.servicio_temporadas set precio_persona = 150000 where servicio_id = ${sid}`);
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

// ═════════════════════════════════════════════════════════════════════════
// Preview #403 · identidad comercial de una venta NETO (aliado = cliente, persona = titular de la reserva) y firmas.
describe("102 · NETO asistido: el aliado es el cliente comercial; la persona es el «Titular de la reserva»", () => {
  const FISCAL = { nit: "900123456-7", tipo_documento: "NIT", direccion: "Calle 10 # 5-20, Medellín", telefono: "6044440000", email: "contabilidad@aurora102.test" };
  before(() => {
    sql(`update public.aliados set nit = ${lit(FISCAL.nit)}, tipo_documento = ${lit(FISCAL.tipo_documento)}, direccion = ${lit(FISCAL.direccion)}, telefono = ${lit(FISCAL.telefono)}, email = ${lit(FISCAL.email)} where id = ${A.AG10}`);
    sql(`update public.aliados set nit = '1017000111', tipo_documento = 'CC', direccion = 'Carrera 7 # 1-1', telefono = '3105550000', email = 'lucia102@x.test' where id = ${A.FL_GENERAL}`);
  });
  type DetalleVenta = Record<string, unknown>;
  const filaCot = (id: number) => json<{ cliente: string | null; cliente_documento: string | null; asesor: string | null }>(`select row_to_json(t)::text from (select cliente, cliente_documento, asesor from public.cotizaciones where id = ${id}) t`);
  const ventaDet = (id: number) => (detalleCot(id).venta ?? {}) as DetalleVenta;
  const clienteDe = (id: number) => (payloadCot(id) as unknown as { cliente: Record<string, string> }).cliente;
  const ventaFicha = (n: string) => json<Record<string, string | null>>(`select row_to_json(t)::text from (select cliente, cliente_documento, cliente_telefono, cliente_email, cliente_direccion, cliente_tipo_documento, titular_tipo_documento, titular_nombre, titular_documento, titular_telefono, titular_email, asesor_firma_nombre, asesor_firma_cargo, asesor, tipo_asesor, agencia_nombre, freelance_nombre from public.ventas where numero_contrato = ${lit(n)}) t`);

  test("I1 cotización NETO: el cliente (lista y documento) es el aliado con la identidad fiscal del CATÁLOGO; el titular queda aparte, en datos persistidos", async () => {
    const r = await cotizar(U.VENTA, { hoteles: [10201], asistencia: { ...b2b(A.AG10, "neta"), nit: "000", cliente: "Falso SA", nombre: "Falso SA" } as Asistencia, extra: { clienteComercial: "Falso SA" } });
    assert.equal(r.ok, true, r.error);
    const id = r.cotizacion!.id;
    assert.deepEqual(filaCot(id), { cliente: ALIADOS_NOMBRE[A.AG10], cliente_documento: FISCAL.nit, asesor: SESIONES[U.VENTA].nombre });
    const v = ventaDet(id);
    assert.equal(v.cliente, ALIADOS_NOMBRE[A.AG10]);
    assert.equal(v.cliente_documento, FISCAL.nit);
    assert.equal(v.cliente_telefono, FISCAL.telefono);
    assert.equal(v.cliente_direccion, FISCAL.direccion);
    assert.equal(v.titular_nombre, "Ana Pérez");
    assert.equal(v.titular_documento, "123");
    assert.equal(v.titular_telefono, "3000000000");
    assert.deepEqual(clienteDe(id), { ...CLIENTE }, "el titular completo sigue en payload.cliente");
    assert.equal(v.tipo_asesor, "agencia");
    assert.equal(v.agencia_nombre, ALIADOS_NOMBRE[A.AG10]);
    assert.equal(v.asesor_firma_nombre, SESIONES[U.VENTA].nombre, "quien elaboró sale del usuario interno autenticado");
    const doc = JSON.stringify(detalleCot(id));
    assert.doesNotMatch(doc, /Falso SA|"000"/);
    assert.doesNotMatch(doc, /comision|pct|base/i, "el snapshot del documento externo no lleva comisión, base ni porcentaje");
  });

  test("I2 cotización PVP con comisión: el cliente sigue siendo la persona (sin titular aparte); la firma sale del usuario y el vendedor es el aliado", async () => {
    const { id } = await cotizarOk(U.VENTA, { hoteles: [10201], asistencia: b2b(A.FL_GENERAL, "comisionable") });
    assert.deepEqual(filaCot(id), { cliente: "Ana Pérez", cliente_documento: "123", asesor: SESIONES[U.VENTA].nombre });
    const v = ventaDet(id);
    assert.equal(v.cliente, "Ana Pérez");
    assert.equal(v.titular_nombre, undefined);
    assert.equal(v.tipo_asesor, "freelance");
    assert.equal(v.freelance_nombre, ALIADOS_NOMBRE[A.FL_GENERAL]);
    assert.equal(v.asesor_firma_nombre, SESIONES[U.VENTA].nombre);
  });

  test("I3 cotización B2C interna: cliente = persona, y quien elaboró es el usuario autenticado (antes salía «—»)", async () => {
    const { id } = await cotizarOk(U.GERENCIA, { hoteles: [10201] });
    assert.deepEqual(filaCot(id), { cliente: "Ana Pérez", cliente_documento: "123", asesor: SESIONES[U.GERENCIA].nombre });
    const v = ventaDet(id);
    assert.equal(v.asesor_firma_nombre, SESIONES[U.GERENCIA].nombre);
    assert.equal(v.titular_nombre, undefined);
  });

  test("I4 conversión NETO: el contrato queda a nombre del aliado (identidad del CATÁLOGO vivo, no del snapshot); el titular se persiste aparte; ventas_basica lo expone", async () => {
    const { id } = await cotizarOk(U.VENTA, { hoteles: [10201], asistencia: b2b(A.AG10, "neta") });
    // Un snapshot manipulado (detalle es editable) no puede dictar la identidad fiscal del contrato.
    sql(`update public.cotizaciones set detalle = jsonb_set(detalle, '{venta,cliente}', '"Falso SA"') where id = ${id}`);
    const ok = await convertir(U.VENTA, id, 1);
    assert.equal(ok.ok, true, ok.error);
    const n = ok.numeros![0];
    const v = ventaFicha(n);
    assert.equal(v.cliente, ALIADOS_NOMBRE[A.AG10]);
    assert.equal(v.cliente_documento, FISCAL.nit);
    assert.equal(v.cliente_telefono, FISCAL.telefono);
    assert.equal(v.cliente_email, FISCAL.email);
    assert.equal(v.cliente_direccion, FISCAL.direccion);
    assert.equal(v.titular_nombre, "Ana Pérez");
    assert.equal(v.titular_documento, "123");
    assert.equal(v.titular_telefono, "3000000000");
    assert.equal(v.titular_email, "ana@example.com");
    assert.equal(v.tipo_asesor, "agencia");
    assert.equal(v.agencia_nombre, ALIADOS_NOMBRE[A.AG10]);
    assert.equal(ventaDe(n).aliado_id, A.AG10);
    // La vista que lee el documento (ventas_basica) lleva el titular.
    const vista = async (uid: string) => {
      const r = await clienteLocal(jwt({ role: "authenticated", sub: uid })).from("ventas_basica").select("titular_nombre, titular_documento, titular_telefono").eq("numero_contrato", n);
      assert.equal(r.error, null);
      return r.data;
    };
    assert.deepEqual(await vista(U.VENTA), [{ titular_nombre: "Ana Pérez", titular_documento: "123", titular_telefono: "3000000000" }], "su asesor ve el documento completo");
    assert.deepEqual(await vista(U.GERENCIA), [{ titular_nombre: "Ana Pérez", titular_documento: "123", titular_telefono: "3000000000" }]);
    // Otro asesor de la agencia: ve al titular pero con el documento enmascarado, igual que el del cliente.
    const otro = "00000000-0000-0000-0000-000000102099";
    sql(`insert into auth.users (id, email) values ('${otro}', 'otro102@x.test') on conflict do nothing;
         insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${otro}', 'otro102@x.test', 'Otro Asesor 102', 'venta', true, 'mayorista') on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant`);
    assert.deepEqual(await vista(otro), [{ titular_nombre: "Ana Pérez", titular_documento: "••••", titular_telefono: "3000000000" }]);
    assert.equal(comisionesDe(n)[0].aliado, ALIADOS_NOMBRE[A.AG10]);
  });

  test("I5 conversión PVP con comisión y B2C: el cliente sigue siendo la persona y no hay titular aparte", async () => {
    const pvp = await cotizarOk(U.VENTA, { hoteles: [10201], asistencia: b2b(A.AG10, "comisionable") });
    const a = await convertir(U.VENTA, pvp.id, 1);
    assert.equal(a.ok, true, a.error);
    let v = ventaFicha(a.numeros![0]);
    assert.deepEqual([v.cliente, v.cliente_documento, v.titular_nombre, v.titular_documento], ["Ana Pérez", "123", null, null]);
    const b2c = await cotizarOk(U.VENTA, { hoteles: [10201] });
    const b = await convertir(U.VENTA, b2c.id, 1);
    assert.equal(b.ok, true, b.error);
    v = ventaFicha(b.numeros![0]);
    assert.deepEqual([v.cliente, v.cliente_documento, v.titular_nombre, v.tipo_asesor], ["Ana Pérez", "123", null, "interno"]);
  });

  test("I7 #40 E2 · tipo de documento en la conversión REAL del carrito: mismo número con CC y CE, en NETO y en PVP con comisión", async () => {
    for (const modo of ["neta", "comisionable"] as const) {
      const hechos: Record<string, Record<string, string | null>> = {};
      for (const tipoDoc of ["CC", "CE"]) {
        const cot = await cotizarOk(U.VENTA, { hoteles: [10201], asistencia: b2b(A.AG10, modo), extra: { cliente: { ...CLIENTE, tipoDoc } } });
        const r = await convertir(U.VENTA, cot.id, 1);
        assert.equal(r.ok, true, r.error);
        hechos[tipoDoc] = ventaFicha(r.numeros![0]);
      }
      for (const tipoDoc of ["CC", "CE"]) {
        const v = hechos[tipoDoc];
        if (modo === "neta") {
          // Cliente = ALIADO (NIT del catálogo); titular = la persona, con SU tipo. Nunca se cruzan.
          assert.deepEqual([v.cliente_documento, v.cliente_tipo_documento], [FISCAL.nit, "NIT"], "NETO " + tipoDoc);
          assert.deepEqual([v.titular_documento, v.titular_tipo_documento], ["123", tipoDoc], "NETO " + tipoDoc);
        } else {
          assert.deepEqual([v.cliente_documento, v.cliente_tipo_documento, v.titular_documento, v.titular_tipo_documento], ["123", tipoDoc, null, null], "PVP " + tipoDoc);
        }
      }
    }
  });

  test("I6 firma del contrato: sin asesor elegido en pantalla (superadmin) se firma con el usuario autenticado; con asesor elegido se respeta; nunca se inventa", async () => {
    const sinElegir = await cotizarOk(U.SUPER, { hoteles: [10201] });
    uidSesion = U.SUPER;
    const r = await convertirCotizacionCarrito(sinElegir.id, { agrupar: "todo", pasajeros: PASAJEROS, asesorInterno: "", asignaciones: [[1, 2]], asignacionesTours: [], monedaCobro: "COP" }) as RespConvertir;
    assert.equal(r.ok, true, r.error);
    let v = ventaFicha(r.numeros![0]);
    assert.equal(v.asesor_firma_nombre, SESIONES[U.SUPER].nombre);
    assert.equal(v.asesor, SESIONES[U.SUPER].nombre);
    const elegido = await cotizarOk(U.SUPER, { hoteles: [10201], asistencia: b2b(A.AG10, "neta") });
    const e = await convertir(U.SUPER, elegido.id, 1);
    assert.equal(e.ok, true, e.error);
    v = ventaFicha(e.numeros![0]);
    assert.equal(v.asesor_firma_nombre, SESIONES[U.SUPER].nombre);
    assert.equal(v.agencia_nombre, ALIADOS_NOMBRE[A.AG10], "la segunda firma (vendedor) es el aliado");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Auditoría Preview #403 · la identidad fiscal del aliado que se MOSTRÓ al cotizar (cliente de una venta NETO) queda congelada y se verifica antes de numerar.
describe("102 · NETO asistido: identidad fiscal del aliado congelada (nombre y documento)", () => {
  const ID = 10207;
  const NOMBRE = "Viajes Horizonte 102";
  const NIT = "800555777-1";
  before(() => {
    sql(`insert into public.aliados (id, nombre, tipo, pct_comision, activo, nit, tipo_documento) values (${ID}, ${lit(NOMBRE)}, 'agencia', 0.10, true, ${lit(NIT)}, 'NIT') on conflict (id) do nothing`);
  });
  const restaurar = () => sql(`update public.aliados set nombre = ${lit(NOMBRE)}, nit = ${lit(NIT)}, tipo_documento = 'NIT', pct_comision = 0.10 where id = ${ID}`);
  beforeEach(restaurar);
  const MENSAJE = /identidad fiscal del aliado/;

  test("J1 el plan congela el nombre y el documento fiscal que se mostraron como cliente de la cotización", async () => {
    const { id, plan } = await cotizarOk(U.VENTA, { hoteles: [10201], asistencia: b2b(ID, "neta") });
    const congelado = payloadCot(id).b2bAsistido as Record<string, unknown>;
    assert.equal(congelado.aliado_nombre, NOMBRE);
    assert.equal(congelado.aliado_documento, NIT);
    assert.equal(plan!.aliado_documento, NIT);
    const v = (detalleCot(id).venta ?? {}) as Record<string, unknown>;
    assert.equal(v.cliente, NOMBRE);
    assert.equal(v.cliente_documento, NIT, "lo congelado es lo mismo que se mostró");
  });

  test("J2 cambió el NOMBRE del aliado después de cotizar: se rechaza ANTES de numerar; con el nombre original la misma cotización convierte", async () => {
    const { id } = await cotizarOk(U.VENTA, { hoteles: [10201], asistencia: b2b(ID, "neta") });
    sql(`update public.aliados set nombre = 'Otro Nombre SAS' where id = ${ID}`);
    const antes = foto();
    const r = await convertir(U.VENTA, id, 1);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", MENSAJE);
    sinEscribir("nombre cambiado", antes, id);
    restaurar();
    const ok = await convertir(U.VENTA, id, 1);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(sql(`select cliente from public.ventas where numero_contrato = ${lit(ok.numeros![0])}`), NOMBRE);
  });

  test("J3 cambió el NIT (o el documento se agregó/quitó/cambió de tipo) después de cotizar: se rechaza antes de numerar", async () => {
    for (const cambio of [`nit = '800555777-2'`, `nit = null`, `nit = '  800555777-1 x'`, `tipo_documento = 'CC'`]) {
      const { id } = await cotizarOk(U.VENTA, { hoteles: [10201], asistencia: b2b(ID, "neta") });
      sql(`update public.aliados set ${cambio} where id = ${ID}`);
      const antes = foto();
      const r = await convertir(U.VENTA, id, 1);
      assert.equal(r.ok, false, cambio);
      assert.match(r.error ?? "", MENSAJE, cambio);
      sinEscribir(cambio, antes, id);
      restaurar();
    }
  });

  test("J4 un aliado SIN documento al cotizar y con documento después también se rechaza (no se imprime un NIT que nadie vio)", async () => {
    sql(`update public.aliados set nit = null where id = ${ID}`);
    const { id, plan } = await cotizarOk(U.VENTA, { hoteles: [10201], asistencia: b2b(ID, "neta") });
    assert.equal(plan!.aliado_documento, null);
    sql(`update public.aliados set nit = '900000001' where id = ${ID}`);
    const antes = foto();
    const r = await convertir(U.VENTA, id, 1);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", MENSAJE);
    sinEscribir("documento agregado", antes, id);
  });

  test("J5 reintento por destino: el cambio de identidad entre intentos frena solo lo pendiente (el primer contrato ya existe y no se toca)", async () => {
    const { id } = await cotizarOk(U.VENTA, { hoteles: [10201, 10202], asistencia: b2b(ID, "neta") });
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
    const primero = (detalleCot(id) as { contratos?: string[] }).contratos![0];
    sql(`update public.aliados set nit = '123' where id = ${ID}`);
    const antes = foto();
    const r2 = await convertir(U.VENTA, id, 2, { monedaCobro: "COP" }, "por_destino");
    assert.equal(r2.ok, false);
    assert.match(r2.error ?? "", MENSAJE);
    assert.deepEqual(foto(), antes);
    restaurar();
    const ok = await convertir(U.VENTA, id, 2, { monedaCobro: "COP" }, "por_destino");
    assert.equal(ok.ok, true, ok.error);
    assert.equal(ok.numeros![0], primero);
    assert.equal(comisionesDe(primero).length, 1, "la comisión del primero no se duplicó");
  });

  test("J6 un plan NETO guardado sin identidad congelada (formato anterior) no se convierte: no se puede acreditar qué se mostró", async () => {
    const { id } = await cotizarOk(U.VENTA, { hoteles: [10201], asistencia: b2b(ID, "neta") });
    sinFrontera(`update public.cotizaciones set payload = payload #- '{b2bAsistido,aliado_documento}' where id = ${id}`);
    const antes = foto();
    const r = await convertir(U.VENTA, id, 1);
    assert.equal(r.ok, false);
    sinEscribir("plan sin identidad", antes, id);
  });

  test("J7 PVP con comisión: el nombre o el NIT del aliado NO bloquean (el cliente es la persona) y las reglas de comisión no cambian", async () => {
    const { id, plan } = await cotizarOk(U.VENTA, { hoteles: [10201], asistencia: b2b(ID, "comisionable") });
    sql(`update public.aliados set nombre = 'Nombre Nuevo SAS', nit = '999' where id = ${ID}`);
    const ok = await convertir(U.VENTA, id, 1);
    assert.equal(ok.ok, true, ok.error);
    const v = ventaDe(ok.numeros![0]);
    assert.equal(num(v.comision_b2b), plan!.comision);
    assert.equal(sql(`select cliente from public.ventas where numero_contrato = ${lit(ok.numeros![0])}`), "Ana Pérez");
  });

  test("J8 las reglas de comisión de NETO siguen igual: cambió el PORCENTAJE ⇒ MENSAJE_TERMINOS_CAMBIARON (no el de identidad)", async () => {
    const { id } = await cotizarOk(U.VENTA, { hoteles: [10201], asistencia: b2b(ID, "neta") });
    sql(`update public.aliados set pct_comision = 0.20 where id = ${ID}`);
    const r = await convertir(U.VENTA, id, 1);
    assert.equal(r.ok, false);
    assert.equal(r.error, MENSAJE_TERMINOS_CAMBIARON);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Vista previa del desglose B2B antes de generar (Preview #403): el servidor corre el MISMO cálculo que la cotización y no escribe nada.
describe("102 · vista previa del desglose B2B: paridad con la cotización generada", () => {
  type Previa = { ok: boolean; error?: string; terminos?: Record<string, unknown> };
  async function previsualizar(sesion: string, o: Parameters<typeof cotizar>[1]): Promise<Previa> {
    uidSesion = sesion;
    const entrada = {
      items: (o.hoteles ?? [10201]).map((h) => itemEntrada(h, o.paqueteId, o.bloqueoId ?? null)), tours: o.tours ?? [],
      ...(o.asistencia !== undefined ? { asistencia: o.asistencia } : {}), ...(o.extra ?? {}),
    };
    return (await previsualizarTerminosB2BAsistido(entrada)) as unknown as Previa;
  }
  const CAMPOS = ["aliado_nombre", "tipo_asesor", "modo_compra", "moneda", "pvp", "impuesto", "base", "pct", "pct_origen", "comision", "total_exigible"] as const;
  const delPlan = (p: Record<string, unknown>) => Object.fromEntries(CAMPOS.map((k) => [k, p[k]]));

  test("L1 caso de la captura: PVP USD 1.930, impuesto USD 830, base USD 1.100, 11 % = USD 121 y NETO USD 1.809 (no 11 % del PVP)", async () => {
    HOTELES[10203] = { nombre: "Hotel Dubái 102", destino: "CARTAGENA", moneda: "USD", pvp: 965, neto: 600, impuesto: 830 };
    const o = { hoteles: [10203], paqueteId: 10202, asistencia: b2b(A.FL_GENERAL, "neta") };
    const antes = foto(); const cots = totalCotizaciones();
    const p = await previsualizar(U.VENTA, o);
    assert.equal(p.ok, true, p.error);
    assert.deepEqual(delPlan(p.terminos!), {
      aliado_nombre: ALIADOS_NOMBRE[A.FL_GENERAL], tipo_asesor: "freelance", modo_compra: "neta", moneda: "USD",
      pvp: 1930, impuesto: 830, base: 1100, pct: 0.11, pct_origen: "general", comision: 121, total_exigible: 1809,
    });
    assert.deepEqual(foto(), antes);
    assert.equal(totalCotizaciones(), cots, "la vista previa no crea ninguna cotización");
    // Paridad: la cotización generada congela exactamente lo mismo.
    const { plan } = await cotizarOk(U.VENTA, o);
    assert.deepEqual(delPlan(plan as unknown as Record<string, unknown>), delPlan(p.terminos!));
  });

  test("L2 paridad en cada combinación de aliado, modalidad e ítems (la vista previa es el plan que se congelará)", async () => {
    const combos: Parameters<typeof cotizar>[1][] = [
      { hoteles: [10201], asistencia: b2b(A.AG10, "neta") },
      { hoteles: [10201], asistencia: b2b(A.AG10, "comisionable") },
      { hoteles: [10201], asistencia: b2b(A.FL_GENERAL, "neta") },
      { hoteles: [10201, 10202], asistencia: b2b(A.AG10, "neta") },
      { hoteles: [10204], asistencia: b2b(A.AG10, "neta") },   // base 0: impuesto = PVP
      { hoteles: [10201], asistencia: b2b(A.AG0, "neta") },    // 0 % explícito
    ];
    const vistos = new Set<string>();
    for (const o of combos) {
      const p = await previsualizar(U.VENTA, o);
      assert.equal(p.ok, true, p.error);
      const { plan } = await cotizarOk(U.VENTA, o);
      assert.deepEqual(delPlan(p.terminos!), delPlan(plan as unknown as Record<string, unknown>), JSON.stringify(o));
      vistos.add(JSON.stringify(delPlan(p.terminos!)));
    }
    assert.equal(vistos.size, combos.length, "cada combinación produce un desglose distinto");
  });

  test("L3 la elección es lo único que cuenta: porcentaje, comisión o total que mande el navegador se ignoran; sin escribir CRM ni cotización", async () => {
    const crm = Number(sql("select count(*) from public.crm_contactos"));
    const p = await previsualizar(U.VENTA, { asistencia: { ...b2b(A.AG10, "neta"), pct: 0.99, comision: 1, total: 1 } as Asistencia, extra: { pctComision: 0.99, total: 1 } });
    assert.equal(p.ok, true, p.error);
    assert.equal(p.terminos!.pct, 0.1);
    assert.equal(p.terminos!.comision, 80_000);
    assert.equal(Number(sql("select count(*) from public.crm_contactos")), crm);
  });

  test("L4 si no puede liquidarse devuelve el motivo (sin cifras): sin sesión válida, sin permiso, sin aliado, aliado inactivo, carrito vacío, servicio no disponible", async () => {
    for (const [que, sesion, o, esperado] of [
      ["sin elegir aliado/modalidad", U.VENTA, { hoteles: [10201] }, /Elige el aliado y la modalidad/],
      ["control_vuelo", U.CTRL, { hoteles: [10201], asistencia: b2b(A.AG10, "neta") }, /no puede cotizar/],
      ["aliado logueado", U.AGENCIA, { hoteles: [10201], asistencia: b2b(A.AG10, "neta") }, /no puede cotizar/],
      ["usuario inactivo", U.INACTIVO, { hoteles: [10201], asistencia: b2b(A.AG10, "neta") }, /sesión no es válida/],
      ["aliado inactivo", U.VENTA, { hoteles: [10201], asistencia: b2b(A.INACTIVO, "neta") }, /inactivo/],
      ["aliado inexistente", U.VENTA, { hoteles: [10201], asistencia: b2b(99999, "neta") }, /no existe/],
      ["modalidad inválida", U.VENTA, { hoteles: [10201], asistencia: { canal: "b2b", aliadoId: A.AG10, modo: "otra" } }, /modalidad/],
      ["carrito vacío", U.VENTA, { hoteles: [], asistencia: b2b(A.AG10, "neta") }, /vacío/],
      ["servicio no disponible", U.VENTA, { hoteles: [], tours: [tourEntrada(99999)], asistencia: b2b(A.AG10, "neta") }, /No se pudo generar/],
    ] as [string, string, Parameters<typeof cotizar>[1], RegExp][]) {
      const p = await previsualizar(sesion, o);
      assert.equal(p.ok, false, que);
      assert.match(p.error ?? "", esperado, que);
      assert.equal(p.terminos, undefined, `${que}: ninguna cifra`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Generar compara los términos vigentes con el desglose que el usuario VIO (vista previa); si cambiaron no se crea la cotización.
describe("102 · generar con el desglose confirmado: si cambió entre la vista previa y generar, no se crea nada", () => {
  const ID = 10208;
  before(() => {
    sql(`insert into public.aliados (id, nombre, tipo, pct_comision, activo, nit, tipo_documento) values (${ID}, 'Viajes Confirmar 102', 'agencia', 0.11, true, '800111222-3', 'NIT') on conflict (id) do nothing`);
  });
  beforeEach(() => sql(`update public.aliados set pct_comision = 0.11 where id = ${ID}`));
  type Terminos = Record<string, unknown>;
  const VISTOS = ["modo_compra", "moneda", "pvp", "impuesto", "base", "pct", "pct_origen", "comision", "total_exigible"] as const;
  const soloVistos = (t: Terminos) => Object.fromEntries(VISTOS.map((k) => [k, t[k]]));
  async function previa(modo: "neta" | "comisionable" = "neta") {
    uidSesion = U.VENTA;
    const r = (await previsualizarTerminosB2BAsistido({ items: [itemEntrada(10201)], tours: [], asistencia: b2b(ID, modo) })) as unknown as { ok: boolean; error?: string; terminos?: Terminos };
    assert.equal(r.ok, true, r.error);
    return r.terminos!;
  }
  async function generarConVistos(vistos: unknown) {
    uidSesion = U.VENTA;
    return (await crearSolicitudReserva({ items: [itemEntrada(10201)], tours: [], cliente: CLIENTE, asistencia: { canal: "b2b", aliadoId: ID, modo: "neta", ...(vistos === undefined ? {} : { vistos }) } })) as unknown as
      { ok: boolean; error?: string; tipo?: string; terminos?: Terminos; cotizacion?: { id: number }; b2bAsistido?: Terminos };
  }
  const foto2 = () => ({ cots: totalCotizaciones(), ...foto(), crm: Number(sql("select count(*) from public.crm_contactos")) });

  test("N1 sin cambios entre la vista previa y generar: se crea y congela EXACTAMENTE lo que se vio", async () => {
    const t = await previa();
    assert.deepEqual([t.pvp, t.impuesto, t.base, t.pct, t.comision, t.total_exigible], [1_000_000, 200_000, 800_000, 0.11, 88_000, 912_000]);
    const r = await generarConVistos(soloVistos(t));
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(soloVistos(r.b2bAsistido!), soloVistos(t));
  });

  test("N2 cambió el PORCENTAJE entre la vista previa y generar: no se crea la cotización; se devuelven los términos vigentes y confirmar de nuevo funciona", async () => {
    const visto = await previa();
    sql(`update public.aliados set pct_comision = 0.20 where id = ${ID}`);
    const antes = foto2();
    const r = await generarConVistos(soloVistos(visto));
    assert.equal(r.ok, false);
    assert.equal(r.tipo, "terminos_cambiaron");
    assert.match(r.error ?? "", /cambiaron desde el desglose que viste/);
    assert.deepEqual([r.terminos!.pct, r.terminos!.comision, r.terminos!.total_exigible], [0.2, 160_000, 840_000]);
    assert.deepEqual(foto2(), antes, "no se insertó ninguna cotización (ni contacto de CRM, ni número, ni nada)");
    const ok = await generarConVistos(soloVistos(r.terminos!));
    assert.equal(ok.ok, true, ok.error);
    assert.equal(ok.b2bAsistido!.comision, 160_000);
    assert.equal(totalCotizaciones(), antes.cots + 1);
  });

  test("N3 cambió el IMPUESTO no comisionable (base y comisión con él): no se crea; vigente devuelto", async () => {
    const visto = await previa();
    HOTELES[10201].impuesto = 300_000;
    const antes = foto2();
    const r = await generarConVistos(soloVistos(visto));
    assert.equal(r.tipo, "terminos_cambiaron");
    assert.deepEqual([r.terminos!.impuesto, r.terminos!.base, r.terminos!.comision, r.terminos!.total_exigible], [300_000, 700_000, 77_000, 923_000]);
    assert.deepEqual(foto2(), antes);
  });

  test("N4 cambió el PVP del carrito: no se crea", async () => {
    const visto = await previa();
    HOTELES[10201].pvp = 600_000;
    const antes = foto2();
    const r = await generarConVistos(soloVistos(visto));
    assert.equal(r.tipo, "terminos_cambiaron");
    assert.equal(r.terminos!.pvp, 1_200_000);
    assert.deepEqual(foto2(), antes);
  });

  test("N5 el desglose visto es solo una comparación: manipularlo no cambia lo que el servidor liquida (vistos inventados ⇒ rechazo, nunca se adoptan)", async () => {
    const t = await previa();
    const antes = foto2();
    const r = await generarConVistos({ ...soloVistos(t), comision: 1, total_exigible: 999_999 });
    assert.equal(r.tipo, "terminos_cambiaron");
    assert.equal(r.terminos!.comision, 88_000, "vigente = cálculo del servidor");
    assert.deepEqual(foto2(), antes);
    // Un desglose ilegible se rechaza sin crear nada; sin desglose (cliente antiguo) el servidor sigue calculando y congelando como siempre.
    const malo = await generarConVistos({ pvp: "x" });
    assert.equal(malo.ok, false);
    assert.match(malo.error ?? "", /desglose que se confirmó no es válido/);
    assert.deepEqual(foto2(), antes);
    const sin = await generarConVistos(undefined);
    assert.equal(sin.ok, true, sin.error);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// #14-A · recobro del carrito: recorridos REALES (cotizar → plan congelado → convertir → contrato / comisión / CxP) con importes exactos.
// Hotel 10201: PVP 1.000.000 (2 adultos × 500.000), BNC 200.000, aliado AG10 al 10 %; parámetro `recobro_pct_aliado_b2b` = 50 %.
describe("102 · #14-A recobro del carrito", () => {
  type FilaItem = { adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number; valor_total: number | null; descripcion: string };
  const itemsDe = (n: string) => json<FilaItem[]>(`select coalesce(json_agg(row_to_json(t) order by id), '[]'::json)::text from (select id, adultos, ninos, tarifa_adulto, tarifa_nino, valor_total, descripcion from public.contrato_items where numero_contrato = ${lit(n)}) t`);
  const sumaItems = (n: string) => Math.round(itemsDe(n).reduce((s, i) => s + i.adultos * Number(i.tarifa_adulto) + i.ninos * Number(i.tarifa_nino), 0) * 100) / 100;
  type VentaRec = { recobro_total: number | null; recobro_empresa: number | null; recobro_aliado: number | null };
  const recDe = (n: string) => json<VentaRec>(`select row_to_json(t)::text from (select recobro_total, recobro_empresa, recobro_aliado from public.ventas where numero_contrato = ${lit(n)}) t`);
  const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
  const planesDe = (n: string) => Number(sql(`select count(*) from public.comision_plan where numero_contrato = ${lit(n)}`));

  before(() => {
    sql(`insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion) values ('recobro_pct_aliado_b2b', 0.5, 'recobro', 'Distribución B2B') on conflict (parametro) do update set valor = 0.5`);
  });

  /** Cotiza y convierte un hotel (un contrato) y devuelve el número. */
  async function ciclo(sesion: string, o: Parameters<typeof cotizar>[1]) {
    const { id, plan } = await cotizarOk(sesion, o);
    const r = await convertir(sesion === U.AGENCIA ? U.VENTA : sesion, id, o.hoteles?.length ?? 1, { monedaCobro: "COP" }, "por_destino");
    assert.equal(r.ok, true, r.error);
    return { id, plan, numeros: r.numeros! };
  }

  test("R1 aliado directo SIN recobro conserva su identidad, su modalidad (comisión) y su comisión: contrato B2B del aliado, 80.000, sin recobro", async () => {
    const { id, plan, numeros } = await ciclo(U.AGENCIA, {});
    assert.equal(plan?.origen, "aliado_directo");
    assert.equal(plan?.modo_compra, "comisionable");
    assert.equal(numeros.length, 1);
    const v = ventaDe(numeros[0]);
    assert.deepEqual({ canal: v.canal, tipo: v.tipo_asesor, aliado: v.aliado_id, modo: v.modo_compra, precio: num(v.precio_venta), com: num(v.comision_b2b) },
      { canal: "B2B", tipo: "agencia", aliado: A.AG10, modo: "comisionable", precio: 1_000_000, com: 80_000 });
    assert.equal(num(recDe(numeros[0]).recobro_total ?? 0), 0);
    assert.equal(sumaItems(numeros[0]), 1_000_000);
    // PVP pendiente: la comisión nace como PLAN ligado al contrato (la fila exigible nace al confirmar); nunca una fila ni un plan duplicados.
    assert.equal(planesDe(numeros[0]), 1);
    assert.equal(comisionesDe(numeros[0]).length, 0);
    void id;
  });

  test("R2 aliado directo SIN recobro con modalidad NETO: la modalidad elegida se conserva (exigible 920.000 = 1.000.000 − 80.000)", async () => {
    const { plan, numeros } = await ciclo(U.AGENCIA, { extra: { modo: "neta" } });
    assert.equal(plan?.modo_compra, "neta");
    const v = ventaDe(numeros[0]);
    assert.deepEqual({ aliado: v.aliado_id, modo: v.modo_compra, precio: num(v.precio_venta), com: num(v.comision_b2b) }, { aliado: A.AG10, modo: "neta", precio: 920_000, com: 80_000 });
    assert.equal(recDe(numeros[0]).recobro_total ?? 0, 0);
  });

  test("R3 (A) aliado directo bajo comisión CON recobro 100.000: participación 50 % del parámetro (50.000), el recobro sale COMPLETO de la base (800.000), ordinaria 80.000, el aliado recibe 130.000", async () => {
    const { id, plan, numeros } = await ciclo(U.AGENCIA, { extra: { recobro: { total: 100_000 } } });
    assert.equal(plan?.recobro?.participacion, 50_000);
    assert.equal(plan?.recobro?.origen_participacion, "parametro");
    const v = ventaDe(numeros[0]);
    assert.deepEqual({ canal: v.canal, aliado: v.aliado_id, modo: v.modo_compra, precio: num(v.precio_venta), com: num(v.comision_b2b) },
      { canal: "B2B", aliado: A.AG10, modo: "comisionable", precio: 1_100_000, com: 80_000 });
    assert.deepEqual(recDe(numeros[0]), { recobro_total: 100_000, recobro_empresa: 50_000, recobro_aliado: 50_000 });
    assert.equal(sumaItems(numeros[0]), 1_100_000, "las tarifas del documento suman el PVP con el recobro dentro de la tarifa de adulto");
    assert.equal(itemsDe(numeros[0]).every((i) => !/recobro/i.test(i.descripcion)), true, "el documento no nombra el recobro");
    const plan2 = json<{ recobro_total: number; recobro_aliado: number; base_comision: number; comision_ordinaria: number; total_aliado: number }>(`select row_to_json(t)::text from (select recobro_total, recobro_aliado, base_comision, comision_ordinaria, total_aliado from public.comision_plan where numero_contrato = ${lit(numeros[0])}) t`);
    assert.deepEqual({ ...plan2 }, { recobro_total: 100_000, recobro_aliado: 50_000, base_comision: 800_000, comision_ordinaria: 80_000, total_aliado: 130_000 });
    void id;
  });

  test("R4 (B1) venta asistida CON distribución del recobro (50.000 de 100.000): mismos importes que el aliado directo", async () => {
    const { numeros } = await ciclo(U.VENTA, { asistencia: b2b(A.AG10, "comisionable"), extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 50_000 } } } });
    const v = ventaDe(numeros[0]);
    assert.deepEqual({ precio: num(v.precio_venta), com: num(v.comision_b2b) }, { precio: 1_100_000, com: 80_000 });
    assert.deepEqual(recDe(numeros[0]), { recobro_total: 100_000, recobro_empresa: 50_000, recobro_aliado: 50_000 });
    assert.equal(sumaItems(numeros[0]), 1_100_000);
  });

  test("R5 (B2) venta asistida SIN distribución: el recobro queda en la base (900.000), comisión 90.000 = el aliado recibe 10.000 más que sin recobro; toda la diferencia de recobro es de la empresa", async () => {
    const { numeros } = await ciclo(U.VENTA, { asistencia: b2b(A.AG10, "comisionable"), extra: { recobro: { total: 100_000 } } });
    const v = ventaDe(numeros[0]);
    assert.deepEqual({ precio: num(v.precio_venta), com: num(v.comision_b2b) }, { precio: 1_100_000, com: 90_000 });
    assert.deepEqual(recDe(numeros[0]), { recobro_total: 100_000, recobro_empresa: 100_000, recobro_aliado: 0 });
    assert.equal(sumaItems(numeros[0]), 1_100_000);
  });

  test("R6 (C) NETO con recobro 100.000 y distribución 50.000: exigible 970.000 = 1.100.000 − (80.000 + 50.000); sin distribución 1.010.000 = 1.100.000 − 90.000", async () => {
    const a = await ciclo(U.VENTA, { asistencia: b2b(A.AG10, "neta"), extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 50_000 } } } });
    const va = ventaDe(a.numeros[0]);
    assert.deepEqual({ modo: va.modo_compra, precio: num(va.precio_venta) }, { modo: "neta", precio: 970_000 });
    assert.deepEqual(recDe(a.numeros[0]), { recobro_total: 100_000, recobro_empresa: 50_000, recobro_aliado: 50_000 });
    assert.equal(sumaItems(a.numeros[0]), 970_000 + 130_000, "las tarifas del documento (NETO) suman el PVP con recobro antes de descontar la comisión del aliado");
    const b = await ciclo(U.VENTA, { asistencia: b2b(A.AG10, "neta"), extra: { recobro: { total: 100_000 } } });
    assert.equal(num(ventaDe(b.numeros[0]).precio_venta), 1_010_000);
  });

  test("R7 cotización interna a CLIENTE FINAL con recobro: 100 % empresa, sin aliado ni comisión", async () => {
    const { numeros } = await ciclo(U.VENTA, { extra: { recobro: { total: 100_000 } } });
    const v = ventaDe(numeros[0]);
    assert.deepEqual({ canal: v.canal, aliado: v.aliado_id, precio: num(v.precio_venta), com: v.comision_b2b }, { canal: "B2C", aliado: null, precio: 1_100_000, com: null });
    assert.deepEqual(recDe(numeros[0]), { recobro_total: 100_000, recobro_empresa: 100_000, recobro_aliado: 0 });
    assert.equal(comisionesDe(numeros[0]).length, 0);
    assert.equal(sumaItems(numeros[0]), 1_100_000);
  });

  test("R8 varios hoteles y contratos: el recobro 100.000,01 se reparte entre los 4 adultos al centavo y la participación 50.001 (pesos enteros) entre los dos contratos sin perder ni crear un centavo; el reintento repite exactamente", async () => {
    const { id, numeros } = await ciclo(U.VENTA, { hoteles: [10201, 10202], asistencia: b2b(A.AG10, "comisionable"), extra: { recobro: { total: 100_000.01, participacion: { modo: "valor", valor: 50_001 } } } });
    assert.equal(numeros.length, 2, "un contrato por destino");
    const vs = numeros.map((n) => ({ n, v: ventaDe(n), r: recDe(n) }));
    assert.equal(vs.reduce((s, x) => s + cents(x.r.recobro_total), 0), 10_000_001, "la suma de recobros = el recobro");
    assert.equal(vs.reduce((s, x) => s + cents(x.r.recobro_aliado), 0), 5_000_100, "la suma de participaciones = la participación");
    assert.equal(vs.reduce((s, x) => s + cents(x.v.precio_venta), 0), 160_000_000 + 10_000_001, "PVP 1.000.000 + 600.000 + recobro");
    for (const x of vs) {
      assert.equal(cents(x.r.recobro_empresa) + cents(x.r.recobro_aliado), cents(x.r.recobro_total), `${x.n}: empresa + aliado = recobro`);
      assert.ok(cents(x.r.recobro_aliado) <= cents(x.r.recobro_total), `${x.n}: la participación no excede su recobro`);
      assert.equal(Math.round(sumaItems(x.n) * 100), cents(x.v.precio_venta), `${x.n}: el documento suma exactamente su precio`);
    }
    const antes = foto();
    const r2 = await convertir(U.VENTA, id, 2, { monedaCobro: "COP" }, "por_destino");
    assert.equal(r2.ok, true, r2.error);
    assert.deepEqual(r2.numeros, numeros);
    assert.deepEqual(foto(), antes, "el reintento no duplica contratos, comisiones ni CxP");
  });

  test("R9 dos conversiones simultáneas de la misma cotización con recobro: un solo juego de contratos y de comisiones", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable"), extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 50_000 } } } });
    const antes = foto();
    const rs = await Promise.all([convertir(U.VENTA, id, 1), convertir(U.VENTA, id, 1)]);
    const ok = rs.filter((r) => r.ok);
    assert.ok(ok.length >= 1, JSON.stringify(rs));
    const nums = new Set(ok.flatMap((r) => r.numeros ?? []));
    assert.equal(nums.size, 1, "una sola numeración");
    assert.equal(foto().ventas, antes.ventas + 1);
    for (const r of rs) if (!r.ok) assert.match(r.error ?? "", /ya se está convirtiendo/);
    assert.equal(planesDe([...nums][0]), 1);
  });

  const grupos = (id: number) => json<{ resumenPrecios?: { modalidad: string; totalCentavos: number; unidades: { grupos: { tipo: string; cantidad: number; tarifaCentavos: number; subtotalCentavos: number; incluye: string[] }[]; ajusteCentavos: number }[] } }>(
    `select coalesce(detalle, '{}'::jsonb)::text from public.cotizaciones where id = ${id}`).resumenPrecios;

  test("R14 resumen NETO con recobro: tarifas por adulto exactas (500.000 + 50.000 de recobro − 40.000 ordinaria − 25.000 participación = 485.000) y total 970.000; sin distribución 505.000 y 1.010.000", async () => {
    const a = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "neta"), extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 50_000 } } } });
    const ra = grupos(a.id);
    assert.equal(ra?.modalidad, "neto");
    assert.equal(ra?.totalCentavos, 97_000_000);
    assert.deepEqual(ra!.unidades[0].grupos.map((g) => [g.tipo, g.cantidad, g.tarifaCentavos]), [["adulto", 2, 48_500_000]]);
    assert.equal(JSON.stringify(ra).toLowerCase().includes("recobro"), false, "el resumen no nombra el recobro");
    const b = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "neta"), extra: { recobro: { total: 100_000 } } });
    const rb = grupos(b.id);
    assert.equal(rb?.totalCentavos, 101_000_000);
    assert.deepEqual(rb!.unidades[0].grupos.map((g) => [g.tipo, g.cantidad, g.tarifaCentavos]), [["adulto", 2, 50_500_000]]);
  });

  test("R15 (C) NETO con adultos y NIÑO: la comisión ordinaria se reparte entre adultos Y niño (no solo adultos), la participación solo a adultos, y todo suma el exigible exacto", async () => {
    HOTELES[10201].nino = 200_000;
    const { id, plan } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "neta"), extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 50_000 } } } });
    // PVP 1.200.000 + recobro 100.000 = 1.300.000; base = 1.300.000 − 200.000 − 100.000 = 1.000.000; ordinaria 100.000; + participación 50.000 ⇒ exigible 1.150.000.
    assert.equal(plan!.total_exigible, 1_150_000);
    const r = grupos(id)!;
    assert.equal(r.totalCentavos, 115_000_000);
    const g = r.unidades[0].grupos;
    const nino = g.find((x) => x.tipo === "nino")!;
    assert.ok(nino.tarifaCentavos < 20_000_000, "el niño también lleva parte de la comisión ordinaria");
    assert.ok(nino.tarifaCentavos > 18_300_000 && nino.tarifaCentavos < 18_340_000, `niño ≈ 200.000 − 16.666,66: ${nino.tarifaCentavos}`);
    assert.equal(g.reduce((s, x) => s + x.subtotalCentavos, 0) + r.unidades[0].ajusteCentavos, 115_000_000);
    const adultosCent = g.filter((x) => x.tipo === "adulto").reduce((s, x) => s + x.subtotalCentavos, 0);
    assert.equal(adultosCent + nino.subtotalCentavos, 115_000_000);
    // La participación sale SOLO de los adultos: ellos pagan 50.000 menos que sin participación en total.
    assert.ok(adultosCent < 100_000_000 + 10_000_000 - 8_333_340 - 5_000_000 + 10, "adultos: 1.000.000 + recobro − ordinaria de adultos − participación");
  });

  test("R16 (C) NETO con adultos y niño CONVERTIDO: el documento del contrato suma el PVP con recobro (1.300.000: el recobro solo en las filas de adulto, el niño intacto) y lo exigible es 1.150.000", async () => {
    HOTELES[10201].nino = 200_000;
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "neta"), extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 50_000 } } } });
    uidSesion = U.VENTA;
    const r = (await convertirCotizacionCarrito(id, {
      agrupar: "todo", pasajeros: [...PASAJEROS, { nombres: "Nico", apellidos: "Pérez", tipoDoc: "TI", numeroDoc: "789", fechaNacimiento: "2020-01-01", nacionalidad: "Colombiana", esInfante: false }],
      asesorInterno: SESIONES[U.VENTA].nombre, asignaciones: [[1, 2, 3]], asignacionesTours: [], monedaCobro: "COP",
    })) as RespConvertir;
    assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    const it = itemsDe(n);
    assert.equal(it.filter((i) => i.ninos > 0).reduce((s, i) => s + i.ninos * Number(i.tarifa_nino), 0), 200_000, "el niño conserva su tarifa");
    assert.equal(sumaItems(n), 1_300_000);
    const v = ventaDe(n);
    assert.deepEqual({ modo: v.modo_compra, precio: num(v.precio_venta), com: num(v.comision_b2b) }, { modo: "neta", precio: 1_150_000, com: 150_000 });
    assert.deepEqual(recDe(n), { recobro_total: 100_000, recobro_empresa: 50_000, recobro_aliado: 50_000 });
  });

  test("R17 NETO con 2 adultos + 1 niño + tour (3 pax) y recobro: checkout → cotización → conversión → documento final, todo exacto", async () => {
    HOTELES[10201].nino = 200_000;
    const sid = servicio("Islas del Rosario 17", 100_000, 300_000);
    SERVICIOS[sid].pax = 3;
    const PERSONAS = [...PASAJEROS, { nombres: "Nico", apellidos: "Pérez", tipoDoc: "TI", numeroDoc: "789", fechaNacimiento: "2020-01-01", nacionalidad: "Colombiana", esInfante: false }];
    // PVP 1.200.000 (hotel, BNC 200.000) + 300.000 (tour) + recobro 100.000 = 1.600.000; participación 50.000 ⇒ base 1.300.000 ⇒ ordinaria 130.000 ⇒ al aliado 180.000 ⇒ exigible 1.420.000.
    const { id, plan } = await cotizarOk(U.VENTA, { hoteles: [10201], tours: [{ ...tourEntrada(sid, 10201), pax: 3 }], asistencia: b2b(A.AG10, "neta"), extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 50_000 } } } });
    assert.deepEqual({ pvp: plan!.pvp, exigible: plan!.total_exigible, comision: plan!.comision }, { pvp: 1_600_000, exigible: 1_420_000, comision: 180_000 });
    // Cotización: el resumen NETO guardado suma el exigible; adultos 573.333,34 + 573.333,33 (el centavo del reparto exacto va al primero) y niño 273.333,33; suman 1.420.000.
    const r = grupos(id)!;
    assert.equal(r.modalidad, "neto");
    assert.equal(r.totalCentavos, 142_000_000);
    const u = r.unidades[0];
    assert.deepEqual(u.grupos.map((g) => [g.tipo, g.cantidad, g.tarifaCentavos]), [["adulto", 1, 57_333_334], ["adulto", 1, 57_333_333], ["nino", 1, 27_333_333]]);
    assert.equal(u.grupos.reduce((s, g) => s + g.subtotalCentavos, 0) + u.ajusteCentavos, 142_000_000);
    assert.deepEqual(u.grupos[0].incluye, ["Islas del Rosario 17"]);
    assert.equal(JSON.stringify(r).toLowerCase().includes("recobro"), false);
    // Conversión.
    uidSesion = U.VENTA;
    const c = (await convertirCotizacionCarrito(id, { agrupar: "todo", pasajeros: PERSONAS, asesorInterno: SESIONES[U.VENTA].nombre, asignaciones: [[1, 2, 3]], asignacionesTours: [[1, 2, 3]], monedaCobro: "COP" })) as RespConvertir;
    assert.equal(c.ok, true, c.error);
    const n = c.numeros![0];
    const v = ventaDe(n);
    assert.deepEqual({ modo: v.modo_compra, precio: num(v.precio_venta), com: num(v.comision_b2b), imp: num(v.impuesto) }, { modo: "neta", precio: 1_420_000, com: 180_000, imp: 200_000 });
    assert.deepEqual(recDe(n), { recobro_total: 100_000, recobro_empresa: 50_000, recobro_aliado: 50_000 });
    // Documento final (contrato): ítems a PVP con recobro en las tarifas de adulto, sin nombrarlo; resumen congelado en NETO que suma lo exigible.
    assert.equal(sumaItems(n), 1_600_000);
    assert.equal(itemsDe(n).some((i) => /recobro/i.test(i.descripcion)), false);
    assert.equal(sql(`select count(*) from public.contrato_resumen_precios where numero_contrato = ${lit(n)}`), "1");
    const fila = JSON.parse(sql(`select resumen::text from public.contrato_resumen_precios where numero_contrato = ${lit(n)}`)) as { modalidad: string; totalCentavos: number; unidades: { grupos: { tipo: string; cantidad: number; tarifaCentavos: number }[] }[] };
    assert.equal(fila.modalidad, "neto");
    assert.equal(fila.totalCentavos, 142_000_000);
    assert.deepEqual(fila.unidades[0].grupos.map((g) => [g.tipo, g.cantidad, g.tarifaCentavos]), [["adulto", 1, 57_333_334], ["adulto", 1, 57_333_333], ["nino", 1, 27_333_333]]);
    assert.equal(JSON.stringify(fila).toLowerCase().includes("recobro"), false);
  });

  test("R18 un servicio del hotel que cubre a 2 de los 3 viajeros se rechaza ANTES de repartir (regla vigente de la cotización): no se inventa un reparto NETO", async () => {
    HOTELES[10201].nino = 200_000;
    const sid = servicio("Tour parcial 18", 100_000, 300_000); // pax 2 de 3
    const r = await cotizar(U.VENTA, { hoteles: [10201], tours: [tourEntrada(sid, 10201)], asistencia: b2b(A.AG10, "neta"), extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 50_000 } } } });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /debe cotizarse para los 3 viajeros del hotel/);
  });

  const resumenDe = (n: string) => sql(`select count(*) from public.contrato_resumen_precios where numero_contrato = ${lit(n)}`);
  const totalResumenCent = (n: string) => Number(sql(`select (resumen->>'totalCentavos')::bigint from public.contrato_resumen_precios where numero_contrato = ${lit(n)}`));

  test("R19 NETO con VARIOS hoteles (caso sin regla de reparto único): la cotización NO trae resumen por pasajero y deja el motivo; convertir «por destino» o «todo» funciona, cada contrato suma su exigible y ninguno lleva un resumen inventado", async () => {
    for (const agrupar of ["por_destino", "todo"] as const) {
      const { id, plan } = await cotizarOk(U.VENTA, { hoteles: [10201, 10202], asistencia: b2b(A.AG10, "neta"), extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 50_001 } } } });
      const d = detalleCot(id) as { resumenPrecios?: unknown; resumenPendiente?: string };
      assert.equal(d.resumenPrecios, undefined, "sin resumen NETO con varios hoteles");
      assert.match(d.resumenPendiente ?? "", /varios hoteles.*cada contrato muestra su total exigible/);
      const antes = foto();
      const r = await convertir(U.VENTA, id, 2, { monedaCobro: "COP" }, agrupar);
      assert.equal(r.ok, true, r.error);
      assert.equal(foto().ventas - antes.ventas, agrupar === "todo" ? 1 : 2);
      const exigibles = r.numeros!.map((n) => Math.round(num(ventaDe(n).precio_venta) * 100));
      assert.equal(exigibles.reduce((x, y) => x + y, 0), Math.round(plan!.total_exigible * 100), `${agrupar}: los contratos suman lo exigible de la cotización`);
      for (const n of r.numeros!) assert.equal(resumenDe(n), "0", `${n}: sin resumen guardado (no hay uno que mostrar)`);
      // Presentación que recibe cada contrato SIN resumen (NETO, #30/#75): total exigible del contrato y sus líneas prorrateadas a NETO por `valoresNetosDocumento`, sin tarifas PVP ni recobro.
      const { valoresNetosDocumento } = await import("../lib/contrato/valoresNetosDocumento.ts");
      for (const [i, n] of r.numeros!.entries()) {
        const filas = json<Record<string, unknown>[]>(`select coalesce(json_agg(row_to_json(t) order by id), '[]'::json)::text from (select * from public.contrato_items where numero_contrato = ${lit(n)}) t`);
        const valores = valoresNetosDocumento(filas as never, exigibles[i] / 100);
        assert.ok(valores, `${n}: el documento prorratea sus líneas a NETO`);
        assert.equal([...valores!.values()].reduce((x, v) => x + Math.round(v.total * 100), 0), exigibles[i], `${n}: las líneas NETO del documento suman EXACTAMENTE el exigible del contrato`);
      }
    }
  });

  test("R19b NETO de UN hotel con resumen guardado: si el resumen ya no cuadra con el contrato la conversión se RECHAZA antes de numerar (nunca vuelve en silencio al formato anterior); sin resumen (histórico) convierte como siempre", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "neta"), extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 50_000 } } } });
    assert.ok(grupos(id), "la cotización trae su resumen NETO");
    // Resumen alterado (+1 centavo en la tarifa de un grupo): ya no suma ni cuadra con lo exigible del contrato.
    sinFrontera(`update public.cotizaciones set detalle = jsonb_set(detalle, '{resumenPrecios,unidades,0,grupos,0,tarifaCentavos}', ((detalle->'resumenPrecios'->'unidades'->0->'grupos'->0->>'tarifaCentavos')::bigint + 1)::text::jsonb) where id = ${id}`);
    const antes = foto();
    const r = await convertir(U.VENTA, id, 1);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /resumen de precios por pasajero.*no coincide con el total de este contrato.*No se creó nada/);
    sinEscribir("resumen NETO alterado", antes, id);
    // Histórico: sin resumen guardado (cotización anterior a #94) el contrato nace con su presentación de siempre.
    sinFrontera(`update public.cotizaciones set detalle = detalle - 'resumenPrecios' where id = ${id}`);
    const h = await convertir(U.VENTA, id, 1);
    assert.equal(h.ok, true, h.error);
    assert.equal(resumenDe(h.numeros![0]), "0");
  });

  // ── R20 · FORMULARIO REAL (CheckoutPage en jsdom) → Server Actions REALES → Postgres/PostgREST ────────────────────────────────────────────────────────────────────────────────────────────────
  // Solo con PG102_FORMULARIO=1 (lanzador con PG_REACT=1: loader de React y acciones reales; ver supabase/scripts/test_pg_local.sh). El precio del hotel sigue siendo el del simulador (no es lo que se prueba).
  const FORM = { skip: process.env.PG102_FORMULARIO === "1" ? false : "solo con PG102_FORMULARIO=1 (loader de React)" };
  type FormularioReal = { container: HTMLElement; texto: () => string; desmontar: () => void };
  let domForm: unknown = null;
  async function montarFormulario(): Promise<FormularioReal & { act: (fn: () => Promise<void> | void) => Promise<void> }> {
    if (!domForm) {
      const { JSDOM } = await import("jsdom");
      const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
      domForm = dom;
      const g = global as unknown as Record<string, unknown>;
      g.window = dom.window; g.document = dom.window.document; g.HTMLElement = dom.window.HTMLElement; g.Element = dom.window.Element; g.Node = dom.window.Node;
      g.localStorage = dom.window.localStorage; g.getComputedStyle = dom.window.getComputedStyle; g.IS_REACT_ACT_ENVIRONMENT = true;
      Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
      g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0); g.cancelAnimationFrame = (id: number) => clearTimeout(id);
      g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    }
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: CheckoutPage } = await import("../app/tarifario/checkout/page.tsx");
    const { CartProvider } = await import("../lib/cart/CartContext.tsx");
    const h = HOTELES[10201];
    localStorage.setItem("dspacios_cart_v1", JSON.stringify([{
      id: "h1", tipo: "hotel", modulo: "porcion_terrestre", paqueteId: 10201, hotelId: 10201, bloqueoId: null, hotelNombre: h.nombre, destino: h.destino, fotoUrl: null,
      categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0,
      pax: 2, precio: h.pvp * 2, edadesMenores: [], moneda: "COP",
    }]));
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    const act = (React as unknown as { act: (fn: () => Promise<void> | void) => Promise<void> }).act;
    await act(async () => { root.render(React.createElement(CartProvider, null, React.createElement(CheckoutPage))); await new Promise((r) => setTimeout(r, 100)); });
    return { container, act, texto: () => (container.textContent ?? "").replace(/\s+/g, " "), desmontar: () => { act(() => root.unmount()); container.remove(); localStorage.clear(); } };
  }
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const escribirEn = (el: HTMLInputElement, valor: string) => { Object.getOwnPropertyDescriptor((global as unknown as { window: { HTMLInputElement: { prototype: object } } }).window.HTMLInputElement.prototype, "value")!.set!.call(el, valor); el.dispatchEvent(new ((global as unknown as { window: { Event: typeof Event } }).window.Event)("input", { bubbles: true })); };
  const porTestId = (c: HTMLElement, id: string) => c.querySelector<HTMLInputElement>(`[data-testid="${id}"]`);
  const botonF = (c: HTMLElement, t: RegExp | string) => [...c.querySelectorAll("button")].find((b) => (typeof t === "string" ? b.textContent === t : t.test(b.textContent ?? ""))) as HTMLButtonElement | undefined;
  async function esperar(fx: FormularioReal & { act: (fn: () => Promise<void> | void) => Promise<void> }, cond: () => boolean, que: string, ms = 12_000) {
    const t0 = Date.now();
    while (!cond()) { if (Date.now() - t0 > ms) assert.fail(`tiempo agotado esperando: ${que}. Texto: ${fx.texto().slice(0, 600)}`); await fx.act(async () => { await tick(80); }); }
  }
  async function llenarTitular(fx: FormularioReal & { act: (fn: () => Promise<void> | void) => Promise<void> }) {
    await fx.act(async () => {
      const por = (et: string) => [...fx.container.querySelectorAll("label")].find((l) => l.textContent === et)!.parentElement!.querySelector("input") as HTMLInputElement;
      escribirEn(por("Nombres *"), "Ana"); escribirEn(por("Apellidos *"), "Pérez");
      escribirEn(por([...fx.container.querySelectorAll("label")].some((l) => l.textContent === "Número de documento *") ? "Número de documento *" : "Documento *"), "123"); escribirEn(por("Teléfono / WhatsApp *"), "3000000000");
      await tick(30);
    });
  }
  const ultimaCotizacion = () => Number(sql("select max(id) from public.cotizaciones"));
  const planDe = (id: number) => json<{ b2bAsistido?: { origen?: string; modo_compra: string; comision: number; total_exigible: number; recobro?: { total: number; participacion: number; origen_participacion: string } } }>(`select payload::text from public.cotizaciones where id = ${id}`).b2bAsistido;

  test("R20a VENTA ASISTIDA desde el formulario: la liquidación de la revisión sale del servidor, el doble clic crea UNA cotización y la conversión coincide al peso", FORM, async () => {
    uidSesion = U.VENTA;
    const fx = await montarFormulario();
    try {
      const antes = totalCotizaciones();
      await esperar(fx, () => !!botonF(fx.container, "Aliado (B2B)"), "el selector de tipo de venta del personal");
      await fx.act(async () => { botonF(fx.container, "Aliado (B2B)")!.dispatchEvent(new (global as unknown as { window: { MouseEvent: typeof MouseEvent } }).window.MouseEvent("click", { bubbles: true })); await tick(30); });
      await esperar(fx, () => !!fx.container.querySelector("#asist-aliado"), "el selector de aliado");
      await fx.act(async () => { escribirEn(fx.container.querySelector<HTMLInputElement>("#asist-aliado")!, `${ALIADOS_NOMBRE[A.AG10]} · Agencia`); await tick(30); });
      await esperar(fx, () => !!porTestId(fx.container, "recobro-dist"), "el panel de recobro de la venta asistida");
      await fx.act(async () => { escribirEn(porTestId(fx.container, "recobro-total")!, "100.000"); escribirEn(porTestId(fx.container, "recobro-dist")!, "50.000"); await tick(30); });
      await esperar(fx, () => /Comisión ordinaria\s*\$\s*80\.000/.test(fx.texto()), "la revisión de términos con el recobro (servidor real)");
      const t = fx.texto();
      assert.match(t, /Recobro incluido\s*\$\s*100\.000/);
      assert.match(t, /Participación del aliado en el recobro \(50 % · indicada por el personal\)\s*\$\s*50\.000/);
      assert.match(t, /Total exigible \(PVP\)\s*\$\s*1\.100\.000/);
      await llenarTitular(fx);
      const generar = () => botonF(fx.container, /Generar cotización y enviar solicitud/)!;
      await esperar(fx, () => !generar().disabled, "el botón Generar habilitado");
      await fx.act(async () => { generar().click(); generar().click(); await tick(30); }); // doble clic en el mismo instante
      await esperar(fx, () => /¡Cotización generada!/.test(fx.texto()), "la cotización generada");
      assert.equal(totalCotizaciones() - antes, 1, "el doble clic creó UNA sola cotización");
      const id = ultimaCotizacion();
      const p = planDe(id)!;
      assert.deepEqual({ origen: p.origen, modo: p.modo_compra, com: p.comision, total: p.total_exigible, rec: p.recobro }, { origen: "asistida", modo: "comisionable", com: 130_000, total: 1_100_000, rec: { total: 100_000, participacion: 50_000, pct_participacion: 0.5, origen_participacion: "formulario" } });
      assert.doesNotMatch(JSON.stringify(json(`select detalle from public.cotizaciones where id = ${id}`)), /recobro/i, "el documento del cliente (detalle) no nombra el recobro");
      const r = await convertir(U.VENTA, id, 1);
      assert.equal(r.ok, true, r.error);
      assert.deepEqual(recDe(r.numeros![0]), { recobro_total: 100_000, recobro_empresa: 50_000, recobro_aliado: 50_000 });
      assert.equal(num(ventaDe(r.numeros![0]).precio_venta), 1_100_000);
      assert.equal(sumaItems(r.numeros![0]), 1_100_000);
    } finally { fx.desmontar(); }
  });

  test("R20b ALIADO DIRECTO desde el formulario: su participación sale del sistema (solo lectura), la liquidación de la revisión la muestra y NETO no pide recobro", FORM, async () => {
    uidSesion = U.AGENCIA;
    sql("insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion) values ('recobro_pct_aliado_b2b', 0.5, 'recobro', 'Distribución B2B') on conflict (parametro) do update set valor = 0.5");
    const fx = await montarFormulario();
    try {
      await esperar(fx, () => !!porTestId(fx.container, "recobro-total"), "el campo de recobro del aliado directo");
      assert.equal(porTestId(fx.container, "recobro-dist"), null, "el aliado no tiene dónde escribir su participación");
      assert.match(porTestId(fx.container, "recobro-participacion-sistema")!.textContent ?? "", /50 %.*no se puede cambiar/);
      const antes = totalCotizaciones();
      await fx.act(async () => { escribirEn(porTestId(fx.container, "recobro-total")!, "100000"); await tick(30); });
      await esperar(fx, () => /Participación del aliado en el recobro \(50 % · definida por el sistema\)\s*\$\s*50\.000/.test(fx.texto()), "la revisión de términos del aliado directo (servidor real)");
      assert.match(fx.texto(), /Venta B2B del aliado/);
      assert.match(fx.texto(), /Comisión ordinaria\s*\$\s*80\.000/);
      await llenarTitular(fx);
      const generar = () => botonF(fx.container, /Generar cotización y enviar solicitud/)!;
      await esperar(fx, () => !generar().disabled, "el botón Generar habilitado");
      await fx.act(async () => { generar().click(); await tick(30); });
      await esperar(fx, () => /¡Cotización generada!/.test(fx.texto()), "la cotización generada");
      assert.equal(totalCotizaciones() - antes, 1);
      const p = planDe(ultimaCotizacion())!;
      assert.deepEqual({ origen: p.origen, modo: p.modo_compra, com: p.comision, total: p.total_exigible, rec: p.recobro }, { origen: "aliado_directo", modo: "comisionable", com: 130_000, total: 1_100_000, rec: { total: 100_000, participacion: 50_000, pct_participacion: 0.5, origen_participacion: "parametro" } });
    } finally { fx.desmontar(); }
    // NETO del aliado: el formulario no ofrece recobro y la cotización queda como siempre (sin recobro).
    const fn = await montarFormulario();
    try {
      await esperar(fn, () => !!porTestId(fn.container, "recobro-total"), "el campo de recobro");
      await fn.act(async () => { escribirEn(porTestId(fn.container, "recobro-total")!, "100000"); await tick(30); });
      await fn.act(async () => { botonF(fn.container, "Contrato neto")!.click(); await tick(30); });
      assert.equal(porTestId(fn.container, "recobro-panel"), null, "NETO: no solicita recobro");
      const antes = totalCotizaciones();
      await llenarTitular(fn);
      const generar = () => botonF(fn.container, /Generar cotización y enviar solicitud/)!;
      await fn.act(async () => { generar().click(); await tick(30); });
      await esperar(fn, () => /¡Cotización generada!/.test(fn.texto()), "la cotización NETO generada");
      assert.equal(totalCotizaciones() - antes, 1);
      const p = planDe(ultimaCotizacion())!;
      assert.deepEqual({ origen: p.origen, modo: p.modo_compra, rec: p.recobro ?? null, total: p.total_exigible }, { origen: "aliado_directo", modo: "neta", rec: null, total: 920_000 });
    } finally { fn.desmontar(); }
  });

  test("R20d ACUERDO VIGENTE al generar (servidor real): si el acuerdo cambia entre la revisión y «Generar» NO se crea nada, se muestra la liquidación nueva y el siguiente envío la lleva", FORM, async () => {
    for (const caso of ["asistida", "directo"] as const) {
      uidSesion = caso === "asistida" ? U.VENTA : U.AGENCIA;
      sql("insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion) values ('recobro_pct_aliado_b2b', 0.5, 'recobro', 'Distribución B2B') on conflict (parametro) do update set valor = 0.5");
      const fx = await montarFormulario();
      try {
        if (caso === "asistida") {
          await esperar(fx, () => !!botonF(fx.container, "Aliado (B2B)"), "el selector de tipo de venta");
          await fx.act(async () => { botonF(fx.container, "Aliado (B2B)")!.click(); await tick(30); });
          await esperar(fx, () => !!fx.container.querySelector("#asist-aliado"), "el selector de aliado");
          await fx.act(async () => { escribirEn(fx.container.querySelector<HTMLInputElement>("#asist-aliado")!, `${ALIADOS_NOMBRE[A.AG10]} · Agencia`); await tick(30); });
          await esperar(fx, () => !!porTestId(fx.container, "recobro-dist"), "el panel de recobro");
          await fx.act(async () => { escribirEn(porTestId(fx.container, "recobro-total")!, "100000"); escribirEn(porTestId(fx.container, "recobro-dist")!, "50000"); await tick(30); });
        } else {
          await esperar(fx, () => !!porTestId(fx.container, "recobro-total"), "el campo de recobro");
          await fx.act(async () => { escribirEn(porTestId(fx.container, "recobro-total")!, "100000"); await tick(30); });
        }
        await esperar(fx, () => /Comisión ordinaria\s*\$\s*80\.000/.test(fx.texto()), `${caso}: la revisión con el 10 % vigente`);
        await llenarTitular(fx);
        const generar = () => botonF(fx.container, /Generar cotización y enviar solicitud/)!;
        await esperar(fx, () => !generar().disabled, "Generar habilitado");
        const antes = totalCotizaciones();
        sql(`update public.aliados set pct_comision = 0.15 where id = ${A.AG10}`); // el acuerdo vigente cambia DESPUÉS de la revisión
        try {
          await fx.act(async () => { generar().click(); await tick(30); });
          await esperar(fx, () => !!porTestId(fx.container, "terminos-cambiaron"), `${caso}: aviso de términos cambiados`);
          assert.equal(totalCotizaciones(), antes, `${caso}: no se creó ninguna cotización con lo que el usuario NO vio`);
          assert.match(fx.texto(), /Comisión ordinaria\s*\$\s*120\.000/, `${caso}: la liquidación mostrada ya es la nueva (15 %)`);
          await fx.act(async () => { generar().click(); await tick(30); });
          await esperar(fx, () => /¡Cotización generada!/.test(fx.texto()), `${caso}: la cotización con lo nuevo`);
          assert.equal(totalCotizaciones() - antes, 1);
          const p = planDe(ultimaCotizacion())!;
          assert.deepEqual({ com: p.comision, rec: p.recobro?.participacion }, { com: 170_000, rec: 50_000 }, `${caso}: 15 % sobre 800.000 + participación 50.000`);
        } finally { sql(`update public.aliados set pct_comision = 0.10 where id = ${A.AG10}`); }
      } finally { fx.desmontar(); }
    }
  });

  test("R20e CONSUMO del formulario con el servidor real: solicitudes a Supabase al abrir, escribir (ráfaga), cambiar modalidad y generar; nada en reposo", FORM, async () => {
    uidSesion = U.AGENCIA;
    sql("insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion) values ('recobro_pct_aliado_b2b', 0.5, 'recobro', 'Distribución B2B') on conflict (parametro) do update set valor = 0.5");
    const medir = async <T,>(que: string, fn: () => Promise<T>): Promise<{ r: T; n: number }> => { const a0 = solicitudesPostgrest; const r = await fn(); const n = solicitudesPostgrest - a0; console.log(`      CONSUMO formulario · ${que.padEnd(52)} solicitudes=${n}`); return { r, n }; };
    const abrir = await medir("abrir el checkout (aliado directo)", async () => { const x = await montarFormulario(); await esperar(x, () => !!porTestId(x.container, "recobro-total"), "el campo de recobro"); await x.act(async () => { await tick(700); }); return x; });
    const fx = abrir.r;
    try {
      const rafaga = await medir("5 teclas seguidas + pausa (1 revisión)", async () => {
        for (const t of ["1", "10", "100", "1000", "100000"]) await fx.act(async () => { escribirEn(porTestId(fx.container, "recobro-total")!, t); await tick(15); });
        await esperar(fx, () => /Comisión ordinaria/.test(fx.texto()), "la revisión de términos");
        await fx.act(async () => { await tick(300); });
      });
      const neto = await medir("cambiar a NETO (sin recobro: 0 revisiones)", async () => { await fx.act(async () => { botonF(fx.container, "Contrato neto")!.click(); await tick(900); }); });
      const vuelta = await medir("volver a comisión con recobro escrito (1 revisión)", async () => { await fx.act(async () => { botonF(fx.container, "Contrato comisionable")!.click(); await tick(30); }); await esperar(fx, () => /Comisión ordinaria/.test(fx.texto()), "la revisión"); await fx.act(async () => { await tick(300); }); });
      await llenarTitular(fx);
      const reposo = await medir("2 s en reposo", async () => { await fx.act(async () => { await tick(2000); }); });
      const generar = () => botonF(fx.container, /Generar cotización y enviar solicitud/)!;
      await esperar(fx, () => !generar().disabled, "Generar habilitado");
      const gen = await medir("generar (1 cotización)", async () => { await fx.act(async () => { generar().click(); await tick(30); }); await esperar(fx, () => /¡Cotización generada!/.test(fx.texto()), "la cotización generada"); });
      assert.equal(reposo.n, 0, "en reposo el formulario no hace ninguna solicitud");
      assert.equal(neto.n, 0, "NETO del aliado (sin recobro): ninguna solicitud");
      assert.ok(rafaga.n <= 10 && vuelta.n <= 10, `una revisión = una cotización en modo captura (medido 9 y 9; límite 10; aquí ${rafaga.n} y ${vuelta.n})`);
      assert.ok(gen.n <= 19, `generar (medido 18; límite 19; aquí ${gen.n})`);
      assert.ok(abrir.n <= 12, `abrir ≤ 12 solicitudes (medido ${abrir.n})`);
    } finally { fx.desmontar(); }
  });

  // ── R21 · ENVÍO CONCURRENTE (dos pestañas): el cerrojo del navegador no protege al servidor ──────────────────────────────────────────────────────────────────────────────────────────────
  const crm = () => Number(sql("select count(*) from public.crm_contactos"));
  const uuidNuevo = () => sql("select gen_random_uuid()");
  test("R21a SIN clave de envío (flujos que no la mandan): dos envíos simultáneos crean DOS cotizaciones — comportamiento de siempre, documentado", async () => {
    const antes = totalCotizaciones();
    const [x, y] = await Promise.all([cotizar(U.VENTA, {}), cotizar(U.VENTA, {})]);
    assert.equal(x.ok && y.ok, true);
    assert.equal(totalCotizaciones() - antes, 2, "sin clave no hay nada que los identifique como la misma intención");
  });
  test("R21b CON la misma clave: dos envíos simultáneos desde dos pestañas crean UNA cotización; el otro recibe «ya generada» con el código de la existente; un reintento posterior tampoco crea otra", async () => {
    const clave = uuidNuevo();
    const antes = totalCotizaciones(), crmAntes = crm();
    const [x, y] = await Promise.all([cotizar(U.VENTA, { extra: { claveEnvio: clave } }), cotizar(U.VENTA, { extra: { claveEnvio: clave } })]);
    const ok = [x, y].filter((r) => r.ok), dup = [x, y].filter((r) => !r.ok) as unknown as { tipo?: string; error: string; cotizacion?: { codigo: string; url: string } }[];
    assert.equal(ok.length, 1, "exactamente una pestaña crea la cotización");
    assert.equal(dup.length, 1);
    assert.equal(dup[0].tipo, "envio_duplicado");
    assert.equal(totalCotizaciones() - antes, 1, "UNA sola cotización");
    assert.equal(dup[0].cotizacion!.codigo, ok[0].cotizacion!.codigo, "la existente");
    assert.match(dup[0].error, /ya se generó/);
    assert.equal(sql(`select count(*) from public.cotizaciones where clave_envio = '${clave}'`), "1");
    const crmTras = crm();
    const reintento = (await cotizar(U.VENTA, { extra: { claveEnvio: clave } })) as unknown as { ok: boolean; tipo?: string };
    assert.deepEqual({ ok: reintento.ok, tipo: reintento.tipo }, { ok: false, tipo: "envio_duplicado" });
    assert.equal(totalCotizaciones() - antes, 1, "el reintento no crea otra");
    assert.equal(crm(), crmTras, "ni un contacto de CRM más");
    assert.ok(crmTras - crmAntes <= 1, "el CRM recibió a lo sumo UN contacto por la intención");
  });
  test("R21c claves distintas = intenciones distintas (dos cotizaciones legítimas); una clave que no es UUID se rechaza sin crear nada", async () => {
    const antes = totalCotizaciones();
    const [x, y] = await Promise.all([cotizar(U.VENTA, { extra: { claveEnvio: uuidNuevo() } }), cotizar(U.VENTA, { extra: { claveEnvio: uuidNuevo() } })]);
    assert.equal(x.ok && y.ok, true);
    assert.equal(totalCotizaciones() - antes, 2);
    const mala = await cotizar(U.VENTA, { extra: { claveEnvio: "no-es-un-uuid" } });
    assert.equal(mala.ok, false);
    assert.match(mala.error ?? "", /clave de envío no es válida/);
    assert.equal(totalCotizaciones() - antes, 2);
  });
  test("R21e DOS PESTAÑAS del formulario real (mismo carrito, mismos datos, mismo almacenamiento): al generar a la vez se crea UNA cotización y la otra pestaña muestra «ya generada» con su código", FORM, async () => {
    uidSesion = U.VENTA;
    const antes = totalCotizaciones();
    const t1 = await montarFormulario();
    const t2 = await montarFormulario(); // misma página, mismo localStorage del navegador: es lo que comparten dos pestañas
    try {
      for (const t of [t1, t2]) {
        await esperar(t, () => !!porTestId(t.container, "recobro-total"), "el campo de recobro");
        await t.act(async () => { escribirEn(porTestId(t.container, "recobro-total")!, "100000"); await tick(30); });
        await llenarTitular(t);
      }
      const gen = (t: FormularioReal) => botonF(t.container, /Generar cotización y enviar solicitud/)!;
      await esperar(t1, () => !gen(t1).disabled && !gen(t2).disabled, "ambas pestañas listas para generar");
      // Un solo act() (React no admite act() solapados): los dos clics salen en el mismo instante y las dos acciones del servidor corren a la vez.
      await t1.act(async () => { gen(t1).click(); gen(t2).click(); await tick(30); });
      await esperar(t1, () => /¡Cotización generada!/.test(t1.texto()) || /¡Cotización generada!/.test(t2.texto()) || !!porTestId(t1.container, "error-checkout") || !!porTestId(t2.container, "error-checkout"), "una pestaña genera la cotización");
      for (const t of [t1, t2]) { const e = porTestId(t.container, "error-checkout"); if (e) assert.fail(`error en una pestaña: ${e.textContent}`); }
      await esperar(t1, () => !!porTestId(t1.container, "envio-duplicado") || !!porTestId(t2.container, "envio-duplicado"), "la otra pestaña muestra «ya generada»");
      assert.equal(totalCotizaciones() - antes, 1, "UNA sola cotización entre las dos pestañas");
      const dup = porTestId(t1.container, "envio-duplicado") ?? porTestId(t2.container, "envio-duplicado");
      const codigo = sql("select codigo from public.cotizaciones order by id desc limit 1");
      assert.match(dup!.textContent ?? "", new RegExp(`la cotización ${codigo} ya existe`));
    } finally { t1.desmontar(); t2.desmontar(); }
  });

  test("R21f la clave está ligada al USUARIO y al CONTENIDO: misma intención = ya generada; otro contenido u otro usuario con la misma clave se RECHAZAN (sin crear nada ni revelar la cotización existente)", async () => {
    const clave = uuidNuevo();
    const antes = totalCotizaciones();
    const a = await cotizar(U.VENTA, { extra: { claveEnvio: clave } });
    assert.equal(a.ok, true, a.error);
    const huella = sql(`select huella_envio from public.cotizaciones where clave_envio = '${clave}'`);
    assert.match(huella, /^[0-9a-f]{64}$/, "el servidor guardó la huella SHA-256 del contenido");
    assert.equal(sql(`select actor_envio from public.cotizaciones where clave_envio = '${clave}'`), U.VENTA, "y quién la usó");
    // mismo usuario, OTRA compra (otro hotel) con la misma clave
    const b = (await cotizar(U.VENTA, { hoteles: [10202], extra: { claveEnvio: clave } })) as unknown as { ok: boolean; tipo?: string; error?: string; cotizacion?: unknown };
    assert.equal(b.ok, false);
    assert.equal(b.tipo, "clave_en_uso", "no es «ya generada»: es OTRA solicitud");
    assert.match(b.error ?? "", /ya se usó en otra solicitud/);
    assert.equal(b.cotizacion, undefined, "no revela la cotización existente");
    assert.ok(!(b.error ?? "").includes(a.cotizacion!.codigo), "ni su código");
    // OTRO usuario con el mismo contenido y la misma clave
    const c = (await cotizar(U.ADMIN, { extra: { claveEnvio: clave } })) as unknown as { ok: boolean; tipo?: string; error?: string };
    assert.equal(c.ok, false);
    assert.equal(c.tipo, "clave_en_uso");
    assert.match(c.error ?? "", /ya se usó en otra solicitud/);
    assert.equal(totalCotizaciones() - antes, 1, "ni la otra compra ni el otro usuario crearon nada");
    // la misma intención (mismo usuario y mismo contenido) sí es «ya generada»
    const d = (await cotizar(U.VENTA, { extra: { claveEnvio: clave } })) as unknown as { ok: boolean; tipo?: string; cotizacion?: { codigo: string } };
    assert.deepEqual({ ok: d.ok, tipo: d.tipo, codigo: d.cotizacion?.codigo }, { ok: false, tipo: "envio_duplicado", codigo: a.cotizacion!.codigo });
    assert.equal(totalCotizaciones() - antes, 1);
    // el orden de las claves del JSON no cambia la intención
    const { huellaDeEnvio } = await import("../lib/cotizacion/huellaEnvio.ts");
    assert.equal(huellaDeEnvio({ a: 1, b: { c: 2, d: 3 } }), huellaDeEnvio({ b: { d: 3, c: 2 }, a: 1 }));
  });

  test("R21g REINTENTO tras un ERROR y reutilización de la clave con contenido distinto: un fallo no consume la clave; tras generar, otro contenido no la reutiliza", async () => {
    const clave = uuidNuevo();
    const antes = totalCotizaciones();
    // Primer intento FALLA (control_vuelo no puede capturar recobro): nada se guarda, la clave queda libre.
    const mal = await cotizar(U.CTRL, { extra: { claveEnvio: clave, recobro: { total: 100_000 } } });
    assert.equal(mal.ok, false);
    assert.match(mal.error ?? "", /solo lo puede capturar/);
    assert.equal(sql(`select count(*) from public.cotizaciones where clave_envio = '${clave}'`), "0", "el fallo no consumió la clave");
    assert.equal(totalCotizaciones(), antes);
    // Reintento corregido con la MISMA clave (otro contenido: sin recobro): se crea.
    const bien = await cotizar(U.CTRL, { extra: { claveEnvio: clave } });
    assert.equal(bien.ok, true, bien.error);
    assert.equal(totalCotizaciones() - antes, 1);
    // Ahora la clave pertenece a ESE contenido: reutilizarla con otro contenido se rechaza…
    const otro = (await cotizar(U.CTRL, { hoteles: [10202], extra: { claveEnvio: clave } })) as unknown as { ok: boolean; tipo?: string; error?: string };
    assert.equal(otro.ok, false);
    assert.equal(otro.tipo, "clave_en_uso");
    assert.match(otro.error ?? "", /ya se usó en otra solicitud/);
    // …y repetir el mismo contenido es «ya generada».
    const igual = (await cotizar(U.CTRL, { extra: { claveEnvio: clave } })) as unknown as { ok: boolean; tipo?: string };
    assert.deepEqual({ ok: igual.ok, tipo: igual.tipo }, { ok: false, tipo: "envio_duplicado" });
    assert.equal(totalCotizaciones() - antes, 1);
  });

  test("R21h PESTAÑAS DEL MISMO NAVEGADOR con la identidad que calcula el formulario: creación simultánea desde almacén VACÍO, pestaña ANTIGUA tras el éxito (incluso pasada una hora), compra distinta, «Es otra compra» sin convertir en compra nueva a las pestañas antiguas, y aislamiento por usuario; otro NAVEGADOR no se deduplica", async () => {
    const { crearContextoEnvio, claveParaEnvio, nuevaCompra, enviarConClave } = await import("../lib/cotizacion/claveEnvio.ts");
    const { randomUUID } = await import("node:crypto");
    const entradaDe = (hoteles: number[] = [10201]) => ({ items: hoteles.map((h) => itemEntrada(h, undefined, null)), tours: [], cliente: CLIENTE });
    /** Un NAVEGADOR: un almacén y un candado COMPARTIDOS por sus pestañas (localStorage + Web Locks) y un reloj propio. */
    const navegador = () => {
      const m = new Map<string, string>(); const reloj = { t: 1_000_000 }; let cola: Promise<unknown> = Promise.resolve();
      const candado = <T,>(fn: () => T) => { const p = cola.then(fn); cola = p.catch(() => undefined); return p; };
      const almacen = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
      return { reloj, pestana: () => crearContextoEnvio(almacen, () => randomUUID(), { candado, ahora: () => reloj.t }) };
    };
    const enviar = (u: string, clave: string, hoteles?: number[]) => cotizar(u, { ...(hoteles ? { hoteles } : {}), extra: { claveEnvio: clave } }) as unknown as Promise<{ ok: boolean; tipo?: string; error?: string; cotizacion?: { codigo: string } }>;
    const antes = totalCotizaciones();

    // 1) Tres pestañas del MISMO navegador abiertas con el almacén VACÍO (A, B y la antigua); A y B envían a la vez: UNA cotización; la otra respuesta es «ya generada» con el código existente.
    const N1 = navegador();
    const A = N1.pestana(), B = N1.pestana(), vieja = N1.pestana();
    N1.reloj.t += 10;
    const [kA, kB] = await Promise.all([claveParaEnvio(entradaDe(), A), claveParaEnvio(entradaDe(), B)]);
    assert.equal(kA, kB, "dos pestañas con el almacén vacío resuelven la MISMA identidad (candado del navegador)");
    const [x, y] = await Promise.all([enviar(U.VENTA, kA), enviar(U.VENTA, kB)]);
    assert.equal(totalCotizaciones() - antes, 1, "UNA sola cotización para la misma intención");
    assert.equal([x, y].filter((r) => r.ok).length, 1);
    const codigo = sql(`select codigo from public.cotizaciones where clave_envio = '${kA}'`);
    assert.equal([x, y].find((r) => !r.ok)!.cotizacion?.codigo, codigo);

    // 2) La pestaña ANTIGUA envía DESPUÉS del éxito, incluso 61 minutos más tarde (el cambio de hora no rompe nada): reconoce la intención cumplida.
    N1.reloj.t += 61 * 60_000;
    const tarde = await enviar(U.VENTA, await claveParaEnvio(entradaDe(), vieja));
    assert.deepEqual({ ok: tarde.ok, tipo: tarde.tipo, codigo: tarde.cotizacion?.codigo }, { ok: false, tipo: "envio_duplicado", codigo });
    assert.equal(totalCotizaciones() - antes, 1);

    // 3) Una compra DISTINTA (otro hotel) es otra identidad y otra cotización.
    const otra = await enviar(U.VENTA, await claveParaEnvio(entradaDe([10202]), A), [10202]);
    assert.equal(otra.ok, true, otra.error);
    assert.equal(totalCotizaciones() - antes, 2, "dos compras distintas = dos cotizaciones");

    // 4) «Es otra compra» desde A: una intención NUEVA solo para A. B y la antigua (abiertas ANTES) siguen siendo la original (ya generada): NO se vuelven compras nuevas. Una pestaña abierta DESPUÉS usa la nueva.
    N1.reloj.t += 1000;
    const kNueva = await nuevaCompra(entradaDe(), A);
    assert.notEqual(kNueva, kA);
    const nueva = await enviar(U.VENTA, await claveParaEnvio(entradaDe(), A));
    assert.equal(nueva.ok, true, nueva.error);
    assert.equal(totalCotizaciones() - antes, 3);
    N1.reloj.t += 1000;
    const antigua = await enviar(U.VENTA, await claveParaEnvio(entradaDe(), N1.pestana())); // abierta DESPUÉS de la compra nueva: usa la nueva (ya generada)
    assert.equal(antigua.tipo, "envio_duplicado");
    const bAntes = await enviar(U.VENTA, await claveParaEnvio(entradaDe(), B)); // B ya había fijado la original
    assert.deepEqual({ ok: bAntes.ok, tipo: bAntes.tipo, codigo: bAntes.cotizacion?.codigo }, { ok: false, tipo: "envio_duplicado", codigo });
    assert.equal(totalCotizaciones() - antes, 3, "ninguna pestaña antigua se convirtió en compra nueva");

    // 5) Alcance: OTRO navegador (almacén distinto) con el mismo contenido NO se deduplica; es otra intención. (No es deduplicación universal.)
    const N2 = navegador();
    const otroNav = await enviar(U.VENTA, await claveParaEnvio(entradaDe(), N2.pestana()));
    assert.equal(otroNav.ok, true, otroNav.error);
    assert.equal(totalCotizaciones() - antes, 4);

    // 6) Aislamiento por usuario: otro usuario que reciba la MISMA clave (la identidad quedó fijada en su formulario) es rechazado SIN revelar nada; el formulario pasa a otra identidad y crea SU cotización.
    const crudo = await enviar(U.ADMIN, kA) as unknown as { ok: boolean; tipo?: string; cotizacion?: unknown; error?: string };
    assert.deepEqual({ ok: crudo.ok, tipo: crudo.tipo, cotizacion: crudo.cotizacion }, { ok: false, tipo: "clave_en_uso", cotizacion: undefined });
    assert.ok(!(crudo.error ?? "").includes(codigo));
    const ctxAdmin = navegador().pestana();
    ctxAdmin.fijadas.set((await import("../lib/cotizacion/claveEnvio.ts")).huellaDeEntrada(entradaDe()), kA);
    const propia = await enviarConClave(entradaDe(), ctxAdmin, (k) => enviar(U.ADMIN, k), (r) => r.tipo === "clave_en_uso");
    assert.equal(propia.ok, true, propia.error);
    assert.equal(totalCotizaciones() - antes, 5, "el otro usuario obtuvo SU cotización tras cambiar de identidad; nada de lo de VENTA cambió");
    assert.equal(sql(`select count(*) from public.cotizaciones where actor_envio = '${U.ADMIN}'`), "1");
  });

  test("R21i DOS PESTAÑAS del formulario real: la segunda envía DESPUÉS del éxito de la primera y ve «ya generada»; «Es otra compra» permite una segunda cotización; la clave y la huella siguen ligadas al usuario", FORM, async () => {
    uidSesion = U.VENTA;
    const antes = totalCotizaciones();
    const t1 = await montarFormulario();
    const t2 = await montarFormulario(); // pestaña abierta antes del envío de la primera
    try {
      for (const t of [t1, t2]) {
        await esperar(t, () => !!porTestId(t.container, "recobro-total"), "el campo de recobro");
        await t.act(async () => { escribirEn(porTestId(t.container, "recobro-total")!, "100000"); await tick(30); });
        await llenarTitular(t);
      }
      const gen = (t: FormularioReal) => botonF(t.container, /Generar cotización y enviar solicitud/)!;
      await esperar(t1, () => !gen(t1).disabled && !gen(t2).disabled, "ambas pestañas listas");
      // Primera pestaña: éxito.
      await t1.act(async () => { gen(t1).click(); await tick(30); });
      await esperar(t1, () => /¡Cotización generada!/.test(t1.texto()) || !!porTestId(t1.container, "error-checkout"), "la primera pestaña genera la cotización");
      assert.equal(porTestId(t1.container, "error-checkout"), null);
      assert.equal(totalCotizaciones() - antes, 1);
      // Segunda pestaña (antigua): misma intención, ya cumplida.
      await t2.act(async () => { gen(t2).click(); await tick(30); });
      await esperar(t2, () => !!porTestId(t2.container, "envio-duplicado") || !!porTestId(t2.container, "error-checkout"), "la pestaña antigua reconoce la intención cumplida");
      assert.equal(porTestId(t2.container, "error-checkout"), null);
      const codigo = sql("select codigo from public.cotizaciones order by id desc limit 1");
      assert.match(porTestId(t2.container, "envio-duplicado")!.textContent ?? "", new RegExp(`la cotización ${codigo} ya existe`));
      assert.equal(totalCotizaciones() - antes, 1, "la misma intención sigue siendo UNA cotización");
      // Compra nueva EXPLÍCITA desde la misma pestaña.
      await t2.act(async () => { porTestId(t2.container, "otra-compra")!.click(); await tick(30); });
      assert.equal(porTestId(t2.container, "envio-duplicado"), null);
      await esperar(t2, () => !gen(t2).disabled, "lista para generar la compra nueva");
      await t2.act(async () => { gen(t2).click(); await tick(30); });
      await esperar(t2, () => /¡Cotización generada!/.test(t2.texto()) || !!porTestId(t2.container, "error-checkout"), "la compra nueva se genera");
      assert.equal(porTestId(t2.container, "error-checkout"), null);
      assert.equal(totalCotizaciones() - antes, 2, "dos compras (la segunda declarada explícitamente) = dos cotizaciones");
      assert.equal(sql(`select count(distinct clave_envio) || '/' || count(distinct actor_envio) from public.cotizaciones where id > (select max(id) - 2 from public.cotizaciones)`), "2/1", "dos claves distintas, un solo usuario");
    } finally { t1.desmontar(); t2.desmontar(); }
  });

  test("R21d CONVERSIÓN simultánea desde dos pestañas (recobro + comisión B2B): un solo juego de contratos, UN plan de comisión y ninguna fila de comisión duplicada", async () => {
    const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable"), extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 50_000 } } } });
    const antes = foto();
    const rs = await Promise.all([convertir(U.VENTA, id, 1), convertir(U.VENTA, id, 1), convertir(U.VENTA, id, 1)]);
    const ok = rs.filter((r) => r.ok);
    assert.ok(ok.length >= 1, JSON.stringify(rs));
    for (const r of rs) if (!r.ok) assert.match(r.error ?? "", /ya se está convirtiendo/);
    const nums = new Set(ok.flatMap((r) => r.numeros ?? []));
    assert.equal(nums.size, 1, "un solo contrato");
    assert.equal(foto().ventas - antes.ventas, 1);
    const n = [...nums][0];
    assert.equal(planesDe(n), 1, "UN plan de comisión");
    assert.equal(comisionesDe(n).length, 0, "ninguna fila exigible duplicada (PVP pendiente: nace al confirmar)");
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`), sql(`select count(distinct (servicio, tipo_proveedor)) from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`), "sin cuentas por pagar duplicadas");
    // y la comisión materializada al confirmar tampoco se duplica aunque dos pestañas confirmen a la vez
    const sb = clienteLocal(jwt({ role: "authenticated", sub: U.ADMIN }), { id: U.ADMIN, email: SESIONES[U.ADMIN].email });
    await Promise.all([sb.rpc("confirmar_venta", { p_numero: n }), sb.rpc("confirmar_venta", { p_numero: n })]);
    assert.equal(comisionesDe(n).length, 1, "UNA sola fila de comisión tras confirmar desde dos pestañas");
  });

  test("R20c si falta la configuración de la participación del aliado, el formulario NO ofrece el recobro y lo dice (no inventa un porcentaje)", FORM, async () => {
    uidSesion = U.AGENCIA;
    const guardado = sql("select valor from public.parametros_tributarios where parametro = 'recobro_pct_aliado_b2b'") || "0.5";
    try {
      sql("delete from public.parametros_tributarios where parametro = 'recobro_pct_aliado_b2b'");
      const fx = await montarFormulario();
      try {
        await esperar(fx, () => !!porTestId(fx.container, "recobro-ctx-error"), "el aviso de configuración");
        assert.equal(porTestId(fx.container, "recobro-panel"), null);
        assert.match(porTestId(fx.container, "recobro-ctx-error")!.textContent ?? "", /recobro_pct_aliado_b2b/);
      } finally { fx.desmontar(); }
    } finally {
      sql(`insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion) values ('recobro_pct_aliado_b2b', ${guardado}, 'recobro', 'Distribución B2B') on conflict (parametro) do update set valor = excluded.valor`);
    }
  });

  test("R10 permisos y manipulación del formulario: se rechaza ANTES de crear nada", async () => {
    const casos: [string, string, Parameters<typeof cotizar>[1], RegExp][] = [
      ["control_vuelo no captura recobro", U.CTRL, { extra: { recobro: { total: 100_000 } } }, /solo lo puede capturar/],
      ["el aliado no puede enviar su participación", U.AGENCIA, { extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 90_000 } } } }, /configuración del sistema/],
      ["sin aliado el recobro no se distribuye", U.VENTA, { extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 1_000 } } } }, /no se distribuye/],
      ["recobro negativo", U.VENTA, { extra: { recobro: { total: -5 } } }, /recobro/i],
      ["recobro no numérico", U.VENTA, { extra: { recobro: { total: "abc" } } }, /recobro/i],
      ["recobro mal formado", U.VENTA, { extra: { recobro: [] } }, /recobro/i],
      ["minorista con recobro", U.MINORISTA, { extra: { recobro: { total: 100_000 } } }, /./],
      ["usuario inactivo con recobro", U.INACTIVO, { extra: { recobro: { total: 100_000 } } }, /./],
    ];
    for (const [que, sesion, o, esperado] of casos) {
      const antes = totalCotizaciones(); const f0 = foto();
      const r = await cotizar(sesion, o);
      assert.equal(r.ok, false, que);
      assert.match(r.error ?? "", esperado, que);
      assert.equal(totalCotizaciones(), antes, `${que}: ninguna cotización`);
      assert.deepEqual(foto(), f0, `${que}: nada escrito`);
    }
  });

  test("R10b participación MAYOR que el recobro (200.000 de 100.000): el servidor la ACOTA al recobro (regla de #97) y la base recibe ya el valor acotado — mismo resultado en plan, contrato, comisión y liquidación", async () => {
    // Capas: (1) el carrito no tiene campo de participación para el aliado directo (su % sale del parámetro) y la venta asistida la manda en el cuerpo de la acción; (2) el SERVIDOR (`participacionAliado`)
    // acota a [0, recobro] y es lo único que se sella en el plan y se escribe en ventas; (3) la BASE (305) recibe ese valor y además RECHAZA un dato inconsistente (> recobro) si alguien lo escribe
    // por fuera del servidor (ver test_305: «participación mayor que el recobro: inconsistente, rechazada»). Aquí se prueba que las tres capas coinciden de punta a punta.
    const { id, plan } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable"), extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 200_000 } } } });
    assert.equal(plan!.recobro?.participacion, 100_000, "servidor: acotada al recobro");
    const r = await convertir(U.VENTA, id, 1);
    assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    assert.deepEqual(recDe(n), { recobro_total: 100_000, recobro_empresa: 0, recobro_aliado: 100_000 }, "contrato: toda la participación = el recobro, nada de la empresa");
    const p = json<{ recobro_aliado: number; base_comision: number; comision_ordinaria: number; total_aliado: number }>(`select row_to_json(t)::text from (select recobro_aliado, base_comision, comision_ordinaria, total_aliado from public.comision_plan where numero_contrato = ${lit(n)}) t`);
    // Recobro fuera de la base (1.100.000 − 200.000 − 100.000 = 800.000 ⇒ ordinaria 80.000) y la participación completa: 180.000 al aliado.
    assert.deepEqual({ ...p }, { recobro_aliado: 100_000, base_comision: 800_000, comision_ordinaria: 80_000, total_aliado: 180_000 }, "base: plan de comisión con el valor acotado");
    const c = await clienteLocal(jwt({ role: "authenticated", sub: U.ADMIN }), { id: U.ADMIN, email: SESIONES[U.ADMIN].email }).rpc("confirmar_venta", { p_numero: n });
    assert.equal(c.error, null, JSON.stringify(c.error));
    const [fila] = comisionesDe(n);
    assert.deepEqual({ rec: num(fila.recobro_total), pctRec: num(fila.pct_recobro_aliado) }, { rec: 100_000, pctRec: 1 }, "liquidación: el aliado recibe el 100 % del recobro");
  });

  test("R11 el parámetro de distribución ausente o inválido FALLA CERRADO para el aliado directo; sin recobro el aliado sigue cotizando; un aliado SIN ficha vinculada no captura recobro pero cotiza como siempre", async () => {
    const guardado = sql("select valor from public.parametros_tributarios where parametro = 'recobro_pct_aliado_b2b'");
    try {
      sql("delete from public.parametros_tributarios where parametro = 'recobro_pct_aliado_b2b'");
      const r = await cotizar(U.AGENCIA, { extra: { recobro: { total: 100_000 } } });
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /no está configurada|distribución del recobro/);
      const sin = await cotizar(U.AGENCIA, {});
      assert.equal(sin.ok, true, sin.error);
      sql("insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion) values ('recobro_pct_aliado_b2b', 1.5, 'recobro', 'x') on conflict (parametro) do update set valor = 1.5");
      const malo = await cotizar(U.AGENCIA, { extra: { recobro: { total: 100_000 } } });
      assert.equal(malo.ok, false, "un porcentaje fuera de 0-100 % no se adopta");
    } finally {
      sql(`insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion) values ('recobro_pct_aliado_b2b', ${guardado || "0.5"}, 'recobro', 'Distribución B2B') on conflict (parametro) do update set valor = excluded.valor`);
    }
    try {
      sql(`update public.usuarios set aliado_id = null where id = '${U.AGENCIA}'`);
      const r = await cotizar(U.AGENCIA, { extra: { recobro: { total: 100_000 } } });
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /solo lo puede capturar/);
      const ok = await cotizar(U.AGENCIA, {});
      assert.equal(ok.ok, true, ok.error);
      assert.equal(ok.b2bAsistido ?? null, null, "sin ficha vinculada: flujo de siempre");
    } finally {
      sql(`update public.usuarios set aliado_id = ${A.AG10} where id = '${U.AGENCIA}'`);
    }
  });

  test("R13 liquidación: al confirmar, la fila del aliado lleva el recobro y su participación (la distribución solo aparece ahí); la cuenta de cobro suma 80.000 + 50.000; el documento al cliente no dice «recobro»", async () => {
    const { id, numeros } = await ciclo(U.AGENCIA, { extra: { recobro: { total: 100_000 } } });
    const n = numeros[0];
    const c = await clienteLocal(jwt({ role: "authenticated", sub: U.ADMIN }), { id: U.ADMIN, email: SESIONES[U.ADMIN].email }).rpc("confirmar_venta", { p_numero: n });
    assert.equal(c.error, null, JSON.stringify(c.error));
    const [fila] = comisionesDe(n);
    assert.ok(fila, "la confirmación materializó la fila de comisión");
    assert.deepEqual({ bruto: num(fila.precio_venta), base: num(fila.base_comision), pct: num(fila.pct_comision), rec: num(fila.recobro_total), pctRec: num(fila.pct_recobro_aliado), desc: fila.descontada_en_precio },
      { bruto: 1_100_000, base: 800_000, pct: 0.1, rec: 100_000, pctRec: 0.5, desc: false });
    uidSesion = U.AGENCIA;
    const { resolverComisionB2B } = await import("../lib/finanzas/comisionResolver.ts");
    const r = (await resolverComisionB2B(n)) as { tipo: string; tipoAsesorEfectivo?: string; esInterno?: boolean; detalle: { comisionBase: number | null; recobroAliado: number | null; totalPagar: number } } | null;
    assert.equal(r?.tipo, "comision");
    assert.deepEqual({ base: r!.detalle.comisionBase, rec: r!.detalle.recobroAliado, total: r!.detalle.totalPagar }, { base: 80_000, rec: 50_000, total: 130_000 });
    // Aliado AGENCIA (persona jurídica): la liquidación existe y es exacta, pero su documento de cobro es la FACTURA electrónica, no la cuenta de cobro: la página de la cuenta de cobro
    // (`portal/comision/[numero]`) solo lo rechaza cuando el tipo efectivo es «agencia» y quien mira NO es personal interno. Aquí se fija ese par de condiciones con la sesión de la agencia…
    assert.deepEqual({ tipo: r!.tipoAsesorEfectivo, interno: r!.esInterno }, { tipo: "agencia", interno: false }, "la agencia ve el aviso de factura electrónica, no la cuenta de cobro");
    // …y el personal interno, con la MISMA liquidación, sí puede abrirla en nombre del aliado.
    uidSesion = U.ADMIN;
    const rInt = (await resolverComisionB2B(n)) as { tipo: string; esInterno?: boolean; detalle: { totalPagar: number } } | null;
    assert.deepEqual({ tipo: rInt?.tipo, interno: rInt?.esInterno, total: rInt?.detalle.totalPagar }, { tipo: "comision", interno: true, total: 130_000 });
    uidSesion = U.AGENCIA;
    // Documento al cliente: ni las filas del contrato ni lo que la cotización guarda para el cliente nombran el recobro.
    assert.equal(itemsDe(n).some((i) => /recobro/i.test(i.descripcion)), false);
    const cliente = sql(`select (payload - 'b2bAsistido' - 'recobroCliente')::text from public.cotizaciones where id = ${id}`);
    assert.doesNotMatch(cliente, /recobro/i);
  });

  test("R12 un plan con recobro ALTERADO después de cotizar se rechaza al convertir, antes de numerar", async () => {
    for (const mod of [
      `jsonb_set(payload, '{b2bAsistido,recobro,participacion}', '99999')`,
      `jsonb_set(payload, '{b2bAsistido,recobro,total}', '1')`,
      `payload #- '{b2bAsistido,recobro}'`,
    ]) {
      const { id } = await cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable"), extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 50_000 } } } });
      sinFrontera(`update public.cotizaciones set payload = ${mod} where id = ${id}`);
      const antes = foto();
      const r = await convertir(U.VENTA, id, 1);
      assert.equal(r.ok, false, mod);
      sinEscribir(mod, antes, id);
    }
  });
});

// Consumo: solicitudes a PostgREST por acción, sin sondeo ni reintentos (cada acción corre UNA vez). Línea base medida sobre HEAD de #442 (ce35f18) con el mismo fixture: cotizar interno 13,
// cotizar asistida 14, convertir B2C 17, convertir asistida 20. Los límites son la medición de esta entrega (+0/+1 por acción) y fallan si una acción multiplica llamadas.
describe("102 · consumo: solicitudes por acción (#14-A)", () => {
  async function medir<T>(que: string, fn: () => Promise<T>): Promise<{ r: T; n: number }> {
    const antes = solicitudesPostgrest; const r = await fn(); const n = solicitudesPostgrest - antes;
    console.log(`      CONSUMO ${que.padEnd(52)} solicitudes=${n}`);
    return { r, n };
  }
  test("CN1 cada acción hace un número acotado de solicitudes (sin crecer con el recobro ni con el aliado directo) y convertir no cambia", async () => {
    const A1 = await medir("cotizar interno sin recobro", () => cotizarOk(U.VENTA, {}));
    const B1 = await medir("cotizar asistida PVP sin recobro", () => cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable") }));
    const D1 = await medir("cotizar aliado directo sin recobro", () => cotizarOk(U.AGENCIA, {}));
    const E1 = await medir("cotizar aliado directo con recobro", () => cotizarOk(U.AGENCIA, { extra: { recobro: { total: 100_000 } } }));
    const C1 = await medir("cotizar asistida con recobro y distribución", () => cotizarOk(U.VENTA, { asistencia: b2b(A.AG10, "comisionable"), extra: { recobro: { total: 100_000, participacion: { modo: "valor", valor: 50_000 } } } }));
    const G1 = await medir("cotizar interno cliente final con recobro", () => cotizarOk(U.VENTA, { extra: { recobro: { total: 100_000 } } }));
    const F1 = await medir("convertir B2C", () => convertir(U.VENTA, A1.r.id, 1));
    const F2 = await medir("convertir asistida con recobro", () => convertir(U.VENTA, C1.r.id, 1));
    assert.ok(A1.n <= 13, `interno sin recobro: ${A1.n} (HEAD #442: 13)`);
    assert.ok(B1.n <= 15, `asistida PVP: ${B1.n} (HEAD #442: 14; +1 = lectura del nombre comercial del paquete para el resumen)`);
    assert.ok(D1.n <= 18 && E1.n <= 19, `aliado directo: ${D1.n} / ${E1.n} (resuelve su ficha, su modalidad y, con recobro, el parámetro)`);
    assert.ok(C1.n <= 16 && G1.n <= 15, `recobro asistido / cliente final: ${C1.n} / ${G1.n}`);
    assert.ok(F1.n <= 17 && F2.n <= 21, `convertir: ${F1.n} / ${F2.n} (HEAD #442: 17 / 20)`);
  });
});

function leerArchivo(rel: string): string {
  return execFileSync("node", ["-e", `process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(rel)}, "utf8").replace(/\\r\\n/g, "\\n"))`], { encoding: "utf8", cwd: new URL("..", import.meta.url) });
}
