"use server";

import { revalidatePath } from "next/cache";
import { registrarAbono } from "../contratos/actions";

// Registra un abono del cliente desde el módulo de Cartera (listado central).
// Reutiliza la regla de negocio canónica de `registrarAbono` (un abono confirma
// la venta pendiente y sus sillas) y refresca el listado de cartera.
export async function registrarAbonoCartera(
  numeroContrato: string,
  valor: number,
  formaPago: string,
  referencia: string
): Promise<{ ok: boolean; error?: string }> {
  if (!(valor > 0)) return { ok: false, error: "El valor debe ser mayor a 0" };
  try {
    await registrarAbono(numeroContrato, valor, formaPago, referencia);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo registrar el abono" };
  }
  revalidatePath("/dashboard/cartera");
  return { ok: true };
}
