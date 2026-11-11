import { test } from "node:test";
import assert from "node:assert/strict";
import { diaSemanaNoche } from "../lib/calc/gruposDias.ts";
import { liquidarHotelNoches, toTemporadaRango } from "../lib/calc/paquetes.ts";
import { filasPorClave, netosDeColumna } from "../lib/calc/netosPorTemporada.ts";

// #43/#60 incremento 2 — el día de la semana de cada noche no depende de la zona horaria del
// servidor ni de los cambios de hora. Se corre con TZ distintas (ver la nota en la hoja técnica):
//   TZ=UTC / America/Bogota / Europe/Madrid (DST 28-mar-2027) / America/Santiago (DST) / Pacific/Kiritimati (+14)
const MS_DIA = 86_400_000;
const zona = process.env.TZ ?? "(local)";

// Instante de la noche n tal como lo construye el motor: medianoche local de la entrada + n × 24 h.
const t0 = (ida: string, n: number) => new Date(`${ida}T00:00:00`).getTime() + n * MS_DIA;

test(`[${zona}] día ISO de noches a ambos lados de cambios de mes, de año y de hora`, () => {
  // 2026-12-31 jueves; 2027-01-01 viernes; 2027-01-03 domingo; 2027-02-28 domingo; 2027-03-01 lunes.
  const casos: [string, number, number][] = [
    ["2026-12-30", 1, 4], ["2026-12-30", 2, 5], ["2026-12-30", 4, 7], ["2027-02-27", 1, 7], ["2027-02-27", 2, 1],
    // Recorridos que cruzan cambios de hora (Europa 28-mar-2027, Chile 4-abr-2027, EE. UU. 14-mar-2027, 7-nov-2027).
    ["2027-03-26", 0, 5], ["2027-03-26", 2, 7], ["2027-03-26", 3, 1], ["2027-03-26", 4, 2],
    ["2027-04-02", 1, 6], ["2027-04-02", 2, 7], ["2027-04-02", 3, 1],
    ["2027-03-12", 2, 7], ["2027-03-12", 3, 1], ["2027-11-05", 2, 7], ["2027-11-05", 3, 1],
  ];
  for (const [ida, n, esperado] of casos) assert.equal(diaSemanaNoche(t0(ida, n)), esperado, `${ida} + ${n} noches`);
});

test(`[${zona}] una estadía que cruza el cambio de hora cobra cada noche con su grupo`, () => {
  // Semana (lun–jue) 100.000; fin de semana (vie–dom) 150.000. Entrada jueves 25-mar-2027, 5 noches (jue..lun).
  const vig = toTemporadaRango({
    nombre: "ALTA", fecha_inicio: "2027-03-01", fecha_fin: "2027-04-30", prioridad: 1, tipo: "tarifa",
    hotel_temporada_grupos: [{ id: "sem", dias: [1, 2, 3, 4], activo: true }, { id: "fs", dias: [5, 6, 7], activo: true }],
  });
  const filas = [
    { temporada: "ALTA", grupo_id: "sem", neto_doble: 100_000 },
    { temporada: "ALTA", grupo_id: "fs", neto_doble: 150_000 },
  ];
  const total = liquidarHotelNoches({
    fechaIda: "2027-03-25", numNoches: 5, temporadas: [vig],
    netoPorTemporada: netosDeColumna(filasPorClave(filas), "neto_doble"), hoy: "2026-11-11",
  });
  assert.equal(total, 100_000 + 150_000 * 3 + 100_000); // jue + vie, sáb, dom + lun
});
