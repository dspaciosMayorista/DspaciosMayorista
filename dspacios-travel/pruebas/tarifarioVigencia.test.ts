import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { filtrarTarifarioVencidas } from "../lib/tarifario/vigencia.ts";

// EJECUCIÓN REAL (no grep) de lib/tarifario/vigencia.ts — revisión posterior,
// defecto "RESULTADOS OK FALSOS" confirmado: `hotel_temporadas`/
// `tarifa_hotel` (nombradas explícitamente en la revisión) se leían sin
// chequear `error` — un fallo técnico de cualquiera de las dos quedaba
// indistinguible de "sin vigencia real" (ambos terminan ocultando las filas
// de hotel). Ahora `filtrarTarifarioVencidas` devuelve `{filas, error}` — el
// fail-closed se mantiene EXACTO (mismas filas ocultas), pero `error`
// (el error crudo de Supabase, o `null` si no hubo) permite al caller
// loguear resultado=error en vez de "ok" y sanear el detalle técnico.
type Fila = {
  modulo: string; hotel_id?: number | null; categoria?: string | null; regimen?: string | null;
  fecha_ida?: string | null; fecha_regreso?: string | null; noches?: number | null; id: number;
};

function clienteFalso(opts: {
  temporadas?: unknown[]; tarifas?: unknown[];
  errorTemporadas?: unknown; errorTarifas?: unknown;
}) {
  const sb = {
    from(tabla: string) {
      return {
        select() {
          return this;
        },
        in() {
          if (tabla === "hotel_temporadas") {
            return Promise.resolve({ data: opts.errorTemporadas ? null : (opts.temporadas ?? []), error: opts.errorTemporadas ?? null });
          }
          if (tabla === "tarifa_hotel") {
            return Promise.resolve({ data: opts.errorTarifas ? null : (opts.tarifas ?? []), error: opts.errorTarifas ?? null });
          }
          throw new Error(`tabla inesperada: ${tabla}`);
        },
      };
    },
  };
  return sb as unknown as SupabaseClient<Database>;
}

const ERROR_FAKE = { code: "42501", message: "permission denied for table hotel_temporadas" };

function filaServicio(id: number): Fila {
  return { modulo: "servicios", id };
}
function filaHotelBloqueo(id: number, hotelId: number): Fila {
  return { modulo: "bloqueo", hotel_id: hotelId, categoria: "Estandar", regimen: "PC", fecha_ida: "2026-12-01", noches: 3, id };
}

describe("filtrarTarifarioVencidas() — sin filas de hotel verificables: no consulta nada, error=false", () => {
  test("solo filas de servicios: devuelve tal cual, sin llamar a Supabase", async () => {
    const sb = clienteFalso({});
    const filas = [filaServicio(1), filaServicio(2)];
    const r = await filtrarTarifarioVencidas(sb, filas);
    assert.equal(r.error, null);
    assert.deepEqual(r.filas, filas);
  });

  test("array vacío: devuelve vacío, error=false", async () => {
    const sb = clienteFalso({});
    const r = await filtrarTarifarioVencidas(sb, [] as Fila[]);
    assert.equal(r.error, null);
    assert.deepEqual(r.filas, []);
  });
});

describe("filtrarTarifarioVencidas() — ERROR técnico en hotel_temporadas o tarifa_hotel: fail-closed EXPLÍCITO + error=true", () => {
  test("error en hotel_temporadas: oculta TODAS las filas de hotel verificables, conserva servicios, error=true", async () => {
    const sb = clienteFalso({ errorTemporadas: ERROR_FAKE, tarifas: [] });
    const filas = [filaHotelBloqueo(1, 10), filaServicio(2), filaHotelBloqueo(3, 20)];
    const r = await filtrarTarifarioVencidas(sb, filas);
    assert.equal(r.error, ERROR_FAKE, "el error CRUDO debe llegar al caller, sin transformar — el saneo es responsabilidad de registrarErrorTecnico() en el caller");
    assert.deepEqual(r.filas, [filaServicio(2)], "las 2 filas de hotel deben quedar ocultas, la de servicios se conserva");
  });

  test("error en tarifa_hotel (la otra consulta nombrada en la revisión): mismo fail-closed, error=true", async () => {
    const sb = clienteFalso({ temporadas: [], errorTarifas: ERROR_FAKE });
    const filas = [filaHotelBloqueo(1, 10), filaServicio(2)];
    const r = await filtrarTarifarioVencidas(sb, filas);
    assert.ok(r.error != null);
    assert.deepEqual(r.filas, [filaServicio(2)]);
  });

  test("error en AMBAS consultas: mismo fail-closed, error=true (no se duplica ni se agrava el filtrado)", async () => {
    const sb = clienteFalso({ errorTemporadas: ERROR_FAKE, errorTarifas: ERROR_FAKE });
    const filas = [filaHotelBloqueo(1, 10), filaServicio(2)];
    const r = await filtrarTarifarioVencidas(sb, filas);
    assert.ok(r.error != null);
    assert.deepEqual(r.filas, [filaServicio(2)]);
  });

  test("fail-closed por error produce EXACTAMENTE el mismo resultado que 'sin temporadas cargadas' (comportamiento de negocio ya existente, ahora con error=true en vez de accidental)", async () => {
    const filas = [filaHotelBloqueo(1, 10), filaServicio(2)];

    const sbError = clienteFalso({ errorTemporadas: ERROR_FAKE });
    const rError = await filtrarTarifarioVencidas(sbError, filas);

    const sbSinDatos = clienteFalso({ temporadas: [], tarifas: [] }); // sin error, pero el hotel no tiene temporadas cargadas
    const rSinDatos = await filtrarTarifarioVencidas(sbSinDatos, filas);

    assert.deepEqual(rError.filas, rSinDatos.filas, "mismo set de filas visibles en ambos casos (fail-closed)");
    assert.ok(rError.error != null, "pero el caso de ERROR debe poder distinguirse para el log");
    assert.equal(rSinDatos.error, null, "el caso de negocio legítimo (sin temporadas) no es un error técnico");
  });
});

describe("filtrarTarifarioVencidas() — no cambia el resultado de negocio en el camino sin error (equivalencia con el comportamiento previo)", () => {
  test("una tarifa vigente sigue pasando; el shape sigue siendo {filas, error:false}", async () => {
    const sb = clienteFalso({
      temporadas: [{ hotel_id: 10, nombre: "ALTA", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null }],
      tarifas: [{ hotel_id: 10, tipo_habitacion: "Estandar", alimentacion: "PC", temporada: "ALTA", neto_sencilla: 100000, neto_doble: 90000, neto_triple: 80000, neto_multiple: 70000 }],
    });
    const filas = [filaHotelBloqueo(1, 10)];
    const r = await filtrarTarifarioVencidas(sb, filas);
    assert.equal(r.error, null);
    assert.deepEqual(r.filas, filas, "la tarifa liquida (neto>0) → la fila se conserva");
  });
});
