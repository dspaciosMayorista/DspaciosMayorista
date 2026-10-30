// #90 I · migración 236 — trayecto REAL por HTTP contra PostgreSQL:
//   convertirCotizacionCarrito (app/(dashboard)/dashboard/reservar/actions.ts, SIN simulaciones de dinero) → PostgREST propio →
//   ventas / numeración / pasajeros / contrato_* / registrar_financiero_contrato / contrato_financiero_pendiente → devengo contable REAL
//   (postearAsientoCxP → asientos_contables) → pagos (pagos/actions.ts) → reconciliación (reservar/reconciliacion-actions.ts).
// Lo ÚNICO simulado: el motor de PRECIOS de la reserva (computarReserva y su vecino cotizar), que no es parte de lo que se prueba aquí, y la sesión
// (auth.getUser): el cliente "de sesión" es un cliente PostgREST real con un JWT `authenticated` de un usuario real de la base (RLS incluida).
//
// SOLO base LOCAL desechable. No corre en `npm run test:*`: la lanza supabase/scripts/test_236_app_carrito.sh, que crea la base (001-235 + 236),
// levanta un PostgREST propio y lo borra todo al final. Nada aquí habla con Supabase remoto.
import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import fs from "node:fs";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG236_CONTENEDOR ?? "pg236";
const DB = process.env.PG236_BASE ?? "";
const PGRST = process.env.PG236_POSTGREST ?? "";
const SECRETO = process.env.PG236_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) {
  throw new Error("Faltan PG236_BASE (desechable), PG236_POSTGREST y PG236_JWT_SECRET: usa supabase/scripts/test_236_app_carrito.sh.");
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
const CRON = "cron-local-236";
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
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { convertirCotizacionCarrito } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { reconciliarFinancieroPendienteCron } = await import("../app/(dashboard)/dashboard/reservar/reconciliacion-actions.ts");
const { registrarPagoProveedor, pagarSaldoExacto } = await import("../app/(dashboard)/dashboard/pagos/actions.ts");
const { actualizarCuentaPorPagar } = await import("../app/(dashboard)/dashboard/contratos/[numero]/gestion-actions.ts");

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
  HOTELES = { 3601: { nombre: "Hotel Dólar 236", moneda: "USD", pvp: 150, neto: 100 }, 3602: { nombre: "Hotel Peso 236", moneda: "COP", pvp: 300_000, neto: 210_000 } };
});

// ═════════════════════════════════════════════════════════════════════════
describe("236 · recorrido completo contrato → CxP → devengo (oferta USD, costo con proveedor en USD)", () => {
  let numero = "";
  let cotId = 0;

  test("R1 rechaza SIN la TRM de costos (o con una inválida) ANTES de numerar: ni número, ni contrato, ni CxP, ni cambio de estado ni cobro congelado", async () => {
    cotId = cotizacion({ moneda: "USD", items: [itemPayload(3601)] });
    const antes = foto();
    for (const trmCosto of [undefined, null, "", "abc", 0, -3900]) {
      const r = await convertir(cotId, 1, { monedaCobro: "USD", trmCosto });
      assert.equal(r.ok, false, String(trmCosto));
      assert.match(r.error ?? "", /TRM de costos/);
      sinEscribir(`trmCosto=${String(trmCosto)}`, antes, cotId);
      assert.equal(detalleCot(cotId).cobro, undefined, "el cobro no se congela si no se creó ningún contrato");
    }
  });

  test("R2 un usuario externo (rol agencia) no convierte: la RLS real le oculta la cotización y se rechaza antes de numerar (la regla «solo interno ingresa la TRM» es la 2.ª barrera, cubierta en costoTrmCarrito90I.test.ts)", async () => {
    const antes = foto();
    uidSesion = UID_AGENCIA;
    const r = (await convertirCotizacionCarrito(cotId, {
      agrupar: "todo", pasajeros: PASAJEROS, asesorInterno: "Asesor 236", asignaciones: [[1, 2]], asignacionesTours: [], monedaCobro: "USD", trmCosto: 3900,
    })) as Resultado;
    uidSesion = UID_ADMIN;
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /Cotización no encontrada|personal interno/);
    sinEscribir("agencia", antes, cotId);
  });

  test("R3 con la TRM de costos: contrato USD completo; la CxP conserva USD y lleva su equivalente en COP a ESA tasa (no a la de cobro); ventas.costo_* en USD", async () => {
    const r = await convertir(cotId, 1, { monedaCobro: "COP", trmCobro: 4100, trmCosto: 3900 });
    assert.equal(r.ok, true, r.error);
    numero = r.numeros![0];
    const [moneda, precio, costoHotel, mc, tc, tt, estadoFin] = fila(`select moneda, precio_venta, costo_hotel, moneda_cobro, trm_cobro, total_cobro, financiero_estado from public.ventas where numero_contrato = ${lit(numero)}`);
    assert.deepEqual([moneda, Number(precio), Number(costoHotel), mc, Number(tc), Number(tt), estadoFin], ["USD", 300, 200, "COP", 4100, 1_230_000, "completo"], "costo en USD; cobro en COP a SU tasa");
    assert.equal(cxpDe(numero), "Hotel Hotel Dólar 236|hotel|200.00|USD|780000.00|3900.0000", "100 USD × 2 pax = 200 USD · 3.900 (TRM de costos) = 780.000 COP; la de cobro (4.100) no entra");
    assert.deepEqual(detalleCot(cotId).costo, { trm: 3900 });
    assert.equal(estadoCot(cotId), "convertida");
    assert.equal(sql(`select count(*) from public.contrato_financiero_pendiente where numero_contrato = ${lit(numero)}`), "0");
  });

  test("R4 devengo REAL: el asiento de la CxP debita/acredita el equivalente en COP (780.000), nunca el nominal en dólares (200)", () => {
    const [id] = cxpIds(numero);
    assert.equal(asientoDe(id), "780000.00/780000.00");
    const cuentas = sql(`select string_agg(p.codigo || ':' || l.debe || '/' || l.haber, ' ' order by l.id) from public.asiento_lineas l join public.puc_cuentas p on p.id = l.cuenta_id join public.asientos_contables a on a.id = l.asiento_id where a.referencia = 'cxp:${id}'`);
    assert.equal(cuentas, "613505:780000.00/0.00 220505:0.00/780000.00", "Costo de ventas (hotel) / Proveedores (hotel)");
  });

  test("R5 el postcheck integral (UNA consulta) sale todo OK tras la conversión", () => {
    const salida = execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-F", "|"],
      { input: execFileSyncLeer("supabase/scripts/postcheck_236_cxp_equivalente_costo.sql"), encoding: "utf8" });
    assert.ok(!/\|REVISAR\s*$/m.test(salida), salida);
    assert.match(salida, /cxp_con_equivalente_de_costos\|1\|/);
    assert.match(salida, /cxp_con_equivalente_cuyo_asiento_no_debita_el_equivalente\|0\|0\|OK/);
  });

  test("R6 un reintento sobre la cotización ya convertida devuelve los mismos números y no crea nada (ni contrato, ni CxP, ni número)", async () => {
    const antes = foto();
    const r = await convertir(cotId, 1, { monedaCobro: "COP", trmCobro: 4100, trmCosto: 3900 });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.numeros, [numero]);
    assert.deepEqual(foto(), antes);
    const otra = await convertir(cotId, 1, { monedaCobro: "COP", trmCobro: 4100, trmCosto: 3901 });
    assert.equal(otra.ok, false, "otra TRM de costos sobre una cotización ya convertida se rechaza");
    assert.match(otra.error ?? "", /ya quedó congelada/);
    assert.deepEqual(foto(), antes, "ni contratos, ni CxP, ni números nuevos");
    const idsAntes = cxpIds(numero);
    const asientoAntes = asientoDe(idsAntes[0]);
    const invalida = await convertir(cotId, 1, { monedaCobro: "COP", trmCobro: 4100, trmCosto: "abc" });
    assert.equal(invalida.ok, false);
    assert.deepEqual(foto(), antes);
    assert.deepEqual(cxpIds(numero), idsAntes);
    assert.equal(asientoDe(idsAntes[0]), asientoAntes, "el asiento no se movió");
    assert.equal(cxpDe(numero), "Hotel Hotel Dólar 236|hotel|200.00|USD|780000.00|3900.0000");
  });

  test("R7 reconciliación: borrado el asiento, la pasada de reconciliación lo repone por el equivalente en COP (no por el nominal)", async () => {
    const [id] = cxpIds(numero);
    sql(`delete from public.asientos_contables where origen = 'cxp' and referencia = 'cxp:${id}'`);
    assert.equal(asientoDe(id), "0/0");
    const r = await reconciliarFinancieroPendienteCron(CRON, 0);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(asientoDe(id), "780000.00/780000.00");
  });

  test("R8 pagos vigentes: un pago parcial (USD a la TRM del día de pago) y el saldo exacto; el equivalente de devengo no se mueve; la diferencia queda en Proveedores (límite contable pendiente)", async () => {
    const [id] = cxpIds(numero);
    uidSesion = UID_ADMIN;
    const p1 = await registrarPagoProveedor(id, 420_000, "2030-03-10", 4200); // 100 USD
    assert.equal(p1.ok, true, JSON.stringify(p1));
    const p2 = await pagarSaldoExacto(id, 430_000, "2030-03-11"); // los 100 USD restantes, a 4.300
    assert.equal(p2.ok, true, JSON.stringify(p2));
    assert.equal(sql(`select sum(valor)::text from public.cxp_pagos where cuenta_por_pagar_id = ${id}`), "200.00", "los pagos se llevan en la moneda NOMINAL de la CxP");
    assert.deepEqual(fila(`select valor_cop_costo, trm_costo from public.cuentas_por_pagar where id = ${id}`).map(Number), [780000, 3900], "el equivalente de devengo no cambia al pagar");
    // Límite contable (C, con #43): el devengo salió a 3.900 y los pagos a 4.200/4.300; la diferencia de cambio NO se reconoce todavía y queda como saldo en Proveedores.
    const saldoProv = sql(`select coalesce(sum(l.debe - l.haber), 0)::text from public.asiento_lineas l join public.puc_cuentas p on p.id = l.cuenta_id join public.asientos_contables a on a.id = l.asiento_id
                            where p.codigo = '220505' and (a.referencia = 'cxp:${id}' or a.referencia like 'pago:${id}:%')`);
    assert.equal(Number(saldoProv), 850_000 - 780_000, "pagos reales (420.000 + 430.000) − devengo (780.000) = 70.000 de diferencia de cambio sin reconocer");
  });

  test("R9 editar el valor de una CxP con equivalente se rechaza con un mensaje claro; editar el proveedor sigue permitido", async () => {
    const [id] = cxpIds(numero);
    const malo = await actualizarCuentaPorPagar({ id, numeroContrato: numero, proveedor: "Proveedor Hotel 236", servicio: "Hotel Hotel Dólar 236", valorTotal: 250, fechaVencimiento: "2030-02-01" });
    assert.equal(malo.ok, false);
    assert.match(malo.ok ? "" : malo.error, /equivalente en pesos congelado/);
    const bueno = await actualizarCuentaPorPagar({ id, numeroContrato: numero, proveedor: "Proveedor Hotel Renombrado", servicio: "Hotel Hotel Dólar 236", valorTotal: 200, fechaVencimiento: "2030-02-01" });
    assert.equal(bueno.ok, true, JSON.stringify(bueno));
    assert.equal(asientoDe(id), "780000.00/780000.00", "el re-posteo por la edición sigue devengando el equivalente");
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("236 · rechazos ANTES de numerar: cambios de catálogo entre la cotización y la conversión (H-1)", () => {
  test("H1 oferta USD cuyo servicio del catálogo pasó a COP: se detiene; ni número, ni contrato, ni CxP; luego, devuelto a USD y con TRM, convierte", async () => {
    const sid = servicio("Islas del Rosario 236", "USD", 100);
    const id = cotizacion({ moneda: "USD", tours: [tourPayload("Islas del Rosario 236", "CARTAGENA", 300, "USD", sid)] });
    monedaDelServicio(sid, "COP"); // el catálogo cambió después de cotizar
    const antes = foto();
    const r = await convertir(id, 0, { monedaCobro: "USD", trmCosto: 3900 }, "todo", 1);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /Islas del Rosario 236: su costo con el proveedor está hoy en COP y la oferta del carrito está en USD; no se mezclan monedas/);
    sinEscribir("H-1", antes, id);
    assert.equal(detalleCot(id).cobro, undefined);

    monedaDelServicio(sid, "USD"); // se corrige el catálogo: la misma cotización ahora sí convierte
    const ok = await convertir(id, 0, { monedaCobro: "USD", trmCosto: 3900 }, "todo", 1);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(cxpDe(ok.numeros![0]), "Islas del Rosario 236|receptivo|200.00|USD|780000.00|3900.0000");
    assert.equal(sql(`select costo_receptivo::text from public.ventas where numero_contrato = ${lit(ok.numeros![0])}`), "200.00");
  });

  test("H2 caso inverso: oferta COP cuyo servicio pasó a USD: se detiene aunque se ingrese una TRM de costos", async () => {
    const sid = servicio("Traslado 236", "COP", 100_000);
    const id = cotizacion({ moneda: "COP", tours: [tourPayload("Traslado 236", "CARTAGENA", 300_000, "COP", sid)] });
    monedaDelServicio(sid, "USD");
    const antes = foto();
    const r = await convertir(id, 0, { monedaCobro: "COP", trmCosto: 3900 }, "todo", 1);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /Traslado 236: su costo con el proveedor está hoy en USD y la oferta del carrito está en COP/);
    sinEscribir("H-1 inverso", antes, id);
  });

  test("H3 costo CERO en otra moneda: no es obligación, no bloquea ni pide TRM de costos, y no se guarda ninguna", async () => {
    const sid = servicio("Cortesía 236", "COP", 0);
    const id = cotizacion({ moneda: "USD", tours: [tourPayload("Cortesía 236", "CARTAGENA", 300, "USD", sid)] });
    const r = await convertir(id, 0, { monedaCobro: "USD" }, "todo", 1);
    assert.equal(r.ok, true, r.error);
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(r.numeros![0])}`), "0");
    assert.equal(detalleCot(id).costo, undefined);
  });

  test("H6 orden de despliegue: si la base AÚN no tiene las columnas de la 236, una conversión con costos en USD se detiene antes de numerar (la RPC vieja las ignoraría en silencio)", async () => {
    const id = cotizacion({ moneda: "USD", items: [itemPayload(3601)] });
    const antes = foto();
    sql("alter table public.cuentas_por_pagar rename column valor_cop_costo to valor_cop_costo_oculta");
    try {
      const r = await convertir(id, 1, { monedaCobro: "USD", trmCosto: 3900 });
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /migración 236/);
      sinEscribir("esquema sin 236", antes, id);
    } finally {
      sql("alter table public.cuentas_por_pagar rename column valor_cop_costo_oculta to valor_cop_costo");
    }
    const ok = await convertir(id, 1, { monedaCobro: "USD", trmCosto: 3900 });
    assert.equal(ok.ok, true, ok.error);
  });

  test("H4 oferta COP con todo en COP: sin cambios — CxP COP sin equivalente, devengo por su valor, sin pedir TRM de costos", async () => {
    const id = cotizacion({ moneda: "COP", items: [itemPayload(3602)] });
    const r = await convertir(id, 1, { monedaCobro: "COP" });
    assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    assert.equal(cxpDe(n), "Hotel Hotel Peso 236|hotel|420000.00|COP|-|-");
    assert.equal(asientoDe(cxpIds(n)[0]), "420000.00/420000.00");
    assert.equal(detalleCot(id).costo, undefined);
  });

  test("H5 el hotel USD con costo en cero (neto 0) convierte sin CxP y sin TRM de costos", async () => {
    HOTELES[3601] = { ...HOTELES[3601], neto: 0 };
    const id = cotizacion({ moneda: "USD", items: [itemPayload(3601)] });
    const r = await convertir(id, 1, { monedaCobro: "USD" });
    assert.equal(r.ok, true, r.error);
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = ${lit(r.numeros![0])}`), "0");
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("236 · reintentos con dos contratos («por destino»): la TRM de costos queda congelada y nada se duplica", () => {
  test("P1 el 2.º contrato falla a mitad: el 1.º queda completo; otra TRM de costos se rechaza; la misma, ya sin la falla, completa SOLO el 2.º con la misma tasa", async () => {
    const sidA = servicio("Tour A 236", "USD", 100);
    const sidB = servicio("Tour B 236", "USD", 50);
    const id = cotizacion({
      moneda: "USD",
      tours: [tourPayload("Tour A 236", "CARTAGENA", 300, "USD", sidA), tourPayload("Tour B 236", "SANTA MARTA", 150, "USD", sidB)],
    });
    // Falla simulada de infraestructura: la CxP del 2.º contrato (Tour B) no se puede escribir (rompe la RPC financiera → se revierte ese contrato).
    sql(`
      create or replace function public.t236_falla() returns trigger language plpgsql as $f$
      begin
        if NEW.servicio = 'Tour B 236' and exists (select 1 from public.t236_interruptor where activo) then raise exception 'falla simulada 236'; end if;
        return NEW;
      end $f$;
      create table if not exists public.t236_interruptor (activo boolean);
      delete from public.t236_interruptor; insert into public.t236_interruptor values (true);
      drop trigger if exists t236_falla on public.cuentas_por_pagar;
      create trigger t236_falla before insert on public.cuentas_por_pagar for each row execute function public.t236_falla();
    `);
    const r1 = await convertir(id, 0, { monedaCobro: "USD", trmCosto: 3900 }, "por_destino", 2);
    assert.equal(r1.ok, false);
    const contratos1 = sql(`select string_agg(numero_contrato, ',' order by numero_contrato) from public.ventas where cliente = 'Ana Pérez' and numero_contrato in (select jsonb_array_elements_text(detalle->'contratos') from public.cotizaciones where id = ${id})`);
    const primero = contratos1;
    assert.match(primero, /^DTM-\d+$/, "solo el primer contrato quedó");
    assert.match(r1.error ?? "", new RegExp(`${primero}.*quedaron completos|sí quedaron completos`));
    const idsPrimero = cxpIds(primero);
    const fotoPrimero = cxpDe(primero);
    assert.equal(fotoPrimero, "Tour A 236|receptivo|200.00|USD|780000.00|3900.0000");
    assert.deepEqual(detalleCot(id).costo, { trm: 3900 }, "la TRM de costos quedó congelada con el primer contrato");
    const antes = foto();

    // Otra TRM de costos: rechazada antes de numerar el 2.º.
    const mala = await convertir(id, 0, { monedaCobro: "USD", trmCosto: 4000 }, "por_destino", 2);
    assert.equal(mala.ok, false);
    assert.match(mala.error ?? "", /ya quedó congelada/);
    assert.deepEqual(foto(), antes);

    // Sin la falla y con la MISMA TRM: completa el 2.º; el 1.º no se toca.
    sql("update public.t236_interruptor set activo = false");
    const ok = await convertir(id, 0, { monedaCobro: "USD", trmCosto: 3900 }, "por_destino", 2);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(ok.numeros!.length, 2);
    assert.equal(ok.numeros![0], primero);
    assert.deepEqual(cxpIds(primero), idsPrimero, "las CxP del primer contrato no se recrearon");
    assert.equal(cxpDe(primero), fotoPrimero);
    const segundo = ok.numeros![1];
    assert.equal(cxpDe(segundo), "Tour B 236|receptivo|100.00|USD|390000.00|3900.0000", "el 2.º usa la misma TRM de costos");
    assert.equal(estadoCot(id), "convertida");
    assert.equal(sql(`select count(*) from public.cuentas_por_pagar where servicio in ('Tour A 236', 'Tour B 236')`), "2", "una CxP por tour: nada duplicado");
    sql("drop trigger if exists t236_falla on public.cuentas_por_pagar");
  });

  test("P3 conversión PARCIAL cuyo grupo pendiente no genera CxP USD: otra TRM de costos se rechaza; la misma completa sin tocar el primer contrato", async () => {
    const sidA = servicio("Tour D 236", "USD", 100);
    const sidB = servicio("Cortesía D 236", "USD", 0);
    const id = cotizacion({
      moneda: "USD",
      tours: [tourPayload("Tour D 236", "CARTAGENA", 300, "USD", sidA), tourPayload("Cortesía D 236", "SANTA MARTA", 150, "USD", sidB)],
    });
    sql(`
      create table if not exists public.t236_interruptor (activo boolean);
      delete from public.t236_interruptor; insert into public.t236_interruptor values (true);
      create or replace function public.t236_falla_venta() returns trigger language plpgsql as $f$
      begin
        if NEW.destino = 'SANTA MARTA' and exists (select 1 from public.t236_interruptor where activo) then raise exception 'falla simulada 236 venta'; end if;
        return NEW;
      end $f$;
      drop trigger if exists t236_falla_venta on public.ventas;
      create trigger t236_falla_venta before insert on public.ventas for each row execute function public.t236_falla_venta();
    `);
    const r1 = await convertir(id, 0, { monedaCobro: "USD", trmCosto: 3900 }, "por_destino", 2);
    assert.equal(r1.ok, false);
    const primero = detalleCot(id).contratos?.[0] ?? "";
    assert.match(primero, /^DTM-\d+$/, "el primer grupo quedó creado");
    assert.deepEqual(detalleCot(id).costo, { trm: 3900 });
    const idsPrimero = cxpIds(primero);
    const fotoPrimero = cxpDe(primero);
    const asientoPrimero = asientoDe(idsPrimero[0]);
    sql("update public.t236_interruptor set activo = false");
    const antes = foto();
    // El grupo pendiente (cortesía, costo 0) no genera CxP USD: aun así otra TRM de costos se rechaza, antes de numerar.
    const mala = await convertir(id, 0, { monedaCobro: "USD", trmCosto: 4000 }, "por_destino", 2);
    assert.equal(mala.ok, false);
    assert.match(mala.error ?? "", /ya quedó congelada/);
    assert.deepEqual(foto(), antes);
    assert.equal(estadoCot(id), "abierta");
    // La misma TRM completa SOLO el grupo pendiente.
    const ok = await convertir(id, 0, { monedaCobro: "USD", trmCosto: 3900 }, "por_destino", 2);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(ok.numeros!.length, 2);
    assert.equal(ok.numeros![0], primero);
    assert.deepEqual(cxpIds(primero), idsPrimero);
    assert.equal(cxpDe(primero), fotoPrimero);
    assert.equal(asientoDe(idsPrimero[0]), asientoPrimero);
    assert.equal(cxpDe(ok.numeros![1]) ?? "", "", "el grupo de cortesía no tiene CxP");
    assert.deepEqual(detalleCot(id).costo, { trm: 3900 });
    sql("drop trigger if exists t236_falla_venta on public.ventas");
  });

  test("P2 contrato que queda PENDIENTE con su payload guardado (la reversión también falla): la reconciliación lo completa con el MISMO equivalente y devenga por él", async () => {
    const sid = servicio("Tour C 236", "USD", 100);
    const id = cotizacion({ moneda: "USD", tours: [tourPayload("Tour C 236", "CARTAGENA", 300, "USD", sid)] });
    sql(`
      create table if not exists public.t236_interruptor (activo boolean);
      delete from public.t236_interruptor; insert into public.t236_interruptor values (true);
      create or replace function public.t236_falla() returns trigger language plpgsql as $f$
      begin
        if NEW.servicio = 'Tour C 236' and exists (select 1 from public.t236_interruptor where activo) then raise exception 'falla simulada 236'; end if;
        return NEW;
      end $f$;
      create or replace function public.t236_no_borra() returns trigger language plpgsql as $f$
      begin
        if exists (select 1 from public.t236_interruptor where activo) then raise exception 'no se puede borrar (simulado 236)'; end if;
        return OLD;
      end $f$;
      drop trigger if exists t236_falla on public.cuentas_por_pagar;
      create trigger t236_falla before insert on public.cuentas_por_pagar for each row execute function public.t236_falla();
      drop trigger if exists t236_no_borra on public.ventas;
      create trigger t236_no_borra before delete on public.ventas for each row execute function public.t236_no_borra();
    `);
    const r = await convertir(id, 0, { monedaCobro: "USD", trmCosto: 3900 }, "todo", 1);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /tampoco se pudo deshacer|Revísalo/);
    const pend = fila(`select v.numero_contrato, v.financiero_estado, (select count(*) from public.cuentas_por_pagar c where c.numero_contrato = v.numero_contrato)
                         from public.ventas v join public.contrato_financiero_pendiente p on p.numero_contrato = v.numero_contrato where p.cxp::text like '%Tour C 236%'`);
    const numero = pend[0];
    assert.deepEqual([pend[1], pend[2]], ["pendiente", "0"], "contrato incompleto, detectable, sin CxP");
    assert.match(sql(`select cxp::text from public.contrato_financiero_pendiente where numero_contrato = ${lit(numero)}`), /"valor_cop_costo": 780000/, "el payload guardado ya lleva el equivalente congelado");

    sql("update public.t236_interruptor set activo = false; drop trigger t236_falla on public.cuentas_por_pagar; drop trigger t236_no_borra on public.ventas");
    const rec = await reconciliarFinancieroPendienteCron(CRON, 0);
    assert.equal(rec.ok, true, JSON.stringify(rec));
    assert.equal(sql(`select financiero_estado from public.ventas where numero_contrato = ${lit(numero)}`), "completo");
    assert.equal(cxpDe(numero), "Tour C 236|receptivo|200.00|USD|780000.00|3900.0000", "mismo valor, moneda y equivalente que se había decidido escribir");
    assert.equal(asientoDe(cxpIds(numero)[0]), "780000.00/780000.00", "devengo por el equivalente en COP");
    assert.equal(sql(`select count(*) from public.contrato_financiero_pendiente where numero_contrato = ${lit(numero)}`), "0");
  });
});

function execFileSyncLeer(rel: string): string {
  return fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}
