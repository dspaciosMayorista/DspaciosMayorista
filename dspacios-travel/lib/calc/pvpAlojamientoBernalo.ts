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
// ⚠️ Fase 3F-3 — este archivo DEJÓ de ser la frontera pública en sí misma.
// Hasta 3E, `calcularPvpAlojamientoBernalo` devolvía SOLO lo publicable
// (pvp/moneda/paxTotal/promedioPorViajero) porque era la última parada antes
// del navegador. 3F-3 necesita, del MISMO cálculo, el desglose interno
// (netos por componente, aportes de PVP por separado, la lista resuelta de
// servicios incluidos con su proveedor) para que el servicio autoritativo
// (`lib/reservar/computoReservaBernalo.ts`) pueda construir costos/CxP más
// adelante — sin recalcular la aritmética una segunda vez en otro archivo
// (eso sí sería el defecto que la tarea pide evitar: "no mantengas dos
// implementaciones monetarias"). Por eso el resultado OK ahora INCLUYE ese
// desglose. La frontera pública real es ahora la Server Action
// (`app/tarifario/cotizacionBernaloActions.ts`): es ELLA quien sanitiza a
// las 5 claves públicas de siempre antes de que algo llegue al navegador —
// este módulo ya no es, por sí solo, "lo único que puede viajar hacia el
// navegador". `ResultadoPvpAlojamientoBernalo` sigue siendo un tipo CERRADO
// (nunca un `Omit<>`/passthrough) para que un campo nuevo del motor no se
// cuele aquí sin que alguien lo declare a propósito.
//
// Fuera de alcance de este archivo: consultar Supabase (recibe todo ya
// leído), validar pertenencia hotel/categoría/alimentación al paquete o
// resolver hotel/proveedor/salida (eso vive en
// `lib/reservar/computoReservaBernalo.ts`), impuesto/base comisionable
// contable (Fase 3F, sigue pendiente).
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
  /** Fase 3F-3: proveedor real del catálogo — necesario para la futura CxP del servicio. */
  proveedorId: number | null;
};

// Un servicio incluido YA resuelto (persona o grupo, indistinguible en la
// salida): identidad + costo NETO real + proveedor — lo mínimo que 3F-4
// necesita para generar su CxP sin volver a consultar el catálogo. `moneda`
// NO se resuelve aquí (esta función es pura, sin acceso a la moneda
// "oficial" ya validada del contrato) — la asigna el llamador
// (`computoReservaBernalo.ts`), que ya la tiene como la misma `input.moneda`
// que entra a esta función.
export type ServicioIncluidoResueltoBernalo = {
  servicioId: number;
  nombre: string;
  categoria: CategoriaServicio;
  costoNeto: number;
  proveedorId: number | null;
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

// ── Salida — pvp/moneda/paxTotal/promedioPorViajero son PUBLICABLES tal
// cual (así los sanitiza la Server Action); el resto (desde `paxConSilla`
// hacia abajo) es desglose INTERNO — nunca se reenvía sin pasar por la
// sanitización de `cotizacionBernaloActions.ts` (Fase 3F-3).
export type ResultadoPvpAlojamientoBernaloOk = {
  ok: true;
  pvp: number;
  moneda: string;
  /** Adultos + TODOS los menores (incluidos infantes) de todas las habitaciones. */
  paxTotal: number;
  /** Solo de referencia visual — el total (`pvp`) es la autoridad. */
  promedioPorViajero: number;
  // ── Desde acá, desglose INTERNO (Fase 3F-3) ──────────────────────────
  /** Adultos + menores CON silla (excluye infantes) — usado para el costo/aporte de vuelo. */
  paxConSilla: number;
  /** Costo NETO del hotel = Σ literal de `resultado.totalNeto` por habitación — regla 5, una vez por habitación física. */
  costoHotelTotal: number;
  /** Costo NETO agregado de TODOS los servicios incluidos (persona + grupo) — regla 6, identidad separada del hotel. */
  costoServiciosTotal: number;
  /** Costo NETO del vuelo = costoTiqueteSilla × paxConSilla — regla 7, nunca por paxTotal ni con TA/markup (eso es el aporte de PVP, no el costo). `0` si no hay vuelo. */
  costoVueloTotal: number;
  /** Aporte de PVP del hotel (con markup) — mismo valor que antes se sumaba en silencio dentro de `pvp`. */
  aporteHotelTotal: number;
  /** Aporte de PVP de los servicios incluidos (persona + grupo, con markup). */
  aporteServiciosTotal: number;
  /** Aporte de PVP del vuelo (con markup o TA según `aplicaMk`, × paxConSilla). */
  aporteVueloTotal: number;
  /** Cada servicio incluido YA resuelto (persona y grupo indistinguibles acá) con su costo neto y proveedor real — para la futura CxP (3F-4). */
  serviciosIncluidosResueltos: ServicioIncluidoResueltoBernalo[];
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
  // ── 1) Hotel: una vez por habitación física (regla 5/12) ────────────────
  let aporteHotelTotal = 0;
  let costoHotelTotal = 0;
  let paxTotal = 0;
  let paxConSilla = 0;
  for (const ph of input.resultadoHabitaciones.porHabitacion) {
    aporteHotelTotal += marcar(ph.resultado.totalNeto, input.pctMk);
    costoHotelTotal += ph.resultado.totalNeto;
    const unidad = ph.resultado.datosFuente.distribucion.unidades[0];
    const adultos = unidad?.adultos ?? 0;
    const menoresTotal = ph.resultado.menoresClasificados.length;
    const menoresConSilla = ph.resultado.menoresClasificados.filter((m) => m.categoriaTarifaria !== "infante").length;
    paxTotal += adultos + menoresTotal;
    paxConSilla += adultos + menoresConSilla;
  }

  // ── 2) Servicios incluidos: persona (pax total real) + grupo (una vez) —
  // regla 6: identidad separada del hotel, nunca absorbidos en su costo. ──
  let aporteServiciosTotal = 0;
  let costoServiciosTotal = 0;
  const serviciosIncluidosResueltos: ServicioIncluidoResueltoBernalo[] = [];
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
    costoServiciosTotal += costoNeto;
    serviciosIncluidosResueltos.push({
      servicioId: s.servicioId, nombre: s.nombre, categoria: s.categoria, costoNeto, proveedorId: s.proveedorId,
    });
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
    for (const efectivo of r.servicios) {
      costoServiciosTotal += efectivo.costoNeto;
      serviciosIncluidosResueltos.push({
        servicioId: efectivo.servicioId, nombre: efectivo.nombre, categoria: efectivo.categoria,
        costoNeto: efectivo.costoNeto, proveedorId: efectivo.proveedorId,
      });
    }
  }

  // ── 3) Vuelo: por SILLA real, nunca por habitación (regla 7/14) ─────────
  // Costo NETO (lo que se le debe a la aerolínea): SIEMPRE costoTiqueteSilla
  // × paxConSilla, sin markup ni TA — eso es el aporte de PVP (abajo), otra
  // magnitud. `0` si el paquete no lleva vuelo (porción terrestre).
  const costoVueloTotal = input.vuelo ? input.vuelo.costoTiqueteSilla * paxConSilla : 0;
  const aporteVueloTotal = input.vuelo
    ? aporteVuelo(input.vuelo.costoTiqueteSilla, input.vuelo.aplicaMk, input.pctMk, input.vuelo.ta) * paxConSilla
    : 0;

  // ── 4) Redondeo ÚNICO, sobre la suma completa (regla 8/15/16) ───────────
  const pvp = redondearVenta(aporteHotelTotal + aporteServiciosTotal + aporteVueloTotal, input.moneda);

  return {
    ok: true,
    pvp,
    moneda: input.moneda,
    paxTotal,
    promedioPorViajero: paxTotal > 0 ? Math.round(pvp / paxTotal) : pvp,
    paxConSilla,
    costoHotelTotal,
    costoServiciosTotal,
    costoVueloTotal,
    aporteHotelTotal,
    aporteServiciosTotal,
    aporteVueloTotal,
    serviciosIncluidosResueltos,
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
