/**
 * Actividad de la semana (lunes a domingo) del inicio del portal B2B. Lógica pura: recibe solo fechas de
 * registros que el aliado YA está autorizado a ver (salidas de contratos propios y fechas de sus pagos);
 * no lee ni decide pertenencia.
 */
export type DiaActividad = { etiqueta: string; iso: string; salidas: number; pagos: number };

const ETIQUETAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function actividadSemana(a: { hoy: string; salidas: (string | null | undefined)[]; pagos: (string | null | undefined)[] }): { dias: DiaActividad[]; total: number } {
  const base = new Date(`${a.hoy}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7));
  const dias: DiaActividad[] = ETIQUETAS.map((etiqueta, i) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    return { etiqueta, iso: d.toISOString().slice(0, 10), salidas: 0, pagos: 0 };
  });
  const porIso = new Map(dias.map((d) => [d.iso, d]));
  // Las fechas pueden venir como timestamp: solo cuenta el día.
  for (const f of a.salidas) { const d = f ? porIso.get(f.slice(0, 10)) : undefined; if (d) d.salidas++; }
  for (const f of a.pagos) { const d = f ? porIso.get(f.slice(0, 10)) : undefined; if (d) d.pagos++; }
  return { dias, total: dias.reduce((t, d) => t + d.salidas + d.pagos, 0) };
}
