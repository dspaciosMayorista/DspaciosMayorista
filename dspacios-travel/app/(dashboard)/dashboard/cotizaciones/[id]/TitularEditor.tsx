"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actualizarTitularCotizacionManual, type TitularInput } from "../manual-actions";

const lbl = "mb-1 block text-xs font-medium text-gray-600";

// Editor del titular de una cotización dinámica (antes de generar contrato).
// Para generar contrato se exigen nombre, tipo y número de doc y nacimiento.
export function TitularEditor({ id, inicial }: { id: number; inicial: TitularInput }) {
  const router = useRouter();
  const [t, setT] = useState<TitularInput>(inicial);
  const [editando, setEditando] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  const set = (k: keyof TitularInput, v: string) => setT((p) => ({ ...p, [k]: v }));
  const completo = !!`${t.nombres}${t.apellidos}`.trim() && !!t.tipoDoc.trim() && !!t.numeroDoc.trim() && !!t.nacimiento.trim();

  function guardar() {
    setErr(""); setOk(false);
    start(async () => {
      const r = await actualizarTitularCotizacionManual(id, t);
      if (r.ok) { setOk(true); setEditando(false); router.refresh(); }
      else setErr(r.error);
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Datos del titular</h2>
        {!editando && (
          <button type="button" onClick={() => { setOk(false); setEditando(true); }} className="text-xs font-medium text-[#1D7C9A] hover:underline">Editar</button>
        )}
      </div>

      {!completo && !editando && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Faltan datos del titular para generar el contrato (nombre, tipo y número de documento y fecha de nacimiento).
        </p>
      )}

      {!editando ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <Dato label="Nombre" value={`${t.nombres} ${t.apellidos}`.trim()} />
          <Dato label="Tipo doc" value={t.tipoDoc} />
          <Dato label="N° documento" value={t.numeroDoc} />
          <Dato label="Nacimiento" value={t.nacimiento} />
          <Dato label="Teléfono" value={t.telefono} />
          <Dato label="Email" value={t.email} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div><label className={lbl}>Nombres</label><Input value={t.nombres} onChange={(e) => set("nombres", e.target.value)} /></div>
            <div><label className={lbl}>Apellidos</label><Input value={t.apellidos} onChange={(e) => set("apellidos", e.target.value)} /></div>
            <div>
              <label className={lbl}>Tipo doc</label>
              <select value={t.tipoDoc} onChange={(e) => set("tipoDoc", e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                {["CC", "CE", "PAS", "NIT", "TI"].map((x) => <option key={x}>{x}</option>)}
              </select>
            </div>
            <div><label className={lbl}>N° documento</label><Input value={t.numeroDoc} onChange={(e) => set("numeroDoc", e.target.value)} /></div>
            <div><label className={lbl}>Fecha de nacimiento</label><Input type="date" value={t.nacimiento} onChange={(e) => set("nacimiento", e.target.value)} /></div>
            <div><label className={lbl}>Teléfono</label><Input value={t.telefono} onChange={(e) => set("telefono", e.target.value)} /></div>
            <div className="md:col-span-2"><label className={lbl}>Email</label><Input value={t.email} onChange={(e) => set("email", e.target.value)} /></div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar titular"}</Button>
            <button type="button" onClick={() => { setEditando(false); setT(inicial); setErr(""); }} className="text-sm text-gray-500 hover:text-gray-800">Cancelar</button>
          </div>
        </>
      )}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      {ok && <p className="mt-2 text-xs text-green-600">Titular actualizado.</p>}
    </section>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm text-gray-800">{value || "—"}</div>
    </div>
  );
}
