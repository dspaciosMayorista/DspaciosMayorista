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
  respuestaPublicaServicioPuntual,
  formatearLogLiquidacionServicioPuntual,
  fallaErrorConsulta,
  type DatosServicioPar,
  type FilaPaquete,
  type FilaArmadoServicio,
  type FilaServicioAdicional,
  type ResultadoServicioPuntual,
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
    if (!r.ok) { assert.equal(r.tipo, "configuracion_invalida"); assert.match(r.detalleInterno, /no coincide con par/); }
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
    if (!r.ok) { assert.equal(r.tipo, "configuracion_invalida"); assert.match(r.detalleInterno, /no coincide con par\.paqueteId/); }
  });
  test("servicio.id distinto de par.servicioId (filas cruzadas) → configuracion_invalida", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput({ servicio: { ...SERVICIO, id: 999 } }));
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.tipo, "configuracion_invalida"); assert.match(r.detalleInterno, /no coincide con par\.servicioId/); }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ronda 6 — "ERROR INTERNO DE SUPABASE EXPUESTO AL CLIENTE". El `error` de
// las rondas 4/5 concatenaba texto REAL de Supabase (`${input.paqueteError}`,
// etc.) directo en el string que terminaba devuelto por la Server Action
// pública — una llamada anónima podía ver mensajes técnicos de Postgres
// (nombres de relación/tabla/columna, "permission denied", etc.). Ahora
// `ResultadoServicioPuntual` separa `mensajePublico` (fijo, controlado) de
// `detalleInterno` (solo logging server-side), y `respuestaPublicaServicioPuntual`
// es la frontera que DESCARTA `detalleInterno` antes de que cualquier cosa
// cruce hacia el navegador. Estas pruebas ejecutan la lógica REAL con textos
// de error de Postgres realistas y confirman que nunca sobreviven a la
// traducción pública, pero sí quedan disponibles para el log.
// ───────────────────────────────────────────────────────────────────────────

const ERRORES_POSTGRES_REALISTAS = [
  'relation "armado_servicios" does not exist',
  "permission denied for table armado_paquetes",
  "permission denied for table servicios_adicionales",
  'column "pct_mk" does not exist',
  "column pct_mk does not exist",
  "new row violates row-level security policy for table \"servicio_temporadas\"",
];

describe("18. Ronda 6: error_consulta — un mensaje de Postgres realista NUNCA sobrevive a mensajePublico", () => {
  const campos: (keyof ReturnType<typeof baseInput>)[] = [
    "filaTarifarioError", "paqueteError", "armadoError", "servicioError", "gruposError", "temporadasError",
  ];
  for (const campo of campos) {
    for (const detalle of ERRORES_POSTGRES_REALISTAS) {
      test(`${campo} = ${JSON.stringify(detalle)} → mensajePublico es el texto fijo, detalleInterno SÍ lo conserva`, () => {
        const r = resolverLiquidacionServicioPuntual(baseInput({ [campo]: detalle } as Partial<Parameters<typeof resolverLiquidacionServicioPuntual>[0]>));
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.tipo, "error_consulta");
        assert.equal(r.mensajePublico, "No pudimos validar el servicio en este momento. Intenta nuevamente.");
        assert.doesNotMatch(r.mensajePublico, /armado_servicios|armado_paquetes|servicios_adicionales|pct_mk|relation|permission denied|row-level security|policy/i);
        // El detalle SÍ debe conservarse — es lo que se registra en el log.
        assert.match(r.detalleInterno, new RegExp(detalle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.ok(typeof r.codigo === "string" && r.codigo.length > 0);
      });
    }
  }
});

describe("19. Ronda 6: configuracion_invalida — nunca expone nombres de tabla/columna ni valores de configuración", () => {
  test("modo inválido: mensajePublico es el texto fijo, nunca menciona armado_servicios ni el valor real de modo", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput({ armado: { ...ARMADO, modo: "'; DROP TABLE armado_servicios; --" } }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.tipo, "configuracion_invalida");
    assert.equal(r.mensajePublico, "Este servicio requiere una revisión interna antes de poder cotizarse.");
    assert.doesNotMatch(r.mensajePublico, /armado_servicios|DROP TABLE|modo/i);
    assert.match(r.detalleInterno, /armado_servicios\.modo/); // el detalle técnico SÍ vive acá, para el log
  });
  test("markup inválido: mensajePublico es el texto fijo, nunca menciona pct_mk ni armado_paquetes", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput({ paquete: { id: 10, pct_mk: NaN } }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.mensajePublico, "Este servicio requiere una revisión interna antes de poder cotizarse.");
    assert.doesNotMatch(r.mensajePublico, /pct_mk|armado_paquetes/i);
  });
  test("paquete/armado ausentes: mensajePublico nunca menciona 'armado_servicios' aunque el detalle interno sí lo haga", () => {
    const rPaquete = resolverLiquidacionServicioPuntual(baseInput({ paquete: null }));
    const rArmado = resolverLiquidacionServicioPuntual(baseInput({ armado: null }));
    for (const r of [rPaquete, rArmado]) {
      assert.equal(r.ok, false);
      if (r.ok) continue;
      assert.equal(r.mensajePublico, "Este servicio requiere una revisión interna antes de poder cotizarse.");
      assert.doesNotMatch(r.mensajePublico, /armado_servicios|armado_paquetes/i);
    }
  });
  test("todos los códigos de configuracion_invalida son distintos entre sí y estables (identificables para el log)", () => {
    const casos: ResultadoServicioPuntual[] = [
      resolverLiquidacionServicioPuntual(baseInput({ paquete: null })),
      resolverLiquidacionServicioPuntual(baseInput({ armado: null })),
      resolverLiquidacionServicioPuntual(baseInput({ paquete: { id: 999, pct_mk: 0.2 } })),
      resolverLiquidacionServicioPuntual(baseInput({ servicio: { ...SERVICIO, id: 999 } })),
      resolverLiquidacionServicioPuntual(baseInput({ armado: { paquete_id: 999, servicio_id: 1, modo: "persona" } })),
      resolverLiquidacionServicioPuntual(baseInput({ armado: { ...ARMADO, modo: "otro" } })),
      resolverLiquidacionServicioPuntual(baseInput({ paquete: { id: 10, pct_mk: NaN } })),
    ];
    const codigos = casos.map((r) => (r.ok ? null : r.codigo));
    assert.equal(new Set(codigos).size, codigos.length, "cada motivo de configuracion_invalida debe tener su propio código, sin colisiones");
    assert.ok(codigos.every((c) => typeof c === "string"));
  });
});

describe("20. Ronda 6: respuestaPublicaServicioPuntual — la frontera pública SIEMPRE descarta detalleInterno", () => {
  test("camino ok:true — pasa el resultado tal cual, sin campos internos de más", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput());
    const publico = respuestaPublicaServicioPuntual(r);
    assert.equal(publico.ok, true);
    if (publico.ok) {
      assert.deepEqual(Object.keys(publico).sort(), ["ok", "resultado"]);
    }
  });
  test("camino ok:false — el objeto público NUNCA tiene la clave detalleInterno, sin importar el caso", () => {
    const casos = [
      baseInput({ paqueteError: "relation \"armado_paquetes\" does not exist" }),
      baseInput({ paquete: null }),
      baseInput({ armado: { ...ARMADO, modo: "otro" } }),
      baseInput({ filaTarifarioEncontrada: false }),
    ];
    for (const input of casos) {
      const interno = resolverLiquidacionServicioPuntual(input);
      const publico = respuestaPublicaServicioPuntual(interno);
      assert.equal(publico.ok, false);
      if (publico.ok) continue;
      assert.deepEqual(Object.keys(publico).sort(), ["codigo", "mensaje", "ok", "tipo"]);
      assert.ok(!("detalleInterno" in publico));
      assert.ok(!("mensajePublico" in publico)); // se renombra a `mensaje`, no se duplica
    }
  });
  test("fuzz: un ResultadoServicioPuntual construido a mano con detalleInterno realista de Postgres nunca deja rastro en JSON.stringify del resultado público", () => {
    const interno: ResultadoServicioPuntual = {
      ok: false, tipo: "error_consulta", codigo: "paquete_consulta_fallida",
      mensajePublico: "No pudimos validar el servicio en este momento. Intenta nuevamente.",
      detalleInterno: 'armado_paquetes: relation "armado_paquetes" does not exist, permission denied for schema public, column "pct_mk" does not exist',
    };
    const publico = respuestaPublicaServicioPuntual(interno);
    const serializado = JSON.stringify(publico);
    assert.doesNotMatch(serializado, /armado_paquetes|relation|permission denied|schema public|pct_mk/i);
    assert.match(serializado, /paquete_consulta_fallida/); // el código SÍ sobrevive, es seguro
  });
});

describe("21. Ronda 6: formatearLogLiquidacionServicioPuntual — el log SÍ conserva el detalle técnico completo y el código", () => {
  test("la línea de log incluye tipo/código/ids/detalle técnico completo, para poder investigar el incidente real", () => {
    const linea = formatearLogLiquidacionServicioPuntual({
      servicioId: 42, paqueteId: 7, tipo: "error_consulta", codigo: "armado_consulta_fallida",
      detalle: 'armado_servicios: permission denied for table armado_servicios',
    });
    assert.match(linea, /servicioId=42/);
    assert.match(linea, /paqueteId=7/);
    assert.match(linea, /tipo=error_consulta/);
    assert.match(linea, /codigo=armado_consulta_fallida/);
    assert.match(linea, /permission denied for table armado_servicios/);
  });
  test("la firma de la función solo acepta contexto de catálogo (servicioId/paqueteId/tipo/codigo/detalle) — no hay forma de pasarle nombre/documento/teléfono/email del cliente", () => {
    // Prueba estructural: el objeto de entrada declarado no tiene ningún campo
    // de cliente — si alguien intentara agregar datos del cliente al log
    // tendría que ampliar esta firma explícitamente (revisión obligada).
    const linea = formatearLogLiquidacionServicioPuntual({ servicioId: 1, paqueteId: 1, tipo: "no_disponible", codigo: "sin_tarifa_vigente", detalle: "x" });
    assert.equal(typeof linea, "string");
  });
});

describe("22. Ronda 6: fallaErrorConsulta (usado por cotizar.ts para el caso 'falta service-role') respeta el mismo mensaje público fijo", () => {
  test("cualquier código/detalle produce el mismo mensajePublico exacto que el resto de error_consulta", () => {
    const r = fallaErrorConsulta("service_role_faltante", "SUPABASE_SERVICE_ROLE_KEY no configurada");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.tipo, "error_consulta");
    assert.equal(r.codigo, "service_role_faltante");
    assert.equal(r.mensajePublico, "No pudimos validar el servicio en este momento. Intenta nuevamente.");
    assert.doesNotMatch(r.mensajePublico, /SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("23. Ronda 6: los mensajes públicos son EXACTAMENTE los pedidos, palabra por palabra, y consistentes entre causas distintas", () => {
  test("error_consulta: mismo texto exacto sin importar cuál de las 6 consultas falló", () => {
    const mensajes = new Set([
      resolverLiquidacionServicioPuntual(baseInput({ filaTarifarioError: "x" })),
      resolverLiquidacionServicioPuntual(baseInput({ paqueteError: "y" })),
      resolverLiquidacionServicioPuntual(baseInput({ armadoError: "z" })),
      resolverLiquidacionServicioPuntual(baseInput({ servicioError: "w" })),
      resolverLiquidacionServicioPuntual(baseInput({ gruposError: "v" })),
      resolverLiquidacionServicioPuntual(baseInput({ temporadasError: "u" })),
    ].map((r) => (r.ok ? null : r.mensajePublico)));
    assert.equal(mensajes.size, 1);
    assert.deepEqual([...mensajes], ["No pudimos validar el servicio en este momento. Intenta nuevamente."]);
  });
  test("configuracion_invalida: mismo texto exacto sin importar cuál pieza de configuración era inválida", () => {
    const mensajes = new Set([
      resolverLiquidacionServicioPuntual(baseInput({ paquete: null })),
      resolverLiquidacionServicioPuntual(baseInput({ armado: null })),
      resolverLiquidacionServicioPuntual(baseInput({ armado: { ...ARMADO, modo: "otro" } })),
      resolverLiquidacionServicioPuntual(baseInput({ paquete: { id: 10, pct_mk: NaN } })),
    ].map((r) => (r.ok ? null : r.mensajePublico)));
    assert.equal(mensajes.size, 1);
    assert.deepEqual([...mensajes], ["Este servicio requiere una revisión interna antes de poder cotizarse."]);
  });
  test("no_disponible: mensajes comerciales claros, ya sin detalle técnico (se mantiene el criterio previo)", () => {
    const r = resolverLiquidacionServicioPuntual(baseInput({ filaTarifarioEncontrada: false }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.doesNotMatch(r.mensajePublico, /armado_servicios|armado_paquetes|tarifario_resultado|relation|permission denied/i);
  });
});
