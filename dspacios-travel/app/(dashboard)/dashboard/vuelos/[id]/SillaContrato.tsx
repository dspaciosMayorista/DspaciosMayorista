"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { asignarContratoManual, quitarContratoManual, retirarCupo } from "../actions";
import { nuevaOperacionId } from "@/lib/vuelos/operaciones";

// Celda "Contrato" de la silla. Maneja los tres casos:
//  · orgánico (numero_contrato, viene de una venta) → enlace al contrato
//  · manual (contrato_manual, venta externa) → badge + quitar
//  · libre (sin contrato ni pasajero) → asignar contrato manual + retirar cupo
export function SillaContrato({
  sillaId, bloqueoId, numeroContrato, contratoManual, libre,
}: {
  sillaId: number;
  bloqueoId: number;
  numeroContrato: string | null;
  contratoManual: string | null;
  /** Silla libre de verdad (`esSillaLibre`): solo ahí se asigna manual o se retira. */
  libre: boolean;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [num, setNum] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [retiroAbierto, setRetiroAbierto] = useState(false);
  const [motivoRetiro, setMotivoRetiro] = useState("");
  const [opRetiro, setOpRetiro] = useState("");
  const [errRetiro, setErrRetiro] = useState("");

  // Orgánico: solo enlace (lo gestiona el flujo de ventas).
  if (numeroContrato) {
    return <Link href={`/dashboard/contratos/${numeroContrato}`} className="font-mono text-xs text-[var(--brand-primary)] hover:underline">{numeroContrato}</Link>;
  }

  // Manual: mostrar + quitar.
  if (contratoManual) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-[var(--brand-primary)]" title="Contrato manual (venta externa)">{contratoManual}<span className="ml-1 text-[9px] text-gray-400">manual</span></span>
        <button type="button" disabled={pending}
          onClick={() => start(async () => { const r = await quitarContratoManual(sillaId, bloqueoId); if (!r.ok) setErr(r.error); })}
          className="text-[10px] text-gray-400 hover:text-red-500 disabled:opacity-50">quitar</button>
        {err && <span className="text-[10px] text-red-600">{err}</span>}
      </span>
    );
  }

  // Ocupada sin contrato (solo datos de pasajero), no_vendida o devuelta: nada que asignar aquí.
  if (!libre) return <span className="text-gray-300">—</span>;

  function abrirRetiro() { setMotivoRetiro(""); setErrRetiro(""); setOpRetiro(nuevaOperacionId()); setRetiroAbierto(true); }
  function confirmarRetiro() {
    setErrRetiro("");
    start(async () => {
      const r = await retirarCupo(sillaId, bloqueoId, motivoRetiro, opRetiro);
      if (r.ok) setRetiroAbierto(false); else setErrRetiro(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      {!abierto ? (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setErr(""); setAbierto(true); }} className="text-[11px] font-medium text-[var(--brand-primary)] hover:underline">+ Contrato manual</button>
          <button type="button" onClick={abrirRetiro} className="text-[11px] text-gray-400 hover:text-red-500">retirar cupo</button>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="N.º contrato"
            className="w-28 rounded border border-gray-300 px-2 py-1 text-xs" autoFocus />
          <button type="button" disabled={pending}
            onClick={() => start(async () => { const r = await asignarContratoManual(sillaId, num, bloqueoId); if (r.ok) { setAbierto(false); setNum(""); } else setErr(r.error); })}
            className="rounded px-2 py-1 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : "OK"}</button>
          <button type="button" aria-label="Cancelar" onClick={() => { setAbierto(false); setErr(""); }} className="text-gray-400 hover:text-gray-600"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {err && <span className="text-[10px] text-red-600">{err}</span>}

      <Dialog open={retiroAbierto} onOpenChange={(o: boolean) => !pending && setRetiroAbierto(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Retirar este cupo?</DialogTitle>
            <DialogDescription>
              El record pierde 1 cupo activo. La silla no se borra: queda como “retirada” en el historial, ya no se vende y
              no vuelve a contar como cupo. Solo aplica a cupos libres.
            </DialogDescription>
          </DialogHeader>
          <label className="text-sm text-gray-600">Motivo (opcional)
            <input value={motivoRetiro} onChange={(e) => setMotivoRetiro(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          {errRetiro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{errRetiro}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetiroAbierto(false)} disabled={pending}>Cancelar</Button>
            <Button onClick={confirmarRetiro} disabled={pending} variant="destructive">
              {pending ? "Procesando…" : "Retirar cupo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
