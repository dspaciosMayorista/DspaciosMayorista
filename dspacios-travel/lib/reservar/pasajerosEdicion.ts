// ─────────────────────────────────────────────────────────────────────────
// Puente puro entre las filas de `contrato_pasajeros` ya persistidas (con
// `responsable_id` real, un id de OTRA fila del mismo contrato — migración
// 167) y el estado editable del formulario `EditarAsesorPasajeros.tsx`
// (`responsableIndex`, una POSICIÓN dentro del arreglo que se ve en
// pantalla — el id real de una fila nueva/sin guardar aún no existe).
//
// Bug que esto corrige (retomado en la revisión de alto riesgo del PR): el
// estado inicial del formulario nunca leía `responsable_id` en absoluto —
// cualquier guardado, incluso uno que no tocara pasajeros, terminaba
// borrando en silencio el vínculo ya persistido, porque el formulario
// jamás lo cargó para empezar.
// ─────────────────────────────────────────────────────────────────────────
import type { PasajeroEdit } from "@/app/(dashboard)/dashboard/contratos/[numero]/editar-contrato-actions";

export type PasajeroRowConResponsable = {
  id: number;
  nombre: string;
  tipo_id: string | null;
  identificacion: string | null;
  fecha_nacimiento: string | null;
  es_infante: boolean;
  responsable_id?: number | null;
};

/**
 * Filas ya persistidas → estado editable inicial del formulario.
 * `responsable_id` (id real de otra fila) se traduce a `responsableIndex`
 * (posición de esa fila en ESTE mismo arreglo — el mismo orden con el que
 * se cargó, que es `order by orden` desde el servidor).
 */
export function filasIniciales(pasajeros: PasajeroRowConResponsable[]): PasajeroEdit[] {
  const idAIndice = new Map(pasajeros.map((p, i) => [p.id, i]));
  return pasajeros.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    tipoId: p.tipo_id ?? "CC",
    identificacion: p.identificacion ?? "",
    fechaNacimiento: p.fecha_nacimiento ?? "",
    esInfante: p.es_infante,
    responsableIndex: p.responsable_id != null ? (idAIndice.get(p.responsable_id) ?? null) : null,
  }));
}

/**
 * Estado del formulario → payload jsonb del RPC `guardar_pasajeros_contrato`.
 * `responsableIndex` (posición 0-based en este arreglo) se traduce a
 * `responsableOrden` (posición 1-based dentro del payload — la única forma
 * de referenciar, dentro del propio guardado, un pasajero que todavía no
 * tiene id real porque es nuevo).
 */
export function payloadGuardarPasajeros(filas: PasajeroEdit[]): {
  id?: number;
  nombre: string;
  tipoId: string;
  identificacion: string;
  fechaNacimiento: string;
  responsableOrden?: number;
}[] {
  return filas.map((f) => ({
    ...(f.id != null ? { id: f.id } : {}),
    nombre: f.nombre.trim(),
    tipoId: f.tipoId || "CC",
    identificacion: f.identificacion.trim(),
    fechaNacimiento: f.fechaNacimiento,
    ...(f.responsableIndex != null ? { responsableOrden: f.responsableIndex + 1 } : {}),
  }));
}
