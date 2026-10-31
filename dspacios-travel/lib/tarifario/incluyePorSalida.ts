// ─────────────────────────────────────────────────────────────────────────
// «Incluye» por SALIDA — módulo PURO.
//
// El texto manual «Incluye» del paquete (`armado_paquetes.programa_incluye`, migración 169) es libre y único para todas las salidas. El emparejamiento de una línea con
// un servicio por su NOMBRE no basta: el texto puede nombrar un servicio con otras palabras («Transfer aeropuerto-hotel» para «Traslado 133»), y esa forma alternativa no se
// detecta. Por eso la regla es de acreditación, no de detección:
//   · Salida SIN servicios omitidos → el texto guardado se presenta íntegro (nada que contradecir).
//   · Salida CON algún servicio omitido → el texto libre NO se presenta como inclusión cierta. Solo se presenta lo ACREDITADO por la composición efectiva: los servicios que
//     sí se incluyen y cobran (por su nombre de catálogo). Una línea del texto se conserva únicamente si cada uno de sus fragmentos es exactamente el nombre de un servicio
//     efectivo; una que sea exactamente el nombre de un servicio omitido se retira; todo lo demás es texto no verificable: se retira de la presentación y se avisa al operador
//     (el cliente final no ve el aviso).
// El texto guardado NUNCA se modifica; esta presentación se deriva por salida.
// ─────────────────────────────────────────────────────────────────────────

export type ServicioIncluidoRef = { servicioId: number; nombre: string };

export type PresentacionIncluye = {
  /** Líneas a mostrar (conservadas + reconstruidas + servicios efectivos si hubo líneas no confirmables). */
  lineas: string[];
  /** Líneas que son exactamente el nombre de servicios omitidos (se retiran con certeza). */
  retiradas: string[];
  /** Texto libre que no se puede verificar contra la composición efectiva en una salida con omisiones: no se presenta como inclusión cierta. */
  noConfirmadas: string[];
  /** Aviso para el operador (null si todo se separó con seguridad). */
  aviso: string | null;
};

/** Minúsculas, sin tildes, solo letras/dígitos separados por un espacio. */
export const normalizarNombre = (t: string): string =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim();

const SEPARADORES = /\s*(?:,|;|\+|\/|\sy\s|\se\s)\s*/i;
// Adornos que no cambian de qué servicio habla una línea: viñetas, numeración, «incluido/a(s)».
const ADORNO_INICIAL = /^(?:[-*•·\d]+[.)]?\s+)/;
const ADORNO_FINAL = /\s*\(?\b(?:incluido|incluida|incluidos|incluidas|incluye)\b\)?\s*$/i;

function limpiarFragmento(f: string): string {
  return f.replace(ADORNO_INICIAL, "").replace(ADORNO_FINAL, "").trim();
}

/**
 * Clasifica UNA línea en una salida con omisiones. `acreditada`: todos sus fragmentos son nombres de servicios efectivos (se conserva con ellos). `retirada`: todos son nombres de
 * servicios (omitidos o no) y no queda ninguno efectivo. `no_verificable`: cualquier otro texto.
 */
function evaluarLinea(
  linea: string, efectivos: readonly ServicioIncluidoRef[], omitidos: readonly ServicioIncluidoRef[],
): { tipo: "acreditada" | "retirada" | "no_verificable"; texto?: string } {
  const conocidos = [...efectivos, ...omitidos].map((s) => ({ s, n: normalizarNombre(s.nombre) }));
  const fragmentos = linea.split(SEPARADORES).map(limpiarFragmento).filter(Boolean);
  const resueltos = fragmentos.map((f) => ({ f, ref: conocidos.find((c) => c.n === normalizarNombre(f)) }));
  if (!resueltos.length || !resueltos.every((r) => r.ref)) return { tipo: "no_verificable" };
  const omitidosIds = new Set(omitidos.map((o) => o.servicioId));
  const quedan = resueltos.filter((r) => !omitidosIds.has(r.ref!.s.servicioId)).map((r) => r.f);
  return quedan.length ? { tipo: "acreditada", texto: quedan.join(", ") } : { tipo: "retirada" };
}

export function presentarIncluye(input: {
  lineas: readonly string[];
  efectivos: readonly ServicioIncluidoRef[];
  omitidos: readonly ServicioIncluidoRef[];
}): PresentacionIncluye {
  // Sin servicios omitidos: el texto guardado corresponde a la salida tal cual.
  if (!input.omitidos.length) return { lineas: [...input.lineas], retiradas: [], noConfirmadas: [], aviso: null };
  const lineas: string[] = [];
  const retiradas: string[] = [];
  const noConfirmadas: string[] = [];
  for (const l of input.lineas) {
    const r = evaluarLinea(l, input.efectivos, input.omitidos);
    if (r.tipo === "acreditada") lineas.push(r.texto ?? l);
    else if (r.tipo === "retirada") retiradas.push(l);
    else noConfirmadas.push(l);
  }
  // Inclusiones acreditadas por la composición efectiva que el texto no nombraba tal cual: se muestran por su nombre de catálogo.
  const ya = normalizarNombre(lineas.join(" | "));
  for (const s of input.efectivos) if (!` ${ya} `.includes(` ${normalizarNombre(s.nombre)} `)) lineas.push(s.nombre);
  const aviso = noConfirmadas.length
    ? `En esta salida se omiten servicios incluidos (${input.omitidos.map((o) => `«${o.nombre}»`).join(", ")}) y el texto «Incluye» del paquete es libre: no se puede verificar qué prometen estas líneas (pueden nombrar un servicio con otras palabras): `
      + `${noConfirmadas.map((l) => `«${l}»`).join("; ")}. No se presentan como inclusión cierta; se muestran solo los servicios efectivos. Estructura el texto o edítalo para esta salida.`
    : null;
  return { lineas, retiradas, noConfirmadas, aviso };
}
