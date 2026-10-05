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
