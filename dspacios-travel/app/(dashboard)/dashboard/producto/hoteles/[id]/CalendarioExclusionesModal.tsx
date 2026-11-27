"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEscapeCerrar } from "@/components/ui/useEscapeCerrar";
import { nochesDeRangos, type ConjuntoFechas, type RangoFechas } from "@/lib/hoteles/conjuntosFechas";
import { CalendarioExclusiones } from "./CalendarioExclusiones";

// H103-03: la lista compacta de black-outs sigue siendo la presentación principal; el calendario (elegir noches, rangos con Mayús, conjuntos de fechas) vive en esta ventana.
// La ventana trabaja sobre un BORRADOR: nada cambia en la vigencia hasta «Aplicar a la lista»; Cancelar / Escape / X lo descartan. Guardar la vigencia sigue siendo su propio botón.
const FOCO = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function CalendarioExclusionesModal({ vigencia, value, onChange, conjuntos, conjuntosDisponibles, nombreVigencia, onNuevaVigencia }: {
  vigencia: RangoFechas[]; value: RangoFechas[]; onChange: (v: RangoFechas[]) => void; conjuntos: ConjuntoFechas[]; conjuntosDisponibles: boolean;
  nombreVigencia?: string; onNuevaVigencia?: (c: ConjuntoFechas) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [borrador, setBorrador] = useState<RangoFechas[]>(value);
  const disparador = useRef<HTMLButtonElement>(null);
  const capa = useRef<HTMLDivElement>(null);
  const cerrar = () => { setAbierto(false); };
  useEscapeCerrar(abierto, cerrar);

  // Foco al abrir (primer control) y de vuelta al botón que abrió la ventana al cerrar.
  useEffect(() => {
    if (!abierto) return;
    const previo = disparador.current;
    capa.current?.querySelector<HTMLElement>(FOCO)?.focus();
    return () => previo?.focus();
  }, [abierto]);

  function teclado(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const items = [...(capa.current?.querySelectorAll<HTMLElement>(FOCO) ?? [])];
    if (!items.length) return;
    const primero = items[0], ultimo = items[items.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  }

  const n = nochesDeRangos(value).length;
  return (
    <>
      <button ref={disparador} type="button" data-testid="abrir-calendario-exclusiones" onClick={() => { setBorrador(value); setAbierto(true); }}
        className="flex items-center gap-1.5 rounded border border-[var(--brand-accent)] px-3 py-1.5 text-xs font-medium text-[var(--brand-primary)] hover:bg-gray-50">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Elegir fechas en el calendario{n > 0 ? ` (${n} ${n === 1 ? "noche" : "noches"})` : ""}
      </button>
      {abierto && (
        <div ref={capa} onKeyDown={teclado} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="Calendario de noches excluidas">
          <div className="w-full max-w-2xl space-y-3 rounded-lg bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--brand-primary)]"><CalendarDays className="h-4 w-4" aria-hidden /> Noches excluidas</h3>
                <p className="text-[11px] text-gray-500">Trabajas sobre una copia: la lista de la vigencia no cambia hasta «Aplicar a la lista». Guardar la vigencia es un paso aparte.</p>
              </div>
              <button type="button" onClick={cerrar} aria-label="Cerrar sin aplicar" className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" aria-hidden /></button>
            </div>
            <CalendarioExclusiones vigencia={vigencia} value={borrador} onChange={setBorrador} conjuntos={conjuntos} conjuntosDisponibles={conjuntosDisponibles}
              nombreVigencia={nombreVigencia}
              onNuevaVigencia={onNuevaVigencia ? (c) => { onNuevaVigencia(c); setAbierto(false); } : undefined} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => { onChange(borrador); setAbierto(false); }} style={{ backgroundColor: "var(--brand-primary)" }}>Aplicar a la lista</Button>
              <Button type="button" variant="outline" onClick={cerrar}>Cancelar</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
