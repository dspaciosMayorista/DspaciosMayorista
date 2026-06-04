"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };
const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export type AliadoInput = {
  nombre: string;
  tipo: "agencia" | "freelance";
  nit: string;
  contacto: string;
  email: string;
  telefono: string;
  pctComision: number | null;   // override (fracción); null = usa el default general
  aplicaRetencion: boolean;
  pctRetencion: number;         // fracción
};

export async function crearAliado(input: AliadoInput): Promise<Result> {
  if (!input.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const sb = await createClient();
  const { error } = await sb.from("aliados").insert({
    nombre: input.nombre.trim(),
    tipo: input.tipo,
    nit: oNull(input.nit),
    contacto: oNull(input.contacto),
    email: oNull(input.email),
    telefono: oNull(input.telefono),
    pct_comision: input.pctComision,
    aplica_retencion: input.aplicaRetencion,
    pct_retencion: input.pctRetencion,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/aliados");
  return { ok: true };
}

export async function actualizarAliado(
  id: number,
  patch: { pctComision?: number | null; aplicaRetencion?: boolean; pctRetencion?: number }
): Promise<Result> {
  const sb = await createClient();
  const upd: { pct_comision?: number | null; aplica_retencion?: boolean; pct_retencion?: number } = {};
  if (patch.pctComision !== undefined) upd.pct_comision = patch.pctComision;
  if (patch.aplicaRetencion !== undefined) upd.aplica_retencion = patch.aplicaRetencion;
  if (patch.pctRetencion !== undefined) upd.pct_retencion = patch.pctRetencion;
  const { error } = await sb.from("aliados").update(upd).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/aliados");
  return { ok: true };
}

export async function eliminarAliado(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("aliados").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/aliados");
  return { ok: true };
}
