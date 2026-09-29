/**
 * QUIÉN PUEDE GENERAR CUENTAS POR PAGAR DE UN CONTRATO CON SERVICE-ROLE
 *
 * `asegurarCuentasPorPagar` escribe en `cuentas_por_pagar` con el cliente
 * service-role, que se salta la RLS. Cuando una acción que la invoca responde a
 * un usuario (hoy: "Completar proveedores" en la ficha del contrato), la
 * autorización NO la hace la base de datos: la hace esta función, ANTES de
 * tocar service-role. Si aquí falta una condición, no hay otra barrera detrás.
 *
 * Refleja exactamente la policy "cpp: acceso contable" de `cuentas_por_pagar`
 * (migración 116), que es la que decidiría si el mismo usuario escribiera con
 * su propia sesión:
 *
 *     mi_rol() in ('superadmin','gerencia','administracion','operaciones')
 *     and puede_ver_tenant(tenant)
 *
 * con `puede_ver_tenant(t) = mi_rol() in ('superadmin','gerencia') or mi_tenant() = t`
 * (migración 107) y `mi_rol()` sin rol para usuarios inactivos (migración 140).
 * Una acción con service-role no debe conceder más de lo que concede la RLS de
 * la tabla que escribe.
 *
 * Es PURA: recibe el perfil y el tenant del contrato ya leídos y devuelve la
 * decisión. Se prueba entera sin base de datos
 * (`pruebas/accesoCuentasPorPagar.test.ts`).
 */

/** Roles que la RLS de `cuentas_por_pagar` deja escribir. `venta` y los externos no. */
export const ROLES_ESCRITURA_CXP = ["superadmin", "gerencia", "administracion", "operaciones"] as const;

/** Roles que `puede_ver_tenant()` deja operar sobre cualquier agencia. */
const ROLES_CROSS_TENANT = ["superadmin", "gerencia"] as const;

export type PerfilCxp = {
  rol: string | null;
  activo: boolean | null;
  /** `usuarios.tenant` (= `mi_tenant()`), nunca la cookie de agencia activa. */
  tenant: string | null;
} | null;

/** Contrato visible para la sesión (leído con el cliente de sesión, no service-role). */
export type ContratoCxp = { tenant: string | null } | null;

export type DecisionCxp =
  | { permitido: true }
  | { permitido: false; motivo: "sin_sesion" | "inactivo" | "rol" | "contrato" | "tenant" };

export function autorizarCuentasPorPagarContrato(perfil: PerfilCxp, contrato: ContratoCxp): DecisionCxp {
  if (!perfil) return { permitido: false, motivo: "sin_sesion" };
  if (perfil.activo !== true) return { permitido: false, motivo: "inactivo" };
  if (!perfil.rol || !(ROLES_ESCRITURA_CXP as readonly string[]).includes(perfil.rol)) {
    return { permitido: false, motivo: "rol" };
  }
  // El contrato llega de una lectura con la sesión: si la RLS de `ventas` no lo
  // deja ver, no existe para este usuario.
  if (!contrato || !contrato.tenant) return { permitido: false, motivo: "contrato" };
  if ((ROLES_CROSS_TENANT as readonly string[]).includes(perfil.rol)) return { permitido: true };
  if (!perfil.tenant || perfil.tenant !== contrato.tenant) return { permitido: false, motivo: "tenant" };
  return { permitido: true };
}

/** Mensaje público: no revela si el contrato existe en otra agencia. */
export function mensajeCxpDenegado(motivo: Exclude<DecisionCxp, { permitido: true }>["motivo"]): string {
  if (motivo === "sin_sesion" || motivo === "inactivo") return "Tu sesión no es válida. Vuelve a iniciar sesión.";
  if (motivo === "rol") return "Tu rol no tiene permiso para generar cuentas por pagar.";
  return "Contrato no encontrado o sin acceso.";
}
