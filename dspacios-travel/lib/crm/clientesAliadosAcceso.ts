// #76/#77 — acceso del personal interno a «Clientes de aliados» (CRM). Lógica pura: quién entra y qué agencias puede ver.
// Misma regla que ya usa el CRM de contratos (221): superadmin y gerencia conservan el alcance de AMBAS agencias; administración y
// operaciones, solo la de su propia fila; venta y los roles B2B no entran (ven solo lo propio en otros módulos). La cookie de agencia activa NO es autoridad.
export const ROLES_CLIENTES_ALIADOS = ["superadmin", "gerencia", "administracion", "operaciones"] as const;

export type AccesoClientesAliados = { ok: true; tenants: string[] | null } | { ok: false };

export function accesoClientesAliados(perfil: { rol?: unknown; activo?: unknown; tenant?: unknown } | null | undefined): AccesoClientesAliados {
  if (!perfil || perfil.activo !== true || typeof perfil.rol !== "string") return { ok: false };
  if (!(ROLES_CLIENTES_ALIADOS as readonly string[]).includes(perfil.rol)) return { ok: false };
  if (perfil.rol === "superadmin" || perfil.rol === "gerencia") return { ok: true, tenants: null };
  return perfil.tenant === "mayorista" || perfil.tenant === "minorista" ? { ok: true, tenants: [perfil.tenant] } : { ok: false };
}

/** `?aliado=` de la URL: un entero positivo que además debe existir en la lista cargada (nunca se confía en el id suelto). */
export function aliadoElegido(raw: unknown, ids: readonly number[]): number | null {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n > 0 && ids.includes(n) ? n : null;
}
