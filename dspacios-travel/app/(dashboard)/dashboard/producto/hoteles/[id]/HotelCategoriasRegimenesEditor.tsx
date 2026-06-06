"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { actualizarHotelCategoriasRegimenes } from "../actions";

type Cat = { id: number; nombre: string };
type Reg = { id: number; codigo: string };

export function HotelCategoriasRegimenesEditor({
  hotelId, todasCategorias, todosRegimenes, categoriaIds, regimenIds,
}: {
  hotelId: number;
  todasCategorias: Cat[];
  todosRegimenes: Reg[];
  categoriaIds: number[];
  regimenIds: number[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [catSel, setCatSel] = useState<number[]>(categoriaIds);
  const [regSel, setRegSel] = useState<number[]>(regimenIds);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const toggle = (arr: number[], set: (v: number[]) => void, id: number) =>
    set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarHotelCategoriasRegimenes(hotelId, catSel, regSel);
      if (r.ok) { setMsg("Guardado."); router.refresh(); } else setMsg(r.error);
    });
  }

  const chip = (activo: boolean) =>
    `rounded-full border px-3 py-1 text-xs ${activo ? "border-[#1D7C9A] bg-[#1D7C9A] text-white" : "border-gray-300 text-gray-600"}`;

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-700">Categorías de habitación y regímenes</span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <div>
            <p className="mb-1 block text-xs font-medium text-gray-600">Categorías de habitación</p>
            {todasCategorias.length === 0 ? (
              <p className="text-xs text-amber-600">No hay categorías. Créalas en Producto → Configuración.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {todasCategorias.map((c) => (
                  <button key={c.id} type="button" onClick={() => toggle(catSel, setCatSel, c.id)} className={chip(catSel.includes(c.id))}>
                    {c.nombre}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="mb-1 block text-xs font-medium text-gray-600">Régimen de alimentación</p>
            {todosRegimenes.length === 0 ? (
              <p className="text-xs text-amber-600">No hay regímenes. Créalos en Producto → Configuración.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {todosRegimenes.map((r) => (
                  <button key={r.id} type="button" onClick={() => toggle(regSel, setRegSel, r.id)} className={chip(regSel.includes(r.id))}>
                    {r.codigo}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-gray-400">Quitar una categoría/régimen no borra las tarifas ya cargadas con ese valor; solo deja de ofrecerse para nuevas tarifas.</p>
          <div className="flex items-center gap-3">
            <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
            {msg && <span className="text-sm text-gray-600">{msg}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
