// ─────────────────────────────────────────────────────────────────────────────
// Bucle del cliente para una publicación REANUDABLE: llama la acción inicial y, mientras responda «pendiente», la acción de continuar. Puro y testeable.
// Si el navegador se cierra (o el usuario se va) entre peticiones, el bucle simplemente deja de existir: NO hay nada que deshacer. Lo ya cargado queda invisible en la base
// y lo publicado antes sigue completo; al volver a abrir la pantalla se detecta la publicación pendiente (`tarifario_publicacion_pendiente`) y se continúa con el mismo bucle.
// ─────────────────────────────────────────────────────────────────────────────

export type Progreso = { faltan: number; total: number; automatica?: boolean };
export type RespuestaPaso = { ok: true; pendiente?: Progreso | null } | { ok: false; error: string };

export type OpcionesBucle = {
  /** Tope de peticiones de continuación en esta sesión (defensa contra bucles infinitos). */
  maxPasos?: number;
  onProgreso?: (p: Progreso) => void;
  /** Devuelve true si la pantalla ya no está (navegador cerrado, componente desmontado): el bucle se detiene SIN llamar más a la base. */
  interrumpido?: () => boolean;
};

export type ResultadoBucle<R extends RespuestaPaso> = { terminado: true; respuesta: R } | { terminado: false; motivo: "interrumpido" | "tope"; ultima: R };

export async function ejecutarReanudable<R extends RespuestaPaso>(inicial: () => Promise<R>, continuar: (previa: R) => Promise<R>, op: OpcionesBucle = {}): Promise<ResultadoBucle<R>> {
  const tope = op.maxPasos ?? 60;
  let r = await inicial();
  for (let paso = 0; r.ok && r.pendiente; paso++) {
    if (op.interrumpido?.()) return { terminado: false, motivo: "interrumpido", ultima: r };
    if (paso >= tope) return { terminado: false, motivo: "tope", ultima: r };
    op.onProgreso?.(r.pendiente);
    r = await continuar(r);
  }
  return { terminado: true, respuesta: r };
}
