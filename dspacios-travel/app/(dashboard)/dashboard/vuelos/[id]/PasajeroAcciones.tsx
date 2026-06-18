"use client";

import { useState, useTransition } from "react";
import { editarPasajeroSilla, borrarPasajeroSilla, moverPasajeroSilla, type PasajeroSillaInput } from "../actions";

type Pasajero = PasajeroSillaInput;
type RecordOpt = { id: number; record: string; fecha_ida: string | null };

const inp = "w-full rounded border border-gray-300 px-2 py-1 text-sm";

export function PasajeroAcciones({
  sillaId,
  bloqueoId,
  inicial,
  otros,
  bloqueada,
}: {
  sillaId: number;
  bloqueoId: number;
  inicial: Pasajero;
  otros: RecordOpt[];
  bloqueada: boolean; // solo 'cambio' (silla que salió a otro record): la gestiona el sistema
}) {
  const [modo, setModo] = useState<null | "editar" | "mover">(null);
  const [form, setForm] = useState<Pasajero>(inicial);
  const [destino, setDestino] = useState<number | "">("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const set = (k: keyof Pasajero, val: string) => setForm((f) => ({ ...f, [k]: val }));

  if (bloqueada) return <span className="text-[10px] text-gray-400">—</span>;

  function guardar() {
    setErr("");
    start(async () => {
      const r = await editarPasajeroSilla(sillaId, bloqueoId, form);
      if (r.ok) setModo(null);
      else setErr(r.error);
    });
  }
  function mover() {
    if (destino === "") return;
    setErr("");
    start(async () => {
      const r = await moverPasajeroSilla(sillaId, bloqueoId, Number(destino));
      if (r.ok) { setModo(null); setDestino(""); }
      else setErr(r.error);
    });
  }
  function borrar() {
    if (!confirm("¿Borrar el pasajero y liberar la silla? Esta acción la deja 'disponible' y no toca el contrato.")) return;
    setErr("");
    start(async () => {
      const r = await borrarPasajeroSilla(sillaId, bloqueoId);
      if (!r.ok) setErr(r.error);
    });
  }

  return (
    <>
      <div className="flex items-center gap-2 text-xs">
        <button type="button" onClick={() => { setForm(inicial); setModo("editar"); }} className="text-[#1D7C9A] hover:underline">Editar</button>
        <button type="button" onClick={() => setModo("mover")} className="text-[#1D7C9A] hover:underline">Mover</button>
        <button type="button" onClick={borrar} disabled={pending} className="text-red-500 hover:underline disabled:opacity-50">Borrar</button>
      </div>

      {modo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModo(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {modo === "editar" ? (
              <>
                <h3 className="mb-3 text-sm font-semibold text-gray-800">Editar pasajero · silla #{sillaId}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-gray-500">Nombres
                    <input className={inp} value={form.pasajero_nombres} onChange={(e) => set("pasajero_nombres", e.target.value)} />
                  </label>
                  <label className="text-xs text-gray-500">Apellidos
                    <input className={inp} value={form.pasajero_apellidos} onChange={(e) => set("pasajero_apellidos", e.target.value)} />
                  </label>
                  <label className="text-xs text-gray-500">Tipo doc
                    <input className={inp} value={form.tipo_doc} onChange={(e) => set("tipo_doc", e.target.value)} />
                  </label>
                  <label className="text-xs text-gray-500">Número doc
                    <input className={inp} value={form.numero_doc} onChange={(e) => set("numero_doc", e.target.value)} />
                  </label>
                  <label className="text-xs text-gray-500">Nacimiento
                    <input type="date" className={inp} value={form.nacimiento} onChange={(e) => set("nacimiento", e.target.value)} />
                  </label>
                  <label className="text-xs text-gray-500">Asesor
                    <input className={inp} value={form.asesor} onChange={(e) => set("asesor", e.target.value)} />
                  </label>
                  <label className="text-xs text-gray-500">Hotel
                    <input className={inp} value={form.hotel} onChange={(e) => set("hotel", e.target.value)} />
                  </label>
                  <label className="text-xs text-gray-500">Acomodación
                    <input className={inp} value={form.acomodacion} onChange={(e) => set("acomodacion", e.target.value)} />
                  </label>
                  <label className="text-xs text-gray-500">Plazo
                    <input type="date" className={inp} value={form.plazo} onChange={(e) => set("plazo", e.target.value)} />
                  </label>
                </div>
                {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => setModo(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100">Cancelar</button>
                  <button type="button" onClick={guardar} disabled={pending} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar"}</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="mb-1 text-sm font-semibold text-gray-800">Mover pasajero a otro record</h3>
                <p className="mb-3 text-xs text-gray-500">Se copia con su contrato y estado al record elegido; la silla actual queda <b>disponible</b> y se registra el cambio.</p>
                <select value={destino} onChange={(e) => setDestino(e.target.value === "" ? "" : Number(e.target.value))} className={inp}>
                  <option value="">Elige el record destino…</option>
                  {otros.map((o) => <option key={o.id} value={o.id}>{o.record}{o.fecha_ida ? ` · ${o.fecha_ida}` : ""}</option>)}
                </select>
                {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => setModo(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100">Cancelar</button>
                  <button type="button" onClick={mover} disabled={pending || destino === ""} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Moviendo…" : "Mover pasajero"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
