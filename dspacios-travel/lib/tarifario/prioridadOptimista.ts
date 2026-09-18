// Estado OPTIMISTA de "hotel recomendado" del editor de paquetes
// (`ArmadoClient`): mapa `hotelId -> prioridad` aplicado POR ENCIMA de lo que
// trajo el servidor, para que elegir una prioridad se vea al instante y no
// obligue a recargar todo el editor (`router.refresh()` tardaba segundos).
//
// El punto delicado es la RECONCILIACIÓN: un override no puede sobrevivir para
// siempre, o el editor mostraría un valor viejo tapando el dato fresco del
// servidor. Las reglas, en funciones puras y testeables:
//
//   · un override se DESCARTA cuando el servidor ya trae ese mismo valor
//     (quedó reconocido) → a partir de ahí manda el servidor;
//   · un override se DESCARTA cuando la fila dejó de existir en las props
//     (hotel desasociado del paquete) → re-asociarlo no puede "resucitar" la
//     prioridad local vieja, porque la fila nueva nace en NULL;
//   · un override que el servidor todavía no refleja SIGUE vigente → es el
//     guardado en vuelo (o recién hecho) y mostrarlo es lo correcto.
//
// Nada de esto usa React: son funciones puras sobre `Map`, así que la
// secuencia completa (servidor=null → optimista=1 → servidor=1 → servidor=2)
// se prueba con ejecución real en pruebas/prioridadOptimista.test.ts.

/** `hotelId -> prioridad` pendiente de confirmar por el servidor. */
export type OverridesPrioridad = ReadonlyMap<number, number | null>;

/** Fila mínima del servidor que necesita la reconciliación. */
export type FilaPrioridadServidor = { hotel_id: number; prioridad: number | null };

/** Registra el valor elegido por el usuario (autosave optimista). */
export function conPrioridadOptimista(
  previos: OverridesPrioridad,
  hotelId: number,
  prioridad: number | null
): Map<number, number | null> {
  const siguiente = new Map(previos);
  siguiente.set(hotelId, prioridad);
  return siguiente;
}

/**
 * ELIMINA el override de un hotel, sin mutar el mapa de entrada.
 *
 * Es lo que se usa cuando el guardado FALLA: dejar un override con el valor
 * anterior sería indistinguible de un guardado en vuelo (para el resto del
 * motor local) y podría tapar de forma indefinida el dato fresco del servidor
 * —el override solo se descarta cuando el servidor trae ESE MISMO valor, así
 * que uno con un valor viejo nunca se reconoce—. Sin override, el editor
 * muestra el dato autoritativo en cuanto llega.
 *
 * Devuelve el MISMO mapa si no había nada que eliminar.
 */
export function sinPrioridadOptimista(
  previos: Map<number, number | null>,
  hotelId: number
): Map<number, number | null> {
  if (!previos.has(hotelId)) return previos;
  const siguiente = new Map(previos);
  siguiente.delete(hotelId);
  return siguiente;
}

/**
 * Descarta los overrides ya reconocidos por el servidor y los de filas que ya
 * no existen. Devuelve el MISMO mapa cuando no hay nada que descartar — así el
 * llamador puede evitar un re-render inútil (y un `setState` con el mismo
 * contenido).
 *
 * ⚠️ Un override se descarta SOLO por "reconocido" (servidor === override) o
 * por "fila ausente". Nunca por "el servidor dice otra cosa": una respuesta
 * vieja de un `router.refresh()` anterior a nuestro guardado puede llegar con
 * el valor anterior y no debe pisar el optimista vigente.
 */
export function reconciliarPrioridades(
  previos: Map<number, number | null>,
  filasServidor: readonly FilaPrioridadServidor[]
): Map<number, number | null> {
  if (previos.size === 0) return previos;
  const delServidor = new Map(filasServidor.map((f) => [f.hotel_id, f.prioridad]));
  let siguiente: Map<number, number | null> | null = null;
  for (const [hotelId, prioridad] of previos) {
    const reconocido = delServidor.has(hotelId) && delServidor.get(hotelId) === prioridad;
    const filaAusente = !delServidor.has(hotelId);
    if (reconocido || filaAusente) {
      if (!siguiente) siguiente = new Map(previos);
      siguiente.delete(hotelId);
    }
  }
  return siguiente ?? previos;
}

/**
 * Valor que debe mostrar el editor: el override vigente si lo hay, y si no el
 * dato del servidor.
 */
export function prioridadEfectivaDe(
  overrides: OverridesPrioridad,
  hotelId: number,
  delServidor: number | null
): number | null {
  return overrides.has(hotelId) ? (overrides.get(hotelId) as number | null) : delServidor;
}

/** Prioridades 1-6 ocupadas en el paquete (hotelId -> prioridad), con los
 * overrides vigentes aplicados — es lo que deshabilita las opciones ya tomadas
 * en el selector de cada hotel, sin esperar a un refresh. */
export function prioridadesOcupadasDe(
  overrides: OverridesPrioridad,
  filasServidor: readonly FilaPrioridadServidor[]
): Map<number, number> {
  const ocupadas = new Map<number, number>();
  for (const f of filasServidor) {
    const p = prioridadEfectivaDe(overrides, f.hotel_id, f.prioridad);
    if (p != null) ocupadas.set(f.hotel_id, p);
  }
  return ocupadas;
}
