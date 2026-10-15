// #30 (entrega B) — contrato MANUAL B2B en NETO.
//
// El comprador B2B de un contrato manual elige:
//   · PVP  → paga el total; su comisión queda "Por definir" y se registra a
//            mano en la pestaña Comisiones, exactamente como dejó #38;
//   · NETO → paga PVP − su comisión, ya descontada.
//
// El cálculo es el MISMO de la reserva del tarifario (#38): % del aliado (o el
// parámetro de su tipo) sobre base = max(0, PVP − BNC) — `resolverAliadoReserva`
// + `planComisionReserva`, sin una segunda fórmula. La base lo recalcula en
// `aplicar_neto_contrato_manual` (migración 206), que en UNA transacción
// rebaja el precio y crea la fila de comisión descontada; si no coincide con lo
// que vio el asesor, se niega.
import { resolverAliadoReserva, planComisionReserva } from "@/lib/reservar/comisionReserva";
import type { createClient } from "@/lib/supabase/server";

type Sb = Awaited<ReturnType<typeof createClient>>;

export type ModoCompraManual = "pvp" | "neto";

export type PlanNetoManual = {
  pct: number;
  base: number;
  comision: number;
  /** PVP antes del descuento (ventas.precio_venta con que nace el contrato). */
  pvp: number;
  /** Lo que paga el comprador B2B: PVP − comisión. */
  totalExigible: number;
};

/** Plan NETO de un contrato manual B2B (mismo cálculo que la reserva, #38). */
export async function planNetoContratoManual(
  sb: Sb,
  args: { tipoVenta: string; aliadoId: number | null | undefined; precioVenta: number; impuesto: number },
): Promise<{ ok: true; plan: PlanNetoManual } | { ok: false; error: string }> {
  if (args.tipoVenta !== "agencia" && args.tipoVenta !== "freelance") {
    return { ok: false, error: "Una venta directa no tiene modalidad NETO: cobra el PVP (con o sin descuento comercial)." };
  }
  if (!(Number(args.precioVenta) > 0)) return { ok: false, error: "El contrato NETO necesita un precio de venta mayor a cero." };
  const al = await resolverAliadoReserva(sb, args.tipoVenta, args.aliadoId);
  if (!al.ok) return al;
  const r = planComisionReserva({ modoCompra: "neta", precioVenta: args.precioVenta, impuesto: args.impuesto, pct: al.pct });
  if (!r.ok) return r;
  return {
    ok: true,
    plan: {
      pct: r.plan.pct,
      base: r.plan.base,
      comision: r.plan.comision ?? 0,
      pvp: args.precioVenta,
      totalExigible: r.plan.precioFinal,
    },
  };
}

/** ¿La comisión que vio el asesor es la que se va a descontar? (±1 por redondeo, igual que la base). */
export function comisionCoincide(esperada: number | null | undefined, calculada: number): boolean {
  return esperada != null && Number.isFinite(Number(esperada)) && Math.abs(Number(esperada) - calculada) <= 1;
}

/**
 * El asesor `venta` solo registra en NETO sus propios contratos — misma regla
 * que `soy_ese_asesor` (migración 142): nombre o correo, sin mayúsculas ni
 * espacios sobrantes. Se comprueba ANTES de numerar para no gastar un
 * consecutivo; la base lo vuelve a exigir.
 */
export function esAsesorPropio(
  asesorNombre: string | null | undefined,
  usuario: { nombre?: string | null; email?: string | null } | null | undefined,
): boolean {
  const n = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const a = n(asesorNombre);
  return a !== "" && !!usuario && (a === n(usuario.nombre) || a === n(usuario.email));
}

/**
 * Aplica NETO al contrato recién creado (RPC atómico). El error NUNCA se
 * descarta: quien llama revierte el contrato completo si esto falla.
 */
export async function aplicarNetoContratoManual(
  sb: Sb,
  numero: string,
  aliadoId: number,
  comisionEsperada: number,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  let data: unknown;
  try {
    const r = await sb.rpc("aplicar_neto_contrato_manual", {
      p_numero: numero, p_aliado_id: aliadoId, p_comision_esperada: comisionEsperada,
    });
    if (r.error) return { ok: false, error: r.error.message };
    data = r.data;
  } catch (e) {
    // Un fallo de red/cliente tampoco puede saltarse la reversión del contrato.
    return { ok: false, error: e instanceof Error ? e.message : "error desconocido" };
  }
  if (typeof data !== "number" && typeof data !== "string") {
    return { ok: false, error: "la base no confirmó la comisión descontada" };
  }
  return { ok: true, id: Number(data) };
}
