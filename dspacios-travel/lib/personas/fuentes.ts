// Catálogos del registro central de personas (#32, migración 214).
//
// Son los MISMOS valores que los CHECK de `public.persona_capturas` y
// `public.persona_observaciones`; pruebas/personasConsulta.wiring.test.ts falla si divergen.
// #42 agregará la fuente `cotizacion` con su propia migración (documento técnico, 3.6); hasta
// entonces no existe en la base ni aquí.

/** Fuentes de V1. Solo las escriben funciones privadas de `service_role`; ninguna pantalla en V1. */
export const FUENTES_PERSONA = ["captura_interna", "contrato_pasajero"] as const;
export type FuentePersona = (typeof FUENTES_PERSONA)[number];

/** Nivel de una captura: `pasajero_contrato` exige la prueba de la misma fila de `ventas` (1.3.1). */
export const NIVELES_CAPTURA = ["comercial", "pasajero_contrato"] as const;
export type NivelCaptura = (typeof NIVELES_CAPTURA)[number];

/** Campos de una observación. `nit_dv` solo lo escribe el escritor tras validar el DV. */
export const CAMPOS_OBSERVACION = [
  "nombres",
  "apellidos",
  "fecha_nacimiento",
  "nacionalidad",
  "telefono",
  "email",
  "nit_dv",
] as const;
export type CampoObservacion = (typeof CAMPOS_OBSERVACION)[number];

/** Máximo de caracteres de un valor observado (CHECK `char_length(valor) between 1 and 200`). */
export const VALOR_OBSERVACION_MAX = 200;

/** Roles internos que pueden usar la consulta; cualquier otro recibe la respuesta vacía. */
export const ROLES_CONSULTA_PERSONAS = ["superadmin", "gerencia", "administracion", "operaciones", "venta"] as const;
export type RolConsultaPersonas = (typeof ROLES_CONSULTA_PERSONAS)[number];

/** Roles que pueden pedir explícitamente cualquiera de los dos tenants (y solo dentro de este módulo). */
export const ROLES_AMBOS_TENANTS = ["superadmin", "gerencia"] as const;

/** Nivel que corresponde a cada fuente (CHECK `persona_capturas_nivel_ck`). */
export function nivelDeFuente(fuente: FuentePersona): NivelCaptura {
  return fuente === "contrato_pasajero" ? "pasajero_contrato" : "comercial";
}
