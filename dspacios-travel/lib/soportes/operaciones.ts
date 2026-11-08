// Soportes de pago (#86): orquestación Storage + base, con dependencias INYECTADAS para probar los fallos sin red.
//
// Storage y Postgres no comparten transacción. Regla: el archivo anterior NUNCA se toca (ni al reemplazar ni al retirar); el archivo nuevo se sube
// primero con los MISMOS bytes que ya se validaron y hashearon; y un objeto que PUDO quedar vinculado NUNCA se borra automáticamente.
//
// Cuando la función de base responde, hay dos mundos:
//   · RECHAZO DEFINITIVO: la función SQL levantó una de sus excepciones (SOPORTE_*): la transacción se revirtió entera y no hay vínculo. Solo entonces
//     es seguro borrar el objeto recién subido (compensación).
//   · RESULTADO INCIERTO: excepción de transporte, corte, respuesta ilegible o error desconocido. La función pudo haber confirmado la fila y haberse
//     perdido solo la respuesta. Aquí NO se borra nada: se pregunta a la base por la ruta única del objeto.
//       – vinculado  → el registro quedó confirmado: se trata como éxito (sin duplicar nada).
//       – ausente / no se pudo preguntar → el archivo se CONSERVA y se registra para conciliación. «Ausente» tampoco autoriza a borrar: la petición
//         original podría estar todavía en vuelo y confirmarse después; un borrado ahora dejaría evidencia registrada sin archivo.
// Un huérfano conservado cuesta almacenamiento; borrar evidencia registrada cuesta la prueba de un pago. Se elige lo primero.
import type { ArchivoValidado } from "./archivo.ts";
import { MENSAJE_IDENTIDAD, esErrorIdentidad } from "../contrato/identidad.ts";

export type Validado = Extract<ArchivoValidado, { ok: true }>;
type ErrorSb = { message: string } | null;

/** ¿El vínculo de esta ruta quedó confirmado en la base? */
export type Confirmacion = "vinculado" | "ausente" | "incierto";

export type DepsSubida = {
  /** Sube los bytes validados a la ruta (sin upsert). */
  subir(path: string, bytes: Uint8Array, mime: string): Promise<{ error: ErrorSb }>;
  /** Borra un objeto recién subido (SOLO tras un rechazo definitivo de la base). */
  borrar(path: string): Promise<{ error: ErrorSb }>;
  /** Llama a soporte_registrar / soporte_reemplazar con la ruta ya subida. */
  registrar(path: string): Promise<{ error: ErrorSb }>;
  /** Pregunta a la base si existe una fila con esa ruta (única). Nunca debe lanzar: devuelve «incierto». */
  confirmar(path: string): Promise<Confirmacion>;
  /** Deja constancia para conciliación manual de un objeto que se conservó sin vínculo confirmado. */
  alertarConciliacion?(path: string, motivo: string): void;
  /** Huérfano tras un rechazo definitivo cuya limpieza falló. */
  alertarHuerfano?(path: string, motivo: string): void;
};

export type ResultadoSubida =
  | { ok: true; path: string; /** el registro respondió con error pero la base lo tenía confirmado */ confirmadoTrasError?: true }
  | { ok: false; error: string; huerfano?: string; /** objeto conservado, vínculo no determinado: requiere conciliación */ conciliar?: string };

const MENSAJES: Record<string, string> = {
  SOPORTE_LIMITE: "Ya tienes un soporte vigente por cada abono registrado de este contrato. Reemplaza o retira uno para subir otro.",
  SOPORTE_NO_VIGENTE: "Ese soporte ya cambió (otro reemplazo o retiro se adelantó). Actualiza la página e inténtalo de nuevo.",
  SOPORTE_CONTRATO_INEXISTENTE: "El contrato ya no existe.",
  SOPORTE_ACTOR: "Tu usuario no está activo.",
  SOPORTE_INEXISTENTE: "El soporte no existe.",
  SOPORTE_ARCHIVADO: "No tienes acceso a ese soporte.",
  SOPORTE_IDENTIDAD: MENSAJE_IDENTIDAD,
};
const SIN_CONFIRMAR = "No pudimos confirmar si el soporte quedó registrado. El archivo se conservó; revisa tus soportes en unos minutos antes de volver a subirlo.";

/** Traduce el error de la base a un mensaje para la persona; los técnicos no se muestran tal cual. */
export function mensajeDeBase(e: { message: string }): string {
  for (const k of Object.keys(MENSAJES)) if (e.message.includes(k)) return MENSAJES[k];
  return "No se pudo registrar el soporte. Inténtalo de nuevo.";
}

/** ¿La función SQL rechazó con una de sus excepciones? (la transacción se revirtió: no hay vínculo). Todo lo demás es incierto. */
export function esRechazoDefinitivo(e: { message: string }): boolean {
  return /\bSOPORTE_[A-Z_]+\b/.test(e.message);
}

export async function subirYVincular(deps: DepsSubida, args: { path: string; archivo: Validado; bytes: Uint8Array }): Promise<ResultadoSubida> {
  const { path, archivo, bytes } = args;
  let up: { error: ErrorSb };
  try {
    up = await deps.subir(path, bytes, archivo.mime);
  } catch {
    return { ok: false, error: "No se pudo guardar el archivo. Inténtalo de nuevo." };
  }
  if (up.error) return { ok: false, error: "No se pudo guardar el archivo. Inténtalo de nuevo." };

  let reg: { error: ErrorSb };
  try {
    reg = await deps.registrar(path);
  } catch (e) {
    reg = { error: { message: `excepción al registrar: ${e instanceof Error ? e.message : String(e)}` } };
  }
  if (!reg.error) return { ok: true, path };

  // ── Rechazo definitivo de la base: sin vínculo → se limpia SOLO el objeto nuevo.
  if (esRechazoDefinitivo(reg.error)) {
    let limpio = false;
    try { limpio = !(await deps.borrar(path)).error; } catch { limpio = false; }
    const error = mensajeDeBase(reg.error);
    if (limpio) return { ok: false, error };
    deps.alertarHuerfano?.(path, reg.error.message);
    return { ok: false, error, huerfano: path };
  }

  // ── Resultado incierto: NO se borra. Se pregunta por la ruta única.
  let c: Confirmacion;
  try { c = await deps.confirmar(path); } catch { c = "incierto"; }
  if (c === "vinculado") return { ok: true, path, confirmadoTrasError: true };
  deps.alertarConciliacion?.(path, `${c}: ${reg.error.message}`);
  return { ok: false, error: SIN_CONFIRMAR, conciliar: path };
}

/** Precomprobación de identidad ANTES de subir: null = adelante; si no, el mensaje a devolver (nada se sube). Identidad ≠ otro fallo (transporte/desconocido → reintentable). */
export async function precomprobarIdentidad(verificar: () => PromiseLike<{ error: { message?: string | null; code?: string | null } | null }>): Promise<string | null> {
  try {
    const { error } = await verificar();
    if (!error) return null;
    if (esErrorIdentidad(error)) return MENSAJE_IDENTIDAD;
  } catch { /* transporte: igual que un error desconocido */ }
  return "No pudimos verificar el contrato. No se subió nada; inténtalo de nuevo.";
}
