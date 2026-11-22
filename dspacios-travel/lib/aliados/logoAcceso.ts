/**
 * #32 — Quién puede VER y quién puede CAMBIAR el logo de un aliado. La ficha sale de la sesión (`usuarios.aliado_id`), nunca de un id del navegador.
 *   · Cambiar en el portal: la MISMA elegibilidad de la edición de la ficha (#25): titular activo (rol agencia/freelance sin `agencia_id`), ficha propia y no compartida.
 *   · Ver en el portal: cualquier cuenta de aliado activa enlazada a esa ficha (un agente ve el logo de su agencia, no lo cambia).
 *   · Interno (Aliados): superadmin y gerencia activos.
 * La base vuelve a verificar al actor en `registrar_logo_aliado` (migración 319).
 */
import { cargarContextoEdicion, type AdminPerfil } from "@/lib/portal/perfilEdicionServidor";

export type AliadoDeSesion = { ok: true; aliadoId: number } | { ok: false; error: string };

export async function aliadoQueCambiaLogo(admin: AdminPerfil, userId: string | null | undefined): Promise<AliadoDeSesion> {
  if (!userId) return { ok: false, error: "Inicia sesión para continuar." };
  const c = await cargarContextoEdicion(admin, userId);
  if (!c.lecturaOk) return { ok: false, error: "No se pudo verificar tu cuenta. Intenta de nuevo." };
  if (!c.usuario || !c.permisos.valido) return { ok: false, error: "No tienes permiso para cambiar el logo." };
  if (!c.permisos.puedeFicha || c.usuario.aliado_id == null) return { ok: false, error: c.permisos.motivoFicha ?? "No tienes permiso para cambiar el logo." };
  return { ok: true, aliadoId: c.usuario.aliado_id };
}

export async function aliadoQueVeLogo(admin: AdminPerfil, userId: string | null | undefined): Promise<AliadoDeSesion> {
  if (!userId) return { ok: false, error: "Inicia sesión para continuar." };
  const c = await cargarContextoEdicion(admin, userId);
  if (!c.lecturaOk || !c.usuario || !c.permisos.valido || c.usuario.aliado_id == null) return { ok: false, error: "Sin acceso." };
  return { ok: true, aliadoId: c.usuario.aliado_id };
}

export function esPersonalLogo(perfil: { rol?: unknown; activo?: unknown } | null | undefined): boolean {
  return !!perfil && perfil.activo !== false && perfil.activo != null && ["superadmin", "gerencia"].includes(String(perfil.rol));
}

export function aliadoIdValido(v: unknown): number | null {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}
