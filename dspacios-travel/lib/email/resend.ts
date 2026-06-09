// Envío de correo vía Resend. La API key va en RESEND_API_KEY (variable de
// entorno). Dominio dspaciostravel.com debe estar verificado en Resend para
// enviar desde info@dspaciostravel.com.

export async function enviarEmail(args: {
  from: string;
  to: string[];
  subject: string;
  html: string;
}): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "Falta RESEND_API_KEY en variables de entorno." };
  const to = args.to.map((e) => e.trim()).filter(Boolean);
  if (!to.length) return { ok: false, error: "Sin destinatarios." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: args.from, to, subject: args.subject, html: args.html }),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error enviando el correo." };
  }
}
