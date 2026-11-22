// Origen REAL de una cotización en el portal del aliado: «directa» (la generó el propio aliado) o «asistida» (la armó personal de D'spacios para él). PURO, sin red.
//
// La pestaña describe el FLUJO de creación, no la modalidad (NETO/PVP) ni la presencia de un plan financiero congelado: un aliado que cotiza solo también congela su plan B2B.
// La procedencia sale de lo que el SERVIDOR escribió al crear la cotización dentro de `payload.b2bAsistido` (el navegador no puede fijarla; ver `resolverCapturaCarrito`):
//   · `origen`: «aliado_directo» (derivado de la sesión del aliado) o «asistida» (personal interno con permiso);
//   · `asistido_por.rol`: rol de quien selló el plan.
// Sin `origen` el plan es del formato anterior, que SOLO podía sellar el personal (el aliado directo llegó después con el campo `origen`): se resuelve por el rol de quien lo selló y,
// sin rol, como asistida. El autor (`creado_por`) NO anula una asistencia genuina: solo decide las cotizaciones SIN plan (B2C de la sesión del aliado).
export type OrigenCotizacion = "directa" | "asistida";

export type ProcedenciaCotizacion = {
  /** `cotizaciones.creado_por` (correo de la sesión que la creó). */
  creado_por?: string | null;
  /** ¿Lleva plan B2B congelado (`payload.b2bAsistido`)? */
  tiene_plan: boolean;
  /** `payload.b2bAsistido.origen` (ausente en el formato anterior). */
  origen_plan?: string | null;
  /** `payload.b2bAsistido.asistido_por.rol`. */
  rol_plan?: string | null;
};

const ROLES_ALIADO = ["agencia", "freelance"];

/** `null` = no es una cotización de este aliado por esta vía (sin plan y creada por otra persona). */
export function origenDeCotizacion(p: ProcedenciaCotizacion, emailAliado: string | null | undefined): OrigenCotizacion | null {
  if (p.tiene_plan) {
    if (p.origen_plan === "aliado_directo") return "directa";
    if (p.origen_plan === "asistida") return "asistida";
    if (p.origen_plan == null && p.rol_plan != null && ROLES_ALIADO.includes(p.rol_plan)) return "directa";
    return "asistida"; // formato anterior sin rol, o valor desconocido: conservador (la asistencia es lo único que existía antes del campo)
  }
  const a = (emailAliado ?? "").trim().toLowerCase();
  return a !== "" && (p.creado_por ?? "").trim().toLowerCase() === a ? "directa" : null;
}
