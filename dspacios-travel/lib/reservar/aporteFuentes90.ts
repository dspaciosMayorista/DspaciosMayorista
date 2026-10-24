// ─────────────────────────────────────────────────────────────────────────
// #90 Entrega D — qué fuentes REALMENTE aportan al precio de un tarifario.
//
// Módulo PURO (sin I/O). `generarTarifario` descarta vínculos antes de liquidar: vuelos de Bloqueo sin fechas o con destino aéreo no
// permitido; vuelos de Empaquetados inactivos, sin fechas, fuera de su vigencia de compra o con destino no permitido; salidas dinámicas
// no vigentes (#62), sin fechas o sin noches, y salidas vinculadas (#63) cuya fuente ya no es elegible, cuyo destino no está permitido o
// cuya copia quedó vieja. Una fuente descartada NO aporta al precio, así que su moneda no puede exigir TRM ni bloquear la publicación.
//
// El generador, el panel del armado y la cotización de la oferta usan ESTAS funciones (los predicados y `fuentesQueAportan90`), de modo que
// dan el mismo veredicto sobre las mismas filas. Su espejo en SQL es `public.p63_requiere_trm` (migración 233).
// ─────────────────────────────────────────────────────────────────────────

import { noches } from "../calc/paquetes.ts";
import { empaquetadoVigente } from "./origen.ts";
import { seleccionarSalidasVigentes } from "./salidaDinamicaVigente.ts";
import { evaluarFuenteVinculada63, fuenteCoincideConSalida63, mensajeFuenteCambio63, type FuenteEmpaquetado63 } from "./ofertaDinamica63.ts";
import type { FuenteMoneda90 } from "./monedaPublicacion90.ts";

export type TipoOrigenAereo = "bloqueo" | "empaquetado";
/** ¿El destino de llegada de la fuente está entre los destinos aéreos permitidos HOY? (#67/220). Sin restricción: siempre true. */
export type PermiteDestino = (tipo: TipoOrigenAereo, id: number) => boolean;

export type BloqueoVinculado90 = {
  id: number;
  record?: string | null;
  ruta?: string | null;
  fecha_ida?: string | null;
  fecha_regreso?: string | null;
  moneda?: string | null;
};
export type EmpaquetadoVinculado90 = {
  id: number;
  ruta?: string | null;
  fecha_ida?: string | null;
  fecha_regreso?: string | null;
  moneda?: string | null;
  activo?: boolean | null;
  compra_inicio?: string | null;
  compra_fin?: string | null;
};
export type SalidaFila90 = {
  id: number;
  activo?: boolean | null;
  compra_inicio?: string | null;
  compra_fin?: string | null;
  fecha_ida?: string | null;
  fecha_regreso?: string | null;
  ruta?: string | null;
  aerolinea?: string | null;
  moneda?: string | null;
  valor_tiquete?: number | string | null;
  fee_infante?: number | string | null;
  empaquetado_id?: number | null;
};
export type HotelFila90 = { id: number; nombre?: string | null; moneda?: string | null; modelo_tarifario?: string | null };
export type ServicioFila90 = { id: number; nombre?: string | null; moneda?: string | null };

/** Un vuelo de Bloqueo aporta si tiene ambas fechas y su destino aéreo está permitido. */
export function bloqueoAporta(b: Pick<BloqueoVinculado90, "id" | "fecha_ida" | "fecha_regreso"> | null | undefined, permite: PermiteDestino): b is BloqueoVinculado90 {
  return !!b && !!b.fecha_ida && !!b.fecha_regreso && permite("bloqueo", b.id);
}

/** Un vuelo de Empaquetados aporta si está activo, tiene fechas, está en su vigencia de compra y su destino está permitido. */
export function empaquetadoVueloAporta(e: EmpaquetadoVinculado90 | null | undefined, hoy: string, permite: PermiteDestino): e is EmpaquetadoVinculado90 {
  return !!e && !!e.activo && !!e.fecha_ida && !!e.fecha_regreso
    && empaquetadoVigente(e.compra_inicio ?? null, e.compra_fin ?? null, hoy)
    && permite("empaquetado", e.id);
}

/**
 * Motivo por el que una salida VINCULADA no se publica (texto idéntico al que reporta el generador), o null si aporta. `fuente` = fila VIVA
 * del Empaquetado (null si ya no existe).
 */
export function motivoDescarteVinculada(sal: SalidaFila90, fuente: FuenteEmpaquetado63 | null | undefined, hoy: string, permite: PermiteDestino): string | null {
  const elegible = evaluarFuenteVinculada63(fuente, hoy);
  if (!elegible.ok) return elegible.error;
  if (!permite("empaquetado", Number(sal.empaquetado_id))) return "su destino aéreo no está permitido para este paquete.";
  const coincide = fuenteCoincideConSalida63(sal, fuente as FuenteEmpaquetado63);
  if (!coincide.ok) return mensajeFuenteCambio63(coincide.campos);
  return null;
}

/**
 * Salidas dinámicas que el generador liquidaría: vigentes (#62), con ida y regreso y al menos una noche; una vinculada además debe pasar
 * `motivoDescarteVinculada`. Devuelve la fila, su motivo de descarte (para el aviso) y si aporta.
 */
export function evaluarSalidas90(
  salidas: readonly SalidaFila90[],
  fuentes: ReadonlyMap<number, FuenteEmpaquetado63>,
  hoy: string,
  permite: PermiteDestino
): { sal: SalidaFila90; aporta: boolean; motivo: string | null }[] {
  const { vigentes } = seleccionarSalidasVigentes([...salidas] as never, hoy) as unknown as { vigentes: SalidaFila90[] };
  const ids = new Set(vigentes.map((s) => s.id));
  return salidas.map((sal) => {
    if (!ids.has(sal.id)) return { sal, aporta: false, motivo: "no vigente" };
    if (!sal.fecha_ida || !sal.fecha_regreso || noches(sal.fecha_ida, sal.fecha_regreso) <= 0) return { sal, aporta: false, motivo: "sin fechas o sin noches" };
    if (sal.empaquetado_id == null) return { sal, aporta: true, motivo: null };
    const motivo = motivoDescarteVinculada(sal, fuentes.get(Number(sal.empaquetado_id)) ?? null, hoy, permite);
    return { sal, aporta: motivo === null, motivo };
  });
}

export type EntradaAporte90 = {
  tipo: string;
  modo63: boolean;
  hoy: string;
  hoteles: readonly HotelFila90[];
  servicios: readonly ServicioFila90[];
  bloqueos: readonly (BloqueoVinculado90 | null)[];
  empaquetados: readonly (EmpaquetadoVinculado90 | null)[];
  salidas: readonly SalidaFila90[];
  fuentesVinculadas: ReadonlyMap<number, FuenteEmpaquetado63>;
  permite: PermiteDestino;
};

/**
 * Fuentes con su moneda real que SÍ aportan al precio. Hoteles (los de modelo por unidad no entran al tarifario clásico) y servicios
 * aportan siempre; vuelos y salidas, solo si pasan los mismos predicados que usa el generador. Solo el tipo Dinámico tiene salidas.
 */
export function fuentesQueAportan90(e: EntradaAporte90): FuenteMoneda90[] {
  const fuentes: FuenteMoneda90[] = [];
  for (const h of e.hoteles) {
    if (h.modelo_tarifario === "unidad") continue;
    fuentes.push({ tipo: "hotel", nombre: h.nombre ?? `#${h.id}`, moneda: h.moneda ?? null });
  }
  for (const s of e.servicios) fuentes.push({ tipo: "servicio", nombre: s.nombre ?? `#${s.id}`, moneda: s.moneda ?? null });
  for (const b of e.bloqueos) {
    if (!bloqueoAporta(b, e.permite)) continue;
    fuentes.push({ tipo: "vuelo", nombre: b.record || b.ruta || `#${b.id}`, moneda: b.moneda ?? null });
  }
  for (const v of e.empaquetados) {
    if (!empaquetadoVueloAporta(v, e.hoy, e.permite)) continue;
    fuentes.push({ tipo: "vuelo", nombre: v.ruta || `#${v.id}`, moneda: v.moneda ?? null });
  }
  if (e.tipo === "dinamico") {
    for (const { sal, aporta } of evaluarSalidas90(e.salidas, e.fuentesVinculadas, e.hoy, e.permite)) {
      if (!aporta) continue;
      const etiqueta = [sal.ruta, sal.fecha_ida].filter(Boolean).join(" ") || `#${sal.id}`;
      // Una salida vinculada toma la moneda REAL de su vuelo de Empaquetados; una manual, la suya (solo cuenta en el modo 63).
      const moneda = sal.empaquetado_id != null ? (e.fuentesVinculadas.get(Number(sal.empaquetado_id))?.moneda ?? null) : (sal.moneda ?? null);
      fuentes.push({ tipo: "salida", nombre: etiqueta, moneda });
    }
  }
  return fuentes;
}
