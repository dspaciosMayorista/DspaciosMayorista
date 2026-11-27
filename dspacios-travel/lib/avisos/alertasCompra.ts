// B3-02 (344): lectura de las alertas de fin de compra ACTIVAS de una persona para el área de ALERTAS del tablero. Se llama desde el servidor con la persona que ya autenticó la página (sin sondeo).
import { createAdminClient } from "@/lib/supabase/admin";
import { hoyBogota } from "@/lib/cotizacion/vigencia";
import { hrefCompra, puedeVerAvisosCompra, textoCompra, type FilaCompra } from "./compraAviso";

export type AlertaCompraVista = { id: number; texto: string; href: string };
export type ResultadoAlertasCompra = { ok: boolean; alertas: AlertaCompraVista[]; total: number };

/** Hasta `limite` (≤ 50) alertas activas (no archivadas ni revisadas) + el total real. Quien no escribe paquetes recibe una lista vacía; un fallo de lectura se informa (`ok: false`), nunca se muestra como «0». */
export async function cargarAlertasCompra(usuarioId: string, rol: string | null | undefined, limite = 20): Promise<ResultadoAlertasCompra> {
  if (!usuarioId || !puedeVerAvisosCompra(rol)) return { ok: true, alertas: [], total: 0 };
  const admin = createAdminClient();
  const { data, error } = await (admin as unknown as { rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> })
    .rpc("alertas_compra_listar", { p_usuario: usuarioId, p_limite: limite });
  if (error) return { ok: false, alertas: [], total: 0 };
  const hoy = hoyBogota();
  const filas = (data ?? []) as (FilaCompra & { id: number; total: number })[];
  return { ok: true, total: filas[0]?.total ?? 0, alertas: filas.map((f) => ({ id: f.id, texto: textoCompra(f, hoy), href: hrefCompra(f) })) };
}
