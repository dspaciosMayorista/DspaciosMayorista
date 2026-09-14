import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluarDisponibilidadHotelUnidad,
  ofertasPorHotelDe,
  combinacionesDe,
  compararOpciones,
  type EntradaComputarDisponibilidad,
  type ResultadoComputarDisponibilidad,
  type FilaHotelBusquedaUnidad,
  type OpcionUnidadConfirmada,
} from "../lib/tarifario/evaluarDisponibilidadUnidad.ts";
import type { HotelBernaloDescubierto } from "../lib/tarifario/datosBernalo.ts";

// ─────────────────────────────────────────────────────────────────────────
// Pruebas de COMPORTAMIENTO REAL (no wiring) del veredicto de disponibilidad
// de un hotel `modelo_tarifario = "unidad"`.
//
// Esta ronda corrige el defecto confirmado con datos reales (hotel_id=216,
// "Hotel Prueba Odair"): la búsqueda reutilizaba el reparto de PERSONA
// (`hotel_acomodaciones`/`defaultAcomConfig`) para decidir cuántos menores
// caben por habitación — un hotel SIN filas en `hotel_acomodaciones` caía al
// default `pax_max=pax_tarifa=2`, cuya capacidad de niño efectiva es
// SIEMPRE 0 (`min(chd_max, 2, pax_max−pax_tarifa)`), así que 2 adultos + 1
// menor se rechazaban ANTES de intentar cotizar — aunque la tarifa unidad
// PUBLICADA (capacidad real `maxPax=3`) sí lo admitía. Ver la cabecera de
// `lib/tarifario/distribucionOcupacionUnidad.ts` para el detalle completo.
//
// Ahora la capacidad/reparto se resuelven POR COMBINACIÓN (categoría ×
// alimentación), desde la tarifa unidad publicada
// (`resolverCapacidadTarifaUnidad`) — nunca desde `hotel_acomodaciones`.
// `hotel_temporadas`/`hotel_tarifas_unidad` llegan como fixtures (`unknown[]`
// ya "leídos"), igual que en producción.
//
// A diferencia de `busquedaPorcionTerrestreWiring.test.ts` (que inspecciona
// texto fuente porque `busquedaUnidadActions.ts` es un archivo `"use
// server"` que no se puede invocar bajo `node --test` sin Next/Supabase),
// este archivo EJECUTA de verdad `evaluarDisponibilidadHotelUnidad` —
// exactamente la función que usa la Server Action real — con un `computar`
// de prueba inyectado en lugar de `computarReservaBernalo`.
// ─────────────────────────────────────────────────────────────────────────

const OFERTA: HotelBernaloDescubierto = {
  hotelId: 216,
  hotelNombre: "Hotel Prueba Odair",
  paqueteId: 501,
  paqueteNombre: "Porción San Andrés",
  destinoNombre: "SAN ANDRÉS",
  destinoId: 7,
  tipo: "porcion_terrestre",
  categorias: ["Estandar", "Superior"],
  regimenes: ["PC", "PAM"],
  moneda: "COP",
  salidas: [],
};

const FILA: FilaHotelBusquedaUnidad = { id: 216, edad_infante_max: 2, edad_nino_max: 10, adults_only: false };

const HOY = "2026-01-01";
const FECHA_IDA = "2026-12-01";
const FECHA_REGRESO = "2026-12-04";

// Fixture de `hotel_temporadas` — vigente todo el año, sin blackouts, para
// que `resolverTemporadaEstadia` resuelva "GENERAL" sin ambigüedad.
const TEMPORADA_RAW = {
  nombre: "GENERAL",
  fecha_inicio: "2026-01-01",
  fecha_fin: "2026-12-31",
  prioridad: 1,
  compra_inicio: null,
  compra_fin: null,
  tipo: "tarifa",
};

/** Fixture de una fila `hotel_tarifas_unidad` PUBLICADA — mismo shape que
 * consume `adaptarTarifaAlojamientoPersistida` (ver
 * `pruebas/tarifaAlojamientoPersistida.test.ts`). `capacidad` es el único
 * campo que varía entre los casos de esta ronda. */
function filaTarifaUnidad(over: { categoria: string; alimentacion: string; maxPax: number | null; minPax?: number }) {
  const { categoria, alimentacion, maxPax, minPax = 1 } = over;
  return {
    id: 1,
    hotel_id: 216,
    tarifa_id: `t-${categoria}-${alimentacion}`,
    version_tarifario: "v1",
    temporada: "GENERAL",
    categoria,
    alimentacion,
    estado: "publicada",
    fuente_documento: null,
    fuente_pagina: null,
    comision_pct: 20,
    payload: {
      id: `t-${categoria}-${alimentacion}`,
      versionTarifario: "v1",
      unidadCobro: "habitacion",
      comisionPct: 20,
      valores: { adulto: 700_000 },
      capacidad: { minPax, maxPax, paxIncluidos: 2 },
      suplementos: [],
      reglaMenores: { reglas: [{ categoria: "nino", edadMinAnios: 3, edadMaxAnios: 10 }, { categoria: "infante", edadMinAnios: 0, edadMaxAnios: 2 }] },
      temporada: "GENERAL",
      categoria,
      alimentacion,
      fuente: null,
    },
  };
}

const ENTRADA_BASE = {
  hotelId: 216,
  ofertas: [OFERTA],
  fila: FILA,
  temporadasRaw: [TEMPORADA_RAW] as unknown[],
  filasTarifas: [] as unknown[],
  habitacionesConsultadas: [{ acom: "doble" as const }],
  adultosDeclarados: 2,
  edadesMenores: [] as number[],
  fechaIda: FECHA_IDA,
  fechaRegreso: FECHA_REGRESO,
  hoy: HOY,
};

function computarSiempreOk(precioVenta = 500_000): (input: EntradaComputarDisponibilidad) => Promise<ResultadoComputarDisponibilidad> {
  return async () => ({ ok: true, precioVenta, moneda: "COP", paxTotal: 2 });
}
function computarSiempreCodigo(codigo: string): (input: EntradaComputarDisponibilidad) => Promise<ResultadoComputarDisponibilidad> {
  return async () => ({ ok: false, codigo, mensaje: `mensaje interno de ${codigo}` });
}
/** Precio distinto por combinación (categoria×alimentacion) — para probar
 * ordenamiento por precio y selectores dependientes con datos reales. */
function computarPorCombo(
  precios: Record<string, number>
): (input: EntradaComputarDisponibilidad) => Promise<ResultadoComputarDisponibilidad> {
  return async (input) => {
    const clave = `${input.categoria}|${input.alimentacion}`;
    const precio = precios[clave];
    if (precio == null) return { ok: false, codigo: "no_cotizable", mensaje: "sin tarifa para este combo" };
    return { ok: true, precioVenta: precio, moneda: "COP", paxTotal: 2 };
  };
}

describe("evaluarDisponibilidadHotelUnidad — comportamiento REAL (ejecutable, no wiring)", () => {
  test("hotel unidad con UNA combinación válida → aparece disponible con esa única opción, categoría/alimentación/precio incluidos", async () => {
    const ofertaUnaCombo: HotelBernaloDescubierto = { ...OFERTA, categorias: ["Estandar"], regimenes: ["PC"] };
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, ofertas: [ofertaUnaCombo], computar: computarSiempreOk(500_000) });
    assert.equal(veredicto.tipo, "veredicto");
    if (veredicto.tipo !== "veredicto") return;
    assert.equal(veredicto.valor.estado, "disponible");
    if (veredicto.valor.estado !== "disponible") return;
    assert.equal(veredicto.valor.opciones.length, 1);
    const op = veredicto.valor.opciones[0];
    assert.equal(op.categoria, "Estandar");
    assert.equal(op.alimentacion, "PC");
    assert.equal(op.precioVenta, 500_000);
    assert.equal(op.moneda, "COP");
    assert.equal(op.paxTotal, 2);
    assert.equal(veredicto.parcial, false);
  });

  test("dos combinaciones válidas → las DOS aparecen, ordenadas por precio ascendente (la más barata primero, preselección por defecto)", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({
      ...ENTRADA_BASE,
      computar: computarPorCombo({ "Estandar|PC": 600_000, "Estandar|PAM": 700_000, "Superior|PC": 500_000, "Superior|PAM": 900_000 }),
    });
    assert.equal(veredicto.tipo, "veredicto");
    if (veredicto.tipo !== "veredicto" || veredicto.valor.estado !== "disponible") return;
    assert.equal(veredicto.valor.opciones.length, 4, "las 4 combinaciones del cartesiano confirmaron — deben estar TODAS");
    // La primera es la más barata: Superior|PC a 500_000.
    assert.equal(veredicto.valor.opciones[0].categoria, "Superior");
    assert.equal(veredicto.valor.opciones[0].alimentacion, "PC");
    assert.equal(veredicto.valor.opciones[0].precioVenta, 500_000);
    // Y el arreglo completo queda ordenado ascendente.
    const precios = veredicto.valor.opciones.map((o) => o.precioVenta);
    assert.deepEqual(precios, [...precios].sort((a, b) => a - b));
  });

  test("una combinación inválida (no_cotizable) NUNCA aparece entre las opciones — solo el producto cartesiano REALMENTE cotizable", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({
      ...ENTRADA_BASE,
      // Solo Estandar|PC y Superior|PAM confirman; las otras dos combinaciones
      // del cartesiano (Estandar|PAM, Superior|PC) no traen precio → no_cotizable.
      computar: computarPorCombo({ "Estandar|PC": 500_000, "Superior|PAM": 800_000 }),
    });
    assert.equal(veredicto.tipo, "veredicto");
    if (veredicto.tipo !== "veredicto" || veredicto.valor.estado !== "disponible") return;
    assert.equal(veredicto.valor.opciones.length, 2, "solo las 2 combinaciones que de verdad cotizaron");
    const claves = veredicto.valor.opciones.map((o) => `${o.categoria}|${o.alimentacion}`).sort();
    assert.deepEqual(claves, ["Estandar|PC", "Superior|PAM"]);
    // No es "sin disponibilidad real" pura (no_cotizable SÍ está en la lista
    // honesta de motivos legítimos) — parcial debe quedar false: no hubo
    // ningún código TÉCNICO, solo combinaciones sin tarifa.
    assert.equal(veredicto.parcial, false);
  });

  test("empate de precio se rompe determinísticamente por paqueteId → categoría → alimentación (nunca por orden de llegada de la promesa)", async () => {
    const dosOfertas: HotelBernaloDescubierto[] = [
      { ...OFERTA, paqueteId: 502, categorias: ["B"], regimenes: ["X"] },
      { ...OFERTA, paqueteId: 501, categorias: ["A"], regimenes: ["X"] },
    ];
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, ofertas: dosOfertas, computar: computarSiempreOk(500_000) });
    assert.equal(veredicto.tipo, "veredicto");
    if (veredicto.tipo !== "veredicto" || veredicto.valor.estado !== "disponible") return;
    assert.equal(veredicto.valor.opciones.length, 2);
    // Mismo precio en las dos — gana el paqueteId menor (501).
    assert.equal(veredicto.valor.opciones[0].paqueteId, 501);
    assert.equal(veredicto.valor.opciones[1].paqueteId, 502);
  });

  test("compararOpciones: precio gana siempre; en empate de precio Y paqueteId, categoría; en empate total, alimentación", () => {
    const base: OpcionUnidadConfirmada = {
      hotelId: 1, hotelNombre: "H", paqueteId: 1, paqueteNombre: "P", destinoNombre: null,
      categoria: "A", alimentacion: "PC", moneda: "COP", precioVenta: 100, paxTotal: 2,
      fechaIda: "2026-01-01", fechaRegreso: "2026-01-04", ocupacion: [],
    };
    assert.ok(compararOpciones(base, { ...base, precioVenta: 200 }) < 0);
    assert.ok(compararOpciones({ ...base, precioVenta: 200 }, base) > 0);
    assert.ok(compararOpciones(base, { ...base, paqueteId: 2 }) < 0);
    assert.ok(compararOpciones(base, { ...base, categoria: "B" }) < 0);
    assert.ok(compararOpciones(base, { ...base, alimentacion: "PD" }) < 0);
    assert.equal(compararOpciones(base, { ...base }), 0);
  });

  test("ningún campo privado del resultado de computarReservaBernalo llega a OpcionUnidadConfirmada — solo hotelId/hotelNombre/paqueteId/paqueteNombre/destinoNombre/categoria/alimentacion/moneda/precioVenta/paxTotal/fechaIda/fechaRegreso/ocupacion", async () => {
    // `computar` de prueba devuelve SOLO los 3 campos que el tipo público
    // exige (`ok:true; precioVenta; moneda; paxTotal`) — si el código
    // intentara leer cualquier otro campo (costoNeto, proveedor, comisión,
    // snapshot…) fallaría en tiempo de ejecución (undefined) o TypeScript no
    // dejaría compilar `ResultadoComputarDisponibilidad` con esos campos.
    const veredicto = await evaluarDisponibilidadHotelUnidad({
      ...ENTRADA_BASE,
      ofertas: [{ ...OFERTA, categorias: ["Estandar"], regimenes: ["PC"] }],
      computar: computarSiempreOk(500_000),
    });
    assert.equal(veredicto.tipo, "veredicto");
    if (veredicto.tipo !== "veredicto" || veredicto.valor.estado !== "disponible") return;
    const claves = Object.keys(veredicto.valor.opciones[0]).sort();
    assert.deepEqual(claves, [
      "alimentacion", "categoria", "destinoNombre", "fechaIda", "fechaRegreso",
      "hotelId", "hotelNombre", "moneda", "ocupacion", "paqueteId", "paqueteNombre", "paxTotal", "precioVenta",
    ]);
    for (const prohibido of ["costoNeto", "costo", "proveedor", "comision", "snapshot", "habitaciones", "aportePvpHotel"]) {
      assert.ok(!(prohibido in veredicto.valor.opciones[0]), `campo privado filtrado: ${prohibido}`);
    }
  });

  test("computarReservaBernalo con fechas_fuera_de_ventana en TODAS las combinaciones → sin_disponibilidad (veredicto con fundamento, no inconcluyente)", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, computar: computarSiempreCodigo("fechas_fuera_de_ventana") });
    assert.deepEqual(veredicto, { tipo: "veredicto", valor: { hotelId: 216, estado: "sin_disponibilidad" } });
  });

  test("computarReservaBernalo con no_cotizable en TODAS las combinaciones → sin_disponibilidad", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, computar: computarSiempreCodigo("no_cotizable") });
    assert.deepEqual(veredicto, { tipo: "veredicto", valor: { hotelId: 216, estado: "sin_disponibilidad" } });
  });

  test("computarReservaBernalo con un código TÉCNICO (moneda_no_determinable) en TODAS las combinaciones → INCONCLUYENTE, nunca sin_disponibilidad ni disponible", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, computar: computarSiempreCodigo("moneda_no_determinable") });
    assert.equal(veredicto.tipo, "inconcluyente");
    if (veredicto.tipo !== "inconcluyente") return;
    assert.equal(veredicto.hotelId, 216);
    assert.match(veredicto.motivo, /moneda_no_determinable/);
  });

  test("algún éxito Y algún código TÉCNICO en el mismo hotel → disponible con las opciones que SÍ confirmaron, marcado `parcial: true`", async () => {
    let llamada = 0;
    const computar = async (): Promise<ResultadoComputarDisponibilidad> => {
      llamada++;
      if (llamada === 1) return { ok: true, precioVenta: 500_000, moneda: "COP", paxTotal: 2 };
      return { ok: false, codigo: "error_interno", mensaje: "x" };
    };
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, computar });
    assert.equal(veredicto.tipo, "veredicto");
    if (veredicto.tipo !== "veredicto" || veredicto.valor.estado !== "disponible") return;
    assert.ok(veredicto.valor.opciones.length >= 1, "al menos la combinación que confirmó debe quedar disponible");
    assert.equal(veredicto.parcial, true, "un código técnico entre las que NO confirmaron marca la evaluación como parcial");
  });

  test("sin fila maestra (drift entre el lote de hoteles y el descubrimiento) → inconcluyente, nunca se inventa un umbral de edad", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, fila: undefined, computar: computarSiempreOk() });
    assert.deepEqual(veredicto, { tipo: "inconcluyente", hotelId: 216, motivo: "hotel_sin_fila_maestra" });
  });

  test("Adults Only con menores declarados → sin_disponibilidad (veredicto real, tiene fundamento — el dato del hotel es autoritativo)", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({
      ...ENTRADA_BASE,
      fila: { ...FILA, adults_only: true },
      edadesMenores: [5],
      computar: computarSiempreOk(),
    });
    assert.deepEqual(veredicto, { tipo: "veredicto", valor: { hotelId: 216, estado: "sin_disponibilidad" } });
  });

  test("hotel con ofertas pero SIN ninguna combinación categoría×alimentación evaluable → inconcluyente (drift de datos), nunca sin_disponibilidad", async () => {
    const ofertaSinCombos: HotelBernaloDescubierto = { ...OFERTA, categorias: [], regimenes: [] };
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, ofertas: [ofertaSinCombos], computar: computarSiempreOk() });
    assert.deepEqual(veredicto, { tipo: "inconcluyente", hotelId: 216, motivo: "sin_combinaciones_para_evaluar" });
  });

  test("nunca escribe/muta la entrada recibida (de solo lectura)", async () => {
    const ofertasCopia = [{ ...OFERTA }];
    const entrada = { ...ENTRADA_BASE, ofertas: ofertasCopia, computar: computarSiempreOk() };
    await evaluarDisponibilidadHotelUnidad(entrada);
    assert.deepEqual(ofertasCopia, [OFERTA]);
  });

  test("evalúa TODAS las combinaciones (ya no se corta en el primer éxito): con 4 combinaciones, computar() se llama 4 veces", async () => {
    let llamadas = 0;
    const computar = async (): Promise<ResultadoComputarDisponibilidad> => {
      llamadas++;
      return { ok: true, precioVenta: 100_000 * llamadas, moneda: "COP", paxTotal: 2 };
    };
    await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, computar }); // OFERTA tiene 2 categorías × 2 regímenes = 4
    assert.equal(llamadas, 4);
  });

  // ── Caso obligatorio del encargo: hotel SIN hotel_acomodaciones ────────
  describe("capacidad autoritativa desde la tarifa unidad publicada (SIN hotel_acomodaciones)", () => {
    test("Caso obligatorio: 1 Doble, 2 adultos + 1 menor de 8 años, tarifa maxPax=3/paxIncluidos=2 → disponible, paxTotal=3, precioVenta=$700.000", async () => {
      const ofertaUnaCombo: HotelBernaloDescubierto = { ...OFERTA, categorias: ["Estandar"], regimenes: ["PC"] };
      const filasTarifas = [filaTarifaUnidad({ categoria: "Estandar", alimentacion: "PC", maxPax: 3 })];
      let habitacionesRecibidas: EntradaComputarDisponibilidad["habitaciones"] | null = null;
      const computar = async (input: EntradaComputarDisponibilidad): Promise<ResultadoComputarDisponibilidad> => {
        habitacionesRecibidas = input.habitaciones;
        return { ok: true, precioVenta: 700_000, moneda: "COP", paxTotal: 3 };
      };
      const veredicto = await evaluarDisponibilidadHotelUnidad({
        ...ENTRADA_BASE,
        ofertas: [ofertaUnaCombo],
        filasTarifas,
        adultosDeclarados: 2,
        edadesMenores: [8],
        computar,
      });
      assert.equal(veredicto.tipo, "veredicto");
      if (veredicto.tipo !== "veredicto") return;
      assert.equal(veredicto.valor.estado, "disponible");
      if (veredicto.valor.estado !== "disponible") return;
      assert.equal(veredicto.valor.opciones.length, 1);
      assert.equal(veredicto.valor.opciones[0].precioVenta, 700_000);
      assert.equal(veredicto.valor.opciones[0].paxTotal, 3);
      // La habitación física que de verdad llegó a `computar` (y por lo tanto
      // a `computarReservaBernalo` en producción) trae los 2 adultos + el
      // menor de 8 — NUNCA quedó rechazada antes de intentar cotizar.
      assert.equal(habitacionesRecibidas!.length, 1);
      assert.equal(habitacionesRecibidas![0].adultos, 2);
      assert.deepEqual(habitacionesRecibidas![0].edadesMenores, [8]);
    });

    test("mismo caso con maxPax=2 → sin disponibilidad (2 adultos + 1 menor = 3 pax, excede la capacidad real de la tarifa)", async () => {
      const ofertaUnaCombo: HotelBernaloDescubierto = { ...OFERTA, categorias: ["Estandar"], regimenes: ["PC"] };
      const filasTarifas = [filaTarifaUnidad({ categoria: "Estandar", alimentacion: "PC", maxPax: 2 })];
      const veredicto = await evaluarDisponibilidadHotelUnidad({
        ...ENTRADA_BASE,
        ofertas: [ofertaUnaCombo],
        filasTarifas,
        adultosDeclarados: 2,
        edadesMenores: [8],
        computar: computarSiempreOk(700_000),
      });
      assert.deepEqual(veredicto, { tipo: "veredicto", valor: { hotelId: 216, estado: "sin_disponibilidad" } });
    });

    test("sin ninguna fila hotel_tarifas_unidad resuelta (combinación sin tarifa) → reparto SIN COTA, la decisión final queda en computar()", async () => {
      // filasTarifas vacío (ENTRADA_BASE) → resolverCapacidadTarifaUnidad
      // falla para TODAS las combinaciones → capacidad {minPax:1,maxPax:null}.
      // Si `computar` (el doble de computarReservaBernalo) igual confirma,
      // el hotel debe quedar disponible — nunca se rechaza acá algo que el
      // motor real admitiría.
      const veredicto = await evaluarDisponibilidadHotelUnidad({
        ...ENTRADA_BASE,
        adultosDeclarados: 5,
        edadesMenores: [],
        computar: computarSiempreOk(900_000),
      });
      assert.equal(veredicto.tipo, "veredicto");
      if (veredicto.tipo !== "veredicto") return;
      assert.equal(veredicto.valor.estado, "disponible");
    });

    test("varias habitaciones con capacidades DIFERENTES por combinación: la combinación con maxPax=2 (por habitación) queda sin_disponibilidad para 2 habitaciones con 5 pax, pero otra con maxPax=3 SÍ confirma — cada combo se evalúa con su propia capacidad", async () => {
      const ofertaDosCombosCapacidadDistinta: HotelBernaloDescubierto = { ...OFERTA, categorias: ["Chica", "Grande"], regimenes: ["PC"] };
      const filasTarifas = [
        filaTarifaUnidad({ categoria: "Chica", alimentacion: "PC", maxPax: 2 }),
        filaTarifaUnidad({ categoria: "Grande", alimentacion: "PC", maxPax: 3 }),
      ];
      // 2 habitaciones, 4 adultos + 1 menor = 5 pax → cabe en "Grande" (2×3=6)
      // pero NO en "Chica" (2×2=4).
      const veredicto = await evaluarDisponibilidadHotelUnidad({
        ...ENTRADA_BASE,
        ofertas: [ofertaDosCombosCapacidadDistinta],
        filasTarifas,
        habitacionesConsultadas: [{ acom: "doble" }, { acom: "doble" }],
        adultosDeclarados: 4,
        edadesMenores: [8],
        computar: computarSiempreOk(1_200_000),
      });
      assert.equal(veredicto.tipo, "veredicto");
      if (veredicto.tipo !== "veredicto" || veredicto.valor.estado !== "disponible") return;
      const claves = veredicto.valor.opciones.map((o) => o.categoria).sort();
      assert.deepEqual(claves, ["Grande"], "solo la combinación con capacidad suficiente (Grande) debe confirmar");
    });

    test("2 habitaciones reparten 2 menores sin falso negativo: maxPax=2, 2 adultos + 2 menores solo cabe repartiendo 1 por habitación — dumping ambos en la primera excedería su capacidad", async () => {
      const ofertaUnaCombo: HotelBernaloDescubierto = { ...OFERTA, categorias: ["Estandar"], regimenes: ["PC"] };
      const filasTarifas = [filaTarifaUnidad({ categoria: "Estandar", alimentacion: "PC", maxPax: 2 })];
      let habitacionesRecibidas: EntradaComputarDisponibilidad["habitaciones"] | null = null;
      const computar = async (input: EntradaComputarDisponibilidad): Promise<ResultadoComputarDisponibilidad> => {
        habitacionesRecibidas = input.habitaciones;
        return { ok: true, precioVenta: 1_400_000, moneda: "COP", paxTotal: 4 };
      };
      const veredicto = await evaluarDisponibilidadHotelUnidad({
        ...ENTRADA_BASE,
        ofertas: [ofertaUnaCombo],
        filasTarifas,
        habitacionesConsultadas: [{ acom: "doble" }, { acom: "doble" }],
        adultosDeclarados: 2,
        edadesMenores: [8, 9],
        computar,
      });
      assert.equal(veredicto.tipo, "veredicto");
      if (veredicto.tipo !== "veredicto") return;
      assert.equal(
        veredicto.valor.estado,
        "disponible",
        "un reparto que dumpea ambos menores en la primera habitación (1 adulto + 2 menores = 3 > maxPax 2) rechazaría esto falsamente"
      );
      assert.equal(habitacionesRecibidas!.length, 2);
      // Ninguna habitación excede maxPax=2, y cada una tiene al menos 1 adulto.
      for (const h of habitacionesRecibidas!) {
        assert.ok(h.adultos >= 1);
        assert.ok(h.adultos + h.edadesMenores.length <= 2);
      }
      // Los 2 menores quedaron repartidos UNO por habitación — nunca ambos en la misma.
      assert.deepEqual(habitacionesRecibidas!.map((h) => h.edadesMenores.length).sort(), [1, 1]);
    });
  });
});

describe("ofertasPorHotelDe / combinacionesDe — helpers puros reutilizados por el veredicto", () => {
  test("ofertasPorHotelDe agrupa por hotelId y descarta ofertas que no son porcion_terrestre", () => {
    const mapa = ofertasPorHotelDe([
      OFERTA,
      { ...OFERTA, tipo: "bloqueo" },
      { ...OFERTA, hotelId: 300, paqueteId: 999 },
    ]);
    assert.deepEqual([...mapa.keys()].sort(), [216, 300]);
    assert.equal(mapa.get(216)?.length, 1);
  });

  test("combinacionesDe arma el producto cartesiano categoría×alimentación por oferta", () => {
    const combos = combinacionesDe([{ ...OFERTA, categorias: ["A", "B"], regimenes: ["PC", "PAM"] }]);
    assert.equal(combos.length, 4);
    assert.deepEqual(
      combos.map((c) => `${c.categoria}-${c.alimentacion}`).sort(),
      ["A-PAM", "A-PC", "B-PAM", "B-PC"]
    );
  });

  test("combinacionesDe de un hotel sin ofertas devuelve vacío (no lanza)", () => {
    assert.deepEqual(combinacionesDe([]), []);
  });
});
