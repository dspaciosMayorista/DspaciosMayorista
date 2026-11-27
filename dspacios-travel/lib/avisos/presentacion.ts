// Avisos internos (#86): textos y reglas PURAS de presentación. Sin red ni next/*.
// Un aviso lleva tipo + número de contrato y nada más: ni cliente, ni montos, ni nombre de archivo.

export type TipoAviso = "soporte_pago_nuevo" | "soporte_pago_reemplazado" | "solicitud_contrato" | "cotizacion_publica";

/** Tipos de aviso cuyo destino es la ficha de una COTIZACIÓN (llevan `cotizacion_id`); el resto apunta al contrato. */
export const TIPOS_AVISO_DE_COTIZACION: readonly string[] = ["solicitud_contrato", "cotizacion_publica"];

export type AvisoVista = {
  id: number;
  tipo: TipoAviso;
  numero_contrato: string;
  creado_en: string;
  leido: boolean;
  /** #78: la cotización pública de este aviso ya se CONVIRTIÓ a contrato (solo esa condición; leído y descartar no cuentan). Solo aplica a `cotizacion_publica`. */
  atendida: boolean;
  /** Destino al abrirlo, calculado en el servidor según quién mira (portal del aliado o ficha interna). */
  href: string;
};

export type RespuestaSondeo = {
  /** Reclamados por ESTA llamada para notificar (solo si el cliente pidió reclamar). Cada aviso sale una sola vez. */
  nuevos: AvisoVista[];
  noLeidos: number;
  recientes: AvisoVista[];
};

export const SONDEO_VACIO: RespuestaSondeo = { nuevos: [], noLeidos: 0, recientes: [] };

/**
 * Sondeo cada 30 s. NO se pausa con la pestaña oculta (el usuario trabaja en otra): el navegador puede ralentizar los temporizadores
 * en segundo plano —latencia de hasta aproximadamente un minuto o más, sin plazo garantizado—, y por eso además se sondea al volver
 * a la pestaña (`visibilitychange`/`focus`). Con el navegador cerrado no hay avisos.
 */
export const INTERVALO_SONDEO_MS = 30_000;

export function textoAviso(tipo: TipoAviso, numeroVisible: string): string {
  if (tipo === "solicitud_contrato") return `Solicitud de contrato de un aliado: cotización ${numeroVisible}`;
  if (tipo === "cotizacion_publica") return `Nueva cotización de un visitante del tarifario: ${numeroVisible}`;
  return tipo === "soporte_pago_reemplazado"
    ? `Se reemplazó un soporte de pago en el contrato ${numeroVisible}`
    : `Nuevo soporte de pago en el contrato ${numeroVisible}`;
}

/** Título de la pestaña con el contador de no leídos; sin no leídos devuelve el título original. */
export function tituloPestana(base: string, noLeidos: number): string {
  const limpio = base.replace(/^\(\d+\+?\)\s+/, "");
  if (!(noLeidos > 0)) return limpio;
  return `(${noLeidos > 99 ? "99+" : noLeidos}) ${limpio}`;
}

/** ¿Debe esta pestaña pedir el reclamo? Solo con el permiso concedido Y activado por la persona en este navegador. */
export function debeReclamar(permiso: NotificationPermission | "no-soportado", activado: boolean): boolean {
  return permiso === "granted" && activado;
}
