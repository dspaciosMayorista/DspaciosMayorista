import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.ts";
import { esTenant, type Tenant } from "../tenant.ts";

type SB = SupabaseClient<Database>;

/**
 * "Editar en contrato" en el renglón subordinado de cada infante del
 * manifiesto de vuelo (detalle de bloqueo y listado global de pasajeros).
 *
 * El enlace abre la ficha INTERNA del contrato real al que pertenece el
 * infante (`/dashboard/contratos/{numero_contrato}` — ver
 * `app/(dashboard)/dashboard/contratos/[numero]/page.tsx`). Dos decisiones
 * distintas conviven acá:
 *
 * 1) ¿Puede el usuario que mira el vuelo ABRIR ese contrato? Se responde con
 *    la RLS del cliente de SESIÓN leyendo `ventas` — la misma consulta que
 *    hace la ficha del contrato, así que devuelve exactamente las filas que
 *    ese rol/tenant puede ver:
 *      - `superadmin`/`gerencia` → ambos tenants,
 *      - `administracion`/`operaciones` → solo el de su tenant fijo,
 *      - `control_vuelo`/`venta` → no pasan la policy de lectura de `ventas`
 *        → 0 filas → nunca enlace.
 *    La consulta pide `numero_contrato, tenant`: el tenant que se usa es el
 *    REAL de la fila de `ventas`, jamás el que se lea del texto del número.
 *
 * 2) Cuando el contrato pertenece a un tenant distinto del que está ACTIVO en
 *    la sesión (cookie), el enlace no puede ser una navegación directa: la
 *    ficha se abriría con la agencia equivocada (sidebar/datos/layout del
 *    tenant viejo). Abrirla bien exige CAMBIAR la agencia activa primero, y
 *    solo `superadmin` puede cambiar (`cambiarTenant`, tenant-actions.ts). Por
 *    eso el selector puro de acá (`enlaceContratoEnVuelo`) falla cerrado ante
 *    un contrato cross-tenant cuando quien mira NO puede cambiar de agencia:
 *    un `gerencia` que alcanza a ver el contrato del otro tenant por RLS no
 *    recibe el enlace (no podría abrirlo en su contexto correcto). Quien SÍ
 *    puede cambiar (superadmin) recibe el enlace con el tenant real del
 *    contrato, y el componente cliente
 *    (`components/vuelos/EnlaceEditarContrato.tsx`) cambia la agencia y recién
 *    entonces navega con recarga completa.
 *
 * La pregunta "¿qué contrato ES una referencia manual?" sigue viviendo en
 * `lib/vuelos/contratoManual.ts` (`resolverManifiestoAutorizado`), que sí
 * necesita un cliente ADMIN para ver la tabla COMPLETA y resolver la
 * ambigüedad oculta por la RLS. Acá NUNCA se usa un cliente admin/service-role:
 * ese camino decide otra cosa y ocultaría exactamente la frontera de acceso.
 */

/** Recorta espacios; cadena vacía (o solo espacios) se trata como ausente. */
export function normalizarNumeroContrato(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  return t ? t : null;
}

/**
 * Contrato que el renglón del infante puede enlazar: el `numero_contrato`
 * interno REAL (tal cual existe en `ventas`) + el `tenant` REAL de esa venta
 * (leído de la columna, nunca del texto `MIN-`). Se lo pasa tal cual al
 * componente cliente, que decide si hace falta cambiar de agencia antes de
 * navegar.
 */
export type EnlaceContratoInfo = {
  numeroContrato: string;
  tenant: Tenant;
};

/**
 * Pura: dado el `numero_contrato` de un infante y el mapa número→tenant de los
 * contratos que la RLS de este usuario deja abrir, decide si ese renglón
 * genera enlace "Editar en contrato" y, si genera, con qué tenant navegar.
 * Fail-closed, en orden:
 *   - candidato vacío → null (sin enlace);
 *   - el número no está en el mapa (no es una venta que la sesión pueda abrir)
 *     → null, y nunca se antepone ni se quita un prefijo por su cuenta;
 *   - el contrato es de OTRO tenant y el usuario NO puede cambiar la agencia
 *     activa (`puedeCambiarTenant`) → null: abrir ese enlace lo dejaría en la
 *     agencia equivocada, así que no se ofrece.
 * Devuelve `{ numeroContrato, tenant }` cuando sí se puede abrir en su
 * contexto (mismo tenant activo, o cross-tenant con permiso de cambiar).
 */
export function enlaceContratoEnVuelo(
  candidato: string | null | undefined,
  autorizados: ReadonlyMap<string, Tenant>,
  tenantActivo: Tenant,
  puedeCambiarTenant: boolean
): EnlaceContratoInfo | null {
  const numero = normalizarNumeroContrato(candidato);
  if (!numero) return null;
  const tenant = autorizados.get(numero);
  if (!tenant) return null;
  // Cross-tenant sin permiso de cambiar → fail-closed (ver doc de arriba).
  if (tenant !== tenantActivo && !puedeCambiarTenant) return null;
  return { numeroContrato: numero, tenant };
}

/**
 * IO — resuelve EN LOTE, con una sola consulta a `ventas` por página (nunca
 * una por infante ni por renglón), qué contratos del conjunto puede abrir el
 * usuario de la sesión y a qué tenant pertenece cada uno. Pide
 * `numero_contrato, tenant` — el tenant que alimenta la decisión cross-tenant
 * del enlace es el REAL de la fila, nunca el que sugeriría un prefijo. La RLS
 * del cliente de sesión hace la frontera: devuelve solo las filas que este
 * rol/tenant puede ver. Fail-closed: sin candidatos, error de red o RLS que
 * no deje ver nada → mapa vacío (ningún enlace). Los candidatos repetidos se
 * deduplican y los vacíos se descartan aquí, así el llamador puede pasar la
 * lista cruda de todos los infantes del manifiesto.
 */
export async function contratosQuePuedeAbrir(
  sbSesion: SB,
  numeros: readonly (string | null | undefined)[]
): Promise<Map<string, Tenant>> {
  const unicos = [...new Set(numeros.map(normalizarNumeroContrato).filter((n): n is string => !!n))];
  if (!unicos.length) return new Map();
  try {
    const { data, error } = await sbSesion
      .from("ventas")
      .select("numero_contrato, tenant")
      .in("numero_contrato", unicos);
    if (error) return new Map();
    const autorizados = new Map<string, Tenant>();
    for (const v of data ?? []) {
      const tenant = esTenant(v.tenant) ? v.tenant : null;
      if (tenant) autorizados.set(v.numero_contrato, tenant);
    }
    return autorizados;
  } catch {
    return new Map();
  }
}
