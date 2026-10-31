// ─────────────────────────────────────────────────────────────────────────
// Tarifa NETA de un servicio — fuente ÚNICA, SIN la tarifa «GENERAL» como precio.
//
// Un servicio solo se vende con (1) una vigencia (`servicio_temporadas`) que cubra la fecha del viaje y esté en vigencia de compra, y (2) en modo
// grupo, un rango de pasajeros de ESA vigencia que cubra el pax. Antes, cuando no había vigencia o rango, el liquidador caía a
// `servicios_adicionales.precio_persona` / rangos `GENERAL`, e incluso al rango más alto si el pax no entraba (`precioServicio`). Eso se retira:
// aquí no existe ningún valor por defecto. Quien llama decide qué hacer con `ok: false` (nunca inventar un precio).
//
// PURO. Import relativo para correr bajo `node --test`.
// ─────────────────────────────────────────────────────────────────────────
import { temporadaVigenteParaFecha, toTemporadaRango, hoyISO, precioServicio, factorLiquidacion } from "./paquetes.ts";

export type TemporadaServicioFila = {
  nombre: string; fecha_inicio: string | null; fecha_fin: string | null;
  compra_inicio?: string | null; compra_fin?: string | null; prioridad?: number | null;
  precio_persona: number | null; precio_infante?: number | null; recargo_individual?: number | null;
};
export type GrupoServicioFila = { pax_desde: number; pax_hasta: number; precio: number; temporada: string | null };

/**
 * Costo NETO de un servicio del contrato (y por tanto su CxP). Infante: el de LA VIGENCIA aplicable, o el precio de adulto de esa vigencia si no lo
 * define — nunca el `precio_infante` base (GENERAL) del servicio. `recargoIndividual` (1 pax, por persona) llega ya resuelto.
 */
export function costoServicioContrato(i: {
  modo: "persona" | "grupo"; netoPersona: number | null; netoInfanteVigencia: number | null | undefined;
  grupos: { pax_desde: number; pax_hasta: number; precio: number }[];
  paxConSilla: number; numMenoresDeDos: number; liquidacion: string | null | undefined; nochesStay: number;
  totalPax: number; recargoIndividual: number;
}): number {
  const netoInfante = i.netoInfanteVigencia ?? i.netoPersona ?? 0;
  let costo = (precioServicio(i.modo, i.netoPersona, i.grupos, i.paxConSilla) + (i.modo === "persona" ? netoInfante * i.numMenoresDeDos : 0)) * factorLiquidacion(i.liquidacion, i.nochesStay);
  if (i.modo === "persona" && i.totalPax === 1) costo += Math.max(i.recargoIndividual, 0);
  return costo;
}

/** ¿Algún rango cubre exactamente este pax? `precioServicio` cae al rango más alto si no: quien lo llame en modo grupo debe verificar esto antes. */
export function rangoCubrePax(grupos: readonly { pax_desde: number; pax_hasta: number }[], pax: number): boolean {
  return grupos.some((g) => pax >= g.pax_desde && pax <= g.pax_hasta);
}

/**
 * Estimado de PANTALLA del precio de un servicio (el servidor siempre revalida). Por grupo, si ningún rango cubre los pasajeros devuelve null: nunca el
 * del rango más alto que `precioServicio` usaría como último recurso.
 */
export function precioServicioEstimado(
  modo: "persona" | "grupo", precioPersona: number | null | undefined, grupos: { pax_desde: number; pax_hasta: number; precio: number }[], pax: number,
): number | null {
  if (modo === "grupo" && !rangoCubrePax(grupos, pax)) return null;
  return precioServicio(modo, precioPersona, grupos, pax);
}

/** Aviso legible cuando un servicio por grupo no tiene rango para los pasajeros (se muestra en lugar del precio). */
export function avisoSinRango(pax: number): string {
  return `Sin precio para ${pax} pasajero${pax === 1 ? "" : "s"}: ningún rango lo cubre, no se puede cotizar`;
}

export type MotivoSinTarifa =
  | "sin_vigencia"        // ninguna vigencia cubre la fecha del viaje (o no está en vigencia de compra)
  | "sin_precio_persona"  // la vigencia aplica pero no tiene precio por persona
  | "sin_rango_pax";      // modo grupo: la vigencia no tiene un rango que cubra el pax

export type TarifaServicioResuelta =
  | { ok: true; temporada: string; netoPersona: number | null; netoGrupo: number | null; recargoIndividual: number }
  | { ok: false; motivo: MotivoSinTarifa };

export function resolverTarifaServicio(input: {
  temporadas: TemporadaServicioFila[];
  grupos: GrupoServicioFila[];
  modo: "persona" | "grupo";
  pax: number;
  fecha: Date;
  hoy?: string;
}): TarifaServicioResuelta {
  const rangos = input.temporadas.map((t) => toTemporadaRango(t));
  const nombre = rangos.length ? temporadaVigenteParaFecha(input.fecha, rangos, input.hoy ?? hoyISO()) : null;
  if (!nombre) return { ok: false, motivo: "sin_vigencia" };
  const fila = input.temporadas.find((t) => t.nombre === nombre)!;
  const recargoIndividual = Math.max(Number(fila.recargo_individual) || 0, 0);
  if (input.modo === "persona") {
    const p = fila.precio_persona;
    // Un precio 0 es un dato real (servicio sin costo, no genera CxP); lo que falta es el precio. La venta igual exige total > 0.
    if (p == null || !Number.isFinite(Number(p)) || Number(p) < 0) return { ok: false, motivo: "sin_precio_persona" };
    return { ok: true, temporada: nombre, netoPersona: Number(p), netoGrupo: null, recargoIndividual };
  }
  const rango = input.grupos.find((g) => g.temporada === nombre && input.pax >= g.pax_desde && input.pax <= g.pax_hasta);
  if (!rango || !Number.isFinite(Number(rango.precio)) || Number(rango.precio) < 0) return { ok: false, motivo: "sin_rango_pax" };
  return { ok: true, temporada: nombre, netoPersona: null, netoGrupo: Number(rango.precio), recargoIndividual };
}

export const MENSAJE_SIN_TARIFA: Record<MotivoSinTarifa, string> = {
  sin_vigencia: "Este servicio no tiene una vigencia de tarifa para esas fechas.",
  sin_precio_persona: "Este servicio no tiene precio por persona en la vigencia de esas fechas.",
  sin_rango_pax: "Este servicio no tiene un rango de pasajeros que cubra ese número de personas para esas fechas.",
};

// ── Costo NETO completo de un servicio (tarifa de la vigencia + recargo individual + suplementos de franja) ──────────────────────────────────────
// FUENTE ÚNICA: la venta (`liquidacionServicio.ts`) y el costo/CxP (`costosObligacionesCarrito.ts`) llaman a ESTA función, así el precio publicado/
// cotizado y el costo contratado salen de la misma aritmética (el margen se aplica después, sobre el neto que devuelve).
import {
  evaluarSuplementos, tramosConFranja, type FranjaSuplemento, type HorasTramos, type SuplementoAplicado, type TramoTraslado,
} from "./trasladoFranjas.ts";

export type CostoNetoServicio =
  | {
      ok: true; temporada: string;
      /** Neto de la tarifa × factor de liquidación, sin recargo individual ni suplementos. Base de los suplementos porcentuales. */
      netoBase: number;
      recargoIndividual: number;
      suplementos: SuplementoAplicado[];
      netoSuplementos: number;
      /** netoBase + recargo individual (1 pax en modo persona) + suplementos. */
      costoNeto: number;
      /** Tramos con franja cuya hora no se conoce: sus suplementos NO están sumados (solo ocurre con `permitirSinHora`). */
      pendientes: TramoTraslado[];
      /** Tramos que tienen franja en la vigencia aplicable (los que dependen de una hora). Vacío = el precio no depende del horario. */
      tramosConFranja: TramoTraslado[];
    }
  | { ok: false; motivo: MotivoSinTarifa | "franja_invalida" | "hora_requerida" | "costo_invalido"; detalle?: string; pendientes?: TramoTraslado[] };

export function costoNetoServicio(input: {
  temporadas: TemporadaServicioFila[];
  grupos: GrupoServicioFila[];
  /** Franjas por NOMBRE de vigencia (las de la vigencia que resulte aplicable). */
  franjasPorTemporada: Map<string, FranjaSuplemento[]>;
  modo: "persona" | "grupo";
  pax: number;
  fecha: Date;
  liquidacion: string | null | undefined;
  numNoches: number;
  horas?: HorasTramos;
  /** Búsqueda/vitrina: con hora desconocida se devuelve la tarifa SIN el suplemento y se anotan los `pendientes`. Cotizar/contratar: false (falla). */
  permitirSinHora?: boolean;
  hoy?: string;
}): CostoNetoServicio {
  const t = resolverTarifaServicio({ temporadas: input.temporadas, grupos: input.grupos, modo: input.modo, pax: input.pax, fecha: input.fecha, hoy: input.hoy });
  if (!t.ok) return t;
  const factor = factorLiquidacion(input.liquidacion, input.numNoches);
  const netoBase = (input.modo === "persona" ? (t.netoPersona as number) * Math.max(0, input.pax) : (t.netoGrupo as number)) * factor;
  const recargo = input.modo === "persona" && input.pax === 1 ? t.recargoIndividual : 0;
  const franjas = input.franjasPorTemporada.get(t.temporada) ?? [];
  let suplementos: SuplementoAplicado[] = [];
  let pendientes: TramoTraslado[] = [];
  if (franjas.length) {
    const ev = evaluarSuplementos(franjas, input.horas ?? {}, netoBase, input.pax);
    if (!ev.ok) return { ok: false, motivo: "franja_invalida", detalle: ev.detalle };
    if (ev.pendientes.length && !input.permitirSinHora) return { ok: false, motivo: "hora_requerida", pendientes: ev.pendientes };
    suplementos = ev.suplementos;
    pendientes = ev.pendientes;
  }
  const netoSuplementos = suplementos.reduce((s, x) => s + x.neto, 0);
  const costoNeto = netoBase + recargo + netoSuplementos;
  if (!Number.isFinite(costoNeto) || costoNeto < 0) return { ok: false, motivo: "costo_invalido" };
  return { ok: true, temporada: t.temporada, netoBase, recargoIndividual: recargo, suplementos, netoSuplementos, costoNeto, pendientes, tramosConFranja: tramosConFranja(franjas) };
}

export { tramosConFranja };
