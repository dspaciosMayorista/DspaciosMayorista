import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { formatMoneda } from "@/lib/utils";
import { EtiquetaDescuentoHotel } from "@/components/cotizacion/EtiquetaDescuentoHotel";
import type { Composicion, ComposicionCotizacion } from "@/lib/cotizacion/composicionPrecio";

const ROTULO_ADICIONAL = { servicio_opcional: "Servicio opcional", servicio_grupo: "Servicio incluido por grupo", mascota: "Mascota", ajuste_redondeo: "Ajuste de redondeo" } as const;

function Hotel({ nombre, c, totalCotizacion }: { nombre: string | null; c: Composicion; totalCotizacion: number | null }) {
  const m = c.moneda;
  const noCuadraConCotizacion = totalCotizacion != null && Math.abs(totalCotizacion - c.total) > 0.01;
  return (
    <div className="mt-3 rounded-lg border border-gray-100" data-testid="composicion-hotel">
      {nombre && <div className="border-b border-gray-100 px-4 py-2 text-sm font-medium text-gray-700">{nombre}</div>}
      {c.descuentoHotel && <div className="border-b border-gray-100 px-4 py-2"><EtiquetaDescuentoHotel descuento={c.descuentoHotel} /></div>}
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
              ...(l.habitacion ? [
                <tr key={`${l.clave}-hab`} className="text-gray-600" data-testid="composicion-descuento-habitacion">
                  <td colSpan={5} className="py-1.5 pl-8 pr-4 text-xs">
                    Descuento por habitación: {formatMoneda(l.habitacion.descuento, m)} por habitación
                    (reparto por ocupante: {l.habitacion.repartoDescuento.map((x) => formatMoneda(x, m)).join(" + ")}) ·
                    neto exacto por habitación {formatMoneda(l.habitacion.netoPorHabitacion, m)} × {l.habitacion.habitaciones} = {formatMoneda(l.habitacion.netoHotelLinea, m)}
                  </td>
                </tr>,
              ] : []),
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

const ROTULO_SERVICIO = { tour: "Servicio / tour", vuelo: "Vuelo (manual)", otro: "Servicio (manual)" } as const;

// Composición del precio tal como se guardó al cotizar (privada: lleva netas y markup). Solo se monta para roles con acceso a costos.
// Concilia TODOS los componentes: composición de cada hotel + servicios del carrito (se cobran fuera del hotel) = total de la cotización.
export function ComposicionPrecio({ guardada, totalCotizacion, recobro = 0 }: { guardada: ComposicionCotizacion | null; totalCotizacion: number | null; /** #14-A: recobro del carrito. Va DENTRO de la tarifa de adulto y no tiene componente propio: se suma aquí para que la conciliación cuadre con el precio (vista interna, solo roles con acceso a costos). */ recobro?: number }) {
  if (!guardada) {
    return (
      <p className="mt-6 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm text-gray-500" data-testid="composicion-no-conservada">
        Composición por componente: el desglose (hotel, vuelo, servicios, markup y redondeo) no fue conservado para esta cotización. Solo se conservan los renglones y el total.
      </p>
    );
  }
  const servicios = guardada.servicios ?? [];
  const m = guardada.hoteles[0].composicion.moneda;
  const sumaHoteles = guardada.hoteles.reduce((t, h) => t + h.composicion.total, 0);
  const sumaServicios = servicios.reduce((t, x) => t + x.total, 0);
  const suma = Math.round((sumaHoteles + sumaServicios + recobro) * 100) / 100;
  const mezcla = servicios.some((x) => x.moneda !== m);
  // Total contra el que se concilia: el de la cotización viva si llega; si no, el que se guardó junto a la composición.
  const total = totalCotizacion ?? guardada.total ?? null;
  const difiere = total != null && Math.abs(total - suma) > 0.01;
  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5" data-testid="composicion-precio">
      <h2 className="text-sm font-semibold text-gray-700">Composición del precio (guardada al cotizar)</h2>
      <p className="mt-1 text-xs text-gray-500">Importes que produjo el motor en ese momento, sin recalcular. Netos y markup: solo roles con acceso a costos.</p>
      {guardada.hoteles.map((h, i) => (
        <Hotel key={`${h.ref ?? "h"}-${i}`} nombre={guardada.hoteles.length > 1 || servicios.length > 0 ? h.nombre : null} c={h.composicion} totalCotizacion={null} />
      ))}
      {servicios.length > 0 && (
        <div className="mt-3 rounded-lg border border-gray-100" data-testid="composicion-servicios">
          <div className="border-b border-gray-100 px-4 py-2 text-sm font-medium text-gray-700">Servicios del carrito (se cobran fuera de la composición del hotel)</div>
          <ResponsiveTableShell minWidth={560} className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                <th className="px-4 py-2">Servicio</th><th className="px-4 py-2">Clase</th><th className="px-4 py-2 text-right">Neto</th><th className="px-4 py-2 text-right">Pax</th><th className="px-4 py-2 text-right">Venta total</th>
              </tr></thead>
              <tbody>
                {servicios.map((x, i) => (
                  <tr key={i} className="border-t border-gray-100 text-gray-700" data-testid="composicion-servicio">
                    <td className="px-4 py-2">{x.nombre}</td>
                    <td className="px-4 py-2 text-gray-500">{ROTULO_SERVICIO[x.tipo]}</td>
                    <td className="px-4 py-2 text-right text-gray-400">—</td>
                    <td className="px-4 py-2 text-right tabular-nums">{x.pax ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoneda(x.total, x.moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTableShell>
          <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">Neto no conservado: el servicio se cotizó con su precio de venta (el manual lo declara el asesor); no se deduce ni se recalcula con tarifas actuales.</p>
        </div>
      )}
      <div className="mt-3 space-y-1 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600" data-testid="composicion-concilia">
        <p>
          {guardada.hoteles.length > 1 ? "Hoteles" : "Hotel"} {formatMoneda(sumaHoteles, m)}{servicios.length > 0 && <> + servicios del carrito {formatMoneda(sumaServicios, m)}</>}{recobro > 0 && <> + recobro (dentro de la tarifa de adulto) {formatMoneda(recobro, m)}</>} = <b>{formatMoneda(suma, m)}</b>
          {total != null && <> · precio de la cotización {formatMoneda(total, m)}</>}
        </p>
        {mezcla && <p className="text-amber-700" data-testid="composicion-monedas">Hay servicios en una moneda distinta de la del hotel: la suma no es comparable.</p>}
        {difiere && !mezcla && (
          <p className="text-amber-700" data-testid="composicion-difiere">
            El total de la composición ({formatMoneda(suma, m)}) difiere del precio de la cotización ({formatMoneda(total!, m)}).
            {guardada.servicios === undefined && " Esta cotización se guardó antes de conservar los servicios del carrito: su composición solo incluye el hotel."}
          </p>
        )}
        {!difiere && total != null && !mezcla && <p className="text-emerald-700" data-testid="composicion-cuadra">La composición cuadra con el precio de la cotización.</p>}
      </div>
    </div>
  );
}
