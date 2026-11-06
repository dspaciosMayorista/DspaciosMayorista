// #90 — Entrada y tipos de la cotización de la tarjeta pública (ver app/tarifario/cotizarTarjetaActions.ts). Validación pura, sin tocar la base.
import { validarRangoFechasConsulta } from "../reservar/edadesMenores.ts";

export type DescuentoTarjeta = { etiqueta: string; tipo: "ebb" | "long_stay"; umbral: number; pct: number };
/** Precios por persona (con la regla de HOY ya aplicada) de UNA categoría/régimen para las fechas cotizadas: lo que el modal «Ver opciones» muestra en vez del publicado. */
export type ComboTarjeta = { categoria: string; regimen: string; precios: Record<string, number>; preciosMenor2: Record<string, number>; infanteSinFijo: { mayor2: number | null; menor2: number | null }; descuento: DescuentoTarjeta | null };
export const MENSAJE_TARJETA = "No pudimos calcular el precio para esas fechas. Elige otras o intenta de nuevo.";
const MENSAJE = MENSAJE_TARJETA;
/**
 * Máximo de combinaciones categoría×régimen por llamada (#439). La tarjeta, el modal y Vista tabla envían TODAS las de la salida (las que tienen doble publicada) para poder hallar la más barata;
 * el validador no puede admitir menos de lo que ellas producen (con 12, un hotel de 4 categorías × PA/PAE/PAM/PC = 16 fallaba en todas sus salidas, antes de computarReserva).
 * 64 = 8 categorías × los 8 regímenes del catálogo. Es un techo de RECURSOS de una acción pública, no un máximo comercial. Con las lecturas idénticas compartidas entre combinaciones
 * (lib/reservar/lecturasCompartidas.ts) cada combinación aporta 3 lecturas PROPIAS en bloqueo/dinámico (fila publicada, tarifa del combo y composición) en vez de ~20 (con servicios incluidos y EBB).
 * Lo MIDE pruebas/lecturasCompartidas439.test.ts con el recorrido real (cliente falso que cuenta consultas, sin red; imprime líneas REPORTE439): 16 combinaciones = 64 consultas con memo frente a 320 sin memo;
 * 64 combinaciones = 208 frente a 1280, por debajo de las 240 que costaba el peor caso anterior (12 combinaciones). En porción terrestre (liquidación en vivo compartida) lo mide pruebas/porcionTerrestreMemo439.test.ts
 * (6 combinaciones: 132 frente a 32). Son conteos de consultas locales, no latencia remota. Una entrada por encima del máximo se RECHAZA con un código propio (`combos_exceden_limite`): nunca se confunde con «sin tarifa».
 */
export const MAX_COMBOS_TARJETA = 64;

/** Código estable del rechazo de una entrada: sirve para el registro del servidor y para el motivo que ve el personal interno. Nunca incluye datos de la entrada. */
export type CodigoRechazoTarjeta =
  | "entrada_no_es_objeto" | "modulo_invalido" | "ids_invalidos" | "combos_no_es_arreglo" | "combos_vacios" | "combos_exceden_limite"
  | "combo_invalido" | "fechas_invalidas" | "origen_ausente_bloqueo" | "salida_ausente_dinamico";

/** Texto FIJO por código para el personal interno (jamás el valor recibido). */
export const MOTIVO_RECHAZO_TARJETA: Record<CodigoRechazoTarjeta, string> = {
  entrada_no_es_objeto: "La entrada de la tarjeta no es válida (formato).",
  modulo_invalido: "La entrada de la tarjeta trae un módulo no admitido.",
  ids_invalidos: "La entrada de la tarjeta trae ids de paquete, hotel o fuente no válidos.",
  combos_no_es_arreglo: "La entrada de la tarjeta no trae la lista de combinaciones.",
  combos_vacios: "La entrada de la tarjeta no trae ninguna combinación categoría/régimen.",
  combos_exceden_limite: "La entrada trae más combinaciones categoría/régimen que el máximo técnico permitido: no es ausencia de tarifa.",
  combo_invalido: "Alguna combinación categoría/régimen de la entrada no es válida (vacía o demasiado larga).",
  fechas_invalidas: "Las fechas de la entrada no son válidas.",
  origen_ausente_bloqueo: "La entrada de bloqueo no indica el vuelo negociado ni el empaquetado.",
  salida_ausente_dinamico: "La entrada dinámica no indica la salida.",
};

export type RechazoEntradaTarjeta = { ok: false; error: string; codigo: CodigoRechazoTarjeta; /** Solo con `combos_exceden_limite`/`combos_vacios`: cuántas llegaron y el límite. */ recibidas?: number; limite?: number };

export type EntradaTarjeta = {
  modulo: "bloqueo" | "porcion_terrestre" | "dinamico";
  paqueteId: number; hotelId: number;
  bloqueoId?: number | null; empaquetadoId?: number | null; salidaId?: number | null;
  fechaIda?: string; fechaRegreso?: string;
  combos: { categoria: string; regimen: string }[];
};

const entero = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const texto = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= 120;
const opcional = (v: unknown) => v == null || entero(v);
const rechazo = (codigo: CodigoRechazoTarjeta, extra: { recibidas?: number; limite?: number } = {}): RechazoEntradaTarjeta => ({ ok: false, error: MENSAJE, codigo, ...extra });

export function validarEntradaTarjeta(raw: unknown): { ok: true; entrada: EntradaTarjeta } | RechazoEntradaTarjeta {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return rechazo("entrada_no_es_objeto");
  const o = raw as Record<string, unknown>;
  if (o.modulo !== "bloqueo" && o.modulo !== "porcion_terrestre" && o.modulo !== "dinamico") return rechazo("modulo_invalido");
  if (!entero(o.paqueteId) || !entero(o.hotelId) || !opcional(o.bloqueoId) || !opcional(o.empaquetadoId) || !opcional(o.salidaId)) return rechazo("ids_invalidos");
  if (!Array.isArray(o.combos)) return rechazo("combos_no_es_arreglo");
  if (o.combos.length < 1) return rechazo("combos_vacios", { recibidas: 0, limite: MAX_COMBOS_TARJETA });
  if (o.combos.length > MAX_COMBOS_TARJETA) return rechazo("combos_exceden_limite", { recibidas: o.combos.length, limite: MAX_COMBOS_TARJETA });
  const combos: { categoria: string; regimen: string }[] = [];
  for (const c of o.combos) {
    const x = c as { categoria?: unknown; regimen?: unknown } | null;
    if (!x || !texto(x.categoria) || !texto(x.regimen)) return rechazo("combo_invalido");
    combos.push({ categoria: x.categoria, regimen: x.regimen });
  }
  const modulo: EntradaTarjeta["modulo"] = o.modulo;
  const base = { modulo, paqueteId: o.paqueteId, hotelId: o.hotelId, bloqueoId: (o.bloqueoId as number | null | undefined) ?? null, empaquetadoId: (o.empaquetadoId as number | null | undefined) ?? null, salidaId: (o.salidaId as number | null | undefined) ?? null, combos };
  if (o.modulo === "porcion_terrestre") {
    const v = validarRangoFechasConsulta(o.fechaIda, o.fechaRegreso);
    if (!v.ok) return { ok: false, error: v.error, codigo: "fechas_invalidas" }; // conserva el texto propio del validador de fechas
    return { ok: true, entrada: { ...base, fechaIda: v.fechaIda, fechaRegreso: v.fechaRegreso } };
  }
  if (o.modulo === "dinamico" && !base.salidaId) return rechazo("salida_ausente_dinamico");
  if (o.modulo === "bloqueo" && !base.bloqueoId && !base.empaquetadoId) return rechazo("origen_ausente_bloqueo");
  return { ok: true, entrada: base };
}
