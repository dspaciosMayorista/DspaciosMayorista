"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant.server";
import { numeroConTenant } from "@/lib/tenant";
import { parseUtilidades, parsePagos } from "@/lib/minorista/importMinorista";

type Result =
  | { ok: true; resumen: string; notas: string[] }
  | { ok: false; error: string };

const PLACEHOLDER_CLIENTE = "(Sin titular)";

function lotes<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// CANDADO de seguridad: la importación SOLO se permite en la agencia minorista.
// Si se corriera en mayorista, los números 00-XXXX colisionarían con su PK.
async function tenantMinoristaOFalla(): Promise<
  { ok: true; tenant: "minorista" } | { ok: false; error: string }
> {
  const tenant = await getTenant();
  if (tenant !== "minorista")
    return {
      ok: false,
      error:
        "Estás en la agencia Mayorista. Cambia a Minorista (arriba a la izquierda) antes de importar el histórico.",
    };
  return { ok: true, tenant };
}

// ── 1) RELACIÓN DE UTILIDADES → ventas (costos) ─────────────────────────────
export async function importarUtilidades(texto: string): Promise<Result> {
  const gate = await tenantMinoristaOFalla();
  if (!gate.ok) return gate;
  const tenant = gate.tenant;

  const { filas, notas } = parseUtilidades(texto);
  if (!filas.length)
    return { ok: false, error: "No se detectaron filas. Pega el bloque copiado de la hoja “Relación de utilidades”." };

  const sb = createAdminClient();
  const numeros = filas.map((f) => numeroConTenant(f.numero, tenant));

  // Preserva cliente/asesor/documento que ya pudo poner la hoja de pagos.
  const { data: existentes } = await sb
    .from("ventas")
    .select("numero_contrato, cliente, asesor, cliente_documento")
    .in("numero_contrato", numeros);
  const prev = new Map((existentes ?? []).map((v) => [v.numero_contrato, v]));

  const payload = filas.map((f) => {
    const numero_contrato = numeroConTenant(f.numero, tenant);
    const ex = prev.get(numero_contrato);
    return {
      numero_contrato,
      tenant,
      cliente: ex?.cliente && ex.cliente !== PLACEHOLDER_CLIENTE ? ex.cliente : PLACEHOLDER_CLIENTE,
      asesor: ex?.asesor ?? null, // el asesor lo aporta la hoja de pagos (VENDEDOR)
      cliente_documento: ex?.cliente_documento ?? null,
      moneda: f.moneda,
      precio_venta: f.precio_venta,
      fecha_venta: f.fecha_venta ?? undefined,
      fecha_salida: f.fecha_salida,
      aerolinea: f.aerolinea,
      hotel: f.hotel,
      receptivo: f.receptivo, // proveedor de traslados (puede ir null y aun así guardamos costos)
      costo_aereo: f.costo_aereo,
      costo_hotel: f.costo_hotel,
      costo_receptivo: f.costo_receptivo,
      costo_asistencia: f.costo_asistencia,
      otros_costos: f.otros_costos,
      estado: "confirmado",
      pax: 1,
    };
  });

  let n = 0;
  for (const lote of lotes(payload, 400)) {
    const { error } = await sb.from("ventas").upsert(lote, { onConflict: "numero_contrato" });
    if (error) return { ok: false, error: error.message };
    n += lote.length;
  }

  revalidatePath("/dashboard/contratos");
  revalidatePath("/dashboard/ventas");
  return { ok: true, resumen: `${n} contratos cargados/actualizados con sus costos.`, notas };
}

// ── 2) RESUMEN DE PAGOS → cliente/asesor + abonos ───────────────────────────
export async function importarPagos(texto: string): Promise<Result> {
  const gate = await tenantMinoristaOFalla();
  if (!gate.ok) return gate;
  const tenant = gate.tenant;

  const { filas, notas } = parsePagos(texto);
  if (!filas.length)
    return { ok: false, error: "No se detectaron filas. Pega el bloque copiado de la hoja “Resumen de pagos”." };

  const sb = createAdminClient();
  const numeros = filas.map((f) => numeroConTenant(f.numero, tenant));

  const { data: existentes } = await sb
    .from("ventas")
    .select("numero_contrato, precio_venta")
    .in("numero_contrato", numeros);
  const prev = new Map((existentes ?? []).map((v) => [v.numero_contrato, Number(v.precio_venta) || 0]));

  // (a) upsert de la cabecera de la venta (sin tocar columnas de costos)
  const ventasPayload = filas.map((f) => {
    const numero_contrato = numeroConTenant(f.numero, tenant);
    const precioPrev = prev.get(numero_contrato) ?? 0;
    return {
      numero_contrato,
      tenant,
      cliente: f.cliente ?? PLACEHOLDER_CLIENTE,
      asesor: f.asesor,
      cliente_documento: f.cliente_documento,
      fecha_venta: f.fecha_venta ?? undefined,
      precio_venta: precioPrev > 0 ? precioPrev : (f.precio_venta ?? 0),
      estado: "confirmado",
      pax: 1,
    };
  });
  for (const lote of lotes(ventasPayload, 400)) {
    const { error } = await sb.from("ventas").upsert(lote, { onConflict: "numero_contrato" });
    if (error) return { ok: false, error: error.message };
  }

  // (b) abonos: re-importar limpio → borra los previos de estos contratos (este tenant)
  for (const lote of lotes(numeros, 200)) {
    const { error } = await sb.from("abonos").delete().eq("tenant", tenant).in("numero_contrato", lote);
    if (error) return { ok: false, error: error.message };
  }

  const abonosPayload = filas.flatMap((f) => {
    const numero_contrato = numeroConTenant(f.numero, tenant);
    return f.abonos.map((a) => ({
      numero_contrato,
      tenant,
      cliente: f.cliente,
      fecha_abono: a.fecha ?? f.fecha_venta ?? undefined,
      valor_abono: a.valor,
      monto_cop: a.valor, // histórico en COP
      forma_pago: null as string | null,
      recibido_por: f.asesor,
      observacion: [a.observacion, f.donde_ingreso].filter(Boolean).join(" · ") || null,
    }));
  });

  let nAbonos = 0;
  for (const lote of lotes(abonosPayload, 400)) {
    if (!lote.length) continue;
    const { error } = await sb.from("abonos").insert(lote);
    if (error) return { ok: false, error: error.message };
    nAbonos += lote.length;
  }

  revalidatePath("/dashboard/contratos");
  revalidatePath("/dashboard/ventas");
  revalidatePath("/dashboard/cartera");
  return {
    ok: true,
    resumen: `${filas.length} contratos con titular/asesor y ${nAbonos} abonos cargados.`,
    notas,
  };
}
