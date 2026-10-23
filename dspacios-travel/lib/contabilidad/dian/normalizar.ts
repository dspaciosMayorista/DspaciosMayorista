// Normalizadores PUROS de compras DIAN. Sin imports, sin I/O, sin estado.
//
// Una sola regla en todo el archivo: normalizar es QUITAR formato, nunca
// inventar. Si un valor no se puede convertir con certeza, se devuelve `null` y
// quien llama decide — nunca se devuelve un número "aproximado" que después se
// cuele en el total.

const RE_TODO_NO_ALFA = /[^0-9A-Za-zÁÉÍÓÚÑáéíóúñ]/g;
const RE_NO_ALFA = /[^0-9A-Za-z]/g;
const RE_NO_DIGITO = /[^0-9]/g;

function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Sin tildes y en mayúsculas, para poder comparar palabras de dos fuentes distintas. */
function sinTildes(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

/**
 * Deja solo dígitos. Se usa para NIT, cuentas, códigos de impuesto y valores que
 * la DIAN manda como texto. El punto de miles, el guion y los espacios son
 * ruido de formato, no información.
 *
 * OJO: las LETRAS no se conservan. Una columna de NIT con basura ("SIN NIT",
 * "N/A") tiene que quedar vacía, no convertirse en un NIT de seis letras que
 * después cruce contra proveedores.
 */
export function soloDigitos(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  return String(valor).replace(RE_NO_DIGITO, "");
}

/** Sin tildes ni signos, solo letras: para comparar nombres y encabezados. */
export function soloLetras(valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  return String(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(RE_NO_ALFA, "").toUpperCase();
}

/**
 * NIT colombiano: 9 dígitos (a veces 10 con el dígito de verificación pegado al
 * final) y un DV de 0 a 9. Acepta las tres formas que llegan de las fuentes
 * distintas: "900123456-7", "900.123.456-7" y "NIT 9001234567".
 *
 * `pais` se devuelve aparte porque hay NIT de otros países que la DIAN también
 * valida y no siguen este módulo.
 */
export type NitParseado = {
  nit: string;
  dv: string | null;
  pais: string | null;
};

export function normalizarNit(valor: string | null | undefined): NitParseado | null {
  if (valor === null || valor === undefined) return null;
  const bruto = String(valor).trim();
  if (!bruto) return null;

  // Primero se separa el DV si viene explícito como dígito suelto tras un
  // separador ("900123456-7", "900.123.456-7"). El separador real es "-";
  // los demás signos se ignoran solo como formato.
  const m = bruto.match(/^[^0-9]*([0-9]{6,10})\s*[-–—]\s*([0-9])\b/);
  if (m) {
    const digitos = m[1];
    const dv = m[2];
    return digitos.length === 10
      ? { nit: digitos.slice(0, 9), dv, pais: null }
      : { nit: digitos, dv, pais: null };
  }

  const digitos = soloDigitos(bruto);
  if (digitos.length < 6 || digitos.length > 12) return null;
  if (digitos.length === 10) return { nit: digitos.slice(0, 9), dv: digitos.slice(9), pais: null };
  return { nit: digitos, dv: null, pais: null };
}

/** DV sin guion: 0-9 o `null`. */
export function normalizarDv(valor: string | number | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const d = soloDigitos(valor);
  if (d.length !== 1) return null;
  return d;
}

/**
 * CUFE / CUDE: cadena alfanumérica sin guiones ni espacios. Solo se acepta si
 * tiene largo de CUFE (>= 40 caracteres) — un número de documento corto que se
 * colara en esta variable no se guarda como si fuera el CUFE, y se reporta.
 */
export function normalizarCufe(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const u = String(valor).replace(RE_TODO_NO_ALFA, "").toUpperCase();
  return u === "" ? null : u;
}

export const LARGO_CUFE_MINIMO = 40;

export function pareceCufe(valor: string | null | undefined): boolean {
  const u = normalizarCufe(valor);
  return u !== null && u.length >= LARGO_CUFE_MINIMO;
}

/**
 * Código de moneda ISO 4217 en mayúsculas de 3 letras. El XML llega como
 * "COP"/"USD" y el Excel a veces como "$" o "COL"; esos alias se traducen.
 */
const ALIAS_MONEDA: Record<string, string> = {
  $: "COP",
  COP: "COP",
  COL: "COP",
  PESO: "COP",
  PESOS: "COP",
  US$: "USD",
  USD: "USD",
  DOLAR: "USD",
  DOLARES: "USD",
  EUR: "EUR",
  EURO: "EUR",
  EUROS: "EUR",
};

export function normalizarMoneda(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const crudo = String(valor).trim();
  if (!crudo) return null;
  const clave = sinTildes(crudo).trim();
  const porAlias = ALIAS_MONEDA[clave];
  if (porAlias) return porAlias;
  const letras = clave.replace(RE_NO_ALFA, "");
  return letras.length === 3 ? letras : null;
}

/**
 * Monto a número. Acepta el formato colombiano (punto de miles, coma decimal)
 * y el formato US (coma de miles, punto decimal), y descarta el símbolo de
 * moneda. Si no queda nada que sea número devuelve `null` — nunca 0: un total
 * que no se pudo leer NO es un total en cero, y confundirlos es justo lo que
 * hace cuadrar una compra que no cuadra.
 *
 * Regla para decidir qué separador es decimal (los documentos traen los dos
 * formatos mezclados y adivinar mal cambia el total por un factor de mil):
 *
 *   · hay coma Y punto           → el ÚLTIMO que aparece es el decimal;
 *   · un separador que se repite → todos son de miles ("1.190.000");
 *   · un solo separador          → decimal si le siguen 1-2 dígitos
 *                                  ("0,19", "1500.5"); de miles si le siguen
 *                                  3 ("1.190", "1,190.000").
 */
export function normalizarMonto(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? redondear2(valor) : null;

  let s = String(valor).trim();
  if (!s) return null;

  const negativoPorParentesis = /^\(.*\)$/.test(s);
  if (negativoPorParentesis) s = s.slice(1, -1);

  // Más de un signo menos no es un número: es basura.
  if ((s.match(/-/g) ?? []).length > 1) return null;

  // Se quitan moneda, letras y espacios; solo quedan dígitos, coma, punto y signo.
  s = s.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(s)) return null;

  const comas = (s.match(/,/g) ?? []).length;
  const puntos = (s.match(/\./g) ?? []).length;

  if (comas > 0 && puntos > 0) {
    // El último separador es el decimal; los anteriores son de miles.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (comas > 1) {
    s = s.replace(/,/g, "");
  } else if (puntos > 1) {
    s = s.replace(/\./g, "");
  } else if (comas === 1) {
    s = /,\d{3}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (puntos === 1) {
    s = /\.\d{3}$/.test(s) ? s.replace(/\./g, "") : s;
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return redondear2(negativoPorParentesis ? -Math.abs(n) : n);
}

/**
 * Fecha DIAN a `YYYY-MM-DD`. Acepta el formato con hora y zona
 * ("2026-03-02T10:00:00-05:00") y lo recorta al día; también acepta el año de 4
 * dígitos pegado ("20260302"), que es como lo mandan algunos exports.
 */
export function normalizarFecha(valor: string | number | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) {
    const mes = Number(m[2]);
    const dia = Number(m[3]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    return `${m[1]}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }

  // Formato dd/mm/yyyy sin pesos ni dos puntos (Excel a veces lo reparte).
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    return `${m[3]}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }
  return null;
}

/** Periodo `YYYY-MM` derivado de una fecha normalizada. */
export function periodoDe(fecha: string | null | undefined): string | null {
  if (!fecha) return null;
  const f = normalizarFecha(fecha);
  return f ? f.slice(0, 7) : null;
}

/**
 * Texto legible sin acentos raros, espacios dobles ni comillas: se usa para
 * comparar encabezados del Excel entre sí.
 */
export function claveTexto(valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  return String(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(RE_TODO_NO_ALFA, " ")
    .replace(/\s+/g, " ")
    .trim();
}
