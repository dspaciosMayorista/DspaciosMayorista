"use server";

// Avisos internos (#86). La persona se deduce SIEMPRE de la sesión; ningún argumento del navegador dice a quién pertenece un aviso.
// Reclamar (entregar para notificación/sonido) y marcar leído son operaciones distintas: reclamar NUNCA marca leído.
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SONDEO_VACIO, TIPOS_AVISO_DE_COTIZACION, type AvisoVista, type RespuestaSondeo, type TipoAviso } from "./presentacion";
import { puedeVerAvisosCompra } from "./compraAviso";

// #78: `avisos.cotizacion_id` (migración 323) aún no está en types/database.ts; este acceso sin tipo se quita cuando se regenere el esquema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const avisosSinTipo = (admin: ReturnType<typeof createAdminClient>) => (admin as unknown as { from: (t: string) => any }).from("avisos");

type Fila = { id: number; tipo: string; numero_contrato: string; creado_en: string; leido_en: string | null; cotizacion_id?: number | null; atendida?: boolean };
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;

async function personaActiva(): Promise<{ id: string; externo: boolean; verCompra: boolean } | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: perfil } = await admin.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  if (!perfil || perfil.activo !== true) return null;
  const rol = String(perfil.rol ?? "");
  return { id: user.id, externo: rol === "agencia" || rol === "freelance", verCompra: puedeVerAvisosCompra(rol) };
}

const hrefDe = (externo: boolean, numero: string, tipo?: string, cotizacionId?: number | null) =>
  tipo != null && TIPOS_AVISO_DE_COTIZACION.includes(tipo) ? (cotizacionId != null ? `/dashboard/cotizaciones/${cotizacionId}` : "/dashboard/cotizaciones") :
  externo ? "/portal/b2b/cartera?vista=soportes" : `/dashboard/contratos/${encodeURIComponent(numero)}`;

const aVista = (externo: boolean) => (f: Fila): AvisoVista => ({
  id: f.id, tipo: f.tipo as TipoAviso, numero_contrato: f.numero_contrato, creado_en: f.creado_en,
  // INTEGRACIÓN: el id de la cotización solo sirve para calcular `href` EN EL SERVIDOR; no viaja al navegador (la forma pública del aviso sigue siendo tipo + contrato + destino, como audita #86/#281).
  leido: f.leido_en != null, atendida: f.atendida === true, href: hrefDe(externo, f.numero_contrato, f.tipo, f.cotizacion_id),
});

/**
 * Una sola ida y vuelta por sondeo: (opcional) reclama los pendientes + cuenta no leídos + últimos 10.
 * `reclamar` solo debe ser true en una pestaña con permiso de notificación concedido y activado por la persona.
 */
export async function sondearAvisos(reclamar: boolean): Promise<RespuestaSondeo> {
  const yo = await personaActiva();
  if (!yo) return SONDEO_VACIO;
  const admin = createAdminClient();
  const vista = aVista(yo.externo);

  let nuevos: AvisoVista[] = [];
  if (reclamar === true) {
    const { data } = await admin.rpc("avisos_reclamar", { p_usuario: yo.id, p_limite: 20 });
    const reclamados = (data ?? []) as Omit<Fila, "leido_en">[];
    // #78: la RPC de reclamo (281) no devuelve `cotizacion_id`; solo si hay avisos de cotización reclamados (solicitud de contrato o cotización pública) se lee (1 consulta extra acotada a los ids reclamados).
    const idsSolicitud = reclamados.filter((f) => TIPOS_AVISO_DE_COTIZACION.includes(f.tipo)).map((f) => f.id);
    const cotDe = new Map<number, number | null>();
    if (idsSolicitud.length > 0) {
      const { data: extra } = await avisosSinTipo(admin).select("id, cotizacion_id").in("id", idsSolicitud).eq("usuario_id", yo.id);
      for (const e of (extra ?? []) as { id: number; cotizacion_id: number | null }[]) cotDe.set(e.id, e.cotizacion_id);
    }
    nuevos = reclamados.map((f) => vista({ ...f, cotizacion_id: cotDe.get(f.id) ?? null, leido_en: null }));
  }
  // #78 (340): los recientes salen de `avisos_recientes`, que calcula «atendida» (la cotización pública ya se convirtió en contrato) en la MISMA consulta: sigue siendo 1 consulta de lista por sondeo.
  // #13/344: las alertas de fin de compra ya NO viven en la campana (área de ALERTAS del tablero): ni se cuentan ni se listan aquí; las funciones de base también las excluyen.
  const rpc = (admin as unknown as { rpc: Rpc }).rpc.bind(admin);
  const [{ count }, rec] = await Promise.all([
    avisosSinTipo(admin).select("id", { count: "exact", head: true }).eq("usuario_id", yo.id).is("leido_en", null).is("archivado_en", null).neq("tipo", "compra_por_vencer"),
    rpc("avisos_recientes", { p_usuario: yo.id, p_limite: 10 }),
  ]);
  let recientes = rec.data;
  if (rec.error) {
    // Código desplegado ANTES de la migración 340 (la función aún no existe): la lista sigue saliendo como antes, sin «atendida». Solo en ese caso hay una segunda consulta.
    ({ data: recientes } = await avisosSinTipo(admin).select("id, tipo, numero_contrato, creado_en, leido_en, cotizacion_id").eq("usuario_id", yo.id).is("archivado_en", null).neq("tipo", "compra_por_vencer").order("id", { ascending: false }).limit(10));
  }
  return { nuevos, noLeidos: count ?? 0, recientes: ((recientes ?? []) as Fila[]).filter((f) => f.tipo !== "compra_por_vencer").map(vista) };
}

/** Marca como leídos los avisos de la persona de la sesión (todos si no se indican ids). */
export async function marcarAvisosLeidos(ids?: number[]): Promise<{ ok: boolean }> {
  const yo = await personaActiva();
  if (!yo) return { ok: false };
  const lista = Array.isArray(ids) ? ids.filter((n) => Number.isInteger(n) && n > 0).slice(0, 100) : null;
  const { error } = await createAdminClient().rpc("avisos_marcar_leidos", { p_usuario: yo.id, p_ids: lista });
  return { ok: !error };
}

// ── B3-02 (344): «Revisado» de las alertas de fin de compra (la lectura vive en lib/avisos/alertasCompra.ts: el tablero las lee en el servidor, sin sondeo) ──────
/** «Revisado»: saca la alerta de la vista activa de ESTA persona (por persona, como «leído»). Un cambio de fecha crea una alerta nueva. */
export async function revisarAlertaCompra(id: number): Promise<{ ok: boolean }> {
  const yo = await personaActiva();
  if (!yo || !yo.verCompra || !Number.isInteger(id) || id <= 0) return { ok: false };
  const admin = createAdminClient();
  const { data, error } = await (admin as unknown as { rpc: Rpc }).rpc.call(admin, "alertas_compra_revisar", { p_usuario: yo.id, p_id: id });
  return { ok: !error && data === true };
}
