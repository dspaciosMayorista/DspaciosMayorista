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
    assert.deepEqual([mixtas[0].adultos, mixtas[0].ninos], [1, 1]);
    // las tarifas conservan su precisión de cálculo (30.000.000 + 10.000.000/3 y 15.000.000 + 10.000.000/3 centavos), sin repartir el residuo entre pasajeros
    assert.ok(Math.abs(mixtas[0].tarifaAdulto - (30_000_000 + 10_000_000 / 3)) < 1e-3 && Math.abs(mixtas[0].tarifaNino - (15_000_000 + 10_000_000 / 3)) < 1e-3);
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

  test("el residuo de redondeo NO parte la fila ni se muestra repartido: UNA fila por paquete (3 adultos y el niño), UNA tarifa por tipo con su precisión de cálculo y el total exacto", () => {
    // 3 adultos y 1 niño comparten un servicio de 4.000,02 (400.002 centavos): el resumen guardado reparte el centavo en su estructura; el documento muestra la tarifa exacta por tipo
    const r = resumenUnidad({ ...meta, cupos: [cupo("a1", "adulto", 600_000), cupo("a2", "adulto", 600_000), cupo("a3", "adulto", 600_000), cupo("n1", "nino", 300_000)], servicios: [{ id: "t", nombre: "Traslado privado", modo: "total", precioCentavos: 400_002, cubre: "todos" }] });
    assert.ok(r.ok, r.ok ? "" : r.error);
    const u = (r as Extract<typeof r, { ok: true }>).valor;
    assert.equal(u.grupos.length > 2, true, "el resumen guardado conserva su estructura en centavos enteros");
    const filas = filasDeUnidad(u);
    assert.equal(filas.length, 1, "una sola fila para el paquete");
    const [f0] = filas;
    assert.deepEqual([f0.adultos, f0.ninos], [3, 1], "el niño NO queda como otro paquete");
    assert.ok(Math.abs(f0.tarifaAdulto - (60_000_000 + 400_002 / 4)) < 1e-6, "tarifa del adulto = su base + la parte exacta del servicio");
    assert.ok(Math.abs(f0.tarifaNino - (30_000_000 + 400_002 / 4)) < 1e-6);
    assert.equal(f0.total, u.totalCentavos, "el total de la fila es el exacto");
    assert.equal(f0.ajuste, false);
    assert.equal("tarifasAdulto" in f0, false, "sin sublistas «n × tarifa»");
  });

  test("HISTÓRICOS: un resumen guardado sin tarifa exacta (anterior a esta regla) se presenta con la tarifa de centavos enteros que trae, sin modificarse, y el total no cambia", () => {
    const r = resumenUnidad({ ...meta, cupos: [cupo("a1", "adulto", 400_000), cupo("a2", "adulto", 400_000), cupo("n1", "nino", 200_000)], servicios: [servicio("t", "Tour", 300_000, "todos")] });
    assert.ok(r.ok, r.ok ? "" : r.error);
    const nuevo = (r as Extract<typeof r, { ok: true }>).valor;
    const historico: UnidadResumen = JSON.parse(JSON.stringify(nuevo, (k, v) => (k === "tarifaExactaCentavos" ? undefined : v)));
    assert.equal(historico.grupos.every((g) => g.tarifaExactaCentavos === undefined), true);
    const copia = JSON.stringify(historico);
    const filas = filasDeUnidad(historico);
    assert.equal(JSON.stringify(historico), copia, "lo guardado no se toca");
    assert.deepEqual(filas.map((x) => [x.adultos, x.ninos, x.tarifaAdulto / 100, x.tarifaNino / 100, x.total / 100]), [[2, 1, 500_000, 300_000, 1_300_000]]);
    assert.deepEqual(filasDeUnidad(nuevo).map((x) => [x.tarifaAdulto, x.tarifaNino, x.total]), filas.map((x) => [x.tarifaAdulto, x.tarifaNino, x.total]), "con y sin tarifa exacta, lo exacto coincide");
  });

  test("USD 100,00 y USD 100,01 son tarifas REALES: no se fusionan por estar a un centavo (sin servicio y con un servicio dividido entre tres que sí es redondeo)", () => {
    const base = (id: string, centavos: number): Cupo => ({ id, tipo: "adulto", baseCentavos: centavos });
    const sin = resumenUnidad({ ...meta, cupos: [base("a1", 10_000), base("a2", 10_001)], servicios: [] });
    assert.ok(sin.ok, sin.ok ? "" : sin.error);
    const f1 = filasDeUnidad((sin as Extract<typeof sin, { ok: true }>).valor);
    assert.deepEqual(f1.map((x) => [x.adultos, x.tarifaAdulto, x.total]), [[1, 10_001, 10_001], [1, 10_000, 10_000]], "dos filas, cada una con su tarifa");
    // El mismo servicio de USD 100,00 entre 3 se reparte con residuo, pero las bases reales siguen siendo 100,00 / 100,01
    const con = resumenUnidad({ ...meta, cupos: [base("a1", 10_000), base("a2", 10_001), base("a3", 10_000)], servicios: [{ id: "t", nombre: "Traslado", modo: "total", precioCentavos: 10_000, cubre: "todos" }] });
    assert.ok(con.ok, con.ok ? "" : con.error);
    const u = (con as Extract<typeof con, { ok: true }>).valor;
    const f2 = filasDeUnidad(u);
    const orden = [...f2].sort((x, y) => y.tarifaAdulto - x.tarifaAdulto);
    assert.deepEqual(orden.map((x) => x.adultos), [1, 2], "la de 100,01 va aparte de las dos de 100,00 (que el servicio divida con residuo no las separa)");
    assert.ok(Math.abs(orden[0].tarifaAdulto - (10_001 + 10_000 / 3)) < 1e-3 && Math.abs(orden[1].tarifaAdulto - (10_000 + 10_000 / 3)) < 1e-3);
    assert.equal(f2.reduce((n, x) => n + x.total, 0), u.totalCentavos, "el total no cambia");
  });

  test("HISTÓRICO sin tarifa exacta: USD 100,00 y USD 100,01 se conservan tal como están guardadas (sin agrupar por cercanía); el resumen y su total no se modifican; tarifas iguales sí se combinan", () => {
    const g = (cantidad: number, tarifaCentavos: number, cupos: string[]) => ({ tipo: "adulto" as const, cantidad, tarifaCentavos, subtotalCentavos: cantidad * tarifaCentavos, incluye: ["Traslado"], cupos });
    const hist: UnidadResumen = { ...meta, ref: "item-0", ajusteCentavos: 0, totalCentavos: 3 * 10_000 + 10_001, grupos: [g(1, 10_001, ["a2"]), g(3, 10_000, ["a1", "a3", "a4"])] } as UnidadResumen;
    assert.equal(hist.grupos.every((x) => x.tarifaExactaCentavos === undefined), true);
    const copia = JSON.stringify(hist);
    const filas = filasDeUnidad(hist);
    assert.equal(JSON.stringify(hist), copia, "el resumen original no se modifica");
    assert.deepEqual(filas.map((x) => [x.adultos, x.tarifaAdulto, x.total]), [[1, 10_001, 10_001], [3, 10_000, 30_000]], "dos tarifas distintas, dos filas, cada una tal como se guardó");
    assert.equal(filas.reduce((n, x) => n + x.total, 0), hist.totalCentavos, "el total no cambia");
    // Dos grupos con la MISMA tarifa, tipo y cobertura (p. ej. cupos distintos) sí se combinan
    const iguales: UnidadResumen = { ...hist, grupos: [g(2, 10_000, ["a1", "a3"]), g(2, 10_000, ["a4", "a5"])], totalCentavos: 40_000 };
    assert.deepEqual(filasDeUnidad(iguales).map((x) => [x.adultos, x.tarifaAdulto, x.total]), [[4, 10_000, 40_000]]);
  });

  test("una diferencia REAL de tarifa (doble frente a sencilla) no se confunde con redondeo: sigue en filas separadas", () => {
    const u = unidad([cupo("a1", "adulto", 300_000), cupo("s1", "adulto", 301_000), cupo("n1", "nino", 150_000)]);
    assert.equal(filasDeUnidad(u).length, 3, "301.000 frente a 300.000 es otra tarifa, no un peso de redondeo");
  });

  test("un servicio que no divide exacto ya NO deja ajuste: el residuo va dentro de las tarifas y la suma de filas es el total del resumen", () => {
    const u = unidad([cupo("a1", "adulto", 300_000), cupo("a2", "adulto", 300_000), cupo("n1", "nino", 200_000)], [{ id: "t", nombre: "Tour", modo: "total", precioCentavos: 100_001, cubre: "todos" }]);
    assert.equal(u.ajusteCentavos, 0);
    const filas = filasDeUnidad(u);
    assert.equal(filas.some((f) => f.ajuste), false);
    assert.equal(filas.reduce((s, f) => s + f.total, 0), u.totalCentavos);
  });

  test("un resumen GUARDADO con ajuste (anterior al cambio) se presenta sin fila de ajuste: el centavo se absorbe en las tarifas y el total es el mismo", () => {
    const base = unidad([cupo("a1", "adulto", 300_000), cupo("a2", "adulto", 300_000), cupo("n1", "nino", 200_000)]);
    const legado: UnidadResumen = { ...base, ajusteCentavos: 1, totalCentavos: base.totalCentavos + 1 };
    const filas = filasDeUnidad(legado);
    assert.equal(filas.some((f) => f.ajuste), false, "el cliente no ve «Ajuste por redondeo»");
    assert.equal(filas.reduce((s, f) => s + f.total, 0), legado.totalCentavos, "el importe exigible no cambia");
    assert.equal(legado.ajusteCentavos, 1, "el resumen guardado no se muta");
  });

  test("si no se puede identificar a cada pasajero, el ajuste heredado se conserva como fila (nunca se inventa un reparto)", () => {
    const base = unidad([cupo("a1", "adulto", 300_000), cupo("a2", "adulto", 300_000)]);
    const sinIds: UnidadResumen = { ...base, grupos: base.grupos.map((g) => ({ ...g, cupos: [] })), ajusteCentavos: 1, totalCentavos: base.totalCentavos + 1 };
    const filas = filasDeUnidad(sinIds);
    assert.equal(filas.at(-1)!.ajuste, true);
    assert.equal(filas.reduce((s, f) => s + f.total, 0), sinIds.totalCentavos);
  });

  test("distintos paquetes (unidades) nunca comparten fila", () => {
    const a = unidad([cupo("a1", "adulto", 400_000), cupo("n1", "nino", 200_000)]);
    const b = { ...unidad([cupo("a1", "adulto", 500_000), cupo("n1", "nino", 250_000)]), ref: "item-1" };
    assert.equal(filasDeUnidad(a).length + filasDeUnidad(b).length, 2);
    assert.notEqual(filasDeUnidad(a)[0].clave, filasDeUnidad(b)[0].clave);
  });
});
