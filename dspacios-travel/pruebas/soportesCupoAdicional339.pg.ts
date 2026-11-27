// #86/339 · Soportes de pago del aliado B2B — cupo adicional (soportes vigentes <= pagos registrados + 1): ACCIONES REALES contra PostgreSQL + PostgREST locales y desechables (migraciones 001-326 + 339).
// El encabezado y los ayudantes (sesiones, Storage en memoria, usuarios) vienen de pruebas/soportesPago281.pg.ts; lo ÚNICO simulado es la sesión (auth.getUser) y Storage. Lánzala con: PG_REACT=1 sh supabase/scripts/test_pg_local.sh pgsoporte339 plantilla339 PG339 pruebas/soportesCupoAdicional339.pg.ts supabase/migrations/20260601000339_soportes_pago_cupo_adicional.sql.
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG339_CONTENEDOR ?? "pgsoporte339";
const DB = process.env.PG339_BASE ?? "";
const PGRST = process.env.PG339_POSTGREST ?? "";
const SECRETO = process.env.PG339_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG339_BASE (desechable), PG339_POSTGREST y PG339_JWT_SECRET: usa supabase/scripts/test_pg_local.sh.");

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

// ── Usuarios ──────────────────────────────────────────────────────────────
const U = {
  A: "00000000-0000-0000-0000-000000281a01",       // agencia Alfa, mayorista, ficha 8101 → dueña de DTM-8101
  B: "00000000-0000-0000-0000-000000281a02",       // freelance Beta, mayorista, ficha 8102 → dueño de DTM-8102
  C: "00000000-0000-0000-0000-000000281a03",       // freelance Gamma, MINORISTA, ficha 8103 → dueño de MIN-8103
  PART: "00000000-0000-0000-0000-000000281a04",    // freelance Delta, mayorista, ficha 8104: SOLO participa por comisión en DTM-8101
  INACT: "00000000-0000-0000-0000-000000281a05",   // agencia con la ficha de A, DESACTIVADA
  GER: "00000000-0000-0000-0000-000000281a06",     // gerencia mayorista
  GERMIN: "00000000-0000-0000-0000-000000281a07",  // gerencia minorista
  VENTA: "00000000-0000-0000-0000-000000281a08",   // venta mayorista, asesor de DTM-8101 (por nombre)
  VENTA2: "00000000-0000-0000-0000-000000281a09",  // venta mayorista, NO es el asesor
  SUP: "00000000-0000-0000-0000-000000281a0a",     // superadmin mayorista
  C2: "00000000-0000-0000-0000-000000281a0b",      // freelance Epsilon, MINORISTA, ficha 8105 → dueño del contrato B (consecutivo reutilizado)
  VENTAMIN: "00000000-0000-0000-0000-000000281a0c", // venta minorista, asesor del contrato B
} as const;
const PERFIL: Record<string, { rol: string; tenant: string; activo: boolean; email: string; nombre: string; aliado: number | null }> = {
  [U.A]: { rol: "agencia", tenant: "mayorista", activo: true, email: "a281@x.test", nombre: "Agencia Alfa 281", aliado: 8101 },
  [U.B]: { rol: "freelance", tenant: "mayorista", activo: true, email: "b281@x.test", nombre: "Freelance Beta 281", aliado: 8102 },
  [U.C]: { rol: "freelance", tenant: "minorista", activo: true, email: "c281@x.test", nombre: "Freelance Gamma 281", aliado: 8103 },
  [U.PART]: { rol: "freelance", tenant: "mayorista", activo: true, email: "p281@x.test", nombre: "Freelance Delta 281", aliado: 8104 },
  [U.INACT]: { rol: "agencia", tenant: "mayorista", activo: false, email: "i281@x.test", nombre: "Agencia Alfa Inactiva 281", aliado: 8101 },
  [U.GER]: { rol: "gerencia", tenant: "mayorista", activo: true, email: "g281@x.test", nombre: "Gerente 281", aliado: null },
  [U.GERMIN]: { rol: "gerencia", tenant: "minorista", activo: true, email: "gm281@x.test", nombre: "Gerente Min 281", aliado: null },
  [U.VENTA]: { rol: "venta", tenant: "mayorista", activo: true, email: "v281@x.test", nombre: "Asesor 281", aliado: null },
  [U.SUP]: { rol: "superadmin", tenant: "mayorista", activo: true, email: "s281@x.test", nombre: "Super 281", aliado: null },
  [U.C2]: { rol: "freelance", tenant: "minorista", activo: true, email: "c2281@x.test", nombre: "Freelance Epsilon 281", aliado: 8105 },
  [U.VENTAMIN]: { rol: "venta", tenant: "minorista", activo: true, email: "vm281@x.test", nombre: "Asesor Min 281", aliado: null },
  [U.VENTA2]: { rol: "venta", tenant: "mayorista", activo: true, email: "v2281@x.test", nombre: "Otro Asesor 281", aliado: null },
};
const TOKEN_SERVICIO = jwt({ role: "service_role" });
let uidSesion: string = U.A;     // "" = sin sesión
let fallos: RegExp[] = [];
/** Rutas cuya petición se ejecuta de verdad (la base CONFIRMA) pero cuya RESPUESTA se pierde: el cliente ve un fallo de transporte. */
let respuestaPerdida: RegExp[] = [];
/** Rutas cuya petición NUNCA llega a la base (fallo de transporte antes de enviar). */
let peticionPerdida: RegExp[] = [];

// ── Storage en memoria (solo observación e inyección de fallos) ───────────
type Objeto = { bytes: Buffer; mime: string };
const almacen = new Map<string, Objeto>();      // clave: bucket/ruta
let subidas: { clave: string; sha: string }[] = [];
let borrados: string[] = [];
let fallaSubida = false;
let fallaBorrado = false;
const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
async function storageFalso(url: string, init?: RequestInit): Promise<Response> {
  const ruta = decodeURIComponent(url.split("/storage/v1/")[1].split("?")[0]);
  const metodo = (init?.method ?? "GET").toUpperCase();
  if (ruta.startsWith("object/sign/") && metodo === "POST") return json(200, { signedURL: `/${ruta}?token=falso` });
  if (ruta.startsWith("object/") && metodo === "POST") {
    if (fallaSubida) return json(500, { statusCode: "500", error: "fallo inyectado", message: "fallo inyectado" });
    const clave = ruta.slice("object/".length);
    if (almacen.has(clave)) return json(409, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    const cuerpo = init?.body;
    const bytes = Buffer.from(cuerpo as Uint8Array);
    const h = new Headers(init?.headers);
    almacen.set(clave, { bytes, mime: h.get("content-type") ?? "" });
    subidas.push({ clave, sha: createHash("sha256").update(bytes).digest("hex") });
    return json(200, { Id: clave, Key: clave });
  }
  if (ruta.startsWith("object/") && metodo === "DELETE") {
    if (fallaBorrado) return json(500, { statusCode: "500", error: "fallo inyectado", message: "fallo inyectado" });
    const bucket = ruta.slice("object/".length);
    const { prefixes } = JSON.parse(String(init?.body)) as { prefixes: string[] };
    const quitados: { name: string }[] = [];
    for (const p of prefixes) { const k = `${bucket}/${p}`; if (almacen.delete(k)) { quitados.push({ name: p }); borrados.push(k); } }
    return json(200, quitados);
  }
  return json(404, { message: "ruta de storage no simulada: " + ruta });
}

process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;

const fetchLocal: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/storage/v1/")) return storageFalso(url, init);
  const rest = url.replace("/rest/v1/", "/");
  if (fallos.some((f) => f.test(rest))) return json(500, { message: "fallo inyectado" });
  if (peticionPerdida.some((f) => f.test(rest))) throw new TypeError("fetch failed");
  if (respuestaPerdida.some((f) => f.test(rest))) { await fetch(rest, init); throw new TypeError("fetch failed"); }
  return fetch(rest, init);
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

const acc = await import("../app/portal/b2b/cartera/soportes-actions.ts");
const interno = await import("../app/(dashboard)/dashboard/contratos/[numero]/soportes-actions.ts");
const avi = await import("../lib/avisos/actions.ts");

// ── Archivos de prueba ────────────────────────────────────────────────────
const pdf = (relleno = 200, marca = Math.random()) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(String(marca).repeat(Math.max(1, Math.ceil(relleno / 5))))]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-falso-" + Math.random())]);
function formulario(bytes: Buffer | Uint8Array, nombre: string, tipoDeclarado: string, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("archivo", new File([bytes as BlobPart], nombre, { type: tipoDeclarado }));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}
const sha = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");
// Identidad que declararía la pantalla: el contrato_uid VIGENTE del contrato (o del contrato del soporte).
const idnC = (numero: string) => { const u = sql(`select contrato_uid from public.ventas where numero_contrato = '${numero}'`).trim(); return u ? { [numero]: u } : {}; };
const idnS = (id: number) => { const n = sql(`select numero_contrato from public.contrato_soportes_pago where id = ${id}`).trim(); return n ? idnC(n) : {}; };
const subir = (uid: string, numero: string, bytes = pdf(), nombre = "comprobante.pdf", tipo = "application/pdf") => { uidSesion = uid; return acc.subirSoporte(formulario(bytes, nombre, tipo, { numero }), idnC(numero)); };
const filas = (num: string) => sql(`select id || '|' || vigente || '|' || coalesce(motivo_retiro,'') || '|' || sha256 || '|' || path from public.contrato_soportes_pago where numero_contrato = '${num}' order by id`).split("\n").filter(Boolean).map((l) => { const [id, vigente, motivo, h, path] = l.split("|"); return { id: Number(id), vigente: vigente === "true", motivo, sha: h, path }; });
const vigentes = (num: string) => filas(num).filter((f) => f.vigente);
const objetosDe = (num: string) => [...almacen.keys()].filter((k) => k.startsWith(`soportes-pago/${num}/`));
const nombreDe = (r: { ok: boolean; error?: string }) => (r.ok ? "ok" : r.error);


// ══════════════════════════════════════════════════════════════════════════
// 339 · UN SOPORTE ADICIONAL: soportes vigentes <= pagos registrados + 1. Acciones REALES (subirSoporte, reemplazarSoporte, retirarSoporte, registrarAbono, sondearAvisos)
// sobre PostgreSQL + PostgREST locales y desechables con las migraciones 001-326 + 339. Solo se simulan la sesión y Storage (en memoria).
// ══════════════════════════════════════════════════════════════════════════
const abonosInternos = await import("../app/(dashboard)/dashboard/contratos/actions.ts");
const RE_LIMITE = /máximo de soportes vigentes/;
const NUM = { CERO: "DTM-8201", UNO: "DTM-8202", DOS: "DTM-8203", ULTIMO: "DTM-8204", CERO_CARRERA: "DTM-8205", PAGO: "DTM-8206", AJENO: "DTM-8207", DUP: "DTM-8208" };

/** Todo lo financiero que subir evidencia NO debe tocar, en una sola huella (contenido de filas, no solo conteos). */
function huellaFinanciera(num: string): Record<string, string> {
  const q = (s: string) => sql(s).trim();
  return {
    venta: q(`select md5(to_jsonb(v)::text) from public.ventas v where numero_contrato = '${num}'`),
    estado: q(`select estado from public.ventas where numero_contrato = '${num}'`),
    abonos: q(`select coalesce(md5(string_agg(to_jsonb(a)::text, '|' order by a.id)), 'sin-abonos') || ':' || count(*) || ':' || coalesce(sum(a.valor_abono), 0) from public.abonos a where numero_contrato = '${num}'`),
    abonosAnulados: q(`select count(*) from public.abonos_anulados where numero_contrato = '${num}'`),
    cxp: q(`select coalesce(md5(string_agg(to_jsonb(c)::text, '|' order by c.id)), 'sin-cxp') from public.cuentas_por_pagar c where numero_contrato = '${num}'`),
    previstas: q(`select count(*) from public.contrato_obligaciones_previstas where numero_contrato = '${num}'`),
    comisiones: q(`select count(*) from public.aliados_b2b where numero_contrato = '${num}'`),
    asientos: q(`select count(*) from public.asientos_contables`),
    lineas: q(`select count(*) from public.asiento_lineas`),
    sillas: q(`select count(*) from public.sillas where numero_contrato = '${num}'`),
    saldo: q(`select (v.precio_venta - coalesce((select sum(a.valor_abono) from public.abonos a where a.numero_contrato = v.numero_contrato), 0))::text from public.ventas v where v.numero_contrato = '${num}'`),
  };
}
const contratosDe = (cond: string) => sql(`select string_agg(numero_contrato, ',' order by numero_contrato) from public.ventas where ${cond}`);

before(() => {
  sql(`
    insert into auth.users (id, email) values ${Object.entries(PERFIL).map(([id, p]) => `('${id}', '${p.email}')`).join(", ")} on conflict do nothing;
    insert into public.aliados (id, nombre, tipo, nit, activo) values
      (8101, 'Agencia Alfa 339', 'agencia', '900339001', true), (8102, 'Freelance Beta 339', 'freelance', '1033900002', true),
      (8103, 'Freelance Gamma 339', 'freelance', '1033900003', true), (8105, 'Freelance Epsilon 339', 'freelance', '1033900005', true), (8104, 'Freelance Delta 339', 'freelance', '1033900004', true) on conflict (id) do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
      ${Object.entries(PERFIL).map(([id, p]) => `('${id}', '${p.email}', '${p.nombre}', '${p.rol}', ${p.activo}, '${p.tenant}', ${p.aliado ?? "null"})`).join(", ")}
      on conflict (id) do update set nombre = excluded.nombre, email = excluded.email, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id;
    insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, agencia_nombre, freelance_nombre, tipo_asesor, asesor) values
      ('${NUM.CERO}', 'Cliente 8201', 'mayorista', 'CARTAGENA', current_date + 30, 'pendiente', 1000000, 'COP', 8101, 'Agencia Alfa 339', null, 'agencia', 'Asesor 281'),
      ('${NUM.UNO}', 'Cliente 8202', 'mayorista', 'CARTAGENA', current_date + 30, 'confirmado', 1000000, 'COP', 8101, 'Agencia Alfa 339', null, 'agencia', 'Asesor 281'),
      ('${NUM.DOS}', 'Cliente 8203', 'mayorista', 'CARTAGENA', current_date + 30, 'confirmado', 1000000, 'COP', 8101, 'Agencia Alfa 339', null, 'agencia', 'Asesor 281'),
      ('${NUM.ULTIMO}', 'Cliente 8204', 'mayorista', 'CARTAGENA', current_date + 30, 'confirmado', 1000000, 'COP', 8101, 'Agencia Alfa 339', null, 'agencia', 'Asesor 281'),
      ('${NUM.CERO_CARRERA}', 'Cliente 8205', 'mayorista', 'CARTAGENA', current_date + 30, 'pendiente', 1000000, 'COP', 8101, 'Agencia Alfa 339', null, 'agencia', 'Asesor 281'),
      ('${NUM.PAGO}', 'Cliente 8206', 'mayorista', 'CARTAGENA', current_date + 30, 'confirmado', 1000000, 'COP', 8101, 'Agencia Alfa 339', null, 'agencia', 'Asesor 281'),
      ('${NUM.AJENO}', 'Cliente 8207', 'mayorista', 'SANTA MARTA', current_date + 30, 'pendiente', 800000, 'COP', 8102, null, 'Freelance Beta 339', 'freelance', 'Asesor 281'),
      ('${NUM.DUP}', 'Cliente 8208', 'mayorista', 'CARTAGENA', current_date + 30, 'confirmado', 1000000, 'COP', 8101, 'Agencia Alfa 339', null, 'agencia', 'Asesor 281');
    insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) values
      ('${NUM.UNO}', 100000, 'Transferencia', 'mayorista'),
      ('${NUM.DOS}', 100000, 'Transferencia', 'mayorista'), ('${NUM.DOS}', 100000, 'Transferencia', 'mayorista'),
      ('${NUM.ULTIMO}', 100000, 'Transferencia', 'mayorista'),
      ('${NUM.PAGO}', 100000, 'Transferencia', 'mayorista'),
      ('${NUM.DUP}', 100000, 'Transferencia', 'mayorista');
  `);
});

describe("339 · contrato SIN pagos registrados: cabe exactamente 1 soporte", () => {
  test("el primer soporte entra; el segundo se rechaza ANTES de subir nada (precomprobación del servidor)", async () => {
    subidas = [];
    assert.equal(nombreDe(await subir(U.A, NUM.CERO, pdf(300))), "ok");
    assert.equal(vigentes(NUM.CERO).length, 1);
    const antes = subidas.length;
    const r = await subir(U.A, NUM.CERO, pdf(301));
    assert.match(r.ok ? "" : r.error, RE_LIMITE);
    assert.equal(subidas.length, antes, "la precomprobación evitó subir el archivo");
    assert.equal(vigentes(NUM.CERO).length, 1);
    assert.equal(objetosDe(NUM.CERO).length, 1);
  });

  test("si la precomprobación falla, la BASE rechaza igual (autoridad) y el objeto nuevo se limpia", async () => {
    fallos = [/\/abonos\?select=id/]; borrados = [];
    const r = await subir(U.A, NUM.CERO, pdf(302));
    fallos = [];
    assert.match(r.ok ? "" : r.error, RE_LIMITE);
    assert.equal(vigentes(NUM.CERO).length, 1);
    assert.equal(objetosDe(NUM.CERO).length, 1, "el objeto del intento rechazado no quedó");
    assert.equal(borrados.length, 1, "se borró solo el objeto recién subido");
  });
});

describe("339 · contrato con pagos: un soporte por pago + 1 adicional", () => {
  test("1 pago: caben 2; el tercero se rechaza", async () => {
    assert.equal(nombreDe(await subir(U.A, NUM.UNO, pdf(310))), "ok", "1.º (cubre el pago)");
    assert.equal(nombreDe(await subir(U.A, NUM.UNO, pdf(311))), "ok", "2.º (cupo adicional)");
    assert.equal(vigentes(NUM.UNO).length, 2);
    const r = await subir(U.A, NUM.UNO, pdf(313));
    assert.match(r.ok ? "" : r.error, RE_LIMITE);
    assert.equal(vigentes(NUM.UNO).length, 2);
  });

  test("2 pagos: caben 3; el cuarto se rechaza (también si el servidor deja pasar la precomprobación)", async () => {
    for (let i = 0; i < 3; i++) assert.equal(nombreDe(await subir(U.A, NUM.DOS, pdf(320 + i))), "ok", `soporte ${i + 1}`);
    assert.equal(vigentes(NUM.DOS).length, 3);
    fallos = [/\/abonos\?select=id/];
    const r = await subir(U.A, NUM.DOS, pdf(331));
    fallos = [];
    assert.match(r.ok ? "" : r.error, RE_LIMITE);
    assert.equal(vigentes(NUM.DOS).length, 3);
  });

  test("el INSERT directo (superusuario, sin pasar por la aplicación) también topa con el límite nuevo: la autoridad es la base", () => {
    const intento = (n: string) => {
      try {
        sql(`insert into public.contrato_soportes_pago (numero_contrato, tenant, path, nombre_original, mime, size_bytes, sha256, subido_por)
             values ('${NUM.DOS}', 'mayorista', '${NUM.DOS}/directo-${n}.pdf', 'directo.pdf', 'application/pdf', 10, '${"ab".repeat(32)}', '${U.A}')`);
        return "insertó";
      } catch (e) { return String((e as { stderr?: string }).stderr ?? e); }
    };
    assert.match(intento("1"), /SOPORTE_LIMITE.*máximo es abonos \+ 1 = 3/);
    assert.equal(vigentes(NUM.DOS).length, 3);
  });

  test("duplicado: el mismo archivo no ocupa dos cupos (la deduplicación por contenido sigue vigente)", async () => {
    const x = pdf(340), y = pdf(341);
    assert.equal(nombreDe(await subir(U.A, NUM.DUP, x)), "ok");
    assert.equal(nombreDe(await subir(U.A, NUM.DUP, x)), "ok", "reintento idéntico: éxito sin duplicar");
    assert.equal(vigentes(NUM.DUP).length, 1, "una sola fila para el mismo contenido");
    assert.equal(nombreDe(await subir(U.A, NUM.DUP, y)), "ok", "otro archivo: cupo adicional");
    assert.equal(vigentes(NUM.DUP).length, 2);
  });
});

describe("339 · reemplazar y retirar con el cupo adicional ocupado", () => {
  test("a tope (2 de 2 con 1 pago) reemplazar no cambia el conteo; retirar libera el cupo y el siguiente soporte entra", async () => {
    const [a, b] = vigentes(NUM.UNO);
    uidSesion = U.A;
    assert.equal(nombreDe(await acc.reemplazarSoporte(formulario(pdf(350), "nuevo.pdf", "application/pdf", { id: String(a.id) }), idnS(a.id))), "ok");
    assert.equal(vigentes(NUM.UNO).length, 2, "reemplazar no sube el conteo");
    const lleno = await subir(U.A, NUM.UNO, pdf(352));
    assert.match(lleno.ok ? "" : lleno.error, RE_LIMITE, "sigue lleno");
    assert.deepEqual(await acc.retirarSoporte(b.id, "ya no aplica", idnS(b.id)), { ok: true });
    assert.equal(vigentes(NUM.UNO).length, 1);
    assert.equal(nombreDe(await subir(U.A, NUM.UNO, pdf(353))), "ok", "el cupo retirado se puede volver a usar");
    assert.equal(vigentes(NUM.UNO).length, 2);
    assert.equal(filas(NUM.UNO).length, 4, "el historial conserva el reemplazado y el retirado");
  });
});

describe("339 · competencia por el ÚLTIMO cupo (concurrencia real)", () => {
  async function ronda(numero: string, competidores: number) {
    const bytes = Array.from({ length: competidores }, (_, i) => pdf(400 + i, Math.random() + i));
    return Promise.all(bytes.map(async (b) => { uidSesion = U.A; return acc.subirSoporte(formulario(b, "c.pdf", "application/pdf", { numero }), idnC(numero)); }));
  }
  test("contrato con 1 pago y 1 soporte (queda 1 cupo): de 3 subidas simultáneas gana exactamente 1", async () => {
    for (let n = 0; n < 4; n++) {
      const num = `DTM-83${n}1`;
      sql(`insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, agencia_nombre, tipo_asesor, asesor)
             values ('${num}', 'Carrera ${n}', 'mayorista', 'CARTAGENA', current_date + 30, 'confirmado', 1000000, 'COP', 8101, 'Agencia Alfa 339', 'agencia', 'Asesor 281');
           insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) values ('${num}', 100000, 'Transferencia', 'mayorista');`);
      assert.equal(nombreDe(await subir(U.A, num, pdf(390 + n))), "ok");
      subidas = []; borrados = [];
      const rs = await ronda(num, 3);
      assert.equal(rs.filter((r) => r.ok).length, 1, `ronda ${n}: exactamente un ganador (${rs.map((r) => (r.ok ? "ok" : r.error)).join(" | ")})`);
      for (const r of rs.filter((x) => !x.ok)) assert.match((r as { error: string }).error, RE_LIMITE);
      assert.equal(vigentes(num).length, 2, `ronda ${n}: nunca más de abonos + 1`);
      assert.equal(objetosDe(num).length, 2, `ronda ${n}: ningún objeto huérfano de los perdedores`);
    }
  });
  test("contrato SIN pagos (1 cupo): de 3 subidas simultáneas gana exactamente 1", async () => {
    for (let n = 0; n < 4; n++) {
      const num = `DTM-83${n}2`;
      sql(`insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, agencia_nombre, tipo_asesor, asesor)
             values ('${num}', 'Carrera cero ${n}', 'mayorista', 'CARTAGENA', current_date + 30, 'pendiente', 1000000, 'COP', 8101, 'Agencia Alfa 339', 'agencia', 'Asesor 281')`);
      const rs = await ronda(num, 3);
      assert.equal(rs.filter((r) => r.ok).length, 1, `ronda ${n}: exactamente un ganador`);
      assert.equal(vigentes(num).length, 1);
      assert.equal(objetosDe(num).length, 1);
    }
  });
});

describe("339 · registrar un pago abre el siguiente cupo (acción real registrarAbono)", () => {
  test("1 pago + 2 soportes = lleno; se registra un pago real y entra un soporte más; vuelve a llenarse", async () => {
    assert.equal(nombreDe(await subir(U.A, NUM.PAGO, pdf(500))), "ok");
    assert.equal(nombreDe(await subir(U.A, NUM.PAGO, pdf(501))), "ok");
    const lleno = await subir(U.A, NUM.PAGO, pdf(502));
    assert.match(lleno.ok ? "" : lleno.error, RE_LIMITE, "lleno con 1 pago");
    const antes = huellaFinanciera(NUM.PAGO);
    uidSesion = U.GER;
    const r = await abonosInternos.registrarAbono(NUM.PAGO, 100000, "Transferencia", "REF-339", undefined, undefined, undefined, randomUUID(), idnC(NUM.PAGO));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(Number(sql(`select count(*) from public.abonos where numero_contrato = '${NUM.PAGO}'`)), 2, "el pago lo registró el equipo, no la subida");
    assert.equal(sql(`select estado from public.ventas where numero_contrato = '${NUM.PAGO}'`), "confirmado");
    assert.notEqual(huellaFinanciera(NUM.PAGO).abonos, antes.abonos, "registrar el pago SÍ cambia lo financiero (control de la sonda)");
    assert.equal(nombreDe(await subir(U.A, NUM.PAGO, pdf(503))), "ok", "el pago registrado abrió el siguiente cupo");
    assert.equal(vigentes(NUM.PAGO).length, 3);
    const lleno2 = await subir(U.A, NUM.PAGO, pdf(504));
    assert.match(lleno2.ok ? "" : lleno2.error, RE_LIMITE, "con 2 pagos y 3 soportes vuelve a estar lleno");
  });
});

describe("339 · subir evidencia NO toca nada financiero", () => {
  test("subir, subir rechazado, reemplazar y retirar dejan idéntico venta, abonos, CxP, previstas, comisiones, asientos, saldo y estado", async () => {
    const num = "DTM-8209";
    sql(`insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, agencia_nombre, tipo_asesor, asesor)
           values ('${num}', 'Cliente 8209', 'mayorista', 'CARTAGENA', current_date + 30, 'pendiente', 1200000, 'COP', 8101, 'Agencia Alfa 339', 'agencia', 'Asesor 281')`);
    const antes = huellaFinanciera(num);
    assert.equal(antes.estado, "pendiente");
    assert.equal(nombreDe(await subir(U.A, num, pdf(600))), "ok");
    const rechazo = await subir(U.A, num, pdf(601));
    assert.match(rechazo.ok ? "" : rechazo.error, RE_LIMITE, "segundo intento rechazado: 0 pagos = 1 cupo");
    const [s] = vigentes(num);
    uidSesion = U.A;
    assert.equal(nombreDe(await acc.reemplazarSoporte(formulario(pdf(602), "r.pdf", "application/pdf", { id: String(s.id) }), idnS(s.id))), "ok");
    const [s2] = vigentes(num);
    assert.deepEqual(await acc.retirarSoporte(s2.id, undefined, idnS(s2.id)), { ok: true });
    assert.deepEqual(huellaFinanciera(num), antes, "ninguna fila financiera cambió");
    assert.equal(sql(`select estado from public.ventas where numero_contrato = '${num}'`), "pendiente", "el contrato NO se confirmó");
    assert.equal(Number(sql(`select count(*) from public.abonos where numero_contrato = '${num}'`)), 0, "ningún pago nació de la subida");
  });
});

describe("339 · avisos internos (sin cambios)", () => {
  test("el soporte del cupo adicional avisa igual al personal correcto; los rechazos no avisan; el aviso se reclama y lleva al contrato", async () => {
    const num = "DTM-8210";
    sql(`insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, agencia_nombre, tipo_asesor, asesor)
           values ('${num}', 'Cliente 8210', 'mayorista', 'CARTAGENA', current_date + 30, 'pendiente', 900000, 'COP', 8101, 'Agencia Alfa 339', 'agencia', 'Asesor 281');
         delete from public.avisos`);
    assert.equal(nombreDe(await subir(U.A, num, pdf(700))), "ok", "0 pagos: el soporte adicional");
    const rec = (uid: string) => Number(sql(`select count(*) from public.avisos where usuario_id = '${uid}' and numero_contrato = '${num}' and tipo = 'soporte_pago_nuevo'`));
    assert.equal(rec(U.GER), 1, "gerencia de la agencia");
    assert.equal(rec(U.SUP), 1, "superadmin");
    assert.equal(rec(U.VENTA), 1, "el asesor del contrato (identificado sin ambigüedad)");
    for (const uid of [U.A, U.GERMIN, U.VENTAMIN, U.B, U.PART, U.VENTA2]) assert.equal(rec(uid), 0, `sin aviso para ${PERFIL[uid].nombre}`);
    const antes = Number(sql("select count(*) from public.avisos"));
    const rechazo = await subir(U.A, num, pdf(701));
    assert.match(rechazo.ok ? "" : rechazo.error, RE_LIMITE);
    assert.equal(Number(sql("select count(*) from public.avisos")), antes, "un rechazo por límite no genera avisos");
    uidSesion = U.GER;
    const r = await avi.sondearAvisos(true);
    const n = r.nuevos.find((x) => x.numero_contrato === num);
    assert.ok(n, "la gerencia recibe el aviso al reclamar");
    assert.equal(n!.href, `/dashboard/contratos/${num}`);
    assert.deepEqual(Object.keys(n!).sort(), ["atendida", "creado_en", "href", "id", "leido", "numero_contrato", "tipo"], "el aviso sigue sin datos del cliente ni del archivo");
    // reemplazo: aviso distinto, como antes
    const [v] = vigentes(num); uidSesion = U.A;
    assert.equal(nombreDe(await acc.reemplazarSoporte(formulario(pdf(702), "r.pdf", "application/pdf", { id: String(v.id) }), idnS(v.id))), "ok");
    assert.equal(Number(sql(`select count(*) from public.avisos where usuario_id = '${U.GER}' and numero_contrato = '${num}' and tipo = 'soporte_pago_reemplazado'`)), 1);
  });
});

describe("339 · acceso no autorizado sigue denegado (el cupo adicional no abre puertas)", () => {
  const sinCambios = (num: string, etiqueta: string, n0: number, o0: number) => {
    assert.equal(vigentes(num).length, n0, `${etiqueta}: sin filas nuevas`);
    assert.equal(objetosDe(num).length, o0, `${etiqueta}: sin objetos nuevos`);
  };
  test("sin sesión, otro aliado, quien solo participa por comisión, cuenta inactiva, aliado de otra agencia y personal interno NO suben (0 pagos = cupo libre, pero ajeno)", async () => {
    const n0 = vigentes(NUM.AJENO).length, o0 = objetosDe(NUM.AJENO).length;
    subidas = [];
    uidSesion = ""; assert.match(String((await acc.subirSoporte(formulario(pdf(800), "a.pdf", "application/pdf", { numero: NUM.AJENO }), idnC(NUM.AJENO))).ok), /false/);
    for (const [uid, quien] of [[U.A, "otro aliado de la misma agencia"], [U.PART, "participa por comisión"], [U.INACT, "cuenta inactiva"], [U.C, "aliado de otra agencia"], [U.GER, "gerencia"], [U.SUP, "superadmin"], [U.VENTA, "asesor"]] as const) {
      const r = await subir(uid, NUM.AJENO, pdf(801));
      assert.equal(r.ok, false, quien);
    }
    sinCambios(NUM.AJENO, "contrato ajeno", n0, o0);
    assert.equal(subidas.length, 0, "ni un solo archivo llegó a Storage");
    // el dueño sí
    assert.equal(nombreDe(await subir(U.B, NUM.AJENO, pdf(802))), "ok");
  });
  test("con el JWT de un aliado (rol authenticated) NO se puede llamar a soporte_registrar ni insertar en la tabla por la API: la autoridad sigue siendo solo del servidor", async () => {
    const n0 = vigentes(NUM.CERO_CARRERA).length;
    const sb = clienteLocal(jwt({ role: "authenticated", sub: U.A }), { id: U.A, email: PERFIL[U.A].email });
    const rpc = await sb.rpc("soporte_registrar", { p_numero: NUM.CERO_CARRERA, p_actor: U.A, p_path: `${NUM.CERO_CARRERA}/api.pdf`, p_nombre: "api.pdf", p_mime: "application/pdf", p_size: 10, p_sha: "ab".repeat(32) });
    assert.ok(rpc.error, "la RPC no es ejecutable por authenticated");
    const ins = await sb.from("contrato_soportes_pago").insert({ numero_contrato: NUM.CERO_CARRERA, tenant: "mayorista", path: `${NUM.CERO_CARRERA}/api2.pdf`, nombre_original: "x.pdf", mime: "application/pdf", size_bytes: 10, sha256: "cd".repeat(32), subido_por: U.A });
    assert.ok(ins.error, "el INSERT directo por la API está denegado");
    assert.equal(vigentes(NUM.CERO_CARRERA).length, n0);
  });
});
