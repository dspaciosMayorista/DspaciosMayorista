"use client";

import { useTransition } from "react";
import { cambiarEstadoSilla, type EstadoSillaManual } from "../actions";

const OPCIONES: { value: EstadoSillaManual; label: string }[] = [
  { value: "disponible", label: "Disponible" },
  { value: "en_plazo", label: "En plazo" },
  { value: "confirmada", label: "Confirmada" },
  { value: "devuelta", label: "Devuelta" },
  { value: "no_vendida", label: "No vendida" },
];

export function SillaEstado({
  sillaId,
  estado,
  bloqueoId,
  bloqueada,
}: {
  sillaId: number;
  estado: string;
  bloqueoId: number;
  bloqueada: boolean; // 'cambio' (silla que salió a otro record): la gestiona el sistema
}) {
  const [pending, start] = useTransition();

  if (bloqueada) {
    return <span className="text-[10px] uppercase text-gray-500">{estado.replace("_", " ")}</span>;
  }

  // Si el estado actual no es uno "manual" (p. ej. 'cambio_entrante': silla que
  // llegó de otro record), se muestra como opción deshabilitada para no perder el
  // valor, y se puede cambiar a un estado normal (en plazo, confirmada, etc.).
  const esManual = OPCIONES.some((o) => o.value === estado);

  return (
    <select
      disabled={pending}
      value={estado}
      onChange={(e) =>
        start(() => { void cambiarEstadoSilla(sillaId, e.target.value as EstadoSillaManual, bloqueoId); })
      }
      className="rounded border border-gray-300 bg-white/70 px-1 py-0.5 text-[10px]"
    >
      {!esManual && <option value={estado} disabled>{estado.replace("_", " ")}</option>}
      {OPCIONES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
