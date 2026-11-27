// REV2 (B95-16, 2026-11-26) — recorrido REAL Tarifario → comparativa → opción elegida → contrato → documento, contra PostgreSQL + PostgREST desechables.
// Lo lanza supabase/scripts/test_rev2_95docs.sh con R2_ARCHIVOS=pruebas/f95tarifario.rev2.pg.ts (no corre en `npm run test:*`). Derivado del arnés de f95docsFidelidad.rev2.pg.ts / alcance262.pg.ts.
// REAL: generarTarifario (motor de precios), crearComparativaCarrito, elegirOpcionComparativa (reliquidación en vivo + RPC), convertirCotizacionCarrito, registrarAbono, filas persistidas releídas.
// Simulado SOLO: la sesión (auth.getUser sobre un cliente PostgREST real con JWT), la numeración (RPC real) y efectos laterales ajenos (mismos stubs que los demás arneses).
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG95_CONTENEDOR ?? "";
const DB = process.env.PG95_BASE ?? "";
const PGRST = process.env.PG95_POSTGREST ?? "";
const SECRETO = process.env.PG95_JWT_SECRET ?? "";
if (!CT || !DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG95_*: usa supabase/scripts/test_r2_95_acciones.sh.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = {
  "server-only": "export {}",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
  "next/headers": "export async function headers() { return new Map([['host', 'localhost']]); } export async function cookies() { return { get: () => undefined, getAll: () => [] }; }",
  "next/navigation": "export function notFound() { throw new Error('NEXT_NOT_FOUND'); } export function redirect(u) { throw new Error('REDIRECT ' + u); } export function useRouter() { return {}; }",
};
registerHooks({ resolve(specifier, context, nextResolve) {
  const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
  try { return nextResolve(specifier, context); } catch (e) {
    if (specifier.startsWith(".") && !/.[a-z]+$/.test(specifier)) { for (const suf of [".ts", ".tsx", "/index.ts"]) { try { return nextResolve(specifier + suf, context); } catch { /* sigue */ } } }
    throw e;
  }
} });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const UID_SUPER = "00000000-0000-0000-0000-000000950001";
const UID_ADMIN = "00000000-0000-0000-0000-000000950002";
const UID_OPS = "00000000-0000-0000-0000-000000950003";
let uidSesion: string = UID_SUPER; // "" = visitante anonimo (sin sesion)
const sidDe = (uid: string) => uid.replace(/^00000000/, "5e550000");
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-95";
const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteAnonimo = () => { const sb = clienteLocal(jwt({ role: "anon" })); (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: null }, error: null }); return sb; };
const clienteSesion = () => (uidSesion === "" ? clienteAnonimo() : clienteLocal(jwt({ role: "authenticated", sub: uidSesion, session_id: sidDe(uidSesion) }), { id: uidSesion, email: `${uidSesion}@x.test` }));

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
}
const lit = (v: unknown) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/cotizacion/acceso", { namedExports: { contextoCotizacion: async () => ({ ok: true, superadmin: true, interno: true, tenant: "mayorista" }), autorizaTenant: () => true } });
mock.module("@/lib/contrato/congelarCondicionesContrato", {
  namedExports: { componenteHotelReal: async () => null, componentePaqueteReal: async () => null, trmReferenciaAproximada: async () => null, congelarCondicionesContratoBestEffort: async () => {} },
});
const { interpretarRespuestaNumeroContrato } = await import("../lib/contrato/numeracionPuro.ts");
mock.module("@/lib/contrato/numeracion", {
  namedExports: { siguienteNumeroContrato: async (tenant: string) => { const { data, error } = await clienteLocal(TOKEN_SERVICIO).rpc("siguiente_numero_contrato_para_tenant", { p_tenant: tenant }); return interpretarRespuestaNumeroContrato(data, error as never); } },
});
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });


const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const { crearComparativaCarrito, elegirOpcionComparativa, resumenOpcionComparativa } = await import("../app/tarifario/checkout/actions.ts");
const { crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");
const { convertirCotizacionCarrito } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { registrarAbono } = await import("../app/(dashboard)/dashboard/contratos/actions.ts");
const { identidadDe } = await import("../lib/contrato/identidad.ts");
const { inclusionesDeContrato } = await import("../lib/contrato/inclusionesContrato.ts");
import fs from "node:fs";
import path from "node:path";
const EVID = process.env.PG95_EVIDENCIA ?? "";

// ── Semilla propia (ids 9560+): un paquete de PORCIÓN TERRESTRE con DOS hoteles de categoría/plan distintos y tarifa de niño distinta ─────────────────
// Markup 20 %: PVP = neto / 0,8. Netos elegidos para que cada PVP sea exacto al peso (sin redondeo que enmascare el oráculo):
//   Alfa «Estandar» / «Desayuno»: adulto neto 100.000/noche → 125.000/noche → 375.000 por 3 noches; niño neto 40.000/noche → 50.000/noche → 150.000.
//   Beta «Superior» / «Todo incluido»: adulto neto 128.000/noche → 160.000/noche → 480.000; niño GRATIS (neto 0).
//   Asistencia médica (opcional, por persona): neto 32.000 → 40.000 por persona (3 pax = 120.000), vinculada a CADA hotel.
// Oráculo a mano (2 adultos + 1 niño de 8 años, 3 personas con asistencia):
//   A = 2 × 375.000 + 150.000 + 3 × 40.000 = 1.020.000     B = 2 × 480.000 + 0 + 3 × 40.000 = 1.080.000
const DEST = 9560, PROV = 9560, HOT_A = 9561, HOT_B = 9562, PAQ = 9560, S_ASIS = 9561;
const ALTA = (s: number) => 956000 + s;
const TOTAL_A = 1_020_000, TOTAL_B = 1_080_000;
before(() => {
  sql(`
    insert into auth.users (id, email) values ('${UID_SUPER}', 'super95@x.test'), ('${UID_ADMIN}', 'admin95@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
      ('${UID_SUPER}', 'super95@x.test', 'Super 95', 'superadmin', true, 'mayorista'),
      ('${UID_ADMIN}', 'admin95@x.test', 'Admin 95', 'administracion', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into auth.sessions (id, user_id) select ('5e550000' || substr(id::text, 9))::uuid, id from public.usuarios where id in ('${UID_SUPER}', '${UID_ADMIN}') on conflict do nothing;
    insert into public.sesion_agencia (session_id, user_id, tenant) values ('${sidDe(UID_SUPER)}', '${UID_SUPER}', 'mayorista') on conflict do nothing;
    insert into public.destinos (id, nombre) values (${DEST}, 'CARTAGENA 95T') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (${PROV}, 'Proveedor 95T') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
      values (${HOT_A}, ${DEST}, 'Hotel Alfa 95T', ${PROV}, 'COP', 0, 5, 6, 12, 1, 6, true), (${HOT_B}, ${DEST}, 'Hotel Beta 95T', ${PROV}, 'COP', 0, 5, 6, 12, 1, 6, true);
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
      values (${HOT_A}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (${HOT_B}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (${HOT_A}, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa'), (${HOT_B}, 'ALTA', '2030-01-01', '2030-12-31', 1, 'tarifa');
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante) values
      (${HOT_A}, 'Estandar', 'Desayuno', 'ALTA', 150000, 100000, 40000, 30000, 20000),
      (${HOT_B}, 'Superior', 'Todo incluido', 'ALTA', 200000, 128000, 0, 0, 0);
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo)
      values (${PAQ}, 'Porción 95T', 'porcion_terrestre', 3, ${DEST}, 0.2, 'fijo', 0, '2030-01-01', '2030-12-31', 'COP', 'COP', true);
    insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values
      (${PAQ}, ${HOT_A}, array['Estandar'], array['Desayuno']), (${PAQ}, ${HOT_B}, array['Superior'], array['Todo incluido']);
    insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion, tipo_receptivo)
      values (${S_ASIS}, 'Asistencia médica 95T', ${PROV}, ${DEST}, 32000, 'asistencia', 'COP', 'persona', 'paquete', 'asistencia_medica');
    insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (${ALTA(S_ASIS)}, ${S_ASIS}, 'ALTA', '2030-01-01', '2030-12-31', 32000);
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (${PAQ}, ${S_ASIS}, 'persona', false);
  `);
});

const CLIENTE = { nombres: "Visitante", apellidos: "Tarifario", numeroDoc: "900956001", telefono: "3009560001", email: "visitante.tarifario@example.com", tipoDoc: "CC" };
const PAX = [
  { nombres: "Visitante", apellidos: "Tarifario", tipoDoc: "CC", numeroDoc: "900956001", fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false },
  { nombres: "Acompañante", apellidos: "Tarifario", tipoDoc: "CC", numeroDoc: "900956002", fechaNacimiento: "1991-02-02", nacionalidad: "Colombiana", esInfante: false },
  { nombres: "Menor", apellidos: "Tarifario", tipoDoc: "TI", numeroDoc: "900956003", fechaNacimiento: "2022-01-01", nacionalidad: "Colombiana", esInfante: false },
];
const itemHotel = (hotelId: number, nombre: string, categoria: string, regimen: string) => ({
  modulo: "porcion_terrestre", paqueteId: PAQ, hotelId, bloqueoId: null, hotelNombre: nombre, destino: "CARTAGENA 95T", categoria, regimen, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04",
  noches: 3, habitaciones: { doble: 1 }, ninos: 1, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [8], cantidadMenores: 1, itemId: "h" + hotelId,
});
const entradaComparativa = () => ({
  items: [itemHotel(HOT_A, "Hotel Alfa 95T", "Estandar", "Desayuno"), itemHotel(HOT_B, "Hotel Beta 95T", "Superior", "Todo incluido")],
  tours: [HOT_A, HOT_B].map((h) => ({ servicioId: S_ASIS, paqueteId: PAQ, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 3, hotelItemId: "h" + h })),
  cliente: CLIENTE,
});
type Opc = { op: string; ac: string; total: number; etiqueta: string };
const opciones = (madreId: number) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('op', opcion_ref, 'ac', acomodacion_ref, 'total', total::float8, 'etiqueta', etiqueta) order by orden), '[]')::text from public.cotizacion_opciones where cotizacion_id = ${madreId}`)) as Opc[];
const madreDe = (id: number) => JSON.parse(sql(`select json_build_object('token', share_token, 'version', version)::text from public.cotizaciones where id = ${id}`)) as { token: string; version: number };
const centavos = (n: number) => Math.round(n * 100);
type Item = { descripcion: string; adultos: number; ninos: number; tarifa_adulto: number | string; tarifa_nino: number | string; modo_precio?: string; orden?: number };
const filas = (n: string) => ({
  venta: JSON.parse(sql(`select row_to_json(v)::text from (select numero_contrato, cliente, cliente_documento, estado, moneda, precio_venta::float8 precio_venta, pax, fecha_salida, fecha_regreso, asesor, tipo_asesor, tenant, destino, plan_nombre, hotel, tours_traslados, asistencia_medica from public.ventas where numero_contrato = ${lit(n)}) v`)) as Record<string, any>,
  items: JSON.parse(sql(`select coalesce(json_agg(row_to_json(i) order by orden, id), '[]'::json)::text from (select id, numero_contrato, descripcion, adultos, ninos, tarifa_adulto::float8 tarifa_adulto, tarifa_nino::float8 tarifa_nino, orden, modo_precio from public.contrato_items where numero_contrato = ${lit(n)}) i`)) as Item[],
  hoteles: JSON.parse(sql(`select coalesce(json_agg(row_to_json(h) order by orden), '[]'::json)::text from (select * from public.contrato_hoteles where numero_contrato = ${lit(n)}) h`)) as Record<string, any>[],
  pasajeros: JSON.parse(sql(`select coalesce(json_agg(row_to_json(p) order by orden), '[]'::json)::text from (select * from public.contrato_pasajeros where numero_contrato = ${lit(n)}) p`)) as Record<string, any>[],
  resumen: JSON.parse(sql(`select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (select * from public.contrato_resumen_precios where numero_contrato = ${lit(n)}) r`)) as Record<string, any>[],
  servicios: JSON.parse(sql(`select coalesce(json_agg(row_to_json(s)), '[]'::json)::text from (select id, descripcion, tipo, costo::float8 costo from public.contrato_servicios where numero_contrato = ${lit(n)}) s`)) as Record<string, any>[],
  pagado: Number(sql(`select coalesce(sum(valor_abono), 0)::text from public.abonos where numero_contrato = ${lit(n)}`)),
});


const itemSin = (hotelId: number, nombre: string, categoria: string, regimen: string) => ({ ...itemHotel(hotelId, nombre, categoria, regimen), ninos: 0, edadesMenores: [], cantidadMenores: 0 });
const entrada = (conNino: boolean) => ({
  items: [conNino ? itemHotel(HOT_A, "Hotel Alfa 95T", "Estandar", "Desayuno") : itemSin(HOT_A, "Hotel Alfa 95T", "Estandar", "Desayuno"),
          conNino ? itemHotel(HOT_B, "Hotel Beta 95T", "Superior", "Todo incluido") : itemSin(HOT_B, "Hotel Beta 95T", "Superior", "Todo incluido")],
  tours: [HOT_A, HOT_B].map((h) => ({ servicioId: S_ASIS, paqueteId: PAQ, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: conNino ? 3 : 2, hotelItemId: "h" + h })),
  cliente: CLIENTE,
});
const paxDe = (conNino: boolean) => (conNino ? PAX : PAX.slice(0, 2));
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(956000000000 + ++seq)}`;
const ESC = {
  conNino: { A: 1_020_000, B: 1_080_000 }, // 2 × 375.000 + 150.000 + 3 × 40.000 · 2 × 480.000 + 0 + 3 × 40.000
  soloAdultos: { A: 830_000, B: 1_040_000 }, // 2 × 375.000 + 2 × 40.000 · 2 × 480.000 + 2 × 40.000
};

/** Crea la comparativa (con la sesión indicada), elige la opción (con la sesión indicada) y convierte la hija con personal interno. */
async function recorrer(o: { crea: string; elige: string; conNino: boolean; opcion: "A" | "B" }) {
  uidSesion = o.crea;
  const c = await crearComparativaCarrito(entrada(o.conNino) as never) as { ok: boolean; id?: number; error?: string };
  assert.equal(c.ok, true, c.error);
  const ops = opciones(c.id!);
  const total = ESC[o.conNino ? "conNino" : "soloAdultos"][o.opcion];
  assert.deepEqual(ops.map((x) => x.total), [ESC[o.conNino ? "conNino" : "soloAdultos"].A, ESC[o.conNino ? "conNino" : "soloAdultos"].B], "totales de las dos opciones = oráculo a mano");
  const op = ops[o.opcion === "A" ? 0 : 1];
  const m = madreDe(c.id!);
  uidSesion = o.elige;
  const el = await elegirOpcionComparativa({ token: m.token, version: m.version, opcionRef: op.op, acomodacionRef: op.ac, clave: uuid(), ...(o.elige === "" ? { cliente: CLIENTE } : {}) }) as { ok: boolean; hijaId?: number; error?: string };
  assert.equal(el.ok, true, el.error);
  uidSesion = UID_SUPER;
  const conv = await convertirCotizacionCarrito(el.hijaId!, { agrupar: "todo", pasajeros: paxDe(o.conNino), asesorInterno: "Asesor 95T", asignaciones: [paxDe(o.conNino).map((_, i) => i + 1)], asignacionesTours: [paxDe(o.conNino).map((_, i) => i + 1)], monedaCobro: "COP" } as never) as { ok: boolean; numeros?: string[]; error?: string };
  assert.equal(conv.ok, true, conv.error);
  assert.equal(conv.numeros!.length, 1);
  return { madreId: c.id!, hijaId: el.hijaId!, numero: conv.numeros![0], total, op };
}

/** Suma de las líneas por persona guardadas, en centavos. */
const sumaLineas = (items: Item[]) => items.filter((i) => (i.modo_precio ?? "por_persona") === "por_persona").reduce((s, i) => s + centavos(Number(i.adultos) * Number(i.tarifa_adulto)) + centavos(Number(i.ninos) * Number(i.tarifa_nino)), 0);

async function pagarTodo(numero: string) {
  uidSesion = UID_SUPER;
  const f0 = filas(numero);
  const saldo = (centavos(f0.venta.precio_venta) - centavos(f0.pagado)) / 100;
  const idc = identidadDe(numero, sql(`select contrato_uid from public.ventas where numero_contrato = ${lit(numero)}`));
  const r = await registrarAbono(numero, saldo, "transferencia", `B95-16 ${numero}`, undefined, undefined, undefined, uuid(), idc);
  assert.equal((r as { ok: boolean }).ok, true, JSON.stringify(r));
  const f = filas(numero);
  return { saldo: (centavos(f.venta.precio_venta) - centavos(f.pagado)) / 100, f };
}

function volcar(nombre: string, extra: Record<string, unknown>, n: string, hijaId: number) {
  if (!EVID) return;
  fs.mkdirSync(EVID, { recursive: true });
  const f = filas(n);
  const cot = JSON.parse(sql(`select row_to_json(c)::text from (select id, codigo, modo, tipo, estado, moneda, precio_venta::float8 precio_venta, pax, cliente, destino, fecha_salida, fecha_regreso, vigencia_hasta, detalle, payload from public.cotizaciones where id = ${hijaId}) c`));
  fs.writeFileSync(path.join(EVID, `${nombre}.json`), JSON.stringify({ contexto: extra, ...f, cotizacion_hija: cot }, null, 2));
}

describe("REV2 · B95-16 · Tarifario → comparativa → opción elegida → contrato (acciones reales)", () => {
  test("X0 se publica el tarifario del paquete con los dos hoteles (motor real)", async () => {
    uidSesion = UID_SUPER;
    const g = await generarTarifario(PAQ);
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.equal(Number(sql(`select count(*) from public.tarifario_resultado_publicable where paquete_id = ${PAQ}`)) > 0, true);
  });

  // D0 (CERRADO en esta ronda). Antes: el motor leía `hotel_acomodaciones` con la sesión del visitante y la política de lectura (027) exige `auth.uid() is not null`, así que un visitante sin sesión recibía los defaults
  // (pax_max = pax_tarifa → «admite máximo 0 niño(s)»). Ahora `computarReserva` lee SOLO esas columnas de ocupación con el cliente de servicio (sin tocar la política: la tabla sigue cerrada al visitante por la API).
  describe("D0 · visitante sin sesión con un niño (checkout público, acciones reales)", () => {
    const UID_AGENCIA = "00000000-0000-0000-0000-000000950004", UID_FREE = "00000000-0000-0000-0000-000000950005";
    before(() => {
      sql(`
        insert into auth.users (id, email) values ('${UID_AGENCIA}', 'agencia95@x.test'), ('${UID_FREE}', 'free95@x.test') on conflict do nothing;
        insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
          ('${UID_AGENCIA}', 'agencia95@x.test', 'Agencia 95', 'agencia', true, 'mayorista'), ('${UID_FREE}', 'free95@x.test', 'Freelance 95', 'freelance', true, 'mayorista')
          on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
        insert into auth.sessions (id, user_id) select ('5e550000' || substr(id::text, 9))::uuid, id from public.usuarios where id in ('${UID_AGENCIA}', '${UID_FREE}') on conflict do nothing;
      `);
    });
    type Sol = { ok: boolean; error?: string; cotizacion?: { id: number } };
    const solicitar = async (uid: string, item = itemHotel(HOT_A, "Hotel Alfa 95T", "Estandar", "Desayuno")) => { uidSesion = uid; return await crearSolicitudReserva({ items: [item], tours: [], hotelDeTour: [], cliente: CLIENTE } as never) as Sol; };
    const conMenores = (edades: number[], extra: Record<string, unknown> = {}) => ({ ...itemHotel(HOT_A, "Hotel Alfa 95T", "Estandar", "Desayuno"), ninos: edades.length, edadesMenores: edades, cantidadMenores: edades.length, ...extra });
    /** Total y líneas guardadas de la cotización creada: 2 adultos 375.000 + niño 8 años 150.000 = 900.000 (oráculo a mano). */
    const cotizado = (id: number) => JSON.parse(sql(`select row_to_json(c)::text from (select precio_venta::float8 precio_venta, pax, detalle::text detalle from public.cotizaciones where id = ${id}) c`)) as { precio_venta: number; pax: number; detalle: string };

    test("D0 un visitante SIN sesión cotiza una doble con un niño de 8 años: la solicitud se crea con el precio exacto (2 × 375.000 + 150.000)", async () => {
      const r = await solicitar("");
      assert.equal(r.ok, true, r.error);
      const c = cotizado(r.cotizacion!.id);
      assert.equal(c.precio_venta, 900_000);
      assert.equal(c.pax, 3);
      assert.ok(!c.detalle.includes("Proveedor 95T") && !/"(neto|costo)[a-z_0-9]*":s*[1-9]/i.test(c.detalle), "la cotización del visitante no lleva el nombre del proveedor ni importes netos/costo");
    });
    test("D0b el mismo caso con sesión interna, agencia y freelance sigue funcionando y da el MISMO precio al visitante", async () => {
      for (const uid of [UID_SUPER, UID_ADMIN, UID_AGENCIA, UID_FREE]) {
        const r = await solicitar(uid);
        assert.equal(r.ok, true, `${uid}: ${r.error}`);
        // agencia/freelance pueden ver la neta (otro valor); lo que no puede cambiar es que el visitante y los internos coincidan.
        if (uid === UID_SUPER || uid === UID_ADMIN) assert.equal(cotizado(r.cotizacion!.id).precio_venta, 900_000, uid);
      }
    });
    test("D0c rechazos que NO dependen de la sesión: más niños que la capacidad de la doble, niño en un hotel Adults Only y edades que no cuadran", async () => {
      // doble: chd_max = 2 → 3 niños rechazados también para el visitante (ya no por «máximo 0»).
      const tres = await solicitar("", conMenores([8, 9, 10]) as never);
      assert.equal(tres.ok, false); assert.match(String(tres.error), /m[aá]ximo 2 ni[nñ]o/i, tres.error);
      // 2 niños sí caben.
      const dos = await solicitar("", conMenores([8, 9]) as never);
      assert.equal(dos.ok, true, dos.error);
      // Adults Only: el niño se rechaza (visitante y sesión interna), sin tocar la configuración de ocupación.
      sql(`update public.hoteles set adults_only = true where id = ${HOT_A}`);
      try {
        for (const uid of ["", UID_SUPER]) { const r = await solicitar(uid); assert.equal(r.ok, false, `adults only (${uid || "visitante"})`); assert.match(String(r.error), /adult|ni[nñ]o|menor/i, r.error); }
      } finally { sql(`update public.hoteles set adults_only = false where id = ${HOT_A}`); }
      // Solo adultos con el mismo hotel sigue cotizando para el visitante (control: el fix no cambió el caso sin niños).
      const adultos = await solicitar("", { ...itemHotel(HOT_A, "Hotel Alfa 95T", "Estandar", "Desayuno"), ninos: 0, edadesMenores: [], cantidadMenores: 0 } as never);
      assert.equal(adultos.ok, true, adultos.error);
      assert.equal(cotizado(adultos.cotizacion!.id).precio_venta, 750_000);
    });
    test("D0d la tabla sigue cerrada al visitante por la API: no lee hotel_acomodaciones, tarifa_hotel ni proveedores, y no puede escribir", async () => {
      const anon = clienteAnonimo();
      for (const t of ["hotel_acomodaciones", "tarifa_hotel", "proveedores"]) {
        const { data, error } = await anon.from(t).select("*").limit(5);
        assert.ok(error != null || (data ?? []).length === 0, `el visitante no debe leer ${t}: ${JSON.stringify(data)?.slice(0, 120)}`);
      }
      const ins = await anon.from("hotel_acomodaciones").insert({ hotel_id: HOT_A, acomodacion: "triple", pax_tarifa: 3, pax_max: 9, chd_max: 9 }).select();
      assert.ok(ins.error != null || (ins.data ?? []).length === 0, "el visitante no puede insertar");
      const upd = await anon.from("hotel_acomodaciones").update({ chd_max: 9 }).eq("hotel_id", HOT_A).select();
      assert.ok(upd.error != null || (upd.data ?? []).length === 0, "el visitante no puede actualizar");
      assert.equal(sql(`select chd_max from public.hotel_acomodaciones where hotel_id = ${HOT_A} and acomodacion = 'doble'`), "2", "la capacidad guardada no cambió");
      assert.equal(sql(`select count(*) from public.hotel_acomodaciones where hotel_id = ${HOT_A}`), "1");
    });
  });

  let resumenB: unknown = null;
  const previstas = (n: string) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('servicio', payload->>'servicio', 'tipo', payload->>'tipo_proveedor', 'valor', (payload->>'valor_total')::float8, 'proveedor', payload->>'proveedor') order by id), '[]')::text from public.contrato_obligaciones_previstas where numero_contrato = ${lit(n)} and clase = 'cxp' and materializada_en is null`)) as { servicio: string; tipo: string; valor: number; proveedor: string }[];

  /** Lo que TODO contrato convertido desde la comparativa del Tarifario debe cumplir, con la opción elegida y los valores calculados a mano. */
  function verificar(r: Awaited<ReturnType<typeof recorrer>>, esp: { hotel: string; categoria: string; regimen: string; ninoTarifa: number; adultoTarifa: number; asistencia: number; netoHotel: number; netoAsis: number; pax: number; conNino: boolean }) {
    const f = filas(r.numero);
    assert.equal(f.venta.precio_venta, r.total, "el contrato nace con el precio exacto de la opción elegida");
    assert.equal(f.venta.estado, "pendiente");
    assert.equal(sumaLineas(f.items), centavos(r.total), "las líneas guardadas suman EXACTAMENTE el precio (sin ajuste ni tolerancia)");
    // líneas: habitación (adultos), niño (si hay) y el servicio; ninguna otra y ninguna de «ajuste».
    const hab = f.items.find((i) => /^1 hab Doble \(2 pax\)/.test(i.descripcion))!;
    assert.ok(hab, "línea de la habitación elegida");
    assert.equal(hab.descripcion, `1 hab Doble (2 pax) · ${esp.categoria} / ${esp.regimen}`);
    assert.deepEqual([hab.adultos, hab.tarifa_adulto], [2, esp.adultoTarifa], "tarifa del adulto de LA opción (calculada a mano)");
    const nino = f.items.find((i) => /^Niño 1 · /.test(i.descripcion));
    if (esp.conNino) { assert.ok(nino, "línea del niño"); assert.deepEqual([nino!.ninos, nino!.tarifa_nino], [1, esp.ninoTarifa], "tarifa REAL del niño de la opción"); } else assert.equal(nino, undefined);
    const serv = f.items.filter((i) => /^Servicio · /.test(i.descripcion));
    assert.equal(serv.length, 1); assert.equal(serv[0].tarifa_adulto, esp.asistencia);
    assert.equal(f.items.length, 2 + (esp.conNino ? 1 : 0), "ninguna línea extra (ni ajuste de redondeo)");
    assert.ok(!f.items.some((i) => /ajuste|redondeo/i.test(i.descripcion)), "sin línea de ajuste");
    // hotel elegido
    assert.equal(f.hoteles.length, 1, "UN hotel: el elegido, nunca el de la otra opción");
    const h = f.hoteles[0];
    assert.deepEqual([h.nombre, h.categoria, h.alimentacion, h.proveedor], [esp.hotel, esp.categoria, esp.regimen, "Proveedor 95T"]);
    assert.deepEqual([h.ciudad, h.fecha_ingreso, h.fecha_salida], ["CARTAGENA 95T", "2030-03-01", "2030-03-04"]);
    // DIFERENCIA CON LA RUTA MANUAL (preexistente, no se cambia): convertirCotizacionCarrito guarda la CATEGORÍA también en `acomodacion`; el tipo de habitación va en `detalle_acomodacion`.
    assert.equal(h.acomodacion, esp.categoria);
    assert.match(String(h.detalle_acomodacion), esp.conNino ? /^1 hab Doble \(2 pax\), 1 Niño 1$/ : /^1 hab Doble \(2 pax\)$/);
    assert.equal(f.pasajeros.length, esp.pax);
    // REV2: el resumen por pasajero (#94) se congela igual que en el carrito normal (antes la opción elegida de una comparativa NO lo traía y el niño aparecía en $0 con la asistencia repartida solo entre adultos).
    assert.equal(f.resumen.length, 1, "contrato_resumen_precios congelado");
    // obligaciones previstas (CxP al confirmar): costo NETO del hotel y de la asistencia, calculados a mano, con el proveedor del catálogo.
    const pv = previstas(r.numero);
    assert.deepEqual(pv.map((p) => [p.tipo, p.valor]).sort(), [["asistencia", esp.netoAsis], ["hotel", esp.netoHotel]].sort(), `obligaciones: ${JSON.stringify(pv)}`);
    return f;
  }

  // Netos a mano: hotel B = 2 adultos × 128.000 × 3 noches = 768.000 (niño 0); hotel A = 2 × 100.000 × 3 + 1 niño × 40.000 × 3 = 720.000. Asistencia neto 32.000 por persona.
  const B_NINO = { hotel: "Hotel Beta 95T", categoria: "Superior", regimen: "Todo incluido", ninoTarifa: 0, adultoTarifa: 480_000, asistencia: 120_000, netoHotel: 768_000, netoAsis: 96_000, pax: 3, conNino: true };
  const A_NINO = { hotel: "Hotel Alfa 95T", categoria: "Estandar", regimen: "Desayuno", ninoTarifa: 150_000, adultoTarifa: 375_000, asistencia: 120_000, netoHotel: 720_000, netoAsis: 96_000, pax: 3, conNino: true };

  test("J1 PERSONAL INTERNO · con un niño · opción B (Hotel Beta, niño GRATIS): comparativa → elegir → convertir → pagar; el contrato conserva hotel, plan, tarifa del niño y total", async (t) => {
    const r = await recorrer({ crea: UID_SUPER, elige: UID_SUPER, conNino: true, opcion: "B" });
    const f = verificar(r, B_NINO);
    resumenB = f.resumen[0].resumen;
    t.diagnostic(`items=${JSON.stringify(f.items.map((i) => [i.descripcion.slice(0, 60), i.adultos, i.ninos, i.tarifa_adulto, i.tarifa_nino]))} resumen=${f.resumen.length}`);
    const pago = await pagarTodo(r.numero);
    assert.equal(pago.saldo, 0, "pagado por completo → saldo cero");
    volcar("rev2_tarifario_B_con_nino", { opcion: "B", conNino: true, canal: "interno", total: r.total }, r.numero, r.hijaId);
  });

  test("J1b PERSONAL INTERNO · con un niño · opción A (Hotel Alfa, niño CON tarifa 150.000): el niño NO es gratis y el contrato lo conserva", async () => {
    const r = await recorrer({ crea: UID_SUPER, elige: UID_SUPER, conNino: true, opcion: "A" });
    verificar(r, A_NINO);
    const pago = await pagarTodo(r.numero);
    assert.equal(pago.saldo, 0);
    volcar("rev2_tarifario_A_con_nino", { opcion: "A", conNino: true, canal: "interno", total: r.total }, r.numero, r.hijaId);
  });

  test("J2 VISITANTE SIN SESIÓN · solo adultos · opción B: crea la comparativa, elige y el interno convierte (hotel, plan y total de la opción B)", async () => {
    const r = await recorrer({ crea: "", elige: "", conNino: false, opcion: "B" });
    verificar(r, { ...B_NINO, conNino: false, pax: 2, asistencia: 80_000, netoHotel: 768_000, netoAsis: 64_000 });
    // La comparativa del visitante quedó registrada con su titular en la hija (titular de la opción elegida), sin datos de netos.
    assert.equal(sql(`select (payload->'cliente'->>'numeroDoc') from public.cotizaciones where id = ${r.hijaId}`), "900956001");
    const pago = await pagarTodo(r.numero);
    assert.equal(pago.saldo, 0);
    volcar("rev2_tarifario_B_visitante_adultos", { opcion: "B", conNino: false, canal: "visitante", total: r.total }, r.numero, r.hijaId);
  });

  test("J2c VISITANTE SIN SESIÓN · con un niño · opciones A y B: crea la comparativa, elige y el interno convierte (tarifa REAL del niño y total de la opción)", async () => {
    for (const [opcion, esp] of [["B", B_NINO], ["A", A_NINO]] as const) {
      const r = await recorrer({ crea: "", elige: "", conNino: true, opcion });
      verificar(r, esp);
      assert.equal(sql(`select (payload->'cliente'->>'numeroDoc') from public.cotizaciones where id = ${r.hijaId}`), "900956001");
      const pago = await pagarTodo(r.numero);
      assert.equal(pago.saldo, 0);
      volcar(`rev2_tarifario_${opcion}_visitante_con_nino`, { opcion, conNino: true, canal: "visitante", total: r.total }, r.numero, r.hijaId);
    }
  });

  test("J4 CARRITO NORMAL (sin comparativa) con los mismos datos: misma opción B, mismo total; qué difiere del camino de la comparativa", async (t) => {
    uidSesion = UID_SUPER;
    const e = entrada(true);
    const q = await crearSolicitudReserva({ items: [e.items[1]], tours: [e.tours[1]], hotelDeTour: [0], cliente: CLIENTE } as never) as { ok: boolean; error?: string; cotizacion?: { id: number } };
    assert.equal(q.ok, true, q.error);
    const conv = await convertirCotizacionCarrito(Number(q.cotizacion!.id), { agrupar: "todo", pasajeros: PAX, asesorInterno: "Asesor 95T", asignaciones: [[1, 2, 3]], asignacionesTours: [[1, 2, 3]], monedaCobro: "COP" } as never) as { ok: boolean; numeros?: string[]; error?: string };
    assert.equal(conv.ok, true, conv.error);
    const n = conv.numeros![0];
    const f = filas(n);
    t.diagnostic(`items=${JSON.stringify(f.items.map((i) => [i.descripcion.slice(0, 60), i.adultos, i.ninos, i.tarifa_adulto, i.tarifa_nino]))} resumen=${f.resumen.length} hoteles=${JSON.stringify(f.hoteles.map((h) => [h.nombre, h.categoria, h.alimentacion, h.acomodacion, h.detalle_acomodacion]))}`);
    assert.equal(f.venta.precio_venta, ESC.conNino.B, "el mismo total que por la comparativa");
    assert.equal(sumaLineas(f.items), centavos(ESC.conNino.B));
    assert.deepEqual([f.hoteles[0].nombre, f.hoteles[0].categoria, f.hoteles[0].alimentacion, f.hoteles[0].acomodacion, f.hoteles[0].detalle_acomodacion], ["Hotel Beta 95T", "Superior", "Todo incluido", "Superior", "1 hab Doble (2 pax), 1 Niño 1"], "el mismo hotel, plan y detalle de habitación que por la comparativa");
    assert.equal(f.resumen.length, 1);
    assert.deepEqual(f.resumen[0].resumen, resumenB, "el resumen por pasajero del contrato es IDÉNTICO por la comparativa y por el carrito normal (misma opción, mismos datos)");
    await pagarTodo(n);
    volcar("rev2_tarifario_B_carrito_normal", { opcion: "B", conNino: true, canal: "interno-carrito-normal", total: ESC.conNino.B }, n, Number(q.cotizacion!.id));
  });

  test("J3 la madre de la comparativa NUNCA se convierte (solo su hija elegida) ", async () => {
    uidSesion = UID_SUPER;
    const c = await crearComparativaCarrito(entrada(true) as never) as { ok: boolean; id?: number };
    assert.equal(c.ok, true);
    const rm = await convertirCotizacionCarrito(c.id!, { agrupar: "todo", pasajeros: PAX, asesorInterno: "Asesor 95T", asignaciones: [[1, 2, 3]], asignacionesTours: [[1, 2, 3]], monedaCobro: "COP" } as never) as { ok: boolean; error?: string };
    assert.equal(rm.ok, false, "convertir la MADRE debe fallar");
    assert.equal(sql(`select coalesce(numero_contrato, '') from public.cotizaciones where id = ${c.id}`), "");
  });
});
