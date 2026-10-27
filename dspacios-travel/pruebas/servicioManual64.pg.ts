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
type HotelSim = { nombre: string; moneda: string; pvp: number; neto: number; destino?: string; ida?: string; regreso?: string };
let HOTELES: Record<number, HotelSim> = {};
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async (_sb: unknown, r: { hotelId: number }) => {
      const h = HOTELES[r.hotelId];
      return {
        ok: true,
        data: {
          meta: { hotel_nombre: h.nombre, destino_nombre: h.destino ?? "CARTAGENA", fecha_ida: h.ida ?? "2030-03-01", fecha_regreso: h.regreso ?? "2030-03-04" },
          precioVenta: h.pvp * 2, monedaReserva: h.moneda, impuestoTotal: 0,
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
    liquidarServicioPuntual: async () => ({ ok: false, tipo: "no_disponible", mensaje: "no se usa" }),
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
const { crearSolicitudReserva, crearComparativaCarrito, elegirOpcionComparativa, resumenOpcionComparativa } = await import("../app/tarifario/checkout/actions.ts");
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
  HOTELES = {
    3601: { nombre: "Hotel Uno 64", moneda: "COP", pvp: 300_000, neto: 210_000 },
    3602: { nombre: "Hotel Dos 64", moneda: "COP", pvp: 300_000, neto: 210_000 },
  };
});

const VUELO = { clase: "vuelo", tramo: "ida_regreso", hotelRef: "h1", nombre: "Tiquete aéreo ida y regreso", origen: "BOG", destino: "CARTAGENA", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, precio: 1_800_000, moneda: "COP", impuestoNoComisionable: 200_000 };
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
    assert.match(itemsDe(numero), /Vuelo · Tiquete aéreo ida y regreso BOG → CARTAGENA \(ida y regreso\) · 2030-03-01 → 2030-03-04 · 2 pax\|1800000/);
    assert.doesNotMatch(itemsDe(numero), /sujeto a confirmación/);
    const cxp = cxpTodas(numero);
    assert.match(cxp, /aereo\|Proveedor Vuelos 64\|1500000\.00\|COP/);
    assert.match(cxp, /hotel\|Proveedor Hotel 236\|420000\.00\|COP/);
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(numero)}`), "2");
    const tramos = sql(`select string_agg(direccion || ':' || coalesce(origen_codigo, origen_ciudad) || '>' || coalesce(destino_codigo, destino_ciudad) || ':' || coalesce(record, 'SIN-RECORD') || ':' || fecha_salida, ' ; ' order by orden) from public.contrato_vuelos where numero_contrato = ${lit(numero)}`);
    assert.equal(tramos, "ida:BOG>CARTAGENA:SIN-RECORD:2030-03-01 ; regreso:CARTAGENA>BOG:SIN-RECORD:2030-03-04");
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
describe("64 · vuelo manual por tramos, ligado a SU hotel del carrito", () => {
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

  const TRAMOS = [
    ["ida", V({ tramo: "ida", origen: "BOG", destino: "cartagena", fechaIda: "2030-03-02", fechaRegreso: null }), ["ida"], ["2030-03-02"]],
    ["regreso", V({ tramo: "regreso", origen: "Cartagena", destino: "MDE", fechaIda: null, fechaRegreso: "2030-03-04" }), ["regreso"], ["2030-03-04"]],
    ["ida y regreso", V(), ["ida", "regreso"], ["2030-03-01", "2030-03-04"]],
  ] as const;
  for (const [nombre, manual, direcciones, fechas] of TRAMOS) {
    test(`V1 ${nombre}: el cuadro de vuelos lleva SOLO sus tramos; el lado del hotel sale del hotel; el precio entra una sola vez; sin sillas ni bloqueos`, async () => {
      const antes = sinSillas();
      const r = await crear([H1()], [manual]);
      assert.equal(r.ok, true, err(r));
      if (!r.ok) return;
      const c = cot(r.cotizacion.id);
      assert.equal(Number(c.precio), 600_000 + VUELO.precio, "total = hotel + vuelo");
      assert.equal(c.detalle.items.filter((i) => /^Vuelo ·/.test(i.descripcion)).length, 1, "una sola línea de valor para el vuelo");
      assert.deepEqual(c.detalle.vuelos.map((t) => t.direccion), [...direcciones]);
      assert.deepEqual(c.detalle.vuelos.map((t) => t.fecha_salida), [...fechas]);
      for (const t of c.detalle.vuelos) { assert.equal(t.record, null); assert.equal(t.aerolinea, null); assert.match(String(t.servicios), /pasajeros en este vuelo: 2 · sujeto a confirmación/); }
      const m = c.payload.manuales[0];
      assert.equal(m.hotelRef, "item-0", "ligado al hotel por la ref del servidor");
      assert.equal(String(m.tramo === "regreso" ? m.origen : m.destino), "CARTAGENA", "la ciudad del hotel la fija el servidor");
      assert.deepEqual(sinSillas(), antes, "cotizar un vuelo manual no toca sillas ni bloqueos");
    });
  }

  test("V2 fechas contra la estadía del hotel (01-mar → 04-mar): límites aceptados, fuera de ellos y fechas desordenadas rechazadas ANTES de cotizar", async () => {
    const ok: [string, Record<string, unknown>][] = [
      ["ida el día de la entrada", V({ tramo: "ida", fechaIda: "2030-03-01", fechaRegreso: null })],
      ["regreso el día de la salida", V({ tramo: "regreso", origen: "CARTAGENA", destino: "BOG", fechaIda: null, fechaRegreso: "2030-03-04" })],
      ["ida y regreso exactamente en la estadía", V()],
    ];
    for (const [que, m] of ok) { const r = await crear([H1()], [m]); assert.equal(r.ok, true, `${que}: ${err(r)}`); }
    const antes = ABIERTAS();
    const mal: [string, Record<string, unknown>][] = [
      ["ida un día ANTES de la entrada", V({ tramo: "ida", fechaIda: "2030-02-28", fechaRegreso: null })],
      ["ida DESPUÉS de la salida", V({ tramo: "ida", fechaIda: "2030-03-05", fechaRegreso: null })],
      ["regreso un día DESPUÉS de la salida", V({ tramo: "regreso", origen: "CARTAGENA", destino: "BOG", fechaIda: null, fechaRegreso: "2030-03-05" })],
      ["regreso ANTES de la entrada", V({ tramo: "regreso", origen: "CARTAGENA", destino: "BOG", fechaIda: null, fechaRegreso: "2030-02-28" })],
      ["ida y regreso con el regreso antes de la ida", V({ fechaIda: "2030-03-04", fechaRegreso: "2030-03-02" })],
      ["ida y regreso con la ida antes de la entrada", V({ fechaIda: "2030-02-28" })],
      ["ida con fecha de regreso", V({ tramo: "ida", fechaRegreso: "2030-03-04" })],
      ["regreso con fecha de ida", V({ tramo: "regreso", origen: "CARTAGENA", destino: "BOG", fechaIda: "2030-03-01" })],
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

  test("V4 varios destinos: el vuelo se liga al hotel ELEGIDO (nunca al primero), con su ciudad y sus fechas; sin elegir, desconocido o cruzado se rechaza", async () => {
    HOTELES[3602] = { nombre: "Hotel Santa Marta 64", moneda: "COP", pvp: 300_000, neto: 210_000, destino: "SANTA MARTA", ida: "2030-03-10", regreso: "2030-03-14" };
    const aSM = V({ hotelRef: "h2", tramo: "ida_regreso", origen: "BOG", destino: "Santa Marta", fechaIda: "2030-03-10", fechaRegreso: "2030-03-14", nombre: "Vuelo a Santa Marta" });
    const r = await crear([H1(), H2()], [aSM]);
    assert.equal(r.ok, true, err(r));
    if (!r.ok) return;
    const m = cot(r.cotizacion.id).payload.manuales[0];
    assert.deepEqual([m.hotelRef, m.destino, m.hotelEtiqueta], ["item-1", "SANTA MARTA", "Hotel Santa Marta 64"]);
    const antes = ABIERTAS();
    const mal: [string, Record<string, unknown>][] = [
      ["sin hotel (no se asigna al primero)", V({ hotelRef: "" })],
      ["hotel que no está en el carrito", V({ hotelRef: "zzz" })],
      ["fechas del primer hotel contra el segundo", { ...aSM, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04" }],
      ["ciudad del primer hotel contra el segundo", { ...aSM, destino: "CARTAGENA" }],
      ["ciudad del segundo hotel contra el primero", V({ destino: "SANTA MARTA" })],
    ];
    for (const [que, x] of mal) assert.equal((await crear([H1(), H2()], [x])).ok, false, que);
    assert.equal(ABIERTAS(), antes);
  });

  test("V5 conversión por destino: cada vuelo viaja y se cobra en el contrato de SU hotel; sillas y bloqueos intactos", async () => {
    HOTELES[3602] = { nombre: "Hotel Santa Marta V5", moneda: "COP", pvp: 300_000, neto: 210_000, destino: "SANTA MARTA", ida: "2030-03-10", regreso: "2030-03-14" };
    const aCTG = V({ nombre: "Vuelo CTG", hotelRef: "h1" });
    const aSM = V({ nombre: "Vuelo SMR", hotelRef: "h2", destino: "SANTA MARTA", fechaIda: "2030-03-10", fechaRegreso: "2030-03-14", precio: 1_000_000, impuestoNoComisionable: 0 });
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
    assert.equal(sql(`select string_agg(coalesce(destino_codigo, destino_ciudad), ',' order by orden) from public.contrato_vuelos where numero_contrato = ${lit(n2)}`), "SANTA MARTA,BOG");
    assert.deepEqual(sinSillas(), antes);
    assert.equal(sql(`select count(*) from public.sillas where numero_contrato in (${lit(n1)}, ${lit(n2)})`), "0");
  });

  test("V6 reintento parcial: si el vuelo vive en el destino PENDIENTE se siguen exigiendo costo y proveedor; solo de ese vuelo", async () => {
    HOTELES[3601].nombre = "Hotel Uno V6";
    HOTELES[3602] = { nombre: "Hotel Dos V6", moneda: "COP", pvp: 300_000, neto: 210_000, destino: "SANTA MARTA", ida: "2030-03-10", regreso: "2030-03-14" };
    const aSM = V({ nombre: "Vuelo SMR V6", hotelRef: "h2", destino: "SANTA MARTA", fechaIda: "2030-03-10", fechaRegreso: "2030-03-14" });
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
      ["ruta alterada", { items: [itemPayload(3601)], manuales: [VUELO], detalleVuelos: bueno.map((t) => ({ ...t, destino_ciudad: "Cali" })) }],
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
