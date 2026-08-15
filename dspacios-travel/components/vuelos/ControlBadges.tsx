import { EstadoBadge } from "@/components/EstadoBadge";
import { labelModalidad, labelEstadoEmision, labelEstadoPago } from "@/lib/vuelos/control";

// Los tres badges de control del record (migración 151): modalidad, estado
// de emisión y estado de pago. Reutiliza `EstadoBadge` (infiere el tono del
// TEXTO: "Emitido"/"Pagado" → verde, "Pendiente" → ámbar, "Sin definir"/
// "Por confirmar" → gris neutro, sin necesidad de mapear colores aparte).
export function ControlBadges({
  modalidad,
  estadoEmision,
  estadoPago,
  className = "",
}: {
  modalidad: string | null;
  estadoEmision: string | null;
  estadoPago: string | null;
  className?: string;
}) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      <EstadoBadge estado={labelModalidad(modalidad)} tono="neutral" />
      <EstadoBadge estado={labelEstadoEmision(estadoEmision)} />
      <EstadoBadge estado={labelEstadoPago(estadoPago)} />
    </span>
  );
}
