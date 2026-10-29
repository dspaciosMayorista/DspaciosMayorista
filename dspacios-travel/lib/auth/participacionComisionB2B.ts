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
 * Solo cuenta una comisión ECONÓMICA: la misma definición del cálculo del portal
 * (`calcularComisionFila(...).totalPagar > 0`). Una fila sin base, porcentaje, valor ni
 * recobro (p. ej. un registro administrativo en 0) no da visibilidad de participación.
 *
 * Service-role: la autorización es el `.eq("aliado_id", ...)` exacto por la
 * ficha del usuario (nunca nombre). Fail-closed: si una lectura queda
 * incompleta no se lista nada de este tipo y se avisa.
 */
import { leerTodoConConteo, PAGINA_FILAS, type PaginaConConteo } from "@/lib/auth/fichaComisionManual";
import { calcularComisionFila, type FilaComisionB2B } from "@/lib/finanzas/comisionB2B";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type FilaParticipacion = { numero_contrato: string; [k: string]: unknown };

const LOTE = 100;

/** Columnas que necesita el cálculo de comisión (las mismas de lib/finanzas/comisionPortal.ts). */
const COLUMNAS_COMISION =
  "id, numero_contrato, aliado_id, precio_venta, base_comision, base_explicita, comision_valor, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion";

export async function contratosPorParticipacion(
  admin: Admin,
  aliadoId: number | null,
  columnas: string,
  excluir: ReadonlySet<string>,
): Promise<{ filas: FilaParticipacion[]; completa: boolean }> {
  if (aliadoId == null) return { filas: [], completa: true };

  const comisiones = await leerTodoConConteo<FilaComisionB2B>(
    (desde, hasta) =>
      admin
        .from("aliados_b2b")
        .select(COLUMNAS_COMISION, { count: "exact" })
        .eq("aliado_id", aliadoId)
        .order("id", { ascending: true })
        .range(desde, hasta) as unknown as PromiseLike<PaginaConConteo<FilaComisionB2B>>,
    PAGINA_FILAS,
    (f) => typeof f?.numero_contrato === "string" && f.numero_contrato !== ""
  );
  if (!comisiones.completa) return { filas: [], completa: false };

  const economicas = comisiones.filas.filter((f) => calcularComisionFila(f).totalPagar > 0);
  const nums = [...new Set(economicas.map((f) => f.numero_contrato))].filter((n) => !excluir.has(n));
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
