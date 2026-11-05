"use client";
// Piezas de formulario compartidas por el montaje del paquete dinámico (#82): etiquetas, estilos y la rejilla de precios por acomodación.
import { Input } from "@/components/ui/input";
import { ACOMS_DIN, type AcomDin, type PrecioAcom } from "@/lib/paqueteDinamico/calculo";

export const ETQ: Record<AcomDin, string> = { sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple", nino: "Niño 1", nino2: "Niño 2", infante: "Infante" };
export const sel = "h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm";
export const lbl = "mb-1 block text-xs font-medium text-gray-600";
export const n = (s: string): number | null => (s.trim() === "" ? null : Number(s.replace(/[^\d.-]/g, "")));

export function GridAcom({ valor, onChange, etiqueta, solo }: { valor: PrecioAcom; onChange: (v: PrecioAcom) => void; etiqueta: string; solo?: readonly AcomDin[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {(solo ?? ACOMS_DIN).map((a) => (
        <div key={a} className="min-w-0">
          <label className={lbl}>{etiqueta} · {ETQ[a]}</label>
          <Input inputMode="numeric" aria-label={`${etiqueta} ${ETQ[a]}`} value={valor[a] == null ? "" : String(valor[a])} onChange={(e) => onChange({ ...valor, [a]: n(e.target.value) })} />
        </div>
      ))}
    </div>
  );
}
