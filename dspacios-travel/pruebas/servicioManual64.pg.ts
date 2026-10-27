// #64 — servicio MANUAL del carrito (vuelo libre u otro): conversión REAL por HTTP contra PostgreSQL local.
//   convertirCotizacionCarrito (SIN simulaciones de dinero) → PostgREST propio → ventas / contrato_items / contrato_vuelos / registrar_financiero_contrato.
// Lo ÚNICO simulado: el motor de PRECIOS del hotel (computarReserva) y la sesión (auth.getUser), igual que carritoCostoUsd236.pg.ts.
// SOLO base LOCAL desechable; no corre en `npm run test:*`: la lanza supabase/scripts/test_64_servicio_manual.sh. Nada habla con Supabase remoto.
import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import fs from "node:fs";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG64_CONTENEDOR ?? "pg64";
const DB = process.env.PG64_BASE ?? "";
const PGRST = process.env.PG64_POSTGREST ?? "";
const SECRETO = process.env.PG64_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) {
  throw new Error("Faltan PG64_BASE (desechable), PG64_POSTGREST y PG64_JWT_SECRET: usa supabase/scripts/test_64_servicio_manual.sh.");
}

// ── "server-only" y "next/cache" como módulos mínimos (mismo patrón que auditoria90H.test.ts) ──
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
const UID_ADMIN = "00000000-0000-0000-0000-000000236003";
const UID_AGENCIA = "00000000-0000-0000-0000-000000236008";
const TOKEN_SERVICIO = jwt({ role: "service_role" });
let uidSesion = UID_ADMIN;

process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
const CRON = "cron-local-64";
process.env.CRON_SECRET = CRON;

// supabase-js antepone /rest/v1 a las rutas de PostgREST; el PostgREST local las sirve en la raíz.
const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteSesion = () => clienteLocal(jwt({ role: "authenticated", sub: uidSesion }), { id: uidSesion, email: `${uidSesion}@x.test` });

// ── SQL directo (superusuario del contenedor) para sembrar y comprobar ────
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: q, encoding: "utf8" }).trim();
}
const fila = (q: string) => sql(q).split("|");
const lit = (v: unknown) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

// ── Motor de reserva simulado, por hotel (el precio NO es lo que se prueba) ──
type HotelSim = { nombre: string; moneda: string; pvp: number; neto: number; destino?: string; ida?: string; regreso?: string; impuesto?: number };
let HOTELES: Record<number, HotelSim> = {};
let SERVICIOS_SIM: Record<number, { nombre: string; total: number }> = {};
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async (_sb: unknown, r: { hotelId: number }) => {
      const h = HOTELES[r.hotelId];
      return {
        ok: true,
        data: {
          meta: { hotel_nombre: h.nombre, destino_nombre: h.destino ?? "CARTAGENA", fecha_ida: h.ida ?? "2030-03-01", fecha_regreso: h.regreso ?? "2030-03-04" },
          precioVenta: h.pvp * 2, monedaReserva: h.moneda, impuestoTotal: h.impuesto ?? 0,
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
    liquidarServicioPuntual: async (t: { servicioId: number; paqueteId: number; pax: number }) => {
      const sv = SERVICIOS_SIM[t.servicioId];
      if (!sv) return { ok: false, tipo: "no_disponible", mensaje: "no se usa" };
      return { ok: true, resultado: { servicioId: t.servicioId, paqueteId: t.paqueteId, nombre: sv.nombre, destino: null, descripcion: null, noches: null, pax: t.pax, total: sv.total, moneda: "COP", categoria: "tour" } };
    },
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
// Numeración REAL (RPC siguiente_numero_contrato_para_tenant sobre la base); solo se evita la importación sin extensión de numeracion.ts bajo el cargador de pruebas.
const { interpretarRespuestaNumeroContrato } = await import("../lib/contrato/numeracionPuro.ts");
mock.module("@/lib/contrato/numeracion", {
  namedExports: {
    siguienteNumeroContrato: async (tenant: string) => {
      const { data, error } = await clienteLocal(TOKEN_SERVICIO).rpc("siguiente_numero_contrato_para_tenant", { p_tenant: tenant });
      return interpretarRespuestaNumeroContrato(data, error as never);
    },
  },
});
let anonimo = false;
const clienteAnonimo = () => { const sb = clienteLocal(jwt({ role: "anon" })); (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: null }, error: null }); return sb; };
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => (anonimo ? clienteAnonimo() : clienteSesion()) } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { descripcionCotizacionManual, validarServicioManual, lineaB2BManual, tramosVueloManual } = await import("../lib/cart/servicioManual.ts");
const { construirPlanB2B } = await import("../lib/cotizacion/asistidaB2B.ts");
const { convertirCotizacionCarrito } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { crearSolicitudReserva, crearComparativaCarrito, elegirOpcionComparativa, resumenOpcionComparativa, previsualizarComparativaB2B } = await import("../app/tarifario/checkout/actions.ts");
const { mensajeAcomodacionComparativa } = await import("../lib/cotizacion/comparativa.ts");
const { visitantePuedeContinuar } = await import("../lib/cotizacion/comparativaServidor.ts");

// ── Semilla de la base ────────────────────────────────────────────────────
const PASAJEROS = [
  { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false },
  { nombres: "Luis", apellidos: "Gómez", tipoDoc: "CC", numeroDoc: "456", fechaNacimiento: "1988-05-05", nacionalidad: "Colombiana", esInfante: false },
];
const CLIENTE = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };

before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin236@x.test'), ('${UID_AGENCIA}', 'agencia236@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
      ('${UID_ADMIN}', 'admin236@x.test', 'Admin 236', 'administracion', true, 'mayorista'),
      ('${UID_AGENCIA}', 'agencia236@x.test', 'Agencia 236', 'agencia', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into public.destinos (id, nombre) values (3601, 'CARTAGENA 236'), (3602, 'SANTA MARTA 236') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (3601, 'Proveedor Hotel 236'), (3602, 'Rosario Tours 236') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) values (3601, 3601, 'Hotel Dólar 236', 3601, 'USD'), (3602, 3601, 'Hotel Peso 236', 3601, 'COP') on conflict do nothing;
    insert into public.armado_paquetes (id, nombre, tipo, moneda) values (3601, 'Paquete 236', 'porcion_terrestre', 'USD') on conflict do nothing;
  `);
});

let consecutivo = 0;
let servicioSeq = 3700;
/** Crea un servicio del catálogo (con su proveedor) dentro del paquete 3601. Devuelve su id. */
function servicio(nombre: string, moneda: "COP" | "USD", precioPersona: number): number {
  const id = ++servicioSeq;
  sql(`
    insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa)
      values (${id}, ${lit(nombre)}, 3602, 3601, ${precioPersona}, 'tour_traslado', ${lit(moneda)}, 'persona');
    insert into public.armado_servicios (paquete_id, servicio_id, modo) values (3601, ${id}, 'persona');
  `);
  return id;
}
const monedaDelServicio = (id: number, moneda: "COP" | "USD") => sql(`update public.servicios_adicionales set moneda = ${lit(moneda)} where id = ${id}`);

const tourPayload = (nombre: string, destino: string, precio: number, moneda: string, servicioId: number) =>
  ({ nombre, destino, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, precio, moneda, servicioId, paqueteId: 3601 });
const itemPayload = (hotelId: number, destino = "CARTAGENA") => ({
  modulo: "porcion_terrestre", paqueteId: 3601, hotelId, bloqueoId: null, hotelNombre: HOTELES[hotelId].nombre, destino,
  categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3,
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0,
});
/** Inserta una cotización de carrito ABIERTA en la base y devuelve su id. */
function cotizacion(a: { moneda: "COP" | "USD"; items?: unknown[]; tours?: unknown[] }): number {
  const payload = { items: a.items ?? [], tours: a.tours ?? [], cliente: CLIENTE };
  consecutivo++;
  return Number(sql(`insert into public.cotizaciones (tipo, estado, tenant, moneda, payload, detalle, cliente, pax)
    values ('carrito', 'abierta', 'mayorista', ${lit(a.moneda)}, ${lit(JSON.stringify(payload))}::jsonb, '{}'::jsonb, 'Ana Pérez', 2) returning id`));
}

type Resultado = { ok: boolean; error?: string; numeros?: string[] };
async function convertir(id: number, nItems: number, eleccion: { monedaCobro?: string | null; trmCobro?: number | string | null; trmCosto?: number | string | null },
  agrupar: "todo" | "por_destino" = "todo", nTours = 0): Promise<Resultado> {
  uidSesion = UID_ADMIN;
  return convertirCotizacionCarrito(id, {
    agrupar, pasajeros: PASAJEROS, asesorInterno: "Asesor 236",
    asignaciones: Array.from({ length: nItems }, () => [1, 2]), asignacionesTours: Array.from({ length: nTours }, () => [1, 2]), ...eleccion,
  }) as Promise<Resultado>;
}

// ── Lecturas de verificación ──────────────────────────────────────────────
const totalVentas = () => Number(sql("select count(*) from public.ventas"));
const totalCxp = () => Number(sql("select count(*) from public.cuentas_por_pagar"));
const ultimoNumero = () => sql("select coalesce(max(substring(numero_contrato from 5)::int), 0) from public.ventas where numero_contrato ~ '^DTM-[0-9]+$'");
const estadoCot = (id: number) => sql(`select estado from public.cotizaciones where id = ${id}`);
const detalleCot = (id: number) => JSON.parse(sql(`select coalesce(detalle, '{}'::jsonb)::text from public.cotizaciones where id = ${id}`)) as { cobro?: unknown; costo?: { trm: number }; contratos?: string[] };
function sinEscribir(que: string, antes: { ventas: number; cxp: number; ultimo: string }, id: number) {
  assert.equal(totalVentas(), antes.ventas, `${que}: no se creó ningún contrato`);
  assert.equal(totalCxp(), antes.cxp, `${que}: no se creó ninguna CxP`);
  assert.equal(ultimoNumero(), antes.ultimo, `${que}: no se reservó ningún número`);
  assert.equal(estadoCot(id), "abierta", `${que}: la cotización sigue abierta`);
}
const foto = () => ({ ventas: totalVentas(), cxp: totalCxp(), ultimo: ultimoNumero() });
const cxpDe = (numero: string) => sql(`select string_agg(servicio || '|' || tipo_proveedor || '|' || valor_total || '|' || moneda || '|' || coalesce(valor_cop_costo::text, '-') || '|' || coalesce(trm_costo::text, '-'), ';' order by id) from public.cuentas_por_pagar where numero_contrato = ${lit(numero)}`);
const asientoDe = (cuentaId: number) => sql(`select coalesce(sum(l.debe), 0) || '/' || coalesce(sum(l.haber), 0) from public.asientos_contables a join public.asiento_lineas l on l.asiento_id = a.id where a.origen = 'cxp' and a.referencia = 'cxp:${cuentaId}'`);
const cxpIds = (numero: string) => sql(`select string_agg(id::text, ',' order by id) from public.cuentas_por_pagar where numero_contrato = ${lit(numero)}`).split(",").filter(Boolean).map(Number);

beforeEach(() => {
  SERVICIOS_SIM = {};
  HOTELES = {
    3601: { nombre: "Hotel Uno 64", moneda: "COP", pvp: 300_000, neto: 210_000 },
    3602: { nombre: "Hotel Dos 64", moneda: "COP", pvp: 300_000, neto: 210_000 },
  };
});

const VUELO = { clase: "vuelo", tramo: "ida_regreso", hotelRef: "h1", nombre: "Tiquete aéreo ida y regreso", origen: "BOG", destino: "CTG", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, precio: 1_800_000, moneda: "COP", impuestoNoComisionable: 200_000 };
const OTRO = { clase: "otro", nombre: "Traslado privado", origen: null, destino: null, fechaIda: null, fechaRegreso: null, pax: 2, precio: 90_000, moneda: "COP", impuestoNoComisionable: 0 };
const COSTO_VUELO = { costo: 1_500_000, proveedor: "Proveedor Vuelos 64" };

/** Inserta una cotización como la deja `crearSolicitudReserva`: el documento (detalle.items) lleva una línea por manual válido. `detalleItems` fuerza otro documento. */
function cotizacionM(a: { moneda?: "COP" | "USD"; items: unknown[]; manuales?: unknown[]; detalleItems?: unknown[]; detalleVuelos?: unknown[]; payloadExtra?: Record<string, unknown>; hotelDeManual?: string }): number {
  // Como lo deja `crearSolicitudReserva`: cada hotel con su `ref`, el vuelo ligado a SU hotel (`item-N`) y su cuadro de vuelos en el documento.
  const items = a.items.map((it, i) => ({ ref: `item-${i}`, ...(it as object) }));
  const guardados = (a.manuales ?? []).map((m) => {
    const r = validarServicioManual(m);
    return r.ok && r.valor.clase === "vuelo" ? { ...r.valor, hotelRef: a.hotelDeManual ?? "item-0", hotelEtiqueta: "Hotel de prueba" } : m;
  });
  const payload = { items, tours: [], ...(a.manuales ? { manuales: guardados } : {}), cliente: CLIENTE, ...(a.payloadExtra ?? {}) };
  const validos = guardados.flatMap((m) => { const r = validarServicioManual(m); return r.ok ? [r.valor] : []; });
  const lineas = a.detalleItems ?? validos.map((m) => ({ descripcion: descripcionCotizacionManual(m), valor_total: m.precio }));
  const vuelos = a.detalleVuelos ?? validos.flatMap((m) => tramosVueloManual(m, true)).map((t, i) => ({ id: i + 1, ...t }));
  return Number(sql(`insert into public.cotizaciones (tipo, estado, tenant, moneda, payload, detalle, cliente, pax)
    values ('carrito', 'abierta', 'mayorista', ${lit(a.moneda ?? "COP")}, ${lit(JSON.stringify(payload))}::jsonb, ${lit(JSON.stringify({ items: lineas, vuelos, hoteles: items.map((it, i) => ({ id: i + 1, ref: `item-${i}`, nombre: (it as { hotelNombre?: string }).hotelNombre, ciudad: (it as { destino?: string }).destino, condiciones_tarifa: [] })) }))}::jsonb, 'Ana Pérez', 2) returning id`));
}
async function convertirM(id: number, nItems: number, extra: { costosManuales?: unknown; agrupar?: "todo" | "por_destino" } = {}): Promise<Resultado> {
  uidSesion = UID_ADMIN;
  return convertirCotizacionCarrito(id, {
    agrupar: extra.agrupar ?? "todo", pasajeros: PASAJEROS, asesorInterno: "Asesor 64",
    asignaciones: Array.from({ length: nItems }, () => [1, 2]), asignacionesTours: [], monedaCobro: "COP",
    ...(extra.costosManuales !== undefined ? { costosManuales: extra.costosManuales as never } : {}),
  }) as Promise<Resultado>;
}
const venta = (n: string) => fila(`select precio_venta, costo_hotel, costo_aereo, coalesce(otros_costos, 0), moneda from public.ventas where numero_contrato = ${lit(n)}`).map((x, i) => (i === 4 ? x : Number(x)));
const cxpTodas = (n: string) => sql(`select coalesce(string_agg(tipo_proveedor || '|' || coalesce(proveedor, '-') || '|' || valor_total || '|' || moneda, ' ; ' order by tipo_proveedor, id), '') from public.cuentas_por_pagar where numero_contrato = ${lit(n)}`);
const itemsDe = (n: string) => sql(`select coalesce(string_agg(descripcion || '|' || coalesce(valor_total, 0), ' ; ' order by orden), '') from public.contrato_items where numero_contrato = ${lit(n)}`);

describe("64 · vuelo manual libre: conversión, financiero y NO reserva de sillas", () => {
  let numero = "";
  let cotId = 0;

  test("M1 sin costo y proveedor NO se numera: ni número, ni contrato, ni CxP; la cotización sigue abierta", async () => {
    cotId = cotizacionM({ items: [itemPayload(3601)], manuales: [VUELO] });
    const antes = foto();
    for (const costosManuales of [undefined, [], [{ costo: 0, proveedor: "X Proveedor" }], [{ costo: 1_500_000, proveedor: " " }], [{ costo: 1_500_000.5, proveedor: "X Proveedor" }], [{ costo: "1500000", proveedor: "X Proveedor" }]]) {
      const r = await convertirM(cotId, 1, { costosManuales });
      assert.equal(r.ok, false, JSON.stringify(costosManuales));
      sinEscribir(JSON.stringify(costosManuales), antes, cotId);
    }
  });

  test("M2 con costo y proveedor: precio = hotel + vuelo; CxP aérea al proveedor capturado; costo_aereo; tramo sin record; SIN sillas ni bloqueos", async () => {
    const bloqueosAntes = sql("select count(*) from public.bloqueos_vuelo");
    const sillasAntes = sql("select count(*) from public.sillas");
    const r = await convertirM(cotId, 1, { costosManuales: [COSTO_VUELO] });
    assert.equal(r.ok, true, r.error);
    numero = r.numeros![0];
    // hotel (mock) = 300.000 × 2 = 600.000 de venta y 420.000 de costo; vuelo manual = 1.800.000 de venta y 1.500.000 de costo
    assert.deepEqual(venta(numero), [2_400_000, 420_000, 1_500_000, 0, "COP"]);
    assert.match(itemsDe(numero), /Vuelo · Tiquete aéreo ida y regreso BOG → CTG \(ida y regreso\) · 2030-03-01 → 2030-03-04 · 2 pax\|1800000/);
    assert.doesNotMatch(itemsDe(numero), /sujeto a confirmación/);
    const cxp = cxpTodas(numero);
    assert.match(cxp, /aereo\|Proveedor Vuelos 64\|1500000\.00\|COP/);
    assert.match(cxp, /hotel\|Proveedor Hotel 236\|420000\.00\|COP/);
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(numero)}`), "2");
    const tramos = sql(`select string_agg(direccion || ':' || origen_codigo || '>' || destino_codigo || ':' || coalesce(record, 'SIN-RECORD') || ':' || fecha_salida, ' ; ' order by orden) from public.contrato_vuelos where numero_contrato = ${lit(numero)}`);
    assert.equal(tramos, "ida:BOG>CTG:SIN-RECORD:2030-03-01 ; regreso:CTG>BOG:SIN-RECORD:2030-03-04");
    assert.match(sql(`select string_agg(servicios, '') from public.contrato_vuelos where numero_contrato = ${lit(numero)}`), /pasajeros en este vuelo: 2/);
    assert.equal(sql(`select string_agg(servicios, '') from public.contrato_vuelos where numero_contrato = ${lit(numero)}`).includes("Vuelo manual"), true);
    assert.equal(sql("select count(*) from public.bloqueos_vuelo"), bloqueosAntes, "no crea ni toca bloqueos");
    assert.equal(sql("select count(*) from public.sillas"), sillasAntes, "no reserva ni libera sillas");
    assert.equal(sql(`select count(*) from public.sillas where numero_contrato = ${lit(numero)}`), "0");
    assert.equal(estadoCot(cotId), "convertida");
    assert.equal(sql(`select financiero_estado from public.ventas where numero_contrato = ${lit(numero)}`), "completo");
  });

  test("M3 reintento sobre la cotización ya convertida: mismos números y NADA nuevo (ni contrato, ni CxP, ni tramo, ni ítem, ni número)", async () => {
    const antes = foto();
    const tramos = sql("select count(*) from public.contrato_vuelos");
    const items = sql("select count(*) from public.contrato_items");
    for (const costosManuales of [[COSTO_VUELO], undefined, [{ costo: 9, proveedor: "Otro Proveedor" }]]) {
      const r = await convertirM(cotId, 1, { costosManuales });
      assert.equal(r.ok, true, r.error);
      assert.deepEqual(r.numeros, [numero]);
    }
    assert.deepEqual(foto(), antes);
    assert.equal(sql("select count(*) from public.contrato_vuelos"), tramos);
    assert.equal(sql("select count(*) from public.contrato_items"), items);
    assert.match(cxpTodas(numero), /aereo\|Proveedor Vuelos 64\|1500000\.00\|COP/, "la CxP original no se reescribe con el costo del reintento");
  });

  test("M4 servicio 'otro': ítem, CxP tipo otro y otros_costos; NO crea tramo de vuelo", async () => {
    const id = cotizacionM({ items: [itemPayload(3601)], manuales: [OTRO] });
    const r = await convertirM(id, 1, { costosManuales: [{ costo: 60_000, proveedor: "Traslados 64" }] });
    assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    assert.deepEqual(venta(n), [690_000, 420_000, 0, 60_000, "COP"]);
    assert.match(cxpTodas(n), /otro\|Traslados 64\|60000\.00\|COP/);
    assert.equal(sql(`select count(*) from public.contrato_vuelos where numero_contrato = ${lit(n)}`), "0");
    assert.match(itemsDe(n), /Servicio · Traslado privado · 2 pax\|90000/);
  });

  test("M5 un proveedor del catálogo conserva su retención configurada; uno libre queda sin retención", async () => {
    sql("update public.proveedores set aplica_retencion = true, pct_retencion = 0.035 where id = 3602");
    try {
      const id = cotizacionM({ items: [itemPayload(3601)], manuales: [OTRO, { ...OTRO, nombre: "Seguro viaje" }] });
      const r = await convertirM(id, 1, { costosManuales: [{ costo: 60_000, proveedor: "  rosario TOURS 236 " }, { costo: 10_000, proveedor: "Proveedor Libre 64" }] });
      assert.equal(r.ok, true, r.error);
      const n = r.numeros![0];
      assert.match(sql(`select aplica_retencion || '/' || pct_retencion from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and servicio = 'Servicio manual Traslado privado'`), /^true\/0\.0350?$/);
      assert.match(sql(`select aplica_retencion || '/' || pct_retencion from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and servicio = 'Servicio manual Seguro viaje'`), /^false\/0(\.0+)?$/);
    } finally {
      sql("update public.proveedores set aplica_retencion = false, pct_retencion = 0 where id = 3602");
    }
  });

  test("M6 el payload es JSON libre: un manual en otra moneda que la cotización, o corrupto, se rechaza antes de numerar", async () => {
    const antes = foto();
    for (const manual of [{ ...VUELO, moneda: "USD" }, { ...VUELO, precio: -5 }, { ...VUELO, clase: "sistema" }, "x"]) {
      const id = cotizacionM({ items: [itemPayload(3601)], manuales: [manual] });
      const r = await convertirM(id, 1, { costosManuales: [COSTO_VUELO] });
      assert.equal(r.ok, false, JSON.stringify(manual));
      assert.match(r.error ?? "", /Servicio manual 1 de la cotización/);
      sinEscribir(JSON.stringify(manual), antes, id);
    }
  });

  test("M7 sin servicios manuales todo sigue igual (no se exigen costos ni se crean tramos ni CxP aérea)", async () => {
    const id = cotizacionM({ items: [itemPayload(3601)] });
    const r = await convertirM(id, 1);
    assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    assert.deepEqual(venta(n), [600_000, 420_000, 0, 0, "COP"]);
    assert.equal(cxpTodas(n).includes("aereo"), false);
    assert.equal(sql(`select count(*) from public.contrato_vuelos where numero_contrato = ${lit(n)}`), "0");
  });

  test("M8 por destino con dos hoteles: el manual va SOLO al primer contrato (no se duplica) y los precios no se mezclan", async () => {
    const id = cotizacionM({ items: [itemPayload(3601, "CARTAGENA"), itemPayload(3602, "SANTA MARTA")], manuales: [VUELO] });
    const r = await convertirM(id, 2, { agrupar: "por_destino", costosManuales: [COSTO_VUELO] });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.numeros!.length, 2);
    const [a, b] = r.numeros!;
    assert.deepEqual(venta(a), [2_400_000, 420_000, 1_500_000, 0, "COP"]);
    assert.deepEqual(venta(b), [600_000, 420_000, 0, 0, "COP"]);
    assert.equal(cxpTodas(b).includes("aereo"), false);
    assert.equal(sql(`select count(*) from public.contrato_vuelos where numero_contrato = ${lit(b)}`), "0");
    // reintento: nada se duplica
    const antes = foto();
    const otra = await convertirM(id, 2, { agrupar: "por_destino", costosManuales: [COSTO_VUELO] });
    assert.equal(otra.ok, true, otra.error);
    assert.deepEqual(foto(), antes);
  });
});

// ═════════════════════════════════════════════════════════════════════
describe("64 · cotización con servicio manual: solo personal interno, sin costo ni proveedor, sin tocar el resto", () => {
  const entrada = (manuales?: unknown[], items: unknown[] = [{ ...itemPayload(3601), itemId: "h1" }]) => ({
    items, tours: [], ...(manuales ? { manuales } : {}), cliente: { ...CLIENTE, tipoDoc: "CC" },
  });
  const totalCot = () => Number(sql("select count(*) from public.cotizaciones"));
  const cotDe = (id: number) => JSON.parse(sql(`select json_build_object('precio', precio_venta, 'moneda', moneda, 'payload', payload, 'detalle', detalle)::text from public.cotizaciones where id = ${id}`)) as {
    precio: number; moneda: string; payload: { items: unknown[]; manuales?: Record<string, unknown>[] }; detalle: { items: { descripcion: string; valor_total?: number }[]; vuelos: unknown[] };
  };
  const msgErr = (r: { ok: boolean }) => ("error" in r ? String((r as { error: unknown }).error) : "");
  const solicitar = async (e: unknown, opts: { anonimo?: boolean } = {}) => {
    anonimo = opts.anonimo ?? false;
    uidSesion = UID_ADMIN;
    try { return await crearSolicitudReserva(e); } finally { anonimo = false; }
  };

  test("Q1 un visitante anónimo NO puede mandar un servicio manual (precio declarado): se rechaza y no se crea cotización", async () => {
    const antes = totalCot();
    const r = await solicitar(entrada([VUELO]), { anonimo: true });
    assert.equal(r.ok, false);
    assert.match(msgErr(r), /personal autorizado/);
    assert.equal(totalCot(), antes);
  });

  test("Q2 un rol externo (agencia) tampoco", async () => {
    const antes = totalCot();
    uidSesion = UID_AGENCIA;
    try {
      const r = await crearSolicitudReserva(entrada([VUELO]));
      assert.equal(r.ok, false);
      assert.match(msgErr(r), /personal autorizado/);
    } finally { uidSesion = UID_ADMIN; }
    assert.equal(totalCot(), antes);
  });

  test("Q3 personal interno: total = hotel + manual; payload.manuales SIN costo ni proveedor; línea 'sujeto a confirmación'; sin vuelo de Sistema, sin contrato ni sillas", async () => {
    const ventas = totalVentas(), sillas = sql("select count(*) from public.sillas");
    const r = await solicitar(entrada([VUELO]));
    assert.equal(r.ok, true, msgErr(r));
    if (!r.ok) return;
    const c = cotDe(r.cotizacion.id);
    assert.equal(Number(c.precio), 2_400_000);
    assert.equal(c.moneda, "COP");
    assert.deepEqual(Object.keys(c.payload.manuales![0]).sort(), ["clase", "destino", "fechaIda", "fechaRegreso", "hotelEtiqueta", "hotelRef", "impuestoNoComisionable", "moneda", "nombre", "origen", "pax", "precio", "tramo"], "solo lo declarado: nada de costo/proveedor/record");
    assert.equal(c.payload.manuales![0].hotelRef, "item-0", "el vuelo queda ligado al hotel (ref que fija el servidor), no al id del navegador");
    const linea = c.detalle.items.find((i) => /^Vuelo ·/.test(i.descripcion));
    assert.ok(linea, "el documento lleva la línea del vuelo manual");
    assert.match(linea!.descripcion, /sujeto a confirmación de disponibilidad y tarifa/);
    assert.equal(Number(linea!.valor_total), 1_800_000);
    assert.doesNotMatch(linea!.descripcion + JSON.stringify(c.payload.manuales), /proveedor|costo|record|PNR/i);
    assert.equal((c.detalle as unknown as { hoteles: unknown[] }).hoteles.length, 1, "el único hotel del documento es el del catálogo; el manual no agrega hotel ni proveedor");
    // El vuelo manual se pinta en el cuadro de vuelos: sin record, sin aerolínea, con los pasajeros de ESE vuelo y el aviso; nunca un vuelo de Sistema.
    const tr = c.detalle.vuelos as { direccion: string; record: unknown; aerolinea: unknown; servicios: string }[];
    assert.deepEqual(tr.map((t) => t.direccion), ["ida", "regreso"]);
    for (const t of tr) {
      assert.equal(t.record, null); assert.equal(t.aerolinea, null);
      assert.match(t.servicios, /pasajeros en este vuelo: 2.*sujeto a confirmación de disponibilidad y tarifa/);
    }
    assert.match(r.mensaje, /Servicios manuales .*sujetos a confirmación/);
    assert.match(r.mensaje, /Total \(PVP\): .*2\.400\.000/);
    assert.equal(totalVentas(), ventas, "cotizar no crea contrato");
    assert.equal(sql("select count(*) from public.sillas"), sillas, "cotizar no toca sillas");
  });

  test("Q4 agregar/editar/quitar el manual no altera hotel ni add-ons: mismo ítem de hotel, mismas líneas; solo cambia el total por el importe del manual", async () => {
    const sin = await solicitar(entrada());
    const con = await solicitar(entrada([VUELO]));
    const editado = await solicitar(entrada([{ ...VUELO, precio: 2_000_000, pax: 1 }]));
    assert.ok(sin.ok && con.ok && editado.ok);
    if (!sin.ok || !con.ok || !editado.ok) return;
    const [a, b, e] = [sin, con, editado].map((x) => cotDe(x.cotizacion.id));
    assert.equal(Number(a.precio), 600_000);
    assert.equal(Number(b.precio), 2_400_000);
    assert.equal(Number(e.precio), 2_600_000);
    assert.deepEqual(a.payload.items, b.payload.items, "el hotel cotizado no cambia al agregar el manual");
    assert.deepEqual(b.payload.items, e.payload.items, "ni al editarlo");
    assert.equal(a.payload.manuales, undefined, "sin manual no hay clave en el payload");
    assert.deepEqual(a.detalle.items, b.detalle.items.filter((i) => !/^Vuelo ·/.test(i.descripcion)), "las demás líneas del documento no cambian");
    assert.deepEqual(a.detalle.vuelos, [], "sin manual no hay cuadro de vuelos");
  });

  test("Q5 un manual solo, sin hotel ni servicio del tarifario, no sostiene una cotización", async () => {
    const antes = totalCot();
    const r = await solicitar(entrada([VUELO], []));
    assert.equal(r.ok, false);
    assert.match(msgErr(r), /ya tenga un hotel o un servicio|carrito está vacío|tarifario|elige el hotel del carrito/i);
    assert.equal(totalCot(), antes);
  });

  test("Q6 moneda distinta a la del carrito: se rechaza (no se excluye en silencio ni se convierte) y no se crea nada", async () => {
    const antes = totalCot();
    const r = await solicitar(entrada([{ ...VUELO, moneda: "USD", precio: 400, impuestoNoComisionable: 0 }]));
    assert.equal(r.ok, false);
    assert.match(msgErr(r), /debe estar en COP/);
    assert.equal(totalCot(), antes);
  });

  test("Q7 datos inválidos (precio 0, vuelo sin destino, fecha de regreso anterior) se rechazan en el servidor aunque el navegador los haya dejado pasar", async () => {
    const antes = totalCot();
    for (const malo of [{ ...VUELO, precio: 0 }, { ...VUELO, destino: "" }, { ...VUELO, fechaRegreso: "2030-02-01" }, { ...VUELO, pax: 0 }]) {
      const r = await solicitar(entrada([malo]));
      assert.equal(r.ok, false, JSON.stringify(malo));
    }
    assert.equal(totalCot(), antes);
  });

  test("Q8 de la cotización al contrato: precio = hotel + vuelo y el vuelo aparece en el contrato sin record", async () => {
    const q = await solicitar(entrada([VUELO]));
    assert.ok(q.ok);
    if (!q.ok) return;
    const r = await convertirM(q.cotizacion.id, 1, { costosManuales: [COSTO_VUELO] });
    assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    assert.deepEqual(venta(n), [2_400_000, 420_000, 1_500_000, 0, "COP"]);
    assert.equal(sql(`select count(*) from public.contrato_vuelos where numero_contrato = ${lit(n)} and record is null`), "2");
  });
});

// ═════════════════════════════════════════════════════════════════════
describe("64 · congelado del servicio cotizado, bloque malformado, base comisionable y reintento (migración 249)", () => {
  const VALIDO = validarServicioManual(VUELO);
  const DOC_VUELO = { descripcion: VALIDO.ok ? descripcionCotizacionManual(VALIDO.valor) : "", valor_total: VUELO.precio };
  const payloadDe = (id: number) => JSON.parse(sql(`select payload::text from public.cotizaciones where id = ${id}`)) as { manuales?: unknown; items: unknown[]; cliente: Record<string, unknown>; b2bAsistido?: unknown };
  const sinImpuesto = (({ impuestoNoComisionable: _i, ...r }) => r)(VUELO);
  const planB2BFijo = () => {
    const r = construirPlanB2B({ aliado: { id: 6401, nombre: "Agencia 64", tipo: "agencia", pctAliado: 0.1 }, pct: 0.1, pctOrigen: "aliado", modo: "neta", moneda: "COP",
      lineas: [{ clave: "item-0", pvp: 600_000, impuesto: 0 }, lineaB2BManual(VALIDO.ok ? VALIDO.valor : (VUELO as never), 0)], actor: { id: UID_ADMIN, email: "admin236@x.test", rol: "administracion" }, congeladoEn: "2030-01-01T00:00:00Z" });
    assert.ok(r.ok);
    return r.ok ? r.plan : null;
  };

  // PATCH directo por la Data API con la sesión de un rol comercial (el mismo camino de un navegador con su JWT).
  async function parchear(id: number, payload: unknown): Promise<{ error: { code?: string; message?: string } | null }> {
    uidSesion = UID_ADMIN;
    const { error } = await clienteSesion().from("cotizaciones").update({ payload } as never).eq("id", id);
    return { error };
  }
  const MUTACIONES: [string, (m: Record<string, unknown>[]) => unknown[] | undefined][] = [
    ["precio", (m) => m.map((x) => ({ ...x, precio: 1 }))],
    ["ruta (destino)", (m) => m.map((x) => ({ ...x, destino: "SMR" }))],
    ["fecha de ida", (m) => m.map((x) => ({ ...x, fechaIda: "2030-05-05" }))],
    ["nombre", (m) => m.map((x) => ({ ...x, nombre: "Otro servicio" }))],
    ["cantidad de pasajeros", (m) => m.map((x) => ({ ...x, pax: 9 }))],
    ["impuesto no comisionable", (m) => m.map((x) => ({ ...x, impuestoNoComisionable: 0 }))],
    ["agregar un manual", (m) => [...m, { ...OTRO }]],
    ["quitar todos (arreglo vacío)", () => []],
    ["quitar el bloque", () => undefined],
  ];

  for (const [variante, plan] of [["B2C", false], ["B2B asistido", true]] as const) {
    test(`Z1 ${variante}: un PATCH directo no puede modificar, agregar ni quitar los manuales cotizados`, async () => {
      const id = cotizacionM({ items: [{ ...itemPayload(3601), ref: "item-0" }], manuales: [VUELO], payloadExtra: plan ? { b2bAsistido: planB2BFijo() } : {} });
      const original = payloadDe(id);
      for (const [que, mutar] of MUTACIONES) {
        const { manuales, ...resto } = payloadDe(id);
        const nuevo = mutar(manuales as Record<string, unknown>[]);
        const { error } = await parchear(id, nuevo === undefined ? resto : { ...resto, manuales: nuevo });
        assert.match(error?.message ?? "NO SE RECHAZÓ", /MANUALES_INMUTABLES/, `${variante} · ${que}`);
        assert.deepEqual(payloadDe(id), original, `${variante} · ${que}: el payload no cambia`);
      }
    });
  }

  test("Z2 una cotización que nació SIN manuales tampoco puede recibirlos por PATCH", async () => {
    const id = cotizacionM({ items: [itemPayload(3601)] });
    const { manuales: _sin, ...p } = payloadDe(id);
    const { error } = await parchear(id, { ...p, manuales: [VUELO] });
    assert.match(error?.message ?? "NO SE RECHAZÓ", /MANUALES_INMUTABLES/);
    assert.equal(payloadDe(id).manuales, undefined);
  });

  test("Z3 NO bloquea lo operativo: el alta de persona (payload.cliente), el progreso (detalle) y el estado siguen actualizándose", async () => {
    const id = cotizacionM({ items: [itemPayload(3601)], manuales: [VUELO] });
    const p = payloadDe(id);
    const manualesAntes = p.manuales;
    const a = await parchear(id, { ...p, cliente: { ...p.cliente, telefono: "3111111111" }, nota_operativa: "x" });
    assert.equal(a.error, null, a.error?.message);
    const { error } = await clienteSesion().from("cotizaciones").update({ detalle: { items: [DOC_VUELO], progreso: 1 }, estado: "abierta" } as never).eq("id", id);
    assert.equal(error, null, error?.message);
    assert.deepEqual(payloadDe(id).manuales, manualesAntes);
  });

  test("Z4 bloque ausente o malformado con manuales declarados en el documento: se rechaza antes de numerar (nunca se convierte en [])", async () => {
    const antes = foto();
    const casos: [string, Parameters<typeof cotizacionM>[0]][] = [
      ["bloque ausente", { items: [itemPayload(3601)], detalleItems: [DOC_VUELO] }],
      ["bloque null", { items: [itemPayload(3601)], detalleItems: [DOC_VUELO], payloadExtra: { manuales: null } }],
      ["bloque objeto", { items: [itemPayload(3601)], detalleItems: [DOC_VUELO], payloadExtra: { manuales: {} } }],
      ["bloque vacío", { items: [itemPayload(3601)], detalleItems: [DOC_VUELO], payloadExtra: { manuales: [] } }],
      ["precio distinto al cotizado", { items: [itemPayload(3601)], manuales: [{ ...VUELO, precio: 1_000_000, impuestoNoComisionable: 0 }], detalleItems: [DOC_VUELO] }],
      ["ruta distinta a la cotizada", { items: [itemPayload(3601)], manuales: [{ ...VUELO, destino: "SMR" }], detalleItems: [DOC_VUELO] }],
      ["más manuales que los cotizados", { items: [itemPayload(3601)], manuales: [VUELO, OTRO], detalleItems: [DOC_VUELO] }],
      ["sin impuesto no comisionable (cotización anterior al campo)", { items: [itemPayload(3601)], manuales: [sinImpuesto] }],
    ];
    for (const [que, c] of casos) {
      const id = cotizacionM(c);
      const r = await convertirM(id, 1, { costosManuales: [COSTO_VUELO] });
      assert.equal(r.ok, false, que);
      sinEscribir(que, antes, id);
    }
  });

  test("Z5 el plan B2B que declara un manual que el payload no trae se rechaza antes de numerar", async () => {
    const antes = foto();
    const id = cotizacionM({ items: [{ ...itemPayload(3601), ref: "item-0" }], payloadExtra: { b2bAsistido: planB2BFijo() } });
    const r = await convertirM(id, 1, { costosManuales: [COSTO_VUELO] });
    assert.equal(r.ok, false);
    sinEscribir("plan sin payload", antes, id);
  });

  // ── Base comisionable: PVP − impuesto no comisionable, en PVP y NETO ──
  for (const modo of ["comisionable", "neta"] as const) {
    test(`Z6 B2B ${modo}: el impuesto no comisionable del manual se congela y la comisión se calcula sobre PVP − impuesto, al mostrar los términos y al convertir`, async () => {
      sql(`insert into public.aliados (id, nombre, tipo, pct_comision, activo) values (6401, 'Agencia 64', 'agencia', 0.10, true) on conflict (id) do update set activo = true, pct_comision = 0.10, tipo = 'agencia'`);
      uidSesion = UID_ADMIN; anonimo = false;
      const entrada = { items: [{ ...itemPayload(3601), itemId: "h1" }], tours: [], manuales: [VUELO], cliente: { ...CLIENTE, tipoDoc: "CC" }, asistencia: { canal: "b2b", aliadoId: 6401, modo } };
      const q = await crearSolicitudReserva(entrada);
      assert.equal(q.ok, true, "error" in q ? String(q.error) : "");
      if (!q.ok) return;
      const plan = (payloadDe(q.cotizacion.id).b2bAsistido ?? {}) as { pvp: number; impuesto: number; base: number; comision: number; total_exigible: number; lineas: { clave: string; impuesto: number }[] };
      assert.deepEqual({ pvp: plan.pvp, impuesto: plan.impuesto, base: plan.base, comision: plan.comision, total: plan.total_exigible },
        { pvp: 2_400_000, impuesto: 200_000, base: 2_200_000, comision: 220_000, total: modo === "neta" ? 2_180_000 : 2_400_000 }, "términos congelados");
      assert.equal(plan.lineas.find((l) => l.clave === "manual-0")?.impuesto, 200_000);
      const r = await convertirM(q.cotizacion.id, 1, { costosManuales: [COSTO_VUELO] });
      assert.equal(r.ok, true, r.error);
      const n = r.numeros![0];
      const [impuesto, comisionVenta, precio] = fila(`select impuesto, comision_b2b, precio_venta from public.ventas where numero_contrato = ${lit(n)}`).map(Number);
      assert.deepEqual({ impuesto, comisionVenta, precio }, { impuesto: 200_000, comisionVenta: 220_000, precio: modo === "neta" ? 2_180_000 : 2_400_000 }, "contrato");
      assert.equal(Number(sql(`select base_comision from public.aliados_b2b where numero_contrato = ${lit(n)}`)), 2_200_000, "base de la comisión B2B");
    });
  }

  test("Z7 un impuesto no comisionable mayor que el PVP, negativo o ausente se rechaza al cotizar (también por la frontera pública)", async () => {
    const antes = Number(sql("select count(*) from public.cotizaciones"));
    for (const malo of [{ ...VUELO, impuestoNoComisionable: VUELO.precio + 1 }, { ...VUELO, impuestoNoComisionable: -1 }, sinImpuesto]) {
      uidSesion = UID_ADMIN; anonimo = false;
      const r = await crearSolicitudReserva({ items: [{ ...itemPayload(3601), itemId: "h1" }], tours: [], manuales: [malo], cliente: { ...CLIENTE, tipoDoc: "CC" } });
      assert.equal(r.ok, false, JSON.stringify(malo));
    }
    assert.equal(Number(sql("select count(*) from public.cotizaciones")), antes);
  });

  test("Z8 reintento tras convertir el primer destino: el servidor no exige ni usa costos manuales y no duplica nada", async () => {
    const id = cotizacionM({ items: [itemPayload(3601, "CARTAGENA"), itemPayload(3602, "SANTA MARTA")], manuales: [VUELO] });
    HOTELES[3601].nombre = "Hotel Uno Z8";
    HOTELES[3602].nombre = "Hotel Dos Z8";
    sql(`create or replace function public.t64_falla() returns trigger language plpgsql as $f$ begin raise exception 't64 falla simulada'; end $f$;
         create trigger t64_falla_g2 before insert on public.ventas for each row when (new.hotel = 'Hotel Dos Z8') execute function public.t64_falla()`);
    try {
      const r1 = await convertirM(id, 2, { agrupar: "por_destino", costosManuales: [COSTO_VUELO] });
      assert.equal(r1.ok, false, "el segundo destino falla");
    } finally { sql("drop trigger if exists t64_falla_g2 on public.ventas; drop function if exists public.t64_falla()"); }
    assert.equal(sql("select count(*) from public.ventas where hotel = 'Hotel Uno Z8'"), "1", "el primer destino sí quedó convertido");
    const cxpAntes = totalCxp();
    const r2 = await convertirM(id, 2, { agrupar: "por_destino" }); // SIN costosManuales
    assert.equal(r2.ok, true, r2.error);
    assert.equal(r2.numeros!.length, 2);
    assert.equal(totalCxp() - cxpAntes, 1, "solo la CxP del hotel del segundo destino; el vuelo manual no se duplica");
    assert.equal(sql(`select count(*) from public.contrato_vuelos where numero_contrato in (${r2.numeros!.map(lit).join(",")}) and record is null`), "2");
  });
});

// ═════════════════════════════════════════════════════════════════════
// Ronda 3: tramos (ida / regreso / ida y regreso), hotel asociado, fechas contra su estadía, pasajeros por vuelo, varios destinos y cuadro de vuelos.
describe("64 · vuelo manual por tramos, ligado a SU hotel del carrito (códigos IATA y fechas del plan)", () => {
  const H1 = () => ({ ...itemPayload(3601), itemId: "h1" });
  const H2 = () => ({ ...itemPayload(3602, "SANTA MARTA"), itemId: "h2" });
  const V = (o: Record<string, unknown> = {}) => ({ ...VUELO, ...o });
  const ABIERTAS = () => Number(sql("select count(*) from public.cotizaciones"));
  const crear = async (items: unknown[], manuales: unknown[], opts: { anonimo?: boolean } = {}) => {
    anonimo = opts.anonimo ?? false; uidSesion = UID_ADMIN;
    try { return await crearSolicitudReserva({ items, tours: [], manuales, cliente: { ...CLIENTE, tipoDoc: "CC" } }); } finally { anonimo = false; }
  };
  const err = (r: { ok: boolean }) => ("error" in r ? String((r as { error: unknown }).error) : "");
  type Cot = { precio: number; payload: { manuales: Record<string, unknown>[] }; detalle: { items: { descripcion: string; valor_total: number }[]; vuelos: Record<string, unknown>[] } };
  const cot = (id: number) => JSON.parse(sql(`select json_build_object('precio', precio_venta, 'payload', payload, 'detalle', detalle)::text from public.cotizaciones where id = ${id}`)) as Cot;
  const sinSillas = () => ({ sillas: sql("select count(*) from public.sillas"), bloqueos: sql("select count(*) from public.bloqueos_vuelo") });
  // Plan del hotel mock: 2030-03-01 → 2030-03-04, destino CARTAGENA (CTG). El de SANTA MARTA (SMR) se fija en cada prueba.
  const TRAMOS = [
    ["ida", V({ tramo: "ida", fechaRegreso: null }), ["ida"], ["2030-03-01"]],
    ["regreso", V({ tramo: "regreso", origen: "ctg", destino: "MDE", fechaIda: null }), ["regreso"], ["2030-03-04"]],
    ["ida y regreso", V(), ["ida", "regreso"], ["2030-03-01", "2030-03-04"]],
  ] as const;
  for (const [nombre, manual, direcciones, fechas] of TRAMOS) {
    test(`V1 ${nombre}: el cuadro de vuelos lleva SOLO sus tramos con códigos IATA; el lado del hotel sale del catálogo; el precio entra una sola vez; sin sillas ni bloqueos`, async () => {
      const antes = sinSillas();
      const r = await crear([H1()], [manual]);
      assert.equal(r.ok, true, err(r));
      if (!r.ok) return;
      const c = cot(r.cotizacion.id);
      assert.equal(Number(c.precio), 600_000 + VUELO.precio, "total = hotel + vuelo");
      assert.equal(c.detalle.items.filter((i) => /^Vuelo ·/.test(i.descripcion)).length, 1, "una sola línea de valor para el vuelo");
      assert.deepEqual(c.detalle.vuelos.map((t) => t.direccion), [...direcciones]);
      assert.deepEqual(c.detalle.vuelos.map((t) => t.fecha_salida), [...fechas]);
      for (const t of c.detalle.vuelos) { assert.equal(t.record, null); assert.equal(t.aerolinea, null); assert.match(String(t.servicios), /pasajeros en este vuelo: 2 · sujeto a confirmación/); assert.match(String(t.origen_codigo), /^[A-Z]{3}$/); assert.match(String(t.destino_codigo), /^[A-Z]{3}$/); }
      const m = c.payload.manuales[0];
      assert.equal(m.hotelRef, "item-0", "ligado al hotel por la ref del servidor");
      assert.equal(String(m.tramo === "regreso" ? m.origen : m.destino), "CTG", "Cartagena = CTG, fijado por el servidor desde el catálogo");
      assert.deepEqual(sinSillas(), antes, "cotizar un vuelo manual no toca sillas ni bloqueos");
    });
  }

  test("V2 fechas = las del PLAN del hotel (01-mar → 04-mar): cualquier otra se rechaza ANTES de cotizar, también si cae dentro de la estadía", async () => {
    for (const m of [V({ tramo: "ida", fechaRegreso: null }), V({ tramo: "regreso", origen: "CTG", destino: "BOG", fechaIda: null }), V()]) {
      const r = await crear([H1()], [m]); assert.equal(r.ok, true, `${m.tramo}: ${err(r)}`);
    }
    const antes = ABIERTAS();
    const mal: [string, Record<string, unknown>][] = [
      ["ida un día ANTES de la entrada", V({ tramo: "ida", fechaIda: "2030-02-28", fechaRegreso: null })],
      ["ida DENTRO de la estadía pero no es la del plan", V({ tramo: "ida", fechaIda: "2030-03-02", fechaRegreso: null })],
      ["ida DESPUÉS de la salida", V({ tramo: "ida", fechaIda: "2030-03-05", fechaRegreso: null })],
      ["regreso un día DESPUÉS de la salida", V({ tramo: "regreso", origen: "CTG", destino: "BOG", fechaIda: null, fechaRegreso: "2030-03-05" })],
      ["regreso DENTRO de la estadía pero no es el del plan", V({ tramo: "regreso", origen: "CTG", destino: "BOG", fechaIda: null, fechaRegreso: "2030-03-03" })],
      ["ida y regreso con el regreso antes de la ida", V({ fechaIda: "2030-03-04", fechaRegreso: "2030-03-02" })],
      ["ida con fecha de regreso", V({ tramo: "ida", fechaRegreso: "2030-03-04" })],
      ["regreso con fecha de ida", V({ tramo: "regreso", origen: "CTG", destino: "BOG", fechaIda: "2030-03-01" })],
      ["origen o destino como nombre de ciudad en vez de IATA", V({ destino: "Cartagena" })],
    ];
    for (const [que, m] of mal) { const r = await crear([H1()], [m]); assert.equal(r.ok, false, que); }
    assert.equal(ABIERTAS(), antes, "ninguna se cotizó");
  });

  test("V3 vuelos separados con distintos pasajeros: cada uno lleva los suyos y se suman una vez; más pasajeros que la cotización se rechaza", async () => {
    const a = V({ tramo: "ida", fechaRegreso: null, nombre: "Avianca ida", pax: 2, precio: 900_000, impuestoNoComisionable: 0 });
    const b = V({ tramo: "ida", fechaRegreso: null, nombre: "Latam ida", pax: 1, precio: 500_000, impuestoNoComisionable: 0 });
    const r = await crear([H1()], [a, b]);
    assert.equal(r.ok, true, err(r));
    if (!r.ok) return;
    const c = cot(r.cotizacion.id);
    assert.equal(Number(c.precio), 600_000 + 900_000 + 500_000);
    assert.deepEqual(c.detalle.vuelos.map((t) => /pasajeros en este vuelo: (\d)/.exec(String(t.servicios))![1]), ["2", "1"]);
    const antes = ABIERTAS();
    for (const pax of [3, 0, 1.5]) assert.equal((await crear([H1()], [V({ pax })])).ok, false, `pax ${pax}`);
    assert.equal(ABIERTAS(), antes);
  });

  test("V4 varios destinos: el vuelo se liga al hotel ELEGIDO (nunca al primero), con su IATA y las fechas de SU plan; sin elegir, desconocido o cruzado se rechaza", async () => {
    HOTELES[3602] = { nombre: "Hotel Santa Marta 64", moneda: "COP", pvp: 300_000, neto: 210_000, destino: "SANTA MARTA", ida: "2030-03-10", regreso: "2030-03-14" };
    const aSM = V({ hotelRef: "h2", tramo: "ida_regreso", origen: "BOG", destino: "SMR", fechaIda: "2030-03-10", fechaRegreso: "2030-03-14", nombre: "Vuelo a Santa Marta" });
    const r = await crear([H1(), H2()], [aSM]);
    assert.equal(r.ok, true, err(r));
    if (!r.ok) return;
    const m = cot(r.cotizacion.id).payload.manuales[0];
    assert.deepEqual([m.hotelRef, m.destino, m.hotelEtiqueta], ["item-1", "SMR", "Hotel Santa Marta 64"]);
    const antes = ABIERTAS();
    const mal: [string, Record<string, unknown>][] = [
      ["sin hotel (no se asigna al primero)", V({ hotelRef: "" })],
      ["hotel que no está en el carrito", V({ hotelRef: "zzz" })],
      ["fechas del primer hotel contra el segundo", { ...aSM, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04" }],
      ["IATA del primer hotel contra el segundo", { ...aSM, destino: "CTG" }],
      ["IATA del segundo hotel contra el primero", V({ destino: "SMR" })],
    ];
    for (const [que, x] of mal) assert.equal((await crear([H1(), H2()], [x])).ok, false, que);
    assert.equal(ABIERTAS(), antes);
  });

  test("V4b un destino SIN código IATA confiable en el catálogo: se pide corregir el dato y no se cotiza (no se infiere del nombre del hotel)", async () => {
    HOTELES[3601] = { ...HOTELES[3601], destino: "NARNIA" };
    const antes = ABIERTAS();
    const r = await crear([{ ...itemPayload(3601, "NARNIA"), itemId: "h1" }], [V()]);
    assert.equal(r.ok, false);
    assert.match(err(r), /código IATA confiable.*Producto → Destinos/);
    assert.equal(ABIERTAS(), antes);
  });

  test("V5 conversión por destino: cada vuelo viaja y se cobra en el contrato de SU hotel; sillas y bloqueos intactos", async () => {
    HOTELES[3602] = { nombre: "Hotel Santa Marta V5", moneda: "COP", pvp: 300_000, neto: 210_000, destino: "SANTA MARTA", ida: "2030-03-10", regreso: "2030-03-14" };
    const aCTG = V({ nombre: "Vuelo CTG", hotelRef: "h1" });
    const aSM = V({ nombre: "Vuelo SMR", hotelRef: "h2", destino: "SMR", fechaIda: "2030-03-10", fechaRegreso: "2030-03-14", precio: 1_000_000, impuestoNoComisionable: 0 });
    const q = await crear([H1(), H2()], [aCTG, aSM]);
    assert.equal(q.ok, true, err(q));
    if (!q.ok) return;
    const antes = sinSillas();
    const r = await convertirM(q.cotizacion.id, 2, { agrupar: "por_destino", costosManuales: [{ costo: 1_500_000, proveedor: "Prov CTG" }, { costo: 800_000, proveedor: "Prov SMR" }] });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.numeros!.length, 2);
    const [n1, n2] = r.numeros!;
    assert.deepEqual(venta(n1), [600_000 + 1_800_000, 420_000, 1_500_000, 0, "COP"]);
    assert.deepEqual(venta(n2), [600_000 + 1_000_000, 420_000, 800_000, 0, "COP"]);
    assert.match(cxpTodas(n1), /aereo\|Prov CTG\|1500000/);
    assert.match(cxpTodas(n2), /aereo\|Prov SMR\|800000/);
    assert.doesNotMatch(cxpTodas(n1), /Prov SMR/);
    assert.doesNotMatch(cxpTodas(n2), /Prov CTG/);
    assert.equal(sql(`select string_agg(coalesce(destino_codigo, destino_ciudad), ',' order by orden) from public.contrato_vuelos where numero_contrato = ${lit(n2)}`), "SMR,BOG");
    assert.deepEqual(sinSillas(), antes);
    assert.equal(sql(`select count(*) from public.sillas where numero_contrato in (${lit(n1)}, ${lit(n2)})`), "0");
  });

  test("V6 reintento parcial: si el vuelo vive en el destino PENDIENTE se siguen exigiendo costo y proveedor; solo de ese vuelo", async () => {
    HOTELES[3601].nombre = "Hotel Uno V6";
    HOTELES[3602] = { nombre: "Hotel Dos V6", moneda: "COP", pvp: 300_000, neto: 210_000, destino: "SANTA MARTA", ida: "2030-03-10", regreso: "2030-03-14" };
    const aSM = V({ nombre: "Vuelo SMR V6", hotelRef: "h2", destino: "SMR", fechaIda: "2030-03-10", fechaRegreso: "2030-03-14" });
    const q = await crear([H1(), H2()], [aSM]);
    assert.equal(q.ok, true, err(q));
    if (!q.ok) return;
    sql(`create or replace function public.t64_falla6() returns trigger language plpgsql as $f$ begin raise exception 't64 falla simulada'; end $f$;
         create trigger t64_falla6_g before insert on public.ventas for each row when (new.hotel = 'Hotel Dos V6') execute function public.t64_falla6()`);
    try { assert.equal((await convertirM(q.cotizacion.id, 2, { agrupar: "por_destino", costosManuales: [COSTO_VUELO] })).ok, false, "el destino del vuelo falla"); }
    finally { sql("drop trigger if exists t64_falla6_g on public.ventas; drop function if exists public.t64_falla6()"); }
    assert.equal(sql("select count(*) from public.ventas where hotel = 'Hotel Uno V6'"), "1", "el primer destino quedó convertido");
    const antes = foto();
    const sin = await convertirM(q.cotizacion.id, 2, { agrupar: "por_destino" });
    assert.equal(sin.ok, false, "el vuelo sigue pendiente: sin costo no se numera");
    assert.match(sin.error ?? "", /costo y el proveedor/);
    assert.deepEqual(foto(), antes);
    const ok = await convertirM(q.cotizacion.id, 2, { agrupar: "por_destino", costosManuales: [COSTO_VUELO] });
    assert.equal(ok.ok, true, ok.error);
    assert.equal(ok.numeros!.length, 2);
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato in (${ok.numeros!.map(lit).join(",")}) and tipo_proveedor = 'aereo'`), "1");
  });

  test("V7 datos manipulados en la cotización: hotel inexistente, cuadro de vuelos alterado (fecha, ruta, pasajeros, tramo borrado) o precio distinto se rechazan antes de numerar", async () => {
    const v = validarServicioManual({ ...VUELO, hotelRef: "item-0" });
    assert.ok(v.ok);
    const bueno: Record<string, unknown>[] = v.ok ? tramosVueloManual(v.valor, true).map((t, i) => ({ id: i + 1, ...t })) : [];
    const casos: [string, Parameters<typeof cotizacionM>[0]][] = [
      ["hotel inexistente", { items: [itemPayload(3601)], manuales: [VUELO], hotelDeManual: "item-7" }],
      ["fecha del regreso alterada", { items: [itemPayload(3601)], manuales: [VUELO], detalleVuelos: bueno.map((t, i) => (i === 1 ? { ...t, fecha_salida: "2030-03-09" } : t)) }],
      ["ruta alterada", { items: [itemPayload(3601)], manuales: [VUELO], detalleVuelos: bueno.map((t) => ({ ...t, destino_codigo: "CLO" })) }],
      ["pasajeros alterados", { items: [itemPayload(3601)], manuales: [VUELO], detalleVuelos: bueno.map((t) => ({ ...t, servicios: String(t.servicios).replace("2", "9") })) }],
      ["tramo borrado", { items: [itemPayload(3601)], manuales: [VUELO], detalleVuelos: bueno.slice(0, 1) }],
      ["cuadro vacío", { items: [itemPayload(3601)], manuales: [VUELO], detalleVuelos: [] }],
    ];
    const antes = foto();
    for (const [que, c] of casos) {
      const id = cotizacionM(c);
      const r = await convertirM(id, 1, { costosManuales: [COSTO_VUELO] });
      assert.equal(r.ok, false, que);
      sinEscribir(que, antes, id);
    }
  });
});

describe("64 · el vuelo se vuelve a comprobar contra la estadía RECALCULADA del hotel al convertir", () => {
  test("V8 si el hotel ya no cuadra con el vuelo cotizado (otra entrada o otro destino), la conversión se rechaza antes de numerar", async () => {
    const antes = foto();
    const casos: [string, Partial<HotelSim>][] = [
      ["la entrada del hotel pasó al 2 de marzo (la ida del 1.º queda antes de la entrada)", { ida: "2030-03-02" }],
      ["la salida del hotel se adelantó al 3 de marzo (el regreso del 4 queda después de la salida)", { regreso: "2030-03-03" }],
      ["el hotel ahora está en otra ciudad", { destino: "SANTA MARTA" }],
    ];
    for (const [que, cambio] of casos) {
      const id = cotizacionM({ items: [itemPayload(3601)], manuales: [VUELO] });
      HOTELES[3601] = { ...HOTELES[3601], ...cambio };
      const r = await convertirM(id, 1, { costosManuales: [COSTO_VUELO] });
      assert.equal(r.ok, false, que);
      assert.match(r.error ?? "", /Tiquete aéreo ida y regreso/);
      sinEscribir(que, antes, id);
      HOTELES[3601] = { nombre: "Hotel Uno 64", moneda: "COP", pvp: 300_000, neto: 210_000 };
    }
    const bien = await convertirM(cotizacionM({ items: [itemPayload(3601)], manuales: [VUELO] }), 1, { costosManuales: [COSTO_VUELO] });
    assert.equal(bien.ok, true, bien.error);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Comparativa: vuelos manuales COMUNES a todas las opciones, solo personal interno, congelados en cada opción.
describe("64 · cotización comparativa con vuelos manuales comunes", () => {
  const items2 = () => [{ ...itemPayload(3601), itemId: "h1" }, { ...itemPayload(3602), itemId: "h2" }];
  const COMUN = (o: Record<string, unknown> = {}) => ({ ...VUELO, hotelRef: "comun", ...o });
  const crearCmp = async (manuales: unknown[] | undefined, opts: { anonimo?: boolean; uid?: string; items?: unknown[] } = {}) => {
    anonimo = opts.anonimo ?? false; uidSesion = opts.uid ?? UID_ADMIN;
    try { return await crearComparativaCarrito({ items: opts.items ?? items2(), tours: [], ...(manuales ? { manuales } : {}), cliente: { ...CLIENTE, tipoDoc: "CC" } }); }
    finally { anonimo = false; uidSesion = UID_ADMIN; }
  };
  const err = (r: { ok: boolean }) => ("error" in r ? String((r as { error: unknown }).error) : "");
  const totalCot = () => Number(sql("select count(*) from public.cotizaciones"));
  type Opcion = { op: string; ac: string; total: number; resumen: { vuelos: Record<string, unknown>[]; total_hotel: number }; plantilla: { payload: { manuales?: Record<string, unknown>[]; items: { hotelNombre: string }[] }; detalle: { vuelos: Record<string, unknown>[] } } };
  const opciones = (id: number) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('op', opcion_ref, 'ac', acomodacion_ref, 'total', total, 'resumen', resumen_publico, 'plantilla', plantilla_hija) order by orden), '[]'::json)::text from public.cotizacion_opciones where cotizacion_id = ${id}`)) as Opcion[];
  const madre = (id: number) => JSON.parse(sql(`select json_build_object('token', share_token, 'version', version, 'precio', precio_venta, 'estado', estado)::text from public.cotizaciones where id = ${id}`)) as { token: string; version: number; precio: number | null; estado: string };
  const sinSillas = () => ({ sillas: sql("select count(*) from public.sillas"), bloqueos: sql("select count(*) from public.bloqueos_vuelo") });

  test("C1 una llamada directa sin permiso (visitante o aliado) con manuales se RECHAZA: no se acepta para omitirla, y no se crea nada", async () => {
    const antes = totalCot();
    for (const o of [{ anonimo: true }, { uid: UID_AGENCIA }]) {
      const r = await crearCmp([COMUN()], o);
      assert.equal(r.ok, false);
      assert.match(err(r), /personal autorizado/);
    }
    assert.equal(totalCot(), antes);
  });

  test("C2 solo vuelos y bien formados: 'otro servicio', bloque corrupto o impuesto mayor al precio se rechazan", async () => {
    const antes = totalCot();
    for (const m of [{ ...OTRO, hotelRef: "comun" }, COMUN({ impuestoNoComisionable: 99_999_999 }), COMUN({ tramo: "ida", fechaRegreso: "2030-03-04" }), "x"]) {
      assert.equal((await crearCmp([m])).ok, false, JSON.stringify(m));
    }
    assert.equal(totalCot(), antes);
  });

  test("C3 personal interno con dos hoteles: cada opción lleva el vuelo y lo suma UNA vez a su propio total; la madre no suma nada; sin sillas ni bloqueos", async () => {
    const sin = sinSillas();
    const r = await crearCmp([COMUN()]);
    assert.equal(r.ok, true, err(r));
    if (!r.ok) return;
    const m = madre(r.id), ops = opciones(r.id);
    assert.equal(m.precio, null, "la madre no tiene total: las alternativas nunca se suman entre sí");
    assert.ok(ops.length >= 2);
    for (const o of ops) {
      assert.equal(Number(o.total), 600_000 + VUELO.precio, `opción ${o.op}/${o.ac}: hotel + vuelo, una vez`);
      assert.equal(o.plantilla.payload.manuales!.length, 1);
      assert.equal(o.plantilla.payload.manuales![0].hotelRef, "item-0", "dentro de cada opción el vuelo está ligado a SU hotel");
      assert.deepEqual(o.plantilla.detalle.vuelos.map((t) => t.direccion), ["ida", "regreso"]);
      assert.deepEqual((o.resumen.vuelos ?? []).map((t) => t.tramo), ["ida", "regreso"], "el comprador ve ruta, tramo y fecha");
      assert.doesNotMatch(JSON.stringify(o.resumen.vuelos), /precio|costo|proveedor|comision|impuesto|record/i, "nada de precio, costo ni comisión en los vuelos del resumen público");
    }
    assert.deepEqual(sinSillas(), sin);
  });

  test("C4 solo se ofrece si TODAS las opciones son compatibles: fechas fuera de la estadía de una opción o destinos distintos bloquean la comparativa", async () => {
    const antes = totalCot();
    HOTELES[3602] = { nombre: "Hotel Tarde 64", moneda: "COP", pvp: 300_000, neto: 210_000, ida: "2030-03-02", regreso: "2030-03-04" };
    const a = await crearCmp([COMUN()]);
    assert.equal(a.ok, false);
    assert.match(err(a), /Hotel Tarde 64|fecha|estadía|entrada/i);
    HOTELES[3602] = { nombre: "Hotel Otro Destino 64", moneda: "COP", pvp: 300_000, neto: 210_000, destino: "SANTA MARTA" };
    assert.equal((await crearCmp([COMUN()])).ok, false);
    assert.equal(totalCot(), antes, "no quedó ninguna madre a medias");
  });

  for (const opcion of ["A", "B"]) {
    test(`C5 elegir la opción ${opcion}: la hija lleva SOLO ese hotel y el vuelo común congelado; reintento idempotente; conversión exige costo y proveedor del vuelo`, async () => {
      const r = await crearCmp([COMUN()]);
      assert.equal(r.ok, true, err(r));
      if (!r.ok) return;
      const m = madre(r.id);
      const op = opciones(r.id).find((o) => o.op === opcion)!;
      const hotelElegido = op.plantilla.payload.items[0].hotelNombre;
      const sin = sinSillas();
      const clave = crypto.randomUUID();
      uidSesion = UID_ADMIN; anonimo = false;
      const entrada = { token: m.token, version: m.version, opcionRef: op.op, acomodacionRef: op.ac, clave };
      // quien elige no crea ni modifica vuelos: una petición con manuales se rechaza
      const antes = totalCot();
      const intruso = await elegirOpcionComparativa({ ...entrada, clave: crypto.randomUUID(), manuales: [COMUN({ precio: 1 })] });
      assert.equal(intruso.ok, false);
      assert.match(err(intruso), /vuelos manuales/);
      assert.equal(totalCot(), antes, "nada se creó");
      const e = await elegirOpcionComparativa(entrada);
      assert.equal(e.ok, true, err(e));
      if (!e.ok) return;
      const h = JSON.parse(sql(`select json_build_object('precio', precio_venta, 'payload', payload, 'detalle', detalle, 'hotel', hotel)::text from public.cotizaciones where id = ${e.hijaId}`)) as {
        precio: number; hotel: string; payload: { manuales: Record<string, unknown>[]; items: unknown[] }; detalle: { vuelos: { direccion: string }[] } };
      assert.equal(h.payload.items.length, 1, "solo el hotel elegido");
      assert.equal(h.hotel, hotelElegido);
      assert.equal(Number(h.precio), 600_000 + VUELO.precio, "hotel + vuelo, una vez");
      assert.deepEqual(h.payload.manuales, op.plantilla.payload.manuales, "el vuelo común quedó congelado tal cual en la opción");
      assert.deepEqual(h.detalle.vuelos.map((t) => t.direccion), ["ida", "regreso"]);
      // reintento con la MISMA clave: la misma hija, sin duplicar
      const total1 = totalCot();
      const otra = await elegirOpcionComparativa(entrada);
      assert.equal(otra.ok && otra.hijaId, e.hijaId, "reintento idempotente");
      assert.equal(totalCot(), total1);
      // y el vuelo manual congelado no admite PATCH (migración 249) ni siquiera en la hija
      const parche = await clienteSesion().from("cotizaciones").update({ payload: { ...h.payload, manuales: [] } } as never).eq("id", e.hijaId);
      assert.match(parche.error?.message ?? "NO SE RECHAZÓ", /MANUALES_INMUTABLES/);
      // conversión: sin costo ni proveedor del vuelo no se numera; con ellos, sí
      const prev = foto();
      const sinCosto = await convertirM(e.hijaId, 1);
      assert.equal(sinCosto.ok, false);
      sinEscribir("hija sin costos", prev, e.hijaId);
      const conv = await convertirM(e.hijaId, 1, { costosManuales: [COSTO_VUELO] });
      assert.equal(conv.ok, true, conv.error);
      assert.deepEqual(venta(conv.numeros![0]), [600_000 + VUELO.precio, 420_000, 1_500_000, 0, "COP"]);
      assert.equal(sql(`select count(*) from public.contrato_vuelos where numero_contrato = ${lit(conv.numeros![0])} and record is null`), "2");
      assert.deepEqual(sinSillas(), sin, "ni la comparativa, ni la elección, ni la conversión tocan sillas ni bloqueos");
    });
  }

  test("C6 el visitante NO puede crear ni modificar vuelos al elegir; una comparativa hecha por personal interno no se elige por el canal público (regla vigente de la 211); lo manipulado en la opción guardada no llega a la hija", async () => {
    const r = await crearCmp([COMUN()]);
    assert.equal(r.ok, true, err(r));
    if (!r.ok) return;
    const m = madre(r.id);
    const op = opciones(r.id)[0];
    const base = { token: m.token, version: m.version, opcionRef: op.op, acomodacionRef: op.ac };
    const visitante = { nombres: "Visitante", apellidos: "Uno", numeroDoc: "999", telefono: "3001234567", email: "v@x.test" };
    const antes = totalCot();
    anonimo = true; uidSesion = UID_ADMIN;
    try {
      const conManuales = await elegirOpcionComparativa({ ...base, clave: crypto.randomUUID(), cliente: visitante, manuales: [COMUN({ precio: 1 })] });
      assert.equal(conManuales.ok, false);
      assert.match(err(conManuales), /vuelos manuales/);
      const sinManuales = await elegirOpcionComparativa({ ...base, clave: crypto.randomUUID(), cliente: visitante });
      assert.equal(sinManuales.ok, false, "la comparativa fue creada por personal interno: el canal público no la elige");
    } finally { anonimo = false; }
    assert.equal(totalCot(), antes, "el visitante no creó ninguna hija");
    // Opción guardada alterada (precio del vuelo): no coincide con su propio documento; no se emite recibo ni se crea la hija. Restaurada, se elige.
    uidSesion = UID_ADMIN;
    sql(`set session_replication_role = replica; update public.cotizacion_opciones set plantilla_hija = jsonb_set(plantilla_hija, '{payload,manuales,0,precio}', '1') where cotizacion_id = ${r.id} and opcion_ref = ${lit(op.op)} and acomodacion_ref = ${lit(op.ac)}`);
    const alt = await elegirOpcionComparativa({ ...base, clave: crypto.randomUUID() });
    assert.equal(alt.ok, false);
    assert.equal(totalCot(), antes, "no se creó ninguna hija");
    sql(`set session_replication_role = replica; update public.cotizacion_opciones set plantilla_hija = jsonb_set(plantilla_hija, '{payload,manuales,0,precio}', '${VUELO.precio}') where cotizacion_id = ${r.id} and opcion_ref = ${lit(op.op)} and acomodacion_ref = ${lit(op.ac)}`);
    const bien = await elegirOpcionComparativa({ ...base, clave: crypto.randomUUID() });
    assert.equal(bien.ok, true, err(bien));
    if (bien.ok) assert.equal(Number(sql(`select precio_venta from public.cotizaciones where id = ${bien.hijaId}`)), 600_000 + VUELO.precio);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Ronda 4: comparativa del carrito MARCADA por el interno para compartir. El visitante elige con el enlace; el vuelo manual común queda congelado.
describe("64 · comparativa compartida con el cliente: recorrido completo con vuelo manual", () => {
  const items2 = () => [{ ...itemPayload(3601), itemId: "h1" }, { ...itemPayload(3602), itemId: "h2" }];
  const COMUN = (o: Record<string, unknown> = {}) => ({ ...VUELO, hotelRef: "comun", ...o });
  const crearCmp = async (manuales: unknown[] | undefined, o: { anonimo?: boolean; uid?: string; compartir?: unknown } = {}) => {
    anonimo = o.anonimo ?? false; uidSesion = o.uid ?? UID_ADMIN;
    try {
      return await crearComparativaCarrito({
        items: items2(), tours: [], ...(manuales ? { manuales } : {}), ...(o.compartir !== undefined ? { compartirPublico: o.compartir } : {}),
        cliente: { ...CLIENTE, tipoDoc: "CC" },
      });
    } finally { anonimo = false; uidSesion = UID_ADMIN; }
  };
  const err = (r: { ok: boolean }) => ("error" in r ? String((r as { error: unknown }).error) : "");
  const totalCot = () => Number(sql("select count(*) from public.cotizaciones"));
  const hijasDe = (madreId: number) => Number(sql(`select count(*) from public.cotizaciones where cotizacion_origen_id = ${madreId} and estado <> 'descartada'`));
  type Opcion = { op: string; ac: string; total: number; plantilla: { payload: { manuales?: Record<string, unknown>[]; items: { hotelNombre: string }[] } } };
  const opciones = (id: number) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('op', opcion_ref, 'ac', acomodacion_ref, 'total', total, 'plantilla', plantilla_hija) order by orden), '[]'::json)::text from public.cotizacion_opciones where cotizacion_id = ${id}`)) as Opcion[];
  const madre = (id: number) => JSON.parse(sql(`select json_build_object('token', share_token, 'version', version)::text from public.cotizaciones where id = ${id}`)) as { token: string; version: number };
  const sinSillas = () => ({ sillas: sql("select count(*) from public.sillas"), bloqueos: sql("select count(*) from public.bloqueos_vuelo") });
  const VISITANTE = { nombres: "Visitante", apellidos: "Uno", numeroDoc: "999", telefono: "3001234567", email: "v@x.test" };
  const comoVisitante = async <T,>(f: () => Promise<T>): Promise<T> => { anonimo = true; uidSesion = UID_ADMIN; try { return await f(); } finally { anonimo = false; } };
  const elegirV = (m: { token: string; version: number }, o: Opcion, extra: Record<string, unknown> = {}) =>
    comoVisitante(() => elegirOpcionComparativa({ token: m.token, version: m.version, opcionRef: o.op, acomodacionRef: o.ac, clave: crypto.randomUUID(), cliente: VISITANTE, ...extra }));
  const compartida = async () => {
    const r = await crearCmp([COMUN()], { compartir: true });
    assert.equal(r.ok, true, err(r));
    if (!r.ok) throw new Error("no se creó");
    return { id: r.id, m: madre(r.id), ops: opciones(r.id) };
  };

  test("P1 la marca solo la pone el personal interno: visitante, aliado o un valor que no es booleano se RECHAZAN (no se ignoran)", async () => {
    const antes = totalCot();
    for (const [que, o] of [["visitante", { anonimo: true, compartir: true }], ["aliado B2B", { uid: UID_AGENCIA, compartir: true }], ["texto 'true'", { compartir: "true" }], ["número 1", { compartir: 1 }]] as const) {
      const r = await crearCmp(undefined, o);
      assert.equal(r.ok, false, que);
    }
    assert.equal(totalCot(), antes, "no se creó ninguna comparativa");
  });

  test("P2 la base: solo la anónima y la del carrito marcada por un interno ACTIVO son elegibles por el canal público", async () => {
    const compartidaOk = await compartida();
    const noMarcada = await crearCmp([COMUN()]);
    assert.equal(noMarcada.ok, true, err(noMarcada));
    const anonima = await crearCmp(undefined, { anonimo: true });
    assert.equal(anonima.ok, true, err(anonima));
    const elegible = (id: number) => sql(`select f211_priv.madre_anonima(c) from public.cotizaciones c where c.id = ${id}`);
    assert.equal(elegible(compartidaOk.id), "t", "marcada por un interno");
    if (noMarcada.ok) assert.equal(elegible(noMarcada.id), "f", "interna SIN marcar: sigue cerrada");
    if (anonima.ok) assert.equal(elegible(anonima.id), "t", "anónima: sigue igual");
    sql(`update public.usuarios set activo = false where id = '${UID_ADMIN}'`);
    try { assert.equal(elegible(compartidaOk.id), "f", "si el creador ya no es un interno activo, deja de ser elegible"); }
    finally { sql(`update public.usuarios set activo = true where id = '${UID_ADMIN}'`); }
    const agencia = await crearCmp(undefined, { uid: UID_AGENCIA });
    if (agencia.ok) assert.equal(elegible(agencia.id), "f", "la de un aliado B2B nunca");
  });

  test("P3 token inválido, vencida y comparativa interna no compartida: el visitante no elige ni crea nada", async () => {
    const c = await compartida();
    const o = c.ops[0];
    const antes = totalCot();
    for (const token of ["", "abc", "../../x", "no-es-un-token"]) {
      const r = await comoVisitante(() => elegirOpcionComparativa({ token, version: c.m.version, opcionRef: o.op, acomodacionRef: o.ac, clave: crypto.randomUUID(), cliente: VISITANTE }));
      assert.equal(r.ok, false, `token «${token}»`);
    }
    const desconocido = await comoVisitante(() => elegirOpcionComparativa({ token: crypto.randomUUID(), version: 1, opcionRef: o.op, acomodacionRef: o.ac, clave: crypto.randomUUID(), cliente: VISITANTE }));
    assert.equal(desconocido.ok, false);
    const sin = await comoVisitante(() => resumenOpcionComparativa(crypto.randomUUID(), o.op, o.ac));
    assert.equal(sin.ok, false);
    // versión equivocada
    assert.equal((await elegirV({ token: c.m.token, version: c.m.version + 7 }, o)).ok, false);
    // vencida
    sql(`set session_replication_role = replica; update public.cotizaciones set vigencia_hasta = '2000-01-01' where id = ${c.id}`);
    const venc = await elegirV(c.m, o);
    assert.equal(venc.ok, false);
    const resumenVenc = await comoVisitante(() => resumenOpcionComparativa(c.m.token, o.op, o.ac));
    assert.ok(resumenVenc.ok && resumenVenc.datos.vencida, "el resumen indica que venció");
    assert.equal(hijasDe(c.id), 0);
    // interna NO compartida
    const nc = await crearCmp([COMUN()]);
    assert.equal(nc.ok, true, err(nc));
    if (nc.ok) {
      const m2 = madre(nc.id), o2 = opciones(nc.id)[0];
      const r = await elegirV(m2, o2);
      assert.equal(r.ok, false);
      assert.match(err(r), /asesor/);
      // y la puerta de la BASE (sin pasar por la app): el recibo público tampoco se emite
      const { error } = await clienteLocal(TOKEN_SERVICIO).rpc("registrar_validacion_comparativa", {
        p_madre_id: nc.id, p_opcion_ref: o2.op, p_acomodacion_ref: o2.ac, p_version: m2.version, p_canal: "publico", p_actor_id: null,
        p_precio_reliquidado: o2.total, p_moneda: "COP", p_disponibilidad_ok: true, p_datos_cliente: VISITANTE,
      } as never);
      assert.match(error?.message ?? "SE EMITIÓ EL RECIBO", /COMPARATIVA_NO_AUTORIZADO/);
      assert.equal(hijasDe(nc.id), 0);
    }
    assert.equal(totalCot() - antes, 1, "solo la comparativa no compartida creada por la prueba");
  });

  test("P4 marcarla DESPUÉS (editando el payload) no la abre: el sello de la madre la deja inelegible; y quitar la marca tras emitir el recibo también cierra la puerta", async () => {
    const nc = await crearCmp([COMUN()]);
    assert.equal(nc.ok, true, err(nc));
    if (!nc.ok) return;
    const m2 = madre(nc.id), o2 = opciones(nc.id)[0];
    sql(`set session_replication_role = replica; update public.cotizaciones set payload = jsonb_set(payload, '{compartirPublico}', 'true') where id = ${nc.id}`);
    const r = await elegirV(m2, o2);
    assert.equal(r.ok, false);
    assert.equal(hijasDe(nc.id), 0, "no se creó ninguna hija");
    // recibo emitido mientras estaba legítimamente compartida; luego la marca desaparece → la elección pública del recibo se rechaza
    const c = await compartida();
    const o = c.ops[0];
    const { data: recibo, error: e1 } = await clienteLocal(TOKEN_SERVICIO).rpc("registrar_validacion_comparativa", {
      p_madre_id: c.id, p_opcion_ref: o.op, p_acomodacion_ref: o.ac, p_version: c.m.version, p_canal: "publico", p_actor_id: null,
      p_precio_reliquidado: o.total, p_moneda: "COP", p_disponibilidad_ok: true, p_datos_cliente: VISITANTE,
    } as never);
    assert.equal(e1, null, e1?.message);
    sql(`set session_replication_role = replica; update public.cotizaciones set payload = payload - 'compartirPublico' where id = ${c.id}`);
    const { error: e2 } = await clienteLocal(TOKEN_SERVICIO).rpc("elegir_opcion_comparativa_publica", { p_validacion: recibo, p_clave: crypto.randomUUID() } as never);
    assert.match(e2?.message ?? "SE ELIGIÓ", /COMPARATIVA_NO_AUTORIZADO/);
    assert.equal(hijasDe(c.id), 0);
  });

  test("P5 recorrido: interno crea → visitante ve y elige → la hija conserva el vuelo → reintento idempotente → el interno convierte (CxP, vuelos, sin sillas)", async () => {
    const c = await compartida();
    const op = c.ops.find((o) => o.op === "B")!;
    const sin = sinSillas();
    // ver la opción: ruta, tramo, fecha y pasajeros; nunca precio, costo, proveedor ni comisión
    const res = await comoVisitante(() => resumenOpcionComparativa(c.m.token, op.op, op.ac));
    assert.ok(res.ok, res.ok ? "" : res.error);
    if (res.ok) {
      assert.deepEqual(res.datos.vuelos.map((v) => v.tramo), ["ida", "regreso"]);
      assert.doesNotMatch(JSON.stringify(res.datos.vuelos), /precio|costo|proveedor|comision|impuesto|record/i);
      assert.equal(res.datos.total, 600_000 + VUELO.precio, "el total de la opción ya incluye el vuelo, una vez");
    }
    // el visitante jamás crea, modifica ni quita el vuelo congelado
    const antes = totalCot();
    for (const manuales of [[COMUN({ precio: 1 })], [], [COMUN(), COMUN()]]) {
      const r = await elegirV(c.m, op, { manuales });
      assert.equal(r.ok, false);
      assert.match(err(r), /vuelos manuales/);
    }
    assert.equal(totalCot(), antes);
    // elige
    const clave = crypto.randomUUID();
    const e = await comoVisitante(() => elegirOpcionComparativa({ token: c.m.token, version: c.m.version, opcionRef: op.op, acomodacionRef: op.ac, clave, cliente: VISITANTE }));
    assert.equal(e.ok, true, err(e));
    if (!e.ok) return;
    const h = JSON.parse(sql(`select json_build_object('precio', precio_venta, 'payload', payload, 'detalle', detalle, 'hotel', hotel, 'vigencia', vigencia_hasta)::text from public.cotizaciones where id = ${e.hijaId}`)) as {
      precio: number; hotel: string; vigencia: string; payload: { manuales: Record<string, unknown>[]; items: unknown[]; cliente: Record<string, unknown> }; detalle: { vuelos: Record<string, unknown>[]; items: unknown[] } };
    assert.equal(h.payload.items.length, 1, "solo el hotel elegido");
    assert.equal(h.hotel, op.plantilla.payload.items[0].hotelNombre);
    assert.equal(Number(h.precio), 600_000 + VUELO.precio);
    assert.deepEqual(h.payload.manuales, op.plantilla.payload.manuales, "el vuelo común quedó congelado: idéntico al de la opción");
    assert.deepEqual(h.detalle.vuelos.map((t) => t.direccion), ["ida", "regreso"]);
    assert.equal(h.payload.cliente.numeroDoc, VISITANTE.numeroDoc, "los datos del visitante entran en la hija");
    // reintentos: misma clave → misma hija; otra clave sobre la misma madre → no crea una segunda
    const total1 = totalCot();
    const otra = await comoVisitante(() => elegirOpcionComparativa({ token: c.m.token, version: c.m.version, opcionRef: op.op, acomodacionRef: op.ac, clave, cliente: VISITANTE }));
    assert.equal(otra.ok && otra.hijaId, e.hijaId, "reintento idempotente");
    const nueva = await elegirV(c.m, op);
    assert.equal(nueva.ok, false, "con otra clave no se crea una segunda hija");
    assert.equal(totalCot(), total1);
    assert.equal(hijasDe(c.id), 1);
    // el interno convierte: exige costo y proveedor del vuelo
    const prev = foto();
    const sinCosto = await convertirM(e.hijaId, 1);
    assert.equal(sinCosto.ok, false);
    sinEscribir("hija sin costos", prev, e.hijaId);
    const conv = await convertirM(e.hijaId, 1, { costosManuales: [COSTO_VUELO] });
    assert.equal(conv.ok, true, conv.error);
    const n = conv.numeros![0];
    assert.deepEqual(venta(n), [600_000 + VUELO.precio, 420_000, 1_500_000, 0, "COP"]);
    assert.match(cxpTodas(n), /aereo\|Proveedor Vuelos 64\|1500000/);
    assert.equal(sql(`select count(*) from public.contrato_vuelos where numero_contrato = ${lit(n)} and record is null`), "2");
    assert.deepEqual(sinSillas(), sin, "ni la comparativa, ni la elección, ni la conversión tocan sillas ni bloqueos");
    // Datos REALES para el render del documento (los lee pruebas/vueloManualRecorrido64.react.ts cuando PG64_EXPORT está definido).
    if (process.env.PG64_EXPORT) {
      const contrato = JSON.parse(sql(`select json_build_object(
          'venta', (select to_jsonb(v) from public.ventas v where v.numero_contrato = ${lit(n)}),
          'items', (select coalesce(json_agg(to_jsonb(i) order by i.orden, i.id), '[]'::json) from public.contrato_items i where i.numero_contrato = ${lit(n)}),
          'vuelos', (select coalesce(json_agg(to_jsonb(f) order by f.orden, f.id), '[]'::json) from public.contrato_vuelos f where f.numero_contrato = ${lit(n)}),
          'hoteles', (select coalesce(json_agg(to_jsonb(t) order by t.id), '[]'::json) from public.contrato_hoteles t where t.numero_contrato = ${lit(n)}))::text`));
      const comparativa = JSON.parse(sql(`select json_build_object(
          'madre', (select json_build_object('codigo', codigo, 'version', version, 'token', share_token) from public.cotizaciones where id = ${c.id}),
          'opciones', (select coalesce(json_agg(json_build_object('opcion_ref', opcion_ref, 'acomodacion_ref', acomodacion_ref, 'orden', orden, 'etiqueta', etiqueta, 'moneda', moneda,
                         'tarifa_persona', tarifa_persona, 'total', total, 'resumen_publico', resumen_publico) order by orden), '[]'::json) from public.cotizacion_opciones where cotizacion_id = ${c.id}))::text`));
      fs.writeFileSync(process.env.PG64_EXPORT, JSON.stringify({ hija: { detalle: h.detalle, precio: Number(h.precio), vuelo: VUELO.precio, hotelNeto: 600_000 }, contrato, comparativa }, null, 1));
    }
  });

  test("P7 si el creador interno deja de estar activo (o pierde su rol interno), el enlace pasa al camino de solicitud y la acción se rechaza; la anónima no cambia", async () => {
    const c = await compartida();
    const o = c.ops[0];
    const filaMadre = (id: number) => JSON.parse(sql(`select json_build_object('tipo', tipo, 'tenant', tenant, 'creado_por_id', creado_por_id, 'propietario_id', propietario_id, 'aliado_id', aliado_id, 'payload', payload)::text from public.cotizaciones where id = ${id}`)) as Parameters<typeof visitantePuedeContinuar>[1];
    const admin = clienteLocal(TOKEN_SERVICIO);
    // La pantalla decide con la MISMA función que usa la acción; y la base (f211_priv.madre_anonima) tiene que coincidir en cada paso.
    const base = (id: number) => sql(`select f211_priv.madre_anonima(c) from public.cotizaciones c where c.id = ${id}`) === "t";
    assert.equal(await visitantePuedeContinuar(admin, filaMadre(c.id)), true, "activo: «Continuar con esta opción»");
    assert.equal(base(c.id), true);
    const estados: Record<string, boolean> = { activo: true };
    for (const [que, mal, bien] of [
      ["creador desactivado", `update public.usuarios set activo = false where id = '${UID_ADMIN}'`, `update public.usuarios set activo = true where id = '${UID_ADMIN}'`],
      ["creador con rol de aliado", `update public.usuarios set rol = 'agencia' where id = '${UID_ADMIN}'`, `update public.usuarios set rol = 'administracion' where id = '${UID_ADMIN}'`],
    ] as const) {
      sql(mal);
      try {
        const pantalla = await visitantePuedeContinuar(admin, filaMadre(c.id));
        assert.equal(pantalla, false, `${que}: la pantalla ofrece la solicitud al asesor`);
        assert.equal(base(c.id), pantalla, `${que}: pantalla y base coinciden`);
        estados[que] = pantalla;
        const antes = totalCot();
        const r = await elegirV(c.m, o);
        assert.equal(r.ok, false, `${que}: la acción se rechaza`);
        assert.match(err(r), /asesor/);
        // y la puerta de la BASE por sí sola (sin la comprobación de la app) también cierra
        const { error } = await clienteLocal(TOKEN_SERVICIO).rpc("registrar_validacion_comparativa", {
          p_madre_id: c.id, p_opcion_ref: o.op, p_acomodacion_ref: o.ac, p_version: c.m.version, p_canal: "publico", p_actor_id: null,
          p_precio_reliquidado: o.total, p_moneda: "COP", p_disponibilidad_ok: true, p_datos_cliente: VISITANTE,
        } as never);
        assert.match(error?.message ?? "SE EMITIÓ EL RECIBO", /COMPARATIVA_NO_AUTORIZADO/);
        assert.equal(totalCot(), antes);
        assert.equal(hijasDe(c.id), 0);
      } finally { sql(bien); }
    }
    assert.equal(await visitantePuedeContinuar(admin, filaMadre(c.id)), true, "reactivado: vuelve el camino de continuar");
    // la anónima conserva la elección sin consultar al creador
    const anonima = await crearCmp(undefined, { anonimo: true });
    assert.equal(anonima.ok, true, err(anonima));
    if (anonima.ok) {
      assert.equal(await visitantePuedeContinuar(admin, filaMadre(anonima.id)), true);
      assert.equal(base(anonima.id), true);
    }
    if (process.env.PG64_EXPORT) {
      const j = JSON.parse(fs.readFileSync(process.env.PG64_EXPORT, "utf8")) as { comparativa: Record<string, unknown> };
      j.comparativa.puedeContinuar = { activo: estados.activo, creadorDesactivado: estados["creador desactivado"], creadorSinRolInterno: estados["creador con rol de aliado"] };
      fs.writeFileSync(process.env.PG64_EXPORT, JSON.stringify(j, null, 1));
    }
  });

  test("P6 dos visitantes eligen opciones COMPETIDORAS a la vez: exactamente una hija, la otra se rechaza", async () => {
    const c = await compartida();
    const [a, b] = [c.ops.find((o) => o.op === "A")!, c.ops.find((o) => o.op === "B")!];
    anonimo = true; uidSesion = UID_ADMIN;
    let rs: Awaited<ReturnType<typeof elegirOpcionComparativa>>[];
    try {
      rs = await Promise.all([a, b].map((o) => elegirOpcionComparativa({ token: c.m.token, version: c.m.version, opcionRef: o.op, acomodacionRef: o.ac, clave: crypto.randomUUID(), cliente: VISITANTE })));
    } finally { anonimo = false; }
    assert.equal(rs.filter((r) => r.ok).length, 1, rs.map((r) => (r.ok ? "ok" : err(r))).join(" | "));
    assert.equal(hijasDe(c.id), 1);
    const hija = JSON.parse(sql(`select payload::text from public.cotizaciones where cotizacion_origen_id = ${c.id} and estado <> 'descartada'`)) as { manuales: unknown[] };
    assert.equal(hija.manuales.length, 1, "la ganadora lleva el vuelo, una vez");
  });
});

// ═════════════════════════════════════════════════════════════════════
// Ronda 5: una comparativa de 2 o 3 hoteles se cotiza ALTERNATIVA POR ALTERNATIVA. Grupos = destino IATA + fechas; un vuelo o servicio afecta solo a su grupo.
describe("64 · comparativa por grupos (destino IATA + fechas): cada alternativa por separado, sin sumar competidores", () => {
  const it = (hotelId: number, itemId: string, destino = "CARTAGENA", fechas?: [string, string]) => ({ ...itemPayload(hotelId, destino), itemId, ...(fechas ? { fechaIda: fechas[0], fechaRegreso: fechas[1] } : {}) });
  const SMR_FECHAS: [string, string] = ["2030-03-10", "2030-03-14"];
  const clave = (iata: string, ida: string, reg: string) => `grupo:${iata}|${ida}|${reg}`;
  const CTG_0301 = clave("CTG", "2030-03-01", "2030-03-04");
  const vCTG = (o: Record<string, unknown> = {}) => ({ ...VUELO, hotelRef: CTG_0301, ...o });
  const vSMR = (o: Record<string, unknown> = {}) => ({ ...VUELO, nombre: "Vuelo a Santa Marta", destino: "SMR", fechaIda: "2030-03-10", fechaRegreso: "2030-03-14", precio: 1_000_000, impuestoNoComisionable: 0, hotelRef: clave("SMR", "2030-03-10", "2030-03-14"), ...o });
  const hotelTres = () => { HOTELES[3603] = { nombre: "Hotel Tres 64", moneda: "COP", pvp: 300_000, neto: 210_000 }; };
  const smr = () => { HOTELES[3602] = { nombre: "Hotel Santa Marta 64", moneda: "COP", pvp: 300_000, neto: 210_000, destino: "SANTA MARTA", ida: "2030-03-10", regreso: "2030-03-14" }; };
  const crearCmp = async (items: unknown[], manuales: unknown[] | undefined, extra: { tours?: unknown[]; compartir?: boolean } = {}) => {
    anonimo = false; uidSesion = UID_ADMIN;
    return crearComparativaCarrito({
      items, tours: extra.tours ?? [], ...(manuales ? { manuales } : {}), ...(extra.compartir ? { compartirPublico: true } : {}), cliente: { ...CLIENTE, tipoDoc: "CC" },
    });
  };
  const err = (r: { ok: boolean }) => ("error" in r ? String((r as { error: unknown }).error) : "");
  const totalCot = () => Number(sql("select count(*) from public.cotizaciones"));
  type Op = { op: string; ac: string; total: number; plantilla: { payload: { manuales?: { nombre: string; destino: string; origen: string; tramo: string }[]; items: { hotelNombre: string }[]; tours?: { nombre: string }[] } } };
  const opciones = (id: number) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('op', opcion_ref, 'ac', acomodacion_ref, 'total', total, 'plantilla', plantilla_hija) order by orden), '[]'::json)::text from public.cotizacion_opciones where cotizacion_id = ${id}`)) as Op[];
  const madre = (id: number) => JSON.parse(sql(`select json_build_object('token', share_token, 'version', version, 'precio', precio_venta, 'destino', destino, 'salida', fecha_salida, 'regreso', fecha_regreso)::text from public.cotizaciones where id = ${id}`)) as { token: string; version: number; precio: number | null; destino: string; salida: string; regreso: string };
  const VISITANTE = { nombres: "Visitante", apellidos: "Uno", numeroDoc: "999", telefono: "3001234567", email: "v@x.test" };
  const sinSillas = () => ({ sillas: sql("select count(*) from public.sillas"), bloqueos: sql("select count(*) from public.bloqueos_vuelo") });

  test("G1 tres hoteles dobles del mismo destino y fechas con un vuelo de 2 pasajeros: cada opción vale hotel + vuelo (2.400.000), nunca la suma de las tres (6.600.000)", async () => {
    hotelTres();
    const sin = sinSillas();
    const r = await crearCmp([it(3601, "a"), it(3602, "b"), it(3603, "c")], [vCTG()]);
    assert.equal(r.ok, true, err(r));
    if (!r.ok) return;
    const ops = opciones(r.id);
    assert.deepEqual([...new Set(ops.map((o) => o.op))].sort(), ["A", "B", "C"]);
    for (const o of ops) {
      assert.equal(Number(o.total), 600_000 + VUELO.precio, `opción ${o.op}/${o.ac}: su hotel + el vuelo, una vez`);
      assert.equal(o.plantilla.payload.manuales!.length, 1, "el vuelo entra una sola vez dentro de la opción");
      assert.equal(o.plantilla.payload.items.length, 1, "una opción = un hotel");
    }
    assert.equal(madre(r.id).precio, null, "la comparativa no tiene un total global");
    assert.deepEqual(sinSillas(), sin);
    const antes = totalCot();
    for (const pax of [3, 6]) assert.equal((await crearCmp([it(3601, "a"), it(3602, "b"), it(3603, "c")], [vCTG({ pax })])).ok, false, `pax ${pax}: las alternativas no se suman (2+2+2)`);
    assert.equal(totalCot(), antes);
  });

  test("G2 dos destinos con vuelos diferentes: cada opción lleva SOLO el vuelo de su grupo, una sola acomodación por opción, y los totales no se mezclan", async () => {
    smr();
    const r = await crearCmp([it(3601, "a"), it(3602, "s", "SANTA MARTA", SMR_FECHAS)], [vCTG(), vSMR()]);
    assert.equal(r.ok, true, err(r));
    if (!r.ok) return;
    const ops = opciones(r.id);
    assert.equal(ops.length, 2, "multidestino con vuelos: una sola acomodación por opción");
    const a = ops.find((o) => o.op === "A")!, b = ops.find((o) => o.op === "B")!;
    assert.equal(Number(a.total), 600_000 + 1_800_000);
    assert.equal(Number(b.total), 600_000 + 1_000_000);
    assert.deepEqual(a.plantilla.payload.manuales!.map((m) => m.destino), ["CTG"]);
    assert.deepEqual(b.plantilla.payload.manuales!.map((m) => m.destino), ["SMR"]);
    const m = madre(r.id);
    assert.equal(m.precio, null);
    assert.match(m.destino, /CARTAGENA/);
    assert.match(m.destino, /SANTA MARTA/);
    assert.equal(m.salida, "2030-03-01");
    assert.equal(m.regreso, "2030-03-14");
  });

  test("G2b multidestino: 'comun' no vale, un grupo inexistente se rechaza, y un hotel con habitaciones de más de un tipo se rechaza ANTES de crear con un mensaje claro", async () => {
    smr();
    const antes = totalCot();
    const comun = await crearCmp([it(3601, "a"), it(3602, "s", "SANTA MARTA")], [{ ...VUELO, hotelRef: "comun" }]);
    assert.equal(comun.ok, false);
    assert.match(err(comun), /varios destinos o fechas/);
    const fantasma = await crearCmp([it(3601, "a"), it(3602, "s", "SANTA MARTA")], [vCTG({ hotelRef: clave("MDE", "2030-03-01", "2030-03-04") })]);
    assert.equal(fantasma.ok, false);
    const mixto = await crearCmp([{ ...it(3601, "a"), habitaciones: { doble: 1, sencilla: 1 } }, it(3602, "s", "SANTA MARTA")], [vCTG(), vSMR()]);
    assert.equal(mixto.ok, false);
    assert.match(err(mixto), /misma acomodación.*Hotel Uno 64/);
    const sinGrupo = await crearCmp([it(3601, "a"), it(3602, "s", "SANTA MARTA")], [vCTG({ hotelRef: "item-0" })]);
    assert.equal(sinGrupo.ok, false, "un selector que no es una clave de grupo");
    assert.equal(totalCot(), antes, "no se creó ninguna comparativa");
  });

  test("G3 un destino con dos fechas: dos grupos, un vuelo por fecha; unidestino admite VARIAS acomodaciones por hotel; 'comun' no vale", async () => {
    HOTELES[3602] = { nombre: "Hotel Dos 64", moneda: "COP", pvp: 300_000, neto: 210_000, ida: "2030-03-08", regreso: "2030-03-11" };
    const B = clave("CTG", "2030-03-08", "2030-03-11");
    const antes = totalCot();
    const comun = await crearCmp([it(3601, "a"), it(3602, "b", "CARTAGENA", ["2030-03-08", "2030-03-11"])], [{ ...VUELO, hotelRef: "comun" }]);
    assert.equal(comun.ok, false);
    assert.equal(totalCot(), antes);
    const r = await crearCmp([it(3601, "a"), it(3602, "b", "CARTAGENA", ["2030-03-08", "2030-03-11"])], [vCTG(), vCTG({ nombre: "Vuelo semana 2", fechaIda: "2030-03-08", fechaRegreso: "2030-03-11", precio: 1_100_000, impuestoNoComisionable: 0, hotelRef: B })]);
    assert.equal(r.ok, true, err(r));
    if (!r.ok) return;
    const ops = opciones(r.id);
    assert.ok(ops.length > 2, "unidestino: varias acomodaciones por hotel");
    for (const o of ops) {
      const esperado = o.op === "A" ? 600_000 + 1_800_000 : 600_000 + 1_100_000;
      assert.equal(Number(o.total), esperado, `${o.op}/${o.ac}`);
      assert.deepEqual(o.plantilla.payload.manuales!.map((m) => m.nombre), [o.op === "A" ? VUELO.nombre : "Vuelo semana 2"]);
    }
  });

  test("G4 servicio compartido por el grupo y servicio exclusivo de un hotel: cada opción suma los suyos y el vuelo una vez", async () => {
    hotelTres();
    SERVICIOS_SIM[7001] = { nombre: "Islas del Rosario", total: 180_000 };
    SERVICIOS_SIM[7002] = { nombre: "Cena exclusiva", total: 90_000 };
    const tour = (servicioId: number, hotelItemId: string) => ({ servicioId, paqueteId: 3601, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, hotelItemId });
    const r = await crearCmp([it(3601, "a"), it(3602, "b"), it(3603, "c")], [vCTG()], { tours: [tour(7001, "a"), tour(7001, "b"), tour(7002, "c")] });
    assert.equal(r.ok, true, err(r));
    if (!r.ok) return;
    const total = (op: string) => [...new Set(opciones(r.id).filter((o) => o.op === op).map((o) => Number(o.total)))];
    assert.deepEqual(total("A"), [600_000 + 180_000 + 1_800_000]);
    assert.deepEqual(total("B"), [600_000 + 180_000 + 1_800_000]);
    assert.deepEqual(total("C"), [600_000 + 90_000 + 1_800_000]);
    const c = opciones(r.id).find((o) => o.op === "C")!;
    assert.deepEqual(c.plantilla.payload.tours!.map((t) => t.nombre), ["Cena exclusiva"]);
  });

  test("G5 máximo de hoteles en el SERVIDOR: un cuarto hotel (llamada directa) se rechaza sin crear nada", async () => {
    hotelTres();
    HOTELES[3604] = { nombre: "Hotel Cuatro 64", moneda: "COP", pvp: 300_000, neto: 210_000 };
    const antes = totalCot();
    const r = await crearCmp([it(3601, "a"), it(3602, "b"), it(3603, "c"), it(3604, "d")], [vCTG()]);
    assert.equal(r.ok, false);
    assert.match(err(r), /entre 2 y 3 hoteles/);
    assert.equal(totalCot(), antes);
  });

  test("G6 recorrido por grupo: el visitante elige la opción del grupo SMR (compartida), la hija conserva SOLO su vuelo, el reintento no duplica y el interno convierte con sus obligaciones", async () => {
    smr();
    const r = await crearCmp([it(3601, "a"), it(3602, "s", "SANTA MARTA", SMR_FECHAS)], [vCTG(), vSMR()], { compartir: true });
    assert.equal(r.ok, true, err(r));
    if (!r.ok) return;
    const m = madre(r.id), op = opciones(r.id).find((o) => o.op === "B")!;
    const sin = sinSillas();
    const entrada = { token: m.token, version: m.version, opcionRef: op.op, acomodacionRef: op.ac, clave: crypto.randomUUID(), cliente: VISITANTE };
    anonimo = true; uidSesion = UID_ADMIN;
    let e, otra;
    try { e = await elegirOpcionComparativa(entrada); otra = await elegirOpcionComparativa(entrada); } finally { anonimo = false; }
    assert.equal(e.ok, true, err(e));
    if (!e.ok) return;
    assert.equal(otra.ok && otra.hijaId, e.hijaId, "reintento idempotente");
    const h = JSON.parse(sql(`select json_build_object('precio', precio_venta, 'payload', payload)::text from public.cotizaciones where id = ${e.hijaId}`)) as { precio: number; payload: { manuales: { nombre: string; destino: string; precio: number }[]; items: unknown[] } };
    assert.equal(Number(h.precio), 600_000 + 1_000_000, "su hotel + el vuelo de SU grupo, nada del otro");
    assert.deepEqual(h.payload.manuales.map((x) => x.nombre), ["Vuelo a Santa Marta"]);
    assert.equal(h.payload.items.length, 1);
    const hijas = Number(sql(`select count(*) from public.cotizaciones where cotizacion_origen_id = ${r.id} and estado <> 'descartada'`));
    assert.equal(hijas, 1);
    const prev = foto();
    const sinCosto = await convertirM(e.hijaId, 1);
    assert.equal(sinCosto.ok, false);
    sinEscribir("hija sin costos", prev, e.hijaId);
    const conv = await convertirM(e.hijaId, 1, { costosManuales: [{ costo: 800_000, proveedor: "Prov SMR" }] });
    assert.equal(conv.ok, true, conv.error);
    const n = conv.numeros![0];
    assert.deepEqual(venta(n), [600_000 + 1_000_000, 420_000, 800_000, 0, "COP"]);
    assert.match(cxpTodas(n), /aereo\|Prov SMR\|800000/);
    assert.equal(sql(`select string_agg(origen_codigo || '>' || destino_codigo, ',' order by orden) from public.contrato_vuelos where numero_contrato = ${lit(n)}`), "BOG>SMR,SMR>BOG");
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(n)} and tipo_proveedor = 'aereo'`), "1", "una sola obligación aérea");
    assert.deepEqual(sinSillas(), sin);
    // reintento de la conversión: nada nuevo
    const despues = foto();
    const again = await convertirM(e.hijaId, 1, { costosManuales: [{ costo: 800_000, proveedor: "Prov SMR" }] });
    assert.equal(again.ok, true, again.error);
    assert.deepEqual(again.numeros, [n]);
    assert.deepEqual(foto(), despues);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Ronda 6: (1) comparativa ASISTIDA B2B con aliado y PVP/NETO liquidados POR OPCIÓN (#102); (2) misma acomodación en toda la comparativa multidestino con vuelos.
describe("64 · comparativa asistida B2B: términos por opción, elección de UNA opción y su conversión", () => {
  const AL = 6411;
  const it = (hotelId: number, itemId: string, destino = "CARTAGENA", fechas?: [string, string]) => ({ ...itemPayload(hotelId, destino), itemId, ...(fechas ? { fechaIda: fechas[0], fechaRegreso: fechas[1] } : {}) });
  const COMUN = (o: Record<string, unknown> = {}) => ({ ...VUELO, hotelRef: "grupo:CTG|2030-03-01|2030-03-04", ...o });
  const asist = (modo: "comisionable" | "neta", aliadoId = AL) => ({ canal: "b2b", aliadoId, modo });
  const VISITANTE = { nombres: "Visitante", apellidos: "Uno", numeroDoc: "999", telefono: "3001234567", email: "v@x.test" };
  const err = (r: { ok: boolean }) => ("error" in r ? String((r as { error: unknown }).error) : "");
  const totalCot = () => Number(sql("select count(*) from public.cotizaciones"));
  const hijasDe = (id: number) => Number(sql(`select count(*) from public.cotizaciones where cotizacion_origen_id = ${id} and estado <> 'descartada'`));
  type Plan = { pvp: number; impuesto: number; base: number; pct: number; comision: number; total_exigible: number; modo_compra: string; aliado_id: number; lineas: { clave: string }[] };
  type Op = { op: string; ac: string; total: number; resumen: Record<string, unknown>; plantilla: { payload: { b2bAsistido?: Plan; manuales?: unknown[] }; detalle: { b2bExterno?: { netoTotalExigible?: number } } } };
  const opciones = (id: number) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('op', opcion_ref, 'ac', acomodacion_ref, 'total', total, 'resumen', resumen_publico, 'plantilla', plantilla_hija) order by orden), '[]'::json)::text from public.cotizacion_opciones where cotizacion_id = ${id}`)) as Op[];
  const madre = (id: number) => JSON.parse(sql(`select json_build_object('token', share_token, 'version', version, 'precio', precio_venta, 'payload', payload)::text from public.cotizaciones where id = ${id}`)) as { token: string; version: number; precio: number | null; payload: Record<string, unknown> };
  const hoteles = () => {
    HOTELES[3601] = { nombre: "Hotel Uno B2B", moneda: "COP", pvp: 300_000, neto: 210_000 };
    HOTELES[3602] = { nombre: "Hotel Dos B2B", moneda: "COP", pvp: 400_000, neto: 280_000, impuesto: 100_000 };
  };
  const crear = async (modo: "comisionable" | "neta", extra: Record<string, unknown> = {}, uid = UID_ADMIN, anon = false) => {
    anonimo = anon; uidSesion = uid;
    try {
      return await crearComparativaCarrito({
        items: [it(3601, "a"), it(3602, "b")], tours: [], manuales: [COMUN()], asistencia: asist(modo), compartirPublico: true, cliente: { ...CLIENTE, tipoDoc: "CC" }, ...extra,
      });
    } finally { anonimo = false; uidSesion = UID_ADMIN; }
  };
  const elegir = async (m: { token: string; version: number }, o: Op) => {
    anonimo = true; uidSesion = UID_ADMIN;
    try { return await elegirOpcionComparativa({ token: m.token, version: m.version, opcionRef: o.op, acomodacionRef: o.ac, clave: crypto.randomUUID(), cliente: VISITANTE }); } finally { anonimo = false; }
  };
  before(() => {
    sql(`insert into public.aliados (id, nombre, tipo, pct_comision, activo) values (${AL}, 'Agencia B2B 64', 'agencia', 0.10, true) on conflict (id) do update set activo = true, pct_comision = 0.10, tipo = 'agencia', nombre = 'Agencia B2B 64'`);
  });
  const restaurarAliado = () => sql(`update public.aliados set activo = true, pct_comision = 0.10 where id = ${AL}`);

  test("B1 PVP con comisión: cada opción liquida SU PVP, impuesto no comisionable, base, % y comisión; ninguna suma de alternativas ni plan global", async () => {
    hoteles();
    const r = await crear("comisionable");
    assert.equal(r.ok, true, err(r));
    if (!r.ok) return;
    const ops = opciones(r.id);
    const A = ops.find((o) => o.op === "A")!.plantilla.payload.b2bAsistido!, B = ops.find((o) => o.op === "B")!.plantilla.payload.b2bAsistido!;
    assert.deepEqual({ pvp: A.pvp, imp: A.impuesto, base: A.base, pct: A.pct, com: A.comision, exi: A.total_exigible }, { pvp: 2_400_000, imp: 200_000, base: 2_200_000, pct: 0.1, com: 220_000, exi: 2_400_000 });
    assert.deepEqual({ pvp: B.pvp, imp: B.impuesto, base: B.base, pct: B.pct, com: B.comision, exi: B.total_exigible }, { pvp: 2_600_000, imp: 300_000, base: 2_300_000, pct: 0.1, com: 230_000, exi: 2_600_000 });
    assert.deepEqual(A.lineas.map((l) => l.clave), ["item-0", "manual-0"], "las líneas de la opción: su hotel y su vuelo, una vez");
    const m = madre(r.id);
    assert.equal(m.precio, null);
    assert.equal(m.payload.b2bAsistido, undefined, "la comparativa no guarda un plan global");
    assert.doesNotMatch(JSON.stringify(ops.map((o) => o.resumen)), /comision|comisión|pct|impuesto|base/i, "el resumen público no lleva comisión ni términos B2B");
  });

  test("B2 NETO: el resumen público de cada opción lleva solo el total EXIGIBLE (nunca el PVP original, la comisión ni la tarifa por persona derivada del PVP)", async () => {
    hoteles();
    const r = await crear("neta");
    assert.equal(r.ok, true, err(r));
    if (!r.ok) return;
    const ops = opciones(r.id);
    const A = ops.find((o) => o.op === "A")!, B = ops.find((o) => o.op === "B")!;
    assert.equal(A.plantilla.payload.b2bAsistido!.total_exigible, 2_180_000);
    assert.equal(B.plantilla.payload.b2bAsistido!.total_exigible, 2_370_000);
    assert.equal(Number(A.resumen.total_exigible), 2_180_000);
    assert.equal(Number(B.resumen.total_exigible), 2_370_000);
    for (const o of ops) {
      assert.equal(o.resumen.total_hotel, undefined);
      assert.doesNotMatch(JSON.stringify(o.resumen), /2400000|2600000|220000|230000|comisi/i);
      assert.equal(o.plantilla.detalle.b2bExterno?.netoTotalExigible, o.plantilla.payload.b2bAsistido!.total_exigible);
    }
    // lo que ve el visitante en la pantalla de continuar
    const op = B;
    const m = madre(r.id);
    anonimo = true;
    try {
      const res = await resumenOpcionComparativa(m.token, op.op, op.ac);
      assert.ok(res.ok);
      if (res.ok) {
        assert.equal(res.datos.total, 2_370_000, "total exigible, no el PVP");
        assert.equal(res.datos.tarifaPersona, null);
        assert.doesNotMatch(JSON.stringify(res), /2600000|230000|comisi/i);
      }
    } finally { anonimo = false; }
  });

  test("B3 la vista previa liquida por opción con el MISMO motor y coincide con lo que se congela", async () => {
    hoteles();
    anonimo = false; uidSesion = UID_ADMIN;
    const p = await previsualizarComparativaB2B({ items: [it(3601, "a"), it(3602, "b")], tours: [], manuales: [COMUN()], asistencia: asist("comisionable") });
    assert.equal(p.ok, true, err(p));
    if (!p.ok) return;
    const porOpcion = Object.fromEntries(p.opciones.map((o) => [o.opcionRef, o.terminos]));
    assert.equal(porOpcion.A.pvp, 2_400_000);
    assert.equal(porOpcion.A.comision, 220_000);
    assert.equal(porOpcion.B.pvp, 2_600_000);
    assert.equal(porOpcion.B.comision, 230_000);
    assert.equal(p.opciones.some((o) => "pvpGlobal" in o || "comisionGlobal" in o), false);
    const r = await crear("comisionable");
    assert.equal(r.ok, true, err(r));
    if (r.ok) for (const o of opciones(r.id)) assert.equal(o.plantilla.payload.b2bAsistido!.comision, porOpcion[o.op].comision, `opción ${o.op}`);
    // quien no es personal interno no obtiene la vista previa
    anonimo = true;
    try { assert.equal((await previsualizarComparativaB2B({ items: [it(3601, "a"), it(3602, "b")], tours: [], manuales: [COMUN()], asistencia: asist("neta") })).ok, false); } finally { anonimo = false; }
  });

  test("B4 solo personal interno asiste: visitante o aliado que manda `asistencia` se rechaza y no se crea nada", async () => {
    hoteles();
    const antes = totalCot();
    for (const [que, uid, anon] of [["visitante", UID_ADMIN, true], ["aliado B2B", UID_AGENCIA, false]] as const) {
      const r = await crear("comisionable", { compartirPublico: false }, uid, anon);
      assert.equal(r.ok, false, que);
    }
    const mal = await crear("comisionable", { asistencia: { canal: "b2b", aliadoId: 999999, modo: "comisionable" } });
    assert.equal(mal.ok, false, "aliado inexistente");
    assert.equal(totalCot(), antes);
  });

  for (const modo of ["comisionable", "neta"] as const) {
    test(`B5 ${modo}: el visitante elige UNA opción; la hija conserva solo los términos de esa opción; el reintento no duplica; la conversión usa solo esa opción`, async () => {
      hoteles();
      const r = await crear(modo);
      assert.equal(r.ok, true, err(r));
      if (!r.ok) return;
      const m = madre(r.id), ops = opciones(r.id), op = ops.find((o) => o.op === "B")!;
      const plan = op.plantilla.payload.b2bAsistido!;
      const e = await elegir(m, op);
      assert.equal(e.ok, true, err(e));
      if (!e.ok) return;
      const h = JSON.parse(sql(`select json_build_object('precio', precio_venta, 'payload', payload, 'detalle', detalle)::text from public.cotizaciones where id = ${e.hijaId}`)) as { precio: number; payload: { b2bAsistido: Plan; items: unknown[] }; detalle: { b2bExterno?: { netoTotalExigible?: number } } };
      assert.deepEqual(h.payload.b2bAsistido, plan, "la hija conserva EXACTAMENTE el plan de la opción elegida");
      assert.equal(h.payload.b2bAsistido.pvp, 2_600_000);
      assert.equal(h.payload.items.length, 1);
      assert.equal(Number(h.precio), 2_600_000, "precio de la hija = PVP de su opción");
      assert.equal(h.detalle.b2bExterno?.netoTotalExigible, modo === "neta" ? 2_370_000 : undefined, "documento externo: solo el exigible en NETO");
      // reintento: otra clave no crea otra hija
      const otra = await elegir(m, ops.find((o) => o.op === "A")!);
      assert.equal(otra.ok, false);
      assert.equal(hijasDe(r.id), 1);
      // conversión de ESA opción
      const conv = await convertirM(e.hijaId, 1, { costosManuales: [COSTO_VUELO] });
      assert.equal(conv.ok, true, conv.error);
      const n = conv.numeros![0];
      const [impuesto, comision, precio] = fila(`select impuesto, comision_b2b, precio_venta from public.ventas where numero_contrato = ${lit(n)}`).map(Number);
      assert.deepEqual({ impuesto, comision, precio }, { impuesto: 300_000, comision: 230_000, precio: modo === "neta" ? 2_370_000 : 2_600_000 }, "solo los términos de la opción B");
      assert.equal(Number(sql(`select base_comision from public.aliados_b2b where numero_contrato = ${lit(n)}`)), 2_300_000);
      const antes = foto();
      const again = await convertirM(e.hijaId, 1, { costosManuales: [COSTO_VUELO] });
      assert.deepEqual(again.numeros, [n]);
      assert.deepEqual(foto(), antes, "reintento: nada duplicado");
    });
  }

  test("B6 antes de confirmar se revalida: un cambio de precio, de impuesto, de porcentaje o del aliado RECHAZA la elección y no crea la hija", async () => {
    hoteles();
    const r = await crear("comisionable");
    assert.equal(r.ok, true, err(r));
    if (!r.ok) return;
    const m = madre(r.id), op = opciones(r.id).find((o) => o.op === "B")!;
    const casos: [string, () => void, () => void][] = [
      ["precio del hotel", () => { HOTELES[3602].pvp = 410_000; }, () => { HOTELES[3602].pvp = 400_000; }],
      ["impuesto no comisionable del hotel", () => { HOTELES[3602].impuesto = 120_000; }, () => { HOTELES[3602].impuesto = 100_000; }],
      ["porcentaje del aliado", () => { sql(`update public.aliados set pct_comision = 0.12 where id = ${AL}`); }, restaurarAliado],
      ["aliado desactivado", () => { sql(`update public.aliados set activo = false where id = ${AL}`); }, restaurarAliado],
    ];
    for (const [que, romper, arreglar] of casos) {
      romper();
      try {
        const antes = totalCot();
        const e = await elegir(m, op);
        assert.equal(e.ok, false, que);
        assert.equal(totalCot(), antes, `${que}: no se creó la hija`);
        assert.equal(hijasDe(r.id), 0);
      } finally { arreglar(); }
    }
    const bien = await elegir(m, op);
    assert.equal(bien.ok, true, err(bien));
  });
});

describe("64 · acomodación de la comparativa completa con vuelos manuales", () => {
  const it = (hotelId: number, itemId: string, destino: string, habitaciones: Record<string, number>, fechas?: [string, string]) =>
    ({ ...itemPayload(hotelId, destino), itemId, habitaciones, ...(fechas ? { fechaIda: fechas[0], fechaRegreso: fechas[1] } : {}) });
  const CTG = "grupo:CTG|2030-03-01|2030-03-04", SMR = "grupo:SMR|2030-03-10|2030-03-14";
  const vCTG = () => ({ ...VUELO, hotelRef: CTG });
  const vSMR = () => ({ ...VUELO, nombre: "Vuelo a Santa Marta", destino: "SMR", fechaIda: "2030-03-10", fechaRegreso: "2030-03-14", hotelRef: SMR });
  const smr = () => { HOTELES[3602] = { nombre: "Hotel Santa Marta 64", moneda: "COP", pvp: 300_000, neto: 210_000, destino: "SANTA MARTA", ida: "2030-03-10", regreso: "2030-03-14" }; };
  const crear = async (items: unknown[], manuales: unknown[]) => { anonimo = false; uidSesion = UID_ADMIN; return crearComparativaCarrito({ items, tours: [], manuales, cliente: { ...CLIENTE, tipoDoc: "CC" } }); };
  const err = (r: { ok: boolean }) => ("error" in r ? String((r as { error: unknown }).error) : "");
  const totalCot = () => Number(sql("select count(*) from public.cotizaciones"));
  const opsDe = (id: number) => Number(sql(`select count(*) from public.cotizacion_opciones where cotizacion_id = ${id}`));
  const SMR_F: [string, string] = ["2030-03-10", "2030-03-14"];

  test("A1 multidestino con vuelos: doble en un destino y doble en el otro SE PERMITE (una acomodación por opción)", async () => {
    smr();
    const r = await crear([it(3601, "a", "CARTAGENA", { doble: 1 }), it(3602, "s", "SANTA MARTA", { doble: 1 }, SMR_F)], [vCTG(), vSMR()]);
    assert.equal(r.ok, true, err(r));
    if (r.ok) assert.equal(opsDe(r.id), 2);
  });

  test("A2 multidestino con vuelos: doble en un destino y TRIPLE en el otro se RECHAZA aunque cada hotel tenga un solo tipo, con el mismo mensaje que la pantalla", async () => {
    smr();
    const antes = totalCot();
    const r = await crear([it(3601, "a", "CARTAGENA", { doble: 1 }), it(3602, "s", "SANTA MARTA", { triple: 1 }, SMR_F)], [vCTG(), vSMR()]);
    assert.equal(r.ok, false);
    assert.match(err(r), /misma acomodación/);
    assert.equal(err(r), mensajeAcomodacionComparativa({ tipo: "distintas", hotel: err(r).match(/«(.+?)»/)![1] }), "servidor y pantalla comparten el mensaje");
    assert.equal(totalCot(), antes);
  });

  test("A3 unidestino con varias acomodaciones se PERMITE: un destino con dos fechas, doble en un hotel y triple en el otro", async () => {
    HOTELES[3602] = { nombre: "Hotel Dos 64", moneda: "COP", pvp: 300_000, neto: 210_000, ida: "2030-03-08", regreso: "2030-03-11" };
    const B = "grupo:CTG|2030-03-08|2030-03-11";
    const r = await crear([it(3601, "a", "CARTAGENA", { doble: 1 }), it(3602, "b", "CARTAGENA", { triple: 1 }, ["2030-03-08", "2030-03-11"])], [vCTG(), { ...vCTG(), nombre: "Vuelo semana 2", fechaIda: "2030-03-08", fechaRegreso: "2030-03-11", hotelRef: B }]);
    assert.equal(r.ok, true, err(r));
    if (r.ok) assert.ok(opsDe(r.id) > 2, "varias acomodaciones por hotel");
  });

  test("A4 sin vuelos manuales la regla no aplica a la comparativa de siempre", async () => {
    HOTELES[3602] = { ...HOTELES[3602] };
    const r = await crear([it(3601, "a", "CARTAGENA", { doble: 1 }), it(3602, "b", "CARTAGENA", { triple: 1 })], []);
    assert.equal(r.ok, true, err(r));
  });
});

// ═════════════════════════════════════════════════════════════════════
// Ronda 7: identidad de la hija cuando un VISITANTE elige una opción B2B asistida. NETO: cliente comercial = ALIADO (fila y detalle.venta), titular = lo que capturó el visitante.
// PVP con comisión: el visitante sigue siendo el cliente.
describe("64 · identidad de la hija elegida por un visitante (NETO vs PVP con comisión)", () => {
  const AL = 6412, NIT_AL = "900123456", NOMBRE_AL = "Agencia Identidad 64";
  const VISITANTE = { nombres: "Visitante", apellidos: "Uno", numeroDoc: "999", telefono: "3001234567", email: "v@x.test" };
  const err = (r: { ok: boolean }) => ("error" in r ? String((r as { error: unknown }).error) : "");
  const cuantas = (id: number) => Number(sql(`select count(*) from public.cotizaciones where cotizacion_origen_id = ${id} and estado <> 'descartada'`));
  type Hija = { cliente: string; cliente_documento: string | null; payload: { cliente: Record<string, string>; b2bAsistido?: { pvp: number; total_exigible: number; modo_compra: string } }; detalle: { venta: Record<string, string | null> }; precio: number };
  const hijaDe = (id: number) => JSON.parse(sql(`select json_build_object('cliente', cliente, 'cliente_documento', cliente_documento, 'payload', payload, 'detalle', detalle, 'precio', precio_venta)::text from public.cotizaciones where id = ${id}`)) as Hija;
  // El beforeEach global reinicia HOTELES: se cargan al empezar CADA prueba.
  const hoteles = () => {
    HOTELES[3601] = { nombre: "Hotel Uno B2B", moneda: "COP", pvp: 300_000, neto: 210_000 };
    HOTELES[3602] = { nombre: "Hotel Dos B2B", moneda: "COP", pvp: 400_000, neto: 280_000, impuesto: 100_000 };
  };
  before(() => {
    sql(`insert into public.aliados (id, nombre, tipo, pct_comision, activo, nit, tipo_documento, telefono, email, direccion)
         values (${AL}, ${lit(NOMBRE_AL)}, 'agencia', 0.10, true, ${lit(NIT_AL)}, 'NIT', '6015550000', 'agencia@x.test', 'Calle 1 # 2-3')
         on conflict (id) do update set activo = true, pct_comision = 0.10, tipo = 'agencia', nombre = ${lit(NOMBRE_AL)}, nit = ${lit(NIT_AL)}, tipo_documento = 'NIT', telefono = '6015550000', email = 'agencia@x.test', direccion = 'Calle 1 # 2-3'`);
  });

  for (const modo of ["neta", "comisionable"] as const) {
    test(`I1 ${modo}: la fila de la hija, su detalle y el contrato convertido llevan la identidad correcta; importes, elección única y conversión sin duplicados intactos`, async () => {
      hoteles();
      anonimo = false; uidSesion = UID_ADMIN;
      const r = await crearComparativaCarrito({
        items: [itemPayload(3601, "CARTAGENA"), itemPayload(3602, "CARTAGENA")].map((x, i) => ({ ...x, itemId: i ? "b" : "a" })), tours: [], manuales: [{ ...VUELO, hotelRef: "grupo:CTG|2030-03-01|2030-03-04" }],
        asistencia: { canal: "b2b", aliadoId: AL, modo }, compartirPublico: true, cliente: { ...CLIENTE, tipoDoc: "CC" },
      });
      assert.equal(r.ok, true, err(r));
      if (!r.ok) return;
      const m = JSON.parse(sql(`select json_build_object('token', share_token, 'version', version)::text from public.cotizaciones where id = ${r.id}`)) as { token: string; version: number };
      anonimo = true;
      let e: Awaited<ReturnType<typeof elegirOpcionComparativa>>;
      try { e = await elegirOpcionComparativa({ token: m.token, version: m.version, opcionRef: "B", acomodacionRef: "doble", clave: crypto.randomUUID(), cliente: VISITANTE }); } finally { anonimo = false; }
      assert.equal(e.ok, true, err(e));
      if (!e.ok) return;
      const h = hijaDe(e.hijaId);
      const neto = modo === "neta";
      // identidad comercial: fila y detalle.venta
      assert.equal(h.cliente, neto ? NOMBRE_AL : "Visitante Uno", "cliente de la fila");
      assert.equal(h.cliente_documento, neto ? NIT_AL : "999", "documento de la fila");
      assert.equal(h.detalle.venta.cliente, neto ? NOMBRE_AL : "Visitante Uno", "detalle.venta.cliente");
      assert.equal(h.detalle.venta.cliente_documento, neto ? NIT_AL : "999", "detalle.venta.cliente_documento");
      if (neto) {
        assert.equal(h.detalle.venta.cliente_telefono, "6015550000", "contacto del aliado, no del visitante");
        assert.deepEqual([h.detalle.venta.titular_nombre, h.detalle.venta.titular_documento, h.detalle.venta.titular_telefono, h.detalle.venta.titular_email], ["Visitante Uno", "999", "3001234567", "v@x.test"], "titular = visitante");
      } else {
        assert.equal(h.detalle.venta.cliente_telefono, "3001234567");
        assert.equal(h.detalle.venta.titular_nombre ?? null, null, "sin titular aparte");
      }
      assert.deepEqual([h.payload.cliente.nombres, h.payload.cliente.numeroDoc], ["Visitante", "999"], "payload.cliente = lo que capturó el visitante (titular)");
      // el plan económico de la opción elegida no cambia
      assert.equal(h.payload.b2bAsistido!.pvp, 2_600_000);
      assert.equal(Number(h.precio), 2_600_000);
      // elección única
      assert.equal(cuantas(r.id), 1);
      // conversión
      const conv = await convertirM(e.hijaId, 1, { costosManuales: [COSTO_VUELO] });
      assert.equal(conv.ok, true, conv.error);
      const n = conv.numeros![0];
      const [cli, doc, tit, titDoc, titTel, precio] = fila(`select cliente, coalesce(cliente_documento,''), coalesce(titular_nombre,''), coalesce(titular_documento,''), coalesce(titular_telefono,''), precio_venta from public.ventas where numero_contrato = ${lit(n)}`);
      assert.deepEqual([cli, doc, tit, titDoc, titTel], neto ? [NOMBRE_AL, NIT_AL, "Visitante Uno", "999", "3001234567"] : ["Visitante Uno", "999", "", "", ""]);
      assert.equal(Number(precio), neto ? 2_370_000 : 2_600_000);
      const antes = foto();
      const again = await convertirM(e.hijaId, 1, { costosManuales: [COSTO_VUELO] });
      assert.deepEqual(again.numeros, [n]);
      assert.deepEqual(foto(), antes, "reintento: nada duplicado");
      // fixture del documento imprimible (lo lee pruebas/vueloManualRecorrido64.react.ts cuando PG64_EXPORT está definido)
      if (process.env.PG64_EXPORT && fs.existsSync(process.env.PG64_EXPORT)) {
        const j = JSON.parse(fs.readFileSync(process.env.PG64_EXPORT, "utf8")) as Record<string, unknown>;
        const contrato = JSON.parse(sql(`select json_build_object(
            'venta', (select to_jsonb(v) from public.ventas v where v.numero_contrato = ${lit(n)}),
            'items', (select coalesce(json_agg(to_jsonb(i) order by i.orden, i.id), '[]'::json) from public.contrato_items i where i.numero_contrato = ${lit(n)}),
            'vuelos', (select coalesce(json_agg(to_jsonb(f) order by f.orden, f.id), '[]'::json) from public.contrato_vuelos f where f.numero_contrato = ${lit(n)}),
            'hoteles', (select coalesce(json_agg(to_jsonb(t) order by t.id), '[]'::json) from public.contrato_hoteles t where t.numero_contrato = ${lit(n)}))::text`));
        j[`identidad_${modo}`] = { hija: { detalle: h.detalle, precio: Number(h.precio), exigible: h.payload.b2bAsistido!.total_exigible }, contrato };
        fs.writeFileSync(process.env.PG64_EXPORT, JSON.stringify(j, null, 1));
      }
    });
  }
});

// ═════════════════════════════════════════════════════════════════════
// Ronda 8: tipo de documento al sustituir a la persona (sin heredar el de la plantilla, sin inventar CC) y coherencia del aliado NETO con el plan congelado.
describe("64 · hija: tipo de documento y coherencia del aliado (251)", () => {
  const AL = 6413, NOMBRE_AL = "Agencia Tipos 64", NIT_AL = "900777888";
  const VISITANTE = { nombres: "Visitante", apellidos: "Dos", numeroDoc: "777", telefono: "3009998888", email: "v2@x.test" };
  const err = (r: { ok: boolean }) => ("error" in r ? String((r as { error: unknown }).error) : "");
  const cuantas = (id: number) => Number(sql(`select count(*) from public.cotizaciones where cotizacion_origen_id = ${id} and estado <> 'descartada'`));
  type Venta = Record<string, string | null | undefined>;
  const hijaDe = (id: number) => JSON.parse(sql(`select json_build_object('payload', payload, 'detalle', detalle, 'precio', precio_venta)::text from public.cotizaciones where id = ${id}`)) as { payload: { cliente: Record<string, string> }; detalle: { venta: Venta }; precio: number };
  const hoteles = () => {
    HOTELES[3601] = { nombre: "Hotel Uno B2B", moneda: "COP", pvp: 300_000, neto: 210_000 };
    HOTELES[3602] = { nombre: "Hotel Dos B2B", moneda: "COP", pvp: 400_000, neto: 280_000, impuesto: 100_000 };
  };
  before(() => {
    sql(`insert into public.aliados (id, nombre, tipo, pct_comision, activo, nit, tipo_documento, telefono, email, direccion)
         values (${AL}, ${lit(NOMBRE_AL)}, 'agencia', 0.10, true, ${lit(NIT_AL)}, 'NIT', '6015550000', 'agencia@x.test', 'Calle 1 # 2-3')
         on conflict (id) do update set activo = true, pct_comision = 0.10, tipo = 'agencia', nombre = ${lit(NOMBRE_AL)}, nit = ${lit(NIT_AL)}, tipo_documento = 'NIT'`);
  });
  async function crear(modo: "neta" | "comisionable") {
    hoteles(); anonimo = false; uidSesion = UID_ADMIN;
    const r = await crearComparativaCarrito({
      items: [itemPayload(3601, "CARTAGENA"), itemPayload(3602, "CARTAGENA")].map((x, i) => ({ ...x, itemId: i ? "b" : "a" })), tours: [], manuales: [{ ...VUELO, hotelRef: "grupo:CTG|2030-03-01|2030-03-04" }],
      asistencia: { canal: "b2b", aliadoId: AL, modo }, compartirPublico: true, cliente: { ...CLIENTE, tipoDoc: "CC" },
    });
    assert.equal(r.ok, true, err(r));
    if (!r.ok) throw new Error("no se creó");
    const m = JSON.parse(sql(`select json_build_object('token', share_token, 'version', version)::text from public.cotizaciones where id = ${r.id}`)) as { token: string; version: number };
    return { id: r.id, m };
  }
  async function elegir(m: { token: string; version: number }) {
    anonimo = true;
    try { return await elegirOpcionComparativa({ token: m.token, version: m.version, opcionRef: "B", acomodacionRef: "doble", clave: crypto.randomUUID(), cliente: VISITANTE }); } finally { anonimo = false; }
  }
  const ventaDe = (n: string) => fila(`select cliente, coalesce(cliente_documento,''), coalesce(cliente_tipo_documento,'<null>'), coalesce(titular_nombre,''), coalesce(titular_documento,''), coalesce(titular_tipo_documento,'<null>'), precio_venta from public.ventas where numero_contrato = ${lit(n)}`);

  test("T1 NETO con titular original CC y visitante con otro número SIN tipo: el titular queda sin tipo y el cliente conserva el tipo fiscal del aliado (fila, detalle, documento y contrato)", async () => {
    const { m } = await crear("neta");
    const e = await elegir(m);
    assert.equal(e.ok, true, err(e));
    if (!e.ok) return;
    const h = hijaDe(e.hijaId);
    assert.equal(h.detalle.venta.titular_documento, "777");
    assert.equal(h.detalle.venta.titular_tipo_documento, null, "el CC del titular original NO se hereda al otro número");
    assert.equal(h.detalle.venta.cliente_tipo_documento, "NIT", "tipo fiscal del aliado como cliente");
    assert.equal(h.detalle.venta.cliente_documento, NIT_AL);
    assert.equal(h.payload.cliente.tipoDoc ?? null, null, "payload.cliente no trae el tipo de la plantilla");
    assert.equal(Number(h.precio), 2_600_000);
    const conv = await convertirM(e.hijaId, 1, { costosManuales: [COSTO_VUELO] });
    assert.equal(conv.ok, true, conv.error);
    const n = conv.numeros![0];
    const [cli, doc, tipoCli, tit, titDoc, tipoTit, precio] = ventaDe(n);
    assert.deepEqual([cli, doc, tipoCli, tit, titDoc, tipoTit], [NOMBRE_AL, NIT_AL, "NIT", "Visitante Dos", "777", "<null>"]);
    assert.equal(Number(precio), 2_370_000);
    const antes = foto();
    assert.deepEqual((await convertirM(e.hijaId, 1, { costosManuales: [COSTO_VUELO] })).numeros, [n]);
    assert.deepEqual(foto(), antes, "reintento: nada duplicado");
  });

  test("T2 PVP con comisión y cliente original CC: el visitante queda con cliente_tipo_documento sin tipo (no CC, no inventado) en la hija y en el contrato", async () => {
    const { m } = await crear("comisionable");
    const e = await elegir(m);
    assert.equal(e.ok, true, err(e));
    if (!e.ok) return;
    const h = hijaDe(e.hijaId);
    assert.equal(h.detalle.venta.cliente_documento, "777");
    assert.equal(h.detalle.venta.cliente_tipo_documento, null, "el CC de la plantilla NO se hereda");
    assert.equal(h.detalle.venta.titular_nombre ?? null, null);
    const conv = await convertirM(e.hijaId, 1, { costosManuales: [COSTO_VUELO] });
    assert.equal(conv.ok, true, conv.error);
    const [cli, doc, tipoCli, tit, , , precio] = ventaDe(conv.numeros![0]);
    assert.deepEqual([cli, doc, tipoCli, tit], ["Visitante Dos", "777", "<null>", ""]);
    assert.equal(Number(precio), 2_600_000);
  });

  for (const [caso, cambio] of [
    ["nombre no vacío de OTRA persona", `jsonb_set(plantilla_hija, '{cliente}', to_jsonb('Otra Persona'::text))`],
    ["nombre correcto pero documento de otra persona", `jsonb_set(plantilla_hija, '{cliente_documento}', to_jsonb('555'::text))`],
    ["detalle.venta.cliente de otra persona", `jsonb_set(plantilla_hija, '{detalle,venta,cliente}', to_jsonb('Otra Persona'::text))`],
    ["tipo fiscal del cliente distinto del congelado", `jsonb_set(plantilla_hija, '{detalle,venta,cliente_tipo_documento}', to_jsonb('CC'::text))`],
  ] as const) {
    test(`T3 NETO con plantilla incoherente (${caso}): COMPARATIVA_INCOHERENTE antes de insertar la hija`, async () => {
      const { id, m } = await crear("neta");
      sql(`set session_replication_role = replica; update public.cotizacion_opciones set plantilla_hija = ${cambio} where cotizacion_id = ${id} and opcion_ref = 'B' and acomodacion_ref = 'doble'; update public.cotizaciones set sello_economico = f211_priv.sello_madre(id) where id = ${id}`);
      const antes = Number(sql("select count(*) from public.cotizaciones"));
      const e = await elegir(m);
      assert.equal(e.ok, false);
      assert.match(err(e), /No pudimos verificar el valor de esta opción/);
      assert.equal(cuantas(id), 0, "no se creó la hija");
      assert.equal(Number(sql("select count(*) from public.cotizaciones")), antes);
    });
  }
});
