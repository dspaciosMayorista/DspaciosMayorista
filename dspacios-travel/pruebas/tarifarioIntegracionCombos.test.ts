import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { claveCombo, filtrarPorCombos, type ComboIdentidad } from "../lib/tarifario/comboKey.ts";

// ── Ronda 6, ítem 4 — prueba INTEGRADA de equivalencia de extremo a extremo:
//
//   filas RAW → resumen (Tier 1, colapsa acomodación) → filtros activos
//   (búsqueda/categoría/régimen) → selección estructural (salida/paquete
//   puntual) → detalle completo filtrado (Tier 2, post-filtrado por combos)
//
// se compara, para cada combinación de filtros, contra el resultado que
// habría dado el flujo ANTERIOR de una sola pieza: filtrar las filas RAW
// directamente (búsqueda/categoría/régimen/acomodación/estructura), sin
// pasar por ningún resumen ni combo — el mismo resultado visible que el
// usuario vería en cualquiera de las dos arquitecturas, si ambas fueran
// correctas. Una diferencia entre ambos resultados es, por definición, el
// defecto "el detalle pierde los filtros activos" reapareciendo.
//
// `coincideFiltroLocal`/`agregarResumenLocal` replican (no importan, ver
// nota de cabecera en pruebas/tarifarioComboKey.test.ts) la lógica real de
// TarifarioPublic.tsx (`coincideFiltro`) y de la vista `tarifario_resumen`
// (colapsar acomodación) — documentado en cada función.

type FilaRaw = ComboIdentidad & {
  acomodacion: string;
  precio_pvp: number;
  hotel_nombre: string | null;
  paquete_nombre: string | null;
};

// Réplica EXACTA de `coincideFiltro()` (TarifarioPublic.tsx) — búsqueda por
// hotel_nombre/paquete_nombre, categoría y régimen exactos.
function coincideFiltroLocal(f: FilaRaw, q: string, fCat: string, fReg: string): boolean {
  if (q) {
    const hay = `${f.hotel_nombre ?? ""} ${f.paquete_nombre ?? ""}`.toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  if (fCat && (f.categoria ?? "") !== fCat) return false;
  if (fReg && (f.regimen ?? "") !== fReg) return false;
  return true;
}

// Réplica de la vista `tarifario_resumen` (migración 162): agrupa por el
// combo (los 10 campos de ComboIdentidad) — para esta prueba de identidad no
// hace falta reproducir el MIN(precio_pvp) real, solo qué combos EXISTEN.
function agregarResumenLocal(filas: FilaRaw[]): ComboIdentidad[] {
  const vistos = new Map<string, ComboIdentidad>();
  for (const f of filas) {
    const clave = claveCombo(f);
    if (!vistos.has(clave)) vistos.set(clave, f);
  }
  return [...vistos.values()];
}

// ── Fixture RAW compartido — 2 hoteles, 2 categorías, 2 regímenes, 2
// salidas de bloqueo, 2 paquetes de porción terrestre, cada combo con 3
// acomodaciones. Deliberadamente enredado: el Hotel Norte aparece en AMBAS
// salidas Y con ambas categorías; el Hotel Sur aparece en un solo paquete.
function fixtureRaw(): FilaRaw[] {
  const combos: (ComboIdentidad & { hotel_nombre: string; paquete_nombre: string })[] = [
    // Módulo bloqueo — Hotel Norte, Salida A (bloqueo 101), Estandar/PC
    { modulo: "bloqueo", paquete_id: 1, bloqueo_id: 101, hotel_id: 900, categoria: "Estandar", regimen: "PC", fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", moneda: "COP", hotel_nombre: "Hotel Norte", paquete_nombre: "Bloqueo Norte" },
    // Módulo bloqueo — Hotel Norte, Salida A, Suite/PC (otra categoría, misma salida)
    { modulo: "bloqueo", paquete_id: 1, bloqueo_id: 101, hotel_id: 900, categoria: "Suite", regimen: "PC", fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", moneda: "COP", hotel_nombre: "Hotel Norte", paquete_nombre: "Bloqueo Norte" },
    // Módulo bloqueo — Hotel Norte, Salida A, Estandar/PAM (otro régimen, misma salida/categoría)
    { modulo: "bloqueo", paquete_id: 1, bloqueo_id: 101, hotel_id: 900, categoria: "Estandar", regimen: "PAM", fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", moneda: "COP", hotel_nombre: "Hotel Norte", paquete_nombre: "Bloqueo Norte" },
    // Módulo bloqueo — Hotel Norte, Salida B (bloqueo 202, otra fecha), Estandar/PC
    { modulo: "bloqueo", paquete_id: 1, bloqueo_id: 202, hotel_id: 900, categoria: "Estandar", regimen: "PC", fecha_ida: "2026-12-20", fecha_regreso: "2026-12-23", moneda: "COP", hotel_nombre: "Hotel Norte", paquete_nombre: "Bloqueo Norte" },
    // Módulo bloqueo — Hotel Sur, Salida A también, Estandar/PC
    { modulo: "bloqueo", paquete_id: 1, bloqueo_id: 101, hotel_id: 901, categoria: "Estandar", regimen: "PC", fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", moneda: "COP", hotel_nombre: "Hotel Sur", paquete_nombre: "Bloqueo Norte" },
    // Módulo porcion_terrestre — Hotel Norte, Paquete A, Estandar/PC
    { modulo: "porcion_terrestre", paquete_id: 10, bloqueo_id: null, hotel_id: 900, categoria: "Estandar", regimen: "PC", fecha_ida: null, fecha_regreso: null, moneda: "COP", hotel_nombre: "Hotel Norte", paquete_nombre: "Paquete A" },
    // Módulo porcion_terrestre — Hotel Norte, Paquete B (otro paquete, mismo hotel)
    { modulo: "porcion_terrestre", paquete_id: 11, bloqueo_id: null, hotel_id: 900, categoria: "Estandar", regimen: "PC", fecha_ida: null, fecha_regreso: null, moneda: "COP", hotel_nombre: "Hotel Norte", paquete_nombre: "Paquete B" },
  ];
  const raw: FilaRaw[] = [];
  let precio = 300000;
  for (const c of combos) {
    for (const acom of ["sencilla", "doble", "triple"]) {
      raw.push({ ...c, acomodacion: acom, precio_pvp: precio });
      precio += 5000;
    }
    precio += 20000;
  }
  return raw;
}

/**
 * Flujo "ANTERIOR" (una sola pieza, sin resumen ni combos): filtra las filas
 * RAW directamente por búsqueda/categoría/régimen/acomodación/estructura —
 * el resultado visible de referencia que la arquitectura de dos niveles
 * DEBE reproducir exactamente.
 */
function flujoAnteriorDirecto(
  raw: FilaRaw[],
  opts: { q?: string; fCat?: string; fReg?: string; soloAcom?: string; estructura: (f: FilaRaw) => boolean }
): FilaRaw[] {
  return raw.filter(
    (f) =>
      coincideFiltroLocal(f, opts.q ?? "", opts.fCat ?? "", opts.fReg ?? "") &&
      opts.estructura(f) &&
      (!opts.soloAcom || f.acomodacion === opts.soloAcom)
  );
}

/**
 * Flujo "NUEVO" (dos niveles): resumen (colapsa acomodación) → filtros
 * activos → combos del alcance seleccionado → post-filtro de detalle → (la
 * acomodación se filtra DESPUÉS, igual que en la UI real).
 */
function flujoNuevoDosNiveles(
  raw: FilaRaw[],
  opts: { q?: string; fCat?: string; fReg?: string; soloAcom?: string; estructura: (c: ComboIdentidad) => boolean }
): FilaRaw[] {
  const resumen = agregarResumenLocal(raw);
  const resumenFiltrado = resumen.filter((c) => coincideFiltroLocal(c as FilaRaw, opts.q ?? "", opts.fCat ?? "", opts.fReg ?? ""));
  const combosPermitidos = resumenFiltrado.filter(opts.estructura);
  const detalle = filtrarPorCombos(raw, combosPermitidos);
  return opts.soloAcom ? detalle.filter((f) => f.acomodacion === opts.soloAcom) : detalle;
}

function ordenar(filas: FilaRaw[]): FilaRaw[] {
  return [...filas].sort((a, b) => claveCombo(a).localeCompare(claveCombo(b)) || a.acomodacion.localeCompare(b.acomodacion));
}

describe("Ronda 6, ítem 4 — equivalencia integrada raw→resumen→filtros→selección→detalle vs. el flujo anterior de una sola pieza", () => {
  const raw = fixtureRaw();

  test("sin ningún filtro, seleccionando la Salida A (bloqueo_id=101): equivalencia exacta", () => {
    const estructuraRaw = (f: FilaRaw) => f.modulo === "bloqueo" && f.bloqueo_id === 101;
    const estructuraCombo = (c: ComboIdentidad) => c.modulo === "bloqueo" && c.bloqueo_id === 101;
    const anterior = flujoAnteriorDirecto(raw, { estructura: estructuraRaw });
    const nuevo = flujoNuevoDosNiveles(raw, { estructura: estructuraCombo });
    assert.deepEqual(ordenar(nuevo), ordenar(anterior));
    // Control de que la prueba es significativa: debe haber MÁS de un combo
    // en la Salida A (Estandar/PC, Suite/PC, Estandar/PAM, + Hotel Sur).
    assert.ok(new Set(anterior.map(claveCombo)).size >= 4);
  });

  test("con categoría='Estandar' activa, seleccionando la Salida A: equivalencia exacta — Suite debe desaparecer en AMBOS flujos por igual", () => {
    const estructuraRaw = (f: FilaRaw) => f.modulo === "bloqueo" && f.bloqueo_id === 101;
    const estructuraCombo = (c: ComboIdentidad) => c.modulo === "bloqueo" && c.bloqueo_id === 101;
    const anterior = flujoAnteriorDirecto(raw, { fCat: "Estandar", estructura: estructuraRaw });
    const nuevo = flujoNuevoDosNiveles(raw, { fCat: "Estandar", estructura: estructuraCombo });
    assert.deepEqual(ordenar(nuevo), ordenar(anterior));
    assert.equal(nuevo.some((f) => f.categoria === "Suite"), false, "control: la categoría filtrada de verdad desapareció");
  });

  test("con régimen='PAM' activo, seleccionando la Salida A: equivalencia exacta — solo el combo Estandar/PAM sobrevive", () => {
    const estructuraRaw = (f: FilaRaw) => f.modulo === "bloqueo" && f.bloqueo_id === 101;
    const estructuraCombo = (c: ComboIdentidad) => c.modulo === "bloqueo" && c.bloqueo_id === 101;
    const anterior = flujoAnteriorDirecto(raw, { fReg: "PAM", estructura: estructuraRaw });
    const nuevo = flujoNuevoDosNiveles(raw, { fReg: "PAM", estructura: estructuraCombo });
    assert.deepEqual(ordenar(nuevo), ordenar(anterior));
    assert.equal(anterior.length, 3, "1 combo × 3 acomodaciones");
  });

  test("con búsqueda q='Sur', seleccionando la Salida A: equivalencia exacta — solo Hotel Sur sobrevive, Hotel Norte desaparece", () => {
    const estructuraRaw = (f: FilaRaw) => f.modulo === "bloqueo" && f.bloqueo_id === 101;
    const estructuraCombo = (c: ComboIdentidad) => c.modulo === "bloqueo" && c.bloqueo_id === 101;
    const anterior = flujoAnteriorDirecto(raw, { q: "sur", estructura: estructuraRaw });
    const nuevo = flujoNuevoDosNiveles(raw, { q: "sur", estructura: estructuraCombo });
    assert.deepEqual(ordenar(nuevo), ordenar(anterior));
    assert.ok(anterior.every((f) => f.hotel_id === 901));
  });

  test("con soloAcom='doble', sin otros filtros, seleccionando la Salida B (bloqueo_id=202): equivalencia exacta", () => {
    const estructuraRaw = (f: FilaRaw) => f.modulo === "bloqueo" && f.bloqueo_id === 202;
    const estructuraCombo = (c: ComboIdentidad) => c.modulo === "bloqueo" && c.bloqueo_id === 202;
    const anterior = flujoAnteriorDirecto(raw, { soloAcom: "doble", estructura: estructuraRaw });
    const nuevo = flujoNuevoDosNiveles(raw, { soloAcom: "doble", estructura: estructuraCombo });
    assert.deepEqual(ordenar(nuevo), ordenar(anterior));
    assert.ok(anterior.every((f) => f.acomodacion === "doble"));
    assert.equal(anterior.length, 1, "un solo combo en la Salida B");
  });

  test("seleccionando el Paquete A (porcion_terrestre, paquete_id=10): equivalencia exacta — Paquete B (mismo hotel) no aparece", () => {
    const estructuraRaw = (f: FilaRaw) => f.modulo === "porcion_terrestre" && f.paquete_id === 10;
    const estructuraCombo = (c: ComboIdentidad) => c.modulo === "porcion_terrestre" && c.paquete_id === 10;
    const anterior = flujoAnteriorDirecto(raw, { estructura: estructuraRaw });
    const nuevo = flujoNuevoDosNiveles(raw, { estructura: estructuraCombo });
    assert.deepEqual(ordenar(nuevo), ordenar(anterior));
    assert.equal(anterior.some((f) => f.paquete_id === 11), false, "Paquete B no debe aparecer al abrir el Paquete A");
  });

  test("combinación de TODOS los filtros a la vez (q + categoría + régimen + acomodación + selección de salida): equivalencia exacta", () => {
    const estructuraRaw = (f: FilaRaw) => f.modulo === "bloqueo" && f.bloqueo_id === 101;
    const estructuraCombo = (c: ComboIdentidad) => c.modulo === "bloqueo" && c.bloqueo_id === 101;
    const opts = { q: "norte", fCat: "Estandar", fReg: "PC", soloAcom: "triple" };
    const anterior = flujoAnteriorDirecto(raw, { ...opts, estructura: estructuraRaw });
    const nuevo = flujoNuevoDosNiveles(raw, { ...opts, estructura: estructuraCombo });
    assert.deepEqual(ordenar(nuevo), ordenar(anterior));
    // "norte" matchea tanto "Hotel Norte" como el paquete_nombre "Bloqueo
    // Norte" (compartido por Hotel Sur en la misma salida) — 2 filas
    // sobreviven (Hotel Norte y Hotel Sur), ambas triple/Estandar/PC.
    assert.equal(anterior.length, 2, "Hotel Norte Y Hotel Sur sobreviven — ambos bajo paquete_nombre 'Bloqueo Norte'");
    assert.deepEqual(new Set(anterior.map((f) => f.hotel_id)), new Set([900, 901]));
  });

  test("⚠️ control negativo — SIN el post-filtro de combos (equivalente al código anterior a esta ronda), la equivalencia se ROMPE: aparecen filas que el filtro activo debía excluir", () => {
    // Reproduce el defecto: acotar solo por estructura (bloqueo_id=101),
    // ignorando categoría/régimen/búsqueda — exactamente lo que hacía
    // `obtenerDetalleSalida` antes de esta ronda.
    const soloEstructura = raw.filter((f) => f.modulo === "bloqueo" && f.bloqueo_id === 101);
    const anteriorConFiltros = flujoAnteriorDirecto(raw, { fCat: "Estandar", estructura: (f) => f.modulo === "bloqueo" && f.bloqueo_id === 101 });
    assert.notDeepEqual(ordenar(soloEstructura), ordenar(anteriorConFiltros), "sin post-filtrar por combos, el resultado NO coincide con el flujo correcto — la Suite se cuela");
    assert.ok(soloEstructura.some((f) => f.categoria === "Suite"), "confirma la fuga: Suite aparece cuando no debería");
  });
});
