import type { Tenant } from "@/lib/tenant";

// Lógica PURA (sin I/O) — separada a propósito para poder probarla con
// `node --test`, igual que `lib/cotizacion/accesoPuro.ts`.
//
// A diferencia de `resolverContextoCotizacion()` (que NO exige un rol
// concreto, porque también sirve el autoservicio B2B — un aliado convierte
// SU PROPIA cotización, y ahí "el permiso real" es ser dueño de la fila, no
// tener un rol interno), `crearContrato()` es un flujo puramente INTERNO
// (formulario manual bajo `/dashboard/contratos`, sin equivalente de
// autoservicio: los roles externos B2B ya son redirigidos fuera de esa ruta
// por `proxy.ts`). Por eso este contexto SÍ exige que el rol tenga permiso
// real de escritura sobre `ventas` — el mismo criterio de `ESCRITURA.ventas`
// en `lib/roles.ts` (que a su vez debe reflejar la RLS real, migración 137).
// `autorizadoPorRol` se calcula en el wrapper impuro (`contexto.ts`), que sí
// puede importar `lib/roles.ts`, para no arrastrar esa dependencia (y su
// import transitivo de `next/headers`) a este módulo puro.
export type ContextoCrearContrato =
  | { ok: true; tenant: Tenant; rol: string }
  | { ok: false; error: string };

const MSG_SESION = "No tienes una sesión válida para crear contratos.";
const MSG_ROL = "Tu rol no tiene permiso para crear contratos.";

// ⚠️ Falla CERRADO: cualquier valor de `activo` que no sea EXACTAMENTE
// `true` bloquea (mismo criterio que `resolverContextoCotizacion`).
export function resolverContextoCrearContrato(
  perfil: { rol: string; activo: boolean | null | undefined } | null | undefined,
  autorizadoPorRol: boolean,
  tenant: Tenant
): ContextoCrearContrato {
  if (!perfil) return { ok: false, error: MSG_SESION };
  if (perfil.activo !== true) return { ok: false, error: MSG_SESION };
  if (!autorizadoPorRol) return { ok: false, error: MSG_ROL };
  return { ok: true, tenant, rol: perfil.rol };
}
