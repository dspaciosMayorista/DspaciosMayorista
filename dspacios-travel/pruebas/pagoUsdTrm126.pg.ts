// #126-A — pagos de un contrato en USD con TRM PROPIA por pago: acciones REALES (registrarAbono / anularAbono / cargarEstadoCuenta / acceso al voucher) contra Postgres local, estado persistido releído.
// Ejemplo del dueño: USD 1.000; COP 1.230.000 a 4.100 = USD 300; COP 2.940.000 a 4.200 = USD 700; saldo 0; COP cobrado real 4.170.000.
// Solo se simulan el motor de PRECIOS y la cookie/sesión; reglas de dinero, RLS, RPC y triggers son las reales.
// SOLO base LOCAL desechable:  MSYS_NO_PATHCONV=1 sh supabase/scripts/test_pg_local.sh pg304 plantilla304 PG126 pruebas/pagoUsdTrm126.pg.ts supabase/migrations/20260601000303_*.sql … 313_*.sql
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG126_CONTENEDOR ?? "pg304";
const DB = process.env.PG126_BASE ?? "";
const PGRST = process.env.PG126_POSTGREST ?? "";
const SECRETO = process.env.PG126_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG126_BASE (desechable), PG126_POSTGREST y PG126_JWT_SECRET: usa supabase/scripts/test_pg_local.sh.");

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
const U = { VENTA: "00000000-0000-0000-0000-000000126001", ADMIN: "00000000-0000-0000-0000-000000126002" } as const;
const SESIONES: Record<string, { rol: string; tenant: string; email: string; nombre: string }> = {
  [U.VENTA]: { rol: "venta", tenant: "mayorista", email: "u126_venta@x.test", nombre: "Usuario 126 venta" },
  [U.ADMIN]: { rol: "administracion", tenant: "mayorista", email: "u126_admin@x.test", nombre: "Usuario 126 admin" },
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
        origen: { tipo: "ninguno" }, meta: { hotel_nombre: "Hotel USD 126", destino_nombre: "CARTAGENA", fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04" },
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
const { registrarAbono, anularAbono, actualizarAbono } = await import("../app/(dashboard)/dashboard/contratos/actions.ts");
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
    insert into public.destinos (id, nombre) values (12601, 'CARTAGENA 126') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (12601, 'Proveedor Hotel 126') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) values (12601, 12601, 'Hotel USD 126', 12601, 'USD') on conflict do nothing;
    insert into public.armado_paquetes (id, nombre, tipo, moneda) values (12601, 'Paquete USD 126', 'porcion_terrestre', 'USD') on conflict do nothing;
  `);
});


const { cargarEstadoCuenta } = await import("../lib/cuenta/estado.ts");
const { contratoPagadoCompleto } = await import("../lib/voucher/pagoCompleto.ts");
const { resumenCobroUsd, copDeUsdNativo } = await import("../lib/finanzas/pagoUsd.ts");

/** #126-A — contrato en USD cobrado en USD (cada pago en COP pide SU TRM). Principal USD 1.000; confirmación = 30 % = USD 300. */
async function contratoUsd(): Promise<string> {
  uidSesion = U.ADMIN;
  const r = (await crearSolicitudReserva({
    items: [{ itemId: "h12601", modulo: "porcion_terrestre", paqueteId: 12601, hotelId: 12601, bloqueoId: null, hotelNombre: "Hotel USD 126", destino: "CARTAGENA", categoria: "Estandar", regimen: "Desayuno",
      fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0 }],
    tours: [], cliente: CLIENTE,
  } as never)) as unknown as { ok: boolean; error?: string; cotizacion?: { id: number } };
  assert.equal(r.ok, true, r.error);
  const c = (await convertirCotizacionCarrito(r.cotizacion!.id, { agrupar: "todo", pasajeros: PASAJEROS, asesorInterno: SESIONES[U.ADMIN].nombre, asignaciones: [[1, 2]], asignacionesTours: [], monedaCobro: "USD", trmCosto: 3900 } as never)) as { ok: boolean; error?: string; numeros?: string[] };
  assert.equal(c.ok, true, c.error);
  return c.numeros![0];
}
const venta = (n: string) => json<{ estado: string; moneda: string; precio_venta: number; moneda_cobro: string | null; trm_cobro: number | null; total_cobro: number | null; trm_contrato: number | null }>(
  `select row_to_json(t)::text from (select estado, moneda, precio_venta, moneda_cobro, trm_cobro, total_cobro, trm_contrato from public.ventas where numero_contrato = '${n}') t`);
const abonos = (n: string) => json<{ id: number; valor_abono: number; monto_cop: number; trm: number; moneda_pago: string | null }[]>(
  `select coalesce(json_agg(row_to_json(t) order by id), '[]'::json)::text from (select id, valor_abono, monto_cop, trm, moneda_pago from public.abonos where numero_contrato = '${n}') t`);
const asientoAbono = (id: number) => num(sql(`select coalesce(sum(l.debe), 0) from public.asientos_contables a join public.asiento_lineas l on l.asiento_id = a.id where a.origen = 'abono' and a.referencia = 'abono:${id}'`));
const pagar = async (n: string, cop: number, trm: number | undefined, monedaPago?: "COP" | "USD") => { uidSesion = U.ADMIN; return registrarAbono(n, cop, "Transferencia", `r-${cop}-${trm}`, trm, undefined, undefined, randomUUID(), {} as never, monedaPago); };
const resumen = (n: string) => resumenCobroUsd(1000, abonos(n));
const fila = (a: { id: number; valor_abono: number; monto_cop: number; trm: number; moneda_pago: string | null }) => ({ usd: num(a.valor_abono), cop: num(a.monto_cop), trm: num(a.trm), mp: a.moneda_pago });

describe("#126-A · USD 1.000 cobrado en USD: cada pago en COP con SU TRM, acciones REALES, lo persistido releído", () => {
  test("Q0 el contrato nace pendiente, principal USD 1.000, cobro en USD sin conversión ni TRM de contrato congelada", async () => {
    const n = await contratoUsd();
    const v = venta(n);
    assert.deepEqual({ estado: v.estado, moneda: v.moneda, precio: num(v.precio_venta), mc: v.moneda_cobro, trm: v.trm_cobro, total: v.total_cobro }, { estado: "pendiente", moneda: "USD", precio: 1000, mc: "USD", trm: null, total: null });
    assert.equal(abonos(n).length, 0);
  });

  test("Q1 ejemplo del dueño: COP 1.230.000 a 4.100 = USD 300 (confirma: mínimo 30 %); COP 2.940.000 a 4.200 = USD 700; saldo USD 0; COP cobrado REAL 4.170.000", async () => {
    const n = await contratoUsd();
    assert.deepEqual(await pagar(n, 1_230_000, 4100), { ok: true });
    assert.equal(venta(n).estado, "confirmado", "USD 300 = 30 % de USD 1.000, exacto");
    assert.deepEqual(await pagar(n, 2_940_000, 4200), { ok: true });
    const a = abonos(n);
    assert.deepEqual(a.map((x) => ({ usd: num(x.valor_abono), cop: num(x.monto_cop), trm: num(x.trm) })), [
      { usd: 300, cop: 1_230_000, trm: 4100 }, { usd: 700, cop: 2_940_000, trm: 4200 },
    ], "cada pago guarda SU TRM, sus USD acreditados y sus pesos reales");
    const r = resumen(n);
    assert.deepEqual({ abonado: r.abonado, saldo: r.saldo, cobradoCop: r.cobradoCop, definitivo: r.definitivo, totalCop: r.totalCop }, { abonado: 1000, saldo: 0, cobradoCop: 4_170_000, definitivo: true, totalCop: 4_170_000 });
    assert.equal(num(venta(n).trm_contrato), 4170, "la TRM efectiva del contrato es el promedio ponderado de los pagos reales (4.170.000 ÷ 1.000), nunca una tasa única");
    assert.equal(venta(n).total_cobro, null, "nada se congela: el principal sigue siendo USD");
    // contabilidad: cada abono asienta sus PESOS reales (no el USD ni la TRM del contrato)
    assert.deepEqual(a.map((x) => asientoAbono(x.id)), [1_230_000, 2_940_000]);
  });

  test("Q2 documentos del cliente: estado de cuenta en USD (pagado 1.000, saldo 0) con los pesos y la TRM de CADA pago", async () => {
    const n = await contratoUsd();
    await pagar(n, 1_230_000, 4100); await pagar(n, 2_940_000, 4200);
    uidSesion = U.ADMIN;
    const ec = (await cargarEstadoCuenta(n))!;
    assert.ok(ec);
    assert.deepEqual({ moneda: ec.moneda, precio: ec.precio_venta, pagado: ec.pagado, saldo: ec.saldo, cobradoCop: ec.cobradoCop }, { moneda: "USD", precio: 1000, pagado: 1000, saldo: 0, cobradoCop: 4_170_000 });
    assert.deepEqual(ec.abonos.map((x) => ({ usd: x.valor_abono, cop: x.monto_cop, trm: x.trm, pagadoTras: x.pagadoTras, saldoTras: x.saldoTras })), [
      { usd: 300, cop: 1_230_000, trm: 4100, pagadoTras: 300, saldoTras: 700 }, { usd: 700, cop: 2_940_000, trm: 4200, pagadoTras: 1000, saldoTras: 0 },
    ], "el recibo de cada pago muestra lo pagado HASTA ese recibo (300 y 1.000) y su saldo (700 y 0): nunca el total de hoy junto al saldo de entonces");
  });

  test("Q3 TRM inválida: faltante, 0, negativa, 1 o NaN se rechazan con mensaje y NO escriben ningún abono", async () => {
    const n = await contratoUsd();
    for (const trm of [undefined, 0, -4100, 1, 4.1, 99.99, Number.NaN]) {
      const r = await pagar(n, 1_230_000, trm as number | undefined);
      assert.equal(r.ok, false, `TRM ${String(trm)} debía rechazarse`);
      assert.match(r.error ?? "", /TRM/);
    }
    assert.equal(abonos(n).length, 0);
    assert.equal(venta(n).estado, "pendiente");
  });

  test("Q4 la TRM de CADA pago decide la confirmación: COP 1.200.000 a 3.900 = USD 307,69 (≥ 300, confirma) mientras a 4.100 serían 292,68 (no confirma)", async () => {
    const barata = await contratoUsd();
    await pagar(barata, 1_200_000, 3900);
    assert.equal(num(abonos(barata)[0].valor_abono), 307.69);
    assert.equal(venta(barata).estado, "confirmado");
    const cara = await contratoUsd();
    await pagar(cara, 1_200_000, 4100);
    assert.equal(num(abonos(cara)[0].valor_abono), 292.68);
    assert.equal(venta(cara).estado, "pendiente", "292,68 < 300");
  });

  test("Q5 pago nativo en USD: 300 USD acreditan exactamente 300 (sin división ni redondeo) y el asiento lleva su equivalente en pesos a la TRM indicada", async () => {
    const n = await contratoUsd();
    const cop = copDeUsdNativo(300, 4100)!;
    assert.equal(cop, 1_230_000);
    assert.deepEqual(await pagar(n, cop, 4100), { ok: true });
    const [a] = abonos(n);
    assert.deepEqual({ usd: num(a.valor_abono), cop: num(a.monto_cop), trm: num(a.trm) }, { usd: 300, cop: 1_230_000, trm: 4100 });
    assert.equal(asientoAbono(a.id), 1_230_000);
    assert.equal(venta(n).estado, "confirmado");
  });

  test("Q6 pagos mixtos: USD 300 nativo + COP 2.940.000 a 4.200 = USD 1.000 (saldo 0); un pago más pide confirmación y no escribe nada", async () => {
    const n = await contratoUsd();
    await pagar(n, copDeUsdNativo(300, 4100)!, 4100);
    assert.deepEqual(await pagar(n, 2_940_000, 4200), { ok: true });
    assert.equal(resumen(n).saldo, 0);
    assert.equal(resumen(n).cobradoCop, 4_170_000);
    const extra = await pagar(n, 420_000, 4200);
    assert.equal(extra.ok, false);
    assert.ok(extra.confirmacion, "el contrato ya cubierto pide confirmar el pago adicional");
    assert.equal(abonos(n).length, 2);
  });

  test("Q7 reversión: anular el segundo pago devuelve el saldo (USD 700), retira su asiento y sus pesos, recalcula la TRM efectiva y NO desconfirma", async () => {
    const n = await contratoUsd();
    await pagar(n, 1_230_000, 4100); await pagar(n, 2_940_000, 4200);
    const [a1, a2] = abonos(n);
    uidSesion = U.ADMIN;
    assert.deepEqual(await anularAbono(a2.id, n, "Pago devuelto al cliente", {} as never), { ok: true });
    const r = resumen(n);
    assert.deepEqual({ abonado: r.abonado, saldo: r.saldo, cobradoCop: r.cobradoCop, definitivo: r.definitivo }, { abonado: 300, saldo: 700, cobradoCop: 1_230_000, definitivo: false });
    assert.equal(r.totalCop, 1_230_000 + 700 * 4100, "el saldo solo se ESTIMA (a la TRM media de lo cobrado) y el total queda provisional");
    assert.equal(num(venta(n).trm_contrato), 4100, "TRM efectiva recalculada con el único pago que queda");
    assert.equal(asientoAbono(a2.id), 0, "el asiento del pago anulado se retiró");
    assert.equal(asientoAbono(a1.id), 1_230_000, "el otro pago conserva el suyo");
    assert.equal(venta(n).estado, "confirmado");
  });

  test("Q8 acceso al voucher del aliado: solo con el contrato 100 % pagado en USD; al anular un pago se pierde y el contrato no se desconfirma", async () => {
    const n = await contratoUsd();
    await pagar(n, 1_230_000, 4100);
    assert.equal(await contratoPagadoCompleto(n), false, "USD 300 de 1.000");
    await pagar(n, 2_940_000, 4200);
    assert.equal(await contratoPagadoCompleto(n), true, "USD 1.000 de 1.000, aunque cada pago tuvo otra TRM");
    const [, a2] = abonos(n);
    uidSesion = U.ADMIN;
    await anularAbono(a2.id, n, "Pago devuelto", {} as never);
    assert.equal(await contratoPagadoCompleto(n), false);
  });

  test("Q10 dólares recibidos: el abono guarda moneda_pago USD; el estado de cuenta y el resumen NO cuentan su equivalente como pesos recibidos", async () => {
    const n = await contratoUsd();
    assert.deepEqual(await pagar(n, copDeUsdNativo(300, 4100)!, 4100, "USD"), { ok: true });
    const [a] = abonos(n);
    assert.deepEqual(fila(a), { usd: 300, cop: 1_230_000, trm: 4100, mp: "USD" }, "dólares recibidos: USD 300 exactos; los pesos son el equivalente contable");
    assert.equal(asientoAbono(a.id), 1_230_000, "el libro sí asienta el equivalente contable");
    uidSesion = U.ADMIN;
    const ec = (await cargarEstadoCuenta(n))!;
    assert.deepEqual({ cobradoCop: ec.cobradoCop, recibidoUsd: ec.recibidoUsd, equiv: ec.equivalenteContableCop, mp: ec.abonos[0].moneda_pago, pagado: ec.pagado }, { cobradoCop: 0, recibidoUsd: 300, equiv: 1_230_000, mp: "USD", pagado: 300 }, "cero pesos recibidos");
    const r = resumenCobroUsd(1000, abonos(n));
    assert.deepEqual({ c: r.cobradoCop, u: r.recibidoUsd, e: r.equivalenteContableCop }, { c: 0, u: 300, e: 1_230_000 });
  });

  test("Q11 pagos mixtos con moneda explícita: USD 300 recibidos + COP 2.940.000 recibidos a 4.200 → pesos recibidos 2.940.000; total contable 4.170.000", async () => {
    const n = await contratoUsd();
    await pagar(n, copDeUsdNativo(300, 4100)!, 4100, "USD");
    assert.deepEqual(await pagar(n, 2_940_000, 4200, "COP"), { ok: true });
    assert.deepEqual(abonos(n).map((x) => x.moneda_pago), ["USD", "COP"]);
    uidSesion = U.ADMIN;
    const ec = (await cargarEstadoCuenta(n))!;
    assert.deepEqual({ cobradoCop: ec.cobradoCop, recibidoUsd: ec.recibidoUsd, equiv: ec.equivalenteContableCop, saldo: ec.saldo }, { cobradoCop: 2_940_000, recibidoUsd: 300, equiv: 1_230_000, saldo: 0 });
    assert.equal(resumen(n).totalCop, 4_170_000);
  });

  test("Q12 un pago recibido en dólares no se «corrige en pesos»: cambiar valor o TRM se rechaza; fecha/forma/referencia sí se editan", async () => {
    const n = await contratoUsd();
    await pagar(n, copDeUsdNativo(300, 4100)!, 4100, "USD");
    const [a] = abonos(n);
    uidSesion = U.ADMIN;
    const malo = await actualizarAbono(a.id, n, { valor: 1_300_000, fecha: "2030-01-01", formaPago: "Transferencia", referencia: "x", trmInput: 4100 }, {} as never);
    assert.equal(malo.ok, false); assert.match(malo.error ?? "", /recibió en dólares/);
    const malo2 = await actualizarAbono(a.id, n, { valor: 1_230_000, fecha: "2030-01-01", formaPago: "Transferencia", referencia: "x", trmInput: 4200 }, {} as never);
    assert.equal(malo2.ok, false);
    assert.deepEqual(fila(abonos(n)[0]), { usd: 300, cop: 1_230_000, trm: 4100, mp: "USD" }, "nada cambió");
    const bien = await actualizarAbono(a.id, n, { valor: 1_230_000, fecha: "2030-01-01", formaPago: "Efectivo", referencia: "corregida", trmInput: 4100 }, {} as never);
    assert.equal(bien.ok, true);
    assert.deepEqual(fila(abonos(n)[0]), { usd: 300, cop: 1_230_000, trm: 4100, mp: "USD" }, "valor, TRM y moneda intactos");
    assert.equal(sql(`select referencia from public.abonos where id = ${a.id}`), "corregida");
  });

  test("Q13 la moneda del pago solo existe en contratos cobrados en USD y solo admite COP/USD; sin ella (histórico) el abono queda NULL y se lee como pesos recibidos", async () => {
    const usd = await contratoUsd();
    const r0 = await pagar(usd, 1_230_000, 4100);
    assert.equal(r0.ok, true);
    assert.equal(abonos(usd)[0].moneda_pago, null, "registrado sin moneda: igual que antes (NULL)");
    uidSesion = U.ADMIN;
    const ec = (await cargarEstadoCuenta(usd))!;
    assert.deepEqual({ cobradoCop: ec.cobradoCop, recibidoUsd: ec.recibidoUsd, mp: ec.abonos[0].moneda_pago }, { cobradoCop: 1_230_000, recibidoUsd: 0, mp: null });
    const n2 = await contratoUsd();
    const mala = await pagar(n2, 1_230_000, 4100, "EUR" as never);
    assert.equal(mala.ok, false); assert.match(mala.error ?? "", /COP o USD/);
    assert.equal(abonos(n2).length, 0);
  });

  test("Q9 compatibilidad: un contrato de oferta USD cobrado en COP con total congelado (modo anterior) conserva su interpretación; este cambio no lo reconvierte", async () => {
    uidSesion = U.ADMIN;
    const r = (await crearSolicitudReserva({
      items: [{ itemId: "h12601", modulo: "porcion_terrestre", paqueteId: 12601, hotelId: 12601, bloqueoId: null, hotelNombre: "Hotel USD 126", destino: "CARTAGENA", categoria: "Estandar", regimen: "Desayuno",
        fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0 }],
      tours: [], cliente: CLIENTE,
    } as never)) as unknown as { ok: boolean; cotizacion?: { id: number } };
    const c = (await convertirCotizacionCarrito(r.cotizacion!.id, { agrupar: "todo", pasajeros: PASAJEROS, asesorInterno: SESIONES[U.ADMIN].nombre, asignaciones: [[1, 2]], asignacionesTours: [], monedaCobro: "COP", trmCobro: 4100, trmCosto: 3900 } as never)) as { ok: boolean; numeros?: string[] };
    const n = c.numeros![0];
    const v = venta(n);
    assert.deepEqual({ mc: v.moneda_cobro, trm: num(v.trm_cobro), total: num(v.total_cobro) }, { mc: "COP", trm: 4100, total: 4_100_000 });
    const rechazo = await pagar(n, 1_230_000, undefined, "USD");
    assert.equal(rechazo.ok, false); assert.match(rechazo.error ?? "", /solo se registra en contratos cobrados en USD/);
    assert.equal(abonos(n).length, 0, "un contrato COP congelado no admite «dólares recibidos» (no cambia su interpretación)");
    assert.deepEqual(await pagar(n, 1_230_000, undefined), { ok: true }, "en cobro COP no se pide TRM por pago: sigue la TRM congelada");
    const [a] = abonos(n);
    assert.deepEqual({ v: num(a.valor_abono), cop: num(a.monto_cop), trm: num(a.trm) }, { v: 1_230_000, cop: 1_230_000, trm: 1 }, "valor en la moneda de cobro (COP), TRM 1: igual que antes");
    assert.equal(venta(n).estado, "confirmado");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// #126-A · F3 (Codex ronda 2): el registro del abono y la moneda en que llegó el dinero son UNA operación atómica (migración 313), con identidad y autorización decididas por la base.
// Todo con acciones reales + inyección de fallos en la base local; nada de una segunda petición REST ni de un reintento del usuario para clasificar el pago.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const sqlFalla = (q: string): string => { try { sql(q); return ""; } catch (e) { const x = e as { stderr?: Buffer; message?: string }; return `${x.stderr ? String(x.stderr) : ""}${x.message ?? ""}`; } };
const NUM_ABONOS = (n: string) => num(sql(`select count(*) from public.abonos where numero_contrato = '${n}'`));
const NUM_OPS = (n: string) => num(sql(`select count(*) from public.abono_operaciones where numero_contrato = '${n}'`));
const NUM_ASIENTOS = (n: string) => num(sql(`select count(*) from public.asientos_contables a join public.abonos b on a.referencia = 'abono:' || b.id and a.origen = 'abono' where b.numero_contrato = '${n}'`));
const REV = (id: number) => num(sql(`select rev from public.abonos where id = ${id}`));
const estadoVenta = (n: string) => sql(`select estado from public.ventas where numero_contrato = '${n}'`);
/** Instala una falla controlada en la base (disparador que levanta una excepción) y la retira siempre. */
async function conFalla<T>(tabla: string, cuando: string, fn: () => Promise<T>): Promise<T> {
  sql(`create or replace function public.t126_boom() returns trigger language plpgsql as $$ begin raise exception 'FALLA_INYECTADA_126'; end $$;
       drop trigger if exists t126_boom on ${tabla};
       create trigger t126_boom ${cuando} on ${tabla} for each row execute function public.t126_boom();`);
  try { return await fn(); } finally { sql(`drop trigger if exists t126_boom on ${tabla};`); }
}
const pagarOp = async (n: string, cop: number, trm: number | undefined, moneda: "COP" | "USD" | undefined, op: string) => {
  uidSesion = U.ADMIN;
  return registrarAbono(n, cop, "Transferencia", `r-${cop}-${trm}`, trm, undefined, undefined, op, {} as never, moneda);
};
const rpcDirecto = (cli: ReturnType<typeof clienteLocal>, n: string, over: Record<string, unknown> = {}) => cli.rpc("registrar_abono_moneda", {
  p_numero: n, p_tenant: "mayorista", p_actor: U.ADMIN, p_monto_cop: 1_230_000, p_trm: 4100, p_forma: "Transferencia", p_ref: "directo", p_fecha: null, p_confirmar: false, p_operacion: randomUUID(), p_moneda_pago: "USD", ...over,
});
const uidContrato = (n: string) => sql(`select contrato_uid from public.ventas where numero_contrato = '${n}'`);
const clienteConIdentidad = (n: string, uid: string) => crearClienteSupabase(PGRST, TOKEN_SERVICIO, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal, headers: { "x-contratos": JSON.stringify({ [n]: uid }) } } });

describe("#126-A F3 · el pago y su moneda son UNA operación atómica de la base (migración 313)", () => {
  test("R1 interrupción: si algo falla después de insertar el abono, NO queda abono, ni operación, ni fila sin moneda; el reintento idéntico lo registra con USD", async () => {
    const n = await contratoUsd();
    const op = randomUUID();
    const cop = copDeUsdNativo(300, 4100)!;
    const r = await conFalla("public.abono_operaciones", "before insert", () => pagarOp(n, cop, 4100, "USD", op));
    assert.equal(r.ok, false); assert.match(r.error ?? "", /FALLA_INYECTADA_126/);
    assert.deepEqual({ abonos: NUM_ABONOS(n), ops: NUM_OPS(n), asientos: NUM_ASIENTOS(n) }, { abonos: 0, ops: 0, asientos: 0 }, "todo o nada: ni siquiera un abono sin clasificar");
    assert.deepEqual(await pagarOp(n, cop, 4100, "USD", op), { ok: true });
    assert.deepEqual(abonos(n).map(fila), [{ usd: 300, cop: 1_230_000, trm: 4100, mp: "USD" }]);
    assert.equal(NUM_OPS(n), 1);
  });

  test("R2 fallo contable con el pago YA registrado: el abono queda con su moneda (no NULL); reintento idéntico completa el asiento una sola vez; reintento con OTRA moneda se rechaza y NO escribe el asiento", async () => {
    const n = await contratoUsd();
    const op = randomUUID();
    const cop = copDeUsdNativo(300, 4100)!;
    const r = await conFalla("public.asientos_contables", "before insert", () => pagarOp(n, cop, 4100, "USD", op));
    assert.equal(r.ok, false); assert.match(r.error ?? "", /asiento contable/);
    const [a] = abonos(n);
    assert.deepEqual(fila(a), { usd: 300, cop: 1_230_000, trm: 4100, mp: "USD" }, "el pago quedó registrado Y clasificado en la misma transacción: no depende de un reintento");
    assert.equal(NUM_ASIENTOS(n), 0);
    const rev = REV(a.id);
    const conflicto = await pagarOp(n, cop, 4100, "COP", op);
    assert.equal(conflicto.ok, false); assert.match(conflicto.error ?? "", /otra moneda de pago/);
    assert.deepEqual({ asientos: NUM_ASIENTOS(n), mp: abonos(n)[0].moneda_pago, rev: REV(a.id), abonos: NUM_ABONOS(n) }, { asientos: 0, mp: "USD", rev, abonos: 1 }, "el rechazo revierte hasta el reintento de asiento");
    assert.deepEqual(await pagarOp(n, cop, 4100, "USD", op), { ok: true });
    assert.deepEqual({ asientos: NUM_ASIENTOS(n), debe: asientoAbono(a.id), abonos: NUM_ABONOS(n), ops: NUM_OPS(n) }, { asientos: 1, debe: 1_230_000, abonos: 1, ops: 1 });
  });

  test("R3 fallo de confirmación con el pago ya registrado: abono clasificado USD, contrato sigue pendiente; reintento idéntico confirma sin duplicar", async () => {
    const n = await contratoUsd();
    const op = randomUUID();
    const cop = copDeUsdNativo(300, 4100)!;
    const r = await conFalla("public.ventas", "before update", () => pagarOp(n, cop, 4100, "USD", op));
    assert.equal(r.ok, false);
    assert.equal(r.confirmacionPendiente, true, r.error);
    assert.deepEqual({ abonos: NUM_ABONOS(n), mp: abonos(n)[0]?.moneda_pago, estado: estadoVenta(n) }, { abonos: 1, mp: "USD", estado: "pendiente" });
    assert.deepEqual(await pagarOp(n, cop, 4100, "USD", op), { ok: true });
    assert.deepEqual({ abonos: NUM_ABONOS(n), mp: abonos(n)[0].moneda_pago, estado: estadoVenta(n), ops: NUM_OPS(n) }, { abonos: 1, mp: "USD", estado: "confirmado", ops: 1 });
  });

  test("R4 repetición IDÉNTICA devuelve el resultado original; repetición con moneda distinta (COP, sin moneda) se rechaza y no cambia nada; un abono histórico NULL no se reclasifica", async () => {
    const n = await contratoUsd();
    const op = randomUUID();
    const cop = copDeUsdNativo(300, 4100)!;
    assert.deepEqual(await pagarOp(n, cop, 4100, "USD", op), { ok: true });
    assert.deepEqual(await pagarOp(n, cop, 4100, "USD", op), { ok: true }, "idéntica: mismo resultado");
    for (const otra of ["COP", undefined] as const) {
      const x = await pagarOp(n, cop, 4100, otra, op);
      assert.equal(x.ok, false, String(otra)); assert.match(x.error ?? "", /otra moneda de pago/);
    }
    assert.deepEqual({ abonos: NUM_ABONOS(n), ops: NUM_OPS(n), mp: abonos(n)[0].moneda_pago }, { abonos: 1, ops: 1, mp: "USD" });

    const h = await contratoUsd();       // «histórico»: registrado sin moneda (como antes de esta migración)
    const op2 = randomUUID();
    assert.deepEqual(await pagarOp(h, 1_230_000, 4100, undefined, op2), { ok: true });
    assert.equal(abonos(h)[0].moneda_pago, null);
    assert.deepEqual(await pagarOp(h, 1_230_000, 4100, undefined, op2), { ok: true }, "idéntica (sin moneda)");
    const nuevo = await pagarOp(h, 1_230_000, 4100, "USD", op2);
    assert.equal(nuevo.ok, false); assert.match(nuevo.error ?? "", /sin moneda/);
    assert.equal(abonos(h)[0].moneda_pago, null, "NULL histórico se conserva: no se «completa» después");
  });

  test("R5 la moneda es inmutable en la base: ni UPDATE directo ni fila NULL reclasificada; otros campos del abono siguen editándose", async () => {
    const n = await contratoUsd();
    await pagarOp(n, copDeUsdNativo(300, 4100)!, 4100, "USD", randomUUID());
    const [a] = abonos(n);
    assert.match(sqlFalla(`update public.abonos set moneda_pago = 'COP' where id = ${a.id}`), /FIN_MONEDA_INMUTABLE/);
    assert.match(sqlFalla(`update public.abonos set moneda_pago = null where id = ${a.id}`), /FIN_MONEDA_INMUTABLE/);
    const h = await contratoUsd();
    await pagarOp(h, 1_230_000, 4100, undefined, randomUUID());
    const [b] = abonos(h);
    assert.match(sqlFalla(`update public.abonos set moneda_pago = 'USD' where id = ${b.id}`), /FIN_MONEDA_INMUTABLE/, "NULL histórico no se completa por UPDATE");
    assert.equal(sqlFalla(`update public.abonos set referencia = 'otra' where id = ${a.id}`), "", "los demás campos no se bloquean");
    assert.deepEqual([abonos(n)[0].moneda_pago, abonos(h)[0].moneda_pago], ["USD", null]);
  });

  test("R6 autorización e identidad las decide la base: anon/authenticated no ejecutan; un actor sin rol contable se rechaza; identidad de contrato errónea se rechaza; la correcta registra con USD", async () => {
    const n = await contratoUsd();
    const anon = await rpcDirecto(clienteLocal(jwt({ role: "anon" })), n);
    const auth = await rpcDirecto(clienteLocal(jwt({ role: "authenticated", sub: U.ADMIN })), n);
    for (const x of [anon, auth]) { assert.ok(x.error, "debe fallar"); assert.match(`${x.error?.code} ${x.error?.message}`, /42501|permission denied/i); }
    const sinRol = await rpcDirecto(clienteLocal(TOKEN_SERVICIO), n, { p_actor: U.VENTA });
    assert.ok(sinRol.error, "un asesor no registra abonos"); assert.equal(NUM_ABONOS(n), 0);
    const otraAgencia = await rpcDirecto(clienteLocal(TOKEN_SERVICIO), n, { p_tenant: "minorista" });
    assert.ok(otraAgencia.error, "la agencia pedida debe ser la del contrato"); assert.equal(NUM_ABONOS(n), 0);
    const mala = await rpcDirecto(clienteConIdentidad(n, randomUUID()), n);
    assert.equal(mala.error?.code, "F4601", mala.error?.message); assert.equal(NUM_ABONOS(n), 0, "identidad de otro contrato: nada se escribe");
    const op = randomUUID();
    const buena = await rpcDirecto(clienteConIdentidad(n, uidContrato(n)), n, { p_operacion: op });
    assert.equal(buena.error, null, buena.error?.message);
    assert.equal((buena.data as { estado: string }).estado, "registrado");
    assert.deepEqual(abonos(n).map(fila), [{ usd: 300, cop: 1_230_000, trm: 4100, mp: "USD" }]);
    const rep = await rpcDirecto(clienteConIdentidad(n, randomUUID()), n, { p_operacion: op });
    assert.equal(rep.error?.code, "F4601", "una repetición con identidad ajena también se rechaza");
    const repOtra = await rpcDirecto(clienteConIdentidad(n, uidContrato(n)), n, { p_operacion: op, p_moneda_pago: "COP" });
    assert.equal(repOtra.error?.code, "F4472");
    assert.equal(NUM_ABONOS(n), 1);
  });

  test("R7 validación en la base: moneda inválida y moneda en un contrato cobrado en COP se rechazan sin escribir nada (no solo en la acción)", async () => {
    const n = await contratoUsd();
    const eur = await rpcDirecto(clienteLocal(TOKEN_SERVICIO), n, { p_moneda_pago: "EUR" });
    assert.equal(eur.error?.code, "F4470"); assert.equal(NUM_ABONOS(n), 0);
    uidSesion = U.ADMIN;
    const r = (await crearSolicitudReserva({
      items: [{ itemId: "h12601", modulo: "porcion_terrestre", paqueteId: 12601, hotelId: 12601, bloqueoId: null, hotelNombre: "Hotel USD 126", destino: "CARTAGENA", categoria: "Estandar", regimen: "Desayuno",
        fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0 }],
      tours: [], cliente: CLIENTE,
    } as never)) as unknown as { ok: boolean; cotizacion?: { id: number } };
    const c = (await convertirCotizacionCarrito(r.cotizacion!.id, { agrupar: "todo", pasajeros: PASAJEROS, asesorInterno: SESIONES[U.ADMIN].nombre, asignaciones: [[1, 2]], asignacionesTours: [], monedaCobro: "COP", trmCobro: 4100, trmCosto: 3900 } as never)) as { ok: boolean; numeros?: string[] };
    const cop = c.numeros![0];
    const x = await rpcDirecto(clienteLocal(TOKEN_SERVICIO), cop, { p_trm: null, p_moneda_pago: "USD", p_monto_cop: 1_230_000 });
    assert.equal(x.error?.code, "F4471", x.error?.message);
    assert.deepEqual({ abonos: NUM_ABONOS(cop), ops: NUM_OPS(cop) }, { abonos: 0, ops: 0 }, "rechazo total: tampoco queda abono ni operación");
    const ok = await rpcDirecto(clienteLocal(TOKEN_SERVICIO), cop, { p_trm: null, p_moneda_pago: null, p_monto_cop: 1_230_000 });
    assert.equal(ok.error, null, ok.error?.message);
    assert.equal(abonos(cop)[0].moneda_pago, null, "sin moneda: igual que siempre");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// #126-A · F5 (Codex ronda 3): el rollback de la 312 NO destruye clasificaciones de moneda. Se ejecuta el script ENTREGADO (supabase/scripts/rollback_312_abono_moneda_pago.sql).
//  · seguro: sin clasificaciones (y sin la 313) procede, y los abonos históricos quedan idénticos;
//  · rehúsa: con pagos clasificados USD / mixtos, o con la 313 aplicada; y el rechazo deja esquema y filas intactos (misma huella antes y después).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const RUTA_SCRIPTS = new URL("../supabase/scripts/", import.meta.url);
const ROLLBACK_312 = readFileSync(new URL("rollback_312_abono_moneda_pago.sql", RUTA_SCRIPTS), "utf8");
const MIGRACION = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), "utf8");
const MIG_312 = MIGRACION("20260601000312_abono_moneda_pago.sql");
const MIG_313 = MIGRACION("20260601000313_registrar_abono_moneda_atomico.sql");
const ROLLBACK_313 = readFileSync(new URL("rollback_313_registrar_abono_moneda.sql", RUTA_SCRIPTS), "utf8");
const PLANTILLA = process.env.PG126_PLANTILLA ?? "plantilla304";
const psqlEn = (db: string, q: string) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", db, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const falla = (db: string, q: string): string => { try { psqlEn(db, q); return ""; } catch (e) { const x = e as { stderr?: Buffer; message?: string }; return `${x.stderr ? String(x.stderr) : ""}${x.message ?? ""}`; } };
/** Base desechable (copia de la plantilla de esquema) con la 312 y, si se pide, la 313; se borra siempre al terminar. */
async function conBaseDesechable<T>(con313: boolean, fn: (db: string) => Promise<T> | T): Promise<T> {
  const db = `t312rb_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
  psqlEn("postgres", `create database ${db} template ${PLANTILLA}`);
  try {
    psqlEn(db, MIG_312);
    if (con313) psqlEn(db, MIG_313);
    return await fn(db);
  } finally {
    try { psqlEn("postgres", `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${db}' and pid <> pg_backend_pid()`); psqlEn("postgres", `drop database if exists ${db}`); } catch { /* best effort */ }
  }
}
const huellaEsquemaYFilas = (db: string) => psqlEn(db, `select md5(
    (select coalesce(string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position), '') from information_schema.columns where table_schema = 'public' and table_name = 'abonos')
    || '#' || (select coalesce(string_agg(conname || pg_get_constraintdef(oid), ';' order by conname), '') from pg_constraint where conrelid = 'public.abonos'::regclass)
    || '#' || (select coalesce(string_agg(t::text, '|' order by id), '') from public.abonos t))`);
const sembrarVenta = (n: string) => `insert into public.ventas (numero_contrato, cliente, moneda) values ('${n}', 'Cliente rollback', 'USD');`;
const columnaExiste = (db: string) => num(psqlEn(db, `select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'abonos' and column_name = 'moneda_pago'`));
const constraintExiste = (db: string) => num(psqlEn(db, `select count(*) from pg_constraint where conname = 'abonos_moneda_pago_check'`));
const filasHistoricas = (db: string) => psqlEn(db, `select string_agg(id || ':' || valor_abono || ':' || monto_cop || ':' || trm || ':' || coalesce(referencia, ''), '|' order by id) from public.abonos`);

describe("#126-A F5 · rollback de la 312: nunca destruye clasificaciones de moneda", () => {
  test("S1 rollback SEGURO: sin clasificaciones y sin la 313 procede; los abonos históricos (moneda_pago NULL) quedan idénticos", async () => {
    await conBaseDesechable(false, (db) => {
      psqlEn(db, `${sembrarVenta("DTM-9001")} insert into public.abonos (numero_contrato, valor_abono, monto_cop, trm, forma_pago, referencia) values ('DTM-9001', 1230000, 1230000, 1, 'Transferencia', 'historico-1'), ('DTM-9001', 500000, 500000, 1, 'Efectivo', 'historico-2')`);
      const antes = filasHistoricas(db);
      assert.equal(columnaExiste(db), 1); assert.equal(constraintExiste(db), 1);
      assert.equal(falla(db, ROLLBACK_312), "", "debe proceder");
      assert.deepEqual([columnaExiste(db), constraintExiste(db)], [0, 0], "columna y restricción retiradas");
      assert.equal(filasHistoricas(db), antes, "los abonos históricos quedan idénticos");
      assert.equal(falla(db, ROLLBACK_312), "", "re-ejecutarlo sin columna tampoco falla");
    });
  });

  test("S2 rollback seguro de la cadena completa: 313 primero, luego 312, sin clasificaciones", async () => {
    await conBaseDesechable(true, (db) => {
      psqlEn(db, `${sembrarVenta("DTM-9002")} insert into public.abonos (numero_contrato, valor_abono, monto_cop, trm) values ('DTM-9002', 100, 100, 1)`);
      assert.equal(falla(db, ROLLBACK_313), "");
      assert.equal(falla(db, ROLLBACK_312), "");
      assert.deepEqual([columnaExiste(db), constraintExiste(db)], [0, 0]);
      assert.equal(num(psqlEn(db, `select count(*) from public.abonos`)), 1);
    });
  });

  test("R-A REHÚSA con pagos clasificados USD y mixtos (USD 300 recibidos + COP 2.940.000 recibidos a 4.200): esquema y filas intactos", async () => {
    await conBaseDesechable(false, (db) => {
      psqlEn(db, `${sembrarVenta("DTM-9003")} insert into public.abonos (numero_contrato, valor_abono, monto_cop, trm, moneda_pago, referencia) values
        ('DTM-9003', 300, 1230000, 4100, 'USD', 'nativo-usd'), ('DTM-9003', 700, 2940000, 4200, 'COP', 'pesos-a-4200')`);
      const antes = huellaEsquemaYFilas(db);
      const e = falla(db, ROLLBACK_312);
      assert.match(e, /ROLLBACK 312 RECHAZADO/); assert.match(e, /2 abono\(s\) ya tienen moneda_pago/);
      assert.match(e, /No se cambió nada/); assert.match(e, /corrección hacia adelante|conservación\/recuperación/);
      assert.equal(huellaEsquemaYFilas(db), antes, "misma huella de esquema + filas antes y después");
      assert.deepEqual([columnaExiste(db), constraintExiste(db)], [1, 1]);
      assert.equal(psqlEn(db, `select string_agg(moneda_pago, ',' order by id) from public.abonos`), "USD,COP", "las clasificaciones siguen ahí");
    });
  });

  test("R-B REHÚSA incluso con UN solo pago nativo en USD (el caso que reinterpretaría el equivalente contable como pesos recibidos)", async () => {
    await conBaseDesechable(false, (db) => {
      psqlEn(db, `${sembrarVenta("DTM-9004")} insert into public.abonos (numero_contrato, valor_abono, monto_cop, trm, moneda_pago) values ('DTM-9004', 300, 1230000, 4100, 'USD')`);
      const antes = huellaEsquemaYFilas(db);
      assert.match(falla(db, ROLLBACK_312), /1 abono\(s\) ya tienen moneda_pago/);
      assert.equal(huellaEsquemaYFilas(db), antes);
      assert.equal(psqlEn(db, `select moneda_pago from public.abonos`), "USD");
    });
  });

  test("R-C REHÚSA mientras la 313 siga aplicada (su disparador lee la columna): con pagos REALES registrados por las acciones, el rechazo no toca nada", async () => {
    const n = await contratoUsd();
    await pagar(n, copDeUsdNativo(300, 4100)!, 4100, "USD");
    await pagar(n, 2_940_000, 4200, "COP");
    const antes = huellaEsquemaYFilas(DB);
    const e = falla(DB, ROLLBACK_312);
    assert.match(e, /ROLLBACK 312 RECHAZADO/); assert.match(e, /313 sigue aplicada/);
    assert.equal(huellaEsquemaYFilas(DB), antes, "esquema y filas intactos en la base de las acciones reales");
    assert.deepEqual(abonos(n).map((a) => a.moneda_pago), ["USD", "COP"]);
    uidSesion = U.ADMIN;
    const ec = (await cargarEstadoCuenta(n))!;
    assert.deepEqual({ cobradoCop: ec.cobradoCop, recibidoUsd: ec.recibidoUsd }, { cobradoCop: 2_940_000, recibidoUsd: 300 }, "los documentos siguen distinguiendo dólares de pesos");
  });

  test("R-D con la 313 aplicada y SIN clasificaciones, sigue rehusando (el orden correcto es 313 → 312)", async () => {
    await conBaseDesechable(true, (db) => {
      const antes = huellaEsquemaYFilas(db);
      assert.match(falla(db, ROLLBACK_312), /313 sigue aplicada/);
      assert.equal(huellaEsquemaYFilas(db), antes);
      assert.equal(psqlEn(db, `select count(*) from pg_trigger where tgname = 'trg_f313_abonos_moneda' and not tgisinternal`), "1");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// #126-A · F5 (Codex ronda 4): CONCURRENCIA del rollback de la 312. Dos conexiones reales, secuencia determinista (marcas \echo de psql + pg_stat_activity), nada de «dormir y esperar suerte».
//  · T1 el escenario de Codex: el script instrumentado hace una pausa DESPUÉS de las guardas y ANTES del DROP; un INSERT clasificado concurrente NO puede confirmarse en esa ventana (espera el bloqueo)
//    y, al terminar el rollback, falla con error explícito: ninguna clasificación se pierde en silencio.
//  · T2 un INSERT clasificado EN CURSO (sin confirmar) cuando arranca el rollback: el script espera, ve la fila confirmada y REHÚSA; esquema y fila intactos. (Con el script anterior las guardas no veían la
//    fila sin confirmar y el DROP se llevaba la moneda.)
//  · T3 si el bloqueo no se obtiene en el plazo (lock_timeout 5 s), el script FALLA y no cambia nada.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function psqlAsync(db: string, input: string) {
  const child = spawn("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", db, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  const esperando: Array<{ texto: string; ok: () => void }> = [];
  child.stdout.on("data", (b) => { out += b; for (const m of [...esperando]) if (out.includes(m.texto)) { esperando.splice(esperando.indexOf(m), 1); m.ok(); } });
  child.stderr.on("data", (b) => { err += b; });
  const fin = new Promise<number>((res, rej) => { child.on("error", rej); child.on("close", (c) => res(c ?? -1)); });
  child.stdin.end(input);
  const marca = (texto: string, ms = 20000) => new Promise<void>((res, rej) => {
    if (out.includes(texto)) return res();
    const t = setTimeout(() => rej(new Error(`no llegó la marca ${texto}; salida=${out}; error=${err}`)), ms);
    esperando.push({ texto, ok: () => { clearTimeout(t); res(); } });
  });
  return { fin, marca, salida: () => out, errores: () => err };
}
/** Espera (sondeando una conexión APARTE) a que alguna sesión de `db` esté bloqueada esperando un candado y su consulta empiece por `inicio`. */
async function esperaBloqueada(db: string, inicio: string, ms = 8000): Promise<boolean> {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    const n = num(psqlEn("postgres", `select count(*) from pg_stat_activity where datname = '${db}' and wait_event_type = 'Lock' and query ilike '${inicio.replace(/'/g, "''")}%'`));
    if (n > 0) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
const INSERT_CLASIFICADO = (n: string) => `insert into public.abonos (numero_contrato, valor_abono, monto_cop, trm, moneda_pago, referencia) values ('${n}', 300, 1230000, 4100, 'USD', 'concurrente');`;

describe("#126-A F5 · rollback de la 312 bajo concurrencia: una clasificación confirmada nunca se pierde en silencio", () => {
  test("T1 escenario de Codex: pausa tras las guardas; el INSERT clasificado concurrente queda ESPERANDO el bloqueo y falla al terminar el rollback (no se confirma sin su moneda)", async () => {
    await conBaseDesechable(false, async (db) => {
      psqlEn(db, sembrarVenta("DTM-9101"));
      const instrumentado = ROLLBACK_312.replace("alter table public.abonos drop constraint", "\\echo GUARDAS_LISTAS\nselect pg_sleep(3);\nalter table public.abonos drop constraint");
      assert.notEqual(instrumentado, ROLLBACK_312, "la instrumentación debe aplicarse");
      const A = psqlAsync(db, instrumentado);
      await A.marca("GUARDAS_LISTAS");                                      // el script ya pasó TODAS las guardas y está por ejecutar el DROP
      const B = psqlAsync(db, INSERT_CLASIFICADO("DTM-9101"));              // escritor concurrente, clasificado
      assert.equal(await esperaBloqueada(db, "insert into public.abonos"), true, "el INSERT debe quedar esperando el candado del rollback (no confirmarse en la ventana)");
      assert.equal(await A.fin, 0, `rollback: ${A.errores()}`);
      assert.notEqual(await B.fin, 0, "el INSERT clasificado no puede confirmarse una vez retirada la columna");
      assert.match(B.errores(), /moneda_pago/, "falla con un error explícito sobre la columna");
      assert.equal(columnaExiste(db), 0);
      assert.equal(num(psqlEn(db, "select count(*) from public.abonos")), 0, "no quedó un pago confirmado que haya perdido su clasificación");
    });
  });

  test("T2 INSERT clasificado EN CURSO al arrancar el rollback: el script espera, ve la fila confirmada y REHÚSA; esquema y fila intactos", async () => {
    await conBaseDesechable(false, async (db) => {
      psqlEn(db, sembrarVenta("DTM-9102"));
      const H = psqlAsync(db, `begin;\n${INSERT_CLASIFICADO("DTM-9102")}\n\\echo INSERT_EN_CURSO\nselect pg_sleep(3);\ncommit;\n\\echo CONFIRMADO\n`);
      await H.marca("INSERT_EN_CURSO");                                      // fila clasificada insertada y SIN confirmar (invisible para las guardas)
      const A = psqlAsync(db, ROLLBACK_312);
      assert.equal(await esperaBloqueada(db, "lock table public.abonos"), true, "el rollback debe esperar el bloqueo mientras el INSERT sigue en curso");
      assert.equal(await H.fin, 0, H.errores());
      assert.notEqual(await A.fin, 0, "el rollback debe rehusar");
      assert.match(A.errores(), /ROLLBACK 312 RECHAZADO/); assert.match(A.errores(), /1 abono\(s\) ya tienen moneda_pago/);
      assert.deepEqual([columnaExiste(db), constraintExiste(db)], [1, 1]);
      assert.equal(psqlEn(db, "select moneda_pago from public.abonos"), "USD", "la clasificación confirmada sigue ahí");
    });
  });

  test("T3 si el bloqueo no se obtiene en el plazo, el script FALLA y no cambia nada (esquema y filas intactos)", async () => {
    await conBaseDesechable(false, async (db) => {
      psqlEn(db, sembrarVenta("DTM-9103"));
      const H = psqlAsync(db, `begin;\ninsert into public.abonos (numero_contrato, valor_abono, monto_cop, trm, referencia) values ('DTM-9103', 100, 100, 1, 'sin-moneda');\n\\echo ESCRITOR_ACTIVO\nselect pg_sleep(8);\ncommit;\n`);
      await H.marca("ESCRITOR_ACTIVO");
      const inicio = Date.now();
      const A = psqlAsync(db, ROLLBACK_312);
      const codigo = await A.fin;
      const espera = Date.now() - inicio;
      assert.notEqual(codigo, 0, "sin bloqueo, el script falla");
      assert.match(A.errores(), /lock timeout|tiempo de espera|bloqueo/i, A.errores());
      assert.ok(espera >= 4500 && espera < 8000, `esperó ~5 s y desistió antes de que el escritor terminara (${espera} ms)`);
      assert.equal(await H.fin, 0, H.errores());
      assert.deepEqual([columnaExiste(db), constraintExiste(db)], [1, 1], "columna y restricción intactas");
      assert.equal(num(psqlEn(db, "select count(*) from public.abonos")), 1, "la fila del escritor se confirmó normalmente");
    });
  });

  test("T4 sin concurrencia el rollback seguro sigue procediendo y las guardas de clasificación y de la 313 siguen activas (regresión de S1/R-A/R-D)", async () => {
    await conBaseDesechable(false, (db) => { assert.equal(falla(db, ROLLBACK_312), ""); assert.deepEqual([columnaExiste(db), constraintExiste(db)], [0, 0]); });
    await conBaseDesechable(true, (db) => { assert.match(falla(db, ROLLBACK_312), /313 sigue aplicada/); });
    await conBaseDesechable(false, (db) => {
      psqlEn(db, `${sembrarVenta("DTM-9104")} ${INSERT_CLASIFICADO("DTM-9104")}`);
      assert.match(falla(db, ROLLBACK_312), /1 abono\(s\) ya tienen moneda_pago/);
    });
  });
});
