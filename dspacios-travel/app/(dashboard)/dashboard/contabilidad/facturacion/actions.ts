"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };

// Guarda (o actualiza) la configuración de facturación de un contrato:
// IRT (para terceros) e ingreso exento/excluido. La base gravable y el ingreso
// propio se derivan del PVP: ingreso propio = PVP − IRT; base gravable = ingreso
// propio − exento.
export async function guardarFacturacion(input: {
  numeroContrato: string;
  pvp: number;
  irt: number;
  ingresoExento: number;
  tipoExento?: "exento" | "excluido" | null;
  observacion?: string;
}): Promise<Result> {
  const sb = await createClient();
  const pvp = Math.max(0, Number(input.pvp) || 0);
  const irt = Math.max(0, Number(input.irt) || 0);
  const ingresoExento = Math.max(0, Number(input.ingresoExento) || 0);
  if (irt + ingresoExento > pvp + 0.5) {
    return { ok: false, error: "IRT + ingreso exento/excluido no puede superar el PVP del contrato." };
  }
  const ingresoPropio = Math.max(0, pvp - irt); // snapshot para rentabilidad

  const { error } = await sb.from("contrato_facturacion").upsert(
    {
      numero_contrato: input.numeroContrato,
      irt,
      ingreso_propio: ingresoPropio,
      ingreso_exento: ingresoExento,
      tipo_exento: ingresoExento > 0 ? (input.tipoExento ?? "exento") : null,
      observacion: input.observacion?.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "numero_contrato" }
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contabilidad/facturacion");
  revalidatePath("/dashboard/rentabilidad");
  return { ok: true };
}

// Quita la configuración (el contrato vuelve al cálculo por defecto en rentabilidad).
export async function quitarFacturacion(numeroContrato: string): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("contrato_facturacion").delete().eq("numero_contrato", numeroContrato);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contabilidad/facturacion");
  revalidatePath("/dashboard/rentabilidad");
  return { ok: true };
}
