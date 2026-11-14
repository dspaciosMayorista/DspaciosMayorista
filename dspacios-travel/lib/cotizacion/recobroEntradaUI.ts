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
