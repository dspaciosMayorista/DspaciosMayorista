// Convierte un monto en pesos colombianos a su expresión en letras, para el
// "DEBE LA SUMA DE ... (Un millón doscientos mil pesos)" de la cuenta de
// cobro. Sin dependencias externas. Soporta hasta ~999.999 millones (de
// sobra para cualquier comisión real).

const UNIDADES = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const DECENAS_10_19 = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
// 20-29 se escriben en una sola palabra (RAE); el resto usa "treinta y X".
const VEINTES = ["veinte", "veintiún", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const DECENAS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

// 0-999
function trescientos(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  let out = c > 0 ? CENTENAS[c] : "";
  if (resto > 0) {
    out += out ? " " : "";
    if (resto < 10) out += UNIDADES[resto];
    else if (resto < 20) out += DECENAS_10_19[resto - 10];
    else if (resto < 30) out += VEINTES[resto - 20];
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      out += DECENAS[d] + (u > 0 ? ` y ${UNIDADES[u]}` : "");
    }
  }
  return out;
}

// 0-999.999
function seisDigitos(n: number): string {
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  let out = "";
  if (miles > 0) out = miles === 1 ? "mil" : `${trescientos(miles)} mil`;
  if (resto > 0) out += (out ? " " : "") + trescientos(resto);
  return out;
}

export function numeroEnLetras(valor: number): string {
  const n = Math.round(Math.abs(valor));
  if (n === 0) return "cero";

  const millones = Math.floor(n / 1_000_000);
  const resto = n % 1_000_000;

  const partes: string[] = [];
  if (millones > 0) partes.push(millones === 1 ? "un millón" : `${seisDigitos(millones)} millones`);
  if (resto > 0 || partes.length === 0) partes.push(seisDigitos(resto) || "cero");

  return partes.join(" ").replace(/\s+/g, " ").trim();
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "$1.260.904" → "Un millón doscientos sesenta mil novecientos cuatro pesos"
// Cuando el monto es un múltiplo exacto de millón (ej. $1.000.000), la
// gramática exige "de" antes del sustantivo: "Un millón DE pesos".
export function pesosEnLetras(valor: number, moneda: "COP" | "USD" = "COP"): string {
  const n = Math.round(Math.abs(valor));
  const letras = numeroEnLetras(n);
  const sufijo = n === 1 ? (moneda === "USD" ? "dólar" : "peso") : moneda === "USD" ? "dólares" : "pesos";
  const esMultiploDeMillon = n > 0 && n % 1_000_000 === 0;
  return `${capitalizar(letras)}${esMultiploDeMillon ? " de" : ""} ${sufijo}`;
}
