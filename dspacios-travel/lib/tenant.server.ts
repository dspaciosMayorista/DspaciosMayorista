import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { COOKIE_TENANT, esTenant, resolverTenantActivo, TENANTS, type Tenant } from "@/lib/tenant";

// Contexto de agencia del usuario: su agencia "home", si puede cambiar (solo
// superadmin/gerencia) y la agencia ACTIVA (cookie validada contra lo permitido).
export async function tenantContext(): Promise<{
  tenant: Tenant; userTenant: Tenant; puedeCambiar: boolean; permitidos: Tenant[];
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
  const tenant: Tenant = resolverTenantActivo(perfil as { rol?: string; tenant?: string } | null, ck);
  return { tenant, userTenant, puedeCambiar, permitidos };
}

export async function getTenant(): Promise<Tenant> {
  return (await tenantContext()).tenant;
}

// Datos fiscales/legales de una agencia (del RUT). Si no se pasa tenant, usa la
// agencia activa. Devuelve null si no existe la fila (tabla sin sembrar).
export async function agenciaDe(t?: Tenant) {
  const sb = await createClient();
  const tenant = t ?? (await getTenant());
  const { data } = await sb.from("agencias").select("*").eq("tenant", tenant).maybeSingle();
  return data ?? null;
}
