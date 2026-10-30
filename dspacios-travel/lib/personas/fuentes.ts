// Catálogos del registro central de personas (#32, migración 214).
//
// Son los MISMOS valores que los CHECK de `public.persona_capturas` y
// `public.persona_observaciones`; pruebas/personasConsulta.wiring.test.ts falla si divergen.
// `FUENTES_PERSONA`/`NIVELES_CAPTURA` siguen siendo los de la 214 (su prueba de paridad los
// compara con esa migración); la 219 (#42) los AMPLÍA con la fuente `cotizacion` y el nivel
// `pasajero_cotizacion` en `FUENTES_PERSONA_219`/`NIVELES_CAPTURA_219`, comparados con la 219
// por pruebas/cableadoPersonasCotizacion42.wiring.test.ts.

/** Fuentes de V1 (214). Solo las escriben funciones privadas de `service_role`. */
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

// ── Migración 219 (#42): personas de cotizaciones ─────────────────────────────

/** Fuente de las capturas de cotización: solo la escriben las fachadas de la 219. */
export const FUENTE_COTIZACION = "cotizacion" as const;
export const FUENTES_PERSONA_219 = [...FUENTES_PERSONA, FUENTE_COTIZACION] as const;
export type FuentePersona219 = (typeof FUENTES_PERSONA_219)[number];

/** D-3 = N2: el titular es `comercial`; el pasajero de una cotización, `pasajero_cotizacion`. */
export const NIVELES_CAPTURA_219 = [...NIVELES_CAPTURA, "pasajero_cotizacion"] as const;
export type NivelCaptura219 = (typeof NIVELES_CAPTURA_219)[number];

/** Puesto dentro de una cotización (CHECK de `cotizacion_participantes.rol`). */
export const ROLES_PARTICIPANTE = ["titular", "pasajero"] as const;
export type RolParticipante = (typeof ROLES_PARTICIPANTE)[number];

/** Campos que aporta cada puesto (C1); la fachada rechaza cualquier otro. */
export const CAMPOS_TITULAR = ["nombres", "apellidos", "telefono", "email", "fecha_nacimiento"] as const;
export const CAMPOS_PASAJERO = ["nombres", "apellidos", "fecha_nacimiento", "nacionalidad"] as const;

/** Nivel de una captura de cotización según el puesto. */
export function nivelDeParticipante(rol: RolParticipante): NivelCaptura219 {
  return rol === "pasajero" ? "pasajero_cotizacion" : "comercial";
}

/** Roles que leen la lista del CRM de personas de cotizaciones (la RPC vuelve a decidir). */
export const ROLES_LISTA_PERSONAS_COTIZACION = [
  "superadmin", "gerencia", "administracion", "operaciones", "venta", "agencia", "freelance",
] as const;
