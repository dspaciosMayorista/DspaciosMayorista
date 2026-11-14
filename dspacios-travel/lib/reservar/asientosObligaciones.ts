
import { parseIdentidad, type IdentidadContrato } from "@/lib/contrato/identidad";
import { createAdminClient } from "@/lib/supabase/admin";

// 288 (#75): al CONFIRMAR, la base materializa las CxP previstas (confirmar_venta → p75_priv.materializar_obligaciones) y devuelve sus ids. El asiento contable de cada una
// vive fuera de la transacción (best-effort, idempotente por `cxp:<id>`): si falla, el reconciliador (listarCxpSinAsiento) lo repone; nunca duplica.
// NO autoriza: se llama solo con el resultado de una confirmación ya autorizada por la base.

/** Ids de CxP materializadas dentro de la respuesta de `confirmar_venta` (o de `registrar_abono.confirmacion.resultado`). */
export function idsCxpMaterializadas(respuesta: unknown): number[] {
  const r = (respuesta ?? {}) as { obligaciones?: { cxp?: unknown }; resultado?: unknown; confirmacion?: unknown };
  const directos = r.obligaciones?.cxp;
  const anidado = r.resultado ?? (r.confirmacion as { resultado?: unknown } | undefined)?.resultado;
  const lista = Array.isArray(directos) ? directos : anidado ? idsCxpMaterializadas(anidado) : [];
  return lista.map((x) => Number(x)).filter((x) => Number.isFinite(x));
}

export async function postearAsientosDeObligaciones(numeroContrato: string, ids: number[], identidad: IdentidadContrato): Promise<string[]> {
  if (!ids.length || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  const avisos: string[] = [];
  // Importación perezosa: así los módulos que cargan esta librería (acciones de cotización) no arrastran el posteo contable al importarse.
  const { postearAsientoCxP } = await import("@/lib/contabilidad/asientos");
  const admin = createAdminClient(parseIdentidad(identidad));
  const { data } = await admin.from("cuentas_por_pagar")
    .select("id, tipo_proveedor, proveedor, servicio, valor_total, fecha_obligacion, tenant").eq("numero_contrato", numeroContrato).in("id", ids);
  for (const c of data ?? []) {
    try {
      const r = await postearAsientoCxP({
        cuentaId: c.id, numeroContrato, tipoProveedor: c.tipo_proveedor, proveedor: c.proveedor, servicio: c.servicio,
        valorTotal: Number(c.valor_total) || 0, fecha: (c.fecha_obligacion as string | null) ?? new Date().toISOString().slice(0, 10), tenant: (c.tenant as string | null) ?? undefined,
      });
      if (!r.ok) avisos.push(`No se pudo generar el asiento de "${c.servicio ?? "costo"}": ${r.error ?? "motivo desconocido"}.`);
    } catch (e) {
      avisos.push(`No se pudo generar el asiento de "${c.servicio ?? "costo"}": ${e instanceof Error ? e.message : "error desconocido"}.`);
    }
  }
  return avisos;
}
