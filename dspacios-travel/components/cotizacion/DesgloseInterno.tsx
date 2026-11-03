import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { formatMoneda } from "@/lib/utils";
import { desgloseInterno, type GrupoDesglose } from "@/lib/cotizacion/desgloseInterno";

const ROTULO: Record<GrupoDesglose, string> = {
  hotel: "Hotel y habitaciones", paquete: "Paquete", vuelo: "Vuelo", servicio: "Servicios", suplemento: "Suplementos", ajuste: "Ajuste de redondeo", otro: "Otro concepto (sin clasificar)",
};
const ORDEN: GrupoDesglose[] = ["hotel", "paquete", "vuelo", "servicio", "suplemento", "ajuste", "otro"];

// Detalle INTERNO de importes, leído tal como quedó congelado al cotizar (nunca recalculado). Solo se monta en fichas del dashboard.
export function DesgloseInterno({ cot, moneda, titulo = "Desglose de precio" }: { cot: { precio_venta: number | null; detalle: unknown }; moneda: string; titulo?: string }) {
  const d = desgloseInterno(cot);
  if (!d) {
    return (
      <p className="mt-6 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm text-gray-500" data-testid="desglose-ausente">
        {titulo}: esta cotización no conservó el detalle de importes; solo se guardó el total.
      </p>
    );
  }
  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white" data-testid="desglose-interno">
      <div className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-700">{titulo} ({moneda})</div>
      <ResponsiveTableShell minWidth={560} className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
            <th className="px-4 py-2">Concepto</th><th className="px-4 py-2 text-right">Cant.</th>
            <th className="px-4 py-2 text-right">Unitario</th><th className="px-4 py-2 text-right">Subtotal</th>
          </tr></thead>
          <tbody>
            {ORDEN.flatMap((g) => d.lineas.filter((l) => l.grupo === g).map((l, i) => (
              <tr key={`${g}-${i}`} className="border-t border-gray-50">
                <td className="px-4 py-2 text-gray-700" data-label={ROTULO[g]}>{l.descripcion}{g === "otro" && <span className="ml-2 text-[11px] text-gray-400">{ROTULO.otro}</span>}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500" data-label="Cant.">{l.cantidad ?? "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500" data-label="Unitario">{l.unitario == null ? "—" : formatMoneda(l.unitario, moneda)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-700" data-label="Subtotal">
                  {l.subtotal == null ? <span className="text-amber-700" data-testid="desglose-linea-incompleta">Importe no disponible</span> : formatMoneda(l.subtotal, moneda)}
                </td>
              </tr>
            )))}
          </tbody>
          <tfoot className="text-sm">
            <tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2" colSpan={3}>Total guardado</td>
              <td className="px-4 py-2 text-right tabular-nums">{d.total == null ? <span className="text-amber-700">No disponible</span> : formatMoneda(d.total, moneda)}</td>
            </tr>
          </tfoot>
        </table>
      </ResponsiveTableShell>
      {(d.incompleto || !d.cuadra || d.avisos.length > 0) && (
        <div className="space-y-1 border-t border-gray-100 px-5 py-3 text-xs text-amber-700" data-testid="desglose-avisos">
          {d.incompleto && <p>Detalle incompleto: algún importe guardado falta o no es válido, así que la suma de los renglones no se compara con el total.</p>}
          {!d.incompleto && !d.cuadra && d.diferencia != null && <p>Los renglones guardados suman {formatMoneda(d.suma, moneda)}; el total guardado difiere en {formatMoneda(d.diferencia, moneda)}. No se reparte ni se ajusta.</p>}
          {d.avisos.map((a) => <p key={a}>{a}</p>)}
        </div>
      )}
    </div>
  );
}
