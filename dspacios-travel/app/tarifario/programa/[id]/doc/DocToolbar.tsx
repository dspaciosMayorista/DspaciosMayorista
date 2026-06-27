"use client";

import Link from "next/link";
import { Printer, Building2, EyeOff, Image as ImageIcon, Square, Smartphone } from "lucide-react";

// Barra de herramientas del documento (no se imprime): alternar marca, imprimir
// y descargar las piezas que el dueño subió (flyer, historia, portada).
export function DocToolbar({
  marcaBlanca,
  flyerUrl,
  historiaUrl,
  portadaUrl,
}: {
  marcaBlanca: boolean;
  flyerUrl?: string | null;
  historiaUrl?: string | null;
  portadaUrl?: string | null;
}) {
  const btn = "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition";
  const on = { backgroundColor: "var(--brand-primary)", color: "#fff", borderColor: "var(--brand-primary)" };
  const off = { backgroundColor: "#fff", color: "#374151", borderColor: "#d1d5db" };
  const dl = (u: string) => (u.includes("?") ? u : `${u}?download`);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
      {/* Toggle marca */}
      <div className="mr-auto flex items-center gap-1 rounded-lg bg-gray-100 p-0.5">
        <Link href={`?marca=dspacios`} replace className={btn} style={!marcaBlanca ? on : off}>
          <Building2 size={13} /> D&apos;Spacios
        </Link>
        <Link href={`?marca=blanca`} replace className={btn} style={marcaBlanca ? on : off}>
          <EyeOff size={13} /> Marca blanca
        </Link>
      </div>

      {/* Piezas SUBIDAS (solo si existen) */}
      {flyerUrl && (
        <a href={dl(flyerUrl)} target="_blank" rel="noreferrer" className={btn} style={off}>
          <Square size={13} /> Flyer
        </a>
      )}
      {historiaUrl && (
        <a href={dl(historiaUrl)} target="_blank" rel="noreferrer" className={btn} style={off}>
          <Smartphone size={13} /> Historia
        </a>
      )}
      {portadaUrl && (
        <a href={dl(portadaUrl)} target="_blank" rel="noreferrer" className={btn} style={off}>
          <ImageIcon size={13} /> Portada
        </a>
      )}

      <button type="button" onClick={() => window.print()} className={btn} style={on}>
        <Printer size={13} /> Imprimir / PDF
      </button>
    </div>
  );
}
