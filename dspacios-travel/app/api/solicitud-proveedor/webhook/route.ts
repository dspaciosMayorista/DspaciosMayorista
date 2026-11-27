import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { firmaSvixValida, firmaValida, normalizarEvento, normalizarEventoResend } from "@/lib/solicitudProveedor/nucleo";
import { procesarEvento, usuariosAvisarPorDefecto } from "@/lib/solicitudProveedor/servicio";
import { notificarInternoPorCorreo } from "@/lib/solicitudProveedor/avisoInterno";

// #103 — receptor NEUTRAL de eventos de correo (entrega / rebote / respuesta del proveedor). Cualquier proveedor (webhook de Hostinger, Resend, un reenviador) solo debe producir el cuerpo
// descrito en lib/solicitudProveedor/nucleo.ts → normalizarEvento y firmarlo con HMAC-SHA256 (cabecera `x-firma`) usando SOLICITUD_PROVEEDOR_WEBHOOK_SECRET. Sin secreto configurado o con
// firma inválida responde 401/503 y NO toca la base. Un token/mensaje desconocido responde 200 «ignorado» (no revela qué solicitudes existen). Un envío duplicado se guarda y notifica UNA vez.
export const dynamic = "force-dynamic";
const MAX_BYTES = 64 * 1024;

export async function POST(req: Request) {
  // Dos entradas: la neutral firmada con HMAC (`x-firma`) y la de Resend firmada con Svix (`svix-*`, secreto SOLICITUD_PROVEEDOR_RESEND_WEBHOOK_SECRET). Sin el secreto de la que llega → 503 y no se toca la base.
  const esResend = req.headers.has("svix-id");
  const secreto = esResend ? process.env.SOLICITUD_PROVEEDOR_RESEND_WEBHOOK_SECRET : process.env.SOLICITUD_PROVEEDOR_WEBHOOK_SECRET;
  if (!secreto) return NextResponse.json({ error: "Webhook no configurado." }, { status: 503 });
  const crudo = await req.text();
  if (crudo.length > MAX_BYTES) return NextResponse.json({ error: "Cuerpo demasiado grande." }, { status: 413 });
  const firmaOk = esResend
    ? firmaSvixValida({ id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), firma: req.headers.get("svix-signature"), cuerpoCrudo: crudo, secreto })
    : firmaValida(crudo, req.headers.get("x-firma"), secreto);
  if (!firmaOk) return NextResponse.json({ error: "Firma no válida." }, { status: 401 });
  let json: unknown;
  try { json = JSON.parse(crudo); } catch { return NextResponse.json({ error: "JSON no válido." }, { status: 400 }); }
  const ev = esResend ? normalizarEventoResend(json, req.headers.get("svix-id")!) : normalizarEvento(json);
  if (!ev) return NextResponse.json({ ok: true, ignorado: true });
  try {
    const admin = createAdminClient();
    const r = await procesarEvento({
      admin,
      usuariosAvisar: (s) => usuariosAvisarPorDefecto(admin, s),
      // Aviso por correo a destinatarios internos SOLO si el dueño los configuró (SOLICITUD_PROVEEDOR_AVISO_EMAILS) y el correo está habilitado; los avisos en pantalla siempre se crean.
      notificarInterno: (sol, e) => notificarInternoPorCorreo(sol, e),
    }, ev);
    return NextResponse.json(r);
  } catch (e) {
    console.error("solicitud-proveedor webhook:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "No se pudo procesar el evento." }, { status: 500 });
  }
}
