// Rev2 B1-06 — el aliado y el personal interno ven la MISMA nota del voucher aéreo, con sesiones reales + RLS real + acciones reales + base real (clon desechable de rev_consolidada_base).
// Trayecto: generarVoucherVuelo (acción real, RPC guardar_vouchers_vuelo) → accesoVoucherPorToken (acceso real) → vueloVisible → contarServiciosAereos (lectura real) → VoucherVueloDocumento (HTML).
// SOLO base LOCAL desechable: la lanza supabase/scripts/test_rev2_b1_voucher_nota.sh (clona la base, levanta su PostgREST y lo borra todo). Reutiliza el arnés (proxy local + JWT + cookies) de voucherAcceso307.pg.ts.
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


// ════════ B1-06 · la nota del voucher aéreo según quién abre (aliado dueño pagado / interno / aliado ajeno) ════════
const { accesoVoucherPorToken } = await import("../lib/voucher/accesoVoucher.server.ts");
const { generarVoucherVuelo } = await import("../app/(dashboard)/dashboard/contratos/[numero]/voucher-actions.ts");
const { contarServiciosAereos } = await import("../lib/voucher/serviciosAereos.ts");
const { vueloVisible } = await import("../lib/voucher/pnrVoucher.ts");
const { contratoPagadoCompleto } = await import("../lib/voucher/pagoCompleto.ts");
const { esVoucherVuelo, NOTA_PASAJEROS_TRAMOS, avisoVariosServiciosAereos } = await import("../lib/voucher/vuelo.ts");
const { VoucherVueloDocumento } = await import("../components/voucher/VoucherVueloDocumento.tsx");
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");

const N = "DTM-7011";
const SA = "00000000-0000-4000-9000-000000701101"; // servicio A: BOG→CTG ida y regreso, PNR AAA111
const SB = "00000000-0000-4000-9000-000000701102"; // servicio B: MDE→CTG ida y regreso, PNR BBB222
sql(`
insert into public.ventas (numero_contrato, tenant, cliente, estado, asesor, precio_venta, moneda, tipo_paquete, financiero_estado, aliado_id, tipo_asesor, agencia_nombre, fecha_salida, fecha_regreso)
values ('${N}', 'mayorista', 'Ana Pérez (titular)', 'confirmado', '${U.venta.nombre}', 4000000, 'COP', 'dinamico', 'completo', 9601, 'agencia', 'T206 Agencia', '2027-06-07', '2027-06-10');
insert into public.contrato_pasajeros (numero_contrato, nombre, nombres, apellidos, orden) values
  ('${N}', 'Ana Pérez', 'Ana', 'Pérez', 0), ('${N}', 'Luis Gómez', 'Luis', 'Gómez', 1), ('${N}', 'Marta Ríos', 'Marta', 'Ríos', 2), ('${N}', 'Pedro Soto', 'Pedro', 'Soto', 3);
insert into public.contrato_vuelos (numero_contrato, servicio_aereo, aerolinea, direccion, origen_codigo, origen_ciudad, destino_codigo, destino_ciudad, fecha_salida, numero_vuelo, hora_salida, hora_llegada, record, orden) values
  ('${N}', '${SA}', 'Avianca', 'ida',     'BOG', 'Bogotá',   'CTG', 'Cartagena', '2027-06-07', 'AV301', '07:00', '08:30', 'AAA111', 0),
  ('${N}', '${SA}', 'Avianca', 'regreso', 'CTG', 'Cartagena', 'BOG', 'Bogotá',   '2027-06-10', 'AV302', '17:00', '18:30', 'AAA111', 1),
  ('${N}', '${SB}', 'LATAM',   'ida',     'MDE', 'Medellín',  'CTG', 'Cartagena', '2027-06-07', 'LA401', '09:10', '10:05', 'BBB222', 2),
  ('${N}', '${SB}', 'LATAM',   'regreso', 'CTG', 'Cartagena', 'MDE', 'Medellín',  '2027-06-10', 'LA402', '19:40', '20:35', 'BBB222', 3);
insert into public.abonos (numero_contrato, tenant, cliente, fecha_abono, valor_abono, forma_pago, trm, monto_cop) values ('${N}', 'mayorista', 'c', current_date - 1, 4000000, 'transferencia', 1, 4000000);
`);
const tokenDe = (patron: string) => sql(`select share_token from public.vouchers where numero_contrato = '${N}' and tipo = 'vuelo' and contenido::text like '%${patron}%' order by id desc limit 1`);
const abonado = (v: number) => sql(`update public.abonos set valor_abono = ${v}, monto_cop = ${v} where numero_contrato = '${N}'`);
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");

/** Lo que haría app/voucher/[token]/page.tsx: acceso real → PNR según pago → conteo real → documento. null = la página respondería 404/«no vigente». */
async function paginaVoucher(quien: Quien | null, token: string): Promise<{ modo: string; html: string; servicios: number | null; pnrPendiente: boolean } | { motivo: string }> {
  await entrarComo(quien);
  const r = await accesoVoucherPorToken(token);
  if (!r.ok) return { motivo: r.motivo };
  assert.ok(esVoucherVuelo(r.voucher.contenido));
  const v = await vueloVisible(r.voucher.contenido as never, r.modo, r.voucher.numero_contrato, contratoPagadoCompleto);
  const servicios = await contarServiciosAereos(r.voucher.numero_contrato);
  const html = renderToStaticMarkup(createElement(VoucherVueloDocumento as never, { c: v.contenido, serviciosAereos: servicios, pnrPendientePago: v.pnrPendientePago }));
  return { modo: r.modo, html, servicios, pnrPendiente: v.pnrPendientePago };
}

test("R0 acción real: administración genera UN voucher por servicio (2), cada uno con SUS tramos y con los 4 pasajeros del contrato (no hay vínculo pasajero↔tramo)", async () => {
  await entrarComo("admin");
  const g = await generarVoucherVuelo(N, {} as never);
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.equal(sql(`select count(*) from public.vouchers where numero_contrato = '${N}' and tipo = 'vuelo'`), "2");
  const a = JSON.parse(sql(`select contenido::text from public.vouchers where numero_contrato = '${N}' and tipo = 'vuelo' and contenido::text like '%AV301%'`));
  const b = JSON.parse(sql(`select contenido::text from public.vouchers where numero_contrato = '${N}' and tipo = 'vuelo' and contenido::text like '%LA401%'`));
  assert.deepEqual(a.tramos.map((t: { numeroVuelo: string }) => t.numeroVuelo), ["AV301", "AV302"]);
  assert.deepEqual(b.tramos.map((t: { numeroVuelo: string }) => t.numeroVuelo), ["LA401", "LA402"]);
  assert.deepEqual(a.pasajeros, ["Ana Pérez", "Luis Gómez", "Marta Ríos", "Pedro Soto"]);
  assert.deepEqual(b.pasajeros, a.pasajeros, "los dos vouchers listan a los MISMOS 4: el sistema no sabe quién va en cuál");
  assert.equal(sql(`select count(*) from information_schema.columns where table_name = 'contrato_pasajeros' and column_name ~ 'tramo|vuelo|servicio'`), "0", "hoy NO existe columna que ligue pasajero y tramo");
});

test("R1 ALIADO dueño, contrato 100 % pagado: abre en modo «aliado» y VE la nota, el aviso de 2 servicios y su PNR; no ve la nota interna", async () => {
  const p = await paginaVoucher("agencia", tokenDe("AV301"));
  assert.ok("modo" in p, JSON.stringify(p));
  assert.equal(p.modo, "aliado");
  assert.equal(p.servicios, 2);
  const t = texto(p.html);
  assert.ok(t.includes(NOTA_PASAJEROS_TRAMOS));
  assert.ok(t.includes(avisoVariosServiciosAereos(2)));
  assert.match(t, /PNR \/ Código de reserva AAA111/);
  assert.doesNotMatch(t, /BBB222|LA401/, "solo su servicio");
  assert.doesNotMatch(p.html, /pnr-pendiente-pago/);
});

test("R2 INTERNO con contrato sin pagar completo: misma nota y aviso, SIN PNR, y la nota interna; el aliado dueño NO abre (sin pago)", async () => {
  abonado(3000000);
  const i = await paginaVoucher("admin", tokenDe("AV301"));
  assert.ok("modo" in i, JSON.stringify(i));
  assert.equal(i.modo, "interno");
  const t = texto(i.html);
  assert.ok(t.includes(NOTA_PASAJEROS_TRAMOS));
  assert.ok(t.includes(avisoVariosServiciosAereos(2)));
  assert.doesNotMatch(t, /AAA111/);
  assert.equal(i.pnrPendiente, true);
  assert.match(i.html, /pnr-pendiente-pago/);
  const a = await paginaVoucher("agencia", tokenDe("AV301"));
  assert.deepEqual(a, { motivo: "pago_incompleto" });
  abonado(4000000);
});

test("R3 INTERNO con contrato pagado: ve exactamente la misma nota/aviso que el aliado, con PNR", async () => {
  const i = await paginaVoucher("super", tokenDe("LA401"));
  assert.ok("modo" in i);
  const a = await paginaVoucher("agencia", tokenDe("LA401"));
  assert.ok("modo" in a);
  const cola = (h: string) => texto(h.slice(h.indexOf("Pasajeros de la reserva")));
  assert.equal(cola(i.html), cola(a.html));
  assert.match(texto(a.html), /PNR \/ Código de reserva BBB222/);
});

test("R4 aliado AJENO y sin sesión: no abren; no se renderiza nada (ni la nota)", async () => {
  assert.deepEqual(await paginaVoucher("agencia2", tokenDe("AV301")), { motivo: "sin_permiso" });
  assert.deepEqual(await paginaVoucher(null, tokenDe("AV301")), { motivo: "sin_sesion" });
});

test("R5 si el contrato queda con UN solo servicio vigente (el otro se retira al regenerar), el aviso de varios servicios desaparece y la nota general se conserva", async () => {
  sql(`delete from public.contrato_vuelos where numero_contrato = '${N}' and servicio_aereo = '${SB}'`);
  await entrarComo("admin");
  const g = await generarVoucherVuelo(N, {} as never);
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.equal(await contarServiciosAereos(N), 1, "el voucher retirado ya no cuenta");
  const p = await paginaVoucher("agencia", tokenDe("AV301"));
  assert.ok("modo" in p);
  assert.equal(p.servicios, 1);
  assert.doesNotMatch(p.html, /aviso-varios-servicios/);
  assert.ok(texto(p.html).includes(NOTA_PASAJEROS_TRAMOS));
});

test("R6 recursos: abrir el voucher añade UNA lectura acotada (≤ 100 filas) y nada se escribe", async () => {
  const antes = sql(`select count(*) from public.vouchers where numero_contrato = '${N}'`);
  const antesAbonos = sql(`select coalesce(sum(valor_abono), 0) from public.abonos where numero_contrato = '${N}'`);
  (globalThis as unknown as { __reqs?: number }).__reqs = 0;
  await contarServiciosAereos(N);
  assert.equal((globalThis as unknown as { __reqs?: number }).__reqs, 1, "1 petición REST por apertura del voucher aéreo");
  assert.equal(sql(`select count(*) from public.vouchers where numero_contrato = '${N}'`), antes);
  assert.equal(sql(`select coalesce(sum(valor_abono), 0) from public.abonos where numero_contrato = '${N}'`), antesAbonos);
});
