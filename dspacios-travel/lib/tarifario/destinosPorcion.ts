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
// Identidad por `id`, no solo por texto (hallazgo del cierre de búsqueda
// unidad): la búsqueda de hoteles por unidad dependía de re-resolver el
// destino elegido contra `destinos.nombre` (`.eq("nombre", texto)`) DENTRO de
// la Server Action — una segunda consulta redundante y frágil ante cualquier
// diferencia de mayúsculas/espacios entre el texto que armó este selector y
// el valor real en la base. Cuando una oferta unidad conoce su
// `armado_paquetes.destino_id` real (siempre lo conoce — llega desde
// `cargarHotelesBernaloDescubiertos`), esa identidad viaja en la opción
// misma: la Server Action ya no necesita adivinar el id a partir del nombre,
// lo recibe. Las filas PERSONA (`tarifario_resultado`) no tienen `destino_id`
// (solo el nombre denormalizado en generación) — para ellas `id` queda
// `null`, y esa mitad de la búsqueda sigue funcionando exactamente igual que
// antes (por nombre); no se migra su modelo de datos en este cierre. El
// nombre se conserva SIEMPRE, incluso cuando se conoce el id: sigue siendo lo
// único que se muestra y lo único que necesita `buscarHoteles` (persona).
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
  /** `armado_paquetes.destino_id` real de esa oferta — `null`/ausente solo si
   * el paquete no tiene destino configurado (mismo caso que `destinoNombre`
   * en `null`). */
  destinoId?: number | null;
};

/** Una opción del selector: el nombre SIEMPRE se muestra; el id viaja cuando
 * se conoce (toda oferta unidad lo conoce) para que la búsqueda por unidad no
 * tenga que volver a resolverlo por texto. */
export type DestinoPorcionOpcion = { id: number | null; nombre: string };

export function destinosPorcionPublica(
  filasPersona: readonly FilaDestinoPublico[],
  hotelesUnidad: readonly HotelDestinoPublico[]
): DestinoPorcionOpcion[] {
  // Deduplicado por NOMBRE (igual que antes): es lo único que las filas
  // persona aportan, y es lo que el `<select>` muestra. El id (cuando se
  // conoce) se asocia a ese mismo nombre — un id real de una oferta unidad
  // siempre prevalece sobre `null`, nunca al revés.
  const idPorNombre = new Map<string, number | null>();
  for (const f of filasPersona) {
    if (f.modulo === "porcion_terrestre" && f.destino_nombre) {
      if (!idPorNombre.has(f.destino_nombre)) idPorNombre.set(f.destino_nombre, null);
    }
  }
  for (const h of hotelesUnidad) {
    if (h.tipo === "porcion_terrestre" && h.destinoNombre) {
      const idActual = idPorNombre.get(h.destinoNombre);
      if (idActual == null) idPorNombre.set(h.destinoNombre, h.destinoId ?? null);
    }
  }
  return [...idPorNombre.entries()]
    .map(([nombre, id]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}
