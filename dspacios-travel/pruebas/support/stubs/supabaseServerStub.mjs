// Stub de "@/lib/supabase/server" para las Server Actions reales de pagos y
// del catálogo de proveedores. reactLoader lo resuelve solo para esos padres.
// El cliente real arrastra
// "next/headers" (contexto de request de Next, no resoluble aquí). `createClient`
// devuelve el cliente configurado con `__setClient`; si nadie lo configuró,
// falla con un error claro (no silencia en falso un uso inesperado).
let cliente = null;

export function __setClient(sb) {
  cliente = sb;
}
export function __resetClient() {
  cliente = null;
}
export async function createClient() {
  if (!cliente) throw new Error("supabaseServerStub: llama a __setClient(sb) antes de ejecutar la action");
  return cliente;
}
