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
