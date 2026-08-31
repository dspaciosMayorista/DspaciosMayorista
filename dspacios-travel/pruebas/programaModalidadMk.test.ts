import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  calcularNetoPrograma,
  calcularNetoProgramaConModalidad,
  validarReglaComisionable,
  esModalidadMkValida,
  MODALIDADES_MK,
  type ModalidadMk,
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
// `pvpPrograma` real vive en lib/programas.ts, que importa `@/types/database`
// por alias de tsconfig — el runner de pruebas (`node --test
// --experimental-strip-types`, sin resolución de paths) no puede cargarlo
// directo, igual que el resto de este archivo de pruebas evita importar ese
// módulo (ver programaTarifaComisionable.test.ts: solo lee su código fuente
// como texto para las pruebas de wiring). Acá se necesita además EJECUTAR la
// fórmula para probar los números exactos del pedido — se replica localmente
// línea por línea, y `pvpProgramaLocal` se contrasta byte a byte contra el
// código fuente real más abajo (§ Wiring) para que un cambio futuro en
// lib/programas.ts que no se refleje acá haga fallar la prueba, en vez de
// dejar que las dos versiones diverjan en silencio.
// ───────────────────────────────────────────────────────────────────────────

type PvpOpcionesLocal = { pctMk: number; asistenciaDia?: number; dias?: number | null; pctFee?: number; moneda?: string | null };

function redondearPvpLocal(valor: number, moneda: string | null | undefined): number {
  return moneda === "USD" ? Math.ceil(valor) : Math.ceil(valor / 1000) * 1000;
}

function pvpPrograma(neto: number, opt: PvpOpcionesLocal, montoSinMarkup = 0): number {
  if (!(Number(neto) > 0)) return 0;
  const mk = Number(opt.pctMk) || 0;
  const fee = Number(opt.pctFee) || 0;
  const asis = Number(opt.asistenciaDia) || 0;
  const dias = Math.max(0, Number(opt.dias) || 0);
  const extra = Number(montoSinMarkup) || 0;

  let sub = neto + asis * dias;
  if (mk > 0 && mk < 1) sub = sub / (1 - mk);
  sub += extra;
  if (fee > 0 && fee < 1) sub = sub / (1 - fee);
  return redondearPvpLocal(sub, opt.moneda);
}

const EJEMPLO_DUEÑO = { tarifa: 1_000_000, modo: "impuesto" as const, valor: 100_000, pctComision: 10 };
// moneda "USD" (redondeo al entero hacia arriba) en vez de dejarla en blanco
// (COP redondea al millar hacia arriba) — los números EXACTOS del ejemplo del
// dueño (1.137.500 / 1.112.500) no son múltiplos de 1000, así que con COP el
// redondeo de moneda los distorsionaría (a 1.138.000/1.113.000) por una razón
// AJENA a la modalidad de MK que se está probando. Con USD, al ser ya enteros,
// el `Math.ceil` es un no-op y se reproduce el ejemplo tal cual.
const MK_20 = { pctMk: 0.2, pctFee: 0, asistenciaDia: 0, dias: 0, moneda: "USD" };

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

test("modalidad histórica: SIN REGRESIÓN — netoParaMarkup = neto de siempre, montoSinMarkup = 0", () => {
  const c = calcularNetoProgramaConModalidad(EJEMPLO_DUEÑO, "historica");
  assert.equal(c.netoParaMarkup, c.neto);
  assert.equal(c.montoSinMarkup, 0);
  // PVP histórico == fórmula del dueño: (810.000 + 100.000) / 0,80 = 1.137.500
  assert.equal(pvpPrograma(c.netoParaMarkup, MK_20, c.montoSinMarkup), 1_137_500);
  // Y es IDÉNTICO a llamar pvpPrograma sin el 3er argumento (comportamiento de siempre).
  assert.equal(pvpPrograma(c.netoParaMarkup, MK_20), 1_137_500);
});

test("modalidad nueva: reproduce EXACTAMENTE el ejemplo del dueño — 810.000/0,80 + 100.000 = 1.112.500", () => {
  const c = calcularNetoProgramaConModalidad(EJEMPLO_DUEÑO, "base_neta_impuestos_al_final");
  assert.equal(c.netoParaMarkup, 810_000); // baseNeta
  assert.equal(c.montoSinMarkup, 100_000); // montoNoComisionable
  assert.equal(pvpPrograma(c.netoParaMarkup, MK_20, c.montoSinMarkup), 1_112_500);
});

test("ambas modalidades producen resultados DISTINTOS cuando impuestos>0 y MK>0", () => {
  const hist = calcularNetoProgramaConModalidad(EJEMPLO_DUEÑO, "historica");
  const nueva = calcularNetoProgramaConModalidad(EJEMPLO_DUEÑO, "base_neta_impuestos_al_final");
  const pvpHist = pvpPrograma(hist.netoParaMarkup, MK_20, hist.montoSinMarkup);
  const pvpNueva = pvpPrograma(nueva.netoParaMarkup, MK_20, nueva.montoSinMarkup);
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
  const pvpHist = pvpPrograma(hist.netoParaMarkup, MK_20, hist.montoSinMarkup);
  const pvpNueva = pvpPrograma(nueva.netoParaMarkup, MK_20, nueva.montoSinMarkup);
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
  // USD para que el redondeo (entero hacia arriba) no enmascare el resultado
  // como sí pasaría en COP (redondeo al millar).
  const conMkAlto = pvpPrograma(100, { pctMk: 0.5, moneda: "USD" }, 40);
  const sinMk = pvpPrograma(100, { pctMk: 0, moneda: "USD" }, 40);
  // Con mk=0.5: 100/0.5=200, +40=240. Con mk=0: 100 (sin dividir), +40=140.
  assert.equal(conMkAlto, 240);
  assert.equal(sinMk, 140);
  // La diferencia (100) es EXACTAMENTE el cambio en la porción marcada
  // (200-100=100) — el monto sin marcar (40) es idéntico en ambos casos.
  assert.equal(conMkAlto - sinMk, 100);
});

test("el fee bancario SÍ sigue aplicando sobre el total, incluido el monto sin markup", () => {
  const conFee = pvpPrograma(100, { pctMk: 0, pctFee: 0.5, moneda: "USD" }, 40);
  const sinFee = pvpPrograma(100, { pctMk: 0, pctFee: 0, moneda: "USD" }, 40);
  // sinFee: 100 + 40 = 140. conFee: 140 / (1-0.5) = 280.
  assert.equal(sinFee, 140);
  assert.equal(conFee, 280);
});

test("pvpPrograma(neto, opt) === pvpPrograma(neto, opt, 0): el 3er argumento es un no-op por defecto", () => {
  const casos: [number, Parameters<typeof pvpPrograma>[1]][] = [
    [500_000, { pctMk: 0.25, pctFee: 0.03, asistenciaDia: 5000, dias: 4, moneda: "COP" }],
    [200, { pctMk: 0.1, moneda: "USD" }],
    [0, { pctMk: 0.5 }], // neto<=0 → 0 en ambos casos
    [123.45, { pctMk: 0, pctFee: 0 }],
  ];
  for (const [neto, opt] of casos) {
    assert.equal(pvpPrograma(neto, opt), pvpPrograma(neto, opt, 0), `diverge para neto=${neto}`);
  }
});

test("todos los programas EXISTENTES (modalidad histórica implícita) conservan el comportamiento byte a byte", () => {
  // Simula la ruta real: getProgramaDetalle/pvpDeSalida cae siempre al camino
  // de siempre cuando la regla está inactiva o la modalidad es 'historica' —
  // nunca llama calcularNetoProgramaConModalidad en ese caso. Aquí se prueba
  // el equivalente: pedir la modalidad 'historica' explícita debe dar,
  // matemáticamente, el mismo PVP que el camino viejo (pvpPrograma(neto, opt)
  // directo con el `neto` ya persistido, sin pasar por la calculadora).
  const casosReales = [
    { tarifa: 300, modo: "pct" as const, valor: 5, pctComision: 8 },
    { tarifa: 1_500_000, modo: "impuesto" as const, valor: 599_000, pctComision: 15 },
    { tarifa: 80, modo: "ninguno" as const, valor: 0, pctComision: 20 },
  ];
  for (const input of casosReales) {
    const netoPersistido = calcularNetoPrograma(input).neto;
    const viejo = pvpPrograma(netoPersistido, MK_20);
    const c = calcularNetoProgramaConModalidad(input, "historica");
    const nuevo = pvpPrograma(c.netoParaMarkup, MK_20, c.montoSinMarkup);
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
  // mk=1 (100%) dividiría por 0 — pvpPrograma ya blindaba esto (mk>0 && mk<1);
  // el 3er argumento no cambia ese blindaje.
  assert.equal(pvpPrograma(100, { pctMk: 1, moneda: "USD" }, 20), 120);
  assert.equal(pvpPrograma(100, { pctMk: -0.5, moneda: "USD" }, 20), 120);
  assert.equal(pvpPrograma(100, { pctMk: 1.5, moneda: "USD" }, 20), 120);
});

test("impuestos >= tarifa (modo 'impuesto' sin tope, ya permitido desde la 151): baseNeta puede quedar <= 0, y pvpPrograma FALLA CERRADO devolviendo 0, nunca un precio negativo", () => {
  const input = { tarifa: 100_000, modo: "impuesto" as const, valor: 500_000, pctComision: 10 };
  const c = calcularNetoProgramaConModalidad(input, "base_neta_impuestos_al_final");
  assert.ok(c.baseNeta <= 0, "el escenario debe producir una base neta no positiva");
  // pvpPrograma exige neto > 0 antes de calcular nada — con netoParaMarkup <= 0
  // devuelve 0 en vez de fabricar un PVP con un componente negativo.
  assert.equal(pvpPrograma(c.netoParaMarkup, MK_20, c.montoSinMarkup), 0);
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
  // baseNeta + montoNoComisionable debe reconstruir el neto histórico exacto
  // (redondeado a 2 decimales, mismo criterio que el resto del módulo).
  assert.equal(Math.round((c.baseNeta + c.montoNoComisionable) * 100) / 100, c.neto);
  assert.ok(Number.isFinite(c.baseNeta) && Number.isFinite(c.montoNoComisionable));
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
  // Con activa=false y TODO lo demás en blanco, la única razón de rechazo
  // posible es la modalidad — confirma que el chequeo de modalidad no queda
  // detrás del early-return de `!activa`.
  const r = validarReglaComisionable({ activa: false, modo: "pct", valor: null, pctComision: null, modalidadMk: "bogus" as unknown as ModalidadMk });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /modalidad/i);
});

// ───────────────────────────────────────────────────────────────────────────
// § Comisión porcentual (requisito 10 — "conserva sin cambios"): este
// codebase solo tiene comisión PORCENTUAL (`pctComision`); no existe un modo
// de comisión por "valor fijo" separado — `modo` decide la BASE comisionable
// (pct/impuesto/ninguno), no la forma de la comisión en sí. Se deja
// documentado acá para que quede explícito que no se inventó ni se tocó.
// ───────────────────────────────────────────────────────────────────────────

test("la comisión sigue siendo SIEMPRE porcentual (pctComision) en los 3 modos, sin variante de valor fijo — sin cambios", () => {
  for (const modo of ["pct", "impuesto", "ninguno"] as const) {
    const c = calcularNetoPrograma({ tarifa: 100_000, modo, valor: 5, pctComision: 10 });
    // La comisión es siempre base*(pct/100); nunca un monto fijo.
    assert.equal(c.comision, Math.round(c.baseComisionable * 0.10 * 100) / 100);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// § Wiring — misma función pura en los 4 puntos de consumo (requisito 8):
// editor en vivo, validación cliente, validación servidor, generación real.
// Sin acceso a una BD real desde estas pruebas unitarias, se comprueba por
// fuente (mismo patrón ya usado en programaTarifaComisionable.test.ts).
// ───────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const editorSrc = readFileSync(join(raiz, "app/(dashboard)/dashboard/producto/programas/[id]/ProgramaEditor.tsx"), "utf8");
const actionsSrc = readFileSync(join(raiz, "app/(dashboard)/dashboard/producto/programas/actions.ts"), "utf8");
const programasSrc = readFileSync(join(raiz, "lib/programas.ts"), "utf8");
const precioSrc = readFileSync(join(raiz, "lib/calc/programaPrecio.ts"), "utf8");

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

test("wiring: la Server Action valida modalidadMk como unknown ANTES de pasarla a validarReglaComisionable", () => {
  const inicio = actionsSrc.indexOf("export async function guardarSalidas");
  const bloque = actionsSrc.slice(inicio, actionsSrc.indexOf("const sb = await createClient();", inicio));
  assert.match(bloque, /const\s+modalidadMkRaw:\s*unknown/, "no trata modalidadMk como unknown en la frontera");
  assert.match(bloque, /esModalidadMkValida\(modalidadMkRaw\)/, "no valida modalidadMk con el type guard antes de usarla");
  assert.match(bloque, /validarReglaComisionable\(\{[\s\S]*?modalidadMk:\s*modalidadMkRaw/, "no repite validarReglaComisionable con la modalidad ya angosta");
});

test("wiring: la generación real del tarifario (lib/programas.ts) llama a calcularNetoProgramaConModalidad, no reimplementa la fórmula", () => {
  assert.match(programasSrc, /import\s*\{[^}]*calcularNetoProgramaConModalidad[^}]*\}\s*from\s*"@\/lib\/calc\/programaPrecio"/, "getProgramaDetalle no importa la función compartida");
  const inicio = programasSrc.indexOf("const pvpDeSalida = ");
  const fin = programasSrc.indexOf("const salidas = (salidasRaw");
  const bloque = programasSrc.slice(inicio, fin);
  assert.match(bloque, /calcularNetoProgramaConModalidad\(/, "pvpDeSalida no llama a la función compartida");
  assert.match(bloque, /pvpPrograma\(calc\.netoParaMarkup,\s*optSalida,\s*calc\.montoSinMarkup\)/, "pvpDeSalida no pasa netoParaMarkup/montoSinMarkup a pvpPrograma");
});

test("fidelidad: pvpProgramaLocal (usado en estas pruebas) reproduce EXACTAMENTE las 4 líneas del pvpPrograma real", () => {
  // No se puede `import` lib/programas.ts en el runner de pruebas (usa el
  // alias `@/`, ver comentario del encabezado), así que los números exactos
  // de este archivo se calculan con una copia local. Esta prueba es la que
  // impide que esa copia diverja en silencio del código real: si alguien
  // cambia el orden de las 4 líneas de `pvpPrograma` (mk → extra → fee) sin
  // actualizar el mirror de este archivo, esto falla.
  const inicio = programasSrc.indexOf("export function pvpPrograma(");
  const fin = programasSrc.indexOf("\n}", programasSrc.indexOf("return redondearPvp(sub, opt.moneda);"));
  const bloque = programasSrc.slice(inicio, fin);
  assert.match(bloque, /let sub = neto \+ asis \* dias;/, "cambió el punto de partida de `sub`");
  assert.match(bloque, /if \(mk > 0 && mk < 1\) sub = sub \/ \(1 - mk\);/, "cambió la condición\\/fórmula del paso de MK");
  assert.match(bloque, /sub \+= extra;/, "cambió cómo se suma el monto sin markup");
  assert.match(bloque, /if \(fee > 0 && fee < 1\) sub = sub \/ \(1 - fee\);/, "cambió la condición\\/fórmula del paso de fee");
  assert.match(bloque, /return redondearPvp\(sub, opt\.moneda\);/, "cambió el redondeo final");
  // Y el orden relativo (mk antes que extra, extra antes que fee) es el que
  // hace que "los impuestos no reciben MK, pero sí fee" — se verifica aparte.
  const idxMk = bloque.indexOf("sub / (1 - mk)");
  const idxExtra = bloque.indexOf("sub += extra;");
  const idxFee = bloque.indexOf("sub / (1 - fee)");
  assert.ok(idxMk > -1 && idxExtra > idxMk && idxFee > idxExtra, "el orden mk → extra → fee cambió");
});

test("wiring: calcularNetoProgramaConModalidad NUNCA reimplementa calcularNetoPrograma — siempre parte de ella", () => {
  const inicio = precioSrc.indexOf("export function calcularNetoProgramaConModalidad");
  const fin = precioSrc.indexOf("export function recalcularNetosPorTarifa");
  const bloque = precioSrc.slice(inicio, fin);
  assert.match(bloque, /calcularNetoPrograma\(input\)/, "no delega en calcularNetoPrograma — riesgo de fórmula duplicada");
  // No debe recalcular `base` con la aritmética de tarifa/modo/valor por su cuenta.
  assert.doesNotMatch(bloque, /input\.modo\s*===\s*"pct"/, "reimplementa la lógica de modo en vez de delegar");
  assert.doesNotMatch(bloque, /input\.modo\s*===\s*"impuesto"/, "reimplementa la lógica de modo en vez de delegar");
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
