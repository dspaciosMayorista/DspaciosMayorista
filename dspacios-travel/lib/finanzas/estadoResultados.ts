import { createClient } from "@/lib/supabase/server";
import { fiscalFromParams } from "@/lib/calc/finanzas";
import { liquidarFacturacion } from "@/lib/contabilidad/facturacion";
import { liquidarEmpleadoContrato, type ClaseRiesgo } from "@/lib/calc/nomina";

// Estados financieros del periodo (mes YYYY-MM). A diferencia del "estado de
// resultado" por contrato (que es un flujo: PVP total vs todo lo pagado), aquí el
// INGRESO es solo el ingreso propio y el COSTO es el del proveedor 'costo' neto
// de IVA (valor_total − IVA). Por eso se necesita que cada contrato tenga su
// facturación y sus proveedores configurados (validador).

export type ContratoEstado = {
  numero_contrato: string;
  cliente: string | null;
  facturacionOk: boolean;
  totalProveedores: number;
  proveedoresConfig: number;
  completo: boolean;
};

export type EstadosFinancieros = {
  mes: string;
  meses: string[];
  resultados: {
    ingresoPropio: number;
    costoVentas: number;        // proveedores 'costo' netos de IVA
    utilidadBruta: number;
    gastosPersonal: number;     // nómina mensual
    gastosGenerales: number;    // costos fijos + movimientos egresos
    provIca: number; provFontur: number; provBomberil: number;
    totalProvisiones: number;
    utilidadOperacional: number;
    otrosIngresos: number;      // movimientos ingresos
    utilidadAntesImp: number;
    impuestoRenta: number;
    utilidadNeta: number;
    margenNeto: number;         // % sobre ingreso propio
  };
  situacion: {
    cuentasPorCobrar: number;   // cartera (saldo de contratos)
    cuentasPorPagar: number;    // saldo CxP
    ivaPorPagar: number;
    patrimonioResidual: number; // CxCobrar − (CxPagar + IVA)
  };
  validador: { contratos: ContratoEstado[]; completos: number; incompletos: number };
};

function cxpConfigurada(c: { clasificacion: string | null; base_gravable: number | null }): boolean {
  const clasif = (c.clasificacion as string) ?? "costo";
  return clasif === "irt" || c.base_gravable != null; // costo requiere base gravable
}

export async function calcularEstadosFinancieros(mesPedido?: string): Promise<EstadosFinancieros> {
  const sb = await createClient();
  const [{ data: ventas }, { data: cfgs }, { data: cxp }, { data: abonos }, { data: emps }, { data: costos }, { data: movs }, { data: paramsRows }] = await Promise.all([
    sb.from("ventas").select("numero_contrato, cliente, fecha_venta, precio_venta, moneda, trm_contrato"),
    sb.from("contrato_facturacion").select("numero_contrato, irt, ingreso_exento"),
    sb.from("cuentas_por_pagar").select("numero_contrato, valor_total, iva_proveedor, clasificacion, base_gravable, abono1, abono2, abono3"),
    sb.from("abonos").select("numero_contrato, valor_abono"),
    sb.from("pe_empleados").select("*").eq("activo", true),
    sb.from("pe_costos").select("*").eq("activo", true),
    sb.from("contabilidad_movimientos").select("fecha, tipo, valor"),
    sb.from("parametros_tributarios").select("parametro, valor"),
  ]);

  const fiscal = fiscalFromParams(paramsRows ?? []);
  const trmRef = Number((paramsRows ?? []).find((p) => p.parametro === "trm_referencia")?.valor) || 0;
  const factor = (v: { moneda?: string | null; trm_contrato?: number | null }) =>
    (v.moneda ?? "COP") === "USD" ? (Number(v.trm_contrato) || trmRef || 0) : 1;

  // Meses disponibles (de las ventas).
  const meses = Array.from(new Set((ventas ?? []).map((v) => (v.fecha_venta ? String(v.fecha_venta).slice(0, 7) : "")).filter(Boolean))).sort().reverse();
  const ahora = new Date();
  const mes = mesPedido || meses[0] || `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`;

  const cfgMap = new Map((cfgs ?? []).map((c) => [c.numero_contrato, { irt: Number(c.irt) || 0, exento: Number(c.ingreso_exento) || 0 }]));
  const cxpPorContrato = new Map<string, typeof cxp>();
  for (const c of cxp ?? []) {
    const k = c.numero_contrato as string;
    if (!cxpPorContrato.has(k)) cxpPorContrato.set(k, []);
    cxpPorContrato.get(k)!.push(c);
  }

  // ── Estado de resultados del mes ──────────────────────────────────────────
  let ingresoPropio = 0, costoVentas = 0;
  const ventasMes = (ventas ?? []).filter((v) => v.fecha_venta && String(v.fecha_venta).slice(0, 7) === mes);
  for (const v of ventasMes) {
    const f = factor(v);
    const cfg = cfgMap.get(v.numero_contrato);
    if (cfg) {
      const liq = liquidarFacturacion({ pvp: Number(v.precio_venta) || 0, irt: cfg.irt, ingresoExento: cfg.exento }, fiscal.IVA);
      ingresoPropio += liq.ingresoPropio * f;
    }
    for (const c of cxpPorContrato.get(v.numero_contrato) ?? []) {
      if (((c.clasificacion as string) ?? "costo") === "irt") continue;
      const neto = Math.max(0, (Number(c.valor_total) || 0) - (Number(c.iva_proveedor) || 0));
      costoVentas += neto * f;
    }
  }
  const utilidadBruta = ingresoPropio - costoVentas;

  // Gastos operacionales (mensuales).
  const gastosPersonal = (emps ?? []).reduce((a, e) => {
    if ((e.tipo as string) === "servicios") return a + (Number(e.salario) || 0);
    const l = liquidarEmpleadoContrato(Number(e.salario) || 0, !!e.auxilio, (e.riesgo as ClaseRiesgo) || "I", true);
    return a + l.costoTotalMensual;
  }, 0);
  const costosFijos = (costos ?? []).filter((c) => (c.clasificacion as string) === "fijo").reduce((a, c) => a + (Number(c.valor) || 0), 0);
  const movMes = (movs ?? []).filter((m) => m.fecha && String(m.fecha).slice(0, 7) === mes);
  const movEgresos = movMes.filter((m) => (m.tipo as string) === "egreso").reduce((a, m) => a + (Number(m.valor) || 0), 0);
  const otrosIngresos = movMes.filter((m) => (m.tipo as string) === "ingreso").reduce((a, m) => a + (Number(m.valor) || 0), 0);
  const gastosGenerales = costosFijos + movEgresos;

  // Provisiones de ingreso sobre el ingreso propio.
  const provIca = ingresoPropio * fiscal.ICA;
  const provBomberil = provIca * fiscal.BOMBERIL;
  const provFontur = Math.max(0, utilidadBruta) * fiscal.FONTUR;
  const totalProvisiones = provIca + provBomberil + provFontur;

  const utilidadOperacional = utilidadBruta - gastosPersonal - gastosGenerales - totalProvisiones;
  const utilidadAntesImp = utilidadOperacional + otrosIngresos;
  const impuestoRenta = Math.max(0, utilidadAntesImp) * fiscal.RETENCION_RENTA;
  const utilidadNeta = utilidadAntesImp - impuestoRenta;
  const margenNeto = ingresoPropio > 0 ? (utilidadNeta / ingresoPropio) * 100 : 0;

  // ── Estado de situación financiera (borrador, acumulado) ──────────────────
  const abonadoPorContrato = new Map<string, number>();
  for (const a of abonos ?? []) abonadoPorContrato.set(a.numero_contrato as string, (abonadoPorContrato.get(a.numero_contrato as string) ?? 0) + (Number(a.valor_abono) || 0));
  let cuentasPorCobrar = 0;
  for (const v of ventas ?? []) {
    const saldo = (Number(v.precio_venta) || 0) - (abonadoPorContrato.get(v.numero_contrato) ?? 0);
    if (saldo > 0) cuentasPorCobrar += saldo * factor(v);
  }
  let cuentasPorPagar = 0, ivaPorPagar = 0;
  for (const c of cxp ?? []) {
    const pagado = (Number(c.abono1) || 0) + (Number(c.abono2) || 0) + (Number(c.abono3) || 0);
    cuentasPorPagar += Math.max(0, (Number(c.valor_total) || 0) - pagado);
    if (((c.clasificacion as string) ?? "costo") !== "irt") ivaPorPagar += Number(c.iva_proveedor) || 0;
  }
  const patrimonioResidual = cuentasPorCobrar - (cuentasPorPagar + ivaPorPagar);

  // ── Validador de configuración (contratos del mes) ────────────────────────
  const contratos: ContratoEstado[] = ventasMes.map((v) => {
    const lista = cxpPorContrato.get(v.numero_contrato) ?? [];
    const config = lista.filter(cxpConfigurada).length;
    const facturacionOk = cfgMap.has(v.numero_contrato);
    const proveedoresOk = lista.length === 0 || config === lista.length;
    return {
      numero_contrato: v.numero_contrato,
      cliente: v.cliente ?? null,
      facturacionOk,
      totalProveedores: lista.length,
      proveedoresConfig: config,
      completo: facturacionOk && proveedoresOk,
    };
  });
  const completos = contratos.filter((c) => c.completo).length;

  return {
    mes, meses,
    resultados: {
      ingresoPropio, costoVentas, utilidadBruta, gastosPersonal, gastosGenerales,
      provIca, provFontur, provBomberil, totalProvisiones, utilidadOperacional,
      otrosIngresos, utilidadAntesImp, impuestoRenta, utilidadNeta, margenNeto,
    },
    situacion: { cuentasPorCobrar, cuentasPorPagar, ivaPorPagar, patrimonioResidual },
    validador: { contratos, completos, incompletos: contratos.length - completos },
  };
}
