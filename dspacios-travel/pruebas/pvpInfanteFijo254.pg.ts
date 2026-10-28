// Migración 254 · PVP fijo del infante — trayecto REAL contra PostgreSQL por HTTP, SIN simular el motor de precios:
//   generarTarifario (paquetes/actions.ts → publicar_tarifario_resultado) → tarifario_resultado / vista pública → computarReserva REAL →
//   convertirCotizacionCarrito (reservar/actions.ts) → ventas / contrato_items / costos / cuentas_por_pagar.
// Lo ÚNICO simulado: la sesión (auth.getUser; el cliente "de sesión" es un cliente PostgREST real con JWT `authenticated`, RLS incluida),
// la numeración (RPC real) y dos efectos laterales ajenos (congelar condiciones, contexto de cotización).
//
// SOLO base LOCAL desechable. No corre en `npm run test:*`: la lanza supabase/scripts/test_254_app_infante.sh.
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG254_CONTENEDOR ?? "pg254";
const DB = process.env.PG254_BASE ?? "";
const PGRST = process.env.PG254_POSTGREST ?? "";
const SECRETO = process.env.PG254_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) {
  throw new Error("Faltan PG254_BASE (desechable), PG254_POSTGREST y PG254_JWT_SECRET: usa supabase/scripts/test_254_app_infante.sh.");
}

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
const UID_ADMIN = "00000000-0000-0000-0000-000000254003";
const TOKEN_SERVICIO = jwt({ role: "service_role" });

process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-254";

const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteSesion = () => clienteLocal(jwt({ role: "authenticated", sub: UID_ADMIN }), { id: UID_ADMIN, email: `${UID_ADMIN}@x.test` });

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: q, encoding: "utf8" }).trim();
}
const fila = (q: string) => sql(q).split("|");
const lit = (v: unknown) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
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

const { liquidarServicioPuntual } = await import("../lib/reservar/cotizar.ts");
const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const { convertirCotizacionCarrito } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");

// ── Semilla ───────────────────────────────────────────────────────────────
// Hotel con infantes hasta 5 años (clase «infante» del hotel). Neto por persona/noche: doble 100.000, Niño 1 50.000, infante 40.000; 3 noches; mk 20 %.
//   adulto doble = 100.000×3/0,8 = 375.000 · infante normal = 40.000×3/0,8 = 150.000 · costo neto infante (3 noches) = 120.000 · costo adulto = 300.000.
const BQ_CONV = 5410;
const PAQ_PORCION = 5401, PAQ_BLOQUEO = 5402, HOTEL = 5401, BQ_GRATIS = 5401, BQ_FEE = 5402, BQ_ADULTO = 5403, SRV_POS = 5501, SRV_GRATIS = 5502, SRV_ASIST = 5503, SRV_MIXTO = 5504;
const FIJO = 49000;

before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_ADMIN}', 'admin254@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${UID_ADMIN}', 'admin254@x.test', 'Admin 254', 'administracion', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into public.destinos (id, nombre) values (5401, 'CARTAGENA 254') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (5401, 'Proveedor Hotel 254'), (5402, 'Aerolínea 254'), (5403, 'Receptivo 254') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
      values (${HOTEL}, 5401, 'Hotel Infantes 254', 5401, 'COP', 0, 5, 6, 12, 1, 6, true) on conflict do nothing;
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
      values (${HOTEL}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2) on conflict do nothing;
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (${HOTEL}, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa');
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante)
      values (${HOTEL}, 'Estandar', 'Desayuno', 'ALTA', 150000, 100000, 50000, 30000, 40000);
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
      values (${PAQ_PORCION}, 'Porción 254', 'porcion_terrestre', 3, 5401, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true),
             (${PAQ_BLOQUEO}, 'Bloqueo 254', 'bloqueo', 3, 5401, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes)
      values (${PAQ_PORCION}, ${HOTEL}, array['Estandar'], array['Desayuno']), (${PAQ_BLOQUEO}, ${HOTEL}, array['Estandar'], array['Desayuno']);
    -- Tres bloqueos: vuelo gratuito (tarifa 0, fee 0) · fee de infante positivo · vuelo de adulto positivo con fee 0.
    insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, fecha_ida, fecha_regreso, cupos_total, tarifa_para_empaquetar, fee_infante, destino_id, proveedor_id, moneda, origen) values
      (${BQ_GRATIS}, 'GRAT54', 'Aerolínea 254', 'BOG - CTG - BOG', '2030-03-01', '2030-03-04', 20, 0, 0, 5401, 5402, 'COP', 'BOG'),
      (${BQ_FEE},    'FEE254', 'Aerolínea 254', 'BOG - CTG - BOG', '2030-04-01', '2030-04-04', 20, 0, 30000, 5401, 5402, 'COP', 'BOG'),
      (${BQ_ADULTO}, 'ADU254', 'Aerolínea 254', 'BOG - CTG - BOG', '2030-05-01', '2030-05-04', 20, 300000, 0, 5401, 5402, 'COP', 'BOG');
    insert into public.bloqueos_vuelo (id, record, aerolinea, ruta, vuelo_ida, fecha_ida, vuelo_regreso, fecha_regreso, cupos_total, tarifa_para_empaquetar, fee_infante, destino_id, proveedor_id, moneda, origen)
      values (${BQ_CONV}, 'CONV54', 'Aerolínea 254', 'BOG - CTG - BOG', 'AV54', '2030-06-01', 'AV55', '2030-06-04', 10, 300000, 30000, 5401, 5402, 'COP', 'BOG');
    insert into public.sillas (bloqueo_id, numero_silla, estado) select ${BQ_CONV}, g, 'disponible' from generate_series(1, 10) g;
    insert into public.armado_vuelos (paquete_id, bloqueo_id, aplica_mk, ta) values (${PAQ_BLOQUEO}, ${BQ_CONV}, true, 0),  (${PAQ_BLOQUEO}, ${BQ_GRATIS}, true, 0), (${PAQ_BLOQUEO}, ${BQ_FEE}, true, 0), (${PAQ_BLOQUEO}, ${BQ_ADULTO}, true, 0);
    -- Servicios opcionales del paquete de porción (precio por persona; precio_infante NULL = paga como adulto).
    insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, precio_infante, categoria, moneda, tipo_tarifa, liquidacion) values
      (${SRV_POS},    'Tour pago 254',       5403, 5401, 40000, null, 'tour_traslado', 'COP', 'persona', 'paquete'),
      (${SRV_GRATIS}, 'Tour cortesía 254',   5403, 5401, 0,     0,    'tour_traslado', 'COP', 'persona', 'paquete'),
      (${SRV_ASIST},  'Asistencia 254',      5403, 5401, 30000, null, 'asistencia',    'COP', 'persona', 'paquete'),
      (${SRV_MIXTO},  'Tour sin infantes 254', 5403, 5401, 40000, 0,  'tour_traslado', 'COP', 'persona', 'paquete');
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values
      (${PAQ_PORCION}, ${SRV_POS}, 'persona', false), (${PAQ_PORCION}, ${SRV_GRATIS}, 'persona', false), (${PAQ_PORCION}, ${SRV_ASIST}, 'persona', false), (${PAQ_PORCION}, ${SRV_MIXTO}, 'persona', false);
  `);
});

const setFijo = (paquete: number, v: number | null) => sql(`update public.armado_paquetes set pvp_infante_fijo = ${v == null ? "null" : v} where id = ${paquete}`);
async function generar(paquete: number) {
  const r = await generarTarifario(paquete);
  assert.equal(r.ok, true, JSON.stringify(r));
}
const estadoPaquete = (p: number) => fila(`select tarifario_estado, tarifario_snapshot_publicable from public.armado_paquetes where id = ${p}`).join("/");
/** Fila infante publicada (vista pública): [precio_pvp, sin_fijo, menor2, menor2_sin_fijo]. */
const infante = (p: number, extra = "") => fila(`select coalesce(precio_pvp::text,'-'), coalesce(precio_pvp_sin_fijo::text,'-'), coalesce(precio_pvp_menor2::text,'-'), coalesce(precio_pvp_menor2_sin_fijo::text,'-')
  from public.tarifario_resultado_publicable where paquete_id = ${p} and acomodacion = 'infante' ${extra}`);

describe("254 · configuración → generación → invalidez del tarifario (base real)", () => {
  test("G1 sin configurar: fórmula actual (150.000 en ambas rutas) y nada guardado en sin_fijo", async () => {
    await generar(PAQ_PORCION);
    assert.deepEqual(infante(PAQ_PORCION), ["150000.00", "-", "150000.00", "-"]);
    assert.equal(estadoPaquete(PAQ_PORCION), "listo/t");
  });
  test("G2 cambiar el PVP fijo INVALIDA el tarifario (pendiente, no publicable); al regenerar publica 49.000 y guarda el precio normal", async () => {
    setFijo(PAQ_PORCION, FIJO);
    assert.equal(estadoPaquete(PAQ_PORCION), "pendiente/f", "el trigger invalida el snapshot");
    await generar(PAQ_PORCION);
    assert.equal(estadoPaquete(PAQ_PORCION), "listo/t");
    assert.deepEqual(infante(PAQ_PORCION), ["49000.00", "150000.00", "49000.00", "150000.00"]);
    assert.equal(sql(`select precio_pvp::text from public.tarifario_resultado_publicable where paquete_id = ${PAQ_PORCION} and acomodacion = 'doble'`), "375000.00", "el adulto no cambia");
    assert.equal(sql(`select precio_pvp::text from public.tarifario_resultado_publicable where paquete_id = ${PAQ_PORCION} and acomodacion = 'nino'`), "188000.00", "Niño 1 no cambia");
  });
  test("G3 guardar el mismo valor no invalida; $0 es válido y distinto de «sin configurar»", async () => {
    setFijo(PAQ_PORCION, FIJO);
    assert.equal(estadoPaquete(PAQ_PORCION), "listo/t", "sin cambio real no invalida");
    setFijo(PAQ_PORCION, 0);
    assert.equal(estadoPaquete(PAQ_PORCION), "pendiente/f");
    await generar(PAQ_PORCION);
    assert.deepEqual(infante(PAQ_PORCION), ["0.00", "150000.00", "0.00", "150000.00"]);
  });
  test("G4 el CHECK de la base rechaza un PVP fijo negativo", () => {
    assert.throws(() => setFijo(PAQ_PORCION, -1), /armado_paquetes_pvp_infante_fijo_chk|check/i);
  });
  test("G5 vuelos: gratuito → fijo en ambas rutas; fee positivo → menor de 2 normal (2+ fijo); vuelo de adulto positivo → 2+ normal (menor de 2 fijo)", async () => {
    setFijo(PAQ_BLOQUEO, FIJO);
    await generar(PAQ_BLOQUEO);
    const [gratis] = [infante(PAQ_BLOQUEO, `and bloqueo_id = ${BQ_GRATIS}`)];
    assert.deepEqual(gratis, ["49000.00", "150000.00", "49000.00", "150000.00"], "vuelo gratuito ($0 y fee $0) NO desactiva el fijo");
    const fee = infante(PAQ_BLOQUEO, `and bloqueo_id = ${BQ_FEE}`);
    assert.deepEqual([fee[0], fee[1], fee[3]], ["49000.00", "150000.00", "-"], "fee positivo: 2+ conserva el fijo");
    assert.equal(fee[2], "180000.00", "menor de 2 con fee 30.000 > 0: fórmula normal completa (hotel 150.000 + fee exacto 30.000), sin el fijo");
    const adulto = infante(PAQ_BLOQUEO, `and bloqueo_id = ${BQ_ADULTO}`);
    assert.deepEqual([adulto[0], adulto[1], adulto[2], adulto[3]], ["-", "-", "49000.00", "150000.00"].map((x, i) => (i === 0 ? adulto[0] : x)), "vuelo de adulto positivo: 2+ normal; menor de 2 (fee 0) conserva el fijo");
    assert.notEqual(adulto[0], "49000.00");
    assert.equal(adulto[1], "-", "2+ normal: no hay precio «sin fijo» porque el fijo no se aplicó");
  });
});

// ── Recorrido de reserva: cotización de carrito → contrato → costos → CxP ─────────────────────
const PASAJEROS = [
  { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false },
  { nombres: "Luis", apellidos: "Gómez", tipoDoc: "CC", numeroDoc: "456", fechaNacimiento: "1988-05-05", nacionalidad: "Colombiana", esInfante: false },
  { nombres: "Bebé", apellidos: "Pérez", tipoDoc: "RC", numeroDoc: "789", fechaNacimiento: "2029-02-01", nacionalidad: "Colombiana", esInfante: true, responsableIndex: 0 }, // 1 año al 2030-03-01
  { nombres: "Niño", apellidos: "Pérez", tipoDoc: "RC", numeroDoc: "790", fechaNacimiento: "2026-12-01", nacionalidad: "Colombiana", esInfante: true, responsableIndex: 0 }, // 3 años
];
const CLIENTE = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };

async function cotizacion(servicios: number[]): Promise<number> {
  const item = {
    modulo: "porcion_terrestre", paqueteId: PAQ_PORCION, hotelId: HOTEL, bloqueoId: null, hotelNombre: "Hotel Infantes 254", destino: "CARTAGENA 254",
    categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3,
    habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 2, pax: 4, precio: 1, edadesMenores: [1, 3], cantidadMenores: 2, ref: "item-0",
  };
  // Servicios opcionales elegidos con el hotel = tours del carrito vinculados a él (hotelRef), cotizados por el motor REAL (total para los 4 viajeros).
  const tours = [];
  for (const servicioId of servicios) {
    const t = await liquidarServicioPuntual({ paqueteId: PAQ_PORCION, servicioId, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 4 });
    assert.equal(t.ok, true, JSON.stringify(t));
    if (!t.ok) continue;
    const q = t.resultado;
    tours.push({ servicioId, paqueteId: PAQ_PORCION, hotelRef: "item-0", nombre: q.nombre, destino: q.destino, descripcion: q.descripcion, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: q.noches, pax: q.pax, precio: q.total, moneda: q.moneda, categoria: q.categoria });
  }
  // El precio congelado de la cotización es el que cotiza el motor para ESTE ítem (la conversión exige que coincida).
  const cot = await computarReserva(clienteSesion() as never, reservaCot({ servicios: [], opcionalesInfante: tours.map((t) => opcionalDeTourCarrito({ categoria: t.categoria, precio: t.precio })) }) as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (cot.ok) item.precio = cot.data.precioVenta;
  const payload = { items: [item], tours, cliente: CLIENTE };
  return Number(sql(`insert into public.cotizaciones (tipo, estado, tenant, moneda, payload, detalle, cliente, pax)
    values ('carrito', 'abierta', 'mayorista', 'COP', ${lit(JSON.stringify(payload))}::jsonb, ${lit(JSON.stringify({ hoteles: [{ ref: "item-0", condiciones_tarifa: [] }] }))}::jsonb, 'Ana Pérez', 4) returning id`));
}
type Res = { ok: boolean; error?: string; numeros?: string[] };
async function reservar(servicios: number[] = []): Promise<{ numero: string; r: Res }> {
  const id = await cotizacion(servicios);
  const r = (await convertirCotizacionCarrito(id, {
    agrupar: "todo", pasajeros: PASAJEROS, asesorInterno: "Asesor 254", asignaciones: [[1, 2, 3, 4]], asignacionesTours: servicios.map(() => [1, 2, 3, 4]), monedaCobro: "COP",
  })) as Res;
  assert.equal(r.ok, true, r.error);
  return { numero: r.numeros![0], r };
}
/** Todo lo que importa de un contrato: precio, costos, CxP y las líneas de infante. */
function resumen(numero: string) {
  const [precio, costoHotel] = fila(`select precio_venta, coalesce(costo_hotel, 0) from public.ventas where numero_contrato = ${lit(numero)}`).map(Number);
  const items = fila(`select coalesce(string_agg(descripcion || '=' || tarifa_nino, ' ; ' order by orden), '') from public.contrato_items where numero_contrato = ${lit(numero)} and descripcion like 'Infante%'`)[0];
  const sumaItems = Number(sql(`select coalesce(sum(adultos * tarifa_adulto + ninos * tarifa_nino), 0) from public.contrato_items where numero_contrato = ${lit(numero)}`));
  const cxpHotel = Number(sql(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = ${lit(numero)} and tipo_proveedor = 'hotel'`));
  const cxpTotal = Number(sql(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = ${lit(numero)}`));
  return { precio, costoHotel, items, sumaItems, cxpHotel, cxpTotal };
}

describe("254 · reserva real (menor de 1 año + niño de 3 años; hotel con infantes hasta 5): precio cambia, costo y CxP NO", () => {
  let base: ReturnType<typeof resumen>;
  test("R1 sin PVP fijo: 2 adultos 375.000 + 2 infantes 150.000; costo hotel real 2×300.000 + 2×120.000", async () => {
    setFijo(PAQ_PORCION, null); await generar(PAQ_PORCION);
    const { numero } = await reservar();
    base = resumen(numero);
    assert.equal(base.precio, 2 * 375000 + 2 * 150000);
    assert.equal(base.costoHotel, 2 * 300000 + 2 * 120000);
    assert.equal(base.cxpHotel, 840000);
    assert.equal(base.sumaItems, base.precio, "contrato = suma de sus líneas = total");
  });
  test("R2 con $49.000: ambos infantes a 49.000 (rutas menor de 2 y 2+); costo y CxP idénticos a R1; total = suma de líneas", async () => {
    setFijo(PAQ_PORCION, FIJO); await generar(PAQ_PORCION);
    const { numero } = await reservar();
    const x = resumen(numero);
    assert.equal(x.precio, 2 * 375000 + 2 * FIJO);
    assert.equal(x.sumaItems, x.precio);
    assert.match(x.items, /49000/);
    assert.equal(x.costoHotel, base.costoHotel, "el costo sigue siendo el real (neto del hotel), no el PVP fijo");
    assert.equal(x.cxpHotel, base.cxpHotel, "la CxP al proveedor es la real");
    assert.equal(x.cxpTotal, base.cxpTotal);
  });
  test("R3 con $0: los infantes cuestan $0 y el costo neto positivo del hotel NO se borra (mismo costo y CxP que sin fijo)", async () => {
    setFijo(PAQ_PORCION, 0); await generar(PAQ_PORCION);
    const { numero } = await reservar();
    const x = resumen(numero);
    assert.equal(x.precio, 2 * 375000);
    assert.equal(x.costoHotel, base.costoHotel);
    assert.equal(x.cxpHotel, base.cxpHotel);
    assert.ok(x.cxpHotel > 0);
  });
  test("R4 servicio opcional del carrito: sin servicio o con asistencia conserva el fijo; con un tour de importe positivo AMBOS infantes vuelven a la fórmula normal completa (nunca fijo + normal)", async () => {
    setFijo(PAQ_PORCION, FIJO); await generar(PAQ_PORCION);
    const sinServ = resumen((await reservar()).numero);
    assert.match(sinServ.items, /=49000/);
    const asist = resumen((await reservar([SRV_ASIST])).numero);
    assert.equal(asist.items, sinServ.items, "la asistencia no desactiva el fijo");
    const pos = resumen((await reservar([SRV_POS])).numero);
    assert.doesNotMatch(pos.items, /49000/, "tour positivo: fórmula normal completa, NUNCA el fijo");
    assert.match(pos.items, /150000/);
    assert.equal(pos.sumaItems, pos.precio, "total = suma de líneas, sin cobrar fijo y normal a la vez");
    assert.equal(pos.costoHotel, base.costoHotel, "el costo real del hotel no cambia");
  });
  test("R5 tour con precio de infante $0 pero total positivo: el carrito lo cobra por viajero (infantes incluidos), así que también cuenta como cargo", async () => {
    const x = resumen((await reservar([SRV_MIXTO])).numero);
    assert.doesNotMatch(x.items, /49000/);
    assert.match(x.items, /150000/);
    assert.equal(x.sumaItems, x.precio);
    assert.equal(x.costoHotel, base.costoHotel);
  });
});

// ── Cotización (motor real, con edades): menor de 1 año y niño de 3 años por separado ──────────────────
const { computarReserva } = await import("../lib/reservar/computo.ts");
const { opcionalDeTourCarrito } = await import("../lib/paquetes/pvpInfanteFijo.ts");
const reservaCot = (extra: Record<string, unknown> = {}) => ({
  paqueteId: PAQ_PORCION, bloqueoId: null, modulo: "porcion_terrestre", hotelId: HOTEL, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04",
  categoria: "Estandar", regimen: "Desayuno", habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [1, 3], cantidadMenores: 2,
  cliente: { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" },
  tipoAsesor: "interno", asesorInterno: "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", aliadoId: null, plazo: "", pasajeros: [], servicios: [], ...extra,
});
async function cotizar(extra?: Record<string, unknown>) {
  const r = await computarReserva(clienteSesion() as never, reservaCot(extra) as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error("no");
  return r.data;
}
describe("254 · cotización con edades reales (menor de 1 año y niño de 3 años, hotel con infantes hasta 5)", () => {
  test("Q1 sin fijo: 150.000 y 150.000; con $49.000: las dos rutas dan 49.000 (menor de 2 → precio_pvp_menor2, 2+ → precio_pvp) y el costo neto del hotel por infante no cambia", async () => {
    setFijo(PAQ_PORCION, null); await generar(PAQ_PORCION);
    const normal = await cotizar();
    assert.deepEqual(normal.lineasMenores.map((l) => [l.cantidad, l.tarifa, l.menorDeDos]), [[1, 150000, true], [1, 150000, false]]);
    setFijo(PAQ_PORCION, FIJO); await generar(PAQ_PORCION);
    const fijo = await cotizar();
    assert.deepEqual(fijo.lineasMenores.map((l) => [l.cantidad, l.tarifa, l.menorDeDos]), [[1, 49000, true], [1, 49000, false]]);
    assert.equal(fijo.precioVenta, 375000 * 2 + 98000);
    assert.equal(fijo.netoPorAcom["infante"], normal.netoPorAcom["infante"], "costo real del hotel intacto");
    assert.equal(fijo.netoPorAcom["infante"], 120000);
    assert.equal(fijo.paxConSilla, 3, "el niño de 3 años ocupa silla; el menor de 1 año no");
  });
  test("Q2 con un servicio positivo vinculado: ambos vuelven a la normal; con asistencia vinculada conservan el fijo; con $0 configurado el costo neto no se borra", async () => {
    const conPositivo = await cotizar({ opcionalesInfante: [opcionalDeTourCarrito({ categoria: "tour_traslado", precio: 200000 })] });
    assert.deepEqual(conPositivo.lineasMenores.map((l) => l.tarifa), [150000, 150000]);
    assert.equal(conPositivo.precioVenta, 375000 * 2 + 300000);
    const conAsistencia = await cotizar({ opcionalesInfante: [opcionalDeTourCarrito({ categoria: "asistencia", precio: 120000 })] });
    assert.deepEqual(conAsistencia.lineasMenores.map((l) => l.tarifa), [49000, 49000]);
    const conGratis = await cotizar({ opcionalesInfante: [opcionalDeTourCarrito({ categoria: "tour_traslado", precio: 0 })] });
    assert.deepEqual(conGratis.lineasMenores.map((l) => l.tarifa), [49000, 49000], "un servicio gratuito no desactiva el fijo");
    setFijo(PAQ_PORCION, 0); await generar(PAQ_PORCION);
    const cero = await cotizar();
    assert.deepEqual(cero.lineasMenores.map((l) => l.tarifa), [0, 0]);
    assert.equal(cero.netoPorAcom["infante"], 120000, "con $0 configurado el neto positivo del hotel NO se borra");
  });
});

// ── Cotización REAL (crearSolicitudReserva) → conversión REAL, con vuelo de pago y menores de 1 y 3 años ───────────────────────
// Bloqueo con vuelo de adulto 300.000 (pvp 375.000 con mk) y fee de infante 30.000: una clasificación incorrecta cambia precio, sillas, costo aéreo y CxP.
const { crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");
const PAX_CONV = [
  { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false },
  { nombres: "Luis", apellidos: "Gómez", tipoDoc: "CC", numeroDoc: "456", fechaNacimiento: "1988-05-05", nacionalidad: "Colombiana", esInfante: false },
  { nombres: "Bebé", apellidos: "Pérez", tipoDoc: "RC", numeroDoc: "789", fechaNacimiento: "2029-05-01", nacionalidad: "Colombiana", esInfante: true, responsableIndex: 0 }, // 1 año el 2030-06-01
  { nombres: "Niño", apellidos: "Pérez", tipoDoc: "RC", numeroDoc: "790", fechaNacimiento: "2026-12-01", nacionalidad: "Colombiana", esInfante: false },      // 3 años
];
async function cotizarCarrito(extraItem: Record<string, unknown> = {}) {
  const r = await crearSolicitudReserva({
    items: [{
      modulo: "bloqueo", paqueteId: PAQ_BLOQUEO, hotelId: HOTEL, bloqueoId: BQ_CONV, hotelNombre: "Hotel Infantes 254", destino: "CARTAGENA 254",
      categoria: "Estandar", regimen: "Desayuno", fechaIda: null, fechaRegreso: null, noches: 3, habitaciones: { doble: 1 },
      ninos: 0, ninos2: 0, infantes: 0, pax: 4, precio: 1, edadesMenores: [1, 3], cantidadMenores: 2, ...extraItem,
    }],
    tours: [], hotelDeTour: [],
    cliente: { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" },
  } as never) as { ok: boolean; error?: string; cotizacion?: { id: number } };
  assert.equal(r.ok, true, r.error);
  return Number(r.cotizacion!.id);
}
const payloadItem = (id: number) => JSON.parse(sql(`select (payload->'items'->0)::text from public.cotizaciones where id = ${id}`)) as Record<string, unknown>;
const setPayloadItem = (id: number, clave: string, valor: unknown) =>
  sql(`update public.cotizaciones set payload = jsonb_set(payload, '{items,0,${clave}}', ${lit(JSON.stringify(valor))}::jsonb) where id = ${id}`);
const quitarClaveItem = (id: number, clave: string) => sql(`update public.cotizaciones set payload = payload #- '{items,0,${clave}}' where id = ${id}`);
async function convertir(id: number) {
  return (await convertirCotizacionCarrito(id, {
    agrupar: "todo", pasajeros: PAX_CONV, asesorInterno: "Asesor 254", asignaciones: [[1, 2, 3, 4]], asignacionesTours: [], monedaCobro: "COP",
  })) as Res;
}
const totales = () => ({
  ventas: Number(sql("select count(*) from public.ventas")), cxp: Number(sql("select count(*) from public.cuentas_por_pagar")),
  ultimo: sql("select coalesce(max(substring(numero_contrato from 5)::int), 0) from public.ventas where numero_contrato ~ '^DTM-[0-9]+$'"),
  sillas: Number(sql(`select count(*) from public.sillas where bloqueo_id = ${BQ_CONV} and estado <> 'disponible'`)),
});
function contrato(numero: string) {
  const [precio, costoAereo, costoHotel] = fila(`select precio_venta, coalesce(costo_aereo,0), coalesce(costo_hotel,0) from public.ventas where numero_contrato = ${lit(numero)}`).map(Number);
  return {
    precio, costoAereo, costoHotel,
    items: fila(`select coalesce(string_agg(descripcion || '=' || adultos || 'x' || tarifa_adulto || '/' || ninos || 'x' || tarifa_nino, ' ; ' order by orden), '') from public.contrato_items where numero_contrato = ${lit(numero)}`)[0],
    sumaItems: Number(sql(`select coalesce(sum(adultos * tarifa_adulto + ninos * tarifa_nino), 0) from public.contrato_items where numero_contrato = ${lit(numero)}`)),
    pasajeros: Number(sql(`select count(*) from public.contrato_pasajeros where numero_contrato = ${lit(numero)}`)),
    sillas: Number(sql(`select count(*) from public.sillas where numero_contrato = ${lit(numero)}`)),
    cxpAereo: Number(sql(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = ${lit(numero)} and tipo_proveedor = 'aereo'`)),
    cxpHotel: Number(sql(`select coalesce(sum(valor_total), 0) from public.cuentas_por_pagar where numero_contrato = ${lit(numero)} and tipo_proveedor = 'hotel'`)),
  };
}
const pvpInfante = (col: string) => Number(sql(`select ${col} from public.tarifario_resultado where paquete_id = ${PAQ_BLOQUEO} and bloqueo_id = ${BQ_CONV} and acomodacion = 'infante'`));

describe("254 · cotización → conversión con edades congeladas (hotel con infantes hasta 5; menor de 1 año con fee y niño de 3 que ocupa silla y paga vuelo)", () => {
  let cotId = 0; let numero = ""; let congelado: Record<string, unknown> = {};
  test("C1 la cotización congela las edades exactas, la clasificación y el precio con las dos rutas distintas (180.000 y 525.000)", async () => {
    setFijo(PAQ_BLOQUEO, FIJO); await generar(PAQ_BLOQUEO);
    cotId = await cotizarCarrito();
    congelado = payloadItem(cotId);
    assert.deepEqual(congelado.edadesMenores, [1, 3]);
    assert.equal(congelado.cantidadMenores, 2);
    assert.deepEqual([congelado.ninos, congelado.ninos2, congelado.infantes], [0, 0, 2], "ambos son «infante» para este hotel (hasta 5 años)");
    const menor2 = pvpInfante("precio_pvp_menor2"), mayor2 = pvpInfante("precio_pvp");
    assert.deepEqual([menor2, mayor2], [180000, 525000], "con vuelo/fee positivos el fijo NO aplica y cada ruta usa su fórmula normal");
    const adulto = Number(sql(`select precio_pvp from public.tarifario_resultado where paquete_id = ${PAQ_BLOQUEO} and bloqueo_id = ${BQ_CONV} and acomodacion = 'doble'`));
    assert.equal(congelado.precio, adulto * 2 + menor2 + mayor2, "precio congelado = adultos + menor de 1 (ruta menor de 2) + niño de 3 (ruta 2+)");
  });
  test("C2 la conversión reproduce lo cotizado: precio, líneas, pasajeros, sillas (3), costo aéreo y CxP; el total del contrato = suma de líneas", async () => {
    const antes = totales();
    const r = await convertir(cotId);
    assert.equal(r.ok, true, r.error);
    numero = r.numeros![0];
    const c = contrato(numero);
    assert.equal(c.precio, congelado.precio, "el contrato cobra el precio congelado de la cotización");
    assert.equal(c.sumaItems, c.precio, "total del contrato = suma de sus líneas");
    assert.match(c.items, /180000/); assert.match(c.items, /525000/);
    assert.equal(c.pasajeros, 4);
    assert.equal(c.sillas, 3, "2 adultos + el niño de 3 años ocupan silla; el menor de 1 año no");
    assert.equal(totales().sillas - antes.sillas, 3);
    assert.equal(c.costoAereo, 3 * 300000 + 1 * 30000, "costo aéreo real: 3 sillas de adulto + 1 fee de infante");
    assert.equal(c.cxpAereo, c.costoAereo, "la CxP aérea es el costo real");
    assert.equal(c.cxpHotel, 2 * 300000 + 2 * 120000);
    assert.equal(c.costoHotel, c.cxpHotel);
  });
  test("C3 reintento sobre la cotización ya convertida: mismos números, sin contratos, CxP, sillas ni numeración nuevos", async () => {
    const antes = totales();
    const r = await convertir(cotId);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.numeros, [numero]);
    assert.deepEqual(totales(), antes);
  });
  test("C4 cotización ANTIGUA sin edades (con menores declarados): se rechaza con un mensaje legible y pide generar una nueva — sin numerar ni escribir nada", async () => {
    const id = await cotizarCarrito();
    quitarClaveItem(id, "edadesMenores"); quitarClaveItem(id, "cantidadMenores");
    const antes = totales();
    const r = await convertir(id);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /anterior al registro de las edades de los menores/);
    assert.match(r.error ?? "", /cotización nueva/);
    assert.deepEqual(totales(), antes, "ni contrato, ni CxP, ni sillas, ni número");
    assert.equal(sql(`select estado from public.cotizaciones where id = ${id}`), "abierta");
  });
  test("C5 si lo recalculado no coincide con lo congelado no se numera: precio alterado, edades que cambian la clasificación, edades mal formadas", async () => {
    const id = await cotizarCarrito();
    const original = payloadItem(id);
    const antes = totales();
    setPayloadItem(id, "precio", Number(original.precio) + 1000);
    const rPrecio = await convertir(id);
    assert.equal(rPrecio.ok, false); assert.match(rPrecio.error ?? "", /el precio cambió desde que se generó la cotización/);
    assert.deepEqual(totales(), antes);
    setPayloadItem(id, "precio", original.precio);
    setPayloadItem(id, "edadesMenores", [1, 9]);          // el de 9 años es «niño» para este hotel, no infante
    const rClase = await convertir(id);
    assert.equal(rClase.ok, false);
    assert.deepEqual(totales(), antes);
    setPayloadItem(id, "edadesMenores", [1, "x"]);
    const rForma = await convertir(id);
    assert.equal(rForma.ok, false);
    assert.match(rForma.error ?? "", /no son válidas/);
    assert.deepEqual(totales(), antes);
  });
  test("C6 los conteos NO se usan para inferir edades: con conteos congelados distintos de lo que dan las edades, se detiene antes de numerar", async () => {
    const id = await cotizarCarrito();
    setPayloadItem(id, "infantes", 0); setPayloadItem(id, "ninos", 2);
    const antes = totales();
    const r = await convertir(id);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /clasificación de los menores cambió/);
    assert.deepEqual(totales(), antes);
  });
});

// ── Bordes de la guarda del precio congelado y de la conversión parcial por grupos ─────────────────────────────────────────────
// Dos destinos con un hotel cada uno (sin menores). Primera llamada: el 1.º grupo se crea y el 2.º falla al crear su CxP (trigger simulado); luego se
// intenta de nuevo con guardas que fallan (precio ausente/mal formado, precio distinto): el grupo que falla no numera ni escribe, y el error dice qué
// contratos SÍ quedaron creados.
const HOTEL_2 = 5420;
function sembrarSegundoHotel() {
  sql(`
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
      values (${HOTEL_2}, 5401, 'Hotel Segundo 254', 5401, 'COP', 0, 5, 6, 12, 1, 6, true) on conflict do nothing;
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
      values (${HOTEL_2}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2) on conflict do nothing;
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo)
      select ${HOTEL_2}, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa' where not exists (select 1 from public.hotel_temporadas where hotel_id = ${HOTEL_2});
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante)
      select ${HOTEL_2}, 'Estandar', 'Desayuno', 'ALTA', 150000, 100000, 50000, 30000, 40000 where not exists (select 1 from public.tarifa_hotel where hotel_id = ${HOTEL_2});
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes)
      select ${PAQ_PORCION}, ${HOTEL_2}, array['Estandar'], array['Desayuno'] where not exists (select 1 from public.armado_hoteles where paquete_id = ${PAQ_PORCION} and hotel_id = ${HOTEL_2});
  `);
}
const PAX_4A = [
  { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false },
  { nombres: "Luis", apellidos: "Gómez", tipoDoc: "CC", numeroDoc: "456", fechaNacimiento: "1988-05-05", nacionalidad: "Colombiana", esInfante: false },
  { nombres: "Eva", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "777", fechaNacimiento: "1991-02-02", nacionalidad: "Colombiana", esInfante: false },
  { nombres: "Leo", apellidos: "Mora", tipoDoc: "CC", numeroDoc: "888", fechaNacimiento: "1987-03-03", nacionalidad: "Colombiana", esInfante: false },
];
async function cotizacionDosDestinos(): Promise<number> {
  const mk = async (hotelId: number, nombre: string, destino: string, ref: string) => {
    const c = await computarReserva(clienteSesion() as never, reservaCot({ hotelId, edadesMenores: [], cantidadMenores: 0 }) as never);
    assert.equal(c.ok, true, JSON.stringify(c));
    return {
      modulo: "porcion_terrestre", paqueteId: PAQ_PORCION, hotelId, bloqueoId: null, hotelNombre: nombre, destino, categoria: "Estandar", regimen: "Desayuno",
      fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2,
      precio: c.ok ? c.data.precioVenta : 0, edadesMenores: [], cantidadMenores: 0, ref,
    };
  };
  const items = [await mk(HOTEL, "Hotel Infantes 254", "CARTAGENA 254", "item-0"), await mk(HOTEL_2, "Hotel Segundo 254", "SANTA MARTA 254", "item-1")];
  const detalle = { hoteles: [{ ref: "item-0", condiciones_tarifa: [] }, { ref: "item-1", condiciones_tarifa: [] }] };
  return Number(sql(`insert into public.cotizaciones (tipo, estado, tenant, moneda, payload, detalle, cliente, pax)
    values ('carrito', 'abierta', 'mayorista', 'COP', ${lit(JSON.stringify({ items, tours: [], cliente: CLIENTE }))}::jsonb, ${lit(JSON.stringify(detalle))}::jsonb, 'Ana Pérez', 4) returning id`));
}
const setItem = (id: number, pos: number, clave: string, valor: unknown) =>
  sql(`update public.cotizaciones set payload = jsonb_set(payload, '{items,${pos},${clave}}', ${lit(JSON.stringify(valor))}::jsonb) where id = ${id}`);
const quitarItem = (id: number, pos: number, clave: string) => sql(`update public.cotizaciones set payload = payload #- '{items,${pos},${clave}}' where id = ${id}`);
const convertirDos = async (id: number) => (await convertirCotizacionCarrito(id, {
  agrupar: "por_destino", pasajeros: PAX_4A, asesorInterno: "Asesor 254", asignaciones: [[1, 2], [3, 4]], asignacionesTours: [], monedaCobro: "COP",
})) as Res;
const contratosDe = (id: number) => (sql(`select coalesce(string_agg(c, ',' order by c), '') from (select jsonb_array_elements_text(detalle->'contratos') c from public.cotizaciones where id = ${id}) x`) || "").split(",").filter(Boolean);
const foto2 = () => ({ ...totales(), cxpHotelSegundo: Number(sql("select count(*) from public.cuentas_por_pagar where servicio = 'Hotel Hotel Segundo 254'")) });

describe("254 · bordes: precio congelado ausente o mal formado y conversión parcial por grupos", () => {
  test("B1 precio ausente, nulo, texto, NaN o negativo: se rechaza ANTES de numerar y de escribir (la guarda no se salta)", async () => {
    sembrarSegundoHotel();
    for (const caso of ["ausente", "nulo", "texto", "texto numérico", "negativo", "objeto"]) {
      const id = await cotizacionDosDestinos();
      if (caso === "ausente") quitarItem(id, 0, "precio");
      else if (caso === "nulo") setItem(id, 0, "precio", null);
      else if (caso === "texto") setItem(id, 0, "precio", "abc");
      else if (caso === "texto numérico") setItem(id, 0, "precio", "600000");
      else if (caso === "negativo") setItem(id, 0, "precio", -5);
      else setItem(id, 0, "precio", { v: 1 });
      const antes = foto2();
      const r = await convertirDos(id);
      assert.equal(r.ok, false, caso);
      assert.match(r.error ?? "", /no trae un precio congelado válido/, caso);
      assert.match(r.error ?? "", /cotización nueva/, caso);
      assert.doesNotMatch(r.error ?? "", /sí quedaron creados/, "ningún grupo se había creado");
      assert.deepEqual(foto2(), antes, `${caso}: ni contrato, ni CxP, ni número, ni sillas`);
      assert.equal(sql(`select estado from public.cotizaciones where id = ${id}`), "abierta", caso);
      assert.deepEqual(contratosDe(id), [], caso);
    }
  });
  test("B2 conversión parcial: el 1.er destino se crea y el 2.º falla; luego el 2.º es rechazado por una guarda nueva (precio ausente/mal formado/distinto) sin numerar, y el error lista el contrato que SÍ quedó creado", async () => {
    sql(`
      create table if not exists public.t254_interruptor (activo boolean);
      delete from public.t254_interruptor; insert into public.t254_interruptor values (true);
      create or replace function public.t254_falla() returns trigger language plpgsql as $f$
      begin
        if NEW.servicio = 'Hotel Hotel Segundo 254' and exists (select 1 from public.t254_interruptor where activo) then raise exception 'falla simulada 254'; end if;
        return NEW;
      end $f$;
      drop trigger if exists t254_falla on public.cuentas_por_pagar;
      create trigger t254_falla before insert on public.cuentas_por_pagar for each row execute function public.t254_falla();
    `);
    const id = await cotizacionDosDestinos();
    const r1 = await convertirDos(id);
    assert.equal(r1.ok, false, "el 2.º grupo falla al crear su CxP");
    const creados = contratosDe(id);
    assert.equal(creados.length, 1, "solo el 1.er destino quedó creado");
    const primero = creados[0];
    assert.match(r1.error ?? "", new RegExp(`${primero}.*sí quedaron completos`));
    const fotoPrimero = contrato(primero);
    assert.equal(sql(`select estado from public.cotizaciones where id = ${id}`), "abierta", "la cotización no se marca convertida");
    const antes = foto2();

    const verificarRechazo = (que: string, r: Res, patron: RegExp) => {
      assert.equal(r.ok, false, que);
      assert.match(r.error ?? "", patron, que);
      assert.ok((r.error ?? "").includes(primero), `${que}: el error nombra el contrato ya creado (${primero})`);
      assert.match(r.error ?? "", /sí quedaron creados/, que);
      assert.deepEqual(foto2(), antes, `${que}: el grupo que falla no numera ni escribe nada`);
      assert.deepEqual(contratosDe(id), [primero], `${que}: la cotización sigue apuntando solo al contrato creado`);
      assert.equal(sql(`select estado from public.cotizaciones where id = ${id}`), "abierta", que);
      assert.deepEqual(contrato(primero), fotoPrimero, `${que}: el contrato creado no se toca`);
    };
    const original = JSON.parse(sql(`select (payload->'items'->1->'precio')::text from public.cotizaciones where id = ${id}`));
    quitarItem(id, 1, "precio");
    verificarRechazo("precio ausente", await convertirDos(id), /no trae un precio congelado válido/);
    setItem(id, 1, "precio", "abc");
    verificarRechazo("precio mal formado", await convertirDos(id), /no trae un precio congelado válido/);
    setItem(id, 1, "precio", Number(original) + 1);
    verificarRechazo("precio distinto", await convertirDos(id), /el precio cambió desde que se generó la cotización/);

    // Restaurado el precio y sin la falla: completa el 2.º; el 1.º no se toca y no hay duplicados.
    setItem(id, 1, "precio", original);
    sql("update public.t254_interruptor set activo = false");
    const ok = await convertirDos(id);
    assert.equal(ok.ok, true, ok.error);
    assert.equal(ok.numeros!.length, 2);
    assert.equal(ok.numeros![0], primero, "el 1.er contrato conserva su número");
    assert.deepEqual(contrato(primero), fotoPrimero, "el 1.er contrato no se recreó");
    assert.equal(sql(`select estado from public.cotizaciones where id = ${id}`), "convertida");
    assert.equal(sql(`select count(*) from public.ventas where numero_contrato in (${ok.numeros!.map(lit).join(",")})`), "2");
    // Reintento tras completar: mismos números, nada nuevo.
    const despues = foto2();
    const otra = await convertirDos(id);
    assert.equal(otra.ok, true, otra.error);
    assert.deepEqual(otra.numeros, ok.numeros);
    assert.deepEqual(foto2(), despues, "sin contratos, CxP ni números duplicados al reintentar");
    sql("drop trigger if exists t254_falla on public.cuentas_por_pagar");
  });
});
