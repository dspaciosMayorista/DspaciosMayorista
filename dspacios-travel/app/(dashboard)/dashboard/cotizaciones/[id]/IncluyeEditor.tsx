"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { actualizarIncluyeCotizacionManual } from "../manual-actions";

const lbl = "mb-1 block text-xs font-medium text-gray-600";

function lineas(t: string): string[] {
  return t.split(/\r?\n/).map((s) => s.replace(/^[-•*\s]+/, "").trim()).filter(Boolean);
}

// Editor de "Incluye / No incluye" de la cotización dinámica. Lo que se escribe
// aquí aparece en la cotización del cliente.
export function IncluyeEditor({ id, incluye, noIncluye }: { id: number; incluye: string; noIncluye: string }) {
  const router = useRouter();
  const [inc, setInc] = useState(incluye);
  const [no, setNo] = useState(noIncluye);
  const [editando, setEditando] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  function guardar() {
    setErr(""); setOk(false);
    start(async () => {
      const r = await actualizarIncluyeCotizacionManual(id, inc, no);
      if (r.ok) { setOk(true); setEditando(false); router.refresh(); }
      else setErr(r.error);
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Incluye / No incluye</h2>
        {!editando && (
          <button type="button" onClick={() => { setOk(false); setEditando(true); }} className="text-xs font-medium text-[#1D7C9A] hover:underline">Editar</button>
        )}
      </div>

      {!editando ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Incluye</div>
            {lineas(inc).length ? (
              <ul className="space-y-1 text-sm text-gray-700">{lineas(inc).map((t, i) => <li key={i} className="flex gap-2"><span className="text-[#1D7C9A]">✓</span>{t}</li>)}</ul>
            ) : <p className="text-sm text-gray-400">—</p>}
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">No incluye</div>
            {lineas(no).length ? (
              <ul className="space-y-1 text-sm text-gray-600">{lineas(no).map((t, i) => <li key={i} className="flex gap-2"><span className="text-gray-400">✕</span>{t}</li>)}</ul>
            ) : <p className="text-sm text-gray-400">—</p>}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div><label className={lbl}>Incluye (una línea por ítem)</label><textarea value={inc} onChange={(e) => setInc(e.target.value)} rows={6} className="w-full rounded-lg border border-gray-300 p-2 text-sm" /></div>
            <div><label className={lbl}>No incluye (una línea por ítem)</label><textarea value={no} onChange={(e) => setNo(e.target.value)} rows={6} className="w-full rounded-lg border border-gray-300 p-2 text-sm" /></div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar"}</Button>
            <button type="button" onClick={() => { setEditando(false); setInc(incluye); setNo(noIncluye); setErr(""); }} className="text-sm text-gray-500 hover:text-gray-800">Cancelar</button>
          </div>
        </>
      )}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      {ok && <p className="mt-2 text-xs text-green-600">Actualizado.</p>}
    </section>
  );
}
