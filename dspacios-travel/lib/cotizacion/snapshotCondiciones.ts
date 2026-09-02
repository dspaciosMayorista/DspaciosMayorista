// ─────────────────────────────────────────────────────────────────────────
// Snapshot de condiciones de pago por componente de una cotización.
//
// Dado el conjunto de componentes YA resueltos de una cotización (hoteles con
// su condición por vigencia ya elegida, vuelos, servicios/tours, programas,
// paquetes) produce, de forma determinista y sin tocar la BD:
//   · las filas `cotizacion_condiciones` (una por componente) listas para
//     insertar, y
//   · el resumen agregado que se escribe en `cotizaciones`
//     (monto_exigido_total / monto_exigido_total_cop / pct_efectivo_informativo).
//
// Este módulo ES el cálculo; la UI (vitrina/panel/documento) y el congelado
// (primer pago / conversión) lo reutilizan. El motor puro (la matemática de
// exigencia y el desglose) vive en `lib/cotizacion/condicionPago.ts`; aquí solo
// se transforma su salida al molde de las tablas 164 y se resuelve el caso del
// HOTEL que cruza vigencias por noches.
//
// Decisiones de negocio que materializa (correcciones del dueño):
//   · HOTEL: si la estadía cruza vigencias se evalúan TODAS las noches y se
//     aplica la condición MÁS exigente de las presentes (exigenciaHotel).
//   · aéreo empaquetado = 100% de su propio valor (lo impone el motor).
//   · monto exigido por componente se redondea aquí (TS), nunca en SQL.
//   · la moneda es la de la cotización; la comparación COP vs COP la hace el
//     guard con trm_autoritativa.
//
// El desglose va congelado en `cotizacion_condiciones` con un `monto_exigido`
// por componente, de modo que una vez congelada la cotización el valor NO se
// vuelve a calcular (el trigger 164 bloquea alterar las filas congeladas).
// ─────────────────────────────────────────────────────────────────────────

import {
  formulaPagoMinimo,
  exigenciaHotel,
  pctNormalDeTipo,
  hoy,
  type ComponenteACondicionar,
  type CondicionCompuesta,
  type CondicionTipo,
  type RestriccionComercial,
  type TipoComponente,
  type Exigencia,
} from "./condicionPago.ts";

// ── Tipos de origen (misma semántica que las tablas 164) ──────────────────

/** Vigencia/temporada de hotel con su condición declarada y su rango de fechas. */
export interface VigenciaHotelCondicion extends CondicionCompuesta {
  /** id real de hotel_temporadas (para `cotizacion_condiciones.hotel_temporada_id`). */
  hotelTemporadaId: number | null;
  /** etiqueta legible (nombre de la temporada). */
  nombre: string;
  fechaInicio: string; // 'YYYY-MM-DD' (checkin mínimo)
  fechaFin: string; // 'YYYY-MM-DD' (checkout máximo; la noche entra si fecha < fechaFin)
  /** restricción comercial de ESTA temporada (mig 164, `hotel_temporadas.restriccion_comercial`). */
  restriccionComercial?: RestriccionComercial;
}

/** Componente ya resuelto que se va a condicionar. Reutiliza el motor puro. */
export type ComponenteSnapshot = ComponenteACondicionar & {
  /** etiqueta legible para el documento/desglose. */
  referencia?: string | null;
  /** restricción comercial del componente origen (hotel/temporada/programa/paquete). */
  restriccionComercial?: RestriccionComercial;
};

// ── Auto-etiqueta del hotel "contiene restricciones en algunas fechas" ─────
// Corrección del dueño: en el listado/detalle de un hotel la app debe mostrar
// un aviso si el hotel tiene TEMPORADAS RESTRINGIDAS dentro del rango que se
// está cotizando — derivado de las vigencias reales (con su rango de fechas),
// en UNA pasada plana, SIN consultas N+1 (no pedir una por noche/fecha).

/** Resultado de barrer una estadía contra las vigencias restringidas del hotel. */
export interface BarridoRestriccionEstadia {
  /** True si ALGUNA noche de la estadía cae en una vigencia restringida. */
  tocaRestriccion: boolean;
  /** Etiquetas de las temporadas restringidas que tocan la estadía (sin duplicar). */
  temporadasRestringidas: string[];
  /** Lista de fechas 'YYYY-MM-DD' de entrada (noches) restringidas. */
  fechasRestringidas: string[];
}

/**
 * Dado el rango de la estadía [fechaIda, fechaRegreso) y la lista PLANTA de
 * vigencias del hotel (cada una con su `restriccionComercial` y rango), deriva
 * en una sola pasada por noches cuáles caen en una temporada restringida.
 *
 * `esRestringida` se pasa para no acoplar este módulo a la semántica exacta de
 * `RestriccionComercial` (la etiqueta `normal` = sin restricción).
 */
export function barridoRestriccionEstadia(
  estadia: { fechaIda: string; fechaRegreso: string },
  vigencias: VigenciaHotelCondicion[],
  esRestringida: (r: RestriccionComercial | undefined) => boolean = (r) =>
    r !== undefined && r !== "normal",
): BarridoRestriccionEstadia {
  const restringidas = vigencias.filter((v) => esRestringida(v.restriccionComercial));
  if (!estadia.fechaIda || !estadia.fechaRegreso || restringidas.length === 0) {
    return { tocaRestriccion: false, temporadasRestringidas: [], fechasRestringidas: [] };
  }
  const noches = nochesEntre(estadia.fechaIda, estadia.fechaRegreso);
  const fechas = noches.length ? noches : [estadia.fechaIda];
  const fechasRestringidas: string[] = [];
  const temporadas = new Set<string>();
  for (const noche of fechas) {
    for (const v of restringidas) {
      if (vigenciaCubreFecha(v, noche)) {
        if (!fechasRestringidas.includes(noche)) fechasRestringidas.push(noche);
        temporadas.add(v.nombre);
      }
    }
  }
  return {
    tocaRestriccion: fechasRestringidas.length > 0,
    temporadasRestringidas: [...temporadas],
    fechasRestringidas,
  };
}

// ── Resolución del HOTEL que cruza vigencias por noches ────────────────────
//
// El motor de precios ya decide qué temporada "pinta" cada noche. Este módulo
// NO repite esa decisión: recibe, por cada noche de la estadía [checkin,
// checkout), la lista de vigencias vigentes esa noche y reduce con la MÁS
// exigente — igual que `exigenciaHotel` del motor, pero anclado a un checkin.

/** ¿`fecha` (una noche) cae dentro de la vigencia [inicio, fin)? la noche entra
 *  si es >= fechaInicio y < fechaFin. */
export function vigenciaCubreFecha(v: { fechaInicio: string; fechaFin: string }, fecha: string): boolean {
  return fecha >= v.fechaInicio && fecha < v.fechaFin;
}

/** Enlista las noches [desde, hasta) como fechas 'YYYY-MM-DD'. */
export function nochesEntre(desde: string, hasta: string): string[] {
  const out: string[] = [];
  let d = desde;
  // cota de seguridad: nunca más de 366 noches
  for (let i = 0; i < 366 && d < hasta; i++) {
    out.push(d);
    const [y, m, dd] = d.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, dd) + 86_400_000).toISOString().slice(0, 10);
    d = next;
  }
  return out;
}

/**
 * Reduce una estadía de hotel a UNA condición exigible. `fechaViaje` = checkin.
 * Para cada noche busca la(s) vigencia(s) que la cubren y acumula sus
 * condiciones; al final aplica la más exigente con el criterio del motor.
 */
export function condicionHotelEstadia(
  estadia: { fechaIda: string; fechaRegreso: string },
  vigencias: VigenciaHotelCondicion[],
  s: { fechaPago?: string; pctBase?: number },
): Exigencia {
  const fechaPago = s.fechaPago ?? hoy();
  const pctBase = s.pctBase ?? pctNormalDeTipo("hotel");
  if (!estadia.fechaIda || !estadia.fechaRegreso || vigencias.length === 0) {
    // sin vigencias → condición neutra (sin_condicion → % normal)
    return exigenciaHotel([], { fechaViaje: estadia.fechaIda || fechaPago, fechaPago, pctBase });
  }
  // si no hay noches válidas, asume al menos el checkin
  const noches = nochesEntre(estadia.fechaIda, estadia.fechaRegreso);
  const fechas = noches.length ? noches : [estadia.fechaIda];
  // condiciones presentes en cualquier noche (sin amplificar por repetición)
  const presentes = new Map<string, CondicionCompuesta>();
  for (const noche of fechas) {
    for (const v of vigencias) {
      if (vigenciaCubreFecha(v, noche)) {
        const key = `${v.tipo}|${v.pctInicial ?? ""}|${v.diasSaldo ?? ""}`;
        if (!presentes.has(key)) presentes.set(key, { tipo: v.tipo, pctInicial: v.pctInicial, diasSaldo: v.diasSaldo });
      }
    }
  }
  // si ninguna noche cayó en una vigencia (huecos/blackouts) → neutra
  if (presentes.size === 0) {
    return exigenciaHotel([], { fechaViaje: estadia.fechaIda, fechaPago, pctBase });
  }
  return exigenciaHotel([...presentes.values()], { fechaViaje: estadia.fechaIda, fechaPago, pctBase });
}

// ── Construcción de filas + agregados ──────────────────────────────────────

/** Una fila lista para `cotizacion_condiciones`. */
export interface FilaCondicionSnapshot {
  tipo_componente: TipoComponente;
  referencia_externa: string | null;
  orden: number;
  valor_componente: number;
  condicion_pago_tipo: CondicionTipo;
  condicion_pago_pct_aplicable: number | null;
  condicion_pago_dias_saldo: number | null;
  condicion_pago_fecha_limite: string | null;
  monto_exigido: number;
  restriccion_comercial: RestriccionComercial;
  hotel_temporada_id: number | null;
}

/** Resumen agregado a escribir en `cotizaciones`. */
export interface ResumenCondiciones {
  monto_exigido_total: number; // moneda de la cotización
  monto_exigido_total_cop: number;
  pct_efectivo_informativo: number | null; // solo informativo (0..100)
}

export interface ResultadoSnapshot {
  filas: FilaCondicionSnapshot[];
  resumen: ResumenCondiciones;
}

/**
 * Construye el snapshot de una cotización a partir de sus componentes ya
 * resueltos. Para HOTELES el llamador resuelve la condición de la estadía con
 * `condicionHotelEstadia` (o deja la condición cruda y usa una sola vigencia);
 * para el resto pasa su condición directa (o null → % normal).
 *
 * `comps` = componentes (valor en la moneda de la cotización). `trm` = la TRM
 * autoritativa congelada (COP→1). Devuelve filas ordenadas + agregados.
 */
export function construirSnapshot(
  comps: ComponenteSnapshot[],
  ctx: { fechaPago?: string; precioTotalMoneda: number; trm?: number },
): ResultadoSnapshot {
  const fechaPago = ctx.fechaPago ?? hoy();
  const trm = ctx.trm && ctx.trm > 0 ? ctx.trm : 1;

  // Normaliza cada componente a una condición exigible + monto (el motor puro).
  const aportes = comps.map((c, i) => {
    // El motor puro ya resuelve la exigencia; para el HOTEL el llamador debió
    // pasar la condición de la estadía ya reducida (condicionHotelEstadia). Si
    // viene una condición cruda de hotel la tratamos como una sola condición.
    const fila: FilaCondicionSnapshot = {
      tipo_componente: c.tipo,
      referencia_externa: c.referencia ?? null,
      orden: i,
      valor_componente: Math.round((Number(c.valor) || 0) * 100) / 100,
      condicion_pago_tipo: (c.condicion?.tipo ?? (c.tipo === "hotel" ? "sin_condicion" : "normal")) as CondicionTipo,
      condicion_pago_pct_aplicable: c.condicion?.pctInicial ?? null,
      condicion_pago_dias_saldo: c.condicion?.diasSaldo ?? null,
      condicion_pago_fecha_limite: null,
      monto_exigido: 0, // se rellena abajo
      restriccion_comercial: c.restriccionComercial ?? "normal",
      hotel_temporada_id: null,
    };
    return { c, fila };
  });

  // Precio total en moneda y desglose autoritativo vía el motor puro.
  const compsMotor: ComponenteACondicionar[] = comps.map((c) => ({
    id: c.id,
    tipo: c.tipo,
    valor: c.valor,
    condicion: c.condicion,
    fechaViaje: c.fechaViaje,
  }));
  const f = formulaPagoMinimo(compsMotor, {
    fechaPago,
    precioTotalMoneda: ctx.precioTotalMoneda,
    trm,
  });

  // Une el desglose del motor (monto por id) a las filas, en orden.
  const porId = new Map<string, number>();
  for (const l of f.desglose) porId.set(l.id, l.montoExigidoMoneda);
  const filas = aportes.map(({ c, fila }) => {
    const exigido = porId.get(c.id) ?? 0;
    fila.monto_exigido = exigido;
    // fecha límite informativa: si la condición es anticipo_saldo con días,
    // hoy no alcanza para calcular el límite real sin saber fecha de pago;
    // se deja el horizonte en días (dias_saldo) y la UI lo interpreta.
    return fila;
  });

  return {
    filas,
    resumen: {
      monto_exigido_total: f.montoExigidoTotalMoneda,
      monto_exigido_total_cop: f.montoExigidoTotalCop,
      pct_efectivo_informativo: f.pctEfectivoInformativo,
    },
  };
}

// Re-exportar tipos útiles para los llamadores (UI / servidor).
export type { CondicionCompuesta, CondicionTipo, TipoComponente, RestriccionComercial, Exigencia };
