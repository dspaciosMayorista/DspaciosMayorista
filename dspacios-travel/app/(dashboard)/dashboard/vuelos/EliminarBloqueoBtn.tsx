"use client";

import { useTransition } from "react";
import { eliminarBloqueo } from "./actions";

export function EliminarBloqueoBtn({ id, record }: { id: number; record: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm(`¿Eliminar el bloqueo ${record} y sus sillas?`)) {
          start(() => { void eliminarBloqueo(id); });
        }
      }}
      className="text-xs text-gray-400 hover:text-red-500"
    >
      {pending ? "…" : "Eliminar"}
    </button>
  );
}
