"use client";

import { useTransition } from "react";
import { eliminarPaquete } from "./actions";

export function EliminarPaqueteBtn({ id, nombre }: { id: number; nombre: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending}
      onClick={() => { if (confirm(`¿Eliminar el paquete "${nombre}"?`)) start(() => { void eliminarPaquete(id); }); }}
      className="text-xs text-gray-400 hover:text-red-500">
      {pending ? "…" : "Eliminar"}
    </button>
  );
}
