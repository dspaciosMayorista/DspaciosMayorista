// Stub de "../paquetes/actions" cuando lo importa la Server Action REAL
// `app/(dashboard)/dashboard/vuelos/actions.ts` (cargada por
// pruebas/support/reactLoader.mjs). El archivo real arrastra el motor de
// tarifarios completo y el cliente de Supabase del servidor. Las acciones que
// se prueban hoy (borrarPasajeroSilla) no regeneran tarifarios: si alguna lo
// hiciera sin configurarlo, falla claro en vez de silenciarse.
let impls = {};
export function __setImpls(next) {
  impls = { ...impls, ...next };
}
export async function regenerarTarifariosDeBloqueo(...args) {
  if (impls.regenerarTarifariosDeBloqueo) return impls.regenerarTarifariosDeBloqueo(...args);
  throw new Error("regenerarTarifariosDeBloqueo: no implementado en el stub de pruebas");
}
export async function generarTarifario(...args) {
  if (impls.generarTarifario) return impls.generarTarifario(...args);
  throw new Error("generarTarifario: no implementado en el stub de pruebas");
}
