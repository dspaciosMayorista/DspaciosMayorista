// Huella de un documento DIAN, para decidir si dos filas son el MISMO documento.
//
// Esto es el APOYO de la idempotencia, NO la idempotencia misma: hoy no hay
// ninguna restricción en base de datos que la aplique, y este módulo no crea
// ninguna. Solo produce una clave estable y legible para que, más adelante, un
// índice único o una comparación en la bandeja tengan contra qué trabajar.
//
// Regla de negocio (la decidió el usuario al validar el diseño):
//
//   misma clave  → el mismo documento: NO se duplica, se ignora la segunda vez.
//   misma clave y total DISTINTO → el emisor cambió el documento o algo se
//   dañó: NO se descarta, se marca como discrepante para que una persona la
//   mire. Nunca se "arregla" en silencio.
//
// El CUFE/CUDE manda cuando existe: es lo único que la DIAN garantiza único. El
// (proveedor, tipo, número, fecha) es el respaldo para cuando el documento no
// trae CUFE — que es el caso normal de un Excel sin esa columna.

import { normalizarCufe, pareceCufe } from "./normalizar.ts";
import type { DocumentoDian } from "./tipos.ts";

export type ClaveDocumento = {
  /** Llave de comparación. */
  clave: string;
  /** De dónde salió: "cufecude" o "proveedor_tipo_numero_fecha". */
  base: "cufecude" | "proveedor_tipo_numero_fecha";
};

/** Identificador preferido: CUFE (factura) o CUDE (nota), si parece válido. */
export function identificadorDe(d: DocumentoDian): string | null {
  const crudo = d.cufe ?? d.cude;
  const v = normalizarCufe(crudo);
  return v && pareceCufe(v) ? v : null;
}

/** Llave de comparación del documento. */
export function claveDocumento(d: DocumentoDian): ClaveDocumento {
  const id = identificadorDe(d);
  if (id) return { clave: `CUFE:${id}`, base: "cufecude" };

  const nit = d.proveedor.nit ?? d.proveedor.identificacion ?? "SIN_NIT";
  const tipo = d.tipoDocumento;
  const numero = (d.numero ?? "SIN_NUMERO").replace(/[\s-]/g, "");
  const fecha = d.fecha || "SIN_FECHA";
  return { clave: `REF:${nit}:${tipo}:${numero}:${fecha}`, base: "proveedor_tipo_numero_fecha" };
}

/**
 * Cómo se relaciona un documento con otro ya visto: misma clave con el mismo
 * total es duplicado puro; misma clave con otro total es discrepante y exige
 * revisión humana; clave distinta es un documento nuevo.
 */
export type Relacion = "nuevo" | "duplicado" | "discrepante";

export function relacionar(nuevo: DocumentoDian, previo: { clave: string; total: number }): Relacion {
  const k = claveDocumento(nuevo).clave;
  if (k !== previo.clave) return "nuevo";
  return Math.abs(previo.total - nuevo.aritmetica.totalDeclarado) <= 0.01 ? "duplicado" : "discrepante";
}
