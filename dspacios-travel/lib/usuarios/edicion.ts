// Edición de usuarios existentes (/dashboard/usuarios). Lógica pura compartida por la
// Server Action (autoritativa) y el diálogo (muestra el efecto ANTES de guardar).
// Campos editables = los que existen en `usuarios` y son seguros de tocar a mano.
// Fuera a propósito: email y contraseña (identidad), `acceso_legacy_nombre` (nunca se
// concede a mano), escala_id/aplica_retencion/agencia_id (otros módulos).
import { ROLES, ROLES_INTERNOS } from "@/lib/constants";

export const CAMPOS_EDITABLES = ["nombre", "rol", "activo", "tenant", "aliado_id", "pct_comision"] as const;
export const MSG_NOMBRE_LEGACY =
  "Esta cuenta aún tiene acceso heredado por nombre: el nombre es parte de su vínculo con contratos históricos. Concilia primero esos vínculos; el nombre no se puede cambiar desde aquí.";
export const TENANTS = ["mayorista", "minorista"] as const;

export type UsuarioEditable = {
  nombre: string; rol: string; activo: boolean; tenant: string;
  aliado_id: number | null; pct_comision: number | null;
};
export type CambiosUsuario = Partial<UsuarioEditable>;

export const esRolB2B = (rol: string) => rol === "agencia" || rol === "freelance";
export const esRolInterno = (rol: string) => (ROLES_INTERNOS as string[]).includes(rol);

export type GrupoUsuario = "b2b" | "internos" | "otros";
// Clasifica SOLO por rol real (nunca por nombre ni correo).
export const grupoDeRol = (rol: string): GrupoUsuario => (esRolB2B(rol) ? "b2b" : esRolInterno(rol) ? "internos" : "otros");

// Validación sin acceso a BD. Devuelve el primer error, o null.
export function validarCambios(
  actual: UsuarioEditable, c: CambiosUsuario, actor: { rol: string; id: string }, objetivoId: string,
): string | null {
  const ajenas = Object.keys(c).filter((k) => !(CAMPOS_EDITABLES as readonly string[]).includes(k));
  if (ajenas.length)
    return `No se puede modificar: ${ajenas.join(", ")}. El correo y la contraseña no se editan aquí.`;
  if (Object.keys(c).length === 0) return "No hay cambios que guardar.";
  if (actual.rol === "superadmin" && actor.rol !== "superadmin") return "Solo superadmin puede editar a un superadmin.";
  if (c.rol !== undefined) {
    if (!(ROLES as readonly string[]).includes(c.rol)) return "Rol no válido.";
    if (c.rol === "superadmin" && actor.rol !== "superadmin") return "Solo superadmin puede asignar el rol superadmin.";
  }
  if (objetivoId === actor.id && ((c.rol !== undefined && c.rol !== actual.rol) || c.activo === false))
    return "No puedes cambiar tu propio rol ni desactivarte.";
  if (c.nombre !== undefined && !c.nombre.trim()) return "El nombre no puede quedar vacío.";
  if (c.activo !== undefined && typeof c.activo !== "boolean") return "Estado no válido.";
  if (c.tenant !== undefined) {
    if (!(TENANTS as readonly string[]).includes(c.tenant)) return "Agencia no válida.";
    if (c.tenant !== actual.tenant && actor.rol !== "superadmin") return "Solo superadmin puede mover un usuario de agencia.";
  }
  if (c.aliado_id !== undefined && c.aliado_id !== null && !Number.isInteger(c.aliado_id)) return "Ficha no válida.";
  if (c.pct_comision !== undefined && c.pct_comision !== null &&
      !(Number.isFinite(c.pct_comision) && c.pct_comision >= 0 && c.pct_comision <= 1)) return "La comisión debe estar entre 0 y 100 %.";
  const rolFinal = c.rol ?? actual.rol;
  if (!esRolB2B(rolFinal)) {
    if (c.aliado_id != null && c.aliado_id !== actual.aliado_id) return "Solo agencia o freelance pueden tener ficha de aliado.";
    if (c.pct_comision != null) return "La comisión solo aplica a agencia o freelance.";
  }
  return null;
}

// Efectos de acceso de un borrador, para mostrarlos antes de guardar.
export function efectosDeCambio(
  a: UsuarioEditable, n: UsuarioEditable, nombreFicha: (id: number | null) => string, legacy = false,
): string[] {
  const e: string[] = [];
  if (n.rol !== a.rol) {
    if (esRolB2B(n.rol) && !esRolB2B(a.rol)) e.push(`Rol ${a.rol} → ${n.rol}: pasa al portal B2B y deja de usar el dashboard interno.`);
    else if (!esRolB2B(n.rol) && esRolB2B(a.rol)) e.push(`Rol ${a.rol} → ${n.rol}: deja el portal B2B y gana acceso interno según el nuevo rol.`);
    else e.push(`Rol ${a.rol} → ${n.rol}: cambian los módulos que ve y lo que puede editar.`);
  }
  if (n.activo !== a.activo)
    e.push(n.activo ? "Se activa: recupera el acceso." : "Se desactiva: no podrá iniciar sesión ni usar la API.");
  if (n.tenant !== a.tenant) e.push(`Agencia ${a.tenant} → ${n.tenant}: deja de ver los datos de la actual y ve los de la nueva.`);
  if (n.aliado_id !== a.aliado_id)
    e.push(`Ficha de aliado: ${nombreFicha(a.aliado_id)} → ${nombreFicha(n.aliado_id)}. Verá los contratos y comisiones de la nueva ficha; los ya existentes no se reasignan.`);
  if (n.nombre.trim() !== a.nombre)
    e.push(legacy ? `Bloqueado: ${MSG_NOMBRE_LEGACY}` : "Cambia el nombre mostrado. No reasigna fichas ni contratos; esta cuenta no tiene acceso heredado por nombre.");
  if (n.pct_comision !== a.pct_comision) e.push("La comisión cambia para lo que se genere desde ahora; las ya liquidadas no se recalculan.");
  return e;
}

// Solo los campos que realmente cambiaron (la acción nunca recibe de más).
export function diferencias(a: UsuarioEditable, n: UsuarioEditable): CambiosUsuario {
  const d: Record<string, unknown> = {};
  for (const k of CAMPOS_EDITABLES) {
    const nv = k === "nombre" ? n.nombre.trim() : n[k];
    if (nv !== a[k]) d[k] = nv;
  }
  return d as CambiosUsuario;
}
