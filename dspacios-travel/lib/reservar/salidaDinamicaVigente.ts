import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.ts";
// Imports RELATIVOS con extensión `.ts` (no `@/lib/...`), mismo criterio que
// lib/tarifario/datos.ts: este módulo lo consumen tres lugares (generar el
// tarifario, cargar las ofertas y computar la reserva) y debe poder
// ejecutarse bajo `node --test` plano en pruebas/salidaDinamicaVigencia62.test.ts.
import { hoyBogota } from "./origen.ts";

// ─────────────────────────────────────────────────────────────────────────
// Elegibilidad de una SALIDA DINÁMICA (`salidas_dinamicas`) — UNA sola regla
// para los tres puntos que antes decidían (o no decidían) por su cuenta:
//   1. generarTarifario()      → qué salidas se publican en `tarifario_resultado`.
//   2. cargarDatosTarifario()  → qué ofertas ya publicadas se siguen mostrando.
//   3. computarReserva()       → si se puede cotizar/reservar/convertir.
//
// `tarifario_resultado` es una CACHÉ: una salida desactivada, vencida o
// eliminada DESPUÉS de generar sigue teniendo filas publicadas. La fuente de
// verdad es la fila viva de `salidas_dinamicas`, leída en el momento.
//
// Una salida es elegible si y solo si TODO esto es cierto:
//   • la fila existe y es visible para quien la lee;
//   • `activo === true` (null/undefined cuenta como inactiva: fallo cerrado);
//   • `fecha_ida` es una fecha ISO válida y NO es pasada (hoy cuenta: el viaje
//     que sale hoy sigue vigente, igual que el filtro de fecha ya existente);
//   • ya abrió su ventana de compra (`compra_inicio` ≤ hoy) y no la cerró
//     (hoy ≤ `compra_fin`) — límites INCLUSIVOS, fechas `date` sin hora,
//     "hoy" en America/Bogota (`hoyBogota`), igual que `empaquetadoVigente`.
// Un error de lectura NUNCA se interpreta como "disponible".
// ─────────────────────────────────────────────────────────────────────────

export type MotivoSalidaNoVigente =
  | "no_existe"
  | "inactiva"
  | "sin_fecha_ida"
  | "compra_no_iniciada"
  | "compra_vencida"
  | "viaje_pasado"
  | "error_lectura";

/** Columnas mínimas que hacen falta para decidir (no se pide costo, tiquete ni notas). */
export const COLUMNAS_VIGENCIA_SALIDA = "id, activo, compra_inicio, compra_fin, fecha_ida";

export type SalidaParaVigencia = {
  id?: number | null;
  activo?: boolean | null;
  compra_inicio?: string | null;
  compra_fin?: string | null;
  fecha_ida?: string | null;
};

export type EvaluacionSalida =
  | { ok: true }
  | { ok: false; motivo: MotivoSalidaNoVigente; error: string };

// Mensajes de negocio ya escritos aquí (nunca texto crudo de Postgres): son
// seguros de devolver al navegador y de persistir.
const MENSAJES: Record<MotivoSalidaNoVigente, string> = {
  no_existe: "La salida seleccionada ya no existe o no está disponible.",
  inactiva: "Esta salida fue desactivada y ya no se puede reservar.",
  sin_fecha_ida: "La salida seleccionada no tiene una fecha de ida válida.",
  compra_no_iniciada: "Esta salida aún no está habilitada para compra.",
  compra_vencida: "Esta salida está fuera de su vigencia de compra.",
  viaje_pasado: "La fecha de esta salida ya pasó.",
  error_lectura: "No se pudo validar la salida seleccionada. Intenta nuevamente.",
};

export function mensajeSalidaNoVigente(motivo: MotivoSalidaNoVigente): string {
  return MENSAJES[motivo];
}

function rechazo(motivo: MotivoSalidaNoVigente): EvaluacionSalida {
  return { ok: false, motivo, error: MENSAJES[motivo] };
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Decisión PURA sobre una fila ya leída. `hoy` = fecha ISO (YYYY-MM-DD) en
 * America/Bogota (ver `hoyBogota`). La comparación de strings ISO es
 * cronológica. `null`/`undefined` = fila inexistente o invisible.
 */
export function evaluarSalidaDinamica(
  salida: SalidaParaVigencia | null | undefined,
  hoy: string
): EvaluacionSalida {
  if (!salida) return rechazo("no_existe");
  if (salida.activo !== true) return rechazo("inactiva");
  const ida = salida.fecha_ida;
  if (typeof ida !== "string" || !FECHA_ISO.test(ida)) return rechazo("sin_fecha_ida");
  if (salida.compra_inicio && hoy < salida.compra_inicio) return rechazo("compra_no_iniciada");
  if (salida.compra_fin && hoy > salida.compra_fin) return rechazo("compra_vencida");
  if (ida < hoy) return rechazo("viaje_pasado");
  return { ok: true };
}

export function salidaDinamicaVigente(salida: SalidaParaVigencia | null | undefined, hoy: string): boolean {
  return evaluarSalidaDinamica(salida, hoy).ok;
}

type Cliente = SupabaseClient<Database>;

/**
 * Valida UNA salida contra la fila viva. Debe recibir un cliente que pueda
 * LEER `salidas_dinamicas`: por RLS (migración 094) esa tabla solo la ven
 * superadmin/gerencia/administracion/operaciones, así que el camino de venta
 * (asesor `venta`, agencia B2B, visitante del checkout público) usa el cliente
 * de servicio. Con un cliente de sesión sin permiso la fila llega vacía y el
 * resultado es `no_existe` (rechazo): falla cerrado, nunca "disponible".
 */
export async function verificarSalidaDinamicaVigente(
  cliente: Cliente,
  salidaId: number,
  hoy: string = hoyBogota(new Date())
): Promise<EvaluacionSalida> {
  const { data, error } = await cliente
    .from("salidas_dinamicas")
    .select(COLUMNAS_VIGENCIA_SALIDA)
    .eq("id", salidaId)
    .maybeSingle();
  if (error) return rechazo("error_lectura");
  return evaluarSalidaDinamica(data as SalidaParaVigencia | null, hoy);
}

export type ResultadoSalidasVigentes =
  | { ok: true; vigentes: Set<number> }
  | { ok: false; error: unknown };

/**
 * Para la carga de ofertas: de un conjunto de `salida_id` publicados, cuáles
 * siguen siendo elegibles hoy. Una sola consulta. Si la consulta falla,
 * devuelve `ok:false` y el llamador DEBE ocultar todas (fallo cerrado).
 */
export async function salidasDinamicasVigentes(
  cliente: Cliente,
  salidaIds: number[],
  hoy: string = hoyBogota(new Date())
): Promise<ResultadoSalidasVigentes> {
  if (!salidaIds.length) return { ok: true, vigentes: new Set() };
  const { data, error } = await cliente
    .from("salidas_dinamicas")
    .select(COLUMNAS_VIGENCIA_SALIDA)
    .in("id", salidaIds);
  if (error) return { ok: false, error };
  const vigentes = new Set<number>();
  for (const s of (data ?? []) as SalidaParaVigencia[]) {
    if (s.id != null && evaluarSalidaDinamica(s, hoy).ok) vigentes.add(s.id);
  }
  return { ok: true, vigentes };
}

/**
 * Para generar el tarifario: de las filas ya leídas del paquete, conserva solo
 * las elegibles y cuenta cuántas se descartaron (para que el mensaje de
 * "no hay salidas" distinga entre "no hay ninguna" y "ninguna está vigente").
 */
export function seleccionarSalidasVigentes<T extends SalidaParaVigencia>(
  filas: T[],
  hoy: string = hoyBogota(new Date())
): { vigentes: T[]; descartadas: number } {
  const vigentes = filas.filter((s) => evaluarSalidaDinamica(s, hoy).ok);
  return { vigentes, descartadas: filas.length - vigentes.length };
}
