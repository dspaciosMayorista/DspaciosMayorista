// Universo DECLARADO de viajeros de una cotización y cuándo se ofrece «Agregar pasajero». PURO, sin red.
//
// Regla del carrito (B12 y siguientes, `ConvertirCarritoBtn`): cada unidad (hotel o tour) se agrega con su propio `pax` y dos unidades pueden ser los MISMOS viajeros, viajeros
// distintos o solapados; por eso el total real NO es el máximo ni la suma de los `pax` de los ítems — lo declara quien convierte. Este módulo no inventa ese total:
//   · UNA sola unidad con viajeros (un hotel, con o sin tours vinculados a él; o un tour suelto) o una cotización ordinaria ⇒ universo EXACTO: son los `pax` de esa unidad.
//   · DOS o más unidades independientes ⇒ universo AMBIGUO: no se oculta nada por un tope calculado; solo existe una COTA DE SEGURIDAD (la suma de las unidades: nadie puede
//     haber más viajeros distintos que esa suma) y el control sigue ofrecido mientras no se llegue a ella. El número real lo sigue declarando el personal al convertir.
// Un tour vinculado a un hotel (`hotelRef`) viaja con (un subconjunto de) los viajeros de ese hotel: no es una unidad independiente.
export type UnidadViajeros = { pax: number; /** tour vinculado a un hotel del mismo carrito */ vinculada?: boolean };

export type UniversoViajeros =
  | { tipo: "exacto"; n: number }
  | { tipo: "ambiguo"; minimo: number; tope: number; unidades: number };

const entero = (v: unknown): number => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

/**
 * `paxCotizacion` = `cotizaciones.pax` (o el pax declarado de una cotización ordinaria); `unidades` = hoteles, bloqueos, tours y servicios con viajeros del carrito
 * (vacío = cotización ordinaria: el universo exacto es `paxCotizacion`).
 */
export function universoDeViajeros(paxCotizacion: number | null | undefined, unidades: readonly UnidadViajeros[] = []): UniversoViajeros {
  const base = Math.max(1, entero(paxCotizacion));
  const todas = unidades.map((u) => entero(u.pax));
  const independientes = unidades.filter((u) => !u.vinculada).map((u) => entero(u.pax));
  if (independientes.length >= 2) {
    const tope = independientes.reduce((s, n) => s + n, 0);
    return { tipo: "ambiguo", minimo: Math.max(base, ...todas), tope: Math.max(tope, base), unidades: independientes.length };
  }
  return { tipo: "exacto", n: Math.max(base, ...todas) };
}

/** Cota superior de filas: exacto = el universo; ambiguo = la suma de las unidades (cota de seguridad, no «el universo»). */
export const topeDeFilas = (u: UniversoViajeros): number => (u.tipo === "exacto" ? u.n : u.tope);

/** Pasajeros ADICIONALES al titular que caben en el UNIVERSO (el titular ya está capturado en el checkout). Es el universo, no lo que se puede capturar aquí: ver `capacidadCaptura`. */
export const topeAdicionales = (u: UniversoViajeros): number => Math.max(0, topeDeFilas(u) - 1);

/**
 * LÍMITE TÉCNICO de captura del aliado: cuántos pasajeros adicionales admite guardar la lista (CHECK `between 1 and 30` de `cotizacion_pasajeros_aliado.pasajeros`, migración 325;
 * la acción y la función de la 326 aplican el mismo número). Es una restricción de ALMACENAMIENTO, no el universo de viajeros: no se sube a la ligera ni se «trunca» para fingir que
 * todos están. Cuando el universo la supera, el aliado lo ve ANTES de escribir y el resto lo completa el personal al convertir (esa pantalla no usa este límite).
 */
export const LIMITE_CAPTURA_ADICIONALES = 30;

/** Adicionales que el panel del aliado ofrece capturar: el universo, acotado por el límite técnico. */
export const capacidadCaptura = (u: UniversoViajeros): number => Math.min(topeAdicionales(u), LIMITE_CAPTURA_ADICIONALES);

/** ¿El universo declarado pide más adicionales de los que la captura del aliado puede guardar? */
export const superaLimiteCaptura = (u: UniversoViajeros): boolean => topeAdicionales(u) > LIMITE_CAPTURA_ADICIONALES;

/** ¿Se ofrece «Agregar pasajero» en el panel del aliado? `filasActuales` incluye al titular (como en `puedeAgregarFila`). */
export const puedeAgregarCaptura = (u: UniversoViajeros, filasActuales: number): boolean => filasActuales - 1 < capacidadCaptura(u);

/**
 * Texto del panel del aliado ANTES y DURANTE la captura. Con el límite técnico por medio dice las dos cosas por separado: cuántos viajeros declara la cotización y cuántos se pueden
 * dejar aquí; al llegar al límite NUNCA dice que ya están todos (el universo sigue sin completarse) y manda al personal. Sin límite técnico por medio es `notaUniverso`.
 */
export function notaCaptura(u: UniversoViajeros, filasActuales: number): string | null {
  if (!superaLimiteCaptura(u)) return notaUniverso(u, filasActuales);
  const declarado = u.tipo === "exacto"
    ? `Esta cotización es para ${u.n} viajeros.`
    : `Esta cotización tiene ${u.unidades} servicios independientes (entre ${u.minimo} y ${u.tope} viajeros; el número real lo confirma el personal al convertir).`;
  const enLimite = !puedeAgregarCaptura(u, filasActuales);
  return enLimite
    ? `${declarado} Llegaste al máximo de ${LIMITE_CAPTURA_ADICIONALES} pasajeros adicionales que se pueden dejar aquí: esto NO significa que ya estén todos los viajeros. El personal de D'spacios completa el resto al convertir la cotización.`
    : `${declarado} Aquí puedes dejar hasta ${LIMITE_CAPTURA_ADICIONALES} pasajeros adicionales; el personal de D'spacios completa el resto al convertir la cotización.`;
}

/** ¿Se ofrece «Agregar pasajero»? Se oculta cuando todos los viajeros declarados están representados y vuelve al quitar una fila. */
export const puedeAgregarFila = (u: UniversoViajeros, filasActuales: number): boolean => filasActuales < topeDeFilas(u);

/** Texto que explica por qué el control no está (universo completo) o por qué sigue ofrecido (universo ambiguo). */
export function notaUniverso(u: UniversoViajeros, filasActuales: number): string | null {
  if (!puedeAgregarFila(u, filasActuales)) return u.tipo === "exacto"
    ? "Ya están todos los viajeros de la cotización. Si quitas a alguien, podrás agregar otro."
    : "Llegaste a la cota máxima de viajeros de esta cotización (la suma de todos sus servicios). Si quitas a alguien, podrás agregar otro.";
  return u.tipo === "ambiguo"
    ? `Esta cotización tiene ${u.unidades} servicios independientes que pueden ser los mismos viajeros o viajeros distintos; el número real lo confirma el personal al convertir (mínimo ${u.minimo}, máximo ${u.tope}).`
    : null;
}
