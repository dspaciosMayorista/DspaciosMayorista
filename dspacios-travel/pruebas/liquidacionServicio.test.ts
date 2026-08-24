import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  construirContextoServicios,
  calcularPrecioConModoYMarkup,
  calcularResultadoServicio,
  resolverLiquidacionServicioPuntual,
  resolverConfiguracionServicio,
  validarModoServicio,
  validarPctMarkup,
  type DatosServicioPar,
  type FilaPaquete,
  type FilaArmadoServicio,
  type FilaServicioAdicional,
} from "../lib/reservar/liquidacionServicio.ts";

// ───────────────────────────────────────────────────────────────────────────
// Ronda 4 — "RELIQUIDACIÓN DE TOURS PUEDE SUBCOTIZAR". La re-liquidación
// puntual del checkout (resolverLiquidacionServicioPuntual) ya NO usa
// defaults de modo/markup cuando falta armado_servicios/armado_paquetes —
// exige ambos presentes, confirma que el armado pertenece exactamente al par
// consultado, revisa cada error de Supabase por separado, y distingue tres
// motivos de fallo ("no_disponible" / "error_consulta" / "configuracion_invalida").
// Estas pruebas ejecutan la lógica REAL (no solo texto): el módulo es puro
// (sin Supabase/next), así que node --test lo importa directo.
// ───────────────────────────────────────────────────────────────────────────

const PAR: DatosServicioPar = { servicioId: 1, paqueteId: 10, nombre: "Tour X", destino: "Cartagena", descripcion: "Un tour" };
const PAQUETE: FilaPaquete = { id: 10, pct_mk: 0.2 };
const ARMADO: FilaArmadoServicio = { paquete_id: 10, servicio_id: 1, modo: "persona" };
const SERVICIO: FilaServicioAdicional = { id: 1, precio_persona: 100_000, recargo_individual: 5_000, liquidacion: null, moneda: "COP" };
const FECHA = new Date("2026-10-01T00:00:00");

function baseInput(overrides: Partial<Parameters<typeof resolverLiquidacionServicioPuntual>[0]> = {}) {
  return {
    par: PAR, fechaIdaDate: FECHA, numNoches: 1, pax: 2,
    filaTarifarioEncontrada: true, filaTarifarioError: null,
    paquete: PAQUETE, paqueteError: null,
    armado: ARMADO, armadoError: null,
    servicio: SERVICIO, servicioError: null,
    grupos: [], gruposError: null,
    temporadas: [], temporadasError: null,
    ...overrides,
  };
}

describe("1. Camino feliz: paquete+armado+servicio presentes → cotiza con el markup y modo REALES", () => {
  test("modo persona, 20% markup: total = (neto/persona × pax) marcado al 20%, nunca 0% de markup", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.resultado.pax, 2);
      // Con pax=2 no aplica el recargo individual (solo pax===1) — neto =
      // 100000 × 2 = 200000; marcar(200000, 0.2) = 200000/(1−0.2) = 250000.
      assert.equal(r.resultado.total, 250_000);
      assert.notEqual(r.resultado.total, 200_000); // si el markup se hubiera caído a 0%, total sería el neto crudo sin margen
    }
  });
});

describe("2. Paquete ausente NUNCA cotiza con 0% de markup — aborta como configuración inválida", () => {
  test("paquete: null → ok:false, tipo configuracion_invalida, ningún resultado", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput({ paquete: null }));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.tipo, "configuracion_invalida");
      assert.ok(!("resultado" in r));
    }
  });
});

describe("3. Armado ausente NUNCA cae a modo 'persona' por defecto — aborta como configuración inválida", () => {
  test("armado: null → ok:false, tipo configuracion_invalida", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput({ armado: null }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "configuracion_invalida");
  });
  test("un servicio real de modo GRUPO, si su armado se pierde, no se re-liquida como 'persona' con el precio por persona (que puede ni existir)", () => {
    const servicioSoloGrupo: FilaServicioAdicional = { id: 2, precio_persona: null, recargo_individual: 0, liquidacion: null, moneda: "COP" };
    const r = resolverLiquidacionServicioPuntual(baseInput({ armado: null, servicio: servicioSoloGrupo, par: { ...PAR, servicioId: 2 } }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "configuracion_invalida");
  });
});

describe("4. El armado debe pertenecer EXACTAMENTE al par consultado", () => {
  test("armado de otro paquete/servicio (aunque la fila exista) se rechaza como configuración inválida", () => {
    const armadoAjeno: FilaArmadoServicio = { paquete_id: 999, servicio_id: 1, modo: "persona" };
    const r = resolverLiquidacionServicioPuntual(baseInput({ armado: armadoAjeno }));
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.tipo, "configuracion_invalida"); assert.match(r.error, /no corresponde al par/); }
  });
});

describe("5. Error simulado en CADA consulta aborta como error_consulta — nunca genera un resultado", () => {
  const casos: [string, Partial<Parameters<typeof resolverLiquidacionServicioPuntual>[0]>][] = [
    ["tarifario", { filaTarifarioError: "timeout" }],
    ["paquete", { paqueteError: "conexión perdida" }],
    ["armado", { armadoError: "500" }],
    ["servicio", { servicioError: "rls denegado" }],
    ["grupos", { gruposError: "timeout" }],
    ["temporadas", { temporadasError: "timeout" }],
  ];
  for (const [nombre, override] of casos) {
    test(`error en la consulta de ${nombre} → ok:false, tipo error_consulta`, () => {
      const r = resolverLiquidacionServicioPuntual(baseInput(override));
      assert.equal(r.ok, false);
      if (!r.ok) { assert.equal(r.tipo, "error_consulta"); assert.ok(!("resultado" in r)); }
    });
  }
});

describe("6. Servicio genuinamente no disponible se distingue de un fallo técnico", () => {
  test("tarifario no encontrado (par no publicado/activo) → no_disponible, no error_consulta", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput({ filaTarifarioEncontrada: false }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "no_disponible");
  });
  test("servicio sin fila (id ya no existe) → no_disponible", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput({ servicio: null }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "no_disponible");
  });
  test("sin tarifa vigente para esas fechas/pax (modo persona sin precio_persona) → no_disponible", () => {
    const servicioSinTarifa: FilaServicioAdicional = { id: 1, precio_persona: null, recargo_individual: 0, liquidacion: null, moneda: "COP" };
    const r = resolverLiquidacionServicioPuntual(baseInput({ servicio: servicioSinTarifa }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.tipo, "no_disponible");
  });
});

describe("7. nombre/destino/descripción del par (nunca precio) — cambiarlos no afecta el total calculado", () => {
  test("el total depende SOLO de las filas de paquete/armado/servicio/temporadas/grupos, nunca del par", () => {
    const parManipulado: DatosServicioPar = { servicioId: 1, paqueteId: 10, nombre: "NOMBRE FALSO", destino: "DESTINO FALSO", descripcion: "desc falsa" };
    const r1 = resolverLiquidacionServicioPuntual(baseInput());
    const r2 = resolverLiquidacionServicioPuntual(baseInput({ par: parManipulado }));
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (r1.ok && r2.ok) {
      assert.equal(r1.resultado.total, r2.resultado.total);
      assert.equal(r2.resultado.nombre, "NOMBRE FALSO"); // el nombre SÍ se refleja (es cosmético, viene del tarifario)
    }
  });
});

describe("8. El resultado puntual coincide BYTE A BYTE con el camino de búsqueda (buscarReceptivos) para el mismo par/fechas/pax", () => {
  test("misma fórmula compartida (calcularPrecioConModoYMarkup): ambos caminos, con los mismos datos reales, dan el mismo objeto", () => {
    const ctx = construirContextoServicios({
      paquetes: [PAQUETE], armado: [ARMADO], servicios: [SERVICIO], grupos: [], temporadas: [],
    });
    // Camino "búsqueda" (tolerante, pero con datos completos no hay diferencia).
    const rBusqueda = calcularResultadoServicio(PAR, ctx, FECHA, 1, 2);
    // Camino "checkout" (fallo cerrado).
    const rCheckout = resolverLiquidacionServicioPuntual(baseInput());
    assert.equal(rCheckout.ok, true);
    if (rCheckout.ok) {
      assert.deepEqual(rBusqueda, rCheckout.resultado);
    }
  });
  test("ambos caminos usan la misma función base — cambiar el markup cambia el resultado de los dos por igual", () => {
    const paqueteOtroMarkup: FilaPaquete = { id: 10, pct_mk: 0.35 };
    const ctx = construirContextoServicios({
      paquetes: [paqueteOtroMarkup], armado: [ARMADO], servicios: [SERVICIO], grupos: [], temporadas: [],
    });
    const rBusqueda = calcularResultadoServicio(PAR, ctx, FECHA, 1, 2);
    const rCheckout = resolverLiquidacionServicioPuntual(baseInput({ paquete: paqueteOtroMarkup }));
    assert.equal(rCheckout.ok, true);
    if (rCheckout.ok) assert.deepEqual(rBusqueda, rCheckout.resultado);
  });
});

describe("9. calcularPrecioConModoYMarkup nunca decide defaults por sí sola — exige modo y pctMk explícitos", () => {
  test("modo 'grupo' sin rangos de grupo configurados → null (no inventa un precio por persona)", () => {
    const ctx = construirContextoServicios({ paquetes: [PAQUETE], armado: [], servicios: [SERVICIO], grupos: [], temporadas: [] });
    const r = calcularPrecioConModoYMarkup(PAR, ctx, FECHA, 1, 2, "grupo", 0.2);
    assert.equal(r, null);
  });
  test("0% de markup explícito SÍ se respeta (es una decisión real del llamador, no un default oculto)", () => {
    const ctx = construirContextoServicios({ paquetes: [PAQUETE], armado: [], servicios: [SERVICIO], grupos: [], temporadas: [] });
    const r = calcularPrecioConModoYMarkup(PAR, ctx, FECHA, 1, 2, "persona", 0);
    assert.ok(r);
    if (r) assert.equal(r.total, 200_000); // 2 pax × 100000, sin margen, sin recargo (pax≠1)
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ronda 5 — hallazgos puntuales sobre la ronda 4: el modo/markup inválidos
// TODAVÍA caían a "persona"/0% en resolverLiquidacionServicioPuntual (el
// fallo cerrado declarado no era real), la búsqueda (calcularResultadoServicio)
// seguía publicando precios con esos mismos defaults, y buscarReceptivos no
// trataba su input como `unknown`. NO se toca el algoritmo de menores
// (distribuirPorHabitaciones) — sigue correcto desde la ronda 4.
// ───────────────────────────────────────────────────────────────────────────

describe("10. Ronda 5: validarModoServicio — solo 'persona'/'grupo' son válidos", () => {
  test("null, cadena vacía, texto arbitrario, mayúsculas y valores manipulados nunca cotizan como 'persona'", () => {
    assert.equal(validarModoServicio(null), null);
    assert.equal(validarModoServicio(undefined), null);
    assert.equal(validarModoServicio(""), null);
    assert.equal(validarModoServicio("otro"), null);
    assert.equal(validarModoServicio("Persona"), null); // mayúscula inicial
    assert.equal(validarModoServicio("PERSONA"), null); // todo mayúsculas
    assert.equal(validarModoServicio("GRUPO"), null);
    assert.equal(validarModoServicio("persona "), null); // espacio final
    assert.equal(validarModoServicio(" persona"), null); // espacio inicial
    assert.equal(validarModoServicio(0), null);
    assert.equal(validarModoServicio(1), null);
    assert.equal(validarModoServicio(["persona"]), null);
    assert.equal(validarModoServicio({ modo: "persona" }), null);
  });
  test("'persona' y 'grupo' exactos son los únicos válidos", () => {
    assert.equal(validarModoServicio("persona"), "persona");
    assert.equal(validarModoServicio("grupo"), "grupo");
  });
});

describe("11. Ronda 5: resolverLiquidacionServicioPuntual — modo inválido/null/manipulado nunca cotiza como 'persona'", () => {
  const modosInvalidos: unknown[] = [null, "", "otro", "Persona", "PERSONA", "GRUPO", 0, 1, ["persona"], { modo: "persona" }];
  for (const modo of modosInvalidos) {
    test(`armado.modo = ${JSON.stringify(modo)} → configuracion_invalida, nunca ok:true`, () => {
      const r = resolverLiquidacionServicioPuntual(baseInput({ armado: { ...ARMADO, modo: modo as string | null } }));
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.tipo, "configuracion_invalida");
    });
  }
  test("un modo inválido nunca produce el mismo total que el modo 'persona' real (prueba que NO se está calculando igual)", () => {
    const rValido = resolverLiquidacionServicioPuntual(baseInput());
    const rInvalido = resolverLiquidacionServicioPuntual(baseInput({ armado: { ...ARMADO, modo: "otro" } }));
    assert.equal(rValido.ok, true);
    assert.equal(rInvalido.ok, false);
  });
});

describe("12. Ronda 5: validarPctMarkup — rango comercial real de armado_paquetes.pct_mk", () => {
  test("null, NaN, Infinity, -Infinity, texto y negativos son inválidos", () => {
    assert.equal(validarPctMarkup(null), null);
    assert.equal(validarPctMarkup(undefined), null);
    assert.equal(validarPctMarkup(NaN), null);
    assert.equal(validarPctMarkup(Infinity), null);
    assert.equal(validarPctMarkup(-Infinity), null);
    assert.equal(validarPctMarkup("0.2"), null);
    assert.equal(validarPctMarkup(-0.01), null);
    assert.equal(validarPctMarkup(-1), null);
  });
  test("el límite inválido — pct_mk >= 1 — se rechaza siempre (produciría división por cero/negativa en marcar())", () => {
    assert.equal(validarPctMarkup(1), null);
    assert.equal(validarPctMarkup(1.5), null);
    assert.equal(validarPctMarkup(100), null); // típico error: mandar 100 en vez de 1 (100%)
  });
  test("0 (markup real de 0%, legítimo) y valores intermedios sí son válidos", () => {
    assert.equal(validarPctMarkup(0), 0);
    assert.equal(validarPctMarkup(0.2), 0.2);
    assert.equal(validarPctMarkup(0.99), 0.99);
  });
});

describe("13. Ronda 5: resolverLiquidacionServicioPuntual — markup inválido nunca cotiza al 0%", () => {
  const markupsInvalidos: unknown[] = [null, NaN, Infinity, -Infinity, -0.01, 1, 1.5, 100, "0.2"];
  for (const pct_mk of markupsInvalidos) {
    test(`paquete.pct_mk = ${String(pct_mk)} → configuracion_invalida, nunca ok:true con 0% aplicado`, () => {
      const r = resolverLiquidacionServicioPuntual(baseInput({ paquete: { id: 10, pct_mk: pct_mk as number | null } }));
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.tipo, "configuracion_invalida");
    });
  }
  test("pct_mk = 0 (markup real de 0%) SÍ cotiza — total = neto sin margen, nunca se confunde con el markup inválido", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput({ paquete: { id: 10, pct_mk: 0 } }));
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.resultado.total, 200_000); // 2 pax × 100000, sin margen
  });
  test("un markup inválido nunca produce el mismo total que 0% legítimo (prueba que NO se está sustituyendo por 0 en silencio)", () => {
    const rInvalido = resolverLiquidacionServicioPuntual(baseInput({ paquete: { id: 10, pct_mk: NaN } }));
    const rCero = resolverLiquidacionServicioPuntual(baseInput({ paquete: { id: 10, pct_mk: 0 } }));
    assert.equal(rInvalido.ok, false);
    assert.equal(rCero.ok, true);
  });
});

describe("14. Ronda 5: calcularPrecioConModoYMarkup — defensa final, total/costoNeto finitos/seguros/positivos", () => {
  test("pctMk inválido pasado directo (bypass de validarPctMarkup) igual se rechaza — defensa en profundidad", () => {
    const ctx = construirContextoServicios({ paquetes: [PAQUETE], armado: [ARMADO], servicios: [SERVICIO], grupos: [], temporadas: [] });
    assert.equal(calcularPrecioConModoYMarkup(PAR, ctx, FECHA, 1, 2, "persona", NaN), null);
    assert.equal(calcularPrecioConModoYMarkup(PAR, ctx, FECHA, 1, 2, "persona", Infinity), null);
    assert.equal(calcularPrecioConModoYMarkup(PAR, ctx, FECHA, 1, 2, "persona", 1), null);
    assert.equal(calcularPrecioConModoYMarkup(PAR, ctx, FECHA, 1, 2, "persona", -0.5), null);
  });
});

describe("15. Ronda 5: resolverConfiguracionServicio — validador COMPARTIDO por búsqueda y checkout", () => {
  test("paquete o armado ausentes → null", () => {
    assert.equal(resolverConfiguracionServicio(null, ARMADO, PAR), null);
    assert.equal(resolverConfiguracionServicio(PAQUETE, null, PAR), null);
    assert.equal(resolverConfiguracionServicio(null, null, PAR), null);
  });
  test("paquete de otro id (cruzado) → null, aunque armado/par coincidan", () => {
    assert.equal(resolverConfiguracionServicio({ id: 999, pct_mk: 0.2 }, ARMADO, PAR), null);
  });
  test("armado de otro par (cruzado) → null", () => {
    assert.equal(resolverConfiguracionServicio(PAQUETE, { paquete_id: 999, servicio_id: 1, modo: "persona" }, PAR), null);
    assert.equal(resolverConfiguracionServicio(PAQUETE, { paquete_id: 10, servicio_id: 999, modo: "persona" }, PAR), null);
  });
  test("modo inválido → null", () => {
    assert.equal(resolverConfiguracionServicio(PAQUETE, { ...ARMADO, modo: "otro" }, PAR), null);
    assert.equal(resolverConfiguracionServicio(PAQUETE, { ...ARMADO, modo: null }, PAR), null);
  });
  test("markup inválido → null", () => {
    assert.equal(resolverConfiguracionServicio({ id: 10, pct_mk: NaN }, ARMADO, PAR), null);
    assert.equal(resolverConfiguracionServicio({ id: 10, pct_mk: 1 }, ARMADO, PAR), null);
  });
  test("configuración válida → { modo, pctMk }", () => {
    assert.deepEqual(resolverConfiguracionServicio(PAQUETE, ARMADO, PAR), { modo: "persona", pctMk: 0.2 });
  });
});

describe("16. Ronda 5: calcularResultadoServicio (buscarReceptivos) — controles negativos, nunca publica un precio con configuración inválida", () => {
  test("falta paquete (solo armado+servicio) → null, se omite el par, nunca modo 'persona' con 0% implícito", () => {
    const ctx = construirContextoServicios({ paquetes: [], armado: [ARMADO], servicios: [SERVICIO], grupos: [], temporadas: [] });
    assert.equal(calcularResultadoServicio(PAR, ctx, FECHA, 1, 2), null);
  });
  test("falta armado (solo paquete+servicio) → null, se omite el par, nunca cae a modo 'persona'", () => {
    const ctx = construirContextoServicios({ paquetes: [PAQUETE], armado: [], servicios: [SERVICIO], grupos: [], temporadas: [] });
    assert.equal(calcularResultadoServicio(PAR, ctx, FECHA, 1, 2), null);
  });
  test("armado con modo inválido → null, se omite (nunca se muestra un precio calculado como 'persona')", () => {
    const ctx = construirContextoServicios({ paquetes: [PAQUETE], armado: [{ ...ARMADO, modo: "otro" }], servicios: [SERVICIO], grupos: [], temporadas: [] });
    assert.equal(calcularResultadoServicio(PAR, ctx, FECHA, 1, 2), null);
  });
  test("paquete con markup inválido (NaN) → null, se omite (nunca se muestra un precio sin margen real)", () => {
    const ctx = construirContextoServicios({ paquetes: [{ id: 10, pct_mk: NaN }], armado: [ARMADO], servicios: [SERVICIO], grupos: [], temporadas: [] });
    assert.equal(calcularResultadoServicio(PAR, ctx, FECHA, 1, 2), null);
  });
  test("paquete con markup >= 1 → null, se omite (nunca se sustituye por 0% en silencio)", () => {
    const ctx = construirContextoServicios({ paquetes: [{ id: 10, pct_mk: 1 }], armado: [ARMADO], servicios: [SERVICIO], grupos: [], temporadas: [] });
    assert.equal(calcularResultadoServicio(PAR, ctx, FECHA, 1, 2), null);
  });
  test("markup 0% explícito y válido SÍ funciona (no se penaliza un 0% real)", () => {
    const ctx = construirContextoServicios({ paquetes: [{ id: 10, pct_mk: 0 }], armado: [ARMADO], servicios: [SERVICIO], grupos: [], temporadas: [] });
    const r = calcularResultadoServicio(PAR, ctx, FECHA, 1, 2);
    assert.ok(r);
    if (r) assert.equal(r.total, 200_000);
  });
  test("configuración completamente válida (paquete+armado+servicio, modo/markup correctos) SÍ publica un precio", () => {
    const ctx = construirContextoServicios({ paquetes: [PAQUETE], armado: [ARMADO], servicios: [SERVICIO], grupos: [], temporadas: [] });
    const r = calcularResultadoServicio(PAR, ctx, FECHA, 1, 2);
    assert.ok(r);
    if (r) assert.equal(r.total, 250_000); // 2 pax × 100000, marcado al 20%
  });
});

describe("17. Ronda 5: consistencia defensiva del par en resolverLiquidacionServicioPuntual", () => {
  test("paquete.id distinto de par.paqueteId (filas cruzadas) → configuracion_invalida", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput({ paquete: { id: 999, pct_mk: 0.2 } }));
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.tipo, "configuracion_invalida"); assert.match(r.error, /paquete consultado no corresponde/); }
  });
  test("servicio.id distinto de par.servicioId (filas cruzadas) → configuracion_invalida", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput({ servicio: { ...SERVICIO, id: 999 } }));
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.tipo, "configuracion_invalida"); assert.match(r.error, /servicio consultado no corresponde/); }
  });
});
