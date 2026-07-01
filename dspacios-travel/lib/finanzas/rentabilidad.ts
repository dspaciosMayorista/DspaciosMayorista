import { createClient } from "@/lib/supabase/server";
import { calcComisionB2B, calcRentabilidad, fiscalFromParams } from "@/lib/calc/finanzas";
import { liquidarFacturacion } from "@/lib/contabilidad/facturacion";
import { getTenant } from "@/lib/tenant.server";

// Fila de rentabilidad por contrato (ya en COP). Fuente ÚNICA usada por el módulo
// Rentabilidad y por Punto de equilibrio, para que el margen neto sea idéntico.
export type RentabilidadFila = {
  numero_contrato: string;
  cliente: string | null;
  asesor: string | null;
  destino: string | null;
  canal: string | null;
  mes: string;
  precioVenta: number;
  ivaGenerado: number;
  ingreso: number;
  costoDirecto: number;
  ivaDescontable: number;
  costoNeto: number;
  utilBruta: number;
  comB2B: number;
  comAsesor: number;
  provIca: number;
  provBomberil: number;
  provFontur: number;
  provRenta: number;
  totalProvisiones: number;
  ivaPorPagar: number;
  utilNeta: number;
  margenNeto: number;
  clasificacion: "Alta" | "Media" | "Baja";
  moneda?: string;
  pvpUsd?: number;
  trm?: number;
  facturacion?: { irt: number; ingresoPropio: number; exento: number };
};

export type TasasProvision = { ica: number; bomberil: number; fontur: number; renta: number; iva: number };

export async function calcularRentabilidad(): Promise<{
  filas: RentabilidadFila[];
  margenNeto: number;   // % (Σ utilNeta / Σ ingreso)
  margenBruto: number;  // % ((Σpvp − Σcosto) / Σpvp)
  totales: { ingreso: number; costoNeto: number; comisiones: number; provisiones: number; ivaPorPagar: number; utilNeta: number; pvp: number; costo: number };
  tasas: TasasProvision;
}> {
  const sb = await createClient();
  const tenant = await getTenant();
  const [{ data: ventas }, { data: b2b }, { data: facturas }, { data: cxp }, { data: asesores }, { data: facturacionCfg }] = await Promise.all([
    sb.from("ventas").select("numero_contrato, cliente, asesor, asesor_firma_nombre, destino, canal, fecha_venta, precio_venta, costo_hotel, costo_aereo, costo_receptivo, costo_asistencia, otros_costos, moneda, trm_contrato").eq("tenant", tenant).order("fecha_venta", { ascending: false }),
    sb.from("aliados_b2b").select("numero_contrato, precio_venta, base_comision, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion"),
    sb.from("facturacion").select("numero_contrato, base_gravable, iva_descontable"),
    sb.from("cuentas_por_pagar").select("numero_contrato, iva_proveedor, clasificacion, valor_total"),
    sb.from("asesores").select("nombre, email, pct_comision_base"),
    sb.from("contrato_facturacion").select("numero_contrato, irt, ingreso_exento"),
  ]);

  const { data: paramsRows } = await sb.from("parametros_tributarios").select("parametro, valor");
  const fiscal = fiscalFromParams(paramsRows ?? []);
  const trmReferencia = Number((paramsRows ?? []).find((p) => p.parametro === "trm_referencia")?.valor) || 0;
  const factorCop = (v: { moneda?: string | null; trm_contrato?: number | null }) =>
    (v.moneda ?? "COP") === "USD" ? (Number(v.trm_contrato) || trmReferencia || 0) : 1;

  const b2bPorContrato = new Map<string, number>();
  for (const r of b2b ?? []) {
    const c = calcComisionB2B({ precioVenta: r.precio_venta, baseComisionable: r.base_comision, pctComision: r.pct_comision, recobroTotal: r.recobro_total, pctRecobroAliado: r.pct_recobro_aliado, aplicaRetencion: r.aplica_retencion, pctRetencion: r.pct_retencion }).totalPagar;
    b2bPorContrato.set(r.numero_contrato, (b2bPorContrato.get(r.numero_contrato) ?? 0) + c);
  }

  const factCfg = new Map((facturacionCfg ?? []).map((c) => [c.numero_contrato, { irt: Number(c.irt) || 0, exento: Number(c.ingreso_exento) || 0 }]));

  // IVA generado (facturas) y descontable (solo CxP clasificadas 'costo').
  const ivaGenPorContrato = new Map<string, number>();
  const ivaDescPorContrato = new Map<string, number>();
  for (const f of facturas ?? []) {
    ivaGenPorContrato.set(f.numero_contrato, (ivaGenPorContrato.get(f.numero_contrato) ?? 0) + (f.base_gravable ?? 0) * fiscal.IVA);
    ivaDescPorContrato.set(f.numero_contrato, (ivaDescPorContrato.get(f.numero_contrato) ?? 0) + (f.iva_descontable ?? 0));
  }
  const irtProvPorContrato = new Map<string, number>();
  for (const c of cxp ?? []) {
    if (((c.clasificacion as string) ?? "costo") === "irt") {
      irtProvPorContrato.set(c.numero_contrato, (irtProvPorContrato.get(c.numero_contrato) ?? 0) + (Number(c.valor_total) || 0));
      continue; // IRT no descuenta IVA
    }
    ivaDescPorContrato.set(c.numero_contrato, (ivaDescPorContrato.get(c.numero_contrato) ?? 0) + (c.iva_proveedor ?? 0));
  }

  const totales = { ingreso: 0, costoNeto: 0, comisiones: 0, provisiones: 0, ivaPorPagar: 0, utilNeta: 0, pvp: 0, costo: 0 };

  const filas: RentabilidadFila[] = (ventas ?? []).map((v) => {
    const f = factorCop(v);
    const costoDirecto = ((v.costo_hotel ?? 0) + (v.costo_aereo ?? 0) + (v.costo_receptivo ?? 0) + (v.costo_asistencia ?? 0) + (v.otros_costos ?? 0)) * f;
    const comB2B = (b2bPorContrato.get(v.numero_contrato) ?? 0) * f;
    const asesorRow = (asesores ?? []).find((a) => a.email === v.asesor || a.nombre === (v.asesor_firma_nombre ?? v.asesor));
    const comAsesor = 0;

    const cfg = factCfg.get(v.numero_contrato);
    const pvpRaw = v.precio_venta ?? 0;
    // IRT en vivo de los proveedores marcados IRT (no del valor guardado).
    const irtLive = irtProvPorContrato.get(v.numero_contrato) ?? 0;
    // El exento se guarda en COP; pvp/irt se convierten a COP (factor) → todo en pesos.
    const liq = cfg ? liquidarFacturacion({ pvp: pvpRaw * f, irt: irtLive * f, ingresoExento: cfg.exento }, fiscal.IVA) : null;
    const baseProvisiones = liq ? liq.ingresoPropio : undefined;
    const ivaGenerado = liq ? liq.ivaGenerado : (ivaGenPorContrato.get(v.numero_contrato) ?? 0);

    const rent = calcRentabilidad({
      precioVenta: pvpRaw * f, costoDirecto, comB2B, comAsesor,
      baseProvisiones, ivaGenerado,
      ivaDescontable: ivaDescPorContrato.get(v.numero_contrato) ?? 0,
      fiscal,
    });

    totales.ingreso += rent.ingreso; totales.costoNeto += rent.costoNeto;
    totales.comisiones += rent.comB2B + rent.comAsesor; totales.provisiones += rent.totalProvisiones;
    totales.ivaPorPagar += rent.ivaPorPagar; totales.utilNeta += rent.utilNeta;
    totales.pvp += pvpRaw * f; totales.costo += costoDirecto;

    return {
      numero_contrato: v.numero_contrato,
      cliente: v.cliente ?? null,
      asesor: (asesorRow?.nombre ?? v.asesor_firma_nombre ?? v.asesor) || null,
      destino: v.destino ?? null,
      canal: v.canal ?? null,
      mes: v.fecha_venta ? String(v.fecha_venta).slice(0, 7) : "",
      precioVenta: rent.precioVenta, ivaGenerado: rent.ivaGenerado, ingreso: rent.ingreso,
      costoDirecto: rent.costoDirecto, ivaDescontable: rent.ivaDescontable, costoNeto: rent.costoNeto,
      utilBruta: rent.utilBruta, comB2B: rent.comB2B, comAsesor: rent.comAsesor,
      provIca: rent.provIca, provBomberil: rent.provBomberil, provFontur: rent.provFontur, provRenta: rent.provRenta,
      totalProvisiones: rent.totalProvisiones, ivaPorPagar: rent.ivaPorPagar, utilNeta: rent.utilNeta,
      margenNeto: rent.margenNeto, clasificacion: rent.clasificacion,
      moneda: (v.moneda as string) ?? "COP",
      pvpUsd: (v.moneda ?? "COP") === "USD" ? (v.precio_venta ?? 0) : undefined,
      trm: (v.moneda ?? "COP") === "USD" ? f : undefined,
      facturacion: liq ? { irt: liq.irt, ingresoPropio: liq.ingresoPropio, exento: liq.ingresoExento } : undefined,
    };
  });

  const margenNeto = totales.ingreso > 0 ? (totales.utilNeta / totales.ingreso) * 100 : 0;
  const margenBruto = totales.pvp > 0 ? ((totales.pvp - totales.costo) / totales.pvp) * 100 : 0;
  const tasas: TasasProvision = { ica: fiscal.ICA, bomberil: fiscal.BOMBERIL, fontur: fiscal.FONTUR, renta: fiscal.RETENCION_RENTA, iva: fiscal.IVA };
  return { filas, margenNeto, margenBruto, totales, tasas };
}
