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

export function parseCalendarText(text: string, type: CalendarPrecision = "date"): string {
  if (parseCalendarValue(text, type)) return text;
  const pattern = displayPattern(type);
  if (!(type === "month" ? /^\d{2}\/\d{4}$/ : /^\d{2}\/\d{2}\/\d{4}$/).test(text)) return "";
  const date = parse(text, pattern, new Date(2000, 0, 1, 12));
  return isValid(date) && format(date, pattern) === text ? calendarValue(date, type) : "";
}

export function calendarError(text: string, type: CalendarPrecision, min?: string, max?: string): string {
  if (!text) return "";
  const value = parseCalendarText(text, type);
  if (!value) return type === "month" ? "Escribe un mes valido (mm/aaaa)." : "Escribe una fecha valida (dd/mm/aaaa).";
  if (min && parseCalendarValue(min, type) && value < min) return `Desde ${displayCalendarValue(min, type)}.`;
  if (max && parseCalendarValue(max, type) && value > max) return `Hasta ${displayCalendarValue(max, type)}.`;
  return "";
}
