"use server";

// Avisos internos (#86). La persona se deduce SIEMPRE de la sesión; ningún argumento del navegador dice a quién pertenece un aviso.
// Reclamar (entregar para notificación/sonido) y marcar leído son operaciones distintas: reclamar NUNCA marca leído.
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SONDEO_VACIO, type AvisoVista, type RespuestaSondeo, type TipoAviso } from "./presentacion";

type Fila = { id: number; tipo: string; numero_contrato: string; creado_en: string; leido_en: string | null };

async function personaActiva(): Promise<{ id: string; externo: boolean } | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: perfil } = await admin.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  if (!perfil || perfil.activo !== true) return null;
  const rol = String(perfil.rol ?? "");
  return { id: user.id, externo: rol === "agencia" || rol === "freelance" };
}

const hrefDe = (externo: boolean, numero: string) =>
  externo ? "/portal/b2b/cartera?vista=soportes" : `/dashboard/contratos/${encodeURIComponent(numero)}`;

const aVista = (externo: boolean) => (f: Fila): AvisoVista => ({
  id: f.id, tipo: f.tipo as TipoAviso, numero_contrato: f.numero_contrato, creado_en: f.creado_en,
  leido: f.leido_en != null, href: hrefDe(externo, f.numero_contrato),
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
    nuevos = ((data ?? []) as Omit<Fila, "leido_en">[]).map((f) => vista({ ...f, leido_en: null }));
  }
  const [{ count }, { data: recientes }] = await Promise.all([
    admin.from("avisos").select("id", { count: "exact", head: true }).eq("usuario_id", yo.id).is("leido_en", null).is("archivado_en", null),
    admin.from("avisos").select("id, tipo, numero_contrato, creado_en, leido_en").eq("usuario_id", yo.id).is("archivado_en", null).order("id", { ascending: false }).limit(10),
  ]);
  return { nuevos, noLeidos: count ?? 0, recientes: ((recientes ?? []) as Fila[]).map(vista) };
}

/** Marca como leídos los avisos de la persona de la sesión (todos si no se indican ids). */
export async function marcarAvisosLeidos(ids?: number[]): Promise<{ ok: boolean }> {
  const yo = await personaActiva();
  if (!yo) return { ok: false };
  const lista = Array.isArray(ids) ? ids.filter((n) => Number.isInteger(n) && n > 0).slice(0, 100) : null;
  const { error } = await createAdminClient().rpc("avisos_marcar_leidos", { p_usuario: yo.id, p_ids: lista });
  return { ok: !error };
}
