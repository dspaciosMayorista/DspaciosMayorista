// B95-19 (owner 2026-11-26) — PRESENTATION ONLY. The stored contract keeps the explicit «Ajuste de redondeo del reparto del hotel» line (adultos 1 × ±residual) so that Σ items = precio_venta exactly
// (migration 333 / `computarReserva`); nothing here writes or changes stored data, the internal views still list the line, and historical rows are untouched.
// For the CUSTOMER document the owner rejects the visible «Ajuste por redondeo» row. The residual is folded into the tariff of the ADULTS (never the children's: their tariff is the real one) so the
// printed rows add up to the printed total exactly, in the currency's own unit (COP peso / USD cent), with no tolerance:
//   · every adult in a candidate row gets the SAME share (residual ÷ adults); a row's total changes by `adults × share`;
//   · it is folded only when each row's share is a whole number of cents. Otherwise (no adult row, fractional-cent shares) the line is STILL removed from the customer rows — the owner rejects the visible row unconditionally —
//     but nothing is guessed or spread unevenly: `sinReparto: true` tells the document to print NO per-row amounts (people counts + the exact stored total only), so no figure is invented and no amount is lost (stored lines/total untouched);
//   · when the per-adult tariff is not a whole number of cents (1.432,00 ÷ 3) the document prints it at calculation precision (USD 477,33) with the EXACT row total, as #94/#52 already does for carrito quotations (quantity × tariff can differ from the total by a fraction of a cent; there is no adjustment row and no split into different adult tariffs). Pending owner confirmation.
import { esLineaAjusteRedondeo } from "../reservar/solicitudHotel.ts";
import { esLineaNinoGratis } from "../reservar/ninoGratisLinea.ts";

type Fila = { id: number; descripcion: string; modo_precio: string; adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number; valor_total?: number | null };
/** Marca solo de presentación: la tarifa de adulto de la fila ya incluye su parte del ajuste (puede traer fracción de centavo: se imprime con su precisión de cálculo, `formatoExacto`). */
export type MarcaAjusteAbsorbido = { ajusteAbsorbido?: true };

const cent = (n: unknown) => Math.round(Number(n) * 100);
/** Fila de adultos del paquete: por persona, con adultos, y no es servicio, vuelo, niño gratis ni el propio ajuste. */
const esFilaAdultos = (f: Fila, esVuelo: (d: string) => boolean) =>
  f.modo_precio !== "total" && Number(f.adultos) > 0 && !f.descripcion.startsWith("Servicio · ") && !esVuelo(f.descripcion) && !esLineaNinoGratis(f.descripcion) && !esLineaAjusteRedondeo(f.descripcion);

export function absorberAjusteRedondeo<T extends Fila>(items: readonly T[], esVuelo: (descripcion: string) => boolean = () => false): { items: (T & MarcaAjusteAbsorbido)[]; absorbido: boolean; sinReparto: boolean } {
  const lineas = items.filter((i) => esLineaAjusteRedondeo(i.descripcion));
  if (!lineas.length) return { items: [...items], absorbido: false, sinReparto: false };
  const sinLinea = () => ({ items: items.filter((i) => !lineas.includes(i)), absorbido: false, sinReparto: true });
  const ajuste = lineas.reduce((s, l) => s + (l.modo_precio === "total" ? cent(l.valor_total) : cent(Number(l.adultos) * Number(l.tarifa_adulto) + Number(l.ninos) * Number(l.tarifa_nino))), 0);
  const candidatas = items.filter((i) => esFilaAdultos(i, esVuelo));
  const adultos = candidatas.reduce((s, f) => s + Number(f.adultos), 0);
  if (!candidatas.length || !Number.isSafeInteger(adultos) || adultos < 1 || !candidatas.every((f) => Number.isInteger(Number(f.adultos)))) return sinLinea();
  const cuota = (f: Fila) => (ajuste * Number(f.adultos)) / adultos;
  // Cada fila debe recibir centavos enteros; si no, el residuo no se reparte en silencio (sinReparto).
  if (!candidatas.every((f) => Number.isInteger(cuota(f)))) return sinLinea();
  const salida: (T & MarcaAjusteAbsorbido)[] = [];
  for (const i of items) {
    if (lineas.includes(i)) continue;
    if (!candidatas.includes(i)) { salida.push(i); continue; }
    const nuevaTarifa = (cent(Number(i.adultos) * Number(i.tarifa_adulto)) + cuota(i)) / Number(i.adultos) / 100;
    salida.push({ ...i, tarifa_adulto: nuevaTarifa, ajusteAbsorbido: true });
  }
  return { items: salida, absorbido: true, sinReparto: false };
}
