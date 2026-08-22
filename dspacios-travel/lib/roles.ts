import { createClient } from "@/lib/supabase/server";
import { LECTURA_MODULO, type Rol } from "@/lib/constants";

// Se re-exporta para no romper los imports existentes: la definición se movió a
// `lib/constants.ts` porque `proxy.ts` también la necesita, y el middleware no
// puede importar nada que use `next/headers` (como este archivo).
export { LECTURA_MODULO };

// Roles internos que SIEMPRE tienen acceso total de escritura (nunca se
// bloquean). Ver migración 137 — la misma regla ya está aplicada en RLS.
export const ADMIN_ROLES: readonly Rol[] = ["superadmin", "administracion", "gerencia"];

/**
 * Fuente única de verdad de "qué rol escribe qué recurso", a nivel de
 * aplicación. DEBE reflejar exactamente las políticas RLS de escritura
 * (supabase/migrations/20260601000137_alinear_roles_escritura.sql y las que
 * la preceden) — Postgres no puede leer esta constante, así que si cambias
 * un valor aquí, cambia también la política de la(s) tabla(s) correspondiente(s).
 *
 * Se usa donde una Server Action no puede confiar solo en RLS (porque usa el
 * cliente service-role, que la bypassa) y para el gating del menú lateral.
 */
export const ESCRITURA = {
  producto: [...ADMIN_ROLES, "operaciones"] as Rol[],               // destinos, hoteles, tarifas, servicios, aerolíneas, proveedores, paquetes
  vuelos: [...ADMIN_ROLES, "operaciones", "control_vuelo"] as Rol[], // bloqueos_vuelo, sillas, movimientos_silla
  ventas: [...ADMIN_ROLES, "operaciones", "venta"] as Rol[],         // ventas, contratos, cotizaciones
  aliados: [...ADMIN_ROLES] as Rol[],                                // aliados, asesores
  b2b: [...ADMIN_ROLES] as Rol[],                                    // aprobaciones de registro B2B
  // RLS real de `usuarios` es superadmin-only (defensa en profundidad);
  // administracion pasa por el check explícito de usuarios/actions.ts (usa
  // el cliente service-role, que bypassa RLS).
  usuarios: ["superadmin", "administracion"] as Rol[],
} satisfies Record<string, Rol[]>;

export function puedeEscribir(recurso: keyof typeof ESCRITURA, rol: string | null): boolean {
  return !!rol && (ESCRITURA[recurso] as readonly string[]).includes(rol);
}

// Roles con SELECT real sobre `ventas` (migración 116, policy "ventas:
// lectura operativa") — DEBE reflejar exactamente esa policy, igual que
// `ESCRITURA` arriba. `control_vuelo` entra al módulo Vuelos (LECTURA_MODULO
// incluye TODOS los roles internos ahí) pero NO tiene ninguna policy de
// SELECT sobre `ventas`/`ventas_basica`/`contrato_*` — un link a
// `/dashboard/contratos/[numero]` para ese rol cargaría una página vacía por
// RLS, sin ningún aviso (hallazgo 2, revisión posterior al PR #268, ronda
// "ENLACE DE CONTRATO"). Se usa para decidir, del lado del servidor, cuándo
// mostrar ese link en `EmpaquetadosTabla` — nunca en el cliente, para no
// depender de que el navegador tenga el rol correcto.
export const ROLES_CONTRATO_COMPLETO: readonly Rol[] = ["superadmin", "gerencia", "administracion", "operaciones"];

/** Rol del usuario autenticado actual (o null si no hay sesión / no está en `usuarios`). */
export async function miRol(): Promise<Rol | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("usuarios").select("rol").eq("id", user.id).maybeSingle();
  return (data?.rol as Rol | undefined) ?? null;
}

/** Módulos que el rol puede consultar (para ocultar el menú). */
export function modulosConsultables(rol: Rol | null): Set<string> {
  if (!rol) return new Set();
  return new Set(
    Object.entries(LECTURA_MODULO).filter(([, roles]) => roles.includes(rol)).map(([k]) => k)
  );
}
