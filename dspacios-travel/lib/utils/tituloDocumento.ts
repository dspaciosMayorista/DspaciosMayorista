/**
 * Título único para el <title> de las páginas imprimibles: es lo que el
 * navegador usa como nombre sugerido al "Guardar como PDF". Formato:
 * "{tipo} {numero de contrato} - {nombre}" (nombre = titular/cliente o
 * asesor/aliado según el documento, ver cada generateMetadata).
 */
export function tituloDocumento(
  tipo: string,
  numero: string | null | undefined,
  nombre?: string | null
): string {
  const partes = [tipo, numero, nombre].filter(
    (p): p is string => !!p && p.trim().length > 0
  );
  return partes.join(" - ");
}
