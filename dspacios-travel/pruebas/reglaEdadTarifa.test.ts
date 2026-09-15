import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarReglaEdadGeneral,
  resolverReglaEdadEfectiva,
  reglasEdadIguales,
  validarRangoReglaEdad,
  resolverReglaEdadEstadia,
  construirReglaEdadDesdeMaximos,
  REGLA_EDAD_DEFAULT,
  type ReglaEdadTarifa,
} from "../lib/calc/reglaEdadTarifa.ts";

// ─────────────────────────────────────────────────────────────────────────
// Pruebas EJECUTABLES del helper puro compartido de regla de edad efectiva
// — ver la cabecera de `lib/calc/reglaEdadTarifa.ts`.
// ─────────────────────────────────────────────────────────────────────────

describe("normalizarReglaEdadGeneral — defaults históricos compatibles", () => {
  test("sin ningún campo (null) → defaults completos", () => {
    assert.deepEqual(normalizarReglaEdadGeneral(null), REGLA_EDAD_DEFAULT);
  });

  test("objeto vacío → defaults completos", () => {
    assert.deepEqual(normalizarReglaEdadGeneral({}), REGLA_EDAD_DEFAULT);
  });

  test("solo infanteMax presente (caso real: computo.ts solo leía edad_infante_max/edad_nino_max) → ninoMin se deriva de infanteMax+1, no de un default fijo", () => {
    const r = normalizarReglaEdadGeneral({ infanteMax: 4 });
    assert.equal(r.infanteMin, 0);
    assert.equal(r.infanteMax, 4);
    assert.equal(r.ninoMin, 5); // infanteMax + 1, NUNCA el default fijo de 3
    assert.equal(r.ninoMax, 10);
  });

  test("todos los campos presentes → se usan tal cual, sin tocar ninguno", () => {
    const r = normalizarReglaEdadGeneral({ infanteMin: 0, infanteMax: 3, ninoMin: 4, ninoMax: 12 });
    assert.deepEqual(r, { infanteMin: 0, infanteMax: 3, ninoMin: 4, ninoMax: 12 });
  });
});

describe("resolverReglaEdadEfectiva — override ?? general ?? default", () => {
  const OVERRIDE: ReglaEdadTarifa = { infanteMin: 0, infanteMax: 3, ninoMin: 4, ninoMax: 12 };

  test("con override de la fila → gana el override, ignora la general por completo", () => {
    const r = resolverReglaEdadEfectiva(OVERRIDE, { infanteMax: 999, ninoMax: 999 });
    assert.deepEqual(r, OVERRIDE);
  });

  test("sin override (null) → cae a la general normalizada", () => {
    const r = resolverReglaEdadEfectiva(null, { infanteMax: 5 });
    assert.equal(r.infanteMax, 5);
    assert.equal(r.ninoMin, 6);
  });

  test("sin override y sin general → defaults históricos completos", () => {
    assert.deepEqual(resolverReglaEdadEfectiva(null, null), REGLA_EDAD_DEFAULT);
  });
});

describe("validarRangoReglaEdad — mismas reglas que el CHECK SQL propuesto (migración 177)", () => {
  test("regla válida (default) → null", () => {
    assert.equal(validarRangoReglaEdad(REGLA_EDAD_DEFAULT), null);
  });

  test("infanteMin distinto de 0 → rechazada", () => {
    assert.match(validarRangoReglaEdad({ infanteMin: 1, infanteMax: 2, ninoMin: 3, ninoMax: 10 })!, /infante.*0/i);
  });

  test("ninoMin que NO es infanteMax+1 (hueco) → rechazada", () => {
    const err = validarRangoReglaEdad({ infanteMin: 0, infanteMax: 2, ninoMin: 5, ninoMax: 10 });
    assert.match(err!, /infanteMax.*\+ 1|esperado 3/);
  });

  test("ninoMin que NO es infanteMax+1 (solape, ninoMin <= infanteMax) → rechazada", () => {
    const err = validarRangoReglaEdad({ infanteMin: 0, infanteMax: 5, ninoMin: 3, ninoMax: 10 });
    assert.notEqual(err, null);
  });

  test("ninoMax menor que ninoMin → rechazada", () => {
    assert.notEqual(validarRangoReglaEdad({ infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax: 2 }), null);
  });

  test("ninoMax mayor a 17 → rechazada", () => {
    assert.notEqual(validarRangoReglaEdad({ infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax: 18 }), null);
  });

  test("ninoMax = 17 exacto → válida (límite inclusive)", () => {
    assert.equal(validarRangoReglaEdad({ infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax: 17 }), null);
  });

  test("infanteMax negativo → rechazada", () => {
    assert.notEqual(validarRangoReglaEdad({ infanteMin: 0, infanteMax: -1, ninoMin: 0, ninoMax: 10 }), null);
  });
});

describe("resolverReglaEdadEstadia — multitemporada, fail-closed", () => {
  test("una sola fila → su regla efectiva, sin comparación", () => {
    const r = resolverReglaEdadEstadia([{ temporada: "ALTA", overrideFila: null }], { infanteMax: 3 });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.regla.infanteMax, 3);
  });

  test("varias filas con la MISMA regla efectiva (todas sin override, mismo general) → pasa", () => {
    const r = resolverReglaEdadEstadia(
      [{ temporada: "ALTA", overrideFila: null }, { temporada: "BAJA", overrideFila: null }],
      { infanteMax: 2, ninoMax: 10 }
    );
    assert.equal(r.ok, true);
  });

  test("una fila con override y otra sin override, pero el override es IDÉNTICO al fallback general → NO bloquea (regla efectiva igual)", () => {
    const general = { infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax: 10 };
    const overrideIdentico: ReglaEdadTarifa = { infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax: 10 };
    const r = resolverReglaEdadEstadia(
      [{ temporada: "ALTA", overrideFila: overrideIdentico }, { temporada: "BAJA", overrideFila: null }],
      general
    );
    assert.equal(r.ok, true, "un override idéntico al fallback general no debe bloquear la estadía");
  });

  test("dos filas con reglas EFECTIVAS distintas → falla cerrado, con las temporadas en el mensaje", () => {
    const r = resolverReglaEdadEstadia(
      [
        { temporada: "ALTA", overrideFila: { infanteMin: 0, infanteMax: 3, ninoMin: 4, ninoMax: 12 } },
        { temporada: "BAJA", overrideFila: null }, // fallback → infanteMax 2, distinto de 3
      ],
      { infanteMax: 2, ninoMax: 10 }
    );
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.deepEqual(r.temporadas, ["ALTA", "BAJA"]);
    assert.match(r.error, /ALTA/);
    assert.match(r.error, /BAJA/);
  });

  test("nunca compara NULL crudo contra override: dos overrides null (ambas fallback) con general distinto en cada llamada siguen usando el MISMO general (no hay ambigüedad de fuente)", () => {
    // Ambas filas son `overrideFila: null` — la única fuente posible es la
    // MISMA `general` (un solo hotel), así que estructuralmente no pueden
    // "diferir" — se confirma que el helper no inventa una comparación falsa.
    const r = resolverReglaEdadEstadia(
      [{ temporada: "A", overrideFila: null }, { temporada: "B", overrideFila: null }],
      { infanteMax: 4 }
    );
    assert.equal(r.ok, true);
  });

  test("sin filas (estadía sin habitaciones resueltas) → regla general normalizada, sin fallar", () => {
    const r = resolverReglaEdadEstadia([], { infanteMax: 5 });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.regla.infanteMax, 5);
  });
});

describe("reglasEdadIguales", () => {
  test("mismos 4 valores → true", () => {
    assert.equal(reglasEdadIguales(REGLA_EDAD_DEFAULT, { ...REGLA_EDAD_DEFAULT }), true);
  });
  test("un solo valor distinto → false", () => {
    assert.equal(reglasEdadIguales(REGLA_EDAD_DEFAULT, { ...REGLA_EDAD_DEFAULT, ninoMax: 11 }), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// `construirReglaEdadDesdeMaximos` — ronda "auditoría Dubai, hallazgo #3
// (UX de rangos)": el operador SOLO escribe infanteMax/ninoMax; infanteMin
// (siempre 0) y ninoMin (siempre infanteMax+1) son SIEMPRE derivados por
// esta función — única fuente de la derivación, usada por
// `CalculadoraEditor.tsx` (bases y promociones).
// ─────────────────────────────────────────────────────────────────────────
describe("construirReglaEdadDesdeMaximos — infanteMin/ninoMin SIEMPRE derivados", () => {
  test("infanteMax=2, ninoMax=10 → {0, 2, 3, 10} (mismo default histórico)", () => {
    assert.deepEqual(construirReglaEdadDesdeMaximos(2, 10), { infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax: 10 });
  });

  test("infanteMin es SIEMPRE 0, sin importar el infanteMax", () => {
    assert.equal(construirReglaEdadDesdeMaximos(5, 12).infanteMin, 0);
    assert.equal(construirReglaEdadDesdeMaximos(0, 5).infanteMin, 0);
  });

  test("ninoMin es SIEMPRE infanteMax + 1 — nunca un hueco ni un solape posible por construcción", () => {
    assert.equal(construirReglaEdadDesdeMaximos(4, 9).ninoMin, 5);
    assert.equal(construirReglaEdadDesdeMaximos(0, 3).ninoMin, 1);
  });

  test("cambiar SOLO infanteMax recalcula ninoMin automáticamente, sin que el operador lo escriba (simula 'ninoMin se recalcula al cambiar infanteMax')", () => {
    // Estado previo: infanteMax=2 → ninoMin=3 (como en el editor, antes de tocar nada).
    const previa = construirReglaEdadDesdeMaximos(2, 10);
    assert.equal(previa.ninoMin, 3);
    // El operador sube infanteMax a 4 (ninoMax se mantiene en 10, como haría
    // `setBaseEdad`/`setPromoEdad` al recibir solo el campo "infanteMax").
    const actualizada = construirReglaEdadDesdeMaximos(4, previa.ninoMax);
    assert.equal(actualizada.ninoMin, 5, "ninoMin debe recalcularse a infanteMax+1 = 5, nunca quedar en el 3 anterior");
    assert.equal(actualizada.infanteMin, 0);
    assert.equal(actualizada.ninoMax, 10, "ninoMax no cambia al editar infanteMax");
  });

  test("el resultado siempre pasa validarRangoReglaEdad (nunca produce un rango que el CHECK rechazaría)", () => {
    for (const [infanteMax, ninoMax] of [[0, 1], [2, 10], [5, 17], [0, 17]] as const) {
      const regla = construirReglaEdadDesdeMaximos(infanteMax, ninoMax);
      assert.equal(validarRangoReglaEdad(regla), null, `infanteMax=${infanteMax}, ninoMax=${ninoMax} debería ser válido`);
    }
  });

  test("compatibilidad histórica: sin importar qué ninoMin/infanteMin traiga cargado un registro previo, derivar desde su infanteMax/ninoMax SIEMPRE produce la regla correcta del contrato actual", () => {
    // Simula un registro histórico "corrupto" o de un contrato anterior —
    // ninoMin no coincide con infanteMax+1. `construirReglaEdadDesdeMaximos`
    // nunca lee infanteMin/ninoMin de ese objeto, solo los máximos: el
    // resultado siempre es consistente con el contrato actual.
    const historicoInconsistente = { infanteMin: 1, infanteMax: 3, ninoMin: 99, ninoMax: 12 };
    const derivada = construirReglaEdadDesdeMaximos(historicoInconsistente.infanteMax, historicoInconsistente.ninoMax);
    assert.deepEqual(derivada, { infanteMin: 0, infanteMax: 3, ninoMin: 4, ninoMax: 12 });
  });
});
