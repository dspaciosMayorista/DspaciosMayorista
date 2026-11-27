// B95-3 — restricción ESTABLECIDA de un hotel del catálogo, comprobada por el SERVIDOR sobre el hotel que el asesor eligió por id (no por coincidencia de nombre).
// Hoy la única restricción establecida con regla propia es «Adults Only» (hoteles.adults_only; el motor de reservar ya bloquea niños/infantes en esos hoteles). «Acepta mascotas»
// es informativa: NO se fabrica una prohibición a partir de ella. Falla cerrado: si el hotel elegido no se puede leer o ya no existe, no se crea nada.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteLectura = { from: (t: string) => any };

export type HotelRestriccion = { id: number; nombre: string | null; adults_only: boolean | null };

/** PURO: mensaje de rechazo, o null si todo cuadra. `ids` = hoteles del catálogo elegidos; `hayMenores` = el documento declara niños/menores. */
export function evaluarRestriccionesHotelCatalogo(hoteles: readonly HotelRestriccion[], ids: readonly number[], hayMenores: boolean): string | null {
  for (const id of ids) {
    const h = hoteles.find((x) => x.id === id);
    if (!h) return "Uno de los hoteles elegidos del catálogo ya no existe o no se pudo verificar. No se creó nada: vuelve a elegirlo.";
    if (h.adults_only === true && hayMenores) return `El hotel «${h.nombre ?? "elegido"}» es solo para adultos (Adults Only) y esta venta incluye menores. No se creó nada: quita a los menores o elige otro hotel.`;
  }
  return null;
}

/** Ids válidos (enteros positivos, sin repetir). */
export function idsHotelesElegidos(ids: readonly (number | null | undefined)[]): number[] {
  return [...new Set(ids.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0))];
}

export async function verificarRestriccionesHotelCatalogo(
  cliente: ClienteLectura, ids: readonly (number | null | undefined)[], hayMenores: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const lista = idsHotelesElegidos(ids);
  if (!lista.length) return { ok: true };
  const { data, error } = await cliente.from("hoteles").select("id, nombre, adults_only").in("id", lista);
  if (error) return { ok: false, error: "No se pudieron verificar las restricciones de los hoteles elegidos. No se creó nada. Inténtalo de nuevo." };
  const msg = evaluarRestriccionesHotelCatalogo((data ?? []) as HotelRestriccion[], lista, hayMenores);
  return msg ? { ok: false, error: msg } : { ok: true };
}
