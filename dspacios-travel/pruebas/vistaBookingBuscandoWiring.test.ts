// Wiring por inspección de fuente (VistaBooking.tsx es demasiado grande/con
// demasiados props obligatorios para un montaje real de interacción — mismo
// criterio que pruebas/filtrosVistaBookingWiring.test.ts). El comportamiento
// EJECUTABLE del componente que alimenta este cableado (`onPendingChange` de
// `BuscadorBooking`) ya está probado con render real en
// pruebas/buscadorBookingPendienteInteraccion.test.ts; esto confirma que
// VistaBooking lo conecta correctamente.
//
// Corrección (Preview): al pulsar "Buscar hoteles" en Porción terrestre, el
// botón decía "Buscando…" pero la grilla de EXPLORACIÓN (el catálogo
// completo, no relacionado con la búsqueda) seguía visible — porque
// `onBusqueda(null)` limpia `busquedaPorcion` de forma SÍNCRONA al arrancar
// la búsqueda, y `enBusquedaPorcion` (`busquedaPorcion != null`) es lo único
// que antes decidía "catálogo vs resultados". `buscandoPorcion` (nuevo
// estado, alimentado por `onPendingChange`) cierra ese hueco: mientras esté
// activo, se pinta el isotipo en vez de caer al catálogo.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");
const fuente = leer("app/tarifario/VistaBooking.tsx");
const sinComentarios = (src: string) => src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const codigo = sinComentarios(fuente);

describe("VistaBooking.tsx — buscandoPorcion: isotipo en vez del catálogo de exploración durante la búsqueda", () => {
  test("declara buscandoPorcion como estado propio (no derivado de busquedaPorcion)", () => {
    assert.match(codigo, /const \[buscandoPorcion, setBuscandoPorcion\] = useState\(false\);/);
  });

  test("<BuscadorBooking> recibe onPendingChange={setBuscandoPorcion} — el setter directo, no un wrapper inline nuevo en cada render", () => {
    assert.match(codigo, /<BuscadorBooking[^>]*onPendingChange=\{setBuscandoPorcion\}/);
  });

  test("mientras sub es porcion_terrestre Y buscandoPorcion, se pinta <LoadingScreen fullScreen={false}> en vez del bloque de título+filtros+grilla", () => {
    const idx = codigo.indexOf('sub === "porcion_terrestre" && buscandoPorcion ?');
    assert.notEqual(idx, -1, "debe existir la rama condicional buscandoPorcion");
    const bloque = codigo.slice(idx, idx + 400);
    assert.match(bloque, /<LoadingScreen fullScreen=\{false\}/);
  });

  test("el bloque de exploración (título 'O explora todos los alojamientos', PanelFiltrosResto, grilla de tarjetas) queda en la rama ELSE de esa misma condición — nunca se pinta a la vez que el isotipo", () => {
    const idxCond = codigo.indexOf('sub === "porcion_terrestre" && buscandoPorcion ?');
    const resto = codigo.slice(idxCond);
    const idxElse = resto.indexOf(") : (");
    assert.notEqual(idxElse, -1, "debe existir la rama else de la condición");
    const bloqueElse = resto.slice(idxElse, idxElse + 2000);
    assert.match(bloqueElse, /O explora todos los alojamientos/);
    assert.match(bloqueElse, /<PanelFiltrosResto/);
  });

  test("cambiarSub limpia buscandoPorcion (junto con busquedaPorcion/sugerenciaPedida) al salir de Porción terrestre — retiro por desmontaje del buscador", () => {
    const idx = codigo.indexOf('if (sub === "porcion_terrestre" && next !== "porcion_terrestre")');
    assert.notEqual(idx, -1);
    const bloque = codigo.slice(idx, idx + 300);
    assert.match(bloque, /setBusquedaPorcion\(null\);/);
    assert.match(bloque, /setBuscandoPorcion\(false\);/);
  });

  test("import de LoadingScreen presente", () => {
    assert.match(fuente, /import \{ LoadingScreen \} from "@\/components\/LoadingScreen";/);
  });
});
