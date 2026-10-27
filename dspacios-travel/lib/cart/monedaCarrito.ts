// ─────────────────────────────────────────────────────────────────────────
// Moneda de los importes del carrito (presentación). Un carrito puede tener
// hoteles/servicios en COP y en USD: nunca se suman en un solo total ni se
// calcula una sola comisión sobre esa mezcla.
//
// Ítems antiguos de localStorage: el hotel por persona no guardaba su moneda
// (y algunos tours tampoco). No se adivina: `monedaDeItem` devuelve `null`
// ("por confirmar") y el importe se muestra sin símbolo de moneda. El
// servidor la confirma al generar la cotización, como siempre.
//
// `preverCotizacion` ANTICIPA, solo para explicarlo antes de enviar, lo que
// hace `crearCotizacionCarrito` (app/tarifario/checkout/actions.ts) con un
// carrito de varias monedas — no decide nada: el servidor sigue siendo la
// autoridad (re-liquida, excluye o rechaza). Regla que refleja:
//   · el orden de la solicitud es hoteles por persona, hoteles por unidad y
//     luego servicios (checkout/page.tsx);
//   · la moneda de la cotización es la del PRIMER hotel: un hotel se incluye
//     o hace fallar la solicitud, nunca se salta;
//   · SIN hoteles, la fija el primer servicio que siga disponible al
//     re-liquidar — uno no disponible se excluye antes de fijarla, y eso el
//     cliente no lo puede saber. Solo se anticipa si TODOS los servicios
//     comparten una moneda conocida; si no, queda en manos del servidor;
//   · un hotel en otra moneda se excluye — salvo que tenga servicios
//     vinculados: entonces la solicitud completa se rechaza;
//   · un servicio independiente en otra moneda se excluye.
//
// Módulo PURO (sin React): se prueba directo con `node --test`.
// ─────────────────────────────────────────────────────────────────────────
import { formatMoneda } from "@/lib/utils";

type ItemMoneda = {
  id: string;
  tipo: string;
  precio: number;
  moneda?: string | null;
  modeloTarifario?: string | null;
  hotelItemId?: string | null;
  hotelNombre?: string;
  nombre?: string;
};

/** Moneda del importe de un ítem en mayúsculas, o `null` si el ítem no la
 * trae (carrito guardado antes de registrarla). */
export function monedaDeItem(it: { moneda?: string | null }): string | null {
  const m = typeof it.moneda === "string" ? it.moneda.trim().toUpperCase() : "";
  return m ? m : null;
}

const formatoSinMoneda = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

/** Importe para mostrar: en su moneda, o sin símbolo si es desconocida. */
export function formatImporte(monto: number, moneda: string | null): string {
  return moneda ? formatMoneda(monto, moneda) : `${formatoSinMoneda.format(monto)} · moneda por confirmar`;
}

export type SubtotalMoneda = { moneda: string; monto: number; items: number };

export type ResumenMonedas = {
  /** Un subtotal por moneda conocida, en el orden en que aparecen en el carrito. */
  subtotales: SubtotalMoneda[];
  /** Ítems sin moneda registrada (no entran a ningún subtotal). */
  sinMoneda: number;
  /** Total único SOLO si todos los ítems comparten una moneda conocida. */
  unica: { moneda: string; monto: number } | null;
};

export function resumirMonedas(items: readonly ItemMoneda[]): ResumenMonedas {
  const subtotales: SubtotalMoneda[] = [];
  let sinMoneda = 0;
  for (const it of items) {
    const m = monedaDeItem(it);
    if (!m) { sinMoneda++; continue; }
    const s = subtotales.find((x) => x.moneda === m);
    if (s) { s.monto += it.precio; s.items++; } else subtotales.push({ moneda: m, monto: it.precio, items: 1 });
  }
  const unica = subtotales.length === 1 && sinMoneda === 0 ? { moneda: subtotales[0].moneda, monto: subtotales[0].monto } : null;
  return { subtotales, sinMoneda, unica };
}

export type ItemPrevision = { id: string; etiqueta: string; moneda: string };

export type PrevisionCotizacion = {
  /** Moneda en que se generará la cotización; `null` si no se puede anticipar. */
  moneda: string | null;
  /** De dónde sale esa moneda: el primer hotel o, sin hoteles, los servicios
   * (todos en esa misma moneda). */
  origen: "hotel" | "servicio" | null;
  /** Por qué no se puede anticipar la moneda (`moneda` null): un ítem sin
   * moneda registrada, o un carrito solo de servicios en varias monedas
   * (depende de cuáles sigan disponibles al re-liquidar). */
  indeterminada: "sin_moneda" | "servicios" | null;
  /** Suma de lo que entraría a la cotización (solo con `moneda` conocida y sin ítems por confirmar). */
  montoIncluido: number | null;
  /** Ítems que el servidor dejaría fuera por estar en otra moneda. */
  excluidos: ItemPrevision[];
  /** Hoteles en otra moneda con servicios vinculados: el servidor rechaza la solicitud. */
  bloqueantes: ItemPrevision[];
  /** Ítems sin moneda registrada: el servidor la confirma. */
  porConfirmar: number;
};

const etiquetaDe = (it: ItemMoneda) => (it.tipo === "hotel" ? it.hotelNombre : it.nombre)?.trim() || (it.tipo === "hotel" ? "Hotel" : "Servicio");

export function preverCotizacion(items: readonly ItemMoneda[]): PrevisionCotizacion {
  const persona = items.filter((i) => i.tipo === "hotel" && i.modeloTarifario !== "unidad");
  const unidad = items.filter((i) => i.tipo === "hotel" && i.modeloTarifario === "unidad");
  // #64: el servicio manual cuenta como servicio independiente para la moneda.
  const tours = items.filter((i) => i.tipo === "tour" || i.tipo === "manual");
  const orden = [...persona, ...unidad, ...tours];
  const porConfirmar = orden.filter((i) => !monedaDeItem(i)).length;
  const nada = (indeterminada: PrevisionCotizacion["indeterminada"]): PrevisionCotizacion =>
    ({ moneda: null, origen: null, indeterminada, montoIncluido: null, excluidos: [], bloqueantes: [], porConfirmar });
  const primero = orden[0];
  if (!primero) return nada(null);
  const hayHoteles = persona.length + unidad.length > 0;
  if (!hayHoteles) {
    const monedas = new Set(tours.map((t) => monedaDeItem(t)));
    if (monedas.size > 1 || monedas.has(null)) return nada(monedas.has(null) && monedas.size === 1 ? "sin_moneda" : "servicios");
  }
  const moneda = monedaDeItem(primero);
  if (!moneda) return nada("sin_moneda");
  const origen = hayHoteles ? "hotel" : "servicio";

  const conServicios = new Set(tours.map((t) => t.hotelItemId).filter((h): h is string => typeof h === "string" && h !== ""));
  const excluidos: ItemPrevision[] = [];
  const bloqueantes: ItemPrevision[] = [];
  const hotelesFuera = new Set<string>();
  for (const h of [...persona, ...unidad]) {
    const m = monedaDeItem(h);
    if (!m || m === moneda) continue;
    hotelesFuera.add(h.id);
    (conServicios.has(h.id) ? bloqueantes : excluidos).push({ id: h.id, etiqueta: etiquetaDe(h), moneda: m });
  }
  for (const t of tours) {
    const m = monedaDeItem(t);
    if (!m || m === moneda) continue;
    // Un servicio vinculado sigue a su hotel: si el hotel ya bloquea, no se repite.
    if (t.hotelItemId && hotelesFuera.has(t.hotelItemId)) continue;
    (t.hotelItemId ? bloqueantes : excluidos).push({ id: t.id, etiqueta: etiquetaDe(t), moneda: m });
  }
  const montoIncluido = porConfirmar === 0
    ? orden.filter((i) => monedaDeItem(i) === moneda).reduce((s, i) => s + i.precio, 0)
    : null;
  return { moneda, origen, indeterminada: null, montoIncluido, excluidos, bloqueantes, porConfirmar };
}

/** Comisión B2B de presentación sobre un monto de UNA sola moneda. */
export function comisionSobre(monto: number, pct: number): { comision: number; neto: number } {
  const comision = Math.round(monto * pct);
  return { comision, neto: monto - comision };
}
