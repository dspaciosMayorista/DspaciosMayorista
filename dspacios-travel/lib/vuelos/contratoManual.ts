import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.ts";
import { numeroConTenant } from "../tenant.ts";

type SB = SupabaseClient<Database>;

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
 * Envoltorio de conveniencia: dadas las referencias manuales crudas de una
 * página (pueden repetirse, venir null/vacías), hace la ÚNICA consulta
 * necesaria y devuelve el mapa resuelto (referencia normalizada →
 * numero_contrato interno). Fail-closed por diseño (ver
 * `resolverReferenciasManuales`): una referencia que no resuelve a nada
 * simplemente no aparece en el mapa devuelto.
 */
export async function resolverReferenciasManualesDesdeDB(
  sb: SB,
  referencias: readonly (string | null | undefined)[]
): Promise<Map<string, string>> {
  const normalizadas = [...new Set(referencias.map(normalizarReferenciaManual).filter((r): r is string => !!r))];
  if (!normalizadas.length) return new Map();
  const todosLosCandidatos = [...new Set(normalizadas.flatMap(candidatosNumeroContrato))];
  const existentes = await buscarNumerosContratoExistentes(sb, todosLosCandidatos);
  return resolverReferenciasManuales(normalizadas, existentes);
}
