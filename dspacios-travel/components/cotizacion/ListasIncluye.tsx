// #75 — Piezas de presentación compartidas por la hoja imprimible y el selector interactivo de la comparativa.
// Sin hooks ni acciones: solo pintan lo que ya trae `ResumenHotelUI` (nada de costos, proveedores ni términos NETO).
import { Check, X } from "lucide-react";
import { COLOR_DOCUMENTO } from "@/lib/contrato/colorDocumento";
import { formatMoneda } from "@/lib/utils";
import type { MenorOpcion } from "@/lib/cotizacion/comparativa";

const PRIMARY = COLOR_DOCUMENTO;

/** `opcion` rotula el bloque cuando es exclusivo de una opción: si un salto de página (o la lectura en pantalla) lo separa de su tarjeta, sigue identificado. */
export function ListasIncluye({ incluye, noIncluye, opcion, columnas = 2 }: { incluye: string[]; noIncluye: string[]; opcion?: string; columnas?: 1 | 2 }) {
  const rotulo = opcion ? <span className="font-normal text-gray-400"> · Opción {opcion}</span> : null;
  return (
    <div className={"grid grid-cols-1 gap-3 " + (columnas === 2 ? "sm:grid-cols-2" : "")} data-testid="incluye-no-incluye">
      {incluye.length > 0 && (
        <div className="min-w-0 rounded-lg border border-gray-100 p-3">
          <h4 className="mb-2 text-sm font-semibold" style={{ color: PRIMARY }}>Incluye{rotulo}</h4>
          <ul className="space-y-1 text-xs text-gray-700">
            {incluye.map((t, i) => <li key={i} className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0" style={{ color: PRIMARY }} aria-hidden /><span className="min-w-0 break-words">{t}</span></li>)}
          </ul>
        </div>
      )}
      {noIncluye.length > 0 && (
        <div className="min-w-0 rounded-lg border border-gray-100 p-3">
          <h4 className="mb-2 text-sm font-semibold text-gray-500">No incluye{rotulo}</h4>
          <ul className="space-y-1 text-xs text-gray-600">
            {noIncluye.map((t, i) => <li key={i} className="flex gap-2"><X size={13} className="mt-0.5 shrink-0 text-gray-400" aria-hidden /><span className="min-w-0 break-words">{t}</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Tarifa de los menores de UNA opción (la REAL del snapshot). Si la opción es NETO y sus líneas de menores están a PVP (`noDesglosables`), no se muestran
 * como tarifa: se explica el límite. `pvp` marca las filas cuando la pantalla está mostrando la vista previa NETO del total.
 */
export function MenoresOpcion({ menores, noDesglosables, moneda, pvp }: { menores?: MenorOpcion[]; noDesglosables?: boolean; moneda: string; pvp?: boolean }) {
  if (noDesglosables) {
    return <p data-testid="menores-no-desglosables" className="rounded-lg bg-gray-50 px-2 py-1.5 text-left text-[11px] leading-snug text-gray-500">La tarifa individual de los menores no se desglosa con seguridad en esta opción; consúltala con tu asesor.</p>;
  }
  if (!menores?.length) return null;
  return (
    <>
      {menores.map((m, i) => (
        <div key={i} data-testid="menor-opcion" className="flex items-baseline justify-between gap-3 text-xs text-gray-500">
          <span className="min-w-0 break-words text-left">{m.cantidad} × {m.descripcion}{pvp ? " (PVP original)" : ""}</span>
          <span className="shrink-0 whitespace-nowrap font-medium tabular-nums text-gray-700">{m.tarifa > 0 ? formatMoneda(m.tarifa, moneda) : "Sin costo"}</span>
        </div>
      ))}
    </>
  );
}
