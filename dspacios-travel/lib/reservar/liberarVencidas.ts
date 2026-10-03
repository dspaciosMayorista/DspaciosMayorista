import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { fechaCorteVencimiento } from "@/lib/reservar/vencimiento";

// NO es una Server Action (este archivo no lleva "use server"): antes vivía
// exportada en app/(dashboard)/dashboard/reservar/actions.ts, invocable por
// cualquiera sin sesión. Sus únicos usos legítimos son de servidor:
//   - el render de /dashboard/reservar (liberación perezosa al entrar);
//   - el cron /api/cron/liberar-vencidas, protegido por CRON_SECRET.

// ── Liberar reservas vencidas (plazo pasado y sin confirmar) ───────────────
// Todo en UNA transacción de la base (`liberar_vencidas`, migración 196):
// cancela los contratos pendientes con plazo ESTRICTAMENTE anterior al día de
// negocio de Bogotá y suelta sus sillas en plazo sin ningún dato residual
// (R1). Un plazo de hoy no se libera hoy, a ninguna hora.
export async function liberarVencidas(
  instante: Date = new Date()
): Promise<{ ok: boolean; liberadas: number; error?: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, liberadas: 0, error: "Falta SUPABASE_SERVICE_ROLE_KEY." };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("liberar_vencidas", { p_hoy: fechaCorteVencimiento(instante) });
  if (error) return { ok: false, liberadas: 0, error: error.message };
  const liberadas = Number((data as { liberadas?: number } | null)?.liberadas ?? 0);
  if (liberadas > 0) revalidatePath("/dashboard/contratos");
  return { ok: true, liberadas };
}
