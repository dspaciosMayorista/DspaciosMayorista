import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { postearAsientoCxP } from "@/lib/contabilidad/asientos";
import { faltantesCxP, type CxpExistente } from "@/lib/reservar/cxpCobertura";
import { fechaNegocio } from "@/lib/fechaNegocio";

// NO es una Server Action (este archivo no lleva "use server"): antes vivía
// exportada en app/(dashboard)/dashboard/reservar/actions.ts, y cualquier
// usuario autenticado podía invocarla con cualquier número de contrato.
//
// ⚠️ Usa service-role y NO autoriza. Quien la llame desde algo que responde a
// un usuario debe autorizar ANTES (sesión activa, rol y acceso al contrato):
//   - completarProveedores → autorizarCuentasPorPagarContrato
//   - confirmarVenta / recalcularEstadoAbono → el contrato se lee primero con
//     la sesión (RLS de ventas) y solo siguen si es visible.
// El cuerpo es el mismo de antes, sin cambios.

// ── Respaldo de cuentas por pagar ──────────────────────────────────────────
// Crea las cuentas por pagar que FALTEN para un contrato a partir de sus costos
// (hotel/aéreo/receptivo/asistencia/otros). NO duplica: solo agrega los tipos de
// proveedor que aún no tengan CxP. Útil cuando al reservar solo se generó parte
// (p. ej. "solo el aéreo" porque el costo neto del hotel salió 0). El proveedor
// del hotel/aéreo se jala del contrato; los demás quedan para que contabilidad
// los asigne. El hotel se crea aunque el costo sea 0 (queda pendiente de valor).
export async function asegurarCuentasPorPagar(numeroContrato: string): Promise<{ ok: boolean; creadas: number; error?: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, creadas: 0 };
  const admin = createAdminClient();

  const [{ data: existentes }, { data: v }, { data: ch }, { data: cv }, { data: provs }] = await Promise.all([
    // `valor_total` además del tipo: la cobertura de servicios se mide en
    // PESOS, no por existencia de etiqueta (ver lib/reservar/cxpCobertura.ts).
    admin.from("cuentas_por_pagar").select("tipo_proveedor, valor_total").eq("numero_contrato", numeroContrato),
    admin.from("ventas").select("tenant, costo_hotel, costo_aereo, costo_receptivo, costo_asistencia, otros_costos, moneda, hotel, aerolinea, plazo, fecha_salida").eq("numero_contrato", numeroContrato).maybeSingle(),
    admin.from("contrato_hoteles").select("nombre, proveedor").eq("numero_contrato", numeroContrato).order("orden").limit(1),
    admin.from("contrato_vuelos").select("aerolinea").eq("numero_contrato", numeroContrato).order("orden").limit(1),
    admin.from("proveedores").select("nombre, aplica_retencion, pct_retencion"),
  ]);
  if (!v) return { ok: false, creadas: 0 };
  const tenant = (v.tenant as string | null) ?? "mayorista";

  const hoy = fechaNegocio();
  const vence = (v.plazo as string | null) ?? (v.fecha_salida as string | null) ?? null;
  const moneda = (v.moneda as string | null) ?? "COP";
  const hotelRow = (ch ?? [])[0] as { nombre: string | null; proveedor: string | null } | undefined;
  const vueloRow = (cv ?? [])[0] as { aerolinea: string | null } | undefined;

  // Retención del catálogo de proveedores por nombre (case-insensitive).
  const retDe = (nombre: string | null) => {
    const p = (provs ?? []).find((x) => x.nombre && nombre && x.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());
    return { aplica_retencion: p?.aplica_retencion ?? false, pct_retencion: Number(p?.pct_retencion) || 0 };
  };

  type Row = {
    numero_contrato: string; tenant: string; proveedor: string | null; tipo_proveedor: string; servicio: string;
    valor_total: number; moneda: string; fecha_obligacion: string; fecha_vencimiento: string | null;
    aplica_retencion: boolean; pct_retencion: number; observaciones: string;
  };
  const rows: Row[] = [];
  const OBS = "Completado automáticamente (faltaba el proveedor)";
  const SIN_ESPECIFICAR = "Sin especificar";
  const add = (tipo: string, servicio: string, valor: number, proveedor: string | null) => {
    const nombre = proveedor?.trim() || SIN_ESPECIFICAR;
    const r = retDe(proveedor);
    rows.push({
      numero_contrato: numeroContrato, tenant, proveedor: nombre, tipo_proveedor: tipo, servicio,
      valor_total: Math.max(0, valor), moneda, fecha_obligacion: hoy, fecha_vencimiento: vence,
      aplica_retencion: r.aplica_retencion, pct_retencion: r.pct_retencion, observaciones: OBS,
    });
  };

  // Qué falta y por cuánto — decisión PURA y testeable
  // (`faltantesCxP`, lib/reservar/cxpCobertura.ts). Hotel/aéreo por
  // existencia; los tres tipos de SERVICIO por MONTO contra las columnas de
  // costo de servicio, porque un mismo `costo_receptivo` puede estar
  // repartido en CxP etiquetadas `receptivo`/`asistencia`/`otro` según la
  // categoría de cada servicio: comparar solo la etiqueta volvía a crear una
  // segunda cuenta por el mismo dinero.
  const SERVICIO_LABEL: Record<string, string> = {
    hotel: `Hotel ${hotelRow?.nombre ?? v.hotel ?? ""}`.trim(),
    aereo: `Aéreo ${vueloRow?.aerolinea ?? v.aerolinea ?? ""}`.trim(),
    receptivo: "Servicios receptivos",
    asistencia: "Asistencia médica",
    otro: "Otros costos",
  };
  const PROVEEDOR_DE: Record<string, string | null> = {
    hotel: hotelRow?.proveedor ?? null,
    aereo: vueloRow?.aerolinea ?? (v.aerolinea as string | null),
  };
  for (const f of faltantesCxP((existentes ?? []) as CxpExistente[], {
    costo_hotel: Number(v.costo_hotel) || 0,
    costo_aereo: Number(v.costo_aereo) || 0,
    costo_receptivo: Number(v.costo_receptivo) || 0,
    costo_asistencia: Number(v.costo_asistencia) || 0,
    otros_costos: Number(v.otros_costos) || 0,
  })) {
    add(f.tipo, SERVICIO_LABEL[f.tipo] ?? f.tipo, f.valor, PROVEEDOR_DE[f.tipo] ?? null);
  }

  if (!rows.length) return { ok: true, creadas: 0 };

  const { data: creadas, error } = await admin.from("cuentas_por_pagar").insert(rows).select("id, tipo_proveedor, proveedor, servicio, valor_total");
  if (error) return { ok: false, creadas: 0, error: error.message };
  for (const c of creadas ?? []) {
    await postearAsientoCxP({
      cuentaId: c.id, numeroContrato, tipoProveedor: c.tipo_proveedor, proveedor: c.proveedor,
      servicio: c.servicio, valorTotal: Number(c.valor_total) || 0, fecha: hoy, tenant,
    });
  }
  revalidatePath("/dashboard/pagos");
  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  revalidatePath("/dashboard/contabilidad/libro-diario");
  revalidatePath("/dashboard/contabilidad/libro-auxiliar");
  return { ok: true, creadas: rows.length };
}
