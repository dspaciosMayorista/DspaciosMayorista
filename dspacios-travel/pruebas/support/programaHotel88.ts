// Semillas y ayudas COMPARTIDAS de las pruebas de reserva de un programa por hotel y vigencia (#88), sobre el arnés en memoria
// (pruebas/support/fechaNegocioArnes.ts). USD, mk 15 %, fee 3 %, asistencia 4 USD por persona y día, 4 días / 3 noches.
// Proveedores: 9 = el del programa, 55 = asistencia médica, 77 = hotel con proveedor propio.
import assert from "node:assert/strict";
import type { crearBD } from "./fechaNegocioArnes.ts";

export type Fila = Record<string, unknown>;
export type BD = ReturnType<typeof crearBD>;

export const programa = (over: Fila = {}): Fila => ({
  id: 3, nombre: "Caribe terrestre", subtitulo: "Cartagena", moneda: "USD", pct_mk: 0.15, pct_fee_tarjeta: 0.03,
  asistencia_medica_dia: 4, modo_precio: "hotel", dias: 4, noches: 3, proveedor_id: 9, proveedor_asistencia_id: 55,
  tipo_transporte: "ninguno", incluye_aereo: false,
  vigencia_desde: null, vigencia_hasta: null, edad_nino_min: 2, edad_nino_max: 11, edad_infante_max: 1,
  condicion_pago_tipo: "anticipo_saldo", condicion_pago_pct_inicial: 0.3, condicion_pago_dias_saldo: 30,
  restriccion_comercial: "normal",
  regla_comisionable: false, regla_comisionable_modalidad_mk: "historica", regla_comisionable_modo: "pct",
  regla_comisionable_valor: 0, regla_comisionable_pct_comision: 0, regla_comisionable_impuesto_por_acomodacion: false,
  proveedores: { nombre: "Operador Andes", aplica_retencion: false, pct_retencion: 0 },
  programa_destinos_fijos: null,
  ...over,
});
export const hotel = (over: Fila = {}): Fila => ({
  id: 1, programa_id: 3, orden: 0, nombre: "Hotel Centro", zona: "Centro", tipo_habitacion: "Estándar",
  max_pax_habitacion: 4, max_menores_habitacion: 2, proveedor_id: null, ...over,
});
export const base = (over: Fila = {}): Fila => ({
  id: 1, hotel_id: 1, desde: "2027-03-01", hasta: "2027-03-31", modalidad_servicios: "privado", bajo_solicitud: false,
  neto_sencilla: 800, neto_doble: 600, neto_triple: 520, neto_multiple: null, neto_nino: 400, ...over,
});
export const noche = (over: Fila = {}): Fila => ({
  id: 1, hotel_id: 1, desde: "2027-03-01", hasta: "2027-03-04", unidad_cobro: "persona",
  neto_sencilla: 130, neto_doble: 100, neto_triple: 90, neto_multiple: null, neto_nino: 60, ...over,
});
export const DIAS = [
  { programa_id: 3, dia: 1, titulo: "Llegada", desayuno: false, almuerzo: false, cena: true, descripcion: "Traslado al hotel" },
  { programa_id: 3, dia: 2, titulo: "Tour ciudad", desayuno: true, almuerzo: true, cena: false, descripcion: "Tour de ciudad" },
  { programa_id: 3, dia: 3, titulo: "Playa", desayuno: true, almuerzo: false, cena: false, descripcion: "Día de playa" },
  { programa_id: 3, dia: 4, titulo: "Salida", desayuno: true, almuerzo: false, cena: false, descripcion: "Traslado al aeropuerto" },
];
export const semilla = (over: Record<string, Fila[]> = {}) => ({
  programas: [programa()],
  programa_salidas: [], programa_categorias: [], programa_precios: [],
  programa_hoteles: [hotel()],
  programa_hotel_precios: [base(), base({ id: 2, modalidad_servicios: "regular", neto_doble: 450 })],
  programa_hotel_noches: [noche(), noche({ id: 2, desde: "2027-03-05", hasta: "2027-03-31", neto_sencilla: 150, neto_doble: 120, neto_triple: 100, neto_nino: 70 })],
  programa_dias: DIAS,
  proveedores: [
    { id: 77, nombre: "Hoteles Playa SAS", aplica_retencion: true, pct_retencion: 3.5 },
    { id: 55, nombre: "Asistencia Global", aplica_retencion: false, pct_retencion: 0 },
  ],
  ...over,
});
export const RPCS = { congelar_condiciones_contrato: () => "OK", crear_pasajeros_contrato: () => [] };

export type Estancia = { hotelId: number; modalidad: "privado" | "regular"; nochesAdicionales: number };
export const entrada = (est: Partial<Estancia> = {}, over: Fila = {}) => ({
  programaId: 3, categoriaId: 0, fechaIda: "2027-03-01", paxPorAcom: { doble: 1 }, ninos: 0,
  cliente: { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "1010", telefono: "300", email: "" },
  tipoAsesor: "interno" as const, asesorInterno: "Asesor", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
  plazo: "2027-02-01", pasajeros: [] as never[], precioConfirmado: 0, trmCosto: 4000 as number | string | null,
  estancia: { hotelId: 1, modalidad: "privado" as const, nochesAdicionales: 0, ...est },
  ...over,
});

/** Tablas que una reserva de este modo escribe (todas deben quedar VACÍAS si la reserva no se concreta). */
export const TABLAS_DE_ESCRITURA = [
  "ventas", "contrato_items", "contrato_hoteles", "contrato_pasajeros", "cuentas_por_pagar", "asientos_contables", "asiento_lineas",
  "aliados_b2b", "contrato_programa_estancia", "contrato_programa_estancia_costo", "contrato_financiero_pendiente",
];
export function afirmarSinEscrituras(bd: BD, tablas: readonly string[] = TABLAS_DE_ESCRITURA) {
  for (const t of tablas) assert.equal(bd.filas(t).length, 0, `no debe haber filas en ${t}`);
}

/**
 * Hace fallar la PRÓXIMA(S) `veces` operación(es) `op` sobre `tabla` (error de PostgREST), dejando intactas las demás.
 * Devuelve una función que cuenta cuántas veces se inyectó el fallo.
 */
export function inyectarFallo(bd: BD, tabla: string, op: "insert" | "upsert" | "update" | "delete", mensaje: string, veces = Number.POSITIVE_INFINITY) {
  const original = bd.sb.from.bind(bd.sb) as unknown as (t: string) => Record<string, (...a: unknown[]) => unknown>;
  let restantes = veces;
  let inyectados = 0;
  const error = { message: mensaje, code: "XX000" };
  const fallido: Record<string, unknown> = {};
  Object.assign(fallido, {
    select: () => fallido,
    eq: () => fallido,
    single: async () => ({ data: null, error }),
    maybeSingle: async () => ({ data: null, error }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: null, error }).then(res, rej),
  });
  (bd.sb as unknown as { from: unknown }).from = (t: string) => {
    const b = original(t);
    if (t !== tabla || restantes <= 0) return b;
    const metodo = b[op];
    b[op] = (...a: unknown[]) => {
      if (restantes <= 0) return metodo.apply(b, a);
      restantes--; inyectados++;
      return fallido;
    };
    return b;
  };
  return () => inyectados;
}
