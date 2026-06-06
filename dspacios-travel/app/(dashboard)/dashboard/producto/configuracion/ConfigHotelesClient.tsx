"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearCategoria, eliminarCategoria, crearRegimen, actualizarRegimen, eliminarRegimen } from "./actions";

type Categoria = { id: number; nombre: string; descripcion: string | null };
type Regimen = { id: number; codigo: string; nombre: string; descripcion: string | null; nota_especial: string | null };

export function ConfigHotelesClient({ categorias, regimenes }: { categorias: Categoria[]; regimenes: Regimen[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Categorias categorias={categorias} />
      <Regimenes regimenes={regimenes} />
    </div>
  );
}

function Categorias({ categorias }: { categorias: Categoria[] }) {
  const [nombre, setNombre] = useState("");
  const [desc, setDesc] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  function agregar() {
    if (!nombre.trim()) return;
    setErr("");
    start(async () => {
      const r = await crearCategoria(nombre, desc);
      if (r.ok) { setNombre(""); setDesc(""); } else setErr(r.error);
    });
  }
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Categorías de habitación</h2>
      <div className="flex flex-wrap items-end gap-2">
        <Input placeholder="Nombre (Estándar, Junior Suite…)" value={nombre} onChange={(e) => setNombre(e.target.value)} className="flex-1" />
        <Input placeholder="Descripción (opcional)" value={desc} onChange={(e) => setDesc(e.target.value)} className="flex-1" />
        <Button onClick={agregar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "…" : "Agregar"}
        </Button>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <ul className="mt-4 divide-y divide-gray-100">
        {categorias.map((c) => <Item key={c.id} nombre={c.nombre} desc={c.descripcion} onDel={() => eliminarCategoria(c.id)} />)}
        {!categorias.length && <li className="py-3 text-sm text-gray-400">Sin categorías aún.</li>}
      </ul>
    </section>
  );
}

function Regimenes({ regimenes }: { regimenes: Regimen[] }) {
  const [editId, setEditId] = useState<number | null>(null);
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [nota, setNota] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function reset() { setEditId(null); setCodigo(""); setNombre(""); setNota(""); setErr(""); }

  function editar(r: Regimen) {
    setEditId(r.id); setCodigo(r.codigo); setNombre(r.nombre); setNota(r.nota_especial ?? ""); setErr("");
  }

  function guardar() {
    if (!codigo.trim() || !nombre.trim()) return;
    setErr("");
    start(async () => {
      const r = editId == null ? await crearRegimen(codigo, nombre, "", nota) : await actualizarRegimen(editId, codigo, nombre, nota);
      if (r.ok) reset(); else setErr(r.error);
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Régimen de alimentación</h2>
      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <Input placeholder="Código (PC, FULL…)" value={codigo} onChange={(e) => setCodigo(e.target.value)} className="w-28" />
          <Input placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className="flex-1" />
          <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "…" : editId == null ? "Agregar" : "Guardar"}
          </Button>
          {editId != null && <Button variant="outline" onClick={reset} disabled={pending}>Cancelar</Button>}
        </div>
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          placeholder="Nota especial (opcional) — instrucciones del plan; aparece en el contrato si se usa este régimen" />
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <ul className="mt-4 divide-y divide-gray-100">
        {regimenes.map((r) => <Item key={r.id} nombre={`${r.codigo} — ${r.nombre}`} desc={r.descripcion} nota={r.nota_especial} onEdit={() => editar(r)} onDel={() => eliminarRegimen(r.id)} />)}
        {!regimenes.length && <li className="py-3 text-sm text-gray-400">Sin regímenes aún.</li>}
      </ul>
    </section>
  );
}

function Item({ nombre, desc, nota, onEdit, onDel }: { nombre: string; desc: string | null; nota?: string | null; onEdit?: () => void; onDel: () => void | Promise<unknown> }) {
  const [pending, start] = useTransition();
  const [abierta, setAbierta] = useState(false);
  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm text-gray-800">{nombre}</span>
          {desc && <span className="ml-2 text-xs text-gray-400">{desc}</span>}
          {nota && (
            <button type="button" onClick={() => setAbierta((v) => !v)}
              className="ml-2 rounded-full bg-[var(--brand-highlight)]/30 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-[var(--brand-highlight)]/50">
              Nota especial {abierta ? "▾" : "▸"}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {onEdit && <button type="button" onClick={onEdit} className="text-xs text-[var(--brand-accent)] hover:underline">Editar</button>}
          <button type="button" disabled={pending}
            onClick={() => { if (confirm("¿Eliminar?")) start(() => { void onDel(); }); }}
            className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
        </div>
      </div>
      {nota && abierta && (
        <p className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">{nota}</p>
      )}
    </li>
  );
}
