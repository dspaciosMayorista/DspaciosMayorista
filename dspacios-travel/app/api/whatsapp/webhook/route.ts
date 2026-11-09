// Webhook de WhatsApp Cloud API para SalesBot (#56). Apagado por defecto (WHATSAPP_BOT_ACTIVO != "1" → 404).
// Valida la firma sobre el cuerpo crudo antes de leer nada.
//
// Códigos de respuesta a un POST firmado:
//   200 → todo mensaje del lote quedó atendido (o ya lo estaba, o se abandonó con registro tras el tope de reintentos).
//   503 → algún mensaje NO se pudo completar (base, Meta o correo caídos): Meta reintentará el lote. Los mensajes ya completados
//         se ignoran por su id y los pendientes continúan donde quedaron (ver lib/whatsapp/turno.ts).
import { NextResponse } from "next/server";
import { fechaNegocio } from "@/lib/fechaNegocio";
import { generarFlujoId, registrarErrorTecnico } from "@/lib/observabilidad/medicion";
import { leerConfigWhatsApp } from "@/lib/whatsapp/config";
import { firmaValida, respuestaHandshake } from "@/lib/whatsapp/firma";
import { extraerMensajes } from "@/lib/whatsapp/entrante";
import { procesarMensaje } from "@/lib/whatsapp/turno";
import { almacenSupabase } from "@/lib/whatsapp/almacen";
import { serviciosWhatsApp } from "@/lib/whatsapp/servicios";
import { enviarCuerpo } from "@/lib/whatsapp/envio";
import { crearAvisador } from "@/lib/whatsapp/aviso";

export const dynamic = "force-dynamic";
const FLUJO = "salesbot_whatsapp";

function config() {
  const c = leerConfigWhatsApp();
  return c.estado === "apagado" || c.estado === "mal_configurado" ? null : c;
}

export async function GET(req: Request) {
  const cfg = config();
  if (!cfg) return new NextResponse(null, { status: 404 });
  const challenge = respuestaHandshake(new URL(req.url).searchParams, cfg.verifyToken);
  return challenge ? new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } }) : new NextResponse(null, { status: 403 });
}

export async function POST(req: Request) {
  const cfg = config();
  if (!cfg) return new NextResponse(null, { status: 404 });
  const crudo = await req.text();
  if (!firmaValida(crudo, req.headers.get("x-hub-signature-256"), cfg.appSecret)) return new NextResponse(null, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(crudo);
  } catch {
    return new NextResponse(null, { status: 200 }); // firmado pero ilegible: reintentar no lo arregla
  }
  const flujoId = generarFlujoId();
  const almacen = almacenSupabase();
  const servicios = serviciosWhatsApp();
  const avisarAsesor = cfg.avisoEmail ? crearAvisador(cfg.avisoEmail, process.env.SALESBOT_WA_AVISO_REMITENTE || "info@dspaciostravel.com") : undefined;
  // Solo la etiqueta del error: nunca el texto del cliente ni su número.
  const registrar = (etapa: string, error: unknown) => registrarErrorTecnico(FLUJO, flujoId, etapa, "fallo", error instanceof Error ? new Error(error.message.split(":")[0].slice(0, 40)) : new Error("desconocido"));

  let pendientes = 0;
  for (const m of extraerMensajes(payload, cfg.phoneNumberId)) {
    const estado = await procesarMensaje(
      { almacen, servicios, ahora: new Date(), hoy: fechaNegocio(new Date()), urlBase: cfg.urlBase, enviar: (waId, cuerpo) => enviarCuerpo(cfg, waId, cuerpo), avisarAsesor, registrar },
      m,
    ).catch((e) => (registrar("turno", e), "reintentar" as const));
    if (estado === "reintentar") pendientes++;
  }
  return new NextResponse(null, { status: pendientes ? 503 : 200 });
}
