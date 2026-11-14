"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 288 (#75): el abono QUEDÓ registrado pero el contrato no se pudo confirmar. Se dice con claridad, se impide registrarlo otra vez (sería otro pago) y se ofrece
 * reintentar SOLO la confirmación (misma operación: la base responde «ya registrado» y vuelve a evaluar el mínimo).
 */
export function ConfirmacionPendienteAbono({ mensaje, pending, onReintentar }: { mensaje: string | null; pending: boolean; onReintentar: () => void }) {
  if (!mensaje) return null;
  return (
    <div role="alert" className="basis-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="flex-1">
          <p className="font-semibold">Abono registrado; confirmación pendiente</p>
          <p className="mt-1">{mensaje}</p>
          <p className="mt-1 text-xs">El dinero ya quedó contabilizado: no lo registres otra vez. Reintenta la confirmación cuando quieras.</p>
          <Button type="button" size="sm" className="mt-2" disabled={pending} onClick={onReintentar}>
            {pending ? "Reintentando…" : "Reintentar confirmación"}
          </Button>
        </div>
      </div>
    </div>
  );
}
