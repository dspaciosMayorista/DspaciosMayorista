import { createClient } from "@/lib/supabase/server";

// ── Catálogo de módulos (lo que se controla) ─────────────────────────────────
export const MODULOS: { key: string; label: string }[] = [
  { key: "tarifario", label: "Tarifario" },
  { key: "reservar", label: "Reservar" },
  { key: "cotizaciones", label: "Cotizaciones" },
  { key: "ventas", label: "Ventas" },
  { key: "contratos", label: "Contratos" },
  { key: "vuelos", label: "Vuelos" },
  { key: "paquetes", label: "Montaje de producto" },
  { key: "producto", label: "Producto (netas)" },
  { key: "finanzas", label: "Finanzas" },
  { key: "usuarios", label: "Usuarios" },
  { key: "b2b", label: "Portal B2B (aprobaciones)" },
  { key: "configuracion", label: "Configuración" },
  { key: "crm", label: "CRM" },
];

// ── Catálogo de roles (clave interna → nombre visible) ───────────────────────
export const ROLES: { key: string; label: string }[] = [
  { key: "superadmin", label: "Superadmin" },
  { key: "administracion", label: "Admin" },
  { key: "gerencia", label: "Gerencia" },
  { key: "operaciones", label: "Operacional" },
  { key: "venta", label: "Comercial" },
  { key: "control_vuelo", label: "Control Vuelo" },
  { key: "agencia", label: "Agencia" },
  { key: "freelance", label: "Freelance" },
  { key: "cliente_final", label: "Cliente Final" },
];

export type Permiso = { consultar: boolean; modificar: boolean; eliminar: boolean };
const NADA: Permiso = { consultar: false, modificar: false, eliminar: false };
const TODO: Permiso = { consultar: true, modificar: true, eliminar: true };

// Roles internos con acceso total por defecto (nunca se bloquean en código).
const ADMIN_ROLES = ["superadmin", "administracion", "gerencia"];

const EXTERNOS = ["agencia", "freelance", "cliente_final"];

// Defaults cuando no hay fila configurada. Permisivos para roles INTERNOS (para
// no ocultar nada antes de que el dueño ajuste la matriz) y restrictivos para
// externos (su acceso real es el portal B2B, no el dashboard). El dueño afina
// todo en la matriz de permisos.
function permisoDefault(rol: string, modulo: string): Permiso {
  if (ADMIN_ROLES.includes(rol)) return { ...TODO };
  // Externos: solo el tarifario público; nada del dashboard.
  if (EXTERNOS.includes(rol)) return modulo === "tarifario" ? { consultar: true, modificar: false, eliminar: false } : { ...NADA };
  if (!rol) return { ...NADA };
  // Aprobaciones B2B: solo roles admin por defecto (otros, solo si se personaliza).
  if (modulo === "b2b") return { ...NADA };
  // Internos (operaciones, venta, control_vuelo, etc.): ven todo; modifican todo
  // salvo Usuarios/Configuración; no eliminan por defecto.
  const soloConsulta = ["usuarios", "configuracion"].includes(modulo);
  return { consultar: true, modificar: !soloConsulta, eliminar: false };
}

type FilaPerm = { modulo: string; consultar: boolean; modificar: boolean; eliminar: boolean };

/** Permisos efectivos del usuario actual por módulo (override usuario > rol > default). */
export async function permisosDelUsuario(): Promise<{ rol: string | null; permisos: Record<string, Permiso> }> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { rol: null, permisos: {} };

  const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).maybeSingle();
  const rol = perfil?.rol ?? null;

  const out: Record<string, Permiso> = {};
  // Superadmin: todo, siempre.
  if (rol === "superadmin") {
    for (const m of MODULOS) out[m.key] = { ...TODO };
    return { rol, permisos: out };
  }

  const [{ data: filasRol }, { data: filasUsr }] = await Promise.all([
    rol ? sb.from("permisos_rol").select("modulo, consultar, modificar, eliminar").eq("rol", rol) : Promise.resolve({ data: [] as FilaPerm[] }),
    sb.from("permisos_usuario").select("modulo, consultar, modificar, eliminar").eq("usuario_id", user.id),
  ]);
  const rolMap = new Map((filasRol ?? []).map((f) => [f.modulo, f]));
  const usrMap = new Map((filasUsr ?? []).map((f) => [f.modulo, f]));

  for (const m of MODULOS) {
    const u = usrMap.get(m.key);
    const r = rolMap.get(m.key);
    if (u) out[m.key] = { consultar: u.consultar, modificar: u.modificar, eliminar: u.eliminar };
    else if (r) out[m.key] = { consultar: r.consultar, modificar: r.modificar, eliminar: r.eliminar };
    else out[m.key] = permisoDefault(rol ?? "", m.key);
  }
  return { rol, permisos: out };
}

/** Conjunto de módulos que el usuario puede CONSULTAR (para ocultar el menú). */
export async function modulosConsultables(): Promise<Set<string>> {
  const { permisos } = await permisosDelUsuario();
  return new Set(Object.entries(permisos).filter(([, p]) => p.consultar).map(([k]) => k));
}

/** Matriz de defaults+filas para la UI de administración (un rol). */
export function permisoEfectivoRol(rol: string, filas: FilaPerm[]): Record<string, Permiso> {
  const map = new Map(filas.map((f) => [f.modulo, f]));
  const out: Record<string, Permiso> = {};
  for (const m of MODULOS) {
    const r = map.get(m.key);
    out[m.key] = r ? { consultar: r.consultar, modificar: r.modificar, eliminar: r.eliminar } : permisoDefault(rol, m.key);
  }
  return out;
}
