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
type HotelSim = { nombre: string; moneda: string; pvp: number; neto: number };
let HOTELES: Record<number, HotelSim> = {};
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async (_sb: unknown, r: { hotelId: number }) => {
      const h = HOTELES[r.hotelId];
      return {
        ok: true,
        data: {
          meta: { hotel_nombre: h.nombre, destino_nombre: "CARTAGENA", fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04" },
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

const { descripcionCotizacionManual, validarServicioManual, lineaB2BManual } = await import("../lib/cart/servicioManual.ts");
const { construirPlanB2B } = await import("../lib/cotizacion/asistidaB2B.ts");
const { convertirCotizacionCarrito } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");

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

const VUELO = { clase: "vuelo", nombre: "Tiquete aéreo ida y regreso", origen: "BOG", destino: "CTG", fechaIda: "2030-02-28", fechaRegreso: "2030-03-04", pax: 2, precio: 1_800_000, moneda: "COP", impuestoNoComisionable: 200_000 };
const OTRO = { clase: "otro", nombre: "Traslado privado", origen: null, destino: null, fechaIda: null, fechaRegreso: null, pax: 2, precio: 90_000, moneda: "COP", impuestoNoComisionable: 0 };
const COSTO_VUELO = { costo: 1_500_000, proveedor: "Proveedor Vuelos 64" };

/** Inserta una cotización como la deja `crearSolicitudReserva`: el documento (detalle.items) lleva una línea por manual válido. `detalleItems` fuerza otro documento. */
function cotizacionM(a: { moneda?: "COP" | "USD"; items: unknown[]; manuales?: unknown[]; detalleItems?: unknown[]; payloadExtra?: Record<string, unknown> }): number {
  const payload = { items: a.items, tours: [], ...(a.manuales ? { manuales: a.manuales } : {}), cliente: CLIENTE, ...(a.payloadExtra ?? {}) };
  const lineas = a.detalleItems ?? (a.manuales ?? []).flatMap((m) => { const r = validarServicioManual(m); return r.ok ? [{ descripcion: descripcionCotizacionManual(r.valor), valor_total: r.valor.precio }] : []; });
  return Number(sql(`insert into public.cotizaciones (tipo, estado, tenant, moneda, payload, detalle, cliente, pax)
    values ('carrito', 'abierta', 'mayorista', ${lit(a.moneda ?? "COP")}, ${lit(JSON.stringify(payload))}::jsonb, ${lit(JSON.stringify({ items: lineas }))}::jsonb, 'Ana Pérez', 2) returning id`));
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
    assert.match(itemsDe(numero), /Vuelo · Tiquete aéreo ida y regreso BOG → CTG · 2030-02-28 → 2030-03-04 · 2 pax\|1800000/);
    assert.doesNotMatch(itemsDe(numero), /sujeto a confirmación/);
    const cxp = cxpTodas(numero);
    assert.match(cxp, /aereo\|Proveedor Vuelos 64\|1500000\.00\|COP/);
    assert.match(cxp, /hotel\|Proveedor Hotel 236\|420000\.00\|COP/);
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(numero)}`), "2");
    const tramos = sql(`select string_agg(direccion || ':' || origen_codigo || '>' || destino_codigo || ':' || coalesce(record, 'SIN-RECORD') || ':' || fecha_salida, ' ; ' order by orden) from public.contrato_vuelos where numero_contrato = ${lit(numero)}`);
    assert.equal(tramos, "ida:BOG>CTG:SIN-RECORD:2030-02-28 ; regreso:CTG>BOG:SIN-RECORD:2030-03-04");
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
    assert.deepEqual(Object.keys(c.payload.manuales![0]).sort(), ["clase", "destino", "fechaIda", "fechaRegreso", "impuestoNoComisionable", "moneda", "nombre", "origen", "pax", "precio"], "solo lo declarado: nada de costo/proveedor/record");
    const linea = c.detalle.items.find((i) => /^Vuelo ·/.test(i.descripcion));
    assert.ok(linea, "el documento lleva la línea del vuelo manual");
    assert.match(linea!.descripcion, /sujeto a confirmación de disponibilidad y tarifa/);
    assert.equal(Number(linea!.valor_total), 1_800_000);
    assert.doesNotMatch(linea!.descripcion + JSON.stringify(c.payload.manuales), /proveedor|costo|record|PNR/i);
    assert.equal((c.detalle as unknown as { hoteles: unknown[] }).hoteles.length, 1, "el único hotel del documento es el del catálogo; el manual no agrega hotel ni proveedor");
    assert.deepEqual(c.detalle.vuelos, [], "no se inventa un vuelo de Sistema (sin bloqueo ni empaquetado)");
    assert.match(r.mensaje, /Servicios manuales .*sujetos a confirmación/);
    assert.match(r.mensaje, /Total \(PVP\): .*2\.400\.000/);
    assert.equal(totalVentas(), ventas, "cotizar no crea contrato");
    assert.equal(sql("select count(*) from public.sillas"), sillas, "cotizar no toca sillas");
  });

  test("Q4 agregar/editar/quitar el manual no altera hotel ni add-ons: mismo ítem de hotel, mismas líneas; solo cambia el total por el importe del manual", async () => {
    const sin = await solicitar(entrada());
    const con = await solicitar(entrada([VUELO]));
    const editado = await solicitar(entrada([{ ...VUELO, precio: 2_000_000, pax: 3 }]));
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
  });

  test("Q5 un manual solo, sin hotel ni servicio del tarifario, no sostiene una cotización", async () => {
    const antes = totalCot();
    const r = await solicitar(entrada([VUELO], []));
    assert.equal(r.ok, false);
    assert.match(msgErr(r), /ya tenga un hotel o un servicio|carrito está vacío|tarifario/i);
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
    const a = await parchear(id, { ...p, cliente: { ...p.cliente, telefono: "3111111111" }, nota_operativa: "x" });
    assert.equal(a.error, null, a.error?.message);
    const { error } = await clienteSesion().from("cotizaciones").update({ detalle: { items: [DOC_VUELO], progreso: 1 }, estado: "abierta" } as never).eq("id", id);
    assert.equal(error, null, error?.message);
    assert.deepEqual(payloadDe(id).manuales, [VUELO]);
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
