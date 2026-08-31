// Caché + dedup, en memoria del navegador, para el detalle bajo demanda del
// tarifario (Tier 2 de la carga en dos niveles — ver app/tarifario/
// detalle-actions.ts). Vive a nivel de MÓDULO (no de componente): sobrevive
// mientras la pestaña siga abierta y se reinicia solo con una recarga
// completa de página — exactamente "durante esa visita", ni más ni menos.
//
// Dos garantías, ambas pedidas explícitamente:
//   · "Impedir solicitudes duplicadas mientras una misma combinación está
//     cargando" — si el usuario abre el mismo hotel dos veces seguidas (o
//     dos pestañas del tarifario piden el mismo detalle casi a la vez), la
//     SEGUNDA llamada reutiliza la promesa en vuelo de la primera en vez de
//     disparar una consulta nueva.
//   · "Poder reutilizar en memoria un detalle ya solicitado" — un detalle
//     que ya resolvió con éxito se sirve instantáneo la próxima vez, sin
//     volver a pedirlo al servidor.
//
// Un resultado con ERROR (`ok:false`) o una promesa que se RECHAZA nunca se
// cachea — un fallo transitorio no debe "pegarse" para el resto de la
// visita; cerrar y volver a abrir el mismo hotel reintenta la consulta.
import { claveComboAlcanceNormalizada, type ComboIdentidad } from "./comboKey.ts";

export type EstadoDetalle<T> =
  | { estado: "cargando" }
  | { estado: "ok"; filas: T[] }
  | { estado: "error"; mensaje: string };

type ResultadoAccion<T> = { ok: true; filas: T[] } | { ok: false; error: string };

const enVuelo = new Map<string, Promise<ResultadoAccion<unknown>>>();

/**
 * Clave de caché para "Ver opciones" de un hotel — incluye el ALCANCE DE
 * COMBOS activo (búsqueda/categoría/régimen/origen/destino/salida, ver
 * lib/tarifario/comboKey.ts), normalizado (orden estable, deduplicado), para
 * que cambiar CUALQUIER filtro NUNCA reutilice el detalle cacheado de un
 * alcance distinto (ronda 6, ítem 2 — generaliza la revisión anterior, que
 * solo incorporaba `bloqueoIds` y solo para el submódulo Bloqueo). Pura y
 * testeable con ejecución real.
 */
export function claveDetalleHotel(modulo: "bloqueo" | "porcion_terrestre", hotelId: number, combos: ComboIdentidad[]): string {
  return `hotel:${modulo}:${hotelId}:${claveComboAlcanceNormalizada(combos)}`;
}

/**
 * Clave de caché para Vista tabla → pestaña Salidas (bloqueo/dinámico) — un
 * id estructural (`bloqueoId`/`salidaId`) identifica QUÉ salida se abrió,
 * pero el alcance de `combos` (búsqueda/categoría/régimen activos) también
 * debe formar parte de la clave: la ronda anterior no incorporaba NINGÚN
 * filtro a esta clave (`salida:bloqueo:${id}` a secas), así que cambiar de
 * filtro y volver a abrir la MISMA salida servía el detalle SIN filtrar
 * desde caché.
 */
export function claveDetalleSalida(modulo: "bloqueo" | "dinamico", id: number, combos: ComboIdentidad[]): string {
  return `salida:${modulo}:${id}:${claveComboAlcanceNormalizada(combos)}`;
}

/** Clave de caché para Vista tabla → pestaña Porción terrestre — mismo criterio que `claveDetalleSalida`. */
export function claveDetallePaquete(paqueteId: number, combos: ComboIdentidad[]): string {
  return `paquete:${paqueteId}:${claveComboAlcanceNormalizada(combos)}`;
}

export function conCacheDetalle<T>(clave: string, cargar: () => Promise<ResultadoAccion<T>>): Promise<ResultadoAccion<T>> {
  const existente = enVuelo.get(clave);
  if (existente) return existente as Promise<ResultadoAccion<T>>;
  const p = cargar()
    .then((r) => {
      if (!r.ok) enVuelo.delete(clave);
      return r as ResultadoAccion<unknown>;
    })
    .catch((e) => {
      enVuelo.delete(clave);
      throw e;
    });
  enVuelo.set(clave, p);
  return p as Promise<ResultadoAccion<T>>;
}
