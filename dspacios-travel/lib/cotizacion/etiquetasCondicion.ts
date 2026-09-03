// ─────────────────────────────────────────────────────────────────────────
// Etiquetas legibles (UI / documento) para las condiciones de pago por
// componente y las restricciones comerciales. Módulo PURO: sin Supabase, sin
// SQL — solo texto derivado de los tipos/valores ya resueltos por el motor
// (`lib/cotizacion/condicionPago.ts`). Los formatos de moneda van aparte
// (`lib/utils.ts` `formatMoneda`); aquí no se formatea dinero, solo se
// construyen cadenas cortas de "cuánto y cuándo".
//
// Regla de presentación del dueño: nunca exponer el % "normal" configurable
// como una regla dura — es el abono mínimo de la cotización ("primera cuota");
// el desglose por componente y el monto exigido son lo que manda. Estas
// etiquetas son para el documento/panel informativo, no para decidir.
// ─────────────────────────────────────────────────────────────────────────

import {
  esRestriccionComercial,
  type CondicionTipo,
  type RestriccionComercial,
  type TipoComponente,
} from "./condicionPago.ts";

// ── Nombres de componente (para encabezados de desglose) ─────────────────
const NOMBRE_COMPONENTE: Record<TipoComponente, string> = {
  hotel: "Hotel",
  vuelo_bloqueo: "Vuelo de bloqueo",
  aereo_empaquetado: "Tiquete aéreo",
  servicio: "Servicio",
  programa: "Programa",
  paquete: "Paquete",
};

/** Nombre corto y legible de un tipo de componente. */
export function nombreTipoComponente(t: TipoComponente): string {
  return NOMBRE_COMPONENTE[t] ?? "Componente";
}

// ── % formateado (0.5 → "50 %", 1 → "100 %") ─────────────────────────────
function pctLargo(pct: number): string {
  const p = Math.round((Number(pct) || 0) * 100);
  return `${p} %`;
}

// ── Condición de pago → frase corta "cuánto abonar" ──────────────────────
export interface FraseCondicion {
  /** Texto principal, ej. "Pago total al reservar". */
  texto: string;
  /** Texto secundario de horizonte/vencimiento, ej. "Saldo 30 días antes del viaje". */
  detalle: string | null;
  /** Fracción exigida (0..1) — null si la etiqueta no puede determinarla sola. */
  pct: number | null;
}

/**
 * Frase legible de una condición de pago.
 * - `sin_condicion`/`normal` → "Abono mínimo {pctBase}" (default 30 %).
 * - `pago_total`            → "Pago total al reservar".
 * - `anticipo_saldo`        → "Anticipo del {pct} · saldo {diasSaldo} días antes".
 * `pctBase` solo se usa en condiciones neutras para mostrar el abono mínimo;
 * si no se pasa (null), la frase neutra es genérica ("Condición estándar").
 */
export function fraseCondicion(
  tipo: CondicionTipo,
  opts: { pctBase?: number | null; pctInicial?: number | null; diasSaldo?: number | null } = {},
): FraseCondicion {
  switch (tipo) {
    case "pago_total":
      return { texto: "Pago total al reservar", detalle: null, pct: 1 };
    case "anticipo_saldo": {
      const pct = opts.pctInicial != null ? opts.pctInicial : 0.3;
      const dias = opts.diasSaldo != null ? Math.trunc(opts.diasSaldo) : 0;
      const detalle = dias > 0 ? `Saldo ${dias} días antes del viaje` : "Saldo antes del viaje";
      return { texto: `Anticipo del ${pctLargo(pct)}`, detalle, pct };
    }
    case "normal":
    case "sin_condicion": {
      if (opts.pctBase != null) {
        return { texto: `Abono mínimo del ${pctLargo(opts.pctBase)}`, detalle: null, pct: opts.pctBase };
      }
      return { texto: "Condición estándar", detalle: null, pct: null };
    }
  }
}

// ── Restricción comercial → frase para el documento ───────────────────────
// Decisión del dueño: toda restricción comercial es SIEMPRE no reembolsable Y
// no endosable a la vez (nunca una sola de las dos). `promocional_*` solo
// identifica el ORIGEN comercial (tarifa promocional — el caso más frecuente
// de esta restricción); el efecto sobre el componente es idéntico al de
// `no_reembolsable_no_endosable`.
const FRASE_RESTRICCION: Record<RestriccionComercial, { titulo: string; texto: string }> = {
  normal: { titulo: "Sin restricción", texto: "Componente reembolsable y endosable según las condiciones generales." },
  promocional_no_reembolsable_no_endosable: {
    titulo: "Tarifa promocional — no reembolsable y no endosable",
    texto: "Este componente es de tarifa promocional: una vez pagado NO es reembolsable y NO es endosable a otra fecha o pasajero.",
  },
  no_reembolsable_no_endosable: {
    titulo: "No reembolsable y no endosable",
    texto: "Este componente NO es reembolsable y NO es endosable/transferible a otra fecha o pasajero.",
  },
};

/** ¿La restricción vuelve la componente no reembolsable? (todos los valores no-`normal`). */
export function esNoReembolsable(r: RestriccionComercial): boolean {
  return esRestriccionComercial(r);
}

/** Frase corta de restricción (para badge/chips). */
export function tituloRestriccion(r: RestriccionComercial): string {
  return FRASE_RESTRICCION[r]?.titulo ?? "Sin restricción";
}

/** Párrafo de restricción (para el cuerpo del documento/panel). */
export function textoRestriccion(r: RestriccionComercial): string {
  return FRASE_RESTRICCION[r]?.texto ?? FRASE_RESTRICCION.normal.texto;
}

/**
 * Etiquetas INDIVIDUALES de restricción, una por cada restricción que aplica
 * (para pintar dos chips/badges separados: "No reembolsable" + "No
 * endosable"). `normal` no produce ninguna etiqueta; cualquier otro valor
 * produce SIEMPRE ambas — nunca una sola, por decisión del dueño.
 */
export function etiquetasRestriccion(r: RestriccionComercial): string[] {
  return esRestriccionComercial(r) ? ["No reembolsable", "No endosable"] : [];
}
