"use client";

// Soportes de pago del aliado (#86) — vista del PERSONAL INTERNO en la ficha del contrato. Solo lectura: abrir vigentes y consultar el historial
// (reemplazados y retirados siguen disponibles; nada se borra). Un soporte no es un pago: no hay aquí ninguna acción financiera.
import { useState } from "react";
import { ExternalLink, FileText, Image as ImagenIcono } from "lucide-react";
import { urlSoporteInterno } from "./soportes-actions";
import { estaExcedido } from "@/lib/soportes/archivo";

export type SoporteInterno = {
  id: number; nombre_original: string; mime: string; size_bytes: number; subido_en: string;
  vigente: boolean; motivo_retiro: "reemplazo" | "retiro" | null; retirado_en: string | null; nota_retiro: string | null; reemplaza_id: number | null;
};

const kb = (b: number) => (b >= 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1000))} KB`);
const fecha = (iso: string) => new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });

export function SoportesPagoInterno({ soportes, abonos }: { soportes: SoporteInterno[]; abonos: number }) {
  const [error, setError] = useState("");
  const vigentes = soportes.filter((s) => s.vigente);
  const historial = soportes.filter((s) => !s.vigente);
  if (soportes.length === 0) return null;

  async function abrir(id: number) {
    setError("");
    const r = await urlSoporteInterno(id);
    if (r.ok) window.open(r.url, "_blank", "noopener,noreferrer"); else setError(r.error);
  }
  const fila = (s: SoporteInterno) => (
    <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-gray-100 bg-white px-3 py-2">
      {s.mime === "application/pdf" ? <FileText size={16} aria-hidden className="shrink-0 text-gray-400" /> : <ImagenIcono size={16} aria-hidden className="shrink-0 text-gray-400" />}
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm text-gray-800" title={s.nombre_original}>{s.nombre_original}</p>
        <p className="text-[11px] text-gray-400">
          {kb(s.size_bytes)} · subido {fecha(s.subido_en)}
          {!s.vigente && s.retirado_en && <> · {s.motivo_retiro === "reemplazo" ? "reemplazado" : "retirado"} {fecha(s.retirado_en)}{s.nota_retiro ? ` · «${s.nota_retiro}»` : ""}</>}
          {s.reemplaza_id && <> · sustituye al soporte #{s.reemplaza_id}</>}
        </p>
      </div>
      <button type="button" onClick={() => void abrir(s.id)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-[#1D7C9A] hover:bg-gray-50">
        <ExternalLink size={14} aria-hidden /> Abrir
      </button>
    </li>
  );

  return (
    <section className="mt-8 rounded-xl border border-gray-300 bg-white p-4 shadow-sm sm:p-5" aria-label="Soportes de pago del aliado">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-700">Soportes de pago del aliado</p>
        <span className="text-xs text-gray-500">Vigentes {vigentes.length} de {abonos} {abonos === 1 ? "abono registrado" : "abonos registrados"}</span>
      </div>
      {estaExcedido(vigentes.length, abonos) && (
        <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Hay más soportes vigentes que abonos registrados (p. ej. tras anular un abono). No se descartó ninguna evidencia; el aliado puede reemplazar o retirar, no agregar.
        </p>
      )}
      <p className="mb-2 text-[11px] text-gray-400">Un soporte no registra ni aprueba un pago: es evidencia que adjunta el aliado. El historial conserva cada archivo reemplazado o retirado.</p>
      {vigentes.length > 0 && <ul className="space-y-2">{vigentes.map(fila)}</ul>}
      {historial.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-gray-600">Historial conservado ({historial.length})</summary>
          <ul className="mt-2 space-y-2">{historial.map(fila)}</ul>
        </details>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-[#C0392B]">{error}</p>}
    </section>
  );
}
