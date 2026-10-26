import { formatMoneda } from "@/lib/utils";
import { valorParaListado } from "@/lib/cotizacion/identidadB2B";

// #102 — Importe de una cotización en el listado, con la indicación de qué importe es. NETO = total exigible congelado (PVP − comisión);
// PVP = el PVP de una venta con comisión. Sin modalidad (histórica o B2C) solo se muestra el precio guardado, sin etiqueta. La comparativa conserva su
// regla «desde» (mínimo real entre sus opciones). Sin hooks: sirve igual en servidor y en cliente.
type Props =
  | { desde: { total: number; moneda: string } | null; modo?: undefined; precioVenta?: undefined; totalExigible?: undefined; moneda?: undefined }
  | { desde?: undefined; modo?: string | null; precioVenta?: number | string | null; totalExigible?: number | string | null; moneda?: string | null };

export function ValorCotizacion(props: Props) {
  if (props.desde !== undefined) {
    const d = props.desde;
    return d
      ? <span title="Valor mínimo entre las opciones; cada hotel tiene su propio total">desde {formatMoneda(d.total, d.moneda)}</span>
      : <span>—</span>;
  }
  const v = valorParaListado(props);
  if (v.revisar) {
    return (
      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700" data-testid="revisar-importe" title="Cotización NETO sin total exigible congelado válido: no se muestra ningún importe">
        Revisar importe
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      {v.etiqueta && (
        <span
          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${v.etiqueta === "NETO" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}
          title={v.etiqueta === "NETO" ? "Total exigible NETO (PVP − comisión del aliado)" : "PVP con comisión: la comisión queda pendiente"}
          data-testid="etiqueta-modalidad"
        >
          {v.etiqueta}
        </span>
      )}
      <span>{formatMoneda(v.valor, v.moneda)}</span>
    </span>
  );
}
