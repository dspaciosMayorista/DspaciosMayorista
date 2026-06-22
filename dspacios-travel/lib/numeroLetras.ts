// Convierte un monto a su representación en letras (español), para recibos de
// caja. Función pura. Soporta enteros hasta los millones; los decimales se
// omiten (los montos de turismo se manejan en pesos/dólares enteros).

const UNIDADES = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const ESPECIALES: Record<number, string> = {
  10: "diez", 11: "once", 12: "doce", 13: "trece", 14: "catorce", 15: "quince",
  16: "dieciséis", 17: "diecisiete", 18: "dieciocho", 19: "diecinueve",
  20: "veinte", 21: "veintiuno", 22: "veintidós", 23: "veintitrés", 24: "veinticuatro",
  25: "veinticinco", 26: "veintiséis", 27: "veintisiete", 28: "veintiocho", 29: "veintinueve",
};
const DECENAS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function hasta99(n: number): string {
  if (n < 10) return UNIDADES[n];
  if (ESPECIALES[n]) return ESPECIALES[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? DECENAS[d] : `${DECENAS[d]} y ${UNIDADES[u]}`;
}

function hasta999(n: number): string {
  if (n === 100) return "cien";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const pre = CENTENAS[c];
  return resto === 0 ? pre : `${pre} ${hasta99(resto)}`.trim();
}

function hasta999999(n: number): string {
  if (n < 1000) return hasta999(n);
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  const milTexto = miles === 1 ? "mil" : `${hasta999(miles)} mil`;
  return resto === 0 ? milTexto : `${milTexto} ${hasta999(resto)}`;
}

function enteroEnLetras(n: number): string {
  if (n === 0) return "cero";
  if (n < 1_000_000) return hasta999999(n);
  const millones = Math.floor(n / 1_000_000);
  const resto = n % 1_000_000;
  const millonTexto = millones === 1 ? "un millón" : `${hasta999999(millones)} millones`;
  return resto === 0 ? millonTexto : `${millonTexto} ${hasta999999(resto)}`;
}

/** "un millón quinientos mil pesos m/cte." o "... dólares". */
export function enLetras(valor: number, moneda?: string | null): string {
  const n = Math.round(Math.abs(valor));
  const texto = enteroEnLetras(n);
  const esUSD = (moneda ?? "COP").toUpperCase() === "USD";
  const unidad = esUSD ? "dólares estadounidenses" : "pesos m/cte.";
  return `${texto} ${unidad}`;
}
