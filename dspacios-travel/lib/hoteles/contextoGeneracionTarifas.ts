import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { hoyISO, toTemporadaRango } from "@/lib/calc/paquetes";
import type { TarifaExistente } from "@/lib/calc/calculadoras";

// Lectura común de "Generar" y "Sustituir": calculadora, hotel, vigencias y
// filas actuales (la calculadora necesita las filas para no pisar promociones
// escritas a mano).
export async function contextoGeneracion(sb: Awaited<ReturnType<typeof createClient>>, hotelId: number) {
  const [{ data: calc }, { data: hotel }, { data: temporadas, error: errTemporadas }, { data: existentes, error: errExistentes }] = await Promise.all([
    sb.from("hotel_calculadora").select("tipo, params").eq("hotel_id", hotelId).maybeSingle(),
    sb.from("hoteles").select("adults_only").eq("id", hotelId).maybeSingle(),
    sb.from("hotel_temporadas")
      .select("nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts, min_noches, regimen_restringido")
      .eq("hotel_id", hotelId),
    sb.from("tarifa_hotel")
      .select("tipo_habitacion, alimentacion, temporada, precio_final_autoritativo, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante")
      .eq("hotel_id", hotelId),
  ]);
  const error = errTemporadas
    ? `No se pudieron leer las vigencias del hotel: ${errTemporadas.message}`
    : errExistentes ? `No se pudieron leer las tarifas actuales del hotel: ${errExistentes.message}` : null;
  const hoy = hoyISO();
  return {
    calc, adultsOnly: !!hotel?.adults_only, error, hoy,
    ctx: { vigencias: (temporadas ?? []).map(toTemporadaRango), hoy, tarifasExistentes: (existentes ?? []) as TarifaExistente[] },
  };
}
