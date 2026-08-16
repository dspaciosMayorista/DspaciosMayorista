import { EstadoBadge } from "@/components/EstadoBadge";
import {
  labelModalidad, labelEstadoEmision, labelEstadoPago,
  tonoModalidad, tonoEstadoEmision, tonoEstadoPago,
} from "@/lib/vuelos/control";

// Los tres badges de control del record (migración 152): modalidad, estado
// de emisión y estado de pago. El tono SIEMPRE viene de los helpers
// centralizados de lib/vuelos/control.ts (tonoModalidad/tonoEstadoEmision/
// tonoEstadoPago) — los mismos que usa `ControlVuelosTabla`, para que la
// lista y este detalle se vean idénticos. Nunca se deja que `EstadoBadge`
// infiera el tono del texto: "Por confirmar" contiene "confirm" y el
// inferidor genérico lo leía como verde (`ok`), igual que Emitido/Pagado.
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
      <EstadoBadge estado={labelModalidad(modalidad)} tono={tonoModalidad(modalidad)} />
      <EstadoBadge estado={labelEstadoEmision(estadoEmision)} tono={tonoEstadoEmision(estadoEmision)} />
      <EstadoBadge estado={labelEstadoPago(estadoPago)} tono={tonoEstadoPago(estadoPago)} />
    </span>
  );
}
