import { test } from "node:test";
import assert from "node:assert/strict";
import { anioDeDosDigitos, calendarError, calendarValue, displayCalendarValue, parseCalendarText, parseCalendarValue } from "../lib/calendarValue.ts";

test("civil dates round-trip without UTC conversion", () => {
  for (const value of ["2026-09-23", "1980-02-29", "2000-01-01", "2026-12-31"]) {
    const date = parseCalendarValue(value);
    assert.ok(date);
    assert.equal(calendarValue(date), value);
    assert.equal(parseCalendarText(displayCalendarValue(value)), value);
  }
});
test("invalid, incomplete and non-leap dates cannot become stored dates", () => {
  for (const value of ["2025-02-29", "2026-13-01", "2026-09-31", "2026-9-1", "23/09/", "31/04/2026"]) {
    assert.equal(parseCalendarText(value), "");
  }
  assert.equal(parseCalendarText("29/02/2024"), "2024-02-29");
  assert.equal(parseCalendarText(""), "");
});
test("inclusive min and max preserve the boundary day", () => {
  assert.equal(calendarError("23/09/2026", "date", "2026-09-23", "2026-09-23"), "");
  assert.match(calendarError("22/09/2026", "date", "2026-09-23"), /Desde/);
  assert.match(calendarError("24/09/2026", "date", undefined, "2026-09-23"), /Hasta/);
});
test("month fields keep YYYY-MM and do not invent a day", () => {
  assert.equal(parseCalendarText("09/2026", "month"), "2026-09");
  assert.equal(displayCalendarValue("2026-09", "month"), "09/2026");
  assert.equal(parseCalendarText("13/2026", "month"), "");
  assert.equal(calendarError("02/2026", "month", "2026-02", "2027-03"), "");
  assert.match(calendarError("01/2026", "month", "2026-02"), /Desde/);
});
test("#15 formatos compactos: DDMMAAAA, DDMMAA y DD/MM/AA representan la misma fecha", () => {
  for (const t of ["09052026", "090526", "09/05/26", "09/05/2026", " 09052026 "]) assert.equal(parseCalendarText(t, "date", { anioActual: 2026 }), "2026-05-09", t);
  assert.equal(parseCalendarText("200526", "date", { anioActual: 2026 }), "2026-05-20");
  assert.equal(parseCalendarText("091026", "date", { anioActual: 2026 }), "2026-10-09");
});
test("#15 imposibles y bisiestos sin normalización silenciosa", () => {
  for (const t of ["31042026", "310426", "32/01/26", "00012026", "01132026", "29022025", "290225", "0905202", "09/05/2", "9/5/2026", "09-05-2026", "0905-2026"]) {
    assert.equal(parseCalendarText(t, "date", { anioActual: 2026 }), "", t);
  }
  assert.equal(parseCalendarText("29022024"), "2024-02-29");
  assert.equal(parseCalendarText("290224", "date", { anioActual: 2026 }), "2024-02-29");
  assert.equal(parseCalendarText("290200", "date", { anioActual: 2026 }), "2000-02-29");
});
test("#15 escritura parcial: sin anioCorto el prefijo de 6 dígitos no se toma como fecha", () => {
  assert.equal(parseCalendarText("090520", "date", { anioCorto: false }), "");
  assert.equal(parseCalendarText("09/05/20", "date", { anioCorto: false }), "");
  assert.equal(parseCalendarText("09052026", "date", { anioCorto: false }), "2026-05-09");
});
test("#15 año de dos dígitos (aprobado): ventana del año actual − 69 al año actual + 30", () => {
  assert.equal(anioDeDosDigitos(26, 2026), 2026);
  assert.equal(anioDeDosDigitos(56, 2026), 2056); // frontera superior: +30
  assert.equal(anioDeDosDigitos(57, 2026), 1957); // frontera inferior: −69
  assert.equal(anioDeDosDigitos(99, 2026), 1999);
  assert.equal(anioDeDosDigitos(10, 2080), 2110); // 2010 < 2011 → siglo siguiente
  assert.equal(anioDeDosDigitos(11, 2080), 2011); // 2011 = 2080 − 69, dentro
  assert.equal(anioDeDosDigitos(85, 2026), 1985);
  assert.equal(anioDeDosDigitos(0, 2026), 2000);
  assert.equal(anioDeDosDigitos(10, 2095), 2110);
});
test("#15 el mes no acepta formatos de fecha", () => {
  assert.equal(parseCalendarText("092026", "month"), "");
  assert.equal(calendarError("090526", "date", "2026-06-01"), "Desde 01/06/2026.");
});
test("#15 la ventana aprobada aplica a DDMMAA y DD/MM/AA; el año de cuatro dígitos se usa tal cual", () => {
  assert.equal(parseCalendarText("010156", "date", { anioActual: 2026 }), "2056-01-01");
  assert.equal(parseCalendarText("01/01/57", "date", { anioActual: 2026 }), "1957-01-01");
  assert.equal(parseCalendarText("01011957", "date", { anioActual: 2026 }), "1957-01-01");
  assert.equal(parseCalendarText("01012057", "date", { anioActual: 2026 }), "2057-01-01"); // fuera de la ventana, pero explícito
  assert.equal(parseCalendarText("01/01/1900", "date", { anioActual: 2026 }), "1900-01-01");
});
