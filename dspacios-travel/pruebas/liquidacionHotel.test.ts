import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluarHotelPorFechas,
  candidatosFecha,
  generarSugerenciasFechas,
  consolidarSugerenciasGlobales,
  addDiasISO,
  compararPorCercania,
  MAX_SUGERENCIAS_FECHAS,
  type DatosHotelPaquete,
  type FilaTemporadaHotelRaw,
  type FilaTarifaHotelRaw,
  type FilaBlackoutHotelRaw,
  type ComposicionSugerencia,
  type SugerenciaFecha,
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
  test("vienen ordenadas por CERCANÍA real a la fecha solicitada, no por orden cronológico simple", () => {
    // Ronda 2, defecto real corregido: el orden ISO ascendente NO es cercanía
    // — con el barrido ahora bidireccional, una fecha ANTERIOR a la
    // solicitada (pero futura respecto de hoy) puede quedar más cerca que
    // una posterior. Se verifica contra el mismo criterio de cercanía
    // (`compararPorCercania`), no contra un simple `localeCompare`.
    const fechaSolicitada = "2026-09-20";
    const sugerencias = generarSugerenciasFechas({ datos: baseDatos(), fechaIdaSolicitada: fechaSolicitada, numNochesSolicitadas: 3, hoy: HOY });
    const ordenadoPorCercania = [...sugerencias].sort((a, b) => compararPorCercania(a.fechaIda, b.fechaIda, fechaSolicitada));
    assert.deepEqual(sugerencias, ordenadoPorCercania);
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
    // Datos AISLADOS con SOLO la temporada PUENTE (sin ALTA compitiendo): con
    // el barrido ahora bidireccional (ronda 2), si ALTA también existiera,
    // sus fechas hacia atrás (más cercanas a la solicitada, sin necesitar
    // extensión) ganarían por cercanía y llenarían el cupo de 4 antes de
    // llegar a PUENTE — lo cual sería el comportamiento CORRECTO (más cerca
    // gana), pero no es lo que esta prueba puntual quiere ejercitar.
    const soloPuente = baseDatos({ temporadas: [temporadaPuente()], tarifas: [tarifaPara("PUENTE")] });
    const sugerencias = generarSugerenciasFechas({ datos: soloPuente, fechaIdaSolicitada: "2026-09-20", numNochesSolicitadas: 2, hoy: HOY });
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

describe("12. Ronda 2 — ninguna estancia termina fuera del rango del paquete", () => {
  test("una candidata a 1-2 días del cierre, cuyo REGRESO lo supera, se descarta (aunque la IDA sí quepa)", () => {
    // fecha_viaje_fin = 2026-09-30. ALTA cubre 1-15 sep; se agrega una
    // segunda temporada FIN_DE_TEMPORADA que cubre justo hasta el cierre del
    // paquete, para que exista una candidata de IDA válida a 1-2 días del
    // cierre cuya estadía de 3 noches SÍ tendría tarifa cargada (el motor
    // real la aceptaría) pero cuyo REGRESO cruza fecha_viaje_fin.
    const finDeTemporada = temporadaAlta({ nombre: "FIN_DE_TEMPORADA", fecha_inicio: "2026-09-20", fecha_fin: "2026-10-05" });
    const datos = baseDatos({
      paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2026-01-01", fecha_viaje_fin: "2026-09-30" },
      temporadas: [temporadaAlta(), finDeTemporada],
      tarifas: [tarifaPara("ALTA"), tarifaPara("FIN_DE_TEMPORADA")],
    });
    // Confirma la premisa del caso límite: 2026-09-29 + 3 noches SÍ tiene
    // tarifa real (el motor la aceptaría si no fuera por el cierre del
    // paquete) — así se prueba el candado de `fechaRegreso`, no un hueco de
    // tarifa disfrazado de límite de paquete.
    const real = evaluarHotelPorFechas(datos, "2026-09-29", 3);
    assert.ok(real && real.combos.length > 0, "premisa del caso: 2026-09-29 + 3 noches sí tiene tarifa real");
    assert.equal(addDiasISO("2026-09-29", 3), "2026-10-02", "premisa del caso: el regreso cae después del cierre (2026-09-30)");

    const sugerencias = generarSugerenciasFechas({ datos, fechaIdaSolicitada: "2026-09-10", numNochesSolicitadas: 3, hoy: HOY });
    assert.ok(!sugerencias.some((s) => s.fechaIda === "2026-09-29"), "2026-09-29 no debe sugerirse: su regreso (2026-10-02) supera fecha_viaje_fin (2026-09-30)");
    for (const s of sugerencias) assert.ok(s.fechaRegreso <= "2026-09-30", `fechaRegreso ${s.fechaRegreso} excede fecha_viaje_fin`);
  });

  test("la EXTENSIÓN por mínimo de noches del hotel tampoco puede cruzar el cierre del paquete", () => {
    // PUENTE exige 4 noches y cierra 2026-10-10. Si el paquete cierra el
    // 2026-10-08, una candidata de ida el 2026-10-07 necesitaría extenderse
    // a 4 noches (regreso 2026-10-11) — cruza el cierre del PAQUETE (no el
    // de la temporada) y debe descartarse igual que el camino directo.
    const datos = baseDatos({
      paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2026-01-01", fecha_viaje_fin: "2026-10-08" },
      temporadas: [temporadaPuente()],
      tarifas: [tarifaPara("PUENTE")],
    });
    const directa = evaluarHotelPorFechas(datos, "2026-10-07", 2);
    assert.ok(directa && directa.minNoches === 4, "premisa del caso: PUENTE exige 4 noches");
    const sugerencias = generarSugerenciasFechas({ datos, fechaIdaSolicitada: "2026-09-25", numNochesSolicitadas: 2, hoy: HOY });
    assert.ok(!sugerencias.some((s) => s.fechaIda === "2026-10-07"), "2026-10-07 extendido a 4 noches (regreso 2026-10-11) supera el cierre del paquete (2026-10-08)");
    for (const s of sugerencias) assert.ok(s.fechaRegreso <= "2026-10-08", `fechaRegreso ${s.fechaRegreso} excede fecha_viaje_fin`);
  });
});

describe("13. Ronda 2 — orden por CERCANÍA real, no cronológico simple", () => {
  function datosDosDiasSueltos(diaA: string, diaB: string): DatosHotelPaquete {
    const tA = temporadaAlta({ nombre: "A", fecha_inicio: diaA, fecha_fin: diaA });
    const tB = temporadaAlta({ nombre: "B", fecha_inicio: diaB, fecha_fin: diaB });
    return baseDatos({ temporadas: [tA, tB], tarifas: [tarifaPara("A"), tarifaPara("B")] });
  }

  test("caso del hallazgo: solicitada 20-sep, válidas 18-sep y 21-sep → 21-sep aparece primero (más cerca)", () => {
    const datos = datosDosDiasSueltos("2026-09-18", "2026-09-21");
    const sugerencias = generarSugerenciasFechas({ datos, fechaIdaSolicitada: "2026-09-20", numNochesSolicitadas: 1, hoy: HOY });
    assert.ok(sugerencias.length >= 2, "deben aparecer ambas fechas");
    assert.equal(sugerencias[0].fechaIda, "2026-09-21", "21-sep (distancia 1) debe ir antes que 18-sep (distancia 2)");
    assert.equal(sugerencias[1].fechaIda, "2026-09-18");
  });

  test("empate real de distancia: solicitada 20-sep, válidas 19-sep y 21-sep (ambas a 1 día) → gana la POSTERIOR", () => {
    const datos = datosDosDiasSueltos("2026-09-19", "2026-09-21");
    const sugerencias = generarSugerenciasFechas({ datos, fechaIdaSolicitada: "2026-09-20", numNochesSolicitadas: 1, hoy: HOY });
    assert.ok(sugerencias.length >= 2, "deben aparecer ambas fechas");
    assert.equal(sugerencias[0].fechaIda, "2026-09-21", "en empate de distancia, la fecha POSTERIOR a la solicitada gana");
    assert.equal(sugerencias[1].fechaIda, "2026-09-19");
  });

  test("compararPorCercania — desempate final por orden ISO cuando distancia y posterioridad también empatan", () => {
    // Caso sintético (no ocurre con fechas reales distintas de la referencia,
    // ya que la posterioridad ya desempata cualquier par simétrico): prueba
    // directa de la función pura para dejar cubierto el tercer criterio.
    assert.equal(compararPorCercania("2026-09-20", "2026-09-20", "2026-09-20"), 0);
  });
});

describe("14. Ronda 2 — MAX_CANDIDATOS no debe borrar una semilla ESTRUCTURAL lejana", () => {
  test("más de 60 semillas de barrido antes + una temporada válida de 1 día, lejana y fuera de los saltos semanales, sobrevive", () => {
    // La solicitada está a 09-01; el barrido (13 días + 50 saltos de 7,
    // bidireccional) genera más de 60 fechas candidatas "tempranas" dentro de
    // la ventana — el escenario exacto que antes desplazaba una semilla
    // estructural en el `[...set].sort().slice(0, 60)` ingenuo.
    // La temporada objetivo cubre un solo día, 251 días después (no es
    // múltiplo de 7 → ningún salto semanal cae ahí; y está muy por fuera del
    // barrido diario de 13 días), así que SOLO puede aparecer por ser
    // semilla ESTRUCTURAL (su propio `fecha_inicio`).
    const fechaSolicitada = "2026-01-01";
    const diaLejano = addDiasISO(fechaSolicitada, 251);
    assert.equal(251 % 7, 6, "premisa del caso: 251 no es múltiplo de 7 (ningún salto semanal cae ahí)");
    const temporadaLejana = temporadaAlta({ nombre: "LEJANA_UN_DIA", fecha_inicio: diaLejano, fecha_fin: diaLejano });
    const datos = baseDatos({
      paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2026-01-01", fecha_viaje_fin: "2026-12-31" },
      temporadas: [temporadaLejana],
      tarifas: [tarifaPara("LEJANA_UN_DIA")],
    });
    const cands = candidatosFecha(datos, fechaSolicitada, "2026-01-01", "2026-12-31");
    assert.ok(cands.length > 60 - 1, "premisa del caso: el barrido por sí solo ya genera más de 60 candidatas tempranas");
    assert.ok(cands.includes(diaLejano), "la semilla estructural de la temporada lejana debe sobrevivir al recorte de MAX_CANDIDATOS");

    const sugerencias = generarSugerenciasFechas({ datos, fechaIdaSolicitada: fechaSolicitada, numNochesSolicitadas: 1, hoy: HOY });
    assert.ok(sugerencias.some((s) => s.fechaIda === diaLejano), "debe producir una sugerencia real para la temporada lejana de 1 día");
  });

  test("compra_inicio NUNCA se usa como semilla de fecha de viaje", () => {
    // Una temporada con `compra_inicio` en una fecha REAL (dentro de la
    // ventana) pero SIN tarifa ni cobertura de estadía en esa fecha: si
    // `compra_inicio` se colara como semilla, aparecería como candidato;
    // nunca debe hacerlo (es vigencia de COMPRA, no de viaje).
    const compraInicioComoTrampa = "2026-06-15";
    const t = temporadaAlta({ nombre: "SOLO_COMPRA", fecha_inicio: "2026-08-01", fecha_fin: "2026-08-10", compra_inicio: compraInicioComoTrampa });
    const datos = baseDatos({ temporadas: [t], tarifas: [tarifaPara("SOLO_COMPRA")] });
    const cands = candidatosFecha(datos, "2026-01-01", "2026-01-01", "2026-12-31");
    assert.ok(!cands.includes(compraInicioComoTrampa), "compra_inicio no debe aparecer como candidato de fecha de viaje");
  });
});

describe("15. addDiasISO — aritmética de fechas pura", () => {
  test("suma días respetando cambio de mes/año", () => {
    assert.equal(addDiasISO("2026-01-30", 3), "2026-02-02");
    assert.equal(addDiasISO("2026-12-30", 3), "2027-01-02");
  });
});

describe("16. Sin combos y sin datos → nunca lanza, devuelve arreglo vacío", () => {
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

describe("17. Ronda 3 — control negativo: evaluarHotelPorFechas SÍ mezcla margen/destino de un paquete con tarifas de un hotel no asociado cuando armadoHotel es null (por eso el candado tiene que vivir en el LOADER, cargarDatosHotelPaquete, no acá)", () => {
  test("con armadoHotel: null, el PVP usa pct_mk/destino del PAQUETE A sobre las tarifas del HOTEL B — la función pura no tiene forma de detectar que nunca fueron asociados", () => {
    // Reproduce EXACTAMENTE el comportamiento que tenía `cargarDatosHotelPaquete`
    // antes de la ronda 3: cuando `armado_hoteles` no tenía fila para el par
    // (paqueteId, hotelId), seguía adelante con `armadoHotel: null` en vez de
    // fallar cerrado. `evaluarHotelPorFechas` en sí NUNCA cambió — sigue
    // aceptando `armadoHotel: null` como "sin filtro, moneda COP" (mismo
    // comportamiento documentado desde la primera ronda de esta rama) — el
    // candado real está en el loader (`cargarDatosHotelPaquete`), que ahora
    // nunca construye este estado en producción.
    const paqueteA = {
      pct_mk: 0.5, // margen deliberadamente alto para hacer el mezclado obvio (0.5 evita el redondeo binario de 0.9)
      impuesto_fijo: 0,
      destino_nombre: "DESTINO-DEL-PAQUETE-A",
      fecha_viaje_inicio: null,
      fecha_viaje_fin: null,
    };
    const tarifasHotelB = [tarifaPara("ALTA", { neto_doble: 200_000, neto_sencilla: null, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null })];
    const datosMezclados: DatosHotelPaquete = {
      paquete: paqueteA,
      armadoHotel: null, // el hotel B nunca fue asociado al paquete A (sin fila armado_hoteles)
      temporadas: [temporadaAlta()],
      tarifas: tarifasHotelB,
      serviciosIncluidos: [],
      blackouts: [],
    };
    const r = evaluarHotelPorFechas(datosMezclados, "2026-09-05", 3);
    assert.ok(r && r.combos.length > 0, "premisa del caso: SÍ produce un resultado utilizable, sin fallar, aunque el hotel nunca se asoció al paquete");
    // El destino que se muestra es el del PAQUETE A — no hay forma de saber
    // (ni de validar) que corresponde de verdad al hotel B:
    assert.equal(r!.destinoNombre, "DESTINO-DEL-PAQUETE-A");
    // El PVP usa el pct_mk del PAQUETE A (50%) sobre el neto del HOTEL B:
    // 200.000 × 3 noches = 600.000; marcar(600.000, 0.5) = 600.000/(1-0.5) = 1.200.000.
    assert.equal(r!.combos[0].precios["doble"], 1_200_000, "el PVP mezcla el margen del paquete A con la tarifa neta del hotel B");
    // Y el nombre del hotel se pierde por completo (armadoHotel es null) —
    // otra señal de que este resultado es un producto "huérfano".
    assert.equal(r!.hotelNombre, null);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ronda 4 — `consolidarSugerenciasGlobales`: la búsqueda general
// (sugerenciasBusquedaGeneral, lib/reservar/cotizar.ts) evaluaba los hoteles
// candidatos en orden y cortaba el bucle apenas el PRIMER hotel aportaba 4
// sugerencias (`break`), reordenando el resultado final con `localeCompare`
// (cronológico simple) en vez de cercanía real. Este helper puro recibe el
// lote COMPLETO ya evaluado (un arreglo por hotel) y decide la selección
// GLOBAL — dedup + orden por `compararPorCercania` + corte a `max`.
// ───────────────────────────────────────────────────────────────────────────
function sug(fechaIda: string, numNoches = 3): SugerenciaFecha {
  const fechaRegreso = addDiasISO(fechaIda, numNoches);
  return { fechaIda, fechaRegreso, noches: numNoches, etiqueta: `${fechaIda} · ${numNoches} noches` };
}

// Reproduce EXACTAMENTE el comportamiento que tenía `sugerenciasBusquedaGeneral`
// antes de esta ronda: recorre los lotes por hotel EN ORDEN, corta con
// `break` apenas junta 4, y reordena el resultado con `localeCompare`
// (cronológico simple, no cercanía). Solo existe en la prueba — nunca se
// reintrodujo en el código de producción — para demostrar el defecto real.
function comportamientoAnteriorAlaRonda4(porHotel: SugerenciaFecha[][]): SugerenciaFecha[] {
  const vistas = new Set<string>();
  const sugerencias: SugerenciaFecha[] = [];
  for (const lote of porHotel) {
    if (sugerencias.length >= 4) break;
    for (const s of lote) {
      const key = `${s.fechaIda}|${s.fechaRegreso}`;
      if (vistas.has(key)) continue;
      vistas.add(key);
      sugerencias.push(s);
      if (sugerencias.length >= 4) break;
    }
  }
  sugerencias.sort((a, b) => a.fechaIda.localeCompare(b.fechaIda));
  return sugerencias.slice(0, 4);
}

describe("18. Ronda 4 — consolidarSugerenciasGlobales: elección de las 4 fechas más cercanas GLOBALMENTE, no por el primer hotel evaluado", () => {
  const fechaSolicitada = "2026-01-01";

  test("hotel A (procesado primero) aporta fechas lejanas (40-43 días); hotel B (procesado después) aporta fechas cercanas (1-2 días) → las de hotel B deben ir primero", () => {
    const hotelA = [40, 41, 42, 43].map((d) => sug(addDiasISO(fechaSolicitada, d)));
    const hotelB = [1, 2].map((d) => sug(addDiasISO(fechaSolicitada, d)));
    const resultado = consolidarSugerenciasGlobales([hotelA, hotelB], fechaSolicitada);
    assert.equal(resultado.length, 4);
    assert.equal(resultado[0].fechaIda, addDiasISO(fechaSolicitada, 1), "la más cercana (1 día, hotel B) debe ir primero");
    assert.equal(resultado[1].fechaIda, addDiasISO(fechaSolicitada, 2), "la segunda más cercana (2 días, hotel B) debe ir segunda");
    // Las 2 restantes son las más cercanas de hotel A (40 y 41 días).
    assert.equal(resultado[2].fechaIda, addDiasISO(fechaSolicitada, 40));
    assert.equal(resultado[3].fechaIda, addDiasISO(fechaSolicitada, 41));
  });

  test("empate real de distancia: solicitada 20-sep, 19-sep y 21-sep (ambas a 1 día, de hoteles distintos) → gana la POSTERIOR (21-sep)", () => {
    const resultado = consolidarSugerenciasGlobales([[sug("2026-09-19")], [sug("2026-09-21")]], "2026-09-20");
    assert.equal(resultado.length, 2);
    assert.equal(resultado[0].fechaIda, "2026-09-21");
    assert.equal(resultado[1].fechaIda, "2026-09-19");
  });

  test("dos hoteles generan el mismo rango (misma fechaIda+fechaRegreso) → aparece una sola vez", () => {
    const fecha = addDiasISO(fechaSolicitada, 5);
    const hotelA = [sug(fecha)];
    const hotelB = [sug(fecha)]; // mismo fechaIda/fechaRegreso/noches, hotel distinto
    const resultado = consolidarSugerenciasGlobales([hotelA, hotelB], fechaSolicitada);
    assert.equal(resultado.length, 1, "la misma combinación fechaIda+fechaRegreso no debe duplicarse aunque venga de hoteles distintos");
  });

  test("más de 24 candidatas en total → la salida nunca supera 4", () => {
    const porHotel: SugerenciaFecha[][] = [];
    for (let h = 0; h < 8; h++) {
      porHotel.push([1, 2, 3, 4].map((d) => sug(addDiasISO(fechaSolicitada, h * 10 + d))));
    }
    assert.ok(porHotel.flat().length > 24, "premisa del caso: más de 24 candidatas totales");
    const resultado = consolidarSugerenciasGlobales(porHotel, fechaSolicitada);
    assert.equal(resultado.length, 4);
  });

  test("control negativo: el patrón anterior a esta ronda (primer hotel llena 4 + break, orden por localeCompare) SÍ habría omitido la fecha más cercana de un segundo hotel", () => {
    const hotelA = [40, 41, 42, 43].map((d) => sug(addDiasISO(fechaSolicitada, d)));
    const hotelB = [sug(addDiasISO(fechaSolicitada, 1))]; // la fecha MÁS cercana de todo el lote
    const anterior = comportamientoAnteriorAlaRonda4([hotelA, hotelB]);
    assert.ok(
      !anterior.some((s) => s.fechaIda === addDiasISO(fechaSolicitada, 1)),
      "el patrón anterior corta el bucle en hotel A (ya junta 4) y nunca llega a evaluar hotel B — reproduce el defecto real"
    );
    const actual = consolidarSugerenciasGlobales([hotelA, hotelB], fechaSolicitada);
    assert.ok(
      actual.some((s) => s.fechaIda === addDiasISO(fechaSolicitada, 1)),
      "consolidarSugerenciasGlobales SÍ incluye la fecha más cercana del segundo hotel"
    );
    assert.equal(actual[0].fechaIda, addDiasISO(fechaSolicitada, 1), "y la ubica primera, por ser la más cercana");
  });

  test("lote vacío o sin candidatas → arreglo vacío, sin lanzar", () => {
    assert.deepEqual(consolidarSugerenciasGlobales([], fechaSolicitada), []);
    assert.deepEqual(consolidarSugerenciasGlobales([[], []], fechaSolicitada), []);
  });

  test("respeta un `max` explícito distinto de 4", () => {
    const lote = [1, 2, 3, 4, 5].map((d) => sug(addDiasISO(fechaSolicitada, d)));
    const resultado = consolidarSugerenciasGlobales([lote], fechaSolicitada, 2);
    assert.equal(resultado.length, 2);
    assert.equal(resultado[0].fechaIda, addDiasISO(fechaSolicitada, 1));
    assert.equal(resultado[1].fechaIda, addDiasISO(fechaSolicitada, 2));
  });
});
