import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  anioVigenteBogota, fechaIsoReal, fechasGuardadas, validarFechasVigencia, ANIO_MINIMO_COMPRA_INICIO,
  type FechasVigencia,
} from "../lib/hoteles/validarFechasVigencia.ts";

// #43 — validador PURO de fechas de vigencias (el mismo que usan el formulario y el servidor). Sin reloj ni base: el año vigente se pasa explícito.
const A = 2026;
const ok = (f: FechasVigencia, previas?: FechasVigencia | null) => validarFechasVigencia(f, { anioVigente: A, previas });
const mal = (f: FechasVigencia, patron: RegExp, previas?: FechasVigencia | null) => {
  const r = ok(f, previas);
  assert.equal(r.ok, false, `debía rechazarse: ${JSON.stringify(f)}`);
  assert.match(r.ok ? "" : r.error, patron);
};
const base = (o: Partial<FechasVigencia> = {}): FechasVigencia => ({ inicio: "2026-12-24", fin: "2027-01-03", ...o });

describe("fechaIsoReal — calendario real, sin desbordes", () => {
  test("válidas", () => {
    for (const v of ["2026-11-10", "2028-02-29", "2000-02-29", "2027-12-31", "2027-04-30"]) assert.equal(fechaIsoReal(v), true, v);
  });
  test("inexistentes o mal formadas", () => {
    for (const v of ["2027-02-29", "2027-02-30", "2027-04-31", "2100-02-29", "2027-13-01", "2027-00-10", "2027-01-00", "2027-01-32",
      "62026-06-29", "206-12-24", "2026-6-9", "2026/06/09", "2026-06-09T00:00:00", "", " 2026-06-09"]) assert.equal(fechaIsoReal(v), false, JSON.stringify(v));
  });
});

describe("año vigente en Bogotá (UTC−5, sin horario de verano)", () => {
  test("31-dic 23:59:59 en Bogotá todavía es el año que termina; a las 00:00:00 ya es el siguiente", () => {
    assert.equal(anioVigenteBogota(new Date("2027-01-01T04:59:59Z")), 2026);
    assert.equal(anioVigenteBogota(new Date("2027-01-01T05:00:00Z")), 2027);
  });
  test("a las 19:00 del 31-dic en Bogotá el servidor (UTC) ya marca el 1-ene del año nuevo, pero el año vigente sigue siendo el viejo", () => {
    assert.equal(anioVigenteBogota(new Date("2027-01-01T00:00:00Z")), 2026);
  });
  test("medio año", () => {
    assert.equal(anioVigenteBogota(new Date("2026-06-15T12:00:00Z")), 2026);
  });
});

describe("rangos de viaje", () => {
  test("válido: empieza en el año vigente y cruza al siguiente", () => assert.deepEqual(ok(base()), { ok: true }));
  test("0206-12-24 (hotel 53) y 62026-06-29 (hotel 9) se rechazan nombrando el valor", () => {
    mal(base({ inicio: "0206-12-24" }), /0206-12-24/);
    mal(base({ inicio: "2026-06-26", fin: "62026-06-29" }), /62026-06-29/);
  });
  test("año anterior al vigente: rechazado en inicio y en fin; el año vigente justo en el borde se acepta", () => {
    mal(base({ inicio: "2025-12-31", fin: "2026-01-05" }), /2025-12-31/);
    assert.deepEqual(ok(base({ inicio: "2026-01-01", fin: "2026-01-02" })), { ok: true });
  });
  test("fechas inexistentes", () => {
    mal(base({ fin: "2027-02-30" }), /2027-02-30/);
    mal(base({ inicio: "2027-13-01", fin: "2027-13-02" }), /2027-13-01/);
  });
  test("fin anterior al inicio", () => mal(base({ inicio: "2027-03-10", fin: "2027-03-01" }), /anterior al inicio/));
  test("fila vacía se ignora (como al guardar); inicio sin fin se pide completo", () => {
    assert.deepEqual(ok(base({ rangos: [{ fecha_inicio: "", fecha_fin: "" }] })), { ok: true });
    mal(base({ rangos: [{ fecha_inicio: "2027-02-01", fecha_fin: "" }] }), /necesita fecha de inicio y de fin/);
  });
  test("rangos adicionales", () => mal(base({ rangos: [{ fecha_inicio: "2027-02-01", fecha_fin: "2027-01-01" }] }), /anterior al inicio/));
  test("el mensaje no corrige ni propone un año", () => {
    const r = ok(base({ inicio: "0206-12-24" }));
    assert.equal(r.ok, false);
    assert.doesNotMatch(r.ok ? "" : r.error, /2026-12-24/);
  });
});

describe("blackouts", () => {
  test("válido y con año anterior / fecha inexistente", () => {
    assert.deepEqual(ok(base({ blackouts: [{ fecha_inicio: "2026-12-30", fecha_fin: "2026-12-31" }] })), { ok: true });
    mal(base({ blackouts: [{ fecha_inicio: "2025-12-30", fecha_fin: "2026-12-31" }] }), /Blackout.*2025-12-30/);
    mal(base({ blackouts: [{ fecha_inicio: "2026-12-30", fecha_fin: "2027-02-30" }] }), /Blackout.*2027-02-30/);
  });
});

describe("compra", () => {
  test("puede empezar en un año anterior al vigente (compra abierta el año pasado)", () => {
    assert.deepEqual(ok(base({ compraInicio: "2025-10-01", compraFin: "2027-04-30" })), { ok: true });
  });
  test("el FIN de la compra no puede ser de un año anterior al vigente", () => mal(base({ compraInicio: "2025-01-01", compraFin: "2025-12-31" }), /Compra, fin.*2025-12-31/));
  test("el inicio no puede ser absurdo (< piso de plausibilidad)", () => {
    assert.ok(ANIO_MINIMO_COMPRA_INICIO <= 2026);
    mal(base({ compraInicio: "0206-10-01", compraFin: "2026-12-31" }), /Compra, inicio.*0206-10-01/);
  });
  test("fecha inexistente, fin antes que inicio, y vacías permitidas", () => {
    mal(base({ compraInicio: "2026-02-30", compraFin: "2026-12-31" }), /2026-02-30/);
    mal(base({ compraInicio: "2026-12-31", compraFin: "2026-12-01" }), /Compra: el fin/);
    assert.deepEqual(ok(base({ compraInicio: "", compraFin: null })), { ok: true });
  });
});

describe("edición: lo guardado que no cambia queda exento (históricos)", () => {
  const historica = base({ inicio: "0206-12-24", compraInicio: "2026-07-24", compraFin: "2027-04-30" });
  test("mismas fechas antiguas → se permite editar", () => assert.deepEqual(ok(historica, historica), { ok: true }));
  test("cambiar solo el fin mientras el inicio sigue siendo 0206 → rechazado", () => mal({ ...historica, fin: "2027-01-05" }, /0206-12-24/, historica));
  test("cambiar el inicio a la fecha correcta → aceptado", () => assert.deepEqual(ok({ ...historica, inicio: "2026-12-24" }, historica), { ok: true }));
  test("cambiar el inicio a otra mala → rechazado", () => mal({ ...historica, inicio: "0206-12-25" }, /0206-12-25/, historica));
  test("agregar un rango o blackout antiguo nuevo → rechazado aunque el histórico no cambie", () => {
    mal({ ...historica, rangos: [{ fecha_inicio: "2025-05-01", fecha_fin: "2025-05-10" }] }, /2025-05-01/, historica);
    mal({ ...historica, blackouts: [{ fecha_inicio: "2025-05-01", fecha_fin: "2025-05-10" }] }, /2025-05-01/, historica);
  });
  test("un rango antiguo ya guardado como adicional o blackout sigue exento", () => {
    const h = base({ rangos: [{ fecha_inicio: "2025-05-01", fecha_fin: "2025-05-10" }], blackouts: [{ fecha_inicio: "2025-05-02", fecha_fin: "2025-05-03" }] });
    assert.deepEqual(ok(h, h), { ok: true });
  });
  test("cambiar la compra de una vigencia histórica sí se valida; dejarla igual no", () => {
    mal({ ...historica, compraFin: "2025-12-31" }, /Compra, fin/, historica);
    assert.deepEqual(ok({ ...historica, compraFin: "2027-04-30" }, historica), { ok: true });
  });
  test("sin `previas` (crear) nada queda exento", () => mal(historica, /0206-12-24/, null));
});

describe("fechasGuardadas — misma convención que el formulario", () => {
  test("el primer rango es el principal y el resto son adicionales", () => {
    const g = fechasGuardadas({
      fecha_inicio: "2026-01-01", fecha_fin: "2026-01-05",
      rangos: [{ fecha_inicio: "2026-12-24", fecha_fin: "2027-01-03" }, { fecha_inicio: "2027-02-01", fecha_fin: "2027-02-10" }],
      blackouts: [{ fecha_inicio: "2026-12-30", fecha_fin: "2026-12-31" }], compra_inicio: "2026-07-24", compra_fin: null,
    });
    assert.equal(g.inicio, "2026-12-24");
    assert.equal(g.fin, "2027-01-03");
    assert.deepEqual(g.rangos, [{ fecha_inicio: "2027-02-01", fecha_fin: "2027-02-10" }]);
    assert.equal(g.compraInicio, "2026-07-24");
  });
  test("sin `rangos` usa las columnas principales; ignora elementos que no son rangos", () => {
    const g = fechasGuardadas({ fecha_inicio: "2026-12-24", fecha_fin: "2027-01-03", rangos: ["abc", { fecha_inicio: 1 }], blackouts: "x" });
    assert.deepEqual([g.inicio, g.fin, g.rangos, g.blackouts], ["2026-12-24", "2027-01-03", [], []]);
  });
});
