import { NextResponse } from "next/server";
import { enviarNotificaciones } from "@/lib/notificaciones";

// Cron diario (Vercel): envía el digest de alertas operativas por correo (Resend).
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
  const r = await enviarNotificaciones();
  return NextResponse.json(r);
}
