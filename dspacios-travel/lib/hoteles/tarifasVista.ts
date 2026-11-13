// Presentación (solo lectura) de las tarifas netas del detalle de hotel. Funciones puras: NO calculan ni
// transforman importes, solo los muestran con la moneda del hotel y los agrupan para leerlos.

/**
 * Importe neto de una tarifa de hotel en SU moneda.
 * - `null`/`undefined` (no cargado) → "—". El `0` es un valor real (gratis) y se muestra como importe, nunca como "—".
 * - COP → "$ 1.234.000"; USD → "USD $85" (con centavos solo si el importe los tiene: no se redondea un neto de USD).
 */
export function formatNetoTarifa(valor: number | string | null | undefined, moneda?: string | null): string {
  if (valor == null || valor === "") return "—";
  const n = Number(valor);
  if (!Number.isFinite(n)) return "—";
  const usd = (moneda ?? "COP").toUpperCase() === "USD";
  const dec = Number.isInteger(n) ? 0 : 2;
  const texto = new Intl.NumberFormat(usd ? "en-US" : "es-CO", {
    style: "currency",
    currency: usd ? "USD" : "COP",
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(n);
  return usd ? `USD ${texto}` : texto;
}

export type VigenciaRef = { nombre: string; fecha_inicio: string | null; fecha_fin: string | null; compra_fin?: string | null };
type FilaAgrupable = { id: number; tipo_habitacion: string | null; alimentacion: string | null; temporada: string | null };

export type GrupoTarifas<T extends FilaAgrupable> = {
  clave: string;
  temporada: string | null;
  alimentacion: string | null;
  /** Vigencias de `hotel_temporadas` con ese nombre (puede haber varias); vacío = la tarifa quedó sin vigencia registrada. */
  vigencias: VigenciaRef[];
  filas: T[];
};

/**
 * Agrupa las tarifas por vigencia (temporada) × alimentación (régimen). Es una partición: cada tarifa queda en
 * exactamente UN grupo y ninguna se descarta ni se modifica. Orden: inicio de la vigencia (sin fecha al final),
 * nombre, régimen; dentro del grupo, categoría y luego id.
 */
export function agruparTarifasPorVigenciaRegimen<T extends FilaAgrupable>(tarifas: T[], vigencias: VigenciaRef[]): GrupoTarifas<T>[] {
  const porNombre = new Map<string, VigenciaRef[]>();
  for (const v of vigencias) {
    const lista = porNombre.get(v.nombre) ?? [];
    lista.push(v);
    porNombre.set(v.nombre, lista);
  }
  const inicioDe = (nombre: string | null): string => {
    const fechas = (nombre != null ? porNombre.get(nombre) ?? [] : []).map((v) => v.fecha_inicio).filter((f): f is string => !!f).sort();
    return fechas[0] ?? "9999-12-31";
  };
  const grupos = new Map<string, GrupoTarifas<T>>();
  for (const t of tarifas) {
    const clave = JSON.stringify([t.temporada, t.alimentacion]);
    let g = grupos.get(clave);
    if (!g) {
      g = { clave, temporada: t.temporada, alimentacion: t.alimentacion, vigencias: t.temporada != null ? porNombre.get(t.temporada) ?? [] : [], filas: [] };
      grupos.set(clave, g);
    }
    g.filas.push(t);
  }
  const cmp = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", "es");
  const lista = [...grupos.values()].sort(
    (a, b) =>
      inicioDe(a.temporada).localeCompare(inicioDe(b.temporada)) ||
      Number(a.temporada == null) - Number(b.temporada == null) ||
      cmp(a.temporada, b.temporada) ||
      cmp(a.alimentacion, b.alimentacion)
  );
  for (const g of lista) g.filas.sort((a, b) => cmp(a.tipo_habitacion, b.tipo_habitacion) || a.id - b.id);
  return lista;
}

export const PESTANAS_HOTEL = ["configuracion", "temporadas", "tarifas"] as const;
export type PestanaHotel = (typeof PESTANAS_HOTEL)[number];

/** `?tab=` desconocido o ausente → la primera pestaña. */
export function normalizarPestanaHotel(valor: string | string[] | null | undefined): PestanaHotel {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return (PESTANAS_HOTEL as readonly string[]).includes(v ?? "") ? (v as PestanaHotel) : "configuracion";
}

/** Texto del descuento como lo cargó el usuario: «10 %», «20.000 por habitación y noche», «15.000 por persona y noche». */
export function textoDescuento(tipo: string | null, unidad: string | null | undefined, valor: number, fmt: (n: number) => string): string {
  if (tipo === "descuento_pct") return `${Number(valor.toFixed(2)).toLocaleString("es-CO")} %`;
  return `${fmt(valor)} ${unidad === "habitacion_noche" ? "por habitación y noche" : "por persona y noche"}`;
}

/** Cuenta de una línea de promoción dinámica, en unidades coherentes. Descuento por habitación y noche: se muestra sobre la
 * HABITACIÓN completa y su equivalente por persona con el reparto exacto («100.000 × 2 − 20.000 = 180.000 por habitación, 90.000
 * por persona»; en triple «… 83.334 + 83.333 + 83.333 por persona»). Porcentaje o monto por persona: «100.000 − 10 % = 90.000». */
export function textoCuentaPromo(
  l: { netoBase: number; valor: number; netoResultante: number | null; motivoNoAplica: string | null; habitacion?: { ocupantes: number; resultadoHabitacion: number; porPersona: number[] } },
  tipo: string | null, unidad: string | null | undefined, fmt: (n: number) => string,
): string {
  if (l.habitacion) {
    const h = l.habitacion;
    const iguales = h.porPersona.every((x) => x === h.porPersona[0]);
    const pp = iguales ? fmt(h.porPersona[0]) : h.porPersona.map(fmt).join(" + ");
    return `${fmt(l.netoBase)} × ${h.ocupantes} − ${fmt(l.valor)} = ${fmt(h.resultadoHabitacion)} por habitación, ${pp} por persona`;
  }
  const izquierda = `${fmt(l.netoBase)} − ${tipo === "descuento_pct" ? textoDescuento(tipo, unidad, l.valor, fmt) : `${fmt(l.valor)}${unidad === "habitacion_noche" ? " por habitación" : " por persona"}`}`;
  return `${izquierda} = ${l.netoResultante != null ? fmt(l.netoResultante) : l.motivoNoAplica ?? "no aplica"}`;
}

/** Resumen de una promoción dinámica para «Tarifas generadas», con el patrón del tarifario: por vigencia base y grupo, una tarjeta por
 * CATEGORÍA (alimentaciones, cuántas tarifas y el «desde» por persona) y, en su detalle, las tarifas por alimentación y acomodación.
 * Solo reorganiza las líneas ya calculadas: no calcula ni consulta nada. Orden de llegada conservado (como las filas de la ficha). */
export type LineaAgrupable = { base: string; grupo: string; dias: string | null; categoria: string; regimen: string; acomodacion: string; netoResultante: number | null; habitacion?: { porPersona: number[] } };
export type CategoriaPromo<L> = { categoria: string; regimenes: { regimen: string; lineas: L[] }[]; tarifas: number; desdePorPersona: number | null };
export type BloquePromo<L> = { clave: string; base: string; grupo: string; dias: string | null; categorias: CategoriaPromo<L>[] };

const ACOM_HABITACION_ETIQUETA = new Set(["Sencilla", "Doble", "Triple", "Múltiple"]);

export function agruparPromoPorCategoria<L extends LineaAgrupable>(lineas: readonly L[]): BloquePromo<L>[] {
  const bloques: BloquePromo<L>[] = [];
  for (const l of lineas) {
    const clave = `${l.base}|${l.grupo}|${l.dias ?? ""}`;
    let b = bloques.find((x) => x.clave === clave);
    if (!b) { b = { clave, base: l.base, grupo: l.grupo, dias: l.dias, categorias: [] }; bloques.push(b); }
    let c = b.categorias.find((x) => x.categoria === l.categoria);
    if (!c) { c = { categoria: l.categoria, regimenes: [], tarifas: 0, desdePorPersona: null }; b.categorias.push(c); }
    let r = c.regimenes.find((x) => x.regimen === l.regimen);
    if (!r) { r = { regimen: l.regimen, lineas: [] }; c.regimenes.push(r); }
    r.lineas.push(l);
    c.tarifas++;
    // «Desde» por persona de ADULTO, como el tarifario (solo acomodaciones de habitación; niños e infantes no): el menor importe que se
    // vende (por habitación: la menor parte del reparto exacto).
    const pp = !ACOM_HABITACION_ETIQUETA.has(l.acomodacion) ? null : l.habitacion ? Math.min(...l.habitacion.porPersona) : l.netoResultante;
    if (pp != null && (c.desdePorPersona == null || pp < c.desdePorPersona)) c.desdePorPersona = pp;
  }
  // Orden estable, independiente del orden de carga de las filas: categorías y alimentaciones alfabéticas (es); las acomodaciones
  // conservan el orden de siempre (Sencilla → Infante), que ya traen las líneas.
  const cmp = (a: string, b: string) => a.localeCompare(b, "es");
  for (const b of bloques) {
    b.categorias.sort((x, y) => cmp(x.categoria, y.categoria));
    for (const c of b.categorias) c.regimenes.sort((x, y) => cmp(x.regimen, y.regimen));
  }
  return bloques;
}
