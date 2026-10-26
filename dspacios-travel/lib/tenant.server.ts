import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  clasificarAgenciaSesion, COOKIE_TENANT, esTenant, resolverTenantEfectivo, TENANTS,
  type LecturaAgenciaSesion, type Tenant,
} from "@/lib/tenant";

/** Se lanza cuando la agencia de la sesión no se pudo verificar y se pidió elegir agencia para una operación. */
export class AgenciaNoVerificadaError extends Error {
  constructor() {
    super("No se pudo verificar la agencia de tu sesión. Recarga la página; si persiste, cierra sesión y vuelve a ingresar.");
    this.name = "AgenciaNoVerificadaError";
  }
}

// Contexto de agencia del usuario: su agencia "home", si puede cambiar (SOLO
// superadmin — ver `puedeCambiar` abajo, `resolverTenantActivo()` en
// lib/tenant.ts aplica la misma regla) y la agencia ACTIVA (cookie validada
// contra lo permitido).
export async function tenantContext(): Promise<{
  tenant: Tenant; userTenant: Tenant; puedeCambiar: boolean; permitidos: Tenant[];
  /** Agencia vinculada a la sesión en la base (solo se consulta para superadmin; null = sin vínculo o sin leer). */
  agenciaSesion: Tenant | null;
  /** La cookie no coincidía con la agencia de la sesión: se muestra la de la sesión. */
  desincronizada: boolean;
  /**
   * false = error TÉCNICO al leer la agencia de la sesión: `tenant` es solo la pista de la cookie y NO
   * está verificada. Ninguna operación sensible debe elegir agencia con ese dato (usar `getTenant()`).
   */
  agenciaVerificada: boolean;
  /** Desenlace de la lectura de la agencia de la sesión (null = no aplica: no es superadmin). */
  lecturaAgencia: LecturaAgenciaSesion["estado"] | null;
}> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol, tenant").eq("id", user.id).maybeSingle()
    : { data: null };
  const rol = (perfil?.rol as string) ?? "";
  const userTenant: Tenant = esTenant((perfil as { tenant?: string } | null)?.tenant) ? ((perfil as { tenant: Tenant }).tenant) : "mayorista";
  // Solo el superadmin se comparte entre agencias (puede alternar). Los demás
  // usuarios se crean por separado en cada agencia y quedan fijos a la suya.
  const puedeCambiar = rol === "superadmin";
  const permitidos: Tenant[] = puedeCambiar ? TENANTS : [userTenant];

  const ck = (await cookies()).get(COOKIE_TENANT)?.value;
  // Cálculo del tenant activo extraído a `resolverTenantActivo()` (lib/tenant.ts,
  // sin I/O) — misma regla exacta, ahora compartida con `contextoCrearContrato()`
  // para que no tenga que repetir esta consulta llamando a esta función.
  // Para el superadmin, la AUTORIDAD es la agencia de su sesión en la base (migración 237): si la cookie
  // difiere, gana la base (ver resolverTenantEfectivo). El resto de roles no tiene contexto que consultar.
  // La lectura distingue función ausente (pre-237) / sin contexto / ok / error técnico (ver lib/tenant.ts).
  let lectura: LecturaAgenciaSesion | null = null;
  if (puedeCambiar) {
    const { data, error } = await sb.rpc("agencia_activa_sesion");
    lectura = clasificarAgenciaSesion(data, error);
  }
  const { tenant, desincronizada, verificada } = resolverTenantEfectivo(perfil as { rol?: string; tenant?: string } | null, ck, lectura);
  return {
    tenant, userTenant, puedeCambiar, permitidos,
    agenciaSesion: lectura?.estado === "ok" ? lectura.tenant : null,
    desincronizada,
    agenciaVerificada: verificada,
    lecturaAgencia: lectura?.estado ?? null,
  };
}

// Agencia para OPERAR (estampar tenant, filtrar datos, numerar...). Falla cerrado: si la agencia de la
// sesión no se pudo verificar, lanza en vez de devolver la pista de la cookie.
export async function getTenant(): Promise<Tenant> {
  const c = await tenantContext();
  if (!c.agenciaVerificada) throw new AgenciaNoVerificadaError();
  return c.tenant;
}

// Datos fiscales/legales de una agencia (del RUT). Si no se pasa tenant, usa la
// agencia activa. Devuelve null si no existe la fila (tabla sin sembrar).
export async function agenciaDe(t?: Tenant) {
  const sb = await createClient();
  const tenant = t ?? (await getTenant());
  const { data } = await sb.from("agencias").select("*").eq("tenant", tenant).maybeSingle();
  return data ?? null;
}
