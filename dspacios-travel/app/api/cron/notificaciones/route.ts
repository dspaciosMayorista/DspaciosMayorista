import { NextResponse } from "next/server";
import { enviarNotificaciones } from "@/lib/notificaciones";
import { generarAvisosCompra } from "@/lib/avisos/generarCompra";

// Cron diario (Vercel): (1) crea/archiva los avisos de compra por vencer de la campana de la aplicación (#13, sin correo) y (2) envía el digest de alertas operativas por correo (Resend), sin cambios.
// Son independientes: un fallo de uno no impide el otro.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // Sin CRON_SECRET configurado, el endpoint rechaza todo (falla cerrado) en vez
  // de quedar abierto a cualquiera con la URL.
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const avisosCompra = await generarAvisosCompra();
  const r = await enviarNotificaciones();
  return NextResponse.json({ ...r, avisosCompra });
}
