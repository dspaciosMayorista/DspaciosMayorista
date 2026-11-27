// #42 — recordatorios de cobro: solo lo que el cliente AÚN debe. PURO (sin I/O ni correo).
// Los pagos reales (abonos) cubren las cuotas de cada contrato EN ORDEN; una cuota ya cubierta no se recuerda y una cubierta a medias se recuerda solo por lo que falta,
// en la moneda de cobro del contrato. Un comprobante subido no es un pago (no entra aquí: solo se reciben abonos reales).
import { estadoDeCuotas } from "@/lib/calc/cuotas";

export type CuotaGuardada = { numero_contrato: string; orden: number; tipo: string; fecha_limite: string; monto: number };
export type FilaRecordatorio = { numero: string; tipo: string; fecha: string; faltante: number; moneda: "COP" | "USD"; parcial: boolean };

/**
 * @param todas   TODAS las cuotas de los contratos involucrados (el acumulado necesita el plan completo, no solo las que vencen).
 * @param pagados total pagado por contrato, en su moneda de cobro (sin entrada = 0).
 * @param monedas moneda de cobro por contrato (sin entrada = COP).
 * @param limite  ISO (YYYY-MM-DD): se recuerdan las cuotas con fecha límite ≤ limite que aún deban algo.
 */
export function recordatoriosDeCuotas(todas: readonly CuotaGuardada[], pagados: ReadonlyMap<string, number>, monedas: ReadonlyMap<string, "COP" | "USD">, limite: string): FilaRecordatorio[] {
  const porContrato = new Map<string, CuotaGuardada[]>();
  for (const c of todas) porContrato.set(c.numero_contrato, [...(porContrato.get(c.numero_contrato) ?? []), c]);
  const filas: FilaRecordatorio[] = [];
  for (const [numero, plan] of porContrato) {
    const ordenado = [...plan].sort((a, b) => a.orden - b.orden);
    const moneda = monedas.get(numero) ?? "COP";
    const estados = estadoDeCuotas(ordenado.map((p) => p.monto), pagados.get(numero) ?? 0, moneda);
    ordenado.forEach((c, i) => {
      if (c.fecha_limite <= limite && estados[i].faltante > 0) filas.push({ numero, tipo: c.tipo, fecha: c.fecha_limite, faltante: estados[i].faltante, moneda, parcial: estados[i].parcial });
    });
  }
  return filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero.localeCompare(b.numero));
}
