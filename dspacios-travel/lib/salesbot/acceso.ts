// Decisión PURA de acceso a la consulta interna de programas (#56). La usa
// `lectura.ts` con los datos reales del usuario; vive aparte para poder
// probarla sin sesión ni base de datos.
//
// No reemplaza a `proxy.ts` (que ya bloquea la ruta por LECTURA_MODULO): es la
// segunda defensa, en el servidor, para cualquier llamada a la consulta.
import { LECTURA_MODULO } from "@/lib/constants";
import type { MotivoNoAutorizado } from "@/lib/salesbot/contrato";

export type PerfilConsulta = { rol: string | null; activo: boolean | null } | null;

export type AccesoConsulta = { ok: true; rol: string } | { ok: false; motivo: MotivoNoAutorizado };

/** Roles que pueden usar la consulta: la MISMA lista que protege la ruta. */
export const ROLES_CONSULTA: readonly string[] = LECTURA_MODULO.salesbot ?? [];

export function resolverAccesoConsulta(perfil: PerfilConsulta, tenantActivo: string | null): AccesoConsulta {
  if (!perfil) return { ok: false, motivo: "sin_sesion" };
  if (perfil.activo !== true) return { ok: false, motivo: "usuario_inactivo" };
  const rol = perfil.rol ?? "";
  if (!ROLES_CONSULTA.includes(rol)) return { ok: false, motivo: "rol_no_permitido" };
  // Solo Mayorista (decisión del dueño): un superadmin con Minorista activa no consulta.
  if (tenantActivo !== "mayorista") return { ok: false, motivo: "agencia_no_permitida" };
  return { ok: true, rol };
}

export const MENSAJE_NO_AUTORIZADO: Record<MotivoNoAutorizado, string> = {
  sin_sesion: "Inicia sesión para consultar los programas.",
  usuario_inactivo: "Tu usuario está inactivo.",
  rol_no_permitido: "Tu rol no tiene acceso a la consulta de programas.",
  agencia_no_permitida: "La consulta de programas opera solo en Mayorista. Cambia la agencia activa.",
};
