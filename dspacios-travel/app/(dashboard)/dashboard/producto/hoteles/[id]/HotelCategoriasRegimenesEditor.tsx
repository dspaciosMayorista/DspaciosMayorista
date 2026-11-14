"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { actualizarHotelCategoriasRegimenes, actualizarTextoCategoriaHotel } from "../actions";

type Cat = { id: number; nombre: string };
type Reg = { id: number; codigo: string };
export type TextoCategoria = { descripcion: string; incluye: string };

const area = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

/** #45: descripción y «qué incluye» de UNA categoría en este hotel (el nombre es el del catálogo global y no se edita aquí). */
function TextoCategoriaFila({ hotelId, cat, texto }: { hotelId: number; cat: Cat; texto: TextoCategoria }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [descripcion, setDescripcion] = useState(texto.descripcion);
  const [incluye, setIncluye] = useState(texto.incluye);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarTextoCategoriaHotel(hotelId, cat.id, descripcion, incluye);
      if (r.ok) { setEditando(false); router.refresh(); } else setMsg(r.error);
    });
  }
  function cancelar() { setDescripcion(texto.descripcion); setIncluye(texto.incluye); setMsg(""); setEditando(false); }

  return (
    <li className="py-3" data-testid={`texto-categoria-${cat.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800">{cat.nombre}</p>
          {!editando && (texto.descripcion || texto.incluye
            ? <>
                {texto.descripcion && <p className="mt-0.5 whitespace-pre-line text-xs text-gray-600">{texto.descripcion}</p>}
                {texto.incluye && <p className="mt-0.5 whitespace-pre-line text-xs text-gray-500"><span className="font-medium">Incluye:</span> {texto.incluye}</p>}
              </>
            : <p className="mt-0.5 text-xs text-gray-400">Sin descripción para este hotel.</p>)}
        </div>
        {!editando && (
          <button type="button" onClick={() => setEditando(true)} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium" style={{ color: "var(--brand-primary)" }}>
            <Pencil className="h-3.5 w-3.5" aria-hidden /> Editar
          </button>
        )}
      </div>
      {editando && (
        <div className="mt-2 space-y-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor={`desc-${cat.id}`}>Descripción</label>
            <textarea id={`desc-${cat.id}`} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} maxLength={2000} className={area}
              placeholder="Ej. Habitación de 32 m² con balcón y vista parcial al mar." />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor={`inc-${cat.id}`}>Qué incluye (una línea por ítem)</label>
            <textarea id={`inc-${cat.id}`} value={incluye} onChange={(e) => setIncluye(e.target.value)} rows={3} maxLength={2000} className={area}
              placeholder={"Ej.\nMinibar\nCaja fuerte\nWi-Fi"} />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar"}</Button>
            <button type="button" onClick={cancelar} disabled={pending} className="text-sm text-gray-500 hover:text-gray-800">Cancelar</button>
            {msg && <span className="text-sm text-red-600" role="alert">{msg}</span>}
          </div>
        </div>
      )}
    </li>
  );
}

export function HotelCategoriasRegimenesEditor({
  hotelId, todasCategorias, todosRegimenes, categoriaIds, regimenIds, textosCategoria = {},
}: {
  hotelId: number;
  todasCategorias: Cat[];
  todosRegimenes: Reg[];
  categoriaIds: number[];
  regimenIds: number[];
  /** #45: textos ya GUARDADOS por categoría asignada (solo se editan las guardadas: la fila debe existir). */
  textosCategoria?: Record<number, TextoCategoria>;
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
          <p className="text-xs text-gray-400">Quitar una categoría/régimen no borra las tarifas ya cargadas con ese valor; solo deja de ofrecerse para nuevas tarifas. Quitar una categoría sí borra su descripción en este hotel.</p>
          <div className="flex items-center gap-3">
            <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
            {msg && <span className="text-sm text-gray-600">{msg}</span>}
          </div>
          {categoriaIds.length > 0 && (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-600">Descripción por categoría en este hotel</p>
              <p className="text-xs text-gray-400">El cliente la ve en la ficha del hotel. No cambia el nombre de la categoría ni los precios.</p>
              <ul className="divide-y divide-gray-100">
                {todasCategorias.filter((c) => categoriaIds.includes(c.id)).map((c) => (
                  <TextoCategoriaFila key={c.id} hotelId={hotelId} cat={c} texto={textosCategoria[c.id] ?? { descripcion: "", incluye: "" }} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
