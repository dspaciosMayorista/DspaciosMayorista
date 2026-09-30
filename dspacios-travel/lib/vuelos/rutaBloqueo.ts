// Origen y ruta de un bloqueo de vuelo al EDITARLO (EditarBloqueoForm).
// Funciones puras y testeables.
//
// El formulario elige origen y destino del catálogo de destinos (ciudad +
// IATA) y arma la ruta automática IATA_ORIGEN - IATA_DESTINO - IATA_ORIGEN,
// igual que NuevoBloqueoForm. Pero un bloqueo ya guardado puede traer un
// `origen` que no casa con el catálogo (texto de la carga CSV, una tilde,
// un nombre distinto) o no tener destino: el combo arranca vacío y, antes de
// esta regla, guardar CUALQUIER otro campo escribía `origen` y/o `ruta` en
// null sin avisar.

export type DestinoIata = { id: number; nombre: string; codigo_iata?: string | null };

/** IATA (o, en su defecto, nombre) en mayúsculas del destino elegido; "" si no hay. */
export function iataDeDestino(destinos: DestinoIata[], id: number | ""): string {
  const d = destinos.find((x) => x.id === id);
  return (d?.codigo_iata || d?.nombre || "").toUpperCase().trim();
}

/** Precarga del combo de origen: busca el origen guardado por IATA o nombre exacto (sin distinguir mayúsculas). */
export function origenIdDesdeGuardado(destinos: DestinoIata[], origenGuardado: string): number | "" {
  const t = (origenGuardado || "").trim().toUpperCase();
  if (!t) return "";
  const d = destinos.find((x) => (x.codigo_iata || "").toUpperCase() === t || (x.nombre || "").toUpperCase() === t);
  return d ? d.id : "";
}

/** Ruta automática: IATA_ORIGEN - IATA_DESTINO - IATA_ORIGEN (vacía si falta alguno). */
export function rutaAutomatica(origenIata: string, destinoIata: string): string {
  return origenIata && destinoIata ? `${origenIata} - ${destinoIata} - ${origenIata}` : "";
}

export const MSG_ORIGEN_INVALIDO =
  "Elige un origen del catálogo de destinos: sin él no se puede armar la ruta y no se guardan cambios de origen o destino.";
export const MSG_DESTINO_INVALIDO =
  "Elige un destino del catálogo de destinos: sin él no se puede armar la ruta y no se guardan cambios de origen o destino.";

export type OrigenRutaEdicion =
  /** Origen y destino sin cambios: se envían los valores guardados tal cual. */
  | { ok: true; modo: "conservado"; origen: string; ruta: string }
  /** Origen y destino válidos del catálogo tras un cambio: ruta recalculada. */
  | { ok: true; modo: "recalculado"; origen: string; ruta: string }
  /** Hubo un cambio pero no se puede armar la ruta: el guardado se bloquea. */
  | { ok: false; campo: "origen" | "destino"; error: string };

/**
 * Qué `origen` y `ruta` enviar al guardar la edición.
 *
 * - Origen y destino SIN cambiar (aunque el origen guardado no esté en el
 *   catálogo o el destino sea nulo) → se conservan `origen` y `ruta`
 *   guardados. Nunca se reescriben por abrir y guardar otros campos.
 * - Cambió origen o destino y los dos son válidos → se recalculan como
 *   siempre (IATA_ORIGEN - IATA_DESTINO - IATA_ORIGEN).
 * - Cambió origen o destino y falta un origen válido (p. ej. se cambió el
 *   destino con el origen fuera del catálogo) o un destino válido → bloqueo
 *   con mensaje; nunca se envían origen/ruta vacíos en lugar de los guardados.
 */
export function resolverOrigenRutaEdicion(p: {
  destinos: DestinoIata[];
  origenGuardado: string;
  rutaGuardada: string;
  origenIdInicial: number | "";
  destinoIdInicial: number | "";
  origenId: number | "";
  destinoId: number | "";
}): OrigenRutaEdicion {
  if (p.origenId === p.origenIdInicial && p.destinoId === p.destinoIdInicial) {
    return { ok: true, modo: "conservado", origen: p.origenGuardado ?? "", ruta: p.rutaGuardada ?? "" };
  }
  const origen = iataDeDestino(p.destinos, p.origenId);
  if (!origen) return { ok: false, campo: "origen", error: MSG_ORIGEN_INVALIDO };
  const destino = iataDeDestino(p.destinos, p.destinoId);
  if (!destino) return { ok: false, campo: "destino", error: MSG_DESTINO_INVALIDO };
  return { ok: true, modo: "recalculado", origen, ruta: rutaAutomatica(origen, destino) };
}
