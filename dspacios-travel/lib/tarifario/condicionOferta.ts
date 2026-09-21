// ─────────────────────────────────────────────────────────────────────────
// Combinación ternaria de evidencia HOTEL + PAQUETE para una condición de
// pago / restricción comercial de UNA oferta. Reutilizado por:
//   - `lib/tarifario/resumen.ts` (exploración: rango genérico de fechas del
//     paquete contra `hotel_temporadas` + `armado_paquetes`);
//   - `app/tarifario/VistaBooking.tsx` (búsqueda: `BusquedaResultado.condicion`,
//     ya resuelta por el motor para la fecha EXACTA buscada, + `armado_paquetes`).
//
// Cada lado (hotel, paquete) es un valor TERNARIO — nunca solo booleano:
//   - `true`  = evidencia POSITIVA (hay condición/restricción real).
//   - `false` = evidencia NEGATIVA CONOCIDA (se verificó y es neutra).
//   - `null`  = DESCONOCIDO (no hay dato para decidir ninguna de las dos).
//
// Regla de combinación (independiente para el eje "condición" y el eje
// "política/restricción" — nunca se mezclan entre sí):
//   1. Evidencia positiva en CUALQUIER lado -> resultado POSITIVO. Un
//      paquete restringido demuestra restricción aunque el hotel sea
//      desconocido; un hotel con condición real la demuestra aunque el
//      paquete sea neutro. La evidencia positiva de un lado NUNCA se anula
//      por el desconocimiento del otro.
//   2. AMBOS lados conocidos y AMBOS neutros -> resultado NEGATIVO conocido
//      ("sin condición"/"flexible"). Hace falta que los DOS confirmen
//      neutralidad — un paquete neutro no basta para declarar "sin
//      condición" mientras el hotel siga siendo desconocido.
//   3. Cualquier otro caso (algún lado desconocido, sin evidencia positiva
//      en ninguno) -> DESCONOCIDO. Nunca se inventa una neutralidad que no
//      se pudo verificar en los dos lados.
// ─────────────────────────────────────────────────────────────────────────

/** Evidencia de UN lado (hotel o paquete) para UN eje (condición o política). */
export type EvidenciaTernaria = boolean | null;

export function combinarTernario(hotel: EvidenciaTernaria, paquete: EvidenciaTernaria): EvidenciaTernaria {
  if (hotel === true || paquete === true) return true;
  if (hotel === false && paquete === false) return false;
  return null;
}

/** Traduce el resultado ternario del eje "condición" a las etiquetas de `ItemResto`. */
export function etiquetaCondicion(tri: EvidenciaTernaria): "con" | "sin" | "desconocido" {
  if (tri == null) return "desconocido";
  return tri ? "con" : "sin";
}

/** Traduce el resultado ternario del eje "política/restricción" a las etiquetas de `ItemResto`. */
export function etiquetaPolitica(tri: EvidenciaTernaria): "flexible" | "no_reembolsable" | "desconocido" {
  if (tri == null) return "desconocido";
  return tri ? "no_reembolsable" : "flexible";
}
