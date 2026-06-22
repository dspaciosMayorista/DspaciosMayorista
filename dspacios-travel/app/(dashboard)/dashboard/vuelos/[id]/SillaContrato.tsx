"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { asignarContratoManual, quitarContratoManual, eliminarCupo } from "../actions";

// Celda "Contrato" de la silla. Maneja los tres casos:
//  · orgánico (numero_contrato, viene de una venta) → enlace al contrato
//  · manual (contrato_manual, venta externa) → badge + quitar
//  · disponible (sin contrato) → asignar contrato manual + eliminar cupo
export function SillaContrato({
  sillaId, bloqueoId, estado, numeroContrato, contratoManual,
}: {
  sillaId: number;
  bloqueoId: number;
  estado: string;
  numeroContrato: string | null;
  contratoManual: string | null;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [num, setNum] = useState("");
  const [abierto, setAbierto] = useState(false);

  // Orgánico: solo enlace (lo gestiona el flujo de ventas).
  if (numeroContrato) {
    return <Link href={`/dashboard/contratos/${numeroContrato}`} className="font-mono text-xs text-[#1D7C9A] hover:underline">{numeroContrato}</Link>;
  }

  // Manual: mostrar + quitar.
  if (contratoManual) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded bg-[rgba(29,124,154,0.1)] px-1.5 py-0.5 font-mono text-[11px] text-[#1D7C9A]" title="Contrato manual (venta externa)">{contratoManual}<span className="ml-1 text-[9px] text-gray-400">manual</span></span>
        <button type="button" disabled={pending}
          onClick={() => start(async () => { const r = await quitarContratoManual(sillaId, bloqueoId); if (!r.ok) setErr(r.error); })}
          className="text-[10px] text-gray-400 hover:text-red-500 disabled:opacity-50">quitar</button>
        {err && <span className="text-[10px] text-red-600">{err}</span>}
      </span>
    );
  }

  // Una silla en cambio la gestiona el sistema: no se asigna manual.
  if (estado === "cambio" || estado === "cambio_entrante") return <span className="text-gray-300">—</span>;

  // Disponible: asignar manual + eliminar cupo.
  return (
    <div className="flex flex-col gap-1">
      {!abierto ? (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setErr(""); setAbierto(true); }} className="text-[11px] font-medium text-[#1D7C9A] hover:underline">+ Contrato manual</button>
          <ConfirmDialog
            title="¿Eliminar este cupo?"
            description="Se quita la silla del bloqueo y el total baja en 1. Solo aplica a cupos disponibles."
            confirmLabel="Eliminar cupo"
            destructive
            onConfirm={() => eliminarCupo(sillaId, bloqueoId)}
            trigger={<button type="button" className="text-[11px] text-gray-400 hover:text-red-500">eliminar cupo</button>}
          />
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="N.º contrato"
            className="w-28 rounded border border-gray-300 px-2 py-1 text-xs" autoFocus />
          <button type="button" disabled={pending}
            onClick={() => start(async () => { const r = await asignarContratoManual(sillaId, num, bloqueoId); if (r.ok) { setAbierto(false); setNum(""); } else setErr(r.error); })}
            className="rounded bg-[#1D7C9A] px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">{pending ? "…" : "OK"}</button>
          <button type="button" onClick={() => { setAbierto(false); setErr(""); }} className="text-[11px] text-gray-400">✕</button>
        </div>
      )}
      {err && <span className="text-[10px] text-red-600">{err}</span>}
    </div>
  );
}
