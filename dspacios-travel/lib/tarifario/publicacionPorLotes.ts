// ─────────────────────────────────────────────────────────────────────────────
// Publicación del tarifario POR LOTES — parte pura del cliente (la usa `controladorPublicacion.ts`; el lado de la base es la migración 260).
// Diseño y pruebas: docs/tecnico/publicador-tarifario-lotes.md · supabase/migrations/20260601000260_publicacion_tarifario_por_lotes.sql.
//
// Qué hace: trocea las filas ya calculadas en lotes de TEXTO EXACTO, calcula la huella SHA-256 de cada texto y arma el manifiesto que el servidor fija ANTES de
// cargar. El texto que se hashea es exactamente el que se envía (`p_filas_txt`); el servidor vuelve a hashear los bytes UTF-8 recibidos y rechaza cualquier lote que no
// coincida, por lo que no depende de cómo se serialice un jsonb. Módulo puro, sin acceso a base de datos.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";

/** Filas por lote. Cada función de lotes fija SU statement_timeout=30s (el 8 s del rol no rige dentro de ella: lo comprueba supabase/scripts/test_lotes_tamano.mjs) y lock_timeout=8s (solo cuenta
 * esperas de candado). Medido con la CPU de producción y la tabla en estado realista (otros paquetes + generación previa + lector): lote más lento 5,5 s con 1.000 filas (5,5× de margen frente a
 * 30 s) y 9,8 s con 1.500 (3,1×). 1.000 deja margen para que la base de producción esté peor que la simulada. */
export const FILAS_POR_LOTE_DEFECTO = 1000;

export type LotePublicacion = { lote: number; filas: number; huella: string; texto: string };
export type EntradaManifiesto = { lote: number; filas: number; huella: string };

/** SHA-256 hexadecimal de los bytes UTF-8 del texto (lo mismo que `encode(sha256(convert_to(texto, 'UTF8')), 'hex')` en la base). */
export function huellaTexto(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/** Trocea las filas en lotes consecutivos (numerados desde 1). El texto de cada lote es `JSON.stringify` del arreglo de sus filas, ya no se vuelve a serializar. */
export function prepararLotes(filas: readonly unknown[], tam: number = FILAS_POR_LOTE_DEFECTO): LotePublicacion[] {
  if (!Number.isInteger(tam) || tam < 1) throw new Error("prepararLotes: el tamaño de lote debe ser un entero >= 1");
  const out: LotePublicacion[] = [];
  for (let i = 0; i < filas.length; i += tam) {
    const trozo = filas.slice(i, i + tam);
    const texto = JSON.stringify(trozo);
    out.push({ lote: out.length + 1, filas: trozo.length, huella: huellaTexto(texto), texto });
  }
  return out;
}

/** El manifiesto que se envía a `tarifario_manifiesto_crear` (sin el texto). */
export function manifiestoDe(lotes: readonly LotePublicacion[]): EntradaManifiesto[] {
  return lotes.map(({ lote, filas, huella }) => ({ lote, filas, huella }));
}

/** Huella del manifiesto completo: la misma que calcula el servidor (`lote:filas:huella` por línea, en orden de lote). Sirve para comprobar que dos cálculos son idénticos. */
export function huellaManifiesto(lotes: readonly LotePublicacion[]): string {
  return huellaTexto(lotes.map((l) => `${l.lote}:${l.filas}:${l.huella}`).join("\n"));
}

/** Lotes que faltan por subir según `tarifario_publicacion_estado.pendientes`. Reanudar = volver a calcular las MISMAS filas y enviar solo estos. */
export function lotesPendientes(lotes: readonly LotePublicacion[], pendientes: readonly number[]): LotePublicacion[] {
  const faltan = new Set(pendientes);
  return lotes.filter((l) => faltan.has(l.lote));
}

export type DecisionLote = "continuar" | "generacion_vieja" | "fuente_cambio" | "contenido_distinto" | "error";

/** Qué hacer con la respuesta de `tarifario_lote_agregar` / `tarifario_manifiesto_crear`. Todo lo que no es `ok` detiene la publicación; nunca se activa a medias. */
export function decisionDeRespuesta(respuesta: string): DecisionLote {
  switch (respuesta) {
    case "ok": return "continuar";
    case "obsoleta": return "generacion_vieja";            // hay una generación más nueva: este cálculo se descarta
    case "fuente_cambio": return "fuente_cambio";          // la fuente cambió de forma que invalida el cálculo: regenerar
    case "conflicto":                                       // el manifiesto ya fijado es de OTRO cálculo
    case "huella":
    case "filas":
    case "lote_desconocido":
    case "sin_manifiesto": return "contenido_distinto";
    default: return "error";
  }
}
