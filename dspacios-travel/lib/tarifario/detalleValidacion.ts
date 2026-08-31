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

/** `{hotelId, modulo}` validado — o `null` si la forma no es válida. */
export function validarEntradaDetalleHotel(inputRaw: unknown): { modulo: "bloqueo" | "porcion_terrestre"; hotelId: number } | null {
  if (typeof inputRaw !== "object" || inputRaw === null || Array.isArray(inputRaw)) return null;
  const o = inputRaw as Record<string, unknown>;
  const modulo = moduloDe(o.modulo, MODULOS_HOTEL) as "bloqueo" | "porcion_terrestre" | null;
  const hotelId = idPositivo(o.hotelId);
  if (!modulo || !hotelId) return null;
  return { modulo, hotelId };
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
