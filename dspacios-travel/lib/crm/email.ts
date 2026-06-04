// Envío de email por proveedor (HTTP API, sin dependencias extra).
// Soporta Brevo y Resend (tiers gratis). SMTP propio queda pendiente.

export type EmailConfig = {
  proveedor: string;
  remitente_email: string | null;
  remitente_nombre: string | null;
  responder_a: string | null;
  api_key: string | null;
  firma_html: string | null;
  activo: boolean;
};

export type EnvioResult = { ok: true } | { ok: false; error: string };

export async function enviarEmail(
  cfg: EmailConfig,
  to: string,
  subject: string,
  html: string
): Promise<EnvioResult> {
  if (!cfg.api_key) return { ok: false, error: "Falta la API key del proveedor." };
  if (!cfg.remitente_email) return { ok: false, error: "Falta el correo remitente." };
  const nombre = cfg.remitente_nombre || "D'spacios Travel";

  try {
    if (cfg.proveedor === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.api_key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${nombre} <${cfg.remitente_email}>`,
          to: [to],
          subject,
          html,
          ...(cfg.responder_a ? { reply_to: cfg.responder_a } : {}),
        }),
      });
      if (!res.ok) return { ok: false, error: (await res.text()).slice(0, 300) };
      return { ok: true };
    }

    if (cfg.proveedor === "brevo") {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": cfg.api_key, "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { name: nombre, email: cfg.remitente_email },
          to: [{ email: to }],
          subject,
          htmlContent: html,
          ...(cfg.responder_a ? { replyTo: { email: cfg.responder_a } } : {}),
        }),
      });
      if (!res.ok) return { ok: false, error: (await res.text()).slice(0, 300) };
      return { ok: true };
    }

    return { ok: false, error: "Proveedor no soportado para envío automático (usa Brevo o Resend)." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red al enviar." };
  }
}

/** Compone el HTML final del correo (cuerpo + firma). */
export function componerHtml(cuerpo: string, firma: string | null): string {
  return `${cuerpo}${firma ? `<hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>${firma}` : ""}`;
}
