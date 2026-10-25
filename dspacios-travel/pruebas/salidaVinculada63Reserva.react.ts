// Se ejecuta por comando directo (sin tocar package.json):
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
//        --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/salidaVinculada63Reserva.react.ts
//
// #63 · Reserva de PUNTA A PUNTA con el motor REAL (crearCotizacion → convertirCotizacion → computarReserva →
// reservarDesdeTarifarioInterno → escritura financiera → asientos) contra la BD en memoria del arnés:
//   · una salida VINCULADA a un Empaquetado sin record se cotiza y se reserva SIN consultar cupos de Bloqueo
//     (el espía lanza si se toca `cupos_por_bloqueo`, `sillas` o `bloqueos_vuelo`), aun con 0 cupos disponibles;
//   · el MISMO flujo con un BLOQUEO sigue exigiendo cupos (rechaza con 0 disponibles y reserva con cupos);
//   · FX1 de punta a punta: venta en COP, BNC = R × pax con silla, costo aéreo = N × pax + F × menores de 2 años,
//     hotel y servicios en USD como CxP en su moneda de origen con el equivalente COP congelado a la TRM, y el
//     asiento contable devengado por ese equivalente (nunca por el nominal en dólares);
//   · si entre cotizar y convertir cambia lo que el cliente vio (TRM / tarifario publicado), NO se cobra en silencio.
// La base real (CHECK, triggers, RPC financiera) se prueba en Postgres: supabase/scripts/test_227_salida_vinculada.sql.
import { usarBD, type Fila } from "./support/fechaNegocioArnes.ts";
import { crearRpcs63, instalarFencing63, type OpcionesRpc63 } from "./support/rpc63.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";

const { crearCotizacion, convertirCotizacion } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");

// 235 (#90 F): convertir una oferta #63 exige ELEGIR expresamente la moneda de cobro (la omisión se rechaza antes de numerar). Todas las ofertas de este
// arnés son COP (la venta se asserta en COP; el hotel y los servicios en USD son COSTOS, no la moneda de la oferta), así que la elección es COP: la misma
// moneda de la oferta, sin conversión y sin TRM de cobro. La TRM de cobro solo viaja si se pide cobrar en la otra moneda. Las conversiones de un Bloqueo
// (no es #63: no hay oferta ni elección) y los casos que prueban a propósito la omisión o el reintento usan `convertirCotizacion` directamente.
const MONEDA_OFERTA = "COP";
function convertirEligiendoCobro(id: number, pasajeros: unknown, cobro: { monedaCobro?: "COP" | "USD"; trmCobro?: number } = {}) {
  const monedaCobro = cobro.monedaCobro ?? MONEDA_OFERTA;
  const trmCobro = monedaCobro === MONEDA_OFERTA ? null : (cobro.trmCobro ?? null);
  return convertirCotizacion(id, pasajeros as never, undefined, undefined, undefined, monedaCobro, trmCobro);
}

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
const TABLAS_DE_CUPOS = ["cupos_por_bloqueo", "sillas", "bloqueos_vuelo"];

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
const tocoCupos = (consultadas: string[]) => consultadas.filter((t) => TABLAS_DE_CUPOS.includes(t));

test("VINCULADA: se cotiza y se reserva SIN consultar cupos de Bloqueo (0 cupos no la frena); FX1 de punta a punta", async () => {
  const { bd, tablasConsultadas } = montar({ conServicio: true, cupos: 0 });
  const input = pedido({ pasajeros: PASAJEROS_CON_INFANTE, edadesMenores: [1], cantidadMenores: 1 });
  const cot = await crearCotizacion(input as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const guardada = bd.filas("cotizaciones")[0];
  assert.match(String((guardada?.payload as { oferta63?: { huella?: string } })?.oferta63?.huella ?? ""), /^[0-9a-f]{64}$/, "la cotización guarda la huella de lo mostrado");
  assert.equal(JSON.stringify(guardada).includes(String(N)), false, "el costo N (tarifa del proveedor) no viaja en la cotización");

  const r = await convertirEligiendoCobro(cot.id, PASAJEROS_CON_INFANTE);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(tocoCupos(tablasConsultadas), [], "una vinculada NO consulta cupos_por_bloqueo / sillas / bloqueos_vuelo");

  const [venta] = bd.filas("ventas");
  assert.equal(venta?.moneda, "COP");
  assert.equal(venta?.precio_venta, 3_490_500, "2 adultos 1.680.000 + infante 130.500");
  assert.equal(venta?.impuesto, 2 * R, "BNC tiquete = R × pax con silla; el menor de 2 años no genera BNC");
  assert.equal(venta?.costo_aereo, 2 * N + F, "N × pax con silla + F × menor de 2 años");
  assert.equal(venta?.aerolinea, "JetSMART");
  assert.equal(venta?.costo_hotel, 840_000, "USD 210 (2 × 100 + 10 del infante) a TRM 4.000");
  assert.equal(venta?.costo_receptivo, 80_000, "tour USD 20 (2 × 10 + infante gratis) a TRM 4.000");
  assert.equal(venta?.financiero_estado, "completo");
  assert.equal(venta?.bloqueo_ref_id ?? null, null);
  assert.equal(venta?.empaquetado_ref_id ?? null, null);

  const cxp = bd.filas("cuentas_por_pagar");
  const porTipo = (t: string) => cxp.find((c) => c.tipo_proveedor === t);
  assert.deepEqual({ v: porTipo("aereo")?.valor_total, m: porTipo("aereo")?.moneda, c: porTipo("aereo")?.valor_cop_63 }, { v: 2 * N + F, m: "COP", c: 2 * N + F });
  assert.deepEqual({ v: porTipo("hotel")?.valor_total, m: porTipo("hotel")?.moneda, c: porTipo("hotel")?.valor_cop_63, t: porTipo("hotel")?.trm_63 }, { v: 210, m: "USD", c: 840_000, t: 4000 });
  assert.deepEqual({ v: porTipo("receptivo")?.valor_total, m: porTipo("receptivo")?.moneda, c: porTipo("receptivo")?.valor_cop_63 }, { v: 20, m: "USD", c: 80_000 });

  // El libro contable devenga el EQUIVALENTE COP congelado, jamás el nominal USD.
  const importe = (cuentaId: unknown) => {
    const a = bd.filas("asientos_contables").find((x) => x.origen === "cxp" && x.referencia === `cxp:${cuentaId}`);
    const lineas = bd.filas("asiento_lineas").filter((l) => l.asiento_id === a?.id);
    return lineas.reduce((s, l) => s + Number(l.debe || 0), 0);
  };
  assert.equal(importe(porTipo("hotel")?.id), 840_000);
  assert.equal(importe(porTipo("receptivo")?.id), 80_000);
  assert.equal(importe(porTipo("aereo")?.id), 2 * N + F);

  // Vuelo del contrato: sin record, dos tramos; rótulos de menores de la 226 (R2, sin variantes).
  const tramos = bd.filas("contrato_vuelos");
  assert.deepEqual(tramos.map((t) => t.direccion), ["ida", "regreso"]);
  assert.ok(tramos.every((t) => t.record == null));
  const items = bd.filas("contrato_items").map((i) => String(i.descripcion));
  assert.ok(items.includes(`Infante · ${CAT} / ${REGIMEN}`), `rótulo de infante de la 226; ítems: ${items.join(" | ")}`);
});

test("VINCULADA con la fuente cambiada entre cotizar y convertir: NO se cobra una copia vieja (pide actualizar y regenerar)", async () => {
  const { bd } = montar();
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  bd.filas("empaquetados")[0].tarifa_para_empaquetar = 1_200_000;
  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /cambi[oó]|Actualiza la salida/i);
  assert.equal(bd.filas("ventas").length, 0, "no se creó ningún contrato");
});

test("VINCULADA: la fuente recibe un record (PNR) después de cotizar → ya no es una salida sin record: no se reserva", async () => {
  const { bd } = montar();
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  bd.filas("empaquetados")[0].record = "L93FYZ";
  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /ya tiene record/i);
  assert.equal(bd.filas("ventas").length, 0);
});

test("OFERTA CAMBIADA entre cotizar y convertir (TRM del paquete): se exige reconfirmar con una cotización nueva", async () => {
  const { bd } = montar();
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  bd.filas("armado_paquetes")[0].trm_oferta = 4100;
  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /cambi[oó] desde que se cotiz[oó]/i);
  assert.equal(bd.filas("ventas").length, 0);
  assert.notEqual(bd.filas("cotizaciones")[0]?.estado, "convertida", "la cotización NO queda convertida: se reconfirma con una nueva");
});

test("OFERTA CAMBIADA (tarifario regenerado: otra generación publicada): también exige reconfirmar", async () => {
  const { bd } = montar();
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  bd.filas("armado_paquetes")[0].tarifario_generacion_publicada = 4;
  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /cambi[oó] desde que se cotiz[oó]/i);
  assert.equal(bd.filas("ventas").length, 0);
});

test("una cotización SIN huella (paquete de siempre / cotizaciones anteriores) se convierte como siempre", async () => {
  const { bd } = montar({ bloqueo: true, cupos: 5 });
  const cot = await crearCotizacion(pedido({ bloqueoId: BLOQUEO_ID, salidaId: null, modulo: "bloqueo" }) as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  assert.equal((bd.filas("cotizaciones")[0]?.payload as { oferta63?: unknown }).oferta63, undefined, "un Bloqueo no lleva huella 63");
});

test("BLOQUEO: el mismo flujo SIGUE exigiendo cupos — con 0 disponibles se rechaza y no se crea contrato", async () => {
  const { bd, tablasConsultadas } = montar({ bloqueo: true, cupos: 0 });
  const cot = await crearCotizacion(pedido({ bloqueoId: BLOQUEO_ID, salidaId: null, modulo: "bloqueo" }) as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /No hay cupos suficientes en este vuelo \(disponibles: 0, requeridos: 2\)/);
  assert.ok(tablasConsultadas.includes("cupos_por_bloqueo"), "el Bloqueo SÍ consulta cupos_por_bloqueo");
  assert.equal(bd.filas("ventas").length, 0);
});

test("BLOQUEO: con cupos suficientes reserva (y consulta los cupos)", async () => {
  const { bd, tablasConsultadas } = montar({ bloqueo: true, cupos: 2 });
  const cot = await crearCotizacion(pedido({ bloqueoId: BLOQUEO_ID, salidaId: null, modulo: "bloqueo" }) as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(tablasConsultadas.includes("cupos_por_bloqueo"));
  assert.equal(bd.filas("ventas")[0]?.bloqueo_ref_id, BLOQUEO_ID);
  // Un paquete de siempre conserva su CxP sin moneda explícita ni equivalente COP (comportamiento de siempre).
  assert.ok(bd.filas("cuentas_por_pagar").every((c) => c.valor_cop_63 == null && c.trm_63 == null));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// E/F/G · aceptación atómica, materialización SOLO desde lo aceptado, cortes y reintentos.
// Las RPC de la base están simuladas de forma estricta (pruebas/support/rpc63.ts); la base real, en test_227_*.sql.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { derivado63 } from "./support/rpc63.ts";

const RPC_CLAVE = ["crear_cotizacion_oferta_63", "aceptar_oferta_63", "crear_pasajeros_contrato_con_sillas", "registrar_financiero_contrato"];
const consecutivo = () => (globalThis as unknown as { __arnesFechas: { seq?: number } }).__arnesFechas.seq;

test("E/F/G · orden y fuente de verdad: cotizar (RPC atómica) → aceptar → hijos → finanzas; el payload financiero ES el derivado de lo aceptado", async () => {
  const { bd } = montar({ conServicio: true });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, true, JSON.stringify(r));

  const orden = bd.llamadasRpc.map((c) => c.fn).filter((fn) => RPC_CLAVE.includes(fn));
  assert.deepEqual(orden, RPC_CLAVE, "cotizar y aceptar son RPC atómicas ANTES de crear nada; las finanzas, al final");
  const [a] = bd.filas("p63_aceptacion");
  assert.equal(a?.estado, "completa");
  assert.equal(bd.filas("ventas")[0]?.numero_contrato, a?.numero_contrato, "el número sale de la aceptación (misma transacción), no de otro consecutivo");
  assert.equal(consecutivo(), 451, "se gastó UN solo consecutivo");
  assert.equal(bd.filas("ventas")[0]?.aceptacion_63_id, a?.id, "la cabecera lleva el marcador de su aceptación");

  const fin = bd.llamadasRpc.find((c) => c.fn === "registrar_financiero_contrato")!.args;
  assert.deepEqual(fin.p_costos, derivado63(a!).costos, "los costos enviados a la RPC son los derivados de lo aceptado");
  assert.deepEqual(fin.p_cxp, derivado63(a!).cxp, "las obligaciones enviadas a la RPC son las derivadas de lo aceptado (con su clave estable)");
  assert.ok((fin.p_cxp as Fila[]).every((c) => typeof c.obligacion === "string" && c.fecha_obligacion === a?.fecha_negocio));

  // El snapshot PRIVADO trae costos y proveedores; lo que ve la cotización (payload/detalle) no.
  const oferta = bd.filas("p63_oferta")[0];
  assert.ok(JSON.stringify(oferta?.snapshot).includes("valor_cop"), "el snapshot privado trae las obligaciones con su equivalente COP");
  const cotizacion = bd.filas("cotizaciones")[0];
  const visible = JSON.stringify({ p: cotizacion?.payload, d: cotizacion?.detalle });
  assert.equal(/valor_cop|tarifa_proveedor|financiero|obligacion/.test(visible), false, "la cotización visible no lleva costos, proveedores ni obligaciones");
});

test("E/F/G · un cambio de CATÁLOGO después de aceptar NO altera el contrato: costos, proveedor, retención y moneda salen del snapshot", async () => {
  const cambios: string[] = [];
  const { bd } = montar({
    conServicio: true,
    op: {
      alMaterializar: () => {
        // Entre la aceptación y la escritura financiera cambian: el costo del vuelo fuente, el proveedor/retención del hotel y su neto.
        bd.filas("empaquetados")[0].tarifa_proveedor = 1_500_000;
        bd.filas("hoteles")[0].proveedores = { nombre: "OTRO PROVEEDOR", aplica_retencion: true, pct_retencion: 0.11 };
        bd.filas("tarifa_hotel")[0].neto_doble = 999;
        cambios.push("catalogo");
      },
    },
  });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(cambios, ["catalogo"], "el cambio de catálogo ocurrió DURANTE la materialización");
  const venta = bd.filas("ventas")[0];
  assert.equal(venta?.costo_aereo, 2 * N, "costo aéreo del snapshot (N × pax con silla), no el 1.500.000 nuevo");
  assert.equal(venta?.costo_hotel, 800_000, "hotel USD 200 a TRM 4.000 (neto del snapshot), no USD 999");
  const hotel = bd.filas("cuentas_por_pagar").find((c) => c.tipo_proveedor === "hotel");
  assert.equal(hotel?.valor_total, 200);
  assert.equal(hotel?.moneda, "USD");
  assert.equal(hotel?.valor_cop_63, 800_000);
  assert.notEqual(hotel?.proveedor, "OTRO PROVEEDOR", "el proveedor es el aceptado");
  assert.equal(hotel?.aplica_retencion, false);
  assert.equal(bd.filas("cuentas_por_pagar").find((c) => c.tipo_proveedor === "aereo")?.valor_total, 2 * N);
});

test("E/F/G · cambio SOLO de costo o proveedor con el PVP igual entre cotizar y convertir: se rechaza, sin número ni contrato", async () => {
  const casos: Array<[string, (bd: ReturnType<typeof montar>["bd"]) => void]> = [
    ["costo N del vuelo fuente (R y PVP iguales)", (bd) => { bd.filas("empaquetados")[0].tarifa_proveedor = N + 1; }],
    ["retención del proveedor del hotel", (bd) => { bd.filas("hoteles")[0].proveedores = { nombre: "Hotel SAS", aplica_retencion: true, pct_retencion: 0.035 }; }],
    ["neto del hotel (el PVP del tarifario publicado no se movió)", (bd) => { bd.filas("tarifa_hotel")[0].neto_doble = 101; }],
    ["contador de costos de la base (proveedor/retención/reglas cambiaron sin mover precios)", (bd) => { bd.filas("armado_paquetes")[0].p63_rev_costos = 1; }],
  ];
  for (const [que, cambiar] of casos) {
    const { bd } = montar({ conServicio: true });
    const cot = await crearCotizacion(pedido() as never);
    assert.equal(cot.ok, true, JSON.stringify(cot));
    if (!cot.ok) return;
    cambiar(bd);
    const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
    assert.equal(r.ok, false, `${que}: debía rechazarse`);
    assert.match((r as { error: string }).error, /cambi[oó]/i, que);
    assert.equal(bd.filas("ventas").length, 0, `${que}: no se creó contrato`);
    assert.equal(bd.filas("p63_aceptacion").length, 0, `${que}: no se reservó número ni intento`);
    assert.equal(consecutivo() ?? 450, 450, `${que}: no se gastó consecutivo`);
    assert.equal(bd.filas("p63_oferta")[0]?.estado, "abierta", `${que}: la oferta sigue abierta (se cotiza de nuevo)`);
  }
});

test("E/F/G · corte a mitad de materialización: la reversión descarta el intento (tombstone) y el reintento usa un número NUEVO; nada duplicado", async () => {
  let falla: string | null = "corte simulado";
  const { bd } = montar({ conServicio: true, op: { fallaPasajeros: () => falla } });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r1 = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r1.ok, false);
  const a1 = { ...bd.filas("p63_aceptacion")[0] };
  assert.equal(bd.filas("p63_aceptacion")[0]?.estado, "descartada", "el intento fallido quedó descartado");
  assert.equal(bd.filas("p63_oferta")[0]?.estado, "abierta", "la oferta no convertida vuelve a estar abierta");
  assert.equal(bd.filas("ventas").length, 0, "la cabecera se revirtió");
  assert.notEqual(bd.filas("cotizaciones")[0]?.estado, "convertida");

  falla = null;
  const r2 = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const aceptaciones = bd.filas("p63_aceptacion");
  assert.equal(aceptaciones.length, 2);
  assert.notEqual(aceptaciones[1]?.numero_contrato, a1.numero_contrato, "el número descartado no se reutiliza");
  assert.equal(bd.filas("ventas").length, 1);
  assert.equal(bd.filas("cuentas_por_pagar").filter((c) => c.tipo_proveedor === "aereo").length, 1, "una sola CxP aérea, sin duplicados");
  assert.equal(aceptaciones.filter((a) => a.estado === "completa").length, 1);
});

test("E/F/G · doble clic: dos conversiones simultáneas dejan UN contrato, UNA aceptación vigente y las obligaciones una sola vez", async () => {
  const { bd } = montar({ conServicio: true });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const [r1, r2] = await Promise.all([convertirEligiendoCobro(cot.id, PASAJEROS), convertirEligiendoCobro(cot.id, PASAJEROS)]);
  assert.equal(bd.filas("ventas").length, 1, "un solo contrato");
  assert.equal(bd.filas("p63_aceptacion").length, 1, "un solo intento (no se gastó otro número)");
  const aereas = bd.filas("cuentas_por_pagar").filter((c) => c.tipo_proveedor === "aereo");
  assert.equal(aereas.length, 1, "la CxP aérea no se duplicó");
  const numero = bd.filas("ventas")[0]?.numero_contrato;
  for (const r of [r1, r2]) {
    if (r.ok) assert.equal(r.numero, numero, "quien tiene éxito devuelve el MISMO número");
    else assert.match(r.error, /ya se est[aá] creando|ya fue convertida/i, "el otro recibe un mensaje de negocio, no un error técnico");
  }
  assert.ok(r1.ok || r2.ok, "al menos uno completó");
});

test("E/F/G · reintento sobre un intento 'materializando' (cabecera creada, proceso muerto): no hay takeover ni otro contrato", async () => {
  const { bd } = montar({ conServicio: true });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  // Se deja al intento a medias: aceptado, cabecera creada ("materializando") y sin finanzas.
  const oferta = bd.filas("p63_oferta")[0] as Fila;
  const { aceptarOferta63 } = await import("../lib/reservar/aceptacionServidor63.ts");
  const sb = (globalThis as unknown as { __arnesFechas: { sb: never } }).__arnesFechas.sb;
  const ac = await aceptarOferta63(sb, { cotizacionId: cot.id, tenant: "mayorista", usuarioId: "u-arnes", huella: String(oferta.huella), huellaFinanciera: String(oferta.huella_financiera), monedaCobro: MONEDA_OFERTA });
  assert.equal(ac.ok, true, JSON.stringify(ac));
  const a = bd.filas("p63_aceptacion")[0];
  a.estado = "materializando";
  bd.filas("ventas").push({ numero_contrato: a.numero_contrato, tenant: "mayorista", aceptacion_63_id: a.id, financiero_estado: "pendiente", estado: "pendiente" });
  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /ya se est[aá] creando/i);
  assert.match((r as { error: string }).error, new RegExp(String(a.numero_contrato)), "el mensaje nombra el contrato para que soporte lo ubique");
  assert.equal(bd.filas("p63_aceptacion").length, 1, "no se creó otro intento");
  assert.equal(bd.filas("ventas").length, 1, "no se creó otra cabecera");
});

test("E/F/G · convertir una oferta ya COMPLETA reconoce el contrato existente (idempotente); si el contrato se eliminó, pide cotización nueva", async () => {
  const { bd } = montar({ conServicio: true });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r1 = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r1.ok, true, JSON.stringify(r1));
  // Respuesta perdida: la cotización quedó abierta aunque el contrato ya existe y está completo.
  bd.filas("cotizaciones")[0].estado = "abierta";
  bd.filas("cotizaciones")[0].numero_contrato = null;
  const r2 = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r2.ok, true, JSON.stringify(r2));
  if (r1.ok && r2.ok) assert.equal(r2.numero, r1.numero, "mismo contrato, sin duplicarlo");
  assert.equal(bd.filas("ventas").length, 1);
  assert.equal(bd.filas("p63_aceptacion").length, 1);
  // Si el contrato se eliminó (superadmin), la oferta convertida es terminal: no se reabre ni se rehace.
  bd.tablas.set("ventas", []);
  bd.filas("cotizaciones")[0].estado = "abierta";
  const r3 = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r3.ok, false);
  assert.match((r3 as { error: string }).error, /ya fue convertida|cotizaci[oó]n nueva/i);
});

test("E/F/G · cotizar: si la configuración del paquete cambia ENTRE la lectura de T0 y el guardado, NO se crea una cotización rasgada", async () => {
  let subido = false;
  const { bd } = montar({
    conServicio: true,
    alConsultar: (tabla) => {
      // El servidor ya leyó T0; durante el cálculo alguien cambia una fuente del paquete (sube la revisión).
      if (tabla === "empaquetados" && !subido) { subido = true; bd.filas("armado_paquetes")[0].tarifario_revision_fuente = 6; }
    },
  });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(subido, true);
  assert.equal(cot.ok, false);
  assert.match((cot as { error: string }).error, /cambi[oó] mientras se cotizaba/i);
  assert.equal(bd.filas("cotizaciones").length, 0, "ni cotización");
  assert.equal(bd.filas("p63_oferta").length, 0, "ni oferta privada (misma transacción)");
});

test("E/F/G · un paquete de siempre NO usa la aceptación #63: sin RPC nuevas, sin marcador, con el consecutivo de siempre", async () => {
  const { bd } = montar({ bloqueo: true, cupos: 5 });
  const cot = await crearCotizacion(pedido({ bloqueoId: BLOQUEO_ID, salidaId: null, modulo: "bloqueo" }) as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r = await convertirCotizacion(cot.id, PASAJEROS as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  const fns = bd.llamadasRpc.map((c) => c.fn);
  assert.equal(fns.includes("crear_cotizacion_oferta_63") || fns.includes("aceptar_oferta_63"), false);
  assert.equal(bd.filas("p63_oferta").length + bd.filas("p63_aceptacion").length, 0);
  assert.equal(bd.filas("ventas")[0]?.aceptacion_63_id ?? null, null);
  assert.ok(bd.filas("cuentas_por_pagar").every((c) => c.aceptacion_63_id == null && c.obligacion_63 == null));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Ciclo 5 · el plan B2B (comisión y precio NETO) se congela en el snapshot y la cabecera se contrasta contra ese valor; las vigencias
// de compra de hotel y servicios viajan al snapshot y la RPC las valida con la fecha de negocio de Bogotá, SIN que se mueva ninguna revisión.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const ALIADO = 900;
const aliadoAgencia = (pct: number | null): Fila => ({ id: ALIADO, nombre: "Agencia Uno", nit: "901", tipo: "agencia", pct_comision: pct, aplica_retencion: false, pct_retencion: 0 });
const pedidoB2B = (over: Record<string, unknown> = {}) => pedido({ tipoAsesor: "agencia", agenciaNombre: "Agencia Uno", aliadoId: ALIADO, modoCompra: "neta", ...over });
// PVP 2 × 1.680.000 = 3.360.000 · BNC 2 × R = 2.260.000 → base 1.100.000.
const PVP_B2B = 3_360_000;
const BASE_B2B = 1_100_000;
const comisionDe = (pct: number) => Math.round(BASE_B2B * pct);

test("C5 · el plan B2B se congela en el snapshot al cotizar y la cabecera sale de ESE valor (neta: PVP − comisión)", async () => {
  const { bd } = montar({ aliados: [aliadoAgencia(0.1)] });
  const cot = await crearCotizacion(pedidoB2B() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const snap = bd.filas("p63_oferta")[0]?.snapshot as { b2b: Record<string, unknown> | null; cabecera: Record<string, unknown> };
  assert.deepEqual(snap.b2b, {
    aliado_id: ALIADO, tipo_asesor: "agencia", pct: 0.1, base: BASE_B2B, comision: comisionDe(0.1),
    modo_compra: "neta", comision_estado: "descontada", precio_final: PVP_B2B - comisionDe(0.1),
  });
  assert.deepEqual([snap.cabecera.tipo_asesor, snap.cabecera.canal], ["agencia", "B2B"]);
  assert.equal(snap.cabecera.precio_venta, PVP_B2B, "la cabecera del snapshot guarda el PVP; el precio final B2B vive en b2b.precio_final");

  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, true, JSON.stringify(r));
  const [venta] = bd.filas("ventas");
  assert.equal(venta?.precio_venta, PVP_B2B - comisionDe(0.1));
  assert.equal(venta?.comision_b2b, comisionDe(0.1));
  assert.equal(venta?.modo_compra, "neta");
  assert.equal(venta?.comision_estado, "descontada");
  assert.equal(venta?.aliado_id, ALIADO);
  assert.equal(venta?.canal, "B2B");
  assert.equal(bd.filas("aliados_b2b").length, 1, "la comisión B2B se registró una sola vez");
});

test("C5 · PVP IGUAL y % del aliado cambiado entre cotizar y convertir: se rechaza ANTES de reservar número (ni contrato, ni intento, ni consecutivo)", async () => {
  const { bd } = montar({ aliados: [aliadoAgencia(0.1)] });
  const cot = await crearCotizacion(pedidoB2B() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const paqueteAntes = JSON.stringify(bd.filas("armado_paquetes")[0]);
  const pvpAntes = (bd.filas("cotizaciones")[0] as Fila).precio_venta;
  bd.filas("aliados")[0].pct_comision = 0.12; // ningún precio, tarifa ni revisión cambió: solo el % del aliado
  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /cambi[oó] desde que se cotiz[oó]/i);
  assert.equal(bd.filas("ventas").length, 0, "no se creó contrato");
  assert.equal(bd.filas("p63_aceptacion").length, 0, "no se reservó número ni intento");
  assert.equal(consecutivo() ?? 450, 450, "no se gastó consecutivo");
  assert.equal(bd.filas("p63_oferta")[0]?.estado, "abierta");
  assert.equal((bd.filas("cotizaciones")[0] as Fila).precio_venta, pvpAntes, "el PVP de la cotización es el mismo: lo único distinto es la comisión");
  assert.equal(JSON.stringify(bd.filas("armado_paquetes")[0]), paqueteAntes, "ninguna revisión del paquete se movió");

  // Con una cotización NUEVA el cliente reconfirma y se cobra con el % nuevo.
  const cot2 = await crearCotizacion(pedidoB2B() as never);
  assert.equal(cot2.ok, true, JSON.stringify(cot2));
  if (!cot2.ok) return;
  const r2 = await convertirEligiendoCobro(cot2.id, PASAJEROS);
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(bd.filas("ventas")[0]?.comision_b2b, comisionDe(0.12));
  assert.equal(bd.filas("ventas")[0]?.precio_venta, PVP_B2B - comisionDe(0.12));
});

test("C5 · el % que sale del PARÁMETRO general (aliado sin % propio) también invalida la aceptación", async () => {
  const { bd } = montar({ aliados: [aliadoAgencia(null)], parametros: [{ parametro: "COMISION_AGENCIA", valor: 0.1 }] });
  const cot = await crearCotizacion(pedidoB2B() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  assert.equal((bd.filas("p63_oferta")[0]?.snapshot as { b2b: { pct: number } }).b2b.pct, 0.1);
  bd.filas("parametros_tributarios")[0].valor = 0.13;
  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /cambi[oó] desde que se cotiz[oó]/i);
  assert.equal(bd.filas("ventas").length + bd.filas("p63_aceptacion").length, 0);
});

test("C5 · un cambio del % POSTERIOR a la aceptación falla cerrado: la comisión de la base no cuadra con la cabecera y la reserva se revierte completa", async () => {
  const ref: { bd?: ReturnType<typeof montar>["bd"] } = {};
  const { bd } = montar({ aliados: [aliadoAgencia(0.1)], op: { alComision: () => { ref.bd!.filas("aliados")[0].pct_comision = 0.15; } } });
  ref.bd = bd;
  const cot = await crearCotizacion(pedidoB2B() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /comisión B2B de la reserva/i);
  assert.equal(bd.filas("ventas").length, 0, "no queda contrato a medias");
  assert.equal(bd.filas("aliados_b2b").length, 0);
  assert.equal(bd.filas("p63_aceptacion")[0]?.estado, "descartada");
  assert.equal(bd.filas("p63_oferta")[0]?.estado, "abierta", "la oferta se reabre: se vuelve a cotizar con el % vigente");
});

test("C5 · cambiar de aliado entre cotizar y convertir (mismo % y PVP) también se rechaza", async () => {
  const { bd } = montar({ aliados: [aliadoAgencia(0.1), { ...aliadoAgencia(0.1), id: 901, nombre: "Agencia Dos" }] });
  const cot = await crearCotizacion(pedidoB2B() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  ((bd.filas("cotizaciones")[0] as Fila).payload as Record<string, unknown>).aliadoId = 901;
  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, false);
  assert.equal(bd.filas("ventas").length + bd.filas("p63_aceptacion").length, 0);
});

test("C5 · una oferta interna (B2C) no lleva plan B2B: snapshot.b2b = null y la cabecera sigue siendo interna", async () => {
  const { bd } = montar();
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const snap = bd.filas("p63_oferta")[0]?.snapshot as { b2b: unknown; cabecera: Record<string, unknown> };
  assert.equal(snap.b2b, null);
  assert.deepEqual([snap.cabecera.tipo_asesor, snap.cabecera.canal], ["interno", "B2C"]);
  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("ventas")[0]?.comision_b2b ?? null, null);
  assert.equal(bd.filas("aliados_b2b").length, 0);
});

test("C5 · el snapshot trae la vigencia de compra de la tarifa de HOTEL que ganó (con sus límites)", async () => {
  const hoy = fechaBogota(0);
  const { bd } = montar({ temporadaHotel: { compra_inicio: fechaBogota(-10), compra_fin: hoy } });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  const snap = bd.filas("p63_oferta")[0]?.snapshot as { vigencias: Fila[] };
  assert.deepEqual(snap.vigencias, [{ origen: "hotel", ref: "Base", compra_inicio: fechaBogota(-10), compra_fin: hoy }]);
});

test("C5 · cruce de medianoche (HOTEL): la compra cierra hoy; la RPC ve mañana → se rechaza SIN que ninguna revisión se haya movido; el mismo día se acepta", async () => {
  const hoy = fechaBogota(0);
  let reloj = hoy;
  const { bd } = montar({ temporadaHotel: { compra_fin: hoy }, op: { hoyBogota: () => reloj } });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const paquete = JSON.stringify(bd.filas("armado_paquetes")[0]);
  const fuente = JSON.stringify(bd.filas("empaquetados")[0]);
  reloj = fechaBogota(1); // la RPC ya está en el día siguiente; el servidor TS calculó antes de la medianoche
  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /cambi[oó] desde que se cotiz[oó]/i);
  assert.equal(bd.filas("ventas").length + bd.filas("p63_aceptacion").length, 0, "ni contrato ni intento");
  assert.equal(consecutivo() ?? 450, 450, "no se gastó consecutivo");
  assert.equal(JSON.stringify(bd.filas("armado_paquetes")[0]), paquete, "NINGÚN UPDATE: las revisiones del paquete son las mismas");
  assert.equal(JSON.stringify(bd.filas("empaquetados")[0]), fuente);
  assert.equal(bd.filas("p63_oferta")[0]?.estado, "abierta");
  reloj = hoy; // el rechazo era del reloj, no de otro cambio
  const r2 = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r2.ok, true, JSON.stringify(r2));
});

test("C5 · una tarifa de hotel que AÚN NO abre su compra para el reloj de la RPC (apertura) también se rechaza", async () => {
  const hoy = fechaBogota(0);
  let reloj = fechaBogota(-1);
  const { bd } = montar({ temporadaHotel: { compra_inicio: hoy }, op: { hoyBogota: () => reloj } });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, false);
  assert.equal(bd.filas("p63_aceptacion").length, 0);
  reloj = hoy;
  const r2 = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r2.ok, true, JSON.stringify(r2));
});

test("C5 · cruce de medianoche (SERVICIO opcional): la temporada del servicio cierra su compra hoy → la RPC la rechaza al cruzar, sin UPDATE", async () => {
  const hoy = fechaBogota(0);
  let reloj = hoy;
  const { bd } = montar({ servicioOpcional: { compra_inicio: null, compra_fin: hoy }, op: { hoyBogota: () => reloj } });
  const cot = await crearCotizacion(pedido({ servicios: [901] }) as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const snap = bd.filas("p63_oferta")[0]?.snapshot as { vigencias: Fila[] };
  assert.ok(snap.vigencias.some((v) => v.origen === "servicio" && v.ref === "901|Alta" && v.compra_fin === hoy), JSON.stringify(snap.vigencias));
  const paquete = JSON.stringify(bd.filas("armado_paquetes")[0]);
  reloj = fechaBogota(1);
  const r = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /cambi[oó] desde que se cotiz[oó]/i);
  assert.equal(bd.filas("ventas").length + bd.filas("p63_aceptacion").length, 0);
  assert.equal(JSON.stringify(bd.filas("armado_paquetes")[0]), paquete, "ningún UPDATE");
  reloj = hoy;
  const r2 = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(r2.ok, true, JSON.stringify(r2));
});

test("C5 · lo ya ACEPTADO antes de vencer la compra se recupera después del cruce (mismo intento y número): la vigencia se valida al aceptar, no al recuperar", async () => {
  const hoy = fechaBogota(0);
  let reloj = hoy;
  const { bd } = montar({ temporadaHotel: { compra_fin: hoy }, op: { hoyBogota: () => reloj } });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const oferta = bd.filas("p63_oferta")[0] as Fila;
  const { aceptarOferta63 } = await import("../lib/reservar/aceptacionServidor63.ts");
  const sb = (globalThis as unknown as { __arnesFechas: { sb: never } }).__arnesFechas.sb;
  const args = { cotizacionId: cot.id, tenant: "mayorista", usuarioId: "u-arnes", huella: String(oferta.huella), huellaFinanciera: String(oferta.huella_financiera) };
  const ac = await aceptarOferta63(sb, { ...args, monedaCobro: MONEDA_OFERTA }); // intento NUEVO: lleva la elección expresa
  assert.equal(ac.ok, true, JSON.stringify(ac));
  const numero = bd.filas("p63_aceptacion")[0]?.numero_contrato;
  reloj = fechaBogota(1); // cruzó la medianoche
  const otra = await aceptarOferta63(sb, args); // reintento de un intento ya aceptado: sin elección, deliberadamente (la RPC devuelve lo congelado y no numera)
  assert.equal(otra.ok && otra.aceptacion.numero_contrato, numero, "el intento ya aceptado sigue siendo el mismo, con el mismo número");
  assert.equal(bd.filas("p63_aceptacion").length, 1);
});

test("235 · omitir la moneda de cobro se rechaza A PROPÓSITO antes de numerar (sin contrato, sin intento, sin consecutivo); cobrar en la otra moneda sin TRM de cobro también", async () => {
  const { bd } = montar({ conServicio: true });
  const cot = await crearCotizacion(pedido() as never);
  assert.equal(cot.ok, true, JSON.stringify(cot));
  if (!cot.ok) return;
  const intentos: Array<[string, Parameters<typeof convertirCotizacion>[5], Parameters<typeof convertirCotizacion>[6], RegExp]> = [
    ["sin elegir (undefined)", undefined, undefined, /Elige la moneda de cobro/],
    ["sin elegir (null)", null, null, /Elige la moneda de cobro/],
    ["sin elegir (vacía)", "", null, /Elige la moneda de cobro/],
    ["otra moneda sin TRM de cobro", "USD", null, /exige la TRM de cobro/],
  ];
  for (const [que, moneda, trm, patron] of intentos) {
    const r = await convertirCotizacion(cot.id, PASAJEROS as never, undefined, undefined, undefined, moneda, trm);
    assert.equal(r.ok, false, `${que}: debía rechazarse`);
    assert.match((r as { error: string }).error, patron, que);
    assert.equal(bd.filas("ventas").length + bd.filas("p63_aceptacion").length, 0, `${que}: ni contrato ni intento`);
    assert.equal(consecutivo() ?? 450, 450, `${que}: no se gastó consecutivo`);
    assert.equal(bd.filas("p63_oferta")[0]?.estado, "abierta", `${que}: la oferta sigue abierta`);
  }
  const ok = await convertirEligiendoCobro(cot.id, PASAJEROS);
  assert.equal(ok.ok, true, JSON.stringify(ok));
});
