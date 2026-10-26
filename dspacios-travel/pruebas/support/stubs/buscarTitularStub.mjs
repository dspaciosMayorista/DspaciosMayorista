// Stub configurable de "@/lib/personas/buscarTitular" (#40 E2) para las pruebas React: el real es "use server" y llega a next/headers.
let impl = null;
export function __setBuscarTitularPorNumero(fn) { impl = fn; }
export async function buscarTitularPorNumero(numero) {
  if (impl) return impl(numero);
  throw new Error("buscarTitularPorNumero: no implementado en el stub de pruebas");
}
