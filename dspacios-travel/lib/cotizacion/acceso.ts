import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import type { Tenant } from "@/lib/tenant";

// Contexto de acceso del usuario autenticado, para decidir si puede leer o
// escribir una cotización puntual. Centraliza la regla usada en todos los
// puntos que tocan `cotizaciones`/`cotizacion_servicios`: durante la fase
// aditiva (migración 153) todavía no hay RLS por tenant en estas dos tablas
// — eso lo cierra la 154 — así que este chequeo de aplicación es la única
// barrera real hasta que la migración de cierre corra. Una vez corrida la
// 154, sigue siendo válido tenerlo (defensa en profundidad).
export type ContextoCotizacion =
  | { ok: true; superadmin: boolean; tenant: Tenant }
  | { ok: false; motivo: "sin_sesion" | "usuario_inactivo" };

export async function contextoCotizacion(): Promise<ContextoCotizacion> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, motivo: "sin_sesion" };

  const { data: perfil } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  if (!perfil || perfil.activo === false) return { ok: false, motivo: "usuario_inactivo" };

  // getTenant() ya valida la cookie de agencia activa contra lo permitido:
  // para superadmin, cualquiera de las dos agencias; para todos los demás,
  // únicamente la suya propia (nunca la cookie "cruda" — ver tenantContext
  // en lib/tenant.server.ts).
  const tenant = await getTenant();
  return { ok: true, superadmin: perfil.rol === "superadmin", tenant };
}

// ¿Este contexto puede acceder a una fila con este tenant?
//
// `tenantFila = null` (cotización sin tenant asignado — no debería existir
// una vez desplegado este código, pero una fila así NUNCA se trata como
// "accesible por defecto") se niega para cualquiera que no sea superadmin.
// Superadmin conserva el alcance global previsto (puede revisar y corregir
// una fila huérfana); nadie más.
export function autorizaTenant(ctx: ContextoCotizacion, tenantFila: string | null): boolean {
  if (!ctx.ok) return false;
  if (ctx.superadmin) return true;
  return tenantFila === ctx.tenant;
}
