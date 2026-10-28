// ─────────────────────────────────────────────────────────────────────────
// Paquetes DINÁMICOS dentro de la pestaña "Paquetes" de Vista Booking.
//
// Decisión del dueño: para el cliente un Dinámico es un paquete más (no tiene que saber que es "dinámico"),
// pero con su PROPIA visual: no tiene cupos, tiene salidas con fecha fija, y se reserva por la ruta de
// siempre de Vista tabla (`/dashboard/reservar/nuevo?...&modulo=dinamico`), que genera la cotización.
//   · el destino por el que se filtra es el del PAQUETE (el del hotel): `destino_nombre` de la fila. El destino
//     del vuelo no interviene: da igual dónde aterrice, lo que importa es el hotel al que va la persona;
//   · los Recomendados funcionan igual que para los demás (prioridad del hotel en el paquete);
//   · el "desde" (tarjeta y cada salida) toma como referencia la acomodación DOBLE, no la habitación más barata;
//   · el ORIGEN es el real de cada salida (`salidas_dinamicas.origen`, o el primer tramo de su ruta — misma regla que
//     `bloqueos_vuelo`): con un origen elegido, la fila se ve solo si SU salida sale de ahí; sin origen conocido, nunca se inventa;
//   · TODOS lo ven y lo cotizan por el carrito público, con o sin sesión (mismo flujo que Bloqueo: carrito →
//     /tarifario/checkout → `crearSolicitudReserva`, con `salidaId`); quien puede reservar conserva además `reservar/nuevo`.
//
// Módulo PURO (sin I/O): lo usan VistaBooking/DinamicoModal y las pruebas.
// ─────────────────────────────────────────────────────────────────────────

import { claveOrigen } from "../iata.ts";

export type FilaDinamicaBase = {
  modulo?: string | null;
  paquete_id?: number | null;
  hotel_id?: number | null;
  salida_id?: number | null;
  destino_nombre?: string | null;
};

/**
 * Salida elegida en «Salida (vuelo)» de Paquetes: un record de Bloqueo (`bloqueo_id`) o una salida dinámica (`salida_id`). Lleva
 * el TIPO porque los dos ids son de tablas distintas y pueden coincidir en número; `null` = «Todas las salidas».
 */
export type SalidaElegida = { tipo: "bloqueo" | "dinamico"; id: number } | null;

/** Valor del `<option>`: `b:<bloqueo_id>` / `d:<salida_id>`; `""` = «Todas las salidas». */
export function valorSalidaElegida(s: SalidaElegida): string {
  return s ? `${s.tipo === "bloqueo" ? "b" : "d"}:${s.id}` : "";
}

/** Inversa de `valorSalidaElegida`. Cualquier valor que no sea `b:`/`d:` + entero positivo es «Todas» (`null`). */
export function leerSalidaElegida(v: string): SalidaElegida {
  const m = /^([bd]):([1-9]\d*)$/.exec(v);
  return m ? { tipo: m[1] === "b" ? "bloqueo" : "dinamico", id: Number(m[2]) } : null;
}

export type FiltrosPaquetesBooking = {
  origenSel: string;
  salidaSel: SalidaElegida;
  destinoSel: string;
  /** Origen REAL de cada salida dinámica (`salida_id` → IATA). Una salida sin entrada no tiene origen conocido. */
  origenPorSalida?: Readonly<Record<number, string>>;
};

export const esFilaDinamica = (f: { modulo?: string | null }): boolean => f.modulo === "dinamico";

/** Origen de una salida dinámica: su `origen` o, si falta, el primer tramo de su `ruta` (misma regla que `bloqueos_vuelo`); sin ninguno, `null`. */
export function origenSalidaDinamica(s: { origen?: string | null; ruta?: string | null }): string | null {
  const ori = (s.origen ?? "").trim() || (s.ruta ? s.ruta.split("-")[0].trim() : "");
  return ori ? ori.toUpperCase() : null;
}

const origenDeFila = (f: FilaDinamicaBase, origenPorSalida: Readonly<Record<number, string>> = {}): string | null =>
  f.salida_id != null ? (origenPorSalida[f.salida_id] ?? null) : null;
/** Clave canónica del origen de la fila (ver `claveOrigen`): lo que se compara con el origen elegido. */
const claveDeFila = (f: FilaDinamicaBase, origenPorSalida: Readonly<Record<number, string>> = {}): string | null =>
  claveOrigen(origenDeFila(f, origenPorSalida)) || null;

/**
 * ¿Una fila `dinamico` entra en la pestaña "Paquetes"? Para todos (la acción de cotizar es la que depende del acceso). Con un origen
 * elegido, solo si SU salida sale de ese origen (dato real; sin origen conocido no se muestra, nunca se le inventa). Con una salida
 * elegida, solo si es ESA salida dinámica (una de Bloqueo, aunque tenga el mismo número, no aplica). El destino es el del paquete.
 */
export function filaDinamicaVisibleEnPaquetes(f: FilaDinamicaBase, filtros: FiltrosPaquetesBooking): boolean {
  if (!esFilaDinamica(f)) return false;
  if (filtros.salidaSel && (filtros.salidaSel.tipo !== "dinamico" || f.salida_id !== filtros.salidaSel.id)) return false;
  if (filtros.origenSel && claveDeFila(f, filtros.origenPorSalida) !== filtros.origenSel) return false;
  if (filtros.destinoSel && (f.destino_nombre ?? "") !== filtros.destinoSel) return false;
  return true;
}

/** Destinos (del paquete) que aportan los Dinámicos al selector de destino de "Paquetes"; con un origen elegido, solo los de salidas desde ahí. */
export function destinosDinamicos(filas: readonly FilaDinamicaBase[], origenSel = "", origenPorSalida: Readonly<Record<number, string>> = {}): string[] {
  return [...new Set(filas
    .filter((f) => esFilaDinamica(f) && f.destino_nombre && (!origenSel || claveDeFila(f, origenPorSalida) === origenSel))
    .map((f) => f.destino_nombre as string))];
}

/** Orígenes reales de las salidas dinámicas, para el selector de origen de "Paquetes" (las salidas sin origen conocido no aportan). */
export function origenesDinamicos(filas: readonly FilaDinamicaBase[], origenPorSalida: Readonly<Record<number, string>>): string[] {
  return [...new Set(filas.filter(esFilaDinamica).map((f) => claveDeFila(f, origenPorSalida)).filter((o): o is string => !!o))];
}

/**
 * ¿Un hotel por UNIDAD (Bernalo) entra con la salida elegida? Sus `salidas` reales solo son records de Bloqueo o empaquetados, nunca
 * salidas dinámicas: con «Todas» entra (comportamiento habitual); con una salida dinámica, nunca; con un record de Bloqueo, solo si
 * lo tiene entre sus salidas.
 */
export function hotelUnidadVisibleConSalida(h: { salidas: readonly { tipo: string; id: number }[] }, salidaSel: SalidaElegida): boolean {
  if (!salidaSel) return true;
  if (salidaSel.tipo === "dinamico") return false;
  return h.salidas.some((s) => s.tipo === "bloqueo" && s.id === salidaSel.id);
}

export type OpcionSalidaDinamica = {
  id: number;
  /** Origen real de la salida (`origenPorSalida`); `null` si no se conoce — nunca inventado. */
  origen: string | null;
  /** Destino del PAQUETE (el del hotel), igual que el filtro de destino. */
  destino: string;
  fechaIda: string | null;
  fechaRegreso: string | null;
  noches: number | null;
};

/**
 * Opciones de salida dinámica para «Salida (vuelo)»: una por `salida_id` real de las filas, con el mismo origen/destino que
 * acotan Paquetes (origen real de la salida; destino del paquete). Ordenadas por fecha de ida (sin fecha, al final).
 */
export function salidasDinamicasSelector(
  filas: readonly (FilaDinamicaBase & { fecha_ida?: string | null; fecha_regreso?: string | null; noches?: number | null })[],
  filtros: { origenSel: string; destinoSel: string; origenPorSalida: Readonly<Record<number, string>> }
): OpcionSalidaDinamica[] {
  const porId = new Map<number, OpcionSalidaDinamica>();
  for (const f of filas) {
    if (!esFilaDinamica(f) || f.salida_id == null || porId.has(f.salida_id)) continue;
    const origen = origenDeFila(f, filtros.origenPorSalida);
    if (filtros.origenSel && claveOrigen(origen) !== filtros.origenSel) continue;
    if (filtros.destinoSel && (f.destino_nombre ?? "") !== filtros.destinoSel) continue;
    porId.set(f.salida_id, {
      id: f.salida_id, origen, destino: f.destino_nombre ?? "", fechaIda: f.fecha_ida ?? null, fechaRegreso: f.fecha_regreso ?? null, noches: f.noches ?? null,
    });
  }
  return [...porId.values()].sort((a, b) => (a.fechaIda ?? "9999-99-99").localeCompare(b.fechaIda ?? "9999-99-99") || a.id - b.id);
}

const fmtFechaCorta = (s: string | null) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y.slice(2)}`;
};

/** Texto de la opción: «BOG → CARTAGENA · 10/01/30–13/01/30 (3N)». Sin cupos ni datos de vuelo (no existen para un Dinámico). */
export function etiquetaSalidaDinamica(s: OpcionSalidaDinamica): string {
  const fechas = [fmtFechaCorta(s.fechaIda), fmtFechaCorta(s.fechaRegreso)].filter(Boolean).join("–");
  return `${s.origen ?? "Origen por confirmar"} → ${s.destino} · ${fechas}${s.noches ? ` (${s.noches}N)` : ""}`;
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

/**
 * "Desde" de una salida: el menor precio por persona en acomodación DOBLE entre sus categorías/alimentaciones (> 0). La referencia es
 * siempre la doble (decisión del dueño): una sencilla más barata, o cualquier otra acomodación, no cambia el "desde". Sin tarifa doble, `null`.
 */
export function desdeSalidaDinamica(s: SalidaDinamica): number | null {
  const v = s.combos.map((c) => c.precios.doble).filter((p): p is number => typeof p === "number" && p > 0);
  return v.length ? Math.min(...v) : null;
}

/** "Desde" de la tarjeta de un Dinámico (filas de RESUMEN): el menor `precio_doble` > 0 de todas sus salidas y combos; sin doble, `null` ("Consultar"). */
export function desdeDobleResumen(filas: readonly { precio_doble?: number | null }[]): number | null {
  const v = filas.map((f) => f.precio_doble).filter((p): p is number => typeof p === "number" && p > 0);
  return v.length ? Math.min(...v) : null;
}

export type AccesoCotizacionDinamica = "cotizar" | "carrito";

/**
 * Acción del modal: TODOS cotizan por el carrito público (/tarifario/checkout, con o sin sesión — no exige permiso). El permiso de
 * reservar solo agrega la ruta interna (`reservar/nuevo`, misma de Vista tabla).
 */
export function accesoCotizacionDinamica(a: { puedeReservar: boolean }): AccesoCotizacionDinamica {
  return a.puedeReservar ? "cotizar" : "carrito";
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
