"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Database } from "@/types/database";
import {
  crearBlog,
  actualizarBlog,
  eliminarBlog,
  toggleActivoBlog,
  type WebBlogInput,
} from "../actions";

type Blog = Database["public"]["Tables"]["web_blog"]["Row"];

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const ta = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

const vacio: WebBlogInput = {
  titulo: "",
  slug: "",
  categoria: "",
  fecha: "",
  resumen: "",
  contenido: "",
  imagen_url: "",
  orden: 0,
  activo: true,
};

export function BlogEditor({ blog }: { blog: Blog[] }) {
  const [form, setForm] = useState<WebBlogInput>(vacio);
  const [editId, setEditId] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  function set<K extends keyof WebBlogInput>(k: K, v: WebBlogInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function reset() {
    setForm(vacio);
    setEditId(null);
    setErr("");
  }
  function startEdit(b: Blog) {
    setErr("");
    setEditId(b.id);
    setForm({
      titulo: b.titulo ?? "",
      slug: b.slug ?? "",
      categoria: b.categoria ?? "",
      fecha: b.fecha ?? "",
      resumen: b.resumen ?? "",
      contenido: b.contenido ?? "",
      imagen_url: b.imagen_url ?? "",
      orden: b.orden ?? 0,
      activo: !!b.activo,
    });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function guardar() {
    if (!form.titulo.trim()) {
      setErr("El título es obligatorio.");
      return;
    }
    setErr("");
    start(async () => {
      const r = editId ? await actualizarBlog(editId, form) : await crearBlog(form);
      if (r.ok) reset();
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">
          {editId ? "Editar artículo" : "Nuevo artículo"}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={lbl}>Título *</label>
            <Input value={form.titulo} onChange={(e) => set("titulo", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Slug (opcional)</label>
            <Input value={form.slug} onChange={(e) => set("slug", e.target.value)} placeholder="tips-viajar-europa" />
          </div>
          <div>
            <label className={lbl}>Categoría</label>
            <Input value={form.categoria} onChange={(e) => set("categoria", e.target.value)} placeholder="Consejos, Destinos…" />
          </div>
          <div>
            <label className={lbl}>Fecha (texto)</label>
            <Input value={form.fecha} onChange={(e) => set("fecha", e.target.value)} placeholder="15 Oct 2023" />
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
        <div className="mt-3 grid grid-cols-1 gap-3">
          <div>
            <label className={lbl}>Resumen</label>
            <textarea className={ta} rows={2} value={form.resumen} onChange={(e) => set("resumen", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Contenido</label>
            <textarea className={ta} rows={6} value={form.contenido} onChange={(e) => set("contenido", e.target.value)} />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.activo} onChange={(e) => set("activo", e.target.checked)} />
            Activo
          </label>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)", color: "white" }}>
            {pending ? "…" : editId ? "Guardar cambios" : "Agregar artículo"}
          </Button>
          {editId && (
            <Button variant="outline" onClick={reset} disabled={pending}>
              Cancelar
            </Button>
          )}
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>

      {blog.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                <th className="px-4 py-2">Orden</th>
                <th className="px-4 py-2">Título</th>
                <th className="px-4 py-2">Categoría</th>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {blog.map((b) => (
                <Row key={b.id} b={b} onEdit={startEdit} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ b, onEdit }: { b: Blog; onEdit: (b: Blog) => void }) {
  const [pending, start] = useTransition();
  return (
    <tr className="border-t border-gray-50">
      <td className="px-4 py-2 tabular-nums text-gray-500">{b.orden}</td>
      <td className="px-4 py-2 text-gray-700">{b.titulo}</td>
      <td className="px-4 py-2 text-gray-500">{b.categoria ?? "—"}</td>
      <td className="px-4 py-2 text-gray-500">{b.fecha ?? "—"}</td>
      <td className="px-4 py-2">
        <span className={b.activo ? "text-green-600" : "text-gray-400"}>
          {b.activo ? "Activo" : "Inactivo"}
        </span>
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => onEdit(b)} className="text-xs text-[var(--brand-accent)] hover:underline">
            Editar
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(() => { void toggleActivoBlog(b.id, !b.activo); })}
            className="text-xs text-gray-500 hover:underline"
          >
            {b.activo ? "Desactivar" : "Activar"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm(`¿Eliminar “${b.titulo}”?`)) start(() => { void eliminarBlog(b.id); });
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
