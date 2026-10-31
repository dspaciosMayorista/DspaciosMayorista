// Se ejecuta por comando directo (sin tocar package.json):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/salidaVinculada63Usd.react.ts
//
// #90 · #63 (234) · Reserva de PUNTA A PUNTA de un Dinámico en modo de conversión por TRM PUBLICADO EN USD, con el motor REAL
// (crearCotizacion → convertirCotizacion → computarReserva → reservarDesdeTarifarioInterno → escritura financiera → asientos) contra la BD en
// memoria del arnés (RPC de #63 simuladas de forma estricta en pruebas/support/rpc63.ts; la base real, en supabase/scripts/test_234_*.sql):
//   · USD→USD: vuelo de Empaquetados en USD en un paquete en USD — SIN conversión (R, N y F exactos); la TRM igual queda congelada para el
//     equivalente contable en COP de cada obligación;
//   · COP→USD: vuelo en COP en un paquete en USD — R y F se expresan COP / TRM; el costo del contrato es el costo de ORIGEN COP / TRM y la CxP
//     aérea queda en COP (moneda de origen) con su equivalente y la TRM congeladas;
//   · USD→COP (regresión): el modo de siempre;
//   · fuente inelegible, cambio de TRM / fuente / moneda de publicación después de cotizar: NO se cobra en silencio;
//   · una vinculada nunca consulta cupos de Bloqueo.
import { usarBD, type Fila } from "./support/fechaNegocioArnes.ts";
import { crearRpcs63, instalarFencing63 } from "./support/rpc63.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";

const { crearCotizacion, convertirCotizacion: convertirCotizacionReal } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
// 235 (#90 F): convertir una oferta #63 exige ELEGIR la moneda de cobro. Estas pruebas ejercitan otro recorrido, así que eligen la de la oferta (sin conversión).
let bdActual: { filas(t: string): Array<Record<string, unknown>> } | null = null;
const convertirCotizacion = (id: number, pasajeros?: unknown, override?: boolean, asesor?: string, trm?: unknown) =>
  convertirCotizacionReal(id, pasajeros as never, override, asesor, trm as never, ((bdActual?.filas("cotizaciones").find((c) => c.id === id)?.moneda as string | undefined) ?? "COP") === "USD" ? "USD" : "COP");

function fechaBogota(offsetDias: number): string {
  return new Date(Date.now() + offsetDias * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
const IDA = fechaBogota(30);
const REG = fechaBogota(31);

const PAQUETE_ID = 70;
const HOTEL_ID = 217;
const SALIDA_ID = 11;
const EMPAQUETADO_ID = 5;
const CAT = "Estándar";
const REGIMEN = "PAE";
const TABLAS_DE_CUPOS = ["cupos_por_bloqueo", "sillas", "bloqueos_vuelo"];

const pasajero = (nombres: string, nacimiento: string, extra: Record<string, unknown> = {}) => ({
  nombres, apellidos: "Pérez", tipoDoc: "CC", numeroDoc: `D-${nombres}`, fechaNacimiento: nacimiento, nacionalidad: "CO", esInfante: false, ...extra,
});
const hace1Anio = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
const PASAJEROS = [pasajero("Juan", "1990-01-01"), pasajero("Ana", "1992-01-01"), pasajero("Bebe", hace1Anio, { esInfante: true, responsableIndex: 0 })];

function pedido(over: Record<string, unknown> = {}) {
  return {
    paqueteId: PAQUETE_ID, bloqueoId: null, empaquetadoId: null, salidaId: SALIDA_ID, modulo: "dinamico", hotelId: HOTEL_ID,
    categoria: CAT, regimen: REGIMEN, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [1], cantidadMenores: 1,
    cliente: { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", telefono: "300", email: "a@a.com" },
    tipoAsesor: "interno", asesorInterno: "Asesor", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
    aliadoId: null, plazo: "2026-12-31", servicios: [], pasajeros: PASAJEROS,
    ...over,
  };
}

type Moneda = "COP" | "USD";
type Escenario = {
  /** Moneda de publicación del paquete (la elegida). */
  publicacion: Moneda;
  /** Moneda del vuelo de Empaquetados (y de la salida vinculada que lo copia). */
  vuelo: Moneda;
  trm?: number | null;
  /** Precios publicados (en la moneda de publicación) que lee el cómputo del tarifario. */
  precios: { doble: number; infante: number; menor2: number };
  paquete?: Fila;
  fuente?: Fila;
  /** TRM de referencia (parametros_tributarios): la que se congela como provisional al contratar una oferta USD sin TRM. null = no configurada. */
  trmRef?: number | null;
};

// Vuelo: USD → N 250 / R 290 / F 20 ; COP → N 1.000.000 / R 1.130.000 / F 80.500.
const VUELO = {
  USD: { N: 250, R: 290, F: 20 },
  COP: { N: 1_000_000, R: 1_130_000, F: 80_500 },
} as const;

function montar(e: Escenario) {
  const tablasConsultadas: string[] = [];
  const v = VUELO[e.vuelo];
  const origenFila = { salida_id: SALIDA_ID, empaquetado_id: null, bloqueo_id: null };
  const base = { ...origenFila, paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID, categoria: CAT, regimen: REGIMEN, hotel_nombre: "Hotel Dinámico", destino_nombre: "CARTAGENA", fecha_ida: IDA, fecha_regreso: REG, moneda: e.publicacion };
  const semilla: Record<string, Fila[]> = {
    usuarios: [{ id: "u-arnes", rol: "superadmin", activo: true, tenant: "mayorista", nombre: "Asesor" }],
    cotizaciones: [], aliados: [],
    parametros_tributarios: e.trmRef === null ? [] : [{ parametro: "trm_referencia", valor: e.trmRef ?? 4000 }],
    hoteles: [{
      id: HOTEL_ID, modelo_tarifario: "persona", nombre: "Hotel Dinámico", moneda: "USD", adults_only: false, pet_friendly: false,
      edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12, pax_min: 1, pax_max: 4,
      nino_nota: null, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null, proveedores: null,
    }],
    armado_paquetes: [{
      id: PAQUETE_ID, pct_mk: 0.2, impuesto_tipo: "tiquete", impuesto_fijo: 0, destino_id: 1, tipo: "dinamico",
      destinos_aereos_alternativos: false, modo_oferta: "cop_trm_63", trm_oferta: e.trm === undefined ? 4000 : e.trm, moneda_publicacion: e.publicacion,
      tarifario_generacion_publicada: 3, tarifario_revision_publicada: 5, tarifario_revision_fuente: 5, p63_rev_costos: 0, ...(e.paquete ?? {}),
    }],
    tarifario_resultado_publicable: [
      { ...base, acomodacion: "doble", precio_pvp: e.precios.doble, precio_pvp_menor2: null },
      { ...base, acomodacion: "infante", precio_pvp: e.precios.infante, precio_pvp_menor2: e.precios.menor2 },
    ],
    // 258: evidencia de la composición publicada (generación 3 = la publicada, regla 1) con el servicio 900 horneado en la fila de la salida.
    tarifario_composicion_publicada: [{ paquete_id: PAQUETE_ID, fecha_ida: IDA, generacion: 3, regla: 1, servicios_incluidos: [900] }],
    hotel_acomodaciones: [{ hotel_id: HOTEL_ID, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 }],
    hotel_temporadas: [{
      id: 1, hotel_id: HOTEL_ID, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null,
      tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null,
    }],
    tarifa_hotel: [{
      id: 10, hotel_id: HOTEL_ID, tipo_habitacion: CAT, alimentacion: REGIMEN, temporada: "Base",
      neto_sencilla: null, neto_doble: 100, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: 10, nota_infante: null,
      notas: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null, precio_final_autoritativo: false,
    }],
    armado_servicios: [{
      paquete_id: PAQUETE_ID, servicio_id: 900, modo: "persona", incluido: true,
      servicios_adicionales: { nombre: "Tour", categoria: "tour_traslado", precio_persona: 10, precio_infante: 0, liquidacion: "paquete", proveedor_id: null, proveedores: null },
    }],
    servicios_adicionales: [{ id: 900, moneda: "USD" }],
    // SIN «GENERAL»: el servicio incluido se vende desde una vigencia que cubre todo el rango (mismo neto que antes tenía como precio base).
    servicio_tarifa_pax: [], servicio_temporadas: [{ servicio_id: 900, nombre: "VIG", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: 10, precio_infante: 0, recargo_individual: null }],
    destinos: [{ id: 1, nombre: "CARTAGENA", codigo_iata: "CTG", pais: "Colombia", activo: true }],
    armado_paquete_destinos_aereos: [],
    salidas_dinamicas: [{
      id: SALIDA_ID, paquete_id: PAQUETE_ID, empaquetado_id: EMPAQUETADO_ID, activo: true, compra_inicio: null, compra_fin: null,
      fecha_ida: IDA, fecha_regreso: REG, ruta: "BOG - CTG - BOG", aerolinea: "JetSMART", valor_tiquete: v.R, fee_infante: v.F,
      aplica_mk: false, ta: 0, moneda: e.vuelo,
    }],
    empaquetados: [{
      id: EMPAQUETADO_ID, activo: true, record: null, compra_inicio: null, compra_fin: null, fecha_ida: IDA, fecha_regreso: REG,
      ruta: "BOG - CTG - BOG", aerolinea: "JetSMART", destino_id: 1, moneda: e.vuelo, tarifa_proveedor: v.N, tarifa_para_empaquetar: v.R, fee_infante: v.F,
      vuelo_ida: null, vuelo_regreso: null, hora_salida_ida: null, hora_llegada_ida: null, hora_salida_reg: null, hora_llegada_reg: null, proveedores: null,
      ...(e.fuente ?? {}),
    }],
    bloqueos_vuelo: [], cupos_por_bloqueo: [],
  };
  const ref: { bd?: ReturnType<typeof usarBD> } = {};
  const bd = usarBD(semilla, { congelar_condiciones_contrato: () => "OK", ...crearRpcs63(ref) });
  ref.bd = bd;
  instalarFencing63(bd);
  const sbBase = (globalThis as unknown as { __arnesFechas: { sb: { from: (t: string) => unknown } } }).__arnesFechas.sb;
  const fromOriginal = sbBase.from.bind(sbBase);
  sbBase.from = (t: string) => { tablasConsultadas.push(t); return fromOriginal(t); };
  bdActual = bd as never;
  return { bd, tablasConsultadas };
}
const tocoCupos = (consultadas: string[]) => consultadas.filter((t) => TABLAS_DE_CUPOS.includes(t));

const USD_USD: Escenario = { publicacion: "USD", vuelo: "USD", precios: { doble: 428, infante: 315, menor2: 33 } };
const COP_USD: Escenario = { publicacion: "USD", vuelo: "COP", precios: { doble: 420, infante: 307.5, menor2: 33.13 } };
const USD_COP: Escenario = { publicacion: "COP", vuelo: "USD", precios: { doble: 1_710_000, infante: 1_260_000, menor2: 132_000 } };

// Importe con el que el libro devenga una CxP: el equivalente COP congelado, jamás el nominal en dólares.
function importeAsiento(bd: ReturnType<typeof montar>["bd"], cuentaId: unknown) {
  const a = bd.filas("asientos_contables").find((x) => x.origen === "cxp" && x.referencia === `cxp:${cuentaId}`);
  return bd.filas("asiento_lineas").filter((l) => l.asiento_id === a?.id).reduce((s, l) => s + Number(l.debe || 0), 0);
}

test("USD→USD: R, N y F entran SIN conversión; contrato en USD; CxP en USD con el equivalente COP congelado a la TRM; el libro devenga ese equivalente", async () => {
  const { bd, tablasConsultadas } = montar(USD_USD);
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const oferta = bd.filas("p63_oferta")[0];
  assert.equal((oferta?.snapshot as { moneda: string }).moneda, "USD", "el snapshot de la oferta queda en la moneda de publicación");
  assert.equal((oferta?.snapshot as { cabecera: { moneda: string } }).cabecera.moneda, "USD");
  assert.equal(bd.filas("cotizaciones")[0]?.moneda, "USD");
  assert.equal(oferta?.trm, 4000, "la TRM queda congelada en la oferta aunque todo esté en USD");

  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(tocoCupos(tablasConsultadas), [], "una vinculada NO consulta cupos de Bloqueo");

  const [venta] = bd.filas("ventas");
  assert.equal(venta?.moneda, "USD");
  assert.equal(venta?.precio_venta, 889, "2 adultos 428 + menor de 2 años 33");
  assert.equal(venta?.impuesto, 2 * 290, "BNC tiquete = R × pax con silla, sin conversión");
  assert.equal(venta?.costo_aereo, 2 * 250 + 20, "N × pax con silla + F × menor de 2 años, exactos en USD");
  assert.equal(venta?.costo_hotel, 210, "2 × 100 + 10 del infante, USD");
  assert.equal(venta?.costo_receptivo, 20, "tour USD 2 × 10 + infante gratis");
  assert.equal(venta?.financiero_estado, "completo");

  const cxp = bd.filas("cuentas_por_pagar");
  const de = (t: string) => cxp.find((c) => c.tipo_proveedor === t);
  assert.deepEqual({ v: de("aereo")?.valor_total, m: de("aereo")?.moneda, c: de("aereo")?.valor_cop_63, t: de("aereo")?.trm_63 }, { v: 520, m: "USD", c: 2_080_000, t: 4000 });
  assert.deepEqual({ v: de("hotel")?.valor_total, m: de("hotel")?.moneda, c: de("hotel")?.valor_cop_63, t: de("hotel")?.trm_63 }, { v: 210, m: "USD", c: 840_000, t: 4000 });
  assert.deepEqual({ v: de("receptivo")?.valor_total, m: de("receptivo")?.moneda, c: de("receptivo")?.valor_cop_63 }, { v: 20, m: "USD", c: 80_000 });
  assert.equal(importeAsiento(bd, de("aereo")?.id), 2_080_000, "el libro devenga el equivalente COP congelado, no USD 520");
  assert.equal(importeAsiento(bd, de("hotel")?.id), 840_000);
  assert.equal(importeAsiento(bd, de("receptivo")?.id), 80_000);
  assert.deepEqual(bd.filas("contrato_vuelos").map((t) => t.direccion), ["ida", "regreso"]);
});

test("COP→USD: R y F se expresan COP / TRM; el costo del contrato es el de ORIGEN COP / TRM; la CxP aérea queda en COP con equivalente = valor", async () => {
  const { bd, tablasConsultadas } = montar(COP_USD);
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(tocoCupos(tablasConsultadas), []);

  const [venta] = bd.filas("ventas");
  assert.equal(venta?.moneda, "USD");
  assert.equal(venta?.precio_venta, 873.13, "2 adultos 420 + menor de 2 años 33,13");
  assert.equal(venta?.impuesto, 565, "BNC tiquete = R / TRM = 1.130.000 / 4.000 = 282,5 por pax con silla");
  assert.equal(venta?.costo_aereo, 520.13, "costo de origen (2 × 1.000.000 + 80.500 COP) / TRM, con centavos");
  assert.equal(venta?.costo_hotel, 210);
  assert.equal(venta?.costo_receptivo, 20);

  const cxp = bd.filas("cuentas_por_pagar");
  const de = (t: string) => cxp.find((c) => c.tipo_proveedor === t);
  assert.deepEqual({ v: de("aereo")?.valor_total, m: de("aereo")?.moneda, c: de("aereo")?.valor_cop_63, t: de("aereo")?.trm_63 }, { v: 2_080_500, m: "COP", c: 2_080_500, t: 4000 });
  assert.deepEqual({ v: de("hotel")?.valor_total, m: de("hotel")?.moneda, c: de("hotel")?.valor_cop_63 }, { v: 210, m: "USD", c: 840_000 });
  assert.equal(importeAsiento(bd, de("aereo")?.id), 2_080_500);
  assert.equal(importeAsiento(bd, de("hotel")?.id), 840_000);
});

test("USD→COP (regresión del modo de siempre): contrato en COP, costo aéreo = N en USD × TRM, CxP aérea en USD", async () => {
  const { bd } = montar(USD_COP);
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  const [venta] = bd.filas("ventas");
  assert.equal(venta?.moneda, "COP");
  assert.equal(venta?.impuesto, 2 * 290 * 4000, "BNC = R en COP (290 × 4.000) × pax con silla");
  assert.equal(venta?.costo_aereo, (2 * 250 + 20) * 4000);
  assert.equal(venta?.costo_hotel, 840_000);
  const aereo = bd.filas("cuentas_por_pagar").find((c) => c.tipo_proveedor === "aereo");
  assert.deepEqual({ v: aereo?.valor_total, m: aereo?.moneda, c: aereo?.valor_cop_63, t: aereo?.trm_63 }, { v: 520, m: "USD", c: 2_080_000, t: 4000 });
});

test("COP→USD SIN TRM: no se cotiza (hay una fuente en COP que convertir: la TRM de publicación es obligatoria)", async () => {
  const { bd } = montar({ ...COP_USD, trm: null });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, false);
  assert.match((cot as { error: string }).error, /TRM/);
  assert.equal(bd.filas("cotizaciones").length, 0, "no se guardó ninguna cotización");
});

const USD_USD_SIN_TRM: Escenario = { ...USD_USD, trm: null };
const idsCxp = (bd: ReturnType<typeof montar>["bd"]) => bd.filas("cuentas_por_pagar");

test("USD→USD SIN TRM (todo en USD): se publica y se cotiza sin TRM; al CONTRATAR se congela la TRM provisional INGRESADA ANTES de crear CxP y asientos en COP", async () => {
  const { bd, tablasConsultadas } = montar(USD_USD_SIN_TRM);
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const oferta = bd.filas("p63_oferta")[0];
  assert.equal(oferta?.trm, null, "la oferta se cotiza SIN TRM (nada que convertir)");
  const snap = oferta?.snapshot as { trm: number | null; moneda: string; financiero: { cxp: { moneda: string; trm: number | null; valor_cop: number | null }[] } };
  assert.equal(snap.trm, null);
  assert.equal(snap.moneda, "USD");
  assert.ok(snap.financiero.cxp.every((o) => o.moneda === "USD" && o.trm === null && o.valor_cop === null), "el snapshot NO inventa equivalentes en COP");
  assert.equal(bd.filas("cuentas_por_pagar").length, 0, "cotizar no crea ninguna CxP");
  assert.equal(bd.filas("asientos_contables").length, 0, "ni ningún asiento");

  const r = await convertirCotizacion(cot.id, PASAJEROS as never, false, undefined, 4000);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(tocoCupos(tablasConsultadas), []);
  const [acep] = bd.filas("p63_aceptacion");
  assert.equal(acep?.trm_provisional, 4000, "la TRM ingresada quedó congelada en la aceptación");
  const [venta] = bd.filas("ventas");
  assert.equal(venta?.moneda, "USD");
  assert.equal(venta?.precio_venta, 889);
  assert.equal(venta?.costo_aereo, 520);
  assert.equal(venta?.costo_hotel, 210);
  const de = (t: string) => idsCxp(bd).find((c) => c.tipo_proveedor === t);
  assert.deepEqual({ v: de("aereo")?.valor_total, m: de("aereo")?.moneda, c: de("aereo")?.valor_cop_63, t: de("aereo")?.trm_63 }, { v: 520, m: "USD", c: 2_080_000, t: 4000 });
  assert.deepEqual({ v: de("hotel")?.valor_total, m: de("hotel")?.moneda, c: de("hotel")?.valor_cop_63, t: de("hotel")?.trm_63 }, { v: 210, m: "USD", c: 840_000, t: 4000 });
  assert.deepEqual({ v: de("receptivo")?.valor_total, c: de("receptivo")?.valor_cop_63 }, { v: 20, c: 80_000 });
  assert.ok(idsCxp(bd).every((c) => c.moneda === "USD" && c.trm_63 === 4000 && c.valor_cop_63 != null), "ninguna CxP en USD nace sin TRM ni equivalente");
  assert.equal(importeAsiento(bd, de("aereo")?.id), 2_080_000, "el libro devenga el equivalente COP provisional, nunca USD 520");
  assert.equal(importeAsiento(bd, de("hotel")?.id), 840_000);
  assert.equal(importeAsiento(bd, de("receptivo")?.id), 80_000);
  // El orden importa: la aceptación (que congela la TRM) ocurre ANTES de cualquier escritura financiera.
  const orden = bd.llamadasRpc.map((c) => c.fn).filter((fn) => ["aceptar_oferta_63", "registrar_financiero_contrato"].includes(fn));
  assert.deepEqual(orden, ["aceptar_oferta_63", "registrar_financiero_contrato"]);
});

test("TRM provisional: se ingresa AL CONTRATAR (no al cotizar) y después no se mueve aunque el parámetro de referencia cambie", async () => {
  const { bd } = montar(USD_USD_SIN_TRM);
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  bd.filas("parametros_tributarios")[0].valor = 9999; // el parámetro de referencia no influye
  const r = await convertirCotizacion(cot.id, PASAJEROS as never, false, undefined, 4200);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("p63_aceptacion")[0]?.trm_provisional, 4200, "se congeló la tasa INGRESADA AL CONTRATAR");
  const aereo = idsCxp(bd).find((c) => c.tipo_proveedor === "aereo");
  assert.deepEqual({ c: aereo?.valor_cop_63, t: aereo?.trm_63 }, { c: 520 * 4200, t: 4200 });
  bd.filas("parametros_tributarios")[0].valor = 4500; // cambia DESPUÉS de contratar
  assert.equal(bd.filas("p63_aceptacion")[0]?.trm_provisional, 4200);
  assert.deepEqual({ c: aereo?.valor_cop_63, t: aereo?.trm_63 }, { c: 520 * 4200, t: 4200 }, "la CxP conserva la TRM congelada");
  assert.equal(importeAsiento(bd, aereo?.id), 520 * 4200);
});

test("USD→USD sin TRM y sin tasa ingresada (ni parámetro de referencia): no se contrata (ni número, ni CxP, ni asientos) y la oferta sigue abierta", async () => {
  const { bd } = montar({ ...USD_USD_SIN_TRM, trmRef: null });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /ingresa la TRM provisional/);
  assert.equal(bd.filas("ventas").length, 0);
  assert.equal(bd.filas("cuentas_por_pagar").length, 0);
  assert.equal(bd.filas("asientos_contables").length, 0);
  assert.equal(bd.filas("p63_aceptacion").length, 0, "no se reservó ningún número");
  assert.equal(bd.filas("p63_oferta")[0]?.estado, "abierta");
  // Con la tasa ingresada, la MISMA cotización se contrata.
  const r2 = await convertirCotizacion(cot.id, PASAJEROS as never, false, undefined, 4000);
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(bd.filas("p63_aceptacion")[0]?.trm_provisional, 4000);
});

const consecutivo = () => (globalThis as unknown as { __arnesFechas: { seq?: number } }).__arnesFechas.seq;

test("TRM provisional INGRESADA al convertir: prevalece sobre trm_referencia (que tiene otro valor) y se congela en la aceptación, las CxP y el libro", async () => {
  const { bd } = montar({ ...USD_USD_SIN_TRM, trmRef: 4000 });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r = await convertirCotizacion(cot.id, PASAJEROS as never, false, undefined, 4321.5);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("p63_aceptacion")[0]?.trm_provisional, 4321.5, "manda la tasa ingresada, no la de referencia (4000)");
  const aereo = idsCxp(bd).find((c) => c.tipo_proveedor === "aereo");
  const hotel = idsCxp(bd).find((c) => c.tipo_proveedor === "hotel");
  assert.deepEqual({ c: aereo?.valor_cop_63, t: aereo?.trm_63 }, { c: 520 * 4321.5, t: 4321.5 });
  assert.deepEqual({ c: hotel?.valor_cop_63, t: hotel?.trm_63 }, { c: 210 * 4321.5, t: 4321.5 });
  assert.ok(idsCxp(bd).every((c) => c.trm_63 === 4321.5), "ninguna CxP usa la TRM de referencia");
  assert.equal(importeAsiento(bd, aereo?.id), 520 * 4321.5);
  assert.equal(importeAsiento(bd, hotel?.id), 210 * 4321.5);
  const [llamada] = bd.llamadasRpc.filter((c) => c.fn === "aceptar_oferta_63");
  assert.equal(llamada?.args.p_trm_provisional, 4321.5, "la tasa viaja a aceptar_oferta_63");
});

test("la tasa ingresada manda aunque trm_referencia no exista, y se tolera como texto numérico del formulario", async () => {
  const { bd } = montar({ ...USD_USD_SIN_TRM, trmRef: null });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r = await convertirCotizacion(cot.id, PASAJEROS as never, false, undefined, "4100.25" as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("p63_aceptacion")[0]?.trm_provisional, 4100.25);
});

test("TRM provisional inválida (0, negativa, NaN, texto, booleano): se rechaza ANTES de reservar número, aunque haya TRM de referencia", async () => {
  for (const mala of [0, -5, Number.NaN, "abc", true, Number.POSITIVE_INFINITY, 1e11, 1e20, 0.00001]) {
    const { bd } = montar({ ...USD_USD_SIN_TRM, trmRef: 4000 });
    const cot = await crearCotizacion(pedido() as never);
    assert.equal(cot.ok, true, JSON.stringify(cot));
    if (!cot.ok) return;
    const antes = consecutivo();
    const r = await convertirCotizacion(cot.id, PASAJEROS as never, false, undefined, mala as never);
    assert.equal(r.ok, false, String(mala));
    assert.match((r as { error: string }).error, /TRM provisional debe ser un número positivo/, String(mala));
    assert.equal(consecutivo(), antes, `no se gastó ningún consecutivo con ${String(mala)}`);
    assert.equal(bd.filas("p63_aceptacion").length, 0);
    assert.equal(bd.filas("ventas").length, 0);
    assert.equal(bd.filas("cuentas_por_pagar").length, 0);
    assert.equal(bd.filas("asientos_contables").length, 0);
    assert.equal(bd.filas("p63_oferta")[0]?.estado, "abierta");
    assert.equal(bd.llamadasRpc.filter((c) => c.fn === "aceptar_oferta_63").length, 0, "ni siquiera se llama a la aceptación");
  }
});

test("SIN tasa ingresada ni de referencia no se reserva número (el consecutivo no avanza) y con la tasa la misma cotización se contrata", async () => {
  const { bd } = montar({ ...USD_USD_SIN_TRM, trmRef: null });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const antes = consecutivo();
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /TRM provisional|TRM de referencia/);
  assert.equal(consecutivo(), antes, "no se reservó ningún número");
  assert.equal(bd.filas("p63_aceptacion").length, 0);
  assert.equal(bd.filas("ventas").length, 0);
  assert.equal(bd.filas("p63_oferta")[0]?.estado, "abierta");
  const r2 = await convertirCotizacion(cot.id, PASAJEROS as never, false, undefined, 4000);
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(consecutivo(), (antes ?? 450) + 1, "ahora sí, UN consecutivo");
});

test("la tasa ingresada se IGNORA si la oferta ya tiene TRM de publicación (manda la de la oferta; no se captura provisional)", async () => {
  const { bd } = montar({ ...USD_USD, trmRef: 4000 });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r = await convertirCotizacion(cot.id, PASAJEROS as never, false, undefined, 4999);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("p63_aceptacion")[0]?.trm_provisional ?? null, null);
  assert.ok(idsCxp(bd).every((c) => c.trm_63 === 4000));
});

test("USD→USD con TRM de publicación: NO se captura ninguna provisional (la de la oferta manda)", async () => {
  const { bd } = montar({ ...USD_USD, trmRef: 4999 });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("p63_aceptacion")[0]?.trm_provisional ?? null, null);
  assert.ok(idsCxp(bd).every((c) => c.trm_63 === 4000), "las CxP llevan la TRM de la oferta, no la de referencia");
});

test("TRM cambiada DESPUÉS de cotizar (USD→USD): se exige reconfirmar con una cotización nueva; no se crea contrato", async () => {
  const { bd } = montar(USD_USD);
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  bd.filas("armado_paquetes")[0].trm_oferta = 4100;
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /cambi[oó] desde que se cotiz[oó]/i);
  assert.equal(bd.filas("ventas").length, 0);
});

test("TRM cambiada DESPUÉS de cotizar (COP→USD): también se rechaza (R/TRM y el costo cambiarían)", async () => {
  const { bd } = montar(COP_USD);
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  bd.filas("armado_paquetes")[0].trm_oferta = 3900;
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /cambi[oó] desde que se cotiz[oó]/i);
  assert.equal(bd.filas("ventas").length, 0);
});

test("Fuente cambiada DESPUÉS de cotizar (tarifa R en USD): NO se cobra una copia vieja", async () => {
  const { bd } = montar(USD_USD);
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  bd.filas("empaquetados")[0].tarifa_para_empaquetar = 300;
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /cambi[oó]|Actualiza la salida/i);
  assert.equal(bd.filas("ventas").length, 0);
});

test("Fuente que cambia de MONEDA después de cotizar (USD→COP en Empaquetados): la copia de la salida ya no coincide", async () => {
  const { bd } = montar(USD_USD);
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  bd.filas("empaquetados")[0].moneda = "COP";
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /cambi[oó]|Actualiza la salida|moneda/i);
  assert.equal(bd.filas("ventas").length, 0);
});

test("Fuente inelegible: el vuelo recibe record (PNR) después de cotizar → no se reserva", async () => {
  const { bd } = montar(COP_USD);
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  bd.filas("empaquetados")[0].record = "L93FYZ";
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /ya tiene record/i);
  assert.equal(bd.filas("ventas").length, 0);
});

test("Fuente inelegible: el vuelo está desactivado → no se cotiza", async () => {
  const { bd } = montar({ ...USD_USD, fuente: { activo: false } });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, false);
  assert.match((cot as { error: string }).error, /desactivad|no est[aá] disponible|elegible/i);
  assert.equal(bd.filas("cotizaciones").length, 0);
});

test("Moneda de publicación cambiada DESPUÉS de cotizar (USD→COP sin regenerar): el tarifario publicado ya no es la moneda de la oferta; no se cobra", async () => {
  const { bd } = montar(USD_USD);
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  bd.filas("armado_paquetes")[0].moneda_publicacion = "COP";
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /cambi[oó]|tarifario publicado|Regenera/i);
  assert.equal(bd.filas("ventas").length, 0);
  assert.notEqual(bd.filas("cotizaciones")[0]?.estado, "convertida");
});

test("Tarifario publicado en otra moneda que la elegida (cambió la moneda y no se regeneró): ni siquiera se cotiza", async () => {
  const { bd } = montar({ ...USD_USD, paquete: { moneda_publicacion: "COP" } });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, false);
  assert.match((cot as { error: string }).error, /tarifario publicado|Regenera/i);
  assert.equal(bd.filas("cotizaciones").length, 0);
});

test("B2B en USD: el plan (comisión sobre PVP − BNC, compra neta) se congela en dólares y la cabecera sale de ese valor", async () => {
  const { bd } = montar({ ...USD_USD });
  bd.filas("aliados").push({ id: 900, nombre: "Agencia Uno", nit: "901", tipo: "agencia", pct_comision: 0.1, aplica_retencion: false, pct_retencion: 0 });
  const cot = await crearCotizacion(pedido({ tipoAsesor: "agencia", agenciaNombre: "Agencia Uno", aliadoId: 900, modoCompra: "neta" }) as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  // PVP 889 − BNC (2 × 290 = 580) = base 309 → comisión 10 % = 30,9 → 31 (el redondeo al entero es el de siempre del plan B2B).
  const snap = bd.filas("p63_oferta")[0]?.snapshot as { b2b: Record<string, unknown> | null; cabecera: Record<string, unknown> };
  assert.deepEqual(snap.b2b, { aliado_id: 900, tipo_asesor: "agencia", pct: 0.1, base: 309, comision: 31, modo_compra: "neta", comision_estado: "descontada", precio_final: 858 });
  assert.equal(snap.cabecera.moneda, "USD");
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  const [venta] = bd.filas("ventas");
  assert.equal(venta?.moneda, "USD");
  assert.equal(venta?.precio_venta, 858);
  assert.equal(venta?.comision_b2b, 31);
  assert.equal(bd.filas("aliados_b2b").length, 1);
});

// ═══ 234 · hallazgo 1 — TRM provisional OBLIGATORIA, sin respaldo en trm_referencia ═══════════════════════════════════════════════════════════
test("TRM provisional OBLIGATORIA: vacía (undefined, null, '', espacios) se rechaza AUNQUE trm_referencia exista y sea válida; nada se reserva ni se crea", async () => {
  for (const vacia of [undefined, null, "", "   "]) {
    const { bd } = montar({ ...USD_USD_SIN_TRM, trmRef: 4000 });
    const cot = await crearCotizacion(pedido() as never);
    assert.equal(cot.ok, true, JSON.stringify(cot));
    if (!cot.ok) return;
    const antes = consecutivo();
    const r = await convertirCotizacion(cot.id, PASAJEROS as never, false, undefined, vacia as never);
    assert.equal(r.ok, false, `con ${JSON.stringify(vacia)} no debe convertirse`);
    assert.match((r as { error: string }).error, /ingresa la TRM provisional/, JSON.stringify(vacia));
    assert.equal(consecutivo(), antes, "no se consumió ningún consecutivo");
    assert.equal(bd.filas("p63_aceptacion").length, 0, "no hay aceptación");
    assert.equal(bd.filas("ventas").length, 0, "ni venta");
    assert.equal(bd.filas("cuentas_por_pagar").length, 0, "ni CxP");
    assert.equal(bd.filas("asientos_contables").length, 0, "ni asientos");
    assert.equal(bd.filas("p63_oferta")[0]?.estado, "abierta", "la oferta sigue abierta");
    assert.equal(bd.llamadasRpc.filter((c) => c.fn === "aceptar_oferta_63").length, 0, "el servidor ni siquiera llama a la aceptación");
  }
});

test("llamada RPC de CINCO argumentos (p_trm_provisional por defecto NULL) sobre una oferta USD sin TRM: p63_trm_requerida aunque haya trm_referencia; sin número ni aceptación", async () => {
  const { bd } = montar({ ...USD_USD_SIN_TRM, trmRef: 4000 });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const of = bd.filas("p63_oferta")[0];
  const sb = (globalThis as unknown as { __arnesFechas: { sb: { rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> } } }).__arnesFechas.sb;
  const antes = consecutivo();
  const cinco = { p_cotizacion: cot.id, p_tenant: "mayorista", p_usuario: "u-arnes", p_huella: of?.huella, p_huella_financiera: of?.huella_financiera };
  const r = await sb.rpc("aceptar_oferta_63", cinco);
  assert.match(r.error?.message ?? "", /p63_trm_requerida/, "sin 6.º argumento no se acepta");
  const rNull = await sb.rpc("aceptar_oferta_63", { ...cinco, p_trm_provisional: null });
  assert.match(rNull.error?.message ?? "", /p63_trm_requerida/, "NULL explícito tampoco");
  assert.equal(consecutivo(), antes);
  assert.equal(bd.filas("p63_aceptacion").length, 0);
  assert.equal(bd.filas("p63_oferta")[0]?.estado, "abierta");
  const ok = await sb.rpc("aceptar_oferta_63", { ...cinco, p_trm_provisional: 4100 });
  assert.equal(ok.error, null, "con la tasa ingresada, la MISMA oferta sí se acepta");
  assert.equal(bd.filas("p63_aceptacion")[0]?.trm_provisional, 4100);
});

test("la tasa ausente no afecta a lo vigente: oferta con TRM de publicación y oferta COP se contratan sin tasa ingresada", async () => {
  for (const esc of [{ ...USD_USD, trmRef: null }, { ...USD_COP, trmRef: null }] as Escenario[]) {
    const { bd } = montar(esc);
    const cot = await crearCotizacion(pedido() as never);
    assert.equal(cot.ok, true, JSON.stringify(cot));
    if (!cot.ok) return;
    const r = await convertirCotizacion(cot.id, PASAJEROS as never);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(bd.filas("p63_aceptacion")[0]?.trm_provisional ?? null, null);
  }
});

test("235: convertir una oferta #63 SIN elegir la moneda de cobro se rechaza en el servidor antes de numerar; con la elección expresa se contrata", async () => {
  const { bd } = montar(USD_USD);
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  for (const omitida of [undefined, null, ""]) {
    const r = await convertirCotizacionReal(cot.id, PASAJEROS as never, false, undefined, undefined, omitida as never);
    assert.equal(r.ok, false);
    assert.match(String((r as { error?: string }).error), /Elige la moneda de cobro/);
  }
  assert.equal(bd.filas("ventas").length, 0, "ninguna venta se creó");
  assert.equal(bd.filas("p63_aceptacion").length, 0, "ninguna aceptación se creó");
  const ok = await convertirCotizacionReal(cot.id, PASAJEROS as never, false, undefined, undefined, "USD");
  assert.equal(ok.ok, true, JSON.stringify(ok));
});
