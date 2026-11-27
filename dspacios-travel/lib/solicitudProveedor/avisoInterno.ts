// #103 — internal e-mail notice for a supplier reply, shared by every inbound entry (neutral/Resend webhook and Hostinger). The on-screen notices are always created by the event RPC; this e-mail goes ONLY to the internal
// recipients the owner configured (SOLICITUD_PROVEEDOR_AVISO_EMAILS) and only when mail sending is enabled. It is called by `procesarEvento` ONLY when the event is new, so a duplicate delivery never sends a second one;
// its idempotency key (`aviso:<request>:<event dedupe>`) protects a retried send at the provider as well.
import { escaparHtml, type EventoNormalizado } from "./nucleo.ts";
import { configCorreo, transporteDeConfig } from "./transporte.ts";
import type { Database } from "@/types/database";

type Fila = Database["public"]["Tables"]["solicitudes_proveedor"]["Row"];

export async function notificarInternoPorCorreo(s: Fila, e: EventoNormalizado, env: Record<string, string | undefined> = process.env): Promise<void> {
  const lista = (env.SOLICITUD_PROVEEDOR_AVISO_EMAILS ?? "").split(/[\s,;]+/).filter(Boolean);
  const cfg = configCorreo(env);
  if (!lista.length || !cfg.ok) return;
  await transporteDeConfig(cfg.config, env).enviar({
    de: cfg.config.remitente, para: lista, responderA: cfg.config.remitente, asunto: `Respuesta del proveedor · ${s.asunto}`,
    html: `<p>El proveedor <b>${escaparHtml(s.proveedor ?? "")}</b> respondió ${s.tipo === "pago" ? "el aviso de pago" : `la solicitud de la reserva <b>${escaparHtml(s.numero_contrato ?? "")}</b>`}.</p><p>${escaparHtml(e.resumen.texto ?? "")}</p><p>Revisa el seguimiento en la aplicación.</p>`,
    texto: `El proveedor ${s.proveedor ?? ""} respondió ${s.tipo === "pago" ? "el aviso de pago" : `la solicitud de la reserva ${s.numero_contrato ?? ""}`}.\n${e.resumen.texto ?? ""}\nRevisa el seguimiento en la aplicación.\n`,
    claveIdempotencia: `aviso:${s.id}:${e.dedupe}`,
  });
}
