/**
 * QUÉ CONTRATOS LISTA EL PORTAL B2B A UN ALIADO
 *
 * `app/portal/b2b/page.tsx` lee `ventas` con service-role (se salta la RLS), así
 * que la pertenencia la decide ESTE archivo. Y la decide con la MISMA función
 * que los documentos por URL: cada candidato pasa por `accesoDocumentoContrato`
 * con los mismos datos (ids de `ventas`, ficha en comisión manual verificada
 * con `verificarFichasComisionManual`, nombres). Así el listado no puede
 * mostrar un contrato cuyo estado de cuenta/cuenta de cobro se niegue, ni al
 * revés.
 *
 * Candidatos (solo un universo de búsqueda; la decisión es de la función):
 *   1. `ventas.b2b_usuario_id` = su id      → lo compró él desde el portal.
 *   2. `ventas.aliado_id`      = su ficha   → enlace explícito al aprobarlo.
 *   3. Nombre en texto (LEGACY)             → solo se BUSCA si la cuenta tiene
 *      `acceso_legacy_nombre = true` (migración 193).
 *
 * Fail-closed: si la verificación de fichas en `aliados_b2b` falla (error,
 * respuesta parcial, límite de filas, paginación rota), ningún candidato por
 * nombre se lista — `comisionManualConFicha` queda null y la función lo niega —
 * y se avisa con `legacyNoVerificado` para que la pantalla no lo calle.
 */
import { accesoDocumentoContrato, ROLES_LEGACY_NOMBRE, type PerfilAcceso, type Acceso } from "@/lib/auth/accesoDocumentoContrato";
import {
  verificarFichasComisionManual,
  consultarFichasSupabase,
  fichaDeContrato,
  leerTodoConConteo,
  PAGINA_FILAS,
  type PaginaConConteo,
  type VerificacionFichas,
} from "@/lib/auth/fichaComisionManual";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type FilaContratoPortal = {
  numero_contrato: string;
  tenant?: string | null;
  aliado_id?: number | null;
  b2b_usuario_id?: string | null;
  agencia_nombre?: string | null;
  freelance_nombre?: string | null;
  fecha_salida?: string | null;
  [k: string]: unknown;
};

export type PerfilPortal = {
  id: string;
  rol: string | null;
  tenant: string | null;
  activo: boolean | null;
  nombre: string | null;
  aliadoId: number | null;
  accesoLegacyNombre: boolean | null;
};

export type ConsultasPortal = {
  porB2bUsuario: (usuarioId: string) => Promise<FilaContratoPortal[]>;
  porAliadoId: (aliadoId: number) => Promise<FilaContratoPortal[]>;
  /**
   * CANDIDATOS por nombre: contratos del `tenant` dado, sin `aliado_id` ni
   * `b2b_usuario_id` en `ventas`, cuyo `agencia_nombre` o `freelance_nombre`
   * CONTIENE `nombre` sin distinguir mayúsculas. Es a propósito un superconjunto
   * de lo que acepta `accesoDocumentoContrato` (que compara normalizado:
   * mayúsculas y espacios): la decisión la toma esa función, no esta consulta.
   * `completa: false` si no se pudo leer todo (error, límite de filas…).
   */
  porNombreSinIds: (nombre: string, tenant: string) => Promise<{ completa: boolean; filas: FilaContratoPortal[] }>;
  /** Verificación fail-closed de fichas en `aliados_b2b` (ver fichaComisionManual.ts). */
  verificarFichas: (numeros: string[]) => Promise<VerificacionFichas>;
};

export type ViaPortal = Exclude<Acceso["via"], "denegado" | "superadmin" | "interno_mismo_tenant">;

/** Columnas mínimas para decidir; el portal agrega las de presentación. */
export const COLUMNAS_DECISION = "numero_contrato, tenant, aliado_id, b2b_usuario_id, agencia_nombre, freelance_nombre, fecha_salida";

/**
 * Escapa los comodines de LIKE (`\`, `%`, `_`) para buscar el nombre literal.
 * (PostgREST además trata `*` como `%`: un `*` en un nombre solo AMPLÍA los
 * candidatos, nunca el acceso, porque decide `accesoDocumentoContrato`.)
 */
export function escaparLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => "\\" + m);
}

export async function contratosDelPortalB2B(
  perfil: PerfilPortal | null,
  q: ConsultasPortal
): Promise<{ contratos: FilaContratoPortal[]; via: Map<string, ViaPortal>; legacyNoVerificado: boolean }> {
  const via = new Map<string, ViaPortal>();
  const vacio = { contratos: [], via, legacyNoVerificado: false };

  if (!perfil || perfil.activo !== true) return vacio;
  if (!perfil.rol || !(ROLES_LEGACY_NOMBRE as readonly string[]).includes(perfil.rol)) return vacio;

  const perfilAcceso: PerfilAcceso = {
    id: perfil.id, rol: perfil.rol, tenant: perfil.tenant, nombre: perfil.nombre,
    activo: perfil.activo, aliadoId: perfil.aliadoId, accesoLegacyNombre: perfil.accesoLegacyNombre,
  };

  // Universo de candidatos.
  const candidatos = new Map<string, FilaContratoPortal>();
  const sumar = (filas: FilaContratoPortal[]) => {
    for (const f of filas) if (f?.numero_contrato && !candidatos.has(f.numero_contrato)) candidatos.set(f.numero_contrato, f);
  };
  sumar(await q.porB2bUsuario(perfil.id));
  if (perfil.aliadoId != null) sumar(await q.porAliadoId(perfil.aliadoId));

  // Sin tenant explícito no hay respaldo por nombre (la función también lo
  // exige); ni siquiera se busca.
  const nombre = (perfil.nombre ?? "").trim();
  const buscarPorNombre = perfil.accesoLegacyNombre === true && nombre !== "" && !!perfil.tenant;
  const busqueda = buscarPorNombre
    ? await q.porNombreSinIds(nombre, perfil.tenant as string)
    : { completa: true, filas: [] as FilaContratoPortal[] };
  // Búsqueda incompleta → nada por nombre (y se avisa). Lo que entra por id no
  // depende de ella.
  const porNombre = busqueda.completa ? busqueda.filas : [];
  sumar(porNombre);

  // Fichas en comisión manual: solo hacen falta para los que podrían entrar
  // por nombre. Para el resto la decisión ya la da un id.
  const numsNombre = porNombre.map((f) => f.numero_contrato);
  const fichas: VerificacionFichas = numsNombre.length
    ? await q.verificarFichas(numsNombre)
    : { completa: true, conFicha: new Set() };

  // Decisión: la MISMA función que los documentos por URL.
  const contratos: FilaContratoPortal[] = [];
  for (const f of candidatos.values()) {
    const acceso = accesoDocumentoContrato(perfilAcceso, {
      tenant: f.tenant ?? null,
      b2bUsuarioId: f.b2b_usuario_id ?? null,
      aliadoId: f.aliado_id ?? null,
      comisionManualConFicha: fichaDeContrato(fichas, f.numero_contrato),
      nombreAliado: [f.agencia_nombre ?? null, f.freelance_nombre ?? null],
    });
    if (!acceso.permitido) continue;
    contratos.push(f);
    via.set(f.numero_contrato, acceso.via as ViaPortal);
  }

  contratos.sort((a, b) => String(b.fecha_salida ?? "").localeCompare(String(a.fecha_salida ?? "")));
  return {
    contratos,
    via,
    legacyNoVerificado: !busqueda.completa || (numsNombre.length > 0 && !fichas.completa),
  };
}

/**
 * Consultas reales del portal (service-role). `columnas` debe incluir
 * `COLUMNAS_DECISION`. Las consultas de `ventas` que fallan devuelven vacío:
 * eso solo puede QUITAR contratos del listado, nunca dar acceso.
 */
export function consultasPortalSupabase(admin: Admin, columnas: string): ConsultasPortal {
  const filas = async (p: PromiseLike<{ data: unknown[] | null; error: unknown }>) => {
    const r = await p;
    return (r.error ? [] : (r.data ?? [])) as FilaContratoPortal[];
  };
  return {
    porB2bUsuario: (uid) => filas(admin.from("ventas").select(columnas).eq("b2b_usuario_id", uid)),
    porAliadoId: (id) => filas(admin.from("ventas").select(columnas).eq("aliado_id", id)),
    // Una consulta por columna con `.ilike()` (valor parametrizado) y no `.or()`:
    // con service-role, `.or()` recibe sintaxis de PostgREST en crudo y un
    // nombre con comas o paréntesis podría reescribir el filtro. Comodines del
    // nombre escapados (`escaparLike`). Paginada y fail-closed.
    porNombreSinIds: async (n, tenant) => {
      const patron = `%${escaparLike(n)}%`;
      const leer = (col: "agencia_nombre" | "freelance_nombre") =>
        leerTodoConConteo<FilaContratoPortal>(
          (desde, hasta) =>
            admin
              .from("ventas")
              .select(columnas, { count: "exact" })
              .eq("tenant", tenant)
              .ilike(col, patron)
              .is("aliado_id", null)
              .is("b2b_usuario_id", null)
              .order("numero_contrato", { ascending: true })
              .range(desde, hasta) as unknown as PromiseLike<PaginaConConteo<FilaContratoPortal>>,
          PAGINA_FILAS,
          (f) => typeof f?.numero_contrato === "string"
        );
      const [a, b] = await Promise.all([leer("agencia_nombre"), leer("freelance_nombre")]);
      if (!a.completa || !b.completa) return { completa: false, filas: [] };
      return { completa: true, filas: [...a.filas, ...b.filas] };
    },
    verificarFichas: (nums) => verificarFichasComisionManual(nums, consultarFichasSupabase(admin)),
  };
}
