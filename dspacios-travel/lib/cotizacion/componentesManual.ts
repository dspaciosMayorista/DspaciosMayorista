// ─────────────────────────────────────────────────────────────────────────
// Resolución de las componentes de una cotización MANUAL (dinámica) para el
// snapshot de condiciones de pago (migración 164).
//
// Es el único tipo de cotización cuyos valores por componente están GUARDADOS
// de forma limpia: cada fila de `cotizacion_servicios` lleva su `tipo_servicio`
// (aereo/hotel/traslado/asistencia/otro) y su PVP `valor`. Por eso el congelado
// del primer pago previo puede desglosar el monto exigido por componente sin
// re-ejecutar el motor de precios.
//
// Mapeo a componentes 164:
//   · aereo  → `aereo_empaquetado` (vuelo por sistema / dinámico): el motor le
//              exige SIEMPRE el 100% de SU PROPIO valor (nada de % configurable).
//   · hotel  → `hotel` (sin condición por vigencia aquí: los servicios manuales
//              no cuelgan de hotel_temporadas → condición neutra → % normal).
//   · traslado / asistencia / otro → `servicio` (neutro → % normal).
//
// Los servicios manuales no declaran condición propia (no hay columnas de
// condición en `cotizacion_servicios`), así que toda componente es neutra; el
// motor le aplica su % normal (0.30 configurable) salvo el aéreo empaquetado.
//
// Este módulo es PURO (no toca la BD) y testeable; la acción de servidor solo
// le pasa las filas de `cotizacion_servicios` ya leídas.
// ─────────────────────────────────────────────────────────────────────────
import type { ComponenteSnapshot } from "./snapshotCondiciones.ts";
import type { TipoComponente } from "./condicionPago.ts";

/** Subconjunto plano de una fila de `cotizacion_servicios`. */
export interface ServicioManualCondicionable {
  id: number;
  tipo_servicio: string; // 'aereo' | 'hotel' | 'traslado' | 'asistencia' | 'otro'
  valor: number | null;
  nombre_servicio: string | null;
}

const LABEL: Record<string, string> = {
  aereo: "Aéreo",
  hotel: "Hotel",
  traslado: "Traslado",
  asistencia: "Asistencia médica",
  otro: "Otro",
};

function tipoComponente(t: string): TipoComponente {
  if (t === "aereo") return "aereo_empaquetado";
  if (t === "hotel") return "hotel";
  // traslado / asistencia / otro → servicio
  return "servicio";
}

/**
 * Convierte los servicios cotizados de una cotización manual en componentes
 * condicionables (valor en la moneda de la cotización).
 *
 * Se descartan servicios de valor 0 (no aportan a la exigencia y no se van a
 * congelar); el monto mínimo se compone entonces de lo que de verdad se cobra.
 */
export function componentesDeManual(
  servicios: ServicioManualCondicionable[],
  fechaViaje: string | null,
): ComponenteSnapshot[] {
  return (servicios ?? [])
    .filter((s) => Number(s.valor) > 0)
    .map((s) => {
      const tipo = tipoComponente(s.tipo_servicio);
      const referencia = s.nombre_servicio?.trim() || LABEL[s.tipo_servicio] || "Servicio";
      return {
        // clave estable = id real de cotizacion_servicios (para unir con el
        // desglose del motor sin colisiones).
        id: `s${s.id}`,
        tipo,
        valor: Number(s.valor) || 0,
        condicion: null, // sin condición propia → % normal (aéreo empaquetado = 100% propio)
        fechaViaje,
        referencia,
        restriccionComercial: "normal",
      } satisfies ComponenteSnapshot;
    });
}
