"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { convertirCotizacion, descartarCotizacion } from "../../reservar/actions";

export function CotizacionAcciones({ id }: { id: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [confirmar, setConfirmar] = useState(false);

  function convertir() {
    setErr("");
    start(async () => {
      const r = await convertirCotizacion(id);
      if (r.ok) router.push(`/dashboard/contratos/${r.numero}`);
      else setErr(r.error);
    });
  }

  function descartar() {
    setErr("");
    start(async () => {
      const r = await descartarCotizacion(id);
      if (r.ok) router.refresh();
      else setErr(r.error ?? "No se pudo descartar.");
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button onClick={convertir} disabled={pending} style={{ backgroundColor: "var(--brand-success)" }}>
          {pending ? "Procesando…" : "Confirmar → generar contrato"}
        </Button>
        {!confirmar ? (
          <Button onClick={() => setConfirmar(true)} disabled={pending} variant="outline">
            Descartar
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">¿Seguro?</span>
            <Button onClick={descartar} disabled={pending} variant="outline" className="text-red-600">
              Sí, descartar
            </Button>
            <button type="button" className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setConfirmar(false)}>
              Cancelar
            </button>
          </div>
        )}
      </div>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      <p className="text-xs text-gray-400">
        Al confirmar se genera el número de contrato, se descuentan las sillas y se crean las cuentas por pagar.
      </p>
    </div>
  );
}
