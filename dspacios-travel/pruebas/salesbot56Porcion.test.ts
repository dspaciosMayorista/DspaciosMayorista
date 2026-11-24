import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { FilaTarifario } from "../app/tarifario/TarifarioPublic.tsx";
import type { BusquedaResultado, CotizarResult } from "../lib/reservar/cotizar.ts";
import { clavesProhibidasEn } from "../lib/salesbot/contrato.ts";
import {
  aCotizacionPorPersona,
  aResultadoBusquedaPorcion,
  destinosPorcion,
  entradaBuscarHoteles,
  entradaComputoPorcion,
  porcionPublicada,
  sugerenciasPublicas,
  validarConsultaPorcion,
  validarSeleccionPorcion,
} from "../lib/salesbot/paquetes/porcion.ts";

// #56 multiproducto — PORCIÓN TERRESTRE, funciones puras: destino obligatorio
// y publicado (nunca se reliquida el catálogo entero), entradas con la misma
// forma que Vista Booking, total del motor renombrado a `total_orientativo` y
// sin ningún neto aunque el motor lo traiga.

const fila = (f: Partial<FilaTarifario>): FilaTarifario =>
  ({
    modulo: "porcion_terrestre",
    bloqueo_label: null,
    paquete_id: 50,
    hotel_id: 217,
    fecha_ida: null,
    fecha_regreso: null,
    noches: 3,
    destino_nombre: "SAN ANDRÉS",
    paquete_nombre: "Porción San Andrés",
    hotel_nombre: "Hotel Isla",
    categoria: "Estándar",
    regimen: "PAE",
    acomodacion: "doble",
    precio_pvp: 300_000,
    ...f,
  }) as FilaTarifario;

const FILAS = [
  fila({}),
  fila({ destino_nombre: " CARTAGENA ", hotel_id: 300 }),
  fila({ destino_nombre: "SAN ANDRÉS", hotel_id: 218 }),
  fila({ modulo: "bloqueo", destino_nombre: "MEDELLÍN", bloqueo_id: 1 }),
  fila({ destino_nombre: null }),
];

describe("destinos y publicación", () => {
  test("solo destinos con porción publicada, sin duplicados y ordenados", () => {
    assert.deepEqual(destinosPorcion(FILAS), ["CARTAGENA", "SAN ANDRÉS"]);
  });
  test("la combinación paquete + hotel debe estar publicada (falla cerrado)", () => {
    assert.equal(porcionPublicada(FILAS, 50, 217), true);
    assert.equal(porcionPublicada(FILAS, 50, 999), false);
    assert.equal(porcionPublicada([fila({ modulo: "bloqueo" })], 50, 217), false);
  });
});

describe("validarConsultaPorcion", () => {
  const destinos = ["SAN ANDRÉS", "CARTAGENA"];
  const base = { destino: "SAN ANDRÉS", fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", adultos: "2", hab_doble: "1" };

  test("consulta válida", () => {
    assert.deepEqual(validarConsultaPorcion({ ...base, edadesMenores: "4", limite: "5" }, destinos), {
      ok: true,
      consulta: { destino: "SAN ANDRÉS", fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", adultos: 2, composicion: { habitaciones: { doble: 1 }, edadesMenores: [4] }, limite: 5 },
    });
  });
  test("el destino es obligatorio y debe ser uno publicado", () => {
    assert.deepEqual(validarConsultaPorcion({ ...base, destino: "" }, destinos), { ok: false, campos: ["destino"] });
    assert.deepEqual(validarConsultaPorcion({ ...base, destino: "PARÍS" }, destinos), { ok: false, campos: ["destino"] });
  });
  test("fechas: formato real y regreso posterior a la ida", () => {
    assert.deepEqual(validarConsultaPorcion({ ...base, fechaIda: "2027-02-30" }, destinos), { ok: false, campos: ["fechaIda"] });
    assert.deepEqual(validarConsultaPorcion({ ...base, fechaRegreso: "2027-03-10" }, destinos), { ok: false, campos: ["fechaRegreso"] });
    assert.deepEqual(validarConsultaPorcion({ ...base, fechaRegreso: "2027-03-01" }, destinos), { ok: false, campos: ["fechaRegreso"] });
  });
  test("adultos entre 1 y 40", () => {
    for (const a of ["0", "41", "x", "1.5", ""]) assert.deepEqual(validarConsultaPorcion({ ...base, adultos: a }, destinos), { ok: false, campos: ["adultos"] }, a);
  });
  test("composición y límite", () => {
    assert.deepEqual(validarConsultaPorcion({ ...base, hab_doble: "" }, destinos), { ok: false, campos: ["habitaciones"] });
    assert.deepEqual(validarConsultaPorcion({ ...base, limite: "51" }, destinos), { ok: false, campos: ["limite"] });
  });
});

describe("entradas de los motores: la misma forma que Vista Booking", () => {
  const consulta = { destino: "SAN ANDRÉS", fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", adultos: 4, composicion: { habitaciones: { doble: 2, sencilla: 1 }, edadesMenores: [3, 8] } };

  test("buscarHoteles: una entrada por habitación en el orden de ACOM_ROOMS, menores por edad", () => {
    assert.deepEqual(entradaBuscarHoteles(consulta), {
      fechaIda: "2027-03-10",
      fechaRegreso: "2027-03-13",
      habitaciones: [{ acom: "sencilla" }, { acom: "doble" }, { acom: "doble" }],
      adultos: 4,
      cantidadMenores: 2,
      edadesMenores: [3, 8],
      destino: "SAN ANDRÉS",
    });
  });

  test("computarReserva: porción con fechas reales, sin vuelo, sin datos personales, add-on ni mascotas", () => {
    const e = entradaComputoPorcion({ paqueteId: 50, hotelId: 217, fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", categoria: "Estándar", regimen: "PAE", composicion: consulta.composicion });
    assert.equal(e.modulo, "porcion_terrestre");
    assert.equal(e.bloqueoId, null);
    assert.equal("empaquetadoId" in e, false);
    assert.deepEqual([e.fechaIda, e.fechaRegreso], ["2027-03-10", "2027-03-13"]);
    assert.deepEqual(e.habitaciones, { doble: 2, sencilla: 1 });
    assert.deepEqual([e.ninos, e.ninos2, e.infantes], [0, 0, 0]);
    assert.deepEqual(e.edadesMenores, [3, 8]);
    assert.equal(e.cantidadMenores, 2);
    assert.deepEqual(e.pasajeros, []);
    assert.deepEqual(e.servicios, []);
    assert.equal("mascotas" in e, false);
    assert.deepEqual(e.cliente, { nombres: "", apellidos: "", tipoDoc: "", numeroDoc: "", telefono: "", email: "" });
  });
});

/** Resultado de `buscarHoteles` con campos extra que nunca deben salir. */
const resultado = (sobre: Partial<BusquedaResultado> & Record<string, unknown> = {}): BusquedaResultado =>
  ({
    hotelId: 217,
    hotelNombre: "Hotel Isla",
    destino: "SAN ANDRÉS",
    paqueteId: 50,
    paqueteNombre: "Porción San Andrés",
    categoria: "Estándar",
    regimen: "PAE",
    total: 1_800_000,
    noches: 3,
    fechaIda: "2027-03-10",
    fechaRegreso: "2027-03-13",
    moneda: "cop",
    habitaciones: { doble: 1 },
    menores: { nino: 0, nino2: 0, infante: 0 },
    edadesMenores: [],
    pax: 2,
    combos: [
      { categoria: "Estándar", regimen: "PAE", total: 1_800_000, pax: 2, menores: { nino: 0, nino2: 0, infante: 0 }, netos: { doble: 711_000 } },
      { categoria: "Superior", regimen: "PC", total: 2_100_000, pax: 2, menores: { nino: 0, nino2: 0, infante: 0 } },
    ],
    condicion: { condicionPagoTipo: "anticipo", pctInicial: 30, diasSaldo: 15, restringido: true },
    costoNeto: 711_000,
    proveedorId: 88,
    ...sobre,
  }) as unknown as BusquedaResultado;

describe("aResultadoBusquedaPorcion", () => {
  test("total → total_orientativo por combo; moneda en mayúsculas; condición de pago pública", () => {
    const r = aResultadoBusquedaPorcion([resultado()], []);
    assert.deepEqual(r.resultados[0].combos, [
      { categoria: "Estándar", regimen: "PAE", total_orientativo: 1_800_000, pax: 2 },
      { categoria: "Superior", regimen: "PC", total_orientativo: 2_100_000, pax: 2 },
    ]);
    assert.equal(r.resultados[0].moneda, "COP");
    assert.deepEqual(r.resultados[0].condicion_pago, { tipo: "anticipo", pct_inicial: 30, dias_saldo: 15, no_reembolsable: true });
    assert.equal(r.resultados[0].disponibilidad_hotel, "sujeto_a_confirmacion");
  });
  test("ningún neto, costo ni proveedor del motor sale", () => {
    const r = aResultadoBusquedaPorcion([resultado()], []);
    assert.deepEqual(clavesProhibidasEn(r), []);
    const json = JSON.stringify(r);
    for (const v of ["711000", "88", "netos", "costoNeto"]) assert.equal(json.includes(v), false, v);
  });
  test("límite y truncado; sin condición → null", () => {
    const r = aResultadoBusquedaPorcion([resultado(), resultado({ hotelId: 218, condicion: null }), resultado({ hotelId: 219 })], [], 2);
    assert.equal(r.resultados.length, 2);
    assert.equal(r.total_encontrados, 3);
    assert.equal(r.truncado, true);
    assert.equal(r.resultados[1].condicion_pago, null);
  });
  test("sugerencias de fecha en forma pública", () => {
    const r = aResultadoBusquedaPorcion([], [{ fechaIda: "2027-03-11", fechaRegreso: "2027-03-14", noches: 3, etiqueta: "11 mar - 14 mar" }]);
    assert.deepEqual(r.sugerencias_fecha, [{ fecha_ida: "2027-03-11", fecha_regreso: "2027-03-14", noches: 3, etiqueta: "11 mar - 14 mar" }]);
    assert.deepEqual(sugerenciasPublicas(undefined), []);
  });
});

describe("validarSeleccionPorcion", () => {
  const base = { paquete: "50", hotel: "217", fechaIda: "2027-03-10", fechaRegreso: "2027-03-13" };

  test("sin combo: precio por persona, no exige composición", () => {
    assert.deepEqual(validarSeleccionPorcion(base), {
      ok: true,
      seleccion: { paqueteId: 50, hotelId: 217, fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", categoria: null, regimen: null, composicion: null },
    });
  });
  test("con combo: exige composición válida", () => {
    assert.deepEqual(validarSeleccionPorcion({ ...base, combo: "Estándar|PAE" }), { ok: false, campos: ["habitaciones"] });
    const v = validarSeleccionPorcion({ ...base, combo: "Estándar|PAE", hab_doble: "1", edadesMenores: "6" });
    assert.ok(v.ok);
    if (v.ok) assert.deepEqual(v.seleccion.composicion, { habitaciones: { doble: 1 }, edadesMenores: [6] });
  });
  test("ids, fechas y combo mal formados", () => {
    assert.deepEqual(validarSeleccionPorcion({ ...base, paquete: "x", hotel: "-1" }), { ok: false, campos: ["paquete", "hotel"] });
    assert.deepEqual(validarSeleccionPorcion({ ...base, fechaRegreso: "2027-03-09" }), { ok: false, campos: ["fechaRegreso"] });
    assert.deepEqual(validarSeleccionPorcion({ ...base, combo: "|PAE", hab_doble: "1" }), { ok: false, campos: ["combo"] });
  });
});

describe("aCotizacionPorPersona", () => {
  const sel = { paqueteId: 50, hotelId: 217, fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", categoria: null, regimen: null, composicion: null };
  const cot = (sobre: Partial<Extract<CotizarResult, { ok: true }>> = {}) =>
    ({
      ok: true,
      combos: [
        { categoria: "Estándar", regimen: "PAE", precios: { doble: 300_000, sencilla: 450_000, nino: 0 }, netos: { doble: 211_000 } },
        { categoria: "Vacía", regimen: "PC", precios: { neto: 1 } },
      ],
      noches: 3,
      moneda: "usd",
      condicion: null,
      serviciosGrupoPendientes: [],
      ...sobre,
    }) as Extract<CotizarResult, { ok: true }>;

  test("PVP por persona publicables; combo sin precio publicable se omite; sin netos", () => {
    const r = aCotizacionPorPersona(sel, cot(), null);
    assert.deepEqual(r.combos, [{ categoria: "Estándar", regimen: "PAE", pvp_por_persona: { doble: 300_000, sencilla: 450_000, nino: 0 } }]);
    assert.equal(r.moneda, "USD");
    assert.equal(r.precio_no_final, false);
    assert.equal(r.cotizacion, null);
    assert.deepEqual(clavesProhibidasEn(r), []);
    assert.equal(JSON.stringify(r).includes("211000"), false);
  });
  test("servicios incluidos por grupo pendientes → precio_no_final con sus nombres", () => {
    const r = aCotizacionPorPersona(sel, cot({ serviciosGrupoPendientes: ["Traslado privado"] }), null);
    assert.equal(r.precio_no_final, true);
    assert.deepEqual(r.servicios_grupo_pendientes, ["Traslado privado"]);
  });
});
