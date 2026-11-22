import type { SupabaseClient } from "@supabase/supabase-js";
import type { AbonoReporte } from "./cobroUsdReporte";

// #126-A — abonos de una agencia para marcar qué contratos USD siguen con su total en pesos provisional.
// Pagina con `.range()` y avanza por las filas REALMENTE recibidas hasta una página vacía: el límite «Max rows» del proyecto trunca en silencio una lectura simple
// (misma regla que Conciliaciones/Libro diario) y un abono omitido marcaría como «provisional» un contrato ya cobrado por completo.
// identidad:n/a — solo lectura
export async function cargarAbonosParaReporte(sb: SupabaseClient, tenant: string): Promise<AbonoReporte[]> {
  const out: AbonoReporte[] = [];
  const PAGINA = 1000;
  for (let desde = 0; ; ) {
    const { data, error } = await sb.from("abonos").select("id, numero_contrato, valor_abono").eq("tenant", tenant).order("id").range(desde, desde + PAGINA - 1);
    if (error || !data || data.length === 0) break;
    out.push(...(data as AbonoReporte[]));
    desde += data.length;
  }
  return out;
}
