import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { distribuirOcupacionUnidad } from "../lib/tarifario/distribucionOcupacionUnidad.ts";

// ─────────────────────────────────────────────────────────────────────────
// Pruebas EJECUTABLES (no wiring) del adaptador de ocupación para hoteles
// `modelo_tarifario = "unidad"` — ver la cabecera de
// `lib/tarifario/distribucionOcupacionUnidad.ts` para la causa completa del
// defecto que corrige (el reparto de PERSONA, vía `hotel_acomodaciones`/
// `defaultAcomConfig`, rechazaba 2 adultos + 1 menor por una capacidad de
// niño SIEMPRE 0 cuando el hotel no tenía filas en esa tabla).
// ─────────────────────────────────────────────────────────────────────────

const H = (acom: "doble" | "sencilla" | "triple" | "multiple" = "doble") => ({ acom });

describe("distribuirOcupacionUnidad — caso obligatorio del encargo", () => {
  test("1 Doble, 2 adultos + 1 menor de 8 años, capacidad maxPax=3/minPax=1 → ok, adultos=2, edadesMenores=[8]", () => {
    const r = distribuirOcupacionUnidad({
      habitacionesConsultadas: [H()],
      adultosDeclarados: 2,
      edadesMenores: [8],
      capacidad: { minPax: 1, maxPax: 3 },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.habitaciones.length, 1);
    assert.equal(r.habitaciones[0].adultos, 2);
    assert.deepEqual(r.habitaciones[0].edadesMenores, [8]);
  });

  test("mismo caso con maxPax=2 → seleccion_invalida (2 adultos + 1 menor = 3 pax, excede la capacidad)", () => {
    const r = distribuirOcupacionUnidad({
      habitacionesConsultadas: [H()],
      adultosDeclarados: 2,
      edadesMenores: [8],
      capacidad: { minPax: 1, maxPax: 2 },
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.tipo, "seleccion_invalida");
  });
});

describe("distribuirOcupacionUnidad — hotel sin hotel_acomodaciones (capacidad SOLO de la tarifa)", () => {
  test("no depende de ninguna tabla de acomodaciones: la capacidad llega ÍNTEGRA por parámetro, nunca se deriva del nombre de la habitación", () => {
    const rDoble = distribuirOcupacionUnidad({
      habitacionesConsultadas: [H("doble")],
      adultosDeclarados: 2,
      edadesMenores: [8],
      capacidad: { minPax: 1, maxPax: 3 },
    });
    const rTriple = distribuirOcupacionUnidad({
      habitacionesConsultadas: [H("triple")],
      adultosDeclarados: 2,
      edadesMenores: [8],
      capacidad: { minPax: 1, maxPax: 3 },
    });
    // Misma capacidad explícita → mismo resultado, sin importar el nombre.
    assert.deepEqual(rDoble.ok && rDoble.habitaciones.map((h) => ({ adultos: h.adultos, edadesMenores: h.edadesMenores })), rTriple.ok && rTriple.habitaciones.map((h) => ({ adultos: h.adultos, edadesMenores: h.edadesMenores })));
  });
});

describe("distribuirOcupacionUnidad — varias habitaciones, capacidad uniforme por combinación", () => {
  test("2 habitaciones, maxPax=2, 2 adultos + 2 menores → reparte 1 menor por habitación (nunca ambos en la primera)", () => {
    const r = distribuirOcupacionUnidad({
      habitacionesConsultadas: [H(), H()],
      adultosDeclarados: 2,
      edadesMenores: [8, 9],
      capacidad: { minPax: 1, maxPax: 2 },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.habitaciones.length, 2);
    for (const h of r.habitaciones) {
      assert.equal(h.adultos, 1);
      assert.equal(h.adultos + h.edadesMenores.length <= 2, true);
    }
    assert.deepEqual(r.habitaciones.map((h) => h.edadesMenores.length).sort(), [1, 1]);
  });

  test("dumping ingenuo (todo en la primera habitación) rechazaría esto: 1 adulto+2 menores=3 > maxPax(2) — el reparto parejo lo evita", () => {
    const r = distribuirOcupacionUnidad({
      habitacionesConsultadas: [H(), H()],
      adultosDeclarados: 2,
      edadesMenores: [8, 9],
      capacidad: { minPax: 1, maxPax: 2 },
    });
    assert.equal(r.ok, true);
  });

  test("3 habitaciones, capacidad amplia, adultos y menores no múltiplos de 3 → cada habitación respeta el máximo, todas las edades quedan asociadas", () => {
    const r = distribuirOcupacionUnidad({
      habitacionesConsultadas: [H(), H(), H()],
      adultosDeclarados: 4,
      edadesMenores: [2, 5, 8, 11, 14],
      capacidad: { minPax: 1, maxPax: 4 },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.habitaciones.length, 3);
    const totalAdultos = r.habitaciones.reduce((s, h) => s + h.adultos, 0);
    const totalMenores = r.habitaciones.reduce((s, h) => s + h.edadesMenores.length, 0);
    assert.equal(totalAdultos, 4);
    assert.equal(totalMenores, 5);
    for (const h of r.habitaciones) {
      assert.ok(h.adultos >= 1, "cada habitación tiene al menos 1 adulto");
      assert.ok(h.adultos + h.edadesMenores.length <= 4, "ninguna habitación excede maxPax");
    }
    // Todas las edades originales aparecen, sin duplicar ni perder ninguna.
    const edadesAsignadas = r.habitaciones.flatMap((h) => h.edadesMenores).sort((a, b) => a - b);
    assert.deepEqual(edadesAsignadas, [2, 5, 8, 11, 14]);
  });

  test("capacidades diferentes por combinación se evalúan por separado (llamadas independientes, nunca mezcladas): la misma ocupación cabe con maxPax=3 pero no con maxPax=2", () => {
    const entrada = { habitacionesConsultadas: [H(), H()], adultosDeclarados: 4, edadesMenores: [8] };
    const conCapacidadChica = distribuirOcupacionUnidad({ ...entrada, capacidad: { minPax: 1, maxPax: 2 } });
    const conCapacidadGrande = distribuirOcupacionUnidad({ ...entrada, capacidad: { minPax: 1, maxPax: 3 } });
    assert.equal(conCapacidadChica.ok, false, "4 adultos + 1 menor = 5 pax > 2*2=4");
    assert.equal(conCapacidadGrande.ok, true, "5 pax <= 2*3=6");
  });
});

describe("distribuirOcupacionUnidad — rechazos honestos (nunca inventa capacidad, nunca lanza)", () => {
  test("sin habitaciones consultadas → seleccion_invalida", () => {
    const r = distribuirOcupacionUnidad({ habitacionesConsultadas: [], adultosDeclarados: 2, edadesMenores: [], capacidad: { minPax: 1, maxPax: null } });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.tipo, "seleccion_invalida");
  });

  test("menos adultos que habitaciones → seleccion_invalida (cada habitación necesita al menos 1 adulto)", () => {
    const r = distribuirOcupacionUnidad({
      habitacionesConsultadas: [H(), H(), H()],
      adultosDeclarados: 2,
      edadesMenores: [],
      capacidad: { minPax: 1, maxPax: null },
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.tipo, "seleccion_invalida");
    assert.match(r.error, /al menos 1 adulto/);
  });

  test("maxPax: null (sin cota) admite ocupaciones grandes sin rechazar por capacidad", () => {
    const r = distribuirOcupacionUnidad({
      habitacionesConsultadas: [H()],
      adultosDeclarados: 5,
      edadesMenores: [3, 7],
      capacidad: { minPax: 1, maxPax: null },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.habitaciones[0].adultos, 5);
    assert.deepEqual(r.habitaciones[0].edadesMenores, [3, 7]);
  });

  test("total de pax por debajo del mínimo agregado (N×minPax) → seleccion_invalida", () => {
    const r = distribuirOcupacionUnidad({
      habitacionesConsultadas: [H(), H()],
      adultosDeclarados: 2,
      edadesMenores: [],
      capacidad: { minPax: 2, maxPax: 4 },
    });
    // 2 habitaciones × minPax 2 = 4 pax mínimo; solo hay 2 adultos.
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.tipo, "seleccion_invalida");
  });

  test("capacidad.minPax inválido (0) → configuracion_invalida", () => {
    const r = distribuirOcupacionUnidad({
      habitacionesConsultadas: [H()],
      adultosDeclarados: 2,
      edadesMenores: [],
      capacidad: { minPax: 0, maxPax: 3 },
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.tipo, "configuracion_invalida");
  });

  test("capacidad.maxPax menor que minPax → configuracion_invalida", () => {
    const r = distribuirOcupacionUnidad({
      habitacionesConsultadas: [H()],
      adultosDeclarados: 2,
      edadesMenores: [],
      capacidad: { minPax: 3, maxPax: 2 },
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.tipo, "configuracion_invalida");
  });

  test("edadesMenores con un valor negativo → configuracion_invalida (nunca lanza)", () => {
    const r = distribuirOcupacionUnidad({
      habitacionesConsultadas: [H()],
      adultosDeclarados: 2,
      edadesMenores: [-1],
      capacidad: { minPax: 1, maxPax: 3 },
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.tipo, "configuracion_invalida");
  });

  test("no muta los arreglos de entrada", () => {
    const habitaciones = [H(), H()];
    const edades = [8, 9];
    const copiaHab = [...habitaciones];
    const copiaEdades = [...edades];
    distribuirOcupacionUnidad({ habitacionesConsultadas: habitaciones, adultosDeclarados: 2, edadesMenores: edades, capacidad: { minPax: 1, maxPax: 2 } });
    assert.deepEqual(habitaciones, copiaHab);
    assert.deepEqual(edades, copiaEdades);
  });
});
