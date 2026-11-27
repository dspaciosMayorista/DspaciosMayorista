// #103 — supplier requests by email, REAL actions/service/route against a disposable PostgreSQL (PostgREST) with a LOCAL mail capture (Mailpit): correlation, retries, duplicates, failures, authorization.
// Nothing leaves the machine: the transport is Mailpit on loopback (a non-loopback URL is refused by configCorreo). Needs migration 328.
// MSYS_NO_PATHCONV=1 docker run -d --name mailpit103 -p 127.0.0.1:18025:8025 public.ecr.aws/supabase/mailpit:v1.31.3
// MSYS_NO_PATHCONV=1 sh supabase/scripts/test_pg_local.sh pg127 plantilla127 PG103 pruebas/solicitudProveedor103.pg.ts supabase/migrations/20260601000328_solicitudes_proveedor.sql
import { test, describe, mock, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CT = process.env.PG103_CONTENEDOR ?? "pg127";
const DB = process.env.PG103_BASE ?? "";
const PGRST = process.env.PG103_POSTGREST ?? "";
const SECRETO = process.env.PG103_JWT_SECRET ?? "";
const MAILPIT = process.env.PG103_MAILPIT ?? "http://127.0.0.1:18025";
if (!DB || DB === "postgres" || !PGRST || !SECRETO) throw new Error("Faltan PG103_BASE (desechable), PG103_POSTGREST y PG103_JWT_SECRET: usa supabase/scripts/test_pg_local.sh.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}", "next/server": "export const NextResponse = { json: (b, i) => new Response(JSON.stringify(b), { ...(i || {}), headers: { \"content-type\": \"application/json\" } }) };" };
registerHooks({ resolve(specifier, context, nextResolve) { const src = MODULOS_MINIMOS[specifier]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true }; return nextResolve(specifier, context); } });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
function jwt(payload: Record<string, unknown>): string {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
}
const TOKEN_SERVICIO = jwt({ role: "service_role" });
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local"; process.env.SUPABASE_SERVICE_ROLE_KEY = TOKEN_SERVICIO;
process.env.SOLICITUD_PROVEEDOR_EMAIL = "captura"; process.env.SOLICITUD_PROVEEDOR_CAPTURA_URL = MAILPIT;
process.env.SOLICITUD_PROVEEDOR_RESPONDER_A = "respuestas@dspacios.test"; process.env.SOLICITUD_PROVEEDOR_REMITENTE = "solicitudes@dspacios.test";
process.env.SOLICITUD_PROVEEDOR_WEBHOOK_SECRET = "secreto-webhook-local";

const fetchLocal: typeof fetch = (input, init) => fetch(String(input).replace("/rest/v1/", "/"), init);
function clienteLocal(token: string, usuario?: { id: string; email: string }, identidad?: Record<string, string>) {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal, headers: identidad && Object.keys(identidad).length ? { "x-contratos": JSON.stringify(identidad) } : {} } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
}
const UID = { admin: "00000000-0000-0000-0000-000000103101", venta: "00000000-0000-0000-0000-000000103102", ops1: "00000000-0000-0000-0000-000000103103", ops2: "00000000-0000-0000-0000-000000103104" };
const SES = { admin: "5e103000-0000-0000-0000-000000103101", venta: "5e103000-0000-0000-0000-000000103102" };
let actor: "admin" | "venta" = "admin";
const clienteSesion = (identidad?: Record<string, string>) => clienteLocal(jwt({ role: "authenticated", sub: UID[actor], session_id: SES[actor] }), { id: UID[actor], email: `${actor}103@x.test` }, identidad);
function sql(q: string): string {
  try {
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
  } catch (e) { throw new Error(String((e as { stderr?: unknown }).stderr ?? e)); }
}
const num = (q: string) => Number(sql(q));

const ALMACEN = new Map<string, Buffer>();
function conAlmacen<T extends object>(sb: T): T {
  Object.defineProperty(sb, "storage", { value: { from: () => ({
    upload: async (p: string, b: Buffer | Uint8Array) => { if (ALMACEN.has(p)) return { data: null, error: { message: "exists" } }; ALMACEN.set(p, Buffer.from(b)); return { data: { path: p }, error: null }; },
    download: async (p: string) => (ALMACEN.has(p) ? { data: new Blob([new Uint8Array(ALMACEN.get(p)!)]), error: null } : { data: null, error: { message: "not found" } }),
    remove: async (ps: string[]) => { ps.forEach((p) => ALMACEN.delete(p)); return { data: [], error: null }; },
  }) } });
  return sb;
}
/** Failure injection for the person's session client: a read of a table named here returns an ERROR (not an empty result). */
const TABLAS_ROTAS = new Set<string>();
function conFallas<T extends object>(sb: T): T {
  return new Proxy(sb, { get: (t, k) => {
    if (k !== "from") return (t as never)[k];
    return (tabla: string) => {
      if (!TABLAS_ROTAS.has(tabla)) return (t as unknown as { from: (x: string) => unknown }).from(tabla);
      const rota: unknown = new Proxy({}, { get: (_x, m) => (m === "then" ? (res: (v: unknown) => unknown) => res({ data: null, error: { message: `inyectado: ${tabla}` } }) : () => rota) });
      return rota;
    };
  } });
}
mock.module("@/lib/supabase/server", { namedExports: { createClient: async (identidad?: Record<string, string>) => conFallas(clienteSesion(identidad)) } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: (identidad?: Record<string, string>) => conAlmacen(clienteLocal(TOKEN_SERVICIO, undefined, identidad)) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[], set: () => undefined };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const acciones = await import("../app/(dashboard)/dashboard/contratos/[numero]/solicitud-proveedor-actions.ts");
const servicio = await import("../lib/solicitudProveedor/servicio.ts");
const { POST: webhook } = await import("../app/api/solicitud-proveedor/webhook/route.ts");
const { transporteCaptura } = await import("../lib/solicitudProveedor/transporte.ts");
const { tokenDeDirecciones, direccionRespuesta } = await import("../lib/solicitudProveedor/nucleo.ts");

const NUMERO = "DTM-1031", PROVEEDOR = "Hotel Prueba 103";
const CORREO = { asunto: "Solicitud de servicio · Hotel Prueba 103 · Reserva DTM-1031", html: "<p>doc</p>", texto: "doc" };
let IDENT: Record<string, string> = {}, UIDC = "";
const CONTENIDO = { nReserva: NUMERO, proveedor: "Hotel Prueba 103", hotel: "Hotel Prueba 103", destino: "CARTAGENA", titular: "Cliente Prueba", checkIn: "15:00", incluye: ["Desayuno"] };

async function mensajes(): Promise<{ ID: string; To: { Address: string }[]; ReplyTo: { Address: string }[]; Subject: string }[]> {
  const r = await fetch(`${MAILPIT}/api/v1/messages?limit=200`); return ((await r.json()) as { messages: never[] }).messages;
}
const limpiarBuzon = () => fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
async function detalle(id: string) { return (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { HTML: string; ReplyTo: { Address: string }[]; To: { Address: string }[]; From: { Address: string } }; }
const fila = (id: number) => sql(`select estado || '|' || coalesce(error_envio, '') from public.solicitudes_proveedor where id = ${id}`);
const eventos = (id: number, tipo: string) => num(`select count(*) from public.solicitud_proveedor_eventos where solicitud_id = ${id} and tipo = '${tipo}'`);
const firmar = (cuerpo: string) => createHmac("sha256", process.env.SOLICITUD_PROVEEDOR_WEBHOOK_SECRET!).update(cuerpo).digest("hex");
const llamarWebhook = (cuerpo: unknown, firma?: string | null) => { const crudo = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo); return webhook(new Request("http://localhost/api/solicitud-proveedor/webhook", { method: "POST", body: crudo, headers: firma === null ? {} : { "x-firma": firma ?? firmar(crudo) } })); };
const tokenDe = (id: number) => sql(`select token_respuesta from public.solicitudes_proveedor where id = ${id}`);

before(async () => {
  const r = await fetch(`${MAILPIT}/api/v1/info`).catch(() => null);
  assert.ok(r?.ok, `No hay Mailpit en ${MAILPIT}: docker run -d --name mailpit103 -p 127.0.0.1:18025:8025 public.ecr.aws/supabase/mailpit:v1.31.3`);
  sql(`
    insert into auth.users (id, email) values ${Object.entries(UID).map(([k, v]) => `('${v}', '${k}103@x.test')`).join(", ")} on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
      ('${UID.admin}', 'admin103@x.test', 'Admin 103', 'administracion', true, 'mayorista'), ('${UID.venta}', 'venta103@x.test', 'Venta 103', 'venta', true, 'mayorista'),
      ('${UID.ops1}', 'ops1103@x.test', 'Ops 1', 'operaciones', true, 'mayorista'), ('${UID.ops2}', 'ops2103@x.test', 'Ops 2', 'operaciones', true, 'mayorista')
      on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
    insert into auth.sessions (id, user_id) values ('${SES.admin}', '${UID.admin}'), ('${SES.venta}', '${UID.venta}') on conflict do nothing;
    insert into public.ventas (numero_contrato, cliente, tenant) values ('${NUMERO}', 'Cliente Prueba', 'mayorista');
    insert into public.contrato_hoteles (numero_contrato, nombre, ciudad, categoria, alimentacion, acomodacion, fecha_ingreso, fecha_salida, proveedor) values ('${NUMERO}', 'Hotel Prueba 103', 'Cartagena', 'Superior', 'Desayuno', 'Doble', '2027-03-26', '2027-03-30', 'Hotel Prueba 103');
    insert into public.contrato_pasajeros (numero_contrato, nombre, fecha_nacimiento) values ('${NUMERO}', 'Ana Prueba', '1985-05-01'), ('${NUMERO}', 'Luis Prueba', '2017-08-10');
  `);
  UIDC = sql(`select contrato_uid from public.ventas where numero_contrato = '${NUMERO}'`); IDENT = { [NUMERO]: UIDC };
  await limpiarBuzon();
});

describe("send: once, with the document and a correlation address; never twice", () => {
  test("E1 the action sends ONE message to the captured mailbox: To = supplier, Reply-To carries the request token, body carries the document", async () => {
    await limpiarBuzon();
    const r = await acciones.enviarSolicitudProveedor(NUMERO, PROVEEDOR, "Reservas@Hotel103.test", IDENT, null, {});
    assert.equal(r.ok, true, JSON.stringify(r));
    const ms = await mensajes(); assert.equal(ms.length, 1);
    const id = num(`select id from public.solicitudes_proveedor where numero_contrato = '${NUMERO}'`);
    assert.match(fila(id), /^enviada\|/);
    const d = await detalle(ms[0].ID);
    assert.deepEqual(d.To.map((x) => x.Address), ["reservas@hotel103.test"]);
    assert.equal(tokenDeDirecciones(d.ReplyTo.map((x) => x.Address)), tokenDe(id), "Reply-To carries exactly this request's token");
    assert.match(d.HTML, /SOLICITUD DE SERVICIO/); assert.match(d.HTML, /Hotel Prueba 103/); assert.match(d.HTML, /DTM-1031/);
    assert.equal(eventos(id, "envio"), 1);
  });

  test("E2 a second click / repeated request with the same inputs sends NOTHING and says so; 3 concurrent identical requests → still one message in total", async () => {
    const antes = (await mensajes()).length;
    const r2 = await acciones.enviarSolicitudProveedor(NUMERO, PROVEEDOR, "reservas@hotel103.test", IDENT, null, {});
    assert.deepEqual(r2.ok && r2.mensaje.includes("ya había sido enviada"), true);
    assert.equal((await mensajes()).length, antes);
    // distinct recipients → a different request; fire three identical ones at once
    await limpiarBuzon();
    const rs = await Promise.all([1, 2, 3].map(() => acciones.enviarSolicitudProveedor(NUMERO, PROVEEDOR, "concurrente@hotel103.test", IDENT, null, {})));
    assert.equal((await mensajes()).length, 1, "exactly one message left the app");
    assert.equal(num(`select count(*) from public.solicitudes_proveedor where destinatarios = array['concurrente@hotel103.test']`), 1, "exactly one request row");
    assert.ok(rs.some((r) => r.ok && !r.mensaje.includes("ya había")), "one of them really sent");
    assert.ok(rs.every((r) => r.ok || /ya se está enviando/.test(r.error)), JSON.stringify(rs));
  });

  test("E3 explicit resend creates a NEW request (version 2), sends one more message, keeps the first in the history", async () => {
    await limpiarBuzon();
    const r = await acciones.enviarSolicitudProveedor(NUMERO, PROVEEDOR, "reservas@hotel103.test", IDENT, null, {}, true);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal((await mensajes()).length, 1);
    assert.equal(num(`select count(*) from public.solicitudes_proveedor where destinatarios = array['reservas@hotel103.test']`), 2);
    assert.match(sql(`select clave_envio from public.solicitudes_proveedor where destinatarios = array['reservas@hotel103.test'] order by id desc limit 1`), /:v2$/);
  });
});

describe("failures and retries", () => {
  const admin = () => clienteLocal(TOKEN_SERVICIO, undefined, IDENT);
  const cfg = { modo: "captura" as const, remitente: "solicitudes@dspacios.test", responderA: "respuestas@dspacios.test", capturaUrl: MAILPIT };
  const entrada = (dest: string) => ({ tipo: "solicitud" as const, numero: NUMERO, contratoUid: UIDC, tenant: "mayorista", proveedor: PROVEEDOR, contenido: CONTENIDO, destinatarios: [dest], correo: CORREO, creadoPor: UID.admin });
  const falla = { idempotente: false, ventanaIdempotenciaMs: 0, enviar: async () => ({ ok: false as const, error: "smtp 421 servicio no disponible" }) };

  test("F1 transport failure → request 'fallida' with the error recorded, NO message; retry with the same key sends exactly one message; concurrent retries send one", async () => {
    await limpiarBuzon();
    const r1 = await servicio.enviarSolicitud({ admin: admin(), transporte: falla, config: cfg }, entrada("falla@hotel103.test"));
    assert.equal(r1.ok, false); assert.equal((await mensajes()).length, 0);
    const id = num(`select id from public.solicitudes_proveedor where destinatarios = array['falla@hotel103.test']`);
    assert.match(fila(id), /^fallida\|smtp 421/); assert.equal(eventos(id, "error_envio"), 1);
    const buena = transporteCaptura(MAILPIT);
    const rs = await Promise.all([1, 2, 3].map(() => servicio.reintentarEnvio({ admin: admin(), transporte: buena, config: cfg }, id)));
    assert.equal((await mensajes()).length, 1, "three concurrent retries → one message");
    assert.match(fila(id), /^enviada\|$/); assert.equal(num(`select count(*) from public.solicitudes_proveedor where destinatarios = array['falla@hotel103.test']`), 1, "same row reused");
    assert.ok(rs.filter((r) => r.ok && !r.yaEnviada).length === 1, JSON.stringify(rs));
  });

  test("F2 mail disabled (off) → clear message, nothing written or sent; non-loopback capture URL refused", async () => {
    const guardado = process.env.SOLICITUD_PROVEEDOR_EMAIL;
    const filasAntes = num("select count(*) from public.solicitudes_proveedor");
    process.env.SOLICITUD_PROVEEDOR_EMAIL = "off";
    const r = await acciones.enviarSolicitudProveedor(NUMERO, PROVEEDOR, "off@hotel103.test", IDENT, null, {});
    assert.equal(r.ok, false); if (!r.ok) assert.match(r.error, /no está habilitado/);
    process.env.SOLICITUD_PROVEEDOR_EMAIL = "captura"; process.env.SOLICITUD_PROVEEDOR_CAPTURA_URL = "https://api.resend.com";
    const r2 = await acciones.enviarSolicitudProveedor(NUMERO, PROVEEDOR, "ext@hotel103.test", IDENT, null, {});
    assert.equal(r2.ok, false); if (!r2.ok) assert.match(r2.error, /solo acepta direcciones de esta máquina/);
    process.env.SOLICITUD_PROVEEDOR_EMAIL = guardado; process.env.SOLICITUD_PROVEEDOR_CAPTURA_URL = MAILPIT;
    assert.equal(num("select count(*) from public.solicitudes_proveedor"), filasAntes);
  });
});

describe("authorization", () => {
  test("A1 a sales advisor cannot send, cannot record a decision and cannot even read the requests; invalid recipients are rejected before anything is written", async () => {
    const id = num(`select min(id) from public.solicitudes_proveedor`);
    actor = "venta";
    try {
      const antes = num("select count(*) from public.solicitudes_proveedor");
      const r = await acciones.enviarSolicitudProveedor(NUMERO, PROVEEDOR, "venta@hotel103.test", IDENT, null, {});
      assert.equal(r.ok, false); if (!r.ok) assert.match(r.error, /No tienes permiso/);
      const d = await acciones.registrarDecisionProveedor(NUMERO, id, "confirmacion", IDENT); assert.equal(d.ok, false);
      const lectura = await clienteSesion().from("solicitudes_proveedor").select("id"); assert.equal((lectura.data ?? []).length, 0, "RLS hides the requests from sales");
      assert.equal(num("select count(*) from public.solicitudes_proveedor"), antes);
    } finally { actor = "admin"; }
    const mala = await acciones.enviarSolicitudProveedor(NUMERO, PROVEEDOR, "no-es-correo", IDENT, null, {}); assert.equal(mala.ok, false);
    const ajeno = await acciones.enviarSolicitudProveedor("DTM-9999", PROVEEDOR, "x@hotel103.test", IDENT, null, {}); assert.equal(ajeno.ok, false, "a voucher of ANOTHER contract is never sent");
  });
  test("A2 authenticated users cannot write the new tables or call the event RPC directly", async () => {
    const sb = clienteSesion();
    const ins = await sb.from("solicitudes_proveedor").insert({ numero_contrato: NUMERO, destinatarios: ["x@x.com"], asunto: "x", token_respuesta: "a".repeat(32), clave_envio: "forjada" });
    assert.ok(ins.error, "insert denied");
    const rpc = await sb.rpc("registrar_evento_solicitud_proveedor", { p_solicitud: 1, p_tipo: "respuesta", p_dedupe: "x", p_externo: null, p_resumen: {}, p_avisar: null });
    assert.ok(rpc.error, "RPC not executable by authenticated");
    const upd = await sb.from("solicitudes_proveedor").update({ estado: "confirmada" }).eq("id", 1).select("id");
    assert.equal((upd.data ?? []).length, 0);
  });
});

describe("events: delivery, reply, confirmation are distinct; correlation is reliable; duplicates notify once", () => {
  let id = 0, token = "";
  before(async () => {
    await limpiarBuzon();
    const r = await acciones.enviarSolicitudProveedor(NUMERO, PROVEEDOR, "eventos@hotel103.test", IDENT, null, {}); assert.equal(r.ok, true, JSON.stringify(r));
    id = num(`select id from public.solicitudes_proveedor where destinatarios = array['eventos@hotel103.test']`); token = tokenDe(id);
  });

  test("V1 webhook security: no secret / bad signature / missing signature never touch the data; unknown or forged tokens are IGNORED (200) and store nothing", async () => {
    const cuerpo = { tipo: "entrega", token, evento_id: "evt-sec" };
    assert.equal((await llamarWebhook(cuerpo, null)).status, 401);
    assert.equal((await llamarWebhook(cuerpo, "0".repeat(64))).status, 401);
    const secreto = process.env.SOLICITUD_PROVEEDOR_WEBHOOK_SECRET; delete process.env.SOLICITUD_PROVEEDOR_WEBHOOK_SECRET;
    assert.equal((await llamarWebhook(cuerpo, "x")).status, 503); process.env.SOLICITUD_PROVEEDOR_WEBHOOK_SECRET = secreto;
    assert.equal((await llamarWebhook("{no json")).status, 400);
    assert.equal(eventos(id, "entrega"), 0, "nothing stored by the rejected calls");
    const forjado = await (await llamarWebhook({ tipo: "respuesta", token: "F".repeat(32), texto: "hola" })).json(); assert.equal(forjado.ignorado, true);
    assert.equal(num("select count(*) from public.solicitud_proveedor_eventos where tipo = 'respuesta'"), 0);
    assert.equal(((await (await llamarWebhook({ tipo: "ignora-me" })).json()) as { ignorado: boolean }).ignorado, true);
  });

  test("V2 DELIVERY is not a reply: delivered state, delivery time set, no notices; the same delivery twice is stored once", async () => {
    const a = await (await llamarWebhook({ tipo: "entrega", token, evento_id: "evt-1" })).json();
    assert.equal(a.nuevo, true); assert.equal(a.estado, "entregada");
    const b = await (await llamarWebhook({ tipo: "entrega", token, evento_id: "evt-1" })).json();
    assert.equal(b.nuevo, false); assert.equal(eventos(id, "entrega"), 1);
    assert.equal(num(`select count(*) from public.solicitud_proveedor_avisos where solicitud_id = ${id}`), 0);
    assert.match(sql(`select (entregada_en is not null)::text || (respondida_en is null)::text || (confirmada_en is null)::text from public.solicitudes_proveedor where id = ${id}`), /truetruetrue/);
  });

  test("V3 a REPLY correlated by the token in the To address: state 'respondida' (NOT confirmed), one notice per internal user (creator + operaciones), none for sales; duplicate delivery notifies once", async () => {
    const respuesta = { tipo: "respuesta", para: [direccionRespuesta("respuestas@dspacios.test", token)], de: "reservas@hotel103.test", asunto: "Re: Solicitud", texto: "Confirmamos la reserva para esas fechas." };
    const a = await (await llamarWebhook(respuesta)).json();
    assert.equal(a.nuevo, true, JSON.stringify(a)); assert.equal(a.estado, "respondida");
    assert.match(sql(`select (respondida_en is not null)::text || (confirmada_en is null)::text || coalesce(confirmacion, 'ninguna') from public.solicitudes_proveedor where id = ${id}`), /truetrueninguna/, "a reply is NOT a confirmation");
    const usuarios = sql(`select string_agg(user_id::text, ',' order by user_id) from public.solicitud_proveedor_avisos where solicitud_id = ${id}`);
    assert.equal(usuarios, [UID.admin, UID.ops1, UID.ops2].sort().join(","), "creator + the operaciones users; the sales user is not notified");
    const b = await (await llamarWebhook(respuesta)).json();
    assert.equal(b.nuevo, false); assert.equal(eventos(id, "respuesta"), 1);
    assert.equal(num(`select count(*) from public.solicitud_proveedor_avisos where solicitud_id = ${id}`), 3, "still 3 notices: no duplicate notification");
  });

  test("V4 the SAME reply tolerated out of order: a late delivery or a late send-error never regresses 'respondida'; a bounce after a reply does not undo it", async () => {
    await llamarWebhook({ tipo: "entrega", token, evento_id: "evt-tarde" });
    await llamarWebhook({ tipo: "rebote", token, evento_id: "evt-rebote", error: "buzón lleno" });
    const antes = (await mensajes()).length;
    const r = await acciones.enviarSolicitudProveedor(NUMERO, PROVEEDOR, "eventos@hotel103.test", IDENT, null, {});
    assert.equal(r.ok && r.mensaje.includes("ya había sido enviada"), true, "already sent: no new attempt");
    assert.equal((await mensajes()).length, antes, "no message left");
    assert.match(fila(id), /^respondida\|/);
  });

  test("V5 correlation FALLBACK: a reply whose token was stripped is matched by the Message-Id it answers; a reply for an unknown message is ignored", async () => {
    const mensajeId = sql(`select mensaje_id from public.solicitudes_proveedor where id = ${id}`);
    assert.ok(mensajeId, "the provider message id was stored at send time");
    const a = await (await llamarWebhook({ tipo: "respuesta", en_respuesta_a: `<${mensajeId}>`, texto: "Segunda respuesta sin etiqueta", de: "reservas@hotel103.test" })).json();
    assert.equal(a.ignorado, false); assert.equal(a.solicitudId, id); assert.equal(a.nuevo, true);
    assert.equal(eventos(id, "respuesta"), 2);
    const b = await (await llamarWebhook({ tipo: "respuesta", en_respuesta_a: "<otro-mensaje@desconocido>", texto: "x" })).json(); assert.equal(b.ignorado, true);
  });

  test("V6 the business DECISION is separate and human: «confirmó» sets confirmada + time; changing the mind to «rechazó» is allowed; a never-sent request cannot be decided", async () => {
    const r = await acciones.registrarDecisionProveedor(NUMERO, id, "confirmacion", IDENT); assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(sql(`select estado || '|' || (confirmada_en is not null)::text || '|' || confirmacion from public.solicitudes_proveedor where id = ${id}`), /^confirmada\|true\|confirmada$/);
    const r2 = await acciones.registrarDecisionProveedor(NUMERO, id, "rechazo", IDENT); assert.equal(r2.ok, true);
    assert.match(fila(id), /^rechazada\|/);
    const otro = await acciones.registrarDecisionProveedor("DTM-9999", id, "confirmacion", IDENT); assert.equal(otro.ok, false, "the request must belong to the contract of the screen");
    sql(`insert into public.solicitudes_proveedor (numero_contrato, contrato_uid, destinatarios, asunto, token_respuesta, clave_envio, estado) values ('${NUMERO}', '${UIDC}', array['n@x.com'], 'x', '${"n".repeat(32)}', 'nunca-enviada', 'enviando')`);
    const nid = num(`select id from public.solicitudes_proveedor where clave_envio = 'nunca-enviada'`);
    const bad = await acciones.registrarDecisionProveedor(NUMERO, nid, "confirmacion", IDENT); assert.equal(bad.ok, false);
    assert.match(fila(nid), /^enviando\|/);
  });

  test("V7 in-app notices: an internal user reads only their own and can mark them read", async () => {
    const mios = await clienteSesion().from("solicitud_proveedor_avisos").select("user_id, leido_en"); // admin
    assert.ok((mios.data ?? []).length >= 1 && (mios.data ?? []).every((x) => x.user_id === UID.admin));
    const r = await acciones.marcarAvisosLeidos(NUMERO, IDENT); assert.equal(r.ok, true);
    assert.equal(num(`select count(*) from public.solicitud_proveedor_avisos where user_id = '${UID.admin}' and leido_en is null`), 0);
    assert.ok(num(`select count(*) from public.solicitud_proveedor_avisos where user_id = '${UID.ops1}' and leido_en is null`) >= 1, "other users' notices are untouched");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Correction round (Codex H103-1/3/4) and owner clarification (B–E). Same disposable database, same local capture. Nothing leaves the machine.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const { randomUUID } = await import("node:crypto");
const { MENSAJE_IDENTIDAD } = await import("../lib/contrato/identidad.ts");
const MSG_IDENT = MENSAJE_IDENTIDAD;
const SUP = "00000000-0000-0000-0000-000000103105";
const nuevoContrato = (n: string, opts: { reuso?: boolean; proveedor?: string; tenant?: string } = {}) => sql(`
  begin;   -- one transaction: the creation declares the new identity for the children written in it (284 §1b)
  insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, fecha_regreso, pax${opts.reuso ? ", nacio_de_reuso" : ""}) values ('${n}', 'Cliente ${n}', '${opts.tenant ?? "mayorista"}', 'CARTAGENA', '2027-03-26', '2027-03-30', 2${opts.reuso ? ", true" : ""});
  insert into public.contrato_hoteles (numero_contrato, nombre, ciudad, categoria, alimentacion, acomodacion, fecha_ingreso, fecha_salida, proveedor) values ('${n}', 'Hotel Prueba 103', 'Cartagena', 'Superior', 'Desayuno', 'Doble', '2027-03-26', '2027-03-30', '${opts.proveedor ?? PROVEEDOR}');
  insert into public.contrato_pasajeros (numero_contrato, nombre, fecha_nacimiento) values ('${n}', 'Ana ${n}', '1985-05-01');
  commit;`);
const uidDe = (n: string) => sql(`select contrato_uid from public.ventas where numero_contrato = '${n}'`);
const solicitudDe = (n: string, dest?: string) => num(`select max(id) from public.solicitudes_proveedor where numero_contrato = '${n}'${dest ? ` and destinatarios = array['${dest}']` : ""}`);
const buenaConfig = { modo: "captura" as const, remitente: "solicitudes@dspacios.test", responderA: "respuestas@dspacios.test", capturaUrl: MAILPIT };
const capturaReal = transporteCaptura(MAILPIT);
const entradaDe = (n: string, dest: string) => ({ tipo: "solicitud" as const, numero: n, contratoUid: uidDe(n), tenant: "mayorista", proveedor: PROVEEDOR, contenido: { n, dest }, destinatarios: [dest], correo: { asunto: `Solicitud · ${n}`, html: `<p>${n}</p>`, texto: n }, creadoPor: UID.admin });
/** Provider with Resend's documented idempotency: the same key returns the SAME message; distinct messages = what the supplier would really receive. */
function proveedorIdempotente() {
  const porClave = new Map<string, string>(); let llamadas = 0;
  return { llamadas: () => llamadas, mensajes: () => porClave.size, t: { idempotente: true, ventanaIdempotenciaMs: 23 * 3600_000, async enviar(m: { claveIdempotencia: string }) { llamadas++; if (!porClave.has(m.claveIdempotencia)) porClave.set(m.claveIdempotencia, `fake-${porClave.size + 1}`); return { ok: true as const, mensajeId: porClave.get(m.claveIdempotencia)! }; } } };
}
const retrasar = (id: number) => sql(`update public.solicitudes_proveedor set envio_iniciado_en = now() - interval '10 minutes' where id = ${id}`);
const IDENT_DE = (n: string) => ({ [n]: uidDe(n) });
const adminId = (n: string) => clienteLocal(TOKEN_SERVICIO, undefined, IDENT_DE(n));

before(async () => {
  sql(`
    insert into auth.users (id, email) values ('${SUP}', 'sup103@x.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${SUP}', 'sup103@x.test', 'Super 103', 'superadmin', true, 'mayorista') on conflict (id) do update set rol = 'superadmin', activo = true;`);
});

describe("H103-1 · contract identity (migration 284) for supplier requests", () => {
  test("I1 the identity installer SUCCEEDS with the table classified and its guard installed — and would ABORT (GUARDA_SIN_CLASIFICAR) without the classification", () => {
    assert.match(sql("select public.contrato_instalar_guardas()"), /guardas instaladas: \d+/);
    assert.equal(num("select count(*) from pg_trigger where tgrelid = 'public.solicitudes_proveedor'::regclass and tgname = 'trg_contrato_guarda' and not tgisinternal"), 1);
    assert.equal(sql("select modo from public.contrato_guardas_config where tabla = 'solicitudes_proveedor'"), "estricto");
    assert.throws(() => sql("begin; delete from public.contrato_guardas_config where tabla = 'solicitudes_proveedor'; select public.contrato_instalar_guardas(); rollback;"), /GUARDA_SIN_CLASIFICAR: .*solicitudes_proveedor/);
    assert.equal(sql("select modo from public.contrato_guardas_config where tabla = 'solicitudes_proveedor'"), "estricto", "the failed attempt rolled back");
  });

  test("I2 a screen WITHOUT identity, and a screen with a FOREIGN or STALE identity, are rejected before anything is sent or stored", async () => {
    nuevoContrato("DTM-1040");
    await limpiarBuzon();
    const antes = num("select count(*) from public.solicitudes_proveedor");
    const sin = await acciones.enviarSolicitudProveedor("DTM-1040", PROVEEDOR, "ident@hotel103.test", {}, null, {});
    assert.deepEqual(sin, { ok: false, error: MSG_IDENT });
    const ajena = await acciones.enviarSolicitudProveedor("DTM-1040", PROVEEDOR, "ident@hotel103.test", { "DTM-1040": randomUUID() }, null, {});
    assert.deepEqual(ajena, { ok: false, error: MSG_IDENT }, "the declared uid is not the live contract's");
    const deOtro = await acciones.enviarSolicitudProveedor("DTM-1040", PROVEEDOR, "ident@hotel103.test", { "DTM-1031": UIDC }, null, {});
    assert.deepEqual(deOtro, { ok: false, error: MSG_IDENT }, "the uid of ANOTHER contract is not an identity for this one");
    assert.equal((await mensajes()).length, 0); assert.equal(num("select count(*) from public.solicitudes_proveedor"), antes);
  });

  test("I3 a contract born from a REUSED number: correct identity sends; a screen with the previous contract's uid is rejected; an unannounced write is blocked by the guard; the supplier's async events still work", async () => {
    nuevoContrato("DTM-1041", { reuso: true });
    await limpiarBuzon();
    const ok = await acciones.enviarSolicitudProveedor("DTM-1041", PROVEEDOR, "reuso@hotel103.test", IDENT_DE("DTM-1041"), null, {});
    assert.equal(ok.ok, true, JSON.stringify(ok)); assert.equal((await mensajes()).length, 1);
    const id = solicitudDe("DTM-1041"); assert.equal(sql(`select (contrato_uid = (select contrato_uid from public.ventas where numero_contrato = 'DTM-1041'))::text from public.solicitudes_proveedor where id = ${id}`), "true");
    // service-role write with NO declaration on a reuse-born contract → the database refuses (the guard applies to the service key too)
    const sb = clienteLocal(TOKEN_SERVICIO);
    const sinDeclarar = await sb.from("solicitudes_proveedor").update({ error_envio: "x" }).eq("id", id);
    assert.match(sinDeclarar.error?.message ?? "", /IDENTIDAD_REQUERIDA/);
    // a stale screen (previous life's uid) cannot record a decision
    const vieja = await acciones.registrarDecisionProveedor("DTM-1041", id, "confirmacion", { "DTM-1041": randomUUID() }); assert.deepEqual(vieja, { ok: false, error: MSG_IDENT });
    // ASYNC events carry no screen: the RPC declares the request's OWN stored uid, so delivery and reply are applied even though the contract is reuse-born
    const token = tokenDe(id);
    const ent = await (await llamarWebhook({ tipo: "entrega", token, evento_id: "evt-reuso-1" })).json(); assert.equal(ent.nuevo, true); assert.equal(ent.estado, "entregada");
    const resp = await (await llamarWebhook({ tipo: "respuesta", token, texto: "Confirmamos", evento_id: "evt-reuso-2" })).json(); assert.equal(resp.estado, "respondida");
    // …and a screen announcing a DIFFERENT uid while the RPC declares the stored one is rejected by the guard (CONTRATO_CAMBIO), never silently accepted
    const cruzada = await clienteLocal(TOKEN_SERVICIO, undefined, { "DTM-1041": randomUUID() }).rpc("registrar_evento_solicitud_proveedor", { p_solicitud: id, p_tipo: "confirmacion", p_dedupe: "x", p_externo: null, p_resumen: {}, p_avisar: null });
    assert.match(cruzada.error?.message ?? "", /CONTRATO_CAMBIO/);
    assert.match(fila(id), /^respondida\|/);
    const buena = await acciones.registrarDecisionProveedor("DTM-1041", id, "confirmacion", IDENT_DE("DTM-1041")); assert.equal(buena.ok, true, JSON.stringify(buena));
  });

  test("I4 STALE LIFE: the contract is deleted and the number is reborn with another identity → its old requests are gone, an old token is ignored (nothing stored), a stale screen cannot send", async () => {
    nuevoContrato("DTM-1042");
    const viejo = IDENT_DE("DTM-1042");
    assert.equal((await acciones.enviarSolicitudProveedor("DTM-1042", PROVEEDOR, "vida@hotel103.test", viejo, null, {})).ok, true);
    const id = solicitudDe("DTM-1042"), token = tokenDe(id);
    sql(`delete from public.ventas where numero_contrato = 'DTM-1042'`);
    const eventosAntes = num("select count(*) from public.solicitud_proveedor_eventos");   // after the cascade: the dead life's own events went with it
    assert.equal(num(`select count(*) from public.solicitudes_proveedor where id = ${id}`), 0, "the request does not outlive its contract life");
    nuevoContrato("DTM-1042", { reuso: true });
    const r = await (await llamarWebhook({ tipo: "respuesta", token, texto: "tarde", evento_id: "evt-vida" })).json(); assert.equal(r.ignorado, true);
    assert.equal(num("select count(*) from public.solicitud_proveedor_eventos"), eventosAntes, "the late reply stored nothing");
    assert.equal(num("select count(*) from public.solicitudes_proveedor where numero_contrato = 'DTM-1042'"), 0, "the new contract inherits nothing");
    await limpiarBuzon();
    assert.deepEqual(await acciones.enviarSolicitudProveedor("DTM-1042", PROVEEDOR, "vida@hotel103.test", viejo, null, {}), { ok: false, error: MSG_IDENT });
    assert.equal((await mensajes()).length, 0);
  });

  test("I5 RENUMBERING: the request, its token and its events follow the contract (same uid); replies keep correlating; the subject keeps the number the supplier actually saw", async () => {
    nuevoContrato("DTM-1043");
    assert.equal((await acciones.enviarSolicitudProveedor("DTM-1043", PROVEEDOR, "renum@hotel103.test", IDENT_DE("DTM-1043"), null, {})).ok, true);
    const id = solicitudDe("DTM-1043"), token = tokenDe(id), uid = uidDe("DTM-1043"), asunto = sql(`select asunto from public.solicitudes_proveedor where id = ${id}`);
    sql(`select set_config('request.jwt.claim.sub', '${SUP}', false); select public.fn_renumerar_contrato('DTM-1043', 'DTM-1044');`);
    assert.equal(sql(`select numero_contrato from public.solicitudes_proveedor where id = ${id}`), "DTM-1044");
    assert.equal(sql(`select contrato_uid from public.solicitudes_proveedor where id = ${id}`), uid); assert.equal(uidDe("DTM-1044"), uid, "the identity survives the renumbering");
    assert.equal(tokenDe(id), token); assert.equal(sql(`select asunto from public.solicitudes_proveedor where id = ${id}`), asunto); assert.match(asunto, /DTM-1043/);
    const r = await (await llamarWebhook({ tipo: "respuesta", token, texto: "ok tras renumerar", evento_id: "evt-renum" })).json(); assert.equal(r.estado, "respondida");
    // a screen still showing the OLD number can no longer act on it (the number no longer exists)
    assert.equal((await acciones.registrarDecisionProveedor("DTM-1043", id, "confirmacion", { "DTM-1043": uid })).ok, false);
    assert.equal((await acciones.registrarDecisionProveedor("DTM-1044", id, "confirmacion", { "DTM-1044": uid })).ok, true);
  });

  test("I6 REUSE BLOCKER: a contract with a supplier request is NOT a reuse candidate (fails closed on the unclassified table); one without requests is not blocked by it", () => {
    nuevoContrato("DTM-1045"); nuevoContrato("DTM-1046");
    sql(`insert into public.solicitudes_proveedor (numero_contrato, contrato_uid, destinatarios, asunto, token_respuesta, clave_envio) values ('DTM-1045', (select contrato_uid from public.ventas where numero_contrato = 'DTM-1045'), array['x@y.test'], 'a', '${"r".repeat(32)}', 'clave-reuso')`);
    const con = sql("select array_to_string(public.dtm_reuso_bloqueos('DTM-1045', true), ' | ')"), sin = sql("select array_to_string(public.dtm_reuso_bloqueos('DTM-1046', true), ' | ')");
    assert.match(con, /solicitudes_proveedor/i, `blockers with a request: ${con}`);
    assert.doesNotMatch(sin, /solicitudes_proveedor/i, `blockers without: ${sin}`);
  });
});

describe("H103-3 · interrupted and uncertain sends never duplicate and never stay «enviando» for ever", () => {
  const caidaAntesDeEnviar = { idempotente: false, ventanaIdempotenciaMs: 0, async enviar(): Promise<never> { throw new Error("worker killed"); } };
  async function reclamoMuerto(n: string, dest: string) {            // the worker claims, then dies: the exception stops the function before any outcome is recorded
    nuevoContrato(n);
    await servicio.enviarSolicitud({ admin: adminId(n), transporte: caidaAntesDeEnviar, config: buenaConfig }, entradaDe(n, dest)).catch(() => undefined);
    const id = solicitudDe(n, dest); assert.match(fila(id), /^enviando\|/, "the interrupted claim is left behind"); assert.equal(eventos(id, "envio") + eventos(id, "error_envio"), 0);
    return id;
  }

  test("S1 killed BEFORE sending: the live claim blocks others; once its lease expires ONE recovery re-asks the idempotent provider with the SAME key → exactly one message, state «enviada»", async () => {
    const id = await reclamoMuerto("DTM-1050", "s1@hotel103.test"); const p = proveedorIdempotente();
    const viva = await servicio.enviarSolicitud({ admin: adminId("DTM-1050"), transporte: p.t, config: buenaConfig }, entradaDe("DTM-1050", "s1@hotel103.test"));
    assert.deepEqual(viva, { ok: false, error: "Esta solicitud ya se está enviando." }); assert.equal(p.llamadas(), 0, "a live claim is respected");
    retrasar(id);
    const r = await servicio.reintentarEnvio({ admin: adminId("DTM-1050"), transporte: p.t, config: buenaConfig }, id);
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(p.mensajes(), 1); assert.match(fila(id), /^enviada\|/);
    assert.equal(num(`select intentos from public.solicitudes_proveedor where id = ${id}`), 2); assert.equal(eventos(id, "envio"), 1);
  });

  test("S2 ACCEPTED but the record failed: nothing is resent blindly; after the lease the same key returns the same provider message (still ONE), the state is recorded", async () => {
    nuevoContrato("DTM-1051"); const p = proveedorIdempotente(); const real = adminId("DTM-1051");
    const roto = new Proxy(real, { get: (t, k) => k === "rpc" ? (fn: string, a: unknown) => (fn === "registrar_evento_solicitud_proveedor" ? Promise.resolve({ data: null, error: { message: "network down" } }) : (t.rpc as Function).call(t, fn, a)) : (t as never)[k] });
    const r1 = await servicio.enviarSolicitud({ admin: roto as typeof real, transporte: p.t, config: buenaConfig }, entradaDe("DTM-1051", "s2@hotel103.test"));
    assert.equal(r1.ok, false); if (!r1.ok) assert.match(r1.error, /No lo reenvíes/);
    const id = solicitudDe("DTM-1051"); assert.match(fila(id), /^enviando\|/); assert.equal(p.mensajes(), 1);
    const durante = await servicio.enviarSolicitud({ admin: real, transporte: p.t, config: buenaConfig }, entradaDe("DTM-1051", "s2@hotel103.test")); assert.equal(durante.ok, false); assert.equal(p.llamadas(), 1, "within the lease nobody asks the provider again");
    retrasar(id);
    const r2 = await servicio.reintentarEnvio({ admin: real, transporte: p.t, config: buenaConfig }, id);
    assert.equal(r2.ok, true, JSON.stringify(r2)); assert.equal(p.mensajes(), 1, "the supplier received ONE message"); assert.equal(p.llamadas(), 2);
    assert.match(fila(id), /^enviada\|/); assert.equal(sql(`select mensaje_id from public.solicitudes_proveedor where id = ${id}`), "fake-1");
  });

  test("S3 a transport WITHOUT idempotency (local capture): an expired claim becomes «incierta», sends NOTHING, is never retried by an identical click; a late delivery event resolves it; only an explicit resend sends", async () => {
    const id = await reclamoMuerto("DTM-1052", "s3@hotel103.test"); await limpiarBuzon(); retrasar(id);
    const r = await servicio.reintentarEnvio({ admin: adminId("DTM-1052"), transporte: capturaReal, config: buenaConfig }, id);
    assert.equal(r.ok, false); assert.match(fila(id), /^incierta\|/); assert.equal(eventos(id, "envio_incierto"), 1); assert.equal((await mensajes()).length, 0, "nothing sent without knowing");
    const otra = await servicio.enviarSolicitud({ admin: adminId("DTM-1052"), transporte: capturaReal, config: buenaConfig }, entradaDe("DTM-1052", "s3@hotel103.test"));
    assert.equal(otra.ok, false); assert.equal((await mensajes()).length, 0, "an identical retry stays blocked"); assert.equal(eventos(id, "envio_incierto"), 1, "no duplicate event");
    const ent = await (await llamarWebhook({ tipo: "entrega", token: tokenDe(id), evento_id: "evt-s3" })).json(); assert.equal(ent.estado, "entregada", "the provider's own evidence resolves the uncertainty");
    const id2 = await reclamoMuerto("DTM-1054", "s3b@hotel103.test"); retrasar(id2);
    await servicio.reintentarEnvio({ admin: adminId("DTM-1054"), transporte: capturaReal, config: buenaConfig }, id2);
    assert.match(fila(id2), /^incierta\|/);
    const reenvio = await servicio.enviarSolicitud({ admin: adminId("DTM-1054"), transporte: capturaReal, config: buenaConfig }, { ...entradaDe("DTM-1054", "s3b@hotel103.test"), reenviar: true });
    assert.equal(reenvio.ok, true, JSON.stringify(reenvio)); assert.equal((await mensajes()).length, 1, "the explicit resend sent exactly one message");
  });

  test("S4 CONCURRENT recovery of one expired claim: exactly one caller asks the provider, one supplier message, the others see «ya se está enviando» or the finished result", async () => {
    const id = await reclamoMuerto("DTM-1055", "s4@hotel103.test"); retrasar(id); const p = proveedorIdempotente();
    const rs = await Promise.all([1, 2, 3, 4].map(() => servicio.reintentarEnvio({ admin: adminId("DTM-1055"), transporte: p.t, config: buenaConfig }, id)));
    assert.equal(p.llamadas(), 1, JSON.stringify(rs)); assert.equal(p.mensajes(), 1); assert.match(fila(id), /^enviada\|/); assert.equal(eventos(id, "envio"), 1);
    assert.ok(rs.every((r) => r.ok || /ya se está enviando/.test(r.error)), JSON.stringify(rs));
  });

  test("S5 an AMBIGUOUS failure (timeout / 5xx): idempotent provider → «fallida» and the retry (same key) sends once; non-idempotent → «incierta»; a CLEAR rejection (4xx) → «fallida» and a plain retry is fine", async () => {
    nuevoContrato("DTM-1056"); const dudosa = { ok: false as const, error: "timeout", incierto: true };
    const p = proveedorIdempotente(); const conFallo = { ...p.t, enviar: async (m: { claveIdempotencia: string }) => (p.llamadas() === 0 ? (await p.t.enviar(m), dudosa) : p.t.enviar(m)) };
    const a = await servicio.enviarSolicitud({ admin: adminId("DTM-1056"), transporte: conFallo, config: buenaConfig }, entradaDe("DTM-1056", "s5@hotel103.test")); assert.equal(a.ok, false);
    const id = solicitudDe("DTM-1056"); assert.match(fila(id), /^fallida\|/, "idempotent provider: safe to retry");
    const b = await servicio.reintentarEnvio({ admin: adminId("DTM-1056"), transporte: conFallo, config: buenaConfig }, id); assert.equal(b.ok, true); assert.equal(p.mensajes(), 1, "the provider that had really accepted the first call is not given a second message");
    nuevoContrato("DTM-1057");
    await servicio.enviarSolicitud({ admin: adminId("DTM-1057"), transporte: { idempotente: false, ventanaIdempotenciaMs: 0, enviar: async () => dudosa }, config: buenaConfig }, entradaDe("DTM-1057", "s5b@hotel103.test"));
    assert.match(fila(solicitudDe("DTM-1057")), /^incierta\|/);
    nuevoContrato("DTM-1058");
    await servicio.enviarSolicitud({ admin: adminId("DTM-1058"), transporte: { idempotente: false, ventanaIdempotenciaMs: 0, enviar: async () => ({ ok: false as const, error: "400 correo inválido" }) }, config: buenaConfig }, entradaDe("DTM-1058", "s5c@hotel103.test"));
    assert.match(fila(solicitudDe("DTM-1058")), /^fallida\|/); await limpiarBuzon();
    assert.equal((await servicio.reintentarEnvio({ admin: adminId("DTM-1058"), transporte: capturaReal, config: buenaConfig }, solicitudDe("DTM-1058"))).ok, true); assert.equal((await mensajes()).length, 1);
  });

  test("S6 the outcome record is retried with a DETERMINISTIC key: two transient failures then success → ONE «envio» event and one state change", async () => {
    nuevoContrato("DTM-1059"); const real = adminId("DTM-1059"); let fallos = 2; const p = proveedorIdempotente();
    const flaky = new Proxy(real, { get: (t, k) => k === "rpc" ? (fn: string, a: unknown) => (fn === "registrar_evento_solicitud_proveedor" && fallos-- > 0 ? Promise.resolve({ data: null, error: { message: "blip" } }) : (t.rpc as Function).call(t, fn, a)) : (t as never)[k] });
    const r = await servicio.enviarSolicitud({ admin: flaky as typeof real, transporte: p.t, config: buenaConfig }, entradaDe("DTM-1059", "s6@hotel103.test"));
    assert.equal(r.ok, true, JSON.stringify(r)); const id = solicitudDe("DTM-1059"); assert.equal(eventos(id, "envio"), 1); assert.match(fila(id), /^enviada\|/); assert.equal(p.mensajes(), 1);
  });
});

describe("H103-4 · reading one contract marks ONLY its notices", () => {
  test("N1 marking contract A read leaves contract B's notices unread; other users' notices are untouched; a sales advisor changes nothing", async () => {
    nuevoContrato("DTM-1060"); nuevoContrato("DTM-1061");
    for (const n of ["DTM-1060", "DTM-1061"]) {
      assert.equal((await acciones.enviarSolicitudProveedor(n, PROVEEDOR, `${n.toLowerCase()}@hotel103.test`, IDENT_DE(n), null, {})).ok, true);
      const t = tokenDe(solicitudDe(n)); const r = await (await llamarWebhook({ tipo: "respuesta", token: t, texto: `respuesta ${n}`, evento_id: `evt-${n}` })).json(); assert.equal(r.estado, "respondida");
    }
    const sinLeer = (n: string, u: string) => num(`select count(*) from public.solicitud_proveedor_avisos a join public.solicitudes_proveedor s on s.id = a.solicitud_id where s.numero_contrato = '${n}' and a.user_id = '${u}' and a.leido_en is null`);
    for (const n of ["DTM-1060", "DTM-1061"]) for (const u of [UID.admin, UID.ops1, UID.ops2]) assert.equal(sinLeer(n, u), 1, `${n}/${u} starts unread`);
    actor = "venta"; try { await acciones.marcarAvisosLeidos("DTM-1060", IDENT_DE("DTM-1060")); } finally { actor = "admin"; }
    assert.equal(sinLeer("DTM-1060", UID.admin), 1, "a sales advisor cannot mark anyone's notices");
    const r = await acciones.marcarAvisosLeidos("DTM-1060", IDENT_DE("DTM-1060")); assert.equal(r.ok, true);
    assert.equal(sinLeer("DTM-1060", UID.admin), 0, "A is read for the caller");
    assert.equal(sinLeer("DTM-1061", UID.admin), 1, "B is still unread for the caller");
    assert.equal(sinLeer("DTM-1060", UID.ops1), 1); assert.equal(sinLeer("DTM-1061", UID.ops1), 1); assert.equal(sinLeer("DTM-1060", UID.ops2), 1);
  });
});

describe("C · required promotion codes (per hotel validity)", () => {
  let hotel = 0, otroHotel = 0, cod = 0, codSinDigitar = 0, codOtro = 0;
  before(() => {
    const dest = num("insert into public.destinos (nombre) values ('DESTINO 103') on conflict do nothing returning id") || num("select id from public.destinos where nombre = 'DESTINO 103'");
    hotel = num(`insert into public.hoteles (destino_id, nombre) values (${dest}, 'Hotel Prueba 103') returning id`); otroHotel = num(`insert into public.hoteles (destino_id, nombre) values (${dest}, 'Otro Hotel 103') returning id`);
    const vig = (h: number, nombre: string, ini: string, fin: string) => num(`insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin) values (${h}, '${nombre}', '${ini}', '${fin}') returning id`);
    const v1 = vig(hotel, "Promo Semana Santa", "2027-03-20", "2027-04-05"), v2 = vig(hotel, "Promo sin digitar", "2027-03-01", "2027-03-10"), v3 = vig(otroHotel, "Promo otro hotel", "2027-03-20", "2027-04-05");
    cod = num(`insert into public.hotel_codigos_promocion (hotel_id, vigencia_id, requerido, codigo) values (${hotel}, ${v1}, true, 'SS-2027-X') returning id`);
    codSinDigitar = num(`insert into public.hotel_codigos_promocion (hotel_id, vigencia_id, requerido, codigo) values (${hotel}, ${v2}, true, null) returning id`);
    codOtro = num(`insert into public.hotel_codigos_promocion (hotel_id, vigencia_id, requerido, codigo) values (${otroHotel}, ${v3}, true, 'OTRO-HOTEL-9') returning id`);
    nuevoContrato("DTM-1070");
  });

  test("K1 the database refuses an inconsistent configuration (validity of another hotel) and an outgoing request whose code is not its hotel's configured code", () => {
    assert.throws(() => sql(`insert into public.hotel_codigos_promocion (hotel_id, vigencia_id) select ${otroHotel}, id from public.hotel_temporadas where hotel_id = ${hotel} and nombre = 'Promo sin digitar'`), /CODIGO_PROMOCION|duplicate/);
    const intento = (c: number, texto: string, h: number) => `insert into public.solicitudes_proveedor (numero_contrato, contrato_uid, hotel_id, codigo_id, codigo_texto, destinatarios, asunto, token_respuesta, clave_envio) values ('DTM-1070', (select contrato_uid from public.ventas where numero_contrato = 'DTM-1070'), ${h}, ${c}, '${texto}', array['k1@x.test'], 'a', '${"k".repeat(32)}', 'k1-${c}-${texto}-${h}')`;
    assert.throws(() => sql(intento(codOtro, "OTRO-HOTEL-9", hotel)), /CODIGO_PROMOCION/, "another hotel's code on this hotel's request");
    assert.throws(() => sql(intento(cod, "INVENTADO", hotel)), /CODIGO_PROMOCION/, "text that is not the configured code");
    assert.throws(() => sql(intento(codSinDigitar, "x", hotel)), /CODIGO_PROMOCION/, "a requirement with no code entered");
  });

  test("K2 the hotel's coded validity covers the stay: no hotel chosen, no choice, wrong/uncovered/undigitized codes are all REJECTED and nothing is sent", async () => {
    await limpiarBuzon(); const id = IDENT_DE("DTM-1070"); const enviar = (h: number | null, e: object) => acciones.enviarSolicitudProveedor("DTM-1070", PROVEEDOR, "k2@hotel103.test", id, h, e);
    const casos: [number | null, object, RegExp][] = [
      [null, {}, /selecciona el hotel del catálogo/], [hotel, {}, /exige.*código/], [hotel, { codigoId: codOtro }, /no pertenece al hotel/], [hotel, { codigoId: codSinDigitar }, /no cubre las fechas/], [hotel, { codigoId: 99999 }, /no pertenece al hotel/], [hotel, { codigoId: cod, sinPromocion: true }, /no ambas/],
    ];
    for (const [h, e, re] of casos) { const r = await enviar(h, e); assert.equal(r.ok, false, JSON.stringify(e)); if (!r.ok) assert.match(r.error, re); }
    assert.equal((await mensajes()).length, 0); assert.equal(solicitudDe("DTM-1070"), 0);
  });

  test("K3 PREVIEW shows the actual code; SEND puts it in the HTML and the plain-text part of the captured message and stores it with the request; «no promotion» is explicit and recorded", async () => {
    const id = IDENT_DE("DTM-1070");
    const v = await acciones.previsualizarSolicitudProveedor("DTM-1070", PROVEEDOR, id, hotel, { codigoId: cod }); assert.equal(v.ok, true, JSON.stringify(v));
    if (v.ok) { assert.match(v.html, /SS-2027-X/); assert.match(v.texto, /CÓDIGO DE PROMOCIÓN: SS-2027-X/); assert.deepEqual(v.candidatas.map((c) => c.nombre), ["Promo Semana Santa"]); }
    const sinElegir = await acciones.previsualizarSolicitudProveedor("DTM-1070", PROVEEDOR, id, hotel, {}); assert.equal(sinElegir.ok, false); if (!sinElegir.ok) { assert.equal(sinElegir.exigeEleccion, true); assert.equal(sinElegir.candidatas?.length, 1); }
    await limpiarBuzon();
    const r = await acciones.enviarSolicitudProveedor("DTM-1070", PROVEEDOR, "k3@hotel103.test", id, hotel, { codigoId: cod }); assert.equal(r.ok, true, JSON.stringify(r));
    const ms = await mensajes(); assert.equal(ms.length, 1);
    const d = (await (await fetch(`${MAILPIT}/api/v1/message/${ms[0].ID}`)).json()) as { HTML: string; Text: string };
    assert.match(d.HTML, /SS-2027-X/); assert.match(d.Text, /SS-2027-X/); assert.match(d.HTML, /<table/); assert.doesNotMatch(d.Text, /<table|&amp;/);
    const sid = solicitudDe("DTM-1070", "k3@hotel103.test");
    assert.equal(sql(`select codigo_texto || '|' || codigo_promocion || '|' || hotel_id || '|' || sin_promocion::text from public.solicitudes_proveedor where id = ${sid}`), `SS-2027-X|Promo Semana Santa|${hotel}|false`);
    const sin = await acciones.enviarSolicitudProveedor("DTM-1070", PROVEEDOR, "k3b@hotel103.test", id, hotel, { sinPromocion: true }); assert.equal(sin.ok, true, JSON.stringify(sin));
    const sid2 = solicitudDe("DTM-1070", "k3b@hotel103.test"); assert.equal(sql(`select (codigo_texto is null)::text || '|' || sin_promocion::text from public.solicitudes_proveedor where id = ${sid2}`), "true|true");
    const m2 = (await mensajes()).find((m) => m.To.some((t) => t.Address === "k3b@hotel103.test"))!; assert.doesNotMatch((await detalle(m2.ID)).HTML, /SS-2027-X/);
  });

  test("K4 a stay OUTSIDE every coded validity needs no code, and a code cannot be forced onto it; configuring codes never touches prices or the published tariff", async () => {
    sql(`update public.ventas set fecha_salida = '2027-09-01', fecha_regreso = '2027-09-04' where numero_contrato = 'DTM-1070'; update public.contrato_hoteles set fecha_ingreso = '2027-09-01', fecha_salida = '2027-09-04' where numero_contrato = 'DTM-1070';`);
    const id = IDENT_DE("DTM-1070");
    assert.equal((await acciones.enviarSolicitudProveedor("DTM-1070", PROVEEDOR, "k4@hotel103.test", id, hotel, {})).ok, true);
    const forzado = await acciones.enviarSolicitudProveedor("DTM-1070", PROVEEDOR, "k4b@hotel103.test", id, hotel, { codigoId: cod }); assert.equal(forzado.ok, false);
    assert.equal(num("select count(*) from public.tarifa_hotel where hotel_id in (select id from public.hoteles where nombre like '%103')"), 0, "no tariff row was created or touched");
  });

  test("K5 configuration is writable only by roles allowed to edit hotels (RLS): a sales advisor cannot create or change a code", async () => {
    actor = "venta";
    try {
      const sb = clienteSesion();
      const ins = await sb.from("hotel_codigos_promocion").update({ codigo: "HACK" }).eq("id", cod).select("id"); assert.equal((ins.data ?? []).length, 0);
      assert.equal(sql(`select codigo from public.hotel_codigos_promocion where id = ${cod}`), "SS-2027-X");
      const lee = await sb.from("hotel_codigos_promocion").select("codigo"); assert.equal((lee.data ?? []).length, 0, "sales cannot even read the codes");
    } finally { actor = "admin"; }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// D · supplier PAYMENT notices (requires migration 329). Storage is an in-memory fake (the local harness has PostgREST only): file CONTENT and hashing are real, the bucket's own behaviour is not exercised here.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const avisos = await import("../app/(dashboard)/dashboard/pagos/avisos/actions.ts");
const PROV_PAGO = "Proveedor Pago 103", OTRO_PROV = "Otro Proveedor 103";
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("soporte de pago de prueba ".repeat(40))]);
const archivoForm = (contenido: Buffer | string, nombre: string, ids: number[]) => { const fd = new FormData(); fd.set("archivo", new File([typeof contenido === "string" ? contenido : new Uint8Array(contenido)], nombre)); fd.set("pagoIds", JSON.stringify(ids)); return fd; };
const huellaPagos = () => sql("select md5(coalesce(string_agg(id || ':' || cuenta_por_pagar_id || ':' || valor || ':' || fecha || ':' || trm || ':' || tenant, ',' order by id), '')) || '|' || (select count(*) from public.asientos_contables) || '|' || (select count(*) from public.asiento_lineas) || '|' || (select count(*) from public.conciliacion_extracto) || '|' || (select count(*) from public.conciliacion_sistema) from public.cxp_pagos");

describe("D · supplier payment notice: relation from persisted payments, evidence, attachments, authorization, retries", () => {
  const P: Record<string, number> = {};
  before(() => {
    nuevoContrato("DTM-1080"); nuevoContrato("DTM-1081"); nuevoContrato("DTM-1082"); nuevoContrato("DTM-1083"); nuevoContrato("MIN-1080", { tenant: "minorista" });
    const cxp = (n: string, prov: string, total: number, moneda: string, servicio: string, tenant = "mayorista") =>
      num(`insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, moneda, tenant) values ('${n}', '${prov}', 'hotel', '${servicio}', ${total}, '${moneda}', '${tenant}') returning id`);
    const pago = (c: number, valor: number, fecha: string, trm: number, tenant = "mayorista") => num(`insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm, tenant) values (${c}, '${fecha}', ${valor}, ${trm}, '${tenant}') returning id`);
    const a = cxp("DTM-1080", PROV_PAGO, 4000000, "COP", "Hotel Sol"), b = cxp("DTM-1081", PROV_PAGO, 2500000, "COP", "Traslados"), c = cxp("DTM-1082", PROV_PAGO, 300, "USD", "Tour"), z = cxp("DTM-1083", OTRO_PROV, 1000000, "COP", "Hotel Z"), m = cxp("MIN-1080", PROV_PAGO, 900000, "COP", "Hotel M", "minorista");
    P.parcial = pago(a, 1500000, "2027-01-15", 1); P.completo = pago(b, 2500000, "2027-01-15", 1); P.usd1 = pago(c, 100, "2027-01-15", 4000); P.usd2 = pago(c, 50, "2027-01-20", 4100); P.otro = pago(z, 1000000, "2027-01-15", 1); P.minorista = pago(m, 900000, "2027-01-15", 1, "minorista");
  });
  const entrada = (ids: number[], soporteIds: number[] = [], referencia = "TRF-889") => ({ proveedor: PROV_PAGO, pagoIds: ids, soporteIds, referencia });

  test("P1 PREVIEW: one payment covering several reservations + a PARTIAL payment + USD payments → every line exactly as persisted, totals per currency, no invented split", async () => {
    const lista = await avisos.pagosDelProveedor(PROV_PAGO); assert.equal(lista.ok, true);
    if (lista.ok) { assert.deepEqual(lista.pagos.map((p) => p.pagoId).sort((x, y) => x - y), [P.parcial, P.completo, P.usd1, P.usd2], "this supplier, this agency only (no minorista, no other supplier)"); }
    const v = await avisos.previsualizarAvisoPago(entrada([P.parcial, P.completo, P.usd1, P.usd2])); assert.equal(v.ok, true, JSON.stringify(v));
    if (!v.ok) return;
    // Expected values worked out by hand: COP 1.500.000 + 2.500.000 = 4.000.000; USD 100 + 50 = 150; pesos = 100×4000 + 50×4100 = 605.000
    assert.deepEqual(v.totales, [{ moneda: "COP", total: 4000000, equivalenteCop: null }, { moneda: "USD", total: 150, equivalenteCop: 605000 }]);
    for (const hecho of ["DTM-1080", "DTM-1081", "DTM-1082", "COP 1.500.000", "COP 4.000.000", "COP 2.500.000", "USD 100,00", "USD 50,00", "TRM 4000", "TRM 4100", "TRF-889", "15/01/2027", "20/01/2027"]) { assert.ok(v.html.includes(hecho), `html: ${hecho}`); assert.ok(v.texto.includes(hecho), `text: ${hecho}`); }
    assert.match(v.texto, /DTM-1080[^\n]*Valor de este pago: COP 1\.500\.000[^\n]*Obligación total: COP 4\.000\.000[^\n]*Pagado acumulado: COP 1\.500\.000/, "the partial payment shows this payment, the obligation and the cumulative paid");
    assert.match(v.texto, /DTM-1082[^\n]*Pagado acumulado: USD 150,00/, "cumulative of the two USD payments of that obligation");
    assert.doesNotMatch(v.html + v.texto, /undefined|NaN|DTM-1083|MIN-1080/);
  });

  test("P2 EVIDENCE upload: content (not name) decides the type; size limited; all selected payments must be one supplier of this agency; one file may support several payments (one object, several links)", async () => {
    const ok = await avisos.subirSoportePago(archivoForm(PDF, "comprobante.pdf", [P.parcial, P.completo])); assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(num("select count(*) from public.cxp_pago_soportes"), 2); assert.equal(num("select count(distinct path) from public.cxp_pago_soportes"), 1, "uploaded once, linked twice");
    assert.equal(sql("select distinct content_type || '|' || size_bytes || '|' || length(sha256) from public.cxp_pago_soportes"), `application/pdf|${PDF.length}|64`);
    const disfrazado = await avisos.subirSoportePago(archivoForm("esto no es un pdf", "falso.pdf", [P.parcial])); assert.equal(disfrazado.ok, false);
    const gif = await avisos.subirSoportePago(archivoForm("GIF89a....", "x.png", [P.parcial])); assert.equal(gif.ok, false);
    const grande = await avisos.subirSoportePago(archivoForm(Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(5 * 1024 * 1024)]), "grande.pdf", [P.parcial])); assert.equal(grande.ok, false); if (!grande.ok) assert.match(grande.error, /5 MB/);
    const mezcla = await avisos.subirSoportePago(archivoForm(PDF, "m.pdf", [P.parcial, P.otro])); assert.equal(mezcla.ok, false, "two suppliers in one file");
    const min = await avisos.subirSoportePago(archivoForm(PDF, "m.pdf", [P.minorista])); assert.equal(min.ok, false, "another agency's payment");
    const inexistente = await avisos.subirSoportePago(archivoForm(PDF, "m.pdf", [987654])); assert.equal(inexistente.ok, false);
    assert.equal(num("select count(*) from public.cxp_pago_soportes"), 2, "no rejected upload left a row");
  });

  test("P3 SEND with the attachment: ONE captured message with HTML + plain text + the PDF (same bytes); the notice row, its payments and its snapshot are recorded; payments, accounting and reconciliation are untouched", async () => {
    await limpiarBuzon(); const antes = huellaPagos();
    const soportes = sql("select string_agg(id::text, ',') from public.cxp_pago_soportes").split(",").map(Number);
    const r = await avisos.enviarAvisoPago({ ...entrada([P.parcial, P.completo, P.usd1, P.usd2], soportes), destinatarios: "Pagos@Proveedor103.test" }); assert.equal(r.ok, true, JSON.stringify(r));
    const ms = await mensajes(); assert.equal(ms.length, 1);
    const d = (await (await fetch(`${MAILPIT}/api/v1/message/${ms[0].ID}`)).json()) as { HTML: string; Text: string; Attachments: { FileName: string; Size: number; ContentType: string }[]; To: { Address: string }[]; ReplyTo: { Address: string }[] };
    assert.deepEqual(d.To.map((x) => x.Address), ["pagos@proveedor103.test"]); assert.equal(d.Attachments.length, 1, "the same file linked to two payments is attached ONCE");
    assert.deepEqual([d.Attachments[0].FileName, d.Attachments[0].Size], ["comprobante.pdf", PDF.length]);
    assert.match(d.HTML, /AVISO DE PAGO/); assert.match(d.Text, /Total USD: USD 150,00/); assert.match(d.HTML, /comprobante\.pdf/);
    const id = num("select max(id) from public.solicitudes_proveedor where tipo = 'pago'");
    assert.equal(sql(`select tipo || '|' || coalesce(numero_contrato, 'null') || '|' || estado || '|' || referencia from public.solicitudes_proveedor where id = ${id}`), "pago|null|enviada|TRF-889");
    assert.match(sql(`select (snapshot->'lineas')::text from public.solicitudes_proveedor where id = ${id}`), /DTM-1082/);
    assert.equal(num(`select count(*) from public.solicitud_proveedor_pagos where solicitud_id = ${id}`), 4); assert.equal(num(`select jsonb_array_length(snapshot->'adjuntos') from public.solicitudes_proveedor where id = ${id}`), 1);
    assert.equal(huellaPagos(), antes, "sending recorded NO payment, accounting entry or reconciliation change");
  });

  test("P4 DUPLICATES and RETRIES: the same notice again sends nothing; 3 concurrent identical sends → one message; an explicit resend is a new request; none of it touches the payments", async () => {
    const antes = huellaPagos(); const base = (await mensajes()).length;
    const soportes = sql("select string_agg(id::text, ',') from public.cxp_pago_soportes").split(",").map(Number);
    const igual = await avisos.enviarAvisoPago({ ...entrada([P.parcial, P.completo, P.usd1, P.usd2], soportes), destinatarios: "pagos@proveedor103.test" });
    assert.equal(igual.ok && igual.mensaje.includes("ya había sido enviado"), true, JSON.stringify(igual)); assert.equal((await mensajes()).length, base);
    const rs = await Promise.all([1, 2, 3].map(() => avisos.enviarAvisoPago({ ...entrada([P.parcial], [], "TRF-C"), destinatarios: "conc@proveedor103.test" })));
    assert.equal((await mensajes()).length, base + 1, JSON.stringify(rs)); assert.ok(rs.every((r) => r.ok || /ya se está enviando/.test(r.error)));
    const re = await avisos.enviarAvisoPago({ ...entrada([P.parcial, P.completo, P.usd1, P.usd2], soportes), destinatarios: "pagos@proveedor103.test", reenviar: true }); assert.equal(re.ok, true, JSON.stringify(re)); assert.equal((await mensajes()).length, base + 2);
    assert.equal(huellaPagos(), antes);
  });

  test("P5 OWNERSHIP: another supplier's payment, another agency's payment, an evidence file that belongs to payments NOT selected, a missing payment — all rejected; nothing sent", async () => {
    await limpiarBuzon();
    const sopDeOtro = await avisos.subirSoportePago(archivoForm(Buffer.concat([PDF, Buffer.from("otro")]), "otro.pdf", [P.otro]));  // payment of ANOTHER supplier: allowed to upload for ITS own supplier
    assert.equal(sopDeOtro.ok, true);
    const idOtro = num(`select id from public.cxp_pago_soportes where cxp_pago_id = ${P.otro}`);
    const dest = "x@proveedor103.test";
    const casos: [string, Parameters<typeof avisos.enviarAvisoPago>[0]][] = [
      ["another supplier's payment", { ...entrada([P.parcial, P.otro]), destinatarios: dest }], ["another agency's payment", { ...entrada([P.parcial, P.minorista]), destinatarios: dest }],
      ["evidence of a payment not selected / of another supplier", { ...entrada([P.parcial], [idOtro]), destinatarios: dest }], ["missing payment", { ...entrada([P.parcial, 987654]), destinatarios: dest }],
      ["no payments", { ...entrada([]), destinatarios: dest }], ["bad recipient", { ...entrada([P.parcial]), destinatarios: "no-es-correo" }],
    ];
    for (const [nombre, e] of casos) { const r = await avisos.enviarAvisoPago(e); assert.equal(r.ok, false, nombre); }
    assert.equal((await mensajes()).length, 0, "nothing left the app");
    const vOtro = await avisos.previsualizarAvisoPago({ proveedor: OTRO_PROV, pagoIds: [P.parcial], soporteIds: [], referencia: "" }); assert.equal(vOtro.ok, false, "a payment is never previewed under a different supplier's name");
  });

  test("P6 ROLE: a sales advisor can neither list, preview, upload nor send; the notice tables are not writable from a browser session", async () => {
    actor = "venta";
    try {
      assert.equal((await avisos.pagosDelProveedor(PROV_PAGO)).ok, false); assert.equal((await avisos.previsualizarAvisoPago(entrada([P.parcial]))).ok, false);
      assert.equal((await avisos.subirSoportePago(archivoForm(PDF, "v.pdf", [P.parcial]))).ok, false); assert.equal((await avisos.enviarAvisoPago({ ...entrada([P.parcial]), destinatarios: "v@x.test" })).ok, false);
      const sb = clienteSesion();
      assert.equal(((await sb.from("cxp_pago_soportes").select("id")).data ?? []).length, 0, "RLS hides the evidence from sales");
      assert.ok((await sb.from("cxp_pago_soportes").insert({ cxp_pago_id: P.parcial, tenant: "mayorista", nombre: "x", path: "p", content_type: "application/pdf", size_bytes: 1, sha256: "a".repeat(64) })).error, "no browser insert");
    } finally { actor = "admin"; }
    assert.equal((await avisos.pagosDelProveedor(PROV_PAGO)).ok, true);
  });

  test("P7 a payment notice follows the same states as a request: delivery ≠ reply ≠ confirmation; a late reply notifies creator + operaciones; an interrupted send is recovered without a second message", async () => {
    const id = num("select min(id) from public.solicitudes_proveedor where tipo = 'pago' and estado = 'enviada'"), token = tokenDe(id);
    assert.equal((await (await llamarWebhook({ tipo: "entrega", token, evento_id: "pago-ent" })).json()).estado, "entregada");
    const resp = await (await llamarWebhook({ tipo: "respuesta", token, texto: "Recibido, gracias", evento_id: "pago-resp" })).json(); assert.equal(resp.estado, "respondida");
    assert.equal(num(`select count(*) from public.solicitud_proveedor_avisos where solicitud_id = ${id}`), 3);
    assert.match(sql(`select (confirmada_en is null)::text || coalesce(confirmacion, 'ninguna') from public.solicitudes_proveedor where id = ${id}`), /trueninguna/, "a reply is not a confirmation");
    // interrupted payment-notice claim: the worker dies after claiming → expiry → the idempotent provider is re-asked with the same key
    const entradaPago = { tipo: "pago" as const, numero: null, contratoUid: null, tenant: "mayorista", proveedor: PROV_PAGO, contenido: { x: "interrumpido" }, destinatarios: ["int@proveedor103.test"], correo: { asunto: "Aviso de pago · interrumpido", html: "<p>x</p>", texto: "x" }, pagoIds: [P.completo], referencia: "INT", creadoPor: UID.admin };
    await servicio.enviarSolicitud({ admin: clienteLocal(TOKEN_SERVICIO), transporte: { idempotente: false, ventanaIdempotenciaMs: 0, async enviar(): Promise<never> { throw new Error("killed"); } }, config: buenaConfig }, entradaPago).catch(() => undefined);
    const nid = num("select max(id) from public.solicitudes_proveedor where tipo = 'pago'"); assert.match(fila(nid), /^enviando\|/); retrasar(nid);
    const p = proveedorIdempotente();
    const rec = await servicio.reintentarEnvio({ admin: clienteLocal(TOKEN_SERVICIO), transporte: p.t, config: buenaConfig }, nid); assert.equal(rec.ok, true, JSON.stringify(rec)); assert.equal(p.mensajes(), 1); assert.match(fila(nid), /^enviada\|/);
    assert.equal(num(`select count(*) from public.solicitud_proveedor_pagos where solicitud_id = ${nid}`), 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Codex round 2 (R2-1 … R2-6). Real actions/service against the disposable database, real Mailpit capture, provider simulators. Nothing leaves the machine.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const http = await import("node:http");
const HORAS = 3600_000;
const antiguo = (id: number, horas: number) => sql(`update public.solicitudes_proveedor set created_at = now() - interval '${horas} hours', envio_iniciado_en = now() - interval '${horas} hours' where id = ${id}`);
const ambiguoDe = (id: number) => sql(`select ambiguo::text from public.solicitudes_proveedor where id = ${id}`);
const idemSim = () => proveedorIdempotente();
/** A local HTTP server that answers every send with `estado` (a CLEAR rejection when 4xx), to make the real actions fail the first time without any ambiguity. */
async function servidorRechazo(estado: number): Promise<{ url: string; cerrar: () => Promise<void>; llamadas: () => number }> {
  let n = 0;
  const srv = http.createServer((_q, r) => { n++; r.statusCode = estado; r.end("{}"); });
  await new Promise<void>((res) => srv.listen(0, "127.0.0.1", res));
  const puerto = (srv.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${puerto}`, cerrar: () => new Promise<void>((res) => srv.close(() => res())), llamadas: () => n };
}
const conCaptura = async <T>(url: string, f: () => Promise<T>): Promise<T> => { const antes = process.env.SOLICITUD_PROVEEDOR_CAPTURA_URL; process.env.SOLICITUD_PROVEEDOR_CAPTURA_URL = url; try { return await f(); } finally { process.env.SOLICITUD_PROVEEDOR_CAPTURA_URL = antes; } };

describe("R2-1 · the provider's idempotency window bounds EVERY ambiguous retry", () => {
  const dudosa = (ambiguo: boolean) => ({ idempotente: true, ventanaIdempotenciaMs: 23 * HORAS, async enviar() { return ambiguo ? { ok: false as const, error: "timeout", incierto: true } : { ok: false as const, error: "400 correo inválido" }; } });
  async function fallida(n: string, dest: string, ambiguo: boolean) {
    nuevoContrato(n);
    await servicio.enviarSolicitud({ admin: adminId(n), transporte: dudosa(ambiguo), config: buenaConfig }, entradaDe(n, dest));
    const id = solicitudDe(n, dest); assert.match(fila(id), /^fallida\|/); assert.equal(ambiguoDe(id), String(ambiguo), "the DB remembers whether the failed attempt was ambiguous");
    return id;
  }
  const reintentar = (n: string, id: number, p: ReturnType<typeof idemSim>) => servicio.reintentarEnvio({ admin: adminId(n), transporte: p.t, config: buenaConfig }, id);

  test("W1 an AMBIGUOUS failure older than the window is NOT retried: no provider call, state «incierta»; an identical new click is also blocked; only an explicit new version sends", async () => {
    const id = await fallida("DTM-1090", "w1@hotel103.test", true); antiguo(id, 25);
    const p = idemSim();
    const r = await reintentar("DTM-1090", id, p);
    assert.equal(r.ok, false); assert.equal(p.llamadas(), 0, "the 25-hour-old ambiguous failure never reached the provider again"); assert.match(fila(id), /^incierta\|/); assert.equal(eventos(id, "envio_incierto"), 1);
    const igual = await servicio.enviarSolicitud({ admin: adminId("DTM-1090"), transporte: p.t, config: buenaConfig }, entradaDe("DTM-1090", "w1@hotel103.test"));
    assert.equal(igual.ok, false); assert.equal(p.llamadas(), 0, "an identical click does not bypass the window either");
    const nueva = await servicio.enviarSolicitud({ admin: adminId("DTM-1090"), transporte: p.t, config: buenaConfig }, { ...entradaDe("DTM-1090", "w1@hotel103.test"), reenviar: true });
    assert.equal(nueva.ok, true, JSON.stringify(nueva)); assert.equal(p.llamadas(), 1); assert.equal(p.mensajes(), 1, "the explicit new version is the ONLY path that sends after expiry");
  });

  test("W2 inside the window the same ambiguous failure IS retried with the same key (provider returns the original message)", async () => {
    const id = await fallida("DTM-1091", "w2@hotel103.test", true); antiguo(id, 1);
    const p = idemSim(); const r = await reintentar("DTM-1091", id, p);
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(p.llamadas(), 1); assert.match(fila(id), /^enviada\|/); assert.equal(ambiguoDe(id), "false", "a recorded send clears the ambiguity");
  });

  test("W3 a CLEAR rejection (known unsent) may be retried at any age", async () => {
    const id = await fallida("DTM-1092", "w3@hotel103.test", false); antiguo(id, 30);
    const p = idemSim(); const r = await reintentar("DTM-1092", id, p);
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(p.mensajes(), 1);
  });

  test("W4 ambiguity is sticky: an ambiguous attempt followed by a CLEAR failure is still bounded by the window", async () => {
    const id = await fallida("DTM-1093", "w4@hotel103.test", true);
    const rechaza = { idempotente: true, ventanaIdempotenciaMs: 23 * HORAS, async enviar() { return { ok: false as const, error: "400 otra vez" }; } };
    await servicio.reintentarEnvio({ admin: adminId("DTM-1093"), transporte: rechaza, config: buenaConfig }, id);
    assert.match(fila(id), /^fallida\|/); assert.equal(ambiguoDe(id), "true", "a later clear 4xx does not prove the earlier attempt never reached the provider");
    antiguo(id, 25); const p = idemSim(); const r = await reintentar("DTM-1093", id, p);
    assert.equal(r.ok, false); assert.equal(p.llamadas(), 0);
  });

  test("W5 a killed worker's claim older than the window becomes «incierta» without a provider call", async () => {
    nuevoContrato("DTM-1094");
    await servicio.enviarSolicitud({ admin: adminId("DTM-1094"), transporte: { idempotente: true, ventanaIdempotenciaMs: 23 * HORAS, async enviar(): Promise<never> { throw new Error("killed"); } }, config: buenaConfig }, entradaDe("DTM-1094", "w5@hotel103.test")).catch(() => undefined);
    const id = solicitudDe("DTM-1094", "w5@hotel103.test"); antiguo(id, 25);
    const p = idemSim(); const r = await reintentar("DTM-1094", id, p);
    assert.equal(r.ok, false); assert.equal(p.llamadas(), 0); assert.match(fila(id), /^incierta\|/);
  });

  test("W6 concurrent retries INSIDE the window: exactly one provider call", async () => {
    const id = await fallida("DTM-1095", "w6@hotel103.test", true); antiguo(id, 2);
    const p = idemSim(); const rs = await Promise.all([1, 2, 3, 4].map(() => reintentar("DTM-1095", id, p)));
    assert.equal(p.llamadas(), 1, JSON.stringify(rs)); assert.equal(p.mensajes(), 1); assert.match(fila(id), /^enviada\|/);
  });

  test("W7 a BOUNCE marks the request ambiguous: its retry after the window is blocked (the message WAS sent)", async () => {
    nuevoContrato("DTM-1096");
    assert.equal((await servicio.enviarSolicitud({ admin: adminId("DTM-1096"), transporte: idemSim().t, config: buenaConfig }, entradaDe("DTM-1096", "w7@hotel103.test"))).ok, true);
    const id = solicitudDe("DTM-1096", "w7@hotel103.test");
    await llamarWebhook({ tipo: "rebote", token: tokenDe(id), evento_id: "w7-rebote", error: "buzón lleno" });
    assert.match(fila(id), /^fallida\|/); assert.equal(ambiguoDe(id), "true");
    antiguo(id, 25); const p = idemSim(); assert.equal((await reintentar("DTM-1096", id, p)).ok, false); assert.equal(p.llamadas(), 0);
  });
});

describe("R2-2 · a retry re-sends the ORIGINAL frozen message, not a rebuild from current data", () => {
  const hotelId = () => num("select id from public.hoteles where nombre = 'Hotel Prueba 103' order by id limit 1");
  const codigoSS = () => num("select id from public.hotel_codigos_promocion where codigo = 'SS-2027-X' or codigo = 'SS-CAMBIADO' order by id limit 1");

  test("X1 contract request: contract edits, a changed code and a different form choice between the failure and the retry do NOT create a new request; the original recipients, passenger list and code go out", async () => {
    nuevoContrato("DTM-1100");
    const rechazo = await servidorRechazo(400); await limpiarBuzon();
    const primero = await conCaptura(rechazo.url, () => acciones.enviarSolicitudProveedor("DTM-1100", PROVEEDOR, "x1@hotel103.test", IDENT_DE("DTM-1100"), hotelId(), { codigoId: codigoSS() }));
    await rechazo.cerrar();
    assert.equal(primero.ok, false); const id = solicitudDe("DTM-1100"); assert.match(fila(id), /^fallida\|/); assert.equal(ambiguoDe(id), "false"); assert.equal((await mensajes()).length, 0);
    const filas = num("select count(*) from public.solicitudes_proveedor where numero_contrato = 'DTM-1100'"), clave = sql(`select clave_envio from public.solicitudes_proveedor where id = ${id}`);
    // everything the rebuild would read now differs
    sql(`update public.contrato_pasajeros set nombre = 'PASAJERO CAMBIADO' where numero_contrato = 'DTM-1100'; update public.contrato_hoteles set fecha_ingreso = '2027-09-01', fecha_salida = '2027-09-04' where numero_contrato = 'DTM-1100'; update public.hotel_codigos_promocion set codigo = 'SS-CAMBIADO' where id = ${codigoSS()};`);
    const r = await acciones.reintentarEnvioSolicitudProveedor("DTM-1100", id, IDENT_DE("DTM-1100"));
    assert.equal(r.ok, true, JSON.stringify(r));
    const ms = await mensajes(); assert.equal(ms.length, 1); const d = await detalle(ms[0].ID);
    assert.deepEqual(d.To.map((x) => x.Address), ["x1@hotel103.test"]);
    assert.match(d.HTML, /SS-2027-X/); assert.doesNotMatch(d.HTML, /SS-CAMBIADO|PASAJERO CAMBIADO|2027-09|01\/09\/2027/, "the frozen message is what leaves, not the current data");
    assert.equal(num("select count(*) from public.solicitudes_proveedor where numero_contrato = 'DTM-1100'"), filas, "no second request was created"); assert.equal(sql(`select clave_envio from public.solicitudes_proveedor where id = ${id}`), clave);
    assert.match(fila(id), /^enviada\|/); assert.equal(num(`select intentos from public.solicitudes_proveedor where id = ${id}`), 2);
    sql(`update public.hotel_codigos_promocion set codigo = 'SS-2027-X' where id = ${codigoSS()}`);
  });

  test("X1b a NEW click with the changed data is a different, explicit request (new key) — retrying by id and sending anew are distinct operations", async () => {
    const antes = num("select count(*) from public.solicitudes_proveedor where numero_contrato = 'DTM-1100'");
    const n = await acciones.enviarSolicitudProveedor("DTM-1100", PROVEEDOR, "x1@hotel103.test", IDENT_DE("DTM-1100"), hotelId(), { sinPromocion: true });
    assert.equal(n.ok, true, JSON.stringify(n)); assert.equal(num("select count(*) from public.solicitudes_proveedor where numero_contrato = 'DTM-1100'"), antes + 1);
  });

  async function pagosYSoporte(n: string) {
    nuevoContrato(n);
    const cxp = num(`insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, moneda, tenant) values ('${n}', 'Proveedor R2', 'hotel', 'Hotel R2', 1000000, 'COP', 'mayorista') returning id`);
    const pago = num(`insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm, tenant) values (${cxp}, '2027-02-01', 400000, 1, 'mayorista') returning id`);
    const up = await avisos.subirSoportePago(archivoForm(PDF, "r2.pdf", [pago])); assert.equal(up.ok, true, JSON.stringify(up));
    return { cxp, pago, soporte: num(`select id from public.cxp_pago_soportes where cxp_pago_id = ${pago}`) };
  }

  test("X2 payment notice: a later installment between the failure and the retry does not change the notice (same key, same frozen lines, same evidence); the identical notice is not re-created", async () => {
    const { cxp, pago, soporte } = await pagosYSoporte("DTM-1110");
    const e = { proveedor: "Proveedor R2", pagoIds: [pago], soporteIds: [soporte], referencia: "R2-REF", destinatarios: "r2@proveedor.test" };
    const rechazo = await servidorRechazo(400); await limpiarBuzon();
    const primero = await conCaptura(rechazo.url, () => avisos.enviarAvisoPago(e)); await rechazo.cerrar();
    assert.equal(primero.ok, false); const id = num("select max(id) from public.solicitudes_proveedor where tipo = 'pago' and referencia = 'R2-REF'"); assert.match(fila(id), /^fallida\|/);
    const clave = sql(`select clave_envio from public.solicitudes_proveedor where id = ${id}`), filas = num("select count(*) from public.solicitudes_proveedor where tipo = 'pago' and referencia = 'R2-REF'");
    num(`insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm, tenant) values (${cxp}, '2027-03-01', 300000, 1, 'mayorista') returning id`);   // a later installment: cumulative paid changes 400.000 → 700.000
    const r = await avisos.reintentarAvisoPago(id); assert.equal(r.ok, true, JSON.stringify(r));
    const ms = await mensajes(); assert.equal(ms.length, 1); const d = await detalle(ms[0].ID);
    assert.match(d.HTML, /COP 400\.000/); assert.doesNotMatch(d.HTML, /COP 700\.000/, "the cumulative paid shown is the one frozen at first send");
    const adj = (d as unknown as { Attachments?: { Size: number }[] }).Attachments ?? []; assert.equal(adj.length, 1); assert.equal(adj[0].Size, PDF.length);
    assert.equal(sql(`select clave_envio from public.solicitudes_proveedor where id = ${id}`), clave); assert.match(fila(id), /^enviada\|/);
    assert.equal(num(`select count(*) from public.solicitud_proveedor_pagos where solicitud_id = ${id}`), 1);
    // the same selected payment/recipient/reference after the installment: SAME key, nothing new is created or sent
    const otra = await avisos.enviarAvisoPago(e); assert.equal(otra.ok && otra.mensaje.includes("ya había sido enviado"), true, JSON.stringify(otra));
    assert.equal(num("select count(*) from public.solicitudes_proveedor where tipo = 'pago' and referencia = 'R2-REF'"), filas); assert.equal((await mensajes()).length, 1);
  });

  test("X3 if the evidence file changed after the first send, the retry refuses (hash) and sends nothing", async () => {
    const { pago, soporte } = await pagosYSoporte("DTM-1111");
    const e = { proveedor: "Proveedor R2", pagoIds: [pago], soporteIds: [soporte], referencia: "R2-HASH", destinatarios: "r2h@proveedor.test" };
    const rechazo = await servidorRechazo(400);
    await conCaptura(rechazo.url, () => avisos.enviarAvisoPago(e)); await rechazo.cerrar();
    const id = num("select max(id) from public.solicitudes_proveedor where tipo = 'pago' and referencia = 'R2-HASH'");
    const ruta = sql(`select path from public.cxp_pago_soportes where id = ${soporte}`); ALMACEN.set(ruta, Buffer.concat([PDF, Buffer.from("manipulado")]));
    await limpiarBuzon(); const r = await avisos.reintentarAvisoPago(id);
    assert.equal(r.ok, false); if (!r.ok) assert.match(r.error, /cambió desde que se envió/); assert.equal((await mensajes()).length, 0);
  });
});

describe("R2-3/R2-4 · the promotion catalogue fails CLOSED and only this reservation's hotels can carry a code", () => {
  const hotelPrueba = () => num("select id from public.hoteles where nombre = 'Hotel Prueba 103' order by id limit 1");
  const otroHotel = () => num("select id from public.hoteles where nombre = 'Otro Hotel 103' order by id limit 1");
  const previa = (n: string, h: number | null, e: object = {}) => acciones.previsualizarSolicitudProveedor(n, PROVEEDOR, IDENT_DE(n), h, e);
  const conFalla = async <T>(tabla: string, f: () => Promise<T>): Promise<T> => { TABLAS_ROTAS.add(tabla); try { return await f(); } finally { TABLAS_ROTAS.delete(tabla); } };
  before(() => { nuevoContrato("DTM-1120"); });

  test("Q1 healthy control: the covering coded validity demands an explicit choice", async () => {
    const v = await previa("DTM-1120", hotelPrueba()); assert.equal(v.ok, false); if (!v.ok) assert.match(v.error, /exige.*código/);
  });

  test("Q2 a FAILED read of the code table, the validity table, the hotel catalogue or the contract rows blocks the send — it is never «no code required»", async () => {
    for (const tabla of ["hotel_codigos_promocion", "hotel_temporadas", "hoteles", "contrato_pasajeros", "contrato_hoteles"]) {
      await limpiarBuzon();
      const v = await conFalla(tabla, () => previa("DTM-1120", hotelPrueba(), { sinPromocion: true })); assert.equal(v.ok, false, `${tabla}: preview must fail closed`);
      const e = await conFalla(tabla, () => acciones.enviarSolicitudProveedor("DTM-1120", PROVEEDOR, "q2@hotel103.test", IDENT_DE("DTM-1120"), hotelPrueba(), { sinPromocion: true })); assert.equal(e.ok, false, `${tabla}: send must fail closed`);
      assert.equal((await mensajes()).length, 0, `${tabla}: nothing left the app`);
    }
    assert.equal(solicitudDe("DTM-1120"), 0);
  });

  test("Q3 the genuine «no code needed» case still works (stay outside every coded validity) — the strictness is not a blanket refusal", async () => {
    nuevoContrato("DTM-1121"); sql(`update public.contrato_hoteles set fecha_ingreso = '2027-09-01', fecha_salida = '2027-09-04' where numero_contrato = 'DTM-1121'; update public.ventas set fecha_salida = '2027-09-01', fecha_regreso = '2027-09-04' where numero_contrato = 'DTM-1121';`);
    const v = await previa("DTM-1121", null); assert.equal(v.ok, true, JSON.stringify(v));
    const v2 = await previa("DTM-1121", hotelPrueba()); assert.equal(v2.ok, true, JSON.stringify(v2));
  });

  test("Q4 an existing but UNRELATED catalogue hotel cannot be selected (it would bypass the real hotel's required code)", async () => {
    const v = await previa("DTM-1120", otroHotel(), { sinPromocion: true }); assert.equal(v.ok, false); if (!v.ok) assert.match(v.error, /no corresponde a ningún hotel de esta reserva/);
    const e = await acciones.enviarSolicitudProveedor("DTM-1120", PROVEEDOR, "q4@hotel103.test", IDENT_DE("DTM-1120"), otroHotel(), {}); assert.equal(e.ok, false);
    assert.equal(solicitudDe("DTM-1120"), 0);
  });

  test("Q5 a services-only supplier cannot carry a hotel selection", async () => {
    nuevoContrato("DTM-1122");
    sql(`delete from public.contrato_hoteles where numero_contrato = 'DTM-1122'; insert into public.contrato_servicios (numero_contrato, tipo, descripcion, proveedor) values ('DTM-1122', 'traslado', 'Traslado', '${PROVEEDOR}');`);
    const v = await previa("DTM-1122", hotelPrueba()); assert.equal(v.ok, false); if (!v.ok) assert.match(v.error, /no tiene hoteles/);
    assert.equal((await previa("DTM-1122", null)).ok, true);
  });

  test("Q6 same-name ambiguity: with two catalogue hotels of the same name the sender must choose; the choice is the explicit mapping (the one with the covering code requires it)", async () => {
    sql(`insert into public.hoteles (destino_id, nombre) select destino_id, nombre from public.hoteles where nombre = 'Hotel Prueba 103' order by id limit 1`);
    const ids = sql("select string_agg(id::text, ',' order by id) from public.hoteles where nombre = 'Hotel Prueba 103'").split(",").map(Number); assert.equal(ids.length, 2);
    const sinElegir = await previa("DTM-1120", null); assert.equal(sinElegir.ok, false); if (!sinElegir.ok) assert.match(sinElegir.error, /selecciona el hotel/);
    assert.deepEqual((sinElegir.ok ? [] : sinElegir.hotelesSugeridos ?? []).map((h) => h.id), ids, "both same-name hotels are offered");
    const conCodigo = await previa("DTM-1120", ids[0]); assert.equal(conCodigo.ok, false); if (!conCodigo.ok) assert.match(conCodigo.error, /exige.*código/);
    const hermano = await previa("DTM-1120", ids[1]); assert.equal(hermano.ok, true, "choosing the same-name sibling is the sender's EXPLICIT mapping of the stay to that hotel (documented policy; the UI lists both)");
  });

  test("Q7 a supplier with several hotel stays: another matched hotel with a covering coded validity cannot be skipped; one request carries one code choice", async () => {
    sql(`delete from public.hoteles where id = (select max(id) from public.hoteles where nombre = 'Hotel Prueba 103') and (select count(*) from public.hoteles where nombre = 'Hotel Prueba 103') > 1`);
    const otro = otroHotel();
    const vig = num(`insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin) values (${otro}, 'Promo Otro Hotel', '2027-03-01', '2027-03-31') returning id`);
    num(`insert into public.hotel_codigos_promocion (hotel_id, vigencia_id, requerido, codigo) values (${otro}, ${vig}, true, 'OTRO-CODE') returning id`);
    nuevoContrato("DTM-1123");
    sql(`insert into public.contrato_hoteles (numero_contrato, nombre, ciudad, fecha_ingreso, fecha_salida, proveedor) values ('DTM-1123', 'Otro Hotel 103', 'Cartagena', '2027-03-30', '2027-04-02', '${PROVEEDOR}')`);
    const v = await previa("DTM-1123", hotelPrueba(), { codigoId: codigoSS2() }); assert.equal(v.ok, false); if (!v.ok) assert.match(v.error, /otro hotel[\s\S]*solicitud aparte/);
    const v2 = await previa("DTM-1123", null); assert.equal(v2.ok, false); if (!v2.ok) assert.match(v2.error, /selecciona el hotel/);
  });
  const codigoSS2 = () => num("select id from public.hotel_codigos_promocion where codigo = 'SS-2027-X' order by id limit 1");
});

describe("R3-2 · several hotel stays of ONE supplier: each hotel is sent in its own request with its own code", () => {
  const hotelA = () => num("select id from public.hoteles where nombre = 'Hotel Prueba 103' order by id limit 1");
  const hotelB = () => num("select id from public.hoteles where nombre = 'Otro Hotel 103' order by id limit 1");
  const codA = () => num("select id from public.hotel_codigos_promocion where codigo = 'SS-2027-X' order by id limit 1");
  const codB = () => num("select id from public.hotel_codigos_promocion where codigo = 'OTRO-CODE' order by id limit 1");
  const estancia = (n: string, nombre: string) => num(`select id from public.contrato_hoteles where numero_contrato = '${n}' and nombre = '${nombre}' order by id limit 1`);
  const N = "DTM-1150";
  type Sel = { estanciaIds: number[]; servicios: boolean } | null;
  const previa = (h: number | null, e: object, sel: Sel) => acciones.previsualizarSolicitudProveedor(N, PROVEEDOR, IDENT_DE(N), h, e, sel);
  const enviar = (dest: string, h: number | null, e: object, sel: Sel) => acciones.enviarSolicitudProveedor(N, PROVEEDOR, dest, IDENT_DE(N), h, e, false, sel);
  const cuerpo = async (id: string) => (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { HTML: string; Text: string };
  before(() => {
    nuevoContrato(N);
    sql(`insert into public.contrato_hoteles (numero_contrato, nombre, ciudad, fecha_ingreso, fecha_salida, proveedor) values ('${N}', 'Otro Hotel 103', 'Cartagena', '2027-03-30', '2027-04-02', '${PROVEEDOR}');
      insert into public.contrato_servicios (numero_contrato, tipo, descripcion, proveedor) values ('${N}', 'traslado', 'Traslado aeropuerto R3', '${PROVEEDOR}');
      insert into public.contrato_hoteles (numero_contrato, nombre, ciudad, fecha_ingreso, fecha_salida, proveedor) values ('${N}', 'Hotel De Otro Proveedor', 'Cartagena', '2027-03-30', '2027-04-02', 'Otro Proveedor R3')`);
  });

  test("Y1 the full request is still blocked (one code per request) and the message names the way out; each hotel alone succeeds with ITS code, and the two requests are distinct", async () => {
    const todo = await previa(hotelA(), { codigoId: codA() }, null); assert.equal(todo.ok, false); if (!todo.ok) assert.match(todo.error, /otro hotel[\s\S]*solicitud aparte/);
    const a = estancia(N, "Hotel Prueba 103"), b = estancia(N, "Otro Hotel 103");
    await limpiarBuzon();
    const ra = await enviar("y1a@hotel103.test", hotelA(), { codigoId: codA() }, { estanciaIds: [a], servicios: false }); assert.equal(ra.ok, true, JSON.stringify(ra));
    const rb = await enviar("y1b@hotel103.test", hotelB(), { codigoId: codB() }, { estanciaIds: [b], servicios: false }); assert.equal(rb.ok, true, JSON.stringify(rb));
    const ms = await mensajes(); assert.equal(ms.length, 2);
    const de = (dest: string) => cuerpo(ms.find((x) => x.To.some((t) => t.Address === dest))!.ID);
    const da = await de("y1a@hotel103.test"), db = await de("y1b@hotel103.test");
    const filaA = /Hotel: Hotel Prueba 103 \||Hotel Prueba 103<\/td><td[^>]*>Cartagena/;   // the stay ROW (the supplier is also called Hotel Prueba 103, so its name alone proves nothing)
    for (const t of [da.HTML, da.Text]) { assert.match(t, /SS-2027-X/); assert.match(t, filaA); assert.doesNotMatch(t, /OTRO-CODE|Otro Hotel 103|Traslado aeropuerto R3|Hotel De Otro Proveedor/, "request A carries only A"); }
    for (const t of [db.HTML, db.Text]) { assert.match(t, /OTRO-CODE/); assert.match(t, /Otro Hotel 103/); assert.doesNotMatch(t, /SS-2027-X|Traslado aeropuerto R3|Hotel De Otro Proveedor/, "request B carries only B"); assert.doesNotMatch(t, filaA, "request B has no stay row of A"); }
    const ia = solicitudDe(N, "y1a@hotel103.test"), ib = solicitudDe(N, "y1b@hotel103.test"); assert.notEqual(ia, ib);
    assert.equal(sql(`select hotel_id || '|' || codigo_texto from public.solicitudes_proveedor where id = ${ia}`), `${hotelA()}|SS-2027-X`);
    assert.equal(sql(`select hotel_id || '|' || codigo_texto from public.solicitudes_proveedor where id = ${ib}`), `${hotelB()}|OTRO-CODE`);
    for (const [id, malo] of [[ia, "OTRO-CODE|Otro Hotel 103|Hotel De Otro Proveedor"], [ib, "SS-2027-X|Hotel De Otro Proveedor"]] as const) {
      for (const col of ["snapshot", "payload"]) assert.equal(num(`select count(*) from public.solicitudes_proveedor where id = ${id} and ${col}::text ~ '${malo}'`), 0, `${col} of ${id} (the FROZEN message) holds only its own stay`);
    }
    assert.equal(num(`select count(*) from public.solicitudes_proveedor where id = ${ib} and (snapshot::text ~ '"nombre": "Hotel Prueba 103"' or payload::text ~ '>Hotel Prueba 103</td><td[^>]*>Cartagena')`), 0, "request B holds no stay row of A (the supplier name alone is not a stay)");
  });

  test("Y2 identical selections dedupe like any other request; the same stay with another selection is a different request", async () => {
    const a = estancia(N, "Hotel Prueba 103"); await limpiarBuzon();
    const antes = num(`select count(*) from public.solicitudes_proveedor where numero_contrato = '${N}'`);
    const otra = await enviar("y1a@hotel103.test", hotelA(), { codigoId: codA() }, { estanciaIds: [a], servicios: false });
    assert.equal(otra.ok, true); if (otra.ok) assert.match(otra.mensaje, /ya había sido enviada/);
    assert.equal(num(`select count(*) from public.solicitudes_proveedor where numero_contrato = '${N}'`), antes); assert.equal((await mensajes()).length, 0);
    const conServicios = await enviar("y1a@hotel103.test", hotelA(), { codigoId: codA() }, { estanciaIds: [a], servicios: true }); assert.equal(conServicios.ok, true, JSON.stringify(conServicios));
    assert.equal(num(`select count(*) from public.solicitudes_proveedor where numero_contrato = '${N}'`), antes + 1);
    const ms = await mensajes(); assert.equal(ms.length, 1); const d = await cuerpo(ms[0].ID);
    assert.match(d.HTML, /Traslado aeropuerto R3/); assert.doesNotMatch(d.HTML, /Otro Hotel 103|OTRO-CODE/);
  });

  test("Y3 rejections are preserved: unrelated hotel, the OTHER stay's hotel, the other stay's code, a foreign/duplicate/empty/malformed selection, a stay of another supplier — nothing is sent", async () => {
    const a = estancia(N, "Hotel Prueba 103"), b = estancia(N, "Otro Hotel 103"), ajeno = estancia(N, "Hotel De Otro Proveedor");
    const otroCatalogo = num("select id from public.hoteles where nombre not in ('Hotel Prueba 103','Otro Hotel 103') order by id limit 1");
    await limpiarBuzon(); const antes = num(`select count(*) from public.solicitudes_proveedor where numero_contrato = '${N}'`);
    const malos: [string, Promise<{ ok: boolean; error?: string }>, RegExp][] = [
      ["unrelated catalogue hotel", previa(otroCatalogo, { sinPromocion: true }, { estanciaIds: [a], servicios: false }), /no corresponde a ningún hotel de esta reserva/],
      ["B's hotel while only A is selected", previa(hotelB(), { codigoId: codB() }, { estanciaIds: [a], servicios: false }), /no corresponde a ningún hotel de esta reserva/],
      ["B's code on A's request", previa(hotelA(), { codigoId: codB() }, { estanciaIds: [a], servicios: false }), /no pertenece al hotel/],
      ["both coded stays in one request", previa(hotelA(), { codigoId: codA() }, { estanciaIds: [a, b], servicios: false }), /otro hotel[\s\S]*solicitud aparte/],
      ["stay of another supplier", previa(hotelA(), { codigoId: codA() }, { estanciaIds: [a, ajeno], servicios: false }), /no pertenece a este proveedor/],
      ["nonexistent stay", previa(hotelA(), { codigoId: codA() }, { estanciaIds: [a, 99999999], servicios: false }), /no pertenece a este proveedor/],
      ["empty selection", previa(null, {}, { estanciaIds: [], servicios: false }), /al menos una estancia/],
      ["malformed selection", previa(null, {}, { estanciaIds: ["x"] as never, servicios: "si" as never }), /selección de estancias no es válida/],
    ];
    for (const [que, p, re] of malos) { const r = await p; assert.equal(r.ok, false, que); assert.match(r.error ?? "", re, que); }
    const e = await enviar("y3@hotel103.test", hotelA(), { codigoId: codA() }, { estanciaIds: [a, ajeno], servicios: false }); assert.equal(e.ok, false);
    assert.equal(num(`select count(*) from public.solicitudes_proveedor where numero_contrato = '${N}'`), antes); assert.equal((await mensajes()).length, 0);
  });

  test("Y4 retry by id re-sends THAT request's original message (its stay, its code) even after the contract and the code changed; the other hotel never appears", async () => {
    const b = estancia(N, "Otro Hotel 103"); const rechazo = await servidorRechazo(400); await limpiarBuzon();
    const primero = await conCaptura(rechazo.url, () => enviar("y4@hotel103.test", hotelB(), { codigoId: codB() }, { estanciaIds: [b], servicios: false })); await rechazo.cerrar();
    assert.equal(primero.ok, false); const id = solicitudDe(N, "y4@hotel103.test"); assert.match(fila(id), /^fallida\|/);
    sql(`update public.contrato_hoteles set fecha_ingreso = '2027-10-01', fecha_salida = '2027-10-04' where id = ${b}; update public.hotel_codigos_promocion set codigo = 'OTRO-CAMBIADO' where codigo = 'OTRO-CODE'`);
    const r = await acciones.reintentarEnvioSolicitudProveedor(N, id, IDENT_DE(N)); assert.equal(r.ok, true, JSON.stringify(r));
    const ms = await mensajes(); assert.equal(ms.length, 1); const d = await cuerpo(ms[0].ID);
    assert.match(d.HTML, /OTRO-CODE/); assert.match(d.HTML, /Otro Hotel 103/); assert.doesNotMatch(d.HTML, /OTRO-CAMBIADO|2027-10|SS-2027-X|Hotel Prueba 103<\/td><td[^>]*>Cartagena/);
    sql(`update public.hotel_codigos_promocion set codigo = 'OTRO-CODE' where codigo = 'OTRO-CAMBIADO'; update public.contrato_hoteles set fecha_ingreso = '2027-03-30', fecha_salida = '2027-04-02' where id = ${b}`);
  });
});

describe("R2-6 · payment-notice relation writes are checked BEFORE anything is sent", () => {
  test("L1 a relation-write failure sends NOTHING and leaves a retryable request; the retry writes the links, then sends once; a killed worker's claim is repaired the same way", async () => {
    nuevoContrato("DTM-1130");
    const cxp = num(`insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, moneda, tenant) values ('DTM-1130', 'Proveedor L1', 'hotel', 'Hotel L1', 900000, 'COP', 'mayorista') returning id`);
    const pago = num(`insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm, tenant) values (${cxp}, '2027-02-05', 900000, 1, 'mayorista') returning id`);
    const real = clienteLocal(TOKEN_SERVICIO); let fallar = true;
    const roto = new Proxy(real, { get: (t, k) => k === "from" ? (tabla: string) => (tabla === "solicitud_proveedor_pagos" && fallar ? { upsert: async () => ({ data: null, error: { message: "inyectado" } }) } : (t.from as Function).call(t, tabla)) : (t as never)[k] });
    const p = idemSim();
    const entrada = { tipo: "pago" as const, numero: null, contratoUid: null, tenant: "mayorista", proveedor: "Proveedor L1", contenido: { l1: 1 }, destinatarios: ["l1@proveedor.test"], correo: { asunto: "Aviso L1", html: "<p>l1</p>", texto: "l1" }, pagoIds: [pago], referencia: "L1", creadoPor: UID.admin };
    const r1 = await servicio.enviarSolicitud({ admin: roto as typeof real, transporte: p.t, config: buenaConfig }, entrada);
    assert.equal(r1.ok, false); assert.equal(p.llamadas(), 0, "nothing was sent while the links could not be written");
    const id = num("select max(id) from public.solicitudes_proveedor where referencia = 'L1'"); assert.match(fila(id), /^fallida\|/); assert.equal(ambiguoDe(id), "false"); assert.equal(num(`select count(*) from public.solicitud_proveedor_pagos where solicitud_id = ${id}`), 0);
    const aun = await servicio.reintentarEnvio({ admin: roto as typeof real, transporte: p.t, config: buenaConfig }, id); assert.equal(aun.ok, false); assert.equal(p.llamadas(), 0, "the retry also refuses while the links cannot be written");
    fallar = false;
    const ok = await servicio.reintentarEnvio({ admin: roto as typeof real, transporte: p.t, config: buenaConfig }, id);
    assert.equal(ok.ok, true, JSON.stringify(ok)); assert.equal(p.llamadas(), 1); assert.equal(p.mensajes(), 1);
    assert.equal(num(`select count(*) from public.solicitud_proveedor_pagos where solicitud_id = ${id}`), 1, "the link was repaired by the retry"); assert.match(fila(id), /^enviada\|/);
    const lista = await avisos.pagosDelProveedor("Proveedor L1"); assert.equal(lista.ok && lista.pagos.find((x) => x.pagoId === pago)?.yaAvisado, true);
  });
});

describe("H103-13 · optional note above the structured tables (owner review correction batch)", () => {
  const NOTA = "Llegamos tarde: late check-in 22:00.\nSegunda línea <b>x</b> & \"comillas\"";
  const PARRAFO = /<p data-testid="mensaje-adicional"[^>]*>[\s\S]*?<\/p>\n/;
  type Detalle = { HTML: string; Text: string; To: { Address: string }[]; ReplyTo: { Address: string }[] };
  const detalleDe = async (para: string): Promise<Detalle> => {
    const m = (await mensajes()).find((x) => x.To.some((t) => t.Address === para));
    assert.ok(m, `no captured message for ${para}`);
    return (await (await fetch(`${MAILPIT}/api/v1/message/${m!.ID}`)).json()) as Detalle;
  };
  const crlf = (t: string) => t.replace(/\r\n/g, "\n");
  const N = "DTM-1140", PROV = "Proveedor Nota 103";
  let ident: Record<string, string>;
  before(() => {
    nuevoContrato(N);
    sql(`update public.contrato_hoteles set nombre = 'Hotel Nota 103', proveedor = '${PROV}' where numero_contrato = '${N}'`);   // no catalogue match → no promotion-code question in this block
    ident = { [N]: uidDe(N) };
  });

  test("M1 a note travels in HTML (escaped, line breaks kept) and plain text ABOVE the tables; everything else of the message is byte-identical to the note-less one; supplier, recipients and Reply-To token untouched", async () => {
    await limpiarBuzon();
    const sin = await acciones.enviarSolicitudProveedor(N, PROV, "sin-nota@hotel103.test", ident, null, {}); assert.equal(sin.ok, true, JSON.stringify(sin));
    const con = await acciones.enviarSolicitudProveedor(N, PROV, "con-nota@hotel103.test", ident, null, {}, false, null, NOTA); assert.equal(con.ok, true, JSON.stringify(con));
    assert.equal((await mensajes()).length, 2);
    const a = await detalleDe("sin-nota@hotel103.test"), b = await detalleDe("con-nota@hotel103.test");
    assert.doesNotMatch(a.HTML, /mensaje-adicional/, "no note → no paragraph");
    assert.ok(b.HTML.includes("Llegamos tarde: late check-in 22:00.<br>Segunda línea &lt;b&gt;x&lt;/b&gt; &amp; &quot;comillas&quot;"), "escaped, line break kept");
    assert.doesNotMatch(b.HTML, /<b>x<\/b>/, "the note's markup is not live HTML");
    assert.ok(b.HTML.indexOf("mensaje-adicional") > b.HTML.indexOf("Les enviamos la solicitud") && b.HTML.indexOf("mensaje-adicional") < b.HTML.indexOf("SOLICITUD DE SERVICIO"), "after the intro, before the tables");
    assert.equal(crlf(b.HTML).replace(PARRAFO, ""), crlf(a.HTML), "removing the note leaves EXACTLY the old message (tables, supplier, passengers untouched)");
    assert.ok(crlf(b.Text).includes(NOTA), "plain text carries the raw note");
    assert.equal(crlf(b.Text).replace(`${NOTA}\n\n`, ""), crlf(a.Text), "plain text: the note is the only difference");
    const idCon = solicitudDe(N, "con-nota@hotel103.test"), idSin = solicitudDe(N, "sin-nota@hotel103.test");
    assert.equal(tokenDeDirecciones(b.ReplyTo.map((x) => x.Address)), tokenDe(idCon), "Reply-To still carries this request's token");
    assert.equal(sql(`select (payload->>'html' like '%Llegamos tarde%')::text || (snapshot->'datos'->>'mensaje' = $q$${NOTA}$q$)::text from public.solicitudes_proveedor where id = ${idCon}`), "truetrue", "frozen into the stored message and snapshot");
    assert.equal(sql(`select (snapshot->'datos' ? 'mensaje')::text from public.solicitudes_proveedor where id = ${idSin}`), "false", "a note-less request keeps the data (and idempotency key) it always had");
  });

  test("M2 idempotency: the same note to the same recipient sends nothing new; a blank note IS the note-less request (already sent → nothing new); a different note is a different request", async () => {
    const base = (await mensajes()).length;
    const igual = await acciones.enviarSolicitudProveedor(N, PROV, "con-nota@hotel103.test", ident, null, {}, false, null, NOTA);
    assert.deepEqual(igual.ok && igual.mensaje.includes("ya había sido enviada"), true, JSON.stringify(igual));
    const en_blanco = await acciones.enviarSolicitudProveedor(N, PROV, "sin-nota@hotel103.test", ident, null, {}, false, null, "  \n \t ");
    assert.deepEqual(en_blanco.ok && en_blanco.mensaje.includes("ya había sido enviada"), true, JSON.stringify(en_blanco));
    assert.equal((await mensajes()).length, base, "nothing left the app");
    const otra = await acciones.enviarSolicitudProveedor(N, PROV, "con-nota@hotel103.test", ident, null, {}, false, null, "Otra nota distinta");
    assert.equal(otra.ok, true, JSON.stringify(otra));
    assert.equal((await mensajes()).length, base + 1, "a different note is a new request");
    assert.equal(num(`select count(*) from public.solicitudes_proveedor where numero_contrato = '${N}' and destinatarios = array['con-nota@hotel103.test']`), 2);
  });

  test("M3 the server bounds the note: 600 characters pass, 601 are REFUSED (never silently cut) and nothing is written or sent; the preview applies the same rule", async () => {
    const filas = num("select count(*) from public.solicitudes_proveedor"), base = (await mensajes()).length;
    const largo = await acciones.enviarSolicitudProveedor(N, PROV, "largo@hotel103.test", ident, null, {}, false, null, "x".repeat(601));
    assert.equal(largo.ok, false); if (!largo.ok) assert.match(largo.error, /supera 600 caracteres/);
    const vistaLarga = await acciones.previsualizarSolicitudProveedor(N, PROV, ident, null, {}, null, "x".repeat(601)); assert.equal(vistaLarga.ok, false);
    assert.equal(num("select count(*) from public.solicitudes_proveedor"), filas); assert.equal((await mensajes()).length, base);
    const justo = await acciones.enviarSolicitudProveedor(N, PROV, "justo@hotel103.test", ident, null, {}, false, null, "y".repeat(600)); assert.equal(justo.ok, true, JSON.stringify(justo));
  });

  test("M4 PREVIEW shows the note in HTML and text exactly as it will be sent", async () => {
    const v = await acciones.previsualizarSolicitudProveedor(N, PROV, ident, null, {}, null, NOTA); assert.equal(v.ok, true, JSON.stringify(v));
    if (!v.ok) return;
    assert.ok(v.html.includes("Segunda línea &lt;b&gt;x&lt;/b&gt;")); assert.ok(v.texto.includes(NOTA));
    const sinNota = await acciones.previsualizarSolicitudProveedor(N, PROV, ident, null, {}, null); assert.equal(sinNota.ok && !sinNota.html.includes("mensaje-adicional"), true);
  });

  test("M5 a reply to a request that carried a note is still ONLY a reply (never a confirmation); the human decision stays separate", async () => {
    const id = solicitudDe(N, "con-nota@hotel103.test"), token = tokenDe(id);
    const r = await (await llamarWebhook({ tipo: "respuesta", para: [direccionRespuesta("respuestas@dspacios.test", token)], de: "reservas@hotel103.test", asunto: "Re: Solicitud", texto: "Recibido, confirmamos el late check-in." })).json();
    assert.equal(r.estado, "respondida");
    assert.match(sql(`select (respondida_en is not null)::text || (confirmada_en is null)::text || coalesce(confirmacion, 'ninguna') from public.solicitudes_proveedor where id = ${id}`), /truetrueninguna/);
  });

  test("M6 PAYMENT NOTICE: the same optional note above the payment table; without it the message is exactly the old one; payments, accounting and reconciliation untouched; the 600-character limit applies", async () => {
    nuevoContrato("DTM-1141");
    const cxp = num(`insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, moneda, tenant) values ('DTM-1141', 'Proveedor Nota Pago 103', 'hotel', 'Hotel Nota', 1000000, 'COP', 'mayorista') returning id`);
    const pago = num(`insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm, tenant) values (${cxp}, '2027-02-10', 400000, 1, 'mayorista') returning id`);
    const entrada = (dest: string, mensaje?: string) => ({ proveedor: "Proveedor Nota Pago 103", pagoIds: [pago], soporteIds: [] as number[], referencia: "TRF-NOTA", destinatarios: dest, ...(mensaje !== undefined ? { mensaje } : {}) });
    await limpiarBuzon(); const antes = huellaPagos();
    const v = await avisos.previsualizarAvisoPago({ ...entrada("x"), mensaje: NOTA }); assert.equal(v.ok, true, JSON.stringify(v)); if (v.ok) assert.ok(v.html.includes("Segunda línea &lt;b&gt;x&lt;/b&gt;"));
    const sin = await avisos.enviarAvisoPago(entrada("pago-sin@proveedor103.test")); assert.equal(sin.ok, true, JSON.stringify(sin));
    const con = await avisos.enviarAvisoPago(entrada("pago-con@proveedor103.test", NOTA)); assert.equal(con.ok, true, JSON.stringify(con));
    const a = await detalleDe("pago-sin@proveedor103.test"), b = await detalleDe("pago-con@proveedor103.test");
    assert.ok(b.HTML.indexOf("mensaje-adicional") > b.HTML.indexOf("Les informamos") && b.HTML.indexOf("mensaje-adicional") < b.HTML.indexOf("AVISO DE PAGO"));
    assert.equal(crlf(b.HTML).replace(PARRAFO, ""), crlf(a.HTML), "the payment table and totals are untouched");
    assert.equal(crlf(b.Text).replace(`${NOTA}\n\n`, ""), crlf(a.Text));
    const largo = await avisos.enviarAvisoPago(entrada("pago-largo@proveedor103.test", "z".repeat(601))); assert.equal(largo.ok, false);
    assert.equal(huellaPagos(), antes, "a note changes no payment, entry or reconciliation");
  });
});
