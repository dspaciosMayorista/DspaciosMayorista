"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { cambiarEstadoSilla } from "../actions";
import { transicionesManuales, type OpcionEstado } from "@/lib/vuelos/operaciones";

const ETIQUETA: Record<string, string> = {
  disponible: "Disponible",
  cambio_entrante: "Disponible",
  en_plazo: "En plazo",
  confirmada: "Confirmada",
  devuelta: "Devuelta",
  no_vendida: "No vendida",
};

/**
 * Estado de una silla ACTIVA. El cambio manual sigue la matriz DIR-1
 * (lib/vuelos/operaciones.ts, validada otra vez en la base):
 *  - solo en sillas libres (sin contrato ni pasajero); las ocupadas cambian
 *    con las acciones del contrato (reservar, confirmar, liberar);
 *  - Devuelta es definitiva; No vendida → Devuelta solo como devolución real;
 *  - siempre con motivo, que queda en el historial del bloqueo.
 */
export function SillaEstado({
  sillaId,
  estado,
  bloqueoId,
  libre,
}: {
  sillaId: number;
  estado: string;
  bloqueoId: number;
  /** Silla sin contrato ni pasajero (`esSillaLibre`). */
  libre: boolean;
}) {
  const [pending, start] = useTransition();
  const [destino, setDestino] = useState<OpcionEstado | null>(null);
  const [motivo, setMotivo] = useState("");
  const [devolucionReal, setDevolucionReal] = useState(false);
  const [err, setErr] = useState("");

  const etiqueta = ETIQUETA[estado] ?? estado.replace("_", " ");
  // no_vendida/devuelta pueden no ser "libres" por estado, pero sí sin contrato:
  // la matriz se aplica a sillas sin contrato ni pasajero en cualquier estado manual.
  const opciones = libre || estado === "no_vendida" || estado === "devuelta" ? transicionesManuales(estado) : [];

  if (!opciones.length) {
    return <span className="text-[10px] uppercase text-gray-500" title={estado === "devuelta" ? "Una silla devuelta es definitiva." : undefined}>{etiqueta}</span>;
  }

  function cerrar() { setDestino(null); setMotivo(""); setDevolucionReal(false); setErr(""); }
  function guardar() {
    if (!destino) return;
    if (!motivo.trim()) { setErr("Escribe el motivo."); return; }
    if (destino.requiereDevolucionReal && !devolucionReal) { setErr("Confirma que es una devolución real a la aerolínea."); return; }
    setErr("");
    start(async () => {
      const r = await cambiarEstadoSilla(sillaId, destino.value, bloqueoId, motivo, devolucionReal);
      if (r.ok) cerrar(); else setErr(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label={`Estado de la silla (${etiqueta})`}
        disabled={pending}
        value=""
        onChange={(e) => { const o = opciones.find((x) => x.value === e.target.value); if (o) { setDestino(o); setErr(""); } }}
        className="rounded border border-gray-300 bg-white/70 px-1 py-0.5 text-[10px]"
      >
        <option value="">{etiqueta}</option>
        {opciones.map((o) => <option key={o.value} value={o.value}>Pasar a {o.label}</option>)}
      </select>
      {destino && (
        <div className="w-56 rounded-lg border border-gray-200 bg-white p-2 text-[11px] shadow-sm">
          <div className="mb-1 flex items-center justify-between font-semibold text-gray-700">
            {etiqueta} → {destino.label}
            <button type="button" aria-label="Cancelar" onClick={cerrar} className="text-gray-400 hover:text-gray-600"><X className="h-3.5 w-3.5" /></button>
          </div>
          {destino.value === "devuelta" && (
            <p className="mb-1 text-amber-700">Devuelta es definitiva: la silla no vuelve a otro estado.</p>
          )}
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (obligatorio)"
            className="mb-1 w-full rounded border border-gray-300 px-1.5 py-1" />
          {destino.requiereDevolucionReal && (
            <label className="mb-1 flex items-start gap-1 text-gray-600">
              <input type="checkbox" checked={devolucionReal} onChange={(e) => setDevolucionReal(e.target.checked)} className="mt-0.5" />
              Confirmo que este cupo se devolvió de verdad a la aerolínea.
            </label>
          )}
          {err && <p className="mb-1 text-red-600">{err}</p>}
          <button type="button" disabled={pending} onClick={guardar}
            className="rounded px-2 py-1 font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      )}
    </div>
  );
}
