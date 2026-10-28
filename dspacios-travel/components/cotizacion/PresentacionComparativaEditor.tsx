"use client";

// #75 — Edición, ANTES de generar, de lo que verá el cliente en cada opción de una comparativa: el Incluye / No incluye y la descripción visible de sus
// líneas. Solo texto: no toca importes, cantidades ni referencias. La propuesta sale de los productos de la opción y el asesor la corrige; lo que se ve
// aquí es exactamente lo que se envía (`presentacionDesdeEdicion`) y el servidor lo vuelve a validar y lo congela en el snapshot de la opción.
import { RotateCcw } from "lucide-react";
import { MAX_DESCRIPCION_ITEM, MAX_TEXTO_INCLUYE, type PresentacionComparativa } from "@/lib/cotizacion/comparativa";

export type OpcionEditable = {
  clave: string;
  titulo: string;
  lineas: { indice: number; descripcion: string }[];
  incluyeSugerido: string;
  noIncluyeSugerido: string;
};
/** Solo lo que el asesor cambió; lo demás se muestra (y se envía) con la propuesta. */
export type EdicionPresentacion = Record<string, { incluye?: string; noIncluye?: string; textos?: Record<number, string> }>;

/** Lo que se envía al servidor: el texto VISIBLE de cada campo (editado o propuesto). Las líneas sin cambio no viajan. */
export function presentacionDesdeEdicion(opciones: readonly OpcionEditable[], ed: EdicionPresentacion): PresentacionComparativa {
  const out: PresentacionComparativa = {};
  for (const o of opciones) {
    const e = ed[o.clave] ?? {};
    out[o.clave] = {
      incluye: e.incluye ?? o.incluyeSugerido,
      noIncluye: e.noIncluye ?? o.noIncluyeSugerido,
      descripciones: o.lineas.flatMap((l) => {
        const t = e.textos?.[l.indice];
        return t !== undefined && t.trim() !== l.descripcion ? [{ indice: l.indice, original: l.descripcion, texto: t }] : [];
      }),
    };
  }
  return out;
}

/** Error que el asesor debe corregir antes de generar (mismos límites que el servidor), o null. */
export function errorEdicion(opciones: readonly OpcionEditable[], ed: EdicionPresentacion): string | null {
  for (const o of opciones) {
    const e = ed[o.clave] ?? {};
    for (const l of o.lineas) {
      const t = (e.textos?.[l.indice] ?? l.descripcion).replace(/\s+/g, " ").trim();
      if (t.length < 3 || t.length > MAX_DESCRIPCION_ITEM) return `${o.titulo}: cada descripción debe tener entre 3 y ${MAX_DESCRIPCION_ITEM} caracteres.`;
    }
    if ((e.incluye ?? o.incluyeSugerido).length > MAX_TEXTO_INCLUYE || (e.noIncluye ?? o.noIncluyeSugerido).length > MAX_TEXTO_INCLUYE) {
      return `${o.titulo}: el Incluye / No incluye supera ${MAX_TEXTO_INCLUYE} caracteres.`;
    }
  }
  return null;
}

const area = "w-full rounded-lg border border-gray-300 p-2 text-sm";
const lbl = "text-xs font-medium text-gray-600";
const boton = "inline-flex items-center gap-1 text-[11px] font-medium hover:underline";

export function PresentacionComparativaEditor({ opciones, edicion, onChange }: {
  opciones: readonly OpcionEditable[]; edicion: EdicionPresentacion; onChange: (e: EdicionPresentacion) => void;
}) {
  const cambiar = (clave: string, parche: EdicionPresentacion[string]) => onChange({ ...edicion, [clave]: { ...(edicion[clave] ?? {}), ...parche } });
  return (
    <div className="space-y-4" data-testid="editor-presentacion">
      {opciones.map((o) => {
        const e = edicion[o.clave] ?? {};
        return (
          <fieldset key={o.clave} className="min-w-0 rounded-xl border border-gray-200 p-3 sm:p-4" data-testid={`editor-${o.clave}`}>
            <legend className="px-1 text-sm font-semibold text-gray-700">{o.titulo}</legend>
            {o.lineas.length > 0 && (
              <div className="mb-3 space-y-2">
                <label className={lbl} htmlFor={`item-${o.clave}-${o.lineas[0].indice}`}>Ítem del documento</label>
                {o.lineas.map((l) => (
                  <input key={l.indice} id={`item-${o.clave}-${l.indice}`} aria-label={`Ítem del documento (línea ${l.indice + 1}) de ${o.titulo}`} maxLength={MAX_DESCRIPCION_ITEM}
                    className={area} value={e.textos?.[l.indice] ?? l.descripcion}
                    onChange={(ev) => cambiar(o.clave, { textos: { ...(e.textos ?? {}), [l.indice]: ev.target.value } })} />
                ))}
                <p className="text-[11px] text-gray-400">Cambia solo la descripción del ítem: cantidades, tarifas y valores siguen siendo los liquidados.</p>
                <div className="rounded-lg bg-gray-50 p-2 text-xs text-gray-700" data-testid={`vista-previa-${o.clave}`}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Vista previa del documento</p>
                  {o.lineas.map((l) => (
                    <p key={l.indice}><span className="font-medium">Ítem:</span> {(e.textos?.[l.indice] ?? l.descripcion).replace(/s+/g, " ").trim()}</p>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="min-w-0">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className={lbl} htmlFor={`inc-${o.clave}`}>Incluye</label>
                  {e.incluye !== undefined && (
                    <button type="button" className={boton} style={{ color: "var(--brand-primary)" }} onClick={() => cambiar(o.clave, { incluye: undefined })}>
                      <RotateCcw size={11} aria-hidden /> Volver a la propuesta
                    </button>
                  )}
                </div>
                <textarea id={`inc-${o.clave}`} rows={5} maxLength={MAX_TEXTO_INCLUYE} className={area} placeholder="Una línea por ítem…"
                  value={e.incluye ?? o.incluyeSugerido} onChange={(ev) => cambiar(o.clave, { incluye: ev.target.value })} />
              </div>
              <div className="min-w-0">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className={lbl} htmlFor={`no-${o.clave}`}>No incluye</label>
                  {e.noIncluye !== undefined && (
                    <button type="button" className={boton} style={{ color: "var(--brand-primary)" }} onClick={() => cambiar(o.clave, { noIncluye: undefined })}>
                      <RotateCcw size={11} aria-hidden /> Volver a la propuesta
                    </button>
                  )}
                </div>
                <textarea id={`no-${o.clave}`} rows={5} maxLength={MAX_TEXTO_INCLUYE} className={area} placeholder="Una línea por ítem…"
                  value={e.noIncluye ?? o.noIncluyeSugerido} onChange={(ev) => cambiar(o.clave, { noIncluye: ev.target.value })} />
              </div>
            </div>
          </fieldset>
        );
      })}
      <p className="text-[11px] text-gray-400">Si todas las opciones quedan con el mismo Incluye / No incluye, el documento lo muestra una sola vez; si difieren, cada opción muestra el suyo.</p>
    </div>
  );
}
