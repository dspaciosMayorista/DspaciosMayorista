// ─────────────────────────────────────────────────────────────────────────
// Plan de cuotas del cliente (fechas de cobro)
// ─────────────────────────────────────────────────────────────────────────
// Reglas:
//  - Abono inicial = % (configurable, default 30%) con fecha límite HOY.
//  - Saldo en cuotas MENSUALES o QUINCENALES (a elección), la última 1 mes
//    antes del check-in.
//  - Si el viaje está a menos de un mes del check-in → 100% ya.
//  - Reparto parejo; la última cuota ajusta el redondeo.
//  - #42: el plan descuenta lo YA PAGADO. Las filas siguen sumando el total del cobro (así cada pago real cubre las filas en orden, como siempre), pero
//    lo pagado va primero a la fila inicial y SOLO el saldo restante se reparte en las cuotas futuras: nunca se vuelve a pedir lo que el cliente ya pagó.
//    Un pago mayor al total no genera filas negativas ni cuotas de más (el excedente no se planifica).
// ─────────────────────────────────────────────────────────────────────────

import { fechaNegocio } from "../fechaNegocio.ts";

export type Cuota = { tipo: "abono" | "cuota" | "total"; fecha: string; monto: number };
export type FrecuenciaCuota = "mensual" | "quincenal";

function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Unidad mínima de cobro: pesos enteros en COP, centavos en USD (un contrato en dólares no pierde los centavos). */
const unidadesPorMoneda = (moneda: "COP" | "USD") => (moneda === "USD" ? 100 : 1);

export function planDeCuotas(args: {
  precio: number; checkIn: string | null; pctAbono: number; hoy?: string; frecuencia?: FrecuenciaCuota;
  /** Total ya pagado (abonos reales aplicados) en la MISMA moneda de `precio`. Por defecto 0. */
  pagado?: number;
  /** Moneda del cobro: define el redondeo (COP enteros, USD centavos). Por defecto COP. */
  moneda?: "COP" | "USD";
}): Cuota[] {
  const u = unidadesPorMoneda(args.moneda === "USD" ? "USD" : "COP");
  // Trabajo en unidades enteras (pesos o centavos) para que el reparto sume exacto sin error de coma flotante.
  const total = Math.max(0, Math.round((args.precio || 0) * u));
  if (total <= 0) return [];
  const pagado = Math.min(total, Math.max(0, Math.round((Number.isFinite(args.pagado) ? (args.pagado as number) : 0) * u)));
  const desde = (n: number) => n / u;

  // «Hoy» es el día de NEGOCIO (America/Bogota), no el del servidor (UTC): a las 7 p. m. de Bogotá el reloj UTC ya marca el día siguiente.
  const hoy = new Date(`${args.hoy || fechaNegocio()}T00:00:00`);
  hoy.setHours(0, 0, 0, 0);

  // Sin fecha de viaje o viaje a <1 mes → 100% ya.
  if (!args.checkIn) return [{ tipo: "total", fecha: iso(hoy), monto: desde(total) }];
  const checkIn = new Date(`${args.checkIn}T00:00:00`);
  const ultima = addMonths(checkIn, -1); // 1 mes antes del check-in
  if (ultima.getTime() <= hoy.getTime()) return [{ tipo: "total", fecha: iso(hoy), monto: desde(total) }];

  // El mínimo configurado MANDA, incluido el cero (un acuerdo de 0 % no se convierte en 30 %). Solo si no hay valor (null/NaN) rige el 30 % de siempre.
  const pct = Number.isFinite(args.pctAbono) ? Math.min(1, Math.max(0, args.pctAbono)) : 0.3;
  const minimo = Math.round(total * pct);
  // Lo pagado cubre primero el mínimo inicial; si lo supera, la fila inicial refleja lo ya recibido y el resto se reparte sobre el saldo.
  const abono = Math.max(minimo, pagado);
  const saldo = total - abono;

  // Fechas de cuotas: desde la última (1 mes antes del check-in) hacia atrás,
  // de mes en mes (o de 15 en 15 días si es quincenal), mientras sean
  // futuras respecto a hoy.
  const paso = args.frecuencia === "quincenal" ? (d: Date) => addDays(d, -15) : (d: Date) => addMonths(d, -1);
  const fechas: Date[] = [];
  let f = new Date(ultima);
  while (f.getTime() > hoy.getTime()) { fechas.push(new Date(f)); f = paso(f); }
  fechas.reverse();

  const n = fechas.length;
  if (n === 0 || saldo <= 0) return [{ tipo: "abono", fecha: iso(hoy), monto: desde(total) }];
  // Sin mínimo y sin pagos no hay abono inicial que pedir (una fila en $0 no es un cobro): el plan son solo las cuotas.
  const cuotas: Cuota[] = abono > 0 ? [{ tipo: "abono", fecha: iso(hoy), monto: desde(abono) }] : [];

  const base = Math.floor(saldo / n);
  let acum = 0;
  fechas.forEach((fd, i) => {
    const monto = i === n - 1 ? saldo - acum : base;
    acum += monto;
    cuotas.push({ tipo: "cuota", fecha: iso(fd), monto: desde(monto) });
  });
  return cuotas;
}

/** Tolerancia de cobro por moneda (la misma de la base: 0,5 en COP, 0,01 en USD). */
export const TOLERANCIA_COP = 0.5;
export const TOLERANCIA_USD_CUOTAS = 0.01;

export type EstadoCuota = { cubierta: boolean; parcial: boolean; faltante: number };

/**
 * Qué parte de cada cuota ya cubre lo pagado. Los pagos reales se aplican a las filas EN ORDEN (acumulado), igual que en toda la aplicación; una fila queda
 * cubierta cuando lo pagado alcanza su acumulado (con la tolerancia de la moneda), parcial cuando solo cubre una parte, y `faltante` es lo que aún se debe de ella.
 * Nunca negativo. Un pago mayor al plan deja todas cubiertas. PURO.
 */
export function estadoDeCuotas(montos: number[], pagado: number, moneda: "COP" | "USD" = "COP"): EstadoCuota[] {
  const tol = moneda === "USD" ? TOLERANCIA_USD_CUOTAS : TOLERANCIA_COP;
  const dec = moneda === "USD" ? 100 : 1;
  const pag = Math.max(0, Number.isFinite(pagado) ? pagado : 0);
  let acum = 0;
  return montos.map((m) => {
    const monto = Math.max(0, Number(m) || 0);
    const previo = acum;
    acum += monto;
    const faltanteBruto = Math.min(monto, Math.max(0, acum - pag));
    const faltante = faltanteBruto <= tol ? 0 : Math.round(faltanteBruto * dec) / dec;
    return { cubierta: faltante === 0, parcial: faltante > 0 && pag > previo + tol, faltante };
  });
}
