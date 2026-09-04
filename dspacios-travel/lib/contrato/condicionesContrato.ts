// ─────────────────────────────────────────────────────────────────────────
// Resolver PURO y ÚNICO de las condiciones de pago PERMANENTES de un contrato
// (migración 164, Commit 6). Convierte las filas congeladas de
// `contrato_condiciones` (+ overrides de `restriccion_overrides` si existen)
// en la representación lista para pintar tanto en la UI del dashboard como en
// el PDF del contrato — AMBAS superficies llaman a este mismo módulo, así que
// ninguna fórmula ni texto legal de restricción se duplica entre ellas.
//
// `contrato_condiciones` es PERMANENTE (candado de BD: nunca se actualiza ni
// se recalcula desde catálogos vivos — Commit 5/6). Este módulo no recalcula
// nada: solo TRADUCE el snapshot ya congelado a texto/estructura de
// presentación, igual criterio que `lib/cotizacion/condicionesParaUI.ts` para
// la cotización pre-conversión (de la que este módulo es la contraparte del
// lado del CONTRATO — no lo reemplaza ni lo toca).
//
// Reglas de negocio que materializa (arquitectura del Commit 6):
//   · el monto mínimo exigido y el % informativo YA quedaron congelados por
//     componente — aquí solo se SUMAN/leen, nunca se recalculan.
//   · un componente restringido = no reembolsable Y no endosable, SIEMPRE
//     las dos a la vez (decisión del dueño: no existe un estado intermedio).
//     `promocional_no_reembolsable_no_endosable` y `no_reembolsable_no_endosable`
//     solo distinguen el ORIGEN (tarifa promocional vs. tarifa normal
//     restringida); el efecto sobre el componente es idéntico —
//     `esRestriccionComercial` las trata igual.
//   · mezclar componentes con y sin restricción NUNCA fuerza el 100% del
//     contrato: cada fila lleva su propia condición/monto: un contrato con
//     hotel A al 100% + hotel B al 30% normal se presenta como DOS líneas,
//     nunca como una etiqueta global "100% no reembolsable".
//   · un override AUTORIZADO (superadmin, con motivo, `restriccion_overrides`)
//     hace que la fila deje de mostrarse como restringida EN LA PRESENTACIÓN
//     — pero jamás toca `contrato_condiciones`: el override es un registro
//     aparte, la condición original queda intacta para siempre (candado de
//     BD + este resolver nunca escribe nada).
//   · un contrato histórico (sin filas en `contrato_condiciones`, previo a
//     esta migración) no inventa restricciones: `hayCondiciones=false` y el
//     llamador debe mantener el comportamiento de siempre (sin sección).
// ─────────────────────────────────────────────────────────────────────────

import {
  esRestriccionComercial,
  sumarDias,
  type CondicionTipo,
  type RestriccionComercial,
  type TipoComponente,
} from "../cotizacion/condicionPago.ts";
import {
  fraseCondicion,
  nombreTipoComponente,
  tituloRestriccion,
  textoRestriccion,
  etiquetasRestriccion,
} from "../cotizacion/etiquetasCondicion.ts";

/** Subconjunto plano de una fila de `contrato_condiciones` (permanente). */
export interface FilaCondicionContratoRow {
  id: number;
  orden: number;
  tipo_componente: string;
  referencia_externa: string | null;
  valor_componente: number;
  condicion_pago_tipo: string;
  condicion_pago_pct_aplicable: number | null;
  condicion_pago_dias_saldo: number | null;
  condicion_pago_fecha_limite: string | null;
  monto_exigido: number;
  restriccion_comercial: string;
  moneda: string | null;
  trm: number | null;
}

/** Subconjunto plano de un override de `restriccion_overrides`. */
export interface OverrideContratoRow {
  contrato_condicion_id: number | null;
  restriccion_afectada: string | null;
  motivo: string;
  usuario_email: string | null;
  creado_en: string;
}

export interface OverrideAplicado {
  motivo: string;
  usuarioEmail: string | null;
  fecha: string;
}

/** Una línea del desglose, ya resuelta para presentar. */
export interface LineaCondicionContrato {
  id: number;
  key: string; // orden:tipo — estable para React
  nombreComponente: string;
  referencia: string | null;
  tipoComponente: TipoComponente;
  /** Texto principal de la condición (ej. "Anticipo del 60 %"). */
  condicionTexto: string;
  condicionDetalle: string | null;
  /** Valor del componente (en `moneda`). */
  valor: number;
  /** Monto exigido congelado de esta fila (en `moneda`). */
  exigido: number;
  /** % inicial exigido cuando la condición es anticipo_saldo (0..1). null si no aplica. */
  pctInicial: number | null;
  /** Horizonte de días antes del viaje para el saldo. null si no aplica. */
  diasSaldo: number | null;
  /** Fecha límite del saldo — la guardada en la fila, o derivada de `diasSaldo`
   *  + la fecha de viaje del contrato si se pasó por contexto. null si no se
   *  puede determinar. */
  fechaLimite: string | null;
  /** Moneda y TRM CONGELADAS de esta fila (pueden diferir de la moneda del
   *  contrato solo en teoría; hoy siempre coinciden, se exponen tal cual). */
  moneda: string;
  trm: number | null;
  /** Restricción ORIGINAL congelada (nunca cambia, aunque haya override). */
  restriccion: RestriccionComercial;
  restriccionTitulo: string;
  restriccionTexto: string;
  /** Etiquetas individuales ("No reembolsable", "No endosable") — vacío si `normal`. */
  restriccionEtiquetas: string[];
  /** ¿La fila nació restringida? (antes de cualquier override). */
  esRestringidaOriginal: boolean;
  /** Override vigente sobre esta fila, si superadmin autorizó uno. */
  override: OverrideAplicado | null;
  /** ¿Sigue restringida EN LA PRESENTACIÓN, tras aplicar el override? */
  esRestringidaEfectiva: boolean;
}

export interface ResumenCondicionesContrato {
  /** Suma de `monto_exigido` de todas las filas (moneda del contrato). */
  montoMinimoExigidoTotal: number;
  /** % informativo (monto exigido total / precio de venta del contrato). null
   *  si no se pasó el precio de venta o es ≤ 0. NUNCA es una regla dura: solo
   *  informativo, el monto por componente es lo que manda. */
  pctEfectivoInformativo: number | null;
  /** Frase lista para mostrar, ej. "Pago mínimo requerido: $5.800.000 COP (58 % informativo)". */
  texto: string;
}

export interface CondicionesContratoResueltas {
  /** false = contrato histórico sin snapshot (previo a esta migración): el
   *  llamador NO debe mostrar sección ni inventar restricciones. */
  hayCondiciones: boolean;
  moneda: string;
  /** Todas las filas con monto exigido > 0, en orden. */
  filas: LineaCondicionContrato[];
  /** Solo las filas restringidas EN LA PRESENTACIÓN (tras overrides). Vacío
   *  si ningún componente está restringido — nunca se infiere una restricción
   *  global a partir de que ALGUNA fila lo esté. */
  restringidas: LineaCondicionContrato[];
  /** true si al menos una fila nació restringida (antes de overrides) — para
   *  distinguir "nunca hubo restricción" de "hubo, pero el superadmin ya
   *  autorizó la excepción de todas". */
  huboRestriccionOriginal: boolean;
  resumen: ResumenCondicionesContrato | null;
}

// Uniones válidas (espejo de los CHECK de la migración 164 tras el Commit 6).
const TIPOS_VALIDOS: ReadonlySet<string> = new Set([
  "hotel", "vuelo_bloqueo", "aereo_empaquetado", "servicio", "programa", "paquete",
]);
const CONDICIONES_VALIDAS: ReadonlySet<string> = new Set([
  "sin_condicion", "normal", "pago_total", "anticipo_saldo",
]);
const RESTRICCIONES_VALIDAS: ReadonlySet<string> = new Set([
  "normal", "promocional_no_reembolsable_no_endosable", "no_reembolsable_no_endosable",
]);

function aTipoComponente(s: string): TipoComponente {
  return (TIPOS_VALIDOS.has(s) ? s : "servicio") as TipoComponente;
}
function aCondicionTipo(s: string): CondicionTipo {
  return (CONDICIONES_VALIDAS.has(s) ? s : "normal") as CondicionTipo;
}
function aRestriccion(s: string): RestriccionComercial {
  return (RESTRICCIONES_VALIDAS.has(s) ? s : "normal") as RestriccionComercial;
}

/**
 * Resuelve el snapshot PERMANENTE de un contrato a la forma de presentación.
 *
 * `rows` = filas de `contrato_condiciones` del contrato (cualquier orden).
 * `overrides` = filas de `restriccion_overrides` de ESE contrato (el llamador
 * ya filtró por `numero_contrato`; este módulo no conoce contratos, solo
 * filas). `ctx.precioVenta` = PVP del contrato en su propia moneda, para el %
 * informativo. `ctx.fechaViaje` = fecha de salida del contrato ('YYYY-MM-DD'),
 * usada SOLO para derivar una fecha límite legible cuando la fila trae
 * `diasSaldo` pero no `fechaLimite` guardada (hoy siempre es el caso: el
 * congelado del Commit 4/5 solo persiste el horizonte en días).
 */
export function resolverCondicionesContrato(
  rows: FilaCondicionContratoRow[],
  overrides: OverrideContratoRow[],
  ctx: { monedaContrato: string; precioVenta?: number | null; fechaViaje?: string | null } = { monedaContrato: "COP" },
): CondicionesContratoResueltas {
  if (!rows.length) {
    return {
      hayCondiciones: false,
      moneda: ctx.monedaContrato,
      filas: [],
      restringidas: [],
      huboRestriccionOriginal: false,
      resumen: null,
    };
  }

  // Un override "aplica" a una fila si su contrato_condicion_id coincide. Si
  // hay varios overrides para la misma fila (reintentos/motivos sucesivos), el
  // MÁS RECIENTE por fecha de creación es el vigente en la presentación — cada
  // uno queda igualmente en el histórico de auditoría, solo cambia cuál se
  // muestra como "excepción activa".
  const overridePorCondicion = new Map<number, OverrideContratoRow>();
  for (const o of overrides) {
    if (o.contrato_condicion_id == null) continue;
    const actual = overridePorCondicion.get(o.contrato_condicion_id);
    if (!actual || new Date(o.creado_en).getTime() >= new Date(actual.creado_en).getTime()) {
      overridePorCondicion.set(o.contrato_condicion_id, o);
    }
  }

  const filas: LineaCondicionContrato[] = rows
    .filter((r) => Number(r.monto_exigido) > 0)
    .map((r) => {
      const tipo = aTipoComponente(r.tipo_componente);
      const condicion = aCondicionTipo(r.condicion_pago_tipo);
      const restriccion = aRestriccion(r.restriccion_comercial);
      const frase = fraseCondicion(condicion, {
        pctInicial: r.condicion_pago_pct_aplicable,
        diasSaldo: r.condicion_pago_dias_saldo,
      });
      const diasSaldo = r.condicion_pago_dias_saldo != null ? Math.trunc(r.condicion_pago_dias_saldo) : null;
      const fechaLimite =
        r.condicion_pago_fecha_limite ??
        (diasSaldo != null && diasSaldo > 0 && ctx.fechaViaje ? sumarDias(ctx.fechaViaje, -diasSaldo) : null);
      const esRestringidaOriginal = esRestriccionComercial(restriccion);
      const ov = overridePorCondicion.get(r.id) ?? null;
      const override: OverrideAplicado | null = ov
        ? { motivo: ov.motivo, usuarioEmail: ov.usuario_email, fecha: ov.creado_en }
        : null;
      return {
        id: r.id,
        key: `${r.orden}:${tipo}`,
        nombreComponente: nombreTipoComponente(tipo),
        referencia: r.referencia_externa ?? null,
        tipoComponente: tipo,
        condicionTexto: frase.texto,
        condicionDetalle: frase.detalle,
        valor: Number(r.valor_componente) || 0,
        exigido: Number(r.monto_exigido) || 0,
        pctInicial: r.condicion_pago_pct_aplicable != null ? Number(r.condicion_pago_pct_aplicable) : null,
        diasSaldo,
        fechaLimite,
        moneda: r.moneda ?? ctx.monedaContrato,
        trm: r.trm != null ? Number(r.trm) : null,
        restriccion,
        restriccionTitulo: tituloRestriccion(restriccion),
        restriccionTexto: textoRestriccion(restriccion),
        restriccionEtiquetas: etiquetasRestriccion(restriccion),
        esRestringidaOriginal,
        override,
        // Override vigente → deja de mostrarse como restringida, aunque la
        // fila original (nunca tocada) siga con su restricción congelada.
        esRestringidaEfectiva: esRestringidaOriginal && !override,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  const restringidas = filas.filter((f) => f.esRestringidaEfectiva);
  const huboRestriccionOriginal = filas.some((f) => f.esRestringidaOriginal);

  if (!filas.length) {
    return {
      hayCondiciones: true,
      moneda: ctx.monedaContrato,
      filas: [],
      restringidas: [],
      huboRestriccionOriginal: false,
      resumen: null,
    };
  }

  const montoMinimoExigidoTotal = Math.round(filas.reduce((s, f) => s + f.exigido, 0) * 100) / 100;
  const precioVenta = Number(ctx.precioVenta) || 0;
  const pctEfectivoInformativo =
    precioVenta > 0 ? Math.round((montoMinimoExigidoTotal / precioVenta) * 10_000) / 100 : null;
  const moneda = filas[0]?.moneda ?? ctx.monedaContrato;
  const montoTexto = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(montoMinimoExigidoTotal);
  const texto =
    pctEfectivoInformativo != null
      ? `Pago mínimo requerido: $${montoTexto} ${moneda} (${pctEfectivoInformativo.toFixed(0)} % informativo)`
      : `Pago mínimo requerido: $${montoTexto} ${moneda}`;

  return {
    hayCondiciones: true,
    moneda,
    filas,
    restringidas,
    huboRestriccionOriginal,
    resumen: { montoMinimoExigidoTotal, pctEfectivoInformativo, texto },
  };
}
