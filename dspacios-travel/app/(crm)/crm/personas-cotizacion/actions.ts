"use server";

// ─────────────────────────────────────────────────────────────────────────
// "Personas de cotizaciones" — CRM (#42, migración 219). Lee los puestos (titular/pasajeros) de
// las cotizaciones por la RPC `crm_personas_cotizacion_buscar` con el cliente de SESIÓN (nunca
// admin), para que la base evalúe al usuario que de verdad hizo la petición: rol, tenant y
// propiedad (venta y agencia/freelance solo cotizaciones creadas por su usuario). Nunca escribe,
// nunca toca crm_contactos ni marca a nadie como destinatario de campaña.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { buscarPersonasCotizacionCrm, type PuestoCotizacionCrm } from "@/lib/personas/consulta";
import { ROLES_AMBOS_TENANTS } from "@/lib/personas/fuentes";

export type ResultadoPersonasCotizacion =
  | { ok: true; filas: PuestoCotizacionCrm[]; total: number }
  | { ok: false; error: string };

export async function buscarPersonasCotizacion(texto: string, pagina: number, tamPagina: number): Promise<ResultadoPersonasCotizacion> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "No autorizado." };
  const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).maybeSingle();
  // Gerencia/superadmin piden la agencia ACTIVA de forma explícita (la RPC no la supone); el
  // resto consulta la suya (la RPC ignora cualquier otra).
  const tenant = (ROLES_AMBOS_TENANTS as readonly string[]).includes(perfil?.rol ?? "") ? await getTenant() : null;
  const tam = Math.min(50, Math.max(1, Math.trunc(tamPagina) || 25));
  const pag = Math.max(1, Math.trunc(pagina) || 1);
  const r = await buscarPersonasCotizacionCrm(sb, {
    tenant,
    texto: String(texto ?? "").trim(),
    limite: tam,
    offset: (pag - 1) * tam,
  });
  if (!r.ok) return r;
  return { ok: true, filas: r.data.items ?? [], total: r.data.total ?? 0 };
}
