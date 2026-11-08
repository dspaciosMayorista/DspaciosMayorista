// Reutilización de consecutivos al eliminar un contrato (#75).
//
// · Minorista (MIN-… / 00-NNNN históricos): igual que siempre — se puede marcar «reusar el consecutivo» sin más
//   condiciones (numeros_contrato_liberados).
// · Mayorista (DTM-): migración 287. SOLO se libera el consecutivo de un contrato que todavía existe, está
//   pendiente, nunca se confirmó y está vacío salvo por el cliente titular. La base decide (dtm_reuso_bloqueos,
//   falla cerrado); esta capa solo traduce los códigos de bloqueo a texto para el superadmin.
//   El reuso NACE DESHABILITADO (dtm_reuso_config.habilitado = false): hasta que exista la protección contra
//   escrituras de pantallas antiguas, eliminar con reuso un DTM- se rechaza con REUSO_DESHABILITADO.

/** ¿Este número pasa por la elegibilidad de la 287 (Mayorista)? */
export function reusoSujetoAElegibilidad(numero: string): boolean {
  return numero.startsWith("DTM-");
}

const FRASES_FIJAS: Record<string, string> = {
  NO_ES_DTM: "El número no tiene formato DTM.",
  NO_EXISTE: "El contrato ya no existe.",
  REUSO_DESHABILITADO: "La reutilización de consecutivos DTM está deshabilitada hasta que exista la protección contra escrituras de pantallas antiguas.",
  TENANT_NO_MAYORISTA: "El contrato no es de Mayorista.",
  FINANCIERO_INCOMPLETO: "El registro financiero del contrato está incompleto.",
  SIN_EVENTO_DE_CREACION_EN_AUDITORIA: "No hay evidencia de su creación en la auditoría; no se puede acreditar que nunca se confirmó.",
  ESTADO_DISTINTO_DE_PENDIENTE_EN_HISTORIA: "Su historial muestra un estado distinto de pendiente (pudo haberse confirmado).",
  EXISTE_EN_VENTAS: "El número todavía pertenece a un contrato.",
  ARCHIVOS_EN_STORAGE: "Tiene archivos guardados.",
  ASIENTOS_CONTABLES: "Aparece en asientos contables.",
  LECTURA_FALLIDA_STORAGE: "No se pudo comprobar si tiene archivos (se bloquea por seguridad).",
  LECTURA_FALLIDA_ASIENTOS: "No se pudo comprobar si aparece en asientos contables (se bloquea por seguridad).",
};

const TABLAS: Record<string, string> = {
  CONTRATO_PASAJEROS: "pasajeros", ABONOS: "pagos", ABONOS_ANULADOS: "pagos anulados", ABONO_OPERACIONES: "operaciones de pago",
  ALIADOS_B2B: "comisiones", CONTRATO_VUELOS: "vuelos", SILLAS: "sillas", CONTRATO_SERVICIOS: "servicios", CONTRATO_HOTELES: "hoteles",
  CONTRATO_ITEMS: "ítems", CUENTAS_POR_PAGAR: "cuentas por pagar", FACTURACION: "facturación", CUOTAS: "plan de cobro",
  VOUCHERS: "vouchers", CONTRATO_ADJUNTOS: "archivos adjuntos", CONTRATO_SOPORTES_PAGO: "soportes de pago", AVISOS: "avisos",
  COTIZACIONES: "una cotización vinculada", PERSONA_CAPTURAS: "capturas de personas", CONTRATO_CONDICIONES: "condiciones de pago",
  MOVIMIENTOS_SILLA: "movimientos de sillas", CONTRATO_FACTURACION: "configuración de facturación",
};

/** Traduce UN código de bloqueo (tal como lo devuelve la base) a una frase para el superadmin. */
export function describirBloqueoReuso(codigo: string): string {
  const c = codigo.trim();
  if (FRASES_FIJAS[c]) return FRASES_FIJAS[c];
  if (c.startsWith("LECTURA_FALLIDA")) return "No se pudo comprobar una verificación (se bloquea por seguridad).";
  if (c.startsWith("ESTADO_ACTUAL_")) return `El contrato está en estado ${c.slice("ESTADO_ACTUAL_".length).toLowerCase()}, no pendiente.`;
  if (c.startsWith("CAMPO_COMERCIAL_")) return `Tiene datos comerciales cargados (${c.slice("CAMPO_COMERCIAL_".length).toLowerCase().replace(/_/g, " ")}).`;
  if (c.startsWith("RELACION_")) {
    const t = c.slice("RELACION_".length);
    return `Tiene ${TABLAS[t] ?? `registros relacionados (${t.toLowerCase().replace(/_/g, " ")})`}.`;
  }
  return `Motivo de bloqueo: ${c}.`;
}

export function describirBloqueosReuso(codigos: readonly string[]): string[] {
  return codigos.map(describirBloqueoReuso);
}

/** Extrae los códigos de un error `REUSO_NO_ELEGIBLE: A, B` de la base (o null si el error es otro). */
export function codigosDeErrorReuso(mensaje: string | null | undefined): string[] | null {
  const m = /REUSO_NO_ELEGIBLE:\s*([^\n(]+)/.exec(mensaje ?? "");
  if (!m) return null;
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}
