// ─────────────────────────────────────────────────────────────────────────
// Escalas de comisión del asesor interno (liquidación MENSUAL acumulada)
// ─────────────────────────────────────────────────────────────────────────
// La suma del PVP del mes ubica el rango de la escala. NO es marginal: TODA la
// base comisionable del mes se liquida con el % del rango alcanzado.
//   comisión_bruta = Σ base_comisionable_mes × %(según Σ PVP_mes)
// `pct` se guarda como PORCENTAJE (0.5 = 0.5 %). `pvp_hasta` null = abierto.
// ─────────────────────────────────────────────────────────────────────────

export type EscalaRango = { pvp_desde: number; pvp_hasta: number | null; pct: number };

/** % (porcentaje) del rango en el que cae un PVP acumulado. 0 si ninguno aplica. */
export function pctParaPvp(pvpAcumulado: number, rangos: EscalaRango[]): number {
  const ord = [...rangos].sort((a, b) => a.pvp_desde - b.pvp_desde);
  for (const r of ord) {
    const hasta = r.pvp_hasta == null ? Infinity : Number(r.pvp_hasta);
    if (pvpAcumulado >= Number(r.pvp_desde) && pvpAcumulado <= hasta) return Number(r.pct) || 0;
  }
  return 0;
}

export type LiquidacionMes = {
  pct: number;          // % aplicado (porcentaje)
  bruta: number;        // base × %
  retencion: number;    // retención de honorarios
  neta: number;         // bruta − retención
};

/** Comisión del mes de un asesor según su escala. */
export function comisionMes(args: {
  sumaPvp: number;
  sumaBase: number;
  rangos: EscalaRango[];
  retHonorarios?: number;   // fracción (0.11 = 11 %)
}): LiquidacionMes {
  const pct = pctParaPvp(args.sumaPvp, args.rangos);
  const bruta = Math.round((Number(args.sumaBase) || 0) * (pct / 100));
  const retH = args.retHonorarios ?? 0.11;
  const retencion = Math.round(bruta * retH);
  return { pct, bruta, retencion, neta: bruta - retencion };
}
