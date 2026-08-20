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
//     toda dependencia de datos (tarifa, ocupación, reglas) llega por
//     argumento.
//   - CERO integración con `tarifa_hotel`, `computo.ts`, reservar,
//     cotizaciones o contratos. Este motor no se llama todavía desde
//     ningún flujo real.
//   - CERO day use, paquetes de precio fijo, promociones o comisión
//     confirmada. El código `requiere_cotizacion_manual` existe como forma
//     (para que un PR futuro lo use al integrar `hotel_temporadas.solo_paquete`)
//     pero este motor nunca lo devuelve por sí solo — no hay lógica de
//     paquetes que decidir aquí.
//   - La comisión en el snapshot es SIEMPRE opcional y nunca trae un
//     porcentaje por defecto — es una decisión comercial pendiente
//     (ver CLAUDE.md / artefacto Bernalo), no un dato de este motor.
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

export const VERSION_MOTOR_ALOJAMIENTO = "unidad-alojamiento@1";

// ── Unidad de cobro ─────────────────────────────────────────────────────
// Vive en la TARIFA (o plan tarifario), nunca en el hotel: un mismo hotel
// puede tener varias modalidades vigentes a la vez (ver artefacto, §7).
export type UnidadCobro = "persona" | "pareja" | "habitacion" | "apartamento";

// ── Ocupación y edades ──────────────────────────────────────────────────
export type Menor = { edadAnios: number };

export type OcupacionSolicitada = {
  adultos: number;
  menores: Menor[];
};

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
// `maxPax: null` = sin límite (persona no la usa realmente). `paxIncluidos`
// es cuántos pax cubre `valores.adulto` sin recargo — solo aplica a
// habitación/apartamento (para pareja, ver `capacidad` de cada tarifa: el
// caso base son 2 adultos, cualquier desvío pasa por suplementos).
export type CapacidadUnidad = {
  minPax: number;
  maxPax: number | null;
  paxIncluidos: number;
};

// ── Distribución (cuántas unidades del MISMO tipo/tarifa) ──────────────
// Para habitación/apartamento/pareja: cuántas habitaciones/apartamentos/
// parejas de ESTA tarifa se están cobrando. Repartir pax entre habitaciones
// de tipos DISTINTOS es responsabilidad del llamador (igual que hoy
// `ReservaForm` suma habitaciones por tipo) — este PR no lo modela.
export type DistribucionUnidades = { cantidadUnidades: number };

// ── Suplementos ──────────────────────────────────────────────────────────
export type TipoSuplemento = "adulto_adicional" | "menor_adicional" | "persona_sola";

export type SuplementoConfigurado = {
  tipo: TipoSuplemento;
  categoriaMenor?: CategoriaMenor; // solo si tipo === "menor_adicional"
  valor: number; // monto por unidad de suplemento, por noche
};

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
export type DesgloseLinea = {
  concepto: string;
  tipo: "base" | "menor" | "suplemento";
  cantidad: number;
  valorUnitario: number;
  valorTotal: number;
};

// ── Resultado bloqueado (fail-closed, con código explícito) ────────────
export type CodigoBloqueo =
  | "tarifa_no_encontrada" // capacidad OK, pero no hay precio configurado para lo pedido (categoría de menor o suplemento sin valor)
  | "ocupacion_no_permitida" // viola capacidad mínima/máxima, o la ocupación es estructuralmente inválida
  | "edad_fuera_de_regla" // la edad de un menor no está cubierta por ninguna regla configurada
  | "combinacion_ambigua" // la edad de un menor cae en más de una regla a la vez
  | "requiere_cotizacion_manual" // reservado para integraciones futuras (ej. hotel_temporadas.solo_paquete) — este motor no lo dispara todavía
  | "producto_no_soportado"; // el producto pedido no lo cubre este motor (ej. day use = 0 noches)

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
};

export type ResultadoCotizacionUnidad = ResultadoValido | ResultadoBloqueado;

export type EntradaCotizacion = {
  tarifa: TarifaAlojamiento;
  ocupacion: OcupacionSolicitada;
  distribucion?: DistribucionUnidades; // default {cantidadUnidades:1}
  noches: number;
};

function esBloqueado(x: unknown): x is ResultadoBloqueado {
  return typeof x === "object" && x !== null && (x as { ok?: unknown }).ok === false;
}

// ── 1. Aplicación de reglas de menores ──────────────────────────────────
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

// ── 2. Validación de ocupación ──────────────────────────────────────────
// Solo valida estructura y capacidad. NO decide precio ni suplementos —
// eso es de `aplicarSuplementos`.
export function validarOcupacion(
  tarifa: TarifaAlojamiento,
  ocupacion: OcupacionSolicitada,
  distribucion: DistribucionUnidades
): ResultadoBloqueado | null {
  if (ocupacion.adultos < 0 || ocupacion.menores.some((m) => m.edadAnios < 0)) {
    return resultadoBloqueado("ocupacion_no_permitida", "La ocupación no puede tener valores negativos.");
  }
  if (!Number.isInteger(distribucion.cantidadUnidades) || distribucion.cantidadUnidades < 1) {
    return resultadoBloqueado(
      "ocupacion_no_permitida",
      "La cantidad de unidades (habitaciones/apartamentos/parejas) debe ser un entero mayor o igual a 1.",
      { cantidadUnidades: distribucion.cantidadUnidades }
    );
  }

  switch (tarifa.unidadCobro) {
    case "persona":
      if (ocupacion.adultos < 1) {
        return resultadoBloqueado("ocupacion_no_permitida", "Se requiere al menos un adulto.");
      }
      return null;
    case "pareja":
      if (ocupacion.adultos < 1) {
        return resultadoBloqueado("ocupacion_no_permitida", "Se requiere al menos un adulto para la tarifa por pareja.");
      }
      return null;
    case "habitacion":
    case "apartamento": {
      const totalPax = ocupacion.adultos + ocupacion.menores.length;
      const { minPax, maxPax } = tarifa.capacidad;
      const cantidad = distribucion.cantidadUnidades;
      if (maxPax !== null && totalPax > maxPax * cantidad) {
        return resultadoBloqueado(
          "ocupacion_no_permitida",
          `La ocupación (${totalPax} pax) excede la capacidad máxima (${maxPax} × ${cantidad}).`,
          { totalPax, maxPax, cantidadUnidades: cantidad }
        );
      }
      if (totalPax < minPax * cantidad) {
        return resultadoBloqueado(
          "ocupacion_no_permitida",
          `La ocupación (${totalPax} pax) no alcanza la ocupación mínima (${minPax} × ${cantidad}).`,
          { totalPax, minPax, cantidadUnidades: cantidad }
        );
      }
      return null;
    }
  }
}

// ── 3. Determinación de cantidad de unidades cobradas ───────────────────
// persona: 1 unidad = 1 adulto (los menores se cobran aparte, por
// categoría, nunca como "unidades"). pareja/habitación/apartamento: 1
// unidad = 1 pareja/habitación/apartamento de ESTA tarifa — viene de la
// distribución explícita, nunca se deriva multiplicando por pax.
export function determinarCantidadUnidades(
  tarifa: TarifaAlojamiento,
  ocupacion: OcupacionSolicitada,
  distribucion: DistribucionUnidades
): number {
  if (tarifa.unidadCobro === "persona") return ocupacion.adultos;
  return distribucion.cantidadUnidades;
}

// ── 4. Aplicación de suplementos ────────────────────────────────────────
// Nunca deriva un precio por persona a partir de la tarifa base y lo vuelve
// a multiplicar: cada pax/adulto por fuera de lo ya cubierto por la tarifa
// exige un `SuplementoConfigurado` EXACTO, o falla cerrado.
export type SuplementosResultado = {
  suplementos: SuplementoAplicado[];
  // Solo para pareja + "persona sola": ese caso no es un cargo ADICIONAL
  // sobre la tarifa de pareja completa (eso duplicaría el cobro) — es una
  // tarifa que REEMPLAZA la línea base. `null` en cualquier otro caso.
  reemplazaBase: SuplementoAplicado | null;
};

export function aplicarSuplementos(
  tarifa: TarifaAlojamiento,
  ocupacion: OcupacionSolicitada,
  cantidadUnidades: number,
  menoresClasificados: MenorClasificado[]
): SuplementosResultado | ResultadoBloqueado {
  if (tarifa.unidadCobro === "persona") {
    // Cada categoría de pax ya tiene su propio valor en `valores` — no hay
    // "suplemento" que aplicar aquí (ver `construirDesglose`).
    return { suplementos: [], reemplazaBase: null };
  }

  if (tarifa.unidadCobro === "pareja") {
    const adultosEsperados = cantidadUnidades * 2;
    const diff = ocupacion.adultos - adultosEsperados;
    const suplementos: SuplementoAplicado[] = [];
    let reemplazaBase: SuplementoAplicado | null = null;

    if (diff > 0) {
      const cfg = tarifa.suplementos.find((s) => s.tipo === "adulto_adicional");
      if (!cfg) {
        return resultadoBloqueado(
          "tarifa_no_encontrada",
          `No hay suplemento configurado para adultos adicionales (${diff}) sobre la tarifa por pareja.`,
          { adultosAdicionales: diff }
        );
      }
      suplementos.push({ ...cfg, cantidad: diff, valorTotal: cfg.valor * diff });
    } else if (diff < 0) {
      // Solo se admite el caso "falta exactamente 1 adulto para completar
      // 1 pareja" (persona sola). Cualquier otro déficit es una ocupación
      // que la tarifa por pareja no puede representar.
      if (diff !== -1 || cantidadUnidades !== 1) {
        return resultadoBloqueado(
          "ocupacion_no_permitida",
          `La ocupación (${ocupacion.adultos} adultos) no corresponde a ${cantidadUnidades} pareja(s).`,
          { adultos: ocupacion.adultos, cantidadUnidades }
        );
      }
      const cfg = tarifa.suplementos.find((s) => s.tipo === "persona_sola");
      if (!cfg) {
        return resultadoBloqueado("tarifa_no_encontrada", "No hay suplemento configurado para persona sola.");
      }
      // Reemplaza la línea base de pareja — NUNCA se suma sobre ella.
      reemplazaBase = { ...cfg, cantidad: 1, valorTotal: cfg.valor };
    }

    for (const grupo of agruparPorCategoria(menoresClasificados)) {
      const cfg = tarifa.suplementos.find((s) => s.tipo === "menor_adicional" && s.categoriaMenor === grupo.categoria);
      if (!cfg) {
        return resultadoBloqueado(
          "tarifa_no_encontrada",
          `No hay suplemento configurado para menor adicional (${grupo.categoria}).`,
          { categoria: grupo.categoria, cantidad: grupo.cantidad }
        );
      }
      suplementos.push({ ...cfg, cantidad: grupo.cantidad, valorTotal: cfg.valor * grupo.cantidad });
    }

    return { suplementos, reemplazaBase };
  }

  // habitacion | apartamento: el pax por fuera de `paxIncluidos × cantidadUnidades`
  // se factura en orden fijo (adultos primero, luego menores) contra un
  // suplemento configurado exacto.
  const incluidos = tarifa.capacidad.paxIncluidos * cantidadUnidades;
  const paxOrdenado: Array<{ tipo: "adulto" } | { tipo: "menor"; categoria: CategoriaMenor }> = [
    ...Array.from({ length: ocupacion.adultos }, () => ({ tipo: "adulto" as const })),
    ...menoresClasificados.map((m) => ({ tipo: "menor" as const, categoria: m.categoria })),
  ];
  const extra = paxOrdenado.slice(incluidos);
  if (extra.length === 0) return { suplementos: [], reemplazaBase: null };

  const adultosExtra = extra.filter((p) => p.tipo === "adulto").length;
  const menoresExtra = agruparPorCategoria(
    extra.filter((p): p is { tipo: "menor"; categoria: CategoriaMenor } => p.tipo === "menor")
      .map((p) => ({ edadAnios: -1, categoria: p.categoria }))
  );

  const suplementos: SuplementoAplicado[] = [];
  if (adultosExtra > 0) {
    const cfg = tarifa.suplementos.find((s) => s.tipo === "adulto_adicional");
    if (!cfg) {
      return resultadoBloqueado(
        "tarifa_no_encontrada",
        `No hay suplemento configurado para adultos adicionales (${adultosExtra}) sobre la capacidad incluida.`,
        { adultosAdicionales: adultosExtra }
      );
    }
    suplementos.push({ ...cfg, cantidad: adultosExtra, valorTotal: cfg.valor * adultosExtra });
  }
  for (const grupo of menoresExtra) {
    const cfg = tarifa.suplementos.find((s) => s.tipo === "menor_adicional" && s.categoriaMenor === grupo.categoria);
    if (!cfg) {
      return resultadoBloqueado(
        "tarifa_no_encontrada",
        `No hay suplemento configurado para menor adicional (${grupo.categoria}) sobre la capacidad incluida.`,
        { categoria: grupo.categoria, cantidad: grupo.cantidad }
      );
    }
    suplementos.push({ ...cfg, cantidad: grupo.cantidad, valorTotal: cfg.valor * grupo.cantidad });
  }
  return { suplementos, reemplazaBase: null };
}

function agruparPorCategoria(menores: MenorClasificado[]): { categoria: CategoriaMenor; cantidad: number }[] {
  const mapa = new Map<CategoriaMenor, number>();
  for (const m of menores) mapa.set(m.categoria, (mapa.get(m.categoria) ?? 0) + 1);
  return [...mapa.entries()].map(([categoria, cantidad]) => ({ categoria, cantidad }));
}

// ── 5. Construcción del desglose ────────────────────────────────────────
export function construirDesglose(
  tarifa: TarifaAlojamiento,
  cantidadUnidades: number,
  ocupacion: OcupacionSolicitada,
  menoresClasificados: MenorClasificado[],
  suplementosAplicados: SuplementoAplicado[],
  reemplazaBase: SuplementoAplicado | null = null
): DesgloseLinea[] {
  const lineas: DesgloseLinea[] = [];

  if (tarifa.unidadCobro === "persona") {
    lineas.push({
      concepto: "Adultos",
      tipo: "base",
      cantidad: ocupacion.adultos,
      valorUnitario: tarifa.valores.adulto,
      valorTotal: ocupacion.adultos * tarifa.valores.adulto,
    });
    for (const grupo of agruparPorCategoria(menoresClasificados)) {
      const valorUnitario = tarifa.valores[grupo.categoria] as number; // ya validado antes de llegar aquí
      lineas.push({
        concepto: grupo.categoria === "nino" ? "Niños" : "Infantes",
        tipo: "menor",
        cantidad: grupo.cantidad,
        valorUnitario,
        valorTotal: grupo.cantidad * valorUnitario,
      });
    }
    return lineas;
  }

  if (reemplazaBase) {
    // "Persona sola" (u otra tarifa de reemplazo): sustituye la línea base
    // de pareja/habitación/apartamento — nunca se suma sobre ella.
    lineas.push({
      concepto: etiquetaSuplemento(reemplazaBase),
      tipo: "base",
      cantidad: reemplazaBase.cantidad,
      valorUnitario: reemplazaBase.valor,
      valorTotal: reemplazaBase.valorTotal,
    });
  } else {
    const conceptoBase =
      tarifa.unidadCobro === "pareja" ? "Pareja" : tarifa.unidadCobro === "habitacion" ? "Habitación" : "Apartamento";
    lineas.push({
      concepto: conceptoBase,
      tipo: "base",
      cantidad: cantidadUnidades,
      valorUnitario: tarifa.valores.adulto,
      valorTotal: cantidadUnidades * tarifa.valores.adulto,
    });
  }
  for (const s of suplementosAplicados) {
    lineas.push({
      concepto: etiquetaSuplemento(s),
      tipo: "suplemento",
      cantidad: s.cantidad,
      valorUnitario: s.valor,
      valorTotal: s.valorTotal,
    });
  }
  return lineas;
}

function etiquetaSuplemento(s: SuplementoConfigurado): string {
  if (s.tipo === "adulto_adicional") return "Adulto adicional";
  if (s.tipo === "persona_sola") return "Persona sola";
  return s.categoriaMenor === "nino" ? "Niño adicional" : "Infante adicional";
}

// ── Orquestador ──────────────────────────────────────────────────────────
// Compone las funciones puras de arriba. No consulta Supabase: recibe la
// tarifa YA seleccionada (la selección entre varias tarifas candidatas por
// prioridad/vigencia es del motor de selección, un PR posterior).
export function cotizarUnidadAlojamiento(entrada: EntradaCotizacion): ResultadoCotizacionUnidad {
  const { tarifa, ocupacion, noches } = entrada;
  const distribucion = entrada.distribucion ?? { cantidadUnidades: 1 };

  if (!Number.isFinite(noches) || noches <= 0) {
    return resultadoBloqueado(
      "producto_no_soportado",
      "Este motor cubre alojamiento por noches (≥1); day use (0 noches) no está soportado en este alcance.",
      { noches }
    );
  }

  const bloqueoOcupacion = validarOcupacion(tarifa, ocupacion, distribucion);
  if (bloqueoOcupacion) return bloqueoOcupacion;

  const clasificacion = clasificarMenores(ocupacion.menores, tarifa.reglaMenores);
  if (esBloqueado(clasificacion)) return clasificacion;
  const { clasificados } = clasificacion;

  if (tarifa.unidadCobro === "persona") {
    for (const grupo of agruparPorCategoria(clasificados)) {
      if (tarifa.valores[grupo.categoria] === undefined) {
        return resultadoBloqueado(
          "tarifa_no_encontrada",
          `No hay tarifa configurada para la categoría "${grupo.categoria}".`,
          { categoria: grupo.categoria }
        );
      }
    }
  }

  const cantidadUnidades = determinarCantidadUnidades(tarifa, ocupacion, distribucion);

  const suplementosResultado = aplicarSuplementos(tarifa, ocupacion, cantidadUnidades, clasificados);
  if (esBloqueado(suplementosResultado)) return suplementosResultado;
  const { suplementos, reemplazaBase } = suplementosResultado;

  const desglose = construirDesglose(tarifa, cantidadUnidades, ocupacion, clasificados, suplementos, reemplazaBase);
  const totalNetoPorNoche = desglose.reduce((acc, l) => acc + l.valorTotal, 0);

  return {
    ok: true,
    unidadCobro: tarifa.unidadCobro,
    cantidadUnidades,
    noches,
    desglose,
    totalNetoPorNoche,
    totalNeto: totalNetoPorNoche * noches,
    menoresClasificados: clasificados,
    suplementosAplicados: suplementos,
  };
}

// ── Snapshot (todavía sin persistir) ────────────────────────────────────
// Serializable (solo datos planos), sin referencias vivas a Supabase ni a
// funciones. Recalcular tarifas futuras nunca puede alterar un snapshot ya
// construido porque no guarda ningún id que se vuelva a resolver — copia
// los valores usados en el momento del cálculo (mismo principio que ya usa
// `contrato_hoteles`/`contrato_items` en el sistema real, ver CLAUDE.md).
export type SnapshotAlojamiento = {
  versionMotor: string;
  unidadCobro: UnidadCobro;
  tarifaId: string;
  valores: ValoresPorCategoria;
  cantidadUnidades: number;
  ocupacion: OcupacionSolicitada;
  menoresClasificados: MenorClasificado[];
  suplementosAplicados: SuplementoAplicado[];
  noches: number;
  temporada: string | null;
  categoria: string | null;
  alimentacion: string | null;
  totalNeto: number;
  comision: { pct: number; valor: number } | null;
  totalVenta: number;
  fuente: { documento: string; pagina: number | null } | null;
  versionTarifario: string | null;
};

// `comisionPct` nunca tiene default: si no se pasa, el snapshot no incluye
// comisión. La regla 20%/10% del PDF NO está confirmada — ver artefacto —
// así que este motor jamás precarga un porcentaje.
export function construirSnapshotAlojamiento(
  resultado: ResultadoValido,
  tarifa: TarifaAlojamiento,
  ocupacion: OcupacionSolicitada,
  opciones?: { comisionPct?: number | null }
): SnapshotAlojamiento {
  const comisionPct = opciones?.comisionPct ?? null;
  const comision =
    comisionPct !== null ? { pct: comisionPct, valor: Math.round(resultado.totalNeto * (comisionPct / 100)) } : null;

  return {
    versionMotor: VERSION_MOTOR_ALOJAMIENTO,
    unidadCobro: resultado.unidadCobro,
    tarifaId: tarifa.id,
    valores: tarifa.valores,
    cantidadUnidades: resultado.cantidadUnidades,
    ocupacion,
    menoresClasificados: resultado.menoresClasificados,
    suplementosAplicados: resultado.suplementosAplicados,
    noches: resultado.noches,
    temporada: tarifa.temporada ?? null,
    categoria: tarifa.categoria ?? null,
    alimentacion: tarifa.alimentacion ?? null,
    totalNeto: resultado.totalNeto,
    comision,
    totalVenta: resultado.totalNeto + (comision?.valor ?? 0),
    fuente: tarifa.fuente ?? null,
    versionTarifario: tarifa.versionTarifario ?? null,
  };
}
