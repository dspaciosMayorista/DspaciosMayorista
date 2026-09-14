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
// Pruebas de COMPORTAMIENTO REAL (no wiring) del cierre de UX de la tarjeta
// unidad: "Hotel Prueba Odair" (y cualquier hotel `modelo_tarifario =
// 'unidad'') ya aparecía en el buscador general, pero su tarjeta solo
// mostraba "Disponible para tus fechas" — sin categoría/alimentación/precio,
// obligando a abrir un modal y repetir fechas/ocupación que el buscador YA
// tenía.
//
// A diferencia de `busquedaPorcionTerrestreWiring.test.ts` (que inspecciona
// texto fuente porque `busquedaUnidadActions.ts` es un archivo `"use
// server"` que no se puede invocar bajo `node --test` sin Next/Supabase),
// este archivo EJECUTA de verdad `evaluarDisponibilidadHotelUnidad` —
// exactamente la función que usa la Server Action real — con un `computar`
// de prueba inyectado en lugar de `computarReservaBernalo`.
//
// Cambio de fondo de esta ronda: la evaluación YA NO se corta en el primer
// éxito — reúne TODAS las combinaciones categoría×alimentación que
// confirman, con su precio público saneado (`OpcionUnidadConfirmada`), para
// que la tarjeta pueda ofrecer selectores reales sin volver a cotizar.
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

  test("evalúa TODAS las combinaciones (ya no se corta en el primer éxito): con 4 combinaciones, computar() se llama 4 veces", async () => {
    let llamadas = 0;
    const computar = async (): Promise<ResultadoComputarDisponibilidad> => {
      llamadas++;
      return { ok: true, precioVenta: 100_000 * llamadas, moneda: "COP", paxTotal: 2 };
    };
    await evaluarDisponibilidadHotelUnidad({ ...ENTRADA_BASE, computar }); // OFERTA tiene 2 categorías × 2 regímenes = 4
    assert.equal(llamadas, 4);
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
