// #126-D — qué PROMOCIÓN realmente se aplicó a una estadía, para mostrarla como etiqueta compacta. Módulo PURO (sin I/O).
//
// Fuente única: la `procedencia` que ya devuelve el motor de liquidación (`liquidarHotelNochesConTemporadas`), noche por noche y deduplicada por vigencia.
// Solo hay etiqueta si una vigencia de PROMOCIÓN ganó de verdad (no basta con que el hotel tenga una configurada). Si la precedencia dejó la promoción
// fuera, el motor re-liquida con las bases y su procedencia ya no la contiene. El alcance es honesto:
//   · "toda"           → todas las noches de la estadía las ganó la promoción;
//   · "algunas_noches" → hubo noches ganadas por una vigencia base: la promoción NO cubre toda la estadía;
//   · "estadia"        → promoción de estadía completa («N noches, 1 gratis», monto por estadía): se resuelve sobre el total, no noche a noche.
// Nunca habla de niños (un niño que paga no es «gratis»; su beneficio ya lo explica el desglose por pasajero).
import { esPromoEstadia, type ProcedenciaNoche, type TemporadaRango } from "./paquetes.ts";

export type AlcancePromo = "toda" | "algunas_noches" | "estadia";
export type PromoAplicada = { nombre: string; alcance: AlcancePromo };
export type PromocionMostrada = { etiqueta: string; promociones: { nombre: string; alcance: AlcancePromo; acomodaciones?: string[] }[] };

/**
 * Promociones que ganaron en la estadía de UNA acomodación, con SU PROPIO alcance. [] si ninguna.
 * El alcance de cada promoción por noche sale de cuántas noches ganó ELLA frente al total de noches de la estadía (`nochesPorGanadora`, del liquidador): dos promociones
 * sucesivas que juntas cubren toda la estadía son cada una «algunas noches», aunque no quede ninguna noche base. Sin ese conteo (llamador antiguo) se es conservador:
 * solo una promoción única, sin ninguna otra vigencia ganadora, cuenta como toda la estadía.
 */
export function promocionesAplicadasDe(procedencia: readonly ProcedenciaNoche[], temporadas: readonly TemporadaRango[], nochesPorGanadora?: Readonly<Record<string, number>>): PromoAplicada[] {
  const porNombre = new Map(temporadas.map((t) => [t.nombre, t]));
  const totalNoches = nochesPorGanadora ? Object.values(nochesPorGanadora).reduce((a, b) => a + b, 0) : 0;
  const out: PromoAplicada[] = [];
  for (const nombre of new Set(procedencia.filter((p) => p.esPromocion).map((p) => p.temporadaGanadora))) {
    const t = porNombre.get(nombre);
    let alcance: AlcancePromo;
    if (t && esPromoEstadia(t)) alcance = "estadia";
    else if (nochesPorGanadora) alcance = totalNoches > 0 && (nochesPorGanadora[nombre] ?? 0) >= totalNoches ? "toda" : "algunas_noches";
    else alcance = procedencia.length === 1 ? "toda" : "algunas_noches";
    out.push({ nombre, alcance });
  }
  return out;
}

const NOMBRE_ACOM: Record<string, string> = { sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple" };
const PEOR: Record<AlcancePromo, number> = { toda: 0, estadia: 1, algunas_noches: 2 };

function textoPromo(nombre: string, alcance: AlcancePromo): string {
  if (alcance === "algunas_noches") return `${nombre} · solo en algunas noches`;
  if (alcance === "estadia") return `${nombre} · aplicada a la estadía`;
  return nombre;
}

/** Etiqueta de las acomodaciones realmente usadas por la búsqueda: si una promoción no cubre todas, lo dice («solo en Doble»). null si ninguna aplicó. */
export function promocionMostrada(porAcom: Record<string, readonly PromoAplicada[]> | undefined, acoms: readonly string[]): PromocionMostrada | null {
  const usadas = [...new Set(acoms)].filter((a) => porAcom && a in porAcom);
  if (!porAcom || usadas.length === 0) return null;
  const nombres = new Set<string>();
  for (const a of usadas) for (const p of porAcom[a]) nombres.add(p.nombre);
  if (nombres.size === 0) return null;
  const promociones = [...nombres].map((nombre) => {
    const donde = usadas.filter((a) => porAcom[a].some((p) => p.nombre === nombre));
    const alcance = donde.map((a) => porAcom[a].find((p) => p.nombre === nombre)!.alcance).reduce((x, y) => (PEOR[y] > PEOR[x] ? y : x));
    return { nombre, alcance, ...(donde.length < usadas.length ? { acomodaciones: donde } : {}) };
  });
  // Varias promociones con el mismo alcance y sin restricción por acomodación se agrupan en una sola frase (no se repite el calificativo).
  const mismoAlcance = promociones.length > 1 && promociones.every((p) => p.alcance === promociones[0].alcance && !p.acomodaciones);
  const etiqueta = mismoAlcance
    ? promociones[0].alcance === "algunas_noches"
      ? `Promociones ${promociones.map((p) => p.nombre).join(" y ")} · cada una en algunas noches`
      : `Promociones ${textoPromo(promociones.map((p) => p.nombre).join(" y "), promociones[0].alcance)}`
    : promociones
        .map((p) => `Promoción ${textoPromo(p.nombre, p.alcance)}${p.acomodaciones ? ` (solo en ${p.acomodaciones.map((a) => NOMBRE_ACOM[a] ?? a).join(", ")})` : ""}`)
        .join(" · ");
  return { etiqueta, promociones };
}
