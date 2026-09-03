// ─────────────────────────────────────────────────────────────────────────
// Mapeo PURO de las filas congeladas de `cotizacion_condiciones` (y el resumen
// de `cotizaciones`) a la forma que consume el panel presentacional de la UI.
//
// No lee la BD ni formatea moneda (eso lo hace el componente con `formatMoneda`).
// Aquí solo se normalizan los campos `string` libres de la tabla (tipo de
// componente / condición / restricción) a las uniones del motor y se derivan
// las etiquetas legibles vía `lib/cotizacion/etiquetasCondicion.ts`.
//
// El % normal ("abono mínimo de la cotización") no es exigencia por fila — cada
// fila trae su `monto_exigido` congelado. Este módulo no recalcula nada: solo
// presenta el snapshot ya congelado (commit 4/5) y, si no hay snapshot, devuelve
// vacío para que el panel muestre el estado neutro.
// ─────────────────────────────────────────────────────────────────────────
import {
  fraseCondicion,
  nombreTipoComponente,
  tituloRestriccion,
  etiquetasRestriccion,
} from "./etiquetasCondicion.ts";
import { esRestriccionComercial, type CondicionTipo, type RestriccionComercial, type TipoComponente } from "./condicionPago.ts";

/** Subconjunto plano de una fila de `cotizacion_condiciones` (campos string). */
export interface FilaCondicionRowUI {
  orden: number;
  tipo_componente: string;
  referencia_externa: string | null;
  valor_componente: number;
  condicion_pago_tipo: string;
  condicion_pago_pct_aplicable: number | null;
  condicion_pago_dias_saldo: number | null;
  monto_exigido: number;
  restriccion_comercial: string;
}

/** Fila ya etiquetada para el panel. */
export interface LineaCondicionUI {
  key: string; // orden:tipo — estable para React
  nombreComponente: string;
  referencia: string | null;
  /** Texto principal de la condición (ej. "Anticipo del 60 %"). */
  condicionTexto: string;
  condicionDetalle: string | null;
  restriccion: RestriccionComercial;
  restriccionTitulo: string;
  /** Etiquetas individuales ("No reembolsable", "No endosable") — vacío si `normal`. */
  restriccionEtiquetas: string[];
  esRestringida: boolean;
  /** Valor del componente (moneda de la cotización). */
  valor: number;
  /** Monto exigido congelado de esta fila (moneda de la cotización). */
  exigido: number;
}

export interface CondicionesParaUI {
  filas: LineaCondicionUI[];
  /** Suma de `monto_exigido` en moneda. null si no hay filas. */
  totalExigidoMoneda: number | null;
}

// Uniones del motor (espejo de los CHECK de la migración 164).
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

/** Convierte las filas congeladas en líneas etiquetadas (una pasada, puro). */
export function condicionesParaUI(rows: FilaCondicionRowUI[]): CondicionesParaUI {
  const filas: LineaCondicionUI[] = rows
    .filter((r) => r && Number(r.monto_exigido) > 0)
    .map((r) => {
      const tipo = aTipoComponente(r.tipo_componente);
      const condicion = aCondicionTipo(r.condicion_pago_tipo);
      const restriccion = aRestriccion(r.restriccion_comercial);
      const frase = fraseCondicion(condicion, {
        pctInicial: r.condicion_pago_pct_aplicable,
        diasSaldo: r.condicion_pago_dias_saldo,
      });
      return {
        key: `${r.orden}:${tipo}`,
        nombreComponente: nombreTipoComponente(tipo),
        referencia: r.referencia_externa ?? null,
        condicionTexto: frase.texto,
        condicionDetalle: frase.detalle,
        restriccion,
        restriccionTitulo: tituloRestriccion(restriccion),
        restriccionEtiquetas: etiquetasRestriccion(restriccion),
        esRestringida: esRestriccionComercial(restriccion),
        valor: Number(r.valor_componente) || 0,
        exigido: Number(r.monto_exigido) || 0,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
  const totalExigidoMoneda = filas.length
    ? Math.round(filas.reduce((s, f) => s + f.exigido, 0) * 100) / 100
    : null;
  return { filas, totalExigidoMoneda };
}
