"use client";

import { DialogoConfirmar } from "@/components/ui/DialogoConfirmar";
import { formatMoneda } from "@/lib/utils";
import type { DatosExcedente } from "@/lib/finanzas/excedenteAbono";

/**
 * Confirmación de pago adicional: el contrato ya está cubierto y se va a registrar un abono más. Los datos vienen del
 * SERVIDOR (que es quien decide si hace falta), no de la pantalla. Cancelar no escribe nada; confirmar reintenta el
 * registro con `confirmarExcedente = true`.
 */
export function ConfirmarExcedenteAbono({
  datos, onCancelar, onConfirmar,
}: {
  datos: DatosExcedente | null;
  onCancelar: () => void;
  onConfirmar: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const fila = (k: string, v: string) => (
    <div className="flex justify-between gap-6 border-b border-gray-100 py-1 last:border-0">
      <dt className="text-gray-500">{k}</dt>
      <dd className="font-medium tabular-nums text-gray-800">{v}</dd>
    </div>
  );
  return (
    <DialogoConfirmar
      open={datos !== null}
      onOpenChange={(abierto) => { if (!abierto) onCancelar(); }}
      titulo="Este contrato ya está pagado"
      destructivo
      etiquetaConfirmar="Registrar pago adicional"
      descripcion={datos && "Lo abonado ya cubre el total a cobrar. Si el nuevo abono es un pago adicional intencional, confírmalo."}
      contenido={datos && (
        // Fuera de la descripción: DialogDescription es un <p> y un <dl> dentro de un <p> es HTML inválido.
        <dl className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
          {fila("Contrato", datos.contrato)}
          {fila("Total a cobrar", formatMoneda(datos.total, datos.moneda))}
          {fila("Pagado", formatMoneda(datos.pagado, datos.moneda))}
          {fila("Nuevo abono", formatMoneda(datos.nuevo, datos.moneda))}
        </dl>
      )}
      onConfirmar={onConfirmar}
    />
  );
}
