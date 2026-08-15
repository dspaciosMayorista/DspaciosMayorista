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
 *      —frecuente al pegar de una hoja— hace de comodín de un carácter. Un
 *      nombre puede así emparejar con fichas que no son la suya.
 *   2. **`limit(1)` sin `order by` es arbitrario.** Con dos homónimos, Postgres
 *      devuelve el que le resulte más cómodo, y puede cambiar entre ejecuciones.
 *      El documento saldría con una cuenta bancaria u otra sin nada que lo
 *      indique.
 *   3. **No se usaba el `aliado_id` que ya estaba disponible** en el flujo
 *      tarifario (`ventas.aliado_id`), solo en el de comisión manual.
 *
 * La regla ahora: **si hay id, manda el id**. El nombre solo se usa cuando no
 * hay ninguno —contratos anteriores a la migración 143— y entonces exige
 * coincidencia EXACTA normalizada y que haya UNA SOLA ficha. Con cero o con
 * varias se devuelve `null` y un motivo: mejor una cuenta de cobro sin datos
 * bancarios, que se nota y se corrige, que una con los de otro.
 *
 * Este archivo tiene la parte pura (elegir entre candidatas). La consulta vive
 * en `comisionResolver.ts`.
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

export type MotivoFicha =
  | "por_id"
  | "por_id_inexistente"
  | "legacy_unica"
  | "legacy_sin_coincidencia"
  | "legacy_ambigua"
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

/**
 * Elige la ficha a partir de lo que se haya podido leer.
 *
 * @param porId    la ficha leída por `aliado_id`, si había id (null si el id
 *                 apuntaba a una ficha que ya no existe).
 * @param teniaId  si el contrato traía un `aliado_id`. Se distingue de
 *                 `porId === null` para poder decir "había id pero está roto",
 *                 que es un problema de datos distinto a "no había id".
 * @param nombre   el nombre del aliado, solo para el camino legacy.
 * @param porNombre  TODAS las fichas cuyo nombre normalizado coincide. Quien
 *                 llama debe traerlas todas, no la primera: contarlas es lo que
 *                 detecta la ambigüedad.
 */
export function elegirFichaAliado(
  porId: FichaAliado | null,
  teniaId: boolean,
  nombre: string | null,
  porNombre: FichaAliado[]
): ResultadoFicha {
  if (teniaId) {
    // Con id no se cae al nombre NUNCA. Si el id no resuelve, es un dato roto
    // que hay que arreglar, no una excusa para adivinar por texto.
    return porId
      ? { ficha: porId, motivo: "por_id" }
      : { ficha: null, motivo: "por_id_inexistente" };
  }

  const objetivo = normalizar(nombre);
  if (objetivo === "") return { ficha: null, motivo: "sin_nombre" };

  // Se filtra otra vez aquí, aunque la consulta ya haya filtrado: la
  // normalización de la comparación es parte de la regla, no del transporte.
  const exactas = porNombre.filter((f) => normalizar(f.nombre) === objetivo);

  if (exactas.length === 1) return { ficha: exactas[0], motivo: "legacy_unica" };
  if (exactas.length === 0) return { ficha: null, motivo: "legacy_sin_coincidencia" };
  return {
    ficha: null,
    motivo: "legacy_ambigua",
    candidatas: exactas.map((f) => f.id).filter((x): x is number => typeof x === "number"),
  };
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
    default:
      return null;
  }
}
