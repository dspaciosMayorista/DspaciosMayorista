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
  bloqueada: boolean; // cambio / cambio_entrante: gestionadas por el sistema
}) {
  const [pending, start] = useTransition();

  if (bloqueada) {
    return <span className="text-[10px] uppercase text-gray-500">{estado.replace("_", " ")}</span>;
  }

  return (
    <select
      disabled={pending}
      value={estado}
      onChange={(e) =>
        start(() => { void cambiarEstadoSilla(sillaId, e.target.value as EstadoSillaManual, bloqueoId); })
      }
      className="rounded border border-gray-300 bg-white/70 px-1 py-0.5 text-[10px]"
    >
      {OPCIONES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
