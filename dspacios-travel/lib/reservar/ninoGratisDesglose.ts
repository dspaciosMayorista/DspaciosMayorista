// #125 × #102 (hallazgo I1 de la re-auditoría integrada): el desglose por pasajero de la búsqueda (tarjeta de Vista Booking, Vista tabla y noche adicional) debe mostrar lo que SE PAGA
// y cuadrar con el total. El motor resta el «niño gratis por habitación» del total; aquí se refleja en las líneas de menores SIN promediar tarifas realmente distintas:
//   · cada niño beneficiado sale de su línea de clase y pasa a una línea propia con su importe a pagar (tarifa − condonado) y la explicación (`gratis`);
//   · los beneficiados con el MISMO importe y las MISMAS promociones se agrupan; los demás (otra tarifa, otra promoción, otro condonado parcial) quedan separados;
//   · los niños de la misma clase que NO reciben el beneficio conservan su línea y su tarifa completa;
//   · R1/R2: un solo niño real = una sola línea; las promociones que le dieron noches gratis van como procedencia (en orden cronológico);
//   · vuelo, servicios y noches fuera del beneficio siguen cobrándose: `condonado` ya viene recompuesto por el motor (solo el alojamiento promocionado).
// Función pura, sin E/S: lo que construye cuadra con el total o se rechaza (`ok: false`), nunca queda una línea que contradiga el total.
import type { LineaDesglose } from "./asignacionHabitacionesBusqueda.ts";
import type { NinoGratisConcedido } from "../hoteles/ninoGratis.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;
const CLASES: ("nino" | "nino2")[] = ["nino", "nino2"];

export type ResultadoDesgloseGratis = { ok: true; desglose: LineaDesglose[] } | { ok: false; motivo: string };

/** Suma de los subtotales de un desglose: debe ser igual al total del combo (invariante que el motor comprueba). */
export const sumaDesglose = (desglose: readonly LineaDesglose[]) => r2(desglose.reduce((t, l) => t + l.subtotal, 0));

export function aplicarNinoGratisADesglose(desglose: readonly LineaDesglose[], ninos: readonly NinoGratisConcedido[]): ResultadoDesgloseGratis {
  if (!ninos.length) return { ok: true, desglose: desglose.map((l) => ({ ...l })) };
  const salida: LineaDesglose[] = [];
  const usadas = new Set<"nino" | "nino2">();
  for (const l of desglose) {
    const esClaseConBeneficio = (l.clase === "nino" || l.clase === "nino2") && !l.menorDeDos && ninos.some((n) => n.clase === l.clase);
    if (!esClaseConBeneficio) { salida.push({ ...l }); continue; }
    const clase = l.clase as "nino" | "nino2";
    const delaClase = ninos.filter((n) => n.clase === clase);
    if (delaClase.length > l.cantidad) return { ok: false, motivo: "El niño gratis de la promoción no coincide con los niños de la consulta; este caso no se puede mostrar sin contradecir el total." };
    usadas.add(clase);
    // Agrupa solo a los beneficiados IGUALES (mismo condonado y mismas promociones).
    const grupos = new Map<string, { n: number; condonado: number; promociones: string[]; edades: (number | null)[] }>();
    for (const c of delaClase) {
      const promociones = [...new Set(c.promociones.map((p) => p.promocion))];
      const clave = `${r2(c.venta)}|${promociones.join("\u0001")}`;
      const g = grupos.get(clave) ?? { n: 0, condonado: r2(c.venta), promociones, edades: [] };
      g.n += 1; g.edades.push(c.edad);
      grupos.set(clave, g);
    }
    // El resto de la clase conserva su línea; las edades solo se conservan si siguen cuadrando exactamente con la cantidad.
    const resto = l.cantidad - delaClase.length;
    if (resto > 0) {
      let edades = l.edades?.length === l.cantidad ? [...l.edades] : undefined;
      if (edades) {
        for (const c of delaClase) { const k = c.edad == null ? -1 : edades.indexOf(c.edad); if (k < 0) { edades = undefined; break; } edades.splice(k, 1); }
      }
      const { edades: _viejas, ...base } = l; void _viejas;
      salida.push({ ...base, cantidad: resto, subtotal: r2(resto * l.tarifa), ...(edades && edades.length === resto ? { edades } : {}) });
    }
    for (const g of grupos.values()) {
      const pagable = r2(l.tarifa - g.condonado);
      if (pagable < -0.005) return { ok: false, motivo: "Lo condonado al niño gratis supera su tarifa; este caso no se puede mostrar sin contradecir el total." };
      const edades = g.edades.every((e): e is number => e != null) ? g.edades : undefined;
      salida.push({
        clase, cantidad: g.n, tarifa: Math.max(0, pagable), subtotal: r2(g.n * Math.max(0, pagable)), menorDeDos: false,
        ...(edades ? { edades } : {}), gratis: { promociones: g.promociones, condonado: g.condonado },
      });
    }
  }
  for (const c of CLASES) if (ninos.some((n) => n.clase === c) && !usadas.has(c)) {
    return { ok: false, motivo: "No hay línea de menores donde reflejar el niño gratis de la promoción; este caso no se puede mostrar sin contradecir el total." };
  }
  return { ok: true, desglose: salida };
}

/**
 * Valor de UNA noche más, por pasajero: diferencia línea a línea entre la estadía de N+1 y la de N noches (referencia, nunca se suma al total).
 * Como cada línea ya es lo que se PAGA, la suma de las diferencias es exactamente `total(N+1) − total(N)`. Si la estructura cambia al alargar la estadía
 * (otra cantidad de pasajeros por línea o aparece/desaparece un niño gratis) no hay diferencia línea a línea honesta: devuelve `undefined` y la vista muestra solo el total.
 */
export function desgloseNocheAdicional(d0: readonly LineaDesglose[], d1: readonly LineaDesglose[]): LineaDesglose[] | undefined {
  const igual = d0.length === d1.length && d0.every((l, i) => l.clase === d1[i].clase && l.cantidad === d1[i].cantidad && l.menorDeDos === d1[i].menorDeDos && !!l.gratis === !!d1[i].gratis);
  if (!igual) return undefined;
  return d1.map((l, i) => {
    const a = d0[i];
    const base: LineaDesglose = { ...l, tarifa: r2(l.tarifa - a.tarifa), subtotal: r2(l.subtotal - a.subtotal) };
    if (l.gratis && a.gratis) {
      // Lo condonado EN ESA NOCHE: si esa noche no cae en la promoción no hay beneficio que explicar y el pasajero paga la noche completa.
      const condonado = r2(l.gratis.condonado - a.gratis.condonado);
      if (condonado > 0.005) base.gratis = { promociones: l.gratis.promociones, condonado };
      else delete base.gratis;
    }
    return base;
  });
}
