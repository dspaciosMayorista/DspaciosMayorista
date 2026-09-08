import { NextResponse } from "next/server";
import { reconciliarFinancieroPendienteAction } from "@/app/(dashboard)/dashboard/reservar/reconciliacion-actions";

// Cron (Vercel): cierra la garantía financiera durable de la migración 172
// (revisión B7 del PR #294) — contratos que quedaron `financiero_estado
// ='pendiente'` porque el proceso original murió antes de terminar (o de
// siquiera intentar revertir), y CxP sin asiento contable. Corre en un
// proceso completamente distinto al que creó el contrato, así que no
// depende de que ese proceso original haya sobrevivido para nada.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // Sin CRON_SECRET configurado, el endpoint rechaza todo (falla cerrado) en
  // vez de quedar abierto a cualquiera con la URL.
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await reconciliarFinancieroPendienteAction();
  return NextResponse.json(r);
}
