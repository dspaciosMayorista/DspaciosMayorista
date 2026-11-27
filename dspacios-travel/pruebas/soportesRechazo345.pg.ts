// S339-02 / 345 · Soportes de pago: RECHAZO interno + CORRECCIÓN del aliado — ACCIONES REALES contra PostgreSQL + PostgREST locales y desechables (cadena de migraciones hasta la 343 + 345).
// Solo se simulan la sesión (auth.getUser) y Storage (en memoria); el correo sale por el transporte REAL de captura local hacia un servidor HTTP de esta máquina (el mismo contrato que Mailpit).
// Lánzala con: PG_REACT=1 sh supabase/scripts/test_pg_local.sh pgrevc rev_consolidada_base PG345 pruebas/soportesRechazo345.pg.ts supabase/migrations/20260601000345_soportes_pago_rechazo.sql
import { test, describe, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG345_CONTENEDOR ?? "pgrevc";
const DB = process.env.PG345_BASE ?? "";
const PGRST = process.env.PG345_POSTGREST ?? "";
const SECRETO = process.env.PG345_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || DB.startsWith("rev_consolidada") && !DB.startsWith("tpg_") || !PGRST || !SECRETO) throw new Error("Faltan PG345_BASE (desechable tpg_*), PG345_POSTGREST y PG345_JWT_SECRET: usa supabase/scripts/test_pg_local.sh.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(specifier, context, nextResolve) { const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true }; return nextResolve(specifier, context); } });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}

// ── Usuarios ──────────────────────────────────────────────────────────────
const U = {
  A: "00000000-0000-0000-0000-000000345a01",       // agencia Alfa, mayorista, ficha 8101 → dueña de los contratos DTM-93xx
  B: "00000000-0000-0000-0000-000000345a02",       // freelance Beta, mayorista, ficha 8102
  C: "00000000-0000-0000-0000-000000345a03",       // freelance Gamma, MINORISTA, ficha 8103 → dueño de MIN-9390
  A2: "00000000-0000-0000-0000-000000345a04",      // OTRA cuenta de la agencia Alfa (misma ficha 8101): también dueña por id
  HOMON: "00000000-0000-0000-0000-000000345a05",   // freelance de OTRA ficha (8104) con el MISMO NOMBRE que A: no es dueña (no se adivina por nombre)
  GER: "00000000-0000-0000-0000-000000345a06",     // gerencia mayorista
  GERMIN: "00000000-0000-0000-0000-000000345a07",  // gerencia minorista
  VENTA: "00000000-0000-0000-0000-000000345a08",   // venta mayorista, asesor de los contratos
  SUP: "00000000-0000-0000-0000-000000345a09",     // superadmin
  ADM: "00000000-0000-0000-0000-000000345a0a",     // administración mayorista
  OPE: "00000000-0000-0000-0000-000000345a0b",     // operaciones mayorista
  CV: "00000000-0000-0000-0000-000000345a0c",      // control_vuelo mayorista
} as const;
const PERFIL: Record<string, { rol: string; tenant: string; activo: boolean; email: string; nombre: string; aliado: number | null }> = {
  [U.A]: { rol: "agencia", tenant: "mayorista", activo: true, email: "alfa345@x.test", nombre: "Agencia Alfa 345", aliado: 8101 },
  [U.B]: { rol: "freelance", tenant: "mayorista", activo: true, email: "beta345@x.test", nombre: "Freelance Beta 345", aliado: 8102 },
  [U.C]: { rol: "freelance", tenant: "minorista", activo: true, email: "gamma345@x.test", nombre: "Freelance Gamma 345", aliado: 8103 },
  [U.A2]: { rol: "agencia", tenant: "mayorista", activo: true, email: "alfa2-345@x.test", nombre: "Segunda cuenta Alfa 345", aliado: 8101 },
  [U.HOMON]: { rol: "freelance", tenant: "mayorista", activo: true, email: "homonimo345@x.test", nombre: "Agencia Alfa 345", aliado: 8104 },
  [U.GER]: { rol: "gerencia", tenant: "mayorista", activo: true, email: "ger345@x.test", nombre: "Gerente 345", aliado: null },
  [U.GERMIN]: { rol: "gerencia", tenant: "minorista", activo: true, email: "germin345@x.test", nombre: "Gerente Min 345", aliado: null },
  [U.VENTA]: { rol: "venta", tenant: "mayorista", activo: true, email: "venta345@x.test", nombre: "Asesor 345", aliado: null },
  [U.SUP]: { rol: "superadmin", tenant: "mayorista", activo: true, email: "sup345@x.test", nombre: "Super 345", aliado: null },
  [U.ADM]: { rol: "administracion", tenant: "mayorista", activo: true, email: "adm345@x.test", nombre: "Admin 345", aliado: null },
  [U.OPE]: { rol: "operaciones", tenant: "mayorista", activo: true, email: "ope345@x.test", nombre: "Operaciones 345", aliado: null },
  [U.CV]: { rol: "control_vuelo", tenant: "mayorista", activo: true, email: "cv345@x.test", nombre: "Control vuelo 345", aliado: null },
};
const TOKEN_SERVICIO = jwt({ role: "service_role" });
let uidSesion: string = U.A;

// ── Storage en memoria ────────────────────────────────────────────────────
type Objeto = { bytes: Buffer; mime: string };
const almacen = new Map<string, Objeto>();
let subidas: { clave: string; sha: string }[] = [];
const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
async function storageFalso(url: string, init?: RequestInit): Promise<Response> {
  const ruta = decodeURIComponent(url.split("/storage/v1/")[1].split("?")[0]);
  const metodo = (init?.method ?? "GET").toUpperCase();
  if (ruta.startsWith("object/sign/") && metodo === "POST") return json(200, { signedURL: `/${ruta}?token=falso` });
  if (ruta.startsWith("object/") && metodo === "POST") {
    const clave = ruta.slice("object/".length);
    if (almacen.has(clave)) return json(409, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    const bytes = Buffer.from(init?.body as Uint8Array);
    almacen.set(clave, { bytes, mime: new Headers(init?.headers).get("content-type") ?? "" });
    subidas.push({ clave, sha: createHash("sha256").update(bytes).digest("hex") });
    return json(200, { Id: clave, Key: clave });
  }
  if (ruta.startsWith("object/") && metodo === "DELETE") {
    const bucket = ruta.slice("object/".length);
    const { prefixes } = JSON.parse(String(init?.body)) as { prefixes: string[] };
    const quitados: { name: string }[] = [];
    for (const p of prefixes) { if (almacen.delete(`${bucket}/${p}`)) quitados.push({ name: p }); }
    return json(200, quitados);
  }
  return json(404, { message: "ruta de storage no simulada: " + ruta });
}

process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3090";

const fetchLocal: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/storage/v1/")) return storageFalso(url, init);
  return fetch(url.replace("/rest/v1/", "/"), init);
};
function clienteLocal(token: string, usuario?: { id: string; email: string } | null) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario !== undefined) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const clienteSesion = () => uidSesion
  ? clienteLocal(jwt({ role: "authenticated", sub: uidSesion }), { id: uidSesion, email: PERFIL[uidSesion].email })
  : clienteLocal(jwt({ role: "anon" }), null);

function sql(q: string): string {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
}

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteSesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteLocal(TOKEN_SERVICIO) } });

// ── Captura de correo LOCAL (el mismo contrato HTTP que Mailpit: POST /api/v1/send en una dirección de esta máquina) ──
type Correo = { To: { Email: string }[]; Subject: string; HTML: string; Text: string; From: { Email: string } };
const correos: Correo[] = [];
let capturaEstado = 200;
const servidorCorreo = http.createServer((req, res) => {
  let cuerpo = "";
  req.on("data", (d) => { cuerpo += d; });
  req.on("end", () => {
    if (capturaEstado !== 200) { res.statusCode = capturaEstado; res.end("{}"); return; }
    correos.push(JSON.parse(cuerpo) as Correo);
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ID: `m${correos.length}` }));
  });
});
await new Promise<void>((ok) => servidorCorreo.listen(0, "127.0.0.1", ok));
const PUERTO_CORREO = (servidorCorreo.address() as { port: number }).port;
const activarCorreo = () => { process.env.SOLICITUD_PROVEEDOR_EMAIL = "captura"; process.env.SOLICITUD_PROVEEDOR_CAPTURA_URL = `http://127.0.0.1:${PUERTO_CORREO}`; };
const apagarCorreo = () => { delete process.env.SOLICITUD_PROVEEDOR_EMAIL; };
activarCorreo();
after(() => { servidorCorreo.close(); });

const acc = await import("../app/portal/b2b/cartera/soportes-actions.ts");
const interno = await import("../app/(dashboard)/dashboard/contratos/[numero]/soportes-actions.ts");
const servidor = await import("../lib/soportes/servidor.ts");

// ── Utilidades ────────────────────────────────────────────────────────────
const pdf = (relleno = 200, marca = Math.random()) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(String(marca).repeat(Math.max(1, Math.ceil(relleno / 5))))]);
function formulario(bytes: Buffer, nombre: string, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("archivo", new File([bytes as BlobPart], nombre, { type: "application/pdf" }));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}
const idnC = (numero: string) => { const u = sql(`select contrato_uid from public.ventas where numero_contrato = '${numero}'`).trim(); return u ? { [numero]: u } : {}; };
const idnS = (id: number) => { const n = sql(`select numero_contrato from public.contrato_soportes_pago where id = ${id}`).trim(); return n ? idnC(n) : {}; };
const subir = (uid: string, numero: string, bytes = pdf(), nombre = "comprobante.pdf") => { uidSesion = uid; return acc.subirSoporte(formulario(bytes, nombre, { numero }), idnC(numero)); };
const corregir = (uid: string, id: number, bytes = pdf(), nombre = "corregido.pdf") => { uidSesion = uid; return acc.corregirSoporte(formulario(bytes, nombre, { id: String(id) }), idnS(id)); };
const rechazar = (uid: string, id: number, motivo: string) => { uidSesion = uid; return interno.rechazarSoporte(id, motivo, idnS(id)); };
const filas = (num: string) => sql(`select id || '|' || vigente || '|' || coalesce(motivo_retiro,'') || '|' || coalesce(corrige_id::text,'') || '|' || coalesce(nota_retiro,'') from public.contrato_soportes_pago where numero_contrato = '${num}' order by id`)
  .split("\n").filter(Boolean).map((l) => { const [id, vigente, motivo, corrige, nota] = l.split("|"); return { id: Number(id), vigente: vigente === "true", motivo, corrige: corrige ? Number(corrige) : null, nota }; });
const vigentes = (num: string) => filas(num).filter((f) => f.vigente);
const objetosDe = (num: string) => [...almacen.keys()].filter((k) => k.startsWith(`soportes-pago/${num}/`));
const msg = (r: { ok: boolean; error?: string }) => (r.ok ? "ok" : String(r.error));
const aviso = (id: number) => sql(`select estado || '|' || intentos || '|' || coalesce(destinatarios::text,'') from public.soporte_rechazo_aviso where soporte_id = ${id}`);
const RE_LIMITE = /máximo de soportes vigentes/;

function huella(num: string): Record<string, string> {
  const q = (s: string) => sql(s).trim();
  return {
    venta: q(`select md5(to_jsonb(v)::text) from public.ventas v where numero_contrato = '${num}'`),
    abonos: q(`select coalesce(md5(string_agg(to_jsonb(a)::text, '|' order by a.id)), 'sin') || ':' || count(*) from public.abonos a where numero_contrato = '${num}'`),
    cxp: q(`select coalesce(md5(string_agg(to_jsonb(c)::text, '|' order by c.id)), 'sin') from public.cuentas_por_pagar c where numero_contrato = '${num}'`),
    previstas: q(`select count(*) from public.contrato_obligaciones_previstas where numero_contrato = '${num}'`),
    comisiones: q(`select count(*) from public.aliados_b2b where numero_contrato = '${num}'`),
    asientos: q(`select count(*) from public.asientos_contables`),
    lineas: q(`select count(*) from public.asiento_lineas`),
  };
}

const NUM = { MAIN: "DTM-9301", CERO: "DTM-9302", LLENO: "DTM-9303", CARRERA: "DTM-9304", CORREO: "DTM-9305", SINDEST: "DTM-9306", ROLES: "DTM-9307", MIN: "MIN-9390", TOPE: "DTM-9308" };
const vtaSql = (num: string, cliente: string, tenant: string, aliado: number, estado = "confirmado") => `('${num}', '${cliente}', '${tenant}', 'CARTAGENA', current_date + 30, '${estado}', 1000000, 'COP', ${aliado}, 'Agencia Alfa 345', null, 'agencia', 'Asesor 345')`;

before(() => {
  sql(`
    insert into auth.users (id, email) values ${Object.entries(PERFIL).map(([id, p]) => `('${id}', '${p.email}')`).join(", ")} on conflict do nothing;
    insert into public.aliados (id, nombre, tipo, nit, activo) values
      (8101, 'Agencia Alfa 345', 'agencia', '900345001', true), (8102, 'Freelance Beta 345', 'freelance', '1034500002', true),
      (8103, 'Freelance Gamma 345', 'freelance', '1034500003', true), (8104, 'Freelance Delta 345', 'freelance', '1034500004', true) on conflict (id) do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
      ${Object.entries(PERFIL).map(([id, p]) => `('${id}', '${p.email}', '${p.nombre}', '${p.rol}', ${p.activo}, '${p.tenant}', ${p.aliado ?? "null"})`).join(", ")}
      on conflict (id) do update set nombre = excluded.nombre, email = excluded.email, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id;
    insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, agencia_nombre, freelance_nombre, tipo_asesor, asesor) values
      ${vtaSql(NUM.MAIN, "Cliente Reservado 9301", "mayorista", 8101)},
      ${vtaSql(NUM.CERO, "Cliente 9302", "mayorista", 8101, "pendiente")},
      ${vtaSql(NUM.LLENO, "Cliente 9303", "mayorista", 8101)},
      ${vtaSql(NUM.CARRERA, "Cliente 9304", "mayorista", 8101)},
      ${vtaSql(NUM.CORREO, "Cliente 9305", "mayorista", 8101)},
      ${vtaSql(NUM.ROLES, "Cliente 9307", "mayorista", 8101)},
      ${vtaSql(NUM.TOPE, "Cliente 9308", "mayorista", 8101)},
      ('${NUM.SINDEST}', 'Cliente 9306', 'mayorista', 'CARTAGENA', current_date + 30, 'confirmado', 1000000, 'COP', 8102, null, 'Freelance Beta 345', 'freelance', 'Asesor 345'),
      ('${NUM.MIN}', 'Cliente Min 9390', 'minorista', 'CARTAGENA', current_date + 30, 'confirmado', 1000000, 'COP', 8103, null, 'Freelance Gamma 345', 'freelance', 'Asesor Min 345');
    insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) values
      ('${NUM.MAIN}', 100000, 'Transferencia', 'mayorista'), ('${NUM.LLENO}', 100000, 'Transferencia', 'mayorista'), ('${NUM.CARRERA}', 100000, 'Transferencia', 'mayorista'),
      ('${NUM.CORREO}', 100000, 'Transferencia', 'mayorista'), ('${NUM.ROLES}', 100000, 'Transferencia', 'mayorista'), ('${NUM.TOPE}', 100000, 'Transferencia', 'mayorista'),
      ('${NUM.SINDEST}', 100000, 'Transferencia', 'mayorista'), ('${NUM.MIN}', 100000, 'Transferencia', 'minorista');
  `);
});

describe("345 · rechazo interno: motivo obligatorio, sale de lo vigente, conserva archivo e historial, avisa al aliado", () => {
  let s1 = 0, s2 = 0;
  test("el aliado sube 2 soportes (1 pago + 1 adicional); gerencia rechaza el primero con motivo → sale de vigentes, queda en el historial con quién, cuándo y por qué", async () => {
    assert.equal(msg(await subir(U.A, NUM.MAIN, pdf(300), "transferencia-mal.pdf")), "ok");
    assert.equal(msg(await subir(U.A, NUM.MAIN, pdf(301), "otro-pago.pdf")), "ok");
    [s1, s2] = vigentes(NUM.MAIN).map((f) => f.id);
    const antes = huella(NUM.MAIN);
    correos.length = 0;
    const r = await rechazar(U.GER, s1, "  El comprobante es de otro contrato.  ");
    assert.equal(r.ok, true, JSON.stringify(r));
    const f = filas(NUM.MAIN).find((x) => x.id === s1)!;
    assert.deepEqual({ vigente: f.vigente, motivo: f.motivo, nota: f.nota }, { vigente: false, motivo: "rechazo", nota: "El comprobante es de otro contrato." }, "motivo recortado y guardado");
    assert.equal(sql(`select retirado_por from public.contrato_soportes_pago where id = ${s1}`), U.GER, "quién");
    assert.match(sql(`select retirado_en::text from public.contrato_soportes_pago where id = ${s1}`), /^\d{4}-/, "cuándo");
    assert.equal(vigentes(NUM.MAIN).length, 1, "el rechazado ya no cuenta como vigente");
    assert.equal(objetosDe(NUM.MAIN).length, 2, "el archivo rechazado se CONSERVA en Storage");
    assert.equal(sql(`select count(*) from public.contrato_soportes_pago where id = ${s1}`), "1", "la fila se conserva");
    assert.deepEqual(huella(NUM.MAIN), antes, "rechazar no toca venta, abonos, CxP, previstas, comisiones ni asientos");
    assert.equal(sql(`select estado from public.ventas where numero_contrato = '${NUM.MAIN}'`), "confirmado");
  });

  test("el correo al aliado: destinatario correcto (por ids, no por nombre), asunto, motivo, nombre del archivo y enlace; sin cliente ni montos; estado «enviado»", () => {
    assert.equal(correos.length, 2, "un correo por cuenta DUEÑA por id (A y A2 comparten la ficha 8101); ni el homónimo de otra ficha ni otra agencia");
    assert.deepEqual(correos.map((x) => x.To[0].Email).sort(), ["alfa2-345@x.test", "alfa345@x.test"]);
    assert.ok(correos.every((x) => x.To.length === 1), "cada cuenta recibe su propio mensaje (no se comparten direcciones)");
    const c = correos.find((x) => x.To[0].Email === "alfa345@x.test")!;
    assert.match(c.Subject, /Soporte de pago rechazado · Contrato DTM-9301/);
    assert.match(c.Text, /transferencia-mal\.pdf/); assert.match(c.Text, /El comprobante es de otro contrato\./);
    assert.match(c.Text, /http:\/\/localhost:3090\/portal\/b2b\/cartera\?vista=soportes/);
    assert.match(c.HTML, /href="http:\/\/localhost:3090\/portal\/b2b\/cartera\?vista=soportes"/);
    assert.match(c.Text, /no confirma ni cambia ningún pago/);
    for (const prohibido of ["Cliente Reservado", "1000000", "1.000.000", "100000"]) { assert.ok(!c.Text.includes(prohibido) && !c.HTML.includes(prohibido), `el correo no revela «${prohibido}»`); }
    assert.equal(aviso(s1), "enviado|1|2");
  });

  test("el equipo ve el rechazado en su historial y puede abrir el archivo; el aliado ya no puede abrirlo como vigente", async () => {
    uidSesion = U.GER;
    const u = await interno.urlSoporteInterno(s1);
    assert.equal(u.ok, true, "el personal sigue pudiendo abrir el rechazado");
    uidSesion = U.A;
    const a = await acc.urlSoporteAliado(s1, idnS(s1));
    assert.equal(a.ok, false, "el aliado no abre un soporte que no está vigente");
  });

  test("motivo obligatorio: vacío, solo espacios y > 500 caracteres se rechazan SIN cambiar nada; la base también (RPC directa)", async () => {
    const antes = filas(NUM.MAIN);
    for (const m of ["", "   ", "x".repeat(501)]) {
      const r = await rechazar(U.GER, s2, m);
      assert.equal(r.ok, false, `motivo «${m.slice(0, 10)}…»`);
    }
    assert.deepEqual(filas(NUM.MAIN), antes);
    const directo = () => { try { sql(`select public.soporte_rechazar(${s2}, '${U.GER}', '   ')`); return "ok"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
    assert.match(directo(), /SOPORTE_MOTIVO/);
    const nulo = () => { try { sql(`select public.soporte_rechazar(${s2}, '${U.GER}', null)`); return "ok"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
    assert.match(nulo(), /SOPORTE_MOTIVO/);
    assert.equal(vigentes(NUM.MAIN).length, 1);
  });

  test("un soporte que ya no es vigente no se rechaza otra vez (rechazado, retirado o reemplazado)", async () => {
    const r = await rechazar(U.GER, s1, "otra vez");
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /ya cambió/);
    assert.equal(sql(`select nota_retiro from public.contrato_soportes_pago where id = ${s1}`), "El comprobante es de otro contrato.", "el motivo original no se pisa");
  });
});

describe("345 · quién puede rechazar (matriz de acceso)", () => {
  let id = 0;
  before(async () => { assert.equal(msg(await subir(U.A, NUM.ROLES, pdf(400), "soporte-roles.pdf")), "ok"); id = vigentes(NUM.ROLES)[0].id; });
  test("el asesor (venta), el aliado, control_vuelo, la gerencia de OTRA agencia y una sesión anónima NO pueden; nada cambia y nadie recibe correo", async () => {
    correos.length = 0;
    for (const uid of [U.VENTA, U.A, U.CV, U.GERMIN, ""]) {
      const r = await rechazar(uid, id, "intento no autorizado");
      assert.equal(r.ok, false, uid ? PERFIL[uid].nombre : "anónimo");
    }
    assert.equal(vigentes(NUM.ROLES).length, 1);
    assert.equal(correos.length, 0);
    // y la base lo exige aunque se la llame directo con un actor sin rol / de otra agencia
    for (const actor of [U.VENTA, U.A, U.CV, U.GERMIN]) {
      let e = ""; try { sql(`select public.soporte_rechazar(${id}, '${actor}', 'directo')`); } catch (x) { e = String((x as { stderr?: string }).stderr ?? x); }
      assert.match(e, /SOPORTE_ROL/, `RPC directa con ${PERFIL[actor].nombre}`);
    }
    assert.equal(vigentes(NUM.ROLES).length, 1);
  });
  test("con el JWT de un aliado o de un usuario autenticado NO se pueden llamar las funciones (solo el servidor); la tabla de avisos tampoco se escribe", async () => {
    const sb = clienteLocal(jwt({ role: "authenticated", sub: U.A }), { id: U.A, email: PERFIL[U.A].email });
    for (const [fn, args] of [["soporte_rechazar", { p_id: id, p_actor: U.GER, p_motivo: "x" }], ["soporte_corregir", { p_id: id, p_actor: U.A, p_path: "x/y.pdf", p_nombre: "y.pdf", p_mime: "application/pdf", p_size: 10, p_sha: "ab".repeat(32) }],
                         ["soporte_rechazo_aviso_reclamar", { p_id: id }], ["soporte_rechazo_aviso_cerrar", { p_id: id, p_estado: "enviado", p_destinatarios: 1, p_error: null }]] as const) {
      const r = await sb.rpc(fn as never, args as never);
      assert.ok((r as { error: unknown }).error, `authenticated no ejecuta ${fn}`);
    }
    const ins = await sb.from("soporte_rechazo_aviso" as never).insert({ soporte_id: id } as never);
    assert.ok((ins as { error: unknown }).error, "tampoco se inserta directo");
    assert.equal(vigentes(NUM.ROLES).length, 1);
  });
  test("superadmin, gerencia, administración y operaciones de la agencia SÍ pueden; la gerencia minorista rechaza el soporte de SU agencia y no ve los de la otra", async () => {
    for (const [uid, num, bytes] of [[U.SUP, NUM.TOPE, 410], [U.ADM, NUM.TOPE, 411]] as const) {
      assert.equal(msg(await subir(U.A, num, pdf(bytes), `r-${bytes}.pdf`)), "ok");
      const sid = vigentes(num).at(-1)!.id;
      assert.equal((await rechazar(uid, sid, `rechazado por ${PERFIL[uid].rol}`)).ok, true, PERFIL[uid].rol);
    }
    assert.equal(msg(await subir(U.A, NUM.CERO, pdf(412), "ope.pdf")), "ok");
    assert.equal((await rechazar(U.OPE, vigentes(NUM.CERO)[0].id, "rechazado por operaciones")).ok, true, "operaciones");
    assert.equal(msg(await subir(U.C, NUM.MIN, pdf(413), "min.pdf")), "ok");
    const sid = vigentes(NUM.MIN)[0].id;
    assert.equal((await rechazar(U.GER, sid, "gerencia mayorista sobre minorista")).ok, false, "otra agencia: no ve el soporte");
    assert.equal(vigentes(NUM.MIN).length, 1);
    assert.equal((await rechazar(U.GERMIN, sid, "gerencia minorista")).ok, true);
    // superadmin sí cruza agencias
    assert.equal(msg(await subir(U.C, NUM.MIN, pdf(414), "min2.pdf")), "ok");
    assert.equal((await rechazar(U.SUP, vigentes(NUM.MIN)[0].id, "superadmin global")).ok, true);
  });
});

describe("345 · cupo y corrección: rechazar libera el cupo; la cadena rechazado → corregido ocupa UNO; sin atajos", () => {
  test("contrato SIN pagos (1 cupo): sube 1, se rechaza, el cupo queda libre, la corrección entra y queda ligada al rechazado; otra subida nueva se rechaza por límite", async () => {
    const num = "DTM-9310";
    sql(`insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, agencia_nombre, tipo_asesor, asesor)
           values ('${num}', 'Cliente 9310', 'mayorista', 'CARTAGENA', current_date + 30, 'pendiente', 1000000, 'COP', 8101, 'Agencia Alfa 345', 'agencia', 'Asesor 345')`);
    assert.equal(msg(await subir(U.A, num, pdf(500), "malo.pdf")), "ok");
    const malo = vigentes(num)[0].id;
    const lleno = await subir(U.A, num, pdf(501));
    assert.match(lleno.ok ? "" : lleno.error, RE_LIMITE, "lleno antes del rechazo");
    assert.equal((await rechazar(U.GER, malo, "ilegible")).ok, true);
    assert.equal(vigentes(num).length, 0, "el rechazo liberó el cupo");
    const pend = await servidor.soportesRechazadosPendientes([num]);
    assert.deepEqual(pend.filas.map((f) => ({ id: f.id, motivo: f.motivo })), [{ id: malo, motivo: "ilegible" }], "el aliado lo ve pendiente, con el motivo");
    const huellaAntes = huella(num);
    assert.equal(msg(await corregir(U.A, malo, pdf(502), "bueno.pdf")), "ok");
    const fs = filas(num);
    assert.equal(fs.length, 2);
    assert.equal(fs[1].corrige, malo, "la corrección apunta al rechazado");
    assert.equal(vigentes(num).length, 1, "la cadena rechazado → corregido ocupa UN cupo");
    assert.deepEqual((await servidor.soportesRechazadosPendientes([num])).filas, [], "ya corregido: sale de lo pendiente del aliado");
    assert.deepEqual(huella(num), huellaAntes, "corregir no toca nada financiero");
    const otra = await subir(U.A, num, pdf(503));
    assert.match(otra.ok ? "" : otra.error, RE_LIMITE, "sin atajos: con la corrección vigente el contrato vuelve a estar lleno");
    // el equipo es avisado de la corrección (aviso interno ya existente) y el actor no se avisa a sí mismo
    assert.equal(Number(sql(`select count(*) from public.avisos where usuario_id = '${U.GER}' and numero_contrato = '${num}' and tipo = 'soporte_pago_reemplazado'`)), 1);
    assert.equal(Number(sql(`select count(*) from public.avisos where usuario_id = '${U.A}' and numero_contrato = '${num}'`)), 0);
  });

  test("el MISMO archivo rechazado no sirve como corrección; un rechazo se corrige una sola vez", async () => {
    const num = NUM.LLENO;
    const malo = pdf(510);
    assert.equal(msg(await subir(U.A, num, malo, "x.pdf")), "ok");
    assert.equal(msg(await subir(U.A, num, pdf(511), "y.pdf")), "ok");
    const id = vigentes(num)[0].id;
    assert.equal((await rechazar(U.GER, id, "no corresponde")).ok, true);
    const igual = await corregir(U.A, id, malo, "x-otra-vez.pdf");
    assert.match(igual.ok ? "" : igual.error, /mismo archivo que se rechazó/);
    assert.equal(msg(await corregir(U.A, id, pdf(512), "x-bueno.pdf")), "ok");
    const dos = await corregir(U.A, id, pdf(513), "x-segundo.pdf");
    assert.match(dos.ok ? "" : dos.error, /ya tiene su corrección/);
    assert.equal(vigentes(num).length, 2);
    assert.equal(objetosDe(num).length, 3, "ningún objeto huérfano de los intentos rechazados");
  });

  test("si entre el rechazo y la corrección el aliado llenó el cupo con OTRO soporte: la corrección topa con el límite (sin bypass) pero NO queda sin salida: reemplaza el otro soporte", async () => {
    const num = NUM.CORREO;
    assert.equal(msg(await subir(U.A, num, pdf(520), "uno.pdf")), "ok");
    assert.equal(msg(await subir(U.A, num, pdf(521), "dos.pdf")), "ok");
    const [uno] = vigentes(num);
    assert.equal((await rechazar(U.GER, uno.id, "borroso")).ok, true);
    assert.equal(msg(await subir(U.A, num, pdf(522), "tres.pdf")), "ok", "el cupo liberado lo ocupa otro soporte nuevo");
    assert.equal(vigentes(num).length, 2);
    const tope = await corregir(U.A, uno.id, pdf(523), "uno-bueno.pdf");
    assert.match(tope.ok ? "" : tope.error, RE_LIMITE, "la corrección NO salta el tope");
    assert.equal(vigentes(num).length, 2, "nunca más de pagos + 1");
    assert.equal(objetosDe(num).length, 3, "el intento rechazado no dejó objeto huérfano");
    // La AUTORIDAD es la base: llamada directa (sin la precomprobación del servidor) también topa con el tope.
    let directo = ""; try { sql(`select public.soporte_corregir(${uno.id}, '${U.A}', '${num}/directo-corr.pdf', 'directo.pdf', 'application/pdf', 10, '${"ef".repeat(32)}')`); } catch (e) { directo = String((e as { stderr?: string }).stderr ?? e); }
    assert.match(directo, /SOPORTE_LIMITE/, "la corrección directa en la base tampoco salta el tope");
    assert.equal(vigentes(num).length, 2);
    const [, otro] = vigentes(num);
    uidSesion = U.A;
    assert.equal(msg(await acc.reemplazarSoporte(formulario(pdf(524), "tres-bueno.pdf", { id: String(otro.id) }), idnS(otro.id))), "ok", "salida: reemplazar uno vigente con el archivo correcto");
    assert.equal(vigentes(num).length, 2);
  });

  test("competencia: 3 correcciones simultáneas del MISMO rechazo → gana exactamente 1; nunca dos soportes ligados al mismo rechazo", async () => {
    for (let n = 0; n < 3; n++) {
      const num = NUM.CARRERA;
      const sub = await subir(U.A, num, pdf(530 + n), `c${n}.pdf`);
      assert.equal(msg(sub), "ok");
      const id = vigentes(num).at(-1)!.id;
      assert.equal((await rechazar(U.GER, id, `ronda ${n}`)).ok, true);
      const rs = await Promise.all([0, 1, 2].map((i) => { uidSesion = U.A; return acc.corregirSoporte(formulario(pdf(540 + i + n * 3, Math.random() + i), `k${i}.pdf`, { id: String(id) }), idnS(id)); }));
      assert.equal(rs.filter((r) => r.ok).length, 1, `ronda ${n}: ${rs.map((r) => (r.ok ? "ok" : r.error)).join(" | ")}`);
      assert.equal(Number(sql(`select count(*) from public.contrato_soportes_pago where corrige_id = ${id}`)), 1);
      assert.ok(vigentes(num).length <= 2, "tope respetado");
      // limpiar para la siguiente ronda: retirar los vigentes (acción real del aliado)
      for (const v of vigentes(num)) { uidSesion = U.A; await acc.retirarSoporte(v.id, undefined, idnS(v.id)); }
    }
  });

  test("competencia: 3 rechazos simultáneos del mismo soporte → exactamente 1 rechazo, 1 estado de aviso y 1 correo", async () => {
    const num = NUM.TOPE;
    assert.equal(msg(await subir(U.A, num, pdf(560), "carrera-rechazo.pdf")), "ok");
    const id = vigentes(num).at(-1)!.id;
    correos.length = 0;
    const rs = await Promise.all([U.GER, U.ADM, U.SUP].map((u, i) => rechazar(u, id, `motivo ${i}`)));
    assert.equal(rs.filter((r) => r.ok).length, 1, rs.map((r) => (r.ok ? "ok" : r.error)).join(" | "));
    assert.equal(Number(sql(`select count(*) from public.soporte_rechazo_aviso where soporte_id = ${id}`)), 1);
    assert.equal(correos.length, 2, "un correo por cuenta dueña (A y A2), no uno por intento de rechazo");
    assert.equal(new Set(correos.map((c) => c.To[0].Email)).size, 2);
  });
});

describe("345 · correo: el rechazo NO depende de que el correo salga; reintento acotado; sin duplicados", () => {
  test("captura caída (500): el rechazo queda guardado, el aviso «fallido»; al volver la captura, «Reintentar» lo envía UNA vez; reintentar de nuevo no duplica", async () => {
    const num = "DTM-9320";
    sql(`insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, agencia_nombre, tipo_asesor, asesor)
           values ('${num}', 'Cliente 9320', 'mayorista', 'CARTAGENA', current_date + 30, 'pendiente', 1000000, 'COP', 8101, 'Agencia Alfa 345', 'agencia', 'Asesor 345')`);
    assert.equal(msg(await subir(U.A, num, pdf(600), "falla-correo.pdf")), "ok");
    const id = vigentes(num)[0].id;
    correos.length = 0; capturaEstado = 500;
    const r = await rechazar(U.GER, id, "motivo con falla de correo");
    capturaEstado = 200;
    assert.equal(r.ok, true);
    assert.equal(vigentes(num).length, 0, "el rechazo NO se deshizo");
    assert.equal(r.ok && r.aviso.estado, "fallido");
    assert.equal(aviso(id), "fallido|1|0");
    assert.equal(correos.length, 0, "ninguno salió");
    uidSesion = U.GER;
    const ok = await interno.reintentarAvisoRechazo(id);
    assert.equal(ok.ok && ok.aviso.estado, "enviado");
    assert.equal(correos.length, 2, "una vez a cada cuenta dueña");
    assert.equal(aviso(id), "enviado|2|2");
    const otra = await interno.reintentarAvisoRechazo(id);
    assert.equal(otra.ok && otra.aviso.estado, "nada_que_enviar", "ya enviado: no hay segundo correo");
    assert.equal(correos.length, 2);
    // quien no puede rechazar tampoco reintenta
    uidSesion = U.VENTA;
    assert.equal((await interno.reintentarAvisoRechazo(id)).ok, false);
  });

  test("tope de 5 intentos: tras 5 envíos fallidos el sistema deja de reclamar (sin ciclos); y con el correo apagado no se consume ningún intento", async () => {
    const num = "DTM-9321";
    sql(`insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, agencia_nombre, tipo_asesor, asesor)
           values ('${num}', 'Cliente 9321', 'mayorista', 'CARTAGENA', current_date + 30, 'pendiente', 1000000, 'COP', 8101, 'Agencia Alfa 345', 'agencia', 'Asesor 345')`);
    assert.equal(msg(await subir(U.A, num, pdf(610), "tope.pdf")), "ok");
    const id = vigentes(num)[0].id;
    apagarCorreo();
    const apagado = await rechazar(U.GER, id, "correo apagado");
    assert.equal(apagado.ok && apagado.aviso.estado, "no_configurado");
    assert.equal(aviso(id), "pendiente|0|", "sin configuración no se consume un intento");
    activarCorreo(); capturaEstado = 500; correos.length = 0;
    uidSesion = U.GER;
    for (let i = 0; i < 5; i++) { const x = await interno.reintentarAvisoRechazo(id); assert.equal(x.ok && x.aviso.estado, "fallido", `intento ${i + 1}`); }
    const sexto = await interno.reintentarAvisoRechazo(id);
    assert.equal(sexto.ok && sexto.aviso.estado, "nada_que_enviar", "máximo 5");
    capturaEstado = 200;
    assert.equal(aviso(id), "fallido|5|0");
    assert.equal(correos.length, 0);
  });

  test("sin ninguna cuenta de aliado activa con correo: el rechazo se guarda y el aviso queda «sin_destinatario» (no se adivina a quién escribir por nombre)", async () => {
    const num = NUM.SINDEST;
    assert.equal(msg(await subir(U.B, num, pdf(620), "huerfano.pdf")), "ok");
    const id = vigentes(num)[0].id;
    sql(`update public.usuarios set activo = false where id = '${U.B}'`);
    correos.length = 0;
    const r = await rechazar(U.GER, id, "sin aliado activo");
    sql(`update public.usuarios set activo = true where id = '${U.B}'`);
    assert.equal(r.ok && r.aviso.estado, "sin_destinatario");
    assert.equal(correos.length, 0);
    assert.equal(aviso(id), "sin_destinatario|1|0");
  });

  test("destinatarios por id: todas las cuentas de la ficha dueña (A y A2) reciben UN correo cada una; el homónimo de otra ficha y otra agencia, ninguno", async () => {
    const num = "DTM-9322";
    sql(`insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, agencia_nombre, tipo_asesor, asesor)
           values ('${num}', 'Cliente 9322', 'mayorista', 'CARTAGENA', current_date + 30, 'pendiente', 1000000, 'COP', 8101, 'Agencia Alfa 345', 'agencia', 'Asesor 345')`);
    assert.equal(msg(await subir(U.A, num, pdf(630), "dos-cuentas.pdf")), "ok");
    const id = vigentes(num)[0].id;
    correos.length = 0;
    assert.equal((await rechazar(U.GER, id, "revisar")).ok, true);
    assert.deepEqual(correos.map((c) => c.To[0].Email).sort(), ["alfa2-345@x.test", "alfa345@x.test"]);
    assert.equal(aviso(id), "enviado|1|2");
  });
});

describe("345 · el portal del aliado: ve el rechazo con su motivo y solo lo suyo", () => {
  test("un aliado ajeno no ve ni corrige el rechazo de otro; los rechazados corregidos desaparecen de su lista", async () => {
    const num = "DTM-9330";
    sql(`insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, agencia_nombre, tipo_asesor, asesor)
           values ('${num}', 'Cliente 9330', 'mayorista', 'CARTAGENA', current_date + 30, 'pendiente', 1000000, 'COP', 8101, 'Agencia Alfa 345', 'agencia', 'Asesor 345')`);
    assert.equal(msg(await subir(U.A, num, pdf(700), "mio.pdf")), "ok");
    const id = vigentes(num)[0].id;
    assert.equal((await rechazar(U.GER, id, "falta la fecha")).ok, true);
    const propios = await servidor.soportesRechazadosPendientes([num]);
    assert.equal(propios.filas.length, 1);
    for (const uid of [U.B, U.HOMON, U.C]) {
      const r = await corregir(uid, id, pdf(701), "robo.pdf");
      assert.equal(r.ok, false, `${PERFIL[uid].nombre} no corrige un soporte ajeno`);
    }
    assert.equal(vigentes(num).length, 0);
    assert.equal(msg(await corregir(U.A2, id, pdf(702), "de-la-otra-cuenta.pdf")), "ok", "otra cuenta de la MISMA ficha sí es dueña (por id)");
  });
});
