// #65 · Portal B2B — recorrido de integración REAL por HTTP contra PostgreSQL + PostgREST locales y desechables.
// Corren los cargadores y las PÁGINAS reales (app/portal/b2b/*, lib/portal/*, lib/auth/*, lib/cuenta/estado.ts) con sesiones
// `authenticated` (JWT HS256 del PostgREST local) de usuarios reales de la base: RLS, RPC `comparativas_b2b_visibles` y RPC de creación
// de comparativas son las de las migraciones 001-254. Lo ÚNICO simulado: `auth.getUser()` (la sesión).
// SOLO base LOCAL desechable: la lanza supabase/scripts/test_65_portal_b2b.sh (crea la base desde la plantilla, un PostgREST propio con
// max-rows=1000 como Supabase y lo borra todo al final). Nada aquí habla con Supabase remoto.
import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";

const CT = process.env.PG65_CONTENEDOR ?? "pg65portal";
const DB = process.env.PG65_BASE ?? "";
const PGRST = process.env.PG65_POSTGREST ?? "";
const SECRETO = process.env.PG65_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) {
  throw new Error("Faltan PG65_BASE (desechable), PG65_POSTGREST y PG65_JWT_SECRET: usa supabase/scripts/test_65_portal_b2b.sh.");
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

// ── Usuarios (reales en auth.users / usuarios) ──────────────────────────────
const U = {
  A: "00000000-0000-0000-0000-000000650001",   // agencia Alfa, mayorista, ficha 6501
  B: "00000000-0000-0000-0000-000000650002",   // freelance Beta, mayorista, ficha 6502
  C: "00000000-0000-0000-0000-000000650003",   // freelance Gamma, MINORISTA, ficha 6503
  INACTIVO: "00000000-0000-0000-0000-000000650004", // agencia con la ficha de A pero desactivada
  VENTA: "00000000-0000-0000-0000-000000650005",    // personal interno
  CLIENTE: "00000000-0000-0000-0000-000000650006",  // rol cliente_final: no es aliado B2B
  P: "00000000-0000-0000-0000-000000650007",   // agencia Pi, volumen (paginación)
} as const;
const PERFIL: Record<string, { rol: string; tenant: string; activo: boolean; email: string; nombre: string; aliado: number | null }> = {
  [U.A]: { rol: "agencia", tenant: "mayorista", activo: true, email: "ua65@x.test", nombre: "Agencia Alfa 65", aliado: 6501 },
  [U.B]: { rol: "freelance", tenant: "mayorista", activo: true, email: "ub65@x.test", nombre: "Freelance Beta 65", aliado: 6502 },
  [U.C]: { rol: "freelance", tenant: "minorista", activo: true, email: "uc65@x.test", nombre: "Freelance Gamma 65", aliado: 6503 },
  [U.INACTIVO]: { rol: "agencia", tenant: "mayorista", activo: false, email: "ui65@x.test", nombre: "Agencia Alfa Inactiva 65", aliado: 6501 },
  [U.VENTA]: { rol: "venta", tenant: "mayorista", activo: true, email: "uv65@x.test", nombre: "Asesor Interno 65", aliado: null },
  [U.CLIENTE]: { rol: "cliente_final", tenant: "mayorista", activo: true, email: "ux65@x.test", nombre: "Cliente Final 65", aliado: null },
  [U.P]: { rol: "agencia", tenant: "mayorista", activo: true, email: "up65@x.test", nombre: "Agencia Pi 65", aliado: 6504 },
};
const TOKEN_SERVICIO = jwt({ role: "service_role" });
let uidSesion: string = U.A;
/** Rutas (regex sobre la URL) cuya petición HTTP se hace fallar con 500: para probar los avisos ante una lectura fallida. */
let fallos: RegExp[] = [];

process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;

// supabase-js antepone /rest/v1 a las rutas de PostgREST; el PostgREST local las sirve en la raíz.
const fetchLocal: typeof fetch = async (input, init) => {
  const url = String(input).replace("/rest/v1/", "/");
  if (fallos.some((f) => f.test(url))) return new Response(JSON.stringify({ message: "fallo inyectado" }), { status: 500, headers: { "content-type": "application/json" } });
  return fetch(url, init);
};
function clienteLocal(token: string, usuario?: { id: string; email: string }) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteSesion = (uid = uidSesion) => clienteLocal(jwt({ role: "authenticated", sub: uid }), { id: uid, email: PERFIL[uid].email });

// ── SQL directo (superusuario del contenedor) para sembrar y comprobar ──────
function psql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
}
const sql = psql;
const lit = (v: unknown) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });

const srv = await import("../lib/portal/b2bPortalServidor.ts");
const { cargarEstadoCuenta, cargarRecibo } = await import("../lib/cuenta/estado.ts");
const { formatMoneda } = await import("../lib/utils.ts");
const { default: PaginaInicio } = await import("../app/portal/b2b/page.tsx");
const { default: PaginaCotizaciones } = await import("../app/portal/b2b/cotizaciones/page.tsx");
const { default: PaginaVentas } = await import("../app/portal/b2b/ventas/page.tsx");
const { default: PaginaCartera } = await import("../app/portal/b2b/cartera/page.tsx");
const { default: PaginaDocumentos } = await import("../app/portal/b2b/documentos/page.tsx");

type Ok = Extract<Awaited<ReturnType<typeof srv.resolverContextoPortal>>, { estado: "ok" }>;
async function ctxDe(uid: string): Promise<Ok> {
  uidSesion = uid;
  const c = await srv.resolverContextoPortal();
  assert.equal(c.estado, "ok", `${uid} debería ser un aliado activo`);
  return c as Ok;
}
const plano = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
async function pagina(Pag: (a: never) => Promise<unknown>, uid: string, vista?: string) {
  uidSesion = uid;
  const el = await (Pag as (a: unknown) => Promise<unknown>)({ searchParams: Promise.resolve(vista ? { vista } : {}) });
  const html = renderToStaticMarkup(el as never);
  return { html, texto: plano(html) };
}
const cop = (n: number) => formatMoneda(n, "COP").replace(/\s+/g, " ");
const codigos = (filas: { codigo: string | null }[]) => filas.map((f) => f.codigo).sort();
const nums = (c: { ventas: { numero_contrato: string; relacion: string }[] }, relacion: string) =>
  c.ventas.filter((v) => v.relacion === relacion).map((v) => v.numero_contrato).sort();

// ── Datos ──────────────────────────────────────────────────────────────────
const hoy = new Date();
const dia = (n: number) => new Date(hoy.getTime() + n * 86_400_000).toISOString().slice(0, 10);
let ABONO: Record<string, number> = {};
let TOKENS: Record<string, string> = {};

before(() => {
  sql(`
    insert into auth.users (id, email) values ${Object.entries(PERFIL).map(([id, p]) => `('${id}', '${p.email}')`).join(", ")} on conflict do nothing;
    insert into public.aliados (id, nombre, tipo, nit, activo) values
      (6501, 'Agencia Alfa 65', 'agencia', '900650001', true), (6502, 'Freelance Beta 65', 'freelance', '1065000002', true),
      (6503, 'Freelance Gamma 65', 'freelance', '1065000003', true), (6504, 'Agencia Pi 65', 'agencia', '900650004', true) on conflict (id) do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
      ${Object.entries(PERFIL).map(([id, p]) => `('${id}', '${p.email}', ${lit(p.nombre)}, '${p.rol}', ${p.activo}, '${p.tenant}', ${p.aliado ?? "null"})`).join(", ")}
      on conflict (id) do update set nombre = excluded.nombre, email = excluded.email, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id;
    insert into public.parametros_tributarios (parametro, valor, base_calculo, descripcion) values
      ('COMISION_AGENCIA', 0.12, 'base_comisionable', 'Comisión agencia'), ('COMISION_FREELANCE', 0.11, 'base_comisionable', 'Comisión freelance')
      on conflict (parametro) do update set valor = excluded.valor;

    insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, b2b_usuario_id, aliado_id, agencia_nombre, freelance_nombre, tipo_asesor, modo_compra) values
      ('DTM-6501',      'Cliente A directo',       'mayorista', 'CARTAGENA', '${dia(20)}', 'confirmado', 1000000, 'COP', '${U.A}', 6501, 'Agencia Alfa 65', null, 'agencia', 'comisionable'),
      ('DTM-6502',      'Cliente A asistido',      'mayorista', 'SANTA MARTA', '${dia(40)}', 'confirmado', 800000, 'COP', null, 6501, 'Agencia Alfa 65', null, 'agencia', 'comisionable'),
      ('MIN-65-A-MIN',  'Cliente A minorista',     'minorista', 'SAN ANDRES', '${dia(60)}', 'activo', 500000, 'COP', null, 6501, 'Agencia Alfa 65', null, 'agencia', null),
      ('DTM-6504',    'Cliente de B compartido', 'mayorista', 'CARTAGENA', '${dia(15)}', 'confirmado', 2000000, 'COP', null, 6502, null, 'Freelance Beta 65', 'freelance', 'comisionable'),
      ('MIN-65-A-HIST', 'Cliente histórico minorista', 'minorista', 'MEDELLIN', '${dia(80)}', 'activo', 900000, 'COP', null, null, null, 'Agencia Alfa 65', 'agencia', null),
      ('DTM-6506',      'Cliente B directo',       'mayorista', 'CARTAGENA', '${dia(25)}', 'confirmado', 700000, 'COP', '${U.B}', 6502, null, 'Freelance Beta 65', 'freelance', 'comisionable'),
      ('MIN-65-B-ASI',  'Cliente B minorista',     'minorista', 'CALI', '${dia(70)}', 'activo', 600000, 'COP', null, 6502, null, 'Freelance Beta 65', 'freelance', null),
      ('MIN-65-C',      'Cliente C minorista',     'minorista', 'BOGOTA', '${dia(30)}', 'activo', 300000, 'COP', '${U.C}', 6503, null, 'Freelance Gamma 65', 'freelance', null),
      ('DTM-6509',      'Cliente homónimo',        'mayorista', 'CARTAGENA', '${dia(10)}', 'confirmado', 400000, 'COP', null, null, 'Agencia Alfa 65', null, 'agencia', 'comisionable');

    insert into public.aliados_b2b (numero_contrato, aliado, aliado_id, tipo_aliado, precio_venta, base_comision, pct_comision, estado, tenant) values
      ('DTM-6504',    'Freelance Beta 65', 6502, 'freelance', 2000000, 1800000, 0.11, 'pendiente', 'mayorista'),
      ('DTM-6504',    'Agencia Alfa 65',   6501, 'agencia',   2000000, 1800000, 0.05, 'pendiente', 'mayorista'),
      ('MIN-65-A-HIST', 'Agencia Alfa 65',   6501, 'agencia',    900000,  900000, 0.10, 'pendiente', 'minorista');

    insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) values
      ('DTM-6501', 400000, 'Transferencia', 'mayorista'), ('DTM-6502', 800000, 'Transferencia', 'mayorista'),
      ('DTM-6504', 300000, 'Efectivo', 'mayorista'), ('DTM-6506', 100000, 'Transferencia', 'mayorista'),
      ('DTM-6509', 50000, 'Efectivo', 'mayorista');

    insert into public.vouchers (numero_contrato, tipo, contenido) values
      ('DTM-6501', 'hotel', '{"x":1}'), ('DTM-6504', 'hotel', '{"x":2}'), ('DTM-6506', 'hotel', '{"x":3}');

    insert into public.cotizaciones (tenant, tipo, estado, codigo, cliente, destino, precio_venta, moneda, fecha_salida, vigencia_hasta, creado_por, payload) values
      ('mayorista', 'carrito', 'abierta', 'Q65-A-DIR-M',  'Cli A dir M',  'CARTAGENA', 1000, 'COP', '${dia(30)}', '${dia(10)}', 'ua65@x.test', '{}'),
      ('minorista', 'carrito', 'abierta', 'Q65-A-DIR-N',  'Cli A dir N',  'CALI',      1000, 'COP', '${dia(30)}', '${dia(10)}', 'ua65@x.test', '{}'),
      ('mayorista', 'carrito', 'abierta', 'Q65-A-ASI-M',  'Alfa',         'CARTAGENA', 1000, 'COP', '${dia(30)}', '${dia(10)}', 'uv65@x.test', '{"b2bAsistido":{"aliado_id":6501,"modo_compra":"neta","total_exigible":900}}'),
      ('minorista', 'carrito', 'abierta', 'Q65-A-ASI-N',  'Alfa',         'CALI',      1000, 'COP', '${dia(30)}', '${dia(10)}', 'uv65@x.test', '{"b2bAsistido":{"aliado_id":6501,"modo_compra":"comisionable","total_exigible":1000}}'),
      ('mayorista', 'carrito', 'abierta', 'Q65-A-PROPIO-ASI', 'Alfa',     'CARTAGENA', 1000, 'COP', '${dia(30)}', '${dia(10)}', 'ua65@x.test', '{"b2bAsistido":{"aliado_id":6501,"modo_compra":"neta","total_exigible":900}}'),
      ('mayorista', 'carrito', 'abierta', 'Q65-B-DIR-M',  'Cli B dir M',  'CARTAGENA', 1000, 'COP', '${dia(30)}', '${dia(10)}', 'ub65@x.test', '{}'),
      ('minorista', 'carrito', 'abierta', 'Q65-B-ASI-N',  'Beta',         'CALI',      1000, 'COP', '${dia(30)}', '${dia(10)}', 'uv65@x.test', '{"b2bAsistido":{"aliado_id":6502,"modo_compra":"neta","total_exigible":900}}'),
      ('minorista', 'carrito', 'abierta', 'Q65-C-DIR-N',  'Cli C dir N',  'BOGOTA',    1000, 'COP', '${dia(30)}', '${dia(10)}', 'uc65@x.test', '{}');
  `);

  // Comparativas con la RPC REAL de creación (service_role): propias, asignadas por personal interno, y de otro aliado.
  const rpc = async (usuario: string, aliado: number, tipoAsesor: string, cliente: string) => {
    const { data, error } = await clienteLocal(TOKEN_SERVICIO).rpc("crear_cotizacion_comparativa", {
      p_usuario_id: usuario,
      p_cabecera: { tipo: "comparativa_carrito", moneda: "COP", vigencia_hasta: dia(30), cliente, destino: "CARTAGENA", plan_nombre: "Cotización comparativa", pax: 2,
        asesor: null, creado_por: PERFIL[usuario].email, fecha_salida: dia(40), fecha_regreso: dia(44), payload: { comparativa: true, tipoAsesor }, detalle: { comparativa: true } },
      p_servicios: [],
      p_opciones: [
        { opcion_ref: "A", acomodacion_ref: "doble", orden: 0, etiqueta: "Hotel A", moneda: "COP", tarifa_persona: 500000, total: 1000000, resumen_publico: { hotel: "Hotel A" }, plantilla_hija: {} },
        { opcion_ref: "B", acomodacion_ref: "doble", orden: 1, etiqueta: "Hotel B", moneda: "COP", tarifa_persona: 600000, total: 1200000, resumen_publico: { hotel: "Hotel B" }, plantilla_hija: {} },
      ],
      p_aliado_id: aliado,
    });
    assert.equal(error, null, `crear_cotizacion_comparativa(${cliente}): ${error?.message}`);
    return data as number;
  };
  return Promise.all([
    rpc(U.A, 6501, "agencia", "CMP A propia"), rpc(U.VENTA, 6501, "agencia", "CMP A asignada"),
    rpc(U.B, 6502, "freelance", "CMP B propia"), rpc(U.VENTA, 6502, "freelance", "CMP B asignada"),
  ]).then(() => {
    ABONO = Object.fromEntries(sql("select numero_contrato||'='||min(id) from public.abonos group by numero_contrato").split("\n").map((l) => l.split("=")).map(([n, id]) => [n, Number(id)]));
    TOKENS = Object.fromEntries(sql(`select numero_contrato||'='||share_token from public.ventas union all select 'V:'||numero_contrato||'='||share_token from public.vouchers`).split("\n").map((l) => l.split("=")));
  });
});

beforeEach(() => { uidSesion = U.A; fallos = []; });

describe("P65-1 · sesión y rol: solo un aliado B2B activo entra", () => {
  test("aliado activo → ok; desactivado, cliente_final e interno → rechazados; sin sesión → visitante", async () => {
    uidSesion = U.A; assert.equal((await srv.resolverContextoPortal()).estado, "ok");
    uidSesion = U.INACTIVO; assert.equal((await srv.resolverContextoPortal()).estado, "pendiente");
    uidSesion = U.CLIENTE; assert.equal((await srv.resolverContextoPortal()).estado, "interno");
    uidSesion = U.VENTA; assert.equal((await srv.resolverContextoPortal()).estado, "interno");
  });
  test("las páginas no muestran datos al desactivado ni al cliente_final: solo el aviso/ingreso", async () => {
    for (const Pag of [PaginaInicio, PaginaCotizaciones, PaginaVentas, PaginaCartera, PaginaDocumentos]) {
      const inactivo = await pagina(Pag as never, U.INACTIVO);
      assert.match(inactivo.texto, /Registro en revisión/);
      assert.doesNotMatch(inactivo.texto, /DTM-6501|Cliente A|Q65-|CMP A/);
      const cliente = await pagina(Pag as never, U.CLIENTE);
      assert.match(cliente.texto, /Portal de aliados/);
      assert.doesNotMatch(cliente.texto, /DTM-6501|Q65-|CMP /);
    }
  });
  test("RLS real: un token B2B (ni activo ni inactivo) no lee ventas ni cotizaciones por la API; el desactivado tampoco la RPC", async () => {
    for (const uid of [U.A, U.INACTIVO]) {
      const sb = clienteSesion(uid);
      assert.deepEqual((await sb.from("ventas").select("numero_contrato")).data, [], `ventas ${uid}`);
      assert.deepEqual((await sb.from("cotizaciones").select("id")).data, [], `cotizaciones ${uid}`);
      assert.deepEqual((await sb.from("abonos").select("id")).data, [], `abonos ${uid}`);
    }
    assert.deepEqual((await clienteSesion(U.INACTIVO).rpc("comparativas_b2b_visibles")).data, []);
  });
});

describe("P65-2 · cotizaciones directas y asistidas (ambos tenants, una sola vez, sin cruces)", () => {
  test("A: directas M+N, asistidas M+N + la asistida con su propio correo SOLO en asistidas", async () => {
    const r = await srv.cargarCotizacionesPortal(await ctxDe(U.A));
    assert.deepEqual(codigos(r.directas), ["Q65-A-DIR-M", "Q65-A-DIR-N"]);
    assert.deepEqual(codigos(r.asistidas), ["Q65-A-ASI-M", "Q65-A-ASI-N", "Q65-A-PROPIO-ASI"]);
    assert.equal(r.error, false);
  });
  test("B: lo suyo en ambos tenants; nada de A", async () => {
    const r = await srv.cargarCotizacionesPortal(await ctxDe(U.B));
    assert.deepEqual(codigos(r.directas), ["Q65-B-DIR-M"]);
    assert.deepEqual(codigos(r.asistidas), ["Q65-B-ASI-N"]);
  });
  test("C (Minorista): solo lo suyo", async () => {
    const r = await srv.cargarCotizacionesPortal(await ctxDe(U.C));
    assert.deepEqual(codigos(r.directas), ["Q65-C-DIR-N"]);
    assert.deepEqual(r.asistidas, []);
  });
  test("la página de cada pestaña muestra su conjunto y nada del otro aliado", async () => {
    const dir = (await pagina(PaginaCotizaciones, U.A, "directas")).texto;
    const asi = (await pagina(PaginaCotizaciones, U.A, "asistidas")).texto;
    assert.match(dir, /Q65-A-DIR-M/); assert.match(dir, /Q65-A-DIR-N/); assert.doesNotMatch(dir, /Q65-A-ASI|Q65-A-PROPIO-ASI|Q65-B|Q65-C/);
    for (const c of ["Q65-A-ASI-M", "Q65-A-ASI-N", "Q65-A-PROPIO-ASI"]) assert.match(asi, new RegExp(c));
    assert.doesNotMatch(asi, /Q65-A-DIR|Q65-B|Q65-C/);
    assert.match(asi, /Neto/);
  });
});

describe("P65-3 · comparativas con la RPC real", () => {
  test("propias → Directas; asignadas a la ficha → Asistidas; ninguna del otro aliado ni de otro tenant", async () => {
    const a = await srv.cargarComparativasPortal(await ctxDe(U.A));
    assert.deepEqual(a.directas.map((c) => c.codigo).length, 1);
    assert.deepEqual(a.asistidas.length, 1);
    assert.equal(a.error, false);
    const b = await srv.cargarComparativasPortal(await ctxDe(U.B));
    assert.equal(b.directas.length, 1); assert.equal(b.asistidas.length, 1);
    const ids = new Set([...a.directas, ...a.asistidas, ...b.directas, ...b.asistidas].map((c) => c.id));
    assert.equal(ids.size, 4, "cuatro comparativas distintas: ninguna compartida entre A y B");
    const c = await srv.cargarComparativasPortal(await ctxDe(U.C));
    assert.deepEqual({ d: c.directas.length, a: c.asistidas.length, e: c.error }, { d: 0, a: 0, e: false }, "C (Minorista) no ve comparativas de Mayorista");
  });
  test("las páginas colocan cada comparativa en su pestaña y traen sus opciones", async () => {
    const dir = (await pagina(PaginaCotizaciones, U.A, "directas")).texto;
    const asi = (await pagina(PaginaCotizaciones, U.A, "asistidas")).texto;
    assert.match(dir, /Comparativas/); assert.match(dir, new RegExp(cop(1000000).replace(/\$/g, "\\$"))); assert.match(dir, /Hotel A/);
    assert.match(asi, /Comparativas/);
    const dirIds = (await srv.cargarComparativasPortal(await ctxDe(U.A))).directas.map((c) => c.codigo);
    for (const cod of dirIds) { assert.match(dir, new RegExp(cod)); assert.doesNotMatch(asi, new RegExp(cod)); }
  });
});

describe("P65-4 · contratos propios, participación y documentos", () => {
  test("A: propios de AMBOS tenants (directa + asistidas); participación por comisión aparte; el homónimo y lo de B no entran", async () => {
    const c = await srv.cargarConjuntoPortal(await ctxDe(U.A), { abonos: true, vouchers: true });
    assert.deepEqual(nums(c, "propio"), ["DTM-6501", "DTM-6502", "MIN-65-A-MIN"]);
    assert.deepEqual(nums(c, "participacion"), ["DTM-6504", "MIN-65-A-HIST"]);
    assert.ok(!c.ventas.some((v) => ["DTM-6509", "DTM-6506", "MIN-65-B-ASI", "MIN-65-C"].includes(v.numero_contrato)));
    assert.equal(c.historicoIncompleto, false); assert.equal(c.participacionCompleta, true);
    // Los abonos y vouchers que se leen son SOLO de contratos propios.
    assert.ok(c.abonos.every((a) => ["DTM-6501", "DTM-6502"].includes(a.numero_contrato)));
    assert.deepEqual(c.vouchers.map((v) => v.numero_contrato), ["DTM-6501"]);
  });
  test("B es dueño de lo compartido; A solo participa. C ve solo lo suyo", async () => {
    const b = await srv.cargarConjuntoPortal(await ctxDe(U.B), { abonos: true });
    assert.deepEqual(nums(b, "propio"), ["DTM-6504", "DTM-6506", "MIN-65-B-ASI"]);
    assert.deepEqual(nums(b, "participacion"), []);
    const c = await srv.cargarConjuntoPortal(await ctxDe(U.C));
    assert.deepEqual(nums(c, "propio"), ["MIN-65-C"]);
    assert.deepEqual(nums(c, "participacion"), []);
  });
  test("Mis ventas: Directas / Asistidas; la participación no muestra al cliente ajeno", async () => {
    const dir = (await pagina(PaginaVentas, U.A, "directas")).texto;
    const asi = (await pagina(PaginaVentas, U.A, "asistidas")).texto;
    assert.match(dir, /DTM-6501/); assert.doesNotMatch(dir, /DTM-6502|65-A-MIN/);
    for (const n of ["DTM-6502", "65-A-MIN", "DTM-6504", "65-A-HIST"]) assert.match(asi, new RegExp(n));
    assert.match(asi, /Participación por comisión/);
    assert.doesNotMatch(asi + dir, /Cliente de B compartido|Cliente histórico|Cliente B|Cliente homónimo/);
    assert.match(asi, /Minorista/); assert.match(asi, /Mayorista/);
    // La participación muestra SOLO la comisión propia (5 % de 1.800.000 = 90.000), jamás la del dueño (11 % = 198.000).
    assert.ok(asi.includes(cop(90000)), "su comisión de participación");
    assert.ok(!asi.includes(cop(198000)), "no ve la comisión del otro aliado");
    const deB = (await pagina(PaginaVentas, U.B, "asistidas")).texto; // para B, lo compartido es asistida (lo armó personal interno)
    assert.ok(deB.includes(cop(198000)) && !deB.includes(cop(90000)), "el dueño ve la suya y no la de A");
  });
  test("Cartera: Con saldo y Pagos de los propios (ambos tenants), sin los pagos de contratos ajenos", async () => {
    const saldo = (await pagina(PaginaCartera, U.A, "saldo")).texto;
    assert.match(saldo, /DTM-6501/); assert.match(saldo, new RegExp(cop(600000).replace(/\$/g, "\\$")));
    assert.match(saldo, /65-A-MIN/, "el contrato de Minorista sin pagos tiene saldo");
    assert.doesNotMatch(saldo, /DTM-6502/, "pagado por completo: no está en Con saldo");
    assert.doesNotMatch(saldo, /DTM-6504|Cliente de B/);
    const pagos = (await pagina(PaginaCartera, U.A, "pagos")).texto;
    assert.match(pagos, /DTM-6501/); assert.match(pagos, /DTM-6502/); assert.match(pagos, /Recibo/);
    assert.doesNotMatch(pagos, /DTM-6504|DTM-6506|DTM-6509|Efectivo/);
  });
  test("Documentos: una fila por contrato propio de ambos tenants; el voucher solo donde existe; nada de participación ni de otro aliado", async () => {
    const d = await pagina(PaginaDocumentos, U.A);
    for (const n of ["DTM-6501", "DTM-6502", "65-A-MIN"]) assert.match(d.texto, new RegExp(n));
    assert.doesNotMatch(d.texto, /DTM-6504|65-A-HIST|DTM-6506|DTM-6509/);
    assert.ok(d.html.includes(`/voucher/${TOKENS["V:DTM-6501"]}`), "voucher propio enlazado");
    assert.ok(d.html.includes(`/c/${TOKENS["DTM-6501"]}`), "contrato propio enlazado");
    assert.ok(d.html.includes(`/recibo/${ABONO["DTM-6501"]}`) && d.html.includes(`/estado-cuenta/DTM-6501`));
    for (const ajeno of [TOKENS["V:DTM-6504"], TOKENS["V:DTM-6506"], TOKENS["DTM-6504"], TOKENS["DTM-6506"], String(ABONO["DTM-6504"]) === "undefined" ? "x" : `/recibo/${ABONO["DTM-6504"]}"`]) {
      assert.ok(!d.html.includes(ajeno), `no filtra ${ajeno}`);
    }
    assert.match(d.texto, /No disponible/, "sin voucher / sin recibos: no hay enlace ficticio");
  });
  test("Documentos por URL (cargadores reales): el dueño abre; el otro aliado, el participante, el homónimo y el desactivado, no", async () => {
    uidSesion = U.A;
    assert.ok(await cargarEstadoCuenta("DTM-6501"));
    assert.ok(await cargarEstadoCuenta("MIN-65-A-MIN"), "contrato de Minorista propio por ficha");
    assert.equal(await cargarEstadoCuenta("DTM-6504"), null, "participar por comisión no abre el estado de cuenta");
    assert.equal(await cargarEstadoCuenta("MIN-65-A-HIST"), null);
    assert.equal(await cargarEstadoCuenta("DTM-6506"), null);
    assert.equal(await cargarEstadoCuenta("DTM-6509"), null, "el homónimo por nombre no entra");
    assert.ok(await cargarRecibo(ABONO["DTM-6501"]));
    assert.equal(await cargarRecibo(ABONO["DTM-6504"]), null);
    assert.equal(await cargarRecibo(ABONO["DTM-6506"]), null);
    uidSesion = U.B;
    assert.ok(await cargarEstadoCuenta("DTM-6504"), "B es el dueño");
    assert.equal(await cargarEstadoCuenta("DTM-6501"), null);
    uidSesion = U.INACTIVO;
    assert.equal(await cargarEstadoCuenta("DTM-6501"), null, "desactivado: ni siquiera con la ficha de A");
  });
  test("Inicio: los indicadores salen del mismo conjunto (saldo 600.000 + 500.000 = 1.100.000 de contratos propios)", async () => {
    const t = (await pagina(PaginaInicio, U.A)).texto;
    assert.match(t, /Explora el tarifario/); assert.match(t, /Demostración/);
    assert.match(t, new RegExp(cop(1100000).replace(/\$/g, "\\$")));
    assert.doesNotMatch(t, /Cliente de B|DTM-6504/);
  });
});

describe("P65-5 · paginación real (PostgREST con max-rows=1000) y lecturas fallidas", () => {
  before(() => {
    sql(`
      insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, b2b_usuario_id, aliado_id, tipo_asesor)
        select case when i % 2 = 0 then 'MIN-65-P-' || lpad(i::text, 5, '0') else 'DTM-' || (650000 + i)::text end, 'Cliente P ' || i, case when i % 2 = 0 then 'minorista' else 'mayorista' end, 'CARTAGENA', '${dia(30)}', 'confirmado', 1000, 'COP', '${U.P}', 6504, 'agencia'
        from generate_series(1, 1150) i;
      insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant)
        select case when i % 2 = 0 then 'MIN-65-P-' || lpad(i::text, 5, '0') else 'DTM-' || (650000 + i)::text end, 100, 'Transferencia', case when i % 2 = 0 then 'minorista' else 'mayorista' end from generate_series(1, 1150) i;
      insert into public.cotizaciones (tenant, tipo, estado, codigo, cliente, destino, precio_venta, moneda, fecha_salida, vigencia_hasta, creado_por, payload)
        select 'mayorista', 'carrito', 'abierta', 'QP-' || i, 'Cli P', 'CARTAGENA', 1000, 'COP', '${dia(30)}', '${dia(10)}', 'up65@x.test', '{}' from generate_series(1, 1150) i;
      insert into public.cotizaciones (tenant, tipo, modo, estado, codigo, cliente, destino, precio_venta, moneda, fecha_salida, vigencia_hasta, creado_por, propietario_id, aliado_id, payload)
        select 'mayorista', 'comparativa_carrito', 'comparativa', 'abierta', 'CP-' || i, 'Cmp P', 'CARTAGENA', null, 'COP', '${dia(40)}', '${dia(30)}', 'up65@x.test', '${U.P}', null, '{}' from generate_series(1, 1050) i;
    `);
  });

  test("el tope es real: una lectura simple de ventas devuelve 1.000 filas de 1.150", async () => {
    const r = await clienteLocal(TOKEN_SERVICIO).from("ventas").select("numero_contrato").eq("b2b_usuario_id", U.P);
    assert.equal(r.data?.length, 1000);
  });
  test("contratos propios (1.150), abonos (1.150) y vouchers: se leen TODOS, de ambos tenants, sin aviso", async () => {
    const c = await srv.cargarConjuntoPortal(await ctxDe(U.P), { abonos: true, vouchers: true });
    assert.equal(c.ventas.filter((v) => v.relacion === "propio").length, 1150);
    assert.equal(c.abonos.length, 1150);
    assert.equal(new Set(c.ventas.map((v) => v.tenant)).size, 2);
    assert.equal(c.historicoIncompleto, false); assert.equal(c.abonosCompletos, true);
  });
  test("cotizaciones directas (1.150) y comparativas por la RPC real (1.050): todas, clasificadas por propietario_id, sin error", async () => {
    const ctx = await ctxDe(U.P);
    const q = await srv.cargarCotizacionesPortal(ctx);
    assert.equal(q.directas.length, 1150); assert.equal(q.error, false);
    const k = await srv.cargarComparativasPortal(ctx);
    assert.equal(k.directas.length, 1050); assert.equal(k.asistidas.length, 0); assert.equal(k.error, false);
  });
  test("la página de Mis ventas con 1.150 contratos no se presenta como truncada", async () => {
    const t = (await pagina(PaginaVentas, U.P, "directas")).texto;
    assert.match(t, /65-P-01150/); assert.match(t, /DTM-650001/);
    assert.doesNotMatch(t, /No pudimos leer todo tu historial/);
  });

  test("lectura de VENTAS fallida → aviso explícito en Mis ventas, Cartera, Documentos e Inicio", async () => {
    fallos = [/\/ventas\?/];
    for (const Pag of [PaginaVentas, PaginaCartera, PaginaDocumentos, PaginaInicio]) {
      const t = (await pagina(Pag as never, U.A)).texto;
      assert.match(t, /No pudimos leer todo tu historial de contratos/, String(Pag.name));
    }
  });
  test("lectura de ABONOS fallida → Cartera avisa y no presenta saldos como completos", async () => {
    fallos = [/\/abonos\?/];
    const t = (await pagina(PaginaCartera, U.A, "saldo")).texto;
    assert.match(t, /No pudimos leer todos tus pagos/);
  });
  test("lectura de COTIZACIONES fallida → aviso; la de la RPC fallida → aviso de comparativas, no «no tienes»", async () => {
    fallos = [/\/cotizaciones\?/];
    let t = (await pagina(PaginaCotizaciones, U.A, "directas")).texto;
    assert.match(t, /No pudimos cargar todas tus cotizaciones/);
    fallos = [/\/rpc\/comparativas_b2b_visibles/];
    t = (await pagina(PaginaCotizaciones, U.A, "directas")).texto;
    assert.match(t, /No pudimos cargar tus comparativas/);
    assert.doesNotMatch(t, /Aún no tienes comparativas/);
    const inicio = (await pagina(PaginaInicio, U.A)).texto;
    assert.match(inicio, /No pudimos cargar todas tus cotizaciones o comparativas/);
  });
  test("lectura de PARTICIPACIÓN fallida (aliados_b2b) → la participación no se muestra y se avisa; los contratos propios siguen", async () => {
    fallos = [/\/aliados_b2b\?/];
    const t = (await pagina(PaginaVentas, U.A, "asistidas")).texto;
    assert.match(t, /No pudimos verificar parte de tu histórico/);
    assert.match(t, /DTM-6502/); assert.doesNotMatch(t, /DTM-6504/);
  });
});
