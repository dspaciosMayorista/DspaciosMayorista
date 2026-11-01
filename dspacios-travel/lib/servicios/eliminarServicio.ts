// Mensaje y traducción del rechazo al ELIMINAR un servicio del catálogo que ya tiene líneas de contrato enlazadas a su cuenta por pagar (migración 265).
// La protección real es de la base (trigger `linea_enlazada_protegida`: el ON DELETE SET NULL de contrato_servicios.servicio_id choca con él, código 42501); aquí solo se
// traduce ese error técnico a un texto claro. Puro: se importa directo desde `node --test`.
export const MENSAJE_SERVICIO_CON_OBLIGACIONES =
  "Este servicio ya tiene obligaciones asociadas (líneas de contrato con su cuenta por pagar) y no puede eliminarse.";

type ErrorBD = { code?: string | null; message?: string | null } | null | undefined;

/** ¿El error es el rechazo de la base por una línea de contrato con cuenta por pagar enlazada? (no confunde un 42501 de RLS con este caso). */
export function esRechazoServicioConObligaciones(e: ErrorBD): boolean {
  return e?.code === "42501" && /cuenta por pagar enlazada/i.test(e.message ?? "");
}

export const MENSAJE_SERVICIO_PUBLICADO =
  "Este servicio está publicado en el tarifario de uno o más paquetes y no puede eliminarse. Quítalo de esos paquetes y vuelve a generar su tarifario; después podrás eliminarlo.";

/** ¿El error es la FK de tarifario_resultado (el servicio sigue publicado en algún paquete)? */
export function esRechazoServicioPublicado(e: ErrorBD): boolean {
  return e?.code === "23503" && /tarifario_resultado/i.test(e.message ?? "");
}

/** Texto para el usuario ante un error al eliminar un servicio: obligaciones asociadas, servicio publicado, o el genérico de la base. */
export function mensajeErrorEliminarServicio(e: NonNullable<ErrorBD>): string {
  if (esRechazoServicioConObligaciones(e)) return MENSAJE_SERVICIO_CON_OBLIGACIONES;
  if (esRechazoServicioPublicado(e)) return MENSAJE_SERVICIO_PUBLICADO;
  return e.message ?? "No se pudo eliminar el servicio.";
}
