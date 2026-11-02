// Aviso por correo al equipo cuando un cliente pide un asesor. Falla RUIDOSO: si el correo no sale, lanza,
// para que el turno no confirme al cliente un traspaso que nadie fue avisado de atender.
import { enviarEmail } from "@/lib/email/resend";
import { soloDigitos } from "@/lib/whatsapp/config";

type Enviar = typeof enviarEmail;
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function crearAvisador(destino: string, remitente: string, enviar: Enviar = enviarEmail) {
  return async (t: { id: number; waId: string; nombrePerfil: string | null; resumen: Record<string, unknown> }): Promise<void> => {
    const r = await enviar({
      from: remitente,
      to: [destino],
      subject: "SalesBot WhatsApp: cliente pide un asesor",
      html: `<p>Cliente: +${soloDigitos(t.waId)}${t.nombrePerfil ? ` (${esc(t.nombrePerfil)})` : ""}</p><pre>${esc(JSON.stringify(t.resumen, null, 2))}</pre>`,
      // Un reintento del mismo traspaso no manda un segundo correo (Resend recuerda la clave 24 h).
      idempotencyKey: `salesbot-wa-traspaso-${t.id}`,
    });
    if (!r.ok) throw new Error("aviso_fallido");
  };
}
