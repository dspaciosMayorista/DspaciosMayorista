"use client";

import { Unlock } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { liberarRetencionVencida } from "../actions";

/**
 * "Liberar" de una retención en plazo SIN contrato ya vencida (migración 201).
 * Liberación SOLO manual (decisión del dueño): con confirmación de la app y la
 * versión de la silla que esta pantalla mostró; la base vuelve a comprobar
 * bajo candado que siga sin contrato y vencida, y si cambió no borra nada
 * (el error se muestra en el mismo diálogo).
 */
export function LiberarRetencion({
  sillaId, bloqueoId, version, numeroVisible, numeroHistorico, pasajero, plazo,
}: {
  sillaId: number;
  bloqueoId: number;
  /** `sillas.updated_at` tal como se leyó para esta pantalla. */
  version: string;
  numeroVisible: number;
  numeroHistorico: number | null;
  pasajero: string;
  plazo: string;
}) {
  return (
    <ConfirmDialog
      title={`¿Liberar la silla ${numeroVisible}?`}
      description={
        <>
          La retención de <b>{pasajero || "este pasajero"}</b> venció (plazo {plazo}) y no tiene contrato. La silla vuelve
          a <b>disponible</b> y se borran de ella los datos del pasajero; quedan en la auditoría y en el historial del
          record. {numeroHistorico !== null && <>Es la silla histórica #{numeroHistorico}. </>}No se crea, cancela ni modifica ninguna venta.
        </>
      }
      confirmLabel="Liberar silla"
      destructive
      onConfirm={() => liberarRetencionVencida(sillaId, bloqueoId, version)}
      trigger={
        <button type="button" className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:underline">
          <Unlock className="h-3 w-3" /> Liberar
        </button>
      }
    />
  );
}
