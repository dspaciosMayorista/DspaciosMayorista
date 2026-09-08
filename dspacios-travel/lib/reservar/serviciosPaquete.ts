// ─────────────────────────────────────────────────────────────────────────
// Fuente ÚNICA para clasificar/resumir/deduplicar servicios EFECTIVOS de una
// reserva (incluidos por `armado_servicios.incluido=true` + opcionales
// realmente seleccionados) — corrige el defecto donde `asistencia_medica`/
// `tours_traslados` se armaban de forma distinta (o se hardcodeaban) en cada
// uno de los caminos de creación de cotización/contrato.
//
// PURO: no toca Supabase. Los llamadores (checkout/actions.ts, reservar/
// actions.ts, computo.ts, contratos/actions.ts) consultan `armado_servicios`/
// `servicios_adicionales` y arman `ServicioEfectivo[]`; este módulo solo
// decide cómo clasificar/deduplicar/resumir esa lista ya consultada — mismo
// patrón que `lib/reservar/liquidacionServicio.ts`.
//
// Import relativo (no `@/…`) a propósito: se importa DIRECTO desde
// `node --test` sin bundler, igual que `liquidacionServicio.ts`/
// `distribucionHabitaciones.ts`.
// ─────────────────────────────────────────────────────────────────────────

import { precioServicio, factorLiquidacion } from "../calc/paquetes.ts";

// `servicios_adicionales.categoria` es texto libre sin CHECK (migración 029,
// "valores sugeridos: tour_traslado | asistencia | otro") — cualquier valor
// que no sea EXACTAMENTE uno de los dos primeros cae a "otro", nunca se
// inventa una clasificación de asistencia/tour para un dato desconocido.
export type CategoriaServicio = "asistencia" | "tour_traslado" | "otro";

export function normalizarCategoriaServicio(categoria: string | null | undefined): CategoriaServicio {
  if (categoria === "asistencia") return "asistencia";
  if (categoria === "tour_traslado") return "tour_traslado";
  return "otro";
}

// Un servicio EFECTIVO de la reserva — ya sea incluido (horneado en el PVP
// del hotel, `costoNeto` es SOLO para CxP, nunca se vuelve a sumar al total)
// o un add-on opcional realmente seleccionado (`costoNeto` es lo que se le
// debe al proveedor; su PVP se suma UNA sola vez, fuera de este módulo).
export type ServicioEfectivo = {
  servicioId: number;
  nombre: string;
  categoria: CategoriaServicio;
  incluido: boolean;
  costoNeto: number;
  proveedorId: number | null;
  // Opcional: de qué paquete viene (relevante SOLO cuando un carrito con
  // varios hoteles/paquetes se agrupa por destino en más de un contrato —
  // ver convertirCotizacionCarrito — para saber a cuál de los contratos
  // resultantes le corresponde la CxP de cada servicio incluido). Los demás
  // llamadores (un solo paquete a la vez) no lo necesitan.
  paqueteId?: number;
};

// Deduplica por `servicioId` (NUNCA solo por nombre) — si el mismo servicio
// llega por más de una vía (ej. quedó marcado incluido en el catálogo Y
// además alguien lo mandó como opcional elegido), la entrada INCLUIDA gana:
// ya está pagado/horneado, no se vuelve a cobrar ni a facturar como opcional.
export function deduplicarServicios(items: ServicioEfectivo[]): ServicioEfectivo[] {
  const porId = new Map<number, ServicioEfectivo>();
  for (const it of items) {
    const previo = porId.get(it.servicioId);
    if (!previo || (it.incluido && !previo.incluido)) porId.set(it.servicioId, it);
  }
  return [...porId.values()];
}

export type ResumenServiciosContrato = {
  asistenciaMedica: boolean;
  // Nombres de servicios `tour_traslado` (incluidos + opcionales), join ", ".
  // Nunca incluye un servicio `asistencia` ni `otro`.
  toursTraslados: string | null;
  // Servicios `otro` — conservan su identidad (id/nombre) para el snapshot
  // operativo aunque no tengan una sección de display dedicada; nunca se
  // inventan como asistencia/tour.
  otros: { servicioId: number; nombre: string }[];
};

// Resumen ÚNICO para `ventas.asistencia_medica`/`ventas.tours_traslados` —
// usado por los 5 caminos de creación/edición de cotización/contrato para
// que el resultado sea idéntico sin importar por cuál se haya creado.
export function resumirServiciosContrato(items: ServicioEfectivo[]): ResumenServiciosContrato {
  const dedup = deduplicarServicios(items);
  const asistenciaMedica = dedup.some((s) => s.categoria === "asistencia");
  const tours = dedup.filter((s) => s.categoria === "tour_traslado").map((s) => s.nombre);
  const otros = dedup.filter((s) => s.categoria === "otro").map((s) => ({ servicioId: s.servicioId, nombre: s.nombre }));
  return { asistenciaMedica, toursTraslados: tours.length ? tours.join(", ") : null, otros };
}

// Tipo de proveedor para la CxP de un servicio — mismo criterio que
// TIPO_PROVEEDOR en cotizaciones/manual-actions.ts (aereo→aereo, hotel→hotel,
// traslado→receptivo, asistencia→asistencia, otro→otro).
export function tipoProveedorCxpServicio(categoria: CategoriaServicio): "asistencia" | "receptivo" | "otro" {
  if (categoria === "asistencia") return "asistencia";
  if (categoria === "tour_traslado") return "receptivo";
  return "otro";
}

// Costo NETO total (lo que se le debe al proveedor) de un servicio, dado su
// modo de cobro YA validado + los datos crudos de tarifa + el pax REAL de la
// reserva. Misma fórmula que usa `calcularPrecioConModoYMarkup`
// (liquidacionServicio.ts) antes de aplicar markup — acá nunca se aplica
// markup: es el costo, no el PVP.
//
// `null` = no se pudo resolver con los datos disponibles (modo persona sin
// `precioPersonaNeto`, o modo grupo sin ningún rango que cubra `totalPax`) —
// el llamador decide qué hacer: en el contexto de una reserva FINAL (con pax
// real conocido) esto debe fallar cerrado, nunca tratarse como costo $0.
export function costoNetoServicioIncluido(
  modo: "persona" | "grupo",
  precioPersonaNeto: number | null,
  gruposNeto: { pax_desde: number; pax_hasta: number; precio: number }[],
  totalPax: number,
  liquidacion: string | null,
  numNoches: number
): number | null {
  if (totalPax <= 0) return null;
  if (modo === "persona") {
    if (precioPersonaNeto == null) return null;
    const total = precioServicio("persona", precioPersonaNeto, [], totalPax) * factorLiquidacion(liquidacion, numNoches);
    return Number.isFinite(total) ? total : null;
  }
  if (!gruposNeto.length) return null;
  const cubre = gruposNeto.some((g) => totalPax >= g.pax_desde && totalPax <= g.pax_hasta);
  if (!cubre) return null; // ningún rango de pax cubre esta reserva — configuración incompleta, nunca se asume el más cercano
  const total = precioServicio("grupo", null, gruposNeto, totalPax) * factorLiquidacion(liquidacion, numNoches);
  return Number.isFinite(total) ? total : null;
}
