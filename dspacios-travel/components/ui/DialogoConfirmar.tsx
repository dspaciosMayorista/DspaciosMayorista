"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Diálogo de confirmación CONTROLADO (sustituye al confirm() del navegador).
 * A diferencia de `ConfirmDialog` no envuelve un disparador: quien lo usa decide cuándo abrirlo (`open`), así el botón
 * que lo abre sigue siendo un <button> real y el foco vuelve a él al cerrar.
 *
 * - Foco inicial en "Cancelar" (la opción segura); Escape o clic fuera cierran, salvo mientras la acción corre.
 * - `onConfirmar` puede devolver `{ ok: false, error }`: el diálogo queda abierto y muestra el error (role="alert").
 * - Con `destructivo` el botón de confirmar usa el rojo de la app y el icono de advertencia.
 */
export function DialogoConfirmar({
  open, onOpenChange, titulo, descripcion, contenido, etiquetaConfirmar = "Confirmar", etiquetaCancelar = "Cancelar",
  destructivo = false, onConfirmar,
}: {
  open: boolean;
  onOpenChange: (abierto: boolean) => void;
  titulo: string;
  descripcion?: ReactNode;
  /** Bloque de contenido que NO es texto corrido (listas, dl, tablas): va fuera de `descripcion`, que se renderiza dentro de un <p>. */
  contenido?: ReactNode;
  etiquetaConfirmar?: string;
  etiquetaCancelar?: string;
  destructivo?: boolean;
  onConfirmar: () => Promise<{ ok: boolean; error?: string } | void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cancelar = useRef<HTMLButtonElement>(null);

  function confirmar() {
    setError(null);
    start(async () => {
      const r = await onConfirmar();
      if (r && r.ok === false) { setError(r.error ?? "No se pudo completar la acción."); return; }
      onOpenChange(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(abierto: boolean) => {
        if (pending) return;
        if (!abierto) setError(null);
        onOpenChange(abierto);
      }}
    >
      <DialogContent initialFocus={cancelar} showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {destructivo && <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />}
            {titulo}
          </DialogTitle>
          {descripcion && <DialogDescription>{descripcion}</DialogDescription>}
          {contenido}
        </DialogHeader>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}
        <DialogFooter>
          <Button ref={cancelar} type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            <X className="h-4 w-4" aria-hidden="true" />
            {etiquetaCancelar}
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={pending}
            style={{ backgroundColor: destructivo ? "#C0392B" : "var(--brand-primary)" }}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {pending ? "Procesando…" : etiquetaConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
