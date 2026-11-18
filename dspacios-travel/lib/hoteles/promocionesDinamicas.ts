// #43/#60 — Vista explicativa (SOLO LECTURA) de las promociones dinámicas por grupo de un hotel, para «Tarifas generadas».
// Una promoción con reglas por grupo NO tiene fila de tarifa: el motor calcula su neto en cada noche desde la base ganadora
// (lib/calc/paquetes.ts). Esta vista hace la MISMA cuenta (`netoConRegla`) sobre los datos que la ficha ya leyó —vigencias con
// sus reglas, filas de tarifa y acomodaciones—, sin consultas nuevas y sin escribir nada:
//   «ALTA · Semana · Estándar · PAM · Doble: 100.000 − 10 % = 90.000».
// Muestra también lo que hace que una regla NO se venda (prioridad, empate, combinación pendiente, monto mayor que su unidad),
// para no presentar como vendible un importe que el motor descarta. Son NETOS (costo del proveedor): el PVP depende del markup
// de cada paquete y se ve en el tarifario.
import { netoConRegla, netoHabitacionConDescuento, normReglas, repartirExacto, type UnidadMonto } from "../calc/promocionesGrupo.ts";
import { esPromoConReglas, toTemporadaRango, type TemporadaRango } from "../calc/paquetes.ts";
import { planPromoPorNoche } from "../calc/promoCalculadora.ts";
import { ACOMS, textoDias } from "./alcanceGrupos.ts";
import { paxTarifaDe, type AcomConfig } from "../acomodaciones.ts";
import type { AcomRoom } from "../acomodaciones.ts";

export type VigenciaPromoFicha = {
  id: number; nombre: string; tipo: string | null; prioridad: number | null; descuento_valor: number | null;
  regimen_restringido: string | null; min_noches?: number | null;
  promo_base_id?: number | null; descuento_unidad?: string | null;
  hotel_promocion_reglas?: unknown; hotel_promocion_combinacion?: { estado?: string | null } | { estado?: string | null }[] | null;
  hotel_temporada_grupos?: { id: string; nombre: string; dias: number[]; activo?: boolean | null }[] | null;
};
export type FilaTarifaFicha = { temporada: string | null; grupo_id?: string | null; tipo_habitacion: string | null; alimentacion: string | null } & Partial<Record<(typeof ACOMS)[number]["col"], number | string | null>>;

export type LineaPromoDinamica = {
  base: string; grupo: string; dias: string | null; categoria: string; regimen: string; acomodacion: string;
  /** null = la base no tiene tarifa en esa acomodación (solo en la matriz «sigue la base ganadora»: se muestra, no se oculta). */
  netoBase: number | null; valor: number; netoResultante: number | null; motivoNoAplica: string | null;
  /** #125 (promoción que sigue la base ganadora): tramo de noches (fechas de viaje ISO) en que esta base gana y la promoción aplica. */
  tramo?: { desde: string; hasta: string };
  /** El motor no descuenta esta acomodación (infante): se muestra la tarifa de la base tal cual. */
  conservaBase?: boolean;
  /** Solo descuento por habitación y noche: la cuenta se hace sobre la HABITACIÓN completa (como el motor) y el resultado se
   * reparte exacto entre los ocupantes tarifados (`repartirExacto`, igual que la composición de la cotización). */
  habitacion?: { ocupantes: number; baseHabitacion: number; resultadoHabitacion: number; porPersona: number[] };
};
export type PromoDinamica = {
  id: number; nombre: string; tipo: "descuento_pct" | "descuento_monto"; unidad: UnidadMonto | null; prioridad: number;
  estado: "vende" | "no_vende"; motivo: string | null; lineas: LineaPromoDinamica[];
  /** #125: promoción en modo «seguir la base ganadora cada noche» (matriz DERIVADA por tramo de noches; no hay filas guardadas). */
  sigueBase?: boolean;
  /** #125: la promoción concede «un niño gratis por habitación»; eso se decide al cotizar con la composición real y NO cambia la tarifa genérica de niño. */
  ninoGratis?: boolean;
  /** Tramos que no se venden (empate, sin base, sin tarifa…) y límites aplicados, para no presentar como vendible lo que el motor descarta. */
  notas?: string[];
};

const ETIQUETA = Object.fromEntries(ACOMS.map((a) => [a.col, a.etiqueta])) as Record<string, string>;
const ACOM_DE_COL: Record<string, string> = { neto_sencilla: "sencilla", neto_doble: "doble", neto_triple: "triple", neto_multiple: "multiple", neto_nino: "nino", neto_nino2: "nino2", neto_infante: "infante" };
const HABITACION = new Set(["sencilla", "doble", "triple", "multiple"]);
const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const estadoComb = (c: VigenciaPromoFicha["hotel_promocion_combinacion"]) => (Array.isArray(c) ? c[0]?.estado : c?.estado) ?? null;

export function promocionesDinamicasHotel(vigencias: readonly VigenciaPromoFicha[], tarifas: readonly FilaTarifaFicha[], acoms: readonly AcomConfig[] | null | undefined, moneda: string = "COP", opciones: OpcionesMatriz = {}): PromoDinamica[] {
  const decimales = moneda === "USD" ? 2 : 0; // mismo redondeo del reparto que la composición de la cotización
  const porId = new Map(vigencias.map((v) => [v.id, v]));
  const out: PromoDinamica[] = [];
  for (const p of vigencias) {
    if (!esPromoConReglas(p as unknown as TemporadaRango)) continue;
    const reglas = normReglas(p.hotel_promocion_reglas);
    const base = p.promo_base_id != null ? porId.get(p.promo_base_id) : undefined;
    if (!base || !reglas.length) continue; // sin base o sin reglas: la promoción no aplica (la ficha ya lo indica en Temporadas)
    const tipo = p.tipo as "descuento_pct" | "descuento_monto";
    const unidad = (p.descuento_unidad ?? null) as UnidadMonto | null;
    const prio = p.prioridad ?? 1, prioBase = base.prioridad ?? 1;
    // Mismas condiciones que el motor (paquetes.ts): menor prioridad que su base no aplica; igual = empate (no se vende).
    const motivo = prio < prioBase ? `prioridad ${prio} menor que su base «${base.nombre.trim()}» (${prioBase}): no aplica`
      : prio === prioBase ? `misma prioridad que su base «${base.nombre.trim()}»: empate, no se vende`
      : estadoComb(p.hotel_promocion_combinacion) === "pendiente" ? "falta configurar si acumula con EBB / Long Stay: no se vende hasta configurarlo"
      : null;
    const grupos = base.hotel_temporada_grupos ?? [];
    const lineas: LineaPromoDinamica[] = [];
    for (const regla of reglas) {
      const g = regla.grupo_id ? grupos.find((x) => x.id === regla.grupo_id) : undefined;
      const filas = tarifas.filter((t) => (t.temporada ?? "").trim() === base.nombre.trim() && (t.grupo_id ?? null) === regla.grupo_id
        && (!p.regimen_restringido || (t.alimentacion ?? "").trim() === p.regimen_restringido.trim()));
      for (const f of filas) {
        for (const a of ACOMS) {
          const netoBase = num(f[a.col]);
          if (netoBase == null) continue; // sin tarifa base en esa acomodación: nada que derivar
          const acom = ACOM_DE_COL[a.col];
          const ocupantes = HABITACION.has(acom) ? paxTarifaDe(acoms as AcomConfig[] | undefined, acom as AcomRoom) : undefined;
          const neto = netoConRegla(tipo, unidad, regla.valor, netoBase, acom, ocupantes);
          const resultadoHab = tipo === "descuento_monto" && unidad === "habitacion_noche" && ocupantes != null
            ? netoHabitacionConDescuento(regla.valor, netoBase, acom, ocupantes) : null;
          lineas.push({
            base: base.nombre.trim(), grupo: g ? g.nombre.trim() : "todos los días", dias: regla.dias ? textoDias(regla.dias) : null,
            categoria: (f.tipo_habitacion ?? "").trim(), regimen: (f.alimentacion ?? "").trim(), acomodacion: ETIQUETA[a.col],
            netoBase, valor: regla.valor, netoResultante: neto,
            ...(resultadoHab != null && ocupantes != null ? { habitacion: { ocupantes, baseHabitacion: netoBase * ocupantes, resultadoHabitacion: resultadoHab, porPersona: repartirExacto(resultadoHab, ocupantes, decimales) } } : {}),
            motivoNoAplica: neto == null ? (tipo === "descuento_monto" && unidad === "habitacion_noche" && !HABITACION.has(acom) ? "no es habitación: conserva la base" : "el descuento supera la tarifa: conserva la base") : null,
          });
        }
      }
    }
    out.push({ id: p.id, nombre: p.nombre.trim(), tipo, unidad, prioridad: prio, estado: motivo ? "no_vende" : "vende", motivo, lineas });
  }
  // #125: las promociones que siguen la base ganadora tampoco tienen fila: su matriz se deriva por tramo de noches (mismas bases por noche que el motor).
  if (vigencias.some((v) => (v as unknown as { promo_sigue_base?: boolean | null }).promo_sigue_base === true)) {
    out.push(...promocionesSigueBase(vigencias.map((v) => toTemporadaRango(v as unknown as Parameters<typeof toTemporadaRango>[0])), tarifas, opciones));
  }
  return out;
}

export type OpcionesMatriz = { adultsOnly?: boolean };
/** Tope de líneas de la matriz derivada: la vista nunca crece sin límite aunque el hotel tenga muchas categorías, regímenes y tramos. */
export const MAX_LINEAS_MATRIZ = 2_000;
const fechaCorta = (iso: string) => iso.split("-").reverse().join("/");
const MOTIVO_TRAMO: Record<string, string> = {
  sin_base: "ninguna temporada base cubre esas noches",
  base_empatada: "empate de prioridad entre bases",
  prioridad_insuficiente: "la promoción no supera la prioridad de la base",
  sin_valor_base: "la base no tiene tarifa",
};

/**
 * #125 — Matriz DERIVADA y de solo lectura de las promociones que SIGUEN la base ganadora cada noche: una promoción, varios tramos de
 * noches (cada uno con la base que gana), y por categoría/régimen las SIETE acomodaciones con su tarifa de alojamiento por persona y noche.
 * Es la misma cuenta del motor (`resolverNetoNocheDetallado`): adultos, Niño 1 y Niño 2 reciben el % de la regla sobre la tarifa COMPLETA de la
 * base (la fila ya trae el suplemento de régimen); el infante conserva la de su base. No escribe nada ni promedia: cada tramo se muestra con
 * SU base. NO es una cotización: el niño gratis por habitación se decide al cotizar con la composición real y no vuelve cero la tarifa de niño.
 * `tarifas` pueden ser filas guardadas (Tarifas generadas) o las generadas por la calculadora (vista previa); en las primeras null = sin tarifa.
 */
export function promocionesSigueBase(vigencias: readonly TemporadaRango[], tarifas: readonly FilaTarifaFicha[], opciones: OpcionesMatriz = {}): PromoDinamica[] {
  const out: PromoDinamica[] = [];
  const vigs = [...vigencias];
  const columnas = opciones.adultsOnly ? ACOMS.slice(0, 4) : ACOMS;
  let presupuesto = MAX_LINEAS_MATRIZ;
  const cmp = (a: string, b: string) => a.localeCompare(b, "es");
  for (const p of vigs) {
    if (p.promo_sigue_base !== true || !esPromoConReglas(p)) continue;
    const nombre = p.nombre.trim();
    const regla = p.reglas?.find((r) => r.grupo_id == null);
    const cabecera: PromoDinamica = { id: p.id ?? 0, nombre, tipo: "descuento_pct", unidad: null, prioridad: p.prioridad ?? 1, estado: "vende", motivo: null, lineas: [], sigueBase: true, ...(p.nino_gratis === true ? { ninoGratis: true } : {}) };
    const pct = Number(regla?.valor);
    if (!regla || !(pct > 0 && pct < 100)) { out.push({ ...cabecera, estado: "no_vende", motivo: "Sin porcentaje de regla válido (mayor que 0 y menor que 100): no se vende." }); continue; }
    if (p.combinacion?.estado === "pendiente") { out.push({ ...cabecera, estado: "no_vende", motivo: "falta configurar si acumula con EBB / Long Stay: no se vende hasta configurarlo" }); continue; }
    const dias = regla.dias?.length ? regla.dias : null;
    const textoDiasRegla = dias ? textoDias(dias) : null;
    const regimenes = [...new Set(tarifas.map((t) => (t.alimentacion ?? "").trim()).filter(Boolean))].sort(cmp);
    const notas = new Set<string>();
    let truncado = false;
    const lineas: LineaPromoDinamica[] = [];
    for (const regimen of regimenes) {
      const plan = planPromoPorNoche({ promo: nombre, vigencias: vigs, regimen, pct, dias });
      if (plan.truncado) notas.add(`${regimen}: hay más tramos de los que se muestran; revisa las fechas de la promoción.`);
      for (const t of plan.tramos) {
        if (t.estado !== "ok" || !t.base) { notas.add(`${regimen} · ${fechaCorta(t.desde)}${t.hasta !== t.desde ? ` a ${fechaCorta(t.hasta)}` : ""}: ${MOTIVO_TRAMO[t.estado] ?? t.estado}; esas noches no se venden.`); continue; }
        if (vigs.find((v) => v.nombre.trim() === t.base)?.grupos?.length) { notas.add(`${t.base} se vende por grupos de días: su importe depende del grupo de cada noche y se explica en esa base.`); continue; }
        for (const f of tarifas.filter((x) => (x.temporada ?? "").trim() === t.base && (x.alimentacion ?? "").trim() === regimen && (x.grupo_id ?? null) == null)) {
          for (const a of columnas) {
            if (presupuesto <= 0) { truncado = true; break; }
            presupuesto--;
            const crudo = num(f[a.col]);
            // 0 en una acomodación de habitación es «sin tarifa» (la calculadora usa 0 para vacío); en niños 0 es gratis y sí se publica.
            const netoBase = crudo == null || (a.tipo === "habitacion" && crudo <= 0) ? null : crudo;
            const conservaBase = a.tipo === "infante";
            const neto = netoBase == null ? null : conservaBase ? netoBase : netoConRegla("descuento_pct", null, pct, netoBase, ACOM_DE_COL[a.col]);
            lineas.push({
              base: t.base, grupo: "todos los días", dias: textoDiasRegla, tramo: { desde: t.desde, hasta: t.hasta },
              categoria: (f.tipo_habitacion ?? "").trim(), regimen, acomodacion: ETIQUETA[a.col], netoBase, valor: pct, netoResultante: neto,
              ...(conservaBase ? { conservaBase: true } : {}),
              motivoNoAplica: netoBase == null ? "la base no tiene tarifa en esta acomodación" : neto == null ? "el descuento supera la tarifa: conserva la base" : null,
            });
          }
        }
      }
    }
    if (truncado) notas.add(`La matriz se limitó a ${MAX_LINEAS_MATRIZ} tarifas; reduce categorías, regímenes o tramos para verla completa.`);
    out.push({
      ...cabecera, lineas, ...(notas.size ? { notas: [...notas] } : {}),
      ...(lineas.length === 0 ? { estado: "no_vende" as const, motivo: [...notas][0] ?? "Sin noches de viaje cargadas o sin tarifas de base en los regímenes del hotel: no hay nada que mostrar." } : {}),
    });
  }
  return out;
}

/** Roles que ven netos (costo del proveedor); el mismo criterio que `verFinanzas` del contrato. `venta` y externos no. */
export const ROLES_VEN_NETOS = ["superadmin", "gerencia", "administracion", "operaciones"] as const;
