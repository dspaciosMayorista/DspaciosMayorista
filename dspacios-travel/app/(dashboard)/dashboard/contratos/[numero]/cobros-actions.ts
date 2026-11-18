"use server";

import { createClient } from "@/lib/supabase/server";
import { parseIdentidad, mensajeSiIdentidad, type IdentidadContrato } from "@/lib/contrato/identidad";
import { revalidatePath } from "next/cache";
import { planDeCuotas, type FrecuenciaCuota } from "@/lib/calc/cuotas";
import { cobroDeVenta } from "@/lib/finanzas/cobro";
import { reglaConfirmacion } from "@/lib/contrato/reglaConfirmacion";
import { cargarAcuerdoMinimo } from "@/lib/contrato/acuerdoMinimo";

type Result = { ok: true; n?: number } | { ok: false; error: string };

// % de abono para confirmar según el tipo de contrato (default 30%).
// identidad:n/a — solo lectura de configuración
export async function pctAbonoDe(tipoPaquete: string | null): Promise<number> {
  const sb = await createClient(); // identidad:n/a — solo lectura
  const { data } = await sb.from("config_cobros").select("pct_abono").eq("tipo_paquete", tipoPaquete ?? "").maybeSingle();
  return data?.pct_abono ?? 0.3;
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
  const { data: condRows } = await sb.from("contrato_condiciones").select("monto_exigido, moneda, trm").eq("numero_contrato", numero);
  const regla = reglaConfirmacion({
    totalCobro: cobro.total, monedaCobro: cobro.moneda === "USD" ? "USD" : "COP",
    condiciones: condRows ?? [], pctLegacy: await pctAbonoDe(venta.tipo_paquete), acuerdo: lecturaAcuerdo.estado === "acuerdo" ? lecturaAcuerdo.acuerdo : null,
  });
  // Mismo criterio de moneda que la base: la regla en USD con cobro en COP se convierte a su TRM congelada.
  const minimoEnCobro = regla.moneda === cobro.moneda ? regla.minimo : regla.moneda === "USD" && regla.trm ? regla.minimo * regla.trm : null;
  const pct = regla.regla === "legacy_pct" || minimoEnCobro == null || cobro.total <= 0 ? await pctAbonoDe(venta.tipo_paquete) : Math.min(1, Math.max(0, minimoEnCobro / cobro.total));
  // 235 (#90 F): las cuotas suman el total de COBRO (el convertido y congelado si se cobra en otra moneda), la misma base de abonos y saldo.
  const plan = planDeCuotas({ precio: cobroDeVenta(venta).total, checkIn: venta.fecha_salida, pctAbono: pct, frecuencia });
  if (!plan.length) return { ok: false, error: "No hay valor de venta para armar el plan." };

  await sb.from("cuotas").delete().eq("numero_contrato", numero);
  const filas = plan.map((c, i) => ({ numero_contrato: numero, orden: i, tipo: c.tipo, fecha_limite: c.fecha, monto: c.monto }));
  const { error } = await sb.from("cuotas").insert(filas);
  if (error) return { ok: false, error: mensajeSiIdentidad(error) ?? error.message };
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true, n: filas.length };
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
