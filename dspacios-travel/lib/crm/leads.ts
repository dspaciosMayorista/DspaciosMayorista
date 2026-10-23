export const CRM_LEAD_CANALES = ["whatsapp", "instagram", "otro"] as const;
export type CrmLeadCanal = (typeof CRM_LEAD_CANALES)[number];

export const CRM_LEAD_ETAPAS = ["nuevo", "en_contacto", "calificado", "descartado", "archivado"] as const;
export type CrmLeadEtapa = (typeof CRM_LEAD_ETAPAS)[number];

export const CRM_LEAD_ACTIVIDAD_TIPOS = [
  "nota",
  "llamada",
  "whatsapp",
  "instagram",
  "email",
  "reunion",
  "cambio_etapa",
  "reasignacion",
  "cierre",
] as const;
export type CrmLeadActividadTipo = (typeof CRM_LEAD_ACTIVIDAD_TIPOS)[number];

export const CRM_LEAD_ROLES = ["superadmin", "gerencia", "administracion", "venta"] as const;
export const CRM_LEAD_RESPONSABLE_ROLES = ["gerencia", "administracion", "venta"] as const;

export const CRM_LEAD_ETAPA_LABEL: Record<CrmLeadEtapa, string> = {
  nuevo: "Nuevo",
  en_contacto: "En contacto",
  calificado: "Calificado",
  descartado: "Descartado",
  archivado: "Archivado",
};

export const CRM_LEAD_CANAL_LABEL: Record<CrmLeadCanal, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  otro: "Otro",
};

export function normalizarTelefonoLead(valor?: string | null): string | null {
  const digitos = (valor ?? "").replace(/[^0-9]/g, "");
  if (!digitos) return null;
  if (digitos.length === 10) return `57${digitos}`;
  if (digitos.length === 12 && digitos.startsWith("57")) return digitos;
  return digitos;
}

export function normalizarEmailLead(valor?: string | null): string | null {
  const email = (valor ?? "").trim().toLowerCase();
  return email || null;
}

export function normalizarDocumentoLead(valor?: string | null): string | null {
  const documento = (valor ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return documento || null;
}

export function esCanalLead(valor: string): valor is CrmLeadCanal {
  return (CRM_LEAD_CANALES as readonly string[]).includes(valor);
}

export function esEtapaLead(valor: string): valor is CrmLeadEtapa {
  return (CRM_LEAD_ETAPAS as readonly string[]).includes(valor);
}
