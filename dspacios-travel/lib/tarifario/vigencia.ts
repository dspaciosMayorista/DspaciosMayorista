import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { liquidarHotelNoches, liquidarHotelMasBarato, toTemporadaRango, type TemporadaRango } from "@/lib/calc/paquetes";

// Oculta del tarifario las tarifas de HOTEL cuya vigencia de COMPRA ya venció.
// El tarifario_resultado es un snapshot congelado: el PVP no cambia, pero la
// tarifa neta solo es comprable mientras la vigencia de compra siga abierta. Al
// re-liquidar HOY, si una tarifa ya no liquida (vigencia vencida o sin tarifa),
// no debe seguir apareciendo. Se evalúa en el servidor; el costo neto NUNCA sale
// al cliente (solo el booleano "liquida / no liquida").

export type TempRow = {
  hotel_id: number; nombre: string; fecha_inicio: string | null; fecha_fin: string | null;
  prioridad: number | null; compra_inicio: string | null; compra_fin: string | null;
  tipo: string | null; descuento_valor: number | null; rangos: unknown; blackouts: unknown; min_noches: number | null;
  regimen_restringido: string | null;
};
export type TarRow = {
  hotel_id: number; tipo_habitacion: string | null; alimentacion: string | null; temporada: string | null;
  neto_sencilla: number | null; neto_doble: number | null; neto_triple: number | null; neto_multiple: number | null;
};

const ROOM_COLS: (keyof TarRow)[] = ["neto_sencilla", "neto_doble", "neto_triple", "neto_multiple"];

// Construye los verificadores de vigencia (cachean por combo).
// - `bloqueo`: fecha fija (liquida esas noches exactas).
// - `rango`: porción/dinámico (basta que UNA noche de la ventana siga vigente).
function buildVigenciaChecker(temps: TempRow[], tarifas: TarRow[]) {
  const tempsByHotel = new Map<number, TemporadaRango[]>();
  for (const t of temps) {
    const arr = tempsByHotel.get(t.hotel_id) ?? [];
    arr.push(toTemporadaRango(t));
    tempsByHotel.set(t.hotel_id, arr);
  }
  // (hotel|||cat|||reg) -> temporada -> fila de tarifa
  const grupos = new Map<string, Map<string, TarRow>>();
  for (const r of tarifas) {
    const key = `${r.hotel_id}|||${r.tipo_habitacion ?? ""}|||${r.alimentacion ?? ""}`;
    const m = grupos.get(key) ?? new Map<string, TarRow>();
    m.set(r.temporada ?? "", r);
    grupos.set(key, m);
  }
  const cache = new Map<string, boolean>();
  const netoMap = (tempMap: Map<string, TarRow>, col: keyof TarRow): Record<string, number | null> => {
    const out: Record<string, number | null> = {};
    for (const [temp, row] of tempMap) { const v = row[col]; out[temp] = v == null ? null : Number(v); }
    return out;
  };
  return {
    bloqueo(hotelId: number, categoria: string | null, regimen: string | null, fechaIda: string, numNoches: number): boolean {
      const ck = `b|${hotelId}|${categoria ?? ""}|${regimen ?? ""}|${fechaIda}|${numNoches}`;
      const hit = cache.get(ck); if (hit !== undefined) return hit;
      const temporadas = tempsByHotel.get(hotelId) ?? [];
      const tempMap = grupos.get(`${hotelId}|||${categoria ?? ""}|||${regimen ?? ""}`);
      let ok = false;
      if (tempMap && temporadas.length && numNoches > 0) {
        for (const col of ROOM_COLS) {
          const c = liquidarHotelNoches({ fechaIda, numNoches, temporadas, netoPorTemporada: netoMap(tempMap, col), regimen: regimen ?? undefined });
          if (c != null && c > 0) { ok = true; break; }
        }
      }
      cache.set(ck, ok); return ok;
    },
    rango(hotelId: number, categoria: string | null, regimen: string | null, desde: string, hasta: string, numNoches: number): boolean {
      const ck = `r|${hotelId}|${categoria ?? ""}|${regimen ?? ""}|${desde}|${hasta}|${numNoches}`;
      const hit = cache.get(ck); if (hit !== undefined) return hit;
      const temporadas = tempsByHotel.get(hotelId) ?? [];
      const tempMap = grupos.get(`${hotelId}|||${categoria ?? ""}|||${regimen ?? ""}`);
      let ok = false;
      if (tempMap && temporadas.length && numNoches > 0) {
        for (const col of ROOM_COLS) {
          const c = liquidarHotelMasBarato({ desde, hasta, numNoches, temporadas, netoPorTemporada: netoMap(tempMap, col), regimen: regimen ?? undefined });
          if (c != null && c > 0) { ok = true; break; }
        }
      }
      cache.set(ck, ok); return ok;
    },
  };
}

type FilaConVigencia = {
  modulo: string; hotel_id?: number | null; categoria?: string | null; regimen?: string | null;
  fecha_ida?: string | null; fecha_regreso?: string | null; noches?: number | null;
};

/**
 * Filtra del tarifario las filas de hotel (bloqueo y porción) cuya vigencia de
 * compra ya venció. Lee temporadas/tarifas con el cliente service-role (interno).
 * Las filas que no son de hotel (servicios) pasan tal cual.
 */
export async function filtrarTarifarioVencidas<T extends FilaConVigencia>(
  admin: SupabaseClient<Database>, filas: T[]
): Promise<T[]> {
  const hotelFilas = filas.filter((f) =>
    (f.modulo === "bloqueo" || f.modulo === "porcion_terrestre") && f.hotel_id != null && !!f.fecha_ida
  );
  const hIds = [...new Set(hotelFilas.map((f) => f.hotel_id as number))];
  if (!hIds.length) return filas;

  const [{ data: temps }, { data: tars }] = await Promise.all([
    admin.from("hotel_temporadas").select("hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts, min_noches, regimen_restringido").in("hotel_id", hIds),
    admin.from("tarifa_hotel").select("hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple").in("hotel_id", hIds),
  ]);
  const chk = buildVigenciaChecker((temps ?? []) as TempRow[], (tars ?? []) as TarRow[]);

  return filas.filter((f) => {
    if (f.hotel_id == null || !f.fecha_ida) return true;
    if (f.modulo === "bloqueo") {
      if (!f.noches) return true;
      return chk.bloqueo(f.hotel_id, f.categoria ?? null, f.regimen ?? null, f.fecha_ida, f.noches);
    }
    if (f.modulo === "porcion_terrestre") {
      return chk.rango(f.hotel_id, f.categoria ?? null, f.regimen ?? null, f.fecha_ida, f.fecha_regreso ?? f.fecha_ida, f.noches ?? 1);
    }
    return true;
  });
}
