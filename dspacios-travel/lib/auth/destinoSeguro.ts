// Destino local para redirigir después del login (callback de OAuth).
//
// `next` viaja en la URL del callback y lo puede armar cualquiera que envíe un
// enlace. Concatenarlo tal cual (`${origin}${next}`) era una redirección
// abierta: con next="@otro.com" sale "https://app@otro.com" (host ajeno) y
// "//otro.com" es una URL relativa al protocolo. Solo se acepta una RUTA del
// mismo origen; todo lo demás vuelve al destino por defecto.

export const DESTINO_POR_DEFECTO = "/dashboard";

// Máximo de capas de codificación (%25…) que se desenvuelven antes de rendirse.
const MAX_DECODIFICACIONES = 5;

// Una ruta segura empieza por exactamente una "/" y no la sigue otra "/" ni "\"
// (los navegadores tratan "\" como "/"). Tampoco admite barras invertidas en
// ninguna parte ni caracteres de control (el parser de URL descarta tab/salto
// de línea y "/\t/otro.com" terminaría siendo "//otro.com").
function rutaPlana(valor: string): boolean {
  return /^\/(?![/\\])/.test(valor) && !/[\\\u0000-\u001f\u007f]/.test(valor);
}

/**
 * Devuelve `next` como ruta local (pathname + query + hash) si es segura para
 * el `origin` dado; en otro caso `DESTINO_POR_DEFECTO`. Rechaza también las
 * variantes codificadas que, al decodificarse, dejarían de ser una ruta local.
 */
export function destinoLocalSeguro(next: string | null | undefined, origin: string): string {
  if (typeof next !== "string" || !rutaPlana(next)) return DESTINO_POR_DEFECTO;

  let capa = next;
  for (let i = 0; i < MAX_DECODIFICACIONES; i++) {
    let decodificada: string;
    try {
      decodificada = decodeURIComponent(capa);
    } catch {
      return DESTINO_POR_DEFECTO; // "%" mal formado
    }
    if (!rutaPlana(decodificada)) return DESTINO_POR_DEFECTO;
    if (decodificada === capa) break;
    capa = decodificada;
    if (i === MAX_DECODIFICACIONES - 1) return DESTINO_POR_DEFECTO;
  }

  let base: URL;
  let url: URL;
  try {
    base = new URL(origin);
    url = new URL(next, base);
  } catch {
    return DESTINO_POR_DEFECTO;
  }
  const destino = `${url.pathname}${url.search}${url.hash}`;
  // Los segmentos "." / ".." se normalizan: "/.//otro.com" queda en "//otro.com".
  if (url.origin !== base.origin || !rutaPlana(destino)) return DESTINO_POR_DEFECTO;
  return destino;
}
