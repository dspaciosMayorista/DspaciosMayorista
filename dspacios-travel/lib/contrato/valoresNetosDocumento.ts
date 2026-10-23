import { valorVisibleContratoItem, type ContratoItemValor } from "@/lib/contrato/valorContratoItem";

type ItemConId = ContratoItemValor & { id: number };

export type ValorNetoItemDocumento = {
  total: number;
  tarifaAdulto: number;
  tarifaNino: number;
  adultoAproximado: boolean;
  ninoAproximado: boolean;
};

/**
 * Reparte el total exigible NETO entre las mismas líneas que originaron el PVP.
 * Los importes originales de contrato_items son PVP, así que nunca se imprimen
 * directamente en un documento NETO. El reparto se hace en centavos y el
 * residuo va a las mayores fracciones: los subtotales suman exactamente el
 * total exigible. Las tarifas unitarias se muestran como promedio cuando un
 * centavo residual impide repartir por igual entre varias personas.
 *
 * Si el total no puede conciliarse con los ítems, devolvemos null para que el
 * documento siga mostrando solo el total exigible sin inventar precios.
 */
export function valoresNetosDocumento(
  items: readonly ItemConId[],
  totalExigible: number,
): Map<number, ValorNetoItemDocumento> | null {
  const netoCentavos = Math.round(totalExigible * 100);
  if (!Number.isSafeInteger(netoCentavos) || netoCentavos < 0) return null;

  type Parte = { id: number; tipo: "adulto" | "nino" | "total"; peso: number; centavos: number; resto: number };
  const partes: Parte[] = [];
  const ids = new Set<number>();
  let brutoCentavos = 0;
  for (const item of items) {
    if (!Number.isSafeInteger(item.id) || ids.has(item.id)) return null;
    ids.add(item.id);
    const valor = valorVisibleContratoItem(item);
    if (!Number.isFinite(valor) || valor < 0) return null;
    const brutoItem = Math.round(valor * 100);
    if (!Number.isSafeInteger(brutoItem)) return null;
    brutoCentavos += brutoItem;
    if (!Number.isSafeInteger(brutoCentavos)) return null;

    if (item.modo_precio === "total") {
      partes.push({ id: item.id, tipo: "total", peso: brutoItem, centavos: 0, resto: 0 });
      continue;
    }
    const adultos = Number(item.adultos);
    const ninos = Number(item.ninos);
    if (!Number.isSafeInteger(adultos) || adultos < 0 || !Number.isSafeInteger(ninos) || ninos < 0) return null;
    const pesoAdulto = Math.round(adultos * Number(item.tarifa_adulto) * 100);
    const pesoNino = Math.round(ninos * Number(item.tarifa_nino) * 100);
    if (!Number.isSafeInteger(pesoAdulto) || pesoAdulto < 0 || !Number.isSafeInteger(pesoNino) || pesoNino < 0) return null;
    if (Math.abs(pesoAdulto + pesoNino - brutoItem) > 1) return null;
    partes.push({ id: item.id, tipo: "adulto", peso: pesoAdulto, centavos: 0, resto: 0 });
    partes.push({ id: item.id, tipo: "nino", peso: pesoNino, centavos: 0, resto: 0 });
  }
  if (netoCentavos > brutoCentavos || (brutoCentavos === 0 && netoCentavos !== 0)) return null;

  if (brutoCentavos > 0) {
    let repartidos = 0;
    for (const parte of partes) {
      const exacto = (netoCentavos * parte.peso) / brutoCentavos;
      parte.centavos = Math.floor(exacto);
      parte.resto = exacto - parte.centavos;
      repartidos += parte.centavos;
    }
    const candidatos = partes.filter((parte) => parte.peso > 0).sort((a, b) => b.resto - a.resto);
    for (let i = 0; i < netoCentavos - repartidos; i++) candidatos[i % candidatos.length].centavos++;
  }

  const resultado = new Map<number, ValorNetoItemDocumento>();
  for (const item of items) {
    const adulto = partes.find((p) => p.id === item.id && p.tipo === "adulto")?.centavos ?? 0;
    const nino = partes.find((p) => p.id === item.id && p.tipo === "nino")?.centavos ?? 0;
    const total = partes.find((p) => p.id === item.id && p.tipo === "total")?.centavos ?? 0;
    const adultos = item.modo_precio === "total" ? 0 : Number(item.adultos);
    const ninos = item.modo_precio === "total" ? 0 : Number(item.ninos);
    resultado.set(item.id, {
      total: (adulto + nino + total) / 100,
      tarifaAdulto: adultos > 0 ? adulto / adultos / 100 : 0,
      tarifaNino: ninos > 0 ? nino / ninos / 100 : 0,
      adultoAproximado: adultos > 0 && adulto % adultos !== 0,
      ninoAproximado: ninos > 0 && nino % ninos !== 0,
    });
  }
  return resultado;
}
