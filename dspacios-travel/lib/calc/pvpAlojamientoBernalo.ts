// ─────────────────────────────────────────────────────────────────────────
// Fase 3E Bernalo — composición del PVP público del paquete a partir del
// resultado de `cotizarHabitaciones` (Fase 3A), con la unidad correcta por
// componente (confirmada antes de esta fase — ver el análisis "inconsistencia
// de unidades" entregado con la tarea):
//
//   aporteHotelTotal      = Σ marcar(habitación.resultado.totalNeto, pctMk)   — UNA vez por habitación FÍSICA
//   aporteServiciosTotal  = servicios "persona" (pax TOTAL real) + servicios "grupo" (UNA vez, pax real)
//   aporteVueloTotal      = aporteVuelo(costoSilla, aplicaMk, pctMk, ta) × paxConSillaReal
//   pvp                   = redondearVenta(aporteHotelTotal + aporteServiciosTotal + aporteVueloTotal, moneda)
//
// `componerTarifa()` (el compositor legado) NUNCA se llama aquí — mezclaría
// un aporte agregado POR HABITACIÓN con aportes agregados POR LA SOLICITUD
// COMPLETA, duplicando/subcontando vuelo y servicios según el número de
// habitaciones (ver el análisis numérico previo). Este archivo reimplementa
// la MISMA regla de redondeo único (una sola vez, al final) sin usar esa
// función, y reutiliza sin modificar: `marcar`/`aporteVuelo`/`redondearVenta`
// (`lib/calc/paquetes.ts`) y `costoNetoServicioIncluido`/`cargoGrupoIncluido`
// (`lib/reservar/serviciosPaquete.ts`, fuente ÚNICA de servicios incluidos).
//
// FRONTERA PÚBLICA (regla de la tarea): el resultado de este módulo es lo
// único que puede viajar hacia el navegador. Nunca expone `totalNeto`,
// `totalBruto`, comisión, `payload`, snapshot, fuente ni ningún costo — los
// lee del `ResultadoColeccionCotizada` recibido (que SÍ los trae, para
// trazabilidad interna) pero jamás los reenvía. `ResultadoPvpAlojamientoBernalo`
// es un tipo CERRADO (no un `Omit<>` ni un passthrough) precisamente para que
// TypeScript impida filtrar un campo interno por accidente.
//
// Fuera de alcance de este archivo: consultar Supabase (recibe todo ya
// leído), validar pertenencia hotel/categoría/alimentación al paquete (eso
// es la frontera server-side, `app/tarifario/cotizacionBernaloActions.ts`),
// impuesto/base comisionable contable (Fase 3F, ver el informe de la tarea).
// ─────────────────────────────────────────────────────────────────────────

import { marcar, aporteVuelo, redondearVenta } from "./paquetes.ts";
import {
  costoNetoServicioIncluido,
  cargoGrupoIncluido,
  type CategoriaServicio,
  type ServicioGrupoIncluido,
} from "../reservar/serviciosPaquete.ts";
import type { ResultadoColeccionCotizada } from "./ocupacionHabitacion.ts";

export type ServicioIncluidoPersonaBernalo = {
  servicioId: number;
  nombre: string;
  categoria: CategoriaServicio;
  /** Neto por persona (sin markup) — `null` = configuración incompleta, falla cerrado. */
  precioPersonaNeto: number | null;
  liquidacion: string | null;
};

export type VueloBernalo = {
  /** Tarifa neta POR SILLA (un pasajero) — `bloqueos_vuelo.tarifa_para_empaquetar`/`empaquetados.tarifa_para_empaquetar`. */
  costoTiqueteSilla: number;
  aplicaMk: boolean;
  ta: number;
};

export type EntradaPvpAlojamientoBernalo = {
  resultadoHabitaciones: ResultadoColeccionCotizada;
  pctMk: number;
  moneda: string;
  numNoches: number;
  /** Servicios incluidos con cobro POR PERSONA. */
  serviciosPersona: ServicioIncluidoPersonaBernalo[];
  /** Servicios incluidos con cobro POR GRUPO (rangos de pax) — se cobran UNA sola vez, no por habitación. */
  serviciosGrupo: ServicioGrupoIncluido[];
  /** `null` = paquete sin vuelo asociado (porción terrestre) → aporte de vuelo = 0. */
  vuelo: VueloBernalo | null;
};

// ── Salida — SOLO campos comerciales públicos, tipo cerrado ────────────
export type ResultadoPvpAlojamientoBernaloOk = {
  ok: true;
  pvp: number;
  moneda: string;
  /** Adultos + TODOS los menores (incluidos infantes) de todas las habitaciones. */
  paxTotal: number;
  /** Solo de referencia visual — el total (`pvp`) es la autoridad. */
  promedioPorViajero: number;
};

export type CodigoPvpAlojamientoBernalo = "servicio_sin_tarifa" | "servicio_sin_rango_grupal";

export type ResultadoPvpAlojamientoBernaloBloqueado = {
  ok: false;
  codigo: CodigoPvpAlojamientoBernalo;
  mensaje: string;
};

export type ResultadoPvpAlojamientoBernalo = ResultadoPvpAlojamientoBernaloOk | ResultadoPvpAlojamientoBernaloBloqueado;

/**
 * Compone el PVP público del paquete Bernalo. Puro: no consulta nada, no
 * llama `componerTarifa`, redondea UNA sola vez (al final, sobre la suma
 * completa) — nunca por habitación ni por componente.
 */
export function calcularPvpAlojamientoBernalo(input: EntradaPvpAlojamientoBernalo): ResultadoPvpAlojamientoBernalo {
  // ── 1) Hotel: una vez por habitación física (regla 12) ─────────────────
  let aporteHotelTotal = 0;
  let paxTotal = 0;
  let paxConSilla = 0;
  for (const ph of input.resultadoHabitaciones.porHabitacion) {
    aporteHotelTotal += marcar(ph.resultado.totalNeto, input.pctMk);
    const unidad = ph.resultado.datosFuente.distribucion.unidades[0];
    const adultos = unidad?.adultos ?? 0;
    const menoresTotal = ph.resultado.menoresClasificados.length;
    const menoresConSilla = ph.resultado.menoresClasificados.filter((m) => m.categoriaTarifaria !== "infante").length;
    paxTotal += adultos + menoresTotal;
    paxConSilla += adultos + menoresConSilla;
  }

  // ── 2) Servicios incluidos: persona (pax total real) + grupo (una vez) ─
  let aporteServiciosTotal = 0;
  for (const s of input.serviciosPersona) {
    const costoNeto = costoNetoServicioIncluido("persona", s.precioPersonaNeto, [], paxTotal, s.liquidacion, input.numNoches);
    if (costoNeto == null) {
      return {
        ok: false,
        codigo: "servicio_sin_tarifa",
        mensaje: `El servicio incluido "${s.nombre}" no tiene una tarifa configurada para esta composición.`,
      };
    }
    // Sin redondeo por servicio a propósito — mismo criterio que
    // `aporteServiciosIncluidos` legado (paquetes/actions.ts): la suma se
    // redondea UNA sola vez, al final (regla 16).
    aporteServiciosTotal += marcar(costoNeto, input.pctMk);
  }
  if (input.serviciosGrupo.length) {
    const r = cargoGrupoIncluido(input.serviciosGrupo, paxTotal, input.pctMk, input.numNoches);
    if (!r.ok) {
      return {
        ok: false,
        codigo: "servicio_sin_rango_grupal",
        mensaje: `El servicio incluido "${r.nombre}" no tiene un rango configurado para ${r.totalPax} viajero(s) — no se puede cotizar sin inventar un precio.`,
      };
    }
    // `r.pvp` ya viene redondeado por `cargoGrupoIncluido` (mismo criterio
    // que usa hoy el buscador en vivo) — se suma tal cual, sin recalcular.
    aporteServiciosTotal += r.pvp;
  }

  // ── 3) Vuelo: por SILLA real, nunca por habitación (regla 14) ──────────
  const aporteVueloTotal = input.vuelo
    ? aporteVuelo(input.vuelo.costoTiqueteSilla, input.vuelo.aplicaMk, input.pctMk, input.vuelo.ta) * paxConSilla
    : 0;

  // ── 4) Redondeo ÚNICO, sobre la suma completa (regla 15/16) ─────────────
  const pvp = redondearVenta(aporteHotelTotal + aporteServiciosTotal + aporteVueloTotal, input.moneda);

  return {
    ok: true,
    pvp,
    moneda: input.moneda,
    paxTotal,
    promedioPorViajero: paxTotal > 0 ? Math.round(pvp / paxTotal) : pvp,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Corrección (auditoría DeepSeek, hallazgo A3) — resolución de moneda desde
// los componentes REALES, nunca `pq.moneda ?? "COP"`. Reutiliza la MISMA
// normalización que el generador legado (`app/(dashboard)/dashboard/
// paquetes/actions.ts`, `monedaDe`: cualquier valor que no sea literalmente
// "USD" se toma como COP) — pero, a diferencia del generador (donde la
// columna nunca es null en la práctica), aquí un valor AUSENTE nunca se
// colapsa a COP en silencio: queda `null` y bloquea (regla A3.13/14).
//
// Componentes considerados (regla A3.12): hotel Bernalo (`hoteles.moneda`)
// y servicios incluidos (`servicios_adicionales.moneda`). La "fuente aérea"
// (`bloqueos_vuelo`/`empaquetados`) NO tiene columna de moneda en el
// esquema — el vuelo nunca contribuye ni contradice un signo de moneda,
// exactamente igual que en el generador legado (que tampoco lo valida) —
// esto no es una omisión de esta corrección, es el mismo alcance real de
// los datos disponibles.
// ─────────────────────────────────────────────────────────────────────────

export type CodigoResolucionMonedaBernalo = "moneda_indeterminada" | "moneda_mixta" | "moneda_contradice_paquete";

export type ResultadoResolucionMonedaBernalo =
  | { ok: true; moneda: "COP" | "USD" }
  | { ok: false; codigo: CodigoResolucionMonedaBernalo; mensaje: string };

// `null`/vacío queda `null` (ausencia REAL, nunca COP por defecto). Un
// valor presente se normaliza igual que el generador legado.
function normalizarMonedaExplicita(m: string | null | undefined): "COP" | "USD" | null {
  if (m == null || m.trim() === "") return null;
  return m === "USD" ? "USD" : "COP";
}

/**
 * Resuelve y valida la moneda de la cotización a partir del hotel, los
 * servicios incluidos y (si está configurada) `armado_paquetes.moneda`.
 * Bloquea — nunca aproxima — ante ausencia, mezcla o contradicción. Puro:
 * no consulta ni escribe nada (regla A3.15: "no actualices la base").
 */
export function resolverMonedaComponentesBernalo(
  monedaHotel: string | null,
  monedasServiciosIncluidos: (string | null)[],
  monedaPaquete: string | null
): ResultadoResolucionMonedaBernalo {
  const hotel = normalizarMonedaExplicita(monedaHotel);
  if (hotel == null) {
    return {
      ok: false,
      codigo: "moneda_indeterminada",
      mensaje: "El hotel no tiene una moneda configurada — no se puede cotizar sin inventarla.",
    };
  }

  for (const ms of monedasServiciosIncluidos) {
    const m = normalizarMonedaExplicita(ms);
    if (m == null) {
      return {
        ok: false,
        codigo: "moneda_indeterminada",
        mensaje: "Un servicio incluido no tiene una moneda configurada — no se puede cotizar sin inventarla.",
      };
    }
    if (m !== hotel) {
      return {
        ok: false,
        codigo: "moneda_mixta",
        mensaje: "El hotel y un servicio incluido están en monedas distintas — no se puede componer un solo total.",
      };
    }
  }

  const paquete = normalizarMonedaExplicita(monedaPaquete);
  if (paquete != null && paquete !== hotel) {
    return {
      ok: false,
      codigo: "moneda_contradice_paquete",
      mensaje: "La moneda configurada en el paquete no coincide con la del hotel/servicios.",
    };
  }

  return { ok: true, moneda: hotel };
}
