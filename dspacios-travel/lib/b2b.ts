import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type SB = SupabaseClient<Database>;
export type NivelAliado = "junior" | "senior";

// Comisión general por defecto (parámetro tributario): COMISION_AGENCIA (12%) /
// COMISION_FREELANCE (11%). Acepta valor como fracción (0.12) o porcentaje (12).
export async function comisionDefault(sb: SB, tipo: string): Promise<number> {
  const param = tipo === "freelance" ? "COMISION_FREELANCE" : "COMISION_AGENCIA";
  const { data } = await sb.from("parametros_tributarios").select("valor").eq("parametro", param).maybeSingle();
  let v = Number(data?.valor);
  if (!Number.isFinite(v) || v <= 0) v = tipo === "freelance" ? 0.11 : 0.12;
  if (v > 1) v = v / 100;
  return v;
}

// Categoría del aliado según su % vs. el default general:
//   = default → Junior · > default → Senior.
export function categoriaAliado(tipo: string, pct: number, def: number): { nivel: NivelAliado; label: string } {
  const nivel: NivelAliado = pct > def + 1e-9 ? "senior" : "junior";
  const base = tipo === "freelance" ? "Freelance" : "Agencia";
  return { nivel, label: `${base} ${nivel === "senior" ? "Senior" : "Junior"}` };
}
