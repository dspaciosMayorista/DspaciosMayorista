// Compartido (cliente y servidor). NADA de next/headers aquí.
export type Tenant = "mayorista" | "minorista";
export const TENANTS: Tenant[] = ["mayorista", "minorista"];
export const TENANT_LABEL: Record<Tenant, string> = { mayorista: "Mayorista", minorista: "Minorista" };
export const COOKIE_TENANT = "tenant";

export function esTenant(v: string | undefined | null): v is Tenant {
  return v === "mayorista" || v === "minorista";
}
