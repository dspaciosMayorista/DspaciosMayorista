"use client";

import { useState } from "react";
import { eliminarPaquete } from "./actions";
import { DialogoConfirmar } from "@/components/ui/DialogoConfirmar";

export function EliminarPaqueteBtn({ id, nombre }: { id: number; nombre: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className="text-xs text-gray-400 hover:text-red-500">
        Eliminar
      </button>
      <DialogoConfirmar
        open={abierto}
        onOpenChange={setAbierto}
        titulo={`¿Eliminar el paquete "${nombre}"?`}
        descripcion="Se elimina el paquete con su armado y su tarifario publicado."
        etiquetaConfirmar="Eliminar"
        destructivo
        onConfirmar={() => eliminarPaquete(id)}
      />
    </>
  );
}
