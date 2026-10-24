// ─────────────────────────────────────────────────────────────────────────
// #63 (E/F/G) — ACEPTACIÓN ATÓMICA de una oferta en COP con TRM: construcción del SNAPSHOT PRIVADO, huellas y mapeo de los
// errores de las RPC `crear_cotizacion_oferta_63` / `aceptar_oferta_63` (migración 227).
//
// Módulo PURO (sin I/O ni alias `@/`): lo usan `crearCotizacion` (arma el snapshot al cotizar), `reservarDesdeTarifarioInterno`
// (materializa SOLO desde lo que devolvió la aceptación) y las pruebas.
//
// Qué guarda el snapshot (todo lo que se ve o se debe, calculado UNA vez, por el servidor):
//   · cabecera de la venta (precio, BNC, costo aéreo, fechas, pax…) y cuántos hijos se esperan (tramos, ítems, hotel);
//   · el hotel, los tramos de vuelo y los ítems de valores tal como se escribirán en el contrato;
//   · el payload financiero: costos del contrato (COP) y obligaciones de origen (proveedor, retención, moneda, valor, equivalente
//     en COP congelado a la TRM, clave estable por componente);
//   · el resumen de tours/asistencia (display) y la TRM.
// Ninguna lectura viva posterior de costos/proveedores/retenciones cambia lo aceptado.
//
// La fecha de obligación NO va en el snapshot: la pone la base con la fecha de negocio (Bogotá) en que se aceptó.
// ─────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { ACOM_ROOM_LABEL, type AcomRoom } from "../acomodaciones.ts";
import { ciudadIata, parseRuta } from "../iata.ts";
import { descripcionLineaMenor, ordenLineaMenor, type LineaMenor } from "./menoresDeDos.ts";
import { redondearCentavos63 } from "./ofertaDinamica63.ts";

// ── Tipos ───────────────────────────────────────────────────────────────────

/** Revisiones de T0 (lectura ANTES de calcular): la base las compara de nuevo al guardar y al aceptar. */
export type Revisiones63 = {
  rev_fuente: number;
  rev_publicada: number | null;
  gen_publicada: number | null;
  rev_costos: number;
};

export type CostosSnapshot63 = {
  costo_hotel?: number;
  costo_aereo?: number;
  costo_receptivo?: number;
  costo_asistencia?: number;
  otros_costos?: number;
};

/** Obligación de origen del snapshot: lo que la RPC financiera escribe tal cual (sin `fecha_obligacion`: la pone la base). */
export type ObligacionSnapshot63 = {
  obligacion: string;
  proveedor: string | null;
  tipo_proveedor: string;
  servicio: string;
  valor_total: number;
  moneda: "COP" | "USD";
  valor_cop: number;
  /** NULL solo en una obligación COP de una oferta sin TRM (#93: ninguna fuente en USD). */
  trm: number | null;
  aplica_retencion: boolean;
  pct_retencion: number;
  observaciones: string;
  servicio_id: number | null;
};

export type CabeceraSnapshot63 = {
  tipo_paquete: string;
  moneda: string;
  fecha_salida: string | null;
  fecha_regreso: string | null;
  pax: number;
  destino: string | null;
  hotel: string | null;
  /** PVP aceptado (en compra NETA B2B la base resta la comisión; ver `trg_ventas_aceptacion_63_ins`). */
  precio_venta: number;
  impuesto: number;
  costo_aereo: number;
  aerolinea: string | null;
  plan_nombre: string;
  paquete_armado_id: number;
  n_tramos: number;
  n_items: number;
  n_hoteles: number;
  /** Tipo de venta y canal ACEPTADOS: la cabecera del contrato se contrasta contra ellos (ver `trg_ventas_aceptacion_63_ins`). */
  tipo_asesor: string;
  canal: string;
};

/**
 * Plan B2B ACEPTADO (comisión y precio NETO). Se congela al cotizar con el % que el aliado tenía entonces (o el parámetro general de su
 * tipo): la cabecera del contrato sale de AQUÍ y la base la contrasta contra este valor, no contra un recálculo con el % de hoy. Un
 * cambio posterior del % o del plan invalida la aceptación ANTES de reservar número (entra en la huella financiera y mueve el contador).
 */
export type PlanB2bSnapshot63 = {
  aliado_id: number;
  tipo_asesor: "agencia" | "freelance";
  pct: number;
  base: number;
  comision: number | null;
  modo_compra: "neta" | "comisionable" | null;
  comision_estado: "descontada" | "pendiente" | null;
  /** `ventas.precio_venta`: en compra NETA, PVP − comisión; si no, el PVP. */
  precio_final: number;
};

/**
 * Vigencia de COMPRA de una tarifa que respalda el precio (la temporada u hotel/servicio que ganó), tal como se leyó al cotizar. La
 * aceptación la valida con la fecha de negocio de Bogotá de SU transacción: así una tarifa que cierra (o aún no abre) entre la
 * cotización y la conversión se rechaza aunque ningún UPDATE haya movido una revisión (cruce de medianoche).
 */
export type VigenciaCompra63 = {
  origen: "hotel" | "servicio";
  ref: string;
  compra_inicio: string | null;
  compra_fin: string | null;
};

export type TramoSnapshot63 = {
  aerolinea: string | null;
  record: string | null;
  direccion: string;
  origen_codigo: string | null;
  origen_ciudad: string | null;
  destino_codigo: string | null;
  destino_ciudad: string | null;
  numero_vuelo: string | null;
  hora_salida: string | null;
  hora_llegada: string | null;
  fecha_salida: string | null;
  orden: number;
};

export type ItemSnapshot63 = {
  descripcion: string;
  adultos: number;
  ninos: number;
  tarifa_adulto: number;
  tarifa_nino: number;
  orden: number;
};

export type HotelSnapshot63 = {
  nombre: string;
  categoria: string;
  proveedor: string | null;
  ciudad: string | null;
  alimentacion: string;
  acomodacion: string;
  detalle_acomodacion: string;
  fecha_ingreso: string | null;
  fecha_salida: string | null;
  orden: number;
};

export type Snapshot63 = {
  v: 1;
  paquete_id: number;
  salida_id: number | null;
  empaquetado_id: number | null;
  /** TRM de la oferta; NULL si ninguna fuente del paquete está en USD (#93: "no requiere conversión"). Nunca 1. */
  trm: number | null;
  moneda: "COP";
  cabecera: CabeceraSnapshot63;
  hotel: HotelSnapshot63 | null;
  tramos: TramoSnapshot63[];
  items: ItemSnapshot63[];
  financiero: { costos: CostosSnapshot63; cxp: ObligacionSnapshot63[] };
  resumen: { tours_traslados: string | null; asistencia_medica: boolean };
  /** `null` en venta interna (B2C). */
  b2b: PlanB2bSnapshot63 | null;
  vigencias: VigenciaCompra63[];
};

// ── JSON canónico y huella financiera ───────────────────────────────────────

/** JSON con claves ordenadas y sin `undefined`: la misma estructura da siempre el mismo texto. */
export function jsonCanonico63(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x as Record<string, unknown>).sort()) {
        const val = (x as Record<string, unknown>)[k];
        if (val !== undefined) o[k] = norm(val);
      }
      return o;
    }
    return x;
  };
  return JSON.stringify(norm(v));
}

/**
 * Huella de los COSTOS, las OBLIGACIONES (proveedor, retención, moneda, valor y equivalente COP) y el PLAN B2B (aliado, %, modo de
 * compra, comisión y precio final) de una oferta. Se calcula al cotizar y se recalcula en vivo justo antes de aceptar: si algún
 * costo, proveedor, retención o el % del aliado cambió con el PVP igual, no coincide. Sin plan B2B (venta interna) la clave no entra
 * al texto canónico, así que la huella de una oferta interna es la de siempre.
 */
export function huellaFinanciera63(fin: { costos: CostosSnapshot63; cxp: readonly ObligacionSnapshot63[]; b2b?: PlanB2bSnapshot63 | null }): string {
  const { b2b, ...resto } = fin;
  return createHash("sha256").update(jsonCanonico63(b2b ? { ...resto, b2b } : resto)).digest("hex");
}

/** Plan B2B del snapshot a partir del plan puro de comisión (`planComisionReserva`): misma cifra que recalcula la base. */
export function construirPlanB2b63(a: {
  aliadoId: number;
  tipoAsesor: "agencia" | "freelance";
  plan: { pct: number; base: number; comision: number | null; modoCompra: "neta" | "comisionable" | null; comisionEstado: "descontada" | "pendiente" | null; precioFinal: number };
}): PlanB2bSnapshot63 {
  return {
    aliado_id: a.aliadoId, tipo_asesor: a.tipoAsesor, pct: a.plan.pct, base: a.plan.base, comision: a.plan.comision,
    modo_compra: a.plan.modoCompra, comision_estado: a.plan.comisionEstado, precio_final: a.plan.precioFinal,
  };
}

/** Vigencias de compra sin duplicados (mismo origen y referencia) y en orden estable: el snapshot no depende del orden de lectura. */
export function normalizarVigencias63(v: readonly VigenciaCompra63[]): VigenciaCompra63[] {
  const vistas = new Map<string, VigenciaCompra63>();
  for (const x of v) {
    const k = `${x.origen}|${x.ref}`;
    if (!vistas.has(k)) vistas.set(k, { origen: x.origen, ref: x.ref, compra_inicio: x.compra_inicio ?? null, compra_fin: x.compra_fin ?? null });
  }
  return [...vistas.values()].sort((a, b) => (a.origen + a.ref < b.origen + b.ref ? -1 : 1));
}

// ── Obligaciones ────────────────────────────────────────────────────────────

type CxPEntrada = {
  proveedor: string | null;
  tipo_proveedor: string;
  servicio: string;
  valor_total: number;
  aplica_retencion: boolean;
  pct_retencion: number;
  observaciones: string;
  servicio_id: number | null;
  moneda?: string;
  valor_cop?: number | null;
  trm?: number | null;
};

/**
 * Clave estable por componente: `<tipo>:s<servicio_id>` si es un servicio del catálogo; `<tipo>:<n>` (orden de aparición del
 * tipo) para hotel y aéreo. Dos obligaciones del MISMO proveedor con moneda distinta no se mezclan: son claves distintas.
 */
export function construirObligaciones63(cxp: readonly CxPEntrada[], trm: number | null): ObligacionSnapshot63[] {
  const contador = new Map<string, number>();
  const usadas = new Set<string>();
  return cxp.map((c) => {
    let clave: string;
    if (c.servicio_id != null) {
      clave = `${c.tipo_proveedor}:s${c.servicio_id}`;
    } else {
      const n = contador.get(c.tipo_proveedor) ?? 0;
      contador.set(c.tipo_proveedor, n + 1);
      clave = `${c.tipo_proveedor}:${n}`;
    }
    let unica = clave;
    for (let i = 1; usadas.has(unica); i++) unica = `${clave}#${i}`;
    usadas.add(unica);
    return {
      obligacion: unica,
      proveedor: c.proveedor ?? null,
      tipo_proveedor: c.tipo_proveedor,
      servicio: c.servicio,
      valor_total: c.valor_total,
      moneda: c.moneda === "USD" ? "USD" : "COP",
      valor_cop: redondearCentavos63(Number(c.valor_cop) || 0),
      trm: Number(c.trm) > 0 ? Number(c.trm) : trm,
      aplica_retencion: c.aplica_retencion === true,
      pct_retencion: Number(c.pct_retencion) || 0,
      observaciones: c.observaciones,
      servicio_id: c.servicio_id ?? null,
    };
  });
}

// ── Hijos del contrato (sin número: lo pone la aceptación) ──────────────────

type DatosVuelo63 = {
  aerolinea: string | null;
  record: string | null;
  ruta: string | null;
  fecha_ida: string | null;
  fecha_regreso: string | null;
  vuelo_ida: string | null;
  vuelo_regreso: string | null;
  hora_salida_ida: string | null;
  hora_llegada_ida: string | null;
  hora_salida_reg: string | null;
  hora_llegada_reg: string | null;
};

/** Tramos ida/regreso: la MISMA forma que escribe el contrato de siempre (1 fila por tramo). */
export function armarTramos63(d: DatosVuelo63 | null): TramoSnapshot63[] {
  if (!d) return [];
  const r = parseRuta(d.ruta);
  const tramos: TramoSnapshot63[] = [
    {
      aerolinea: d.aerolinea, record: d.record, direccion: "ida",
      origen_codigo: r.origen, origen_ciudad: ciudadIata(r.origen), destino_codigo: r.destino, destino_ciudad: ciudadIata(r.destino),
      numero_vuelo: d.vuelo_ida, hora_salida: d.hora_salida_ida, hora_llegada: d.hora_llegada_ida,
      fecha_salida: d.fecha_ida, orden: 0,
    },
  ];
  if (d.fecha_regreso || d.vuelo_regreso) {
    tramos.push({
      aerolinea: d.aerolinea, record: d.record, direccion: "regreso",
      origen_codigo: r.destino, origen_ciudad: ciudadIata(r.destino), destino_codigo: r.origen, destino_ciudad: ciudadIata(r.origen),
      numero_vuelo: d.vuelo_regreso, hora_salida: d.hora_salida_reg, hora_llegada: d.hora_llegada_reg,
      fecha_salida: d.fecha_regreso, orden: 1,
    });
  }
  return tramos;
}

/** Ítems de valores: una fila por tipo de habitación, por clase de menor (226), por servicio y la mascota. Misma forma de siempre. */
export function armarItems63(a: {
  categoria: string;
  regimen: string;
  lineasHab: readonly { acom: AcomRoom; habitaciones: number; pax: number; pvp: number }[];
  lineasMenores: readonly LineaMenor[];
  serviciosItems: readonly { nombre: string; precio: number }[];
  cargoMascota: { total: number; descripcion: string | null } | null;
}): ItemSnapshot63[] {
  const items: ItemSnapshot63[] = [];
  a.lineasHab.forEach((l, i) => {
    items.push({
      descripcion: `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax) · ${a.categoria} / ${a.regimen}`,
      adultos: l.pax, ninos: 0, tarifa_adulto: l.pvp, tarifa_nino: 0, orden: i,
    });
  });
  for (const lm of a.lineasMenores) {
    items.push({
      descripcion: descripcionLineaMenor(lm, a.categoria, a.regimen),
      adultos: 0, ninos: lm.cantidad, tarifa_adulto: 0, tarifa_nino: lm.tarifa, orden: ordenLineaMenor(lm),
    });
  }
  a.serviciosItems.forEach((s, i) => {
    items.push({ descripcion: `Servicio · ${s.nombre}`, adultos: 1, ninos: 0, tarifa_adulto: s.precio, tarifa_nino: 0, orden: 100 + i });
  });
  if (a.cargoMascota) {
    items.push({
      descripcion: a.cargoMascota.descripcion ? `Mascota · ${a.cargoMascota.descripcion}` : "Cargo de mascota",
      adultos: 0, ninos: 0, tarifa_adulto: a.cargoMascota.total, tarifa_nino: 0, orden: 201,
    });
  }
  return items;
}

/** Detalle legible de la acomodación del hotel: "1 hab Doble (2 pax), 1 Niño 1, 1 Infante(s)". */
export function detalleAcomodacion63(a: {
  lineasHab: readonly { acom: AcomRoom; habitaciones: number; pax: number }[];
  numNinos: number;
  numNinos2: number;
  infantes: number;
  mascotas: number;
}): string {
  const partes = a.lineasHab.map((l) => `${l.habitaciones} hab ${ACOM_ROOM_LABEL[l.acom]} (${l.pax} pax)`);
  if (a.numNinos > 0) partes.push(`${a.numNinos} Niño 1`);
  if (a.numNinos2 > 0) partes.push(`${a.numNinos2} Niño 2`);
  if (a.infantes > 0) partes.push(`${a.infantes} Infante(s)`);
  if (a.mascotas > 0) partes.push(`${a.mascotas} Mascota(s)`);
  return partes.join(", ");
}

// ── Snapshot ────────────────────────────────────────────────────────────────

export function construirSnapshot63(a: {
  paqueteId: number;
  salidaId: number | null;
  empaquetadoId: number | null;
  trm: number | null;
  cabecera: Omit<CabeceraSnapshot63, "n_tramos" | "n_items" | "n_hoteles">;
  b2b: PlanB2bSnapshot63 | null;
  vigencias: readonly VigenciaCompra63[];
  hotel: HotelSnapshot63 | null;
  tramos: TramoSnapshot63[];
  items: ItemSnapshot63[];
  costos: CostosSnapshot63;
  cxp: readonly CxPEntrada[];
  resumen: { tours_traslados: string | null; asistencia_medica: boolean };
}): Snapshot63 {
  return {
    v: 1,
    paquete_id: a.paqueteId,
    salida_id: a.salidaId,
    empaquetado_id: a.empaquetadoId,
    trm: a.trm,
    moneda: "COP",
    cabecera: { ...a.cabecera, n_tramos: a.tramos.length, n_items: a.items.length, n_hoteles: a.hotel ? 1 : 0 },
    hotel: a.hotel,
    tramos: a.tramos,
    items: a.items,
    financiero: { costos: a.costos, cxp: construirObligaciones63(a.cxp, a.trm) },
    resumen: a.resumen,
    b2b: a.b2b,
    vigencias: normalizarVigencias63(a.vigencias),
  };
}

// ── Respuesta de la RPC `aceptar_oferta_63` ─────────────────────────────────

export type AceptacionPreparada63 = {
  estado: "preparada";
  aceptacion_id: number;
  numero_contrato: string;
  fecha_negocio: string;
  snapshot: Snapshot63;
  /** Payload financiero DERIVADO por la base (costos + obligaciones con la fecha de negocio): lo único que se escribe. */
  financiero: { costos: CostosSnapshot63; cxp: (ObligacionSnapshot63 & { fecha_obligacion: string })[] };
};
export type AceptacionEnCurso63 = { estado: "materializando"; aceptacion_id: number; numero_contrato: string };
export type AceptacionCompleta63 = { estado: "completa"; aceptacion_id: number; numero_contrato: string };

export type ResultadoAceptacion63 =
  | { ok: true; aceptacion: AceptacionPreparada63 }
  | { ok: true; aceptacion: AceptacionEnCurso63 }
  | { ok: true; aceptacion: AceptacionCompleta63 }
  | { ok: false; error: string; cambio: boolean };

export const MENSAJE_CAMBIO_ACEPTACION_63 =
  "La oferta cambió desde que se cotizó (precio, vuelo, TRM, costos o proveedores). Genera una nueva cotización para reconfirmar el valor con el cliente.";
export const MENSAJE_OFERTA_CERRADA_63 =
  "Esta cotización ya fue convertida en contrato y esa oferta no se reabre. Genera una cotización nueva.";
export const MENSAJE_EN_CURSO_63 =
  "El contrato de esta cotización ya se está creando (o quedó a medias). No se crea otro: se completa solo en unos minutos; si no ocurre, contacta a soporte con el número.";
export const MENSAJE_TECNICO_63 = "No fue posible aceptar la oferta. Intenta nuevamente o contacta a soporte.";

/**
 * Traduce el error de Postgres de las RPC #63 a un mensaje de negocio. El detalle técnico NUNCA llega al navegador (se registra
 * aparte). Los que son una regla de elegibilidad de otra guarda (destino aéreo, etc.) conservan su mensaje de negocio.
 */
export function mapearErrorRpc63(message: string | null | undefined): { error: string; cambio: boolean } {
  const m = message ?? "";
  if (/p63_oferta_cambio/.test(m)) return { error: MENSAJE_CAMBIO_ACEPTACION_63, cambio: true };
  if (/p63_oferta_cerrada/.test(m)) return { error: MENSAJE_OFERTA_CERRADA_63, cambio: false };
  if (/p63_no_autorizado/.test(m)) return { error: "No tienes autorización para aceptar esta oferta.", cambio: false };
  if (/destino_aereo_no_permitido|destino_aereo/.test(m)) return { error: "El vuelo de esta oferta ya no llega a un destino permitido para el paquete. Genera una cotización nueva.", cambio: true };
  return { error: MENSAJE_TECNICO_63, cambio: false };
}

/** Lee la respuesta jsonb de la RPC sin confiar en su forma. */
export function leerAceptacion63(data: unknown): ResultadoAceptacion63 {
  const d = (data ?? {}) as Record<string, unknown>;
  const estado = d.estado;
  const id = Number(d.aceptacion_id);
  const numero = typeof d.numero_contrato === "string" ? d.numero_contrato : "";
  if (!Number.isFinite(id) || !numero) return { ok: false, error: MENSAJE_TECNICO_63, cambio: false };
  if (estado === "materializando") return { ok: true, aceptacion: { estado, aceptacion_id: id, numero_contrato: numero } };
  if (estado === "completa") return { ok: true, aceptacion: { estado, aceptacion_id: id, numero_contrato: numero } };
  if (estado !== "preparada") return { ok: false, error: MENSAJE_TECNICO_63, cambio: false };
  const snapshot = d.snapshot as Snapshot63 | undefined;
  const fin = d.financiero as AceptacionPreparada63["financiero"] | undefined;
  if (!snapshot || typeof snapshot !== "object" || !fin || !Array.isArray(fin.cxp) || typeof fin.costos !== "object" || fin.costos == null) {
    return { ok: false, error: MENSAJE_TECNICO_63, cambio: false };
  }
  return {
    ok: true,
    aceptacion: { estado: "preparada", aceptacion_id: id, numero_contrato: numero, fecha_negocio: String(d.fecha_negocio ?? ""), snapshot, financiero: fin },
  };
}
