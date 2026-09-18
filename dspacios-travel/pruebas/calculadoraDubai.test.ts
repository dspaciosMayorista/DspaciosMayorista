import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  generarTarifasDubai,
  validarPromoDubai,
  validarDubaiParams,
  type DubaiParams,
  type DubaiPromo,
  type DubaiBase,
} from "../lib/calc/calculadoras.ts";
import { distribuirPorHabitaciones, type HabitacionConsultada } from "../lib/reservar/distribucionHabitaciones.ts";
import { defaultAcomConfig } from "../lib/acomodaciones.ts";

// ─────────────────────────────────────────────────────────────────────────
// Pruebas EJECUTABLES de la calculadora "Dubai" — fase principal (edades
// propias por base/promoción, suplementos propios rediseñados, validación
// de solapamiento por categoría real). Ver la cabecera de
// `lib/calc/calculadoras.ts` para el diseño completo.
// ─────────────────────────────────────────────────────────────────────────

function paramsBase(over: Partial<DubaiParams> = {}): DubaiParams {
  return {
    regimen_base: "PC",
    modificadores: { sencilla_pct: 50, pax3_pct: -20, pax4_pct: -20, nino_pct: -50, infante_pct: -100 },
    suplementos: [{ regimen: "PAM", monto: 45_000 }],
    bases: [{ categoria: "Estandar", temporada: "ALTA", precio: 500_000 }],
    ...over,
  };
}

describe("generarTarifasDubai — no regresión: fórmula base sin cambios (bases, sin promos)", () => {
  test("sencilla/doble/triple/multiple/niño/infante con la MISMA fórmula documentada de siempre", () => {
    const filas = generarTarifasDubai(paramsBase());
    const pc = filas.find((f) => f.alimentacion === "PC")!;
    assert.equal(pc.neto_sencilla, Math.round(500_000 * 1.5));
    assert.equal(pc.neto_doble, 500_000);
    assert.equal(pc.neto_triple, Math.round((500_000 * 2 + 500_000 * 0.8) / 3));
    assert.equal(pc.neto_multiple, Math.round((500_000 * 2 + 500_000 * 0.8 + 500_000 * 0.8) / 4));
    assert.equal(pc.neto_nino, Math.round(500_000 * 0.5));
    assert.equal(pc.neto_infante, 0);
  });

  test("el suplemento de régimen se suma DESPUÉS de derivar, nunca se descuenta ni se multiplica", () => {
    const filas = generarTarifasDubai(paramsBase());
    const pam = filas.find((f) => f.alimentacion === "PAM")!;
    const pc = filas.find((f) => f.alimentacion === "PC")!;
    assert.equal(pam.neto_doble, pc.neto_doble + 45_000);
    assert.equal(pam.neto_sencilla, pc.neto_sencilla + 45_000);
    assert.equal(pam.neto_nino, pc.neto_nino + 45_000);
  });
});

describe("Registro histórico SIN los campos nuevos sigue funcionando (compatibilidad)", () => {
  test("fila histórica sin ningún campo nuevo reproduce EXACTAMENTE el cálculo anterior — netos, edades null, notas ausente", () => {
    const filas = generarTarifasDubai(paramsBase());
    for (const f of filas) {
      assert.equal(f.neto_nino2, null);
      assert.equal(f.edad_infante_min, null);
      assert.equal(f.edad_infante_max, null);
      assert.equal(f.edad_nino_min, null);
      assert.equal(f.edad_nino_max, null);
      assert.equal(f.notas, undefined);
    }
  });

  test("una promo SIN ninguno de los campos nuevos (dato histórico): suplemento general, pero el descuento aplica sobre TODA la tarifa (base + suplemento) — corrección de esta ronda", () => {
    const promo: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "PROMO26", regimen: "PAM", descuentoPct: 10 };
    const filas = generarTarifasDubai(paramsBase({ promos: [promo] }));
    const filaPromo = filas.find((f) => f.temporada === "PROMO26")!;
    // Antes: Math.round(500_000*0.9 + 45_000) = 495_000 (el suplemento general
    // se sumaba DESPUÉS del descuento, sin descontarse). Ahora el descuento se
    // aplica sobre la tarifa completa (base + suplemento efectivo).
    assert.equal(filaPromo.neto_doble, Math.round((500_000 + 45_000) * 0.9));
    assert.equal(filaPromo.notas, undefined);
    assert.equal(filaPromo.neto_nino2, null);
    assert.equal(filaPromo.edad_infante_min, null);
  });

  test("agregar SOLO nino2_pct no cambia sencilla/doble/triple/multiple/niño/infante ni edades", () => {
    const sinNino2 = generarTarifasDubai(paramsBase());
    const conNino2 = generarTarifasDubai(paramsBase({ modificadores: { ...paramsBase().modificadores, nino2_pct: -30 } }));
    for (let i = 0; i < sinNino2.length; i++) {
      assert.equal(conNino2[i].neto_sencilla, sinNino2[i].neto_sencilla);
      assert.equal(conNino2[i].neto_doble, sinNino2[i].neto_doble);
      assert.equal(conNino2[i].neto_triple, sinNino2[i].neto_triple);
      assert.equal(conNino2[i].neto_multiple, sinNino2[i].neto_multiple);
      assert.equal(conNino2[i].neto_nino, sinNino2[i].neto_nino);
      assert.equal(conNino2[i].neto_infante, sinNino2[i].neto_infante);
      assert.equal(conNino2[i].edad_infante_min, sinNino2[i].edad_infante_min);
    }
  });
});

describe("Descuento distinto para Niño 1 y Niño 2 (nino_pct vs nino2_pct, generales)", () => {
  test("nino_pct=-50 y nino2_pct=-30 producen netos DISTINTOS, cada uno sobre la MISMA base", () => {
    const params = paramsBase({ modificadores: { sencilla_pct: 50, pax3_pct: -20, pax4_pct: -20, nino_pct: -50, nino2_pct: -30, infante_pct: -100 } });
    const filas = generarTarifasDubai(params);
    const pc = filas.find((f) => f.alimentacion === "PC")!;
    assert.equal(pc.neto_nino, Math.round(500_000 * 0.5));
    assert.equal(pc.neto_nino2, Math.round(500_000 * 0.7));
    assert.notEqual(pc.neto_nino, pc.neto_nino2);
  });
});

describe("Edades propias de BASE", () => {
  test("una base con usarEdadesPropias escribe sus 4 límites en las filas que genera", () => {
    const base: DubaiBase = {
      categoria: "Estandar", temporada: "ALTA", precio: 500_000,
      usarEdadesPropias: true, edadesPropias: { infanteMin: 0, infanteMax: 4, ninoMin: 5, ninoMax: 12 },
    };
    const filas = generarTarifasDubai(paramsBase({ bases: [base] }));
    for (const f of filas) {
      assert.equal(f.edad_infante_min, 0);
      assert.equal(f.edad_infante_max, 4);
      assert.equal(f.edad_nino_min, 5);
      assert.equal(f.edad_nino_max, 12);
    }
  });

  test("una base SIN usarEdadesPropias deja las 4 columnas en null (fallback general)", () => {
    const filas = generarTarifasDubai(paramsBase());
    for (const f of filas) assert.equal(f.edad_infante_min, null);
  });
});

describe("Edades propias de PROMOCIÓN — gana sobre la base, hereda si no tiene la propia", () => {
  const BASE_CON_EDAD: DubaiBase = {
    categoria: "Estandar", temporada: "ALTA", precio: 500_000,
    usarEdadesPropias: true, edadesPropias: { infanteMin: 0, infanteMax: 3, ninoMin: 4, ninoMax: 11 },
  };

  test("override por promoción GANA sobre el de su base", () => {
    const promo: DubaiPromo = {
      temporadaBase: "ALTA", temporadaPromo: "PROMO26", regimen: "PC", descuentoPct: 10,
      usarEdadesPropias: true, edadesPropias: { infanteMin: 0, infanteMax: 5, ninoMin: 6, ninoMax: 14 },
    };
    const filas = generarTarifasDubai(paramsBase({ bases: [BASE_CON_EDAD], promos: [promo] }));
    const filaPromo = filas.find((f) => f.temporada === "PROMO26")!;
    assert.equal(filaPromo.edad_infante_max, 5); // de la PROMO, no de la base (3)
    assert.equal(filaPromo.edad_nino_max, 14);
  });

  test("promoción SIN override propio hereda el de su base", () => {
    const promo: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "PROMO26", regimen: "PC", descuentoPct: 10 };
    const filas = generarTarifasDubai(paramsBase({ bases: [BASE_CON_EDAD], promos: [promo] }));
    const filaPromo = filas.find((f) => f.temporada === "PROMO26")!;
    assert.equal(filaPromo.edad_infante_max, 3); // heredado de la BASE
    assert.equal(filaPromo.edad_nino_max, 11);
  });

  test("promoción sin override propio y base SIN override tampoco → null (fallback general)", () => {
    const baseSinEdad: DubaiBase = { categoria: "Estandar", temporada: "ALTA", precio: 500_000 };
    const promo: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "PROMO26", regimen: "PC", descuentoPct: 10 };
    const filas = generarTarifasDubai(paramsBase({ bases: [baseSinEdad], promos: [promo] }));
    const filaPromo = filas.find((f) => f.temporada === "PROMO26")!;
    assert.equal(filaPromo.edad_infante_min, null);
    assert.equal(filaPromo.edad_nino_max, null);
  });

  test("la fila de la BASE misma (temporada ALTA) conserva su propia edad, sin verse afectada por la promo", () => {
    const promo: DubaiPromo = {
      temporadaBase: "ALTA", temporadaPromo: "PROMO26", regimen: "PC", descuentoPct: 10,
      usarEdadesPropias: true, edadesPropias: { infanteMin: 0, infanteMax: 5, ninoMin: 6, ninoMax: 14 },
    };
    const filas = generarTarifasDubai(paramsBase({ bases: [BASE_CON_EDAD], promos: [promo] }));
    const filaBase = filas.find((f) => f.temporada === "ALTA" && f.alimentacion === "PC")!;
    assert.equal(filaBase.edad_infante_max, 3); // de SU PROPIA base, no de la promo
  });
});

describe("Suplementos propios de BASE (fallback general vs propios, sin duplicar)", () => {
  test("base SIN usarSuplementosPropios usa el general (fallback)", () => {
    const filas = generarTarifasDubai(paramsBase());
    const pam = filas.find((f) => f.alimentacion === "PAM")!;
    assert.equal(pam.neto_doble, 500_000 + 45_000);
  });

  test("base CON usarSuplementosPropios usa EXCLUSIVAMENTE su propio suplemento — nunca el general, nunca la suma de ambos", () => {
    const base: DubaiBase = {
      categoria: "Estandar", temporada: "ALTA", precio: 500_000,
      usarSuplementosPropios: true, suplementosPropios: [{ regimen: "PAM", monto: 20_000 }],
    };
    const filas = generarTarifasDubai(paramsBase({ bases: [base] }));
    const pam = filas.find((f) => f.alimentacion === "PAM")!;
    assert.equal(pam.neto_doble, 500_000 + 20_000);
    assert.notEqual(pam.neto_doble, 500_000 + 45_000);
    assert.notEqual(pam.neto_doble, 500_000 + 20_000 + 45_000);
  });

  test("el régimen BASE de una fila base NUNCA lleva suplemento — ni propio ni general, siempre 0", () => {
    const base: DubaiBase = {
      categoria: "Estandar", temporada: "ALTA", precio: 500_000,
      usarSuplementosPropios: true, suplementosPropios: [{ regimen: "PC", monto: 99_999 }], // PC es el régimen base
    };
    const filas = generarTarifasDubai(paramsBase({ bases: [base] }));
    const pc = filas.find((f) => f.alimentacion === "PC")!;
    assert.equal(pc.neto_doble, 500_000); // sin el 99999, el régimen base siempre es 0
  });

  test("una base con suplementos propios NO afecta a otra base del mismo hotel", () => {
    const baseA: DubaiBase = {
      categoria: "Estandar", temporada: "ALTA", precio: 500_000,
      usarSuplementosPropios: true, suplementosPropios: [{ regimen: "PAM", monto: 999_999 }],
    };
    const baseB: DubaiBase = { categoria: "Superior", temporada: "ALTA", precio: 600_000 };
    const filas = generarTarifasDubai(paramsBase({ bases: [baseA, baseB] }));
    const pamSuperior = filas.find((f) => f.alimentacion === "PAM" && f.tipo_habitacion === "Superior")!;
    assert.equal(pamSuperior.neto_doble, 600_000 + 45_000); // sigue con el general
  });
});

describe("Suplemento propio de PROMOCIÓN — un único valor atado a promo.regimen, incluido el régimen base", () => {
  test("promo CON usarSuplementoPropio usa EXCLUSIVAMENTE su monto — nunca el general, y el descuento cubre base+suplemento", () => {
    const promo: DubaiPromo = {
      temporadaBase: "ALTA", temporadaPromo: "PROMO26", regimen: "PAM", descuentoPct: 10,
      usarSuplementoPropio: true, suplementoPropioMonto: 20_000,
    };
    const filas = generarTarifasDubai(paramsBase({ promos: [promo] }));
    const fila = filas.find((f) => f.temporada === "PROMO26")!;
    // (500_000 + 20_000) × 0.9 = 468_000 — el suplemento propio de la promo
    // (20_000) entra al valor completo ANTES del descuento, no se suma después.
    assert.equal(fila.neto_doble, Math.round((500_000 + 20_000) * 0.9));
    assert.notEqual(fila.neto_doble, Math.round((500_000 + 45_000) * 0.9)); // nunca el general
  });

  test("suplemento propio de promoción en RÉGIMEN BASE (a diferencia de una base, la promo SÍ puede tener cargo sobre el régimen base)", () => {
    const promo: DubaiPromo = {
      temporadaBase: "ALTA", temporadaPromo: "PROMO_BASE", regimen: "PC", descuentoPct: 10, // PC = régimen base
      usarSuplementoPropio: true, suplementoPropioMonto: 15_000,
    };
    const filas = generarTarifasDubai(paramsBase({ promos: [promo] }));
    const fila = filas.find((f) => f.temporada === "PROMO_BASE")!;
    // (500_000 + 15_000) × 0.9 = 463_500 — SÍ se suma y SÍ se descuenta, aunque sea el régimen base.
    assert.equal(fila.neto_doble, Math.round((500_000 + 15_000) * 0.9));
  });

  test("cero explícito (0) es un suplemento propio VÁLIDO, distinto de 'sin configurar'", () => {
    const promo: DubaiPromo = {
      temporadaBase: "ALTA", temporadaPromo: "PROMO26", regimen: "PAM", descuentoPct: 10,
      usarSuplementoPropio: true, suplementoPropioMonto: 0,
    };
    const filas = generarTarifasDubai(paramsBase({ promos: [promo] }));
    const fila = filas.find((f) => f.temporada === "PROMO26")!;
    assert.equal(fila.neto_doble, Math.round((500_000 + 0) * 0.9)); // +0, nunca +45000 del general
  });

  test("el suplemento efectivo SÍ recibe el descuento (regla comercial corregida — antes se sumaba después, sin descontarse)", () => {
    const promo: DubaiPromo = {
      temporadaBase: "ALTA", temporadaPromo: "PROMO26", regimen: "PAM", descuentoPct: 50,
      usarSuplementoPropio: true, suplementoPropioMonto: 20_000,
    };
    const filas = generarTarifasDubai(paramsBase({ promos: [promo] }));
    const fila = filas.find((f) => f.temporada === "PROMO26")!;
    // (500_000 + 20_000) × 0.5 = 260_000 — el suplemento (20_000) SÍ se
    // reduce a la mitad junto con la base, nunca se suma completo después.
    assert.equal(fila.neto_doble, Math.round((500_000 + 20_000) * 0.5));
    assert.notEqual(fila.neto_doble, Math.round(500_000 * 0.5 + 20_000)); // el cálculo viejo (bug)
  });

  test("promo sin suplemento propio hereda el propio de SU BASE referenciada (antes se ignoraba, siempre caía al general)", () => {
    const baseConSuplementoPropio: DubaiBase = {
      categoria: "Estandar", temporada: "ALTA", precio: 200_000,
      usarSuplementosPropios: true, suplementosPropios: [{ regimen: "FULL", monto: 200_000 }],
    };
    const promo: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "PROMO_FULL", regimen: "FULL", descuentoPct: 10 };
    const filas = generarTarifasDubai(paramsBase({ bases: [baseConSuplementoPropio], promos: [promo] }));
    const fila = filas.find((f) => f.temporada === "PROMO_FULL")!;
    // (200_000 + 200_000) × 0.9 = 360_000 — usa el suplemento PROPIO de la
    // base (200_000), no el general del hotel (45_000 en PAM, ni aplica a FULL).
    assert.equal(fila.neto_doble, Math.round((200_000 + 200_000) * 0.9));
  });
});

describe("Condiciones propias por promoción (sin cambios de diseño esta ronda)", () => {
  test("dos promos con condiciones DISTINTAS nunca se mezclan", () => {
    const promoA: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "PROMO_A", regimen: "PC", descuentoPct: 10, condicionesPropias: "Condición A" };
    const promoB: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "PROMO_B", regimen: "PC", descuentoPct: 10, condicionesPropias: "Condición B" };
    const filas = generarTarifasDubai(paramsBase({ promos: [promoA, promoB] }));
    assert.equal(filas.find((f) => f.temporada === "PROMO_A")!.notas, "Condición A");
    assert.equal(filas.find((f) => f.temporada === "PROMO_B")!.notas, "Condición B");
  });
});

describe("Validación fail-closed — validarPromoDubai / validarDubaiParams", () => {
  test("promo completa y válida → sin errores", () => {
    const promo: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "PROMO26", regimen: "PC", descuentoPct: 10 };
    assert.deepEqual(validarPromoDubai(promo, 0), []);
  });

  test("suplemento propio activado y VACÍO (null) → falla", () => {
    const promo: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "P", regimen: "PC", descuentoPct: 10, usarSuplementoPropio: true, suplementoPropioMonto: null };
    const errores = validarPromoDubai(promo, 0);
    assert.ok(errores.some((e) => /vacío/.test(e.mensaje)));
  });

  test("suplemento propio activado y AUSENTE (undefined) → falla igual que null", () => {
    const promo: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "P", regimen: "PC", descuentoPct: 10, usarSuplementoPropio: true };
    const errores = validarPromoDubai(promo, 0);
    assert.ok(errores.some((e) => /vacío/.test(e.mensaje)));
  });

  test("suplemento propio activado y CERO explícito → pasa (no es 'vacío')", () => {
    const promo: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "P", regimen: "PC", descuentoPct: 10, usarSuplementoPropio: true, suplementoPropioMonto: 0 };
    assert.deepEqual(validarPromoDubai(promo, 0), []);
  });

  test("suplemento propio negativo → falla", () => {
    const promo: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "P", regimen: "PC", descuentoPct: 10, usarSuplementoPropio: true, suplementoPropioMonto: -1 };
    assert.ok(validarPromoDubai(promo, 0).length > 0);
  });

  test("edades propias de promo: rango incompleto (activado sin objeto) → falla", () => {
    const promo: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "P", regimen: "PC", descuentoPct: 10, usarEdadesPropias: true };
    assert.ok(validarPromoDubai(promo, 0).some((e) => /4 límites/.test(e.mensaje)));
  });

  test("edades propias: ninoMax > 17 → falla", () => {
    const promo: DubaiPromo = {
      temporadaBase: "ALTA", temporadaPromo: "P", regimen: "PC", descuentoPct: 10,
      usarEdadesPropias: true, edadesPropias: { infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax: 18 },
    };
    assert.ok(validarPromoDubai(promo, 0).length > 0);
  });

  test("edades propias: rango discontinuo (hueco entre infante y niño) → falla", () => {
    const promo: DubaiPromo = {
      temporadaBase: "ALTA", temporadaPromo: "P", regimen: "PC", descuentoPct: 10,
      usarEdadesPropias: true, edadesPropias: { infanteMin: 0, infanteMax: 2, ninoMin: 5, ninoMax: 10 },
    };
    assert.ok(validarPromoDubai(promo, 0).length > 0);
  });

  test("edades propias: rango solapado (ninoMin dentro del rango de infante) → falla", () => {
    const promo: DubaiPromo = {
      temporadaBase: "ALTA", temporadaPromo: "P", regimen: "PC", descuentoPct: 10,
      usarEdadesPropias: true, edadesPropias: { infanteMin: 0, infanteMax: 5, ninoMin: 3, ninoMax: 10 },
    };
    assert.ok(validarPromoDubai(promo, 0).length > 0);
  });

  test("temporadaPromo igual a temporadaBase → rango imposible, rechazado", () => {
    const promo: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "ALTA", regimen: "PC", descuentoPct: 10 };
    assert.ok(validarPromoDubai(promo, 0).length > 0);
  });

  test("descuentoPct fuera de (0,100) → rechazado", () => {
    for (const pct of [0, -5, 100, 150]) {
      assert.ok(validarPromoDubai({ temporadaBase: "ALTA", temporadaPromo: "P", regimen: "PC", descuentoPct: pct }, 0).length > 0, `pct=${pct}`);
    }
  });

  test("validarDubaiParams: bases duplicadas por categoría+temporada → rechazado", () => {
    const bases: DubaiBase[] = [
      { categoria: "Estandar", temporada: "ALTA", precio: 500_000 },
      { categoria: "Estandar", temporada: "ALTA", precio: 550_000 }, // misma categoria+temporada
    ];
    const errores = validarDubaiParams(paramsBase({ bases }));
    assert.ok(errores.some((e) => e.origen === "base" && /ambiguas/.test(e.mensaje)));
  });

  test("validarDubaiParams: bases con MISMA categoría pero temporada distinta → sin error", () => {
    const bases: DubaiBase[] = [
      { categoria: "Estandar", temporada: "ALTA", precio: 500_000 },
      { categoria: "Estandar", temporada: "BAJA", precio: 400_000 },
    ];
    const errores = validarDubaiParams(paramsBase({ bases }));
    assert.equal(errores.filter((e) => /ambiguas/.test(e.mensaje)).length, 0);
  });

  test("validarDubaiParams: dos promos MISMA temporadaPromo+régimen y categorías que SÍ intersectan → solapadas, rechazado", () => {
    const bases: DubaiBase[] = [
      { categoria: "Estandar", temporada: "ALTA", precio: 500_000 },
      { categoria: "Estandar", temporada: "MEDIA", precio: 480_000 },
    ];
    const promoA: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "PROMO_X", regimen: "PC", descuentoPct: 10 };
    const promoB: DubaiPromo = { temporadaBase: "MEDIA", temporadaPromo: "PROMO_X", regimen: "PC", descuentoPct: 20 };
    const errores = validarDubaiParams(paramsBase({ bases, promos: [promoA, promoB] }));
    assert.ok(errores.some((e) => e.origen === "promo" && /solapad/.test(e.mensaje) && /Estandar/.test(e.mensaje)));
  });

  test("validarDubaiParams: dos promos MISMA temporadaPromo+régimen pero categorías que NO intersectan → sin falso positivo", () => {
    const bases: DubaiBase[] = [
      { categoria: "Estandar", temporada: "ALTA", precio: 500_000 },
      { categoria: "Superior", temporada: "MEDIA", precio: 700_000 },
    ];
    const promoA: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "PROMO_X", regimen: "PC", descuentoPct: 10 };
    const promoB: DubaiPromo = { temporadaBase: "MEDIA", temporadaPromo: "PROMO_X", regimen: "PC", descuentoPct: 20 };
    const errores = validarDubaiParams(paramsBase({ bases, promos: [promoA, promoB] }));
    assert.equal(errores.filter((e) => /solapad/.test(e.mensaje)).length, 0, "no debe rechazar una configuración válida (categorías disjuntas)");
  });

  test("validarDubaiParams: sin promos ni duplicados → sin errores", () => {
    assert.deepEqual(validarDubaiParams(paramsBase()), []);
  });

  test("validarDubaiParams: cada error de base/promo apunta al origen e índice correctos", () => {
    const bases: DubaiBase[] = [{ categoria: "Estandar", temporada: "ALTA", precio: 500_000, usarSuplementosPropios: true, suplementosPropios: [] }];
    const promoInvalida: DubaiPromo = { temporadaBase: "ALTA", temporadaPromo: "ALTA", regimen: "PC", descuentoPct: 10 };
    const errores = validarDubaiParams(paramsBase({ bases, promos: [promoInvalida] }));
    assert.ok(errores.some((e) => e.origen === "base" && e.indice === 0));
    assert.ok(errores.some((e) => e.origen === "promo" && e.indice === 0));
  });
});

describe('Niño 1 / Niño 2 "por habitación" — reutiliza distribuirPorHabitaciones (motor EXISTENTE, sin cambios)', () => {
  const CONFIG_DOBLE = { ...defaultAcomConfig("doble"), pax_max: 4, chd_max: 2 };
  const CONFIG_DOBLE_UN_NINO = { ...defaultAcomConfig("doble"), pax_max: 3, chd_max: 1 };

  test("dos habitaciones que admiten máximo 1 niño cada una, con 2 niños en total → dos Niño 1", () => {
    const habitaciones: HabitacionConsultada[] = [
      { acom: "doble", config: CONFIG_DOBLE_UN_NINO },
      { acom: "doble", config: CONFIG_DOBLE_UN_NINO },
    ];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 2, infantes: 0, habitaciones });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.habitaciones[0].nino, 1);
    assert.equal(r.habitaciones[0].nino2, 0);
    assert.equal(r.habitaciones[1].nino, 1);
    assert.equal(r.habitaciones[1].nino2, 0);
  });

  test("una habitación con DOS menores → Niño 1 + Niño 2 en la MISMA habitación", () => {
    const habitaciones: HabitacionConsultada[] = [{ acom: "doble", config: CONFIG_DOBLE }];
    const r = distribuirPorHabitaciones({ adultosDeclarados: 2, ninos: 2, infantes: 0, habitaciones });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.habitaciones[0].nino, 1);
    assert.equal(r.habitaciones[0].nino2, 1);
  });
});
