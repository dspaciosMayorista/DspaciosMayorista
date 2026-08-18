import type { Tenant } from "@/lib/tenant";

// Lógica PURA (sin I/O, sin Supabase, sin next/headers) — separada a propósito
// de `acceso.ts` para poder probar CADA combinación de forma determinista con
// `node --test`, sin depender de una sesión real ni de una base de datos.
export type ContextoCotizacion =
  | { ok: true; superadmin: boolean; tenant: Tenant }
  | { ok: false; motivo: "sin_perfil" | "usuario_inactivo" };

// ⚠️ Falla CERRADO: cualquier valor de `activo` que no sea EXACTAMENTE
// `true` (`false`, `null`, `undefined`, o el propio `perfil` ausente) bloquea
// — incluido un superadmin. Antes se usaba `perfil.activo === false`, que
// dejaba pasar `null`/`undefined` como si el usuario estuviera activo.
export function resolverContextoCotizacion(
  perfil: { rol: string; activo: boolean | null | undefined } | null | undefined,
  tenant: Tenant
): ContextoCotizacion {
  if (!perfil) return { ok: false, motivo: "sin_perfil" };
  if (perfil.activo !== true) return { ok: false, motivo: "usuario_inactivo" };
  return { ok: true, superadmin: perfil.rol === "superadmin", tenant };
}

// ¿Este contexto puede acceder a una fila con este tenant?
//
// `tenantFila = null` (cotización sin tenant asignado) se niega para
// cualquiera que no sea superadmin — nunca se trata como "accesible por
// defecto". Superadmin conserva el alcance global previsto (puede revisar y
// corregir una fila huérfana); nadie más — ni siquiera gerencia (ver
// `puede_ver_tenant_cotizacion()` en la migración 154: a diferencia de
// `puede_ver_tenant()` que usan otras tablas, para cotizaciones SOLO
// superadmin tiene alcance global; gerencia queda igual de acotada a su
// propio tenant que administracion/operaciones/venta).
export function autorizaTenant(ctx: ContextoCotizacion, tenantFila: string | null): boolean {
  if (!ctx.ok) return false;
  if (ctx.superadmin) return true;
  return tenantFila === ctx.tenant;
}
