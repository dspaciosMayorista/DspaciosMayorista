// ─────────────────────────────────────────────────────────────────────────
// Paquetes DINÁMICOS dentro de la pestaña "Paquetes" de Vista Booking.
//
// Decisión del dueño: para el cliente un Dinámico es un paquete más (no tiene que saber que es "dinámico"),
// pero con su PROPIA visual: no tiene cupos, tiene salidas con fecha fija, y se reserva por la ruta de
// siempre de Vista tabla (`/dashboard/reservar/nuevo?...&modulo=dinamico`), que genera la cotización.
//   · el destino por el que se filtra es el del PAQUETE (el del hotel): `destino_nombre` de la fila. El destino
//     del vuelo no interviene: da igual dónde aterrice, lo que importa es el hotel al que va la persona;
//   · los Recomendados funcionan igual que para los demás (prioridad del hotel en el paquete);
//   · el carrito/checkout público no soporta salidas dinámicas, así que SOLO se ofrecen a quien puede reservar
//     (los mismos roles que ya ven "Vista tabla"); para el visitante público todo queda como estaba.
//
// Módulo PURO (sin I/O): lo usan VistaBooking/DinamicoModal y las pruebas.
// ─────────────────────────────────────────────────────────────────────────

export type FilaDinamicaBase = {
  modulo?: string | null;
  paquete_id?: number | null;
  hotel_id?: number | null;
  salida_id?: number | null;
  destino_nombre?: string | null;
};

export type FiltrosPaquetesBooking = {
  puedeReservar: boolean;
  origenSel: string;
  salidaSel: number | "";
  destinoSel: string;
};

export const esFilaDinamica = (f: { modulo?: string | null }): boolean => f.modulo === "dinamico";

/**
 * ¿Una fila `dinamico` entra en la pestaña "Paquetes"? Solo para quien puede reservar. El origen y la salida
 * (vuelo) del buscador son filtros de Bloqueo (cupos de un record): con alguno elegido, un Dinámico no tiene
 * qué comparar y no se muestra, nunca se le inventa un origen. El destino sí aplica y es el del paquete.
 */
export function filaDinamicaVisibleEnPaquetes(f: FilaDinamicaBase, filtros: FiltrosPaquetesBooking): boolean {
  if (!esFilaDinamica(f)) return false;
  if (!filtros.puedeReservar) return false;
  if (filtros.origenSel || filtros.salidaSel !== "") return false;
  if (filtros.destinoSel && (f.destino_nombre ?? "") !== filtros.destinoSel) return false;
  return true;
}

/** Destinos (del paquete) que aportan los Dinámicos al selector de destino de "Paquetes". */
export function destinosDinamicos(filas: readonly FilaDinamicaBase[], puedeReservar: boolean): string[] {
  if (!puedeReservar) return [];
  return [...new Set(filas.filter((f) => esFilaDinamica(f) && f.destino_nombre).map((f) => f.destino_nombre as string))];
}

/** Ids de salida distintos de las filas Dinámicas de una oferta (hotel + paquete), en orden estable. */
export function salidaIdsDinamicas(filas: readonly FilaDinamicaBase[]): number[] {
  return [...new Set(filas.filter((f) => esFilaDinamica(f) && f.salida_id != null).map((f) => f.salida_id as number))].sort((a, b) => a - b);
}

/** ¿La oferta (tarjeta) es de un Dinámico? Un paquete es de un solo tipo, así que basta mirar sus filas. */
export const esOfertaDinamica = (filas: readonly { modulo?: string | null }[]): boolean => filas.length > 0 && filas.every(esFilaDinamica);

export type FilaDetalleDinamica = FilaDinamicaBase & {
  categoria?: string | null;
  regimen?: string | null;
  acomodacion?: string | null;
  precio_pvp?: number | null;
  precio_pvp_menor2?: number | null;
  fecha_ida?: string | null;
  fecha_regreso?: string | null;
  noches?: number | null;
  moneda?: string | null;
};

export type ComboDinamico = {
  categoria: string;
  regimen: string;
  /** Precio por persona por acomodación (infante = precio del menor de 2 años si existe). */
  precios: Record<string, number>;
};

export type SalidaDinamica = {
  salidaId: number;
  fechaIda: string | null;
  fechaRegreso: string | null;
  noches: number | null;
  moneda: string;
  combos: ComboDinamico[];
};

const ORDEN_ACOM = ["sencilla", "doble", "triple", "multiple", "nino", "nino2", "infante"];
export const ACOMODACIONES_DINAMICO = ORDEN_ACOM;

/**
 * Agrupa las filas de detalle (una por acomodación) en salidas → combos categoría/alimentación → precios.
 * Orden: la salida más cercana primero (sin fecha, al final); combos por categoría y alimentación.
 */
export function agruparSalidasDinamicas(filas: readonly FilaDetalleDinamica[]): SalidaDinamica[] {
  const porSalida = new Map<number, SalidaDinamica & { _combos: Map<string, ComboDinamico> }>();
  for (const f of filas) {
    if (!esFilaDinamica(f) || f.salida_id == null) continue;
    let s = porSalida.get(f.salida_id);
    if (!s) {
      s = {
        salidaId: f.salida_id, fechaIda: f.fecha_ida ?? null, fechaRegreso: f.fecha_regreso ?? null, noches: f.noches ?? null,
        moneda: f.moneda ?? "COP", combos: [], _combos: new Map(),
      };
      porSalida.set(f.salida_id, s);
    }
    const categoria = f.categoria ?? "—";
    const regimen = f.regimen ?? "—";
    const clave = `${categoria}|||${regimen}`;
    let c = s._combos.get(clave);
    if (!c) { c = { categoria, regimen, precios: {} }; s._combos.set(clave, c); s.combos.push(c); }
    if (f.acomodacion && typeof f.precio_pvp === "number") {
      c.precios[f.acomodacion] = f.acomodacion === "infante" ? (f.precio_pvp_menor2 ?? f.precio_pvp) : f.precio_pvp;
    }
  }
  const salidas = [...porSalida.values()].map(({ _combos: _omit, ...s }) => {
    void _omit;
    return { ...s, combos: [...s.combos].sort((a, b) => a.categoria.localeCompare(b.categoria) || a.regimen.localeCompare(b.regimen)) };
  });
  return salidas.sort((a, b) => (a.fechaIda ?? "9999-99-99").localeCompare(b.fechaIda ?? "9999-99-99") || a.salidaId - b.salidaId);
}

/** Precio mínimo por persona de una salida (solo habitaciones adultas, > 0) — para mostrar "desde". */
export function desdeSalidaDinamica(s: SalidaDinamica): number | null {
  const v = s.combos.flatMap((c) => ["sencilla", "doble", "triple", "multiple"].map((a) => c.precios[a]).filter((p): p is number => typeof p === "number" && p > 0));
  return v.length ? Math.min(...v) : null;
}

/** Enlace de reserva/cotización: el MISMO de Vista tabla para una salida dinámica. */
export function reservarHrefDinamico(a: { paqueteId: number; hotelId: number; salidaId: number }): string {
  const p = new URLSearchParams();
  p.set("paquete", String(a.paqueteId));
  p.set("hotel", String(a.hotelId));
  p.set("salida", String(a.salidaId));
  p.set("modulo", "dinamico");
  return `/dashboard/reservar/nuevo?${p.toString()}`;
}
