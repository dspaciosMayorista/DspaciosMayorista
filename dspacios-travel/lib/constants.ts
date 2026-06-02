// Salario mínimo — actualizar cada diciembre con decreto presidencial
export const SMMLV = 1_750_905;
export const SUBSIDIO_TRANSPORTE = 249_095;

// Parámetros tributarios Colombia (Decreto dic-2025)
export const TRIBUTARIO = {
  ICA: 0.01,          // sobre ingresos brutos
  BOMBERIL: 0.01,     // sobre el ICA
  FONTUR: 0.025,      // sobre utilidad bruta
  RETENCION_RENTA: 0.035,
  IVA: 0.19,
  RETENCION_HONORARIOS: 0.11,
} as const;

// Roles del sistema
export const ROLES = [
  "superadmin",
  "gerencia",
  "administracion",
  "operaciones",
  "venta",
  "control_vuelo",
  "agencia",
  "freelance",
  "cliente_final",
] as const;

export type Rol = (typeof ROLES)[number];

export const ROLES_INTERNOS: Rol[] = [
  "superadmin",
  "gerencia",
  "administracion",
  "operaciones",
  "venta",
  "control_vuelo",
];

export const ROLES_EXTERNOS: Rol[] = ["agencia", "freelance", "cliente_final"];

// Estados de silla
export const ESTADOS_SILLA = [
  "disponible",
  "en_plazo",
  "confirmada",
  "devuelta",
  "no_vendida",
  "cambio",
  "cambio_entrante",
] as const;

export type EstadoSilla = (typeof ESTADOS_SILLA)[number];

// Tipos de paquete
export const TIPOS_PAQUETE = [
  "bloqueo",
  "empaquetado",
  "dinamico",
  "porcion_terrestre",
] as const;

export type TipoPaquete = (typeof TIPOS_PAQUETE)[number];
