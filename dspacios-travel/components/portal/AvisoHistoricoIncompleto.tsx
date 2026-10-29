import { Aviso } from "@/components/portal/PortalShell";

/** El listado de contratos del aliado no se pudo leer completo: nunca se presenta como histórico completo. */
export function AvisoHistoricoIncompleto() {
  return (
    <Aviso>
      No pudimos leer todo tu historial de contratos, así que lo que ves puede estar incompleto (contratos, saldos y documentos). Intenta más tarde o comunícate con tu asesor.
    </Aviso>
  );
}
