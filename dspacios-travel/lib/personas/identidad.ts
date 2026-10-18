// Gramática documental del registro central de personas (#32, migración 214).
//
// Es la MISMA lógica que `p214_priv.norm_documento` y `p214_priv.dv_nit_valido` en SQL. La
// equivalencia no se supone: la prueban los vectores compartidos de
// `pruebas/fixtures/personasIdentidad.vectores.json`, que recorren a la vez la prueba de
// TypeScript y la de SQL. Reglas completas: docs/tecnico/personas-identidad.md, sección 2.
//
// Para que TS y SQL no disientan por locale o Unicode, este archivo solo usa rangos ASCII
// explícitos: nada de trim(), toUpperCase/toLowerCase, normalize, clases de dígito, espacio o
// palabra escritas con barra invertida, ni expresiones con banderas que cambien el alfabeto.
// Lo vigila pruebas/personasConsulta.wiring.test.ts.

export const TIPOS_DOC_PERSONA = ["CC", "CE", "TI", "RC", "PAS", "PPT", "NIT"] as const;
export type TipoDocPersona = (typeof TIPOS_DOC_PERSONA)[number];

/** Tipos cuyo número es solo dígitos (CE incluida: default V1 aceptado). */
const TIPOS_NUMERICOS: readonly string[] = ["CC", "CE", "TI", "RC", "NIT"];

/** Máximo de puntos de código de un original (R0). Más allá, el escritor rechaza: no se trunca. */
export const ORIGINAL_MAX_PUNTOS = 64;
/** Longitud del número ya sin separadores (R4), también para la base de un NIT. */
export const NUMERO_MIN = 3;
export const NUMERO_MAX = 20;

export type ModoGramatica = "alta" | "consulta";
export type EstadoDoc = "documentada" | "provisional" | "revision";
export type MotivoRevision = "tipo_invalido" | "numero_invalido" | "nit_sin_dv_estructurado";

export type ResultadoGramatica = {
  tipo_doc: TipoDocPersona | null;
  numero_norm: string | null;
  estado: EstadoDoc;
  motivo: MotivoRevision | null;
};

/**
 * Entrada que no puede llegar a la base (U+0000 o un surrogate suelto) o llamada mal formada
 * (modo desconocido, marca NIT incoherente con el modo). Es un error, no una ficha.
 */
export class ErrorEntradaDocumento extends Error {
  readonly codigo: string;
  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.name = "ErrorEntradaDocumento";
    this.codigo = codigo;
  }
}

const RE_TIPO = /^[A-Za-z]+$/;
const RE_NUMERO = /^[A-Za-z0-9]+([ .][A-Za-z0-9]+)*$/;
const RE_DIGITOS = /^[0-9]+$/;
const RE_DV = /^[0-9]$/;

/** R1: quita SOLO espacios ASCII U+0020 de los bordes (SQL: btrim(x, ' ')). */
export function recortarAscii(x: string): string {
  return x.replace(/^ +| +$/g, "");
}

function mayusculasAscii(x: string): string {
  return x.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));
}

function minusculasAscii(x: string): string {
  return x.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/** Número de puntos de código (SQL: char_length). No usa `length`, que cuenta unidades UTF-16. */
export function puntosDeCodigo(x: string): number {
  return Array.from(x).length;
}

/** R0: ¿cabe un original? `null` (no enviado) siempre cabe. */
export function cabeOriginal(x: string | null): boolean {
  return x === null || puntosDeCodigo(x) <= ORIGINAL_MAX_PUNTOS;
}

/** ¿Se puede guardar en un `text` de Postgres? (sin U+0000 ni surrogates sueltos). */
export function esRepresentable(x: string): boolean {
  for (let i = 0; i < x.length; i++) {
    const u = x.charCodeAt(i);
    if (u === 0) return false;
    if (u >= 0xd800 && u <= 0xdbff) {
      const siguiente = i + 1 < x.length ? x.charCodeAt(i + 1) : -1;
      if (siguiente < 0xdc00 || siguiente > 0xdfff) return false;
      i++;
      continue;
    }
    if (u >= 0xdc00 && u <= 0xdfff) return false;
  }
  return true;
}

function revision(tipo: TipoDocPersona | null, motivo: MotivoRevision): ResultadoGramatica {
  return { tipo_doc: tipo, numero_norm: null, estado: "revision", motivo };
}

/**
 * Gramática única (2.2 y 2.3 del documento técnico). Devuelve tipo y número normalizados,
 * estado y motivo; nunca modifica ni recorta los originales.
 *
 * - `modo = "alta"`: `nitDvEstructurado` es obligatorio (true solo si el escritor ya validó un DV
 *   de un dígito con `dvNitValido`).
 * - `modo = "consulta"`: `nitDvEstructurado` debe ser null; la búsqueda es por la base del NIT.
 */
export function normalizarDocumento(entrada: {
  tipo: string | null;
  numero: string | null;
  nitDvEstructurado: boolean | null;
  modo: ModoGramatica;
}): ResultadoGramatica {
  const { tipo, numero, nitDvEstructurado, modo } = entrada;
  if (modo !== "alta" && modo !== "consulta") {
    throw new ErrorEntradaDocumento("modo_invalido", "El modo debe ser alta o consulta.");
  }
  if (modo === "alta" && nitDvEstructurado === null) {
    throw new ErrorEntradaDocumento("marca_obligatoria", "En modo alta la marca NIT es obligatoria.");
  }
  if (modo === "consulta" && nitDvEstructurado !== null) {
    throw new ErrorEntradaDocumento("marca_no_admitida", "En modo consulta la marca NIT debe ser nula.");
  }
  if ((tipo !== null && !esRepresentable(tipo)) || (numero !== null && !esRepresentable(numero))) {
    throw new ErrorEntradaDocumento("error_entrada", "El documento contiene caracteres que no se pueden guardar.");
  }

  const t = tipo === null ? null : recortarAscii(tipo);
  const n = numero === null ? null : recortarAscii(numero);

  // R2 · tipo: ausente, presente inválido o del catálogo.
  const tipoAusente = t === null || t === "";
  let tipoDoc: TipoDocPersona | null = null;
  if (t !== null && t !== "") {
    if (!RE_TIPO.test(t)) return revision(null, "tipo_invalido");
    const mayus = mayusculasAscii(t);
    if (!(TIPOS_DOC_PERSONA as readonly string[]).includes(mayus)) return revision(null, "tipo_invalido");
    tipoDoc = mayus as TipoDocPersona;
  }

  if (tipoAusente || n === null || n === "") {
    return { tipo_doc: tipoDoc, numero_norm: null, estado: "provisional", motivo: null };
  }

  // R3 · alfabeto ASCII con separadores de formato (espacio y punto) solo entre grupos.
  if (!RE_NUMERO.test(n)) return revision(tipoDoc, "numero_invalido");
  const compacto = n.replace(/[ .]/g, "");

  // R4 · longitud 3-20 y forma por tipo (también la base de un NIT).
  if (compacto.length < NUMERO_MIN || compacto.length > NUMERO_MAX) return revision(tipoDoc, "numero_invalido");
  if (tipoDoc !== null && TIPOS_NUMERICOS.includes(tipoDoc) && !RE_DIGITOS.test(compacto)) {
    return revision(tipoDoc, "numero_invalido");
  }

  // 2.3 regla 4 · un NIT de alta sin DV estructurado válido queda en revisión (sin recortar).
  if (modo === "alta" && tipoDoc === "NIT" && nitDvEstructurado === false) {
    return revision(tipoDoc, "nit_sin_dv_estructurado");
  }

  // R5 · normalización: sin separadores, minúsculas ASCII, ceros iniciales intactos.
  return { tipo_doc: tipoDoc, numero_norm: minusculasAscii(compacto), estado: "documentada", motivo: null };
}

/** DV de NIT estructurado: R1 y luego exactamente un dígito ASCII (SQL: p214_priv.dv_nit_valido). */
export function dvNitValido(dv: string | null): boolean {
  if (dv === null) return false;
  return RE_DV.test(recortarAscii(dv));
}
