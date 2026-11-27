// NETA (migración 349) — un servicio en USD AGREGADO con el editor real de servicios (actualizarServiciosContrato) a un contrato PENDIENTE que ya existe: la obligación prevista nace en USD con su TRM de costos provisional (heredada si el contrato tiene una sola) o se puede fijar después.
// Trayecto REAL por HTTP: convertirCotizacionCarrito → actualizarServiciosContrato → corregirTrmCostoPrevista → confirmarVenta → PostgREST → Postgres. Solo se simula el motor de PRECIOS de venta y la sesión.
// SOLO base local desechable: la lanza supabase/scripts/test_349_trm_costo_servicio_usd.sh (no corre en `npm run test:*`).
import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PGTC_CONTENEDOR ?? "pgrevc";
const DB = process.env.PGTC_BASE ?? "";
const PGRST = process.env.PGTC_POSTGREST ?? "";
const SECRETO = process.env.PGTC_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PGTC_BASE (desechable), PGTC_POSTGREST y PGTC_JWT_SECRET: usa supabase/scripts/test_349_trm_costo_servicio_usd.sh.");

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

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const UID_ADMIN = "00000000-0000-0000-0000-000000480003";
const UID_AGENCIA = "00000000-0000-0000-0000-000000480008";
const TOKEN_SERVICIO = jwt({ role: "service_role" });
let uidSesion = UID_ADMIN;

process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-bn";

// Inyección de fallos en la capa HTTP (las acciones, PostgREST y Postgres siguen siendo los reales): solo altera la respuesta de UNA lectura/escritura concreta.
type Inyeccion = null | "previa_error" | "previa_omitida" | "creacion_error" | "creacion_sin_fila" | "vuelo_insert_error";
let inyeccion: Inyeccion = null;
let inyecciones = 0;
const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
const fetchLocal: typeof fetch = async (input, init) => {
  const url = String(input).replace("/rest/v1/", "/");
  const metodo = (init?.method ?? "GET").toUpperCase();
  const [ruta, consulta = ""] = url.slice(PGRST.length).split("?");
  const q = decodeURIComponent(consulta);
  if (inyeccion && ruta === "/bloqueos_vuelo" && metodo === "GET") {
    const previa = /(^|&)id=in\./.test(q);                       // revisión previa: lectura en lote de los bloqueos del carrito
    const creacion = /(^|&)id=eq\./.test(q) && q.startsWith("select=aerolinea"); // creación: lectura del bloqueo del ítem
    if (previa && inyeccion === "previa_error") { inyecciones++; return json(500, { message: "fallo inyectado (previa)" }); }
    if (previa && inyeccion === "previa_omitida") { inyecciones++; return json(200, []); }
    if (creacion && inyeccion === "creacion_error") { inyecciones++; return json(500, { message: "fallo inyectado (creación)" }); }
    if (creacion && inyeccion === "creacion_sin_fila") { inyecciones++; return json(406, { code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" }); }
  }
  if (inyeccion === "vuelo_insert_error" && ruta === "/contrato_vuelos" && metodo === "POST") { inyecciones++; return json(500, { message: "fallo inyectado (insert de vuelo)" }); }
  return fetch(url, init);
};
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteSesion = () => clienteLocal(jwt({ role: "authenticated", sub: uidSesion }), { id: uidSesion, email: `${uidSesion}@x.test` });

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: q, encoding: "utf8" }).trim();
}
const fila = (q: string) => sql(q).split("|");
const lit = (v: unknown) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

// Precio de VENTA de los servicios (liquidarServicioPuntual) simulado: el COSTO lo liquida el código real (liquidarCostoTour) con las vigencias sembradas.
const SERVICIOS_SIM: Record<number, { nombre: string; pvpPersona: number }> = { 4901: { nombre: "Tour USD 349", pvpPersona: 75 }, 4902: { nombre: "Asistencia USD 349", pvpPersona: 40 }, 4903: { nombre: "Tour COP 349", pvpPersona: 100000 } };
// Motor de precios simulado (no es lo que se prueba): PVP 700.000 COP / 200 USD por persona; neto del hotel 210.000 COP / 100 USD.
type HotelSim = { nombre: string; moneda: string; pvp: number; neto: number };
let HOTELES: Record<number, HotelSim> = {};
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async (_sb: unknown, r: { hotelId: number; bloqueoId?: number | null }) => {
      const h = HOTELES[r.hotelId];
      return {
        ok: true,
        data: {
          origen: r.bloqueoId ? { tipo: "bloqueo", id: r.bloqueoId } : { tipo: "ninguno" },
          serviciosItems: [], impuestoTotal: 0, cargoMascota: 0,
          meta: { hotel_nombre: h.nombre, destino_nombre: "CARTAGENA", fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04" },
          precioVenta: h.pvp * 2, monedaReserva: h.moneda,
          lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: h.pvp }], pvpPorAcom: { doble: h.pvp }, netoPorAcom: { doble: h.neto },
          numNinos: 0, numNinos2: 0, numInfantes: 0, totalPax: 2, paxConSilla: 2, edadesMenoresUsadas: [],
          serviciosIncluidos: [], distribucionMenores: [], condicionesTarifa: null,
        },
      };
    },
  },
});
mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/reservar/cotizar", {
  namedExports: {
    liquidarServicioPuntual: async (p: { servicioId: number; pax: number }) => { const t = SERVICIOS_SIM[p.servicioId]; return t ? { ok: true, resultado: { nombre: t.nombre, total: t.pvpPersona * p.pax } } : { ok: false, tipo: "no_disponible", mensaje: "servicio no simulado" }; },
    cotizarPorFechas: async () => { throw new Error("no se usa"); },
    buscarHoteles: async () => { throw new Error("no se usa"); },
    buscarReceptivos: async () => { throw new Error("no se usa"); },
  },
});
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/cotizacion/acceso", {
  namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, tenant: "mayorista" }), autorizaTenant: () => true },
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

const { convertirCotizacionCarrito, convertirCotizacion, confirmarVenta } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");

const { identidadDe } = await import("../lib/contrato/identidad.ts");

const PASAJEROS = [
  { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false },
  { nombres: "Luis", apellidos: "Gómez", tipoDoc: "CC", numeroDoc: "456", fechaNacimiento: "1988-05-05", nacionalidad: "Colombiana", esInfante: false },
];
const CLIENTE = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };

const B_COP = 4801, B_USD = 4802, B_SIN_NETA = 4803, B_COP2 = 4804;

before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin-bn@x.test'), ('${UID_AGENCIA}', 'agencia-bn@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
      ('${UID_ADMIN}', 'admin-bn@x.test', 'Admin BN', 'administracion', true, 'mayorista'),
      ('${UID_AGENCIA}', 'agencia-bn@x.test', 'Agencia BN', 'agencia', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into public.destinos (id, nombre) values (4801, 'CARTAGENA BN') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (4801, 'Proveedor Hotel BN'), (4802, 'Aerolínea BN') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) values (4801, 4801, 'Hotel Peso BN', 4801, 'COP'), (4802, 4801, 'Hotel Dólar BN', 4801, 'USD') on conflict do nothing;
    insert into public.armado_paquetes (id, nombre, tipo, moneda) values (4801, 'Paquete bloqueo COP BN', 'bloqueo', 'COP'), (4802, 'Paquete bloqueo USD BN', 'bloqueo', 'USD') on conflict do nothing;
    insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, proveedor_id, destino_id, fecha_ida, fecha_regreso, cupos_total, tarifa_neta, tarifa_para_empaquetar, fee_infante, moneda) values
      (${B_COP}, 'BNCOP1', 'Avianca', 'BOG-CTG', 4802, 4801, '2030-03-01', '2030-03-04', 4, 300000, 349000, 0, 'COP'),
      (${B_USD}, 'BNUSD1', 'Avianca', 'BOG-CTG', 4802, 4801, '2030-03-01', '2030-03-04', 4, 100, 120, 0, 'USD'),
      (${B_SIN_NETA}, 'BNSIN1', 'Avianca', 'BOG-CTG', 4802, 4801, '2030-03-01', '2030-03-04', 4, null, 349000, 0, 'COP'),
      (${B_COP2}, 'BNCOP2', 'Avianca', 'BOG-CTG', 4802, 4801, '2030-03-01', '2030-03-04', 4, 300000, 349000, 0, 'COP')
      on conflict do nothing;
    insert into public.sillas (bloqueo_id, numero_silla, estado)
      select b, n, 'disponible' from unnest(array[${B_COP}, ${B_USD}, ${B_SIN_NETA}, ${B_COP2}]) b, generate_series(1, 4) n;
  `);
});
beforeEach(() => {
  HOTELES = { 4801: { nombre: "Hotel Peso BN", moneda: "COP", pvp: 700_000, neto: 210_000 }, 4802: { nombre: "Hotel Dólar BN", moneda: "USD", pvp: 200, neto: 100 } };
});

const itemBloqueo = (hotelId: number, bloqueoId: number, paqueteId: number) => ({
  modulo: "bloqueo", paqueteId, hotelId, bloqueoId, hotelNombre: HOTELES[hotelId].nombre, destino: "CARTAGENA",
  categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3,
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: HOTELES[hotelId].pvp * 2, edadesMenores: [], cantidadMenores: 0,
});
function cotizacion(moneda: "COP" | "USD", items: unknown[]): number {
  const payload = { items, tours: [], cliente: CLIENTE };
  return Number(sql(`insert into public.cotizaciones (tipo, estado, tenant, moneda, payload, detalle, cliente, pax)
    values ('carrito', 'abierta', 'mayorista', ${lit(moneda)}, ${lit(JSON.stringify(payload))}::jsonb, '{}'::jsonb, 'Ana Pérez', 2) returning id`));
}
type Resultado = { ok: boolean; error?: string; numeros?: string[] };
async function convertir(id: number, eleccion: { monedaCobro?: string | null; trmCobro?: number | null; trmCosto?: number | null } = { monedaCobro: "COP" }): Promise<Resultado> {
  uidSesion = UID_ADMIN;
  return convertirCotizacionCarrito(id, { agrupar: "todo", pasajeros: PASAJEROS, asesorInterno: "Asesor BN", asignaciones: [[1, 2]], asignacionesTours: [], ...eleccion }) as Promise<Resultado>;
}
const foto = () => ({
  ventas: Number(sql("select count(*) from public.ventas")), cxp: Number(sql("select count(*) from public.cuentas_por_pagar")),
  sillasTomadas: Number(sql("select count(*) from public.sillas where estado <> 'disponible'")),
});
const cxpDe = (numero: string) => sql(`select string_agg(tipo_proveedor || '|' || proveedor || '|' || valor_total || '|' || moneda || '|' || coalesce(valor_cop_costo::text, '-') || '|' || coalesce(trm_costo::text, '-'), ';' order by tipo_proveedor) from public.cuentas_por_pagar where numero_contrato = ${lit(numero)}`);
// En esta línea base (288) un contrato PENDIENTE guarda sus CxP como "previstas"; nacen en cuentas_por_pagar al confirmar.
const previstasDe = (numero: string) => sql(`select string_agg(payload->>'tipo_proveedor' || '|' || (payload->>'proveedor') || '|' || (payload->>'valor_total') || '|' || (payload->>'moneda') || '|' || coalesce(payload->>'valor_cop_costo', '-') || '|' || coalesce(payload->>'trm_costo', '-'), ';' order by payload->>'tipo_proveedor') from public.contrato_obligaciones_previstas where numero_contrato = ${lit(numero)}`);
/** Confirmación REAL (confirmarVenta con la identidad del contrato): materializa las previstas en cuentas_por_pagar una sola vez. */
async function confirmar(numero: string) {
  uidSesion = UID_ADMIN;
  const r = await confirmarVenta(numero, identidadDe(numero, sql(`select contrato_uid from public.ventas where numero_contrato = ${lit(numero)}`)));
  assert.deepEqual(r, { ok: true }, `confirmarVenta ${numero}`);
}
const asientoAereo = (numero: string) => sql(`select coalesce(sum(l.debe), 0) || '/' || coalesce(sum(l.haber), 0) from public.asientos_contables a join public.asiento_lineas l on l.asiento_id = a.id join public.cuentas_por_pagar c on a.referencia = 'cxp:' || c.id where a.origen = 'cxp' and c.numero_contrato = ${lit(numero)} and c.tipo_proveedor = 'aereo'`);

// ───────────────────────────── NETA · servicio USD agregado después de crear el contrato (migración 349) ─────────────────────────────
// Importes esperados calculados a mano (2 pax): aéreo USD 100 × 2 = 200 y hotel 200 (TRM 3.900) · tour USD 50 × 2 = 100 · asistencia USD 20 × 2 = 40.
const { corregirTrmCostoPrevista } = await import("../app/(dashboard)/dashboard/contratos/[numero]/trm-costo-actions.ts");
const { actualizarServiciosContrato } = await import("../app/(dashboard)/dashboard/contratos/actions.ts");

const UID_VENTA = "00000000-0000-0000-0000-000000490010";
const UID_MIN = "00000000-0000-0000-0000-000000490011";
const BLOQUEOS_USD = Array.from({ length: 24 }, (_, i) => 4811 + i);
const BLOQUEOS_COP = [4851, 4852, 4853, 4854];

before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_VENTA}', 'venta-349@x.test'), ('${UID_MIN}', 'min-349@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
      ('${UID_VENTA}', 'venta-349@x.test', 'Venta 349', 'venta', true, 'mayorista'),
      ('${UID_MIN}', 'min-349@x.test', 'Admin Minorista 349', 'administracion', true, 'minorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    ${BLOQUEOS_USD.map((b) => `insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, proveedor_id, destino_id, fecha_ida, fecha_regreso, cupos_total, tarifa_neta, tarifa_para_empaquetar, fee_infante, moneda)
      values (${b}, 'TX${b}', 'Avianca', 'BOG-CTG', 4802, 4801, '2030-03-01', '2030-03-04', 4, 100, 120, 0, 'USD') on conflict do nothing;
      insert into public.sillas (bloqueo_id, numero_silla, estado) select ${b}, n, 'disponible' from generate_series(1, 4) n;`).join("\n")}
    ${BLOQUEOS_COP.map((b) => `insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, proveedor_id, destino_id, fecha_ida, fecha_regreso, cupos_total, tarifa_neta, tarifa_para_empaquetar, fee_infante, moneda)
      values (${b}, 'TY${b}', 'Avianca', 'BOG-CTG', 4802, 4801, '2030-03-01', '2030-03-04', 4, 300000, 349000, 0, 'COP') on conflict do nothing;
      insert into public.sillas (bloqueo_id, numero_silla, estado) select ${b}, n, 'disponible' from generate_series(1, 4) n;`).join("\n")}
    insert into public.proveedores (id, nombre, aplica_retencion, pct_retencion) values (4903, 'Operador Tours 349', false, 0), (4904, 'Asistencia 349', false, 0) on conflict do nothing;
    insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, liquidacion, categoria, moneda, tipo_tarifa, precio_persona, activo) values
      (4901, 'Tour USD 349', 4903, 4801, 'paquete', 'tour_traslado', 'USD', 'persona', 50, true),
      (4902, 'Asistencia USD 349', 4904, 4801, 'paquete', 'asistencia', 'USD', 'persona', 20, true),
      (4903, 'Tour COP 349', 4903, 4801, 'paquete', 'tour_traslado', 'COP', 'persona', 60000, true) on conflict do nothing;
    insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, prioridad, precio_persona) values
      (4901, 'ANUAL 349', '2030-01-01', '2030-12-31', 1, 50), (4902, 'ANUAL 349', '2030-01-01', '2030-12-31', 1, 20), (4903, 'ANUAL 349', '2030-01-01', '2030-12-31', 1, 60000);
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (4802, 4901, 'persona', false), (4802, 4902, 'persona', false), (4801, 4903, 'persona', false) on conflict do nothing;
  `);
});

let sigUsd = 0, sigCop = 0;
// El contrato nace del carrito (que no guarda `paquete_armado_id`); el editor de servicios solo opera sobre contratos enlazados a su paquete, así que se enlaza como lo está un contrato de Reservar.
const enlazarPaquete = (n: string, paquete: number) => sql(`update public.ventas set paquete_armado_id = ${paquete} where numero_contrato = ${lit(n)}`);
/** Contrato PENDIENTE en USD (bloqueo neta 100 × 2 pax) con la TRM de costos de la conversión. */
async function contratoUsd(trmCosto = 3900): Promise<string> {
  const b = BLOQUEOS_USD[sigUsd++];
  assert.ok(b, "faltan bloqueos USD de prueba");
  const r = await convertir(cotizacion("USD", [itemBloqueo(4802, b, 4802)]), { monedaCobro: "USD", trmCosto });
  assert.equal(r.ok, true, r.error);
  enlazarPaquete(r.numeros![0], 4802);
  return r.numeros![0];
}
async function contratoCop(): Promise<string> {
  const b = BLOQUEOS_COP[sigCop++];
  assert.ok(b, "faltan bloqueos COP de prueba");
  const r = await convertir(cotizacion("COP", [itemBloqueo(4801, b, 4801)]), { monedaCobro: "COP" });
  assert.equal(r.ok, true, r.error);
  enlazarPaquete(r.numeros![0], 4801);
  return r.numeros![0];
}
const ident = (numero: string) => identidadDe(numero, sql(`select contrato_uid from public.ventas where numero_contrato = ${lit(numero)}`));
const editar = (n: string, ids: number[]) => { uidSesion = UID_ADMIN; return actualizarServiciosContrato(n, ids, ident(n)); };
const corregir = (n: string, trm: unknown, esperada: number, clave: string | null = null, nota = "") => { uidSesion = UID_ADMIN; return corregirTrmCostoPrevista(n, ident(n), clave, trm, esperada, nota); };
/** TRM INICIAL: `trmEsperada` nula = «el servicio nació sin TRM». */
const fijar = (n: string, trm: unknown, clave: string | null = null, nota = "") => { uidSesion = UID_ADMIN; return corregirTrmCostoPrevista(n, ident(n), clave, trm, null, nota); };
type Prev = { clave: string; tipo: string; servicio_id: string | null; moneda: string; valor: number; trm: number | null; cop: number | null };
const previstas = (n: string): Prev[] => JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('clave', clave, 'tipo', payload->>'tipo_proveedor', 'servicio_id', payload->>'servicio_id', 'moneda', payload->>'moneda', 'valor', (payload->>'valor_total')::numeric, 'trm', (payload->>'trm_costo')::numeric, 'cop', (payload->>'valor_cop_costo')::numeric) order by id), '[]'::jsonb) from public.contrato_obligaciones_previstas where numero_contrato = ${lit(n)}`));
const deServicio = (n: string, id: number) => previstas(n).filter((p) => p.servicio_id === String(id));
const baseHash = (n: string) => sql(`select md5(coalesce(string_agg(p::text, '|' order by id), '')) from public.contrato_obligaciones_previstas p where numero_contrato = ${lit(n)} and payload->>'servicio_id' is null`);
const ventaHash = (n: string) => sql(`select md5(v::text) from public.ventas v where numero_contrato = ${lit(n)}`);
const nHist = (n: string) => Number(sql(`select count(*) from public.contrato_trm_costo_historial where numero_contrato = ${lit(n)}`));
const cxpFilas = (n: string) => JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo_proveedor, 'moneda', moneda, 'valor', valor_total, 'trm', trm_costo, 'cop', valor_cop_costo) order by id), '[]'::jsonb) from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`)) as { id: number; tipo: string; moneda: string; valor: number; trm: number | null; cop: number | null }[];
const huellaOtros = (excepto: string) => sql(`select md5(coalesce((select string_agg(c::text, '|' order by id) from public.cuentas_por_pagar c where numero_contrato <> ${lit(excepto)}), '') || '#' || coalesce((select string_agg(p::text, '|' order by id) from public.contrato_obligaciones_previstas p where numero_contrato <> ${lit(excepto)}), ''))`);

describe("349 · servicio USD agregado con el editor REAL después de crear el contrato (acciones reales → PostgREST → Postgres)", () => {
  test("T1 agregar un tour USD: la prevista nace en USD con la TRM de costos del contrato (3.900 → 390.000), el costo/precio quedan en USD y las demás obligaciones no cambian", async () => {
    const n = await contratoUsd(3900);
    assert.equal(sql(`select paquete_armado_id from public.ventas where numero_contrato = ${lit(n)}`), "4802", "el contrato está enlazado al paquete USD");
    const precioAntes = Number(sql(`select precio_venta from public.ventas where numero_contrato = ${lit(n)}`));
    const base = baseHash(n), otros = huellaOtros(n);
    const r = await editar(n, [4901]);
    assert.deepEqual(r, { ok: true });
    const [t] = deServicio(n, 4901);
    assert.ok(t, "se creó la obligación del tour");
    assert.match(t.clave, /^cxp:ed:/);
    assert.deepEqual([t.tipo, t.moneda, t.valor, t.trm, t.cop], ["receptivo", "USD", 100, 3900, 390000], JSON.stringify(t));
    assert.equal(baseHash(n), base, "hotel y aéreo (obligaciones previas) quedaron idénticos");
    assert.equal(huellaOtros(n), otros, "ningún otro contrato cambió");
    assert.equal(Number(sql(`select costo_receptivo from public.ventas where numero_contrato = ${lit(n)}`)), 100, "el costo del tour va en la columna del contrato, en USD");
    assert.equal(Number(sql(`select precio_venta from public.ventas where numero_contrato = ${lit(n)}`)), precioAntes + 150, "75 × 2 pax de precio de venta (USD)");
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`), "0", "sigue sin CxP: es una previsión");
    const todas = previstas(n);
    assert.ok(todas.every((p) => p.moneda === "USD"), "todas en USD: no se mezclan monedas");
    assert.equal(todas.reduce((s, p) => s + p.valor, 0), 500);
    assert.equal(todas.reduce((s, p) => s + (p.cop ?? 0), 0), 1_950_000, "500 × 3.900");
  });

  test("T2 guardar, recargar y editar la TRM (3.900 → 4.100): las TRES previstas en USD, el equivalente solo sale de la TRM provisional, el valor en USD no cambia, historial por obligación", async () => {
    const n = await contratoUsd(3900);
    await editar(n, [4901]);
    const venta = ventaHash(n), otros = huellaOtros(n);
    const antes = previstas(n);                                  // «recargar»: se vuelve a leer de la base
    assert.deepEqual(antes.map((p) => p.trm), [3900, 3900, 3900]);
    const r = await corregir(n, "4100", 3900, null, "TRM acordada");
    assert.deepEqual(r, { ok: true, cambiadas: 3, trmNueva: 4100 });
    const despues = previstas(n);
    assert.deepEqual(despues.map((p) => p.valor), antes.map((p) => p.valor), "el valor en USD no cambia");
    for (const p of despues) assert.equal(p.cop, Math.round(p.valor * 4100 * 100) / 100, `${p.tipo}: equivalente = USD × 4.100`);
    assert.equal(deServicio(n, 4901)[0].cop, 410000);
    assert.equal(nHist(n), 3);
    assert.equal(ventaHash(n), venta, "la venta no cambia");
    assert.equal(huellaOtros(n), otros, "otros contratos: byte a byte iguales");
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`), "0");
    const esperadaVieja = await corregir(n, "4200", 3900);
    assert.equal(esperadaVieja.ok, false, "TRM vista desactualizada: compara-y-cambia");
  });

  test("T3 editar los servicios otra vez: lo nuevo hereda la TRM vigente (4.100), lo existente conserva clave y TRM, y quitar el tour borra solo su previsión", async () => {
    const n = await contratoUsd(3900);
    await editar(n, [4901]);
    await corregir(n, "4100", 3900);
    const base = baseHash(n);
    const tour = deServicio(n, 4901)[0];
    assert.deepEqual(await editar(n, [4901, 4902]), { ok: true });
    const asis = deServicio(n, 4902)[0];
    assert.deepEqual([asis.tipo, asis.moneda, asis.valor, asis.trm, asis.cop], ["asistencia", "USD", 40, 4100, 164000], JSON.stringify(asis));
    const tour2 = deServicio(n, 4901)[0];
    assert.deepEqual([tour2.clave, tour2.trm, tour2.cop], [tour.clave, 4100, 410000], "el tour existente no se tocó");
    assert.deepEqual(await editar(n, [4902]), { ok: true });
    assert.equal(deServicio(n, 4901).length, 0, "el tour se quitó");
    assert.deepEqual(deServicio(n, 4902).map((p) => [p.trm, p.cop]), [[4100, 164000]]);
    assert.equal(baseHash(n), base, "hotel y aéreo siguen idénticos");
  });

  test("T4 confirmar: las CxP nacen con el equivalente congelado (CHECK de la 236 sin rechazo), la suma por moneda cuadra, hay asiento, y después ni la acción ni Z9610 permiten cambiarlo", async () => {
    const n = await contratoUsd(3900);
    await editar(n, [4902]);
    await corregir(n, "4100", 3900);
    const otros = huellaOtros(n);
    await confirmar(n);
    const cxp = cxpFilas(n);
    assert.equal(cxp.length, 3, JSON.stringify(cxp));
    for (const c of cxp) { assert.equal(c.moneda, "USD"); assert.equal(c.trm, 4100); assert.equal(c.cop, Math.round(c.valor * 4100 * 100) / 100, c.tipo); }
    assert.equal(cxp.reduce((s, c) => s + c.valor, 0), 440, "200 + 200 + 40, todo en USD (sin sumar pesos)");
    assert.equal(cxp.reduce((s, c) => s + (c.cop ?? 0), 0), 1_804_000);
    const asis = cxp.find((c) => c.tipo === "asistencia")!;
    assert.equal(sql(`select coalesce(sum(l.debe), 0) from public.asientos_contables a join public.asiento_lineas l on l.asiento_id = a.id where a.referencia = 'cxp:${asis.id}'`), "164000.00", "el devengo usa el equivalente congelado");
    const tarde = await corregir(n, "4300", 4100);
    assert.equal(tarde.ok, false);
    assert.match((tarde as { error: string }).error, /pendiente/);
    assert.throws(() => sql(`update public.cuentas_por_pagar set trm_costo = 4300 where id = ${asis.id}`), /Z9610|inmutable|congelad/i, "la inmutabilidad de la 236 sigue intacta");
    assert.deepEqual(cxpFilas(n), cxp, "las CxP no cambiaron");
    assert.equal(huellaOtros(n), otros);
  });

  test("T5 contrato SIN par (otra ruta): el servicio nuevo nace en USD «TRM pendiente»; las previsiones históricas no se tocan; la TRM inicial solo la recibe el servicio agregado; sin valor anterior inventado; al confirmar nace con su equivalente", async () => {
    const n = await contratoUsd(3900);
    sql(`update public.contrato_obligaciones_previstas set payload = payload - 'trm_costo' - 'valor_cop_costo' where numero_contrato = ${lit(n)}`);
    const base = baseHash(n);
    await editar(n, [4901]);
    const [t] = deServicio(n, 4901);
    assert.deepEqual([t.moneda, t.valor, t.trm, t.cop], ["USD", 100, null, null], "sin TRM que heredar no se inventa una");
    const pair = await corregir(n, "4100", 3900);
    assert.equal(pair.ok, false);
    assert.match((pair as { error: string }).error, /No hay obligaciones previstas en USD con TRM de costos/);
    const r = await fijar(n, "3950", t.clave, "TRM inicial");
    assert.deepEqual(r, { ok: true, cambiadas: 1, trmNueva: 3950 });
    assert.deepEqual(deServicio(n, 4901).map((p) => [p.trm, p.cop]), [[3950, 395000]]);
    assert.equal(baseHash(n), base, "las previsiones históricas sin par siguen sin TRM");
    assert.equal(sql(`select trm_anterior is null and valor_cop_anterior is null and trm_nueva = 3950 and valor_cop_nuevo = 395000 from public.contrato_trm_costo_historial where numero_contrato = ${lit(n)}`), "t");
    const otra = await fijar(n, "4000", t.clave);
    assert.equal(otra.ok, false, "ya tiene TRM: la inicial no se reaplica (se corrige con la TRM que se ve)");
    await confirmar(n);
    const cxp = cxpFilas(n);
    const srv = cxp.find((c) => c.tipo === "receptivo")!;
    assert.deepEqual([srv.moneda, srv.valor, srv.trm, srv.cop], ["USD", 100, 3950, 395000]);
    assert.ok(cxp.filter((c) => c.tipo !== "receptivo").every((c) => c.trm == null && c.cop == null), "las históricas siguen sin equivalente");
  });

  test("T6 TRMs distintas en el contrato (3.900 y 4.000): el servicio nuevo NO elige una; queda pendiente y se fija explícitamente; confirmar funciona", async () => {
    const n = await contratoUsd(3900);
    sql(`update public.contrato_obligaciones_previstas set payload = payload || '{"trm_costo": 4000, "valor_cop_costo": 800000}'::jsonb where numero_contrato = ${lit(n)} and payload->>'tipo_proveedor' = 'aereo'`);
    const base = baseHash(n);
    await editar(n, [4901]);
    const [t] = deServicio(n, 4901);
    assert.deepEqual([t.trm, t.cop], [null, null]);
    assert.deepEqual(await fijar(n, "4100"), { ok: true, cambiadas: 1, trmNueva: 4100 }, "sin clave: solo los servicios agregados sin TRM");
    assert.equal(baseHash(n), base, "hotel (3.900) y aéreo (4.000) no cambian");
    await confirmar(n);
    assert.deepEqual(cxpFilas(n).map((c) => [c.tipo, c.trm, c.cop]).sort(), [["aereo", 4000, 800000], ["hotel", 3900, 780000], ["receptivo", 4100, 410000]]);
  });

  test("T7 rechazos de la TRM inicial: valor inválido, ya tiene TRM heredada, histórica sin par, COP, rol sin permiso, otra agencia, contrato confirmado", async () => {
    const n = await contratoUsd(3900);
    sql(`update public.contrato_obligaciones_previstas set payload = payload || '{"trm_costo": 4000, "valor_cop_costo": 800000}'::jsonb where numero_contrato = ${lit(n)} and payload->>'tipo_proveedor' = 'aereo'`);
    await editar(n, [4901]);
    const antes = JSON.stringify(previstas(n)), hist0 = nHist(n);
    for (const mala of ["0", "-5", "abc", "", "1e11"]) {
      const r = await fijar(n, mala);
      assert.equal(r.ok, false, `TRM inválida «${mala}»`);
    }
    uidSesion = UID_VENTA;
    const rv = await corregirTrmCostoPrevista(n, ident(n), null, "4100", null, "");
    assert.equal(rv.ok, false, "venta no corrige TRM");
    uidSesion = UID_MIN;
    const rm = await corregirTrmCostoPrevista(n, ident(n), null, "4100", null, "");
    assert.equal(rm.ok, false, "administración de otra agencia no ve el contrato");
    assert.equal(JSON.stringify(previstas(n)), antes, "nada cambió con los rechazos");
    assert.equal(nHist(n), hist0);
    // histórica sin par (sin servicio agregado): no es candidata
    const h = await contratoUsd(3900);
    sql(`update public.contrato_obligaciones_previstas set payload = payload - 'trm_costo' - 'valor_cop_costo' where numero_contrato = ${lit(h)}`);
    const rh = await fijar(h, "4100");
    assert.equal(rh.ok, false);
    assert.match((rh as { error: string }).error, /No hay servicios en USD sin TRM/);
    // contrato confirmado
    await confirmar(h);
    const rc = await fijar(h, "4100");
    assert.equal(rc.ok, false);
    assert.match((rc as { error: string }).error, /pendiente/);
    // heredó la TRM: ya no es «sin TRM»
    const n2 = await contratoUsd(3900);
    await editar(n2, [4901]);
    const rh2 = await fijar(n2, "4100");
    assert.equal(rh2.ok, false);
    assert.match((rh2 as { error: string }).error, /No hay servicios en USD sin TRM/);
  });

  test("T8 concurrencia de la TRM inicial: dos fijaciones simultáneas → exactamente una gana, historial de una fila", async () => {
    const n = await contratoUsd(3900);
    sql(`update public.contrato_obligaciones_previstas set payload = payload || '{"trm_costo": 4000, "valor_cop_costo": 800000}'::jsonb where numero_contrato = ${lit(n)} and payload->>'tipo_proveedor' = 'aereo'`);
    await editar(n, [4901]);
    const [a, b] = await Promise.all([fijar(n, "4100"), fijar(n, "4200")]);
    assert.equal([a, b].filter((r) => r.ok).length, 1, JSON.stringify([a, b]));
    assert.equal(nHist(n), 1);
    assert.ok([410000, 420000].includes(deServicio(n, 4901)[0].cop as number));
  });

  test("T9 contrato en COP: el servicio nace en COP sin ningún par de TRM, no hay TRM que fijar y al confirmar la CxP sigue en COP", async () => {
    const n = await contratoCop();
    await editar(n, [4903]);
    const [t] = deServicio(n, 4903);
    assert.deepEqual([t.moneda, t.valor, t.trm, t.cop], ["COP", 120000, null, null]);
    const r = await fijar(n, "4100");
    assert.equal(r.ok, false, "un servicio en COP no acepta TRM de costos");
    assert.equal(nHist(n), 0);
    await confirmar(n);
    const srv = cxpFilas(n).find((c) => c.tipo === "receptivo")!;
    assert.deepEqual([srv.moneda, srv.valor, srv.trm, srv.cop], ["COP", 120000, null, null]);
  });

  test("T10 nunca se mezclan monedas: un servicio COP en un contrato USD (y al revés) se rechaza antes de escribir nada", async () => {
    const u = await contratoUsd(3900);
    const antesU = [JSON.stringify(previstas(u)), ventaHash(u)];
    const r1 = await editar(u, [4903]);
    assert.equal(r1.ok, false);
    assert.match(r1.error!, /no se mezclan monedas/);
    assert.deepEqual([JSON.stringify(previstas(u)), ventaHash(u)], antesU);
    const c = await contratoCop();
    const antesC = [JSON.stringify(previstas(c)), ventaHash(c)];
    const r2 = await editar(c, [4901]);
    assert.equal(r2.ok, false);
    assert.match(r2.error!, /no se mezclan monedas/);
    assert.deepEqual([JSON.stringify(previstas(c)), ventaHash(c)], antesC);
  });
});
