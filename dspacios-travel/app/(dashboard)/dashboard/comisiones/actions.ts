"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { fechaElegidaONegocio } from "@/lib/fechaNegocio";
import {
  ROLES_GESTION_COMISION,
  autorizarComisionB2B,
  autorizarCorreccionAsesor,
  calcularComisionFila,
  esComisionDescontada,
  admiteAbonosB2B,
  prepararEdicionComision,
  type EdicionComisionInput,
  type FilaComisionB2B,
} from "@/lib/finanzas/comisionB2B";

type Result = { ok: true } | { ok: false; error: string };
type Sb = Awaited<ReturnType<typeof createClient>>;

// Quién gestiona (edita, borra, abona) comisiones B2B: superadmin, gerencia y
// administración de la agencia de la comisión — el mismo criterio que la RLS
// de la migración 205. Con `permitirAsesor`, también el asesor `venta` en SU
// contrato (solo para corregir; nunca abonos). La base lo vuelve a exigir;
// esto da el mensaje claro y cubre llamadas directas a la Server Action.
async function cargarComisionAutorizada(sb: Sb, id: number, permitirAsesor = false) {
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol, activo, tenant").eq("id", user.id).maybeSingle()
    : { data: null };
  const { data: fila } = await sb.from("aliados_b2b").select("*").eq("id", id).maybeSingle();
  let auth = autorizarComisionB2B(perfil ?? null, fila?.tenant ?? null, ROLES_GESTION_COMISION);
  let esAsesor = false;
  if (!auth.permitido && permitirAsesor && perfil?.rol === "venta" && fila) {
    const { data: mio } = await sb.rpc("soy_asesor_del_contrato", { num: fila.numero_contrato });
    auth = autorizarCorreccionAsesor(perfil, fila.tenant, mio === true);
    esAsesor = auth.permitido;
  }
  if (!auth.permitido) return { ok: false as const, error: auth.error };
  const { data: venta } = await sb.from("ventas").select("comision_estado").eq("numero_contrato", fila!.numero_contrato).maybeSingle();
  const { data: unAbono } = await sb.from("comision_b2b_pagos").select("id").eq("aliado_b2b_id", id).limit(1);
  return {
    ok: true as const,
    fila: fila as FilaComisionB2B & { tenant: string },
    descontada: esComisionDescontada(fila!, venta?.comision_estado ?? null),
    // Ni la descontada ni otra fila B2B de un contrato NETO admiten abonos nuevos.
    admiteAbonos: admiteAbonosB2B(fila!, venta?.comision_estado ?? null),
    // Para `venta` la RLS no deja leer abonos ni `ventas`: estos dos llegan en
    // falso/null y el trigger de la 205 es quien lo decide (con su mensaje).
    conAbonos: (unAbono ?? []).length > 0,
    esAsesor,
  };
}

// Registra un abono/pago parcial a una comisión B2B (log ilimitado en
// `comision_b2b_pagos`, migración 131 — reemplaza el viejo "marcar pagada"
// todo-o-nada). El estado (pendiente/parcial/pagada) ya no se guarda en
// `aliados_b2b.estado`: se deriva en la página de la suma de estos pagos.
export async function registrarPagoComisionB2B(aliadoB2bId: number, valor: number, fecha: string): Promise<Result> {
  if (!(valor > 0)) return { ok: false, error: "El valor del abono debe ser mayor a 0." };
  const sb = await createClient();
  const c = await cargarComisionAutorizada(sb, aliadoB2bId);
  if (!c.ok) return c;
  // NETO: la agencia ya la descontó del precio; un abono la pagaría otra vez.
  if (c.descontada) {
    return { ok: false, error: "Esta comisión se descontó del precio de venta (modo neta): no admite abonos." };
  }
  // Otra fila B2B de un contrato vendido en modo neta: la comisión B2B del
  // aliado ya está descontada del precio; no corresponde pagar otra (decisión
  // del dueño). La base lo vuelve a exigir (trigger de la 205). La comisión del
  // asesor interno es aparte (liquidación) y no pasa por aquí.
  if (!c.admiteAbonos) {
    return { ok: false, error: "Este contrato se vendió en modo neta: la comisión B2B ya se descontó del precio y no admite abonos B2B. Revisa esta fila manualmente." };
  }
  // El tenant se toma de la comisión misma (no de la cookie de sesión activa),
  // mismo criterio que crearComisionB2B/crearCuentaPorPagar: si queda mal
  // (default 'mayorista'), el abono se guarda pero desaparece de
  // /dashboard/comisiones en la agencia real (esa consulta filtra por tenant).
  const { error } = await sb.from("comision_b2b_pagos").insert({
    aliado_b2b_id: aliadoB2bId,
    valor,
    fecha: fechaElegidaONegocio(fecha),
    tenant: c.fila.tenant,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/comisiones");
  return { ok: true };
}

// Deshace el último abono registrado a una comisión B2B.
export async function deshacerUltimoPagoComisionB2B(aliadoB2bId: number): Promise<Result> {
  const sb = await createClient();
  const c = await cargarComisionAutorizada(sb, aliadoB2bId);
  if (!c.ok) return c;
  const { data: ultimo, error: eSel } = await sb
    .from("comision_b2b_pagos")
    .select("id")
    .eq("aliado_b2b_id", aliadoB2bId)
    .order("fecha", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (eSel) return { ok: false, error: eSel.message };
  if (!ultimo) return { ok: false, error: "No hay abonos para deshacer." };
  const { error } = await sb.from("comision_b2b_pagos").delete().eq("id", ultimo.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/comisiones");
  return { ok: true };
}

// Edita la base comisionable, el % (o el valor en pesos) y el recobro de una
// comisión B2B. Las reglas (base vacía = sin base, 0 explícito = 0, % 0
// legítimo vs. vacío, valor al peso, base ≤ PVP) viven en
// prepararEdicionComision (lib/finanzas/comisionB2B.ts, pura y probada).
//   - recobro_total: el mayor valor cobrado sobre la tarifa neta (nunca visible al
//     cliente); pct_recobro_aliado = qué % de ese recobro le corresponde al aliado.
//     recobroAliado SE SUMA a la comisión total — ya lo hace calcComisionB2B() —
//     y por eso también entra como gasto en Rentabilidad.
// Una comisión con abonos, o descontada en el precio, no puede cambiar de
// total: se avisa aquí y la base lo impide igual (trigger de la 205).
export async function actualizarComisionB2B(id: number, input: EdicionComisionInput): Promise<Result> {
  const sb = await createClient();
  // El asesor `venta` también corrige la comisión de SU contrato (antes de abonos).
  const c = await cargarComisionAutorizada(sb, id, true);
  if (!c.ok) return c;
  if (c.esAsesor && c.descontada) return { ok: false, error: "Esta comisión se descontó del precio de venta: no se edita." };
  // El asesor corrige solo ANTES de abonos (con abonos, nada: ni siquiera un
  // cambio que conserve el total). Si la RLS le oculta los abonos, el trigger
  // de la 205 lo rechaza con el mismo criterio.
  if (c.esAsesor && c.conAbonos) return { ok: false, error: "Esta comisión ya tiene abonos: solo administración puede cambiarla." };
  const prep = prepararEdicionComision(c.fila, input);
  if (!prep.ok) return prep;
  if (c.conAbonos || c.descontada) {
    const antes = calcularComisionFila(c.fila).totalPagar;
    const despues = calcularComisionFila({ ...c.fila, ...prep.cambios }).totalPagar;
    if (Math.abs(antes - despues) >= 0.005) {
      return {
        ok: false,
        error: c.descontada
          ? "Esta comisión se descontó del precio de venta: su total no se puede cambiar."
          : "Esta comisión ya tiene abonos: el cambio alteraría su total. Deshaz los abonos primero.",
      };
    }
  }
  const { data, error } = await sb.from("aliados_b2b").update(prep.cambios).eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "No se pudo guardar: comisión no encontrada o sin permiso." };
  revalidatePath("/dashboard/comisiones");
  revalidatePath("/dashboard/rentabilidad");
  revalidatePath(`/dashboard/contratos/${c.fila.numero_contrato}`);
  return { ok: true };
}
