"use client";

import { useId, useRef, useState } from "react";
import { Ban } from "lucide-react";
import { DialogoConfirmar } from "@/components/ui/DialogoConfirmar";
import { Input } from "@/components/ui/input";

/**
 * Botón "Anular" de un abono. Anular NO es borrar sin rastro: el abono sale de Cartera, la ficha y los estados de cuenta,
 * su asiento contable se retira y queda una huella con quién, cuándo y por qué. Por eso exige un motivo.
 */
export function AnularAbonoBoton({
  resumen, onAnular,
}: {
  resumen: string; // p. ej. "$ 500.000 del 12 de octubre" — se muestra en el diálogo
  onAnular: (motivo: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const enVuelo = useRef(false); // doble pulsación: la segunda llamada no sale
  const idMotivo = useId(); // un id por fila: varias filas (o un diálogo saliendo) no comparten id

  return (
    <>
      <button
        type="button"
        onClick={() => { setMotivo(""); setAbierto(true); }}
        className="inline-flex items-center gap-1 text-xs font-medium text-red-500 hover:underline"
      >
        <Ban className="h-3 w-3" aria-hidden="true" />
        Anular
      </button>
      <DialogoConfirmar
        open={abierto}
        onOpenChange={setAbierto}
        titulo="¿Anular este abono?"
        destructivo
        etiquetaConfirmar="Anular abono"
        descripcion={(
          <span className="block space-y-3">
            <span className="block">
              Se anulará el abono de {resumen}: dejará de contar en el saldo y se retirará su asiento contable. Queda registrado quién lo anuló y por qué.
            </span>
            <span className="block">
              <label htmlFor={idMotivo} className="mb-1 block text-xs font-medium text-gray-600">Motivo (obligatorio)</label>
              <Input id={idMotivo} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: abono duplicado" maxLength={200} />
            </span>
          </span>
        )}
        onConfirmar={async () => {
          if (motivo.trim().length < 3) return { ok: false, error: "Indica el motivo de la anulación (mínimo 3 caracteres)." };
          if (enVuelo.current) return { ok: false, error: "La anulación ya está en curso." };
          enVuelo.current = true;
          try {
            return await onAnular(motivo.trim());
          } catch {
            return { ok: false, error: "No se pudo anular el abono." };
          } finally {
            enVuelo.current = false;
          }
        }}
      />
    </>
  );
}
