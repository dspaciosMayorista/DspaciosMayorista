import { accesoDocumentoContrato, type PerfilAcceso } from "@/lib/auth/accesoDocumentoContrato";

// QUIÉN PUEDE ABRIR UN VOUCHER POR SU TOKEN (#53, migración 307). Función PURA con dependencias inyectadas: se prueba entera sin base ni Next.
//
// Regla del dueño:
//   · Un voucher puede PREPARARSE y VERSE internamente (vista previa) en cualquier momento: roles internos que la base ya deja leer la fila (RLS de `vouchers`).
//   · Un ALIADO (agencia / freelance / cliente final dueño del contrato) lo abre SOLO con el contrato 100 % pagado. SIN excepción anticipada, ni siquiera si lo generó un superadmin.
//   · Un aumento posterior del saldo (o un abono anulado) lo vuelve a bloquear sin borrar nada: la comprobación se hace en CADA apertura.
//   · Cualquier otra persona (sin sesión, desactivada, de otro aliado, rol desconocido) no lo abre. Ante un error de lectura del pago: NIEGA (falla cerrado).
// El token solo identifica el documento; NO autoriza por sí mismo.

export const ROLES_PREPARACION_VOUCHER = ["superadmin", "gerencia", "administracion", "operaciones", "venta"] as const;

export type VoucherFila = { id: number; numero_contrato: string; tipo: string | null; contenido: unknown };
export type ContratoVoucher = { tenant: string | null; b2b_usuario_id: string | null; aliado_id: number | null; agencia_nombre: string | null; freelance_nombre: string | null };

export type DepsAccesoVoucher = {
  /** Usuario de la sesión (null = sin sesión). */
  sesion: () => Promise<{ id: string } | null>;
  perfil: (id: string) => Promise<PerfilAcceso | null>;
  /** Fila del voucher por token, leída con la frontera de servidor (sin RLS). */
  voucher: (token: string) => Promise<VoucherFila | null>;
  /** ¿La RLS de la SESIÓN deja leer este voucher? (la vista previa interna la decide la base, no una lista de roles). */
  visibleParaInterno: (token: string) => Promise<boolean>;
  contrato: (numero: string) => Promise<ContratoVoucher | null>;
  /** `aliados_b2b.aliado_id` verificado fail-closed (true/false/null = no se pudo verificar). */
  fichaManual: (numero: string) => Promise<boolean | null>;
  /** Criterio único de pago completo. Puede lanzar: se trata como NO pagado. */
  pagadoCompleto: (numero: string) => Promise<boolean>;
};

export type MotivoDenegado = "sin_sesion" | "no_existe" | "sin_permiso" | "pago_incompleto" | "error";
export type ResultadoAccesoVoucher =
  | { ok: true; modo: "interno" | "aliado"; voucher: VoucherFila; tenant: string | null }
  | { ok: false; motivo: MotivoDenegado };

export async function resolverAccesoVoucher(token: string, d: DepsAccesoVoucher): Promise<ResultadoAccesoVoucher> {
  try {
    if (typeof token !== "string" || token.length < 8) return { ok: false, motivo: "no_existe" };
    const sesion = await d.sesion();
    if (!sesion) return { ok: false, motivo: "sin_sesion" };
    const perfil = await d.perfil(sesion.id);
    if (!perfil?.rol || perfil.activo !== true) return { ok: false, motivo: "sin_permiso" };
    const v = await d.voucher(token);
    if (!v || v.contenido == null) return { ok: false, motivo: "no_existe" };

    // 1) Personal interno: vista previa en cualquier momento, SOLO si la RLS le deja leer la fila (agencia, y para `venta` su propio contrato).
    if ((ROLES_PREPARACION_VOUCHER as readonly string[]).includes(perfil.rol)) {
      return (await d.visibleParaInterno(token))
        ? { ok: true, modo: "interno", voucher: v, tenant: (await d.contrato(v.numero_contrato))?.tenant ?? null }
        : { ok: false, motivo: "sin_permiso" };
    }

    // 2) Aliado: dueño del contrato Y contrato 100 % pagado.
    const c = await d.contrato(v.numero_contrato);
    if (!c) return { ok: false, motivo: "no_existe" };
    const acceso = accesoDocumentoContrato(perfil, {
      tenant: c.tenant, b2bUsuarioId: c.b2b_usuario_id, aliadoId: c.aliado_id,
      comisionManualConFicha: await d.fichaManual(v.numero_contrato), nombreAliado: [c.agencia_nombre, c.freelance_nombre],
    });
    if (!acceso.permitido || !acceso.esDueno || acceso.esInterno) return { ok: false, motivo: "sin_permiso" };
    if (!(await d.pagadoCompleto(v.numero_contrato))) return { ok: false, motivo: "pago_incompleto" };
    return { ok: true, modo: "aliado", voucher: v, tenant: c.tenant };
  } catch {
    return { ok: false, motivo: "error" };
  }
}
