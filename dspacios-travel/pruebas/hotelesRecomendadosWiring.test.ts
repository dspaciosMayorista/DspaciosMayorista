import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Hoteles recomendados por paquete (migración 183) — verificación por
// inspección de fuente de los puntos que no son testeables como función pura
// (React/Server Actions/Supabase, sin testing-library en este repo). El
// cálculo de SELECCIÓN/ORDEN en sí (qué ofertas entran, en qué orden) está
// cubierto con ejecución real en pruebas/recomendados.test.ts (funciones
// puras) — este archivo solo confirma que esas funciones están CABLEADAS en
// los puntos correctos, y que las garantías estructurales (identidad
// compuesta, no re-ordenar en React, admin server-side) siguen presentes.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const vistaBooking = leer("app/tarifario/VistaBooking.tsx");
const buscadorBooking = leer("app/tarifario/BuscadorBooking.tsx");
const recomendadosFuente = leer("lib/tarifario/recomendados.ts");
const tarifarioPublic = leer("app/tarifario/TarifarioPublic.tsx");
const tarifarioPage = leer("app/tarifario/page.tsx");
const resumen = leer("lib/tarifario/resumen.ts");
const paquetesActions = leer("app/(dashboard)/dashboard/paquetes/actions.ts");
const armadoClient = leer("app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx");
const paqueteIdPage = leer("app/(dashboard)/dashboard/paquetes/[id]/page.tsx");
const typesDb = leer("types/database.ts");
const migracion183 = leer("supabase/migrations/20260601000183_armado_hoteles_prioridad.sql");

describe("Persistencia — migración 183 + types/database.ts", () => {
  test("la migración agrega prioridad smallint, CHECK 1-6 y unicidad parcial por paquete", () => {
    assert.match(migracion183, /add column if not exists prioridad smallint/);
    assert.match(migracion183, /prioridad is null or \(prioridad between 1 and 6\)/);
    assert.match(migracion183, /create unique index if not exists armado_hoteles_paquete_prioridad_unica/);
    assert.match(migracion183, /on public\.armado_hoteles \(paquete_id, prioridad\)/);
    assert.match(migracion183, /where prioridad is not null/);
  });

  test("types/database.ts declara prioridad en Row e Insert de armado_hoteles", () => {
    const inicio = typesDb.indexOf("armado_hoteles: {");
    const fin = typesDb.indexOf("armado_servicios: {", inicio);
    const bloque = typesDb.slice(inicio, fin);
    assert.match(bloque, /prioridad: number \| null/, "falta prioridad en Row");
    assert.match(bloque, /prioridad\?: number \| null/, "falta prioridad opcional en Insert");
  });
});

describe("Admin — setHotelPrioridad (server-side, no toca el registro global del hotel)", () => {
  test("existe setHotelPrioridad, opera sobre armado_hoteles scoped por paquete_id+hotel_id (update, no upsert)", () => {
    const inicio = paquetesActions.indexOf("export async function setHotelPrioridad(");
    assert.ok(inicio >= 0, "no se encontró setHotelPrioridad");
    const siguiente = paquetesActions.indexOf("\nexport async function ", inicio + 1);
    const cuerpo = paquetesActions.slice(inicio, siguiente);
    assert.match(cuerpo, /\.from\("armado_hoteles"\)/);
    assert.match(cuerpo, /\.update\(\{\s*prioridad\s*\}\)/);
    assert.match(cuerpo, /\.eq\("paquete_id", paqueteId\)/);
    assert.match(cuerpo, /\.eq\("hotel_id", hotelId\)/);
    assert.doesNotMatch(cuerpo, /\.from\("hoteles"\)/, "no debe tocar la tabla global de hoteles");
  });

  test("traduce el error de duplicado (23505) y de rango (23514) a mensajes comprensibles", () => {
    const inicio = paquetesActions.indexOf("export async function setHotelPrioridad(");
    const siguiente = paquetesActions.indexOf("\nexport async function ", inicio + 1);
    const cuerpo = paquetesActions.slice(inicio, siguiente);
    assert.match(cuerpo, /error\.code === "23505"/);
    assert.match(cuerpo, /error\.code === "23514"/);
  });

  test("revalida el editor y el tarifario público DESPUÉS del error, sin regenerar ni tocar el snapshot (migración 184)", () => {
    const inicio = paquetesActions.indexOf("export async function setHotelPrioridad(");
    const siguiente = paquetesActions.indexOf("\nexport async function ", inicio + 1);
    const cuerpo = paquetesActions.slice(inicio, siguiente);

    // Ambas superficies que muestran la recomendación se revalidan.
    assert.match(cuerpo, /revalidatePath\(`\/dashboard\/paquetes\/\$\{paqueteId\}`\);/);
    assert.match(cuerpo, /revalidatePath\("\/tarifario"\);/);

    // Y las dos van después del retorno del error genérico: ningún camino de
    // fallo (23505 / 23514 / genérico) revalida.
    const posFallo = cuerpo.lastIndexOf("return { ok: false, error: error.message };");
    assert.ok(posFallo > -1, "no se encontró el return del error genérico");
    assert.ok(cuerpo.indexOf("revalidatePath(`/dashboard/paquetes/${paqueteId}`);") > posFallo);
    assert.ok(cuerpo.indexOf('revalidatePath("/tarifario");') > posFallo);

    // La prioridad es metadata de presentación: no se regenera el tarifario,
    // no se publica y no se toca el estado del snapshot.
    assert.doesNotMatch(cuerpo, /generarTarifario|regenerarTarifario|publicarTarifario|publicar_tarifario/);
    assert.doesNotMatch(cuerpo, /tarifario_revision_fuente|tarifario_estado|tarifario_snapshot_publicable/);
  });

  test("ArmadoClient.tsx: el selector de prioridad llama setHotelPrioridad y muestra las prioridades ocupadas por OTROS hoteles del paquete", () => {
    assert.match(armadoClient, /import\s*\{[^}]*setHotelPrioridad[^}]*\}\s*from\s*"\.\.\/actions"/);
    assert.match(armadoClient, /cambiarPrioridad\(/);
    assert.match(armadoClient, /ocupadasPorOtros/);
    assert.match(armadoClient, /disabled=\{ocupadasPorOtros\.has\(p\)\}/);
  });

  test("page.tsx del paquete lee prioridad al cargar la selección de hoteles", () => {
    assert.match(paqueteIdPage, /\.from\("armado_hoteles"\)\.select\("hotel_id, categorias, regimenes, prioridad"\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Defecto 4 (P2): elegir prioridad tardaba varios segundos porque el
// autosave guardaba y después hacía `router.refresh()` (re-render de todo el
// editor). Se conserva el autosave, ahora OPTIMISTA.
// ─────────────────────────────────────────────────────────────────────────
describe("Autosave optimista de prioridad (defecto 4)", () => {
  const cuerpoCambiar = (() => {
    const inicio = armadoClient.indexOf("async function cambiarPrioridad(");
    assert.ok(inicio >= 0, "no se encontró cambiarPrioridad");
    const fin = armadoClient.indexOf("\n  }", inicio);
    assert.ok(fin > inicio);
    return armadoClient.slice(inicio, fin);
  })();

  test("aplica el valor local ANTES de esperar la respuesta, y pide el guardado con el valor elegido", () => {
    const idxOptimista = cuerpoCambiar.indexOf("onPrioridadLocal(hotel.id, elegida)");
    const idxAwait = cuerpoCambiar.indexOf("await setHotelPrioridad(");
    assert.ok(idxOptimista > -1 && idxAwait > -1);
    assert.ok(idxOptimista < idxAwait, "el estado optimista debe aplicarse ANTES del await (es lo que hace instantáneo el selector)");
    assert.match(cuerpoCambiar, /r = await setHotelPrioridad\(paqueteId, hotel\.id, elegida\);/);
  });

  test("un guardado EXITOSO no recarga el editor: onDone/router.refresh aparecen SOLO en la rama de fallo", () => {
    // El camino exitoso no puede recargar nada (era el defecto: `router.refresh()`
    // re-renderizaba todo el editor). `onDone()` sí se usa, pero únicamente en el
    // fallo, para recuperar el dato autoritativo.
    const idxFallo = cuerpoCambiar.indexOf("if (!r.ok) {");
    assert.ok(idxFallo > 0, "falta la rama de fallo");
    const caminoExitoso = cuerpoCambiar.slice(0, idxFallo);
    assert.doesNotMatch(caminoExitoso, /onDone\(/, "el éxito no debe llamar onDone");
    assert.doesNotMatch(caminoExitoso, /refrescar\(\)|router\.refresh\(\)/);
    assert.match(cuerpoCambiar.slice(idxFallo), /onDone\(\);/);
  });

  test("si falla, ELIMINA el override y recupera el dato autoritativo (nunca deja un valor local de reversión)", () => {
    assert.match(cuerpoCambiar, /if \(!r\.ok\) \{/);
    assert.match(cuerpoCambiar, /setErrPrioridad\(r\.error/);
    // Se elimina el override (no se "revierte" a un valor local: un override
    // con el valor viejo nunca se reconocería y taparía el dato fresco).
    assert.match(cuerpoCambiar, /onPrioridadDescartar\(hotel\.id\)/, "el fallo debe ELIMINAR el override del hotel");
    assert.doesNotMatch(cuerpoCambiar, /onPrioridadLocal\(hotel\.id, previa\)/, "no puede dejar un override 'de reversión'");
    assert.doesNotMatch(cuerpoCambiar, /const previa = prioridad;/);
    // Y después pide la fuente autoritativa.
    const idxFallo = cuerpoCambiar.indexOf("if (!r.ok) {");
    const bloqueFallo = cuerpoCambiar.slice(idxFallo);
    assert.match(bloqueFallo, /onDone\(\);/, "tras el fallo hay que recuperar el dato del servidor");
  });

  test("el descarte del override es una función pura del módulo (sin mutar el Map)", () => {
    const fuente = leer("lib/tarifario/prioridadOptimista.ts");
    assert.match(fuente, /export function sinPrioridadOptimista\(/);
    assert.match(fuente, /const siguiente = new Map\(previos\);\s*\n\s*siguiente\.delete\(hotelId\);/);
    assert.match(armadoClient, /setPrioridadesOptimistas\(\(prev\) => sinPrioridadOptimista\(prev, hotelId\)\)/);
  });

  test("evita envíos concurrentes de la MISMA fila mientras hay una petición en vuelo", () => {
    assert.match(cuerpoCambiar, /if \(guardandoPrioridad\) return;/);
    assert.match(cuerpoCambiar, /setGuardandoPrioridad\(true\);/);
    assert.match(cuerpoCambiar, /setGuardandoPrioridad\(false\);/);
    // Y el control queda deshabilitado mientras tanto (feedback real de "en curso").
    assert.match(armadoClient, /disabled=\{guardandoPrioridad\}/);
  });

  test("el selector refleja el valor EFECTIVO (optimista o del servidor) y sigue sin botón Guardar", () => {
    assert.match(armadoClient, /value=\{prioridad \?\? ""\}/, "el select no puede leer `sel.prioridad` directo: tiene que ver el valor optimista");
    assert.doesNotMatch(armadoClient, /Guardar prioridad|Guardar recomendad/i, "el autosave no lleva botón Guardar");
  });

  test("el valor optimista vive en el padre y alimenta las prioridades ocupadas (sin esperar refresh)", () => {
    assert.match(armadoClient, /const \[prioridadesOptimistas, setPrioridadesOptimistas\] = useState<Map<number, number \| null>>\(new Map\(\)\);/);
    assert.match(armadoClient, /const prioridadEfectiva = \(hotelId: number\): number \| null =>\s*\n\s*prioridadEfectivaDe\(/);
    assert.match(armadoClient, /prioridad=\{prioridadEfectiva\(h\.id\)\}/);
    assert.match(armadoClient, /onPrioridadLocal=\{setPrioridadOptimista\}/);
    // `prioridadesOcupadas` se arma con los valores EFECTIVOS: por eso elegir una
    // prioridad la marca ocupada de inmediato en los demás hoteles.
    assert.match(armadoClient, /const prioridadesOcupadas = prioridadesOcupadasDe\(prioridadesOptimistas, filasServidorPrioridad\);/);
  });

  test("la reconciliación es PURA y se cablea sin efectos: descarta overrides reconocidos y filas desaparecidas", () => {
    // La lógica vive en el módulo puro (probado con ejecución real en
    // pruebas/prioridadOptimista.test.ts) — el componente solo la aplica.
    assert.match(armadoClient, /import\s*\{[\s\S]*reconciliarPrioridades[\s\S]*\}\s*from\s*"@\/lib\/tarifario\/prioridadOptimista";/);
    assert.match(armadoClient, /const filasServidorPrioridad = useMemo\(/);
    // Reconciliación en RENDER (patrón oficial de React): comparar la
    // generación derivada de las props y ajustar el estado ahí mismo.
    assert.match(armadoClient, /const \[generacionPrioridad, setGeneracionPrioridad\] = useState\(filasServidorPrioridad\);/);
    assert.match(armadoClient, /if \(generacionPrioridad !== filasServidorPrioridad\) \{/);
    assert.match(armadoClient, /setPrioridadesOptimistas\(\(prev\) => reconciliarPrioridades\(prev, filasServidorPrioridad\)\);/);
    // Y NADA de `useEffect` para reconciliar: la regla
    // `react-hooks/set-state-in-effect` lo prohíbe (verificado con ESLint).
    assert.doesNotMatch(armadoClient, /useEffect\(\(\) => \{\s*\n\s*setPrioridadesOptimistas/, "la reconciliación no puede ir en un efecto");
  });

  test("las DEMÁS operaciones del editor siguen refrescando igual que antes", () => {
    // El checkbox de asociar/desasociar sigue llamando `onDone()` (recarga),
    // que es el comportamiento que NO se cambia.
    const idxCheckbox = armadoClient.indexOf("await setHotel(paqueteId, hotel.id, e.target.checked);");
    assert.ok(idxCheckbox > -1);
    assert.match(armadoClient.slice(idxCheckbox, idxCheckbox + 120), /onDone\(\);/);
    // Y `refrescar` (el `router.refresh` del editor) sigue existiendo y usado.
    assert.match(armadoClient, /function refrescar\(\) \{\s*\n\s*router\.refresh\(\);/);
    assert.match(armadoClient, /onDone=\{refrescar\}/);
  });
});

describe("Prioridad por bloques de paquete — el motor no compara prioridades entre paquetes", () => {
  test("el motor NO ordena globalmente por prioridad: `ordenarGlobalmente` ya no existe", () => {
    assert.doesNotMatch(recomendadosFuente, /ordenarGlobalmente/, "la prioridad es un namespace por paquete: no puede haber un orden global por prioridad");
    // Tampoco queda ningún comparador que mezcle `prioridad` con `paqueteId`
    // (el desempate cruzado que producía A1, B1, A2, B2).
    assert.doesNotMatch(recomendadosFuente, /a\.prioridad - b\.prioridad \|\| a\.paqueteId/);
    // El único comparador por prioridad es DENTRO del paquete, con desempate
    // por hotelId.
    assert.match(recomendadosFuente, /arr\.sort\(\(a, b\) => a\.prioridad - b\.prioridad \|\| a\.hotelId - b\.hotelId\);/);
  });

  test("los comentarios del motor ya no afirman que la prioridad sea global", () => {
    assert.doesNotMatch(recomendadosFuente, /nunca queda antes que B\/prioridad/i);
    assert.doesNotMatch(recomendadosFuente, /ORDEN VISIBLE es global/i);
    assert.match(recomendadosFuente, /namespace INDEPENDIENTE POR PAQUETE/);
  });

  test("la selección inicial acepta SOLO las posiciones literales 1 y 2 (nunca `slice(0, 2)`)", () => {
    const inicio = recomendadosFuente.indexOf("export function seleccionarRecomendadosGlobalInicial");
    const fin = recomendadosFuente.indexOf("\n}", inicio);
    const cuerpo = recomendadosFuente.slice(inicio, fin);
    assert.match(cuerpo, /filter\(\(o\) => o\.prioridad === 1 \|\| o\.prioridad === 2\)/, "la selección es por VALOR literal, no por posición en un arreglo ordenado");
    assert.doesNotMatch(cuerpo, /slice\(0, 2\)/, "un slice dejaría que una prioridad 3 o 4 ocupara el lugar de la 1/2");
    assert.doesNotMatch(cuerpo, /\.sort\(/, "el orden ya lo da el bloque por paquete, no un sort");
  });
});

describe("Lectura — identidad compuesta hotelId+paqueteId, nunca solo hotelId, para la sección de recomendados", () => {
  test("lib/tarifario/resumen.ts construye prioridadesRecomendados con claveOferta(hotel_id, paquete_id), scoped a paqIdsConHotel", () => {
    assert.match(resumen, /import\s*\{\s*claveOferta\s*\}\s*from\s*"\.\/recomendados\.ts"/);
    assert.match(resumen, /\.from\("armado_hoteles"\)/);
    assert.match(resumen, /\.select\("paquete_id, hotel_id, prioridad"\)/);
    assert.match(resumen, /\.in\("paquete_id", paqIdsConHotel\)/);
    assert.match(resumen, /\.not\("prioridad", "is", null\)/);
    assert.match(resumen, /claveOferta\(f\.hotel_id, f\.paquete_id\)/);
  });

  test("VistaBooking.tsx importa las funciones puras del motor de recomendados (nunca reimplementa la selección/orden)", () => {
    assert.match(vistaBooking, /import\s*\{[\s\S]*seleccionarRecomendadosGlobalInicial[\s\S]*seleccionarRecomendadosPorDestino[\s\S]*claveOferta[\s\S]*\}\s*from\s*"@\/lib\/tarifario\/recomendados"/);
  });

  test("VistaBooking.tsx construye la identidad de oferta con claveOferta(hotelId,paqueteId) — nunca hotelId a secas — y alimenta ambas variantes de selección", () => {
    assert.match(vistaBooking, /const clave = claveOferta\(id, paqueteId\)/);
    assert.match(vistaBooking, /destinoActivoSub\s*\n?\s*\?\s*seleccionarRecomendadosPorDestino/);
    assert.match(vistaBooking, /:\s*seleccionarRecomendadosGlobalInicial/);
  });

  test("las cards de exploración se construyen UNA por (hotelId,paqueteId) — `hoteles` ya no fusiona por hotel_id a secas", () => {
    assert.match(vistaBooking, /const clave = claveOferta\(id, paqueteId\);\s*\n\s*let c = porOferta\.get\(clave\);/);
  });

  test("el resto del inventario excluye las ofertas ya recomendadas comparando por claveOferta (nunca se duplica una oferta entre las dos secciones)", () => {
    assert.match(vistaBooking, /esRecomendada\(c\.hotelId, c\.paqueteId\)/);
    assert.match(vistaBooking, /esRecomendada\(h\.hotelId, h\.paqueteId\)/);
    assert.match(vistaBooking, /clavesRecomendadasBusqueda\.has\(claveOferta\(r\.hotelId, r\.paqueteId\)\)/);
  });

  test("estado global inicial (sin destino activo): el resto del inventario queda vacío — solo la sección de recomendados", () => {
    // `resto` solo se puebla dentro del bloque `if (destinoActivoSub) { ... }`
    // de la rama de exploración; sin destino activo queda como `[]`.
    assert.match(vistaBooking, /let itemsRestoCandidatos: ItemResto\[\] = \[\];\s*\n\s*const tarjetaPorClaveResto = new Map<string, Tarjeta>\(\);\s*\n\s*if \(destinoActivoSub\) \{/);
  });

  test("las tarjetas recomendadas NUNCA se reordenan por el motor de orden/filtro — solo el resto", () => {
    // `datosBase` (candidatos crudos, persona+unidad, exploración Y búsqueda)
    // JAMÁS llama `ordenarYFiltrarResto` — ese motor es EXCLUSIVO del `tarjetas`
    // final, y ahí solo se aplica a `itemsRestoCandidatos`.
    const inicioDatosBase = vistaBooking.indexOf("const datosBase = useMemo<{");
    const finDatosBase = vistaBooking.indexOf("const zonasRestoDisponibles", inicioDatosBase);
    assert.ok(inicioDatosBase > -1 && finDatosBase > inicioDatosBase, "no se encontró el useMemo datosBase");
    const cuerpoDatosBase = vistaBooking.slice(inicioDatosBase, finDatosBase);
    assert.doesNotMatch(cuerpoDatosBase, /ordenarYFiltrarResto\(/, "datosBase (recomendados + resto candidatos) nunca debe ordenar nada");

    // El `tarjetas` final: los recomendados pasan por `filtrarPorFiltros`
    // (NUNCA reordena, conserva el arreglo de entrada) y el resto por
    // `ordenarYFiltrarResto` — en ese orden textual, y el ensamblado
    // antepone recomendadas al resto.
    const inicioTarjetas = vistaBooking.indexOf("const tarjetas = useMemo<Tarjeta[]>(() => {");
    const finTarjetas = vistaBooking.indexOf("}, [datosBase, ordenResto, filtrosVistaEfectivos]);", inicioTarjetas);
    assert.ok(inicioTarjetas > -1 && finTarjetas > inicioTarjetas, "no se encontró el useMemo final de tarjetas");
    const cuerpo = vistaBooking.slice(inicioTarjetas, finTarjetas);
    const posFiltrarPorFiltros = cuerpo.indexOf("filtrarPorFiltros(datosBase.itemsRecomendados");
    const posOrdenResto = cuerpo.indexOf("ordenarYFiltrarResto(datosBase.itemsRestoCandidatos");
    assert.ok(posFiltrarPorFiltros > -1 && posOrdenResto > posFiltrarPorFiltros, "los recomendados se filtran (sin ordenar) ANTES de ordenar el resto");
    assert.doesNotMatch(cuerpo.slice(0, posOrdenResto), /ordenarYFiltrarResto\(/, "los recomendados nunca pasan por ordenarYFiltrarResto");
    assert.match(cuerpo, /return \[\.\.\.recomendadasFiltradas, \.\.\.restoOrdenado\];/, "el ensamblado final debe anteponer las recomendadas filtradas (en su propio orden) al resto ya ordenado");
  });

  test("las cards recomendadas usan una clave de React por hotel+paquete (nunca colisiona con otra oferta del mismo hotel)", () => {
    assert.match(vistaBooking, /const claveCardPersona = \(c: HotelCard\) => `p-\$\{c\.hotelId\}-\$\{c\.paqueteId\}`;/);
    assert.match(vistaBooking, /const claveCardUnidad = \(h: HotelBernaloDescubierto\) => `u-\$\{h\.hotelId\}-\$\{h\.paqueteId\}`;/);
  });

  test("la etiqueta de oferta existe en las CUATRO superficies (persona y unidad, exploración y búsqueda) — recomendada o no (hallazgo 2)", () => {
    // Una sola pieza compartida: si alguna superficie vuelve a pintar su
    // propio badge, las cuatro pueden divergir.
    assert.match(vistaBooking, /import \{ EtiquetaOferta \} from "\.\/EtiquetaOferta";/);
    assert.match(buscadorBooking, /import \{ EtiquetaOferta \} from "\.\/EtiquetaOferta";/);
    // Persona exploración + unidad exploración (las dos ramas de la grilla).
    assert.match(vistaBooking, /<EtiquetaOferta paqueteNombre=\{t\.card\.paqueteNombre\} recomendada=\{t\.recomendada === true\} \/>/);
    assert.match(vistaBooking, /<EtiquetaOferta paqueteNombre=\{t\.hotel\.paqueteNombre\} recomendada=\{t\.recomendada === true\} \/>/);
    // Persona búsqueda (`Resultado`) y unidad búsqueda (`TarjetaUnidadBusqueda`).
    assert.match(buscadorBooking, /<EtiquetaOferta paqueteNombre=\{r\.paqueteNombre\} recomendada=\{recomendada\} \/>/);
    assert.match(vistaBooking, /<EtiquetaOferta paqueteNombre=\{opcionSel\.paqueteNombre\} recomendada=\{recomendada\} \/>/);
    // Y las dos tarjetas de búsqueda RECIBEN el estado de recomendación —
    // nunca lo deducen por su cuenta.
    assert.match(vistaBooking, /recomendada=\{t\.recomendada === true\}\s*\n\s*foto=\{fotosPorHotel\[t\.r\.hotelId\]/);
    assert.match(vistaBooking, /opciones=\{t\.hotel\.opcionesBusqueda\}\s*\n\s*recomendada=\{t\.recomendada === true\}/);
  });

  test("la etiqueta dice SIEMPRE el paquete y delega el TEXTO en la función pura (probada con ejecución en recomendados.test.ts)", () => {
    const etiqueta = leer("app/tarifario/EtiquetaOferta.tsx");
    // El componente solo PINTA: la regla ("Recomendado · X" vs "X", y null sin
    // nombre) vive en `textoEtiquetaOferta`, pura y cubierta de verdad.
    assert.match(etiqueta, /const texto = textoEtiquetaOferta\(paqueteNombre, recomendada\);/);
    assert.match(etiqueta, /if \(!texto\) return null;/, "sin texto no se pinta nada (nunca un badge vacío)");
    assert.match(etiqueta, /import \{ textoEtiquetaOferta \} from "@\/lib\/tarifario\/recomendados";/);
    // El color es lo único que distingue la recomendada — el texto del paquete
    // va en los dos casos.
    assert.match(etiqueta, /backgroundColor: recomendada \? "var\(--brand-accent\)" : "rgba\(0,0,0,0\.55\)"/);
  });

  test("abrirHotel recibe h.filas ya acotado a la oferta (paquete_id correcto llega al detalle/carrito sin tocar detalle-actions.ts ni el carrito)", () => {
    // No se modificó detalle-actions.ts/CartContext — la corrección confía en
    // que `obtenerDetalleHotel` ya deriva `paqueteIds` de `combos` (=h.filas).
    // Esta prueba solo confirma que `abrirHotel` sigue pasando `h.filas` tal
    // cual (nunca hotelId a secas) — la fuente del acotamiento correcto.
    assert.match(vistaBooking, /combos: h\.filas/);
  });
});

describe("Props threading — page.tsx -> TarifarioPublic -> VistaBooking", () => {
  test("page.tsx destructura prioridadesRecomendados (persona) y lo combina con las de unidad/Bernalo (hallazgo 3) antes de pasarlo a TarifarioPublic", () => {
    assert.match(tarifarioPage, /prioridadesRecomendados, condicionPorOferta, politicaPorOferta, restriccionPorPaquete,\s*\n\s*\}\s*=\s*resDatos\.datos/);
    assert.match(tarifarioPage, /cargarPrioridadesRecomendadosBernalo/);
    assert.match(tarifarioPage, /const prioridadesRecomendadasCombinadas = \{ \.\.\.prioridadesRecomendados, \.\.\.resultadoPrioridadesBernalo\.prioridades \};/);
    assert.match(tarifarioPage, /prioridadesRecomendados=\{prioridadesRecomendadasCombinadas\}/);
  });

  test("TarifarioPublic acepta prioridadesRecomendados y lo reenvía a VistaBooking sin interpretarlo", () => {
    assert.match(tarifarioPublic, /prioridadesRecomendados = \{\}/);
    assert.match(tarifarioPublic, /prioridadesRecomendados=\{prioridadesRecomendados\}/);
  });

  test("VistaBooking declara prioridadesRecomendados como prop con default {}", () => {
    assert.match(vistaBooking, /prioridadesRecomendados = \{\},\s*\n\s*condicionPorOferta = \{\},\s*\n\s*politicaPorOferta = \{\},\s*\n\s*restriccionPorPaquete = \{\},\s*\n\}:\s*\{/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Estados A (global inicial) / B (después de buscar) del motor global. La
// SELECCIÓN la resuelve el módulo puro (cobertura ejecutable en
// pruebas/recomendados.test.ts); acá se verifica el CABLEADO: cuál es el
// gatillo, de dónde sale el resto, y que nada de esto toque precio/
// disponibilidad ni las fuentes de datos.
// ─────────────────────────────────────────────────────────────────────────
describe("Estados A/B — el gatillo es la búsqueda EJECUTADA, nunca el destino elegido", () => {
  test("destinoActivoSub: Bloqueo usa su selector de destino; Porción terrestre exige una búsqueda vigente; Receptivos nunca lo activa", () => {
    assert.match(
      vistaBooking,
      /const destinoActivoSub = sub === "bloqueo"\s*\n\s*\? destinoSel\s*\n\s*: sub === "porcion_terrestre"\s*\n\s*\? destinoPorcionBusqueda\s*\n\s*: "";/
    );
  });

  test("el acotamiento de Porción sale de la búsqueda ejecutada, nunca de un control de exploración (hallazgo 1)", () => {
    // La derivación del destino que acota la grilla de Porción: "" sin
    // búsqueda vigente (el universo global queda intacto) y el destino de la
    // búsqueda cuando existe. El selector de exploración que existía con ese
    // rol se ELIMINÓ por completo, así que no puede volver a participar.
    assert.match(vistaBooking, /const destinoPorcionBusqueda = busquedaPorcion \? busquedaPorcion\.destino : "";/);
    assert.doesNotMatch(vistaBooking, /destinoPorcionSel/, "no debe quedar ningún estado de destino de exploración");
    const inicio = vistaBooking.indexOf("const destinoActivoSub =");
    assert.ok(inicio >= 0, "no se encontró destinoActivoSub");
    const fin = vistaBooking.indexOf(";", inicio);
    const definicion = vistaBooking.slice(inicio, fin);
    assert.match(definicion, /destinoPorcionBusqueda/, "el gatillo de Porción terrestre es el destino de una búsqueda ejecutada");
  });

  test("limpiar resultados vuelve al estado A: BuscadorBooking limpia con onBusqueda(null) y `enBusquedaPorcion` depende de busquedaPorcion != null", () => {
    assert.match(buscadorBooking, /setHuellaBuscada\(null\);\s*\n\s*onBusqueda\?\.\(null\);/);
    assert.match(vistaBooking, /const enBusquedaPorcion = sub === "porcion_terrestre" && busquedaPorcion != null;/);
    // Cambiar de pestaña también limpia (no queda una búsqueda huérfana).
    assert.match(vistaBooking, /setBusquedaPorcion\(null\);/);
  });

  test("sin destino activo la selección es la global inicial (top 2); con destino activo, la de destino (hasta 6)", () => {
    assert.match(vistaBooking, /const recomendadas: OfertaPrioridad\[\] = destinoActivoSub\s*\n\s*\? seleccionarRecomendadosPorDestino\(/);
    assert.match(vistaBooking, /: seleccionarRecomendadosGlobalInicial\(\[\.\.\.ofertasPersona, \.\.\.ofertasUnidad\]\);/);
  });

  test("en el estado global inicial el resto del inventario queda VACÍO: `resto` solo se puebla dentro del if (destinoActivoSub)", () => {
    assert.match(vistaBooking, /let itemsRestoCandidatos: ItemResto\[\] = \[\];\s*\n\s*const tarjetaPorClaveResto = new Map<string, Tarjeta>\(\);\s*\n\s*if \(destinoActivoSub\) \{/);
  });

  test("con una búsqueda vigente SIEMPRE se usa la regla de destino (hasta 6), nunca la global (top 2)", () => {
    const inicio = vistaBooking.indexOf("if (enBusquedaPorcion && busquedaPorcion) {");
    const fin = vistaBooking.indexOf("const cardsPersona = hoteles.filter");
    assert.ok(inicio >= 0 && fin > inicio, "no se encontró la rama de búsqueda");
    const rama = vistaBooking.slice(inicio, fin);
    assert.match(rama, /const recomendadasBusqueda = seleccionarRecomendadosPorDestino\(/);
    assert.doesNotMatch(rama, /seleccionarRecomendadosGlobalInicial/, "una búsqueda nunca cae al tope de 2 del estado global");
  });

  test("el resto de una búsqueda son SOLO resultados reales del motor (persona + unidad confirmadas) — nunca el catálogo precargado", () => {
    const inicio = vistaBooking.indexOf("if (enBusquedaPorcion && busquedaPorcion) {");
    const fin = vistaBooking.indexOf("const cardsPersona = hoteles.filter");
    const rama = vistaBooking.slice(inicio, fin);
    assert.match(rama, /const restoPersonaCandidatas = resultadosPersona\.filter\(\(r\) => !clavesRecomendadasBusqueda\.has\(claveOferta\(r\.hotelId, r\.paqueteId\)\)\);/);
    assert.match(rama, /const restoUnidadCandidatas = gruposUnidadBusqueda\.filter\(\(g\) => !clavesRecomendadasBusqueda\.has\(claveOferta\(g\.hotelId, g\.paqueteId\)\)\);/);
    assert.doesNotMatch(rama, /cardsPersona|hotelesUnidadVisibles/, "la lista de la búsqueda no se completa con la exploración");
  });
});

describe("Ofertas — la unidad nunca mezcla opciones de paquetes distintos", () => {
  test("VistaBooking usa la función pura agruparOpcionesUnidadPorOferta sobre TODAS las opciones confirmadas (Pet friendly/Adults Only ya NO filtran acá — se aplican después, vía FiltrosResto)", () => {
    assert.match(
      vistaBooking,
      /const gruposUnidadBusqueda = agruparOpcionesUnidadPorOferta\(\s*\n\s*busquedaPorcion\.unidad\.flatMap\(\(u\) => u\.opciones\)\s*\n\s*\);/
    );
    assert.match(vistaBooking, /import\s*\{[\s\S]*agruparOpcionesUnidadPorOferta[\s\S]*\}\s*from\s*"@\/lib\/tarifario\/recomendados"/);
  });

  test("cada tarjeta unidad de la búsqueda publica SOLO las opciones de su propio grupo (opcionesBusqueda: g.opciones)", () => {
    assert.match(vistaBooking, /opcionesBusqueda: g\.opciones,/);
    assert.match(vistaBooking, /const g = gruposUnidadPorClave\.get\(clave\);/);
  });

  test("la agrupación pura existe en el motor y no conoce precios ni disponibilidad (solo identidad y prioridad)", () => {
    assert.match(recomendadosFuente, /export function agruparOpcionesUnidadPorOferta</);
    assert.match(recomendadosFuente, /export function ofertasConPrioridad</);
    assert.doesNotMatch(recomendadosFuente, /precioVenta|disponibilidad|precio_pvp|cuposPorBloqueo/);
  });

  test("las candidatas a recomendadas se construyen con la MISMA clave compuesta en las tres fuentes (persona, unidad, búsqueda)", () => {
    assert.match(vistaBooking, /const ofertasPersonaBusqueda = ofertasConPrioridad\(resultadosPersona, prioridadesRecomendados\);/);
    assert.match(vistaBooking, /const ofertasUnidadBusqueda = ofertasConPrioridad\(gruposUnidadBusqueda, prioridadesRecomendados\);/);
    assert.match(vistaBooking, /const ofertasPersona = ofertasConPrioridad\(cardsPersona, prioridadesRecomendados\);/);
    assert.match(vistaBooking, /const ofertasUnidad = ofertasConPrioridad\(hotelesUnidadVisibles, prioridadesRecomendados\);/);
  });
});

describe("Etiquetas, Incluye y add-ons toman el paquete CORRECTO (cada card acotada a su oferta)", () => {
  test("las filas de una card persona se acumulan por clave (hotelId,paqueteId) — nunca por hotel_id a secas", () => {
    assert.match(vistaBooking, /const clave = claveOferta\(id, paqueteId\);/);
    assert.match(vistaBooking, /let c = porOferta\.get\(clave\);/);
    assert.match(vistaBooking, /c\.filas\.push\(f\);/);
    // `abrirHotel` pasa ESAS filas al detalle/carrito: el paquete llega del
    // mismo conjunto acotado, no de una lista de todos los paquetes del hotel.
    assert.match(vistaBooking, /combos: h\.filas/);
  });

  test("el Incluye/No incluye de una tarjeta unidad se resuelve por el paqueteId de la OFERTA elegida", () => {
    assert.match(vistaBooking, /const descripcionOpcion = descripcionPorPaquete\[opcionSel\.paqueteId\];/);
  });

  test("el badge de recomendado nombra el paquete de ESA oferta (misma card, no un paquete global del hotel)", () => {
    assert.match(vistaBooking, /paqueteId, paqueteNombre: f\.paquete_nombre \?\? null,/);
    assert.match(vistaBooking, /ofertas: \[hUnidad\], paqueteId: hUnidad\.paqueteId, paqueteNombre: hUnidad\.paqueteNombre,/);
    assert.match(vistaBooking, /ofertas: \[h\], paqueteId: h\.paqueteId, paqueteNombre: h\.paqueteNombre \},/);
  });
});

describe("Precio y disponibilidad mantienen sus fuentes actuales (la recomendación no las toca)", () => {
  test("persona: el `desde` sigue saliendo de minRoomPvp sobre las filas de la card", () => {
    assert.match(vistaBooking, /for \(const c of arr\) c\.desde = minRoomPvp\(c\.filas\);/);
  });

  test("unidad en búsqueda: el precio sigue siendo opcionSel.precioVenta (ya saneado por el motor)", () => {
    assert.match(vistaBooking, /const precioMostrado = precioActualizado\?\.combo === claveCombo \? precioActualizado\.precio : opcionSel\.precioVenta;/);
  });

  test("unidad en exploración sigue sin precio precargado (desde={null}) — la recomendación no inventa uno", () => {
    assert.match(vistaBooking, /desde=\{null\}/);
  });

  test("la sección de recomendados no filtra por disponibilidad ni cupos: no consulta cuposPorBloqueo ni el motor de cotización", () => {
    assert.match(vistaBooking, /const itemsRecomendados: ItemResto\[\] = \[\];/);
    const inicio = vistaBooking.indexOf("const itemsRecomendados: ItemResto[] = [];");
    const fin = vistaBooking.indexOf("return { itemsRecomendados, tarjetaPorClaveRecomendada, itemsRestoCandidatos, tarjetaPorClaveResto };", inicio);
    assert.ok(inicio >= 0 && fin > inicio);
    const bloque = vistaBooking.slice(inicio, fin);
    assert.doesNotMatch(bloque, /cuposPorBloqueo|computarReservaBernalo|cotizarAlojamiento/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Hallazgo 2: el nombre del paquete es lo que distingue dos tarjetas del
// MISMO hotel (paquete normal vs 3x2), y debe venir de una fuente real.
// ─────────────────────────────────────────────────────────────────────────
describe("Nombre del paquete — fuente real y trazable, nunca derivada por hotelId", () => {
  test("la etiqueta NO está condicionada a ser recomendada: se pinta siempre que haya nombre de paquete", () => {
    // Ningún `ordenRecomendado != null &&` puede envolver la etiqueta — si
    // vuelve a condicionarse, las ofertas NO recomendadas del mismo hotel
    // quedarían sin distinguirse otra vez.
    assert.doesNotMatch(vistaBooking, /recomendada === true &&\s*<EtiquetaOferta/);
    assert.doesNotMatch(buscadorBooking, /recomendada\s*&&\s*<EtiquetaOferta/);
    assert.match(vistaBooking, /<EtiquetaOferta paqueteNombre=\{t\.card\.paqueteNombre\} recomendada=\{t\.recomendada === true\} \/>/);
    assert.match(buscadorBooking, /<EtiquetaOferta paqueteNombre=\{r\.paqueteNombre\} recomendada=\{recomendada\} \/>/);
  });

  test("buscarHoteles toma `paquete_nombre` de la MISMA fila pública que ya da paquete_id/hotel_id (tarifario_resultado_publicable)", () => {
    const cotizar = leer("lib/reservar/cotizar.ts");
    assert.match(cotizar, /\.from\("tarifario_resultado_publicable"\)\s*\n\s*\.select\("paquete_id, hotel_id, destino_nombre, paquete_nombre"\)/);
    // El par (paquete, hotel) conserva el nombre del paquete; un nombre en
    // blanco nunca pisa uno real.
    assert.match(cotizar, /const pares = new Map<string, \{ paquete: number; hotel: number; paqueteNombre: string \| null \}>\(\);/);
    assert.match(cotizar, /if \(previo && \(previo\.paqueteNombre != null \|\| f\.paquete_nombre == null\)\) continue;/);
    // Y llega al resultado por el par, no por el hotel.
    assert.match(cotizar, /paqueteId: paquete, paqueteNombre, categoria: mejor\.categoria/);
    // El tipo lo declara (no es un campo implícito/any).
    assert.match(cotizar, /paqueteNombre: string \| null;/);
  });

  test("la tarjeta persona de búsqueda se identifica por (hotelId, paqueteId): mismo hotel en dos paquetes = dos tarjetas con nombre distinto", () => {
    // La key incluye el paqueteId — dos ofertas del mismo hotel no colisionan
    // en React ni se pisan entre sí.
    assert.match(vistaBooking, /key: `b-\$\{r\.paqueteId\}-\$\{r\.hotelId\}`/);
    // Y el nombre que se pinta sale de ESE resultado (una fila = un par).
    assert.match(vistaBooking, /<Resultado[\s\S]{0,120}r=\{t\.r\}/);
  });

  test("unidad: el nombre del paquete sale de la opción confirmada del motor, no de un paquete elegido a mano", () => {
    assert.match(vistaBooking, /<EtiquetaOferta paqueteNombre=\{opcionSel\.paqueteNombre\} recomendada=\{recomendada\} \/>/);
    // `opcionSel` pertenece al grupo (hotelId,paqueteId) de esa tarjeta: todas
    // sus opciones comparten paquete, así que el nombre es cierto para toda la
    // tarjeta y no cambia al mover categoría/alimentación.
    assert.match(vistaBooking, /const opcionSel = opciones\.find\(\(o\) => o\.categoria === catEff && o\.alimentacion === alimEff\) \?\? opciones\[0\];/);
  });
});

describe("Incluye/No incluye, add-ons, precio y disponibilidad siguen ligados al paquete de la oferta", () => {
  test("persona en búsqueda: Incluye y add-ons salen de `r.paqueteId` (el paquete del resultado), nunca del hotel", () => {
    assert.match(buscadorBooking, /const descripcionPaquete = descripcionPorPaquete\[r\.paqueteId\];/);
    assert.match(buscadorBooking, /const addons: Receptivo\[\] = addonsPorPaquete\.get\(r\.paqueteId\) \?\? \[\];/);
    // Y lo que va al carrito lleva el mismo paqueteId.
    assert.match(buscadorBooking, /modulo: "porcion_terrestre", paqueteId: r\.paqueteId, hotelId: r\.hotelId, bloqueoId: null,/);
  });

  test("unidad en búsqueda: Incluye y add-ons salen de `opcionSel.paqueteId` y pueden cambiar de paquete al cambiar de combinación", () => {
    assert.match(vistaBooking, /const descripcionOpcion = descripcionPorPaquete\[opcionSel\.paqueteId\];/);
    assert.match(vistaBooking, /const addons: Receptivo\[\] = addonsPorPaquete\.get\(opcionSel\.paqueteId\) \?\? \[\];/);
  });

  test("unidad en búsqueda: el precio sigue siendo el de la opción confirmada (`opcionSel.precioVenta`), no uno recalculado por la etiqueta", () => {
    assert.match(vistaBooking, /const precioMostrado = precioActualizado\?\.combo === claveCombo \? precioActualizado\.precio : opcionSel\.precioVenta;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Defecto 2 (P1): el "resto" de la búsqueda pasaba la FUNCIÓN suelta a
// `Array.map`, así que JS le entregaba `(elemento, índice, arreglo)` y el
// ÍNDICE entraba como el segundo argumento del builder — TODAS las ofertas
// específicas se pintaban como "Recomendado · paquete". Estos tests fallan con
// el código viejo. Además, la marca ahora viaja en un OBJETO, así que un
// `.map(fn)` accidental ya no puede convertir el índice en "recomendado".
// ─────────────────────────────────────────────────────────────────────────
describe("Defecto 2 — el índice de Array.map nunca se filtra como recomendación", () => {
  // El código SIN comentarios: los comentarios de esta corrección nombran a
  // propósito el patrón viejo (`.map(tarjetaPersona)`) para documentarlo, y lo
  // que se verifica acá es el CÓDIGO.
  const codigoVista = vistaBooking
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

  test("ningún builder de tarjetas se pasa 'suelto' a .map (siempre con callback explícito)", () => {
    assert.doesNotMatch(codigoVista, /\.map\(tarjetaPersona\)/, "`.map(tarjetaPersona)` filtra el índice como 2º argumento");
    assert.doesNotMatch(codigoVista, /\.map\(tarjetaUnidad\)/, "`.map(tarjetaUnidad)` filtra el índice como 2º argumento");
    // El ensamblado del resto de búsqueda ya no usa `.map` (arma un Map por
    // clave de oferta para poder reordenar/filtrar con `ordenarYFiltrarResto`
    // después) — el llamado explícito sigue siendo de UN solo argumento.
    assert.match(codigoVista, /tarjetaPorClaveResto\.set\(claveOferta\(r\.hotelId, r\.paqueteId\), tarjetaPersona\(r\)\);/);
    assert.match(codigoVista, /tarjetaPorClaveResto\.set\(claveOferta\(g\.hotelId, g\.paqueteId\), tarjetaUnidad\(g\)\);/);
  });

  test("solo las ofertas de `recomendadasBusqueda` llevan la marca: el resto no la asigna por ningún camino", () => {
    const inicio = vistaBooking.indexOf("const restoPersonaCandidatas = resultadosPersona.filter");
    assert.ok(inicio > -1, "no se encontró el ensamblado del resto");
    const fin = vistaBooking.indexOf("return { itemsRecomendados, tarjetaPorClaveRecomendada, itemsRestoCandidatos, tarjetaPorClaveResto };", inicio);
    const bloque = vistaBooking.slice(inicio, fin);
    // La única marca de recomendación la pone el bucle de recomendadas.
    assert.doesNotMatch(bloque, /recomendada: true/, "el resto no puede llevar la marca de recomendación");
    assert.doesNotMatch(bloque, /\.map\(tarjeta/, "el resto no puede mapear con el builder suelto (el índice se colaría)");
    // Y la marca NO se deriva de un consecutivo: `tarjetasRecomendadas.length`
    // ya no existe como fuente de prioridad en ninguna parte del archivo.
    assert.equal([...vistaBooking.matchAll(/tarjetasRecomendadas\.length/g)].length, 0, "ninguna prioridad puede salir del contador del arreglo");
    assert.doesNotMatch(codigoVista, /ordenRecomendado/, "ya no existe el consecutivo `ordenRecomendado`");
  });

  test("por qué el 2º parámetro es un OBJETO y no un número: el índice de un .map accidental nunca puede activar la marca", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];

    // 1) El patrón VIEJO (`2º parámetro = número`) sí se activa con el índice:
    //    es exactamente el defecto que se corrigió.
    const builderNumerico = (item: { id: number }, n?: number) => ({ id: item.id, activa: n != null });
    assert.deepEqual(items.map(builderNumerico).map((t) => t.activa), [true, true, true], "el índice convertía TODA oferta en recomendada");

    // 2) El patrón NUEVO (`2º parámetro = objeto`) no puede activarse así.
    //    Además de que TypeScript rechaza `items.map(builder)` (el índice no es
    //    un `{ recomendada?: boolean }`), en runtime la marca solo se enciende
    //    si el objeto lo dice explícitamente.
    type Marca = { recomendada?: boolean };
    const builder = (item: { id: number }, marca: Marca = {}) => ({ id: item.id, activa: marca.recomendada === true });
    assert.deepEqual(items.map((r) => builder(r)).map((t) => t.activa), [false, false, false], "sin marca, ninguna oferta es recomendada");
    assert.deepEqual(items.map((r) => builder(r, {})).map((t) => t.activa), [false, false, false], "un objeto vacío tampoco marca");
    assert.deepEqual(items.map((r) => builder(r, { recomendada: true })).map((t) => t.activa), [true, true, true], "solo el bucle de recomendadas marca");
    // Y el valor real de la prioridad solo se lee como booleano: nada de números.
    assert.deepEqual(items.map((r) => builder(r, { recomendada: undefined })).map((t) => t.activa), [false, false, false]);
  });
});
