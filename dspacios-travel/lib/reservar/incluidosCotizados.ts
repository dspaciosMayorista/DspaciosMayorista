// ─────────────────────────────────────────────────────────────────────────
// Servicios INCLUIDOS del paquete: qué queda en `cotizaciones.payload` y cómo
// la conversión a contrato los valida y recalcula.
//
// `cotizaciones.payload` lo puede leer el rol `venta` (RLS, migración 154):
// NO lleva costos ni proveedores. Por cada incluido de un hotel ACEPTADO en la
// cotización guarda su identidad (servicio, categoría, paquete, `ref` del
// hotel) y una HUELLA opaca del costo neto cotizado: HMAC-SHA256 con una
// clave derivada de la llave de servicio (solo existe en el servidor). Sin
// esa clave la huella no permite deducir el costo — ni por fuerza bruta.
//
// Al convertir, el costo y el proveedor se RESUELVEN OTRA VEZ en el servidor
// (`computarReserva` + catálogo), nunca desde el navegador ni desde el
// payload. Antes de escribir nada se valida que lo recalculado corresponda a
// lo cotizado — mismo hotel (`ref`), paquete, fechas, pasajeros y conjunto de
// servicios — y que no hayan cambiado la categoría (en claro), el proveedor
// (segunda huella opaca, nunca el id) ni el costo neto (huella). Un incluido
// con costo y sin proveedor en el catálogo tampoco se convierte: su CxP no se
// podría pagar. Ante cualquier faltante o discrepancia la conversión FALLA
// CERRADO con un mensaje claro: nada se sustituye en silencio.
//
// Cotizaciones anteriores (sin `ref`/huella): se identifican por paquete y
// su `costoNeto`/`proveedorId`/`categoria` SOLO se comparan (nunca se usan
// para la CxP). Sin forma de comprobar alguno, o si no coincide, falla
// cerrado: hay que generar una cotización nueva.
// ─────────────────────────────────────────────────────────────────────────
import { createHmac } from "node:crypto";
import type { CategoriaServicio, ServicioEfectivo } from "./serviciosPaquete.ts";

/** Lo que se guarda en `payload.serviciosIncluidos` (formato nuevo). */
export type ServicioIncluidoCotizado = {
  servicioId: number;
  nombre: string;
  categoria: CategoriaServicio;
  incluido: true;
  paqueteId: number;
  /** `ref` del hotel en la cotización (`payload.items[].ref`). */
  ref: string;
  /** HMAC del costo neto cotizado — opaco, sin la clave del servidor no revela el costo. */
  huella: string;
  /** HMAC del proveedor cotizado — opaco, nunca el id ni el nombre del proveedor. */
  huellaProveedor: string;
};

/** Entrada leída del payload: formato nuevo o de una cotización anterior. */
export type ServicioIncluidoGuardado = {
  servicioId?: unknown; nombre?: unknown; categoria?: unknown; paqueteId?: unknown;
  ref?: unknown; huella?: unknown; huellaProveedor?: unknown; costoNeto?: unknown; proveedorId?: unknown;
};

const CONTEXTO_HUELLA = "dspacios:cotizacion:costo-incluido:v1";

/** Clave de la huella derivada de la llave de servicio; `null` si no está configurada. */
export function claveHuellaIncluidos(llaveServicio: string | undefined): Buffer | null {
  if (!llaveServicio) return null;
  return createHmac("sha256", llaveServicio).update(CONTEXTO_HUELLA).digest();
}

export function huellaCostoIncluido(clave: Buffer, d: { ref: string; servicioId: number; costoNeto: number }): string {
  return createHmac("sha256", clave).update(JSON.stringify([d.ref, d.servicioId, Math.round(d.costoNeto * 100)])).digest("base64url");
}

export function huellaProveedorIncluido(clave: Buffer, d: { ref: string; servicioId: number; proveedorId: number | null }): string {
  return createHmac("sha256", clave).update(JSON.stringify([d.ref, d.servicioId, "proveedor", d.proveedorId])).digest("base64url");
}

/** Snapshot para el payload de UN hotel aceptado: sin costo ni proveedor. */
export function incluidosParaPayload(
  servicios: readonly ServicioEfectivo[],
  hotel: { ref: string; paqueteId: number },
  clave: Buffer,
): ServicioIncluidoCotizado[] {
  return servicios.map((s) => ({
    servicioId: s.servicioId, nombre: s.nombre, categoria: s.categoria, incluido: true,
    paqueteId: hotel.paqueteId, ref: hotel.ref,
    huella: huellaCostoIncluido(clave, { ref: hotel.ref, servicioId: s.servicioId, costoNeto: s.costoNeto }),
    huellaProveedor: huellaProveedorIncluido(clave, { ref: hotel.ref, servicioId: s.servicioId, proveedorId: s.proveedorId }),
  }));
}

const RECOTIZAR = "Genera una cotización nueva desde el tarifario antes de convertirla.";

/**
 * Valida, ANTES de escribir nada, que los incluidos recalculados al convertir
 * correspondan a lo cotizado para UN hotel, y devuelve los que deben usarse
 * para el resumen y la CxP (los RECALCULADOS en el servidor).
 */
export function validarIncluidosConversion(input: {
  hotelNombre: string;
  item: { ref?: string | null; paqueteId: number; pax: number };
  /** Fechas del hotel tal como se cotizaron (`detalle.hoteles[ref]`). */
  fechasCotizadas: { ida: string | null; regreso: string | null } | null;
  recalculo: { totalPax: number; fechaIda: string | null; fechaRegreso: string | null; incluidos: readonly ServicioEfectivo[] };
  /** `payload.serviciosIncluidos` completo de la cotización. */
  guardados: readonly ServicioIncluidoGuardado[];
  clave: Buffer | null;
}): { ok: true; incluidos: ServicioEfectivo[] } | { ok: false; error: string } {
  const { hotelNombre: h, item, recalculo } = input;
  const formatoNuevo = input.guardados.some((g) => typeof g.huella === "string" || typeof g.ref === "string");
  const delHotel = formatoNuevo
    ? input.guardados.filter((g) => item.ref != null && g.ref === item.ref)
    : input.guardados.filter((g) => g.paqueteId === item.paqueteId);
  // Sin incluidos cotizados ni recalculados no hay nada que validar (el resto
  // de la conversión sigue igual que siempre).
  if (!delHotel.length && !recalculo.incluidos.length) return { ok: true, incluidos: [] };

  if (formatoNuevo) {
    if (!item.ref) return { ok: false, error: `${h}: la cotización no identifica el hotel de sus servicios incluidos. ${RECOTIZAR}` };
    if (!input.fechasCotizadas?.ida || !input.fechasCotizadas.regreso) {
      return { ok: false, error: `${h}: la cotización no conserva las fechas del hotel para validar sus servicios incluidos. ${RECOTIZAR}` };
    }
    if (input.fechasCotizadas.ida !== recalculo.fechaIda || input.fechasCotizadas.regreso !== recalculo.fechaRegreso) {
      return { ok: false, error: `${h}: las fechas del hotel ya no coinciden con las cotizadas. ${RECOTIZAR}` };
    }
  }
  if (recalculo.totalPax !== item.pax) {
    return { ok: false, error: `${h}: los pasajeros del hotel (${recalculo.totalPax}) no coinciden con los cotizados (${item.pax}). ${RECOTIZAR}` };
  }

  if (delHotel.some((g) => g.paqueteId !== item.paqueteId)) {
    return { ok: false, error: `${h}: un servicio incluido no pertenece al paquete cotizado. ${RECOTIZAR}` };
  }
  const idsCotizados = new Set(delHotel.map((g) => g.servicioId));
  const idsActuales = new Set(recalculo.incluidos.map((s) => s.servicioId));
  const iguales = idsCotizados.size === idsActuales.size && [...idsActuales].every((id) => idsCotizados.has(id));
  if (!iguales) {
    return { ok: false, error: `${h}: los servicios incluidos del paquete cambiaron desde la cotización. ${RECOTIZAR}` };
  }

  for (const s of recalculo.incluidos) {
    const cotizados = delHotel.filter((g) => g.servicioId === s.servicioId);
    const cambio = (que: string) => ({ ok: false as const, error: `${h}: ${que} de «${s.nombre}» cambió desde la cotización; no se sustituye automáticamente. ${RECOTIZAR}` });
    // Categoría (dato no sensible, guardado en claro): decide el documento
    // (asistencia / tours y traslados) y el tipo de la CxP.
    if (!cotizados.some((g) => g.categoria === s.categoria)) return cambio("la categoría");
    // Sin proveedor no hay CxP pagable: nunca se registra una a nombre de nadie.
    if (s.costoNeto > 0 && s.proveedorId == null) {
      return { ok: false, error: `${h}: «${s.nombre}» no tiene proveedor configurado en el catálogo; no se puede registrar su cuenta por pagar. Configúralo en Producto → Servicios y vuelve a cotizar.` };
    }
    if (formatoNuevo) {
      if (!input.clave) return { ok: false, error: `${h}: no se puede verificar el costo de los servicios incluidos (configuración del servidor incompleta).` };
      const ref = item.ref as string;
      const proveedor = huellaProveedorIncluido(input.clave, { ref, servicioId: s.servicioId, proveedorId: s.proveedorId });
      if (!cotizados.some((g) => typeof g.huellaProveedor === "string")) {
        return { ok: false, error: `${h}: la cotización no permite verificar el proveedor de «${s.nombre}». ${RECOTIZAR}` };
      }
      if (!cotizados.some((g) => g.huellaProveedor === proveedor)) return cambio("el proveedor");
      const costo = huellaCostoIncluido(input.clave, { ref, servicioId: s.servicioId, costoNeto: s.costoNeto });
      if (!cotizados.some((g) => g.huella === costo)) return cambio("la tarifa neta");
    } else {
      // Cotización anterior: `proveedorId`/`costoNeto` solo se COMPARAN, nunca se usan.
      if (!cotizados.some((g) => "proveedorId" in g)) {
        return { ok: false, error: `${h}: esta cotización es anterior y no permite verificar el proveedor de «${s.nombre}». ${RECOTIZAR}` };
      }
      if (!cotizados.some((g) => (g.proveedorId ?? null) === s.proveedorId)) return cambio("el proveedor");
      const costos = cotizados.map((g) => g.costoNeto).filter((c): c is number => typeof c === "number" && Number.isFinite(c));
      if (!costos.length) {
        return { ok: false, error: `${h}: esta cotización es anterior y no permite verificar el costo de «${s.nombre}». ${RECOTIZAR}` };
      }
      if (!costos.some((c) => Math.round(c * 100) === Math.round(s.costoNeto * 100))) return cambio("la tarifa neta");
    }
  }
  return { ok: true, incluidos: recalculo.incluidos.map((s) => ({ ...s, paqueteId: item.paqueteId })) };
}
