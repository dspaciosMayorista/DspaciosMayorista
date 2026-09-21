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
// La decisión por hotel (antes `evaluarHotel`, inline en la Server Action)
// se extrajo a un módulo PURO e inyectable — cierre del hallazgo "Hotel
// Prueba Odair no aparece" — para poder probarla con comportamiento REAL
// (`pruebas/evaluarDisponibilidadUnidad.test.ts`), no solo por inspección de
// fuente. Este archivo sigue verificando el CABLEADO (qué usa qué, en qué
// orden, qué expone la Server Action) — la lógica de decisión en sí ya no se
// verifica acá dos veces.
const fuenteEval = readFileSync(join(raiz, "lib/tarifario/evaluarDisponibilidadUnidad.ts"), "utf8");

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
const codigoEval = sinComentarios(fuenteEval);

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
const cuerpoEvaluarHotel = cuerpoFuncion(codigoEval, "export async function evaluarDisponibilidadHotelUnidad(");
// `cuerpoFuncion` (brace-balancer) no sirve para este useMemo: su firma
// `useMemo<{...}>(() => {` tiene profundidad de paréntesis > 0 en el "{" real
// del cuerpo (el `()` de la función flecha nunca vuelve a 0 mientras el
// `useMemo(` externo sigue abierto), así que el balanceador nunca lo
// reconoce como inicio. Se acota manualmente con el marcador de cierre
// conocido (mismo criterio que pruebas/ocupacionBernaloUI3EWiring.test.ts).
// El armado de candidatos (recomendados + resto, exploración/búsqueda) vive
// en `datosBase` (useMemo separado del `tarjetas` final que solo filtra/
// ordena) — `cuerpoTarjetas` abarca AMBOS useMemo (datosBase + tarjetas),
// hasta el mismo marcador de cierre de siempre.
const idxInicioTarjetas = codigoVista.indexOf("const datosBase = useMemo<{");
const idxFinTarjetasCuerpo = codigoVista.indexOf("const [abierto, setAbierto] = useState<HotelCard | null>(null);", idxInicioTarjetas);
const cuerpoTarjetas = codigoVista.slice(idxInicioTarjetas, idxFinTarjetasCuerpo);

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

  test("VistaBooking tiene UNA sola grilla, UN solo contador y UN solo resultado por OFERTA (hotelId+paqueteId)", () => {
    assert.equal([...codigoVista.matchAll(/\{tarjetas\.map\(\(t\) =>/g)].length, 1, "una sola grilla de tarjetas");
    assert.equal([...codigoVista.matchAll(/<Resultado\b/g)].length, 1, "la fila persona se pinta en un solo lugar");
    assert.equal([...codigoVista.matchAll(/\(\{tarjetas\.length\}\)/g)].length, 1, "un solo contador, y sale de la MISMA colección que se pinta");
    // Ninguna lista paralela debajo (la grilla unidad tenía su propio `.map`
    // JSX). El chequeo se acota al `.map` dentro de un contenedor JSX
    // (`{hotelesUnidadVisibles.map(`): desde hoteles recomendados (migración
    // 183) esa colección SÍ se recorre para derivar DATOS (el set de
    // paqueteId coincidentes), y eso no es una lista paralela pintada.
    assert.doesNotMatch(codigoVista, /\{hotelesUnidadVisibles\.map\(/);
    assert.doesNotMatch(codigoVista, /hotelesUnidadVisibles\.length/);
  });

  test("un solo estado vacío por modo: el de exploración NO se pinta en modo búsqueda (y viceversa)", () => {
    assert.match(codigoVista, /\{!tarjetas\.length && !enBusquedaPorcion && <p/, "el vacío de exploración debe estar apagado en modo búsqueda");
    assert.match(codigoVista, /\{enBusquedaPorcion && !tarjetas\.length && \(/, "el único vacío de la búsqueda");
    assert.doesNotMatch(codigoVista, /hotel\(es\) disponibles para tu búsqueda<\/p>/, "no puede sobrevivir el contador crudo del buscador");
  });

  test("persona y unidad entran a la MISMA colección `tarjetas` (una sola fuente, un solo orden)", () => {
    const posRama = cuerpoTarjetas.indexOf("if (enBusquedaPorcion && busquedaPorcion) {");
    // El ensamblado antepone las recomendadas (en su propio orden de
    // prioridad, migración 183) al resto ya alfabetizado — persona y unidad
    // pasan por el MISMO return.
    const posReturn = cuerpoTarjetas.indexOf("return { itemsRecomendados, tarjetaPorClaveRecomendada, itemsRestoCandidatos, tarjetaPorClaveResto };");
    // La grilla de exploración (persona `cardsPersona` + unidad) se arma
    // DESPUÉS del return: son ramas excluyentes, nunca se suman.
    const posGrillaExploracion = cuerpoTarjetas.indexOf("const cardsPersona = hoteles.filter");
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
    // El filtro de destino de la grilla de exploración sigue existiendo, pero
    // SOLO se activa con una búsqueda EJECUTADA (`destinoPorcionBusqueda`) —
    // hallazgo 1: ya no cae al selector de exploración (que además se eliminó).
    assert.match(codigoVista, /if \(mod === "porcion_terrestre" && destinoPorcionBusqueda && \(f\.destino_nombre \?\? ""\) !== destinoPorcionBusqueda\) return false;/);
    const posReturn = cuerpoTarjetas.indexOf("return { itemsRecomendados, tarjetaPorClaveRecomendada, itemsRestoCandidatos, tarjetaPorClaveResto };");
    const posExploracion = cuerpoTarjetas.indexOf("const cardsPersona = hoteles.filter");
    assert.ok(posReturn > -1, "falta el return de la lista de búsqueda");
    assert.ok(posExploracion > posReturn, "la grilla precargada se arma sólo si NO hay búsqueda vigente");
    // La fila persona del modo búsqueda sale EXCLUSIVAMENTE de la respuesta del motor.
    const ramaBusqueda = cuerpoTarjetas.slice(cuerpoTarjetas.indexOf("if (enBusquedaPorcion && busquedaPorcion) {"), posReturn);
    assert.match(ramaBusqueda, /for \(const r of busquedaPorcion\.resultados\) \{/);
    assert.match(ramaBusqueda, /const resultadosPersona: BusquedaResultado\[\] = \[\];/);
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
    // El badge vive en `TarjetaUnidadBusqueda`, que SOLO se renderiza cuando
    // `busquedaPorcion.unidad` (ya filtrado a `estado === "disponible"`)
    // trajo este hotel — no hay rama condicional por disponibilidad DENTRO
    // de la tarjeta porque un veredicto negativo nunca llega hasta acá.
    const cuerpoTarjetaUnidadBadge = cuerpoFuncion(fuenteVista, "function TarjetaUnidadBusqueda({");
    assert.match(cuerpoTarjetaUnidadBadge, /Disponible para tus fechas/);
  });

  test("un estado que el servidor NO pudo concluir no se anuncia: se cae de la lista (y ahora queda REGISTRADO como inconcluyente, no en silencio)", () => {
    assert.match(codigoAction, /if \(v\.tipo === "veredicto"\) \{/);
    assert.match(codigoAction, /disponibilidad\.push\(v\.valor\);/);
    assert.match(codigoAction, /incompleto = true;/);
    assert.match(cuerpoEvaluarHotel, /if \(!fila\) return \{ tipo: "inconcluyente", hotelId, motivo: "hotel_sin_fila_maestra" \};/, "sin fila maestra no se inventan umbrales de edad");
  });

  test("fuera del modo búsqueda la exploración sigue funcionando normalmente", () => {
    assert.match(codigoVista, /const enBusquedaPorcion = sub === "porcion_terrestre" && busquedaPorcion != null;/);
    assert.match(cuerpoTarjetas, /const cardsPersona = hoteles\.filter/);
    assert.match(cuerpoTarjetas, /const restoUnidadCandidatas = hotelesUnidadVisibles\.filter\(\(h\) => !esRecomendada\(h\.hotelId, h\.paqueteId\)\);/);
    // El selector de destino de exploración se ELIMINÓ (era inerte): la
    // exploración de Porción no tiene ningún control de destino propio — quien
    // elige destino es el buscador real de arriba.
    assert.doesNotMatch(codigoVista, /destinoPorcionSel/, "no debe quedar el estado del selector de exploración eliminado");
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
    assert.match(codigoAction, /new Array<VeredictoHotelUnidad \| null>\(idsAevaluar\.length\)\.fill\(null\)/);
    assert.match(codigoAction, /if \(i >= idsAevaluar\.length\) return;/);
  });

  // La lógica de decisión POR HOTEL (combos, motivos, cortes tempranos) ya no
  // se verifica acá por inspección de fuente: vive en
  // `lib/tarifario/evaluarDisponibilidadUnidad.ts` y se prueba con
  // comportamiento REAL en `pruebas/evaluarDisponibilidadUnidad.test.ts`
  // (incluida la ausencia de `break`/`continue` prematuros — ver "dos
  // combinaciones: la primera falla técnico, la segunda confirma"). Acá solo
  // se verifica que la Server Action DELEGA en esa función en vez de
  // reimplementarla, y que el módulo puro no tiene un tope explícito.
  test("no existe un MAX_INTENTOS_POR_HOTEL/contador de combinaciones en el módulo de decisión, y la Server Action delega en él (no reimplementa la lógica)", () => {
    assert.doesNotMatch(codigoEval, /MAX_INTENTOS_POR_HOTEL|maxIntentos/);
    // `combinacionesDe` emite la k-ésima combinación de CADA oferta antes de
    // pasar a la k+1: ninguna queda fuera del recorrido.
    assert.match(codigoEval, /for \(let k = 0; k < maxPares; k\+\+\) \{/);
    assert.match(cuerpoEvaluarHotel, /const combos = combinacionesDe\(ofertas\);/);
    assert.match(cuerpoEvaluarHotel, /for \(const combo of combos\) \{/);
    // Nunca hay `break` (early-exit): la evaluación de esta ronda ya NO se
    // corta en el primer éxito — agota TODAS las combinaciones para reunir
    // las opciones de la tarjeta. `continue` SÍ existe (avanza a la
    // siguiente combinación tras registrar un éxito), pero es control de
    // flujo normal del bucle, no un atajo que descarte trabajo pendiente.
    assert.doesNotMatch(cuerpoEvaluarHotel, /\bbreak;/);
    assert.match(cuerpoEvaluarHotel, /opciones\.push\(\{/);
    // La Server Action llama a la función real, con el `computarReservaBernalo`
    // real inyectado — nunca copia su cuerpo.
    assert.match(codigoAction, /import \{\s*\n?\s*evaluarDisponibilidadHotelUnidad,/);
    assert.match(codigoAction, /computar: computarReservaBernalo,/);
    assert.doesNotMatch(codigoAction, /async function evaluarHotel\(/, "no debe quedar una copia local de la función movida");
  });

  test('"no evaluado" nunca se trata como "sin disponibilidad": el módulo de decisión distingue veredicto de inconcluyente (cobertura real en evaluarDisponibilidadUnidad.test.ts)', () => {
    assert.match(codigoEval, /const MOTIVOS_SIN_DISPONIBILIDAD = new Set<string>\(\["fechas_fuera_de_ventana", "no_cotizable"\]\);/);
    assert.match(codigoEval, /export type VeredictoHotelUnidad =/);
    assert.match(codigoEval, /tipo: "inconcluyente"; hotelId: number; motivo: string/);
    // Un rechazo del reparto por CONFIGURACIÓN del hotel (no por la selección
    // pedida) tampoco autoriza la afirmación — inconcluyente, no
    // sin_disponibilidad.
    assert.match(cuerpoEvaluarHotel, /if \(reparto\.tipo === "seleccion_invalida"\) \{/);
    assert.match(cuerpoEvaluarHotel, /return \{ tipo: "inconcluyente", hotelId, motivo: `reparto_\$\{reparto\.tipo\}` \};/);
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
    // El de destino ahora es multilínea (también resuelve `destinoId` desde
    // la opción elegida — ver el describe de identidad de destino), pero
    // sigue terminando en `limpiarResultados();` como los demás.
    assert.match(codigoBuscador, /const opcion = destinos\.find\(\(d\) => d\.nombre === nombre\);\s*\n\s*setDestino\(nombre\);\s*\n\s*setDestinoId\(opcion\?\.id \?\? null\);\s*\n\s*limpiarResultados\(\);/);
    for (const control of [
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
    assert.match(codigoBuscador, /\{destinos\.map\(\(d\) => <option key=\{d\.nombre\} value=\{d\.nombre\}>\{d\.nombre\}<\/option>\)\}/);
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

  test("la Server Action de unidad también falla cerrada con destino vacío o sólo espacios — salvo que un destinoId válido ya identifique el destino sin ambigüedad", () => {
    // `validarDestinoConsulta` acepta "" a propósito (otros flujos públicos lo
    // usan como "todos los destinos"), así que el rechazo vive en la acción.
    // Un `destinoId` válido también cuenta como destino elegido (identidad
    // estable — ver `validarDestinoIdConsulta`).
    assert.match(codigoAction, /if \(vDestino\.destino\.trim\(\) === "" && destinoId == null\) \{/);
    assert.match(codigoAction, /return \{ ok: false, error: "Selecciona un destino para buscar\." \};/);
    const posGuarda = codigoAction.indexOf('if (vDestino.destino.trim() === "" && destinoId == null)');
    const posDescubrimiento = codigoAction.indexOf("cargarHotelesBernaloDescubiertos({ destino: vDestino.destino, destinoId })");
    assert.ok(posGuarda > -1 && posDescubrimiento > posGuarda, "el rechazo debe ir ANTES del descubrimiento (que sin destino barrenaría el catálogo)");
  });

  test("destinoId se valida como entero positivo — cualquier otra cosa (string, negativo, decimal) se descarta sin lanzar y cae al camino por nombre", () => {
    assert.match(codigoAction, /function validarDestinoIdConsulta\(v: unknown\): number \| null \{/);
    assert.match(codigoAction, /if \(typeof v !== "number" \|\| !Number\.isInteger\(v\) \|\| v <= 0\) return null;/);
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

  test("la disponibilidad es AUXILIAR: si la acción falla, rechaza o lanza, la búsqueda persona se muestra igual — nunca un `.catch(() => null)` que borre la distinción entre error y vacío", () => {
    // Fallo estructural corregido: el `.catch(() => null)` original convertía
    // CUALQUIER excepción en `null`, indistinguible de "no hay hoteles
    // unidad" — ahora el catch produce un `ResultadoBusquedaUnidad`
    // tipado (`ok: false`), nunca `null` a secas.
    assert.doesNotMatch(codigoBuscador, /\.catch\(\(\) => null\)/);
    assert.match(cuerpoBuscar, /\.catch\(\(e\): ResultadoBusquedaUnidad => \(\{/);
    assert.match(cuerpoBuscar, /ok: false,/);
    // `unidadRes` ya no puede ser `null` (el catch siempre resuelve a un
    // `ResultadoBusquedaUnidad`), así que el consumo ya no necesita `?.`.
    assert.match(cuerpoBuscar, /if \(unidadRes\.ok\) \{/);
    assert.match(cuerpoBuscar, /unidad = unidadRes\.disponibilidad\.filter/);
    // Un `ok:false` (o `incompleto:true`) deja un AVISO, nunca detiene la
    // publicación de los resultados persona.
    assert.match(cuerpoBuscar, /avisoUnidad = "No pudimos completar la búsqueda de alojamientos por unidad/);
    assert.match(cuerpoBuscar, /if \(unidadRes\.incompleto\) \{/);
    // El error de la búsqueda persona sí corta (y sube `null`): son sus
    // resultados los que no se pueden pintar — la unidad nunca bloquea esto.
    assert.match(cuerpoBuscar, /if \(!r\.ok\) \{ setErr\(r\.error\); onBusqueda\?\.\(null\); return; \}/);
    const posGuardaPersona = cuerpoBuscar.indexOf('if (!r.ok) { setErr(r.error); onBusqueda?.(null); return; }');
    const posUnidad = cuerpoBuscar.indexOf('if (unidadRes.ok) {');
    assert.ok(posGuardaPersona > -1 && posUnidad > posGuardaPersona, "persona se valida primero; su fallo corta ANTES de tocar unidad");
  });
});

// ── B) VISTA BOOKING: modo búsqueda, destino y estado vacío ───────────────

describe("VistaBooking — modo búsqueda (requisito A)", () => {
  test("recibe el canal del buscador vía confirmarBusquedaPorcion (envuelve setBusquedaPorcion para podar zona/estrellas al confirmar/limpiar — nunca el setter crudo)", () => {
    assert.match(codigoVista, /import \{ BuscadorBooking, Resultado, type EstadoBusquedaPorcion \} from "\.\/BuscadorBooking";/);
    assert.match(codigoVista, /const \[busquedaPorcion, setBusquedaPorcion\] = useState<EstadoBusquedaPorcion \| null>\(null\);/);
    assert.match(codigoVista, /<BuscadorBooking [^>]*onBusqueda=\{confirmarBusquedaPorcion\}/);
    assert.match(codigoVista, /function confirmarBusquedaPorcion\(resultado: EstadoBusquedaPorcion \| null\) \{\s*\n\s*setBusquedaPorcion\(resultado\);/, "confirmarBusquedaPorcion debe seguir llamando setBusquedaPorcion internamente");
  });

  test("el modo búsqueda SOLO existe en Porción terrestre: Bloqueo y Receptivos quedan intactos (requisito E)", () => {
    assert.match(codigoVista, /const enBusquedaPorcion = sub === "porcion_terrestre" && busquedaPorcion != null;/);
    // Los DOS usos de `destinoPorcionBusqueda` están gateados por la pestaña
    // de Porción terrestre — nunca aplican a Bloqueo ni a Receptivos.
    const gateados = [...codigoVista.matchAll(/if \(\w+ === "porcion_terrestre" && destinoPorcionBusqueda/g)].length;
    assert.equal(gateados, 2, "persona + unidad: los dos filtros de destino deben estar gateados por la pestaña");
    // Ninguna COMPARACIÓN contra el destino de la búsqueda puede quedar fuera
    // de esos dos filtros gateados. La derivación del valor
    // (`const destinoPorcionBusqueda = ...`) no compara destinos: solo lee
    // `busquedaPorcion.destino`.
    const comparaciones = codigoVista
      .split(/\r?\n/)
      .filter((l) => /destinoPorcionBusqueda/.test(l) && /!==|===/.test(l));
    for (const l of comparaciones) {
      assert.match(l, /"porcion_terrestre" && destinoPorcionBusqueda/, `comparación sin gate de pestaña: ${l.trim()}`);
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

  test("el selector de destino de EXPLORACIÓN se eliminó: no queda ningún control de destino sobre la grilla de Porción (el único es el buscador real)", () => {
    // Era un `<select>` que ya no podía acotar nada sin romper la regla del
    // estado global inicial (top 2 de CADA paquete antes de buscar) — un
    // control que modifica estado sin producir efecto se elimina, no se deja
    // inerte. El buscador real (`BuscadorBooking`) sigue siendo quien elige
    // destino y ejecuta la búsqueda.
    assert.doesNotMatch(codigoVista, /destinoPorcionSel/, "no debe quedar el estado ni el select de exploración");
    assert.doesNotMatch(codigoVista, /setDestinoPorcionSel/, "no debe quedar ningún setter de ese estado");
    assert.match(codigoVista, /<BuscadorBooking destinos=\{destinosPorcion\} onBusqueda=\{confirmarBusquedaPorcion\}/, "el buscador real sigue recibiendo la lista de destinos");
  });

  test("la barra de exploración de Porción no tiene NINGÚN control de destino: Pet friendly/Adults Only viven en PanelFiltrosResto", () => {
    // Los checkboxes de exploración (Pet friendly/Adults Only) se movieron a
    // un panel compacto reutilizable (`PanelFiltrosResto`, orden/filtro del
    // resto) — ya no hay ningún `<select>` de destino de exploración en
    // ninguna parte de la barra, y el panel es el ÚNICO lugar donde viven
    // esos dos checkboxes (regla: no dejar controles duplicados).
    assert.doesNotMatch(codigoVista, /Destino<\/span>/, "no debe quedar el control de destino eliminado");
    const cuerpoPanel = cuerpoFuncion(codigoVista, "function PanelFiltrosResto({");
    assert.match(cuerpoPanel, /checked=\{soloPetFriendly\}/);
    assert.match(cuerpoPanel, /checked=\{soloAdultsOnly\}/);
    assert.equal([...codigoVista.matchAll(/checked=\{soloPetFriendly\}/g)].length, 1, "un solo control de Pet friendly, sin duplicar");
    assert.equal([...codigoVista.matchAll(/checked=\{soloAdultsOnly\}/g)].length, 1, "un solo control de Adults Only, sin duplicar");
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
  test("destinoPorcionBusqueda es el ÚNICO punto de sustitución, y es SOLO la búsqueda ejecutada — nunca el selector de exploración (hallazgo 1)", () => {
    assert.match(codigoVista, /const destinoPorcionBusqueda = busquedaPorcion \? busquedaPorcion\.destino : "";/);
    const derivaciones = [...codigoVista.matchAll(/const destinoPorcionBusqueda =/g)];
    assert.equal(derivaciones.length, 1, "una sola derivación del destino que acota la búsqueda");
    // El valor NO puede mencionar el selector: si vuelve a depender de
    // `destinoPorcionSel`, elegir un destino sin buscar volvería a recortar el
    // universo (paquetes de otros destinos desaparecerían antes de buscar).
    const linea = codigoVista.slice(codigoVista.indexOf("const destinoPorcionBusqueda ="), codigoVista.indexOf(";", codigoVista.indexOf("const destinoPorcionBusqueda =")));
    assert.doesNotMatch(linea, /destinoPorcionSel/, "el acotamiento por destino no puede salir del selector de exploración");
  });

  test("el selector de exploración de Porción NO acota NINGÚN candidato: ni `hoteles` (persona) ni `hotelesUnidadVisibles` (unidad) lo mencionan", () => {
    // Hallazgo 1 — la regla del universo: antes de ejecutar Buscar, el estado
    // global muestra el top 2 de CADA paquete; elegir o escribir un destino en
    // el selector NO puede cambiar ese conjunto. Este test falla si alguno de
    // los dos memos de candidatos vuelve a filtrar por el selector.
    const memoHoteles = cuerpoFuncion(codigoVista, "const hoteles = useMemo<HotelCard[]>(() => {");
    const memoUnidad = cuerpoFuncion(codigoVista, "const hotelesUnidadVisibles = useMemo(() => {");
    assert.ok(memoHoteles.length > 0 && memoUnidad.length > 0, "no se encontraron los dos memos de candidatos");
    assert.doesNotMatch(memoHoteles, /destinoPorcionSel/, "los candidatos persona no pueden acotarse por el selector de exploración");
    assert.doesNotMatch(memoUnidad, /destinoPorcionSel/, "los candidatos unidad no pueden acotarse por el selector de exploración");
    // Y el único destino que sí acota en Porción terrestre es el de la
    // búsqueda ejecutada (más la rama de Bloqueo, que no se toca).
    assert.match(memoHoteles, /if \(mod === "porcion_terrestre" && destinoPorcionBusqueda &&/);
    assert.match(memoUnidad, /if \(sub === "porcion_terrestre" && destinoPorcionBusqueda\)/);
  });

  test("la grilla de hoteles PERSONA se cierra al destino BUSCADO (y solo entonces)", () => {
    assert.match(codigoVista, /if \(mod === "porcion_terrestre" && destinoPorcionBusqueda && \(f\.destino_nombre \?\? ""\) !== destinoPorcionBusqueda\) return false;/);
  });

  test("la grilla de hoteles UNIDAD se cierra con el MISMO destino buscado (no queda relegada a la grilla general)", () => {
    assert.match(codigoVista, /if \(sub === "porcion_terrestre" && destinoPorcionBusqueda\) arr = arr\.filter\(\(h\) => \(h\.destinoNombre \?\? ""\) === destinoPorcionBusqueda\);/);
  });

  test("los dos memos dependen de destinoPorcionBusqueda (persona y unidad se recalculan juntos, nunca con criterios distintos)", () => {
    // Memo de cards persona (`hoteles`) — Pet friendly/Adults Only ya NO
    // filtran acá (se movieron a FiltrosResto, aplicados después de elegir
    // recomendados), así que salieron de sus dependencias.
    assert.match(codigoVista, /\}, \[filas, fotosPorHotel, infoPorHotel, sub, cuposPorBloqueo, origenPorBloqueo, origenSel, destinoSel, destinoPorcionBusqueda, salidaSel, soloAcom\]\);/);
    assert.match(codigoVista, /\}, \[hotelesBernalo, sub, destinoSel, destinoPorcionBusqueda\]\);/);
    // Memo de candidatos (`datosBase`) — hoteles recomendados (migración 183)
    // le suman `destinoActivoSub` (el gatillo A/B: destino activo ≠ destino
    // meramente elegido) y `prioridadesRecomendados`; tampoco depende de
    // soloPetFriendly/soloAdultsOnly (mismo motivo).
    assert.match(
      codigoVista,
      /\}, \[\s*\n\s*hoteles, hotelesUnidadVisibles, hotelIdsUnidadAutoritativos, enBusquedaPorcion, busquedaPorcion, infoPorHotel,\s*\n\s*destinoActivoSub, prioridadesRecomendados, condicionPorOferta, politicaPorOferta,\s*\n\s*restriccionPorPaquete,\s*\n\s*\]\);/
    );
  });

  test("se conserva hotelIdsUnidadAutoritativos: sin filas duplicadas cuando el hotel tiene una fila persona obsoleta", () => {
    assert.match(codigoVista, /hotelIdsUnidadAutoritativos = \[\]/);
    assert.match(codigoVista, /const idsUnidadAutoritativa = new Set\(hotelIdsUnidadAutoritativos\);/);
    // En modo búsqueda la exclusión también se aplica: la fila persona de un
    // hotel que hoy es unidad sería la caché obsoleta de `tarifario_resultado`.
    // `porFiltros` (Pet/Adults) se ELIMINÓ de este punto — ya no acota antes
    // de elegir recomendados (ver describe de más abajo).
    assert.match(cuerpoTarjetas, /if \(idsUnidadAutoritativa\.has\(r\.hotelId\)\) continue;/);
  });

  test("sin duplicados REALES: la deduplicación es por OFERTA (hotelId+paqueteId) — un hotel en dos paquetes del destino son DOS tarjetas distintas, nunca una", () => {
    // Antes esta prueba exigía "una sola tarjeta por hotelId" (`Set<number>`):
    // quedarse con la primera fila de cada hotel descartaba ofertas reales del
    // MISMO hotel en otro paquete (ej. tarifa normal + paquete 3x2), y además
    // impedía que "hoteles recomendados" —que son POR PAQUETE, migración
    // 183— tratara cada oferta como independiente. Ahora la identidad es
    // siempre el par, y el dedup (defensivo: `buscarHoteles` ya entrega como
    // máximo una fila por par) es por par.
    const rama = cuerpoTarjetas.slice(cuerpoTarjetas.indexOf("if (enBusquedaPorcion && busquedaPorcion) {"), cuerpoTarjetas.indexOf("return { itemsRecomendados, tarjetaPorClaveRecomendada, itemsRestoCandidatos, tarjetaPorClaveResto };"));
    assert.match(rama, /const vistasPersona = new Set<string>\(\);/);
    assert.match(rama, /const clave = claveOferta\(r\.hotelId, r\.paqueteId\);/);
    assert.match(rama, /if \(vistasPersona\.has\(clave\)\) continue;/);
    assert.match(rama, /vistasPersona\.add\(clave\);/);
    // Ningún dedup por hotelId a secas: no queda ningún `Set` de hoteles
    // "vistos" (el `Set<number>` que existía antes) ni una comparación de
    // deduplicación contra `r.hotelId`. La única mención de `r.hotelId` que
    // sobrevive es la exclusión por canal autoritativo (`idsUnidadAutoritativa`
    // — la caché persona obsoleta de un hotel que hoy es unidad), que no es
    // deduplicación.
    assert.doesNotMatch(rama, /vistos/, "no debe quedar ningún `vistos` por hotelId en la rama de búsqueda");
    assert.doesNotMatch(rama, /new Set<number>\(\)/, "no debe quedar ningún Set vacío por hotelId (el Set que queda es de claves de oferta, tipado Set<string>)");
    assert.match(rama, /const vistasPersona = new Set<string>\(\);/);
    // La unidad también se identifica por par: la key de cada tarjeta lleva
    // hotelId Y paqueteId (antes `u-${hotelId}-...` colisionaba para el mismo
    // hotel en dos paquetes).
    assert.match(rama, /key: `u-\$\{g\.hotelId\}-\$\{g\.paqueteId\}-\$\{claveBusquedaUnidad\(g\.opciones\)\}`,/);
    assert.equal([...rama.matchAll(/key: `u-\$\{g\.hotelId\}-\$\{g\.paqueteId\}-/g)].length, 1);
    // Y las tarjetas de la búsqueda se arman por grupo, no mapeando una lista
    // plana por hotel.
    assert.match(rama, /gruposUnidadBusqueda\.filter\(\(g\) => !clavesRecomendadasBusqueda\.has/);
  });

  test("los filtros del usuario (Pet friendly / Adults Only) YA NO acotan la lista de candidatos de búsqueda (porFiltros eliminado) — se aplican DESPUÉS, vía FiltrosResto, a las dos mitades por igual", () => {
    assert.doesNotMatch(cuerpoTarjetas, /const porFiltros/, "porFiltros debe eliminarse por completo");
    // Unidad: se agrupan TODAS las opciones confirmadas, sin filtrar por
    // hotelId antes de repartir por oferta (el reparto en sí sigue viviendo
    // en la función pura `agruparOpcionesUnidadPorOferta`).
    assert.match(cuerpoTarjetas, /agruparOpcionesUnidadPorOferta\(\s*\n\s*busquedaPorcion\.unidad\.flatMap\(\(u\) => u\.opciones\)\s*\n\s*\);/);
    // El filtro real vive en el `tarjetas` final: mismo predicado
    // (`filtrosVistaEfectivos.petFriendly`/`.adultsOnly`) para persona y
    // unidad, recomendados y resto — ver pruebas/filtrosVistaBookingWiring.test.ts.
  });
});

describe("VistaBooking — disponibilidad real del hotel unidad (requisito C)", () => {
  test("la tarjeta unidad de EXPLORACIÓN (sin opcionesBusqueda) conserva tieneCondicion y sigue sin 'desde' — el precio no está precargado fuera de una búsqueda", () => {
    const rama = codigoVista.slice(codigoVista.indexOf("onClick={() => setModalBernalo(t.hotel)}"));
    const tarjeta = rama.slice(0, rama.indexOf("/>"));
    assert.match(tarjeta, /tieneCondicion=\{infoPorHotel\[t\.hotel\.hotelId\]\?\.tieneCondicion\}/);
    assert.match(tarjeta, /desde=\{null\}/);
    assert.doesNotMatch(tarjeta, /moneda=/);
  });

  test("la vista NO recalcula ni cotiza en el RENDER de la grilla: `computarReservaBernalo` no vive en este archivo, y la revalidación de precio (`cotizarAlojamientoBernaloPublico`) solo ocurre dentro de una acción de usuario (EditorPax al cotizar, o TarjetaUnidadBusqueda al agregar al carrito) — nunca al pintar resultados", () => {
    // La grilla de búsqueda no vuelve a correr el motor ni abre el cliente
    // admin: todo eso pasó en la Server Action y llegó resuelto como estado.
    assert.doesNotMatch(codigoVista, /computarReservaBernalo/);
    assert.doesNotMatch(codigoVista, /createAdminClient/);
    // `cotizarAlojamientoBernaloPublico` vive en DOS lugares, los dos
    // disparados por una acción explícita del usuario (nunca al renderizar):
    // el modal de exploración (`EditorPax`, cotizar bajo demanda) y
    // `TarjetaUnidadBusqueda` (revalidación obligatoria al agregar al
    // carrito, ver el describe dedicado más abajo) — ninguna otra llamada
    // puede quedar fuera de esos dos cuerpos.
    const cuerpoEditorPax = cuerpoFuncion(codigoVista, "function EditorPax({");
    // La ÚNICA LLAMADA directa `cotizarAlojamientoBernaloPublico(` en todo el
    // archivo vive dentro de EditorPax (cotización por demanda del modal). La
    // tarjeta de búsqueda NO la llama directo: la INYECTA en
    // `revalidarReservaUnidad` dentro de `agregar` (handler de usuario, nunca
    // en el render). Así ninguna cotización se dispara al pintar la grilla.
    const llamadasDirectas = [...codigoVista.matchAll(/cotizarAlojamientoBernaloPublico\(/g)].length;
    const llamadasEnModal = [...cuerpoEditorPax.matchAll(/cotizarAlojamientoBernaloPublico\(/g)].length;
    assert.equal(llamadasDirectas, 1, "solo el modal (EditorPax) debe LLAMAR la cotización directo");
    assert.equal(llamadasEnModal, 1, "esa única llamada directa debe estar dentro de EditorPax");
    // La tarjeta de búsqueda reutiliza la MISMA Server Action, inyectándola en
    // el helper de revalidación (nunca una copia paralela ni una llamada al
    // renderizar).
    const cuerpoTarjetaUnidad = cuerpoFuncion(fuenteVista, "function TarjetaUnidadBusqueda({");
    const cuerpoAgregarTarjeta = cuerpoFuncion(cuerpoTarjetaUnidad, "async function agregar() {");
    assert.match(cuerpoAgregarTarjeta, /revalidarReservaUnidad\(\s*\n?\s*cotizarAlojamientoBernaloPublico,/, "la tarjeta debe inyectar la cotización en el helper, dentro de agregar()");
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
    assert.match(codigoAction, /cargarHotelesBernaloDescubiertos\(\{ destino: vDestino\.destino, destinoId \}\)/);
    assert.doesNotMatch(codigoAction, /cargarHotelesBernaloDescubiertos\(\)/);
  });

  test("solo considera paquetes de porción terrestre (un paquete con vuelo no se puede resolver con salida sin_vuelo) — filtro y llamada `sin_vuelo` viven en el módulo puro, la Server Action lo inyecta", () => {
    assert.match(codigoEval, /if \(h\.tipo !== "porcion_terrestre"\) continue;/);
    assert.match(codigoEval, /salida: \{ tipo: "sin_vuelo", fechaIda, fechaRegreso \}/);
  });

  test("una sola lectura por lote de las reglas de ocupación de TODOS los candidatos (nunca una consulta por hotel)", () => {
    const lecturas = [...codigoAction.matchAll(/\.from\("(hotel_acomodaciones|hoteles)"\)/g)].length;
    assert.equal(lecturas, 2, "exactamente hotel_acomodaciones + hoteles, en un solo lote");
    assert.match(codigoAction, /\.in\("hotel_id", idsAevaluar\)/);
    assert.match(codigoAction, /\.in\("id", idsAevaluar\)/);
  });

  test("reutiliza el reparto autoritativo del motor persona y lo reenvía por la MISMA frontera de validación pública (módulo puro, cobertura real de ese reenvío en evaluarDisponibilidadUnidad.test.ts)", () => {
    assert.match(codigoEval, /repartirMenoresEnHabitaciones\(\{/);
    assert.match(codigoEval, /const vOcupacion = validarHabitacionesOcupacion\(entradaOcupacion\);/);
  });

  test("reutiliza computarReservaBernalo como única fuente del cálculo (no cambia el cálculo financiero) — la Server Action inyecta la función REAL, el módulo puro solo conoce su firma", () => {
    assert.match(codigoAction, /computar: computarReservaBernalo,/);
    assert.match(codigoEval, /const resultado = await computar\(\{/);
    assert.doesNotMatch(codigoAction, /snapshot|totalNeto|valorComision|comision|proveedor|costo/i);
    assert.doesNotMatch(codigoEval, /snapshot|totalNeto|valorComision|comision|proveedor|costo/i);
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

  // Cierre de UX (ronda posterior): antes la rama positiva llevaba la
  // identidad ESCALAR de una sola combinación (`oferta: OfertaUnidadConfirmada`,
  // singular, sin precio) — la tarjeta no podía mostrar categoría/
  // alimentación/precio sin volver a cotizar. Ahora lleva TODAS las
  // combinaciones que confirmaron, cada una YA con su precio público saneado
  // (`opciones: OpcionUnidadConfirmada[]`) — nunca el catálogo completo del
  // hotel (`HotelBernaloDescubierto[]`, con categorías/regímenes/salidas de
  // TODOS sus paquetes como si todas estuvieran confirmadas), y nunca el
  // resultado interno completo de `computarReservaBernalo` (costoNeto,
  // proveedor, comisión, snapshot).
  test("la respuesta pública lleva TODAS las combinaciones CONFIRMADAS (hotel + paquete + categoría + alimentación + precio + fechas + ocupación) — nunca el catálogo completo del hotel, nunca costo/snapshot/proveedor/comisión", () => {
    // Los dos tipos viven ahora en el módulo puro (`evaluarDisponibilidadUnidad.ts`)
    // y `busquedaUnidadActions.ts` los REEXPORTA (frontera pública) — nunca los
    // redeclara.
    assert.match(codigoAction, /export type \{ DisponibilidadUnidadHotel, OpcionUnidadConfirmada \};/);
    const pos = codigoEval.indexOf("export type DisponibilidadUnidadHotel =");
    assert.ok(pos > -1, "falta el tipo del veredicto por hotel");
    const decl = codigoEval.slice(pos, codigoEval.indexOf("};", pos) + 2);
    assert.match(decl, /hotelId: number; estado: "disponible"; opciones: OpcionUnidadConfirmada\[\]/, "la rama positiva lleva TODAS las opciones confirmadas — nunca el catálogo completo sin verificar");
    assert.doesNotMatch(decl, /ofertas: HotelBernaloDescubierto\[\]/, "nunca debe volver el arreglo completo de ofertas sin verificar");
    assert.match(decl, /hotelId: number; estado: "sin_disponibilidad"/);
    assert.doesNotMatch(decl, /costoNeto|snapshot|proveedor|comision/i);
    assert.match(codigoAction, /export type ResultadoBusquedaUnidad =\s*\n\s*\| \{ ok: true; disponibilidad: DisponibilidadUnidadHotel\[\]; incompleto: boolean \}\s*\n\s*\| \{ ok: false; error: string \};/);
    // `OpcionUnidadConfirmada` (el shape de cada elemento de `opciones`) en
    // sí: identidad + PRECIO PÚBLICO saneado (precioVenta/moneda/paxTotal) +
    // fechas + ocupación — nunca costo/snapshot/proveedor/comisión, y nunca
    // los arreglos de categorías/regímenes/salidas de TODO el hotel.
    const posOpcion = codigoEval.indexOf("export type OpcionUnidadConfirmada = {");
    assert.ok(posOpcion > -1, "falta el tipo de la opción confirmada");
    const declOpcion = codigoEval.slice(posOpcion, codigoEval.indexOf("};", posOpcion) + 2);
    assert.match(declOpcion, /categoria: string;/);
    assert.match(declOpcion, /alimentacion: string;/);
    assert.match(declOpcion, /moneda: string;/);
    assert.match(declOpcion, /precioVenta: number;/);
    assert.match(declOpcion, /paxTotal: number;/);
    assert.match(declOpcion, /fechaIda: string;/);
    assert.match(declOpcion, /fechaRegreso: string;/);
    assert.match(declOpcion, /ocupacion: \{ id: string; acom: AcomRoom; adultos: number; edadesMenores: number\[\] \}\[\];/);
    assert.doesNotMatch(declOpcion, /categorias: string\[\]|regimenes: string\[\]|salidas:/, "nunca debe llevar los arreglos completos del catálogo del hotel — solo la combinación confirmada");
    assert.doesNotMatch(declOpcion, /costoNeto|neto|snapshot|proveedor|comision/i);
    // El `computar` inyectado (la forma mínima del resultado de
    // `computarReservaBernalo` que este módulo puede leer) declara SOLO 3
    // campos en `ok:true` — cualquier otro campo del resultado interno
    // (costoHotelTotal, proveedorHotel, habitaciones con snapshot…) ni
    // siquiera está declarado, así que no puede filtrarse por accidente.
    const posComputar = codigoEval.indexOf("export type ResultadoComputarDisponibilidad =");
    const declComputar = codigoEval.slice(posComputar, codigoEval.indexOf("| { ok: false", posComputar));
    assert.match(declComputar, /precioVenta: number; moneda: string; paxTotal: number/);
  });

  test("un fallo del descubrimiento o de las reglas de ocupación ahora es un error TÉCNICO explícito (ok:false) — fallo estructural corregido: antes se disfrazaba de 'cero hoteles' (ver la cabecera del archivo)", () => {
    assert.match(codigoAction, /if \(!descubrimiento\.ok\) \{/);
    assert.match(codigoAction, /return \{ ok: false, error: "No se pudo consultar la disponibilidad de alojamientos por unidad\." \};/);
    assert.match(codigoAction, /if \(eAcom \|\| eHoteles\) \{/);
    assert.match(codigoAction, /return \{ ok: false, error: "No se pudieron consultar las reglas de ocupación de los hoteles\." \};/);
    // Solo el caso LEGÍTIMO (no hay ningún hotel unidad en este destino, sin
    // ningún error) sigue devolviendo una lista vacía — nunca un error.
    assert.match(codigoAction, /if \(!ofertasPorHotel\.size\) return \{ ok: true, disponibilidad: \[\], incompleto: false \};/);
  });

  test("un hotel sin fila maestra o Adults Only con menores declarados nunca se anuncia como disponible (cobertura real de ambos casos en evaluarDisponibilidadUnidad.test.ts)", () => {
    assert.match(cuerpoEvaluarHotel, /if \(!fila\) return \{ tipo: "inconcluyente", hotelId, motivo: "hotel_sin_fila_maestra" \};/);
    assert.match(cuerpoEvaluarHotel, /if \(edadesMenores\.length > 0 && fila\.adults_only\) \{/);
    assert.match(cuerpoEvaluarHotel, /return \{ tipo: "veredicto", valor: \{ hotelId, estado: "sin_disponibilidad" \} \};/);
  });

  test("un hotel inconcluyente marca la búsqueda como INCOMPLETA y registra el motivo real — nunca desaparece en silencio (el defecto original)", () => {
    assert.match(codigoAction, /incompleto = true;/);
    assert.match(codigoAction, /console\.error\(`\[buscarAlojamientosUnidadPorFechas\] etapa=evaluacion hotelId=\$\{v\.hotelId\} motivo=\$\{v\.motivo\}`\);/);
    assert.match(codigoAction, /return \{ ok: true, disponibilidad, incompleto \};/);
  });

  test("no escribe nada (solo lectura): ninguna mutación en la acción", () => {
    assert.doesNotMatch(codigoAction, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
  });
});

// ── El descubrimiento, ahora acotado por destino ──────────────────────────

describe("datosBernalo.ts — descubrimiento acotado por destino (base de datos, no JavaScript)", () => {
  test("acepta un destino opcional (nombre y/o id) sin cambiar el comportamiento por defecto (page.tsx sigue llamando sin argumentos)", () => {
    assert.match(codigoDatos, /export type OpcionesDescubrimientoBernalo = \{ destino\?: string \| null; destinoId\?: number \| null \};/);
    assert.match(codigoDatos, /export async function cargarHotelesBernaloDescubiertos\(\s*\n\s*opciones\?: OpcionesDescubrimientoBernalo\s*\n\)/);
    const fuentePagina = sinComentarios(readFileSync(join(raiz, "app/tarifario/page.tsx"), "utf8"));
    assert.match(fuentePagina, /cargarHotelesBernaloDescubiertos\(\)/, "la vitrina completa sigue llamando sin opciones");
    assert.doesNotMatch(fuentePagina, /cargarHotelesBernaloDescubiertos\(\{/);
  });

  test("destinoId es la vía PREFERIDA: cuando llega, NO se consulta `destinos` por nombre — se usa directo, sin ambigüedad de texto (cierre del hallazgo de identidad de destino)", () => {
    assert.match(codigoDatos, /const destinoIdPedido = opciones\?\.destinoId \?\? null;/);
    assert.match(codigoDatos, /if \(destinoIdPedido != null\) \{\s*\n\s*idsDestino = \[destinoIdPedido\];/);
    // El camino por nombre queda como respaldo — un `else if`, nunca se
    // combinan ni se intersectan.
    assert.match(codigoDatos, /\} else if \(destinoPedido\) \{/);
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

// ── E) TARJETA UNIDAD EN MODO BÚSQUEDA: inline, sin modal, sin repetir nada ─
//
// Cierre de UX (ronda posterior a "Hotel Prueba Odair no aparece"): el hotel
// unidad ya aparecía en la lista cerrada del destino, pero su tarjeta solo
// mostraba "Disponible para tus fechas" + "Ver opciones" — abrir el modal
// obligaba a repetir fechas/ocupación que el buscador general YA tenía. Un
// hotel persona muestra categoría/alimentación/pax/precio/"Agregar al
// carrito" directo; ahora un hotel unidad hace lo mismo — la diferencia
// tarifaria interna no lo convierte en otro tipo de producto visual.
describe("TarjetaUnidadBusqueda — selectores + precio + agregar al carrito INLINE, sin modal (cierre de UX)", () => {
  const cuerpoTarjetaUnidad = cuerpoFuncion(fuenteVista, "function TarjetaUnidadBusqueda({");

  test("HotelUnidadCard.opcionesBusqueda es el gate: presente → tarjeta inline; ausente (exploración) → sigue abriendo el modal de siempre", () => {
    assert.match(codigoVista, /opcionesBusqueda\?: OpcionUnidadConfirmada\[\];/);
    // El único punto que arma tarjetas de búsqueda SIEMPRE lo asigna (no es
    // opcional en ese camino) — viene DIRECTO de `busquedaPorcion.unidad` (ya
    // filtrado a `estado === "disponible"` en `BuscadorBooking`), repartido por
    // oferta hotel+paquete: `g.opciones` son SOLO las opciones de ESE paquete.
    assert.match(codigoVista, /opcionesBusqueda: g\.opciones,/);
    // El render de la grilla ramifica por esa misma propiedad — nunca por
    // `enBusquedaPorcion` a secas (una tarjeta de exploración no debe activar
    // la rama inline solo porque hay una búsqueda vigente en otro hotel).
    assert.match(codigoVista, /t\.hotel\.opcionesBusqueda \? \(/);
    assert.match(codigoVista, /<TarjetaUnidadBusqueda/);
  });

  test("la rama de exploración (sin opcionesBusqueda) sigue abriendo el modal — `onClick={() => setModalBernalo(t.hotel)}` intacto", () => {
    assert.match(codigoVista, /onClick=\{\(\) => setModalBernalo\(t\.hotel\)\}/);
    // Y la tarjeta inline nunca llama `setModalBernalo` — no abre nada.
    assert.doesNotMatch(cuerpoTarjetaUnidad, /setModalBernalo/);
  });

  test("preselecciona la opción por defecto (opciones[0], ya ordenada por precio ascendente) — categoría y alimentación nacen de ahí, nunca vacías", () => {
    assert.match(cuerpoTarjetaUnidad, /const \[cat, setCat\] = useState\(opciones\[0\]\?\.categoria \?\? ""\);/);
    assert.match(cuerpoTarjetaUnidad, /const \[alim, setAlim\] = useState\(opciones\[0\]\?\.alimentacion \?\? ""\);/);
  });

  test("los selectores muestran ÚNICAMENTE combinaciones confirmadas (derivadas de `opciones`, nunca un catálogo aparte ni el cartesiano completo)", () => {
    assert.match(cuerpoTarjetaUnidad, /const categorias = useMemo\(\(\) => \[\.\.\.new Set\(opciones\.map\(\(o\) => o\.categoria\)\)\], \[opciones\]\);/);
    assert.match(cuerpoTarjetaUnidad, /const alimentaciones = useMemo\(\s*\n\s*\(\) => \[\.\.\.new Set\(opciones\.filter\(\(o\) => o\.categoria === catEff\)\.map\(\(o\) => o\.alimentacion\)\)\],\s*\n\s*\[opciones, catEff\]\s*\n\s*\);/);
  });

  test("cambiar categoría limita las alimentaciones a las válidas para esa categoría — y si la alimentación elegida deja de ser válida, cae automáticamente a la primera que sí lo sea", () => {
    assert.match(cuerpoTarjetaUnidad, /const alimEff = alimentaciones\.includes\(alim\) \? alim : \(alimentaciones\[0\] \?\? ""\);/);
    // Ninguna otra variable decide la alimentación efectiva — un solo punto.
    assert.equal([...cuerpoTarjetaUnidad.matchAll(/const alimEff =/g)].length, 1);
  });

  test("el precio/pax se leen de `opciones` (ya calculadas por el buscador) — cambiar de selector NUNCA dispara una consulta nueva", () => {
    assert.match(cuerpoTarjetaUnidad, /const opcionSel = opciones\.find\(\(o\) => o\.categoria === catEff && o\.alimentacion === alimEff\) \?\? opciones\[0\];/);
    assert.doesNotMatch(cuerpoTarjetaUnidad, /buscarAlojamientosUnidadPorFechas/, "cambiar de selector no debe volver a buscar");
    // El ÚNICO useEffect de la tarjeta es el cleanup de `montadoRef` (deps
    // vacías, solo marca desmontaje — no toca datos ni reacciona a selectores).
    // Nunca hay un efecto que sincronice cat/alim/precio ni que dispare red.
    const efectos = [...cuerpoTarjetaUnidad.matchAll(/useEffect\(/g)].length;
    assert.equal(efectos, 1, "el único useEffect permitido es el cleanup de montadoRef");
    assert.match(cuerpoTarjetaUnidad, /useEffect\(\(\) => \(\) => \{ montadoRef\.current = false; \}, \[\]\);/);
    assert.doesNotMatch(cuerpoTarjetaUnidad, /useEffect\([^)]*setCat|useEffect\([^)]*setAlim|useEffect\([^)]*setPrecioActualizado/);
  });

  test('"TOTAL X PAX" + moneda + precio, mismo estilo visual que la tarjeta persona (Resultado)', () => {
    assert.match(cuerpoTarjetaUnidad, /total \{opcionSel\.paxTotal\} pax/);
    assert.match(cuerpoTarjetaUnidad, /formatMoneda\(precioMostrado, monedaMostrada\)/);
    // Mismas clases que ya usa `Resultado` (persona) para el bloque de precio.
    assert.match(cuerpoTarjetaUnidad, /text-\[10px\] uppercase tracking-wide text-gray-400/);
    assert.match(cuerpoTarjetaUnidad, /text-lg font-bold/);
  });

  test('botón "Agregar al carrito" con el MISMO texto/estilo que la tarjeta persona, sin abrir ninguna pantalla intermedia', () => {
    assert.match(cuerpoTarjetaUnidad, /"Agregar al carrito"/);
    assert.match(cuerpoTarjetaUnidad, /En el carrito · quitar/);
    // Nunca abre un modal/pantalla intermedia — ni siquiera al hacer clic.
    assert.doesNotMatch(cuerpoTarjetaUnidad, /HotelBernaloCotizarModal|EditorPax/);
  });

  test("no pide de nuevo fechas, habitaciones, adultos ni menores — ningún campo de CAPTURA de esos existe en esta tarjeta (solo se LEEN de `opcionSel`, que ya trae la búsqueda original)", () => {
    // `<input` es el único chequeo genuinamente estructural acá: si la
    // tarjeta tuviera un campo de captura de verdad, sería un `<input>`. Los
    // demás términos (fIda/cantidadMenores/etc.) aparecen LEGÍTIMAMENTE como
    // identificadores de lectura (`opcionSel.fechaIda`, `h.edadesMenores.length`
    // al armar el payload de revalidación) — comprobar su AUSENCIA sería un
    // falso positivo, no una garantía real de "no se pide de nuevo".
    assert.doesNotMatch(cuerpoTarjetaUnidad, /<input/);
    // Tampoco hay ningún estado propio de captura (useState de fecha/adultos/
    // cantidad de menores) — solo selectores derivados de `opciones` y el
    // estado de la revalidación/carrito.
    assert.doesNotMatch(cuerpoTarjetaUnidad, /useState\(hoy\)|setFIda|setFReg|setCantidadMenoresState|setAdultos/);
  });
});

// ── E-bis) AGREGAR AL CARRITO: revalidación server-side obligatoria ────────
// La lógica de revalidación (try/catch, interpretación del resultado, precio
// cambiado) se extrajo a `revalidarReservaUnidad` (`lib/tarifario/
// identidadReservaUnidad.ts`) y se prueba con EJECUCIÓN REAL en
// `pruebas/identidadReservaUnidad.test.ts` (incluye el caso "promesa
// rechazada no agrega y libera el estado de carga"). Acá solo se verifica el
// CABLEADO: que el componente delega en ese helper, no agrega en rechazo/
// error, usa el precio revalidado, y envuelve todo en try/finally con guarda
// de montaje.
describe('TarjetaUnidadBusqueda — "Agregar al carrito" revalida en servidor (nunca usa el precio del navegador como autoridad)', () => {
  const cuerpoTarjetaUnidad = cuerpoFuncion(fuenteVista, "function TarjetaUnidadBusqueda({");
  const cuerpoAgregar = cuerpoFuncion(cuerpoTarjetaUnidad, "async function agregar() {");

  test("delega la revalidación en `revalidarReservaUnidad`, inyectándole la Server Action pública EXISTENTE (cotizarAlojamientoBernaloPublico) — nunca una acción nueva", () => {
    assert.match(cuerpoAgregar, /await revalidarReservaUnidad\(\s*\n?\s*cotizarAlojamientoBernaloPublico,/);
    assert.match(fuenteVista, /import \{ claveBusquedaUnidad, claveReservaUnidad, revalidarReservaUnidad \} from "@\/lib\/tarifario\/identidadReservaUnidad";/);
    // La Server Action sigue reutilizándose (nunca una copia paralela): vive
    // acá al menos dos veces (modal de exploración + esta tarjeta).
    const usos = [...codigoVista.matchAll(/cotizarAlojamientoBernaloPublico/g)];
    assert.ok(usos.length >= 2, "debe reutilizarse la misma Server Action que ya usa el modal, no una nueva");
  });

  test("manda la ocupación/fechas de la combinación SELECCIONADA (de la búsqueda original) — nunca placeholders ni datos del formulario del modal", () => {
    assert.match(cuerpoAgregar, /paqueteId: opcionSel\.paqueteId, hotelId: opcionSel\.hotelId,/);
    assert.match(cuerpoAgregar, /categoria: opcionSel\.categoria, alimentacion: opcionSel\.alimentacion,/);
    assert.match(cuerpoAgregar, /salida, habitaciones,/);
    // Las fechas de la búsqueda entran por la `salida` sin_vuelo construida
    // desde `opcionSel`.
    assert.match(cuerpoAgregar, /fechaIda: opcionSel\.fechaIda, fechaRegreso: opcionSel\.fechaRegreso/);
  });

  test("agrega al carrito SOLO en estado 'agregar' — un rechazo/error nunca agrega, y muestra el mensaje REAL/entendible", () => {
    assert.match(cuerpoAgregar, /if \(rev\.estado !== "agregar"\) \{/);
    assert.match(cuerpoAgregar, /setErrorAgregar\(rev\.mensaje\);/);
    const idxRechazo = cuerpoAgregar.indexOf('if (rev.estado !== "agregar") {');
    const idxAdd = cuerpoAgregar.indexOf("add({");
    assert.ok(idxRechazo > -1 && idxAdd > idxRechazo, "el chequeo de no-agregar debe ir ANTES de agregar al carrito");
  });

  test("el precio que se agrega al carrito es SIEMPRE el revalidado (rev.precio/rev.moneda) — nunca opcionSel.precioVenta (el que mostró la tarjeta antes de revalidar)", () => {
    assert.match(cuerpoAgregar, /precio: rev\.precio,/);
    assert.match(cuerpoAgregar, /moneda: rev\.moneda,/);
    assert.doesNotMatch(cuerpoAgregar, /precio: opcionSel\.precioVenta/, "nunca debe agregar con el precio mostrado sin revalidar");
  });

  test("si la tarifa cambió entre la búsqueda y el clic (rev.precioCambio), la tarjeta se actualiza — nunca queda mostrando el precio viejo", () => {
    assert.match(cuerpoAgregar, /if \(rev\.precioCambio\) \{/);
    assert.match(cuerpoAgregar, /setPrecioActualizado\(\{ combo: claveCombo, precio: rev\.precio, moneda: rev\.moneda \}\);/);
    assert.match(cuerpoTarjetaUnidad, /const precioMostrado = precioActualizado\?\.combo === claveCombo \? precioActualizado\.precio : opcionSel\.precioVenta;/);
  });

  test("try/finally + guarda de montaje: `agregando` SIEMPRE se libera en el finally (aun ante excepción), y ningún setState corre tras un remonte", () => {
    assert.match(cuerpoTarjetaUnidad, /const \[agregando, setAgregando\] = useState\(false\);/);
    assert.match(cuerpoAgregar, /setAgregando\(true\);/);
    // La liberación vive en un finally (no en el camino feliz) y guardada por
    // el montaje — nunca un setAgregando(false) suelto en medio del flujo.
    assert.match(cuerpoAgregar, /\} finally \{\s*\n?\s*if \(montadoRef\.current\) setAgregando\(false\);\s*\n?\s*\}/);
    assert.match(cuerpoAgregar, /if \(!montadoRef\.current\) return;/);
    assert.match(cuerpoTarjetaUnidad, /const montadoRef = useRef\(true\);/);
    assert.match(cuerpoTarjetaUnidad, /useEffect\(\(\) => \(\) => \{ montadoRef\.current = false; \}, \[\]\);/);
    assert.match(cuerpoTarjetaUnidad, /disabled=\{agregando\}/);
    assert.match(cuerpoTarjetaUnidad, /\{agregando \? "Confirmando…" : /);
    // Nunca doble envío mientras revalida.
    assert.match(cuerpoAgregar, /if \(agregando\) return;/);
  });
});

// ── E-ter) IDENTIDAD: key de búsqueda y comparación de carrito ─────────────
describe("TarjetaUnidadBusqueda — identidad de búsqueda (key) e identidad de carrito (enCarrito)", () => {
  const cuerpoTarjetaUnidad = cuerpoFuncion(fuenteVista, "function TarjetaUnidadBusqueda({");

  test("la key de React de una tarjeta de búsqueda incluye la OFERTA (hotelId+paqueteId) y la identidad de la BÚSQUEDA vigente (claveBusquedaUnidad) — una nueva búsqueda del mismo hotel remonta y resetea el estado, y el mismo hotel en dos paquetes nunca colisiona", () => {
    assert.match(codigoVista, /key: `u-\$\{g\.hotelId\}-\$\{g\.paqueteId\}-\$\{claveBusquedaUnidad\(g\.opciones\)\}`,/);
    // No queda un `useEffect` frágil sincronizando cat/alim/precioActualizado
    // con la búsqueda — el remonte por key es el ÚNICO mecanismo de reset.
    assert.doesNotMatch(cuerpoTarjetaUnidad, /useEffect\([^)]*setCat|useEffect\([^)]*setAlim|useEffect\([^)]*setPrecioActualizado/);
  });

  test("enCarrito compara la identidad CANÓNICA COMPLETA (claveReservaUnidad), no solo hotel+paquete+categoría+alimentación", () => {
    assert.match(cuerpoTarjetaUnidad, /const claveReserva = claveReservaUnidad\(\{/);
    // El candidato y cada ítem del carrito se reducen a la MISMA clave
    // canónica — la comparación es por clave, nunca campo a campo parcial.
    assert.match(cuerpoTarjetaUnidad, /claveReservaUnidad\(\{\s*\n?\s*hotelId: i\.hotelId,/);
    assert.match(cuerpoTarjetaUnidad, /\}\) === claveReserva/);
    assert.match(cuerpoTarjetaUnidad, /i\.modeloTarifario === "unidad"/);
    // La clave incluye salida y habitaciones (fechas + ocupación) — no solo
    // los cuatro campos escalares de antes.
    assert.match(cuerpoTarjetaUnidad, /salida: i\.salida,/);
    assert.match(cuerpoTarjetaUnidad, /habitaciones: i\.habitaciones,/);
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
    assert.match(codigoBuscador, /setDestino\(nombre\);\s*\n\s*setDestinoId\(opcion\?\.id \?\? null\);\s*\n\s*limpiarResultados\(\);/);
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

// ── Aviso "unidad incompleta" — persona nunca se oculta por un fallo unidad ─
//
// Cierre del hallazgo "Hotel Prueba Odair no aparece": antes un fallo o
// excepción en `buscarAlojamientosUnidadPorFechas` se volvía silenciosamente
// un arreglo `unidad: []` — indistinguible de "este destino no tiene hoteles
// por unidad". `EstadoBusquedaPorcion.avisoUnidad` lo hace explícito sin
// bloquear nunca la publicación de los resultados persona.
describe("Aviso de búsqueda unidad incompleta — persona se muestra igual, nunca se oculta por un fallo de la otra mitad", () => {
  test("EstadoBusquedaPorcion lleva avisoUnidad, y el envío hacia VistaBooking siempre lo incluye (nunca queda undefined)", () => {
    const tipo = cuerpoFuncion(codigoBuscador, "export type EstadoBusquedaPorcion = {");
    assert.match(tipo, /avisoUnidad: string \| null;/);
    const envio = cuerpoBuscar.slice(cuerpoBuscar.indexOf("onBusqueda?.({"), cuerpoBuscar.indexOf("});", cuerpoBuscar.indexOf("onBusqueda?.({")));
    assert.match(envio, /avisoUnidad,/);
  });

  test("VistaBooking pinta el aviso SOLO en modo búsqueda y solo cuando existe — nunca reemplaza ni oculta la grilla de resultados", () => {
    assert.match(codigoVista, /\{enBusquedaPorcion && busquedaPorcion\?\.avisoUnidad && \(/);
    const pos = codigoVista.indexOf("enBusquedaPorcion && busquedaPorcion?.avisoUnidad && (");
    const posBuscador = codigoVista.indexOf("<BuscadorBooking ");
    const posGrilla = codigoVista.indexOf("{tarjetas.map((t) =>");
    assert.ok(posBuscador > -1 && pos > posBuscador, "el aviso debe ir DESPUÉS del buscador");
    assert.ok(posGrilla > pos, "el aviso debe ir ANTES de la grilla — nunca la reemplaza, solo la antecede");
  });

  test("un ok:false o una excepción de la Server Action de unidad SIEMPRE producen un avisoUnidad no nulo — nunca undefined/silencioso", () => {
    const posElse = cuerpoBuscar.indexOf("} else {", cuerpoBuscar.indexOf("if (unidadRes.ok) {"));
    const bloqueElse = cuerpoBuscar.slice(posElse, cuerpoBuscar.indexOf("}", cuerpoBuscar.indexOf("avisoUnidad =", posElse)) + 1);
    assert.match(bloqueElse, /console\.error\(/, "el error real debe quedar en los logs, no solo en el aviso genérico al usuario");
    assert.match(bloqueElse, /avisoUnidad = "/);
  });
});
