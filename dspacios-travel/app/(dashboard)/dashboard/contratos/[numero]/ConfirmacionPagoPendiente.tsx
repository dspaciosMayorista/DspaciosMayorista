"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IdentidadContrato } from "@/lib/contrato/identidad";
import { reintentarConfirmacionPago } from "./confirmacion-actions";

/** 288 (#75): los abonos del contrato ya alcanzan el mínimo pero sigue PENDIENTE (confirmación fallida o pendiente). Se dice y se ofrece reintentar. */
export function ConfirmacionPagoPendiente({ numero, identidad }: { numero: string; identidad: IdentidadContrato }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="flex-1">
          <p className="font-semibold">Abonos suficientes; confirmación pendiente</p>
          <p className="mt-1">Los abonos ya cubren el mínimo para confirmar este contrato, pero la confirmación no se completó. Las obligaciones (cuentas por pagar y comisión) nacen al confirmar.</p>
          <Button type="button" size="sm" className="mt-2" disabled={pending}
            onClick={() => start(async () => {
              setError(null);
              const r = await reintentarConfirmacionPago(numero, identidad);
              if (!r.ok) setError(r.error ?? "No se pudo confirmar.");
              else router.refresh();
            })}>
            {pending ? "Reintentando…" : "Reintentar confirmación"}
          </Button>
          {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}
