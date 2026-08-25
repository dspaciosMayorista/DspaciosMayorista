import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluarHotelPorFechas,
  candidatosFecha,
  generarSugerenciasFechas,
  addDiasISO,
  MAX_SUGERENCIAS_FECHAS,
  type DatosHotelPaquete,
  type FilaTemporadaHotelRaw,
  type FilaTarifaHotelRaw,
  type FilaBlackoutHotelRaw,
  type ComposicionSugerencia,
} from "../lib/reservar/liquidacionHotel.ts";
import { defaultAcomConfig } from "../lib/acomodaciones.ts";

// ───────────────────────────────────────────────────────────────────────────
// Vista Booking — orientación de fechas cuando el hotel elegido no tiene
// tarifa para la fecha pedida. `evaluarHotelPorFechas` es EXACTAMENTE la
// misma lógica que tenía `liquidarHotelPaquete` (cotizar.ts) antes de este
// refactor — extraída a un módulo puro para poder probarla con ejecución
// real (sin Supabase) y para reutilizarla en `generarSugerenciasFechas` sin
// duplicar la fórmula. `hoy` se pasa SIEMPRE explícito en estas pruebas —
// nunca se depende de la fecha real del sistema.
// ───────────────────────────────────────────────────────────────────────────

const HOY = "2026-01-01";

// Hotel de prueba: una temporada "ALTA" (1-15 sep), un hueco real sin
// temporada (16-30 sep, deliberado — nadie carga tarifa ahí), y una
// temporada "PUENTE" (1-10 oct) que exige mínimo 4 noches. `armadoHotel`
// nulo en algunas pruebas para confirmar el mismo fallback que tenía el
// código original (sin filtro de categoría/régimen, moneda COP).
function temporadaAlta(overrides: Partial<FilaTemporadaHotelRaw> = {}): FilaTemporadaHotelRaw {
  return {
    nombre: "ALTA", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-15",
    prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null,
    rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null,
    ...overrides,
  };
}
function temporadaPuente(overrides: Partial<FilaTemporadaHotelRaw> = {}): FilaTemporadaHotelRaw {
  return {
    nombre: "PUENTE", fecha_inicio: "2026-10-01", fecha_fin: "2026-10-10",
    prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null,
    rangos: [], blackouts: [], min_noches: 4, regimen_restringido: null,
    ...overrides,
  };
}
function tarifaPara(temporada: string, overrides: Partial<FilaTarifaHotelRaw> = {}): FilaTarifaHotelRaw {
  return {
    tipo_habitacion: "Estandar", alimentacion: "PC", temporada,
    neto_sencilla: 150_000, neto_doble: 100_000, neto_triple: null, neto_multiple: null,
    neto_nino: 50_000, neto_nino2: 30_000, neto_infante: 0,
    ...overrides,
  };
}

function baseDatos(overrides: Partial<DatosHotelPaquete> = {}): DatosHotelPaquete {
  return {
    paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2026-01-01", fecha_viaje_fin: "2026-12-31" },
    armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel Test", hotel_moneda: "COP" },
    temporadas: [temporadaAlta(), temporadaPuente()],
    tarifas: [tarifaPara("ALTA"), tarifaPara("PUENTE")],
    serviciosIncluidos: [],
    blackouts: [],
    ...overrides,
  };
}

describe("1. evaluarHotelPorFechas — camino feliz: idéntico al motor original", () => {
  test("noches dentro de ALTA con tarifa cargada → combos con precio marcado", () => {
    const r = evaluarHotelPorFechas(baseDatos(), "2026-09-05", 3);
    assert.ok(r);
    assert.equal(r!.combos.length, 1);
    assert.equal(r!.combos[0].categoria, "Estandar");
    assert.equal(r!.combos[0].regimen, "PC");
    // neto_doble=100000 × 3 noches = 300000; marcar(300000, 0.2) = 375000.
    assert.equal(r!.combos[0].precios["doble"], 375_000);
    assert.equal(r!.moneda, "COP");
  });
  test("noches en el HUECO sin temporada → 0 combos (nunca se asume tarifa por estar 'cerca' de una temporada)", () => {
    const r = evaluarHotelPorFechas(baseDatos(), "2026-09-20", 3);
    assert.ok(r);
    assert.equal(r!.combos.length, 0);
  });
});

describe("2. candidatosFecha — semillas ACOTADAS (nunca un barrido diario sin límite)", () => {
  test("incluye el inicio de cada temporada dentro de la ventana, nunca la fecha ya solicitada", () => {
    const cands = candidatosFecha(baseDatos(), "2026-09-20", "2026-01-01", "2026-12-31");
    assert.ok(cands.includes("2026-09-01"));
    assert.ok(cands.includes("2026-10-01"));
    assert.ok(!cands.includes("2026-09-20"));
  });
  test("está ordenado, sin duplicados y acotado (no crece sin límite con más temporadas)", () => {
    const muchas: FilaTemporadaHotelRaw[] = Array.from({ length: 200 }, (_, i) =>
      temporadaAlta({ nombre: `T${i}`, fecha_inicio: addDiasISO("2026-01-01", i), fecha_fin: addDiasISO("2026-01-01", i + 1) }));
    const datos = baseDatos({ temporadas: muchas });
    const cands = candidatosFecha(datos, "2026-01-01", "2026-01-01", "2026-12-31");
    assert.equal(new Set(cands).size, cands.length, "sin duplicados");
    const ordenado = [...cands].sort();
    assert.deepEqual(cands, ordenado, "debe venir ordenado ascendente");
    assert.ok(cands.length <= 60, `esperado <=60 candidatos acotados, hubo ${cands.length}`);
  });
});

describe("3. generarSugerenciasFechas — hallazgo obligatorio 1: fecha sin tarifa produce sugerencias válidas", () => {
  test("fecha en el hueco (sin tarifa) devuelve sugerencias reales; al menos una preserva la duración pedida", () => {
    const sugerencias = generarSugerenciasFechas({ datos: baseDatos(), fechaIdaSolicitada: "2026-09-20", numNochesSolicitadas: 3, hoy: HOY });
    assert.ok(sugerencias.length >= 1, "debe encontrar al menos una fecha real con tarifa");
    assert.ok(sugerencias.some((s) => s.noches === 3), "al menos una sugerencia debe preservar la duración solicitada (ALTA no exige más noches)");
    for (const s of sugerencias) {
      // Nunca menos noches que las pedidas — solo igual o más (min_noches).
      assert.ok(s.noches >= 3);
      // Cada sugerencia debe ser REAL: se re-valida con el motor real, nunca
      // solo se confía en que vino de un límite de temporada.
      const real = evaluarHotelPorFechas(baseDatos(), s.fechaIda, s.noches);
      assert.ok(real && real.combos.length > 0, `la sugerencia ${s.fechaIda} debe tener tarifa real`);
    }
  });
});

describe("4. Sugerencias ordenadas, sin duplicados, máximo 4", () => {
  test("nunca hay dos sugerencias con la misma fechaIda", () => {
    const sugerencias = generarSugerenciasFechas({ datos: baseDatos(), fechaIdaSolicitada: "2026-09-20", numNochesSolicitadas: 3, hoy: HOY });
    const fechas = sugerencias.map((s) => s.fechaIda);
    assert.equal(new Set(fechas).size, fechas.length);
  });
  test("vienen ordenadas de la más cercana a la más lejana", () => {
    const sugerencias = generarSugerenciasFechas({ datos: baseDatos(), fechaIdaSolicitada: "2026-09-20", numNochesSolicitadas: 3, hoy: HOY });
    const ordenado = [...sugerencias].sort((a, b) => a.fechaIda.localeCompare(b.fechaIda));
    assert.deepEqual(sugerencias, ordenado);
  });
  test("un hotel con temporada ancha y sin huecos nunca devuelve más de 4 sugerencias", () => {
    const anchaAbierta: FilaTemporadaHotelRaw[] = [temporadaAlta({ nombre: "ANUAL", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31" })];
    const datos = baseDatos({ temporadas: anchaAbierta, tarifas: [tarifaPara("ANUAL")] });
    const sugerencias = generarSugerenciasFechas({ datos, fechaIdaSolicitada: "2026-06-01", numNochesSolicitadas: 2, hoy: HOY });
    assert.ok(sugerencias.length <= MAX_SUGERENCIAS_FECHAS);
    assert.equal(sugerencias.length, MAX_SUGERENCIAS_FECHAS, "con disponibilidad amplia debe llenar las 4");
  });
});

describe("5. Ninguna fecha fuera del rango del paquete ni en el pasado", () => {
  test("ninguna sugerencia supera fecha_viaje_fin del paquete", () => {
    const datos = baseDatos({ paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2026-01-01", fecha_viaje_fin: "2026-09-10" } });
    const sugerencias = generarSugerenciasFechas({ datos, fechaIdaSolicitada: "2026-09-20", numNochesSolicitadas: 3, hoy: HOY });
    // El paquete cierra el 10-sep — ALTA (1-15 sep) queda parcialmente fuera;
    // ninguna sugerencia puede pedir noches que terminen después del cierre.
    for (const s of sugerencias) assert.ok(s.fechaRegreso <= "2026-09-10", `fechaRegreso ${s.fechaRegreso} excede fecha_viaje_fin`);
  });
  test("ninguna sugerencia es anterior a 'hoy'", () => {
    const hoyTarde = "2026-09-10"; // ya dentro de ALTA
    const sugerencias = generarSugerenciasFechas({ datos: baseDatos(), fechaIdaSolicitada: "2026-09-20", numNochesSolicitadas: 3, hoy: hoyTarde });
    for (const s of sugerencias) assert.ok(s.fechaIda >= hoyTarde, `${s.fechaIda} es anterior a hoy (${hoyTarde})`);
  });
});

describe("6. Estancia que cruza una noche sin tarifa NUNCA se sugiere", () => {
  test("candidato justo antes del hueco, cuya estadía cruzaría al hueco, se descarta", () => {
    // ALTA termina el 15-sep. Pedir ida=13-sep + 3 noches cruzaría 13,14,15 —
    // esas SÍ están dentro de ALTA (15 incluido como noche de entrada del
    // día 15, la salida sería 16) — construimos el caso límite real: ida=14
    // + 3 noches = noches 14,15,16 → 16 YA está en el hueco. No debe sugerirse.
    const datos = baseDatos();
    const real = evaluarHotelPorFechas(datos, "2026-09-14", 3);
    assert.equal(real!.combos.length, 0, "la estadía cruza al hueco: no debe tener tarifa");
    const sugerencias = generarSugerenciasFechas({ datos, fechaIdaSolicitada: "2026-09-11", numNochesSolicitadas: 3, hoy: HOY });
    assert.ok(!sugerencias.some((s) => s.fechaIda === "2026-09-14"), "2026-09-14 no debe aparecer como sugerencia (cruza al hueco)");
  });
});

describe("7. Blackout TOTAL nunca se sugiere", () => {
  test("un blackout total dentro de ALTA excluye esas fechas de las sugerencias", () => {
    const blackouts: FilaBlackoutHotelRaw[] = [{ fecha_inicio: "2026-09-05", fecha_fin: "2026-09-08", total: true, acomodaciones: null, categorias: null }];
    const datos = baseDatos({ blackouts });
    const real = evaluarHotelPorFechas(datos, "2026-09-06", 2);
    assert.equal(real!.combos.length, 0, "blackout total: 0 combos");
    const sugerencias = generarSugerenciasFechas({ datos, fechaIdaSolicitada: "2026-09-06", numNochesSolicitadas: 2, hoy: HOY });
    for (const s of sugerencias) {
      const cubreBlackout = s.fechaIda < "2026-09-08" && s.fechaRegreso > "2026-09-05";
      assert.ok(!cubreBlackout, `la sugerencia ${s.fechaIda}-${s.fechaRegreso} cae dentro del blackout total`);
    }
  });
});

describe("8. Mínimo de noches respetado — extiende la duración con etiqueta explícita, nunca sugiere MENOS de lo pedido", () => {
  test("PUENTE exige 4 noches; pedir 2 produce una sugerencia de 4 noches con la etiqueta indicándolo", () => {
    const sugerencias = generarSugerenciasFechas({ datos: baseDatos(), fechaIdaSolicitada: "2026-09-20", numNochesSolicitadas: 2, hoy: HOY });
    const enPuente = sugerencias.filter((s) => s.fechaIda >= "2026-10-01" && s.fechaIda <= "2026-10-10");
    assert.ok(enPuente.length > 0, "debe encontrar al menos una sugerencia dentro de PUENTE");
    for (const s of enPuente) {
      assert.equal(s.noches, 4, "nunca menos noches que el mínimo real de la temporada");
      assert.match(s.etiqueta, /mínimo del hotel/);
    }
  });
  test("nunca sugiere MENOS noches que las pedidas por el cliente, aunque el hotel acepte menos en otra temporada", () => {
    const sugerencias = generarSugerenciasFechas({ datos: baseDatos(), fechaIdaSolicitada: "2026-09-20", numNochesSolicitadas: 5, hoy: HOY });
    for (const s of sugerencias) assert.ok(s.noches >= 5, `sugerencia con ${s.noches} noches, menos de las 5 pedidas`);
  });
});

describe("9. Vigencia de compra respetada", () => {
  // `netoNoche`/`liquidarHotelNoches` (lib/calc/paquetes.ts) evalúan la
  // vigencia de compra contra `hoyISO()` (la fecha REAL del sistema) — igual
  // que ya hacía el motor original antes de este refactor, `evaluarHotelPorFechas`
  // no le pasa un `hoy` de prueba (correcto: la vigencia de compra SIEMPRE se
  // decide contra hoy real, sin importar la ventana de sugerencias). Por eso
  // esta prueba usa un `compra_inicio` muy lejano en el calendario REAL —
  // determinístico sin importar cuándo se ejecute la suite.
  const COMPRA_INICIO_MUY_FUTURO = "2099-01-01";
  test("una temporada con compra_inicio muy en el futuro nunca produce sugerencias, aunque las fechas de viaje sean válidas", () => {
    const temporadaFutura = temporadaAlta({ nombre: "ANTICIPADA", compra_inicio: COMPRA_INICIO_MUY_FUTURO });
    const datos = baseDatos({ temporadas: [temporadaFutura], tarifas: [tarifaPara("ANTICIPADA")] });
    const real = evaluarHotelPorFechas(datos, "2026-09-05", 3);
    assert.equal(real!.combos.length, 0, "la vigencia de compra bloquea la tarifa aunque la fecha de viaje sea real");
    const sugerencias = generarSugerenciasFechas({ datos, fechaIdaSolicitada: "2026-09-05", numNochesSolicitadas: 3, hoy: HOY });
    assert.equal(sugerencias.length, 0);
  });
});

describe("10. Composición incompatible no produce sugerencias engañosas", () => {
  const composicionBase: ComposicionSugerencia = {
    adultosDeclarados: 2,
    habitacionesConsultadas: [{ acom: "doble", config: defaultAcomConfig("doble") }],
    edadesMenores: [],
    edadInfanteMax: 2,
    edadNinoMax: 10,
    adultsOnly: false,
  };
  test("Adults Only + menores declarados → nunca sugiere ninguna fecha (ninguna fecha lo arregla)", () => {
    const composicion: ComposicionSugerencia = { ...composicionBase, edadesMenores: [5], adultsOnly: true };
    const sugerencias = generarSugerenciasFechas({ datos: baseDatos(), fechaIdaSolicitada: "2026-09-20", numNochesSolicitadas: 3, hoy: HOY, composicion });
    assert.equal(sugerencias.length, 0);
  });
  test("capacidad de habitación imposible (config inválida) → nunca sugiere fechas", () => {
    // 10 adultos declarados en una sola habitación doble (capacidad real 2):
    // ninguna fecha resuelve un problema de capacidad, no es de fechas.
    const composicion: ComposicionSugerencia = { ...composicionBase, adultosDeclarados: 10 };
    const sugerencias = generarSugerenciasFechas({ datos: baseDatos(), fechaIdaSolicitada: "2026-09-20", numNochesSolicitadas: 3, hoy: HOY, composicion });
    assert.equal(sugerencias.length, 0);
  });
  test("composición SÍ compatible: la sugerencia solo aparece si el combo tiene tarifa de niño cuando hace falta", () => {
    // Tarifa de ALTA no tiene neto_nino2 configurado en esta variante — un
    // menor que caiga en "Niño 2" (imposible con un solo menor, pero se
    // prueba con dos menores para forzar nino+nino2) debe bloquear la
    // sugerencia si el combo no tiene esa tarifa.
    const sinNino2: DatosHotelPaquete = baseDatos({ tarifas: [tarifaPara("ALTA", { neto_nino2: null }), tarifaPara("PUENTE", { neto_nino2: null })] });
    const composicion: ComposicionSugerencia = {
      ...composicionBase,
      edadesMenores: [5, 6], // 2 menores → 1 habitación doble solo admite Niño1+Niño2
    };
    const sugerencias = generarSugerenciasFechas({ datos: sinNino2, fechaIdaSolicitada: "2026-09-20", numNochesSolicitadas: 3, hoy: HOY, composicion });
    assert.equal(sugerencias.length, 0, "sin tarifa de Niño 2 configurada, ninguna fecha es realmente compatible con 2 menores");
  });
});

describe("11. Control negativo: tomar SOLO los límites de temporada produciría una sugerencia FALSA", () => {
  test("una temporada con fechas válidas pero SIN tarifa_hotel cargada aparece como semilla (límite) pero NUNCA como sugerencia real", () => {
    const temporadaSinTarifa = temporadaAlta({ nombre: "SIN_TARIFA", fecha_inicio: "2026-11-01", fecha_fin: "2026-11-30" });
    const datos = baseDatos({ temporadas: [temporadaSinTarifa], tarifas: [] }); // 0 filas de tarifa_hotel para esta temporada

    // Un enfoque ingenuo (solo mirar fecha_inicio/fecha_fin de hotel_temporadas,
    // sin pasar por el motor real) SÍ la propondría como candidata:
    const cands = candidatosFecha(datos, "2026-11-15", "2026-01-01", "2026-12-31");
    assert.ok(cands.includes("2026-11-01"), "la semilla de la temporada SÍ está entre los candidatos (esto es lo que haría fallar un enfoque ingenuo)");

    // Pero el motor real confirma que NO hay tarifa configurada:
    const real = evaluarHotelPorFechas(datos, "2026-11-01", 3);
    assert.equal(real!.combos.length, 0, "la temporada cubre la fecha pero no tiene ninguna tarifa cargada");

    // Por eso `generarSugerenciasFechas` (que SÍ valida con el motor real)
    // nunca la ofrece como sugerencia — la prueba de que el filtro real
    // importa y no basta con los límites de temporada:
    const sugerencias = generarSugerenciasFechas({ datos, fechaIdaSolicitada: "2026-11-15", numNochesSolicitadas: 3, hoy: HOY });
    assert.equal(sugerencias.length, 0, "un enfoque que solo mirara los límites de temporada habría sugerido 2026-11-01 falsamente");
  });
});

describe("12. addDiasISO — aritmética de fechas pura", () => {
  test("suma días respetando cambio de mes/año", () => {
    assert.equal(addDiasISO("2026-01-30", 3), "2026-02-02");
    assert.equal(addDiasISO("2026-12-30", 3), "2027-01-02");
  });
});

describe("13. Sin combos y sin datos → nunca lanza, devuelve arreglo vacío", () => {
  test("paquete sin temporadas ni tarifas: 0 sugerencias, sin excepción", () => {
    const vacio = baseDatos({ temporadas: [], tarifas: [] });
    const sugerencias = generarSugerenciasFechas({ datos: vacio, fechaIdaSolicitada: "2026-09-20", numNochesSolicitadas: 3, hoy: HOY });
    assert.deepEqual(sugerencias, []);
  });
  test("numNochesSolicitadas <= 0 devuelve vacío sin evaluar nada", () => {
    assert.deepEqual(generarSugerenciasFechas({ datos: baseDatos(), fechaIdaSolicitada: "2026-09-20", numNochesSolicitadas: 0, hoy: HOY }), []);
    assert.equal(evaluarHotelPorFechas(baseDatos(), "2026-09-20", 0), null);
  });
});
