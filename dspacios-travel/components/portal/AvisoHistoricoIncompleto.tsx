/** El listado de contratos del aliado no se pudo leer completo: nunca se presenta como histórico completo. */
export function AvisoHistoricoIncompleto() {
  return (
    <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      No pudimos leer todo tu historial de contratos, así que lo que ves puede estar incompleto (contratos, saldos y documentos). Intenta más tarde o comunícate con tu asesor.
    </p>
  );
}
