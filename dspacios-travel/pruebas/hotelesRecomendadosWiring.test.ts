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
    assert.match(vistaBooking, /let resto: Tarjeta\[\] = \[\];\s*\n\s*if \(destinoActivoSub\) \{/);
  });

  test("las tarjetas recomendadas NUNCA se reordenan alfabéticamente en el ensamblado final — solo el resto", () => {
    const inicio = vistaBooking.indexOf("const cardsPersona = hoteles.filter");
    assert.ok(inicio >= 0);
    const siguiente = vistaBooking.indexOf("}, [hoteles, hotelesUnidadVisibles", inicio);
    const cuerpo = vistaBooking.slice(inicio, siguiente);
    // El `.sort(...localeCompare...)` alfabético debe aplicarse SOLO a `resto`
    // (tarjetasRecomendadas ya viene resuelto antes de ese punto, en orden de
    // prioridad, y nunca se reordena después).
    const posSortAlfabetico = cuerpo.indexOf(".sort((x, y) => nombreTarjeta(x).localeCompare(nombreTarjeta(y)))");
    const posRecomendadas = cuerpo.indexOf("const recomendadas:");
    assert.ok(posSortAlfabetico > 0 && posRecomendadas > 0, "faltan los bloques de recomendadas/sort alfabético esperados");
    assert.ok(posSortAlfabetico > posRecomendadas, "el sort alfabético debe aparecer DESPUÉS de resolver recomendadas (aplicado solo a resto)");
    assert.match(cuerpo, /return \[\.\.\.tarjetasRecomendadas, \.\.\.resto\];/, "el ensamblado final debe anteponer las recomendadas, en su propio orden, al resto ya ordenado");
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
    assert.match(vistaBooking, /<EtiquetaOferta paqueteNombre=\{t\.card\.paqueteNombre\} recomendada=\{t\.ordenRecomendado != null\} \/>/);
    assert.match(vistaBooking, /<EtiquetaOferta paqueteNombre=\{t\.hotel\.paqueteNombre\} recomendada=\{t\.ordenRecomendado != null\} \/>/);
    // Persona búsqueda (`Resultado`) y unidad búsqueda (`TarjetaUnidadBusqueda`).
    assert.match(buscadorBooking, /<EtiquetaOferta paqueteNombre=\{r\.paqueteNombre\} recomendada=\{recomendada\} \/>/);
    assert.match(vistaBooking, /<EtiquetaOferta paqueteNombre=\{opcionSel\.paqueteNombre\} recomendada=\{recomendada\} \/>/);
    // Y las dos tarjetas de búsqueda RECIBEN el estado de recomendación —
    // nunca lo deducen por su cuenta.
    assert.match(vistaBooking, /recomendada=\{t\.ordenRecomendado != null\}\s*\n\s*foto=\{fotosPorHotel\[t\.r\.hotelId\]/);
    assert.match(vistaBooking, /opciones=\{t\.hotel\.opcionesBusqueda\}\s*\n\s*recomendada=\{t\.ordenRecomendado != null\}/);
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
    assert.match(tarifarioPage, /prioridadesRecomendados,?\s*\n?\s*\}\s*=\s*resDatos\.datos/);
    assert.match(tarifarioPage, /cargarPrioridadesRecomendadosBernalo/);
    assert.match(tarifarioPage, /const prioridadesRecomendadasCombinadas = \{ \.\.\.prioridadesRecomendados, \.\.\.resultadoPrioridadesBernalo\.prioridades \};/);
    assert.match(tarifarioPage, /prioridadesRecomendados=\{prioridadesRecomendadasCombinadas\}/);
  });

  test("TarifarioPublic acepta prioridadesRecomendados y lo reenvía a VistaBooking sin interpretarlo", () => {
    assert.match(tarifarioPublic, /prioridadesRecomendados = \{\}/);
    assert.match(tarifarioPublic, /prioridadesRecomendados=\{prioridadesRecomendados\}/);
  });

  test("VistaBooking declara prioridadesRecomendados como prop con default {}", () => {
    assert.match(vistaBooking, /prioridadesRecomendados = \{\},?\s*\n?\}:\s*\{/);
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
    assert.match(vistaBooking, /let resto: Tarjeta\[\] = \[\];\s*\n\s*if \(destinoActivoSub\) \{/);
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
    assert.match(rama, /\.\.\.resultadosPersona\.filter\(\(r\) => !clavesRecomendadasBusqueda\.has\(claveOferta\(r\.hotelId, r\.paqueteId\)\)\)/);
    assert.match(rama, /\.\.\.gruposUnidadBusqueda\.filter\(\(g\) => !clavesRecomendadasBusqueda\.has\(claveOferta\(g\.hotelId, g\.paqueteId\)\)\)/);
    assert.doesNotMatch(rama, /cardsPersona|hotelesUnidadVisibles/, "la lista de la búsqueda no se completa con la exploración");
  });
});

describe("Ofertas — la unidad nunca mezcla opciones de paquetes distintos", () => {
  test("VistaBooking usa la función pura agruparOpcionesUnidadPorOferta sobre las opciones confirmadas (ya filtradas por Pet friendly/Adults Only)", () => {
    assert.match(
      vistaBooking,
      /const gruposUnidadBusqueda = agruparOpcionesUnidadPorOferta\(\s*\n\s*busquedaPorcion\.unidad\.filter\(\(u\) => porFiltros\(u\.hotelId\)\)\.flatMap\(\(u\) => u\.opciones\)\s*\n\s*\);/
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
    assert.match(vistaBooking, /const tarjetasRecomendadas: Tarjeta\[\] = \[\];/);
    const inicio = vistaBooking.indexOf("const tarjetasRecomendadas: Tarjeta[] = [];");
    const fin = vistaBooking.indexOf("return [...tarjetasRecomendadas, ...resto];", inicio);
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
    assert.doesNotMatch(vistaBooking, /ordenRecomendado != null &&\s*<EtiquetaOferta/);
    assert.doesNotMatch(buscadorBooking, /recomendada\s*&&\s*<EtiquetaOferta/);
    assert.match(vistaBooking, /<EtiquetaOferta paqueteNombre=\{t\.card\.paqueteNombre\} recomendada=\{t\.ordenRecomendado != null\} \/>/);
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
