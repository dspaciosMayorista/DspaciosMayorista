/**
 * FILAS DE COMISIÓN B2B EN REVISIÓN CONTABLE (#65)
 *
 * Una fila de `aliados_b2b` presente en `comision_b2b_revision` (migración 268) no se atribuye a nadie en el portal:
 * ni da «participación», ni cuenta en el importe/estado de un contrato, ni abre la cuenta de cobro. El registro queda intacto
 * (importes, abonos y ficha no cambian). Levantar una retención es una tarea posterior (comprobante, destinatario, corrección financiera, permisos): hoy no hay forma de hacerlo desde la aplicación.
 *
 * El código NO conoce ids: la lista vive en los datos. Falla cerrado: si la lectura no es completa (incluida la tabla inexistente
 * porque la migración aún no corrió) devuelve null y quien llama no muestra comisión.
 */
import { leerTodoConConteo, PAGINA_FILAS, type PaginaConConteo } from "@/lib/auth/fichaComisionManual";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export async function filasEnRevisionB2B(admin: Admin): Promise<Set<number> | null> {
  try {
    const r = await leerTodoConConteo<{ aliado_b2b_id: number }>(
      (desde, hasta) =>
        admin
          .from("comision_b2b_revision")
          .select("aliado_b2b_id", { count: "exact" })
          .order("aliado_b2b_id", { ascending: true })
          .range(desde, hasta) as unknown as PromiseLike<PaginaConConteo<{ aliado_b2b_id: number }>>,
      PAGINA_FILAS,
      (f) => typeof f?.aliado_b2b_id === "number",
    );
    return r.completa ? new Set(r.filas.map((f) => f.aliado_b2b_id)) : null;
  } catch {
    return null;
  }
}
