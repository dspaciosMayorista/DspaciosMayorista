import type { createClient } from "@/lib/supabase/server";
import { ROLES_INTERNOS } from "@/lib/constants";
import { nombreQuienElabora } from "@/lib/cotizacion/identidadB2B";
import type { TipoAliadoB2B } from "@/lib/cotizacion/asistidaB2B";

type Sb = Awaited<ReturnType<typeof createClient>>;

/**
 * Quién firma como «elaboró» y, si es un aliado B2B logueado, a nombre de qué aliado vende. Todo sale de la SESIÓN + `usuarios` (+ el catálogo para el
 * nombre del aliado), nunca del navegador. Un usuario interno activo firma con su `usuarios.nombre`; un visitante anónimo o un cliente no firma
 * (null ⇒ el documento muestra «—», no se inventa un nombre).
 */
export async function resolverFirmasSesion(sb: Sb, lookup: Sb = sb): Promise<{ elabora: string | null; aliado: { nombre: string; tipo: TipoAliadoB2B } | null }> {
  const vacio = { elabora: null, aliado: null };
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return vacio;
  const { data: perfil } = await sb.from("usuarios").select("rol, activo, nombre, aliado_id").eq("id", user.id).maybeSingle();
  if (!perfil || perfil.activo !== true || typeof perfil.rol !== "string") return vacio;
  if ((ROLES_INTERNOS as string[]).includes(perfil.rol)) return { elabora: nombreQuienElabora(perfil.nombre, null), aliado: null };
  if ((perfil.rol === "agencia" || perfil.rol === "freelance") && typeof perfil.aliado_id === "number") {
    const { data: al } = await lookup.from("aliados").select("nombre, tipo").eq("id", perfil.aliado_id).maybeSingle();
    const nombre = nombreQuienElabora(al?.nombre, null);
    if (nombre && (al?.tipo === "agencia" || al?.tipo === "freelance")) return { elabora: null, aliado: { nombre, tipo: al.tipo } };
  }
  return vacio;
}
