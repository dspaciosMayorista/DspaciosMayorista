// #43/#60 incremento 2 — Armado ÚNICO del mapa de netos que consume el motor por noche
// (`netoPorTemporada`). Antes cada cargador lo armaba a mano con el mismo bucle; ahora todos
// pasan por aquí. Puro, sin lecturas.
//
// Conserva EXACTAMENTE el comportamiento previo para el dato actual: la clave es el nombre de
// la vigencia y, si hay filas duplicadas (legado), gana la ÚLTIMA en el orden recibido.
// Una fila con grupo de días usa la clave nombre + grupo (`claveNeto`), así nunca pisa a la
// fila «todos los días» ni a la de otro grupo.
import { claveNeto } from "./gruposDias.ts";

type FilaTarifa = { temporada?: unknown; grupo_id?: unknown };

/** Clave de la fila dentro de su combinación categoría/régimen. */
export function claveFilaTarifa(fila: FilaTarifa): string {
  const temporada = typeof fila.temporada === "string" ? fila.temporada : "";
  const grupo = typeof fila.grupo_id === "string" ? fila.grupo_id : null;
  return claveNeto(temporada, grupo);
}

/** Agrupa filas por clave; con claves repetidas gana la última (comportamiento previo). */
export function filasPorClave<T extends FilaTarifa>(filas: Iterable<T>): Map<string, T> {
  const m = new Map<string, T>();
  for (const f of filas) m.set(claveFilaTarifa(f), f);
  return m;
}

/** Neto de una acomodación (columna) por clave; `null` si la fila no trae ese neto. */
export function netosDeColumna<T extends Record<string, unknown>>(
  porClave: Map<string, T>,
  columna: string,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [clave, fila] of porClave) {
    const v = fila[columna];
    out[clave] = v == null ? null : Number(v);
  }
  return out;
}

/** Claves cuya fila es PRECIO FINAL AUTORITATIVO (migración 179). */
export function clavesPrecioFinal<T extends { precio_final_autoritativo?: unknown }>(porClave: Map<string, T>): Set<string> {
  const s = new Set<string>();
  for (const [clave, fila] of porClave) if (fila.precio_final_autoritativo === true) s.add(clave);
  return s;
}
