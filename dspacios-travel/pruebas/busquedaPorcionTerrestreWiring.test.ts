import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Búsqueda general de Porción terrestre en Vista Booking.
//
// Ninguno de los archivos verificados acá es ejecutable bajo `node --test`
// (JSX / Next / Supabase, sin testing-library en este repo) — mismo criterio
// que el resto de wiring tests del proyecto: se verifica el CÓDIGO FUENTE
// real, no un render simulado. La parte puramente algorítmica (el reparto de
// edades sobre la ocupación legada del buscador) SÍ corre de verdad y vive en
// `pruebas/repartoMenoresBusqueda.test.ts`.
//
// ── Qué cambió (validación real) y por qué estas pruebas se reescribieron ──
// ANTES había DOS listas visuales para una sola búsqueda:
//   · `BuscadorBooking` renderizaba su propia lista de filas persona y su
//     propio estado vacío + contador;
//   · `VistaBooking` volvía a renderizar su grilla (unidad + exploración
//     precargada) DEBAJO, con otro contador y otro "no hay nada".
// Y la grilla de exploración seguía ahí, filtrada por destino, así que un
// hotel que el motor había RECHAZADO para esas fechas podía reaparecer desde
// el catálogo precargado como si fuera un resultado.
//
// AHORA hay UNA sola colección (`tarjetas` en `VistaBooking`) y UNA sola
// grilla, con la MISMA tarjeta para exploración y para búsqueda:
//   · persona en modo búsqueda = EXCLUSIVAMENTE `buscarHoteles` (la grilla
//     precargada no participa);
//   · unidad en modo búsqueda = EXCLUSIVAMENTE lo que el servidor confirmó
//     `disponible` (`sin_disponibilidad` y "no concluido" no son resultados);
//   · al limpiar / cambiar criterios se vuelve a la exploración de siempre.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuenteBuscador = readFileSync(join(raiz, "app/tarifario/BuscadorBooking.tsx"), "utf8");
const fuenteVista = readFileSync(join(raiz, "app/tarifario/VistaBooking.tsx"), "utf8");
const fuenteAction = readFileSync(join(raiz, "app/tarifario/busquedaUnidadActions.ts"), "utf8");
const fuenteDatos = readFileSync(join(raiz, "lib/tarifario/datosBernalo.ts"), "utf8");

function sinComentarios(fuente: string): string {
  return fuente
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*/.test(l))
    .join("\n");
}
const codigoBuscador = sinComentarios(fuenteBuscador);
const codigoVista = sinComentarios(fuenteVista);
const codigoAction = sinComentarios(fuenteAction);
const codigoDatos = sinComentarios(fuenteDatos);

// Extrae el cuerpo de una función balanceando llaves reales (mismo criterio
// brace-depth-aware que `pruebas/ocupacionBernaloUIWiring.test.ts`).
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

const cuerpoBuscar = cuerpoFuncion(fuenteBuscador, "function buscar(overrideIda?");
const cuerpoLimpiar = cuerpoFuncion(fuenteBuscador, "function limpiarResultados()");
const cuerpoEvaluarHotel = cuerpoFuncion(codigoAction, "async function evaluarHotel(hotelId: number)");
const cuerpoTarjetas = cuerpoFuncion(codigoVista, "const tarjetas = useMemo<Tarjeta[]>(() => {");

// ── 1) UNA SOLA LISTA DE RESULTADOS ───────────────────────────────────────
//
// Requisito: "Después de buscar debe existir una única colección y una única
// grilla". El buscador dejó de pintar; `VistaBooking` es el único que pinta, y
// lo hace en la MISMA grilla que ya usaba la exploración.

describe("Una sola lista de resultados — persona + unidad en la MISMA grilla", () => {
  test("el buscador ya NO pinta resultados: no queda ninguna lista, contador ni estado vacío propio", () => {
    assert.doesNotMatch(codigoBuscador, /resultadosFiltrados/, "el buscador no puede volver a filtrar/pintar su propia lista");
    assert.doesNotMatch(codigoBuscador, /resultados\.map\(/, "el buscador no puede volver a mapear resultados a tarjetas");
    assert.doesNotMatch(codigoBuscador, /sugerenciasFecha\.map\(/, "las fechas alternativas se pintan en el estado vacío ÚNICO de VistaBooking");
    assert.doesNotMatch(codigoBuscador, /unidadesDisponibles/, "el conteo auxiliar ya no vive en el buscador");
    assert.doesNotMatch(codigoBuscador, /resumenResultados/, "el resumen/contador único vive en VistaBooking");
  });

  test("VistaBooking tiene UNA sola grilla, UN solo contador y UN solo resultado por hotel", () => {
    assert.equal([...codigoVista.matchAll(/\{tarjetas\.map\(\(t\) =>/g)].length, 1, "una sola grilla de tarjetas");
    assert.equal([...codigoVista.matchAll(/<Resultado\b/g)].length, 1, "la fila persona se pinta en un solo lugar");
    assert.equal([...codigoVista.matchAll(/\(\{tarjetas\.length\}\)/g)].length, 1, "un solo contador, y sale de la MISMA colección que se pinta");
    // Ninguna lista paralela debajo (la grilla unidad tenía su propio `.map`).
    assert.doesNotMatch(codigoVista, /hotelesUnidadVisibles\.map\(/);
    assert.doesNotMatch(codigoVista, /hotelesUnidadVisibles\.length/);
  });

  test("un solo estado vacío por modo: el de exploración NO se pinta en modo búsqueda (y viceversa)", () => {
    assert.match(codigoVista, /\{!tarjetas\.length && !enBusquedaPorcion && <p/, "el vacío de exploración debe estar apagado en modo búsqueda");
    assert.match(codigoVista, /\{enBusquedaPorcion && !tarjetas\.length && \(/, "el único vacío de la búsqueda");
    assert.doesNotMatch(codigoVista, /hotel\(es\) disponibles para tu búsqueda<\/p>/, "no puede sobrevivir el contador crudo del buscador");
  });

  test("persona y unidad entran a la MISMA colección `tarjetas` (una sola fuente, un solo orden)", () => {
    const posRama = cuerpoTarjetas.indexOf("if (enBusquedaPorcion && busquedaPorcion) {");
    const posReturn = cuerpoTarjetas.indexOf("return [...busca, ...unidad].sort(");
    // La grilla de exploración (persona `a` + unidad `b`) se arma DESPUÉS del
    // return: son ramas excluyentes, nunca se suman.
    const posGrillaExploracion = cuerpoTarjetas.indexOf("const a: Tarjeta[] = hoteles");
    assert.ok(posRama > -1, "falta la rama de modo búsqueda");
    assert.ok(posReturn > posRama, "la rama de búsqueda debe retornar su propia lista");
    assert.ok(posGrillaExploracion > posReturn, "el catálogo de exploración se arma sólo si NO hay búsqueda vigente");
    assert.match(cuerpoTarjetas, /busquedaPorcion\.resultados/);
    assert.match(cuerpoTarjetas, /busquedaPorcion\.unidad/);
  });

  test("el encabezado dice de qué búsqueda son esos resultados, y el contador es el de esa misma grilla", () => {
    assert.match(codigoVista, /Resultados de tu búsqueda/);
    assert.ok(codigoVista.includes("{busquedaPorcion.fechaIda} → {busquedaPorcion.fechaRegreso}"), "el encabezado debe mostrar las fechas buscadas");
    assert.match(codigoVista, /<span className="ml-2 font-normal normal-case text-gray-400">\(\{tarjetas\.length\}\)<\/span>/);
  });
});

// ── 2) DISPONIBILIDAD REAL ────────────────────────────────────────────────
//
// Requisito: en modo búsqueda NO basta con filtrar por destino la grilla
// precargada. Persona = solo `buscarHoteles`; unidad = solo `estado ===
// "disponible"`. `sin_disponibilidad` no es un resultado disponible y un
// estado desconocido por error técnico tampoco se anuncia.

describe("Disponibilidad REAL: la lista de búsqueda no se completa con el catálogo", () => {
  test("un hotel persona RECHAZADO por el motor no puede reaparecer desde la grilla precargada", () => {
    // El filtro de destino de la grilla de exploración
    // (`f.destino_nombre !== destinoPorcionEfectivo`) sigue existiendo para
    // EXPLORAR, pero la rama de búsqueda retorna ANTES de que esa grilla se
    // arme, así que en modo búsqueda no puede llegar a participar.
    assert.match(codigoVista, /if \(mod === "porcion_terrestre" && destinoPorcionEfectivo && \(f\.destino_nombre \?\? ""\) !== destinoPorcionEfectivo\) return false;/);
    const posReturn = cuerpoTarjetas.indexOf("return [...busca, ...unidad].sort(");
    const posExploracion = cuerpoTarjetas.indexOf("const a: Tarjeta[] = hoteles");
    assert.ok(posReturn > -1, "falta el return de la lista de búsqueda");
    assert.ok(posExploracion > posReturn, "la grilla precargada se arma sólo si NO hay búsqueda vigente");
    // La fila persona del modo búsqueda sale EXCLUSIVAMENTE de la respuesta del motor.
    const ramaBusqueda = cuerpoTarjetas.slice(cuerpoTarjetas.indexOf("if (enBusquedaPorcion && busquedaPorcion) {"), posReturn);
    assert.match(ramaBusqueda, /for \(const r of busquedaPorcion\.resultados\) \{/);
    assert.match(ramaBusqueda, /const busca: Tarjeta\[\] = \[\];/);
    assert.doesNotMatch(ramaBusqueda, /\bhoteles\b/, "la lista persona de la búsqueda no se completa con el catálogo precargado");
    assert.doesNotMatch(ramaBusqueda, /hotelesUnidadVisibles/, "la unidad de la búsqueda no se completa con la exploración");
  });

  test('la unidad que llega a la lista es EXCLUSIVAMENTE `estado === "disponible"`', () => {
    assert.match(
      codigoBuscador,
      /export type AlojamientoUnidadDisponible = Extract<DisponibilidadUnidadHotel, \{ estado: "disponible" \}>;/
    );
    assert.match(
      cuerpoBuscar,
      /unidadRes\.disponibilidad\.filter\(\(d\): d is AlojamientoUnidadDisponible => d\.estado === "disponible"\)/
    );
    assert.match(codigoBuscador, /unidad: AlojamientoUnidadDisponible\[\]/);
  });

  test('un `sin_disponibilidad` NUNCA se pinta como disponible: no queda ninguna rama que lo muestre', () => {
    assert.doesNotMatch(codigoVista, /Sin disponibilidad para tu búsqueda/);
    assert.match(codigoVista, /Disponible para tus fechas/);
    // El badge sólo existe en modo búsqueda y es un HECHO ya verificado por el
    // servidor: no decide nada (no hay rama condicional por disponibilidad).
    assert.match(codigoVista, /badgeEsquina=\{enBusquedaPorcion \? \(/);
  });

  test("un estado que el servidor NO pudo concluir no se anuncia: se cae de la lista", () => {
    assert.match(codigoAction, /veredictos\.filter\(\(v\): v is DisponibilidadUnidadHotel => v !== null\)/);
    assert.match(cuerpoEvaluarHotel, /if \(!fila\) return null;/, "sin fila maestra no se inventan umbrales de edad");
    assert.doesNotMatch(codigoAction, /"desconocido"|"no_evaluado"|"error"/, "no existe un estado de disponibilidad para 'no concluido'");
  });

  test("fuera del modo búsqueda la exploración sigue funcionando normalmente", () => {
    assert.match(codigoVista, /const enBusquedaPorcion = sub === "porcion_terrestre" && busquedaPorcion != null;/);
    assert.match(cuerpoTarjetas, /const a: Tarjeta\[\] = hoteles/);
    assert.match(cuerpoTarjetas, /const b: Tarjeta\[\] = \[\.\.\.gruposUnidad\.entries\(\)\]\.map\(/);
    assert.match(codigoVista, /value=\{destinoPorcionSel\}/, "el selector de destino de exploración sigue existiendo");
  });
});

// ── 3) NO TRUNCAR RESULTADOS SILENCIOSAMENTE ──────────────────────────────
//
// Requisito: los topes de 8 hoteles y 4 combinaciones podían ocultar hoteles
// válidos. Ahora la evaluación es COMPLETA (todos los hoteles del destino) y
// lo único acotado es la CONCURRENCIA — bajar ese número sólo hace la
// búsqueda más lenta, nunca cambia el veredicto. Dentro de cada hotel, la
// evaluación de combinaciones SÍ se corta en el primer éxito (decisión
// acotada — no hace falta agotar las demás sólo para "llenar opciones"; ver
// la sección 1bis más abajo).
//
// ⚠️ Honestidad de las pruebas (auditoría independiente): estas son pruebas
// de INSPECCIÓN DE TEXTO FUENTE (wiring), NO ejecución real — `busquedaUnidadActions.ts`
// usa Supabase/`computarReservaBernalo` y no corre bajo `node --test` sin una
// base de datos real. Los títulos originales ("el hotel nº 9 SÍ puede
// aparecer", "la combinación válida nº 5 puede producir la disponibilidad")
// sonaban a un escenario EJECUTADO con 9 hoteles/5 combinaciones reales —
// nunca se probó así. Lo que estas pruebas verifican de verdad es que el
// CÓDIGO no tiene ningún tope explícito (`MAX_HOTELES_UNIDAD`, `slice(0, 8)`,
// `break`/`continue` por contador) — una garantía estructural, no una medición
// contra una base real.
describe("Sin truncamiento (verificado por inspección de fuente, NO ejecutado contra Supabase real): evaluación completa con concurrencia acotada", () => {
  test("el código no impone ningún tope de hoteles por destino (sin MAX_HOTELES_UNIDAD/slice/límite fijo) — nunca se probó con 9 hoteles reales, solo se verifica la ausencia del recorte en el texto fuente", () => {
    assert.doesNotMatch(codigoAction, /MAX_HOTELES_UNIDAD|maxHoteles|slice\(0, *8\)/);
    assert.match(codigoAction, /const idsAevaluar = \[\.\.\.ofertasPorHotel\.keys\(\)\]\.sort\(\(a, b\) => a - b\);/);
    // El array de veredictos tiene una casilla por TODOS los hoteles
    // detectados (sin importar cuántos sean) y el pool escribe en la casilla
    // que le toca, sin recortar la lista de antemano.
    assert.match(codigoAction, /new Array\(idsAevaluar\.length\)\.fill\(null\)/);
    assert.match(codigoAction, /if \(i >= idsAevaluar\.length\) return;/);
  });

  test("el código no impone ningún tope de combinaciones por hotel (sin MAX_INTENTOS_POR_HOTEL/contador) — nunca se probó con 5 combinaciones reales, solo se verifica la ausencia del recorte en el texto fuente", () => {
    assert.doesNotMatch(codigoAction, /MAX_INTENTOS_POR_HOTEL|maxIntentos/);
    // `combinacionesDe` emite la k-ésima combinación de CADA oferta antes de
    // pasar a la k+1: ninguna queda fuera del recorrido.
    assert.match(codigoAction, /for \(let k = 0; k < maxPares; k\+\+\) \{/);
    assert.match(cuerpoEvaluarHotel, /const combos = combinacionesDe\(ofertas\);/);
    assert.match(cuerpoEvaluarHotel, /for \(const combo of combos\) \{/);
    // Basta el PRIMER éxito para declararlo disponible — decisión acotada,
    // no un recorte silencioso: la identidad EXACTA que funcionó se conserva
    // (nunca se sigue evaluando un hotel ya resuelto para "llenar opciones").
    assert.match(cuerpoEvaluarHotel, /if \(resultado\.ok\) \{/);
    assert.match(cuerpoEvaluarHotel, /estado: "disponible",/);
    assert.match(cuerpoEvaluarHotel, /oferta: \{/);
    // …y ninguno de los dos cortes prematuros SILENCIOSOS existe: ni
    // `break`/`continue` por contador, ni abandono del bucle por un fallo no
    // concluyente (el `return` explícito de arriba es la única salida
    // temprana, y está documentada, no oculta).
    assert.doesNotMatch(cuerpoEvaluarHotel, /\bbreak;|\bcontinue;/);
  });

  test('"no evaluado" nunca se trata como "sin disponibilidad"', () => {
    assert.match(codigoAction, /const MOTIVOS_SIN_DISPONIBILIDAD = new Set<string>\(\["fechas_fuera_de_ventana", "no_cotizable"\]\);/);
    assert.match(cuerpoEvaluarHotel, /let motivoNoConcluyente = false;/);
    assert.match(cuerpoEvaluarHotel, /if \(!MOTIVOS_SIN_DISPONIBILIDAD\.has\(resultado\.codigo\)\) motivoNoConcluyente = true;/);
    // La afirmación sólo se hace tras AGOTAR las combinaciones, con al menos
    // una evaluada y sin ningún motivo que el motor no pueda concluir.
    assert.match(cuerpoEvaluarHotel, /if \(combos\.length > 0 && !motivoNoConcluyente\) return \{ hotelId, estado: "sin_disponibilidad" \};/);
    // Un rechazo del reparto por CONFIGURACIÓN del hotel (no por la selección
    // pedida) tampoco autoriza la afirmación.
    assert.match(cuerpoEvaluarHotel, /return reparto\.tipo === "seleccion_invalida" \? \{ hotelId, estado: "sin_disponibilidad" \} : null;/);
  });

  test("lo único acotado es la concurrencia, y no se exporta (un `export const` rompería el build de Next)", () => {
    assert.match(codigoAction, /const CONCURRENCIA_HOTELES_UNIDAD = \d+;/);
    assert.doesNotMatch(codigoAction, /export const CONCURRENCIA_HOTELES_UNIDAD/);
    assert.match(codigoAction, /Math\.min\(CONCURRENCIA_HOTELES_UNIDAD, idsAevaluar\.length\)/);
  });
});

// ── A) MODO BÚSQUEDA: el buscador comunica hacia arriba ───────────────────

describe("BuscadorBooking — canal de búsqueda hacia VistaBooking (requisito A)", () => {
  test("exporta el estado que sube y lo recibe por prop opcional (el buscador sigue sirviendo sin el canal)", () => {
    assert.match(codigoBuscador, /export type EstadoBusquedaPorcion = \{/);
    assert.match(codigoBuscador, /onBusqueda\?:\s*\(estado: EstadoBusquedaPorcion \| null\) => void/);
    assert.match(codigoBuscador, /destinos = \[\], onBusqueda,/);
  });

  test("el estado que sube es EXACTAMENTE la búsqueda: destino, fechas, filas persona, diagnóstico, sugerencias y unidad disponible", () => {
    const tipo = cuerpoFuncion(codigoBuscador, "export type EstadoBusquedaPorcion = {");
    assert.match(tipo, /destino: string;/);
    assert.match(tipo, /fechaIda: string;/);
    assert.match(tipo, /fechaRegreso: string;/);
    assert.match(tipo, /resultados: BusquedaResultado\[\];/);
    assert.match(tipo, /diagnostico: string \| null;/);
    assert.match(tipo, /sugerenciasFecha: SugerenciaFecha\[\];/);
    assert.match(tipo, /unidad: AlojamientoUnidadDisponible\[\];/);
    // Ningún dato interno viaja por el canal de UI.
    assert.doesNotMatch(tipo, /pvp|precio|neto|snapshot|costo|proveedor|comision/i);
  });

  test("una búsqueda con éxito comunica el destino y las fechas EFECTIVAMENTE usadas (no las del formulario si vinieron por override)", () => {
    const pos = cuerpoBuscar.indexOf("onBusqueda?.({");
    assert.ok(pos > -1, "falta el envío del estado hacia arriba");
    const envio = cuerpoBuscar.slice(pos, cuerpoBuscar.indexOf("});", pos));
    assert.match(envio, /destino, fechaIda: idaUsada, fechaRegreso: regresoUsada,/);
    assert.match(envio, /resultados: r\.resultados,/);
    assert.match(envio, /diagnostico: r\.diagnostico \?\? null,/);
    assert.match(envio, /sugerenciasFecha: r\.sugerenciasFecha \?\? \[\],/);
    assert.match(envio, /unidad,/);
  });

  test("cada salida temprana por validación limpia el modo búsqueda (nunca queda un resultado viejo vigente con criterios nuevos)", () => {
    const limpiezas = [...cuerpoBuscar.matchAll(/onBusqueda\?\.\(null\)/g)].length;
    assert.ok(limpiezas >= 4, `se esperaban al menos 4 limpiezas (falta fecha, adultos, menores, error del motor); hay ${limpiezas}`);
  });

  test("hay una huella de criterios y la invalidación vive en los EVENTOS que cambian criterios, no en un efecto", () => {
    assert.match(codigoBuscador, /function huellaBusqueda\(a: \{/);
    // El efecto que comparaba huellas ya no existe (nunca existió una huella
    // "viva" sincronizada por `useEffect`): comparar en un efecto obligaba a
    // hacer `setState` desde ahí (renders en cascada) y, sobre todo, dejaba
    // una ventana de carrera — ver `generacionBusquedaRef` para el mecanismo
    // que sí invalida de forma síncrona. La huella que sí existe
    // (`huellaBuscada`) solo identifica criterios para el botón "Limpiar
    // resultados", nunca invalida nada por sí sola.
    assert.doesNotMatch(codigoBuscador, /huellaActual/);
    assert.doesNotMatch(codigoBuscador, /huellaVivaRef/);
    assert.doesNotMatch(codigoBuscador, /huellaBuscada === huellaActual/);
    // La única decisión de limpieza es `limpiarResultados()`, y la invoca CADA
    // control que cambia un criterio: los cuatro del formulario de cabecera...
    for (const control of [
      "onChange={(e) => { setDestino(e.target.value); limpiarResultados(); }}",
      "onChange={(e) => { const nueva = e.target.value; limpiarResultados(); setFIda(nueva);",
      "onChange={(e) => { limpiarResultados(); setFReg(e.target.value); }}",
      "onChange={(e) => { limpiarResultados(); setAdultos(e.target.value); }}",
    ]) {
      assert.ok(codigoBuscador.includes(control), `un control de criterio no invalida los resultados: ${control}`);
    }
    // ...y los cuatro handlers que cambian habitaciones, acomodación, cantidad
    // de menores y edad de un menor.
    for (const ancla of [
      "function setCantidad(n: number)",
      "const setHab = (i: number, acom: AcomRoom) =>",
      "function setCantidadMenores(nRaw: number)",
      "const setEdadAt = (i: number, v: string) =>",
    ]) {
      assert.ok(
        cuerpoFuncion(codigoBuscador, ancla).includes("limpiarResultados();"),
        `${ancla} debe invalidar los resultados`
      );
    }
  });

  test("el destino es OBLIGATORIO para buscar: placeholder deshabilitado en la UI y rechazo con espacios en el cliente", () => {
    // El `<select>` se pinta siempre y su opción inicial no es elegible: no hay
    // forma de buscar "todos los destinos" desde la UI.
    assert.match(codigoBuscador, /<option value="" disabled>Selecciona un destino<\/option>/);
    assert.match(codigoBuscador, /\{destinos\.map\(\(d\) => <option key=\{d\} value=\{d\}>\{d\}<\/option>\)\}/);
    assert.doesNotMatch(codigoBuscador, /<option value="">Todos<\/option>/);
    assert.doesNotMatch(codigoBuscador, /destinos\.length > 0 && \(/);
    // Y aun con un body manipulado, el motor general rechaza el destino vacío
    // ANTES de evaluar nada — con `trim()`, porque un destino de puros espacios
    // no es una selección.
    assert.match(cuerpoBuscar, /if \(!destino\.trim\(\)\) \{ setErr\("Selecciona un destino para buscar\."\); onBusqueda\?\.\(null\); return; \}/);
    const posDestino = cuerpoBuscar.indexOf("if (!destino.trim())");
    const posLlamaMotor = cuerpoBuscar.indexOf("buscarHoteles({");
    assert.ok(posDestino > -1 && posLlamaMotor > posDestino, "el rechazo del destino vacío debe ir ANTES de llamar al motor");
  });

  test("la Server Action de unidad también falla cerrada con destino vacío o sólo espacios", () => {
    // `validarDestinoConsulta` acepta "" a propósito (otros flujos públicos lo
    // usan como "todos los destinos"), así que el rechazo vive en la acción.
    assert.match(codigoAction, /if \(vDestino\.destino\.trim\(\) === ""\) \{/);
    assert.match(codigoAction, /return \{ ok: false, error: "Selecciona un destino para buscar\." \};/);
    const posGuarda = codigoAction.indexOf('if (vDestino.destino.trim() === "")');
    const posDescubrimiento = codigoAction.indexOf("cargarHotelesBernaloDescubiertos({ destino: vDestino.destino })");
    assert.ok(posGuarda > -1 && posDescubrimiento > posGuarda, "el rechazo debe ir ANTES del descubrimiento (que sin destino barrenaría el catálogo)");
  });

  test("una respuesta que llega DESPUÉS de que el usuario cambió los criterios no se sube (guarda contra la carrera, vía generacionBusquedaRef — ver el bloque de la carrera residual más abajo)", () => {
    // Sin esto, la respuesta tardía volvería a publicar resultados que ya no
    // corresponden a lo escrito. El mecanismo real (síncrono, no un efecto
    // posterior) se verifica en detalle en el describe
    // "Carrera residual de solicitudes — generacionBusquedaRef".
    assert.match(cuerpoBuscar, /if \(generacionBusquedaRef\.current !== miGeneracion\) return;/);
    const posGuarda = cuerpoBuscar.indexOf("if (generacionBusquedaRef.current !== miGeneracion) return;");
    const posPublicacion = cuerpoBuscar.indexOf("onBusqueda?.({");
    assert.ok(posGuarda > -1 && posPublicacion > posGuarda, "la guarda debe estar antes de publicar el estado");
  });

  test('"Limpiar resultados" restaura el modo exploración: una sola decisión de limpieza, y el botón la usa', () => {
    for (const limpieza of ["setHuellaBuscada(null)", "onBusqueda?.(null)"]) {
      assert.ok(cuerpoLimpiar.includes(limpieza), `limpiarResultados() debe hacer ${limpieza}`);
    }
    assert.match(codigoBuscador, /\{huellaBuscada !== null && <button type="button" onClick=\{limpiarResultados\}/);
    assert.match(codigoBuscador, />Limpiar resultados<\/button>/);
    // El botón sólo existe cuando hay búsqueda vigente (no hay nada que
    // limpiar en exploración) y no hay ninguna otra variable de la que dependa.
    assert.equal([...codigoBuscador.matchAll(/huellaBuscada !== null/g)].length, 1);
  });
});

// ── D) RENDIMIENTO: sin N+1 desde el navegador ────────────────────────────

describe("BuscadorBooking — una sola llamada por búsqueda, nunca una por tarjeta (requisito D)", () => {
  test("las dos consultas de una búsqueda salen en UN Promise.all dentro de buscar()", () => {
    const posAll = cuerpoBuscar.indexOf("await Promise.all([");
    assert.ok(posAll > -1, "buscar() debe agrupar sus consultas en un Promise.all");
    const posCierre = cuerpoBuscar.indexOf("]);", posAll);
    const bloque = cuerpoBuscar.slice(posAll, posCierre);
    assert.match(bloque, /buscarHoteles\(\{/);
    assert.match(bloque, /buscarAlojamientosUnidadPorFechas\(\{/);
  });

  test("la acción de disponibilidad se invoca UNA vez en todo el componente (nunca desde un map de resultados)", () => {
    const llamadas = [...codigoBuscador.matchAll(/buscarAlojamientosUnidadPorFechas\(/g)].length;
    assert.equal(llamadas, 1, "exactamente una invocación — no puede haber una llamada por tarjeta");
    assert.match(cuerpoBuscar, /buscarAlojamientosUnidadPorFechas\(/);
    assert.doesNotMatch(codigoBuscador, /resultados\.map\([\s\S]{0,400}buscarAlojamientosUnidadPorFechas/);
    // Ni el buscador persona ni la disponibilidad se disparan desde el render
    // de cada resultado: los dos call sites viven dentro de `buscar()`.
    assert.equal([...codigoBuscador.matchAll(/buscarHoteles\(\{/g)].length, 1);
  });

  test("la disponibilidad es AUXILIAR: si la acción falla o rechaza, la búsqueda persona se muestra igual", () => {
    assert.match(cuerpoBuscar, /\}\)\.catch\(\(\) => null\),/);
    // Un rechazo de la acción auxiliar deja la lista de unidad VACÍA — nunca
    // impide publicar las filas persona.
    assert.match(cuerpoBuscar, /unidadRes\?\.ok\s*\n?\s*\? unidadRes\.disponibilidad\.filter/);
    assert.match(cuerpoBuscar, /: \[\];/);
    // El error de la búsqueda persona sí corta (y sube `null`): son sus
    // resultados los que no se pueden pintar.
    assert.match(cuerpoBuscar, /if \(!r\.ok\) \{ setErr\(r\.error\); onBusqueda\?\.\(null\); return; \}/);
  });
});

// ── B) VISTA BOOKING: modo búsqueda, destino y estado vacío ───────────────

describe("VistaBooking — modo búsqueda (requisito A)", () => {
  test("recibe el canal del buscador (setter directo, referencia estable para el efecto de invalidación)", () => {
    assert.match(codigoVista, /import \{ BuscadorBooking, Resultado, type EstadoBusquedaPorcion \} from "\.\/BuscadorBooking";/);
    assert.match(codigoVista, /const \[busquedaPorcion, setBusquedaPorcion\] = useState<EstadoBusquedaPorcion \| null>\(null\);/);
    assert.match(codigoVista, /<BuscadorBooking [^>]*onBusqueda=\{setBusquedaPorcion\}/);
  });

  test("el modo búsqueda SOLO existe en Porción terrestre: Bloqueo y Receptivos quedan intactos (requisito E)", () => {
    assert.match(codigoVista, /const enBusquedaPorcion = sub === "porcion_terrestre" && busquedaPorcion != null;/);
    // Los DOS usos de `destinoPorcionEfectivo` están gateados por la pestaña
    // de Porción terrestre — nunca aplican a Bloqueo ni a Receptivos.
    const gateados = [...codigoVista.matchAll(/if \(\w+ === "porcion_terrestre" && destinoPorcionEfectivo/g)].length;
    assert.equal(gateados, 2, "persona + unidad: los dos filtros de destino deben estar gateados por la pestaña");
    // Ninguna COMPARACIÓN contra el destino efectivo puede quedar fuera de
    // esos dos filtros gateados.
    const comparaciones = codigoVista
      .split(/\r?\n/)
      .filter((l) => /destinoPorcionEfectivo/.test(l) && /!==|===/.test(l));
    for (const l of comparaciones) {
      assert.match(l, /"porcion_terrestre" && destinoPorcionEfectivo/, `comparación sin gate de pestaña: ${l.trim()}`);
    }
    assert.equal(comparaciones.length, 2);
  });

  test('mientras hay búsqueda vigente NO se renderiza "O explora todos los alojamientos"', () => {
    const posLiteral = codigoVista.indexOf('"O explora todos los alojamientos"');
    assert.ok(posLiteral > -1, "el texto de exploración debe seguir existiendo (modo exploración)");
    // El literal vive en la rama ELSE de la cadena encabezado: después del
    // ternario que empieza por `enBusquedaPorcion ?`.
    const posTernario = codigoVista.lastIndexOf("enBusquedaPorcion ?", posLiteral);
    assert.ok(posTernario > -1, "el encabezado debe ramificar por `enBusquedaPorcion ?` antes del literal de exploración");
    const bloqueEncabezado = codigoVista.slice(posTernario, posLiteral);
    assert.match(bloqueEncabezado, /Resultados de tu búsqueda/);
  });

  test("el encabezado de resultados dice destino y fechas de la búsqueda y el contador refleja el conjunto realmente visible", () => {
    assert.match(codigoVista, /Resultados de tu búsqueda/);
    assert.ok(codigoVista.includes("en ${busquedaPorcion.destino}"), "el encabezado debe nombrar el destino buscado");
    assert.ok(codigoVista.includes("{busquedaPorcion.fechaIda} → {busquedaPorcion.fechaRegreso}"), "el encabezado debe mostrar las fechas buscadas");
    assert.match(codigoVista, /<span className="ml-2 font-normal normal-case text-gray-400">\(\{tarjetas\.length\}\)<\/span>/);
  });

  test("el selector de destino de EXPLORACIÓN sigue existiendo, pero se oculta mientras la búsqueda manda el destino", () => {
    assert.match(codigoVista, /value=\{destinoPorcionSel\}/);
    assert.match(codigoVista, /sub === "porcion_terrestre" && !enBusquedaPorcion && destinosPorcion\.length > 0 && \(/);
  });

  test("con la búsqueda vigente hay UN solo estado vacío (el de la grilla unificada) — el de exploración no se pinta", () => {
    assert.match(codigoVista, /\{!tarjetas\.length && !enBusquedaPorcion && <p/);
  });

  test("el estado vacío de la búsqueda distingue 'lo ocultaron los filtros' de 'la búsqueda no encontró nada'", () => {
    assert.match(codigoVista, /const resultadosBusquedaVisibles = useMemo\(\(\) => \{/);
    // Se cuenta lo que la búsqueda REALMENTE trajo (persona + unidad), con la
    // misma exclusión autoritativa de filas persona obsoletas que la grilla —
    // y contando ALOJAMIENTOS, no filas: un hotel en dos paquetes del destino
    // es UNA tarjeta, así que el "ocultaste N" tiene que decir lo mismo que el
    // contador del encabezado.
    const memo = cuerpoFuncion(codigoVista, "const resultadosBusquedaVisibles = useMemo(() => {");
    assert.match(memo, /hotelesPersona\.size \+ busquedaPorcion\.unidad\.length/);
    assert.match(memo, /if \(!idsUnidad\.has\(r\.hotelId\)\) hotelesPersona\.add\(r\.hotelId\);/);
    assert.match(codigoVista, /resultadosBusquedaVisibles > 0 \? \(/);
    // El diagnóstico real del motor sólo se muestra en la rama "no encontró
    // nada", y las sugerencias de fecha sólo cuando el motor no alcanzó a
    // evaluar ningún hotel (son las ÚNICAS que se pueden volver a pedir).
    assert.match(codigoVista, /busquedaPorcion\.diagnostico\s*\n\s*\? busquedaPorcion\.diagnostico/);
    assert.match(codigoVista, /\{!!busquedaPorcion\.sugerenciasFecha\.length && \(/);
  });

  test("las fechas alternativas se pueden volver a pedir: el clic entra por un canal con `nonce` (un solo disparo por clic)", () => {
    const fuentePagina = sinComentarios(fuenteVista);
    assert.match(fuentePagina, /const \[sugerenciaPedida, setSugerenciaPedida\] = useState<\(SugerenciaFecha & \{ nonce: number \}\) \| null>\(null\);/);
    assert.match(fuentePagina, /onClick=\{\(\) => setSugerenciaPedida\(\{ \.\.\.s, nonce: \(sugerenciaPedida\?\.nonce \?\? 0\) \+ 1 \}\)\}/);
    assert.match(fuentePagina, /sugerenciaPedida=\{sugerenciaPedida\}/);
    // El buscador aplica cada pedido UNA vez (guarda por nonce), nunca en bucle.
    assert.match(codigoBuscador, /const nonceSugerenciaRef = useRef\(0\);/);
    assert.match(codigoBuscador, /if \(nonceSugerenciaRef\.current === sugerenciaPedida\.nonce\) return;/);
    assert.match(codigoBuscador, /nonceSugerenciaRef\.current = sugerenciaPedida\.nonce;/);
    // `aplicarSugerenciaFecha` se invoca a través de un ref "último valor": se
    // re-crea en cada render, así que como dependencia haría correr el efecto en
    // cada render — justo lo que la guarda por `nonce` existe para evitar. El
    // efecto depende SÓLO del pedido.
    assert.match(codigoBuscador, /const aplicarSugerenciaRef = useRef\(aplicarSugerenciaFecha\);/);
    assert.match(codigoBuscador, /useEffect\(\(\) => \{ aplicarSugerenciaRef\.current = aplicarSugerenciaFecha; \}\);/);
    assert.match(codigoBuscador, /aplicarSugerenciaRef\.current\(sugerenciaPedida\);/);
    assert.match(codigoBuscador, /\}, \[sugerenciaPedida\]\);/);
    assert.doesNotMatch(codigoBuscador, /aplicarSugerenciaFecha\(sugerenciaPedida\);/);
  });
});

describe("VistaBooking — resultado CERRADO por destino, persona y unidad por el mismo criterio (requisito B)", () => {
  test("destinoPorcionEfectivo es el ÚNICO punto de sustitución: búsqueda si la hay, selector de exploración si no", () => {
    assert.match(codigoVista, /const destinoPorcionEfectivo = busquedaPorcion \? busquedaPorcion\.destino : destinoPorcionSel;/);
  });

  test("la grilla de hoteles PERSONA se cierra al destino efectivo", () => {
    assert.match(codigoVista, /if \(mod === "porcion_terrestre" && destinoPorcionEfectivo && \(f\.destino_nombre \?\? ""\) !== destinoPorcionEfectivo\) return false;/);
  });

  test("la grilla de hoteles UNIDAD se cierra con el MISMO destino efectivo (no queda relegada a la grilla general)", () => {
    assert.match(codigoVista, /if \(sub === "porcion_terrestre" && destinoPorcionEfectivo\) arr = arr\.filter\(\(h\) => \(h\.destinoNombre \?\? ""\) === destinoPorcionEfectivo\);/);
  });

  test("los dos memos dependen de destinoPorcionEfectivo (persona y unidad se recalculan juntos, nunca con criterios distintos)", () => {
    assert.match(codigoVista, /\}, \[filas, fotosPorHotel, infoPorHotel, sub, cuposPorBloqueo, origenPorBloqueo, origenSel, destinoSel, destinoPorcionEfectivo, salidaSel, soloAcom, soloPetFriendly, soloAdultsOnly\]\);/);
    assert.match(codigoVista, /\}, \[hotelesBernalo, sub, destinoSel, destinoPorcionEfectivo, soloPetFriendly, soloAdultsOnly, infoPorHotel\]\);/);
  });

  test("se conserva hotelIdsUnidadAutoritativos: sin filas duplicadas cuando el hotel tiene una fila persona obsoleta", () => {
    assert.match(codigoVista, /hotelIdsUnidadAutoritativos = \[\]/);
    assert.match(codigoVista, /const idsUnidadAutoritativa = new Set\(hotelIdsUnidadAutoritativos\);/);
    // En modo búsqueda la exclusión también se aplica: la fila persona de un
    // hotel que hoy es unidad sería la caché obsoleta de `tarifario_resultado`.
    assert.match(cuerpoTarjetas, /if \(idsUnidadAutoritativa\.has\(r\.hotelId\) \|\| !porFiltros\(r\.hotelId\)\) continue;/);
  });

  test("sin duplicados: un hotel en dos paquetes del destino es UNA sola tarjeta (la del total más bajo)", () => {
    // `buscarHoteles` devuelve una fila por (paquete, hotel) — sin este
    // recorte la MISMA tarjeta aparecería repetida y el contador del
    // encabezado mentiría sobre cuántos alojamientos hay.
    const rama = cuerpoTarjetas.slice(cuerpoTarjetas.indexOf("if (enBusquedaPorcion && busquedaPorcion) {"), cuerpoTarjetas.indexOf("return [...busca, ...unidad].sort("));
    assert.match(rama, /const vistos = new Set<number>\(\);/);
    assert.match(rama, /if \(vistos\.has\(r\.hotelId\)\) continue;/);
    assert.match(rama, /vistos\.add\(r\.hotelId\);/);
    // El orden del motor (`resultados.sort((a,b) => a.total - b.total)`) es la
    // razón por la que quedarse con la primera fila = quedarse con la más
    // barata; si ese orden cambia, este recorte elige otra fila sin avisar.
    assert.match(fuenteVista, /\/\/ .*ordenado por total ascendente/);
    // La unidad ya viene agrupada por hotel (una oferta por paquete, una
    // tarjeta por hotel) — nunca se mapea una tarjeta por oferta.
    assert.match(rama, /\.map\(\(u\) => \(\{/);
    assert.equal([...rama.matchAll(/key: `u-\$\{u\.hotelId\}`/g)].length, 1);
  });

  test("los filtros del usuario (Pet friendly / Adults Only) siguen aplicando a las dos mitades de la lista", () => {
    assert.match(cuerpoTarjetas, /const porFiltros = \(hotelId: number\) => \{/);
    assert.match(cuerpoTarjetas, /busquedaPorcion\.unidad\s*\n\s*\.filter\(\(u\) => porFiltros\(u\.hotelId\)\)/);
  });
});

describe("VistaBooking — disponibilidad real del hotel unidad (requisito C)", () => {
  test("la tarjeta unidad de la búsqueda es la MISMA tarjeta de exploración, con el badge de un hecho ya verificado", () => {
    const rama = codigoVista.slice(codigoVista.indexOf("onClick={() => setModalBernalo(t.hotel)}"));
    const tarjeta = rama.slice(0, rama.indexOf("/>"));
    assert.match(tarjeta, /tieneCondicion=\{infoPorHotel\[t\.hotel\.hotelId\]\?\.tieneCondicion\}/);
    // El badge de disponibilidad sólo aparece en modo búsqueda (fuera de él no
    // hay disponibilidad declarada que mostrar) y no tiene rama negativa.
    assert.match(tarjeta, /badgeEsquina=\{enBusquedaPorcion \? \(/);
    assert.doesNotMatch(tarjeta, /Sin disponibilidad/);
    assert.match(tarjeta, /Disponible para tus fechas/);
  });

  test("la tarjeta unidad NO anuncia un precio: sigue sin 'desde' (un mínimo verosímil no está precargado)", () => {
    const rama = codigoVista.slice(codigoVista.indexOf("onClick={() => setModalBernalo(t.hotel)}"));
    const tarjeta = rama.slice(0, rama.indexOf("/>"));
    assert.match(tarjeta, /desde=\{null\}/);
    assert.doesNotMatch(tarjeta, /moneda=/);
  });

  test("la vista NO recalcula ni cotiza: la disponibilidad la resolvió el servidor", () => {
    // La grilla de búsqueda no vuelve a correr el motor ni abre el cliente
    // admin: todo eso pasó en la Server Action y llegó resuelto como estado.
    assert.doesNotMatch(codigoVista, /computarReservaBernalo/);
    assert.doesNotMatch(codigoVista, /createAdminClient/);
    // `cotizarAlojamientoBernaloPublico` SÍ vive en este archivo, pero en el
    // modal de cotización por demanda (`EditorPax`), que es el camino de
    // siempre y no la grilla: ninguna llamada puede quedar fuera de ese
    // cuerpo, o significaría una cotización disparada al pintar resultados.
    const cuerpoEditorPax = cuerpoFuncion(fuenteVista, "function EditorPax({");
    const todas = [...codigoVista.matchAll(/cotizarAlojamientoBernaloPublico\(/g)].length;
    const enModal = [...cuerpoEditorPax.matchAll(/cotizarAlojamientoBernaloPublico\(/g)].length;
    assert.ok(todas > 0, "el modal de cotización por demanda sigue existiendo");
    assert.equal(enModal, todas, `${todas - enModal} llamada(s) a cotización fuera de EditorPax (¿desde la grilla?)`);
  });
});

// ── C) LA SERVER ACTION: acotada, sancionada y sin datos internos ─────────

describe("busquedaUnidadActions.ts — frontera pública (requisitos C y D)", () => {
  test('es una Server Action y solo exporta tipos + funciones async (un `export const` rompería el build de Next)', () => {
    assert.match(fuenteAction.split(/\r?\n/).slice(0, 3).join("\n"), /"use server"/);
    const exports = codigoAction.split(/\r?\n/).filter((l) => /^\s*export\b/.test(l));
    assert.ok(exports.length > 0);
    for (const l of exports) {
      assert.match(l, /^\s*export (type|async function)\b/, `export no permitido en un archivo "use server": ${l.trim()}`);
    }
    assert.doesNotMatch(codigoAction, /export const/);
  });

  test("revalida el body como `unknown` con los MISMOS validadores del flujo público (el navegador no es autoridad)", () => {
    assert.match(codigoAction, /validarRangoFechasConsulta\(datos\.fechaIda, datos\.fechaRegreso\)/);
    assert.match(codigoAction, /validarDestinoConsulta\(datos\.destino\)/);
    assert.match(codigoAction, /validarHabitacionesConsultadas\(datos\.habitaciones\)/);
    assert.match(codigoAction, /validarAdultosDeclarados\(datos\.adultos\)/);
    assert.match(codigoAction, /validarCantidadMenores\(datos\.cantidadMenores\)/);
    assert.match(codigoAction, /validarEdadesMenores\(datos\.edadesMenores, vCantidad\.cantidad\)/);
    assert.match(codigoAction, /validarPaxTotalConsulta\(vAdultos\.adultos, vCantidad\.cantidad\)/);
    assert.match(codigoAction, /typeof input !== "object" \|\| input === null \|\| Array\.isArray\(input\)/);
  });

  test("los candidatos se acotan por DESTINO antes de leer nada por paquete_id (no calcula hoteles de todos los destinos)", () => {
    assert.match(codigoAction, /cargarHotelesBernaloDescubiertos\(\{ destino: vDestino\.destino \}\)/);
    assert.doesNotMatch(codigoAction, /cargarHotelesBernaloDescubiertos\(\)/);
  });

  test("solo considera paquetes de porción terrestre (un paquete con vuelo no se puede resolver con salida sin_vuelo)", () => {
    assert.match(codigoAction, /if \(h\.tipo !== "porcion_terrestre"\) continue;/);
    assert.match(codigoAction, /salida: \{ tipo: "sin_vuelo", fechaIda, fechaRegreso \}/);
  });

  test("una sola lectura por lote de las reglas de ocupación de TODOS los candidatos (nunca una consulta por hotel)", () => {
    const lecturas = [...codigoAction.matchAll(/\.from\("(hotel_acomodaciones|hoteles)"\)/g)].length;
    assert.equal(lecturas, 2, "exactamente hotel_acomodaciones + hoteles, en un solo lote");
    assert.match(codigoAction, /\.in\("hotel_id", idsAevaluar\)/);
    assert.match(codigoAction, /\.in\("id", idsAevaluar\)/);
  });

  test("reutiliza el reparto autoritativo del motor persona y lo reenvía por la MISMA frontera de validación pública", () => {
    assert.match(codigoAction, /repartirMenoresEnHabitaciones\(\{/);
    assert.match(codigoAction, /const vOcupacion = validarHabitacionesOcupacion\(reparto\.habitaciones\);/);
  });

  test("reutiliza computarReservaBernalo como única fuente del cálculo (no cambia el cálculo financiero)", () => {
    assert.match(codigoAction, /await computarReservaBernalo\(\{/);
    assert.doesNotMatch(codigoAction, /snapshot|totalNeto|valorComision|comision|proveedor|costo/i);
  });

  test("el resultado interno de computarReservaBernalo NUNCA se guarda ni se reenvía completo: solo se lee su código, y de él se construye a mano la identidad pública mínima", () => {
    assert.match(cuerpoEvaluarHotel, /if \(resultado\.ok\) \{/);
    assert.doesNotMatch(codigoAction, /return resultado|resultado\.pvp|resultado\.total|resultado\.snapshot/);
    // La identidad que sale se arma campo por campo desde `combo`
    // (categoría/alimentación/paqueteId ya conocidos de ANTES de llamar al
    // motor) y `fechaIda`/`fechaRegreso`/`ocupacion` (los datos de la
    // búsqueda) — nunca desde `resultado` (la respuesta de
    // `computarReservaBernalo`), que solo se consulta por su `.ok`/`.codigo`.
    assert.doesNotMatch(cuerpoEvaluarHotel, /oferta: resultado/);
  });

  // Hallazgo confirmado (auditoría independiente): el título anterior
  // ("solo identidad + veredicto") describía el shape VIEJO de forma
  // ambigua — la rama positiva SIEMPRE llevó más que un id (nombre,
  // paquete, moneda...). Lo que cambió de verdad es CUÁNTO de eso: antes
  // era el catálogo COMPLETO del hotel (`ofertas: HotelBernaloDescubierto[]`,
  // todas sus categorías/regímenes/salidas de TODOS sus paquetes, como si
  // todas estuvieran confirmadas); ahora es la identidad ESCALAR de la
  // ÚNICA combinación que de verdad pasó `computarReservaBernalo`
  // (`oferta: OfertaUnidadConfirmada`, singular) — nunca un arreglo de
  // ofertas sin verificar.
  test("la respuesta pública lleva la identidad de la oferta CONFIRMADA (hotel + paquete + categoría + alimentación + fechas + ocupación) — nunca todas las ofertas del hotel, nunca precio/costo/snapshot/proveedor", () => {
    const pos = codigoAction.indexOf("export type DisponibilidadUnidadHotel =");
    assert.ok(pos > -1, "falta el tipo del veredicto por hotel");
    const decl = codigoAction.slice(pos, codigoAction.indexOf("};", pos) + 2);
    assert.match(decl, /hotelId: number; estado: "disponible"; oferta: OfertaUnidadConfirmada/, "la rama positiva lleva la identidad de UNA sola oferta — la confirmada, no el catálogo completo");
    assert.doesNotMatch(decl, /ofertas: HotelBernaloDescubierto\[\]/, "nunca debe volver el arreglo completo de ofertas sin verificar");
    assert.match(decl, /hotelId: number; estado: "sin_disponibilidad"/);
    assert.doesNotMatch(decl, /pvp|precio|neto|snapshot|costo|proveedor|comision/i);
    assert.match(codigoAction, /export type ResultadoBusquedaUnidad =\s*\n\s*\| \{ ok: true; disponibilidad: DisponibilidadUnidadHotel\[\] \}\s*\n\s*\| \{ ok: false; error: string \};/);
    // `OfertaUnidadConfirmada` (el shape de `oferta`) en sí: identidad
    // escalar + fechas + ocupación — nunca precio/costo/snapshot/proveedor,
    // y nunca los arreglos de categorías/regímenes/salidas de TODO el hotel.
    const posOferta = codigoAction.indexOf("export type OfertaUnidadConfirmada = {");
    assert.ok(posOferta > -1, "falta el tipo de la oferta confirmada");
    const declOferta = codigoAction.slice(posOferta, codigoAction.indexOf("};", posOferta) + 2);
    assert.match(declOferta, /categoria: string;/);
    assert.match(declOferta, /alimentacion: string;/);
    assert.match(declOferta, /fechaIda: string;/);
    assert.match(declOferta, /fechaRegreso: string;/);
    assert.match(declOferta, /ocupacion: \{ id: string; acom: AcomRoom; adultos: number; edadesMenores: number\[\] \}\[\];/);
    assert.doesNotMatch(declOferta, /categorias: string\[\]|regimenes: string\[\]|salidas:/, "nunca debe llevar los arreglos completos del catálogo del hotel — solo la combinación confirmada");
    assert.doesNotMatch(declOferta, /pvp|precio|neto|snapshot|costo|proveedor|comision/i);
  });

  test("un fallo del descubrimiento o de las reglas de ocupación no rompe la búsqueda: se devuelve vacío (fail-closed)", () => {
    assert.match(codigoAction, /return \{ ok: true, disponibilidad: \[\] \}; \/\/ auxiliar: un fallo acá nunca rompe la búsqueda/);
    assert.match(codigoAction, /return \{ ok: true, disponibilidad: \[\] \}; \/\/ fail-closed: sin reglas confiables no se afirma nada/);
  });

  test("un hotel sin fila maestra o Adults Only con menores declarados nunca se anuncia como disponible", () => {
    assert.match(cuerpoEvaluarHotel, /if \(!fila\) return null;/);
    assert.match(cuerpoEvaluarHotel, /if \(edades\.length > 0 && fila\.adults_only\) return \{ hotelId, estado: "sin_disponibilidad" \};/);
    assert.match(cuerpoEvaluarHotel, /return \{ hotelId, estado: "sin_disponibilidad" \};/);
  });

  test("no escribe nada (solo lectura): ninguna mutación en la acción", () => {
    assert.doesNotMatch(codigoAction, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
  });
});

// ── El descubrimiento, ahora acotado por destino ──────────────────────────

describe("datosBernalo.ts — descubrimiento acotado por destino (base de datos, no JavaScript)", () => {
  test("acepta un destino opcional sin cambiar el comportamiento por defecto (page.tsx sigue llamando sin argumentos)", () => {
    assert.match(codigoDatos, /export type OpcionesDescubrimientoBernalo = \{ destino\?: string \| null \};/);
    assert.match(codigoDatos, /export async function cargarHotelesBernaloDescubiertos\(\s*\n\s*opciones\?: OpcionesDescubrimientoBernalo\s*\n\)/);
    const fuentePagina = sinComentarios(readFileSync(join(raiz, "app/tarifario/page.tsx"), "utf8"));
    assert.match(fuentePagina, /cargarHotelesBernaloDescubiertos\(\)/, "la vitrina completa sigue llamando sin opciones");
    assert.doesNotMatch(fuentePagina, /cargarHotelesBernaloDescubiertos\(\{/);
  });

  test("el destino se resuelve a sus ids y se filtra EN LA CONSULTA — no se traen los paquetes de otros destinos", () => {
    // El nombre entra sin traducción (es la misma cadena que ya usan
    // `destinosPorcion`/`destinosBuscador`) y se resuelve contra `destinos.id`:
    // los nombres pueden repetirse, así que se toman TODOS los ids.
    assert.match(codigoDatos, /const destinoPedido = \(opciones\?\.destino \?\? ""\)\.trim\(\);/);
    assert.match(codigoDatos, /\.from\("destinos"\)\s*\n\s*\.select\("id"\)\s*\n\s*\.eq\("nombre", destinoPedido\)/);
    assert.match(codigoDatos, /idsDestino = \[\.\.\.new Set\(\(destinos \?\? \[\]\)\.map\(\(d\) => d\.id as number\)\)\];/);
    assert.match(codigoDatos, /if \(idsDestino\.length\) q = q\.in\("destino_id", idsDestino\);/);
    assert.match(codigoDatos, /\.eq\("activo", true\)/);
    // Y el filtro vive en el armador de la consulta, no en un `.filter()` posterior.
    assert.match(codigoDatos, /const paquetesBase = \(\) => \{/);
    assert.match(codigoDatos, /const \{ data: paquetes, error: ePq \} = await paquetesBase\(\);/);
  });

  test("el filtro de destino se aplica ANTES de derivar los ids que alimentan las lecturas por paquete_id", () => {
    const posFiltro = codigoDatos.indexOf('q.in("destino_id", idsDestino)');
    const posVacio = codigoDatos.indexOf("if (!paquetesActivos.length) return");
    const posIds = codigoDatos.indexOf("const idsActivos = paquetesActivos.map((p) => p.id);");
    const posLecturas = codigoDatos.indexOf('.in("paquete_id", idsActivos)');
    assert.ok(posFiltro > -1 && posVacio > posFiltro && posIds > posVacio && posLecturas > posIds,
      "orden exigido: filtrar por destino en la consulta → corto-circuito si no queda nada → ids → lecturas por paquete_id");
  });

  test("falla cerrado: destino inexistente o consulta fallida devuelve VACÍO, nunca el catálogo completo", () => {
    assert.match(codigoDatos, /if \(eDestino\) return \{ ok: false, error: eDestino\.message \};/);
    assert.match(codigoDatos, /if \(!idsDestino\.length\) return \{ ok: true, hoteles: \[\], hotelIdsUnidadAutoritativos: \[\] \};/);
    // Sin destino pedido no se consulta `destinos` ni se filtra: el
    // comportamiento histórico queda intacto.
    const posGuard = codigoDatos.indexOf("if (destinoPedido) {");
    assert.ok(posGuard > -1, "el filtro tiene que estar condicionado a que haya destino pedido");
  });

  test("sigue siendo la única fuente de hotelIdsUnidadAutoritativos (la identidad del modelo NO se deriva de las ofertas)", () => {
    assert.match(codigoDatos, /hotelIdsUnidadAutoritativos/);
    assert.match(codigoDatos, /return \{ ok: true, hoteles, hotelIdsUnidadAutoritativos \};/);
    assert.match(codigoDatos, /return \{ ok: true, hoteles: \[\], hotelIdsUnidadAutoritativos: \[\] \};/);
  });
});

// ── E) OFERTA REALMENTE CONFIRMADA: preselección exacta en el modal ───────
//
// Hallazgo confirmado (auditoría independiente): antes `evaluarHotel`
// probaba combinaciones (paqueteId, categoría, alimentación) y al primer
// éxito devolvía TODAS las ofertas del hotel como si todas estuvieran
// verificadas — el modal dejaba elegir una combinación DISTINTA a la que
// realmente pasó `computarReservaBernalo`. Ahora la identidad exacta que
// funcionó viaja hasta el modal y lo preselecciona — nunca la primera
// oferta a secas.
describe("Oferta REALMENTE confirmada — identidad exacta hasta el modal (nunca la primera oferta a secas)", () => {
  const cuerpoModal = cuerpoFuncion(fuenteVista, "function HotelBernaloCotizarModal({");
  const cuerpoEditorPax = cuerpoFuncion(fuenteVista, "function EditorPax({");

  test("evaluarHotel identifica la combinación EXACTA que funcionó (combo.oferta.paqueteId/categoria/alimentacion) — nunca ofertas[0] ni un índice fijo", () => {
    // El objeto que se devuelve se arma DESDE `combo` (la iteración que
    // encontró el éxito), nunca desde `ofertas[0]` — si el hotel tiene dos
    // paquetes y solo el segundo combo evaluado tiene tarifa, `combo` en ese
    // punto ES el segundo, y es lo único que se lee.
    assert.match(cuerpoEvaluarHotel, /paqueteId: combo\.oferta\.paqueteId,/);
    assert.match(cuerpoEvaluarHotel, /categoria: combo\.categoria,/);
    assert.match(cuerpoEvaluarHotel, /alimentacion: combo\.alimentacion,/);
    assert.doesNotMatch(cuerpoEvaluarHotel, /ofertas\[0\]/, "nunca debe leer la primera oferta a secas — la identidad sale de `combo`, el que realmente tuvo éxito");
  });

  test("las combinaciones se recorren en orden determinista y CADA una se prueba contra el motor antes de pasar a la siguiente — la 2ª oferta puede ser la que confirme (nunca se asume que la 1ª es la buena)", () => {
    // `combinacionesDe` interlava ofertas (k-ésima combinación de CADA
    // oferta antes de pasar a la k+1) — con la 1ª oferta sin tarifa para
    // estas fechas, su combinación simplemente no produce `resultado.ok` y
    // el `for` sigue hasta la de la 2ª oferta, que si tiene éxito es la que
    // se identifica.
    assert.match(codigoAction, /for \(let k = 0; k < maxPares; k\+\+\) \{/);
    assert.match(codigoAction, /for \(let o = 0; o < ofertas\.length; o\+\+\) \{/);
    assert.match(cuerpoEvaluarHotel, /for \(const combo of combos\) \{/);
    // El resultado se construye DENTRO del cuerpo del `for`, con el `combo`
    // de ESA iteración — no hay ningún camino que "recuerde" solo la
    // primera iteración.
    const idxFor = cuerpoEvaluarHotel.indexOf("for (const combo of combos) {");
    const idxReturn = cuerpoEvaluarHotel.indexOf("paqueteId: combo.oferta.paqueteId,", idxFor);
    assert.ok(idxFor > -1 && idxReturn > idxFor, "la identidad debe construirse DENTRO del bucle, usando el combo de esa vuelta");
  });

  test("la categoría/alimentación que llegan al modal son las de la combinación confirmada — mismo dato, sin transformar, desde OfertaUnidadConfirmada hasta EditorPax", () => {
    // VistaBooking arma la oferta única del modal con `[u.oferta.categoria]`/
    // `[u.oferta.alimentacion]` (arreglo de UN elemento — la confirmada).
    assert.match(codigoVista, /categorias: \[u\.oferta\.categoria\],/);
    assert.match(codigoVista, /regimenes: \[u\.oferta\.alimentacion\],/);
    // Y EditorPax nace con `categoriaSel`/`alimentacionSel` = esos mismos
    // valores — nunca vacíos ni tomados de otra parte.
    assert.match(cuerpoEditorPax, /const \[categoriaSel, setCategoriaSel\] = useState\(preseleccionBernalo\?\.categoria \?\? ""\);/);
    assert.match(cuerpoEditorPax, /const \[alimentacionSel, setAlimentacionSel\] = useState\(preseleccionBernalo\?\.alimentacion \?\? ""\);/);
  });

  test("el arreglo `ofertas` del modal trae UN solo elemento cuando viene de una búsqueda — el mismo mecanismo de autoselección (ofertas.length === 1) que ya existía preselecciona la confirmada, nunca deja elegir una sin verificar", () => {
    assert.match(codigoVista, /ofertas: \[\{/);
    // Dentro de ese único elemento van los campos escalares de
    // `OfertaUnidadConfirmada` — nunca el catálogo completo del hotel.
    const idxOfertaUnica = codigoVista.indexOf("ofertas: [{");
    const idxFinOfertaUnica = codigoVista.indexOf("}],", idxOfertaUnica);
    assert.ok(idxOfertaUnica > -1 && idxFinOfertaUnica > idxOfertaUnica);
    const bloque = codigoVista.slice(idxOfertaUnica, idxFinOfertaUnica);
    assert.match(bloque, /salidas: \[\],/, "porción terrestre nunca tiene salidas — no se inventa ninguna");
    // La auto-selección ya existente (`ofertas.length === 1 ? ofertas[0].paqueteId : null`)
    // sigue siendo el ÚNICO mecanismo de selección — no se agregó un segundo
    // camino paralelo que pudiera divergir.
    assert.match(cuerpoModal, /const \[paqueteIdSel, setPaqueteIdSel\] = useState<number \| null>\(ofertas\.length === 1 \? ofertas\[0\]\.paqueteId : null\);/);
  });

  test("preseleccionBernalo solo se pasa cuando la oferta seleccionada ACTUALMENTE en el modal coincide con la confirmada (por paqueteId) — nunca precarga datos de una oferta distinta", () => {
    assert.match(
      cuerpoModal,
      /preseleccionBernalo=\{hotelGrupo\.confirmada\?\.paqueteId === hotel\.paqueteId \? hotelGrupo\.confirmada : undefined\}/
    );
  });

  test("las fechas de la búsqueda llegan precargadas al modal: fechaIdaBernalo/fechaRegresoBernalo nacen de preseleccionBernalo, nunca vacías cuando hay una oferta confirmada", () => {
    assert.match(cuerpoEditorPax, /const \[fechaIdaBernalo, setFechaIdaBernalo\] = useState\(preseleccionBernalo\?\.fechaIda \?\? ""\);/);
    assert.match(cuerpoEditorPax, /const \[fechaRegresoBernalo, setFechaRegresoBernalo\] = useState\(preseleccionBernalo\?\.fechaRegreso \?\? ""\);/);
  });

  test("la ocupación buscada (habitaciones + adultos + edades) se traslada SIN reconstrucción ambigua: mismos ids posicionales que construirHabitacionesUI, agrupados por acom", () => {
    const cuerpoHabs = cuerpoEditorPax.slice(
      cuerpoEditorPax.indexOf("const [habs, setHabs] = useState"),
      cuerpoEditorPax.indexOf("const [cantidadMenores, setCantidadMenoresState]")
    );
    assert.match(cuerpoHabs, /for \(const h of preseleccionBernalo\.ocupacion\) out\[h\.acom\] = \(out\[h\.acom\] \?\? 0\) \+ 1;/);
    const cuerpoEdades = cuerpoEditorPax.slice(
      cuerpoEditorPax.indexOf("const [edadesPorHabitacion, setEdadesPorHabitacion] = useState"),
      cuerpoEditorPax.indexOf("const [categoriaSel, setCategoriaSel]")
    );
    assert.match(cuerpoEdades, /for \(const h of preseleccionBernalo\.ocupacion\) out\[h\.id\] = h\.edadesMenores\.map\(String\);/);
  });

  test("cambiar categoría, alimentación o fecha DESPUÉS del prefill limpia resultadoCotizacion — el prefill nunca sustituye la validación real, siempre exige volver a cotizar", () => {
    // Mismo mecanismo preexistente (cada `onChange` ya limpiaba
    // `resultadoCotizacion`) — se verifica que sigue intacto con el prefill
    // en juego, para las CUATRO entradas que ahora pueden llegar
    // precargadas: categoría, alimentación, fecha de ida y fecha de regreso.
    assert.match(cuerpoEditorPax, /onChange=\{\(e\) => \{ setCategoriaSel\(e\.target\.value\); setResultadoCotizacion\(null\); \}\}/);
    assert.match(cuerpoEditorPax, /onChange=\{\(e\) => \{ setAlimentacionSel\(e\.target\.value\); setResultadoCotizacion\(null\); \}\}/);
    assert.match(cuerpoEditorPax, /onChange=\{\(e\) => \{ setFechaIdaBernalo\(e\.target\.value\); setResultadoCotizacion\(null\); \}\}/);
    assert.match(cuerpoEditorPax, /onChange=\{\(e\) => \{ setFechaRegresoBernalo\(e\.target\.value\); setResultadoCotizacion\(null\); \}\}/);
    // El botón de agregar al carrito exige `resultadoCotizacion.ok` — nunca
    // se habilita solo porque el formulario nació prellenado.
    assert.match(cuerpoEditorPax, /!resultadoCotizacion\?\.ok/);
  });

  test("el prefill nunca marca nada como 'ya confirmado' en el propio estado: resultadoCotizacion nace null incluso con preseleccionBernalo presente", () => {
    assert.match(cuerpoEditorPax, /const \[resultadoCotizacion, setResultadoCotizacion\] = useState<ResultadoCotizarAlojamientoBernaloPublico \| null>\(null\);/);
  });
});

// ── F) CAMBIO DE PESTAÑA: la búsqueda no sobrevive a abandonar Porción ────
//
// Hallazgo confirmado (auditoría independiente): `BuscadorBooking` se
// desmonta al salir de Porción terrestre, pero `busquedaPorcion`/
// `sugerenciaPedida` viven en `VistaBooking` (el padre) — nada los limpiaba.
// Volver a Porción terrestre remontaba un formulario en blanco mientras la
// grilla seguía "congelada" en modo búsqueda, sin el botón "Limpiar
// resultados" a la vista (vive dentro del hijo recién montado, con su propio
// estado reiniciado).
describe("Cambio de pestaña — la búsqueda de Porción terrestre no sobrevive a abandonarla", () => {
  const cuerpoCambiarSub = cuerpoFuncion(fuenteVista, "function cambiarSub(next: typeof sub)");

  test("cambiarSub limpia busquedaPorcion Y sugerenciaPedida al salir de porcion_terrestre hacia CUALQUIER otra pestaña (Bloqueo o Receptivos) — la condición no depende de a cuál se va, solo de DE DÓNDE se sale", () => {
    assert.match(cuerpoCambiarSub, /if \(sub === "porcion_terrestre" && next !== "porcion_terrestre"\) \{/);
    assert.match(cuerpoCambiarSub, /setBusquedaPorcion\(null\);/);
    assert.match(cuerpoCambiarSub, /setSugerenciaPedida\(null\);/);
    assert.match(cuerpoCambiarSub, /setSub\(next\);/);
  });

  test("buscar → cambiar a Bloqueo → volver a Porción: los DOS botones de pestaña pasan por cambiarSub (nunca setSub directo) — Bloqueo y Receptivos son simples valores de `next`, mismo mecanismo para los dos", () => {
    // Único punto de cambio de `sub` en toda la vista: el botón de pestañas.
    assert.match(codigoVista, /onClick=\{\(\) => cambiarSub\(t\.key\)\}/);
    // `SUBTABS` sigue listando las tres pestañas — el botón de "Bloqueo"
    // (key "bloqueo") y el de "Receptivos" (key "receptivos") usan el MISMO
    // `onClick`, así que los dos casos (buscar→Bloqueo→volver,
    // buscar→Receptivos→volver) están cubiertos por el mismo código, sin
    // una rama especial por pestaña destino.
    assert.match(codigoVista, /const SUBTABS = \[/);
    assert.match(codigoVista, /\{ key: "bloqueo", label: "Paquetes" \}/);
    assert.match(codigoVista, /\{ key: "receptivos", label: "Receptivos" \}/);
  });

  test("no queda `setSub(` suelto en ningún otro lugar del componente — cambiarSub es el ÚNICO punto de cambio, así que ninguna transición puede saltarse la limpieza", () => {
    // La única ocurrencia de `setSub(` debe ser la de DENTRO de `cambiarSub`
    // (la que de verdad actualiza el estado) — cualquier otra sería un
    // segundo camino que se saltaría la limpieza.
    const usos = [...codigoVista.matchAll(/\bsetSub\(/g)];
    assert.equal(usos.length, 1, `debe existir exactamente un setSub( — el de dentro de cambiarSub; se encontraron ${usos.length}`);
  });

  test("el flujo addonsIntent (cart → Receptivos) también pasa por cambiarSub — vía un ref 'último valor' para no violar las reglas de hooks (cambiarSub no es una referencia estable) — sin ampliar su propósito original", () => {
    const cuerpoEfectoAddons = fuenteVista.slice(
      fuenteVista.indexOf("if (addonsIntent) cambiarSubRef.current"),
      fuenteVista.indexOf("if (addonsIntent) cambiarSubRef.current") + 200
    );
    assert.match(cuerpoEfectoAddons, /if \(addonsIntent\) cambiarSubRef\.current\("receptivos"\);/);
    assert.match(cuerpoEfectoAddons, /\}, \[addonsIntent\]\);/);
    // El ref se mantiene actualizado en cada render (patrón ya usado en este
    // mismo archivo para `aplicarSugerenciaFecha`) — el efecto en sí solo
    // depende de `addonsIntent`, nunca de `cambiarSub` (eso causaría un
    // bucle: `cambiarSub` no es una referencia estable de React).
    assert.match(codigoVista, /const cambiarSubRef = useRef\(cambiarSub\);/);
    assert.match(codigoVista, /useEffect\(\(\) => \{ cambiarSubRef\.current = cambiarSub; \}\);/);
  });

  test("no queda encabezado, contador ni estado vacío de la búsqueda anterior al volver: todos están gateados por enBusquedaPorcion/busquedaPorcion, que cambiarSub ya limpió", () => {
    // Los tres puntos de UI que dependen del modo búsqueda siguen atados a
    // `busquedaPorcion`/`enBusquedaPorcion` — al quedar en `null`/`false`
    // (por `cambiarSub`), ninguno de los tres puede seguir pintado.
    assert.match(codigoVista, /enBusquedaPorcion \? \(/); // encabezado "Resultados de tu búsqueda..."
    assert.match(codigoVista, /\{enBusquedaPorcion && !tarjetas\.length && \(/); // estado vacío de búsqueda
    assert.match(codigoVista, /const enBusquedaPorcion = sub === "porcion_terrestre" && busquedaPorcion != null;/);
  });

  test('"Limpiar resultados" (limpieza MANUAL, sin cambiar de pestaña) sigue funcionando exactamente igual: cambiarSub no reemplaza ni toca limpiarResultados', () => {
    assert.match(cuerpoLimpiar, /setHuellaBuscada\(null\);/);
    assert.match(cuerpoLimpiar, /onBusqueda\?\.\(null\);/);
    // `limpiarResultados` vive en `BuscadorBooking` (limpieza del propio
    // formulario) — `cambiarSub` vive en `VistaBooking` (limpieza al
    // cambiar de pestaña); son DOS mecanismos independientes que no se
    // reemplazan entre sí, cada uno resuelve una carrera distinta.
    assert.doesNotMatch(codigoBuscador, /cambiarSub/);
  });

  test("respuesta tardía tras el desmontaje: un montadoRef se marca `false` en el cleanup del efecto y se revisa ANTES de llamar onBusqueda/setErr en el callback asíncrono — cambiar de pestaña no toca ningún campo del formulario ni incrementa la generación", () => {
    assert.match(codigoBuscador, /const montadoRef = useRef\(true\);/);
    assert.match(codigoBuscador, /useEffect\(\(\) => \(\) => \{ montadoRef\.current = false; \}, \[\]\);/);
    assert.match(cuerpoBuscar, /if \(!montadoRef\.current\) return;/);
    // La guarda de montaje debe estar ANTES de cualquier onBusqueda/setErr
    // del callback asíncrono — nunca después. Y va DESPUÉS de la guarda de
    // generación (ambas antes de publicar): la generación cubre la carrera de
    // criterios/búsquedas, el montaje cubre el desmontaje, ninguna reemplaza
    // a la otra.
    const idxGuardaGeneracion = cuerpoBuscar.indexOf("if (generacionBusquedaRef.current !== miGeneracion) return;");
    const idxGuardaMontaje = cuerpoBuscar.indexOf("if (!montadoRef.current) return;");
    const idxPrimeraLlamada = cuerpoBuscar.indexOf("onBusqueda?.(", idxGuardaGeneracion);
    assert.ok(idxGuardaGeneracion > -1 && idxGuardaMontaje > idxGuardaGeneracion, "la guarda de montaje debe venir después de la de generación (ambas antes de publicar)");
    assert.ok(idxPrimeraLlamada > idxGuardaMontaje, "ninguna llamada a onBusqueda debe quedar antes de la guarda de montaje");
  });

  test("el montadoRef se marca false SOLO en el cleanup (desmontaje real) — nunca en cada render, para no invalidar una búsqueda en vuelo dentro del mismo montaje", () => {
    // El array de dependencias vacío (`[]`) es lo que garantiza que el
    // `useEffect` corre UNA sola vez por montaje, y su función de limpieza
    // (la que marca `false`) solo se ejecuta al desmontar — nunca entre
    // renders del mismo componente montado.
    const idxEfecto = codigoBuscador.indexOf("useEffect(() => () => { montadoRef.current = false; }, []);");
    assert.notEqual(idxEfecto, -1, "el efecto de desmontaje debe tener un arreglo de dependencias vacío");
  });
});

// ── Carrera residual de solicitudes — generacionBusquedaRef ────────────────
//
// Hallazgo (auditoría independiente, ronda posterior a la de "Cambio de
// pestaña" de arriba): `huellaVivaRef` se sincronizaba con `huellaActual`
// mediante un `useEffect`. La guarda `huellaVivaRef.current !== huella` NO
// era atómica con el evento que cambiaba un criterio: el evento (1) llama
// `limpiarResultados()` y (2) programa el cambio de estado del campo, pero
// el efecto que actualizaba la huella "viva" solo corría en el render
// SIGUIENTE — una respuesta que resolvía justo en esa ventana todavía veía
// la huella VIEJA y se publicaba de todas formas. La ventana era pequeña
// pero la protección no era síncrona.
//
// Reemplazo: `generacionBusquedaRef`, un contador que se incrementa de forma
// SÍNCRONA — dentro del mismo evento, nunca desde un efecto — en los dos
// únicos puntos de invalidación: `limpiarResultados()` (botón "Limpiar" y
// cada control que cambia un criterio, que ya lo invoca) y el arranque de
// `buscar()` (cubre también las sugerencias de fecha, porque
// `aplicarSugerenciaFecha` llama `buscar()` sin atajos propios). Cada
// búsqueda captura su generación al arrancar (`miGeneracion`, ANTES del
// `await`) y solo publica si, tras el `Promise.all`, `generacionBusquedaRef.
// current` sigue siendo EXACTAMENTE esa — nunca "la más alta vista hasta
// ahora" — así que el orden de LLEGADA de las respuestas no importa: solo
// importa cuál fue la ÚLTIMA en ARRANCAR. `huellaVivaRef`/`huellaActual` se
// eliminaron del todo (no quedaron como código muerto).
//
// Como en el resto del archivo, estas son pruebas de INSPECCIÓN DE FUENTE —
// `node --test` no puede montar este componente (JSX/Next, sin
// testing-library en este repo) y no hay aquí ningún simulador de
// temporizadores/promesas ni un render real. Verifican que el código
// GARANTIZA cada escenario por construcción (qué incrementa qué, en qué
// orden respecto al `await` y a los `setState`), no una ejecución del
// escenario. La parte puramente algorítmica del componente (huellaBusqueda,
// el reparto de edades) sí corre de verdad en `pruebas/repartoMenoresBusqueda.test.ts`.
describe("Carrera residual de solicitudes — generacionBusquedaRef (invalidación síncrona, no atada a un useEffect)", () => {
  test("el contador de generación existe como useRef (no useState: no debe re-renderizar ni depender de un efecto) y arranca en 0", () => {
    assert.match(codigoBuscador, /const generacionBusquedaRef = useRef\(0\);/);
  });

  test("la vía vieja (huellaVivaRef/huellaActual sincronizados por useEffect) fue ELIMINADA, no solo dejada de usar — no queda código muerto con la ventana de carrera original", () => {
    assert.doesNotMatch(codigoBuscador, /huellaVivaRef/);
    assert.doesNotMatch(codigoBuscador, /huellaActual/);
    // Ningún useEffect de este archivo sincroniza una huella hacia un ref.
    assert.doesNotMatch(codigoBuscador, /useEffect\(\(\) => \{ \w+\.current = huellaBusqueda/);
  });

  test("buscar(A) → cambiar destino antes de responder → A no publica: el onChange de destino pasa por limpiarResultados(), que incrementa la generación de forma síncrona", () => {
    assert.ok(codigoBuscador.includes('onChange={(e) => { setDestino(e.target.value); limpiarResultados(); }}'));
    assert.match(cuerpoLimpiar, /generacionBusquedaRef\.current \+= 1;/);
    assert.match(cuerpoBuscar, /if \(generacionBusquedaRef\.current !== miGeneracion\) return;/);
  });

  test("buscar(A) → buscar(B) → B responde primero → A no sobrescribe B: cada llamada a buscar() incrementa Y CAPTURA su propia generación ANTES del await, y la guarda compara IGUALDAD exacta (no \"mayor o igual\")", () => {
    const posIncremento = cuerpoBuscar.indexOf("const miGeneracion = (generacionBusquedaRef.current += 1);");
    const posAwait = cuerpoBuscar.indexOf("await Promise.all([");
    assert.ok(posIncremento > -1 && posAwait > posIncremento, "miGeneracion debe capturarse ANTES del await — si se capturara después del Promise.all, dos búsquedas en vuelo podrían leer la misma generación");
    // Comparación de igualdad exacta: la generación de A (vieja) nunca vuelve
    // a coincidir con la actual (la de B) sin importar qué respuesta llega
    // primero — el resultado no depende del orden de llegada, solo del orden
    // de arranque.
    assert.match(cuerpoBuscar, /if \(generacionBusquedaRef\.current !== miGeneracion\) return;/);
  });

  test("buscar(A) → limpiar antes de responder → A no reaparece: limpiarResultados() también incrementa, aunque no se vuelva a buscar después", () => {
    assert.match(cuerpoLimpiar, /generacionBusquedaRef\.current \+= 1;/);
    const posIncremento = cuerpoLimpiar.indexOf("generacionBusquedaRef.current += 1;");
    const posSetHuella = cuerpoLimpiar.indexOf("setHuellaBuscada(null);");
    assert.ok(posIncremento > -1 && posSetHuella > posIncremento, "el incremento va primero — no depende de que el setState ya haya corrido");
  });

  test("buscar(A) → aplicar sugerencia que inicia B → A no sobrescribe B: aplicarSugerenciaFecha llama a buscar() sin atajo propio, así que B pasa por el MISMO incremento síncrono que cualquier otra búsqueda (no hay una segunda copia de la lógica de generación)", () => {
    const cuerpoAplicar = cuerpoFuncion(codigoBuscador, "function aplicarSugerenciaFecha(s: SugerenciaFecha)");
    assert.match(cuerpoAplicar, /buscar\(s\.fechaIda, s\.fechaRegreso\);/);
    const usos = [...codigoBuscador.matchAll(/generacionBusquedaRef\.current \+= 1/g)];
    assert.equal(usos.length, 2, `debe haber exactamente 2 incrementos síncronos en todo el archivo — uno en limpiarResultados(), otro en buscar(); se encontraron ${usos.length}`);
  });

  test("desmontar por cambio de pestaña → ninguna respuesta publica: montadoRef sigue cubriendo el desmontaje (cambiar de pestaña no toca ningún campo ni llama limpiarResultados/buscar, así que la generación por sí sola no lo detecta)", () => {
    assert.match(codigoBuscador, /const montadoRef = useRef\(true\);/);
    assert.match(cuerpoBuscar, /if \(!montadoRef\.current\) return;/);
    // Las dos guardas conviven, ninguna sustituye a la otra: generación cubre
    // criterios/búsquedas nuevas, montaje cubre el desmontaje.
    const posGuardaGeneracion = cuerpoBuscar.indexOf("if (generacionBusquedaRef.current !== miGeneracion) return;");
    const posGuardaMontaje = cuerpoBuscar.indexOf("if (!montadoRef.current) return;");
    assert.ok(posGuardaGeneracion > -1 && posGuardaMontaje > posGuardaGeneracion, "ambas guardas antes de publicar, generación primero");
  });

  test("una búsqueda vigente SIN cambios sí publica normalmente: la guarda es un `!==` que deja pasar cuando nada invalidó, no un candado incondicional", () => {
    const posGuarda = cuerpoBuscar.indexOf("if (generacionBusquedaRef.current !== miGeneracion) return;");
    const posPublicacion = cuerpoBuscar.indexOf("onBusqueda?.({");
    assert.ok(posGuarda > -1 && posPublicacion > posGuarda, "debe existir un camino de publicación DESPUÉS de la guarda");
    assert.match(cuerpoBuscar, /if \(!r\.ok\) \{ setErr\(r\.error\); onBusqueda\?\.\(null\); return; \}/);
  });

  test("limpiar y volver a buscar los mismos criterios funciona: la generación es un contador de SECUENCIA (no una huella derivada de los criterios) y nunca se reinicia, así que una búsqueda nueva con los mismos criterios que una limpiada obtiene una generación propia e independiente", () => {
    assert.match(cuerpoBuscar, /const miGeneracion = \(generacionBusquedaRef\.current \+= 1\);/);
    assert.doesNotMatch(codigoBuscador, /generacionBusquedaRef\.current = 0/);
  });

  test("el incremento de generación vive en HANDLERS DE EVENTO (limpiarResultados/buscar), nunca dentro de un useEffect — los tres useEffect del archivo no escriben un setState de React directamente en su cuerpo", () => {
    assert.doesNotMatch(codigoBuscador, /useEffect\(\(\) => \{[^}]*generacionBusquedaRef\.current \+=/);
    // Los tres efectos existentes, verificados uno por uno.
    assert.match(fuenteBuscador, /useEffect\(\(\) => \(\) => \{ montadoRef\.current = false; \}, \[\]\);/);
    assert.match(fuenteBuscador, /useEffect\(\(\) => \{ aplicarSugerenciaRef\.current = aplicarSugerenciaFecha; \}\);/);
    // No se usa `cuerpoFuncion` acá: su rastreo de paréntesis asume que el
    // ancla cierra su propio paréntesis antes del "{" del cuerpo (caso
    // `function buscar(...) {`) — con un `useEffect(() => { ... })`, el
    // paréntesis de la llamada sigue ABIERTO en el "{" del cuerpo, así que
    // ese algoritmo saltaría de largo hasta un "{" de otra parte del
    // archivo. Acá se recortan los dos límites literales conocidos.
    const posInicioNonce = fuenteBuscador.indexOf("useEffect(() => {\r\n    if (!sugerenciaPedida) return;");
    assert.ok(posInicioNonce > -1, "no se encontró el efecto de la sugerencia de fecha");
    const posFinNonce = fuenteBuscador.indexOf("}, [sugerenciaPedida]);", posInicioNonce);
    assert.ok(posFinNonce > -1, "no se encontró el cierre del efecto de la sugerencia de fecha");
    const cuerpoEfectoNonce = fuenteBuscador.slice(posInicioNonce, posFinNonce);
    assert.doesNotMatch(cuerpoEfectoNonce, /\bset[A-Z]\w*\(/);
  });
});
