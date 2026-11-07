// Presentación de «Valores y Pagos» (#94/#52): filas que ve el cliente a partir de los grupos del resumen guardado. SOLO agrupa para mostrar; no recalcula ni cambia importes.
//   · Adultos y niños van en la MISMA fila cuando son del mismo paquete (unidad), tienen la misma cobertura de servicios y cada lado tiene UNA sola tarifa completa.
//   · Si cambia la cobertura, o hay tarifas distintas dentro del mismo tipo (adultos con tarifas diferentes, o niños/infantes con tarifas diferentes), los grupos quedan en filas
//     separadas. Nunca se promedia ni se fusiona nada incompatible.
import type { GrupoResumen, UnidadResumen } from "./resumenPrecios.ts";

export type FilaResumen = {
  clave: string;
  /** Fila del ajuste de redondeo (solo importe). */
  ajuste: boolean;
  adultos: number;
  ninos: number;
  /** Tarifa completa por persona (centavos); 0 si la fila no tiene de ese tipo. */
  tarifaAdulto: number;
  tarifaNino: number;
  /** Suma de los subtotales de los grupos de la fila (centavos). */
  total: number;
};

const firmaCobertura = (g: GrupoResumen) => JSON.stringify(g.incluye);

export function filasDeUnidad(u: UnidadResumen): FilaResumen[] {
  const filas: FilaResumen[] = [];
  const claves: string[] = [];
  for (const g of u.grupos) { const k = firmaCobertura(g); if (!claves.includes(k)) claves.push(k); }
  // Conserva el orden de los grupos: cada cobertura aparece en el lugar de su primer grupo.
  claves.forEach((k) => {
    const delaCobertura = u.grupos.map((g, i) => ({ g, i })).filter((x) => firmaCobertura(x.g) === k);
    const adultos = delaCobertura.filter((x) => x.g.tipo === "adulto");
    const menores = delaCobertura.filter((x) => x.g.tipo !== "adulto");
    const combinable = adultos.length <= 1 && menores.length <= 1 && adultos.length + menores.length > 1;
    if (combinable) {
      const [a, m] = [adultos[0], menores[0]];
      filas.push({
        clave: `${u.ref}-${a.i}-${m.i}`, ajuste: false, adultos: a.g.cantidad, ninos: m.g.cantidad,
        tarifaAdulto: a.g.tarifaCentavos, tarifaNino: m.g.tarifaCentavos, total: a.g.subtotalCentavos + m.g.subtotalCentavos,
      });
      return;
    }
    for (const x of delaCobertura) {
      const esAdulto = x.g.tipo === "adulto";
      filas.push({
        clave: `${u.ref}-${x.i}`, ajuste: false, adultos: esAdulto ? x.g.cantidad : 0, ninos: esAdulto ? 0 : x.g.cantidad,
        tarifaAdulto: esAdulto ? x.g.tarifaCentavos : 0, tarifaNino: esAdulto ? 0 : x.g.tarifaCentavos, total: x.g.subtotalCentavos,
      });
    }
  });
  if (u.ajusteCentavos > 0) filas.push({ clave: `${u.ref}-ajuste`, ajuste: true, adultos: 0, ninos: 0, tarifaAdulto: 0, tarifaNino: 0, total: u.ajusteCentavos });
  return filas;
}
