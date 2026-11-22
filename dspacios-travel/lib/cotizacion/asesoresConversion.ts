// O-3 — lista de asesores para el selector OBLIGATORIO de la conversión. Para administración, gerencia y operaciones la RLS de `usuarios` solo deja ver el propio perfil, así que
// el selector llegaba VACÍO y no podían completar el flujo. Se les entrega una lista ESTRECHA, no acceso a usuarios: solo `nombre` y `email` (lo mismo que ya muestra el selector)
// de los usuarios `venta` ACTIVOS de la MISMA agencia que la cotización, y solo a quien ya está autorizado a abrir esa cotización (la página verifica el tenant antes de llamar aquí).
// La conversión sigue autorizándose en su propia acción; esto solo llena el selector.
import { createAdminClient } from "@/lib/supabase/admin";

export type AsesorOpcion = { nombre: string; email: string | null };

/** Roles que convierten sin ser el asesor ni superadmin (superadmin ya lee `usuarios` por RLS; `venta` se asigna a sí mismo). */
export const ROLES_QUE_ELIGEN_ASESOR = ["gerencia", "administracion", "operaciones"] as const;

/** Decisión pura: ¿se le entrega la lista estrecha a este usuario para esta cotización? Activo, rol permitido y MISMA agencia que la cotización. */
export function puedeListarAsesores(usuario: { rol: string | null; activo: boolean | null; tenant: string | null } | null, tenantCotizacion: string | null): boolean {
  return !!usuario && usuario.activo === true && !!tenantCotizacion && usuario.tenant === tenantCotizacion
    && (ROLES_QUE_ELIGEN_ASESOR as readonly string[]).includes(usuario.rol ?? "");
}

/** Asesores `venta` activos de una agencia. Solo nombre y correo; nada más del usuario sale de aquí. */
export async function asesoresDeAgencia(tenant: string): Promise<AsesorOpcion[]> {
  const { data } = await createAdminClient() // identidad:n/a — solo lectura de nombres de asesores
    .from("usuarios").select("nombre, email").eq("rol", "venta").eq("activo", true).eq("tenant", tenant).order("nombre");
  return (data ?? []).map((u) => ({ nombre: u.nombre as string, email: (u.email as string | null) ?? null }));
}
