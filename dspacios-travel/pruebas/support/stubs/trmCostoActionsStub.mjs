// Stub de "contratos/[numero]/trm-costo-actions" (Server Action real: next/headers + Supabase) para las pruebas React del panel de obligaciones previstas.
let impl = null;
export function __setImpl(fn) { impl = fn; }
export async function corregirTrmCostoPrevista(...args) {
  if (impl) return impl(...args);
  throw new Error("corregirTrmCostoPrevista: no implementado en el stub de pruebas — usa __setImpl");
}
