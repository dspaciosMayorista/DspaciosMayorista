"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getTenant } from "@/lib/tenant.server";

type Result = { ok: true } | { ok: false; error: string };

// Guarda los datos fiscales de la AGENCIA ACTIVA (del RUT).
export async function guardarAgencia(input: Record<string, string | boolean>): Promise<Result> {
  const sb = await createClient();
  const tenant = await getTenant();
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string).trim() || null : null);
  const { error } = await sb.from("agencias").upsert(
    {
      tenant,
      razon_social: s("razon_social"),
      nombre_comercial: s("nombre_comercial"),
      nit: s("nit"),
      dv: s("dv"),
      rnt: s("rnt"),
      direccion: s("direccion"),
      ciudad: s("ciudad"),
      correo: s("correo"),
      telefono: s("telefono"),
      actividad_economica: s("actividad_economica"),
      responsabilidades: s("responsabilidades"),
      representante_legal: s("representante_legal"),
      factura_electronica: !!input.factura_electronica,
      banco: s("banco"),
      tipo_cuenta: s("tipo_cuenta"),
      numero_cuenta: s("numero_cuenta"),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant" }
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contabilidad/agencia");
  return { ok: true };
}
