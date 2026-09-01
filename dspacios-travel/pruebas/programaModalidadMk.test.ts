import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  calcularNetoPrograma,
  calcularNetoProgramaConModalidad,
  validarReglaComisionable,
  validarTarifaModalidad,
  esModalidadMkValida,
  pvpPrograma,
  MODALIDADES_MK,
  type ModalidadMk,
  type PvpOpciones,
} from "../lib/calc/programaPrecio.ts";

// ───────────────────────────────────────────────────────────────────────────
// § Modalidad de MK de la tarifa comisionable del proveedor (migración 161)
//
// Dos modalidades, coexistiendo, seleccionables por programa:
//   'historica'                     Venta = (base_neta + impuestos) / divisorMK
//   'base_neta_impuestos_al_final'  Venta = (base_neta / divisorMK) + impuestos
//
// `calcularNetoProgramaConModalidad` es la ÚNICA función que decide cómo se
// reparte el resultado de `calcularNetoPrograma` (sin duplicarla) entre lo
// que `pvpPrograma` marca con MK y lo que suma después, sin marcar.
//
// (Revisión PR #277, defecto 5) `pvpPrograma`/`PvpOpciones` se movieron a
// lib/calc/programaPrecio.ts (módulo SIN imports con alias `@/`) precisamente
// para que este archivo pueda importar y ejecutar el MOTOR REAL — antes se
// mantenía una copia textual a mano acá, que corría el riesgo de divergir en
// silencio del código de producción. `lib/programas.ts` re-exporta desde ese
// módulo (ver pruebas de wiring más abajo), así que todo el resto del código
// de la app sigue importando de "@/lib/programas" sin ningún cambio.
// ───────────────────────────────────────────────────────────────────────────

const EJEMPLO_DUEÑO = { tarifa: 1_000_000, modo: "impuesto" as const, valor: 100_000, pctComision: 10 };
const MK_20_USD = { pctMk: 0.2, pctFee: 0, asistenciaDia: 0, dias: 0, moneda: "USD" };
const MK_20_COP = { pctMk: 0.2, pctFee: 0, asistenciaDia: 0, dias: 0, moneda: "COP" };

test("ejemplo exacto del dueño: base comisionable/comisión/base neta", () => {
  const base = calcularNetoPrograma(EJEMPLO_DUEÑO);
  assert.equal(base.baseComisionable, 900_000);
  assert.equal(base.comision, 90_000);
  assert.equal(base.neto, 910_000); // tarifa - comision (= base_neta + impuestos, sin cambios)
});

test("calcularNetoProgramaConModalidad deriva baseNeta/montoNoComisionable sin reimplementar la fórmula base", () => {
  const c = calcularNetoProgramaConModalidad(EJEMPLO_DUEÑO, "historica");
  assert.equal(c.baseComisionable, 900_000);
  assert.equal(c.comision, 90_000);
  assert.equal(c.neto, 910_000);
  assert.equal(c.baseNeta, 810_000); // baseComisionable - comision
  assert.equal(c.montoNoComisionable, 100_000); // neto - baseNeta (= "impuestos" del ejemplo)
});

// ───────────────────────────────────────────────────────────────────────────
// § Reporte de redondeo (revisión PR #277, defecto 5) — separado en 3 capas:
//   1) resultado MATEMÁTICO antes del redondeo de moneda;
//   2) resultado REAL mostrado en COP (redondeo al millar hacia arriba);
//   3) resultado con USD (redondeo al entero hacia arriba) — usado en el
//      resto de este archivo para el ejemplo del dueño porque, al ya ser
//      enteros, el `Math.ceil` es un no-op y no distorsiona la comparación.
// ───────────────────────────────────────────────────────────────────────────

test("reporte de redondeo — modalidad histórica: matemático 1.137.500; COP 1.138.000; USD 1.137.500", () => {
  const c = calcularNetoProgramaConModalidad(EJEMPLO_DUEÑO, "historica");
  const matematico = c.netoParaMarkup / 0.8 + c.montoSinMarkup; // = 910.000/0,8 + 0
  assert.equal(matematico, 1_137_500);
  assert.equal(pvpPrograma(c.netoParaMarkup, MK_20_COP, c.montoSinMarkup), 1_138_000); // ceil(1137500/1000)*1000
  assert.equal(pvpPrograma(c.netoParaMarkup, MK_20_USD, c.montoSinMarkup), 1_137_500); // ceil(1137500)
});

test("reporte de redondeo — modalidad nueva: matemático 1.112.500; COP 1.113.000; USD 1.112.500", () => {
  const c = calcularNetoProgramaConModalidad(EJEMPLO_DUEÑO, "base_neta_impuestos_al_final");
  const matematico = c.netoParaMarkup / 0.8 + c.montoSinMarkup; // = 810.000/0,8 + 100.000
  assert.equal(matematico, 1_112_500);
  assert.equal(pvpPrograma(c.netoParaMarkup, MK_20_COP, c.montoSinMarkup), 1_113_000); // ceil(1112500/1000)*1000
  assert.equal(pvpPrograma(c.netoParaMarkup, MK_20_USD, c.montoSinMarkup), 1_112_500); // ceil(1112500)
});

test("modalidad histórica: SIN REGRESIÓN — netoParaMarkup = neto de siempre, montoSinMarkup = 0", () => {
  const c = calcularNetoProgramaConModalidad(EJEMPLO_DUEÑO, "historica");
  assert.equal(c.netoParaMarkup, c.neto);
  assert.equal(c.montoSinMarkup, 0);
  assert.equal(pvpPrograma(c.netoParaMarkup, MK_20_USD, c.montoSinMarkup), 1_137_500);
  // Y es IDÉNTICO a llamar pvpPrograma sin el 3er argumento (comportamiento de siempre).
  assert.equal(pvpPrograma(c.netoParaMarkup, MK_20_USD), 1_137_500);
});

test("modalidad nueva: reproduce EXACTAMENTE el ejemplo del dueño — 810.000/0,80 + 100.000 = 1.112.500", () => {
  const c = calcularNetoProgramaConModalidad(EJEMPLO_DUEÑO, "base_neta_impuestos_al_final");
  assert.equal(c.netoParaMarkup, 810_000); // baseNeta
  assert.equal(c.montoSinMarkup, 100_000); // montoNoComisionable
  assert.equal(pvpPrograma(c.netoParaMarkup, MK_20_USD, c.montoSinMarkup), 1_112_500);
});

test("ambas modalidades producen resultados DISTINTOS cuando impuestos>0 y MK>0", () => {
  const hist = calcularNetoProgramaConModalidad(EJEMPLO_DUEÑO, "historica");
  const nueva = calcularNetoProgramaConModalidad(EJEMPLO_DUEÑO, "base_neta_impuestos_al_final");
  const pvpHist = pvpPrograma(hist.netoParaMarkup, MK_20_USD, hist.montoSinMarkup);
  const pvpNueva = pvpPrograma(nueva.netoParaMarkup, MK_20_USD, nueva.montoSinMarkup);
  assert.notEqual(pvpHist, pvpNueva);
  assert.equal(pvpHist, 1_137_500);
  assert.equal(pvpNueva, 1_112_500);
});

test("con impuestos en 0 (modo 'ninguno'), ambas modalidades CONVERGEN al mismo PVP", () => {
  const input = { tarifa: 500_000, modo: "ninguno" as const, valor: 999, pctComision: 10 };
  const hist = calcularNetoProgramaConModalidad(input, "historica");
  const nueva = calcularNetoProgramaConModalidad(input, "base_neta_impuestos_al_final");
  assert.equal(hist.montoNoComisionable, 0);
  assert.equal(nueva.montoNoComisionable, 0);
  assert.equal(hist.netoParaMarkup, nueva.netoParaMarkup);
  assert.equal(nueva.montoSinMarkup, 0);
  const pvpHist = pvpPrograma(hist.netoParaMarkup, MK_20_USD, hist.montoSinMarkup);
  const pvpNueva = pvpPrograma(nueva.netoParaMarkup, MK_20_USD, nueva.montoSinMarkup);
  assert.equal(pvpHist, pvpNueva);
});

test("con impuestos en 0 (modo 'pct' con valor=0), ambas modalidades también convergen", () => {
  const input = { tarifa: 750_000, modo: "pct" as const, valor: 0, pctComision: 12 };
  const hist = calcularNetoProgramaConModalidad(input, "historica");
  const nueva = calcularNetoProgramaConModalidad(input, "base_neta_impuestos_al_final");
  assert.equal(nueva.montoNoComisionable, 0);
  assert.equal(hist.netoParaMarkup, nueva.netoParaMarkup);
});

test("los impuestos (montoSinMarkup) NUNCA reciben MK: subir el MK no cambia el monto sin marcar", () => {
  const conMkAlto = pvpPrograma(100, { pctMk: 0.5, moneda: "USD" }, 40);
  const sinMk = pvpPrograma(100, { pctMk: 0, moneda: "USD" }, 40);
  // Con mk=0.5: 100/0.5=200, +40=240. Con mk=0: 100 (sin dividir), +40=140.
  assert.equal(conMkAlto, 240);
  assert.equal(sinMk, 140);
  assert.equal(conMkAlto - sinMk, 100);
});

test("el fee bancario SÍ sigue aplicando sobre el total, incluido el monto sin markup", () => {
  const conFee = pvpPrograma(100, { pctMk: 0, pctFee: 0.5, moneda: "USD" }, 40);
  const sinFee = pvpPrograma(100, { pctMk: 0, pctFee: 0, moneda: "USD" }, 40);
  assert.equal(sinFee, 140);
  assert.equal(conFee, 280);
});

test("pvpPrograma(neto, opt) === pvpPrograma(neto, opt, 0): el 3er argumento es un no-op por defecto", () => {
  const casos: [number, PvpOpciones][] = [
    [500_000, { pctMk: 0.25, pctFee: 0.03, asistenciaDia: 5000, dias: 4, moneda: "COP" }],
    [200, { pctMk: 0.1, moneda: "USD" }],
    [0, { pctMk: 0.5 }], // neto === 0 sin extra → 0 en ambos casos
    [123.45, { pctMk: 0, pctFee: 0 }],
  ];
  for (const [neto, opt] of casos) {
    assert.equal(pvpPrograma(neto, opt), pvpPrograma(neto, opt, 0), `diverge para neto=${neto}`);
  }
});

test("todos los programas EXISTENTES (modalidad histórica implícita) conservan el comportamiento byte a byte", () => {
  const casosReales = [
    { tarifa: 300, modo: "pct" as const, valor: 5, pctComision: 8 },
    { tarifa: 1_500_000, modo: "impuesto" as const, valor: 599_000, pctComision: 15 },
    { tarifa: 80, modo: "ninguno" as const, valor: 0, pctComision: 20 },
  ];
  for (const input of casosReales) {
    const netoPersistido = calcularNetoPrograma(input).neto;
    const viejo = pvpPrograma(netoPersistido, MK_20_USD);
    const c = calcularNetoProgramaConModalidad(input, "historica");
    const nuevo = pvpPrograma(c.netoParaMarkup, MK_20_USD, c.montoSinMarkup);
    assert.equal(nuevo, viejo, `regresión para tarifa=${input.tarifa} modo=${input.modo}`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// § Auditoría de bordes (requisito 11): impuestos=0, comisión=0, MK=0/inválido,
// impuestos ≥ tarifa, comisión > base, negativos, NaN, precisión/redondeo.
// ───────────────────────────────────────────────────────────────────────────

test("comisión en 0%: base_neta = base_comisionable, montoNoComisionable = impuestos tal cual", () => {
  const input = { tarifa: 200_000, modo: "impuesto" as const, valor: 20_000, pctComision: 0 };
  const c = calcularNetoProgramaConModalidad(input, "base_neta_impuestos_al_final");
  assert.equal(c.comision, 0);
  assert.equal(c.baseNeta, 180_000); // = baseComisionable (sin comisión que restar)
  assert.equal(c.montoNoComisionable, 20_000);
});

test("MK en 0: pvpPrograma no divide (queda igual al costo + monto sin marcar), fee sigue aplicando", () => {
  const sinFee = pvpPrograma(100, { pctMk: 0, moneda: "USD" }, 20);
  assert.equal(sinFee, 120); // 100 + 20, sin dividir por nada
});

test("MK inválido (fuera de (0,1)) se ignora igual que en el camino histórico — no rompe, no divide", () => {
  assert.equal(pvpPrograma(100, { pctMk: 1, moneda: "USD" }, 20), 120);
  assert.equal(pvpPrograma(100, { pctMk: -0.5, moneda: "USD" }, 20), 120);
  assert.equal(pvpPrograma(100, { pctMk: 1.5, moneda: "USD" }, 20), 120);
});

test("negativos: valor negativo en modo 'pct'/'impuesto' es rechazado por validarReglaComisionable (sin cambios, migración 151)", () => {
  assert.equal(validarReglaComisionable({ activa: true, modo: "pct", valor: -1, pctComision: 10, modalidadMk: "base_neta_impuestos_al_final" }).ok, false);
  assert.equal(validarReglaComisionable({ activa: true, modo: "impuesto", valor: -1, pctComision: 10, modalidadMk: "base_neta_impuestos_al_final" }).ok, false);
});

test("NaN nunca pasa la validación, en ninguna modalidad", () => {
  assert.equal(validarReglaComisionable({ activa: true, modo: "pct", valor: NaN, pctComision: 10, modalidadMk: "historica" }).ok, false);
  assert.equal(validarReglaComisionable({ activa: true, modo: "pct", valor: 3, pctComision: NaN, modalidadMk: "base_neta_impuestos_al_final" }).ok, false);
});

test("precisión/redondeo: montoNoComisionable = neto - baseNeta cuadra exacto incluso con decimales", () => {
  const input = { tarifa: 333_333.33, modo: "pct" as const, valor: 7.77, pctComision: 13.33 };
  const c = calcularNetoProgramaConModalidad(input, "base_neta_impuestos_al_final");
  assert.equal(Math.round((c.baseNeta + c.montoNoComisionable) * 100) / 100, c.neto);
  assert.ok(Number.isFinite(c.baseNeta) && Number.isFinite(c.montoNoComisionable));
});

// ───────────────────────────────────────────────────────────────────────────
// § validarTarifaModalidad (revisión PR #277, defecto 3) — rechaza baseNeta
// negativa SOLO en la modalidad nueva; nunca toca/bloquea la histórica.
// ───────────────────────────────────────────────────────────────────────────

const REGLA_10PCT = { modo: "pct" as const, valor: 3, pctComision: 10 };

test("validarTarifaModalidad: baseNeta negativa (impuesto > tarifa, comisión baja) se rechaza en modalidad nueva", () => {
  const regla = { modo: "impuesto" as const, valor: 1000, pctComision: 10 }; // tarifa 100 < impuesto 1000
  const v = validarTarifaModalidad(100, regla, "base_neta_impuestos_al_final");
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.error, /base neta negativa/i);
});

test("validarTarifaModalidad: baseNeta EXACTAMENTE 0 (modo 'pct' con valor=100%) se permite — no es negativa", () => {
  const regla = { modo: "pct" as const, valor: 100, pctComision: 10 };
  const c = calcularNetoProgramaConModalidad({ tarifa: 500, ...regla }, "base_neta_impuestos_al_final");
  assert.equal(c.baseNeta, 0);
  const v = validarTarifaModalidad(500, regla, "base_neta_impuestos_al_final");
  assert.equal(v.ok, true);
});

test("validarTarifaModalidad: la MISMA combinación inválida (impuesto>tarifa) se ACEPTA sin más en modalidad histórica — nunca bloquea datos históricos", () => {
  const regla = { modo: "impuesto" as const, valor: 1000, pctComision: 10 };
  assert.equal(validarTarifaModalidad(100, regla, "historica").ok, true);
});

test("validarTarifaModalidad: sin tarifa (<=0, NaN, o no finita) es un no-op — nada que validar", () => {
  assert.equal(validarTarifaModalidad(0, REGLA_10PCT, "base_neta_impuestos_al_final").ok, true);
  assert.equal(validarTarifaModalidad(-5, REGLA_10PCT, "base_neta_impuestos_al_final").ok, true);
  assert.equal(validarTarifaModalidad(NaN, REGLA_10PCT, "base_neta_impuestos_al_final").ok, true);
});

test("validarTarifaModalidad: una tarifa válida normal (comisión<100%, sin impuesto excesivo) siempre pasa en ambas modalidades", () => {
  assert.equal(validarTarifaModalidad(1_000_000, EJEMPLO_DUEÑO, "historica").ok, true);
  assert.equal(validarTarifaModalidad(1_000_000, EJEMPLO_DUEÑO, "base_neta_impuestos_al_final").ok, true);
});

test("baseNeta = 0 con impuestos > 0 en pvpPrograma: el impuesto NO desaparece (Venta = impuestos, no 0)", () => {
  // modo 'pct' valor=100%: toda la tarifa es "impuesto" (montoNoComisionable = tarifa),
  // baseNeta = 0. Venta = 0/divisorMK + impuestos = impuestos.
  const regla = { modo: "pct" as const, valor: 100, pctComision: 10 };
  const c = calcularNetoProgramaConModalidad({ tarifa: 500, ...regla }, "base_neta_impuestos_al_final");
  assert.equal(c.netoParaMarkup, 0);
  assert.equal(c.montoSinMarkup, 500); // = tarifa completa, nada comisionable
  assert.equal(pvpPrograma(c.netoParaMarkup, MK_20_USD, c.montoSinMarkup), 500);
  // El guard viejo (`neto<=0 → 0` sin mirar montoSinMarkup) se hubiera comido
  // el impuesto: confirmamos que NO pasa.
  assert.notEqual(pvpPrograma(c.netoParaMarkup, MK_20_USD, c.montoSinMarkup), 0);
});

test("baseNeta = 0 CON montoSinMarkup = 0 (caller histórico) sigue devolviendo 0 byte a byte — columna fantasma sin costo", () => {
  assert.equal(pvpPrograma(0, MK_20_USD, 0), 0);
  assert.equal(pvpPrograma(0, MK_20_USD), 0);
});

test("baseNeta negativa nunca produce un PVP fabricado: pvpPrograma con neto<0 siempre devuelve 0, aunque haya montoSinMarkup", () => {
  assert.equal(pvpPrograma(-50, MK_20_USD, 100), 0);
  assert.equal(pvpPrograma(-1, MK_20_USD, 0), 0);
});

// ───────────────────────────────────────────────────────────────────────────
// § Frontera `unknown` y rechazo de valores manipulados (requisito 15)
// ───────────────────────────────────────────────────────────────────────────

test("esModalidadMkValida: SOLO los 2 valores del enum son válidos", () => {
  assert.equal(esModalidadMkValida("historica"), true);
  assert.equal(esModalidadMkValida("base_neta_impuestos_al_final"), true);
  for (const bad of [undefined, null, "", "HISTORICA", "historica ", "base_neta", 0, 1, {}, [], true, false, "otra"]) {
    assert.equal(esModalidadMkValida(bad), false, `debía rechazar: ${JSON.stringify(bad)}`);
  }
});

test("MODALIDADES_MK expone exactamente el enum de 2 valores usado por esModalidadMkValida", () => {
  assert.deepEqual([...MODALIDADES_MK].sort(), ["base_neta_impuestos_al_final", "historica"]);
});

test("validarReglaComisionable rechaza una modalidadMk manipulada, SIN IMPORTAR si la regla está activa o no", () => {
  const manipulada = "algo_inventado" as unknown as ModalidadMk;
  assert.equal(validarReglaComisionable({ activa: true, modo: "pct", valor: 3, pctComision: 10, modalidadMk: manipulada }).ok, false);
  assert.equal(validarReglaComisionable({ activa: false, modo: "pct", valor: 3, pctComision: 10, modalidadMk: manipulada }).ok, false);
});

test("validarReglaComisionable valida modalidadMk ANTES que activa (la regla incondicional corta primero)", () => {
  const r = validarReglaComisionable({ activa: false, modo: "pct", valor: null, pctComision: null, modalidadMk: "bogus" as unknown as ModalidadMk });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /modalidad/i);
});

// ───────────────────────────────────────────────────────────────────────────
// § Comisión porcentual (requisito 10 — "conserva sin cambios"): este
// codebase solo tiene comisión PORCENTUAL (`pctComision`); no existe un modo
// de comisión por "valor fijo" separado — `modo` decide la BASE comisionable
// (pct/impuesto/ninguno), no la forma de la comisión en sí.
// ───────────────────────────────────────────────────────────────────────────

test("la comisión sigue siendo SIEMPRE porcentual (pctComision) en los 3 modos, sin variante de valor fijo — sin cambios", () => {
  for (const modo of ["pct", "impuesto", "ninguno"] as const) {
    const c = calcularNetoPrograma({ tarifa: 100_000, modo, valor: 5, pctComision: 10 });
    assert.equal(c.comision, Math.round(c.baseComisionable * 0.1 * 100) / 100);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// § Wiring — misma función pura en los 4 puntos de consumo (requisito 8):
// editor en vivo, validación cliente, validación servidor, generación real.
// ───────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const editorSrc = readFileSync(join(raiz, "app/(dashboard)/dashboard/producto/programas/[id]/ProgramaEditor.tsx"), "utf8");
const actionsSrc = readFileSync(join(raiz, "app/(dashboard)/dashboard/producto/programas/actions.ts"), "utf8");
const programasSrc = readFileSync(join(raiz, "lib/programas.ts"), "utf8");
const precioSrc = readFileSync(join(raiz, "lib/calc/programaPrecio.ts"), "utf8");
const migracion161Src = readFileSync(join(raiz, "supabase/migrations/20260601000161_programa_modalidad_mk_comisionable.sql"), "utf8");

test("wiring: el editor en vivo (SalidasEditor.pvpDe) llama a calcularNetoProgramaConModalidad", () => {
  const inicio = editorSrc.indexOf("const pvpDe = (r: SalidaState");
  const fin = editorSrc.indexOf("const payload: SalidaInput[]");
  const bloque = editorSrc.slice(inicio, fin);
  assert.match(bloque, /calcularNetoProgramaConModalidad\(/, "pvpDe no llama a la función compartida");
  assert.match(bloque, /pvpPrograma\(c\.netoParaMarkup,\s*\{\s*\.\.\.pvpOpt,\s*dias\s*\},\s*c\.montoSinMarkup\)/, "pvpDe no pasa netoParaMarkup/montoSinMarkup a pvpPrograma");
});

test("wiring: reglaPayload/validación cliente incluyen modalidadMk (no se pierde en el borrador)", () => {
  const bloque = editorSrc.slice(editorSrc.indexOf("const reglaPayload"), editorSrc.indexOf("const reglaInvalidaError"));
  assert.match(bloque, /\bmodalidadMk\b/, "reglaPayload no incluye modalidadMk");
});

test("wiring (defecto 3): el editor en vivo valida cada tarifa con validarTarifaModalidad y bloquea el guardado", () => {
  const inicio = editorSrc.indexOf("const tarifaInvalidaError");
  const fin = editorSrc.indexOf("// Tercer elemento = campo de tarifa comisionable");
  const bloque = editorSrc.slice(inicio, fin);
  assert.match(bloque, /validarTarifaModalidad\(/, "el editor no valida las tarifas contra la modalidad");
  const inicioSaveBar = editorSrc.indexOf("<SaveBar", editorSrc.indexOf("function SalidasEditor"));
  const finSaveBar = editorSrc.indexOf("/>", inicioSaveBar);
  const saveBarBloque = editorSrc.slice(inicioSaveBar, finSaveBar);
  assert.match(saveBarBloque, /tarifaInvalidaError/, "SaveBar no bloquea el guardado con tarifaInvalidaError");
});

test("wiring: la Server Action valida modalidadMk como unknown ANTES de pasarla a validarReglaComisionable", () => {
  const inicio = actionsSrc.indexOf("export async function guardarSalidas");
  const bloque = actionsSrc.slice(inicio, actionsSrc.indexOf("const sb = await createClient();", inicio));
  assert.match(bloque, /const\s+modalidadMkRaw:\s*unknown/, "no trata modalidadMk como unknown en la frontera");
  assert.match(bloque, /esModalidadMkValida\(modalidadMkRaw\)/, "no valida modalidadMk con el type guard antes de usarla");
  assert.match(bloque, /validarReglaComisionable\(\{[\s\S]*?modalidadMk:\s*modalidadMkRaw/, "no repite validarReglaComisionable con la modalidad ya angosta");
});

test("wiring (defecto 3): la Server Action valida cada tarifa con validarTarifaModalidad antes del RPC, solo si la regla está activa", () => {
  const inicio = actionsSrc.indexOf("export async function guardarSalidas");
  const fin = actionsSrc.indexOf("const { error } = await sb.rpc(", inicio);
  const bloque = actionsSrc.slice(inicio, fin);
  assert.match(bloque, /if\s*\(regla\.activa\)\s*\{/, "no gatea la validación de tarifas a regla.activa");
  assert.match(bloque, /validarTarifaModalidad\(/, "no llama a validarTarifaModalidad antes del RPC");
});

test("wiring: la Server Action SIEMPRE manda modalidadMk explícito en p_regla (nunca lo omite condicionalmente)", () => {
  const inicio = actionsSrc.indexOf("p_regla: {");
  const fin = actionsSrc.indexOf("},", inicio);
  const bloque = actionsSrc.slice(inicio, fin);
  assert.match(bloque, /modalidadMk:\s*modalidadMkRaw/, "p_regla no manda modalidadMk siempre — el RPC depende de esto para no confundir un cliente actualizado con uno viejo");
});

test("wiring: la generación real del tarifario (getProgramaDetalle) llama a calcularNetoProgramaConModalidad, no reimplementa la fórmula", () => {
  assert.match(programasSrc, /import\s*\{[^}]*calcularNetoProgramaConModalidad[^}]*\}\s*from\s*"@\/lib\/calc\/programaPrecio"/, "lib/programas.ts no importa la función compartida");
  const inicio = programasSrc.indexOf("const pvpDeSalida = ");
  const fin = programasSrc.indexOf("const salidas = (salidasRaw");
  const bloque = programasSrc.slice(inicio, fin);
  assert.match(bloque, /calcularNetoProgramaConModalidad\(/, "pvpDeSalida no llama a la función compartida");
  assert.match(bloque, /pvpPrograma\(calc\.netoParaMarkup,\s*optSalida,\s*calc\.montoSinMarkup\)/, "pvpDeSalida no pasa netoParaMarkup/montoSinMarkup a pvpPrograma");
});

test("wiring (defecto 2): getProgramasResumen también llama a calcularNetoProgramaConModalidad y toma el mínimo sobre PVP, no sobre netos", () => {
  const inicio = programasSrc.indexOf("export async function getProgramasResumen");
  const fin = programasSrc.indexOf("export type ProgramaDetalle");
  const bloque = programasSrc.slice(inicio, fin);
  assert.match(bloque, /calcularNetoProgramaConModalidad\(/, "getProgramasResumen no llama a la función compartida");
  assert.match(bloque, /setMinPvp\(s\.programa_id,\s*pvpPrograma\(calc\.netoParaMarkup,\s*optNueva,\s*calc\.montoSinMarkup\)\)/, "getProgramasResumen no toma el mínimo sobre el PVP calculado con la modalidad nueva");
  assert.match(bloque, /const\s+minPvp\s*=\s*new Map/, "getProgramasResumen ya no debe rastrear un mínimo de netos crudos");
  assert.doesNotMatch(bloque, /const\s+minNeto\s*=\s*new Map/, "getProgramasResumen no debe volver al mínimo de netos crudos (bug original)");
});

test("wiring (defecto 2): el select de getProgramasResumen trae la regla comisionable + modalidad + tarifas, para poder recalcular igual que el detalle", () => {
  const inicio = programasSrc.indexOf("export async function getProgramasResumen");
  const fin = programasSrc.indexOf("export type ProgramaDetalle");
  const bloque = programasSrc.slice(inicio, fin);
  assert.match(bloque, /regla_comisionable_modalidad_mk/, "no selecciona la modalidad del programa");
  assert.match(bloque, /tarifa_sencilla,\s*tarifa_doble,\s*tarifa_triple,\s*tarifa_multiple/, "no selecciona las tarifas de proveedor por salida");
});

test("integración (defecto 2): getProgramasResumen y getProgramaDetalle usan el MISMO fallback de días (noches de la salida, con respaldo en días de cabecera) para la modalidad nueva", () => {
  // No se puede invocar getProgramasResumen/getProgramaDetalle directo desde
  // una prueba unitaria (son async y dependen de un cliente Supabase real) —
  // se verifica por fuente que las dos construyen `dias` con la MISMA
  // expresión, y se demuestra a nivel matemático que usar esa expresión (en
  // vez del `dias` de cabecera a secas) SÍ cambia el resultado — así el test
  // de wiring de abajo no es un chequeo vacío.
  const inicioResumen = programasSrc.indexOf("export async function getProgramasResumen");
  const finResumen = programasSrc.indexOf("export type ProgramaDetalle");
  const bloqueResumen = programasSrc.slice(inicioResumen, finResumen);
  assert.match(bloqueResumen, /dias:\s*s\.noches\s*!=\s*null\s*\?\s*s\.noches\s*:\s*p\.dias/, "getProgramasResumen (optNueva) no usa el fallback noches-de-la-salida/días-de-cabecera");

  const inicioDetalle = programasSrc.indexOf("export async function getProgramaDetalle");
  const bloqueDetalle = programasSrc.slice(inicioDetalle);
  assert.match(bloqueDetalle, /dias:\s*s\.noches\s*!=\s*null\s*\?\s*s\.noches\s*:\s*prow\.dias/, "getProgramaDetalle (optSalida) no usa el fallback noches-de-la-salida/días-de-cabecera");

  // Verificación numérica: la MISMA salida (tarifa+regla+modalidad), con
  // `noches` distintas a `dias` de cabecera a propósito, da el MISMO PVP en
  // los dos call-sites cuando ambos aplican el fallback — y un PVP DISTINTO
  // si alguno usara el `dias` de cabecera en su lugar (así se confirma que
  // el fallback realmente importa, no es un detalle sin efecto).
  const tarifa = 1_000_000;
  const regla = { modo: "impuesto" as const, valor: 100_000, pctComision: 10 };
  const modalidadMk: ModalidadMk = "base_neta_impuestos_al_final";
  const nochesSalida = 5;
  const diasCabecera = 2;
  const pvpOptBase = { pctMk: 0.2, pctFee: 0.03, asistenciaDia: 15_000, moneda: "USD" };
  const calc = calcularNetoProgramaConModalidad({ tarifa, ...regla }, modalidadMk);

  const pvpConNochesSalida = pvpPrograma(calc.netoParaMarkup, { ...pvpOptBase, dias: nochesSalida }, calc.montoSinMarkup);
  const pvpConDiasCabecera = pvpPrograma(calc.netoParaMarkup, { ...pvpOptBase, dias: diasCabecera }, calc.montoSinMarkup);
  assert.notEqual(pvpConNochesSalida, pvpConDiasCabecera, "el fallback de días no tiene efecto real en este caso de prueba — ajustar los valores");

  // Ambos call-sites, aplicando el MISMO fallback (`s.noches != null ? s.noches : dias_cabecera`)
  // con noches=5 presente, llegan al mismo PVP: `pvpConNochesSalida`.
  const resumenSimulado = pvpPrograma(calc.netoParaMarkup, { ...pvpOptBase, dias: nochesSalida /* s.noches */ }, calc.montoSinMarkup);
  const detalleSimulado = pvpPrograma(calc.netoParaMarkup, { ...pvpOptBase, dias: nochesSalida /* s.noches */ }, calc.montoSinMarkup);
  assert.equal(resumenSimulado, detalleSimulado);
  assert.equal(resumenSimulado, pvpConNochesSalida);
});

test("wiring: calcularNetoProgramaConModalidad NUNCA reimplementa calcularNetoPrograma — siempre parte de ella", () => {
  const inicio = precioSrc.indexOf("export function calcularNetoProgramaConModalidad");
  const fin = precioSrc.indexOf("export type PvpOpciones");
  const bloque = precioSrc.slice(inicio, fin);
  assert.match(bloque, /calcularNetoPrograma\(input\)/, "no delega en calcularNetoPrograma — riesgo de fórmula duplicada");
  assert.doesNotMatch(bloque, /input\.modo\s*===\s*"pct"/, "reimplementa la lógica de modo en vez de delegar");
  assert.doesNotMatch(bloque, /input\.modo\s*===\s*"impuesto"/, "reimplementa la lógica de modo en vez de delegar");
});

test("wiring: lib/programas.ts re-exporta pvpPrograma/PvpOpciones de lib/calc/programaPrecio.ts, no los reimplementa", () => {
  assert.match(programasSrc, /export\s*\{\s*pvpPrograma,\s*type PvpOpciones\s*\}\s*from\s*"@\/lib\/calc\/programaPrecio"/, "lib/programas.ts no re-exporta pvpPrograma/PvpOpciones desde el módulo compartido");
  assert.doesNotMatch(programasSrc, /export function pvpPrograma\(/, "lib/programas.ts volvió a definir pvpPrograma localmente — riesgo de fórmula duplicada, y el runner de pruebas no podría importarla");
});

test("wiring (defecto 4): el RPC de la migración 161 valida cada tarifa contra base neta negativa antes del DELETE/INSERT", () => {
  const inicioFn = migracion161Src.indexOf("create or replace function public.guardar_programa_salidas");
  const finFn = migracion161Src.indexOf("update public.programas", inicioFn);
  const bloque = migracion161Src.slice(inicioFn, finFn);
  assert.match(bloque, /v_activa and v_modalidad_mk = 'base_neta_impuestos_al_final'/, "el RPC no gatea la validación de tarifas a regla activa + modalidad nueva");
  assert.match(bloque, /base neta negativa/, "el RPC no rechaza con un mensaje sobre base neta negativa");
});

test("wiring (defecto 1): el RPC conserva la modalidad ya guardada cuando el payload no trae la clave modalidadMk", () => {
  const inicioFn = migracion161Src.indexOf("create or replace function public.guardar_programa_salidas");
  const finFn = migracion161Src.indexOf("if v_activa then", inicioFn);
  const bloque = migracion161Src.slice(inicioFn, finFn);
  assert.match(bloque, /if p_regla \? 'modalidadMk' then/, "el RPC no distingue clave presente vs. ausente");
  assert.match(bloque, /select regla_comisionable_modalidad_mk into v_modalidad_mk\s*\n\s*from public\.programas where id = p_programa_id;/, "el RPC no conserva la modalidad ya guardada cuando la clave está ausente");
  assert.doesNotMatch(bloque, /coalesce\(nullif\(p_regla->>'modalidadMk', ''\), 'historica'\)/, "volvió el default silencioso a 'historica' que pisaba la modalidad ya guardada");
});

test("wiring (defecto 4): ACL explícita — revoke from anon además de public", () => {
  const inicio = migracion161Src.lastIndexOf("revoke all on function public.guardar_programa_salidas");
  const bloque = migracion161Src.slice(inicio - 200, inicio + 400);
  assert.match(bloque, /revoke all on function public\.guardar_programa_salidas\(bigint, jsonb, jsonb\) from public;/);
  assert.match(bloque, /revoke all on function public\.guardar_programa_salidas\(bigint, jsonb, jsonb\) from anon;/);
  assert.match(bloque, /grant execute on function public\.guardar_programa_salidas\(bigint, jsonb, jsonb\) to authenticated;/);
});

test("wiring (defecto 4): el CHECK se busca filtrando por conrelid (atado a public.programas), no solo por nombre", () => {
  assert.match(migracion161Src, /where conname = 'programas_regla_comisionable_modalidad_mk_check'\s*\n\s*and conrelid = 'public\.programas'::regclass/, "el chequeo de existencia del CHECK no filtra por conrelid");
});

test("wiring (defecto 4): la columna se audita (tipo/nullable/default) antes de add column if not exists — aborta si ya existe con otra definición", () => {
  const inicio = migracion161Src.indexOf("-- ── 1. Programa: discriminante de modalidad de MK");
  const fin = migracion161Src.indexOf("comment on column public.programas.regla_comisionable_modalidad_mk");
  const bloque = migracion161Src.slice(inicio, fin);
  assert.match(bloque, /from information_schema\.columns/, "no audita la columna contra information_schema antes de tocarla");
  assert.match(bloque, /raise exception/, "la auditoría de la columna no aborta ante una definición incompatible");
});

// ───────────────────────────────────────────────────────────────────────────
// § Persistencia y round-trip desactivar → reactivar (requisito 6/7)
// ───────────────────────────────────────────────────────────────────────────

test("modalidadMk se inicializa desde el programa guardado, con fallback fail-safe a 'historica'", () => {
  assert.match(
    editorSrc,
    /useState<ModalidadMk>\(\s*\n?\s*esModalidadMkValida\(programa\.regla_comisionable_modalidad_mk\)\s*\?\s*programa\.regla_comisionable_modalidad_mk\s*:\s*"historica"/,
    "modalidadMk no se inicializa desde programa.regla_comisionable_modalidad_mk con fallback seguro"
  );
});

const setReglaOnSrc = editorSrc.slice(
  editorSrc.indexOf("const setReglaOn = (v: boolean) => {"),
  editorSrc.indexOf("};", editorSrc.indexOf("const setReglaOn = (v: boolean) => {"))
);

test("al desactivar 'tarifa comisionable', setReglaOn TAMBIÉN restaura modalidadMk desde el programa guardado (mismo criterio que modo/valor/pctComision)", () => {
  assert.match(
    setReglaOnSrc,
    /setModalidadMk\(\s*esModalidadMkValida\(programa\.regla_comisionable_modalidad_mk\)\s*\?\s*programa\.regla_comisionable_modalidad_mk\s*:\s*"historica"\s*\)/,
    "setReglaOn no restaura modalidadMk al desactivar — un borrador de modalidad a medio elegir sobreviviría al apagar el check"
  );
});

test("select de modalidad de MK: la opción nueva usa la etiqueta EXACTA pedida y la histórica tiene una etiqueta comercial distinta y clara", () => {
  assert.match(editorSrc, /<option value="base_neta_impuestos_al_final">MK sobre base neta; impuestos al final<\/option>/, "la etiqueta de la modalidad nueva no es la pedida textualmente");
  const opcionHistorica = editorSrc.match(/<option value="historica">([^<]+)<\/option>/);
  assert.ok(opcionHistorica, "no se encontró la opción histórica del select");
  assert.notEqual(opcionHistorica![1].trim(), "MK sobre base neta; impuestos al final", "las dos etiquetas no pueden ser iguales");
  assert.ok(opcionHistorica![1].length > 5, "la etiqueta histórica debe ser una etiqueta comercial real, no un texto vacío/genérico");
});
