import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { COOKIE_TENANT, resolverTenantActivo, type Tenant } from "@/lib/tenant";
import {
  codigoDeErrorContexto,
  mensajeCatalogoDenegado,
  sessionIdDeAccessToken,
  type CodigoContexto,
} from "./sesionJwt";

// Agencia ACTIVA vinculada a la sesión de Auth (migración 237, D8/D9).
//
// La cookie `tenant` es solo una pista de interfaz y nunca llega a Postgres. La
// autoridad es la fila de `sesion_agencia`, que SOLO se escribe aquí, con
// service-role, a partir de un token que el servidor acaba de validar. El
// cliente no pasa ni usuario ni sesión: no existe forma de que declare la suya.

type Resultado = { ok: boolean; codigo: CodigoContexto };

// PostgREST: función no encontrada en el esquema (PGRST202); Postgres: función inexistente (42883).
const FUNCION_AUSENTE = new Set(["PGRST202", "42883"]);

async function sesionVerificada() {
  const sb = await createClient();
  // getUser() valida el token contra el servidor de Auth (no basta con leer la cookie).
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: { session } } = await sb.auth.getSession();
  const sid = sessionIdDeAccessToken(session?.access_token);
  return sid ? { sb, user, sid } : null;
}

/**
 * Crea el contexto de la sesión actual. Llamarlo SOLO justo tras autenticar
 * (login con contraseña, callback OAuth, atajo por código). La base exige una
 * sesión viva, un usuario activo, un inicio reciente y que esa sesión no se haya
 * iniciado antes: no sirve para "arreglar" un contexto perdido.
 */
export async function iniciarContextoAgencia(): Promise<Resultado> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, codigo: "sin_servicio" };
  const s = await sesionVerificada();
  if (!s) return { ok: false, codigo: "sin_sesion" };
  const { data: perfil } = await s.sb.from("usuarios").select("rol, tenant").eq("id", s.user.id).maybeSingle();
  const ck = (await cookies()).get(COOKIE_TENANT)?.value;
  // Misma regla que tenantContext(): solo el superadmin puede arrancar en otra agencia.
  const tenant = resolverTenantActivo(perfil, ck);
  const { error } = await createAdminClient().rpc("iniciar_contexto_agencia", { p_session: s.sid, p_tenant: tenant });
  const codigo = codigoDeErrorContexto(error);
  // "ya_iniciada" es el reintento idempotente de un login ya procesado.
  return { ok: codigo === "ok" || codigo === "ya_iniciada", codigo };
}

/** Mueve la agencia activa de la sesión actual (solo superadmin; exige contexto previo). */
export async function cambiarContextoAgencia(tenant: Tenant): Promise<Resultado> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, codigo: "sin_servicio" };
  const s = await sesionVerificada();
  if (!s) return { ok: false, codigo: "sin_sesion" };
  const { error } = await createAdminClient().rpc("cambiar_contexto_agencia", { p_session: s.sid, p_tenant: tenant });
  const codigo = codigoDeErrorContexto(error);
  return { ok: codigo === "ok", codigo };
}

/**
 * Compuerta de las Server Actions que escriben catálogos globales. Pregunta a la
 * BASE (la misma función que usan las policies), no a la cookie. Complementa a
 * la RLS —que es la barrera real— con un mensaje claro y sin viaje de ida y
 * vuelta fallido. Falla cerrado ante cualquier duda.
 */
export async function exigirEscrituraCatalogoGlobal(): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("puede_escribir_catalogo_global");
  if (!error && data === true) return { ok: true };
  // Orden de despliegue (código antes que la migración 237): mientras la función no exista
  // en la base tampoco existe la guarda de RLS, y esta compuerta es solo cortesía de UX, así
  // que no debe bloquear a nadie. SOLO esos dos códigos; cualquier otro error falla cerrado.
  if (error && FUNCION_AUSENTE.has(error.code)) return { ok: true };
  const ck = (await cookies()).get(COOKIE_TENANT)?.value ?? "";
  // Si la cookie dice Mayorista pero la base niega, la sesión está desincronizada
  // (sin contexto, contexto en otra agencia, usuario inactivo o sesión revocada).
  return { ok: false, error: mensajeCatalogoDenegado({ agenciaActivaCookie: ck, sincronizado: false }) };
}
