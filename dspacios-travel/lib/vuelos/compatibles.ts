// Records destino COMPATIBLES para trasladar cupos o mover un pasajero
// (tareas 2 y 3). Función pura: la página la usa para ofrecer solo destinos
// válidos; la base vuelve a validarlo todo (`_validar_record_destino`, 194)
// aunque se llame la acción directamente.
//
// Compatible = mismo destino, mismo proveedor y vuelo que NO ha salido según
// el día de negocio de Bogotá (lib/fechaNegocio.ts): fecha_ida >= hoy. Un
// record de ayer no se ofrece; uno de hoy o de mañana sí. El instante se
// inyecta para poder probar con reloj fijo.
import { fechaNegocio } from "@/lib/fechaNegocio";

export type RecordVuelo = {
  id: number;
  record: string;
  fecha_ida: string | null;
  fecha_regreso: string | null;
  destino_id: number | null;
  proveedor_id: number | null;
  tarifa_neta: number | string | null;
};

export type DestinoCompatible = {
  id: number;
  record: string;
  fecha_ida: string | null;
  libres: number;
  tarifaDistinta: boolean;
  /** Misma fecha de ida y de regreso que el origen (D3-c, contratos del sistema). */
  mismasFechas: boolean;
};

/** ¿El vuelo no ha salido? (fecha de ida >= día de negocio de Bogotá). */
export function vueloNoSalido(fechaIda: string | null | undefined, instante: Date = new Date()): boolean {
  return !!fechaIda && fechaIda >= fechaNegocio(instante);
}

export function filtrarCompatibles<T extends RecordVuelo>(origen: RecordVuelo, otros: T[], instante: Date = new Date()): T[] {
  return otros.filter(
    (o) => o.id !== origen.id
      && origen.destino_id != null && o.destino_id === origen.destino_id
      && (o.proveedor_id ?? null) === (origen.proveedor_id ?? null)
      && vueloNoSalido(o.fecha_ida, instante)
  );
}

export function describirDestinos(origen: RecordVuelo, compatibles: RecordVuelo[], libresPorRecord: Map<number, number>): DestinoCompatible[] {
  return compatibles.map((o) => ({
    id: o.id, record: o.record, fecha_ida: o.fecha_ida,
    libres: libresPorRecord.get(o.id) ?? 0,
    tarifaDistinta: (o.tarifa_neta ?? null) !== (origen.tarifa_neta ?? null) && Number(o.tarifa_neta) !== Number(origen.tarifa_neta),
    mismasFechas: (o.fecha_ida ?? null) === (origen.fecha_ida ?? null) && (o.fecha_regreso ?? null) === (origen.fecha_regreso ?? null),
  }));
}
