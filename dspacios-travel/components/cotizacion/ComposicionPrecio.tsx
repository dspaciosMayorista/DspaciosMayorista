import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { formatMoneda } from "@/lib/utils";
import type { Composicion, ComposicionCotizacion } from "@/lib/cotizacion/composicionPrecio";

const ROTULO_ADICIONAL = { servicio_opcional: "Servicio opcional", servicio_grupo: "Servicio incluido por grupo", mascota: "Mascota", ajuste_redondeo: "Ajuste de redondeo" } as const;

function Hotel({ nombre, c, totalCotizacion }: { nombre: string | null; c: Composicion; totalCotizacion: number | null }) {
  const m = c.moneda;
  const noCuadraConCotizacion = totalCotizacion != null && Math.abs(totalCotizacion - c.total) > 0.01;
  return (
    <div className="mt-3 rounded-lg border border-gray-100" data-testid="composicion-hotel">
      {nombre && <div className="border-b border-gray-100 px-4 py-2 text-sm font-medium text-gray-700">{nombre}</div>}
      <ResponsiveTableShell minWidth={560} className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
            <th className="px-4 py-2">Componente</th><th className="px-4 py-2 text-right">Neto p/p</th><th className="px-4 py-2 text-right">Venta p/p</th>
            <th className="px-4 py-2 text-right">Pax</th><th className="px-4 py-2 text-right">Subtotal venta</th>
          </tr></thead>
          <tbody>
            {c.lineas.map((l) => [
              <tr key={l.clave} className="border-t border-gray-100 bg-gray-50/60 font-medium text-gray-800">
                <td className="px-4 py-2">{l.etiqueta}</td>
                <td className="px-4 py-2 text-right text-gray-400">—</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoneda(l.pvpPorPersona, m)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{l.pax}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoneda(l.total, m)}</td>
              </tr>,
              ...(l.componentes ?? []).map((x, i) => (
                <tr key={`${l.clave}-${i}`} className="text-gray-600">
                  <td className="py-1.5 pl-8 pr-4">{x.nombre}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">
                    {x.neto == null ? "—" : formatMoneda(x.neto, m)}
                    {x.origen && <span className="block text-[10px] text-gray-400" data-testid="composicion-origen">{formatMoneda(x.origen.monto, x.origen.moneda)}{c.trm != null ? ` × TRM ${c.trm}` : ""}</span>}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{formatMoneda(x.venta, m)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{l.pax}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{formatMoneda(Math.round(x.venta * l.pax * 100) / 100, m)}</td>
                </tr>
              )),
              ...(l.componentes ? [] : [<tr key={`${l.clave}-n`}><td colSpan={5} className="py-1.5 pl-8 pr-4 text-xs text-amber-700" data-testid="composicion-sin-componentes">{l.nota ?? "Sin componentes verificables."}</td></tr>]),
            ])}
            {c.adicionales.map((x, i) => (
              <tr key={`a-${i}`} className="border-t border-gray-100 text-gray-700">
                <td className="px-4 py-2" colSpan={4}>{ROTULO_ADICIONAL[x.tipo]} · {x.nombre}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoneda(x.total, m)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 font-medium">
              <td className="px-4 py-2" colSpan={4}>Total de la composición</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatMoneda(c.total, m)}</td>
            </tr>
          </tfoot>
        </table>
      </ResponsiveTableShell>
      <div className="space-y-1 border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
        <p>Venta de cada componente = su neto con el markup global del paquete ({Math.round(c.markup.pct * 10000) / 100} %), como lo calculó el motor; el vuelo entra ya como precio vendible y el redondeo es una línea aparte. Moneda {m}{c.trm == null ? ", sin conversión (no hay TRM)" : `, TRM ${c.trm}`}.</p>
        {c.impuestoIncluido > 0 && <p>Dentro del precio: impuesto no comisionable de {formatMoneda(c.impuestoIncluido, m)} por pasajero con silla (informativo, no se suma).</p>}
        {!c.cuadra && <p className="text-amber-700" data-testid="composicion-no-cuadra">Las líneas guardadas no suman el total de la composición.</p>}
        {noCuadraConCotizacion && <p className="text-amber-700" data-testid="composicion-difiere">El total de la composición ({formatMoneda(c.total, m)}) difiere del precio de la cotización ({formatMoneda(totalCotizacion!, m)}).</p>}
      </div>
    </div>
  );
}

// Composición del precio tal como se guardó al cotizar (privada: lleva netas y markup). Solo se monta para roles con acceso a costos.
export function ComposicionPrecio({ guardada, totalCotizacion }: { guardada: ComposicionCotizacion | null; totalCotizacion: number | null }) {
  if (!guardada) {
    return (
      <p className="mt-6 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm text-gray-500" data-testid="composicion-no-conservada">
        Composición por componente: el desglose (hotel, vuelo, servicios, markup y redondeo) no fue conservado para esta cotización. Solo se conservan los renglones y el total.
      </p>
    );
  }
  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5" data-testid="composicion-precio">
      <h2 className="text-sm font-semibold text-gray-700">Composición del precio (guardada al cotizar)</h2>
      <p className="mt-1 text-xs text-gray-500">Importes que produjo el motor en ese momento, sin recalcular. Netos y markup: solo roles con acceso a costos.</p>
      {guardada.hoteles.map((h, i) => (
        <Hotel key={`${h.ref ?? "h"}-${i}`} nombre={guardada.hoteles.length > 1 ? h.nombre : null} c={h.composicion} totalCotizacion={guardada.hoteles.length === 1 ? totalCotizacion : null} />
      ))}
    </div>
  );
}
