// ─────────────────────────────────────────────────────────────────────────
// Destinos ofrecibles en Porción terrestre de Vista Booking.
//
// Es la UNIÓN de todo lo que el motor de búsqueda general de esa pestaña
// puede devolver hoy, y por eso es la lista que alimenta su selector:
//   · destinos PERSONA — filas del tarifario (`modulo = "porcion_terrestre"`),
//     que resuelve `buscarHoteles`;
//   · destinos UNIDAD (Bernalo) — ofertas `tipo = "porcion_terrestre"` del
//     descubrimiento, que resuelve `buscarAlojamientosUnidadPorFechas`.
//
// Antes el selector se armaba SOLO con las filas persona: un destino que
// existía únicamente por hoteles unidad quedaba fuera del desplegable, así que
// el motor —que ya sabe resolverlos— no se podía invocar para ese destino
// desde la UI. La unión cierra ese hueco; deduplicar y ordenar es lo que hace
// que el `<select>` no muestre el mismo destino dos veces ni en orden
// arbitrario.
//
// Vive acá (y no dentro de `VistaBooking`) para poder probar la unión de
// verdad, con un catálogo de fixture, en vez de solo verificar su forma por
// texto fuente.
// ─────────────────────────────────────────────────────────────────────────

/** Lo mínimo que aporta una fila del tarifario para decidir su destino. */
export type FilaDestinoPublico = {
  modulo?: string | null;
  destino_nombre?: string | null;
};

/** Lo mínimo que aporta una oferta unidad para decidir su destino. */
export type HotelDestinoPublico = {
  tipo?: string | null;
  destinoNombre?: string | null;
};

export function destinosPorcionPublica(
  filasPersona: readonly FilaDestinoPublico[],
  hotelesUnidad: readonly HotelDestinoPublico[]
): string[] {
  const persona = filasPersona
    .filter((f) => f.modulo === "porcion_terrestre" && f.destino_nombre)
    .map((f) => f.destino_nombre as string);
  const unidad = hotelesUnidad
    .filter((h) => h.tipo === "porcion_terrestre" && h.destinoNombre)
    .map((h) => h.destinoNombre as string);
  // `Set` = deduplicado (el mismo destino puede venir por filas persona y por
  // ofertas unidad, o repetirse entre paquetes); `.filter(Boolean)` descarta
  // cualquier cadena vacía y `.sort()` da un orden estable.
  return [...new Set([...persona, ...unidad])].filter(Boolean).sort();
}
