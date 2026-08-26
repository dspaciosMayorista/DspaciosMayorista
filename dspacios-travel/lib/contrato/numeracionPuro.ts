// Lógica PURA (sin I/O) de `numeracion.ts` — separada para poder probarla con
// `node --test` sin depender de Supabase. Decide qué le llega al llamador a
// partir de la respuesta cruda del RPC `siguiente_numero_contrato_para_tenant`
// (migración 159): nunca expone `error.message` tal cual (podría nombrar la
// función, la secuencia o el motivo interno del rechazo — permission denied,
// SQLSTATE, etc.) — el detalle técnico se registra aparte, server-side, y aquí
// solo se decide el mensaje FIJO que sí es seguro mostrar.
export type SiguienteNumeroResult =
  | { ok: true; numero: string }
  | { ok: false; error: string };

export const MENSAJE_ERROR_NUMERO_CONTRATO =
  "No se pudo generar el número de contrato. Intenta de nuevo o contacta a soporte.";

export function interpretarRespuestaNumeroContrato(
  data: string | null | undefined,
  error: { message: string } | null | undefined
): SiguienteNumeroResult {
  if (error || !data) return { ok: false, error: MENSAJE_ERROR_NUMERO_CONTRATO };
  return { ok: true, numero: data };
}
