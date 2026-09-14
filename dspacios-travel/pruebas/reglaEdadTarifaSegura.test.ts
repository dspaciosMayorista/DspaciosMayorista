import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  resolverReglaEdadEstadiaSegura,
  type FilaTarifaHotelEdadCruda,
} from "../lib/calc/reglaEdadTarifa.ts";

// ─────────────────────────────────────────────────────────────────────────
// `resolverReglaEdadEstadiaSegura` — el resolutor FAIL-CLOSED compartido por
// `computo.ts` (reserva/checkout) y `cotizar.ts` (búsqueda pública/
// sugerencias) para resolver la regla de edad efectiva a partir de filas
// CRUDAS de `tarifa_hotel` ya cargadas (nunca una consulta nueva por
// combinación). Cubre los 3 hallazgos de la ronda: (1) búsqueda pública debe
// usar la regla EFECTIVA, no el umbral general del hotel; (3) fallos
// técnicos/fila faltante/duplicada/override parcial deben fallar cerrado,
// nunca colapsar al fallback general.
// ─────────────────────────────────────────────────────────────────────────

const GENERAL_DEFAULT = { infanteMin: null, infanteMax: 2, ninoMin: null, ninoMax: 10 };

function fila(overrides: Partial<FilaTarifaHotelEdadCruda> = {}): FilaTarifaHotelEdadCruda {
  return {
    tipo_habitacion: "Estandar", alimentacion: "PC", temporada: "ALTA",
    edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null,
    ...overrides,
  };
}

describe("1. Sin temporadas usadas → fallback general, sin buscar filas", () => {
  test("temporadasUsadas vacío → regla general normalizada, incluso con filas vacías", () => {
    const r = resolverReglaEdadEstadiaSegura({
      filas: [], categoria: "Estandar", regimen: "PC", temporadasUsadas: [], general: GENERAL_DEFAULT,
    });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.regla, { infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax: 10 });
  });
});

describe("2. Fila histórica con las 4 columnas NULL → usa fallback general", () => {
  test("override NULL en las 4 columnas de la única fila usada → cae al general, no al default fijo si el general está configurado", () => {
    const filas = [fila({ temporada: "ALTA" })]; // sin override
    const r = resolverReglaEdadEstadiaSegura({
      filas, categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"],
      general: { infanteMin: 0, infanteMax: 3, ninoMin: 4, ninoMax: 12 },
    });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.regla, { infanteMin: 0, infanteMax: 3, ninoMin: 4, ninoMax: 12 });
  });
});

describe("3. Override de la fila GANA sobre la regla general — búsqueda exacta usa override", () => {
  test("fila con override completo → se usa el override, NUNCA la regla general del hotel", () => {
    const filas = [fila({ temporada: "ALTA", edad_infante_min: 0, edad_infante_max: 1, edad_nino_min: 2, edad_nino_max: 9 })];
    const r = resolverReglaEdadEstadiaSegura({
      filas, categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"],
      general: { infanteMin: 0, infanteMax: 5, ninoMin: 6, ninoMax: 17 }, // muy distinta — si ganara, se notaría
    });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.regla, { infanteMin: 0, infanteMax: 1, ninoMin: 2, ninoMax: 9 });
  });
});

describe("4. Override MÁS AMPLIO permite clasificar un menor como infante que la regla general rechazaría como niño", () => {
  test("regla general: infanteMax=2; override de la fila usada: infanteMax=5 → un menor de 4 años es INFANTE bajo el override (más amplio)", () => {
    const filas = [fila({ temporada: "PROMO", edad_infante_min: 0, edad_infante_max: 5, edad_nino_min: 6, edad_nino_max: 12 })];
    const r = resolverReglaEdadEstadiaSegura({
      filas, categoria: "Estandar", regimen: "PC", temporadasUsadas: ["PROMO"],
      general: GENERAL_DEFAULT, // infanteMax 2
    });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.regla.infanteMax, 5, "el override amplía el rango de infante más allá del general");
      assert.ok(4 <= r.regla.infanteMax, "un menor de 4 años cae en infante bajo el override, no bajo el general");
    }
  });
});

describe("5. Override MÁS RESTRICTIVO excluye un caso que la regla general aceptaría", () => {
  test("regla general: ninoMax=10; override de la fila usada: ninoMax=6 → un menor de 8 años NO cae en niño bajo el override (más restrictivo)", () => {
    const filas = [fila({ temporada: "TEMPORADA_ESTRICTA", edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 6 })];
    const r = resolverReglaEdadEstadiaSegura({
      filas, categoria: "Estandar", regimen: "PC", temporadasUsadas: ["TEMPORADA_ESTRICTA"],
      general: GENERAL_DEFAULT, // ninoMax 10 — un menor de 8 sí calzaría acá
    });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.regla.ninoMax, 6, "el override restringe el rango de niño por debajo del general");
      assert.ok(8 > r.regla.ninoMax, "un menor de 8 años queda FUERA del rango de niño bajo el override restrictivo");
    }
  });
});

describe("6. Fail-closed — temporada usada sin fila cargada", () => {
  test("el liquidador afirma haber usado 'BAJA' pero no hay ninguna fila para (categoría/régimen/BAJA) → falla cerrado, nunca cae al general", () => {
    const filas = [fila({ temporada: "ALTA" })]; // solo ALTA, nunca BAJA
    const r = resolverReglaEdadEstadiaSegura({
      filas, categoria: "Estandar", regimen: "PC", temporadasUsadas: ["BAJA"], general: GENERAL_DEFAULT,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /No se encontró la fila de tarifa/);
  });

  test("también falla si la fila existe pero para otra categoría/régimen (no matchea)", () => {
    const filas = [fila({ temporada: "ALTA", tipo_habitacion: "Suite", alimentacion: "PC" })];
    const r = resolverReglaEdadEstadiaSegura({
      filas, categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"], general: GENERAL_DEFAULT,
    });
    assert.equal(r.ok, false);
  });
});

describe("7. Fail-closed — fila duplicada (misma categoría/régimen/temporada)", () => {
  test("dos filas para la misma (categoría/régimen/temporada) → configuración ambigua, falla cerrado", () => {
    const filas = [
      fila({ temporada: "ALTA", edad_infante_max: 2 }),
      fila({ temporada: "ALTA", edad_infante_max: 3 }), // duplicada, distinta
    ];
    const r = resolverReglaEdadEstadiaSegura({
      filas, categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"], general: GENERAL_DEFAULT,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Hay 2 filas de tarifa cargadas/);
  });

  test("falla cerrado incluso si las dos filas duplicadas son idénticas — la ambigüedad es estructural, no de contenido", () => {
    const filas = [fila({ temporada: "ALTA" }), fila({ temporada: "ALTA" })];
    const r = resolverReglaEdadEstadiaSegura({
      filas, categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"], general: GENERAL_DEFAULT,
    });
    assert.equal(r.ok, false);
  });
});

describe("8. Fail-closed — override PARCIAL pese al CHECK", () => {
  test("solo 2 de las 4 columnas con valor (defensivo, no debería pasar el CHECK SQL) → falla cerrado, nunca defaultea el resto a 0", () => {
    const filas = [fila({ temporada: "ALTA", edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: null, edad_nino_max: null })];
    const r = resolverReglaEdadEstadiaSegura({
      filas, categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"], general: GENERAL_DEFAULT,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /override de edad incompleto/);
  });

  test("solo 1 de las 4 columnas con valor → también falla cerrado", () => {
    const filas = [fila({ temporada: "ALTA", edad_nino_max: 9 })];
    const r = resolverReglaEdadEstadiaSegura({
      filas, categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"], general: GENERAL_DEFAULT,
    });
    assert.equal(r.ok, false);
  });
});

describe("9. Dos acomodaciones seleccionadas combinan sus temporadas — reglas iguales pasan, distintas fallan cerrado", () => {
  test("doble usó ALTA, triple usó MEDIA, ambas con la MISMA regla efectiva (sin override, mismo general) → pasa, unión sin bloquear", () => {
    const filas = [fila({ temporada: "ALTA" }), fila({ temporada: "MEDIA" })];
    const r = resolverReglaEdadEstadiaSegura({
      filas, categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA", "MEDIA"], general: GENERAL_DEFAULT,
    });
    assert.ok(r.ok);
  });

  test("doble usó ALTA (override infanteMax=1), triple usó MEDIA (override infanteMax=4) → reglas EFECTIVAS distintas, falla cerrado al combinar ambas", () => {
    const filas = [
      fila({ temporada: "ALTA", edad_infante_min: 0, edad_infante_max: 1, edad_nino_min: 2, edad_nino_max: 10 }),
      fila({ temporada: "MEDIA", edad_infante_min: 0, edad_infante_max: 4, edad_nino_min: 5, edad_nino_max: 10 }),
    ];
    const r = resolverReglaEdadEstadiaSegura({
      filas, categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA", "MEDIA"], general: GENERAL_DEFAULT,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /reglas de edad de niño\/infante distintas/);
  });

  test("solo UNA de las dos acomodaciones seleccionadas (ej. solo doble → solo ALTA) → nunca se contamina con la regla de MEDIA (que no se pidió)", () => {
    const filas = [
      fila({ temporada: "ALTA", edad_infante_min: 0, edad_infante_max: 1, edad_nino_min: 2, edad_nino_max: 10 }),
      fila({ temporada: "MEDIA", edad_infante_min: 0, edad_infante_max: 4, edad_nino_min: 5, edad_nino_max: 10 }),
    ];
    // Solo se pasa "ALTA" como usada (equivalente a haber seleccionado solo
    // la acomodación cuya identidad de temporada es ALTA) — MEDIA ni se mira.
    const r = resolverReglaEdadEstadiaSegura({
      filas, categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"], general: GENERAL_DEFAULT,
    });
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.regla.infanteMax, 1, "usa SOLO el override de ALTA, nunca se mezcla con MEDIA");
  });
});

describe("10. temporadasUsadas duplicado en el iterable se trata como un solo elemento", () => {
  test("pasar la misma temporada dos veces (ej. desde dos acomodaciones que comparten temporada) no la busca dos veces ni falla por 'duplicada'", () => {
    const filas = [fila({ temporada: "ALTA" })];
    const r = resolverReglaEdadEstadiaSegura({
      filas, categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA", "ALTA"], general: GENERAL_DEFAULT,
    });
    assert.ok(r.ok);
  });
});
