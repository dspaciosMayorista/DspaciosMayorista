import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { filtrarTarifarioVencidas, type ResultadoVigencia } from "./vigencia.ts";
import { hoyISO } from "../calc/paquetes.ts";
import { empaquetadoVigente, hoyBogota } from "../reservar/origen.ts";

// Los 3 filtros "post-carga" que `cargarDatosTarifario()` (lib/tarifario/
// datos.ts) siempre aplicó DESPUÉS de traer las filas crudas, y que la carga
// en dos niveles (lib/tarifario/resumen.ts, app/tarifario/detalle-actions.ts)
// también debe aplicar — tanto al resumen (Tier 1) como al detalle bajo
// demanda (Tier 2) — para que ninguno de los dos publique una tarifa que el
// otro ya sabría inválida:
//   1. Vigencia de COMPRA por hotel+categoría+régimen (`filtrarTarifarioVencidas`).
//   2. Salidas de bloqueo/dinámico cuya fecha de ida YA PASÓ.
//   3. Empaquetados desactivados o fuera de vigencia de compra.
// Factorizado UNA sola vez (antes vivía repetido dentro de
// `cargarDatosTarifario`); ahora lo comparten los 3 caminos que leen
// `tarifario_resultado`/`tarifario_resumen`, para que una futura regla nueva
// de vigencia no tenga que actualizarse en 3 lugares por separado.

type FilaFiltrable = {
  modulo: string;
  hotel_id?: number | null;
  categoria?: string | null;
  regimen?: string | null;
  fecha_ida?: string | null;
  fecha_regreso?: string | null;
  noches?: number | null;
  empaquetado_id?: number | null;
};

export type ResultadoFiltrosPostCarga<T> = {
  filas: T[];
  errorVigencia: unknown;
  errorEmpaquetado: unknown;
};

export async function aplicarFiltrosPostCarga<T extends FilaFiltrable>(
  admin: SupabaseClient<Database> | null,
  filasIniciales: T[]
): Promise<ResultadoFiltrosPostCarga<T>> {
  let filas = filasIniciales;
  let resVigencia: ResultadoVigencia<T> | null = null;

  if (admin) {
    resVigencia = await filtrarTarifarioVencidas(admin, filas);
    filas = resVigencia.filas;
  }

  const hoyTarifa = hoyISO();
  filas = filas.filter((f) => (f.modulo !== "bloqueo" && f.modulo !== "dinamico") || !f.fecha_ida || f.fecha_ida >= hoyTarifa);

  const empaquetadoIds = [...new Set(
    filas.filter((f) => f.empaquetado_id != null).map((f) => f.empaquetado_id as number)
  )];
  let errorEmpaquetado: unknown = null;
  if (empaquetadoIds.length) {
    if (!admin) {
      filas = filas.filter((f) => f.empaquetado_id == null);
    } else {
      const { data: emps, error: empsError } = await admin
        .from("empaquetados")
        .select("id, activo, compra_inicio, compra_fin")
        .in("id", empaquetadoIds);
      errorEmpaquetado = empsError;
      const hoyEmp = hoyBogota(new Date());
      const vigentes = empsError
        ? new Set<number>()
        : new Set(
            (emps ?? [])
              .filter((e) => e.activo && empaquetadoVigente(e.compra_inicio, e.compra_fin, hoyEmp))
              .map((e) => e.id)
          );
      filas = filas.filter((f) => f.empaquetado_id == null || vigentes.has(f.empaquetado_id));
    }
  }

  return { filas, errorVigencia: resVigencia?.error ?? null, errorEmpaquetado };
}
