import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
// Import RELATIVO (no `@/lib/calc/paquetes`) a propósito: `@/` es un alias
// que solo resuelve Next.js/TypeScript en build — bajo `node --test` plano
// (sin loader de paths) revienta con `ERR_MODULE_NOT_FOUND` en cuanto un
// import de VALOR (no `import type`, que se elimina con
// `--experimental-strip-types`) lo usa. `lib/calc/paquetes.ts` no tiene
// dependencias propias, así que el relativo es 100% equivalente en tiempo
// de build — pero deja este archivo testeable con ejecución real, mismo
// patrón que ya usan otros módulos puros de este directorio.
import { liquidarHotelNoches, liquidarHotelMasBarato, toTemporadaRango, type TemporadaRango } from "../calc/paquetes.ts";

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

// Predicado de "fila de hotel verificable" — la MISMA condición que arma
// `hotelFilas` abajo. Extraída para poder reusarla como filtro de exclusión
// en el camino de fallo cerrado (ver `error` más abajo) sin recorrer el
// array dos veces con criterios que puedan divergir.
export function esFilaHotelVerificable<T extends FilaConVigencia>(f: T): boolean {
  return (f.modulo === "bloqueo" || f.modulo === "porcion_terrestre") && f.hotel_id != null && !!f.fecha_ida;
}

export type ResultadoVigencia<T> = {
  filas: T[];
  /**
   * `null` si no hubo error. Si `hotel_temporadas`/`tarifa_hotel` fallaron
   * técnicamente, el error CRUDO de la primera de las dos que falló (para
   * que el caller pueda sanearlo con `registrarErrorTecnico()` — esta
   * función nunca imprime nada, no tiene `flujo`/`flujoId`). `filas` YA
   * viene fail-closed en ese caso (ver abajo).
   */
  error: unknown;
};

/**
 * Filtra del tarifario las filas de hotel (bloqueo y porción) cuya vigencia de
 * compra ya venció. Lee temporadas/tarifas con el cliente service-role (interno).
 * Las filas que no son de hotel (servicios) pasan tal cual.
 *
 * ⚠️ Revisión posterior — defecto "RESULTADOS OK FALSOS" confirmado:
 * `hotel_temporadas`/`tarifa_hotel` (las dos consultas nombradas explícitamente
 * en la revisión) se leían con `const [{data:temps},{data:tars}] = await
 * Promise.all(...)`, descartando `error`. Si CUALQUIERA de las dos fallaba
 * técnicamente, `temps`/`tars` quedaban `undefined` → `?? []` → el checker se
 * construía vacío → CUALQUIER fila de hotel "no liquidaba" → se ocultaban
 * TODAS las filas de hotel. Es el mismo resultado (fail-closed) que ya
 * produce el camino normal cuando de verdad no hay vigencia — la app
 * quedaba accidentalmente segura, pero sin que la medición pudiera saber
 * que fue un ERROR TÉCNICO y no "ninguna tarifa vigente". Ahora el fail-
 * closed es EXPLÍCITO (misma exclusión, vía `esFilaHotelVerificable`) y se
 * expone `error: true` para que el caller marque la etapa como
 * resultado=error en vez de "ok".
 */
export async function filtrarTarifarioVencidas<T extends FilaConVigencia>(
  admin: SupabaseClient<Database>, filas: T[]
): Promise<ResultadoVigencia<T>> {
  const hotelFilas = filas.filter(esFilaHotelVerificable);
  const hIds = [...new Set(hotelFilas.map((f) => f.hotel_id as number))];
  if (!hIds.length) return { filas, error: null };

  const [{ data: temps, error: e1 }, { data: tars, error: e2 }] = await Promise.all([
    admin.from("hotel_temporadas").select("hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts, min_noches, regimen_restringido").in("hotel_id", hIds),
    admin.from("tarifa_hotel").select("hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple").in("hotel_id", hIds),
  ]);
  if (e1 || e2) {
    // Fallo cerrado EXPLÍCITO: no se puede verificar vigencia → se ocultan
    // las filas de hotel verificables (mismo criterio que ya usaba el
    // camino "sin vigencia real", ahora sin depender de que `?? []` lo
    // produzca por accidente).
    return { filas: filas.filter((f) => !esFilaHotelVerificable(f)), error: e1 ?? e2 };
  }
  const chk = buildVigenciaChecker((temps ?? []) as TempRow[], (tars ?? []) as TarRow[]);

  const filtradas = filas.filter((f) => {
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
  return { filas: filtradas, error: null };
}
