import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { resolverContextoCotizacion, autorizaTenant, type ContextoCotizacion } from "@/lib/cotizacion/accesoPuro";

// Contexto de acceso del usuario autenticado, para decidir si puede leer o
// escribir una cotización puntual. Centraliza la regla usada en todos los
// puntos que tocan `cotizaciones`/`cotizacion_servicios`: durante la fase
// aditiva (migración 153) todavía no hay RLS por tenant en estas dos tablas
// — eso lo cierra la 154 — así que este chequeo de aplicación es la única
// barrera real hasta que la migración de cierre corra. Una vez corrida la
// 154, sigue siendo válido tenerlo (defensa en profundidad).
//
// La decisión en sí (perfil → ok/no-ok, activo, superadmin) vive en
// `accesoPuro.ts` — sin I/O, para poder probarla exhaustivamente. Esta
// función solo se encarga de traer los datos reales.
export type { ContextoCotizacion };
export { autorizaTenant };

export async function contextoCotizacion(): Promise<ContextoCotizacion> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return resolverContextoCotizacion(null, "mayorista");

  const { data: perfil } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();

  // getTenant() ya valida la cookie de agencia activa contra lo permitido:
  // para superadmin, cualquiera de las dos agencias; para todos los demás,
  // únicamente la suya propia (nunca la cookie "cruda" — ver tenantContext
  // en lib/tenant.server.ts). Se pide siempre (incluso si el perfil resulta
  // inactivo) para no ramificar la llamada; `resolverContextoCotizacion`
  // igual descarta el resultado si `perfil` no autoriza.
  const tenant = await getTenant();
  return resolverContextoCotizacion(perfil, tenant);
}
