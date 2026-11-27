// #103 — mail transports for supplier requests. Provider-neutral interface; three modes selected by SOLICITUD_PROVEEDOR_EMAIL:
//   off (default)  nothing is sent: the UI says the feature is not enabled.
//   captura        LOCAL capture only (Mailpit HTTP API on a loopback address): no message can leave the machine — a non-loopback URL is refused.
//   vivo           real provider (today: Resend, already integrated). Requires RESEND_API_KEY + SOLICITUD_PROVEEDOR_REMITENTE + SOLICITUD_PROVEEDOR_RESPONDER_A (owner decisions Q4/Q5).
// This file never reads or logs secrets beyond passing the key to the provider.

export type Adjunto = { nombre: string; contentType: string; base64: string };
export type Mensaje = { de: string; para: string[]; responderA: string; asunto: string; html: string; texto: string; adjuntos?: Adjunto[]; claveIdempotencia: string };
// `incierto`: la llamada pudo haber llegado al proveedor aunque no sepamos su respuesta (tiempo agotado, red cortada, 5xx). Un rechazo claro (4xx) NO es incierto: el correo no salió.
export type ResultadoEnvio = { ok: true; mensajeId: string | null } | { ok: false; error: string; incierto?: boolean };
// `idempotente`: el proveedor devuelve el MISMO resultado si se repite la petición con la misma clave dentro de `ventanaIdempotenciaMs` (Resend: 24 h). Solo entonces un envío de resultado desconocido se reintenta; si no, queda «incierta».
export type Transporte = { enviar: (m: Mensaje) => Promise<ResultadoEnvio>; idempotente: boolean; ventanaIdempotenciaMs: number };
/** Tope de cada llamada al proveedor: el arrendamiento del envío (servicio.ts) es siempre mayor, así que un trabajador vivo nunca pierde su reclamo a mitad de llamada. */
export const TIEMPO_LLAMADA_MS = 20_000;
export type ModoCorreo = "off" | "captura" | "vivo";

export const modoCorreo = (env: Record<string, string | undefined> = process.env): ModoCorreo => {
  const v = (env.SOLICITUD_PROVEEDOR_EMAIL ?? "").trim().toLowerCase();
  return v === "captura" || v === "vivo" ? v : "off";
};

export type ConfigCorreo = { modo: "captura" | "vivo"; remitente: string; responderA: string; capturaUrl?: string };

/** Reads the configuration or says exactly what is missing (never a stack trace, never a secret value). */
export function configCorreo(env: Record<string, string | undefined> = process.env): { ok: true; config: ConfigCorreo } | { ok: false; error: string } {
  const modo = modoCorreo(env);
  if (modo === "off") return { ok: false, error: "El envío de solicitudes por correo no está habilitado todavía." };
  if (modo === "captura") {
    const url = env.SOLICITUD_PROVEEDOR_CAPTURA_URL?.trim();
    if (!url) return { ok: false, error: "Falta SOLICITUD_PROVEEDOR_CAPTURA_URL (captura local)." };
    if (!esLoopback(url)) return { ok: false, error: "La captura local solo acepta direcciones de esta máquina (localhost / 127.0.0.1)." };
    return { ok: true, config: { modo, capturaUrl: url, remitente: env.SOLICITUD_PROVEEDOR_REMITENTE?.trim() || "solicitudes@dspacios.test", responderA: env.SOLICITUD_PROVEEDOR_RESPONDER_A?.trim() || "respuestas@dspacios.test" } };
  }
  const faltan = ["RESEND_API_KEY", "SOLICITUD_PROVEEDOR_REMITENTE", "SOLICITUD_PROVEEDOR_RESPONDER_A"].filter((k) => !env[k]?.trim());
  if (faltan.length) return { ok: false, error: `Configuración de correo incompleta (faltan: ${faltan.join(", ")}).` };
  return { ok: true, config: { modo, remitente: env.SOLICITUD_PROVEEDOR_REMITENTE!.trim(), responderA: env.SOLICITUD_PROVEEDOR_RESPONDER_A!.trim() } };
}

export function esLoopback(url: string): boolean {
  try { const h = new URL(url).hostname.replace(/^\[|\]$/g, ""); return h === "localhost" || h === "127.0.0.1" || h === "::1"; } catch { return false; }
}

/** Mailpit HTTP API (`POST /api/v1/send`): local, no relay, nothing leaves the machine. */
export function transporteCaptura(url: string, f: typeof fetch = fetch): Transporte {
  if (!esLoopback(url)) throw new Error("transporteCaptura: solo direcciones de esta máquina.");
  return {
    idempotente: false, ventanaIdempotenciaMs: 0,   // Mailpit no deduplica: un envío de resultado desconocido NO se reintenta
    async enviar(m) {
      try {
        const r = await f(`${url.replace(/\/$/, "")}/api/v1/send`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(TIEMPO_LLAMADA_MS), body: JSON.stringify({ From: { Email: m.de }, To: m.para.map((Email) => ({ Email })), ReplyTo: [{ Email: m.responderA }], Subject: m.asunto, HTML: m.html, Text: m.texto, ...(m.adjuntos?.length ? { Attachments: m.adjuntos.map((a) => ({ Filename: a.nombre, Content: a.base64, ContentType: a.contentType })) } : {}), Headers: { "X-Idempotency-Key": m.claveIdempotencia } }),
        });
        if (!r.ok) return { ok: false, error: `La captura local respondió ${r.status}.`, incierto: r.status >= 500 };
        const j = (await r.json().catch(() => ({}))) as { ID?: string };
        return { ok: true, mensajeId: j.ID ?? null };
      } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "No se pudo contactar la captura local.", incierto: true }; }
    },
  };
}

/** Resend (already the project's provider). `Idempotency-Key` makes a retried request after a timeout not send twice at the provider as well. */
export function transporteResend(apiKey: string, f: typeof fetch = fetch): Transporte {
  return {
    idempotente: true, ventanaIdempotenciaMs: 23 * 60 * 60 * 1000,   // Resend conserva la clave 24 h; se deja una hora de margen
    async enviar(m) {
      try {
        const r = await f("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": m.claveIdempotencia.slice(0, 256) },
          signal: AbortSignal.timeout(TIEMPO_LLAMADA_MS), body: JSON.stringify({ from: m.de, to: m.para, reply_to: m.responderA, subject: m.asunto, html: m.html, text: m.texto, ...(m.adjuntos?.length ? { attachments: m.adjuntos.map((a) => ({ filename: a.nombre, content: a.base64 })) } : {}) }),
        });
        if (!r.ok) return { ok: false, error: `El proveedor de correo respondió ${r.status}.`, incierto: r.status >= 500 || r.status === 409 };   // body deliberately not echoed
        const j = (await r.json().catch(() => ({}))) as { id?: string };
        return { ok: true, mensajeId: j.id ?? null };
      } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "No se pudo enviar el correo.", incierto: true }; }
    },
  };
}

export function transporteDeConfig(c: ConfigCorreo, env: Record<string, string | undefined> = process.env, f: typeof fetch = fetch): Transporte {
  return c.modo === "captura" ? transporteCaptura(c.capturaUrl!, f) : transporteResend(env.RESEND_API_KEY!, f);
}
