// Bloqueo: el costo aéreo del contrato y su CxP salen de `tarifa_neta`; `tarifa_para_empaquetar` (reventa) queda solo para el PVP comercial.
// Trayecto REAL por HTTP contra PostgreSQL: convertirCotizacionCarrito (SIN simular dinero) → PostgREST propio → ventas / sillas / contrato_vuelos /
// cuentas_por_pagar / devengo contable. Solo se simula el motor de PRECIOS (computarReserva) y la sesión (cliente PostgREST real con JWT `authenticated`).
// SOLO base local desechable: la lanza supabase/scripts/test_bloqueo_neta_carrito.sh (no corre en `npm run test:*`).
import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PGBN_CONTENEDOR ?? "pgneta";
const DB = process.env.PGBN_BASE ?? "";
const PGRST = process.env.PGBN_POSTGREST ?? "";
const SECRETO = process.env.PGBN_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PGBN_BASE (desechable), PGBN_POSTGREST y PGBN_JWT_SECRET: usa supabase/scripts/test_bloqueo_neta_carrito.sh.");

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

describe("bloqueo · costo aéreo real desde tarifa_neta (carrito → contrato → CxP → devengo)", () => {
  test("N1 COP: neta 300.000 / reventa 349.000 / 2 pax → costo_aereo y CxP aérea 600.000 (no 698.000); precio, hotel y reventa del bloqueo intactos", async () => {
    const id = cotizacion("COP", [itemBloqueo(4801, B_COP, 4801)]);
    const r = await convertir(id);
    assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    const [precio, costoHotel, costoAereo, moneda] = fila(`select precio_venta, costo_hotel, costo_aereo, moneda from public.ventas where numero_contrato = ${lit(n)}`);
    assert.deepEqual([Number(precio), Number(costoHotel), Number(costoAereo), moneda], [1_400_000, 420_000, 600_000, "COP"]);
    const previstas = "aereo|Aerolínea BN|600000.00|COP|-|-;hotel|Proveedor Hotel BN|420000.00|COP|-|-";
    assert.equal(cxpDe(n), "", "pendiente: todavía no hay CxP (regla 288)");
    assert.equal(previstasDe(n), previstas, "las obligaciones PREVISTAS ya llevan la neta");
    await confirmar(n);
    assert.equal(cxpDe(n), previstas, "al confirmar nacen las CxP con el mismo valor");
    assert.equal(asientoAereo(n), "600000.00/600000.00", "el devengo contable usa 600.000");
    assert.equal(Number(precio) - Number(costoHotel) - Number(costoAereo), 380_000, "margen bruto = 1.400.000 − 420.000 − 600.000");
    assert.equal(sql(`select count(*) from public.sillas where bloqueo_id = ${B_COP} and numero_contrato = ${lit(n)}`), "2");
    assert.deepEqual(fila(`select tarifa_neta, tarifa_para_empaquetar from public.bloqueos_vuelo where id = ${B_COP}`).map(Number), [300_000, 349_000], "el bloqueo conserva ambas tarifas");
  });

  test("N2 USD con TRM de costos 3.900: neta 100 / reventa 120 / 2 pax → CxP aérea USD 200 (equivalente 780.000), no USD 240 (936.000)", async () => {
    const id = cotizacion("USD", [itemBloqueo(4802, B_USD, 4802)]);
    const r = await convertir(id, { monedaCobro: "USD", trmCosto: 3900 });
    assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    assert.equal(Number(sql(`select costo_aereo from public.ventas where numero_contrato = ${lit(n)}`)), 200);
    assert.match(previstasDe(n), /aereo\|Aerolínea BN\|200\.00\|USD\|780000\.00\|3900\.0000/);
    await confirmar(n);
    assert.match(cxpDe(n), /aereo\|Aerolínea BN\|200\.00\|USD\|780000\.00\|3900\.0000/);
    assert.equal(asientoAereo(n), "780000.00/780000.00");
  });

  test("N3 bloqueo sin tarifa neta: se rechaza ANTES de numerar; ni contrato, ni CxP, ni sillas tomadas; la cotización sigue abierta (no cae a 349.000 ni a 0)", async () => {
    const id = cotizacion("COP", [itemBloqueo(4801, B_SIN_NETA, 4801)]);
    const antes = foto();
    const r = await convertir(id);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /tarifa neta/);
    assert.deepEqual(foto(), antes);
    assert.equal(sql(`select estado from public.cotizaciones where id = ${id}`), "abierta");
    // al cargar la neta (corrección del dueño) la misma cotización convierte con el costo correcto
    sql(`update public.bloqueos_vuelo set tarifa_neta = 300000 where id = ${B_SIN_NETA}`);
    const ok = await convertir(id);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(Number(sql(`select costo_aereo from public.ventas where numero_contrato = ${lit(ok.numeros![0])}`)), 600_000);
  });

  test("N4 rol agencia no convierte (la RLS real le oculta la cotización): nada se escribe", async () => {
    const id = cotizacion("COP", [itemBloqueo(4801, B_COP2, 4801)]);
    const antes = foto();
    uidSesion = UID_AGENCIA;
    const r = (await convertirCotizacionCarrito(id, { agrupar: "todo", pasajeros: PASAJEROS, asesorInterno: "Asesor BN", asignaciones: [[1, 2]], asignacionesTours: [], monedaCobro: "COP" })) as Resultado;
    uidSesion = UID_ADMIN;
    assert.equal(r.ok, false);
    assert.deepEqual(foto(), antes);
  });
});

// Reserva de UN hotel (no carrito): cotización tipo tarifario → convertirCotizacion → reservarDesdeTarifarioInterno → datosVueloBloqueo (otro camino al mismo costo).
function cotizacionPersona(hotelId: number, bloqueoId: number, paqueteId: number, moneda: "COP" | "USD"): number {
  const payload = {
    paqueteId, bloqueoId, modulo: "bloqueo", hotelId, categoria: "Estandar", regimen: "Desayuno", habitaciones: { doble: 1 },
    ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [], cantidadMenores: 0, cliente: { ...CLIENTE, tipoDoc: "CC" },
    tipoAsesor: "interno", asesorInterno: "Asesor BN", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "2030-02-01", pasajeros: PASAJEROS,
  };
  return Number(sql(`insert into public.cotizaciones (tipo, estado, tenant, moneda, payload, detalle, cliente, pax)
    values ('tarifario', 'abierta', 'mayorista', ${lit(moneda)}, ${lit(JSON.stringify(payload))}::jsonb, '{}'::jsonb, 'Ana Pérez', 2) returning id`));
}

describe("bloqueo · costo aéreo real desde tarifa_neta (reserva de un hotel: convertirCotizacion)", () => {
  test("N5 COP: 2 pax con silla → costo_aereo y CxP aérea 600.000 (no 698.000), mismo costo que en el carrito", async () => {
    const id = cotizacionPersona(4801, B_COP2, 4801, "COP");
    uidSesion = UID_ADMIN;
    const r = await convertirCotizacion(id, PASAJEROS, false, "Asesor BN");
    assert.equal(r.ok, true, JSON.stringify(r));
    const n = (r as { numero: string }).numero;
    assert.equal(Number(sql(`select costo_aereo from public.ventas where numero_contrato = ${lit(n)}`)), 600_000);
    assert.match(previstasDe(n), /aereo\|Aerolínea BN\|600000\.00\|COP/);
    await confirmar(n);
    assert.match(cxpDe(n), /aereo\|Aerolínea BN\|600000\.00\|COP/);
    assert.equal(asientoAereo(n), "600000.00/600000.00");
  });

  test("N6 sin tarifa neta: la reserva se rechaza; ni contrato ni CxP ni sillas; la cotización queda abierta", async () => {
    sql(`update public.bloqueos_vuelo set tarifa_neta = null where id = ${B_SIN_NETA}`);
    const id = cotizacionPersona(4801, B_SIN_NETA, 4801, "COP");
    const antes = foto();
    const r = await convertirCotizacion(id, PASAJEROS, false, "Asesor BN");
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /tarifa neta/);
    assert.deepEqual(foto(), antes);
    assert.equal(sql(`select estado from public.cotizaciones where id = ${id}`), "abierta");
  });
});

// ── Fallos entre la revisión previa y la creación: nada sobrevive y la cotización no cambia ─────────────────────────────────────────
const contar = (t: string) => Number(sql(`select count(*) from public.${t}`));
const estadoFinanciero = () => ({
  ventas: contar("ventas"), cxp: contar("cuentas_por_pagar"), previstas: contar("contrato_obligaciones_previstas"), asientos: contar("asientos_contables"), lineas: contar("asiento_lineas"),
  pendientes: contar("contrato_financiero_pendiente"), pasajeros: contar("contrato_pasajeros"), vuelos: contar("contrato_vuelos"), items: contar("contrato_items"),
  sillasTomadas: Number(sql("select count(*) from public.sillas where estado <> 'disponible' or numero_contrato is not null")),
});
const huella = (id: number) => sql(`select md5(estado || '|' || payload::text || '|' || detalle::text || '|' || coalesce(numero_contrato, '')) from public.cotizaciones where id = ${id}`);

describe("bloqueo · fallos de lectura/escritura del vuelo después de la revisión previa (inyectados en HTTP)", () => {
  for (const [modo, patron, antesDeNumerar] of [
    ["previa_error", /No se pudo verificar la moneda de los vuelos/, true],
    ["previa_omitida", /No se pudo verificar un vuelo negociado/, true],
    ["creacion_error", /No se pudo leer el vuelo negociado del hotel/, false],
    ["creacion_sin_fila", /No se pudo leer el vuelo negociado del hotel/, false],
    ["vuelo_insert_error", /No se pudo registrar el vuelo del hotel/, false],
  ] as const) {
    test(`${modo}: ${antesDeNumerar ? "se rechaza antes de numerar" : "se revierte el contrato en curso"}; sin contrato, CxP, asientos, pasajeros, vuelos ni sillas; cotización idéntica`, async () => {
      const id = cotizacion("COP", [itemBloqueo(4801, B_COP2, 4801)]);
      const antes = estadoFinanciero();
      const huellaAntes = huella(id);
      inyeccion = modo; inyecciones = 0;
      let r: Resultado;
      try { r = await convertir(id); } finally { inyeccion = null; }
      assert.ok(inyecciones >= 1, "la inyección se disparó (si no, el escenario no probó nada)");
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", patron);
      assert.deepEqual(estadoFinanciero(), antes, "ningún contrato, CxP, asiento, pasajero, vuelo ni silla sobrevive");
      assert.equal(huella(id), huellaAntes, "la cotización sigue abierta y sin tocar (sin número, sin detalle nuevo)");
    });
  }

  test("control: sin inyección la MISMA cotización sí convierte, con costo aéreo 600.000 (neta) y las dos sillas tomadas", async () => {
    const id = cotizacion("COP", [itemBloqueo(4801, B_COP2, 4801)]);
    const antes = estadoFinanciero();
    const r = await convertir(id);
    assert.equal(r.ok, true, r.error);
    const n = r.numeros![0];
    assert.equal(Number(sql(`select costo_aereo from public.ventas where numero_contrato = ${lit(n)}`)), 600_000);
    assert.match(previstasDe(n), /aereo\|Aerolínea BN\|600000\.00\|COP/);
    assert.equal(estadoFinanciero().sillasTomadas, antes.sillasTomadas + 2);
  });
});
