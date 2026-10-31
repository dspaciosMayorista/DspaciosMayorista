// ─────────────────────────────────────────────────────────────────────────
// Servicios adicionales como SUBELECCIÓN de la tarjeta de un hotel.
//
// El usuario marca/desmarca servicios del paquete en su modal; nada entra al
// carrito hasta que pulsa el botón del hotel, y entonces viajan JUNTOS
// (`addConjunto`, lib/cart/vinculoServicios.ts). Este módulo decide, sin
// React ni Supabase, si esa combinación se puede mostrar y agregar:
//   · Mandan los datos del HOTEL (paquete, fechas, pax, precio, categoría/
//     régimen…): la cotización de servicios queda atada a una "clave" de esos
//     datos. Si cualquiera cambia, la cotización anterior deja de valer y hay
//     que volver a cotizar antes de mostrar un total o permitir agregar.
//   · El precio sale SIEMPRE de `buscarReceptivos` para el paquete y el
//     servicio exactos — nunca del "desde" de la vitrina, nunca de un
//     servicio homónimo de otro paquete del mismo destino.
//   · Un servicio sin precio válido (o en otra moneda) bloquea el conjunto y
//     se nombra; sin servicios seleccionados el hotel se agrega normal.
//   · La tarifa del hotel no se toca: el total es una suma de presentación.
// ─────────────────────────────────────────────────────────────────────────
import type { ResultadoServicio } from "@/lib/reservar/liquidacionServicio";

export type RecorridoServicios = { modulo: "bloqueo"; bloqueoId: number } | { modulo: "dinamico"; salidaId: number };

/** Datos del hotel TAL COMO ESTÁN elegidos en la tarjeta/modal. */
export type HotelParaServicios = {
  paqueteId: number | null;
  hotelNombre: string;
  fechaIda: string | null;
  fechaRegreso: string | null;
  pax: number | null;
  /** Precio del hotel que se va a agregar (presentación). `null` = aún sin precio. */
  precio: number | null;
  moneda: string | null;
  /** Recorrido del vuelo del hotel (solo bloqueo/dinámico): el servidor resuelve de ahí la hora acreditada del traslado. Ausente = sin vuelo que acredite hora. */
  recorrido?: RecorridoServicios | null;
  /** Cualquier otra elección del hotel que, si cambia, invalida la cotización
   * de servicios (categoría, régimen, habitaciones, salida…). */
  firma: string;
};

/** Servicio opcional del paquete que se puede seleccionar. */
export type ServicioSeleccionable = { servicioId: number | null; nombre: string };

/** Respuesta de `buscarReceptivos` guardada con la clave con la que se pidió. */
export type ConsultaServicios =
  | { clave: string; estado: "ok"; resultados: readonly ResultadoServicio[] }
  | { clave: string; estado: "error"; mensaje: string };

export type EstadoServicio = {
  servicioId: number;
  nombre: string;
  estado: "faltan_datos" | "cotizando" | "ok" | "sin_precio" | "moneda_distinta" | "hora_pendiente" | "error";
  resultado: ResultadoServicio | null;
  mensaje: string | null;
};

export type EvaluacionServicios = {
  servicios: EstadoServicio[];
  /** Hotel + servicios se pueden agregar juntos (o no hay servicios). */
  listo: boolean;
  /** Motivo legible cuando `listo` es false; `null` si está listo. */
  bloqueo: string | null;
  /** Total hotel + servicios — SOLO cuando todo está cotizado y es compatible. */
  total: { monto: number; moneda: string } | null;
};

/** Un traslado con franja horaria cuya hora se desconoce NO tiene precio final: bloquea el conjunto (nunca se muestra como «desde» ni entra al carrito). */
export function mensajeHoraPendiente(nombre: string, tramos: readonly string[]): string {
  const cuando = tramos.length === 2 ? "de llegada y de salida" : tramos[0] === "salida" ? "de salida" : "de llegada";
  return `«${nombre}» cambia de precio según la hora ${cuando}, que aún no se conoce: no tiene precio final y no se puede agregar.`;
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Clave de la cotización de servicios para el estado ACTUAL del hotel, o
 * `null` si al hotel le faltan datos para cotizar (sin paquete, fechas,
 * pasajeros o precio). */
export function claveConsultaServicios(h: HotelParaServicios): string | null {
  if (h.paqueteId == null || !Number.isInteger(h.paqueteId) || h.paqueteId <= 0) return null;
  if (!h.fechaIda || !h.fechaRegreso || !FECHA_ISO.test(h.fechaIda) || !FECHA_ISO.test(h.fechaRegreso) || h.fechaRegreso <= h.fechaIda) return null;
  if (h.pax == null || !Number.isInteger(h.pax) || h.pax < 1) return null;
  if (h.precio == null || !(h.precio > 0)) return null;
  return JSON.stringify([h.paqueteId, h.fechaIda, h.fechaRegreso, h.pax, h.precio, (h.moneda ?? "COP").toUpperCase(), h.firma, h.recorrido ?? null]);
}

/** El resultado que corresponde EXACTAMENTE a (paqueteId, servicioId), o `null`. */
export function elegirResultadoServicio(
  resultados: readonly ResultadoServicio[],
  paqueteId: number,
  servicioId: number,
): ResultadoServicio | null {
  return resultados.find((r) => r.paqueteId === paqueteId && r.servicioId === servicioId) ?? null;
}

/** Agrega o quita un servicio de la selección (sin duplicados). */
export function alternarSeleccion(seleccion: readonly number[], servicioId: number): number[] {
  return seleccion.includes(servicioId) ? seleccion.filter((s) => s !== servicioId) : [...seleccion, servicioId];
}

export function mensajeSinPrecio(nombre: string, pax: number): string {
  return `«${nombre}» no tiene un precio vigente en este paquete para estas fechas y ${pax} pasajero${pax === 1 ? "" : "s"} `
    + "(puede no tener tarifa en esa temporada o no cubrir esa cantidad de pasajeros).";
}

/** Evalúa la selección contra el estado actual del hotel y la última consulta. */
export function evaluarServicios(input: {
  hotel: HotelParaServicios;
  seleccion: readonly number[];
  disponibles: readonly ServicioSeleccionable[];
  consulta: ConsultaServicios | null;
}): EvaluacionServicios {
  const { hotel, consulta } = input;
  const monedaHotel = (hotel.moneda ?? "COP").toUpperCase();
  const precioHotel = hotel.precio != null && hotel.precio > 0 ? hotel.precio : null;
  const nombrePor = new Map(input.disponibles.filter((d) => d.servicioId != null).map((d) => [d.servicioId as number, d.nombre]));
  const seleccion = [...new Set(input.seleccion)].filter((id) => nombrePor.has(id));

  if (!seleccion.length) {
    return { servicios: [], listo: true, bloqueo: null, total: precioHotel != null ? { monto: precioHotel, moneda: monedaHotel } : null };
  }

  const clave = claveConsultaServicios(hotel);
  const servicios: EstadoServicio[] = seleccion.map((servicioId) => {
    const nombre = nombrePor.get(servicioId) as string;
    const base = { servicioId, nombre, resultado: null, mensaje: null };
    if (clave == null) return { ...base, estado: "faltan_datos" };
    if (!consulta || consulta.clave !== clave) return { ...base, estado: "cotizando" };
    if (consulta.estado === "error") return { ...base, estado: "error", mensaje: consulta.mensaje };
    const r = elegirResultadoServicio(consulta.resultados, hotel.paqueteId as number, servicioId);
    if (!r || !(r.total > 0)) return { ...base, estado: "sin_precio", mensaje: mensajeSinPrecio(nombre, hotel.pax as number) };
    if ((r.moneda || "COP").toUpperCase() !== monedaHotel) {
      return { ...base, estado: "moneda_distinta", resultado: r, mensaje: `«${nombre}» está en ${r.moneda} y el hotel en ${monedaHotel}: no se pueden sumar en un mismo conjunto.` };
    }
    if (r.requiereHora?.length) return { ...base, estado: "hora_pendiente", resultado: r, mensaje: mensajeHoraPendiente(nombre, r.requiereHora) };
    return { ...base, estado: "ok", resultado: r };
  });

  const listo = servicios.every((s) => s.estado === "ok");
  let bloqueo: string | null = null;
  if (!listo) {
    if (servicios.some((s) => s.estado === "faltan_datos")) bloqueo = "Completa fechas, pasajeros y precio del hotel para cotizar los servicios seleccionados.";
    else if (servicios.some((s) => s.estado === "cotizando")) bloqueo = "Cotizando los servicios con los datos actuales del hotel…";
    else if (servicios.some((s) => s.estado === "hora_pendiente")) {
      const pend = servicios.filter((s) => s.estado === "hora_pendiente").map((s) => `«${s.nombre}»`);
      bloqueo = `No se puede agregar el conjunto: ${pend.join(", ")} depende${pend.length > 1 ? "n" : ""} de la hora de llegada o salida, aún desconocida. Quítalo${pend.length > 1 ? "s" : ""} o agrégalo desde «Receptivos» indicando la hora.`;
    } else {
      const malos = servicios.filter((s) => s.estado !== "ok").map((s) => `«${s.nombre}»`);
      bloqueo = `No se puede agregar el conjunto: ${malos.join(", ")} sin precio válido. Quítalo${malos.length > 1 ? "s" : ""} o cambia la selección del hotel.`;
    }
  }
  const total = listo && precioHotel != null
    ? { monto: precioHotel + servicios.reduce((s, x) => s + (x.resultado as ResultadoServicio).total, 0), moneda: monedaHotel }
    : null;
  return { servicios, listo, bloqueo, total };
}

// ── #54: editar los servicios de un hotel que YA está en el carrito ──────
// La tarjeta muestra un BORRADOR (hidratado desde lo guardado) y el carrito
// conserva el conjunto confirmado hasta que el borrador completo es válido y
// se confirma. Nada de esto calcula precios: reutiliza `evaluarServicios`.

/** Servicios de la selección que el catálogo del paquete ya no ofrece (o que
 * no se pueden cotizar en línea). `evaluarServicios` los omite; al EDITAR un
 * conjunto guardado eso los haría desaparecer en silencio, así que la edición
 * los nombra y no deja confirmar hasta que se quiten a conciencia. */
export function serviciosFueraDeCatalogo(seleccion: readonly number[], disponibles: readonly ServicioSeleccionable[]): number[] {
  const enCatalogo = new Set(disponibles.filter((d) => d.servicioId != null).map((d) => d.servicioId as number));
  return [...new Set(seleccion)].filter((id) => !enCatalogo.has(id));
}

/** Mismos servicios, sin importar orden ni repetidos. */
export function mismaSeleccion(a: readonly number[], b: readonly number[]): boolean {
  const sa = new Set(a), sb = new Set(b);
  return sa.size === sb.size && [...sb].every((id) => sa.has(id));
}

/** ¿La cotización pedida al confirmar coincide con la que vio el usuario?
 * Mismos servicios, en el mismo orden, con el mismo total, moneda y pax, y el
 * mismo total del conjunto. Cualquier diferencia exige volver a confirmar. */
export function mismaCotizacion(mostrada: EvaluacionServicios, nueva: EvaluacionServicios): boolean {
  if (!mostrada.listo || !nueva.listo || mostrada.servicios.length !== nueva.servicios.length) return false;
  if (mostrada.total?.monto !== nueva.total?.monto || mostrada.total?.moneda !== nueva.total?.moneda) return false;
  return mostrada.servicios.every((s, k) => {
    const n = nueva.servicios[k];
    return n.servicioId === s.servicioId && n.resultado != null && s.resultado != null
      && n.resultado.total === s.resultado.total && n.resultado.pax === s.resultado.pax
      && (n.resultado.moneda || "COP").toUpperCase() === (s.resultado.moneda || "COP").toUpperCase();
  });
}

export type EvaluacionEdicion = {
  /** El borrador difiere de lo guardado (sin importar el orden). */
  cambios: boolean;
  /** La actualización completa se puede confirmar. */
  listo: boolean;
  /** Motivo legible propio de la edición (los de la cotización los da `evaluacion.bloqueo`). */
  bloqueo: string | null;
  /** Servicios del borrador que el catálogo ya no ofrece: hay que quitarlos. */
  fueraDeCatalogo: number[];
  /** El borrador deja el hotel sin servicios. */
  retiroTotal: boolean;
};

export const MENSAJE_CONJUNTO_CAMBIO =
  "Los servicios de este hotel cambiaron en el carrito mientras editabas. Descarta los cambios para ver lo que quedó guardado.";
export const MENSAJE_FUERA_DE_CATALOGO =
  "Hay servicios guardados que este paquete ya no ofrece. Quítalos para poder confirmar la actualización.";

/** Estado de la edición del conjunto de un hotel que ya está en el carrito.
 * `conjuntoVigente` = el carrito sigue teniendo el conjunto sobre el que se
 * empezó el borrador (misma huella). Retirar todos los servicios no necesita
 * cotización; con servicios, la evaluación debe estar lista. */
export function evaluarEdicionServicios(input: {
  guardados: readonly number[];
  borrador: readonly number[];
  disponibles: readonly ServicioSeleccionable[];
  evaluacion: EvaluacionServicios;
  conjuntoVigente: boolean;
}): EvaluacionEdicion {
  const cambios = !mismaSeleccion(input.guardados, input.borrador);
  const fueraDeCatalogo = serviciosFueraDeCatalogo(input.borrador, input.disponibles);
  const retiroTotal = input.borrador.length === 0;
  let bloqueo: string | null = null;
  if (!input.conjuntoVigente) bloqueo = MENSAJE_CONJUNTO_CAMBIO;
  else if (fueraDeCatalogo.length) bloqueo = MENSAJE_FUERA_DE_CATALOGO;
  const listo = cambios && bloqueo == null && (retiroTotal || input.evaluacion.listo);
  return { cambios, listo, bloqueo, fueraDeCatalogo, retiroTotal };
}

/** Ítems de servicio para el carrito (sin `id`/`hotelItemId`: los pone
 * `addConjunto`). Solo con una evaluación lista; si no, lista vacía. */
export function serviciosParaCarrito(
  ev: EvaluacionServicios,
  hotel: HotelParaServicios,
  fotos: Readonly<Record<number, string | null>> = {},
): { tipo: "tour"; paqueteId: number; servicioId: number; nombre: string; destino: string | null; fotoUrl: string | null; fechaIda: string; fechaRegreso: string; noches: number; pax: number; precio: number; moneda: string }[] {
  if (!ev.listo || !hotel.fechaIda || !hotel.fechaRegreso) return [];
  return ev.servicios.map((s) => {
    const r = s.resultado as ResultadoServicio;
    return {
      tipo: "tour" as const, paqueteId: r.paqueteId, servicioId: r.servicioId, nombre: r.nombre, destino: r.destino,
      fotoUrl: fotos[r.servicioId] ?? null, fechaIda: hotel.fechaIda as string, fechaRegreso: hotel.fechaRegreso as string,
      noches: r.noches, pax: r.pax, precio: r.total, moneda: r.moneda,
    };
  });
}
