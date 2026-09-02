"use server";

// ─────────────────────────────────────────────────────────────────────────
// Pagos previos de una cotización (migración 164) — Commit 4.
//
// Un "pago previo" es un pre-pago MANUAL que un rol autorizado
// (superadmin/administracion/gerencia/operaciones — NUNCA venta ni externos)
// registra sobre una cotización abierta, ANTES de convertirla en contrato.
// No hay pasarela de pagos: el dinero se recibe por fuera (consignación/efectivo)
// y aquí solo se deja la constancia contable + la congelación del snapshot de
// condiciones en el PRIMER pago.
//
// Congelado (solo en el primer pago): se deriva el snapshot de condiciones por
// componente (`cotizacion_condiciones`) y el resumen agregado (`monto_exigido_
// total(_cop)`/`pct_efectivo_informativo`) en `cotizaciones`. El ORDEN importa:
// el trigger 164 bloquea alterar las filas congeladas una vez que la cotización
// estampa `condicion_pago_congelada_en`, así que primero se escriben filas +
// resumen (con `congelada_en` todavía NULL) y DESPUÉS se llama al RPC de dinero
// `registrar_pago_previo`, que es quien estampa `condicion_pago_congelada_en`.
//
// Los tres RPC de dinero (registrar/anular/transferir) solo están otorgados a
// `service_role` y vuelven a validar rol + tenant + estado + FOR UPDATE (defensa
// en profundidad). Aquí la Server Action autoriza en TS contra la MISMA lista
// (`ROLES_CONTRATO_COMPLETO`) y verifica el tenant antes de tocar nada.
//
// ⚠️ Alcance del Commit 4: el congelado por componente solo está resuelto para
// cotizaciones MANUALES (sus valores por servicio están guardados de forma
// limpia). Las de tarifario/single y carrito guardan un PVP fundido (sin split
// hotel/vuelo) y llegan con la conversión a contrato único (Commit 5) — este
// commit las RECHAZA en vez de congelar un desglose equivocado.
//
// ⚠️ Tipado: opera las tablas de la 164 vía el cliente tipado BASE
// (`createAdminClient`) — la superficie de la migración 164 vive en
// `types/database.ts` (columnas aditivas + tablas + RPC), no en un tipo aparte.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLES_CONTRATO_COMPLETO } from "@/lib/roles";
import { construirSnapshot } from "@/lib/cotizacion/snapshotCondiciones";
import { componentesDeManual } from "@/lib/cotizacion/componentesManual";
import type { ServicioManualCondicionable } from "@/lib/cotizacion/componentesManual";
import { revalidatePath } from "next/cache";

// La misma lista que `_autorizado_pago_previo` en la migración 164:
// ('superadmin','administracion','gerencia','operaciones'). Reutilizamos
// ROLES_CONTRATO_COMPLETO (es exactamente ese set) como única fuente en código.
const ROLES_PAGO = new Set<string>(ROLES_CONTRATO_COMPLETO as string[]);

/** Sesión de un rol autorizado, con su tenant real (o null si no autorizado). */
async function sesionPagoAutorizada(): Promise<{
  userId: string;
  email: string | null;
  rol: string;
  tenant: string;
} | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await sb
    .from("usuarios")
    .select("rol, tenant")
    .eq("id", user.id)
    .maybeSingle();
  if (!perfil || !perfil.rol || !ROLES_PAGO.has(perfil.rol)) return null;
  return { userId: user.id, email: user.email ?? null, rol: perfil.rol, tenant: perfil.tenant ?? "mayorista" };
}

export interface RegistrarPagoPrevioInput {
  /** Monto pagado en la MONEDA de la cotización (COP para COP; USD para USD). */
  valor: number;
  moneda: string;
  /** TRM del día, obligatoria si la cotización es USD (para convertir a COP). */
  trm?: number;
  formaPago: string;
  referencia?: string;
  /** Fecha del pago (default: hoy). */
  fechaPago?: string;
}

export async function registrarPagoPrevio(
  cotizacionId: number,
  input: RegistrarPagoPrevioInput,
): Promise<{ ok: boolean; error?: string; pagoId?: number }> {
  const sesion = await sesionPagoAutorizada();
  if (!sesion) {
    return { ok: false, error: "No autorizado: los pagos previos requieren superadmin/administración/gerencia/operaciones." };
  }

  // ── validación estricta de entrada (nunca confiar en el navegador) ──
  const valor = Math.round((Number(input?.valor) || 0) * 100) / 100;
  if (!(valor > 0)) return { ok: false, error: "El valor del pago debe ser mayor a cero." };
  const formaPago = String(input?.formaPago ?? "").trim();
  if (!formaPago) return { ok: false, error: "Indica la forma de pago." };
  const referencia = String(input?.referencia ?? "").trim();
  const fechaPago = String(input?.fechaPago ?? "") || new Date().toISOString().slice(0, 10);

  const admin = createAdminClient();

  // ── la cotización, su estado, su tenant y su moneda ──
  const { data: cot } = await admin
    .from("cotizaciones")
    .select("*")
    .eq("id", cotizacionId)
    .maybeSingle();
  if (!cot) return { ok: false, error: "La cotización no existe." };
  if (cot.estado !== "abierta") return { ok: false, error: "Solo se pueden registrar pagos previos en una cotización abierta." };
  if (cot.tenant !== sesion.tenant && sesion.rol !== "superadmin") {
    return { ok: false, error: "La cotización pertenece a otra agencia." };
  }
  const moneda = (cot.moneda ?? "COP") as string;
  if (input?.moneda && input.moneda !== moneda) {
    return { ok: false, error: "La moneda del pago no coincide con la de la cotización." };
  }
  // El monto que paga la función es en COP; para USD se convierte con la TRM.
  const trm = moneda === "COP" ? 1 : Number(input?.trm);
  if (moneda !== "COP" && !(trm > 0)) {
    return { ok: false, error: "Indica la TRM del día para el pago (cotización en USD)." };
  }
  const montoCop = Math.round((moneda === "COP" ? valor : valor * trm) * 100) / 100;

  // ── alcance del Commit 4: solo cotizaciones manuales ──
  if ((cot.tipo as string) !== "manual") {
    return {
      ok: false,
      error: "En esta etapa los pagos previos solo aplican a cotizaciones manuales; las de tarifario/carrito llegan con la conversión a contrato único.",
    };
  }

  // ── congelado del snapshot en el PRIMER pago ──
  // (solo cuando aún no está congelada la cotización; si ya lo está, los
  // montos exigidos ya quedaron escritos y no se vuelven a calcular).
  if (!cot.condicion_pago_congelada_en) {
    // Idempotencia: si un intento anterior dejó filas/resumen sin llegar al RPC
    // (fallo a mitad), se re-emite desde cero — la cotización sigue sin congelar.
    await admin.from("cotizacion_condiciones").delete().eq("cotizacion_id", cotizacionId);

    const precioTotalMoneda = Math.round((Number(cot.precio_venta) || 0) * 100) / 100;
    const { data: servicios } = await admin
      .from("cotizacion_servicios")
      .select("id, tipo_servicio, valor, nombre_servicio")
      .eq("cotizacion_id", cotizacionId)
      .order("orden");
    const componentes = componentesDeManual(
      (servicios ?? []) as ServicioManualCondicionable[],
      cot.fecha_salida as string | null,
    );
    const snapshot = construirSnapshot(componentes, { fechaPago, precioTotalMoneda, trm });

    // Se escriben las filas ANTES de que el RPC estampe `condicion_pago_congelada_en`
    // (el trigger 164 las bloquearía después). Los campos string del snapshot son
    // subtipos de los `string` del Row base → asignación directa, sin cast.
    const filas = snapshot.filas.map((f) => ({
      cotizacion_id: cotizacionId,
      orden: f.orden,
      tipo_componente: f.tipo_componente,
      referencia_externa: f.referencia_externa,
      paquete_id: null,
      programa_id: null,
      hotel_temporada_id: f.hotel_temporada_id,
      valor_componente: f.valor_componente,
      condicion_pago_tipo: f.condicion_pago_tipo,
      condicion_pago_pct_aplicable: f.condicion_pago_pct_aplicable,
      condicion_pago_dias_saldo: f.condicion_pago_dias_saldo,
      condicion_pago_fecha_limite: f.condicion_pago_fecha_limite,
      monto_exigido: f.monto_exigido,
      restriccion_comercial: f.restriccion_comercial,
      congelado: true,
    }));
    if (filas.length) {
      const { error: errFilas } = await admin.from("cotizacion_condiciones").insert(filas);
      if (errFilas) {
        await admin.from("cotizacion_condiciones").delete().eq("cotizacion_id", cotizacionId);
        return { ok: false, error: `No se pudo congelar el desglose: ${errFilas.message}` };
      }
    }
    const { error: errResumen } = await admin
      .from("cotizaciones")
      .update({
        monto_exigido_total: snapshot.resumen.monto_exigido_total,
        monto_exigido_total_cop: snapshot.resumen.monto_exigido_total_cop,
        pct_efectivo_informativo: snapshot.resumen.pct_efectivo_informativo,
      })
      .eq("id", cotizacionId);
    if (errResumen) {
      // rollback del snapshot parcial: no dejar exigidos sin su congelación
      await admin.from("cotizacion_condiciones").delete().eq("cotizacion_id", cotizacionId);
      await admin
        .from("cotizaciones")
        .update({ monto_exigido_total: null, monto_exigido_total_cop: null, pct_efectivo_informativo: null })
        .eq("id", cotizacionId);
      return { ok: false, error: `No se pudo escribir el resumen exigido: ${errResumen.message}` };
    }
  }

  // ── RPC de dinero: registra el pago y (si era el primero) estampa el congelado ──
  const rpc = await admin.rpc("registrar_pago_previo", {
    p_cotizacion_id: cotizacionId,
    p_monto_cop: montoCop,
    p_moneda: moneda,
    p_trm: trm,
    p_forma_pago: formaPago,
    p_referencia: referencia,
    p_fecha_pago: fechaPago,
    p_usuario_id: sesion.userId,
  });
  if (rpc.error) {
    return { ok: false, error: rpc.error.message };
  }
  const txt = String(rpc.data ?? "");
  const pagoId = txt.startsWith("OK|") ? Number(txt.slice(3)) : undefined;

  revalidatePath(`/dashboard/cotizaciones/${cotizacionId}`);
  revalidatePath("/dashboard/cotizaciones");
  return { ok: true, pagoId };
}

export async function anularPagoPrevio(
  pagoId: number,
  motivo?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(Number(pagoId) > 0)) return { ok: false, error: "Pago inválido." };
  const sesion = await sesionPagoAutorizada();
  if (!sesion) {
    return { ok: false, error: "No autorizado: los pagos previos requieren superadmin/administración/gerencia/operaciones." };
  }
  const admin = createAdminClient();

  // Verificación de tenant ANTES del RPC (el RPC vuelve a validar rol, pero la
  // propiedad por agencia la decide aquí).
  const { data: pago } = await admin
    .from("cotizacion_pagos_previos")
    .select("cotizacion_id, tenant, estado")
    .eq("id", pagoId)
    .maybeSingle();
  if (!pago) return { ok: false, error: "El pago no existe." };
  if (pago.tenant !== sesion.tenant && sesion.rol !== "superadmin") {
    return { ok: false, error: "El pago pertenece a otra agencia." };
  }
  if (pago.estado !== "activo") {
    return { ok: false, error: "Solo se pueden anular pagos previos activos." };
  }

  const rpc = await admin.rpc("anular_pago_previo", {
    p_pago_id: pagoId,
    p_motivo: String(motivo ?? "").trim() || null,
    p_usuario_id: sesion.userId,
  });
  if (rpc.error) return { ok: false, error: rpc.error.message };

  revalidatePath(`/dashboard/cotizaciones/${pago.cotizacion_id}`);
  revalidatePath("/dashboard/cotizaciones");
  return { ok: true };
}
