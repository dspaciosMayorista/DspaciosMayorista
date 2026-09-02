// ─────────────────────────────────────────────────────────────────────────
// Motor PURO de "condiciones de pago por componente".
//
// Es la única fuente de verdad para la matemática de exigencia de pago de una
// cotización (hoteles/vuelos/servicios/programas/paquetes). Nada de SQL ni de
// Supabase aquí: todo es determinista y testeable, igual que `calcCostos`/
// `calcComision`. Los valores "congelados" de una cotización se derivan con
// estas funciones en el momento del PRIMER pago previo y ya no se recalculan.
//
// Reglas de negocio que materializa (documento de arquitectura "condiciones
// de pago por componente" + correcciones del dueño):
//   · aéreo empaquetado exige SIEMPRE el 100% de SU propio valor (nunca se
//     traslada a las demás componentes).
//   · vuelo de bloqueo / servicios usan su % configurable "normal".
//   · un hotel con pago_total exige 100%; con anticipo_saldo exige su
//     pct_inicial, salvo que hoy esté dentro de los últimos `dias_saldo`
//     antes del viaje → ahí exige 100% (bump de cierre).
//   · una estadía que cruza vigencias se evalúa en TODAS las noches y aplica
//     la condición MÁS exigente de las presentes.
//   · dos hoteles con condiciones distintas: se calcula CADA componente y se
//     SUMA el monto exigido (el ejemplo del dueño: hotel A 100% + hotel B 30%
//     normal; si suman $5.800.000 sobre un contrato de $10.000.000, el 58% es
//     solo informativo — el MONTO exigido es lo que manda la conversión).
//   · el desglose es por componente; el % efectivo global es solo informativo.
//
// Las fechas viajan como 'YYYY-MM-DD' (texto puro, sin huso) para que el motor
// sea determinista y no dependa de la zona horaria del servidor.
// ─────────────────────────────────────────────────────────────────────────

export type CondicionTipoHotel = "sin_condicion" | "pago_total" | "anticipo_saldo";
export type CondicionTipoProducto = "normal" | "pago_total" | "anticipo_saldo";
export type CondicionTipo = CondicionTipoHotel | CondicionTipoProducto;
export type RestriccionComercial = "normal" | "promocional_no_reembolsable";

export type TipoComponente =
  | "hotel"
  | "vuelo_bloqueo"
  | "aereo_empaquetado"
  | "servicio"
  | "programa"
  | "paquete";

/** Condición declarada de UNA componente (en origen: temporada/programa/paquete). */
export interface CondicionCompuesta {
  tipo: CondicionTipo;
  /** % inicial exigido cuando `tipo = anticipo_saldo` (0..1, ej. 0.5 = 50%). */
  pctInicial: number | null;
  /** días antes del viaje para abonar el saldo cuando `tipo = anticipo_saldo`. */
  diasSaldo: number | null;
}

/** Exigencia ya resuelta a un % y un horizonte de días (para comparar/derivar). */
export interface Exigencia {
  pct: number; // 0..1 — fracción exigida de la componente a día de hoy
  diasSaldo: number | null; // horizonte (para desempatar; 100% no tiene horizonte)
  tipo: CondicionTipo;
  pctInicial: number | null;
}

export const NEUTRAL_HOTEL: CondicionTipo = "sin_condicion";
export const NEUTRAL_PRODUCTO: CondicionTipo = "normal";

// Las únicas componentes sin % configurable: aéreo empaquetado exige 100% propio.
export const COMPONENTES_PAGO_TOTAL_FIJO: ReadonlySet<TipoComponente> = new Set<TipoComponente>([
  "aereo_empaquetado",
]);

export function esNeutra(tipo: CondicionTipo): boolean {
  return tipo === "sin_condicion" || tipo === "normal";
}

// ─────────────────────────────────────────────────────────────────────────
// Fechas (texto 'YYYY-MM-DD', aritmética en días UTC) — deterministas.
// ─────────────────────────────────────────────────────────────────────────
function partes(fecha: string): { y: number; m: number; d: number } {
  const [y, m, d] = fecha.split("-").map(Number);
  return { y, m, d };
}
function aDias(fecha: string): number {
  const { y, m, d } = partes(fecha);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}
export function hoy() {
  // Fecha local en UTC (texto puro). No se usa en el motor salvo como default;
  // las acciones de servidor siempre pasan la fecha de pago explícita.
  return new Date().toISOString().slice(0, 10);
}
export function sumarDias(fecha: string, n: number): string {
  const { y, m, d } = partes(fecha);
  const utc = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return utc.toISOString().slice(0, 10);
}
export function fechaMayorQue(a: string, b: string): boolean {
  return aDias(a) > aDias(b);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

// ─────────────────────────────────────────────────────────────────────────
// pctAplicable de UNA condición aislada.
//
// `fechaViaje` = fecha del servicio que arranca (checkin del hotel / fecha del
// vuelo). `fechaPago` = "hoy". `pctBase` = % normal configurable de la
// componente (config_cobros_componente) cuando la condición es neutra.
// ─────────────────────────────────────────────────────────────────────────
export function pctAplicable(
  cond: CondicionCompuesta,
  s: { fechaViaje: string; fechaPago: string; pctBase: number },
): Exigencia {
  const tipo = cond.tipo;
  // aéreo empaquetado / pago_total: 100% siempre.
  if (tipo === "pago_total") {
    return { pct: 1, diasSaldo: null, tipo, pctInicial: null };
  }
  if (tipo === "anticipo_saldo") {
    const pctInicial = clamp01(cond.pctInicial ?? 0);
    const dias = Math.max(0, Math.trunc(cond.diasSaldo ?? 0) || 0);
    // Bump de cierre (C9): dentro de los últimos `dias` días antes del viaje
    // ya no se acepta el saldo → se exige el total de esta componente.
    const limite = sumarDias(s.fechaViaje, -dias);
    if (fechaMayorQue(s.fechaPago, limite)) {
      return { pct: 1, diasSaldo: dias, tipo, pctInicial };
    }
    return { pct: pctInicial, diasSaldo: dias, tipo, pctInicial };
  }
  // Neutra (sin_condicion / normal) → % normal configurable de la componente.
  return { pct: clamp01(s.pctBase), diasSaldo: null, tipo, pctInicial: null };
}

// Ordena por exigencia: gana el % mayor; a igual %, el que exige saldo más
// temprano (mayor diasSaldo). >0 → `a` es más exigente.
function compararExigencia(a: Exigencia, b: Exigencia): number {
  if (Math.abs(a.pct - b.pct) > 1e-9) return a.pct - b.pct;
  return (a.diasSaldo ?? 0) - (b.diasSaldo ?? 0);
}
export function masExigente(a: Exigencia, b: Exigencia): Exigencia {
  return compararExigencia(a, b) >= 0 ? a : b;
}

// ─────────────────────────────────────────────────────────────────────────
// HOTEL que cruza vigencias: el dueño da una condición POR temporada. Si la
// estadía toca varias, se evalúan TODAS las condiciones presentes en las
// noches [checkin, checkout) y se aplica la MÁS exigente (corrección #7).
//
// `condicionesPorNoche`: una condición por cada noche de la estadía, ya
// resueltas por el llamador con el MISMO criterio que el motor de precios
// (qué temporada está vigente para cada noche). El motor solo reduce con max
// — no decide cuál temporada pinta una noche, para no duplicar esa lógica.
// `fechaViaje` = checkin (ancla del bump de `dias_saldo`).
// ─────────────────────────────────────────────────────────────────────────
export function exigenciaHotel(
  condicionesPorNoche: CondicionCompuesta[],
  s: { fechaViaje: string; fechaPago: string; pctBase: number },
): Exigencia {
  if (!condicionesPorNoche.length) {
    return pctAplicable({ tipo: NEUTRAL_HOTEL, pctInicial: null, diasSaldo: null }, s);
  }
  // Condiciones DISTINTAS presentes (el max es asociativo: repetir una misma
  // condición varias noches no debe amplificar la exigencia).
  const vistas = new Map<string, CondicionCompuesta>();
  for (const c of condicionesPorNoche) {
    const key = `${c.tipo}|${c.pctInicial ?? ""}|${c.diasSaldo ?? ""}`;
    if (!vistas.has(key)) vistas.set(key, c);
  }
  let best = pctAplicable(
    { tipo: NEUTRAL_HOTEL, pctInicial: null, diasSaldo: null },
    { fechaViaje: s.fechaViaje, fechaPago: s.fechaPago, pctBase: s.pctBase },
  );
  for (const c of vistas.values()) {
    best = masExigente(best, pctAplicable(c, s));
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────
// Monto exigido de una componente = redondeo a 2 decimales de valor×pct.
// (El motor hace el redondeo; NUNCA lo genera SQL — la moneda y el redondeo
// viven aquí, en TypeScript.)
// ─────────────────────────────────────────────────────────────────────────
export function montoExigidoComponente(valor: number, pct: number): number {
  const v = Number(valor) || 0;
  if (v <= 0) return 0;
  return Math.round(v * clamp01(pct) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────
// fórmulaPagoMinimo — desglose por componente de una cotización.
//
// `comps` = componentes del carrito con su condición declarada y su valor en
// la moneda de la cotización. `precioTotalMoneda` = precio de venta en esa
// misma moneda. `trm` = trm_autoritativa congelada (COP→1).
//
// Devuelve: desglose, monto exigido total en moneda, monto exigido total en
// COP y el % efectivo INFORMATIVO (monto exigido / precio total) — ese % solo
// se muestra, la conversión la manda el MONTO en COP.
// ─────────────────────────────────────────────────────────────────────────
export interface ComponenteACondicionar {
  /** clave estable de la componente (id de temporada/programa/paquete, etc.) */
  id: string;
  tipo: TipoComponente;
  valor: number; // en la moneda de la cotización
  condicion: CondicionCompuesta | null; // null → usa su % normal (basePct)
  /** ancla del bump de dias_saldo (checkin/fecha de vuelo). Default: fechaPago. */
  fechaViaje?: string | null;
}

export interface LineaExigida {
  id: string;
  tipo: TipoComponente;
  valor: number;
  pct: number;
  montoExigidoMoneda: number;
}

export interface FormulaPagoMinimo {
  desglose: LineaExigida[];
  montoExigidoTotalMoneda: number;
  /** % efectivo informativo (monto exigido total / precio total). null si precio ≤ 0. */
  pctEfectivoInformativo: number | null;
  montoExigidoTotalCop: number;
}

export function formulaPagoMinimo(
  comps: ComponenteACondicionar[],
  s: { fechaPago: string; precioTotalMoneda: number; trm: number },
): FormulaPagoMinimo {
  const desglose: LineaExigida[] = [];
  for (const c of comps) {
    let exigencia: Exigencia;
    if (COMPONENTES_PAGO_TOTAL_FIJO.has(c.tipo)) {
      // aéreo empaquetado: 100% de SU PROPIO valor.
      exigencia = { pct: 1, diasSaldo: null, tipo: "pago_total", pctInicial: null };
    } else if (c.condicion) {
      const pctBase = pctNormalDeTipo(c.tipo);
      exigencia = pctAplicable(c.condicion, {
        fechaViaje: c.fechaViaje || s.fechaPago,
        fechaPago: s.fechaPago,
        pctBase,
      });
    } else {
      // Sin condición propia → % normal configurable del tipo.
      const pctBase = pctNormalDeTipo(c.tipo);
      exigencia = pctAplicable(
        { tipo: neutroDeTipo(c.tipo), pctInicial: null, diasSaldo: null },
        { fechaViaje: c.fechaViaje || s.fechaPago, fechaPago: s.fechaPago, pctBase },
      );
    }
    const monto = montoExigidoComponente(c.valor, exigencia.pct);
    desglose.push({
      id: c.id,
      tipo: c.tipo,
      valor: c.valor,
      pct: exigencia.pct,
      montoExigidoMoneda: monto,
    });
  }
  const montoExigidoTotalMoneda = Math.round(desglose.reduce((a, l) => a + l.montoExigidoMoneda, 0) * 100) / 100;
  const precioTotal = Number(s.precioTotalMoneda) || 0;
  const pctInformativo =
    precioTotal > 0 ? Math.round((montoExigidoTotalMoneda / precioTotal) * 10_000) / 100 : null; // en % (58.00)
  const trm = Number(s.trm) > 0 ? Number(s.trm) : 1;
  const montoExigidoTotalCop = Math.round(montoExigidoTotalMoneda * trm * 100) / 100;
  return {
    desglose,
    montoExigidoTotalMoneda,
    pctEfectivoInformativo: pctInformativo,
    montoExigidoTotalCop,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Suficiencia y guard de sobrepago — SIEMPRE COP vs COP (corrección #10/#14,
// nunca comparar monto_cop contra un total que no esté en COP).
// ─────────────────────────────────────────────────────────────────────────
export function suficienteParaConvertir(
  sumaPagosPreviosCop: number,
  montoExigidoTotalCop: number,
): boolean {
  return (Number(sumaPagosPreviosCop) || 0) >= (Number(montoExigidoTotalCop) || 0) - 0.005;
}

/** ¿Se permite registrar un pago previo de `nuevoCop`? Nunca sobrepasar el
 *  precio total del contrato (en COP) con los pagos ya activos/aplicados. */
export function permiteNuevoPago(
  sumaPagosPreviosCop: number,
  precioTotalCop: number,
  nuevoCop: number,
): boolean {
  return (Number(sumaPagosPreviosCop) || 0) + (Number(nuevoCop) || 0) <=
    (Number(precioTotalCop) || 0) + 0.005;
}

// ─────────────────────────────────────────────────────────────────────────
// Defaults por tipo de componente (% normal configurable). En runtime estos
// vienen de `config_cobros_componente`; estas constantes son el respaldo puro
// usado por la UI/vitrina (mismo 0.30 que sembraba `config_cobros`).
// ─────────────────────────────────────────────────────────────────────────
export const PCT_NORMAL_POR_TIPO: Record<TipoComponente, number> = {
  hotel: 0.3,
  vuelo_bloqueo: 0.3,
  aereo_empaquetado: 1, // nunca se usa como base (su tipo cae en PAGO_TOTAL_FIJO)
  servicio: 0.3,
  programa: 0.3,
  paquete: 0.3,
};
export function pctNormalDeTipo(tipo: TipoComponente): number {
  return PCT_NORMAL_POR_TIPO[tipo] ?? 0.3;
}
function neutroDeTipo(tipo: TipoComponente): CondicionTipo {
  return tipo === "hotel" ? NEUTRAL_HOTEL : NEUTRAL_PRODUCTO;
}
