// #43 — validación de las fechas de una vigencia de hotel (viaje, compra y blackouts).
// Módulo PURO, sin I/O: lo usan el formulario (TemporadasBox) y las Server Actions (crear/actualizar/CSV/copiar), así la regla
// es una sola y el servidor nunca depende de que el formulario la haya aplicado.
//
// Origen: el guardado solo comparaba los textos de inicio y fin; dejó entrar `0206-12-24` (hotel 53) y `62026-06-29` (hotel 9).
// `0206-12-24` es fecha VÁLIDA para el motor (año 206) y volvía a ALTA vigente desde hoy; `62026-06-29` no cubre nada.
//
// Reglas (decisión del dueño, hotel 53, vigencia ALTA id 140: el inicio correcto era 2026-12-24):
//   · al CREAR una vigencia o al CAMBIAR sus fechas: formato AAAA-MM-DD, día real del calendario, fin ≥ inicio, y ningún año
//     anterior al año vigente en Bogotá;
//   · rangos de viaje y blackouts: esas reglas completas;
//   · compra: fecha real y fin ≥ inicio; el FIN no puede estar en un año anterior al vigente; el INICIO sí puede ser de un año
//     anterior (una compra abierta el año pasado es normal) pero no absurdo (< ANIO_MINIMO_COMPRA_INICIO). La parte de la compra
//     es la interpretación de «según corresponda»: queda anotada en el diseño para confirmar con el dueño;
//   · NUNCA se corrige un año ni una fecha: el mensaje nombra el valor y quien guarda decide;
//   · lo ya guardado que no cambia queda exento: una vigencia histórica se puede seguir editando (prioridad, nombre…) mientras
//     sus fechas antiguas no se toquen. Un rango se considera «sin cambios» solo si inicio y fin son exactamente los guardados.
import { fechaNegocio } from "../fechaNegocio.ts";

export type RangoFechas = { fecha_inicio: string; fecha_fin: string };
export type FechasVigencia = {
  /** Rango principal de viaje. */
  inicio: string;
  fin: string;
  /** Rangos de viaje adicionales. */
  rangos?: RangoFechas[];
  blackouts?: RangoFechas[];
  compraInicio?: string | null;
  compraFin?: string | null;
};
export type ResultadoFechas = { ok: true } | { ok: false; error: string };

/** Piso de plausibilidad para el INICIO de la compra (puede ser de un año anterior, pero no `0206`). */
export const ANIO_MINIMO_COMPRA_INICIO = 2000;

/** Año calendario vigente en Bogotá (UTC−5, sin horario de verano): a las 23:59 del 31-dic todavía es el año que termina. */
export function anioVigenteBogota(instante: Date = new Date()): number {
  return Number(fechaNegocio(instante).slice(0, 4));
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const bisiesto = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** ¿Es un AAAA-MM-DD de cuatro dígitos que existe en el calendario? (2027-02-30 no; 2028-02-29 sí). */
export function fechaIsoReal(valor: string): boolean {
  const m = ISO.exec(valor);
  if (!m) return false;
  const y = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const dias = [31, bisiesto(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];
  return dia <= dias;
}

const anioDe = (iso: string) => Number(iso.slice(0, 4));
const AVISO_FINAL = "El sistema no corrige fechas por su cuenta: revisa el valor.";

function problemaFecha(valor: string, etiqueta: string): string | null {
  if (!ISO.test(valor)) return `${etiqueta} «${valor}» no tiene el formato AAAA-MM-DD de cuatro dígitos. ${AVISO_FINAL}`;
  if (!fechaIsoReal(valor)) return `${etiqueta} «${valor}» no existe en el calendario. ${AVISO_FINAL}`;
  return null;
}

function problemaAnio(valor: string, etiqueta: string, anioVigente: number): string | null {
  return anioDe(valor) < anioVigente
    ? `${etiqueta} «${valor}» tiene un año anterior a ${anioVigente} (año vigente en Bogotá). ${AVISO_FINAL}`
    : null;
}

function problemaRango(r: RangoFechas, etiqueta: string, anioVigente: number): string | null {
  const i = (r.fecha_inicio ?? "").trim();
  const f = (r.fecha_fin ?? "").trim();
  if (!i && !f) return null; // fila vacía: se ignora, igual que al guardar
  if (!i || !f) return `${etiqueta}: necesita fecha de inicio y de fin.`;
  const pi = problemaFecha(i, `${etiqueta}, inicio`);
  if (pi) return pi;
  const pf = problemaFecha(f, `${etiqueta}, fin`);
  if (pf) return pf;
  if (f < i) return `${etiqueta}: el fin «${f}» es anterior al inicio «${i}».`;
  return problemaAnio(i, `${etiqueta}, inicio`, anioVigente) ?? problemaAnio(f, `${etiqueta}, fin`, anioVigente);
}

const claveRango = (r: RangoFechas) => `${(r.fecha_inicio ?? "").trim()}|${(r.fecha_fin ?? "").trim()}`;

/** Fechas tal como están guardadas en `hotel_temporadas` (misma convención que el formulario y que `payloadTemporada`). */
export function fechasGuardadas(fila: {
  fecha_inicio?: string | null; fecha_fin?: string | null; rangos?: unknown; blackouts?: unknown;
  compra_inicio?: string | null; compra_fin?: string | null;
}): FechasVigencia {
  const lista = (v: unknown): RangoFechas[] =>
    Array.isArray(v)
      ? v.filter((r): r is RangoFechas => !!r && typeof r === "object"
          && typeof (r as RangoFechas).fecha_inicio === "string" && typeof (r as RangoFechas).fecha_fin === "string")
      : [];
  const rangos = lista(fila.rangos);
  const principal = rangos[0] ?? { fecha_inicio: fila.fecha_inicio ?? "", fecha_fin: fila.fecha_fin ?? "" };
  return {
    inicio: principal.fecha_inicio, fin: principal.fecha_fin, rangos: rangos.slice(1), blackouts: lista(fila.blackouts),
    compraInicio: fila.compra_inicio ?? null, compraFin: fila.compra_fin ?? null,
  };
}

/**
 * Valida las fechas de una vigencia. `previas` = lo guardado (solo al editar): lo que sigue igual no se vuelve a juzgar.
 * `anioVigente` se calcula una vez con `anioVigenteBogota()` en el borde (servidor o formulario) y se pasa aquí.
 */
export function validarFechasVigencia(
  f: FechasVigencia,
  opciones: { anioVigente: number; previas?: FechasVigencia | null },
): ResultadoFechas {
  const { anioVigente } = opciones;
  const previas = opciones.previas ?? null;
  const viajeNuevo: RangoFechas[] = [{ fecha_inicio: f.inicio, fecha_fin: f.fin }, ...(f.rangos ?? [])];
  const viajePrevio = new Set(previas ? [{ fecha_inicio: previas.inicio, fecha_fin: previas.fin }, ...(previas.rangos ?? [])].map(claveRango) : []);
  const blackoutPrevio = new Set((previas?.blackouts ?? []).map(claveRango));

  for (const r of viajeNuevo) {
    if (viajePrevio.has(claveRango(r))) continue; // sin cambios: histórico
    const p = problemaRango(r, "Rango de viaje", anioVigente);
    if (p) return { ok: false, error: p };
  }
  for (const r of f.blackouts ?? []) {
    if (blackoutPrevio.has(claveRango(r))) continue;
    const p = problemaRango(r, "Blackout", anioVigente);
    if (p) return { ok: false, error: p };
  }

  const ci = (f.compraInicio ?? "").trim();
  const cf = (f.compraFin ?? "").trim();
  const ciCambio = ci !== (previas?.compraInicio ?? "").trim();
  const cfCambio = cf !== (previas?.compraFin ?? "").trim();
  if (ci && ciCambio) {
    const p = problemaFecha(ci, "Compra, inicio");
    if (p) return { ok: false, error: p };
    if (anioDe(ci) < ANIO_MINIMO_COMPRA_INICIO) {
      return { ok: false, error: `Compra, inicio «${ci}» tiene un año anterior a ${ANIO_MINIMO_COMPRA_INICIO}, que no es plausible. ${AVISO_FINAL}` };
    }
  }
  if (cf && cfCambio) {
    const p = problemaFecha(cf, "Compra, fin") ?? problemaAnio(cf, "Compra, fin", anioVigente);
    if (p) return { ok: false, error: p };
  }
  if ((ciCambio || cfCambio) && ci && cf && fechaIsoReal(ci) && fechaIsoReal(cf) && cf < ci) {
    return { ok: false, error: `Compra: el fin «${cf}» es anterior al inicio «${ci}».` };
  }
  return { ok: true };
}
