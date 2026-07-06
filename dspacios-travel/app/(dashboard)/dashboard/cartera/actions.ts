"use server";

import { revalidatePath } from "next/cache";
import { registrarAbono, actualizarAbono, eliminarAbono } from "../contratos/actions";

// Registra un abono del cliente desde el módulo de Cartera (listado central).
// Reutiliza la regla de negocio canónica de `registrarAbono` (un abono confirma
// la venta pendiente y sus sillas) y refresca el listado de cartera.
export async function registrarAbonoCartera(
  numeroContrato: string,
  valor: number,
  formaPago: string,
  referencia: string,
  trm?: number,   // TRM del día (contratos en USD)
  fecha?: string, // fecha del abono (por defecto hoy)
): Promise<{ ok: boolean; error?: string }> {
  if (!(valor > 0)) return { ok: false, error: "El valor debe ser mayor a 0" };
  const r = await registrarAbono(numeroContrato, valor, formaPago, referencia, trm, fecha);
  if (!r.ok) return r;
  revalidatePath("/dashboard/cartera");
  return { ok: true };
}

// Corrige un abono ya registrado desde Cartera (mismo motivo: evitar tener que
// registrar un segundo abono para "cuadrar" un error de digitación).
export async function actualizarAbonoCartera(
  id: number,
  numeroContrato: string,
  input: { valor: number; fecha: string; formaPago: string; referencia: string; trmInput?: number }
): Promise<{ ok: boolean; error?: string }> {
  const r = await actualizarAbono(id, numeroContrato, input);
  if (!r.ok) return r;
  revalidatePath("/dashboard/cartera");
  return { ok: true };
}

export async function eliminarAbonoCartera(id: number, numeroContrato: string): Promise<{ ok: boolean; error?: string }> {
  const r = await eliminarAbono(id, numeroContrato);
  if (!r.ok) return r;
  revalidatePath("/dashboard/cartera");
  return { ok: true };
}
