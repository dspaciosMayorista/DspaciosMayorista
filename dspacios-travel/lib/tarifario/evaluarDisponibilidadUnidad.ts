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

import { defaultAcomConfig, type AcomConfig, type AcomRoom } from "../acomodaciones.ts";
import { repartirMenoresEnHabitaciones } from "../reservar/repartoMenoresBusqueda.ts";
import {
  validarHabitacionesOcupacion,
  type HabitacionOcupacionEntrada,
  type HabitacionOcupacionValidada,
} from "../reservar/ocupacionPorHabitacion.ts";
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
 * Identidad pública MÍNIMA de la combinación que REALMENTE pasó
 * `computarReservaBernalo` — nunca el catálogo completo del hotel. Ver el
 * detalle completo en `app/tarifario/busquedaUnidadActions.ts`, que reexporta
 * este tipo (es el shape público de la Server Action).
 */
export type OfertaUnidadConfirmada = {
  hotelId: number;
  hotelNombre: string;
  paqueteId: number;
  paqueteNombre: string;
  destinoNombre: string | null;
  categoria: string;
  alimentacion: string;
  moneda: "COP" | "USD" | null;
  fechaIda: string;
  fechaRegreso: string;
  ocupacion: { id: string; acom: AcomRoom; adultos: number; edadesMenores: number[] }[];
};

/** Veredicto CONFIRMADO por hotel — solo estas dos formas pueden afirmarse:
 * "disponible" (con la identidad exacta que lo confirmó) o
 * "sin_disponibilidad" (el motor concluyó, con fundamento, que no cubre la
 * búsqueda). Cualquier otra situación es `VeredictoHotelUnidad.tipo ===
 * "inconcluyente"` — nunca se disfraza de una de estas dos. */
export type DisponibilidadUnidadHotel =
  | { hotelId: number; estado: "disponible"; oferta: OfertaUnidadConfirmada }
  | { hotelId: number; estado: "sin_disponibilidad" };

/**
 * Resultado de evaluar un hotel: o hay un VEREDICTO con fundamento
 * (disponible/sin_disponibilidad), o la evaluación fue INCONCLUYENTE — un
 * fallo técnico, una configuración inconsistente, o una excepción — y
 * `motivo` lleva el código/detalle real para diagnóstico (nunca se pierde:
 * es lo que permite depurar en los logs de Vercel en vez de ver "cero
 * resultados" sin ninguna pista). Nunca se convierte una inconcluyente en
 * "sin_disponibilidad": eso sería afirmar algo que el motor no concluyó.
 */
export type VeredictoHotelUnidad =
  | { tipo: "veredicto"; valor: DisponibilidadUnidadHotel }
  | { tipo: "inconcluyente"; hotelId: number; motivo: string };

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
 * más campos en `ok:true`, y `codigo`/`mensaje` son más específicos). */
export type ResultadoComputarDisponibilidad =
  | { ok: true }
  | { ok: false; codigo: string; mensaje: string };

export type EntradaEvaluarHotelUnidad = {
  hotelId: number;
  /** Ofertas `porcion_terrestre` YA filtradas para este hotel (ver `ofertasPorHotelDe`). */
  ofertas: HotelBernaloDescubierto[];
  /** Fila de `hoteles` — `undefined` si no llegó en el lote (drift de datos: nunca se inventa). */
  fila: FilaHotelBusquedaUnidad | undefined;
  /** Reglas de `hotel_acomodaciones` de este hotel (puede venir vacío: se usa el default por acomodación). */
  reglas: AcomConfig[];
  /** Tipos de habitación consultados, en el orden capturado. */
  habitacionesConsultadas: { acom: AcomRoom }[];
  adultosDeclarados: number;
  edadesMenores: number[];
  fechaIda: string;
  fechaRegreso: string;
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
  const { hotelId, ofertas, fila, reglas, habitacionesConsultadas, adultosDeclarados, edadesMenores, fechaIda, fechaRegreso, computar } = entrada;

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

  const configDe = (a: AcomRoom): AcomConfig => reglas.find((x) => x.acomodacion === a) ?? defaultAcomConfig(a);
  const reparto = repartirMenoresEnHabitaciones({
    habitaciones: habitacionesConsultadas.map((h) => ({ acom: h.acom, config: configDe(h.acom) })),
    adultosDeclarados,
    edades: edadesMenores,
    infanteMax: fila.edad_infante_max ?? 2,
    ninoMax: fila.edad_nino_max ?? 10,
  });
  if (!reparto.ok) {
    // La SELECCIÓN no cabe en este hotel (habitaciones/adultos/menores): es
    // una razón honesta de "no disponible para tu búsqueda" — veredicto real.
    // Un rechazo por CONFIGURACIÓN del hotel o por una edad que el hotel
    // clasifica como adulto no tiene ese mismo fundamento: inconcluyente.
    if (reparto.tipo === "seleccion_invalida") {
      return { tipo: "veredicto", valor: { hotelId, estado: "sin_disponibilidad" } };
    }
    return { tipo: "inconcluyente", hotelId, motivo: `reparto_${reparto.tipo}` };
  }

  // Reenvío por la MISMA frontera de validación que usa la cotización
  // pública (nunca se salta): la asociación habitación↔edades que produce el
  // reparto se revalida como si viniera del navegador.
  //
  // ⚠️ DEFECTO REAL confirmado por ejecución (no por inspección de fuente):
  // `validarHabitacionesOcupacion` exige `HabitacionOcupacionEntrada`, que
  // incluye `cantidadMenores` — un campo que `HabitacionRepartida` (la salida
  // de `repartirMenoresEnHabitaciones`) NUNCA tuvo (solo trae
  // `id/acom/adultos/edadesMenores`). Pasar `reparto.habitaciones` TAL CUAL
  // (como hacía el código original de `busquedaUnidadActions.ts`) hacía que
  // `typeof fila.cantidadMenores !== "number"` fuera SIEMPRE verdadero —
  // `vOcupacion.ok` daba `false` para TODO hotel, en TODA búsqueda, desde que
  // existe este código: la búsqueda general de "unidad" nunca pudo devolver
  // un solo hotel disponible, no solo el hotel_id=216 reportado. Se detectó
  // ejecutando esta función de verdad en `pruebas/evaluarDisponibilidadUnidad.test.ts`
  // (el primer test, "hotel unidad descubierto + computarReservaBernalo ok",
  // fallaba con `motivo: "ocupacion_rechazada_por_validador"` en vez de
  // `disponible` hasta este fix). Se deriva `cantidadMenores` de
  // `edadesMenores.length` — el mismo criterio que ya usa
  // `construirPayloadHabitaciones` (`ocupacionPorHabitacion.ts`) para el
  // flujo del modal.
  const entradaOcupacion: HabitacionOcupacionEntrada[] = reparto.habitaciones.map((h) => ({
    id: h.id,
    acom: h.acom,
    adultos: h.adultos,
    cantidadMenores: h.edadesMenores.length,
    edadesMenores: h.edadesMenores,
  }));
  const vOcupacion = validarHabitacionesOcupacion(entradaOcupacion);
  if (!vOcupacion.ok) {
    return { tipo: "inconcluyente", hotelId, motivo: "ocupacion_rechazada_por_validador" };
  }
  const ocupacion: HabitacionOcupacionValidada[] = vOcupacion.habitaciones;

  // Decisión acotada: basta el PRIMER combo que confirme al hotel — no hace
  // falta agotar las demás combinaciones solo para "llenar opciones".
  const combos = combinacionesDe(ofertas);
  if (combos.length === 0) {
    // El hotel llegó hasta acá (tiene ofertas `porcion_terrestre`) pero
    // ninguna produjo una combinación categoría×alimentación evaluable — un
    // drift de datos entre el descubrimiento y esta evaluación, no un "no
    // disponible" con fundamento.
    return { tipo: "inconcluyente", hotelId, motivo: "sin_combinaciones_para_evaluar" };
  }

  const codigosNoClasificados = new Set<string>();
  for (const combo of combos) {
    const resultado = await computar({
      paqueteId: combo.oferta.paqueteId,
      hotelId,
      categoria: combo.categoria,
      alimentacion: combo.alimentacion,
      salida: { tipo: "sin_vuelo", fechaIda, fechaRegreso },
      habitaciones: ocupacion,
    });
    if (resultado.ok) {
      // Identidad EXACTA de la combinación que funcionó — nunca el catálogo
      // completo del hotel.
      return {
        tipo: "veredicto",
        valor: {
          hotelId,
          estado: "disponible",
          oferta: {
            hotelId,
            hotelNombre: combo.oferta.hotelNombre,
            paqueteId: combo.oferta.paqueteId,
            paqueteNombre: combo.oferta.paqueteNombre,
            destinoNombre: combo.oferta.destinoNombre,
            categoria: combo.categoria,
            alimentacion: combo.alimentacion,
            moneda: combo.oferta.moneda,
            fechaIda,
            fechaRegreso,
            ocupacion,
          },
        },
      };
    }
    // El resultado interno NUNCA se guarda ni se reenvía — solo su código,
    // y solo si no está clasificado como "sin disponibilidad" legítima (para
    // el diagnóstico de la inconcluyencia, si la hay).
    if (!MOTIVOS_SIN_DISPONIBILIDAD.has(resultado.codigo)) codigosNoClasificados.add(resultado.codigo);
  }

  // Agotadas todas las combinaciones: si TODAS las que no confirmaron lo
  // hicieron con un motivo de la lista honesta ("sin disponibilidad" real),
  // recién acá se afirma el veredicto negativo. Si quedó algún código fuera
  // de esa lista, la evaluación es inconcluyente — con el/los código(s)
  // reales para diagnóstico, nunca en silencio.
  if (codigosNoClasificados.size === 0) {
    return { tipo: "veredicto", valor: { hotelId, estado: "sin_disponibilidad" } };
  }
  return { tipo: "inconcluyente", hotelId, motivo: `codigo_tecnico:${[...codigosNoClasificados].sort().join(",")}` };
}
