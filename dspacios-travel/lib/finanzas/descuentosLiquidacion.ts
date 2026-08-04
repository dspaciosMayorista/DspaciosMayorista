// Descuentos aplicados a la liquidación de comisión de un asesor interno en
// un mes puntual (migración 132, `liquidacion_descuentos`) — ej. un
// descuento que el asesor le dio al cliente y que sale de su propia
// comisión. Se restan de la comisión neta calculada por `comisionMes()`.

export type DescuentoLiquidacion = {
  id: number;
  usuario_id: string;
  mes: string;
  valor: number;
  descripcion: string | null;
  numero_contrato: string | null;
};

export function sumarDescuentosPorAsesor(
  descuentos: { usuario_id: string; valor: number }[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of descuentos) {
    out[d.usuario_id] = (out[d.usuario_id] ?? 0) + (Number(d.valor) || 0);
  }
  return out;
}
