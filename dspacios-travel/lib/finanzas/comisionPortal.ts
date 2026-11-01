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
import { filasEnRevisionB2B } from "@/lib/finanzas/revisionComisionB2B";

type Admin = ReturnType<typeof createAdminClient>;

const COLUMNAS =
  "id, numero_contrato, aliado, nit, tipo_aliado, aliado_id, precio_venta, base_comision, base_explicita, comision_valor, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado, descontada_en_precio";
const PAGINA = 1000;

export type ComisionPortal = ComisionVisible & {
  /** pendiente / parcial / pagada por sus abonos (filas), o el de ventas (vía ventas / NETO). */
  estado: string | null;
  /**
   * Lo que el aliado ve como importe (#30 B, decisión del dueño 2026-10-12):
   *  · filas (PVP): el SALDO de su comisión = total − sus abonos (131);
   *  · NETO descontada: el valor descontado del precio (sin saldo ni cobro);
   *  · vía ventas: el total de `ventas.comision_b2b` (no tiene abonos propios).
   * null = no se muestra (no hay comisión suya, o una lectura falló).
   */
  importe: number | null;
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

  // Filas retenidas por revisión contable (migración 268): no se atribuyen a nadie. Sin lectura completa, no se muestra importe.
  const enRevision = await filasEnRevisionB2B(admin);
  if (!enRevision) {
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
    const usuario = { aliadoId: perfil.aliadoId, ...evidenciaSinFicha({ via: via.get(num), documentoFicha, nombreUsuario: perfil.nombre }) };
    const delContrato = filas.filter((f) => f.numero_contrato === num);
    // Si una fila en revisión habría sido suya, el contrato se muestra «en revisión» sin importe ni «Pagada»; si no, no se entera de ella.
    if (comisionVisibleAliado(delContrato, c, usuario).ids.some((id) => enRevision.has(id))) {
      res.set(num, { total: null, fuente: "filas", tipo: null, cobrable: false, ids: [], estado: "en_revision", importe: null });
      continue;
    }
    const vis = comisionVisibleAliado(delContrato.filter((f) => !enRevision.has(f.id)), c, usuario);
    // El estado de `ventas` solo acompaña a un importe que sale de `ventas`;
    // el de las filas se calcula abajo por sus abonos (131).
    const estado = vis.fuente === "ventas" || vis.fuente === "descontada" ? (c.comision_estado ?? null) : null;
    // Filas: el importe (saldo) y el estado salen de sus abonos, abajo; hasta
    // entonces no se muestra nada.
    res.set(num, { ...vis, estado, importe: vis.fuente === "filas" ? null : vis.total });
    ids.push(...vis.ids);
  }

  if (ids.length > 0) {
    const pagos = await leerTodo<{ aliado_b2b_id: number; valor: number | string | null }>((d, h) =>
      admin.from("comision_b2b_pagos").select("aliado_b2b_id, valor").in("aliado_b2b_id", ids).order("id").range(d, h));
    for (const [num, vis] of res) {
      if (!vis || vis.fuente !== "filas" || vis.total == null) continue;
      if (!pagos) {
        // #30 B: sin la lectura completa de sus abonos, el saldo y el estado
        // serían inciertos — no se muestra importe, estado ni cobro.
        res.set(num, { ...vis, importe: null, estado: null, cobrable: false });
        continue;
      }
      const pagado = pagos.filter((p) => vis.ids.includes(p.aliado_b2b_id)).reduce((s, p) => s + Number(p.valor ?? 0), 0);
      const saldo = Math.max(0, vis.total - pagado);
      vis.estado = estadoComisionFila(vis.total, pagado, false);
      vis.importe = saldo;
      // Pagada del todo: nada más que cobrar.
      vis.cobrable = vis.cobrable && saldo > 0;
    }
  }
  return res;
}
