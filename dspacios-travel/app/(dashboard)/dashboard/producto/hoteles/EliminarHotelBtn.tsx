"use client";

import { useTransition } from "react";
import { eliminarHotel } from "./actions";

export function EliminarHotelBtn({ id, nombre }: { id: number; nombre: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending}
      onClick={() => { if (confirm(`¿Eliminar el hotel "${nombre}" y sus tarifas?`)) start(() => { void eliminarHotel(id); }); }}
      className="text-xs text-gray-400 hover:text-red-500">
      {pending ? "…" : "Eliminar"}
    </button>
  );
}
