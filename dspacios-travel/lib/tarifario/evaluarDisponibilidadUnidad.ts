// ─────────────────────────────────────────────────────────────────────────
// Núcleo PURO del veredicto de disponibilidad de un hotel por unidad
// (Bernalo) para una búsqueda del buscador general de Porción terrestre.
//
// Por qué existe (cierre del hallazgo "Hotel Prueba Odair no aparece"):
// `app/tarifario/busquedaUnidadActions.ts` es un archivo `"use server"` —
// solo puede exportar funciones async y tipos, así que su lógica NUNCA se
// puede invocar directo desde `node --test` para probarla de verdad (llamar
// la Server Action real exige Next + Supabase con credenciales, y de hecho
// ninguna prueba de esa acción se ha podido ejecutar así hasta ahora — todas
// eran de inspección de texto fuente). Ese vacío escondió el defecto real:
// `evaluarHotel` (la función que decidía el veredicto) convertía CUALQUIER
// combinación que `computarReservaBernalo` rechazara por un código TÉCNICO
// (`moneda_no_determinable`, `salida_no_vinculada`, `configuracion_incompleta`,
// `error_interno`, drift de datos como `hotel_no_vinculado`…) en `return
// null` — indistinguible, para el llamador, de "no evaluado todavía". El
// hotel simplemente desaparecía de la lista, sin ningún rastro de que la
// razón real fue un fallo técnico y no "sin disponibilidad".
//
// Este módulo extrae esa decisión a una función PURA e inyectable —
// `computar` no es `computarReservaBernalo` importado directo, es un
// PARÁMETRO — para que SÍ se pueda ejecutar bajo `node --test` con un
// `computar` de prueba (ver `pruebas/evaluarDisponibilidadUnidad.test.ts`):
// eso es lo que exige que esta corrección se pruebe con comportamiento REAL,
// no solo con inspección de código. `app/tarifario/busquedaUnidadActions.ts`
// sigue siendo el único llamador en producción, pasándole el
// `computarReservaBernalo` real.
//
// Módulo PURO (sin "use client"/"use server", sin I/O propio): imports
// relativos con extensión `.ts`, mismo motivo documentado en
// `lib/tarifario/datosBernalo.ts` — así se puede importar directo desde
// `node --test` sin bundler.
// ─────────────────────────────────────────────────────────────────────────

import { type AcomRoom } from "../acomodaciones.ts";
import {
  validarHabitacionesOcupacion,
  type HabitacionOcupacionEntrada,
  type HabitacionOcupacionValidada,
} from "../reservar/ocupacionPorHabitacion.ts";
import { distribuirOcupacionUnidad } from "./distribucionOcupacionUnidad.ts";
import { resolverCapacidadTarifaUnidad } from "./capacidadTarifaUnidad.ts";
import type { HotelBernaloDescubierto } from "./datosBernalo.ts";

/** Fila mínima de `hoteles` que necesita el veredicto — mismas columnas que
 * ya consultaba `busquedaUnidadActions.ts` en un solo lote por destino. */
export type FilaHotelBusquedaUnidad = {
  id: number;
  edad_infante_max: number | null;
  edad_nino_max: number | null;
  adults_only: boolean | null;
};

/**
 * Identidad + PRECIO público MÍNIMO de UNA combinación categoría×alimentación
 * que REALMENTE pasó `computarReservaBernalo` — nunca el catálogo completo
 * del hotel, nunca el resultado interno completo. Ver el detalle completo en
 * `app/tarifario/busquedaUnidadActions.ts`, que reexporta este tipo (es el
 * shape público de la Server Action).
 *
 * Cierre de la UX de la tarjeta unidad: antes solo viajaba la IDENTIDAD (sin
 * precio) de la única combinación en la que se cortaba la evaluación — la
 * tarjeta no podía mostrar precio/pax sin volver a cotizar. Ahora se evalúan
 * TODAS las combinaciones y cada una que confirme trae también `precioVenta`/
 * `moneda`/`paxTotal` — construidos CAMPO A CAMPO desde el `ok:true` de
 * `computarReservaBernalo`, nunca por spread ni reenvío del objeto interno
 * (que trae costoNeto, proveedor, comisión, snapshot por habitación —
 * ninguno de esos cruza esta frontera).
 */
export type OpcionUnidadConfirmada = {
  hotelId: number;
  hotelNombre: string;
  paqueteId: number;
  paqueteNombre: string;
  destinoNombre: string | null;
  categoria: string;
  alimentacion: string;
  moneda: string;
  precioVenta: number;
  paxTotal: number;
  fechaIda: string;
  fechaRegreso: string;
  ocupacion: { id: string; acom: AcomRoom; adultos: number; edadesMenores: number[] }[];
};

/** Veredicto CONFIRMADO por hotel — solo estas dos formas pueden afirmarse:
 * "disponible" (con TODAS las combinaciones que confirmaron — nunca solo la
 * primera) o "sin_disponibilidad" (el motor concluyó, con fundamento, que
 * ninguna cubre la búsqueda). Cualquier otra situación es
 * `VeredictoHotelUnidad.tipo === "inconcluyente"` — nunca se disfraza de una
 * de estas dos.
 *
 * `opciones` viene ORDENADA — la primera es la que debe preseleccionarse por
 * defecto: menor `precioVenta`, y en empate, orden determinista por
 * `paqueteId`, `categoria`, `alimentacion` (ver `compararOpciones`). Cada
 * opción del arreglo es una combinación que EFECTIVAMENTE pasó
 * `computarReservaBernalo` — nunca el producto cartesiano completo si alguna
 * combinación no fue cotizable. */
export type DisponibilidadUnidadHotel =
  | { hotelId: number; estado: "disponible"; opciones: OpcionUnidadConfirmada[] }
  | { hotelId: number; estado: "sin_disponibilidad" };

/**
 * Resultado de evaluar un hotel: o hay un VEREDICTO con fundamento
 * (disponible/sin_disponibilidad), o la evaluación fue INCONCLUYENTE — un
 * fallo técnico, una configuración inconsistente, o una excepción — y
 * `motivo` lleva el código/detalle real para diagnóstico (nunca se pierde:
 * es lo que permite depurar en los logs de Vercel en vez de ver "cero
 * resultados" sin ninguna pista). Nunca se convierte una inconcluyente en
 * "sin_disponibilidad": eso sería afirmar algo que el motor no concluyó.
 *
 * `parcial: true` en un veredicto `disponible` significa: al menos una
 * combinación SÍ confirmó (por eso hay veredicto, con fundamento), pero
 * OTRA combinación del mismo hotel falló con un código TÉCNICO (no
 * "sin disponibilidad" legítima) — el hotel se muestra igual, con las
 * opciones que sí se pudieron confirmar, pero el llamador debe marcar la
 * búsqueda completa como `incompleto` (no se evaluó el universo de
 * combinaciones con total confianza). Nunca se usa para ocultar el hotel:
 * solo para el aviso agregado de la búsqueda.
 */
export type VeredictoHotelUnidad =
  | { tipo: "veredicto"; valor: DisponibilidadUnidadHotel; parcial?: boolean }
  | { tipo: "inconcluyente"; hotelId: number; motivo: string };

/** Orden de las opciones confirmadas de un hotel: menor `precioVenta`
 * primero (esa es la preseleccionada por defecto en la tarjeta); en empate,
 * determinista por `paqueteId` → `categoria` → `alimentacion`, nunca por el
 * orden de llegada de `Promise`/red. */
export function compararOpciones(a: OpcionUnidadConfirmada, b: OpcionUnidadConfirmada): number {
  if (a.precioVenta !== b.precioVenta) return a.precioVenta - b.precioVenta;
  if (a.paqueteId !== b.paqueteId) return a.paqueteId - b.paqueteId;
  if (a.categoria !== b.categoria) return a.categoria.localeCompare(b.categoria);
  return a.alimentacion.localeCompare(b.alimentacion);
}

// ÚNICAS razones por las que se AFIRMA "sin_disponibilidad": el motor dijo
// que esa oferta no cubre las fechas pedidas o que no pudo componer una
// cotización para esa ocupación. Cualquier otro código
// (`configuracion_incompleta`, `moneda_no_determinable`, `error_interno`,
// drift de datos como `hotel_no_vinculado`/`paquete_no_disponible`) NO
// autoriza la afirmación: significa "no pudimos determinarlo" →
// `inconcluyente`.
const MOTIVOS_SIN_DISPONIBILIDAD = new Set<string>(["fechas_fuera_de_ventana", "no_cotizable"]);

/** Descubrimiento Bernalo del destino, acotado a porción terrestre (sin vuelo). */
export function ofertasPorHotelDe(
  hoteles: HotelBernaloDescubierto[]
): Map<number, HotelBernaloDescubierto[]> {
  const mapa = new Map<number, HotelBernaloDescubierto[]>();
  for (const h of hoteles) {
    if (h.tipo !== "porcion_terrestre") continue;
    const arr = mapa.get(h.hotelId) ?? [];
    arr.push(h);
    mapa.set(h.hotelId, arr);
  }
  return mapa;
}

/**
 * Combinaciones (oferta, categoría, alimentación) de un hotel, en orden
 * determinista y "index-major" entre ofertas — ver el detalle completo en
 * `app/tarifario/busquedaUnidadActions.ts` (el llamador real).
 */
export function combinacionesDe(
  ofertas: HotelBernaloDescubierto[]
): { oferta: HotelBernaloDescubierto; categoria: string; alimentacion: string }[] {
  const porOferta = ofertas.map((oferta) => {
    const pares: { categoria: string; alimentacion: string }[] = [];
    for (const categoria of oferta.categorias) {
      for (const alimentacion of oferta.regimenes) pares.push({ categoria, alimentacion });
    }
    return pares;
  });
  const maxPares = porOferta.reduce((m, p) => Math.max(m, p.length), 0);
  const out: { oferta: HotelBernaloDescubierto; categoria: string; alimentacion: string }[] = [];
  for (let k = 0; k < maxPares; k++) {
    for (let o = 0; o < ofertas.length; o++) {
      const par = porOferta[o][k];
      if (par) out.push({ oferta: ofertas[o], categoria: par.categoria, alimentacion: par.alimentacion });
    }
  }
  return out;
}

/** Entrada EXACTA que espera `computarReservaBernalo` (estructuralmente —
 * ver `EntradaComputoReservaBernalo`/`DecisionesOcupacionBernalo` en
 * `lib/reservar/computoReservaBernalo.ts`, que no se importa acá para no
 * arrastrar su cadena de imports "@/..." a un módulo pensado para correr
 * bajo `node --test` sin bundler). */
export type EntradaComputarDisponibilidad = {
  paqueteId: number;
  hotelId: number;
  categoria: string;
  alimentacion: string;
  salida: { tipo: "sin_vuelo"; fechaIda: string; fechaRegreso: string };
  habitaciones: HabitacionOcupacionValidada[];
};

/** Forma MÍNIMA del resultado de `computarReservaBernalo` que esta función
 * necesita — cualquier resultado real es estructuralmente compatible (trae
 * MUCHOS más campos en `ok:true` — costoHotelTotal, proveedorHotel,
 * habitaciones con snapshot, etc. — y `codigo`/`mensaje` son más
 * específicos). Solo estos 3 campos de `ok:true` se leen para construir
 * `OpcionUnidadConfirmada`; ninguno de los demás cruza esta frontera porque
 * este tipo ni siquiera los declara. */
export type ResultadoComputarDisponibilidad =
  | { ok: true; precioVenta: number; moneda: string; paxTotal: number }
  | { ok: false; codigo: string; mensaje: string };

export type EntradaEvaluarHotelUnidad = {
  hotelId: number;
  /** Ofertas `porcion_terrestre` YA filtradas para este hotel (ver `ofertasPorHotelDe`). */
  ofertas: HotelBernaloDescubierto[];
  /** Fila de `hoteles` — `undefined` si no llegó en el lote (drift de datos: nunca se inventa). */
  fila: FilaHotelBusquedaUnidad | undefined;
  /** Filas de `hotel_temporadas` de este hotel, YA LEÍDAS — misma fuente que
   * usa `computarReservaBernalo` (vía `resolverTemporadaEstadia`) para
   * resolver la temporada de la estadía. NUNCA `hotel_acomodaciones`: la
   * capacidad de un hotel `modelo_tarifario = "unidad"` sale de la tarifa
   * unidad publicada (`capacidadTarifaUnidad.ts`), no de una tabla pensada
   * para el modelo persona (ver la cabecera de
   * `lib/tarifario/distribucionOcupacionUnidad.ts` para la causa completa
   * del defecto que esto corrige). */
  temporadasRaw: unknown[];
  /** Filas `estado = "publicada"` de `hotel_tarifas_unidad` de este hotel,
   * YA LEÍDAS — misma fuente que `seleccionarTarifaAlojamientoPublicada`
   * (Fase 3B) usa dentro de `computarReservaBernalo`. */
  filasTarifas: unknown[];
  /** Tipos de habitación consultados, en el orden capturado — para unidad
   * solo determinan CUÁNTAS habitaciones físicas hay (el nombre Doble/
   * Triple/… no se usa para inferir capacidad; ver la cabecera de
   * `distribucionOcupacionUnidad.ts`). */
  habitacionesConsultadas: { acom: AcomRoom }[];
  adultosDeclarados: number;
  edadesMenores: number[];
  fechaIda: string;
  fechaRegreso: string;
  /** Fecha de "hoy" (yyyy-mm-dd) para la vigencia de compra de la tarifa —
   * mismo criterio que `computarReservaBernalo` (`hoyISO()`), obligatoria
   * acá también: sin `Date.now()` oculto, misma entrada → mismo resultado. */
  hoy: string;
  /** INYECTADO — en producción es `computarReservaBernalo`; en pruebas, un doble de prueba. */
  computar: (input: EntradaComputarDisponibilidad) => Promise<ResultadoComputarDisponibilidad>;
};

/**
 * Determina el veredicto de UN hotel: agota todas sus combinaciones
 * (categoría × alimentación × oferta) hasta el primer `computar(...)` que
 * confirme, o hasta concluir honestamente que ninguna cubre la búsqueda.
 * Nunca escribe nada; de solo lectura sobre los datos que recibe.
 */
export async function evaluarDisponibilidadHotelUnidad(
  entrada: EntradaEvaluarHotelUnidad
): Promise<VeredictoHotelUnidad> {
  const {
    hotelId, ofertas, fila, temporadasRaw, filasTarifas,
    habitacionesConsultadas, adultosDeclarados, edadesMenores, fechaIda, fechaRegreso, hoy, computar,
  } = entrada;

  // Sin fila maestra no se INVENTAN umbrales de edad ni "no es Adults Only"
  // (mismo criterio fail-closed que el motor persona): inconcluyente, nunca
  // "sin disponibilidad" (sería afirmar algo sin fundamento) ni "disponible".
  if (!fila) return { tipo: "inconcluyente", hotelId, motivo: "hotel_sin_fila_maestra" };

  // Restricción propia del hotel, ajena a fechas/ocupación de habitación: un
  // Adults Only no puede atender una búsqueda con menores declarados. Esto SÍ
  // tiene fundamento (el dato del hotel es autoritativo y ya se tiene) — es
  // un veredicto real, no una inconcluyencia.
  if (edadesMenores.length > 0 && fila.adults_only) {
    return { tipo: "veredicto", valor: { hotelId, estado: "sin_disponibilidad" } };
  }

  // Cierre de la UX de la tarjeta: la evaluación YA NO se corta en el primer
  // éxito — hace falta reunir TODAS las combinaciones que confirmen, porque
  // la tarjeta debe ofrecer selectores de categoría/alimentación con
  // opciones REALES (nunca el producto cartesiano completo si alguna no es
  // cotizable). El costo adicional es el mismo trabajo que antes se evitaba
  // a propósito ("decisión acotada") — ahora es requisito del producto, no
  // un descuido: se paga con más llamadas a `computar`, nunca con menos
  // combinaciones evaluadas.
  const combos = combinacionesDe(ofertas);
  if (combos.length === 0) {
    // El hotel llegó hasta acá (tiene ofertas `porcion_terrestre`) pero
    // ninguna produjo una combinación categoría×alimentación evaluable — un
    // drift de datos entre el descubrimiento y esta evaluación, no un "no
    // disponible" con fundamento.
    return { tipo: "inconcluyente", hotelId, motivo: "sin_combinaciones_para_evaluar" };
  }

  const opciones: OpcionUnidadConfirmada[] = [];
  const codigosNoClasificados = new Set<string>();
  for (const combo of combos) {
    // ── Capacidad AUTORITATIVA de ESTA combinación puntual (categoría ×
    // alimentación × temporada de la estadía) — NUNCA `hotel_acomodaciones`
    // ni un valor inferido del nombre de la habitación consultada (Doble/
    // Triple/…). Cada combinación se evalúa con SU PROPIA capacidad: dos
    // combinaciones del mismo hotel pueden tener `minPax`/`maxPax`
    // distintos (ej. una categoría más grande), y nunca se mezclan (ver la
    // cabecera de `distribucionOcupacionUnidad.ts`).
    const resolucionCapacidad = resolverCapacidadTarifaUnidad({
      hotelId, temporadasRaw, filasTarifas,
      categoria: combo.categoria, alimentacion: combo.alimentacion,
      fechaIda, fechaRegreso, hoy,
    });
    // Sin capacidad resuelta para ESTA combinación puntual (temporada/tarifa
    // no encontrada, ambigua o inválida): reparto SIN COTA
    // (`{minPax:1, maxPax:null}`) — nunca se rechaza acá algo que
    // `computarReservaBernalo` podría admitir; es esa llamada, que resuelve
    // la MISMA tarifa por dentro, la que tiene la última palabra.
    const capacidad = resolucionCapacidad.ok ? resolucionCapacidad.capacidad : { minPax: 1, maxPax: null };

    const reparto = distribuirOcupacionUnidad({ habitacionesConsultadas, adultosDeclarados, edadesMenores, capacidad });
    if (!reparto.ok) {
      // "seleccion_invalida": la ocupación pedida no cabe en ESTA
      // combinación (su capacidad real ya se conoce) — no es un fallo
      // técnico, simplemente esta combinación no sirve para esta búsqueda;
      // se sigue con la siguiente sin marcar nada raro. "configuracion_invalida"
      // sí es una señal real de datos rotos (ej. una tarifa con
      // `maxPax < minPax`) — cuenta como código no clasificado para que la
      // búsqueda se marque `parcial`/inconcluyente en vez de desaparecer en
      // silencio.
      if (reparto.tipo === "configuracion_invalida") codigosNoClasificados.add(`distribucion_${reparto.tipo}`);
      continue;
    }

    // Reenvío por la MISMA frontera de validación que usa la cotización
    // pública (nunca se salta): la asociación habitación↔edades que produce
    // el reparto se revalida como si viniera del navegador. `cantidadMenores`
    // se deriva de `edadesMenores.length` — mismo criterio que ya usa
    // `construirPayloadHabitaciones` (`ocupacionPorHabitacion.ts`).
    const entradaOcupacion: HabitacionOcupacionEntrada[] = reparto.habitaciones.map((h) => ({
      id: h.id,
      acom: h.acom,
      adultos: h.adultos,
      cantidadMenores: h.edadesMenores.length,
      edadesMenores: h.edadesMenores,
    }));
    const vOcupacion = validarHabitacionesOcupacion(entradaOcupacion);
    if (!vOcupacion.ok) {
      codigosNoClasificados.add("ocupacion_rechazada_por_validador");
      continue;
    }
    const ocupacion: HabitacionOcupacionValidada[] = vOcupacion.habitaciones;

    const resultado = await computar({
      paqueteId: combo.oferta.paqueteId,
      hotelId,
      categoria: combo.categoria,
      alimentacion: combo.alimentacion,
      salida: { tipo: "sin_vuelo", fechaIda, fechaRegreso },
      habitaciones: ocupacion,
    });
    if (resultado.ok) {
      // Identidad + precio de ESTA combinación — construida campo a campo
      // desde `combo` (identidad ya conocida) y `resultado` (SOLO
      // precioVenta/moneda/paxTotal, nunca el objeto completo). Se sigue
      // evaluando el resto de combos: ninguna se descarta por "ya hay una".
      opciones.push({
        hotelId,
        hotelNombre: combo.oferta.hotelNombre,
        paqueteId: combo.oferta.paqueteId,
        paqueteNombre: combo.oferta.paqueteNombre,
        destinoNombre: combo.oferta.destinoNombre,
        categoria: combo.categoria,
        alimentacion: combo.alimentacion,
        moneda: resultado.moneda,
        precioVenta: resultado.precioVenta,
        paxTotal: resultado.paxTotal,
        fechaIda,
        fechaRegreso,
        ocupacion,
      });
      continue;
    }
    // El resultado interno NUNCA se guarda ni se reenvía — solo su código,
    // y solo si no está clasificado como "sin disponibilidad" legítima (para
    // el diagnóstico de la inconcluyencia, si la hay).
    if (!MOTIVOS_SIN_DISPONIBILIDAD.has(resultado.codigo)) codigosNoClasificados.add(resultado.codigo);
  }

  // Clasificación final (regla explícita del encargo):
  //   · algún éxito → disponible, con las opciones confirmadas ordenadas
  //     (la primera es la preseleccionada por defecto);
  //   · algún éxito PERO también algún código técnico → disponible igual
  //     (las opciones que sí confirmaron siguen siendo válidas), marcado
  //     `parcial` para que el llamador avise que la búsqueda quedó
  //     incompleta;
  //   · ningún éxito y todos los códigos son "sin disponibilidad" legítima
  //     → sin_disponibilidad;
  //   · ningún éxito y algún código técnico → inconcluyente.
  if (opciones.length > 0) {
    opciones.sort(compararOpciones);
    return {
      tipo: "veredicto",
      valor: { hotelId, estado: "disponible", opciones },
      parcial: codigosNoClasificados.size > 0,
    };
  }
  if (codigosNoClasificados.size === 0) {
    return { tipo: "veredicto", valor: { hotelId, estado: "sin_disponibilidad" } };
  }
  return { tipo: "inconcluyente", hotelId, motivo: `codigo_tecnico:${[...codigosNoClasificados].sort().join(",")}` };
}
