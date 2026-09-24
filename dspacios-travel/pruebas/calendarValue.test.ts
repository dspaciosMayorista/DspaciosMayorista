import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarError, calendarValue, displayCalendarValue, parseCalendarText, parseCalendarValue } from "../lib/calendarValue.ts";

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
