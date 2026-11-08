/**
 * #85 — Vuelos del contrato en el portal B2B (lógica pura, sin acceso a datos).
 *
 * `contrato_vuelos` es la COPIA contractual y no se modifica. El «último horario registrado
 * en D'spacios» (bloqueos_vuelo / empaquetados) solo se compara con un tramo cuando la
 * correspondencia está acreditada POR TRAMO (`vincularTramo`); la referencia de la venta
 * (`bloqueo_ref_id`/`empaquetado_ref_id`) no basta: una venta puede traer vuelos manuales
 * o adicionales. No es estado de la aerolínea en tiempo real ni lleva fecha inferida.
 */
import { parseRuta } from "@/lib/iata";

export type Direccion = "ida" | "regreso" | "suelto";

/** Fila de `contrato_vuelos` (solo las columnas que el cargador pide). */
export type TramoFila = {
  id: number;
  numero_contrato: string;
  direccion: string | null;
  aerolinea: string | null;
  origen_codigo: string | null;
  destino_codigo: string | null;
  origen_ciudad: string | null;
  destino_ciudad: string | null;
  numero_vuelo: string | null;
  hora_salida: string | null;
  hora_llegada: string | null;
  fecha_salida: string | null;
  record: string | null; // solo para acreditar el vínculo; nunca sale en el DTO
  orden: number | null;
  // Formato anterior a la migración 135 (ida y regreso en una sola fila).
  vuelo_ida?: string | null;
  vuelo_regreso?: string | null;
  hora_salida_ida?: string | null;
  hora_llegada_ida?: string | null;
  hora_salida_reg?: string | null;
  hora_llegada_reg?: string | null;
  fecha_regreso?: string | null;
};

export type FuenteVuelo = {
  tipo: "bloqueo" | "empaquetado";
  id: number;
  record: string | null;
  ruta: string | null;
  vuelo_ida: string | null;
  fecha_ida: string | null;
  hora_salida_ida: string | null;
  hora_llegada_ida: string | null;
  vuelo_regreso: string | null;
  fecha_regreso: string | null;
  hora_salida_reg: string | null;
  hora_llegada_reg: string | null;
};

export type VentaRef = { numero_contrato: string; bloqueo_ref_id: number | null; empaquetado_ref_id: number | null };

export type Campo = "numeroVuelo" | "fecha" | "horaSalida" | "horaLlegada";
export const ETIQUETA_CAMPO: Record<Campo, string> = { numeroVuelo: "Vuelo", fecha: "Fecha", horaSalida: "Salida", horaLlegada: "Llegada" };

export type Datos = { numeroVuelo: string | null; fecha: string | null; horaSalida: string | null; horaLlegada: string | null };

/** DTO al navegador: sin record/PNR, ids internos, costos, notas ni datos personales. */
export type TramoPortal = {
  clave: string;
  direccion: Direccion;
  aerolinea: string | null;
  origen: string | null;
  destino: string | null;
  contratado: Datos;
  /** Campos que el contrato no trae (se muestran como «Sin dato»). */
  ausentes: Campo[];
  /** «no_comprobada»: la fuente no se pudo leer; NO equivale a «sin_vinculo» (ausencia confirmada). */
  vinculo: "acreditado" | "sin_vinculo" | "no_comprobada";
  motivoSinVinculo: string | null;
  /**
   * Solo con vínculo acreditado. «completa»: los 4 datos del sistema existen y coinciden; «parcial»: coinciden los que el
   * sistema tiene, pero faltan otros; «sin_datos»: el sistema no tiene ninguno; «diferente»: al menos uno no coincide.
   */
  comparacion: "completa" | "parcial" | "sin_datos" | "diferente" | null;
  /** Campos que el sistema SÍ tiene y se compararon. */
  comparados: Campo[];
  /** Campos que el sistema no tiene (no se pudo comparar). */
  sinDatoOperativo: Campo[];
  /** Valor registrado en D'spacios de los campos que DIFIEREN. */
  registrado: Partial<Record<Campo, string | null>>;
  diferencias: Campo[];
};

/** Fuentes cuya lectura falló (o cuya fila referenciada no apareció): sus tramos quedan «no comprobados». */
export type FalloFuentes = { bloqueo?: boolean; empaquetado?: boolean };

const limpia = (x: unknown): string | null => { const t = typeof x === "string" ? x.trim() : ""; return t ? t : null; };

/** HH:MM en 24 h cuando se puede leer (08:47:00, 8:47, 8:47 pm); si no, el texto tal cual. */
export function normalizarHora(h: string | null | undefined): string | null {
  const t = limpia(h);
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])\.?\s?m\.?$|^(\d{1,2}):(\d{2})(?::\d{2})?$/i.exec(t);
  if (!m) return t;
  let hh = Number(m[1] ?? m[4]);
  const mm = m[2] ?? m[5];
  const ap = m[3]?.toLowerCase();
  if (ap === "p" && hh < 12) hh += 12;
  if (ap === "a" && hh === 12) hh = 0;
  return `${String(hh).padStart(2, "0")}:${mm}`;
}
const normVuelo = (v: string | null | undefined) => limpia(v)?.replace(/\s+/g, "").toUpperCase() ?? null;
const normFecha = (f: string | null | undefined) => limpia(f)?.slice(0, 10) ?? null;
const normRecord = (r: string | null | undefined) => limpia(r)?.toUpperCase() ?? null;

/** Expande el formato anterior a la 135 (direccion null con columnas ida/regreso) en un tramo por sentido. */
export function expandirTramos(filas: TramoFila[]): TramoFila[] {
  const out: TramoFila[] = [];
  for (const f of filas) {
    const legacy = !f.direccion && (f.vuelo_ida || f.vuelo_regreso || f.hora_salida_ida || f.hora_salida_reg || f.fecha_regreso);
    if (!legacy) { out.push(f); continue; }
    out.push({ ...f, direccion: "ida", numero_vuelo: f.vuelo_ida ?? null, hora_salida: f.hora_salida_ida ?? null, hora_llegada: f.hora_llegada_ida ?? null });
    if (f.vuelo_regreso || f.hora_salida_reg || f.hora_llegada_reg || f.fecha_regreso) {
      out.push({
        ...f, direccion: "regreso", origen_codigo: f.destino_codigo, destino_codigo: f.origen_codigo, origen_ciudad: f.destino_ciudad, destino_ciudad: f.origen_ciudad,
        numero_vuelo: f.vuelo_regreso ?? null, hora_salida: f.hora_salida_reg ?? null, hora_llegada: f.hora_llegada_reg ?? null, fecha_salida: f.fecha_regreso ?? null,
      });
    }
  }
  return out;
}

type Vinculo = { fuente: FuenteVuelo } | { motivo: string };

/**
 * Acredita la fuente de UN tramo. Exige, a la vez: sentido ida/regreso · record del tramo igual al de la fuente ·
 * la venta apunta a esa fuente · mismos extremos de ruta (invertidos en el regreso) · un solo tramo con ese
 * record y sentido en el contrato (si hay dos, no se sabe cuál es el original). Cualquier duda → sin vínculo.
 */
export function vincularTramo(
  t: TramoFila, venta: VentaRef, fuentes: { bloqueo: FuenteVuelo | null; empaquetado: FuenteVuelo | null }, tramos: TramoFila[],
): Vinculo {
  if (t.direccion !== "ida" && t.direccion !== "regreso") return { motivo: "Es un tramo suelto: no corresponde a una salida de D'spacios." };
  const rec = normRecord(t.record);
  if (!rec) return { motivo: "El tramo no trae referencia de reserva para cotejarlo." };
  const f = (venta.bloqueo_ref_id != null ? fuentes.bloqueo : null) ?? (venta.empaquetado_ref_id != null ? fuentes.empaquetado : null);
  if (!f) return { motivo: "El contrato no tiene una salida de D'spacios asociada." };
  if (normRecord(f.record) !== rec) return { motivo: "La reserva del tramo no coincide con la de la salida asociada al contrato." };
  const r = parseRuta(f.ruta);
  const o = (t.origen_codigo ?? "").trim().toUpperCase();
  const d = (t.destino_codigo ?? "").trim().toUpperCase();
  const [eo, ed] = t.direccion === "ida" ? [r.origen, r.destino] : [r.destino, r.origen];
  if (!eo || !ed || o !== eo || d !== ed) return { motivo: "La ruta del tramo no coincide con la de la salida asociada." };
  const repetidos = tramos.filter((x) => x.direccion === t.direccion && normRecord(x.record) === rec).length;
  if (repetidos !== 1) return { motivo: "Hay más de un tramo con la misma reserva y sentido; no se puede identificar el original." };
  return { fuente: f };
}

function datosFuente(f: FuenteVuelo, dir: "ida" | "regreso"): Datos {
  return dir === "ida"
    ? { numeroVuelo: limpia(f.vuelo_ida), fecha: normFecha(f.fecha_ida), horaSalida: normalizarHora(f.hora_salida_ida), horaLlegada: normalizarHora(f.hora_llegada_ida) }
    : { numeroVuelo: limpia(f.vuelo_regreso), fecha: normFecha(f.fecha_regreso), horaSalida: normalizarHora(f.hora_salida_reg), horaLlegada: normalizarHora(f.hora_llegada_reg) };
}

const CAMPOS: Campo[] = ["numeroVuelo", "fecha", "horaSalida", "horaLlegada"];
const igual = (c: Campo, a: string | null, b: string | null) => (c === "numeroVuelo" ? normVuelo(a) === normVuelo(b) : a === b);

export function armarTramosPortal(
  filas: TramoFila[], venta: VentaRef, fuentes: { bloqueo: FuenteVuelo | null; empaquetado: FuenteVuelo | null }, fallo: FalloFuentes = {},
): TramoPortal[] {
  const tramos = expandirTramos(filas)
    .slice()
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.id - b.id);
  return tramos.map((t, i): TramoPortal => {
    const contratado: Datos = { numeroVuelo: limpia(t.numero_vuelo), fecha: normFecha(t.fecha_salida), horaSalida: normalizarHora(t.hora_salida), horaLlegada: normalizarHora(t.hora_llegada) };
    const ausentes = CAMPOS.filter((c) => contratado[c] == null);
    const direccion: Direccion = t.direccion === "ida" || t.direccion === "regreso" ? t.direccion : "suelto";
    const sinComp = { comparacion: null, comparados: [] as Campo[], sinDatoOperativo: [] as Campo[], registrado: {}, diferencias: [] as Campo[] };
    const depende = (direccion === "ida" || direccion === "regreso") && !!normRecord(t.record)
      && ((venta.bloqueo_ref_id != null && !!fallo.bloqueo) || (venta.empaquetado_ref_id != null && !!fallo.empaquetado));
    const v = vincularTramo(t, venta, fuentes, tramos);
    const base = {
      clave: `${t.id}-${i}`, direccion, aerolinea: limpia(t.aerolinea),
      origen: limpia(t.origen_ciudad) ?? limpia(t.origen_codigo), destino: limpia(t.destino_ciudad) ?? limpia(t.destino_codigo),
      contratado, ausentes,
    };
    if (depende && "motivo" in v) return { ...base, vinculo: "no_comprobada", motivoSinVinculo: null, ...sinComp };
    if ("motivo" in v) return { ...base, vinculo: "sin_vinculo", motivoSinVinculo: v.motivo, ...sinComp };
    const reg = datosFuente(v.fuente, direccion as "ida" | "regreso");
    const registrado: Partial<Record<Campo, string | null>> = {};
    const diferencias: Campo[] = [];
    // Si D'spacios no tiene el dato no hay con qué comparar: no cuenta como coincidencia ni como diferencia.
    const comparados = CAMPOS.filter((c) => reg[c] != null);
    for (const c of comparados) {
      if (!igual(c, contratado[c], reg[c])) { diferencias.push(c); registrado[c] = reg[c]; }
    }
    const comparacion = comparados.length === 0 ? "sin_datos" : diferencias.length ? "diferente" : comparados.length === CAMPOS.length ? "completa" : "parcial";
    return { ...base, vinculo: "acreditado", motivoSinVinculo: null, comparacion, comparados, sinDatoOperativo: CAMPOS.filter((c) => reg[c] == null), registrado, diferencias };
  });
}
