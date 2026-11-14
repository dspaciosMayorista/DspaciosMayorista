import { formatFechaLarga } from "@/lib/utils";
import type { ServicioDocumento } from "@/lib/contrato/serviciosDocumento";

// Sección «Servicios incluidos» del documento del cliente: qué incluye cada servicio, cuándo y a quién cubre. SIN importes: el valor de los servicios ya está dentro de las tarifas por
// pasajero del paquete, así que no se repite ni se separa por servicio. Solo dibuja lo que le dan `serviciosDeDocumento`; no calcula nada.
function Fechas({ s }: { s: ServicioDocumento }) {
  if (!s.fechaIda) return <span className="text-gray-400">Por confirmar</span>;
  if (!s.fechaRegreso || s.fechaRegreso === s.fechaIda) return <>{formatFechaLarga(s.fechaIda)}</>;
  return <>{formatFechaLarga(s.fechaIda)} <span className="text-gray-400">→</span> {formatFechaLarga(s.fechaRegreso)}</>;
}

export function ServiciosIncluidos({ servicios, color }: { servicios: readonly ServicioDocumento[]; color?: string }) {
  if (!servicios.length) return null;
  return (
    <div className="mt-3" data-testid="servicios-incluidos">
      <h3 className="mb-1 break-after-avoid text-xs font-semibold" style={color ? { color } : undefined}>Servicios incluidos</h3>
      {/* Teléfono: una tarjeta por servicio. Desde sm y al imprimir: la tabla. */}
      <ul className="space-y-2 sm:hidden print:hidden" data-testid="servicios-incluidos-movil">
        {servicios.map((s, i) => (
          <li key={`${s.nombre}-${i}`} className="break-inside-avoid rounded-lg border border-gray-200 p-3 text-xs">
            <p className="font-semibold text-gray-800">{s.nombre}</p>
            <p className="mt-1 text-gray-600"><span className="text-gray-400">Fechas · </span><Fechas s={s} /></p>
            <p className="text-gray-600"><span className="text-gray-400">Cubre a · </span>{s.cubre}</p>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block print:block">
        <table className="w-full min-w-[360px] border-collapse text-xs">
          <thead className="break-inside-avoid break-after-avoid">
            <tr className="bg-gray-50 text-left text-gray-500">
              <th className="border border-gray-200 px-2 py-1">Servicio</th>
              <th className="border border-gray-200 px-2 py-1">Fechas</th>
              <th className="border border-gray-200 px-2 py-1">A quién cubre</th>
            </tr>
          </thead>
          <tbody>
            {servicios.map((s, i) => (
              <tr key={`${s.nombre}-${i}`} className="break-inside-avoid" data-testid="servicio-incluido">
                <td className="border border-gray-200 px-2 py-1 font-medium">{s.nombre}</td>
                <td className="border border-gray-200 px-2 py-1"><Fechas s={s} /></td>
                <td className="border border-gray-200 px-2 py-1">{s.cubre}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-gray-500" data-testid="servicios-incluidos-nota">El valor de estos servicios está incluido en las tarifas por pasajero del paquete.</p>
    </div>
  );
}
