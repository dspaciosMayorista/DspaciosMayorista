// #94/#52 — filas de presentación: adultos y niños comparten fila solo si son del mismo paquete, con la misma cobertura y UNA tarifa por tipo; nada se promedia ni se fusiona
// si es incompatible. Es solo presentación: la suma de las filas es siempre la del resumen guardado.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resumenUnidad, type Cupo, type ServicioCobertura, type UnidadResumen } from "../lib/cotizacion/resumenPrecios.ts";
import { filasDeUnidad } from "../lib/cotizacion/filasResumen.ts";

const meta = { ref: "item-0", paquete: { id: 7, nombre: "Paquete" }, hotel: "Hotel", categoria: "Estándar", regimen: "PC" };
const cupo = (id: string, tipo: Cupo["tipo"], pesos: number): Cupo => ({ id, tipo, baseCentavos: pesos * 100 });
const servicio = (id: string, nombre: string, precio: number, cubre: "todos" | string[]): ServicioCobertura => ({ id, nombre, modo: "total", precioCentavos: precio * 100, cubre });
const unidad = (cupos: Cupo[], servicios: ServicioCobertura[] = []): UnidadResumen => {
  const r = resumenUnidad({ ...meta, cupos, servicios });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return (r as Extract<typeof r, { ok: true }>).valor;
};
const resumido = (u: UnidadResumen) => filasDeUnidad(u).map((f) => [f.adultos, f.ninos, f.tarifaAdulto / 100, f.tarifaNino / 100, f.total / 100]);

describe("filas combinadas de adultos y niños", () => {
  test("2 adultos a 413.000 y 1 niño a 191.000 → una sola fila con total 1.017.000", () => {
    const u = unidad([cupo("a1", "adulto", 413_000), cupo("a2", "adulto", 413_000), cupo("n1", "nino", 191_000)]);
    assert.equal(u.grupos.length, 2, "el resumen guardado sigue con sus dos grupos");
    assert.deepEqual(resumido(u), [[2, 1, 413_000, 191_000, 1_017_000]]);
  });

  test("sin niños o sin adultos: la fila queda como era (una por grupo)", () => {
    assert.deepEqual(resumido(unidad([cupo("a1", "adulto", 300_000), cupo("a2", "adulto", 300_000)])), [[2, 0, 300_000, 0, 600_000]]);
    assert.deepEqual(resumido(unidad([cupo("n1", "nino", 191_000)])), [[0, 1, 0, 191_000, 191_000]]);
  });

  test("servicio que cubre a todos (adultos y niño): misma cobertura → una fila", () => {
    const u = unidad([cupo("a1", "adulto", 400_000), cupo("a2", "adulto", 400_000), cupo("n1", "nino", 200_000)], [servicio("t", "Tour", 300_000, "todos")]);
    // 300.000 / 3 = 100.000 por persona: adultos 500.000, niño 300.000.
    assert.deepEqual(resumido(u), [[2, 1, 500_000, 300_000, 1_300_000]]);
  });

  test("servicio PARCIAL que cubre a los adultos y no al niño: filas separadas (cambia la cobertura)", () => {
    const u = unidad([cupo("a1", "adulto", 400_000), cupo("a2", "adulto", 400_000), cupo("n1", "nino", 200_000)], [servicio("t", "Tour", 200_000, ["a1", "a2"])]);
    assert.deepEqual(resumido(u), [[2, 0, 500_000, 0, 1_000_000], [0, 1, 0, 200_000, 200_000]]);
  });

  test("servicio parcial que cubre a un adulto y al niño: cada cobertura tiene su fila y no se mezclan", () => {
    const u = unidad([cupo("a1", "adulto", 400_000), cupo("a2", "adulto", 400_000), cupo("n1", "nino", 200_000)], [servicio("t", "Tour", 100_000, ["a2", "n1"])]);
    // Con Tour: adulto 450.000 + niño 250.000 (misma cobertura → una fila); sin Tour: adulto 400.000.
    assert.deepEqual(resumido(u), [[1, 1, 450_000, 250_000, 700_000], [1, 0, 400_000, 0, 400_000]]);
  });

  test("servicios superpuestos: solo se combinan adultos y niños con la MISMA lista de servicios", () => {
    const u = unidad(
      [cupo("a1", "adulto", 300_000), cupo("a2", "adulto", 300_000), cupo("n1", "nino", 150_000), cupo("n2", "nino", 150_000)],
      [servicio("t1", "Tour A", 200_000, ["a1", "n1"]), servicio("t2", "Tour B", 100_000, ["a1", "a2", "n2"])],
    );
    const filas = filasDeUnidad(u);
    // a1 (Tour A y B) y n1 (solo A) tienen listas distintas: cada uno en su fila. a2 y n2 comparten la lista [Tour B]: esos dos sí van juntos.
    assert.equal(filas.filter((f) => !f.ajuste).length, 3, "tres filas de pasajeros (más el ajuste de redondeo por el residuo de 100.000 entre 3)");
    const mixtas = filas.filter((f) => f.adultos > 0 && f.ninos > 0);
    assert.equal(mixtas.length, 1);
    assert.deepEqual([mixtas[0].adultos, mixtas[0].ninos, mixtas[0].tarifaAdulto, mixtas[0].tarifaNino], [1, 1, 33_333_333, 18_333_333]);
    assert.equal(filas.reduce((s, f) => s + f.total, 0), u.totalCentavos, "las filas suman exactamente el resumen");
  });

  test("niños con tarifas diferentes (niño 1 y niño 2) dentro de la misma cobertura: no se fusionan ni se promedian", () => {
    const u = unidad([cupo("a1", "adulto", 413_000), cupo("n1", "nino", 191_000), cupo("n2", "nino2", 150_000)]);
    assert.deepEqual(resumido(u), [[1, 0, 413_000, 0, 413_000], [0, 1, 0, 191_000, 191_000], [0, 1, 0, 150_000, 150_000]]);
  });

  test("niño e infante (tarifas distintas) con el mismo servicio: separados", () => {
    const u = unidad([cupo("a1", "adulto", 400_000), cupo("n1", "nino", 200_000), cupo("i1", "infante", 0)]);
    assert.deepEqual(resumido(u), [[1, 0, 400_000, 0, 400_000], [0, 1, 0, 200_000, 200_000], [0, 1, 0, 0, 0]]);
  });

  test("adultos con tarifas diferentes (doble y sencilla) más un niño: no se fusiona ningún grupo", () => {
    const u = unidad([cupo("a1", "adulto", 300_000), cupo("a2", "adulto", 300_000), cupo("s1", "adulto", 450_000), cupo("n1", "nino", 150_000)]);
    assert.deepEqual(resumido(u), [[0, 0, 0, 0, 0]].slice(0, 0).concat([[1, 0, 450_000, 0, 450_000], [2, 0, 300_000, 0, 600_000], [0, 1, 0, 150_000, 150_000]]));
  });

  test("el ajuste de redondeo queda como fila aparte y la suma de filas es el total del resumen", () => {
    const u = unidad([cupo("a1", "adulto", 300_000), cupo("a2", "adulto", 300_000), cupo("n1", "nino", 200_000)], [{ id: "t", nombre: "Tour", modo: "total", precioCentavos: 100_001, cubre: "todos" }]);
    const filas = filasDeUnidad(u);
    assert.equal(filas.at(-1)!.ajuste, true);
    assert.equal(filas.at(-1)!.total, u.ajusteCentavos);
    assert.equal(filas.reduce((s, f) => s + f.total, 0), u.totalCentavos);
  });

  test("distintos paquetes (unidades) nunca comparten fila", () => {
    const a = unidad([cupo("a1", "adulto", 400_000), cupo("n1", "nino", 200_000)]);
    const b = { ...unidad([cupo("a1", "adulto", 500_000), cupo("n1", "nino", 250_000)]), ref: "item-1" };
    assert.equal(filasDeUnidad(a).length + filasDeUnidad(b).length, 2);
    assert.notEqual(filasDeUnidad(a)[0].clave, filasDeUnidad(b)[0].clave);
  });
});
