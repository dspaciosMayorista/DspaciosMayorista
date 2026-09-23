import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Corrección: Buscar hotel/Categoría/Alimentación/Acomodación
// (`TarifarioPublic.tsx`) no llegaban a las tarjetas de una búsqueda por
// destino (`EstadoBusquedaPorcion`, armada dentro de `VistaBooking.tsx` a
// partir de `busquedaPorcion.resultados`/`.unidad` — un array que NUNCA pasó
// por el filtrado de `filas` que hace `TarifarioPublic`). Ver
// `lib/tarifario/filtrosBusqueda.ts` (funciones puras, cobertura real en
// pruebas/filtrosBusqueda.test.ts) para el cálculo; esta prueba confirma el
// CABLEADO — en particular la garantía de "prioridades estables" (los
// filtros generales se aplican DESPUÉS de fijar qué ofertas son
// recomendadas, nunca antes) y que "Buscar destino" ahora usa el `<Select>`
// accesible en vez del `<select>` nativo.
//
// Verificación por inspección de fuente (sin ejecutar React, sin
// testing-library en este repo).
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");
const vistaBooking = leer("app/tarifario/VistaBooking.tsx");
const buscadorBooking = leer("app/tarifario/BuscadorBooking.tsx");
const tarifarioPublic = leer("app/tarifario/TarifarioPublic.tsx");
// Sin comentarios `{/* ... */}` (JSX): un comentario explicativo puede
// mencionar literalmente "<select>"/"<option>" en prosa sin que eso sea
// código real — se quitan antes de buscar ausencia de esas etiquetas.
const sinComentariosJsx = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const buscadorBookingSinComentarios = sinComentariosJsx(buscadorBooking);

function cuerpoEntre(src: string, inicioMarcador: string, finMarcador: string): string {
  const inicio = src.indexOf(inicioMarcador);
  assert.ok(inicio > -1, `no se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = src.indexOf(finMarcador, inicio);
  assert.ok(fin > inicio, `no se encontró el marcador de fin: ${finMarcador}`);
  return src.slice(inicio, fin);
}

// Extractor por balanceo de llaves (mismo patrón que
// pruebas/busquedaPorcionTerrestreWiring.test.ts) — más robusto que
// `cuerpoEntre` para aislar el cuerpo COMPLETO de una función, sin depender
// de adivinar dónde termina.
function cuerpoFuncion(ancla: string, fuente: string = vistaBooking): string {
  const idx = fuente.indexOf(ancla);
  assert.ok(idx > -1, `no se encontró "${ancla}"`);
  let profundidadParen = 0;
  let idxLlaveInicial = -1;
  for (let i = idx; i < fuente.length; i++) {
    const ch = fuente[i];
    if (ch === "(") profundidadParen++;
    else if (ch === ")") profundidadParen--;
    else if (ch === "{" && profundidadParen === 0) { idxLlaveInicial = i; break; }
  }
  assert.ok(idxLlaveInicial > -1, `no se encontró el "{" del cuerpo tras "${ancla}"`);
  let profundidad = 0;
  for (let i = idxLlaveInicial; i < fuente.length; i++) {
    if (fuente[i] === "{") profundidad++;
    else if (fuente[i] === "}") {
      profundidad--;
      if (profundidad === 0) return fuente.slice(idx, i + 1);
    }
  }
  throw new Error(`no se encontró el cierre del cuerpo de "${ancla}"`);
}
function cuerpoFuncionVista(ancla: string): string {
  return cuerpoFuncion(ancla, vistaBooking);
}

describe("VistaBooking.tsx — import y props de los filtros generales en modo búsqueda", () => {
  test("importa personaCoincideFiltros/unidadCoincideFiltros desde el módulo puro", () => {
    assert.match(
      vistaBooking,
      /import \{ personaCoincideFiltros, unidadCoincideFiltros, type FiltrosBusquedaBooking, type ComboPersonaElegido \} from "@\/lib\/tarifario\/filtrosBusqueda";/
    );
  });

  test("recibe filtroTexto/filtroCategoria/filtroRegimen como props (además de soloAcom, que ya existía)", () => {
    assert.match(vistaBooking, /filtroTexto\s*=\s*""/);
    assert.match(vistaBooking, /filtroCategoria\s*=\s*""/);
    assert.match(vistaBooking, /filtroRegimen\s*=\s*""/);
    assert.match(vistaBooking, /soloAcom\s*=\s*null/);
  });

  test("el useMemo de datosBase depende de los 4 filtros — cambiar cualquiera recalcula (\"cambio de filtro después de buscar\")", () => {
    assert.match(
      vistaBooking,
      /restriccionPorPaquete, filtroTexto, filtroCategoria, filtroRegimen, soloAcom,\s*\n\s*\]\);/,
      "el array de dependencias del datosBase useMemo debe incluir los 4 filtros generales"
    );
  });
});

describe("VistaBooking.tsx — recomendados se calculan ANTES de aplicar los filtros generales (prioridades estables)", () => {
  test("resultadosPersona/gruposUnidadBusqueda/ofertasConPrioridad/recomendadasBusqueda se construyen sin ninguna referencia a los filtros generales", () => {
    const cuerpo = cuerpoEntre(
      vistaBooking,
      "if (enBusquedaPorcion && busquedaPorcion) {",
      "const filtrosBusqueda: FiltrosBusquedaBooking = {"
    );
    for (const prohibido of ["personaCoincideFiltros", "unidadCoincideFiltros", "filtroTexto", "filtroCategoria", "filtroRegimen", "soloAcom"]) {
      assert.doesNotMatch(
        cuerpo,
        new RegExp(prohibido),
        `${prohibido} no debe aparecer antes de construir recomendadasBusqueda — la selección de recomendados debe usar el universo COMPLETO, sin filtrar`
      );
    }
    // Confirma que el corte de texto realmente incluye el cálculo de
    // recomendados (si el marcador cambiara de nombre, esta prueba debe
    // fallar en vez de pasar vacía por accidente).
    assert.match(cuerpo, /const recomendadasBusqueda = seleccionarRecomendadosPorDestino\(/);
  });

  test("los filtros generales se aplican DESPUÉS, dentro del loop de recomendadasBusqueda, con \"continue\" (hueco) — nunca reconstruyendo la selección", () => {
    const cuerpo = cuerpoEntre(
      vistaBooking,
      "for (const o of recomendadasBusqueda) {",
      "const restoPersonaCandidatas ="
    );
    assert.match(cuerpo, /const m = personaCoincideFiltros\(r, filtrosBusqueda\);/);
    assert.match(cuerpo, /const m = unidadCoincideFiltros\(g, filtrosBusqueda\);/);
    // El patrón de exclusión debe ser "continue" (deja hueco), nunca un
    // filter/splice que reconstruya `recomendadasBusqueda` o reordene el
    // bloque — así una prioridad 1 excluida nunca promueve la 2 a su lugar.
    assert.match(cuerpo, /if \(!m\.coincide\) continue;/);
    assert.doesNotMatch(cuerpo, /recomendadasBusqueda\s*=/, "recomendadasBusqueda nunca se reasigna dentro del loop");
    assert.doesNotMatch(cuerpo, /recomendadasBusqueda\.filter\(/, "recomendadasBusqueda nunca se refiltra — el hueco lo deja el propio loop");
  });

  test("el combo/opción forzada Y RESTRINGIDA por el filtro viajan a la tarjeta — nunca se deja en pantalla, ni seleccionable dentro de la tarjeta, un combo incompatible con el filtro", () => {
    const cuerpo = cuerpoEntre(vistaBooking, "for (const o of recomendadasBusqueda) {", "const restoPersonaCandidatas =");
    assert.match(cuerpo, /catForzada,\s*regForzada,\s*combosRestringidos:\s*m\.combosRestringidos\s*\}\)\)/, "tarjetaPersona recibe catForzada/regForzada/combosRestringidos");
    assert.match(cuerpo, /catForzada,\s*regForzada,\s*opcionesRestringidas:\s*m\.opcionesRestringidas\s*\}\)\)/, "tarjetaUnidad recibe catForzada/regForzada/opcionesRestringidas");
    assert.match(cuerpo, /itemDeBusquedaPersona\(r, m\.comboForzado\?\.total\)/, "el precio de orden/resto usa el combo REALMENTE mostrado, no el default");
    assert.match(cuerpo, /itemDeBusquedaUnidad\(g, m\.opcionForzada\?\.precioVenta\)/);
  });

  test("el 'resto' del inventario SÍ se filtra de entrada (no hay ninguna prioridad que proteger ahí)", () => {
    const cuerpo = cuerpoEntre(vistaBooking, "const restoPersonaCandidatas =", "// ── Exploración (sin búsqueda vigente");
    assert.match(cuerpo, /const m = personaCoincideFiltros\(r, filtrosBusqueda\);\s*\n\s*if \(!m\.coincide\) continue;/);
    assert.match(cuerpo, /const m = unidadCoincideFiltros\(g, filtrosBusqueda\);\s*\n\s*if \(!m\.coincide\) continue;/);
    assert.match(cuerpo, /tarjetaPersona\(r, \{ catForzada, regForzada, combosRestringidos: m\.combosRestringidos \}\)/);
    assert.match(cuerpo, /tarjetaUnidad\(g, \{ catForzada, regForzada, opcionesRestringidas: m\.opcionesRestringidas \}\)/);
  });

  test("Tarjeta/HotelUnidadCard llevan combosRestringidos/opcionesRestringidas en su tipo — no se pierden al pasar por el árbol de tipos", () => {
    assert.match(vistaBooking, /combosRestringidos\?: ComboPersonaElegido\[\] \| null;/);
    assert.match(vistaBooking, /opcionesRestringidas\?: OpcionUnidadConfirmada\[\] \| null;/);
  });

  test("los render call sites pasan combosPermitidos/opcionesPermitidas a Resultado/TarjetaUnidadBusqueda — la restricción realmente llega al componente que dibuja los selectores", () => {
    assert.match(vistaBooking, /combosPermitidos=\{t\.combosRestringidos \?\? undefined\}/);
    assert.match(vistaBooking, /opcionesPermitidas=\{t\.hotel\.opcionesRestringidas \?\? undefined\}/);
  });
});

describe("TarifarioPublic.tsx — pasa sus 3 filtros generales a VistaBooking (además de soloAcom, que ya existía)", () => {
  test("filtroTexto/filtroCategoria/filtroRegimen viajan con los valores reales de estado (q/fCat/fReg)", () => {
    assert.match(tarifarioPublic, /<VistaBooking[^>]*filtroTexto=\{q\}/);
    assert.match(tarifarioPublic, /<VistaBooking[^>]*filtroCategoria=\{fCat\}/);
    assert.match(tarifarioPublic, /<VistaBooking[^>]*filtroRegimen=\{fReg\}/);
    // Guarda de regresión ya existente (no debe romperse por este cambio):
    // hotelesBernalo sigue condicionado EXACTAMENTE igual a fAcom.
    assert.match(tarifarioPublic, /hotelesBernalo=\{fAcom \? \[\] : hotelesBernaloFiltrados\}/);
  });
});

describe("Resultado (BuscadorBooking.tsx) / TarjetaUnidadBusqueda (VistaBooking.tsx) — el selector interno respeta la restricción, nunca vuelve a leer el catálogo completo cuando hay filtro activo", () => {
  test("Resultado: categorias/regimenes/combo derivan de combosEfectivos (combosPermitidos ?? r.combos) — nunca directo de r.combos cuando el filtro está activo", () => {
    assert.match(buscadorBookingSinComentarios, /const combosEfectivos = combosPermitidos \?\? r\.combos;/);
    assert.match(buscadorBookingSinComentarios, /const categorias = useMemo\(\(\) => \[\.\.\.new Set\(combosEfectivos\.map\(\(c\) => c\.categoria\)\)\], \[combosEfectivos\]\);/);
    assert.match(buscadorBookingSinComentarios, /const regimenes = useMemo\(\s*\n\s*\(\) => \[\.\.\.new Set\(combosEfectivos\.filter\(\(c\) => c\.categoria === catEff\)\.map\(\(c\) => c\.regimen\)\)\],\s*\n\s*\[combosEfectivos, catEff\]\s*\n\s*\);/);
  });

  test("Resultado: `cat` (estado, puede quedar obsoleto tras un filtro nuevo) tiene su propio fallback `catEff`, igual patrón que `regEff` — la categoría elegida a mano NUNCA sobrevive a un combosPermitidos que ya la excluyó", () => {
    // Guarda de regresión del hallazgo real: sin este fallback, elegir a mano
    // una categoría y luego angostar el filtro (ej. activar Niño 1) dejaba
    // `cat` apuntando a un valor sin <option>, y `combo` podía terminar
    // resolviendo a `r.combos[0]` — el default sin pasar por el filtro
    // vigente, potencialmente el combo ya excluido (ver
    // pruebas/resultadoInteraccion.test.ts, describe "cambiar filtros con la
    // tarjeta YA montada").
    assert.match(buscadorBookingSinComentarios, /const catEff = categorias\.includes\(cat\) \? cat : \(categorias\[0\] \?\? cat\);/);
    // El <select> de Categoría y el lookup final de `combo` deben leer
    // `catEff`, nunca el `cat` crudo (que puede estar obsoleto).
    assert.match(buscadorBookingSinComentarios, /<select value=\{catEff\} onChange=\{\(e\) => setCat\(e\.target\.value\)\}/);
    assert.match(buscadorBookingSinComentarios, /const combo = r\.combos\.find\(\(c\) => c\.categoria === catEff && c\.regimen === regEff\) \?\? r\.combos\[0\];/);
  });

  test("TarjetaUnidadBusqueda: categorias/alimentaciones/opcionSel derivan de opcionesEfectivas (opcionesPermitidas ?? opciones)", () => {
    const cuerpo = cuerpoFuncionVista("function TarjetaUnidadBusqueda({");
    assert.match(cuerpo, /const opcionesEfectivas = opcionesPermitidas \?\? opciones;/);
    assert.match(cuerpo, /const categorias = useMemo\(\(\) => \[\.\.\.new Set\(opcionesEfectivas\.map\(\(o\) => o\.categoria\)\)\], \[opcionesEfectivas\]\);/);
    assert.match(cuerpo, /const opcionSel = opcionesEfectivas\.find\(\(o\) => o\.categoria === catEff && o\.alimentacion === alimEff\) \?\? opcionesEfectivas\[0\];/);
  });
});

describe("BuscadorBooking.tsx — Destino usa el Select accesible (Base UI), no el <select> nativo", () => {
  test("importa Select/SelectTrigger/SelectValue/SelectContent/SelectItem desde components/ui/select", () => {
    assert.match(buscadorBooking, /import \{ Select, SelectContent, SelectItem, SelectTrigger, SelectValue \} from "@\/components\/ui\/select";/);
  });

  test("el campo Destino usa <Select> controlado (value/onValueChange) con la MISMA lógica de antes (nombre + id, limpiarResultados)", () => {
    const cuerpo = cuerpoEntre(buscadorBookingSinComentarios, '<label id={`${idBase}-destino-label`} className={lbl}>Destino</label>', "</Select>");
    assert.match(cuerpo, /<Select\b/);
    assert.match(cuerpo, /value=\{destino \|\| null\}/);
    assert.match(cuerpo, /onValueChange=\{\(nombre\) => \{/);
    assert.match(cuerpo, /const opcion = destinos\.find\(\(d\) => d\.nombre === nombre\);/, "conserva la resolución del id por la MISMA lista de opciones");
    assert.match(cuerpo, /setDestino\(nombre\);/);
    assert.match(cuerpo, /setDestinoId\(opcion\?\.id \?\? null\);/);
    assert.match(cuerpo, /limpiarResultados\(\);/);
    // Placeholder NO elegible: es la prop `placeholder` de SelectValue, no
    // una opción más de la lista (a diferencia del <option disabled> nativo
    // de antes, que sí vivía dentro del listbox).
    assert.match(cuerpo, /<SelectValue placeholder="Selecciona un destino" \/>/);
    // Sin la bandera `i`: JSX distingue mayúsculas de minúsculas en el
    // nombre de la etiqueta — `<Select`/`<SelectTrigger`/etc. (componentes)
    // NO deben confundirse con `<select`/`<option` (elementos nativos).
    assert.doesNotMatch(cuerpo, /<option\b/, "no debe quedar ningún <option> nativo para Destino");
    assert.doesNotMatch(cuerpo, /<select\b/, "no debe quedar ningún <select> nativo para Destino");
  });

  test("el estado verde de 'valor concreto elegido' sigue aplicado al Trigger (mismo criterio que el resto del shell)", () => {
    const cuerpo = cuerpoEntre(buscadorBooking, '<label id={`${idBase}-destino-label`} className={lbl}>Destino</label>', "</Select>");
    assert.match(cuerpo, /border-\[var\(--brand-success\)\]/);
    assert.match(cuerpo, /bg-\[var\(--brand-success\)\]\/10/);
  });

  test("las demás fechas/pasajeros/habitaciones NO se tocaron (siguen siendo <input>/<select> nativos, fuera de alcance de este ajuste)", () => {
    // "Ida"/"Regreso" (inputs de fecha) y el <select> nativo de Habitación N
    // deben seguir existiendo tal cual — esta corrección es SOLO Destino.
    assert.match(buscadorBooking, /<input type="date" min=\{hoy\} value=\{fIda\}/);
    assert.match(buscadorBooking, /<select value=\{acom\} onChange=\{\(e\) => setHab\(i, e\.target\.value as AcomRoom\)\}/);
  });

  test("cierre de accesibilidad: el <label> 'Destino' y el SelectTrigger comparten idBase vía aria-labelledby — el trigger deja de depender del placeholder/valor para su nombre accesible", () => {
    // `SelectTrigger` (components/ui/select.tsx) renderiza un <button role=
    // "combobox"> — sin esto, un lector de pantalla anuncia el placeholder/
    // valor elegido, nunca el <label> visual "Destino" (huérfano, sin
    // htmlFor/aria-labelledby que lo asocie). Guarda de regresión de la
    // prueba de interacción real: pruebas/buscadorBookingDestinoInteraccion.test.ts.
    assert.match(buscadorBookingSinComentarios, /<label id=\{`\$\{idBase\}-destino-label`\} className=\{lbl\}>Destino<\/label>/);
    const cuerpo = cuerpoEntre(buscadorBookingSinComentarios, '<label id={`${idBase}-destino-label`} className={lbl}>Destino</label>', "</Select>");
    assert.match(cuerpo, /<SelectTrigger\s*\n\s*aria-labelledby=\{`\$\{idBase\}-destino-label`\}/, "el SelectTrigger debe llevar aria-labelledby apuntando al mismo idBase del <label>");
  });
});
