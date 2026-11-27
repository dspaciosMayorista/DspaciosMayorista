// Bloque 3 (#11 presencia reciente · #13 avisos en la campana global, sin correo · #36 estado de publicación). Recorrido REAL: módulos de producción (RPC de presencia, generador y campana, cargadores, composición del listado,
// cron diario) → PostgREST propio → PostgreSQL local con migraciones reales + 343. Lo único simulado es la sesión (JWT firmado) y el borde externo de correo (fetch a Resend, que nunca sale de la máquina).
// SOLO base LOCAL desechable; lo lanza supabase/scripts/test_bloque3_11_13_36.sh. Expectativas calculadas a mano en los fixtures (ver cada bloque).
import { test, describe, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG111_CONTENEDOR ?? "";
const DB = process.env.PG111_BASE ?? "";
const PGRST = process.env.PG111_POSTGREST ?? "";
const SECRETO = process.env.PG111_JWT_SECRET ?? "";
if (!CT || !DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG111_*: usa supabase/scripts/test_bloque3_11_13_36.sh.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
  // NextResponse mínimo para ejecutar la ruta de cron real fuera de Next.
  "next/server": "export class NextResponse { static json(b, i) { return new Response(JSON.stringify(b), { status: (i && i.status) || 200, headers: { 'content-type': 'application/json' } }); } }" };
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
const uid = (n: number) => `00000000-0000-0000-0000-00000011${String(n).padStart(4, "0")}`;
const U = {
  superadmin: { id: uid(1), email: "t111-super@x.test", nombre: "T111 Super", rol: "superadmin", activo: true },
  gerencia: { id: uid(2), email: "t111-gerencia@x.test", nombre: "T111 Gerencia", rol: "gerencia", activo: true },
  inactivo: { id: uid(3), email: "t111-inactivo@x.test", nombre: "T111 Inactivo", rol: "superadmin", activo: false },
  venta: { id: uid(4), email: "t111-venta@x.test", nombre: "T111 Venta", rol: "venta", activo: true },
  operaciones: { id: uid(5), email: "t111-oper@x.test", nombre: "T111 Operaciones", rol: "operaciones", activo: true },
  agencia: { id: uid(6), email: "t111-agencia@x.test", nombre: "T111 Agencia", rol: "agencia", activo: true, aliado: 11901 },
  freelance: { id: uid(7), email: "t111-free@x.test", nombre: "T111 Freelance", rol: "freelance", activo: true, aliado: 11902 },
  administracion: { id: uid(8), email: "t111-admin@x.test", nombre: "T111 Admin", rol: "administracion", activo: true },
  operMin: { id: uid(9), email: "t111-opermin@x.test", nombre: "T111 OperMin", rol: "operaciones", activo: true, tenant: "minorista" },
  superMin: { id: uid(10), email: "t111-supermin@x.test", nombre: "T111 SuperMin", rol: "superadmin", activo: true, tenant: "minorista" },
  clienteFinal: { id: uid(11), email: "t111-cliente@x.test", nombre: "T111 Cliente", rol: "cliente_final", activo: true },
} as const;
const tenantDe = (u: object) => (u as { tenant?: string }).tenant ?? "mayorista";
const aliadoDe = (u: object) => (u as { aliado?: number }).aliado ?? "null";
let sesion: Quien | null = "operaciones";
type Quien = keyof typeof U;
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.NEXT_PUBLIC_SITE_URL = "https://app.local.test";
process.env.RESEND_API_KEY = "re_local_test";

const fetchReal = globalThis.fetch;
let rpcSolicitudes = 0;
const fetchLocal: typeof fetch = (input, init) => { rpcSolicitudes++; return fetchReal(String(input).replace("/rest/v1/", "/"), init); };
function clienteLocal(token: string, fetchPropio: typeof fetch = fetchLocal) {
  return crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchPropio } });
}
const clienteDe = (q: Quien | "anon" | "servicio") => clienteLocal(q === "servicio" ? TOKEN_SERVICIO : q === "anon" ? jwt({ role: "anon" }) : jwt({ role: "authenticated", sub: U[q].id }));
function sql(q: string): string {
  try {
    return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (e) { throw new Error(`SQL falló: ${String((e as { stderr?: unknown }).stderr ?? e).slice(0, 600)}`); }
}

// Borde externo: el correo. Cualquier llamada a Resend se captura y NO sale; todo lo demás (PostgREST) pasa por fetchLocal con el fetch real guardado arriba.
type Correo = { to: string[]; subject: string; html: string };
let correos: Correo[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("https://api.resend.com/")) { correos.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ id: "correo-local" }), { status: 200 }); }
  throw new Error(`Salida de red inesperada en la prueba: ${url}`);
}) as typeof fetch;

mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });
// Sesión de servidor de la campana: el cliente sigue a la persona de la prueba; getUser no consulta GoTrue (no existe aquí) y responde la persona de la sesión.
function clienteSesion() {
  if (sesion == null) return clienteLocal(jwt({ role: "anon" }));
  const u = U[sesion]; const c = clienteLocal(jwt({ role: "authenticated", sub: u.id, session_id: u.id.replace(/^00000000/, "5e550000") }));
  (c.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: { id: u.id, email: u.email } }, error: null });
  return c;
}
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
async function como<T>(quien: Quien | null, fn: () => Promise<T>): Promise<T> { const antes = sesion; sesion = quien; try { return await fn(); } finally { sesion = antes; } }

const { hoyBogota } = await import("../lib/cotizacion/vigencia.ts");
const { sumarDiasISO } = await import("../lib/cotizacion/vigencia.ts");
const { cargarAvisosCompra } = await import("../lib/paquetes/vencimientoCompraDatos.ts");
const { estadoPublicacionPaquete } = await import("../lib/paquetes/estadoPublicacion.ts");
const { cargarHotelesBernaloDescubiertos } = await import("../lib/tarifario/datosBernalo.ts");
const { cargarHotelesBajoSolicitud } = await import("../lib/tarifario/datosSolicitud.ts");
const { cargarFilasResumenPaginado } = await import("../lib/tarifario/resumen.ts");
const { enviarNotificaciones } = await import("../lib/notificaciones.ts");
const { sondearAvisos, marcarAvisosLeidos, revisarAlertaCompra } = await import("../lib/avisos/actions.ts");
const { cargarAlertasCompra } = await import("../lib/avisos/alertasCompra.ts");
const { GET } = await import("../app/api/cron/notificaciones/route.ts");
const { generarAvisosCompraCon } = await import("../lib/avisos/generarCompra.ts");

// Renombrar una tabla cambia el esquema que PostgREST tiene en caché: se le pide recargarlo (y se espera) tras cada cambio, para que el fallo y su restablecimiento sean reales.
const recargarEsquema = async () => { sql(`notify pgrst, 'reload schema'`); await new Promise((r) => setTimeout(r, 1200)); };
const HOY = hoyBogota();
const d = (n: number) => sumarDiasISO(HOY, n);
const ALIADO_NOMBRE_HTML = `<b>Mal</b> & Co`;

before(() => {
  const us = Object.values(U);
  sql(`
    alter table auth.users add column if not exists last_sign_in_at timestamptz;   -- la plantilla local trae un auth.users simplificado; Supabase real ya lo tiene
    insert into auth.users (id, email, last_sign_in_at) values ${us.map((u) => `('${u.id}', '${u.email}', ${u.rol === "superadmin" && u.activo ? "now() - interval '1 hour'" : "null"})`).join(", ")} on conflict (id) do update set last_sign_in_at = excluded.last_sign_in_at;
    insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion, activo) values
      (11901, 'T111 Aliado Agencia', '119010', 'agencia', 0.1, false, 0, true), (11902, 'T111 Aliado Freelance', '119020', 'freelance', 0.1, false, 0, true) on conflict (id) do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values ${us.map((u) => `('${u.id}', '${u.email}', '${u.nombre}', '${u.rol}', ${u.activo}, '${tenantDe(u)}', ${aliadoDe(u)})`).join(", ")}
      on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, nombre = excluded.nombre, tenant = excluded.tenant, aliado_id = excluded.aliado_id;
    insert into auth.sessions (id, user_id) select ('5e550000' || substr(id::text, 9))::uuid, id from public.usuarios where id in (${us.map((u) => `'${u.id}'`).join(", ")}) on conflict do nothing;

    -- #11 · auditoría con marcas de tiempo relativas a AHORA (nunca el reloj del servidor de pruebas). Se inserta directo: la tabla no tiene escritura para clientes.
    delete from public.auditoria where actor_id in (${us.map((u) => `'${u.id}'`).join(", ")});
    insert into public.auditoria (creado_en, actor_id, actor_email, actor_rol, accion, tabla, registro_id) values
      (now() - interval '5 minutes',  '${U.superadmin.id}', '${U.superadmin.email}', 'superadmin', 'UPDATE', 'ventas', 'A'),
      (now() - interval '2 hours',    '${U.superadmin.id}', '${U.superadmin.email}', 'superadmin', 'INSERT', 'ventas', 'B'),
      (now() - interval '30 hours',   '${U.superadmin.id}', '${U.superadmin.email}', 'superadmin', 'UPDATE', 'ventas', 'C'),
      (now() - interval '6 days',     '${U.superadmin.id}', '${U.superadmin.email}', 'superadmin', 'DELETE', 'ventas', 'D'),
      (now() - interval '8 days',     '${U.superadmin.id}', '${U.superadmin.email}', 'superadmin', 'UPDATE', 'ventas', 'E'),
      (now() - interval '20 minutes', '${U.venta.id}', '${U.venta.email}', 'venta', 'UPDATE', 'cotizaciones', 'F'),
      (now() - interval '3 hours',    '${U.venta.id}', '${U.venta.email}', 'venta', 'INSERT', 'cotizaciones', 'G'),
      (now() - interval '20 days',    '${U.venta.id}', '${U.venta.email}', 'venta', 'UPDATE', 'cotizaciones', 'H'),
      (now() - interval '40 days',    '${U.venta.id}', '${U.venta.email}', 'venta', 'UPDATE', 'cotizaciones', 'H2'),
      (now() - interval '10 days',    '${U.gerencia.id}', '${U.gerencia.email}', 'gerencia', 'UPDATE', 'ventas', 'I'),
      (now() - interval '1 minute',   '${U.inactivo.id}', '${U.inactivo.email}', 'superadmin', 'UPDATE', 'ventas', 'J'),
      (now() - interval '1 minute',   '${U.agencia.id}', '${U.agencia.email}', 'agencia', 'UPDATE', 'cotizaciones', 'K'),
      (now() - interval '1 minute',   null, null, null, 'UPDATE', 'avisos', 'Sistema');
  `);

  // #13 · vigencias de compra relativas a HOY (Bogotá). Ids 11001+.
  sql(`
    insert into public.destinos (id, nombre) values (11001, 'T111 DESTINO') on conflict (id) do nothing;
    delete from public.paquete_din where id between 11001 and 11010;
    delete from public.armado_empaquetados where paquete_id between 11001 and 11020;
    delete from public.salidas_dinamicas where paquete_id between 11001 and 11020;
    delete from public.empaquetados where id between 11001 and 11010;
    delete from public.armado_paquetes where id between 11001 and 11020;
    insert into public.armado_paquetes (id, nombre, destino_id, activo, tipo, noches, fecha_compra_fin, fecha_viaje_inicio, fecha_viaje_fin) values
      (11001, 'P1 Cartagena bloqueo',  11001, true,  'bloqueo',           3, '${d(2)}',  '${d(30)}', '${d(40)}'),
      (11002, 'P2 vence hoy',          11001, true,  'porcion_terrestre', 3, '${d(0)}',  '${d(30)}', '${d(40)}'),
      (11003, 'P3 ya vencido',         11001, true,  'porcion_terrestre', 3, '${d(-1)}', '${d(30)}', '${d(40)}'),
      (11004, 'P4 inactivo',           11001, false, 'porcion_terrestre', 3, '${d(1)}',  '${d(30)}', '${d(40)}'),
      (11005, 'P5 lejano',             11001, true,  'porcion_terrestre', 3, '${d(9)}',  '${d(30)}', '${d(40)}'),
      (11006, 'P6 dinámico activo',    11001, true,  'dinamico',          3, null,       '${d(30)}', '${d(40)}'),
      (11007, 'P7 dinámico inactivo',  11001, false, 'dinamico',          3, null,       '${d(30)}', '${d(40)}'),
      (11008, 'P8 ${ALIADO_NOMBRE_HTML}', 11001, true, 'porcion_terrestre', 3, '${d(5)}', '${d(30)}', '${d(40)}');
    insert into public.salidas_dinamicas (id, paquete_id, fecha_ida, fecha_regreso, compra_fin, activo) values
      (11001, 11006, '${d(60)}', '${d(64)}', '${d(3)}', true),
      (11002, 11006, '${d(70)}', '${d(74)}', '${d(3)}', false),
      (11003, 11007, '${d(60)}', '${d(64)}', '${d(1)}', true);
    insert into public.empaquetados (id, ruta, destino_id, fecha_ida, fecha_regreso, compra_fin, activo) values
      (11001, 'MDE - CTG - MDE', 11001, '${d(50)}', '${d(54)}', '${d(4)}', true),
      (11002, 'BOG - MIA - BOG', 11001, '${d(50)}', '${d(54)}', '${d(4)}', true),
      (11003, 'BOG - SJO - BOG', 11001, '${d(50)}', '${d(54)}', '${d(4)}', true),
      (11004, 'BOG - PTY - BOG', 11001, '${d(50)}', '${d(54)}', '${d(4)}', false);
    insert into public.armado_empaquetados (paquete_id, empaquetado_id) values (11001, 11001), (11004, 11001), (11004, 11003), (11001, 11004);
    insert into public.paquete_din (id, nombre, destino_id, esquema, pvp_modo, usa_hotel, compra_fin, activo, publicado) values
      (11001, 'PT1 total publicado', 11001, 'solo_pvp', 'general', true, '${d(1)}', true, true),
      (11002, 'PT2 total borrador',  11001, 'solo_pvp', 'general', true, '${d(1)}', true, false),
      (11003, 'PT3 total inactivo',  11001, 'solo_pvp', 'general', true, '${d(1)}', false, true);
  `);
});

describe("#11 presencia reciente (RPC reales por PostgREST)", () => {
  type Fila = { usuario_id: string; nombre: string; rol: string; aliado: string | null; visto_en: string | null; ultima_actividad: string | null; eventos_ventana: number; eventos_24h: number; ultimo_ingreso: string | null; total: number };
  const pedir = async (q: Quien | "anon" | "servicio", dias?: number) => clienteDe(q).rpc("fn_actividad_reciente", dias === undefined ? {} : { p_dias: dias });
  const por = (filas: Fila[], q: Quien) => filas.find((f) => f.usuario_id === U[q].id);
  const visto = (q: Quien) => sql(`select visto_en::text from public.presencia_usuario where usuario_id = '${U[q].id}'`);
  const poner = (q: Quien, intervalo: string | null) => sql(intervalo === null ? `delete from public.presencia_usuario where usuario_id = '${U[q].id}'` : `insert into public.presencia_usuario (usuario_id, visto_en) values ('${U[q].id}', now() - interval '${intervalo}') on conflict (usuario_id) do update set visto_en = excluded.visto_en`);
  before(() => { sql(`delete from public.presencia_usuario`); });

  test("registrar_presencia: la primera llamada escribe; las siguientes dentro de 4 min NO (el instante no cambia); 20 llamadas seguidas = 1 sola escritura", async () => {
    const cli = clienteDe("operaciones");
    const primera = await cli.rpc("registrar_presencia");
    assert.equal(primera.error, null, JSON.stringify(primera.error)); assert.equal(primera.data, true);
    const t0 = visto("operaciones"); assert.ok(t0);
    const resultados: unknown[] = [];
    for (let i = 0; i < 20; i++) resultados.push((await cli.rpc("registrar_presencia")).data);
    assert.deepEqual(resultados, Array(20).fill(false), "dentro de la ventana de 4 min la base no escribe");
    assert.equal(visto("operaciones"), t0, "el instante guardado no cambió");
  });
  test("pasados 4 min la base vuelve a escribir y avanza el instante", async () => {
    poner("operaciones", "5 minutes");
    const antes = visto("operaciones");
    assert.equal((await clienteDe("operaciones").rpc("registrar_presencia")).data, true);
    const despues = visto("operaciones");
    assert.ok(new Date(despues).getTime() > new Date(antes).getTime() + 200_000, `antes ${antes} · después ${despues}`);
    poner("operaciones", "3 minutes");
    assert.equal((await clienteDe("operaciones").rpc("registrar_presencia")).data, false, "con 3 min de antigüedad todavía no escribe");
  });
  test("quién tiene presencia: personal interno Y aliados B2B activos; cliente_final, inactivo y anónimo no dejan fila", async () => {
    for (const q of ["superadmin", "gerencia", "venta", "agencia", "freelance", "administracion"] as const) {
      sql(`delete from public.presencia_usuario where usuario_id = '${U[q].id}'`);
      assert.equal((await clienteDe(q).rpc("registrar_presencia")).data, true, q);
      assert.ok(visto(q), `${q} debe quedar con su observación`);
    }
    for (const q of ["clienteFinal", "inactivo"] as const) {
      assert.equal((await clienteDe(q).rpc("registrar_presencia")).data, false, q);
      assert.equal(visto(q), "", `${q} no deja fila`);
    }
    const anon = await clienteDe("anon").rpc("registrar_presencia");
    assert.ok(anon.error, "un visitante sin sesión es rechazado"); assert.equal(sql(`select count(*) from public.presencia_usuario where usuario_id not in (${Object.values(U).map((u) => `'${u.id}'`).join(",")})`), "0");
  });
  test("la tabla de presencia no es legible ni escribible por ningún cliente (solo las funciones)", async () => {
    for (const q of ["superadmin", "operaciones", "agencia", "anon", "servicio"] as const) {
      const lee = await clienteDe(q).from("presencia_usuario" as never).select("*");
      assert.ok(lee.error, `${q}: lectura directa debería fallar`);
      const escribe = await clienteDe(q).from("presencia_usuario" as never).insert({ usuario_id: U.venta.id, visto_en: new Date().toISOString() } as never);
      assert.ok(escribe.error, `${q}: escritura directa debería fallar`);
    }
  });
  test("informe del superadmin: personal interno Y aliados, la presencia manda en el orden; contexto aparte (último ingreso, último cambio) con conteos calculados a mano", async () => {
    sql(`delete from public.presencia_usuario`);
    poner("superadmin", "3 minutes"); poner("agencia", "6 minutes"); poner("operaciones", "2 hours"); poner("freelance", "3 days");
    const r = await pedir("superadmin");
    assert.equal(r.error, null, JSON.stringify(r.error));
    const filas = r.data as unknown as Fila[];
    assert.deepEqual(filas.slice(0, 4).map((f) => f.usuario_id), [U.superadmin.id, U.agencia.id, U.operaciones.id, U.freelance.id], "presencia más reciente primero");
    assert.equal(filas[4].usuario_id, U.venta.id, "sin observación: ordena por el último cambio guardado (venta: 20 min)");
    assert.ok(por(filas, "gerencia") && por(filas, "administracion") && por(filas, "operMin") && por(filas, "superMin"));
    for (const q of ["inactivo", "clienteFinal"] as const) assert.equal(por(filas, q), undefined, `${q} fuera`);
    assert.equal(filas.length, 9); assert.ok(filas.every((f) => f.total === 9), "total real de personas con presencia posible");
    assert.deepEqual([por(filas, "agencia")!.aliado, por(filas, "freelance")!.aliado], ["T111 Aliado Agencia", "T111 Aliado Freelance"], "el aliado se nombra");
    const min = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 60000 : null);
    assert.ok(min(por(filas, "superadmin")!.visto_en)! >= 2.5 && min(por(filas, "superadmin")!.visto_en)! < 6);
    assert.equal(por(filas, "venta")!.visto_en, null, "sin observación = null, no se inventa");
    const s = por(filas, "superadmin")!, v = por(filas, "venta")!;
    assert.deepEqual([s.eventos_ventana, s.eventos_24h, v.eventos_ventana, v.eventos_24h], [4, 2, 2, 2], "S: 5 min, 2 h, 30 h, 6 d dentro de 7 días (8 d fuera); V: 20 min y 3 h (20 y 40 d fuera)");
    assert.ok(s.ultimo_ingreso && Math.abs((Date.now() - new Date(s.ultimo_ingreso).getTime()) / 3_600_000 - 1) < 0.1, "último ingreso ≈ hace 1 h");
    assert.equal(v.ultimo_ingreso, null);
  });
  test("el evento sin actor («Sistema») no se atribuye a nadie y la ventana de contexto se limita a 30 días", async () => {
    const filas = (await pedir("superadmin")).data as unknown as Fila[];
    assert.deepEqual(filas.filter((f) => f.eventos_24h > 0).map((f) => [f.nombre, f.eventos_24h]), [["T111 Super", 2], ["T111 Agencia", 1], ["T111 Venta", 2]], "S (2), el aliado agencia (1: ahora SÍ se lista) y V (2); el evento sin actor y el del usuario inactivo no se atribuyen a nadie");
    const uno = (await pedir("superadmin", 1)).data as unknown as Fila[];
    assert.equal(por(uno, "superadmin")!.eventos_ventana, 2);
    const largo = (await pedir("superadmin", 999)).data as unknown as Fila[];
    assert.equal(por(largo, "venta")!.eventos_ventana, 3, "999 se limita a 30: entra el de 20 días, no el de 40");
  });
  test("solo superadmin: gerencia, superadmin INACTIVO, venta, operaciones, aliados, anon y llave de servicio sin actor son rechazados (nunca una lista vacía)", async () => {
    for (const q of ["gerencia", "inactivo", "venta", "operaciones", "agencia", "freelance", "servicio"] as const) {
      const r = await pedir(q);
      assert.ok(r.error, `${q} debería ser rechazado`); assert.equal(r.data, null); assert.equal(r.error!.code, "42501", `${q}: ${JSON.stringify(r.error)}`);
    }
    const anon = await pedir("anon"); assert.ok(anon.error); assert.equal(anon.data, null);
  });
  test("no expone contenido de los cambios: solo conteos, marcas de tiempo y nombres", async () => {
    const fila = ((await pedir("superadmin")).data as unknown as Record<string, unknown>[])[0];
    assert.deepEqual(Object.keys(fila).sort(), ["aliado", "email", "eventos_24h", "eventos_ventana", "nombre", "rol", "tenant", "total", "ultima_actividad", "ultimo_ingreso", "usuario_id", "visto_en"]);
  });
});

describe("#13 cargarAvisosCompra (lectura real de las cuatro fuentes)", () => {
  const claves = (r: Awaited<ReturnType<typeof cargarAvisosCompra>>) => (r.ok ? r.avisos.map((a) => `${a.clave}@${a.dias}`) : ["ERROR"]);

  test("cuatro variantes, solo activas y vigentes dentro de 5 días, ordenadas por fecha (hoy = Bogotá)", async () => {
    const r = await cargarAvisosCompra(clienteDe("servicio"), HOY, 5);
    assert.ok(r.ok);
    // Calculado a mano: P2 vence hoy (0) · PT1 total publicado (1) · P1 (2) · salida dinámica de P6 (3) · empaquetado 11001 vinculado a P1 (4) · P8 (5, límite inclusivo).
    // Fuera: P3 vencido, P4 inactivo, P5 (hoy+9), salida inactiva 11002, salida de paquete inactivo 11003, empaquetados 11002 (sin paquete)/11003 (solo paquete inactivo)/11004 (inactivo), PT2 borrador, PT3 inactivo.
    assert.deepEqual(claves(r), ["paquete:11002@0", "paquete_total:11001@1", "paquete:11001@2", "salida_dinamica:11001@3", "empaquetado:11001@4", "paquete:11008@5"]);
    if (r.ok) assert.equal(r.truncado, false);
  });
  test("enlaces a la pantalla correcta de cada vigencia y detalle de la ventana afectada", async () => {
    const r = await cargarAvisosCompra(clienteDe("servicio"), HOY, 5);
    assert.ok(r.ok); if (!r.ok) return;
    const por = Object.fromEntries(r.avisos.map((a) => [a.clave, a]));
    assert.equal(por["paquete:11001"].ruta, "/dashboard/paquetes/11001?tab=config");
    assert.equal(por["salida_dinamica:11001"].ruta, "/dashboard/paquetes/11006?tab=vuelos");
    assert.match(por["salida_dinamica:11001"].detalle, new RegExp(`${d(60)} → ${d(64)}`));
    assert.equal(por["empaquetado:11001"].ruta, "/dashboard/vuelos/empaquetados/11001");
    assert.match(por["empaquetado:11001"].detalle, /paquetes: P1 Cartagena bloqueo$/, "nombra solo el paquete ACTIVO vinculado (no P4 inactivo)");
    assert.equal(por["paquete_total:11001"].ruta, "/dashboard/paquetes/total/11001");
  });
  test("umbral: 0 días = solo lo que vence hoy; 10 días suma el lejano (hoy+9); ausente/ inválido = 5", async () => {
    assert.deepEqual(claves(await cargarAvisosCompra(clienteDe("servicio"), HOY, 0)), ["paquete:11002@0"]);
    assert.ok(claves(await cargarAvisosCompra(clienteDe("servicio"), HOY, 10)).includes("paquete:11005@9"));
    assert.deepEqual(claves(await cargarAvisosCompra(clienteDe("servicio"), HOY, Number.NaN)), claves(await cargarAvisosCompra(clienteDe("servicio"), HOY, 5)));
  });
  test("con la sesión de un usuario interno (la que usa la pantalla de Paquetes, con RLS) el resultado es el mismo", async () => {
    assert.deepEqual(claves(await cargarAvisosCompra(clienteDe("operaciones"), HOY, 5)), claves(await cargarAvisosCompra(clienteDe("servicio"), HOY, 5)));
  });
  test("un fallo de lectura NO se presenta como «no hay avisos»", async () => {
    const roto = clienteLocal(TOKEN_SERVICIO, (async () => new Response(JSON.stringify({ message: "boom" }), { status: 500, headers: { "content-type": "application/json" } })) as typeof fetch);
    const r = await cargarAvisosCompra(roto, HOY, 5);
    assert.equal(r.ok, false);
  });
  test("consumo: 4 consultas por carga, sin importar cuántos paquetes haya", async () => {
    const antes = rpcSolicitudes; await cargarAvisosCompra(clienteDe("servicio"), HOY, 5);
    assert.equal(rpcSolicitudes - antes, 4);
  });
});

describe("B3-2 el barrido de vigencias no se deja engañar por candidatos excluidos ni oculta un recorte", () => {
  const limpiar = () => sql(`
    delete from public.armado_empaquetados where empaquetado_id between 21000 and 21999;
    delete from public.empaquetados where id between 21000 and 21999;
    delete from public.salidas_dinamicas where id between 20000 and 20999;`);
  before(() => limpiar());
  after(() => limpiar());
  const claves = (r: Awaited<ReturnType<typeof cargarAvisosCompra>>) => (r.ok ? r.avisos.map((a) => a.clave) : ["ERROR"]);

  test("más de 200 salidas y empaquetados EXCLUIDOS (paquete inactivo) con fecha ANTERIOR no desplazan al elegible: se devuelve y no hay truncamiento falso", async () => {
    sql(`
      insert into public.salidas_dinamicas (id, paquete_id, fecha_ida, fecha_regreso, compra_fin, activo) select 20000 + g, 11007, '${d(60)}', '${d(64)}', '${d(1)}', true from generate_series(1, 205) g;
      insert into public.empaquetados (id, ruta, destino_id, fecha_ida, fecha_regreso, compra_fin, activo) select 21000 + g, 'EXC ' || g, 11001, '${d(50)}', '${d(54)}', '${d(1)}', true from generate_series(1, 205) g;
      insert into public.armado_empaquetados (paquete_id, empaquetado_id) select 11004, 21000 + g from generate_series(1, 205) g;`);
    const r = await cargarAvisosCompra(clienteDe("servicio"), HOY, 5);
    assert.ok(r.ok); if (!r.ok) return;
    assert.ok(claves(r).includes("salida_dinamica:11001"), "la salida elegible (paquete activo) aparece pese a 205 excluidas anteriores");
    assert.ok(claves(r).includes("empaquetado:11001"), "el empaquetado elegible aparece pese a 205 excluidos anteriores");
    assert.equal(r.truncado, false, "lo excluido no cuenta para el tope");
    assert.equal(claves(r).filter((c) => c.startsWith("salida_dinamica:2")).length, 0);
    limpiar();
  });
  test("más de 200 ELEGIBLES: se devuelven los 200 de fecha más próxima y el resultado queda marcado como truncado", async () => {
    sql(`insert into public.salidas_dinamicas (id, paquete_id, fecha_ida, fecha_regreso, compra_fin, activo) select 20000 + g, 11006, '${d(60)}', '${d(64)}', '${d(2)}', true from generate_series(1, 205) g;`);
    const r = await cargarAvisosCompra(clienteDe("servicio"), HOY, 5);
    assert.ok(r.ok); if (!r.ok) return;
    assert.equal(r.truncado, true);
    assert.equal(claves(r).filter((c) => c.startsWith("salida_dinamica:")).length, 200, "tope de 200 por fuente");
    assert.ok(!claves(r).includes("salida_dinamica:11001"), "la elegible de fecha posterior (d+3) queda detrás de las 200 más próximas (d+2)");
    limpiar();
  });
  test("consumo: el recorte no multiplica consultas (siguen siendo 4)", async () => {
    sql(`insert into public.salidas_dinamicas (id, paquete_id, fecha_ida, fecha_regreso, compra_fin, activo) select 20000 + g, 11006, '${d(60)}', '${d(64)}', '${d(2)}', true from generate_series(1, 205) g;`);
    const antes = rpcSolicitudes; await cargarAvisosCompra(clienteDe("servicio"), HOY, 5);
    assert.equal(rpcSolicitudes - antes, 4);
    limpiar();
  });
});

describe("#13 avisos de compra (generar_avisos_compra real; 344: área de ALERTAS y campana sin ellos; SIN correo)", () => {
  type Gen = { hoy: string; dias: number; ventanas: number; creados: number; archivados: number; pendientes: number; truncado: boolean };
  const gen = async (hoy?: string, dias?: number): Promise<Gen> => {
    const r = await clienteDe("servicio").rpc("generar_avisos_compra", { p_hoy: hoy ?? null, p_dias: dias ?? null } as never);
    assert.equal(r.error, null, JSON.stringify(r.error)); return r.data as unknown as Gen;
  };
  const n = (q: string) => Number(sql(q));
  const vivos = (extra = "") => n(`select count(*) from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null ${extra}`);
  const dest = () => sql(`select string_agg(distinct usuario_id::text, ',' order by usuario_id::text) from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null`).split(",").filter(Boolean);
  const RECIBEN = [U.superadmin.id, U.gerencia.id, U.operaciones.id, U.administracion.id, U.superMin.id].sort();
  before(() => { sql(`delete from public.avisos where tipo = 'compra_por_vencer'; update public.config_notificaciones set dias_anticipacion = 5 where id = 1;`); });

  test("primera ejecución: 6 ventanas × 5 destinatarios = 30 avisos; reciben SOLO quienes pueden escribir paquetes de la agencia (superadmin de cualquiera)", async () => {
    const g = await gen();
    assert.deepEqual([g.hoy, g.dias, g.ventanas, g.creados, g.archivados, g.truncado], [HOY, 5, 6, 30, 0, false]);
    assert.deepEqual(dest(), RECIBEN, "superadmin (mayorista y minorista), gerencia, operaciones y administración mayorista; NO venta, aliados, cliente final, inactivo ni operaciones de OTRA agencia");
    assert.equal(vivos(`and usuario_id = '${U.operaciones.id}'`), 6);
  });
  test("idempotente: repetir la ejecución el mismo día no duplica nada; un aviso ya LEÍDO no se repite mientras el evento sea el mismo", async () => {
    assert.deepEqual(await gen(), { hoy: HOY, dias: 5, ventanas: 6, creados: 0, archivados: 0, pendientes: 0, truncado: false });
    sql(`update public.avisos set leido_en = now() where tipo = 'compra_por_vencer' and usuario_id = '${U.gerencia.id}'`);
    assert.equal((await gen()).creados, 0); assert.equal(vivos(), 30);
  });
  test("respaldo en la base: el índice único rechaza un segundo aviso VIVO del mismo evento y persona (también si el primero ya está leído); archivado el primero, se admite uno nuevo", async () => {
    const dup = `insert into public.avisos (usuario_id, tipo, numero_contrato, ventana_tipo, ventana_id, ventana_ref, ventana_titulo, compra_fin)
      select usuario_id, tipo, numero_contrato, ventana_tipo, ventana_id, ventana_ref, ventana_titulo, compra_fin from public.avisos
       where tipo = 'compra_por_vencer' and archivado_en is null and usuario_id = '${U.gerencia.id}' order by id limit 1`;
    assert.equal(n(`select count(*) from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null and leido_en is not null and usuario_id = '${U.gerencia.id}'`), 6, "los 6 de gerencia están leídos");
    assert.throws(() => sql(dup), /uq_avisos_compra_vivo|duplicate key/i);
    assert.equal(vivos(), 30);
    sql(`update public.avisos set archivado_en = now() where id = (select min(id) from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null and usuario_id = '${U.gerencia.id}')`);
    assert.equal(vivos(), 29); await gen(); assert.equal(vivos(), 30, "el generador repone el archivado (un solo vivo por persona y evento)");
  });

  // ── Área de ALERTAS del tablero (B3-02): `cargarAlertasCompra` real; y la campana real (`sondearAvisos`) YA NO ve estos avisos ───────────────────────────────────────────
  test("ALERTAS: quien puede escribir paquetes ve las 6 alertas con el plazo a HOY (Bogotá) y el enlace a SU vigencia; la campana NO las cuenta ni las lista", async () => {
    const r = await cargarAlertasCompra(U.operaciones.id, U.operaciones.rol);
    assert.equal(r.ok, true); assert.equal(r.total, 6); assert.equal(r.alertas.length, 6);
    const porHref = Object.fromEntries(r.alertas.map((a) => [a.href, a.texto]));
    assert.deepEqual(Object.keys(porHref).sort(), ["/dashboard/paquetes/11001?tab=config", "/dashboard/paquetes/11002?tab=config", "/dashboard/paquetes/11006?tab=vuelos", "/dashboard/paquetes/11008?tab=config", "/dashboard/paquetes/total/11001", "/dashboard/vuelos/empaquetados/11001"]);
    assert.match(porHref["/dashboard/paquetes/11002?tab=config"]!, /P2 vence hoy · Vence hoy \(/);
    assert.match(porHref["/dashboard/paquetes/total/11001"]!, /PT1 total publicado · Vence mañana/);
    assert.match(porHref["/dashboard/paquetes/11001?tab=config"]!, /Vence en 2 días/);
    assert.match(porHref["/dashboard/vuelos/empaquetados/11001"]!, /MDE - CTG - MDE · .*Vence en 4 días/);
    assert.match(porHref["/dashboard/paquetes/11008?tab=config"]!, /Vence en 5 días/);
    const campana = await como("operaciones", () => sondearAvisos(false));
    assert.deepEqual([campana.noLeidos, campana.recientes.length], [0, 0], "la campana no cuenta ni lista alertas de compra aunque la persona tiene 6 vivas");
  });
  test("campana: reclamar NO entrega ni marca alertas de compra, y «marcar todo como leído» tampoco las toca; los avisos de soporte de pago siguen igual", async () => {
    sql(`insert into public.avisos (usuario_id, tipo, numero_contrato) values ('${U.operaciones.id}', 'soporte_pago_nuevo', 'DTM-9201')`);
    const a = await como("operaciones", () => sondearAvisos(true));
    assert.deepEqual(a.nuevos.map((x) => x.tipo), ["soporte_pago_nuevo"], "solo el aviso de soporte se reclama");
    assert.deepEqual([a.noLeidos, a.recientes.map((x) => x.tipo)], [1, ["soporte_pago_nuevo"]]);
    assert.equal(n(`select count(*) from public.avisos where tipo = 'compra_por_vencer' and usuario_id = '${U.operaciones.id}' and notificado_en is not null`), 0, "reclamar no marca las alertas");
    assert.deepEqual(await como("operaciones", () => marcarAvisosLeidos()), { ok: true });
    assert.equal(n(`select count(*) from public.avisos where tipo = 'compra_por_vencer' and usuario_id = '${U.operaciones.id}' and leido_en is not null`), 0, "«marcar todo» no revisa ni lee las alertas");
    assert.equal(n(`select count(*) from public.avisos where tipo = 'soporte_pago_nuevo' and usuario_id = '${U.operaciones.id}' and leido_en is not null`), 1);
    assert.equal((await cargarAlertasCompra(U.operaciones.id, U.operaciones.rol)).total, 6, "las alertas siguen activas");
    sql(`delete from public.avisos where tipo = 'soporte_pago_nuevo' and usuario_id = '${U.operaciones.id}'`);
  });
  test("permisos: venta y aliados NO ven alertas de compra aunque tengan una fila (ni en el área de alertas ni en la campana) y no pueden revisarla; los avisos de soporte conservan su destino", async () => {
    sql(`
      insert into public.avisos (usuario_id, tipo, numero_contrato, ventana_tipo, ventana_id, ventana_ref, ventana_titulo, compra_fin) values
        ('${U.venta.id}', 'compra_por_vencer', 'paquete:11001', 'paquete', 11001, 11001, 'P1', '${d(2)}'),
        ('${U.agencia.id}', 'compra_por_vencer', 'paquete:11001', 'paquete', 11001, 11001, 'P1', '${d(2)}');
      insert into public.avisos (usuario_id, tipo, numero_contrato) values ('${U.venta.id}', 'soporte_pago_nuevo', 'DTM-9101'), ('${U.agencia.id}', 'soporte_pago_nuevo', 'DTM-9102');`);
    for (const q of ["venta", "agencia"] as const) assert.deepEqual(await cargarAlertasCompra(U[q].id, U[q].rol), { ok: true, alertas: [], total: 0 }, q);
    const idVenta = Number(sql(`select id from public.avisos where usuario_id = '${U.venta.id}' and tipo = 'compra_por_vencer'`));
    assert.deepEqual(await como("venta", () => revisarAlertaCompra(idVenta)), { ok: false });
    assert.equal(sql(`select revisado_en is null from public.avisos where id = ${idVenta}`), "t");
    const v = await como("venta", () => sondearAvisos(true));
    assert.deepEqual([v.noLeidos, v.recientes.map((x) => x.tipo), v.nuevos.map((x) => x.tipo)], [1, ["soporte_pago_nuevo"], ["soporte_pago_nuevo"]]);
    assert.equal(v.recientes[0].href, "/dashboard/contratos/DTM-9101", "el tipo existente conserva su destino interno");
    const a = await como("agencia", () => sondearAvisos(false));
    assert.deepEqual([a.noLeidos, a.recientes.map((x) => x.tipo)], [1, ["soporte_pago_nuevo"]]);
    assert.equal(a.recientes[0].href, "/portal/b2b/cartera?vista=soportes", "el aliado conserva su destino del portal");
    sql(`delete from public.avisos where usuario_id in ('${U.venta.id}', '${U.agencia.id}')`);
  });

  test("la tabla de avisos y el generador no son accesibles para clientes autenticados ni anónimos", async () => {
    for (const q of ["operaciones", "superadmin", "anon"] as const) {
      assert.ok((await clienteDe(q).from("avisos" as never).select("*")).error, `${q}: lectura directa`);
      const g = await clienteDe(q).rpc("generar_avisos_compra", {} as never); assert.ok(g.error, `${q}: generar`);
    }
  });

  // ── Reconciliación: fechas que cambian, paquetes que se desactivan, plazos que vencen ─────────────────────────────────────────────────────────────────
  test("cambia la fecha de fin: los avisos de la fecha anterior se archivan al instante (disparador) y la fecha nueva genera un evento nuevo, una sola vez", async () => {
    sql(`update public.armado_paquetes set fecha_compra_fin = '${d(3)}' where id = 11001`);
    assert.equal(vivos(`and ventana_tipo = 'paquete' and ventana_id = 11001`), 0, "archivados antes de que corra el cron");
    assert.equal(n(`select count(*) from public.avisos where ventana_tipo = 'paquete' and ventana_id = 11001 and compra_fin = '${d(2)}' and archivado_en is not null`), 5);
    const g = await gen(); assert.equal(g.creados, 5, "un aviso nuevo por destinatario, para la fecha nueva");
    assert.equal(vivos(`and ventana_tipo = 'paquete' and ventana_id = 11001 and compra_fin = '${d(3)}'`), 5);
    assert.equal((await gen()).creados, 0);
    sql(`update public.armado_paquetes set fecha_compra_fin = '${d(2)}' where id = 11001`); await gen();
  });
  test("se desactiva un paquete: sus avisos se archivan al instante y no se recrean; al reactivarlo con la misma fecha vuelve a avisarse", async () => {
    sql(`update public.armado_paquetes set activo = false where id = 11008`);
    assert.equal(vivos(`and ventana_id = 11008 and ventana_tipo = 'paquete'`), 0);
    assert.equal((await gen()).creados, 0);
    sql(`update public.armado_paquetes set activo = true where id = 11008`);
    assert.equal((await gen()).creados, 5);
  });
  test("se desactiva el paquete de una salida dinámica y el único paquete activo de un empaquetado: la salida se archiva al instante; el empaquetado lo retira la reconciliación diaria", async () => {
    sql(`update public.armado_paquetes set activo = false where id = 11006`);
    assert.equal(vivos(`and ventana_tipo = 'salida_dinamica'`), 0, "disparador por referencia al paquete");
    sql(`update public.armado_paquetes set activo = false where id = 11001`);
    assert.equal(vivos(`and ventana_tipo = 'empaquetado'`), 5, "el empaquetado aún figura hasta la reconciliación (sin disparador sobre el vínculo)");
    const g = await gen(); assert.ok(g.archivados >= 5);
    assert.equal(vivos(`and ventana_tipo = 'empaquetado'`), 0);
    sql(`update public.armado_paquetes set activo = true where id in (11001, 11006)`); await gen();
    assert.equal(vivos(), 30, "al reactivar vuelven los avisos de las seis ventanas");
  });
  test("se desactiva/despublica una salida, un empaquetado y un paquete total: cada uno archiva sus avisos al instante", async () => {
    sql(`update public.salidas_dinamicas set activo = false where id = 11001; update public.empaquetados set activo = false where id = 11001; update public.paquete_din set publicado = false where id = 11001;`);
    assert.equal(vivos(`and ventana_tipo in ('salida_dinamica', 'empaquetado', 'paquete_total')`), 0);
    sql(`update public.salidas_dinamicas set activo = true where id = 11001; update public.empaquetados set activo = true where id = 11001; update public.paquete_din set publicado = true where id = 11001;`); await gen();
    assert.equal(vivos(), 30);
  });
  test("vence el plazo: con la fecha avanzada, lo vencido se archiva, solo queda lo que entra a la ventana y se avisa a los mismos destinatarios", async () => {
    const g = await gen(d(6));   // hoy simulado = hoy + 6: eligible [d(6), d(11)] → solo P5 (d(9))
    assert.deepEqual([g.ventanas, g.creados, g.archivados], [1, 5, 30]);
    assert.deepEqual(dest(), RECIBEN); assert.equal(vivos(), 5);
    assert.equal(sql(`select string_agg(distinct ventana_titulo, '|') from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null`), "P5 lejano");
    await gen(); // vuelve a la fecha real: P5 queda fuera de la ventana (d(9) > hoy+5) y las seis ventanas se re-avisan
    assert.equal(vivos(), 30);
  });
  test("el umbral es el configurado (dias_anticipacion) y el parámetro lo sustituye; tope 365 y piso 0", async () => {
    sql(`update public.config_notificaciones set dias_anticipacion = 0 where id = 1`);
    const g = await gen(); assert.deepEqual([g.dias, g.ventanas], [0, 1], "con 0 días solo lo que vence hoy"); assert.equal(vivos(), 5);
    assert.equal((await gen(undefined, 9999)).dias, 365); assert.equal((await gen(undefined, -4)).dias, 0);
    sql(`update public.config_notificaciones set dias_anticipacion = 5 where id = 1`); await gen(); assert.equal(vivos(), 30);
  });
  test("el cron diario existente: genera los avisos sin enviar correo, exige su secreto y deja intacto el digest de siempre", async () => {
    sql(`delete from public.avisos where tipo = 'compra_por_vencer'; update public.config_notificaciones set destinatarios = 'ops@x.test', activo = true, alerta_cxp = false, alerta_cuotas = false, alerta_bloqueos = false where id = 1;`);
    process.env.CRON_SECRET = "cron-b3"; correos = [];
    const sin = await GET(new Request("http://x/api/cron/notificaciones")); assert.equal(sin.status, 401);
    const ok = await GET(new Request("http://x/api/cron/notificaciones", { headers: { authorization: "Bearer cron-b3" } }));
    const cuerpo = (await ok.json()) as { ok: boolean; enviado?: boolean; avisosCompra: { ok: boolean; creados: number } };
    assert.equal(ok.status, 200); assert.equal(cuerpo.avisosCompra.ok, true); assert.equal(cuerpo.avisosCompra.creados, 30);
    assert.deepEqual([cuerpo.ok, cuerpo.enviado], [true, false], "digest sin nada que decir y sin forzar: no envía");
    assert.equal(correos.length, 0, "ningún correo por avisos de compra");
    const forzado = await enviarNotificaciones({ forzar: true });
    assert.deepEqual(forzado, { ok: true, enviado: true });
    assert.doesNotMatch(correos[0].html, /compra por vencer|Paquetes:/i, "el digest no contiene ninguna sección de paquetes");
    assert.match(correos[0].html, /Alertas operativas/);
    assert.equal(sql(`select count(*) from information_schema.columns where table_name = 'config_notificaciones' and column_name = 'alerta_paquetes'`), "0", "no existe configuración de correo para paquetes");
    delete process.env.CRON_SECRET;
  });
});

describe("B3-3 generador con PROGRESO: más de 500 ventanas con la misma fecha, repetición, cobertura completa y limpieza de lo obsoleto", () => {
  type G = { hoy: string; dias: number; ventanas: number; creados: number; archivados: number; pendientes: number; truncado: boolean };
  const pasada = async (): Promise<G> => { const r = await clienteDe("servicio").rpc("generar_avisos_compra", {} as never); assert.equal(r.error, null, JSON.stringify(r.error)); return r.data as unknown as G; };
  const n = (q: string) => Number(sql(q));
  const AV = "tipo = 'compra_por_vencer'";
  const masivas = (cuantas: number) => { if (cuantas > 0) sql(`insert into public.armado_paquetes (id, nombre, destino_id, activo, tipo, noches, fecha_compra_fin) select 30000 + g, 'masivo ' || g, 11001, true, 'porcion_terrestre', 3, '${d(1)}' from generate_series(1, ${cuantas}) g;`); };
  const limpiarMasivo = () => sql(`delete from public.avisos where ${AV}; delete from public.armado_paquetes where id >= 30000; update public.armado_paquetes set activo = true where id = 11001;`);
  before(() => limpiarMasivo());
  after(() => { limpiarMasivo(); });

  for (const total of [499, 500, 501, 505]) {
    test(`${total} ventanas elegibles con la MISMA fecha (6 de la semilla + ${total - 6}): cada llamada escribe como mucho 500, avanza, termina con TODAS cubiertas, sin duplicados y la repetición ya no hace nada`, async () => {
      limpiarMasivo(); masivas(total - 6);
      const pares = 5 * total;                                           // 5 destinatarios por ventana
      const resultados: G[] = []; let cubiertasTras1 = 0;
      for (let i = 0; i < 12; i++) {
        const g = await pasada(); resultados.push(g);
        assert.equal(g.ventanas, total, "ventanas = TODAS las elegibles, no las que cupieron en el lote");
        assert.ok(g.creados <= 500, `la pasada ${i + 1} escribió ${g.creados} > 500`);
        if (i === 0) cubiertasTras1 = n(`select count(distinct ventana_tipo || ventana_id) from public.avisos where ${AV} and archivado_en is null`);
        if (!g.truncado) break;
        assert.ok(g.creados > 0, "una pasada con pendientes SIEMPRE avanza (no repite lo ya hecho)");
      }
      const esperadas = Math.ceil(pares / 500);
      assert.equal(resultados.length, esperadas, `pasadas necesarias para ${pares} pares`);
      assert.equal(resultados.reduce((s, g) => s + g.creados, 0), pares, "total creado = ventanas × destinatarios");
      assert.deepEqual(resultados.map((g) => g.pendientes), resultados.map((_, i) => Math.max(pares - 500 * (i + 1), 0)), "pendientes baja 500 por pasada hasta 0");
      assert.equal(resultados[resultados.length - 1].truncado, false);
      assert.ok(cubiertasTras1 < total, "la primera pasada no alcanza todas las ventanas…");
      assert.equal(n(`select count(*) from public.avisos where ${AV} and archivado_en is null`), pares);
      assert.equal(n(`select count(*) from (select distinct usuario_id, ventana_tipo, ventana_id, compra_fin from public.avisos where ${AV}) x`), pares, "sin duplicados");
      assert.equal(n(`select count(distinct ventana_tipo || ventana_id) from public.avisos where ${AV} and archivado_en is null`), total, "…y la cobertura final es completa (ninguna ventana queda sin avisar)");
      assert.equal(n(`select count(*) from (select usuario_id from public.avisos where ${AV} group by usuario_id having count(*) <> ${total}) x`), 0, "cada destinatario recibe exactamente una por ventana");
      assert.deepEqual(await pasada(), { hoy: HOY, dias: 5, ventanas: total, creados: 0, archivados: 0, pendientes: 0, truncado: false }, "repetir no cambia nada");
      assert.equal(n(`select count(*) from public.avisos where ${AV}`), pares);
    });
  }

  test("505 ventanas: lo OBSOLETO se archiva desde la primera llamada aunque sigan quedando pendientes (el archivo no depende de un primer lote), sin tocar lo vigente ni los leídos", async () => {
    limpiarMasivo(); masivas(499);                                       // 505 elegibles
    const g1 = await pasada(); assert.ok(g1.truncado && g1.pendientes > 0);
    // obsoletos: ventana inexistente y fecha distinta de la vigente (3 personas cada uno)
    sql(`insert into public.avisos (usuario_id, tipo, numero_contrato, ventana_tipo, ventana_id, ventana_ref, ventana_titulo, compra_fin)
         select u, 'compra_por_vencer', 'paquete:' || v, 'paquete', v, v, 'obsoleto', f from (values (99991::bigint, '${d(2)}'::date), (30001::bigint, '${d(3)}'::date)) x(v, f), unnest(array['${U.superadmin.id}', '${U.gerencia.id}', '${U.operaciones.id}']::uuid[]) u`);
    sql(`update public.avisos set leido_en = now() where ${AV} and usuario_id = '${U.gerencia.id}' and ventana_id = 30002 and archivado_en is null`);
    const vigentesAntes = n(`select count(*) from public.avisos where ${AV} and archivado_en is null and ventana_titulo <> 'obsoleto'`);
    const g2 = await pasada();
    assert.equal(g2.archivados, 6, "los 6 obsoletos se archivan YA, con el conjunto elegible aún incompleto");
    assert.equal(n(`select count(*) from public.avisos where ${AV} and archivado_en is null and ventana_titulo = 'obsoleto'`), 0);
    assert.equal(n(`select count(*) from public.avisos where ${AV} and archivado_en is null and ventana_titulo <> 'obsoleto'`), vigentesAntes + g2.creados, "lo vigente solo crece (nada vigente archivado)");
    assert.equal(n(`select count(*) from public.avisos where ${AV} and archivado_en is null and usuario_id = '${U.gerencia.id}' and ventana_id = 30002 and leido_en is not null`), 1, "un aviso leído y vigente se conserva");
    while ((await pasada()).truncado) { /* completa */ }
    assert.equal(n(`select count(*) from public.avisos where ${AV} and archivado_en is null`), 5 * 505);
  });

  test("más de 500 obsoletos: se archivan 500 por llamada, `pendientes` lo dice y al repetir terminan; ningún vigente se pierde", async () => {
    limpiarMasivo();                                                     // 6 ventanas de la semilla
    await pasada(); assert.equal(n(`select count(*) from public.avisos where ${AV} and archivado_en is null`), 30);
    sql(`insert into public.avisos (usuario_id, tipo, numero_contrato, ventana_tipo, ventana_id, ventana_ref, ventana_titulo, compra_fin)
         select '${U.gerencia.id}', 'compra_por_vencer', 'paquete:' || (80000 + g), 'paquete', 80000 + g, 80000 + g, 'obsoleto', '${d(2)}' from generate_series(1, 730) g`);
    const g1 = await pasada(); assert.deepEqual([g1.archivados, g1.pendientes, g1.truncado], [500, 230, true]);
    const g2 = await pasada(); assert.deepEqual([g2.archivados, g2.pendientes, g2.truncado], [230, 0, false]);
    assert.equal(n(`select count(*) from public.avisos where ${AV} and archivado_en is null`), 30);
  });

  test("el cron (generarAvisosCompraCon) repite la pasada solo mientras haya pendientes Y haya avance: con tope de pasadas deja `pendientes` y la siguiente ejecución completa; 505 ventanas = 6 pasadas", async () => {
    limpiarMasivo(); masivas(499);
    const llamar = async () => clienteDe("servicio").rpc("generar_avisos_compra", {} as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
    const parcial = await generarAvisosCompraCon(llamar, 2);
    assert.deepEqual(parcial.ok && [parcial.pasadas, parcial.creados, parcial.pendientes, parcial.truncado], [2, 1000, 1525, true]);
    const resto = await generarAvisosCompraCon(llamar);
    assert.deepEqual(resto.ok && [resto.pasadas, resto.creados, resto.pendientes, resto.truncado], [4, 1525, 0, false]);
    const nada = await generarAvisosCompraCon(llamar); assert.deepEqual(nada.ok && [nada.pasadas, nada.creados, nada.archivados], [1, 0, 0]);
    assert.equal(n(`select count(*) from public.avisos where ${AV} and archivado_en is null`), 2525);
  });
});

describe("#36 estado de publicación sobre datos reales (fuentes autoritativas)", () => {
  // Paquetes 11101–11109 (ver cada caso). Se arman con las MISMAS tablas que usa el tarifario público; no se simula ningún valor derivado.
  before(() => {
    sql(`
      delete from public.tarifario_resultado where paquete_id between 11101 and 11120;
      delete from public.armado_hoteles where paquete_id between 11101 and 11120;
      delete from public.armado_paquetes where id between 11101 and 11120;
      delete from public.hotel_tarifas_unidad where hotel_id between 11101 and 11120;
      delete from public.hoteles where id between 11101 and 11120;
      insert into public.hoteles (id, destino_id, nombre, modelo_tarifario, moneda, tarifa_bajo_solicitud, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max) values
        (11101, 11001, 'H persona',   'persona', 'COP', false, 0, 2, 2, 10),
        (11104, 11001, 'H unidad',    'unidad',  'COP', false, 0, 2, 2, 10),
        (11105, 11001, 'H solicitud', 'persona', 'COP', true,  0, 2, 2, 10);
      insert into public.hotel_tarifas_unidad (hotel_id, tarifa_id, version_tarifario, categoria, alimentacion, temporada, estado, payload)
        values (11104, 't111-unidad', 'v1', 'ESTANDAR', 'PC', 'BASE', 'publicada', '{"id":"t111-unidad","versionTarifario":"v1"}'::jsonb);
      insert into public.armado_paquetes (id, nombre, destino_id, activo, tipo, noches, fecha_compra_fin, fecha_viaje_inicio, fecha_viaje_fin) values
        (11101, 'S1 publicado',        11001, true,  'porcion_terrestre', 3, '${d(40)}', '${d(60)}', '${d(90)}'),
        (11102, 'S2 pendiente',        11001, true,  'porcion_terrestre', 3, '${d(40)}', '${d(60)}', '${d(90)}'),
        (11103, 'S3 error',            11001, true,  'porcion_terrestre', 3, '${d(40)}', '${d(60)}', '${d(90)}'),
        (11104, 'S4 unidad',           11001, true,  'porcion_terrestre', 3, '${d(40)}', '${d(60)}', '${d(90)}'),
        (11105, 'S5 solicitud',        11001, true,  'porcion_terrestre', 3, '${d(40)}', '${d(60)}', '${d(90)}'),
        (11106, 'S6 inactivo',         11001, false, 'porcion_terrestre', 3, '${d(40)}', '${d(60)}', '${d(90)}'),
        (11107, 'S7 bloqueado',        11001, true,  'porcion_terrestre', 3, '${d(40)}', '${d(60)}', '${d(90)}'),
        (11108, 'S8 persona + unidad', 11001, true,  'porcion_terrestre', 3, '${d(40)}', '${d(60)}', '${d(90)}'),
        (11109, 'S9 sin oferta',       11001, true,  'porcion_terrestre', 3, '${d(40)}', '${d(60)}', '${d(90)}');
      insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values
        (11101, 11101, array['ESTANDAR'], array['PC']), (11104, 11104, array['ESTANDAR'], array['PC']), (11105, 11105, '{}', '{}'),
        (11108, 11101, array['ESTANDAR'], array['PC']), (11108, 11104, array['ESTANDAR'], array['PC']);
      insert into public.tarifario_resultado (paquete_id, paquete_nombre, paquete_activo, modulo, hotel_id, hotel_nombre, destino_id, destino_nombre, categoria, regimen, acomodacion, precio_pvp, moneda)
        select p, 'x', (p <> 11106), 'porcion_terrestre', 11101, 'H persona', 11001, 'T111 DESTINO', c, 'PC', a::acomodacion_tipo, 100000, 'COP'
          from unnest(array[11101, 11106, 11107, 11108]) p, unnest(array['ESTANDAR', 'SUPERIOR']) c, unnest(array['sencilla', 'doble']) a;
      -- Estado AUTORITATIVO (columnas de la 181/256), fijado al final para que ningún disparador de armado lo recalcule.
      update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = (activo), tarifario_generacion_publicada = 1 where id in (11101, 11104, 11105, 11106, 11108, 11109);
      update public.armado_paquetes set tarifario_estado = 'pendiente', tarifario_generacion_publicada = null where id = 11102;
      update public.armado_paquetes set tarifario_estado = 'fallido', tarifario_error = 'No se generaron tarifas: falta temporada.' where id = 11103;
      update public.armado_paquetes set tarifario_estado = 'pendiente', tarifario_snapshot_publicable = false, tarifario_generacion_publicada = 1 where id = 11107;
    `);
  });

  async function etiquetas() {
    const sb = clienteDe("operaciones");
    const [resumen, unidad, solicitud] = [await cargarFilasResumenPaginado(sb as never), await cargarHotelesBernaloDescubiertos(), await cargarHotelesBajoSolicitud()];
    assert.ok(resumen.ok);
    if (!resumen.ok) throw new Error("carga del resumen");
    const conteo = new Map<number, number>(); for (const f of resumen.filas) conteo.set(f.paquete_id, (conteo.get(f.paquete_id) ?? 0) + 1);
    const cuenta = (hs: { paqueteId: number }[]) => hs.reduce((m, h) => m.set(h.paqueteId, (m.get(h.paqueteId) ?? 0) + 1), new Map<number, number>());
    const un = cuenta(unidad.ok ? unidad.hoteles : []), so = cuenta(solicitud.ok ? solicitud.hoteles : []);
    const { data } = await sb.from("armado_paquetes").select("id, activo, tarifario_estado, tarifario_error, tarifario_diagnostico, tarifario_snapshot_publicable, tarifario_generacion_publicada").gte("id", 11101).lte("id", 11109).order("id");
    return new Map((data ?? []).map((p) => {
      const n = conteo.get(p.id) ?? 0;
      return [p.id, { n, ...estadoPublicacionPaquete({ activo: p.activo, estado: p.tarifario_estado, error: p.tarifario_error, diagnostico: p.tarifario_diagnostico, generacionPublicada: p.tarifario_generacion_publicada, snapshotPublicable: p.tarifario_snapshot_publicable, combinaciones: n, hotelesUnidad: un.get(p.id) ?? 0, hotelesSolicitud: so.get(p.id) ?? 0, unidadVerificada: unidad.ok, solicitudVerificada: solicitud.ok }) }];
    }));
  }

  test("cada paquete recibe la etiqueta que corresponde a su estado REAL (y no «Sin publicar» por tener 0 filas por persona)", async () => {
    const e = await etiquetas();
    const x = (id: number) => e.get(id)!;
    assert.deepEqual([x(11101).clave, x(11101).n], ["publicado", 2], "S1: 2 categorías × 1 régimen = 2 combinaciones publicadas (la vista de resumen colapsa la acomodación: 4 filas de precio → 2 combinaciones)");
    assert.equal(x(11102).etiqueta, "Pendiente de generar");
    assert.equal(x(11103).etiqueta, "Error de generación"); assert.match(x(11103).detalle!, /falta temporada/);
    assert.equal(x(11104).etiqueta, "Cotización por unidad", "S4: hotel Bernalo con tarifa publicada, sin filas por persona");
    assert.equal(x(11105).etiqueta, "Bajo solicitud", "S5: hotel marcado bajo solicitud");
    assert.equal(x(11106).etiqueta, "Publicado, no visible", "S6: inactivo con generación exitosa: la vista publicable lo oculta (0 filas) pero NO está «sin publicar»");
    assert.equal(x(11107).etiqueta, "Desactualizado", "S7: fuentes cambiaron y el snapshot quedó bloqueado");
    assert.deepEqual([x(11108).etiqueta, x(11108).secundarias], ["Tarifas publicadas", ["Cotización por unidad"]]);
    assert.equal(x(11109).etiqueta, "Publicado sin oferta vendible");
  });
  test("la regla ANTERIOR del listado (conteo > 0 o «Sin publicar») rotulaba mal estos casos: control de que el cambio corrige algo real", async () => {
    const e = await etiquetas();
    const anterior = (id: number) => (e.get(id)!.n > 0 ? "publicado" : "Sin publicar");
    for (const id of [11102, 11103, 11104, 11105, 11106, 11107, 11109]) assert.equal(anterior(id), "Sin publicar", `paquete ${id}`);
    assert.notEqual(e.get(11104)!.etiqueta, "Sin publicar"); assert.notEqual(e.get(11106)!.etiqueta, "Sin publicar");
  });
  test("consumo del listado: los cargadores públicos usan un número fijo de consultas que no depende de cuántos paquetes hay", async () => {
    const antes = rpcSolicitudes; await etiquetas();
    const base = rpcSolicitudes - antes;
    // Medición (informativa, la afirmación es la igualdad de abajo): llamadas a la API de datos del cálculo de estado del listado, por separado.
    const sb = clienteDe("operaciones");
    const m = async (f: () => Promise<unknown>) => { const x = rpcSolicitudes; await f(); return rpcSolicitudes - x; };
    console.log(`MEDICION listado: resumen=${await m(() => cargarFilasResumenPaginado(sb as never))} unidad=${await m(() => cargarHotelesBernaloDescubiertos())} solicitud=${await m(() => cargarHotelesBajoSolicitud())} estado-paquetes=1 total-estado=${base}`);
    console.log(`MEDICION avisos de compra: ${await m(() => cargarAvisosCompra(clienteDe("servicio"), HOY, 5))} consultas (+1 lectura de dias_anticipacion en la página)`);
    sql(`insert into public.armado_paquetes (id, nombre, destino_id, activo, tipo, noches) select 11110 + g, 'extra ' || g, 11001, true, 'porcion_terrestre', 3 from generate_series(0, 8) g;`);
    const antes2 = rpcSolicitudes; await etiquetas();
    assert.equal(rpcSolicitudes - antes2, base, "agregar 9 paquetes no agrega consultas");
  });

  test("B3-1: si la lectura de la oferta por unidad FALLA, ningún paquete sin filas por persona afirma «sin oferta vendible» ni «Cotización por unidad»: dice «Oferta sin verificar»; la evidencia conocida se conserva", async () => {
    sql(`alter table public.hotel_tarifas_unidad rename to hotel_tarifas_unidad_x`); await recargarEsquema();
    try {
      const sb = clienteDe("operaciones");
      assert.equal((await cargarHotelesBernaloDescubiertos()).ok, false, "el descubrimiento por unidad falla de verdad");
      assert.equal((await cargarHotelesBajoSolicitud()).ok, true, "el de solicitud sigue bien");
      void sb;
      const e = await etiquetas();
      const x = (id: number) => e.get(id)!;
      assert.equal(x(11109).clave, "oferta_sin_verificar", "S9 (sin nada vendible conocido): NO «Publicado sin oferta vendible»");
      assert.match(x(11109).detalle!, /no se puede afirmar/);
      assert.equal(x(11104).clave, "oferta_sin_verificar", "S4 (su oferta ES por unidad, pero no se pudo leer): no se afirma «Cotización por unidad» ni «sin oferta»");
      assert.equal(x(11105).etiqueta, "Bajo solicitud"); assert.deepEqual(x(11105).secundarias, ["Unidad sin verificar"]);
      assert.deepEqual([x(11101).etiqueta, x(11101).secundarias], ["Tarifas publicadas", ["Unidad sin verificar"]]);
      assert.equal(x(11102).etiqueta, "Pendiente de generar"); assert.equal(x(11106).clave, "publicado_oculto", "un inactivo no puede tener oferta por unidad: su estado no cambia");
    } finally { sql(`alter table public.hotel_tarifas_unidad_x rename to hotel_tarifas_unidad`); await recargarEsquema(); }
    assert.equal((await etiquetas()).get(11104)!.etiqueta, "Cotización por unidad", "restablecida la lectura vuelve la evidencia");
  });
  test("B3-1: si fallan las dos lecturas, solo lo desconocido se marca; lo ya publicado por persona y los estados autoritativos no se tocan", async () => {
    sql(`alter table public.armado_empaquetados rename to armado_empaquetados_x`); await recargarEsquema();
    try {
      assert.equal((await cargarHotelesBernaloDescubiertos()).ok, false); assert.equal((await cargarHotelesBajoSolicitud()).ok, false);
      const e = await etiquetas(); const x = (id: number) => e.get(id)!;
      assert.equal(x(11109).clave, "oferta_sin_verificar"); assert.match(x(11109).detalle!, /ni la de bajo solicitud/);
      assert.equal(x(11103).clave, "error"); assert.equal(x(11107).clave, "desactualizado");
      assert.deepEqual(x(11108).secundarias, ["Unidad sin verificar", "Solicitud sin verificar"]);
    } finally { sql(`alter table public.armado_empaquetados_x rename to armado_empaquetados`); await recargarEsquema(); }
  });
});

// ══════════════════════ Revisión del dueño (migración 344) ══════════════════════════════════════════════════════════════════════════════════════════════════
describe("B3-02 «Revisado»: por persona, sin regenerarse, y una fecha cambiada crea una alerta NUEVA", () => {
  const n = (q: string) => Number(sql(q));
  const gen = async () => { const r = await clienteDe("servicio").rpc("generar_avisos_compra", {} as never); assert.equal(r.error, null, JSON.stringify(r.error)); return r.data as { creados: number; archivados: number; pendientes: number }; };
  const MIAS = (q: Quien) => `tipo = 'compra_por_vencer' and archivado_en is null and usuario_id = '${U[q].id}'`;
  before(() => { sql(`delete from public.avisos where tipo = 'compra_por_vencer'; update public.armado_paquetes set activo = true, fecha_compra_fin = '${d(2)}' where id = 11001; update public.config_notificaciones set dias_anticipacion = 5 where id = 1;`); });

  test("parte de 6 alertas por persona; «Revisado» saca SOLO esa, solo para esa persona (la fila de gerencia sigue activa) y no cuenta como «leído»", async () => {
    await gen();
    const antes = await cargarAlertasCompra(U.operaciones.id, U.operaciones.rol); assert.equal(antes.total, 6);
    const primera = antes.alertas.find((a) => a.href === "/dashboard/paquetes/11001?tab=config")!, segunda = antes.alertas.find((a) => a.id !== primera.id)!;   // se revisa el paquete 11001 (el que luego cambia de fecha)
    assert.deepEqual(await como("operaciones", () => revisarAlertaCompra(primera.id)), { ok: true });
    const despues = await cargarAlertasCompra(U.operaciones.id, U.operaciones.rol);
    assert.deepEqual([despues.total, despues.alertas.map((a) => a.id).includes(primera.id)], [5, false]);
    assert.equal((await cargarAlertasCompra(U.gerencia.id, U.gerencia.rol)).total, 6, "gerencia conserva las suyas: la revisión es por persona (decisión pendiente del dueño: ¿compartida?)");
    assert.equal(sql(`select revisado_en is not null and leido_en is null and archivado_en is null from public.avisos where id = ${primera.id}`), "t");
    assert.deepEqual(await como("operaciones", () => revisarAlertaCompra(primera.id)), { ok: false }, "revisar dos veces la misma no escribe nada");
    assert.equal(sql(`select revisado_en is null from public.avisos where id = ${segunda.id}`), "t");
  });
  test("la alerta ajena NO se puede revisar (ni por id adivinado), y una sesión sin sesión o con rol sin permiso tampoco", async () => {
    const deGerencia = Number(sql(`select min(id) from public.avisos where ${MIAS("gerencia")}`));
    assert.deepEqual(await como("operaciones", () => revisarAlertaCompra(deGerencia)), { ok: false });
    assert.deepEqual(await como(null, () => revisarAlertaCompra(deGerencia)), { ok: false });
    assert.deepEqual(await como("operaciones", () => revisarAlertaCompra(-1)), { ok: false });
    assert.equal(sql(`select revisado_en is null from public.avisos where id = ${deGerencia}`), "t");
    for (const q of ["operaciones", "venta", "agencia", "anon"] as const) {
      const r = await clienteDe(q).rpc("alertas_compra_revisar", { p_usuario: U.gerencia.id, p_id: deGerencia } as never);
      assert.ok(r.error, `${q}: la RPC es solo de la llave de servicio`);
    }
  });
  test("lo revisado NO se regenera: repetir el generador no crea ni resucita nada; la lista activa sigue en 5", async () => {
    const g = await gen(); assert.equal(g.creados, 0);
    assert.equal((await cargarAlertasCompra(U.operaciones.id, U.operaciones.rol)).total, 5);
    assert.equal(n(`select count(*) from public.avisos where ${MIAS("operaciones")}`), 6, "la fila revisada sigue viva: el índice único la protege de duplicarse");
  });
  test("cambia la fecha de fin: la alerta revisada se archiva y nace una NUEVA sin revisar (aparece otra vez, con la fecha nueva)", async () => {
    const idRevisada = Number(sql(`select id from public.avisos where ${MIAS("operaciones")} and revisado_en is not null`));
    const ref = sql(`select ventana_tipo || ':' || ventana_id from public.avisos where id = ${idRevisada}`);
    const [tipo, id] = ref.split(":");
    assert.equal(tipo, "paquete", "el fixture revisó el paquete 11001"); assert.equal(id, "11001");
    sql(`update public.armado_paquetes set fecha_compra_fin = '${d(3)}' where id = 11001`);
    assert.equal(sql(`select archivado_en is not null from public.avisos where id = ${idRevisada}`), "t", "archivada por el disparador al cambiar la fecha");
    assert.equal((await cargarAlertasCompra(U.operaciones.id, U.operaciones.rol)).total, 5, "mientras el generador no corra, la nueva aún no existe");
    await gen();
    const lista = await cargarAlertasCompra(U.operaciones.id, U.operaciones.rol);
    assert.equal(lista.total, 6, "la fecha nueva generó una alerta accionable");
    assert.ok(lista.alertas.some((a) => a.href === "/dashboard/paquetes/11001?tab=config" && /Vence en 3 días/.test(a.texto)));
    assert.equal(n(`select count(*) from public.avisos where ${MIAS("operaciones")} and ventana_tipo = 'paquete' and ventana_id = 11001 and revisado_en is null`), 1);
  });
  test("desactivar y reactivar la fuente también la deja SIN revisar (la revisión anterior se archivó con la desactivación)", async () => {
    const idPrev = Number(sql(`select id from public.avisos where ${MIAS("operaciones")} and ventana_tipo = 'paquete' and ventana_id = 11001`));
    await como("operaciones", () => revisarAlertaCompra(idPrev));
    sql(`update public.armado_paquetes set activo = false where id = 11001`);
    assert.equal(sql(`select archivado_en is not null from public.avisos where id = ${idPrev}`), "t");
    sql(`update public.armado_paquetes set activo = true where id = 11001`); await gen();
    assert.equal(n(`select count(*) from public.avisos where ${MIAS("operaciones")} and ventana_tipo = 'paquete' and ventana_id = 11001 and revisado_en is null`), 1);
  });
  test("lo revisado cuyo plazo ya venció lo retira el archivo diario como cualquier otra (no se acumula)", async () => {
    const idRev = Number(sql(`select id from public.avisos where ${MIAS("operaciones")} and ventana_tipo = 'paquete' and ventana_id = 11001`));
    await como("operaciones", () => revisarAlertaCompra(idRev));
    const g = await clienteDe("servicio").rpc("generar_avisos_compra", { p_hoy: d(30), p_dias: 5 } as never);
    assert.equal(g.error, null);
    assert.equal(sql(`select archivado_en is not null from public.avisos where id = ${idRev}`), "t");
    assert.equal((await cargarAlertasCompra(U.operaciones.id, U.operaciones.rol)).total, 0);
    await gen();   // vuelve al estado normal
  });
});

describe("B3-03 identidad guardada: vigencias de HOTEL y de SERVICIO apuntan a su hotel/servicio y a ESA vigencia (nunca por nombre; nunca a un paquete)", () => {
  const n = (q: string) => Number(sql(q));
  const gen = async () => { const r = await clienteDe("servicio").rpc("generar_avisos_compra", {} as never); assert.equal(r.error, null, JSON.stringify(r.error)); return r.data as { ventanas: number; creados: number; archivados: number }; };
  const alertasDe = async () => (await cargarAlertasCompra(U.operaciones.id, U.operaciones.rol, 50)).alertas;
  let temporadaA = 0, temporadaB = 0, vigServicio = 0;
  before(() => {
    sql(`delete from public.avisos where tipo = 'compra_por_vencer'; update public.armado_paquetes set activo = true, fecha_compra_fin = '${d(2)}' where id = 11001;
      delete from public.hoteles where id in (11501, 11502); delete from public.servicios_adicionales where id = 11601;
      insert into public.hoteles (id, nombre, destino_id, activo) values (11501, 'Hotel Repetido', 11001, true), (11502, 'Hotel Repetido', 11001, true);
      insert into public.servicios_adicionales (id, nombre, activo) values (11601, 'Tour Bahía', true);`);
    temporadaA = n(`insert into public.hotel_temporadas (hotel_id, nombre, compra_fin) values (11501, 'ALTA', '${d(1)}') returning id`);
    temporadaB = n(`insert into public.hotel_temporadas (hotel_id, nombre, compra_fin) values (11502, 'ALTA', '${d(1)}') returning id`);
    vigServicio = n(`insert into public.servicio_temporadas (servicio_id, nombre, compra_fin) values (11601, 'NAVIDAD', '${d(4)}') returning id`);
    sql(`insert into public.hotel_temporadas (hotel_id, nombre, compra_fin) values (11501, 'LEJANA', '${d(40)}'), (11501, 'VENCIDA', '${d(-2)}'), (11501, 'SIN FIN', null)`);
  });
  after(() => { sql(`delete from public.avisos where tipo = 'compra_por_vencer'; delete from public.servicios_adicionales where id = 11601; delete from public.hoteles where id in (11501, 11502);`); });

  test("el generador crea una alerta por vigencia elegible (hotel activo / servicio activo, fin dentro de la ventana); lejanas, vencidas y sin fecha no", async () => {
    const g = await gen(); assert.equal(g.ventanas, 6 + 3, "las 6 de paquetes/vuelos + 2 vigencias de hotel + 1 de servicio");
    const t = sql(`select string_agg(ventana_tipo || ':' || ventana_id || ':' || ventana_ref, ',' order by ventana_tipo, ventana_id) from (select distinct ventana_tipo, ventana_id, ventana_ref from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null and ventana_tipo in ('hotel_vigencia', 'servicio_vigencia')) x`);
    assert.equal(t, `hotel_vigencia:${temporadaA}:11501,hotel_vigencia:${temporadaB}:11502,servicio_vigencia:${vigServicio}:11601`);
  });
  test("dos hoteles con el MISMO nombre y la MISMA vigencia («Hotel Repetido · ALTA») abren cada uno SU hotel y SU vigencia", async () => {
    const hrefs = (await alertasDe()).map((a) => a.href);
    assert.ok(hrefs.includes(`/dashboard/producto/hoteles/11501?tab=temporadas&vigencia=${temporadaA}`));
    assert.ok(hrefs.includes(`/dashboard/producto/hoteles/11502?tab=temporadas&vigencia=${temporadaB}`));
    assert.notEqual(temporadaA, temporadaB);
    assert.ok(hrefs.includes(`/dashboard/producto/servicios?servicio=11601&vigencia=${vigServicio}`));
    const texto = (await alertasDe()).find((a) => a.href.includes(`vigencia=${temporadaA}`))!.texto;
    assert.match(texto, /vigencia de hotel: Hotel Repetido · ALTA · Vence mañana/);
  });
  test("ninguna alerta de hotel o servicio apunta a un paquete; el vuelo (empaquetado) abre el empaquetado y el paquete solo su propia fecha de compra", async () => {
    const lista = await alertasDe();
    for (const a of lista.filter((x) => /Repetido|Tour Bahía/.test(x.texto))) assert.doesNotMatch(a.href, /\/paquetes/, a.texto);
    assert.ok(lista.some((a) => a.href === "/dashboard/vuelos/empaquetados/11001"));
    assert.ok(lista.some((a) => a.href === "/dashboard/paquetes/11001?tab=config"));
  });
  test("cambiar la fecha de la vigencia, borrarla o desactivar el hotel/servicio archiva su alerta al instante; reactivar la repone en la siguiente corrida", async () => {
    const vivasDe = (tipo: string, id: number) => n(`select count(*) from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null and ventana_tipo = '${tipo}' and ventana_id = ${id}`);
    assert.equal(vivasDe("hotel_vigencia", temporadaA), 5);
    sql(`update public.hotel_temporadas set compra_fin = '${d(2)}' where id = ${temporadaA}`);
    assert.equal(vivasDe("hotel_vigencia", temporadaA), 0, "fecha cambiada: archivada por el disparador");
    await gen(); assert.equal(vivasDe("hotel_vigencia", temporadaA), 5, "la fecha nueva genera la alerta nueva");
    sql(`delete from public.hotel_temporadas where id = ${temporadaB}`);
    assert.equal(vivasDe("hotel_vigencia", temporadaB), 0, "vigencia borrada");
    sql(`update public.hoteles set activo = false where id = 11501`);
    assert.equal(vivasDe("hotel_vigencia", temporadaA), 0, "hotel desactivado");
    sql(`update public.servicios_adicionales set activo = false where id = 11601`);
    assert.equal(vivasDe("servicio_vigencia", vigServicio), 0, "servicio desactivado");
    sql(`update public.hoteles set activo = true where id = 11501; update public.servicios_adicionales set activo = true where id = 11601`); await gen();
    assert.equal(vivasDe("hotel_vigencia", temporadaA) + vivasDe("servicio_vigencia", vigServicio), 10);
  });
  test("las alertas nuevas respetan el mismo permiso: venta, aliados y operaciones de OTRA agencia no las reciben", async () => {
    assert.equal(n(`select count(*) from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null and ventana_tipo in ('hotel_vigencia','servicio_vigencia') and usuario_id in ('${U.venta.id}', '${U.agencia.id}', '${U.freelance.id}', '${U.operMin.id}')`), 0);
    assert.equal(n(`select count(*) from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null and ventana_tipo = 'servicio_vigencia' and usuario_id = '${U.superMin.id}'`), 1, "superadmin de cualquier agencia sí");
  });
});

describe("B3-01 presencia paginada con 1200 personas: página acotada, total real, búsqueda, permisos y tiempos", () => {
  type P = { usuario_id: string; nombre: string; rol: string; aliado: string | null; visto_en: string | null; total: number; eventos_ventana: number };
  const pedir = (q: Quien | "anon" | "servicio", a: Record<string, unknown>) => clienteDe(q).rpc("fn_actividad_pagina" as never, a as never);
  before(() => {
    sql(`
      delete from public.presencia_usuario; delete from public.usuarios where id::text like '00000000-0000-0000-0000-00000012%'; delete from auth.users where id::text like '00000000-0000-0000-0000-00000012%';
      insert into auth.users (id, email) select ('00000000-0000-0000-0000-00000012' || lpad(g::text, 4, '0'))::uuid, 'masivo' || g || '@x.test' from generate_series(1, 1200) g;
      insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id)
        select ('00000000-0000-0000-0000-00000012' || lpad(g::text, 4, '0'))::uuid, 'masivo' || g || '@x.test', 'Masivo ' || lpad(g::text, 4, '0'),
               (case when g <= 1000 then (array['venta','operaciones','gerencia','administracion','control_vuelo'])[1 + g % 5] else (array['agencia','freelance'])[1 + g % 2] end)::public.rol_usuario,
               g % 50 <> 0, 'mayorista', case when g > 1000 then ${U.agencia.aliado} else null end
          from generate_series(1, 1200) g
      on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, nombre = excluded.nombre, tenant = excluded.tenant, aliado_id = excluded.aliado_id;   -- un disparador de auth.users ya crea la fila de usuarios
      insert into public.presencia_usuario (usuario_id, visto_en) select id, now() - make_interval(mins => (right(id::text, 4))::int % 600)
        from public.usuarios where id::text like '00000000-0000-0000-0000-00000012%' and (right(id::text, 4))::int % 3 <> 0;
      insert into public.auditoria (creado_en, actor_id, actor_email, actor_rol, accion, tabla, registro_id)
        select now() - make_interval(mins => g), ('00000000-0000-0000-0000-00000012' || lpad(((g % 1200) + 1)::text, 4, '0'))::uuid, 'x', 'venta', 'UPDATE', 'ventas', g::text from generate_series(1, 6000) g;
      analyze public.usuarios; analyze public.presencia_usuario; analyze public.auditoria;`);
  });
  after(() => sql(`delete from public.auditoria where actor_email = 'x'; delete from public.presencia_usuario where usuario_id::text like '00000000-0000-0000-0000-00000012%'; delete from public.usuarios where id::text like '00000000-0000-0000-0000-00000012%'; delete from auth.users where id::text like '00000000-0000-0000-0000-00000012%';`));

  test("el resumen del recuadro compacto es UN agregado (una fila, cinco conteos) y cuadra con la base", async () => {
    const r = await clienteDe("superadmin").rpc("fn_actividad_resumen" as never);
    assert.equal(r.error, null, JSON.stringify(r.error));
    const filas = r.data as unknown as { personal_total: number; aliados_total: number; personal_recientes: number; aliados_recientes: number; sin_observacion: number }[];
    assert.equal(filas.length, 1, "una sola fila sin importar cuántas personas haya");
    const esperadoInternos = Number(sql(`select count(*) from public.usuarios where activo and rol in ('superadmin','gerencia','administracion','operaciones','venta','control_vuelo')`));
    const esperadoAliados = Number(sql(`select count(*) from public.usuarios where activo and rol in ('agencia','freelance')`));
    assert.deepEqual([filas[0].personal_total, filas[0].aliados_total], [esperadoInternos, esperadoAliados]);
    assert.equal(filas[0].sin_observacion, Number(sql(`select count(*) from public.usuarios u where u.activo and u.rol in ('superadmin','gerencia','administracion','operaciones','venta','control_vuelo','agencia','freelance') and not exists (select 1 from public.presencia_usuario p where p.usuario_id = u.id)`)));
    assert.equal(filas[0].personal_recientes + filas[0].aliados_recientes, Number(sql(`select count(*) from public.presencia_usuario where visto_en > now() - interval '11 minutes' and usuario_id in (select id from public.usuarios where activo)`)));
    assert.ok(filas[0].personal_total > 900 && filas[0].aliados_total > 190);
  });
  test("cada página trae como mucho lo pedido (tope 50 aunque se pida 5000), con el total REAL del grupo y orden por presencia reciente", async () => {
    const p0 = await pedir("superadmin", { p_grupo: "interno", p_limite: 20, p_offset: 0 }); assert.equal(p0.error, null, JSON.stringify(p0.error));
    const f0 = p0.data as unknown as P[];
    assert.equal(f0.length, 20); assert.ok(f0.every((f) => f.total === f0[0].total && f0[0].total > 900));
    const vistos = f0.map((f) => (f.visto_en ? new Date(f.visto_en).getTime() : -Infinity));
    assert.deepEqual(vistos, [...vistos].sort((a, b) => b - a), "más reciente primero");
    const grande = (await pedir("superadmin", { p_grupo: "interno", p_limite: 5000, p_offset: 0 })).data as unknown as P[]; assert.equal(grande.length, 50, "tope duro de 50");
    const p1 = (await pedir("superadmin", { p_grupo: "interno", p_limite: 20, p_offset: 20 })).data as unknown as P[];
    assert.equal(new Set([...f0, ...p1].map((f) => f.usuario_id)).size, 40, "las páginas no se solapan");
    const ultima = (await pedir("superadmin", { p_grupo: "interno", p_limite: 20, p_offset: Math.floor((f0[0].total - 1) / 20) * 20 })).data as unknown as P[];
    assert.equal(ultima.length, f0[0].total % 20 || 20, "la última página trae el resto");
    assert.deepEqual((await pedir("superadmin", { p_grupo: "interno", p_limite: 20, p_offset: 100000 })).data, [], "una página fuera de rango está vacía (el cliente vuelve a la primera)");
  });
  test("grupos separados: «aliado» solo agencias y freelancers (con el nombre del aliado); «interno» ninguno de ellos", async () => {
    const a = (await pedir("superadmin", { p_grupo: "aliado", p_limite: 50 })).data as unknown as P[];
    assert.ok(a.length === 50 && a.every((f) => f.rol === "agencia" || f.rol === "freelance"));
    assert.ok(a.some((f) => f.aliado === "T111 Aliado Agencia"));
    const i = (await pedir("superadmin", { p_grupo: "interno", p_limite: 50 })).data as unknown as P[];
    assert.ok(i.every((f) => f.rol !== "agencia" && f.rol !== "freelance"));
  });
  test("búsqueda por nombre/correo/aliado; los comodines % y _ se toman literalmente; el inactivo no aparece", async () => {
    const uno = (await pedir("superadmin", { p_grupo: "interno", p_busqueda: "Masivo 0123" })).data as unknown as P[];
    assert.deepEqual(uno.map((f) => f.nombre), ["Masivo 0123"]); assert.equal(uno[0].total, 1);
    assert.equal(((await pedir("superadmin", { p_grupo: "interno", p_busqueda: "masivo0200@x.test" })).data as unknown as P[]).length, 0, "g=200 es inactivo (g % 50 = 0)");
    assert.equal(((await pedir("superadmin", { p_grupo: "interno", p_busqueda: "%" })).data as unknown as P[]).length, 0, "«%» no es comodín");
    assert.equal(((await pedir("superadmin", { p_grupo: "interno", p_busqueda: "Masivo _123" })).data as unknown as P[]).length, 0, "«_» no es comodín");
    assert.ok(((await pedir("superadmin", { p_grupo: "aliado", p_busqueda: "Aliado Agencia", p_limite: 50 })).data as unknown as P[]).length > 0, "por nombre del aliado");
  });
  test("solo superadmin (42501, nunca lista vacía) y grupo inválido rechazado (22023); no expone contenido de los cambios", async () => {
    for (const q of ["gerencia", "inactivo", "venta", "operaciones", "agencia", "servicio", "anon"] as const) {
      for (const [fn, args] of [["fn_actividad_pagina", { p_grupo: "interno" }], ["fn_actividad_resumen", {}]] as const) {
        const r = await clienteDe(q).rpc(fn as never, args as never); assert.ok(r.error, `${q}/${fn}`); assert.equal(r.data, null);
        if (q !== "anon") assert.equal(r.error!.code, "42501", `${q}/${fn}: ${JSON.stringify(r.error)}`);
      }
    }
    const mal = await pedir("superadmin", { p_grupo: "todos" }); assert.equal(mal.error?.code, "22023");
    const fila = ((await pedir("superadmin", { p_grupo: "interno", p_limite: 1 })).data as unknown as Record<string, unknown>[])[0];
    assert.deepEqual(Object.keys(fila).sort(), ["aliado", "email", "eventos_24h", "eventos_ventana", "nombre", "rol", "tenant", "total", "ultima_actividad", "ultimo_ingreso", "usuario_id", "visto_en"]);
  });
  test("tiempos LOCALES con 1200 personas y 6000 cambios auditados (medición, no promesa de producción): resumen, página de 20 y búsqueda por debajo de 1,5 s cada uno", async () => {
    const medir = async (f: () => PromiseLike<unknown>) => { const t = performance.now(); await f(); return performance.now() - t; };
    const tiempos = { resumen: await medir(() => clienteDe("superadmin").rpc("fn_actividad_resumen" as never)), pagina: await medir(() => pedir("superadmin", { p_grupo: "interno", p_limite: 20, p_offset: 0 })), busqueda: await medir(() => pedir("superadmin", { p_grupo: "aliado", p_busqueda: "Masivo 11", p_limite: 20 })) };
    console.log(`  medición local B3-01 (ms, con PostgREST): ${JSON.stringify(Object.fromEntries(Object.entries(tiempos).map(([k, v]) => [k, Math.round(v)])))}`);
    for (const [k, v] of Object.entries(tiempos)) assert.ok(v < 1500, `${k}: ${v} ms`);
  });
});
