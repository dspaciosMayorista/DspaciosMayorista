"use client";

import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { eliminarBloqueo } from "./actions";

export function EliminarBloqueoBtn({ id, record }: { id: number; record: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      title={`¿Eliminar el bloqueo ${record}?`}
      description="Se borrarán también sus sillas y movimientos. Esta acción no se puede deshacer."
      confirmLabel="Eliminar"
      destructive
      onConfirm={() => eliminarBloqueo(id)}
      onDone={() => router.refresh()}
      trigger={
        <button type="button" className="text-xs text-gray-400 hover:text-red-500">
          Eliminar
        </button>
      }
    />
  );
}
