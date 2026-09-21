// ─────────────────────────────────────────────────────────────────────────
// Corrección de alcance (auditoría posterior a "tarjeta completa en el motor
// externo"): la ronda anterior se concentró en `HotelBernaloCotizarModal`
// (modal de EXPLORACIÓN) y afirmó paridad entre `TarjetaUnidadBusqueda` y
// `Resultado` sin compararlas contra la tarjeta completa real (`HotelModal`).
// La evidencia visual (Vista Booking → Buscar alojamiento) demuestra que las
// tarjetas de RESULTADO —las que de verdad se ven en esa pantalla— seguían
// incompletas: sin video, ubicación/mapa, Incluye/No incluye ni add-on.
//
// Este archivo prueba el flujo EXACTO de la captura: Vista Booking → Buscar
// alojamiento → resultados. Las 2 únicas variantes que renderiza esa
// pantalla son `Resultado` (persona, BuscadorBooking.tsx) y
// `TarjetaUnidadBusqueda` (unidad/Bernalo, VistaBooking.tsx) — nunca
// `HotelModal`/`HotelBernaloCotizarModal` (exclusivos de exploración, antes
// de buscar). Wiring por texto/regex contra el código fuente real (no hay
// entorno de DOM en este repo, mismo patrón que el resto de la suite).
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const fuenteBuscador = leer("app/tarifario/BuscadorBooking.tsx");
const fuenteVista = leer("app/tarifario/VistaBooking.tsx");
const fuenteCompartida = leer("app/tarifario/tarjetaHotelCompartida.tsx");

// Extrae el cuerpo de una función balanceando llaves reales — mismo criterio
// que el resto de wiring tests del repo (ver bernaloIntegracionGuardWiring.test.ts).
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

const cuerpoResultado = cuerpoFuncion(fuenteBuscador, "export function Resultado({");
const cuerpoTarjetaUnidadBusqueda = cuerpoFuncion(fuenteVista, "function TarjetaUnidadBusqueda({");
// `cuerpoFuncion` (brace-balancer) no sirve para este useMemo: su firma
// `useMemo<{...}>(() => {` tiene una profundidad de paréntesis > 0 en el "{"
// real del cuerpo (el `()` de la función flecha nunca vuelve a 0 mientras el
// `useMemo(` externo sigue abierto), así que el balanceador nunca lo
// reconoce como inicio. Se acota manualmente con el marcador de cierre
// conocido (mismo criterio que pruebas/ocupacionBernaloUI3EWiring.test.ts).
const idxInicioTarjetas = fuenteVista.indexOf("const datosBase = useMemo<{");
const idxFinTarjetas = fuenteVista.indexOf("const [abierto, setAbierto] = useState<HotelCard | null>(null);", idxInicioTarjetas);
const cuerpoTarjetas = fuenteVista.slice(idxInicioTarjetas, idxFinTarjetas);

// ── Guarda: enumera TODAS las variantes que "Buscar alojamiento" renderiza ─
describe("Guarda — variantes que Vista Booking renderiza en modo búsqueda (Buscar alojamiento)", () => {
  test("con una búsqueda vigente (enBusquedaPorcion && busquedaPorcion), `tarjetas` SOLO produce tipo:'busqueda' (persona) y tipo:'unidad' CON opcionesBusqueda — nunca tipo:'persona' de exploración ni unidad sin opcionesBusqueda", () => {
    const idxRamaBusqueda = cuerpoTarjetas.indexOf("if (enBusquedaPorcion && busquedaPorcion) {");
    const idxFinRamaBusqueda = cuerpoTarjetas.indexOf("const cardsPersona = hoteles.filter");
    assert.notEqual(idxRamaBusqueda, -1, "no se encontró la rama de modo búsqueda");
    assert.notEqual(idxFinRamaBusqueda, -1);
    const ramaBusqueda = cuerpoTarjetas.slice(idxRamaBusqueda, idxFinRamaBusqueda);
    // La rama de búsqueda tiene su propio return — recomendadas (migración
    // 183) primero, resto después; nunca cae a la rama de exploración de abajo.
    assert.match(ramaBusqueda, /return \{ itemsRecomendados, tarjetaPorClaveRecomendada, itemsRestoCandidatos, tarjetaPorClaveResto \};/);
    // Toda entrada tipo:"unidad" en la rama de búsqueda declara
    // `opcionesBusqueda: g.opciones` explícitamente — nunca queda undefined
    // (a diferencia de la rama de exploración, donde no se declara). `g` es la
    // oferta agrupada por (hotelId,paqueteId): sus opciones son SOLO las de
    // ese paquete, nunca una mezcla de paquetes.
    assert.match(ramaBusqueda, /tipo: "unidad" as const,[\s\S]*opcionesBusqueda: g\.opciones,/);
  });

  test("el JSX renderiza tipo:'busqueda' con <Resultado> y tipo:'unidad' con opcionesBusqueda con <TarjetaUnidadBusqueda> — el resto de ramas (persona/unidad de exploración) son inalcanzables durante una búsqueda", () => {
    const idxMap = fuenteVista.indexOf("{tarjetas.map((t) =>");
    assert.notEqual(idxMap, -1);
    const bloque = fuenteVista.slice(idxMap, idxMap + 4000);
    assert.match(bloque, /t\.tipo === "busqueda" \? \([\s\S]{0,400}<Resultado/);
    assert.match(bloque, /\) : t\.hotel\.opcionesBusqueda \? \([\s\S]{0,700}<TarjetaUnidadBusqueda/);
  });

  test("ni Resultado ni TarjetaUnidadBusqueda son HotelModal/HotelBernaloCotizarModal — la prueba de esta corrección apunta a los componentes REALES de la captura, no a los modales de exploración", () => {
    assert.doesNotMatch(cuerpoResultado, /HotelModal|HotelBernaloCotizarModal/);
    assert.doesNotMatch(cuerpoTarjetaUnidadBusqueda, /HotelModal|HotelBernaloCotizarModal/);
  });
});

// ── Tarjeta completa: hotel PERSONA dentro del motor externo (Resultado) ──
describe("Resultado (BuscadorBooking.tsx) — tarjeta completa para hotel persona en Buscar alojamiento", () => {
  test("conserva foto/video, categoría, etiquetas, condición, descripción — usa los componentes compartidos, nunca JSX reinventada", () => {
    assert.match(cuerpoResultado, /info\?\.video_url \? \([\s\S]{0,60}<BackgroundVideo url=\{info\.video_url\} overlay=\{0\} \/>/);
    assert.match(cuerpoResultado, /<Image src=\{foto\} alt=\{r\.hotelNombre \?\? ""\}/);
    assert.match(cuerpoResultado, /<Categoria estrellas=\{info\?\.estrellas \?\? null\} clasificacion=\{info\?\.clasificacion \?\? null\}/);
    assert.match(cuerpoResultado, /<EtiquetasHotel adultsOnly=\{info\?\.adultsOnly \?\? false\} petFriendly=\{info\?\.petFriendly \?\? false\}/);
    assert.match(cuerpoResultado, /<CondicionHotelBadges condicion=\{r\.condicion\}/, "debe conservar el badge de condición COMPLETO (no el compacto) — ya era más rico que HotelModal");
    // Corrección visual (Vercel Preview): la descripción ya no se renderiza
    // inline con <p> — usa el componente compartido expandible.
    assert.match(cuerpoResultado, /<DescripcionHotelExpandible texto=\{info\?\.descripcion\} className="mt-1" textClassName="text-xs text-gray-400" \/>/);
  });

  test("conserva ubicación/mapa vía el componente compartido UbicacionHotel", () => {
    assert.match(cuerpoResultado, /<UbicacionHotel hotelNombre=\{r\.hotelNombre \?\? ""\} ubicacion=\{info\?\.ubicacion\} \/>/);
  });

  test("Incluye/No incluye y add-ons usan el paqueteId ÚNICO Y CIERTO de este resultado (r.paqueteId) — nunca otro paquete ni el catálogo general", () => {
    assert.match(cuerpoResultado, /const descripcionPaquete = descripcionPorPaquete\[r\.paqueteId\];/);
    assert.match(cuerpoResultado, /const addons: Receptivo\[\] = addonsPorPaquete\.get\(r\.paqueteId\) \?\? \[\];/);
    assert.match(cuerpoResultado, /<SeccionesIncluye descripcion=\{descripcionPaquete\} \/>/);
    // AddonsPaquete recibe paqueteId={r.paqueteId} — aunque acá es fijo (no
    // cambia con la selección, a diferencia de la tarjeta unidad), se pasa
    // igual para que el componente compartido tenga SIEMPRE la identidad
    // real del paquete, nunca un valor omitido.
    assert.match(cuerpoResultado, /<AddonsPaquete addons=\{addons\} onAbrir=\{setAddonAbierto\} paqueteId=\{r\.paqueteId\} \/>/);
  });

  test("los add-on abren ReceptivoModal — mismo componente compartido, sin fuente de precio alterna", () => {
    assert.match(cuerpoResultado, /const \[addonAbierto, setAddonAbierto\] = useState<ReceptivoModalInfo \| null>\(null\);/);
    assert.match(cuerpoResultado, /<ReceptivoModal receptivo=\{addonAbierto\} onClose=\{\(\) => setAddonAbierto\(null\)\} \/>/);
  });

  test("precio/disponibilidad PERSONA siguen viniendo exclusivamente de `combo`/`r` (resultado de buscarHoteles) — descripcionPorPaquete/addonsPorPaquete/info NUNCA participan del precio ni de `item`/`enCarrito`", () => {
    const idxItem = cuerpoResultado.indexOf("const item: Omit<HotelCartItemPersona,");
    const idxFinItem = cuerpoResultado.indexOf("};", idxItem);
    const bloqueItem = cuerpoResultado.slice(idxItem, idxFinItem);
    assert.match(bloqueItem, /precio: combo\.total,/, "el precio agregado al carrito debe seguir siendo combo.total");
    assert.doesNotMatch(bloqueItem, /descripcionPorPaquete|addonsPorPaquete|info\./, "el ítem del carrito nunca debe leer las props nuevas (decorativas)");
    assert.match(cuerpoResultado, /\{formatCOP\(combo\.total\)\}/, "el precio mostrado sigue siendo combo.total, vía formatCOP (fuente interna, sin cambios)");
  });
});

// ── Tarjeta completa: hotel UNIDAD/Bernalo dentro del motor externo ───────
describe("TarjetaUnidadBusqueda (VistaBooking.tsx) — tarjeta completa para hotel unidad/Bernalo en Buscar alojamiento", () => {
  test("conserva foto/video, categoría, etiquetas, condición, descripción — usa los mismos componentes compartidos que Resultado", () => {
    assert.match(cuerpoTarjetaUnidadBusqueda, /videoUrl \? \([\s\S]{0,60}<BackgroundVideo url=\{videoUrl\} overlay=\{0\} \/>/);
    assert.match(cuerpoTarjetaUnidadBusqueda, /<Image src=\{foto\} alt=\{hotel\.hotelNombre\}/);
    assert.match(cuerpoTarjetaUnidadBusqueda, /<Categoria estrellas=\{estrellas\} clasificacion=\{clasificacion\}/);
    assert.match(cuerpoTarjetaUnidadBusqueda, /<EtiquetasHotel adultsOnly=\{adultsOnly\} petFriendly=\{petFriendly\}/);
    assert.match(cuerpoTarjetaUnidadBusqueda, /tieneCondicion !== undefined && <CondicionCompacta activo=\{tieneCondicion\}/);
    assert.match(cuerpoTarjetaUnidadBusqueda, /<DescripcionHotelExpandible texto=\{descripcion\} className="mt-1" textClassName="text-xs text-gray-400" \/>/);
  });

  test("conserva ubicación/mapa vía el componente compartido UbicacionHotel", () => {
    assert.match(cuerpoTarjetaUnidadBusqueda, /<UbicacionHotel hotelNombre=\{hotel\.hotelNombre\} ubicacion=\{ubicacion\} \/>/);
  });

  test("Incluye/No incluye y add-ons usan el paqueteId de la OFERTA SELECCIONADA (opcionSel.paqueteId) — reactivo al combo categoría/alimentación elegido", () => {
    assert.match(cuerpoTarjetaUnidadBusqueda, /const descripcionOpcion = descripcionPorPaquete\[opcionSel\.paqueteId\];/);
    assert.match(cuerpoTarjetaUnidadBusqueda, /const addons: Receptivo\[\] = addonsPorPaquete\.get\(opcionSel\.paqueteId\) \?\? \[\];/);
    assert.match(cuerpoTarjetaUnidadBusqueda, /<SeccionesIncluye descripcion=\{descripcionOpcion\} \/>/);
    // paqueteId={opcionSel.paqueteId}: mismo identificador reactivo — al
    // cambiar de combo, AddonsPaquete cierra su lista sola (ver el test
    // dedicado de cierre automático más abajo).
    assert.match(cuerpoTarjetaUnidadBusqueda, /<AddonsPaquete addons=\{addons\} onAbrir=\{setAddonAbierto\} paqueteId=\{opcionSel\.paqueteId\} \/>/);
  });

  // Requisito explícito: "dos paquetes que comparten hotel no mezclan
  // contenido". Un mismo hotel unidad puede tener OFERTAS de paquetes
  // DISTINTOS (`opciones: OpcionUnidadConfirmada[]`, cada una con su propio
  // `paqueteId`); el contenido debe seguir SIEMPRE a `opcionSel`, nunca a un
  // paqueteId fijo tomado de la primera oferta o del hotel.
  test("dos paquetes que comparten hotel NO mezclan contenido: descripcionOpcion/addons se derivan de opcionSel (deriva con la selección), nunca de opciones[0].paqueteId ni de hotel.hotelId", () => {
    assert.doesNotMatch(cuerpoTarjetaUnidadBusqueda, /descripcionPorPaquete\[opciones\[0\]\.paqueteId\]/, "nunca debe fijarse en la primera oferta");
    assert.doesNotMatch(cuerpoTarjetaUnidadBusqueda, /descripcionPorPaquete\[hotel\.hotelId\]/, "el hotelId nunca debe usarse como paqueteId");
    // `opcionSel` se deriva de catEff/alimEff (el combo elegido por el
    // usuario) — confirma que SÍ cambia con la selección.
    assert.match(cuerpoTarjetaUnidadBusqueda, /const opcionSel = opciones\.find\(\(o\) => o\.categoria === catEff && o\.alimentacion === alimEff\) \?\? opciones\[0\];/);
    // La declaración de descripcionOpcion/addons debe estar DESPUÉS de
    // opcionSel (depende de él, no al revés).
    const idxOpcionSel = cuerpoTarjetaUnidadBusqueda.indexOf("const opcionSel =");
    const idxDescripcionOpcion = cuerpoTarjetaUnidadBusqueda.indexOf("const descripcionOpcion =");
    assert.ok(idxOpcionSel < idxDescripcionOpcion && idxOpcionSel > -1 && idxDescripcionOpcion > -1);
  });

  test("los add-on abren ReceptivoModal — mismo componente compartido, con estado propio addonAbierto (no comparte estado con Resultado)", () => {
    assert.match(cuerpoTarjetaUnidadBusqueda, /const \[addonAbierto, setAddonAbierto\] = useState<ReceptivoModalInfo \| null>\(null\);/);
    assert.match(cuerpoTarjetaUnidadBusqueda, /<ReceptivoModal receptivo=\{addonAbierto\} onClose=\{\(\) => setAddonAbierto\(null\)\} \/>/);
  });

  test("precio/disponibilidad UNIDAD siguen viniendo EXCLUSIVAMENTE de Bernalo: precioMostrado/agregar() dependen de opcionSel.precioVenta y revalidan con cotizarAlojamientoBernaloPublico — las props nuevas (ubicacion/descripcionPorPaquete/addonsPorPaquete) nunca aparecen ahí", () => {
    assert.match(cuerpoTarjetaUnidadBusqueda, /const precioMostrado = precioActualizado\?\.combo === claveCombo \? precioActualizado\.precio : opcionSel\.precioVenta;/);
    const idxAgregar = cuerpoTarjetaUnidadBusqueda.indexOf("async function agregar() {");
    const idxFinAgregar = cuerpoTarjetaUnidadBusqueda.indexOf("\n  }", idxAgregar);
    const cuerpoAgregar = cuerpoTarjetaUnidadBusqueda.slice(idxAgregar, idxFinAgregar);
    assert.match(cuerpoAgregar, /revalidarReservaUnidad\(\s*\n\s*cotizarAlojamientoBernaloPublico,/, "debe seguir revalidando con la Server Action pública Bernalo");
    assert.doesNotMatch(cuerpoAgregar, /ubicacion|descripcionPorPaquete|addonsPorPaquete|descripcionOpcion/, "agregar() nunca debe leer el contenido decorativo nuevo");
  });
});

// ── Búsqueda/exploración general SIN paquete de origen: nunca inventa ─────
describe("Sin paquete de origen inequívoco (exploración antes de elegir oferta/salida) — nunca se inventa Incluye/add-ons", () => {
  const cuerpoHotelModal = cuerpoFuncion(fuenteVista, "function HotelModal({");
  const cuerpoHotelBernaloCotizarModal = cuerpoFuncion(fuenteVista, "function HotelBernaloCotizarModal({");

  test("HotelModal (persona, exploración): sin `opcion` resuelta (nada elegido todavía), el contenido dependiente de paquete queda undefined — SeccionesIncluye/AddonsPaquete no reciben nada que mostrar, pero la identidad del hotel (foto/categoría/etiquetas/descripción/ubicación) se muestra igual", () => {
    assert.match(cuerpoHotelModal, /const descripcionOpcion = opcion \? descripcionPorPaquete\[opcion\.paqueteId\] : undefined;/);
    assert.match(cuerpoHotelModal, /const addons: Receptivo\[\] = opcion \? \(addonsPorPaquete\.get\(opcion\.paqueteId\) \?\? \[\]\) : \[\];/);
    // La identidad del hotel (header) se renderiza ANTES del `!opcion ?`
    // (nunca condicionada a tener una opción elegida).
    const idxHeader = cuerpoHotelModal.indexOf("<Categoria estrellas={hotel.estrellas}");
    const idxCondSinOpcion = cuerpoHotelModal.indexOf("!opcion ? (");
    assert.notEqual(idxHeader, -1);
    assert.notEqual(idxCondSinOpcion, -1);
    assert.ok(idxHeader < idxCondSinOpcion, "el header de identidad debe mostrarse SIEMPRE, incluso sin opción elegida");
  });

  test("HotelBernaloCotizarModal (unidad, exploración): sin oferta elegida (`!hotel`), descripcionOferta/addons quedan undefined/vacíos — nunca se inventa contenido de una oferta no elegida; el header (foto/categoría/etiquetas/descripción/ubicación) del hotel FÍSICO se muestra igual, por hotelId, sin depender de la oferta", () => {
    assert.match(cuerpoHotelBernaloCotizarModal, /const descripcionOferta = hotel \? descripcionPorPaquete\[hotel\.paqueteId\] : undefined;/);
    assert.match(cuerpoHotelBernaloCotizarModal, /const addons: Receptivo\[\] = hotel \? \(addonsPorPaquete\.get\(hotel\.paqueteId\) \?\? \[\]\) : \[\];/);
    const idxHeader = cuerpoHotelBernaloCotizarModal.indexOf("<Categoria estrellas={info?.estrellas ?? null}");
    const idxSinHotel = cuerpoHotelBernaloCotizarModal.indexOf("!hotel ? (");
    assert.notEqual(idxHeader, -1);
    assert.notEqual(idxSinHotel, -1);
    assert.ok(idxHeader < idxSinHotel, "el header por hotelId físico debe mostrarse SIEMPRE, incluso antes de elegir oferta");
  });

  test("SeccionesIncluye/AddonsPaquete (tarjetaHotelCompartida.tsx) devuelven null sin contenido — nunca placeholder ni dato inventado", () => {
    const cuerpoSecciones = cuerpoFuncion(fuenteCompartida, "export function SeccionesIncluye({");
    assert.match(cuerpoSecciones, /if \(!secciones\.length\) return null;/);
    const cuerpoAddons = cuerpoFuncion(fuenteCompartida, "export function AddonsPaquete({");
    assert.match(cuerpoAddons, /if \(!addons\.length\) return null;/);
  });
});
