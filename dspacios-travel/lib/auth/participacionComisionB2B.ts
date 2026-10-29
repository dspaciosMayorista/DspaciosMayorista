/**
 * CONTRATOS EN LOS QUE EL ALIADO SOLO PARTICIPA POR COMISIÓN (#65)
 *
 * Un contrato histórico puede tener `ventas.aliado_id` vacío y, aun así, una
 * comisión cargada en `aliados_b2b` con `aliado_id` = ficha del aliado. Y una
 * misma venta puede tener comisiones de más de un aliado. Por eso la comisión
 * NO hace dueño del contrato: ni se escribe en `ventas.aliado_id` (el vínculo
 * singular queda intacto) ni se pasa por `accesoDocumentoContrato`.
 *
 * Esta función solo dice «existen estos contratos donde cobras una comisión».
 * El portal los muestra como «participación» (sin cliente, pagos ni documentos
 * del contrato). La propiedad sigue decidiéndola `contratosDelPortalB2B`.
 *
 * Service-role: la autorización es el `.eq("aliado_id", ...)` exacto por la
 * ficha del usuario (nunca nombre). Fail-closed: si una lectura queda
 * incompleta no se lista nada de este tipo y se avisa.
 */
import { leerTodoConConteo, PAGINA_FILAS, type PaginaConConteo } from "@/lib/auth/fichaComisionManual";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type FilaParticipacion = { numero_contrato: string; [k: string]: unknown };

const LOTE = 100;

export async function contratosPorParticipacion(
  admin: Admin,
  aliadoId: number | null,
  columnas: string,
  excluir: ReadonlySet<string>,
): Promise<{ filas: FilaParticipacion[]; completa: boolean }> {
  if (aliadoId == null) return { filas: [], completa: true };

  const comisiones = await leerTodoConConteo<{ numero_contrato: string }>(
    (desde, hasta) =>
      admin
        .from("aliados_b2b")
        .select("numero_contrato", { count: "exact" })
        .eq("aliado_id", aliadoId)
        .order("id", { ascending: true })
        .range(desde, hasta) as unknown as PromiseLike<PaginaConConteo<{ numero_contrato: string }>>,
    PAGINA_FILAS,
    (f) => typeof f?.numero_contrato === "string" && f.numero_contrato !== ""
  );
  if (!comisiones.completa) return { filas: [], completa: false };

  const nums = [...new Set(comisiones.filas.map((f) => f.numero_contrato))].filter((n) => !excluir.has(n));
  const filas: FilaParticipacion[] = [];
  for (let i = 0; i < nums.length; i += LOTE) {
    const lote = nums.slice(i, i + LOTE);
    const pedidos = new Set(lote);
    const r = await leerTodoConConteo<FilaParticipacion>(
      (desde, hasta) =>
        admin
          .from("ventas")
          .select(columnas, { count: "exact" })
          .in("numero_contrato", lote)
          .order("numero_contrato", { ascending: true })
          .range(desde, hasta) as unknown as PromiseLike<PaginaConConteo<FilaParticipacion>>,
      PAGINA_FILAS,
      (f) => typeof f?.numero_contrato === "string" && pedidos.has(f.numero_contrato)
    );
    if (!r.completa) return { filas: [], completa: false };
    filas.push(...r.filas);
  }
  return { filas, completa: true };
}
