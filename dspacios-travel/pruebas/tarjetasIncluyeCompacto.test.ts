// #52 — Incluye/No incluye COMPACTO en tarjetas: contrato estático (wiring por
// texto contra el código fuente real, mismo patrón que el resto de la suite).
// El comportamiento en pantalla (expandir/colapsar, independencia, cambio de
// oferta) lo prueba la prueba React `tarjetasIncluyeCompacto.react.ts`.
//
// Qué fija este archivo:
//   1) SOLO las dos tarjetas de resultado (`Resultado`, `TarjetaUnidadBusqueda`)
//      envuelven `SeccionesIncluye` en `<IncluyeCompacto>`; los modales
//      (`HotelModal`, `HotelBernaloCotizarModal`) NO — conservan el contenido
//      completo.
//   2) La descripción de la tarjeta sigue saliendo de la oferta/paquete
//      seleccionado (`r.paqueteId` / `opcionSel.paqueteId`), no de un valor
//      recordado por el componente compacto.
//   3) El componente compacto es accesible (botón nativo, aria-expanded,
//      aria-controls) y no toca precios, carrito ni selección.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8").replace(/\r\n/g, "\n");

const fuenteBuscador = leer("app/tarifario/BuscadorBooking.tsx");
const fuenteVista = leer("app/tarifario/VistaBooking.tsx");
const fuenteCompartida = leer("app/tarifario/tarjetaHotelCompartida.tsx");

// Cuerpo de una función balanceando llaves reales (ignora las del tipo de props
// que viven dentro de la lista de parámetros).
function cuerpoFuncion(fuente: string, ancla: string): string {
  const idx = fuente.indexOf(ancla);
  assert.ok(idx > -1, `no se encontró "${ancla}"`);
  let parentesis = 0;
  let inicio = -1;
  for (let i = idx; i < fuente.length; i++) {
    const ch = fuente[i];
    if (ch === "(") parentesis++;
    else if (ch === ")") parentesis--;
    else if (ch === "{" && parentesis === 0) { inicio = i; break; }
  }
  assert.ok(inicio > -1, `no se encontró el cuerpo de "${ancla}"`);
  let profundidad = 0;
  for (let i = inicio; i < fuente.length; i++) {
    if (fuente[i] === "{") profundidad++;
    else if (fuente[i] === "}" && --profundidad === 0) return fuente.slice(idx, i + 1);
  }
  throw new Error(`no se encontró el cierre de "${ancla}"`);
}

const cuerpoResultado = cuerpoFuncion(fuenteBuscador, "export function Resultado({");
const cuerpoTarjetaUnidad = cuerpoFuncion(fuenteVista, "export function TarjetaUnidadBusqueda({");
const cuerpoHotelModal = cuerpoFuncion(fuenteVista, "function HotelModal({");
const cuerpoBernaloModal = cuerpoFuncion(fuenteVista, "function HotelBernaloCotizarModal({");

describe("#52 — dónde se aplica la variante compacta", () => {
  test("Resultado envuelve SeccionesIncluye (paquete fijo r.paqueteId) en <IncluyeCompacto>", () => {
    assert.match(cuerpoResultado, /const descripcionPaquete = descripcionPorPaquete\[r\.paqueteId\];/);
    assert.match(cuerpoResultado, /<IncluyeCompacto>\s*<SeccionesIncluye descripcion=\{descripcionPaquete\} \/>\s*<\/IncluyeCompacto>/);
  });

  test("TarjetaUnidadBusqueda envuelve SeccionesIncluye (paquete de la oferta elegida opcionSel.paqueteId) en <IncluyeCompacto>", () => {
    assert.match(cuerpoTarjetaUnidad, /const descripcionOpcion = descripcionPorPaquete\[opcionSel\.paqueteId\];/);
    assert.match(cuerpoTarjetaUnidad, /<IncluyeCompacto>\s*<SeccionesIncluye descripcion=\{descripcionOpcion\} \/>\s*<\/IncluyeCompacto>/);
  });

  test("los MODALES (HotelModal y HotelBernaloCotizarModal) conservan SeccionesIncluye completo: sin <IncluyeCompacto> ni prop compacto", () => {
    for (const [nombre, cuerpo] of [["HotelModal", cuerpoHotelModal], ["HotelBernaloCotizarModal", cuerpoBernaloModal]] as const) {
      assert.match(cuerpo, /<SeccionesIncluye descripcion=\{descripcion(Opcion|Oferta)\} \/>/, `${nombre} sigue usando SeccionesIncluye`);
      assert.doesNotMatch(cuerpo, /IncluyeCompacto|compacto/, `${nombre} no debe volverse compacto`);
    }
  });

  test("hay exactamente 4 usos de <SeccionesIncluye> (2 tarjetas + 2 modales) y exactamente 2 envoltorios <IncluyeCompacto>", () => {
    const usos = (fuenteVista.match(/<SeccionesIncluye /g) ?? []).length + (fuenteBuscador.match(/<SeccionesIncluye /g) ?? []).length;
    const envoltorios = (fuenteVista.match(/<IncluyeCompacto>/g) ?? []).length + (fuenteBuscador.match(/<IncluyeCompacto>/g) ?? []).length;
    assert.equal(usos, 4);
    assert.equal(envoltorios, 2);
  });

  test("las dos tarjetas importan IncluyeCompacto del módulo compartido (sin duplicar el componente)", () => {
    for (const fuente of [fuenteVista, fuenteBuscador]) {
      assert.match(fuente, /IncluyeCompacto,[^}]*\} from "\.\/tarjetaHotelCompartida"/);
    }
    assert.doesNotMatch(fuenteVista + fuenteBuscador, /function IncluyeCompacto|function SeccionesIncluyeResumen/);
  });

  test("el orden de la tarjeta se conserva: Incluye/No incluye antes de los servicios adicionales", () => {
    assert.ok(cuerpoResultado.indexOf("<IncluyeCompacto>") < cuerpoResultado.indexOf("<AddonsPaquete"));
    assert.ok(cuerpoTarjetaUnidad.indexOf("<IncluyeCompacto>") < cuerpoTarjetaUnidad.indexOf("<AddonsPaquete"));
  });
});

describe("#52 — tarjetaHotelCompartida.tsx", () => {
  const cuerpoSecciones = cuerpoFuncion(fuenteCompartida, "export function SeccionesIncluye({");
  const cuerpoResumen = cuerpoFuncion(fuenteCompartida, "function SeccionesIncluyeResumen({");

  test("SeccionesIncluye es COMPLETA por defecto: solo compacta con compacto=true o dentro de <IncluyeCompacto>", () => {
    assert.match(cuerpoSecciones, /compacto\?: boolean/);
    assert.match(cuerpoSecciones, /if \(compacto \?\? delContexto\) return <SeccionesIncluyeResumen/);
    assert.match(fuenteCompartida, /createContext\(false\)/, "el contexto nace en false (modales completos)");
    assert.match(cuerpoSecciones, /if \(!secciones\.length\) return null;/, "sin contenido no renderiza nada");
  });

  test("el estado de expansión vive en el subcomponente (uno por tarjeta) y se reinicia si cambia la descripción", () => {
    assert.match(cuerpoResumen, /useState\(false\)/);
    assert.match(cuerpoResumen, /if \(firma !== firmaAnterior\)/);
    assert.match(cuerpoResumen, /setExpandido\(false\)/);
    assert.doesNotMatch(fuenteCompartida, /let expandido|globalThis|window\./, "nada de estado compartido entre tarjetas");
  });

  test("el contenido sale de la prop `descripcion` recibida en cada render (no se cachea)", () => {
    assert.match(cuerpoResumen, /seccionesDescripcion\(descripcion\)/);
    assert.match(cuerpoResumen, /<ListaTarjeta secciones=\{secciones\} recortar=\{false\} \/>/, "expandida: TODAS las secciones");
    assert.match(cuerpoResumen, /<ListaTarjeta secciones=\{resumen\.secciones\} recortar refLista=\{refResumen\} \/>/);
    assert.doesNotMatch(cuerpoResumen, /useMemo|localStorage/);
    // Refs solo de DOM (medición/foco) y un indicador booleano; nunca una copia del texto.
    assert.match(cuerpoResumen, /useRef<HTMLDivElement>\(null\)/);
    assert.match(cuerpoResumen, /useRef<HTMLButtonElement>\(null\)/);
    assert.match(cuerpoResumen, /const devolverFoco = useRef\(false\);/);
    assert.equal((cuerpoResumen.match(/useRef/g) ?? []).length, 4);
  });

  test("P2: la tarjeta expandida NO reutiliza el markup de los modales; su texto se ajusta al ancho (min-w-0 + overflow-wrap:anywhere)", () => {
    assert.doesNotMatch(cuerpoResumen, /compacto=\{false\}/);
    const cuerpoLista = cuerpoFuncion(fuenteCompartida, "function ListaTarjeta({");
    assert.match(cuerpoLista, /recortar \? "line-clamp-2 min-w-0 \[overflow-wrap:anywhere\]" : "min-w-0 \[overflow-wrap:anywhere\]"/);
    assert.match(cuerpoLista, /data-recorte=\{recortar \? "" : undefined\}/);
    assert.match(cuerpoLista, /<li key=\{i\} className="flex min-w-0/);
    // Los modales siguen con su markup de siempre.
    const cuerpoSeccionesCompleto = cuerpoFuncion(fuenteCompartida, "export function SeccionesIncluye({");
    assert.match(cuerpoSeccionesCompleto, /<li key=\{i\} className="flex items-center gap-1\.5 text-sm text-gray-700">/);
    assert.doesNotMatch(cuerpoSeccionesCompleto, /ListaTarjeta|overflow-wrap/);
  });

  test("P3: el foco que tenía el botón al desaparecer se lleva a la región del bloque (tabIndex=-1), detectado ANTES de quitarlo", () => {
    assert.match(cuerpoResumen, /if \(!r && !estructural && document\.activeElement === refBoton\.current\) devolverFoco\.current = true;/);
    assert.match(cuerpoResumen, /if \(hayMas \|\| !devolverFoco\.current\) return;/);
    assert.match(cuerpoResumen, /refRegion\.current\?\.focus\(\);/);
    assert.match(cuerpoResumen, /tabIndex=\{-1\}/);
    assert.match(cuerpoResumen, /role="group"/);
    assert.match(cuerpoResumen, /aria-label="Incluye y no incluye"/);
    assert.match(cuerpoResumen, /ref=\{refBoton\}/);
  });

  test("P2: todo ítem recortado tiene salida — el botón depende de la estructura O del recorte MEDIDO, nunca de contar caracteres", () => {
    assert.doesNotMatch(fuenteCompartida, /RESUMEN_MAX_CARACTERES/);
    const fuenteResumir = fuenteCompartida.slice(fuenteCompartida.indexOf("export function resumirSecciones("), fuenteCompartida.indexOf("const IncluyeCompactoContexto"));
    assert.match(fuenteResumir, /items\.length < s\.items\.length/, "solo cuenta ítems ocultos");
    assert.doesNotMatch(fuenteResumir, /it\.length|RESUMEN_MAX_CARACTERES/);
    assert.match(cuerpoResumen, /const estructural = resumen\.hayMas;/);
    assert.match(cuerpoResumen, /const hayMas = estructural \|\| recortado;/);
    assert.match(cuerpoResumen, /\{hayMas && \(/);
    assert.match(cuerpoFuncion(fuenteCompartida, "function ListaTarjeta({"), /data-recorte=\{recortar \? "" : undefined\}/);
    assert.match(cuerpoResumen, /querySelectorAll<HTMLElement>\("\[data-recorte\]"\)/);
    assert.match(cuerpoResumen, /it\.scrollHeight - it\.clientHeight > 1/);
  });

  test("P2: la medición se repite al cambiar ancho, contenido o fuentes, y antes de pintar", () => {
    assert.match(cuerpoResumen, /useLayoutEffect\(/);
    assert.match(cuerpoResumen, /new ResizeObserver\(medir\)/);
    assert.match(cuerpoResumen, /ro\.observe\(el\)/);
    assert.match(cuerpoResumen, /\}, \[firma, abierto, estructural\]\);/);
    assert.match(cuerpoResumen, /document\.fonts\?\.ready/);
    assert.match(cuerpoResumen, /setExpandido\(false\);\s*setRecortado\(false\);/, "descripción nueva: compacta y sin arrastrar la medición anterior");
    assert.match(cuerpoResumen, /ro\.disconnect\(\)/);
  });

  test("el botón es nativo y accesible: type=button, aria-expanded, aria-controls, foco visible, área táctil mínima", () => {
    assert.match(cuerpoResumen, /<button\s+ref=\{refBoton\}\s+type="button"/);
    assert.match(cuerpoResumen, /aria-expanded=\{abierto\}/);
    assert.match(cuerpoResumen, /aria-controls=\{idRegion\}/);
    assert.match(cuerpoResumen, /id=\{idRegion\}/);
    assert.match(cuerpoResumen, /focus-visible:outline-2/);
    assert.match(cuerpoResumen, /min-h-9/);
    assert.match(cuerpoResumen, /"Ver menos" : "Ver más"/);
  });

  test("ancho móvil: los ítems se recortan a 2 líneas y rompen palabras largas", () => {
    assert.match(cuerpoFuncion(fuenteCompartida, "function ListaTarjeta({"), /"line-clamp-2 min-w-0 \[overflow-wrap:anywhere\]"/);
  });

  test("el componente compacto NO toca precio, carrito, selección ni servicios", () => {
    assert.doesNotMatch(cuerpoResumen, /useCart|precio|addConjunto|seleccion|formatMoneda|fetch|buscarReceptivos/i);
    assert.doesNotMatch(cuerpoSecciones, /useCart|precio|addConjunto|seleccion|formatMoneda|fetch|buscarReceptivos/i);
  });

  test("nunca usa dangerouslySetInnerHTML ni emojis (íconos lucide)", () => {
    assert.doesNotMatch(fuenteCompartida, /dangerouslySetInnerHTML/);
    assert.match(cuerpoResumen, /ChevronDown/);
  });
});
