// Comisión B2B de una reserva desde el tarifario (#38).
//
// Antes, reservar insertaba la fila de `aliados_b2b` con el cliente de la
// sesión y descartaba el error: con un asesor `venta` (que convierte
// cotizaciones pero no escribe en `aliados_b2b` por RLS), o sin `aliadoId`, o
// si la lectura del aliado fallaba, el contrato quedaba SIN comisión y nadie
// se enteraba. Ahora:
//   · ANTES de numerar: una reserva B2B exige aliado y que se pueda leer
//     (`resolverAliadoReserva`); el plan de comisión es puro (`planComisionReserva`).
//   · DESPUÉS de crear la venta: la fila la crea `registrar_comision_b2b_reserva`
//     (migración 205, SECURITY DEFINER) que valida en la base usuario, rol,
//     tenant, aliado y venta, recalcula el importe y se niega a duplicar. Si
//     falla, quien llama revierte el contrato completo (nunca queda a medias).
import { pctComisionAliado } from "@/lib/finanzas/comisionB2B";
import { baseComisionableB2B } from "@/lib/calc/finanzas";
import type { createClient } from "@/lib/supabase/server";

type Sb = Awaited<ReturnType<typeof createClient>>;

export type TipoAsesor = "interno" | "agencia" | "freelance";
export type ModoCompra = "neta" | "comisionable";

/** Aliado obligatorio y legible para una reserva B2B; devuelve el % con el que nace. */
export async function resolverAliadoReserva(
  sb: Sb,
  tipoAsesor: TipoAsesor,
  aliadoId: number | null | undefined,
): Promise<{ ok: true; aliadoId: number; pct: number } | { ok: false; error: string }> {
  if (tipoAsesor !== "agencia" && tipoAsesor !== "freelance") {
    return { ok: false, error: "Tipo de venta B2B inválido." };
  }
  if (!(Number.isInteger(aliadoId) && (aliadoId as number) > 0)) {
    return { ok: false, error: `Esta reserva es B2B: falta la ${tipoAsesor} del catálogo. Sin aliado no se puede registrar su comisión.` };
  }
  const { data: al, error } = await sb.from("aliados").select("id, tipo, pct_comision").eq("id", aliadoId as number).maybeSingle();
  if (error) return { ok: false, error: `No se pudo leer el aliado de la reserva (${error.message}).` };
  const aliado = al as { id: number; tipo: string | null; pct_comision: number | null } | null;
  if (!aliado) return { ok: false, error: "El aliado de la reserva no existe en el catálogo." };
  if (aliado.tipo && aliado.tipo !== tipoAsesor) {
    return { ok: false, error: `El aliado elegido es de tipo "${aliado.tipo}", no "${tipoAsesor}".` };
  }
  let valorParametro: unknown = null;
  if (aliado.pct_comision == null) {
    const parametro = tipoAsesor === "agencia" ? "COMISION_AGENCIA" : "COMISION_FREELANCE";
    const { data: p, error: ep } = await sb.from("parametros_tributarios").select("valor").eq("parametro", parametro).maybeSingle();
    // Sin el % del aliado, el parámetro decide: si no se puede leer, no se
    // adivina (la base lo recalcula y no cuadraría).
    if (ep) return { ok: false, error: `No se pudo leer el % de comisión general (${ep.message}).` };
    valorParametro = (p as { valor: unknown } | null)?.valor ?? null;
  }
  return { ok: true, aliadoId: aliado.id, pct: pctComisionAliado(aliado.pct_comision, valorParametro, tipoAsesor) };
}

export type PlanComisionReserva = {
  pct: number;
  base: number;
  /** ventas.comision_b2b (solo con modo de compra). */
  comision: number | null;
  modoCompra: ModoCompra | null;
  /** ventas.comision_estado: 'descontada' (neta) | 'pendiente' (comisionable) | null. */
  comisionEstado: "descontada" | "pendiente" | null;
  /** ventas.precio_venta: en neta, PVP − comisión. */
  precioFinal: number;
};

/** Mismo cálculo que recalcula registrar_comision_b2b_reserva en la base. */
export function planComisionReserva(args: {
  modoCompra: string | null | undefined;
  precioVenta: number;
  impuesto: number;
  pct: number;
}): { ok: true; plan: PlanComisionReserva } | { ok: false; error: string } {
  const modo = args.modoCompra ?? null;
  if (modo !== null && modo !== "neta" && modo !== "comisionable") {
    return { ok: false, error: "Modo de compra B2B inválido." };
  }
  const base = baseComisionableB2B(args.precioVenta, args.impuesto);
  if (modo === null) {
    return { ok: true, plan: { pct: args.pct, base, comision: null, modoCompra: null, comisionEstado: null, precioFinal: args.precioVenta } };
  }
  const comision = Math.round(base * args.pct);
  return {
    ok: true,
    plan: {
      pct: args.pct,
      base,
      comision,
      modoCompra: modo,
      comisionEstado: modo === "neta" ? "descontada" : "pendiente",
      precioFinal: modo === "neta" ? Math.max(0, args.precioVenta - comision) : args.precioVenta,
    },
  };
}

/** Crea la fila de aliados_b2b de la reserva; el error NUNCA se descarta. */
export async function registrarComisionReserva(
  sb: Sb,
  numero: string,
  aliadoId: number,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  let data: unknown;
  try {
    const r = await sb.rpc("registrar_comision_b2b_reserva", { p_numero: numero, p_aliado_id: aliadoId });
    if (r.error) return { ok: false, error: `No se pudo registrar la comisión B2B de la reserva: ${r.error.message}` };
    data = r.data;
  } catch (e) {
    // Un fallo de red/cliente tampoco puede saltarse la reversión del contrato.
    return { ok: false, error: `No se pudo registrar la comisión B2B de la reserva: ${e instanceof Error ? e.message : "error desconocido"}` };
  }
  if (typeof data !== "number" && typeof data !== "string") {
    return { ok: false, error: "No se pudo registrar la comisión B2B de la reserva (sin confirmación de la base)." };
  }
  return { ok: true, id: Number(data) };
}
