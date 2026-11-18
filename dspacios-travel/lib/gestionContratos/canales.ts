// #106 · Canales por los que el personal reporta haber entregado un voucher o enviado una factura (acuse manual). Misma lista que el CHECK de la migración 309.
export const CANALES = ["whatsapp", "correo", "portal", "presencial", "otro"] as const;
export type Canal = (typeof CANALES)[number];
export const ETIQUETA_CANAL: Record<Canal, string> = { whatsapp: "WhatsApp", correo: "Correo", portal: "Portal del aliado", presencial: "En persona", otro: "Otro medio" };
