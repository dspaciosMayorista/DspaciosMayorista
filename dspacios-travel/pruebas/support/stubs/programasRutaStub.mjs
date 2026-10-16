// Stubs de next/navigation (notFound) y @/lib/tenant.server (agenciaDe) para las
// páginas de programa (pruebas/programaRutaAlojamiento.react.ts).
export class NotFoundError extends Error {
  constructor() { super("NEXT_NOT_FOUND"); }
}
export function notFound() { throw new NotFoundError(); }
export async function agenciaDe() { return null; }
