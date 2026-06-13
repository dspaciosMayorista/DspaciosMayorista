// ─────────────────────────────────────────────────────────────────────────
// Calculadora de precios de PROGRAMAS (terceros que dan tarifa comisionable)
//
// Algunos proveedores no entregan el neto: dan una TARIFA y una regla para
// sacar la base comisionable. La comisión es nuestra ganancia, así que el
// NETO (lo que le pagamos al proveedor = lo que montamos) = Tarifa − comisión.
//
//   base_comisionable =
//     · 'pct'      → Tarifa × (1 − pct/100)     (ej. Tarifa − 3%)
//     · 'impuesto' → Tarifa − impuesto (monto)  (ej. Tarifa − impuestos)
//     · 'ninguno'  → Tarifa                     (no se resta nada)
//   comision = base_comisionable × (pct_comision/100)
//   neto     = Tarifa − comision   ← lo que se monta (luego: MK + asistencia + fee)
// ─────────────────────────────────────────────────────────────────────────

export type ModoBaseComisionable = "pct" | "impuesto" | "ninguno";

export type CalcProgramaInput = {
  tarifa: number;
  modo: ModoBaseComisionable;
  valor: number;          // pct (modo 'pct') o monto del impuesto (modo 'impuesto')
  pctComision: number;    // % de comisión sobre la base
};

export type CalcProgramaResult = {
  baseComisionable: number;
  comision: number;
  neto: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calcularNetoPrograma(input: CalcProgramaInput): CalcProgramaResult {
  const tarifa = Number(input.tarifa) || 0;
  const valor = Number(input.valor) || 0;
  const pctCom = Number(input.pctComision) || 0;

  let base = tarifa;
  if (input.modo === "pct") base = tarifa * (1 - valor / 100);
  else if (input.modo === "impuesto") base = tarifa - valor;
  // 'ninguno' → base = tarifa

  const comision = base * (pctCom / 100);
  const neto = tarifa - comision;
  return { baseComisionable: r2(base), comision: r2(comision), neto: r2(neto) };
}
