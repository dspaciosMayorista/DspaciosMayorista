"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { tenantContext } from "@/lib/tenant.server";
import { COOKIE_TENANT, type Tenant } from "@/lib/tenant";
import { cambiarContextoAgencia } from "@/lib/auth/contextoAgencia";

// `recargar`: la base y la interfaz pudieron quedar en agencias distintas y no se pudo corregir;
// la interfaz DEBE recargar para mostrar la agencia que la sesión realmente autoriza.
export type ResultadoCambioTenant = { ok: true } | { ok: false; error: string; recargar?: boolean };

const ERROR_SIN_VINCULO = "Tu sesión no tiene la agencia vinculada. Cierra sesión y vuelve a ingresar para cambiar de agencia.";
const ERROR_DESINCRONIZADA = "El cambio de agencia quedó a medias. Se mostrará la agencia que tu sesión tiene autorizada; si no es la que querías, vuelve a elegirla o cierra sesión y vuelve a ingresar.";
const ERROR_GENERICO = "No se pudo cambiar de agencia. Intenta de nuevo; si persiste, cierra sesión y vuelve a ingresar.";

// Cambia la agencia activa (solo si el usuario tiene permiso de verla).
//
// La cookie es solo la pista de interfaz; la agencia que cuenta para escribir
// catálogos globales (D8/D9) es la vinculada a la SESIÓN en la base (migración 237).
// Por eso el orden es: 1) mover el contexto en la base; 2) solo si salió bien,
// cambiar la cookie. Si 1) falla NO se toca la cookie y se devuelve el error: la
// interfaz sigue mostrando la agencia que la base realmente autoriza, nunca una
// apariencia de Minorista con permiso de Mayorista (ni al revés).
export async function cambiarTenant(t: Tenant): Promise<ResultadoCambioTenant> {
  const { permitidos, puedeCambiar, tenant: actual } = await tenantContext();
  if (!permitidos.includes(t)) return { ok: false, error: "No tienes acceso a esa agencia." };

  if (puedeCambiar) {
    const r = await cambiarContextoAgencia(t).catch(() => ({ ok: false as const, codigo: "error" as const }));
    if (!r.ok) {
      const sinVinculo = r.codigo === "sin_contexto" || r.codigo === "sesion_inexistente" || r.codigo === "sin_sesion";
      return { ok: false, error: sinVinculo ? ERROR_SIN_VINCULO : ERROR_GENERICO };
    }
  }

  try {
    (await cookies()).set(COOKIE_TENANT, t, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  } catch {
    // La cookie no se pudo escribir: se devuelve el contexto de la base a la agencia anterior
    // para que cookie y base sigan coincidiendo.
    if (puedeCambiar) {
      const restaurado = await cambiarContextoAgencia(actual).catch(() => ({ ok: false as const }));
      if (!restaurado.ok) {
        // Doble fallo: la base quedó en `t` y la cookie en `actual`. La interfaz mostraría `actual`
        // mientras la sesión autoriza `t`. tenantContext() ya muestra la agencia de la SESIÓN (la base
        // manda), así que basta recargar; se avisa para que la interfaz no siga con la vista vieja.
        revalidatePath("/dashboard", "layout");
        return { ok: false, error: ERROR_DESINCRONIZADA, recargar: true };
      }
    }
    return { ok: false, error: ERROR_GENERICO };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
