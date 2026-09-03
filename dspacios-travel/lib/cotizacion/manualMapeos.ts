// ─────────────────────────────────────────────────────────────────────────
// Mapeos de la cotización DINÁMICA/manual → contrato (Commit 5).
//
// Son lógica PURA (sin "use server", sin I/O) y se mantienen como el canon de
// referencia para la equivalencia TS↔SQL: desde el Commit 5 la conversión a
// contrato es ATÓMICA en la BD (RPC `convertir_cotizacion_a_contrato`, migración
// 164) y esta Server Action ya no arma la venta/hijas en el navegador — así que
// estos mapeos ya NO los consume el flujo en vivo. Se conservan aquí, exportados,
// para que la prueba comparativa del Commit 5 (#40) pueda verificar que el espejo
// SQL (`_tipo_proveedor_cxp`/`_cuentas_cxp`/`_etiqueta` en la 164) sigue
// idéntico a lo que el builder manual producía antes de la atomicidad. NO
// importarlos desde el flujo de reserva/conversión en vivo.
// ─────────────────────────────────────────────────────────────────────────

// Tipo de servicio de la cotización dinámica → tipo de proveedor de la CxP.
// Espejo SQL: `_tipo_proveedor_cxp(p_tipo_servicio)` en la migración 164.
export const TIPO_PROVEEDOR: Record<string, string> = {
  aereo: "aereo",
  hotel: "hotel",
  traslado: "receptivo",
  asistencia: "asistencia",
  otro: "otro",
};

// Etiqueta legible de cada tipo de servicio, usada en el `servicio` de la CxP
// ("Aéreo · …", "Hotel · …"). Espejo SQL: `_etiqueta_tipo` (definido en la 164).
export const TIPO_LABEL: Record<string, string> = {
  aereo: "Aéreo",
  hotel: "Hotel",
  traslado: "Traslado",
  asistencia: "Asistencia médica",
  otro: "Otro",
};

// Recuadros "Hoteles y Servicios" que se estampan en la venta convertida, según
// los servicios elegidos: hotel → plan_nombre, traslado → tours_traslados,
// asistencia → asistencia_medica. Lo replica el RPC a partir de
// `cotizacion_servicios` en la misma conversión.
export function cajasDesdeServicios(servs: { tipo_servicio: string; nombre_servicio: string | null }[]) {
  const nombres = (t: string) =>
    servs.filter((s) => s.tipo_servicio === t).map((s) => (s.nombre_servicio || "").trim()).filter(Boolean);
  return {
    asistencia_medica: servs.some((s) => s.tipo_servicio === "asistencia"),
    plan_nombre: nombres("hotel").join(", ") || null,
    tours_traslados: nombres("traslado").join(", ") || null,
  };
}
