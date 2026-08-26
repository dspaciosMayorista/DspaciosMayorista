import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { COOKIE_TENANT, resolverTenantActivo, type Tenant } from "@/lib/tenant";
import { puedeEscribir } from "@/lib/roles";
import { medirEtapa } from "@/lib/observabilidad/medicion";
import { resolverContextoCrearContratoOrquestado, type ContextoCrearContrato } from "./contextoPuro";

export type { ContextoCrearContrato };

// Cliente Supabase de sesión, ya autenticado, adjunto al contexto resuelto —
// para que `crearContrato()`/`reservarPrograma()` lo reutilicen en vez de
// crear uno nuevo (`createClient()` no hace red por sí solo, pero el punto es
// no repetir `auth.getUser()`/la consulta de perfil, no el costo del cliente
// en sí). Vive SOLO en el lado del servidor: `Awaited<ReturnType<typeof
// createClient>>` no es serializable y esta función nunca cruza al cliente
// (no es una Server Action exportada al navegador).
export type ContextoCrearContratoResuelto =
  | { ok: true; tenant: Tenant; rol: string; sb: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; error: string };

/**
 * Contexto fail-closed para `crearContrato()`/`reservarPrograma()` (revisión
 * posterior al PR #274): exige, en orden, sesión real, `activo === true`, y
 * rol con permiso real de escritura sobre `ventas` (`ESCRITURA.ventas`, el
 * mismo criterio que la RLS real — migración 137).
 *
 * ⚠️ Optimización (revisión posterior al PR #274, ronda de rendimiento): la
 * versión anterior resolvía el tenant llamando a `getTenant()`
 * (`lib/tenant.server.ts`), que internamente vuelve a crear un cliente, a
 * llamar `auth.getUser()` y a consultar `usuarios` — duplicando exactamente
 * las dos llamadas de red que esta función ya había hecho. Ahora se pide
 * `tenant` en la MISMA consulta de perfil (`rol, activo, tenant`) y el
 * cálculo del tenant activo (cookie de agencia validada contra lo permitido
 * por rol) se resuelve con `resolverTenantActivo()` (lib/tenant.ts, sin
 * I/O) — la misma regla exacta que usa `tenantContext()`, extraída para no
 * repetirla. La lectura de la cookie (`cookies()`) no es una llamada de red.
 *
 * La orquestación real (obtener usuario → consultar perfil → resolver tenant
 * → gate) vive en `resolverContextoCrearContratoOrquestado()`
 * (`./contextoPuro.ts`, sin I/O propio, con las tres fuentes de datos
 * INYECTADAS) — este wrapper solo arma las closures reales (`sb.auth.
 * getUser()`, la consulta de `usuarios`, `resolverTenantActivo` con la
 * cookie ya leída) y se las pasa. Así, `pruebas/contratoContexto.test.ts`
 * puede probar con EJECUCIÓN REAL (espías, no grep) que `auth.getUser` y la
 * consulta de perfil se invocan EXACTAMENTE una vez cada uno — nunca dos,
 * como pasaba antes de esta ronda al llamar a `getTenant()` a secas.
 */
export async function contextoCrearContrato(): Promise<ContextoCrearContratoResuelto> {
  const sb = await createClient();
  const ck = (await cookies()).get(COOKIE_TENANT)?.value;

  const ctx = await resolverContextoCrearContratoOrquestado(
    async () => {
      const {
        data: { user },
      } = await medirEtapa("contexto_auth_getUser", () => sb.auth.getUser(), (r) => (r.data.user ? "ok" : "sin_sesion"));
      return user;
    },
    async (userId) => {
      const { data: perfil } = await medirEtapa(
        "contexto_perfil_query",
        () => sb.from("usuarios").select("rol, activo, tenant").eq("id", userId).maybeSingle(),
        (r) => (r.data ? "ok" : "sin_perfil")
      );
      return perfil;
    },
    (perfil) => resolverTenantActivo(perfil as { rol?: string; tenant?: string } | null, ck),
    (rol) => puedeEscribir("ventas", rol)
  );
  return ctx.ok ? { ...ctx, sb } : ctx;
}
