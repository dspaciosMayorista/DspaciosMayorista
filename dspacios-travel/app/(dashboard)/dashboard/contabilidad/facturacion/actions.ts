"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };

// Guarda (o actualiza) la configuración de facturación de un contrato:
// cuánto es IRT, cuánto Ingreso propio y si el ingreso propio lleva IVA.
export async function guardarFacturacion(input: {
  numeroContrato: string;
  irt: number;
  ingresoPropio: number;
  llevaIva: boolean;
  observacion?: string;
}): Promise<Result> {
  const sb = await createClient();
  const irt = Math.max(0, Number(input.irt) || 0);
  const ingresoPropio = Math.max(0, Number(input.ingresoPropio) || 0);
  if (irt + ingresoPropio <= 0) return { ok: false, error: "Indica el IRT y/o el Ingreso propio." };

  const { error } = await sb.from("contrato_facturacion").upsert(
    {
      numero_contrato: input.numeroContrato,
      irt,
      ingreso_propio: ingresoPropio,
      lleva_iva: !!input.llevaIva,
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
