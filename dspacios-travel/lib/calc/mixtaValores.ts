// Estado de valores de la calculadora Mixta POR RÉGIMEN (pendiente #26).
// El editor guarda lo tecleado como texto con clave `categoria|temporada|campo`
// y por régimen; estas funciones puras hacen la ida y vuelta con `MixtaParams`
// para que alternar de régimen, guardar y recargar no pierda valores.

import type { MixtaBase, MixtaParams } from "./calculadoras.ts";

export const CAMPOS_MIXTA = ["sencilla", "doble", "triple", "multiple", "nino", "nino2", "infante"] as const;
export type CampoMixta = (typeof CAMPOS_MIXTA)[number];

/** Valores tecleados de UN régimen: `categoria|temporada|campo` → texto. */
export type ValoresMixta = Record<string, string>;
export type ValoresPorRegimen = Record<string, ValoresMixta>;

export const claveMixta = (categoria: string, temporada: string, campo: CampoMixta) => `${categoria}|${temporada}|${campo}`;

function valoresDeBases(bases: MixtaBase[] | undefined): ValoresMixta {
  const out: ValoresMixta = {};
  for (const b of bases ?? []) {
    for (const campo of CAMPOS_MIXTA) {
      const v = b[campo];
      // Un 0 de "sencilla..nino" es el relleno de celdas vacías; nino2/infante
      // guardan null cuando no se tecleó nada y 0 cuando es gratis a propósito.
      if (v == null) continue;
      if (Number(v) === 0 && campo !== "nino2" && campo !== "infante") continue;
      out[claveMixta(b.categoria, b.temporada, campo)] = String(v);
    }
  }
  return out;
}

/** Valores iniciales por régimen a partir de lo guardado. Configuraciones
 * anteriores solo traen `bases` del régimen que se guardó. */
export function valoresPorRegimenIniciales(inicial: MixtaParams | null): ValoresPorRegimen {
  if (!inicial) return {};
  const out: ValoresPorRegimen = {};
  for (const [regimen, bases] of Object.entries(inicial.bases_por_regimen ?? {})) {
    out[regimen] = valoresDeBases(bases);
  }
  // `bases` es la fuente del régimen activo guardado (manda sobre el mapa).
  if (inicial.regimen) out[inicial.regimen] = valoresDeBases(inicial.bases);
  return out;
}

function numero(vals: ValoresMixta, c: string, t: string, campo: CampoMixta): number {
  return Number(vals[claveMixta(c, t, campo)]) || 0;
}
function numeroONulo(vals: ValoresMixta, c: string, t: string, campo: CampoMixta): number | null {
  const v = vals[claveMixta(c, t, campo)];
  return v != null && v !== "" ? Number(v) : null;
}

function base(vals: ValoresMixta, c: string, t: string): MixtaBase {
  return {
    categoria: c, temporada: t,
    sencilla: numero(vals, c, t, "sencilla"), doble: numero(vals, c, t, "doble"),
    triple: numero(vals, c, t, "triple"), multiple: numero(vals, c, t, "multiple"),
    nino: numero(vals, c, t, "nino"),
    nino2: numeroONulo(vals, c, t, "nino2"),
    infante: numeroONulo(vals, c, t, "infante"),
  };
}

/** Todas las combinaciones categoría × temporada del régimen activo (forma
 * histórica de `MixtaParams.bases`). */
export function basesDesdeValores(vals: ValoresMixta, categorias: string[], temporadas: string[]): MixtaBase[] {
  return categorias.flatMap((c) => temporadas.map((t) => base(vals, c, t)));
}

/** Solo las combinaciones con algún valor tecleado, de cada régimen — lo que
 * se guarda en `bases_por_regimen`. Conserva también categorías/temporadas que
 * ya no están en pantalla, para no perderlas al guardar. */
export function basesPorRegimen(valores: ValoresPorRegimen): Record<string, MixtaBase[]> {
  const out: Record<string, MixtaBase[]> = {};
  for (const [regimen, vals] of Object.entries(valores)) {
    const combos = new Map<string, [string, string]>();
    for (const [clave, texto] of Object.entries(vals)) {
      if (texto == null || texto === "") continue;
      const i = clave.lastIndexOf("|");
      const j = clave.lastIndexOf("|", i - 1);
      if (i < 0 || j < 0) continue;
      const c = clave.slice(0, j);
      const t = clave.slice(j + 1, i);
      combos.set(`${c}|${t}`, [c, t]);
    }
    const bases = [...combos.values()].map(([c, t]) => base(vals, c, t));
    if (bases.length > 0) out[regimen] = bases;
  }
  return out;
}

/** Quita los valores tecleados de UNA categoría en UNA temporada (p. ej. la
 * promoción que se va a sustituir por su valor calculado). No toca otras
 * categorías ni temporadas. */
export function quitarValoresCelda(vals: ValoresMixta, categoria: string, temporada: string): ValoresMixta {
  const out: ValoresMixta = {};
  const prefijo = `${categoria}|${temporada}|`;
  for (const [clave, v] of Object.entries(vals)) {
    if (clave.startsWith(prefijo) && (CAMPOS_MIXTA as readonly string[]).includes(clave.slice(prefijo.length))) continue;
    out[clave] = v;
  }
  return out;
}
