import { liquidarHotelNoches, toTemporadaRango, type TemporadaRango } from "@/lib/calc/paquetes";

// Oculta del tarifario las tarifas de HOTEL cuya vigencia de COMPRA ya venció.
// El tarifario_resultado es un snapshot congelado: el PVP no cambia, pero la
// tarifa neta solo es comprable mientras la vigencia de compra siga abierta. Al
// re-liquidar HOY, si una tarifa ya no liquida (vigencia vencida o sin tarifa),
// no debe seguir publicándose. Se evalúa en el servidor; el costo neto NUNCA
// sale al cliente (solo se usa el booleano "liquida / no liquida").

export type TempRow = {
  hotel_id: number; nombre: string; fecha_inicio: string | null; fecha_fin: string | null;
  prioridad: number | null; compra_inicio: string | null; compra_fin: string | null;
  tipo: string | null; descuento_valor: number | null; rangos: unknown; blackouts: unknown; min_noches: number | null;
};
export type TarRow = {
  hotel_id: number; tipo_habitacion: string | null; alimentacion: string | null; temporada: string | null;
  neto_sencilla: number | null; neto_doble: number | null; neto_triple: number | null; neto_multiple: number | null;
};

const ROOM_COLS: (keyof TarRow)[] = ["neto_sencilla", "neto_doble", "neto_triple", "neto_multiple"];

/**
 * Construye un verificador `vigenteHoy(hotelId, categoria, regimen, fechaIda, noches)`
 * que devuelve true si la tarifa todavía liquida hoy (al menos una acomodación de
 * habitación, con la vigencia de compra abierta). Cachea por combo.
 */
export function buildVigenciaChecker(temps: TempRow[], tarifas: TarRow[]) {
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
  return function vigenteHoy(
    hotelId: number, categoria: string | null, regimen: string | null, fechaIda: string, numNoches: number
  ): boolean {
    const ck = `${hotelId}|${categoria ?? ""}|${regimen ?? ""}|${fechaIda}|${numNoches}`;
    const hit = cache.get(ck);
    if (hit !== undefined) return hit;
    const temporadas = tempsByHotel.get(hotelId) ?? [];
    const tempMap = grupos.get(`${hotelId}|||${categoria ?? ""}|||${regimen ?? ""}`);
    let ok = false;
    if (tempMap && temporadas.length && numNoches > 0) {
      for (const col of ROOM_COLS) {
        const netoPorTemporada: Record<string, number | null> = {};
        for (const [temp, row] of tempMap) { const v = row[col]; netoPorTemporada[temp] = v == null ? null : Number(v); }
        const c = liquidarHotelNoches({ fechaIda, numNoches, temporadas, netoPorTemporada });
        if (c != null && c > 0) { ok = true; break; }
      }
    }
    cache.set(ck, ok);
    return ok;
  };
}
