// ─────────────────────────────────────────────────────────────────────────
// Identidad ESTABLE de los cupos (pasajeros anónimos de una cotización) mientras se edita el carrito — lógica PURA.
//
// El carrito solo guarda CONTEOS (personas por acomodación y menores). Si el id de un cupo saliera de su posición (la 2.ª persona de la 1.ª habitación…), quitar o
// insertar una habitación lo correría y un servicio pasaría a cubrir a otra persona sin que nadie lo decida. Por eso:
//   · cada cupo recibe un ordinal MONOTÓNICO por clave («doble#3») que NUNCA se reutiliza, aunque se retire y se vuelva a agregar;
//   · subir el conteo crea cupos con ordinales NUEVOS (no cubiertos por ningún servicio de selección); bajarlo retira los de ordinal más alto;
//   · un servicio que cubría un cupo retirado queda INVÁLIDO y exige volver a seleccionar: jamás se traslada a otro cupo.
// ─────────────────────────────────────────────────────────────────────────

export type Conteos = Record<string, number>;
export type EstadoCupos = { siguiente: Record<string, number>; activos: Record<string, number[]> };

export const idCupo = (clave: string, ordinal: number) => `${clave}#${ordinal}`;

export function reconciliarCupos(previo: EstadoCupos | null, conteos: Conteos): { estado: EstadoCupos; ids: string[]; nuevos: string[]; retirados: string[] } {
  const siguiente: Record<string, number> = { ...(previo?.siguiente ?? {}) };
  const activos: Record<string, number[]> = {};
  const nuevos: string[] = [];
  const retirados: string[] = [];
  const claves = [...new Set([...Object.keys(previo?.activos ?? {}), ...Object.keys(conteos)])].sort();
  for (const clave of claves) {
    const quiere = Math.max(0, Math.trunc(Number(conteos[clave]) || 0));
    const actuales = [...(previo?.activos[clave] ?? [])];
    while (actuales.length > quiere) retirados.push(idCupo(clave, actuales.pop() as number));
    while (actuales.length < quiere) {
      const n = (siguiente[clave] ?? 0) + 1;
      siguiente[clave] = n;
      actuales.push(n);
      nuevos.push(idCupo(clave, n));
    }
    if (actuales.length) activos[clave] = actuales;
  }
  const ids = claves.flatMap((c) => (activos[c] ?? []).map((n) => idCupo(c, n)));
  return { estado: { siguiente, activos }, ids, nuevos, retirados };
}

/** Servicios de selección que cubren un cupo que ya no existe: hay que volver a seleccionar; nunca se reasignan solos. */
export function coberturasInvalidas<S extends { id: string; cubre: "todos" | readonly string[] }>(servicios: readonly S[], ids: readonly string[]): { servicio: S; faltantes: string[] }[] {
  const vivos = new Set(ids);
  const malos: { servicio: S; faltantes: string[] }[] = [];
  for (const s of servicios) {
    if (s.cubre === "todos") continue;
    const faltantes = s.cubre.filter((id) => !vivos.has(id));
    if (faltantes.length || !s.cubre.length) malos.push({ servicio: s, faltantes });
  }
  return malos;
}
