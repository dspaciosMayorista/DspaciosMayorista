// #126-B — cargo EXPLÍCITO de cada menor en un alojamiento cobrado por unidad (Bernalo). Módulo PURO (sin I/O).
//
// El precio de venta autoritativo es el de la UNIDAD (Σ marcar(totalNeto de cada habitación), redondeado una vez al final); este módulo NO lo
// cambia ni reparte un precio por persona. Solo dice, por cada menor, qué ve el huésped: su edad/clase y si
//   · "incluido"   → ocupa un cupo incluido de la unidad (no suma cargo propio),
//   · "por_noche" / "por_estadia" → la regla de la unidad tiene un cargo separado por ese menor (con su importe de VENTA ya con markup, a pesos),
//   · "como_adulto" → por su edad paga como un adulto (tarifa de adulto; nunca se inventa un importe aparte).
// Nunca sale un neto, bruto ni comisión: el importe de un cargo propio es el efecto exacto de ese cargo sobre el precio de venta de la habitación
// (marcar(neto con el cargo) − marcar(neto sin él)), en pesos de la moneda de la reserva, y queda INCLUIDO en el total mostrado.
import type { MenorClasificado, ResultadoValido, SuplementoAplicado } from "../calc/unidadAlojamiento.ts";

export type ClaseMenorUnidad = "infante" | "nino" | "como_adulto";
export type CobroMenorUnidad = "incluido" | "por_noche" | "por_estadia" | "como_adulto";

export type CargoMenorUnidad = {
  /** Habitación física (1-based) donde viaja el menor. */
  habitacion: number;
  edad: number;
  clase: ClaseMenorUnidad;
  cobro: CobroMenorUnidad;
  /** Importe de VENTA de su cargo propio durante TODA la estadía (incluido en el total de la reserva). null = incluido o paga como adulto. */
  cargoVenta: number | null;
  noches: number;
};

type Marcar = (costo: number, pctMk: number) => number;

const clase = (c: MenorClasificado["categoriaTarifaria"]): ClaseMenorUnidad => (c === "adulto" ? "como_adulto" : c);

/** Neto de la habitación tras quitar `brutoQuitado` del bruto: misma fórmula del motor (comisión una sola vez, Math.round). */
function netoSin(r: ResultadoValido, brutoQuitado: number): number {
  return Math.round((r.totalBruto - brutoQuitado) * (1 - r.comisionPct / 100));
}

/** Efecto en el PRECIO DE VENTA de quitar un cargo de la habitación (con el markup del paquete). */
function efectoVenta(r: ResultadoValido, brutoQuitado: number, pctMk: number, marcar: Marcar): number {
  return Math.max(0, Math.round(marcar(r.totalNeto, pctMk) - marcar(netoSin(r, brutoQuitado), pctMk)));
}

export function cargosMenoresUnidad(
  habitaciones: readonly { resultado: ResultadoValido }[],
  pctMk: number,
  marcar: Marcar,
): CargoMenorUnidad[] {
  const salida: CargoMenorUnidad[] = [];
  habitaciones.forEach((h, i) => {
    const r = h.resultado;
    const menores = r.menoresClasificados;
    if (menores.length === 0) return;
    const noches = r.noches;
    const comoAdulto = (m: MenorClasificado): CargoMenorUnidad => ({ habitacion: i + 1, edad: m.edadAnios, clase: "como_adulto", cobro: "como_adulto", cargoVenta: null, noches });

    if (r.unidadCobro === "persona") {
      // Cada menor tiene su propia tarifa (nino/infante); la periodicidad sale de la línea "menor" del desglose (infante puede ser por estadía).
      const lineaInf = r.desglose.find((l) => l.tipo === "menor" && l.concepto === "Infantes");
      const lineaNino = r.desglose.find((l) => l.tipo === "menor" && l.concepto === "Niños");
      for (const m of menores) {
        if (m.categoriaTarifaria === "adulto") { salida.push(comoAdulto(m)); continue; }
        const l = m.categoriaTarifaria === "infante" ? lineaInf : lineaNino;
        const per = l?.periodicidad === "por_estadia" ? "por_estadia" : "por_noche";
        const valor = Number(m.valorAplicado ?? l?.valorUnitario ?? 0);
        const bruto = per === "por_estadia" ? valor : valor * noches;
        salida.push({ habitacion: i + 1, edad: m.edadAnios, clase: clase(m.categoriaTarifaria), cobro: per, cargoVenta: valor > 0 ? efectoVenta(r, bruto, pctMk, marcar) : 0, noches });
      }
      return;
    }

    // habitacion | apartamento | pareja: los cupos incluidos se llenan en el orden recibido; los menores de más pagan `menor_adicional` (por noche).
    const extras = new Map<string, { cantidad: number; valor: number }>();
    for (const s of r.suplementosAplicados as SuplementoAplicado[]) {
      if (s.tipo === "menor_adicional") extras.set(s.categoriaMenor, { cantidad: s.cantidad, valor: s.valor });
    }
    const totalPorCat = new Map<string, number>();
    for (const m of menores) if (m.categoriaTarifaria !== "adulto") totalPorCat.set(m.categoriaTarifaria, (totalPorCat.get(m.categoriaTarifaria) ?? 0) + 1);
    const vistosPorCat = new Map<string, number>();
    for (const m of menores) {
      if (m.categoriaTarifaria === "adulto") { salida.push(comoAdulto(m)); continue; }
      const cat = m.categoriaTarifaria;
      const orden = (vistosPorCat.get(cat) ?? 0) + 1;
      vistosPorCat.set(cat, orden);
      const ex = extras.get(cat);
      const incluidos = (totalPorCat.get(cat) ?? 0) - (ex?.cantidad ?? 0);
      if (!ex || orden <= incluidos) {
        salida.push({ habitacion: i + 1, edad: m.edadAnios, clase: clase(cat), cobro: "incluido", cargoVenta: null, noches });
      } else {
        salida.push({ habitacion: i + 1, edad: m.edadAnios, clase: clase(cat), cobro: "por_noche", cargoVenta: efectoVenta(r, ex.valor * noches, pctMk, marcar), noches });
      }
    }
  });
  return salida;
}

const ETIQUETA_CLASE: Record<ClaseMenorUnidad, string> = { infante: "infante", nino: "niño", como_adulto: "paga como adulto" };

/** Texto corto por menor para la tabla y la tarjeta: «Niño 8 años: incluido en la habitación». Nunca sugiere una tarifa que no existe. */
export function textoCargoMenor(c: CargoMenorUnidad, formato: (n: number) => string): string {
  const quien = c.clase === "como_adulto" ? `Menor de ${c.edad} ${c.edad === 1 ? "año" : "años"}` : `${ETIQUETA_CLASE[c.clase][0].toUpperCase()}${ETIQUETA_CLASE[c.clase].slice(1)} de ${c.edad} ${c.edad === 1 ? "año" : "años"}`;
  if (c.cobro === "como_adulto") return `${quien}: paga como adulto (tarifa de adulto de la unidad)`;
  if (c.cobro === "incluido") return `${quien}: incluido en la unidad, sin cargo propio`;
  // Una tarifa de $0 configurada por el hotel es «sin cargo propio», nunca «cargo propio $0».
  if (!(c.cargoVenta != null && c.cargoVenta > 0)) return `${quien}: sin cargo propio (tarifa $0 del hotel)`;
  const monto = formato(c.cargoVenta);
  return c.cobro === "por_estadia"
    ? `${quien}: cargo propio ${monto} una sola vez por toda la estadía (ya incluido en el total)`
    : `${quien}: cargo propio ${monto} en total (se cobra por noche, ${c.noches} ${c.noches === 1 ? "noche" : "noches"}; ya incluido en el total)`;
}

// ── O-2 · desglose INFORMATIVO adulto/menores de un alojamiento por unidad ───────────────────────────────────────────────────────────
// El precio autoritativo sigue siendo el de la UNIDAD. Este desglose solo explica el total con las mismas piezas que ya existen:
//   total = base de la unidad (incluye a los menores sin cargo propio) + cargos propios de menores (los de `cargosMenoresUnidad`).
// El «equivalente por adulto» es base ÷ adultos y se ofrece SOLO cuando es una lectura honesta: todas las habitaciones iguales (misma acomodación y mismos adultos,
// es decir, la misma tarifa) y ningún menor que pague como adulto (su tarifa no existe como número aparte). Nunca es una tarifa vendible ni toca el precio.
export type DesgloseInformativoUnidad = {
  total: number;
  /** total − cargos propios: lo que cuesta la unidad (con los menores incluidos dentro). */
  baseUnidad: number;
  /** Suma de los cargos propios de menores (ya incluidos en el total). 0 si no hay. */
  cargosPropios: number;
  /** Menores que ocupan un cupo incluido o tienen tarifa $0: no suman nada aparte. */
  menoresSinCargo: number;
  adultos: number;
  /** Informativo: base ÷ adultos. null cuando no es una lectura honesta (ver `sinEquivalente`). */
  equivalentePorAdulto: number | null;
  sinEquivalente?: "sin_adultos" | "habitaciones_distintas" | "menor_paga_como_adulto";
};

export function desgloseInformativoUnidad(args: {
  precioVenta: number;
  ocupacion: readonly { acom: string; adultos: number }[];
  menores?: readonly CargoMenorUnidad[];
}): DesgloseInformativoUnidad | null {
  const { precioVenta, ocupacion } = args;
  const menores = args.menores ?? [];
  if (!Number.isFinite(precioVenta) || precioVenta <= 0 || ocupacion.length === 0) return null;
  const propios = menores.filter((m) => (m.cobro === "por_noche" || m.cobro === "por_estadia") && (m.cargoVenta ?? 0) > 0);
  const cargosPropios = propios.reduce((s, m) => s + (m.cargoVenta ?? 0), 0);
  const baseUnidad = precioVenta - cargosPropios;
  if (baseUnidad < 0) return null; // incoherente: no se explica con números inventados
  const adultos = ocupacion.reduce((s, h) => s + h.adultos, 0);
  const menoresSinCargo = menores.filter((m) => m.cobro === "incluido" || ((m.cobro === "por_noche" || m.cobro === "por_estadia") && !((m.cargoVenta ?? 0) > 0))).length;
  const base = { total: precioVenta, baseUnidad, cargosPropios, menoresSinCargo, adultos };
  if (adultos <= 0) return { ...base, equivalentePorAdulto: null, sinEquivalente: "sin_adultos" };
  if (menores.some((m) => m.cobro === "como_adulto")) return { ...base, equivalentePorAdulto: null, sinEquivalente: "menor_paga_como_adulto" };
  const iguales = ocupacion.every((h) => h.acom === ocupacion[0].acom && h.adultos === ocupacion[0].adultos);
  if (!iguales) return { ...base, equivalentePorAdulto: null, sinEquivalente: "habitaciones_distintas" };
  return { ...base, equivalentePorAdulto: Math.round(baseUnidad / adultos) };
}
