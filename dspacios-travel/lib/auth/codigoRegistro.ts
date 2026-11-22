// #62 — verificación del correo por CÓDIGO en el registro B2B. Reglas puras (sin red). La autoridad de «verificado» es Supabase Auth (`email_confirmed_at`), nunca el navegador.

/** Intentos fallidos permitidos por registro; al agotarse se borra el registro sin verificar y hay que empezar de nuevo (pide un código nuevo). */
export const MAX_INTENTOS_CODIGO = 5;
/** Espera local entre reenvíos (solo UX; Auth además limita la frecuencia de envío por correo del lado del servidor). */
export const ESPERA_REENVIO_S = 60;

/** Solo dígitos; Supabase emite 6 por defecto (configurable hasta 10). Devuelve null si no tiene forma de código. */
export function normalizarCodigo(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = v.replace(/\s+/g, "");
  return /^\d{6,10}$/.test(d) ? d : null;
}

export const MSG_CODIGO_INVALIDO = "El código no es válido o ya venció. Revisa el correo o pide uno nuevo.";
export const MSG_CODIGO_AGOTADO = "Superaste los intentos permitidos. Vuelve a llenar el registro para recibir un código nuevo.";
export const MSG_ESPERA = "Espera un momento antes de pedir otro código.";

/** Estado del registro pendiente que lee el servidor de Auth (app_metadata solo lo escribe el servidor). */
export type RegistroPendiente = { flag: boolean; confirmado: boolean; activo: boolean | null; intentos: number; tieneSolicitud: boolean };

/** ¿Es un registro B2B sin verificar que ESTE flujo puede continuar o descartar? Cualquier otra cuenta (aprobada, antigua, confirmada) nunca se toca. */
export function esRegistroPendienteSinVerificar(r: RegistroPendiente): boolean {
  return r.flag && !r.confirmado && r.activo === false && !r.tieneSolicitud;
}

/** Correo ya verificado por este flujo (Auth lo confirmó) pero SIN solicitud de aprobación: se interrumpió después del código. Se completa con correo + contraseña; nunca se borra ni se reinicia. */
export function esRegistroVerificadoSinSolicitud(r: RegistroPendiente): boolean {
  return r.flag && r.confirmado && r.activo === false && !r.tieneSolicitud;
}

export const MSG_EN_CURSO = "Estamos procesando otro intento con este correo. Espera unos segundos e intenta de nuevo.";
export const MSG_ERROR_TEMPORAL = "No pudimos procesar tu solicitud en este momento. Intenta de nuevo en unos minutos.";
export const MSG_CONTINUAR = "Tu correo ya está verificado, pero tu solicitud aún no se completó. Escribe la contraseña de tu registro para continuar.";
export const MSG_VERIFICADO_PENDIENTE = "Tu correo quedó verificado, pero no pudimos terminar de registrar tu solicitud. Escribe la contraseña de tu registro para continuar.";
export const MSG_CONTINUAR_INVALIDO = "No pudimos confirmar tu identidad. Revisa el correo y la contraseña de tu registro (el correo debe estar verificado).";
