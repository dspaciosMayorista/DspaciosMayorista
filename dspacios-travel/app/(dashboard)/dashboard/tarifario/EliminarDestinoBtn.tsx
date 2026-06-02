"use client";

import { useTransition } from "react";
import { eliminarDestino } from "./actions";

export function EliminarDestinoBtn({ id, nombre }: { id: number; nombre: string }) {
  const [pending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    if (!confirm(`¿Eliminar destino "${nombre}"? Se eliminarán todos los hoteles y tarifas asociadas.`)) return;
    startTransition(async () => {
      await eliminarDestino(id);
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors text-xs"
      title="Eliminar destino"
    >
      ✕
    </button>
  );
}
