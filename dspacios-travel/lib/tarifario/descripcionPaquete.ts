// ─────────────────────────────────────────────────────────────────────────
// Descripción manual del paquete (migración 169) — reemplaza la generación
// automática de "Incluye" (armada antes a partir de `armado_servicios.
// incluido=true` + líneas fijas de "Tiquete aéreo"/"Hospedaje en <hotel>").
//
// El contenido pertenece al PAQUETE (`armado_paquetes`), nunca al hotel: los
// 4 campos son texto libre configurado UNA sola vez y compartido por todos
// los hoteles/opciones de ese mismo paquete. Cada campo es un elemento por
// línea, sin HTML ni encabezados embebidos — la UI pone el encabezado fijo y
// convierte cada línea no vacía en un ítem de lista (nunca Markdown, nunca
// dangerouslySetInnerHTML).
// ─────────────────────────────────────────────────────────────────────────

export type DescripcionPaqueteRaw = {
  incluye: string | null;
  noIncluye: string | null;
  tarifasEspeciales: string | null;
  condicionesComerciales: string | null;
};

export type SeccionDescripcion = { titulo: string; items: string[] };

/**
 * Un elemento por línea → array de líneas NO vacías, en el orden en que se
 * escribieron. Solo recorta espacios al inicio/fin de cada línea para decidir
 * si está vacía; nunca toca tildes ni caracteres del contenido. Acepta \r\n o
 * \n indistintamente (textarea de navegador).
 */
export function lineasDeTexto(texto: string | null | undefined): string[] {
  if (!texto) return [];
  return texto
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Las 4 secciones a renderizar, en orden fijo, SOLO las que tienen contenido. */
export function seccionesDescripcion(d: DescripcionPaqueteRaw | undefined | null): SeccionDescripcion[] {
  const candidatas: SeccionDescripcion[] = [
    { titulo: "Incluye", items: lineasDeTexto(d?.incluye) },
    { titulo: "No incluye", items: lineasDeTexto(d?.noIncluye) },
    { titulo: "Tarifas especiales", items: lineasDeTexto(d?.tarifasEspeciales) },
    { titulo: "Condiciones comerciales", items: lineasDeTexto(d?.condicionesComerciales) },
  ];
  return candidatas.filter((s) => s.items.length > 0);
}

/** true si las 4 secciones están vacías (nada configurado todavía). */
export function descripcionVacia(d: DescripcionPaqueteRaw | undefined | null): boolean {
  return seccionesDescripcion(d).length === 0;
}
