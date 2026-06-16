"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PaginaNodo } from "../tipos";
import {
  crearPagina,
  eliminarPagina,
  moverPagina,
  togglePaginaActivo,
  togglePaginaEnMenu,
} from "../actions";

const ta = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

const TIPOS_PAGINA: { value: string; label: string }[] = [
  { value: "generica", label: "Genérica" },
  { value: "home", label: "Home" },
  { value: "destinos_nacionales", label: "Destinos nacionales (grupo)" },
  { value: "destinos_internacionales", label: "Destinos internacionales (grupo)" },
  { value: "destino", label: "Destino" },
  { value: "experiencias", label: "Experiencias" },
  { value: "nosotros", label: "Nosotros" },
  { value: "contacto", label: "Contacto" },
  { value: "blog", label: "Blog" },
];

export function PaginasTree({
  arbol,
  seleccionada,
  onSelect,
  onChanged,
}: {
  arbol: PaginaNodo[];
  seleccionada: number | null;
  onSelect: (id: number) => void;
  onChanged: () => void;
}) {
  const [nueva, setNueva] = useState<{ parentId: number | null } | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">Páginas del sitio</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => setNueva({ parentId: null })}
        >
          + Página
        </Button>
      </div>

      {nueva && (
        <NuevaPaginaForm
          parentId={nueva.parentId}
          onClose={() => setNueva(null)}
          onCreated={(id) => {
            setNueva(null);
            onChanged();
            onSelect(id);
          }}
        />
      )}

      <ul className="space-y-1">
        {arbol.map((n, i) => (
          <NodoFila
            key={n.id}
            nodo={n}
            nivel={0}
            primera={i === 0}
            ultima={i === arbol.length - 1}
            seleccionada={seleccionada}
            onSelect={onSelect}
            onChanged={onChanged}
            onAddSub={(parentId) => setNueva({ parentId })}
          />
        ))}
        {arbol.length === 0 && (
          <li className="text-sm text-gray-400">Sin páginas. Crea la primera.</li>
        )}
      </ul>
    </div>
  );
}

function NodoFila({
  nodo,
  nivel,
  primera,
  ultima,
  seleccionada,
  onSelect,
  onChanged,
  onAddSub,
}: {
  nodo: PaginaNodo;
  nivel: number;
  primera: boolean;
  ultima: boolean;
  seleccionada: number | null;
  onSelect: (id: number) => void;
  onChanged: () => void;
  onAddSub: (parentId: number) => void;
}) {
  const [pending, start] = useTransition();
  const activa = seleccionada === nodo.id;

  return (
    <li>
      <div
        className={`flex items-center gap-1 rounded-lg px-2 py-1.5 ${
          activa ? "bg-[var(--brand-accent)]/15" : "hover:bg-gray-50"
        }`}
        style={{ marginLeft: nivel * 14 }}
      >
        <button
          type="button"
          onClick={() => onSelect(nodo.id)}
          className="flex-1 truncate text-left text-sm"
        >
          <span className={activa ? "font-semibold text-[var(--brand-primary)]" : "text-gray-700"}>
            {nodo.etiqueta_menu || nodo.titulo}
          </span>
          {!nodo.activo && (
            <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-400">inactiva</span>
          )}
          {!nodo.en_menu && (
            <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-400">fuera del menú</span>
          )}
          <span className="ml-1 text-[11px] text-gray-300">/{nodo.slug}</span>
        </button>
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <button type="button" disabled={pending || primera} title="Subir"
            onClick={() => start(async () => { await moverPagina(nodo.id, "up"); onChanged(); })}
            className="hover:text-gray-700 disabled:opacity-30">↑</button>
          <button type="button" disabled={pending || ultima} title="Bajar"
            onClick={() => start(async () => { await moverPagina(nodo.id, "down"); onChanged(); })}
            className="hover:text-gray-700 disabled:opacity-30">↓</button>
          <button type="button" disabled={pending} title="Agregar subpágina"
            onClick={() => onAddSub(nodo.id)}
            className="hover:text-gray-700">＋</button>
          <button type="button" disabled={pending} title={nodo.activo ? "Desactivar" : "Activar"}
            onClick={() => start(async () => { await togglePaginaActivo(nodo.id, !nodo.activo); onChanged(); })}
            className="hover:text-gray-700">{nodo.activo ? "◉" : "○"}</button>
          <button type="button" disabled={pending} title={nodo.en_menu ? "Ocultar del menú" : "Mostrar en menú"}
            onClick={() => start(async () => { await togglePaginaEnMenu(nodo.id, !nodo.en_menu); onChanged(); })}
            className="hover:text-gray-700">{nodo.en_menu ? "👁" : "🚫"}</button>
          <button type="button" disabled={pending} title="Eliminar"
            onClick={() => {
              if (confirm(`¿Eliminar la página “${nodo.titulo}” y sus subpáginas/secciones?`))
                start(async () => { await eliminarPagina(nodo.id); onChanged(); });
            }}
            className="hover:text-red-500">✕</button>
        </div>
      </div>
      {nodo.hijos.length > 0 && (
        <ul className="mt-1 space-y-1">
          {nodo.hijos.map((h, i) => (
            <NodoFila
              key={h.id}
              nodo={h}
              nivel={nivel + 1}
              primera={i === 0}
              ultima={i === nodo.hijos.length - 1}
              seleccionada={seleccionada}
              onSelect={onSelect}
              onChanged={onChanged}
              onAddSub={onAddSub}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function NuevaPaginaForm({
  parentId,
  onClose,
  onCreated,
}: {
  parentId: number | null;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [slug, setSlug] = useState("");
  const [tipo, setTipo] = useState("generica");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  function crear() {
    if (!titulo.trim()) { setErr("El título es obligatorio."); return; }
    if (!slug.trim()) { setErr("El slug es obligatorio."); return; }
    setErr("");
    start(async () => {
      const r = await crearPagina({
        parent_id: parentId,
        slug,
        titulo,
        etiqueta_menu: "",
        tipo,
        es_grupo_menu: false,
        en_menu: true,
        seo_titulo: "",
        seo_descripcion: "",
        imagen_portada: "",
      });
      if (r.ok) onCreated(r.id);
      else setErr(r.error);
    });
  }

  return (
    <div className="rounded-lg border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 p-3 space-y-2">
      <p className="text-xs font-semibold text-gray-600">
        {parentId ? "Nueva subpágina" : "Nueva página"}
      </p>
      <Input placeholder="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
      <Input placeholder="slug (URL)" value={slug} onChange={(e) => setSlug(e.target.value)} />
      <select className={ta} value={tipo} onChange={(e) => setTipo(e.target.value)}>
        {TIPOS_PAGINA.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex items-center gap-2">
        <Button type="button" onClick={crear} disabled={pending} style={{ backgroundColor: "var(--brand-primary)", color: "white" }}>
          {pending ? "…" : "Crear"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
