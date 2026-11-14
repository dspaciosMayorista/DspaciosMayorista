// #14-A — Lectura PURA de lo que se escribe en el formulario del carrito (recobro y su distribución). Solo convierte texto en la entrada que viaja al servidor; el SERVIDOR vuelve a validar
// todo y decide qué se le permite a cada quien (aliado directo: distribución del sistema; venta asistida: la del formulario; interno a cliente final: sin distribución).

/** «100000», «100.000», «100.000,50», «1,5», «  » ⇒ importe; vacío ⇒ null; ilegible ⇒ NaN. Coma = decimal; punto con grupos de 3 dígitos = miles; un solo punto no seguido de 3 dígitos = decimal. */
export function parsearImporteFormulario(txt: string): number | null {
  const t = txt.replace(/\s+/g, "").replace(/^\$/, "");
  if (t === "") return null;
  if (!/^[0-9.,]+$/.test(t) || /[.,]{2}/.test(t)) return NaN;
  let normal: string;
  if (t.includes(",")) {
    if ((t.match(/,/g) ?? []).length > 1) return NaN;
    normal = t.replace(/\./g, "").replace(",", ".");
  } else if (/^[0-9]{1,3}(\.[0-9]{3})+$/.test(t)) {
    normal = t.replace(/\./g, "");
  } else {
    if ((t.match(/\./g) ?? []).length > 1) return NaN;
    normal = t;
  }
  const n = Number(normal);
  return Number.isFinite(n) ? n : NaN;
}

export type PartModoFormulario = "valor" | "pct";
export type EntradaFormularioRecobro = { recobroTxt: string; partModo: PartModoFormulario; partTxt: string; /** Solo la venta asistida captura distribución. */ pideDistribucion: boolean };
export type RecobroParaEnviar = { total: number; participacion?: { modo: "valor"; valor: number } | { modo: "pct"; pct: number } };

/**
 * `ok: true, recobro: null` = no hay recobro (campo vacío o 0): no se envía nada y el carrito es el de siempre.
 * Un recobro ilegible o negativo bloquea el envío con un mensaje (nunca se interpreta como 0 en silencio).
 */
export function recobroDesdeFormulario(e: EntradaFormularioRecobro): { ok: true; recobro: RecobroParaEnviar | null } | { ok: false; error: string } {
  const total = parsearImporteFormulario(e.recobroTxt);
  if (total === null || total === 0) return { ok: true, recobro: null };
  if (Number.isNaN(total) || total < 0) return { ok: false, error: "El recobro debe ser un importe válido mayor o igual a 0." };
  if (Math.abs(total * 100 - Math.round(total * 100)) > 1e-6) return { ok: false, error: "El recobro admite como máximo dos decimales." };
  if (!e.pideDistribucion) return { ok: true, recobro: { total } };
  const p = parsearImporteFormulario(e.partTxt);
  if (p === null) return { ok: true, recobro: { total } }; // sin distribución: el recobro se queda en la base comisionable
  if (Number.isNaN(p) || p < 0) return { ok: false, error: "La distribución del recobro debe ser un importe válido mayor o igual a 0." };
  if (e.partModo === "pct") {
    if (p > 100) return { ok: false, error: "El porcentaje de distribución del recobro debe estar entre 0 y 100 %." };
    return { ok: true, recobro: { total, participacion: { modo: "pct", pct: p / 100 } } };
  }
  return { ok: true, recobro: { total, participacion: { modo: "valor", valor: p } } };
}

/** Un componente del total que ve el asesor antes de generar (hotel, servicios, recobro). */
export type ParteTotal = { etiqueta: string; monto: number };
export type TotalConRecobro =
  | { estado: "sin_recobro" }
  /** El texto del recobro no se puede leer: no hay total que confirmar. */
  | { estado: "error"; mensaje: string }
  /** El recobro es válido pero el total no se puede sumar todavía (el carrito mezcla monedas o hay ítems sin moneda): no se muestra una cifra. */
  | { estado: "pendiente"; motivo: string }
  /** Total confirmado: partes + recobro, en una sola moneda. */
  | { estado: "confirmado"; moneda: string; partes: ParteTotal[]; recobro: number; total: number };

/**
 * #14-A — Total actualizado de una cotización a CLIENTE FINAL con recobro, antes de generar (pantalla interna del asesor: ningún documento del cliente lo nombra).
 * Distingue un total CONFIRMADO de un cálculo pendiente o con error: nunca muestra una cifra mientras el recobro sea ilegible o la moneda no esté definida.
 * `base` = total del carrito en UNA moneda (null si mezcla monedas o hay ítems sin moneda) y `partes` su desglose (hotel, servicios).
 */
export function totalConRecobro(e: {
  form: { ok: true; recobro: RecobroParaEnviar | null } | { ok: false; error: string };
  base: { moneda: string; monto: number } | null;
  partes: readonly ParteTotal[];
}): TotalConRecobro {
  if (!e.form.ok) return { estado: "error", mensaje: e.form.error };
  if (!e.form.recobro) return { estado: "sin_recobro" };
  if (!e.base) return { estado: "pendiente", motivo: "El carrito mezcla monedas o tiene ítems sin moneda: el total con recobro se calcula al generar la cotización." };
  const recobro = e.form.recobro.total;
  const cent = (n: number) => Math.round(n * 100);
  const total = (cent(e.base.monto) + cent(recobro)) / 100;
  const partes = e.partes.filter((p) => p.monto !== 0).map((p) => ({ etiqueta: p.etiqueta, monto: p.monto }));
  if (partes.reduce((s, p) => s + cent(p.monto), 0) !== cent(e.base.monto)) return { estado: "pendiente", motivo: "El desglose del carrito no coincide con su total: se calcula al generar la cotización." };
  return { estado: "confirmado", moneda: e.base.moneda, partes, recobro, total };
}
