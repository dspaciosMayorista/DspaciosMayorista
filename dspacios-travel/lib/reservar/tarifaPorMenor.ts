// Tarifa de venta de CADA menor para mostrarla bajo su edad (Vista Booking). No calcula precios: reparte las líneas que ya formaron el total
// (`tarifarMenores`, lib/reservar/menoresDeDos.ts), así lo mostrado siempre suma exactamente ese total. Puro, sin alias `@/`.
import { esMenorDeDos, type LineaMenor } from "./menoresDeDos.ts";

/**
 * Orden de `edades`. La clase de hotel sale de la edad (≤ `infanteMax` = infante; el resto, niño); los niños toman primero Niño 1 y luego
 * Niño 2 —igual que `contarMenoresDeDos`—. `null` = edad sin dato o sin línea que la cubra (el llamador explica el motivo; nunca se inventa un precio).
 */
export function tarifaPorMenor(
  edades: readonly (number | null)[],
  infanteMax: number,
  lineas: readonly LineaMenor[]
): ({ tarifa: number; menorDeDos: boolean } | null)[] {
  const expandir = (clases: readonly string[], menorDeDos: boolean): number[] =>
    lineas.filter((l) => clases.includes(l.clase) && l.menorDeDos === menorDeDos).flatMap((l) => Array<number>(l.cantidad).fill(l.tarifa));
  const bolsas = new Map<string, number[]>();
  for (const m2 of [true, false]) {
    bolsas.set(`infante|${m2}`, expandir(["infante"], m2));
    bolsas.set(`nino|${m2}`, [...expandir(["nino"], m2), ...expandir(["nino2"], m2)]);
  }
  return edades.map((e) => {
    if (e == null || !Number.isFinite(e)) return null;
    const m2 = esMenorDeDos(e);
    const tarifa = bolsas.get(`${e <= infanteMax ? "infante" : "nino"}|${m2}`)?.shift();
    return tarifa == null ? null : { tarifa, menorDeDos: m2 };
  });
}
