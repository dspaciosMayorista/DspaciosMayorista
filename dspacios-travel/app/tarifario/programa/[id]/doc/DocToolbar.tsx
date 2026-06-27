"use client";

import Link from "next/link";
import { Printer, Building2, EyeOff, Image as ImageIcon, Square, Smartphone } from "lucide-react";

// Barra de herramientas del documento (no se imprime): alternar marca, imprimir
// y descargar piezas (flyer cuadrado, historia IG, portada horizontal).
export function DocToolbar({ id, marcaBlanca }: { id: number; marcaBlanca: boolean }) {
  const btn = "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition";
  const on = { backgroundColor: "var(--brand-primary)", color: "#fff", borderColor: "var(--brand-primary)" };
  const off = { backgroundColor: "#fff", color: "#374151", borderColor: "#d1d5db" };

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

      {/* Piezas gráficas */}
      <a href={`/tarifario/programa/${id}/flyer${marcaBlanca ? "?marca=blanca" : ""}`} target="_blank" rel="noreferrer" className={btn} style={off}>
        <Square size={13} /> Flyer
      </a>
      <a href={`/tarifario/programa/${id}/story${marcaBlanca ? "?marca=blanca" : ""}`} target="_blank" rel="noreferrer" className={btn} style={off}>
        <Smartphone size={13} /> Historia
      </a>
      <a href={`/tarifario/programa/${id}/portada${marcaBlanca ? "?marca=blanca" : ""}`} target="_blank" rel="noreferrer" className={btn} style={off}>
        <ImageIcon size={13} /> Portada
      </a>

      <button type="button" onClick={() => window.print()} className={btn} style={on}>
        <Printer size={13} /> Imprimir / PDF
      </button>
    </div>
  );
}
