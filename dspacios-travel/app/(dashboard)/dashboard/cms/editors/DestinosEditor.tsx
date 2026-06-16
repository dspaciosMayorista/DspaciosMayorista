"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Database } from "@/types/database";
import {
  crearDestino,
  actualizarDestino,
  eliminarDestino,
  toggleActivoDestino,
  type WebDestinoInput,
} from "../actions";

type Destino = Database["public"]["Tables"]["web_destinos"]["Row"];

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const ta = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

const vacio: WebDestinoInput = {
  nombre: "",
  region: "",
  imagen_url: "",
  tips: "",
  orden: 0,
  activo: true,
};

export function DestinosEditor({ destinos }: { destinos: Destino[] }) {
  const [form, setForm] = useState<WebDestinoInput>(vacio);
  const [editId, setEditId] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  function set<K extends keyof WebDestinoInput>(k: K, v: WebDestinoInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function reset() {
    setForm(vacio);
    setEditId(null);
    setErr("");
  }
  function startEdit(d: Destino) {
    setErr("");
    setEditId(d.id);
    setForm({
      nombre: d.nombre ?? "",
      region: d.region ?? "",
      imagen_url: d.imagen_url ?? "",
      tips: (d.tips ?? []).join("\n"),
      orden: d.orden ?? 0,
      activo: !!d.activo,
    });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function guardar() {
    if (!form.nombre.trim()) {
      setErr("El nombre es obligatorio.");
      return;
    }
    setErr("");
    start(async () => {
      const r = editId ? await actualizarDestino(editId, form) : await crearDestino(form);
      if (r.ok) reset();
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">
          {editId ? "Editar destino" : "Nuevo destino"}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={lbl}>Nombre *</label>
            <Input value={form.nombre} onChange={(e) => set("nombre", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Región</label>
            <Input value={form.region} onChange={(e) => set("region", e.target.value)} placeholder="Caribe, Europa, Internacional…" />
          </div>
          <div>
            <label className={lbl}>Orden</label>
            <Input type="number" value={form.orden} onChange={(e) => set("orden", Number(e.target.value) || 0)} />
          </div>
          <div className="md:col-span-3">
            <label className={lbl}>Imagen (URL)</label>
            <Input value={form.imagen_url} onChange={(e) => set("imagen_url", e.target.value)} placeholder="https://…" />
          </div>
          <div className="md:col-span-3">
            <label className={lbl}>Tips (una línea por tip)</label>
            <textarea className={ta} rows={4} value={form.tips} onChange={(e) => set("tips", e.target.value)} />
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
            {pending ? "…" : editId ? "Guardar cambios" : "Agregar destino"}
          </Button>
          {editId && (
            <Button variant="outline" onClick={reset} disabled={pending}>
              Cancelar
            </Button>
          )}
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>

      {destinos.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                <th className="px-4 py-2">Orden</th>
                <th className="px-4 py-2">Nombre</th>
                <th className="px-4 py-2">Región</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {destinos.map((d) => (
                <Row key={d.id} d={d} onEdit={startEdit} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ d, onEdit }: { d: Destino; onEdit: (d: Destino) => void }) {
  const [pending, start] = useTransition();
  return (
    <tr className="border-t border-gray-50">
      <td className="px-4 py-2 tabular-nums text-gray-500">{d.orden}</td>
      <td className="px-4 py-2 text-gray-700">{d.nombre}</td>
      <td className="px-4 py-2 text-gray-500">{d.region ?? "—"}</td>
      <td className="px-4 py-2">
        <span className={d.activo ? "text-green-600" : "text-gray-400"}>
          {d.activo ? "Activo" : "Inactivo"}
        </span>
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => onEdit(d)} className="text-xs text-[var(--brand-accent)] hover:underline">
            Editar
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(() => { void toggleActivoDestino(d.id, !d.activo); })}
            className="text-xs text-gray-500 hover:underline"
          >
            {d.activo ? "Desactivar" : "Activar"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm(`¿Eliminar “${d.nombre}”?`)) start(() => { void eliminarDestino(d.id); });
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
