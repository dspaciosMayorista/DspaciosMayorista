// ─────────────────────────────────────────────────────────────────────────
// Lógica financiera — funciones puras y testeables
// ─────────────────────────────────────────────────────────────────────────
// Portadas 1:1 del Apps Script "System V2" (calcB2B_, calcAsesor_,
// recalcularTodaRentabilidad). Parámetros fiscales en lib/constants.ts.
// ─────────────────────────────────────────────────────────────────────────

import { TRIBUTARIO } from "@/lib/constants";

/** Parámetros fiscales (con posibilidad de override desde la BD). */
export type ParamsFiscales = {
  ICA: number;
  BOMBERIL: number;
  FONTUR: number;
  RETENCION_RENTA: number;
  IVA: number;
  RETENCION_HONORARIOS: number;
};

export const FISCAL_DEFAULT: ParamsFiscales = { ...TRIBUTARIO };

/** Construye los parámetros fiscales desde las filas de parametros_tributarios. */
export function fiscalFromParams(
  rows: { parametro: string; valor: number }[]
): ParamsFiscales {
  const f: ParamsFiscales = { ...FISCAL_DEFAULT };
  for (const r of rows) {
    switch (r.parametro) {
      case "ICA": f.ICA = r.valor; break;
      case "BOMBERIL": f.BOMBERIL = r.valor; break;
      case "FONTUR": f.FONTUR = r.valor; break;
      case "RETENCION_RENTA": f.RETENCION_RENTA = r.valor; break;
      case "IVA": f.IVA = r.valor; break;
      case "RETENCION_HONORARIOS": f.RETENCION_HONORARIOS = r.valor; break;
    }
  }
  return f;
}

// ── Comisión B2B (aliado) ────────────────────────────────────────────────
export type ComisionB2BInput = {
  precioVenta: number;
  pctComision: number; // ej 0.10
  recobroTotal?: number;
  pctRecobroAliado?: number; // def 0.5
  aplicaRetencion?: boolean;
  pctRetencion?: number;
};
export type ComisionB2B = {
  comisionBase: number;
  recobroAliado: number;
  totalComision: number;
  retencion: number;
  totalPagar: number;
};

export function calcComisionB2B(i: ComisionB2BInput): ComisionB2B {
  const pvp = i.precioVenta || 0;
  const pct = i.pctComision || 0;
  const rec = i.recobroTotal || 0;
  const prec = i.pctRecobroAliado ?? 0.5;
  const pret = i.aplicaRetencion ? i.pctRetencion || 0 : 0;
  const comisionBase = pvp * pct;
  const recobroAliado = rec * prec;
  const totalComision = comisionBase + recobroAliado;
  const retencion = totalComision * pret;
  const totalPagar = totalComision - retencion;
  return { comisionBase, recobroAliado, totalComision, retencion, totalPagar };
}

// ── Comisión del asesor ──────────────────────────────────────────────────
export type ComisionAsesorInput = {
  precioVenta: number;
  costoTotal: number;
  comB2BPagada?: number;
  pctBase?: number; // def 0.08
  retHonorarios?: number; // def 0.11
};
export type ComisionAsesor = {
  pctComision: number;
  utilidadNeta: number;
  comisionBruta: number;
  retencion: number;
  comisionNeta: number;
};

export function calcComisionAsesor(i: ComisionAsesorInput): ComisionAsesor {
  const pct = i.pctBase ?? 0.08;
  const retH = i.retHonorarios ?? TRIBUTARIO.RETENCION_HONORARIOS;
  const un = (i.precioVenta || 0) - (i.costoTotal || 0) - (i.comB2BPagada || 0);
  const comisionBruta = Math.max(0, un) * pct;
  const retencion = comisionBruta * retH;
  return {
    pctComision: pct,
    utilidadNeta: un,
    comisionBruta,
    retencion,
    comisionNeta: comisionBruta - retencion,
  };
}

// ── Comisión del asesor SOBRE BASE COMISIONABLE (PVP − BNC) ───────────────
// Regla del negocio: la comisión se calcula sobre la base comisionable, que es
// el PVP menos el BNC (impuesto no comisionable del paquete). Si el contrato no
// tiene BNC, la base es el PVP completo.
//   base = max(0, precioVenta − impuesto) · bruta = base × % · neta = bruta − retención
export type ComisionAsesorBaseInput = {
  precioVenta: number;
  impuesto?: number; // BNC del contrato
  pctBase?: number; // def 0.08
  retHonorarios?: number; // def 0.11
};
export type ComisionAsesorBase = {
  pctComision: number;
  baseComisionable: number;
  comisionBruta: number;
  retencion: number;
  comisionNeta: number;
};

export function calcComisionAsesorBase(i: ComisionAsesorBaseInput): ComisionAsesorBase {
  const pct = i.pctBase ?? 0.08;
  const retH = i.retHonorarios ?? TRIBUTARIO.RETENCION_HONORARIOS;
  const base = Math.max(0, (i.precioVenta || 0) - (i.impuesto || 0));
  const comisionBruta = base * pct;
  const retencion = comisionBruta * retH;
  return {
    pctComision: pct,
    baseComisionable: base,
    comisionBruta,
    retencion,
    comisionNeta: comisionBruta - retencion,
  };
}

// ── Rentabilidad por contrato ────────────────────────────────────────────
export type RentabilidadInput = {
  precioVenta: number;
  costoDirecto: number; // suma de costos del proveedor
  comB2B?: number; // total a pagar comisiones B2B
  comAsesor?: number; // comisión neta del asesor
  ivaGenerado?: number;
  ivaDescontable?: number;
  fiscal?: ParamsFiscales;
};
export type Rentabilidad = {
  precioVenta: number;
  costoDirecto: number;
  comB2B: number;
  comAsesor: number;
  utilBruta: number;
  provIca: number;
  provBomberil: number;
  provFontur: number;
  provRenta: number;
  totalProvisiones: number;
  ivaGenerado: number;
  ivaDescontable: number;
  utilNeta: number;
  margenNeto: number;
  clasificacion: "Alta" | "Media" | "Baja";
};

export function calcRentabilidad(i: RentabilidadInput): Rentabilidad {
  const f = i.fiscal ?? FISCAL_DEFAULT;
  const pvp = i.precioVenta || 0;
  const cd = i.costoDirecto || 0;
  const comB2B = i.comB2B || 0;
  const comAsesor = i.comAsesor || 0;

  const utilBruta = pvp - cd - comB2B - comAsesor;
  const provIca = pvp * f.ICA;
  const provBomberil = provIca * f.BOMBERIL; // sobre el ICA
  const provFontur = Math.max(0, utilBruta) * f.FONTUR; // sobre utilidad bruta
  const provRenta = pvp * f.RETENCION_RENTA;
  const totalProvisiones = provIca + provBomberil + provFontur + provRenta;
  const utilNeta = utilBruta - totalProvisiones;
  const margenNeto = pvp > 0 ? utilNeta / pvp : 0;
  const clasificacion =
    margenNeto >= 0.15 ? "Alta" : margenNeto >= 0.08 ? "Media" : "Baja";

  return {
    precioVenta: pvp,
    costoDirecto: cd,
    comB2B,
    comAsesor,
    utilBruta,
    provIca,
    provBomberil,
    provFontur,
    provRenta,
    totalProvisiones,
    ivaGenerado: i.ivaGenerado || 0,
    ivaDescontable: i.ivaDescontable || 0,
    utilNeta,
    margenNeto,
    clasificacion,
  };
}
