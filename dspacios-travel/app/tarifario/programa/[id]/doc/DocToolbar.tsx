"use client";

import Link from "next/link";
import { Printer, Building2, EyeOff } from "lucide-react";

// Barra de herramientas del documento (no se imprime): alternar marca e
// imprimir. Las piezas subidas (flyer/historia) se descargan desde la vitrina
// del programa, al lado de "Generar documento PDF" — no aquí.
export function DocToolbar({
  marcaBlanca,
}: {
  marcaBlanca: boolean;
}) {
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

      <button type="button" onClick={() => window.print()} className={btn} style={on}>
        <Printer size={13} /> Imprimir / PDF
      </button>
    </div>
  );
}
