// Validación de los argumentos `unknown` que llegan a las Server Actions de
// detalle bajo demanda (app/tarifario/detalle-actions.ts). Módulo PURO
// (sin "use server"/imports de Supabase) para poder testear con ejecución
// real, y porque un archivo "use server" de Next.js solo puede exportar
// funciones async — estos helpers son síncronos a propósito.
export type ModuloTarifario = "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";

export const MODULOS_HOTEL = new Set<ModuloTarifario>(["bloqueo", "porcion_terrestre"]);
export const MODULOS_SALIDA = new Set<ModuloTarifario>(["bloqueo", "dinamico"]);

/** Entero positivo (>0) — rechaza NaN/Infinity/decimales/negativos/0/strings/null/undefined/arrays/objetos. */
export function idPositivo(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v > 0 ? v : null;
}

export function moduloDe(v: unknown, permitidos: Set<ModuloTarifario>): ModuloTarifario | null {
  return typeof v === "string" && permitidos.has(v as ModuloTarifario) ? (v as ModuloTarifario) : null;
}

// Límite explícito para cualquier array de ids de alcance (bloqueoIds/
// salidaIds/paqueteIds) que llegue del cliente — el tarifario real nunca
// tiene más de unos pocos cientos de salidas activas a la vez; un array más
// grande que esto no puede ser un alcance legítimo (protege el `.in(...)` de
// la consulta contra un payload artificialmente inflado).
export const MAX_IDS_ALCANCE = 200;

/**
 * Array de enteros positivos, sin duplicados exigidos (se normaliza en el
 * caller si hace falta), acotado a `max` elementos. `null` si `v` no es un
 * array, excede el límite, o contiene algún elemento que no sea un entero
 * positivo válido — nunca se "limpia" silenciosamente un array parcialmente
 * inválido (todo o nada, mismo criterio que el resto de este módulo).
 */
export function idsPositivosLimitados(v: unknown, max: number = MAX_IDS_ALCANCE): number[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: number[] = [];
  for (const x of v) {
    const n = idPositivo(x);
    if (n == null) return null;
    out.push(n);
  }
  return out;
}

/**
 * `{hotelId, modulo, bloqueoIds}` validado — o `null` si la forma no es
 * válida.
 *
 * ⚠️ Alcance obligatorio para `modulo:"bloqueo"` (revisión posterior,
 * defecto "no preserva el alcance activo al abrir un hotel"): antes esta
 * función solo exigía `{modulo, hotelId}` — el detalle de un hotel volvía
 * TODAS sus salidas de bloqueo, sin importar si el usuario ya había
 * filtrado por origen/destino/una salida puntual en el buscador de
 * VistaBooking. Ahora el caller (VistaBooking.tsx) SIEMPRE debe declarar
 * qué `bloqueoIds` están actualmente visibles bajo ese filtro — la Server
 * Action nunca vuelve a consultar "todo el hotel" como si no hubiera
 * filtro activo. `bloqueoIds` puede ser un array vacío (el filtro activo no
 * deja ninguna salida visible para este hotel: el resultado correcto es
 * "sin opciones", no "todas las opciones"). `porcion_terrestre` no tiene
 * ningún filtro de alcance en la UI hoy, así que no exige el campo.
 */
export type EntradaDetalleHotel =
  | { modulo: "bloqueo"; hotelId: number; bloqueoIds: number[] }
  | { modulo: "porcion_terrestre"; hotelId: number };

export function validarEntradaDetalleHotel(inputRaw: unknown): EntradaDetalleHotel | null {
  if (typeof inputRaw !== "object" || inputRaw === null || Array.isArray(inputRaw)) return null;
  const o = inputRaw as Record<string, unknown>;
  const modulo = moduloDe(o.modulo, MODULOS_HOTEL);
  const hotelId = idPositivo(o.hotelId);
  if (!modulo || !hotelId) return null;
  if (modulo === "bloqueo") {
    const bloqueoIds = idsPositivosLimitados(o.bloqueoIds);
    if (bloqueoIds == null) return null;
    return { modulo: "bloqueo", hotelId, bloqueoIds };
  }
  return { modulo: "porcion_terrestre", hotelId };
}

export type EntradaDetalleSalida =
  | { modulo: "bloqueo"; bloqueoId: number }
  | { modulo: "dinamico"; salidaId: number };

export function validarEntradaDetalleSalida(inputRaw: unknown): EntradaDetalleSalida | null {
  if (typeof inputRaw !== "object" || inputRaw === null || Array.isArray(inputRaw)) return null;
  const o = inputRaw as Record<string, unknown>;
  const modulo = moduloDe(o.modulo, MODULOS_SALIDA);
  if (modulo === "bloqueo") {
    const bloqueoId = idPositivo(o.bloqueoId);
    return bloqueoId ? { modulo: "bloqueo", bloqueoId } : null;
  }
  if (modulo === "dinamico") {
    const salidaId = idPositivo(o.salidaId);
    return salidaId ? { modulo: "dinamico", salidaId } : null;
  }
  return null;
}

export function validarEntradaDetallePaquete(inputRaw: unknown): { paqueteId: number } | null {
  if (typeof inputRaw !== "object" || inputRaw === null || Array.isArray(inputRaw)) return null;
  const o = inputRaw as Record<string, unknown>;
  const paqueteId = idPositivo(o.paqueteId);
  return paqueteId ? { paqueteId } : null;
}
