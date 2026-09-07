import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.ts";
import { numeroConTenant } from "../tenant.ts";
import { LECTURA_MODULO } from "../constants.ts";
import { createAdminClient } from "../supabase/admin.ts";

type SB = SupabaseClient<Database>;

/** Un infante tal como lo devuelve `contrato_pasajeros` (nunca ocupa silla). */
export type InfantePasajero = {
  id: number;
  nombre: string;
  tipo_id: string | null;
  identificacion: string | null;
  numero_contrato: string;
};

/**
 * `sillas.contrato_manual` (migración 085) existe para ventas EXTERNAS al
 * sistema — texto libre, sin FK. Pero en la práctica un asesor puede haber
 * usado ese mismo campo para asociar un bloqueo a una venta INTERNA real
 * (típicamente minorista, que no tiene tarifario/reservar y por tanto no
 * tiene otro camino para enlazar un vuelo), escribiendo el número "crudo"
 * sin el prefijo de tenant — ej. "00-0541" en vez de "MIN-00-0541". Cuando
 * eso pasa, el infante vinculado a esa venta (contrato_pasajeros.
 * numero_contrato = 'MIN-00-0541') queda invisible en los listados de vuelo,
 * que solo buscan infantes por `sillas.numero_contrato` (el contrato
 * ORGÁNICO, con FK) — ver vuelos/[id]/page.tsx y vuelos/pasajeros/page.tsx.
 *
 * Este módulo resuelve, de forma SEGURA, si una referencia manual coincide
 * con una venta interna real — sin inventar ni suponer nada:
 *   - nunca antepone "MIN-" a ciegas: solo lo hace como UN candidato más,
 *     y exige que ese candidato exista de verdad en `ventas`;
 *   - nunca resuelve una referencia si hay más de una venta candidata (la
 *     numeración es independiente por tenant — un mismo número crudo podría
 *     coincidir, por accidente, con un contrato mayorista Y uno minorista;
 *     ver lib/tenant.ts) — ambigüedad real, no se adivina cuál es;
 *   - si no hay NINGUNA venta candidata, la referencia sigue tratándose como
 *     lo que declara ser: un contrato manual puramente externo, sin cambios
 *     de comportamiento.
 */

/** Recorta espacios; cadena vacía (o solo espacios) se trata como ausente. */
export function normalizarReferenciaManual(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  return t ? t : null;
}

/**
 * Candidatos de `numero_contrato` interno para una referencia manual YA
 * normalizada (no vacía). Pura — no consulta nada, solo enumera las formas
 * bajo las que esa MISMA referencia podría estar guardada como venta real,
 * según la convención vigente de prefijos por tenant (lib/tenant.ts):
 *   - tal cual (un contrato mayorista, o uno de cualquier tenant guardado
 *     sin prefijo — la numeración histórica/legada no siempre lo tuvo);
 *   - con el prefijo "MIN-" (un contrato minorista), solo si no lo trae ya.
 * Deduplicado — para una referencia que YA viene con "MIN-" da un único
 * candidato (ella misma), nunca "MIN-MIN-...".
 */
export function candidatosNumeroContrato(referencia: string): string[] {
  const candidatos = new Set<string>();
  candidatos.add(referencia);
  candidatos.add(numeroConTenant(referencia, "minorista"));
  return [...candidatos];
}

/**
 * Dado el conjunto de `numero_contrato` que SÍ existen como venta real
 * (`numerosExistentes`), resuelve cada referencia manual a, como mucho, UNA
 * venta interna — o la omite (fail-closed) si es ambigua o no hay ninguna.
 * Pura y determinista: no decide "cuál" ante un empate, nunca vincula al
 * azar. Deduplica referencias repetidas (misma clave normalizada).
 */
export function resolverReferenciasManuales(
  referencias: readonly (string | null | undefined)[],
  numerosExistentes: ReadonlySet<string>
): Map<string, string> {
  const resultado = new Map<string, string>();
  for (const raw of referencias) {
    const referencia = normalizarReferenciaManual(raw);
    if (!referencia || resultado.has(referencia)) continue;
    const candidatosPresentes = candidatosNumeroContrato(referencia).filter((c) =>
      numerosExistentes.has(c)
    );
    if (candidatosPresentes.length === 1) {
      resultado.set(referencia, candidatosPresentes[0]);
    }
    // 0 candidatos: sigue siendo puramente externa (sin cambios).
    // ≥2 candidatos: ambigua — fail-closed, tampoco se vincula.
  }
  return resultado;
}

/**
 * IO — única consulta a `ventas` para TODOS los candidatos de TODAS las
 * referencias manuales de una página (evita N consultas, una por silla).
 * Devuelve solo los `numero_contrato` que existen de verdad.
 */
export async function buscarNumerosContratoExistentes(
  sb: SB,
  candidatos: readonly string[]
): Promise<Set<string>> {
  if (!candidatos.length) return new Set();
  const { data } = await sb.from("ventas").select("numero_contrato").in("numero_contrato", candidatos);
  return new Set((data ?? []).map((v) => v.numero_contrato));
}

/**
 * ⚠️ CORRECCIÓN POST-REVISIÓN (PR #289): la primera versión de este módulo
 * traía `resolverReferenciasManualesDesdeDB(sb, referencias)`, que hacía la
 * consulta a `ventas` con el CLIENTE DE SESIÓN (sometido a RLS). Eso rompía
 * la garantía "ambiguo → fail-closed" exactamente donde más importa: la
 * policy `"ventas: lectura operativa"` (migración 116) exige
 * `puede_ver_tenant(tenant)`, que para `administracion`/`operaciones` (no
 * `superadmin`/`gerencia`) solo es verdad para SU tenant fijo — un rol de
 * mayorista, viendo un bloqueo COMPARTIDO (`bloqueos_vuelo`/`sillas` no
 * tienen columna de tenant, así que un mismo vuelo puede tener sillas de
 * cualquiera de los dos tenants), consultando `ventas` con su propio
 * cliente de sesión:
 *   - si '00-0541' (mayorista) Y 'MIN-00-0541' (minorista) existen de
 *     verdad, ese usuario solo VE el candidato de su propio tenant — la
 *     función concluía "único candidato" cuando en realidad había DOS:
 *     ambigüedad real, oculta por RLS, resuelta como si no lo fuera;
 *   - si la venta real es la del OTRO tenant (el caso reportado), ese
 *     mismo usuario no ve NINGÚN candidato — el caso legítimo nunca se
 *     resolvía para él, aunque el vuelo sí le esté autorizado.
 * La cadena completa se auditó: el MISMO problema afectaba después a la
 * consulta de `contrato_pasajeros` (RLS vía `puede_ver_contrato()`, que
 * hereda `puede_ver_tenant()` de `ventas`) — corregir solo la resolución de
 * `ventas` habría dejado al infante igual de invisible.
 *
 * La corrección NO acota ni intenta adivinar mejor — cambia DE CLIENTE:
 * `resolverManifiestoAutorizado()` primero AUTORIZA con el cliente de
 * SESIÓN (única fuente: `mi_rol()`, la misma función que ya usan las RLS y
 * que `proxy.ts` usa indirectamente vía `LECTURA_MODULO` para decidir quién
 * entra al módulo Vuelos) y SOLO si el rol pertenece a ese módulo construye
 * un cliente ADMIN (`service_role`, sin RLS) para las dos lecturas que de
 * verdad necesitan ver la tabla completa: la existencia en `ventas` (para
 * la ambigüedad) y los infantes en `contrato_pasajeros` (para que el
 * manifiesto se muestre completo, no solo lo que el tenant del usuario
 * alcanza a ver). El cliente admin nunca se construye si la autorización
 * falla, y nunca sale de este módulo server-only.
 */

/**
 * Autoriza con el cliente de SESIÓN — nunca con el admin — usando `mi_rol()`
 * (RPC `security definer`, la misma fuente de verdad que las policies RLS y
 * que `proxy.ts` consulta para decidir el acceso al módulo Vuelos). Se
 * reutiliza `LECTURA_MODULO.vuelos` (lib/constants.ts) en vez de duplicar la
 * lista de roles: si ese módulo cambia de roles algún día, esta función
 * cambia con él, nunca queda un candado desalineado. Fail-closed: cualquier
 * error, rol nulo (usuario inactivo — migración 140) o rol fuera de la lista
 * devuelve `false`, sin excepción.
 */
export async function usuarioAutorizadoParaVuelos(sbSesion: SB): Promise<boolean> {
  try {
    const { data: rol, error } = await sbSesion.rpc("mi_rol");
    if (error || !rol) return false;
    return (LECTURA_MODULO.vuelos as readonly string[]).includes(rol);
  } catch {
    return false;
  }
}

/**
 * Punto de entrada ÚNICO para el manifiesto de infantes de un
 * bloqueo/listado que el llamador YA cargó y filtró con el cliente de
 * sesión (`contratosOrganicos`/`referenciasManuales` deben salir SIEMPRE de
 * las sillas ya leídas — nunca de un valor que el navegador pueda inyectar
 * suelto, esta función no acepta ningún identificador que no venga de ahí).
 *
 * 1) Autoriza con el cliente de SESIÓN (`usuarioAutorizadoParaVuelos`). Si
 *    no autoriza, devuelve vacío sin construir el cliente admin ni tocarlo
 *    en ningún momento — "sin acceso al módulo" y "sin contratos que
 *    mostrar" se ven exactamente igual desde fuera.
 * 2) Con el cliente ADMIN (recién autorizado, nunca antes), resuelve las
 *    referencias manuales contra la `ventas` COMPLETA — ve ambos tenants,
 *    así que una ambigüedad real entre '00-0541' y 'MIN-00-0541' se detecta
 *    siempre, la vea o no el tenant del usuario.
 * 3) Con el MISMO cliente admin, trae los infantes de TODOS los contratos
 *    (orgánicos + resueltos) — así el infante de un contrato del otro
 *    tenant también se MUESTRA, no solo se detecta que existe.
 *
 * `crearClienteAdmin` es un punto de inyección para pruebas (por defecto,
 * `createAdminClient` real) — nunca se expone ni se usa fuera de este
 * módulo server-only.
 */
export async function resolverManifiestoAutorizado(
  sbSesion: SB,
  contratosOrganicos: readonly string[],
  referenciasManuales: readonly (string | null | undefined)[],
  crearClienteAdmin: () => SB = () => createAdminClient() as unknown as SB
): Promise<{ infantes: InfantePasajero[]; referenciaManualPorContrato: Map<string, string> }> {
  const vacio = { infantes: [] as InfantePasajero[], referenciaManualPorContrato: new Map<string, string>() };

  if (!(await usuarioAutorizadoParaVuelos(sbSesion))) return vacio;

  let admin: SB;
  try {
    admin = crearClienteAdmin();
  } catch {
    // Sin SUPABASE_SERVICE_ROLE_KEY (o cualquier fallo al construirlo): no
    // hay forma segura de hacer la lectura cross-tenant — se degrada a "sin
    // contratos manuales resueltos", nunca se cae al cliente de sesión (eso
    // reabriría exactamente el problema que motiva este módulo).
    return vacio;
  }

  const normalizadas = [...new Set(referenciasManuales.map(normalizarReferenciaManual).filter((r): r is string => !!r))];
  let referenciaManualPorContrato = new Map<string, string>();
  if (normalizadas.length) {
    const candidatos = [...new Set(normalizadas.flatMap(candidatosNumeroContrato))];
    const existentes = await buscarNumerosContratoExistentes(admin, candidatos);
    referenciaManualPorContrato = resolverReferenciasManuales(normalizadas, existentes);
  }

  const contratos = [...new Set([...contratosOrganicos, ...referenciaManualPorContrato.values()])];
  if (!contratos.length) return { infantes: [], referenciaManualPorContrato };

  const { data } = await admin
    .from("contrato_pasajeros")
    .select("id, nombre, tipo_id, identificacion, numero_contrato")
    .eq("es_infante", true)
    .in("numero_contrato", contratos);

  return { infantes: data ?? [], referenciaManualPorContrato };
}
