import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

// NO es una Server Action (este archivo no lleva "use server"): antes vivía
// exportada en app/(dashboard)/dashboard/reservar/actions.ts, invocable por
// cualquiera sin sesión. Sus únicos usos legítimos son de servidor:
//   - el render de /dashboard/reservar (liberación perezosa al entrar);
//   - el cron /api/cron/liberar-vencidas, protegido por CRON_SECRET.
// El cuerpo es el mismo de antes, sin cambios.

// ── Liberar reservas vencidas (plazo pasado y sin confirmar) ───────────────
export async function liberarVencidas(): Promise<{ ok: boolean; liberadas: number }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, liberadas: 0 };
  const admin = createAdminClient();
  const hoy = new Date().toISOString().slice(0, 10);
  const { data: vencidas } = await admin
    .from("ventas")
    .select("numero_contrato")
    .eq("estado", "pendiente")
    .lt("plazo", hoy);
  const nums = (vencidas ?? []).map((v) => v.numero_contrato);
  if (!nums.length) return { ok: true, liberadas: 0 };
  // Liberar sillas en_plazo de esos contratos
  await admin
    .from("sillas")
    .update({ estado: "disponible", numero_contrato: null, asesor: null, hotel: null, acomodacion: null, plazo: null })
    .in("numero_contrato", nums)
    .eq("estado", "en_plazo");
  await admin.from("ventas").update({ estado: "cancelado" }).in("numero_contrato", nums);
  revalidatePath("/dashboard/contratos");
  return { ok: true, liberadas: nums.length };
}
