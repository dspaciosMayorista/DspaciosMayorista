// Historial de movimientos de sillas (`movimientos_silla`) y cifras del
// inventario de un record. Funciones PURAS.
//
// Decisión aprobada: el inventario muestra DOS cifras distintas.
//  - Cupos activos: sillas que hoy pertenecen al record y cuentan como cupo
//    (todas menos `cambio` —fila legada que salió a otro record— y
//    `retirada`). Es la única cifra vendible.
//  - Movimientos históricos: filas de `movimientos_silla` que tocan el record
//    (como origen o destino). Son trazabilidad, NUNCA cupos.

export const ESTADOS_HISTORICOS: readonly string[] = ["cambio", "retirada"];

export function esSillaActiva(estado: string | null | undefined): boolean {
  return !!estado && !ESTADOS_HISTORICOS.includes(estado);
}

export type TipoMovimiento = "legado" | "traslado_cupo" | "mover_datos" | "mover_con_cupo" | "retiro_cupo";

export type MovimientoFila = {
  id: number;
  tipo?: string | null;
  operacion_id?: string | null;
  motivo: string | null;
  fecha_movimiento: string;
  registrado_por: string | null;
  bloqueo_origen_id: number | null;
  bloqueo_destino_id: number | null;
  numero_silla_origen?: number | null;
  numero_silla_destino?: number | null;
  numero_contrato?: string | null;
  contrato_manual?: string | null;
  cupos_origen_antes?: number | null;
  cupos_origen_despues?: number | null;
  cupos_destino_antes?: number | null;
  cupos_destino_despues?: number | null;
};

export type DetalleMovimiento = { id: number; sillaOrigen: number | null; sillaDestino: number | null; contrato: string | null };

/** Un renglón del historial: las filas de una misma operación se agrupan. */
export type EntradaHistorial = {
  clave: string;
  tipo: TipoMovimiento;
  fecha: string;
  registradoPor: string | null;
  motivo: string | null;
  origenId: number | null;
  destinoId: number | null;
  sillas: number;
  numerosOrigen: number[];
  numerosDestino: number[];
  contratos: string[];
  /** Una fila por silla de la operación: el detalle individual sobrevive a la agrupación. */
  detalle: DetalleMovimiento[];
  cuposOrigen: [number, number] | null;
  cuposDestino: [number, number] | null;
};

function tipoDe(t: string | null | undefined): TipoMovimiento {
  return t === "traslado_cupo" || t === "mover_datos" || t === "mover_con_cupo" || t === "retiro_cupo" ? t : "legado";
}

/** Agrupa por `operacion_id` (las filas legadas, sin operación, van solas). Conserva el orden recibido. */
export function agruparHistorial(filas: MovimientoFila[]): EntradaHistorial[] {
  const out: EntradaHistorial[] = [];
  const porOp = new Map<string, EntradaHistorial>();
  for (const f of filas) {
    const op = f.operacion_id ?? null;
    let e = op ? porOp.get(op) : undefined;
    if (!e) {
      e = {
        clave: op ?? `fila-${f.id}`,
        tipo: tipoDe(f.tipo),
        fecha: f.fecha_movimiento,
        registradoPor: f.registrado_por,
        motivo: f.motivo,
        origenId: f.bloqueo_origen_id,
        destinoId: f.bloqueo_destino_id,
        sillas: 0,
        numerosOrigen: [],
        numerosDestino: [],
        contratos: [],
        detalle: [],
        cuposOrigen: f.cupos_origen_antes != null && f.cupos_origen_despues != null ? [f.cupos_origen_antes, f.cupos_origen_despues] : null,
        cuposDestino: f.cupos_destino_antes != null && f.cupos_destino_despues != null ? [f.cupos_destino_antes, f.cupos_destino_despues] : null,
      };
      out.push(e);
      if (op) porOp.set(op, e);
    }
    e.sillas += 1;
    if (f.numero_silla_origen != null) e.numerosOrigen.push(f.numero_silla_origen);
    if (f.numero_silla_destino != null) e.numerosDestino.push(f.numero_silla_destino);
    const c = f.numero_contrato ?? f.contrato_manual ?? null;
    if (c && !e.contratos.includes(c)) e.contratos.push(c);
    e.detalle.push({ id: f.id, sillaOrigen: f.numero_silla_origen ?? null, sillaDestino: f.numero_silla_destino ?? null, contrato: c });
  }
  for (const e of out) {
    e.numerosOrigen.sort((a, b) => a - b);
    e.numerosDestino.sort((a, b) => a - b);
  }
  // Más reciente primero (la consulta ya lo pide; aquí se garantiza). Empates y fechas ilegibles conservan el orden recibido.
  const t = (e: EntradaHistorial) => { const n = Date.parse(e.fecha); return Number.isNaN(n) ? -Infinity : n; };
  return out.map((e, i) => ({ e, i })).sort((a, b) => (t(b.e) - t(a.e) || a.i - b.i)).map((x) => x.e);
}

/** Operación REAL guardada (`tipo`), nunca deducida del texto libre del motivo. Una fila anterior a la migración 194 no trae tipo: se dice así. */
export function tituloEntrada(e: EntradaHistorial): string {
  switch (e.tipo) {
    case "retiro_cupo": return "Retiro de cupo";
    case "traslado_cupo": return "Traslado de cupos libres";
    case "mover_con_cupo": return "Pasajero movido con su cupo";
    case "mover_datos": return "Pasajero movido a un cupo libre";
    default: return e.origenId != null && e.destinoId != null && e.origenId !== e.destinoId
      ? "Cambio entre records (registro anterior)"
      : "Movimiento anterior (tipo no guardado)";
  }
}

/** Texto del renglón, visto desde el record `bloqueoId`. */
export function describirEntrada(e: EntradaHistorial, bloqueoId: number, recordDe: (id: number | null) => string): string {
  const entra = e.destinoId === bloqueoId;
  const otro = recordDe(entra ? e.origenId : e.destinoId);
  const n = e.sillas;
  const contrato = e.contratos.length ? ` · contrato ${e.contratos.join(", ")}` : "";
  switch (e.tipo) {
    case "traslado_cupo":
      return entra
        ? `Entraron ${n} cupo(s) libre(s) desde ${otro}`
        : `Salieron ${n} cupo(s) libre(s) hacia ${otro}`;
    case "mover_con_cupo":
      return (entra
        ? `Entró pasajero con su cupo desde ${otro} (${n} silla(s))`
        : `Salió pasajero con su cupo hacia ${otro} (${n} silla(s))`) + contrato;
    case "mover_datos":
      return (entra
        ? `Llegó pasajero desde ${otro}, en un cupo libre de este record (${n})`
        : `Pasajero movido a ${otro}; su silla quedó libre aquí (${n})`) + contrato;
    case "retiro_cupo":
      return `Cupo retirado (${n})`;
    default:
      // Sin tipo guardado solo se afirma un cambio entre records si origen y destino constan y difieren.
      if (e.origenId == null || e.destinoId == null || e.origenId === e.destinoId) return "Movimiento anterior: no se guardó su tipo ni su destino";
      return `${entra ? "Entró desde" : "Salió hacia"} ${otro} (cambio ${recordDe(e.origenId)} → ${recordDe(e.destinoId)})`;
  }
}
