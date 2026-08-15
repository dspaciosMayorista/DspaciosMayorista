/**
 * DE QUÉ FICHA DEL CATÁLOGO SALEN LOS DATOS BANCARIOS DE UNA CUENTA DE COBRO
 *
 * La cuenta de cobro imprime documento, dirección, banco, tipo de cuenta y
 * NÚMERO DE CUENTA del aliado. Elegir la ficha equivocada no es un detalle
 * cosmético: es un documento de pago con los datos bancarios de otra persona.
 *
 * Antes se resolvía así:
 *
 *     .ilike("nombre", aliado).limit(1).maybeSingle()
 *
 * Tres problemas, y los tres podían entregar la ficha de un tercero:
 *
 *   1. **`ilike` interpreta comodines.** `%` y `_` son operadores de patrón en
 *      SQL, no texto. Un aliado que se llame «AGENCIA 100% VIAJES» busca en
 *      realidad «AGENCIA 100» + cualquier cosa + « VIAJES»; y un nombre con `_`
 *      —frecuente al pegar de una hoja— hace de comodín de un carácter.
 *   2. **`limit(1)` sin `order by` es arbitrario.** Con dos homónimos, Postgres
 *      devuelve el que le resulte más cómodo, y puede cambiar entre ejecuciones.
 *   3. **No se usaba el `aliado_id` que ya estaba disponible** en el flujo
 *      tarifario (`ventas.aliado_id`), solo en el de comisión manual.
 *
 * El primer arreglo cambió `ilike` por `.eq("nombre", aliadoNombre)` y solo
 * escaneaba el catálogo completo si esa consulta literal volvía vacía. **Eso
 * seguía mal**: un `.eq()` puede devolver EXACTAMENTE una fila y aun así existir
 * otra ficha que solo difiera en mayúsculas o espacios («Ana Gómez» /
 * « ANA GÓMEZ »). Esa segunda candidata quedaba oculta —la consulta nunca
 * llegaba a escanear el catálogo completo, porque «ya encontró una»— y se
 * imprimía la cuenta bancaria de una de las dos sin que nada avisara que había
 * otra.
 *
 * La regla ahora, en dos fases, SIN atajos:
 *
 *   1. Si hay `aliado_id`, ese id manda — punto, nunca se mira el nombre.
 *   2. Si no hay id: se listan SIEMPRE **id + nombre** (nunca los datos
 *      bancarios) de TODO el catálogo, se cuentan las coincidencias
 *      normalizadas (minúsculas + sin espacios sobrantes), y **solo si hay
 *      EXACTAMENTE una** se pide su ficha completa por ese id. Con cero o con
 *      varias, `aliadoInfo` es `null` — nunca se cargan los datos bancarios de
 *      un candidato ambiguo.
 *
 * `resolverFichaAliado` es la orquestación (async, con las dependencias por
 * parámetro — mismo patrón que `lib/adjuntos/operaciones.ts`), así que el flujo
 * COMPLETO de las dos fases se puede probar sin tocar la base de datos.
 */

export type FichaAliado = {
  id?: number;
  nombre: string;
  tipo_documento: string | null;
  nit: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  banco: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
};

/** Solo lo mínimo para contar coincidencias, sin exponer datos bancarios. */
export type CandidatoAliado = { id: number; nombre: string };

export type MotivoFicha =
  | "por_id"
  | "por_id_inexistente"
  | "legacy_unica"
  | "legacy_sin_coincidencia"
  | "legacy_ambigua"
  /** La única candidata normalizada desapareció entre las dos consultas (borrada a mitad de camino). Rarísimo, pero posible. */
  | "legacy_desaparecio"
  | "sin_nombre";

export type ResultadoFicha = {
  ficha: FichaAliado | null;
  motivo: MotivoFicha;
  /** Solo con `legacy_ambigua`: los ids que empataron, para poder desambiguar. */
  candidatas?: number[];
};

const normalizar = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * De cuál columna sale el `aliado_id` de un contrato, según por cuál de los
 * dos flujos entró la comisión. Extraída como función pura para poder probar
 * los dos caminos sin tocar la base de datos.
 *
 * - **Flujo tarifario B2B** (`esVentasB2B`, exclusivo de mayorista): el id
 *   sale de `ventas.aliado_id`.
 * - **Comisión manual** (`aliados_b2b`, único camino en minorista, también
 *   usado en mayorista para comisiones agregadas a mano): el id sale de
 *   `aliados_b2b.aliado_id` (migración 133); si esa fila no lo tiene puesto
 *   —comisión cargada antes de que existiera el enlace— se cae a
 *   `ventas.aliado_id` como respaldo, no al revés.
 */
export function resolverAliadoIdContrato(args: {
  esVentasB2B: boolean;
  aliadoIdVentas: number | null;
  aliadoIdComisionManual: number | null;
}): number | null {
  if (args.esVentasB2B) return args.aliadoIdVentas;
  return args.aliadoIdComisionManual ?? args.aliadoIdVentas;
}

export type DepsResolverFicha = {
  /**
   * SOLO id + nombre, de TODO el catálogo. Nunca trae banco/cuenta/documento:
   * en esta fase todavía no se sabe si hay ambigüedad, así que no hay ninguna
   * ficha bancaria que valga la pena cargar todavía.
   *
   * ⚠️ Quien implemente esto tiene que traer TODO el catálogo, paginando si
   * hace falta — ver `listarTodosLosCandidatos` más abajo. Un `select()` sin
   * `.range()` puede volver silenciosamente truncado por el límite de filas
   * del proyecto (Settings → API → Max rows), y un catálogo truncado no es lo
   * mismo que "no hay más candidatos": puede esconder justo la ambigüedad que
   * esta función existe para detectar.
   */
  listarIdsYNombres(): Promise<CandidatoAliado[]>;
  /** La ficha completa (con los datos bancarios) de un id concreto. */
  buscarFichaPorId(id: number): Promise<FichaAliado | null>;
};

export type PaginaCandidatos = { datos: CandidatoAliado[]; error: { message: string } | null };

export type DepsListarPaginado = {
  /** Lee una página, 0-indexed e INCLUSIVA en los dos extremos — igual que `.range(desde, hasta)` de PostgREST. */
  leerPagina(desde: number, hasta: number): Promise<PaginaCandidatos>;
};

/**
 * Trae TODO el catálogo de candidatos, paginando explícitamente.
 *
 * POR QUÉ EXISTE: PostgREST tiene un límite de filas por respuesta
 * configurable por proyecto (`db-max-rows`, típicamente 1000) que se aplica
 * en SILENCIO — un `select("id, nombre")` sin `.range()` no avisa que cortó
 * el resultado, simplemente devuelve menos filas de las que hay. Para esta
 * función eso es particularmente grave: un catálogo truncado puede esconder
 * justo la segunda ficha que hace ambigua una coincidencia, y el flujo
 * seguiría de largo creyendo que hay una sola.
 *
 * FALLA CERRADO: si una página intermedia devuelve error, se LANZA — nunca se
 * trata como "no hay más candidatos" ni se devuelve lo acumulado hasta ahí
 * como si fuera el catálogo completo. Un catálogo parcial que se declara
 * completo es peor que ningún catálogo: puede convertir una ambigüedad real
 * en un falso "sin coincidencia" o, peor, en un falso "única".
 *
 * Se detiene en la primera página INCOMPLETA (menos de `tamanoPagina` filas):
 * esa es la señal —la misma que usa PostgREST— de que ya no hay más.
 *
 * Deduplica por id, defensivamente: si el catálogo cambia entre una página y
 * la siguiente (alguien inserta o borra mientras se pagina), un id repetido
 * en dos páginas no debe contarse dos veces.
 */
export async function listarTodosLosCandidatos(
  deps: DepsListarPaginado,
  tamanoPagina = 1000
): Promise<CandidatoAliado[]> {
  const vistos = new Map<number, CandidatoAliado>();
  let desde = 0;
  for (;;) {
    const hasta = desde + tamanoPagina - 1;
    const { datos, error } = await deps.leerPagina(desde, hasta);
    if (error) {
      throw new Error(
        `No se pudo leer el catálogo de aliados (página ${desde}-${hasta}): ${error.message}`
      );
    }
    for (const c of datos) vistos.set(c.id, c);
    if (datos.length < tamanoPagina) break; // página incompleta: no hay más
    desde += tamanoPagina;
  }
  return [...vistos.values()];
}

/**
 * Resuelve la ficha del aliado en las dos fases descritas arriba. Las
 * dependencias entran por parámetro para poder probar el flujo COMPLETO —las
 * dos consultas, en orden, con los datos que cada una vería— sin base de
 * datos real.
 */
export async function resolverFichaAliado(
  deps: DepsResolverFicha,
  args: { aliadoIdContrato: number | null; nombre: string | null }
): Promise<ResultadoFicha> {
  // ── Con id: manda el id, siempre. Nunca se mira el nombre. ───────────────
  if (args.aliadoIdContrato != null) {
    const ficha = await deps.buscarFichaPorId(args.aliadoIdContrato);
    return ficha
      ? { ficha, motivo: "por_id" }
      : { ficha: null, motivo: "por_id_inexistente" };
  }

  const objetivo = normalizar(args.nombre);
  if (objetivo === "") return { ficha: null, motivo: "sin_nombre" };

  // ── Fase 1: contar, sin cargar datos bancarios ───────────────────────────
  // SIEMPRE se escanea el catálogo completo (id + nombre) y se filtra en
  // memoria con la normalización de la regla. Nada de `.eq()`/`.ilike()`
  // puntual que pueda "encontrar una" sin comprobar si hay otra que solo
  // difiera en mayúsculas o espacios — que es exactamente el bug que esto
  // reemplaza.
  const candidatos = await deps.listarIdsYNombres();
  const exactas = candidatos.filter((c) => normalizar(c.nombre) === objetivo);

  if (exactas.length === 0) return { ficha: null, motivo: "legacy_sin_coincidencia" };
  if (exactas.length > 1) {
    return { ficha: null, motivo: "legacy_ambigua", candidatas: exactas.map((c) => c.id) };
  }

  // ── Fase 2: exactamente una candidata → AHORA sí se piden sus datos
  // bancarios, y solo los suyos. ────────────────────────────────────────────
  const ficha = await deps.buscarFichaPorId(exactas[0].id);
  return ficha
    ? { ficha, motivo: "legacy_unica" }
    : { ficha: null, motivo: "legacy_desaparecio" };
}

/** Frase para el log del servidor. No se muestra al cliente. */
export function explicarFicha(r: ResultadoFicha, nombre: string | null): string | null {
  switch (r.motivo) {
    case "por_id_inexistente":
      return "La comisión apunta a un aliado_id que no existe en el catálogo; la cuenta de cobro sale sin datos bancarios.";
    case "legacy_ambigua":
      return `Hay ${r.candidatas?.length ?? "varias"} fichas en el catálogo con el nombre "${nombre}" (ids: ${(r.candidatas ?? []).join(", ")}). No se puede saber cuál es: la cuenta de cobro sale sin datos bancarios. Enlaza la comisión con aliado_id.`;
    case "legacy_sin_coincidencia":
      return `No hay ninguna ficha en el catálogo con el nombre "${nombre}"; la cuenta de cobro sale sin datos bancarios.`;
    case "legacy_desaparecio":
      return `La única ficha que coincidía con el nombre "${nombre}" desapareció entre las dos consultas; la cuenta de cobro sale sin datos bancarios.`;
    default:
      return null;
  }
}
