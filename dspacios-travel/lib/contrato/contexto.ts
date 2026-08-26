import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { puedeEscribir } from "@/lib/roles";
import { resolverContextoCrearContrato, type ContextoCrearContrato } from "./contextoPuro";

export type { ContextoCrearContrato };

/**
 * Contexto fail-closed para `crearContrato()` (revisión posterior al PR
 * #274): antes usaba `getTenant()` a secas, que sin sesión cae en silencio a
 * "mayorista" (ver `lib/tenant.server.ts`) — y como el generador de número
 * (`siguienteNumeroContrato`) ahora corre con `service_role` (bypassa RLS),
 * la ÚNICA barrera real antes de gastar un consecutivo es esta validación de
 * aplicación. Exige, en orden: sesión real, `activo === true`, y rol con
 * permiso real de escritura sobre `ventas` (`ESCRITURA.ventas`, el mismo
 * criterio que la RLS real — migración 137). `getTenant()` ya valida la
 * cookie de agencia activa contra lo permitido por rol.
 */
export async function contextoCrearContrato(): Promise<ContextoCrearContrato> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return resolverContextoCrearContrato(null, false, "mayorista");

  const { data: perfil } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  const tenant = await getTenant();
  return resolverContextoCrearContrato(perfil, perfil ? puedeEscribir("ventas", perfil.rol) : false, tenant);
}
