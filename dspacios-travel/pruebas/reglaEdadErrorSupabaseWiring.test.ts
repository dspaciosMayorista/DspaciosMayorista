import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Hallazgo #3 de la ronda de validación: toda consulta NUEVA de
// hoteles/tarifa_hotel usada para resolver la regla de edad efectiva debe
// capturar su `error` y fallar cerrado (nunca seguir con `?? []`/`undefined`
// en silencio, que colapsaría un fallo técnico de Supabase en "sin
// override" → fallback general). Verificación por INSPECCIÓN DE FUENTE
// (no ejecutable bajo `node --test` contra Supabase real) — mismo criterio
// que el resto de los "wiring tests" del repo (ver
// pruebas/computoReservaBernaloWiring.test.ts).
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const computo = readFileSync(join(raiz, "lib/reservar/computo.ts"), "utf8");
const cotizar = readFileSync(join(raiz, "lib/reservar/cotizar.ts"), "utf8");
const liquidacionHotel = readFileSync(join(raiz, "lib/reservar/liquidacionHotel.ts"), "utf8");
const reglaEdadTarifa = readFileSync(join(raiz, "lib/calc/reglaEdadTarifa.ts"), "utf8");

describe("computo.ts — cada consulta usada para resolver la regla de edad captura su error y falla cerrado", () => {
  test("rama usarFechas: la consulta a 'hoteles' (regla general) captura error y aborta ANTES de resolver la regla", () => {
    const posDecl = computo.indexOf("const { data: hotelRowF, error: hotelRowFErr } = await sb");
    assert.notEqual(posDecl, -1, "no se encontró la declaración de la consulta de hoteles de la rama usarFechas");
    const bloque = computo.slice(posDecl, posDecl + 400);
    assert.match(bloque, /error:\s*hotelRowFErr/, "debe desestructurar `error` de la consulta");
    assert.match(bloque, /if \(hotelRowFErr\) return \{ ok: false/, "debe fallar cerrado si la consulta de hoteles falla");
  });

  test("rama usarFechas: la consulta a 'tarifa_hotel' (override por temporada) captura error y aborta ANTES de usar sus filas", () => {
    const posDecl = computo.indexOf("const { data: tarEdad, error: tarEdadErr } = await admin");
    assert.notEqual(posDecl, -1, "no se encontró la declaración de la consulta de tarifa_hotel (regla de edad) de la rama usarFechas");
    const bloque = computo.slice(posDecl, posDecl + 500);
    assert.match(bloque, /error:\s*tarEdadErr/, "debe desestructurar `error` de la consulta");
    assert.match(bloque, /if \(tarEdadErr\) return \{ ok: false/, "debe fallar cerrado si la consulta de tarifa_hotel falla");
  });

  test("rama usarFechas: NUNCA resuelve la regla de edad con `tarEdad ?? []` sin haber revisado el error antes", () => {
    const posErrCheck = computo.indexOf("if (tarEdadErr) return");
    const posUso = computo.indexOf("(tarEdad ?? [])");
    assert.notEqual(posErrCheck, -1);
    assert.notEqual(posUso, -1);
    assert.ok(posErrCheck < posUso, "el chequeo de error debe venir ANTES de usar `tarEdad ?? []`");
  });

  test("rama tarifario_resultado: la consulta a 'hoteles' (regla general) captura error y aborta", () => {
    const posDecl = computo.indexOf("const { data: hotelRow, error: hotelRowErr } = await sb");
    assert.notEqual(posDecl, -1, "no se encontró la declaración de la consulta de hoteles de la rama tarifario_resultado");
    const bloque = computo.slice(posDecl, posDecl + 400);
    assert.match(bloque, /error:\s*hotelRowErr/, "debe desestructurar `error`");
    assert.match(bloque, /if \(hotelRowErr\) return \{ ok: false/, "debe fallar cerrado");
  });

  test("rama tarifario_resultado: las consultas de vigencia/tarifa_hotel (Promise.all) capturan AMBOS errores por separado y fallan cerrado", () => {
    const posPromiseAll = computo.indexOf('admin.from("hotel_temporadas").select(');
    assert.notEqual(posPromiseAll, -1);
    const bloque = computo.slice(posPromiseAll - 200, posPromiseAll + 900);
    assert.match(bloque, /error:\s*tempsErr/, "debe desestructurar el error de hotel_temporadas");
    assert.match(bloque, /error:\s*tarRowsErr/, "debe desestructurar el error de tarifa_hotel");
    assert.match(bloque, /if \(tempsErr\) return \{ ok: false/, "debe fallar cerrado si hotel_temporadas falla");
    assert.match(bloque, /if \(tarRowsErr\) return \{ ok: false/, "debe fallar cerrado si tarifa_hotel falla");
  });

  test("ninguna rama usa filasEdadDesdeTarifaHotel (helper local eliminado) — ambas usan el resolutor compartido resolverReglaEdadEstadiaSegura", () => {
    assert.doesNotMatch(computo, /filasEdadDesdeTarifaHotel/, "el helper local que defaulteaba overrides parciales a 0 debe estar eliminado");
    const usos = computo.match(/resolverReglaEdadEstadiaSegura\(/g) ?? [];
    assert.equal(usos.length, 2, "ambas ramas (usarFechas y tarifario_resultado) deben usar el resolutor compartido, exactamente una vez cada una");
  });

  test("las dos ramas usan SOLO las acomodaciones seleccionadas (input.habitaciones > 0) para armar el conjunto de temporadas, nunca la unión global del combo", () => {
    assert.match(computo, /acomsSeleccionadasF = ACOM_ROOMS\.filter/, "rama usarFechas debe filtrar por acomodaciones seleccionadas");
    assert.match(computo, /combo\.temporadasTarifaPorAcom\?\.\[a\]/, "rama usarFechas debe leer temporadasTarifaPorAcom POR acomodación, no una propiedad global");
    assert.doesNotMatch(computo, /combo\.temporadasTarifa\b(?!PorAcom)/, "no debe quedar ninguna referencia a la propiedad global eliminada `temporadasTarifa`");
  });
});

describe("cotizar.ts (buscarHoteles) — la consulta de hoteles/edad captura error y la regla de edad se resuelve POR COMBO", () => {
  test("la consulta a 'hoteles' dentro del bucle principal captura su error y aborta ese par (fail-closed, no engaña con umbral inventado)", () => {
    const pos = cotizar.indexOf('admin.from("hoteles").select("edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, adults_only").eq("id", hotel)');
    assert.notEqual(pos, -1, "no se encontró la consulta de hoteles del bucle principal de buscarHoteles");
    const bloque = cotizar.slice(pos - 300, pos + 400);
    assert.match(bloque, /error:\s*hotelRowErr/);
    assert.match(bloque, /if \(acomCfgErr \|\| hotelRowErr\)/);
    assert.match(bloque, /falloTecnico = true/);
  });

  test("la regla de edad se resuelve DENTRO del bucle de combos (por categoría/régimen), nunca una sola vez por hotel antes del bucle", () => {
    const posBucleCombos = cotizar.indexOf("for (const combo of res.combos)");
    const posResolverRegla = cotizar.indexOf("resolverReglaEdadEstadiaSegura(", posBucleCombos);
    assert.notEqual(posBucleCombos, -1);
    assert.notEqual(posResolverRegla, -1, "resolverReglaEdadEstadiaSegura debe invocarse dentro del bucle de combos");
    assert.ok(posResolverRegla > posBucleCombos, "la resolución de regla de edad debe vivir DENTRO del `for (const combo of res.combos)`");
  });

  test("un combo cuya regla de edad no se pudo resolver se descarta (continue) y NO aborta los demás combos del mismo hotel", () => {
    const posResolverRegla = cotizar.indexOf("resolverReglaEdadEstadiaSegura(");
    const bloque = cotizar.slice(posResolverRegla, posResolverRegla + 900);
    assert.match(bloque, /if \(!rRegla\.ok\)/);
    assert.match(bloque, /algunCombosFalloEdad = true/);
    assert.match(bloque, /continue;/, "debe usar `continue` (saltar el combo), nunca `return`/abortar toda la búsqueda");
  });

  test("clasificarMenoresPorEdad dentro del bucle de combos usa la regla RESUELTA del combo (rRegla.regla), nunca hotelRow.edad_infante_max/edad_nino_max directo", () => {
    const posBucleCombos = cotizar.indexOf("for (const combo of res.combos)");
    const posClasif = cotizar.indexOf("clasificarMenoresPorEdad(edades,", posBucleCombos);
    assert.notEqual(posClasif, -1);
    const linea = cotizar.slice(posClasif, posClasif + 120);
    assert.match(linea, /rRegla\.regla\.infanteMax/);
    assert.match(linea, /rRegla\.regla\.ninoMax/);
    assert.doesNotMatch(linea, /hotelRow\?\.edad_infante_max \?\? 2/, "no debe quedar el umbral fijo hardcodeado dentro del bucle de combos");
  });
});

describe("cotizar.ts (sugerenciasBusquedaGeneral) — reusa datos.tarifas ya cargados, sin consulta nueva por combinación", () => {
  test("ComposicionSugerencia se arma con filasTarifa=datos.tarifas (ya cargado) y generalEdad, nunca edadInfanteMax/edadNinoMax planos", () => {
    const posComposicion = cotizar.indexOf("composicion = {");
    assert.notEqual(posComposicion, -1);
    const bloque = cotizar.slice(posComposicion, posComposicion + 900);
    assert.match(bloque, /filasTarifa:\s*datos\.tarifas/, "debe reusar datos.tarifas ya cargado, sin consulta nueva por combinación");
    assert.match(bloque, /generalEdad:\s*\{/);
    assert.doesNotMatch(bloque, /edadInfanteMax:/, "el campo plano eliminado no debe reaparecer");
  });

  test("la consulta batched a 'hoteles' para el lote de sugerencias ahora selecciona también edad_infante_min/edad_nino_min (general completa, no solo los _max)", () => {
    const pos = cotizar.indexOf('admin.from("hoteles").select("id, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, adults_only")');
    assert.notEqual(pos, -1, "la consulta batched de hoteles debe traer las 4 columnas de la regla general, no solo los _max");
  });
});

describe("liquidacionHotel.ts — compatibleConComposicion resuelve la regla de edad POR COMBO, fail-closed", () => {
  test("compatibleConComposicion importa y usa resolverReglaEdadEstadiaSegura del módulo compartido", () => {
    assert.match(liquidacionHotel, /import \{\s*\n?\s*resolverReglaEdadEstadiaSegura/, "debe importar el resolutor compartido");
    const posFn = liquidacionHotel.indexOf("function compatibleConComposicion");
    assert.notEqual(posFn, -1);
    const cuerpo = liquidacionHotel.slice(posFn, posFn + 2000);
    assert.match(cuerpo, /resolverReglaEdadEstadiaSegura\(/, "debe invocar el resolutor dentro de compatibleConComposicion");
    assert.match(cuerpo, /if \(!rRegla\.ok\) continue;/, "un combo con regla ambigua se descarta (continue), nunca bloquea toda la composición");
  });

  test("el conjunto de temporadasUsadas se arma SOLO de las acomodaciones consultadas (porAcom), nunca de todo el combo", () => {
    const posFn = liquidacionHotel.indexOf("function compatibleConComposicion");
    const cuerpo = liquidacionHotel.slice(posFn, posFn + 2000);
    assert.match(cuerpo, /for \(const acom of porAcom\.keys\(\)\) for \(const t of combo\.temporadasTarifaPorAcom\?\.\[acom\] \?\? \[\]\) temporadasUsadas\.add\(t\)/);
  });
});

describe("reglaEdadTarifa.ts — resolverReglaEdadEstadiaSegura nunca defaultea columnas faltantes a 0", () => {
  test("un override parcial (algún valor no-null y otro null) produce un error explícito, nunca `?? 0`", () => {
    const posFn = reglaEdadTarifa.indexOf("export function resolverReglaEdadEstadiaSegura");
    assert.notEqual(posFn, -1);
    const cuerpo = reglaEdadTarifa.slice(posFn, posFn + 3000);
    assert.match(cuerpo, /algunoConValor && !todosConValor/);
    assert.doesNotMatch(cuerpo, /\?\? 0/, "no debe haber ningún default silencioso a 0 en esta función");
  });

  test("una fila faltante (temporada usada sin fila) y una fila duplicada tienen mensajes de error DISTINTOS y explícitos", () => {
    const posFn = reglaEdadTarifa.indexOf("export function resolverReglaEdadEstadiaSegura");
    const cuerpo = reglaEdadTarifa.slice(posFn, posFn + 3000);
    assert.match(cuerpo, /candidatas\.length === 0/);
    assert.match(cuerpo, /candidatas\.length > 1/);
    assert.match(cuerpo, /No se encontró la fila de tarifa/);
    assert.match(cuerpo, /configuración ambigua \(temporada duplicada\)/);
  });
});
