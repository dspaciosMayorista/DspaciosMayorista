"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Diálogo de confirmación EN LA PÁGINA (no el confirm() del navegador).
 * Recibe la acción a ejecutar; muestra estado de carga y el error si falla.
 *
 *   <ConfirmDialog
 *     title="¿Eliminar el bloqueo PG5RNE?"
 *     description="Se borrarán también sus sillas."
 *     confirmLabel="Eliminar"
 *     destructive
 *     onConfirm={() => eliminarBloqueo(id)}
 *     trigger={<button className="...">Eliminar</button>}
 *   />
 */
export function ConfirmDialog({
  trigger, title, description, confirmLabel = "Confirmar", cancelLabel = "Cancelar",
  destructive = false, onConfirm, onDone,
}: {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<{ ok: boolean; error?: string } | void>;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function confirmar() {
    setError(null);
    start(async () => {
      const r = await onConfirm();
      if (r && r.ok === false) { setError(r.error ?? "No se pudo completar la acción."); return; }
      setOpen(false);
      onDone?.();
    });
  }

  return (
    <>
      <span onClick={() => { setError(null); setOpen(true); }}>{trigger}</span>
      <Dialog open={open} onOpenChange={(o: boolean) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {cancelLabel}
            </Button>
            <Button
              onClick={confirmar}
              disabled={pending}
              style={destructive ? { backgroundColor: "#C0392B" } : { backgroundColor: "var(--brand-primary)" }}
            >
              {pending ? "Procesando…" : confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
