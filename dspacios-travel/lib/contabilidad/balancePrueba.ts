// Balance de prueba desde el libro (#43-1b) — lógica pura.
//
// Se arma con las líneas de los asientos (`asiento_lineas` + fecha de su
// asiento), no con ventas/abonos/CxP: es la vista que cuadra con el libro
// diario. Cada cuenta acumula sus propios movimientos y los de todas sus
// subcuentas (por `padre_id`), así un grupo o una clase muestran el total.

export type CuentaPuc = {
  id: number;
  codigo: string;
  nombre: string;
  nivel: number;
  padre_id: number | null;
  naturaleza: string; // 'debito' | 'credito'
};
export type MovimientoLinea = { cuenta_id: number; fecha: string; debe: number; haber: number };

export type FilaBalance = {
  id: number;
  codigo: string;
  nombre: string;
  nivel: number;
  naturaleza: string;
  saldoInicial: number;
  debitos: number;
  creditos: number;
  saldoFinal: number;
  tieneMovimiento: boolean;
};

type Acumulado = { antesDebe: number; antesHaber: number; debitos: number; creditos: number };
const vacio = (): Acumulado => ({ antesDebe: 0, antesHaber: 0, debitos: 0, creditos: 0 });

/** Saldo según la naturaleza de la cuenta: débito = debe − haber; crédito = haber − debe. */
export function saldoSegunNaturaleza(naturaleza: string, debe: number, haber: number): number {
  return naturaleza === "credito" ? haber - debe : debe - haber;
}

export function balanceDePrueba(
  cuentas: CuentaPuc[],
  movimientos: MovimientoLinea[],
  opciones: { desde: string; hasta: string; nivelMax?: number; soloConMovimiento?: boolean },
): { filas: FilaBalance[]; totales: { debitos: number; creditos: number; cuadra: boolean }; lineasSinCuenta: number } {
  const porId = new Map(cuentas.map((c) => [c.id, c]));
  const acumulado = new Map<number, Acumulado>();
  let debitos = 0, creditos = 0, lineasSinCuenta = 0;

  for (const m of movimientos) {
    if (m.fecha > opciones.hasta) continue;
    const debe = Number(m.debe) || 0;
    const haber = Number(m.haber) || 0;
    const enPeriodo = m.fecha >= opciones.desde;
    if (enPeriodo) { debitos += debe; creditos += haber; }
    if (!porId.has(m.cuenta_id)) { lineasSinCuenta++; continue; }
    // La línea suma en su cuenta y en cada ancestro (con tope y sin ciclos).
    const vistos = new Set<number>();
    let id: number | null = m.cuenta_id;
    while (id != null && !vistos.has(id) && vistos.size < 20) {
      vistos.add(id);
      const a = acumulado.get(id) ?? vacio();
      if (enPeriodo) { a.debitos += debe; a.creditos += haber; } else { a.antesDebe += debe; a.antesHaber += haber; }
      acumulado.set(id, a);
      id = porId.get(id)?.padre_id ?? null;
    }
  }

  const filas: FilaBalance[] = [];
  for (const c of cuentas) {
    if (opciones.nivelMax && c.nivel > opciones.nivelMax) continue;
    const a = acumulado.get(c.id) ?? vacio();
    const tieneMovimiento = a.antesDebe !== 0 || a.antesHaber !== 0 || a.debitos !== 0 || a.creditos !== 0;
    if (opciones.soloConMovimiento && !tieneMovimiento) continue;
    const saldoInicial = saldoSegunNaturaleza(c.naturaleza, a.antesDebe, a.antesHaber);
    filas.push({
      id: c.id, codigo: c.codigo, nombre: c.nombre, nivel: c.nivel, naturaleza: c.naturaleza,
      saldoInicial, debitos: a.debitos, creditos: a.creditos,
      saldoFinal: saldoInicial + saldoSegunNaturaleza(c.naturaleza, a.debitos, a.creditos),
      tieneMovimiento,
    });
  }
  // Orden del PUC: el código como texto ya pone cada subcuenta bajo su cuenta.
  filas.sort((x, y) => (x.codigo < y.codigo ? -1 : x.codigo > y.codigo ? 1 : 0));
  return { filas, totales: { debitos, creditos, cuadra: Math.abs(debitos - creditos) <= 1 }, lineasSinCuenta };
}
