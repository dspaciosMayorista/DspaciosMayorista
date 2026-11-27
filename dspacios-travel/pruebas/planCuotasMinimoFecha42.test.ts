// #42 / B95-4 — el mínimo configurado manda (incluido el cero), «hoy» es el día de NEGOCIO de Bogotá y los importes conservan su precisión. Valores esperados calculados a mano.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { planDeCuotas } from "../lib/calc/cuotas.ts";
import { fechaNegocio, sumarDiasIso } from "../lib/fechaNegocio.ts";

// hoy = 2026-11-23, viaje 2027-03-01 → cuotas el 1-dic-2026, 1-ene-2027 y 1-feb-2027 (la última, un mes antes del check-in).
const base = { checkIn: "2027-03-01", hoy: "2026-11-23" };

test("mínimo 0 % y nada pagado: NO se convierte en 30 %; no hay abono inicial (una fila en $0 no es un cobro) y las 3 cuotas suman el total", () => {
  const p = planDeCuotas({ ...base, precio: 1_000_000, pctAbono: 0 });
  assert.deepEqual(p.map((c) => [c.tipo, c.fecha, c.monto]), [["cuota", "2026-12-01", 333_333], ["cuota", "2027-01-01", 333_333], ["cuota", "2027-02-01", 333_334]]);
});

test("mínimo 0 % con 250.000 ya pagados: la fila inicial es lo pagado y el saldo (750.000) se reparte en 3 cuotas de 250.000", () => {
  const p = planDeCuotas({ ...base, precio: 1_000_000, pctAbono: 0, pagado: 250_000 });
  assert.deepEqual(p.map((c) => c.monto), [250_000, 250_000, 250_000, 250_000]);
  assert.equal(p[0].tipo, "abono");
});

test("sin valor configurado (NaN / indefinido) rige el 30 % de siempre; un 30 % explícito da lo mismo", () => {
  const esperado = [300_000, 233_333, 233_333, 233_334];
  for (const pctAbono of [Number.NaN, undefined as unknown as number, 0.3]) {
    assert.deepEqual(planDeCuotas({ ...base, precio: 1_000_000, pctAbono }).map((c) => c.monto), esperado, String(pctAbono));
  }
});

test("mínimo mayor que 100 % se acota a 100 % (todo el valor, sin cuotas)", () => {
  assert.deepEqual(planDeCuotas({ ...base, precio: 1_000_000, pctAbono: 7 }).map((c) => [c.tipo, c.monto]), [["abono", 1_000_000]]);
});

test("precisión: COP en pesos enteros y USD a centavos, con mínimo 0 (sin pérdida ni centavos de más)", () => {
  assert.deepEqual(planDeCuotas({ ...base, precio: 100.5, pctAbono: 0, moneda: "USD" }).map((c) => c.monto), [33.5, 33.5, 33.5]);
  assert.deepEqual(planDeCuotas({ ...base, precio: 100.51, pctAbono: 0, moneda: "USD" }).map((c) => c.monto), [33.5, 33.5, 33.51]);
  assert.deepEqual(planDeCuotas({ ...base, precio: 1_000_001, pctAbono: 0 }).map((c) => c.monto), [333_333, 333_333, 333_335]);
  for (const [precio, moneda] of [[100.51, "USD"], [1_000_001, "COP"]] as const) {
    const suma = planDeCuotas({ ...base, precio, pctAbono: 0, moneda }).reduce((s, c) => s + Math.round(c.monto * (moneda === "USD" ? 100 : 1)), 0);
    assert.equal(suma, Math.round(precio * (moneda === "USD" ? 100 : 1)));
  }
});

test("BOGOTÁ: «hoy» sale del día de negocio, no del reloj UTC (frontera a medianoche de Bogotá = 05:00 UTC)", () => {
  const casos: [string, string][] = [
    ["2026-11-24T04:59:59.000Z", "2026-11-23"],   // 23:59:59 en Bogotá: todavía el 23 (el reloj UTC ya diría el 24 desde las 00:00Z)
    ["2026-11-24T05:00:00.000Z", "2026-11-24"],   // 00:00:00 en Bogotá
    ["2026-11-24T00:30:00.000Z", "2026-11-23"],   // 19:30 en Bogotá (después de las 7 p. m.): ya es «mañana» en UTC
    ["2026-12-31T23:59:59.000Z", "2026-12-31"],   // 18:59:59 en Bogotá
    ["2027-01-01T04:59:59.000Z", "2026-12-31"],   // cambio de año
    ["2027-01-01T05:00:00.000Z", "2027-01-01"],
  ];
  for (const [utc, bogota] of casos) assert.equal(fechaNegocio(new Date(utc)), bogota, utc);
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-24T03:00:00.000Z") }); // 22:00 del 23 en Bogotá
  try {
    const p = planDeCuotas({ checkIn: "2027-03-01", precio: 1_000_000, pctAbono: 0.3 });
    assert.equal(p[0].fecha, "2026-11-23", "el abono inicial vence HOY de Bogotá (el 23), no el 24 de UTC");
    mock.timers.setTime(new Date("2026-11-24T05:00:00.000Z").getTime());
    assert.equal(planDeCuotas({ checkIn: "2027-03-01", precio: 1_000_000, pctAbono: 0.3 })[0].fecha, "2026-11-24");
  } finally { mock.timers.reset(); }
});

test("frontera con el día de negocio: a las 23:00 del 30-ene de Bogotá (ya 31 en UTC) queda UNA cuota futura (1-feb) y el abono vence el 30", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2027-01-31T04:00:00.000Z") }); // 23:00 del 30-ene en Bogotá
  try {
    const p = planDeCuotas({ checkIn: "2027-03-01", precio: 500_000, pctAbono: 0.3 });
    assert.deepEqual(p.map((c) => [c.tipo, c.fecha, c.monto]), [["abono", "2027-01-30", 150_000], ["cuota", "2027-02-01", 350_000]]);
  } finally { mock.timers.reset(); }
});

test("sumarDiasIso: aritmética de calendario sin zona horaria (fin de mes y de año)", () => {
  assert.equal(sumarDiasIso("2026-11-23", 3), "2026-11-26");
  assert.equal(sumarDiasIso("2026-12-30", 3), "2027-01-02");
  assert.equal(sumarDiasIso("2028-02-27", 2), "2028-02-29");
  assert.equal(sumarDiasIso("2026-11-23", 0), "2026-11-23");
});

test("wiring: la acción, el recordatorio y el documento usan el día de negocio (ningún toISOString().slice ni setHours de «hoy»)", () => {
  const leer = (p: string) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  assert.ok(leer("app/(dashboard)/dashboard/contratos/[numero]/cobros-actions.ts").includes("hoy: fechaNegocio()"));
  const n = leer("lib/notificaciones.ts");
  assert.ok(n.includes("const hoyISO = fechaNegocio();") && !/hoy\.toISOString/.test(n));
  assert.ok(leer("app/plan-cobro/[numero]/page.tsx").includes("const hoy = fechaNegocio();"));
});
