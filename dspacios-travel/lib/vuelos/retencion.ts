// Retención en plazo SIN contrato (migración 201, decisión del dueño). Funciones puras.
//
// Una silla sin contrato orgánico ni manual que tiene pasajero queda RETENIDA:
// estado `en_plazo` con fecha de plazo. No es vendible y no crea ni cancela
// ninguna venta. Vence solo cuando plazo < día de negocio de Bogotá (el propio
// día del plazo aún no vence) y se libera SOLO a mano
// (`liberar_retencion_vencida`); ni el cron ni `liberar_vencidas` la tocan.
// La base aplica la misma regla y vuelve a comprobarla bajo candado: esto solo
// decide qué muestra la pantalla.
import { fechaNegocio } from "../fechaNegocio.ts";

export type SillaParaRetencion = {
  estado: string | null;
  numero_contrato: string | null;
  contrato_manual: string | null;
  plazo: string | null;
};

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Retención en plazo: `en_plazo` sin contrato orgánico ni manual. */
export function esRetencionSinContrato(s: SillaParaRetencion): boolean {
  return s.estado === "en_plazo" && s.numero_contrato === null && s.contrato_manual === null;
}

/** Vencida: retención cuyo plazo es ANTERIOR al día de negocio (YYYY-MM-DD). */
export function esRetencionVencida(s: SillaParaRetencion, hoy: string = fechaNegocio()): boolean {
  if (!esRetencionSinContrato(s)) return false;
  const plazo = (s.plazo ?? "").slice(0, 10);
  return RE_FECHA.test(plazo) && RE_FECHA.test(hoy) && plazo < hoy;
}

/**
 * Validación de la captura de una silla SIN contrato: o queda vacía, o es una
 * retención con pasajero (nombre o apellido) y fecha de plazo no anterior a
 * hoy. Devuelve el mensaje a mostrar, o null si se puede guardar.
 * `plazoAnterior`: el plazo que ya tenía la silla (no se exige "no pasado" si
 * no cambia, para poder corregir otros datos de una retención ya vencida).
 */
export function validarRetencion(
  datos: { pasajero_nombres?: string; pasajero_apellidos?: string; plazo?: string; [k: string]: string | undefined },
  plazoAnterior: string | null,
  hoy: string = fechaNegocio(),
): string | null {
  const v = (k: string) => (datos[k] ?? "").trim();
  const hayAlgo = Object.keys(datos).some((k) => v(k) !== "");
  if (!hayAlgo) return null;
  const pasajero = v("pasajero_nombres") !== "" || v("pasajero_apellidos") !== "";
  const plazo = v("plazo");
  if (!pasajero || !plazo) {
    return "Para retener una silla sin contrato indica el pasajero (nombre o apellido) y la fecha de plazo.";
  }
  if (!RE_FECHA.test(plazo)) return "Fecha de plazo inválida.";
  if (plazo !== (plazoAnterior ?? "").slice(0, 10) && plazo < hoy) {
    return `La fecha de plazo ${plazo} ya pasó (hoy es ${hoy} en Bogotá).`;
  }
  return null;
}
