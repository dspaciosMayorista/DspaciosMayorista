// ─────────────────────────────────────────────────────────────────────────
// Corrección visual (confirmada en Vercel Preview): las tarjetas completas
// podían crecer demasiado por la descripción, el mapa, Incluye/No incluye y
// la lista de servicios add-on. Se agregan controles expandibles para
// descripción (`DescripcionHotelExpandible`) y add-ons (`AddonsPaquete`,
// ahora colapsable) en `app/tarifario/tarjetaHotelCompartida.tsx` — el
// mismo archivo ya compartido entre las 4 superficies (HotelModal,
// HotelBernaloCotizarModal, Resultado, TarjetaUnidadBusqueda).
//
// Wiring por texto/regex contra el código fuente real: este repo no tiene
// entorno de DOM (`node --test` plano, sin jsdom/React Testing Library),
// así que el comportamiento de `ResizeObserver`/`scrollHeight` no se puede
// ejecutar de verdad — se verifica que el código implementa EXACTAMENTE el
// mecanismo pedido (detección real de desborde, recálculo por ancho, estado
// por instancia, cierre automático por cambio de paquete), mismo criterio
// que el resto de la suite para componentes React de este proyecto.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const fuenteCompartida = leer("app/tarifario/tarjetaHotelCompartida.tsx");
const fuenteVista = leer("app/tarifario/VistaBooking.tsx");
const fuenteBuscador = leer("app/tarifario/BuscadorBooking.tsx");

function cuerpoFuncion(fuenteCompleta: string, ancla: string): string {
  const idx = fuenteCompleta.indexOf(ancla);
  assert.ok(idx > -1, `no se encontró "${ancla}"`);
  let profundidadParen = 0;
  let idxLlaveInicial = -1;
  for (let i = idx; i < fuenteCompleta.length; i++) {
    const ch = fuenteCompleta[i];
    if (ch === "(") profundidadParen++;
    else if (ch === ")") profundidadParen--;
    else if (ch === "{" && profundidadParen === 0) { idxLlaveInicial = i; break; }
  }
  assert.ok(idxLlaveInicial > -1, `no se encontró el "{" del cuerpo tras "${ancla}"`);
  let profundidad = 0;
  for (let i = idxLlaveInicial; i < fuenteCompleta.length; i++) {
    if (fuenteCompleta[i] === "{") profundidad++;
    else if (fuenteCompleta[i] === "}") {
      profundidad--;
      if (profundidad === 0) return fuenteCompleta.slice(idx, i + 1);
    }
  }
  throw new Error(`no se encontró el cierre del cuerpo de "${ancla}"`);
}

const cuerpoDescripcion = cuerpoFuncion(fuenteCompartida, "export function DescripcionHotelExpandible({");
const cuerpoAddons = cuerpoFuncion(fuenteCompartida, "export function AddonsPaquete({");

describe("DescripcionHotelExpandible — estado inicial contraído a 2 líneas, Ver más/Ver menos por desborde REAL", () => {
  test("arranca contraído: useState(false) para `expandido`, sin ningún valor inicial en true", () => {
    assert.match(cuerpoDescripcion, /const \[expandido, setExpandido\] = useState\(false\);/);
  });

  test("aplica line-clamp-2 SOLO mientras no está expandido — nunca un truncado por cantidad arbitraria de caracteres (substring/slice)", () => {
    assert.match(cuerpoDescripcion, /className=\{expandido \? textClassName : `line-clamp-2 \$\{textClassName\}`\}/);
    assert.doesNotMatch(cuerpoDescripcion, /\.slice\(0,|\.substring\(0,|\.substr\(/, "nunca debe truncar el texto por cantidad de caracteres");
  });

  test("detecta desborde REAL midiendo el elemento renderizado (scrollHeight vs clientHeight) — no una heurística de longitud de texto", () => {
    assert.match(cuerpoDescripcion, /const medir = \(\) => setDesborda\(el\.scrollHeight - el\.clientHeight > 1\);/);
    assert.doesNotMatch(cuerpoDescripcion, /texto\.length|\.length > \d+/, "nunca debe decidir el desborde por la longitud del string");
  });

  test("recalcula cuando cambia el ancho disponible: observa el elemento con ResizeObserver (no solo al montar)", () => {
    assert.match(cuerpoDescripcion, /if \(typeof ResizeObserver === "undefined"\) return;/);
    assert.match(cuerpoDescripcion, /const ro = new ResizeObserver\(medir\);/);
    assert.match(cuerpoDescripcion, /ro\.observe\(el\);/);
    assert.match(cuerpoDescripcion, /return \(\) => ro\.disconnect\(\);/, "debe desconectar el observer al desmontar/re-ejecutar el efecto");
  });

  test("el control 'Ver más'/'Ver menos' SOLO aparece cuando desborda === true — nunca cuando el texto cabe completo en 2 líneas", () => {
    const idxBoton = cuerpoDescripcion.indexOf("{desborda && (");
    assert.notEqual(idxBoton, -1, "el botón debe estar condicionado a `desborda`");
    const bloqueBoton = cuerpoDescripcion.slice(idxBoton, idxBoton + 400);
    assert.match(bloqueBoton, /type="button"/);
    assert.match(bloqueBoton, /aria-expanded=\{expandido\}/);
    assert.match(bloqueBoton, /onClick=\{\(\) => setExpandido\(\(v\) => !v\)\}/);
    assert.match(bloqueBoton, /\{expandido \? "Ver menos" : "Ver más"\}/);
  });

  test("'Ver menos' vuelve a 2 líneas: es el MISMO estado `expandido` el que gobierna tanto el texto (line-clamp) como la etiqueta del botón — un solo toggle, sin estados duplicados", () => {
    const ocurrenciasExpandido = [...cuerpoDescripcion.matchAll(/\bexpandido\b/g)];
    assert.ok(ocurrenciasExpandido.length >= 4, "expandido debe controlar tanto el className del texto como la etiqueta/aria del botón");
  });

  test("sin texto (null/undefined/vacío) no renderiza nada — nunca un contenedor vacío ni un botón sin contenido que mostrar", () => {
    assert.match(cuerpoDescripcion, /if \(!texto\?\.trim\(\)\) return null;/);
  });

  test("estado independiente por tarjeta: expandido/desborda/refTexto son estado LOCAL del componente (useState/useRef) — nunca una variable de módulo compartida entre instancias", () => {
    assert.doesNotMatch(fuenteCompartida.slice(0, fuenteCompartida.indexOf("export function DescripcionHotelExpandible")), /let expandido|let desborda/);
    assert.match(cuerpoDescripcion, /const refTexto = useRef<HTMLParagraphElement>\(null\);/);
  });
});

describe("AddonsPaquete — lista compacta en Popover: no cambia la altura de la tarjeta ni de la fila", () => {
  test("arranca cerrada: useState(false) para `abierto`", () => {
    assert.match(cuerpoAddons, /const \[abierto, setAbierto\] = useState\(false\);/);
  });

  test("sin add-ons, no renderiza absolutamente nada (ni siquiera el control)", () => {
    assert.match(cuerpoAddons, /if \(!addons\.length\) return null;/);
  });

  test("la lista vive en un Popover con Portal (fuera del flujo de la tarjeta) — nunca un bloque expandido dentro de ella", () => {
    assert.match(cuerpoAddons, /<Popover\.Root open=\{abierto\} onOpenChange=\{setAbierto\}>/);
    assert.match(cuerpoAddons, /<Popover\.Portal>/);
    assert.match(cuerpoAddons, /<Popover\.Positioner[^>]*collisionPadding=\{12\}[^>]*className="z-\[60\]"/, "debe quedar por encima de los modales (z-50) y respetar el borde en móvil");
    assert.doesNotMatch(cuerpoAddons, /\{abierto && \(/, "ya no hay contenido condicionado dentro de la tarjeta");
  });

  test("alto y ancho acotados con scroll propio (escritorio y móvil)", () => {
    assert.match(cuerpoAddons, /max-h-\[min\(22rem,var\(--available-height\)\)\]/);
    assert.match(cuerpoAddons, /w-\[min\(20rem,calc\(100vw-24px\)\)\]/);
    assert.match(cuerpoAddons, /<ul className="overflow-y-auto/);
  });

  test("el control muestra la cantidad REAL (addons.length) y el Popover tiene título accesible y botón de cierre con ícono", () => {
    assert.match(cuerpoAddons, /Servicios adicionales \(\{addons\.length\}\)/);
    assert.match(cuerpoAddons, /aria-labelledby=\{idTitulo\}/);
    assert.match(cuerpoAddons, /<Popover\.Title id=\{idTitulo\}/);
    assert.match(cuerpoAddons, /<Popover\.Close aria-label="Cerrar lista de servicios"/);
  });

  test("mapea EXACTAMENTE `addons` (ya acotado por el llamador), marca los seleccionados y cada ítem abre ReceptivoModal vía onAbrir con su identidad", () => {
    assert.match(cuerpoAddons, /addons\.map\(\(a, i\) =>/);
    assert.match(cuerpoAddons, /setAbierto\(false\);\s*\n\s*onAbrir\(\{/);
    assert.match(cuerpoAddons, /paqueteId: a\.paqueteId, servicioId: a\.servicioId,/);
    assert.match(cuerpoAddons, /const elegido = a\.servicioId != null && seleccion\.includes\(a\.servicioId\);/);
    assert.doesNotMatch(cuerpoAddons, /fixed inset-0/);
  });

  test("cierre automático al cambiar `paqueteId`: ajuste de estado DURANTE el render (nunca un useEffect con setState síncrono)", () => {
    assert.doesNotMatch(cuerpoAddons, /useEffect\(\(\) => \{ setAbierto\(false\); \}, \[paqueteId\]\);/);
    assert.match(cuerpoAddons, /const \[paqueteIdAnterior, setPaqueteIdAnterior\] = useState\(paqueteId\);/);
    assert.match(cuerpoAddons, /if \(paqueteId !== paqueteIdAnterior\) \{\s*\n\s*setPaqueteIdAnterior\(paqueteId\);\s*\n\s*setAbierto\(false\);\s*\n\s*\}/);
  });

  test("el reset de `paqueteIdAnterior`/`setAbierto(false)` corre ANTES del guard `if (!addons.length)`", () => {
    const idxReset = cuerpoAddons.indexOf("if (paqueteId !== paqueteIdAnterior)");
    const idxGuard = cuerpoAddons.indexOf("if (!addons.length) return null;");
    assert.notEqual(idxReset, -1);
    assert.notEqual(idxGuard, -1);
    assert.ok(idxReset < idxGuard);
  });

  test("estado independiente por tarjeta: abierto/paqueteIdAnterior/idTitulo son estado LOCAL — nunca una variable de módulo compartida", () => {
    assert.doesNotMatch(fuenteCompartida.slice(0, fuenteCompartida.indexOf("export function AddonsPaquete")), /let abierto\b/);
    assert.match(cuerpoAddons, /const idTitulo = useId\(\);/);
  });
});

describe("Persona y unidad reutilizan los MISMOS componentes — ninguna lógica ni JSX duplicada", () => {
  test("DescripcionHotelExpandible y AddonsPaquete tienen UNA SOLA definición en todo el repo (tarjetaHotelCompartida.tsx)", () => {
    const otrosArchivos = [fuenteVista, fuenteBuscador];
    for (const src of otrosArchivos) {
      assert.doesNotMatch(src, /function DescripcionHotelExpandible\(/, "no debe haber una segunda definición fuera de tarjetaHotelCompartida.tsx");
      assert.doesNotMatch(src, /function AddonsPaquete\(/, "no debe haber una segunda definición fuera de tarjetaHotelCompartida.tsx");
    }
  });

  test("las 4 superficies (HotelModal, HotelBernaloCotizarModal, Resultado, TarjetaUnidadBusqueda) invocan <DescripcionHotelExpandible> — ni una reimplementa el line-clamp/Ver más a mano", () => {
    const usosVista = [...fuenteVista.matchAll(/<DescripcionHotelExpandible\b/g)];
    const usosBuscador = [...fuenteBuscador.matchAll(/<DescripcionHotelExpandible\b/g)];
    // HotelModal + HotelBernaloCotizarModal + TarjetaUnidadBusqueda = 3 en VistaBooking.tsx.
    assert.equal(usosVista.length, 3, "HotelModal/HotelBernaloCotizarModal/TarjetaUnidadBusqueda deben usar el componente compartido");
    // Resultado = 1 en BuscadorBooking.tsx.
    assert.equal(usosBuscador.length, 1, "Resultado debe usar el componente compartido");
    // Ningún <p> con line-clamp-2 escrito a mano para LA DESCRIPCIÓN DE
    // RESULTADO/UNIDAD específicamente (TarjetaHotelCard, fuera de alcance de
    // esta corrección, sigue con su propio <p> — eso es intencional y no se
    // toca; lo que no debe existir es una SEGUNDA copia de la de Resultado/
    // TarjetaUnidadBusqueda, ya reemplazadas arriba por el componente).
    assert.doesNotMatch(fuenteBuscador, /line-clamp-2 text-xs text-gray-400">\{info\.descripcion\}/);
  });

  test("las 4 superficies invocan <AddonsPaquete> con `paqueteId` — ni una omite el cierre automático ni reimplementa la lista a mano", () => {
    const usosVista = [...fuenteVista.matchAll(/<AddonsPaquete addons=\{addons\} onAbrir=\{setAddonAbierto\} paqueteId=\{[^}]+\} seleccion=\{seleccionServicios\.seleccion\} \/>/g)];
    const usosBuscador = [...fuenteBuscador.matchAll(/<AddonsPaquete addons=\{addons\} onAbrir=\{setAddonAbierto\} paqueteId=\{[^}]+\} seleccion=\{seleccionServicios\.seleccion\} \/>/g)];
    assert.equal(usosVista.length, 3, "HotelModal/HotelBernaloCotizarModal/TarjetaUnidadBusqueda deben pasar paqueteId");
    assert.equal(usosBuscador.length, 1, "Resultado debe pasar paqueteId");
  });
});

describe("No se toca lo que la corrección visual prohíbe modificar", () => {
  test("SeccionesIncluye (Incluye/No incluye) sigue SIN control expandible — el encargo lo excluye explícitamente", () => {
    assert.doesNotMatch(fuenteCompartida.slice(fuenteCompartida.indexOf("export function SeccionesIncluye"), fuenteCompartida.indexOf("export function AddonsPaquete")), /useState|aria-expanded|Ver más|Ver menos/);
  });

  test("UbicacionHotel (mapa) sigue sin cambios — sin control expandible agregado", () => {
    const cuerpoUbicacion = cuerpoFuncion(fuenteCompartida, "export function UbicacionHotel({");
    assert.doesNotMatch(cuerpoUbicacion, /useState|aria-expanded/);
    assert.match(cuerpoUbicacion, /<iframe/, "el mapa sigue siendo el iframe embebido de siempre");
  });

  test("ni la lista de add-ons ni el modal del servicio escriben en el carrito — solo el botón del hotel (addConjunto)", () => {
    assert.doesNotMatch(cuerpoDescripcion, /useCart|precio|add\(/i);
    assert.doesNotMatch(cuerpoAddons.replace(/precio: a\.desde/g, ""), /useCart|buscarReceptivos|formatMoneda\(precio|add\(\{/i);
    const cuerpoModal = cuerpoFuncion(fuenteCompartida, "export function ReceptivoModal({");
    assert.doesNotMatch(cuerpoModal, /useCart|addConjunto|\badd\(|buscarReceptivos/);
    assert.match(cuerpoModal, /aria-pressed=\{seleccion\.seleccionado\}/);
  });
});
