// Tarifa por persona que se PUEDE mostrar sin mentir: el total de una línea dividido entre sus personas, en centavos.
//
// Si la división es exacta hay una sola tarifa. Si no (p. ej. 1.330.455,25 entre 2), NO se muestra una tarifa «exacta» que multiplicada no da el total:
// se muestra el reparto honesto (cuántas personas pagan cada valor), cuyos productos suman EXACTAMENTE el total. Solo presentación: nunca cambia importes.

export type ParteReparto = { tarifa: number; cantidad: number };
export type RepartoTarifa = { exacto: true; tarifa: number } | { exacto: false; partes: ParteReparto[] };

/** `total` (≤ 2 decimales) entre `cantidad` personas. null si los datos no permiten un reparto (cantidad no entera positiva, total no finito o negativo). */
export function repartoPorPersona(total: number, cantidad: number): RepartoTarifa | null {
  if (!Number.isInteger(cantidad) || cantidad < 1 || !Number.isFinite(total) || total < 0) return null;
  const cent = Math.round(total * 100);
  if (!Number.isSafeInteger(cent)) return null;
  const base = Math.floor(cent / cantidad);
  const resto = cent - base * cantidad;
  if (resto === 0) return { exacto: true, tarifa: base / 100 };
  // `resto` personas pagan un centavo más; el orden (mayor primero) es estable para el documento.
  return { exacto: false, partes: [{ tarifa: (base + 1) / 100, cantidad: resto }, { tarifa: base / 100, cantidad: cantidad - resto }] };
}

/** ¿`cantidad × tarifa` es exactamente `total` (en centavos)? */
export function tarifaCuadra(total: number, cantidad: number, tarifa: number): boolean {
  return Number.isFinite(total) && Number.isFinite(tarifa) && Number.isInteger(cantidad) && Math.round(tarifa * 100) * cantidad === Math.round(total * 100);
}

/**
 * Importe con sus centavos cuando los tiene ($1.330.455,25; $1.330.455 si es entero). `formatMoneda` redondea a la unidad, y un total NETO con centavos
 * (comisión liquidada en centavos) se vería con un peso distinto del que se cobra. Mismo formato que el total NETO del contrato.
 */
export function formatoExacto(valor: number, moneda?: string | null): string {
  const usd = (moneda ?? "COP").toUpperCase() === "USD";
  const cent = Math.round(valor * 100);
  // Con centavos, siempre dos cifras (",20", no ",2"); sin centavos, como siempre.
  const dec = cent % 100 !== 0 ? 2 : 0;
  const importe = new Intl.NumberFormat(usd ? "en-US" : "es-CO", { style: "currency", currency: usd ? "USD" : "COP", minimumFractionDigits: dec, maximumFractionDigits: dec }).format(cent / 100);
  return `${usd ? "USD " : ""}${importe}`;
}

/** Texto del reparto con el formateador dado: «$665.227,63» o «1 × $665.227,63 + 1 × $665.227,62». */
export function textoReparto(r: RepartoTarifa, fmt: (n: number) => string): string {
  return r.exacto ? fmt(r.tarifa) : r.partes.map((p) => `${p.cantidad} × ${fmt(p.tarifa)}`).join(" + ");
}
