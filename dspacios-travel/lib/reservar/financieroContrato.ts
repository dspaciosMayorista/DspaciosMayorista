// ─────────────────────────────────────────────────────────────────────────
// ESCRITURA FINANCIERA DEL CONTRATO — costo + cuentas por pagar, en una sola
// transacción, con reversión si falla.
//
// Antes, los flujos de creación (`reservarDesdeTarifarioInterno`,
// `convertirCotizacionCarrito`) creaban el contrato y DESPUÉS escribían el
// costo y las CxP en varias llamadas sueltas envueltas en `try/catch`. Si una
// fallaba, la operación devolvía ÉXITO con el contrato creado y la obligación
// con el proveedor inexistente: un contrato que se ve normal pero cuya deuda
// no está registrada en ninguna parte (rentabilidad inflada, proveedor sin
// cuenta por pagar, nada que avise). `try/catch` + logging no es una
// garantía; una transacción sí.
//
// Este módulo orquesta esa garantía y es PURO respecto de Supabase: recibe
// las tres operaciones que necesita (`rpc`, `postearAsiento`,
// `eliminarAsiento`) como dependencias, así que su comportamiento —incluido
// el de FALLO— se puede ejecutar de verdad en las pruebas, sin base de datos.
//
// Reglas que implementa (revisión del PR #294, punto B7):
//   · o quedan el costo Y todas las CxP, o no queda el contrato;
//   · nunca devuelve `ok: true` con una CxP faltante;
//   · nunca devuelve error dejando un "contrato fantasma" (numerado, visible
//     en los listados, sin costo ni obligación) — revierte antes de fallar;
//   · un reintento no duplica: el RPC reemplaza las CxP automáticas previas y
//     devuelve sus ids para que acá se borren TAMBIÉN sus asientos contables
//     (que viven fuera de la transacción, referenciados por `cxp:<id>`).
// ─────────────────────────────────────────────────────────────────────────

/** Fila de `cuentas_por_pagar` tal como la arman los flujos de creación. */
export type CxPFinanciera = {
  proveedor: string | null;
  tipo_proveedor: string;
  servicio: string;
  valor_total: number;
  fecha_obligacion: string;
  aplica_retencion: boolean;
  pct_retencion: number;
  observaciones: string;
  /** Migración 170 — vínculo durable con el servicio del catálogo (hotel/aéreo van en null). */
  servicio_id: number | null;
};

/** Columnas de costo de `ventas`. Solo se escriben las claves presentes. */
export type CostosContrato = {
  costo_hotel?: number;
  costo_aereo?: number;
  costo_receptivo?: number;
  costo_asistencia?: number;
  otros_costos?: number;
};

/** CxP ya creada, tal como la devuelve el RPC (para postear su asiento). */
export type CxPCreada = {
  id: number;
  tipo_proveedor: string | null;
  proveedor: string | null;
  servicio: string | null;
  valor_total: number;
};

export type DepsFinanciero = {
  /** `admin.rpc(...)` de Supabase (service-role): las dos funciones de la migración 171. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  /** Devengo contable de una CxP recién creada (`postearAsientoCxP`). */
  postearAsiento: (c: CxPCreada) => Promise<{ ok: boolean; error?: string }>;
  /** Borra el asiento de una CxP que dejó de existir (`eliminarAsientoCxP`). */
  eliminarAsiento: (cuentaId: number) => Promise<unknown>;
};

export type ResultadoFinanciero =
  | { ok: true; creadas: CxPCreada[]; avisos: string[] }
  | { ok: false; error: string; revertido: boolean };

/** Parsea la respuesta del RPC sin confiar en su forma (viene como jsonb). */
function leerRespuesta(data: unknown): { creadas: CxPCreada[]; eliminadas: number[] } {
  const raw = (data ?? {}) as { creadas?: unknown; eliminadas?: unknown };
  const creadas: CxPCreada[] = [];
  for (const c of Array.isArray(raw.creadas) ? raw.creadas : []) {
    const f = (c ?? {}) as Record<string, unknown>;
    const id = Number(f.id);
    if (!Number.isFinite(id)) continue;
    creadas.push({
      id,
      tipo_proveedor: f.tipo_proveedor == null ? null : String(f.tipo_proveedor),
      proveedor: f.proveedor == null ? null : String(f.proveedor),
      servicio: f.servicio == null ? null : String(f.servicio),
      valor_total: Number(f.valor_total) || 0,
    });
  }
  const eliminadas = (Array.isArray(raw.eliminadas) ? raw.eliminadas : [])
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));
  return { creadas, eliminadas };
}

/**
 * Deshace un contrato recién creado cuya escritura financiera falló, para que
 * el error no deje un contrato fantasma. Devuelve `true` si el contrato ya no
 * existe (o nunca existió); `false` si la reversión misma falló — ahí el
 * llamador tiene que DECIRLO, no tragárselo: quedó un contrato incompleto que
 * necesita revisión humana.
 *
 * `revertir_contrato_incompleto` falla CERRADO: se niega a borrar un contrato
 * que ya tenga abonos, pagos o retenciones (ahí ya hubo dinero real).
 */
export async function revertirContratoIncompleto(
  deps: Pick<DepsFinanciero, "rpc">,
  numeroContrato: string,
  tenant: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await deps.rpc("revertir_contrato_incompleto", {
      p_numero_contrato: numeroContrato,
      p_tenant: tenant,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "error desconocido" };
  }
}

/** Mensaje final cuando la escritura financiera falló, según si se pudo revertir. */
function mensajeFallo(numeroContrato: string, motivo: string, rev: { ok: boolean; error?: string }): { error: string; revertido: boolean } {
  if (rev.ok) {
    return {
      error: `No se pudo registrar el costo ni las cuentas por pagar del contrato, así que no se generó: ${motivo}. Corrige el problema e inténtalo de nuevo.`,
      revertido: true,
    };
  }
  // Peor caso: falló la escritura financiera Y falló deshacer. Nunca se
  // reporta éxito y NUNCA se calla: el número queda nombrado para que alguien
  // lo revise.
  return {
    error: `No se pudo registrar el costo ni las cuentas por pagar (${motivo}) y tampoco se pudo deshacer el contrato ${numeroContrato} automáticamente (${rev.error ?? "motivo desconocido"}). Revísalo antes de volver a intentarlo.`,
    revertido: false,
  };
}

/**
 * Escribe los costos y TODAS las cuentas por pagar del contrato en una sola
 * transacción (`registrar_financiero_contrato`, migración 171) y postea el
 * asiento de cada CxP creada. Si la transacción falla, revierte el contrato y
 * devuelve error: nunca `ok: true` con costo/CxP faltante, nunca un contrato
 * fantasma.
 */
export async function registrarFinancieroContrato(
  deps: DepsFinanciero,
  params: {
    numeroContrato: string;
    tenant: string;
    costos: CostosContrato;
    cxp: CxPFinanciera[];
    fecha: string;
  }
): Promise<ResultadoFinanciero> {
  const { numeroContrato, tenant, costos, cxp, fecha } = params;

  let data: unknown;
  try {
    const res = await deps.rpc("registrar_financiero_contrato", {
      p_numero_contrato: numeroContrato,
      p_tenant: tenant,
      p_costos: costos,
      p_cxp: cxp,
    });
    if (res.error) {
      const rev = await revertirContratoIncompleto(deps, numeroContrato, tenant);
      return { ok: false, ...mensajeFallo(numeroContrato, res.error.message, rev) };
    }
    data = res.data;
  } catch (e) {
    const motivo = e instanceof Error ? e.message : "error desconocido";
    const rev = await revertirContratoIncompleto(deps, numeroContrato, tenant);
    return { ok: false, ...mensajeFallo(numeroContrato, motivo, rev) };
  }

  const { creadas, eliminadas } = leerRespuesta(data);

  // Control de coherencia: el RPC tiene que haber creado UNA fila por cada
  // CxP enviada. Si no coinciden, no se reporta éxito a medias — se revierte.
  if (creadas.length !== cxp.length) {
    const rev = await revertirContratoIncompleto(deps, numeroContrato, tenant);
    return {
      ok: false,
      ...mensajeFallo(numeroContrato, `se esperaban ${cxp.length} cuentas por pagar y se registraron ${creadas.length}`, rev),
    };
  }

  const avisos: string[] = [];
  // Asientos de las CxP que el reintento reemplazó: viven fuera de la
  // transacción, así que se borran acá o el costo quedaría dos veces en el
  // libro diario.
  for (const id of eliminadas) {
    try {
      await deps.eliminarAsiento(id);
    } catch (e) {
      avisos.push(`No se pudo borrar el asiento de la cuenta por pagar ${id} reemplazada: ${e instanceof Error ? e.message : "error desconocido"}.`);
    }
  }

  // Devengo contable de cada CxP nueva. El espejo contable es BEST-EFFORT por
  // convención de todo el proyecto (lib/contabilidad/asientos.ts: "la acción
  // de negocio nunca debe fallar por un problema de contabilidad", ej. una
  // cuenta del PUC renombrada) — pero el DINERO (costo + CxP) ya quedó
  // escrito de forma atómica arriba, que es lo que no puede faltar. Los
  // fallos se devuelven como avisos, nunca se pierden en silencio.
  for (const c of creadas) {
    try {
      const r = await deps.postearAsiento(c);
      if (!r.ok) avisos.push(`No se pudo generar el asiento contable de "${c.servicio ?? "costo"}": ${r.error ?? "motivo desconocido"}.`);
    } catch (e) {
      avisos.push(`No se pudo generar el asiento contable de "${c.servicio ?? "costo"}": ${e instanceof Error ? e.message : "error desconocido"}.`);
    }
  }

  void fecha; // la fecha de obligación viaja dentro de cada fila de `cxp`.
  return { ok: true, creadas, avisos };
}
