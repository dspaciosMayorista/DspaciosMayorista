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
