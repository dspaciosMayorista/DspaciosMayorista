// ─────────────────────────────────────────────────────────────────────────
// Filtro por tipo + orden alfabético del listado de Paquetes (PR B).
//
// Módulo PURO a propósito (sin "use client"/"use server", sin imports de
// Supabase/next): puede importarse directo desde `node --test` (mismo
// patrón que ./frontera-tramos.ts) y desde el componente cliente del
// listado. No depende de nada del runtime del navegador ni del servidor.
//
// El discriminante REAL es `armado_paquetes.tipo` (enum Postgres
// `tarifario_modulo`, migración 20260601000018_armado_paquetes.sql, con el
// 4º valor agregado en 20260601000094_paquete_dinamico_salidas.sql) — el
// mismo campo que ya usa `ConfigForm.tsx` al crear/editar un paquete. Tiene
// CUATRO valores reales, no tres: 'bloqueo' | 'porcion_terrestre' |
// 'servicios' | 'dinamico'. Las etiquetas PAQUETES/PORCIÓN TERRESTRE/
// RECEPTIVOS cubren los primeros tres; 'dinamico' (paquetes con vuelo+hotel
// tomados por sistema, sin record negociado) tiene su propia 4ª pestaña
// para no perder esos paquetes del listado.
// ─────────────────────────────────────────────────────────────────────────

export type TipoPaquete = "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";

export const TIPOS_PAQUETE_VALIDOS: readonly TipoPaquete[] = [
  "bloqueo",
  "porcion_terrestre",
  "servicios",
  "dinamico",
] as const;

export function esTipoPaqueteValido(v: unknown): v is TipoPaquete {
  return typeof v === "string" && (TIPOS_PAQUETE_VALIDOS as readonly string[]).includes(v);
}

export type TabTipoPaquete = { key: TipoPaquete; label: string };

// Etiquetas EXACTAS pedidas para las tres primeras; "DINÁMICOS" es la única
// no especificada explícitamente por el negocio, agregada para no dejar
// paquetes tipo 'dinamico' fuera del listado (ver cabecera del archivo).
export const TABS_TIPO_PAQUETE: readonly TabTipoPaquete[] = [
  { key: "bloqueo", label: "PAQUETES" },
  { key: "porcion_terrestre", label: "PORCIÓN TERRESTRE" },
  { key: "servicios", label: "RECEPTIVOS" },
  { key: "dinamico", label: "DINÁMICOS" },
] as const;

export const TAB_TIPO_PAQUETE_DEFECTO: TipoPaquete = TABS_TIPO_PAQUETE[0].key;

export interface PaqueteListable {
  id: number;
  nombre: string;
  tipo: TipoPaquete;
}

// Collator compartido (crear uno por llamada sería trabajo repetido
// innecesario) — "es" + sensitivity "base" ignora may/min y tildes,
// exactamente el criterio pedido para el orden en español.
const collator = new Intl.Collator("es", { sensitivity: "base" });

// Filtra por el tipo real y ordena por el nombre visible, ignorando
// mayúsculas/tildes (Intl.Collator "es"/"base"). Determinista cuando dos
// nombres son equivalentes bajo ese criterio: primero por el texto exacto
// (comparación binaria, sin normalizar), y si de verdad son idénticos, por
// `id` — así el orden no depende del orden de iteración del arreglo de
// entrada ni de que el motor de JS tenga un sort estable.
// NO muta `paquetes`: `.filter()` ya produce un arreglo nuevo, y es sobre
// ESE arreglo nuevo que `.sort()` actúa.
export function filtrarYOrdenarPaquetes<T extends PaqueteListable>(
  paquetes: readonly T[],
  tipo: TipoPaquete
): T[] {
  return paquetes
    .filter((p) => p.tipo === tipo)
    .sort((a, b) => {
      const cmp = collator.compare(a.nombre, b.nombre);
      if (cmp !== 0) return cmp;
      if (a.nombre !== b.nombre) return a.nombre < b.nombre ? -1 : 1;
      return a.id - b.id;
    });
}
