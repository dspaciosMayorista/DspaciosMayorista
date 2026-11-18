// #1 (antes #42) — registro de clientes y pasajeros de TODA cotización en el CRM, antes de que exista contrato.
// Recorrido REAL: Server Actions de la app → PostgREST propio → PostgreSQL local (migraciones reales + 308). Lo único simulado es la sesión (JWT firmado, GoTrue falso),
// la numeración y efectos laterales ajenos. SOLO base LOCAL desechable; lo lanza supabase/scripts/test_1_personas_cotizaciones.sh con test_pg_local.sh.
// Afirma la conducta DESEADA: cada cotización con una persona identificable deja su puesto (titular/pasajero) consultable en el CRM, sin contrato y sin duplicar al reintentar.
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG901_CONTENEDOR ?? "";
const DB = process.env.PG901_BASE ?? "";
const PGRST = process.env.PG901_POSTGREST ?? "";
const SECRETO = process.env.PG901_JWT_SECRET ?? "";
if (!CT || !DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG901_*: usa supabase/scripts/test_1_personas_cotizaciones.sh.");

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
const uid = (n: number) => `00000000-0000-0000-0000-0000009010${String(n).padStart(2, "0")}`;
const U = {
  super: { id: uid(1), email: "t901-super@x.test", nombre: "T901 Super", rol: "superadmin", tenant: "mayorista", aliado: null },
  admin: { id: uid(2), email: "t901-admin@x.test", nombre: "T901 Admin", rol: "administracion", tenant: "mayorista", aliado: null },
  venta: { id: uid(3), email: "t901-venta@x.test", nombre: "T901 Venta", rol: "venta", tenant: "mayorista", aliado: null },
  ventaB: { id: uid(4), email: "t901-ventab@x.test", nombre: "T901 VentaB", rol: "venta", tenant: "mayorista", aliado: null },
  adminMin: { id: uid(5), email: "t901-admmin@x.test", nombre: "T901 AdmMin", rol: "administracion", tenant: "minorista", aliado: null },
  agencia: { id: uid(6), email: "t901-agencia@x.test", nombre: "T901 Agencia", rol: "agencia", tenant: "mayorista", aliado: 9901 },
  agencia2: { id: uid(7), email: "t901-agencia2@x.test", nombre: "T901 Agencia Dos", rol: "agencia", tenant: "mayorista", aliado: 9902 },
} as const;
type Quien = keyof typeof U;
let sesion: Quien | null = "super"; // null = visitante anónimo
const sidDe = (id: string) => id.replace(/^00000000/, "5e550000");
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-901";

// Contador de solicitudes HTTP a PostgREST (VALIDACION_CONSUMO_VERCEL.md): cada acción se mide con `medir`.
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
const lit = (v: unknown) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/contrato/congelarCondicionesContrato", {
  namedExports: { componenteHotelReal: async () => null, componentePaqueteReal: async () => null, trmReferenciaAproximada: async () => null, congelarCondicionesContratoBestEffort: async () => {} },
});
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { crearSolicitudHotel } = await import("../app/tarifario/solicitudHotelActions.ts");
const { asignarNetaSolicitud, crearCotizacion } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { crearCotizacionManual, actualizarTitularCotizacionManual } = await import("../app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
const { crearCotizacionDin } = await import("../app/(dashboard)/dashboard/cotizaciones/din-actions.ts");
const { buscarPersonasCotizacion } = await import("../app/(crm)/crm/personas-cotizacion/actions.ts");

// ── Semilla (paquete porción terrestre con un hotel a solicitud y otro tarifado) ──
const D = 9001, PROV = 9001, S_ASIS = 9001, P3 = 9103, H3 = 9203, H3B = 9204;
before(() => {
  const usuarios = Object.values(U);
  sql(`
    insert into auth.users (id, email) values ${usuarios.map((u) => `('${u.id}', '${u.email}')`).join(", ")} on conflict do nothing;
    insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion) values
      (9901, 'T901 Agencia', '9901', 'agencia', 0.10, false, 0), (9902, 'T901 Agencia Dos', '9902', 'agencia', 0.10, false, 0) on conflict (id) do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
      ${usuarios.map((u) => `('${u.id}', '${u.email}', '${u.nombre}', '${u.rol}', true, '${u.tenant}', ${u.aliado ?? "null"})`).join(", ")}
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant, aliado_id = excluded.aliado_id, nombre = excluded.nombre;
    insert into auth.sessions (id, user_id) select ('5e550000' || substr(id::text, 9))::uuid, id from public.usuarios where id in (${usuarios.map((u) => `'${u.id}'`).join(", ")}) on conflict do nothing;
    insert into public.sesion_agencia (session_id, user_id, tenant) select ('5e550000' || substr(id::text, 9))::uuid, id, tenant from public.usuarios where id in (${usuarios.map((u) => `'${u.id}'`).join(", ")}) on conflict do nothing;
    insert into public.destinos (id, nombre) values (${D}, 'CARTAGENA 901') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (${PROV}, 'Proveedor 901') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) overriding system value values
      (${H3}, ${D}, 'Hotel Solicitud 901', ${PROV}, 'COP'), (${H3B}, ${D}, 'Hotel Tarifado 901', ${PROV}, 'COP');
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo) overriding system value values
      (${P3}, 'Porcion terrestre 901', 'porcion_terrestre', 3, ${D}, 0.2, 'fijo', 0, '2030-05-01', '2030-05-31', 'COP', 'COP', true);
    insert into public.armado_hoteles (paquete_id, hotel_id) values (${P3}, ${H3}), (${P3}, ${H3B});
    insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion) values
      (${S_ASIS}, 'Asistencia medica 901', ${PROV}, ${D}, 0, 'asistencia', 'COP', 'persona', 'paquete');
    insert into public.servicio_temporadas (id, servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (990001, ${S_ASIS}, 'ALTA', '2030-01-01', '2030-12-31', 20000);
    insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (${P3}, ${S_ASIS}, 'persona', true);
    insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, tipo, prioridad) values (${H3B}, 'ALTA', '2030-05-01', '2030-05-31', 'tarifa', 1);
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante)
      values (${H3B}, 'Estandar', 'PC', 'ALTA', 300000, 300000, 300000, 300000, 150000, 150000, 0);
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (${H3}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2), (${H3B}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
    update public.hoteles set tarifa_bajo_solicitud = true where id = ${H3};
  `);
});

// ── utilidades ────────────────────────────────────────────────────────────
type R = { ok: boolean; error?: string; id?: number; codigo?: string; avisoPersonas?: string; repetida?: boolean };
const cliente = (doc: string, extra: Record<string, unknown> = {}) => ({ nombres: "Ana", apellidos: "Perez", tipoDoc: "CC", numeroDoc: doc, telefono: "3000000000", email: "", ...extra });
const puestos = (cotId: number) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('rol', rol, 'activo', activo) order by rol, orden), '[]') from public.cotizacion_participantes where cotizacion_id = ${cotId}`)) as { rol: string; activo: boolean }[];
const contratos = () => num("select count(*) from public.ventas");
const solHotel = (c: Record<string, unknown>) => ({ paqueteId: P3, hotelId: H3, fechaIda: "2030-05-10", fechaRegreso: "2030-05-13", habitaciones: { doble: 1 }, categoria: "A confirmar", regimen: "A confirmar", cliente: c });
const reservarEntrada = (c: Record<string, unknown>, pasajeros: Record<string, unknown>[]) => ({
  paqueteId: P3, bloqueoId: null, empaquetadoId: null, modulo: "porcion_terrestre", hotelId: H3B, fechaIda: "2030-05-10", fechaRegreso: "2030-05-13", categoria: "Estandar", regimen: "PC",
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, cliente: c, tipoAsesor: "interno", asesorInterno: "Asesor 901", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros,
});
const pax = (n: number, doc: string, extra: Record<string, unknown> = {}) => ({ nombres: `Pax${n}`, apellidos: "Prueba", tipoDoc: "CC", numeroDoc: doc, fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana", esInfante: false, ...extra });
const manual = (c: Record<string, unknown>) => ({
  cliente: c, destino: "CARTAGENA", fechaIda: "2030-05-10", fechaRegreso: "2030-05-13", pax: 2, moneda: "COP", tipoAsesor: "interno", asesorInterno: "Asesor 901", agenciaNombre: "", freelanceNombre: "",
  plazo: "", vigenciaHasta: "", observaciones: "", servicios: [{ tipo: "hotel", plataforma: "Directo", nombre: "Hotel manual", proveedor: "Prov", costoNeto: 800000, modo: "mk", pctMarkup: 20, ta: 0 }],
});
const crm = (texto: string) => como("admin", async () => { const r = await buscarPersonasCotizacion(texto, 1, 25); assert.equal(r.ok, true, JSON.stringify(r)); return r.ok ? r.filas : []; });

describe("origen: cotización manual / dinámica interna", () => {
  test("M1 manual: el titular queda en el CRM sin contrato; un reintento no duplica", async () => {
    const antes = contratos();
    const { r, n } = await medir(() => como("venta", () => crearCotizacionManual(manual(cliente("1001001")) as never))) as { r: R; n: number };
    console.log(`  [consumo] crearCotizacionManual: ${n} solicitudes HTTP`);
    assert.equal(r.ok, true, r.error); assert.equal(r.avisoPersonas, undefined);
    assert.deepEqual(puestos(r.id!), [{ rol: "titular", activo: true }]);
    const filas = await crm("1001001");
    assert.equal(filas.length, 1); assert.equal(filas[0].rol, "titular"); assert.equal(filas[0].cotizacion.id, r.id);
    assert.equal(contratos(), antes, "no existe contrato");
  });
});

describe("origen: Reservar interno (titular + pasajeros)", () => {
  test("R1 titular y pasajeros identificados se registran; la fila vacía no crea persona; sin contrato", async () => {
    const antes = contratos();
    const { r, n } = await medir(() => como("venta", () => crearCotizacion(reservarEntrada(cliente("1002001"), [pax(1, "1002002"), pax(2, "1002003"), { nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", fechaNacimiento: "", nacionalidad: "", esInfante: false }]) as never))) as { r: R; n: number };
    console.log(`  [consumo] Reservar.crearCotizacion (titular + 2 pasajeros): ${n} solicitudes HTTP`);
    assert.equal(r.ok, true, r.error); assert.equal(r.avisoPersonas, undefined);
    assert.deepEqual(puestos(r.id!), [{ rol: "pasajero", activo: true }, { rol: "pasajero", activo: true }, { rol: "titular", activo: true }]);
    assert.equal((await crm("1002002")).length, 1); assert.equal((await crm("1002003")).length, 1); assert.equal((await crm("1002001")).length, 1);
    assert.equal(contratos(), antes);
  });
  test("R2 una persona que es titular y pasajera a la vez: una sola ficha, dos puestos", async () => {
    const { r } = await medir(() => como("venta", () => crearCotizacion(reservarEntrada(cliente("1003001"), [pax(1, "1003001", { nombres: "Ana", apellidos: "Perez" }), pax(2, "1003002")]) as never))) as { r: R };
    assert.equal(r.ok, true, r.error);
    assert.equal(num(`select count(distinct persona_id) from public.cotizacion_participantes where cotizacion_id = ${r.id}`), 2);
    assert.equal(num(`select count(*) from public.cotizacion_participantes where cotizacion_id = ${r.id}`), 3);
  });
  test("R3 un pasajero con un dato inválido NO impide registrar al titular ni a los demás pasajeros, y el aviso queda", async () => {
    const { r } = await medir(() => como("venta", () => crearCotizacion(reservarEntrada(cliente("1004001"), [pax(1, "1004002"), pax(2, "9".repeat(80))]) as never))) as { r: R };
    assert.equal(r.ok, true, r.error);
    const p = puestos(r.id!);
    assert.equal(p.filter((x) => x.rol === "titular").length, 1, "el titular quedó registrado");
    assert.equal(p.filter((x) => x.rol === "pasajero").length, 1, "el pasajero válido quedó registrado");
    assert.ok(r.avisoPersonas, "el pasajero inválido no se omite en silencio: hay aviso");
  });
});

describe("origen: solicitud de hotel a solicitud (pendiente_tarifa)", () => {
  test("S1 el cliente anónimo queda en el CRM desde que pide la cotización; cargar la neta no duplica", async () => {
    const { r, n } = await medir(() => como(null, () => crearSolicitudHotel(solHotel(cliente("1005001", { telefono: "3115550001" })))) ) as { r: R; n: number };
    console.log(`  [consumo] crearSolicitudHotel (anónimo): ${n} solicitudes HTTP`);
    assert.equal(r.ok, true, r.error);
    const id = num(`select id from public.cotizaciones where codigo = ${lit(r.codigo)}`);
    assert.equal(sql(`select estado from public.cotizaciones where id = ${id}`), "pendiente_tarifa");
    assert.deepEqual(puestos(id), [{ rol: "titular", activo: true }]);
    const filas = await crm("1005001"); assert.equal(filas.length, 1); assert.equal(filas[0].cotizacion.estado, "pendiente_tarifa");
    const rep = await como(null, () => crearSolicitudHotel(solHotel(cliente("1005001", { telefono: "3115550001" })))) as R;
    assert.equal(rep.repetida, true); assert.equal(puestos(id).length, 1, "reintento: sin duplicar");
    const neta = await como("super", () => asignarNetaSolicitud(id, 1_200_000)) as R;
    assert.equal(neta.ok, true, neta.error); assert.equal(puestos(id).length, 1, "al abrirse la cotización sigue siendo un solo puesto");
  });
  test("S2 dos personas distintas con el MISMO teléfono: ambas quedan en el CRM", async () => {
    const a = await como(null, () => crearSolicitudHotel({ ...solHotel(cliente("1006001", { nombres: "Luis", telefono: "3115550002" })), fechaIda: "2030-05-11", fechaRegreso: "2030-05-14" })) as R;
    const b = await como(null, () => crearSolicitudHotel({ ...solHotel(cliente("1006002", { nombres: "Marta", telefono: "3115550002" })), fechaIda: "2030-05-12", fechaRegreso: "2030-05-15" })) as R;
    assert.equal(a.ok && b.ok, true);
    assert.equal((await crm("1006001")).length, 1); assert.equal((await crm("1006002")).length, 1);
  });
});

// ── Paquete dinámico (solo servicios): visitante público, interno y aliado B2B ──
let PAQ_DIN = 0;
before(() => {
  PAQ_DIN = num(`insert into public.paquete_din (nombre, destino_id, esquema, pct_mk, usa_servicios, noches, compra_inicio, compra_fin, viaje_inicio, viaje_fin, activo, publicado)
    values ('Dinamico 901', ${D}, 'neta_markup', 0.2, true, 3, '2020-01-01', '2035-12-31', '2030-05-01', '2030-05-31', true, true) returning id`.replace(/\n/g, " "));
  sql(`insert into public.paquete_din_servicios (paquete_id, nombre, neto, orden) values (${PAQ_DIN}, 'Tour 901', 100000, 0)`);
});
const dinEntrada = (c: Record<string, unknown>) => ({ paqueteId: PAQ_DIN, hotelId: null, vueloId: null, composicion: { habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0 }, cliente: c, fechaIda: "2030-05-10", fechaRegreso: "2030-05-13" });
type RDin = { ok: boolean; error?: string; id?: number; avisoPersonas?: string };

describe("origen: paquete dinámico (visitante, interno, aliado B2B)", () => {
  test("D1 visitante público: su titular queda en el CRM de cotizaciones y un reintento no duplica", async () => {
    const { r, n } = await medir(() => como(null, () => crearCotizacionDin(dinEntrada(cliente("1007001", { telefono: "3115550010", email: "d1@x.test" })) as never))) as { r: RDin; n: number };
    console.log(`  [consumo] crearCotizacionDin (visitante): ${n} solicitudes HTTP`);
    assert.equal(r.ok, true, r.error); assert.equal(r.avisoPersonas, undefined);
    assert.deepEqual(puestos(r.id!), [{ rol: "titular", activo: true }]);
    const filas = await crm("1007001"); assert.equal(filas.length, 1); assert.equal(filas[0].cotizacion.id, r.id);
  });
  test("D2 personal interno: titular registrado", async () => {
    const r = await como("venta", () => crearCotizacionDin(dinEntrada(cliente("1007002")) as never)) as RDin;
    assert.equal(r.ok, true, r.error); assert.deepEqual(puestos(r.id!), [{ rol: "titular", activo: true }]);
  });
  test("D3 aliado B2B: su titular queda registrado y solo ese aliado y el personal autorizado lo ven", async () => {
    const r = await como("agencia", () => crearCotizacionDin(dinEntrada(cliente("1007003")) as never)) as RDin;
    assert.equal(r.ok, true, r.error); assert.deepEqual(puestos(r.id!), [{ rol: "titular", activo: true }]);
    const propias = await como("agencia", async () => { const x = await buscarPersonasCotizacion("1007003", 1, 25); return x.ok ? x.filas : []; });
    assert.equal(propias.length, 1);
    const ajenas = await como("agencia2", async () => { const x = await buscarPersonasCotizacion("1007003", 1, 25); return x.ok ? x.filas : []; });
    assert.equal(ajenas.length, 0, "otra agencia no ve las personas de este aliado");
  });
});

describe("misma persona, personas distintas, aislamiento y acceso", () => {
  test("I1 la misma persona (mismo documento) en dos cotizaciones: una ficha; dos personas con el mismo nombre y distinto documento: dos fichas", async () => {
    const a = await como("venta", () => crearCotizacionManual(manual(cliente("1008001")) as never)) as R;
    const b = await como("venta", () => crearCotizacionManual(manual(cliente("1008001", { telefono: "3200000000" })) as never)) as R;
    const c = await como("venta", () => crearCotizacionManual(manual(cliente("1008002")) as never)) as R;
    assert.equal(a.ok && b.ok && c.ok, true);
    const personas = (id: number) => sql(`select persona_id from public.cotizacion_participantes where cotizacion_id = ${id}`);
    assert.equal(personas(a.id!), personas(b.id!), "mismo documento = misma ficha");
    assert.notEqual(personas(a.id!), personas(c.id!), "mismo nombre y otro documento = otra ficha");
  });
  test("I2 tenant: el personal de minorista no ve las personas de mayorista", async () => {
    const r = await como("venta", () => crearCotizacionManual(manual(cliente("1009001")) as never)) as R; assert.equal(r.ok, true, r.error);
    const min = await como("adminMin", async () => { const x = await buscarPersonasCotizacion("1009001", 1, 25); return x.ok ? x.filas : []; });
    assert.equal(min.length, 0);
  });
  test("I3 un asesor no ve las personas de las cotizaciones de otro asesor; el administrador sí", async () => {
    const r = await como("venta", () => crearCotizacionManual(manual(cliente("1009002")) as never)) as R; assert.equal(r.ok, true, r.error);
    const otro = await como("ventaB", async () => { const x = await buscarPersonasCotizacion("1009002", 1, 25); return x.ok ? x.filas : []; });
    assert.equal(otro.length, 0);
    assert.equal((await crm("1009002")).length, 1);
  });
  test("I4 sin sesión no se consulta; las fachadas de alta no se alcanzan con la sesión de un usuario", async () => {
    const x = await como(null, () => buscarPersonasCotizacion("1009002", 1, 25)); assert.equal(x.ok, false);
    const r = await como("venta", () => crearCotizacionManual(manual(cliente("1009003")) as never)) as R;
    const sb = clienteSesion(); // sesión de usuario (rol authenticated), no service_role
    const { error } = await como("admin", async () => clienteSesion().rpc("registrar_personas_cotizacion", { p_cotizacion_id: r.id!, p_usuario_id: U.admin.id, p_participantes: [] }));
    void sb; assert.ok(error, "authenticated no puede llamar la fachada de alta"); assert.match(String(error?.message ?? error?.code), /permission denied|42501/i);
  });
  test("I5 corregir el titular: queda una sola ficha por documento y un reintento del mismo envío no duplica", async () => {
    const r = await como("venta", () => crearCotizacionManual(manual(cliente("1010001")) as never)) as R; assert.equal(r.ok, true, r.error);
    const clave = "11111111-1111-4111-8111-111111111111";
    const t = { nombres: "Ana", apellidos: "Perez", tipoDoc: "CC", numeroDoc: "1010001", nacimiento: "1990-01-01", telefono: "3001112233", email: "ana@x.test" };
    const u1 = await como("venta", () => actualizarTitularCotizacionManual(r.id!, t, { versionEsperada: 1, clave })) as R;
    assert.equal(u1.ok, true, u1.error);
    const u2 = await como("venta", () => actualizarTitularCotizacionManual(r.id!, t, { versionEsperada: 1, clave })) as R; // reintento exacto
    assert.equal(u2.ok, true, u2.error);
    assert.equal(num(`select count(*) from public.cotizacion_participantes where cotizacion_id = ${r.id} and rol = 'titular' and activo`), 1);
    assert.equal((await crm("1010001")).length, 1);
  });
});

describe("reintentos, sesiones y transición de estado", () => {
  test("S3 repetir la solicitud repara un registro que falló la primera vez y no duplica", async () => {
    const entrada = { ...solHotel(cliente("1011001", { telefono: "3115550030" })), fechaIda: "2030-05-14", fechaRegreso: "2030-05-17" };
    // Primer intento con la fachada inaccesible (simula un fallo transitorio de la base): la solicitud se crea y el registro queda pendiente, con log y sin éxito falso.
    sql("revoke execute on function public.registrar_personas_cotizacion(bigint, uuid, jsonb) from service_role");
    const a = await como(null, () => crearSolicitudHotel(entrada)).finally(() => sql("grant execute on function public.registrar_personas_cotizacion(bigint, uuid, jsonb) to service_role")) as R;
    assert.equal(a.ok, true, a.error);
    const id = num(`select id from public.cotizaciones where codigo = ${lit(a.codigo)}`);
    assert.equal(puestos(id).length, 0, "el primer registro falló: no hay puesto (y la solicitud sí existe)");
    const { r: b, n } = await medir(() => como(null, () => crearSolicitudHotel(entrada))) as { r: R; n: number };
    assert.equal(b.repetida, true); assert.deepEqual(puestos(id), [{ rol: "titular", activo: true }], "el reintento completó el registro");
    const { n: n2 } = await medir(() => como(null, () => crearSolicitudHotel(entrada)));
    assert.equal(puestos(id).length, 1, "un segundo reintento no duplica");
    console.log(`  [consumo] crearSolicitudHotel repetida (con reparación): ${n} · repetida sin nada que reparar: ${n2} solicitudes HTTP`);
  });
  test("S4 aliado B2B con sesión: la solicitud queda a su nombre y la ve solo él", async () => {
    const entrada = { ...solHotel(cliente("1012001", { telefono: "3115550040" })), fechaIda: "2030-05-15", fechaRegreso: "2030-05-18" };
    const a = await como("agencia", () => crearSolicitudHotel(entrada)) as R; assert.equal(a.ok, true, a.error);
    const id = num(`select id from public.cotizaciones where codigo = ${lit(a.codigo)}`);
    assert.deepEqual(puestos(id), [{ rol: "titular", activo: true }]);
    assert.equal(sql(`select creado_por_id from public.cotizaciones where id = ${id}`), U.agencia.id, "sellada a nombre del aliado");
    const propias = await como("agencia", async () => { const x = await buscarPersonasCotizacion("1012001", 1, 25); return x.ok ? x.filas : []; });
    assert.equal(propias.length, 1);
    const ajenas = await como("agencia2", async () => { const x = await buscarPersonasCotizacion("1012001", 1, 25); return x.ok ? x.filas : []; });
    assert.equal(ajenas.length, 0);
  });
  // F1 (auditoría Codex): si el sello del autor falla al crear, repetir la MISMA solicitud lo recupera, pero solo para el autor verificado y dentro de su ventana.
  const SELLO_OFF = "revoke execute on function public.sellar_creador_cotizacion(bigint, uuid) from service_role";
  const SELLO_ON = "grant execute on function public.sellar_creador_cotizacion(bigint, uuid) to service_role";
  const sello = (id: number) => sql(`select coalesce(creado_por_id::text, '') from public.cotizaciones where id = ${id}`);
  test("S7 fallo transitorio del sello del aliado B2B: al repetir la misma solicitud el mismo autor recupera el sello, el puesto y el CRM, sin duplicar", async () => {
    const entrada = { ...solHotel(cliente("1014001", { telefono: "3115550060" })), fechaIda: "2030-05-21", fechaRegreso: "2030-05-24" };
    sql(SELLO_OFF);
    const a = await como("agencia", () => crearSolicitudHotel(entrada)).finally(() => sql(SELLO_ON)) as R; assert.equal(a.ok, true, a.error);
    const id = num(`select id from public.cotizaciones where codigo = ${lit(a.codigo)}`);
    assert.equal(sello(id), "", "el sello falló al crear"); assert.equal(puestos(id).length, 0, "sin sello el aliado no puede registrar (la autorización no se relaja)");
    const { r: b, n } = await medir(() => como("agencia", () => crearSolicitudHotel(entrada))) as { r: R; n: number };
    assert.equal(b.repetida, true); assert.equal(num("select count(*) from public.cotizaciones where cliente_documento = '1014001'"), 1, "no se creó otra solicitud");
    assert.equal(sello(id), U.agencia.id, "sello recuperado para el autor original"); assert.deepEqual(puestos(id), [{ rol: "titular", activo: true }]);
    assert.equal((await como("agencia", async () => { const x = await buscarPersonasCotizacion("1014001", 1, 25); return x.ok ? x.filas : []; })).length, 1);
    assert.equal((await como("agencia2", async () => { const x = await buscarPersonasCotizacion("1014001", 1, 25); return x.ok ? x.filas : []; })).length, 0);
    const { n: n2 } = await medir(() => como("agencia", () => crearSolicitudHotel(entrada)));
    assert.equal(puestos(id).length, 1, "un tercer envío no duplica"); assert.equal(sello(id), U.agencia.id);
    assert.ok(n2 < n, `ya sellada no repite la llamada de sello (${n2} < ${n})`);
    console.log(`  [consumo] solicitud repetida recuperando el sello: ${n} · repetida ya sellada: ${n2} solicitudes HTTP`);
  });
  test("S8 otro aliado, un visitante o personal que repite una solicitud sin sello NO la adopta; solo el autor original la recupera", async () => {
    const entrada = { ...solHotel(cliente("1015001", { telefono: "3115550070" })), fechaIda: "2030-05-22", fechaRegreso: "2030-05-25" };
    sql(SELLO_OFF);
    const a = await como("agencia", () => crearSolicitudHotel(entrada)).finally(() => sql(SELLO_ON)) as R; assert.equal(a.ok, true, a.error);
    const id = num(`select id from public.cotizaciones where codigo = ${lit(a.codigo)}`);
    for (const quien of ["agencia2", null] as const) {
      const r = await como(quien, () => crearSolicitudHotel(entrada)) as R; assert.equal(r.repetida, true);
      assert.equal(sello(id), "", `${quien ?? "visitante"} no adopta la solicitud`); assert.equal(puestos(id).length, 0, `${quien ?? "visitante"} no registra a nombre del autor`);
    }
    const v = await como("venta", () => crearSolicitudHotel(entrada)) as R; assert.equal(v.repetida, true);
    assert.equal(sello(id), "", "el personal interno que repite la solicitud tampoco se queda con el sello del aliado");
    assert.equal((await como("agencia2", async () => { const x = await buscarPersonasCotizacion("1015001", 1, 25); return x.ok ? x.filas : []; })).length, 0);
    await como("agencia", () => crearSolicitudHotel(entrada));
    assert.equal(sello(id), U.agencia.id, "el autor original sí la recupera");
  });
  test("S9 pasada la ventana de 15 minutos el sello ya no se recupera (los límites de la base se conservan)", async () => {
    const entrada = { ...solHotel(cliente("1016001", { telefono: "3115550080" })), fechaIda: "2030-05-23", fechaRegreso: "2030-05-26" };
    sql(SELLO_OFF);
    const a = await como("agencia", () => crearSolicitudHotel(entrada)).finally(() => sql(SELLO_ON)) as R; assert.equal(a.ok, true, a.error);
    const id = num(`select id from public.cotizaciones where codigo = ${lit(a.codigo)}`);
    sql(`update public.cotizaciones set created_at = now() - interval '20 minutes' where id = ${id}`);
    const r = await como("agencia", () => crearSolicitudHotel(entrada)) as R; assert.equal(r.repetida, true);
    assert.equal(sello(id), "", "vencido: no se recupera"); assert.equal(puestos(id).length, 0, "sin sello sigue sin registrarse a nombre del aliado (queda el aviso)");
  });
  test("S5 la solicitud anónima conserva su puesto y su captura provisional (sin tipo de documento) al cargarse la neta", async () => {
    const entrada = { ...solHotel(cliente("1013001", { telefono: "3115550050" })), fechaIda: "2030-05-16", fechaRegreso: "2030-05-19" };
    const a = await como(null, () => crearSolicitudHotel(entrada)) as R; assert.equal(a.ok, true, a.error);
    const id = num(`select id from public.cotizaciones where codigo = ${lit(a.codigo)}`);
    const antes = sql(`select id from public.cotizacion_participantes where cotizacion_id = ${id}`);
    const neta = await como("super", () => asignarNetaSolicitud(id, 1_200_000)) as R; assert.equal(neta.ok, true, neta.error);
    assert.equal(sql(`select estado from public.cotizaciones where id = ${id}`), "abierta");
    assert.equal(sql(`select id from public.cotizacion_participantes where cotizacion_id = ${id}`), antes, "el mismo puesto, sin duplicar");
    const filas = await crm("1013001"); assert.equal(filas.length, 1); assert.equal(filas[0].cotizacion.estado, "abierta");
    assert.equal(filas[0].tipo_doc, null, "captura provisional: el tipo de documento de un visitante anónimo no se registra");
  });
  test("S6 los tres orígenes públicos no dejan contrato, venta ni CxP", async () => {
    assert.equal(contratos(), 0); assert.equal(num("select count(*) from public.cuentas_por_pagar"), 0);
  });
});

// ── Datos faltantes, identificación insuficiente, concurrencia ──
const { altaPersonasDeCotizacionGuardada } = await import("../lib/personas/altaGuardada.ts");
describe("datos incompletos y concurrencia", () => {
  test("F1 un titular solo con nombre (sin documento ni contacto) queda como ficha provisional y se encuentra por nombre", async () => {
    const r = await como("venta", () => crearCotizacionManual(manual({ nombres: "Zoraida", apellidos: "Solonombre", tipoDoc: "", numeroDoc: "", telefono: "", email: "" }) as never)) as R;
    assert.equal(r.ok, true, r.error); assert.deepEqual(puestos(r.id!), [{ rol: "titular", activo: true }]);
    const filas = await crm("Solonombre"); assert.equal(filas.length, 1); assert.notEqual(filas[0].estado_ficha, "documentada");
  });
  test("F2 identificación insuficiente (sin nombre ni apellido): se rechaza con mensaje y no se crea ni persona ni cotización", async () => {
    const antes = num("select count(*) from public.cotizaciones"); const antesP = num("select count(*) from public.cotizacion_participantes");
    const r = await como("venta", () => crearCotizacionManual(manual({ nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "1014001", telefono: "3001", email: "" }) as never)) as R;
    assert.equal(r.ok, false); assert.ok(r.error);
    assert.equal(num("select count(*) from public.cotizaciones"), antes); assert.equal(num("select count(*) from public.cotizacion_participantes"), antesP);
  });
  test("F3 las cantidades de viajeros (habitaciones, niños) NUNCA crean pasajeros: sin filas identificadas solo queda el titular", async () => {
    const r = await como("venta", () => crearCotizacion({ ...reservarEntrada(cliente("1015001"), []), habitaciones: { doble: 1 }, ninos: 0 } as never)) as R;
    assert.equal(r.ok, true, r.error); assert.deepEqual(puestos(r.id!), [{ rol: "titular", activo: true }]);
  });
  test("F4 un pasajero con solo nombre (sin documento) se registra; uno sin ningún dato no", async () => {
    const r = await como("venta", () => crearCotizacion(reservarEntrada(cliente("1016001"), [{ nombres: "Sin", apellidos: "Documento", tipoDoc: "", numeroDoc: "", fechaNacimiento: "", nacionalidad: "", esInfante: false }, { nombres: "", apellidos: "", tipoDoc: "", numeroDoc: "", fechaNacimiento: "", nacionalidad: "", esInfante: false }]) as never)) as R;
    assert.equal(r.ok, true, r.error); assert.equal(puestos(r.id!).filter((x) => x.rol === "pasajero").length, 1);
  });
  test("K1 cinco altas simultáneas sobre la MISMA cotización: un solo puesto por persona", async () => {
    const r = await como("venta", () => crearCotizacion(reservarEntrada(cliente("1017001"), [pax(1, "1017002"), pax(2, "1017003")]) as never)) as R;
    assert.equal(r.ok, true, r.error); const antes = puestos(r.id!).length;
    const admin = clienteLocal(TOKEN_SERVICIO);
    const res = await Promise.all(Array.from({ length: 5 }, () => altaPersonasDeCotizacionGuardada(admin as never, r.id!, U.venta.id, false)));
    assert.ok(res.every((x) => x.ok), JSON.stringify(res));
    assert.equal(puestos(r.id!).length, antes); assert.equal(antes, 3);
    assert.equal(num(`select count(distinct persona_id) from public.cotizacion_participantes where cotizacion_id = ${r.id}`), 3);
  });
  test("K2 cinco solicitudes idénticas simultáneas: un solo puesto por cotización; con tipo de documento conocido (sesión) todas apuntan a UNA ficha", async () => {
    const entrada = { ...solHotel(cliente("1018001", { telefono: "3115550080" })), fechaIda: "2030-05-20", fechaRegreso: "2030-05-23" };
    const conSesion = await Promise.all(Array.from({ length: 5 }, () => como("agencia", () => crearSolicitudHotel(entrada)))) as R[];
    assert.ok(conSesion.every((x) => x.ok), JSON.stringify(conSesion));
    const ids = [...new Set(conSesion.map((x) => num(`select id from public.cotizaciones where codigo = ${lit(x.codigo)}`)))];
    for (const id of ids) assert.equal(puestos(id).length, 1, `cotización ${id}: un solo puesto`);
    assert.equal(num(`select count(distinct persona_id) from public.cotizacion_participantes where cotizacion_id in (${ids.join(",")})`), 1, "misma persona = una sola ficha");
    // Visitante anónimo: la captura es PROVISIONAL (D-6, sin tipo de documento) y no se fusiona sola; lo que sí se garantiza es un puesto por cotización.
    const anonimo = { ...entrada, cliente: cliente("1018002", { telefono: "3115550081" }) };
    const anon = await Promise.all(Array.from({ length: 5 }, () => como(null, () => crearSolicitudHotel(anonimo)))) as R[];
    assert.ok(anon.every((x) => x.ok), JSON.stringify(anon));
    for (const id of new Set(anon.map((x) => num(`select id from public.cotizaciones where codigo = ${lit(x.codigo)}`)))) assert.equal(puestos(id).length, 1);
  });
});
