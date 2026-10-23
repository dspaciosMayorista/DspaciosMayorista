// Estadísticas de sillas por record (lib/vuelos/stats.ts): las filas que NO son
// cupos del record —legado `cambio` (silla que salió a otro record con el
// traslado antiguo) y `retirada` (cupo retirado, migración 192)— no
// cuentan en el total, la ocupación ni la disponibilidad.
//
// Ejemplo del diseño (tarea 2): Y tenía 10 sillas y trasladó 2 a X con el
// mecanismo antiguo. En Y quedan 10 FILAS, 2 de ellas `cambio`; en X, 2 filas
// `cambio_entrante`. Antes el total de Y daba 10 y el de Y+X contaba 2 sillas
// dos veces.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  acumularSilla,
  conteoCero,
  conteoPorBloqueo,
  sumarConteos,
  ocupacionPct,
  ventaPct,
  ESTADOS_NO_ACTIVOS,
} from "../lib/vuelos/stats.ts";

const Y = 1;
const X = 2;
const filas = (bloqueo_id: number, estado: string, n: number) =>
  Array.from({ length: n }, () => ({ bloqueo_id, estado }));

// Y: 1 confirmada + 7 disponibles + 2 `cambio` (salieron a X). X: 6 disponibles + 2 `cambio_entrante`.
const sillas = [
  ...filas(Y, "confirmada", 1), ...filas(Y, "disponible", 7), ...filas(Y, "cambio", 2),
  ...filas(X, "disponible", 6), ...filas(X, "cambio_entrante", 2),
];

describe("acumularSilla", () => {
  test("las filas cambio y retirada no suman en ningún contador, total incluido", () => {
    for (const estado of ["cambio", "retirada"]) {
      const c = conteoCero();
      acumularSilla(c, estado);
      assert.deepEqual(c, conteoCero(), `${estado} no debe contar`);
    }
    assert.deepEqual([...ESTADOS_NO_ACTIVOS], ["cambio", "retirada"]);
  });

  test("los estados activos siguen contando igual que antes", () => {
    const c = conteoCero();
    for (const e of ["disponible", "cambio_entrante", "en_plazo", "confirmada", "devuelta", "no_vendida"]) acumularSilla(c, e);
    assert.deepEqual(c, { disp: 2, plazo: 1, conf: 1, dev: 1, nven: 1, total: 6 });
  });

  test("estado nulo o desconocido sigue sumando al total (sin cambio de criterio)", () => {
    const c = conteoCero();
    acumularSilla(c, null);
    acumularSilla(c, "otro");
    assert.equal(c.total, 2);
  });
});

describe("conteo por record con el legado del traslado antiguo", () => {
  const m = conteoPorBloqueo(sillas);

  test("Y cuenta 8 sillas activas (no 10): las 2 que salieron no son suyas", () => {
    assert.deepEqual(m.get(Y), { disp: 7, plazo: 0, conf: 1, dev: 0, nven: 0, total: 8 });
  });

  test("X cuenta 8 (6 propias + 2 que entraron)", () => {
    assert.deepEqual(m.get(X), { disp: 8, plazo: 0, conf: 0, dev: 0, nven: 0, total: 8 });
  });

  test("Y + X suman 16 sillas: ninguna se cuenta dos veces", () => {
    assert.equal(sumarConteos(m, [Y, X]).total, 16);
  });

  test("la ocupación y el % de venta de Y se calculan sobre 8, no sobre 10", () => {
    const y = m.get(Y)!;
    assert.equal(ocupacionPct(y), 13); // 1/8 = 12,5 % → 13 (antes 1/10 = 10 %)
    assert.equal(ventaPct(y), 13);
  });

  test("un record solo con filas cambio queda en 0 y no divide entre cero", () => {
    const solo = conteoPorBloqueo(filas(9, "cambio", 3)).get(9)!;
    assert.equal(solo.total, 0);
    assert.equal(ocupacionPct(solo), 0);
    assert.equal(ventaPct(solo), 0);
  });
});
