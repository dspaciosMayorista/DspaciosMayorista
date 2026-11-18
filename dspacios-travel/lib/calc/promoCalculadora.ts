// ─────────────────────────────────────────────────────────────────────────
// Promociones y vigencias históricas en las calculadoras de tarifa de hotel
// ─────────────────────────────────────────────────────────────────────────
// Funciones PURAS (sin BD) que usan la calculadora (vista previa) y la Server
// Action de generación con EXACTAMENTE la misma regla:
//
//  · `resolverBasePromo`: con qué temporada BASE se relaciona una vigencia
//    promocional `descuento_pct`. Regla (pendientes #15/#26): por cada noche
//    de viaje que cubre la promo, la base es la vigencia de tipo 'tarifa' de
//    mayor prioridad que aplica al régimen y cubre esa noche. La promo SOLO
//    se relaciona si TODAS sus noches caen en UNA MISMA base y la promo tiene
//    mayor prioridad que ella. Si cruza dos bases, si alguna noche no tiene
//    base, o si dos bases empatan en prioridad, NO se elige ninguna (falla
//    cerrado): la regla comercial para esos solapamientos está pendiente.
//    Una promoción nunca toma como base a otra promoción.
//
//  · `nombreVigenciaVencida` / `separarFilasVencidas`: una vigencia cuya
//    compra ya cerró es HISTÓRICA. Generar no debe reescribir ni recrear sus
//    filas (se conservan tal cual para consulta), así que se separan antes de
//    escribir. La función SQL `generar_tarifas_hotel_calculadora` (migración
//    203) aplica la misma regla en servidor.
// ─────────────────────────────────────────────────────────────────────────

import { temporadaCubreFecha, type TemporadaRango } from "./paquetes.ts";
import { diaSemanaNoche } from "./gruposDias.ts";

const MS_DIA = 86_400_000;
// Tope defensivo por rango (un rango mal cargado no debe colgar la vista previa).
const MAX_DIAS_RANGO = 1_500;

/** Una vigencia de `hotel_temporadas` está VENCIDA si todas sus filas con ese
 * nombre tienen `compra_fin` anterior a hoy (Bogotá). Sin filas con ese
 * nombre, o con alguna fila sin `compra_fin`, no se considera vencida. */
export function nombreVigenciaVencida(nombre: string, vigencias: TemporadaRango[], hoy: string): boolean {
  const filas = vigencias.filter((v) => v.nombre?.trim() === nombre.trim());
  if (filas.length === 0) return false;
  return filas.every((v) => !!v.compra_fin && v.compra_fin < hoy);
}

/** #43/#60 (299): vigencias que se VENDEN por grupos de días. La calculadora general no escribe sus tarifas ni las
 * de promociones calculadas desde ellas (`temporada_base`): se cambian por grupo y se aplican en «Grupos de días».
 * Misma regla que `generar_tarifas_hotel_calculadora` en la base. */
export function vigenciasConGrupos(vigencias: TemporadaRango[]): Set<string> {
  return new Set(vigencias.filter((v) => (v.tipo ?? "tarifa") === "tarifa" && (v.grupos?.length ?? 0) > 0).map((v) => v.nombre.trim()));
}
export function separarFilasConGrupos<T extends { temporada: string; temporada_base?: string | null }>(
  filas: T[],
  vigencias: TemporadaRango[],
): { generables: T[]; conGrupos: string[] } {
  const nombres = vigenciasConGrupos(vigencias);
  const conGrupos = new Set<string>();
  const generables: T[] = [];
  for (const f of filas) {
    const t = f.temporada.trim(), b = (f.temporada_base ?? "").trim();
    if (nombres.has(t) || (b && nombres.has(b))) conGrupos.add(nombres.has(t) ? t : `${t} (desde ${b})`);
    else generables.push(f);
  }
  return { generables, conGrupos: [...conGrupos].sort() };
}

/** Separa las filas cuya temporada es una vigencia vencida (se conservan sin
 * reescribir) de las que sí se generan. */
export function separarFilasVencidas<T extends { temporada: string }>(
  filas: T[],
  vigencias: TemporadaRango[],
  hoy: string
): { generables: T[]; vencidas: string[] } {
  const vencidas = new Set<string>();
  const generables: T[] = [];
  for (const f of filas) {
    if (nombreVigenciaVencida(f.temporada, vigencias, hoy)) vencidas.add(f.temporada.trim());
    else generables.push(f);
  }
  return { generables, vencidas: [...vencidas].sort() };
}

function aplicaRegimen(v: TemporadaRango, regimen: string): boolean {
  return v.regimen_restringido == null || v.regimen_restringido.trim() === regimen.trim();
}

/** Fechas (yyyy-mm-dd) que cubre UNA fila de vigencia: sus rangos menos sus
 * blackouts — misma regla de cobertura del motor (`temporadaCubreFecha`). */
function nochesCubiertas(v: TemporadaRango): string[] {
  const rangos = v.rangos && v.rangos.length
    ? v.rangos
    : (v.fecha_inicio && v.fecha_fin ? [{ fecha_inicio: v.fecha_inicio, fecha_fin: v.fecha_fin }] : []);
  const out = new Set<string>();
  for (const r of rangos) {
    const ini = Date.parse(`${r.fecha_inicio}T00:00:00Z`);
    const fin = Date.parse(`${r.fecha_fin}T00:00:00Z`);
    if (Number.isNaN(ini) || Number.isNaN(fin) || fin < ini) continue;
    for (let t = ini, n = 0; t <= fin && n < MAX_DIAS_RANGO; t += MS_DIA, n++) {
      const iso = new Date(t).toISOString().slice(0, 10);
      if (temporadaCubreFecha(v, new Date(`${iso}T00:00:00`).getTime())) out.add(iso);
    }
  }
  return [...out].sort();
}

export type MotivoSinBase =
  | "no_aplica_regimen"
  | "tipo_mixto"
  | "porcentaje_invalido"
  | "sin_fechas"
  | "sin_base"
  | "base_empatada"
  | "varias_bases"
  | "prioridad_insuficiente";

export type ResolucionBasePromo =
  | { ok: true; base: string; pct: number }
  | { ok: false; motivo: MotivoSinBase; mensaje: string };

/** Relaciona la vigencia promocional `promo` (tipo `descuento_pct`) con su
 * temporada base para `regimen`. Ver la regla en la cabecera del archivo. */
export function resolverBasePromo(promo: string, vigencias: TemporadaRango[], regimen: string): ResolucionBasePromo {
  const nombre = promo.trim();
  const filasPromo = vigencias.filter((v) => v.nombre?.trim() === nombre);
  if (filasPromo.some((v) => (v.tipo ?? "tarifa") !== "descuento_pct")) {
    return { ok: false, motivo: "tipo_mixto", mensaje: `"${nombre}" tiene filas de vigencia con tipos distintos; no se puede tratar como una sola promoción.` };
  }
  const aplicables = filasPromo.filter((v) => aplicaRegimen(v, regimen));
  if (aplicables.length === 0) {
    return { ok: false, motivo: "no_aplica_regimen", mensaje: `"${nombre}" no aplica al régimen ${regimen}.` };
  }
  const pcts = new Set(aplicables.map((v) => Number(v.descuento_valor)));
  const pct = Number(aplicables[0].descuento_valor);
  if (pcts.size !== 1 || !Number.isFinite(pct) || pct <= 0 || pct >= 100) {
    return { ok: false, motivo: "porcentaje_invalido", mensaje: `"${nombre}" necesita un único descuento mayor a 0 y menor a 100 %.` };
  }

  const bases = vigencias.filter((v) => (v.tipo ?? "tarifa") === "tarifa" && aplicaRegimen(v, regimen));
  const basesUsadas = new Set<string>();
  let algunaNoche = false;
  for (const p of aplicables) {
    const prioPromo = p.prioridad ?? 1;
    for (const iso of nochesCubiertas(p)) {
      algunaNoche = true;
      const t0 = new Date(`${iso}T00:00:00`).getTime();
      const cubren = bases.filter((b) => temporadaCubreFecha(b, t0));
      if (cubren.length === 0) {
        return { ok: false, motivo: "sin_base", mensaje: `"${nombre}" cubre el ${iso}, pero ninguna temporada base del régimen ${regimen} cubre esa noche.` };
      }
      const top = Math.max(...cubren.map((b) => b.prioridad ?? 1));
      const ganadoras = new Set(cubren.filter((b) => (b.prioridad ?? 1) === top).map((b) => b.nombre.trim()));
      if (ganadoras.size > 1) {
        return { ok: false, motivo: "base_empatada", mensaje: `El ${iso} empatan en prioridad las bases ${[...ganadoras].join(", ")}; no se sabe sobre cuál aplicar "${nombre}".` };
      }
      if (prioPromo <= top) {
        return { ok: false, motivo: "prioridad_insuficiente", mensaje: `"${nombre}" no tiene mayor prioridad que su base ${[...ganadoras][0]} (el ${iso}).` };
      }
      basesUsadas.add([...ganadoras][0]);
    }
  }
  if (!algunaNoche) {
    return { ok: false, motivo: "sin_fechas", mensaje: `"${nombre}" no tiene fechas de viaje cargadas.` };
  }
  if (basesUsadas.size > 1) {
    return { ok: false, motivo: "varias_bases", mensaje: `"${nombre}" cruza varias temporadas base (${[...basesUsadas].sort().join(", ")}); falta definir sobre cuál se calcula.` };
  }
  return { ok: true, base: [...basesUsadas][0], pct };
}

// ─────────────────────────────────────────────────────────────────────────
// #125 — Plan por noche de una promoción que SIGUE la base ganadora (varias temporadas base sucesivas).
// Misma resolución de base por noche que `resolverBasePromo` (cobertura, prioridad, empate, régimen), pero sin exigir una sola base: cada noche toma la
// suya. Solo DIAGNOSTICA y presenta (vista previa); el precio real lo calcula el motor compartido (`resolverNetoNocheDetallado`). Acotado: las noches se
// agrupan en tramos consecutivos con la misma base/estado y se devuelven a lo sumo `maxSegmentos`.
// ─────────────────────────────────────────────────────────────────────────
export type EstadoTramoPlan = "ok" | "sin_base" | "base_empatada" | "prioridad_insuficiente" | "sin_valor_base";
export type TramoPlanPromo = {
  desde: string; hasta: string; noches: number; estado: EstadoTramoPlan;
  base?: string; detalle?: string;
  pct?: number; netoBase?: number | null; netoPromo?: number | null;
  /** Solo con «un niño gratis por habitación»: tarifa de niño de la base y con la promoción (el niño gratis no paga estas noches). */
  ninoGratis?: boolean; netoNinoBase?: number | null; netoNinoPromo?: number | null;
};
export type PlanPromoPorNoche = { tramos: TramoPlanPromo[]; noches: number; truncado: boolean; todoOk: boolean };

const sigDia = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + MS_DIA).toISOString().slice(0, 10);

export function planPromoPorNoche(a: {
  promo: string;
  vigencias: TemporadaRango[];
  regimen: string;
  /** % de la regla (en modo seguir-base es la regla de la promoción; en la calculadora, `descuento_valor`). */
  pct: number;
  ninoGratis?: boolean;
  /** Días de la semana (1 = lunes … 7 = domingo) en que rige la regla de la promoción; ausente/null = todos. Las demás noches se venden a la base. */
  dias?: number[] | null;
  valorBase?: (base: string) => number | null | undefined;
  valorNinoBase?: (base: string) => number | null | undefined;
  maxSegmentos?: number;
}): PlanPromoPorNoche {
  const nombre = a.promo.trim();
  const aplicables = a.vigencias.filter((v) => v.nombre?.trim() === nombre && aplicaRegimen(v, a.regimen));
  const bases = a.vigencias.filter((v) => (v.tipo ?? "tarifa") === "tarifa" && aplicaRegimen(v, a.regimen));
  const noches = new Map<string, number>(); // fecha → prioridad de la promoción que la cubre (la mayor)
  for (const p of aplicables) for (const iso of nochesCubiertas(p)) noches.set(iso, Math.max(noches.get(iso) ?? 0, p.prioridad ?? 1));
  const fechas = [...noches.keys()].sort();
  const max = a.maxSegmentos ?? 60;
  const factor = 1 - a.pct / 100;
  const tramos: TramoPlanPromo[] = [];
  let truncado = false;
  for (const iso of fechas) {
    const t0 = new Date(`${iso}T00:00:00`).getTime();
    if (a.dias?.length && !a.dias.includes(diaSemanaNoche(t0))) continue; // día sin regla: conserva la base, no es parte de la promoción
    const cubren = bases.filter((b) => temporadaCubreFecha(b, t0));
    let tramo: Omit<TramoPlanPromo, "desde" | "hasta" | "noches">;
    if (cubren.length === 0) {
      tramo = { estado: "sin_base", detalle: `Ninguna temporada base del régimen ${a.regimen} cubre esta noche.` };
    } else {
      const top = Math.max(...cubren.map((b) => b.prioridad ?? 1));
      const ganadoras = [...new Set(cubren.filter((b) => (b.prioridad ?? 1) === top).map((b) => b.nombre.trim()))].sort();
      if (ganadoras.length > 1) tramo = { estado: "base_empatada", detalle: `Empatan en prioridad: ${ganadoras.join(", ")}.` };
      else if ((noches.get(iso) ?? 1) <= top) tramo = { estado: "prioridad_insuficiente", base: ganadoras[0], detalle: `La promoción no tiene mayor prioridad que ${ganadoras[0]}.` };
      else {
        const nb = a.valorBase ? a.valorBase(ganadoras[0]) ?? null : null;
        const nn = a.ninoGratis && a.valorNinoBase ? a.valorNinoBase(ganadoras[0]) ?? null : null;
        tramo = {
          estado: a.valorBase && nb == null ? "sin_valor_base" : "ok", base: ganadoras[0], pct: a.pct,
          ...(a.valorBase ? { netoBase: nb, netoPromo: nb == null ? null : nb * factor } : {}),
          ...(a.valorBase && nb == null ? { detalle: `${ganadoras[0]} no tiene tarifa cargada: esa noche no se vende.` } : {}),
          ...(a.ninoGratis ? { ninoGratis: true, ...(a.valorNinoBase ? { netoNinoBase: nn, netoNinoPromo: nn == null ? null : nn * factor } : {}) } : {}),
        };
      }
    }
    const ult = tramos[tramos.length - 1];
    if (ult && sigDia(ult.hasta) === iso && ult.estado === tramo.estado && ult.base === tramo.base) { ult.hasta = iso; ult.noches += 1; continue; }
    if (tramos.length >= max) { truncado = true; break; }
    tramos.push({ desde: iso, hasta: iso, noches: 1, ...tramo });
  }
  return { tramos, noches: fechas.length, truncado, todoOk: fechas.length > 0 && !truncado && tramos.every((t) => t.estado === "ok") };
}

/** Etiqueta de una fila de `tarifa_hotel` en la tabla interna. Es PROMO si
 * es precio final calculado desde una base (`precio_final_autoritativo`) o si
 * su temporada es una vigencia promocional (aunque se haya cargado a mano);
 * nunca debe decir BASE para una promoción. */
export function etiquetaFilaTarifa(
  fila: { temporada: string | null; precio_final_autoritativo?: boolean | null; temporada_base?: string | null },
  vigencias: { nombre: string; tipo?: string | null }[]
): { etiqueta: "PROMO" | "BASE"; detalle: string } {
  if (fila.precio_final_autoritativo) {
    return {
      etiqueta: "PROMO",
      detalle: fila.temporada_base
        ? `Precio final calculado desde la temporada base "${fila.temporada_base}"; no se vuelve a descontar.`
        : "Precio final de promoción; no se vuelve a descontar.",
    };
  }
  const nombre = fila.temporada?.trim();
  const esPromo = !!nombre && vigencias.some((v) => v.nombre?.trim() === nombre && (v.tipo ?? "tarifa") !== "tarifa");
  return esPromo
    ? { etiqueta: "PROMO", detalle: "Vigencia promocional con valores cargados a mano: se cobra el valor de la fila tal cual." }
    : { etiqueta: "BASE", detalle: "Tarifa base de la temporada." };
}
