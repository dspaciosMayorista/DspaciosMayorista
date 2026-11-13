// #43/#60 — Vista explicativa (SOLO LECTURA) de las promociones dinámicas por grupo de un hotel, para «Tarifas generadas».
// Una promoción con reglas por grupo NO tiene fila de tarifa: el motor calcula su neto en cada noche desde la base ganadora
// (lib/calc/paquetes.ts). Esta vista hace la MISMA cuenta (`netoConRegla`) sobre los datos que la ficha ya leyó —vigencias con
// sus reglas, filas de tarifa y acomodaciones—, sin consultas nuevas y sin escribir nada:
//   «ALTA · Semana · Estándar · PAM · Doble: 100.000 − 10 % = 90.000».
// Muestra también lo que hace que una regla NO se venda (prioridad, empate, combinación pendiente, monto mayor que su unidad),
// para no presentar como vendible un importe que el motor descarta. Son NETOS (costo del proveedor): el PVP depende del markup
// de cada paquete y se ve en el tarifario.
import { netoConRegla, netoHabitacionConDescuento, normReglas, repartirExacto, type UnidadMonto } from "../calc/promocionesGrupo.ts";
import { esPromoConReglas, type TemporadaRango } from "../calc/paquetes.ts";
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
  netoBase: number; valor: number; netoResultante: number | null; motivoNoAplica: string | null;
  /** Solo descuento por habitación y noche: la cuenta se hace sobre la HABITACIÓN completa (como el motor) y el resultado se
   * reparte exacto entre los ocupantes tarifados (`repartirExacto`, igual que la composición de la cotización). */
  habitacion?: { ocupantes: number; baseHabitacion: number; resultadoHabitacion: number; porPersona: number[] };
};
export type PromoDinamica = {
  id: number; nombre: string; tipo: "descuento_pct" | "descuento_monto"; unidad: UnidadMonto | null; prioridad: number;
  estado: "vende" | "no_vende"; motivo: string | null; lineas: LineaPromoDinamica[];
};

const ETIQUETA = Object.fromEntries(ACOMS.map((a) => [a.col, a.etiqueta])) as Record<string, string>;
const ACOM_DE_COL: Record<string, string> = { neto_sencilla: "sencilla", neto_doble: "doble", neto_triple: "triple", neto_multiple: "multiple", neto_nino: "nino", neto_nino2: "nino2", neto_infante: "infante" };
const HABITACION = new Set(["sencilla", "doble", "triple", "multiple"]);
const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const estadoComb = (c: VigenciaPromoFicha["hotel_promocion_combinacion"]) => (Array.isArray(c) ? c[0]?.estado : c?.estado) ?? null;

export function promocionesDinamicasHotel(vigencias: readonly VigenciaPromoFicha[], tarifas: readonly FilaTarifaFicha[], acoms: readonly AcomConfig[] | null | undefined, moneda: string = "COP"): PromoDinamica[] {
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
  return out;
}

/** Roles que ven netos (costo del proveedor); el mismo criterio que `verFinanzas` del contrato. `venta` y externos no. */
export const ROLES_VEN_NETOS = ["superadmin", "gerencia", "administracion", "operaciones"] as const;
