import { NextResponse } from "next/server";
import { enviarNotificaciones } from "@/lib/notificaciones";

// Cron diario (Vercel): envía el digest de alertas operativas por correo (Resend).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const r = await enviarNotificaciones();
  return NextResponse.json(r);
}
