// #125 — La línea firmada del niño gratis («Niño gratis por habitación · promo (hab. 1: niño de 8 años (Niño 2))»). Se guarda como `adultos: 1 × tarifa_adulto negativa` solo porque el modo «total» de
// `contrato_items` no admite importes negativos y así Σ ítems = precio; NO es un adulto. Todo lector que cuente personas por fila debe reconocerla con esta única regla y no contarla.
export const ROTULO_LINEA_NINO_GRATIS = "Niño gratis por habitación";

/** ¿Es la línea firmada del niño gratis? En el carrito la descripción lleva el hotel delante («Hotel · Niño gratis por habitación · …»). */
export const esLineaNinoGratis = (descripcion: unknown): boolean =>
  typeof descripcion === "string" && (descripcion.startsWith(ROTULO_LINEA_NINO_GRATIS) || descripcion.includes(` · ${ROTULO_LINEA_NINO_GRATIS}`));
