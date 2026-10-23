// Stub de "app/(dashboard)/dashboard/contabilidad/facturacion/actions" para
// las pruebas de interacción React (pruebas/tablasMoviles49.react.ts). El
// archivo real es "use server" y termina importando "@/lib/supabase/server",
// "next/cache" y "@/lib/contabilidad/asientos" -> "next/headers".
//
// La prueba monta FacturacionClient y comprueba la presentación (fichas
// apiladas, etiquetas y acciones); nunca emite ni guarda nada de verdad.
let impls = {};
export function __setImpls(next) {
  impls = { ...impls, ...next };
}
const ok = async () => ({ ok: true });
export async function guardarFacturacion(input) {
  if (impls.guardarFacturacion) return impls.guardarFacturacion(input);
  return ok();
}
export async function quitarFacturacion(numeroContrato) {
  if (impls.quitarFacturacion) return impls.quitarFacturacion(numeroContrato);
  return ok();
}
export async function marcarDian(numeroContrato, emitida) {
  if (impls.marcarDian) return impls.marcarDian(numeroContrato, emitida);
  return ok();
}
export async function contabilizarAbonosPendientes(numeroContrato) {
  if (impls.contabilizarAbonosPendientes) return impls.contabilizarAbonosPendientes(numeroContrato);
  return { ok: true, contabilizados: 0 };
}
