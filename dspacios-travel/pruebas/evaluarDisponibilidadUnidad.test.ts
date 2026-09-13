import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluarDisponibilidadHotelUnidad,
  ofertasPorHotelDe,
  combinacionesDe,
  type EntradaComputarDisponibilidad,
  type ResultadoComputarDisponibilidad,
  type FilaHotelBusquedaUnidad,
} from "../lib/tarifario/evaluarDisponibilidadUnidad.ts";
import type { HotelBernaloDescubierto } from "../lib/tarifario/datosBernalo.ts";

// ─────────────────────────────────────────────────────────────────────────
// Pruebas de COMPORTAMIENTO REAL (no wiring) del cierre del hallazgo "Hotel
// Prueba Odair no aparece en el buscador general de Porción terrestre"
// (hotel_id=216, modelo_tarifario='unidad').
//
// A diferencia de `busquedaPorcionTerrestreWiring.test.ts` (que inspecciona
// texto fuente porque `busquedaUnidadActions.ts` es un archivo `"use
// server"` que no se puede invocar bajo `node --test` sin Next/Supabase),
// este archivo EJECUTA de verdad `evaluarDisponibilidadHotelUnidad` —
// exactamente la función que usa la Server Action real — con un
// `computar` de prueba inyectado en lugar de `computarReservaBernalo`. La
// extracción a `lib/tarifario/evaluarDisponibilidadUnidad.ts` existe
// específicamente para que esto sea posible (ver la cabecera de ese
// archivo).
//
// El defecto real: antes, CUALQUIER código de `computarReservaBernalo` que
// no fuera "fechas_fuera_de_ventana"/"no_cotizable" (p. ej.
// `moneda_no_determinable`, `salida_no_vinculada`, `configuracion_incompleta`,
// `error_interno`, drift de datos) hacía que el hotel devolviera `null` y
// desapareciera del arreglo de disponibilidad EN SILENCIO — indistinguible de
// "no evaluado". Estas pruebas verifican que ahora esa situación se distingue
// explícitamente como `{ tipo: "inconcluyente", motivo }`, nunca como
// "sin_disponibilidad" ni "disponible".
// ─────────────────────────────────────────────────────────────────────────

const OFERTA: HotelBernaloDescubierto = {
  hotelId: 216,
  hotelNombre: "Hotel Prueba Odair",
  paqueteId: 501,
  paqueteNombre: "Porción San Andrés",
  destinoNombre: "SAN ANDRÉS",
  destinoId: 7,
  tipo: "porcion_terrestre",
  categorias: ["Estandar"],
  regimenes: ["PC"],
  moneda: "COP",
  salidas: [],
};

const FILA: FilaHotelBusquedaUnidad = { id: 216, edad_infante_max: 2, edad_nino_max: 10, adults_only: false };

const ENTRADA_BASE = {
  hotelId: 216,
  ofertas: [OFERTA],
  fila: FILA,
  reglas: [] as never[],
  habitacionesConsultadas: [{ acom: "doble" as const }],
  adultosDeclarados: 2,
  edadesMenores: [] as number[],
  fechaIda: "2026-12-01",
  fechaRegreso: "2026-12-04",
};

function computarSiempreOk(): (input: EntradaComputarDisponibilidad) => Promise<ResultadoComputarDisponibilidad> {
  return async () => ({ ok: true });
}
function computarSiempreCodigo(codigo: string): (input: EntradaComputarDisponibilidad) => Promise<ResultadoComputarDisponibilidad> {
  return async () => ({ ok: false, codigo, mensaje: `mensaje interno de ${codigo}` });
}

describe("evaluarDisponibilidadHotelUnidad — comportamiento REAL (ejecutable, no wiring)", () => {
  test("hotel unidad descubierto + computarReservaBernalo ok → APARECE como disponible, con la identidad exacta", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, computar: computarSiempreOk() });
    assert.equal(veredicto.tipo, "veredicto");
    if (veredicto.tipo !== "veredicto") return;
    assert.equal(veredicto.valor.estado, "disponible");
    if (veredicto.valor.estado !== "disponible") return;
    assert.equal(veredicto.valor.hotelId, 216);
    assert.equal(veredicto.valor.oferta.hotelId, 216);
    assert.equal(veredicto.valor.oferta.hotelNombre, "Hotel Prueba Odair");
    assert.equal(veredicto.valor.oferta.paqueteId, 501);
    assert.equal(veredicto.valor.oferta.categoria, "Estandar");
    assert.equal(veredicto.valor.oferta.alimentacion, "PC");
    assert.equal(veredicto.valor.oferta.fechaIda, "2026-12-01");
    assert.equal(veredicto.valor.oferta.fechaRegreso, "2026-12-04");
    // Nunca pvp/costo/neto/snapshot/proveedor — la identidad es EXCLUSIVAMENTE
    // la de `OfertaUnidadConfirmada`.
    assert.deepEqual(Object.keys(veredicto.valor.oferta).sort(), [
      "alimentacion", "categoria", "destinoNombre", "fechaIda", "fechaRegreso",
      "hotelId", "hotelNombre", "moneda", "ocupacion", "paqueteId", "paqueteNombre",
    ]);
  });

  test("computarReservaBernalo con fechas_fuera_de_ventana en TODAS las combinaciones → sin_disponibilidad (veredicto con fundamento, no inconcluyente)", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, computar: computarSiempreCodigo("fechas_fuera_de_ventana") });
    assert.deepEqual(veredicto, { tipo: "veredicto", valor: { hotelId: 216, estado: "sin_disponibilidad" } });
  });

  test("computarReservaBernalo con no_cotizable en TODAS las combinaciones → sin_disponibilidad", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, computar: computarSiempreCodigo("no_cotizable") });
    assert.deepEqual(veredicto, { tipo: "veredicto", valor: { hotelId: 216, estado: "sin_disponibilidad" } });
  });

  test("computarReservaBernalo con un código TÉCNICO (moneda_no_determinable) → INCONCLUYENTE, nunca sin_disponibilidad ni disponible (el defecto real)", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, computar: computarSiempreCodigo("moneda_no_determinable") });
    assert.equal(veredicto.tipo, "inconcluyente");
    if (veredicto.tipo !== "inconcluyente") return;
    assert.equal(veredicto.hotelId, 216);
    // El motivo lleva el código REAL — para poder diagnosticar en los logs,
    // nunca en silencio.
    assert.match(veredicto.motivo, /moneda_no_determinable/);
  });

  test("computarReservaBernalo con configuracion_incompleta → inconcluyente (drift de datos: la oferta se descubrió pero el motor no la reconoce)", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, computar: computarSiempreCodigo("configuracion_incompleta") });
    assert.equal(veredicto.tipo, "inconcluyente");
  });

  test("computarReservaBernalo con salida_no_vinculada (plausible para un paquete de porción terrestre con vuelos residuales mal configurados) → inconcluyente, NUNCA se pierde en silencio", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, computar: computarSiempreCodigo("salida_no_vinculada") });
    assert.equal(veredicto.tipo, "inconcluyente");
    if (veredicto.tipo !== "inconcluyente") return;
    assert.match(veredicto.motivo, /salida_no_vinculada/);
  });

  test("computarReservaBernalo con error_interno → inconcluyente", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, computar: computarSiempreCodigo("error_interno") });
    assert.equal(veredicto.tipo, "inconcluyente");
  });

  test("dos combinaciones: la primera falla técnico, la segunda confirma → el hotel SÍ aparece disponible (agota combos antes de rendirse)", async () => {
    const dosOfertas: HotelBernaloDescubierto[] = [
      OFERTA,
      { ...OFERTA, paqueteId: 502, categorias: ["Superior"], regimenes: ["PAM"] },
    ];
    let llamada = 0;
    const computar = async (): Promise<ResultadoComputarDisponibilidad> => {
      llamada++;
      if (llamada === 1) return { ok: false, codigo: "moneda_no_determinable", mensaje: "x" };
      return { ok: true };
    };
    const veredicto = await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, ofertas: dosOfertas, computar });
    assert.equal(veredicto.tipo, "veredicto");
    assert.ok(llamada >= 2, "debe haber intentado más de una combinación");
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

  test("selección de habitaciones que no alcanza para los adultos declarados → sin_disponibilidad (rechazo honesto del reparto)", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({
      ...ENTRADA_BASE,
      adultosDeclarados: 5, // 1 habitación doble (pax_tarifa=2 por default) no cubre 5 adultos
      computar: computarSiempreOk(),
    });
    assert.deepEqual(veredicto, { tipo: "veredicto", valor: { hotelId: 216, estado: "sin_disponibilidad" } });
  });

  test("configuración de hotel_acomodaciones incoherente (adt_min > adt_max) → inconcluyente, NUNCA 'sin disponibilidad' (no es culpa del cliente)", async () => {
    const veredicto = await evaluarDisponibilidadHotelUnidad({
      ...ENTRADA_BASE,
      reglas: [{ acomodacion: "doble", pax_tarifa: 2, pax_max: 2, adt_min: 5, adt_max: 1, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 }],
      computar: computarSiempreOk(),
    });
    assert.equal(veredicto.tipo, "inconcluyente");
    if (veredicto.tipo !== "inconcluyente") return;
    assert.match(veredicto.motivo, /reparto_configuracion_invalida/);
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
