import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  EDAD_MENOR_MAX,
  MAX_MENORES_POR_CONSULTA,
  MAX_PAX_CONSULTA,
  ajustarCantidadEdades,
  parseEdadMenor,
  validarCantidadMenores,
  validarEdadesMenores,
  clasificarYRepartirMenores,
  verificarTarifasMenoresDisponibles,
} from "../lib/reservar/edadesMenores.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

// ───────────────────────────────────────────────────────────────────────────
// Vista Booking — edad exacta de cada menor en la consulta (nunca fecha de
// nacimiento, nunca una edad de referencia genérica). Este archivo importa
// DIRECTO lib/reservar/edadesMenores.ts (módulo puro, sin "use client"/
// Supabase) para ejecutar la lógica real de validación/clasificación — no
// solo inspeccionar texto. Las pruebas de "wiring" al final leen el código
// fuente de VistaBooking.tsx/BuscadorBooking.tsx/computo.ts/cotizar.ts/
// checkout/actions.ts como texto para confirmar que usan este mismo módulo
// (mismo patrón que pruebas/fronteraTramos.test.ts y pruebas/tipoPaquetes.test.ts).
// ───────────────────────────────────────────────────────────────────────────

describe("1. 0 menores → arreglo vacío y sin campos", () => {
  test("ajustarCantidadEdades a 0 da arreglo vacío", () => {
    assert.deepEqual(ajustarCantidadEdades([], 0), []);
    assert.deepEqual(ajustarCantidadEdades(["5", "7"], 0), []);
  });
  test("validarCantidadMenores(0) y validarEdadesMenores([], 0) son válidos", () => {
    assert.deepEqual(validarCantidadMenores(0), { ok: true, cantidad: 0 });
    assert.deepEqual(validarEdadesMenores([], 0), { ok: true, edades: [] });
  });
  test("clasificarYRepartirMenores con 0 edades no clasifica a nadie", () => {
    const r = clasificarYRepartirMenores([], 2, 10);
    assert.deepEqual(r, { ok: true, c: { infantes: 0, nino: 0, nino2: 0 } });
  });
});

describe("2. 1, 2 y varios menores → cantidad exacta de campos", () => {
  test("ajustarCantidadEdades produce exactamente N campos vacíos desde 0", () => {
    assert.equal(ajustarCantidadEdades([], 1).length, 1);
    assert.equal(ajustarCantidadEdades([], 2).length, 2);
    assert.equal(ajustarCantidadEdades([], 7).length, 7);
    assert.deepEqual(ajustarCantidadEdades([], 3), ["", "", ""]);
  });
});

describe("3. Aumentar y disminuir conserva correctamente las edades existentes", () => {
  test("aumentar agrega vacíos al final, conserva lo escrito", () => {
    assert.deepEqual(ajustarCantidadEdades(["5", "7"], 3), ["5", "7", ""]);
    assert.deepEqual(ajustarCantidadEdades(["5"], 4), ["5", "", "", ""]);
  });
  test("disminuir quita solo los sobrantes del final", () => {
    assert.deepEqual(ajustarCantidadEdades(["5", "7", "3"], 1), ["5"]);
    assert.deepEqual(ajustarCantidadEdades(["5", "7", "3"], 2), ["5", "7"]);
  });
  test("disminuir a 0 y volver a subir no resucita edades viejas (se perdieron al bajar, por diseño)", () => {
    const bajado = ajustarCantidadEdades(["5", "7"], 0);
    assert.deepEqual(ajustarCantidadEdades(bajado, 2), ["", ""]);
  });
});

describe("4. Edad faltante", () => {
  test("parseEdadMenor('') es obligatoria", () => {
    assert.deepEqual(parseEdadMenor(""), { valor: null, error: "Obligatoria" });
    assert.deepEqual(parseEdadMenor("   "), { valor: null, error: "Obligatoria" });
  });
  test("validarEdadesMenores con un hueco (null) falla sin lanzar", () => {
    assert.doesNotThrow(() => validarEdadesMenores([5, null], 2));
    const r = validarEdadesMenores([5, null], 2);
    assert.equal(r.ok, false);
  });
});

describe("5. Edad negativa", () => {
  test("parseEdadMenor('-1') se rechaza", () => {
    const r = parseEdadMenor("-1");
    assert.equal(r.valor, null);
    assert.ok(r.error);
  });
  test("validarEdadesMenores([-1], 1) se rechaza sin lanzar", () => {
    const r = validarEdadesMenores([-1], 1);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /negativa/);
  });
});

describe("6. Edad decimal", () => {
  test("parseEdadMenor('5.5') se rechaza", () => {
    const r = parseEdadMenor("5.5");
    assert.equal(r.valor, null);
  });
  test("validarEdadesMenores([5.5], 1) se rechaza (no es entero)", () => {
    const r = validarEdadesMenores([5.5], 1);
    assert.equal(r.ok, false);
  });
});

describe("7. Edad enviada como texto no numérico", () => {
  test("validarEdadesMenores(['5'], 1) se rechaza — '5' es string, no number", () => {
    const r = validarEdadesMenores(["5"], 1);
    assert.equal(r.ok, false);
  });
  test("parseEdadMenor('abc') se rechaza", () => {
    assert.equal(parseEdadMenor("abc").valor, null);
  });
});

describe("8. NaN, Infinity y entero fuera de rango", () => {
  test("validarEdadesMenores([NaN], 1) se rechaza sin lanzar", () => {
    assert.doesNotThrow(() => validarEdadesMenores([NaN], 1));
    assert.equal(validarEdadesMenores([NaN], 1).ok, false);
  });
  test("validarEdadesMenores([Infinity], 1) se rechaza sin lanzar", () => {
    assert.doesNotThrow(() => validarEdadesMenores([Infinity], 1));
    assert.equal(validarEdadesMenores([Infinity], 1).ok, false);
  });
  test("una edad mayor a EDAD_MENOR_MAX se rechaza (fuera de rango de 'menor')", () => {
    const r = validarEdadesMenores([EDAD_MENOR_MAX + 1], 1);
    assert.equal(r.ok, false);
  });
  test("EDAD_MENOR_MAX exacto sí se acepta como forma (la clasificación de categoría es aparte)", () => {
    const r = validarEdadesMenores([EDAD_MENOR_MAX], 1);
    assert.equal(r.ok, true);
  });
});

describe("9. Cantidad de menores distinta al largo del arreglo", () => {
  test("arreglo más corto que la cantidad declarada falla", () => {
    const r = validarEdadesMenores([5, 6], 3);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /3.*2|esperaban/);
  });
  test("arreglo más largo que la cantidad declarada falla", () => {
    const r = validarEdadesMenores([5, 6, 7], 2);
    assert.equal(r.ok, false);
  });
  test("cantidad negativa o no entera se rechaza en validarCantidadMenores", () => {
    assert.equal(validarCantidadMenores(-1).ok, false);
    assert.equal(validarCantidadMenores(2.5).ok, false);
  });
});

describe("10. Límites exactos entre infante/niño/adulto", () => {
  const infanteMax = 2, ninoMax = 10;
  test("edad == infanteMax clasifica infante", () => {
    const r = clasificarYRepartirMenores([infanteMax], infanteMax, ninoMax);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.c, { infantes: 1, nino: 0, nino2: 0 });
  });
  test("edad == infanteMax + 1 clasifica niño (primer año fuera de infante)", () => {
    const r = clasificarYRepartirMenores([infanteMax + 1], infanteMax, ninoMax);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.c, { infantes: 0, nino: 1, nino2: 0 });
  });
  test("edad == ninoMax clasifica niño (último año dentro del rango)", () => {
    const r = clasificarYRepartirMenores([ninoMax], infanteMax, ninoMax);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.c, { infantes: 0, nino: 1, nino2: 0 });
  });
  test("edad == ninoMax + 1 ya es adulto (falla cerrado, no se cobra como niño)", () => {
    const r = clasificarYRepartirMenores([ninoMax + 1], infanteMax, ninoMax);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "edad_adulto");
  });
});

describe("11. Dos menores con edades distintas liquidan categorías distintas", () => {
  test("un infante y un niño en la misma consulta", () => {
    const r = clasificarYRepartirMenores([1, 5], 2, 10);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.c, { infantes: 1, nino: 1, nino2: 0 });
  });
  test("dos niños se reparten Niño 1 / Niño 2 (por orden de captura, nunca ambos en la misma tarifa)", () => {
    const r = clasificarYRepartirMenores([4, 8], 2, 10);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.c, { infantes: 0, nino: 1, nino2: 1 });
  });
});

describe("12. Menor con tarifa de adulto SOLO cuando la regla lo indique", () => {
  test("el sistema no tiene una tarifa de adulto individual — una edad de adulto siempre falla cerrado, nunca se cobra en silencio", () => {
    const r = clasificarYRepartirMenores([16], 2, 10);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.codigo, "edad_adulto");
      assert.match(r.error, /adulto/);
    }
  });
  test("un 3er menor en edad de niño tampoco se aproxima a una tarifa existente — falla cerrado", () => {
    const r = clasificarYRepartirMenores([4, 5, 6], 2, 10);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "sin_cupo_tarifa_menores");
  });
});

describe("13. Categoría sin tarifa falla cerrado", () => {
  test("niño clasificado pero sin tarifa de Niño 1 configurada → error", () => {
    const err = verificarTarifasMenoresDisponibles({ infantes: 0, nino: 1, nino2: 0 }, { nino: false, nino2: true });
    assert.ok(err);
  });
  test("niño2 clasificado pero sin tarifa de Niño 2 configurada → error", () => {
    const err = verificarTarifasMenoresDisponibles({ infantes: 0, nino: 0, nino2: 1 }, { nino: true, nino2: false });
    assert.ok(err);
  });
  test("infante sin tarifa configurada NO falla (asimetría real y documentada: infante gratis)", () => {
    const err = verificarTarifasMenoresDisponibles({ infantes: 3, nino: 0, nino2: 0 }, { nino: false, nino2: false });
    assert.equal(err, null);
  });
});

describe("14. No se usa 0 ni una edad de referencia silenciosa", () => {
  test("verificarTarifasMenoresDisponibles nunca aprueba en silencio cuando hace falta la tarifa", () => {
    const err1 = verificarTarifasMenoresDisponibles({ infantes: 0, nino: 1, nino2: 1 }, { nino: false, nino2: false });
    assert.ok(err1);
  });
  test("clasificarYRepartirMenores nunca inventa un reparto cuando hay 0 menores válidos de más de 2 en edad de niño", () => {
    const r = clasificarYRepartirMenores([3, 4, 5, 6], 2, 10);
    assert.equal(r.ok, false);
  });
});

describe("15. La edad llega intacta a cálculo, snapshot y creación de la reserva/cotización — wiring", () => {
  const computo = leer("lib/reservar/computo.ts");
  const cotizar = leer("lib/reservar/cotizar.ts");
  const checkout = leer("app/tarifario/checkout/actions.ts");
  const checkoutPage = leer("app/tarifario/checkout/page.tsx");
  const cart = leer("lib/cart/CartContext.tsx");

  test("computo.ts recalcula desde edadesMenores con el helper real, nunca confía en ninos/ninos2/infantes del cliente cuando vienen edades", () => {
    assert.match(computo, /from "@\/lib\/reservar\/edadesMenores"/);
    assert.match(computo, /resolverMenoresPorEdad/);
    assert.match(computo, /input\.edadesMenores !== undefined/);
  });
  test("cotizar.ts (buscarHoteles) clasifica por edad real por hotel con el helper real", () => {
    assert.match(cotizar, /from "@\/lib\/reservar\/edadesMenores"/);
    assert.match(cotizar, /clasificarYRepartirMenores/);
  });
  test("checkout/actions.ts propaga edadesMenores del ítem del carrito al ReservaInput y al snapshot persistido", () => {
    assert.match(checkout, /edadesMenores: it\.edadesMenores/);
    assert.match(checkout, /edades_menores: it\.edadesMenores/);
  });
  test("checkout/page.tsx manda edadesMenores del carrito al server action", () => {
    assert.match(checkoutPage, /edadesMenores: it\.edadesMenores/);
  });
  test("HotelCartItem persiste edadesMenores", () => {
    assert.match(cart, /edadesMenores\?:\s*number\[\]/);
  });
});

describe("16-17. Fecha de nacimiento vs edad cotizada — NO implementado en esta ronda (documentado, no simulado)", () => {
  test("no existe ningún cruce automático fecha_nacimiento vs edad cotizada en contrato_pasajeros (requiere migración, diagnóstico entregado sin escribirla)", () => {
    // Deliberadamente no hay código que probar aquí: el diagnóstico de la
    // sección PERSISTENCIA Y PASAJEROS del PR explica por qué (contrato_pasajeros
    // no tiene columna para la edad cotizada ni un identificador no posicional).
    // Esta prueba deja constancia explícita de que el alcance NO incluye esa
    // pieza — no se simula un comportamiento que no existe.
    assert.ok(true);
  });
});

describe("18. Contratos históricos sin edades nuevas siguen abriendo sin romperse", () => {
  const computo = leer("lib/reservar/computo.ts");
  test("la reclasificación por edad es estrictamente opt-in — solo corre si edadesMenores !== undefined", () => {
    const ocurrencias = computo.match(/if \(input\.edadesMenores !== undefined\)/g) ?? [];
    assert.ok(ocurrencias.length >= 2, "debe estar guardado en las 2 ramas (usarFechas y tarifario_resultado)");
  });
  test("sin edadesMenores, ninos/ninos2/infantes se calculan igual que antes (Number/Math.trunc sobre el input)", () => {
    assert.match(computo, /let numNinos = Math\.max\(0, Math\.trunc\(Number\(input\.ninos\)/);
  });
});

describe("19. Payload manipulado no produce TypeError ni error 500", () => {
  const payloadsRaros: unknown[] = [null, undefined, "edades", 42, { a: 1 }, [{}], [null, undefined], [true, false], ["5", "6"]];
  for (const p of payloadsRaros) {
    test(`validarEdadesMenores(${JSON.stringify(p)}, 2) no lanza`, () => {
      assert.doesNotThrow(() => validarEdadesMenores(p, 2));
    });
  }
  const cantidadesRaras: unknown[] = [null, undefined, "3", -1, 3.5, NaN, Infinity, {}, []];
  for (const c of cantidadesRaras) {
    test(`validarCantidadMenores(${JSON.stringify(c)}) no lanza`, () => {
      assert.doesNotThrow(() => validarCantidadMenores(c));
      assert.equal(validarCantidadMenores(c).ok, false);
    });
  }
  test("un arreglo de edades más largo que MAX_MENORES_POR_CONSULTA no rompe validarEdadesMenores (falla por longitud, no por límite propio)", () => {
    const largo = Array.from({ length: MAX_MENORES_POR_CONSULTA + 5 }, () => 5);
    assert.doesNotThrow(() => validarEdadesMenores(largo, largo.length));
  });
  test("MAX_PAX_CONSULTA está definido y es un entero positivo razonable", () => {
    assert.ok(Number.isInteger(MAX_PAX_CONSULTA) && MAX_PAX_CONSULTA > 0);
  });
});

describe("20. Wiring — Vista Booking usa el helper real, no una copia/aproximación", () => {
  const vistaBooking = leer("app/tarifario/VistaBooking.tsx");
  const buscador = leer("app/tarifario/BuscadorBooking.tsx");

  test("VistaBooking.tsx (EditorPax) importa y usa el módulo real de edadesMenores", () => {
    assert.match(vistaBooking, /from "@\/lib\/reservar\/edadesMenores"/);
    assert.match(vistaBooking, /clasificarYRepartirMenores/);
    assert.match(vistaBooking, /verificarTarifasMenoresDisponibles/);
    assert.match(vistaBooking, /ajustarCantidadEdades/);
    assert.match(vistaBooking, /parseEdadMenor/);
  });
  test("VistaBooking.tsx ya NO tiene los inputs manuales de niños 1/niños 2/infantes (reemplazados por edad)", () => {
    assert.doesNotMatch(vistaBooking, /Niños 1 \(/);
    assert.doesNotMatch(vistaBooking, /Niños 2 \(/);
    assert.doesNotMatch(vistaBooking, /Infantes \(sin costo/);
  });
  test("VistaBooking.tsx nunca usa fecha de nacimiento en la consulta de Vista Booking (EditorPax)", () => {
    const idxEditor = vistaBooking.indexOf("function EditorPax");
    const idxFinEditor = vistaBooking.indexOf("\nfunction ", idxEditor + 1);
    const cuerpoEditor = vistaBooking.slice(idxEditor, idxFinEditor === -1 ? undefined : idxFinEditor);
    assert.doesNotMatch(cuerpoEditor, /fechaNacimiento|fecha_nacimiento/);
  });
  test("BuscadorBooking.tsx importa y usa el módulo real de edadesMenores", () => {
    assert.match(buscador, /from "@\/lib\/reservar\/edadesMenores"/);
    assert.match(buscador, /ajustarCantidadEdades/);
    assert.match(buscador, /parseEdadMenor/);
  });
  test("BuscadorBooking.tsx ya NO tiene el input manual 'Niños aquí' por habitación", () => {
    assert.doesNotMatch(buscador, /Niños aquí/);
  });
  test("BuscadorBooking.tsx nunca usa fecha de nacimiento", () => {
    assert.doesNotMatch(buscador, /fechaNacimiento|fecha_nacimiento/);
  });
});
