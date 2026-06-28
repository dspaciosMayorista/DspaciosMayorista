// Estadísticas y clasificación de bloqueos de vuelo (control + histórico).
// Funciones puras y testeables (heredan el patrón de cálculo del proyecto).

import { hoyISO } from "@/lib/calc/paquetes";

export type ConteoSillas = {
  disp: number;   // disponibles (incluye cambio_entrante)
  plazo: number;  // en_plazo
  conf: number;   // confirmadas (vendidas)
  dev: number;    // devueltas
  nven: number;   // no_vendida
  total: number;  // total de sillas del/los bloqueo(s)
};

export const conteoCero = (): ConteoSillas => ({ disp: 0, plazo: 0, conf: 0, dev: 0, nven: 0, total: 0 });

/** Suma una silla (por su estado) a un conteo. */
export function acumularSilla(c: ConteoSillas, estado: string | null): void {
  c.total++;
  if (estado === "disponible" || estado === "cambio_entrante") c.disp++;
  else if (estado === "en_plazo") c.plazo++;
  else if (estado === "confirmada") c.conf++;
  else if (estado === "devuelta") c.dev++;
  else if (estado === "no_vendida") c.nven++;
}

/** Conteo de sillas por bloqueo a partir de filas {bloqueo_id, estado}. */
export function conteoPorBloqueo(
  sillas: { bloqueo_id: number; estado: string | null }[] | null | undefined
): Map<number, ConteoSillas> {
  const m = new Map<number, ConteoSillas>();
  for (const s of sillas ?? []) {
    const c = m.get(s.bloqueo_id) ?? conteoCero();
    acumularSilla(c, s.estado);
    m.set(s.bloqueo_id, c);
  }
  return m;
}

/** Suma los conteos de un conjunto de bloqueos (por sus ids). */
export function sumarConteos(conteo: Map<number, ConteoSillas>, ids: number[]): ConteoSillas {
  const t = conteoCero();
  for (const id of ids) {
    const c = conteo.get(id);
    if (!c) continue;
    t.disp += c.disp; t.plazo += c.plazo; t.conf += c.conf;
    t.dev += c.dev; t.nven += c.nven; t.total += c.total;
  }
  return t;
}

/** Un bloqueo está PASADO si su fecha de ida ya quedó atrás (hoy en Colombia). */
export function esPasado(fechaIda: string | null, hoy: string = hoyISO()): boolean {
  return !!fechaIda && fechaIda < hoy;
}

/** % de ocupación = (confirmadas + en plazo) / total de sillas. */
export function ocupacionPct(c: ConteoSillas): number {
  if (!c.total) return 0;
  return Math.round(((c.conf + c.plazo) / c.total) * 100);
}

/** % de venta efectiva (histórico) = confirmadas / total. */
export function ventaPct(c: ConteoSillas): number {
  if (!c.total) return 0;
  return Math.round((c.conf / c.total) * 100);
}
