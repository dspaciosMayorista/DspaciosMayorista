// ─────────────────────────────────────────────────────────────────────────
// Fase 3B Bernalo — resolución inequívoca de la tarifa Bernalo PUBLICADA
// aplicable, dado hotel + temporada (ya resuelta por el calendario
// autoritativo) + categoría + alimentación.
//
// Objetivo de este archivo, y SOLO este (ver el informe de Fase 3 entregado
// con la tarea): elegir, entre las filas de `hotel_tarifas_unidad` de un
// hotel, EXACTAMENTE una fila `publicada` que coincida LITERALMENTE con la
// clasificación pedida — nunca "la más reciente", "la primera", ni ninguna
// heurística de desempate. Cero o más de una coincidencia son resultados
// bloqueados explícitos, no una elección implícita.
//
// Fuera de alcance de este archivo (fases futuras, explícitamente):
//   - Resolver la TEMPORADA en sí (`hotel_temporadas` sigue siendo el
//     calendario autoritativo, resuelto en otro lugar — este módulo recibe
//     la temporada ya decidida como un simple string|null, nunca calcula
//     fechas ni vigencias).
//   - Cotizar nada: este módulo entrega una `TarifaAlojamiento` adaptada,
//     no un `ResultadoValido` (eso es `cotizarUnidadAlojamiento`/
//     `cotizarHabitaciones`, Fase 3A).
//   - Levantar las guardias de `computo.ts`/`generarTarifario` — siguen
//     vigentes, sin tocar.
//   - Cualquier escritura, UI, contrato o CxP.
//   - Consultar Supabase: este archivo es PURO. Recibe las filas YA
//     leídas (como `unknown[]`) — quien las consulta es la frontera
//     server-side aparte (`lib/reservar/resolverTarifaAlojamientoBernalo.ts`).
//
// Reutiliza `adaptarTarifaAlojamientoPersistida` (Fase 1) tal cual: este
// archivo NO reconstruye ni valida payloads a mano — solo decide CUÁL fila
// (entre las que coinciden por columnas crudas) le corresponde adaptar.
// ─────────────────────────────────────────────────────────────────────────

import {
  adaptarTarifaAlojamientoPersistida,
  type TarifaUnidadRechazada,
} from "./tarifaAlojamientoPersistida.ts";
import type { TarifaAlojamiento } from "./unidadAlojamiento.ts";

// ── Criterio de búsqueda ─────────────────────────────────────────────────
// `null` significa "ausencia" (ej. hotel sin categorías), NUNCA "cualquiera"
// — una fila con `temporada: null` solo coincide con `criterio.temporada:
// null`, jamás con una temporada nombrada ni al revés.
export type CriterioResolucionTarifa = {
  hotelId: number;
  temporada: string | null;
  categoria: string | null;
  alimentacion: string | null;
};

// ── Resultado ─────────────────────────────────────────────────────────────
export type ResolucionTarifaOk = {
  ok: true;
  // Identidad y versión de la fila resuelta — se conservan tal cual las
  // devolvió el adaptador (Fase 1), sin reconstruirlas.
  id: number | null;
  hotelId: number;
  estado: "publicada";
  clasificacion: { temporada: string | null; categoria: string | null; alimentacion: string | null };
  // La tarifa adaptada COMPLETA — exactamente lo que `cotizarUnidadAlojamiento`
  // necesita, sin recorte.
  tarifa: TarifaAlojamiento;
};

export type CodigoResolucionTarifa = "tarifa_no_encontrada" | "tarifa_ambigua" | "tarifa_invalida";

export type ResolucionTarifaBloqueada = {
  ok: false;
  codigo: CodigoResolucionTarifa;
  mensaje: string;
  contexto: Record<string, unknown>;
  // Presente solo cuando `codigo === "tarifa_invalida"`: el rechazo original
  // del adaptador (Fase 1), para diagnóstico completo sin tener que
  // reconstruirlo desde `contexto`.
  rechazo?: TarifaUnidadRechazada;
};

export type ResultadoResolucionTarifa = ResolucionTarifaOk | ResolucionTarifaBloqueada;

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// `undefined` (columna ausente en el objeto recibido) se trata igual que
// `null` (columna nullable sin valor) — las dos formas significan "ausencia"
// para efectos de esta comparación. Cualquier otra cosa se compara literal.
function normalizarAusencia(v: unknown): unknown {
  return v === undefined ? null : v;
}

// Coincidencia EXACTA por columnas CRUDAS — nunca se abre el payload para
// decidir si una fila participa. Solo filas `publicada` (regla 2); el resto
// de campos comparan con igualdad estricta, `null` incluido (regla 4).
function esCandidataExacta(filaDesconocida: unknown, criterio: CriterioResolucionTarifa): filaDesconocida is Record<string, unknown> {
  if (!esObjeto(filaDesconocida)) return false;
  if (filaDesconocida.estado !== "publicada") return false;
  if (filaDesconocida.hotel_id !== criterio.hotelId) return false;
  if (normalizarAusencia(filaDesconocida.temporada) !== criterio.temporada) return false;
  if (normalizarAusencia(filaDesconocida.categoria) !== criterio.categoria) return false;
  if (normalizarAusencia(filaDesconocida.alimentacion) !== criterio.alimentacion) return false;
  return true;
}

function describirCriterio(c: CriterioResolucionTarifa): string {
  const f = (v: string | null) => (v === null ? "(ninguna)" : v);
  return `hotel_id=${c.hotelId}, temporada=${f(c.temporada)}, categoria=${f(c.categoria)}, alimentacion=${f(c.alimentacion)}`;
}

/**
 * Selecciona, entre `filas` (ya leídas de `hotel_tarifas_unidad`, en
 * cualquier orden — este resolver NUNCA depende del orden de entrada),
 * exactamente la fila `publicada` que coincide LITERALMENTE con `criterio`.
 *
 * - 0 coincidencias → bloqueado `tarifa_no_encontrada`.
 * - >1 coincidencias → bloqueado `tarifa_ambigua` (con las identidades de
 *   TODAS las candidatas, para diagnóstico — nunca se elige ninguna).
 * - 1 coincidencia, pero la fila es incoherente/inválida → bloqueado
 *   `tarifa_invalida` (fail-closed: no se busca una fila de repuesto).
 * - 1 coincidencia válida → éxito, con la tarifa adaptada completa.
 *
 * Puro: no consulta nada, no tiene efectos, no depende de `Date` ni de
 * aleatoriedad — la misma entrada produce siempre el mismo resultado.
 */
export function seleccionarTarifaAlojamientoPublicada(
  filas: unknown[],
  criterio: CriterioResolucionTarifa
): ResultadoResolucionTarifa {
  const candidatas = filas.filter((f) => esCandidataExacta(f, criterio));

  if (candidatas.length === 0) {
    return {
      ok: false,
      codigo: "tarifa_no_encontrada",
      mensaje: `No hay ninguna tarifa Bernalo publicada para ${describirCriterio(criterio)}.`,
      contexto: { ...criterio },
    };
  }

  if (candidatas.length > 1) {
    const identidades = candidatas.map((f) => ({
      id: (f as Record<string, unknown>).id ?? null,
      tarifaId: (f as Record<string, unknown>).tarifa_id ?? null,
      versionTarifario: (f as Record<string, unknown>).version_tarifario ?? null,
    }));
    return {
      ok: false,
      codigo: "tarifa_ambigua",
      mensaje: `Hay ${candidatas.length} tarifas publicadas para ${describirCriterio(criterio)} — no se puede elegir sin un criterio de negocio adicional. Corrige el catálogo (debe quedar exactamente una publicada por clasificación) antes de cotizar.`,
      contexto: { ...criterio, candidatas: identidades },
    };
  }

  // Exactamente una candidata: se adapta con el mecanismo real (Fase 1) —
  // sin reconstruir ni relajar ninguna validación.
  const adaptada = adaptarTarifaAlojamientoPersistida(candidatas[0]);
  if (!adaptada.ok) {
    return {
      ok: false,
      codigo: "tarifa_invalida",
      mensaje: `La única fila publicada para ${describirCriterio(criterio)} no es una tarifa válida: ${adaptada.mensaje}`,
      contexto: { ...criterio },
      rechazo: adaptada,
    };
  }

  // Defensa en profundidad: `esCandidataExacta` ya exige `estado ===
  // "publicada"` antes de llegar aquí, así que esto nunca debería disparar
  // — pero si algún día cambiara el orden de las comprobaciones, prefiere
  // fallar cerrado a devolver un `estado` que no fue el filtrado.
  if (adaptada.estado !== "publicada") {
    return {
      ok: false,
      codigo: "tarifa_invalida",
      mensaje: `Inconsistencia interna: la fila filtrada como "publicada" resolvió a estado "${adaptada.estado}".`,
      contexto: { ...criterio },
    };
  }

  return {
    ok: true,
    id: adaptada.id,
    hotelId: adaptada.hotelId,
    estado: adaptada.estado,
    clasificacion: { temporada: criterio.temporada, categoria: criterio.categoria, alimentacion: criterio.alimentacion },
    tarifa: adaptada.tarifa,
  };
}
