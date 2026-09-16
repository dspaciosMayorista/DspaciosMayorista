// ─────────────────────────────────────────────────────────────────────────
// Condiciones de tarifa/promoción REALMENTE APLICADAS a una estadía — texto
// libre de `tarifa_hotel.notas` (ej. "No reembolsable. No endosable."),
// transportado desde el motor de reserva hasta la cotización y el contrato.
//
// Fuente autoritativa: SOLO las filas de `tarifa_hotel` que de verdad
// aportaron noches/precio a las acomodaciones de HABITACIÓN que la reserva
// SELECCIONÓ (`temporadasTarifaPorAcom` en `lib/reservar/liquidacionHotel.ts`,
// unido únicamente sobre las acomodaciones pedidas — la MISMA identidad que
// ya usa `resolverReglaEdadEstadiaSegura` para la regla de edad, ver
// `lib/calc/reglaEdadTarifa.ts`). Nunca se deriva una resolución paralela de
// temporadas acá: el llamador (`computo.ts`) pasa el mismo conjunto ya
// calculado para edad.
//
// Nunca lee notas de niño/niño2/infante como si fueran una tarifa
// independiente: esas columnas viven en la MISMA fila de habitación (una
// fila de `tarifa_hotel` = hotel+categoría+alimentación+temporada, con TODAS
// las acomodaciones como columnas) — la identidad siempre sale de la fila de
// habitación aplicada, nunca de una resolución de niño/infante aparte.
//
// Módulo PURO (sin I/O, sin "use client"/"use server"): se importa directo
// desde `node --test` y desde `lib/reservar/computo.ts`.
// ─────────────────────────────────────────────────────────────────────────

/** Condición de tarifa aplicada — tipo público estructurado (nunca un string
 * concatenado dentro del motor). Una entrada por (temporada, texto) único. */
export type CondicionTarifaAplicada = {
  temporada: string;
  texto: string;
};

/** Fila cruda de `tarifa_hotel` con lo mínimo necesario para extraer su
 * condición: identidad (categoría/régimen/temporada) + el texto libre. */
export type FilaTarifaHotelNotaCruda = {
  tipo_habitacion?: string | null;
  alimentacion?: string | null;
  temporada: string | null;
  notas?: string | null;
};

/**
 * Extrae las condiciones de tarifa REALMENTE aplicadas a partir de filas
 * CRUDAS de `tarifa_hotel` ya cargadas (nunca dispara una consulta nueva) +
 * el conjunto de temporadas que el liquidador afirma haber usado para la
 * categoría/régimen/acomodaciones seleccionadas (`temporadasUsadas`).
 *
 * Normalización:
 *  - NULL, vacío o texto compuesto solo por espacios se ignora (nunca
 *    produce una condición vacía).
 *  - Se aplica `trim()` al texto conservado.
 *  - Deduplica por `temporada + texto normalizado` (trim + minúsculas para
 *    la comparación, el texto guardado conserva su forma original).
 *  - Orden determinista: por `temporada` y luego por `texto` (ambos
 *    ascendente, comparación simple de string).
 *
 * Nunca falla cerrado ni bloquea nada — es puramente informativo. Si
 * `temporadasUsadas` está vacío, o ninguna fila coincide, o todas las que
 * coinciden tienen `notas` vacío/NULL, devuelve `[]`.
 */
export function extraerCondicionesTarifa(args: {
  filas: FilaTarifaHotelNotaCruda[];
  categoria: string;
  regimen: string;
  temporadasUsadas: Iterable<string>;
}): CondicionTarifaAplicada[] {
  const temporadas = new Set(args.temporadasUsadas);
  if (temporadas.size === 0) return [];

  const vistos = new Set<string>(); // clave() de abajo
  const condiciones: CondicionTarifaAplicada[] = [];
  for (const f of args.filas) {
    if ((f.tipo_habitacion ?? "") !== args.categoria) continue;
    if ((f.alimentacion ?? "") !== args.regimen) continue;
    if (!f.temporada || !temporadas.has(f.temporada)) continue;
    const texto = (f.notas ?? "").trim();
    if (!texto) continue;
    const clave = claveDedupCondicion(f.temporada, texto);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    condiciones.push({ temporada: f.temporada, texto });
  }

  condiciones.sort(compararCondiciones);
  return condiciones;
}

// Clave de deduplicación ESTRUCTURADA (tupla `[temporada, textoNormalizado]`
// serializada con `JSON.stringify`, nunca concatenación con `|`) — una
// temporada o un texto que contuviera el separador ya no puede producir una
// colisión falsa (ej. temporada="A|B", texto="C" colisionando con
// temporada="A", texto="B|C" bajo el esquema viejo de concatenación).
function claveDedupCondicion(temporada: string, texto: string): string {
  return JSON.stringify([temporada, texto.trim().toLowerCase()]);
}

function compararCondiciones(a: CondicionTarifaAplicada, b: CondicionTarifaAplicada): number {
  return a.temporada === b.temporada ? a.texto.localeCompare(b.texto) : a.temporada.localeCompare(b.temporada);
}

/**
 * Normaliza un valor `unknown` (típicamente un jsonb ya leído de vuelta de
 * `cotizaciones.detalle`/`contrato_hoteles.condiciones_tarifa`) a
 * `CondicionTarifaAplicada[]` — la ÚNICA puerta de entrada para tratar JSON
 * ajeno/persistido como si fuera esta estructura. Nunca copia un objeto JSON
 * literal: siempre reconstruye `{ temporada, texto }` desde cero, así que
 * ninguna clave adicional (costo/neto/comisión/proveedor/ids internos que un
 * dato corrupto o manipulado pudiera traer) puede propagarse.
 *
 * Dos niveles de estrictez, deliberadamente distintos ("descartar o rechazar
 * de manera explícita según el origen" — ver encargo):
 *  - Forma GLOBAL inválida (no es un arreglo) → RECHAZA explícito (`ok:
 *    false`) — es la señal de que el dato de origen está corrupto/manipulado,
 *    nunca se sigue adelante con una lista vacía como si no pasara nada.
 *  - Elemento INDIVIDUAL inválido dentro de un arreglo por lo demás válido
 *    (no es objeto, o `temporada`/`texto` no son strings no vacíos tras
 *    `trim()`) → se DESCARTA solo ese elemento (defensivo ante un elemento
 *    puntualmente corrupto, sin tumbar el resto de condiciones válidas del
 *    mismo arreglo).
 *  - `undefined`/`null` (el campo no existe en absoluto — nunca se guardó,
 *    o es un contrato histórico anterior a esta funcionalidad) → `ok: true`
 *    con `[]`, NUNCA un rechazo: la ausencia del campo no es un dato
 *    corrupto, es la ausencia legítima de la funcionalidad.
 *
 * Aplica la MISMA deduplicación (tupla estructurada) y el MISMO orden
 * determinista que `extraerCondicionesTarifa`.
 */
export function normalizarCondicionesTarifaJSON(valor: unknown): { ok: true; condiciones: CondicionTarifaAplicada[] } | { ok: false; error: string } {
  if (valor === undefined || valor === null) return { ok: true, condiciones: [] };
  if (!Array.isArray(valor)) {
    return { ok: false, error: `se esperaba un arreglo de condiciones, se recibió ${typeof valor}.` };
  }

  const vistos = new Set<string>();
  const condiciones: CondicionTarifaAplicada[] = [];
  for (const elemento of valor) {
    if (typeof elemento !== "object" || elemento === null || Array.isArray(elemento)) continue; // descarta el elemento, no todo el arreglo
    const o = elemento as Record<string, unknown>;
    const temporada = typeof o.temporada === "string" ? o.temporada.trim() : "";
    const texto = typeof o.texto === "string" ? o.texto.trim() : "";
    if (!temporada || !texto) continue;
    const clave = claveDedupCondicion(temporada, texto);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    condiciones.push({ temporada, texto }); // objeto NUEVO — nunca se reusa `o`/`elemento`, ninguna clave extra sobrevive
  }
  condiciones.sort(compararCondiciones);
  return { ok: true, condiciones };
}

/** Fila del snapshot `cotizaciones.detalle.hoteles[]` con lo mínimo necesario
 * para la correlación por referencia estable. */
export type HotelSnapConRef = { ref?: unknown; condiciones_tarifa?: unknown };

/**
 * Resuelve las condiciones de tarifa que le corresponden a UN ítem del
 * carrito al convertir la cotización a contrato — por REFERENCIA ESTABLE
 * (`ref`, generada server-side al crear la cotización, ver
 * `crearCotizacionCarrito`), NUNCA por posición dentro del grupo (`hIdx`,
 * que se reinicia en cada grupo con `agrupar: "por_destino"`), nombre de
 * hotel (puede repetirse en el carrito) ni `hotelId+categoría` (el mismo
 * hotel puede aparecer dos veces con fechas distintas).
 *
 * - `ref` ausente/null (cotización histórica, anterior a esta ronda, o un
 *   ítem que por algún motivo nunca la recibió) → `ok: true, condiciones:
 *   null` — NUNCA se intenta adivinar; el llamador debe tratar `null` como
 *   "no hay snapshot para copiar", no como "hay cero condiciones".
 * - `ref` presente pero SIN match en el snapshot, o con MÁS DE UN match
 *   (dato inconsistente) → `ok: false` — falla cerrado, nunca elige
 *   arbitrariamente ni ignora el problema.
 * - `ref` presente con match único → normaliza su `condiciones_tarifa` con
 *   `normalizarCondicionesTarifaJSON` (rechazo explícito si esa forma
 *   también está corrupta) y la devuelve (puede ser `[]`, que es una
 *   respuesta válida: "esta estadía no tuvo condiciones de tarifa").
 *
 * Función PURA — el llamador (`convertirCotizacionCarrito`) es quien ya trae
 * `cotizaciones.detalle.hoteles` cargado, nunca se vuelve a consultar nada
 * acá ni se toca `tarifa_hotel`.
 */
export function resolverCondicionesTarifaParaConversion(
  hotelesSnap: HotelSnapConRef[],
  ref: string | null | undefined
): { ok: true; condiciones: CondicionTarifaAplicada[] | null } | { ok: false; error: string } {
  if (!ref) return { ok: true, condiciones: null };

  const coincidencias = hotelesSnap.filter((h) => h.ref === ref);
  if (coincidencias.length === 0) {
    return { ok: false, error: `No se encontró en el snapshot de la cotización ningún hotel con la referencia "${ref}".` };
  }
  if (coincidencias.length > 1) {
    return { ok: false, error: `El snapshot de la cotización tiene ${coincidencias.length} hoteles con la referencia "${ref}" — dato ambiguo.` };
  }
  const rNorm = normalizarCondicionesTarifaJSON(coincidencias[0].condiciones_tarifa);
  if (!rNorm.ok) {
    return { ok: false, error: `El snapshot de condiciones de tarifa (referencia "${ref}") es inválido: ${rNorm.error}` };
  }
  return { ok: true, condiciones: rNorm.condiciones };
}

/**
 * Variante PARA RENDER de `normalizarCondicionesTarifaJSON` — usada por las 4
 * superficies de documento (cotización autenticada/`/cot/[token]`, contrato
 * autenticado/`/c/[token]`) al pasar `condiciones_tarifa` (jsonb crudo, sea
 * de `cotizaciones.detalle.hoteles[]` o de `contrato_hoteles`) a
 * `ContratoDocumento`. A diferencia del normalizador de escritura (que
 * RECHAZA una forma global inválida para poder fallar cerrado la
 * conversión), acá un valor corrupto simplemente no se muestra — nunca debe
 * tumbar la página de un cliente. `null`/`undefined`/forma inválida → `[]`
 * (la sección "Condiciones de la tarifa" ya se omite por completo cuando el
 * arreglo viene vacío, ver ContratoDocumento.tsx).
 */
export function condicionesTarifaParaRender(valor: unknown): CondicionTarifaAplicada[] {
  const r = normalizarCondicionesTarifaJSON(valor);
  return r.ok ? r.condiciones : [];
}

/**
 * Agrupa condiciones IDÉNTICAS en texto (de temporadas distintas) en una
 * sola línea con la lista de temporadas — nunca pierde identidad (las
 * temporadas se conservan, solo se colapsa el texto repetido). Usada por
 * `ContratoDocumento.tsx` (sección "Condiciones de la tarifa") — extraída a
 * este módulo puro (sin JSX) para que sea ejecutable con `node --test`
 * (este repo no tiene testing-library para renderizar componentes React).
 */
export function agruparCondicionesTarifaPorTexto(
  condiciones: CondicionTarifaAplicada[]
): { texto: string; temporadas: string[] }[] {
  const porTexto = new Map<string, string[]>();
  for (const c of condiciones) {
    const temporadas = porTexto.get(c.texto) ?? [];
    if (!temporadas.includes(c.temporada)) temporadas.push(c.temporada);
    porTexto.set(c.texto, temporadas);
  }
  return [...porTexto.entries()].map(([texto, temporadas]) => ({ texto, temporadas }));
}
