// #30 (entrega B) · migración 206 — trayecto REAL de la app contra PostgreSQL:
//   formulario (NuevoContratoForm) → Server Action crearContrato → cliente
//   Supabase de sesión (@supabase/ssr, cookies) → PostgREST → RPC
//   aplicar_neto_contrato_manual / revertir_contrato_incompleto / triggers.
//
// SOLO base LOCAL desechable. No corre en `npm run test:*`: la lanza
// supabase/scripts/test_206_app_rpc.sh, que crea la base (001–205 + 206),
// levanta un PostgREST propio y la borra al final. Nada aquí habla con
// Supabase remoto: la URL de Supabase apunta a un proxy local de esta misma
// prueba que reenvía /rest/v1 al PostgREST del contenedor y responde
// /auth/v1/user verificando el JWT firmado aquí (sustituto mínimo de GoTrue).
//
// Lo único simulado: next/headers (el tarro de cookies de la "petición"),
// next/cache, next/navigation y server-only (arnés de fecha de negocio). La
// sesión, la RLS, los RPC y los triggers son los reales.
import { montar, escribir, clic, enviar, dom, botonConTexto } from "./support/fechaNegocioArnes.ts";
import * as nodeModule from "node:module";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const CT = process.env.PG206_CONTENEDOR ?? "pg30_neto";
const DB = process.env.PG206_BASE ?? "";
const PGRST = process.env.PG206_POSTGREST ?? "";
const SECRETO = process.env.PG206_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) {
  throw new Error("Faltan PG206_BASE (desechable), PG206_POSTGREST y PG206_JWT_SECRET: usa supabase/scripts/test_206_app_rpc.sh.");
}

// ── Fronteras de Next que no existen fuera del servidor ───────────────────
type Jar = Map<string, string>;
const estado = globalThis as unknown as { __pg307: { jar: Jar; rutas: string[] } };
estado.__pg307 = { jar: new Map(), rutas: [] };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const RAIZ = new URL("../", import.meta.url);
const real = (rel: string) => new URL(rel, RAIZ).href;
const HEADERS = [
  "export async function cookies() {",
  "  const j = globalThis.__pg307.jar;",
  "  return {",
  "    get(n) { const v = j.get(n); return v == null ? undefined : { name: n, value: v }; },",
  "    getAll() { return [...j].map(([name, value]) => ({ name, value })); },",
  "    has(n) { return j.has(n); },",
  "    set(n, v) { if (typeof n === 'object') { if (n.value) j.set(n.name, n.value); else j.delete(n.name); } else if (v) j.set(n, v); else j.delete(n); },",
  "    delete(n) { j.delete(typeof n === 'object' ? n.name : n); },",
  "  };",
  "}",
  "export async function headers() { return new Headers(); }",
].join("\n");
// router.push queda registrado: es la señal de que crearContrato terminó OK
// en el formulario (la fila de ventas existe antes de que corra el RPC).
const NAVEGACION = [
  "const r = { push(u) { globalThis.__pg307.rutas.push(u); }, replace() {}, refresh() {}, back() {}, prefetch() {} };",
  "export function useRouter() { return r; }",
  "export function usePathname() { return '/dashboard/contratos/nuevo'; }",
  "export function useSearchParams() { return new URLSearchParams(); }",
  "export function notFound() { throw new Error('notFound'); }",
  "export function redirect(u) { throw new Error('redirect ' + u); }",
].join("\n");
// Se registra DESPUÉS del arnés: los hooks corren del último al primero, así
// que estos mapeos ganan sobre los suyos (BD en memoria) y sobre los stubs de
// reactLoader.mjs.
const REALES: Record<string, string> = {
  "@/lib/supabase/server": real("lib/supabase/server.ts"),
  "@/lib/supabase/admin": real("lib/supabase/admin.ts"),
  "@/lib/contrato/contexto": real("lib/contrato/contexto.ts"),
  "@/lib/contrato/numeracion": real("lib/contrato/numeracion.ts"),
  "@/lib/tenant.server": real("lib/tenant.server.ts"),
};
type ResolveHook = (s: string, c: { parentURL?: string }, n: (s: string, c: unknown) => unknown) => unknown;
(nodeModule as unknown as { registerHooks: (h: { resolve: ResolveHook }) => void }).registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: datos(HEADERS), shortCircuit: true };
    if (specifier === "next/navigation") return { url: datos(NAVEGACION), shortCircuit: true };
    if (REALES[specifier]) return { url: REALES[specifier], shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// ── JWT (HS256) con el secreto del PostgREST local ────────────────────────
const b64u = (s: string) => Buffer.from(s).toString("base64url");
function firmar(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
function verificar(tok: string): Record<string, unknown> | null {
  const [h, p, s] = tok.split(".");
  if (!h || !p || !s) return null;
  if (createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url") !== s) return null;
  const c = JSON.parse(Buffer.from(p, "base64url").toString()) as Record<string, unknown>;
  return Number(c.exp) * 1000 > Date.now() ? c : null;
}
const ahora = () => Math.floor(Date.now() / 1000);

// ── Proxy local: /rest/v1 → PostgREST; /auth/v1/user → JWT verificado ────
const proxy = createServer((req: IncomingMessage, res: ServerResponse) => {
  (globalThis as unknown as { __reqs?: number }).__reqs = ((globalThis as unknown as { __reqs?: number }).__reqs ?? 0) + 1;
  const url = req.url ?? "";
  if (url.startsWith("/auth/v1/user")) {
    const c = verificar((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (!c || c.role !== "authenticated") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: 401, error_code: "bad_jwt", msg: "invalid JWT" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: c.sub, aud: "authenticated", role: "authenticated", email: c.email,
      app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z",
    }));
    return;
  }
  if (url.startsWith("/rest/v1/")) {
    const destino = new URL(url.slice("/rest/v1".length), PGRST);
    const headers = { ...req.headers };
    delete headers.host;
    // Sin reutilizar sockets hacia PostgREST: una conexión por petición.
    const up = httpRequest(destino, { method: req.method, headers, agent: false }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
    return;
  }
  res.writeHead(404);
  res.end();
});
// Keep-alive del proxy más largo que el del cliente fetch (undici, ~4 s): con
// los 5 s por defecto de Node, el cliente reusaba a veces un socket que el
// servidor acababa de cerrar ("fetch failed").
proxy.keepAliveTimeout = 65_000;
proxy.headersTimeout = 66_000;
await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", () => r()));
const URL_SB = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_SB;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = firmar({ role: "anon", iss: "supabase", iat: ahora(), exp: ahora() + 86_400 });
process.env.SUPABASE_SERVICE_ROLE_KEY = firmar({ role: "service_role", iss: "supabase", iat: ahora(), exp: ahora() + 86_400 });
after(() => { proxy.closeAllConnections(); proxy.close(); dom.window.close(); });

// ── SQL directo (superusuario del contenedor) para sembrar y comprobar ────
function sql(q: string): string {
  return execFileSync("docker", [
    "exec", "-i", "-e", "PGPASSWORD=postgres", CT,
    "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-F", "|", "-v", "ON_ERROR_STOP=1",
  ], { input: q, encoding: "utf8" }).trim();
}
const uid = (n: number) => `00000000-0000-0000-0000-0000002060${String(n).padStart(2, "0")}`;
const U = {
  super: { id: uid(1), email: "t206-super@x.test", nombre: "T206 Super" },
  admin: { id: uid(2), email: "t206-admin@x.test", nombre: "T206 Admin" },
  venta: { id: uid(3), email: "t206-venta@x.test", nombre: "T206 Venta" },
  colega: { id: uid(4), email: "t206-colega@x.test", nombre: "T206 Colega" },
  ops: { id: uid(5), email: "t206-ops@x.test", nombre: "T206 Ops" },
  gerencia: { id: uid(6), email: "t206-gerencia@x.test", nombre: "T206 Gerencia" },
  agencia: { id: uid(7), email: "t206-portal@x.test", nombre: "T206 Portal" },
  control: { id: uid(8), email: "t206-control@x.test", nombre: "T206 Control" },
  inactivo: { id: uid(9), email: "t206-inactivo@x.test", nombre: "T206 Inactivo" },
  adminMin: { id: uid(10), email: "t206-admmin@x.test", nombre: "T206 AdmMin" },
  ventaMin: { id: uid(11), email: "t206-ventamin@x.test", nombre: "T206 VentaMin" },
  agencia2: { id: uid(12), email: "t206-portal2@x.test", nombre: "T206 Portal Dos" },
  freelance: { id: uid(13), email: "t206-freelance@x.test", nombre: "T206 Portal Freelance" },
} as const;
type Quien = keyof typeof U;

sql(`
insert into auth.users (id, email) values
${Object.values(U).map((u) => `('${u.id}', '${u.email}')`).join(",\n")}
on conflict (id) do nothing;
insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion) values
  (9601, 'T206 Agencia', '9606', 'agencia', 0.10, false, 0),
  (9602, 'T206 Freelance', '9607', 'freelance', null, true, 0.11),
  (9603, 'T206 Agencia Dos', '9608', 'agencia', 0.10, false, 0)
on conflict (id) do update set pct_comision = excluded.pct_comision, tipo = excluded.tipo;
insert into public.escalas_comision (id, nombre) values (9206, 'T206 Escala') on conflict (id) do nothing;
insert into public.escala_rangos (escala_id, pvp_desde, pvp_hasta, pct, orden) values (9206, 0, null, 5, 1);
insert into public.usuarios (id, email, nombre, rol, activo, tenant, escala_id, aliado_id) values
  ('${U.super.id}',    '${U.super.email}',    '${U.super.nombre}',    'superadmin',     true,  'mayorista', null, null),
  ('${U.admin.id}',    '${U.admin.email}',    '${U.admin.nombre}',    'administracion', true,  'mayorista', null, null),
  ('${U.venta.id}',    '${U.venta.email}',    '${U.venta.nombre}',    'venta',          true,  'mayorista', 9206, null),
  ('${U.colega.id}',   '${U.colega.email}',   '${U.colega.nombre}',   'venta',          true,  'mayorista', 9206, null),
  ('${U.ops.id}',      '${U.ops.email}',      '${U.ops.nombre}',      'operaciones',    true,  'mayorista', null, null),
  ('${U.gerencia.id}', '${U.gerencia.email}', '${U.gerencia.nombre}', 'gerencia',       true,  'mayorista', null, null),
  ('${U.agencia.id}',  '${U.agencia.email}',  '${U.agencia.nombre}',  'agencia',        true,  'mayorista', null, 9601),
  ('${U.control.id}',  '${U.control.email}',  '${U.control.nombre}',  'control_vuelo',  true,  'mayorista', null, null),
  ('${U.inactivo.id}', '${U.inactivo.email}', '${U.inactivo.nombre}', 'administracion', false, 'mayorista', null, null),
  ('${U.adminMin.id}', '${U.adminMin.email}', '${U.adminMin.nombre}', 'administracion', true,  'minorista', null, null),
  ('${U.ventaMin.id}', '${U.ventaMin.email}', '${U.ventaMin.nombre}', 'venta',          true,  'minorista', null, null),
  ('${U.agencia2.id}', '${U.agencia2.email}', '${U.agencia2.nombre}', 'agencia',        true,  'mayorista', null, 9603),
  ('${U.freelance.id}','${U.freelance.email}','${U.freelance.nombre}','freelance',      true,  'mayorista', null, 9602)
on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant,
  escala_id = excluded.escala_id, aliado_id = excluded.aliado_id, nombre = excluded.nombre;
`);

// ── Sesión real: @supabase/ssr escribe sus cookies en el tarro ────────────
async function entrarComo(quien: Quien | null, agencia?: "mayorista" | "minorista"): Promise<void> {
  const jar: Jar = new Map();
  // Cookie de agencia activa (lib/tenant.ts): solo superadmin puede alternar.
  if (agencia) jar.set("tenant", agencia);
  estado.__pg307.jar = jar;
  if (!quien) return;
  const u = U[quien];
  const { createServerClient } = await import("@supabase/ssr");
  const sb = createServerClient(URL_SB, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cs: { name: string; value: string }[]) => cs.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))),
    },
  });
  const tok = firmar({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", iat: ahora(), exp: ahora() + 3_600, session_id: randomUUID() });
  const { error } = await sb.auth.setSession({ access_token: tok, refresh_token: `r-${u.id}` });
  if (error) throw new Error(`no se pudo abrir la sesión de ${quien}: ${error.message}`);
  assert.ok(jar.size > 0, "la sesión quedó en cookies");
}
/** Cliente de sesión para leer/escribir por PostgREST como lo haría el navegador (API directa). */
async function clienteDe(quien: Quien) {
  await entrarComo(quien);
  const { createClient } = await import("../lib/supabase/server.ts");
  return createClient();
}


// ════════ #53 (307) · ACCESO A VOUCHERS: sesiones reales + RLS real + base real (acciones reales de generación) ════════
const { accesoVoucherPorToken } = await import("../lib/voucher/accesoVoucher.server.ts");
const { generarVoucherHotel } = await import("../app/(dashboard)/dashboard/contratos/[numero]/voucher-actions.ts");
const reqs = () => (globalThis as unknown as { __reqs?: number }).__reqs ?? 0;
const reset = () => { (globalThis as unknown as { __reqs?: number }).__reqs = 0; };
const N = "DTM-7001";
const asesor = U.venta.nombre;
sql(`
insert into public.ventas (numero_contrato, tenant, cliente, estado, asesor, precio_venta, moneda, tipo_paquete, financiero_estado, aliado_id, tipo_asesor, agencia_nombre, fecha_salida, fecha_regreso)
values ('${N}', 'mayorista', 'Cliente 7001', 'confirmado', '${asesor}', 1000000, 'COP', 'porcion', 'completo', 9601, 'agencia', 'T206 Agencia', '2027-01-10', '2027-01-13');
insert into public.contrato_hoteles (numero_contrato, nombre, ciudad, alimentacion, acomodacion, fecha_ingreso, fecha_salida, orden, categoria, proveedor)
values ('${N}', 'Hotel 7001', 'CARTAGENA', 'PC', 'Doble', '2027-01-10', '2027-01-13', 0, 'Estándar', 'Prov 7001');
insert into public.abonos (numero_contrato, tenant, cliente, fecha_abono, valor_abono, forma_pago, trm, monto_cop) values ('${N}', 'mayorista', 'c', current_date - 1, 600000, 'transferencia', 1, 600000);
`);
let TOKEN = "";
const abonado = (v: number) => sql(`update public.abonos set valor_abono = ${v}, monto_cop = ${v} where numero_contrato = '${N}'`);
const abrir = async (quien: Quien | null) => { await entrarComo(quien); reset(); const r = await accesoVoucherPorToken(TOKEN); return { r, n: reqs() }; };
const motivo = (x: { r: { ok: boolean; motivo?: string } }) => (x.r.ok ? "ok" : x.r.motivo);
const conteoVouchers = () => sql(`select count(*) from public.vouchers where numero_contrato = '${N}'`);

test("V0 la preparación interna NO exige pago: administración y superadmin generan el voucher de hotel con saldo pendiente (acción real)", async () => {
  await entrarComo("admin");
  const g = await generarVoucherHotel(N, {} as never);
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.equal(conteoVouchers(), "1", "administración generó el voucher con saldo 400.000 pendiente");
  await entrarComo("super");
  const g2 = await generarVoucherHotel(N, {} as never);
  assert.equal(g2.ok, true, JSON.stringify(g2));
  TOKEN = sql(`select share_token from public.vouchers where numero_contrato = '${N}' order by id desc limit 1`);
  assert.ok(TOKEN.length > 10);
});

test("V1 aliado dueño con saldo pendiente: NO abre, aunque el voucher lo haya generado un superadmin (sin excepción anticipada)", async () => {
  const x = await abrir("agencia");
  assert.equal(motivo(x), "pago_incompleto");
  console.log(`SOLICITUDES aliado dueño, saldo pendiente: ${x.n}`);
});

test("V2 no autorizados: sin sesión, otro aliado, freelance ajeno, desactivado, rol no previsto, asesor ajeno (aunque esté PAGADO del todo)", async () => {
  abonado(1000000);
  assert.equal(motivo(await abrir(null)), "sin_sesion");
  assert.equal(motivo(await abrir("agencia2")), "sin_permiso", "otro aliado (9603)");
  assert.equal(motivo(await abrir("freelance")), "sin_permiso", "freelance de otro aliado");
  assert.equal(motivo(await abrir("inactivo")), "sin_permiso", "usuario desactivado");
  assert.equal(motivo(await abrir("control")), "sin_permiso", "control_vuelo no es interno de vouchers ni aliado");
  assert.equal(motivo(await abrir("colega")), "sin_permiso", "asesor `venta` que NO es el del contrato (RLS)");
  abonado(600000);
});

test("V3 personal interno: vista previa con saldo pendiente (la RLS decide)", async () => {
  for (const q of ["super", "admin", "ops", "gerencia", "venta"] as const) {
    const x = await abrir(q);
    assert.equal(motivo(x), "ok", `${q}: ${JSON.stringify(x.r)}`);
    if (q === "super") console.log(`SOLICITUDES interno (superadmin): ${x.n}`);
  }
  assert.equal(motivo(await abrir("adminMin")), "sin_permiso", "administración de OTRA agencia no ve el voucher");
});

test("V4 pagado completo: el aliado dueño abre (y el voucher no cambió)", async () => {
  abonado(1000000);
  const x = await abrir("agencia");
  assert.equal(motivo(x), "ok", JSON.stringify(x.r));
  console.log(`SOLICITUDES aliado dueño, pagado completo: ${x.n}`);
  assert.equal(conteoVouchers(), "1");
});

test("V5 redondeo de la base: saldo 0,40 COP abre; saldo 1 COP no", async () => {
  abonado(999999.6);
  assert.equal(motivo(await abrir("agencia")), "ok");
  abonado(999999);
  assert.equal(motivo(await abrir("agencia")), "pago_incompleto");
});

test("V6 reversión: anular el abono (función real de la base) bloquea de nuevo y NO borra el voucher", async () => {
  abonado(1000000);
  assert.equal(motivo(await abrir("agencia")), "ok");
  const id = sql(`select id from public.abonos where numero_contrato = '${N}' order by id limit 1`);
  sql(`set role service_role; select public.anular_abono(${id}, '${N}', 'mayorista', '${U.super.id}'::uuid, 'prueba 307');`);
  assert.equal(sql(`select count(*) from public.abonos where numero_contrato = '${N}'`), "0");
  assert.equal(motivo(await abrir("agencia")), "pago_incompleto");
  assert.equal(conteoVouchers(), "1", "el voucher sigue ahí");
  assert.equal(motivo(await abrir("super")), "ok", "y la vista previa interna sigue disponible");
});

test("V7 aumento posterior del precio: con el contrato pagado, subir el precio vuelve a bloquear al aliado", async () => {
  sql(`insert into public.abonos (numero_contrato, tenant, cliente, fecha_abono, valor_abono, forma_pago, trm, monto_cop) values ('${N}', 'mayorista', 'c', current_date, 1000000, 'transferencia', 1, 1000000)`);
  assert.equal(motivo(await abrir("agencia")), "ok");
  sql(`update public.ventas set precio_venta = 1100000 where numero_contrato = '${N}'`);
  assert.equal(motivo(await abrir("agencia")), "pago_incompleto");
  sql(`update public.ventas set precio_venta = 1000000 where numero_contrato = '${N}'`);
  assert.equal(motivo(await abrir("agencia")), "ok");
});

test("V8 falla cerrado: si la lectura del pago falla (RPC sin permiso), NADIE de afuera abre aunque esté pagado; el interno sigue viendo la vista previa", async () => {
  sql(`revoke execute on function public.contratos_pagados_completos(text[]) from service_role`);
  try {
    assert.equal(motivo(await abrir("agencia")), "pago_incompleto", "error de lectura = no pagado");
    assert.equal(motivo(await abrir("super")), "ok");
  } finally {
    sql(`grant execute on function public.contratos_pagados_completos(text[]) to service_role`);
  }
  assert.equal(motivo(await abrir("agencia")), "ok");
});

test("V9 contrato cancelado: el aliado no abre ni pagado completo; el histórico (voucher, abonos) queda intacto", async () => {
  sql(`update public.ventas set estado = 'cancelado' where numero_contrato = '${N}'`);
  assert.equal(motivo(await abrir("agencia")), "pago_incompleto");
  assert.equal(conteoVouchers(), "1");
  sql(`update public.ventas set estado = 'confirmado' where numero_contrato = '${N}'`);
});
