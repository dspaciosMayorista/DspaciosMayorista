// Contacto CRM auxiliar del checkout del tarifario (#40 · E1).
//
// Al enviar una solicitud, el checkout agrega al cliente a `crm_contactos` como cliente final. Es un
// efecto AUXILIAR: nunca bloquea ni cambia la solicitud. El insert vive en `crearSolicitudReserva`
// (app/tarifario/checkout/actions.ts); este módulo aporta las dos decisiones puras:
//   · QUÉ datos se guardan: el tipo de documento es el que eligió el cliente (catálogo de la 214). Si no
//     eligió, o el valor no es del catálogo, queda NULL: nunca se supone "CC" (un contacto con CC
//     histórico no confirma el tipo real).
//   · QUÉ se hace con el `{error}` del insert (supabase-js no lanza: lo devuelve). Una colisión 23505 (los
//     índices únicos globales por documento, email y teléfono de la 047) significa "ya existe": no se
//     sobrescribe ni se actualiza nada y no es un fallo. Cualquier otro error se registra SOLO con su
//     código: el mensaje de Postgres puede repetir el documento, el email o el teléfono.
import { TIPOS_DOC_PERSONA } from "@/lib/personas/identidad";

export type ClienteContactoTarifario = {
  nombres: string;
  apellidos: string;
  numeroDoc: string;
  email: string;
  telefono: string;
};

export type DatosContactoTarifario = {
  nombre: string;
  tipo_doc: string | null;
  documento: string | null;
  email: string | null;
  telefono: string | null;
};

const CODIGO_SEGURO = /^[A-Za-z0-9_]{1,16}$/;

/** Solo un código corto de forma conocida puede llegar al log; cualquier otra cosa es "desconocido". */
function codigoSeguro(codigo: unknown): string {
  return typeof codigo === "string" && CODIGO_SEGURO.test(codigo) ? codigo : "desconocido";
}

/**
 * Datos variables del contacto, o null si no hay nombre (no se crea un contacto sin nombre).
 * `tipoDoc` es el tipo elegido en el checkout (o null): solo se conserva si es del catálogo y solo si
 * hay documento al que pertenezca.
 */
export function datosContactoTarifario(cliente: ClienteContactoTarifario, tipoDoc: string | null): DatosContactoTarifario | null {
  const nombre = `${cliente.nombres} ${cliente.apellidos}`.trim();
  if (!nombre) return null;
  const documento = cliente.numeroDoc.trim() || null;
  const tipoValido = typeof tipoDoc === "string" && (TIPOS_DOC_PERSONA as readonly string[]).includes(tipoDoc) ? tipoDoc : null;
  return {
    nombre,
    tipo_doc: documento ? tipoValido : null,
    documento,
    email: cliente.email.trim() || null,
    telefono: cliente.telefono.trim() || null,
  };
}

/**
 * Código a registrar para el `{error}` de un insert en `crm_contactos`, o null si no hay nada que
 * registrar: sin error, o colisión 23505 (el contacto ya existía; no es un fallo ni se sobrescribe).
 */
export function codigoErrorContacto(error: { code?: unknown } | null | undefined): string | null {
  if (!error) return null;
  if (error.code === "23505") return null;
  return codigoSeguro(error.code);
}

/** Línea de log SIN datos personales (solo etapa y código). */
export function logContactoTarifario(codigo: string): string {
  return `[crm40] etapa=contacto_tarifario codigo=${codigoSeguro(codigo)}`;
}

// Procedencia del contacto (#42): sale del contexto que el SERVIDOR ya validó en el checkout, nunca del navegador.
// El texto B2C es el literal que reconocen los scripts de atribución de la 207; los B2B llevan otro, para que un
// cliente de un aliado no se rotule (ni se atribuya) como cliente final directo de la agencia.
export const ORIGEN_CONTACTO_B2C = "Cotización tarifario (B2C)";
export const ORIGEN_CONTACTO_B2B = "Cotización tarifario (B2B)";
export const ORIGEN_CONTACTO_B2B_ASISTIDA = "Cotización tarifario (B2B asistida)";

/** Venta asistida (#102) gana sobre sesión B2B: la sesión asistente es interna, nunca de aliado. */
export function origenContactoTarifario(ctx: { asistida: boolean; aliadoAutenticado: boolean }): string {
  if (ctx.asistida) return ORIGEN_CONTACTO_B2B_ASISTIDA;
  return ctx.aliadoAutenticado ? ORIGEN_CONTACTO_B2B : ORIGEN_CONTACTO_B2C;
}
