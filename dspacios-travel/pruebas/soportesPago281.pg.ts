// #86 · Soportes de pago del aliado B2B — ACCIONES REALES (subir, reemplazar, retirar, abrir, avisos) contra PostgreSQL + PostgREST locales y desechables.
// Corren las Server Actions reales (app/portal/b2b/cartera/soportes-actions.ts, .../contratos/[numero]/soportes-actions.ts, lib/avisos/actions.ts) con sesiones de
// aliados de DISTINTAS agencias y de personal interno; la base (migraciones 001-281), la RLS y las funciones soporte_* son las reales.
// Lo ÚNICO simulado: la sesión (auth.getUser) y Storage (en memoria, solo para observar qué bytes llegan, qué se borra y para inyectar fallos).
// El comportamiento de un Storage real (límites, tipos, acceso) lo mide test_281_storage.sh con storage-api. SOLO base LOCAL desechable: la lanza test_281_acciones.sh.
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG281A_CONTENEDOR ?? "pg86soportes";
const DB = process.env.PG281A_BASE ?? "";
const PGRST = process.env.PG281A_POSTGREST ?? "";
const SECRETO = process.env.PG281A_JWT_SECRET ?? "";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG281A_BASE (desechable), PG281A_POSTGREST y PG281A_JWT_SECRET: usa supabase/scripts/test_281_acciones.sh.");

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
const subir = (uid: string, numero: string, bytes = pdf(), nombre = "comprobante.pdf", tipo = "application/pdf") => { uidSesion = uid; return acc.subirSoporte(formulario(bytes, nombre, tipo, { numero })); };
const filas = (num: string) => sql(`select id || '|' || vigente || '|' || coalesce(motivo_retiro,'') || '|' || sha256 || '|' || path from public.contrato_soportes_pago where numero_contrato = '${num}' order by id`).split("\n").filter(Boolean).map((l) => { const [id, vigente, motivo, h, path] = l.split("|"); return { id: Number(id), vigente: vigente === "true", motivo, sha: h, path }; });
const vigentes = (num: string) => filas(num).filter((f) => f.vigente);
const objetosDe = (num: string) => [...almacen.keys()].filter((k) => k.startsWith(`soportes-pago/${num}/`));
const nombreDe = (r: { ok: boolean; error?: string }) => (r.ok ? "ok" : r.error);

before(() => {
  sql(`
    insert into auth.users (id, email) values ${Object.entries(PERFIL).map(([id, p]) => `('${id}', '${p.email}')`).join(", ")} on conflict do nothing;
    insert into public.aliados (id, nombre, tipo, nit, activo) values
      (8101, 'Agencia Alfa 281', 'agencia', '900281001', true), (8102, 'Freelance Beta 281', 'freelance', '1028100002', true),
      (8103, 'Freelance Gamma 281', 'freelance', '1028100003', true), (8105, 'Freelance Epsilon 281', 'freelance', '1028100005', true), (8104, 'Freelance Delta 281', 'freelance', '1028100004', true) on conflict (id) do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values
      ${Object.entries(PERFIL).map(([id, p]) => `('${id}', '${p.email}', '${p.nombre}', '${p.rol}', ${p.activo}, '${p.tenant}', ${p.aliado ?? "null"})`).join(", ")}
      on conflict (id) do update set nombre = excluded.nombre, email = excluded.email, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id;
    insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, agencia_nombre, freelance_nombre, tipo_asesor, asesor) values
      ('DTM-8101', 'Cliente 8101', 'mayorista', 'CARTAGENA', current_date + 20, 'confirmado', 1000000, 'COP', 8101, 'Agencia Alfa 281', null, 'agencia', 'Asesor 281'),
      ('DTM-8102', 'Cliente 8102', 'mayorista', 'SANTA MARTA', current_date + 20, 'confirmado', 800000, 'COP', 8102, null, 'Freelance Beta 281', 'freelance', 'Asesor 281'),
      ('DTM-8105', 'Cliente 8105', 'mayorista', 'CARTAGENA', current_date + 20, 'confirmado', 700000, 'COP', 8101, 'Agencia Alfa 281', null, 'agencia', 'Asesor 281'),
      ('DTM-8104', 'Cliente 8104', 'mayorista', 'CARTAGENA', current_date + 20, 'confirmado', 900000, 'COP', 8101, 'Agencia Alfa 281', null, 'agencia', 'Asesor 281'),
      ('MIN-8103', 'Cliente 8103', 'minorista', 'SAN ANDRES', current_date + 20, 'activo', 500000, 'COP', 8103, null, 'Freelance Gamma 281', 'freelance', 'Asesor 281');
    insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) values
      ('DTM-8101', 100, 'Transferencia', 'mayorista'), ('DTM-8101', 100, 'Transferencia', 'mayorista'), ('DTM-8101', 100, 'Transferencia', 'mayorista'),
      ('DTM-8102', 100, 'Transferencia', 'mayorista'), ('MIN-8103', 100, 'Transferencia', 'minorista'),
      ('DTM-8104', 100, 'Transferencia', 'mayorista'), ('DTM-8104', 100, 'Transferencia', 'mayorista'), ('DTM-8104', 100, 'Transferencia', 'mayorista'),
      ('DTM-8105', 100, 'Transferencia', 'mayorista'), ('DTM-8105', 100, 'Transferencia', 'mayorista'), ('DTM-8105', 100, 'Transferencia', 'mayorista');
    insert into public.aliados_b2b (numero_contrato, aliado, aliado_id, tenant) values ('DTM-8101', 'Freelance Delta 281', 8104, 'mayorista');
  `);
});

describe("subir: pertenencia, contenido y mismos bytes", () => {
  test("la dueña sube a su contrato; los bytes validados son los que se guardan y se hashean", async () => {
    const bytes = pdf(500);
    subidas = [];
    const r = await subir(U.A, "DTM-8101", bytes);
    assert.equal(nombreDe(r), "ok");
    const f = vigentes("DTM-8101");
    assert.equal(f.length, 1);
    assert.equal(subidas.length, 1);
    assert.equal(subidas[0].sha, sha(bytes), "lo que llegó a Storage es exactamente lo que el aliado envió");
    assert.equal(f[0].sha, sha(bytes), "el hash registrado es el de esos mismos bytes");
    assert.ok(f[0].path.startsWith("DTM-8101/") && f[0].path.endsWith(".pdf"), "la ruta la genera el servidor: contrato/uuid.ext");
    assert.ok(almacen.has(`soportes-pago/${f[0].path}`));
  });

  test("un aliado de OTRA agencia, uno del mismo tenant, quien solo participa por comisión y una cuenta inactiva NO suben a un contrato ajeno", async () => {
    for (const uid of [U.B, U.C, U.PART, U.INACT]) {
      const antes = [filas("DTM-8101").length, almacen.size];
      const r = await subir(uid, "DTM-8101");
      assert.equal(r.ok, false, `${PERFIL[uid].nombre} no debe poder subir`);
      assert.deepEqual([filas("DTM-8101").length, almacen.size], antes, "ni fila ni objeto");
    }
    const r2 = await subir(U.A, "MIN-8103");   // la dueña de Mayorista tampoco sube a un contrato ajeno de Minorista
    assert.equal(r2.ok, false);
  });

  test("sin sesión y con un rol interno no se sube nada", async () => {
    assert.equal((await subir("", "DTM-8101")).ok, false);
    assert.equal((await subir(U.GER, "DTM-8101")).ok, false);
  });

  test("el contenido real manda: ejecutable renombrado, vacío y demasiado grande se rechazan; el tipo declarado no engaña", async () => {
    const antes = almacen.size;
    assert.equal((await subir(U.B, "DTM-8102", Buffer.from("MZ\x90\x00 ejecutable"), "factura.pdf", "application/pdf")).ok, false);
    assert.equal((await subir(U.B, "DTM-8102", Buffer.alloc(0))).ok, false);
    assert.equal((await subir(U.B, "DTM-8102", pdf(4_100_000))).ok, false);
    assert.equal(almacen.size, antes, "nada llegó a Storage");
    const r = await subir(U.B, "DTM-8102", png(), "foto.pdf", "application/pdf");   // PNG real con nombre/tipo declarados de PDF
    assert.equal(nombreDe(r), "ok");
    assert.equal([...almacen.entries()].find(([k]) => k.startsWith("soportes-pago/DTM-8102/"))?.[1].mime, "image/png", "se guarda el tipo REAL");
  });
});

describe("límite = abonos, reemplazo y retiro con historial", () => {
  test("el límite se respeta y no deja objetos de más", async () => {
    assert.equal(nombreDe(await subir(U.A, "DTM-8101")), "ok");
    assert.equal(nombreDe(await subir(U.A, "DTM-8101")), "ok");
    assert.equal(vigentes("DTM-8101").length, 3);
    const antes = objetosDe("DTM-8101").length;
    const r = await subir(U.A, "DTM-8101");
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /un soporte vigente por cada abono/);
    assert.equal(objetosDe("DTM-8101").length, antes, "el 4.º no subió nada a Storage");
  });

  test("la base rechaza aunque el aviso temprano falle; el objeto nuevo se limpia y el anterior no se toca", async () => {
    // DTM-8102: 1 abono y ya 1 soporte vigente. Se anula la lectura del conteo de abonos para saltar el aviso temprano.
    assert.equal(vigentes("DTM-8102").length, 1);
    const original = objetosDe("DTM-8102");
    fallos = [/\/abonos\?select=id/];
    borrados = [];
    const r = await subir(U.B, "DTM-8102");
    fallos = [];
    assert.equal(r.ok, false);
    assert.deepEqual(objetosDe("DTM-8102"), original, "compensación: el objeto nuevo se borró y el previo quedó intacto");
    assert.equal(borrados.length, 1);
    assert.equal(filas("DTM-8102").length, 1);
  });

  test("si Storage falla al subir no queda nada; si falla la limpieza el huérfano se REPORTA", async () => {
    fallaSubida = true; const r1 = await subir(U.A, "DTM-8101"); fallaSubida = false;
    assert.equal(r1.ok, false);
    // limpieza fallida: se retira un soporte de DTM-8101 para tener cupo, y la base rechaza otro envío por la carrera de «dos pestañas»
    const registro: string[] = []; const original = console.error; console.error = (...a: unknown[]) => { registro.push(a.join(" ")); };
    fallos = [/\/abonos\?select=id/]; fallaBorrado = true;
    const r2 = await subir(U.B, "DTM-8102");
    fallos = []; fallaBorrado = false; console.error = original;
    assert.equal(r2.ok, false);
    assert.ok(registro.some((l) => l.includes("DTM-8102/")), "el objeto huérfano quedó registrado con su ruta");
    for (const k of objetosDe("DTM-8102")) if (!filas("DTM-8102").some((f) => `soportes-pago/${f.path}` === k)) almacen.delete(k);   // limpia el huérfano simulado
  });

  test("reemplazar: conserva el archivo y la fila anteriores, el conteo no cambia, y un ajeno no puede", async () => {
    const [primero] = vigentes("DTM-8101");
    uidSesion = U.B;
    const ajeno = await acc.reemplazarSoporte(formulario(pdf(), "x.pdf", "application/pdf", { id: String(primero.id) }));
    assert.equal(ajeno.ok, false, "otro aliado no reemplaza un soporte ajeno");
    uidSesion = U.A;
    const nuevo = pdf(700);
    const r = await acc.reemplazarSoporte(formulario(nuevo, "corregido.pdf", "application/pdf", { id: String(primero.id) }));
    assert.equal(nombreDe(r), "ok");
    assert.equal(vigentes("DTM-8101").length, 3, "reemplazar no cambia la cantidad vigente");
    const anterior = filas("DTM-8101").find((f) => f.id === primero.id)!;
    assert.deepEqual([anterior.vigente, anterior.motivo], [false, "reemplazo"]);
    assert.ok(almacen.has(`soportes-pago/${primero.path}`), "el archivo anterior sigue en Storage");
    assert.ok(vigentes("DTM-8101").some((f) => f.sha === sha(nuevo)));
    const otra = await acc.reemplazarSoporte(formulario(pdf(), "otra.pdf", "application/pdf", { id: String(primero.id) }));
    assert.equal(otra.ok, false, "reemplazar dos veces la misma versión falla con mensaje, sin duplicar");
  });

  test("retirar: conserva archivo e historial; no se retira dos veces; un ajeno no retira", async () => {
    const [v] = vigentes("DTM-8101");
    uidSesion = U.C;
    assert.equal((await acc.retirarSoporte(v.id)).ok, false);
    uidSesion = U.A;
    assert.equal(nombreDe(await acc.retirarSoporte(v.id, "se cargó por error")), "ok");
    const f = filas("DTM-8101").find((x) => x.id === v.id)!;
    assert.deepEqual([f.vigente, f.motivo], [false, "retiro"]);
    assert.ok(almacen.has(`soportes-pago/${v.path}`), "el archivo retirado se conserva");
    assert.equal((await acc.retirarSoporte(v.id)).ok, false);
    assert.equal(vigentes("DTM-8101").length, 2);
  });
});

describe("contrato EXCEDIDO tras anular un abono (RPC real de la 248)", () => {
  test("reemplazar y retirar funcionan; subir uno nuevo no; la anulación no se bloquea ni borra evidencia", async () => {
    assert.equal(nombreDe(await subir(U.A, "DTM-8101")), "ok");          // 3/3 de nuevo
    const total = filas("DTM-8101").length;
    const abono = Number(sql("select min(id) from public.abonos where numero_contrato = 'DTM-8101'"));
    const resp = sql(`set role service_role; select public.anular_abono(${abono}, 'DTM-8101', 'mayorista', '${U.GER}', 'prueba exceso')`);
    assert.match(resp, /anulado/);
    assert.equal(Number(sql("select count(*) from public.abonos where numero_contrato = 'DTM-8101'")), 2);
    assert.equal(vigentes("DTM-8101").length, 3, "3 vigentes > 2 abonos: excedido, calculado");
    assert.equal(filas("DTM-8101").length, total, "anular no tocó los soportes");

    assert.equal((await subir(U.A, "DTM-8101")).ok, false, "excedido: no se agregan nuevos");
    const [v] = vigentes("DTM-8101");
    uidSesion = U.A;
    assert.equal(nombreDe(await acc.reemplazarSoporte(formulario(pdf(), "r.pdf", "application/pdf", { id: String(v.id) }))), "ok");
    assert.equal(vigentes("DTM-8101").length, 3, "reemplazar mantiene el conteo aun excedido");
    const [w] = vigentes("DTM-8101");
    assert.equal(nombreDe(await acc.retirarSoporte(w.id)), "ok");
    assert.equal(vigentes("DTM-8101").length, 2, "retirar baja el exceso");
    assert.equal((await subir(U.A, "DTM-8101")).ok, false, "con 2 de 2 tampoco caben más");
  });
});

describe("abrir: aliado propio y personal interno", () => {
  test("el aliado abre solo vigentes de contratos propios", async () => {
    const [v] = vigentes("DTM-8101");
    uidSesion = U.A;
    const ok = await acc.urlSoporteAliado(v.id);
    assert.equal(ok.ok, true);
    for (const uid of [U.B, U.C, U.PART, U.INACT, U.GER]) { uidSesion = uid; assert.equal((await acc.urlSoporteAliado(v.id)).ok, false, PERFIL[uid].nombre); }
    const retirado = filas("DTM-8101").find((f) => !f.vigente)!;
    uidSesion = U.A;
    assert.equal((await acc.urlSoporteAliado(retirado.id)).ok, false, "un soporte retirado ya no se abre desde el portal");
  });

  test("el personal interno abre por RLS: gerencia de su agencia y el asesor del contrato sí; otra agencia, otro asesor y sin sesión no", async () => {
    const retirado = filas("DTM-8101").find((f) => !f.vigente)!;
    for (const [uid, esperado] of [[U.GER, true], [U.VENTA, true], [U.GERMIN, false], [U.VENTA2, false], ["", false], [U.A, false], [U.INACT, false]] as const) {
      uidSesion = uid;
      const r = await interno.urlSoporteInterno(retirado.id);   // también el historial (retirado) está disponible internamente
      assert.equal(r.ok, esperado, `${uid ? PERFIL[uid].nombre : "sin sesión"}`);
    }
  });
});

describe("avisos internos", () => {
  test("destinatarios inequívocos; el contenido no revela datos; sin duplicados entre pestañas; reclamar ≠ leído", async () => {
    sql("delete from public.avisos");
    const [v] = vigentes("DTM-8102");
    uidSesion = U.B;
    assert.equal(nombreDe(await acc.reemplazarSoporte(formulario(pdf(), "n.pdf", "application/pdf", { id: String(v.id) }))), "ok");

    // sin reclamar: el aviso queda sin tocar
    uidSesion = U.GER;
    const sinReclamar = await avi.sondearAvisos(false);
    assert.equal(sinReclamar.nuevos.length, 0);
    assert.ok(sinReclamar.noLeidos >= 1);
    assert.equal(Number(sql(`select count(*) from public.avisos where usuario_id = '${U.GER}' and notificado_en is not null`)), 0, "no reclamar no marca nada");

    // dos pestañas a la vez: cada aviso sale una sola vez
    const [a, b] = await Promise.all([avi.sondearAvisos(true), avi.sondearAvisos(true)]);
    const ids = [...a.nuevos, ...b.nuevos].map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, "sin duplicados");
    assert.equal(ids.length, sinReclamar.noLeidos, "entre las dos salen todos los pendientes, una sola vez");
    const n = (a.nuevos[0] ?? b.nuevos[0])!;
    assert.deepEqual(Object.keys(n).sort(), ["creado_en", "href", "id", "leido", "numero_contrato", "tipo"], "solo tipo, contrato y destino: ni cliente, ni montos, ni nombre de archivo");
    assert.equal(n.href, `/dashboard/contratos/${n.numero_contrato}`);
    assert.equal(a.noLeidos, sinReclamar.noLeidos, "reclamar NO marca leído");
    const otra = await avi.sondearAvisos(true);
    assert.equal(otra.nuevos.length, 0, "el mismo evento no se vuelve a entregar");
    assert.equal(otra.noLeidos, sinReclamar.noLeidos);

    // marcar leído
    assert.deepEqual(await avi.marcarAvisosLeidos(), { ok: true });
    assert.equal((await avi.sondearAvisos(false)).noLeidos, 0);

    // asesor del contrato sí; otro asesor, gerencia de la otra agencia y el propio aliado no
    uidSesion = U.VENTA; assert.ok((await avi.sondearAvisos(false)).noLeidos >= 1, "el asesor identificado sin ambigüedad recibe el aviso");
    for (const uid of [U.VENTA2, U.GERMIN, U.B, U.PART]) { uidSesion = uid; assert.equal((await avi.sondearAvisos(false)).noLeidos, 0, PERFIL[uid].nombre); }
    uidSesion = U.VENTA; const aviso = (await avi.sondearAvisos(false)).recientes[0];
    assert.equal(aviso.href, `/dashboard/contratos/${aviso.numero_contrato}`);
  });

  test("un usuario inactivo o sin sesión no recibe nada, y un aliado ve su propio portal como destino", async () => {
    uidSesion = ""; assert.deepEqual(await avi.sondearAvisos(true), { nuevos: [], noLeidos: 0, recientes: [] });
    uidSesion = U.INACT; assert.equal((await avi.sondearAvisos(true)).noLeidos, 0);
    sql(`insert into public.avisos (usuario_id, tipo, numero_contrato) values ('${U.A}', 'soporte_pago_nuevo', 'DTM-8101')`);
    uidSesion = U.A; const r = await avi.sondearAvisos(false);
    assert.equal(r.recientes[0].href, "/portal/b2b/cartera?vista=soportes");
  });
});

describe("confirmación incierta del registro: nunca se arriesga evidencia registrada", () => {
  const avisosDe = (num: string) => Number(sql(`select count(*) from public.avisos where numero_contrato = '${num}'`));
  const capturar = () => { const log: string[] = []; const o = console.error; console.error = (...a: unknown[]) => { log.push(a.join(" ")); }; return { log, restaurar: () => { console.error = o; } }; };

  test("la fila SÍ se guardó pero la respuesta se perdió: éxito confirmado por la ruta, archivo conservado y el reintento NO duplica soportes ni avisos", async () => {
    const bytes = pdf(900);
    borrados = [];
    respuestaPerdida = [/\/rpc\/soporte_registrar/];
    const r = await subir(U.A, "DTM-8104", bytes);
    respuestaPerdida = [];
    assert.equal(nombreDe(r), "ok", "la base lo tenía confirmado");
    assert.equal(filas("DTM-8104").length, 1, "la fila persistió");
    assert.equal(objetosDe("DTM-8104").length, 1, "el archivo se conservó");
    assert.deepEqual(borrados, [], "no se borró nada");
    const avisosAntes = avisosDe("DTM-8104"), subidasAntes = subidas.length;
    assert.ok(avisosAntes > 0);

    const retry = await subir(U.A, "DTM-8104", bytes);   // la persona vuelve a pulsar «Subir» con el mismo archivo
    assert.equal(nombreDe(retry), "ok");
    assert.equal(filas("DTM-8104").length, 1, "sin soporte duplicado");
    assert.equal(objetosDe("DTM-8104").length, 1, "sin objeto duplicado");
    assert.equal(subidas.length, subidasAntes, "ni siquiera se volvió a subir");
    assert.equal(avisosDe("DTM-8104"), avisosAntes, "sin avisos duplicados");
  });

  test("la fila se guardó, la respuesta se perdió Y no se puede confirmar: se conserva el archivo, se registra para conciliación y el reintento no duplica", async () => {
    const bytes = pdf(901);
    const cap = capturar(); borrados = [];
    respuestaPerdida = [/\/rpc\/soporte_registrar/];
    fallos = [/\/contrato_soportes_pago\?select=id&path=/];     // la consulta por ruta también falla
    const r = await subir(U.A, "DTM-8104", bytes);
    respuestaPerdida = []; fallos = []; cap.restaurar();
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /El archivo se conservó/);
    assert.ok(cap.log.some((l) => l.includes("CONCILIAR") && l.includes("DTM-8104/")), "quedó registrado para conciliación, con la ruta");
    assert.equal(filas("DTM-8104").length, 2, "la fila SÍ persistió (la base la confirmó)");
    assert.equal(objetosDe("DTM-8104").length, 2, "el archivo, con vínculo real, NO se borró");
    assert.deepEqual(borrados, []);
    const avisosAntes = avisosDe("DTM-8104"), subidasAntes = subidas.length;

    const retry = await subir(U.A, "DTM-8104", bytes);
    assert.equal(nombreDe(retry), "ok", "el contenido ya está vigente: el reintento es un no-op");
    assert.equal(filas("DTM-8104").length, 2);
    assert.equal(subidas.length, subidasAntes);
    assert.equal(avisosDe("DTM-8104"), avisosAntes);
  });

  test("la petición NUNCA llegó a la base: el archivo también se conserva (podría estar en vuelo), se concilia, y el reintento registra sin perder nada", async () => {
    const bytes = pdf(902);
    const cap = capturar(); borrados = [];
    peticionPerdida = [/\/rpc\/soporte_registrar/];
    const r = await subir(U.A, "DTM-8104", bytes);
    peticionPerdida = []; cap.restaurar();
    assert.equal(r.ok, false);
    assert.ok(cap.log.some((l) => l.includes("CONCILIAR")), "se registró la situación");
    assert.equal(filas("DTM-8104").length, 2, "no hay fila nueva");
    assert.equal(objetosDe("DTM-8104").length, 3, "pero el objeto subido se conservó sin borrarse");
    assert.deepEqual(borrados, [], "nunca se borró evidencia posible");

    const retry = await subir(U.A, "DTM-8104", bytes);
    assert.equal(nombreDe(retry), "ok");
    assert.equal(vigentes("DTM-8104").length, 3);
    assert.equal(objetosDe("DTM-8104").length, 4, "queda UN objeto huérfano conservado para conciliar (el del primer intento): costo asumido a propósito");
  });

  test("un rechazo definitivo de la base (límite) SÍ limpia el objeto nuevo, y no toca los registrados", async () => {
    const antes = objetosDe("DTM-8104").length;
    fallos = [/\/abonos\?select=id/];                 // salta el aviso temprano: la base decide
    const r = await subir(U.A, "DTM-8104", pdf(903));
    fallos = [];
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /un soporte vigente por cada abono/);
    assert.equal(objetosDe("DTM-8104").length, antes, "se limpió solo el objeto recién subido");
    assert.equal(vigentes("DTM-8104").length, 3);
  });
});

describe("reemplazar: la deduplicación se decide por el soporte SELECCIONADO y su sucesor, no por un hash suelto del contrato", () => {
  const avisosDe = (num: string) => Number(sql(`select count(*) from public.avisos where numero_contrato = '${num}'`));
  const reemplazar = (id: number, bytes: Buffer) => { uidSesion = U.A; return acc.reemplazarSoporte(formulario(bytes, "r.pdf", "application/pdf", { id: String(id) })); };
  const C = "DTM-8105";
  const b1 = pdf(300), b2 = pdf(301), b3 = pdf(302), b4 = pdf(303);
  let s1 = 0, s2 = 0, s3 = 0;

  test("preparación: tres soportes con contenidos distintos en un contrato de 3 abonos", async () => {
    for (const b of [b1, b2, b3]) assert.equal(nombreDe(await subir(U.A, C, b)), "ok");
    [s1, s2, s3] = filas(C).map((f) => f.id);
    assert.equal(vigentes(C).length, 3);
  });

  test("1 · mismo archivo que el soporte seleccionado vigente = sin cambios (sin subir, sin fila, sin aviso)", async () => {
    const antes = { filas: filas(C).length, subidas: subidas.length, avisos: avisosDe(C) };
    assert.equal(nombreDe(await reemplazar(s1, b1)), "ok");
    assert.deepEqual({ filas: filas(C).length, subidas: subidas.length, avisos: avisosDe(C) }, antes);
    assert.equal(filas(C).find((f) => f.id === s1)!.vigente, true, "el seleccionado sigue vigente e intacto");
  });

  test("2 · coincide con OTRO soporte vigente: se EJECUTA el reemplazo pedido (no se devuelve un éxito falso dejando intacto el seleccionado)", async () => {
    const antes = { subidas: subidas.length, avisos: avisosDe(C), vig: vigentes(C).length };
    assert.equal(nombreDe(await reemplazar(s1, b2)), "ok", "b2 es idéntico al contenido de s2");
    const viejo = filas(C).find((f) => f.id === s1)!;
    assert.deepEqual([viejo.vigente, viejo.motivo], [false, "reemplazo"], "el seleccionado quedó reemplazado");
    assert.ok(almacen.has(`soportes-pago/${viejo.path}`), "su archivo se conserva");
    assert.equal(vigentes(C).length, antes.vig, "la cantidad vigente no cambia");
    assert.equal(vigentes(C).filter((f) => f.sha === sha(b2)).length, 2, "ahora hay dos soportes vigentes con el mismo contenido: permitido (el requisito limita cantidades, no prohíbe archivos iguales)");
    assert.equal(subidas.length, antes.subidas + 1, "se subió el archivo nuevo");
    assert.ok(avisosDe(C) > antes.avisos, "y se avisó");
  });

  test("3 · reintento tras respuesta perdida: se identifica por el sucesor del soporte original; no duplica filas, objetos ni avisos", async () => {
    respuestaPerdida = [/\/rpc\/soporte_reemplazar/];
    const r = await reemplazar(s3, b4);
    respuestaPerdida = [];
    assert.equal(nombreDe(r), "ok", "la base lo tenía confirmado");
    const suc = filas(C).find((f) => f.sha === sha(b4))!;
    assert.ok(suc, "el sucesor persistió");
    assert.equal(filas(C).find((f) => f.id === s3)!.vigente, false);
    const antes = { filas: filas(C).length, subidas: subidas.length, avisos: avisosDe(C), vig: vigentes(C).length };
    // la persona vuelve a pulsar «Reemplazar» sobre el MISMO soporte original con el mismo archivo
    assert.equal(nombreDe(await reemplazar(s3, b4)), "ok", "su sucesor trae ese contenido: el reemplazo ya ocurrió");
    assert.deepEqual({ filas: filas(C).length, subidas: subidas.length, avisos: avisosDe(C), vig: vigentes(C).length }, antes);
  });

  test("4 · un soporte retirado o ya reemplazado por OTRO contenido no produce éxito falso, aunque exista otro archivo idéntico vigente", async () => {
    // (a) retirado: s2 se retira; b2 sigue vigente en otro soporte (el sucesor de s1)
    assert.equal(nombreDe(await acc.retirarSoporte(s2)), "ok");
    const antes = { filas: filas(C).length, subidas: subidas.length, avisos: avisosDe(C), vig: vigentes(C).length };
    const a = await reemplazar(s2, b2);
    assert.equal(a.ok, false, "s2 está retirado: no hay éxito falso porque otro soporte vigente tenga el mismo contenido");
    assert.match(a.ok ? "" : a.error, /ya cambió/);
    // (b) reemplazado por otro contenido: s1 fue reemplazado por b2; pedir reemplazarlo con b4 (idéntico a otro soporte vigente) debe fallar
    const b = await reemplazar(s1, b4);
    assert.equal(b.ok, false, "el sucesor de s1 trae b2, no b4");
    assert.match(b.ok ? "" : b.error, /ya cambió/);
    assert.deepEqual({ filas: filas(C).length, subidas: subidas.length, avisos: avisosDe(C), vig: vigentes(C).length }, antes, "nada cambió");
  });
});

describe("consecutivo reutilizado (eliminar contrato A con p_reusar → contrato B de otro aliado con el MISMO número): la evidencia de A no pasa a B", () => {
  const N = "MIN-00-9101";
  const soportesVigentesFn = async (nums: string[]) => (await import("../lib/soportes/servidor.ts")).soportesVigentes(nums);
  const avisosDe = (uid: string) => sql(`select id from public.avisos where usuario_id = '${uid}' and numero_contrato = '${N}' order by id`).split("\n").filter(Boolean).map(Number);
  let idsA: number[] = [];
  let avisosViejos: number[] = [];

  test("preparación: contrato A (minorista, aliado C) con dos soportes y avisos; se elimina con p_reusar=true; B nace con el mismo número y es de OTRO aliado", async () => {
    sql(`
      insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, freelance_nombre, tipo_asesor, asesor)
        values ('${N}', 'Cliente A', 'minorista', 'SAN ANDRES', current_date + 20, 'activo', 500000, 'COP', 8103, 'Freelance Gamma 281', 'freelance', 'Asesor Viejo 281');
      insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) values ('${N}', 100, 'Transferencia', 'minorista'), ('${N}', 100, 'Transferencia', 'minorista');`);
    assert.equal(nombreDe(await subir(U.C, N, pdf(400))), "ok");
    assert.equal(nombreDe(await subir(U.C, N, pdf(401))), "ok");
    idsA = filas(N).map((f) => f.id);
    assert.equal(idsA.length, 2);
    avisosViejos = avisosDe(U.GERMIN);
    assert.ok(avisosViejos.length >= 2, "el personal de la agencia recibió avisos de A");

    // eliminar A con la RPC REAL, como superadmin, pidiendo reutilizar el consecutivo
    sql(`begin; select set_config('request.jwt.claims', '{"sub":"${U.SUP}","role":"authenticated"}', true); set local role authenticated; select public.eliminar_contrato('${N}', true); commit;`);
    assert.equal(Number(sql(`select count(*) from public.ventas where numero_contrato = '${N}'`)), 0, "A ya no existe");
    assert.equal(sql(`select public.siguiente_numero_contrato_para_tenant('minorista')`), N, "el mecanismo existente devuelve el consecutivo liberado");
    sql(`
      insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, freelance_nombre, tipo_asesor, asesor)
        values ('${N}', 'Cliente B', 'minorista', 'CARTAGENA', current_date + 30, 'activo', 700000, 'COP', 8105, 'Freelance Epsilon 281', 'freelance', 'Asesor Min 281');
      insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) values ('${N}', 100, 'Transferencia', 'minorista');`);
  });

  test("la evidencia de A se CONSERVA (filas y archivos) aunque A ya no exista", () => {
    assert.equal(filas(N).length, 2, "las dos filas siguen ahí");
    for (const f of filas(N)) assert.ok(almacen.has(`soportes-pago/${f.path}`), "y sus archivos");
  });

  test("B no LISTA los soportes de A", async () => {
    const r = await soportesVigentesFn([N]);
    assert.equal(r.completa, true);
    assert.deepEqual(r.filas.map((f) => f.id), [], "el aliado de B no ve nada de A");
  });

  test("B no ABRE, no REEMPLAZA ni RETIRA soportes de A (y las filas de A no cambian)", async () => {
    const antes = JSON.stringify(filas(N));
    uidSesion = U.C2;
    assert.equal((await acc.urlSoporteAliado(idsA[0])).ok, false, "no abre");
    assert.equal((await acc.reemplazarSoporte(formulario(pdf(), "x.pdf", "application/pdf", { id: String(idsA[0]) }))).ok, false, "no reemplaza");
    assert.equal((await acc.retirarSoporte(idsA[0])).ok, false, "no retira");
    assert.equal(JSON.stringify(filas(N)), antes, "las filas de A siguen intactas");
  });

  test("B no CUENTA los soportes de A contra su límite: con 1 abono propio sube 1 y el segundo sí topa", async () => {
    assert.equal(nombreDe(await subir(U.C2, N, pdf(410))), "ok", "su primer soporte cabe (B tiene 1 abono)");
    const r2 = await subir(U.C2, N, pdf(411));
    assert.equal(r2.ok, false);
    assert.match(r2.ok ? "" : r2.error, /un soporte vigente por cada abono/);
  });

  test("el personal de la agencia no recibe ni ve los avisos antiguos de A, ni los alcanza por sus enlaces; sí los nuevos de B", async () => {
    uidSesion = U.GERMIN;
    const r = await avi.sondearAvisos(false);
    const idsVistos = r.recientes.map((a) => a.id);
    for (const viejo of avisosViejos) assert.ok(!idsVistos.includes(viejo), `el aviso antiguo ${viejo} no aparece`);
    assert.ok(r.recientes.length >= 1, "pero sí el aviso nuevo de B");
    assert.equal(r.noLeidos, r.recientes.filter((a) => !a.leido).length, "el contador no arrastra los antiguos");
    const reclamados = await avi.sondearAvisos(true);
    for (const viejo of avisosViejos) assert.ok(!reclamados.nuevos.map((a) => a.id).includes(viejo), "tampoco se reclaman para notificar");
  });

  test("la ficha interna de B (RLS) no lista soportes de A, ni para su gerencia ni para su asesor; la evidencia sigue disponible para superadmin", async () => {
    for (const uid of [U.GERMIN, U.VENTAMIN]) {
      const sb = clienteLocal(jwt({ role: "authenticated", sub: uid }), { id: uid, email: PERFIL[uid].email });
      const { data } = await sb.from("contrato_soportes_pago").select("id").eq("numero_contrato", N);
      const ids = (data ?? []).map((x: { id: number }) => x.id);
      for (const a of idsA) assert.ok(!ids.includes(a), `${PERFIL[uid].nombre} no ve el soporte ${a} de A`);
    }
    uidSesion = U.GERMIN;
    assert.equal((await interno.urlSoporteInterno(idsA[0])).ok, false, "el personal de B no abre evidencia de A");
    uidSesion = U.SUP;
    assert.equal((await interno.urlSoporteInterno(idsA[0])).ok, true, "superadmin conserva el acceso a la evidencia");
  });
});

describe("renumerar un contrato (fn_renumerar_contrato real): sigue siendo el MISMO contrato; después otro aliado reutiliza el número viejo", () => {
  const VIEJO = "MIN-00-9501", NUEVO = "MIN-00-9511";
  const soportesVigentesFn = async (nums: string[]) => (await import("../lib/soportes/servidor.ts")).soportesVigentes(nums);
  const avisosDeStaff = () => avi.sondearAvisos(false);
  let ids: number[] = [];
  let rutasAntes = "";
  let avisosAntes = 0;

  test("preparación: contrato minorista del aliado C con 2 abonos, 3 soportes (uno reemplazado: historial) y avisos para su personal", async () => {
    sql(`
      insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, freelance_nombre, tipo_asesor, asesor)
        values ('${VIEJO}', 'Cliente renumerado', 'minorista', 'SAN ANDRES', current_date + 20, 'activo', 500000, 'COP', 8103, 'Freelance Gamma 281', 'freelance', 'Asesor Min 281');
      insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) values ('${VIEJO}', 100, 'Transferencia', 'minorista'), ('${VIEJO}', 100, 'Transferencia', 'minorista');`);
    sql("delete from public.avisos");
    assert.equal(nombreDe(await subir(U.C, VIEJO, pdf(500))), "ok");
    assert.equal(nombreDe(await subir(U.C, VIEJO, pdf(501))), "ok");
    ids = filas(VIEJO).map((f) => f.id);
    uidSesion = U.C;
    assert.equal(nombreDe(await acc.reemplazarSoporte(formulario(pdf(502), "r.pdf", "application/pdf", { id: String(ids[0]) }))), "ok");
    assert.equal(filas(VIEJO).length, 3);
    assert.equal(vigentes(VIEJO).length, 2);
    rutasAntes = filas(VIEJO).map((f) => f.path).join(",");
    avisosAntes = Number(sql(`select count(*) from public.avisos where numero_contrato = '${VIEJO}'`));
    assert.ok(avisosAntes > 0);
  });

  test("se renumera con la RPC REAL (superadmin): el contrato existe con el número nuevo", () => {
    sql(`begin; select set_config('request.jwt.claim.sub', '${U.SUP}', true), set_config('request.jwt.claims', '{"sub":"${U.SUP}","role":"authenticated"}', true); set local role authenticated; select public.fn_renumerar_contrato('${VIEJO}', '${NUEVO}'); commit;`);
    assert.equal(sql(`select (select count(*) from public.ventas where numero_contrato = '${NUEVO}') || '|' || (select count(*) from public.ventas where numero_contrato = '${VIEJO}')`), "1|0");
  });

  test("continuidad en la base: filas, historial, conteos y rutas físicas intactos bajo el número nuevo; nada archivado", () => {
    const f = filas(NUEVO);
    assert.equal(f.length, 3);
    assert.equal(f.filter((x) => x.vigente).length, 2);
    assert.equal(f.filter((x) => x.motivo === "reemplazo").length, 1, "el historial conserva el reemplazo");
    assert.equal(f.map((x) => x.path).join(","), rutasAntes, "las rutas físicas no cambiaron");
    assert.equal(filas(VIEJO).length, 0, "nada queda bajo el número viejo");
    assert.equal(Number(sql(`select count(*) from public.contrato_soportes_pago where numero_contrato = '${NUEVO}' and archivado_en is not null`)), 0);
    assert.equal(Number(sql(`select count(*) from public.avisos where numero_contrato = '${NUEVO}' and archivado_en is null`)), avisosAntes, "los avisos viajaron");
    assert.equal(Number(sql(`select count(*) from public.avisos where numero_contrato = '${VIEJO}'`)), 0);
    for (const x of f) assert.ok(almacen.has(`soportes-pago/${x.path}`), "los archivos siguen en Storage");
  });

  test("el aliado dueño sigue LISTANDO, ABRIENDO, REEMPLAZANDO y RETIRANDO bajo el número nuevo, y el límite continúa", async () => {
    const lista = await soportesVigentesFn([NUEVO]);
    assert.equal(lista.completa, true);
    assert.equal(lista.filas.length, 2, "lista los 2 vigentes");
    assert.deepEqual((await soportesVigentesFn([VIEJO])).filas, [], "y nada bajo el viejo");
    uidSesion = U.C;
    const [v1, v2] = vigentes(NUEVO);
    const url = await acc.urlSoporteAliado(v1.id);
    assert.equal(url.ok, true, "abre");
    assert.equal((nombreDe(await subir(U.C, NUEVO, pdf(510))) ?? "").includes("un soporte vigente por cada abono"), true, "2 abonos / 2 vigentes: el límite sigue vigente tras renumerar");
    assert.equal(nombreDe(await acc.reemplazarSoporte(formulario(pdf(511), "r2.pdf", "application/pdf", { id: String(v1.id) }))), "ok", "reemplaza");
    assert.equal(vigentes(NUEVO).length, 2, "el reemplazo mantiene la cantidad");
    assert.equal(nombreDe(await acc.retirarSoporte(v2.id, "baja")), "ok", "retira");
    assert.equal(vigentes(NUEVO).length, 1);
    assert.equal(filas(NUEVO).length, 4, "y el historial crece sin perder nada");
  });

  test("el personal sigue con acceso: gerencia y asesor del contrato ven TODA la evidencia (vigentes e historial) y los avisos con el número nuevo", async () => {
    for (const uid of [U.GERMIN, U.VENTAMIN]) {
      const sb = clienteLocal(jwt({ role: "authenticated", sub: uid }), { id: uid, email: PERFIL[uid].email });
      const { data } = await sb.from("contrato_soportes_pago").select("id, vigente").eq("numero_contrato", NUEVO);
      assert.equal((data ?? []).length, 4, `${PERFIL[uid].nombre} ve las 4 filas (vigentes e historial)`);
      const { data: viejo } = await sb.from("contrato_soportes_pago").select("id").eq("numero_contrato", VIEJO);
      assert.equal((viejo ?? []).length, 0);
    }
    uidSesion = U.GERMIN;
    const h = filas(NUEVO)[0];
    assert.equal((await interno.urlSoporteInterno(h.id)).ok, true, "abre incluso el soporte reemplazado (historial)");
    const r = await avisosDeStaff();
    assert.ok(r.recientes.length > 0);
    assert.ok(r.recientes.every((a) => a.numero_contrato === NUEVO), "todos con el número nuevo");
    assert.ok(r.recientes.every((a) => a.href === `/dashboard/contratos/${NUEVO}`), "y sus enlaces llevan al contrato renumerado");
  });

  test("DESPUÉS otro aliado reutiliza el número VIEJO: no hereda soportes, conteos, avisos ni permisos del contrato renumerado; la evidencia se conserva", async () => {
    sql(`
      insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, aliado_id, freelance_nombre, tipo_asesor, asesor)
        values ('${VIEJO}', 'Cliente B', 'minorista', 'CARTAGENA', current_date + 30, 'activo', 700000, 'COP', 8105, 'Freelance Epsilon 281', 'freelance', 'Otro Asesor 281');
      insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) values ('${VIEJO}', 100, 'Transferencia', 'minorista');`);
    const idsR = filas(NUEVO).map((f) => f.id);
    const antesR = JSON.stringify(filas(NUEVO));

    assert.deepEqual((await soportesVigentesFn([VIEJO])).filas, [], "B no lista nada de R");
    uidSesion = U.C2;
    for (const id of idsR) {
      assert.equal((await acc.urlSoporteAliado(id)).ok, false, "B no abre soportes de R");
      assert.equal((await acc.reemplazarSoporte(formulario(pdf(), "x.pdf", "application/pdf", { id: String(id) }))).ok, false, "no reemplaza");
      assert.equal((await acc.retirarSoporte(id)).ok, false, "no retira");
    }
    assert.equal(JSON.stringify(filas(NUEVO)), antesR, "la evidencia de R no cambió");
    assert.equal(nombreDe(await subir(U.C2, VIEJO, pdf(520))), "ok", "los soportes de R NO cuentan contra el límite de B (1 abono: cabe 1)");
    const r2 = await subir(U.C2, VIEJO, pdf(521));
    assert.equal(r2.ok, false);
    assert.match(r2.ok ? "" : r2.error, /un soporte vigente por cada abono/);

    // el personal de B (mismo tenant) y su asesor ven SOLO lo de B bajo el número viejo
    for (const [uid, esperados] of [[U.GERMIN, 1], [U.VENTAMIN, 0]] as const) {   // el asesor de R no es el asesor de B: no ve nada de B, y menos aún de R
      const sb = clienteLocal(jwt({ role: "authenticated", sub: uid }), { id: uid, email: PERFIL[uid].email });
      const { data } = await sb.from("contrato_soportes_pago").select("id").eq("numero_contrato", VIEJO);
      const vistos = (data ?? []).map((x: { id: number }) => x.id);
      assert.equal(vistos.length, esperados, `${PERFIL[uid].nombre}: bajo el número viejo ve solo lo que le corresponde de B`);
      for (const id of idsR) assert.ok(!vistos.includes(id), "nunca la evidencia de R");
    }
    // avisos: los viejos de R no aparecen bajo el número viejo; los de B sí
    uidSesion = U.GERMIN;
    const av = await avisosDeStaff();
    assert.ok(av.recientes.some((a) => a.numero_contrato === VIEJO), "hay avisos de B bajo el número viejo");
    assert.equal(Number(sql(`select count(*) from public.avisos where numero_contrato = '${VIEJO}' and soporte_id in (${idsR.join(",")})`)), 0, "ningún aviso de R quedó bajo el número viejo");
    // R sigue plenamente accesible para su dueño
    uidSesion = U.C;
    assert.equal((await soportesVigentesFn([NUEVO])).filas.length, 1, "R conserva su soporte vigente bajo el número nuevo");
    // evidencia conservada (archivos)
    for (const x of filas(NUEVO)) assert.ok(almacen.has(`soportes-pago/${x.path}`));
  });
});
