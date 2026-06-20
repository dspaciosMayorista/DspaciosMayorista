"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Reorder, useDragControls } from "framer-motion";
import {
  Image as ImageIcon, Type, Images, LayoutGrid, Sparkles, Quote, Newspaper,
  MousePointerClick, Mail, MapPin, ClipboardCheck, FileImage, CalendarSearch,
  GripVertical, SlidersHorizontal, Copy, Eye, EyeOff, Trash2, Plus,
  Monitor, Smartphone, type LucideIcon,
} from "lucide-react";
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

const BLOQUES: Record<string, { Icon: LucideIcon; label: string }> = {
  hero: { Icon: ImageIcon, label: "Hero (portada)" },
  texto: { Icon: Type, label: "Texto" },
  galeria: { Icon: Images, label: "Galería" },
  destinos_grid: { Icon: LayoutGrid, label: "Grilla de destinos" },
  experiencias: { Icon: Sparkles, label: "Experiencias" },
  testimonios: { Icon: Quote, label: "Testimonios" },
  blog_grid: { Icon: Newspaper, label: "Grilla de blog" },
  cta: { Icon: MousePointerClick, label: "CTA" },
  contacto: { Icon: Mail, label: "Contacto" },
  actividades: { Icon: MapPin, label: "Actividades" },
  plan: { Icon: ClipboardCheck, label: "Plan incluye / no incluye" },
  flyers: { Icon: FileImage, label: "Flyers" },
  consulta_disponibilidad: { Icon: CalendarSearch, label: "Consulta disponibilidad" },
};
const meta = (t: string) => BLOQUES[t] ?? { Icon: LayoutGrid, label: t };

function asDatos(d: unknown): Datos {
  return d && typeof d === "object" && !Array.isArray(d) ? (d as Datos) : {};
}

export function LienzoVivo({
  pagina,
  paginas,
  sitio,
  previewSrc,
  onChanged,
}: {
  pagina: PaginaConSecciones;
  paginas: PaginaConSecciones[];
  sitio: { config: unknown; testimonios: unknown[]; blog: unknown[]; destinos: unknown[] };
  previewSrc: string;
  onChanged: () => void;
}) {
  const [orden, setOrden] = useState<SeccionRow[]>(pagina.secciones);
  const [datosLocal, setDatosLocal] = useState<Record<number, Datos>>(() =>
    Object.fromEntries(pagina.secciones.map((s) => [s.id, asDatos(s.datos)]))
  );
  const [sel, setSel] = useState<number | null>(null);
  const [campos, setCampos] = useState<SeccionRow | null>(null);
  const [paleta, setPaleta] = useState(false);
  const [vista, setVista] = useState<"escritorio" | "movil">("escritorio");
  const [estado, setEstado] = useState<"" | "guardando" | "guardado" | "error">("");
  const [, start] = useTransition();
  const guardadoRef = useRef(pagina.secciones.map((s) => s.id).join(","));
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    setOrden(pagina.secciones);
    setDatosLocal(Object.fromEntries(pagina.secciones.map((s) => [s.id, asDatos(s.datos)])));
    guardadoRef.current = pagina.secciones.map((s) => s.id).join(",");
    setSel(null);
    setCampos(null);
  }, [pagina]);

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

      {/* Barra superior */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-2">
        <p className="text-sm font-semibold text-gray-700">
          Vista editable · <span className="font-normal text-gray-400">click en un texto para editarlo</span>
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {estado === "guardando" ? "Guardando…" : estado === "guardado" ? "Guardado ✓" : estado === "error" ? "Error al guardar" : ""}
          </span>
          {/* Toggle escritorio / móvil */}
          <div className="flex items-center rounded-lg border border-gray-200 p-0.5">
            <button type="button" onClick={() => setVista("escritorio")} title="Escritorio"
              className={`grid h-7 w-7 place-items-center rounded-md ${vista === "escritorio" ? "bg-[var(--brand-primary)] text-white" : "text-gray-500"}`}>
              <Monitor size={15} />
            </button>
            <button type="button" onClick={() => setVista("movil")} title="Móvil"
              className={`grid h-7 w-7 place-items-center rounded-md ${vista === "movil" ? "bg-[var(--brand-primary)] text-white" : "text-gray-500"}`}>
              <Smartphone size={15} />
            </button>
          </div>
          <button type="button" onClick={() => setPaleta((v) => !v)} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
            <Plus size={15} /> Agregar bloque
          </button>
        </div>
      </div>

      {paleta && (
        <div className="grid grid-cols-2 gap-2 border-b border-gray-100 bg-gray-50 p-3 sm:grid-cols-3 md:grid-cols-4">
          {Object.entries(BLOQUES).map(([tipo, m]) => {
            const Icon = m.Icon;
            return (
              <button key={tipo} type="button" onClick={() => agregar(tipo)} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-2 text-left text-xs font-medium text-gray-700 hover:border-[var(--brand-primary)]">
                <Icon size={16} className="text-[var(--brand-primary)]" /> {m.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Vista MÓVIL: preview real (publicado) en marco angosto */}
      {vista === "movil" ? (
        <div className="flex flex-col items-center gap-2 bg-gray-100 py-6">
          <div className="overflow-hidden rounded-[2rem] border-8 border-gray-800 shadow-xl" style={{ width: 390 }}>
            <iframe src={previewSrc} title="Vista móvil" className="h-[680px] w-[374px] bg-white" />
          </div>
          <p className="text-[11px] text-gray-400">Vista móvil de la página publicada (refleja lo guardado).</p>
        </div>
      ) : orden.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-400">Página sin bloques. Pulsa “Agregar bloque”.</p>
      ) : (
        <Reorder.Group axis="y" values={orden} onReorder={setOrden} onPointerUp={persistirOrden} className="divide-y divide-gray-50">
          {orden.map((sec) => (
            <BloqueVivo
              key={sec.id}
              seccion={sec}
              datos={datosLocal[sec.id] ?? asDatos(sec.datos)}
              contexto={contexto}
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

      {/* Panel lateral de campos (imágenes/listas y todo lo no inline) */}
      {campos && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setCampos(null)}>
          <div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                {(() => { const Icon = meta(campos.tipo).Icon; return <Icon size={16} className="text-[var(--brand-primary)]" />; })()}
                {meta(campos.tipo).label} — campos
              </h3>
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
  seleccionado: boolean;
  onSeleccionar: () => void;
  setCampo: (campo: string, valor: unknown) => void;
  onCampos: () => void;
  onDuplicar: () => void;
  onVisible: () => void;
  onEliminar: () => void;
}) {
  const controls = useDragControls();
  const { Icon, label } = meta(seccion.tipo);

  return (
    <Reorder.Item value={seccion} dragListener={false} dragControls={controls} className="relative">
      <div
        className={`relative ${seccion.visible ? "" : "opacity-50"} ${seleccionado ? "ring-2 ring-[var(--brand-primary)]" : "hover:ring-1 hover:ring-[var(--brand-accent)]"}`}
        onClickCapture={(e) => {
          const t = e.target as HTMLElement;
          if (t.closest("[data-cms-tb]")) return;
          if (t.isContentEditable) return;
          const nav = t.closest("a,button");
          if (nav && !nav.closest("[data-cms-tb]")) { e.preventDefault(); e.stopPropagation(); }
          onSeleccionar();
        }}
      >
        {/* Barra de acciones del bloque */}
        <div data-cms-tb className="absolute right-2 top-2 z-30 flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white/95 px-1.5 py-1 shadow-sm">
          <button type="button" title="Arrastrar para reordenar" onPointerDown={(e) => controls.start(e)} className="cursor-grab touch-none px-1 text-gray-400 active:cursor-grabbing"><GripVertical size={15} /></button>
          <span className="flex items-center gap-1 px-1 text-[11px] font-medium text-gray-500"><Icon size={13} /> {label}</span>
          <button type="button" onClick={onCampos} className="px-1 text-gray-500 hover:text-[var(--brand-primary)]" title="Campos / imágenes"><SlidersHorizontal size={15} /></button>
          <button type="button" onClick={onDuplicar} className="px-1 text-gray-500 hover:text-gray-800" title="Duplicar"><Copy size={15} /></button>
          <button type="button" onClick={onVisible} className="px-1 text-gray-500 hover:text-gray-800" title={seccion.visible ? "Ocultar" : "Mostrar"}>{seccion.visible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
          <button type="button" onClick={onEliminar} className="px-1 text-gray-500 hover:text-red-500" title="Eliminar"><Trash2 size={15} /></button>
        </div>

        <EdicionSeccion value={{ editable: true, datos, set: setCampo }}>
          {/* @ts-expect-error SeccionRenderer es .jsx (sin tipos) */}
          <SeccionRenderer seccion={{ ...seccion, datos }} contexto={contexto} />
        </EdicionSeccion>
      </div>
    </Reorder.Item>
  );
}
