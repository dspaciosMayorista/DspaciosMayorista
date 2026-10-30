// Regla del dueño (#90, empaquetados en USD): "todo tiquete que diga COP con valor por debajo de mil es USD sí o sí".
// Función PURA, compartida por los formularios de Empaquetados y de salidas dinámicas (cliente) y por la acción del
// servidor de Empaquetados. Un valor en COP por debajo de 1.000 no es una tarifa aérea real en pesos: casi siempre es un
// precio en dólares guardado con la moneda por omisión.

export const UMBRAL_COP_SOSPECHOSO = 1000;
export const PREGUNTA_VALOR_USD = "¿Este valor está en USD?";

export type MonedaVuelo = "COP" | "USD";

export function esMonedaVuelo(m: unknown): m is MonedaVuelo {
  return m === "COP" || m === "USD";
}

/** Etiquetas de los campos con valor positivo menor a 1.000 cuando la moneda es COP. Vacío = nada sospechoso. */
export function camposSospechososUsd(
  moneda: string | null | undefined,
  campos: readonly { etiqueta: string; valor: number | string | null | undefined }[]
): string[] {
  if (moneda !== "COP") return [];
  return campos
    .filter((c) => {
      const v = Number(c.valor);
      return Number.isFinite(v) && v > 0 && v < UMBRAL_COP_SOSPECHOSO;
    })
    .map((c) => c.etiqueta);
}

/** Mensaje para el usuario (formulario y servidor): bloquea el guardado hasta que corrija la moneda o el valor. */
export function mensajeValorSospechoso(etiquetas: readonly string[]): string {
  return `${PREGUNTA_VALOR_USD} ${etiquetas.join(", ")} está en COP con un valor menor a 1.000. Si es USD, cambia la moneda a USD; si de verdad es en pesos, corrige el valor.`;
}
