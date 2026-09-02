"use server";

// ─────────────────────────────────────────────────────────────────────────
// Pagos previos de una cotización (migración 164) — corrección del Commit 4
// (auditoría A1/A2/A3).
//
// Un "pago previo" es un pre-pago MANUAL que un rol autorizado
// (superadmin/administracion/gerencia/operaciones — NUNCA venta ni externos)
// registra sobre una cotización abierta, ANTES de convertirla en contrato.
// No hay pasarela de pagos: el dinero se recibe por fuera (consignación/efectivo)
// y aquí solo se deja la constancia contable + la congelación del snapshot de
// condiciones en el PRIMER pago.
//
// ⚠️ Diseño (A2): TODO el trabajo con estado — escribir `cotizacion_condiciones`,
// guardar el resumen exigido, estampar `condicion_pago_congelada_en`/TRM/precio,
// insertar el pago y postear el asiento 280510 — ocurre en UN solo RPC /
// transacción PostgreSQL (`registrar_pago_previo`), que hace `FOR UPDATE` de la
// cotización y RE-lee estado/congelado antes de decidir. Aquí NO hay secuencias
// REST parciales ni compensaciones best-effort: o todo se persiste, o PostgreSQL
// revierte todo. Esta Server Action solo autoriza (rol/tenant/estado), calcula el
// snapshot por componente (lectura pura) cuando la cotización aún NO está
// congelada, y entrega ese snapshot como `jsonb` al RPC.
//
// ⚠️ Diseño (A1): la idempotencia la decide una CLAVE DE INTENTO generada en el
// cliente al iniciar el pago. El cliente la CONSERVA ante un resultado ambiguo
// (timeout/pérdida de respuesta/reintento) y la ROTA solo tras éxito confirmado
// o al iniciar conscientemente OTRO pago (su `signature` cambia). El RPC, ante
// una clave ya usada con idéntica identidad (cotización+moneda+monto+forma),
// devuelve el resultado ORIGINAL sin insertar ni pago ni asiento; con identidad
// distinta → rechazo cerrado.
//
// ⚠️ Alcance del Commit 4: el congelado por componente solo está resuelto para
// cotizaciones MANUALES. Las de tarifario/single y carrito llegan con la
// conversión a contrato único (Commit 5) — este commit las RECHAZA.
//
// ⚠️ Tipado: opera vía el cliente tipado BASE (`createAdminClient`); la
// superficie de la migración 164 vive en `types/database.ts`.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLES_CONTRATO_COMPLETO } from "@/lib/roles";
import { construirSnapshot } from "@/lib/cotizacion/snapshotCondiciones";
import { componentesDeManual } from "@/lib/cotizacion/componentesManual";
import type { ServicioManualCondicionable } from "@/lib/cotizacion/componentesManual";
import type { Json } from "@/types/database";
import { revalidatePath } from "next/cache";

// La misma lista que `_autorizado_pago_previo` en la migración 164:
// ('superadmin','administracion','gerencia','operaciones').
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

/** Redondeo monetario de 2 decimales. */
const redondear2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Mensajes de error "seguros" para el navegador: nunca fugan detalles internos
 * de PostgreSQL (SQLSTATE, nombres de constraint, nombre de relación, etc.).
 * Los `raise exception` de nuestra propia función son frases en español limpias
 * y pasan tal cual; solo se enmascara lo que parezca error crudo de la BD.
 */
function mensajeSeguro(msg: string): string {
  const m = String(msg ?? "").trim();
  if (!m) return "No se pudo registrar el pago. Inténtalo de nuevo.";
  if (/(duplicate key|violates (foreign key|not-null|check) constraint|constraint "|relation "|pg_|sqlstate|serialization failure|contradice la política|new row violates)/i.test(m)) {
    return "No se pudo registrar el pago por un conflicto de datos. Reintenta; si persiste, verifica que no ya esté registrado.";
  }
  return m;
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

/**
 * Registra un pago previo. `idempotencyKey` entra como `unknown` y se valida en
 * el límite (ver A1): la clave la genera el cliente y este servidor solo la
 * acepta como string no vacía. Reenviar la MISMA clave tras un resultado
 * ambiguo recupera el pago original; con identidad distinta el RPC la rechaza.
 */
export async function registrarPagoPrevio(
  cotizacionId: number,
  input: RegistrarPagoPrevioInput,
  idempotencyKey: unknown,
): Promise<{ ok: boolean; error?: string; pagoId?: number }> {
  const sesion = await sesionPagoAutorizada();
  if (!sesion) {
    return { ok: false, error: "No autorizado: los pagos previos requieren superadmin/administración/gerencia/operaciones." };
  }

  // ── clave de idempotencia: validación estricta en el límite ──
  const key = typeof idempotencyKey === "string" && idempotencyKey.trim().length > 0 ? idempotencyKey.trim() : null;
  if (!key) {
    return { ok: false, error: "Falta la clave de idempotencia del pago. Recarga la página e inténtalo de nuevo." };
  }

  // ── validación estricta de entrada (nunca confiar en el navegador) ──
  const valor = redondear2(Number(input?.valor) || 0);
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
  // La TRM del día solo congela si es el PRIMER pago; después manda la congelada.
  const trm = moneda === "COP" ? 1 : Number(input?.trm);
  if (moneda !== "COP" && !(trm > 0)) {
    return { ok: false, error: "Indica la TRM del día para el pago (cotización en USD)." };
  }

  // ── alcance del Commit 4: solo cotizaciones manuales ──
  if ((cot.tipo as string) !== "manual") {
    return {
      ok: false,
      error: "En esta etapa los pagos previos solo aplican a cotizaciones manuales; las de tarifario/carrito llegan con la conversión a contrato único.",
    };
  }

  // ── snapshot del PRIMER pago: se calcula (lectura pura) SOLO si aún no está
  //    congelada. El RPC lo persiste de forma atómica; si ya está congelada, se
  //    reutiliza el snapshot/TRM guardados (no se envía nada).
  const yaCongelada = Boolean(cot.condicion_pago_congelada_en);
  let snapshotJson: Json | undefined;
  let exigidoTotalMoneda: number | undefined;
  let pctEfectivo: number | undefined;

  if (!yaCongelada) {
    const precioTotalMoneda = redondear2(Number(cot.precio_venta) || 0);
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
    // Objeto JSON plano (solo valores JSON) — claves que el RPC 164 espera.
    const filas = snapshot.filas.map((f) => ({
      orden: f.orden,
      tipo_componente: f.tipo_componente,
      referencia_externa: f.referencia_externa ?? null,
      valor_componente: f.valor_componente,
      condicion_pago_tipo: f.condicion_pago_tipo,
      condicion_pago_pct_aplicable: f.condicion_pago_pct_aplicable ?? null,
      condicion_pago_dias_saldo: f.condicion_pago_dias_saldo ?? null,
      condicion_pago_fecha_limite: f.condicion_pago_fecha_limite ?? null,
      monto_exigido: f.monto_exigido,
      restriccion_comercial: f.restriccion_comercial,
      hotel_temporada_id: f.hotel_temporada_id ?? null,
    }));
    snapshotJson = filas as unknown as Json;
    exigidoTotalMoneda = redondear2(snapshot.resumen.monto_exigido_total);
    pctEfectivo = snapshot.resumen.pct_efectivo_informativo ?? undefined;
  }

  // ── RPC de dinero ÚNICO y atómico: persiste snapshot/resumen/congelado/pago/asiento ──
  const rpc = await admin.rpc("registrar_pago_previo", {
    p_cotizacion_id: cotizacionId,
    p_valor: valor,
    p_moneda: moneda,
    p_trm: trm,
    p_forma_pago: formaPago,
    p_referencia: referencia,
    p_fecha_pago: fechaPago,
    p_usuario_id: sesion.userId,
    p_idempotency_key: key,
    ...(snapshotJson !== undefined
      ? { p_snapshot: snapshotJson, p_exigido_total_moneda: exigidoTotalMoneda, p_pct_efectivo: pctEfectivo }
      : {}),
  });
  if (rpc.error) {
    return { ok: false, error: mensajeSeguro(rpc.error.message) };
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
  if (rpc.error) return { ok: false, error: mensajeSeguro(rpc.error.message) };

  revalidatePath(`/dashboard/cotizaciones/${pago.cotizacion_id}`);
  revalidatePath("/dashboard/cotizaciones");
  return { ok: true };
}
