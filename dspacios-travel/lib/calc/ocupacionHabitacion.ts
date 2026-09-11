// ─────────────────────────────────────────────────────────────────────────
// Fase 3A Bernalo — contrato canónico de ocupación por habitación/unidad.
//
// Objetivo de este archivo, y SOLO este (ver el informe de Fase 3 entregado
// con la tarea): representar, de forma pura, cada habitación/pareja/
// apartamento de una solicitud de reserva como una unidad independiente —
// con sus propios adultos, menores (edad EXACTA), categoría, alimentación y
// noches — y cotizarla llamando UNA vez a `cotizarUnidadAlojamiento` por
// habitación, sumando los resultados sin recalcular nada que el motor ya
// calculó (comisión, suplementos, clasificación de menores).
//
// Fuera de alcance de este archivo (fases futuras, explícitamente):
//   - Resolver qué fila de `hotel_tarifas_unidad` corresponde a cada
//     habitación (eso es un motor de selección por temporada/categoría/
//     alimentación, con `hotel_temporadas` como calendario autoritativo —
//     no existe todavía).
//   - Cualquier escritura a `contrato_items`/CxP/contratos.
//   - Levantar la guardia de `computo.ts`/`generarTarifario` (Fase 2/3
//     previas) que bloquea hoteles `modelo_tarifario = 'unidad'` en
//     Reservar/tarifario — sigue vigente, sin tocar.
//   - Supabase, Next, UI: CERO importaciones de esos módulos aquí. Solo se
//     importa el motor puro (`lib/calc/unidadAlojamiento.ts`) y el tipo
//     `AsignacionHabitacion` de `lib/reservar/distribucionHabitaciones.ts`
//     (también puro — sin "use client"/"use server", sin Supabase).
//
// ── El hallazgo que define el adaptador ─────────────────────────────────
// `distribuirPorHabitaciones` (Reservar, flujo moderno de `edadesMenores`)
// SÍ da un conteo de menores por habitación INSTANCIA (nino/nino2/infantes,
// 0|1|N), pero clasifica por el sistema VIEJO de 2 tramos (umbral de edad
// del hotel) y DESCARTA la edad exacta al convertirla en conteo. La edad
// exacta de cada menor vive aparte, en un arreglo plano
// (`edadesMenoresUsadas`) sin ningún índice que la vincule a una
// habitación puntual. Si SOLO una habitación de la solicitud declara
// menores, la asociación es trivial (todas las edades son de esa
// habitación). Si DOS O MÁS habitaciones declaran menores a la vez, no hay
// forma de saber —con los datos que existen hoy— qué edad exacta
// corresponde a cuál: inventar un reparto (ej. por orden) sería fabricar un
// dato comercial. Por eso `adaptarOcupacionDesdeReservar` bloquea ese caso
// en vez de adivinar (regla explícita del encargo: "nunca repartir menores
// arbitrariamente").
// ─────────────────────────────────────────────────────────────────────────

import {
  type TarifaAlojamiento,
  type DistribucionUnidades,
  type UnidadOcupada,
  type ResultadoValido,
  type ResultadoBloqueado,
  type SnapshotAlojamiento,
  cotizarUnidadAlojamiento,
  construirSnapshotAlojamiento,
  esBloqueado,
  resultadoBloqueado,
} from "./unidadAlojamiento.ts";
import type { AsignacionHabitacion } from "../reservar/distribucionHabitaciones.ts";

// ── Contrato canónico ────────────────────────────────────────────────────
// Una habitación/unidad, tal como la pide el encargo: identificador
// estable, adultos, menores con edad exacta, categoría/alimentación y
// noches. `HabitacionOcupacion` representa EXACTAMENTE una habitación/
// unidad física — nunca un grupo de varias. Si la entrada trae N unidades
// físicas idénticas (mismo tipo, misma ocupación), el adaptador las expande
// en N entradas independientes ANTES de cotizar (ver
// `adaptarOcupacionDesdeReservar`) — este tipo no tiene ningún campo de
// "cantidad" que pueda multiplicar dinero fuera del motor.
export type MenorOcupacion = { edadAnios: number };

export type HabitacionOcupacion = {
  id: string;
  adultos: number;
  menores: MenorOcupacion[];
  categoria: string | null;
  alimentacion: string | null;
  noches: number;
};

// ── Cotización de una colección de habitaciones ─────────────────────────
export type ItemCotizarHabitacion = {
  habitacion: HabitacionOcupacion;
  tarifa: TarifaAlojamiento;
};

export type ResultadoHabitacionCotizada = {
  habitacionId: string;
  // Resultado y snapshot devueltos TAL CUAL por el motor — ver regla 9 y
  // 11 del encargo ("conservar... utilizando los mecanismos existentes").
  // Nada de este archivo recalcula bruto/comisión/neto/suplementos.
  resultado: ResultadoValido;
  snapshot: SnapshotAlojamiento;
};

export type ResultadoColeccionCotizada = {
  ok: true;
  porHabitacion: ResultadoHabitacionCotizada[];
  // Sumas simples de lo que cada llamada al motor ya devolvió — nunca una
  // fórmula paralela. Ver la prueba "la suma neta coincide exactamente".
  totalBruto: number;
  totalComision: number;
  totalNeto: number;
};

// El bloqueo conserva el código/mensaje/contexto del motor (o uno propio
// de este archivo para el único caso que SÍ le pertenece: colección vacía)
// + qué habitación lo causó, cuando aplica — para que quien reciba el
// bloqueo sepa dónde mirar sin tener que adivinar cuál de la colección fue.
export type ResultadoColeccionBloqueada = ResultadoBloqueado & { habitacionId: string | null };

// Cotiza cada habitación FÍSICA de la colección exactamente UNA vez: una
// llamada a `cotizarUnidadAlojamiento` por elemento de `items`, con una
// `distribucion` de una sola unidad (la de esa habitación). Nunca se
// agrupan varias habitaciones en una sola llamada ni se multiplica un
// resultado por una cantidad — si la entrada trae varias unidades físicas
// idénticas, cada una debe llegar aquí como su propio elemento de `items`
// (ver `adaptarOcupacionDesdeReservar`, que hace esa expansión). El total
// es la SUMA de lo que el motor devolvió por cada una — sin recalcular
// comisión ni suplementos fuera de él (regla 8).
export function cotizarHabitaciones(items: ItemCotizarHabitacion[]): ResultadoColeccionCotizada | ResultadoColeccionBloqueada {
  if (items.length === 0) {
    return { ...resultadoBloqueado("configuracion_invalida", "No hay habitaciones para cotizar."), habitacionId: null };
  }

  const porHabitacion: ResultadoHabitacionCotizada[] = [];
  let totalBruto = 0;
  let totalComision = 0;
  let totalNeto = 0;

  for (const item of items) {
    const { habitacion, tarifa } = item;

    const unidad: UnidadOcupada = {
      adultos: habitacion.adultos,
      menores: habitacion.menores.map((m) => ({ edadAnios: m.edadAnios })),
    };
    // Una sola unidad por llamada — esta habitación física, ninguna otra.
    const distribucion: DistribucionUnidades = { unidades: [unidad] };

    const resultado = cotizarUnidadAlojamiento({ tarifa, distribucion, noches: habitacion.noches });
    if (esBloqueado(resultado)) {
      return { ...resultado, habitacionId: habitacion.id };
    }

    porHabitacion.push({
      habitacionId: habitacion.id,
      resultado,
      snapshot: construirSnapshotAlojamiento(resultado),
    });
    totalBruto += resultado.totalBruto;
    totalComision += resultado.valorComision;
    totalNeto += resultado.totalNeto;
  }

  return { ok: true, porHabitacion, totalBruto, totalComision, totalNeto };
}

// ── Adaptador desde la entrada actual de Reservar ───────────────────────
// Construye el contrato canónico SOLO cuando la asociación menor↔habitación
// es inequívoca con los datos que Reservar produce hoy (ver el análisis al
// principio de este archivo). Cualquier caso donde la entrada haya perdido
// esa relación devuelve un bloqueo claro — nunca reparte a ciegas.
export type EntradaAdaptadorReservar = {
  // Conteo de habitaciones por TIPO (acomodación) — el formulario legado
  // de Reservar (`ReservaInput.habitaciones`) siempre llega así: cuántas
  // habitaciones de cada tipo, no una lista de instancias individuales.
  habitacionesPorTipo: Record<string, number>;
  // Adultos que representa UNA habitación de cada tipo (`pax_tarifa`,
  // resuelto por el llamador desde `hotel_acomodaciones`/el default).
  paxTarifaPorTipo: Record<string, number>;
  // Distribución por INSTANCIA de habitación — presente solo cuando la
  // solicitud llegó con `edadesMenores` (flujo moderno). `null` = reparto
  // manual legado, sin ningún vínculo por habitación.
  distribucionMenores: AsignacionHabitacion[] | null;
  // Edades exactas de TODOS los menores de la solicitud, en una lista
  // plana sin vínculo a habitación — el dato que motiva este adaptador.
  edadesMenoresUsadas: number[] | null;
  // Total de menores declarados por el flujo legado (ninos+ninos2+
  // infantes) — usado únicamente para decidir si el caso "sin
  // distribución" es trivial (0 menores) o debe bloquearse.
  totalMenoresDeclarados: number;
  categoria: string | null;
  alimentacion: string | null;
  noches: number;
};

export function adaptarOcupacionDesdeReservar(
  input: EntradaAdaptadorReservar
): { ok: true; habitaciones: HabitacionOcupacion[] } | ResultadoBloqueado {
  const { categoria, alimentacion, noches } = input;

  // ── Caso A: sin distribución por instancia (reparto manual legado) ────
  if (input.distribucionMenores === null) {
    if (input.totalMenoresDeclarados > 0) {
      return resultadoBloqueado(
        "configuracion_invalida",
        "La solicitud declara menores pero no trae la distribución por habitación (reparto manual legado, sin edadesMenores) — no existe ningún vínculo entre una edad y su habitación en esta entrada. No se puede construir el contrato canónico sin inventar un reparto. Usa el flujo de edades por menor (edadesMenores) para reservar un hotel con tarifas por unidad."
      );
    }
    // Sin menores en toda la solicitud: no hay ambigüedad posible — pero
    // `habitacionesPorTipo` sigue siendo un CONTEO por tipo (ej. "2 dobles"),
    // no una lista de habitaciones físicas. Se expande aquí, ANTES de
    // cotizar, en una entrada independiente POR HABITACIÓN FÍSICA (id
    // estable `hab-${tipo}-${índice}`) — todas idénticas (mismos adultos,
    // cero menores), pero cada una es su propio elemento para que
    // `cotizarHabitaciones` la evalúe con su propia llamada al motor.
    const habitaciones: HabitacionOcupacion[] = [];
    for (const [tipo, cantidadCruda] of Object.entries(input.habitacionesPorTipo)) {
      const cantidad = Math.trunc(Number(cantidadCruda));
      if (!Number.isSafeInteger(cantidad) || cantidad <= 0) continue;
      const adultos = Math.trunc(Number(input.paxTarifaPorTipo[tipo]));
      if (!Number.isSafeInteger(adultos) || adultos <= 0) {
        return resultadoBloqueado(
          "configuracion_invalida",
          `No hay "pax_tarifa" configurado (o es inválido) para la habitación de tipo "${tipo}".`,
          { tipo }
        );
      }
      for (let i = 0; i < cantidad; i++) {
        habitaciones.push({
          id: `hab-${tipo}-${i}`,
          adultos,
          menores: [],
          categoria,
          alimentacion,
          noches,
        });
      }
    }
    if (!habitaciones.length) {
      return resultadoBloqueado("configuracion_invalida", "No hay habitaciones para cotizar en la solicitud.");
    }
    return { ok: true, habitaciones };
  }

  // ── Caso B: distribución por instancia (flujo moderno de edadesMenores) ─
  const dist = input.distribucionMenores;
  const edades = input.edadesMenoresUsadas ?? [];

  const totalMenoresPorDistribucion = dist.reduce((s, h) => s + h.nino + h.nino2 + h.infantes, 0);
  if (totalMenoresPorDistribucion !== edades.length) {
    return resultadoBloqueado(
      "configuracion_invalida",
      `La cantidad de menores distribuidos por habitación (${totalMenoresPorDistribucion}) no coincide con la cantidad de edades exactas recibidas (${edades.length}) — la entrada es inconsistente, no se puede construir el contrato canónico.`,
      { totalMenoresPorDistribucion, totalEdades: edades.length }
    );
  }

  const indicesConMenores = dist.filter((h) => h.nino + h.nino2 + h.infantes > 0).map((h) => h.indice);
  if (indicesConMenores.length > 1) {
    return resultadoBloqueado(
      "combinacion_ambigua",
      `Hay ${indicesConMenores.length} habitaciones con menores declarados, pero las edades exactas llegan en una sola lista sin vínculo a la habitación — no se puede asociar cada edad a su habitación sin inventar un reparto.`,
      { habitacionesConMenores: indicesConMenores }
    );
  }

  const indiceConMenores = indicesConMenores.length === 1 ? indicesConMenores[0] : null;
  const habitaciones: HabitacionOcupacion[] = dist.map((h) => ({
    id: `hab-${h.indice}`,
    adultos: h.adultos,
    menores: h.indice === indiceConMenores ? edades.map((edadAnios) => ({ edadAnios })) : [],
    categoria,
    alimentacion,
    noches,
  }));

  return { ok: true, habitaciones };
}
