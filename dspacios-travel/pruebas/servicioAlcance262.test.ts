import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluarSuplementos, validarFranjas, tramosConFranja, type FranjaSuplemento } from "../lib/calc/trasladoFranjas.ts";
import { costoNetoServicio } from "../lib/calc/servicioTarifa.ts";
import {
  alcancePrecioDe, alcanceVentaDeCombo, llevaTraslado, resolverPrecioAlcance, tramosDeAlcance, validarClasificacion, validarPreciosAlcance, type FilaPrecioAlcance,
} from "../lib/calc/servicioAlcance.ts";

// Ejemplo del proveedor: el mismo horario nocturno cuesta distinto según el grupo.
const franja = (pax: [number, number] | null, valor: number, extra: Partial<FranjaSuplemento> = {}): FranjaSuplemento => ({
  hora_desde: "19:00", hora_hasta: "06:00", tramo: "ambos", tipo: "monto", valor, cobro: "grupo", pax_desde: pax?.[0] ?? null, pax_hasta: pax?.[1] ?? null, ...extra,
});
const PROVEEDOR = [franja([1, 4], 45000), franja([5, 12], 80000), franja([13, 19], 130000), franja([20, 40], 190000)];

describe("suplementos por rango de pasajeros", () => {
  test("el importe depende del grupo: 1–4 → 45.000, 5–12 → 80.000, 13–19 → 130.000, 20–40 → 190.000 (por tramo vendido)", () => {
    for (const [pax, esperado] of [[1, 45000], [4, 45000], [5, 80000], [12, 80000], [13, 130000], [19, 130000], [20, 190000], [40, 190000]] as const) {
      const r = evaluarSuplementos(PROVEEDOR, { llegada: "21:30" }, 0, pax, ["llegada"]);
      assert.ok(r.ok, `pax ${pax}`);
      assert.equal(r.ok && r.netoTotal, esperado, `pax ${pax}`);
      assert.equal(r.ok && r.suplementos.length, 1, "un solo cargo por tramo");
    }
  });
  test("si falta la regla del grupo (41 pasajeros) FALLA: no inventa un importe ni cobra cero", () => {
    const r = evaluarSuplementos(PROVEEDOR, { llegada: "21:30" }, 0, 41, ["llegada"]);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "sin_regla_pax");
    assert.match(!r.ok ? r.detalle : "", /ninguna regla cubre 41 pasajeros/);
  });
  test("fuera del horario del suplemento no hace falta ninguna regla de pasajeros", () => {
    const r = evaluarSuplementos(PROVEEDOR, { llegada: "12:00" }, 0, 41, ["llegada"]);
    assert.ok(r.ok && r.netoTotal === 0 && r.suplementos.length === 0);
  });
  test("una franja sin rango (todos los grupos) sigue funcionando como antes", () => {
    const r = evaluarSuplementos([franja(null, 30000)], { llegada: "22:00", salida: "05:00" }, 0, 7);
    assert.ok(r.ok && r.netoTotal === 60000 && r.suplementos.length === 2);
  });
  test("cobro por persona y porcentaje respetan el rango", () => {
    const r1 = evaluarSuplementos([franja([1, 4], 10000, { cobro: "persona" })], { llegada: "22:00" }, 0, 3, ["llegada"]);
    assert.equal(r1.ok && r1.netoTotal, 30000);
    const r2 = evaluarSuplementos([franja([5, 12], 10, { tipo: "porcentaje" })], { llegada: "22:00" }, 200000, 6, ["llegada"]);
    assert.equal(r2.ok && r2.netoTotal, 20000);
  });
});

describe("validación de cruces de rangos y horarios", () => {
  test("rangos contiguos del mismo horario son válidos", () => assert.deepEqual(validarFranjas(PROVEEDOR), []));
  test("mismo tramo y horario con pasajeros que se cruzan (1–4 y 4–6) se rechaza", () => {
    assert.match(validarFranjas([franja([1, 4], 1), franja([4, 6], 2)])[0] ?? "", /se solapan/);
  });
  test("una franja para todos los grupos choca con las que tienen rango en el mismo horario y tramo", () => {
    assert.match(validarFranjas([franja(null, 1), franja([1, 4], 2)])[0] ?? "", /se solapan/);
  });
  test("mismo rango pero horarios que NO se cruzan, o tramos distintos, es válido", () => {
    assert.deepEqual(validarFranjas([franja([1, 4], 1, { hora_desde: "19:00", hora_hasta: "23:00" }), franja([1, 4], 2, { hora_desde: "23:00", hora_hasta: "06:00" })]), []);
    assert.deepEqual(validarFranjas([franja([1, 4], 1, { tramo: "llegada" }), franja([1, 4], 2, { tramo: "salida" })]), []);
  });
  test("rango con un solo extremo, invertido o con cero se rechaza", () => {
    assert.ok(validarFranjas([franja([1, 4], 1, { pax_hasta: null })]).length);
    assert.ok(validarFranjas([franja([5, 2], 1)]).length);
    assert.ok(validarFranjas([franja([0, 2], 1)]).length);
  });
});

describe("el suplemento solo aplica a los tramos vendidos y sin duplicar", () => {
  const ambos = [franja(null, 30000)];
  test("un trayecto de llegada: cobra solo la llegada y NO pide la hora de salida", () => {
    const r = evaluarSuplementos(ambos, { llegada: "22:00" }, 0, 2, ["llegada"]);
    assert.ok(r.ok && r.suplementos.length === 1 && r.suplementos[0].tramo === "llegada" && r.pendientes.length === 0);
  });
  test("un trayecto de salida: cobra solo la salida", () => {
    const r = evaluarSuplementos(ambos, { salida: "05:00" }, 0, 2, ["salida"]);
    assert.ok(r.ok && r.suplementos.length === 1 && r.suplementos[0].tramo === "salida");
  });
  test("ida y regreso con una franja «ambos»: un cargo por tramo (dos), nunca dos por el mismo tramo", () => {
    const r = evaluarSuplementos(ambos, { llegada: "22:00", salida: "05:00" }, 0, 2, ["llegada", "salida"]);
    assert.ok(r.ok && r.suplementos.length === 2 && r.netoTotal === 60000);
    assert.deepEqual(r.ok && r.suplementos.map((s) => s.tramo).sort(), ["llegada", "salida"]);
  });
  test("un tramo vendido con franja y sin hora queda pendiente (no se cobra ni se supone)", () => {
    const r = evaluarSuplementos(ambos, {}, 0, 2, ["llegada"]);
    assert.ok(r.ok && r.pendientes.join() === "llegada" && r.netoTotal === 0);
  });
  test("tramosConFranja respeta los tramos vendidos", () => {
    assert.deepEqual(tramosConFranja([franja(null, 1, { tramo: "salida" })], ["llegada"]), []);
    assert.deepEqual(tramosConFranja([franja(null, 1, { tramo: "salida" })], ["llegada", "salida"]), ["salida"]);
  });
  test("sin indicar tramos se comporta como antes (ambos)", () => {
    const r = evaluarSuplementos(ambos, { llegada: "22:00", salida: "05:00" }, 0, 2);
    assert.ok(r.ok && r.suplementos.length === 2);
  });
});

describe("costo neto (tarifa + suplemento) y margen", () => {
  const temporadas = [{ nombre: "ALTA", fecha_inicio: "2026-12-01", fecha_fin: "2027-01-15", precio_persona: null, recargo_individual: 0 }];
  const grupos = [{ pax_desde: 1, pax_hasta: 4, precio: 200000, temporada: "ALTA" }, { pax_desde: 5, pax_hasta: 12, precio: 320000, temporada: "ALTA" }];
  const base = {
    temporadas, grupos, franjasPorTemporada: new Map([["ALTA", PROVEEDOR]]), modo: "grupo" as const, fecha: new Date("2026-12-20T00:00:00"), liquidacion: "paquete", numNoches: 4, hoy: "2026-11-01",
  };
  test("5–12 pax, llegada nocturna: neto = 320.000 + 80.000 = 400.000; con 20 % de margen el precio es 400.000 / 0,8 = 500.000", () => {
    const r = costoNetoServicio({ ...base, pax: 6, horas: { llegada: "21:00" }, tramos: ["llegada"] });
    assert.ok(r.ok);
    assert.equal(r.ok && r.netoBase, 320000);
    assert.equal(r.ok && r.netoSuplementos, 80000);
    assert.equal(r.ok && r.costoNeto, 400000);
    assert.equal(Math.round((r.ok ? r.costoNeto : 0) / (1 - 0.2)), 500000, "el margen se aplica DESPUÉS de sumar el suplemento (sin duplicarlo)");
  });
  test("ida y regreso con horas nocturnas en ambos tramos suma un suplemento por tramo", () => {
    const r = costoNetoServicio({ ...base, pax: 2, horas: { llegada: "21:00", salida: "04:00" }, tramos: ["llegada", "salida"] });
    assert.equal(r.ok && r.netoSuplementos, 90000);
    assert.equal(r.ok && r.costoNeto, 200000 + 90000);
  });
  test("un trayecto de llegada no pide la hora de salida aunque la franja la cubra", () => {
    const r = costoNetoServicio({ ...base, pax: 2, horas: { llegada: "10:00" }, tramos: ["llegada"] });
    assert.ok(r.ok && r.netoSuplementos === 0 && r.pendientes.length === 0);
  });
  test("sin regla para el grupo (41 pax) falla con motivo franja_invalida y detalle legible; no inventa importe", () => {
    const r = costoNetoServicio({ ...base, grupos: [{ pax_desde: 1, pax_hasta: 60, precio: 900000, temporada: "ALTA" }], pax: 41, horas: { llegada: "21:00" }, tramos: ["llegada"] });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "franja_invalida");
    assert.match(!r.ok ? r.detalle ?? "" : "", /falta cargar ese rango/);
  });
});

describe("precio propio por trayecto / ida y regreso", () => {
  const filas: FilaPrecioAlcance[] = [
    { alcance: "trayecto", pax_desde: 1, pax_hasta: 4, precio: 100000 }, { alcance: "trayecto", pax_desde: 5, pax_hasta: 12, precio: 150000 },
    { alcance: "ida_regreso", pax_desde: 1, pax_hasta: 4, precio: 170000 }, { alcance: "ida_regreso", pax_desde: 5, pax_hasta: 12, precio: 260000 },
  ];
  test("cada alcance usa SU precio: un trayecto 100.000, ida y regreso 170.000 (no es el doble ni la mitad)", () => {
    const t = resolverPrecioAlcance({ filas, alcance: "llegada", modo: "grupo", pax: 3 });
    const s = resolverPrecioAlcance({ filas, alcance: "salida", modo: "grupo", pax: 3 });
    const ir = resolverPrecioAlcance({ filas, alcance: "ida_regreso", modo: "grupo", pax: 3 });
    assert.deepEqual([t.ok && t.neto, s.ok && s.neto, ir.ok && ir.neto], [100000, 100000, 170000]);
    assert.notEqual(ir.ok && ir.neto, 2 * (t.ok ? t.neto : 0));
  });
  test("el rango se elige por pasajeros", () => {
    assert.equal((resolverPrecioAlcance({ filas, alcance: "ida_regreso", modo: "grupo", pax: 8 }) as { neto: number }).neto, 260000);
  });
  test("sin precio de ida y regreso NO se deriva del de un trayecto: falla", () => {
    const solo = filas.filter((f) => f.alcance === "trayecto");
    const r = resolverPrecioAlcance({ filas: solo, alcance: "ida_regreso", modo: "grupo", pax: 3 });
    assert.equal(!r.ok && r.motivo, "sin_precio_alcance");
    const r2 = resolverPrecioAlcance({ filas: filas.filter((f) => f.alcance === "ida_regreso"), alcance: "salida", modo: "grupo", pax: 3 });
    assert.equal(!r2.ok && r2.motivo, "sin_precio_alcance", "ni al revés");
  });
  test("pasajeros fuera de todo rango: falla (no usa el rango más cercano)", () => {
    const r = resolverPrecioAlcance({ filas, alcance: "llegada", modo: "grupo", pax: 13 });
    assert.equal(!r.ok && r.motivo, "sin_precio_alcance");
  });
  test("modo persona usa la fila sin rango de ese alcance", () => {
    const personas: FilaPrecioAlcance[] = [{ alcance: "trayecto", pax_desde: null, pax_hasta: null, precio: 50000 }, { alcance: "ida_regreso", pax_desde: null, pax_hasta: null, precio: 80000 }];
    assert.equal((resolverPrecioAlcance({ filas: personas, alcance: "salida", modo: "persona", pax: 3 }) as { neto: number }).neto, 50000);
    assert.equal((resolverPrecioAlcance({ filas: personas, alcance: "ida_regreso", modo: "persona", pax: 3 }) as { neto: number }).neto, 80000);
  });
  test("validación: cruces dentro del MISMO alcance se rechazan; el mismo rango en otro alcance es válido", () => {
    assert.deepEqual(validarPreciosAlcance(filas), []);
    assert.ok(validarPreciosAlcance([...filas, { alcance: "trayecto", pax_desde: 4, pax_hasta: 6, precio: 1 }]).some((e) => /se cruzan/.test(e)));
    assert.ok(validarPreciosAlcance([{ alcance: "trayecto", pax_desde: null, pax_hasta: null, precio: 1 }, { alcance: "trayecto", pax_desde: null, pax_hasta: null, precio: 2 }]).some((e) => /más de un precio por persona/.test(e)));
    assert.ok(validarPreciosAlcance([{ alcance: "trayecto", pax_desde: 1, pax_hasta: null, precio: 1 }]).length);
    assert.ok(validarPreciosAlcance([{ alcance: "trayecto", pax_desde: 1, pax_hasta: 4, precio: -5 }]).length);
  });
  test("tramos y alcance de precio por alcance vendido", () => {
    assert.deepEqual(tramosDeAlcance("ida_regreso"), ["llegada", "salida"]);
    assert.deepEqual(tramosDeAlcance("salida"), ["salida"]);
    assert.equal(alcancePrecioDe("llegada"), "trayecto");
    assert.equal(alcancePrecioDe("ida_regreso"), "ida_regreso");
  });
});

describe("clasificación del servicio y combos", () => {
  test("sin clasificar (legado) es válido y NO se asume traslado ni tour", () => {
    assert.deepEqual(validarClasificacion({ tipo_receptivo: null }), []);
    assert.equal(llevaTraslado({ tipo_receptivo: null }), null);
    assert.equal(llevaTraslado({ tipo_receptivo: undefined }), null);
  });
  test("tour, asistencia y traslado no declaran datos de combo", () => {
    assert.deepEqual(validarClasificacion({ tipo_receptivo: "traslado" }), []);
    assert.ok(validarClasificacion({ tipo_receptivo: "tour", combo_incluye_traslado: true, combo_traslado_alcance: "ida_regreso" }).length);
    assert.equal(llevaTraslado({ tipo_receptivo: "tour" }), false);
    assert.equal(llevaTraslado({ tipo_receptivo: "asistencia_medica" }), false);
    assert.equal(llevaTraslado({ tipo_receptivo: "traslado" }), true);
  });
  test("un combo DEBE declarar si lleva traslado; con traslado, cómo se cobra", () => {
    assert.ok(validarClasificacion({ tipo_receptivo: "combo" }).length);
    assert.ok(validarClasificacion({ tipo_receptivo: "combo", combo_incluye_traslado: true }).length);
    assert.deepEqual(validarClasificacion({ tipo_receptivo: "combo", combo_incluye_traslado: true, combo_traslado_alcance: "trayecto_llegada" }), []);
    assert.deepEqual(validarClasificacion({ tipo_receptivo: "combo", combo_incluye_traslado: false }), []);
    assert.ok(validarClasificacion({ tipo_receptivo: "combo", combo_incluye_traslado: false, combo_traslado_alcance: "ida_regreso" }).length);
    assert.equal(llevaTraslado({ tipo_receptivo: "combo", combo_incluye_traslado: true, combo_traslado_alcance: "ida_regreso" }), true);
    assert.equal(llevaTraslado({ tipo_receptivo: "combo", combo_incluye_traslado: false }), false);
    assert.equal(alcanceVentaDeCombo("trayecto_salida"), "salida");
  });
  test("un tipo fuera de catálogo se rechaza", () => {
    assert.ok(validarClasificacion({ tipo_receptivo: "otro" as never }).length);
  });
});
