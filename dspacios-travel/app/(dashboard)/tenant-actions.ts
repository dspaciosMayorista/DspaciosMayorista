"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { tenantContext } from "@/lib/tenant.server";
import { COOKIE_TENANT, type Tenant } from "@/lib/tenant";

// Cambia la agencia activa (solo si el usuario tiene permiso de verla).
export async function cambiarTenant(t: Tenant): Promise<{ ok: boolean }> {
  const { permitidos } = await tenantContext();
  if (!permitidos.includes(t)) return { ok: false };
  (await cookies()).set(COOKIE_TENANT, t, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
