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
      // 500 (antes 400): el fix de identidad de paquete agregó
      // setPaqueteAcotado(p.paqueteId)/onModoAcotado?.(p.paqueteId) al cuerpo
      // de aplicarPrefill — el corte fijo anterior ya no alcanzaba a incluir
      // la llamada a onConsumedInitial completa.
      codigoReceptivos.indexOf("function aplicarPrefill") + 500
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

// ─────────────────────────────────────────────────────────────────────────
// Fix "add-ons propios del paquete reemplazados por el catálogo general del
// destino" (identidad de paquete en el modo acotado de Receptivos).
// ─────────────────────────────────────────────────────────────────────────
describe("BuscadorReceptivos.tsx — modo ACOTADO por paqueteId (requisitos 4/5/8/9)", () => {
  test("buscar() envía paqueteId a buscarReceptivos (requisito 4)", () => {
    const cuerpoFn = codigoReceptivos.slice(
      codigoReceptivos.indexOf("function buscar("),
      // 700 (antes 500): la protección de generación agregó líneas al inicio
      // del cuerpo (miGeneracion) antes de llegar al payload de buscarReceptivos.
      codigoReceptivos.indexOf("function buscar(") + 700
    );
    assert.match(cuerpoFn, /paqueteId:\s*paqueteIdQ\s*\?\?\s*undefined/);
  });

  test("aplicarPrefill activa paqueteAcotado y notifica a onModoAcotado con el paqueteId del intent", () => {
    const cuerpoFn = codigoReceptivos.slice(
      codigoReceptivos.indexOf("function aplicarPrefill"),
      codigoReceptivos.indexOf("function aplicarPrefill") + 500
    );
    assert.match(cuerpoFn, /setPaqueteAcotado\(p\.paqueteId\);/);
    assert.match(cuerpoFn, /onModoAcotado\?\.\(p\.paqueteId\);/);
    // paqueteId también viaja a buscar() — la búsqueda automática del intent queda acotada, no general.
    assert.match(cuerpoFn, /buscar\(p\.destino[^;]*p\.paqueteId\)/);
  });

  test("'Limpiar resultados' (limpiarTodo) es el ÚNICO punto que suelta paqueteAcotado y notifica null (requisito 9 — cambio explícito y predecible)", () => {
    const llamadas = [...codigoReceptivos.matchAll(/setPaqueteAcotado\(null\)/g)];
    assert.equal(llamadas.length, 1, "setPaqueteAcotado(null) debe existir en un único lugar: la función limpiarTodo");
    const cuerpoLimpiar = codigoReceptivos.slice(
      codigoReceptivos.indexOf("function limpiarTodo("),
      codigoReceptivos.indexOf("function limpiarTodo(") + 400
    );
    assert.match(cuerpoLimpiar, /setPaqueteAcotado\(null\);/);
    assert.match(cuerpoLimpiar, /onModoAcotado\?\.\(null\);/);
    // Debe vivir DENTRO de limpiarTodo, nunca en buscar() ni en aplicarPrefill.
    const idxBuscarFn = codigoReceptivos.indexOf("function buscar(");
    const idxLimpiarFn = codigoReceptivos.indexOf("function limpiarTodo(");
    const idxSetNull = codigoReceptivos.indexOf("setPaqueteAcotado(null)");
    assert.ok(idxBuscarFn > -1 && idxLimpiarFn > idxBuscarFn, "limpiarTodo debe declararse después de buscar()");
    assert.ok(idxSetNull > idxLimpiarFn, "el reset debe estar dentro del cuerpo de limpiarTodo");
  });

  // ── Auditoría: carrera entre búsquedas (generacionBusquedaRef) ────────────
  test("existe generacionBusquedaRef y montadoRef (mismo patrón que BuscadorBooking.tsx)", () => {
    assert.match(codigoReceptivos, /const generacionBusquedaRef = useRef\(0\);/);
    assert.match(codigoReceptivos, /const montadoRef = useRef\(true\);/);
  });

  // ── Auditoría (hallazgo Strict Mode): el setup del efecto de montadoRef
  // debe RESTABLECER `true` — no basta con inicializar el ref una sola vez.
  // En React Strict Mode (desarrollo) un componente pasa por
  // setup → cleanup → setup al montar; sin este restablecimiento, el cleanup
  // del primer ciclo deja `montadoRef.current` en `false` para siempre, y el
  // segundo montaje (el real, el que el usuario ve) descartaría toda
  // respuesta como si nunca hubiera estado montado. ────────────────────────
  test("el efecto de montadoRef restablece true en el setup y pone false en el cleanup (nunca solo un cleanup sin setup)", () => {
    const cuerpoEfecto = codigoReceptivos.slice(
      codigoReceptivos.indexOf("const montadoRef = useRef(true);"),
      codigoReceptivos.indexOf("const montadoRef = useRef(true);") + 500
    );
    const idxUseEffect = cuerpoEfecto.indexOf("useEffect(() => {");
    assert.ok(idxUseEffect > -1, "debe ser un useEffect con cuerpo de función (no un cleanup directo sin setup)");
    const idxSetupTrue = cuerpoEfecto.indexOf("montadoRef.current = true;");
    const idxReturn = cuerpoEfecto.indexOf("return () => { montadoRef.current = false; };");
    assert.ok(idxSetupTrue > idxUseEffect, "el setup debe restablecer montadoRef.current = true");
    assert.ok(idxReturn > idxSetupTrue, "el cleanup (montadoRef.current = false) debe declararse DESPUÉS del setup");
    // Control negativo: la forma anterior (cleanup directo sin setup real,
    // `useEffect(() => () => { montadoRef.current = false; }, [])`) ya no
    // debe existir — esa es exactamente la forma que Strict Mode rompía.
    assert.doesNotMatch(codigoReceptivos, /useEffect\(\(\) => \(\) => \{ montadoRef\.current = false; \}, \[\]\);/);
  });

  test("buscar() captura miGeneracion SÍNCRONAMENTE al inicio (antes de cualquier await) y solo publica si sigue vigente", () => {
    const cuerpoFn = codigoReceptivos.slice(
      codigoReceptivos.indexOf("function buscar("),
      codigoReceptivos.indexOf("function buscar(") + 900
    );
    const idxMiGeneracion = cuerpoFn.indexOf("const miGeneracion = (generacionBusquedaRef.current += 1);");
    const idxAwait = cuerpoFn.indexOf("await buscarReceptivos(");
    assert.ok(idxMiGeneracion > -1 && idxAwait > idxMiGeneracion, "miGeneracion debe capturarse ANTES del await");
    const idxCheckGeneracion = cuerpoFn.indexOf("if (generacionBusquedaRef.current !== miGeneracion) return;");
    const idxCheckMontado = cuerpoFn.indexOf("if (!montadoRef.current) return;");
    const idxSetResultados = cuerpoFn.indexOf("if (r.ok) setResultados(r.resultados);");
    assert.ok(idxCheckGeneracion > idxAwait, "el chequeo de generación debe ocurrir DESPUÉS del await");
    assert.ok(idxCheckMontado > idxCheckGeneracion, "el chequeo de montaje debe ocurrir después del de generación");
    assert.ok(idxSetResultados > idxCheckMontado, "setResultados/setErr solo deben ejecutarse después de pasar ambos chequeos");
  });

  test("limpiarTodo invalida cualquier solicitud en vuelo (incrementa generacionBusquedaRef) ANTES de tocar el resto del estado", () => {
    const cuerpoLimpiar = codigoReceptivos.slice(
      codigoReceptivos.indexOf("function limpiarTodo("),
      codigoReceptivos.indexOf("function limpiarTodo(") + 300
    );
    const idxIncrementa = cuerpoLimpiar.indexOf("generacionBusquedaRef.current += 1;");
    const idxSetResultados = cuerpoLimpiar.indexOf("setResultados(null);");
    const idxSetErr = cuerpoLimpiar.indexOf('setErr("");');
    const idxSetPaquete = cuerpoLimpiar.indexOf("setPaqueteAcotado(null);");
    assert.ok(idxIncrementa > -1, "limpiarTodo debe incrementar generacionBusquedaRef");
    assert.ok(idxIncrementa < idxSetResultados && idxIncrementa < idxSetErr && idxIncrementa < idxSetPaquete, "la invalidación debe ocurrir ANTES de cualquier setState");
  });

  // ── Auditoría: "Limpiar resultados" visible también con error en modo acotado ──
  test("el botón 'Limpiar resultados' es visible con resultados O con paqueteAcotado activo (no solo con resultados)", () => {
    const idxCondicionNueva = codigoReceptivos.indexOf("{(resultados != null || paqueteAcotado != null) && (");
    assert.ok(idxCondicionNueva > -1, "debe existir la condición nueva que incluye paqueteAcotado");
    // El botón real (identificado por su handler, único en el archivo) debe
    // estar DENTRO del bloque que abre esa condición — nunca envuelto por la
    // condición vieja `{resultados && (`, que dejaría al usuario sin el botón
    // cuando la búsqueda falla en modo acotado (resultados sigue en null).
    const idxOnClick = codigoReceptivos.indexOf("onClick={limpiarTodo}");
    assert.ok(idxOnClick > idxCondicionNueva, "el botón (onClick={limpiarTodo}) debe estar después de la condición nueva");
    const entreCondicionYBoton = codigoReceptivos.slice(idxCondicionNueva, idxOnClick);
    assert.doesNotMatch(entreCondicionYBoton, /\{resultados && \(/, "no debe haber una condición `{resultados && (` más cercana envolviendo el botón");
  });

  test("el botón usa limpiarTodo directo como handler (onClick={limpiarTodo}), no una función inline duplicada", () => {
    assert.match(codigoReceptivos, /onClick=\{limpiarTodo\}/);
  });
});

describe("VistaBooking.tsx — modo acotado: la vitrina general NO se muestra mientras dura (requisito 8)", () => {
  test("BuscadorReceptivos recibe onModoAcotado={setReceptivosAcotado}", () => {
    assert.match(fuenteVista, /onModoAcotado=\{setReceptivosAcotado\}/);
  });

  test("la vitrina 'O explora todos los receptivos' está condicionada a receptivosAcotado == null", () => {
    const idxBuscador = fuenteVista.indexOf("<BuscadorReceptivos");
    const idxVitrina = fuenteVista.indexOf("O explora todos los receptivos", idxBuscador);
    assert.ok(idxVitrina > idxBuscador, "la vitrina debe estar después del componente de búsqueda");
    const idxCondicion = fuenteVista.lastIndexOf("receptivosAcotado == null &&", idxVitrina);
    assert.ok(idxCondicion > -1 && idxCondicion < idxVitrina, "la vitrina debe quedar DENTRO del bloque condicionado a receptivosAcotado == null");
  });

  test("cambiarSub limpia receptivosAcotado al abandonar la pestaña 'receptivos' (mismo patrón que busquedaPorcion/sugerenciaPedida)", () => {
    const cuerpoFn = fuenteVista.slice(
      fuenteVista.indexOf("function cambiarSub("),
      fuenteVista.indexOf("function cambiarSub(") + 1400
    );
    assert.match(cuerpoFn, /if \(sub === "receptivos" && next !== "receptivos"\) \{/);
    assert.match(cuerpoFn, /setReceptivosAcotado\(null\);/);
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

// ─────────────────────────────────────────────────────────────────────────
// Auditoría — carrera entre búsquedas en BuscadorReceptivos.tsx: réplica
// EJECUTABLE del algoritmo real (generacionBusquedaRef/montadoRef), con
// promesas controladas manualmente para forzar resoluciones fuera de orden.
//
// `BuscadorReceptivos.tsx` es "use client" (React) — no se puede montar ni
// ejecutar bajo `node --test` sin testing-library (no está en este repo,
// mismo criterio documentado en la cabecera de `cotizarFechasWiring.test.ts`
// para el resto de wiring de este proyecto). Esta réplica reproduce el MISMO
// algoritmo, en el MISMO orden (capturar generación → await → comparar
// generación → comparar montaje → publicar) — su fidelidad con el componente
// real la garantiza el describe anterior (inspección de fuente: existencia
// de generacionBusquedaRef/montadoRef, orden de los chequeos, y que
// limpiarTodo incrementa la generación antes de tocar cualquier otro estado).
// ─────────────────────────────────────────────────────────────────────────
function deferida<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>((res) => { resolver = res; });
  return { promesa, resolver };
}

type ResultadoSimulado = { ok: true; valor: string } | { ok: false; error: string };

function crearBuscadorReceptivosSimulado() {
  let generacion = 0;
  let montado = true;
  let resultado: string | null = null;
  let error: string | null = null;
  let paqueteAcotado: number | null = null;

  // Réplica de `buscar()`: captura la generación SÍNCRONAMENTE, y al resolver
  // solo publica si esa generación exacta sigue vigente Y el componente sigue
  // montado — mismo orden que el código real.
  function buscar(fetchFn: () => Promise<ResultadoSimulado>): Promise<void> {
    const miGeneracion = (generacion += 1);
    error = null; resultado = null;
    return fetchFn().then((r) => {
      if (generacion !== miGeneracion) return;
      if (!montado) return;
      if (r.ok) resultado = r.valor; else error = r.error;
    });
  }

  // Réplica de `limpiarTodo()`: invalida ANTES de tocar cualquier otro estado.
  function limpiar() {
    generacion += 1;
    resultado = null;
    error = null;
    paqueteAcotado = null;
  }

  function activarAcotado(id: number) { paqueteAcotado = id; }
  function desmontar() { montado = false; }
  // Réplica del SETUP del efecto de montadoRef (hallazgo Strict Mode): debe
  // RESTABLECER `true`, no solo existir una vez al crear el componente — así
  // un ciclo setup → cleanup → setup (React Strict Mode, desarrollo) dentro
  // de esta réplica se ve exactamente igual que en el componente real.
  function montar() { montado = true; }

  return {
    buscar, limpiar, activarAcotado, desmontar, montar,
    resultado: () => resultado,
    error: () => error,
    paqueteAcotado: () => paqueteAcotado,
  };
}

describe("Auditoría — carrera entre búsquedas: réplica ejecutable del algoritmo de generación", () => {
  test("una respuesta VIEJA que resuelve DESPUÉS de una más reciente nunca reemplaza sus resultados", async () => {
    const sim = crearBuscadorReceptivosSimulado();
    const vieja = deferida<ResultadoSimulado>();
    const nueva = deferida<ResultadoSimulado>();

    const pVieja = sim.buscar(() => vieja.promesa); // generación 1
    const pNueva = sim.buscar(() => nueva.promesa); // generación 2 — invalida la 1 de inmediato

    // La nueva resuelve primero...
    nueva.resolver({ ok: true, valor: "resultados nuevos" });
    await pNueva;
    assert.equal(sim.resultado(), "resultados nuevos");

    // ...y la vieja llega TARDE (orden de red invertido) — no debe pisar nada.
    vieja.resolver({ ok: true, valor: "resultados viejos" });
    await pVieja;
    assert.equal(sim.resultado(), "resultados nuevos", "la respuesta vieja no debe reemplazar la más reciente");
  });

  test("paquete A seguido de paquete B nunca termina mostrando servicios de A bajo el alcance visible de B", async () => {
    const sim = crearBuscadorReceptivosSimulado();
    const dA = deferida<ResultadoSimulado>();
    const dB = deferida<ResultadoSimulado>();

    sim.activarAcotado(111); // paquete A
    const pA = sim.buscar(() => dA.promesa);

    sim.activarAcotado(222); // el usuario pasa al paquete B ANTES de que A resuelva
    const pB = sim.buscar(() => dB.promesa);

    dB.resolver({ ok: true, valor: "14 servicios de B" });
    await pB;
    dA.resolver({ ok: true, valor: "14 servicios de A" }); // tardía
    await pA;

    assert.equal(sim.resultado(), "14 servicios de B");
    assert.notEqual(sim.resultado(), "14 servicios de A");
    assert.equal(sim.paqueteAcotado(), 222, "el alcance visible sigue siendo B, nunca vuelve a A por una respuesta tardía");
  });

  test("'Limpiar resultados' (limpiar) invalida una consulta pendiente — la respuesta tardía no reaparece", async () => {
    const sim = crearBuscadorReceptivosSimulado();
    const d = deferida<ResultadoSimulado>();

    sim.activarAcotado(50);
    const p = sim.buscar(() => d.promesa);
    sim.limpiar(); // el usuario limpia ANTES de que la búsqueda resuelva
    assert.equal(sim.resultado(), null);
    assert.equal(sim.paqueteAcotado(), null);

    d.resolver({ ok: true, valor: "tardío, no debería aparecer" }); // llega después de limpiar
    await p;
    assert.equal(sim.resultado(), null, "una respuesta tardía tras limpiar no debe resucitar resultados");
  });

  test("una respuesta pendiente tras desmontar el componente (cambio de pestaña) nunca publica", async () => {
    const sim = crearBuscadorReceptivosSimulado();
    const d = deferida<ResultadoSimulado>();
    const p = sim.buscar(() => d.promesa);
    sim.desmontar(); // el usuario cambió de pestaña; generacionBusquedaRef NO cambió
    d.resolver({ ok: true, valor: "no debería verse" });
    await p;
    assert.equal(sim.resultado(), null);
  });

  // ── Hallazgo Strict Mode: setup → cleanup → setup (React monta, desmonta y
  // vuelve a montar de inmediato en desarrollo) NUNCA debe dejar montadoRef
  // atascado en `false` — el segundo montaje (el que el usuario ve de
  // verdad) debe volver a aceptar respuestas normalmente. ──────────────────
  test("setup → cleanup → setup (React Strict Mode): una respuesta del montaje vigente SÍ se publica, no queda atascada en false", async () => {
    const sim = crearBuscadorReceptivosSimulado();

    // Ciclo Strict Mode: React monta el componente (setup), lo desmonta de
    // inmediato para probar el cleanup, y lo vuelve a montar (setup) — todo
    // esto ANTES de que el usuario interactúe. `montar()` NO se llama al
    // crear `sim` (ya nace montado=true, igual que `useState(true)`); acá se
    // simula el ciclo completo que dispara Strict Mode.
    sim.desmontar(); // cleanup del primer setup fantasma de Strict Mode
    sim.montar(); // segundo setup — el montaje REAL, el que el usuario ve

    const d = deferida<ResultadoSimulado>();
    const p = sim.buscar(() => d.promesa);
    d.resolver({ ok: true, valor: "respuesta del montaje vigente" });
    await p;

    // Con el defecto (cleanup sin setup que restablezca `true`), montado
    // seguiría en `false` tras el ciclo y esta respuesta se habría
    // descartado en silencio — exactamente el hallazgo de auditoría.
    assert.equal(sim.resultado(), "respuesta del montaje vigente", "una respuesta que llega DESPUÉS del segundo setup debe publicarse — el ciclo setup→cleanup→setup no debe dejar montadoRef atascado en false");
  });

  test("dos búsquedas consecutivas SIN carrera (la primera resuelve antes de iniciar la segunda) funcionan normal", async () => {
    const sim = crearBuscadorReceptivosSimulado();
    const d1 = deferida<ResultadoSimulado>();
    const p1 = sim.buscar(() => d1.promesa);
    d1.resolver({ ok: true, valor: "primera" });
    await p1;
    assert.equal(sim.resultado(), "primera");

    const d2 = deferida<ResultadoSimulado>();
    const p2 = sim.buscar(() => d2.promesa);
    d2.resolver({ ok: true, valor: "segunda" });
    await p2;
    assert.equal(sim.resultado(), "segunda");
  });

  test("un error de la búsqueda más reciente SÍ se publica aunque una anterior (exitosa) siga en vuelo y llegue después", async () => {
    const sim = crearBuscadorReceptivosSimulado();
    const dOk = deferida<ResultadoSimulado>();
    const dErr = deferida<ResultadoSimulado>();

    const pOk = sim.buscar(() => dOk.promesa); // generación 1
    const pErr = sim.buscar(() => dErr.promesa); // generación 2, la vigente

    dErr.resolver({ ok: false, error: "Búsqueda no disponible en este momento. Intenta nuevamente." });
    await pErr;
    assert.equal(sim.error(), "Búsqueda no disponible en este momento. Intenta nuevamente.");
    assert.equal(sim.resultado(), null);

    dOk.resolver({ ok: true, valor: "no debería pisar el error vigente" }); // tardía, generación obsoleta
    await pOk;
    assert.equal(sim.error(), "Búsqueda no disponible en este momento. Intenta nuevamente.", "una respuesta exitosa tardía de una generación vieja no debe borrar el error vigente");
    assert.equal(sim.resultado(), null);
  });
});
