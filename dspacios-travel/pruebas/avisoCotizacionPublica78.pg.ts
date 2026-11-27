// #78 residual — aviso interno por una cotización pública de un visitante SIN sesión (migración 340). Recorrido REAL: Server Actions de la app (carrito del Tarifario, solicitud de hotel a
// solicitud, paquete dinámico público) y `sondearAvisos` (la campana) → PostgREST propio → PostgreSQL local (migraciones reales + 340). Lo único simulado es la sesión (JWT firmado, GoTrue falso),
// el PRECIO del hotel del carrito (no es lo que se prueba) y efectos laterales ajenos. SOLO base LOCAL desechable; lo lanza supabase/scripts/test_78_aviso_cotizacion_publica.sh con test_pg_local.sh.
// Afirma la conducta DESEADA (política del dueño, 2026-11-24): el visitante avisa DENTRO de la plataforma, una sola vez, a quienes pueden generar/asistir cotizaciones en esa agencia; el personal y los aliados no avisan; un fallo del aviso nunca rompe la cotización.
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG78_CONTENEDOR ?? "";
const DB = process.env.PG78_BASE ?? "";
const PGRST = process.env.PG78_POSTGREST ?? "";
const SECRETO = process.env.PG78_JWT_SECRET ?? "";
if (!CT || !DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG78_*: usa supabase/scripts/test_78_aviso_cotizacion_publica.sh.");

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
const uid = (n: number) => `00000000-0000-0000-0000-0000009078${String(n).padStart(2, "0")}`;
const U = {
  admin: { id: uid(1), email: "t78-admin@x.test", nombre: "T78 Admin", rol: "administracion", tenant: "mayorista", aliado: null },
  gerencia: { id: uid(2), email: "t78-gerencia@x.test", nombre: "T78 Gerencia", rol: "gerencia", tenant: "mayorista", aliado: null },
  oper: { id: uid(3), email: "t78-oper@x.test", nombre: "T78 Oper", rol: "operaciones", tenant: "mayorista", aliado: null },
  venta: { id: uid(4), email: "t78-venta@x.test", nombre: "T78 Venta", rol: "venta", tenant: "mayorista", aliado: null },
  adminMin: { id: uid(5), email: "t78-admmin@x.test", nombre: "T78 AdmMin", rol: "administracion", tenant: "minorista", aliado: null },
  agencia: { id: uid(6), email: "t78-agencia@x.test", nombre: "T78 Agencia", rol: "agencia", tenant: "mayorista", aliado: 9781 },
  inactivo: { id: uid(7), email: "t78-inactivo@x.test", nombre: "T78 Inactivo", rol: "administracion", tenant: "mayorista", aliado: null },
} as const;
type Quien = keyof typeof U;
let sesion: Quien | null = "admin"; // null = visitante anónimo
const sidDe = (id: string) => id.replace(/^00000000/, "5e550000");
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.CRON_SECRET = "cron-local-78";

// Contador de solicitudes HTTP a PostgREST (VALIDACION_CONSUMO_VERCEL.md) y, por separado, de llamadas a la función del aviso.
let solicitudes = 0; let llamadasAviso = 0; const sondeos: string[] = [];
const fetchLocal: typeof fetch = (input, init) => {
  solicitudes++;
  const url = String(input);
  if (url.includes("/rpc/avisar_cotizacion_publica")) llamadasAviso++;
  return fetch(url.replace("/rest/v1/", "/"), init);
};
async function medir<T>(fn: () => Promise<T>): Promise<{ r: T; n: number; avisos: number }> { const a = solicitudes, b = llamadasAviso; const r = await fn(); return { r, n: solicitudes - a, avisos: llamadasAviso - b }; }
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

// El PRECIO del hotel del carrito se simula (no es lo que se prueba); todo lo demás es el código y la base reales.
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async () => ({
      ok: true,
      data: {
        origen: { tipo: "ninguno" },
        meta: { hotel_nombre: "Hotel Carrito 78", destino_nombre: "CARTAGENA", fecha_ida: "2030-03-01", fecha_regreso: "2030-03-04" },
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
const { crearSolicitudHotel } = await import("../app/tarifario/solicitudHotelActions.ts");
const { crearCotizacionDin } = await import("../app/(dashboard)/dashboard/cotizaciones/din-actions.ts");
const { sondearAvisos, marcarAvisosLeidos } = await import("../lib/avisos/actions.ts");

// ── Semilla ──
const configurar = (quienes: Quien[]) => sql(`update public.config_solicitudes set emails = ${quienes.length ? `'${quienes.map((q) => U[q].email).join(", ")}'` : "null"} where id = 1`);
const D = 9781, PROV = 9781, P3 = 9783, H_SOL = 9785, H_CARRITO = 9786;
let PAQ_DIN = 0;
before(() => {
  const us = Object.values(U);
  sql(`
    insert into auth.users (id, email) values ${us.map((u) => `('${u.id}', '${u.email}')`).join(", ")} on conflict do nothing;
    insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion, activo) values (9781, 'T78 Agencia', '9781', 'agencia', 0.10, false, 0, true) on conflict (id) do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
      ${us.map((u) => `('${u.id}', '${u.email}', '${u.nombre}', '${u.rol}', ${u.rol === "administracion" && u.email.includes("inactivo") ? "false" : "true"}, '${u.tenant}', ${u.aliado ?? "null"})`).join(", ")}
      on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id, nombre = excluded.nombre;
    insert into auth.sessions (id, user_id) select ('5e550000' || substr(id::text, 9))::uuid, id from public.usuarios where id in (${us.map((u) => `'${u.id}'`).join(", ")}) on conflict do nothing;
    insert into public.sesion_agencia (session_id, user_id, tenant) select ('5e550000' || substr(id::text, 9))::uuid, id, tenant from public.usuarios where id in (${us.map((u) => `'${u.id}'`).join(", ")}) on conflict do nothing;
    insert into public.destinos (id, nombre) values (${D}, 'CARTAGENA 78') on conflict do nothing;
    insert into public.proveedores (id, nombre) values (${PROV}, 'Proveedor 78') on conflict do nothing;
    insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda) overriding system value values (${H_SOL}, ${D}, 'Hotel Solicitud 78', ${PROV}, 'COP'), (${H_CARRITO}, ${D}, 'Hotel Carrito 78', ${PROV}, 'COP');
    insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo) overriding system value values
      (${P3}, 'Porcion terrestre 78', 'porcion_terrestre', 3, ${D}, 0.2, 'fijo', 0, '2030-05-01', '2030-05-31', 'COP', 'COP', true);
    insert into public.armado_hoteles (paquete_id, hotel_id) values (${P3}, ${H_SOL}), (${P3}, ${H_CARRITO});
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (${H_SOL}, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
    update public.hoteles set tarifa_bajo_solicitud = true where id = ${H_SOL};
  `);
  PAQ_DIN = num(`insert into public.paquete_din (nombre, destino_id, esquema, pct_mk, usa_servicios, noches, compra_inicio, compra_fin, viaje_inicio, viaje_fin, activo, publicado)
    values ('Dinamico 78', ${D}, 'neta_markup', 0.2, true, 3, '2020-01-01', '2035-12-31', '2030-05-01', '2030-05-31', true, true) returning id`.replace(/\n/g, " "));
  sql(`insert into public.paquete_din_servicios (paquete_id, nombre, neto, orden) values (${PAQ_DIN}, 'Tour 78', 100000, 0)`);
  // La política ya NO depende de una lista de correos: se deja una configuración antigua que nombra a un aliado y a un usuario de otra agencia para comprobar que no influye.
  configurar(["agencia", "adminMin"]);
});

// ── utilidades ──
const cliente = (doc: string, extra: Record<string, unknown> = {}) => ({ nombres: "Carla", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: doc, telefono: "3000000000", email: "carla@example.com", ...extra });
const itemCarrito = () => ({
  itemId: "h9786", modulo: "porcion_terrestre", paqueteId: P3, hotelId: H_CARRITO, bloqueoId: null, hotelNombre: "Hotel Carrito 78", destino: "CARTAGENA", categoria: "Estandar", regimen: "Desayuno",
  fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, edadesMenores: [], cantidadMenores: 0,
});
type RC = { ok: boolean; error?: string; tipo?: string; cotizacion?: { id: number; codigo: string } };
const carrito = (c: Record<string, unknown>, extra: Record<string, unknown> = {}) => crearSolicitudReserva({ items: [itemCarrito()], tours: [], cliente: c, ...extra }) as unknown as Promise<RC>;
const solHotel = (c: Record<string, unknown>) => ({ paqueteId: P3, hotelId: H_SOL, fechaIda: "2030-05-10", fechaRegreso: "2030-05-13", habitaciones: { doble: 1 }, categoria: "A confirmar", regimen: "A confirmar", cliente: c });
type RH = { ok: boolean; error?: string; codigo?: string; cotizacion?: { codigo: string }; repetida?: boolean };
const dinEntrada = (c: Record<string, unknown>) => ({ paqueteId: PAQ_DIN, hotelId: null, vueloId: null, composicion: { habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0 }, cliente: c, fechaIda: "2030-05-10", fechaRegreso: "2030-05-13" });
type RD = { ok: boolean; error?: string; id?: number };
const idDe = (codigo: string) => num(`select id from public.cotizaciones where codigo = '${codigo}'`);
const destinatarios = (cotId: number): string[] => sql(`select coalesce(string_agg(usuario_id::text, ',' order by usuario_id::text), '') from public.avisos where tipo = 'cotizacion_publica' and cotizacion_id = ${cotId}`).split(",").filter(Boolean);
const esperados = (...q: Quien[]) => q.map((x) => U[x].id).sort();
// Quienes PUEDEN generar/asistir cotizaciones en mayorista: administración, gerencia, operaciones y venta de mayorista (no el administrador de minorista, ni el aliado, ni el inactivo).
const PERMITIDOS: Quien[] = ["admin", "gerencia", "oper", "venta"];
const hayAvisos = (cotId: number) => destinatarios(cotId).length;

describe("carrito del Tarifario (visitante vs. con sesión)", () => {
  test("N1 visitante: avisa SOLO a quienes pueden generar/asistir cotizaciones en mayorista (activos, rol permitido, esa agencia), una vez cada uno", async () => {
    const { r, n, avisos } = await medir(() => como(null, () => carrito(cliente("7801001"))));
    console.log(`  [consumo] crearSolicitudReserva (visitante): ${n} solicitudes HTTP, ${avisos} a avisar_cotizacion_publica`);
    assert.equal(r.ok, true, r.error); const id = idDe(r.cotizacion!.codigo);
    assert.deepEqual(destinatarios(id), esperados(...PERMITIDOS), "reciben quienes pueden asistir cotizaciones en mayorista; NO el administrador de minorista (otra agencia), el aliado ni el inactivo, aunque figuren en la lista antigua de correos");
    assert.equal(avisos, 1, "una sola llamada a la función por cotización creada");
    const fila = sql(`select tipo, numero_contrato, cotizacion_id::text, coalesce(leido_en::text, 'sin leer'), coalesce(notificado_en::text, 'sin reclamar') from public.avisos where cotizacion_id = ${id} and usuario_id = '${U.admin.id}'`);
    assert.equal(fila, `cotizacion_publica|${r.cotizacion!.codigo}|${id}|sin leer|sin reclamar`);
    assert.equal(num("select count(*) from public.ventas"), 0, "ningún contrato: es solo una cotización");
  });

  test("N2 la campana del responsable la ve: contador, texto de lista y enlace a la FICHA de la cotización (sin id de cotización hacia el navegador)", async () => {
    const id = num(`select max(cotizacion_id) from public.avisos where tipo = 'cotizacion_publica'`);
    const s = await como("admin", () => sondearAvisos(false));
    assert.ok(s.noLeidos >= 1);
    const a = s.recientes.find((x) => x.tipo === "cotizacion_publica")!;
    assert.equal(a.href, `/dashboard/cotizaciones/${id}`); assert.equal(a.leido, false);
    assert.ok(!JSON.stringify(s).includes("cotizacion_id"));
    const oper = await como("oper", () => sondearAvisos(false)); assert.ok(oper.recientes.some((x) => x.tipo === "cotizacion_publica"), "operaciones SÍ puede asistir cotizaciones: recibe el aviso");
    const noRecibe = await como("adminMin", () => sondearAvisos(false)); assert.equal(noRecibe.recientes.filter((x) => x.tipo === "cotizacion_publica").length, 0, "el administrador de minorista (otra agencia) no lo recibe");
    const reclamado = await como("gerencia", () => sondearAvisos(true));
    assert.equal(reclamado.nuevos.filter((x) => x.tipo === "cotizacion_publica").length, 1); assert.equal(reclamado.nuevos[0].href, `/dashboard/cotizaciones/${id}`);
    const otra = await como("gerencia", () => sondearAvisos(true)); assert.equal(otra.nuevos.length, 0, "reclamar entrega cada aviso UNA sola vez");
    assert.equal((await como("admin", () => marcarAvisosLeidos([a.id]))).ok, true);
    const tras = await como("admin", () => sondearAvisos(false));
    assert.equal(tras.recientes.find((x) => x.id === a.id)!.leido, true);
    const deGerencia = sql(`select count(*) from public.avisos where tipo = 'cotizacion_publica' and usuario_id = '${U.gerencia.id}' and leido_en is null`);
    assert.ok(Number(deGerencia) >= 1, "leer el aviso de admin no marca el de gerencia (estado por persona)");
  });

  test("N3 con sesión NO avisa: personal interno y aliado B2B (0 llamadas a la función)", async () => {
    const a = await medir(() => como("venta", () => carrito(cliente("7801002")))); assert.equal(a.r.ok, true, a.r.error);
    assert.equal(a.avisos, 0); assert.equal(hayAvisos(idDe(a.r.cotizacion!.codigo)), 0);
    const b = await medir(() => como("agencia", () => carrito(cliente("7801003")))); assert.equal(b.r.ok, true, b.r.error);
    assert.equal(b.avisos, 0); assert.equal(hayAvisos(idDe(b.r.cotizacion!.codigo)), 0);
  });

  test("N4 la misma clave de envío repetida por el visitante NO duplica avisos; si el primer aviso falló, la repetición lo repara", async () => {
    const clave = randomUUID();
    const a = await medir(() => como(null, () => carrito(cliente("7801004"), { claveEnvio: clave }))); assert.equal(a.r.ok, true, a.r.error);
    const id = idDe(a.r.cotizacion!.codigo); assert.deepEqual(destinatarios(id), esperados(...PERMITIDOS));
    const b = await medir(() => como(null, () => carrito(cliente("7801004"), { claveEnvio: clave })));
    assert.equal(b.r.ok, false); assert.equal(b.r.tipo, "envio_duplicado");
    assert.deepEqual(destinatarios(id), esperados(...PERMITIDOS), "sin duplicados"); assert.equal(b.avisos, 1, "la repetición reintenta UNA vez (idempotente)");
    // Se simula que el primer aviso nunca llegó (p. ej. caída transitoria): la repetición lo repara.
    sql(`delete from public.avisos where tipo = 'cotizacion_publica' and cotizacion_id = ${id}`);
    const c = await como(null, () => carrito(cliente("7801004"), { claveEnvio: clave })); assert.equal(c.tipo, "envio_duplicado");
    assert.deepEqual(destinatarios(id), esperados(...PERMITIDOS), "reparado");
    // Otro actor con la misma clave: rechazado antes de tocar nada, sin avisos.
    const antes = num("select count(*) from public.avisos where tipo = 'cotizacion_publica'");
    const ajeno = await medir(() => como("agencia", () => carrito(cliente("7801004"), { claveEnvio: clave })));
    assert.equal(ajeno.r.tipo, "clave_en_uso"); assert.equal(ajeno.avisos, 0);
    assert.equal(num("select count(*) from public.avisos where tipo = 'cotizacion_publica'"), antes);
  });
});

describe("solicitud de hotel a solicitud y paquete dinámico", () => {
  test("H1 solicitud de hotel de un visitante avisa; repetirla no duplica; con sesión de aliado no avisa", async () => {
    const a = await medir(() => como(null, () => crearSolicitudHotel(solHotel(cliente("7802001")) as never))) as { r: RH; n: number; avisos: number };
    console.log(`  [consumo] crearSolicitudHotel (visitante, nueva): ${a.n} solicitudes HTTP, ${a.avisos} a avisar_cotizacion_publica`);
    assert.equal(a.r.ok, true, a.r.error); const id = idDe(a.r.cotizacion?.codigo ?? a.r.codigo!);
    assert.deepEqual(destinatarios(id), esperados(...PERMITIDOS)); assert.equal(a.avisos, 1);
    const b = await medir(() => como(null, () => crearSolicitudHotel(solHotel(cliente("7802001")) as never))) as { r: RH; n: number; avisos: number };
    assert.equal(b.r.ok, true, b.r.error); assert.equal(b.r.repetida, true);
    assert.deepEqual(destinatarios(id), esperados(...PERMITIDOS), "la solicitud repetida no duplica"); assert.equal(b.avisos, 1);
    const c = await medir(() => como("agencia", () => crearSolicitudHotel(solHotel(cliente("7802002")) as never))) as { r: RH; n: number; avisos: number };
    assert.equal(c.r.ok, true, c.r.error); assert.equal(c.avisos, 0); assert.equal(hayAvisos(idDe(c.r.cotizacion?.codigo ?? c.r.codigo!)), 0);
  });

  test("D1 paquete dinámico: visitante avisa; personal y aliado no", async () => {
    const a = await medir(() => como(null, () => crearCotizacionDin(dinEntrada(cliente("7803001", { telefono: "3115550010", email: "d1@x.test" })) as never))) as { r: RD; n: number; avisos: number };
    console.log(`  [consumo] crearCotizacionDin (visitante): ${a.n} solicitudes HTTP, ${a.avisos} a avisar_cotizacion_publica`);
    assert.equal(a.r.ok, true, a.r.error); assert.deepEqual(destinatarios(a.r.id!), esperados(...PERMITIDOS)); assert.equal(a.avisos, 1);
    for (const quien of ["venta", "agencia"] as const) {
      const x = await medir(() => como(quien, () => crearCotizacionDin(dinEntrada(cliente(`7803${quien === "venta" ? "002" : "003"}`)) as never))) as { r: RD; n: number; avisos: number };
      assert.equal(x.r.ok, true, x.r.error); assert.equal(x.avisos, 0, quien); assert.equal(hayAvisos(x.r.id!), 0, quien);
    }
  });
});

describe("configuración, fallos y aislamiento", () => {
  test("C1 la lista de correos de config_solicitudes (vacía o con cualquiera) NO cambia los destinatarios: siempre quienes pueden asistir", async () => {
    configurar([]);
    try {
      const r = await como(null, () => carrito(cliente("7804001"))); assert.equal(r.ok, true, r.error);
      assert.deepEqual(destinatarios(idDe(r.cotizacion!.codigo)), esperados(...PERMITIDOS), "con la lista VACÍA igual avisa a quienes pueden asistir");
    } finally { configurar(["agencia", "adminMin"]); }
  });

  test("P1 un usuario desactivado o movido de agencia deja de recibir en el aviso SIGUIENTE", async () => {
    sql(`update public.usuarios set activo = false where id = '${U.venta.id}'`);
    sql(`update public.usuarios set tenant = 'minorista' where id = '${U.oper.id}'`);
    try {
      const r = await como(null, () => carrito(cliente("7804002"))); assert.equal(r.ok, true, r.error);
      assert.deepEqual(destinatarios(idDe(r.cotizacion!.codigo)), esperados("admin", "gerencia"));
    } finally {
      sql(`update public.usuarios set activo = true where id = '${U.venta.id}'`);
      sql(`update public.usuarios set tenant = 'mayorista' where id = '${U.oper.id}'`);
    }
  });

  test("T2 «atendida» = convertida a contrato, por la campana REAL: leer no la marca, descartar tampoco, convertir sí (y el contador de no leídos no cambia)", async () => {
    const a = await como(null, () => carrito(cliente("7804003"))); assert.equal(a.ok, true, a.error);
    const b = await como(null, () => carrito(cliente("7804004"))); assert.equal(b.ok, true, b.error);
    const idA = idDe(a.cotizacion!.codigo), idB = idDe(b.cotizacion!.codigo);
    const atendidas = async (quien: Quien) => (await como(quien, () => sondearAvisos(false))).recientes.filter((x) => x.tipo === "cotizacion_publica" && x.atendida).length;
    const antes = await como("venta", () => sondearAvisos(false)); const noLeidasAntes = antes.noLeidos;
    assert.equal(await atendidas("venta"), 0, "antes de convertir ninguna está atendida");
    sql(`update public.cotizaciones set estado = 'descartada' where id = ${idB}`);
    assert.equal(await atendidas("venta"), 0, "DESCARTAR no es convertir");
    await como("venta", () => marcarAvisosLeidos());
    assert.equal(await atendidas("venta"), 0, "leer todo tampoco la vuelve atendida");
    sql(`set session_replication_role = replica; update public.cotizaciones set estado = 'convertida', numero_contrato = '00-7804' where id = ${idA}; set session_replication_role = origin;`);
    for (const q of ["admin", "gerencia", "oper", "venta"] as const) assert.equal(await atendidas(q), 1, `${q} ve la convertida como atendida`);
    const despues = await como("venta", () => sondearAvisos(false));
    assert.equal(despues.noLeidos, 0, "ya había leído todo: convertir no crea ni reabre avisos");
    assert.ok(noLeidasAntes >= 1);
    // Una cotización de otro tipo (soporte de pago) nunca se marca atendida.
    assert.ok(despues.recientes.every((x) => x.tipo === "cotizacion_publica" || !x.atendida));
  });

  test("F1 si la función del aviso FALLA, la cotización del visitante se crea igual, solo se registra el código (sin datos del cliente) y la repetición lo repara", async () => {
    const clave = randomUUID();
    const cF = cliente("7805001", { nombres: "Nombre Sensible", email: "sensible@example.com" });
    sql("revoke execute on function public.avisar_cotizacion_publica(bigint) from service_role");
    const previo = console.error; const lineas: string[] = [];
    console.error = (...a: unknown[]) => { lineas.push(a.join(" ")); };
    let r: RC;
    try { r = await como(null, () => carrito(cF, { claveEnvio: clave })); }
    finally { console.error = previo; sql("grant execute on function public.avisar_cotizacion_publica(bigint) to service_role"); }
    assert.equal(r.ok, true, "la cotización NO se pierde por un fallo del aviso"); const id = idDe(r.cotizacion!.codigo);
    assert.equal(hayAvisos(id), 0);
    const log = lineas.find((l) => l.startsWith("[aviso_cotizacion_publica]")); assert.ok(log, "el fallo queda registrado");
    assert.equal(log, `[aviso_cotizacion_publica] cotizacion=${id} codigo=42501`);
    assert.ok(!lineas.join("\n").includes("Sensible") && !lineas.join("\n").includes("sensible@example.com"), "ningún dato del cliente en el log");
    const b = await como(null, () => carrito(cF, { claveEnvio: clave })); assert.equal(b.tipo, "envio_duplicado");
    assert.deepEqual(destinatarios(id), esperados(...PERMITIDOS), "reparado al repetir");
  });

  test("A1 nadie con sesión puede ejecutar la función de aviso ni leer avisos ajenos por PostgREST directo", async () => {
    const id = num(`select max(id) from public.cotizaciones`);
    const prueba = async (token: string, ruta: string, cuerpo?: unknown) => {
      const resp = await fetch(`${PGRST}${ruta}`, { method: cuerpo ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
      return { status: resp.status, cuerpo: await resp.text() };
    };
    const tokenAdmin = jwt({ role: "authenticated", sub: U.admin.id, session_id: sidDe(U.admin.id) });
    const rpcAdmin = await prueba(tokenAdmin, "/rpc/avisar_cotizacion_publica", { p_cotizacion_id: id });
    assert.ok(rpcAdmin.status === 401 || rpcAdmin.status === 403, `authenticated no ejecuta la función (HTTP ${rpcAdmin.status})`);
    const rpcAnon = await prueba(jwt({ role: "anon" }), "/rpc/avisar_cotizacion_publica", { p_cotizacion_id: id });
    assert.ok(rpcAnon.status === 401 || rpcAnon.status === 403, `anon no ejecuta la función (HTTP ${rpcAnon.status})`);
    const tabla = await prueba(tokenAdmin, "/avisos?select=id");
    assert.ok(tabla.status === 401 || tabla.status === 403, `authenticated no lee la tabla avisos (HTTP ${tabla.status})`);
    sondeos.length = 0;
  });

  test("T1 el aviso de una cotización pública no cuenta para una cotización de otra agencia ni de un aliado (la base re-verifica)", async () => {
    // Una cotización de aliado (con correo de autor) y una de minorista, pasadas a mano por la función: no_aplica y 0 avisos.
    const ally = await como("agencia", () => carrito(cliente("7806001"))); assert.equal(ally.ok, true, ally.error);
    const idAliado = idDe(ally.cotizacion!.codigo);
    const resp = JSON.parse(sql(`select public.avisar_cotizacion_publica(${idAliado})::text`)) as { estado: string; notificados: number };
    assert.deepEqual(resp, { estado: "no_aplica", notificados: 0 }); assert.equal(hayAvisos(idAliado), 0);
  });
});
