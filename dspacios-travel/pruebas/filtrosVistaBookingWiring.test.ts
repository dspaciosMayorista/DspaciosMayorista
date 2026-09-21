import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Corrección: los filtros (zona/estrellas/pet/adults/condición/política)
// deben aplicar a TODAS las ofertas visibles, incluidos los RECOMENDADOS —
// un recomendado incompatible desaparece sin alterar el orden de los demás
// (`filtrarPorFiltros`, nunca reordena). El selector de "Ordenar por" sigue
// siendo EXCLUSIVO del resto (`ordenarYFiltrarResto`). Pet friendly/Adults
// Only YA NO filtran en `datosBase` (se eliminó `porFiltros` del armado de
// candidatos) — se mezclan en `filtrosVistaEfectivos` y se aplican DESPUÉS,
// igual que zona/estrellas/condición/política.
//
// Y: cambiar/limpiar destino debe PODAR de verdad el estado crudo
// (`filtrosResto`) de las zonas/estrellas que ya no existen — sin useEffect,
// en el mismo handler síncrono que confirma/limpia el destino/búsqueda
// (`podarZonasEstrellas`/`confirmarDestinoBloqueo`/`confirmarBusquedaPorcion`).
// Una zona podada NO debe revivir sola en un destino posterior (la poda real
// del estado crudo, no solo una intersección efímera, ya está probada con
// ejecución real en pruebas/inventarioResto.test.ts).
//
// Verificación por inspección de fuente (sin ejecutar React, sin
// testing-library en este repo) — el cálculo puro en sí ya está cubierto con
// ejecución real; esto confirma el CABLEADO.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");
const vistaBooking = leer("app/tarifario/VistaBooking.tsx");
// Sin comentarios: para buscar USO real de un identificador sin que una
// mención explicativa en un comentario (ej. "ya no filtra por `soloX`")
// produzca un falso positivo.
const sinComentarios = (src: string) => src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const codigoVista = sinComentarios(vistaBooking);

describe("Filtros aplican a recomendados Y resto — misma fuente de filtros efectivos", () => {
  test("tarjetas filtra los recomendados con filtrarPorFiltros y ordena el resto con ordenarYFiltrarResto, usando el MISMO filtrosVistaEfectivos", () => {
    const inicio = vistaBooking.indexOf("const tarjetas = useMemo<Tarjeta[]>(() => {");
    assert.ok(inicio > -1);
    const fin = vistaBooking.indexOf("}, [datosBase, ordenResto, filtrosVistaEfectivos]);", inicio);
    assert.ok(fin > inicio);
    const cuerpo = vistaBooking.slice(inicio, fin);
    assert.match(cuerpo, /filtrarPorFiltros\(datosBase\.itemsRecomendados, filtrosVistaEfectivos\)/, "los recomendados deben filtrarse con filtrosVistaEfectivos");
    assert.match(cuerpo, /ordenarYFiltrarResto\(datosBase\.itemsRestoCandidatos, \{ orden: ordenResto, filtros: filtrosVistaEfectivos \}\)/, "el resto debe ordenarse/filtrarse con el MISMO filtrosVistaEfectivos");
    // Ambas llamadas comparten literalmente el identificador `filtrosVistaEfectivos`
    // — no dos objetos distintos que puedan divergir.
    const usosDelIdentificador = [...cuerpo.matchAll(/filtrosVistaEfectivos/g)].length;
    assert.ok(usosDelIdentificador >= 2, "recomendados y resto deben referenciar el mismo objeto de filtros");
  });

  test("filtrarPorFiltros (recomendados) nunca reordena — solo ordenarYFiltrarResto (resto) pasa por el selector de orden", () => {
    assert.match(vistaBooking, /import \{[\s\S]*ordenarYFiltrarResto, filtrarPorFiltros,[\s\S]*\} from "@\/lib\/tarifario\/inventarioResto";/);
    const inicio = vistaBooking.indexOf("const tarjetas = useMemo<Tarjeta[]>(() => {");
    const fin = vistaBooking.indexOf("}, [datosBase, ordenResto, filtrosVistaEfectivos]);", inicio);
    const cuerpo = vistaBooking.slice(inicio, fin);
    // `filtrarPorFiltros` no recibe `orden` como argumento (a diferencia de
    // `ordenarYFiltrarResto`) — la propia firma del helper lo impide.
    assert.match(cuerpo, /filtrarPorFiltros\(datosBase\.itemsRecomendados, filtrosVistaEfectivos\)\s*\n\s*\.map/, "filtrarPorFiltros no lleva 'orden' — nunca reordena");
  });

  test("las opciones de zona/estrellas del panel salen de recomendados + resto combinados (universoFiltrable) — nunca solo del resto", () => {
    assert.match(vistaBooking, /const universoFiltrable = useMemo\(\s*\n\s*\(\) => \[\.\.\.datosBase\.itemsRecomendados, \.\.\.datosBase\.itemsRestoCandidatos\],/);
    assert.match(vistaBooking, /const zonasRestoDisponibles = useMemo\(\(\) => zonasDisponibles\(universoFiltrable\), \[universoFiltrable\]\);/);
    assert.match(vistaBooking, /const estrellasRestoDisponibles = useMemo\(\(\) => estrellasDisponibles\(universoFiltrable\), \[universoFiltrable\]\);/);
  });

  test("Pet friendly/Adults Only YA NO filtran en datosBase (porFiltros eliminado del armado de candidatos)", () => {
    const inicio = vistaBooking.indexOf("const datosBase = useMemo<{");
    const fin = vistaBooking.indexOf("const zonasRestoDisponibles", inicio);
    const cuerpo = vistaBooking.slice(inicio, fin);
    assert.doesNotMatch(cuerpo, /const porFiltros/, "porFiltros debe eliminarse por completo del armado de candidatos");
    assert.doesNotMatch(cuerpo, /porFiltros\(/, "ningún candidato debe excluirse por pet/adults antes de seleccionar recomendados");
  });

  test("Pet friendly/Adults Only tampoco filtran en los useMemo de hoteles/hotelesUnidadVisibles (fuentes de datosBase)", () => {
    const inicioHoteles = codigoVista.indexOf("const hoteles = useMemo<HotelCard[]>(() => {");
    const finHoteles = codigoVista.indexOf("const hotelesUnidadVisibles = useMemo(() => {", inicioHoteles);
    assert.doesNotMatch(codigoVista.slice(inicioHoteles, finHoteles), /soloPetFriendly|soloAdultsOnly/, "hoteles (persona) no debe filtrar por pet/adults");
    const finUnidad = codigoVista.indexOf("const idsUnidadAutoritativa = new Set(hotelIdsUnidadAutoritativos);", finHoteles);
    assert.doesNotMatch(codigoVista.slice(finHoteles, finUnidad), /soloPetFriendly|soloAdultsOnly/, "hotelesUnidadVisibles no debe filtrar por pet/adults");
  });

  test("filtrosVistaEfectivos mezcla soloPetFriendly/soloAdultsOnly DESPUÉS de filtrosEfectivos (zona/estrellas)", () => {
    assert.match(
      vistaBooking,
      /const filtrosVistaEfectivos = useMemo\(\s*\n\s*\(\) => \(\{\s*\n\s*\.\.\.filtrosEfectivos\(filtrosResto, zonasRestoDisponibles, estrellasRestoDisponibles\),\s*\n\s*petFriendly: soloPetFriendly,\s*\n\s*adultsOnly: soloAdultsOnly,\s*\n\s*\}\),\s*\n\s*\[filtrosResto, zonasRestoDisponibles, estrellasRestoDisponibles, soloPetFriendly, soloAdultsOnly\]\s*\n\s*\);/
    );
  });
});

describe("Poda REAL de zonas/estrellas al cambiar/limpiar destino — SIN useEffect", () => {
  test("no existe ningún useEffect que sincronice filtrosResto/zonas/estrellas", () => {
    // La poda vive en los handlers síncronos que confirman/limpian destino
    // (mismo criterio ya usado por `cambiarSub` para otros estados) — nunca
    // en un efecto reaccionando al cambio.
    const usosEffect = [...vistaBooking.matchAll(/useEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[[^\]]*\]\);/g)];
    for (const m of usosEffect) {
      assert.doesNotMatch(m[0], /setFiltrosResto|podarZonasEstrellas|filtrosResto/, "ningún useEffect debe podar los filtros del panel");
    }
  });

  test("podarZonasEstrellas recorta filtrosResto de verdad (setFiltrosResto con el resultado de filtrosEfectivos, no solo lectura)", () => {
    assert.match(
      vistaBooking,
      /function podarZonasEstrellas\(candidatos: \{ zona: string \| null; estrellas: number \| null \}\[\]\) \{\s*\n\s*setFiltrosResto\(\(prev\) => filtrosEfectivos\(prev, zonasDisponibles\(candidatos\), estrellasDisponibles\(candidatos\)\)\);\s*\n\s*\}/
    );
  });

  test("confirmarDestinoBloqueo y confirmarBusquedaPorcion restablecen zona/estrellas/condición/política al limpiar (estado global), y podan (solo zona/estrellas) al confirmar un destino/búsqueda real", () => {
    assert.match(vistaBooking, /function confirmarDestinoBloqueo\(nuevoDestino: string\) \{/);
    assert.match(vistaBooking, /if \(!nuevoDestino\) \{ restablecerControlesOcultos\(\); return; \}/);
    assert.match(vistaBooking, /function confirmarBusquedaPorcion\(resultado: EstadoBusquedaPorcion \| null\) \{/);
    assert.match(vistaBooking, /if \(!resultado\) \{ restablecerControlesOcultos\(\); return; \}/);
    // Los dos selects de Bloqueo y el buscador de Porción usan los handlers
    // que podan/restablecen — nunca los setters crudos directo desde el JSX.
    assert.match(vistaBooking, /onChange=\{\(e\) => confirmarDestinoBloqueo\(e\.target\.value\)\}/);
    assert.match(vistaBooking, /onBusqueda=\{confirmarBusquedaPorcion\}/);
    assert.doesNotMatch(vistaBooking, /onBusqueda=\{setBusquedaPorcion\}/, "el buscador no debe recibir el setter crudo (se saltaría la poda)");
  });

  test("restablecerControlesOcultos delega en la función pura restablecerFiltrosOcultos (lib/tarifario/inventarioResto.ts) — nunca reimplementa el reseteo inline", () => {
    assert.match(
      vistaBooking,
      /function restablecerControlesOcultos\(\) \{\s*\n\s*setFiltrosResto\(restablecerFiltrosOcultos\);\s*\n\s*\}/
    );
    assert.match(vistaBooking, /import \{[\s\S]*restablecerFiltrosOcultos[\s\S]*\} from "@\/lib\/tarifario\/inventarioResto";/);
  });

  test("cambiar de pestaña poda/restablece SIEMPRE, aunque el ORIGEN sea Bloqueo — nunca solo al salir de Porción terrestre", () => {
    const inicio = vistaBooking.indexOf("function cambiarSub(next: typeof sub) {");
    const fin = vistaBooking.indexOf("function podarZonasEstrellas", inicio);
    assert.ok(inicio > -1 && fin > inicio);
    const cuerpo = vistaBooking.slice(inicio, fin);
    // Ya NO está gateado por `sub === "porcion_terrestre"`: se evalúa el
    // destino de la pestaña `next`, no la que se abandona.
    assert.doesNotMatch(cuerpo, /if \(sub === "porcion_terrestre" && next !== "porcion_terrestre"\) \{\s*\n\s*podarZonasEstrellas/, "no puede seguir gateado solo por salir de Porción terrestre");
    assert.match(cuerpo, /if \(next !== sub\) \{\s*\n\s*if \(next === "bloqueo" && destinoSel\) \{\s*\n\s*podarZonasEstrellas\(candidatosDeBloqueo\(destinoSel\)\);\s*\n\s*\} else \{\s*\n\s*restablecerControlesOcultos\(\);\s*\n\s*\}\s*\n\s*\}/);
  });

  test("un filtro de zona/estrella elegido en Bloqueo no puede sobrevivir al cambiar a Porción terrestre en estado global (nunca afecta silenciosamente el global de la otra pestaña)", () => {
    // Al llegar a "porcion_terrestre" (`next === "porcion_terrestre"`), la
    // rama `if (next === "bloqueo" && destinoSel)` no aplica -> siempre cae
    // en `restablecerControlesOcultos()`, sin importar qué había en Bloqueo.
    const inicio = vistaBooking.indexOf("function cambiarSub(next: typeof sub) {");
    const fin = vistaBooking.indexOf("function podarZonasEstrellas", inicio);
    const cuerpo = vistaBooking.slice(inicio, fin);
    assert.match(cuerpo, /if \(next === "bloqueo" && destinoSel\)/, "solo Bloqueo con destino propio se exime del reseteo — cualquier otro destino cae en restablecerControlesOcultos");
  });

  test("el panel recibe filtrosVistaEfectivos para mostrar (checkboxes/contador), nunca el filtrosResto crudo", () => {
    assert.match(vistaBooking, /<PanelFiltrosResto[\s\S]{0,400}filtros=\{filtrosVistaEfectivos\}/);
    assert.doesNotMatch(vistaBooking, /<PanelFiltrosResto[\s\S]{0,400}filtros=\{filtrosResto\}/, "el panel no debe mostrar el estado crudo sin intersectar");
  });
});
