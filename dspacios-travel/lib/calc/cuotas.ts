// ─────────────────────────────────────────────────────────────────────────
// Plan de cuotas del cliente (fechas de cobro)
// ─────────────────────────────────────────────────────────────────────────
// Reglas:
//  - Abono inicial = % (configurable, default 30%) con fecha límite HOY.
//  - Saldo en cuotas MENSUALES, la última 1 mes antes del check-in.
//  - Si el viaje está a menos de un mes del check-in → 100% ya.
//  - Reparto parejo; la última cuota ajusta el redondeo.
// ─────────────────────────────────────────────────────────────────────────

export type Cuota = { tipo: "abono" | "cuota" | "total"; fecha: string; monto: number };

function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function planDeCuotas(args: { precio: number; checkIn: string | null; pctAbono: number; hoy?: string }): Cuota[] {
  const precio = Math.max(0, Math.round(args.precio || 0));
  if (precio <= 0) return [];

  const hoy = args.hoy ? new Date(`${args.hoy}T00:00:00`) : new Date();
  hoy.setHours(0, 0, 0, 0);

  // Sin fecha de viaje o viaje a <1 mes → 100% ya.
  if (!args.checkIn) return [{ tipo: "total", fecha: iso(hoy), monto: precio }];
  const checkIn = new Date(`${args.checkIn}T00:00:00`);
  const ultima = addMonths(checkIn, -1); // 1 mes antes del check-in
  if (ultima.getTime() <= hoy.getTime()) return [{ tipo: "total", fecha: iso(hoy), monto: precio }];

  const pct = Math.min(1, Math.max(0, args.pctAbono || 0.3));
  const abono = Math.round(precio * pct);
  const saldo = precio - abono;

  // Fechas de cuotas: desde la última (1 mes antes del check-in) hacia atrás,
  // de mes en mes, mientras sean futuras respecto a hoy.
  const fechas: Date[] = [];
  let f = new Date(ultima);
  while (f.getTime() > hoy.getTime()) { fechas.push(new Date(f)); f = addMonths(f, -1); }
  fechas.reverse();

  const cuotas: Cuota[] = [{ tipo: "abono", fecha: iso(hoy), monto: abono }];
  const n = fechas.length;
  if (n === 0 || saldo <= 0) { cuotas[0].monto = precio; return cuotas; }

  const base = Math.floor(saldo / n);
  let acum = 0;
  fechas.forEach((fd, i) => {
    const monto = i === n - 1 ? saldo - acum : base;
    acum += monto;
    cuotas.push({ tipo: "cuota", fecha: iso(fd), monto });
  });
  return cuotas;
}
