// ─────────────────────────────────────────────────────────────────────────
// Tipo de receptivo, alcance del traslado y precio PROPIO por trayecto — módulo PURO (sin Supabase). Es el motor de la migración 262; las lecturas de
// base, los formularios y el carrito se entregan aparte y llaman a estas funciones.
//
// Reglas (decididas, no inferidas):
//  - Tipo de receptivo: tour · traslado · asistencia_medica · combo. Un servicio sin clasificar (`null`, todo el legado) NO se trata como ninguno de ellos.
//  - Un traslado se vende por UN TRAYECTO (de llegada o de salida) o por IDA Y REGRESO. Alcance vendido: llegada | salida | ida_regreso.
//  - «Un trayecto» exige un precio PROPIO por vigencia (y por rango de pasajeros): sin él el resultado es `sin_precio_alcance`. Nunca se calcula a partir de «ida y regreso»
//    (ni la mitad ni nada parecido).
//  - «Ida y regreso» usa su precio propio si la vigencia lo define para el rango aplicable; si no, usa la TARIFA que ya tiene esa vigencia (por persona o por rango de
//    grupo), que históricamente era el precio de ida y regreso. El operador no tiene que volver a cargarla.
//  - Un combo DEBE declarar si contiene traslado y, si lo contiene, cómo se cobra ese componente (trayecto de llegada, trayecto de salida o ida y regreso).
//  - El suplemento por franja horaria solo se aplica a los tramos vendidos (`tramosDeAlcance`).
//
// Import relativo (no `@/…`): se importa directo desde `node --test`.
// ─────────────────────────────────────────────────────────────────────────
import type { TramoTraslado } from "./trasladoFranjas.ts";

export type TipoReceptivo = "tour" | "traslado" | "asistencia_medica" | "combo";
export const TIPOS_RECEPTIVO: readonly TipoReceptivo[] = ["tour", "traslado", "asistencia_medica", "combo"];
export const ROTULO_TIPO_RECEPTIVO: Record<TipoReceptivo, string> = { tour: "Tour", traslado: "Traslado", asistencia_medica: "Asistencia médica", combo: "Combo" };

/** Lo que se VENDE de un traslado. */
export type AlcanceVenta = "llegada" | "salida" | "ida_regreso";
export const ALCANCES_VENTA: readonly AlcanceVenta[] = ["llegada", "salida", "ida_regreso"];
export const ROTULO_ALCANCE_VENTA: Record<AlcanceVenta, string> = { llegada: "Un trayecto: llegada", salida: "Un trayecto: salida", ida_regreso: "Ida y regreso" };
/** Cómo se PRECIA: los dos sentidos de «un trayecto» comparten precio; ida y regreso tiene el suyo. */
export type AlcancePrecio = "trayecto" | "ida_regreso";
export const alcancePrecioDe = (a: AlcanceVenta): AlcancePrecio => (a === "ida_regreso" ? "ida_regreso" : "trayecto");
export const tramosDeAlcance = (a: AlcanceVenta): TramoTraslado[] => (a === "ida_regreso" ? ["llegada", "salida"] : [a]);

/** Alcance con el que un combo cobra su componente de traslado (valores de `servicios_adicionales.combo_traslado_alcance`). */
export type AlcanceCombo = "trayecto_llegada" | "trayecto_salida" | "ida_regreso";
export const ALCANCES_COMBO: readonly AlcanceCombo[] = ["trayecto_llegada", "trayecto_salida", "ida_regreso"];
export const alcanceVentaDeCombo = (a: AlcanceCombo): AlcanceVenta => (a === "trayecto_llegada" ? "llegada" : a === "trayecto_salida" ? "salida" : "ida_regreso");

/** Frontera de entrada: ausente/null = sin alcance; cualquier valor que no sea uno de los tres se rechaza (nunca se normaliza en silencio). */
export function parseAlcanceVenta(v: unknown): { ok: true; alcance: AlcanceVenta | undefined } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, alcance: undefined };
  return typeof v === "string" && (ALCANCES_VENTA as readonly string[]).includes(v) ? { ok: true, alcance: v as AlcanceVenta } : { ok: false };
}

/**
 * Regla ÚNICA de modalidad de venta, usada por el precio (liquidacionServicio) y por el costo/CxP (costosObligacionesCarrito): un servicio CLASIFICADO como traslado se vende
 * siempre por alcance; cualquier otro rechaza un alcance (una petición alterada no cambia la modalidad); un combo con traslado limita el suplemento al tramo que declaró;
 * sin clasificar (todo el legado) no cambia nada. `usaAlcance`: el neto sale de los precios propios del alcance.
 */
export function modalidadAlcance(c: ClasificacionServicio | null | undefined, alcance: AlcanceVenta | undefined):
  | { ok: true; usaAlcance: boolean; alcance?: AlcanceVenta; tramosCombo?: TramoTraslado[] }
  | { ok: false; motivo: "alcance_requerido" | "alcance_no_aplica" } {
  const esTraslado = c?.tipo_receptivo === "traslado";
  if (esTraslado && !alcance) return { ok: false, motivo: "alcance_requerido" };
  if (!esTraslado && alcance) return { ok: false, motivo: "alcance_no_aplica" };
  if (esTraslado) return { ok: true, usaAlcance: true, alcance };
  const tramosCombo = c?.tipo_receptivo === "combo" && c.combo_incluye_traslado === true && c.combo_traslado_alcance
    ? tramosDeAlcance(alcanceVentaDeCombo(c.combo_traslado_alcance)) : undefined;
  return { ok: true, usaAlcance: false, ...(tramosCombo ? { tramosCombo } : {}) };
}

export type ClasificacionServicio = {
  tipo_receptivo: TipoReceptivo | null | undefined;
  combo_incluye_traslado?: boolean | null;
  combo_traslado_alcance?: AlcanceCombo | null;
};

/** Errores de la clasificación (vacío = válida). Misma regla que el CHECK de la 262. `null` (sin clasificar) es válido: es el legado. */
export function validarClasificacion(c: ClasificacionServicio): string[] {
  const e: string[] = [];
  if (c.tipo_receptivo != null && !TIPOS_RECEPTIVO.includes(c.tipo_receptivo)) { e.push("El tipo de receptivo debe ser tour, traslado, asistencia médica o combo."); return e; }
  if (c.tipo_receptivo !== "combo") {
    if (c.combo_incluye_traslado != null || c.combo_traslado_alcance != null) e.push("Solo un combo declara si incluye traslado.");
    return e;
  }
  if (c.combo_incluye_traslado == null) { e.push("Un combo debe declarar si incluye traslado."); return e; }
  if (c.combo_incluye_traslado) {
    if (c.combo_traslado_alcance == null || !ALCANCES_COMBO.includes(c.combo_traslado_alcance)) e.push("Un combo con traslado debe declarar cómo se cobra ese componente: un trayecto de llegada, un trayecto de salida o ida y regreso.");
  } else if (c.combo_traslado_alcance != null) e.push("Un combo sin traslado no declara alcance de traslado.");
  return e;
}

/** ¿Este servicio es (o contiene) un traslado que se vende por trayecto? `null` = no se sabe (sin clasificar): el llamador NO debe suponerlo. */
export function llevaTraslado(c: ClasificacionServicio): boolean | null {
  if (c.tipo_receptivo == null) return null;
  if (c.tipo_receptivo === "traslado") return true;
  if (c.tipo_receptivo === "combo") return c.combo_incluye_traslado === true ? true : c.combo_incluye_traslado === false ? false : null;
  return false;
}

export type FilaPrecioAlcance = { alcance: AlcancePrecio; pax_desde: number | null; pax_hasta: number | null; precio: number };

/** Errores de los precios por alcance de UNA vigencia (vacío = válidos): enteros, rango completo y sin cruces dentro del mismo alcance; un precio por persona por alcance. */
export function validarPreciosAlcance(filas: readonly FilaPrecioAlcance[]): string[] {
  const e: string[] = [];
  filas.forEach((f, i) => {
    const n = `Precio ${i + 1}`;
    if (f.alcance !== "trayecto" && f.alcance !== "ida_regreso") e.push(`${n}: el alcance debe ser un trayecto o ida y regreso.`);
    if (typeof f.precio !== "number" || !Number.isFinite(f.precio) || f.precio < 0) e.push(`${n}: el precio debe ser un número no negativo.`);
    if ((f.pax_desde == null) !== (f.pax_hasta == null)) e.push(`${n}: el rango de pasajeros necesita «desde» y «hasta» (o ninguno para precio por persona).`);
    else if (f.pax_desde != null && (!Number.isInteger(f.pax_desde) || !Number.isInteger(f.pax_hasta) || f.pax_desde < 1 || (f.pax_hasta as number) < f.pax_desde)) e.push(`${n}: el rango ${f.pax_desde}–${f.pax_hasta} no es válido.`);
  });
  for (const a of ["trayecto", "ida_regreso"] as const) {
    const delAlcance = filas.filter((f) => f.alcance === a);
    if (delAlcance.filter((f) => f.pax_desde == null).length > 1) e.push(`Hay más de un precio por persona para ${a === "trayecto" ? "un trayecto" : "ida y regreso"}.`);
    const rangos = delAlcance.filter((f) => f.pax_desde != null).sort((x, y) => (x.pax_desde as number) - (y.pax_desde as number));
    for (let i = 1; i < rangos.length; i++) {
      if ((rangos[i].pax_desde as number) <= (rangos[i - 1].pax_hasta as number)) e.push(`Los rangos ${rangos[i - 1].pax_desde}–${rangos[i - 1].pax_hasta} y ${rangos[i].pax_desde}–${rangos[i].pax_hasta} de ${a === "trayecto" ? "un trayecto" : "ida y regreso"} se cruzan.`);
    }
  }
  return e;
}

/** Tarifa que la vigencia ya tiene (la de siempre: precio por persona y/o rangos de grupo). Es el precio de «ida y regreso» cuando la vigencia no define uno propio. */
export type TarifaVigenteFila = { precioPersona: number | null | undefined; grupos: readonly { pax_desde: number; pax_hasta: number; precio: number }[] };
// Misma regla que la tarifa de siempre (resolverTarifaServicio): 0 ES una tarifa válida (la venta exige después total > 0); «sin tarifa» es solo NULL, ausente o inválida (negativa, NaN).
const precioValido = (n: number | null | undefined): n is number => n != null && Number.isFinite(Number(n)) && Number(n) >= 0;

export type PrecioAlcanceResuelto =
  | {
      ok: true; alcancePrecio: AlcancePrecio; /** Neto por persona (modo persona) o del grupo completo (modo grupo). */ neto: number;
      /** `explicito`: fila propia del alcance. `tarifa_vigente`: «ida y regreso» sin precio propio, cobrado con la tarifa de la vigencia. */
      origen: "explicito" | "tarifa_vigente";
    }
  | { ok: false; motivo: "sin_precio_alcance" | "precios_invalidos"; detalle: string };

/**
 * Neto de la tarifa para el alcance VENDIDO. Persona: la fila del alcance sin rango. Grupo: la fila del alcance cuyo rango cubre `pax`. «Un trayecto» sin fila propia
 * falla: jamás se usa el precio de ida y regreso (ni mitad ni doble) ni el rango más cercano. «Ida y regreso» sin fila propia usa `tarifaVigente` (precio por persona, o
 * el rango de grupo que cubra `pax`); si tampoco hay, falla.
 */
export function resolverPrecioAlcance(i: { filas: readonly FilaPrecioAlcance[]; alcance: AlcanceVenta; modo: "persona" | "grupo"; pax: number; tarifaVigente?: TarifaVigenteFila }): PrecioAlcanceResuelto {
  const errores = validarPreciosAlcance(i.filas);
  if (errores.length) return { ok: false, motivo: "precios_invalidos", detalle: errores[0] };
  const ap = alcancePrecioDe(i.alcance);
  const rotulo = ap === "trayecto" ? "un trayecto" : "ida y regreso";
  const fila = i.modo === "persona"
    ? i.filas.find((f) => f.alcance === ap && f.pax_desde == null)
    : i.filas.find((f) => f.alcance === ap && f.pax_desde != null && i.pax >= f.pax_desde && i.pax <= (f.pax_hasta as number));
  if (fila) return { ok: true, alcancePrecio: ap, neto: fila.precio, origen: "explicito" };
  const t = ap === "ida_regreso" ? i.tarifaVigente : undefined;
  if (t) {
    const g = i.modo === "grupo" ? t.grupos.find((x) => i.pax >= x.pax_desde && i.pax <= x.pax_hasta && precioValido(x.precio)) : undefined;
    const neto = i.modo === "persona" ? (precioValido(t.precioPersona) ? Number(t.precioPersona) : null) : (g ? Number(g.precio) : null);
    if (neto != null) return { ok: true, alcancePrecio: ap, neto, origen: "tarifa_vigente" };
    return { ok: false, motivo: "sin_precio_alcance", detalle: i.modo === "persona"
      ? "Este traslado no tiene precio por persona de ida y regreso ni tarifa por persona en esta vigencia."
      : `Este traslado no tiene un rango de pasajeros de ida y regreso, ni en la tarifa de esta vigencia, que cubra ${i.pax} pasajero${i.pax === 1 ? "" : "s"}.` };
  }
  return { ok: false, motivo: "sin_precio_alcance", detalle: i.modo === "persona"
    ? `Este traslado no tiene precio por persona para ${rotulo} en esta vigencia.`
    : `Este traslado no tiene un rango de pasajeros para ${rotulo} que cubra ${i.pax} pasajero${i.pax === 1 ? "" : "s"} en esta vigencia.` };
}

/**
 * Rangos de grupo con que se OFRECE «ida y regreso» en una vigencia: los propios (explícitos) más los de la tarifa vigente que no se crucen con ninguno propio. En la venta
 * manda el propio para el pax que cubra y, si no, el de la tarifa vigente (`resolverPrecioAlcance`).
 * shortcut: un rango de la tarifa vigente que solo se cruza en parte con uno propio se omite de esta lista (solo informativa); el cobro por pax sí lo resuelve. Revisar si hace falta ofrecer el tramo no cruzado.
 */
export function rangosIdaRegresoEfectivos<T extends { pax_desde: number; pax_hasta: number }>(propios: readonly T[], vigente: readonly T[]): T[] {
  const cruza = (a: T, b: T) => a.pax_desde <= b.pax_hasta && b.pax_desde <= a.pax_hasta;
  return [...propios, ...vigente.filter((v) => !propios.some((p) => cruza(p, v)))].sort((a, b) => a.pax_desde - b.pax_desde);
}
