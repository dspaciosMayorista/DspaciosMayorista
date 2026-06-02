"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };
const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export type Liquidacion = "dia" | "noche" | "paquete";

export async function crearServicio(input: {
  nombre: string;
  proveedorId: number | null;
  destinoId: number | null;
  tarifaNeta: number;
  temporada: string;
  liquidacion: Liquidacion;
  rangosEdad?: number[];
}): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("servicios_adicionales").insert({
    nombre: input.nombre.trim(),
    proveedor_id: input.proveedorId,
    destino_id: input.destinoId,
    tarifa_neta: input.tarifaNeta,
    temporada: oNull(input.temporada),
    liquidacion: input.liquidacion,
    rangos_edad: input.rangosEdad?.length ? input.rangosEdad : null,
    activo: true,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/producto/servicios");
  return { ok: true };
}

export async function actualizarServicio(id: number, input: {
  nombre: string;
  proveedorId: number | null;
  destinoId: number | null;
  tarifaNeta: number;
  temporada: string;
  liquidacion: Liquidacion;
  rangosEdad?: number[];
}): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("servicios_adicionales")
    .update({
      nombre: input.nombre.trim(),
      proveedor_id: input.proveedorId,
      destino_id: input.destinoId,
      tarifa_neta: input.tarifaNeta,
      temporada: oNull(input.temporada),
      liquidacion: input.liquidacion,
      rangos_edad: input.rangosEdad?.length ? input.rangosEdad : null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/producto/servicios");
  return { ok: true };
}

export async function eliminarServicio(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("servicios_adicionales").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/producto/servicios");
  return { ok: true };
}
