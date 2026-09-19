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

// ── Cliente falso que imita el comportamiento REAL de PostgREST ─────────────
// Dos detalles que importan para este defecto:
//   1. Aplica el `.in(col, vals)` de verdad (como PostgREST), así el fixture no
//      puede "colar" filas que la consulta real nunca devolvería.
//   2. `maxRowsSinRango` simula el "Max Rows" del proyecto (Settings → API):
//      una consulta SIN `.range()` devuelve como máximo esas filas y **trunca
//      en silencio** (sin `error`) — exactamente el comportamiento que causa el
//      defecto. Una consulta CON `.range(from, hasta)` devuelve esa página.
// El builder es "thenable" en cualquier punto de la cadena, igual que el de
// Supabase, así sirve tanto para una consulta sin `.range()` (código viejo)
// como para el bucle paginado (código nuevo).
function clienteFalso(opts: {
  temporadas?: unknown[]; tarifas?: unknown[];
  errorTemporadas?: unknown; errorTarifas?: unknown;
  maxRowsSinRango?: number;
  /** Falla SOLO a partir de esta página (1-based) de `tarifa_hotel` — para
   * probar que un error en una página POSTERIOR también aborta. */
  errorTarifasEnPagina?: number;
}) {
  const filasPorTabla: Record<string, Record<string, unknown>[]> = {
    hotel_temporadas: (opts.temporadas ?? []) as Record<string, unknown>[],
    tarifa_hotel: (opts.tarifas ?? []) as Record<string, unknown>[],
  };
  const maxRows = opts.maxRowsSinRango ?? Number.POSITIVE_INFINITY;
  const paginasPedidas: Record<string, number> = { hotel_temporadas: 0, tarifa_hotel: 0 };
  const sb = {
    from(tabla: string) {
      if (!(tabla in filasPorTabla)) throw new Error(`tabla inesperada: ${tabla}`);
      const filtros: { col: string; vals: unknown[] }[] = [];
      let rango: [number, number] | null = null;
      const construir = () => {
        paginasPedidas[tabla]++;
        const fallaAqui = opts.errorTarifasEnPagina != null && tabla === "tarifa_hotel" && paginasPedidas[tabla] >= opts.errorTarifasEnPagina;
        const error = tabla === "hotel_temporadas" ? (opts.errorTemporadas ?? null) : (fallaAqui ? (opts.errorTarifas ?? ERROR_FAKE) : (opts.errorTarifas ?? null));
        if (error) return { data: null, error };
        const filtradas = filasPorTabla[tabla].filter((f) => filtros.every(({ col, vals }) => vals.includes(f[col])));
        const data = rango ? filtradas.slice(rango[0], rango[1] + 1) : filtradas.slice(0, maxRows);
        return { data, error: null };
      };
      const q = {
        select: () => q,
        in: (col: string, vals: unknown[]) => { filtros.push({ col, vals }); return q; },
        order: () => q,
        range: (from: number, hasta: number) => { rango = [from, hasta]; return q; },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(construir()).then(res, rej),
      };
      return q;
    },
    // Contadores de round-trips por tabla — solo para las aserciones de esta
    // suite (el código de producción los ignora: el cast a SupabaseClient los
    // vuelve invisibles).
    paginas: paginasPedidas,
    filasPorTabla,
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

// ─────────────────────────────────────────────────────────────────────────
// REGRESIÓN — caso real TAMACÁ BEACH RESORT (paquete 53 / hotel 57)
//
// Causa demostrada: las DOS lecturas auxiliares de `filtrarTarifarioVencidas`
// (`hotel_temporadas` y `tarifa_hotel`) se hacían con UN solo `.select()` sin
// `.range()`. PostgREST aplica el "Max Rows" del proyecto y TRUNCA EN SILENCIO
// (sin `error`): si las filas de PA/PC del hotel quedan fuera del primer bloque
// y la de PAM entra, `buildVigenciaChecker` no encuentra tarifa materializada
// para PA/PC → no liquidan → `filtrarTarifarioVencidas` las elimina. El modal
// solo puede ofrecer lo que el resumen trae: PAM.
//
// Estos tests usan un cliente falso que imita ese truncado
// (`maxRowsSinRango`) y FALLAN con la lectura no paginada.
// ─────────────────────────────────────────────────────────────────────────

const HOTEL_TAMACA = 57;
const CAT_TAMACA = "Superior Vista al Mar";
const TEMP_TAMACA = "ALTA FIN DE AÑO 2026 - 2027";
const REGS_TAMACA = ["PA", "PAM", "PC"];

// Vigencia real verificada con SQL: ALTA FIN DE AÑO 2026-2027, viaje
// 2026-12-30 → 2027-01-02, min_noches 3, compra 2026-08-31 → 2027-01-11,
// sin blackouts ni regimen_restringido.
const TEMPORADA_TAMACA = {
  hotel_id: HOTEL_TAMACA, nombre: TEMP_TAMACA,
  fecha_inicio: "2026-12-21", fecha_fin: "2027-01-11",
  prioridad: 1, compra_inicio: "2026-08-31", compra_fin: "2027-01-11",
  tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null,
  min_noches: 3, regimen_restringido: null,
};

function tarifaTamaca(regimen: string, id: number) {
  return {
    id, hotel_id: HOTEL_TAMACA, tipo_habitacion: CAT_TAMACA, alimentacion: regimen, temporada: TEMP_TAMACA,
    neto_sencilla: 900000, neto_doble: 700000, neto_triple: 620000, neto_multiple: 560000,
  };
}

function filaTamaca(regimen: string, id: number, modulo = "bloqueo"): Fila {
  return {
    modulo, hotel_id: HOTEL_TAMACA, categoria: CAT_TAMACA, regimen,
    fecha_ida: "2026-12-30", fecha_regreso: "2027-01-02", noches: 3, id,
  };
}

// Filas "ajenas" suficientes para agotar el primer bloque de 1000 ANTES de las
// tarifas de Tamacá (simula el Max Rows del proyecto con el catálogo real, que
// ya supera las 1000 filas).
const AJENAS_TARIFA = 999;
function tarifasAjenas(): Record<string, unknown>[] {
  return Array.from({ length: AJENAS_TARIFA }, (_, i) => ({
    id: 1 + i, hotel_id: 1000 + i, tipo_habitacion: "Estandar", alimentacion: "PC", temporada: "ALTA",
    neto_sencilla: 100000, neto_doble: 90000, neto_triple: 80000, neto_multiple: 70000,
  }));
}
function filasAjenas(): Fila[] {
  return Array.from({ length: AJENAS_TARIFA }, (_, i) => ({
    modulo: "bloqueo", hotel_id: 1000 + i, categoria: "Estandar", regimen: "PC",
    fecha_ida: "2026-12-30", fecha_regreso: "2027-01-02", noches: 3, id: 100 + i,
  }));
}
const MAX_ROWS = 1000;

describe("REGRESIÓN Tamacá — la lectura de `tarifa_hotel` truncada perdía PA/PC", () => {
  // Layout del fixture (orden físico = orden de la consulta):
  //   [0..998]   999 tarifas ajenas   → entran en el primer bloque
  //   [999]      Tamacá PAM           → entra (fila 1000)
  //   [1000]     Tamacá PA            → queda fuera del bloque
  //   [1001]     Tamacá PC            → queda fuera del bloque
  const tarifas = [...tarifasAjenas(), tarifaTamaca("PAM", 5001), tarifaTamaca("PA", 5002), tarifaTamaca("PC", 5003)];
  const filas = [...filasAjenas(), ...REGS_TAMACA.map((r, i) => filaTamaca(r, 900 + i))];

  test("con la respuesta truncada a 1000 filas, las TRES (PA, PAM y PC) siguen liquidando", async () => {
    const sb = clienteFalso({ temporadas: [TEMPORADA_TAMACA], tarifas, maxRowsSinRango: MAX_ROWS });
    const r = await filtrarTarifarioVencidas(sb, filas);
    const regsTamaca = r.filas.filter((f) => f.hotel_id === HOTEL_TAMACA).map((f) => f.regimen);
    assert.deepEqual([...regsTamaca].sort(), ["PA", "PAM", "PC"], "las TRES deben sobrevivir al filtro de vigencia");
    assert.equal(r.error, null);
    // Trazabilidad del volumen simulado: 1002 filas de `tarifa_hotel` (999
    // ajenas + PA/PAM/PC de Tamacá) se leen en 3 round-trips de 1000 (las dos
    // últimas, una con las 2 filas que quedan y otra vacía que cierra el bucle).
    // Con la lectura vieja SIN paginar era 1 round-trip truncado a 1000 filas.
    assert.equal((sb as unknown as { paginas: Record<string, number> }).paginas.tarifa_hotel, 3, "3 páginas para 1002 filas");
    assert.equal(filas.filter((f) => f.hotel_id === HOTEL_TAMACA).length, 3, "el resumen trae las 3 filas de Tamacá");
  });

  test("las filas no hoteleras siguen pasando con el catálogo truncado", async () => {
    const sb = clienteFalso({ temporadas: [TEMPORADA_TAMACA], tarifas, maxRowsSinRango: MAX_ROWS });
    const r = await filtrarTarifarioVencidas(sb, [...filasAjenas(), filaServicio(7777), ...REGS_TAMACA.map((x, i) => filaTamaca(x, 900 + i))]);
    assert.ok(r.filas.some((f) => f.modulo === "servicios" && f.id === 7777), "una fila de servicios nunca se filtra por vigencia");
    assert.equal(r.error, null);
  });

  test("misma protección para el camino de PORCIÓN TERRESTRE (usa `rango`, no `bloqueo`)", async () => {
    const filasPorcion: Fila[] = REGS_TAMACA.map((reg, i) => filaTamaca(reg, 950 + i, "porcion_terrestre"));
    const sb = clienteFalso({ temporadas: [TEMPORADA_TAMACA], tarifas, maxRowsSinRango: MAX_ROWS });
    const r = await filtrarTarifarioVencidas(sb, [...filasAjenas(), ...filasPorcion]);
    assert.deepEqual(r.filas.filter((f) => f.hotel_id === HOTEL_TAMACA).map((f) => f.regimen).sort(), ["PA", "PAM", "PC"]);
  });
});

describe("REGRESIÓN — la lectura de `hotel_temporadas` también se pagina", () => {
  // La temporada de Tamacá va AL FINAL de un set que, ya FILTRADO por
  // `.in(hotel_id, hIds)`, supera el Max Rows: con la lectura truncada no llega,
  // y entonces NINGUNA de sus tres filas liquida (se pierden PA, PAM y PC).
  const HOTELES_AJENOS_TEMPORADA = 1000; // 1000 temporadas ajenas + la de Tamacá = 1001 > Max Rows
  const temporadas = [
    ...Array.from({ length: HOTELES_AJENOS_TEMPORADA }, (_, i) => ({ ...TEMPORADA_TAMACA, hotel_id: 1000 + i, nombre: "ALTA" })),
    TEMPORADA_TAMACA,
  ];
  // El resumen debe incluir esos hoteles ajenos: son ellos los que hacen que el
  // `.in(hotel_id, hIds)` de la consulta real devuelva más de Max Rows.
  const filas = [
    ...Array.from({ length: HOTELES_AJENOS_TEMPORADA }, (_, i) => ({ ...filaTamaca("PC", 200 + i), hotel_id: 1000 + i, categoria: "Estandar" })),
    ...REGS_TAMACA.map((r, i) => filaTamaca(r, 900 + i)),
  ];
  const tarifas = REGS_TAMACA.map((r, i) => tarifaTamaca(r, 5001 + i));

  test("con la temporada fuera del primer bloque, las tres filas de Tamacá sobreviven igual", async () => {
    assert.equal(temporadas.length, MAX_ROWS + 1, "el fixture supera el Max Rows");
    const sb = clienteFalso({ temporadas, tarifas, maxRowsSinRango: MAX_ROWS });
    const r = await filtrarTarifarioVencidas(sb, filas);
    assert.deepEqual(r.filas.filter((f) => f.hotel_id === HOTEL_TAMACA).map((f) => f.regimen).sort(), ["PA", "PAM", "PC"]);
    assert.equal(r.error, null);
    // 1001 temporadas (1000 ajenas + la de Tamacá, la última) en 3 round-trips.
    assert.equal((sb as unknown as { paginas: Record<string, number> }).paginas.hotel_temporadas, 3, "3 páginas para 1001 temporadas");
  });
});

describe("Error en una página POSTERIOR (no en la primera): también aborta y fail-closed", () => {
  test("falla la 2ª página de `tarifa_hotel` con >1000 filas: error != null y las filas de hotel quedan ocultas", async () => {
    const tarifas = [...tarifasAjenas(), ...REGS_TAMACA.map((r, i) => tarifaTamaca(r, 5001 + i))];
    const sb = clienteFalso({ temporadas: [TEMPORADA_TAMACA], tarifas, errorTarifasEnPagina: 2 });
    const r = await filtrarTarifarioVencidas(sb, [...filasAjenas(), filaServicio(7777), filaTamaca("PAM", 901)]);
    assert.ok(r.error != null, "un error en cualquier página debe propagarse como error técnico");
    assert.deepEqual(r.filas, [filaServicio(7777)], "fail-closed: ninguna fila de hotel verificable sobrevive");
  });
});

describe("Casos de negocio del chequeo de vigencia (se conservan explícitos)", () => {
  test("tarifa SIN vigencia válida se filtra (compra vencida hace meses)", async () => {
    const vencida = { ...TEMPORADA_TAMACA, compra_inicio: "2025-01-01", compra_fin: "2025-06-30" };
    const sb = clienteFalso({ temporadas: [vencida], tarifas: REGS_TAMACA.map((r, i) => tarifaTamaca(r, 5001 + i)) });
    const r = await filtrarTarifarioVencidas(sb, [filaTamaca("PA", 901), filaServicio(7777)]);
    assert.equal(r.error, null);
    assert.deepEqual(r.filas, [filaServicio(7777)], "la vigencia de compra vencida oculta la fila de hotel");
  });

  test("vigencia SIN fila materializada se filtra (no se inventan tarifas desde la temporada)", async () => {
    // Hay temporada, pero `tarifa_hotel` no tiene el combo PA de ese hotel.
    const sb = clienteFalso({ temporadas: [TEMPORADA_TAMACA], tarifas: [tarifaTamaca("PAM", 5001)] });
    const r = await filtrarTarifarioVencidas(sb, [filaTamaca("PA", 901), filaTamaca("PAM", 902)]);
    assert.deepEqual(r.filas.map((f) => f.regimen), ["PAM"], "PA no tiene fila materializada → se filtra; no se sintetiza");
  });

  test("no hay mezcla entre categoría ni régimen: la tarifa de otra categoría o temporada no presta vigencia", async () => {
    const otras = [
      { ...tarifaTamaca("PA", 6001), tipo_habitacion: "Estandar" },   // misma temporada, OTRA categoría
      { ...tarifaTamaca("PAM", 6002), temporada: "OTRA TEMPORADA" },  // misma categoría, OTRA temporada
    ];
    const sb = clienteFalso({ temporadas: [TEMPORADA_TAMACA], tarifas: otras });
    const r = await filtrarTarifarioVencidas(sb, [filaTamaca("PA", 901), filaTamaca("PAM", 902)]);
    assert.deepEqual(r.filas, [], "ninguna de las dos combinaciones tiene tarifa propia → ambas se filtran");
  });

  test("referencia sin truncar: con el catálogo completo las tres se conservan igual", async () => {
    const tarifas = REGS_TAMACA.map((r, i) => tarifaTamaca(r, 5001 + i));
    const sb = clienteFalso({ temporadas: [TEMPORADA_TAMACA], tarifas });
    const r = await filtrarTarifarioVencidas(sb, REGS_TAMACA.map((r, i) => filaTamaca(r, 900 + i)));
    assert.deepEqual(r.filas.map((f) => f.regimen).sort(), ["PA", "PAM", "PC"]);
    assert.equal(r.error, null);
  });
});
