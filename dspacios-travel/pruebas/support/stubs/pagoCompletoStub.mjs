// Stub de "@/lib/voucher/pagoCompleto" (#53, migración 307) para las pruebas React del portal B2B: el módulo real es server-only y usa el cliente admin.
// Falla CERRADO como el real ante cualquier duda: ningún contrato se considera pagado por completo (el acceso a vouchers del aliado queda negado).
export async function contratosPagadosCompletos() { return null; }
export async function contratoPagadoCompleto() { return false; }
