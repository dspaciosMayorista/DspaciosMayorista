"use client";

import { useState, useTransition } from "react";
import { eliminarDestino } from "./actions";

type DestOpt = { id: number; nombre: string };

export function EliminarDestinoBtn({
  id,
  nombre,
  hoteles = 0,
  destinos = [],
}: {
  id: number;
  nombre: string;
  hoteles?: number;
  destinos?: DestOpt[];
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<number | "">("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const otros = destinos.filter((d) => d.id !== id);

  function eliminar() {
    setErr("");
    // Con hoteles, exige elegir a dónde moverlos.
    if (hoteles > 0 && target === "") {
      setErr(`Tiene ${hoteles} hotel(es): elige a qué destino moverlos.`);
      return;
    }
    start(async () => {
      const r = await eliminarDestino(id, target === "" ? undefined : Number(target));
      if (r.ok) setOpen(false);
      else setErr(r.error);
    });
  }

  return (
    <>
      <button
        onClick={(e) => { e.preventDefault(); setOpen(true); setErr(""); setTarget(""); }}
        className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
        title="Eliminar destino"
      >
        ✕
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { e.preventDefault(); if (!pending) setOpen(false); }}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900">Eliminar destino</h3>
            <p className="mt-1 text-sm text-gray-600">
              Vas a eliminar <b>{nombre?.toUpperCase()}</b>.
            </p>

            {hoteles > 0 ? (
              <div className="mt-3">
                <p className="mb-1 text-xs text-amber-700">
                  Tiene <b>{hoteles}</b> hotel(es). Se moverán (junto con sus tarifas, servicios y paquetes) al destino que elijas:
                </p>
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">— Elige el destino de llegada —</option>
                  {otros.map((d) => <option key={d.id} value={d.id}>{d.nombre?.toUpperCase()}</option>)}
                </select>
              </div>
            ) : (
              <p className="mt-2 text-xs text-gray-500">No tiene hoteles; se eliminará directamente.</p>
            )}

            {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} disabled={pending} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600">Cancelar</button>
              <button onClick={eliminar} disabled={pending} className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
                {pending ? "Eliminando…" : hoteles > 0 ? "Mover y eliminar" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
