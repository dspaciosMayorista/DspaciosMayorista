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

export const VERSION_MOTOR_ALOJAMIENTO = "unidad-alojamiento@2";

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
export type CategoriaMenor = "nino" | "infante";

export type ReglaEdadMenor = {
  categoria: CategoriaMenor;
  edadMinAnios: number;
  edadMaxAnios: number;
};

export type ReglaMenores = { reglas: ReglaEdadMenor[] };

export type MenorClasificado = { edadAnios: number; categoria: CategoriaMenor };

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

// ── Tarifa (el insumo, no una fila de BD todavía) ───────────────────────
// `valores.adulto` significa cosas distintas según la unidad:
//   persona    → valor por 1 adulto/noche.
//   pareja     → valor de LA PAREJA completa/noche (no por persona).
//   habitacion → valor de LA HABITACIÓN completa/noche (no por persona).
//   apartamento→ valor del APARTAMENTO completo/noche (no por persona).
// `nino`/`infante` solo se usan (y solo tienen sentido) cuando
// unidadCobro === "persona".
export type ValoresPorCategoria = {
  adulto: number;
  nino?: number;
  infante?: number;
};

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
  versionTarifario?: string | null;
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

// ── Resultado válido ─────────────────────────────────────────────────────
export type ResultadoValido = {
  ok: true;
  unidadCobro: UnidadCobro;
  cantidadUnidades: number;
  noches: number;
  desglose: DesgloseLinea[];
  totalNetoPorNoche: number;
  totalNeto: number; // totalNetoPorNoche × noches
  menoresClasificados: MenorClasificado[];
  suplementosAplicados: SuplementoAplicado[];
  capacidadUtilizada: CapacidadUtilizadaUnidad[];
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

function agruparPorCategoria(menores: MenorClasificado[]): { categoria: CategoriaMenor; cantidad: number }[] {
  const mapa = new Map<CategoriaMenor, number>();
  for (const m of menores) mapa.set(m.categoria, (mapa.get(m.categoria) ?? 0) + 1);
  return [...mapa.entries()].map(([categoria, cantidad]) => ({ categoria, cantidad }));
}

function claveSuplemento(s: SuplementoConfigurado): string {
  return s.tipo === "menor_adicional" ? `menor_adicional:${s.categoriaMenor}` : s.tipo;
}

function etiquetaSuplemento(s: SuplementoConfigurado): string {
  if (s.tipo === "adulto_adicional") return "Adulto adicional";
  if (s.tipo === "persona_sola") return "Persona sola";
  return s.categoriaMenor === "nino" ? "Niño adicional" : "Infante adicional";
}

function esEnteroValido(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n); // rechaza NaN, Infinity y decimales por construcción
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
    clasificados.push({ edadAnios: menor.edadAnios, categoria: coincidencias[0].categoria });
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
  if (!esEnteroValido(entrada.noches)) {
    return resultadoBloqueado("configuracion_invalida", "`noches` debe ser un entero.", { noches: entrada.noches });
  }
  if (entrada.noches < 0) {
    return resultadoBloqueado("configuracion_invalida", "`noches` no puede ser negativo.", { noches: entrada.noches });
  }

  for (const [campo, valor] of Object.entries(tarifa.valores)) {
    if (valor === undefined) continue;
    if (!esEnteroValido(valor) || valor < 0) {
      return resultadoBloqueado("configuracion_invalida", `El valor de "${campo}" debe ser un entero >= 0.`, { campo, valor });
    }
  }

  const { minPax, maxPax, paxIncluidos } = tarifa.capacidad;
  if (!esEnteroValido(minPax) || minPax < 1) {
    return resultadoBloqueado("configuracion_invalida", "`capacidad.minPax` debe ser un entero >= 1.", { minPax });
  }
  if (maxPax !== null && (!esEnteroValido(maxPax) || maxPax < minPax)) {
    return resultadoBloqueado("configuracion_invalida", "`capacidad.maxPax` debe ser null o un entero >= minPax.", {
      minPax,
      maxPax,
    });
  }
  if (!esEnteroValido(paxIncluidos) || paxIncluidos < 0 || (maxPax !== null && paxIncluidos > maxPax)) {
    return resultadoBloqueado(
      "configuracion_invalida",
      "`capacidad.paxIncluidos` debe ser un entero dentro de la capacidad (>= 0 y <= maxPax si existe).",
      { paxIncluidos, minPax, maxPax }
    );
  }

  for (const r of tarifa.reglaMenores.reglas) {
    if (
      !esEnteroValido(r.edadMinAnios) ||
      !esEnteroValido(r.edadMaxAnios) ||
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
    if (!esEnteroValido(s.valor) || s.valor < 0) {
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
    if (!esEnteroValido(u.adultos) || u.adultos < 0) {
      return resultadoBloqueado("configuracion_invalida", `La unidad ${i + 1}: "adultos" debe ser un entero >= 0.`, {
        indice: i,
        adultos: u.adultos,
      });
    }
    for (const m of u.menores) {
      if (!esEnteroValido(m.edadAnios) || m.edadAnios < 0) {
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
  if (tarifa.unidadCobro === "pareja") {
    const diff = unidad.adultos - 2;
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
      // déficit posible aquí es adultos === 1 (diff === -1): persona sola.
      const cfg = mapaSuplementos.get("persona_sola");
      if (!cfg) {
        return resultadoBloqueado("tarifa_no_encontrada", `Unidad ${indice + 1}: no hay tarifa de persona sola configurada.`, {
          indice,
        });
      }
      reemplazaBase = { ...cfg, cantidad: 1, valorTotal: cfg.valor };
    }

    for (const grupo of agruparPorCategoria(menoresClasificados)) {
      const cfg = mapaSuplementos.get(`menor_adicional:${grupo.categoria}`);
      if (!cfg) {
        return resultadoBloqueado(
          "tarifa_no_encontrada",
          `Unidad ${indice + 1}: no hay suplemento configurado para menor adicional (${grupo.categoria}).`,
          { indice, categoria: grupo.categoria, cantidad: grupo.cantidad }
        );
      }
      suplementos.push({ ...cfg, cantidad: grupo.cantidad, valorTotal: cfg.valor * grupo.cantidad });
    }

    return { suplementos, reemplazaBase };
  }

  // habitacion | apartamento: el pax por fuera de `paxIncluidos` DE ESTA
  // UNIDAD se factura en orden fijo (adultos primero, luego menores) contra
  // un suplemento configurado exacto.
  const incluidos = tarifa.capacidad.paxIncluidos;
  const paxOrdenado: Array<{ tipo: "adulto" } | { tipo: "menor"; categoria: CategoriaMenor }> = [
    ...Array.from({ length: unidad.adultos }, () => ({ tipo: "adulto" as const })),
    ...menoresClasificados.map((m) => ({ tipo: "menor" as const, categoria: m.categoria })),
  ];
  const extra = paxOrdenado.slice(incluidos);
  if (extra.length === 0) return { suplementos: [], reemplazaBase: null };

  const suplementos: SuplementoAplicado[] = [];
  const adultosExtra = extra.filter((p) => p.tipo === "adulto").length;
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
  const menoresExtra = agruparPorCategoria(
    extra
      .filter((p): p is { tipo: "menor"; categoria: CategoriaMenor } => p.tipo === "menor")
      .map((p) => ({ edadAnios: -1, categoria: p.categoria }))
  );
  for (const grupo of menoresExtra) {
    const cfg = mapaSuplementos.get(`menor_adicional:${grupo.categoria}`);
    if (!cfg) {
      return resultadoBloqueado(
        "tarifa_no_encontrada",
        `Unidad ${indice + 1}: no hay suplemento configurado para menor adicional (${grupo.categoria}) sobre la capacidad incluida.`,
        { indice, categoria: grupo.categoria, cantidad: grupo.cantidad }
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
  if (resultado.reemplazaBase) {
    lineas.push({
      concepto: etiquetaSuplemento(resultado.reemplazaBase),
      tipo: "base",
      cantidad: 1,
      valorUnitario: resultado.reemplazaBase.valor,
      valorTotal: resultado.reemplazaBase.valorTotal,
      unidadIndex: indice,
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
    },
  ];
  for (const grupo of agruparPorCategoria(menoresClasificados)) {
    const valorUnitario = tarifa.valores[grupo.categoria] as number; // ya validado antes de llegar aquí
    lineas.push({
      concepto: grupo.categoria === "nino" ? "Niños" : "Infantes",
      tipo: "menor",
      cantidad: grupo.cantidad,
      valorUnitario,
      valorTotal: grupo.cantidad * valorUnitario,
      unidadIndex: null,
    });
  }
  return lineas;
}

// ── Orquestador ──────────────────────────────────────────────────────────
// Compone las funciones puras de arriba. No consulta Supabase: recibe la
// tarifa YA seleccionada (la selección entre varias tarifas candidatas por
// prioridad/vigencia es del motor de selección, un PR posterior).
export function cotizarUnidadAlojamiento(entrada: EntradaCotizacion): ResultadoCotizacionUnidad {
  const { tarifa, distribucion, noches } = entrada;

  const validacion = validarEntrada(tarifa, entrada);
  if (esBloqueado(validacion)) return validacion;
  const { mapaSuplementos } = validacion;

  if (noches === 0) {
    return resultadoBloqueado(
      "producto_no_soportado",
      "Este motor cubre alojamiento por noches (>= 1); day use (0 noches) no está soportado en este alcance.",
      { noches }
    );
  }

  if (tarifa.unidadCobro === "persona") {
    return calcularPersona(tarifa, distribucion, noches);
  }
  return calcularNoPersona(tarifa, distribucion, noches, mapaSuplementos);
}

function calcularPersona(tarifa: TarifaAlojamiento, distribucion: DistribucionUnidades, noches: number): ResultadoCotizacionUnidad {
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

  for (const grupo of agruparPorCategoria(menoresClasificados)) {
    if (tarifa.valores[grupo.categoria] === undefined) {
      return resultadoBloqueado("tarifa_no_encontrada", `No hay tarifa configurada para la categoría "${grupo.categoria}".`, {
        categoria: grupo.categoria,
      });
    }
  }

  const desglose = construirDesglosePersona(tarifa, totalAdultos, menoresClasificados);
  const totalNetoPorNoche = desglose.reduce((acc, l) => acc + l.valorTotal, 0);

  return {
    ok: true,
    unidadCobro: "persona",
    cantidadUnidades: totalAdultos,
    noches,
    desglose,
    totalNetoPorNoche,
    totalNeto: totalNetoPorNoche * noches,
    menoresClasificados,
    suplementosAplicados: [],
    capacidadUtilizada,
  };
}

function calcularNoPersona(
  tarifa: TarifaAlojamiento,
  distribucion: DistribucionUnidades,
  noches: number,
  mapaSuplementos: Map<string, SuplementoConfigurado>
): ResultadoCotizacionUnidad {
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

  const totalNetoPorNoche = desglose.reduce((acc, l) => acc + l.valorTotal, 0);

  return {
    ok: true,
    unidadCobro: tarifa.unidadCobro,
    cantidadUnidades: distribucion.unidades.length,
    noches,
    desglose,
    totalNetoPorNoche,
    totalNeto: totalNetoPorNoche * noches,
    menoresClasificados,
    suplementosAplicados,
    capacidadUtilizada,
  };
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
  totalNeto: number;
  ajusteComercial: null;
  fuente: { documento: string; pagina: number | null } | null;
  versionTarifario: string | null;
};

export function construirSnapshotAlojamiento(
  resultado: ResultadoValido,
  tarifa: TarifaAlojamiento,
  distribucion: DistribucionUnidades
): SnapshotAlojamiento {
  return clonarProfundo({
    versionMotor: VERSION_MOTOR_ALOJAMIENTO,
    unidadCobro: resultado.unidadCobro,
    tarifaId: tarifa.id,
    valores: tarifa.valores,
    distribucion,
    capacidadUtilizada: resultado.capacidadUtilizada,
    cantidadUnidades: resultado.cantidadUnidades,
    menoresClasificados: resultado.menoresClasificados,
    reglaMenoresAplicada: tarifa.reglaMenores,
    suplementosAplicados: resultado.suplementosAplicados,
    desglose: resultado.desglose,
    noches: resultado.noches,
    temporada: tarifa.temporada ?? null,
    categoria: tarifa.categoria ?? null,
    alimentacion: tarifa.alimentacion ?? null,
    totalNetoPorNoche: resultado.totalNetoPorNoche,
    totalNeto: resultado.totalNeto,
    ajusteComercial: null,
    fuente: tarifa.fuente ?? null,
    versionTarifario: tarifa.versionTarifario ?? null,
  });
}
