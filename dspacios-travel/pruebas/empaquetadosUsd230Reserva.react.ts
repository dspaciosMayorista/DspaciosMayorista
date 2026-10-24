// Se ejecuta por comando directo (sin tocar package.json):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/empaquetadosUsd230Reserva.react.ts
//
// #90 / migración 230 · Reserva de PUNTA A PUNTA con el motor REAL de una salida VINCULADA a un Empaquetado en USD:
// el tarifario se publica en COP (R y F convertidos × TRM una sola vez), el contrato se vende en COP, el costo del contrato
// es el equivalente COP y la CxP aérea conserva USD con valor_cop_63/trm_63; una fuente en COP con equivalentes exactos da
// lo mismo (compatibilidad con la 227). La base real (CHECK, triggers, aceptación) se prueba en Postgres: test_230_*.sql.
import { usarBD, type Fila } from "./support/fechaNegocioArnes.ts";
import { crearRpcs63, instalarFencing63, type OpcionesRpc63 } from "./support/rpc63.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";

const { crearCotizacion, convertirCotizacion } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");

function fechaBogota(offsetDias: number): string {
  return new Date(Date.now() + offsetDias * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
const IDA = fechaBogota(30);
const REG = fechaBogota(31); // 1 noche: el neto por noche es el neto de la estadía

const PAQUETE_ID = 70;
const HOTEL_ID = 217;
const SALIDA_ID = 11;
const EMPAQUETADO_ID = 5;
const BLOQUEO_ID = 31;
const CAT = "Estándar";
const REGIMEN = "PAE";
const R = 1_130_000;
const N = 1_000_000;
const F = 80_500;

const pasajero = (nombres: string, nacimiento: string, extra: Record<string, unknown> = {}) => ({
  nombres, apellidos: "Pérez", tipoDoc: "CC", numeroDoc: `D-${nombres}`, fechaNacimiento: nacimiento, nacionalidad: "CO", esInfante: false, ...extra,
});
const PASAJEROS = [pasajero("Juan", "1990-01-01"), pasajero("Ana", "1992-01-01")];
const hace1Anio = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
const PASAJEROS_CON_INFANTE = [...PASAJEROS, pasajero("Bebe", hace1Anio, { esInfante: true, responsableIndex: 0 })];

function pedido(over: Record<string, unknown> = {}) {
  return {
    paqueteId: PAQUETE_ID, bloqueoId: null, empaquetadoId: null, salidaId: SALIDA_ID, modulo: "dinamico", hotelId: HOTEL_ID,
    categoria: CAT, regimen: REGIMEN, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0,
    cliente: { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", telefono: "300", email: "a@a.com" },
    tipoAsesor: "interno", asesorInterno: "Asesor", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
    aliadoId: null, plazo: "2026-12-31", servicios: [], pasajeros: PASAJEROS,
    ...over,
  };
}

type Escenario = {
  bloqueo?: boolean;
  cupos?: number;
  paquete?: Fila;
  fuente?: Fila;
  conServicio?: boolean;
  /** Aliados del catálogo y parámetros generales de comisión (B2B). */
  aliados?: Fila[];
  parametros?: Fila[];
  /** Campos a sobreescribir en la temporada `Base` del hotel (p. ej. `compra_fin`). */
  temporadaHotel?: Fila;
  /** Servicio OPCIONAL (id 901) con una temporada vigente para la fecha del viaje y estos límites de compra. */
  servicioOpcional?: { compra_inicio: string | null; compra_fin: string | null };
  op?: OpcionesRpc63;
  /** Se invoca en cada consulta a una tabla (para simular un cambio de la base ENTRE dos lecturas del servidor). */
  alConsultar?: (tabla: string) => void;
};

function montar(esc: Escenario = {}) {
  const tablasConsultadas: string[] = [];
  const bloqueo = !!esc.bloqueo;
  const infante = (extra: Fila): Fila => ({
    paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID, categoria: CAT, regimen: REGIMEN, acomodacion: "infante", hotel_nombre: "Hotel Dinámico",
    destino_nombre: "CARTAGENA", fecha_ida: IDA, fecha_regreso: REG, moneda: "COP", ...extra,
  });
  const origenFila = bloqueo ? { salida_id: null, empaquetado_id: null, bloqueo_id: BLOQUEO_ID } : { salida_id: SALIDA_ID, empaquetado_id: null, bloqueo_id: null };
  const semilla: Record<string, Fila[]> = {
    usuarios: [{ id: "u-arnes", rol: "superadmin", activo: true, tenant: "mayorista", nombre: "Asesor" }],
    cotizaciones: [],
    parametros_tributarios: esc.parametros ?? [], aliados: esc.aliados ?? [],
    hoteles: [{
      id: HOTEL_ID, modelo_tarifario: "persona", nombre: "Hotel Dinámico", moneda: bloqueo ? "COP" : "USD", adults_only: false, pet_friendly: false,
      edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12, pax_min: 1, pax_max: 4,
      nino_nota: null, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null, proveedores: null,
    }],
    armado_paquetes: [{
      id: PAQUETE_ID, pct_mk: 0.2, impuesto_tipo: "tiquete", impuesto_fijo: 100_000, destino_id: 1, tipo: bloqueo ? "bloqueo" : "dinamico",
      destinos_aereos_alternativos: false, modo_oferta: bloqueo ? "legacy" : "cop_trm_63", trm_oferta: bloqueo ? null : 4000,
      tarifario_generacion_publicada: 3, tarifario_revision_publicada: 5, tarifario_revision_fuente: 5, p63_rev_costos: 0, ...(esc.paquete ?? {}),
    }],
    tarifario_resultado_publicable: [
      { ...origenFila, paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID, categoria: CAT, regimen: REGIMEN, acomodacion: "doble", precio_pvp: 1_680_000, precio_pvp_menor2: null,
        hotel_nombre: "Hotel Dinámico", destino_nombre: "CARTAGENA", fecha_ida: IDA, fecha_regreso: REG, moneda: "COP" },
      infante({ ...origenFila, precio_pvp: 1_230_000, precio_pvp_menor2: 130_500 }),
      ...(esc.servicioOpcional ? [{ paquete_id: PAQUETE_ID, modulo: "servicios", servicio_id: 901, servicio_nombre: "Tour opcional", tipo_tarifa: "persona", pax_desde: null, pax_hasta: null, precio_pvp: 100_000, precio_pvp_menor2: null, recargo_individual: 0 }] : []),
    ],
    hotel_acomodaciones: [{ hotel_id: HOTEL_ID, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 }],
    hotel_temporadas: [{
      id: 1, hotel_id: HOTEL_ID, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null,
      tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null, ...(esc.temporadaHotel ?? {}),
    }],
    tarifa_hotel: [{
      id: 10, hotel_id: HOTEL_ID, tipo_habitacion: CAT, alimentacion: REGIMEN, temporada: "Base",
      neto_sencilla: null, neto_doble: 100, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: 10, nota_infante: null,
      notas: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null, precio_final_autoritativo: false,
    }],
    armado_servicios: esc.conServicio ? [{
      paquete_id: PAQUETE_ID, servicio_id: 900, modo: "persona", incluido: true,
      servicios_adicionales: { nombre: "Tour", categoria: "tour_traslado", precio_persona: 10, precio_infante: 0, liquidacion: "paquete", proveedor_id: null, proveedores: null },
    }] : [],
    servicios_adicionales: [{ id: 900, moneda: "USD" }, ...(esc.servicioOpcional ? [{ id: 901, moneda: "COP", categoria: "otro", proveedor_id: null, precio_persona: 80_000, precio_infante: null, recargo_individual: null, liquidacion: "paquete", nombre: "Tour opcional" }] : [])],
    servicio_tarifa_pax: [],
    servicio_temporadas: esc.servicioOpcional ? [{
      servicio_id: 901, nombre: "Alta", fecha_inicio: IDA, fecha_fin: REG, compra_inicio: esc.servicioOpcional.compra_inicio, compra_fin: esc.servicioOpcional.compra_fin,
      prioridad: 1, precio_persona: 80_000, precio_infante: null, recargo_individual: null,
    }] : [],
    destinos: [{ id: 1, nombre: "CARTAGENA", codigo_iata: "CTG", pais: "Colombia", activo: true }],
    armado_paquete_destinos_aereos: [],
    salidas_dinamicas: [{
      id: SALIDA_ID, paquete_id: PAQUETE_ID, empaquetado_id: EMPAQUETADO_ID, activo: true, compra_inicio: null, compra_fin: null,
      fecha_ida: IDA, fecha_regreso: REG, ruta: "BOG - CTG - BOG", aerolinea: "JetSMART", valor_tiquete: R, fee_infante: F,
      aplica_mk: false, ta: 0, moneda: "COP",
    }],
    empaquetados: [{
      id: EMPAQUETADO_ID, activo: true, record: null, compra_inicio: null, compra_fin: null, fecha_ida: IDA, fecha_regreso: REG,
      ruta: "BOG - CTG - BOG", aerolinea: "JetSMART", destino_id: 1, moneda: "COP", tarifa_proveedor: N, tarifa_para_empaquetar: R, fee_infante: F,
      vuelo_ida: null, vuelo_regreso: null, hora_salida_ida: null, hora_llegada_ida: null, hora_salida_reg: null, hora_llegada_reg: null, proveedores: null,
      ...(esc.fuente ?? {}),
    }],
    bloqueos_vuelo: bloqueo ? [{
      id: BLOQUEO_ID, destino_id: 1, record: "L93FYZ", ruta: "BOG - CTG - BOG", aerolinea: "Avianca", fecha_ida: IDA, fecha_regreso: REG,
      tarifa_para_empaquetar: N, fee_infante: F, vuelo_ida: "AV123", vuelo_regreso: "AV124",
      hora_salida_ida: null, hora_llegada_ida: null, hora_salida_reg: null, hora_llegada_reg: null, proveedores: null,
    }] : [],
    cupos_por_bloqueo: bloqueo ? [{ id: BLOQUEO_ID, cupos_disponibles: esc.cupos ?? 0 }] : [],
  };
  // RPC de #63 (227) simuladas de forma ESTRICTA (pruebas/support/rpc63.ts): aceptación atómica, fencing de la cabecera y la RPC
  // financiera que deriva todo del snapshot aceptado. Lo que la base real prueba (candados, carreras, ACL) está en el SQL de CI.
  const ref: { bd?: ReturnType<typeof usarBD> } = {};
  const bd = usarBD(semilla, { congelar_condiciones_contrato: () => "OK", ...crearRpcs63(ref, esc.op) });
  ref.bd = bd;
  instalarFencing63(bd);
  // Espía de consultas: cualquier lectura a las tablas de cupos queda registrada (y, en una vinculada, hace fallar la prueba).
  const sbBase = (globalThis as unknown as { __arnesFechas: { sb: { from: (t: string) => unknown } } }).__arnesFechas.sb;
  const fromOriginal = sbBase.from.bind(sbBase);
  sbBase.from = (t: string) => { tablasConsultadas.push(t); esc.alConsultar?.(t); return fromOriginal(t); };
  return { bd, tablasConsultadas };
}


// ── 230: Empaquetado y salida vinculada en USD ───────────────────────────────────────────────────────────────────────────
const TRM_PAQUETE = 4000;
const R_USD = 415;
const N_USD = 380;
const F_USD = 45;

/** Deja el escenario con la fuente y la salida en USD y el tarifario publicado como lo publicaría generarTarifario (TRM 4.000). */
function pasarAUsd(bd: ReturnType<typeof montar>["bd"]) {
  const fuente = bd.filas("empaquetados")[0];
  Object.assign(fuente, { moneda: "USD", tarifa_proveedor: N_USD, tarifa_para_empaquetar: R_USD, fee_infante: F_USD });
  const salida = bd.filas("salidas_dinamicas")[0];
  Object.assign(salida, { moneda: "USD", valor_tiquete: R_USD, fee_infante: F_USD });
  // hotel 100 USD × 4.000 / 0,8 = 500.000 + R 1.660.000 = 2.160.000; infante: hotel 50.000 + R → 1.710.000; menor de 2: 50.000 + F 180.000.
  for (const f of bd.filas("tarifario_resultado_publicable")) {
    if (f.acomodacion === "doble") Object.assign(f, { precio_pvp: 2_160_000 });
    if (f.acomodacion === "infante") Object.assign(f, { precio_pvp: 1_710_000, precio_pvp_menor2: 230_000 });
  }
}

test("USD · VINCULADA a un Empaquetado en USD: venta en COP, BNC = R convertido, CxP aérea en USD con su equivalente COP congelado", async () => {
  const { bd } = montar();
  pasarAUsd(bd);
  const input = pedido({ pasajeros: PASAJEROS_CON_INFANTE, edadesMenores: [1], cantidadMenores: 1 });
  const cot = await crearCotizacion(input as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const guardada = bd.filas("cotizaciones")[0];
  assert.equal(JSON.stringify(guardada).includes(String(N_USD)), false, "el costo N (tarifa del proveedor) no viaja en la cotización");

  const r = await convertirCotizacion(cot.id, PASAJEROS_CON_INFANTE as never);
  assert.equal(r.ok, true, JSON.stringify(r));

  const [venta] = bd.filas("ventas");
  assert.equal(venta?.moneda, "COP", "el contrato se vende en COP");
  assert.equal(venta?.precio_venta, 4_550_000, "2 adultos 2.160.000 + menor de 2 años 230.000");
  assert.equal(venta?.impuesto, 2 * R_USD * TRM_PAQUETE, "BNC tiquete = R convertido × pax con silla (415 USD × 4.000 × 2)");
  assert.equal(venta?.costo_aereo, (2 * N_USD + F_USD) * TRM_PAQUETE, "costo del contrato en COP = equivalente de (N × pax + F × menores de 2) en USD");
  assert.equal(venta?.financiero_estado, "completo");

  const cxp = bd.filas("cuentas_por_pagar");
  const aerea = cxp.find((c) => c.tipo_proveedor === "aereo");
  assert.deepEqual(
    { v: aerea?.valor_total, m: aerea?.moneda, c: aerea?.valor_cop_63, t: aerea?.trm_63 },
    { v: 2 * N_USD + F_USD, m: "USD", c: (2 * N_USD + F_USD) * TRM_PAQUETE, t: TRM_PAQUETE },
    "la CxP aérea conserva USD y lleva el equivalente en COP congelado a la TRM"
  );
  assert.equal(cxp.filter((c) => c.tipo_proveedor === "aereo").length, 1, "una sola CxP aérea");

  // El libro contable devenga el equivalente COP, jamás el nominal USD.
  const a = bd.filas("asientos_contables").find((x) => x.origen === "cxp" && x.referencia === `cxp:${aerea?.id}`);
  const devengado = bd.filas("asiento_lineas").filter((l) => l.asiento_id === a?.id).reduce((s, l) => s + Number(l.debe || 0), 0);
  assert.equal(devengado, (2 * N_USD + F_USD) * TRM_PAQUETE);
});

test("USD · equivalencia: la misma oferta con la fuente en COP (equivalentes exactos) da el MISMO contrato en COP", async () => {
  const usd = montar();
  pasarAUsd(usd.bd);
  const cotU = await crearCotizacion(pedido({ pasajeros: PASAJEROS_CON_INFANTE, edadesMenores: [1], cantidadMenores: 1 }) as never);
  assert.equal(cotU.ok, true);
  if (!cotU.ok) return;
  assert.equal((await convertirCotizacion(cotU.id, PASAJEROS_CON_INFANTE as never)).ok, true);
  const ventaU = usd.bd.filas("ventas")[0];
  const aereaU = usd.bd.filas("cuentas_por_pagar").find((c) => c.tipo_proveedor === "aereo");

  const cop = montar();
  const fuente = cop.bd.filas("empaquetados")[0];
  Object.assign(fuente, { moneda: "COP", tarifa_proveedor: N_USD * TRM_PAQUETE, tarifa_para_empaquetar: R_USD * TRM_PAQUETE, fee_infante: F_USD * TRM_PAQUETE });
  Object.assign(cop.bd.filas("salidas_dinamicas")[0], { moneda: "COP", valor_tiquete: R_USD * TRM_PAQUETE, fee_infante: F_USD * TRM_PAQUETE });
  for (const f of cop.bd.filas("tarifario_resultado_publicable")) {
    if (f.acomodacion === "doble") Object.assign(f, { precio_pvp: 2_160_000 });
    if (f.acomodacion === "infante") Object.assign(f, { precio_pvp: 1_710_000, precio_pvp_menor2: 230_000 });
  }
  const cotC = await crearCotizacion(pedido({ pasajeros: PASAJEROS_CON_INFANTE, edadesMenores: [1], cantidadMenores: 1 }) as never);
  assert.equal(cotC.ok, true);
  if (!cotC.ok) return;
  assert.equal((await convertirCotizacion(cotC.id, PASAJEROS_CON_INFANTE as never)).ok, true);
  const ventaC = cop.bd.filas("ventas")[0];
  const aereaC = cop.bd.filas("cuentas_por_pagar").find((c) => c.tipo_proveedor === "aereo");

  for (const campo of ["precio_venta", "impuesto", "costo_aereo", "costo_hotel"]) {
    assert.equal(ventaU?.[campo], ventaC?.[campo], campo);
  }
  assert.equal(aereaU?.valor_cop_63, aereaC?.valor_cop_63, "mismo equivalente COP");
  assert.equal(aereaC?.moneda, "COP", "la fuente en COP sigue generando su CxP en COP (compatibilidad con la 227)");
});

test("USD · la moneda de la salida no coincide con la de su fuente: no se cobra (pide actualizar y regenerar)", async () => {
  const { bd } = montar();
  pasarAUsd(bd);
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  bd.filas("salidas_dinamicas")[0].moneda = "COP";
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, false);
  assert.equal(bd.filas("ventas").length, 0, "no se creó contrato");
});

test("USD · cambiar la moneda de la fuente después de cotizar invalida la oferta (nunca se cobra en silencio)", async () => {
  const { bd } = montar();
  pasarAUsd(bd);
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  bd.filas("empaquetados")[0].moneda = "COP";
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, false);
  assert.equal(bd.filas("ventas").length, 0);
});
