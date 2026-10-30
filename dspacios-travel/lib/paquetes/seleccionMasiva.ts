// Reglas PURAS de las acciones masivas del armado de paquetes (#107): estado de la casilla "Seleccionar todos" y
// cómo se explica el resultado de un lote. Sin React ni servidor. No toca precios ni reglas comerciales.

/** Resultado común de una acción por lote. `omitidos` = elementos que el servidor no aplicó y por qué; el resto sí se
 *  aplicó. `aviso` = algo que no impidió guardar (p. ej. el tarifario no se pudo regenerar). */
export type ResultadoLote =
  | { ok: true; procesados: number; omitidos?: { id: number; motivo: string }[]; aviso?: string }
  | { ok: false; error: string };

export type EstadoSeleccionTodos = {
  checked: boolean;
  indeterminate: boolean;
  /** Qué hace el siguiente clic. Con todo marcado se deselecciona; en cualquier otro caso se completa la selección. */
  siguiente: "seleccionar" | "deseleccionar";
  etiqueta: "Seleccionar todos" | "Deseleccionar todos";
};

export function estadoSeleccionTodos(total: number, marcados: number): EstadoSeleccionTodos {
  const todos = total > 0 && marcados >= total;
  return {
    checked: todos,
    indeterminate: marcados > 0 && marcados < total,
    siguiente: todos ? "deseleccionar" : "seleccionar",
    etiqueta: todos ? "Deseleccionar todos" : "Seleccionar todos",
  };
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Mensaje de un lote terminado. `tono` decide el color: éxito limpio, éxito con salvedades o fallo. */
export function mensajeLote(
  r: ResultadoLote,
  verbo: { singular: string; plural: string; accion: "agregó" | "quitó" | "vinculó" | "desvinculó" }
): { tono: "ok" | "aviso" | "error"; texto: string } {
  if (!r.ok) return { tono: "error", texto: r.error };
  const partes: string[] = [`Se ${verbo.accion} ${plural(r.procesados, verbo.singular, verbo.plural)}.`];
  const omitidos = r.omitidos ?? [];
  if (omitidos.length) {
    const lista = omitidos.slice(0, 5).map((o) => o.motivo).join(" ");
    partes.push(`No se aplicó a ${plural(omitidos.length, "elemento", "elementos")}: ${lista}${omitidos.length > 5 ? " …" : ""}`);
  }
  if (r.aviso) partes.push(r.aviso);
  return { tono: omitidos.length || r.aviso ? "aviso" : "ok", texto: partes.join(" ") };
}
