"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Reorder, useDragControls } from "framer-motion";
import type { SeccionRow } from "../tipos";
import {
  crearSeccion,
  duplicarSeccion,
  eliminarSeccion,
  reordenarSecciones,
  toggleSeccionVisible,
} from "../actions";
import { SeccionForm } from "./SeccionForm";

// Metadatos visuales por tipo de bloque (icono + nombre + descripción para la paleta).
const BLOQUES: Record<string, { icon: string; label: string; desc: string }> = {
  hero: { icon: "🖼️", label: "Hero (portada)", desc: "Imagen grande con título y botón" },
  texto: { icon: "📝", label: "Texto", desc: "Bloque de texto enriquecido" },
  galeria: { icon: "🎞️", label: "Galería", desc: "Cuadrícula de imágenes" },
  destinos_grid: { icon: "🗺️", label: "Grilla de destinos", desc: "Tarjetas de destinos / subpáginas" },
  experiencias: { icon: "✨", label: "Experiencias", desc: "Bloques de experiencias" },
  testimonios: { icon: "💬", label: "Testimonios", desc: "Opiniones de clientes" },
  blog_grid: { icon: "📰", label: "Grilla de blog", desc: "Últimos artículos" },
  cta: { icon: "👆", label: "CTA", desc: "Llamado a la acción con botón" },
  contacto: { icon: "✉️", label: "Contacto", desc: "Datos de contacto / formulario" },
  actividades: { icon: "📍", label: "Actividades", desc: "Lista de actividades imperdibles" },
  plan: { icon: "✅", label: "Plan incluye / no incluye", desc: "Qué incluye y qué no" },
  flyers: { icon: "📄", label: "Flyers", desc: "Botones que abren flyers/PDF" },
  consulta_disponibilidad: { icon: "🔎", label: "Consulta disponibilidad", desc: "Enlace al tarifario" },
};
const meta = (tipo: string) => BLOQUES[tipo] ?? { icon: "▫️", label: tipo, desc: "" };

// Resumen del contenido del bloque para la tarjeta (sin abrir el editor).
function resumen(datos: Record<string, unknown>): { texto: string; imagen: string | null } {
  const str = (k: string) => (typeof datos[k] === "string" ? (datos[k] as string) : "");
  const texto =
    str("titulo") || str("title") || str("subtitulo") || str("texto") || str("contenido") || "";
  const imagen =
    str("imagen_url") || str("imagen") || str("imagenUrl") || str("fondo_url") || null;
  return { texto: texto.slice(0, 90), imagen: imagen || null };
}

function asDatos(d: unknown): Record<string, unknown> {
  return d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
}

export function BloquesCanvas({
  paginaId,
  secciones,
  onChanged,
}: {
  paginaId: number;
  secciones: SeccionRow[];
  onChanged: () => void;
}) {
  const [orden, setOrden] = useState<SeccionRow[]>(secciones);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [paleta, setPaleta] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const guardadoRef = useRef<string>(secciones.map((s) => s.id).join(","));

  // Sincroniza cuando cambian las secciones desde el server (otra página, guardado…).
  useEffect(() => {
    setOrden(secciones);
    guardadoRef.current = secciones.map((s) => s.id).join(",");
  }, [secciones]);

  // Persiste el nuevo orden si cambió (al soltar el bloque).
  function persistirOrden() {
    const ids = orden.map((s) => s.id);
    const firma = ids.join(",");
    if (firma === guardadoRef.current) return;
    guardadoRef.current = firma;
    start(async () => {
      const r = await reordenarSecciones(paginaId, ids);
      if (r.ok) onChanged();
      else setErr(r.error);
    });
  }

  function agregar(tipo: string) {
    setPaleta(false);
    start(async () => {
      const r = await crearSeccion(paginaId, tipo);
      if (r.ok) { setAbierta(r.id); onChanged(); }
      else setErr(r.error);
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">Bloques de la página</p>
        <button
          type="button"
          onClick={() => setPaleta((v) => !v)}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
          style={{ backgroundColor: "var(--brand-primary)" }}
        >
          + Agregar bloque
        </button>
      </div>

      {/* Paleta visual de bloques */}
      {paleta && (
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3 sm:grid-cols-3">
          {Object.entries(BLOQUES).map(([tipo, m]) => (
            <button
              key={tipo}
              type="button"
              onClick={() => agregar(tipo)}
              disabled={pending}
              className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left hover:border-[var(--brand-primary)] hover:shadow-sm disabled:opacity-50"
            >
              <span className="text-xl leading-none">{m.icon}</span>
              <span>
                <span className="block text-xs font-semibold text-gray-700">{m.label}</span>
                <span className="block text-[11px] text-gray-400">{m.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {orden.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">
          Página sin bloques. Pulsa “+ Agregar bloque” para empezar.
        </p>
      ) : (
        <Reorder.Group
          axis="y"
          values={orden}
          onReorder={setOrden}
          className="space-y-2"
          onPointerUp={persistirOrden}
        >
          {orden.map((sec) => (
            <BloqueItem
              key={sec.id}
              seccion={sec}
              abierta={abierta === sec.id}
              onToggle={() => setAbierta((id) => (id === sec.id ? null : sec.id))}
              onChanged={onChanged}
              setErr={setErr}
            />
          ))}
        </Reorder.Group>
      )}

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </div>
  );
}

function BloqueItem({
  seccion,
  abierta,
  onToggle,
  onChanged,
  setErr,
}: {
  seccion: SeccionRow;
  abierta: boolean;
  onToggle: () => void;
  onChanged: () => void;
  setErr: (s: string) => void;
}) {
  const controls = useDragControls();
  const [pending, start] = useTransition();
  const m = meta(seccion.tipo);
  const datos = asDatos(seccion.datos);
  const { texto, imagen } = resumen(datos);

  const accion = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) onChanged();
      else setErr(r.error ?? "Error");
    });

  return (
    <Reorder.Item
      value={seccion}
      dragListener={false}
      dragControls={controls}
      className={`rounded-lg border bg-white ${seccion.visible ? "border-gray-200" : "border-dashed border-gray-300 opacity-70"}`}
    >
      <div className="flex items-center gap-2 px-2 py-2">
        {/* Asa de arrastre */}
        <button
          type="button"
          aria-label="Arrastrar para reordenar"
          onPointerDown={(e) => controls.start(e)}
          className="cursor-grab touch-none px-1 text-gray-300 hover:text-gray-500 active:cursor-grabbing"
        >
          ⠿
        </button>

        {/* Miniatura / icono */}
        {imagen ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imagen} alt="" className="h-10 w-14 shrink-0 rounded object-cover" />
        ) : (
          <span className="grid h-10 w-14 shrink-0 place-items-center rounded bg-gray-50 text-xl">{m.icon}</span>
        )}

        {/* Tipo + resumen */}
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
            {m.label}
            {!seccion.visible && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400">oculto</span>}
          </span>
          {texto && <span className="block truncate text-xs text-gray-400">{texto}</span>}
        </button>

        {/* Acciones */}
        <div className="flex shrink-0 items-center gap-2 text-xs text-gray-400">
          <button type="button" onClick={onToggle} className="hover:text-[var(--brand-primary)]" title="Editar">{abierta ? "Cerrar" : "Editar"}</button>
          <button type="button" disabled={pending} onClick={() => accion(() => duplicarSeccion(seccion.id))} className="hover:text-gray-700" title="Duplicar">Duplicar</button>
          <button type="button" disabled={pending} onClick={() => accion(() => toggleSeccionVisible(seccion.id, !seccion.visible))} className="hover:text-gray-700" title={seccion.visible ? "Ocultar" : "Mostrar"}>{seccion.visible ? "Ocultar" : "Mostrar"}</button>
          <button type="button" disabled={pending} onClick={() => { if (confirm("¿Eliminar este bloque?")) accion(() => eliminarSeccion(seccion.id)); }} className="hover:text-red-500" title="Eliminar">Eliminar</button>
        </div>
      </div>

      {abierta && (
        <div className="border-t border-gray-100 px-3 py-3">
          <SeccionForm seccionId={seccion.id} tipo={seccion.tipo} datosIniciales={datos} onSaved={onChanged} />
        </div>
      )}
    </Reorder.Item>
  );
}
