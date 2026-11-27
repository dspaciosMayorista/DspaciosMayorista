// Soportes de pago (S339-02): rechazo interno + aviso por correo al aliado. Módulo PURO con dependencias inyectadas (sin red, sin Supabase, sin next/*): se prueba entero.
// Rechazar o corregir un soporte NUNCA registra ni aprueba un pago: el correo lo dice y las funciones de base solo tocan soportes y su aviso.
// El correo es un efecto secundario: si falla, el rechazo ya quedó guardado y el estado del aviso (pendiente/fallido) permite reintentarlo (máx. 5 intentos, lo impone la base).
import type { ConfigCorreo, Mensaje, ResultadoEnvio, Transporte } from "../solicitudProveedor/transporte.ts";

export const MOTIVO_MAX = 500;

/** Motivo obligatorio: recortado, 1 a 500 caracteres. */
export function validarMotivo(m: unknown): { ok: true; motivo: string } | { ok: false; error: string } {
  const t = typeof m === "string" ? m.trim() : "";
  if (!t) return { ok: false, error: "Escribe el motivo del rechazo: el aliado lo verá para corregir el soporte." };
  if (t.length > MOTIVO_MAX) return { ok: false, error: `El motivo supera los ${MOTIVO_MAX} caracteres.` };
  return { ok: true, motivo: t };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Enlace absoluto a la pestaña de soportes del portal (misma base de sitio que usa el resto de la aplicación). */
export function urlSoportesPortal(env: Record<string, string | undefined> = process.env): string {
  const base = env.NEXT_PUBLIC_SITE_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "http://localhost:3000");
  return `${base.replace(/\/+$/, "")}/portal/b2b/cartera?vista=soportes`;
}

export type DatosCorreoRechazo = { numeroVisible: string; archivo: string; motivo: string; url: string; nombre?: string | null };

/** Mensaje al aliado: contrato, nombre del archivo que él mismo subió, motivo y enlace. Sin montos, sin cliente, sin datos del contrato. */
export function construirCorreoRechazo(d: DatosCorreoRechazo): { asunto: string; html: string; texto: string } {
  const saludo = d.nombre?.trim() ? `Hola ${d.nombre.trim()},` : "Hola,";
  const asunto = `Soporte de pago rechazado · Contrato ${d.numeroVisible}`;
  const texto = [
    saludo, "",
    `El equipo revisó el soporte de pago «${d.archivo}» del contrato ${d.numeroVisible} y lo rechazó.`,
    `Motivo: ${d.motivo}`, "",
    `Para corregirlo, entra a tu portal y sube el archivo correcto en «Soportes de pago»: ${d.url}`, "",
    "Este mensaje no confirma ni cambia ningún pago: el soporte es solo evidencia que el equipo revisa.",
    "El archivo rechazado queda guardado en el historial del equipo.",
  ].join("\n");
  const html = [
    `<p>${esc(saludo)}</p>`,
    `<p>El equipo revisó el soporte de pago <strong>«${esc(d.archivo)}»</strong> del contrato <strong>${esc(d.numeroVisible)}</strong> y lo rechazó.</p>`,
    `<p><strong>Motivo:</strong> ${esc(d.motivo)}</p>`,
    `<p>Para corregirlo, entra a tu portal y sube el archivo correcto en «Soportes de pago»:<br><a href="${esc(d.url)}">${esc(d.url)}</a></p>`,
    `<p style="color:#666;font-size:12px">Este mensaje no confirma ni cambia ningún pago: el soporte es solo evidencia que el equipo revisa. El archivo rechazado queda guardado en el historial del equipo.</p>`,
  ].join("");
  return { asunto, html, texto };
}

export type Reclamo = { id: number; numero_contrato: string; nombre_original: string; motivo: string; intento: number; destinatarios: { email: string; nombre: string | null }[] };
export type EstadoAviso = "enviado" | "fallido" | "sin_destinatario";
export type ResultadoAviso =
  | { estado: EstadoAviso; enviados: number; mensaje: string }
  | { estado: "no_configurado" | "nada_que_enviar"; mensaje: string };

export type DepsAviso = {
  /** Lee la configuración de correo (captura local o proveedor); si no está habilitado, no se consume ningún intento. */
  config(): { ok: true; config: ConfigCorreo } | { ok: false; error: string };
  transporte(c: ConfigCorreo): Transporte;
  /** RPC soporte_rechazo_aviso_reclamar: atómico; null = nada que reclamar. */
  reclamar(id: number): Promise<{ data: Reclamo | null; error: { message: string } | null }>;
  /** RPC soporte_rechazo_aviso_cerrar. */
  cerrar(id: number, estado: EstadoAviso, destinatarios: number, error: string | null): Promise<unknown>;
  numeroVisible(numero: string): string;
  url: string;
};

/**
 * Envía (o reintenta) el aviso de un rechazo. Un correo por destinatario (las direcciones no se comparten entre cuentas), con clave de idempotencia por rechazo+destinatario.
 * Resultado de ENVÍO desconocido (tiempo agotado): con un transporte idempotente se considera enviable otra vez; con captura local queda «fallido» y el reintento es una decisión humana.
 */
export async function enviarAvisoRechazo(id: number, deps: DepsAviso): Promise<ResultadoAviso> {
  const cfg = deps.config();
  if (!cfg.ok) return { estado: "no_configurado", mensaje: `El rechazo quedó registrado, pero el aviso por correo no salió: ${cfg.error}` };
  const r = await deps.reclamar(id);
  if (r.error) return { estado: "nada_que_enviar", mensaje: "No se pudo preparar el aviso. Inténtalo de nuevo." };
  if (!r.data) return { estado: "nada_que_enviar", mensaje: "El aviso ya se envió o alcanzó el máximo de intentos." };
  const rec = r.data;
  if (rec.destinatarios.length === 0) {
    await deps.cerrar(id, "sin_destinatario", 0, "ninguna cuenta activa de aliado con correo");
    return { estado: "sin_destinatario", enviados: 0, mensaje: "El rechazo quedó registrado, pero no hay una cuenta de aliado activa con correo a quien avisar. El aliado lo verá al abrir su portal." };
  }
  const { remitente, responderA } = cfg.config;
  const t = deps.transporte(cfg.config);
  let enviados = 0; let fallidos = 0; let ultimo = "";
  for (const d of rec.destinatarios) {
    const c = construirCorreoRechazo({ numeroVisible: deps.numeroVisible(rec.numero_contrato), archivo: rec.nombre_original, motivo: rec.motivo, url: deps.url, nombre: d.nombre });
    const m: Mensaje = { de: remitente, para: [d.email], responderA, asunto: c.asunto, html: c.html, texto: c.texto, claveIdempotencia: `soporte-rechazo-${id}-${d.email.toLowerCase()}` };
    let res: ResultadoEnvio;
    try { res = await t.enviar(m); } catch (e) { res = { ok: false, error: e instanceof Error ? e.message : "fallo de envío", incierto: true }; }
    if (res.ok) enviados++; else { fallidos++; ultimo = res.error; }
  }
  if (enviados > 0) {
    await deps.cerrar(id, "enviado", enviados, fallidos ? `${fallidos} destinatario(s) sin enviar: ${ultimo}` : null);
    return { estado: "enviado", enviados, mensaje: `Aviso enviado a ${enviados} cuenta(s) del aliado${fallidos ? ` (${fallidos} no se pudieron enviar)` : ""}.` };
  }
  await deps.cerrar(id, "fallido", 0, ultimo || "no se pudo enviar");
  return { estado: "fallido", enviados: 0, mensaje: "El rechazo quedó registrado, pero el aviso por correo no salió. Puedes reintentarlo desde el historial." };
}
