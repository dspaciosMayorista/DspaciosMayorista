"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getTenant } from "@/lib/tenant.server";

type Result = { ok: true } | { ok: false; error: string };
type Naturaleza = "debito" | "credito";

export type Cuenta = {
  id: number;
  codigo: string;
  nombre: string;
  nivel: number;
  padre_id: number | null;
  naturaleza: string;
  permite_movimiento: boolean;
  activa: boolean;
};

export async function listarCuentas(): Promise<{ ok: true; cuentas: Cuenta[] } | { ok: false; error: string }> {
  const sb = await createClient();
  const tenant = await getTenant();
  const { data, error } = await sb
    .from("puc_cuentas")
    .select("id, codigo, nombre, nivel, padre_id, naturaleza, permite_movimiento, activa")
    .eq("tenant", tenant)
    .order("codigo");
  if (error) return { ok: false, error: error.message };
  return { ok: true, cuentas: (data ?? []) as Cuenta[] };
}

export async function crearCuenta(input: {
  codigo: string;
  nombre: string;
  padreId: number | null;
  naturaleza: Naturaleza;
  permiteMovimiento: boolean;
}): Promise<Result> {
  const codigo = input.codigo.trim();
  if (!codigo) return { ok: false, error: "El código es obligatorio." };
  if (!/^\d+$/.test(codigo)) return { ok: false, error: "El código solo debe tener dígitos (ej. 110505)." };
  if (!input.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };

  const sb = await createClient();
  const tenant = await getTenant();

  let nivel = 1;
  if (input.padreId) {
    const { data: padre } = await sb.from("puc_cuentas").select("nivel, codigo").eq("id", input.padreId).eq("tenant", tenant).maybeSingle();
    if (!padre) return { ok: false, error: "Cuenta madre no encontrada." };
    if (!codigo.startsWith(padre.codigo)) return { ok: false, error: `El código debe empezar con el de la cuenta madre (${padre.codigo}).` };
    nivel = padre.nivel + 1;
  }

  const { error } = await sb.from("puc_cuentas").insert({
    tenant, codigo, nombre: input.nombre.trim(), nivel,
    padre_id: input.padreId, naturaleza: input.naturaleza, permite_movimiento: input.permiteMovimiento,
  });
  if (error) {
    return { ok: false, error: error.message.includes("duplicate") || error.message.includes("unique") ? "Ya existe una cuenta con ese código." : error.message };
  }
  revalidatePath("/dashboard/contabilidad/plan-cuentas");
  return { ok: true };
}

export async function actualizarCuenta(id: number, input: {
  codigo: string; nombre: string; naturaleza: Naturaleza; permiteMovimiento: boolean; activa: boolean;
}): Promise<Result> {
  const codigo = input.codigo.trim();
  if (!codigo) return { ok: false, error: "El código es obligatorio." };
  if (!input.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const sb = await createClient();
  const { error } = await sb.from("puc_cuentas").update({
    codigo, nombre: input.nombre.trim(), naturaleza: input.naturaleza,
    permite_movimiento: input.permiteMovimiento, activa: input.activa,
  }).eq("id", id);
  if (error) {
    return { ok: false, error: error.message.includes("duplicate") || error.message.includes("unique") ? "Ya existe una cuenta con ese código." : error.message };
  }
  revalidatePath("/dashboard/contabilidad/plan-cuentas");
  return { ok: true };
}

export async function eliminarCuenta(id: number): Promise<Result> {
  const sb = await createClient();
  const { count: hijos } = await sb.from("puc_cuentas").select("id", { count: "exact", head: true }).eq("padre_id", id);
  if ((hijos ?? 0) > 0) return { ok: false, error: "Esta cuenta tiene subcuentas — elimínalas primero o desactívala en vez de borrarla." };
  const { count: movs } = await sb.from("asiento_lineas").select("id", { count: "exact", head: true }).eq("cuenta_id", id);
  if ((movs ?? 0) > 0) return { ok: false, error: "Esta cuenta ya tiene movimientos en el libro diario — no se puede eliminar, desactívala." };
  const { error } = await sb.from("puc_cuentas").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contabilidad/plan-cuentas");
  return { ok: true };
}
