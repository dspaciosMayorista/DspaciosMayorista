"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/DateInput";
import { asignarContratoManual, editarContratoManual, quitarContratoManual, retirarCupo } from "../actions";
import { nuevaOperacionId } from "@/lib/vuelos/operaciones";

// Celda "Contrato" de la silla. Maneja los tres casos:
//  · orgánico (numero_contrato, viene de una venta) → enlace al contrato (no se edita aquí)
//  · manual (contrato_manual, venta externa) → badge + editar referencia + quitar
//    (si el pasajero se queda, quitar pide el plazo: queda retenido en plazo)
//  · sin contrato y vendible → asignar contrato manual, incluso con pasajero
//  · libre de verdad → también retirar cupo
export function SillaContrato({
  sillaId, bloqueoId, numeroContrato, contratoManual, estado, libre, version, vencida = false,
  pasajero = false, plazo = null, hoy = "",
}: {
  sillaId: number;
  bloqueoId: number;
  numeroContrato: string | null;
  contratoManual: string | null;
  estado: string;
  /** Silla libre de verdad (`esSillaLibre`): solo ahí se retira el cupo. */
  libre: boolean;
  /** `updated_at` de la silla tal como se mostró: la base rechaza la asignación si cambió (migración 201). */
  version: string;
  /** Retención sin contrato con el plazo ya vencido: no recibe contrato hasta actualizar el plazo (migración 201). */
  vencida?: boolean;
  /** La silla tiene pasajero (nombre o apellido): al quitar el contrato manual queda retenida y se pide el plazo. */
  pasajero?: boolean;
  /** Plazo guardado (AAAA-MM-DD), para proponerlo si sigue vigente. */
  plazo?: string | null;
  /** Día de negocio de Bogotá (AAAA-MM-DD): el plazo no puede ser anterior. */
  hoy?: string;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [num, setNum] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [modoManual, setModoManual] = useState<null | "editar" | "quitar">(null);
  const [refEdit, setRefEdit] = useState("");
  const [plazoQuitar, setPlazoQuitar] = useState("");
  const [retiroAbierto, setRetiroAbierto] = useState(false);
  const [motivoRetiro, setMotivoRetiro] = useState("");
  const [opRetiro, setOpRetiro] = useState("");
  const [errRetiro, setErrRetiro] = useState("");

  // Orgánico: solo enlace (lo gestiona el flujo de ventas).
  if (numeroContrato !== null) {
    return <Link href={`/dashboard/contratos/${numeroContrato}`} className="font-mono text-xs text-[var(--brand-primary)] hover:underline">{numeroContrato}</Link>;
  }

  // Manual: mostrar + editar la referencia + quitar.
  if (contratoManual !== null) {
    const cerrar = () => { setModoManual(null); setErr(""); };
    const abrirEditar = () => { setErr(""); setRefEdit(contratoManual); setModoManual("editar"); };
    const abrirQuitar = () => { setErr(""); setPlazoQuitar(plazo && hoy && plazo >= hoy ? plazo : ""); setModoManual("quitar"); };
    const guardarRef = () => start(async () => {
      if (!refEdit.trim()) { setErr("Escribe el número de contrato manual."); return; }
      const r = await editarContratoManual(sillaId, refEdit, bloqueoId, version);
      if (r.ok) cerrar(); else setErr(r.error);
    });
    const confirmarQuitar = () => start(async () => {
      if (pasajero) {
        if (!plazoQuitar) { setErr("Indica la fecha de plazo: el pasajero queda retenido en plazo."); return; }
        if (hoy && plazoQuitar < hoy) { setErr(`La fecha de plazo ya pasó; indica ${hoy} o una posterior.`); return; }
      }
      const r = await quitarContratoManual(sillaId, bloqueoId, version, pasajero ? plazoQuitar : null);
      if (r.ok) cerrar(); else setErr(r.error);
    });
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-[var(--brand-primary)]" title="Contrato manual (venta externa)">{contratoManual}<span className="ml-1 text-[9px] text-gray-400">manual</span></span>
          {modoManual === null && (
            <>
              <button type="button" disabled={pending} onClick={abrirEditar}
                className="text-[10px] text-gray-400 hover:text-[var(--brand-primary)] disabled:opacity-50">editar</button>
              <button type="button" disabled={pending} onClick={abrirQuitar}
                className="text-[10px] text-gray-400 hover:text-red-500 disabled:opacity-50">quitar</button>
            </>
          )}
        </span>
        {modoManual === "editar" && (
          <div className="flex items-center gap-1">
            <input value={refEdit} onChange={(e) => setRefEdit(e.target.value)} aria-label="Nuevo número de contrato manual"
              className="w-28 rounded border border-gray-300 px-2 py-1 text-xs" autoFocus />
            <button type="button" disabled={pending} onClick={guardarRef}
              className="rounded px-2 py-1 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : "Guardar"}</button>
            <button type="button" aria-label="Cancelar" onClick={cerrar} className="text-gray-400 hover:text-gray-600"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
        {modoManual === "quitar" && (
          <div className="flex flex-col gap-1 rounded border border-gray-200 bg-gray-50 p-1.5">
            {pasajero ? (
              <label className="text-[10px] text-gray-600">El pasajero se queda, retenido en plazo hasta:
                <DateInput aria-label="Fecha de plazo" type="date" value={plazoQuitar} min={hoy || undefined}
                  onValueChange={setPlazoQuitar} className="mt-1 rounded border border-gray-300 px-1 py-0.5 text-[11px]" />
              </label>
            ) : (
              <span className="text-[10px] text-gray-600">Sin pasajero: la silla queda disponible.</span>
            )}
            <div className="flex items-center gap-1">
              <button type="button" disabled={pending} onClick={confirmarQuitar}
                className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50">{pending ? "…" : pasajero ? "Quitar y retener" : "Quitar contrato"}</button>
              <button type="button" onClick={cerrar} className="text-[11px] text-gray-500 hover:text-gray-700">Cancelar</button>
            </div>
          </div>
        )}
        {err && <span className="text-[10px] text-red-600">{err}</span>}
      </div>
    );
  }

  // El pasajero puede capturarse antes del contrato: sin contrato queda
  // RETENIDO en plazo (`en_plazo`, migración 201) y asignarle el contrato
  // manual lo confirma. Los estados no vendibles siguen cerrados y retirar un
  // cupo exige que esté completamente libre.
  if (estado !== "disponible" && estado !== "cambio_entrante" && estado !== "en_plazo") return <span className="text-gray-300">—</span>;

  // Una retención vencida no recibe contrato hasta actualizar su plazo a hoy o
  // a una fecha futura (decisión del dueño; la base lo vuelve a exigir).
  if (vencida) {
    return <span className="text-[10px] text-amber-700" title="Edita el pasajero y pon un plazo de hoy en adelante para poder asignarle contrato.">Plazo vencido: actualízalo para asignar contrato</span>;
  }

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
          {libre && <button type="button" onClick={abrirRetiro} className="text-[11px] text-gray-400 hover:text-red-500">retirar cupo</button>}
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="N.º contrato"
            className="w-28 rounded border border-gray-300 px-2 py-1 text-xs" autoFocus />
          <button type="button" disabled={pending}
            onClick={() => start(async () => { const r = await asignarContratoManual(sillaId, num, bloqueoId, version); if (r.ok) { setAbierto(false); setNum(""); } else setErr(r.error); })}
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
