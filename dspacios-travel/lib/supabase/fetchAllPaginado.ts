// Pagina una consulta PostgREST avanzando por la cantidad REAL de filas
// recibidas en cada página (nunca por el tamaño de página pedido) y se
// detiene solo con una página vacía — inmune al límite de filas por
// respuesta del proyecto de Supabase ("Max Rows"): un `.select()` simple se
// trunca en silencio, sin error, cuando el total de filas supera ese límite
// (mismo defecto ya corregido antes en Conciliaciones/Libro diario/Libro
// auxiliar — ver CLAUDE.md, "límite de filas de Supabase truncaba listados
// en silencio"). Fallo cerrado: un error en una página detiene la
// paginación de inmediato — se trabaja con lo ya acumulado hasta ese punto,
// nunca se reintenta indefinidamente ni se sigue pidiendo más.
//
// El caller es responsable de pasar una consulta con ORDEN TOTAL
// determinista (ej. `.order("id")` o `.order("numero_contrato")`) — sin
// orden estable, Postgres no garantiza que páginas sucesivas cubran filas
// distintas sin solapes ni huecos.
export type PaginaResultado<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllPaginado<T>(
  pedirPagina: (desde: number, hasta: number) => PromiseLike<PaginaResultado<T>>,
  tamPagina = 1000
): Promise<T[]> {
  const acumulado: T[] = [];
  let desde = 0;
  for (;;) {
    const { data, error } = await pedirPagina(desde, desde + tamPagina - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    acumulado.push(...data);
    desde += data.length;
  }
  return acumulado;
}
