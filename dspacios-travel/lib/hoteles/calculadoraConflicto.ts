// #124 — Pure helpers to explain WHY a calculator save was rejected as stale, using only data the page already holds:
// the stored calculator the editor opened with (`base`) and the stored calculator now in the database (`nueva`).
// Nothing here talks to the network and nothing guesses an actor: it only compares two stored copies.
import { renombrarTemporadaEnParams } from "@/lib/calc/calculadoras";

export type CalcGuardada = { version: number | null; tipo: string; params: Record<string, unknown> };

export type CausaCambio =
  | { causa: "renombre"; de: string; a: string }
  | { causa: "tipo"; de: string; a: string }
  | { causa: "valores"; secciones: string[] }
  | { causa: "igual" };

/** Stable JSON (sorted keys): the database stores jsonb, which does not keep key order, so a raw string compare would lie. */
export function estable(v: unknown): string {
  const norm = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(norm)
      : x && typeof x === "object" ? Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, y]) => y !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, y]) => [k, norm(y)]))
        : x;
  return JSON.stringify(norm(v));
}
export const iguales = (a: unknown, b: unknown) => estable(a) === estable(b);

/** Season names a calculator refers to BY TEXT (no foreign key): bases, per-regimen bases and Dubai promotions. */
export function nombresTemporada(params: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const bases = (l: unknown) => { if (Array.isArray(l)) for (const b of l) { const t = (b as { temporada?: unknown } | null)?.temporada; if (typeof t === "string" && t) out.add(t); } };
  bases(params.bases);
  const porRegimen = params.bases_por_regimen;
  if (porRegimen && typeof porRegimen === "object") for (const l of Object.values(porRegimen as Record<string, unknown>)) bases(l);
  if (Array.isArray(params.promos)) for (const p of params.promos as { temporadaBase?: unknown; temporadaPromo?: unknown }[]) {
    for (const t of [p?.temporadaBase, p?.temporadaPromo]) if (typeof t === "string" && t) out.add(t);
  }
  return out;
}

/** Same cascade the server runs when a vigencia is renamed (`renombrarTemporadaEnParams`), on a COPY. */
export function aplicarRenombre(tipo: string, params: Record<string, unknown>, de: string, a: string): Record<string, unknown> {
  const copia = JSON.parse(JSON.stringify(params)) as Record<string, unknown>;
  renombrarTemporadaEnParams(tipo, copia, de, a);
  return copia;
}

const ETIQUETA_SECCION: Record<string, string> = {
  bases: "bases por categoría y temporada", bases_por_regimen: "valores por régimen", modificadores: "modificadores",
  suplementos: "suplementos de régimen", suplementos_regimen: "suplementos de régimen", promos: "promociones",
  acom: "modo/IVA por acomodación", nino: "niño", pax: "pasajeros por acomodación", iva_pct: "IVA", regimen: "régimen",
  regimen_base: "régimen base", persona_adicional: "persona adicional", nino_adicional: "niño adicional",
  impuesto_pct: "impuesto", descuento_pct: "descuento", infante_nota: "nota de infante",
};

/**
 * What changed between the copy the editor knew (`base`) and the copy that is stored now (`nueva`).
 * "renombre" is only reported when applying that exact rename to `base` reproduces `nueva` (evidence, not a guess).
 */
export function clasificarCambio(base: CalcGuardada | null, nueva: CalcGuardada): CausaCambio {
  if (!base) return { causa: "valores", secciones: [] };
  if (base.tipo !== nueva.tipo) return { causa: "tipo", de: base.tipo, a: nueva.tipo };
  if (iguales(base.params, nueva.params)) return { causa: "igual" };
  const antes = nombresTemporada(base.params), ahora = nombresTemporada(nueva.params);
  const quitados = [...antes].filter((n) => !ahora.has(n)), agregados = [...ahora].filter((n) => !antes.has(n));
  for (const de of quitados) for (const a of agregados) {
    if (iguales(aplicarRenombre(base.tipo, base.params, de, a), nueva.params)) return { causa: "renombre", de, a };
  }
  const claves = new Set([...Object.keys(base.params), ...Object.keys(nueva.params)]);
  const secciones = [...claves].filter((k) => !iguales(base.params[k], nueva.params[k])).map((k) => ETIQUETA_SECCION[k] ?? k);
  return { causa: "valores", secciones: [...new Set(secciones)] };
}

export type EscenarioAviso = {
  causa: CausaCambio;
  /** `clic` = the server rejected a save; `pantalla` = the page reloaded data and the editor noticed it was behind. */
  origen: "clic" | "pantalla";
  /** The user had unsaved edits in the form. */
  conCambiosLocales: boolean;
  /** Those edits were carried to the new stored copy (only possible for a confirmed rename). */
  conservados: boolean;
  versionAntes: number | null;
  versionAhora: number | null;
};

const comillas = (s: string) => `«${s}»`;
const versiones = (e: EscenarioAviso) => (e.versionAntes != null && e.versionAhora != null ? ` (versión ${e.versionAntes} → ${e.versionAhora})` : "");

/** Message for the editor banner. It never names a person: only audit records can prove an actor. */
export function textoAviso(e: EscenarioAviso): string {
  const c = e.causa;
  const queCambio =
    c.causa === "renombre" ? `La vigencia ${comillas(c.de)} se renombró a ${comillas(c.a)} y la calculadora guardada ya usa el nombre nuevo${versiones(e)}.`
      : c.causa === "tipo" ? `El tipo de la calculadora guardada cambió de ${c.de} a ${c.a}${versiones(e)}.`
        : c.causa === "valores" ? `La calculadora guardada en la base cambió después de que abriste esta pantalla${versiones(e)}${c.secciones.length ? `; cambió: ${c.secciones.join(", ")}` : ""}.`
          : `La calculadora guardada se actualizó${versiones(e)} pero su contenido es el mismo.`;
  const clic = e.origen === "clic" ? " Tu clic no guardó nada." : "";
  if (!e.conCambiosLocales) return `${queCambio}${clic} No tenías cambios sin guardar: cargamos la versión actual y no se sobrescribió nada. Repite la acción que querías.`;
  if (e.conservados) return `${queCambio}${clic} Conservamos tus cambios sin guardar y los pasamos al nombre nuevo. Todavía NO están guardados: revísalos y pulsa Guardar.`;
  return `${queCambio}${clic} No se guardó nada y tus cambios sin guardar siguen en pantalla (no se pueden guardar encima sin revisar). ` +
    "Puedes seguir editando o cargar la versión guardada; cargarla descarta lo que no hayas guardado. Recargar la página también lo descarta.";
}
