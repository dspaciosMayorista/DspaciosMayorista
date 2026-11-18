// #1 — el carrito público del Tarifario (checkout) deja a su titular consultable en el CRM sin contrato: visitante anónimo, personal interno y aliado B2B,
// con reintento por la misma clave de envío. Recorrido REAL de crearSolicitudReserva contra PostgreSQL + PostgREST locales; solo el PRECIO del hotel se simula
// (igual que cotizacionAsistidaB2B102.pg.ts: el precio no es lo que se prueba). Lo lanza supabase/scripts/test_1_personas_cotizaciones.sh.
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG902_CONTENEDOR ?? "";
const DB = process.env.PG902_BASE ?? "";
const PGRST = process.env.PG902_POSTGREST ?? "";
const SECRETO = process.env.PG902_JWT_SECRET ?? "";
if (!CT || !DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG902_*: usa supabase/scripts/test_1_personas_cotizaciones.sh.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(specifier, context, nextResolve) {
  const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
  try { return nextResolve(specifier, context); } catch (e) {
    if (specifier.startsWith(".") && !/.[a-z]+$/.test(specifier)) { for (const suf of [".ts", "/index.ts"]) { try { return nextResolve(specifier + suf, context); } catch { /* sigue */ } } }
    throw e;
  }
} });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const uid = (n: number) => `00000000-0000-0000-0000-0000009020${String(n).padStart(2, "0")}`;
const U = {
  super: { id: uid(1), email: "t902-super@x.test", nombre: "T902 Super", rol: "superadmin", aliado: null },
  admin: { id: uid(2), email: "t902-admin@x.test", nombre: "T902 Admin", rol: "administracion", aliado: null },
  venta: { id: uid(3), email: "t902-venta@x.test", nombre: "T902 Venta", rol: "venta", aliado: null },
  ventaB: { id: uid(4), email: "t902-ventab@x.test", nombre: "T902 VentaB", rol: "venta", aliado: null },
  agencia: { id: uid(5), email: "t902-agencia@x.test", nombre: "T902 Agencia", rol: "agencia", aliado: 9911 },
  agencia2: { id: uid(6), email: "t902-agencia2@x.test", nombre: "T902 Agencia Dos", rol: "agencia", aliado: 9912 },
} as const;
type Quien = keyof typeof U;
let sesion: Quien | null = "super";
const sidDe = (id: string) => id.replace(/^00000000/, "5e550000");
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-902";

let solicitudes = 0;
const fetchLocal: typeof fetch = (input, init) => { solicitudes++; return fetch(String(input).replace("/rest/v1/", "/"), init); };
async function medir<T>(fn: () => Promise<T>): Promise<{ r: T; n: number }> { const a = solicitudes; const r = await fn(); return { r, n: solicitudes - a }; }
function clienteLocal(token: string, usuario?: { id: string; email: string } | null) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario ?? null }, error: null });
  return sb;
}
const clienteSesion = () => {
  if (sesion == null) return clienteLocal(jwt({ role: "anon" }), null);
  const u = U[sesion];
  return clienteLocal(jwt({ role: "authenticated", sub: u.id, session_id: sidDe(u.id) }), { id: u.id, email: u.email });
};
async function como<T>(quien: Quien | null, fn: () => Promise<T>): Promise<T> { const antes = sesion; sesion = quien; try { return await fn(); } finally { sesion = antes; } }
function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
const num = (q: string) => Number(sql(q));

// El PRECIO del hotel se simula (no es lo que se prueba); todo lo demás es el código y la base reales.
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async () => ({
      ok: true,
      data: {
        origen: { tipo: "ninguno" },
        meta: { hotel_nombre: "Hotel Carrito 902", destino_nombre: "CARTAGENA", fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04" },
        precioVenta: 1_000_000, monedaReserva: "COP", impuestoTotal: 200_000,
        lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: 500_000 }], pvpPorAcom: { doble: 500_000 }, netoPorAcom: { doble: 300_000 },
        numNinos: 0, numNinos2: 0, numInfantes: 0, numMenoresDeDos: 0, totalPax: 2, paxConSilla: 2, edadesMenoresUsadas: [], lineasMenores: [],
        serviciosIncluidos: [], serviciosItems: [], distribucionMenores: null, condicionesTarifa: [], notaNino: null, cargoMascota: null, notaMascota: null, oferta63: null, vigencias63: [],
      },
    }),
  },
});
mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/contrato/congelarCondicionesContrato", {
  namedExports: { componenteHotelReal: async () => null, componentePaqueteReal: async () => null, trmReferenciaAproximada: async () => null, congelarCondicionesContratoBestEffort: async () => {} },
});
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");
const { buscarPersonasCotizacion } = await import("../app/(crm)/crm/personas-cotizacion/actions.ts");

before(() => {
  const us = Object.values(U);
  sql(`
    insert into auth.users (id, email) values ${us.map((u) => `('${u.id}', '${u.email}')`).join(", ")} on conflict do nothing;
    insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion, activo) values
      (9911, 'T902 Agencia', '9911', 'agencia', 0.10, false, 0, true), (9912, 'T902 Agencia Dos', '9912', 'agencia', 0.10, false, 0, true) on conflict (id) do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
      ${us.map((u) => `('${u.id}', '${u.email}', '${u.nombre}', '${u.rol}', true, 'mayorista', ${u.aliado ?? "null"})`).join(", ")}
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant, aliado_id = excluded.aliado_id, nombre = excluded.nombre;
    insert into auth.sessions (id, user_id) select ('5e550000' || substr(id::text, 9))::uuid, id from public.usuarios where id in (${us.map((u) => `'${u.id}'`).join(", ")}) on conflict do nothing;
    insert into public.sesion_agencia (session_id, user_id, tenant) select ('5e550000' || substr(id::text, 9))::uuid, id, tenant from public.usuarios where id in (${us.map((u) => `'${u.id}'`).join(", ")}) on conflict do nothing;
    insert into public.destinos (id, nombre) values (10201, 'CARTAGENA 902') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (10201, 'Proveedor Hotel 902') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) values (10201, 10201, 'Hotel Carrito 902', 10201, 'COP') on conflict do nothing;
    insert into public.armado_paquetes (id, nombre, tipo, moneda) values (10201, 'Paquete 902', 'porcion_terrestre', 'COP') on conflict do nothing;
  `);
});

const item = () => ({
  itemId: "h10201", modulo: "porcion_terrestre", paqueteId: 10201, hotelId: 10201, bloqueoId: null, hotelNombre: "Hotel Carrito 902", destino: "CARTAGENA", categoria: "Estandar", regimen: "Desayuno",
  fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0,
});
const cliente = (doc: string, extra: Record<string, unknown> = {}) => ({ nombres: "Carla", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: doc, telefono: "3000000000", email: "carla@example.com", ...extra });
type RC = { ok: boolean; error?: string; tipo?: string; cotizacion?: { id: number; codigo: string } };
const cotizar = (c: Record<string, unknown>, extra: Record<string, unknown> = {}) => crearSolicitudReserva({ items: [item()], tours: [], cliente: c, ...extra }) as unknown as Promise<RC>;
const idDe = (codigo: string) => num(`select id from public.cotizaciones where codigo = '${codigo}'`);
const puestos = (id: number) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('rol', rol, 'activo', activo)), '[]') from public.cotizacion_participantes where cotizacion_id = ${id}`)) as { rol: string; activo: boolean }[];
const crmComo = (quien: Quien, texto: string) => como(quien, async () => { const r = await buscarPersonasCotizacion(texto, 1, 25); return r.ok ? r.filas : []; });

describe("origen: carrito del Tarifario", () => {
  test("C1 visitante anónimo: titular consultable en el CRM como captura provisional (sin tipo de documento), sin contrato", async () => {
    const { r, n } = await medir(() => como(null, () => cotizar(cliente("2001001"))));
    console.log(`  [consumo] crearSolicitudReserva (visitante): ${n} solicitudes HTTP`);
    assert.equal(r.ok, true, r.error); const id = idDe(r.cotizacion!.codigo);
    assert.deepEqual(puestos(id), [{ rol: "titular", activo: true }]);
    const filas = await crmComo("admin", "2001001"); assert.equal(filas.length, 1); assert.equal(filas[0].tipo_doc, null); assert.equal(filas[0].cotizacion.id, id);
    assert.equal(num("select count(*) from public.ventas"), 0);
  });
  test("C2 personal interno: titular sellado a su nombre; otro asesor no lo ve, administración sí", async () => {
    const r = await como("venta", () => cotizar(cliente("2001002"))); assert.equal(r.ok, true, r.error); const id = idDe(r.cotizacion!.codigo);
    assert.equal(sql(`select creado_por_id from public.cotizaciones where id = ${id}`), U.venta.id);
    assert.equal((await crmComo("venta", "2001002")).length, 1); assert.equal((await crmComo("ventaB", "2001002")).length, 0); assert.equal((await crmComo("admin", "2001002")).length, 1);
  });
  test("C3 aliado B2B: titular sellado a su nombre; solo él (y el personal autorizado) lo ve", async () => {
    const r = await como("agencia", () => cotizar(cliente("2001003"))); assert.equal(r.ok, true, r.error); const id = idDe(r.cotizacion!.codigo);
    assert.deepEqual(puestos(id), [{ rol: "titular", activo: true }]);
    assert.equal((await crmComo("agencia", "2001003")).length, 1); assert.equal((await crmComo("agencia2", "2001003")).length, 0);
  });
  test("C4 la misma clave de envío repite la solicitud: no crea otra cotización ni duplica; repara un registro que falló la primera vez", async () => {
    const clave = randomUUID();
    sql("revoke execute on function public.registrar_personas_cotizacion(bigint, uuid, jsonb) from service_role");
    const a = await como("venta", () => cotizar(cliente("2001004"), { claveEnvio: clave })).finally(() => sql("grant execute on function public.registrar_personas_cotizacion(bigint, uuid, jsonb) to service_role"));
    assert.equal(a.ok, true, a.error); const id = idDe(a.cotizacion!.codigo);
    assert.equal(puestos(id).length, 0, "el primer registro falló (la cotización sí existe)");
    const antes = num("select count(*) from public.cotizaciones");
    const b = await como("venta", () => cotizar(cliente("2001004"), { claveEnvio: clave }));
    assert.equal(b.ok, false); assert.equal(b.tipo, "envio_duplicado");
    assert.equal(num("select count(*) from public.cotizaciones"), antes, "no se creó otra cotización");
    assert.deepEqual(puestos(id), [{ rol: "titular", activo: true }], "el reintento completó el registro");
    const c = await como("venta", () => cotizar(cliente("2001004"), { claveEnvio: clave }));
    assert.equal(c.tipo, "envio_duplicado"); assert.equal(puestos(id).length, 1, "un tercer envío no duplica");
  });
  // F1 (auditoría Codex): el carrito de un aliado B2B con el sello caído se recupera al repetir la MISMA clave por el MISMO autor; otro actor no la adopta.
  test("C6 fallo transitorio del sello en el carrito B2B: la misma clave repetida por su autor recupera sello, puesto y CRM; otro actor no la adopta", async () => {
    const OFF = "revoke execute on function public.sellar_creador_cotizacion(bigint, uuid) from service_role";
    const ON = "grant execute on function public.sellar_creador_cotizacion(bigint, uuid) to service_role";
    const sello = (id: number) => sql(`select coalesce(creado_por_id::text, '') from public.cotizaciones where id = ${id}`);
    const clave = randomUUID();
    sql(OFF);
    const a = await como("agencia", () => cotizar(cliente("2001006"), { claveEnvio: clave })).finally(() => sql(ON));
    assert.equal(a.ok, true, a.error); const id = idDe(a.cotizacion!.codigo);
    assert.equal(sello(id), "", "el sello falló al crear"); assert.equal(puestos(id).length, 0);
    // Otro actor con la misma clave: rechazo por la guarda existente de la clave; nada se adopta.
    const otro = await como("agencia2", () => cotizar(cliente("2001006"), { claveEnvio: clave }));
    assert.equal(otro.tipo, "clave_en_uso"); assert.equal(sello(id), ""); assert.equal(puestos(id).length, 0);
    const antes = num("select count(*) from public.cotizaciones");
    const { r: b, n } = await medir(() => como("agencia", () => cotizar(cliente("2001006"), { claveEnvio: clave })));
    assert.equal(b.tipo, "envio_duplicado"); assert.equal(num("select count(*) from public.cotizaciones"), antes, "no se creó otra cotización");
    assert.equal(sello(id), U.agencia.id, "sello recuperado para el autor original"); assert.deepEqual(puestos(id), [{ rol: "titular", activo: true }]);
    assert.equal((await crmComo("agencia", "2001006")).length, 1); assert.equal((await crmComo("agencia2", "2001006")).length, 0);
    const { n: n2 } = await medir(() => como("agencia", () => cotizar(cliente("2001006"), { claveEnvio: clave })));
    assert.equal(puestos(id).length, 1); assert.ok(n2 < n, `ya sellada no repite la llamada de sello (${n2} < ${n})`);
    console.log(`  [consumo] carrito repetido recuperando el sello: ${n} · ya sellado: ${n2} solicitudes HTTP`);
  });
  test("C5 sin documento ni contacto utilizable el carrito no inventa una persona; la acción rechaza con mensaje (sin éxito falso)", async () => {
    const r = await como(null, () => cotizar({ nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", telefono: "", email: "" }));
    assert.equal(r.ok, false); assert.ok(r.error);
    assert.equal(num("select count(*) from public.cotizacion_participantes where cotizacion_id not in (select id from public.cotizaciones where codigo is not null)"), 0);
  });
});
