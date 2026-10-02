"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { miRol, puedeEscribir } from "@/lib/roles";

type Result = { ok: true } | { ok: false; error: string };

// Candado de interfaz (mensaje temprano). El candado REAL está dentro de las
// funciones `aprobar_solicitud_b2b` / `rechazar_solicitud_b2b` (migración 193),
// que se llaman con la sesión de quien aprueba —no con service-role— y vuelven
// a exigir el rol con `mi_rol()`.
async function puedeAprobar(): Promise<boolean> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return false;
  return puedeEscribir("b2b", await miRol());
}

// Mensaje para la pantalla: los errores esperables de la RPC ya vienen
// redactados en español (estado no pendiente, correo distinto, cuenta que no
// es un aliado pendiente…). Cualquier otro se resume sin filtrar detalles.
function mensajeRpc(error: { code?: string; message?: string } | null): string {
  if (!error) return "No se pudo completar la operación.";
  if (error.code === "42501") return "No tienes permiso para gestionar registros B2B.";
  if (["55000", "22023", "P0002"].includes(error.code ?? "")) return error.message ?? "Operación no permitida.";
  return "No se pudo completar la operación. Intenta de nuevo.";
}

// Aprueba el registro y, en el mismo paso, ENLAZA el login con su ficha del
// catálogo `aliados` (migración 143). Todo ocurre en UNA transacción de la base
// (migración 193): exige solicitud pendiente, identifica la cuenta por
// `usuario_id` (nunca por correo), verifica que el correo coincida y que sea un
// aliado B2B inactivo, y comprueba filas afectadas; si algo falla no se activa
// nada ni se marca aprobada, y una segunda aprobación falla.
//
// `aliadoId` lo decide QUIEN APRUEBA (aprobación manual, decisión del dueño):
// el registro solo deja una sugerencia por coincidencia de documento.
//   · aliadoId: number    → enlaza con esa ficha
//   · aliadoId: "nueva"   → crea la ficha con los datos de la solicitud
//   · aliadoId: null      → aprueba SIN enlazar: sin ficha y sin respaldo por
//                           nombre (no ve contratos históricos)
//   · aliadoId: undefined → usa la sugerencia del registro, si la hay
export async function aprobarSolicitudB2B(
  id: number,
  aliadoId?: number | "nueva" | null
): Promise<Result> {
  if (!(await puedeAprobar())) return { ok: false, error: "No tienes permiso para aprobar registros B2B." };

  const modo =
    aliadoId === "nueva" ? "nueva"
    : aliadoId === null ? "ninguno"
    : typeof aliadoId === "number" ? "ficha"
    : "sugerido";
  if (modo === "ficha" && !(Number.isInteger(aliadoId) && (aliadoId as number) > 0)) {
    return { ok: false, error: "La ficha de aliado elegida no es válida." };
  }

  const sb = await createClient();
  const { error } = await sb.rpc("aprobar_solicitud_b2b", {
    p_id: id,
    p_modo: modo,
    p_aliado_id: modo === "ficha" ? (aliadoId as number) : null,
  });
  if (error) return { ok: false, error: mensajeRpc(error) };
  revalidatePath("/dashboard/usuarios/b2b");
  return { ok: true };
}

export async function rechazarSolicitudB2B(id: number): Promise<Result> {
  if (!(await puedeAprobar())) return { ok: false, error: "No tienes permiso para gestionar registros B2B." };
  const sb = await createClient();
  const { error } = await sb.rpc("rechazar_solicitud_b2b", { p_id: id });
  if (error) return { ok: false, error: mensajeRpc(error) };
  revalidatePath("/dashboard/usuarios/b2b");
  return { ok: true };
}
