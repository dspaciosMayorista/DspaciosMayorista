// O-1 — el diagnóstico de configuración de un hotel (campos de edades, ruta de Producto, instrucciones) es SOLO INTERNO.
// Funciones puras (sin I/O) para decidir quién lo ve y para sanear una respuesta de búsqueda antes de que salga del servidor.
// La lectura de la sesión vive en `detalleInterno.server.ts`; las acciones de servidor la usan una sola vez por búsqueda y solo cuando hay algo que ocultar.

import { canalDeRol } from "../cotizacion/comparativa.ts";

/**
 * Interno = la MISMA regla que ya usan las cotizaciones comparativas y la tarjeta pública (`canalDeRol`): rol interno con la cuenta ACTIVA. Anónimo, visitante,
 * agencia, freelance, cliente_final y un interno desactivado son externos. No se agrega una segunda lista de roles.
 */
export function tieneDetalleInterno(rol: string | null | undefined, activo: boolean | null | undefined): boolean {
  return canalDeRol(rol, activo) === "interno";
}

type RespuestaHoteles = {
  ok: true;
  diagnostico?: string;
  /** Marca interna del servidor: el `diagnostico` elegido describe un defecto de configuración (no capacidad, fechas ni Adults Only). Nunca sale hacia el navegador. */
  diagnosticoConfig?: boolean;
  enRevision?: unknown[];
};

/** ¿La respuesta trae algo que un externo no debe ver? (decide si vale la pena leer la sesión). */
export function traeDetalleInterno(r: { ok: boolean; diagnosticoConfig?: boolean; enRevision?: unknown[] }): boolean {
  return r.ok && (r.diagnosticoConfig === true || (r.enRevision?.length ?? 0) > 0);
}

/**
 * Sanea una respuesta de `buscarHoteles`: quita la marca interna siempre; para un externo además elimina la lista «en revisión» y un diagnóstico que describa
 * configuración. La regla de seguridad no cambia (el hotel sigue sin cotizarse con menores): solo cambia lo que se explica. Sin diagnóstico la interfaz usa su
 * texto normal de «sin disponibilidad».
 */
export function sanearBusquedaHoteles<T extends { ok: boolean }>(r: T, detalleInterno: boolean): T {
  if (!r.ok) return r;
  const { diagnosticoConfig, ...resto } = r as unknown as RespuestaHoteles & Record<string, unknown>;
  if (detalleInterno) return resto as unknown as T;
  const { enRevision: _enRevision, diagnostico, ...sinRevision } = resto;
  void _enRevision;
  return (diagnosticoConfig === true || diagnostico === undefined ? sinRevision : { ...sinRevision, diagnostico }) as unknown as T;
}
