// Movimientos históricos de un record: presentación pura (sin estado), apta para servidor.
// Todo dato que no se guardó se dice «No guardado»; nada se deduce del texto libre del motivo.
// Rev2 B1-01: lista COMPACTA — cada movimiento es un <details> cerrado (título, fecha/hora de Bogotá y descripción de una línea); el detalle completo se abre por movimiento y los más antiguos
// (más de VISIBLES_AL_ABRIR) quedan tras un solo «Ver N movimientos anteriores». Sin estado de cliente: <details> nativo, apto para servidor, y todo el contenido sigue en el HTML.
import { ChevronDown } from "lucide-react";
import { fechaHoraBogota } from "@/lib/gestionContratos/presentacion";
import { describirEntrada, tituloEntrada, type EntradaHistorial } from "@/lib/vuelos/historial";

const NO_GUARDADO = <span className="text-gray-400">No guardado</span>;
const NO_APLICA = <span className="text-gray-400">No aplica</span>;

function Dato({ etiqueta, children, clase = "" }: { etiqueta: string; children: React.ReactNode; clase?: string }) {
  return (
    <div className={`min-w-0 ${clase}`}>
      <dt className="text-[11px] uppercase tracking-wide text-gray-400">{etiqueta}</dt>
      <dd className="break-words text-gray-700">{children}</dd>
    </div>
  );
}

/** Cuántos movimientos se ven sin pulsar nada (los más recientes); el resto va tras «Ver N movimientos anteriores». */
export const VISIBLES_AL_ABRIR = 5;

function Movimiento({ e, bloqueoId, recordDe }: { e: EntradaHistorial; bloqueoId: number; recordDe: (id: number | null) => string }) {
  const entra = e.destinoId === bloqueoId;
  const retiro = e.tipo === "retiro_cupo";
  const borde = retiro ? "border-l-gray-300" : entra ? "border-l-sky-300" : "border-l-purple-300";
  const par = (v: [number, number] | null, aplica: boolean) => (!aplica ? NO_APLICA : v ? `${v[0]} → ${v[1]}` : NO_GUARDADO);
  return (
    <li className={`rounded-lg border border-l-4 border-gray-100 text-xs ${borde}`} data-testid="movimiento-historial">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2 p-3 [&::-webkit-details-marker]:hidden">
          <ChevronDown aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-sm font-semibold text-gray-700">{tituloEntrada(e)}</span>
              <time dateTime={e.fecha} className="tabular-nums text-gray-500">{fechaHoraBogota(e.fecha)} <span className="text-gray-400">(hora de Bogotá)</span></time>
            </span>
            <span className="mt-0.5 block text-gray-600">{describirEntrada(e, bloqueoId, recordDe)}</span>
          </span>
        </summary>
        <div className="border-t border-gray-100 px-3 pb-3 pt-2">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 lg:grid-cols-4">
            <Dato etiqueta="Registrado por" clase="col-span-2 lg:col-span-1">{e.registradoPor ?? NO_GUARDADO}</Dato>
            <Dato etiqueta="Cantidad">{e.sillas} {e.sillas === 1 ? "silla" : "sillas"}</Dato>
            <Dato etiqueta="Record origen">{e.origenId != null ? recordDe(e.origenId) : NO_GUARDADO}</Dato>
            <Dato etiqueta="Record destino">{e.destinoId != null ? recordDe(e.destinoId) : retiro ? NO_APLICA : NO_GUARDADO}</Dato>
            <Dato etiqueta="Cupos origen (antes → después)">{par(e.cuposOrigen, true)}</Dato>
            <Dato etiqueta="Cupos destino (antes → después)">{par(e.cuposDestino, !retiro)}</Dato>
            <Dato etiqueta="Sillas de origen">{e.numerosOrigen.length ? e.numerosOrigen.map((n) => `#${n}`).join(", ") : NO_GUARDADO}</Dato>
            <Dato etiqueta="Sillas de destino">{retiro ? NO_APLICA : e.numerosDestino.length ? e.numerosDestino.map((n) => `#${n}`).join(", ") : NO_GUARDADO}</Dato>
            {e.contratos.length > 0 && <Dato etiqueta="Contrato">{e.contratos.join(", ")}</Dato>}
          </dl>
          {e.motivo && <p className="mt-2 break-words text-gray-500"><span className="text-gray-400">Motivo (texto libre): </span><span className="italic">“{e.motivo}”</span></p>}
          {e.detalle.length > 0 && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-gray-500">Detalle por silla ({e.detalle.length})</summary>
              <ul className="mt-1 space-y-0.5 text-gray-600">
                {e.detalle.map((d) => (
                  <li key={d.id}>
                    Silla {d.sillaOrigen != null ? `#${d.sillaOrigen}` : "sin número guardado"}
                    {d.sillaDestino != null ? ` → #${d.sillaDestino}` : ""}
                    {d.contrato ? ` · contrato ${d.contrato}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </details>
    </li>
  );
}

export function HistorialMovimientos({ historial, bloqueoId, recordPorId }: {
  historial: EntradaHistorial[];
  bloqueoId: number;
  recordPorId: Record<number, string>;
}) {
  const recordDe = (id: number | null) => (id == null ? "—" : recordPorId[id] ?? `#${id}`);
  if (historial.length === 0) return <p className="text-xs text-gray-400">Sin movimientos de sillas registrados.</p>;
  const recientes = historial.slice(0, VISIBLES_AL_ABRIR);
  const anteriores = historial.slice(VISIBLES_AL_ABRIR);
  const fila = (e: EntradaHistorial) => <Movimiento key={e.clave} e={e} bloqueoId={bloqueoId} recordDe={recordDe} />;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-400">{historial.length} {historial.length === 1 ? "movimiento" : "movimientos"}, del más reciente al más antiguo. Pulsa uno para ver su detalle.</p>
      <ul className="space-y-2">{recientes.map(fila)}</ul>
      {anteriores.length > 0 && (
        <details className="group/ant rounded-lg border border-dashed border-gray-200 p-2" data-testid="movimientos-anteriores">
          <summary className="cursor-pointer text-xs font-medium text-gray-600">Ver {anteriores.length} {anteriores.length === 1 ? "movimiento anterior" : "movimientos anteriores"}</summary>
          <ul className="mt-2 space-y-2">{anteriores.map(fila)}</ul>
        </details>
      )}
    </div>
  );
}
