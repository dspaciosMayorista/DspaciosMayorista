import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  extraerCondicionesTarifa, normalizarCondicionesTarifaJSON, resolverCondicionesTarifaParaConversion,
  condicionesTarifaParaRender, type FilaTarifaHotelNotaCruda, type HotelSnapConRef,
} from "../lib/calc/condicionesTarifa.ts";

// ─────────────────────────────────────────────────────────────────────────
// `extraerCondicionesTarifa` — transporta `tarifa_hotel.notas` (texto libre
// de condiciones comerciales, ej. "No reembolsable") desde el motor de
// reserva hasta la cotización/contrato, sin tocar ningún cálculo financiero.
// Reusa la MISMA identidad de temporadas que ya usa la regla de edad
// (`temporadasTarifaPorAcom`/`temporadasUsadas`) — nunca una resolución
// paralela.
// ─────────────────────────────────────────────────────────────────────────

function fila(ov: Partial<FilaTarifaHotelNotaCruda> = {}): FilaTarifaHotelNotaCruda {
  return { tipo_habitacion: "Estandar", alimentacion: "PC", temporada: "ALTA", notas: null, ...ov };
}

describe("1. Una temporada con nota → una condición", () => {
  test("fila con notas no vacías, temporada usada → aparece", () => {
    const r = extraerCondicionesTarifa({
      filas: [fila({ notas: "No reembolsable." })],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"],
    });
    assert.deepEqual(r, [{ temporada: "ALTA", texto: "No reembolsable." }]);
  });
});

describe("2. Nota NULL/vacía/solo-espacios se ignora", () => {
  test("notas: null → no produce condición", () => {
    const r = extraerCondicionesTarifa({ filas: [fila({ notas: null })], categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"] });
    assert.deepEqual(r, []);
  });
  test("notas: '' → no produce condición", () => {
    const r = extraerCondicionesTarifa({ filas: [fila({ notas: "" })], categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"] });
    assert.deepEqual(r, []);
  });
  test("notas: '   ' (solo espacios) → no produce condición", () => {
    const r = extraerCondicionesTarifa({ filas: [fila({ notas: "   " })], categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"] });
    assert.deepEqual(r, []);
  });
  test("notas con espacios al borde → se aplica trim en el texto conservado", () => {
    const r = extraerCondicionesTarifa({ filas: [fila({ notas: "  No reembolsable.  " })], categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"] });
    assert.deepEqual(r, [{ temporada: "ALTA", texto: "No reembolsable." }]);
  });
});

describe("3. Deduplicación por temporada + texto normalizado", () => {
  test("la MISMA temporada aparece dos veces en las filas (ej. dato duplicado) con el mismo texto → una sola condición", () => {
    const r = extraerCondicionesTarifa({
      filas: [fila({ notas: "No reembolsable." }), fila({ notas: "No reembolsable." })],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"],
    });
    assert.equal(r.length, 1);
  });
  test("dedup es case-insensitive en la comparación, pero conserva la forma original del primer texto visto", () => {
    const r = extraerCondicionesTarifa({
      filas: [fila({ notas: "No reembolsable." }), fila({ notas: "NO REEMBOLSABLE." })],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"],
    });
    assert.equal(r.length, 1);
    assert.equal(r[0].texto, "No reembolsable.");
  });
  test("dos temporadas DISTINTAS con la MISMA nota → ambas entradas del motor (nunca colapsadas acá; la agrupación por texto es responsabilidad del render, ver ContratoDocumento.tsx)", () => {
    const r = extraerCondicionesTarifa({
      filas: [fila({ temporada: "ALTA", notas: "No reembolsable." }), fila({ temporada: "MEDIA", notas: "No reembolsable." })],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA", "MEDIA"],
    });
    assert.equal(r.length, 2);
    assert.deepEqual(r.map((c) => c.temporada).sort(), ["ALTA", "MEDIA"]);
    assert.ok(r.every((c) => c.texto === "No reembolsable."));
  });
});

describe("4. Dos temporadas con notas DIFERENTES → ambas visibles", () => {
  test("temporadas distintas, textos distintos → 2 condiciones, orden determinista (temporada asc, luego texto asc)", () => {
    const r = extraerCondicionesTarifa({
      filas: [
        fila({ temporada: "MEDIA", notas: "Incluye desayuno." }),
        fila({ temporada: "ALTA", notas: "No reembolsable." }),
      ],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA", "MEDIA"],
    });
    assert.deepEqual(r, [
      { temporada: "ALTA", texto: "No reembolsable." },
      { temporada: "MEDIA", texto: "Incluye desayuno." },
    ]);
  });
  test("misma temporada, dos textos distintos (fila corrupta con dos notas) → ambos visibles, orden por texto", () => {
    const r = extraerCondicionesTarifa({
      filas: [fila({ temporada: "ALTA", notas: "Z texto" }), fila({ temporada: "ALTA", notas: "A texto" })],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"],
    });
    assert.deepEqual(r.map((c) => c.texto), ["A texto", "Z texto"]);
  });
});

describe("5. Acomodación no seleccionada nunca aporta nota (vía temporadasUsadas)", () => {
  test("una temporada que solo usó 'triple' (no seleccionada) nunca entra si temporadasUsadas no la incluye", () => {
    // Simula: el hotel tiene una fila ALTA (seleccionada, doble) y otra
    // SOLO_TRIPLE (temporada exclusiva de una acomodación NO pedida) — el
    // llamador (computo.ts) nunca la incluye en temporadasUsadas.
    const r = extraerCondicionesTarifa({
      filas: [
        fila({ temporada: "ALTA", notas: "Condición de doble." }),
        fila({ temporada: "SOLO_TRIPLE", notas: "Condición de triple — NUNCA debe aparecer." }),
      ],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"], // triple nunca se pidió
    });
    assert.deepEqual(r, [{ temporada: "ALTA", texto: "Condición de doble." }]);
  });
});

describe("6. Promoción/temporada no aplicada nunca aporta nota", () => {
  test("una promoción cargada en tarifa_hotel pero que NO liquidó ninguna noche de esta estadía (fuera de temporadasUsadas) se ignora", () => {
    const r = extraerCondicionesTarifa({
      filas: [
        fila({ temporada: "ALTA", notas: "Condición de la temporada real." }),
        fila({ temporada: "PROMO_NO_APLICADA", notas: "Promoción que NO participó — NUNCA debe aparecer." }),
      ],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"],
    });
    assert.equal(r.length, 1);
    assert.equal(r[0].texto, "Condición de la temporada real.");
  });

  test("temporadasUsadas vacío (ninguna acomodación seleccionada resolvió temporada) → nunca produce condiciones, sin importar cuántas filas traigan notas", () => {
    const r = extraerCondicionesTarifa({
      filas: [fila({ notas: "No debería aparecer nunca." })],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: [],
    });
    assert.deepEqual(r, []);
  });
});

describe("7. Identidad hotel/categoría/régimen — nunca mezcla filas de otro combo", () => {
  test("una fila de OTRA categoría (misma temporada) no se incluye", () => {
    const r = extraerCondicionesTarifa({
      filas: [fila({ tipo_habitacion: "Suite", notas: "Condición de Suite — no debe mezclarse." })],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"],
    });
    assert.deepEqual(r, []);
  });
  test("una fila de OTRO régimen (mismo hotel/categoría/temporada) no se incluye", () => {
    const r = extraerCondicionesTarifa({
      filas: [fila({ alimentacion: "PAM", notas: "Condición de PAM — no debe mezclarse." })],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"],
    });
    assert.deepEqual(r, []);
  });

  test("dos 'hoteles' (llamadas independientes con filas propias) nunca comparten estado — cada llamada es una función pura sin memoria compartida", () => {
    const rHotelA = extraerCondicionesTarifa({
      filas: [fila({ temporada: "ALTA", notas: "Condición hotel A." })],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"],
    });
    const rHotelB = extraerCondicionesTarifa({
      filas: [fila({ temporada: "ALTA", notas: "Condición hotel B." })],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"],
    });
    assert.deepEqual(rHotelA, [{ temporada: "ALTA", texto: "Condición hotel A." }]);
    assert.deepEqual(rHotelB, [{ temporada: "ALTA", texto: "Condición hotel B." }]);
  });
});

describe("8. Nunca lee identidad desde niño/niño2/infante — depende SOLO de temporadasUsadas (ya filtrado aguas arriba)", () => {
  test("el mismo texto de nota vive en la fila de HABITACIÓN, no en una fila aparte de niño — la función no tiene ningún concepto de acomodación, solo confía en temporadasUsadas", () => {
    // Esta prueba documenta el contrato: `extraerCondicionesTarifa` no
    // filtra por acomodación porque NO LA CONOCE — el filtrado ya ocurrió
    // en el llamador al construir `temporadasUsadas` desde
    // `temporadasTarifaPorAcom` (solo acomodaciones de HABITACIÓN, nunca
    // nino/nino2/infante). Acá solo se verifica que, dada la MISMA fila
    // (que trae netos de sencilla/doble/triple/niño/infante TODOS juntos,
    // como en la tabla real), el texto se extrae una sola vez por fila.
    const r = extraerCondicionesTarifa({
      filas: [fila({ temporada: "ALTA", notas: "Aplica a toda la fila (todas las acomodaciones)." })],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"],
    });
    assert.equal(r.length, 1);
  });
});

describe("9. Ninguna fuga de campos privados — el tipo de salida es estructural", () => {
  test("cada condición SOLO tiene { temporada, texto } — ninguna otra clave", () => {
    const r = extraerCondicionesTarifa({
      filas: [fila({ notas: "No reembolsable." })],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: ["ALTA"],
    });
    assert.deepEqual(Object.keys(r[0]).sort(), ["temporada", "texto"]);
  });
});

describe("10. Deduplicación con clave ESTRUCTURADA — nunca colisión falsa por concatenación con '|'", () => {
  test("temporada='A|B', texto='C' NO colisiona con temporada='A', texto='B|C' (ambas deben sobrevivir, la concatenación con '|' las habría fundido en una)", () => {
    const r = extraerCondicionesTarifa({
      filas: [
        fila({ temporada: "A|B", notas: "C" }),
        fila({ temporada: "A", notas: "B|C" }),
      ],
      categoria: "Estandar", regimen: "PC", temporadasUsadas: ["A|B", "A"],
    });
    assert.equal(r.length, 2, "con concatenación '|' ambas colapsarían a la misma clave 'A|B|C' — con JSON.stringify([temporada,texto]) son claves distintas");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// `normalizarCondicionesTarifaJSON` — puerta de entrada ÚNICA para tratar
// JSON `unknown` (ya persistido/leído de vuelta) como `CondicionTarifaAplicada[]`.
// ─────────────────────────────────────────────────────────────────────────
describe("normalizarCondicionesTarifaJSON — forma global", () => {
  test("undefined → ok:true, [] (ausencia legítima, nunca un rechazo)", () => {
    const r = normalizarCondicionesTarifaJSON(undefined);
    assert.deepEqual(r, { ok: true, condiciones: [] });
  });
  test("null → ok:true, [] (mismo criterio que undefined)", () => {
    const r = normalizarCondicionesTarifaJSON(null);
    assert.deepEqual(r, { ok: true, condiciones: [] });
  });
  test("un objeto (no arreglo) → ok:false, RECHAZO explícito", () => {
    const r = normalizarCondicionesTarifaJSON({ temporada: "ALTA", texto: "x" });
    assert.equal(r.ok, false);
  });
  test("un string → ok:false, RECHAZO explícito", () => {
    const r = normalizarCondicionesTarifaJSON("No reembolsable");
    assert.equal(r.ok, false);
  });
  test("un número → ok:false, RECHAZO explícito", () => {
    const r = normalizarCondicionesTarifaJSON(42);
    assert.equal(r.ok, false);
  });
  test("un arreglo vacío → ok:true, [] (respuesta válida: hay snapshot, cero condiciones)", () => {
    const r = normalizarCondicionesTarifaJSON([]);
    assert.deepEqual(r, { ok: true, condiciones: [] });
  });
});

describe("normalizarCondicionesTarifaJSON — elementos individuales dentro de un arreglo válido", () => {
  test("un elemento bien formado se conserva", () => {
    const r = normalizarCondicionesTarifaJSON([{ temporada: "ALTA", texto: "No reembolsable." }]);
    assert.deepEqual(r, { ok: true, condiciones: [{ temporada: "ALTA", texto: "No reembolsable." }] });
  });
  test("un elemento que NO es objeto (string/número/arreglo/null) se DESCARTA, sin tumbar el resto del arreglo", () => {
    const r = normalizarCondicionesTarifaJSON([
      "no es un objeto",
      42,
      null,
      ["tampoco"],
      { temporada: "ALTA", texto: "válida" },
    ]);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.condiciones, [{ temporada: "ALTA", texto: "válida" }]);
  });
  test("temporada vacía/solo-espacios se descarta (el elemento, no el arreglo)", () => {
    const r = normalizarCondicionesTarifaJSON([{ temporada: "   ", texto: "x" }, { temporada: "ALTA", texto: "y" }]);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.condiciones, [{ temporada: "ALTA", texto: "y" }]);
  });
  test("texto vacío/solo-espacios se descarta (el elemento, no el arreglo)", () => {
    const r = normalizarCondicionesTarifaJSON([{ temporada: "ALTA", texto: "   " }, { temporada: "ALTA", texto: "y" }]);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.condiciones, [{ temporada: "ALTA", texto: "y" }]);
  });
  test("temporada/texto NO strings (número/booleano/objeto) se descartan", () => {
    const r = normalizarCondicionesTarifaJSON([
      { temporada: 123, texto: "x" },
      { temporada: "ALTA", texto: true },
      { temporada: "ALTA", texto: "y" },
    ]);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.condiciones, [{ temporada: "ALTA", texto: "y" }]);
  });
  test("claves privadas adicionales (costo/neto/comisión/proveedor/id) se ELIMINAN — el objeto se reconstruye desde cero", () => {
    const r = normalizarCondicionesTarifaJSON([
      { temporada: "ALTA", texto: "No reembolsable.", costo: 100000, neto: 90000, comision: 5000, proveedorId: 7, hotelId: 99 },
    ]);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.condiciones.length, 1);
      assert.deepEqual(Object.keys(r.condiciones[0]).sort(), ["temporada", "texto"]);
      assert.deepEqual(r.condiciones[0], { temporada: "ALTA", texto: "No reembolsable." });
    }
  });
  test("aplica trim al leer temporada/texto", () => {
    const r = normalizarCondicionesTarifaJSON([{ temporada: "  ALTA  ", texto: "  No reembolsable.  " }]);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.condiciones, [{ temporada: "ALTA", texto: "No reembolsable." }]);
  });
  test("deduplica por tupla estructurada y ordena determinísticamente", () => {
    const r = normalizarCondicionesTarifaJSON([
      { temporada: "MEDIA", texto: "Z" },
      { temporada: "ALTA", texto: "B" },
      { temporada: "ALTA", texto: "b" }, // duplicado case-insensitive de la anterior
      { temporada: "ALTA", texto: "A" },
    ]);
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(r.condiciones, [
        { temporada: "ALTA", texto: "A" },
        { temporada: "ALTA", texto: "B" },
        { temporada: "MEDIA", texto: "Z" },
      ]);
    }
  });
});

describe("condicionesTarifaParaRender — nunca rechaza, siempre devuelve un arreglo (nunca tumba una página de cliente)", () => {
  test("forma inválida (objeto/string/número) → [] silencioso, nunca lanza ni propaga el error", () => {
    assert.deepEqual(condicionesTarifaParaRender({ no: "es un arreglo" }), []);
    assert.deepEqual(condicionesTarifaParaRender("texto suelto"), []);
    assert.deepEqual(condicionesTarifaParaRender(42), []);
  });
  test("null/undefined → [] (contrato histórico)", () => {
    assert.deepEqual(condicionesTarifaParaRender(null), []);
    assert.deepEqual(condicionesTarifaParaRender(undefined), []);
  });
  test("forma válida → se normaliza igual que el modo estricto", () => {
    assert.deepEqual(condicionesTarifaParaRender([{ temporada: "ALTA", texto: "x", costo: 1 }]), [{ temporada: "ALTA", texto: "x" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// `resolverCondicionesTarifaParaConversion` — correlación por REFERENCIA
// ESTABLE (nunca posición/hIdx/nombre/hotelId+categoría). Cubre íntegro el
// hallazgo #1 del encargo.
// ─────────────────────────────────────────────────────────────────────────
function hotelSnap(ov: Partial<HotelSnapConRef> = {}): HotelSnapConRef {
  return { ref: "item-0", condiciones_tarifa: [{ temporada: "ALTA", texto: "x" }], ...ov };
}

describe("resolverCondicionesTarifaParaConversion — histórica sin referencia", () => {
  test("ref undefined → ok:true, condiciones:null (nunca se adivina, nunca falla)", () => {
    const r = resolverCondicionesTarifaParaConversion([hotelSnap()], undefined);
    assert.deepEqual(r, { ok: true, condiciones: null });
  });
  test("ref null → mismo criterio que undefined", () => {
    const r = resolverCondicionesTarifaParaConversion([hotelSnap()], null);
    assert.deepEqual(r, { ok: true, condiciones: null });
  });
  test("ref vacío ('') → mismo criterio (string vacía se trata como ausente)", () => {
    const r = resolverCondicionesTarifaParaConversion([hotelSnap()], "");
    assert.deepEqual(r, { ok: true, condiciones: null });
  });
});

describe("resolverCondicionesTarifaParaConversion — referencia moderna, match único", () => {
  test("ref presente con exactamente un match → copia sus condiciones normalizadas", () => {
    const r = resolverCondicionesTarifaParaConversion(
      [hotelSnap({ ref: "item-0", condiciones_tarifa: [{ temporada: "ALTA", texto: "No reembolsable." }] })],
      "item-0"
    );
    assert.deepEqual(r, { ok: true, condiciones: [{ temporada: "ALTA", texto: "No reembolsable." }] });
  });
  test("match único con condiciones_tarifa = [] → ok:true, condiciones:[] (snapshot real, cero condiciones — distinto de 'sin snapshot')", () => {
    const r = resolverCondicionesTarifaParaConversion([hotelSnap({ ref: "item-0", condiciones_tarifa: [] })], "item-0");
    assert.deepEqual(r, { ok: true, condiciones: [] });
  });
});

describe("resolverCondicionesTarifaParaConversion — dos hoteles con el MISMO NOMBRE (la identidad nunca es el nombre)", () => {
  test("dos entradas del snapshot con el mismo 'nombre' pero refs distintos → cada ref resuelve SU propio snapshot, sin cruzarse", () => {
    const snap: (HotelSnapConRef & { nombre?: string })[] = [
      { ref: "item-0", nombre: "Hotel Caribe", condiciones_tarifa: [{ temporada: "ALTA", texto: "Condición A." }] },
      { ref: "item-1", nombre: "Hotel Caribe", condiciones_tarifa: [{ temporada: "ALTA", texto: "Condición B." }] },
    ];
    const r0 = resolverCondicionesTarifaParaConversion(snap, "item-0");
    const r1 = resolverCondicionesTarifaParaConversion(snap, "item-1");
    assert.deepEqual(r0, { ok: true, condiciones: [{ temporada: "ALTA", texto: "Condición A." }] });
    assert.deepEqual(r1, { ok: true, condiciones: [{ temporada: "ALTA", texto: "Condición B." }] });
  });
});

describe("resolverCondicionesTarifaParaConversion — el MISMO hotel dos veces con fechas distintas", () => {
  test("dos entradas del mismo hotelId+categoría (dos estadías distintas del mismo hotel en el carrito) → refs distintos las distinguen sin ambigüedad", () => {
    const snap: (HotelSnapConRef & { hotelId?: number; fecha_ingreso?: string })[] = [
      { ref: "item-0", hotelId: 42, fecha_ingreso: "2026-09-01", condiciones_tarifa: [{ temporada: "ALTA", texto: "Estadía 1." }] },
      { ref: "item-1", hotelId: 42, fecha_ingreso: "2026-12-01", condiciones_tarifa: [{ temporada: "BAJA", texto: "Estadía 2." }] },
    ];
    assert.deepEqual(resolverCondicionesTarifaParaConversion(snap, "item-0"), { ok: true, condiciones: [{ temporada: "ALTA", texto: "Estadía 1." }] });
    assert.deepEqual(resolverCondicionesTarifaParaConversion(snap, "item-1"), { ok: true, condiciones: [{ temporada: "BAJA", texto: "Estadía 2." }] });
  });
});

describe("resolverCondicionesTarifaParaConversion — agrupación 'todo' y 'por_destino', hIdx reiniciado entre grupos NUNCA cruza condiciones", () => {
  test("simula 2 grupos (agrupar:'por_destino') cuyo hIdx local se reinicia en 0 cada uno — la resolución por ref es indiferente al grupo/hIdx", () => {
    // El snapshot completo de la cotización (detalle.hoteles) es UNA sola
    // lista plana, generada ANTES de cualquier agrupación (checkout/actions.ts).
    // `convertirCotizacionCarrito` luego reparte los ítems en grupos por
    // destino, cada uno con su propio `hIdx` local arrancando en 0 — la
    // resolución de condiciones NUNCA debe depender de esa posición local.
    const snapshotCompleto: HotelSnapConRef[] = [
      { ref: "item-0", condiciones_tarifa: [{ temporada: "ALTA", texto: "Grupo Cartagena, hIdx local 0." }] },
      { ref: "item-1", condiciones_tarifa: [{ temporada: "ALTA", texto: "Grupo San Andrés, hIdx local 0 (OTRO grupo, mismo hIdx)." }] },
      { ref: "item-2", condiciones_tarifa: [{ temporada: "BAJA", texto: "Grupo Cartagena, hIdx local 1." }] },
    ];
    // Grupo "Cartagena": hIdx 0 → item-0, hIdx 1 → item-2 (NUNCA item-1, que
    // es de otro grupo aunque comparta el número de hIdx 0 con item-0).
    const grupoCartagena = ["item-0", "item-2"];
    // Grupo "San Andrés": hIdx 0 → item-1.
    const grupoSanAndres = ["item-1"];

    const resCartagena = grupoCartagena.map((ref) => resolverCondicionesTarifaParaConversion(snapshotCompleto, ref));
    const resSanAndres = grupoSanAndres.map((ref) => resolverCondicionesTarifaParaConversion(snapshotCompleto, ref));

    assert.deepEqual(resCartagena[0], { ok: true, condiciones: [{ temporada: "ALTA", texto: "Grupo Cartagena, hIdx local 0." }] });
    assert.deepEqual(resCartagena[1], { ok: true, condiciones: [{ temporada: "BAJA", texto: "Grupo Cartagena, hIdx local 1." }] });
    assert.deepEqual(resSanAndres[0], { ok: true, condiciones: [{ temporada: "ALTA", texto: "Grupo San Andrés, hIdx local 0 (OTRO grupo, mismo hIdx)." }] });
    // Control negativo explícito: el grupo Cartagena (hIdx 0) NUNCA debe
    // terminar con el texto del grupo San Andrés (también hIdx 0).
    assert.notEqual(
      (resCartagena[0] as { ok: true; condiciones: { texto: string }[] | null }).condiciones?.[0]?.texto,
      "Grupo San Andrés, hIdx local 0 (OTRO grupo, mismo hIdx)."
    );
  });

  test("agrupación 'todo' (un solo grupo con TODOS los ítems) resuelve igual, cada ítem por su propio ref", () => {
    const snapshotCompleto: HotelSnapConRef[] = [
      { ref: "item-0", condiciones_tarifa: [{ temporada: "ALTA", texto: "Hotel 1." }] },
      { ref: "item-1", condiciones_tarifa: [{ temporada: "ALTA", texto: "Hotel 2." }] },
    ];
    const grupoUnico = ["item-0", "item-1"];
    const resultados = grupoUnico.map((ref) => resolverCondicionesTarifaParaConversion(snapshotCompleto, ref));
    assert.deepEqual(resultados[0], { ok: true, condiciones: [{ temporada: "ALTA", texto: "Hotel 1." }] });
    assert.deepEqual(resultados[1], { ok: true, condiciones: [{ temporada: "ALTA", texto: "Hotel 2." }] });
  });
});

describe("resolverCondicionesTarifaParaConversion — falla cerrado (referencia moderna faltante o duplicada)", () => {
  test("ref presente pero SIN ningún match en el snapshot → ok:false", () => {
    const r = resolverCondicionesTarifaParaConversion([hotelSnap({ ref: "item-0" })], "item-99");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /No se encontró/);
  });
  test("ref presente con DOS matches (snapshot corrupto/ambiguo) → ok:false", () => {
    const r = resolverCondicionesTarifaParaConversion(
      [hotelSnap({ ref: "item-0" }), hotelSnap({ ref: "item-0" })],
      "item-0"
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /2 hoteles/);
  });
  test("ref con match único pero condiciones_tarifa con forma JSON inválida (objeto, no arreglo) → ok:false — el JSON inválido NUNCA llega al contrato", () => {
    const r = resolverCondicionesTarifaParaConversion(
      [hotelSnap({ ref: "item-0", condiciones_tarifa: { no: "es un arreglo" } })],
      "item-0"
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /inválido/);
  });
});
