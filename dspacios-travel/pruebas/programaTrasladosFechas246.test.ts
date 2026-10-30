// Fechas del viaje con traslado previo/posterior (lib/programas/trasladosFechas.ts): el traslado se cuenta UNA vez y solo mueve fechas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { errorFechasSalida, rangoViajeConTraslados, trasladosDeItinerario } from "../lib/programas/trasladosFechas.ts";

const N = { previo: false, posterior: false }, P = { previo: true, posterior: false }, Q = { previo: false, posterior: true }, PQ = { previo: true, posterior: true };

test("trasladosDeItinerario lee el tipo de tramo (y tolera filas sin tipo, lista vacía o ausente)", () => {
  assert.deepEqual(trasladosDeItinerario([{ tipo_tramo: "dia" }, { tipo_tramo: "traslado_previo" }]), P);
  assert.deepEqual(trasladosDeItinerario([{}, { tipo_tramo: "traslado_posterior" }]), Q);
  assert.deepEqual(trasladosDeItinerario([{ tipo_tramo: "traslado_previo" }, { tipo_tramo: "traslado_posterior" }]), PQ);
  assert.deepEqual(trasladosDeItinerario(null), N);
  assert.deepEqual(trasladosDeItinerario([]), N);
});

test("SALIDA: sin traslado no cambia (desde + noches); el previo suma un día al regreso; el posterior otro; ambos, dos; nunca doble", () => {
  // Programa 7 de Producción: 5 días, noches = 4; salida del 2 de octubre.
  assert.deepEqual(rangoViajeConTraslados("salida", "2026-10-02", 4, N), { desde: "2026-10-02", hasta: "2026-10-06" });
  assert.deepEqual(rangoViajeConTraslados("salida", "2026-10-02", 4, P), { desde: "2026-10-02", hasta: "2026-10-07" }, "el ejemplo del dueño: del 2 al 7, no al 6");
  assert.deepEqual(rangoViajeConTraslados("salida", "2026-10-02", 4, Q), { desde: "2026-10-02", hasta: "2026-10-07" });
  assert.deepEqual(rangoViajeConTraslados("salida", "2026-10-02", 4, PQ), { desde: "2026-10-02", hasta: "2026-10-08" });
});

test("HOTEL: el previo resta un día al inicio y el posterior suma uno al regreso (sin cambio respecto del comportamiento anterior)", () => {
  assert.deepEqual(rangoViajeConTraslados("hotel", "2027-03-10", 3, N), { desde: "2027-03-10", hasta: "2027-03-13" });
  assert.deepEqual(rangoViajeConTraslados("hotel", "2027-03-10", 3, P), { desde: "2027-03-09", hasta: "2027-03-13" });
  assert.deepEqual(rangoViajeConTraslados("hotel", "2027-03-10", 3, Q), { desde: "2027-03-10", hasta: "2027-03-14" });
  assert.deepEqual(rangoViajeConTraslados("hotel", "2027-03-10", 3, PQ), { desde: "2027-03-09", hasta: "2027-03-14" });
});

test("errorFechasSalida: las salidas coherentes pasan (con previo, con posterior, con ambos)", () => {
  assert.equal(errorFechasSalida({ etiqueta: "A", fecha_desde: "2026-10-02", fecha_hasta: "2026-10-07", noches: 4 }, "2026-10-02", P), null);
  assert.equal(errorFechasSalida({ etiqueta: "A", fecha_desde: "2026-10-02", fecha_hasta: "2026-10-07", noches: 4 }, "2026-10-02", Q), null);
  assert.equal(errorFechasSalida({ etiqueta: "A", fecha_desde: "2026-10-02", fecha_hasta: "2026-10-08", noches: 4 }, "2026-10-02", PQ), null);
});

test("errorFechasSalida: las cuatro discrepancias de Producción (programas 7 y 11) se rechazan con un mensaje que dice qué fecha esperaba", () => {
  const casos: [string, string, string, number, string][] = [
    ["7", "2026-12-28", "2027-01-01", 4, "02/01/2027"],
    ["11", "2026-10-13", "2026-10-16", 5, "19/10/2026"],
    ["11", "2026-12-25", "2026-12-30", 5, "31/12/2026"],
    ["11", "2027-01-02", "2027-01-09", 5, "08/01/2027"],
  ];
  for (const [prog, d, h, noches, esperada] of casos) {
    const e = errorFechasSalida({ etiqueta: `P${prog} ${d}`, fecha_desde: d, fecha_hasta: h, noches }, d, P);
    assert.ok(e, `programa ${prog} ${d}→${h} debe rechazarse`);
    assert.match(e!, new RegExp(`deberían terminar el ${esperada.replaceAll("/", "\/")}`));
    assert.match(e!, /no se creó ningún contrato/);
  }
});

test("errorFechasSalida exige la fecha de la salida: otra fecha se rechaza (con o sin traslado, con rango de dos extremos o sin él)", () => {
  const s = { etiqueta: "X", fecha_desde: "2026-10-02", fecha_hasta: "2026-10-07", noches: 4 };
  for (const t of [N, P, Q, PQ]) {
    for (const otra of ["2026-10-03", "2026-10-07", "2026-10-01", "2026-12-25"]) {
      const e = errorFechasSalida(s, otra, t);
      assert.match(e ?? "", /sale el 02[/]10[/]2026 y la reserva trae otra fecha/, `${otra} con ${JSON.stringify(t)}`);
      assert.match(e!, /no se creó ningún contrato/);
    }
  }
  assert.match(errorFechasSalida({ ...s, fecha_hasta: "2026-10-31" }, "2026-10-09", N) ?? "", /otra fecha/, "un rango ancho tampoco es fecha libre");
  assert.match(errorFechasSalida({ ...s, fecha_hasta: null }, "2026-10-09", P) ?? "", /otra fecha/);
  assert.match(errorFechasSalida(s, "no-es-fecha", P) ?? "", /no válida/);
});

test("errorFechasSalida: una salida SIN fecha de inicio no se puede reservar (no hay fecha libre legítima en modo salida)", () => {
  assert.match(errorFechasSalida({ etiqueta: "Temporada", fecha_desde: null, fecha_hasta: null, noches: 4 }, "2026-10-02", N) ?? "", /no tiene fecha de salida cargada/);
  assert.match(errorFechasSalida({ etiqueta: "Temporada", fecha_desde: "", fecha_hasta: null, noches: 4 }, "2026-10-02", P) ?? "", /no tiene fecha de salida cargada/);
});

test("errorFechasSalida sin traslado: en la fecha de la salida pasa aunque fecha_hasta no cuadre (comportamiento de siempre); sin noches no compara", () => {
  const desfasada = { etiqueta: "X", fecha_desde: "2026-10-02", fecha_hasta: "2026-10-20", noches: 4 };
  assert.equal(errorFechasSalida(desfasada, "2026-10-02", N), null);
  assert.equal(errorFechasSalida({ ...desfasada, fecha_hasta: null }, "2026-10-02", P), null);
  assert.equal(errorFechasSalida({ ...desfasada, noches: null }, "2026-10-02", P), null);
});
