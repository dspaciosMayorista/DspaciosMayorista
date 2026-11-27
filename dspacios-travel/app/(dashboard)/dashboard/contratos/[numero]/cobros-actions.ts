"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseIdentidad, mensajeSiIdentidad, type IdentidadContrato } from "@/lib/contrato/identidad";
import { revalidatePath } from "next/cache";
import { planDeCuotas, type FrecuenciaCuota } from "@/lib/calc/cuotas";
import { cobroDeVenta } from "@/lib/finanzas/cobro";
import { reglaConfirmacion } from "@/lib/contrato/reglaConfirmacion";
import { cargarAcuerdoMinimo } from "@/lib/contrato/acuerdoMinimo";
import { fechaNegocio } from "@/lib/fechaNegocio";

type Result = { ok: true; n?: number; pagado?: number; pendiente?: number; moneda?: string } | { ok: false; error: string };

// % de abono para confirmar según el tipo de contrato (default 30 % SOLO cuando la base respondió y no hay fila: ausencia verificada).
// R2-1: un error de lectura NO es ausencia — devuelve null y quien llama no genera ningún plan (antes se sustituía por el 30 %).
// identidad:n/a — solo lectura de configuración
async function leerPctAbono(tipoPaquete: string | null): Promise<number | null> {
  const sb = await createClient(); // identidad:n/a — solo lectura
  const { data, error } = await sb.from("config_cobros").select("pct_abono").eq("tipo_paquete", tipoPaquete ?? "").maybeSingle();
  if (error) return null;
  const n = data?.pct_abono == null ? 0.3 : Number(data.pct_abono);
  return Number.isFinite(n) ? n : null;
}

// Genera (o regenera) el plan de cuotas del contrato y lo guarda.
export async function generarPlanCobro(numero: string, frecuencia: FrecuenciaCuota = "mensual", identidad: IdentidadContrato): Promise<Result> {
  const sb = await createClient(parseIdentidad(identidad));
  const { data: venta } = await sb.from("ventas").select("precio_venta, moneda, moneda_cobro, trm_cobro, total_cobro, fecha_salida, tipo_paquete, comision_estado").eq("numero_contrato", numero).maybeSingle();
  if (!venta) return { ok: false, error: "Contrato no encontrado." };

  // #53 (307): el primer pago del plan es el mínimo para CONFIRMAR de la regla ÚNICA (acuerdo de superadmin; condición congelada; % histórico sin condiciones). NETO y PVP igual.
  const cobro = cobroDeVenta(venta);
  // F5: si NO se pudo leer el acuerdo (≠ ausencia verificada) NO se genera ni se guarda ningún plan: se estaría sustituyendo el mínimo que de verdad exige la base.
  const lecturaAcuerdo = await cargarAcuerdoMinimo(numero);
  if (lecturaAcuerdo.estado === "error") return { ok: false, error: "No se pudo verificar el mínimo acordado de este contrato, así que no se generó el plan de cobro. Inténtalo de nuevo." };
  // R2-1: las condiciones congeladas y el % configurado son fuentes del mínimo. Si alguna NO se pudo leer (error ≠ ausencia verificada) no se calcula ni se guarda nada: no se inventa un mínimo.
  const { data: condRows, error: errCond } = await sb.from("contrato_condiciones").select("monto_exigido, moneda, trm").eq("numero_contrato", numero);
  if (errCond) return { ok: false, error: "No se pudieron leer las condiciones de pago del contrato, así que no se generó el plan de cobro. Inténtalo de nuevo." };
  const pctConfig = await leerPctAbono(venta.tipo_paquete);
  if (pctConfig == null) return { ok: false, error: "No se pudo leer el porcentaje de abono configurado, así que no se generó el plan de cobro. Inténtalo de nuevo." };
  const regla = reglaConfirmacion({
    totalCobro: cobro.total, monedaCobro: cobro.moneda === "USD" ? "USD" : "COP",
    condiciones: condRows ?? [], pctLegacy: pctConfig, acuerdo: lecturaAcuerdo.estado === "acuerdo" ? lecturaAcuerdo.acuerdo : null,
  });
  // Mismo criterio de moneda que la base: la regla en USD con cobro en COP se convierte a su TRM congelada.
  const minimoEnCobro = regla.moneda === cobro.moneda ? regla.minimo : regla.moneda === "USD" && regla.trm ? regla.minimo * regla.trm : null;
  const pct = regla.regla === "legacy_pct" || minimoEnCobro == null || cobro.total <= 0 ? pctConfig : Math.min(1, Math.max(0, minimoEnCobro / cobro.total));
  // 235 (#90 F): las cuotas suman el total de COBRO (el convertido y congelado si se cobra en otra moneda), la misma base de abonos y saldo.
  // #42: el plan descuenta lo YA PAGADO. «Pagado» = suma de los abonos reales del contrato (ya en la moneda de cobro; la anulación de un abono lo borra, así que no cuenta); un comprobante
  // subido NO es un pago (vive en soportes_pago). Se lee con el cliente de servicio DESPUÉS de comprobar con la sesión que el usuario ve el contrato (la lectura de arriba): un rol con lectura
  // limitada de abonos (migración 148) vería 0 y generaría un plan completo como si nada se hubiera pagado. Si no se puede leer, no se genera ni se borra nada (mismo criterio que el acuerdo).
  const { data: abonosPagados, error: errPagos } = await createAdminClient().from("abonos").select("valor_abono").eq("numero_contrato", numero); // identidad:n/a — solo lectura del total pagado; el contrato ya se verificó arriba con la sesión (identidad)
  if (errPagos) return { ok: false, error: "No se pudieron leer los pagos del contrato, así que no se generó el plan de cobro. Inténtalo de nuevo." };
  const pagado = (abonosPagados ?? []).reduce((s, a) => s + Number(a.valor_abono ?? 0), 0);
  const moneda: "COP" | "USD" = cobro.moneda === "USD" ? "USD" : "COP";
  const plan = planDeCuotas({ precio: cobro.total, checkIn: venta.fecha_salida, pctAbono: pct, frecuencia, pagado, moneda, hoy: fechaNegocio() });
  if (!plan.length) return { ok: false, error: "No hay valor de venta para armar el plan." };

  // B95-1: el plan se REEMPLAZA en una sola transacción de la base, serializada por contrato (`reemplazar_plan_cobro`, migración 332): dos regeneraciones simultáneas no pueden dejar dos planes,
  // un fallo al insertar o al borrar revierte todo (el contrato conserva el plan que tenía) y, ya con el candado, la base vuelve a comprobar que los pagos, el valor y el acuerdo de mínimo
  // siguen siendo los que se usaron para calcular; si cambiaron, rechaza y se reintenta. Corre con la sesión de quien llama: rigen su RLS y la identidad del contrato.
  const filas = plan.map((c) => ({ tipo: c.tipo, fecha_limite: c.fecha, monto: c.monto }));
  const { data: reemplazo, error } = await (sb as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }> }).rpc("reemplazar_plan_cobro", {
    p_numero: numero,
    p_fuentes: {
      // R2-1: la base DERIVA el total, la moneda efectiva y el % de mínimo con la regla única y los compara con estos; la suma de las cuotas se valida contra el total de la base.
      total: cobro.total, pagado, precio_venta: venta.precio_venta, total_cobro: venta.total_cobro ?? null, fecha_salida: venta.fecha_salida ?? null,
      moneda: venta.moneda ?? null, moneda_cobro: venta.moneda_cobro ?? null, trm_cobro: venta.trm_cobro ?? null, moneda_efectiva: moneda, pct_abono: pct,
      acuerdo_id: lecturaAcuerdo.estado === "acuerdo" ? (lecturaAcuerdo.id ?? null) : null,
    },
    p_filas: filas,
  });
  if (error) {
    if (/PLAN_COBRO_FUENTES_CAMBIARON/.test(error.message)) return { ok: false, error: "Los pagos o el valor del contrato cambiaron mientras se generaba el plan. No se guardó nada: vuelve a generarlo." };
    return { ok: false, error: mensajeSiIdentidad(error) ?? "No se pudo guardar el plan de cobro: se conservó el anterior. Inténtalo de nuevo." };
  }
  if ((reemplazo as { n?: number } | null)?.n !== filas.length) return { ok: false, error: "No se pudo confirmar el plan de cobro. Revisa el contrato antes de volver a intentarlo." };
  revalidatePath(`/dashboard/contratos/${numero}`);
  const tol = moneda === "USD" ? 0.01 : 0.5;
  const pendiente = Math.max(cobro.total - pagado, 0);
  return { ok: true, n: filas.length, pagado, pendiente: pendiente <= tol ? 0 : pendiente, moneda };
}

// #53 (307): fija el mínimo de confirmación de UN contrato pendiente (porcentaje, importe en la moneda de cobro, o el total = 100 %). Solo superadmin: lo decide la base
// (`fijar_minimo_confirmacion`), con la sesión de quien llama para que la auditoría registre al actor. NO confirma el contrato: si los abonos ya alcanzan el nuevo mínimo,
// la ficha muestra «abonos suficientes, confirmación pendiente» y el reintento de siempre lo confirma.
export type ResultadoMinimo = { ok: true; alcanza: boolean; minimo: number; moneda: string } | { ok: false; error: string };
export async function fijarMinimoConfirmacion(
  numero: string,
  tipo: "porcentaje" | "importe" | "total",
  valor: number | null,
  motivo: string | null,
  identidad: IdentidadContrato,
): Promise<ResultadoMinimo> {
  if (tipo !== "total" && !(Number(valor) > 0)) return { ok: false, error: "Indica un valor mayor a cero." };
  const sb = await createClient(parseIdentidad(identidad));
  const { data, error } = await sb.rpc("fijar_minimo_confirmacion", {
    p_numero: numero, p_tipo: tipo, p_valor: tipo === "total" ? null : Number(valor), p_motivo: motivo && motivo.trim() ? motivo.trim() : null,
  });
  if (error) return { ok: false, error: mensajeSiIdentidad(error) ?? error.message };
  const r = (data ?? {}) as { alcanza?: boolean; minimo?: number | string; moneda?: string };
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true, alcanza: r.alcanza === true, minimo: Number(r.minimo) || 0, moneda: r.moneda ?? "COP" };
}

// Configuración del % de abono por tipo (solo superadmin).
// identidad:n/a — configuración global (config_cobros), no es una tabla de contrato
export async function actualizarConfigCobros(tipoPaquete: string, pct: number): Promise<Result> {
  const sb = await createClient(); // identidad:n/a — configuración global
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (perfil?.rol !== "superadmin") return { ok: false, error: "Solo superadmin puede cambiar las reglas de cobro." };
  const p = Math.min(1, Math.max(0, pct));
  const { error } = await sb.from("config_cobros").upsert({ tipo_paquete: tipoPaquete, pct_abono: p, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}
