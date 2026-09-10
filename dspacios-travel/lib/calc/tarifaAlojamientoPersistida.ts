// ─────────────────────────────────────────────────────────────────────────
// Adaptador: fila persistida de `public.hotel_tarifas_unidad` (migración
// 173) → `TarifaAlojamiento` del motor puro (`lib/calc/unidadAlojamiento.ts`).
//
// Alcance de esta fase (fase 1 Bernalo: persistencia + adaptador seguro):
//   · NO consulta Supabase. Recibe UNA fila ya leída, como `unknown`, y no
//     sabe —ni pregunta— de dónde salió.
//   · NO selecciona entre varias tarifas. No ordena, no prioriza, no filtra
//     por `estado` ni por vigencia: adapta la fila que le dan. Elegir "cuál
//     de las tarifas válidas aplica" es de un motor de selección posterior.
//   · NO inventa markup, comisión, moneda, impuestos ni periodicidades. El
//     `TarifaAlojamiento` que devuelve tiene EXACTAMENTE los campos del
//     payload, copiados uno por uno; nada se completa "por defecto" cuando
//     falta, porque un default silencioso es un dato comercial inventado.
//
// ⚠️ FRONTERA DE PRODUCTO — LÉASE ANTES DE REUSAR ESTO (fase 1 Bernalo).
// Esta entrega cubre ÚNICAMENTE las tarifas REGULARES de alojamiento por
// noche que `TarifaAlojamiento` puede expresar: las cuatro unidades de cobro
// persona / pareja / habitación / apartamento, con su tarifa por noche y sus
// suplementos.
//
// NO cubre —ni convierte, ni aproxima— los demás productos del tarifario
// Bernalo, porque NO son tarifas nocturnas y por lo tanto no son un caso
// particular de este modelo, sino otro modelo:
//   · día de sol (uso de instalaciones sin pernoctar);
//   · temporadas de Navidad y Año Nuevo (mínimos y suplementos propios, con
//     reglas de cancelación y de noches obligatorias);
//   · tarifa especial de una noche (precio único por una fecha puntual, que
//     no se multiplica por noches);
//   · paquetes de 2 noches / 3 días (el precio es del paquete, no de la
//     noche: dividirlo daría un valor por noche que nadie cotizó);
//   · reglas de comisión (son del canal de venta, no de la tarifa);
//   · condiciones generales (texto contractual, no aritmética).
// Los anteriores REEMPLAZAN el cálculo nocturno; requieren un modelo
// posterior. `public.hotel_tarifas_unidad` NO es cobertura completa del
// tarifario Bernalo: es el subconjunto regular por noche y así debe
// presentarse.
//
// Esa frontera se hace cumplir, no solo se documenta: `payload` debe ser
// EXACTAMENTE un `TarifaAlojamiento` (ver `CAMPOS_TARIFA_ALOJAMIENTO`), así
// que un payload que se anuncie como otro producto (`tipoProducto:
// "dia_de_sol"`, `paquete2Noches: …`) se RECHAZA en vez de adaptarse como si
// fuera una tarifa nocturna regular. Es un control de MARCADOR, no una
// prueba: una tarifa de otro producto disfrazada de tarifa nocturna —con un
// valor por noche fabricado— no es detectable acá y sigue siendo
// responsabilidad de quien carga los datos. Por eso la frontera también vive
// en la migración (`comment on table`) y en las pruebas.
//
// Por qué existe: el motor es la autoridad de validación, pero exige una
// `EntradaCotizacion` completa (tarifa + distribución + noches). Una tarifa
// recién leída de la base no tiene distribución ni noches legítimas — pasarle
// unas fabricadas solo para cruzar el validador sería exactamente el tipo de
// dato inventado que este adaptador debe evitar. Por eso el motor expone
// `validarTarifaAlojamiento`, que valida UNA TARIFA sin pedir el resto.
//
// Qué comprueba, en orden (fail-closed: el primer problema gana):
//   1. La fila es un objeto, y el payload es un objeto JSON.
//   2. El payload es un `TarifaAlojamiento` y NADA MÁS: ninguna clave fuera
//      del tipo del motor (ver la frontera de producto de arriba). Es la
//      comprobación que impide que otro producto —día de sol, paquete de 2
//      noches, tarifa de Navidad— entre por acá y se cotice como tarifa
//      nocturna regular.
//   3. La FORMA del payload la valida el motor (`validarFormaTarifa`): la
//      misma función que usa `cotizarUnidadAlojamiento`, para que no existan
//      dos definiciones de "forma válida de una tarifa" que puedan divergir.
//   4. Las columnas tienen la forma que la tabla garantiza (texto no vacío
//      donde es obligatorio, texto o null donde es nullable, entero positivo
//      donde es una página).
//   5. Las columnas ESPEJO coinciden con el payload: `tarifa_id` ↔ `id`,
//      `version_tarifario` ↔ `versionTarifario`, `temporada`/`categoria`/
//      `alimentacion` ↔ los campos homónimos, `fuente_documento`/
//      `fuente_pagina` ↔ `payload.fuente`. Por qué importa: la columna es lo
//      que un listado o un filtro SQL va a leer sin abrir el JSON — si
//      dijera algo distinto de lo que realmente se va a cotizar, sería una
//      mentira silenciosa. La coherencia NO se delega a un trigger: el
//      motor de la verdad es el payload, y acá se verifica que el espejo no
//      lo contradiga.
//   6. La tarifa reconstruida la valida el MOTOR COMPLETO
//      (`validarTarifaAlojamiento`): forma + coherencia por unidad de cobro +
//      numérica + capacidad. El adaptador no reimplementa ninguna regla de
//      negocio del motor; lo único propio que agrega es (2), (5) y (7).
//   7. Reglas de edad solapadas → `reglas_edad_ambiguas`. El motor detecta
//      el solapamiento cuando una edad concreta cae en dos reglas
//      (`clasificarMenores` → `combinacion_ambigua`), es decir recién al
//      cotizar; una tarifa con dos rangos superpuestos pasa su validación
//      aislada sin ruido. Acá se detecta sin necesitar ninguna edad, porque
//      una tarifa así es ambigua para SIEMPRE, no solo para ciertas edades.
//      Es estrictamente MÁS restrictivo que el motor: nunca acepta algo que
//      el motor después vaya a rechazar. Deliberadamente NO se revisan
//      HUECOS entre rangos: una edad sin regla es un caso dependiente del
//      pasajero (`edad_fuera_de_regla` al cotizar), no una incoherencia de
//      la tarifa, y rechazar la tarifa entera por eso sería pasarse de
//      estricto.
//
// Este archivo es puro: sin I/O, sin `Date`, sin aleatoriedad. La misma fila
// produce siempre el mismo resultado.
// ─────────────────────────────────────────────────────────────────────────

import {
  esBloqueado,
  validarFormaTarifa,
  validarTarifaAlojamiento,
  type CodigoBloqueo,
  type ReglaEdadMenor,
  type SuplementoConfigurado,
  type TarifaAlojamiento,
} from "./unidadAlojamiento.ts";

// ── Tipos del resultado (unión discriminada por `ok`) ───────────────────

/** Ciclo de vida editorial de la fila (mismo CHECK que la migración 173). */
export type EstadoTarifaUnidad = "borrador" | "publicada" | "inactiva";

const ESTADOS_TARIFA_UNIDAD: ReadonlySet<string> = new Set(["borrador", "publicada", "inactiva"]);

/**
 * Por qué se rechazó la fila. Deliberadamente CORTO y estable: es el
 * "¿de quién es la culpa?" que un llamador puede ramificar. El diagnóstico
 * fino del motor viaja aparte, en `codigoMotor`.
 */
export type CodigoRechazo =
  /** La fila recibida no es un objeto (null, arreglo, escalar). */
  | "fila_no_es_objeto"
  /** `payload` no es un objeto JSON (null, arreglo, escalar). */
  | "payload_no_es_objeto"
  /**
   * `payload` trae claves que no son de `TarifaAlojamiento`: no es una
   * tarifa regular por noche sino otro producto (día de sol, paquete de 2
   * noches, temporada de Navidad…) o un payload de una versión más nueva.
   * Se rechaza en vez de ignorar las claves extra (ver la frontera de
   * producto en la cabecera del archivo).
   */
  | "payload_con_campos_desconocidos"
  /** Una columna no tiene la forma que la tabla garantiza. */
  | "columna_invalida"
  /** Una columna espejo contradice al payload. */
  | "payload_incoherente_con_columnas"
  /** El motor rechazó la tarifa (ver `codigoMotor` y `mensaje`). */
  | "tarifa_invalida"
  /** Dos o más reglas de edad se superponen: ambigüedad permanente. */
  | "reglas_edad_ambiguas";

/**
 * Rechazo. Siempre trae `contexto` — a diferencia de `ResultadoBloqueado`
 * del motor, donde es opcional — porque la razón de ser de este adaptador es
 * que un rechazo se pueda rastrear hasta la fila concreta que lo produjo.
 */
export type TarifaUnidadRechazada = {
  ok: false;
  codigo: CodigoRechazo;
  mensaje: string;
  /** Presente solo cuando `codigo === "tarifa_invalida"`: el código con que el motor la bloqueó. */
  codigoMotor?: CodigoBloqueo;
  contexto: Record<string, unknown>;
};

/**
 * Fila adaptada. La `tarifa` es el objeto que el adaptador CONSTRUYÓ (no una
 * referencia al payload) y que el motor ya validó tal cual — lo que se
 * devuelve es exactamente lo que se validó, no una copia posterior que
 * pudiera diferir.
 *
 * `id`/`hotelId`/`estado` van afuera de la tarifa
 * porque NO son parte de `TarifaAlojamiento`: son datos de la fila que un
 * llamador necesita para operar (actualizar la fila, filtrar por estado)
 * sin volver a consultarla. El adaptador no los usa para decidir nada.
 */
export type TarifaUnidadAdaptada = {
  ok: true;
  /** PK interna de la fila (`hotel_tarifas_unidad.id`), `null` si la fila no la trae. */
  id: number | null;
  hotelId: number;
  estado: EstadoTarifaUnidad;
  tarifa: TarifaAlojamiento;
};

export type ResultadoAdaptacionTarifaUnidad = TarifaUnidadAdaptada | TarifaUnidadRechazada;

// ── Helpers de lectura de columnas ──────────────────────────────────────
// Devuelven un resultado en vez de lanzar: un dato malformado en runtime
// nunca debe producir un `TypeError`, siempre un rechazo explícito (mismo
// criterio que el motor).

type Lectura<T> = { ok: true; valor: T } | TarifaUnidadRechazada;

// `codigoMotor` va como campo PROPIO del rechazo (no dentro de `contexto`):
// es lo que un llamador ramifica para distinguir "la tarifa está mal" de
// "la tarifa está mal POR ESTO", y un dato estable no debe vivir en el mismo
// saco que el contexto de diagnóstico.
function rechazar(
  codigo: CodigoRechazo,
  mensaje: string,
  contexto: Record<string, unknown>,
  codigoMotor?: CodigoBloqueo
): TarifaUnidadRechazada {
  return codigoMotor === undefined
    ? { ok: false, codigo, mensaje, contexto }
    : { ok: false, codigo, mensaje, codigoMotor, contexto };
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function esEnteroSeguro(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v);
}

// `null`/`undefined` → `null` (la columna es nullable: "sin temporada" y
// "sin categoría" son estados válidos, NO campos sin definir). Un string se
// conserva LITERAL, incluido el string vacío — ver la nota de coherencia
// sobre `fuente_documento` más abajo.
function leerTextoNullable(v: unknown, columna: string): Lectura<string | null> {
  if (v === null || v === undefined) return { ok: true, valor: null };
  if (typeof v === "string") return { ok: true, valor: v };
  return rechazar("columna_invalida", `La columna "${columna}" debe ser texto o null.`, { columna, tipo: typeof v });
}

// Texto obligatorio no vacío (mismo criterio que el CHECK `btrim(...) <> ''`
// de la tabla, pero aplicado ANTES de tocar el payload).
function leerTextoObligatorio(v: unknown, columna: string): Lectura<string> {
  if (typeof v !== "string" || v.trim() === "") {
    return rechazar("columna_invalida", `La columna "${columna}" es obligatoria (texto no vacío).`, {
      columna,
      tipo: typeof v,
    });
  }
  return { ok: true, valor: v };
}

// bigint: la app lo maneja como `number` en todo el código (ver
// `types/database.ts`, `hoteles.id` es `number`). Se exige número entero
// seguro >= 1 — no se acepta un string numérico: "parece un id" no es lo
// mismo que serlo, y aquí conviene fallar cerrado y explícito.
function leerIdPositivo(v: unknown, columna: string): Lectura<number> {
  if (!esEnteroSeguro(v) || v < 1) {
    return rechazar("columna_invalida", `La columna "${columna}" debe ser un entero >= 1.`, {
      columna,
      valor: v,
    });
  }
  return { ok: true, valor: v };
}

function leerPaginaNullable(v: unknown, columna: string): Lectura<number | null> {
  if (v === null || v === undefined) return { ok: true, valor: null };
  if (esEnteroSeguro(v) && v > 0) return { ok: true, valor: v };
  return rechazar("columna_invalida", `La columna "${columna}" debe ser un entero > 0 o null.`, { columna, valor: v });
}

function leerEstado(v: unknown): Lectura<EstadoTarifaUnidad> {
  if (typeof v === "string" && ESTADOS_TARIFA_UNIDAD.has(v)) return { ok: true, valor: v as EstadoTarifaUnidad };
  return rechazar("columna_invalida", 'La columna "estado" debe ser "borrador", "publicada" o "inactiva".', {
    columna: "estado",
    valor: v,
  });
}

// Las once claves de `TarifaAlojamiento` — ni una más. Las claves extra se
// RECHAZAN (no se ignoran en silencio) para que un payload que se anuncie
// como otro producto del tarifario no termine cotizado como tarifa nocturna
// regular. La lista es un literal a propósito: si el motor agrega un campo,
// esta prueba de frontera debe fallar y obligar a decidir si el campo nuevo
// sigue siendo una tarifa nocturna regular o ya es otro producto.
const CAMPOS_TARIFA_ALOJAMIENTO: readonly string[] = [
  "id",
  "unidadCobro",
  "valores",
  "capacidad",
  "suplementos",
  "reglaMenores",
  "temporada",
  "categoria",
  "alimentacion",
  "fuente",
  "versionTarifario",
];

// ── Reconstrucción explícita de la tarifa ───────────────────────────────
// Campo por campo, nunca `{...payload}`: un spread arrastraría al objeto de
// dominio cualquier clave extra que el JSON traiga y que el motor no validó.
// Cada valor sale del payload ya pasado por `validarFormaTarifa` (forma
// verificada → tipo del dominio); los opcionales se agregan SOLO si están
// presentes, para no introducir un `undefined` que el payload no tenía.
function construirTarifa(tarifa: TarifaAlojamiento): TarifaAlojamiento {
  const valores: TarifaAlojamiento["valores"] = { adulto: tarifa.valores.adulto };
  if (tarifa.valores.nino !== undefined) valores.nino = tarifa.valores.nino;
  if (tarifa.valores.infante !== undefined) valores.infante = tarifa.valores.infante;
  if (tarifa.valores.periodicidadInfante !== undefined) {
    valores.periodicidadInfante = tarifa.valores.periodicidadInfante;
  }

  const suplementos: SuplementoConfigurado[] = tarifa.suplementos.map((s) => {
    if (s.tipo === "menor_adicional") {
      return { tipo: "menor_adicional", categoriaMenor: s.categoriaMenor, valor: s.valor };
    }
    if (s.tipo === "adulto_adicional") return { tipo: "adulto_adicional", valor: s.valor };
    return { tipo: "persona_sola", valor: s.valor };
  });

  const reglas: ReglaEdadMenor[] = tarifa.reglaMenores.reglas.map((r) => ({
    categoria: r.categoria,
    edadMinAnios: r.edadMinAnios,
    edadMaxAnios: r.edadMaxAnios,
  }));

  const construida: TarifaAlojamiento = {
    id: tarifa.id,
    unidadCobro: tarifa.unidadCobro,
    valores,
    capacidad: {
      minPax: tarifa.capacidad.minPax,
      maxPax: tarifa.capacidad.maxPax,
      paxIncluidos: tarifa.capacidad.paxIncluidos,
    },
    suplementos,
    reglaMenores: { reglas },
    versionTarifario: tarifa.versionTarifario,
  };

  if (tarifa.temporada !== undefined) construida.temporada = tarifa.temporada;
  if (tarifa.categoria !== undefined) construida.categoria = tarifa.categoria;
  if (tarifa.alimentacion !== undefined) construida.alimentacion = tarifa.alimentacion;
  // `fuente` se copia objeto por objeto (no por referencia): la tarifa
  // devuelta no debe quedar aliada a la fila que entró — mutar la fila
  // después no puede cambiar lo que este adaptador ya validó y entregó.
  if (tarifa.fuente !== undefined) {
    construida.fuente =
      tarifa.fuente === null ? null : { documento: tarifa.fuente.documento, pagina: tarifa.fuente.pagina };
  }

  return construida;
}

// Dos rangos se superponen si comparten al menos una edad. Se comparan todos
// los pares (n es el número de reglas de una tarifa: decenas como mucho).
function primerSolapamientoDeEdades(reglas: ReglaEdadMenor[]): { a: ReglaEdadMenor; b: ReglaEdadMenor } | null {
  for (let i = 0; i < reglas.length; i++) {
    for (let j = i + 1; j < reglas.length; j++) {
      const a = reglas[i];
      const b = reglas[j];
      if (a.edadMinAnios <= b.edadMaxAnios && b.edadMinAnios <= a.edadMaxAnios) return { a, b };
    }
  }
  return null;
}

function describirRegla(r: ReglaEdadMenor): string {
  return `${r.categoria} ${r.edadMinAnios}-${r.edadMaxAnios}`;
}

// ── Adaptador ───────────────────────────────────────────────────────────

/**
 * Adapta UNA fila de `public.hotel_tarifas_unidad` a un `TarifaAlojamiento`
 * del motor. Fail-closed: ante cualquier duda, rechaza con un código, un
 * mensaje y un contexto que permite rastrear la fila.
 *
 * Acepta `unknown` a propósito — es el límite real contra datos externos
 * (Postgres/PostgREST/JSON). No lanza nunca: un dato malformado siempre
 * produce un rechazo, jamás un `TypeError`.
 */
export function adaptarTarifaAlojamientoPersistida(filaDesconocida: unknown): ResultadoAdaptacionTarifaUnidad {
  if (!esObjeto(filaDesconocida)) {
    return rechazar("fila_no_es_objeto", "La fila debe ser un objeto.", {
      tipoRecibido: filaDesconocida === null ? "null" : Array.isArray(filaDesconocida) ? "array" : typeof filaDesconocida,
    });
  }
  const fila = filaDesconocida;

  // El payload se revisa primero: es la fuente de la verdad, y sin él las
  // columnas espejo no tienen contra qué compararse.
  if (!esObjeto(fila.payload)) {
    return rechazar("payload_no_es_objeto", "`payload` debe ser un objeto JSON con la tarifa completa.", {
      tipoPayload: fila.payload === null ? "null" : typeof fila.payload,
      id: fila.id,
    });
  }

  // 2. Frontera de producto: el payload debe ser un `TarifaAlojamiento` y
  //    nada más. Se revisan las claves de PRIMER NIVEL (no las anidadas): el
  //    objetivo es atrapar el MARCADOR de otro producto, no auditar la forma
  //    interna — de eso ya se encarga `validarFormaTarifa` unas líneas abajo.
  const camposDesconocidos = Object.keys(fila.payload).filter((clave) => !CAMPOS_TARIFA_ALOJAMIENTO.includes(clave));
  if (camposDesconocidos.length > 0) {
    return rechazar(
      "payload_con_campos_desconocidos",
      "El payload trae campos que no pertenecen a una tarifa de alojamiento regular por noche. Esta tabla admite únicamente tarifas nocturnas de persona, pareja, habitación o apartamento; los productos que reemplazan el cálculo nocturno (día de sol, paquetes de varias noches, temporadas especiales) necesitan su propio modelo y no deben guardarse acá.",
      {
        camposDesconocidos,
        camposEsperados: [...CAMPOS_TARIFA_ALOJAMIENTO],
        idFila: fila.id ?? null,
        hotelId: fila.hotel_id ?? null,
      }
    );
  }

  // 3. Forma del payload, según el motor. Se usa la misma función que usa
  //    `cotizarUnidadAlojamiento` — no hay dos definiciones de "forma válida
  //    de una tarifa" que puedan divergir. `tarifa` queda tipada, así que
  //    las comparaciones de abajo leen campos ya verificados.
  const forma = validarFormaTarifa(fila.payload);
  if (esBloqueado(forma)) {
    // Las columnas todavía no se validaron, así que acá van CRUDAS: son
    // para rastrear de qué fila se trata, no un dato en el que se confíe.
    return rechazar(
      "tarifa_invalida",
      forma.mensaje,
      {
        ...(forma.contexto ?? {}),
        idFila: fila.id ?? null,
        hotelId: fila.hotel_id ?? null,
        tarifaId: fila.tarifa_id ?? null,
        versionTarifario: fila.version_tarifario ?? null,
      },
      forma.codigo
    );
  }
  const tarifaPayload = forma.tarifa;

  // 4. Columnas.
  const id: Lectura<number | null> =
    fila.id === undefined || fila.id === null ? { ok: true, valor: null } : leerIdPositivo(fila.id, "id");
  if (!id.ok) return id;

  const hotelId = leerIdPositivo(fila.hotel_id, "hotel_id");
  if (!hotelId.ok) return hotelId;

  const tarifaId = leerTextoObligatorio(fila.tarifa_id, "tarifa_id");
  if (!tarifaId.ok) return tarifaId;

  const version = leerTextoObligatorio(fila.version_tarifario, "version_tarifario");
  if (!version.ok) return version;

  const temporada = leerTextoNullable(fila.temporada, "temporada");
  if (!temporada.ok) return temporada;

  const categoria = leerTextoNullable(fila.categoria, "categoria");
  if (!categoria.ok) return categoria;

  const alimentacion = leerTextoNullable(fila.alimentacion, "alimentacion");
  if (!alimentacion.ok) return alimentacion;

  const estado = leerEstado(fila.estado);
  if (!estado.ok) return estado;

  const docColumna = leerTextoNullable(fila.fuente_documento, "fuente_documento");
  if (!docColumna.ok) return docColumna;

  const paginaColumna = leerPaginaNullable(fila.fuente_pagina, "fuente_pagina");
  if (!paginaColumna.ok) return paginaColumna;

  // 5. Coherencia columnas espejo ↔ payload. `undefined` se normaliza a
  //    `null` (una tarifa sin temporada puede venir de un payload sin la
  //    clave o con `null`; las dos significan lo mismo y la columna es
  //    nullable) — pero el valor no nulo SÍ debe coincidir literalmente.
  const contextoFila = {
    hotelId: hotelId.valor,
    tarifaId: tarifaId.valor,
    versionTarifario: version.valor,
  };

  if (tarifaId.valor !== tarifaPayload.id) {
    return rechazar("payload_incoherente_con_columnas", '`tarifa_id` no coincide con `payload.id`.', {
      ...contextoFila,
      columnaTarifaId: tarifaId.valor,
      payloadId: tarifaPayload.id,
    });
  }
  if (version.valor !== tarifaPayload.versionTarifario) {
    return rechazar(
      "payload_incoherente_con_columnas",
      "`version_tarifario` no coincide con `payload.versionTarifario`.",
      { ...contextoFila, columnaVersion: version.valor, payloadVersion: tarifaPayload.versionTarifario }
    );
  }

  const espejos: { columna: string; valorColumna: string | null; valorPayload: string | null }[] = [
    { columna: "temporada", valorColumna: temporada.valor, valorPayload: tarifaPayload.temporada ?? null },
    { columna: "categoria", valorColumna: categoria.valor, valorPayload: tarifaPayload.categoria ?? null },
    { columna: "alimentacion", valorColumna: alimentacion.valor, valorPayload: tarifaPayload.alimentacion ?? null },
  ];
  for (const espejo of espejos) {
    if (espejo.valorColumna !== espejo.valorPayload) {
      return rechazar(
        "payload_incoherente_con_columnas",
        `La columna "${espejo.columna}" no coincide con \`payload.${espejo.columna}\` (o el payload no la declara).`,
        { ...contextoFila, columna: espejo.columna, valorColumna: espejo.valorColumna, valorPayload: espejo.valorPayload }
      );
    }
  }

  // `fuente`: la columna es el espejo de `payload.fuente`. Sin `fuente` en el
  // payload, las DOS columnas deben estar vacías; con `fuente`, documento y
  // página deben coincidir exactamente (incluido página `null` ↔ `null`).
  // Comparación literal: si la columna trae "" o un documento distinto, no
  // describe a este payload, y la fila se rechaza en vez de asumir que "" y
  // NULL son lo mismo.
  const fuentePayload = tarifaPayload.fuente ?? null;
  const docPayload = fuentePayload === null ? null : fuentePayload.documento;
  const paginaPayload = fuentePayload === null ? null : fuentePayload.pagina;
  if (docColumna.valor !== docPayload) {
    return rechazar("payload_incoherente_con_columnas", 'La columna "fuente_documento" no coincide con `payload.fuente.documento`.', {
      ...contextoFila,
      columnaDocumento: docColumna.valor,
      payloadDocumento: docPayload,
    });
  }
  if (paginaColumna.valor !== paginaPayload) {
    return rechazar("payload_incoherente_con_columnas", 'La columna "fuente_pagina" no coincide con `payload.fuente.pagina`.', {
      ...contextoFila,
      columnaPagina: paginaColumna.valor,
      payloadPagina: paginaPayload,
    });
  }

  // 6. Reconstrucción explícita y validación por el MOTOR del objeto que
  //    efectivamente se devuelve (no del payload crudo): si la construcción
  //    introdujera o perdiera algo, se detecta acá.
  const tarifa = construirTarifa(tarifaPayload);
  const validacion = validarTarifaAlojamiento(tarifa);
  if (esBloqueado(validacion)) {
    return rechazar("tarifa_invalida", validacion.mensaje, { ...(validacion.contexto ?? {}), ...contextoFila }, validacion.codigo);
  }

  // 7. Ambigüedad permanente de reglas de edad (ver cabecera del archivo).
  const solapamiento = primerSolapamientoDeEdades(tarifa.reglaMenores.reglas);
  if (solapamiento) {
    return rechazar(
      "reglas_edad_ambiguas",
      `Dos reglas de edad se superponen (${describirRegla(solapamiento.a)} y ${describirRegla(solapamiento.b)}): una edad de ese rango tendría dos tarifas posibles.`,
      {
        ...contextoFila,
        reglaA: solapamiento.a,
        reglaB: solapamiento.b,
      }
    );
  }

  return {
    ok: true,
    id: id.valor,
    hotelId: hotelId.valor,
    estado: estado.valor,
    tarifa: validacion.tarifa,
  };
}
