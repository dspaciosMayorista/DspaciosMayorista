// Owner correction batch 2026-11-18 · gap G1 — REAL payment / confirmation / reversal path for a USD offer collected in COP (offer USD 1.000, collection TRM 4.100).
//   crearSolicitudReserva → convertirCotizacionCarrito (contract with frozen collection conversion) → registrarAbono (real action → RPC registrar_abono, which also decides the
//   confirmation in the same transaction) → anularAbono (real action → RPC anular_abono) → persisted state read back at every step.
// Only the PRICING engine and the cookie/session plumbing are simulated (same harness as cotizacionAsistidaB2B102.pg.ts); the money rules, RLS, RPCs and triggers are the real ones.
// SOLO base LOCAL desechable: launch with
//   MSYS_NO_PATHCONV=1 sh supabase/scripts/test_pg_local.sh pg304 plantilla304 PG261 pruebas/pagoUsdConversion2611.pg.ts supabase/migrations/20260601000303_*.sql … 311_*.sql
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG261_CONTENEDOR ?? "pg304";
const DB = process.env.PG261_BASE ?? "";
const PGRST = process.env.PG261_POSTGREST ?? "";
const SECRETO = process.env.PG261_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG261_BASE (desechable), PG261_POSTGREST y PG261_JWT_SECRET: usa supabase/scripts/test_pg_local.sh.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(specifier, context, nextResolve) { const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true }; return nextResolve(specifier, context); } });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const U = { VENTA: "00000000-0000-0000-0000-000000261001", ADMIN: "00000000-0000-0000-0000-000000261002" } as const;
const SESIONES: Record<string, { rol: string; tenant: string; email: string; nombre: string }> = {
  [U.VENTA]: { rol: "venta", tenant: "mayorista", email: "u261_venta@x.test", nombre: "Usuario 261 venta" },
  [U.ADMIN]: { rol: "administracion", tenant: "mayorista", email: "u261_admin@x.test", nombre: "Usuario 261 admin" },
};
const TOKEN_SERVICIO = jwt({ role: "service_role" });
let uidSesion: string = U.VENTA;
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;

const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteSesion = () => clienteLocal(jwt({ role: "authenticated", sub: uidSesion }), { id: uidSesion, email: SESIONES[uidSesion].email });
function psql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
const sql = (q: string) => psql(q);
const json = <T = Record<string, unknown>>(q: string): T => JSON.parse(sql(q)) as T;
const num = (v: unknown) => Number(v);

// Engine: ONE USD hotel, 2 adults at USD 500 each → offer USD 1.000, no tax. (Pricing is not what this suite proves.)
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async () => ({
      ok: true,
      data: {
        origen: { tipo: "ninguno" }, meta: { hotel_nombre: "Hotel USD 261", destino_nombre: "CARTAGENA", fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04" },
        precioVenta: 1000, monedaReserva: "USD", impuestoTotal: 0, lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: 500 }], pvpPorAcom: { doble: 500 }, netoPorAcom: { doble: 300 },
        numNinos: 0, numNinos2: 0, numInfantes: 0, numMenoresDeDos: 0, totalPax: 2, paxConSilla: 2, edadesMenoresUsadas: [], lineasMenores: [],
        serviciosIncluidos: [], serviciosItems: [], distribucionMenores: null, condicionesTarifa: [], notaNino: null, cargoMascota: null, notaMascota: null, oferta63: null, vigencias63: [],
      },
    }),
  },
});
mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/reservar/cotizar", { namedExports: { liquidarServicioPuntual: async () => ({ ok: false, tipo: "no_disponible", mensaje: "no" }), cotizarPorFechas: async () => { throw new Error("no"); }, buscarHoteles: async () => { throw new Error("no"); }, buscarReceptivos: async () => { throw new Error("no"); } } });
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
const { autorizaTenant } = await import("../lib/cotizacion/accesoPuro.ts");
mock.module("@/lib/cotizacion/acceso", { namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: false, tenant: SESIONES[uidSesion].tenant }), autorizaTenant } });
// Frozen payment conditions are NOT simulated away by accident: with none, the minimum is the historical 30 % rule (legacy_pct) of the collection total; see test P0.
mock.module("@/lib/contrato/congelarCondicionesContrato", { namedExports: { componenteHotelReal: async () => null, componentePaqueteReal: async () => null, trmReferenciaAproximada: async () => null, congelarCondicionesContratoBestEffort: async () => {} } });
const { interpretarRespuestaNumeroContrato } = await import("../lib/contrato/numeracionPuro.ts");
mock.module("@/lib/contrato/numeracion", { namedExports: { siguienteNumeroContrato: async (tenant: string) => { const { data, error } = await clienteLocal(TOKEN_SERVICIO).rpc("siguiente_numero_contrato_para_tenant", { p_tenant: tenant }); return interpretarRespuestaNumeroContrato(data, error as never); } } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[], set: () => undefined };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");
const { convertirCotizacionCarrito } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { registrarAbono, anularAbono } = await import("../app/(dashboard)/dashboard/contratos/actions.ts");
const { pagadoEnMonedaOferta, cobroDeVenta } = await import("../lib/finanzas/cobro.ts");

const PASAJEROS = [
  { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false },
  { nombres: "Luis", apellidos: "Gómez", tipoDoc: "CC", numeroDoc: "456", fechaNacimiento: "1988-05-05", nacionalidad: "Colombiana", esInfante: false },
];
const CLIENTE = { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };

before(() => {
  sql(`
    insert into auth.users (id, email) values ${Object.entries(SESIONES).map(([id, s]) => `('${id}', '${s.email}')`).join(", ")} on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ${Object.entries(SESIONES).map(([id, s]) => `('${id}', '${s.email}', '${s.nombre}', '${s.rol}', true, '${s.tenant}')`).join(", ")}
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into public.destinos (id, nombre) values (26101, 'CARTAGENA 261') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (26101, 'Proveedor Hotel 261') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) values (26101, 26101, 'Hotel USD 261', 26101, 'USD') on conflict do nothing;
    insert into public.armado_paquetes (id, nombre, tipo, moneda) values (26101, 'Paquete USD 261', 'porcion_terrestre', 'USD') on conflict do nothing;
  `);
});

/** New contract: USD 1.000 offer collected in COP at the frozen TRM 4.100 (the owner's DTM-0005 shape). */
async function contratoUsd(): Promise<string> {
  uidSesion = U.ADMIN; // administración: escribe los hijos del contrato sin depender del dueño por nombre (el flujo de venta/RLS por asesor no es lo que prueba este suite)
  const r = (await crearSolicitudReserva({
    items: [{ itemId: "h26101", modulo: "porcion_terrestre", paqueteId: 26101, hotelId: 26101, bloqueoId: null, hotelNombre: "Hotel USD 261", destino: "CARTAGENA", categoria: "Estandar", regimen: "Desayuno",
      fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0 }],
    tours: [], cliente: CLIENTE,
  } as never)) as unknown as { ok: boolean; error?: string; cotizacion?: { id: number } };
  assert.equal(r.ok, true, r.error);
  const c = (await convertirCotizacionCarrito(r.cotizacion!.id, { agrupar: "todo", pasajeros: PASAJEROS, asesorInterno: SESIONES[U.ADMIN].nombre, asignaciones: [[1, 2]], asignacionesTours: [], monedaCobro: "COP", trmCobro: 4100, trmCosto: 3900 } as never)) as { ok: boolean; error?: string; numeros?: string[] };
  assert.equal(c.ok, true, c.error);
  return c.numeros![0];
}
const venta = (n: string) => json<{ estado: string; moneda: string; precio_venta: number; moneda_cobro: string | null; trm_cobro: number | null; total_cobro: number | null }>(
  `select row_to_json(t)::text from (select estado, moneda, precio_venta, moneda_cobro, trm_cobro, total_cobro from public.ventas where numero_contrato = '${n}') t`);
const abonos = (n: string) => json<{ id: number; valor_abono: number; monto_cop: number; trm: number }[]>(
  `select coalesce(json_agg(row_to_json(t) order by id), '[]'::json)::text from (select id, valor_abono, monto_cop, trm from public.abonos where numero_contrato = '${n}') t`);
const anulados = (n: string) => Number(sql(`select count(*) from public.abonos_anulados where numero_contrato = '${n}'`));
const pagarCop = async (n: string, cop: number) => { uidSesion = U.ADMIN; return registrarAbono(n, cop, "Efectivo", `r-${cop}`, undefined, undefined, undefined, randomUUID(), {} as never); };
const pagadoUsd = (n: string) => { const v = venta(n); const c = cobroDeVenta({ ...v, moneda: v.moneda } as never); const cop = abonos(n).reduce((s, a) => s + num(a.monto_cop), 0); return pagadoEnMonedaOferta(cop, c as never); };

describe("G1 · USD 1.000 cobrado en COP a TRM 4.100: pago → confirmación → anulación con las acciones REALES", () => {
  test("P0 el contrato nace pendiente con la conversión congelada: total a cobrar COP = 1.000 × 4.100 = 4.100.000", async () => {
    const n = await contratoUsd();
    const v = venta(n);
    assert.deepEqual({ estado: v.estado, moneda: v.moneda, precio: num(v.precio_venta), mc: v.moneda_cobro, trm: num(v.trm_cobro), total: num(v.total_cobro) }, { estado: "pendiente", moneda: "USD", precio: 1000, mc: "COP", trm: 4100, total: 4_100_000 });
    assert.equal(abonos(n).length, 0);
  });

  test("P1 pago por debajo del mínimo (30 % × 4.100.000 = COP 1.230.000): COP 1.000.000 → sigue pendiente; en USD son 1.000.000 / 4.100 = 243,90 (nunca saldo 0)", async () => {
    const n = await contratoUsd();
    assert.deepEqual(await pagarCop(n, 1_000_000), { ok: true });
    assert.equal(venta(n).estado, "pendiente", "1.000.000 < 1.230.000");
    const a = abonos(n);
    assert.deepEqual(a.map((x) => ({ v: num(x.valor_abono), cop: num(x.monto_cop), trm: num(x.trm) })), [{ v: 1_000_000, cop: 1_000_000, trm: 1 }], "el abono se guarda en la moneda de COBRO (COP), TRM 1");
    assert.equal(pagadoUsd(n), 243.9, "1.000.000 ÷ 4.100 = 243,9024 → 243,90");
    assert.equal(num(venta(n).trm_cobro), 4100, "la TRM de cobro congelada no cambia");
  });

  test("P2 el pago que completa el mínimo EXACTO (1.000.000 + 230.000 = 1.230.000 = USD 300) confirma el contrato en la misma operación", async () => {
    const n = await contratoUsd();
    await pagarCop(n, 1_000_000);
    assert.deepEqual(await pagarCop(n, 230_000), { ok: true });
    assert.equal(venta(n).estado, "confirmado");
    assert.equal(pagadoUsd(n), 300, "1.230.000 ÷ 4.100 = 300");
    assert.equal(1000 - pagadoUsd(n), 700, "saldo USD 700");
  });

  test("P3 mínimo ya satisfecho de una sola vez: COP 1.230.000 en un solo abono → confirmado; un pago adicional lo deja confirmado (USD 1.230.000 + 500.000 = 1.730.000 ÷ 4.100 = 421,95)", async () => {
    const n = await contratoUsd();
    assert.deepEqual(await pagarCop(n, 1_230_000), { ok: true });
    assert.equal(venta(n).estado, "confirmado");
    assert.deepEqual(await pagarCop(n, 500_000), { ok: true });
    assert.equal(venta(n).estado, "confirmado");
    assert.equal(pagadoUsd(n), 421.95, "1.730.000 ÷ 4.100 = 421,9512 → 421,95");
  });

  test("P4 anulación REAL: el abono sale de abonos, queda su huella en abonos_anulados, la TRM y el total congelados no cambian y el contrato confirmado NO vuelve a pedir su mínimo", async () => {
    const n = await contratoUsd();
    await pagarCop(n, 1_230_000);
    assert.equal(venta(n).estado, "confirmado");
    const [a] = abonos(n);
    uidSesion = U.ADMIN;
    assert.deepEqual(await anularAbono(a.id, n, "Pago devuelto al cliente", {} as never), { ok: true });
    assert.equal(abonos(n).length, 0, "el abono ya no existe");
    assert.equal(anulados(n), 1, "huella append-only de la anulación");
    assert.equal(pagadoUsd(n), 0, "pagado USD 0, saldo USD 1.000");
    const v = venta(n);
    assert.deepEqual({ trm: num(v.trm_cobro), total: num(v.total_cobro), mc: v.moneda_cobro }, { trm: 4100, total: 4_100_000, mc: "COP" }, "TRM y total de cobro congelados intactos");
    assert.equal(v.estado, "confirmado", "la confirmación es de un solo sentido: anular un pago no desconfirma (regla vigente de recalcularEstadoAbono)");
    // reintento idempotente de la misma anulación: sin escribir nada nuevo
    assert.equal((await anularAbono(a.id, n, "Pago devuelto al cliente", {} as never)).ok, true);
    assert.equal(anulados(n), 1);
  });

  test("P5 anulación de un pago intermedio de un contrato aún pendiente: sigue pendiente y recalcula lo pagado (1.000.000 − 1.000.000 = 0)", async () => {
    const n = await contratoUsd();
    await pagarCop(n, 1_000_000);
    const [a] = abonos(n);
    uidSesion = U.ADMIN;
    assert.deepEqual(await anularAbono(a.id, n, "Error de digitación", {} as never), { ok: true });
    assert.equal(venta(n).estado, "pendiente");
    assert.equal(pagadoUsd(n), 0);
  });
});
