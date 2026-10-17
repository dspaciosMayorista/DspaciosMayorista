// Stubs de next/navigation (notFound) y @/lib/tenant.server (agenciaDe) para las
// páginas de programa (pruebas/programaRutaAlojamiento.react.ts).
export class NotFoundError extends Error {
  constructor() { super("NEXT_NOT_FOUND"); }
}
export function notFound() { throw new NotFoundError(); }
export async function agenciaDe() { return null; }

// useRouter para componentes cliente de programas (ListaDestinoProgramas): cuenta los refresh.
export let __refreshes = 0;
export function __resetRefreshes() { __refreshes = 0; }
export function useRouter() {
  return { refresh() { __refreshes += 1; }, push() {}, replace() {} };
}
