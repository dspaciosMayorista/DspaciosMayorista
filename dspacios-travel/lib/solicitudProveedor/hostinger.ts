// #103 — Hostinger INBOUND adapter (code only; live behaviour is OFF unless SOLICITUD_PROVEEDOR_HOSTINGER=activo and every setting below is present). Free of framework code: every I/O dependency is injected.
//
// VERIFIED CONTRACT (official OpenAPI, https://developers.hostinger.com/openapi/openapi.json and https://api.mail.hostinger.com/openapi/openapi.json, read 2026-11-22):
//   · Webhook: the only event type is `message.received`; Hostinger sends an HTTPS POST with JSON and `Authorization: Bearer <secret>` (the one-time secret returned at webhook creation). NOTHING ELSE about the delivery is
//     documented: no payload schema, no event id, no mailbox/message reference, no signature header, no retry/timeout policy (the help page says only that failing webhooks are paused automatically). The payload is therefore
//     NEVER parsed for identity and never used to build a request, and NO retry by Hostinger is assumed: the notification is a TRIGGER, and recovery of unfinished work does not depend on it (see RECOVERY).
//   · Mail API (separate base URL and token from the Hostinger API): GET /api/v1/mailboxes/{mailboxResourceId}/folders/{folder}/messages (page, perPage ≤ 100, sort uid|date|size, «-» = descending) → {data:[Message],pagination};
//     POST …/messages/search?page&perPage&sort with a JSON filter body (`uid`: «IMAP UID set: single UID, range (1:100), open range (100:*), or comma-separated list») → {data:[Message]} (read-only despite the verb);
//     GET …/messages/{uid} → {data: Message}; GET …/messages/{uid}/text → {data:{text,html}}. Message = {uid, path, date, flags, unseen, size, subject, from:{name?,address}|null, to[], cc[], bcc[], messageId (RFC 5322
//     Message-ID header, with angle brackets), inReplyTo (RFC string), attachments[]}. Errors: {error, code, params}; 429 on rate limit. There is NO `references` field, NO header list, and no «send» result carrying a message id.
//   · NOT documented (assumptions, see docs/tecnico/hostinger-entrada-103.md): that mail to `respuestas+TOKEN@domain` is accepted by the mailbox (plus-addressing), that `To` keeps the tag, the webhook payload, and that the
//     search `uid` range behaves as described (it is VERIFIED at run time: every returned uid must lie inside the requested range, otherwise the pass fails loudly instead of trusting it).
//
// DESIGN. A valid notification (or the scheduled drain, same code) READS the configured mailbox's INBOX — it never sends, flags, moves or deletes — and for each message:
//   1. correlation = a Reply-To token in its recipient addresses (`tokensDeDirecciones`, same local part/domain as the configured reply address). No token → ignored. A token that matches no request → ignored WITHOUT downloading anything.
//   2. already recorded for that request (dedupe = mailbox + RFC Message-ID) → skipped without downloading anything: repeated work costs only list/search calls.
//   3. otherwise GET the message (authoritative: uid/Message-ID must match the list entry) and its text, build a «respuesta» event and hand it to the EXISTING `procesarEvento` (state machine, dedupe RPC, contract identity, notices).
// A reply NEVER confirms or rejects anything: the only event produced is «respuesta» (state «respondida»); the business decision stays a person's (`registrarDecision`).
// `espacio: "rfc822"`: the RFC Message-ID is not a Resend email id and is never compared with `solicitudes_proveedor.mensaje_id`.
//
// RECOVERY (HIN-1/HIN-2/HIN-3). Two pieces of DURABLE state (migration 330, service role only) make every bounded pass continue where the previous one stopped, so nothing depends on a new e-mail or on Hostinger retrying:
//   · a SWEEP CURSOR per mailbox: `uid_cubierto` (everything up to it is handled) and, while a sweep is running, `barrido_tope`/`barrido_siguiente`. A sweep starts when a message newer than `uid_cubierto` exists, scans DOWNWARD by uid
//     range (`uid_cubierto+1 : barrido_siguiente`, newest first, `POR_PAGINA` per call) and stops ONLY when the range is exhausted (a short page, or `uid_cubierto` reached) — never because of a date. Because it is addressed by uid, newer mail arriving or older mail being deleted
//     between runs cannot make it skip or repeat a region; there is NO page cap: depth is limited only by the per-run budget, and the NEXT run resumes from the saved position.
//   · a PENDING BACKLOG: a reply that was found but could not be downloaded/recorded is parked (uid + dedupe) before the sweep moves past it, and every run retries the oldest parked replies first. They stay until recorded or until
//     the message no longer exists — they never age out silently.
// The cursor is advanced with a compare-and-swap on a `version` counter, never past an unhandled message: after each fully handled page, AND — when the budget ends in the middle of a page — down to the first unhandled message of that page
// (every message above it is recorded, skipped or parked), so a long already-recorded prefix cannot eat every run's budget (HIN-2a). Of several concurrent runs exactly one advances and the others stop (their work is idempotent: the RPC's
// unique key stores each reply once and notifies once).
// ELIGIBILITY (HIN-2b). Only the FIRST sweep of a mailbox (cursor 0) has an age limit (`VENTANA_HORAS`, so years of old mail are not resurrected); its threshold `barrido_desde` is computed ONCE when the sweep starts and PERSISTED: every run that
// resumes that sweep, whatever day it happens, applies the same threshold, so a reply that was eligible when the sweep began cannot age out because the next run is a day later. Age is only a per-message SKIP (never a stop rule: sender dates are not
// monotonic with uids); the search carries ONLY the uid range: a server-side `since` filter is arrival-based while this skip uses the sender `date`, so filtering on one timestamp cannot implement eligibility defined on the other, and a message the filter omits is invisible to the uid-range validation (HIN-4). Every later sweep has NO age limit: everything above the cursor is unhandled and eligible.
// WHOLE-INVOCATION BUDGET (HIN-3). One shared `Presupuesto` — a deadline (`PRESUPUESTO_MS`, of which the last `RESERVA_GUARDADO_MS` is RESERVED for saving progress/parking: item work stops at the soft end, saves may use the rest) and an HTTP-attempt allowance (`SOLICITUDES_MAX`) — governs EVERYTHING: it is checked inside every retry and before every backoff wait (a wait is clipped to what is
// left or skipped), each attempt's timeout is the lesser of `TIEMPO_LLAMADA_HOSTINGER_MS` and the time left, attempts are consumed from the shared allowance (a retry cannot cross it), and every database/event/store call is raced against the deadline
// (`limitar`): when it fires the pass stops with `presupuestoAgotado` and `completo: false` (the webhook answers 202), leaving the cursor/backlog consistent for the next pass. A database call already in flight when the deadline fires cannot be cancelled;
// it either finishes (idempotent) or is bounded by its own timeout.
import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { EventoNormalizado } from "./nucleo.ts";
import { tokensDeDirecciones } from "./nucleo.ts";
import { esLoopback } from "./transporte.ts";
import type { ResultadoWebhook } from "./servicio.ts";

export const BASE_API_HOSTINGER = "https://api.mail.hostinger.com";
export const POR_PAGINA = 100, PENDIENTES_MAX = 10, SOLICITUDES_MAX = 60, PRESUPUESTO_MS = 8_000, ESPERA_REINTENTO_FINAL_MS = 1_000, RESERVA_GUARDADO_MS = 1_000;
export const VENTANA_HORAS = 72, INTENTOS_MAX = 3, TIEMPO_LLAMADA_HOSTINGER_MS = 10_000, ESPERA_TOPE_MS = 5_000, CUERPO_MAX_BYTES = 64 * 1024, MARGEN_ESPERA_MS = 250;

// ── configuration (names only; this module never logs or returns a value) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type ConfigHostinger = { secretoWebhook: string; tokenApi: string; buzonId: string; responderA: string; baseUrl: string };
export type EstadoConfigHostinger = { ok: true; config: ConfigHostinger } | { ok: false; activo: boolean; error: string };

/** OFF unless SOLICITUD_PROVEEDOR_HOSTINGER=activo. When on, every setting is required (fail closed, naming what is missing). */
export function configHostinger(env: Record<string, string | undefined> = process.env): EstadoConfigHostinger {
  if ((env.SOLICITUD_PROVEEDOR_HOSTINGER ?? "").trim().toLowerCase() !== "activo") return { ok: false, activo: false, error: "La entrada de respuestas por Hostinger no está habilitada." };
  const pedidos: [string, string][] = [["SOLICITUD_PROVEEDOR_HOSTINGER_WEBHOOK_SECRET", "secretoWebhook"], ["SOLICITUD_PROVEEDOR_HOSTINGER_TOKEN", "tokenApi"], ["SOLICITUD_PROVEEDOR_HOSTINGER_MAILBOX_ID", "buzonId"], ["SOLICITUD_PROVEEDOR_RESPONDER_A", "responderA"]];
  const faltan = pedidos.filter(([k]) => !env[k]?.trim()).map(([k]) => k);
  if (faltan.length) return { ok: false, activo: true, error: `Configuración de Hostinger incompleta (faltan: ${faltan.join(", ")}).` };
  const v = (k: string) => env[k]!.trim();
  // the mailbox id is placed in a URL path and in a database key: only the documented shape (opaque id, e.g. «AC1a2b3c4d5e6f7g») is accepted
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(v("SOLICITUD_PROVEEDOR_HOSTINGER_MAILBOX_ID"))) return { ok: false, activo: true, error: "SOLICITUD_PROVEEDOR_HOSTINGER_MAILBOX_ID no tiene el formato esperado." };
  // Local real-stack testing only: SOLICITUD_PROVEEDOR_HOSTINGER_API_URL may point the client at a simulated Mail API, and ONLY on this machine (the real API token never leaves it); anything else is refused.
  const urlLocal = env.SOLICITUD_PROVEEDOR_HOSTINGER_API_URL?.trim();
  if (urlLocal && !esLoopback(urlLocal)) return { ok: false, activo: true, error: "SOLICITUD_PROVEEDOR_HOSTINGER_API_URL solo acepta direcciones de esta máquina." };
  return { ok: true, config: { secretoWebhook: v("SOLICITUD_PROVEEDOR_HOSTINGER_WEBHOOK_SECRET"), tokenApi: v("SOLICITUD_PROVEEDOR_HOSTINGER_TOKEN"), buzonId: v("SOLICITUD_PROVEEDOR_HOSTINGER_MAILBOX_ID"), responderA: v("SOLICITUD_PROVEEDOR_RESPONDER_A"), baseUrl: urlLocal || BASE_API_HOSTINGER } };
}

/** `Authorization: Bearer <secret>` compared in constant time (digests, so lengths never leak). Missing header / other scheme / empty secret → false. */
export function bearerValido(cabecera: string | null | undefined, secreto: string | undefined): boolean {
  if (!secreto || !cabecera) return false;
  const m = /^Bearer\s+(\S+)$/i.exec(cabecera.trim());
  if (!m) return false;
  const h = (x: string) => createHash("sha256").update(x).digest();
  return timingSafeEqual(h(m[1]), h(secreto));
}

// ── shared budget ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Deadline + HTTP-attempt allowance shared by EVERYTHING one pass does (client attempts, backoff waits, database calls). */
export type Presupuesto = { restanteMs: () => number; restanteDuroMs: () => number; intentosRestantes: () => number; puede: (margenMs?: number) => boolean; consumir: () => void };
/** `restanteMs`/`puede` are the SOFT view (what is left for item work, i.e. without the reserve); `restanteDuroMs` is the HARD end, which only saving progress/parking may use. */
export function crearPresupuesto(o: { ahora?: () => number; ms?: number; intentos?: number; reservaMs?: number } = {}): Presupuesto {
  const ahora = o.ahora ?? (() => Date.now()), total = o.ms ?? PRESUPUESTO_MS, fin = ahora() + total, reserva = Math.max(0, Math.min(o.reservaMs ?? 0, Math.floor(total / 4))); let usados = 0; const tope = o.intentos ?? SOLICITUDES_MAX;
  return { restanteMs: () => fin - reserva - ahora(), restanteDuroMs: () => fin - ahora(), intentosRestantes: () => tope - usados, puede: (margen = 1) => fin - reserva - ahora() > margen && usados < tope, consumir: () => { usados++; } };
}

// ── HTTP client (read-only, bounded retries) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type ErrorHttp = { tipo: "auth" | "no_encontrado" | "cliente" | "proveedor" | "red" | "invalida" | "presupuesto"; estado?: number };
export type RespuestaHttp = { ok: true; data: unknown } | ({ ok: false } & ErrorHttp);
/** `llamadas()` counts HTTP ATTEMPTS (retries included). `opciones.presupuesto` is the pass's shared budget: no attempt starts, and no backoff wait outlives it, once it is spent. */
export type OpcionesHttp = { presupuesto?: Presupuesto; tiempoMs?: number };
export type ClienteHostinger = {
  get: (ruta: string, consulta?: Record<string, string | number>, opciones?: OpcionesHttp) => Promise<RespuestaHttp>;
  /** The documented read-only message search (POST …/messages/search). Any other POST is refused. */
  buscar: (ruta: string, cuerpo: Record<string, unknown>, consulta?: Record<string, string | number>, opciones?: OpcionesHttp) => Promise<RespuestaHttp>;
  llamadas: () => number;
};

/**
 * Injectable client. 429, 5xx, timeouts and network failures are retried up to INTENTOS_MAX attempts in total (Retry-After honoured, capped at ESPERA_TOPE_MS, otherwise 500 ms · 2ⁿ) — but ALWAYS inside the shared budget: before each attempt
 * and before each wait it checks the deadline and the attempt allowance, each attempt's timeout is the lesser of the base timeout and the time left, and a wait that would not fit is skipped (the call ends with tipo «presupuesto»).
 * 401/403 (bad API token), 404, other 4xx and a non-JSON/unexpected answer are NOT retried. Response bodies and the token are never copied into the returned error.
 */
export function crearClienteHostinger(opts: { baseUrl: string; token: string; fetch?: typeof fetch; esperar?: (ms: number) => Promise<void>; intentos?: number; tiempoMs?: number }): ClienteHostinger {
  const f = opts.fetch ?? fetch, intentos = Math.max(1, opts.intentos ?? INTENTOS_MAX), tiempoBase = opts.tiempoMs ?? TIEMPO_LLAMADA_HOSTINGER_MS;
  const esperar = opts.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let n = 0;
  async function pedir(metodo: "GET" | "POST", ruta: string, consulta: Record<string, string | number> | undefined, cuerpo: Record<string, unknown> | undefined, o?: OpcionesHttp): Promise<RespuestaHttp> {
    const p = o?.presupuesto;
    const url = `${opts.baseUrl.replace(/\/$/, "")}${ruta}${consulta ? `?${new URLSearchParams(Object.entries(consulta).map(([k, v]) => [k, String(v)])).toString()}` : ""}`;
    let ultimo: ErrorHttp = { tipo: "red" };
    for (let i = 0; i < intentos; i++) {
      if (p && !p.puede()) return { ok: false, tipo: "presupuesto" };
      p?.consumir(); n++;
      const tiempo = Math.max(1, Math.min(tiempoBase, o?.tiempoMs ?? tiempoBase, p ? p.restanteMs() : Number.POSITIVE_INFINITY));
      let esperaMs = Math.min(500 * 2 ** i, ESPERA_TOPE_MS);
      try {
        const r = await f(url, { method: metodo, headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json", ...(cuerpo ? { "Content-Type": "application/json" } : {}) }, ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}), signal: AbortSignal.timeout(tiempo) });
        if (r.ok) {
          const j = (await r.json().catch(() => undefined)) as { data?: unknown } | undefined;
          if (!j || typeof j !== "object" || !("data" in j)) return { ok: false, tipo: "invalida", estado: r.status };
          return { ok: true, data: j.data };
        }
        if (r.status === 401 || r.status === 403) return { ok: false, tipo: "auth", estado: r.status };
        if (r.status === 404) return { ok: false, tipo: "no_encontrado", estado: 404 };
        if (r.status !== 429 && r.status < 500) return { ok: false, tipo: "cliente", estado: r.status };
        ultimo = { tipo: "proveedor", estado: r.status };
        const ra = Number(r.headers.get("retry-after")); if (r.status === 429 && Number.isFinite(ra) && ra >= 0) esperaMs = Math.min(ra * 1000, ESPERA_TOPE_MS);
      } catch { ultimo = { tipo: "red" }; }
      if (i < intentos - 1) {
        if (p) {
          const cabe = p.restanteMs() - MARGEN_ESPERA_MS;                                  // the wait must leave time for the next attempt
          if (cabe <= 0 || p.intentosRestantes() <= 0) return { ok: false, tipo: "presupuesto" };
          esperaMs = Math.min(esperaMs, cabe);
        }
        await esperar(esperaMs);
      }
    }
    return { ok: false, ...ultimo };
  }
  return {
    llamadas: () => n,
    get: (ruta, consulta, o) => pedir("GET", ruta, consulta, undefined, o),
    buscar: (ruta, cuerpo, consulta, o) => {
      if (!/\/messages\/search$/.test(ruta)) throw new Error("buscar: solo la búsqueda de mensajes (solo lectura) está permitida.");
      return pedir("POST", ruta, consulta, cuerpo, o);
    },
  };
}

// ── durable state (migration 330) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** `barridoDesde` = ISO threshold fixed when the running sweep started (null = no age limit); it exists only while a sweep is running. */
export type EstadoBuzon = { version: number; uidCubierto: number; barridoTope: number | null; barridoSiguiente: number | null; barridoDesde: string | null };
export type NuevoEstado = { uidCubierto: number; barridoTope: number | null; barridoSiguiente: number | null; barridoDesde: string | null };
export type PendienteGuardado = { uid: number; dedupe: string; messageId: string | null; intentos: number };
/** Durable cursor + backlog. `avanzar` is a compare-and-swap on `version`: true for the ONE caller whose `esperada` is still current. Every method throws on a database error (nothing is advanced on a guess). */
export type AlmacenHostinger = {
  leerEstado: (buzonId: string) => Promise<EstadoBuzon>;
  avanzar: (buzonId: string, versionEsperada: number, nuevo: NuevoEstado) => Promise<boolean>;
  listarPendientes: (buzonId: string, limite: number) => Promise<PendienteGuardado[]>;
  guardarPendiente: (buzonId: string, p: { uid: number; dedupe: string; messageId: string | null; intentos: number; error: string }) => Promise<void>;
  borrarPendiente: (buzonId: string, uid: number) => Promise<void>;
};

type SbMinimo = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>; from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
/** The store over the database (service client; migration 330). */
export function almacenHostingerDe(admin: SupabaseClient<Database>): AlmacenHostinger {
  const sb = admin as unknown as SbMinimo;
  const err = (donde: string, e: { message: string } | null) => { if (e) throw new Error(`${donde}: ${e.message}`); };
  return {
    async leerEstado(buzonId) {
      const { data, error } = await sb.rpc("hostinger_estado_leer", { p_buzon: buzonId }); err("hostinger_estado_leer", error);
      const f = (Array.isArray(data) ? data[0] : data) as { version: number; uid_cubierto: number | string; barrido_tope: number | string | null; barrido_siguiente: number | string | null; barrido_desde: string | null } | undefined;
      if (!f) throw new Error("hostinger_estado_leer: sin fila");
      return { version: Number(f.version), uidCubierto: Number(f.uid_cubierto), barridoTope: f.barrido_tope == null ? null : Number(f.barrido_tope), barridoSiguiente: f.barrido_siguiente == null ? null : Number(f.barrido_siguiente), barridoDesde: f.barrido_desde ?? null };
    },
    async avanzar(buzonId, v, n) {
      const { data, error } = await sb.rpc("hostinger_estado_avanzar", { p_buzon: buzonId, p_version: v, p_cubierto: n.uidCubierto, p_tope: n.barridoTope, p_siguiente: n.barridoSiguiente, p_desde: n.barridoDesde }); err("hostinger_estado_avanzar", error);
      return data === true;
    },
    async listarPendientes(buzonId, limite) {
      const { data, error } = await sb.from("hostinger_respuestas_pendientes").select("uid, dedupe, message_id, intentos").eq("buzon_id", buzonId).order("creado_en", { ascending: true }).limit(limite); err("hostinger_respuestas_pendientes", error);
      return ((data ?? []) as { uid: number | string; dedupe: string; message_id: string | null; intentos: number }[]).map((x) => ({ uid: Number(x.uid), dedupe: x.dedupe, messageId: x.message_id, intentos: x.intentos }));
    },
    async guardarPendiente(buzonId, p) {
      const { error } = await sb.from("hostinger_respuestas_pendientes").upsert({ buzon_id: buzonId, uid: p.uid, dedupe: p.dedupe, message_id: p.messageId, intentos: p.intentos, ultimo_error: p.error.slice(0, 300), actualizado_en: new Date().toISOString() }, { onConflict: "buzon_id,uid" }); err("hostinger_respuestas_pendientes", error);
    },
    async borrarPendiente(buzonId, uid) {
      const { error } = await sb.from("hostinger_respuestas_pendientes").delete().eq("buzon_id", buzonId).eq("uid", uid); err("hostinger_respuestas_pendientes", error);
    },
  };
}

// ── reading the mailbox ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
type Direccion = { name?: string; address?: string };
export type MensajeHostinger = { uid: number; date: string | null; subject: string | null; from: Direccion | null; to: Direccion[]; cc: Direccion[]; messageId: string | null; inReplyTo: string | null };
const dir = (v: unknown): Direccion[] => (Array.isArray(v) ? v.filter((x): x is Direccion => !!x && typeof x === "object" && typeof (x as Direccion).address === "string") : []);
/** Defensive parse of the documented Message shape; anything that is not a message with a numeric uid is dropped. */
export function leerMensaje(x: unknown): MensajeHostinger | null {
  if (!x || typeof x !== "object") return null;
  const m = x as Record<string, unknown>;
  if (typeof m.uid !== "number" || !Number.isInteger(m.uid) || m.uid <= 0) return null;
  const from = m.from && typeof m.from === "object" && typeof (m.from as Direccion).address === "string" ? (m.from as Direccion) : null;
  return { uid: m.uid, date: typeof m.date === "string" ? m.date : null, subject: typeof m.subject === "string" ? m.subject : null, from, to: dir(m.to), cc: dir(m.cc), messageId: typeof m.messageId === "string" && m.messageId.trim() ? m.messageId.trim() : null, inReplyTo: typeof m.inReplyTo === "string" ? m.inReplyTo : null };
}

const rutaBuzon = (c: ConfigHostinger) => `/api/v1/mailboxes/${encodeURIComponent(c.buzonId)}/folders/INBOX/messages`;
/** Stable key of one received message: mailbox + RFC Message-ID (or uid + date when the header is absent). The SAME message gives the SAME key however many passes see it. */
export function dedupeDeMensaje(buzonId: string, m: Pick<MensajeHostinger, "uid" | "date" | "messageId">): string {
  const id = m.messageId ?? `uid:${m.uid}:${m.date ?? ""}`;
  return `hostinger:${buzonId}:${id.length <= 150 ? id : createHash("sha256").update(id).digest("hex").slice(0, 40)}`;
}

/**
 * `completo` is true ONLY when the sweep reached the newest message with nothing newer than the cursor, no parked reply remains, nothing was left for lack of budget and no run conflict or inconsistency happened. Everything else is counted so a
 * caller can see WHY the pass is not complete. `barridoEnCurso` = a sweep is saved mid-way (the next pass resumes it); `pendientesRestantes` = parked replies still waiting; `conflicto` = another run advanced the cursor first.
 */
export type ResumenNotificacion = {
  paginas: number; revisados: number; sinToken: number; tokenDesconocido: number; yaRegistrados: number; procesados: number; nuevos: number; ignorados: number;
  pendientesGuardados: number; pendientesRecuperados: number; pendientesRestantes: number; desaparecidos: number; inconsistentes: number; progresoParcial: number;
  barridoEnCurso: boolean; conflicto: boolean; presupuestoAgotado: boolean; completo: boolean;
};
export type ResultadoNotificacion = { ok: true; resumen: ResumenNotificacion } | { ok: false; tipo: Exclude<ErrorHttp["tipo"], "presupuesto">; estado?: number };
export type DepsNotificacion = {
  cliente: ClienteHostinger; config: ConfigHostinger; almacen: AlmacenHostinger;
  /** Checked BEFORE downloading anything: «desconocido» = no request carries this Reply-To token; «registrado» = this reply is already stored for that request (repeated work costs only list/search calls); «pendiente» = download it. The RPC stays the dedupe authority. */
  estadoRespuesta: (token: string, dedupe: string) => Promise<"desconocido" | "registrado" | "pendiente">;
  /** The existing event processor (state machine, dedupe RPC, contract identity, notices). */
  procesar: (ev: EventoNormalizado) => Promise<ResultadoWebhook>;
  ahoraMs?: () => number;
  /** Wait before the final retry of the replies parked in this pass (injectable so tests do not sleep). */
  esperar?: (ms: number) => Promise<void>;
  /** Overrides of the whole-invocation budget (tests only). */
  presupuestoMs?: number; solicitudesMax?: number;
};

const texto = (v: unknown): string => (typeof v === "string" ? v : "");
const corto = (v: string | null | undefined, max: number): string | undefined => (v && v.trim() ? v.trim().slice(0, max) : undefined);
type Candidato = { uid: number; dedupe: string; messageId: string | null; tokens: string[] | null; intentos: number };
const SIN_TIEMPO = Symbol("sin-tiempo");

/** One BOUNDED pass (see RECOVERY in the header). A failing FIRST call, a rejected API token or a search that does not honour its uid range is an error; everything else yields a summary whose `completo` says whether it is finished. */
export async function drenarBuzonHostinger(d: DepsNotificacion): Promise<ResultadoNotificacion> {
  const { cliente, config, almacen } = d;
  const ahora = () => d.ahoraMs?.() ?? Date.now();
  const esperar = d.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pres = crearPresupuesto({ ahora, ms: d.presupuestoMs, intentos: d.solicitudesMax, reservaMs: RESERVA_GUARDADO_MS });
  const opc: OpcionesHttp = { presupuesto: pres };
  const r: ResumenNotificacion = { paginas: 0, revisados: 0, sinToken: 0, tokenDesconocido: 0, yaRegistrados: 0, procesados: 0, nuevos: 0, ignorados: 0, pendientesGuardados: 0, pendientesRecuperados: 0, pendientesRestantes: 0, desaparecidos: 0, inconsistentes: 0, progresoParcial: 0, barridoEnCurso: false, conflicto: false, presupuestoAgotado: false, completo: false };

  /** Every database/event/store call is raced against the shared deadline: a slow one stops the pass instead of making it unbounded (its eventual completion is idempotent). */
  async function limitar<T>(fn: () => Promise<T>): Promise<T | typeof SIN_TIEMPO> {
    return carrera(fn, pres.restanteMs());                                                  // item work: until the SOFT end (database/store work is gated by TIME only: an exhausted HTTP-attempt allowance must still let a failed reply be parked)
  }
  /** Saving progress / parking may use the reserved tail of the budget (the HARD end): that is what lets a budget stop in the middle of a page still persist what was handled. */
  async function limitarDuro<T>(fn: () => Promise<T>): Promise<T | typeof SIN_TIEMPO> { return carrera(fn, pres.restanteDuroMs()); }
  async function carrera<T>(fn: () => Promise<T>, restante: number): Promise<T | typeof SIN_TIEMPO> {
    if (restante <= 0) return SIN_TIEMPO;
    const p = fn(); p.catch(() => {});                                                       // a late rejection after the race is lost must not become an unhandled rejection
    let t: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<typeof SIN_TIEMPO>((res) => { t = setTimeout(() => res(SIN_TIEMPO), Math.max(1, restante)); });
    try { return await Promise.race([p, limite]); } finally { if (t) clearTimeout(t); }
  }
  type Salida = "listo" | "fallo" | "auth" | "tiempo";
  const parar = () => { r.presupuestoAgotado = true; };

  /** Downloads and records ONE message. «fallo» = transient (parked by the caller); «auth» = API token rejected; «tiempo» = budget ended (nothing recorded unless the RPC already finished). */
  async function descargarYRegistrar(c: Candidato): Promise<Salida> {
    const ruta = `${rutaBuzon(config)}/${c.uid}`;
    const det = await cliente.get(ruta, undefined, opc);
    if (!det.ok) { if (det.tipo === "auth") return "auth"; if (det.tipo === "presupuesto") return "tiempo"; if (det.tipo === "no_encontrado") { r.desaparecidos++; return "listo"; } return "fallo"; }
    const completo = leerMensaje(det.data);
    if (!completo || completo.uid !== c.uid || (c.messageId !== null && completo.messageId !== c.messageId)) { r.inconsistentes++; return "listo"; }   // the mailbox changed under us: nothing to record for that uid
    let tokens = c.tokens;
    if (!tokens) {                                                                           // a parked reply: correlate again from the authoritative message
      const candidatos = tokensDeDirecciones([...completo.to, ...completo.cc].map((x) => x.address!), config.responderA);
      tokens = [];
      for (const t of candidatos) {
        const e = await limitar(() => d.estadoRespuesta(t, c.dedupe)); if (e === SIN_TIEMPO) return "tiempo";
        if (e === "pendiente") tokens.push(t); else if (e === "registrado") r.yaRegistrados++; else r.tokenDesconocido++;
      }
      if (!tokens.length) return "listo";
    }
    const cuerpo = await cliente.get(`${ruta}/text`, undefined, opc);
    if (!cuerpo.ok && cuerpo.tipo === "auth") return "auth";
    if (!cuerpo.ok && cuerpo.tipo === "presupuesto") return "tiempo";
    if (!cuerpo.ok && cuerpo.tipo !== "no_encontrado") return "fallo";                      // transient failure: nothing is recorded, the reply is parked and retried by later passes
    const t = cuerpo.ok && cuerpo.data && typeof cuerpo.data === "object" ? texto((cuerpo.data as { text?: unknown }).text) : "";
    for (const token of tokens) {
      const ev: EventoNormalizado = {
        tipo: "respuesta", dedupe: c.dedupe, externoId: corto(completo.messageId ?? undefined, 300) ?? null, token, enRespuestaA: null, espacio: "rfc822",
        resumen: { de: corto(completo.from?.address, 200), asunto: corto(completo.subject, 300), texto: corto(t, 2000) },
      };
      const res = await limitar(() => d.procesar(ev)); if (res === SIN_TIEMPO) return "tiempo";
      r.procesados++;
      if (res.ignorado) r.ignorados++; else if (res.nuevo) r.nuevos++;
    }
    return "listo";
  }

  /** Retries ONE parked reply: recorded or gone → removed from the backlog; still failing → kept with one more attempt. */
  async function reintentarPendiente(c: Candidato): Promise<Salida> {
    const s = await descargarYRegistrar(c);
    if (s === "listo") { const b = await limitarDuro(() => almacen.borrarPendiente(config.buzonId, c.uid)); if (b === SIN_TIEMPO) return "tiempo"; r.pendientesRecuperados++; return "listo"; }
    if (s === "fallo") { const g = await limitarDuro(() => almacen.guardarPendiente(config.buzonId, { uid: c.uid, dedupe: c.dedupe, messageId: c.messageId, intentos: c.intentos + 1, error: "descarga fallida" })); if (g === SIN_TIEMPO) return "tiempo"; }
    return s;
  }

  // ── 0. durable state ──
  const e0 = await limitar(() => almacen.leerEstado(config.buzonId)); if (e0 === SIN_TIEMPO) { parar(); return { ok: true, resumen: r }; }
  let estado: EstadoBuzon = e0;

  // ── 1. parked replies first (oldest first): they were found by an earlier pass and must not wait behind new mail ──
  const lp = await limitar(() => almacen.listarPendientes(config.buzonId, PENDIENTES_MAX + 1)); if (lp === SIN_TIEMPO) { parar(); return { ok: true, resumen: r }; }
  const hayMasPendientes = lp.length > PENDIENTES_MAX; let restantes = 0;
  for (const p of lp.slice(0, PENDIENTES_MAX)) {
    if (r.presupuestoAgotado) { restantes++; continue; }
    const s = await reintentarPendiente({ uid: p.uid, dedupe: p.dedupe, messageId: p.messageId, tokens: null, intentos: p.intentos });
    if (s === "auth") return { ok: false, tipo: "auth" };
    if (s === "tiempo") { parar(); restantes++; } else if (s === "fallo") restantes++;
  }
  if (hayMasPendientes) restantes += lp.length - PENDIENTES_MAX;                           // at least one more is waiting its turn
  const restantesIniciales = restantes;

  // ── 2. the sweep, resumed from the saved position ──
  let barridoTerminado = false;
  const parkedAhora: Candidato[] = []; let recuperadosAhora = 0;
  barrido: while (!r.presupuestoAgotado) {
    if (!pres.puede()) { parar(); break; }
    if (estado.barridoSiguiente === null) {
      // idle: is there anything NEWER than the cursor? (one cheap call: the newest message)
      const cima = await cliente.get(rutaBuzon(config), { page: 1, perPage: 1, sort: "-uid" }, opc);
      if (!cima.ok) {
        if (cima.tipo === "presupuesto") { parar(); break; }
        if (r.paginas === 0 && r.revisados === 0 && r.procesados === 0 && r.pendientesRecuperados === 0) return { ok: false, tipo: cima.tipo };
        break;
      }
      r.paginas++;
      const brutosCima = Array.isArray(cima.data) ? cima.data : [];
      const nueva = brutosCima.map(leerMensaje).filter((x): x is MensajeHostinger => !!x)[0];
      if (!nueva && brutosCima.length) return { ok: false, tipo: "invalida" };               // the newest entry is unreadable: never conclude «empty mailbox» from garbage
      if (!nueva) { barridoTerminado = true; break; }                                         // genuinely empty mailbox
      let cubierto = estado.uidCubierto;
      if (nueva.uid < cubierto) {                                                             // uids went BACKWARDS (mailbox reset/recreated): start over, safely (recorded replies are skipped)
        const w = await limitarDuro(() => almacen.avanzar(config.buzonId, estado.version, { uidCubierto: 0, barridoTope: null, barridoSiguiente: null, barridoDesde: null })); if (w === SIN_TIEMPO) { parar(); break; }
        if (!w) { r.conflicto = true; break; }
        estado = { version: estado.version + 1, uidCubierto: 0, barridoTope: null, barridoSiguiente: null, barridoDesde: null }; cubierto = 0;
      }
      if (nueva.uid <= cubierto) { barridoTerminado = true; break; }                          // nothing new since the last complete sweep
      // the age threshold of a sweep is decided ONCE, here, and saved with it: only the first sweep of a mailbox (cursor 0) has one
      const umbralInicial = cubierto === 0 ? new Date(ahora() - VENTANA_HORAS * 3_600_000).toISOString() : null;
      const inicio: NuevoEstado = { uidCubierto: cubierto, barridoTope: nueva.uid, barridoSiguiente: nueva.uid, barridoDesde: umbralInicial };
      const w = await limitarDuro(() => almacen.avanzar(config.buzonId, estado.version, inicio)); if (w === SIN_TIEMPO) { parar(); break; }
      if (!w) { r.conflicto = true; break; }
      estado = { version: estado.version + 1, ...inicio };
    }
    // one page of the saved range: uids (cubierto, siguiente], newest first
    const tope = estado.barridoSiguiente!, base = estado.uidCubierto;
    const pagina = tope > base ? await cliente.buscar(`${rutaBuzon(config)}/search`, { uid: `${base + 1}:${tope}` }, { page: 1, perPage: POR_PAGINA, sort: "-uid" }, opc) : { ok: true as const, data: [] };
    if (!pagina.ok) {
      if (pagina.tipo === "presupuesto") { parar(); break; }
      if (pagina.tipo === "auth") return { ok: false, tipo: "auth" };
      if (r.paginas <= 1 && r.procesados === 0) return { ok: false, tipo: pagina.tipo };
      break;                                                                                  // keep what was read; the saved cursor resumes here next time
    }
    r.paginas++;
    const brutos = Array.isArray(pagina.data) ? pagina.data : [];
    const items = brutos.map(leerMensaje).filter((x): x is MensajeHostinger => !!x);
    if (items.some((m) => m.uid > tope || m.uid <= base)) return { ok: false, tipo: "invalida" };   // the search did not honour its uid range: refuse to trust it (never advance the cursor on it)
    const umbral = estado.barridoDesde ? Date.parse(estado.barridoDesde) : null;
    let completaLaPagina = true, sinManejar: MensajeHostinger[] = [];
    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      if (umbral !== null && m.date && Date.parse(m.date) < umbral) continue;                // first-sweep age limit: a per-message SKIP, never a reason to stop scanning lower uids
      r.revisados++;
      const tokens = tokensDeDirecciones([...m.to, ...m.cc].map((x) => x.address!), config.responderA);
      if (!tokens.length) { r.sinToken++; continue; }
      const dedupe = dedupeDeMensaje(config.buzonId, m);
      const pendientes: string[] = []; let sinTiempo = false;
      for (const t of tokens) {
        const e = await limitar(() => d.estadoRespuesta(t, dedupe)); if (e === SIN_TIEMPO) { sinTiempo = true; break; }
        if (e === "pendiente") pendientes.push(t); else if (e === "registrado") r.yaRegistrados++; else r.tokenDesconocido++;
      }
      if (sinTiempo) { completaLaPagina = false; sinManejar = items.slice(i); break; }
      if (!pendientes.length) continue;
      const c: Candidato = { uid: m.uid, dedupe, messageId: m.messageId, tokens: pendientes, intentos: 1 };
      const s = await descargarYRegistrar(c);
      if (s === "auth") return { ok: false, tipo: "auth" };
      if (s === "tiempo") { completaLaPagina = false; sinManejar = items.slice(i); break; }
      if (s === "fallo") {                                                                    // park it BEFORE the cursor moves past it; if parking fails the page is not complete
        const g = await limitarDuro(() => almacen.guardarPendiente(config.buzonId, { uid: c.uid, dedupe, messageId: m.messageId, intentos: 1, error: "descarga fallida" }));
        if (g === SIN_TIEMPO) { completaLaPagina = false; sinManejar = items.slice(i); break; }
        r.pendientesGuardados++; parkedAhora.push(c);
      }
    }
    if (!completaLaPagina) {
      // budget ended MID-PAGE: persist the safe progress — everything ABOVE the highest unhandled uid is recorded, skipped or parked — so the next run does not re-check that prefix (HIN-2a). Never past an unhandled reply.
      const techo = Math.max(...sinManejar.map((m) => m.uid));
      if (techo < tope) {
        const parcial: NuevoEstado = { uidCubierto: base, barridoTope: estado.barridoTope, barridoSiguiente: techo, barridoDesde: estado.barridoDesde };
        const wp = await limitarDuro(() => almacen.avanzar(config.buzonId, estado.version, parcial));
        if (wp === true) { estado = { version: estado.version + 1, ...parcial }; r.progresoParcial++; } else if (wp === false) r.conflicto = true;
      }
      parar(); break;
    }
    const minUid = items.length ? Math.min(...items.map((m) => m.uid)) : base;
    const fin = brutos.length < POR_PAGINA || minUid - 1 <= base;                              // the sweep ends ONLY when its uid range is exhausted
    const nuevo: NuevoEstado = fin ? { uidCubierto: estado.barridoTope!, barridoTope: null, barridoSiguiente: null, barridoDesde: null } : { uidCubierto: base, barridoTope: estado.barridoTope, barridoSiguiente: minUid - 1, barridoDesde: estado.barridoDesde };
    const w = await limitarDuro(() => almacen.avanzar(config.buzonId, estado.version, nuevo)); if (w === SIN_TIEMPO) { parar(); break; }
    if (!w) { r.conflicto = true; break barrido; }                                            // another run advanced first: stop (its position is the truth; our work was idempotent)
    estado = { version: estado.version + 1, ...nuevo };
    // a finished sweep loops back to the idle check (more mail may have arrived meanwhile; still bounded by the shared budget)
  }
  r.barridoEnCurso = estado.barridoSiguiente !== null;

  // ── 3. one last retry (after a short wait) of the replies parked in THIS pass, if the budget allows: a brief provider blip is recovered without waiting for the next pass ──
  if (parkedAhora.length && pres.restanteMs() > ESPERA_REINTENTO_FINAL_MS + 2 * MARGEN_ESPERA_MS && pres.puede(MARGEN_ESPERA_MS)) {
    await esperar(Math.min(ESPERA_REINTENTO_FINAL_MS, pres.restanteMs() - MARGEN_ESPERA_MS));
    for (const c of parkedAhora) {
      if (!pres.puede()) { parar(); break; }
      const s = await reintentarPendiente({ ...c, tokens: null });                           // re-correlates from the authoritative message
      if (s === "auth") return { ok: false, tipo: "auth" };
      if (s === "listo") recuperadosAhora++;
      if (s === "tiempo") { parar(); break; }
    }
  }
  r.pendientesRestantes = restantesIniciales + parkedAhora.length - recuperadosAhora;
  r.completo = barridoTerminado && !r.barridoEnCurso && r.pendientesRestantes === 0 && !r.presupuestoAgotado && !r.conflicto && r.inconsistentes === 0;
  return { ok: true, resumen: r };
}
/** Former name, kept for callers/tests written before the durable drain. */
export const procesarNotificacionHostinger = drenarBuzonHostinger;

/** `estadoRespuesta` over the database (service client; reads only). A read error THROWS: nothing is downloaded or recorded on a guess. */
export function estadoRespuestaDe(admin: SupabaseClient<Database>): DepsNotificacion["estadoRespuesta"] {
  return async (token, dedupe) => {
    const { data: sol, error } = await admin.from("solicitudes_proveedor").select("id").eq("token_respuesta", token).maybeSingle();
    if (error) throw new Error(`solicitudes_proveedor: ${error.message}`);
    if (!sol) return "desconocido";
    const { data: ev, error: e2 } = await admin.from("solicitud_proveedor_eventos").select("id").eq("solicitud_id", sol.id).eq("tipo", "respuesta").eq("dedupe", dedupe).limit(1);
    if (e2) throw new Error(`solicitud_proveedor_eventos: ${e2.message}`);
    return (ev ?? []).length ? "registrado" : "pendiente";
  };
}

// ── the HTTP handlers (framework-free: the routes only build the dependencies) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type RespuestaHandler = { status: number; body: Record<string, unknown> };
export type DepsHandler = { config: EstadoConfigHostinger; authorization: string | null; cuerpoCrudo: string; construir: (c: ConfigHostinger) => DepsNotificacion };

const cuerpoDe = (res: ResumenNotificacion): Record<string, unknown> => ({ ok: true, ...res, pendiente: !res.completo });
function respuestaDeFallo(res: { tipo: ErrorHttp["tipo"] }): RespuestaHandler {
  // a bad API token is a configuration problem (not retryable); a provider/network failure is reported and picked up by the next pass
  if (res.tipo === "auth") return { status: 503, body: { error: "El acceso al buzón fue rechazado; revisa la configuración." } };
  if (res.tipo === "invalida") return { status: 502, body: { error: "El buzón respondió de forma inesperada; no se avanzó." } };
  return { status: 502, body: { error: "No se pudo leer el buzón." } };
}

/**
 * 503 = disabled / incomplete (nothing touched) · 401 = bad bearer (nothing touched) · 413 = body too large · 200 = the pass is COMPLETE · 202 = the pass is NOT complete (`completo:false`, `pendiente:true`): the work that is left is not
 * abandoned, it is finished by the next pass (later notification or the scheduled drain) from the DURABLE cursor/backlog — never reported as 200 · 502/503 = the mailbox could not be read (nothing advanced). Bodies carry counts only, never message data.
 */
export async function manejarNotificacionHostinger(h: DepsHandler): Promise<RespuestaHandler> {
  if (!h.config.ok) return { status: 503, body: { error: "Entrada de Hostinger no configurada." } };
  if (!bearerValido(h.authorization, h.config.config.secretoWebhook)) return { status: 401, body: { error: "Autenticación no válida." } };
  if (Buffer.byteLength(h.cuerpoCrudo) > CUERPO_MAX_BYTES) return { status: 413, body: { error: "Cuerpo demasiado grande." } };
  const res = await drenarBuzonHostinger(h.construir(h.config.config));
  return res.ok ? { status: res.resumen.completo ? 200 : 202, body: cuerpoDe(res.resumen) } : respuestaDeFallo(res);
}

export type DepsCron = { config: EstadoConfigHostinger; authorization: string | null; secretoCron: string | undefined; construir: (c: ConfigHostinger) => DepsNotificacion };
/**
 * Scheduled drain (the reliable recovery driver; no Hostinger delivery is involved): `Authorization: Bearer <CRON_SECRET>` like the other cron routes (no secret configured → 503, nothing touched). With the Hostinger entry OFF it
 * answers 200 «desactivado» without touching anything (a no-op cron must not show up as failing); with incomplete configuration → 503.
 */
export async function manejarCronHostinger(h: DepsCron): Promise<RespuestaHandler> {
  if (!h.secretoCron) return { status: 503, body: { error: "CRON_SECRET no configurado" } };
  if (!bearerValido(h.authorization, h.secretoCron)) return { status: 401, body: { error: "unauthorized" } };
  if (!h.config.ok) return h.config.activo ? { status: 503, body: { error: "Entrada de Hostinger no configurada." } } : { status: 200, body: { ok: true, desactivado: true } };
  const res = await drenarBuzonHostinger(h.construir(h.config.config));
  return res.ok ? { status: 200, body: cuerpoDe(res.resumen) } : respuestaDeFallo(res);
}
