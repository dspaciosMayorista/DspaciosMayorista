// ===========================================================================
// Salesbot — reglas de respuesta.
//
// Fase A. Aquí vive lo que el bot NO puede afirmar, codificado para que no
// dependa de que el modelo "se porte bien".
//
// La idea: la lista blanca de datos permite afirmar; las reglas de este
// archivo Forbidden afirmar. Un prompt puede pedir education; una aserción de
// código, no.
//
// Importante sobre el vocabulario: NO se prohíbe la palabra "cupo" ni la
// pregunta por cupos. El usuario PREGUNTA por cupos y hay que poder
// responderle. Lo que se prohíbe son las AFIRMACIONES comerciales sin respaldo:
// "hay cupos", "disponible", "quedan lugares", "confirmado", "garantizado".
// ===========================================================================

import type {
  SalesbotCodigoError,
  SalesbotContextoLectura,
  SalesbotConsultaError,
  SalesbotError,
  SalesbotPrecioResultado,
} from "@/lib/salesbot/types";

// ─── Etiquetas ─────────────────────────────────────────────────────────────

export const ETIQUETA_ACOMODACION: Record<string, string> = {
  sencilla: "Sencilla",
  doble: "Doble",
  triple: "Triple",
  cuadruple: "Cuádruple",
  multiple: "Múltiple",
  nino: "Niño",
};

export const ETIQUETA_TRANSPORTE: Record<string, string> = {
  aereo: "Con aéreo",
  terrestre: "Salida terrestre",
  ninguno: "Porción terrestre",
};

export function formatearMoneda(monto: number, moneda: string): string {
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: moneda,
      maximumFractionDigits: 0,
    }).format(monto);
  } catch {
    // Moneda desconocida en el dato: se muestra el número sin inventar símbolo.
    return `${monto} ${moneda}`;
  }
}

// ─── Representación de precio ─────────────────────────────────────────────

/**
 * Los tres estados, con la misma semántica de la vitrina pública
 * (`{s.bajo_solicitud ? "A solicitud" : pr?.pvp != null ? formatMoneda(...) : "-"}`).
 *
 * `pvp === null` NUNCA se convierte en 0 y nunca produce un número. El
 * centinela `0` que usa `pvpPrograma` es justamente lo que hay que evitar.
 */
export function representarPrecio(
  precio: Pick<SalesbotPrecioResultado, "pvp" | "estado_precio" | "moneda" | "bajo_solicitud" | "acomodacion">,
): string {
  const etiqueta = ETIQUETA_ACOMODACION[precio.acomodacion] ?? precio.acomodacion;

  if (precio.estado_precio === "A_SOLICITUD" || precio.bajo_solicitud) {
    return `${etiqueta}: a solicitud`;
  }
  if (precio.estado_precio === "CONFIRMADO" && precio.pvp != null) {
    return `${etiqueta}: ${formatearMoneda(precio.pvp, precio.moneda)}`;
  }
  // NO_CONFIRMADO: hay producto pero no hay precio consultable.
  return `${etiqueta}: el precio hay que confirmarlo con un asesor`;
}

/** Un resumen corto para una lista: el precio del catálogo es un "desde". */
export function representarPrecioDesde(desdePvp: number | null, moneda: string): string {
  if (desdePvp == null) return "precio a confirmar";
  return `desde ${formatearMoneda(desdePvp, moneda)}`;
}

/** Una salida con rango de fechas. Si no hay `fecha_hasta`, no se inventa. */
export function representarFechasSalida(s: {
  fecha_desde: string | null;
  fecha_hasta: string | null;
  noches: number | null;
}): string {
  if (s.fecha_desde == null) return "fechas por confirmar";
  const desde = s.fecha_desde;
  if (s.fecha_hasta == null) return `desde el ${desde}`;
  return `del ${desde} al ${s.fecha_hasta}`;
}

// ─── Datos que faltan para cotizar ────────────────────────────────────────

export type DatosViajero = {
  destino?: string | null;
  fecha?: string | null;
  pax?: number | null;
  /** Edad por pasajero: el neto de niño es otro. */
  edades?: number[] | null;
  /** El tipo de alojamiento determina el `neto_*` que se usa. */
  acomodacion?: string | null;
  ocupacion?: string | null;
};

/**
 * `pvpPrograma` elige el neto por acomodación y por edad del pasajero, así
 * que sin esto no hay precio posible. Se devuelve la lista de lo que falta
 * para poder preguntar de una sola vez en vez de ida y vuelta.
 */
export function datosFaltantesParaCotizar(datos: DatosViajero): string[] {
  const faltan: string[] = [];
  if (!datos.destino?.trim()) faltan.push("destino");
  if (!datos.fecha?.trim()) faltan.push("fecha de salida");
  const pax =
    typeof datos.pax === "number" && Number.isFinite(datos.pax) && datos.pax >= 1
      ? datos.pax
      : null;

  if (pax === null) {
    faltan.push("número de pasajeros");
  } else if ((datos.edades?.length ?? 0) !== pax) {
    // Las edades solo se piden cuando ya se sabe cuántos pasajeros son: preguntar
    // "¿qué edad tienen?" sin saber cuántos son produce una respuesta que no
    // se puede usar, y el nombre del tipo de dato depende de la cantidad.
    faltan.push(pax > 1 ? "edad de cada pasajero" : "edad del pasajero");
  }
  if (!datos.acomodacion?.trim() && !datos.ocupacion?.trim()) {
    faltan.push("tipo de alojamiento");
  }
  return faltan;
}

// ─── Disponibilidad: abstención deliberada ────────────────────────────────

/**
 * NO existe fuente de cupos en `programas` / `programa_*`. `programa_blackouts`
 * son fechas bloqueadas, no disponibilidad, y `ocupacionHabitacion.ts` es
 * ocupación para calcular tarifa, no inventario.
 *
 * Por eso esta función NO consulta nada y SIEMPRE devuelve el mismo error. No
 * es un stub pendiente: es la representación honesta de un hueco de negocio.
 */
export function salesbotConsultarDisponibilidad(
  ctx: SalesbotContextoLectura,
): SalesbotError {
  return {
    ok: false,
    error: {
      codigo: "DISPONIBILIDAD_NO_CONSULTABLE",
      mensaje:
        "No tengo disponibilidad en tiempo real. Un asesor puede confirmarte los cupos y las fechas de salida.",
      escalable: true,
      traza: {
        consulta: "sin_fuente_de_disponibilidad",
        motivo: "programas/programa_salidas no tienen cupos ni estado de ocupacion",
      },
    },
    tenant: ctx.tenant ?? null,
    consultado_en: new Date().toISOString(),
  };
}

// ─── Mensajes por código ──────────────────────────────────────────────────

export const MENSAJE_ERROR: Record<SalesbotCodigoError, { mensaje: string; escalable: boolean }> = {
  SIN_RESULTADOS: { mensaje: "No encontré programas con esos criterios.", escalable: false },
  FALTAN_DATOS_USUARIO: {
    mensaje: "Para darte un precio necesito algunos datos del viaje.",
    escalable: false,
  },
  PROGRAMA_NO_PUBLICADO: { mensaje: "Ese programa no está disponible.", escalable: false },
  PRECIO_BAJO_SOLICITUD: {
    mensaje: "Ese valor está bajo solicitud. Un asesor te confirma el precio.",
    escalable: true,
  },
  CONSULTA_FALLIDA: {
    mensaje: "No pude consultar la información en este momento. Te paso con un asesor.",
    escalable: true,
  },
  DISPONIBILIDAD_NO_CONSULTABLE: {
    mensaje:
      "No tengo disponibilidad en tiempo real. Un asesor puede confirmarte los cupos y las fechas de salida.",
    escalable: true,
  },
  DATO_NO_CONSULTADO: {
    mensaje: "Ese dato no lo consulté, así que no te lo puedo confirmar.",
    escalable: true,
  },
};

export function errorDesdeCodigo(
  codigo: SalesbotCodigoError,
  ctx: SalesbotContextoLectura,
): SalesbotError {
  const base = MENSAJE_ERROR[codigo];
  const error: SalesbotConsultaError = {
    codigo,
    mensaje: base.mensaje,
    escalable: base.escalable,
  };
  return {
    ok: false,
    error,
    tenant: ctx.tenant ?? null,
    consultado_en: new Date().toISOString(),
  };
}

// ─── Guard de frases: la red que ningún prompt garantiza ──────────────────

/**
 * NO se prohíbe la palabra "cupo": el usuario PREGUNTA por cupos y hay que
 * poder responderle. Lo que se busca son las AFIRMACIONES comerciales sin
 * respaldo. Por eso TODOS los patrones aceptan la negación: "no hay cupos",
 * "sin disponibilidad", "ningún programa incluye…" tienen que pasar, y son
 * justamente las redacciones honestas.
 */
export type PatronProhibido = { patron: RegExp; porQue: string };

/**
 * Prefijo que anula el patrón: "no hay cupos", "sin disponibilidad", ...
 *
 * Solo son lookbehind de NEGACIÓN ("no", "sin", "ningún", "nunca"): si la
 * afirmación está negada, es la redacción honesta y debe pasar. No se excluye
 * "tengo": "tengo disponibilidad" sí es una afirmación sin respaldo, y el
 * traveler sí necesita poder decir que no la tiene.
 */
const NEGADO = "(?<!no\\s)(?<!sin\\s)(?<!ningún\\s)(?<!ningun\\s)(?<!nunca\\s)";

export const PATRONES_PROHIBIDOS: PatronProhibido[] = [
  {
    patron: new RegExp(`${NEGADO}\\b(?:hay|tenemos|queda(?:n)?)\\s+(?:de\\s+)?(?:cupos?|disponibilidad|lugares|espacios|vacantes)\\b`, "i"),
    porQue: "afirma existencia de cupos o disponibilidad sin fuente",
  },
  {
    // "disponible" solo cuenta cuando va con cópula o verbo existencial, y
    // tanto "está" como "esta" tienen que entrar (con y sin tilde).
    // Un "…y las fechas disponibles" suelto no es una afirmación comercial.
    patron: new RegExp(
      `${NEGADO}\\b(?:est[áa]n?|hay|queda(?:n)?)\\s+(?:el\\s+|la\\s+|los\\s+|las\\s+|un\\s+|una\\s+)?(?:disponible|disponibles)\\b`,
      "i",
    ),
    porQue: "afirma disponibilidad sin haber consultado una fuente de cupos",
  },
  {
    patron: new RegExp(`${NEGADO}\\b(?:precio|valor|disponibilidad|reserva)\\s+confirmad[oa]\\b`, "i"),
    porQue: "confirma un precio o una reserva: la confirmación es humana",
  },
  {
    patron: new RegExp(`${NEGADO}\\bgarantiz(?:o|amos|ado|ada)\\b`, "i"),
    porQue: "garantía comercial: no existe fuente que la respalde",
  },
  {
    patron: new RegExp(`${NEGADO}\\bquedan\\s+\\d+\\b`, "i"),
    porQue: "afirma un número de plazas disponibles",
  },
  {
    patron: new RegExp(`${NEGADO}\\bte\\s+(?:reservo|separo|agendo|bloqueo)\\b|\\blo\\s+(?:reservo|separo)\\b`, "i"),
    porQue: "promete una reserva; solo un asesor con autorización puede",
  },
];

/** Devuelve las frases que NO deben llegar al cliente. Vacío = texto limpio. */
export function detectarFrasesProhibidas(texto: string): { frase: string; porQue: string }[] {
  const encontradas: { frase: string; porQue: string }[] = [];
  for (const { patron, porQue } of PATRONES_PROHIBIDOS) {
    const m = texto.match(patron);
    if (m) encontradas.push({ frase: m[0], porQue });
  }
  return encontradas;
}

export function textoEsSeguro(texto: string): boolean {
  return detectarFrasesProhibidas(texto).length === 0;
}