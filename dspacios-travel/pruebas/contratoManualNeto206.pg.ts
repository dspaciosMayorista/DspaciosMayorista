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
const estado = globalThis as unknown as { __pg206: { jar: Jar; rutas: string[] } };
estado.__pg206 = { jar: new Map(), rutas: [] };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const RAIZ = new URL("../", import.meta.url);
const real = (rel: string) => new URL(rel, RAIZ).href;
const HEADERS = [
  "export async function cookies() {",
  "  const j = globalThis.__pg206.jar;",
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
  "const r = { push(u) { globalThis.__pg206.rutas.push(u); }, replace() {}, refresh() {}, back() {}, prefetch() {} };",
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
  estado.__pg206.jar = jar;
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

// ── Código REAL de la app ─────────────────────────────────────────────────
const React = await import("react");
const h = React.createElement;
const { NuevoContratoForm } = await import("../app/(dashboard)/dashboard/contratos/NuevoContratoForm.tsx");
const { crearContrato, previsualizarNetoContrato, actualizarVenta, actualizarServiciosContrato, registrarAbono } =
  await import("../app/(dashboard)/dashboard/contratos/actions.ts");
const { ventasMesPorMonedaDesdeAgregado } = await import("../lib/dashboard/metricas.ts");
const { formatMoneda } = await import("../lib/utils.ts");
const $ = (n: number) => formatMoneda(n, "COP").replace(/\s+/g, " ");
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

// PVP 2.000.000 (1 adulto × 2.000.000), BNC 0 en el formulario; aliado 9601 al
// 10 % → comisión 200.000, total NETO 1.800.000.
const estadoVenta = (n: string) => sql(`
  select v.precio_venta::numeric(15,0) || '|' || coalesce(v.modo_compra, '-') || '|' || coalesce(v.comision_b2b::numeric(15,0)::text, '-')
         || '|' || coalesce(v.comision_estado, '-') || '|' || (select count(*) from public.aliados_b2b b where b.numero_contrato = v.numero_contrato)
    from public.ventas v where v.numero_contrato = '${n}'`);
const numeros = () => sql(`select coalesce(string_agg(numero_contrato, ',' order by numero_contrato), '') from public.ventas`).split(",").filter(Boolean);
const nuevos = (antes: string[]) => numeros().filter((n) => !antes.includes(n));
// Numeración de cada agencia (siguiente_numero_contrato_para_tenant): mayorista
// usa contrato_seq_mayorista; minorista contrato_seq + el pool de liberados.
const consecutivo = () => sql(`select (select last_value || '/' || is_called from public.contrato_seq_mayorista) || '|' ||
  (select last_value || '/' || is_called from public.contrato_seq) || '|' || (select count(*) from public.numeros_contrato_liberados)`);

function entradaContrato(extra: Record<string, unknown> = {}) {
  return {
    tipoPaquete: "dinamico" as const, paqueteId: null, bloqueoId: null,
    cliente: "Cliente 206", clienteDocumento: "", clienteTelefono: "", clienteDireccion: "",
    destino: "CARTAGENA", fechaSalida: "2026-12-01", fechaRegreso: "2026-12-04", fechaEmision: "2026-10-12",
    asistenciaMedica: false, planNombre: "", toursTraslados: "",
    asesorNombre: U.venta.nombre, asesorCargo: "", asesorCc: "", asesorTel: "",
    pasajeros: [],
    hoteles: [{
      nombre: "Hotel 206", categoria: "Estándar", proveedor: "Operador 206", ciudad: "Cartagena", alimentacion: "PC",
      acomodacion: "Doble", detalleAcomodacion: "", fechaIngreso: "2026-12-01", fechaSalida: "2026-12-04", costo: 1_500_000,
    }],
    vuelos: [],
    items: [{ descripcion: "Paquete Cartagena", adultos: 1, ninos: 0, tarifaAdulto: 2_000_000, tarifaNino: 0 }],
    tipoVenta: "agencia" as const,
    aliadoId: 9601,
    bncModo: "fijo" as const,
    bncFijo: 0,
    ...extra,
  };
}
const NETO = { modoCompra: "neto", comisionNetoEsperada: 200_000 } as const;
const errorDe = (r: unknown) => (r as { error?: string }).error ?? "";
const SIN_IMPORTES_ALIADO = /200000|0\.1\b/;

test("P3b la aserción de permisos detecta 0.1 sin confundirlo con 0.12", () => {
  assert.match('{"pct_comision":0.1}', SIN_IMPORTES_ALIADO);
  assert.doesNotMatch('{"pct_comision":0.12}', SIN_IMPORTES_ALIADO);
});

// ── Formulario ────────────────────────────────────────────────────────────
async function cambiar(sel: HTMLSelectElement | undefined, valor: string) {
  if (!sel) throw new Error("no se encontró el select");
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, valor);
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const inputDeEtiqueta = (raiz: Element, etiqueta: string) =>
  [...raiz.querySelectorAll("label")].find((l) => txt(l).startsWith(etiqueta))?.parentElement?.querySelector("input") as HTMLInputElement | null;
async function esperarHasta(listo: () => boolean, ms = 15_000) {
  const fin = Date.now() + ms;
  while (!listo() && Date.now() < fin) await React.act(async () => { await new Promise((r) => setTimeout(r, 100)); });
  return listo();
}
async function formulario(costoHotel: number) {
  const m = await montar(h(NuevoContratoForm, { asesorDefault: U.venta.nombre, agencias: [{ id: 9601, nombre: "T206 Agencia" }] }));
  const raiz = m.contenedor;
  await escribir(raiz.querySelector("input[required]") as HTMLInputElement, "Cliente Formulario 206");
  await escribir(inputDeEtiqueta(raiz, "Tarifa adulto")!, "2000000");
  await clic(botonConTexto(raiz, /Agregar hotel/), "Agregar hotel");
  await escribir(raiz.querySelector('input[title="Costo neto del hotel (interno)"]') as HTMLInputElement, String(costoHotel));
  const selects = () => [...raiz.querySelectorAll("select")];
  await cambiar(selects().find((s) => [...s.options].some((o) => o.value === "agencia")), "agencia");
  await cambiar(selects().find((s) => [...s.options].some((o) => o.textContent === "T206 Agencia")), "9601");
  return { raiz, desmontar: m.desmontar };
}
/** Envía el formulario y espera a que crearContrato termine (router.push) o muestre un error. */
async function generarYEsperar(raiz: Element): Promise<string | null> {
  const previas = estado.__pg206.rutas.length;
  await enviar(raiz.querySelector("form"));
  const listo = await esperarHasta(() => estado.__pg206.rutas.length > previas || /No se pudo|cambió|no cubre|Solo puedes/.test(txt(raiz)), 30_000);
  assert.ok(listo, `el formulario no terminó: ${txt(raiz).slice(-400)}`);
  const ruta = estado.__pg206.rutas[previas];
  return ruta ? decodeURIComponent(ruta.split("/").pop()!) : null;
}
const radioNeto = (raiz: Element) => [...raiz.querySelectorAll<HTMLInputElement>('input[name="modoCompra"]')][1];
const totalNeto = (raiz: Element) => raiz.querySelector("[data-total-neto]");

// ═══ 1. Trayecto formulario → crearContrato → RPC ═════════════════════════

test("F1 venta: formulario NETO → vista previa real → crearContrato → RPC; precio = total exigible y comisión descontada", async () => {
  await entrarComo("venta");
  const antes = numeros();
  const { raiz, desmontar } = await formulario(1_500_000);
  await clic(radioNeto(raiz), "radio NETO");
  assert.ok(await esperarHasta(() => totalNeto(raiz)?.getAttribute("data-total-neto") === "listo"), txt(raiz).slice(-400));
  assert.equal(txt(totalNeto(raiz)), $(1_800_000), "la vista previa del servidor (BD real) da el total NETO");
  const n = await generarYEsperar(raiz);
  await desmontar();
  assert.ok(n, "crearContrato devolvió el número");
  assert.deepEqual(nuevos(antes), [n]);
  assert.equal(estadoVenta(n), "1800000|neta|200000|descontada|1");
  assert.equal(sql(`select precio_venta::numeric(15,0)||'|'||base_comision::numeric(15,0)||'|'||pct_comision||'|'||descontada_en_precio||'|'||estado||'|'||aliado_id||'|'||tipo_aliado
                    from public.aliados_b2b where numero_contrato = '${n}'`), "2000000|2000000|0.1000|true|pagada|9601|agencia");
  assert.equal(sql(`select asesor_firma_nombre || '|' || coalesce(asesor, '-') || '|' || estado from public.ventas where numero_contrato = '${n}'`),
    "T206 Venta|T206 Venta|activo");
  // Auditoría: el RPC corrió con la sesión del asesor (SECURITY DEFINER conserva auth.uid()).
  assert.match(sql(`select string_agg(distinct coalesce(actor_email, '-'), ',') from public.auditoria where tabla = 'aliados_b2b' and registro_id = '${n}'`), /t206-venta@x\.test/);
});

test("F2 venta: formulario PVP → sin RPC, comisión 'Por definir' (#38 intacto)", async () => {
  await entrarComo("venta");
  const antes = numeros();
  const { raiz, desmontar } = await formulario(1_500_000);
  const n = await generarYEsperar(raiz);
  await desmontar();
  assert.ok(n);
  assert.deepEqual(nuevos(antes), [n]);
  assert.equal(estadoVenta(n!), "2000000|-|-|-|0");
});

test("F3 carrera vista previa → creación: si el % del aliado cambia en medio, se niega ANTES de numerar", async () => {
  await entrarComo("venta");
  const antes = numeros();
  const cons = consecutivo();
  const { raiz, desmontar } = await formulario(1_500_000);
  await clic(radioNeto(raiz), "radio NETO");
  assert.ok(await esperarHasta(() => totalNeto(raiz)?.getAttribute("data-total-neto") === "listo"));
  sql(`update public.aliados set pct_comision = 0.12 where id = 9601`);
  try {
    assert.equal(await generarYEsperar(raiz), null, "no navega: se niega");
    assert.match(txt(raiz), /La comisión del aliado cambió/);
    assert.match(txt(raiz), new RegExp(`ahora es ${$(240_000).replace(/\$/g, "\\$")}`));
  } finally {
    sql(`update public.aliados set pct_comision = 0.10 where id = 9601`);
    await desmontar();
  }
  assert.deepEqual(nuevos(antes), [], "no se creó nada");
  assert.equal(consecutivo(), cons, "no se gastó un consecutivo");
});

// ═══ 2. Permisos por rol ══════════════════════════════════════════════════

test("P1 crearContrato NETO por rol: internos con escritura sí; externos, control_vuelo, inactivo y sin sesión no (sin numerar)", async () => {
  for (const quien of ["super", "admin", "ops", "gerencia"] as const) {
    await entrarComo(quien);
    const antes = numeros();
    const r = await crearContrato(entradaContrato({ ...NETO, asesorNombre: U[quien].nombre }));
    assert.equal(r.ok, true, `${quien}: ${JSON.stringify(r)}`);
    assert.equal(estadoVenta(nuevos(antes)[0]), "1800000|neta|200000|descontada|1", quien);
  }
  for (const quien of ["agencia", "control", "inactivo", null] as const) {
    await entrarComo(quien);
    const antes = numeros();
    const cons = consecutivo();
    const r = await crearContrato(entradaContrato(NETO));
    assert.equal(r.ok, false, `${quien ?? "sin sesión"} no crea`);
    assert.deepEqual(nuevos(antes), [], `${quien ?? "sin sesión"}: nada creado`);
    assert.equal(consecutivo(), cons, `${quien ?? "sin sesión"}: sin consecutivo`);
  }
});

test("P2 venta: NETO solo en SU contrato — a nombre de un colega se niega antes de numerar", async () => {
  await entrarComo("venta");
  const antes = numeros();
  const cons = consecutivo();
  const r = await crearContrato(entradaContrato({ ...NETO, asesorNombre: U.colega.nombre }));
  assert.equal(r.ok, false);
  assert.match(errorDe(r), /Solo puedes registrar en NETO tus propios contratos/);
  assert.deepEqual(nuevos(antes), []);
  assert.equal(consecutivo(), cons);
});

test("P3 vista previa NETO por rol: solo quien puede crear el contrato ve el plan (% y comisión del aliado)", async () => {
  const pedir = () => previsualizarNetoContrato({ tipoVenta: "agencia", aliadoId: 9601, precioVenta: 2_000_000, impuesto: 0 });
  for (const quien of ["super", "admin", "ops", "gerencia", "venta"] as const) {
    await entrarComo(quien);
    assert.deepEqual(await pedir(), { ok: true, plan: { pct: 0.1, base: 2_000_000, comision: 200_000, pvp: 2_000_000, totalExigible: 1_800_000 } }, quien);
  }
  for (const quien of ["agencia", "control", "inactivo", null] as const) {
    await entrarComo(quien);
    const r = await pedir();
    assert.equal(r.ok, false, `${quien ?? "sin sesión"} no debe recibir el plan: ${JSON.stringify(r)}`);
    assert.doesNotMatch(JSON.stringify(r), SIN_IMPORTES_ALIADO, `${quien ?? "sin sesión"}: sin importes del aliado`);
  }
});

test("P4 RPC por la API (PostgREST) con roles no autorizados: se niega y no escribe", async () => {
  sql(`insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, impuesto, tipo_asesor, aliado_id, canal, estado, asesor)
       values ('DTM-9690', 'C', 'mayorista', 2000000, 0, 'agencia', 9601, 'B2B', 'activo', 'T206 Venta')`);
  for (const [quien, esperado] of [["agencia", /No autorizado para registrar/], ["control", /No autorizado para registrar/],
    ["inactivo", /No autorizado para registrar/], ["colega", /Solo puedes registrar en NETO/], ["adminMin", /No autorizado para el contrato/]] as const) {
    const sb = await clienteDe(quien);
    const { error } = await sb.rpc("aplicar_neto_contrato_manual", { p_numero: "DTM-9690", p_aliado_id: 9601, p_comision_esperada: 200_000 });
    assert.match(error?.message ?? "(sin error)", esperado, quien);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const anon = createClient(URL_SB, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { error } = await anon.rpc("aplicar_neto_contrato_manual", { p_numero: "DTM-9690", p_aliado_id: 9601, p_comision_esperada: 200_000 });
  assert.match(error?.message ?? "(sin error)", /permission denied/, "anon");
  assert.equal(estadoVenta("DTM-9690"), "2000000|-|-|-|0");
});

// ═══ 3. Guardas de precio, modalidad y margen ═════════════════════════════

test("G1 comisión distinta a la mostrada / venta directa NETO / modalidad inválida: sin numerar", async () => {
  await entrarComo("venta");
  const antes = numeros();
  const cons = consecutivo();
  const distinta = await crearContrato(entradaContrato({ modoCompra: "neto", comisionNetoEsperada: 190_000 }));
  assert.match(errorDe(distinta), /La comisión del aliado cambió/);
  const directa = await crearContrato(entradaContrato({ tipoVenta: "interno", aliadoId: null, modoCompra: "neto", comisionNetoEsperada: 0 }));
  assert.match(errorDe(directa), /venta directa no tiene modalidad NETO/);
  const invalida = await crearContrato(entradaContrato({ modoCompra: "mitad" }) as never);
  assert.equal(invalida.ok, false);
  assert.deepEqual(nuevos(antes), []);
  assert.equal(consecutivo(), cons);
});

test("G2 margen: NETO 6 % sobre el total exigible (límite exacto pasa), PVP 20 %; aprobación excepcional solo superadmin/administración", async () => {
  // Total NETO 1.800.000 → costo máximo 1.692.000. PVP 2.000.000 → costo máximo 1.600.000.
  await entrarComo("venta");
  let antes = numeros();
  const abajo = await crearContrato(entradaContrato({ ...NETO, hoteles: [{ ...entradaContrato().hoteles[0], costo: 1_692_001 }] }));
  assert.equal((abajo as { margenInsuficiente?: boolean }).margenInsuficiente, true, JSON.stringify(abajo));
  assert.match(errorDe(abajo), /no cubre el margen mínimo del 6%/);
  const forzadaVenta = await crearContrato({ ...entradaContrato({ ...NETO, hoteles: [{ ...entradaContrato().hoteles[0], costo: 1_692_001 }] }), forzarMargen: true });
  assert.equal(forzadaVenta.ok, false, "venta no aprueba margen bajo");
  assert.deepEqual(nuevos(antes), []);
  const limite = await crearContrato(entradaContrato({ ...NETO, hoteles: [{ ...entradaContrato().hoteles[0], costo: 1_692_000 }] }));
  assert.equal(limite.ok, true, JSON.stringify(limite));
  const pvpAbajo = await crearContrato(entradaContrato({ modoCompra: "pvp", hoteles: [{ ...entradaContrato().hoteles[0], costo: 1_600_001 }] }));
  assert.match(errorDe(pvpAbajo), /no cubre el margen mínimo del 20%/);
  await entrarComo("admin");
  antes = numeros();
  const forzada = await crearContrato({ ...entradaContrato({ ...NETO, asesorNombre: U.admin.nombre, hoteles: [{ ...entradaContrato().hoteles[0], costo: 1_692_001 }] }), forzarMargen: true });
  assert.equal(forzada.ok, true, JSON.stringify(forzada));
  assert.equal(estadoVenta(nuevos(antes)[0]), "1800000|neta|200000|descontada|1");
});

test("G3 después de emitir: la app y la API directa no cambian precio, tipo ni servicios de un NETO; sí los demás datos", async () => {
  await entrarComo("admin");
  const antes = numeros();
  const r = await crearContrato(entradaContrato({ ...NETO, asesorNombre: U.admin.nombre }));
  assert.equal(r.ok, true);
  const [n] = nuevos(antes);
  const base = {
    cliente: "Cliente 206", clienteDocumento: "", clienteTelefono: "", clienteEmail: "", clienteDireccion: "", destino: "CARTAGENA",
    fechaSalida: "2026-12-01", fechaRegreso: "2026-12-04", plazo: "", tipoAsesor: "agencia", agenciaNombre: "T206 Agencia",
    agenciaAsesor: "", freelanceNombre: "", asesorNombre: U.admin.nombre, planNombre: "", observaciones: "", pax: "1",
  };
  const subir = await actualizarVenta(n, { ...base, precioVenta: "2000000" });
  assert.match(errorDe(subir), /vendido en NETO: el precio de venta es el total exigible/);
  const tipo = await actualizarVenta(n, { ...base, tipoAsesor: "interno", precioVenta: "1800000" });
  assert.match(errorDe(tipo), /vendido en NETO: el tipo de venta/);
  const servicios = await actualizarServiciosContrato(n, []);
  assert.match(errorDe(servicios), /vendido en NETO: los servicios no se cambian/);
  const cliente = await actualizarVenta(n, { ...base, cliente: "Cliente Corregido 206", precioVenta: "1800000" });
  assert.equal(cliente.ok, true, JSON.stringify(cliente));
  // API directa con la sesión de administración (sin pasar por las guardas de la app).
  const sb = await clienteDe("admin");
  const p1 = await sb.from("ventas").update({ precio_venta: 2_000_000 }).eq("numero_contrato", n);
  assert.match(p1.error?.message ?? "(sin error)", /vendido en NETO/);
  const p2 = await sb.from("ventas").update({ comision_estado: null, modo_compra: null }).eq("numero_contrato", n);
  assert.match(p2.error?.message ?? "(sin error)", /modalidad de compra B2B/);
  const borrar = await sb.from("aliados_b2b").delete().eq("numero_contrato", n).select("id");
  assert.ok(borrar.error || (borrar.data ?? []).length === 0, "la fila NETO no se borra suelta (205)");
  assert.equal(estadoVenta(n), "1800000|neta|200000|descontada|1");
  assert.equal(sql(`select cliente from public.ventas where numero_contrato = '${n}'`), "Cliente Corregido 206");
});

// ═══ 4. Fallo y reversión ════════════════════════════════════════════════

test("R1 el RPC falla después de crear el contrato: la app lo revierte completo (BD real)", async () => {
  await entrarComo("venta");
  const antes = numeros();
  sql(`create or replace function public.t206_falla() returns trigger language plpgsql as $$ begin raise exception 'fallo simulado 206'; end $$;
       create trigger t206_falla before insert on public.aliados_b2b for each row execute function public.t206_falla();`);
  try {
    const r = await crearContrato(entradaContrato(NETO));
    assert.equal(r.ok, false);
    assert.match(errorDe(r), /No se pudo registrar el contrato en NETO \(fallo simulado 206\), así que no se creó/);
  } finally {
    sql(`drop trigger t206_falla on public.aliados_b2b; drop function public.t206_falla();`);
  }
  assert.deepEqual(nuevos(antes), [], "el contrato no quedó");
  assert.equal(sql(`select count(*) from public.contrato_items i where not exists (select 1 from public.ventas v where v.numero_contrato = i.numero_contrato)`), "0", "sin hijas huérfanas");
  assert.equal(sql(`select count(*) from public.cuentas_por_pagar c where not exists (select 1 from public.ventas v where v.numero_contrato = c.numero_contrato)`), "0");
});

test("R2 falla el RPC Y la reversión: queda PVP 'Por definir' (nunca NETO sin comisión) y el mensaje nombra el número", async () => {
  await entrarComo("venta");
  const antes = numeros();
  sql(`create or replace function public.t206_falla() returns trigger language plpgsql as $$ begin raise exception 'fallo simulado 206'; end $$;
       create trigger t206_falla before insert on public.aliados_b2b for each row execute function public.t206_falla();
       create or replace function public.t206_no_borrar() returns trigger language plpgsql as $$ begin raise exception 'reversión bloqueada 206'; end $$;
       create trigger t206_no_borrar before delete on public.ventas for each row execute function public.t206_no_borrar();`);
  let r: unknown;
  try {
    r = await crearContrato(entradaContrato(NETO));
  } finally {
    sql(`drop trigger t206_falla on public.aliados_b2b; drop function public.t206_falla();
         drop trigger t206_no_borrar on public.ventas; drop function public.t206_no_borrar();`);
  }
  const [n] = nuevos(antes);
  assert.ok(n, "el contrato quedó (no se pudo deshacer)");
  assert.match(errorDe(r), new RegExp(`tampoco se pudo deshacer el contrato ${n} automáticamente`));
  assert.match(errorDe(r), /Quedó como PVP con la comisión por definir/);
  assert.equal(estadoVenta(n), "2000000|-|-|-|0");
  // CXP-1: además nunca llegó a la escritura financiera — sigue 'pendiente',
  // así que no admite abonos (trigger de la 172) aunque esté vivo.
  assert.equal(sql(`select financiero_estado from public.ventas where numero_contrato = '${n}'`), "pendiente");
  await entrarComo("admin");
  const abono = await registrarAbono(n, 100_000, "Efectivo", "R2");
  assert.equal(abono.ok, false, "no cobrable mientras su registro financiero está pendiente");
});

// ═══ 5. Concurrencia en la app ═══════════════════════════════════════════

test("C1 dos crearContrato NETO simultáneos: números distintos, cada uno con UNA comisión descontada", async () => {
  await entrarComo("venta");
  const antes = numeros();
  const [a, b] = await Promise.all([crearContrato(entradaContrato(NETO)), crearContrato(entradaContrato(NETO))]);
  assert.equal(a.ok && b.ok, true, JSON.stringify([a, b]));
  const ns = nuevos(antes);
  assert.equal(ns.length, 2);
  for (const n of ns) assert.equal(estadoVenta(n), "1800000|neta|200000|descontada|1");
});

// ═══ 6. Metas: general = total exigible; asesor = PVP original ════════════

test("M1 meta general del mes (fn_dashboard_ventas_mes por la API) suma el total exigible NETO", async () => {
  const sb = await clienteDe("admin");
  const periodo = sql(`select to_char(current_date, 'YYYY-MM')`);
  const { data, error } = await sb.rpc("fn_dashboard_ventas_mes", { p_tenant: "mayorista", p_periodo: periodo });
  assert.equal(error, null);
  const porMoneda = ventasMesPorMonedaDesdeAgregado((data ?? []) as { moneda: string; total: number }[]);
  const [exigible, pvpOriginal] = sql(`select sum(precio_venta)::numeric(15,0) || '|' || sum(precio_venta + case when comision_estado = 'descontada' then comision_b2b else 0 end)::numeric(15,0)
      from public.ventas where tenant = 'mayorista' and estado in ('confirmado','activo') and to_char(fecha_venta, 'YYYY-MM') = '${periodo}'`).split("|").map(Number);
  assert.ok(pvpOriginal > exigible, "hay contratos NETO en el mes");
  assert.equal(porMoneda.COP, exigible, "la meta general cuenta lo que se cobra (total exigible), no el PVP original");
});

test("M2 liquidación del asesor (página real, BD real): rango y base sobre el PVP ORIGINAL", async () => {
  // Como superadmin: la RLS de `usuarios` (ver propio perfil / superadmin
  // gestiona) solo le deja a superadmin la lista de asesores; para
  // administración/gerencia la página sale vacía (preexistente, fuera de #30).
  await entrarComo("super");
  const { default: LiquidacionPage } = await import("../app/(dashboard)/dashboard/liquidacion/page.tsx");
  const mes = sql(`select to_char(current_date, 'YYYY-MM')`);
  const el = await LiquidacionPage({ searchParams: Promise.resolve({ mes }) });
  const buscar = (n: unknown): { nombre: string; pvp: number; base: number }[] | null => {
    if (!n || typeof n !== "object") return null;
    const p = (n as { props?: { filas?: unknown; children?: unknown } }).props;
    if (p?.filas) return p.filas as never;
    for (const c of Array.isArray(p?.children) ? (p!.children as unknown[]) : [p?.children]) { const r = buscar(c); if (r) return r; }
    return null;
  };
  const filas = buscar(el);
  const fila = filas?.find((x) => x.nombre === U.venta.nombre);
  assert.ok(fila, `fila del asesor en la liquidación: ${JSON.stringify(filas)?.slice(0, 400)}`);
  const [pvpOriginal, exigible] = sql(`select sum(precio_venta + case when comision_estado = 'descontada' then comision_b2b else 0 end)::numeric(15,0) || '|' || sum(precio_venta)::numeric(15,0)
      from public.ventas where asesor_firma_nombre = '${U.venta.nombre}' and estado in ('activo','confirmado') and to_char(fecha_venta, 'YYYY-MM') = '${mes}'`).split("|").map(Number);
  assert.ok(pvpOriginal > exigible);
  assert.equal(fila?.pvp, pvpOriginal, "PVP del asesor = PVP original");
  assert.equal(fila?.base, pvpOriginal, "BNC 0 → base = PVP original");
});

// ═══ 7. Superficies con la BD real ═══════════════════════════════════════

async function contratoNetoDeVenta(): Promise<string> {
  await entrarComo("venta");
  const antes = numeros();
  const r = await crearContrato(entradaContrato(NETO));
  assert.equal(r.ok, true, JSON.stringify(r));
  return nuevos(antes)[0];
}
const plano = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

test("D1 documento imprimible (página real) como el asesor dueño: total exigible; ni PVP ni comisión", async () => {
  const n = await contratoNetoDeVenta();
  const { default: Pagina } = await import("../app/contrato/[numero]/page.tsx");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const html = plano(renderToStaticMarkup((await Pagina({ params: Promise.resolve({ numero: n }) })) as never));
  assert.ok(html.includes(`Total del contrato ${$(1_800_000)}`), html.slice(0, 600));
  for (const v of [2_000_000, 200_000]) assert.ok(!html.includes($(v)), `no aparece ${$(v)}`);
});

test("D2 estado de cuenta, rentabilidad y facturación (código real, BD real)", async () => {
  const n = await contratoNetoDeVenta();
  await entrarComo("admin");
  const { cargarEstadoCuenta } = await import("../lib/cuenta/estado.ts");
  const ec = await cargarEstadoCuenta(n);
  assert.deepEqual([ec?.precio_venta, ec?.saldo], [1_800_000, 1_800_000]);
  const { calcularRentabilidad } = await import("../lib/finanzas/rentabilidad.ts");
  const f = (await calcularRentabilidad()).filas.find((x) => x.numero_contrato === n);
  assert.deepEqual([f?.precioVenta, f?.comB2B], [1_800_000, 0], "ingreso = total exigible; la comisión descontada no se resta otra vez");
  const { default: FacturacionPage } = await import("../app/(dashboard)/dashboard/contabilidad/facturacion/page.tsx");
  const buscar = (x: unknown): { numero_contrato: string; precio_venta: number }[] | null => {
    if (!x || typeof x !== "object") return null;
    const p = (x as { props?: { rows?: unknown; children?: unknown } }).props;
    if (p?.rows) return p.rows as never;
    for (const c of Array.isArray(p?.children) ? (p!.children as unknown[]) : [p?.children]) { const r = buscar(c); if (r) return r; }
    return null;
  };
  assert.equal(buscar(await FacturacionPage())?.find((x) => x.numero_contrato === n)?.precio_venta, 1_800_000, "se factura el total exigible");
});

test("D3 portal B2B (página real) como el aliado: ve el total exigible y su comisión como descontada; nada cobrable", async () => {
  const n = await contratoNetoDeVenta();
  sql(`update public.ventas set b2b_usuario_id = null where numero_contrato = '${n}'`);
  await entrarComo("agencia");
  const { default: PortalB2BPage } = await import("../app/portal/b2b/page.tsx");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const html = plano(renderToStaticMarkup((await PortalB2BPage()) as never));
  const crudo = renderToStaticMarkup((await PortalB2BPage()) as never);
  const fila = plano([...crudo.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]).find((tr) => tr.includes(n)) ?? "");
  assert.ok(html.includes(n) && fila, `el aliado ve su contrato ${n}`);
  assert.ok(fila.includes($(1_800_000)), `total exigible en su fila: ${fila}`);
  assert.ok(!fila.includes($(2_000_000)), `en su fila no aparece el PVP original: ${fila}`);
  const { resolverComisionB2B } = await import("../lib/finanzas/comisionResolver.ts");
  // Cuenta de cobro: en NETO la comisión ya está descontada → nada que cobrar (null).
  assert.equal(await resolverComisionB2B(n), null);
});

// ═══ 8. Minorista: B2B NETO/PVP, venta directa solo PVP, aislamiento ═══════
// Decisión del dueño (2026-10-12): B2B NETO también en minorista, aislado por
// tenant; la venta directa sigue solo en PVP. El catálogo `aliados` es único
// para las dos agencias; la venta, su comisión y su numeración no.
const tenantDe = (n: string) => sql(`select tenant || '|' || (select coalesce(string_agg(distinct tenant, ','), '-') from public.aliados_b2b where numero_contrato = '${n}')
  from public.ventas where numero_contrato = '${n}'`);
const contratoMin = (extra: Record<string, unknown> = {}) => entradaContrato({ asesorNombre: U.ventaMin.nombre, ...extra });

test("T1 minorista B2B NETO (asesor venta de minorista): número MIN-, total exigible y comisión descontada en su tenant", async () => {
  await entrarComo("ventaMin");
  const antes = numeros();
  const r = await crearContrato(contratoMin(NETO));
  assert.equal(r.ok, true, JSON.stringify(r));
  const [n] = nuevos(antes);
  assert.match(n, /^MIN-00-\d{4}$/);
  assert.equal(estadoVenta(n), "1800000|neta|200000|descontada|1");
  assert.equal(tenantDe(n), "minorista|minorista", "venta y comisión en minorista");
});

test("T2 minorista B2B PVP: comisión 'Por definir', sin modalidad (como #38)", async () => {
  await entrarComo("ventaMin");
  const antes = numeros();
  const r = await crearContrato(contratoMin({ modoCompra: "pvp" }));
  assert.equal(r.ok, true, JSON.stringify(r));
  const [n] = nuevos(antes);
  assert.match(n, /^MIN-/);
  assert.equal(estadoVenta(n), "2000000|-|-|-|0");
});

test("T3 venta directa: solo PVP en minorista y en mayorista; NETO se niega sin numerar en ninguna agencia", async () => {
  for (const [quien, prefijo] of [["ventaMin", /^MIN-/], ["venta", /^DTM-/]] as const) {
    await entrarComo(quien);
    const antes = numeros();
    const cons = consecutivo();
    const directa = { tipoVenta: "interno", aliadoId: null, asesorNombre: U[quien].nombre };
    const neto = await crearContrato(entradaContrato({ ...directa, modoCompra: "neto", comisionNetoEsperada: 0 }));
    assert.match(errorDe(neto), /venta directa no tiene modalidad NETO/, quien);
    assert.deepEqual(nuevos(antes), [], `${quien}: nada creado`);
    assert.equal(consecutivo(), cons, `${quien}: sin consecutivo`);
    const pvp = await crearContrato(entradaContrato({ ...directa, modoCompra: "pvp" }));
    assert.equal(pvp.ok, true, JSON.stringify(pvp));
    const [n] = nuevos(antes);
    assert.match(n, prefijo);
    assert.equal(estadoVenta(n), "2000000|-|-|-|0", `${quien}: PVP sin modalidad`);
    assert.equal(sql(`select tipo_asesor || '|' || coalesce(aliado_id::text, '-') from public.ventas where numero_contrato = '${n}'`), "interno|-");
  }
});

test("T4 superadmin con la agencia minorista activa: el NETO nace MIN- y en minorista", async () => {
  await entrarComo("super", "minorista");
  const antes = numeros();
  const r = await crearContrato(entradaContrato({ ...NETO, asesorNombre: U.super.nombre }));
  assert.equal(r.ok, true, JSON.stringify(r));
  const [n] = nuevos(antes);
  assert.match(n, /^MIN-/);
  assert.equal(tenantDe(n), "minorista|minorista");
});

test("T5 aislamiento: cada agencia no aplica NETO, no lee ni edita el contrato de la otra", async () => {
  // Un PVP recién creado en cada agencia (dentro de la ventana de 5 min de la RPC).
  await entrarComo("ventaMin");
  let antes = numeros();
  assert.equal((await crearContrato(contratoMin({ modoCompra: "pvp" }))).ok, true);
  const min = nuevos(antes)[0];
  await entrarComo("venta");
  antes = numeros();
  assert.equal((await crearContrato(entradaContrato({ modoCompra: "pvp" }))).ok, true);
  const may = nuevos(antes)[0];

  const rpc = async (quien: Quien, n: string) => (await (await clienteDe(quien)).rpc("aplicar_neto_contrato_manual",
    { p_numero: n, p_aliado_id: 9601, p_comision_esperada: 200_000 })).error?.message ?? "(sin error)";
  assert.match(await rpc("admin", min), /No autorizado para el contrato/, "mayorista no aplica NETO en minorista");
  assert.match(await rpc("adminMin", may), /No autorizado para el contrato/, "minorista no aplica NETO en mayorista");
  assert.equal(estadoVenta(min), "2000000|-|-|-|0");
  assert.equal(estadoVenta(may), "2000000|-|-|-|0");

  // Lectura y escritura por la API: ni la venta ni su comisión de la otra agencia.
  await entrarComo("ventaMin");
  antes = numeros();
  assert.equal((await crearContrato(contratoMin(NETO))).ok, true);
  const minNeto = nuevos(antes)[0];
  const sbMay = await clienteDe("admin");
  assert.deepEqual((await sbMay.from("ventas").select("numero_contrato").eq("numero_contrato", minNeto)).data, []);
  assert.deepEqual((await sbMay.from("aliados_b2b").select("id").eq("numero_contrato", minNeto)).data, []);
  const p = await sbMay.from("ventas").update({ cliente: "Intruso" }).eq("numero_contrato", minNeto).select("numero_contrato");
  assert.ok(p.error || (p.data ?? []).length === 0, "mayorista no edita el contrato de minorista");
  const sbMin = await clienteDe("adminMin");
  assert.deepEqual((await sbMin.from("ventas").select("numero_contrato").eq("numero_contrato", may)).data, []);
  assert.equal((await sbMin.from("ventas").select("numero_contrato").eq("numero_contrato", minNeto)).data?.length, 1, "minorista sí ve el suyo");
  assert.equal(sql(`select cliente from public.ventas where numero_contrato = '${minNeto}'`), "Cliente 206");

  // El NETO de minorista queda tan protegido como el de mayorista.
  const sube = await sbMin.from("ventas").update({ precio_venta: 2_000_000 }).eq("numero_contrato", minNeto);
  assert.match(sube.error?.message ?? "(sin error)", /vendido en NETO/);
  assert.equal(estadoVenta(minNeto), "1800000|neta|200000|descontada|1");
});

test("T6 meta general por agencia: cada una suma SOLO su total exigible NETO", async () => {
  const periodo = sql(`select to_char(current_date, 'YYYY-MM')`);
  const esperado = (t: string) => Number(sql(`select coalesce(sum(precio_venta), 0)::numeric(15,0) from public.ventas
    where tenant = '${t}' and estado in ('confirmado','activo') and to_char(fecha_venta, 'YYYY-MM') = '${periodo}'`));
  const meta = async (quien: Quien, t: string) => {
    const { data, error } = await (await clienteDe(quien)).rpc("fn_dashboard_ventas_mes", { p_tenant: t, p_periodo: periodo });
    assert.equal(error, null);
    return ventasMesPorMonedaDesdeAgregado((data ?? []) as { moneda: string; total: number }[]).COP ?? 0;
  };
  assert.ok(Number(sql(`select count(*) from public.ventas where tenant = 'minorista' and comision_estado = 'descontada'`)) > 0, "hay NETO en minorista");
  assert.equal(await meta("adminMin", "minorista"), esperado("minorista"), "minorista: total exigible de su agencia");
  assert.equal(await meta("admin", "mayorista"), esperado("mayorista"), "mayorista: total exigible de su agencia");
  assert.equal(await meta("adminMin", "mayorista"), 0, "minorista no ve las ventas de mayorista");
  assert.equal(await meta("admin", "minorista"), 0, "mayorista no ve las ventas de minorista");
});

test("T7 estado de cuenta de un NETO de minorista (código real): valor y saldo = total exigible; la otra agencia no lo abre", async () => {
  await entrarComo("ventaMin");
  const antes = numeros();
  assert.equal((await crearContrato(contratoMin(NETO))).ok, true);
  const [n] = nuevos(antes);
  await entrarComo("adminMin");
  const { cargarEstadoCuenta } = await import("../lib/cuenta/estado.ts");
  const ec = await cargarEstadoCuenta(n);
  assert.deepEqual([ec?.precio_venta, ec?.saldo], [1_800_000, 1_800_000]);
  await entrarComo("admin");
  assert.equal(await cargarEstadoCuenta(n), null, "mayorista no abre el estado de cuenta de minorista");
});

// ═══ 9. Aliado en el portal y documentos externos ═════════════════════════
// Decisión del dueño (2026-10-12): el aliado autenticado en el portal ve sus
// contratos B2B de mayorista Y de minorista cuando están enlazados a su ficha
// (`aliado_id`). En minorista el B2B lo monta siempre un asesor interno (sin
// autoservicio). Lo interno —costo, proveedor, margen— nunca le llega; en el
// documento NETO tampoco el PVP ni la comisión.
const COSTO = 1_500_000;
const PROVEEDOR = "Operador 206";
async function netoDe(quien: Quien, extra: Record<string, unknown> = {}, agencia?: "mayorista" | "minorista"): Promise<string> {
  await entrarComo(quien, agencia);
  const antes = numeros();
  const r = await crearContrato(entradaContrato({ ...NETO, asesorNombre: U[quien].nombre, ...extra }));
  assert.equal(r.ok, true, JSON.stringify(r));
  const [n] = nuevos(antes);
  return n;
}
// Prerender completo (espera los límites de Suspense de las páginas reales).
async function html(el: unknown): Promise<string> {
  const { prerenderToNodeStream } = await import("react-dom/static");
  const { prelude } = await prerenderToNodeStream((await el) as never);
  const trozos: Buffer[] = [];
  for await (const trozo of prelude) trozos.push(Buffer.isBuffer(trozo) ? trozo : Buffer.from(String(trozo)));
  return Buffer.concat(trozos).toString("utf8");
}
const filaDe = (crudo: string, n: string) =>
  plano([...crudo.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]).find((tr) => tr.includes(`>${n}<`)) ?? "");
const sinInternos = (texto: string, que: string, extra: number[] = []) => {
  for (const v of [COSTO, 2_000_000 - COSTO, 1_800_000 - COSTO, ...extra]) assert.ok(!texto.includes($(v)), `${que}: no aparece ${$(v)}`);
  assert.ok(!texto.includes(PROVEEDOR), `${que}: no aparece el proveedor`);
  assert.doesNotMatch(texto, /[Mm]argen|[Cc]osto neto/, `${que}: sin margen ni costo`);
};

test("A1 portal del aliado (mayorista) lista su NETO de MINORISTA: total exigible, comisión descontada, nada cobrable ni interno", async () => {
  const n = await netoDe("ventaMin", { aliadoId: 9601 });
  assert.match(n, /^MIN-/);
  await entrarComo("agencia");
  const { default: PortalB2BPage } = await import("../app/portal/b2b/page.tsx");
  const crudo = await html(PortalB2BPage());
  const fila = filaDe(crudo, n);
  assert.ok(fila, `el aliado ve su contrato de minorista ${n}`);
  assert.ok(fila.includes($(1_800_000)), `total y saldo exigibles: ${fila}`);
  assert.ok(!fila.includes($(2_000_000)), `sin PVP original: ${fila}`);
  assert.match(fila, /Neta/);
  assert.match(fila, /Descontada/, "su comisión figura como descontada");
  assert.doesNotMatch(fila, /Cuenta de cobro|Factura electrónica/, "nada que cobrar");
  sinInternos(plano(crudo), "portal");
  const { resolverComisionB2B } = await import("../lib/finanzas/comisionResolver.ts");
  assert.equal(await resolverComisionB2B(n), null, "sin cuenta de cobro");
});

test("A2 estado de cuenta del NETO de minorista abierto por el aliado: total exigible, sin PVP, comisión ni datos internos", async () => {
  const n = await netoDe("ventaMin", { aliadoId: 9601 });
  await entrarComo("agencia");
  const { cargarEstadoCuenta } = await import("../lib/cuenta/estado.ts");
  const ec = await cargarEstadoCuenta(n);
  assert.deepEqual([ec?.precio_venta, ec?.saldo], [1_800_000, 1_800_000]);
  const datos = JSON.stringify(ec);
  assert.doesNotMatch(datos, /costo|proveedor|comision|margen/i, `el estado de cuenta no trae campos internos: ${datos.slice(0, 300)}`);
  const { default: EstadoCuentaPage } = await import("../app/estado-cuenta/[numero]/page.tsx");
  const texto = plano(await html(EstadoCuentaPage({ params: Promise.resolve({ numero: n }) })));
  assert.ok(texto.includes($(1_800_000)), texto.slice(0, 400));
  for (const v of [2_000_000, 200_000]) assert.ok(!texto.includes($(v)), `estado de cuenta: no aparece ${$(v)}`);
  sinInternos(texto, "estado de cuenta");
});

test("A3 el aliado no ve contratos de OTRO aliado (ni portal, ni estado de cuenta, ni cobro, ni API)", async () => {
  const ajeno = await netoDe("venta", { aliadoId: 9603 });
  const ajenoMin = await netoDe("ventaMin", { aliadoId: 9603 });
  await entrarComo("agencia");
  const { default: PortalB2BPage } = await import("../app/portal/b2b/page.tsx");
  const crudo = await html(PortalB2BPage());
  for (const n of [ajeno, ajenoMin]) assert.equal(filaDe(crudo, n), "", `no lista ${n}`);
  const { cargarEstadoCuenta } = await import("../lib/cuenta/estado.ts");
  const { resolverComisionB2B } = await import("../lib/finanzas/comisionResolver.ts");
  for (const n of [ajeno, ajenoMin]) {
    assert.equal(await cargarEstadoCuenta(n), null, `estado de cuenta de ${n}`);
    assert.equal(await resolverComisionB2B(n), null, `cobro de ${n}`);
  }
  const sb = await clienteDe("agencia");
  for (const tabla of ["ventas", "ventas_basica", "contrato_hoteles", "contrato_items", "cuentas_por_pagar", "aliados_b2b", "abonos"] as const) {
    const { data } = await sb.from(tabla as "ventas").select("numero_contrato").in("numero_contrato", [ajeno, ajenoMin]);
    assert.deepEqual(data ?? [], [], `API ${tabla}`);
  }
  // Y el dueño de 9603 sí lo ve (control: el contrato existe y es visible para quien corresponde).
  await entrarComo("agencia2");
  assert.ok(filaDe(await html(PortalB2BPage()), ajenoMin), "el aliado 9603 ve su contrato de minorista");
});

test("A4 por la API el aliado no lee costo, proveedor ni comisión interna de SU propio contrato", async () => {
  const n = await netoDe("ventaMin", { aliadoId: 9601 });
  const sb = await clienteDe("agencia");
  const interno: Record<string, string> = {
    ventas: "costo_hotel, otros_costos", contrato_hoteles: "costo, proveedor", cuentas_por_pagar: "valor_total, proveedor",
  };
  for (const [tabla, cols] of Object.entries(interno)) {
    const { data, error } = await sb.from(tabla as "ventas").select(cols).eq("numero_contrato", n);
    assert.ok(error || (data ?? []).length === 0, `API ${tabla}(${cols}): ${JSON.stringify(data)}`);
  }
});

test("A5 sin autoservicio en minorista: el aliado no crea ni previsualiza contratos, tampoco con la agencia minorista activa", async () => {
  for (const agencia of ["mayorista", "minorista"] as const) {
    await entrarComo("agencia", agencia);
    const antes = numeros();
    const cons = consecutivo();
    const r = await crearContrato(entradaContrato({ ...NETO, asesorNombre: U.agencia.nombre }));
    assert.equal(r.ok, false, agencia);
    const p = await previsualizarNetoContrato({ tipoVenta: "agencia", aliadoId: 9601, precioVenta: 2_000_000, impuesto: 0 });
    assert.equal(p.ok, false, `vista previa ${agencia}`);
    assert.deepEqual(nuevos(antes), []);
    assert.equal(consecutivo(), cons);
  }
});

test("A6 freelance por el camino de la app: % del parámetro (11 %), total exigible en su portal y sin cuenta de cobro", async () => {
  // Plan visto en el formulario = plan aplicado: 2.000.000 × 11 % = 220.000 → 1.780.000.
  await entrarComo("venta");
  const plan = await previsualizarNetoContrato({ tipoVenta: "freelance", aliadoId: 9602, precioVenta: 2_000_000, impuesto: 0 });
  assert.deepEqual(plan, { ok: true, plan: { pct: 0.11, base: 2_000_000, comision: 220_000, pvp: 2_000_000, totalExigible: 1_780_000 } });
  for (const quien of ["venta", "ventaMin"] as const) {
    const n = await netoDe(quien, { tipoVenta: "freelance", aliadoId: 9602, comisionNetoEsperada: 220_000 });
    assert.equal(estadoVenta(n), "1780000|neta|220000|descontada|1");
    assert.equal(sql(`select tipo_aliado || '|' || aplica_retencion from public.aliados_b2b where numero_contrato = '${n}'`), "freelance|true");
    await entrarComo("freelance");
    const { default: PortalB2BPage } = await import("../app/portal/b2b/page.tsx");
    const fila = filaDe(await html(PortalB2BPage()), n);
    assert.ok(fila.includes($(1_780_000)), `${quien}: ${fila}`);
    assert.doesNotMatch(fila, /Cuenta de cobro/, "la comisión ya está descontada: no hay cuenta de cobro");
    const { resolverComisionB2B } = await import("../lib/finanzas/comisionResolver.ts");
    assert.equal(await resolverComisionB2B(n), null);
  }
});

test("A7 vista comercial de un colega (documento imprimible): total exigible; ni PVP, ni comisión, ni costo; sin columnas financieras por la API", async () => {
  const n = await netoDe("venta");
  await entrarComo("colega");
  const { default: Pagina } = await import("../app/contrato/[numero]/page.tsx");
  const texto = plano(await html(Pagina({ params: Promise.resolve({ numero: n }) })));
  assert.ok(texto.includes(`Total del contrato ${$(1_800_000)}`), texto.slice(0, 500));
  for (const v of [2_000_000, 200_000]) assert.ok(!texto.includes($(v)), `vista comercial: no aparece ${$(v)}`);
  sinInternos(texto, "vista comercial");
  const sb = await clienteDe("colega");
  const fila = await sb.from("ventas_basica").select("numero_contrato, precio_venta").eq("numero_contrato", n);
  assert.deepEqual(fila.data?.map((x) => Number(x.precio_venta)), [1_800_000], "el colega ve el total exigible");
  for (const col of ["comision_b2b", "comision_estado", "costo_hotel"]) {
    const r = await sb.from("ventas_basica").select(col).eq("numero_contrato", n);
    assert.ok(r.error, `ventas_basica no expone ${col}`);
  }
  assert.deepEqual((await sb.from("ventas").select("numero_contrato").eq("numero_contrato", n)).data ?? [], [], "venta no lee la tabla base");
});

test("A8 enlace público /c/[token] de un NETO (mayorista y minorista): total exigible; ni PVP, ni comisión, ni costo", async () => {
  const { default: Publico } = await import("../app/c/[token]/page.tsx");
  for (const [quien, extra] of [["venta", {}], ["ventaMin", { aliadoId: 9601 }]] as const) {
    const n = await netoDe(quien, extra);
    const token = sql(`select share_token from public.ventas where numero_contrato = '${n}'`);
    assert.match(token, /^[0-9a-f-]{36}$/);
    await entrarComo(null); // visitante sin sesión
    const texto = plano(await html(Publico({ params: Promise.resolve({ token }) })));
    assert.ok(texto.includes(n) && texto.includes(`Total del contrato ${$(1_800_000)}`), `${n}: ${texto.slice(0, 400)}`);
    for (const v of [2_000_000, 200_000]) assert.ok(!texto.includes($(v)), `/c/: no aparece ${$(v)}`);
    sinInternos(texto, "/c/");
  }
});

// ═══ 10. Contabilidad: abono, factura (asiento) y DIAN de un NETO ═════════
// Saldo por cuenta del tercero = contrato, sumando todos sus asientos.
const saldos = (n: string) => Object.fromEntries(sql(`select c.codigo || '=' || (sum(l.debe) - sum(l.haber))::numeric(15,0)
    from public.asiento_lineas l join public.puc_cuentas c on c.id = l.cuenta_id
   where l.tercero = '${n}' group by c.codigo having sum(l.debe) - sum(l.haber) <> 0 order by 1`).split("\n").filter(Boolean).map((x) => x.split("=")).map(([k, v]) => [k, Number(v)]));

// Filas que la pantalla de Facturación le entrega al formulario (con la sesión activa).
type FilaFact = { numero_contrato: string; precio_venta: number; irtProveedores: number; dianEmitida?: boolean };
async function filasFacturacion(): Promise<FilaFact[]> {
  const { default: FacturacionPage } = await import("../app/(dashboard)/dashboard/contabilidad/facturacion/page.tsx");
  const buscar = (x: unknown): FilaFact[] | null => {
    if (!x || typeof x !== "object") return null;
    const p = (x as { props?: { rows?: unknown; children?: unknown } }).props;
    if (p?.rows) return p.rows as never;
    for (const c of Array.isArray(p?.children) ? (p!.children as unknown[]) : [p?.children]) { const r = buscar(c); if (r) return r; }
    return null;
  };
  return buscar(await FacturacionPage()) ?? [];
}
// El proveedor de hotel del contrato (CxP de 1.500.000 creada por crearContrato)
// se marca como IRT: es lo que la UI toma automáticamente como IRT
// (FacturacionClient: `const irt = row.irtProveedores`).
const marcarHotelIrt = (n: string) => sql(`update public.cuentas_por_pagar set clasificacion = 'irt' where numero_contrato = '${n}' and tipo_proveedor = 'hotel' returning valor_total::numeric(15,0)`);

for (const [quien, adm, tenant] of [["venta", "admin", "mayorista"], ["ventaMin", "adminMin", "minorista"]] as const) {
  test(`K ${tenant}: camino de la UI — abono → anticipo; factura sobre el total exigible con el IRT de proveedores; DIAN; quitar reversa`, async () => {
    // Creado por el asesor `venta` de la agencia (CXP-1 corregido: ya trae sus CxP).
    const n = await netoDe(quien, tenant === "minorista" ? { aliadoId: 9601 } : {});
    assert.equal(marcarHotelIrt(n), "1500000");
    await entrarComo(adm);
    assert.deepEqual(await registrarAbono(n, 500_000, "Efectivo", "K-206"), { ok: true });
    const fila = (await filasFacturacion()).find((x) => x.numero_contrato === n);
    assert.deepEqual([fila?.precio_venta, fila?.irtProveedores], [1_800_000, 1_500_000], "Facturación ofrece total exigible e IRT de proveedores");
    const { guardarFacturacion, marcarDian, quitarFacturacion } = await import("../app/(dashboard)/dashboard/contabilidad/facturacion/actions.ts");
    // Exactamente lo que envía FacturacionClient.guardar().
    assert.deepEqual(await guardarFacturacion({ numeroContrato: n, pvp: fila!.precio_venta, irt: fila!.irtProveedores, ingresoExento: 0 }), { ok: true });
    assert.deepEqual(saldos(n), { "110505": 500_000, "130505": 1_300_000, "281510": -1_500_000, "413505": -300_000, "613505": 1_500_000 },
      "Caja 500.000 · Clientes = total exigible − abono · IRT 1.500.000 · ingreso propio 300.000; el anticipo quedó aplicado; costo de la CxP (CXP-1)");
    assert.equal(sql(`select string_agg(distinct a.tenant, ',') from public.asientos_contables a where a.referencia in ('facturacion:${n}') `), tenant, "asiento en la agencia del contrato");
    assert.equal(sql(`select count(*) from public.asiento_lineas l where l.tercero = '${n}' and (l.debe = 2000000 or l.haber = 2000000 or l.debe = 200000 or l.haber = 200000)`), "0", "ni PVP original ni comisión en el libro");
    // Quitar ANTES de la DIAN: reversa y vuelve a quedar solo el anticipo (y el costo de la CxP).
    assert.deepEqual(await quitarFacturacion(n), { ok: true });
    assert.deepEqual(saldos(n), { "110505": 500_000, "280505": -500_000, "613505": 1_500_000 }, "al quitar la factura vuelve a quedar solo el anticipo (y el costo de la CxP)");
    assert.deepEqual(await guardarFacturacion({ numeroContrato: n, pvp: fila!.precio_venta, irt: fila!.irtProveedores, ingresoExento: 0 }), { ok: true });
    assert.deepEqual(await marcarDian(n, true), { ok: true });
    assert.equal(sql(`select dian_emitida || '|' || (dian_fecha is not null) || '|' || ingreso_propio::numeric(15,0) || '|' || irt::numeric(15,0) from public.contrato_facturacion where numero_contrato = '${n}'`), "true|true|300000|1500000");
    assert.equal((await filasFacturacion()).find((x) => x.numero_contrato === n)?.dianEmitida, true, "pestaña DIAN: emitida");
    // 208 (regla DIAN): una factura emitida a la DIAN no se quita ni se desmarca. NO es una prueba omitida:
    // se afirma el rechazo con su código y que los libros no cambian.
    const sinQuitar = saldos(n);
    const q = await quitarFacturacion(n);
    assert.equal(q.ok, false);
    assert.equal((q as { code?: string }).code, "F4434");
    assert.match(errorDe(q), /ya está emitida a la DIAN; no se quita/);
    const d = await marcarDian(n, false);
    assert.equal((d as { code?: string }).code, "F4434");
    assert.deepEqual(saldos(n), sinQuitar, "tras el rechazo los libros siguen igual");
    assert.deepEqual(sinQuitar, { "110505": 500_000, "130505": 1_300_000, "281510": -1_500_000, "413505": -300_000, "613505": 1_500_000 });
  });
}

// ═══ 11. USD por el camino de la app ══════════════════════════════════════
test("U1 NETO en USD: plan = RPC (redondeo al dólar), margen 6 % en USD, documento y meta en su moneda", async () => {
  const usd = (n: number) => formatMoneda(n, "USD").replace(/\s+/g, " ");
  const pvp = 2_345; // 1 adulto; aliado 10 % → 234,5 → 235 (JS y SQL redondean igual) → total 2.110
  const conCostoUsd = (costo: number) => ({
    moneda: "USD", modoCompra: "neto", comisionNetoEsperada: 235,
    items: [{ descripcion: "Paquete USD", adultos: 1, ninos: 0, tarifaAdulto: pvp, tarifaNino: 0 }],
    hoteles: [{ ...entradaContrato().hoteles[0], costo }],
  });
  await entrarComo("venta");
  const plan = await previsualizarNetoContrato({ tipoVenta: "agencia", aliadoId: 9601, precioVenta: pvp, impuesto: 0 });
  assert.deepEqual(plan, { ok: true, plan: { pct: 0.1, base: 2_345, comision: 235, pvp: 2_345, totalExigible: 2_110 } });
  // (2.110 − 1.984) / 2.110 = 5,97 % < 6 % → no; 1.983 → 6,02 % → sí.
  let antes = numeros();
  const abajo = await crearContrato(entradaContrato(conCostoUsd(1_984)));
  assert.match(errorDe(abajo), /no cubre el margen mínimo del 6%/);
  assert.deepEqual(nuevos(antes), []);
  antes = numeros();
  const r = await crearContrato(entradaContrato(conCostoUsd(1_983)));
  assert.equal(r.ok, true, JSON.stringify(r));
  const [n] = nuevos(antes);
  assert.equal(estadoVenta(n), "2110|neta|235|descontada|1");
  assert.equal(sql(`select moneda || '|' || (select precio_venta::numeric(15,0) || '|' || base_comision::numeric(15,0) from public.aliados_b2b where numero_contrato = '${n}') from public.ventas where numero_contrato = '${n}'`), "USD|2345|2345");
  const { default: Pagina } = await import("../app/contrato/[numero]/page.tsx");
  const texto = plano(await html(Pagina({ params: Promise.resolve({ numero: n }) })));
  assert.ok(texto.includes(`Total del contrato ${usd(2_110)}`), texto.slice(0, 500));
  for (const v of [2_345, 235]) assert.ok(!texto.includes(usd(v)), `documento USD: no aparece ${usd(v)}`);
  const sb = await clienteDe("admin");
  const periodo = sql(`select to_char(current_date, 'YYYY-MM')`);
  const { data } = await sb.rpc("fn_dashboard_ventas_mes", { p_tenant: "mayorista", p_periodo: periodo });
  const porMoneda = ventasMesPorMonedaDesdeAgregado((data ?? []) as { moneda: string; total: number }[]);
  assert.equal(porMoneda.USD, Number(sql(`select sum(precio_venta)::numeric(15,0) from public.ventas where tenant = 'mayorista' and moneda = 'USD' and estado in ('activo','confirmado')`)));
  assert.ok((porMoneda.USD ?? 0) >= 2_110, "la meta en USD suma el total exigible, aparte de COP");
});

// ═══ 12. Gate financiero de facturación (ronda 12: CORRECCIÓN probada) ═════
// Ronda 11 reprodujo los defectos (FACT-1/2 rojas en Postgres real). Ronda 12
// corrige facturacion/actions.ts y lib/contabilidad/asientos.ts; estas pruebas
// afirman el comportamiento ESPERADO y dejan en el diagnóstico antes /
// respuesta / después.
type Foto = { fila: string; asientos: string[]; saldos: Record<string, number> };
function foto(n: string): Foto {
  const lista = (q: string) => sql(q).split("\n").filter(Boolean);
  return {
    fila: sql(`select coalesce((select irt::numeric(15,0) || '|' || ingreso_propio::numeric(15,0) || '|' || ingreso_exento::numeric(15,0) || '|' || coalesce(dian_emitida::text, '-')
                 from public.contrato_facturacion where numero_contrato = '${n}'), '')`),
    asientos: lista(`select a.tenant || '#' || a.numero || ':' || a.origen || ':' || coalesce((select sum(l.debe)::numeric(15,0)::text from public.asiento_lineas l where l.asiento_id = a.id), '0')
                       from public.asientos_contables a where a.referencia = 'facturacion:${n}' order by a.id`),
    saldos: Object.fromEntries(lista(`select l.tenant || ':' || c.codigo || '=' || (sum(l.debe) - sum(l.haber))::numeric(15,0)
        from public.asiento_lineas l join public.puc_cuentas c on c.id = l.cuenta_id where l.tercero = '${n}'
       group by l.tenant, c.codigo having sum(l.debe) - sum(l.haber) <> 0 order by 1`).map((x) => x.split("=")).map(([k, v]) => [k, Number(v)])),
  };
}
const reportar = (t: { diagnostic: (m: string) => void }, paso: string, valor: unknown) => t.diagnostic(`${paso}: ${JSON.stringify(valor)}`);
const facturacion = () => import("../app/(dashboard)/dashboard/contabilidad/facturacion/actions.ts");
// Factura del NETO (Clientes = total exigible, IRT de proveedores, ingreso
// propio) + el costo de la CxP del hotel (613505), que el contrato ya trae (CXP-1).
const COSTO_MAY = { "mayorista:613505": 1_500_000 };
const FACTURA_MAY = { "mayorista:130505": 1_800_000, "mayorista:281510": -1_500_000, "mayorista:413505": -300_000, ...COSTO_MAY };

test("FACT-1 llamada directa autorizada con importes manipulados: se rechaza sin escribir; con los del sistema factura el total exigible NETO", async (t) => {
  const n = await netoDe("venta");
  assert.equal(marcarHotelIrt(n), "1500000");
  await entrarComo("admin");
  const { guardarFacturacion } = await facturacion();
  const antes = foto(n);
  const casos = [
    { pvp: 2_000_000, irt: 900_000 },   // PVP original + IRT inventado
    { pvp: 2_000_000, irt: 1_500_000 }, // solo el PVP original (el NETO es 1.800.000)
    { pvp: 1_800_000, irt: 900_000 },   // solo el IRT distinto al de proveedores
  ];
  for (const c of casos) {
    const r = await guardarFacturacion({ numeroContrato: n, ...c, ingresoExento: 0 });
    reportar(t, `respuesta ${JSON.stringify(c)}`, r);
    assert.equal(r.ok, false, JSON.stringify(c));
    assert.match(errorDe(r), /no coinciden con los del sistema/);
    assert.deepEqual(foto(n), antes, `sin escribir nada (${JSON.stringify(c)})`);
  }
  const ok = await guardarFacturacion({ numeroContrato: n, pvp: 1_800_000, irt: 1_500_000, ingresoExento: 0 });
  assert.deepEqual(ok, { ok: true });
  const despues = foto(n);
  reportar(t, "después (valores del sistema)", despues);
  assert.deepEqual(despues.saldos, FACTURA_MAY, "Clientes = total exigible NETO; IRT de proveedores; ingreso propio 300.000");
  assert.equal(despues.fila, "1500000|300000|0|false");
});

test("FACT-1 USD: el servidor convierte con la TRM (trm_referencia) igual que la pantalla; el PVP original convertido se rechaza", async (t) => {
  const pvpUsd = 2_345; // aliado 10 % → 235 → total 2.110 USD
  const n = await netoDe("venta", {
    moneda: "USD", comisionNetoEsperada: 235,
    items: [{ descripcion: "Paquete USD", adultos: 1, ninos: 0, tarifaAdulto: pvpUsd, tarifaNino: 0 }],
    hoteles: [{ ...entradaContrato().hoteles[0], costo: 1_500 }],
  });
  assert.equal(marcarHotelIrt(n), "1500");
  const trm = Number(sql(`select valor from public.parametros_tributarios where parametro = 'trm_referencia'`));
  await entrarComo("admin");
  const fila = (await filasFacturacion()).find((x) => x.numero_contrato === n)!;
  reportar(t, "fila de Facturación", { fila, trm });
  assert.deepEqual([fila.precio_venta, fila.irtProveedores], [2_110 * trm, 1_500 * trm]);
  const { guardarFacturacion } = await facturacion();
  const malo = await guardarFacturacion({ numeroContrato: n, pvp: pvpUsd * trm, irt: fila.irtProveedores, ingresoExento: 0 });
  assert.equal(malo.ok, false, "el PVP original convertido no pasa");
  assert.deepEqual(await guardarFacturacion({ numeroContrato: n, pvp: fila.precio_venta, irt: fila.irtProveedores, ingresoExento: 0 }), { ok: true });
  // El asiento de la CxP en USD queda en dólares sin convertir (limitación
  // conocida de los posteos automáticos, CLAUDE.md): 1.500 en 613505.
  assert.deepEqual(foto(n).saldos, { "mayorista:130505": 2_110 * trm, "mayorista:281510": -1_500 * trm, "mayorista:413505": -610 * trm, "mayorista:613505": 1_500 });
});

test("FACT-2 entre agencias: Mayorista activa no factura, no marca DIAN ni quita la factura de un contrato de Minorista; en su agencia sí, sin duplicar", async (t) => {
  const n = await netoDe("ventaMin", { aliadoId: 9601 });
  assert.equal(marcarHotelIrt(n), "1500000");
  const { guardarFacturacion, quitarFacturacion, marcarDian } = await facturacion();
  await entrarComo("adminMin");
  assert.deepEqual(await registrarAbono(n, 500_000, "Efectivo", "FACT-2"), { ok: true });
  assert.deepEqual(await guardarFacturacion({ numeroContrato: n, pvp: 1_800_000, irt: 1_500_000, ingresoExento: 0 }), { ok: true });
  const antes = foto(n);
  reportar(t, "antes (facturado por administración de minorista)", antes);
  assert.deepEqual(antes.saldos, { "minorista:110505": 500_000, "minorista:130505": 1_300_000, "minorista:281510": -1_500_000, "minorista:413505": -300_000, "minorista:613505": 1_500_000 });

  await entrarComo("super", "mayorista");
  const g = await guardarFacturacion({ numeroContrato: n, pvp: 1_800_000, irt: 1_500_000, ingresoExento: 0 });
  const d = await marcarDian(n, true);
  const q = await quitarFacturacion(n);
  reportar(t, "respuestas con Mayorista activa", { g, d, q });
  for (const r of [g, d, q]) assert.match(errorDe(r), /es de la agencia minorista; cambia a esa agencia/);
  assert.deepEqual(foto(n), antes, "nada cambió: ni configuración, ni asientos, ni saldos");

  await entrarComo("super", "minorista");
  assert.deepEqual(await guardarFacturacion({ numeroContrato: n, pvp: 1_800_000, irt: 1_500_000, ingresoExento: 0 }), { ok: true });
  const re = foto(n);
  reportar(t, "re-facturado con Minorista activa", re);
  assert.deepEqual(re.saldos, antes.saldos, "reversa + nueva, con el anticipo aplicado: mismos saldos");
  assert.ok(re.asientos.every((a) => a.startsWith("minorista")), "todo en los libros de minorista");
  assert.deepEqual(await quitarFacturacion(n), { ok: true });
  assert.deepEqual(foto(n).saldos, { "minorista:110505": 500_000, "minorista:280505": -500_000, "minorista:613505": 1_500_000 }, "queda solo el anticipo (y el costo de la CxP)");

  // Un asiento de factura VIGENTE en la otra agencia (como los que dejaba el
  // defecto) bloquea re-facturar hasta corregirlo a mano.
  // 208: las guardas de la base rechazan un asiento de factura fuera de la RPC (F4440), así que la
  // preparación —reproducir el residuo que dejaba el defecto FACT-2— se hace sin disparadores.
  sql(`set session_replication_role = replica;
       insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia)
       values ('mayorista', 990206, current_date, 'Simulación ronda 11', 'facturacion', 'facturacion:${n}')`);
  try {
    await entrarComo("adminMin");
    const bloq = await guardarFacturacion({ numeroContrato: n, pvp: 1_800_000, irt: 1_500_000, ingresoExento: 0 });
    reportar(t, "con asiento vigente en mayorista", bloq);
    assert.match(errorDe(bloq), /asiento de factura vigente en la agencia mayorista/);
  } finally {
    sql(`set session_replication_role = replica;
         delete from public.asientos_contables where numero = 990206 and tenant = 'mayorista' and referencia = 'facturacion:${n}'`);
  }
});

test("FACT-3 el asiento nuevo no se puede postear (cuenta IRT ausente): ok:false, libros y configuración como estaban", async (t) => {
  const n = await netoDe("venta");
  assert.equal(marcarHotelIrt(n), "1500000");
  await entrarComo("admin");
  const { guardarFacturacion } = await facturacion();
  assert.deepEqual(await guardarFacturacion({ numeroContrato: n, pvp: 1_800_000, irt: 1_500_000, ingresoExento: 0 }), { ok: true });
  const antes = foto(n);
  sql(`update public.puc_cuentas set codigo = '281510-t206' where tenant = 'mayorista' and codigo = '281510'`);
  let r: unknown;
  try {
    r = await guardarFacturacion({ numeroContrato: n, pvp: 1_800_000, irt: 1_500_000, ingresoExento: 100_000, tipoExento: "exento" });
  } finally {
    sql(`update public.puc_cuentas set codigo = '281510' where tenant = 'mayorista' and codigo = '281510-t206'`);
  }
  const despues: Foto = foto(n);
  reportar(t, "antes", antes); reportar(t, "respuesta", r); reportar(t, "después", despues);
  assert.equal((r as { ok: boolean }).ok, false);
  assert.match(errorDe(r), /Falta la cuenta 281510.*La configuración quedó como estaba/);
  assert.deepEqual(despues.saldos, antes.saldos, "los libros conservan la factura vigente");
  assert.equal(despues.fila, antes.fila, "la configuración (exento) no cambió");
  assert.equal(despues.asientos.length, antes.asientos.length, "la reversa intermedia se deshizo");
});

test("FACT-4 la reversa no se puede insertar: guardar y quitar fallan cerrado (sin duplicar la factura ni perder la configuración)", async (t) => {
  const n = await netoDe("venta");
  assert.equal(marcarHotelIrt(n), "1500000");
  await entrarComo("admin");
  const { guardarFacturacion, quitarFacturacion } = await facturacion();
  assert.deepEqual(await guardarFacturacion({ numeroContrato: n, pvp: 1_800_000, irt: 1_500_000, ingresoExento: 0 }), { ok: true });
  const antes = foto(n);
  sql(`create or replace function public.t206_sin_reversa() returns trigger language plpgsql as $$
         begin if new.origen like '%\\_reversion' and new.referencia = 'facturacion:${n}' then raise exception 'reversa bloqueada t206'; end if; return new; end $$;
       create trigger t206_sin_reversa before insert on public.asientos_contables for each row execute function public.t206_sin_reversa();`);
  let r: unknown, q: unknown;
  let trasGuardar: Foto, trasQuitar: Foto;
  try {
    r = await guardarFacturacion({ numeroContrato: n, pvp: 1_800_000, irt: 1_500_000, ingresoExento: 50_000, tipoExento: "exento" });
    trasGuardar = foto(n);
    q = await quitarFacturacion(n);
    trasQuitar = foto(n);
  } finally {
    sql(`drop trigger t206_sin_reversa on public.asientos_contables; drop function public.t206_sin_reversa();`);
  }
  reportar(t, "antes", antes); reportar(t, "respuesta guardar", r); reportar(t, "después de guardar", trasGuardar!);
  reportar(t, "respuesta quitar", q); reportar(t, "después de quitar", trasQuitar!);
  assert.equal((r as { ok: boolean }).ok, false);
  assert.match(errorDe(r), /reversa bloqueada t206/);
  assert.deepEqual(trasGuardar!, antes, "guardar: ni factura duplicada ni configuración cambiada");
  assert.equal((q as { ok: boolean }).ok, false);
  assert.deepEqual(trasQuitar!, antes, "quitar: la configuración y la factura siguen");
});

test("FACT-5 guardar → quitar → guardar: una sola factura vigente (antes se reversaba dos veces el mismo asiento)", async (t) => {
  const n = await netoDe("venta");
  assert.equal(marcarHotelIrt(n), "1500000");
  await entrarComo("admin");
  const { guardarFacturacion, quitarFacturacion } = await facturacion();
  const v = { numeroContrato: n, pvp: 1_800_000, irt: 1_500_000, ingresoExento: 0 };
  assert.deepEqual(await guardarFacturacion(v), { ok: true });
  assert.deepEqual(await quitarFacturacion(n), { ok: true });
  assert.deepEqual(foto(n).saldos, COSTO_MAY, "sin factura: solo el costo de la CxP");
  assert.deepEqual(await guardarFacturacion(v), { ok: true });
  assert.deepEqual(await guardarFacturacion(v), { ok: true }); // re-guardar: reversa + nueva
  const f = foto(n);
  reportar(t, "después", f);
  assert.deepEqual(f.saldos, FACTURA_MAY);
  assert.equal(f.asientos.filter((a) => a.includes(":facturacion:")).length - f.asientos.filter((a) => a.includes(":facturacion_reversion:")).length, 1, "exactamente una vigente");
});

test("FACT-6 roles: venta, operaciones, agencia, inactivo y sin sesión no facturan ni quitan (ni por llamada directa)", async () => {
  const n = await netoDe("venta");
  assert.equal(marcarHotelIrt(n), "1500000");
  const { guardarFacturacion, quitarFacturacion, marcarDian } = await facturacion();
  const antes = foto(n);
  for (const quien of ["venta", "ops", "agencia", "inactivo", null] as const) {
    await entrarComo(quien);
    for (const r of [await guardarFacturacion({ numeroContrato: n, pvp: 1_800_000, irt: 1_500_000, ingresoExento: 0 }), await marcarDian(n, true), await quitarFacturacion(n)]) {
      assert.equal(r.ok, false, String(quien));
    }
  }
  assert.deepEqual(foto(n), antes);
});

// ═══ 13. CxP del contrato manual (CXP-1: corrección probada) ═══════════════
const cxpDe = (n: string) => sql(`select count(*) || '|' || coalesce(sum(valor_total)::numeric(15,0)::text, '0') || '|' ||
  coalesce(bool_and(observaciones like public.marca_cxp_automatica() || '%')::text, '-') from public.cuentas_por_pagar where numero_contrato = '${n}'`);
const finDe = (n: string) => sql(`select financiero_estado || '|' || (select count(*) from public.contrato_financiero_pendiente p where p.numero_contrato = v.numero_contrato)
  || '|' || (select count(*) from public.asientos_contables a join public.cuentas_por_pagar c on a.referencia = 'cxp:' || c.id and a.tenant = v.tenant where c.numero_contrato = v.numero_contrato)
  from public.ventas v where v.numero_contrato = '${n}'`);

test("CXP-1 todos los roles internos, PVP y NETO, en las dos agencias: CxP del hotel, costo, estado financiero completo y su asiento", async (t) => {
  const casos: Record<string, string> = {};
  const combinaciones: Array<[Quien, "pvp" | "neto", Record<string, unknown>]> = [
    ["venta", "pvp", {}], ["venta", "neto", {}], ["admin", "pvp", {}], ["admin", "neto", {}], ["ops", "neto", {}],
    ["gerencia", "neto", {}], ["super", "neto", {}], ["ventaMin", "pvp", {}], ["ventaMin", "neto", {}], ["adminMin", "neto", {}],
  ];
  for (const [quien, modo, extra] of combinaciones) {
    await entrarComo(quien);
    const antes = numeros();
    const r = await crearContrato(entradaContrato({ asesorNombre: U[quien].nombre, ...(modo === "neto" ? NETO : { modoCompra: "pvp" }), ...extra }));
    assert.equal(r.ok, true, `${quien}/${modo}: ${JSON.stringify(r)}`);
    const [n] = nuevos(antes);
    casos[`${quien}/${modo}`] = `${cxpDe(n)} · ${finDe(n)} · costo_hotel=${sql(`select costo_hotel::numeric(15,0) from public.ventas where numero_contrato = '${n}'`)}`;
  }
  reportar(t, "CxP (cantidad|valor|automática) · financiero (estado|pendientes|asientos CxP)", casos);
  for (const [k, v] of Object.entries(casos)) assert.equal(v, "1|1500000|true · completo|0|1 · costo_hotel=1500000", k);
});

test("CXP-2 la escritura de CxP falla: el contrato NO queda (ni CxP, ni comisión, ni intención pendiente); el reintento crea uno sin duplicados", async (t) => {
  await entrarComo("venta");
  sql(`create or replace function public.t206_sin_cxp() returns trigger language plpgsql as $$ begin raise exception 'cxp bloqueada t206'; end $$;
       create trigger t206_sin_cxp before insert on public.cuentas_por_pagar for each row execute function public.t206_sin_cxp();`);
  const antes = numeros();
  const restos = () => sql(`select (select count(*) from public.cuentas_por_pagar c where not exists (select 1 from public.ventas v where v.numero_contrato = c.numero_contrato)) || '|' ||
    (select count(*) from public.aliados_b2b b where not exists (select 1 from public.ventas v where v.numero_contrato = b.numero_contrato)) || '|' ||
    (select count(*) from public.contrato_financiero_pendiente p where not exists (select 1 from public.ventas v where v.numero_contrato = p.numero_contrato))`);
  let rNeto: unknown, rPvp: unknown;
  try {
    rNeto = await crearContrato(entradaContrato(NETO));
    rPvp = await crearContrato(entradaContrato({ modoCompra: "pvp" }));
  } finally {
    sql(`drop trigger t206_sin_cxp on public.cuentas_por_pagar; drop function public.t206_sin_cxp();`);
  }
  reportar(t, "respuestas", { rNeto, rPvp });
  for (const r of [rNeto, rPvp]) assert.match(errorDe(r), /No se pudo registrar el costo ni las cuentas por pagar del contrato, así que no se generó: .*cxp bloqueada t206/);
  assert.deepEqual(nuevos(antes), [], "ningún contrato quedó");
  assert.equal(restos(), "0|0|0", "sin CxP, comisión ni intención huérfanas");
  const r = await crearContrato(entradaContrato(NETO));
  assert.equal(r.ok, true, JSON.stringify(r));
  const [n] = nuevos(antes);
  assert.equal(cxpDe(n), "1|1500000|true");
  assert.equal(estadoVenta(n), "1800000|neta|200000|descontada|1");
});

test("CXP-3 falla la CxP Y la reversa: queda 'pendiente' y NO cobrable; la reconciliación lo completa sin duplicar (reintento idempotente)", async (t) => {
  await entrarComo("venta");
  sql(`create or replace function public.t206_sin_cxp() returns trigger language plpgsql as $$ begin raise exception 'cxp bloqueada t206'; end $$;
       create trigger t206_sin_cxp before insert on public.cuentas_por_pagar for each row execute function public.t206_sin_cxp();
       create or replace function public.t206_no_borrar() returns trigger language plpgsql as $$ begin raise exception 'reversión bloqueada t206'; end $$;
       create trigger t206_no_borrar before delete on public.ventas for each row execute function public.t206_no_borrar();`);
  const antes = numeros();
  let r: unknown;
  try {
    r = await crearContrato(entradaContrato(NETO));
  } finally {
    sql(`drop trigger t206_sin_cxp on public.cuentas_por_pagar; drop function public.t206_sin_cxp();
         drop trigger t206_no_borrar on public.ventas; drop function public.t206_no_borrar();`);
  }
  const [n] = nuevos(antes);
  reportar(t, "respuesta", r); reportar(t, "estado", { n, fin: finDe(n), cxp: cxpDe(n) });
  assert.ok(n, "el contrato quedó vivo (no se pudo revertir)");
  assert.match(errorDe(r), new RegExp(`tampoco se pudo deshacer el contrato ${n} automáticamente`));
  assert.equal(finDe(n), "pendiente|1|0", "pendiente, con su intención durable y sin CxP");
  await entrarComo("admin");
  assert.equal((await registrarAbono(n, 100_000, "Efectivo", "CXP-3")).ok, false, "no admite abonos");
  // Reconciliación: el mismo payload persistido, dos veces (reintento).
  for (let i = 0; i < 2; i++) {
    sql(`select public.registrar_financiero_contrato(p.numero_contrato, p.tenant, p.costos, p.cxp)
           from public.contrato_financiero_pendiente p where p.numero_contrato = '${n}'
         union all select public.registrar_financiero_contrato('${n}', v.tenant, '{}'::jsonb,
           (select jsonb_agg(jsonb_build_object('proveedor', proveedor, 'tipo_proveedor', tipo_proveedor, 'servicio', servicio, 'valor_total', valor_total,
              'moneda', moneda, 'fecha_obligacion', fecha_obligacion, 'observaciones', observaciones)) from public.cuentas_por_pagar where numero_contrato = '${n}'))
           from public.ventas v where v.numero_contrato = '${n}' and ${i} = 1`);
  }
  assert.equal(cxpDe(n), "1|1500000|true", "una sola CxP tras dos reintentos");
  assert.equal(finDe(n).split("|").slice(0, 2).join("|"), "completo|0");
  assert.deepEqual(await registrarAbono(n, 100_000, "Efectivo", "CXP-3"), { ok: true }, "ya es cobrable");
});

test("CXP-4 el asiento de la CxP falla (cuenta de costo ausente): el dinero queda completo (CxP y costo) y el contrato se crea; falta solo el asiento", async (t) => {
  await entrarComo("venta");
  const antes = numeros();
  sql(`update public.puc_cuentas set codigo = '613505-t206' where tenant = 'mayorista' and codigo = '613505'`);
  let r: unknown;
  try {
    r = await crearContrato(entradaContrato(NETO));
  } finally {
    sql(`update public.puc_cuentas set codigo = '613505' where tenant = 'mayorista' and codigo = '613505-t206'`);
  }
  const [n] = nuevos(antes);
  reportar(t, "respuesta", r); reportar(t, "estado", { fin: finDe(n), cxp: cxpDe(n) });
  assert.equal((r as { ok: boolean }).ok, true);
  assert.equal(cxpDe(n), "1|1500000|true");
  assert.equal(finDe(n), "completo|0|0", "completo, sin asiento de CxP (lo postea la reconciliación)");
});

// ═══ 14. Portal: el aliado ve solo el valor y estado de SU comisión ═══════
// Decisión del dueño (2026-10-12): PVP → lo pendiente por cobrar; NETO → lo
// descontado del precio, sin segundo saldo ni cuenta por cobrar. Aislamiento
// entre aliados y agencias, incluida la consulta desde Mayorista de su
// contrato asistido de Minorista.
async function filaPortal(quien: Quien, n: string): Promise<string> {
  await entrarComo(quien);
  const { default: PortalB2BPage } = await import("../app/portal/b2b/page.tsx");
  return filaDe(await html(PortalB2BPage()), n);
}
async function registrarComision(quien: Quien, n: string, aliadoId: number) {
  const sb = await clienteDe(quien);
  const a = aliadoId === 9601 ? ["T206 Agencia", "9606"] : ["T206 Agencia Dos", "9608"];
  const { data, error } = await sb.rpc("registrar_comision_b2b_manual", {
    p_numero: n, p_aliado: a[0], p_nit: a[1], p_tipo_aliado: "agencia", p_aliado_id: aliadoId,
    p_pct: 0.10, p_recobro: 0, p_pct_recobro: 0, p_aplica_retencion: false, p_pct_retencion: 0,
  });
  return { data, error: error?.message ?? null };
}

test("PORT-1 PVP en mayorista: sin comisión no hay valor; registrada, el aliado ve su valor y estado; tras un abono, lo pendiente por cobrar", async (t) => {
  await entrarComo("venta");
  const antes = numeros();
  assert.equal((await crearContrato(entradaContrato({ modoCompra: "pvp" }))).ok, true);
  const [n] = nuevos(antes);
  const f0 = await filaPortal("agencia", n);
  reportar(t, "sin comisión registrada", f0);
  assert.ok(f0.includes($(2_000_000)), "el contrato PVP se ve con su total");
  assert.ok(!f0.includes($(200_000)), "sin comisión 'Por definir' no se muestra ningún valor");
  const reg = await registrarComision("admin", n, 9601);
  assert.equal(reg.error, null, JSON.stringify(reg));
  const f1 = await filaPortal("agencia", n);
  reportar(t, "registrada (200.000)", f1);
  assert.ok(f1.includes($(200_000)) && /Pendiente/.test(f1), f1);
  const id = Number(sql(`select id from public.aliados_b2b where numero_contrato = '${n}' and aliado_id = 9601`));
  await entrarComo("admin");
  const { registrarPagoComisionB2B } = await import("../app/(dashboard)/dashboard/comisiones/actions.ts");
  const pago = await registrarPagoComisionB2B(id, 50_000, sql(`select current_date`));
  assert.equal(pago.ok, true, JSON.stringify(pago));
  const f2 = await filaPortal("agencia", n);
  reportar(t, "tras abono de 50.000", f2);
  assert.match(f2, /Abono parcial/);
  assert.ok(f2.includes($(150_000)), `decisión del dueño: lo pendiente por cobrar (150.000) — fila: ${f2}`);
});

test("PORT-2 dos comisiones en un contrato: cada aliado ve solo la suya; la vista externa no revela la ajena", async (t) => {
  await entrarComo("venta");
  const antes = numeros();
  assert.equal((await crearContrato(entradaContrato({ modoCompra: "pvp" }))).ok, true);
  const [n] = nuevos(antes);
  const r1 = await registrarComision("admin", n, 9601);
  const r2 = await registrarComision("admin", n, 9603);
  reportar(t, "registro", { r1, r2 });
  assert.equal(r1.error, null);
  if (r2.error) { t.diagnostic(`la segunda comisión no se pudo registrar (${r2.error}); el caso no aplica`); return; }
  // La de 9603 con otro valor para distinguirla.
  sql(`update public.aliados_b2b set comision_valor = 123000 where numero_contrato = '${n}' and aliado_id = 9603`);
  const f1 = await filaPortal("agencia", n);
  const f2 = await filaPortal("agencia2", n);
  reportar(t, "filas", { agencia: f1, agencia2: f2 });
  assert.ok(f1.includes($(200_000)) && !f1.includes($(123_000)), `9601 ve solo la suya: ${f1}`);
  assert.ok(!f2.includes($(200_000)), `9603 no ve la de 9601: ${f2}`);
});

test("PORT-3 Minorista asistido desde el portal de Mayorista: el aliado ve su comisión (PVP pendiente / NETO descontada) y otro aliado no ve nada", async (t) => {
  await entrarComo("ventaMin");
  let antes = numeros();
  assert.equal((await crearContrato(entradaContrato({ asesorNombre: U.ventaMin.nombre, modoCompra: "pvp" }))).ok, true);
  const pvp = nuevos(antes)[0];
  assert.equal((await registrarComision("adminMin", pvp, 9601)).error, null);
  antes = numeros();
  assert.equal((await crearContrato(entradaContrato({ asesorNombre: U.ventaMin.nombre, ...NETO }))).ok, true);
  const neto = nuevos(antes)[0];
  const fp = await filaPortal("agencia", pvp);
  const fn = await filaPortal("agencia", neto);
  reportar(t, "agencia (mayorista) ve", { pvp: fp, neto: fn });
  assert.ok(fp.includes($(2_000_000)) && fp.includes($(200_000)) && /Pendiente/.test(fp), fp);
  assert.ok(fn.includes($(1_800_000)) && /Descontada/.test(fn) && !/Cuenta de cobro|Factura electrónica/.test(fn), fn);
  for (const n of [pvp, neto]) assert.equal(await filaPortal("agencia2", n), "", `9603 no ve ${n}`);
});

// ═══ 15. Carrera y fallo de compensación en facturación ═══════════════════
// Ronda 13 las reprodujo ROJAS (varias llamadas sueltas por PostgREST, sin
// transacción ni bloqueo). Con la migración 208 (RPC atómicas) PASAN y ya no van
// marcadas `todo`: si vuelven a fallar, es una regresión real. Requieren la 208
// aplicada (test_206_app_rpc.sh solo aplica 001–206; usa el runner de la 208).
// Invariantes de consistencia de UNA factura: a lo sumo una vigente; ningún
// asiento sin líneas (un encabezado vacío cuenta como reversa y falsea el
// estado); la configuración existe si y solo si hay factura vigente.
function invariantes(n: string): { vigentes: number; vacios: number; configuracion: boolean } {
  const [v, vacios, cfg] = sql(`select
      (select count(*) filter (where origen = 'facturacion') - count(*) filter (where origen = 'facturacion_reversion')
         from public.asientos_contables where referencia = 'facturacion:${n}') || '|' ||
      (select count(*) from public.asientos_contables a where a.referencia = 'facturacion:${n}'
         and not exists (select 1 from public.asiento_lineas l where l.asiento_id = a.id)) || '|' ||
      (select count(*) from public.contrato_facturacion where numero_contrato = '${n}')`).split("|").map(Number);
  return { vigentes: v, vacios, configuracion: cfg === 1 };
}

test("RACE-1 dos guardados SIMULTÁNEOS de la misma factura: una sola factura vigente", async (t) => {
  const n = await netoDe("venta");
  assert.equal(marcarHotelIrt(n), "1500000");
  await entrarComo("admin");
  const { guardarFacturacion } = await facturacion();
  // Determinista: el primer INSERT de asiento de esta factura espera 1 s, así
  // la segunda llamada lee el libro (sin factura vigente) antes de que la
  // primera escriba — la ventana real que existe en producción, ensanchada.
  sql(`create or replace function public.t206_lento() returns trigger language plpgsql as $$
         begin if new.referencia = 'facturacion:${n}' and new.origen = 'facturacion' then perform pg_sleep(1); end if; return new; end $$;
       create trigger t206_lento before insert on public.asientos_contables for each row execute function public.t206_lento();`);
  let rs: unknown[];
  try {
    const v = { numeroContrato: n, pvp: 1_800_000, irt: 1_500_000, ingresoExento: 0 };
    rs = await Promise.all([guardarFacturacion(v), guardarFacturacion(v)]);
  } finally {
    sql(`drop trigger t206_lento on public.asientos_contables; drop function public.t206_lento();`);
  }
  const f = foto(n);
  reportar(t, "respuestas", rs); reportar(t, "después", f);
  const vigentes = f.asientos.filter((a) => a.includes(":facturacion:")).length - f.asientos.filter((a) => a.includes(":facturacion_reversion:")).length;
  assert.equal(vigentes, 1, `facturas vigentes: ${vigentes}; asientos ${JSON.stringify(f.asientos)}`);
  assert.deepEqual(f.saldos, FACTURA_MAY, `saldos: ${JSON.stringify(f.saldos)}`);
  const inv = invariantes(n);
  reportar(t, "invariantes", inv);
  assert.deepEqual(inv, { vigentes: 1, vacios: 0, configuracion: true }, `libros y configuración no coinciden: ${JSON.stringify(inv)}`);
  assert.equal(f.fila, "1500000|300000|0|false", "la configuración de la factura vigente existe");
});

test("COMP-1 falla el asiento nuevo Y falla deshacer la reversa: libros y configuración deben quedar consistentes", async (t) => {
  const n = await netoDe("venta");
  assert.equal(marcarHotelIrt(n), "1500000");
  await entrarComo("admin");
  const { guardarFacturacion } = await facturacion();
  assert.deepEqual(await guardarFacturacion({ numeroContrato: n, pvp: 1_800_000, irt: 1_500_000, ingresoExento: 0 }), { ok: true });
  const antes = foto(n);
  // Fallo del asiento nuevo (cuenta IRT ausente) + fallo de la compensación
  // (no se puede borrar la reversa recién creada).
  sql(`update public.puc_cuentas set codigo = '281510-t206' where tenant = 'mayorista' and codigo = '281510';
       create or replace function public.t206_sin_borrar() returns trigger language plpgsql as $$
         begin if old.referencia = 'facturacion:${n}' then raise exception 'borrado bloqueado t206'; end if; return old; end $$;
       create trigger t206_sin_borrar before delete on public.asientos_contables for each row execute function public.t206_sin_borrar();`);
  let r: unknown;
  try {
    r = await guardarFacturacion({ numeroContrato: n, pvp: 1_800_000, irt: 1_500_000, ingresoExento: 100_000, tipoExento: "exento" });
  } finally {
    sql(`drop trigger t206_sin_borrar on public.asientos_contables; drop function public.t206_sin_borrar();
         update public.puc_cuentas set codigo = '281510' where tenant = 'mayorista' and codigo = '281510-t206';`);
  }
  const despues = foto(n);
  reportar(t, "antes", antes); reportar(t, "respuesta", r); reportar(t, "después", despues);
  assert.equal((r as { ok: boolean }).ok, false, "nunca éxito");
  assert.deepEqual(despues.saldos, antes.saldos, `los libros perdieron la factura vigente: ${JSON.stringify(despues.saldos)}`);
  assert.equal(despues.fila, antes.fila, "configuración restaurada");
  const inv = invariantes(n);
  reportar(t, "invariantes", inv);
  assert.deepEqual(inv, { vigentes: 1, vacios: 0, configuracion: true }, `estado contable falseado: ${JSON.stringify(inv)}`);
});

async function abonosParaPantalla(marca: string) {
  const numero = await netoDe("venta");
  await entrarComo("admin");
  assert.deepEqual(await registrarAbono(numero, 120_000, "Efectivo", `${marca}-contable`), { ok: true });
  const contabilizado = Number(sql(`select id from public.abonos where numero_contrato = '${numero}' and referencia = '${marca}-contable'`));
  const sinAsiento = Number(sql(`insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago, referencia)
    values ('${numero}', 'mayorista', 80000, 80000, 1, current_date, 'Efectivo', '${marca}-sin-asiento') returning id`));
  assert.equal(sql(`select count(*) from public.asientos_contables where referencia = 'abono:${contabilizado}'`), "1");
  assert.equal(sql(`select count(*) from public.asientos_contables where referencia = 'abono:${sinAsiento}'`), "0");
  const abonos = [
    { id: contabilizado, valor_abono: 120_000, forma_pago: "Efectivo", referencia: `${marca}-contable`, fecha_abono: "2026-10-14", trm: 1, monto_cop: 120_000 },
    { id: sinAsiento, valor_abono: 80_000, forma_pago: "Efectivo", referencia: `${marca}-sin-asiento`, fecha_abono: "2026-10-14", trm: 1, monto_cop: 80_000 },
  ];
  return { numero, contabilizado, sinAsiento, abonos };
}

function filaRecibo(raiz: Element, id: number) {
  const fila = raiz.querySelector(`a[href="/recibo/${id}"]`)?.closest("tr");
  assert.ok(fila, `fila del abono ${id}`);
  return fila;
}

// 248: «Eliminar» ya no existe; se ANULA con motivo (asiento retirado + huella). Trayecto real: clic → diálogo → motivo → confirmar.
async function anularDesdePantalla(raiz: Element, id: number, motivo: string) {
  // El diálogo anterior sigue en el DOM mientras sale: sin esperar a que se vaya, el clic caería en su botón (flaky).
  assert.ok(await esperarHasta(() => !dom.window.document.querySelector('[role="dialog"], [role="alertdialog"]')), "quedó un diálogo abierto");
  await clic(botonConTexto(filaRecibo(raiz, id), /^Anular$/), `Anular abono ${id}`);
  const campo = dom.window.document.querySelector<HTMLInputElement>('[role="dialog"] input, [role="alertdialog"] input');
  await escribir(campo as HTMLInputElement, motivo);
  await clic(botonConTexto(dom.window.document.querySelector('[role="dialog"], [role="alertdialog"]') as Element, /^Anular abono$/), "confirmar la anulación");
  assert.ok(await esperarHasta(() => sql(`select count(*) from public.abonos where id = ${id}`) === "0"), `el abono ${id} sigue vivo`);
  assert.equal(sql(`select count(*) from public.abonos_anulados where abono_id = ${id} and motivo = '${motivo}'`), "1", "huella con motivo");
  assert.equal(sql(`select count(*) from public.asientos_contables where referencia = 'abono:${id}'`), "0", "asiento retirado");
}

test("UI1 Gestión anula con motivo un abono contabilizado (retira su asiento, deja huella) y uno sin asiento", async () => {
  const { GestionTabs } = await import("../app/(dashboard)/dashboard/contratos/[numero]/GestionTabs.tsx");
  const { numero, contabilizado, sinAsiento, abonos } = await abonosParaPantalla("UI1");
  const m = await montar(h(GestionTabs, {
    numero, precioVenta: 1_800_000, impuesto: 0, clienteNombre: "Cliente UI", clienteDocumento: "",
    asesorNombre: U.venta.nombre, asesorPct: 0, verFinanzas: true,
    costos: { costo_hotel: 0, costo_aereo: 0, costo_receptivo: 0, costo_asistencia: 0, otros_costos: 0 },
    abonos, cuotas: [], totalPagado: 200_000, cuentasPorPagar: [], comisionesB2B: [], facturas: [], formasPago: ["Efectivo"],
  }));
  try {
    const raiz = m.contenedor;
    await anularDesdePantalla(raiz, contabilizado, "UI Gestión contabilizado");
    await anularDesdePantalla(raiz, sinAsiento, "UI Gestión sin asiento");
  } finally {
    await m.desmontar();
  }
});

test("UI2 Cartera anula con motivo un abono contabilizado (retira su asiento, deja huella) y uno sin asiento", async () => {
  const { CarteraList } = await import("../app/(dashboard)/dashboard/cartera/CarteraList.tsx");
  const { numero, contabilizado, sinAsiento, abonos } = await abonosParaPantalla("UI2");
  const m = await montar(h(CarteraList, { rows: [{
    numero_contrato: numero, cliente: "Cliente UI", destino: "Cartagena", precio_venta: 1_800_000,
    estado: "activo", fecha_salida: "2026-12-01", moneda: "COP", pagado: 200_000, saldo: 1_600_000, abonos,
  }], formasPago: ["Efectivo"] }));
  try {
    const raiz = m.contenedor;
    await clic(raiz.querySelector('td[data-label="Contrato"]')?.closest("tr"), "abrir contrato en Cartera");
    await anularDesdePantalla(raiz, contabilizado, "UI Cartera contabilizado");
    await anularDesdePantalla(raiz, sinAsiento, "UI Cartera sin asiento");
  } finally {
    await m.desmontar();
  }
});
