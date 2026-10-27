// #64 — Código IATA del DESTINO de un hotel, tomado del CATÁLOGO (nunca inferido del nombre del hotel ni escrito a mano).
//
// Orden: 1) `destinos.codigo_iata` del destino con ese nombre exacto (si es un código de 3 letras y no hay dos filas que digan cosas distintas);
//        2) el catálogo estático de ciudades (`lib/iata.ts`, coincidencia exacta y única);
//        3) nada: quien llama debe pedir que se corrija el dato en Producto → Destinos.
import type { SupabaseClient } from "@supabase/supabase-js";
import { codigoIataDeCiudad, esCodigoIata } from "@/lib/iata";

export async function iataDeDestino(
  sb: SupabaseClient<any, any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  nombre: string | null | undefined,
): Promise<string | null> {
  const n = (nombre ?? "").trim();
  if (!n) return null;
  const { data } = await sb.from("destinos").select("codigo_iata").eq("nombre", n);
  const codigos = new Set(
    ((data ?? []) as { codigo_iata: string | null }[]).map((f) => (f.codigo_iata ?? "").trim().toUpperCase()).filter((c) => esCodigoIata(c)),
  );
  if (codigos.size === 1) return [...codigos][0];
  if (codigos.size > 1) return null; // el catálogo se contradice: no se elige uno al azar
  return codigoIataDeCiudad(n);
}
