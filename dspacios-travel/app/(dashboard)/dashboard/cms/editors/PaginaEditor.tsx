"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PaginaConSecciones, SeccionRow } from "../tipos";
import {
  actualizarPagina,
  crearSeccion,
  eliminarSeccion,
  moverSeccion,
  toggleSeccionVisible,
  type WebPaginaInput,
} from "../actions";
import { SeccionForm } from "./SeccionForm";

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const ta = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

const TIPOS_PAGINA: { value: string; label: string }[] = [
  { value: "home", label: "Home" },
  { value: "destinos_nacionales", label: "Destinos nacionales (grupo)" },
  { value: "destinos_internacionales", label: "Destinos internacionales (grupo)" },
  { value: "destino", label: "Destino" },
  { value: "experiencias", label: "Experiencias" },
  { value: "nosotros", label: "Nosotros" },
  { value: "contacto", label: "Contacto" },
  { value: "blog", label: "Blog" },
  { value: "generica", label: "Genérica" },
];

const TIPOS_SECCION: { value: string; label: string }[] = [
  { value: "hero", label: "Hero (portada)" },
  { value: "texto", label: "Texto" },
  { value: "galeria", label: "Galería" },
  { value: "destinos_grid", label: "Grilla de destinos" },
  { value: "experiencias", label: "Experiencias" },
  { value: "testimonios", label: "Testimonios" },
  { value: "blog_grid", label: "Grilla de blog" },
  { value: "cta", label: "CTA" },
  { value: "contacto", label: "Contacto" },
  { value: "actividades", label: "Actividades imperdibles" },
  { value: "plan", label: "El plan incluye / no incluye" },
  { value: "flyers", label: "Flyers (botones + modal)" },
  { value: "consulta_disponibilidad", label: "Consulta disponibilidad (→ tarifario)" },
];

const TIPO_SECCION_LBL = Object.fromEntries(
  TIPOS_SECCION.map((t) => [t.value, t.label])
);

export function PaginaEditor({
  pagina,
  onChanged,
}: {
  pagina: PaginaConSecciones;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<WebPaginaInput>(toInput(pagina));
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const [nuevoTipo, setNuevoTipo] = useState("texto");
  const [seccionAbierta, setSeccionAbierta] = useState<number | null>(null);

  useEffect(() => {
    setForm(toInput(pagina));
    setMsg("");
    setErr("");
  }, [pagina]);

  function set<K extends keyof WebPaginaInput>(k: K, v: WebPaginaInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function guardar() {
    setMsg("");
    setErr("");
    start(async () => {
      const r = await actualizarPagina(pagina.id, form);
      if (r.ok) {
        setMsg("Página guardada.");
        onChanged();
      } else setErr(r.error);
    });
  }

  function agregarSeccion() {
    start(async () => {
      const r = await crearSeccion(pagina.id, nuevoTipo);
      if (r.ok) onChanged();
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-6">
      {/* ── Datos de la página ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">Datos de la página</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className={lbl}>Título *</label>
            <Input value={form.titulo} onChange={(e) => set("titulo", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Etiqueta en el menú</label>
            <Input value={form.etiqueta_menu} onChange={(e) => set("etiqueta_menu", e.target.value)} placeholder="(usa el título si se deja vacío)" />
          </div>
          <div>
            <label className={lbl}>Slug (URL) *</label>
            <Input value={form.slug} onChange={(e) => set("slug", e.target.value)} placeholder="nosotros" />
            <p className="mt-1 text-[11px] text-gray-400">
              La home usa el slug <code>inicio</code>. Cambiar el slug cambia su URL pública.
            </p>
          </div>
          <div>
            <label className={lbl}>Tipo</label>
            <select className={ta} value={form.tipo} onChange={(e) => set("tipo", e.target.value)}>
              {TIPOS_PAGINA.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={lbl}>Imagen de portada (URL)</label>
            <Input value={form.imagen_portada} onChange={(e) => set("imagen_portada", e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <label className={lbl}>SEO — título</label>
            <Input value={form.seo_titulo} onChange={(e) => set("seo_titulo", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>SEO — descripción</label>
            <Input value={form.seo_descripcion} onChange={(e) => set("seo_descripcion", e.target.value)} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.en_menu} onChange={(e) => set("en_menu", e.target.checked)} />
            Mostrar en el menú
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.es_grupo_menu} onChange={(e) => set("es_grupo_menu", e.target.checked)} />
            Solo agrupa en el menú (desplegable)
          </label>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)", color: "white" }}>
            {pending ? "…" : "Guardar página"}
          </Button>
          {msg && <span className="text-sm text-green-600">{msg}</span>}
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>

      {/* ── Secciones ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-gray-700">Secciones de la página</p>
          <div className="flex items-center gap-2">
            <select className={ta} value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value)} style={{ width: "auto" }}>
              {TIPOS_SECCION.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <Button type="button" variant="outline" onClick={agregarSeccion} disabled={pending}>
              + Agregar sección
            </Button>
          </div>
        </div>

        {pagina.secciones.length === 0 ? (
          <p className="text-sm text-gray-400">
            Esta página no tiene secciones aún. Agrega una para construir su contenido.
          </p>
        ) : (
          <div className="space-y-2">
            {pagina.secciones.map((sec, i) => (
              <SeccionFila
                key={sec.id}
                seccion={sec}
                primera={i === 0}
                ultima={i === pagina.secciones.length - 1}
                abierta={seccionAbierta === sec.id}
                onToggleAbrir={() =>
                  setSeccionAbierta((id) => (id === sec.id ? null : sec.id))
                }
                onChanged={onChanged}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SeccionFila({
  seccion,
  primera,
  ultima,
  abierta,
  onToggleAbrir,
  onChanged,
}: {
  seccion: SeccionRow;
  primera: boolean;
  ultima: boolean;
  abierta: boolean;
  onToggleAbrir: () => void;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const datos =
    seccion.datos && typeof seccion.datos === "object" && !Array.isArray(seccion.datos)
      ? (seccion.datos as Record<string, unknown>)
      : {};

  return (
    <div className="rounded-lg border border-gray-200">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggleAbrir}
          className="flex items-center gap-2 text-left text-sm font-medium text-gray-700"
        >
          <span className="text-gray-400">{abierta ? "▾" : "▸"}</span>
          {TIPO_SECCION_LBL[seccion.tipo] ?? seccion.tipo}
          {!seccion.visible && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-400">oculta</span>
          )}
        </button>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            disabled={pending || primera}
            onClick={() => start(async () => { await moverSeccion(seccion.id, "up"); onChanged(); })}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={pending || ultima}
            onClick={() => start(async () => { await moverSeccion(seccion.id, "down"); onChanged(); })}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => { await toggleSeccionVisible(seccion.id, !seccion.visible); onChanged(); })}
            className="text-gray-500 hover:underline"
          >
            {seccion.visible ? "Ocultar" : "Mostrar"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (confirm("¿Eliminar esta sección?"))
                start(async () => { await eliminarSeccion(seccion.id); onChanged(); });
            }}
            className="text-gray-400 hover:text-red-500"
          >
            Eliminar
          </button>
        </div>
      </div>
      {abierta && (
        <div className="border-t border-gray-100 px-3 py-3">
          <SeccionForm
            seccionId={seccion.id}
            tipo={seccion.tipo}
            datosIniciales={datos}
            onSaved={onChanged}
          />
        </div>
      )}
    </div>
  );
}

function toInput(p: PaginaConSecciones): WebPaginaInput {
  return {
    parent_id: p.parent_id ?? null,
    slug: p.slug ?? "",
    titulo: p.titulo ?? "",
    etiqueta_menu: p.etiqueta_menu ?? "",
    tipo: p.tipo ?? "generica",
    es_grupo_menu: !!p.es_grupo_menu,
    en_menu: !!p.en_menu,
    seo_titulo: p.seo_titulo ?? "",
    seo_descripcion: p.seo_descripcion ?? "",
    imagen_portada: p.imagen_portada ?? "",
  };
}
