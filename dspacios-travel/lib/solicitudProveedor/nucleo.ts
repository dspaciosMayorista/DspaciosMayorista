// #103 — supplier service requests by email: PURE core (no I/O). Correlation token, idempotency key, recipient validation, reply-address tagging, neutral webhook event
// normalisation and signature verification. The provider is NOT decided yet (Hostinger webhook / Resend / forwarder): everything provider-specific lives behind the neutral event shape below.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type EstadoSolicitud = "enviando" | "incierta" | "enviada" | "entregada" | "respondida" | "confirmada" | "rechazada" | "fallida";

/** Same ranks as the SQL function `solicitud_proveedor_rango` (state only moves forward). */
export const RANGO: Record<EstadoSolicitud, number> = { enviando: 1, incierta: 1, fallida: 1, enviada: 2, entregada: 3, respondida: 4, confirmada: 5, rechazada: 5 };

export const ETIQUETA_ESTADO: Record<EstadoSolicitud, string> = {
  enviando: "Enviando", incierta: "Resultado del envío desconocido", enviada: "Enviada", entregada: "Entregada", respondida: "Respondió", confirmada: "Confirmada por el proveedor", rechazada: "Rechazada por el proveedor", fallida: "Falló el envío",
};

/** Unguessable, URL/e-mail safe correlation token (24 random bytes → 32 chars). Carried in the Reply-To address; knowing a contract number never reveals it. */
export const generarToken = (): string => randomBytes(24).toString("base64url");

const CORREO = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** Splits a free text of recipients (comma, semicolon, space or newline), validates each one, de-duplicates, lowercases. 1–5 addresses; header injection impossible (no CR/LF survives validation). */
export function validarDestinatarios(texto: string): { ok: true; destinatarios: string[] } | { ok: false; error: string } {
  const partes = (texto ?? "").split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
  if (!partes.length) return { ok: false, error: "Indica al menos un correo del proveedor." };
  const out: string[] = [];
  for (const p of partes) {
    if (!CORREO.test(p) || p.length > 254) return { ok: false, error: `El correo «${p.slice(0, 60)}» no es válido.` };
    const m = p.toLowerCase();
    if (!out.includes(m)) out.push(m);
  }
  if (out.length > 5) return { ok: false, error: "Máximo 5 correos por solicitud." };
  return { ok: true, destinatarios: out };
}

/** JSON with object keys sorted at every level: the same content gives the same text whatever order the keys arrive in (PostgreSQL jsonb reorders them). */
export function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonico((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/** Idempotency key of ONE send: same voucher + same recipients + same document content + same version → same key → never sent twice. `version` > 1 is an explicit resend. */
export function claveEnvio(args: { voucherId: number | null; numero: string; destinatarios: readonly string[]; contenido: unknown; version: number }): string {
  const destinos = [...args.destinatarios].map((d) => d.toLowerCase()).sort().join(",");
  const huella = createHash("sha256").update(canonico([args.numero, args.voucherId, destinos, args.contenido])).digest("hex").slice(0, 40);
  return `${huella}:v${Math.max(1, Math.floor(args.version) || 1)}`;
}

/** `respuestas@dominio` + token → `respuestas+TOKEN@dominio` (plus-addressing: the reply keeps working in the same mailbox and carries the key). */
export function direccionRespuesta(base: string, token: string): string {
  const [local, dominio] = base.split("@");
  if (!local || !dominio) throw new Error("Dirección de respuesta no válida.");
  return `${local.split("+")[0]}+${token}@${dominio}`;
}

/** Finds a correlation token inside a list of recipient addresses (`respuestas+TOKEN@dominio`). */
export function tokenDeDirecciones(direcciones: readonly string[] | null | undefined): string | null {
  for (const d of direcciones ?? []) {
    const m = /^[^@+\s]+\+([A-Za-z0-9_-]{16,64})@[^@\s]+$/.exec((d ?? "").trim().replace(/^.*<([^>]+)>$/, "$1"));
    if (m) return m[1];
  }
  return null;
}

/**
 * Reply-To tokens carried by the RECIPIENT addresses of a received message, accepted ONLY when the address is the configured reply address plus a tag (`local+TOKEN@domain`, same local part and domain as `responderA`,
 * case-insensitive). Display names / angle brackets are tolerated; the same token is returned once; at most `max` tokens. Plus-addressing delivery itself is NOT verified with Hostinger: this only reads what the message says.
 */
export function tokensDeDirecciones(direcciones: readonly string[] | null | undefined, responderA: string, max = 3): string[] {
  const [base, dominio] = responderA.toLowerCase().split("@");
  if (!base || !dominio) return [];
  const out: string[] = [];
  for (const d of direcciones ?? []) {
    const m = /^([^@+\s]+)\+([A-Za-z0-9_-]{16,64})@([^@\s]+)$/.exec((d ?? "").trim().replace(/^.*<([^>]+)>$/, "$1"));
    if (!m || m[1].toLowerCase() !== base || m[3].toLowerCase() !== dominio) continue;
    if (!out.includes(m[2])) out.push(m[2]);
    if (out.length >= max) break;
  }
  return out;
}

export type EventoNormalizado = {
  tipo: "entrega" | "rebote" | "respuesta";
  /** Provider event id (preferred) or a hash of the stable parts: the SAME delivery twice must give the SAME dedupe. */
  dedupe: string;
  externoId: string | null;
  token: string | null;
  /** Message-Id the reply answers (fallback correlation when the token was stripped). */
  enRespuestaA: string | null;
  /**
   * Namespace of `externoId` / `enRespuestaA`. Default («proveedor») = the PROVIDER's own email id as stored at send time in `solicitudes_proveedor.mensaje_id` (Resend API email id). «rfc822» = an RFC 5322 `Message-ID` header
   * (what a mailbox reports): it is a DIFFERENT identifier and is never compared with `mensaje_id`.
   */
  espacio?: "proveedor" | "rfc822";
  resumen: { de?: string; asunto?: string; texto?: string; error?: string };
};

const corto = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);

/**
 * Neutral webhook body → normalised event, or null when it is not one we understand (the route then ignores it).
 *   { "tipo": "entrega" | "rebote" | "respuesta", "evento_id"?: string, "token"?: string, "para"?: string[], "en_respuesta_a"?: string, "mensaje_id"?: string,
 *     "de"?: string, "asunto"?: string, "texto"?: string, "error"?: string }
 * A provider adapter (Hostinger webhook, Resend, a forwarding script) only has to produce this shape. Text is truncated: this is a pointer to the reply, not a mailbox replica.
 */
export function normalizarEvento(cuerpo: unknown): EventoNormalizado | null {
  if (!cuerpo || typeof cuerpo !== "object") return null;
  const b = cuerpo as Record<string, unknown>;
  const tipo = b.tipo;
  if (tipo !== "entrega" && tipo !== "rebote" && tipo !== "respuesta") return null;
  const externoId = corto(b.evento_id, 150) ?? null;
  const token = (typeof b.token === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(b.token) ? b.token : null) ?? tokenDeDirecciones(lista(b.para));
  const enRespuestaA = corto(b.en_respuesta_a, 300) ?? null;
  const mensajeId = corto(b.mensaje_id, 300);
  const resumen = { de: corto(b.de, 200), asunto: corto(b.asunto, 300), texto: corto(b.texto, 2000), error: corto(b.error, 300) };
  // Without a provider event id the dedupe is derived from what identifies the event, so the same message delivered twice collapses into one.
  const dedupe = externoId ?? `h:${createHash("sha256").update(JSON.stringify([tipo, token, enRespuestaA, mensajeId, resumen.de, resumen.asunto, resumen.texto])).digest("hex").slice(0, 40)}`;
  return { tipo, dedupe, externoId: externoId ?? mensajeId ?? null, token, enRespuestaA, resumen };
}

/** HMAC-SHA256 hex of the RAW body, compared in constant time. Missing secret/signature → false (fail closed). */
export function firmaValida(cuerpoCrudo: string, firma: string | null | undefined, secreto: string | undefined): boolean {
  if (!secreto || !firma) return false;
  const esperado = createHmac("sha256", secreto).update(cuerpoCrudo).digest("hex");
  const dado = firma.trim().toLowerCase().replace(/^sha256=/, "");
  const a = Buffer.from(esperado), b = Buffer.from(dado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Optional free-text note a person may add ABOVE the structured tables of one send (H103-13). Plain text only (escaped wherever it is rendered), bounded: too long is an error, never a silent cut. */
export const MAX_MENSAJE_ADICIONAL = 600;
export function limpiarMensajeAdicional(x: unknown): { ok: true; v: string | null } | { ok: false; error: string } {
  if (x == null) return { ok: true, v: null };
  if (typeof x !== "string") return { ok: false, error: "El mensaje adicional no es válido." };
  const t = x.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) return { ok: true, v: null };
  if (t.length > MAX_MENSAJE_ADICIONAL) return { ok: false, error: `El mensaje adicional supera ${MAX_MENSAJE_ADICIONAL} caracteres (tiene ${t.length}). Acórtalo.` };
  return { ok: true, v: t };
}
/** The note as HTML paragraph content: escaped first, then line breaks (mail clients ignore white-space rules). */
export const mensajeAdicionalHtml = (t: string): string => escaparHtml(t).replace(/\n/g, "<br>");

export const asuntoSolicitud = (numero: string, proveedor: string | null | undefined): string => `Solicitud de servicio${proveedor ? ` · ${proveedor}` : ""} · Reserva ${numero}`;

/** Escapes text for HTML (the only untrusted text we embed ourselves; the voucher body comes from React's own escaping). */
export const escaparHtml = (t: string): string => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ── Resend inbound/delivery webhooks (Svix-signed) ────────────────────────────────────────────────────────────────────────────────────────────
// Official scheme (Resend «Verify webhooks requests», Svix): headers `svix-id`, `svix-timestamp`, `svix-signature` («v1,<base64>» possibly several, space separated); the signed content is `${id}.${timestamp}.${rawBody}`,
// HMAC-SHA256 with the endpoint secret `whsec_<base64>` (the base64 part is the key). Timestamp tolerance 5 minutes against replay. Missing secret/headers → false (fail closed).
export function firmaSvixValida(args: { id: string | null | undefined; timestamp: string | null | undefined; firma: string | null | undefined; cuerpoCrudo: string; secreto: string | undefined; ahoraMs?: number; toleranciaSeg?: number }): boolean {
  const { id, timestamp, firma, cuerpoCrudo, secreto } = args;
  if (!id || !timestamp || !firma || !secreto) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(((args.ahoraMs ?? Date.now()) / 1000) - ts) > (args.toleranciaSeg ?? 300)) return false;
  const clave = Buffer.from(secreto.startsWith("whsec_") ? secreto.slice(6) : secreto, "base64");
  if (!clave.length) return false;
  const esperado = createHmac("sha256", clave).update(`${id}.${timestamp}.${cuerpoCrudo}`).digest();
  return firma.split(" ").some((par) => {
    const [version, valor] = par.split(",");
    if (version !== "v1" || !valor) return false;
    const dado = Buffer.from(valor, "base64");
    return dado.length === esperado.length && timingSafeEqual(dado, esperado);
  });
}

/**
 * Resend event → normalised event. `email.delivered`→entrega, `email.bounced`/`email.failed`→rebote, `email.received`→respuesta (the supplier replied to `respuestas+TOKEN@…`: the token is in `data.to`).
 * Delivery/bounce are correlated by the provider email id we stored at send time (`data.email_id` = `mensaje_id`); dedupe = the Svix event id (the same on provider retries). Anything else → null (ignored).
 * LIMIT (official docs): `email.received` carries sender/subject/ids but NOT the body: `resumen.texto` stays empty until a body fetch is added (not implemented).
 */
export function normalizarEventoResend(cuerpo: unknown, svixId: string): EventoNormalizado | null {
  if (!cuerpo || typeof cuerpo !== "object") return null;
  const b = cuerpo as { type?: unknown; data?: Record<string, unknown> };
  const d = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>;
  const mapa: Record<string, EventoNormalizado["tipo"]> = { "email.delivered": "entrega", "email.bounced": "rebote", "email.failed": "rebote", "email.received": "respuesta" };
  const tipo = typeof b.type === "string" ? mapa[b.type] : undefined;
  if (!tipo || !svixId) return null;
  const emailId = corto(d.email_id, 150) ?? null;
  const de = typeof d.from === "string" ? d.from : Array.isArray(d.from) ? lista(d.from)[0] : undefined;
  return {
    tipo, dedupe: svixId, externoId: emailId,
    token: tipo === "respuesta" ? tokenDeDirecciones(lista(d.to)) : null,
    enRespuestaA: null,
    resumen: { de: corto(de, 200), asunto: corto(d.subject, 300), error: tipo === "rebote" ? corto((d.bounce as Record<string, unknown> | undefined)?.message ?? d.reason ?? b.type, 300) : undefined },
  };
}
