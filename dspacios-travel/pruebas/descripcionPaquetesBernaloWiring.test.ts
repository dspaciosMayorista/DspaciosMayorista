// ─────────────────────────────────────────────────────────────────────────
// Hallazgo de auditoría (posterior a "tarjeta completa en el motor externo"):
// `descripcionPorPaquete` (lib/tarifario/resumen.ts) solo se carga para
// `paqIdsConHotel` — paquetes con al menos una fila `bloqueo`/`porcion_
// terrestre` en `tarifario_resumen`. Un paquete cuyo ÚNICO hotel es
// `modelo_tarifario='unidad'` nunca genera esas filas (ese modelo no vive en
// `tarifario_resultado`), así que su `paqueteId` puede estar en
// `hotelesBernalo` sin estar en `descripcionPorPaquete` — Incluye/No
// incluye queda vacío en `HotelBernaloCotizarModal` aunque el paquete SÍ
// tenga contenido configurado.
//
// Segunda ronda de auditoría (Codex): la lógica pura (calcular IDs
// faltantes, mapear fila→DescripcionPaqueteRaw, fusionar con legacy) se
// extrajo a `lib/tarifario/descripcionPaquete.ts` y se prueba con EJECUCIÓN
// REAL en `pruebas/descripcionPaquete.test.ts` — este archivo ya NO
// re-verifica esa lógica por texto. Lo que queda acá es exactamente lo que
// no se puede ejecutar bajo `node --test` plano (Server Action/Server
// Component con Supabase/Next, `@/` sin resolver): (1) la consulta SQL en sí
// (`.from("armado_paquetes")...`), (2) que las dos cargas Bernalo
// (fotos/info de hotel y descripción de paquete) se lancen JUNTAS en un
// único `Promise.all` — nunca en serie, y (3) la propagación final del
// resultado hasta `<TarifarioPublic>`.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuenteDatosBernalo = readFileSync(join(raiz, "lib/tarifario/datosBernalo.ts"), "utf8");
const fuentePage = readFileSync(join(raiz, "app/tarifario/page.tsx"), "utf8");

describe("lib/tarifario/datosBernalo.ts — cargarDescripcionPaquetesBernalo: solo la consulta SQL (el mapeo delega en el helper puro)", () => {
  const idxFn = fuenteDatosBernalo.indexOf("export async function cargarDescripcionPaquetesBernalo(");

  test("consulta armado_paquetes con EXACTAMENTE las 4 columnas pedidas (+ id), acotada por .in('id', paqueteIds) — nunca el catálogo completo", () => {
    assert.notEqual(idxFn, -1, "no existe cargarDescripcionPaquetesBernalo");
    const cuerpo = fuenteDatosBernalo.slice(idxFn, idxFn + 900);
    assert.match(cuerpo, /\.from\("armado_paquetes"\)/);
    assert.match(
      cuerpo,
      /\.select\("id, programa_incluye, programa_no_incluye, programa_tarifas_especiales, programa_condiciones_comerciales"\)/
    );
    assert.match(cuerpo, /\.in\("id", paqueteIds\)/);
    // Nunca una consulta sin filtro (`.from("armado_paquetes").select(...)`
    // sin `.in(...)` justo después) — el catálogo completo jamás se pide.
    assert.doesNotMatch(cuerpo, /programa_condiciones_comerciales"\)\s*;/, "el .select() debe encadenar .in(), nunca terminar ahí");
  });

  test("con paqueteIds vacío, devuelve inmediatamente sin consultar (nunca dispara una query con .in('id', []))", () => {
    const cuerpo = fuenteDatosBernalo.slice(idxFn, idxFn + 400);
    assert.match(cuerpo, /if \(!paqueteIds\.length\) return \{ descripcionPorPaquete: \{\}, error: null \};/);
  });

  test("un error técnico devuelve descripcionPorPaquete VACÍO (nunca datos parciales/fabricados) + el mensaje crudo para observabilidad del llamador", () => {
    const cuerpo = fuenteDatosBernalo.slice(idxFn, idxFn + 900);
    assert.match(cuerpo, /if \(error\) return \{ descripcionPorPaquete: \{\}, error: error\.message \};/);
  });

  test("el mapeo fila→shape se DELEGA en el helper puro compartido (filasArmadoPaqueteADescripcionPorPaquete) — esta función ya no re-implementa la transformación inline", () => {
    const cuerpo = fuenteDatosBernalo.slice(idxFn, idxFn + 1200);
    assert.match(cuerpo, /filasArmadoPaqueteADescripcionPorPaquete\(\(data \?\? \[\]\) as unknown as FilaArmadoPaqueteDescripcion\[\]\)/);
    // Nunca un mapeo manual repetido acá (eso divergiría del que ya prueba
    // pruebas/descripcionPaquete.test.ts con ejecución real).
    assert.doesNotMatch(fuenteDatosBernalo.slice(idxFn, fuenteDatosBernalo.indexOf("\n}", idxFn)), /incluye: p\.programa_incluye,/);
  });

  test("importa el helper y el tipo de fila desde lib/tarifario/descripcionPaquete — una sola fuente de verdad para el shape", () => {
    assert.match(
      fuenteDatosBernalo,
      /import \{ filasArmadoPaqueteADescripcionPorPaquete, type DescripcionPaqueteRaw, type FilaArmadoPaqueteDescripcion \} from "\.\/descripcionPaquete\.ts";/
    );
  });

  test("nunca toca precio/disponibilidad ni tablas de cotización Bernalo — solo armado_paquetes", () => {
    const idxFinFn = fuenteDatosBernalo.indexOf("\n}", idxFn);
    const cuerpo = fuenteDatosBernalo.slice(idxFn, idxFinFn);
    assert.doesNotMatch(cuerpo, /hotel_tarifas_unidad|cotizarAlojamientoBernaloPublico|computarReservaBernalo|precio_pvp/);
  });
});

describe("app/tarifario/page.tsx — hilo completo: consulta SQL delegada, Promise.all combinado, propagación a TarifarioPublic", () => {
  test("importa cargarDescripcionPaquetesBernalo desde lib/tarifario/datosBernalo y los helpers puros desde lib/tarifario/descripcionPaquete", () => {
    assert.match(fuentePage, /import \{ cargarHotelesBernaloDescubiertos, cargarInfoHotelesBernalo, cargarDescripcionPaquetesBernalo \} from "@\/lib\/tarifario\/datosBernalo";/);
    assert.match(fuentePage, /import \{ idsPaqueteBernaloFaltantes, fusionarDescripcionPaquete \} from "@\/lib\/tarifario\/descripcionPaquete";/);
  });

  test("descripcionPorPaquete del flujo persona se renombra a descripcionPorPaqueteLegacy (nunca se pisa directamente)", () => {
    assert.match(fuentePage, /descripcionPorPaquete: descripcionPorPaqueteLegacy,/);
  });

  test("ambos conjuntos de IDs (hotelIdsBernalo, paqueteIdsBernaloFaltantes) se calculan usando los helpers puros, ANTES del Promise.all — nunca dentro de él ni derivados de su resultado", () => {
    const idxHotelIds = fuentePage.indexOf("const hotelIdsBernalo = [...new Set(hotelesBernalo.map((h) => h.hotelId))];");
    const idxPaqueteIds = fuentePage.indexOf("const paqueteIdsBernaloFaltantes = idsPaqueteBernaloFaltantes(hotelesBernalo, descripcionPorPaqueteLegacy);");
    const idxPromiseAll = fuentePage.indexOf("const [resultadoInfoBernalo, resultadoDescripcionBernalo] = await Promise.all([");
    assert.notEqual(idxHotelIds, -1);
    assert.notEqual(idxPaqueteIds, -1);
    assert.notEqual(idxPromiseAll, -1);
    assert.ok(idxHotelIds < idxPromiseAll, "hotelIdsBernalo debe calcularse antes del Promise.all");
    assert.ok(idxPaqueteIds < idxPromiseAll, "paqueteIdsBernaloFaltantes debe calcularse antes del Promise.all");
  });

  // ⚠️ Guarda de concurrencia (regla explícita del encargo: "agrega una
  // guarda que falle si vuelven a ejecutarse en serie"). Verifica el patrón
  // EXACTO `const [a, b] = await Promise.all([f(...), g(...)])` — si alguien
  // vuelve a separarlas en dos `await` consecutivos, este test deja de
  // encontrar el patrón y falla.
  test("cargarInfoHotelesBernalo y cargarDescripcionPaquetesBernalo se lanzan JUNTAS en el MISMO Promise.all — nunca una `await` seguida de la otra por separado", () => {
    assert.match(
      fuentePage,
      /const \[resultadoInfoBernalo, resultadoDescripcionBernalo\] = await Promise\.all\(\[\s*\n\s*cargarInfoHotelesBernalo\(hotelIdsBernalo\),\s*\n\s*cargarDescripcionPaquetesBernalo\(paqueteIdsBernaloFaltantes\),\s*\n\s*\]\);/
    );
    // Cada llamada aparece UNA sola vez como CÓDIGO en todo el archivo (los
    // comentarios de esta misma sección mencionan sus nombres para explicar
    // la regla, así que se filtran antes de contar) — si alguien la
    // duplicara fuera del Promise.all (ej. reintroduciendo un `await`
    // aislado más abajo), estas dos aserciones lo detectan.
    const codigoSinComentarios = fuentePage
      .split(/\r?\n/)
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    const usosInfo = [...codigoSinComentarios.matchAll(/cargarInfoHotelesBernalo\(/g)];
    const usosDescripcion = [...codigoSinComentarios.matchAll(/cargarDescripcionPaquetesBernalo\(/g)];
    assert.equal(usosInfo.length, 1, "cargarInfoHotelesBernalo debe invocarse una sola vez, dentro del Promise.all");
    assert.equal(usosDescripcion.length, 1, "cargarDescripcionPaquetesBernalo debe invocarse una sola vez, dentro del Promise.all");
  });

  test("regla 5: la consulta ocurre en el Server Component (page.tsx), nunca en un componente cliente ('use client')", () => {
    assert.doesNotMatch(fuentePage.slice(0, 200), /"use client"/);
  });

  test("la desestructuración de errores/resultado ocurre DESPUÉS del Promise.all (nunca antes, lo que probaría que en verdad esperaron su propio `await` por separado)", () => {
    const idxPromiseAll = fuentePage.indexOf("const [resultadoInfoBernalo, resultadoDescripcionBernalo] = await Promise.all([");
    const idxErrorFotos = fuentePage.indexOf("if (resultadoInfoBernalo.errorFotos)");
    const idxErrorDescripcion = fuentePage.indexOf("if (resultadoDescripcionBernalo.error)");
    assert.ok(idxPromiseAll < idxErrorFotos);
    assert.ok(idxPromiseAll < idxErrorDescripcion);
  });

  test("observabilidad SEPARADA por fuente (mismo criterio que fotos/info): fotos/info de hotel usan sus propios códigos de error, descripción de paquete usa el suyo — nunca un solo catch compartido que mezcle las dos causas", () => {
    assert.match(fuentePage, /registrarErrorTecnico\(FLUJO, flujoId, "datos_auxiliares_pagina", "error_fotos_hoteles_bernalo", resultadoInfoBernalo\.errorFotos\);/);
    assert.match(fuentePage, /registrarErrorTecnico\(FLUJO, flujoId, "datos_auxiliares_pagina", "error_info_hoteles_bernalo", resultadoInfoBernalo\.errorInfo\);/);
    assert.match(fuentePage, /registrarErrorTecnico\(FLUJO, flujoId, "datos_auxiliares_pagina", "error_descripcion_paquetes_bernalo", resultadoDescripcionBernalo\.error\);/);
  });

  test("best-effort: un error técnico de descripción NUNCA hace fallar/bloquear la página (sin return/throw en ese bloque)", () => {
    const idxIf = fuentePage.indexOf("if (resultadoDescripcionBernalo.error) {");
    const idxFinIf = fuentePage.indexOf("}", idxIf);
    const bloque = fuentePage.slice(idxIf, idxFinIf + 1);
    assert.doesNotMatch(bloque, /\breturn\b|\bthrow\b/);
  });

  test("la fusión final usa el helper puro fusionarDescripcionPaquete(nuevas, legacy) — legacy en segunda posición (gana siempre, ver pruebas/descripcionPaquete.test.ts)", () => {
    assert.match(
      fuentePage,
      /const descripcionPorPaquete = fusionarDescripcionPaquete\(resultadoDescripcionBernalo\.descripcionPorPaquete, descripcionPorPaqueteLegacy\);/
    );
  });

  test("precio/disponibilidad Bernalo (EditorPax/cotizarAlojamientoBernaloPublico) no aparecen en ningún CÓDIGO de este bloque — es contenido puramente decorativo (los comentarios SÍ pueden mencionarlos para explicar por qué no se tocan)", () => {
    const idxDecl = fuentePage.indexOf("const hotelIdsBernalo = [...new Set(hotelesBernalo.map((h) => h.hotelId))];");
    const idxFin = fuentePage.indexOf("const descripcionPorPaquete =", idxDecl);
    const bloque = fuentePage.slice(idxDecl, idxFin + 100);
    const codigoSinComentarios = bloque
      .split(/\r?\n/)
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    assert.doesNotMatch(codigoSinComentarios, /cotizarAlojamientoBernaloPublico|EditorPax|precio_pvp|precioVenta/);
  });

  test("TarifarioPublic recibe la variable FUSIONADA descripcionPorPaquete (no descripcionPorPaqueteLegacy)", () => {
    const idxTP = fuentePage.indexOf("<TarifarioPublic");
    const idxFinTP = fuentePage.indexOf("/>", idxTP);
    const propsTP = fuentePage.slice(idxTP, idxFinTP);
    assert.match(propsTP, /descripcionPorPaquete=\{descripcionPorPaquete\}/);
    assert.doesNotMatch(propsTP, /descripcionPorPaquete=\{descripcionPorPaqueteLegacy\}/);
  });
});
