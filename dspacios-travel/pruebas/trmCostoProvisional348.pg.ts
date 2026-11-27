// NETA-05/06 (migración 348) — la TRM de costos PROVISIONAL de las obligaciones previstas se corrige tras guardar el contrato (solo pendiente). Trayecto REAL por HTTP: convertirCotizacionCarrito → PostgREST → Postgres,
// confirmarVenta y corregirTrmCostoPrevista (acciones reales). Solo se simula el motor de PRECIOS y la sesión. Base local desechable.
// SOLO base local desechable: la lanza supabase/scripts/test_348_trm_costo_provisional.sh (no corre en `npm run test:*`).
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
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PGTC_BASE (desechable), PGTC_POSTGREST y PGTC_JWT_SECRET: usa supabase/scripts/test_348_trm_costo_provisional.sh.");

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


// ───────────────────────────── NETA-05/06 · TRM de costos PROVISIONAL (migración 348) ─────────────────────────────
// Importes esperados calculados a mano: aéreo USD 100 × 2 pax = USD 200 · 200 × 3.900 = 780.000 · 200 × 4.100 = 820.000 · 200 × 4.200 = 840.000.
const { corregirTrmCostoPrevista } = await import("../app/(dashboard)/dashboard/contratos/[numero]/trm-costo-actions.ts");

const UID_VENTA = "00000000-0000-0000-0000-000000480010";
const UID_MIN = "00000000-0000-0000-0000-000000480011";
const BLOQUEOS_USD = Array.from({ length: 20 }, (_, i) => 4811 + i); // cada contrato consume 2 de las 4 sillas de un bloqueo propio

before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_VENTA}', 'venta-tc@x.test'), ('${UID_MIN}', 'min-tc@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
      ('${UID_VENTA}', 'venta-tc@x.test', 'Venta TC', 'venta', true, 'mayorista'),
      ('${UID_MIN}', 'min-tc@x.test', 'Admin Minorista TC', 'administracion', true, 'minorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    ${BLOQUEOS_USD.map((b, i) => `insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, proveedor_id, destino_id, fecha_ida, fecha_regreso, cupos_total, tarifa_neta, tarifa_para_empaquetar, fee_infante, moneda)
      values (${b}, 'TC${b}', 'Avianca', 'BOG-CTG', 4802, 4801, '2030-03-01', '2030-03-04', 4, 100, 120, 0, 'USD') on conflict do nothing;
      insert into public.sillas (bloqueo_id, numero_silla, estado) select ${b}, n, 'disponible' from generate_series(1, 4) n;`).join("\n")}
  `);
});

let sigBloqueo = 0;
/** Contrato PENDIENTE en USD (bloqueo neta 100 × 2 pax) con la TRM de costos de la conversión; devuelve su número. */
async function contratoUsd(trmCosto = 3900): Promise<string> {
  const b = BLOQUEOS_USD[sigBloqueo++];
  assert.ok(b, "faltan bloqueos de prueba");
  const id = cotizacion("USD", [itemBloqueo(4802, b, 4802)]);
  const r = await convertir(id, { monedaCobro: "USD", trmCosto });
  assert.equal(r.ok, true, r.error);
  return r.numeros![0];
}
const ident = (numero: string) => identidadDe(numero, sql(`select contrato_uid from public.ventas where numero_contrato = ${lit(numero)}`));
const corregir = (numero: string, trmNueva: unknown, esperada: number, clave: string | null = null, nota = "") => {
  return corregirTrmCostoPrevista(numero, ident(numero), clave, trmNueva, esperada, nota);
};
const par = (numero: string, tipo = "aereo") => fila(`select payload->>'trm_costo', payload->>'valor_cop_costo', payload->>'valor_total' from public.contrato_obligaciones_previstas where numero_contrato = ${lit(numero)} and payload->>'tipo_proveedor' = '${tipo}'`).map(Number);
const hist = (numero: string) => sql(`select string_agg(trm_anterior || '>' || trm_nueva || '|' || valor_cop_anterior || '>' || valor_cop_nuevo || '|' || coalesce(nota, '-') || '|' || actor, ';' order by id) from public.contrato_trm_costo_historial where numero_contrato = ${lit(numero)}`);
const nHist = (numero: string) => Number(sql(`select count(*) from public.contrato_trm_costo_historial where numero_contrato = ${lit(numero)}`));
const huella = (excepto: string) => sql(`select md5(coalesce((select string_agg(c::text, '|' order by id) from public.cuentas_por_pagar c where numero_contrato <> ${lit(excepto)}), '') || '#' || coalesce((select string_agg(p::text, '|' order by id) from public.contrato_obligaciones_previstas p where numero_contrato <> ${lit(excepto)}), ''))`);

describe("NETA-05/06 · corregir la TRM de costos PROVISIONAL de las obligaciones previstas (acciones reales → PostgREST → Postgres)", () => {
  test("T1 (NETA-05) USD neta 100 / reventa 120 / TRM de costos 3.900 → costo aéreo USD 200 ≈ COP 780.000; sin CxP todavía", async () => {
    const n = await contratoUsd(3900);
    assert.equal(Number(sql(`select costo_aereo from public.ventas where numero_contrato = ${lit(n)}`)), 200);
    assert.deepEqual(par(n), [3900, 780000, 200]);
    assert.equal(cxpDe(n), "");
  });

  test("T2 corregir a 4.100 después de guardar: equivalente 820.000, historial con actor/antes/después, y NADA más cambia (ventas, CxP, asientos, otros contratos)", async () => {
    const n = await contratoUsd(3900);
    const ventaAntes = sql(`select md5(v::text) from public.ventas v where numero_contrato = ${lit(n)}`);
    const otros = huella(n);
    const asientos = sql("select count(*) from public.asientos_contables");
    const r = await corregir(n, "4100", 3900, null, "TRM acordada con la aerolínea");
    assert.deepEqual(r, { ok: true, cambiadas: 2, trmNueva: 4100 }, "las dos previstas en USD (hotel y aéreo) comparten la TRM");
    assert.deepEqual(par(n), [4100, 820000, 200]);
    assert.equal(hist(n)?.split(";").length, 2);
    assert.match(hist(n), new RegExp(`3900\\.0000>4100\\.0000\\|780000\\.00>820000\\.00\\|TRM acordada con la aerolínea\\|${UID_ADMIN}`));
    assert.equal(sql(`select md5(v::text) from public.ventas v where numero_contrato = ${lit(n)}`), ventaAntes, "la venta (precio y costos, que están en USD) no cambia");
    assert.equal(cxpDe(n), "", "sigue sin CxP: es una previsión");
    assert.equal(sql("select count(*) from public.asientos_contables"), asientos, "ningún asiento");
    assert.equal(huella(n), otros, "ningún otro contrato ni CxP histórica se toca");
  });

  test("T3 compara-y-cambia: con la TRM vieja que ya no es la vigente se rechaza y nada cambia; la misma TRM no cambia ni registra historial", async () => {
    const n = await contratoUsd(3900);
    assert.equal((await corregir(n, "4100", 3900)).ok, true);
    const h0 = nHist(n);
    const rancia = await corregir(n, "4300", 3900);
    assert.equal(rancia.ok, false);
    assert.match((rancia as { error: string }).error, /cambió mientras la editabas/);
    assert.deepEqual(par(n), [4100, 820000, 200]);
    const igual = await corregir(n, "4100", 4100);
    assert.deepEqual(igual, { ok: true, cambiadas: 0, trmNueva: 4100 });
    assert.equal(nHist(n), h0, "sin cambio no hay historial");
  });

  test("T4 al confirmar, la CxP nace con la TRM CORREGIDA (4.100) y el devengo contable es 820.000; después la base la congela (Z9610) y la acción se niega", async () => {
    const n = await contratoUsd(3900);
    await corregir(n, "4100", 3900);
    await confirmar(n);
    assert.match(cxpDe(n), /aereo\|Aerolínea BN\|200\.00\|USD\|820000\.00\|4100\.0000/);
    assert.equal(asientoAereo(n), "820000.00/820000.00");
    const despues = await corregir(n, "4200", 4100);
    assert.equal(despues.ok, false);
    assert.match((despues as { error: string }).error, /mientras el contrato está pendiente/);
    assert.match(cxpDe(n), /aereo\|Aerolínea BN\|200\.00\|USD\|820000\.00\|4100\.0000/, "la CxP confirmada no cambió");
    assert.throws(() => sql(`update public.cuentas_por_pagar set trm_costo = 4200, valor_cop_costo = 840000 where numero_contrato = ${lit(n)} and tipo_proveedor = 'aereo'`), /cxp_costo_inmutable|Z9610/);
  });

  test("T5 roles y agencia: venta, agencia (aliado) y administración de OTRA agencia no pueden; nada cambia", async () => {
    const n = await contratoUsd(3900);
    for (const [uid, rol] of [[UID_VENTA, "venta"], [UID_AGENCIA, "agencia"], [UID_MIN, "administración de minorista"]] as const) {
      uidSesion = uid;
      const r = await corregir(n, "4100", 3900);
      assert.equal(r.ok, false, `${rol} no debe poder`);
      assert.deepEqual(par(n), [3900, 780000, 200], `${rol}: la TRM sigue igual`);
    }
    uidSesion = UID_ADMIN;
    assert.equal(nHist(n), 0);
  });

  test("T6 defensa en la base: la RPC no la ejecuta un usuario autenticado, y con service_role un actor sin rol permitido (venta) o de otra agencia es rechazado", async () => {
    const n = await contratoUsd(3900);
    const args = (actor: string) => ({ p_numero: n, p_tenant: "mayorista", p_actor: actor, p_clave: null, p_trm_nueva: 4100, p_trm_esperada: 3900, p_nota: null });
    const auth = await clienteSesion().rpc("prevista_trm_costo_actualizar", args(UID_ADMIN));
    assert.ok(auth.error, "authenticated no puede llamar la RPC");
    for (const actor of [UID_VENTA, UID_AGENCIA, UID_MIN]) {
      const r = await clienteLocal(TOKEN_SERVICIO).rpc("prevista_trm_costo_actualizar", args(actor));
      assert.ok(r.error, `actor ${actor} debe ser rechazado`);
    }
    assert.deepEqual(par(n), [3900, 780000, 200]);
    assert.equal(nHist(n), 0);
  });

  test("T7 TRM inválida (0, negativa, texto, ≥ 1e11) o vacía: se rechaza antes de tocar la base; contrato en COP: no hay previstas en USD que corregir", async () => {
    const n = await contratoUsd(3900);
    for (const mala of ["0", "-5", "abc", "", "100000000000", null]) {
      const r = await corregir(n, mala, 3900);
      assert.equal(r.ok, false, `TRM ${String(mala)}`);
    }
    const directa = await clienteLocal(TOKEN_SERVICIO).rpc("prevista_trm_costo_actualizar", { p_numero: n, p_tenant: "mayorista", p_actor: UID_ADMIN, p_clave: null, p_trm_nueva: 0, p_trm_esperada: 3900, p_nota: null });
    assert.ok(directa.error, "la base también rechaza 0");
    assert.deepEqual(par(n), [3900, 780000, 200]);
    const idCop = cotizacion("COP", [itemBloqueo(4801, B_COP2, 4801)]);
    const rCop = await convertir(idCop);
    assert.equal(rCop.ok, true, rCop.error);
    const sinUsd = await corregir(rCop.numeros![0], "4100", 3900);
    assert.equal(sinUsd.ok, false);
    assert.match((sinUsd as { error: string }).error, /No hay obligaciones previstas en USD/);
    assert.equal(previstasDe(rCop.numeros![0]), "aereo|Aerolínea BN|600000.00|COP|-|-;hotel|Proveedor Hotel BN|420000.00|COP|-|-", "las previstas en COP quedan intactas");
  });

  test("T8 por obligación: corregir solo el aéreo deja el hotel en su TRM; ya no hay TRM común y la corrección de todo el contrato se rechaza hasta unificar", async () => {
    const n = await contratoUsd(3900);
    const claveAereo = sql(`select clave from public.contrato_obligaciones_previstas where numero_contrato = ${lit(n)} and payload->>'tipo_proveedor' = 'aereo'`);
    const r = await corregir(n, "4100", 3900, claveAereo);
    assert.deepEqual(r, { ok: true, cambiadas: 1, trmNueva: 4100 });
    assert.deepEqual(par(n, "aereo"), [4100, 820000, 200]);
    assert.deepEqual(par(n, "hotel"), [3900, 780000, 200], "el hotel conserva la suya");
    const todo = await corregir(n, "4200", 3900);
    assert.equal(todo.ok, false, "contrato completo con TRMs distintas: se rechaza");
    assert.deepEqual(par(n, "aereo"), [4100, 820000, 200]);
  });

  test("T9 concurrencia: dos correcciones simultáneas desde la misma TRM vista → exactamente una gana, la otra recibe el aviso, y el historial tiene solo la ganadora", async () => {
    const n = await contratoUsd(3900);
    const [a, b] = await Promise.all([corregir(n, "4200", 3900), corregir(n, "4300", 3900)]);
    assert.equal([a, b].filter((r) => r.ok).length, 1, JSON.stringify([a, b]));
    const perdedora = [a, b].find((r) => !r.ok) as { error: string };
    assert.match(perdedora.error, /cambió mientras la editabas|Otra operación/);
    const [trm] = par(n);
    assert.ok(trm === 4200 || trm === 4300);
    assert.equal(nHist(n), 2, "una fila de historial por obligación USD, solo de la ganadora");
    assert.equal(Number(sql(`select count(distinct trm_nueva) from public.contrato_trm_costo_historial where numero_contrato = ${lit(n)}`)), 1);
  });

  test("T10 históricos intactos: una previsión en USD SIN par (de otra ruta) no se puede corregir ni se le inventa TRM; las CxP con equivalente de contratos confirmados no cambian", async () => {
    const n = await contratoUsd(3900);
    const m = await contratoUsd(3900);
    await confirmar(m);
    sql(`update public.contrato_obligaciones_previstas set payload = payload - 'trm_costo' - 'valor_cop_costo' where numero_contrato = ${lit(n)}`);
    const antes = huella(n);
    const r = await corregir(n, "4100", 3900);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /No hay obligaciones previstas en USD con TRM de costos/);
    assert.equal(huella(n), antes, "ni el contrato confirmado ni sus CxP se tocaron");
    assert.equal(sql(`select count(*) from public.contrato_obligaciones_previstas where numero_contrato = ${lit(n)} and payload ? 'trm_costo'`), "0", "no se le inventó una TRM");
    assert.equal(nHist(n), 0);
  });
  test("T11 editar el VALOR de una prevista USD con TRM (pendiente_aplicar_servicios, la misma RPC de la edición de servicios) y confirmar: el equivalente en pesos se recalcula con la TRM vigente y la CHECK de la 236 se cumple al nacer la CxP", async () => {
    const n = await contratoUsd(3900);
    await corregir(n, "4100", 3900);                       // la TRM ya es la corregida (4.100): el valor nuevo debe usar ESA
    const idAereo = Number(sql(`select id from public.contrato_obligaciones_previstas where numero_contrato = ${lit(n)} and payload->>'tipo_proveedor' = 'aereo'`));
    const r = await clienteLocal(TOKEN_SERVICIO).rpc("pendiente_aplicar_servicios", {
      p_numero: n, p_items_borrar: [], p_items_nuevos: [], p_ventas: {}, p_prev_eliminar: [],
      p_prev_actualizar: [{ id: idAereo, valor_total: 250, servicio: "Tiquetes", tipo_proveedor: "aereo", proveedor: "Aerolínea BN" }],
      p_prev_insertar: [], p_cxp_eliminar: [], p_cxp_actualizar: [],
    });
    assert.equal(r.error, null, JSON.stringify(r.error));
    assert.deepEqual(par(n), [4100, 1025000, 250], "250 × 4.100 = 1.025.000: el equivalente sigue a la TRM y al valor nuevos");
    const hotelAntes = par(n, "hotel");
    assert.deepEqual(hotelAntes, [4100, 820000, 200], "la otra obligación no se toca");
    await confirmar(n);
    assert.match(cxpDe(n), /aereo|Aerolínea BN|250.00|USD|1025000.00|4100.0000/);
    assert.equal(asientoAereo(n), "1025000.00/1025000.00");
  });

  test("T12 editar el valor de una prevista en COP (sin par) no agrega ninguna TRM ni equivalente (la RPC solo recalcula donde ya hay par)", async () => {
    const idCop = cotizacion("COP", [itemBloqueo(4801, B_COP2, 4801)]);
    const rc = await convertir(idCop);
    assert.equal(rc.ok, true, rc.error);
    const n = rc.numeros![0];
    const idAereo = Number(sql(`select id from public.contrato_obligaciones_previstas where numero_contrato = ${lit(n)} and payload->>'tipo_proveedor' = 'aereo'`));
    const r = await clienteLocal(TOKEN_SERVICIO).rpc("pendiente_aplicar_servicios", {
      p_numero: n, p_items_borrar: [], p_items_nuevos: [], p_ventas: {}, p_prev_eliminar: [],
      p_prev_actualizar: [{ id: idAereo, valor_total: 650000, servicio: "Tiquetes", tipo_proveedor: "aereo", proveedor: "Aerolínea BN" }],
      p_prev_insertar: [], p_cxp_eliminar: [], p_cxp_actualizar: [],
    });
    assert.equal(r.error, null, JSON.stringify(r.error));
    assert.equal(previstasDe(n), "aereo|Aerolínea BN|650000|COP|-|-;hotel|Proveedor Hotel BN|420000.00|COP|-|-".replace("650000|", "650000|"), previstasDe(n));
  });
});
