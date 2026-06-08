"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatFechaLarga } from "@/lib/utils";
import { actualizarVigenciaCotizacion } from "../../reservar/actions";

// Editable solo si la cotización sigue abierta; si no, muestra la fecha fija.
export function VigenciaCotizacion({ id, vigencia, editable }: { id: number; vigencia: string | null; editable: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [valor, setValor] = useState(vigencia ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function guardar() {
    if (!valor) { setErr("Elige una fecha."); return; }
    setErr("");
    start(async () => {
      const r = await actualizarVigenciaCotizacion(id, valor);
      if (r.ok) { setEdit(false); router.refresh(); }
      else setErr(r.error ?? "No se pudo guardar.");
    });
  }

  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Válida hasta</div>
      {!edit ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-800">{formatFechaLarga(vigencia) || "—"}</span>
          {editable && (
            <button type="button" onClick={() => setEdit(true)} className="text-xs text-[var(--brand-accent)] hover:underline">
              Cambiar
            </button>
          )}
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Input type="date" value={valor} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setValor(e.target.value)} className="w-40" />
          <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "…" : "Guardar"}
          </Button>
          <button type="button" className="text-xs text-gray-400 hover:text-gray-600" onClick={() => { setEdit(false); setValor(vigencia ?? ""); setErr(""); }}>
            Cancelar
          </button>
        </div>
      )}
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}
