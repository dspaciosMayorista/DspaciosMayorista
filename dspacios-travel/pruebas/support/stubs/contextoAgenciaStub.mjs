// Stub de "@/lib/auth/contextoAgencia" (#5 D8/D9, migración 237). El real es
// server-only y usa next/headers + el cliente service-role: no cargable aquí.
// Las Server Actions de catálogos llaman a `exigirEscrituraCatalogoGlobal` antes
// de escribir; por defecto la compuerta ABRE (la frontera real se prueba contra
// Postgres en supabase/scripts/pruebas_237) y una prueba puede cerrarla con
// `__setCompuerta({ ok: false, error })` para ver que la acción no escribe.
let compuerta = { ok: true };
export const __llamadas = [];
export function __setCompuerta(v) { compuerta = v; }
export function __reset() { compuerta = { ok: true }; __llamadas.length = 0; }
export async function exigirEscrituraCatalogoGlobal() {
  __llamadas.push("exigirEscrituraCatalogoGlobal");
  return compuerta;
}
export async function iniciarContextoAgencia() {
  __llamadas.push("iniciarContextoAgencia");
  return { ok: true, codigo: "ok" };
}
export async function cambiarContextoAgencia() {
  __llamadas.push("cambiarContextoAgencia");
  return { ok: true, codigo: "ok" };
}
