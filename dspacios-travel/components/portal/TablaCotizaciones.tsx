import { TablaScroll, Vacio } from "@/components/portal/PortalShell";
import { ValorCotizacion } from "@/components/cotizacion/ValorCotizacion";
import { formatFechaLarga } from "@/lib/utils";
import { estadoCotizacion } from "@/lib/portal/b2bPortal";
import type { CotizacionFila } from "@/lib/portal/b2bPortalServidor";

const ESTADO: Record<string, { label: string; clase: string }> = {
  convertida: { label: "Convertida", clase: "bg-[rgba(102,181,150,0.18)] text-[#3f7d63]" },
  elegida: { label: "Opción elegida", clase: "bg-[rgba(102,181,150,0.18)] text-[#3f7d63]" },
  salida_pasada: { label: "Salida pasada · genera una nueva", clase: "bg-red-50 text-red-700" },
  vencida: { label: "Vencida", clase: "bg-red-50 text-red-700" },
  vigente: { label: "Vigente", clase: "bg-gray-100 text-gray-500" },
};

const MODALIDAD = (m: string | null | undefined) => (m === "neta" ? "Neto" : m === "comisionable" ? "PVP con comisión" : "Estándar");

export function TablaCotizaciones({ filas, hoy, vacio }: { filas: CotizacionFila[]; hoy: string; vacio: React.ReactNode }) {
  if (filas.length === 0) return <Vacio>{vacio}</Vacio>;
  return (
    <TablaScroll etiqueta="Cotizaciones" ancho="min-w-[980px]">
      <thead>
        <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
          <th scope="col" className="px-3 py-2">Código</th><th scope="col" className="px-3 py-2">Cliente</th><th scope="col" className="px-3 py-2">Destino</th>
          <th scope="col" className="px-3 py-2">Salida</th><th scope="col" className="px-3 py-2">Vigencia</th><th scope="col" className="px-3 py-2">Estado</th>
          <th scope="col" className="px-3 py-2">Modalidad</th><th scope="col" className="px-3 py-2 text-right">Importe</th><th scope="col" className="px-3 py-2 text-right">Documento</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((c) => {
          const est = estadoCotizacion(c, hoy);
          const e = ESTADO[est];
          return (
            <tr key={c.id} className="border-t border-gray-50">
              <th scope="row" className="px-3 py-2 text-left font-mono font-semibold text-[#1D7C9A]">{c.codigo ?? `#${c.id}`}</th>
              <td className="px-3 py-2 text-gray-700">{c.cliente ?? "—"}</td>
              <td className="px-3 py-2 text-gray-600">{c.destino ?? c.hotel ?? "—"}</td>
              <td className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(c.fecha_salida)}</td>
              <td className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(c.vigencia_hasta)}</td>
              <td className="px-3 py-2 text-xs"><span className={`rounded-full px-2 py-0.5 font-medium ${e.clase}`} data-testid={est === "salida_pasada" ? "b2b-salida-pasada" : undefined}>{e.label}</span></td>
              <td className="px-3 py-2 text-xs text-gray-600">{MODALIDAD(c.b2b_modo)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                <ValorCotizacion modo={c.b2b_modo} precioVenta={c.precio_venta} totalExigible={c.b2b_total} moneda={c.moneda} />
              </td>
              <td className="px-3 py-2 text-right">
                {est === "convertida" ? (
                  <span className="text-xs text-gray-400">Contrato {c.numero_contrato}</span>
                ) : c.share_token ? (
                  <a href={`/cot/${c.share_token}`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>Ver / descargar</a>
                ) : <span className="text-xs text-gray-400">No disponible</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </TablaScroll>
  );
}
