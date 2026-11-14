// Presentación de «Valores y Pagos» (#94/#52): filas que ve el cliente a partir de los grupos del resumen guardado. SOLO agrupa para mostrar; no recalcula ni cambia importes.
//   · UNA fila por unidad del paquete (y cobertura de servicios): adultos y niños juntos, UNA tarifa por tipo y el total.
//   · La tarifa de cada tipo se muestra con su PRECISIÓN DE CÁLCULO (subtotal exacto del tipo ÷ cantidad); el total de la fila es el exacto del resumen (el límite del dinero —el centavo— solo se redondea
//     en el total, nunca repartido entre pasajeros). No hay sublistas «1 × …», ni pasajeros con tarifas distintas por redondeo, ni línea de ajuste.
//   · Una diferencia REAL de tarifa (doble frente a sencilla, niño 1 frente a niño 2) o de cobertura sigue en filas separadas: eso no es redondeo. Nunca se fusiona nada incompatible.
import type { GrupoResumen, UnidadResumen } from "./resumenPrecios.ts";

export type FilaResumen = {
  clave: string;
  /** Fila del ajuste de redondeo (solo importe). */
  ajuste: boolean;
  adultos: number;
  ninos: number;
  /** Tarifa completa por persona (centavos, con su precisión de cálculo: puede traer fracción de centavo); 0 si la fila no tiene de ese tipo. */
  tarifaAdulto: number;
  tarifaNino: number;
  /** Suma de los subtotales de los grupos de la fila (centavos). */
  total: number;
};

const firmaCobertura = (g: GrupoResumen) => JSON.stringify(g.incluye);

const ORDEN_TIPO = ["adulto", "nino", "nino2", "infante"];
/**
 * Sin agrupar por cercanía: dos grupos del mismo tipo y cobertura son la misma tarifa solo si SON IGUALES. Se compara la tarifa exacta (`tarifaExactaCentavos`, que dice cuál es la tarifa real de cada grupo;
 * el centavo del reparto del residuo vive en `tarifaCentavos`, no en la exacta) y, en resúmenes históricos que no la traen, la tarifa guardada tal cual. Tarifas distintas se conservan separadas aunque
 * difieran un centavo (USD 100,00 y USD 100,01).
 */
const EPS_EXACTA = 1e-3; // centavos: la exacta se guarda redondeada a 4 decimales
const tarifaDe = (g: GrupoResumen) => g.tarifaExactaCentavos ?? g.tarifaCentavos;
const mismaTarifa = (a: GrupoResumen, b: GrupoResumen) => Math.abs(tarifaDe(a) - tarifaDe(b)) <= EPS_EXACTA;
type Parte = { g: GrupoResumen; i: number };
type Racimo = { tipo: string; partes: Parte[]; primero: number };
/** Agrupa, por tipo, los grupos cuyas tarifas solo difieren por el redondeo. Una diferencia real (doble frente a sencilla, niño 1 frente a niño 2) deja racimos distintos. */
function racimos(partes: Parte[]): Racimo[] {
  const out: Racimo[] = [];
  const tipos = [...new Set(partes.map((p) => p.g.tipo))];
  for (const t of tipos) {
    const delTipo = partes.filter((p) => p.g.tipo === t).sort((a, b) => tarifaDe(b.g) - tarifaDe(a.g) || a.i - b.i);
    let actual: Racimo | null = null;
    for (const p of delTipo) {
      if (!actual || !mismaTarifa(actual.partes[0].g, p.g)) { actual = { tipo: t, partes: [], primero: p.i }; out.push(actual); }
      actual.partes.push(p); actual.primero = Math.min(actual.primero, p.i);
    }
  }
  return out.sort((a, b) => a.primero - b.primero);
}
const cantidadDe = (r: Racimo[]) => r.reduce((n, x) => n + x.partes.reduce((m, p) => m + p.g.cantidad, 0), 0);
const totalDe = (r: Racimo[]) => r.reduce((n, x) => n + x.partes.reduce((m, p) => m + p.g.subtotalCentavos, 0), 0);
/** Tarifa por persona de un lado de la fila CON su precisión de cálculo: la `tarifaExactaCentavos` guardada (sin repartir el residuo entre pasajeros); en resúmenes anteriores, la de centavos enteros. */
const tarifaMedia = (r: Racimo[]) => {
  const n = cantidadDe(r);
  return n > 0 ? r.reduce((t, x) => t + x.partes.reduce((m, p) => m + (p.g.tarifaExactaCentavos ?? p.g.tarifaCentavos) * p.g.cantidad, 0), 0) / n : 0;
};
const claveDe = (ref: string, r: Racimo[]) => `${ref}-${r.flatMap((x) => x.partes.map((p) => p.i)).sort((a, b) => a - b).join("-")}`;
/**
 * Los resúmenes guardados ANTES (históricos) traen `ajusteCentavos` > 0. Al cliente no se le muestra «Ajuste por redondeo»: aquí se absorbe en los subtotales de la fila
 * (un centavo más a los primeros pasajeros, en el orden de los grupos) conservando EXACTAMENTE el total de la unidad; el registro guardado NO se modifica. Si no se puede identificar a cada pasajero (datos incompletos) se conserva el
 * ajuste como fila: nunca se inventa un reparto. Los resúmenes nuevos no traen ajuste y pasan intactos.
 */
export function absorberAjuste(u: UnidadResumen): { grupos: GrupoResumen[]; ajusteRestante: number } {
  if (!(u.ajusteCentavos > 0)) return { grupos: u.grupos, ajusteRestante: u.ajusteCentavos > 0 ? u.ajusteCentavos : 0 };
  const cupos = u.grupos.flatMap((g) => (g.cupos.length === g.cantidad ? g.cupos.map((id) => ({ id, tipo: g.tipo, tarifa: g.tarifaCentavos, incluye: g.incluye })) : []));
  const total = u.grupos.reduce((n, g) => n + g.cantidad, 0);
  if (!cupos.length || cupos.length !== total) return { grupos: u.grupos, ajusteRestante: u.ajusteCentavos };
  const base = Math.floor(u.ajusteCentavos / cupos.length);
  const resto = u.ajusteCentavos - base * cupos.length;
  cupos.forEach((c, i) => { c.tarifa += base + (i < resto ? 1 : 0); });
  const mapa = new Map<string, GrupoResumen>();
  for (const c of cupos) {
    const k = `${c.tipo}|${c.tarifa}|${c.incluye.join("")}`;
    const g = mapa.get(k) ?? { tipo: c.tipo, cantidad: 0, tarifaCentavos: c.tarifa, subtotalCentavos: 0, incluye: c.incluye, cupos: [] };
    g.cantidad += 1; g.subtotalCentavos += c.tarifa; g.cupos.push(c.id);
    mapa.set(k, g);
  }
  const grupos = [...mapa.values()].sort((a, b) => ORDEN_TIPO.indexOf(a.tipo) - ORDEN_TIPO.indexOf(b.tipo) || b.tarifaCentavos - a.tarifaCentavos || a.incluye.join("|").localeCompare(b.incluye.join("|")));
  return { grupos, ajusteRestante: 0 };
}

export function filasDeUnidad(unidad: UnidadResumen): FilaResumen[] {
  const filas: FilaResumen[] = [];
  const { grupos: gruposUnidad, ajusteRestante } = absorberAjuste(unidad);
  const u: UnidadResumen = { ...unidad, grupos: gruposUnidad, ajusteCentavos: ajusteRestante };
  const claves: string[] = [];
  for (const g of u.grupos) { const k = firmaCobertura(g); if (!claves.includes(k)) claves.push(k); }
  // Conserva el orden de los grupos: cada cobertura aparece en el lugar de su primer grupo.
  claves.forEach((k) => {
    const delaCobertura: Parte[] = u.grupos.map((g, i) => ({ g, i })).filter((x) => firmaCobertura(x.g) === k);
    const adultos = racimos(delaCobertura.filter((x) => x.g.tipo === "adulto"));
    const menores = racimos(delaCobertura.filter((x) => x.g.tipo !== "adulto"));
    const fila = (a: Racimo[], m: Racimo[]): FilaResumen => {
      return { clave: claveDe(u.ref, [...a, ...m]), ajuste: false, adultos: cantidadDe(a), ninos: cantidadDe(m), tarifaAdulto: tarifaMedia(a), tarifaNino: tarifaMedia(m), total: totalDe(a) + totalDe(m) };
    };
    // Una sola fila por unidad y cobertura cuando adultos y niños tienen cada uno UNA tarifa (las que solo difieren por el centavo del reparto cuentan como una): el niño nunca queda como otro paquete.
    if (adultos.length <= 1 && menores.length <= 1 && adultos.length + menores.length > 1) { filas.push(fila(adultos, menores)); return; }
    for (const r of [...adultos, ...menores].sort((x, y) => x.primero - y.primero)) filas.push(r.tipo === "adulto" ? fila([r], []) : fila([], [r]));
  });
  if (u.ajusteCentavos > 0) filas.push({ clave: `${u.ref}-ajuste`, ajuste: true, adultos: 0, ninos: 0, tarifaAdulto: 0, tarifaNino: 0, total: u.ajusteCentavos });
  return filas;
}
