// #120 · Vista Booking: cómo se muestran los hoteles «bajo solicitud». Funciones PURAS (sin servidor): se importan desde el cliente y se prueban con `node --test`.
//
//   · Portada (sin búsqueda ni destino): sección propia DESPUÉS de los recomendados, con un máximo de tarjetas por paquete.
//   · Resultados de una búsqueda: se integran entre los demás resultados y pasan por los MISMOS filtros (zona, estrellas, Pet friendly, Adults Only, condición, política).
//     Sin precio ni condición conocidos, `precio` es null (al final en cualquier orden por precio) y condición/política son «desconocido» (nunca se inventan).
import type { HotelBajoSolicitud } from "@/lib/tarifario/datosSolicitud";
import type { ItemResto } from "@/lib/tarifario/inventarioResto";

/** Máximo de tarjetas «bajo solicitud» por paquete en la portada. */
export const MAX_SOLICITUD_POR_PAQUETE_PORTADA = 2;

/** Primeras `max` por paquete, conservando el orden de entrada (sin mezclar paquetes). */
export function limitarPorPaquete<T extends { paqueteId: number }>(hoteles: readonly T[], max: number = MAX_SOLICITUD_POR_PAQUETE_PORTADA): T[] {
  const vistos = new Map<number, number>();
  return hoteles.filter((h) => {
    const n = vistos.get(h.paqueteId) ?? 0;
    vistos.set(h.paqueteId, n + 1);
    return n < max;
  });
}

/** La tarjeta bajo solicitud como ítem del inventario filtrable/ordenable. */
export function itemRestoDeSolicitud(h: HotelBajoSolicitud): ItemResto {
  return {
    hotelId: h.hotelId,
    paqueteId: h.paqueteId,
    nombre: h.hotelNombre,
    precio: null,
    estrellas: h.estrellas,
    zona: h.zona,
    petFriendly: h.petFriendly,
    adultsOnly: h.adultsOnly,
    condicion: "desconocido",
    politica: "desconocido",
  };
}

/** Texto de la nota junto a los recomendados de la portada. */
export const NOTA_RECOMENDADOS = "Son una selección inicial de hoteles recomendados. Para ver más opciones, busca o elige origen y destino.";
