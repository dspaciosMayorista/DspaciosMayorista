// ─────────────────────────────────────────────────────────────────────────
// Disponibilidad por fecha/salida de los servicios del paquete — módulo PURO (migración 256).
//
// Regla (la publicación y las rutas de venta la comparten):
//   · OPCIONAL: se ofrece solo donde una vigencia con tarifa válida cubre la fecha. Sin ninguna vigencia en la ventana del paquete no se publica (oculto);
//     con vigencia en parte de la ventana se publica con los tramos disponibles (`fechas_disponibles`). Un hueco NUNCA invalida el resto del paquete.
//   · INCLUIDO: si no tiene tarifa vigente en la fecha de una salida/estadía, el servicio se OMITE de ESA salida (no entra al PVP, al costo ni a la CxP, ni se lista en
//     «Incluye»/documentos) y el hotel/paquete se ofrece igual. Lo que sí impide publicar esa salida es un error de configuración (franjas horarias, vigencias ambiguas).
//   · Si ninguna salida es vendible el paquete se publica sin filas, con un diagnóstico que dice qué servicio y qué fechas lo impiden.
// El diagnóstico es texto para quien monta el paquete; no contiene precios ni datos del proveedor.
// ─────────────────────────────────────────────────────────────────────────

export type TramoFechas = { desde: string; hasta: string };
export type MotivoIncluido = { servicio: string; error: string };
export type SalidaOmitida = { fechaIda: string; fechaRegreso: string | null; motivos: MotivoIncluido[] };
export type IncluidoOmitido = { servicioId: number; servicio: string; motivo: string };
export type SalidaConIncluidosOmitidos = { fechaIda: string; fechaRegreso: string | null; servicios: IncluidoOmitido[] };
export type OpcionalOculto = { servicio: string; motivo: string };
export type OpcionalParcial = { servicio: string; rangos: TramoFechas[]; primerSinCobertura: string | null };

const MAX_TEXTO = 1800;
const fechaLegible = (f: string) => f.split("-").reverse().join("/");

/** Motivo sin el rótulo repetido: «El servicio incluido «X» no tiene vigencia…» → «no tiene vigencia…» (el nombre ya va delante). */
const motivoCorto = (error: string) => error.replace(/^El servicio incluido «[^»]*» /, "").replace(/\.$/, "");

/** «01/12/2026 al 30/11/2027, 05/01/2028» → texto de los tramos (un solo día se escribe sin «al»). */
export function textoTramos(rangos: readonly TramoFechas[], maximo = 4): string {
  const t = rangos.slice(0, maximo).map((r) => (r.desde === r.hasta ? fechaLegible(r.desde) : `${fechaLegible(r.desde)} al ${fechaLegible(r.hasta)}`));
  return t.join(", ") + (rangos.length > maximo ? ` (y ${rangos.length - maximo} tramo(s) más)` : "");
}

/** Fecha dentro de algún tramo (inclusive). Sin tramos (null/undefined) = sin restricción conocida: la vigencia de la fecha se valida al cotizar. */
export function fechaDisponible(fecha: string, tramos: readonly TramoFechas[] | null | undefined): boolean {
  if (!tramos) return true;
  return tramos.some((r) => r.desde <= fecha && fecha <= r.hasta);
}

/** Valida el jsonb leído de la base (`fechas_disponibles`): arreglo de {desde, hasta} ISO ordenados, o null. */
export function tramosDeJson(v: unknown): TramoFechas[] | null {
  if (!Array.isArray(v)) return null;
  const out: TramoFechas[] = [];
  for (const x of v) {
    const r = x as { desde?: unknown; hasta?: unknown };
    if (typeof r?.desde !== "string" || typeof r?.hasta !== "string" || r.hasta < r.desde) return []; // dato corrupto: sin tramos (no se ofrece), nunca «sin restricción»
    out.push({ desde: r.desde, hasta: r.hasta });
  }
  return out;
}

/** Mensaje para quien mira una fila de servicio opcional: disponible en todas las fechas del viaje o solo en ciertos tramos. */
export function etiquetaDisponibilidad(tramos: readonly TramoFechas[] | null | undefined): string | null {
  if (!tramos) return null;
  if (!tramos.length) return "No disponible en ninguna fecha del viaje del paquete.";
  return `Disponible solo del ${textoTramos(tramos)}. En las demás fechas no se ofrece.`;
}

export type EntradaDiagnostico = {
  salidasEvaluadas: number;
  salidasOmitidas: readonly SalidaOmitida[];
  opcionalesOcultos: readonly OpcionalOculto[];
  opcionalesParciales: readonly OpcionalParcial[];
  /** Salidas que SÍ se publican pero sin algún incluido (sin tarifa vigente en su fecha). */
  incluidosOmitidos?: readonly SalidaConIncluidosOmitidos[];
  /** Texto manual «Incluye»: líneas que son exactamente el nombre de un servicio omitido (retiradas) y texto libre no verificable en las salidas con omisiones (no se presenta como inclusión cierta). */
  lineasIncluyeAfectadas?: { retiradas: readonly string[]; noConfirmadas: readonly string[] };
};

/**
 * Texto de diagnóstico de la publicación (null si todo quedó completo). `vendible` = hay oferta: alguna salida con todos sus incluidos cubiertos, o (si el
 * paquete no tiene salidas que evaluar) la publicación tiene filas — lo decide quien llama con las filas reales.
 */
export function diagnosticoDisponibilidad(e: EntradaDiagnostico, vendible: boolean): string | null {
  const partes: string[] = [];
  const omitidas = e.salidasOmitidas.length;
  if (omitidas) {
    const porServicio = new Map<string, { n: number; primera: string; ultima: string; ejemplo: string }>();
    for (const s of e.salidasOmitidas) {
      for (const m of s.motivos) {
        const x = porServicio.get(m.servicio);
        if (!x) porServicio.set(m.servicio, { n: 1, primera: s.fechaIda, ultima: s.fechaIda, ejemplo: motivoCorto(m.error) });
        else { x.n++; if (s.fechaIda < x.primera) x.primera = s.fechaIda; if (s.fechaIda > x.ultima) x.ultima = s.fechaIda; }
      }
    }
    const detalle = [...porServicio].map(([nombre, x]) => `«${nombre}» (${x.n} salida(s), desde ${fechaLegible(x.primera)}${x.ultima !== x.primera ? ` hasta ${fechaLegible(x.ultima)}` : ""}; ${x.ejemplo})`).join("; ");
    const cabecera = vendible
      ? `${omitidas} de ${e.salidasEvaluadas} salida(s) no se publican porque un servicio incluido no tiene vigencia confirmada: ${detalle}.`
      : `Sin oferta vendible: ninguna de las ${e.salidasEvaluadas} salida(s) tiene todos sus servicios incluidos con vigencia confirmada: ${detalle}.`;
    partes.push(cabecera);
  }
  if (e.incluidosOmitidos?.length) {
    const porServicio = new Map<string, { n: number; primera: string; ultima: string }>();
    for (const sa of e.incluidosOmitidos) {
      for (const m of sa.servicios) {
        const x = porServicio.get(m.servicio);
        if (!x) porServicio.set(m.servicio, { n: 1, primera: sa.fechaIda, ultima: sa.fechaIda });
        else { x.n++; if (sa.fechaIda < x.primera) x.primera = sa.fechaIda; if (sa.fechaIda > x.ultima) x.ultima = sa.fechaIda; }
      }
    }
    const det = [...porServicio].map(([n, x]) => `«${n}» (${x.n} salida(s), desde ${fechaLegible(x.primera)}${x.ultima !== x.primera ? ` hasta ${fechaLegible(x.ultima)}` : ""})`).join("; ");
    partes.push(`Servicios incluidos omitidos por falta de tarifa vigente (esas salidas se ofrecen SIN el servicio): ${det}.`);
  }
  const la = e.lineasIncluyeAfectadas;
  if (la?.retiradas.length) partes.push(`El texto «Incluye» del paquete se conserva, pero en las salidas sin el servicio se retira: ${la.retiradas.map((l) => `«${l}»`).join("; ")}.`);
  if (la?.noConfirmadas.length) {
    partes.push(`ATENCIÓN operador: en las salidas con servicios omitidos el texto «Incluye» (libre) no se presenta como inclusión cierta —puede nombrar un servicio con otras palabras— y se muestran solo los servicios efectivos. Líneas afectadas: `
      + `${la.noConfirmadas.map((l) => `«${l}»`).join("; ")}. Estructura el texto o edítalo.`);
  }
  if (e.opcionalesOcultos.length) {
    partes.push(`Opcionales no ofrecidos: ${e.opcionalesOcultos.map((o) => o.motivo).join(" ")}`);
  }
  if (e.opcionalesParciales.length) {
    partes.push(`Opcionales con disponibilidad parcial: ${e.opcionalesParciales.map((o) => `«${o.servicio}» solo ${textoTramos(o.rangos, 2)}`).join("; ")}.`);
  }
  if (!partes.length) return null;
  if (!vendible && !omitidas) partes.unshift("Sin oferta vendible.");
  const texto = partes.join(" ");
  return texto.length > MAX_TEXTO ? `${texto.slice(0, MAX_TEXTO - 1)}…` : texto;
}
