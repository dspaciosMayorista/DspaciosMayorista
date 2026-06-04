import { NextResponse } from "next/server";
import { liberarVencidas } from "@/app/(dashboard)/dashboard/reservar/actions";

// Cron diario (Vercel): libera sillas de reservas con plazo vencido sin confirmar.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const r = await liberarVencidas();
  return NextResponse.json(r);
}
