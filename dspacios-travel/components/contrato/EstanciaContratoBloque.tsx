// #88 — Estancia de un contrato de programa por hotel y vigencia: hotel, servicios, fechas
// exactas, vigencia del precio base, noches adicionales (con la vigencia y el valor de CADA
// noche) e itinerario con los días libres. Es la FOTO congelada al reservar
// (`contrato_programa_estancia`): nunca se recalcula y no lleva netos.
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { ETIQUETA_MODALIDAD, ETIQUETA_UNIDAD, type ModalidadServicios, type UnidadCobro } from "@/lib/programas/estanciaHotel88";

type NocheFoto = { fecha: string; vigencia_desde: string; vigencia_hasta: string; unidad: UnidadCobro; pvp_total: number };
type DiaFoto = { dia: number; titulo: string | null; fecha: string | null; libre: boolean };

export type EstanciaContratoVista = {
  hotel_nombre: string;
  zona: string | null;
  tipo_habitacion: string | null;
  modalidad_servicios: string;
  moneda: string;
  fecha_entrada: string;
  noches_incluidas: number;
  noches_adicionales: number;
  fecha_regreso: string;
  base_vigencia_desde: string;
  base_vigencia_hasta: string;
  precio_base: number;
  precio_noches: number;
  noches: unknown;
  itinerario: unknown;
};

const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function EstanciaContratoBloque({ estancia: e }: { estancia: EstanciaContratoVista }) {
  const noches = lista<NocheFoto>(e.noches);
  const itinerario = lista<DiaFoto>(e.itinerario);
  const modalidad = ETIQUETA_MODALIDAD[e.modalidad_servicios as ModalidadServicios] ?? e.modalidad_servicios;
  return (
    <section className="break-inside-avoid rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700" aria-label="Estancia y noches adicionales">
      <h2 className="mb-2 text-sm font-semibold text-gray-800">Estancia y noches adicionales</h2>
      <p>
        <strong>{e.hotel_nombre}</strong>
        {[e.zona, e.tipo_habitacion].filter(Boolean).length ? ` · ${[e.zona, e.tipo_habitacion].filter(Boolean).join(" · ")}` : ""} · {modalidad}
      </p>
      <p className="mt-1 text-xs text-gray-600">
        Entrada {formatFechaLarga(e.fecha_entrada)} · {e.noches_incluidas} noche(s) incluidas
        {e.noches_adicionales > 0 ? ` + ${e.noches_adicionales} adicional(es)` : ""} · Regreso {formatFechaLarga(e.fecha_regreso)}.
        Precio base vigente para entradas del {formatFechaLarga(e.base_vigencia_desde)} al {formatFechaLarga(e.base_vigencia_hasta)}: {formatMoneda(e.precio_base, e.moneda)}.
      </p>
      {noches.length > 0 && (
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="text-left uppercase tracking-wide text-gray-400">
              <th className="py-1 pr-2">Noche adicional</th><th className="py-1 pr-2">Vigencia aplicada</th><th className="py-1 pr-2">Se cobra</th><th className="py-1 text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {noches.map((n) => (
              <tr key={n.fecha} className="border-t border-gray-100">
                <td className="py-1 pr-2">{formatFechaLarga(n.fecha)}</td>
                <td className="py-1 pr-2 text-gray-500">{formatFechaLarga(n.vigencia_desde)} — {formatFechaLarga(n.vigencia_hasta)}</td>
                <td className="py-1 pr-2 text-gray-500">{ETIQUETA_UNIDAD[n.unidad] ?? n.unidad}</td>
                <td className="py-1 text-right tabular-nums">{formatMoneda(n.pvp_total, e.moneda)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 font-medium">
              <td className="py-1" colSpan={3}>Total noches adicionales</td>
              <td className="py-1 text-right tabular-nums">{formatMoneda(e.precio_noches, e.moneda)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      {itinerario.length > 0 && (
        <ol className="mt-3 space-y-0.5 text-xs text-gray-600" aria-label="Itinerario de la reserva">
          {itinerario.map((d) => (
            <li key={d.dia}>
              Día {d.dia}{d.fecha ? ` · ${formatFechaLarga(d.fecha)}` : ""}: {d.titulo ?? "—"}{d.libre ? " (noche adicional)" : ""}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
