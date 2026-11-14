import { format, isValid, parse } from "date-fns";

export type CalendarPrecision = "date" | "month";

const storagePattern = (type: CalendarPrecision) => type === "month" ? "yyyy-MM" : "yyyy-MM-dd";
const displayPattern = (type: CalendarPrecision) => type === "month" ? "MM/yyyy" : "dd/MM/yyyy";

// Calendar dates are local civil dates. Never serialize them through UTC.
export function parseCalendarValue(value: string, type: CalendarPrecision = "date"): Date | undefined {
  const pattern = storagePattern(type);
  if (!(type === "month" ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/).test(value)) return;
  const date = parse(value, pattern, new Date(2000, 0, 1, 12));
  if (!isValid(date) || format(date, pattern) !== value) return;
  date.setHours(12, 0, 0, 0);
  return date;
}

export function calendarValue(date: Date, type: CalendarPrecision = "date"): string {
  return format(date, storagePattern(type));
}

export function displayCalendarValue(value: string, type: CalendarPrecision = "date"): string {
  const date = parseCalendarValue(value, type);
  return date ? format(date, displayPattern(type)) : "";
}

/** Año de dos dígitos (#15, regla aprobada por el dueño 2026-11-12): ventana de 100 años desde el año actual − 69
 *  hasta el año actual + 30. En 2026: 00–56 → 2000–2056 y 57–99 → 1957–1999 (viajes y nacimientos).
 *  Un año escrito con cuatro dígitos se usa tal cual; nunca pasa por esta ventana. */
export function anioDeDosDigitos(aa: number, anioActual = new Date().getFullYear()): number {
  let y = Math.floor(anioActual / 100) * 100 + aa;
  if (y > anioActual + 30) y -= 100;
  else if (y < anioActual - 69) y += 100;
  return y;
}

function isoSiExiste(d: string, m: string, y: number): string {
  const iso = `${String(y).padStart(4, "0")}-${m}-${d}`;
  return parseCalendarValue(iso) ? iso : ""; // 31/04 o 29/02 no bisiesto: rechazado, nunca corrido a otro día
}

/** Texto escrito o pegado → ISO, o "" si no es una fecha completa y real.
 *  Fechas: AAAA-MM-DD, DD/MM/AAAA, DDMMAAAA y, con `anioCorto` (por defecto), DDMMAA y DD/MM/AA.
 *  El campo pasa `anioCorto: false` mientras se escribe: "090520" es el comienzo de "09052026". */
export function parseCalendarText(text: string, type: CalendarPrecision = "date", opts: { anioCorto?: boolean; anioActual?: number } = {}): string {
  text = text.trim();
  if (parseCalendarValue(text, type)) return text;
  if (type === "month") {
    if (!/^\d{2}\/\d{4}$/.test(text)) return "";
    const date = parse(text, displayPattern(type), new Date(2000, 0, 1, 12));
    return isValid(date) && format(date, displayPattern(type)) === text ? calendarValue(date, type) : "";
  }
  const largo = /^(\d{2})(\d{2})(\d{4})$/.exec(text) ?? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (largo) return isoSiExiste(largo[1], largo[2], Number(largo[3]));
  const corto = /^(\d{2})(\d{2})(\d{2})$/.exec(text) ?? /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(text);
  if (corto && opts.anioCorto !== false) return isoSiExiste(corto[1], corto[2], anioDeDosDigitos(Number(corto[3]), opts.anioActual));
  return "";
}

export function calendarError(text: string, type: CalendarPrecision, min?: string, max?: string): string {
  if (!text) return "";
  const value = parseCalendarText(text, type);
  if (!value) return type === "month" ? "Escribe un mes valido (mm/aaaa)." : "Escribe una fecha valida (dd/mm/aaaa o ddmmaaaa).";
  if (min && parseCalendarValue(min, type) && value < min) return `Desde ${displayCalendarValue(min, type)}.`;
  if (max && parseCalendarValue(max, type) && value > max) return `Hasta ${displayCalendarValue(max, type)}.`;
  return "";
}
