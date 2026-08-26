// Compartido (cliente y servidor). NADA de next/headers aquí.
export type Tenant = "mayorista" | "minorista";
export const TENANTS: Tenant[] = ["mayorista", "minorista"];
export const TENANT_LABEL: Record<Tenant, string> = { mayorista: "Mayorista", minorista: "Minorista" };
export const COOKIE_TENANT = "tenant";

export function esTenant(v: string | undefined | null): v is Tenant {
  return v === "mayorista" || v === "minorista";
}

// ── Numeración por agencia ──────────────────────────────────────────────────
// numero_contrato es PK GLOBAL (lo referencian ~15 tablas). La minorista usa el
// MISMO formato "00-XXXX" que la mayorista, así que para NO colisionar ni mezclar
// nada, los contratos importados de la minorista se guardan con prefijo "MIN-".
// La numeración es independiente: que coincida un número no significa nada.
export const PREFIJO_TENANT: Record<Tenant, string> = { mayorista: "", minorista: "MIN-" };

// Aplica el prefijo del tenant a un número "crudo" (00-0397 → MIN-00-0397 en minorista).
export function numeroConTenant(numero: string, tenant: Tenant): string {
  const pre = PREFIJO_TENANT[tenant];
  const n = numero.trim();
  return pre && !n.startsWith(pre) ? pre + n : n;
}

// Quita el prefijo de tenant para MOSTRAR el número limpio (MIN-00-0397 → 00-0397).
export function numeroVisible(numero: string | null | undefined): string {
  return (numero ?? "").replace(/^MIN-/, "");
}

// ── Resolución PURA del tenant activo ───────────────────────────────────────
// Misma regla que `tenantContext()` (lib/tenant.server.ts), extraída aquí sin
// I/O para que se pueda reutilizar sin repetir `auth.getUser()` + la consulta
// de `usuarios` (optimización posterior al PR #274 — `contextoCrearContrato()`
// llamaba a `getTenant()`, que internamente repetía esas dos llamadas). Recibe
// el perfil YA CARGADO (rol + tenant "home") y el valor crudo de la cookie de
// agencia; no hace ninguna llamada de red. `tenantContext()` es la única
// fuente de verdad — esta función debe reflejar EXACTAMENTE su cálculo del
// tenant activo; `tenantContext()` la usa directamente (no reimplementa la
// regla por separado), y `pruebas/contratoContexto.test.ts` prueba esta
// función con ejecución real (superadmin/cookie válida, cookie manipulada
// por un rol sin permiso, cookie ausente/basura) además de verificar por
// wiring que `tenantContext()` delega en ella.
export function resolverTenantActivo(
  perfil: { rol?: string | null; tenant?: string | null } | null | undefined,
  cookieValue: string | undefined
): Tenant {
  const rol = perfil?.rol ?? "";
  const userTenant: Tenant = esTenant(perfil?.tenant) ? perfil!.tenant as Tenant : "mayorista";
  // Solo el superadmin se comparte entre agencias (puede alternar). Los demás
  // usuarios se crean por separado en cada agencia y quedan fijos a la suya.
  const puedeCambiar = rol === "superadmin";
  const permitidos: Tenant[] = puedeCambiar ? TENANTS : [userTenant];
  return esTenant(cookieValue) && permitidos.includes(cookieValue) ? cookieValue : (permitidos[0] ?? "mayorista");
}
