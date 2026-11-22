import { Fragment } from "react";
import Link from "next/link";
import { TablaScroll, Vacio } from "@/components/portal/PortalShell";
import { ValorCotizacion } from "@/components/cotizacion/ValorCotizacion";
import { formatFechaLarga, formatMoneda } from "@/lib/utils";
import { numeroVisible } from "@/lib/tenant";
import { estadoCotizacion } from "@/lib/portal/b2bPortal";
import type { CotizacionFila } from "@/lib/portal/b2bPortalServidor";
import { BotonSolicitarContrato } from "@/components/portal/BotonSolicitarContrato";
import { puedeSolicitarContrato, type SolicitudContrato } from "@/lib/portal/solicitudContrato";
import type { ContratoVigente } from "@/lib/portal/valorContrato";
import { PanelPreparacionContrato } from "@/components/portal/PanelPreparacionContrato";
import type { PreparacionCotizacion } from "@/lib/portal/preparacionContrato";

const ESTADO: Record<string, { label: string; clase: string }> = {
  convertida: { label: "Convertida", clase: "bg-[rgba(102,181,150,0.18)] text-[#3f7d63]" },
  elegida: { label: "Opción elegida", clase: "bg-[rgba(102,181,150,0.18)] text-[#3f7d63]" },
  salida_pasada: { label: "Salida pasada · genera una nueva", clase: "bg-red-50 text-red-700" },
  vencida: { label: "Vencida", clase: "bg-red-50 text-red-700" },
  vigente: { label: "Vigente", clase: "bg-gray-100 text-gray-500" },
};

const MODALIDAD = (m: string | null | undefined) => (m === "neta" ? "Neto" : m === "comisionable" ? "PVP con comisión" : "Estándar");

/** #84: `contratos` = valor VIGENTE de los contratos acreditados al aliado (por número). Una cotización convertida sin entrada aquí conserva solo su valor cotizado. */
export function TablaCotizaciones({ filas, hoy, vacio, contratos, solicitudes = {}, preparaciones = {} }: { filas: CotizacionFila[]; hoy: string; vacio: React.ReactNode; contratos?: ReadonlyMap<string, ContratoVigente>; solicitudes?: Record<number, SolicitudContrato>; /** O-3: comprobantes y pasajeros adicionales ya guardados, por cotización. */ preparaciones?: Record<number, PreparacionCotizacion> }) {
  if (filas.length === 0) return <Vacio>{vacio}</Vacio>;
  return (
    <TablaScroll etiqueta="Cotizaciones" ancho="min-w-[980px]" apilar>
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
          const ct = est === "convertida" && c.numero_contrato ? contratos?.get(c.numero_contrato) : undefined;
          return (
            <Fragment key={c.id}>
            <tr className="border-t border-gray-50">
              <th scope="row" className="px-3 py-2 text-left font-mono font-semibold text-[#1D7C9A]">{c.codigo ?? `#${c.id}`}</th>
              <td data-label="Cliente" className="px-3 py-2 text-gray-700">{c.cliente ?? "—"}</td>
              <td data-label="Destino" className="px-3 py-2 text-gray-600">{c.destino ?? c.hotel ?? "—"}</td>
              <td data-label="Salida" className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(c.fecha_salida)}</td>
              <td data-label="Vigencia" className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(c.vigencia_hasta)}</td>
              <td data-label="Estado" className="px-3 py-2 text-xs"><span className={`rounded-full px-2 py-0.5 font-medium ${e.clase}`} data-testid={est === "salida_pasada" ? "b2b-salida-pasada" : undefined}>{e.label}</span></td>
              <td data-label="Modalidad" className="px-3 py-2 text-xs text-gray-600">{MODALIDAD(c.b2b_modo)}</td>
              <td data-label="Importe" className="px-3 py-2 text-right tabular-nums">
                {ct ? (
                  <>
                    <span className="block" data-testid="valor-contrato"><span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Valor del contrato</span>{formatMoneda(ct.valor, ct.moneda)}</span>
                    <span className="block text-[11px] text-gray-400" data-testid="valor-cotizado">Valor cotizado: <ValorCotizacion modo={c.b2b_modo} precioVenta={c.precio_venta} totalExigible={c.b2b_total} moneda={c.moneda} /></span>
                    {ct.anulado && <span className="block text-[11px] font-medium text-red-600">Contrato anulado</span>}
                  </>
                ) : (
                  <>
                    <ValorCotizacion modo={c.b2b_modo} precioVenta={c.precio_venta} totalExigible={c.b2b_total} moneda={c.moneda} />
                    {est === "convertida" && <span className="block text-[10px] text-gray-400" data-testid="solo-cotizado">Valor cotizado</span>}
                  </>
                )}
              </td>
              <td data-label="Documento" className="px-3 py-2 text-right">
                {est === "convertida" ? (
                  ct ? (
                    <Link href={`/portal/b2b/ventas?vista=${ct.vista}#contrato-${encodeURIComponent(ct.numero)}`} className="text-xs font-medium hover:underline" style={{ color: "var(--brand-primary)" }} data-testid="enlace-contrato">Contrato {numeroVisible(ct.numero)}</Link>
                  ) : <span className="text-xs text-gray-400">Contrato {c.numero_contrato}</span>
                ) : c.share_token ? (
                  <a href={`/cot/${c.share_token}`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>Ver / descargar</a>
                ) : <span className="text-xs text-gray-400">No disponible</span>}
                {puedeSolicitarContrato(est, c.modo) && <BotonSolicitarContrato cotizacionId={c.id} solicitud={solicitudes[c.id] ?? null} />}
              </td>
            </tr>
            {puedeSolicitarContrato(est, c.modo) && (
              <tr>
                <td colSpan={9} data-label="" className="px-3 pb-3 pt-0" style={{ gridColumn: "1 / -1" }}>
                  <PanelPreparacionContrato cotizacionId={c.id} pax={c.pax} prep={preparaciones[c.id] ?? { evidencias: [], pasajeros: [], captura: { ok: false, motivo: "No pudimos comprobar si esta cotización admite pasajeros adicionales." }, universo: { tipo: "exacto", n: 1 } }} hoy={hoy} />
                </td>
              </tr>
            )}
            </Fragment>
          );
        })}
      </tbody>
    </TablaScroll>
  );
}
