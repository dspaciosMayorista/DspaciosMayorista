import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { FilaTarifario } from "../app/tarifario/TarifarioPublic.tsx";
import type { ComputoReserva } from "../lib/reservar/computo.ts";
import { clavesProhibidasEn } from "../lib/salesbot/contrato.ts";
import { clasificarMensajeMotor, desdePorPersona, MOTIVO_NO_COTIZABLE_GENERICO, preciosPublicables, validarComposicion } from "../lib/salesbot/paquetes/contrato.ts";
import {
  buscarEnOfertas,
  cargoFueraDeLineas,
  claveOferta,
  disponibilidadVuelo,
  entradaComputoBloqueo,
  MOTIVO_CARGO_GRUPO_SIN_MARKUP,
  ofertaDeSeleccion,
  ofertasBloqueo,
  resolverCotizacion,
  validarCriteriosBloqueos,
  validarSeleccionBloqueo,
} from "../lib/salesbot/paquetes/bloqueo.ts";

// #56 multiproducto — BLOQUEOS, funciones puras: agrupación de la oferta
// publicada, estados de disponibilidad (nunca se afirma una silla que no se
// verificó), búsqueda, selección, entrada del motor (misma forma que el
// checkout) y reducción del resultado a la lista blanca (sin netos, record,
// datos de silla ni errores internos).

const fila = (f: Partial<FilaTarifario> & Record<string, unknown>): FilaTarifario =>
  ({
    modulo: "bloqueo",
    bloqueo_label: "BOG-ADZ",
    bloqueo_id: 10,
    empaquetado_id: null,
    paquete_id: 5,
    hotel_id: 7,
    fecha_ida: "2027-03-10",
    fecha_regreso: "2027-03-13",
    noches: 3,
    destino_nombre: "SAN ANDRÉS",
    paquete_nombre: "San Andrés marzo",
    hotel_nombre: "Hotel Caribe",
    categoria: "Estándar",
    regimen: "PAE",
    acomodacion: "doble",
    precio_pvp: 1_000_000,
    moneda: "COP",
    ...f,
  }) as FilaTarifario;

const FILAS: FilaTarifario[] = [
  fila({ acomodacion: "doble", precio_pvp: 1_000_000 }),
  fila({ acomodacion: "sencilla", precio_pvp: 1_500_000 }),
  fila({ acomodacion: "nino", precio_pvp: 400_000 }),
  fila({ acomodacion: "infante", precio_pvp: 0 }),
  fila({ regimen: "PC", acomodacion: "doble", precio_pvp: 1_200_000 }),
  // Empaquetado (tiquete de sistema) del mismo paquete y hotel: otra oferta.
  fila({ bloqueo_id: null, empaquetado_id: 3, bloqueo_label: "BOG-ADZ", fecha_ida: "2027-04-02", fecha_regreso: "2027-04-05", acomodacion: "doble", precio_pvp: 900_000 }),
  // Filas que NO forman oferta.
  fila({ bloqueo_id: 11, empaquetado_id: 4 }), // dos orígenes
  fila({ bloqueo_id: null, empaquetado_id: null }), // sin origen
  fila({ modulo: "porcion_terrestre", bloqueo_id: null }),
  fila({ hotel_id: null }),
];

const CUPOS = { 10: 3 };

describe("ofertasBloqueo: agrupación de la oferta publicada", () => {
  const ofertas = ofertasBloqueo(FILAS, CUPOS);

  test("una oferta por paquete × origen del vuelo × hotel; filas sin un único origen no forman oferta", () => {
    assert.deepEqual(ofertas.map((o) => o.clave).sort(), ["5-b10-7", "5-e3-7"]);
  });

  test("combos por categoría × régimen con el PVP por persona de cada acomodación (0 de un menor se conserva)", () => {
    const o = ofertas.find((x) => x.clave === "5-b10-7")!;
    assert.deepEqual(o.combos, [
      { categoria: "Estándar", regimen: "PAE", pvp_por_persona: { doble: 1_000_000, sencilla: 1_500_000, nino: 400_000, infante: 0 } },
      { categoria: "Estándar", regimen: "PC", pvp_por_persona: { doble: 1_200_000 } },
    ]);
  });

  test("el desde es el mínimo entre HABITACIONES, nunca un menor", () => {
    assert.equal(ofertas.find((x) => x.clave === "5-b10-7")!.desde_pvp_por_persona, 1_000_000);
    assert.equal(desdePorPersona([{ categoria: "a", regimen: "b", pvp_por_persona: { nino: 1, infante: 0 } }]), null);
  });

  test("origen: bloqueo negociado vs tiquete de sistema", () => {
    assert.equal(ofertas.find((x) => x.clave === "5-b10-7")!.origen_vuelo, "bloqueo");
    assert.equal(ofertas.find((x) => x.clave === "5-e3-7")!.origen_vuelo, "sistema");
  });

  test("ninguna clave extra de la fila llega a la oferta (lista blanca por construcción)", () => {
    const sucia = ofertasBloqueo(
      [fila({ record: "L93FYZ", tarifa_neta: 400_000, tarifa_para_empaquetar: 500_000, impuesto: 99_000, base_comisionable: 1, numero_silla: 4, pasajero_nombres: "Ana" })],
      CUPOS
    );
    assert.deepEqual(clavesProhibidasEn(sucia), []);
    const json = JSON.stringify(sucia);
    for (const v of ["L93FYZ", "400000", "500000", "99000", "Ana"]) assert.equal(json.includes(v), false, `se filtró ${v}`);
  });

  test("acomodación no publicable o precio inválido no se publica", () => {
    const o = ofertasBloqueo([fila({ acomodacion: "neto" }), fila({ acomodacion: "doble", precio_pvp: -5 }), fila({ acomodacion: "triple", precio_pvp: Number.NaN })], CUPOS);
    assert.equal(o.length, 1);
    assert.deepEqual(o[0].combos, []);
    assert.equal(o[0].desde_pvp_por_persona, null);
  });
});

describe("disponibilidad del vuelo: nunca se afirma lo que no se verificó", () => {
  test("conteo agregado > 0 → sillas libres al consultar", () => {
    assert.deepEqual(disponibilidadVuelo(10, { 10: 3 }), { sillas: 3, estado: "sillas_libres" });
  });
  test("0 → sin sillas", () => {
    assert.deepEqual(disponibilidadVuelo(10, { 10: 0 }), { sillas: 0, estado: "sin_sillas" });
  });
  test("sin entrada en el mapa (la lectura de cupos falló o no se hizo) → no verificada, nunca 0 ni un número", () => {
    assert.deepEqual(disponibilidadVuelo(10, {}), { sillas: null, estado: "no_verificada" });
    assert.deepEqual(disponibilidadVuelo(10, { 10: Number.NaN }), { sillas: null, estado: "no_verificada" });
  });
  test("tiquete de sistema (sin bloqueo) → sujeto a confirmación", () => {
    assert.deepEqual(disponibilidadVuelo(null, { 10: 3 }), { sillas: null, estado: "sujeto_a_confirmacion" });
  });
  test("la oferta lleva el estado de su bloqueo", () => {
    const [o] = ofertasBloqueo([fila({})], {});
    assert.equal(o.disponibilidad_vuelo, "no_verificada");
    assert.equal(o.sillas_libres, null);
  });
});

describe("privacidad de ruta: la oferta no publica ruta ni origen; solo destino y fechas", () => {
  // Etiquetas de los casos del gate: un record con forma de ruta, uno mezclado, la ruta contaminada y la ausencia de ruta.
  const ETIQUETAS = ["ABC-DEF", "MAD-BOG · QWERTY", "PNR-BOG", "L93FYZ · BOG-ADZ", "QWERTY", "", null];

  test("ningún texto de la etiqueta llega a la oferta, cualquiera sea su forma", () => {
    for (const label of ETIQUETAS) {
      const [o] = ofertasBloqueo([fila({ bloqueo_label: label })], CUPOS);
      const json = JSON.stringify(o);
      for (const pedazo of ["ABC", "DEF", "QWERTY", "PNR", "L93FYZ", "MAD-BOG", "BOG-ADZ"]) assert.equal(json.includes(pedazo), false, `${label} → ${pedazo}`);
      for (const k of ["ruta", "origen", "origen_iata", "bloqueo_label"]) assert.equal(k in o, false, k);
    }
  });

  test("la oferta conserva destino y fechas para mostrar", () => {
    const [o] = ofertasBloqueo([fila({ bloqueo_label: "PNR-BOG" })], CUPOS);
    assert.deepEqual([o.destino, o.fecha_ida, o.fecha_regreso], ["SAN ANDRÉS", "2027-03-10", "2027-03-13"]);
  });

  test("tiquete de sistema: tampoco publica la etiqueta", () => {
    const [o] = ofertasBloqueo([fila({ bloqueo_id: null, empaquetado_id: 3, bloqueo_label: "MAD-BOG · QWERTY" })], CUPOS);
    assert.equal(JSON.stringify(o).includes("QWERTY"), false);
    assert.equal(JSON.stringify(o).includes("MAD-BOG"), false);
  });

  test("la búsqueda por texto no encuentra por la etiqueta (no se indexa)", () => {
    const ofertas = ofertasBloqueo([fila({ bloqueo_label: "ABC-DEF" })], CUPOS);
    assert.equal(buscarEnOfertas(ofertas, { texto: "ABC-DEF" }).total_encontradas, 0);
    assert.equal(buscarEnOfertas(ofertas, { texto: "caribe" }).total_encontradas, 1);
  });
});

describe("búsqueda de bloqueos", () => {
  const ofertas = ofertasBloqueo(
    [
      fila({ paquete_id: 1, hotel_id: 1, destino_nombre: "SAN ANDRÉS", hotel_nombre: "Hotel Caribe", fecha_ida: "2027-03-10", precio_pvp: 1_000_000 }),
      fila({ paquete_id: 2, hotel_id: 2, destino_nombre: "CARTAGENA", hotel_nombre: "Hotel Murallas", fecha_ida: "2027-02-01", precio_pvp: 800_000 }),
      fila({ paquete_id: 3, hotel_id: 3, destino_nombre: "SAN ANDRÉS", hotel_nombre: "Decameron Isleño", fecha_ida: "2027-03-10", precio_pvp: 700_000 }),
    ],
    CUPOS
  );

  test("destino sin tildes ni mayúsculas", () => {
    const r = buscarEnOfertas(ofertas, { destino: "san andres" });
    assert.deepEqual(r.ofertas.map((o) => o.paquete_id).sort(), [1, 3]);
  });
  test("texto por palabras sobre hotel/paquete/destino/origen", () => {
    assert.deepEqual(buscarEnOfertas(ofertas, { texto: "isleño" }).ofertas.map((o) => o.paquete_id), [3]);
    assert.deepEqual(buscarEnOfertas(ofertas, { texto: "caribe andres" }).ofertas.map((o) => o.paquete_id), [1]);
  });
  test("rango de la fecha de ida", () => {
    assert.deepEqual(buscarEnOfertas(ofertas, { fechaDesde: "2027-03-01" }).ofertas.map((o) => o.paquete_id).sort(), [1, 3]);
    assert.deepEqual(buscarEnOfertas(ofertas, { fechaHasta: "2027-02-28" }).ofertas.map((o) => o.paquete_id), [2]);
  });
  test("orden por fecha y luego por desde; límite y truncado", () => {
    const r = buscarEnOfertas(ofertas, { limite: 2 });
    assert.deepEqual(r.ofertas.map((o) => o.paquete_id), [2, 3]);
    assert.equal(r.total_encontradas, 3);
    assert.equal(r.truncado, true);
  });
  test("criterios inválidos se rechazan con el nombre del campo", () => {
    assert.deepEqual(validarCriteriosBloqueos({ fechaDesde: "2027-02-30" }), { ok: false, campos: ["fechaDesde"] });
    assert.deepEqual(validarCriteriosBloqueos({ fechaDesde: "2027-03-02", fechaHasta: "2027-03-01" }), { ok: false, campos: ["fechaHasta"] });
    assert.deepEqual(validarCriteriosBloqueos({ limite: "0" }), { ok: false, campos: ["limite"] });
    assert.deepEqual(validarCriteriosBloqueos({ limite: "1000" }), { ok: false, campos: ["limite"] });
    assert.deepEqual(validarCriteriosBloqueos({}), { ok: true, criterios: {} });
  });
});

describe("selección y composición", () => {
  const base = { oferta: "5-b10-7", combo: "Estándar|PAE", hab_doble: "1" };

  test("selección válida", () => {
    const v = validarSeleccionBloqueo({ ...base, edadesMenores: "5, 1" });
    assert.ok(v.ok);
    if (v.ok) assert.deepEqual(v.seleccion, { clave: "5-b10-7", categoria: "Estándar", regimen: "PAE", composicion: { habitaciones: { doble: 1 }, edadesMenores: [5, 1] } });
  });
  test("oferta, combo y composición mal formados se rechazan", () => {
    assert.deepEqual(validarSeleccionBloqueo({ ...base, oferta: "5-x10-7" }), { ok: false, campos: ["oferta"] });
    assert.deepEqual(validarSeleccionBloqueo({ ...base, combo: "Estándar" }), { ok: false, campos: ["combo"] });
    assert.deepEqual(validarSeleccionBloqueo({ ...base, hab_doble: "" }), { ok: false, campos: ["habitaciones"] });
    assert.deepEqual(validarSeleccionBloqueo({ ...base, hab_doble: "11" }), { ok: false, campos: ["hab_doble"] });
    assert.deepEqual(validarSeleccionBloqueo({ ...base, edadesMenores: "5, 18" }), { ok: false, campos: ["edadesMenores"] });
    assert.deepEqual(validarSeleccionBloqueo({ ...base, edadesMenores: "1 2 3 4 5 6 7 8 9 10 11 12 13" }), { ok: false, campos: ["edadesMenores"] });
  });
  test("composición: varias habitaciones y separadores de edades", () => {
    assert.deepEqual(validarComposicion({ hab_doble: "2", hab_sencilla: "1", edadesMenores: "3;7 9" }), {
      ok: true,
      composicion: { habitaciones: { sencilla: 1, doble: 2 }, edadesMenores: [3, 7, 9] },
    });
  });
  test("la oferta debe estar VISIBLE y tener ese combo publicado (falla cerrado)", () => {
    const ofertas = ofertasBloqueo(FILAS, CUPOS);
    const v = validarSeleccionBloqueo(base);
    assert.ok(v.ok);
    if (!v.ok) return;
    assert.equal(ofertaDeSeleccion(ofertas, v.seleccion)?.clave, "5-b10-7");
    assert.equal(ofertaDeSeleccion(ofertas, { ...v.seleccion, regimen: "FULL" }), null);
    assert.equal(ofertaDeSeleccion(ofertas, { ...v.seleccion, clave: "9-b10-7" }), null);
    assert.equal(ofertaDeSeleccion([], v.seleccion), null);
  });
});

describe("entrada del motor: la misma forma que arma el checkout", () => {
  const ofertas = ofertasBloqueo(FILAS, CUPOS);
  const sel = { clave: "", categoria: "Estándar", regimen: "PAE", composicion: { habitaciones: { doble: 1 }, edadesMenores: [5] } };

  test("bloqueo negociado: bloqueoId, sin empaquetado ni fechas (las fija el record)", () => {
    const e = entradaComputoBloqueo(ofertas.find((o) => o.clave === "5-b10-7")!, { ...sel, clave: "5-b10-7" });
    assert.equal(e.modulo, "bloqueo");
    assert.equal(e.bloqueoId, 10);
    assert.equal(e.empaquetadoId, null);
    assert.equal(e.fechaIda, undefined);
    assert.equal(e.fechaRegreso, undefined);
    assert.deepEqual(e.habitaciones, { doble: 1 });
    assert.deepEqual([e.ninos, e.ninos2, e.infantes], [0, 0, 0]);
    assert.deepEqual(e.edadesMenores, [5]);
    assert.equal(e.cantidadMenores, 1);
  });

  test("tiquete de sistema: empaquetadoId, sin bloqueo", () => {
    const e = entradaComputoBloqueo(ofertas.find((o) => o.clave === "5-e3-7")!, { ...sel, clave: "5-e3-7" });
    assert.equal(e.bloqueoId, null);
    assert.equal(e.empaquetadoId, 3);
  });

  test("sin datos personales, pasajeros, add-on ni mascotas", () => {
    const e = entradaComputoBloqueo(ofertas[0], { ...sel, clave: ofertas[0].clave });
    assert.deepEqual(e.cliente, { nombres: "", apellidos: "", tipoDoc: "", numeroDoc: "", telefono: "", email: "" });
    assert.deepEqual(e.pasajeros, []);
    assert.deepEqual(e.servicios, []);
    assert.equal("mascotas" in e, false);
    assert.equal(e.tipoAsesor, "interno");
  });

  test("las edades se copian: mutar la entrada no altera la selección", () => {
    const s = { ...sel, clave: ofertas[0].clave, composicion: { habitaciones: { doble: 1 }, edadesMenores: [5] } };
    const e = entradaComputoBloqueo(ofertas[0], s);
    e.edadesMenores!.push(9);
    assert.deepEqual(s.composicion.edadesMenores, [5]);
  });
});

/** Resultado del motor con lo que trae de verdad: netos, impuesto, servicios incluidos con costo y proveedor. */
function computo(sobre: Partial<ComputoReserva> = {}): ComputoReserva {
  return {
    origen: { tipo: "bloqueo", id: 10 },
    meta: { hotel_nombre: "Hotel Caribe", destino_nombre: "SAN ANDRÉS", fecha_ida: "2027-03-10", fecha_regreso: "2027-03-13" },
    pvpPorAcom: { doble: 1_000_000, nino: 400_000 },
    netoPorAcom: { doble: 777_111, nino: 333_222 },
    precioVenta: 2_400_000,
    paxConSilla: 3,
    totalPax: 3,
    numNinos: 1,
    numNinos2: 0,
    numInfantes: 0,
    distribucionMenores: null,
    edadesMenoresUsadas: [5],
    lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: 1_000_000 }],
    serviciosItems: [],
    serviciosIncluidos: [{ servicioId: 9, nombre: "Traslado", categoria: "traslado", incluido: true, costoNeto: 55_444, proveedorId: 66 }],
    impuestoTotal: 123_456,
    monedaReserva: "COP",
    notaNino: "Niño comparte cama",
    cargoMascota: null,
    notaMascota: null,
    condicionesTarifa: [
      { temporada: "Alta", texto: "No reembolsable" },
      { temporada: "Promo", texto: "No reembolsable" },
      { temporada: "X", texto: "  " },
    ],
    ...sobre,
  } as ComputoReserva;
}

const BASE = { paqueteId: 5, hotelId: 7, categoria: "Estándar", regimen: "PAE" };
const OK = { markupConfiable: true };

describe("resolverCotizacion: el total es el del motor y nada más sale", () => {
  test("total = precioVenta del motor; líneas, menores y pax de sus mismos campos", () => {
    const r = resolverCotizacion("bloqueo", BASE, { ok: true, data: computo() }, { sillas: 3, estado: "sillas_libres" }, OK);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.cotizacion.total_orientativo, 2_400_000);
    assert.deepEqual(r.cotizacion.lineas, [{ acomodacion: "doble", habitaciones: 1, pax: 2, pvp_por_persona: 1_000_000 }]);
    assert.deepEqual(r.cotizacion.menores, { nino: 1, nino2: 0, infante: 0 });
    assert.deepEqual(r.cotizacion.pvp_menores_por_persona, { nino: 400_000, nino2: null, infante: null });
    assert.equal(r.cotizacion.total_pax, 3);
    assert.deepEqual(r.cotizacion.condiciones_tarifa, ["No reembolsable"]);
    assert.equal(r.cotizacion.disponibilidad_hotel, "sujeto_a_confirmacion");
    assert.equal(r.cotizacion.sujeto_a_confirmacion, true);
  });

  test("ningún neto, impuesto, costo ni proveedor del motor sale, aunque vengan en la entrada", () => {
    const r = resolverCotizacion("bloqueo", BASE, { ok: true, data: computo() }, { sillas: 3, estado: "sillas_libres" }, OK);
    assert.deepEqual(clavesProhibidasEn(r), []);
    const json = JSON.stringify(r);
    for (const v of ["777111", "333222", "55444", "123456", "66"]) assert.equal(json.includes(v), false, `se filtró ${v}`);
  });

  test("¿alcanzan las sillas? menor, igual y mayor que los pax con silla", () => {
    const con = (sillas: number) => {
      const r = resolverCotizacion("bloqueo", BASE, { ok: true, data: computo() }, { sillas, estado: sillas > 0 ? "sillas_libres" : "sin_sillas" }, OK);
      return r.ok ? r.cotizacion.alcanzan_sillas : "error";
    };
    assert.equal(con(2), false);
    assert.equal(con(3), true);
    assert.equal(con(4), true);
    assert.equal(con(0), false);
  });

  test("sillas no verificadas o tiquete de sistema: nunca se afirma que alcanzan", () => {
    const nv = resolverCotizacion("bloqueo", BASE, { ok: true, data: computo() }, { sillas: null, estado: "no_verificada" }, OK);
    const sis = resolverCotizacion("bloqueo", BASE, { ok: true, data: computo() }, { sillas: null, estado: "sujeto_a_confirmacion" }, OK);
    assert.ok(nv.ok && sis.ok);
    if (!nv.ok || !sis.ok) return;
    assert.equal(nv.cotizacion.alcanzan_sillas, null);
    assert.equal(nv.cotizacion.disponibilidad_vuelo, "no_verificada");
    assert.equal(sis.cotizacion.alcanzan_sillas, null);
    assert.equal(sis.cotizacion.sillas_libres, null);
  });

  test("porción (sin vuelo): sin estado de sillas", () => {
    const r = resolverCotizacion("porcion_terrestre", BASE, { ok: true, data: computo() }, null, OK);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual([r.cotizacion.disponibilidad_vuelo, r.cotizacion.sillas_libres, r.cotizacion.alcanzan_sillas], [null, null, null]);
  });
});

describe("H-PQ1: un total con cargo por grupo sin markup confiable no se presenta", () => {
  // 2 × 1.000.000 + 1 niño × 400.000 = 2.400.000: el resto es cargo fuera de líneas.
  test("cargoFueraDeLineas es lo que el motor suma aparte de las líneas por persona", () => {
    assert.equal(cargoFueraDeLineas(computo()), 0);
    assert.equal(cargoFueraDeLineas(computo({ precioVenta: 2_550_000 })), 150_000);
    // Menor sin PVP definido: el motor no lo suma, aquí tampoco.
    assert.equal(cargoFueraDeLineas(computo({ numInfantes: 1, precioVenta: 2_400_000 })), 0);
  });
  test("sin cargo aparte, el total se presenta aunque la sesión no lea el markup (no depende de él)", () => {
    const r = resolverCotizacion("bloqueo", BASE, { ok: true, data: computo() }, null, { markupConfiable: false });
    assert.equal(r.ok, true);
  });
  test("con cargo aparte y markup no confiable: no_cotizable, sin total", () => {
    const r = resolverCotizacion("bloqueo", BASE, { ok: true, data: computo({ precioVenta: 2_550_000 }) }, null, { markupConfiable: false });
    assert.deepEqual(r, { ok: false, codigo: "no_cotizable", motivo: MOTIVO_CARGO_GRUPO_SIN_MARKUP });
  });
  test("con cargo aparte y markup confiable: se presenta el total del motor", () => {
    const r = resolverCotizacion("bloqueo", BASE, { ok: true, data: computo({ precioVenta: 2_550_000 }) }, null, OK);
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.cotizacion.total_orientativo, 2_550_000);
  });
});

describe("saneamiento de errores del motor", () => {
  const rechazo = (error: string) => resolverCotizacion("bloqueo", BASE, { ok: false, error }, null, OK);

  test("mensaje técnico (Supabase/Postgres o estructura interna) → error_tecnico SIN motivo", () => {
    for (const m of [
      "No se pudo consultar el hotel: permission denied for table hoteles",
      'relation "tarifario_resultado_publicable" does not exist',
      "JWT expired",
      "fetch failed",
      "No pudimos cotizar este hotel en este momento. Intenta nuevamente.",
      "Búsqueda no disponible en este momento. Intenta nuevamente.",
      'El servicio incluido "Traslado" está configurado en modo grupo pero no tiene una tarifa por rango de pasajeros que cubra 3 pax — corrige el catálogo (servicio_tarifa_pax) antes de reservar.',
      'El servicio incluido "X" tiene un modo de cobro inválido en el catálogo (armado_servicios.modo) — corrígelo antes de reservar.',
      "",
    ]) {
      const r = rechazo(m);
      assert.deepEqual(r, { ok: false, codigo: "error_tecnico" }, m);
    }
  });

  test("mensaje comercial del motor → no_cotizable con el motivo", () => {
    assert.deepEqual(rechazo("Este hotel es Adults Only: no acepta niños ni infantes."), {
      ok: false,
      codigo: "no_cotizable",
      motivo: "Este hotel es Adults Only: no acepta niños ni infantes.",
    });
    const sinTarifa = rechazo("Para las fechas elegidas no encontramos una tarifa.");
    assert.equal(sinTarifa.ok === false && sinTarifa.codigo, "no_cotizable");
    const vencida = rechazo("Esta tarifa ya no está vigente para compra (la vigencia del hotel venció). Pide regenerar el tarifario con vigencias vigentes antes de reservar.");
    assert.equal(vencida.ok, false);
    if (!vencida.ok) assert.equal(vencida.codigo, "no_cotizable");
  });

  test("Bernalo (tarifa por unidad) → no_cotizable con motivo propio, sin nombres internos", () => {
    const r = rechazo('Este hotel administra su tarifa con el editor Bernalo por unidad (hotel_tarifas_unidad) — la reserva en vivo para este modelo todavía no está integrada en Reservar.');
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.codigo, "no_cotizable");
    assert.doesNotMatch(r.motivo ?? "", /hotel_tarifas_unidad|Bernalo/);
  });

  test("mensaje desconocido (sin señal técnica): no_cotizable con motivo GENÉRICO, nunca su texto", () => {
    for (const m of [
      "Error interno: fallo de conexión con inventario privado", // caso del Auditor
      "a".repeat(500),
      "Fallo inesperado del proveedor ACME (ref 4411)",
    ]) {
      const r = rechazo(m);
      assert.deepEqual(r, { ok: false, codigo: "no_cotizable", motivo: MOTIVO_NO_COTIZABLE_GENERICO }, m);
      assert.equal(JSON.stringify(r).includes(m), false);
    }
  });

  test("lista blanca: los mensajes dinámicos conocidos salen tal cual", () => {
    for (const m of [
      "La ida no puede ser antes del 2027-03-01 (rango del paquete).",
      "Este alojamiento exige un mínimo de 3 noche(s) para esas fechas.",
      "Las 2 habitaciones seleccionadas admiten máximo 4 niño(s); hay 5.",
      "La habitación seleccionada exige un mínimo de 1 infante(s) en total; hay 0.",
      "La edad 15 corresponde a tarifa de adulto según este hotel (mayor a 12 años) — cuenta a esta persona entre los adultos (habitaciones), no como menor.",
      "Este hotel no tiene tarifa de Niño 2 configurada para esa categoría/régimen — no se puede cotizar con esa edad.",
      "No se pueden cotizar más de 12 menores en una sola consulta.",
      "El número de noches debe estar entre 1 y 30.",
    ]) {
      assert.deepEqual(clasificarMensajeMotor(m), { codigo: "no_cotizable", motivo: m }, m);
    }
  });

  test("lista blanca anclada: un mensaje conocido con texto agregado no sale", () => {
    for (const m of [
      "Este hotel es Adults Only: no acepta niños ni infantes. Detalle interno: proveedor 66",
      "Prefijo. Para las fechas elegidas no encontramos una tarifa.",
      "La habitación seleccionada admite máximo 2 adulto(s); hay 3.",
    ]) {
      assert.deepEqual(clasificarMensajeMotor(m), { codigo: "no_cotizable", motivo: MOTIVO_NO_COTIZABLE_GENERICO }, m);
    }
  });
});

describe("lista negra a cualquier profundidad", () => {
  test("record, netos y datos de silla se detectan anidados", () => {
    const halladas = clavesProhibidasEn({ a: [{ b: { record: "X", numero_silla: 1 } }], netoPorAcom: {}, c: { pasajero_nombres: "x", cupos_ocupados: 1, impuestoTotal: 1 } });
    assert.deepEqual(halladas.sort(), ["a[0].b.numero_silla", "a[0].b.record", "c.cupos_ocupados", "c.impuestoTotal", "c.pasajero_nombres", "netoPorAcom"]);
  });
  test("total_orientativo no está prohibido; total sí", () => {
    assert.deepEqual(clavesProhibidasEn({ total_orientativo: 1 }), []);
    assert.deepEqual(clavesProhibidasEn({ total: 1 }), ["total"]);
  });
  test("preciosPublicables descarta claves que no son acomodación", () => {
    assert.deepEqual(preciosPublicables({ doble: 1, neto: 2, costo_neto: 3, nino: 0 }), { doble: 1, nino: 0 });
  });
  test("la clave de oferta no lleva el record", () => {
    assert.equal(claveOferta(5, 10, null, 7), "5-b10-7");
    assert.equal(claveOferta(5, null, 3, 7), "5-e3-7");
  });
});
