// ─────────────────────────────────────────────────────────────────────────
// Motor puro de "unidad de cobro" para alojamiento nocturno (análisis
// Bernalo 2026, PR 1 — ver artefacto "Tarifario Bernalo 2026").
//
// Objetivo de este archivo: representar cómo se cobra UNA noche de
// alojamiento cuando la unidad de cobro no es "por persona" (el único eje
// que soporta hoy `lib/calc/paquetes.ts`/`computo.ts`), sino por pareja,
// por habitación o por apartamento — sin tocar el motor existente.
//
// Alcance deliberado de este PR (ver plan aprobado):
//   - Solo modelo de dominio + funciones puras. CERO consultas a Supabase:
//     toda dependencia de datos (tarifa, distribución, reglas) llega por
//     argumento.
//   - CERO integración con `tarifa_hotel`, `computo.ts`, reservar,
//     cotizaciones o contratos. Este motor no se llama todavía desde
//     ningún flujo real.
//   - CERO day use, paquetes de precio fijo, promociones o comisión
//     confirmada. El código `requiere_cotizacion_manual` existe como forma
//     (para que un PR futuro lo use al integrar `hotel_temporadas.solo_paquete`)
//     pero este motor nunca lo devuelve por sí solo — no hay lógica de
//     paquetes que decidir aquí.
//   - La comisión/ajuste comercial en el snapshot es SIEMPRE `null` en este
//     PR — no se ejecuta ninguna fórmula (`totalVenta = totalNeto + x`).
//     La regla 20%/10% del PDF no está confirmada y ni siquiera sabemos si
//     será markup, comisión incluida en PVP o descuento sobre rack — eso se
//     define en un PR futuro cuando el dueño confirme la semántica.
//
// Revisión de PR (ronda 2, sobre el PR #269 en draft): la distribución por
// unidad reemplaza la cuenta agregada — cada habitación/pareja/apartamento
// se valida y calcula INDIVIDUALMENTE (capacidad, persona sola, suplementos
// por exceso de pax), y el total es la suma. Ya no existe una "ocupación
// total" editable en paralelo a la distribución: los agregados (adultos
// totales, menores totales) siempre se DERIVAN de `distribucion.unidades`
// con `derivarOcupacionTotal`, nunca se reciben como input aparte — una
// sola fuente de verdad.
//
// Revisión de PR (ronda 3): tres correcciones más.
//   1) `construirSnapshotAlojamiento` ya NO acepta tarifa/distribución por
//      separado — solo toma `resultado`. `ResultadoValido` ahora transporta
//      su propia copia normalizada (`datosFuente`), poblada UNA sola vez
//      dentro de `cotizarUnidadAlojamiento` en el momento exacto en que ese
//      resultado se calculó. Mezclar el resultado de una tarifa/distribución/
//      noches con los datos de otra queda impedido por construcción — la
//      función ya no tiene un parámetro por el que colar un dato ajeno.
//   2) Se auditaron los 27 hoteles del PDF Bernalo uno por uno: ningún hotel
//      cobrado por pareja o por habitación tiene política de menores — la
//      cláusula de niños (seguro/70%/cama compartida) SOLO aparece en los
//      15 hoteles cobrados por persona (incluidos Mauku y Talam, que aunque
//      tienen apartamentos/suites físicos, publican "Precio por persona por
//      noche"). No se construye una unión discriminada para reglas de
//      menores en unidades no-persona — no hay caso real que la necesite en
//      este dataset (ver inventario completo en el PR).
//   3) `TarifaAlojamiento` valida coherencia exhaustiva por `unidadCobro`
//      (`validarCoherenciaTarifa`): "persona" no admite suplementos;
//      pareja/habitación/apartamento no admiten `valores.nino`/`infante`
//      (el cálculo los ignoraría en silencio); habitación/apartamento no
//      admiten el suplemento `persona_sola` (una SGL es OTRA tarifa, no un
//      reemplazo). Cualquier combinación incoherente falla con
//      `configuracion_invalida` antes de calcular nada.
//   4) Nueva validación de FORMA (`validarFormaEntrada`), corre primero de
//      todas: los datos reales vendrán de Postgres/adaptadores como
//      `unknown`, no como el tipo `EntradaCotizacion` que TypeScript
//      garantiza en compilación. `cotizarUnidadAlojamiento` ahora acepta
//      `unknown` y nunca lanza `TypeError` ante un dato externo malformado
//      (null en vez de arreglo, objeto en vez de arreglo, etc.) — siempre
//      responde `configuracion_invalida`. `tarifa.id` y
//      `tarifa.versionTarifario` son obligatorios (string no vacío): sin
//      ellos no se puede construir un snapshot persistible, así que se
//      exigen desde el principio, no al momento de snapshotear.
//
// Revisión de PR (ronda 4, final): seis correcciones más.
//   1) `tarifa.valores.adulto` es SIEMPRE obligatorio y se valida como
//      entero seguro >= 0 — antes `{ valores: {} }` pasaba de largo (el
//      bucle genérico sobre `Object.entries` simplemente no encontraba
//      nada que objetar) y terminaba en `ok:true` con `totalNetoPorNoche:
//      NaN`. Ahora se exige su presencia en `validarFormaEntrada` (forma)
//      y su rango en `validarEntrada` (`esEnteroSeguro`).
//   2) `esEnteroValido` se volvió `esEnteroSeguro` (`Number.isSafeInteger`,
//      no solo `Number.isInteger`) en TODO el motor — dinero, pax, edades,
//      noches. Además, `verificarConsistenciaResultado` (ver punto 6)
//      recalcula cada multiplicación/suma con esa misma función antes de
//      devolver `ok:true`, así que un desbordamiento de
//      `Number.MAX_SAFE_INTEGER` en cualquier paso queda cubierto en un
//      solo lugar, sin tener que propagar un "posible overflow" por cada
//      función interna.
//   3) Nueva `validarCoherenciaCapacidad`: persona exige
//      `paxIncluidos === 0` (no interviene en el precio, así que no puede
//      "parecer" que sí); pareja exige `minPax<=2<=maxPax` y
//      `paxIncluidos === 2` (la base siempre son 2 adultos, hardcoded);
//      habitación/apartamento exigen `paxIncluidos >= minPax` (antes solo
//      se validaba el límite superior).
//   4) `validarFormaEntrada` ahora valida discriminantes por unión
//      exhaustivamente: `ReglaEdadMenor.categoria` (solo nino/infante),
//      `suplemento.tipo` (solo los 3 valores), `menor_adicional` exige
//      `categoriaMenor` válida, `adulto_adicional`/`persona_sola` la
//      rechazan si viene puesta, `temporada`/`categoria`/`alimentacion`
//      deben ser string o null, y `tarifa.valores` no admite claves fuera
//      de adulto/nino/infante. Todo esto es `configuracion_invalida`,
//      nunca `tarifa_no_encontrada` ni un `TypeError`.
//   5) `DatosFuenteSnapshot`/`SnapshotAlojamiento` ahora incluyen
//      `capacidad` (minPax/maxPax/paxIncluidos) completa — antes faltaba,
//      así que el snapshot no alcanzaba a explicar por sí solo cómo se
//      llegó al total (base + incluidos + adicionales × suplemento).
//   6) `verificarConsistenciaResultado`: aserción interna, corre justo
//      antes de devolver `ok:true` — recalcula cada línea (cantidad ×
//      valorUnitario === valorTotal, con enteros seguros), la suma del
//      desglose contra `totalNetoPorNoche`, y `totalNetoPorNoche × noches`
//      contra `totalNeto`. Si algo no cuadra, `configuracion_invalida` en
//      vez de `ok:true`.
//
// Revisión de PR (ronda 5, final): tres correcciones más.
//   1) Menor con tarifa de adulto. La política Bernalo real es de TRES
//      tramos, no dos: 0-3 infante, 4-10 niño, 11 en adelante "pagan
//      tarifa normal" — es decir, tarifariamente adultos aunque sigan
//      siendo menores en la reserva. `ReglaEdadMenor.categoria` ahora es
//      `CategoriaTarifaria` ("infante"|"nino"|"adulto"), y
//      `MenorClasificado` conserva `edadAnios` + `categoriaTarifaria` +
//      `reglaAplicada` + `valorAplicado` (este último solo se resuelve
//      para "persona" — en pareja/habitación/apartamento el cargo es a
//      nivel de unidad, no por pasajero). Un menor así NUNCA se suma a
//      `unidad.adultos` — aparece como línea propia
//      ("Menor con tarifa de adulto") usando `valores.adulto`. En
//      pareja/habitación/apartamento, ese mismo menor cuenta como un
//      adulto MÁS para capacidad/suplementos (necesita `adulto_adicional`
//      si excede lo incluido, nunca `menor_adicional`).
//   2) Periodicidad de cobros. El PDF Bernalo NO dice si el seguro
//      hotelero de 0-3 años ($30.000) es por noche o por estadía — a
//      diferencia de adulto/niño, inequívocamente por noche. Nueva
//      `PeriodicidadCobro` ("por_noche"|"por_estadia"): `infante`, si está
//      configurado, EXIGE `periodicidadInfante` explícito (sin default).
//      Cada `DesgloseLinea` declara su periodicidad; `totalNetoPorNoche`
//      solo suma líneas "por_noche" (se multiplica × noches),
//      `totalPorEstadia` (nuevo campo) suma las "por_estadia" (una sola
//      vez): `totalNeto = totalNetoPorNoche × noches + totalPorEstadia`.
//   3) Sin asignación proporcional a `adultos`. Se eliminó
//      `Array.from({length: unidad.adultos})` en
//      `aplicarSuplementosUnidad` — el reparto de `paxIncluidos` entre
//      adultos/menores para habitación/apartamento ahora es puramente
//      algebraico (`Math.min`/resta), y el único recorrido que queda es
//      sobre los menores REALES recibidos (un arreglo ya en memoria,
//      acotado por la ocupación real, nunca por el valor numérico de
//      `adultos`). Nuevo `MAX_OCUPANTES_POR_UNIDAD` (500, exportado) como
//      límite comercial de defensa en profundidad: un `adultos` absurdo
//      (aunque sea un entero seguro) falla `configuracion_invalida` de
//      inmediato, antes de cualquier otro cómputo sobre esa unidad.
//
// Compatibilidad con lo que ya existe: la calculadora Corporativa
// (`lib/calc/calculadoras.ts`) ya preserva el total de habitación exacto
// cuando `persona_adicional = 0` — `neto_X × pax_tarifa_default[X] = rack`
// para sencilla/doble/triple/múltiple (verificado con trazas numéricas en
// el artefacto). Este motor no reemplaza esa calculadora: expresa el MISMO
// total ya calculado como una unidad de cobro explícita ("habitación"), en
// vez de asumir implícitamente "por persona" como hace `computo.ts` hoy.
// Las pruebas de este archivo (`pruebas/unidadAlojamiento.test.ts`) trazan
// esa equivalencia con casos reales del PDF (Casa Amanzi, Mumu).
// ─────────────────────────────────────────────────────────────────────────

export const VERSION_MOTOR_ALOJAMIENTO = "unidad-alojamiento@4";

// ── Unidad de cobro ─────────────────────────────────────────────────────
// Vive en la TARIFA (o plan tarifario), nunca en el hotel: un mismo hotel
// puede tener varias modalidades vigentes a la vez (ver artefacto, §7).
export type UnidadCobro = "persona" | "pareja" | "habitacion" | "apartamento";

// ── Ocupación y edades ──────────────────────────────────────────────────
export type Menor = { edadAnios: number };

// Una unidad = UNA habitación/pareja/apartamento con sus propios ocupantes.
// La distribución completa (`DistribucionUnidades`) es la ÚNICA fuente de
// verdad de la ocupación — no existe un total agregado editable aparte.
export type UnidadOcupada = {
  adultos: number;
  menores: Menor[];
};

export type DistribucionUnidades = { unidades: UnidadOcupada[] }; // no vacío

// Reglas de menores: por hotel/tarifa, nunca globales. Rango inclusivo.
// Ausencia de una regla que cubra una edad NO se resuelve como adulto
// (regla explícita del encargo) — se falla cerrado con `edad_fuera_de_regla`.
//
// `CategoriaMenor` (nino/infante) sigue siendo el universo de los
// suplementos `menor_adicional` — un ocupante clasificado como "adulto"
// nunca necesita ese suplemento, necesita `adulto_adicional` como
// cualquier otro adulto (ver `CategoriaTarifaria`).
export type CategoriaMenor = "nino" | "infante";

// Categoría TARIFARIA de un ocupante — no es lo mismo que su condición de
// "menor" en la reserva. La política Bernalo (pág. 4 y repetida en casi
// todos los hoteles por persona): 0-3 → infante; 4-10 → niño; 11 en
// adelante → "pagan tarifa normal" — es decir, tarifariamente adultos,
// aunque sigan siendo menores de edad y deban conservar su fecha de
// nacimiento en la reserva. Por eso una `ReglaEdadMenor` puede clasificar
// a alguien como "adulto" sin que deje de estar en `UnidadOcupada.menores`.
export type CategoriaTarifaria = "infante" | "nino" | "adulto";

export type ReglaEdadMenor = {
  categoria: CategoriaTarifaria;
  edadMinAnios: number;
  edadMaxAnios: number;
};

export type ReglaMenores = { reglas: ReglaEdadMenor[] };

// `valorAplicado` solo se resuelve a un número para unidadCobro="persona"
// — ahí "valor utilizado" es un concepto POR PASAJERO (`valores.adulto`/
// `nino`/`infante`). En pareja/habitación/apartamento el cargo de un menor
// es a nivel de UNIDAD (un suplemento cubre varios ocupantes extra a la
// vez, nunca es "el valor de este pasajero puntual"), así que queda
// `null` — el valor real usado se lee del desglose de esa unidad.
export type MenorClasificado = {
  edadAnios: number;
  categoriaTarifaria: CategoriaTarifaria;
  reglaAplicada: ReglaEdadMenor;
  valorAplicado: number | null;
};

// ── Capacidad ────────────────────────────────────────────────────────────
// Se valida POR UNIDAD, nunca sobre el total agregado — dos habitaciones de
// 2 pax cada una no son lo mismo que una "ocupación total de 4" repartida
// como 3+1. `maxPax: null` = sin límite. `paxIncluidos` es cuántos pax cubre
// `valores.adulto` sin recargo, dentro de ESA unidad (habitación/apartamento;
// para pareja el caso base son 2 adultos, ver "persona sola" más abajo).
export type CapacidadUnidad = {
  minPax: number;
  maxPax: number | null;
  paxIncluidos: number;
};

// ── Suplementos: unión discriminada ─────────────────────────────────────
// Evita estados inválidos por construcción (ej. un "persona_sola" con
// `categoriaMenor` puesto, que no significa nada).
export type SuplementoAdultoAdicional = { tipo: "adulto_adicional"; valor: number };
export type SuplementoPersonaSola = { tipo: "persona_sola"; valor: number };
export type SuplementoMenorAdicional = { tipo: "menor_adicional"; categoriaMenor: CategoriaMenor; valor: number };

export type SuplementoConfigurado = SuplementoAdultoAdicional | SuplementoPersonaSola | SuplementoMenorAdicional;

export type SuplementoAplicado = SuplementoConfigurado & {
  cantidad: number;
  valorTotal: number;
};

// Periodicidad de un cargo: si se multiplica por las noches de la estadía
// o si se cobra una sola vez. El PDF Bernalo NO es inequívoco para el
// "seguro hotelero" de 0-3 años: dice "$30.000 seguro hotelero" sin ningún
// calificador de tiempo, a diferencia de adulto ("Precio por persona por
// noche", encabezado explícito) y de niño ("70% de la tarifa de adulto" —
// derivado de una tarifa que SÍ es inequívocamente por noche). Por eso
// este motor NUNCA asume una interpretación para `infante`: la
// periodicidad es un dato obligatorio de la tarifa, no un default.
export type PeriodicidadCobro = "por_noche" | "por_estadia";

// ── Tarifa (el insumo, no una fila de BD todavía) ───────────────────────
// `valores.adulto` significa cosas distintas según la unidad:
//   persona    → valor por 1 adulto/noche.
//   pareja     → valor de LA PAREJA completa/noche (no por persona).
//   habitacion → valor de LA HABITACIÓN completa/noche (no por persona).
//   apartamento→ valor del APARTAMENTO completo/noche (no por persona).
// `nino`/`infante` solo se usan (y solo tienen sentido) cuando
// unidadCobro === "persona". `adulto`/`nino` son siempre por noche (el PDF
// lo deja inequívoco); `infante`, si está configurado, EXIGE
// `periodicidadInfante` explícito — ver `PeriodicidadCobro`.
export type ValoresPorCategoria = {
  adulto: number;
  nino?: number;
  infante?: number;
  periodicidadInfante?: PeriodicidadCobro;
};

// Combinaciones válidas por `unidadCobro` (verificadas por
// `validarCoherenciaTarifa`, no solo por el tipo): "persona" nunca lleva
// suplementos (cada categoría de pax ya tiene su propio valor); pareja/
// habitación/apartamento nunca leen `valores.nino`/`infante` (quedarían
// cargados pero ignorados); habitación/apartamento nunca admiten el
// suplemento `persona_sola` (una tarifa SGL es OTRA fila de tarifa, no un
// reemplazo dentro de esta). `id` y `versionTarifario` son obligatorios —
// sin ellos no hay snapshot persistible posible.
export type TarifaAlojamiento = {
  id: string;
  unidadCobro: UnidadCobro;
  valores: ValoresPorCategoria;
  capacidad: CapacidadUnidad;
  suplementos: SuplementoConfigurado[];
  reglaMenores: ReglaMenores; // {reglas:[]} si el hotel no tiene política de menores (ej. hoteles de pareja)
  temporada?: string | null;
  categoria?: string | null; // tipo de habitación/apartamento
  alimentacion?: string | null;
  fuente?: { documento: string; pagina: number | null } | null;
  versionTarifario: string;
};

// ── Desglose ─────────────────────────────────────────────────────────────
// `unidadIndex`: a qué habitación/pareja/apartamento pertenece la línea
// (índice en `distribucion.unidades`). `null` para las líneas agregadas de
// la unidad "persona" (ahí el cobro es por pasajero, no por unidad física).
export type DesgloseLinea = {
  concepto: string;
  tipo: "base" | "menor" | "suplemento";
  cantidad: number;
  valorUnitario: number;
  valorTotal: number;
  unidadIndex: number | null;
  periodicidad: PeriodicidadCobro;
};

export type CapacidadUtilizadaUnidad = {
  indice: number;
  adultos: number;
  menores: number;
  totalPax: number;
};

// ── Resultado bloqueado (fail-closed, con código explícito) ────────────
export type CodigoBloqueo =
  | "tarifa_no_encontrada" // capacidad OK, pero no hay precio configurado para lo pedido (categoría de menor, persona sola, o suplemento sin valor)
  | "ocupacion_no_permitida" // una unidad viola su capacidad mínima/máxima o su regla de "al menos un adulto" (números bien formados, pero la ocupación no es válida)
  | "edad_fuera_de_regla" // la edad de un menor no está cubierta por ninguna regla configurada
  | "combinacion_ambigua" // la edad de un menor cae en más de una regla a la vez
  | "requiere_cotizacion_manual" // reservado para integraciones futuras (ej. hotel_temporadas.solo_paquete) — este motor no lo dispara todavía
  | "producto_no_soportado" // el producto pedido no lo cubre este motor (ej. day use = 0 noches)
  | "configuracion_invalida"; // la tarifa o la entrada tienen un valor mal formado (no entero, negativo, NaN, Infinity, rangos invertidos, suplementos duplicados) — nunca se confunde con "no hay precio configurado"

export type ResultadoBloqueado = {
  ok: false;
  codigo: CodigoBloqueo;
  mensaje: string;
  contexto?: Record<string, unknown>;
};

export function resultadoBloqueado(
  codigo: CodigoBloqueo,
  mensaje: string,
  contexto?: Record<string, unknown>
): ResultadoBloqueado {
  return { ok: false, codigo, mensaje, ...(contexto !== undefined ? { contexto } : {}) };
}

function esBloqueado(x: unknown): x is ResultadoBloqueado {
  return typeof x === "object" && x !== null && (x as { ok?: unknown }).ok === false;
}

// Copia normalizada de todo lo que el snapshot necesita de la tarifa/
// distribución fuente — poblada UNA sola vez, dentro de
// `cotizarUnidadAlojamiento`, en el momento exacto en que este resultado se
// calculó. Es la única fuente de la que `construirSnapshotAlojamiento` lee:
// no hay forma de pasarle una tarifa o distribución de otro cálculo.
export type DatosFuenteSnapshot = {
  tarifaId: string;
  versionTarifario: string;
  unidadCobro: UnidadCobro;
  valores: ValoresPorCategoria;
  capacidad: CapacidadUnidad;
  reglaMenoresAplicada: ReglaMenores;
  distribucion: DistribucionUnidades;
  temporada: string | null;
  categoria: string | null;
  alimentacion: string | null;
  fuente: { documento: string; pagina: number | null } | null;
};

// ── Resultado válido ─────────────────────────────────────────────────────
// `totalNetoPorNoche` es la suma de SOLO las líneas "por_noche" (se
// multiplica por `noches`); `totalPorEstadia` es la suma de SOLO las
// líneas "por_estadia" (se cobra una única vez). `totalNeto =
// totalNetoPorNoche × noches + totalPorEstadia`. Mientras ninguna tarifa
// configure `infante` con `periodicidadInfante: "por_estadia"`,
// `totalPorEstadia` es siempre 0 y el comportamiento es idéntico al de
// antes de esta ronda.
export type ResultadoValido = {
  ok: true;
  unidadCobro: UnidadCobro;
  cantidadUnidades: number;
  noches: number;
  desglose: DesgloseLinea[];
  totalNetoPorNoche: number;
  totalPorEstadia: number;
  totalNeto: number; // totalNetoPorNoche × noches + totalPorEstadia
  menoresClasificados: MenorClasificado[];
  suplementosAplicados: SuplementoAplicado[];
  capacidadUtilizada: CapacidadUtilizadaUnidad[];
  datosFuente: DatosFuenteSnapshot;
};

export type ResultadoCotizacionUnidad = ResultadoValido | ResultadoBloqueado;

export type EntradaCotizacion = {
  tarifa: TarifaAlojamiento;
  distribucion: DistribucionUnidades; // obligatoria — sin default oculto
  noches: number;
};

// ── Derivación de agregados (nunca un input aparte) ─────────────────────
// Único lugar donde se calcula "cuántos adultos/menores en total" — para
// reportes o UI que quieran mostrar el agregado. La distribución sigue
// siendo la única fuente de verdad; esto es una lectura derivada, no un
// segundo estado editable.
export function derivarOcupacionTotal(distribucion: DistribucionUnidades): { adultos: number; menores: Menor[] } {
  return {
    adultos: distribucion.unidades.reduce((acc, u) => acc + u.adultos, 0),
    menores: distribucion.unidades.flatMap((u) => u.menores),
  };
}

// Agrupa por categoría TARIFARIA (infante/nino/adulto) — usado en el
// desglose de "persona", donde un menor con regla `categoria:"adulto"`
// (11-17 años, tarifa Bernalo) forma su propio grupo/línea ("Menor con
// tarifa de adulto"), separado de los adultos declarados.
function agruparPorCategoriaTarifaria(menores: MenorClasificado[]): { categoriaTarifaria: CategoriaTarifaria; cantidad: number }[] {
  const mapa = new Map<CategoriaTarifaria, number>();
  for (const m of menores) mapa.set(m.categoriaTarifaria, (mapa.get(m.categoriaTarifaria) ?? 0) + 1);
  return [...mapa.entries()].map(([categoriaTarifaria, cantidad]) => ({ categoriaTarifaria, cantidad }));
}

// Agrupa SOLO por categoría de suplemento `menor_adicional` (nino/infante).
// El llamador debe filtrar antes cualquier menor con categoriaTarifaria
// "adulto" — ese no necesita `menor_adicional`, necesita `adulto_adicional`
// como cualquier otro adulto (ver `aplicarSuplementosUnidad`).
function agruparMenorAdicional(menores: MenorClasificado[]): { categoriaMenor: CategoriaMenor; cantidad: number }[] {
  const mapa = new Map<CategoriaMenor, number>();
  for (const m of menores) {
    const categoriaMenor = m.categoriaTarifaria as CategoriaMenor;
    mapa.set(categoriaMenor, (mapa.get(categoriaMenor) ?? 0) + 1);
  }
  return [...mapa.entries()].map(([categoriaMenor, cantidad]) => ({ categoriaMenor, cantidad }));
}

function claveSuplemento(s: SuplementoConfigurado): string {
  return s.tipo === "menor_adicional" ? `menor_adicional:${s.categoriaMenor}` : s.tipo;
}

function etiquetaSuplemento(s: SuplementoConfigurado): string {
  if (s.tipo === "adulto_adicional") return "Adulto adicional";
  if (s.tipo === "persona_sola") return "Persona sola";
  return s.categoriaMenor === "nino" ? "Niño adicional" : "Infante adicional";
}

// `Number.isSafeInteger` (no solo `Number.isInteger`): además de rechazar
// NaN/Infinity/decimales, rechaza enteros por fuera de
// [-MAX_SAFE_INTEGER, MAX_SAFE_INTEGER] — un valor "entero" mayor a eso ya
// no se representa con precisión exacta en un `number` de JS, así que
// cualquier suma/multiplicación posterior podría perder precisión en
// silencio. Se usa para TODO campo numérico de este motor (dinero, pax,
// edades, noches) — no solo dinero — porque el mismo riesgo aplica a
// cualquiera de ellos si llegara un valor patológico desde afuera.
function esEnteroSeguro(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n);
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Límite comercial razonable para pax de UNA sola unidad. Ningún hotel real
// vende una habitación/pareja/apartamento para cientos de miles de
// personas — un valor así, aunque sea un entero seguro, no representa
// ninguna reserva posible y debe rechazarse ANTES de intentar cualquier
// otra cosa. Es una defensa en profundidad, no la única: el cálculo de
// capacidad de este motor ya es puramente algebraico (no reserva memoria
// proporcional a `adultos`), así que ni siquiera un valor absurdo puede
// hacerlo lento — pero tampoco tiene sentido dejarlo pasar. El adaptador
// que conecte este motor a un formulario real debería imponer un límite
// más estricto todavía (una habitación real rara vez pasa de una decena de
// personas); este es solo el techo absoluto del motor puro.
export const MAX_OCUPANTES_POR_UNIDAD = 500;

// ── 0. Validación de FORMA (datos externos, todavía no tipados) ────────
// Este es el punto de entrada real: los datos vendrán de Postgres/
// adaptadores como `unknown`, no como el `EntradaCotizacion` que
// TypeScript garantiza solo en tiempo de compilación. Aquí se verifica que
// cada pieza tenga la FORMA correcta (objeto/arreglo/string donde
// corresponde) ANTES de que cualquier otra función intente leer una
// propiedad — así un `null` donde se esperaba un arreglo nunca llega a
// producir un `TypeError`, siempre produce `configuracion_invalida`.
// `tarifa.id`/`versionTarifario` se exigen aquí (no al construir el
// snapshot) porque un `ResultadoValido` debe poder snapshotearse siempre —
// no queremos un cálculo exitoso que después falle al persistir.
export function validarFormaEntrada(entradaDesconocida: unknown): { entrada: EntradaCotizacion } | ResultadoBloqueado {
  if (!esObjeto(entradaDesconocida)) {
    return resultadoBloqueado("configuracion_invalida", "La entrada debe ser un objeto con `tarifa`, `distribucion` y `noches`.");
  }
  const { tarifa, distribucion, noches } = entradaDesconocida;

  if (!esObjeto(tarifa)) {
    return resultadoBloqueado("configuracion_invalida", "`tarifa` debe ser un objeto.");
  }
  if (typeof tarifa.id !== "string" || tarifa.id.trim() === "") {
    return resultadoBloqueado("configuracion_invalida", "`tarifa.id` es obligatorio (string no vacío).");
  }
  if (typeof tarifa.versionTarifario !== "string" || tarifa.versionTarifario.trim() === "") {
    return resultadoBloqueado(
      "configuracion_invalida",
      "`tarifa.versionTarifario` es obligatorio (string no vacío) — sin él no se puede construir un snapshot persistible."
    );
  }
  if (
    tarifa.unidadCobro !== "persona" &&
    tarifa.unidadCobro !== "pareja" &&
    tarifa.unidadCobro !== "habitacion" &&
    tarifa.unidadCobro !== "apartamento"
  ) {
    return resultadoBloqueado(
      "configuracion_invalida",
      '`tarifa.unidadCobro` debe ser "persona", "pareja", "habitacion" o "apartamento".',
      { unidadCobro: tarifa.unidadCobro }
    );
  }
  if (!esObjeto(tarifa.valores)) {
    return resultadoBloqueado("configuracion_invalida", "`tarifa.valores` debe ser un objeto.");
  }
  for (const clave of Object.keys(tarifa.valores)) {
    if (clave !== "adulto" && clave !== "nino" && clave !== "infante" && clave !== "periodicidadInfante") {
      return resultadoBloqueado(
        "configuracion_invalida",
        `"tarifa.valores" no puede contener la clave "${clave}" — solo admite adulto/nino/infante/periodicidadInfante.`,
        { clave }
      );
    }
  }
  // `adulto` es el único valor SIEMPRE obligatorio — sin él el motor
  // producía `NaN` en el desglose (ya lo bloquea también la validación
  // numérica de más abajo, pero exigirlo aquí evita depender solo de eso:
  // `{ valores: {} }` y `{ adulto: undefined }` fallan ya en esta forma).
  if (typeof tarifa.valores.adulto !== "number") {
    return resultadoBloqueado("configuracion_invalida", "`tarifa.valores.adulto` es obligatorio y debe ser un número.");
  }
  if (tarifa.valores.nino !== undefined && typeof tarifa.valores.nino !== "number") {
    return resultadoBloqueado("configuracion_invalida", "`tarifa.valores.nino`, si existe, debe ser un número.");
  }
  if (tarifa.valores.infante !== undefined && typeof tarifa.valores.infante !== "number") {
    return resultadoBloqueado("configuracion_invalida", "`tarifa.valores.infante`, si existe, debe ser un número.");
  }
  // El PDF Bernalo no es inequívoco sobre la periodicidad del seguro
  // hotelero de 0-3 años ("$30.000 seguro hotelero", sin calificador de
  // tiempo) — a diferencia de adulto/nino, que sí lo son. Por eso, cuando
  // `infante` está configurado, `periodicidadInfante` es un dato
  // OBLIGATORIO (verificado también en `validarEntrada`); aquí solo se
  // valida la FORMA del enum si viene presente.
  if (
    tarifa.valores.periodicidadInfante !== undefined &&
    tarifa.valores.periodicidadInfante !== "por_noche" &&
    tarifa.valores.periodicidadInfante !== "por_estadia"
  ) {
    return resultadoBloqueado(
      "configuracion_invalida",
      '`tarifa.valores.periodicidadInfante`, si existe, debe ser "por_noche" o "por_estadia".',
      { periodicidadInfante: tarifa.valores.periodicidadInfante }
    );
  }
  if (!esObjeto(tarifa.capacidad)) {
    return resultadoBloqueado("configuracion_invalida", "`tarifa.capacidad` debe ser un objeto.");
  }
  if (!Array.isArray(tarifa.suplementos)) {
    return resultadoBloqueado("configuracion_invalida", "`tarifa.suplementos` debe ser un arreglo.");
  }
  for (let i = 0; i < tarifa.suplementos.length; i++) {
    const s = tarifa.suplementos[i];
    if (!esObjeto(s) || typeof s.tipo !== "string") {
      return resultadoBloqueado("configuracion_invalida", `El suplemento en la posición ${i + 1} debe ser un objeto con "tipo".`, {
        indice: i,
      });
    }
    if (s.tipo !== "adulto_adicional" && s.tipo !== "persona_sola" && s.tipo !== "menor_adicional") {
      return resultadoBloqueado(
        "configuracion_invalida",
        `El suplemento en la posición ${i + 1} tiene un "tipo" desconocido: "${s.tipo}" (solo adulto_adicional/persona_sola/menor_adicional).`,
        { indice: i, tipo: s.tipo }
      );
    }
    if (s.tipo === "menor_adicional") {
      if (s.categoriaMenor !== "nino" && s.categoriaMenor !== "infante") {
        return resultadoBloqueado(
          "configuracion_invalida",
          `El suplemento "menor_adicional" en la posición ${i + 1} requiere "categoriaMenor" ("nino" o "infante").`,
          { indice: i, categoriaMenor: s.categoriaMenor }
        );
      }
    } else if (s.categoriaMenor !== undefined) {
      return resultadoBloqueado(
        "configuracion_invalida",
        `El suplemento "${s.tipo}" en la posición ${i + 1} no admite "categoriaMenor".`,
        { indice: i, tipo: s.tipo }
      );
    }
  }
  if (!esObjeto(tarifa.reglaMenores) || !Array.isArray(tarifa.reglaMenores.reglas)) {
    return resultadoBloqueado("configuracion_invalida", "`tarifa.reglaMenores.reglas` debe ser un arreglo.");
  }
  for (let i = 0; i < tarifa.reglaMenores.reglas.length; i++) {
    const r = tarifa.reglaMenores.reglas[i];
    if (!esObjeto(r)) {
      return resultadoBloqueado("configuracion_invalida", `La regla de menores en la posición ${i + 1} debe ser un objeto.`, {
        indice: i,
      });
    }
    if (r.categoria !== "nino" && r.categoria !== "infante" && r.categoria !== "adulto") {
      return resultadoBloqueado(
        "configuracion_invalida",
        `La regla de menores en la posición ${i + 1} tiene una "categoria" desconocida: "${r.categoria}" (solo infante/nino/adulto).`,
        { indice: i, categoria: r.categoria }
      );
    }
  }
  for (const campo of ["temporada", "categoria", "alimentacion"] as const) {
    const v = tarifa[campo];
    if (v !== undefined && v !== null && typeof v !== "string") {
      return resultadoBloqueado("configuracion_invalida", `"tarifa.${campo}", si existe, debe ser un string o null.`, { campo, valor: v });
    }
  }
  if (tarifa.fuente !== undefined && tarifa.fuente !== null) {
    if (!esObjeto(tarifa.fuente)) {
      return resultadoBloqueado("configuracion_invalida", "`tarifa.fuente` debe ser un objeto, null o estar ausente.");
    }
    if (typeof tarifa.fuente.documento !== "string" || tarifa.fuente.documento.trim() === "") {
      return resultadoBloqueado("configuracion_invalida", "`tarifa.fuente.documento` debe ser un string no vacío.");
    }
    const pagina = tarifa.fuente.pagina;
    if (pagina !== null && !(typeof pagina === "number" && Number.isInteger(pagina) && pagina > 0)) {
      return resultadoBloqueado("configuracion_invalida", "`tarifa.fuente.pagina` debe ser un entero positivo o null.");
    }
  }

  if (!esObjeto(distribucion) || !Array.isArray(distribucion.unidades)) {
    return resultadoBloqueado("configuracion_invalida", "`distribucion.unidades` debe ser un arreglo.");
  }
  for (let i = 0; i < distribucion.unidades.length; i++) {
    const u = distribucion.unidades[i];
    if (!esObjeto(u)) {
      return resultadoBloqueado("configuracion_invalida", `La unidad ${i + 1} debe ser un objeto.`, { indice: i });
    }
    if (!Array.isArray(u.menores)) {
      return resultadoBloqueado("configuracion_invalida", `La unidad ${i + 1}: "menores" debe ser un arreglo.`, { indice: i });
    }
    for (let j = 0; j < u.menores.length; j++) {
      if (!esObjeto(u.menores[j])) {
        return resultadoBloqueado("configuracion_invalida", `La unidad ${i + 1}, menor ${j + 1}: debe ser un objeto.`, {
          indice: i,
          menorIndice: j,
        });
      }
    }
  }

  if (typeof noches !== "number") {
    return resultadoBloqueado("configuracion_invalida", "`noches` debe ser un número.");
  }

  return { entrada: entradaDesconocida as EntradaCotizacion };
}

// ── 0.bis Coherencia de la tarifa según su unidadCobro ──────────────────
// Cierra el hueco de "campos que la tarifa admite pero el cálculo ignora en
// silencio": una tarifa "persona" con suplementos configurados, o una
// pareja/habitación con `valores.nino`/`infante` cargados, quedaban
// aceptadas por el tipo pero nunca se usaban — ahora son
// `configuracion_invalida` explícito.
const SUPLEMENTOS_VALIDOS_POR_UNIDAD: Record<UnidadCobro, ReadonlySet<SuplementoConfigurado["tipo"]>> = {
  persona: new Set([]),
  pareja: new Set(["adulto_adicional", "persona_sola", "menor_adicional"]),
  habitacion: new Set(["adulto_adicional", "menor_adicional"]), // sin persona_sola: una SGL es otra tarifa
  apartamento: new Set(["adulto_adicional", "menor_adicional"]),
};

export function validarCoherenciaTarifa(tarifa: TarifaAlojamiento): ResultadoBloqueado | null {
  if (tarifa.unidadCobro === "persona" && tarifa.suplementos.length > 0) {
    return resultadoBloqueado(
      "configuracion_invalida",
      'Una tarifa "persona" no admite suplementos — cada categoría de pasajero ya tiene su propio valor en `valores`.',
      { unidadCobro: tarifa.unidadCobro, suplementos: tarifa.suplementos }
    );
  }

  if (tarifa.unidadCobro !== "persona" && (tarifa.valores.nino !== undefined || tarifa.valores.infante !== undefined)) {
    return resultadoBloqueado(
      "configuracion_invalida",
      `Una tarifa "${tarifa.unidadCobro}" no usa \`valores.nino\`/\`valores.infante\` — el cálculo los ignoraría en silencio.`,
      { unidadCobro: tarifa.unidadCobro }
    );
  }

  const validos = SUPLEMENTOS_VALIDOS_POR_UNIDAD[tarifa.unidadCobro];
  for (const s of tarifa.suplementos) {
    if (!validos.has(s.tipo)) {
      return resultadoBloqueado(
        "configuracion_invalida",
        `El suplemento "${s.tipo}" no es válido para una tarifa "${tarifa.unidadCobro}".`,
        { unidadCobro: tarifa.unidadCobro, tipo: s.tipo }
      );
    }
  }

  return null;
}

// ── 0.ter Coherencia de capacidad según `unidadCobro` ───────────────────
// Se ejecuta DESPUÉS de `validarEntrada` (que ya garantiza minPax/maxPax/
// paxIncluidos enteros seguros, minPax<=maxPax y paxIncluidos<=maxPax) —
// aquí solo se agregan las reglas ESPECÍFICAS de cada unidad, para que
// `capacidad.paxIncluidos` nunca "parezca" tener un efecto que en realidad
// no tiene:
//   persona    → paxIncluidos no interviene en el precio; se exige 0 como
//                único valor canónico (cualquier otro sería engañoso).
//   pareja     → la base SIEMPRE representa exactamente 2 adultos
//                (hardcoded en `aplicarSuplementosUnidad`); minPax debe
//                permitir 2, maxPax debe admitir 2, y paxIncluidos debe SER
//                2 — no hay otro valor que tenga sentido.
//   habitación/apartamento → paxIncluidos debe estar entre minPax y maxPax
//                (el límite superior ya lo valida `validarEntrada`; aquí se
//                agrega el inferior: `minPax:2, paxIncluidos:0` significa
//                "ni siquiera la ocupación mínima está cubierta sin
//                suplemento", una configuración incoherente).
export function validarCoherenciaCapacidad(tarifa: TarifaAlojamiento): ResultadoBloqueado | null {
  const { minPax, maxPax, paxIncluidos } = tarifa.capacidad;

  if (tarifa.unidadCobro === "persona") {
    if (paxIncluidos !== 0) {
      return resultadoBloqueado(
        "configuracion_invalida",
        '`capacidad.paxIncluidos` no interviene en el precio de una tarifa "persona" — debe ser exactamente 0 para no sugerir un efecto que no existe.',
        { paxIncluidos }
      );
    }
    return null;
  }

  if (tarifa.unidadCobro === "pareja") {
    if (minPax > 2) {
      return resultadoBloqueado(
        "configuracion_invalida",
        'Una tarifa "pareja" representa exactamente 2 adultos — `capacidad.minPax` no puede ser mayor que 2.',
        { minPax }
      );
    }
    if (maxPax !== null && maxPax < 2) {
      return resultadoBloqueado(
        "configuracion_invalida",
        'Una tarifa "pareja" representa exactamente 2 adultos — `capacidad.maxPax` no puede ser menor que 2.',
        { maxPax }
      );
    }
    if (paxIncluidos !== 2) {
      return resultadoBloqueado(
        "configuracion_invalida",
        'Una tarifa "pareja" siempre representa exactamente 2 adultos — `capacidad.paxIncluidos` debe ser exactamente 2.',
        { paxIncluidos }
      );
    }
    return null;
  }

  // habitacion | apartamento
  if (paxIncluidos < minPax) {
    return resultadoBloqueado(
      "configuracion_invalida",
      '`capacidad.paxIncluidos` no puede ser menor que `capacidad.minPax` — la unidad no podría venderse ni en su ocupación mínima sin un suplemento.',
      { minPax, paxIncluidos }
    );
  }
  return null;
}

// ── A. Aplicación de reglas de menores ──────────────────────────────────
// Clasifica cada menor por edad. Una edad sin regla que la cubra NO se
// convierte en adulto — falla cerrado. Una edad cubierta por más de una
// regla a la vez es una configuración ambigua — también falla cerrado (el
// caso de selección entre VARIAS TARIFAS candidatas por prioridad es un
// problema distinto, de un PR posterior con motor de selección; aquí solo
// existe una tarifa ya elegida, y esta ambigüedad es sobre reglas de edad).
export function clasificarMenores(
  menores: Menor[],
  reglaMenores: ReglaMenores
): { clasificados: MenorClasificado[] } | ResultadoBloqueado {
  const clasificados: MenorClasificado[] = [];
  for (const menor of menores) {
    const coincidencias = reglaMenores.reglas.filter(
      (r) => menor.edadAnios >= r.edadMinAnios && menor.edadAnios <= r.edadMaxAnios
    );
    if (coincidencias.length > 1) {
      return resultadoBloqueado(
        "combinacion_ambigua",
        `La edad ${menor.edadAnios} coincide con más de una regla de menores (${coincidencias.map((c) => c.categoria).join(", ")}).`,
        { edadAnios: menor.edadAnios, categorias: coincidencias.map((c) => c.categoria) }
      );
    }
    if (coincidencias.length === 0) {
      return resultadoBloqueado(
        "edad_fuera_de_regla",
        `No hay una regla de menores configurada que cubra la edad ${menor.edadAnios} años.`,
        { edadAnios: menor.edadAnios }
      );
    }
    // `valorAplicado` no se resuelve aquí — es un concepto por-pasajero que
    // solo aplica a "persona" (ver `MenorClasificado`); `calcularPersona`
    // lo completa después de esta clasificación.
    clasificados.push({
      edadAnios: menor.edadAnios,
      categoriaTarifaria: coincidencias[0].categoria,
      reglaAplicada: coincidencias[0],
      valorAplicado: null,
    });
  }
  return { clasificados };
}

// ── B. Validación fail-closed de la configuración/entrada ──────────────
// Corre ANTES de calcular nada. Separa "el dato está mal formado" de "no
// hay precio configurado": un valor no-entero/negativo/NaN/Infinity, un
// rango de edad invertido, o un suplemento duplicado son errores de
// CONFIGURACIÓN (`configuracion_invalida`) — nunca se confunden con
// `tarifa_no_encontrada` (que significa "todo bien formado, pero falta un
// precio para este caso puntual"). También arma el mapa de suplementos por
// clave única (sin duplicados) que el resto del motor usa en vez de
// `.find()` — con `.find()` una configuración duplicada se resuelve
// arbitrariamente por la primera coincidencia; con el mapa, se detecta y
// bloquea antes de calcular cualquier cosa.
export function validarEntrada(
  tarifa: TarifaAlojamiento,
  entrada: EntradaCotizacion
): { mapaSuplementos: Map<string, SuplementoConfigurado> } | ResultadoBloqueado {
  if (!esEnteroSeguro(entrada.noches)) {
    return resultadoBloqueado("configuracion_invalida", "`noches` debe ser un entero.", { noches: entrada.noches });
  }
  if (entrada.noches < 0) {
    return resultadoBloqueado("configuracion_invalida", "`noches` no puede ser negativo.", { noches: entrada.noches });
  }

  // `adulto` es SIEMPRE obligatorio (ya se exigió su tipo en
  // `validarFormaEntrada`; aquí se exige que además sea un entero SEGURO —
  // rechaza NaN, Infinity y valores mayores a `Number.MAX_SAFE_INTEGER`,
  // que antes de esta ronda pasaban sin más y producían `totalNetoPorNoche:
  // NaN` con `ok: true`).
  if (!esEnteroSeguro(tarifa.valores.adulto) || tarifa.valores.adulto < 0) {
    return resultadoBloqueado("configuracion_invalida", "`tarifa.valores.adulto` debe ser un entero seguro >= 0.", {
      valor: tarifa.valores.adulto,
    });
  }
  if (tarifa.valores.nino !== undefined && (!esEnteroSeguro(tarifa.valores.nino) || tarifa.valores.nino < 0)) {
    return resultadoBloqueado("configuracion_invalida", "`tarifa.valores.nino` debe ser un entero seguro >= 0.", {
      valor: tarifa.valores.nino,
    });
  }
  if (tarifa.valores.infante !== undefined && (!esEnteroSeguro(tarifa.valores.infante) || tarifa.valores.infante < 0)) {
    return resultadoBloqueado("configuracion_invalida", "`tarifa.valores.infante` debe ser un entero seguro >= 0.", {
      valor: tarifa.valores.infante,
    });
  }
  // Periodicidad de `infante`: obligatoria cuando `infante` está
  // configurado (el PDF no es inequívoco — ver `PeriodicidadCobro`), y sin
  // sentido si `infante` no está configurado.
  if (tarifa.valores.infante !== undefined && tarifa.valores.periodicidadInfante === undefined) {
    return resultadoBloqueado(
      "configuracion_invalida",
      "`tarifa.valores.periodicidadInfante` es obligatorio cuando `infante` está configurado — no se precarga una interpretación."
    );
  }
  if (tarifa.valores.infante === undefined && tarifa.valores.periodicidadInfante !== undefined) {
    return resultadoBloqueado(
      "configuracion_invalida",
      "`tarifa.valores.periodicidadInfante` no tiene sentido sin `infante` configurado."
    );
  }

  const { minPax, maxPax, paxIncluidos } = tarifa.capacidad;
  if (!esEnteroSeguro(minPax) || minPax < 1) {
    return resultadoBloqueado("configuracion_invalida", "`capacidad.minPax` debe ser un entero >= 1.", { minPax });
  }
  if (maxPax !== null && (!esEnteroSeguro(maxPax) || maxPax < minPax)) {
    return resultadoBloqueado("configuracion_invalida", "`capacidad.maxPax` debe ser null o un entero >= minPax.", {
      minPax,
      maxPax,
    });
  }
  if (!esEnteroSeguro(paxIncluidos) || paxIncluidos < 0 || (maxPax !== null && paxIncluidos > maxPax)) {
    return resultadoBloqueado(
      "configuracion_invalida",
      "`capacidad.paxIncluidos` debe ser un entero dentro de la capacidad (>= 0 y <= maxPax si existe).",
      { paxIncluidos, minPax, maxPax }
    );
  }

  for (const r of tarifa.reglaMenores.reglas) {
    if (
      !esEnteroSeguro(r.edadMinAnios) ||
      !esEnteroSeguro(r.edadMaxAnios) ||
      r.edadMinAnios < 0 ||
      r.edadMaxAnios < 0 ||
      r.edadMinAnios > r.edadMaxAnios
    ) {
      return resultadoBloqueado(
        "configuracion_invalida",
        `La regla de edad para "${r.categoria}" es inválida (límites deben ser enteros >= 0 con mínimo <= máximo).`,
        { regla: r }
      );
    }
  }

  const mapaSuplementos = new Map<string, SuplementoConfigurado>();
  for (const s of tarifa.suplementos) {
    if (!esEnteroSeguro(s.valor) || s.valor < 0) {
      return resultadoBloqueado("configuracion_invalida", `El suplemento "${s.tipo}" debe tener un valor entero >= 0.`, {
        suplemento: s,
      });
    }
    const clave = claveSuplemento(s);
    if (mapaSuplementos.has(clave)) {
      return resultadoBloqueado(
        "configuracion_invalida",
        `Hay más de un suplemento configurado para "${clave}" — configuración ambigua, no se elige arbitrariamente el primero.`,
        { clave }
      );
    }
    mapaSuplementos.set(clave, s);
  }

  if (!Array.isArray(entrada.distribucion?.unidades) || entrada.distribucion.unidades.length === 0) {
    return resultadoBloqueado("configuracion_invalida", "`distribucion.unidades` debe tener al menos 1 unidad.");
  }
  for (let i = 0; i < entrada.distribucion.unidades.length; i++) {
    const u = entrada.distribucion.unidades[i];
    if (!esEnteroSeguro(u.adultos) || u.adultos < 0) {
      return resultadoBloqueado("configuracion_invalida", `La unidad ${i + 1}: "adultos" debe ser un entero >= 0.`, {
        indice: i,
        adultos: u.adultos,
      });
    }
    // Límite comercial: se revisa ANTES de cualquier otro cómputo sobre
    // esta unidad, para que un valor absurdo (ej. `adultos: 5_000_000` con
    // `maxPax: null`) falle rápido por sí solo — sin depender de que la
    // capacidad configurada lo capture, y sin que el motor llegue siquiera
    // a intentar clasificar menores o aplicar suplementos para esa unidad.
    if (u.adultos > MAX_OCUPANTES_POR_UNIDAD || u.menores.length > MAX_OCUPANTES_POR_UNIDAD) {
      return resultadoBloqueado(
        "configuracion_invalida",
        `La unidad ${i + 1} excede el límite comercial de ocupantes de este motor (${MAX_OCUPANTES_POR_UNIDAD}).`,
        { indice: i, adultos: u.adultos, menores: u.menores.length, limite: MAX_OCUPANTES_POR_UNIDAD }
      );
    }
    for (const m of u.menores) {
      if (!esEnteroSeguro(m.edadAnios) || m.edadAnios < 0) {
        return resultadoBloqueado(
          "configuracion_invalida",
          `La unidad ${i + 1}: la edad de un menor debe ser un entero >= 0.`,
          { indice: i, edadAnios: m.edadAnios }
        );
      }
    }
  }

  return { mapaSuplementos };
}

// ── C. Validación de ocupación (por unidad) ─────────────────────────────
// Solo decide si ESTA unidad, ya con números bien formados, es una
// ocupación aceptable: capacidad y "al menos un adulto". No decide precio.
export function validarUnidadOcupada(tarifa: TarifaAlojamiento, unidad: UnidadOcupada, indice: number): ResultadoBloqueado | null {
  const totalPax = unidad.adultos + unidad.menores.length;
  const { minPax, maxPax } = tarifa.capacidad;
  if (maxPax !== null && totalPax > maxPax) {
    return resultadoBloqueado(
      "ocupacion_no_permitida",
      `La unidad ${indice + 1} (${totalPax} pax) excede su capacidad máxima (${maxPax}).`,
      { indice, totalPax, maxPax }
    );
  }
  if (totalPax < minPax) {
    return resultadoBloqueado(
      "ocupacion_no_permitida",
      `La unidad ${indice + 1} (${totalPax} pax) no alcanza la ocupación mínima (${minPax}).`,
      { indice, totalPax, minPax }
    );
  }
  if (unidad.adultos < 1) {
    // No existe todavía una regla comercial configurable para admitir una
    // unidad sin ningún adulto (ej. menores con acompañante externo) — se
    // documenta como reservado, no se implementa en este PR.
    return resultadoBloqueado(
      "ocupacion_no_permitida",
      `La unidad ${indice + 1} no tiene ningún adulto (no hay una regla comercial configurada que lo admita).`,
      { indice }
    );
  }
  return null;
}

// ── D. Determinación de cantidad de unidades cobradas ───────────────────
// persona: suma de adultos de TODAS las unidades (los menores se cobran
// aparte, por categoría, nunca como "unidades"). pareja/habitación/
// apartamento: cuántas unidades hay en la distribución — nunca se deriva
// multiplicando por pax, siempre viene de contar/sumar `distribucion.unidades`.
export function determinarCantidadUnidades(tarifa: TarifaAlojamiento, distribucion: DistribucionUnidades): number {
  if (tarifa.unidadCobro === "persona") {
    return distribucion.unidades.reduce((acc, u) => acc + u.adultos, 0);
  }
  return distribucion.unidades.length;
}

// ── E. Aplicación de suplementos (una unidad de pareja/habitación/apartamento) ──
// Nunca deriva un precio por persona a partir de la tarifa base y lo vuelve
// a multiplicar: cada pax por fuera de lo ya cubierto por ESTA unidad exige
// un suplemento EXACTO (buscado por clave en el mapa ya validado sin
// duplicados), o falla cerrado.
export type ResultadoSuplementosUnidad = {
  suplementos: SuplementoAplicado[];
  // Solo para pareja + "persona sola": no es un cargo ADICIONAL sobre la
  // tarifa de pareja completa (eso duplicaría el cobro) — es una tarifa que
  // REEMPLAZA la línea base de esta unidad. `null` en cualquier otro caso.
  reemplazaBase: SuplementoAplicado | null;
};

export function aplicarSuplementosUnidad(
  tarifa: TarifaAlojamiento,
  unidad: UnidadOcupada,
  indice: number,
  menoresClasificados: MenorClasificado[],
  mapaSuplementos: Map<string, SuplementoConfigurado>
): ResultadoSuplementosUnidad | ResultadoBloqueado {
  // Un menor clasificado tarifariamente como "adulto" (regla Bernalo 11-17
  // años: "pagan tarifa normal") cuenta como un adulto MÁS para efectos de
  // capacidad y suplementos — nunca necesita `menor_adicional`, necesita
  // `adulto_adicional` como cualquier otro adulto. Sigue apareciendo en
  // `unidad.menores`/conserva su edad; solo se equipara tarifariamente.
  const menoresComoAdulto = menoresClasificados.filter((m) => m.categoriaTarifaria === "adulto").length;
  const menoresRegulares = menoresClasificados.filter((m) => m.categoriaTarifaria !== "adulto"); // nino/infante, en el orden recibido
  const totalAdultosEquiv = unidad.adultos + menoresComoAdulto;

  if (tarifa.unidadCobro === "pareja") {
    const diff = totalAdultosEquiv - 2;
    const suplementos: SuplementoAplicado[] = [];
    let reemplazaBase: SuplementoAplicado | null = null;

    if (diff > 0) {
      const cfg = mapaSuplementos.get("adulto_adicional");
      if (!cfg) {
        return resultadoBloqueado(
          "tarifa_no_encontrada",
          `Unidad ${indice + 1}: no hay suplemento configurado para ${diff} adulto(s) adicional(es) sobre la tarifa por pareja.`,
          { indice, adultosAdicionales: diff }
        );
      }
      suplementos.push({ ...cfg, cantidad: diff, valorTotal: cfg.valor * diff });
    } else if (diff < 0) {
      // `validarUnidadOcupada` ya garantizó adultos >= 1, así que el único
      // déficit posible aquí es totalAdultosEquiv === 1 (diff === -1):
      // persona sola.
      const cfg = mapaSuplementos.get("persona_sola");
      if (!cfg) {
        return resultadoBloqueado("tarifa_no_encontrada", `Unidad ${indice + 1}: no hay tarifa de persona sola configurada.`, {
          indice,
        });
      }
      reemplazaBase = { ...cfg, cantidad: 1, valorTotal: cfg.valor };
    }

    for (const grupo of agruparMenorAdicional(menoresRegulares)) {
      const cfg = mapaSuplementos.get(`menor_adicional:${grupo.categoriaMenor}`);
      if (!cfg) {
        return resultadoBloqueado(
          "tarifa_no_encontrada",
          `Unidad ${indice + 1}: no hay suplemento configurado para menor adicional (${grupo.categoriaMenor}).`,
          { indice, categoria: grupo.categoriaMenor, cantidad: grupo.cantidad }
        );
      }
      suplementos.push({ ...cfg, cantidad: grupo.cantidad, valorTotal: cfg.valor * grupo.cantidad });
    }

    return { suplementos, reemplazaBase };
  }

  // habitacion | apartamento: el pax por fuera de `paxIncluidos` DE ESTA
  // UNIDAD se factura contra un suplemento configurado exacto.
  //
  // Cálculo puramente ALGEBRAICO — nunca se construye un arreglo del
  // tamaño de `unidad.adultos` (antes: `Array.from({length:
  // unidad.adultos})`), que reservaría memoria proporcional a un número
  // que puede llegar de afuera sin control. `adultosExtra` es O(1); solo
  // se itera `menoresRegulares`, que está acotado por los menores REALES
  // recibidos (un arreglo ya en memoria, nunca sintetizado a partir de un
  // conteo), nunca por el valor numérico de `adultos`.
  //
  // Los adultos (incl. equivalentes) cubren primero los cupos incluidos;
  // el resto de cupos, si sobra alguno, se reparte entre los menores
  // regulares EN EL ORDEN en que llegaron — mismo criterio determinista
  // que la versión anterior basada en posición, expresado sin arreglos.
  const incluidos = tarifa.capacidad.paxIncluidos;
  const adultosIncluidos = Math.min(totalAdultosEquiv, incluidos);
  const adultosExtra = totalAdultosEquiv - adultosIncluidos;

  let cuposRestantes = incluidos - adultosIncluidos; // siempre >= 0
  const menoresExtra: MenorClasificado[] = [];
  for (const m of menoresRegulares) {
    if (cuposRestantes > 0) cuposRestantes--;
    else menoresExtra.push(m);
  }

  if (adultosExtra === 0 && menoresExtra.length === 0) return { suplementos: [], reemplazaBase: null };

  const suplementos: SuplementoAplicado[] = [];
  if (adultosExtra > 0) {
    const cfg = mapaSuplementos.get("adulto_adicional");
    if (!cfg) {
      return resultadoBloqueado(
        "tarifa_no_encontrada",
        `Unidad ${indice + 1}: no hay suplemento configurado para ${adultosExtra} adulto(s) adicional(es) sobre la capacidad incluida.`,
        { indice, adultosAdicionales: adultosExtra }
      );
    }
    suplementos.push({ ...cfg, cantidad: adultosExtra, valorTotal: cfg.valor * adultosExtra });
  }
  for (const grupo of agruparMenorAdicional(menoresExtra)) {
    const cfg = mapaSuplementos.get(`menor_adicional:${grupo.categoriaMenor}`);
    if (!cfg) {
      return resultadoBloqueado(
        "tarifa_no_encontrada",
        `Unidad ${indice + 1}: no hay suplemento configurado para menor adicional (${grupo.categoriaMenor}) sobre la capacidad incluida.`,
        { indice, categoria: grupo.categoriaMenor, cantidad: grupo.cantidad }
      );
    }
    suplementos.push({ ...cfg, cantidad: grupo.cantidad, valorTotal: cfg.valor * grupo.cantidad });
  }
  return { suplementos, reemplazaBase: null };
}

// ── F. Construcción del desglose ────────────────────────────────────────
export function construirDesgloseUnidad(
  tarifa: TarifaAlojamiento,
  indice: number,
  resultado: ResultadoSuplementosUnidad
): DesgloseLinea[] {
  const lineas: DesgloseLinea[] = [];
  // Sin ambigüedad para pareja/habitación/apartamento: la base y sus
  // suplementos son siempre por noche (el PDF nunca deja duda sobre eso
  // fuera del caso puntual del seguro hotelero de 0-3 años, que solo
  // existe para "persona" — ver `construirDesglosePersona`).
  if (resultado.reemplazaBase) {
    lineas.push({
      concepto: etiquetaSuplemento(resultado.reemplazaBase),
      tipo: "base",
      cantidad: 1,
      valorUnitario: resultado.reemplazaBase.valor,
      valorTotal: resultado.reemplazaBase.valorTotal,
      unidadIndex: indice,
      periodicidad: "por_noche",
    });
  } else {
    const conceptoBase =
      tarifa.unidadCobro === "pareja" ? "Pareja" : tarifa.unidadCobro === "habitacion" ? "Habitación" : "Apartamento";
    lineas.push({
      concepto: conceptoBase,
      tipo: "base",
      cantidad: 1,
      valorUnitario: tarifa.valores.adulto,
      valorTotal: tarifa.valores.adulto,
      unidadIndex: indice,
      periodicidad: "por_noche",
    });
  }
  for (const s of resultado.suplementos) {
    lineas.push({
      concepto: etiquetaSuplemento(s),
      tipo: "suplemento",
      cantidad: s.cantidad,
      valorUnitario: s.valor,
      valorTotal: s.valorTotal,
      unidadIndex: indice,
      periodicidad: "por_noche",
    });
  }
  return lineas;
}

export function construirDesglosePersona(
  tarifa: TarifaAlojamiento,
  totalAdultos: number,
  menoresClasificados: MenorClasificado[]
): DesgloseLinea[] {
  const lineas: DesgloseLinea[] = [
    {
      concepto: "Adultos",
      tipo: "base",
      cantidad: totalAdultos,
      valorUnitario: tarifa.valores.adulto,
      valorTotal: totalAdultos * tarifa.valores.adulto,
      unidadIndex: null,
      periodicidad: "por_noche",
    },
  ];
  for (const grupo of agruparPorCategoriaTarifaria(menoresClasificados)) {
    const valorUnitario = tarifa.valores[grupo.categoriaTarifaria] as number; // ya validado antes de llegar aquí
    const concepto =
      grupo.categoriaTarifaria === "adulto" ? "Menor con tarifa de adulto" : grupo.categoriaTarifaria === "nino" ? "Niños" : "Infantes";
    // "adulto"/"nino" son inequívocamente por noche (el PDF los deriva de
    // "Precio por persona por noche"); "infante" usa la periodicidad
    // explícita de la tarifa — `validarEntrada` ya garantizó que existe
    // cuando `infante` está configurado.
    const periodicidad: PeriodicidadCobro =
      grupo.categoriaTarifaria === "infante" ? (tarifa.valores.periodicidadInfante as PeriodicidadCobro) : "por_noche";
    lineas.push({
      concepto,
      tipo: "menor",
      cantidad: grupo.cantidad,
      valorUnitario,
      valorTotal: grupo.cantidad * valorUnitario,
      unidadIndex: null,
      periodicidad,
    });
  }
  return lineas;
}

// ── Orquestador ──────────────────────────────────────────────────────────
// Compone las funciones puras de arriba. No consulta Supabase: recibe la
// tarifa YA seleccionada (la selección entre varias tarifas candidatas por
// prioridad/vigencia es del motor de selección, un PR posterior).
//
// Acepta `unknown` a propósito: es el límite real del motor contra datos
// externos (Postgres/adaptadores). Un llamador con datos ya tipados
// (`EntradaCotizacion`) sigue teniendo el mismo chequeo de TypeScript de
// siempre — `unknown` no le quita nada — pero un dato genuinamente
// malformado en runtime nunca produce un `TypeError`, siempre
// `configuracion_invalida`.
export function cotizarUnidadAlojamiento(entradaDesconocida: unknown): ResultadoCotizacionUnidad {
  const forma = validarFormaEntrada(entradaDesconocida);
  if (esBloqueado(forma)) return forma;
  const { entrada } = forma;
  const { tarifa, distribucion, noches } = entrada;

  const coherencia = validarCoherenciaTarifa(tarifa);
  if (coherencia) return coherencia;

  const validacion = validarEntrada(tarifa, entrada);
  if (esBloqueado(validacion)) return validacion;
  const { mapaSuplementos } = validacion;

  const coherenciaCapacidad = validarCoherenciaCapacidad(tarifa);
  if (coherenciaCapacidad) return coherenciaCapacidad;

  if (noches === 0) {
    return resultadoBloqueado(
      "producto_no_soportado",
      "Este motor cubre alojamiento por noches (>= 1); day use (0 noches) no está soportado en este alcance.",
      { noches }
    );
  }

  const calculo =
    tarifa.unidadCobro === "persona"
      ? calcularPersona(tarifa, distribucion, noches)
      : calcularNoPersona(tarifa, distribucion, noches, mapaSuplementos);
  if (esBloqueado(calculo)) return calculo;

  // Aserción interna antes de devolver `ok:true`: recalcula cada línea y
  // cada total con aritmética SEGURA y los compara contra lo que
  // `calculo` produjo. Antes de esta ronda, un desbordamiento de
  // `Number.MAX_SAFE_INTEGER` en cualquier multiplicación/suma (valor ×
  // cantidad, suplemento × cantidad, total × noches) simplemente perdía
  // precisión en silencio y el motor igual respondía `ok:true`.
  const inconsistencia = verificarConsistenciaResultado(calculo);
  if (inconsistencia) return inconsistencia;

  // `datosFuente` se arma UNA sola vez, aquí, con la MISMA tarifa/
  // distribución que efectivamente produjeron `calculo` — no hay otro
  // punto de entrada que pueda mezclar datos de otro cálculo.
  const datosFuente: DatosFuenteSnapshot = clonarProfundo({
    tarifaId: tarifa.id,
    versionTarifario: tarifa.versionTarifario,
    unidadCobro: tarifa.unidadCobro,
    valores: tarifa.valores,
    capacidad: tarifa.capacidad,
    reglaMenoresAplicada: tarifa.reglaMenores,
    distribucion,
    temporada: tarifa.temporada ?? null,
    categoria: tarifa.categoria ?? null,
    alimentacion: tarifa.alimentacion ?? null,
    fuente: tarifa.fuente ?? null,
  });

  return { ...calculo, datosFuente };
}

// El núcleo del cálculo todavía no trae `datosFuente` — lo agrega el
// orquestador, una sola vez, para que sea imposible construirlo con datos
// de otra tarifa/distribución.
type ResultadoCalculoCore = Omit<ResultadoValido, "datosFuente"> | ResultadoBloqueado;

function calcularPersona(tarifa: TarifaAlojamiento, distribucion: DistribucionUnidades, noches: number): ResultadoCalculoCore {
  let totalAdultos = 0;
  const menoresClasificados: MenorClasificado[] = [];
  const capacidadUtilizada: CapacidadUtilizadaUnidad[] = [];

  for (let i = 0; i < distribucion.unidades.length; i++) {
    const unidad = distribucion.unidades[i];
    const bloqueoCapacidad = validarUnidadOcupada(tarifa, unidad, i);
    if (bloqueoCapacidad) return bloqueoCapacidad;

    const clasif = clasificarMenores(unidad.menores, tarifa.reglaMenores);
    if (esBloqueado(clasif)) return clasif;

    totalAdultos += unidad.adultos;
    menoresClasificados.push(...clasif.clasificados);
    capacidadUtilizada.push({
      indice: i,
      adultos: unidad.adultos,
      menores: unidad.menores.length,
      totalPax: unidad.adultos + unidad.menores.length,
    });
  }

  // Resuelve `valorAplicado` por menor — un concepto por-pasajero que solo
  // aplica a "persona". Si una categoría (nino/infante) no tiene valor
  // configurado, `tarifa_no_encontrada` (capacidad OK, pero no hay precio
  // para este caso puntual). "adulto" siempre existe (ya lo exige
  // `validarEntrada`), así que un "menor con tarifa de adulto" nunca cae
  // en esta rama.
  const menoresConValor: MenorClasificado[] = [];
  for (const m of menoresClasificados) {
    const valor = tarifa.valores[m.categoriaTarifaria];
    if (valor === undefined) {
      return resultadoBloqueado("tarifa_no_encontrada", `No hay tarifa configurada para la categoría "${m.categoriaTarifaria}".`, {
        categoriaTarifaria: m.categoriaTarifaria,
      });
    }
    menoresConValor.push({ ...m, valorAplicado: valor });
  }

  const desglose = construirDesglosePersona(tarifa, totalAdultos, menoresConValor);
  const { totalNetoPorNoche, totalPorEstadia } = dividirPorPeriodicidad(desglose);

  return {
    ok: true,
    unidadCobro: "persona",
    cantidadUnidades: totalAdultos,
    noches,
    desglose,
    totalNetoPorNoche,
    totalPorEstadia,
    totalNeto: totalNetoPorNoche * noches + totalPorEstadia,
    menoresClasificados: menoresConValor,
    suplementosAplicados: [],
    capacidadUtilizada,
  };
}

function calcularNoPersona(
  tarifa: TarifaAlojamiento,
  distribucion: DistribucionUnidades,
  noches: number,
  mapaSuplementos: Map<string, SuplementoConfigurado>
): ResultadoCalculoCore {
  const desglose: DesgloseLinea[] = [];
  const suplementosAplicados: SuplementoAplicado[] = [];
  const menoresClasificados: MenorClasificado[] = [];
  const capacidadUtilizada: CapacidadUtilizadaUnidad[] = [];

  for (let i = 0; i < distribucion.unidades.length; i++) {
    const unidad = distribucion.unidades[i];

    const bloqueoCapacidad = validarUnidadOcupada(tarifa, unidad, i);
    if (bloqueoCapacidad) return bloqueoCapacidad;

    const clasif = clasificarMenores(unidad.menores, tarifa.reglaMenores);
    if (esBloqueado(clasif)) return clasif;

    const supResultado = aplicarSuplementosUnidad(tarifa, unidad, i, clasif.clasificados, mapaSuplementos);
    if (esBloqueado(supResultado)) return supResultado;

    desglose.push(...construirDesgloseUnidad(tarifa, i, supResultado));
    suplementosAplicados.push(...supResultado.suplementos);
    menoresClasificados.push(...clasif.clasificados);
    capacidadUtilizada.push({
      indice: i,
      adultos: unidad.adultos,
      menores: unidad.menores.length,
      totalPax: unidad.adultos + unidad.menores.length,
    });
  }

  const { totalNetoPorNoche, totalPorEstadia } = dividirPorPeriodicidad(desglose);

  return {
    ok: true,
    unidadCobro: tarifa.unidadCobro,
    cantidadUnidades: distribucion.unidades.length,
    noches,
    desglose,
    totalNetoPorNoche,
    totalPorEstadia,
    totalNeto: totalNetoPorNoche * noches + totalPorEstadia,
    menoresClasificados,
    suplementosAplicados,
    capacidadUtilizada,
  };
}

// Separa el desglose por periodicidad. En pareja/habitación/apartamento
// (y en las líneas de "adulto"/"nino" de persona) TODO es "por_noche" hoy
// — "por_estadia" solo puede aparecer si una tarifa configura
// `infante` con `periodicidadInfante: "por_estadia"`.
function dividirPorPeriodicidad(desglose: DesgloseLinea[]): { totalNetoPorNoche: number; totalPorEstadia: number } {
  let totalNetoPorNoche = 0;
  let totalPorEstadia = 0;
  for (const l of desglose) {
    if (l.periodicidad === "por_estadia") totalPorEstadia += l.valorTotal;
    else totalNetoPorNoche += l.valorTotal;
  }
  return { totalNetoPorNoche, totalPorEstadia };
}

// ── Aserción interna de consistencia (punto 6 + parte del punto 2) ─────
// Único punto de salida "sí": recalcula cada línea y cada total con
// aritmética SEGURA (`esEnteroSeguro`) y los compara contra lo que
// `calcularPersona`/`calcularNoPersona` ya produjeron. Cubre, en un solo
// lugar, TODAS las multiplicaciones/sumas del motor (valor × cantidad de
// cada línea, suma del desglose, total × noches) sin tener que propagar un
// "posible desbordamiento" por cada función interna. Si algo no cuadra —
// por desbordamiento de `Number.MAX_SAFE_INTEGER` o por cualquier otra
// inconsistencia — el motor NUNCA responde `ok:true`.
function verificarConsistenciaResultado(nucleo: Omit<ResultadoValido, "datosFuente">): ResultadoBloqueado | null {
  let sumaPorNoche = 0;
  let sumaPorEstadia = 0;
  for (const l of nucleo.desglose) {
    if (!esEnteroSeguro(l.cantidad) || l.cantidad < 0) {
      return resultadoBloqueado("configuracion_invalida", `La línea "${l.concepto}" tiene una cantidad que no es un entero seguro.`, { linea: l });
    }
    if (!esEnteroSeguro(l.valorUnitario) || l.valorUnitario < 0) {
      return resultadoBloqueado("configuracion_invalida", `La línea "${l.concepto}" tiene un valor unitario que no es un entero seguro.`, {
        linea: l,
      });
    }
    const esperado = l.cantidad * l.valorUnitario;
    if (!esEnteroSeguro(esperado) || esperado !== l.valorTotal) {
      return resultadoBloqueado(
        "configuracion_invalida",
        `La línea "${l.concepto}" es inconsistente: cantidad × valorUnitario no coincide con valorTotal, o el producto excede un entero seguro.`,
        { linea: l }
      );
    }
    if (l.periodicidad !== "por_noche" && l.periodicidad !== "por_estadia") {
      return resultadoBloqueado("configuracion_invalida", `La línea "${l.concepto}" tiene una periodicidad desconocida.`, { linea: l });
    }
    const acumulador = l.periodicidad === "por_estadia" ? sumaPorEstadia : sumaPorNoche;
    const nuevaSuma = acumulador + l.valorTotal;
    if (!esEnteroSeguro(nuevaSuma)) {
      return resultadoBloqueado("configuracion_invalida", "La suma del desglose excede un entero seguro.", {
        sumaParcial: acumulador,
        linea: l,
      });
    }
    if (l.periodicidad === "por_estadia") sumaPorEstadia = nuevaSuma;
    else sumaPorNoche = nuevaSuma;
  }
  if (sumaPorNoche !== nucleo.totalNetoPorNoche) {
    return resultadoBloqueado("configuracion_invalida", "La suma de las líneas 'por_noche' no coincide con `totalNetoPorNoche`.", {
      sumaPorNoche,
      totalNetoPorNoche: nucleo.totalNetoPorNoche,
    });
  }
  if (sumaPorEstadia !== nucleo.totalPorEstadia) {
    return resultadoBloqueado("configuracion_invalida", "La suma de las líneas 'por_estadia' no coincide con `totalPorEstadia`.", {
      sumaPorEstadia,
      totalPorEstadia: nucleo.totalPorEstadia,
    });
  }
  if (!esEnteroSeguro(nucleo.noches) || nucleo.noches < 0) {
    return resultadoBloqueado("configuracion_invalida", "`noches` no es un entero seguro.", { noches: nucleo.noches });
  }
  const totalPorNocheEsperado = nucleo.totalNetoPorNoche * nucleo.noches;
  if (!esEnteroSeguro(totalPorNocheEsperado)) {
    return resultadoBloqueado("configuracion_invalida", "`totalNetoPorNoche` × `noches` excede un entero seguro.", {
      totalNetoPorNoche: nucleo.totalNetoPorNoche,
      noches: nucleo.noches,
    });
  }
  const totalEsperado = totalPorNocheEsperado + nucleo.totalPorEstadia;
  if (!esEnteroSeguro(totalEsperado) || totalEsperado !== nucleo.totalNeto) {
    return resultadoBloqueado(
      "configuracion_invalida",
      "`totalNetoPorNoche` × `noches` + `totalPorEstadia` no coincide con `totalNeto`, o excede un entero seguro.",
      { totalNetoPorNoche: nucleo.totalNetoPorNoche, noches: nucleo.noches, totalPorEstadia: nucleo.totalPorEstadia, totalNeto: nucleo.totalNeto }
    );
  }
  return null;
}

// ── Copia profunda ───────────────────────────────────────────────────────
function clonarProfundo<T>(valor: T): T {
  return typeof structuredClone === "function" ? structuredClone(valor) : (JSON.parse(JSON.stringify(valor)) as T);
}

// ── Snapshot (todavía sin persistir) ────────────────────────────────────
// Copia profunda de TODO lo que entra — nunca conserva una referencia viva
// a la tarifa, la distribución o cualquier objeto anidado que el llamador
// pueda seguir mutando después. Recalcular tarifas futuras nunca puede
// alterar un snapshot ya construido (mismo principio que ya usa
// `contrato_hoteles`/`contrato_items` en el sistema real, ver CLAUDE.md).
//
// `ajusteComercial` queda SIEMPRE en `null` en este PR: la comisión/markup
// Bernalo no está confirmada (ni siquiera se sabe si será markup, comisión
// incluida en PVP o descuento sobre rack) — este motor no ejecuta ninguna
// fórmula de liquidación comercial. El campo existe como espacio
// versionable para cuando esa regla se confirme, en un PR posterior.
export type SnapshotAlojamiento = {
  versionMotor: string;
  unidadCobro: UnidadCobro;
  tarifaId: string;
  valores: ValoresPorCategoria;
  capacidad: CapacidadUnidad;
  distribucion: DistribucionUnidades;
  capacidadUtilizada: CapacidadUtilizadaUnidad[];
  cantidadUnidades: number;
  menoresClasificados: MenorClasificado[];
  reglaMenoresAplicada: ReglaMenores;
  suplementosAplicados: SuplementoAplicado[];
  desglose: DesgloseLinea[];
  noches: number;
  temporada: string | null;
  categoria: string | null;
  alimentacion: string | null;
  totalNetoPorNoche: number;
  totalPorEstadia: number;
  totalNeto: number;
  ajusteComercial: null;
  fuente: { documento: string; pagina: number | null } | null;
  versionTarifario: string;
};

export function construirSnapshotAlojamiento(resultado: ResultadoValido): SnapshotAlojamiento {
  const f = resultado.datosFuente;
  return clonarProfundo({
    versionMotor: VERSION_MOTOR_ALOJAMIENTO,
    unidadCobro: resultado.unidadCobro,
    tarifaId: f.tarifaId,
    valores: f.valores,
    capacidad: f.capacidad,
    distribucion: f.distribucion,
    capacidadUtilizada: resultado.capacidadUtilizada,
    cantidadUnidades: resultado.cantidadUnidades,
    menoresClasificados: resultado.menoresClasificados,
    reglaMenoresAplicada: f.reglaMenoresAplicada,
    suplementosAplicados: resultado.suplementosAplicados,
    desglose: resultado.desglose,
    noches: resultado.noches,
    temporada: f.temporada,
    categoria: f.categoria,
    alimentacion: f.alimentacion,
    totalNetoPorNoche: resultado.totalNetoPorNoche,
    totalPorEstadia: resultado.totalPorEstadia,
    totalNeto: resultado.totalNeto,
    ajusteComercial: null,
    fuente: f.fuente,
    versionTarifario: f.versionTarifario,
  });
}
