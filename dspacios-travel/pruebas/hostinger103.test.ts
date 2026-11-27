// #103 — Hostinger inbound adapter, LIGHTWEIGHT: simulated Mail API (no network), an in-memory stand-in for the event RPC and for the durable cursor/backlog store (the REAL SQL of both is proven by supabase/scripts/prueba_hostinger_estado_103.mjs
// and solicitudProveedor103.pg.ts). The REAL `procesarEvento`, `usuariosAvisarPorDefecto`, client, parser, drain and handlers run. No Docker, no browser, no secrets: every credential below is a made-up test string.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { BASE_API_HOSTINGER, bearerValido, configHostinger, crearClienteHostinger, crearPresupuesto, estadoRespuestaDe, INTENTOS_MAX, manejarCronHostinger, manejarNotificacionHostinger, PRESUPUESTO_MS, SOLICITUDES_MAX, VENTANA_HORAS, type AlmacenHostinger, type DepsNotificacion, type EstadoBuzon, type PendienteGuardado } from "../lib/solicitudProveedor/hostinger.ts";
import { procesarEvento, usuariosAvisarPorDefecto } from "../lib/solicitudProveedor/servicio.ts";
import { tokensDeDirecciones, type EventoNormalizado } from "../lib/solicitudProveedor/nucleo.ts";

const AHORA = Date.parse("2026-11-22T15:00:00Z");
const BUZON = "AC1a2b3c4d5e6f7g", TOKEN_API = "test-api-token-NOT-A-REAL-ONE", SECRETO = "test-webhook-secret-NOT-A-REAL-ONE", RESPONDER_A = "respuestas@dspacios.test", CRON = "test-cron-secret-NOT-A-REAL-ONE";
const TOKEN_A = "AbCdEfGhIjKlMnOpQrStUvWx", TOKEN_B = "ZyXwVuTsRqPoNmLkJiHgFeDc", TOKEN_PAGO = "PagoPagoPagoPagoPagoPago";
const ENV = { SOLICITUD_PROVEEDOR_HOSTINGER: "activo", SOLICITUD_PROVEEDOR_HOSTINGER_WEBHOOK_SECRET: SECRETO, SOLICITUD_PROVEEDOR_HOSTINGER_TOKEN: TOKEN_API, SOLICITUD_PROVEEDOR_HOSTINGER_MAILBOX_ID: BUZON, SOLICITUD_PROVEEDOR_RESPONDER_A: RESPONDER_A };
const CONFIG = (() => { const c = configHostinger(ENV); if (!c.ok) throw new Error("config"); return c.config; })();
const dir = (token: string, base = "respuestas", dominio = "dspacios.test") => ({ address: `${base}+${token}@${dominio}` });
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── in-memory stand-in for the event RPC / database ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
type Sol = { id: number; token_respuesta: string; mensaje_id: string | null; tenant: string; creado_por: string | null; tipo: "solicitud" | "pago"; asunto: string; proveedor: string; numero_contrato: string | null; estado: string };
const RANGO: Record<string, number> = { enviando: 1, incierta: 1, fallida: 1, enviada: 2, entregada: 3, respondida: 4, confirmada: 5, rechazada: 5 };
function crearBd(sols: Sol[]) {
  const eventos: { solicitud: number; tipo: string; dedupe: string; externo: string | null; resumen: Record<string, unknown> }[] = [];
  const avisos = new Set<string>(); const estado = new Map(sols.map((s) => [s.id, s.estado]));
  const lecturas = { porToken: 0, porMensajeId: 0 }; const rpcs: string[] = []; let falla: string | null = null; const lento = { ms: 0 };
  const admin = {
    from(tabla: string) {
      const eqs: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        select() { return q; }, limit() { return q; }, eq(k: string, v: unknown) { eqs[k] = v; return q; },
        async maybeSingle() {
          if (lento.ms) await dormir(lento.ms);
          if (falla === tabla) return { data: null, error: { message: `${tabla} caída` } };
          if (tabla !== "solicitudes_proveedor") return { data: null, error: null };
          if ("token_respuesta" in eqs) { lecturas.porToken++; const s = sols.find((x) => x.token_respuesta === eqs.token_respuesta); return { data: s ? { ...s, estado: estado.get(s.id) } : null, error: null }; }
          if ("mensaje_id" in eqs) { lecturas.porMensajeId++; const s = sols.find((x) => x.mensaje_id === eqs.mensaje_id); return { data: s ? { ...s, estado: estado.get(s.id) } : null, error: null }; }
          return { data: null, error: null };
        },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
          const hecho = async () => {
            if (lento.ms) await dormir(lento.ms);
            if (falla === tabla) return { data: null, error: { message: `${tabla} caída` } };
            const data = tabla === "usuarios" ? [{ id: "u-ops" }] : tabla === "solicitud_proveedor_eventos" ? eventos.filter((e) => e.solicitud === eqs.solicitud_id && e.tipo === eqs.tipo && e.dedupe === eqs.dedupe).map(() => ({ id: 1 })) : [];
            return { data, error: null };
          };
          return hecho().then(res, rej);
        },
      };
      return q;
    },
    async rpc(nombre: string, a: { p_solicitud: number; p_tipo: string; p_dedupe: string; p_externo: string | null; p_resumen: Record<string, unknown>; p_avisar: string[] | null }) {
      rpcs.push(`${nombre}:${a.p_tipo}`);
      if (lento.ms) await dormir(lento.ms);
      if (eventos.some((e) => e.solicitud === a.p_solicitud && e.tipo === a.p_tipo && e.dedupe === a.p_dedupe)) return { data: [{ nuevo: false, estado_nuevo: estado.get(a.p_solicitud), id_evento: null }], error: null };   // same rule as the SQL unique key
      eventos.push({ solicitud: a.p_solicitud, tipo: a.p_tipo, dedupe: a.p_dedupe, externo: a.p_externo, resumen: a.p_resumen });
      if (a.p_tipo === "respuesta") { if ((RANGO[estado.get(a.p_solicitud)!] ?? 0) < 4) estado.set(a.p_solicitud, "respondida"); for (const u of a.p_avisar ?? []) avisos.add(`${eventos.length}:${u}`); }
      return { data: [{ nuevo: true, estado_nuevo: estado.get(a.p_solicitud), id_evento: eventos.length }], error: null };
    },
  };
  return { admin: admin as never, eventos, avisos, estado, lecturas, rpcs, lento, romper: (t: string | null) => { falla = t; } };
}
const SOLS: Sol[] = [
  { id: 1, token_respuesta: TOKEN_A, mensaje_id: "re_resend_email_id_1", tenant: "mayorista", creado_por: "u-creador", tipo: "solicitud", asunto: "Solicitud · Reserva DTM-1", proveedor: "Hotel A", numero_contrato: "DTM-1", estado: "entregada" },
  { id: 2, token_respuesta: TOKEN_B, mensaje_id: "re_resend_email_id_2", tenant: "mayorista", creado_por: "u-creador", tipo: "solicitud", asunto: "Solicitud · Reserva DTM-2", proveedor: "Hotel B", numero_contrato: "DTM-2", estado: "entregada" },
  { id: 3, token_respuesta: TOKEN_PAGO, mensaje_id: "re_resend_email_id_3", tenant: "mayorista", creado_por: "u-creador", tipo: "pago", asunto: "Aviso de pago", proveedor: "Hotel A", numero_contrato: null, estado: "enviada" },
];

// ── in-memory stand-in for the durable cursor/backlog store (same compare-and-swap and CHECK rules as migration 330) ────────────────────────────────────────────────────────────────────────────────────
function crearAlmacen() {
  const estados = new Map<string, EstadoBuzon>(); const pend = new Map<number, PendienteGuardado & { error: string }>();
  const cas: { gano: boolean; version: number; nuevo?: { uidCubierto: number; barridoTope: number | null; barridoSiguiente: number | null; barridoDesde: string | null } }[] = [];
  const cfg = { retrasoMs: 0, rompe: null as string | null };
  const p = async (nombre: string) => { if (cfg.retrasoMs) await dormir(cfg.retrasoMs); if (cfg.rompe === nombre) throw new Error(`${nombre}: caída`); };
  const almacen: AlmacenHostinger = {
    async leerEstado(b) { await p("leer"); let e = estados.get(b); if (!e) { e = { version: 0, uidCubierto: 0, barridoTope: null, barridoSiguiente: null, barridoDesde: null }; estados.set(b, e); } return { ...e }; },
    async avanzar(b, v, n) {
      await p("avanzar"); const e = estados.get(b)!;
      if ((n.barridoTope === null) !== (n.barridoSiguiente === null) || (n.barridoTope !== null && (n.barridoSiguiente! > n.barridoTope || n.barridoTope <= n.uidCubierto)) || n.uidCubierto < 0 || (n.barridoTope === null && n.barridoDesde !== null)) throw new Error("CHECK constraint violated (migration 330 rules)");
      if (e.version !== v) { cas.push({ gano: false, version: v }); return false; }
      estados.set(b, { version: v + 1, ...n }); cas.push({ gano: true, version: v, nuevo: n }); return true;
    },
    async listarPendientes(_b, limite) { await p("listar"); return [...pend.values()].slice(0, limite).map(({ uid, dedupe, messageId, intentos }) => ({ uid, dedupe, messageId, intentos })); },
    async guardarPendiente(_b, x) { await p("guardar"); pend.set(x.uid, { uid: x.uid, dedupe: x.dedupe, messageId: x.messageId, intentos: x.intentos, error: x.error }); },
    async borrarPendiente(_b, uid) { await p("borrar"); pend.delete(uid); },
  };
  return { almacen, estados, pend, cas, cfg, estado: () => estados.get(BUZON)! };
}

// ── simulated Hostinger Mail API ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
type Msg = { uid: number; date: string; subject: string | null; from: { name?: string; address: string } | null; to: { address: string }[]; cc: { address: string }[]; bcc: unknown[]; messageId: string | null; inReplyTo: string | null; attachments: unknown[]; flags: string[]; unseen: boolean; size: number; path: string; llegada?: string /* arrival time at the server: NOT the sender date */ };
const msg = (uid: number, to: { address: string }[], x: Partial<Msg> = {}): Msg => ({ uid, date: new Date(AHORA - 3_600_000).toISOString(), subject: "Re: Solicitud", from: { name: "Reservas", address: "reservas@hotel.test" }, to, cc: [], bcc: [], messageId: `<m${uid}@hotel.test>`, inReplyTo: null, attachments: [], flags: [], unseen: true, size: 1000, path: "INBOX", ...x });
type Fallo = { patron: RegExp; secuencia: (number | "timeout" | "json" | "colgar")[] };
type Sim = { mensajes: Msg[]; textos?: Record<number, string>; fallos?: Fallo[]; detalle?: (uid: number) => Msg | null; ignoraRango?: boolean };
function crearHttp(sim: Sim, reloj?: { t: number; porLlamada: number }) {
  const llamadas: { url: string; metodo: string; auth: string | null; ruta: string; cuerpo: string | null }[] = [];
  const json = (data: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(status < 300 ? { data } : data), { status, headers: { "content-type": "application/json", ...h } });
  const f: typeof fetch = async (input, init) => {
    const url = String(input), u = new URL(url), ruta = u.pathname;
    llamadas.push({ url, metodo: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization"), ruta, cuerpo: typeof init?.body === "string" ? init.body : null });
    if (reloj) reloj.t += reloj.porLlamada;
    const fallo = (sim.fallos ?? []).find((x) => x.patron.test(ruta) && x.secuencia.length);        // the failure queues live on the Sim so a test can change them between runs
    if (fallo) {
      const v = fallo.secuencia.shift()!;
      if (v === "timeout") throw new DOMException("timeout", "TimeoutError");
      if (v === "colgar") await new Promise<void>((_, rej) => { init?.signal?.addEventListener("abort", () => rej(new DOMException("timeout", "TimeoutError"))); });   // a provider that never answers: only the client's timeout ends it
      if (v === "json") return new Response("<html>no json</html>", { status: 200 });
      return json({ error: "x", code: "ERR_X", params: {} }, v as number, v === 429 ? { "retry-after": "2" } : {});
    }
    const m = /^\/api\/v1\/mailboxes\/([^/]+)\/folders\/([^/]+)\/messages(?:\/(\d+)(\/text)?|\/search)?$/.exec(ruta);
    if (!m) return json({ error: "ruta", code: "ERR_ROUTE", params: {} }, 404);
    if (m[1] !== BUZON) return json({ error: "otro buzón", code: "ERR_FORBIDDEN", params: {} }, 403);
    const pagina = Math.max(1, Number(u.searchParams.get("page") ?? 1)), pp = Math.min(100, Math.max(1, Number(u.searchParams.get("perPage") ?? 25)));
    const ordenados = (xs: Msg[]) => [...xs].sort((a, b) => (b?.uid ?? 0) - (a?.uid ?? 0)).slice((pagina - 1) * pp, pagina * pp);
    if (/\/search$/.test(ruta)) {
      assert.equal(init?.method, "POST"); const cuerpo = JSON.parse(String(init?.body)) as { uid?: string; since?: string }; const rg = /^(\d+):(\d+)$/.exec(cuerpo.uid ?? "");
      const [a, b] = rg ? [Number(rg[1]), Number(rg[2])] : [1, Number.MAX_SAFE_INTEGER];
      const desdeDia = cuerpo.since ?? null;                                                                          // `since` = «received on or after this day» — ARRIVAL time, never the sender `date`
      return json(ordenados(sim.ignoraRango ? sim.mensajes : sim.mensajes.filter((x) => x && typeof x.uid === "number" && x.uid >= a && x.uid <= b && (!desdeDia || (x.llegada ?? x.date ?? "").slice(0, 10) >= desdeDia))));
    }
    if (!m[3]) return json(ordenados(sim.mensajes));
    const uid = Number(m[3]), d = sim.detalle ? sim.detalle(uid) : (sim.mensajes.find((x) => x?.uid === uid) ?? null);
    if (!d) return json({ error: "no existe", code: "ERR_NOT_FOUND", params: {} }, 404);
    return m[4] ? json({ text: sim.textos?.[uid] ?? "Gracias, recibido.", html: "<p>html</p>" }) : json(d);
  };
  const descargas = () => llamadas.filter((c) => /\/messages\/\d+(\/text)?$/.test(c.ruta)).length;
  return { fetch: f, llamadas, descargas, busquedas: () => llamadas.filter((c) => /\/search$/.test(c.ruta)), listas: () => llamadas.filter((c) => c.metodo === "GET" && /\/messages$/.test(c.ruta)).length };
}

function armar(sim: Sim, sols: Sol[] = SOLS, extra: { esperas?: number[]; porLlamadaMs?: number } = {}) {
  const reloj = { t: AHORA, porLlamada: extra.porLlamadaMs ?? 0 };
  const bd = crearBd(sols.map((s) => ({ ...s }))); const http = crearHttp(sim, reloj); const al = crearAlmacen(); const notificados: number[] = []; const esperas = extra.esperas ?? []; const rondas: number[] = [];
  /** A fresh run (new client, new budget) sharing the SAME mailbox, database and durable store — i.e. another invocation. */
  const nueva = (o: Partial<DepsNotificacion> = {}): DepsNotificacion => ({
    config: CONFIG, cliente: crearClienteHostinger({ baseUrl: BASE_API_HOSTINGER, token: TOKEN_API, fetch: http.fetch, esperar: async (ms) => { esperas.push(ms); reloj.t += ms; } }), almacen: al.almacen,
    estadoRespuesta: estadoRespuestaDe(bd.admin), ahoraMs: () => reloj.t, esperar: async (ms) => { rondas.push(ms); reloj.t += ms; },
    procesar: (ev: EventoNormalizado) => procesarEvento({ admin: bd.admin, usuariosAvisar: (s) => usuariosAvisarPorDefecto(bd.admin, s), notificarInterno: async (s) => { notificados.push(s.id); } }, ev),
    ...o,
  });
  return { bd, http, al, deps: nueva(), nueva, notificados, esperas, rondas, reloj, sim };
}
const notificacion = (deps: DepsNotificacion, authorization: string | null = `Bearer ${SECRETO}`, cuerpoCrudo = "{}") => manejarNotificacionHostinger({ config: configHostinger(ENV), authorization, cuerpoCrudo, construir: () => deps });
const cron = (deps: DepsNotificacion, authorization: string | null = `Bearer ${CRON}`, config = configHostinger(ENV), secretoCron: string | undefined = CRON) => manejarCronHostinger({ config, authorization, secretoCron, construir: () => deps });
type Res = { progresoParcial: number; completo: boolean; pendiente: boolean; barridoEnCurso: boolean; conflicto: boolean; presupuestoAgotado: boolean; pendientesGuardados: number; pendientesRecuperados: number; pendientesRestantes: number; paginas: number; revisados: number; yaRegistrados: number; nuevos: number; procesados: number; inconsistentes: number; sinToken: number; tokenDesconocido: number; desaparecidos: number };
const resumen = (r: { body: Record<string, unknown> }) => r.body as unknown as Res;
/** RC-3: las pruebas que corren con el RELOJ REAL (ahoraMs: undefined) necesitan correo reciente según ESE reloj: con las fechas ancladas a AHORA (2026-11-22) la ventana de 72 h del primer barrido las descarta desde 2026-11-25 14:00Z y el pase termina «completo» sin ejercer el plazo. */
const recienteReal = () => new Date(Date.now() - 3_600_000).toISOString();
const respuestasA = (n: number, desde = 1000, token = TOKEN_A) => Array.from({ length: n }, (_, i) => msg(desde + i, [dir(token)]));
const sinTokens = (n: number, desde: number) => Array.from({ length: n }, (_, i) => msg(desde + i, [{ address: "otro@hotel.test" }]));
const dedupes = (bd: ReturnType<typeof crearBd>) => bd.eventos.map((e) => e.dedupe);
const base = `/api/v1/mailboxes/${BUZON}/folders/INBOX/messages`;

// ═════════════════════════════════ correlation, namespaces, duplicates, authentication (round 1, adapted to the durable sweep) ═════════════════════════════════
test("H1 a reply to the request's Reply-To address is correlated: one «respuesta» event for THAT request, notices once, internal mail once; only the configured mailbox/INBOX, authenticated with the API token (never the webhook secret); read-only calls only", async () => {
  const { bd, http, deps, notificados, al } = armar({ mensajes: [msg(7, [dir(TOKEN_A)])], textos: { 7: "Confirmamos disponibilidad. Saludos." } });
  const r = await notificacion(deps);
  assert.equal(r.status, 200); assert.equal(resumen(r).nuevos, 1); assert.equal(resumen(r).completo, true);
  assert.equal(bd.eventos.length, 1); const e = bd.eventos[0];
  assert.deepEqual([e.solicitud, e.tipo, e.dedupe, e.externo], [1, "respuesta", `hostinger:${BUZON}:<m7@hotel.test>`, "<m7@hotel.test>"]);
  assert.deepEqual(e.resumen, { de: "reservas@hotel.test", asunto: "Re: Solicitud", texto: "Confirmamos disponibilidad. Saludos." });
  assert.equal(bd.estado.get(1), "respondida"); assert.equal(bd.avisos.size, 2, "creator + operations user"); assert.deepEqual(notificados, [1]);
  assert.ok(http.llamadas.every((c) => c.auth === `Bearer ${TOKEN_API}` && c.ruta.startsWith(base) && c.url.startsWith(BASE_API_HOSTINGER)), JSON.stringify(http.llamadas));
  assert.ok(http.llamadas.every((c) => c.metodo === "GET" || (c.metodo === "POST" && c.ruta === `${base}/search`)), "the only non-GET call is the documented read-only search");
  assert.deepEqual(http.llamadas.map((c) => c.ruta.replace(base, "")), ["", "/search", "/7", "/7/text", ""]);
  assert.equal(http.llamadas[1].cuerpo, JSON.stringify({ uid: "1:7" }), "the search carries ONLY the uid range (no `since`, HIN-4)"); assert.deepEqual(al.estado(), { version: 2, uidCubierto: 7, barridoTope: null, barridoSiguiente: null, barridoDesde: null });
  assert.ok(!JSON.stringify(r.body).includes("Confirmamos"), "the response never carries message content");
  const idle = await notificacion(armar({ mensajes: [] }).deps); assert.equal(idle.status, 200);
});

test("H2 unknown / non-correlating messages are ignored WITHOUT downloading them: unknown token, no token, another domain, another local part, a Resend-looking id in In-Reply-To", async () => {
  const sim: Sim = { mensajes: [
    msg(1, [dir("DesconocidoDesconocido1")]), msg(2, [{ address: "alguien@hotel.test" }]), msg(3, [dir(TOKEN_A, "respuestas", "otro.test")]), msg(4, [dir(TOKEN_A, "otra-persona")]),
    msg(5, [{ address: "alguien@hotel.test" }], { inReplyTo: "re_resend_email_id_1" }), msg(6, [{ address: "alguien@hotel.test" }], { inReplyTo: "<re_resend_email_id_1>" }),
  ] };
  const { bd, http, deps } = armar(sim); const r = await notificacion(deps); const b = resumen(r);
  assert.equal(r.status, 200); assert.deepEqual([b.procesados, b.nuevos, b.tokenDesconocido, b.sinToken], [0, 0, 1, 5]);
  assert.equal(bd.eventos.length, 0); assert.equal(http.descargas(), 0, "no message and no text was downloaded"); assert.equal(bd.lecturas.porMensajeId, 0, "an RFC In-Reply-To is never looked up against the provider's email-id column");
});

test("H3 RFC Message-ID vs provider email id are separate namespaces: an «rfc822» event never queries mensaje_id; the Resend-style event still does (existing behaviour preserved)", async () => {
  const { bd } = armar({ mensajes: [] });
  const baseEv = { tipo: "respuesta" as const, dedupe: "d1", externoId: "re_resend_email_id_1", token: null, enRespuestaA: null, resumen: {} };
  const deps = { admin: bd.admin, usuariosAvisar: async () => [] };
  const rfc = await procesarEvento(deps, { ...baseEv, espacio: "rfc822" }); assert.deepEqual([rfc.ignorado, bd.lecturas.porMensajeId], [true, 0]);
  const resend = await procesarEvento(deps, baseEv); assert.equal(resend.ignorado, false); assert.equal(bd.lecturas.porMensajeId, 1, "provider ids still correlate by mensaje_id");
});

test("H4 duplicate suppression: a lost cursor makes the SAME mail be seen again — it is found already recorded and costs no download; repeated and concurrent notifications store one event, one set of notices, one internal e-mail", async () => {
  const s = armar({ mensajes: [msg(7, [dir(TOKEN_A)])] });
  await notificacion(s.deps); const d1 = s.http.descargas();
  s.al.estados.clear();                                                                   // the durable cursor is lost: the whole window is scanned again
  const r2 = await notificacion(s.nueva()); assert.equal(resumen(r2).yaRegistrados, 1); assert.equal(s.http.descargas(), d1, "already recorded → nothing downloaded");
  const rep = await Promise.all([notificacion(s.nueva()), notificacion(s.nueva()), notificacion(s.nueva())]); for (const r of rep) assert.equal(r.status, 200);
  assert.equal(s.bd.eventos.length, 1); assert.equal(s.bd.avisos.size, 2); assert.deepEqual(s.notificados, [1]);
  const n = armar({ mensajes: [msg(7, [dir(TOKEN_A)])] });                                // both runs pass the pre-check: the RPC key still decides
  await Promise.all([notificacion(n.nueva({ estadoRespuesta: async () => "pendiente" })), notificacion(n.nueva({ estadoRespuesta: async () => "pendiente" }))]); assert.equal(n.bd.eventos.length, 1); assert.deepEqual(n.notificados, [1]);
});

test("H5 one message to two requests' addresses records one reply EACH (own dedupe row per request, same message key); the same token twice counts once; at most 3 tags are read", async () => {
  const { bd, deps } = armar({ mensajes: [msg(8, [dir(TOKEN_A), dir(TOKEN_A), dir(TOKEN_B)])] });
  await notificacion(deps);
  assert.deepEqual(bd.eventos.map((e) => e.solicitud).sort(), [1, 2]); assert.equal(new Set(bd.eventos.map((e) => e.dedupe)).size, 1);
  assert.equal(tokensDeDirecciones([TOKEN_A, TOKEN_B, "ZZZZZZZZZZZZZZZZZZZZZZZZ", "YYYYYYYYYYYYYYYYYYYYYYYY"].map((t) => `Hotel <respuestas+${t}@dspacios.test>`), RESPONDER_A).length, 3);
});

test("H6 authentication: no header, other scheme, wrong or empty secret → 401 and NOTHING is touched (no HTTP, no database client); disabled or incomplete configuration → 503 and nothing is touched; oversize body → 413", async () => {
  const { http, deps } = armar({ mensajes: [msg(7, [dir(TOKEN_A)])] }); let construido = 0;
  const probar = async (authorization: string | null, config = configHostinger(ENV), cuerpo = "{}") => manejarNotificacionHostinger({ config, authorization, cuerpoCrudo: cuerpo, construir: () => { construido++; return deps; } });
  for (const a of [null, "", "Basic abc", `Bearer`, `Bearer ${SECRETO}x`, `Bearer ${SECRETO.slice(1)}`, `bearer  `, SECRETO]) assert.equal((await probar(a)).status, 401, String(a));
  assert.equal((await probar(`Bearer ${TOKEN_API}`)).status, 401, "the API token is not the webhook secret");
  assert.equal((await probar(`Bearer ${SECRETO}`, configHostinger({}))).status, 503, "off by default");
  assert.equal((await probar(`Bearer ${SECRETO}`, configHostinger({ ...ENV, SOLICITUD_PROVEEDOR_HOSTINGER: "off" }))).status, 503);
  assert.equal((await probar(`Bearer ${SECRETO}`, configHostinger({ ...ENV, SOLICITUD_PROVEEDOR_HOSTINGER_TOKEN: "" }))).status, 503);
  assert.equal((await probar(`Bearer ${SECRETO}`, configHostinger({ ...ENV, SOLICITUD_PROVEEDOR_HOSTINGER_MAILBOX_ID: "../../otro/buzon" }))).status, 503, "the mailbox id must have the documented opaque shape");
  assert.equal((await probar(`Bearer ${SECRETO}`, configHostinger(ENV), "x".repeat(70_000))).status, 413);
  assert.equal(construido, 0); assert.equal(http.llamadas.length, 0);
  assert.equal(bearerValido(`Bearer ${SECRETO}`, SECRETO), true); assert.equal(bearerValido(`Bearer ${SECRETO}`, undefined), false); assert.equal(bearerValido(`Bearer ${SECRETO}`, ""), false);
  const ok = await probar(`Bearer ${SECRETO}`); assert.equal(ok.status, 200); assert.equal(construido, 1);
  const dis = configHostinger({}); assert.deepEqual([dis.ok, dis.ok ? null : dis.activo], [false, false]);
});

test("H7 unauthorized mailbox / message references: the notification body is IGNORED (it can name any mailbox, folder or uid); URLs are built only from the configured mailbox, INBOX and uids the search returned; a detail that does not match is rejected", async () => {
  const cuerpoHostil = JSON.stringify({ mailboxResourceId: "OTRO-BUZON-999", folder: "INBOX.Sent", uid: 99999, messageId: "<victima@x>", event: "message.received", token: TOKEN_B });
  const { bd, http, deps } = armar({ mensajes: [msg(7, [dir(TOKEN_A)])] });
  const r = await notificacion(deps, `Bearer ${SECRETO}`, cuerpoHostil); assert.equal(r.status, 200);
  assert.ok(http.llamadas.every((c) => c.ruta.includes(`/mailboxes/${BUZON}/folders/INBOX/messages`) && !/99999|OTRO-BUZON|Sent/.test(c.url + (c.cuerpo ?? ""))), JSON.stringify(http.llamadas.map((c) => c.ruta)));
  assert.deepEqual(bd.eventos.map((e) => e.solicitud), [1], "the token in the body did not create anything");
  const falso = armar({ mensajes: [msg(7, [dir(TOKEN_A)])], detalle: (uid) => msg(uid + 1, [dir(TOKEN_A)]) }); const r2 = await notificacion(falso.deps);
  assert.equal(r2.status, 202, "an inconsistent detail leaves the pass incomplete, never a 200"); assert.equal(falso.bd.eventos.length, 0); assert.equal(resumen(r2).inconsistentes, 1);
  const otroId = armar({ mensajes: [msg(7, [dir(TOKEN_A)])], detalle: (uid) => msg(uid, [dir(TOKEN_A)], { messageId: "<otro@x>" }) }); await notificacion(otroId.deps); assert.equal(otroId.bd.eventos.length, 0);
});

test("H8 provider errors and timeouts: transient failures are retried within the bound (≤3 attempts, Retry-After honoured and capped); persistent first-call failures stop and report; bad API token / 404 / other 4xx / non-JSON are not retried; nothing is recorded on a failure", async () => {
  let s = armar({ mensajes: [msg(7, [dir(TOKEN_A)])], fallos: [{ patron: new RegExp(`${base}$`), secuencia: [500, "timeout"] }] });
  let r = await notificacion(s.deps); assert.equal(r.status, 200); assert.equal(s.http.listas(), 4, "3 attempts for the first list, then the idle check"); assert.equal(s.bd.eventos.length, 1); assert.deepEqual(s.esperas, [500, 1000]);
  s = armar({ mensajes: [msg(7, [dir(TOKEN_A)])], fallos: [{ patron: new RegExp(`${base}$`), secuencia: Array(10).fill(500) }] });
  r = await notificacion(s.deps); assert.equal(r.status, 502); assert.equal(s.http.listas(), INTENTOS_MAX); assert.equal(s.bd.rpcs.length, 0); assert.equal(s.bd.eventos.length, 0); assert.equal(s.al.cas.length, 0, "the cursor did not move");
  s = armar({ mensajes: [msg(7, [dir(TOKEN_A)])], fallos: [{ patron: new RegExp(`${base}$`), secuencia: [429] }] }); r = await notificacion(s.deps); assert.equal(r.status, 200); assert.deepEqual(s.esperas, [2000]);
  for (const st of [401, 403]) { s = armar({ mensajes: [], fallos: [{ patron: /./, secuencia: [st] }] }); r = await notificacion(s.deps); assert.equal(r.status, 503); assert.equal(s.http.llamadas.length, 1); assert.ok(!JSON.stringify(r.body).includes(TOKEN_API) && !JSON.stringify(r.body).includes(SECRETO)); }
  s = armar({ mensajes: [], fallos: [{ patron: /./, secuencia: ["json"] }] }); r = await notificacion(s.deps); assert.equal(r.status, 502); assert.equal(s.http.llamadas.length, 1);
  s = armar({ mensajes: [], fallos: [{ patron: /./, secuencia: [422] }] }); r = await notificacion(s.deps); assert.equal(r.status, 502); assert.equal(s.http.llamadas.length, 1);
  s = armar({ mensajes: [msg(7, [dir(TOKEN_A)])], detalle: () => null }); r = await notificacion(s.deps); assert.equal(r.status, 200); assert.equal(s.bd.eventos.length, 0); assert.equal(resumen(r).desaparecidos, 1, "a vanished message is counted, not retried");
  s = armar({ mensajes: [msg(7, [dir(TOKEN_A)])], fallos: [{ patron: /\/text$/, secuencia: [404] }] }); r = await notificacion(s.deps); assert.equal(s.bd.eventos.length, 1); assert.equal(s.bd.eventos[0].resumen.texto, undefined);
});

test("H9 a database failure while checking/recording fails the notification (the route answers 500) and leaves nothing half-done: no event, no internal mail, the cursor not advanced past the message", async () => {
  const s = armar({ mensajes: [msg(7, [dir(TOKEN_A)])] }); s.bd.romper("solicitudes_proveedor");
  await assert.rejects(() => notificacion(s.deps), /solicitudes_proveedor/); assert.equal(s.bd.eventos.length, 0); assert.deepEqual(s.notificados, []); assert.equal(s.http.descargas(), 0); assert.equal(s.al.estado().barridoSiguiente, 7, "the sweep is saved mid-way, ready to resume");
  s.bd.romper(null); const r = await notificacion(s.nueva()); assert.equal(r.status, 200); assert.equal(s.bd.eventos.length, 1);
});

test("H10 a reply NEVER confirms or rejects: text saying «confirmado»/«rechazado» leaves the request «respondida»; a payment notice reply is also only «respondida»; only «respuesta» events are ever produced", async () => {
  const s = armar({ mensajes: [msg(1, [dir(TOKEN_A)]), msg(2, [dir(TOKEN_PAGO)]), msg(3, [dir(TOKEN_B)])], textos: { 1: "CONFIRMADO. Reserva confirmada, todo en orden.", 2: "Pago recibido y aplicado. Confirmado.", 3: "RECHAZADO, no hay cupo." } });
  await notificacion(s.deps);
  assert.deepEqual([...s.bd.estado.entries()], [[1, "respondida"], [2, "respondida"], [3, "respondida"]]);
  assert.ok(s.bd.eventos.every((e) => e.tipo === "respuesta")); assert.ok(s.bd.rpcs.every((x) => x.endsWith(":respuesta")));
  const c = armar({ mensajes: [msg(1, [dir(TOKEN_A)])] }, [{ ...SOLS[0], estado: "confirmada" }]); await notificacion(c.deps); assert.equal(c.bd.estado.get(1), "confirmada");
});

test("H12 malformed entries are dropped (no uid, wrong types), a message without Message-ID falls back to uid+date for its key, and the stored sender/subject/text are truncated", async () => {
  const largo = "x".repeat(5000);
  const s = armar({ mensajes: [{ ...msg(5, [dir(TOKEN_A)]), messageId: null, subject: largo, from: { address: `${"a".repeat(300)}@x.test` } } as Msg, { nada: 1 } as never, null as never, "x" as never, { ...msg(3, [dir(TOKEN_A)]), uid: "3" } as never], textos: { 5: largo } });
  const r = await notificacion(s.deps); assert.equal(r.status, 200); assert.equal(s.bd.eventos.length, 1);
  const basura = armar({ mensajes: [{ ...msg(9, [dir(TOKEN_A)]), uid: "9" } as never] }); const rb = await notificacion(basura.deps); assert.equal(rb.status, 502, "an unreadable newest entry is a loud error, never «empty mailbox»"); assert.equal(basura.al.cas.length, 0);
  const e = s.bd.eventos[0]; assert.match(e.dedupe, /^hostinger:AC1a2b3c4d5e6f7g:uid:5:20/); assert.equal(e.externo, null);
  assert.equal((e.resumen.texto as string).length, 2000); assert.equal((e.resumen.asunto as string).length, 300); assert.equal((e.resumen.de as string).length, 200);
});

test("H13/H14 live behaviour is OFF by default; the client only issues GET plus the documented read-only search (any other POST is refused); the base URL is fixed to Hostinger and a local override is accepted ONLY for loopback", async () => {
  assert.equal(configHostinger({}).ok, false); assert.equal(configHostinger({ SOLICITUD_PROVEEDOR_HOSTINGER: "activo" }).ok, false);
  const http = crearHttp({ mensajes: [] }); const c = crearClienteHostinger({ baseUrl: BASE_API_HOSTINGER, token: TOKEN_API, fetch: http.fetch, esperar: async () => {} });
  await c.get(base); await c.buscar(`${base}/search`, { uid: "1:5" }); assert.deepEqual(http.llamadas.map((x) => x.metodo), ["GET", "POST"]);
  assert.throws(() => c.buscar(`${base}/7`, {}), /solo la búsqueda/); assert.throws(() => c.buscar("/api/v1/mailboxes/x/send", {}), /solo la búsqueda/);
  assert.equal((configHostinger(ENV) as { config: { baseUrl: string } }).config.baseUrl, BASE_API_HOSTINGER);
  assert.equal((configHostinger({ ...ENV, SOLICITUD_PROVEEDOR_HOSTINGER_API_URL: "http://127.0.0.1:19999" }) as { config: { baseUrl: string } }).config.baseUrl, "http://127.0.0.1:19999");
  for (const u of ["https://evil.example.com", "http://127.0.0.1.evil.com", "https://api.mail.hostinger.com.evil.test", "http://10.0.0.5"]) assert.equal(configHostinger({ ...ENV, SOLICITUD_PROVEEDOR_HOSTINGER_API_URL: u }).ok, false, u);
});

// ═════════════════════════════════ HIN-2 · durable continuation across runs ═════════════════════════════════
test("S1 (HIN-2) a reply behind MORE than 500 newer unrelated messages is processed with NO new mail — the probe that starved at 520 — and a mailbox far larger than one run can read drains over successive runs from the saved cursor", async () => {
  const unos = armar({ mensajes: [...sinTokens(520, 2000), ...respuestasA(1, 100)] });          // 520 newer ordinary messages, then one old reply
  const r = await notificacion(unos.deps); assert.equal(r.status, 200); assert.equal(resumen(r).completo, true); assert.equal(unos.bd.eventos.length, 1);
  // 12,000 newer unrelated messages cannot be read in one bounded run (≈ 58 pages of 100 per 60-attempt budget)
  const g = armar({ mensajes: [...sinTokens(12_000, 5000), ...respuestasA(1, 100)] });
  const pasadas: Res[] = []; const topes: (number | null)[] = [];
  for (let i = 0; i < 8; i++) {
    const antes = g.http.llamadas.length; const r2 = await cron(g.nueva()); const b = resumen(r2); pasadas.push(b); topes.push(g.al.estado().barridoSiguiente);
    assert.ok(g.http.llamadas.length - antes <= SOLICITUDES_MAX, "one run never exceeds its attempt budget"); if (b.completo) break;
  }
  assert.equal(pasadas[0].completo, false, "one run is not enough"); assert.equal(pasadas[0].barridoEnCurso, true);
  assert.equal(pasadas.at(-1)!.completo, true); assert.ok(pasadas.length >= 2 && pasadas.length <= 4, `drained in ${pasadas.length} runs`);
  assert.equal(g.bd.eventos.length, 1, "the buried reply was recorded exactly once, without any new mail"); assert.equal(g.notificados.length, 1);
  const vistos = topes.filter((t): t is number => t !== null); assert.ok(vistos.every((t, i) => i === 0 || t < vistos[i - 1]), "the saved position only moves down: no region is repeated or skipped");
});

test("S2 (HIN-2) the cursor survives process restarts: every run is a fresh client/budget over the same durable store; an idle run (nothing newer than the cursor) costs ONE call and no search", async () => {
  const s = armar({ mensajes: [...respuestasA(3, 100), ...sinTokens(10, 500)] });
  await cron(s.nueva()); const estado = s.al.estado(); assert.deepEqual([estado.barridoSiguiente, estado.uidCubierto], [null, 509]);
  const antes = s.http.llamadas.length; const busquedasAntes = s.http.busquedas().length; const r = await cron(s.nueva()); assert.equal(resumen(r).completo, true);
  assert.equal(s.http.llamadas.length - antes, 1); assert.equal(s.http.busquedas().length, busquedasAntes, "no new search: nothing newer than the cursor");
});

test("S3 (HIN-2) NEWER mail arriving between runs neither skips nor repeats a region: the running sweep continues below its top, and the NEXT sweep covers ONLY uids above the previous top (including a newer reply)", async () => {
  const sim: Sim = { mensajes: [...sinTokens(12_000, 5000), ...respuestasA(1, 100)] }; const s = armar(sim);
  await cron(s.nueva()); const e1 = s.al.estado(); assert.ok(e1.barridoSiguiente !== null && e1.barridoTope === 16_999);
  sim.mensajes.push(...sinTokens(300, 20_000), ...respuestasA(1, 30_000, TOKEN_B));                                // 300 newer unrelated + a NEWER reply arrive mid-sweep
  for (let i = 0; i < 8 && !(s.al.estado().barridoSiguiente === null && s.al.estado().uidCubierto === 30_000); i++) await cron(s.nueva());
  assert.deepEqual(s.al.estado(), { version: s.al.estado().version, uidCubierto: 30_000, barridoTope: null, barridoSiguiente: null, barridoDesde: null });
  assert.deepEqual(s.bd.eventos.map((e) => e.solicitud).sort(), [1, 2], "the old reply (below the first top) and the newer one (above it) are both recorded, once");
  const cierres = s.al.cas.filter((c) => c.gano && c.nuevo && c.nuevo.barridoTope === null).map((c) => c.nuevo!.uidCubierto);
  assert.deepEqual(cierres, [16_999, 30_000], "first sweep closed at ITS top (16999); the second one only covered what was above it");
  const segundas = s.http.busquedas().map((c) => JSON.parse(c.cuerpo!).uid as string).filter((x) => Number(x.split(":")[0]) > 1);
  assert.ok(segundas.length >= 1 && segundas.every((x) => Number(x.split(":")[0]) === 17_000), "the second sweep starts at the previous top + 1 and never rescans below it");
  const r = await cron(s.nueva()); assert.equal(resumen(r).completo, true); assert.equal(s.bd.eventos.length, 2);
});

test("S4 (HIN-2) mail DELETED between runs (the owner clears part of the inbox, even the unscanned region) cannot make the sweep skip or loop: it resumes by uid and ends", async () => {
  const sim: Sim = { mensajes: [...sinTokens(12_000, 5000), ...respuestasA(2, 100)] }; const s = armar(sim);
  await cron(s.nueva()); assert.ok(s.al.estado().barridoSiguiente !== null);
  sim.mensajes = sim.mensajes.filter((m) => m.uid < 9_000 || m.uid >= 14_000);                                    // 5,000 messages vanish from the middle
  for (let i = 0; i < 8 && s.al.estado().barridoSiguiente !== null; i++) await cron(s.nueva());
  assert.equal(s.al.estado().barridoSiguiente, null); assert.equal(s.bd.eventos.length, 2); assert.equal(new Set(dedupes(s.bd)).size, 2);
});

test("S5 (HIN-2/HIN-1) a failed download is PARKED before the cursor moves past it and survives across runs: it is retried first by every later run, never ages out of the window, and is recorded exactly once; still-failing replies stay (more attempts, never dropped)", async () => {
  const s = armar({ mensajes: [...sinTokens(30, 5000), msg(2500, [dir(TOKEN_A)]), ...sinTokens(30, 2000)], fallos: [{ patron: /\/messages\/2500\/text$/, secuencia: Array(40).fill(500) }] });
  const r1 = await notificacion(s.deps); const b1 = resumen(r1);
  assert.equal(r1.status, 202); assert.deepEqual([b1.completo, b1.pendiente, b1.pendientesGuardados, b1.pendientesRestantes], [false, true, 1, 1]); assert.equal(s.bd.eventos.length, 0);
  assert.equal(s.al.estado().barridoSiguiente, null, "the sweep itself finished: the cursor moved past the failing reply"); assert.equal(s.al.estado().uidCubierto, 5029); assert.deepEqual([...s.al.pend.keys()], [2500]);
  assert.deepEqual(s.rondas, [1000], "one short wait, then the single final retry of what was parked in this run");
  const r2 = await cron(s.nueva()); assert.equal(r2.status, 200); assert.equal(resumen(r2).completo, false, "still failing: reported, not dropped"); assert.equal(s.al.pend.get(2500)!.intentos >= 2, true);
  s.reloj.t += (VENTANA_HORAS + 100) * 3_600_000;                                                                 // 100 h later: the message is far outside the 72 h discovery window
  s.sim.fallos = [];                                                                                             // the provider recovers
  const r3 = await cron(s.nueva()); assert.equal(resumen(r3).completo, true); assert.equal(s.bd.eventos.length, 1, "recorded although it is older than the window: the backlog does not age out"); assert.equal(s.al.pend.size, 0);
  assert.deepEqual(s.notificados, [1]); await cron(s.nueva()); assert.equal(s.bd.eventos.length, 1);
});

test("S5b (HIN-2/HIN-3) the failed reply is parked BEFORE the cursor moves on even when the run has no HTTP attempts left for its final retry (an exhausted allowance does not block database work): nothing is lost, the next run records it", async () => {
  const s = armar({ mensajes: [msg(2500, [dir(TOKEN_A)])], fallos: [{ patron: /\/messages\/2500\/text$/, secuencia: Array(40).fill(500) }] });
  const r = await notificacion(s.nueva({ solicitudesMax: 6 }));                                                    // top(1) + search(1) + detail(1) + 3 failing text attempts = the whole allowance
  assert.equal(r.status, 202); assert.deepEqual([...s.al.pend.keys()], [2500], "parked"); assert.equal(s.al.estado().uidCubierto, 2500, "the cursor moved past it only because it is parked"); assert.deepEqual(s.rondas, [], "no attempts were left for the final retry");
  s.sim.fallos = []; const r2 = await cron(s.nueva()); assert.equal(resumen(r2).completo, true); assert.equal(s.bd.eventos.length, 1); assert.equal(s.al.pend.size, 0);
});

test("S6 (HIN-1) a brief provider blip is recovered inside the same run by the single final retry (after a short wait): complete, nothing left parked", async () => {
  const s = armar({ mensajes: [msg(7, [dir(TOKEN_A)])], fallos: [{ patron: /\/messages\/7$/, secuencia: [500, 500, 500] }] });   // the first attempt exhausts its 3 tries
  const r = await notificacion(s.deps); const b = resumen(r);
  assert.equal(r.status, 200); assert.deepEqual([b.completo, b.pendientesGuardados, b.pendientesRecuperados, b.pendientesRestantes], [true, 1, 1, 0]); assert.equal(s.al.pend.size, 0); assert.equal(s.bd.eventos.length, 1);
});

test("S7 (HIN-2) concurrent runs: of several simultaneous runs exactly one advances each step (compare-and-swap), the others stop with `conflicto`, nothing is recorded twice, no internal notice is duplicated, and repeated runs finish the backlog", async () => {
  const s = armar({ mensajes: [...respuestasA(60, 20_000), ...sinTokens(3_000, 5_000), ...respuestasA(10, 100)] });
  const res = await Promise.all([cron(s.nueva()), cron(s.nueva()), notificacion(s.nueva()), cron(s.nueva())]);
  assert.ok(res.some((x) => resumen(x).conflicto), "somebody lost a race"); assert.ok(s.al.cas.filter((c) => !c.gano).length <= res.length - 1, "each losing run stops at its FIRST lost compare-and-swap (bounded redundancy)"); const ganadas = s.al.cas.filter((c) => c.gano).length; assert.equal(s.al.estado().version, ganadas, "the version counts exactly the winning advances");
  for (let i = 0; i < 12 && !(s.al.estado().barridoSiguiente === null && s.al.pend.size === 0 && s.bd.eventos.length === 70); i++) await Promise.all([cron(s.nueva()), notificacion(s.nueva())]);
  assert.equal(s.bd.eventos.length, 70); assert.equal(new Set(dedupes(s.bd)).size, 70, "no duplicate event"); assert.equal(s.notificados.length, 70, "one internal notice per reply even when runs overlap"); assert.equal(s.bd.avisos.size, 140);
  const ganadores = s.al.cas.filter((c) => c.gano && c.nuevo); assert.ok(ganadores.every((c, i) => i === 0 || c.nuevo!.uidCubierto >= ganadores[i - 1].nuevo!.uidCubierto), "the covered watermark never goes backwards");
  const final = await cron(s.nueva()); assert.equal(resumen(final).completo, true); assert.equal(resumen(final).nuevos, 0);
});

test("S7b (HIN-2) a compare-and-swap LOST at a page advance (another run moved the cursor in between): this run stops at once (conflicto), reads no further page, and the winner's position stands", async () => {
  const s = armar({ mensajes: sinTokens(450, 100) });
  let inyectado = false; const original = s.al.almacen.avanzar;
  const almacen: AlmacenHostinger = { ...s.al.almacen, avanzar: async (b, v, n) => {
    if (!inyectado && n.barridoTope !== null && n.barridoSiguiente !== n.barridoTope) { inyectado = true; const e = s.al.estado(); await original(b, e.version, { uidCubierto: e.uidCubierto, barridoTope: e.barridoTope, barridoSiguiente: e.barridoSiguiente, barridoDesde: e.barridoDesde }); }   // «another run» advances first
    return original(b, v, n);
  } };
  const r = await cron(s.nueva({ almacen })); assert.equal(resumen(r).conflicto, true); assert.equal(resumen(r).completo, false);
  assert.equal(s.http.busquedas().length, 1, "no page was read after the lost race"); assert.equal(s.al.cas.filter((c) => !c.gano).length, 1);
});

test("S8 (HIN-2) mailbox uids that go BACKWARDS (mailbox recreated) restart the sweep safely: recorded replies are skipped, a new reply is found; an EMPTY mailbox and a window edge end the sweep", async () => {
  const sim: Sim = { mensajes: [...respuestasA(2, 800), ...sinTokens(5, 1000)] }; const s = armar(sim);
  await cron(s.nueva()); assert.equal(s.al.estado().uidCubierto, 1004); assert.equal(s.bd.eventos.length, 2);
  sim.mensajes = [...respuestasA(1, 50), ...sinTokens(3, 60)];                                                    // uids restart low
  const r = await cron(s.nueva()); assert.equal(resumen(r).completo, true); assert.equal(s.bd.eventos.length, 3); assert.equal(s.al.estado().uidCubierto, 62);
  sim.mensajes = []; assert.equal(resumen(await cron(s.nueva())).completo, true);
  const viejo = (uid: number) => msg(uid, [dir(TOKEN_A)], { date: new Date(AHORA - (VENTANA_HORAS + 30) * 3_600_000).toISOString() });
  const w = armar({ mensajes: [...respuestasA(2, 5000), ...Array.from({ length: 250 }, (_, i) => viejo(1 + i))] }); const rw = await notificacion(w.deps);
  assert.equal(rw.status, 200); assert.equal(w.bd.eventos.length, 2); assert.equal(w.http.busquedas().length, 3, "without a server-side filter the old mail is paged through (250 old + 2 recent = 3 pages) and skipped LOCALLY"); assert.equal(w.al.estado().uidCubierto, 5001);
});

test("S9 (HIN-2) a search that does NOT honour its uid range is refused (never trusted): 502, nothing recorded, and the cursor stays where the LAST VALID page left it", async () => {
  const s = armar({ mensajes: sinTokens(150, 1), ignoraRango: true });                  // page 1 (uids 150..51) is valid for «1:150»; the next request «1:50» is answered with the SAME uids 150..51, which lie outside it
  const r = await notificacion(s.deps);
  assert.equal(r.status, 502); assert.equal(s.bd.eventos.length, 0); assert.equal(s.al.estado().barridoSiguiente, 50, "the cursor is exactly where the last trusted page left it"); assert.equal(s.al.estado().uidCubierto, 0);
});

// ═════════════════════════════════ HIN-3 · one shared deadline / attempt budget ═════════════════════════════════
test("B1 (HIN-3) the auditor's probe: every attempt takes the whole timeout — with the SHARED budget the first slow attempt spends it, no retry starts, total time stays within the budget (was 25.5 s for an 8 s promise) and the answer is an honest 202", async () => {
  const s = armar({ mensajes: [msg(7, [dir(TOKEN_A)])] }, SOLS, { porLlamadaMs: PRESUPUESTO_MS });                  // the clock advances by the full budget per attempt
  s.sim.fallos = [{ patron: /./, secuencia: Array(10).fill(500) }];
  const t0 = s.reloj.t; const r = await notificacion(s.deps);
  assert.equal(r.status, 202); assert.equal(s.http.llamadas.length, 1, "one attempt: the budget was gone before a retry could start"); assert.ok(s.reloj.t - t0 <= PRESUPUESTO_MS + 1, `elapsed ${s.reloj.t - t0} ms`); assert.equal(resumen(r).presupuestoAgotado, true); assert.equal(s.al.cas.length, 0);
});

test("B2 (HIN-3) REAL slow provider: an attempt that never answers is cut at the time LEFT (not the 10 s base timeout), retries and backoff waits cannot outlive the deadline", async () => {
  const s = armar({ mensajes: [msg(7, [dir(TOKEN_A)])], fallos: [{ patron: /./, secuencia: Array(10).fill("colgar") }] });
  const t0 = Date.now(); const r = await notificacion(s.nueva({ ahoraMs: undefined, presupuestoMs: 200 }));     // real clock, 200 ms budget
  const ms = Date.now() - t0; assert.ok(ms < 200 + 400, `took ${ms} ms for a 200 ms budget`); assert.equal(r.status, 202); assert.ok(s.http.llamadas.length <= 2);
  s.sim.fallos = [{ patron: /./, secuencia: Array(10).fill(500) }]; s.http.llamadas.length = 0;                      // fast failures: the backoff must be clipped to what is left
  const esperasReales: number[] = []; const c2 = crearClienteHostinger({ baseUrl: BASE_API_HOSTINGER, token: TOKEN_API, fetch: s.http.fetch, esperar: async (m) => { esperasReales.push(m); await dormir(m); } });
  const t1 = Date.now(); await notificacion(s.nueva({ cliente: c2, ahoraMs: undefined, presupuestoMs: 300 })); const ms2 = Date.now() - t1;
  assert.ok(ms2 < 300 + 400, `took ${ms2} ms`); assert.ok(esperasReales.every((m) => m <= 300), JSON.stringify(esperasReales)); assert.ok(s.http.llamadas.length <= INTENTOS_MAX);
});

test("B3 (HIN-3) near-exhausted attempt allowance: retries draw from the SHARED allowance and can never cross it (a 3-attempt call with 1 or 2 attempts left makes exactly that many)", async () => {
  for (const tope of [1, 2, 5]) {
    const s = armar({ mensajes: [msg(7, [dir(TOKEN_A)])], fallos: [{ patron: /./, secuencia: Array(50).fill(500) }] });
    const r = await notificacion(s.nueva({ solicitudesMax: tope })); assert.ok(s.http.llamadas.length <= tope, `allowance ${tope}: ${s.http.llamadas.length} attempts`); assert.equal(s.http.llamadas.length, Math.min(tope, INTENTOS_MAX), "it used what it was allowed");
    assert.ok([202, 502].includes(r.status)); assert.equal(s.bd.eventos.length, 0);
  }
  const p = crearPresupuesto({ intentos: 2 }); assert.deepEqual([p.puede(), (p.consumir(), p.puede()), (p.consumir(), p.puede()), p.intentosRestantes()], [true, true, false, 0]);
  const s2 = armar({ mensajes: [...respuestasA(30, 100)] }); await notificacion(s2.nueva({ solicitudesMax: 8 })); assert.ok(s2.http.llamadas.length <= 8, "the allowance also bounds the processing downloads");
});

test("B4 (HIN-3) slow DATABASE checks cannot make the pass unbounded: the deadline cuts them, the pass reports incomplete, the cursor is NOT advanced past unhandled mail, and a later run with a healthy database completes", async () => {
  const s = armar({ mensajes: respuestasA(50, 100).map((m) => ({ ...m, date: recienteReal() })) }); s.bd.lento.ms = 120;                                          // every database call takes 120 ms; 50 messages would need 6+ s
  const t0 = Date.now(); const r = await notificacion(s.nueva({ ahoraMs: undefined, presupuestoMs: 300 })); const ms = Date.now() - t0;
  assert.ok(ms < 300 + 500, `took ${ms} ms for a 300 ms budget`); assert.equal(r.status, 202); assert.equal(resumen(r).presupuestoAgotado, true); assert.ok(s.bd.eventos.length < 50);
  assert.ok(s.al.estado().barridoSiguiente !== null, "the sweep stays saved mid-way: nothing past unhandled mail was marked covered");
  await dormir(150); s.bd.lento.ms = 0;                                                                              // the dangling database calls finish; everything they did is idempotent
  for (let i = 0; i < 3 && s.bd.eventos.length < 50; i++) await cron(s.nueva());
  assert.equal(s.bd.eventos.length, 50); assert.equal(new Set(dedupes(s.bd)).size, 50); assert.equal(s.notificados.length, 50);
});

test("B5 (HIN-3) a slow event RECORD (the RPC) or a slow STORE write is bounded too; and a database call that fails AFTER the deadline fired does not become an unhandled rejection", async () => {
  const s = armar({ mensajes: [msg(7, [dir(TOKEN_A)], { date: recienteReal() })] }); const rechazos: unknown[] = []; const manejador = (e: unknown) => rechazos.push(e); process.on("unhandledRejection", manejador);
  try {
    const t0 = Date.now(); const lento = s.nueva({ ahoraMs: undefined, presupuestoMs: 150, procesar: async () => { await dormir(400); throw new Error("fallo tardío"); } }); const r = await notificacion(lento); const ms = Date.now() - t0;
    assert.ok(ms < 150 + 400, `took ${ms} ms`); assert.equal(r.status, 202); assert.equal(s.bd.eventos.length, 0); await dormir(500); assert.deepEqual(rechazos, [], "the late rejection was absorbed");
    s.al.cfg.retrasoMs = 300; const t1 = Date.now(); const r2 = await notificacion(s.nueva({ ahoraMs: undefined, presupuestoMs: 150 })); assert.ok(Date.now() - t1 < 150 + 400); assert.equal(r2.status, 202); s.al.cfg.retrasoMs = 0; await dormir(350);
    for (let i = 0; i < 3 && s.bd.eventos.length < 1; i++) await cron(s.nueva()); assert.equal(s.bd.eventos.length, 1);
  } finally { process.off("unhandledRejection", manejador); }
});

test("B6 a store (database) ERROR is not swallowed: the pass fails (500 from the route wrapper) without advancing; the budget helper is exact", async () => {
  const s = armar({ mensajes: [msg(7, [dir(TOKEN_A)])] }); s.al.cfg.rompe = "avanzar";
  await assert.rejects(() => notificacion(s.deps), /avanzar/); assert.equal(s.bd.eventos.length, 0);
  const p = crearPresupuesto({ ahora: () => 1000, ms: 500 }); assert.equal(p.restanteMs(), 500); assert.equal(p.puede(), true); assert.equal(crearPresupuesto({ ahora: () => 0, ms: 0 }).puede(), false);
});

// ═════════════════════════════════ scheduled drain handler and wiring ═════════════════════════════════
test("C1 scheduled drain (cron) handler: no CRON_SECRET → 503; missing/wrong bearer → 401 (both touch nothing); Hostinger entry OFF → 200 «desactivado» touching nothing; incomplete configuration → 503; rejected API token → 503; the webhook secret is not the cron secret; a complete pass answers 200 with counts only; an incomplete one reports `pendiente`", async () => {
  const s = armar({ mensajes: [msg(7, [dir(TOKEN_A)])] }); let construido = 0;
  const probar = (auth: string | null, cfg = configHostinger(ENV), secreto: string | null = CRON) => manejarCronHostinger({ config: cfg, authorization: auth, secretoCron: secreto ?? undefined, construir: () => { construido++; return s.deps; } });
  assert.equal((await probar(`Bearer ${CRON}`, configHostinger(ENV), null)).status, 503);
  for (const a of [null, "", "Bearer", `Bearer ${CRON}x`, `Bearer ${SECRETO}`, CRON]) assert.equal((await probar(a)).status, 401, String(a));
  const off = await probar(`Bearer ${CRON}`, configHostinger({})); assert.deepEqual([off.status, off.body], [200, { ok: true, desactivado: true }]);
  assert.equal((await probar(`Bearer ${CRON}`, configHostinger({ ...ENV, SOLICITUD_PROVEEDOR_HOSTINGER_TOKEN: "" }))).status, 503);
  assert.equal(construido, 0); assert.equal(s.http.llamadas.length, 0);
  const rechazado = armar({ mensajes: [], fallos: [{ patron: /./, secuencia: [401] }] }); assert.equal((await cron(rechazado.deps)).status, 503);
  const ok = await probar(`Bearer ${CRON}`); assert.equal(ok.status, 200); assert.equal(construido, 1); assert.equal(resumen(ok).completo, true); assert.ok(!JSON.stringify(ok.body).includes("Gracias"));
  const parcial = armar({ mensajes: [...sinTokens(12_000, 5000)] }); const pr = await cron(parcial.deps); assert.equal(pr.status, 200); assert.equal(resumen(pr).pendiente, true);
});

test("C2 wiring of the recovery driver: both routes are in the proxy's exact public lists, the DAILY cron entry exists in vercel.json (a sub-daily schedule would be rejected on a Hobby plan), the cron route requires CRON_SECRET through the shared handler, both routes share one deps builder with the durable store; migration 330 + its rollback/preflight/postcheck exist", () => {
  const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  assert.match(leer("proxy.ts"), /RUTAS_CRON = new Set\([\s\S]*"\/api\/cron\/respuestas-hostinger"[\s\S]*\]\)/); assert.match(leer("proxy.ts"), /"\/api\/solicitud-proveedor\/hostinger"/);
  const cr = (JSON.parse(leer("vercel.json")) as { crons: { path: string; schedule: string }[] }).crons.find((c) => c.path === "/api/cron/respuestas-hostinger");
  assert.ok(cr, "cron entry"); assert.match(cr!.schedule, /^\d{1,2} \d{1,2} \* \* \*$/, "daily");
  const ruta = leer("app/api/cron/respuestas-hostinger/route.ts"); assert.match(ruta, /process\.env\.CRON_SECRET/); assert.match(ruta, /manejarCronHostinger/); assert.match(ruta, /export async function GET/);
  assert.match(leer("app/api/solicitud-proveedor/hostinger/route.ts"), /construirDepsHostinger/); assert.match(ruta, /construirDepsHostinger/); assert.match(leer("lib/solicitudProveedor/hostingerDeps.ts"), /almacenHostingerDe\(admin\)/);
  for (const f of ["supabase/migrations/20260601000330_hostinger_entrada_estado.sql", "supabase/scripts/rollback_330_hostinger_entrada_estado.sql", "supabase/scripts/preflight_330_hostinger_entrada_estado.sql", "supabase/scripts/postcheck_330_hostinger_entrada_estado.sql"]) assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), f);
  assert.match(leer("supabase/migrations/20260601000330_hostinger_entrada_estado.sql"), /hostinger_estado_avanzar[\s\S]*version = p_version/);
});

// ═════════════════════════════════ HIN-2a · progress INSIDE a page · HIN-2b · eligibility across days ═════════════════════════════════
const hace = (h: number) => new Date(AHORA - h * 3_600_000).toISOString();
const registrarPrevios = (s: ReturnType<typeof armar>, uids: number[]) => { for (const uid of uids) s.bd.eventos.push({ solicitud: 1, tipo: "respuesta", dedupe: `hostinger:${BUZON}:<m${uid}@hotel.test>`, externo: null, resumen: {} }); };
const conLatencia = (s: ReturnType<typeof armar>, ms: number) => estadoRespuestaDe(s.bd.admin) && ((t: string, d: string) => { s.reloj.t += ms; return estadoRespuestaDe(s.bd.admin)(t, d); });

test("P1 (HIN-2a) the auditor's probe: ONE page of 100, the first 90 scanned already recorded, a database check of 100 ms each — progress inside the page is persisted, so the unhandled suffix is reached and recorded in a few runs (it never was before)", async () => {
  const s = armar({ mensajes: respuestasA(100, 1) });                                      // uids 1..100, all addressed to a known request; scanned newest first
  registrarPrevios(s, Array.from({ length: 90 }, (_, i) => 100 - i));                      // uids 100..11 are already recorded (the 90-message prefix); 10..1 are pending
  const lento = conLatencia(s, 100) as DepsNotificacion["estadoRespuesta"];
  const posiciones: (number | null)[] = []; let parciales = 0; let fin: Res | undefined;
  for (let i = 0; i < 5; i++) {
    const r = await cron(s.nueva({ estadoRespuesta: lento })); const b = resumen(r); parciales += b.progresoParcial; posiciones.push(s.al.estado().barridoSiguiente);
    if (b.completo) { fin = b; break; }
  }
  assert.ok(fin, `never completed; positions ${posiciones.join(",")}`); assert.ok(parciales >= 1, "the first run saved progress inside the page");
  const vistos = posiciones.filter((x): x is number => x !== null); assert.ok(vistos.length >= 1 && vistos.every((x, i) => i === 0 || x < vistos[i - 1]), `the saved position only moves down: ${posiciones.join(",")}`);
  assert.equal(s.bd.eventos.length, 100, "the 10 pending replies were finally recorded"); assert.equal(new Set(dedupes(s.bd)).size, 100); assert.equal(s.notificados.length, 10, "one internal notice per NEW reply, none for the recorded prefix");
  assert.deepEqual(s.al.estado(), { version: s.al.estado().version, uidCubierto: 100, barridoTope: null, barridoSiguiente: null, barridoDesde: null });
});

test("P2 (HIN-2a) the same with a SLOW database and a prefix far longer than any run can check: eventual processing over several runs, never past an unhandled reply, bounded work per run, with the recorded prefix never rechecked once the position passed it", async () => {
  const s = armar({ mensajes: respuestasA(100, 1) }); registrarPrevios(s, Array.from({ length: 95 }, (_, i) => 100 - i));
  let llamadasCheck = 0; const base = estadoRespuestaDe(s.bd.admin); const lento: DepsNotificacion["estadoRespuesta"] = (t, d) => { llamadasCheck++; s.reloj.t += 500; return base(t, d); };   // 500 ms per check: ≈ 12 checks per run
  const chequeadosPorRun: number[] = []; const posiciones: number[] = [];
  for (let i = 0; i < 12 && s.bd.eventos.length < 100; i++) { const antes = llamadasCheck; await cron(s.nueva({ estadoRespuesta: lento })); chequeadosPorRun.push(llamadasCheck - antes); const e = s.al.estado(); if (e.barridoSiguiente !== null) posiciones.push(e.barridoSiguiente); }
  assert.equal(s.bd.eventos.length, 100); assert.ok(chequeadosPorRun.every((n) => n <= 15), `bounded checks per run: ${chequeadosPorRun.join(",")}`); assert.ok(chequeadosPorRun.length >= 5, "it genuinely needed several runs");
  assert.ok(posiciones.every((x, i) => i === 0 || x < posiciones[i - 1]), `strictly down: ${posiciones.join(",")}`);
  const totalChecks = chequeadosPorRun.reduce((a, b) => a + b, 0); assert.ok(totalChecks <= 100 + chequeadosPorRun.length * 2, `each message is checked about once overall (${totalChecks} checks for 100 messages), not once per run`);
});

test("P3 (HIN-2a) the reserved tail of the budget is what lets a stop in the middle of a page save its progress; progress is saved with the compare-and-swap and a lost race is reported", async () => {
  const s = armar({ mensajes: respuestasA(100, 1) }); registrarPrevios(s, Array.from({ length: 100 }, (_, i) => 100 - i));
  const lento: DepsNotificacion["estadoRespuesta"] = (t, d) => { s.reloj.t += 1_000; return estadoRespuestaDe(s.bd.admin)(t, d); };      // 1 s per check; the soft end is 7 s of the 8 s budget
  const r = await cron(s.nueva({ estadoRespuesta: lento })); const b = resumen(r);
  assert.equal(b.presupuestoAgotado, true); assert.equal(b.progresoParcial, 1, "the partial save fit in the reserve"); assert.equal(b.conflicto, false);
  const e = s.al.estado(); assert.ok(e.barridoSiguiente! < 100 && e.barridoSiguiente! >= 90, `saved position ${e.barridoSiguiente}`);
  assert.ok(s.al.cas.filter((c) => c.gano).some((c) => c.nuevo?.barridoSiguiente === e.barridoSiguiente), "saved through the CAS");
  // a lost race while saving the partial progress: reported, and the winner's position stands
  const s2 = armar({ mensajes: respuestasA(100, 1) }); registrarPrevios(s2, Array.from({ length: 100 }, (_, i) => 100 - i)); let inyectado = false; const orig = s2.al.almacen.avanzar;
  const almacen: AlmacenHostinger = { ...s2.al.almacen, avanzar: async (b2, v, n) => { if (!inyectado && n.barridoSiguiente !== null && n.barridoTope !== null && n.barridoSiguiente < n.barridoTope - 1) { inyectado = true; const x = s2.al.estado(); await orig(b2, x.version, { uidCubierto: x.uidCubierto, barridoTope: x.barridoTope, barridoSiguiente: x.barridoSiguiente, barridoDesde: x.barridoDesde }); } return orig(b2, v, n); } };
  const r2 = await cron(s2.nueva({ almacen, estadoRespuesta: (t, d) => { s2.reloj.t += 1_000; return estadoRespuestaDe(s2.bd.admin)(t, d); } })); assert.equal(resumen(r2).conflicto, true);
});

test("P4 (HIN-2a) progress inside a page NEVER passes an unhandled reply: 30 UNRECORDED replies in one page with only a few downloads possible per run — every one of them is recorded exactly once over the runs, none is skipped, and the saved position stays at the first unhandled uid", async () => {
  const s = armar({ mensajes: respuestasA(30, 1) }); const posiciones: number[] = []; let parciales = 0;
  for (let i = 0; i < 12 && s.bd.eventos.length < 30; i++) {
    const r = await cron(s.nueva({ solicitudesMax: 14 })); parciales += resumen(r).progresoParcial;                // list + search + 12 downloads ≈ 6 messages per run
    const e = s.al.estado(); if (e.barridoSiguiente !== null) { posiciones.push(e.barridoSiguiente); const sinRegistrar = [...Array(30).keys()].map((k) => k + 1).filter((uid) => !dedupes(s.bd).includes(`hostinger:${BUZON}:<m${uid}@hotel.test>`)); assert.ok(sinRegistrar.every((uid) => uid <= e.barridoSiguiente!), `an unrecorded uid lies above the saved position ${e.barridoSiguiente}`); }
  }
  assert.equal(s.bd.eventos.length, 30); assert.equal(new Set(dedupes(s.bd)).size, 30); assert.ok(parciales >= 3, "progress was saved inside the page on several runs"); assert.ok(posiciones.every((x, i) => i === 0 || x < posiciones[i - 1]));
  assert.equal(s.notificados.length, 30);
});

test("X1 (HIN-2b) the auditor's probe: 201 messages dated 60 h before the first run, a first run interrupted after ONE page, the next run a DAY later — the originally eligible reply (uid 1) is recorded exactly once; the interrupted region is never labelled covered because time passed", async () => {
  const todos = Array.from({ length: 201 }, (_, i) => msg(i + 1, i === 0 ? [dir(TOKEN_A)] : [{ address: "otro@hotel.test" }], { date: hace(60) }));
  const s = armar({ mensajes: todos });
  await cron(s.nueva({ solicitudesMax: 2 }));                                              // top check + one 100-entry page, then the allowance is gone
  const e1 = s.al.estado(); assert.deepEqual([e1.uidCubierto, e1.barridoTope, e1.barridoSiguiente], [0, 201, 101]); assert.equal(s.bd.eventos.length, 0); assert.ok(e1.barridoDesde, "the threshold was saved with the sweep");
  const umbral = e1.barridoDesde;
  s.reloj.t += 24 * 3_600_000;                                                              // the next scheduled run is a day later: the message is now 84 h old
  const r = await cron(s.nueva()); const b = resumen(r);
  assert.equal(b.completo, true); assert.equal(s.bd.eventos.length, 1, "the originally eligible reply is recorded"); assert.equal(s.bd.eventos[0].dedupe, `hostinger:${BUZON}:<m1@hotel.test>`); assert.deepEqual(s.notificados, [1]);
  assert.deepEqual(s.al.estado(), { version: s.al.estado().version, uidCubierto: 201, barridoTope: null, barridoSiguiente: null, barridoDesde: null });
  const guardados = s.al.cas.filter((c) => c.gano && c.nuevo && c.nuevo.barridoTope !== null).map((c) => c.nuevo!.barridoDesde); assert.ok(guardados.length >= 2 && guardados.every((d) => d === umbral), `every save of the running sweep carried the SAVED threshold: ${guardados.join(",")}`);
  await cron(s.nueva()); assert.equal(s.bd.eventos.length, 1, "recorded exactly once");
});

test("X2 (HIN-2b) the gap can be long (4 days) and the interruption can come from a slow database, a parked failure or a conflict: the saved threshold still applies, and the reply is recorded once", async () => {
  const s = armar({ mensajes: [...respuestasA(1, 1).map((m) => ({ ...m, date: hace(70) })), ...Array.from({ length: 150 }, (_, i) => msg(i + 2, [{ address: "otro@hotel.test" }], { date: hace(70) }))] });
  await cron(s.nueva({ solicitudesMax: 2 })); assert.ok(s.al.estado().barridoSiguiente !== null && s.bd.eventos.length === 0);
  s.reloj.t += 4 * 24 * 3_600_000;                                                          // 4 days later the message is 166 h old
  const r = await cron(s.nueva()); assert.equal(resumen(r).completo, true); assert.equal(s.bd.eventos.length, 1);
});

test("X3 (HIN-2b) sender dates are NOT monotonic with uids: an old-DATED message with a high uid must not end the sweep or hide the eligible replies below it (age is a per-message skip only)", async () => {
  const s = armar({ mensajes: [msg(300, [dir(TOKEN_B)], { date: hace(500) }), ...sinTokens(250, 20), msg(10, [dir(TOKEN_A)], { date: hace(2) })] });
  const r = await cron(s.nueva()); assert.equal(resumen(r).completo, true);
  assert.deepEqual(s.bd.eventos.map((e) => e.solicitud), [1], "the eligible reply below the old-dated high-uid message is recorded; the old-dated one (older than the first-sweep limit) is skipped"); assert.equal(s.al.estado().uidCubierto, 300);
});

test("X4 (HIN-2b) only the FIRST sweep has an age limit: everything above the cursor in a later sweep is eligible however old its date or however long the system was idle (10 days)", async () => {
  const sim: Sim = { mensajes: sinTokens(100, 1) }; const s = armar(sim);
  await cron(s.nueva()); assert.equal(s.al.estado().uidCubierto, 100);
  sim.mensajes.push(msg(150, [dir(TOKEN_A)], { date: hace(500) }), msg(151, [dir(TOKEN_B)], { date: hace(1) }));          // a reply with a very old sender date, and a recent one
  s.reloj.t += 10 * 24 * 3_600_000;                                                         // nobody ran for 10 days
  const r = await cron(s.nueva()); assert.equal(resumen(r).completo, true); assert.deepEqual(s.bd.eventos.map((e) => e.solicitud).sort(), [1, 2], "both recorded: no date limit after the first sweep");
  const ultima = s.http.busquedas().at(-1)!; assert.equal(ultima.cuerpo, JSON.stringify({ uid: "101:151" }), "a later sweep sends no threshold");
});

test("X5 (HIN-2b) a uid RESET (mailbox recreated) is a new first sweep: it gets a fresh saved threshold; the check constraint refuses a threshold without a running sweep", async () => {
  const sim: Sim = { mensajes: sinTokens(200, 1000) }; const s = armar(sim);
  await cron(s.nueva()); assert.equal(s.al.estado().uidCubierto, 1199);
  sim.mensajes = [...sinTokens(150, 1), msg(7, [dir(TOKEN_A)], { date: hace(1) })].filter((m, i, a) => a.findIndex((x) => x.uid === m.uid) === i);
  await cron(s.nueva({ solicitudesMax: 2 })); const e = s.al.estado(); assert.ok(e.barridoSiguiente !== null && e.barridoDesde, "the restarted sweep saved a fresh threshold");
  await assert.rejects(() => s.al.almacen.avanzar(BUZON, e.version, { uidCubierto: 0, barridoTope: null, barridoSiguiente: null, barridoDesde: new Date().toISOString() }), /CHECK/);
});

test("X6 (HIN-4) sender date and ARRIVAL time are different clocks: a reply whose sender date is recent but that ARRIVED days ago is still recorded (the search never filters by arrival), and no search body ever carries anything but the uid range", async () => {
  const s = armar({ mensajes: [msg(1, [dir(TOKEN_A)], { date: hace(1), llegada: hace(24 * 5) }), msg(2, [dir(TOKEN_B)], { date: hace(24 * 5), llegada: hace(1) })] });
  const r = await cron(s.nueva()); assert.equal(resumen(r).completo, true);
  assert.deepEqual(s.bd.eventos.map((e) => e.solicitud), [1], "uid 1 (recent sender date, arrival 5 days ago) is recorded; uid 2 (sender date 5 days old) is skipped by the DOCUMENTED first-sweep rule, which uses the sender date only");
  for (const c of s.http.busquedas()) assert.match(c.cuerpo!, /^\{"uid":"\d+:\d+"\}$/, "only the uid range is sent");
  // the same arrival-vs-sender mismatch on a long sweep: nothing is lost to a filter the provider applies on arrival
  const largo = armar({ mensajes: [msg(1, [dir(TOKEN_A)], { date: hace(2), llegada: hace(24 * 9) }), ...sinTokens(250, 2)] }); await cron(largo.nueva());
  assert.deepEqual(largo.bd.eventos.map((e) => e.solicitud), [1]); for (const c of largo.http.busquedas()) assert.equal(JSON.parse(c.cuerpo!).since, undefined);
});

test("X7 (HIN-5) the saved eligibility threshold survives EVERY kind of cursor save of a resumed sweep — sweep start, full-page save and partial-page save — across days: a reply inside the original threshold is recorded, one outside it is never resurrected", async () => {
  const U = new Date(AHORA - VENTANA_HORAS * 3_600_000).toISOString();                    // the threshold fixed when the sweep starts
  const todos: Msg[] = sinTokens(250, 1);
  for (let uid = 51; uid <= 150; uid++) todos[uid - 1] = msg(uid, [dir(TOKEN_A)]);        // the middle page: replies already recorded (a long prefix to re-check)
  todos[19] = msg(20, [dir(TOKEN_A)], { date: hace(10) });                                 // INSIDE the original threshold, lowest page
  todos[29] = msg(30, [dir(TOKEN_B)], { date: hace(VENTANA_HORAS + 28) });                 // OUTSIDE it (100 h old when the sweep began)
  const s = armar({ mensajes: todos }); registrarPrevios(s, Array.from({ length: 100 }, (_, i) => 150 - i));
  const savesDelBarrido = () => s.al.cas.filter((c) => c.gano && c.nuevo && c.nuevo.barridoTope !== null);
  // run 1: sweep start + ONE full page (250..151) saved
  await cron(s.nueva({ solicitudesMax: 2 })); const e1 = s.al.estado();
  assert.deepEqual([e1.uidCubierto, e1.barridoTope, e1.barridoSiguiente], [0, 250, 150]); assert.equal(e1.barridoDesde, U, "start + full-page saves persisted the exact threshold");
  // run 2 (a day later, slow database): stops in the MIDDLE of the recorded page and saves partial progress
  s.reloj.t += 24 * 3_600_000;
  const r2 = await cron(s.nueva({ estadoRespuesta: (t, d) => { s.reloj.t += 1_000; return estadoRespuestaDe(s.bd.admin)(t, d); } }));
  assert.ok(resumen(r2).progresoParcial >= 1, "a partial-page save happened"); const e2 = s.al.estado(); assert.ok(e2.barridoSiguiente! < 150 && e2.barridoSiguiente! > 50);
  assert.equal(e2.barridoDesde, U, "the partial-page save persisted the exact threshold, a day after it was computed");
  // runs 3…: fast database, one more day each, until the sweep completes
  let completo = false; for (let i = 0; i < 6 && !completo; i++) { s.reloj.t += 24 * 3_600_000; completo = resumen(await cron(s.nueva())).completo && s.al.estado().barridoTope === null; }
  assert.ok(completo, "the sweep finished");
  assert.deepEqual(s.bd.eventos.map((e) => e.dedupe).filter((d) => /<m(20|30)@/.test(d)), [`hostinger:${BUZON}:<m20@hotel.test>`], "the reply inside the original threshold is recorded; the one outside it is NOT resurrected");
  const guardados = savesDelBarrido().map((c) => c.nuevo!.barridoDesde); assert.ok(guardados.length >= 4, `start, full-page and partial-page saves were observed (${guardados.length})`); assert.ok(guardados.every((d) => d === U), `EVERY save of the sweep carried the exact original threshold: ${[...new Set(guardados)].join(",")}`);
  assert.deepEqual(s.al.estado(), { version: s.al.estado().version, uidCubierto: 250, barridoTope: null, barridoSiguiente: null, barridoDesde: null }, "cleared when the sweep ends");
});
