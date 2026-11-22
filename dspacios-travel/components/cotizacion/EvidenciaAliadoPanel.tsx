"use client";

// O-3 — evidencia previa que el aliado adjuntó a su cotización, vista por el PERSONAL autorizado ANTES de registrar un pago. Solo lectura: abrir archivos.
// Una evidencia no registra, no aprueba ni cambia ningún pago, saldo o mínimo; el pago lo registra el personal en su propia pantalla.
import { useState } from "react";
import { ExternalLink, FileText, Image as ImagenIcono } from "lucide-react";
import { urlEvidenciaInterna } from "@/app/(dashboard)/dashboard/cotizaciones/evidencia-actions";

export type EvidenciaInterna = { id: number; cotizacion_id: number; nombre_original: string; mime: string; size_bytes: number; subido_en: string; vigente: boolean; retirado_en: string | null };

const kb = (b: number) => (b >= 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1000))} KB`);
const fecha = (iso: string) => new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });

export function EvidenciaAliadoPanel({ evidencias, codigos, antesDe }: { evidencias: EvidenciaInterna[]; /** código de cada cotización de origen (por id) */ codigos: Record<number, string>; antesDe: "registrar un pago" | "registrar un abono" }) {
  const [error, setError] = useState("");
  const vigentes = evidencias.filter((e) => e.vigente);
  const retiradas = evidencias.filter((e) => !e.vigente);
  if (evidencias.length === 0) return null;
  async function abrir(id: number) {
    setError("");
    const r = await urlEvidenciaInterna(id);
    if (r.ok) window.open(r.url, "_blank", "noopener,noreferrer"); else setError(r.error);
  }
  return (
    <section className="mb-4 rounded-xl border border-[#1D7C9A]/40 bg-white p-4 shadow-sm sm:p-5" aria-label="Evidencia previa del aliado" data-testid="evidencia-aliado">
      <p className="text-sm font-semibold text-gray-700">Evidencia previa del aliado ({vigentes.length} vigente{vigentes.length === 1 ? "" : "s"})</p>
      <p className="mb-2 mt-1 text-xs text-gray-500">Revísala antes de {antesDe}. <strong>Es evidencia adjunta por el aliado, no un pago:</strong> no registra ni aprueba nada y no cambia el saldo ni el mínimo de confirmación.</p>
      {vigentes.length > 0 && (
        <ul className="space-y-2">
          {vigentes.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-gray-100 bg-white px-3 py-2">
              {e.mime === "application/pdf" ? <FileText size={16} aria-hidden className="shrink-0 text-gray-400" /> : <ImagenIcono size={16} aria-hidden className="shrink-0 text-gray-400" />}
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-sm text-gray-800" title={e.nombre_original}>{e.nombre_original}</p>
                <p className="text-[11px] text-gray-400">{kb(e.size_bytes)} · adjunto {fecha(e.subido_en)} · cotización {codigos[e.cotizacion_id] ?? `#${e.cotizacion_id}`}</p>
              </div>
              <button type="button" onClick={() => void abrir(e.id)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-[#1D7C9A] hover:bg-gray-50">
                <ExternalLink size={14} aria-hidden /> Abrir
              </button>
            </li>
          ))}
        </ul>
      )}
      {retiradas.length > 0 && <p className="mt-2 text-[11px] text-gray-400">El aliado retiró {retiradas.length} comprobante(s); se conservan los archivos.</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
