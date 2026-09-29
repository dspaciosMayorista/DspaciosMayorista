// Stub de "next/cache" (no resuelve/roto fuera del bundler de Next) para la
// prueba de la action real de pagos. Recording de revalidatePath para poder
// afirmar que se (o no se) invalidó la ruta.
let rutas = [];

export function __revalidadas() {
  return [...rutas];
}
export function __resetRevalidadas() {
  rutas = [];
}
export function revalidatePath(ruta) {
  rutas.push(ruta);
}