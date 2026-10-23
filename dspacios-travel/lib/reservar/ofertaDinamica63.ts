// ─────────────────────────────────────────────────────────────────────────
// #63 — Salida de Dinámico vinculada a un vuelo de Empaquetados SIN record, y
// modo de oferta `cop_trm_63` (tarifario en COP con la TRM del paquete).
//
// Módulo PURO (sin I/O, sin alias `@/`): lo importan el generador de
// tarifario, el cómputo de la reserva, la reserva y las pruebas.
//
// Reglas del dueño (contrato #63 + respuestas R1/R2):
//   · Una "salida vinculada" es una fila de `salidas_dinamicas` con
//     `empaquetado_id`: toma de un Empaquetado SIN record (PNR ausente) las
//     fechas, la ruta y las tarifas. El origen de la reserva sigue siendo
//     `salidaId`; una vinculada se cotiza y se reserva SIN consultar cupos de
//     Bloqueo (un Empaquetado nunca tiene sillas).
//   · R = `tarifa_para_empaquetar` es el PRECIO FINAL del aéreo por pasajero con
//     silla: entra al PVP tal cual (SIN markup ni TA, que el CHECK de la base
//     prohíbe en una vinculada). N = `tarifa_proveedor` es solo COSTO (CxP).
//     F = `fee_infante`: precio = costo, una sola vez por menor de 2 años.
//   · Modo `cop_trm_63`: el tarifario se publica en COP. Todo NETO en USD
//     (hotel y servicios) se liquida en su moneda de origen con sus temporadas y
//     se CONVIERTE × TRM del paquete ANTES de aplicar el markup. La TRM es
//     positiva, persistida en el paquete y sin valor por defecto (nunca 1).
//   · R1: el fee de una salida MANUAL en USD se convierte con la misma TRM y
//     conserva los centavos (numeric(15,2)); nunca se redondea al peso/al mil.
//   · R2: los rótulos de menores son los de la 226 (`menoresDeDos.ts`), sin
//     variantes: este módulo NO escribe ningún rótulo.
// ─────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";

export const MODO_OFERTA_LEGACY = "legacy" as const;
export const MODO_OFERTA_63 = "cop_trm_63" as const;
export type ModoOferta = typeof MODO_OFERTA_LEGACY | typeof MODO_OFERTA_63;

/** Cualquier valor que no sea exactamente `cop_trm_63` es el comportamiento de siempre. */
export function normalizarModoOferta(v: unknown): ModoOferta {
  return v === MODO_OFERTA_63 ? MODO_OFERTA_63 : MODO_OFERTA_LEGACY;
}

export function esModo63(v: unknown): boolean {
  return v === MODO_OFERTA_63;
}

// ── TRM ─────────────────────────────────────────────────────────────────────

export type ResultadoTrm63 = { ok: true; trm: number } | { ok: false; error: string };

export const MENSAJE_TRM_63 =
  "El modo COP del paquete exige una TRM positiva (pesos por dólar). Configúrala en la configuración del paquete antes de generar el tarifario.";

/**
 * TRM del paquete. Estricta: número finito > 0. `null`, vacío, texto, booleano,
 * cero o negativo se rechazan — NUNCA se cae a 1 ni a una TRM "de referencia".
 */
export function validarTrm63(v: unknown): ResultadoTrm63 {
  if (typeof v === "boolean" || v == null) return { ok: false, error: MENSAJE_TRM_63 };
  if (typeof v === "string" && v.trim() === "") return { ok: false, error: MENSAJE_TRM_63 };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: MENSAJE_TRM_63 };
  return { ok: true, trm: n };
}

export function monedaNormalizada63(m: unknown): "COP" | "USD" {
  return typeof m === "string" && m.trim().toUpperCase() === "USD" ? "USD" : "COP";
}

/**
 * Convierte un monto NETO a COP: USD × TRM (sin redondear), COP tal cual. El
 * redondeo de venta lo hace el motor (`componerTarifa`/`precioMenorDeDos`) una
 * sola vez, DESPUÉS del markup.
 */
export function aCop63(monto: number, moneda: unknown, trm: number): number {
  const n = Number(monto);
  if (!Number.isFinite(n)) return 0;
  return monedaNormalizada63(moneda) === "USD" ? n * trm : n;
}

/** Redondeo a centavos (numeric(15,2)), sin el error de coma flotante de `x*100`. */
export function redondearCentavos63(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const signo = n < 0 ? -1 : 1;
  return (signo * Math.round(Math.abs(n) * 100 + 1e-9)) / 100;
}

/**
 * R1 — fee de infante en COP. Una fuente COP (Empaquetados) se queda exacto; una
 * salida manual USD se multiplica por la TRM del paquete y CONSERVA los
 * centavos (25 USD × 3.987,65 = 99.691,25). Nunca se redondea al peso ni al mil.
 */
export function feeACop63(fee: number, moneda: unknown, trm: number): number {
  const n = Number(fee);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return redondearCentavos63(aCop63(n, moneda, trm));
}

// ── Vuelo de la vinculada ───────────────────────────────────────────────────

/** R entra al PVP tal cual: el precio final del aéreo NO lleva markup ni TA. */
export function aporteVueloVinculada63(tarifaParaEmpaquetar: number): number {
  const r = Number(tarifaParaEmpaquetar);
  return Number.isFinite(r) && r > 0 ? r : 0;
}

/** El CHECK de la base: una vinculada no admite markup ni TA (sería doble margen). */
export function configAereaVinculadaValida63(c: { aplica_mk?: boolean | null; ta?: number | null }): boolean {
  return c.aplica_mk !== true && !(Number(c.ta) > 0);
}

export type ImpuestoTipo63 = "tiquete" | "fijo";

/**
 * Impuesto (BNC) POR PERSONA con silla de una vinculada:
 *   · tiquete → R (el precio del aéreo, tal cual se vende);
 *   · fijo    → el importe configurado en el paquete (ya en COP en modo 63).
 */
export function impuestoPorPersona63(args: { tipo: unknown; tarifaParaEmpaquetar: number; fijoCop: number }): number {
  if (args.tipo === "tiquete") return aporteVueloVinculada63(args.tarifaParaEmpaquetar);
  const f = Number(args.fijoCop);
  return Number.isFinite(f) && f > 0 ? f : 0;
}

/** BNC total de la reserva: el impuesto por persona × pasajeros con silla (menores de 2 años no generan BNC). */
export function impuestoTotal63(args: { impuestoPorPersona: number; paxConSilla: number }): number {
  const pax = Math.max(0, Math.trunc(Number(args.paxConSilla) || 0));
  return Math.max(0, Number(args.impuestoPorPersona) || 0) * pax;
}

// ── Elegibilidad de la fuente (Empaquetado sin record) ──────────────────────

export type FuenteEmpaquetado63 = {
  id?: number | null;
  activo?: boolean | null;
  record?: string | null;
  compra_inicio?: string | null;
  compra_fin?: string | null;
  fecha_ida?: string | null;
  fecha_regreso?: string | null;
  ruta?: string | null;
  aerolinea?: string | null;
  hora_salida_ida?: string | null;
  hora_llegada_ida?: string | null;
  hora_salida_reg?: string | null;
  hora_llegada_reg?: string | null;
  destino_id?: number | null;
  moneda?: string | null;
  tarifa_proveedor?: number | string | null;
  tarifa_para_empaquetar?: number | string | null;
  fee_infante?: number | string | null;
};

export type MotivoFuente63 =
  | "no_existe"
  | "inactiva"
  | "con_record"
  | "sin_fechas"
  | "compra_no_iniciada"
  | "compra_vencida"
  | "viaje_pasado"
  | "moneda_no_soportada"
  | "sin_tarifa"
  | "error_lectura";

export type EvaluacionFuente63 = { ok: true } | { ok: false; motivo: MotivoFuente63; error: string };

const MENSAJES_FUENTE: Record<MotivoFuente63, string> = {
  no_existe: "El vuelo de Empaquetados vinculado a esta salida ya no existe.",
  inactiva: "El vuelo de Empaquetados vinculado a esta salida fue desactivado.",
  con_record:
    "El vuelo de Empaquetados vinculado a esta salida ya tiene record (PNR): ya no es una salida de sistema sin record. Revisa la salida en el paquete.",
  sin_fechas: "El vuelo de Empaquetados vinculado a esta salida no tiene fechas de ida y regreso.",
  compra_no_iniciada: "El vuelo de Empaquetados vinculado a esta salida aún no está habilitado para compra.",
  compra_vencida: "El vuelo de Empaquetados vinculado a esta salida está fuera de su vigencia de compra.",
  viaje_pasado: "La fecha del vuelo de Empaquetados vinculado a esta salida ya pasó.",
  moneda_no_soportada: "El vuelo de Empaquetados vinculado a esta salida no está en COP; esa moneda todavía no está habilitada.",
  sin_tarifa: "El vuelo de Empaquetados vinculado a esta salida no tiene una tarifa para empaquetar válida.",
  error_lectura: "No se pudo validar el vuelo de Empaquetados vinculado a esta salida. Intenta nuevamente.",
};

export function mensajeFuente63(m: MotivoFuente63): string {
  return MENSAJES_FUENTE[m];
}

function rechazoFuente(motivo: MotivoFuente63): EvaluacionFuente63 {
  return { ok: false, motivo, error: MENSAJES_FUENTE[motivo] };
}

/** PNR ausente = NULL o vacío tras recortar espacios. Un texto cualquiera (incluso "PROMOCION") ES un record. */
export function recordAusente63(record: unknown): boolean {
  return record == null || (typeof record === "string" && record.trim() === "");
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ¿Sigue siendo elegible este Empaquetado como fuente de una salida vinculada?
 * `hoy` = fecha ISO en America/Bogotá. La comparación de strings ISO es
 * cronológica y los límites de compra son inclusivos (igual que
 * `empaquetadoVigente`). `null` = fila inexistente o invisible.
 */
export function evaluarFuenteVinculada63(f: FuenteEmpaquetado63 | null | undefined, hoy: string): EvaluacionFuente63 {
  if (!f) return rechazoFuente("no_existe");
  if (f.activo !== true) return rechazoFuente("inactiva");
  if (!recordAusente63(f.record)) return rechazoFuente("con_record");
  if (typeof f.fecha_ida !== "string" || !FECHA_ISO.test(f.fecha_ida) || typeof f.fecha_regreso !== "string" || !FECHA_ISO.test(f.fecha_regreso)) {
    return rechazoFuente("sin_fechas");
  }
  if (f.compra_inicio && hoy < f.compra_inicio) return rechazoFuente("compra_no_iniciada");
  if (f.compra_fin && hoy > f.compra_fin) return rechazoFuente("compra_vencida");
  if (f.fecha_ida < hoy) return rechazoFuente("viaje_pasado");
  if (f.moneda != null && monedaNormalizada63(f.moneda) !== "COP") return rechazoFuente("moneda_no_soportada");
  const r = Number(f.tarifa_para_empaquetar);
  if (!Number.isFinite(r) || r <= 0) return rechazoFuente("sin_tarifa");
  return { ok: true };
}

// ── Coherencia entre la salida (copia) y su fuente viva ─────────────────────

export type SalidaVinculada63 = {
  id?: number | null;
  empaquetado_id?: number | null;
  fecha_ida?: string | null;
  fecha_regreso?: string | null;
  ruta?: string | null;
  aerolinea?: string | null;
  valor_tiquete?: number | string | null;
  fee_infante?: number | string | null;
  aplica_mk?: boolean | null;
  ta?: number | string | null;
};

const num2 = (v: unknown) => redondearCentavos63(Number(v) || 0);
const txt = (v: unknown) => (v == null ? "" : String(v).trim());

/**
 * La salida guarda una COPIA de lo que tomó de la fuente (fechas, ruta,
 * aerolínea, R como `valor_tiquete`, F como `fee_infante`). Si la fuente cambió
 * después, la copia quedó vieja: el tarifario publicado y cualquier cotización
 * ya no reflejan el vuelo real, así que se exige actualizar la salida y
 * regenerar — nunca se cobra con una copia vieja ni se cambia la fuente en silencio.
 */
export function fuenteCoincideConSalida63(
  salida: SalidaVinculada63,
  fuente: FuenteEmpaquetado63
): { ok: true } | { ok: false; campos: string[] } {
  const campos: string[] = [];
  if (txt(salida.fecha_ida) !== txt(fuente.fecha_ida)) campos.push("fecha de ida");
  if (txt(salida.fecha_regreso) !== txt(fuente.fecha_regreso)) campos.push("fecha de regreso");
  if (txt(salida.ruta) !== txt(fuente.ruta)) campos.push("ruta");
  if (txt(salida.aerolinea) !== txt(fuente.aerolinea)) campos.push("aerolínea");
  if (num2(salida.valor_tiquete) !== num2(fuente.tarifa_para_empaquetar)) campos.push("tarifa para empaquetar");
  if (num2(salida.fee_infante) !== num2(fuente.fee_infante)) campos.push("fee de infante");
  return campos.length ? { ok: false, campos } : { ok: true };
}

export function mensajeFuenteCambio63(campos: string[]): string {
  return `El vuelo de Empaquetados vinculado a esta salida cambió (${campos.join(", ")}). Actualiza la salida desde su fuente y regenera el tarifario del paquete antes de cotizar o reservar.`;
}

/** Datos de la salida que se copian de la fuente al vincular/actualizar (única definición). */
export function copiarDeFuente63(f: FuenteEmpaquetado63) {
  return {
    aerolinea: f.aerolinea ?? null,
    ruta: f.ruta ?? null,
    // Los llamadores validan antes la elegibilidad (`evaluarFuenteVinculada63` exige ambas fechas).
    fecha_ida: f.fecha_ida as string,
    fecha_regreso: f.fecha_regreso ?? null,
    hora_salida_ida: f.hora_salida_ida ?? null,
    hora_llegada_ida: f.hora_llegada_ida ?? null,
    hora_salida_reg: f.hora_salida_reg ?? null,
    hora_llegada_reg: f.hora_llegada_reg ?? null,
    compra_inicio: f.compra_inicio ?? null,
    compra_fin: f.compra_fin ?? null,
    moneda: "COP" as const,
    valor_tiquete: num2(f.tarifa_para_empaquetar),
    fee_infante: num2(f.fee_infante),
    aplica_mk: false,
    ta: 0,
  };
}

// ── Huella de la oferta (cotización → aceptación) ───────────────────────────

export type EntradaHuella63 = {
  paqueteId: number;
  salidaId: number | null;
  modo: ModoOferta;
  trm: number | null;
  /** Generación y revisión de fuente del tarifario publicado (181). */
  generacion: number | null;
  revisionFuente: number | null;
  precioVenta: number;
  moneda: string;
  /** Precio final del aéreo (R) y fee (F) de la fuente; NO se incluye el costo N. */
  tarifaParaEmpaquetar: number | null;
  feeInfante: number | null;
  fechaIda: string | null;
  fechaRegreso: string | null;
};

/**
 * Huella determinista de lo que el cliente vio al cotizar. Se guarda en la
 * cotización y se recalcula al convertirla: si no coincide, el precio o la
 * fuente cambiaron entre las dos pantallas y hay que RECOTIZAR (nunca se cobra
 * en silencio un importe distinto del mostrado). No contiene el costo N.
 */
export function huellaOferta63(e: EntradaHuella63): string {
  const canon = JSON.stringify([
    e.paqueteId, e.salidaId, e.modo, e.trm, e.generacion, e.revisionFuente,
    redondearCentavos63(e.precioVenta), e.moneda,
    e.tarifaParaEmpaquetar == null ? null : redondearCentavos63(e.tarifaParaEmpaquetar),
    e.feeInfante == null ? null : redondearCentavos63(e.feeInfante),
    e.fechaIda, e.fechaRegreso,
  ]);
  return createHash("sha256").update(canon).digest("hex");
}

export const MENSAJE_OFERTA_CAMBIO_63 =
  "La oferta cambió desde que se cotizó (precio, vuelo o TRM). Genera una nueva cotización para reconfirmar el valor con el cliente.";

/** Descripción corta, solo para mensajes (sin costos). */
export function etiquetaSalidaVinculada63(s: { ruta?: string | null; fecha_ida?: string | null }): string {
  const fecha = s.fecha_ida ? s.fecha_ida.split("-").reverse().join("/") : "";
  return `${s.ruta || "Salida"}${fecha ? ` · ${fecha}` : ""}`.trim();
}
