// #90 — Validación de una regla EBB / Long Stay (misma en cliente y servidor; refleja los check de la migración 278).
export type EntradaRegla = { tipo: unknown; umbral: unknown; pct: unknown };
export type ReglaValida = { tipo: "ebb" | "long_stay"; umbral: number; pct: number };

export function validarReglaDescuento(e: EntradaRegla): { ok: true; regla: ReglaValida } | { ok: false; error: string } {
  if (e.tipo !== "ebb" && e.tipo !== "long_stay") return { ok: false, error: "Elige el tipo de promoción: EBB o Long Stay." };
  const etiqueta = e.tipo === "ebb" ? "Los días mínimos antes del check-in" : "Las noches mínimas";
  const umbral = Number(e.umbral);
  if (e.umbral === "" || e.umbral == null || !Number.isInteger(umbral) || umbral < 1 || umbral > 3650) return { ok: false, error: `${etiqueta} deben ser un número entero entre 1 y 3650.` };
  const pct = Number(typeof e.pct === "string" ? e.pct.replace(",", ".") : e.pct);
  if (e.pct === "" || e.pct == null || !Number.isFinite(pct) || pct <= 0 || pct >= 100) return { ok: false, error: "El porcentaje debe ser mayor que 0 y menor que 100." };
  return { ok: true, regla: { tipo: e.tipo, umbral, pct: Math.round(pct * 100) / 100 } };
}
