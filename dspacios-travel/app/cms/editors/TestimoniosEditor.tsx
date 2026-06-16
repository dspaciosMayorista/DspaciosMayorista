"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Database } from "@/types/database";
import {
  crearTestimonio,
  actualizarTestimonio,
  eliminarTestimonio,
  toggleActivoTestimonio,
  type WebTestimonioInput,
} from "../actions";

type Testimonio = Database["public"]["Tables"]["web_testimonios"]["Row"];

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const ta = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

const vacio: WebTestimonioInput = {
  nombre: "",
  ubicacion: "",
  rating: 5,
  comentario: "",
  imagen_url: "",
  orden: 0,
  activo: true,
};

export function TestimoniosEditor({ testimonios }: { testimonios: Testimonio[] }) {
  const [form, setForm] = useState<WebTestimonioInput>(vacio);
  const [editId, setEditId] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  function set<K extends keyof WebTestimonioInput>(k: K, v: WebTestimonioInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function reset() {
    setForm(vacio);
    setEditId(null);
    setErr("");
  }
  function startEdit(t: Testimonio) {
    setErr("");
    setEditId(t.id);
    setForm({
      nombre: t.nombre ?? "",
      ubicacion: t.ubicacion ?? "",
      rating: t.rating ?? 5,
      comentario: t.comentario ?? "",
      imagen_url: t.imagen_url ?? "",
      orden: t.orden ?? 0,
      activo: !!t.activo,
    });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function guardar() {
    if (!form.nombre.trim()) {
      setErr("El nombre es obligatorio.");
      return;
    }
    if (!form.comentario.trim()) {
      setErr("El comentario es obligatorio.");
      return;
    }
    setErr("");
    start(async () => {
      const r = editId ? await actualizarTestimonio(editId, form) : await crearTestimonio(form);
      if (r.ok) reset();
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">
          {editId ? "Editar testimonio" : "Nuevo testimonio"}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={lbl}>Nombre *</label>
            <Input value={form.nombre} onChange={(e) => set("nombre", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Ubicación</label>
            <Input value={form.ubicacion} onChange={(e) => set("ubicacion", e.target.value)} placeholder="Bogotá" />
          </div>
          <div>
            <label className={lbl}>Rating</label>
            <select className={sel} value={form.rating} onChange={(e) => set("rating", Number(e.target.value))}>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>{n} estrellas</option>
              ))}
            </select>
          </div>
          <div>
            <label className={lbl}>Imagen (URL)</label>
            <Input value={form.imagen_url} onChange={(e) => set("imagen_url", e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <label className={lbl}>Orden</label>
            <Input type="number" value={form.orden} onChange={(e) => set("orden", Number(e.target.value) || 0)} />
          </div>
        </div>
        <div className="mt-3">
          <label className={lbl}>Comentario *</label>
          <textarea className={ta} rows={3} value={form.comentario} onChange={(e) => set("comentario", e.target.value)} />
        </div>

        <div className="mt-3 flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.activo} onChange={(e) => set("activo", e.target.checked)} />
            Activo
          </label>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)", color: "white" }}>
            {pending ? "…" : editId ? "Guardar cambios" : "Agregar testimonio"}
          </Button>
          {editId && (
            <Button variant="outline" onClick={reset} disabled={pending}>
              Cancelar
            </Button>
          )}
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>

      {testimonios.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                <th className="px-4 py-2">Orden</th>
                <th className="px-4 py-2">Nombre</th>
                <th className="px-4 py-2">Ubicación</th>
                <th className="px-4 py-2">Rating</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {testimonios.map((t) => (
                <Row key={t.id} t={t} onEdit={startEdit} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ t, onEdit }: { t: Testimonio; onEdit: (t: Testimonio) => void }) {
  const [pending, start] = useTransition();
  return (
    <tr className="border-t border-gray-50">
      <td className="px-4 py-2 tabular-nums text-gray-500">{t.orden}</td>
      <td className="px-4 py-2 text-gray-700">{t.nombre}</td>
      <td className="px-4 py-2 text-gray-500">{t.ubicacion ?? "—"}</td>
      <td className="px-4 py-2 text-gray-500">{t.rating}★</td>
      <td className="px-4 py-2">
        <span className={t.activo ? "text-green-600" : "text-gray-400"}>
          {t.activo ? "Activo" : "Inactivo"}
        </span>
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => onEdit(t)} className="text-xs text-[var(--brand-accent)] hover:underline">
            Editar
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(() => { void toggleActivoTestimonio(t.id, !t.activo); })}
            className="text-xs text-gray-500 hover:underline"
          >
            {t.activo ? "Desactivar" : "Activar"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm(`¿Eliminar el testimonio de ${t.nombre}?`)) start(() => { void eliminarTestimonio(t.id); });
            }}
            className="text-xs text-gray-400 hover:text-red-500"
          >
            Eliminar
          </button>
        </div>
      </td>
    </tr>
  );
}
