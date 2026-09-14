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
// las operaciones que necesita como dependencias, así que su comportamiento
// —incluido el de FALLO— se puede ejecutar de verdad en las pruebas, sin
// base de datos.
//
// Reglas que implementa (revisión del PR #294, punto B7 — y su ronda 2, que
// encontró que la garantía de la ronda 1 era COMPENSATORIA, no durable: si
// el proceso muere entre el insert de `ventas` y esta escritura, o entre el
// fallo de esta escritura y el intento de revertir, nada quedaba detectable
// ni recuperable — ver migración 172):
//   · o quedan el costo Y todas las CxP, o no queda el contrato;
//   · nunca devuelve `ok: true` con una CxP faltante;
//   · nunca devuelve error dejando un "contrato fantasma" (numerado, visible
//     en los listados, sin costo ni obligación) — intenta revertir antes de
//     fallar (camino RÁPIDO, síncrono, mientras el proceso sigue vivo);
//   · PERO esa reversión síncrona NUNCA es la ÚNICA garantía: antes de
//     intentar el RPC financiero, el payload YA CALCULADO (costos+cxp) se
//     persiste en `contrato_financiero_pendiente` — su propio commit,
//     independiente de si el RPC financiero después tiene éxito, falla, o el
//     proceso muere sin poder ni intentarlo. Esa fila es la garantía
//     DURABLE: sobrevive a la caída del proceso, es detectable (`ventas.
//     financiero_estado='pendiente'`, consultable para siempre) y permite un
//     reintento IDEMPOTENTE exacto desde otro proceso completamente distinto
//     (`lib/reservar/reconciliacionFinanciera.ts`), sin inventar ni
//     recalcular nada — reintenta con el MISMO payload que ya se decidió
//     escribir;
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
  /**
   * Fase 3F-4B (regla E.28): moneda EXPLÍCITA de esta CxP. `registrar_
   * financiero_contrato` (migración 171) ya sabe leer esta clave del payload
   * (`coalesce(nullif(v_item->>'moneda', ''), 'COP')`) — antes ningún flujo
   * TypeScript la mandaba, así que TODA CxP caía en el default 'COP' del RPC
   * sin importar la moneda real del contrato. Persona sigue sin mandarla
   * (`undefined`, comportamiento IDÉNTICO de siempre — regla 16); un contrato
   * Bernalo en USD SIEMPRE debe mandarla explícita, nunca depender de ese
   * default.
   */
  moneda?: string;
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
  /** `admin.rpc(...)` de Supabase (service-role): las funciones de las migraciones 171/172. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  /** Devengo contable de una CxP recién creada (`postearAsientoCxP`). */
  postearAsiento: (c: CxPCreada) => Promise<{ ok: boolean; error?: string }>;
  /** Borra el asiento de una CxP que dejó de existir (`eliminarAsientoCxP`). */
  eliminarAsiento: (cuentaId: number) => Promise<unknown>;
  /**
   * Persiste el payload EN `contrato_financiero_pendiente` (migración 172),
   * en SU PROPIO commit — antes de intentar el RPC financiero. Es la
   * garantía durable: si el proceso muere justo después de esta llamada, el
   * payload sigue ahí para que otro proceso (la reconciliación) lo reintente
   * exactamente igual. Un fallo AQUÍ (no se pudo ni declarar la intención)
   * se trata como fallo de toda la operación — sin esto, no hay nada
   * recuperable si lo que sigue también falla.
   */
  guardarPendiente: (p: { numeroContrato: string; tenant: string; costos: CostosContrato; cxp: CxPFinanciera[] }) => Promise<{ ok: boolean; error?: string }>;
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
 * `revertir_contrato_incompleto` (migración 172) falla CERRADO: se niega a
 * borrar un contrato que ya tenga abonos, pagos o retenciones (ahí ya hubo
 * dinero real), y limpia TODAS sus hijas sin dejar huérfanos —incluidas
 * `aliados_b2b` y `contrato_condiciones` (esta última inmutable por trigger;
 * el RPC usa el mismo bypass que `eliminar_contrato`, migración 166, solo
 * para la ventana de ese borrado).
 *
 * Esta llamada es el camino RÁPIDO (síncrono, mientras el proceso original
 * sigue vivo) — NUNCA la única garantía: si esta llamada no llega a
 * ejecutarse (proceso caído) o falla, el contrato queda `financiero_estado
 * ='pendiente'`, detectable y recuperable por la reconciliación
 * (lib/reservar/reconciliacionFinanciera.ts) sin depender de este camino.
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

  // Garantía DURABLE, antes de intentar nada: si esto no se alcanza a
  // escribir, no hay reintento posible desde otro proceso — se trata igual
  // que un fallo del RPC financiero (revierte de una).
  const pendiente = await deps.guardarPendiente({ numeroContrato, tenant, costos, cxp });
  if (!pendiente.ok) {
    const rev = await revertirContratoIncompleto(deps, numeroContrato, tenant);
    return { ok: false, ...mensajeFallo(numeroContrato, pendiente.error ?? "no se pudo registrar la intención de escritura financiera", rev) };
  }

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
