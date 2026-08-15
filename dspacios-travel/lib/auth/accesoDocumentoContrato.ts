/**
 * QUIÉN PUEDE ABRIR UN DOCUMENTO DE UN CONTRATO POR URL
 *
 * Cuenta de cobro, estado de cuenta, plan de cobro y recibo se sirven con el
 * cliente **service-role**, que se salta la RLS por definición. En esas páginas
 * la autorización NO la hace la base de datos: la hace este archivo. Si aquí
 * falta una condición, no hay una segunda barrera detrás.
 *
 * Antes vivía duplicada en dos sitios (`lib/cuenta/estado.ts` y
 * `lib/finanzas/comisionResolver.ts`), cada uno con su propia lista de roles
 * internos, y en los dos decía lo mismo:
 *
 *     const esInterno = ROLES_INTERNOS.includes(perfil?.rol ?? "");
 *     if (!esInterno && !esDueno) return null;
 *
 * Dos fallos, los mismos en las dos copias:
 *
 *   1. **No comparaba el tenant.** `operaciones` es interno, así que un
 *      operaciones de mayorista abría por URL la cuenta de cobro y el estado de
 *      cuenta de cualquier contrato de minorista. Y las dos funciones ya traían
 *      `ventas.tenant` en la consulta: lo leían y no lo usaban.
 *   2. **La propiedad B2B se resolvía por NOMBRE**
 *      (`[agencia_nombre, freelance_nombre].includes(perfil.nombre)`), que es
 *      justo el vínculo débil que la migración 143 vino a reemplazar con
 *      `aliado_id`. `portal/b2b/page.tsx` ya resolvía por id; estas dos no.
 *
 * La función es **pura**: recibe el perfil y los datos del contrato ya leídos,
 * y devuelve la decisión. No consulta nada. Así se puede probar entera sin base
 * de datos (`pruebas/accesoDocumentoContrato.test.ts`) y las dos páginas no
 * pueden volver a divergir.
 */

/**
 * Roles con acceso a la cartera de su agencia. **`venta` NO está**, igual que
 * antes: un asesor no abre el estado de cuenta ni la cuenta de cobro de un
 * contrato por URL. Se conserva tal cual para no cambiar de paso quién ve qué;
 * ampliarlo sería otra decisión.
 */
export const ROLES_CARTERA = ["superadmin", "gerencia", "administracion", "operaciones"] as const;

export type PerfilAcceso = {
  id: string;
  rol: string | null;
  tenant: string | null;
  nombre: string | null;
  /**
   * `usuarios.activo`. **Se comprueba aquí, no fuera.** Estas páginas se leen
   * con service-role, así que ni la RLS ni `mi_rol()` —que desde la migración
   * 140 no devuelve rol si el usuario está desactivado— participan. Y `proxy.ts`
   * tampoco basta: rebota al login, pero es una capa de navegación, no de
   * autorización, y el JWT de una cuenta desactivada sigue vivo hasta que
   * expira. Si no se mira aquí, no se mira en ninguna parte.
   */
  activo: boolean | null;
  /** Ficha del catálogo `aliados` enlazada al usuario (migración 143). */
  aliadoId: number | null;
};

export type ContratoAcceso = {
  tenant: string | null;
  /** `ventas.b2b_usuario_id` — compró él mismo desde el portal. */
  b2bUsuarioId: string | null;
  /**
   * Ficha del catálogo enlazada AL CONTRATO. Puede venir de `ventas.aliado_id`
   * o, en comisiones cargadas a mano, de `aliados_b2b.aliado_id`. Quien llama
   * resuelve cuál aplica y pasa el que haya.
   */
  aliadoId: number | null;
  /** Solo para el respaldo legacy. Nunca se usa si hay algún id. */
  nombreAliado: (string | null)[];
};

export type Acceso = {
  permitido: boolean;
  /** Entra por su rol interno (misma agencia, o superadmin). */
  esInterno: boolean;
  /** Entra por ser el aliado B2B dueño de la comisión. */
  esDueno: boolean;
  /** Por qué se decidió así. Para diagnóstico y para las pruebas. */
  via:
    | "superadmin"
    | "interno_mismo_tenant"
    | "b2b_usuario_id"
    | "aliado_id"
    | "nombre_legacy"
    | "denegado";
};

const DENEGADO: Acceso = { permitido: false, esInterno: false, esDueno: false, via: "denegado" };

/**
 * Compara dos nombres normalizando mayúsculas y espacios. Exige que el
 * resultado NO quede vacío: si no, dos cadenas en blanco empatarían entre sí y
 * un contrato con el nombre del aliado vacío se abriría para cualquiera que
 * tuviera el suyo también vacío — el mismo error que emparejar dos NULL.
 */
const igualNombre = (a: string | null | undefined, b: string | null | undefined) => {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  return x !== "" && x === y;
};

/**
 * Decide si `perfil` puede abrir el documento de `contrato`.
 *
 * Orden deliberado — primero los vínculos FUERTES (por id), después el rol, y
 * el nombre solo como último recurso:
 *
 *   0. El usuario tiene que estar **activo**. Se comprueba antes que todo lo
 *      demás, superadmin incluido.
 *   1. `superadmin` → alcance global, por diseño.
 *   2. `b2bUsuarioId` → lo compró él mismo desde el portal. Es el vínculo más
 *      fuerte que existe: es su propio id de usuario.
 *   3. `aliadoId` → su ficha del catálogo es la del contrato. **Cruza agencias
 *      a propósito**: un interno de mayorista enlazado como aliado a un
 *      contrato B2B de minorista entra como DUEÑO (`esDueno`), no como personal
 *      interno (`esInterno` queda en false) — su rol no le da nada ahí. Es la
 *      única forma de entrar a otra agencia, y exige que alguien haya hecho el
 *      enlace explícito.
 *   4. Rol interno **y el mismo tenant**. La comparación que faltaba.
 *   5. Nombre — solo si NO hay ningún id (ver abajo).
 *
 * Los pasos 3/4 no se excluyen: quien sea interno de la agencia Y además el
 * aliado del contrato sale con las dos marcas en true.
 *
 * ⚠️ EL RESPALDO POR NOMBRE ES COMPATIBILIDAD, NO UN MECANISMO
 *   Solo entra cuando `b2bUsuarioId` Y `aliadoId` son **los dos** null, es
 *   decir cuando el contrato es anterior a la migración 143 y nadie lo ha
 *   enlazado todavía. Emparejar dos cadenas de texto permite suplantación —hoy
 *   contenida bloqueando nombres de aliado duplicados en el registro, que es un
 *   parche— así que en cuanto exista UN id, manda el id y el nombre deja de
 *   mirarse: un homónimo sin enlace queda fuera. Enlazar esos contratos viejos
 *   con `aliado_id` es lo que apaga esta rama del todo.
 */
export function accesoDocumentoContrato(
  perfil: PerfilAcceso | null,
  contrato: ContratoAcceso
): Acceso {
  if (!perfil?.rol) return DENEGADO;

  // Desactivado = fuera, por CUALQUIER vía. Antes que nada, para que ni
  // superadmin ni el dueño de la comisión se salten la comprobación: dar de
  // baja a alguien tiene que cerrarle también los documentos por URL, que es
  // justo por donde se seguiría entrando sin pasar por la aplicación.
  // `=== false` no basta: un `null` (columna sin valor) tampoco es un sí.
  if (perfil.activo !== true) return DENEGADO;

  if (perfil.rol === "superadmin") {
    return { permitido: true, esInterno: true, esDueno: false, via: "superadmin" };
  }

  // ── Vínculos fuertes por id ────────────────────────────────────────────
  if (contrato.b2bUsuarioId && contrato.b2bUsuarioId === perfil.id) {
    return { permitido: true, esInterno: false, esDueno: true, via: "b2b_usuario_id" };
  }

  const porAliadoId =
    contrato.aliadoId != null &&
    perfil.aliadoId != null &&
    contrato.aliadoId === perfil.aliadoId;

  // ── Rol interno, y solo dentro de SU agencia ───────────────────────────
  const esInterno =
    (ROLES_CARTERA as readonly string[]).includes(perfil.rol) &&
    !!perfil.tenant &&
    perfil.tenant === contrato.tenant;

  if (porAliadoId) {
    return { permitido: true, esInterno, esDueno: true, via: "aliado_id" };
  }
  if (esInterno) {
    return { permitido: true, esInterno: true, esDueno: false, via: "interno_mismo_tenant" };
  }

  // ── Respaldo legacy: SOLO si no hay ningún id con el que decidir ───────
  const hayAlgunId = contrato.b2bUsuarioId != null || contrato.aliadoId != null;
  if (!hayAlgunId && contrato.nombreAliado.some((n) => igualNombre(n, perfil.nombre))) {
    return { permitido: true, esInterno: false, esDueno: true, via: "nombre_legacy" };
  }

  return DENEGADO;
}
