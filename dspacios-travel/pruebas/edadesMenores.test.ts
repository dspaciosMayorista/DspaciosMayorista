import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  EDAD_MENOR_MAX,
  MAX_MENORES_POR_CONSULTA,
  MAX_PAX_CONSULTA,
  MAX_HABITACIONES_CONSULTA,
  ajustarCantidadEdades,
  parseEdadMenor,
  validarCantidadMenores,
  validarEdadesMenores,
  clasificarMenoresPorEdad,
  verificarTarifasMenoresDisponibles,
  normalizarEdadesMenoresCarrito,
  validarHabitacionesConsultadas,
  validarAdultosDeclarados,
  validarFechaConsulta,
  validarRangoFechas,
  validarDestinoConsulta,
  validarSolicitudItem,
  validarTourInput,
  validarPaxTotalConsulta,
  validarPaxServicioConsulta,
  validarClienteInput,
  validarCrearSolicitudInput,
  resolverB2BParaMensaje,
  validarPctComisionB2B,
  resolverContextoB2B,
  MAX_PCT_COMISION_B2B,
  MAX_ITEMS_CARRITO,
  MAX_TOURS_CARRITO,
  MAX_LINEAS_CARRITO,
  MAX_LONGITUD_TEXTO,
  respuestaPublicaInsertCotizacion,
  formatearLogInsertCotizacion,
  MENSAJE_ERROR_COTIZACION,
  validarEntradaCotizarPorFechas,
  MAX_NOCHES_CONSULTA,
} from "../lib/reservar/edadesMenores.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

// ───────────────────────────────────────────────────────────────────────────
// Vista Booking — edad exacta de cada menor en la consulta (nunca fecha de
// nacimiento, nunca una edad de referencia genérica). Este archivo importa
// DIRECTO lib/reservar/edadesMenores.ts (módulo puro, sin "use client"/
// Supabase) para ejecutar la lógica real de validación/clasificación — no
// solo inspeccionar texto. El reparto Niño 1/Niño 2 POR HABITACIÓN vive en
// lib/reservar/distribucionHabitaciones.ts (pruebas propias en
// pruebas/distribucionHabitaciones.test.ts); este módulo solo clasifica la
// edad (infante/niño/edad-de-adulto) y valida la FORMA de lo que llega desde
// el navegador. Las pruebas de "wiring" al final leen el código fuente de
// VistaBooking.tsx/BuscadorBooking.tsx/computo.ts/cotizar.ts/
// checkout/actions.ts/checkout/page.tsx como texto para confirmar que usan
// este mismo módulo (mismo patrón que pruebas/fronteraTramos.test.ts).
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
  test("clasificarMenoresPorEdad con 0 edades no clasifica a nadie", () => {
    const r = clasificarMenoresPorEdad([], 2, 10);
    assert.deepEqual(r, { ok: true, c: { infantes: 0, ninos: 0 } });
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

describe("10. Límites exactos entre infante/niño/adulto (clasificación por edad, SIN repartir Niño 1/Niño 2 — eso es aparte)", () => {
  const infanteMax = 2, ninoMax = 10;
  test("edad == infanteMax clasifica infante", () => {
    const r = clasificarMenoresPorEdad([infanteMax], infanteMax, ninoMax);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.c, { infantes: 1, ninos: 0 });
  });
  test("edad == infanteMax + 1 clasifica niño (primer año fuera de infante)", () => {
    const r = clasificarMenoresPorEdad([infanteMax + 1], infanteMax, ninoMax);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.c, { infantes: 0, ninos: 1 });
  });
  test("edad == ninoMax clasifica niño (último año dentro del rango)", () => {
    const r = clasificarMenoresPorEdad([ninoMax], infanteMax, ninoMax);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.c, { infantes: 0, ninos: 1 });
  });
  test("edad == ninoMax + 1 ya es adulto (falla cerrado, no se cobra como niño)", () => {
    const r = clasificarMenoresPorEdad([ninoMax + 1], infanteMax, ninoMax);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.codigo, "edad_adulto");
  });
});

describe("11. Varios menores con edades distintas clasifican bien (el reparto Niño1/Niño2 es aparte, por habitación)", () => {
  test("un infante y un niño en la misma consulta", () => {
    const r = clasificarMenoresPorEdad([1, 5], 2, 10);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.c, { infantes: 1, ninos: 1 });
  });
  test("cuatro niños clasifican los 4 como 'niño' — la clasificación NUNCA limita a 2 (eso lo decide la habitación, no la edad)", () => {
    const r = clasificarMenoresPorEdad([3, 4, 5, 6], 2, 10);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.c, { infantes: 0, ninos: 4 });
  });
});

describe("12. Menor con edad de adulto siempre falla cerrado, nunca se cobra en silencio", () => {
  test("el sistema no tiene una tarifa de adulto individual — una edad de adulto siempre falla cerrado", () => {
    const r = clasificarMenoresPorEdad([16], 2, 10);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.codigo, "edad_adulto");
      assert.match(r.error, /adulto/);
    }
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
    assert.match(computo, /distribuirPorHabitaciones/);
  });
  test("cotizar.ts (buscarHoteles) recibe unknown, valida forma completa y distribuye por habitación con el helper real", () => {
    assert.match(cotizar, /from "@\/lib\/reservar\/edadesMenores"/);
    assert.match(cotizar, /clasificarMenoresPorEdad/);
    assert.match(cotizar, /distribuirPorHabitaciones/);
    assert.match(cotizar, /validarAdultosDeclarados/);
    assert.match(cotizar, /validarHabitacionesConsultadas/);
    assert.match(cotizar, /export async function buscarHoteles\(inputRaw: unknown\)/);
    assert.doesNotMatch(cotizar, /clasificarYRepartirMenores/);
  });
  test("cotizar.ts nunca devuelve 'sin resultados' a secas: arma un diagnóstico cuando todos los hoteles evaluados se descartan", () => {
    assert.match(cotizar, /diagnostico/);
  });
  test("checkout/actions.ts propaga edadesMenores del ítem validado al ReservaInput, y el snapshot/itemsOk usan SOLO las edades que comp.data realmente usó — nunca la referencia cruda del ítem, ni siquiera como fallback (ronda 4)", () => {
    assert.match(checkout, /edadesMenores: it\.edadesMenores/); // esto SÍ es correcto: es lo que se manda a computarReserva como entrada
    // El snapshot/itemsOk usan la variable clonada `edadesMenoresConfirmadas`
    // (copia de comp.data.edadesMenoresUsadas) — nunca `edadesMenoresUsadas`
    // directo (evita compartir referencia mutable) ni `?? it.edadesMenores`
    // (el fallback que existía antes de esta ronda).
    assert.match(checkout, /edades_menores: edadesMenoresConfirmadas/);
    assert.match(checkout, /edadesMenores: edadesMenoresConfirmadas/);
    assert.doesNotMatch(checkout, /edades_menores: it\.edadesMenores/);
    assert.doesNotMatch(checkout, /edadesMenoresUsadas \?\? it\.edadesMenores/);
    assert.doesNotMatch(checkout, /edades_menores: edadesMenoresUsadas[,\s]/); // nunca la referencia cruda de comp.data sin clonar
    // Si `comp.data.edadesMenoresUsadas` viene null/undefined, aborta la
    // cotización — nunca completa en silencio con el ítem crudo.
    assert.match(checkout, /if \(edadesMenoresUsadas == null\)/);
    assert.match(checkout, /const edadesMenoresConfirmadas = \[\.\.\.edadesMenoresUsadas\]/);
    assert.match(checkout, /validarSolicitudItem/);
    assert.match(checkout, /export async function crearSolicitudReserva\(inputRaw: unknown\)/);
  });
  test("checkout/actions.ts persiste la distribución por habitación en el snapshot (autoritativa, de comp.data)", () => {
    assert.match(checkout, /distribucion_menores: distribucionMenores/);
  });
  test("checkout/page.tsx normaliza carritos viejos y manda cantidadMenores derivado de edadesMenores", () => {
    assert.match(checkoutPage, /normalizarEdadesMenoresCarrito/);
    assert.match(checkoutPage, /cantidadMenores: edadesMenores\.length/);
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

  const payloadsAdultos: unknown[] = [null, undefined, "2", -1, 0, 1.5, NaN, Infinity, {}, [], "abc"];
  for (const p of payloadsAdultos) {
    test(`validarAdultosDeclarados(${JSON.stringify(p)}) no lanza y rechaza`, () => {
      assert.doesNotThrow(() => validarAdultosDeclarados(p));
      assert.equal(validarAdultosDeclarados(p).ok, false);
    });
  }
  test("validarAdultosDeclarados(1) y valores enteros ≥ 1 se aceptan", () => {
    assert.equal(validarAdultosDeclarados(1).ok, true);
    assert.equal(validarAdultosDeclarados(4).ok, true);
  });

  const payloadsHabitaciones: unknown[] = [null, undefined, "doble", 42, {}, [null], [42], [{ acom: "invalida" }], [{}], Array.from({ length: MAX_HABITACIONES_CONSULTA + 1 }, () => ({ acom: "doble" }))];
  for (const p of payloadsHabitaciones) {
    test(`validarHabitacionesConsultadas(${JSON.stringify(p)}) no lanza y rechaza`, () => {
      assert.doesNotThrow(() => validarHabitacionesConsultadas(p));
      assert.equal(validarHabitacionesConsultadas(p).ok, false);
    });
  }
  test("validarHabitacionesConsultadas con habitaciones válidas acepta y respeta el orden", () => {
    const r = validarHabitacionesConsultadas([{ acom: "doble" }, { acom: "sencilla" }]);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.habitaciones.map((h) => h.acom), ["doble", "sencilla"]);
  });

  const payloadsFecha: unknown[] = [null, undefined, 20260101, {}, [], "01/01/2026", ""];
  for (const p of payloadsFecha) {
    test(`validarFechaConsulta(${JSON.stringify(p)}) no lanza y rechaza forma inválida`, () => {
      assert.doesNotThrow(() => validarFechaConsulta(p));
      assert.equal(validarFechaConsulta(p).ok, false);
    });
  }
  test("validarFechaConsulta acepta AAAA-MM-DD real", () => {
    assert.equal(validarFechaConsulta("2026-01-05").ok, true);
  });
  // Fechas imposibles: la FORMA (regex) es correcta pero el día no existe en
  // el calendario real — validarFechaConsulta debe rechazarlas (no solo la
  // forma), preservando la cadena exacta cuando SÍ es válida.
  const fechasImposibles = ["2026-13-40", "2026-13-01", "2026-01-00", "2026-02-31", "2026-04-31", "2026-02-30"];
  for (const f of fechasImposibles) {
    test(`validarFechaConsulta("${f}") se rechaza — no es un día real del calendario`, () => {
      const r = validarFechaConsulta(f);
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.error, /no es un día real del calendario/);
    });
  }
  test("años bisiestos: 2024-02-29 es válido (2024 SÍ es bisiesto)", () => {
    assert.equal(validarFechaConsulta("2024-02-29").ok, true);
  });
  test("años no bisiestos: 2026-02-29 se rechaza (2026 NO es bisiesto)", () => {
    assert.equal(validarFechaConsulta("2026-02-29").ok, false);
  });
  test("2000-02-29 es válido (bisiesto — divisible por 400)", () => {
    assert.equal(validarFechaConsulta("2000-02-29").ok, true);
  });
  test("1900-02-29 se rechaza (NO bisiesto — divisible por 100 pero no por 400)", () => {
    assert.equal(validarFechaConsulta("1900-02-29").ok, false);
  });
  test("la cadena original se conserva intacta cuando la fecha es válida", () => {
    const r = validarFechaConsulta("2026-03-07");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.fecha, "2026-03-07");
  });

  describe("validarRangoFechas: regreso estrictamente posterior a la ida", () => {
    test("regreso posterior a la ida pasa", () => {
      assert.equal(validarRangoFechas("2026-01-01", "2026-01-05").ok, true);
    });
    test("regreso igual a la ida se rechaza", () => {
      const r = validarRangoFechas("2026-01-05", "2026-01-05");
      assert.equal(r.ok, false);
    });
    test("regreso anterior a la ida se rechaza", () => {
      const r = validarRangoFechas("2026-01-05", "2026-01-01");
      assert.equal(r.ok, false);
    });
  });

  const payloadsDestino: unknown[] = [42, {}, [], true];
  for (const p of payloadsDestino) {
    test(`validarDestinoConsulta(${JSON.stringify(p)}) no lanza y rechaza forma inválida`, () => {
      assert.doesNotThrow(() => validarDestinoConsulta(p));
      assert.equal(validarDestinoConsulta(p).ok, false);
    });
  }
  test("validarDestinoConsulta acepta ausente/null como vacío", () => {
    assert.deepEqual(validarDestinoConsulta(undefined), { ok: true, destino: "" });
    assert.deepEqual(validarDestinoConsulta(null), { ok: true, destino: "" });
  });

  const payloadsSolicitudItem: unknown[] = [null, undefined, "item", 42, [], {}, { modulo: "otro" }, { modulo: "bloqueo", paqueteId: "1" }];
  for (const p of payloadsSolicitudItem) {
    test(`validarSolicitudItem(${JSON.stringify(p)}, 0) no lanza y rechaza forma inválida`, () => {
      assert.doesNotThrow(() => validarSolicitudItem(p, 0));
      assert.equal(validarSolicitudItem(p, 0).ok, false);
    });
  }
});

describe("20. Wiring — Vista Booking usa el helper real, no una copia/aproximación", () => {
  const vistaBooking = leer("app/tarifario/VistaBooking.tsx");
  const buscador = leer("app/tarifario/BuscadorBooking.tsx");

  test("VistaBooking.tsx (EditorPax) importa y usa el módulo real de edadesMenores/distribución por habitación", () => {
    assert.match(vistaBooking, /from "@\/lib\/reservar\/edadesMenores"/);
    assert.match(vistaBooking, /clasificarMenoresPorEdad/);
    assert.match(vistaBooking, /from "@\/lib\/reservar\/distribucionHabitaciones"/);
    assert.match(vistaBooking, /distribuirPorHabitaciones/);
    assert.match(vistaBooking, /verificarTarifasMenoresDisponibles/);
    assert.match(vistaBooking, /ajustarCantidadEdades/);
    assert.match(vistaBooking, /parseEdadMenor/);
    assert.doesNotMatch(vistaBooking, /clasificarYRepartirMenores/);
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

describe("21. Wiring — snapshot usa edades y distribución validadas por el servidor", () => {
  const checkout = leer("app/tarifario/checkout/actions.ts");
  test("hotelesSnap toma la distribución de comp.data (servidor), no del ítem crudo del cliente", () => {
    assert.match(checkout, /distribucionMenores, edadesMenoresUsadas \} = comp\.data/);
    assert.match(checkout, /distribucion_menores: distribucionMenores/);
  });
  test("hotelesSnap toma la clasificación agregada (numNinos\\/numNinos2\\/numInfantes) de comp.data", () => {
    assert.match(checkout, /menores_clasificados: \{ infantes: numInfantes, nino: numNinos, nino2: numNinos2 \}/);
  });
});

describe("22. Control negativo del límite global incorrecto de la 1a ronda", () => {
  test("clasificarMenoresPorEdad ya no existe con el nombre/comportamiento anterior (clasificarYRepartirMenores) en ningún archivo del módulo", () => {
    const modulo = leer("lib/reservar/edadesMenores.ts");
    assert.doesNotMatch(modulo, /clasificarYRepartirMenores/);
  });
  test("4 niños clasifican los 4 (la edad nunca limita a 2 — ese límite ya no existe a nivel de clasificación)", () => {
    const r = clasificarMenoresPorEdad([3, 4, 5, 6], 2, 10);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.c.ninos, 4);
  });
  test("normalizarEdadesMenoresCarrito: sin menores se normaliza a [] de forma segura (carrito histórico sin menores)", () => {
    assert.deepEqual(normalizarEdadesMenoresCarrito({ ninos: 0, ninos2: 0, infantes: 0 }), { ok: true, edadesMenores: [] });
  });
  test("normalizarEdadesMenoresCarrito: con menores pero sin edades se bloquea con mensaje controlado (nunca infiere edades)", () => {
    const r = normalizarEdadesMenoresCarrito({ ninos: 1, ninos2: 0, infantes: 0 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /edad/i);
  });
  test("normalizarEdadesMenoresCarrito: si ya trae edadesMenores (aunque sea []), se respeta tal cual", () => {
    assert.deepEqual(normalizarEdadesMenoresCarrito({ edadesMenores: [], ninos: 2, ninos2: 0, infantes: 0 }), { ok: true, edadesMenores: [] });
    assert.deepEqual(normalizarEdadesMenoresCarrito({ edadesMenores: [5], ninos: 1, ninos2: 0, infantes: 0 }), { ok: true, edadesMenores: [5] });
  });
});

describe("23. Acción pública sin edadesMenores se rechaza aunque mande ninos/ninos2 (nunca cae al reparto legado)", () => {
  const base = {
    modulo: "porcion_terrestre", paqueteId: 1, hotelId: 2, bloqueoId: null,
    hotelNombre: "Hotel de prueba", destino: "San Andrés", categoria: "Estándar", regimen: "PC",
    fechaIda: "2026-01-01", fechaRegreso: "2026-01-04", noches: 3,
    habitaciones: { doble: 1 }, cantidadMenores: 0, edadesMenores: [],
  };
  test("ítem válido completo con edadesMenores presente se acepta", () => {
    const r = validarSolicitudItem(base, 0);
    assert.equal(r.ok, true);
  });
  test("mismo ítem SIN la clave edadesMenores se rechaza, aunque traiga ninos/ninos2/infantes/pax/precio del carrito legado", () => {
    const sinEdades = Object.fromEntries(Object.entries(base).filter(([k]) => k !== "edadesMenores"));
    const conCamposLegados = { ...sinEdades, ninos: 2, ninos2: 1, infantes: 0, pax: 5, precio: 900000 };
    const r = validarSolicitudItem(conCamposLegados, 0);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /edad de sus menores/);
  });
  test("validarSolicitudItem nunca lee ninos/ninos2/infantes/pax/precio del objeto (no forman parte del ítem validado)", () => {
    const r = validarSolicitudItem(base, 0);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.ok(!("ninos" in r.item));
      assert.ok(!("ninos2" in r.item));
      assert.ok(!("infantes" in r.item));
      assert.ok(!("pax" in r.item));
      assert.ok(!("precio" in r.item));
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// RONDA 3 — corrección de hallazgos de revisión (ejecución real, no solo
// wiring): tours con precio/pax controlados por el navegador, comisión B2B
// manipulada por un anónimo, límite de pax mal calculado, payloads masivos
// sin tope previo, fechas imposibles. Los validadores puros que antes vivían
// dentro de `app/tarifario/checkout/actions.ts` (archivo "use server", que
// en Next.js solo puede exportar funciones async) se movieron a este módulo
// para poder ejecutarlos de verdad aquí — mismo criterio que ya se usó con
// `validarSolicitudItem` en la ronda anterior.
// ───────────────────────────────────────────────────────────────────────────

describe("24. Tour manipulado — validarTourInput nunca lee nombre/precio/moneda/destino del navegador", () => {
  const tourValido = { servicioId: 7, paqueteId: 3, fechaIda: "2026-06-01", fechaRegreso: "2026-06-05", pax: 2 };

  test("tour válido se acepta y el resultado solo trae servicioId/paqueteId/fechaIda/fechaRegreso/pax", () => {
    const r = validarTourInput(tourValido, 0);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(Object.keys(r.tour).sort(), ["fechaIda", "fechaRegreso", "pax", "paqueteId", "servicioId"].sort());
      assert.equal(r.tour.servicioId, 7);
      assert.equal(r.tour.paqueteId, 3);
    }
  });
  test("un tour manipulado con precio/nombre/moneda falsos NO afecta el resultado — esos campos ni se leen", () => {
    const manipulado = { ...tourValido, nombre: "Tour gratis (hackeado)", precio: 0, moneda: "COP", destino: "Inventado" };
    const r = validarTourInput(manipulado, 0);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.ok(!("nombre" in r.tour));
      assert.ok(!("precio" in r.tour));
      assert.ok(!("moneda" in r.tour));
      assert.ok(!("destino" in r.tour));
    }
  });
  test("carrito histórico de tour SIN servicioId se bloquea con mensaje claro (nunca se sigue con el nombre/precio del navegador)", () => {
    const sinServicioId = Object.fromEntries(Object.entries(tourValido).filter(([k]) => k !== "servicioId"));
    const r = validarTourInput(sinServicioId, 0);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /se agregó antes de poder re-liquidarlo/);
  });
  test("servicioId null (histórico) también se bloquea", () => {
    const r = validarTourInput({ ...tourValido, servicioId: null }, 0);
    assert.equal(r.ok, false);
  });
  test("servicioId/paqueteId no numéricos se rechazan sin lanzar", () => {
    assert.doesNotThrow(() => validarTourInput({ ...tourValido, servicioId: "7" }, 0));
    assert.equal(validarTourInput({ ...tourValido, servicioId: "7" }, 0).ok, false);
    assert.equal(validarTourInput({ ...tourValido, paqueteId: "3" }, 0).ok, false);
  });
  test("fecha de ida/regreso imposible se rechaza (usa la misma validación real de calendario)", () => {
    const r = validarTourInput({ ...tourValido, fechaIda: "2026-02-30" }, 0);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /no es un día real del calendario/);
  });
  test("regreso igual o anterior a la ida se rechaza", () => {
    assert.equal(validarTourInput({ ...tourValido, fechaRegreso: tourValido.fechaIda }, 0).ok, false);
    assert.equal(validarTourInput({ ...tourValido, fechaIda: "2026-06-05", fechaRegreso: "2026-06-01" }, 0).ok, false);
  });
  test("pax inválido (0, negativo, decimal, > MAX_PAX_CONSULTA) se rechaza", () => {
    assert.equal(validarTourInput({ ...tourValido, pax: 0 }, 0).ok, false);
    assert.equal(validarTourInput({ ...tourValido, pax: -1 }, 0).ok, false);
    assert.equal(validarTourInput({ ...tourValido, pax: 1.5 }, 0).ok, false);
    assert.equal(validarTourInput({ ...tourValido, pax: MAX_PAX_CONSULTA + 1 }, 0).ok, false);
  });
  const payloadsRarosTour: unknown[] = [null, undefined, "tour", 42, [], {}, { servicioId: 1 }];
  for (const p of payloadsRarosTour) {
    test(`validarTourInput(${JSON.stringify(p)}, 0) no lanza y rechaza`, () => {
      assert.doesNotThrow(() => validarTourInput(p, 0));
      assert.equal(validarTourInput(p, 0).ok, false);
    });
  }
});

describe("25. Recálculo server-side — el precio nunca sale de lo que mandó el navegador (wiring, DB no disponible en este entorno)", () => {
  const cotizar = leer("lib/reservar/cotizar.ts");
  const liquidacion = leer("lib/reservar/liquidacionServicio.ts");
  const checkout = leer("app/tarifario/checkout/actions.ts");
  test("cotizar.ts NO define su propia copia de la fórmula — importa calcularResultadoServicio/resolverLiquidacionServicioPuntual desde el módulo puro compartido", () => {
    assert.match(cotizar, /export async function liquidarServicioPuntual/);
    assert.doesNotMatch(cotizar, /function calcularResultadoServicio/); // ya no se DEFINE acá
    assert.match(cotizar, /from "@\/lib\/reservar\/liquidacionServicio"/);
    assert.match(cotizar, /calcularResultadoServicio,/);
    assert.match(cotizar, /resolverLiquidacionServicioPuntual,/);
  });
  test("liquidacionServicio.ts: buscarReceptivos (calcularResultadoServicio) y la re-liquidación puntual (resolverLiquidacionServicioPuntual) llaman a la MISMA fórmula base (calcularPrecioConModoYMarkup), nunca duplicada", () => {
    assert.match(liquidacion, /export function calcularPrecioConModoYMarkup/);
    const usos = liquidacion.match(/calcularPrecioConModoYMarkup\(/g) ?? [];
    assert.ok(usos.length >= 3, "calcularPrecioConModoYMarkup debe usarse en su definición + calcularResultadoServicio + resolverLiquidacionServicioPuntual");
  });
  test("checkout/actions.ts re-liquida cada tour con liquidarServicioPuntual y usa SOLO resultado.resultado.* dentro del bucle de tours, nunca t.precio/t.nombre/t.moneda", () => {
    const idxInicio = checkout.indexOf("for (const t of input.tours)");
    const idxFin = checkout.indexOf("\n  }\n", idxInicio);
    const bucle = checkout.slice(idxInicio, idxFin);
    assert.match(bucle, /liquidarServicioPuntual\(t\)/);
    assert.match(bucle, /resultado\.resultado\.total/);
    assert.match(bucle, /resultado\.resultado\.nombre/);
    // `t` (el ítem validado por `validarTourInput`) solo tiene servicioId/
    // paqueteId/fechaIda/fechaRegreso/pax — no HAY t.precio/t.nombre/t.moneda
    // que leer, así que esta prueba confirma que el bucle nunca los inventa.
    assert.doesNotMatch(bucle, /t\.precio/);
    assert.doesNotMatch(bucle, /t\.nombre/);
    assert.doesNotMatch(bucle, /t\.moneda/);
  });
  test("solo 'no_disponible' excluye el tour del carrito — 'error_consulta'/'configuracion_invalida' abortan la cotización COMPLETA (ronda 4)", () => {
    const idxInicio = checkout.indexOf("for (const t of input.tours)");
    const idxFin = checkout.indexOf("\n  }\n", idxInicio);
    const bucle = checkout.slice(idxInicio, idxFin);
    assert.match(bucle, /if \(!resultado\.ok\)/);
    assert.match(bucle, /if \(resultado\.tipo === "no_disponible"\)/);
    assert.match(bucle, /excluidos\.push/);
    // El abort completo (return ok:false) debe estar en la MISMA rama, fuera
    // del if de no_disponible — nunca dentro de un `continue` silencioso.
    const idxNoDisp = bucle.indexOf('if (resultado.tipo === "no_disponible")');
    const idxReturn = bucle.indexOf("return { ok: false", idxNoDisp);
    const bloqueNoDisp = bucle.slice(idxNoDisp, idxReturn);
    assert.match(bloqueNoDisp, /continue/);
  });
});

describe("36. Ronda 6: Wiring — checkout/actions.ts nunca reenvía el detalle técnico interno de liquidarServicioPuntual", () => {
  const checkout = leer("app/tarifario/checkout/actions.ts");
  const cotizar = leer("lib/reservar/cotizar.ts");
  const liquidacion = leer("lib/reservar/liquidacionServicio.ts");

  test("liquidarServicioPuntual (cotizar.ts) devuelve RespuestaPublicaServicioPuntual, no el ResultadoServicioPuntual interno con detalleInterno", () => {
    const idx = cotizar.indexOf("export async function liquidarServicioPuntual");
    const cuerpo = cotizar.slice(idx, cotizar.indexOf("\nexport", idx + 10));
    assert.match(cuerpo, /Promise<RespuestaPublicaServicioPuntual>/);
    assert.match(cuerpo, /return respuestaPublicaServicioPuntual\(resultado\)/);
    // El log del detalle técnico ocurre ACÁ, server-side, antes de traducir.
    assert.match(cuerpo, /console\.error\(formatearLogLiquidacionServicioPuntual/);
  });
  test("el bucle de tours en checkout/actions.ts solo lee resultado.tipo/resultado.mensaje — nunca .error/.detalleInterno/.mensajePublico", () => {
    const idxInicio = checkout.indexOf("for (const t of input.tours)");
    const idxFin = checkout.indexOf("\n  }\n", idxInicio);
    const bucle = checkout.slice(idxInicio, idxFin);
    assert.match(bucle, /resultado\.mensaje/);
    assert.doesNotMatch(bucle, /resultado\.error\b/);
    assert.doesNotMatch(bucle, /resultado\.detalleInterno/);
    assert.doesNotMatch(bucle, /resultado\.mensajePublico/);
  });
  test("checkout/actions.ts nunca importa/usa ResultadoServicioPuntual (el tipo interno con detalleInterno) — solo el tipo público", () => {
    assert.doesNotMatch(checkout, /ResultadoServicioPuntual/);
  });
  test("liquidacionServicio.ts: la frontera pública (respuestaPublicaServicioPuntual) es la ÚNICA función que construye el objeto sin detalleInterno — se define una sola vez", () => {
    const usos = liquidacion.match(/export function respuestaPublicaServicioPuntual/g) ?? [];
    assert.equal(usos.length, 1);
  });
  test("liquidacionServicio.ts: los mensajes públicos fijos nunca se construyen por interpolación de template literal (serían potencialmente inseguros) — son constantes de texto plano", () => {
    assert.match(liquidacion, /const MENSAJE_ERROR_CONSULTA = "No pudimos validar el servicio en este momento\. Intenta nuevamente\."/);
    assert.match(liquidacion, /const MENSAJE_CONFIGURACION_INVALIDA = "Este servicio requiere una revisión interna antes de poder cotizarse\."/);
  });
});

describe("26. Payloads masivos — los topes de arreglo se revisan ANTES de iterar", () => {
  const clienteValido = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3001234567", email: "a@b.com" };
  test("MAX_ITEMS_CARRITO/MAX_TOURS_CARRITO/MAX_LINEAS_CARRITO están definidos y son enteros positivos", () => {
    for (const n of [MAX_ITEMS_CARRITO, MAX_TOURS_CARRITO, MAX_LINEAS_CARRITO]) {
      assert.ok(Number.isInteger(n) && n > 0);
    }
  });
  test(`un carrito con ${MAX_ITEMS_CARRITO + 1} hoteles se rechaza por tamaño, sin llegar a validar cada ítem (bastan objetos vacíos)`, () => {
    const items = Array.from({ length: MAX_ITEMS_CARRITO + 1 }, () => ({}));
    const r = validarCrearSolicitudInput({ items, tours: [], cliente: clienteValido });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, new RegExp(`más de ${MAX_ITEMS_CARRITO} hoteles`));
  });
  test(`un carrito con ${MAX_TOURS_CARRITO + 1} tours se rechaza por tamaño`, () => {
    const tours = Array.from({ length: MAX_TOURS_CARRITO + 1 }, () => ({}));
    const r = validarCrearSolicitudInput({ items: [], tours, cliente: clienteValido });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, new RegExp(`más de ${MAX_TOURS_CARRITO} servicios`));
  });
  test("items + tours combinados por encima de MAX_LINEAS_CARRITO (pero cada uno bajo su propio máximo) se rechaza", () => {
    const mitad = Math.ceil(MAX_LINEAS_CARRITO / 2) + 1;
    assert.ok(mitad <= MAX_ITEMS_CARRITO && mitad <= MAX_TOURS_CARRITO, "el caso de prueba asume que la mitad+1 cabe en los topes individuales");
    const items = Array.from({ length: mitad }, () => ({}));
    const tours = Array.from({ length: mitad }, () => ({}));
    const r = validarCrearSolicitudInput({ items, tours, cliente: clienteValido });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, new RegExp(`más de ${MAX_LINEAS_CARRITO} líneas`));
  });
  test("un carrito dentro de los topes pero vacío de items/tours válidos sigue validando cada ítem normalmente", () => {
    const r = validarCrearSolicitudInput({ items: [{}], tours: [], cliente: clienteValido });
    assert.equal(r.ok, false); // el ítem vacío falla su propia validación de forma, no el tope
  });
  const payloadsRarosSolicitud: unknown[] = [null, undefined, "x", 42, [], { items: "no es arreglo" }, { items: [] }];
  for (const p of payloadsRarosSolicitud) {
    test(`validarCrearSolicitudInput(${JSON.stringify(p)}) no lanza`, () => {
      assert.doesNotThrow(() => validarCrearSolicitudInput(p));
    });
  }

  describe("validarClienteInput / longitudes de texto acotadas", () => {
    test("cliente válido se acepta", () => {
      assert.equal(validarClienteInput(clienteValido).ok, true);
    });
    test(`un campo de más de ${MAX_LONGITUD_TEXTO} caracteres se rechaza`, () => {
      const r = validarClienteInput({ ...clienteValido, nombres: "A".repeat(MAX_LONGITUD_TEXTO + 1) });
      assert.equal(r.ok, false);
    });
    test("email vacío se permite (único campo opcional en forma); nombres vacío no", () => {
      assert.equal(validarClienteInput({ ...clienteValido, email: "" }).ok, true);
      assert.equal(validarClienteInput({ ...clienteValido, nombres: "" }).ok, false);
    });
    const payloadsRarosCliente: unknown[] = [null, undefined, "x", 42, [], {}];
    for (const p of payloadsRarosCliente) {
      test(`validarClienteInput(${JSON.stringify(p)}) no lanza`, () => {
        assert.doesNotThrow(() => validarClienteInput(p));
        assert.equal(validarClienteInput(p).ok, false);
      });
    }
  });
});

describe("27. Límite total de personas — adultos + menores, no habitaciones (defecto real corregido)", () => {
  test("adultos + menores dentro del máximo pasa", () => {
    assert.equal(validarPaxTotalConsulta(10, 5).ok, true);
  });
  test("adultos + menores exactamente en el máximo pasa", () => {
    assert.equal(validarPaxTotalConsulta(MAX_PAX_CONSULTA, 0).ok, true);
    assert.equal(validarPaxTotalConsulta(MAX_PAX_CONSULTA - 3, 3).ok, true);
  });
  test(`no se pueden combinar ${MAX_PAX_CONSULTA} adultos con NINGÚN menor adicional`, () => {
    const r = validarPaxTotalConsulta(MAX_PAX_CONSULTA, 1);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, new RegExp(`más de ${MAX_PAX_CONSULTA} pax`));
  });
  test("un total de adultos+menores uno por encima del máximo se rechaza", () => {
    assert.equal(validarPaxTotalConsulta(MAX_PAX_CONSULTA + 1, 0).ok, false);
    assert.equal(validarPaxTotalConsulta(0, MAX_PAX_CONSULTA + 1).ok, false);
  });
  test("control negativo del bug anterior: muchas HABITACIONES con pocos adultos+menores ya no importan — el cálculo es por personas, no por habitaciones", () => {
    // Antes: `habitaciones.length + edades.length`. Con 8 habitaciones (el
    // máximo permitido) pero solo 2 adultos + 1 menor, el cálculo viejo daría
    // 8+1=9 (irrelevante para el límite); el correcto es 2+1=3 — el número de
    // habitaciones nunca debe entrar en esta cuenta.
    assert.equal(validarPaxTotalConsulta(2, 1).ok, true);
  });
});

describe("28. Comisión B2B manipulada y usuario anónimo — resolverB2BParaMensaje", () => {
  const agenciaReal = { nombre: "Agencia Real S.A.S.", nit: "900123456", email: "real@agencia.com", telefono: "3009999999" };
  test("usuario anónimo (esB2B=false) nunca genera bloque B2B, sin importar qué modo pida", () => {
    const ctx = { esB2B: false, agencia: null, pctComision: 0 };
    assert.equal(resolverB2BParaMensaje(ctx, "neta"), undefined);
    assert.equal(resolverB2BParaMensaje(ctx, "comisionable"), undefined);
    assert.equal(resolverB2BParaMensaje(ctx, undefined), undefined);
  });
  test("esB2B=true pero sin agencia registrada (dato inconsistente) tampoco genera bloque B2B — falla cerrado", () => {
    const ctx = { esB2B: true, agencia: null, pctComision: 0.2 };
    assert.equal(resolverB2BParaMensaje(ctx, "neta"), undefined);
  });
  test("B2B real: la facturación y la comisión SIEMPRE son las de la sesión, nunca un valor que 'llegue' de otro lado", () => {
    const ctx = { esB2B: true, agencia: agenciaReal, pctComision: 0.12 };
    const r = resolverB2BParaMensaje(ctx, "neta");
    assert.deepEqual(r, { modo: "neta", facturacion: agenciaReal, pctComision: 0.12 });
  });
  test("pctComision=1 (100%, el borde exacto del rango permitido) SÍ se refleja — 1 es válido, no mayor a MAX_PCT_COMISION_B2B", () => {
    const ctx = { esB2B: true, agencia: agenciaReal, pctComision: 1 };
    const r = resolverB2BParaMensaje(ctx, "comisionable");
    assert.equal(r?.pctComision, 1);
  });
  test("modo no solicitado (undefined) usa 'comisionable' por defecto, nunca 'neta' en silencio", () => {
    const ctx = { esB2B: true, agencia: agenciaReal, pctComision: 0.1 };
    const r = resolverB2BParaMensaje(ctx, undefined);
    assert.equal(r?.modo, "comisionable");
  });
  test("la facturación devuelta es SIEMPRE la misma referencia/valor de ctxSesion.agencia — nunca se mezcla con datos externos", () => {
    const ctx = { esB2B: true, agencia: agenciaReal, pctComision: 0.1 };
    const r = resolverB2BParaMensaje(ctx, "neta");
    assert.deepEqual(r?.facturacion, agenciaReal);
  });
});

describe("29. Wiring — crearSolicitudReserva resuelve B2B desde la sesión, nunca desde el input del navegador", () => {
  const checkout = leer("app/tarifario/checkout/actions.ts");
  test("crearSolicitudReserva llama getContextoB2B() y resolverB2BParaMensaje(ctxB2B, input.modo) — nunca lee input.facturacion/input.pctComision", () => {
    assert.match(checkout, /const ctxB2B = await getContextoB2B\(\)/);
    assert.match(checkout, /resolverB2BParaMensaje\(ctxB2B, input\.modo\)/);
    assert.doesNotMatch(checkout, /input\.facturacion/);
    assert.doesNotMatch(checkout, /input\.pctComision/);
  });
  test("CrearSolicitudInputValidado (edadesMenores.ts) ya no tiene campos facturacion/pctComision en su forma", () => {
    const modulo = leer("lib/reservar/edadesMenores.ts");
    const idx = modulo.indexOf("export type CrearSolicitudInputValidado");
    const cuerpo = modulo.slice(idx, modulo.indexOf("}", idx));
    assert.doesNotMatch(cuerpo, /facturacion/);
    assert.doesNotMatch(cuerpo, /pctComision/);
  });
});

describe("30. Wiring — checkout/page.tsx bloquea tours históricos sin servicioId antes de enviar", () => {
  const checkoutPage = leer("app/tarifario/checkout/page.tsx");
  test("checkout/page.tsx valida it.servicioId antes de armar el payload de tours", () => {
    assert.match(checkoutPage, /it\.servicioId == null/);
  });
  test("checkout/page.tsx manda servicioId/paqueteId/fechaIda/fechaRegreso/pax al servidor, no nombre/precio/moneda", () => {
    const idx = checkoutPage.indexOf("tours: tourItems.map");
    const cuerpo = checkoutPage.slice(idx, idx + 300);
    assert.match(cuerpo, /servicioId: it\.servicioId/);
    assert.match(cuerpo, /paqueteId: it\.paqueteId/);
    assert.doesNotMatch(cuerpo, /precio: it\.precio/);
    assert.doesNotMatch(cuerpo, /nombre: it\.nombre/);
  });
  test("la sección 'Facturar a' quedó de solo lectura (disabled) — ya no se envía facturación editada por el cliente", () => {
    const idx = checkoutPage.indexOf("Facturar a (agencia)");
    const cuerpo = checkoutPage.slice(idx, idx + 600);
    assert.match(cuerpo, /disabled readOnly/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ronda 4 — "USUARIO B2B INACTIVO". `getContextoB2B` (checkout/actions.ts) no
// validaba `usuarios.activo` ni del usuario logueado ni de la agencia
// titular, ni el rol de la agencia titular, ni el rango de `pctComision`.
// `resolverContextoB2B` (edadesMenores.ts) es la decisión PURA extraída de
// ese flujo — recibe las filas YA CONSULTADAS y decide, nunca consulta — así
// que estas pruebas ejecutan la lógica real de la ronda 4, no solo texto.
// ───────────────────────────────────────────────────────────────────────────
describe("31. validarPctComisionB2B — rango comercial permitido", () => {
  test("NaN, Infinity, string, null, undefined → inválido", () => {
    assert.equal(validarPctComisionB2B(NaN), null);
    assert.equal(validarPctComisionB2B(Infinity), null);
    assert.equal(validarPctComisionB2B(-Infinity), null);
    assert.equal(validarPctComisionB2B("0.12"), null);
    assert.equal(validarPctComisionB2B(null), null);
    assert.equal(validarPctComisionB2B(undefined), null);
  });
  test("negativo → inválido", () => {
    assert.equal(validarPctComisionB2B(-0.01), null);
    assert.equal(validarPctComisionB2B(-1), null);
  });
  test(`mayor a MAX_PCT_COMISION_B2B (${MAX_PCT_COMISION_B2B}) → inválido`, () => {
    assert.equal(validarPctComisionB2B(1.01), null);
    assert.equal(validarPctComisionB2B(1.5), null);
    assert.equal(validarPctComisionB2B(100), null); // típico error: mandar 100 en vez de 1 (100%)
  });
  test("0, 0.12 y el borde exacto (1) son válidos", () => {
    assert.equal(validarPctComisionB2B(0), 0);
    assert.equal(validarPctComisionB2B(0.12), 0.12);
    assert.equal(validarPctComisionB2B(MAX_PCT_COMISION_B2B), MAX_PCT_COMISION_B2B);
  });
});

describe("32. resolverContextoB2B — falla cerrado en cada paso (ronda 4)", () => {
  const agenciaOk = { nombre: "Agencia Titular S.A.S.", email: "titular@agencia.com", rol: "agencia", pct_comision: 0.12, activo: true };
  const solOk = { nombre: "Agencia Titular S.A.S.", nit: "900123456", email: "titular@agencia.com", telefono: "3001234567" };
  function inputBase(overrides: Partial<Parameters<typeof resolverContextoB2B>[0]> = {}) {
    return {
      usuarioAutenticado: true,
      perfil: agenciaOk, perfilError: false,
      agenciaId: null,
      agenciaTitular: null, agenciaTitularError: false,
      solicitud: solOk, solicitudError: false,
      pctComisionDefault: 0.12,
      ...overrides,
    };
  }

  test("camino feliz: agencia titular activa, rol válido, comisión en rango → esB2B true", () => {
    const r = resolverContextoB2B(inputBase());
    assert.equal(r.esB2B, true);
    if (r.esB2B) { assert.equal(r.tipo, "agencia"); assert.equal(r.pctComision, 0.12); }
  });

  test("usuario anónimo (no autenticado) → sin B2B, sin importar qué más se mande", () => {
    const r = resolverContextoB2B(inputBase({ usuarioAutenticado: false }));
    assert.deepEqual(r, { esB2B: false });
  });

  test("anónimo 'enviando modo=neta' no tiene efecto acá — resolverContextoB2B ni siquiera recibe `modo` (esa decisión es de resolverB2BParaMensaje, que ya solo actúa si esB2B=true)", () => {
    // Documenta la frontera: `resolverContextoB2B` no tiene ningún parámetro
    // de "modo solicitado" — la identidad del usuario decide esB2B, y el modo
    // (comisionable/neta) es una elección POSTERIOR que solo aplica si ya es B2B.
    const r = resolverContextoB2B(inputBase({ usuarioAutenticado: false }));
    assert.equal(r.esB2B, false);
  });

  test("B2B INACTIVO (usuarios.activo = false) → contexto B2C/sin comisión, aunque el rol sea agencia/freelance válido", () => {
    const r = resolverContextoB2B(inputBase({ perfil: { ...agenciaOk, activo: false } }));
    assert.deepEqual(r, { esB2B: false });
  });

  test("usuarios.activo = null (no explícitamente true) también falla cerrado — nunca se asume activo por default", () => {
    const r = resolverContextoB2B(inputBase({ perfil: { ...agenciaOk, activo: null } }));
    assert.deepEqual(r, { esB2B: false });
  });

  test("agente (agenciaId presente) con agencia TITULAR inactiva → sin B2B, aunque el agente mismo esté activo", () => {
    const r = resolverContextoB2B(inputBase({
      agenciaId: "titular-uuid",
      agenciaTitular: { ...agenciaOk, activo: false },
    }));
    assert.deepEqual(r, { esB2B: false });
  });

  test("agente con agencia titular activa pero con rol inválido (dato corrupto: ni agencia ni freelance) → sin B2B", () => {
    const r = resolverContextoB2B(inputBase({
      agenciaId: "titular-uuid",
      agenciaTitular: { ...agenciaOk, rol: "venta" },
    }));
    assert.deepEqual(r, { esB2B: false });
  });

  test("perfil no encontrado (null, sin error) → sin B2B", () => {
    const r = resolverContextoB2B(inputBase({ perfil: null }));
    assert.deepEqual(r, { esB2B: false });
  });
  test("perfil con error de consulta → sin B2B (nunca se sigue con un perfil parcial)", () => {
    const r = resolverContextoB2B(inputBase({ perfilError: true }));
    assert.deepEqual(r, { esB2B: false });
  });
  test("agencia titular no encontrada (null, sin error) → sin B2B", () => {
    const r = resolverContextoB2B(inputBase({ agenciaId: "titular-uuid", agenciaTitular: null }));
    assert.deepEqual(r, { esB2B: false });
  });
  test("agencia titular con error de consulta → sin B2B", () => {
    const r = resolverContextoB2B(inputBase({ agenciaId: "titular-uuid", agenciaTitular: agenciaOk, agenciaTitularError: true }));
    assert.deepEqual(r, { esB2B: false });
  });
  test("error al leer b2b_solicitudes → sin B2B (nunca se arma la facturación sin confirmar la solicitud)", () => {
    const r = resolverContextoB2B(inputBase({ solicitudError: true }));
    assert.deepEqual(r, { esB2B: false });
  });

  test("rol del usuario logueado inválido (ni agencia ni freelance) → sin B2B", () => {
    const r = resolverContextoB2B(inputBase({ perfil: { ...agenciaOk, rol: "cliente_final" } }));
    assert.deepEqual(r, { esB2B: false });
  });

  test("comisión inválida (NaN) en la agencia → fallo cerrado, sin B2B", () => {
    const r = resolverContextoB2B(inputBase({ perfil: { ...agenciaOk, pct_comision: NaN } }));
    assert.deepEqual(r, { esB2B: false });
  });
  test("comisión inválida (>1, ej. 100 en vez de 1) → fallo cerrado, sin B2B", () => {
    const r = resolverContextoB2B(inputBase({ perfil: { ...agenciaOk, pct_comision: 100 } }));
    assert.deepEqual(r, { esB2B: false });
  });
  test("comisión inválida (negativa) → fallo cerrado, sin B2B", () => {
    const r = resolverContextoB2B(inputBase({ perfil: { ...agenciaOk, pct_comision: -0.1 } }));
    assert.deepEqual(r, { esB2B: false });
  });
  test("sin pct_comision propio (null) cae al default general — el default también se valida (no puede tampoco ser NaN/negativo/>1)", () => {
    const r = resolverContextoB2B(inputBase({ perfil: { ...agenciaOk, pct_comision: null }, pctComisionDefault: 0.11 }));
    assert.equal(r.esB2B, true);
    if (r.esB2B) assert.equal(r.pctComision, 0.11);
  });
});

describe("33. Wiring — getContextoB2B (checkout/actions.ts) consulta y valida `activo` para el usuario y la agencia titular", () => {
  const checkout = leer("app/tarifario/checkout/actions.ts");
  test("selecciona `activo` del usuario logueado y de la agencia titular, nunca solo del rol", () => {
    const idx = checkout.indexOf("export async function getContextoB2B");
    const cuerpo = checkout.slice(idx, checkout.indexOf("\n}", idx));
    // La columna `activo` se pide en AMBAS consultas de `usuarios` (perfil propio
    // y, si aplica, la agencia titular) — antes de esta ronda solo se pedía rol.
    const selects = cuerpo.match(/\.select\("[^"]*activo[^"]*"\)/g) ?? [];
    assert.ok(selects.length >= 2, "getContextoB2B debe seleccionar `activo` en al menos 2 consultas (perfil + agencia titular)");
  });
  test("delega TODA la decisión a resolverContextoB2B (módulo puro) — nunca decide esB2B por su cuenta comparando .rol/.activo inline", () => {
    const idx = checkout.indexOf("export async function getContextoB2B");
    const cuerpo = checkout.slice(idx, checkout.indexOf("\n}", idx));
    assert.match(cuerpo, /resolverContextoB2B\(/);
    assert.doesNotMatch(cuerpo, /rol !== "agencia" && rol !== "freelance"/); // la comparación vieja, inline, ya no debe estar acá
  });
  test("revisa el error de cada consulta (perfil, agencia titular, b2b_solicitudes) antes de resolver el contexto", () => {
    const idx = checkout.indexOf("export async function getContextoB2B");
    const cuerpo = checkout.slice(idx, checkout.indexOf("\n}", idx));
    assert.match(cuerpo, /error: perfilErr/);
    assert.match(cuerpo, /error: apErr/);
    assert.match(cuerpo, /error: solsErr/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ronda 5 — "FRONTERA PÚBLICA DE buscarReceptivos". `buscarReceptivos`
// (lib/reservar/cotizar.ts) seguía tipada con `BusquedaServiciosInput` y leía
// sus propiedades directamente — a diferencia de `buscarHoteles`, un payload
// manipulado (null, arreglos, fechas imposibles, pax decimal/NaN/Infinity/
// negativo/gigante, destino gigante) podía llegar hasta el `noches()`/
// `.trim()` sin haberse validado, con riesgo de TypeError o de tocar
// Supabase con datos basura. Ahora trata `inputRaw` como `unknown`, igual
// que `buscarHoteles` — misma frontera, mismos validadores puros.
// ───────────────────────────────────────────────────────────────────────────
describe("34. Ronda 5: validarPaxServicioConsulta (pax de buscarReceptivos) — ejecución real", () => {
  const invalidos: unknown[] = [
    null, undefined, "2", true, [], {}, NaN, Infinity, -Infinity,
    0, -1, -100, 1.5, 2.99, MAX_PAX_CONSULTA + 1, 1e9, Number.MAX_SAFE_INTEGER,
  ];
  for (const v of invalidos) {
    test(`validarPaxServicioConsulta(${JSON.stringify(v)}) no lanza y rechaza`, () => {
      assert.doesNotThrow(() => validarPaxServicioConsulta(v));
      assert.equal(validarPaxServicioConsulta(v).ok, false);
    });
  }
  test("enteros válidos entre 1 y MAX_PAX_CONSULTA se aceptan", () => {
    assert.equal(validarPaxServicioConsulta(1).ok, true);
    assert.equal(validarPaxServicioConsulta(2).ok, true);
    assert.equal(validarPaxServicioConsulta(MAX_PAX_CONSULTA).ok, true);
    const r = validarPaxServicioConsulta(4);
    assert.deepEqual(r, { ok: true, pax: 4 });
  });
});

describe("35. Ronda 5: Wiring — buscarReceptivos trata su input como unknown, igual que buscarHoteles", () => {
  const cotizar = leer("lib/reservar/cotizar.ts");
  const reservarActions = leer("app/(dashboard)/dashboard/reservar/actions.ts");

  test("cotizar.ts: la firma es (inputRaw: unknown), no BusquedaServiciosInput directo", () => {
    assert.match(cotizar, /export async function buscarReceptivos\(inputRaw: unknown\)/);
  });
  test("cotizar.ts: valida objeto no nulo/no arreglo antes de leer cualquier propiedad", () => {
    const idx = cotizar.indexOf("export async function buscarReceptivos(inputRaw: unknown)");
    const cuerpo = cotizar.slice(idx, cotizar.indexOf("\nexport", idx + 10));
    assert.match(cuerpo, /typeof inputRaw !== "object" \|\| inputRaw === null \|\| Array\.isArray\(inputRaw\)/);
  });
  test("cotizar.ts: usa los mismos validadores puros que buscarHoteles (fecha real, destino acotado, pax entero acotado)", () => {
    const idx = cotizar.indexOf("export async function buscarReceptivos(inputRaw: unknown)");
    const cuerpo = cotizar.slice(idx, cotizar.indexOf("\nexport", idx + 10));
    assert.match(cuerpo, /validarFechaConsulta\(o\.fechaIda\)/);
    assert.match(cuerpo, /validarFechaConsulta\(o\.fechaRegreso\)/);
    assert.match(cuerpo, /validarDestinoConsulta\(o\.destino\)/);
    assert.match(cuerpo, /validarPaxServicioConsulta\(o\.pax\)/);
  });
  test("cotizar.ts: rechaza el rango de fechas inválido (regreso <= ida) antes de consultar Supabase", () => {
    const idx = cotizar.indexOf("export async function buscarReceptivos(inputRaw: unknown)");
    const cuerpo = cotizar.slice(idx, cotizar.indexOf("\nexport", idx + 10));
    assert.match(cuerpo, /numNoches <= 0/);
  });
  test("actions.ts: el wrapper de la Server Action también tipa el parámetro como unknown (no BusquedaServiciosInput)", () => {
    assert.match(reservarActions, /export async function buscarReceptivos\(input: unknown\)/);
    assert.doesNotMatch(reservarActions, /export async function buscarReceptivos\(input: BusquedaServiciosInput\)/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ronda 7 — hallazgo 1: "ERROR CRUDO AL INSERTAR COTIZACIONES". El insert de
// `cotizaciones` en `crearCotizacionCarrito` (checkout/actions.ts) devolvía
// `error?.message ?? "No se pudo crear la cotización."` al navegador — un
// fallo real de Postgres/Supabase (columna faltante, política RLS, tabla
// renombrada, restricción violada) llegaba tal cual a una Server Action
// pública. `respuestaPublicaInsertCotizacion`/`formatearLogInsertCotizacion`
// (lib/reservar/edadesMenores.ts, módulo puro) separan mensaje fijo vs.
// detalle para el log, mismo patrón que `fallaErrorConsulta` en
// liquidacionServicio.ts.
// ───────────────────────────────────────────────────────────────────────────

describe("37. Ronda 7: respuestaPublicaInsertCotizacion — mensaje público SIEMPRE fijo, con mensajes reales de Postgres", () => {
  const ERRORES_POSTGRES_INSERT = [
    'null value in column "tenant" of relation "cotizaciones" violates not-null constraint',
    "new row violates row-level security policy for table \"cotizaciones\"",
    'relation "cotizaciones" does not exist',
    "permission denied for table cotizaciones",
    'duplicate key value violates unique constraint "cotizaciones_codigo_key"',
    'column "payload" of relation "cotizaciones" does not exist',
  ];
  for (const detalle of ERRORES_POSTGRES_INSERT) {
    test(`detalleInterno = ${JSON.stringify(detalle)} → error público es EXACTAMENTE el texto fijo, nunca el mensaje real`, () => {
      const r = respuestaPublicaInsertCotizacion(detalle);
      assert.equal(r.ok, false);
      if (r.ok) return;
      assert.equal(r.error, MENSAJE_ERROR_COTIZACION);
      assert.doesNotMatch(r.error, /cotizaciones|tenant|constraint|relation|permission denied|row-level security|column/i);
      const serializado = JSON.stringify(r);
      assert.doesNotMatch(serializado, new RegExp(detalle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });
  }
  test("el objeto público es exactamente {ok, error} — sin campos internos de más", () => {
    const r = respuestaPublicaInsertCotizacion("cualquier detalle técnico");
    assert.deepEqual(Object.keys(r).sort(), ["error", "ok"]);
  });
  test("control negativo — el defecto real: `error?.message ?? \"No se pudo crear la cotización.\"` sí habría reenviado el mensaje de Postgres tal cual", () => {
    // Reconstruye a propósito el patrón de la ronda 6 (antes de esta ronda 7)
    // para demostrar que el hallazgo era real.
    const errorSupabaseSimulado = { message: 'permission denied for table "cotizaciones"' };
    const mensajeViejo = errorSupabaseSimulado?.message ?? "No se pudo crear la cotización.";
    assert.match(mensajeViejo, /permission denied for table "cotizaciones"/); // el defecto: SÍ se filtraba
    const mensajeNuevo = respuestaPublicaInsertCotizacion(errorSupabaseSimulado.message);
    assert.equal(mensajeNuevo.ok, false);
    if (mensajeNuevo.ok) return;
    assert.doesNotMatch(mensajeNuevo.error, /permission denied|cotizaciones/i); // la corrección: ya no
  });
});

describe("38. Ronda 7: formatearLogInsertCotizacion — el log SÍ conserva la etapa y el detalle técnico completo, nunca datos del cliente", () => {
  test("la línea de log incluye la etapa y el detalle técnico completo", () => {
    const linea = formatearLogInsertCotizacion({ etapa: "insertar_cotizacion", detalle: 'permission denied for table "cotizaciones"' });
    assert.match(linea, /etapa=insertar_cotizacion/);
    assert.match(linea, /permission denied for table "cotizaciones"/);
  });
  test("la firma solo acepta etapa/detalle — no hay forma de pasarle nombre/documento/teléfono/email del cliente ni el payload de la cotización", () => {
    const linea = formatearLogInsertCotizacion({ etapa: "insertar_cotizacion", detalle: "x" });
    assert.equal(typeof linea, "string");
  });
});

describe("39. Ronda 7: Wiring — checkout/actions.ts usa la frontera sanitizada para el insert de cotizaciones, nunca error.message directo", () => {
  const checkout = leer("app/tarifario/checkout/actions.ts");

  test("el insert de cotizaciones nunca construye el error público con `error?.message` ni `error.message`", () => {
    const idx = checkout.indexOf('.from("cotizaciones").insert(');
    const idxFin = checkout.indexOf("\n\n", idx);
    const bloque = checkout.slice(idx, idxFin);
    assert.doesNotMatch(bloque, /error:\s*error\??\.message/);
    assert.match(bloque, /respuestaPublicaInsertCotizacion\(detalle\)/);
    assert.match(bloque, /console\.error\(formatearLogInsertCotizacion/);
  });
  test("checkout/actions.ts importa respuestaPublicaInsertCotizacion/formatearLogInsertCotizacion desde lib/reservar/edadesMenores", () => {
    assert.match(checkout, /respuestaPublicaInsertCotizacion, formatearLogInsertCotizacion/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ronda 7 — hallazgos 2 y 3: "SERVICE ROLE EXPUESTO EN buscarReceptivos" y
// "ERRORES DE CONSULTA IGNORADOS EN buscarReceptivos". `buscarReceptivos`
// (lib/reservar/cotizar.ts) revelaba "falta service-role" al público y
// descartaba el `error` de la consulta inicial y de las 5 consultas
// paralelas — un fallo técnico real de Supabase se veía idéntico a "sin
// resultados", lo cual es funcional y financieramente incorrecto (omitir
// servicios en silencio). Estas pruebas de wiring confirman, sobre el código
// FUENTE real (no una reimplementación), que las 6 consultas revisan su
// `error` y abortan ANTES de usar `?? []`.
// ───────────────────────────────────────────────────────────────────────────

describe("40. Ronda 7: Wiring — buscarReceptivos ya no revela 'service-role' en el mensaje público", () => {
  const cotizar = leer("lib/reservar/cotizar.ts");

  function cuerpoBuscarReceptivos(): string {
    const idx = cotizar.indexOf("export async function buscarReceptivos(inputRaw: unknown)");
    return cotizar.slice(idx, cotizar.indexOf("\nexport", idx + 10));
  }

  test("el mensaje de arranque (falta SUPABASE_SERVICE_ROLE_KEY) ya no contiene la palabra 'service-role'", () => {
    const cuerpo = cuerpoBuscarReceptivos();
    const idxArranque = cuerpo.indexOf("SUPABASE_SERVICE_ROLE_KEY");
    const idxReturn = cuerpo.indexOf("return", idxArranque);
    const idxFinReturn = cuerpo.indexOf(";", idxReturn);
    const bloqueReturn = cuerpo.slice(idxReturn, idxFinReturn);
    assert.doesNotMatch(bloqueReturn, /service-role/i);
    // El detalle real (que sí menciona la env var) queda SOLO en el
    // console.error previo al return, nunca en el string devuelto.
    assert.match(cuerpo.slice(idxArranque, idxReturn), /console\.error/);
  });
  test("control negativo — el mensaje viejo 'Búsqueda no disponible (falta service-role)' ya no aparece en ningún return de buscarReceptivos", () => {
    const cuerpo = cuerpoBuscarReceptivos();
    assert.doesNotMatch(cuerpo, /falta service-role/);
  });
  test("el mensaje público de arranque es el mismo texto genérico fijo usado en el resto de fallos de esta función", () => {
    const cuerpo = cuerpoBuscarReceptivos();
    const usosDelMensaje = cuerpo.match(/MENSAJE_BUSQUEDA_RECEPTIVOS_NO_DISPONIBLE/g) ?? [];
    // Se usa en el arranque + en el fallo de la consulta inicial + en el
    // fallo de las 5 consultas paralelas = al menos 3 apariciones.
    assert.ok(usosDelMensaje.length >= 3, `se esperaban al menos 3 usos del mensaje fijo, hubo ${usosDelMensaje.length}`);
  });
});

describe("41. Ronda 7: Wiring — buscarReceptivos revisa el error de CADA una de sus 6 consultas antes de usar los datos", () => {
  const cotizar = leer("lib/reservar/cotizar.ts");

  function cuerpoBuscarReceptivos(): string {
    const idx = cotizar.indexOf("export async function buscarReceptivos(inputRaw: unknown)");
    return cotizar.slice(idx, cotizar.indexOf("\nexport", idx + 10));
  }

  test("la consulta inicial a tarifario_resultado captura y revisa su error ANTES de construir `pares`", () => {
    const cuerpo = cuerpoBuscarReceptivos();
    const idxQuery = cuerpo.indexOf('const { data: filas');
    const idxPares = cuerpo.indexOf("const pares = new Map");
    assert.ok(idxQuery > -1 && idxPares > idxQuery);
    const bloque = cuerpo.slice(idxQuery, idxPares);
    assert.match(bloque, /error:\s*filasErr/);
    assert.match(bloque, /if\s*\(filasErr\)/);
    // El abort (return de error) debe estar ANTES de construir `pares` — si
    // la consulta falló, nunca se debe llegar a iterar `filas ?? []`. Como
    // `bloque` ya termina justo donde empieza `const pares = new Map`
    // (idxPares), cualquier posición encontrada DENTRO de `bloque` ya está,
    // por construcción, antes de esa línea — no hace falta buscar el `for`.
    const idxIfErr = bloque.indexOf("if (filasErr)");
    const idxReturnErr = bloque.indexOf("return", idxIfErr);
    assert.ok(idxIfErr > -1 && idxReturnErr > idxIfErr);
  });
  test("las 5 consultas paralelas (paquetes/armado/servicios/grupos/temporadas) capturan TODOS sus errores, no solo `data`", () => {
    const cuerpo = cuerpoBuscarReceptivos();
    const idxPromiseAll = cuerpo.indexOf("Promise.all([");
    const idxDestructuring = cuerpo.lastIndexOf("] = await Promise.all", idxPromiseAll + 5000);
    // El bloque de destructuring está ANTES del `Promise.all([` — se busca
    // hacia atrás desde ahí hasta el `const [`.
    const idxConst = cuerpo.lastIndexOf("const [", idxPromiseAll);
    const bloqueDestructuring = cuerpo.slice(idxConst, idxPromiseAll);
    for (const campo of ["paquetesErr", "armadoErr", "serviciosErr", "gruposErr", "temporadasErr"]) {
      assert.match(bloqueDestructuring, new RegExp(`error:\\s*${campo}`), `falta capturar el error de ${campo}`);
    }
    void idxDestructuring;
  });
  test("cualquiera de los 5 errores paralelos aborta la búsqueda COMPLETA antes de llamar construirContextoServicios", () => {
    const cuerpo = cuerpoBuscarReceptivos();
    const idxIf = cuerpo.indexOf("if (paquetesErr || armadoErr || serviciosErr || gruposErr || temporadasErr)");
    const idxCtx = cuerpo.indexOf("construirContextoServicios({");
    assert.ok(idxIf > -1 && idxCtx > idxIf, "el chequeo de errores paralelos debe preceder a construirContextoServicios");
    const bloque = cuerpo.slice(idxIf, idxCtx);
    assert.match(bloque, /return \{ ok: false, error: MENSAJE_BUSQUEDA_RECEPTIVOS_NO_DISPONIBLE \}/);
  });
  test("control negativo — el patrón viejo (`const [{ data: paquetes }, ...] = await Promise.all`, sin `error:`) ya no está presente", () => {
    const cuerpo = cuerpoBuscarReceptivos();
    assert.doesNotMatch(cuerpo, /const \[\{ data: paquetes \}, \{ data: armado \}, \{ data: servicios \}, \{ data: grupos \}, \{ data: temporadas \}\]/);
  });
  test("control negativo — `const { data: filas } = await q;` (sin capturar error) ya no está presente", () => {
    const cuerpo = cuerpoBuscarReceptivos();
    assert.doesNotMatch(cuerpo, /const \{ data: filas \} = await q;/);
  });
});

describe("42. Ronda 7: Wiring — checkout/actions.ts nunca lee resultado.codigo de la respuesta pública de liquidarServicioPuntual", () => {
  const checkout = leer("app/tarifario/checkout/actions.ts");
  const liquidacion = leer("lib/reservar/liquidacionServicio.ts");

  test("checkout/actions.ts (el bucle de tours) nunca referencia resultado.codigo", () => {
    const idxInicio = checkout.indexOf("for (const t of input.tours)");
    const idxFin = checkout.indexOf("\n  }\n", idxInicio);
    const bucle = checkout.slice(idxInicio, idxFin);
    assert.doesNotMatch(bucle, /resultado\.codigo/);
  });
  test("RespuestaPublicaServicioPuntual (el DTO público) ya no declara la clave codigo en su rama de error", () => {
    const idx = liquidacion.indexOf("export type RespuestaPublicaServicioPuntual");
    // El tipo es una unión multi-línea con `;` DENTRO de cada rama (ej.
    // "{ ok: true; resultado: ... }") — el primer `;` del texto NO es el fin
    // de la declaración. El límite real es el `\n\n` en blanco antes de la
    // siguiente función exportada.
    const idxFin = liquidacion.indexOf("\n\nexport function respuestaPublicaServicioPuntual", idx);
    const tipo = liquidacion.slice(idx, idxFin);
    assert.doesNotMatch(tipo, /codigo:/);
    assert.match(tipo, /mensaje: string/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ronda 2 (vista-booking-fechas-sugeridas) — `validarEntradaCotizarPorFechas`:
// frontera pública de `cotizarPorFechas` (lib/reservar/cotizar.ts), que dejó
// de recibir `{ paqueteId; hotelId; fechaIda; fechaRegreso }` tipado directo
// y ahora trata el input como `unknown`. Ejecución REAL del parser puro —
// ningún caso debe lanzar, sin importar la forma del payload.
// ───────────────────────────────────────────────────────────────────────────
describe("40. Ronda 2: validarEntradaCotizarPorFechas — frontera pública, nunca lanza", () => {
  const HOY = "2026-06-01";
  const entradaValida = { paqueteId: 1, hotelId: 2, fechaIda: "2026-09-10", fechaRegreso: "2026-09-13" };

  test("entrada válida se acepta y calcula las noches correctamente", () => {
    const r = validarEntradaCotizarPorFechas(entradaValida, HOY);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.input.paqueteId, 1);
      assert.equal(r.input.hotelId, 2);
      assert.equal(r.input.fechaIda, "2026-09-10");
      assert.equal(r.input.fechaRegreso, "2026-09-13");
      assert.equal(r.input.noches, 3);
    }
  });

  const payloadsManipulados: unknown[] = [
    null,
    undefined,
    "cadena",
    42,
    true,
    [],
    [entradaValida], // arreglo, no objeto — nunca se debe tratar como el objeto de adentro
    {},
    { paqueteId: 1 }, // incompleto: falta hotelId y fechas
    { paqueteId: 1, hotelId: 2 }, // incompleto: faltan fechas
    { paqueteId: null, hotelId: 2, fechaIda: "2026-09-10", fechaRegreso: "2026-09-13" },
    { paqueteId: 1.5, hotelId: 2, fechaIda: "2026-09-10", fechaRegreso: "2026-09-13" }, // decimal
    { paqueteId: -1, hotelId: 2, fechaIda: "2026-09-10", fechaRegreso: "2026-09-13" }, // negativo
    { paqueteId: 0, hotelId: 2, fechaIda: "2026-09-10", fechaRegreso: "2026-09-13" }, // cero — no es positivo
    { paqueteId: Infinity, hotelId: 2, fechaIda: "2026-09-10", fechaRegreso: "2026-09-13" },
    { paqueteId: NaN, hotelId: 2, fechaIda: "2026-09-10", fechaRegreso: "2026-09-13" },
    { paqueteId: "1", hotelId: 2, fechaIda: "2026-09-10", fechaRegreso: "2026-09-13" }, // string en vez de número
    { paqueteId: 1, hotelId: -2, fechaIda: "2026-09-10", fechaRegreso: "2026-09-13" },
    { paqueteId: 1, hotelId: 2, fechaIda: null, fechaRegreso: "2026-09-13" },
    { paqueteId: 1, hotelId: 2, fechaIda: "2026-09-10", fechaRegreso: undefined },
    { paqueteId: 1, hotelId: 2, fechaIda: "2026-13-40", fechaRegreso: "2026-09-13" }, // fecha inexistente (mes 13)
    { paqueteId: 1, hotelId: 2, fechaIda: "2026-02-30", fechaRegreso: "2026-09-13" }, // fecha inexistente (30 feb)
    { paqueteId: 1, hotelId: 2, fechaIda: "10-09-2026", fechaRegreso: "13-09-2026" }, // formato incorrecto
    { paqueteId: 1, hotelId: 2, fechaIda: "2026-09-13", fechaRegreso: "2026-09-10" }, // regreso antes que la ida
    { paqueteId: 1, hotelId: 2, fechaIda: "2026-09-13", fechaRegreso: "2026-09-13" }, // regreso igual a la ida (0 noches)
  ];
  for (const p of payloadsManipulados) {
    test(`payload manipulado (${JSON.stringify(p)}) no lanza y se rechaza`, () => {
      assert.doesNotThrow(() => validarEntradaCotizarPorFechas(p, HOY));
      assert.equal(validarEntradaCotizarPorFechas(p, HOY).ok, false);
    });
  }

  test("fecha de ida anterior a hoy se rechaza", () => {
    const r = validarEntradaCotizarPorFechas({ paqueteId: 1, hotelId: 2, fechaIda: "2026-05-31", fechaRegreso: "2026-06-05" }, HOY);
    assert.equal(r.ok, false);
  });
  test("fecha de ida igual a hoy se acepta (no se rechaza por ser 'anterior')", () => {
    const r = validarEntradaCotizarPorFechas({ paqueteId: 1, hotelId: 2, fechaIda: HOY, fechaRegreso: "2026-06-05" }, HOY);
    assert.equal(r.ok, true);
  });
  test(`más de ${MAX_NOCHES_CONSULTA} noches se rechaza (límite ya existente del sistema, reutilizado)`, () => {
    const fechaRegresoLejana = "2027-06-01"; // ~365 noches, muy por encima del límite
    const r = validarEntradaCotizarPorFechas({ paqueteId: 1, hotelId: 2, fechaIda: HOY, fechaRegreso: fechaRegresoLejana }, HOY);
    assert.equal(r.ok, false);
  });
  test(`exactamente ${MAX_NOCHES_CONSULTA} noches se acepta (límite inclusive)`, () => {
    const fechaRegreso = addDiasISOLocal(HOY, MAX_NOCHES_CONSULTA);
    const r = validarEntradaCotizarPorFechas({ paqueteId: 1, hotelId: 2, fechaIda: HOY, fechaRegreso }, HOY);
    assert.equal(r.ok, true);
  });
  test("nunca lee ninguna propiedad antes de confirmar la forma — un getter que lanza no debe ejecutarse en un payload ya inválido por otra razón", () => {
    let leido = false;
    const trampa = {
      paqueteId: "no-es-numero", // ya inválido por tipo, ANTES de llegar a fechaIda
      hotelId: 2,
      get fechaIda(): string { leido = true; throw new Error("no debía leerse"); },
      fechaRegreso: "2026-09-13",
    };
    assert.doesNotThrow(() => validarEntradaCotizarPorFechas(trampa, HOY));
    assert.equal(validarEntradaCotizarPorFechas(trampa, HOY).ok, false);
    assert.equal(leido, false, "fechaIda no debía leerse: paqueteId ya era inválido");
  });
});

function addDiasISOLocal(fechaISO: string, dias: number): string {
  const t = new Date(`${fechaISO}T00:00:00`).getTime() + dias * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
