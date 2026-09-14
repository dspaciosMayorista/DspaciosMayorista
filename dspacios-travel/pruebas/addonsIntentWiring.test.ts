import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Cableado React del flujo "+ Agregar servicios / tours" (carrito →
// Receptivos), para hoteles persona Y unidad.
//
// Ninguno de los archivos verificados acá es ejecutable bajo `node --test`
// (JSX/Next, sin testing-library en este repo) — mismo criterio que el resto
// de wiring tests del proyecto: se verifica el CÓDIGO FUENTE real, no un
// render simulado. La parte puramente algorítmica (construir el intent desde
// el carrito) SÍ corre de verdad y vive en `pruebas/addonsIntent.test.ts`.
//
// Qué se verifica acá:
//   · `CartDrawer.tsx` — `irAAgregarTours` delega en
//     `construirAddonsIntentDesdeCarrito` (no vuelve a filtrar solo hoteles
//     persona); el camino de fallo muestra `errorAddons` SIN cerrar el
//     drawer ni tocar `setAddonsIntent`; el camino de éxito limpia el error,
//     pide el nonce a `addonsNonceRef` (contador monotónico PURO, ver
//     `lib/cart/addonsNonce.ts`/`pruebas/addonsNonce.test.ts` — nunca
//     derivado de `addonsIntent?.nonce`, que se pierde en cada consumo), y
//     SÍ cierra el drawer; `errorAddons` se limpia cuando el drawer se ABRE
//     sin importar el origen (botón local o `openDrawer()` llamado desde
//     otro componente), vía indirección de ref para no violar
//     `react-hooks/set-state-in-effect`.
//   · `BuscadorReceptivos.tsx` — el mecanismo de indirección por ref
//     (`aplicarPrefillRef`/`nonceConsumidoRef`) existe, el efecto que
//     consume el intent depende SOLO de `[initial]`, y ningún `setState` (ni
//     `buscar`) se llama DIRECTO dentro de ese efecto (la causa real de la
//     violación `react-hooks/set-state-in-effect` corregida en este mismo
//     archivo); `ReceptivosPrefill` incluye `nonce`.
//   · `VistaBooking.tsx` — sigue cableando `addonsIntent` →
//     `cambiarSubRef.current("receptivos")` y pasa `initial={addonsIntent}` +
//     `onConsumedInitial={() => setAddonsIntent(null)}` a `BuscadorReceptivos`
//     (ya cubierto en detalle por `busquedaPorcionTerrestreWiring.test.ts`,
//     acá solo se re-confirma que sigue intacto tras este cambio).
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuenteDrawer = readFileSync(join(raiz, "app/tarifario/CartDrawer.tsx"), "utf8");
const fuenteReceptivos = readFileSync(join(raiz, "app/tarifario/BuscadorReceptivos.tsx"), "utf8");
const fuenteContext = readFileSync(join(raiz, "lib/cart/CartContext.tsx"), "utf8");
const fuenteVista = readFileSync(join(raiz, "app/tarifario/VistaBooking.tsx"), "utf8");

function sinComentarios(fuente: string): string {
  return fuente
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*/.test(l))
    .join("\n");
}
const codigoDrawer = sinComentarios(fuenteDrawer);
const codigoReceptivos = sinComentarios(fuenteReceptivos);

describe("CartDrawer.tsx — irAAgregarTours usa el builder dual (persona + unidad), no un filtro solo-persona", () => {
  test("importa construirAddonsIntentDesdeCarrito desde lib/cart/addonsIntent (no reimplementa el filtro inline)", () => {
    assert.match(codigoDrawer, /import\s*\{\s*construirAddonsIntentDesdeCarrito\s*\}\s*from\s*"@\/lib\/cart\/addonsIntent"/);
  });

  test("irAAgregarTours llama al builder con TODOS los items del carrito (no un .filter/.find previo por modeloTarifario)", () => {
    const cuerpoFn = codigoDrawer.slice(
      codigoDrawer.indexOf("function irAAgregarTours"),
      codigoDrawer.indexOf("function irAAgregarTours") + 600
    );
    assert.match(cuerpoFn, /construirAddonsIntentDesdeCarrito\(items\)/);
    // No debe haber quedado el viejo filtro "modeloTarifario !== ...unidad" DENTRO de esta función.
    assert.doesNotMatch(cuerpoFn, /modeloTarifario\s*!==\s*"unidad"/);
  });

  test("camino de fallo: si el builder devuelve null, se muestra errorAddons y se hace return ANTES de tocar setAddonsIntent/closeDrawer", () => {
    const cuerpoFn = codigoDrawer.slice(
      codigoDrawer.indexOf("function irAAgregarTours"),
      codigoDrawer.indexOf("function irAAgregarTours") + 600
    );
    const idxIf = cuerpoFn.indexOf("if (!intent)");
    const idxSetError = cuerpoFn.indexOf("setErrorAddons(MENSAJE_SIN_REFERENCIA_ADDONS)");
    const idxReturn = cuerpoFn.indexOf("return;", idxSetError);
    const idxSetIntent = cuerpoFn.indexOf("setAddonsIntent({");
    const idxCloseDrawer = cuerpoFn.indexOf("closeDrawer();");
    assert.ok(idxIf !== -1 && idxSetError !== -1 && idxReturn !== -1, "debe existir el guard de fallo con mensaje visible");
    assert.ok(idxIf < idxSetError && idxSetError < idxReturn, "el orden debe ser: detectar fallo → setErrorAddons → return");
    assert.ok(idxReturn < idxSetIntent, "el return del camino de fallo debe preceder a setAddonsIntent (nunca se ejecuta en el fallo)");
    assert.ok(idxReturn < idxCloseDrawer, "el return del camino de fallo debe preceder a closeDrawer (el panel NUNCA se cierra en el fallo)");
  });

  test("camino de éxito: limpia el error, pide el nonce a addonsNonceRef.current.siguiente() (nunca a addonsIntent?.nonce), y cierra el drawer", () => {
    const cuerpoFn = codigoDrawer.slice(
      codigoDrawer.indexOf("function irAAgregarTours"),
      codigoDrawer.indexOf("function irAAgregarTours") + 600
    );
    assert.match(cuerpoFn, /setErrorAddons\(null\)/);
    assert.match(cuerpoFn, /addonsNonceRef\.current\.siguiente\(\)/);
    assert.match(cuerpoFn, /setAddonsIntent\(\{\s*\.\.\.intent,\s*nonce:\s*addonsNonceRef\.current\.siguiente\(\)\s*\}\);/);
    assert.match(cuerpoFn, /closeDrawer\(\);/);
    // El defecto original derivaba el nonce del propio `addonsIntent` (estado
    // que se limpia a `null` en cada consumo) — no debe quedar ningún rastro.
    assert.doesNotMatch(codigoDrawer, /addonsIntent\?\.nonce/);
  });

  test("errorAddons se renderiza visiblemente dentro del drawer (no solo en consola/estado silencioso)", () => {
    assert.match(codigoDrawer, /\{errorAddons\s*&&\s*<p[^>]*>\{errorAddons\}<\/p>\}/);
  });

  test("el contador de nonce (addonsNonceRef) usa crearContadorAddonsNonce — un contador PURO, importado, no un useRef(0) manual reinventado", () => {
    assert.match(codigoDrawer, /import\s*\{\s*crearContadorAddonsNonce\s*\}\s*from\s*"@\/lib\/cart\/addonsNonce"/);
    assert.match(codigoDrawer, /const addonsNonceRef = useRef\(crearContadorAddonsNonce\(\)\);/);
  });

  test("errorAddons se limpia cuando el drawer se ABRE, sin importar el origen — vía indirección de ref (no setState directo en el efecto)", () => {
    assert.match(codigoDrawer, /function limpiarErrorAddonsSiAbrio\(\) \{\s*if \(drawerOpen\) setErrorAddons\(null\);\s*\}/);
    assert.match(codigoDrawer, /const limpiarErrorAddonsSiAbrioRef = useRef\(limpiarErrorAddonsSiAbrio\);/);
    assert.match(codigoDrawer, /useEffect\(\(\) => \{ limpiarErrorAddonsSiAbrioRef\.current = limpiarErrorAddonsSiAbrio; \}\);/);
    // El efecto que reacciona a drawerOpen delega TODO en el ref — nunca llama
    // setErrorAddons directo (satisface react-hooks/set-state-in-effect).
    const idxEfecto = codigoDrawer.indexOf("useEffect(() => {\n    limpiarErrorAddonsSiAbrioRef.current();\n  }, [drawerOpen]);");
    assert.notEqual(idxEfecto, -1, "debe existir el efecto guardado por drawerOpen que delega en el ref");
  });

  test("el botón del ícono del carrito usa openDrawer directo — ya no necesita un wrapper local (el clear ahora reacciona a CUALQUIER apertura)", () => {
    assert.match(codigoDrawer, /onClick=\{openDrawer\}/);
    assert.doesNotMatch(codigoDrawer, /function abrirCarrito/);
  });

  test("no hay ningún useEffect que llame setErrorAddons DIRECTO en su cuerpo (el clear siempre pasa por la indirección de ref)", () => {
    const efectos = [...codigoDrawer.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[[^\]]*\]\);/g)];
    for (const m of efectos) {
      assert.doesNotMatch(m[1], /setErrorAddons/, `useEffect no debe llamar setErrorAddons: ${m[1].slice(0, 120)}`);
    }
  });
});

describe("CartContext.tsx — AddonsIntent incluye nonce", () => {
  test("el tipo AddonsIntent declara nonce: number", () => {
    assert.match(fuenteContext, /export type AddonsIntent = \{[^}]*nonce:\s*number[^}]*\}/);
  });
});

describe("BuscadorReceptivos.tsx — consume el intent por nonce, vía indirección de ref (no setState directo en el efecto)", () => {
  test("ReceptivosPrefill incluye nonce", () => {
    assert.match(fuenteReceptivos, /export type ReceptivosPrefill = \{[^}]*nonce:\s*number[^}]*\}/);
  });

  test("existe aplicarPrefillRef sincronizado por un efecto SIN dependencias (ref 'último valor')", () => {
    assert.match(codigoReceptivos, /const aplicarPrefillRef = useRef\(aplicarPrefill\);/);
    assert.match(codigoReceptivos, /useEffect\(\(\) => \{\s*aplicarPrefillRef\.current = aplicarPrefill;\s*\}\);/);
  });

  test("existe nonceConsumidoRef y el efecto de consumo depende SOLO de [initial]", () => {
    assert.match(codigoReceptivos, /const nonceConsumidoRef = useRef<number \| null>\(null\);/);
    assert.match(codigoReceptivos, /useEffect\(\(\) => \{\s*if \(!initial\) return;/);
  });

  test("el efecto de consumo NO llama setState/buscar directo — delega TODO en aplicarPrefillRef.current(...)", () => {
    const inicio = codigoReceptivos.indexOf("const nonceConsumidoRef");
    const cuerpoEfecto = codigoReceptivos.slice(inicio, inicio + 400);
    assert.match(cuerpoEfecto, /aplicarPrefillRef\.current\(initial\);/);
    // Dentro del CUERPO del efecto (no en aplicarPrefill, que vive antes) no debe
    // haber una llamada directa a setDestino/setFIda/setFReg/setPax/buscar(.
    const idxEfectoIni = cuerpoEfecto.indexOf("useEffect(() => {");
    const cuerpoSoloEfecto = cuerpoEfecto.slice(idxEfectoIni);
    assert.doesNotMatch(cuerpoSoloEfecto, /\bset(Destino|FIda|FReg|Pax)\(/);
    assert.doesNotMatch(cuerpoSoloEfecto, /\bbuscar\(/);
  });

  test("nonceConsumidoRef guarda el nonce ANTES de aplicar (evita reentrancia si aplicarPrefillRef dispara un re-render síncrono)", () => {
    const inicio = codigoReceptivos.indexOf("nonceConsumidoRef.current = initial.nonce;");
    const idxAplicar = codigoReceptivos.indexOf("aplicarPrefillRef.current(initial);");
    assert.ok(inicio !== -1 && idxAplicar !== -1 && inicio < idxAplicar);
  });

  test("aplicarPrefill llama a onConsumedInitial (limpia el intent en el llamador tras aplicarlo, nunca antes)", () => {
    const cuerpoFn = codigoReceptivos.slice(
      codigoReceptivos.indexOf("function aplicarPrefill"),
      codigoReceptivos.indexOf("function aplicarPrefill") + 400
    );
    assert.match(cuerpoFn, /onConsumedInitial\?\.\(\);/);
    // onConsumedInitial debe ir DESPUÉS de disparar la búsqueda (si hay fechas),
    // no antes — para no perder el nonce recién aplicado a medio camino.
    const idxBuscar = cuerpoFn.indexOf("buscar(");
    const idxOnConsumed = cuerpoFn.indexOf("onConsumedInitial");
    assert.ok(idxBuscar < idxOnConsumed);
  });

  test("limpiar el intent (initial=null) no borra resultados: no hay ningún setResultados(null) fuera de buscar()/botón Limpiar", () => {
    const llamadasSetResultadosNull = [...codigoReceptivos.matchAll(/setResultados\(null\)/g)];
    // Debe haber EXACTAMENTE 2: dentro de buscar() (antes de una nueva búsqueda) y en el botón "Limpiar resultados".
    assert.equal(llamadasSetResultadosNull.length, 2, "setResultados(null) solo debe existir en buscar() y en el botón Limpiar — nunca en el efecto de consumo del intent");
  });
});

describe("VistaBooking.tsx — openDrawer() se llama desde varios orígenes AJENOS al botón del encabezado del carrito", () => {
  test("existen llamadas a openDrawer() fuera de CartDrawer.tsx (ej. tras agregar un hotel) — confirma que el fix de errorAddons por drawerOpen no es código muerto", () => {
    const llamadas = [...fuenteVista.matchAll(/\bopenDrawer\(\);/g)];
    assert.ok(llamadas.length >= 1, "VistaBooking.tsx debe llamar openDrawer() al menos una vez (ej. tras 'add(item); openDrawer();')");
  });
});

describe("VistaBooking.tsx — el cableado addonsIntent → pestaña Receptivos sigue intacto", () => {
  test("BuscadorReceptivos recibe initial={addonsIntent} y onConsumedInitial limpia el intent", () => {
    assert.match(fuenteVista, /initial=\{addonsIntent\}/);
    assert.match(fuenteVista, /onConsumedInitial=\{\(\)\s*=>\s*setAddonsIntent\(null\)\}/);
  });

  test("addonsIntent sigue disparando el cambio a la sub-pestaña receptivos", () => {
    assert.match(fuenteVista, /if \(addonsIntent\) cambiarSubRef\.current\("receptivos"\);/);
  });
});
