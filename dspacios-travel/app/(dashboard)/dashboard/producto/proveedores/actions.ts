"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };
const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export type TipoProveedor = "hotelero" | "aereo" | "servicios";

export async function crearProveedor(input: {
  tipo: TipoProveedor;
  nombre: string;
  razonSocial: string;
  nit: string;
  ciudad: string;
  contacto: string;
  datosPago: string;
  aplicaRetencion: boolean;
  pctRetencion: number;
}): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("proveedores").insert({
    tipo: input.tipo,
    nombre: input.nombre.trim(),
    razon_social: oNull(input.razonSocial),
    nit: oNull(input.nit),
    ciudad: oNull(input.ciudad),
    contacto: oNull(input.contacto),
    datos_pago: oNull(input.datosPago),
    aplica_retencion: input.aplicaRetencion,
    pct_retencion: input.pctRetencion,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/producto/proveedores");
  return { ok: true };
}

export async function eliminarProveedor(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("proveedores").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/producto/proveedores");
  return { ok: true };
}
