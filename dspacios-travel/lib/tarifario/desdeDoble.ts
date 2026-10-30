// Regla compartida del «Desde» (TASKS #92/#114): el importe mostrado como «Desde» sale EXCLUSIVAMENTE de una tarifa
// DOBLE publicable (`precio_doble` > 0) dentro del conjunto de filas que la pantalla realmente ofrece. Nunca la mínima
// de sencilla/triple/múltiple/niño/infante, y nunca mezcla monedas: cada moneda se resuelve por separado. Sin DOBLE
// publicable devuelve null/[] y la pantalla muestra «Consultar» (nunca un importe inventado).
// Módulo PURO (sin React/Next) para poder probarlo con ejecución real.

export type FilaConDoble = { precio_doble?: number | null; moneda?: string | null };

const monedaDe = (m: string | null | undefined): string => (m && m.trim() ? m.trim().toUpperCase() : "COP");

const esDoblePublicable = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** «Desde» DOBLE de las filas que están en la moneda indicada (default "COP", igual que el resto del tarifario). */
export function desdeDoble(filas: readonly FilaConDoble[], moneda: string | null | undefined): number | null {
  const objetivo = monedaDe(moneda);
  const v = filas.filter((f) => monedaDe(f.moneda) === objetivo).map((f) => f.precio_doble).filter(esDoblePublicable);
  return v.length ? Math.min(...v) : null;
}

/** «Desde» DOBLE por moneda (COP primero, luego el resto alfabético). Vacío = sin DOBLE publicable ("Consultar"). */
export function desdeDobleSegunMoneda(filas: readonly FilaConDoble[]): { moneda: string; valor: number }[] {
  const porMoneda = new Map<string, number>();
  for (const f of filas) {
    if (!esDoblePublicable(f.precio_doble)) continue;
    const m = monedaDe(f.moneda);
    const prev = porMoneda.get(m);
    if (prev == null || f.precio_doble < prev) porMoneda.set(m, f.precio_doble);
  }
  return [...porMoneda.entries()]
    .map(([moneda, valor]) => ({ moneda, valor }))
    .sort((a, b) => (a.moneda === "COP" ? -1 : b.moneda === "COP" ? 1 : a.moneda.localeCompare(b.moneda)));
}

export type FilaListado = FilaConDoble & { paquete_id: number; modulo?: string | null; desde_general?: number | null };

/**
 * «Desde» del LISTADO de paquetes (#114): por paquete y por moneda, el menor `precio_doble` publicable de sus filas de resumen.
 * Excepción: las filas del módulo «servicios» (tours/receptivos) no tienen acomodación — se cobran por persona o grupo —, así
 * que no existe DOBLE que consultar; su «desde» es el de siempre (`desde_general`, también por moneda). Paquete ausente del
 * mapa = «Consultar».
 */
export function desdeListadoPorPaquete(filas: readonly FilaListado[]): Map<number, { moneda: string; valor: number }[]> {
  const porPaquete = new Map<number, FilaConDoble[]>();
  for (const f of filas) {
    const importe = f.modulo === "servicios" ? f.desde_general : f.precio_doble;
    const arr = porPaquete.get(f.paquete_id) ?? [];
    arr.push({ precio_doble: importe, moneda: f.moneda });
    porPaquete.set(f.paquete_id, arr);
  }
  const out = new Map<number, { moneda: string; valor: number }[]>();
  for (const [id, arr] of porPaquete) {
    const d = desdeDobleSegunMoneda(arr);
    if (d.length) out.set(id, d);
  }
  return out;
}

/**
 * «Desde» de la ficha y el documento de un PROGRAMA (#92): menor PVP de la acomodación DOBLE entre categorías y salidas.
 * `pvp` ya viene null para precios bajo solicitud (getProgramaDetalle). Sin DOBLE publicable → null («Consultar»). El
 * `desde_precio` manual de la cabecera NO entra: es un dato histórico sin vínculo con una DOBLE, no un precio publicable.
 */
export function desdeDobleDetallePrograma(det: {
  categorias: { precios: { acomodacion: string; pvp: number | null }[] }[];
  salidas: { precios: { acomodacion: string; pvp: number | null }[] }[];
}): number | null {
  const v = [...det.categorias, ...det.salidas]
    .flatMap((g) => g.precios.filter((p) => p.acomodacion === "doble").map((p) => p.pvp))
    .filter(esDoblePublicable);
  return v.length ? Math.min(...v) : null;
}
