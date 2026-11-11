// Lógica PURA (sin I/O) de `numeracion.ts` — separada para poder probarla con
// `node --test` sin depender de Supabase. Decide qué le llega al llamador a
// partir de la respuesta cruda del RPC `siguiente_numero_contrato_para_tenant`
// (migración 159): nunca expone `error.message` tal cual (podría nombrar la
// función, la secuencia o el motivo interno del rechazo — permission denied,
// SQLSTATE, etc.) — el detalle técnico se registra aparte, server-side, y aquí
// solo se decide el mensaje FIJO que sí es seguro mostrar.
export type SiguienteNumeroResult =
  | { ok: true; numero: string; reservaToken?: string | null }
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

// Migración 287: `reservar_numero_contrato` devuelve una fila { numero, token }. Mayorista puede
// entregar un DTM liberado (token = ticket de la reserva, que el INSERT de `ventas` debe presentar)
// o uno nuevo de la secuencia (token nulo); Minorista siempre token nulo. Mismas reglas de
// seguridad que arriba: nunca se propaga el mensaje crudo del error, y un error manda sobre
// cualquier dato parcial.
export function interpretarReservaNumeroContrato(
  data: ReadonlyArray<{ numero?: string | null; token?: string | null }> | null | undefined,
  error: { message: string } | null | undefined
): SiguienteNumeroResult {
  const fila = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (error || !fila || !fila.numero) return { ok: false, error: MENSAJE_ERROR_NUMERO_CONTRATO };
  return { ok: true, numero: fila.numero, reservaToken: fila.token ?? null };
}
