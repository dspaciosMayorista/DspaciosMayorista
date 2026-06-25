import { createClient } from "@/lib/supabase/server";
import { calcComisionB2B, calcRentabilidad, fiscalFromParams } from "@/lib/calc/finanzas";
import { liquidarFacturacion } from "@/lib/contabilidad/facturacion";
import { RentabilidadList, type RentRow } from "./RentabilidadList";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion"];

export default async function RentabilidadPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Rentabilidad</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Este módulo es de uso interno (administración / gerencia).
        </p>
      </div>
    );
  }

  const [{ data: ventas }, { data: b2b }, { data: facturas }, { data: cxp }, { data: asesores }, { data: facturacionCfg }, { data: provs }] = await Promise.all([
    sb.from("ventas").select("numero_contrato, cliente, asesor, asesor_firma_nombre, destino, canal, fecha_venta, precio_venta, costo_hotel, costo_aereo, costo_receptivo, costo_asistencia, otros_costos, moneda, trm_contrato").order("fecha_venta", { ascending: false }),
    sb.from("aliados_b2b").select("numero_contrato, precio_venta, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion"),
    sb.from("facturacion").select("numero_contrato, base_gravable, iva_descontable"),
    sb.from("cuentas_por_pagar").select("numero_contrato, iva_proveedor, proveedor"),
    sb.from("asesores").select("nombre, email, pct_comision_base"),
    sb.from("contrato_facturacion").select("numero_contrato, irt, ingreso_exento"),
    sb.from("proveedores").select("nombre, clasificacion"),
  ]);

  const { data: paramsRows } = await sb.from("parametros_tributarios").select("parametro, valor");
  const fiscal = fiscalFromParams(paramsRows ?? []);
  // TRM de referencia (fallback para contratos USD sin abonos todavía).
  const trmReferencia = Number((paramsRows ?? []).find((p) => p.parametro === "trm_referencia")?.valor) || 0;
  // Factor de conversión a COP: contratos USD se liquidan a su TRM promedio vigente
  // (ventas.trm_contrato) o, si aún no tiene abonos, a la TRM de referencia.
  const factorCop = (v: { moneda?: string | null; trm_contrato?: number | null }) =>
    (v.moneda ?? "COP") === "USD" ? (Number(v.trm_contrato) || trmReferencia || 0) : 1;

  // Comisión B2B total a pagar por contrato.
  const b2bPorContrato = new Map<string, number>();
  for (const r of b2b ?? []) {
    const c = calcComisionB2B({ precioVenta: r.precio_venta, pctComision: r.pct_comision, recobroTotal: r.recobro_total, pctRecobroAliado: r.pct_recobro_aliado, aplicaRetencion: r.aplica_retencion, pctRetencion: r.pct_retencion }).totalPagar;
    b2bPorContrato.set(r.numero_contrato, (b2bPorContrato.get(r.numero_contrato) ?? 0) + c);
  }
  // Clasificación del proveedor: solo los 'costo' generan IVA descontable; los
  // 'irt' (ingreso para terceros) no son costo propio ni descuentan IVA.
  const clasifProv = new Map((provs ?? []).map((p) => [p.nombre, (p.clasificacion as string) ?? "costo"]));
  // Facturación configurada por contrato (IRT / ingreso exento).
  const factCfg = new Map((facturacionCfg ?? []).map((c) => [c.numero_contrato, { irt: Number(c.irt) || 0, exento: Number(c.ingreso_exento) || 0 }]));

  // IVA generado (de las facturas al cliente) y descontable (de proveedores 'costo').
  const ivaGenPorContrato = new Map<string, number>();
  const ivaDescPorContrato = new Map<string, number>();
  for (const f of facturas ?? []) {
    ivaGenPorContrato.set(f.numero_contrato, (ivaGenPorContrato.get(f.numero_contrato) ?? 0) + (f.base_gravable ?? 0) * fiscal.IVA);
    ivaDescPorContrato.set(f.numero_contrato, (ivaDescPorContrato.get(f.numero_contrato) ?? 0) + (f.iva_descontable ?? 0));
  }
  for (const c of cxp ?? []) {
    if ((clasifProv.get(c.proveedor ?? "") ?? "costo") === "irt") continue; // IRT no descuenta IVA
    ivaDescPorContrato.set(c.numero_contrato, (ivaDescPorContrato.get(c.numero_contrato) ?? 0) + (c.iva_proveedor ?? 0));
  }

  const rows: RentRow[] = (ventas ?? []).map((v) => {
    // Contratos USD → todo a COP a la TRM promedio vigente (PVP, costos y comisión
    // B2B están en la moneda del contrato). IVA generado/descontable también.
    const f = factorCop(v);
    const costoDirecto = ((v.costo_hotel ?? 0) + (v.costo_aereo ?? 0) + (v.costo_receptivo ?? 0) + (v.costo_asistencia ?? 0) + (v.otros_costos ?? 0)) * f;
    const comB2B = (b2bPorContrato.get(v.numero_contrato) ?? 0) * f;
    const asesorRow = (asesores ?? []).find((a) => a.email === v.asesor || a.nombre === (v.asesor_firma_nombre ?? v.asesor));
    // La comisión del asesor interno NO se descuenta por contrato: se liquida en
    // el global (módulo Liquidación) y solo si el asesor cumple su meta.
    const comAsesor = 0;

    // Facturación configurada → provisiones sobre el INGRESO PROPIO (PVP − IRT) y
    // el IVA generado sale de la base gravable del config (no del por defecto).
    const cfg = factCfg.get(v.numero_contrato);
    const pvpRaw = v.precio_venta ?? 0;
    const liq = cfg ? liquidarFacturacion({ pvp: pvpRaw, irt: cfg.irt, ingresoExento: cfg.exento }, fiscal.IVA) : null;
    const baseProvisiones = liq ? liq.ingresoPropio * f : undefined;
    const ivaGenerado = liq ? liq.ivaGenerado * f : (ivaGenPorContrato.get(v.numero_contrato) ?? 0);

    const rent = calcRentabilidad({
      precioVenta: pvpRaw * f, costoDirecto, comB2B, comAsesor,
      baseProvisiones,
      ivaGenerado,
      ivaDescontable: ivaDescPorContrato.get(v.numero_contrato) ?? 0,
      fiscal,
    });
    return {
      numero_contrato: v.numero_contrato,
      cliente: v.cliente ?? null,
      asesor: (asesorRow?.nombre ?? v.asesor_firma_nombre ?? v.asesor) || null,
      destino: v.destino ?? null,
      canal: v.canal ?? null,
      mes: v.fecha_venta ? String(v.fecha_venta).slice(0, 7) : "",
      precioVenta: rent.precioVenta,
      ivaGenerado: rent.ivaGenerado,
      ingreso: rent.ingreso,
      costoDirecto: rent.costoDirecto,
      ivaDescontable: rent.ivaDescontable,
      costoNeto: rent.costoNeto,
      utilBruta: rent.utilBruta,
      comB2B: rent.comB2B,
      comAsesor: rent.comAsesor,
      provIca: rent.provIca,
      provBomberil: rent.provBomberil,
      provFontur: rent.provFontur,
      provRenta: rent.provRenta,
      totalProvisiones: rent.totalProvisiones,
      ivaPorPagar: rent.ivaPorPagar,
      utilNeta: rent.utilNeta,
      margenNeto: rent.margenNeto,
      clasificacion: rent.clasificacion,
      moneda: (v.moneda as string) ?? "COP",
      pvpUsd: (v.moneda ?? "COP") === "USD" ? (v.precio_venta ?? 0) : undefined,
      trm: (v.moneda ?? "COP") === "USD" ? f : undefined,
      facturacion: liq ? { irt: liq.irt * f, ingresoPropio: liq.ingresoPropio * f, exento: liq.ingresoExento * f } : undefined,
    };
  });

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Rentabilidad</h1>
        <p className="mt-1 text-sm text-gray-500">
          Utilidad neta por contrato con las provisiones colombianas (ICA, Bomberil, Fontur, Renta),
          comisiones e IVA. Filtra por asesor, destino, mes o clasificación; abre cada fila para ver el desglose.
        </p>
      </div>
      <RentabilidadList rows={rows} />
    </div>
  );
}
