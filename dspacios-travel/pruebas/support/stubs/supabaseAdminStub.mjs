// Stub de "@/lib/supabase/admin" para la Server Action REAL del registro B2B
// (`app/portal/registro/actions.ts`, pruebas/registroSolicitudB2BAction.react.ts).
// El cliente service-role real necesita la llave de servicio; aquí la prueba
// inyecta un cliente simulado con `__setAdmin`. Sin configurar, falla claro.
let cliente = null;
export function __setAdmin(sb) { cliente = sb; }
export function __resetAdmin() { cliente = null; }
export function createAdminClient() {
  if (!cliente) throw new Error("supabaseAdminStub: llama a __setAdmin(sb) antes de ejecutar la action");
  return cliente;
}
