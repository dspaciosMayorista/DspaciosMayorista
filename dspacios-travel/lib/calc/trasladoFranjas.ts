// ─────────────────────────────────────────────────────────────────────────
// Suplementos de traslado por FRANJA HORARIA — módulo PURO (sin Supabase).
//
// Una franja vive dentro de la vigencia (temporada) de un servicio y suma un suplemento al COSTO NETO del traslado; el margen del paquete se aplica
// DESPUÉS, igual que al resto del neto (ver `liquidacionServicio.ts` y `costosObligacionesCarrito.ts`, que usan ESTA función).
//
// Reglas (decididas, no inferidas):
//  - La franja es [desde, hasta): `desde` INCLUYE la hora y `hasta` NO. Así 19:00–23:00 y 23:00–06:00 son contiguas y no se solapan.
//  - Si desde > hasta cruza medianoche (19:00–06:00 = [19:00, 24:00) ∪ [00:00, 06:00)). desde == hasta es ambiguo (¿vacía o 24 h?) y se rechaza;
//    para todo el día usar 00:00–24:00 (`24:00` solo vale como hora final).
//  - `llegada` usa la hora local de LLEGADA del vuelo de ida; `salida` la hora local de SALIDA del vuelo de regreso. `ambos` es una sola regla que se
//    evalúa por separado en cada tramo: cada tramo que cumpla genera UN cargo (nunca dos por el mismo tramo).
//  - Dos franjas del mismo tramo con horas que se intersectan son un solape ambiguo y no se pueden guardar; si aun así llegan dos al evaluar, la
//    evaluación FALLA CERRADO (no elige una ni suma las dos).
//  - Sin hora conocida para un tramo con franja configurada no se cotiza el suplemento: la evaluación devuelve `pendientes` y el llamador decide
//    (pedir la hora). Un tramo sin franjas configuradas no necesita hora.
//  - (262) Una franja puede limitarse a un RANGO DE PASAJEROS (pax_desde–pax_hasta; ausente = todos). El mismo horario puede tener varios importes
//    según el grupo (45.000 para 1–4, 80.000 para 5–12…). Solo choca con otra franja si comparten tramo, hora Y algún número de pasajeros. Si la hora cae
//    en una franja pero NINGUNA cubre el número de pasajeros, falta una regla: la evaluación FALLA (`sin_regla_pax`) — nunca se inventa un importe ni se
//    cobra cero.
//  - (262) El suplemento se aplica SOLO a los tramos vendidos (`tramos`): un traslado de llegada no paga el suplemento de salida ni necesita su hora.
//  - monto = importe fijo (neto); porcentaje = % del neto base del servicio (precio de tarifa × factor de liquidación, sin recargo individual).
//    cobro `grupo` = una vez por tramo; `persona` = por pasajero (monto × pax). Con porcentaje ambos coinciden en el total (el % ya es del neto de todo
//    el grupo); se conserva la opción porque el dato describe cómo lo cobra el proveedor.
//
// Import relativo (no `@/…`): se importa directo desde `node --test`.
// ─────────────────────────────────────────────────────────────────────────

export type TramoTraslado = "llegada" | "salida";
export type TramoFranja = TramoTraslado | "ambos";
export type TipoSuplemento = "monto" | "porcentaje";
export type CobroSuplemento = "grupo" | "persona";

export type FranjaSuplemento = {
  id?: number;
  hora_desde: string;
  hora_hasta: string;
  tramo: TramoFranja;
  tipo: TipoSuplemento;
  valor: number;
  cobro: CobroSuplemento;
  /** Rango de pasajeros al que aplica (inclusive). Ausente/null en ambos = todos. */
  pax_desde?: number | null;
  pax_hasta?: number | null;
};

const paxIni = (f: Pick<FranjaSuplemento, "pax_desde">) => f.pax_desde ?? 1;
const paxFin = (f: Pick<FranjaSuplemento, "pax_hasta">) => f.pax_hasta ?? Number.MAX_SAFE_INTEGER;
/** ¿La franja aplica a este número de pasajeros? */
export const franjaAplicaAPax = (f: Pick<FranjaSuplemento, "pax_desde" | "pax_hasta">, pax: number): boolean => pax >= paxIni(f) && pax <= paxFin(f);
const paxSeCruzan = (a: FranjaSuplemento, b: FranjaSuplemento): boolean => paxIni(a) <= paxFin(b) && paxIni(b) <= paxFin(a);

export const MIN_DIA = 1440;

/** "HH:MM", "H:MM", "HH:MM:SS" y "h:mm am/pm" → minutos desde 00:00. `24:00` solo si `permitir24`. Cualquier otra cosa → null. */
export function parseHora(texto: unknown, permitir24 = false): number | null {
  if (typeof texto !== "string") return null;
  const m = texto.trim().toLowerCase().match(/^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*([ap])\.?m\.?)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === "p" ? 12 : 0);
  }
  if (h === 24 && min === 0 && permitir24 && !m[3]) return MIN_DIA;
  if (h > 23) return null;
  return h * 60 + min;
}

export function formatearHora(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Intervalos [a,b) dentro del día que cubre la franja; `null` si las horas no son válidas o desde == hasta. */
export function segmentosFranja(f: Pick<FranjaSuplemento, "hora_desde" | "hora_hasta">): [number, number][] | null {
  const d = parseHora(f.hora_desde);
  const h = parseHora(f.hora_hasta, true);
  if (d == null || h == null || d === h) return null;
  if (d < h) return [[d, h]];
  return h === 0 ? [[d, MIN_DIA]] : [[d, MIN_DIA], [0, h]];
}

/** ¿La hora (minutos) cae dentro de la franja? Límites: inicio incluido, fin excluido. */
export function horaEnFranja(minutos: number, f: Pick<FranjaSuplemento, "hora_desde" | "hora_hasta">): boolean {
  const segs = segmentosFranja(f);
  return !!segs && segs.some(([a, b]) => minutos >= a && minutos < b);
}

function tramosDe(f: Pick<FranjaSuplemento, "tramo">): TramoTraslado[] {
  return f.tramo === "ambos" ? ["llegada", "salida"] : [f.tramo];
}

function seIntersectan(a: [number, number][], b: [number, number][]): boolean {
  return a.some(([a0, a1]) => b.some(([b0, b1]) => a0 < b1 && b0 < a1));
}

const ROTULO_TRAMO: Record<TramoFranja, string> = { llegada: "llegada", salida: "salida", ambos: "llegada y salida" };

/** Texto legible de la regla: horario, tramo y cargo. Es el que ve quien edita la tarifa. */
export function describirFranja(f: FranjaSuplemento, moneda = "COP"): string {
  const segs = segmentosFranja(f);
  const d = parseHora(f.hora_desde);
  const h = parseHora(f.hora_hasta, true);
  const horario = segs && d != null && h != null
    ? `desde las ${formatearHora(d)} hasta antes de las ${formatearHora(h)}${d > h ? " (cruza la medianoche)" : ""}`
    : "con un horario no válido";
  const cargo = f.tipo === "porcentaje"
    ? `${f.valor}% del neto base`
    : `${moneda === "USD" ? "USD " : "$"}${Number(f.valor).toLocaleString("es-CO")} neto`;
  const por = f.tipo === "porcentaje" ? "" : f.cobro === "persona" ? " por persona" : " por grupo";
  const pax = f.pax_desde == null && f.pax_hasta == null ? "" : ` (grupos de ${f.pax_desde}–${f.pax_hasta} pasajeros)`;
  return `Traslado de ${ROTULO_TRAMO[f.tramo]} ${horario}${pax}: se suma ${cargo}${por} a cada tramo que cumpla.`;
}

/** Errores de configuración (vacío = válida). Revisa cada franja y los solapes entre las del mismo servicio/vigencia. */
export function validarFranjas(franjas: FranjaSuplemento[]): string[] {
  const errores: string[] = [];
  franjas.forEach((f, i) => {
    const n = `Franja ${i + 1}`;
    const d = parseHora(f.hora_desde);
    const h = parseHora(f.hora_hasta, true);
    if (d == null) errores.push(`${n}: la hora inicial «${f.hora_desde}» no es válida (usa HH:MM).`);
    if (h == null) errores.push(`${n}: la hora final «${f.hora_hasta}» no es válida (usa HH:MM; 24:00 solo como hora final).`);
    if (d != null && h != null && d === h) errores.push(`${n}: la hora inicial y la final no pueden ser iguales (para todo el día usa 00:00 a 24:00).`);
    if (f.tramo !== "llegada" && f.tramo !== "salida" && f.tramo !== "ambos") errores.push(`${n}: el tramo debe ser llegada, salida o ambos.`);
    if (f.tipo !== "monto" && f.tipo !== "porcentaje") errores.push(`${n}: el tipo debe ser monto o porcentaje.`);
    if (f.cobro !== "grupo" && f.cobro !== "persona") errores.push(`${n}: el cobro debe ser por grupo o por persona.`);
    if (typeof f.valor !== "number" || !Number.isFinite(f.valor) || f.valor <= 0) errores.push(`${n}: el valor debe ser un número mayor que cero.`);
    const sinDesde = f.pax_desde == null, sinHasta = f.pax_hasta == null;
    if (sinDesde !== sinHasta) errores.push(`${n}: el rango de pasajeros necesita «desde» y «hasta» (o ninguno para todos los grupos).`);
    else if (!sinDesde && (!Number.isInteger(f.pax_desde) || !Number.isInteger(f.pax_hasta) || (f.pax_desde as number) < 1 || (f.pax_hasta as number) < (f.pax_desde as number))) {
      errores.push(`${n}: el rango de pasajeros ${f.pax_desde}–${f.pax_hasta} no es válido (enteros desde 1, «hasta» no menor que «desde»).`);
    }
  });
  for (let i = 0; i < franjas.length; i++) {
    for (let j = i + 1; j < franjas.length; j++) {
      const a = franjas[i], b = franjas[j];
      const sa = segmentosFranja(a), sb = segmentosFranja(b);
      if (!sa || !sb) continue;
      const comparten = tramosDe(a).some((t) => tramosDe(b).includes(t));
      if (comparten && seIntersectan(sa, sb) && paxSeCruzan(a, b)) errores.push(`Franjas ${i + 1} y ${j + 1}: se solapan en el mismo tramo (ambiguo). Ajusta los horarios o los rangos de pasajeros para que no se crucen.`);
    }
  }
  return errores;
}

export type HorasTramos = { llegada?: string | null; salida?: string | null };

export type SuplementoAplicado = {
  tramo: TramoTraslado;
  franjaId: number | null;
  hora: string;
  /** Importe NETO (antes del margen) de este cargo. */
  neto: number;
  descripcion: string;
};

export type EvaluacionSuplementos =
  | { ok: true; suplementos: SuplementoAplicado[]; netoTotal: number; pendientes: TramoTraslado[] }
  | { ok: false; motivo: "solape" | "franja_invalida" | "sin_regla_pax"; detalle: string };

/**
 * Suplementos NETOS que corresponden a las horas dadas. `horas.X` ausente/ilegible con una franja configurada para el tramo X → ese tramo queda en
 * `pendientes` y NO suma nada (el llamador debe pedir la hora antes de dar un precio final). `netoBase` es el neto de la tarifa del servicio para todo
 * el grupo (ver cabecera). Una franja inválida o dos que cubren la misma hora del mismo tramo hacen fallar la evaluación.
 */
export function evaluarSuplementos(franjas: FranjaSuplemento[], horas: HorasTramos, netoBase: number, pax: number, tramos: readonly TramoTraslado[] = ["llegada", "salida"]): EvaluacionSuplementos {
  const err = validarFranjas(franjas);
  if (err.length) return { ok: false, motivo: err.some((e) => e.includes("solapan")) ? "solape" : "franja_invalida", detalle: err[0] };
  const suplementos: SuplementoAplicado[] = [];
  const pendientes: TramoTraslado[] = [];
  for (const tramo of ["llegada", "salida"] as TramoTraslado[]) {
    if (!tramos.includes(tramo)) continue; // el suplemento solo corresponde a los tramos vendidos
    const delTramo = franjas.filter((f) => tramosDe(f).includes(tramo));
    if (!delTramo.length) continue;
    const min = parseHora(horas[tramo]);
    if (min == null) { pendientes.push(tramo); continue; }
    const enHora = delTramo.filter((f) => horaEnFranja(min, f));
    const aplican = enHora.filter((f) => franjaAplicaAPax(f, pax));
    if (enHora.length && !aplican.length) {
      return { ok: false, motivo: "sin_regla_pax", detalle: `El horario de ${tramo} (${formatearHora(min)}) tiene suplemento, pero ninguna regla cubre ${pax} pasajero${pax === 1 ? "" : "s"}: falta cargar ese rango.` };
    }
    if (aplican.length > 1) return { ok: false, motivo: "solape", detalle: `Dos franjas cubren la misma hora del tramo de ${tramo}.` };
    const f = aplican[0];
    if (!f) continue;
    const neto = f.tipo === "porcentaje"
      ? netoBase * (f.valor / 100)
      : f.cobro === "persona" ? f.valor * Math.max(1, pax) : f.valor;
    suplementos.push({
      tramo, franjaId: f.id ?? null, hora: formatearHora(min), neto,
      descripcion: `Suplemento de traslado de ${tramo} (${formatearHora(min)})`,
    });
  }
  return { ok: true, suplementos, netoTotal: suplementos.reduce((s, x) => s + x.neto, 0), pendientes };
}

/** Tramos que tienen alguna franja configurada (los únicos que requieren una hora para cotizar). */
export function tramosConFranja(franjas: FranjaSuplemento[], tramos: readonly TramoTraslado[] = ["llegada", "salida"]): TramoTraslado[] {
  return (["llegada", "salida"] as TramoTraslado[]).filter((t) => tramos.includes(t) && franjas.some((f) => tramosDe(f).includes(t)));
}

/**
 * Valida las horas que llegan del navegador (búsqueda, carrito): vacío/ausente = sin hora; texto no interpretable = error (nunca se ignora en
 * silencio, para que una hora mal escrita no se convierta en "sin suplemento"). Devuelve las horas normalizadas a HH:MM.
 */
export function validarHorasTramos(v: unknown): { ok: true; horas: HorasTramos } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, horas: {} };
  if (typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "Las horas del traslado no tienen una forma válida." };
  const o = v as Record<string, unknown>;
  const horas: HorasTramos = {};
  for (const [clave, rotulo] of [["llegada", "de llegada"], ["salida", "de salida"]] as const) {
    const t = o[clave];
    if (t === undefined || t === null || (typeof t === "string" && t.trim() === "")) continue;
    const min = parseHora(t);
    if (min == null) return { ok: false, error: `La hora ${rotulo} del traslado no es válida (usa HH:MM, por ejemplo 19:30).` };
    horas[clave] = formatearHora(min);
  }
  return { ok: true, horas };
}
