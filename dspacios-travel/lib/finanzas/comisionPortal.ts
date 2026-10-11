// Comisión que ve un aliado en el listado del portal B2B (#38).
//
// La fuente es aliados_b2b — la MISMA lectura que la cuenta de cobro
// (`comisionVisibleAliado` aquí, `resolverComisionB2B` allá): una comisión
// corregida se ve corregida en el listado y en el documento al que enlaza.
// `ventas.comision_b2b` solo cuenta en contratos sin ninguna fila viva.
//
// NO decide qué contratos son del aliado: eso ya lo hizo
// `contratosDelPortalB2B` (y de ahí sale `via`). Si una lectura falla o queda
// incompleta, no se muestra importe (falla cerrado).
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  comisionVisibleAliado,
  estadoComisionFila,
  evidenciaSinFicha,
  type ComisionVisible,
  type FilaComisionB2B,
  type VentaComisionAliado,
} from "@/lib/finanzas/comisionB2B";

type Admin = ReturnType<typeof createAdminClient>;

const COLUMNAS =
  "id, numero_contrato, aliado, nit, tipo_aliado, aliado_id, precio_venta, base_comision, base_explicita, comision_valor, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado, descontada_en_precio";
const PAGINA = 1000;

export type ComisionPortal = ComisionVisible & {
  /** pendiente / parcial / pagada por sus abonos (filas), o el de ventas (vía ventas / NETO). */
  estado: string | null;
};

/** Lee todo con .range(), avanzando por lo recibido; null si alguna página falla. */
async function leerTodo<T>(pagina: (desde: number, hasta: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[] | null> {
  const out: T[] = [];
  for (let desde = 0; ; ) {
    const { data, error } = await pagina(desde, desde + PAGINA - 1);
    if (error) return null;
    if (!data || data.length === 0) return out;
    out.push(...(data as T[]));
    desde += data.length;
  }
}

export async function comisionesDelPortal(
  admin: Admin,
  contratos: (VentaComisionAliado & { numero_contrato: string })[],
  via: Map<string, string>,
  perfil: { aliadoId: number | null; nombre: string | null },
): Promise<Map<string, ComisionPortal | null>> {
  const res = new Map<string, ComisionPortal | null>();
  const nums = contratos.map((c) => c.numero_contrato);
  if (nums.length === 0) return res;

  const filas = await leerTodo<FilaComisionB2B>((d, h) =>
    admin.from("aliados_b2b").select(COLUMNAS).in("numero_contrato", nums).order("id").range(d, h));
  if (!filas) {
    for (const n of nums) res.set(n, null);
    return res;
  }

  // Documento de SU ficha: la evidencia de una fila sin ficha (no el nombre).
  let documentoFicha: string | null = null;
  if (perfil.aliadoId != null) {
    const { data: ficha, error } = await admin.from("aliados").select("nit").eq("id", perfil.aliadoId).maybeSingle();
    if (!error) documentoFicha = (ficha as { nit: string | null } | null)?.nit ?? null;
  }

  const ids: number[] = [];
  for (const c of contratos) {
    const num = c.numero_contrato;
    const vis = comisionVisibleAliado(
      filas.filter((f) => f.numero_contrato === num),
      c,
      { aliadoId: perfil.aliadoId, ...evidenciaSinFicha({ via: via.get(num), documentoFicha, nombreUsuario: perfil.nombre }) },
    );
    // El estado de `ventas` solo acompaña a un importe que sale de `ventas`;
    // el de las filas se calcula abajo por sus abonos (131).
    const estado = vis.fuente === "ventas" || vis.fuente === "descontada" ? (c.comision_estado ?? null) : null;
    res.set(num, { ...vis, estado });
    ids.push(...vis.ids);
  }

  if (ids.length > 0) {
    const pagos = await leerTodo<{ aliado_b2b_id: number; valor: number | string | null }>((d, h) =>
      admin.from("comision_b2b_pagos").select("aliado_b2b_id, valor").in("aliado_b2b_id", ids).order("id").range(d, h));
    if (pagos) {
      const pagado = new Map<number, number>();
      for (const p of pagos) pagado.set(p.aliado_b2b_id, (pagado.get(p.aliado_b2b_id) ?? 0) + Number(p.valor ?? 0));
      for (const vis of res.values()) {
        if (!vis || vis.fuente !== "filas" || vis.total == null) continue;
        vis.estado = estadoComisionFila(vis.total, vis.ids.reduce((s, id) => s + (pagado.get(id) ?? 0), 0), false);
      }
    }
  }
  return res;
}
