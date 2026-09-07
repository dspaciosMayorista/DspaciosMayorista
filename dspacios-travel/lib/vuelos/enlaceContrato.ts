import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.ts";

type SB = SupabaseClient<Database>;

/**
 * "Editar en contrato" en el renglón subordinado de cada infante del
 * manifiesto de vuelo (detalle de bloqueo y listado global de pasajeros).
 *
 * El enlace abre la ficha INTERNA del contrato real al que pertenece el
 * infante (`/dashboard/contratos/{numero_contrato}` — ver
 * `app/(dashboard)/dashboard/contratos/[numero]/page.tsx`). Por eso SOLO debe
 * mostrarse cuando el usuario que está mirando el vuelo puede abrir ese
 * contrato; si no puede, el renglón informativo queda sin acción y no se
 * revela la ruta de un contrato (p. ej. cross-tenant) al que ese rol/tenant
 * no tendría acceso de todos modos.
 *
 * La pregunta "¿puede este usuario abrir el contrato?" NO es la misma que
 * resuelve `lib/vuelos/contratoManual.ts` (`resolverManifiestoAutorizado`):
 * allá se decide qué contrato ES una referencia manual y hace falta un
 * cliente ADMIN porque la RLS del usuario ocultaría la ambigüedad o la
 * existencia del otro tenant. Acá el número ya es el `numero_contrato` real
 * del infante (sale de `contrato_pasajeros`) y lo único que se decide es el
 * acceso de QUIEN CONSULTA — exactamente lo que responde la RLS del cliente
 * de SESIÓN leyendo `ventas` con la MISMA consulta que hace la ficha del
 * contrato:
 *   - `superadmin`/`gerencia` → ven ambos tenants (`puede_ver_tenant`),
 *   - `administracion`/`operaciones` → solo el de su tenant fijo,
 *   - `control_vuelo`/`venta` → no pasan la policy "lectura operativa"
 *     (migración 116), así que la lectura devuelve 0 filas → nunca enlace.
 * Nunca se usa aquí el cliente admin/service-role.
 */

/** Recorta espacios; cadena vacía (o solo espacios) se trata como ausente. */
export function normalizarNumeroContrato(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  return t ? t : null;
}

/**
 * Pura: dado el `numero_contrato` de un infante (número interno REAL, tal
 * cual existe en `ventas` — nunca un crudo de `contrato_manual`) y el
 * conjunto de contratos que el usuario actual puede abrir, devuelve ese
 * número (para enlazarlo) o `null` (sin enlace). Fail-closed: un candidato
 * vacío, o un número que no está en el conjunto autorizado —por no ser una
 * venta o por ser de un tenant que este usuario no puede abrir— NO genera
 * enlace, y nunca se antepone un prefijo por su cuenta.
 */
export function numeroContratoEnlazable(
  candidato: string | null | undefined,
  autorizados: ReadonlySet<string>
): string | null {
  const numero = normalizarNumeroContrato(candidato);
  return numero && autorizados.has(numero) ? numero : null;
}

/**
 * IO — resuelve EN LOTE, con una sola consulta a `ventas` por página (nunca
 * una por infante ni por renglón), qué contratos del conjunto puede abrir el
 * usuario de la sesión. Devuelve el conjunto de `numero_contrato` que la RLS
 * le deja ver. Fail-closed: sin candidatos, error de red o RLS que no deje
 * ver nada → conjunto vacío (ningún enlace). Los candidatos repetidos se
 * deduplican y los vacíos se descartan aquí, así el llamador puede pasar la
 * lista cruda de todos los infantes del manifiesto.
 */
export async function contratosQuePuedeAbrir(
  sbSesion: SB,
  numeros: readonly (string | null | undefined)[]
): Promise<Set<string>> {
  const unicos = [...new Set(numeros.map(normalizarNumeroContrato).filter((n): n is string => !!n))];
  if (!unicos.length) return new Set();
  try {
    const { data, error } = await sbSesion.from("ventas").select("numero_contrato").in("numero_contrato", unicos);
    if (error) return new Set();
    return new Set((data ?? []).map((v) => v.numero_contrato));
  } catch {
    return new Set();
  }
}
