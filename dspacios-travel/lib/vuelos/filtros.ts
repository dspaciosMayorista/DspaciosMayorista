// Helpers de filtro compartidos entre BloqueosTabla (Inventario) y
// ControlVuelosTabla — ambas tablas filtran por ruta/mes, y Control además
// por modalidad/emisión/pago. Puros y sin dependencias de React, para poder
// probarlos sin montar ningún componente.

export const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "YYYY-MM-DD" → "YYYY-MM" (clave de agrupación por mes). "" si no hay fecha. */
export function mesKey(f: string | null): string {
  return f ? f.slice(0, 7) : "";
}

/** "YYYY-MM" → "julio 2026". */
export function mesLabel(k: string): string {
  const [y, m] = k.split("-");
  return `${MESES[Number(m) - 1] ?? m} ${y}`;
}

// "" = todos; "sin_definir" = filas con el campo en null (nunca se muestran
// como si fueran 'pendiente'); cualquier otro valor = el valor exacto.
export const SIN_DEFINIR_VAL = "sin_definir";

export function matchControl(valor: string | null, filtro: string): boolean {
  if (!filtro) return true;
  if (filtro === SIN_DEFINIR_VAL) return valor == null;
  return valor === filtro;
}
