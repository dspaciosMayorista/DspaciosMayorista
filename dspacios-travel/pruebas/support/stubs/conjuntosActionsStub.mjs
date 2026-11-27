// Stub de "./conjuntos-actions" (Server Actions de los conjuntos de fechas, migración 327) para las pruebas React que renderizan HotelDetalleClient (cargadas por pruebas/support/reactLoader.mjs).
// El archivo real es "use server" y termina importando "@/lib/supabase/server" → "next/headers". Ninguna de esas pruebas guarda conjuntos: si alguna lo hiciera sin configurarlo, falla claro.
let impls = {};
export function __setImpls(next) { impls = { ...impls, ...next }; }
const noImpl = (n) => { throw new Error(`${n}: no implementado en el stub de pruebas — usa __setImpls({ ${n} })`); };
export async function crearConjuntoFechas(...a) { return impls.crearConjuntoFechas ? impls.crearConjuntoFechas(...a) : noImpl("crearConjuntoFechas"); }
export async function actualizarConjuntoFechas(...a) { return impls.actualizarConjuntoFechas ? impls.actualizarConjuntoFechas(...a) : noImpl("actualizarConjuntoFechas"); }
export async function eliminarConjuntoFechas(...a) { return impls.eliminarConjuntoFechas ? impls.eliminarConjuntoFechas(...a) : noImpl("eliminarConjuntoFechas"); }
