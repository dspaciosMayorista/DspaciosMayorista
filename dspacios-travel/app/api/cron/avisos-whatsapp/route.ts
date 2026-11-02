import { NextResponse } from "next/server";
import { generarFlujoId, registrarErrorTecnico } from "@/lib/observabilidad/medicion";
import { leerConfigWhatsApp } from "@/lib/whatsapp/config";
import { almacenSupabase } from "@/lib/whatsapp/almacen";
import { crearAvisador } from "@/lib/whatsapp/aviso";
import { recuperarAvisos } from "@/lib/whatsapp/recuperacion";

export const dynamic = "force-dynamic";

// Cron (Vercel): vuelve a avisar al equipo de los traspasos de WhatsApp cuyo correo agotó los reintentos del webhook (#56). No depende de que el
// cliente escriba otra vez. Inerte mientras el canal esté apagado (WHATSAPP_BOT_ACTIVO != "1").
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // Sin CRON_SECRET configurado, el endpoint rechaza todo (falla cerrado) en vez de quedar abierto a cualquiera con la URL.
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const cfg = leerConfigWhatsApp();
  if (cfg.estado === "apagado") return NextResponse.json({ activo: false });
  if (cfg.estado === "mal_configurado") return NextResponse.json({ error: "canal mal configurado", falta: cfg.falta }, { status: 503 });
  if (!cfg.avisoEmail) return NextResponse.json({ error: "sin canal de aviso (SALESBOT_WA_AVISO_EMAIL)" }, { status: 503 });

  const flujoId = generarFlujoId();
  try {
    const r = await recuperarAvisos({
      almacen: almacenSupabase(),
      avisar: crearAvisador(cfg.avisoEmail, process.env.SALESBOT_WA_AVISO_REMITENTE || "info@dspaciostravel.com"),
      ahora: new Date(),
      registrar: (etapa, e) => registrarErrorTecnico("salesbot_whatsapp_cron", flujoId, etapa, "fallo", e instanceof Error ? new Error(e.message.split(":")[0].slice(0, 40)) : new Error("desconocido")),
    });
    // 500 si quedó algo por reintentar: Vercel lo muestra como corrida fallida y el equipo se entera.
    return NextResponse.json(r, { status: r.fallidos ? 500 : 200 });
  } catch (e) {
    registrarErrorTecnico("salesbot_whatsapp_cron", flujoId, "corrida", "fallo", e instanceof Error ? new Error(e.message.split(":")[0].slice(0, 40)) : new Error("desconocido"));
    return NextResponse.json({ error: "fallo" }, { status: 500 });
  }
}
