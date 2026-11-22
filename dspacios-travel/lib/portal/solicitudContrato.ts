// #78 — «Solicitar contrato»: reglas PURAS de presentación (sin red). Acción explícita del aliado, distinta de «Guardar cotización»; el servidor decide todo lo demás.
import type { EstadoCotizacion } from "@/lib/portal/b2bPortal";

export type SolicitudContrato = { cotizacion_id: number; notificados: number; creado_en: string };

/** Solo una cotización vigente y simple puede pedirse como contrato (las comparativas se eligen por opción; las vencidas, convertidas o con salida pasada no). */
export const puedeSolicitarContrato = (est: EstadoCotizacion, modo: string | null | undefined) => est === "vigente" && modo !== "comparativa";

/** Mensaje al aliado según el código de error de la función de base de datos (F46xx); cualquier otro fallo es genérico y NO afirma que se haya solicitado. */
export function mensajeErrorSolicitud(code: string | null | undefined): string {
  switch (code) {
    case "F4601": return "Tu cuenta no puede solicitar contratos.";
    case "F4602": return "No encontramos esa cotización entre las tuyas.";
    case "F4603": return "Esa cotización ya es un contrato.";
    case "F4604": return "Esta cotización no admite solicitar contrato.";
    case "F4605": return "La cotización venció. Genera una nueva desde el tarifario.";
    case "F4606": return "La fecha de salida ya pasó. Genera una nueva cotización.";
    default: return "No pudimos registrar tu solicitud. Intenta de nuevo en unos minutos.";
  }
}

/** Texto honesto del estado: si nadie está configurado para recibir el aviso, se dice (la solicitud queda registrada igual). */
export function textoSolicitud(s: Pick<SolicitudContrato, "notificados">, fecha: string): string {
  return s.notificados > 0
    ? `Contrato solicitado el ${fecha}. Avisamos a D'spacios dentro de la plataforma.`
    : `Contrato solicitado el ${fecha}. Quedó registrado; aún no hay responsables configurados para recibir el aviso, así que contacta a tu asesor.`;
}

export type RespuestaSolicitud = { estado: "solicitada" | "reemplazada" | "ya_solicitada"; notificados: number };

export function textoResultado(r: RespuestaSolicitud): string {
  if (r.estado === "ya_solicitada") return "Ya habías solicitado este contrato y la cotización no ha cambiado desde entonces.";
  const base = r.estado === "reemplazada" ? "Actualizamos tu solicitud con los cambios de la cotización." : "Solicitud de contrato registrada.";
  return r.notificados > 0 ? `${base} Avisamos a D'spacios.` : `${base} Aún no hay responsables configurados para el aviso; contacta a tu asesor.`;
}
