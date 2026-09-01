import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { claveCombo, clavesCombo, claveComboAlcanceNormalizada, filtrarPorCombos, type ComboIdentidad } from "../lib/tarifario/comboKey.ts";

// ── Ronda 6, ítem 2 — EJECUCIÓN REAL del cruce combo (claveCombo/
// filtrarPorCombos), el mecanismo compartido cliente↔servidor que corrige el
// defecto "el detalle bajo demanda pierde los filtros activos del resumen".
//
// Estructura de las pruebas de escenario (más abajo): simulan de punta a
// punta lo que hacen VistaBooking.tsx (armar `h.filas`/combos de una
// tarjeta) y TarifarioPublic.tsx (armar `combosSalida`/`combosPaquete`) —
// replicando LITERALMENTE las mismas expresiones de filtro que esos
// componentes usan (documentado en cada prueba) — porque esos archivos son
// componentes React "use client"/"use server" que no se pueden ejecutar bajo
// `node --test` en este repo (ver la nota de encabezado de
// pruebas/tarifarioDetalleWiring.test.ts, que por eso usa wiring de texto).
// Aquí, en cambio, se ejecuta la lógica PURA real: la misma
// `claveCombo`/`filtrarPorCombos` que detalle-actions.ts importa y usa tal
// cual (ver pruebas/tarifarioDetalleWiring.test.ts para la comprobación de
// que el archivo real la invoca en el punto correcto).

describe("claveCombo() — identidad estructural pura", () => {
  const base: ComboIdentidad = {
    modulo: "bloqueo", paquete_id: 1, bloqueo_id: 10, salida_id: null, hotel_id: 7,
    categoria: "Estandar", regimen: "PC", fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", moneda: "COP",
  };
  test("misma combinación de campos ⇒ misma clave, aunque sean objetos distintos", () => {
    assert.equal(claveCombo(base), claveCombo({ ...base }));
  });
  test("cualquier campo distinto ⇒ clave distinta", () => {
    for (const campo of Object.keys(base) as (keyof ComboIdentidad)[]) {
      const variante = { ...base, [campo]: campo === "modulo" ? "dinamico" : campo.endsWith("_id") ? 999 : campo.includes("fecha") ? "2099-01-01" : "OTRO" };
      assert.notEqual(claveCombo(base), claveCombo(variante), `el campo "${campo}" debe participar en la clave`);
    }
  });
  test("null y undefined en el mismo campo dan la MISMA clave (ambos son 'no aplica')", () => {
    const conNull = { ...base, salida_id: null };
    const conUndefined = { ...base, salida_id: undefined };
    assert.equal(claveCombo(conNull), claveCombo(conUndefined));
  });
  test("acomodación NO forma parte de la clave (FilaTarifario trae 'acomodacion' extra, pero el combo la ignora)", () => {
    const filaConAcom = { ...base, acomodacion: "doble", precio_pvp: 500000 };
    const filaOtraAcom = { ...base, acomodacion: "triple", precio_pvp: 600000 };
    assert.equal(claveCombo(filaConAcom), claveCombo(filaOtraAcom), "dos filas del MISMO combo con distinta acomodación deben compartir clave");
  });
  test("valores que colisionarían como texto (ej. hotel_id numérico vs string) no se confunden por el separador ∅/|||", () => {
    const a = claveCombo({ hotel_id: null });
    const b = claveCombo({}); // hotel_id ausente = mismo que null
    assert.equal(a, b);
  });
});

describe("clavesCombo() / claveComboAlcanceNormalizada() — conjunto y clave de caché normalizados", () => {
  test("clavesCombo deduplica", () => {
    const c: ComboIdentidad = { hotel_id: 1 };
    assert.equal(clavesCombo([c, { ...c }, { ...c }]).size, 1);
  });
  test("claveComboAlcanceNormalizada es estable ante el orden de entrada", () => {
    const a = { hotel_id: 1 }, b = { hotel_id: 2 }, c = { hotel_id: 3 };
    assert.equal(claveComboAlcanceNormalizada([a, b, c]), claveComboAlcanceNormalizada([c, a, b]));
  });
  test("alcance vacío da una cadena vacía, distinta de cualquier alcance no vacío", () => {
    assert.equal(claveComboAlcanceNormalizada([]), "");
    assert.notEqual(claveComboAlcanceNormalizada([]), claveComboAlcanceNormalizada([{ hotel_id: 1 }]));
  });
});

// ── Fixture de detalle "crudo" — simula lo que trae `tarifario_resultado`
// para una consulta acotada SOLO por hotel_id/bloqueo_id/paquete_id (el
// alcance estructural), es decir, la respuesta de Supabase ANTES del
// post-filtro por combos. Cada combo trae varias filas de acomodación.
type FilaDetalleFixture = ComboIdentidad & { acomodacion: string; precio_pvp: number; hotel_nombre?: string | null; paquete_nombre?: string | null };

function filasDeCombo(combo: ComboIdentidad, precioBase: number): FilaDetalleFixture[] {
  return ["sencilla", "doble", "triple"].map((acom, i) => ({ ...combo, acomodacion: acom, precio_pvp: precioBase + i * 10000 }));
}

describe("filtrarPorCombos() — VistaBooking: 'Ver opciones' de un hotel con dos salidas", () => {
  // Hotel 50, categoría/régimen únicos, presente en DOS salidas (bloqueo_id
  // 101 "Salida A" y 202 "Salida B"). Simula lo que `obtenerDetalleHotel`
  // trae de Supabase para hotel_id=50 (el `.in("bloqueo_id", bloqueoIds)` es
  // solo un HINT de la consulta — este fixture representa el caso en que ese
  // hint no restringió nada, para probar que el post-filtro SÍ lo hace).
  const comboA: ComboIdentidad = { modulo: "bloqueo", paquete_id: 1, bloqueo_id: 101, hotel_id: 50, categoria: "Estandar", regimen: "PC", fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", moneda: "COP" };
  const comboB: ComboIdentidad = { ...comboA, bloqueo_id: 202, fecha_ida: "2026-12-15", fecha_regreso: "2026-12-18" };
  const raw = [...filasDeCombo(comboA, 400000), ...filasDeCombo(comboB, 420000)];

  test("seleccionar la Salida A (salidaSel=101) — el alcance de combos es SOLO comboA — no muestra la Salida B", () => {
    // Replica `h.filas` de VistaBooking.tsx: el usuario eligió salidaSel=101,
    // así que `hoteles` (el useMemo) ya excluyó las filas con bloqueo_id≠101
    // ANTES de que este hotel llegara a la tarjeta.
    const combosPermitidos = [comboA];
    const resultado = filtrarPorCombos(raw, combosPermitidos);
    assert.equal(resultado.length, 3, "solo las 3 filas de acomodación de la Salida A");
    assert.ok(resultado.every((f) => f.bloqueo_id === 101), "ninguna fila de la Salida B (202) debe aparecer");
  });

  test("⚠️ control negativo: SIN el post-filtro por combos (código anterior a esta ronda), la Salida B SÍ se cuela", () => {
    // El defecto reportado: `obtenerDetalleHotel` devolvía las filas crudas
    // tal cual llegaban de Supabase, sin cruzarlas contra el alcance.
    const sinFiltro = raw;
    assert.ok(sinFiltro.some((f) => f.bloqueo_id === 202), "reproduce el defecto: la salida no seleccionada aparece si no se post-filtra");
  });

  test("seleccionar la Salida B en cambio excluye la A", () => {
    const resultado = filtrarPorCombos(raw, [comboB]);
    assert.ok(resultado.every((f) => f.bloqueo_id === 202));
    assert.equal(resultado.some((f) => f.bloqueo_id === 101), false);
  });
});

describe("filtrarPorCombos() — VistaBooking: filtro de CATEGORÍA activo (fCat) dentro del modal", () => {
  // Hotel 51, una sola salida, DOS categorías (Estandar/Suite), mismo régimen.
  const comboEstandar: ComboIdentidad = { modulo: "bloqueo", paquete_id: 2, bloqueo_id: 301, hotel_id: 51, categoria: "Estandar", regimen: "PC", fecha_ida: "2026-11-01", fecha_regreso: "2026-11-04", moneda: "COP" };
  const comboSuite: ComboIdentidad = { ...comboEstandar, categoria: "Suite" };
  const raw = [...filasDeCombo(comboEstandar, 500000), ...filasDeCombo(comboSuite, 800000)];

  test("fCat='Estandar' activo — el alcance excluye Suite — Suite NO reaparece dentro del modal", () => {
    // Replica TarifarioPublic.tsx: `filasFiltradas = filas.filter(coincideFiltro(f,q,fCat,fReg))`
    // con fCat="Estandar" — solo el combo Estandar llega a `h.filas`.
    const combosPermitidos = [comboEstandar];
    const resultado = filtrarPorCombos(raw, combosPermitidos);
    assert.ok(resultado.every((f) => f.categoria === "Estandar"));
    assert.equal(resultado.some((f) => f.categoria === "Suite"), false, "Suite no debe reaparecer bajo el filtro de categoría Estandar");
  });

  test("⚠️ control negativo: sin post-filtrar por combos, Suite SÍ reaparece (defecto reportado: 'categoría A no deja reaparecer B' fallaba)", () => {
    assert.ok(raw.some((f) => f.categoria === "Suite"), "reproduce el defecto sobre el fixture crudo, sin el fix aplicado");
  });

  test("fReg análogo: régimen PC activo excluye PAM del mismo hotel/categoría", () => {
    const comboPC: ComboIdentidad = { ...comboEstandar, regimen: "PC" };
    const comboPAM: ComboIdentidad = { ...comboEstandar, regimen: "PAM" };
    const rawReg = [...filasDeCombo(comboPC, 500000), ...filasDeCombo(comboPAM, 550000)];
    const resultado = filtrarPorCombos(rawReg, [comboPC]);
    assert.ok(resultado.every((f) => f.regimen === "PC"));
    assert.equal(resultado.some((f) => f.regimen === "PAM"), false, "régimen PAM no debe reaparecer bajo el filtro de régimen PC");
  });

  test("⚠️ control negativo régimen: sin post-filtrar, PAM SÍ se cuela", () => {
    const comboPC: ComboIdentidad = { ...comboEstandar, regimen: "PC" };
    const comboPAM: ComboIdentidad = { ...comboEstandar, regimen: "PAM" };
    const rawReg = [...filasDeCombo(comboPC, 500000), ...filasDeCombo(comboPAM, 550000)];
    assert.ok(rawReg.some((f) => f.regimen === "PAM"));
  });
});

describe("filtrarPorCombos() — VistaBooking módulo porcion_terrestre: búsqueda por texto (q) no deja aparecer OTRO paquete del mismo hotel", () => {
  // Mismo hotel (52) vendido en DOS paquetes de porción terrestre distintos
  // ("Paquete Norte" / "Paquete Sur") — el mismo hotel puede pertenecer a
  // más de un paquete armado.
  const comboNorte: ComboIdentidad = { modulo: "porcion_terrestre", paquete_id: 10, bloqueo_id: null, hotel_id: 52, categoria: "Estandar", regimen: "PC", fecha_ida: null, fecha_regreso: null, moneda: "COP" };
  const comboSur: ComboIdentidad = { ...comboNorte, paquete_id: 11 };
  const rawNorte = filasDeCombo(comboNorte, 300000).map((f) => ({ ...f, hotel_nombre: "Hotel Cincuenta y Dos", paquete_nombre: "Paquete Norte" }));
  const rawSur = filasDeCombo(comboSur, 320000).map((f) => ({ ...f, hotel_nombre: "Hotel Cincuenta y Dos", paquete_nombre: "Paquete Sur" }));
  const raw = [...rawNorte, ...rawSur];

  test("q='Norte' activo — el alcance solo trae el combo de 'Paquete Norte' — 'Paquete Sur' no reaparece", () => {
    // Replica `coincideFiltro`: q="norte" solo matchea paquete_nombre="Paquete Norte".
    const combosPermitidos = [comboNorte];
    const resultado = filtrarPorCombos(raw, combosPermitidos);
    assert.ok(resultado.every((f) => f.paquete_id === 10));
    assert.equal(resultado.some((f) => f.paquete_id === 11), false, "Paquete Sur (mismo hotel) no debe reaparecer bajo la búsqueda 'Norte'");
  });

  test("⚠️ control negativo: sin post-filtrar por combos (la revisión anterior no exigía NINGÚN alcance para porcion_terrestre), Paquete Sur SÍ se cuela", () => {
    assert.ok(raw.some((f) => f.paquete_id === 11), "reproduce el defecto: porcion_terrestre no tenía alcance");
  });
});

describe("filtrarPorCombos() — Vista tabla PorSalida: abrir una salida no muestra combos de otra salida/categoría/régimen distintos, aunque compartan hotel", () => {
  // Simula obtenerDetalleSalida({modulo:'bloqueo', bloqueoId:401, combos}) —
  // el id estructural (401) por sí solo trae AMBAS categorías del hotel 60
  // (la consulta real solo filtra por bloqueo_id); el filtro activo de
  // categoría "Suite" solo deja `combosSalida` con la categoría Suite.
  const comboEstandar: ComboIdentidad = { modulo: "bloqueo", paquete_id: 3, bloqueo_id: 401, hotel_id: 60, categoria: "Estandar", regimen: "PC", fecha_ida: "2026-10-01", fecha_regreso: "2026-10-04", moneda: "COP" };
  const comboSuite: ComboIdentidad = { ...comboEstandar, categoria: "Suite" };
  const raw = [...filasDeCombo(comboEstandar, 700000), ...filasDeCombo(comboSuite, 900000)];

  test("combosSalida acotado a Suite (categoría activa) — Estandar no reaparece en la tabla pivotada", () => {
    const combosSalida = [comboSuite]; // filasConCupo.filter(f => f.bloqueo_id === selFila.bloqueo_id) YA viene filtrado por fCat="Suite" aguas arriba
    const resultado = filtrarPorCombos(raw, combosSalida);
    assert.ok(resultado.every((f) => f.categoria === "Suite"));
    assert.equal(resultado.some((f) => f.categoria === "Estandar"), false);
  });

  test("⚠️ control negativo: la versión anterior de obtenerDetalleSalida solo acotaba por bloqueo_id (sin combos) — Estandar SÍ se colaba", () => {
    // Reproduce literalmente el comportamiento pre-ronda-6: la consulta
    // `.eq('modulo','bloqueo').eq('bloqueo_id', v.bloqueoId)` sin ningún
    // post-filtro adicional devuelve TODO lo que comparte ese bloqueo_id.
    const soloAcotadoPorBloqueoId = raw.filter((f) => f.bloqueo_id === 401);
    assert.ok(soloAcotadoPorBloqueoId.some((f) => f.categoria === "Estandar"), "reproduce el defecto: sin combos, ambas categorías conviven bajo el mismo bloqueo_id");
  });
});

describe("filtrarPorCombos() — Vista tabla PorPaquete: abrir un paquete no muestra otro régimen del mismo paquete si el filtro activo lo excluye", () => {
  const comboPC: ComboIdentidad = { modulo: "porcion_terrestre", paquete_id: 12, bloqueo_id: null, hotel_id: 61, categoria: "Estandar", regimen: "PC", fecha_ida: null, fecha_regreso: null, moneda: "COP" };
  const comboPAM: ComboIdentidad = { ...comboPC, regimen: "PAM" };
  const raw = [...filasDeCombo(comboPC, 250000), ...filasDeCombo(comboPAM, 270000)];

  test("combosPaquete acotado a régimen PC (activo) — PAM no reaparece", () => {
    const combosPaquete = [comboPC]; // filas.filter(f => f.paquete_id === selFila.paquete_id) YA viene filtrado por fReg="PC" aguas arriba
    const resultado = filtrarPorCombos(raw, combosPaquete);
    assert.ok(resultado.every((f) => f.regimen === "PC"));
    assert.equal(resultado.some((f) => f.regimen === "PAM"), false);
  });

  test("⚠️ control negativo: la versión anterior de obtenerDetallePaquete solo acotaba por paquete_id — PAM SÍ se colaba", () => {
    const soloAcotadoPorPaqueteId = raw.filter((f) => f.paquete_id === 12);
    assert.ok(soloAcotadoPorPaqueteId.some((f) => f.regimen === "PAM"), "reproduce el defecto sobre el fixture crudo");
  });
});

describe("filtrarPorCombos() — el filtro de ACOMODACIÓN sigue funcionando exactamente igual DESPUÉS del post-filtro por combos", () => {
  test("un combo permitido conserva TODAS sus filas de acomodación — filtrarPorCombos no decide acomodación, solo combo", () => {
    const combo: ComboIdentidad = { hotel_id: 70, categoria: "Estandar", regimen: "PC" };
    const raw = filasDeCombo(combo, 100000);
    const resultado = filtrarPorCombos(raw, [combo]);
    assert.deepEqual(resultado.map((f) => f.acomodacion).sort(), ["doble", "sencilla", "triple"], "las 3 acomodaciones del combo permitido deben sobrevivir intactas — el filtro de acomodación se aplica DESPUÉS, en la UI, como antes");
  });
});

describe("filtrarPorCombos() — alcance vacío (combos:[]) nunca deja pasar ninguna fila", () => {
  test("combos:[] siempre da un resultado vacío, sin importar cuántas filas crudas haya", () => {
    const raw = filasDeCombo({ hotel_id: 80 }, 100000);
    assert.deepEqual(filtrarPorCombos(raw, []), []);
  });
});
