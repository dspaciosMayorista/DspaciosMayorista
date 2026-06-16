"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Database } from "@/types/database";
import {
  crearPaquete,
  actualizarPaquete,
  eliminarPaquete,
  toggleActivoPaquete,
  type WebPaqueteInput,
} from "../actions";

type Paquete = Database["public"]["Tables"]["web_paquetes"]["Row"];

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const ta =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

function arrToText(a: string[] | null | undefined): string {
  return (a ?? []).join("\n");
}

const vacio: WebPaqueteInput = {
  titulo: "",
  region: "",
  destino: "",
  duracion: "",
  personas: "",
  precio_desde: "",
  descripcion: "",
  descripcion_larga: "",
  incluye: "",
  no_incluye: "",
  imagen_url: "",
  galeria: "",
  destacado: false,
  cta_url: "",
  orden: 0,
  activo: true,
};

export function PaquetesEditor({ paquetes }: { paquetes: Paquete[] }) {
  const [form, setForm] = useState<WebPaqueteInput>(vacio);
  const [editId, setEditId] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  function set<K extends keyof WebPaqueteInput>(k: K, v: WebPaqueteInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function reset() {
    setForm(vacio);
    setEditId(null);
    setErr("");
  }

  function startEdit(p: Paquete) {
    setErr("");
    setEditId(p.id);
    setForm({
      titulo: p.titulo ?? "",
      region: p.region ?? "",
      destino: p.destino ?? "",
      duracion: p.duracion ?? "",
      personas: p.personas ?? "",
      precio_desde: p.precio_desde ?? "",
      descripcion: p.descripcion ?? "",
      descripcion_larga: p.descripcion_larga ?? "",
      incluye: arrToText(p.incluye),
      no_incluye: arrToText(p.no_incluye),
      imagen_url: p.imagen_url ?? "",
      galeria: arrToText(p.galeria),
      destacado: !!p.destacado,
      cta_url: p.cta_url ?? "",
      orden: p.orden ?? 0,
      activo: !!p.activo,
    });
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function guardar() {
    if (!form.titulo.trim()) {
      setErr("El título es obligatorio.");
      return;
    }
    setErr("");
    start(async () => {
      const r = editId
        ? await actualizarPaquete(editId, form)
        : await crearPaquete(form);
      if (r.ok) reset();
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">
          {editId ? "Editar paquete" : "Nuevo paquete"}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={lbl}>Título *</label>
            <Input value={form.titulo} onChange={(e) => set("titulo", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Región</label>
            <Input value={form.region} onChange={(e) => set("region", e.target.value)} placeholder="Nacionales, Caribe, Europa…" />
          </div>
          <div>
            <label className={lbl}>Destino</label>
            <Input value={form.destino} onChange={(e) => set("destino", e.target.value)} placeholder="Cartagena, Colombia" />
          </div>
          <div>
            <label className={lbl}>Duración</label>
            <Input value={form.duracion} onChange={(e) => set("duracion", e.target.value)} placeholder="4 días / 3 noches" />
          </div>
          <div>
            <label className={lbl}>Personas</label>
            <Input value={form.personas} onChange={(e) => set("personas", e.target.value)} placeholder="2 personas" />
          </div>
          <div>
            <label className={lbl}>Precio desde (texto)</label>
            <Input value={form.precio_desde} onChange={(e) => set("precio_desde", e.target.value)} placeholder="599" />
          </div>
          <div>
            <label className={lbl}>Imagen (URL)</label>
            <Input value={form.imagen_url} onChange={(e) => set("imagen_url", e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <label className={lbl}>CTA URL</label>
            <Input value={form.cta_url} onChange={(e) => set("cta_url", e.target.value)} placeholder="/tarifario" />
          </div>
          <div>
            <label className={lbl}>Orden</label>
            <Input type="number" value={form.orden} onChange={(e) => set("orden", Number(e.target.value) || 0)} />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className={lbl}>Descripción (corta)</label>
            <textarea className={ta} rows={2} value={form.descripcion} onChange={(e) => set("descripcion", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Descripción larga</label>
            <textarea className={ta} rows={2} value={form.descripcion_larga} onChange={(e) => set("descripcion_larga", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Incluye (una línea por ítem)</label>
            <textarea className={ta} rows={4} value={form.incluye} onChange={(e) => set("incluye", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>No incluye (una línea por ítem)</label>
            <textarea className={ta} rows={4} value={form.no_incluye} onChange={(e) => set("no_incluye", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className={lbl}>Galería (una URL por línea)</label>
            <textarea className={ta} rows={3} value={form.galeria} onChange={(e) => set("galeria", e.target.value)} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.destacado} onChange={(e) => set("destacado", e.target.checked)} />
            Destacado
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.activo} onChange={(e) => set("activo", e.target.checked)} />
            Activo
          </label>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)", color: "white" }}>
            {pending ? "…" : editId ? "Guardar cambios" : "Agregar paquete"}
          </Button>
          {editId && (
            <Button variant="outline" onClick={reset} disabled={pending}>
              Cancelar
            </Button>
          )}
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>

      {paquetes.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                <th className="px-4 py-2">Orden</th>
                <th className="px-4 py-2">Título</th>
                <th className="px-4 py-2">Región</th>
                <th className="px-4 py-2">Destacado</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {paquetes.map((p) => (
                <Row key={p.id} p={p} onEdit={startEdit} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ p, onEdit }: { p: Paquete; onEdit: (p: Paquete) => void }) {
  const [pending, start] = useTransition();
  return (
    <tr className="border-t border-gray-50">
      <td className="px-4 py-2 tabular-nums text-gray-500">{p.orden}</td>
      <td className="px-4 py-2 text-gray-700">{p.titulo}</td>
      <td className="px-4 py-2 text-gray-500">{p.region ?? "—"}</td>
      <td className="px-4 py-2 text-gray-500">{p.destacado ? "Sí" : "—"}</td>
      <td className="px-4 py-2">
        <span className={p.activo ? "text-green-600" : "text-gray-400"}>
          {p.activo ? "Activo" : "Inactivo"}
        </span>
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => onEdit(p)} className="text-xs text-[var(--brand-accent)] hover:underline">
            Editar
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(() => { void toggleActivoPaquete(p.id, !p.activo); })}
            className="text-xs text-gray-500 hover:underline"
          >
            {p.activo ? "Desactivar" : "Activar"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm(`¿Eliminar “${p.titulo}”?`)) start(() => { void eliminarPaquete(p.id); });
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
