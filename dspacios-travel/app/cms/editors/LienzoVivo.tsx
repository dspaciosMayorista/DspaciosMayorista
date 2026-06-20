"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Reorder, useDragControls } from "framer-motion";
// El sitio se renderiza con los MISMOS componentes del público (.jsx).
import SeccionRenderer from "@/components/sitio/secciones/SeccionRenderer";
import { EdicionSeccion } from "@/components/sitio/edicion/EdicionContext";
import type { PaginaConSecciones, SeccionRow } from "../tipos";
import {
  actualizarSeccion,
  crearSeccion,
  duplicarSeccion,
  eliminarSeccion,
  reordenarSecciones,
  toggleSeccionVisible,
} from "../actions";
import { SeccionForm } from "./SeccionForm";

type Datos = Record<string, unknown>;

const BLOQUES: Record<string, { icon: string; label: string }> = {
  hero: { icon: "🖼️", label: "Hero (portada)" },
  texto: { icon: "📝", label: "Texto" },
  galeria: { icon: "🎞️", label: "Galería" },
  destinos_grid: { icon: "🗺️", label: "Grilla de destinos" },
  experiencias: { icon: "✨", label: "Experiencias" },
  testimonios: { icon: "💬", label: "Testimonios" },
  blog_grid: { icon: "📰", label: "Grilla de blog" },
  cta: { icon: "👆", label: "CTA" },
  contacto: { icon: "✉️", label: "Contacto" },
  actividades: { icon: "📍", label: "Actividades" },
  plan: { icon: "✅", label: "Plan incluye / no incluye" },
  flyers: { icon: "📄", label: "Flyers" },
  consulta_disponibilidad: { icon: "🔎", label: "Consulta disponibilidad" },
};
const meta = (t: string) => BLOQUES[t] ?? { icon: "▫️", label: t };
// Bloques con edición de texto IN-SITU ya cableada (los demás se editan por panel).
const INLINE = new Set(["hero", "texto", "cta"]);

function asDatos(d: unknown): Datos {
  return d && typeof d === "object" && !Array.isArray(d) ? (d as Datos) : {};
}

export function LienzoVivo({
  pagina,
  paginas,
  sitio,
  onChanged,
}: {
  pagina: PaginaConSecciones;
  paginas: PaginaConSecciones[];
  sitio: { config: unknown; testimonios: unknown[]; blog: unknown[]; destinos: unknown[] };
  onChanged: () => void;
}) {
  const [orden, setOrden] = useState<SeccionRow[]>(pagina.secciones);
  const [datosLocal, setDatosLocal] = useState<Record<number, Datos>>(() =>
    Object.fromEntries(pagina.secciones.map((s) => [s.id, asDatos(s.datos)]))
  );
  const [sel, setSel] = useState<number | null>(null);
  const [campos, setCampos] = useState<SeccionRow | null>(null); // sección con panel abierto
  const [paleta, setPaleta] = useState(false);
  const [estado, setEstado] = useState<"" | "guardando" | "guardado" | "error">("");
  const [, start] = useTransition();
  const guardadoRef = useRef(pagina.secciones.map((s) => s.id).join(","));
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // Resync cuando cambia la página o llegan datos nuevos del server.
  useEffect(() => {
    setOrden(pagina.secciones);
    setDatosLocal(Object.fromEntries(pagina.secciones.map((s) => [s.id, asDatos(s.datos)])));
    guardadoRef.current = pagina.secciones.map((s) => s.id).join(",");
    setSel(null);
    setCampos(null);
  }, [pagina]);

  // Contexto que necesitan las secciones (mismo criterio que PaginaRenderer).
  const esGrupo = pagina.tipo === "destinos_nacionales" || pagina.tipo === "destinos_internacionales";
  const hijos = esGrupo
    ? paginas
        .filter((p) => p.parent_id === pagina.id)
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        .map((p) => ({ id: p.id, slug: p.slug, titulo: p.titulo, imagenPortada: p.imagen_portada }))
    : [];
  const contexto = {
    config: sitio.config,
    testimonios: sitio.testimonios,
    blog: sitio.blog,
    destinos: sitio.destinos,
    hijos,
  };

  // Guarda los datos de una sección (debounce); no refresca para no perder foco.
  function setCampo(id: number, campo: string, valor: unknown) {
    setDatosLocal((prev) => {
      const nuevo = { ...(prev[id] ?? {}), [campo]: valor };
      const merged = { ...prev, [id]: nuevo };
      clearTimeout(timers.current[id]);
      setEstado("guardando");
      timers.current[id] = setTimeout(async () => {
        const r = await actualizarSeccion(id, nuevo);
        setEstado(r.ok ? "guardado" : "error");
      }, 700);
      return merged;
    });
  }

  function persistirOrden() {
    const ids = orden.map((s) => s.id);
    const firma = ids.join(",");
    if (firma === guardadoRef.current) return;
    guardadoRef.current = firma;
    start(async () => {
      const r = await reordenarSecciones(pagina.id, ids);
      if (r.ok) onChanged();
    });
  }

  function accion(fn: () => Promise<{ ok: boolean }>) {
    start(async () => {
      const r = await fn();
      if (r.ok) onChanged();
    });
  }

  function agregar(tipo: string) {
    setPaleta(false);
    start(async () => {
      const r = await crearSeccion(pagina.id, tipo);
      if (r.ok) onChanged();
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <style>{`
        .cms-editable { transition: outline-color .12s; outline: 1px dashed transparent; outline-offset: 2px; border-radius: 2px; }
        .cms-editable:hover { outline-color: var(--brand-accent); cursor: text; }
        .cms-editable:focus { outline: 2px solid var(--brand-primary); }
        .cms-editable:empty::before { content: attr(data-cms-placeholder); opacity: .45; }
      `}</style>

      {/* Barra superior del lienzo */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-2">
        <p className="text-sm font-semibold text-gray-700">
          Vista editable · <span className="font-normal text-gray-400">click en un texto para editarlo</span>
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {estado === "guardando" ? "Guardando…" : estado === "guardado" ? "Guardado ✓" : estado === "error" ? "Error al guardar" : ""}
          </span>
          <button type="button" onClick={() => setPaleta((v) => !v)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
            + Agregar bloque
          </button>
        </div>
      </div>

      {paleta && (
        <div className="grid grid-cols-2 gap-2 border-b border-gray-100 bg-gray-50 p-3 sm:grid-cols-3 md:grid-cols-4">
          {Object.entries(BLOQUES).map(([tipo, m]) => (
            <button key={tipo} type="button" onClick={() => agregar(tipo)} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-2 text-left text-xs font-medium text-gray-700 hover:border-[var(--brand-primary)]">
              <span className="text-lg">{m.icon}</span> {m.label}
            </button>
          ))}
        </div>
      )}

      {/* Lienzo: las secciones reales, editables */}
      {orden.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-400">Página sin bloques. Pulsa “+ Agregar bloque”.</p>
      ) : (
        <Reorder.Group axis="y" values={orden} onReorder={setOrden} onPointerUp={persistirOrden} className="divide-y divide-gray-50">
          {orden.map((sec) => (
            <BloqueVivo
              key={sec.id}
              seccion={sec}
              datos={datosLocal[sec.id] ?? asDatos(sec.datos)}
              contexto={contexto}
              inline={INLINE.has(sec.tipo)}
              seleccionado={sel === sec.id}
              onSeleccionar={() => setSel(sec.id)}
              setCampo={(campo, valor) => setCampo(sec.id, campo, valor)}
              onCampos={() => setCampos(sec)}
              onDuplicar={() => accion(() => duplicarSeccion(sec.id))}
              onVisible={() => accion(() => toggleSeccionVisible(sec.id, !sec.visible))}
              onEliminar={() => { if (confirm("¿Eliminar este bloque?")) accion(() => eliminarSeccion(sec.id)); }}
            />
          ))}
        </Reorder.Group>
      )}

      {/* Panel lateral de campos (para imágenes/listas y bloques sin edición inline) */}
      {campos && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setCampos(null)}>
          <div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">{meta(campos.tipo).icon} {meta(campos.tipo).label} — campos</h3>
              <button type="button" onClick={() => setCampos(null)} className="text-sm text-gray-400 hover:text-gray-700">Cerrar ✕</button>
            </div>
            <SeccionForm
              seccionId={campos.id}
              tipo={campos.tipo}
              datosIniciales={datosLocal[campos.id] ?? asDatos(campos.datos)}
              onSaved={() => { setCampos(null); onChanged(); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function BloqueVivo({
  seccion,
  datos,
  contexto,
  inline,
  seleccionado,
  onSeleccionar,
  setCampo,
  onCampos,
  onDuplicar,
  onVisible,
  onEliminar,
}: {
  seccion: SeccionRow;
  datos: Datos;
  contexto: unknown;
  inline: boolean;
  seleccionado: boolean;
  onSeleccionar: () => void;
  setCampo: (campo: string, valor: unknown) => void;
  onCampos: () => void;
  onDuplicar: () => void;
  onVisible: () => void;
  onEliminar: () => void;
}) {
  const controls = useDragControls();
  const m = meta(seccion.tipo);

  return (
    <Reorder.Item value={seccion} dragListener={false} dragControls={controls} className="relative">
      {/* Capa que evita que los botones/enlaces del sitio naveguen mientras editas */}
      <div
        className={`relative ${seccion.visible ? "" : "opacity-50"} ${seleccionado ? "ring-2 ring-[var(--brand-primary)]" : "hover:ring-1 hover:ring-[var(--brand-accent)]"}`}
        onClickCapture={(e) => {
          const t = e.target as HTMLElement;
          if (t.closest("[data-cms-tb]")) return;          // controles del editor
          if (t.isContentEditable) return;                  // editar texto
          const nav = t.closest("a,button");
          if (nav && !nav.closest("[data-cms-tb]")) { e.preventDefault(); e.stopPropagation(); }
          onSeleccionar();
        }}
      >
        {/* Barra de acciones del bloque */}
        <div data-cms-tb className="absolute right-2 top-2 z-30 flex items-center gap-1 rounded-lg border border-gray-200 bg-white/95 px-1.5 py-1 text-xs shadow-sm">
          <button type="button" title="Arrastrar" onPointerDown={(e) => controls.start(e)} className="cursor-grab touch-none px-1 text-gray-400 active:cursor-grabbing">⠿</button>
          <span className="px-1 text-[11px] font-medium text-gray-500">{m.icon} {m.label}</span>
          <button type="button" onClick={onCampos} className="px-1 text-gray-500 hover:text-[var(--brand-primary)]" title="Campos / imágenes">⚙</button>
          <button type="button" onClick={onDuplicar} className="px-1 text-gray-500 hover:text-gray-800" title="Duplicar">⧉</button>
          <button type="button" onClick={onVisible} className="px-1 text-gray-500 hover:text-gray-800" title={seccion.visible ? "Ocultar" : "Mostrar"}>{seccion.visible ? "🙈" : "👁"}</button>
          <button type="button" onClick={onEliminar} className="px-1 text-gray-500 hover:text-red-500" title="Eliminar">🗑</button>
        </div>

        {/* Aviso si este tipo aún no tiene edición inline */}
        {!inline && (
          <div data-cms-tb className="absolute left-2 top-2 z-30 rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
            Edita este bloque con ⚙ campos
          </div>
        )}

        <EdicionSeccion value={{ editable: inline, datos, set: setCampo }}>
          {/* @ts-expect-error SeccionRenderer es .jsx (sin tipos) */}
          <SeccionRenderer seccion={{ ...seccion, datos }} contexto={contexto} />
        </EdicionSeccion>
      </div>
    </Reorder.Item>
  );
}
