import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { destinosPorcionPublica } from "../lib/tarifario/destinosPorcion.ts";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3E Bernalo — verificación por inspección de la UI de descubrimiento
// y cotización (`app/tarifario/VistaBooking.tsx`, `TarifarioPublic.tsx`,
// `page.tsx`). No ejecutable bajo `node --test` (JSX/Next) — se verifica el
// código fuente, mismo criterio del resto de wiring tests del repo.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuenteVista = readFileSync(join(raiz, "app/tarifario/VistaBooking.tsx"), "utf8");
const fuentePublic = readFileSync(join(raiz, "app/tarifario/TarifarioPublic.tsx"), "utf8");
const fuentePage = readFileSync(join(raiz, "app/tarifario/page.tsx"), "utf8");

function sinComentarios(fuente: string): string {
  return fuente.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*\*?\s*$/.test(l)).join("\n");
}
const codigoVista = sinComentarios(fuenteVista);

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

const cuerpoEditorPax = cuerpoFuncion(fuenteVista, "function EditorPax({");

describe("VistaBooking.tsx — Vista Booking unificada: persona y unidad en UNA sola lista", () => {
  // Reemplaza el hallazgo original ("descubrimiento paralelo, sin filas
  // ficticias", que exigía una sección SEPARADA) — la unificación pidió
  // exactamente lo contrario: una sola colección visible (`tarjetas`),
  // nunca una sección aparte "con tarifa personalizada". `hotelesBernalo`
  // sigue sin tocar `tarifario_resultado`/`filas` (eso no cambió), pero la
  // GRILLA sí mezcla ambas fuentes.
  //
  // `cuerpoFuncion` (brace-depth-aware, sin seguimiento de "<"/">") no puede
  // acotar un `useMemo(() => { ... }, [deps]);`: el "(" de `useMemo(` y el de
  // los parámetros vacíos de la flecha `()` dejan la profundidad de paréntesis
  // en 1 justo cuando aparece el "{" real del cuerpo, así que ese "{" nunca
  // se reconoce como inicio — se acota manualmente con marcadores de texto
  // únicos, igual criterio que pruebas/armadoClientHotelModalWiring.test.ts.
  const idxUnidadVisibles = fuenteVista.indexOf("const hotelesUnidadVisibles = useMemo(() => {");
  const idxFinUnidadVisibles = fuenteVista.indexOf("// Una sola colección para la grilla", idxUnidadVisibles);
  const cuerpoUnidadVisibles = fuenteVista.slice(idxUnidadVisibles, idxFinUnidadVisibles);
  const idxTarjetas = fuenteVista.indexOf("const tarjetas = useMemo<Tarjeta[]>(() => {");
  const idxFinTarjetas = fuenteVista.indexOf("const [abierto, setAbierto] = useState<HotelCard | null>(null);", idxTarjetas);
  const cuerpoTarjetas = fuenteVista.slice(idxTarjetas, idxFinTarjetas);

  test("existe una única colección `tarjetas` que combina hoteles persona y unidad, ordenada junta", () => {
    assert.match(codigoVista, /const tarjetas = useMemo<Tarjeta\[\]>\(\(\) => \{/);
    assert.match(cuerpoTarjetas, /tipo: "persona" as const/);
    assert.match(cuerpoTarjetas, /tipo: "unidad" as const/);
    // Hoteles recomendados (auditoría, hallazgo 3): las recomendadas
    // (persona + unidad combinadas) van PRIMERO, en su propio orden de
    // prioridad, sin reordenar — el resto (persona sin recomendar + unidad
    // sin recomendar) se alfabetiza como siempre, en un `resto` propio.
    assert.match(cuerpoTarjetas, /resto = \[\.\.\.restoPersona, \.\.\.restoUnidad\]\.sort\(\(x, y\) => nombreTarjeta\(x\)\.localeCompare\(nombreTarjeta\(y\)\)\);/);
    assert.match(cuerpoTarjetas, /return \[\.\.\.tarjetasRecomendadas, \.\.\.resto\];/);
  });

  test("ya NO existe la sección separada 'Alojamientos con tarifa personalizada' ni un bloque de renderizado JSX aparte para hotelesBernalo", () => {
    assert.doesNotMatch(codigoVista, /Alojamientos con tarifa personalizada/);
    // `hotelesBernalo.map(...)` SÍ aparece ahora en lógica pura (armar el set
    // de ids autoritativos en `tarjetas`, P1; derivar destinos en
    // `destinosBloqueo`/`destinos`, P3) — lo que nunca debe volver a existir
    // es un `{hotelesBernalo.map(...)}` DENTRO del JSX renderizado (un bloque
    // de tarjetas aparte, fuera de la grilla única `tarjetas.map`).
    assert.doesNotMatch(codigoVista, /\{hotelesBernalo\.map\(/);
  });

  test("P2: la grilla única (tarjetas.map) renderiza AMBOS tipos con el MISMO componente compartido `TarjetaHotelCard` — nunca dos copias de JSX que puedan divergir", () => {
    const idxGrid = codigoVista.indexOf("{tarjetas.map((t) =>");
    assert.notEqual(idxGrid, -1);
    const bloque = codigoVista.slice(idxGrid, idxGrid + 6000);
    const usosComponente = [...bloque.matchAll(/<TarjetaHotelCard\b/g)];
    assert.equal(usosComponente.length, 2, "persona y unidad deben invocar el mismo componente de tarjeta, una vez cada uno");
    // El contenedor visual en sí NUNCA se repite dentro de `tarjetas.map` —
    // vive una sola vez, dentro de la definición de `TarjetaHotelCard`
    // (verificado abajo), no como JSX duplicado por rama persona/unidad. (La
    // clase también aparece en la tarjeta de Receptivos, un tipo de producto
    // distinto y no tocado por esta unificación — por eso se acota la
    // búsqueda al bloque `tarjetas.map`, no a todo el archivo.)
    assert.doesNotMatch(bloque, /rounded-2xl border border-gray-200 bg-white text-left transition-all hover:-translate-y-1/);
    const cuerpoTarjetaCard = cuerpoFuncion(fuenteVista, "function TarjetaHotelCard({");
    assert.match(cuerpoTarjetaCard, /rounded-2xl border border-gray-200 bg-white text-left transition-all hover:-translate-y-1/);
  });

  test('TarjetaHotelCard (compartida) usa "Consultar" (fallback sin precio) y "Ver opciones →" (acción principal) — nunca "tarifa personalizada"/"Bernalo" visibles en la grilla', () => {
    const cuerpoTarjetaCard = cuerpoFuncion(fuenteVista, "function TarjetaHotelCard({");
    assert.match(cuerpoTarjetaCard, /Ver opciones →/);
    assert.match(cuerpoTarjetaCard, /Consultar/);
    const idxGrid = codigoVista.indexOf("{tarjetas.map((t) =>");
    const idxFinGrid = codigoVista.indexOf("{abierto && (", idxGrid);
    assert.notEqual(idxFinGrid, -1);
    const bloque = codigoVista.slice(idxGrid, idxFinGrid);
    assert.doesNotMatch(bloque, /tarifa personalizada/i);
    // "Bernalo" no puede aparecer como TEXTO VISIBLE en el JSX — se excluyen
    // los identificadores de código (`setModalBernalo`, `t.hotel`, etc., que
    // nunca se renderizan al usuario) filtrando solo el contenido entre
    // `>` y `<` de cada nodo de texto.
    const textosVisibles = [...bloque.matchAll(/>([^<>{}]*Bernalo[^<>{}]*)</gi)];
    assert.equal(textosVisibles.length, 0, `texto visible con "Bernalo": ${JSON.stringify(textosVisibles.map((m) => m[1]))}`);
  });

  // P1 (hallazgo confirmado, validación final — ronda 2): antes se excluía
  // la oferta UNIDAD cuando el hotelId ya tenía tarjeta persona
  // (`idsPersona`) — invertido: una fila persona en `tarifario_resultado`
  // puede ser una CACHÉ obsoleta si el hotel migró a
  // `modelo_tarifario = 'unidad'` después de la última corrida de
  // `generarTarifario`. La primera corrección excluía por `hotelesBernalo`
  // (el prop tal cual llega a VistaBooking) — pero ese prop YA viene
  // filtrado por acomodación/categoría/régimen/texto desde TarifarioPublic
  // (`hotelesBernaloFiltrados`/`fAcom ? [] : ...`), así que con un filtro
  // activo el hotel podía desaparecer de ahí y su tarjeta persona obsoleta
  // REAPARECÍA. Ahora se excluye por `hotelIdsUnidadAutoritativos` — un
  // canal SEPARADO (`lib/tarifario/datosBernalo.ts`) que viaja sin pasar por
  // ningún filtro de visibilidad — nunca al revés.
  test("nunca se muestran DOS tarjetas del mismo hotel — la persona se excluye por `hotelIdsUnidadAutoritativos` (canal SIN filtrar), nunca por `hotelesBernalo` (que SÍ se filtra en TarifarioPublic)", () => {
    assert.match(cuerpoUnidadVisibles, /h\.tipo === sub/);
    assert.match(cuerpoTarjetas, /const idsUnidadAutoritativa = new Set\(hotelIdsUnidadAutoritativos\);/);
    assert.match(cuerpoTarjetas, /const cardsPersona = hoteles\.filter\(\(c\) => !idsUnidadAutoritativa\.has\(c\.hotelId\)\);/);
    // La rama unidad NUNCA debe volver a filtrar por "ya existe en persona"
    // — eso reintroduciría la prioridad invertida.
    assert.doesNotMatch(cuerpoTarjetas, /idsPersona/);
    // Nunca debe derivarse de `hotelesBernalo` (filtrable) — ese fue
    // exactamente el bug de la primera corrección.
    assert.doesNotMatch(cuerpoTarjetas, /new Set\(hotelesBernalo\.map/);
  });

  // ⚠️ Hallazgo confirmado (validación real, ronda 2): con un filtro de
  // acomodación/categoría/régimen/texto activo en TarifarioPublic, la
  // primera corrección de P1 dejaba de excluir la tarjeta persona (porque
  // derivaba la exclusión de `hotelesBernalo`, ya recortado) — la fila
  // persona legacy REAPARECÍA. `hotelIdsUnidadAutoritativos` no pasa por
  // ningún filtro, así que esto ya no puede volver a pasar.
  test("P1 (ronda 2): persona legacy + unidad vigente + filtro de acomodación activo — la tarjeta persona NUNCA reaparece", () => {
    // El prop que TarifarioPublic pasa como `hotelesBernalo` SÍ se filtra
    // por `fAcom`/acomodación/categoría/régimen/texto (comportamiento
    // correcto: decide qué tarjeta UNIDAD mostrar) — pero
    // `hotelIdsUnidadAutoritativos` es un prop DISTINTO, nunca gateado por
    // `fAcom` ni por `hotelesBernaloFiltrados`.
    const idxVB = fuentePublic.indexOf("<VistaBooking");
    const idxFinVB = fuentePublic.indexOf("/>", idxVB);
    const propsVB = fuentePublic.slice(idxVB, idxFinVB);
    assert.match(propsVB, /hotelesBernalo=\{fAcom \? \[\] : hotelesBernaloFiltrados\}/);
    assert.match(propsVB, /hotelIdsUnidadAutoritativos=\{hotelIdsUnidadAutoritativos\}/);
    assert.doesNotMatch(propsVB, /hotelIdsUnidadAutoritativos=\{fAcom/, "el canal autoritativo nunca debe gatearse por fAcom ni ningún otro filtro");
  });

  // ⚠️ Hallazgo confirmado (validación real, ronda 2): una oferta unidad sin
  // tarifa publicable (P1-3) o de un paquete no compatible (P2) queda FUERA
  // de `hoteles`/`hotelesBernalo` (el catálogo cotizable) — pero el hotel
  // SIGUE siendo modelo unidad en la base. `hotelIdsUnidadAutoritativos` se
  // calcula ANTES de esos dos filtros (ver `datosBernalo.ts`), así que la
  // tarjeta persona obsoleta se excluye aunque la oferta unidad no sea
  // publicable — mostrar la persona sería mentir sobre el modelo real.
  test("P1 (ronda 2): persona legacy + unidad SIN tarifa publicable — la tarjeta persona tampoco aparece (nunca se infiere disponibilidad desde la ausencia en el catálogo)", () => {
    const fuenteDiscovery = readFileSync(join(raiz, "lib/tarifario/datosBernalo.ts"), "utf8");
    const idxAutoritativo = fuenteDiscovery.indexOf("const hotelIdsUnidadAutoritativos = [");
    const idxParesPublicados = fuenteDiscovery.indexOf("P1-3 (hallazgo confirmado)");
    assert.notEqual(idxAutoritativo, -1);
    assert.notEqual(idxParesPublicados, -1);
    assert.ok(idxAutoritativo < idxParesPublicados, "hotelIdsUnidadAutoritativos debe calcularse ANTES del filtro de disponibilidad publicada (P1-3)");
    // Tampoco debe pasar por el filtro de tipo de paquete compatible (P2).
    const idxTipoCompatible = fuenteDiscovery.indexOf("const TIPOS_UNIDAD_COMPATIBLES");
    assert.notEqual(idxTipoCompatible, -1);
    assert.ok(idxAutoritativo < idxTipoCompatible, "hotelIdsUnidadAutoritativos debe calcularse ANTES del filtro de tipo de paquete compatible (P2)");
  });

  test("una fila persona legacy + una oferta unidad vigente del MISMO hotelId producen tarjetas de identidad SEPARADA — nunca se fusionan por hotelId a secas", () => {
    // `cardsPersona` (persona) se construye a partir del `hoteles` YA
    // FILTRADO (sin los hotelId unidad) — nunca del `hoteles` crudo. Las
    // cards persona (recomendadas + resto) se mapean a partir de esa MISMA
    // colección ya filtrada, nunca de `hoteles` sin filtrar.
    assert.match(cuerpoTarjetas, /const cardsPersona = hoteles\.filter\(\(c\) => !idsUnidadAutoritativa\.has\(c\.hotelId\)\);/);
    // Las tarjetas recomendadas persona buscan por (hotelId,paqueteId)
    // exacto — nunca solo hotelId — así que un hotelId que ya fue excluido
    // de `cardsPersona` (por ser unidad autoritativo) nunca puede colarse.
    assert.match(cuerpoTarjetas, /const cPersona = cardsPersona\.find\(\(c\) => c\.hotelId === o\.hotelId && c\.paqueteId === o\.paqueteId\);/);
    assert.match(cuerpoTarjetas, /const hUnidad = hotelesUnidadVisibles\.find\(\(h\) => h\.hotelId === o\.hotelId && h\.paqueteId === o\.paqueteId\);/);
  });

  test("un hotel REALMENTE persona (su hotelId no aparece en hotelIdsUnidadAutoritativos) sigue mostrando su tarjeta — nunca se excluye por error", () => {
    // El filtro de exclusión compara contra `idsUnidadAutoritativa`
    // (derivado de `hotelIdsUnidadAutoritativos`, el canal SIN filtrar) — un
    // hotelId que nunca aparece ahí (porque de verdad es persona, sin
    // ninguna fila `hoteles.modelo_tarifario = 'unidad'`) nunca puede
    // coincidir con `.has(c.hotelId)`, así que
    // `!idsUnidadAutoritativa.has(c.hotelId)` es `true` y esa tarjeta
    // persona se conserva exactamente como antes.
    assert.match(cuerpoTarjetas, /const idsUnidadAutoritativa = new Set\(hotelIdsUnidadAutoritativos\);/);
    // El resto del pipeline de la tarjeta persona (key, card) sigue siendo el
    // mismo criterio de siempre — identidad hotelId+paqueteId SIEMPRE
    // (auditoría: ya no hay una variante "solo hotelId" para cards sin
    // recomendar — toda oferta persona se identifica por su clave compuesta).
    assert.match(cuerpoTarjetas, /const claveCardPersona = \(c: HotelCard\) => `p-\$\{c\.hotelId\}-\$\{c\.paqueteId\}`;/);
  });

  test("hotelesUnidadVisibles responde a la pestaña activa (h.tipo === sub) y al destino elegido en Paquetes — igual que la grilla persona", () => {
    assert.match(cuerpoUnidadVisibles, /if \(sub === "receptivos"\) return \[\];/);
    assert.match(cuerpoUnidadVisibles, /hotelesBernalo\.filter\(\(h\) => h\.tipo === sub\)/);
    assert.match(cuerpoUnidadVisibles, /if \(sub === "bloqueo" && destinoSel\)/);
  });

  // P1-2 (superado por la auditoría, hallazgo 3): la agrupación original
  // ("un mismo hotelId puede tener VARIAS ofertas de paquetes distintos —
  // agrúpalas en UNA tarjeta con todas sus opciones") es EXACTAMENTE el bug
  // que el hallazgo 3 corrigió — una tarjeta así mezclaba paquetes distintos
  // bajo el mismo hotel. Ahora `hotelesUnidadVisibles` ya trae una entrada
  // por (hotelId,paqueteId) (fuente: `HotelBernaloDescubierto`, un row por
  // oferta) y CADA entrada arma su PROPIA tarjeta — nunca se agrupan varias
  // entradas de distinto paqueteId en una sola. `ofertas` sigue siendo un
  // arreglo por compatibilidad con `HotelBernaloCotizarModal` (que soporta
  // `ofertas.length === 1`), pero en exploración siempre lleva un solo
  // elemento: la propia oferta de esa card.
  test("las tarjetas unidad de exploración son UNA por (hotelId,paqueteId) — `hotel.ofertas` nunca mezcla ofertas de paquetes distintos", () => {
    // La rama de EXPLORACIÓN no agrupa nada por hotelId: cada entrada de
    // `hotelesUnidadVisibles` (ya una oferta hotel+paquete) arma su propia
    // tarjeta. Se acota a la rama de exploración a propósito: en la rama de
    // BÚSQUEDA sí existe `gruposUnidadBusqueda`, pero agrupa por
    // (hotelId,paqueteId) — la identidad ACEPTADA, no la prohibida.
    const idxExploracion = cuerpoTarjetas.indexOf("const cardsPersona = hoteles.filter");
    assert.notEqual(idxExploracion, -1);
    const exploracion = cuerpoTarjetas.slice(idxExploracion);
    assert.doesNotMatch(exploracion, /gruposUnidad/, "la exploración no debe agrupar por hotelId a secas — cada entrada de hotelesUnidadVisibles ya es una oferta propia");
    assert.doesNotMatch(cuerpoTarjetas, /gruposUnidad\.get\(h\.hotelId\)/, "nunca debe existir una agrupación por hotelId a secas");
    // Recomendadas: cada card unidad se arma a partir de UNA `hUnidad`
    // (hallada por hotelId+paqueteId exactos), con `ofertas: [hUnidad]`.
    assert.match(cuerpoTarjetas, /ofertas: \[hUnidad\], paqueteId: hUnidad\.paqueteId, paqueteNombre: hUnidad\.paqueteNombre,/);
    // Resto: mismo criterio, una card por cada entrada de hotelesUnidadVisibles.
    assert.match(cuerpoTarjetas, /ofertas: \[h\], paqueteId: h\.paqueteId, paqueteNombre: h\.paqueteNombre \},/);
  });

  test("abre HotelBernaloCotizarModal (con TODAS las ofertas del hotel agrupado), que renderiza EditorPax con modeloTarifario=\"unidad\"", () => {
    assert.match(codigoVista, /<HotelBernaloCotizarModal\s*\n\s*hotelGrupo=\{modalBernalo\}/);
    // Tarjeta completa (fix): el modal recibe el MISMO enriquecimiento
    // (foto/estrellas/descripción/ubicación/Incluye/add-ons) que ya recibe
    // `HotelModal` — antes solo recibía `hotelGrupo`/`onClose`.
    const idxLlamada = codigoVista.indexOf("<HotelBernaloCotizarModal");
    const idxFinLlamada = codigoVista.indexOf("/>", idxLlamada);
    const propsLlamada = codigoVista.slice(idxLlamada, idxFinLlamada);
    assert.match(propsLlamada, /foto=\{fotosPorHotel\[modalBernalo\.hotelId\] \?\? null\}/);
    assert.match(propsLlamada, /info=\{infoPorHotel\[modalBernalo\.hotelId\]\}/);
    assert.match(propsLlamada, /descripcionPorPaquete=\{descripcionPorPaquete\}/);
    assert.match(propsLlamada, /addonsPorPaquete=\{addonsPorPaquete\}/);
    const cuerpoModal = cuerpoFuncion(fuenteVista, "function HotelBernaloCotizarModal({");
    assert.match(cuerpoModal, /modeloTarifario="unidad"/);
    assert.match(cuerpoModal, /hotelId=\{hotel\.hotelId\}/);
    assert.match(cuerpoModal, /paqueteId=\{hotel\.paqueteId\}/);
    assert.match(cuerpoModal, /categoriasDisponibles=\{hotel\.categorias\}/);
    assert.match(cuerpoModal, /alimentacionesDisponibles=\{hotel\.regimenes\}/);
  });

  test("P1-2: HotelBernaloCotizarModal identifica la oferta elegida por `paqueteId` (nunca por índice de arreglo) y solo muestra el selector cuando hay MÁS DE UNA oferta", () => {
    const cuerpoModal = cuerpoFuncion(fuenteVista, "function HotelBernaloCotizarModal({");
    assert.match(cuerpoModal, /const \[paqueteIdSel, setPaqueteIdSel\] = useState<number \| null>\(ofertas\.length === 1 \? ofertas\[0\]\.paqueteId : null\);/);
    assert.match(cuerpoModal, /const ofertaSel = paqueteIdSel != null \? \(ofertas\.find\(\(o\) => o\.paqueteId === paqueteIdSel\) \?\? null\) : null;/);
    assert.match(cuerpoModal, /ofertas\.length > 1 &&/);
    assert.match(cuerpoModal, /onClick=\{\(\) => setPaqueteIdSel\(o\.paqueteId\)\}/);
    // Cuando solo hay UNA oferta, no debe pedirse ninguna elección extra —
    // el selector de "Elige la oferta" solo aparece dentro del `ofertas.length > 1 &&`.
    const idxSelector = cuerpoModal.indexOf("ofertas.length > 1 &&");
    const idxFinSelector = cuerpoModal.indexOf(")}", idxSelector);
    assert.notEqual(idxSelector, -1);
    assert.ok(idxFinSelector > idxSelector);
  });

  test("P1-2: elegir una oferta hace que agregarBernalo/EditorPax usen SU paqueteId (identidad real, no un valor fijo)", () => {
    const cuerpoModal = cuerpoFuncion(fuenteVista, "function HotelBernaloCotizarModal({");
    assert.match(cuerpoModal, /paqueteId: hotel\.paqueteId,/);
    assert.match(cuerpoModal, /key=\{hotel\.paqueteId\}/, "EditorPax debe remontarse (key=paqueteId) al cambiar de oferta, para no arrastrar estado de la oferta anterior");
  });
});

// Conservar tarjeta completa en el motor externo (CURRENT_GOAL.md): antes de
// esta corrección, `HotelBernaloCotizarModal` solo recibía `hotelGrupo`/
// `onClose` y perdía foto/video, categoría, Adults Only/Pet friendly, badge
// de condición, descripción, ubicación, Incluye/No incluye y add-ons — todo
// contenido que `HotelModal` (su contraparte persona) sí muestra. La fuente
// de precio/disponibilidad (EditorPax/cotizarAlojamientoBernaloPublico) no
// se toca en ningún punto de estas pruebas.
describe("HotelBernaloCotizarModal — tarjeta completa: mismo contenido comercial que HotelModal, precio/disponibilidad intactos", () => {
  const cuerpoModal = cuerpoFuncion(fuenteVista, "function HotelBernaloCotizarModal({");

  test("la firma recibe foto/info/descripcionPorPaquete/addonsPorPaquete — mismos props (tipos) que ya usa HotelModal, nunca datos inventados", () => {
    const idxFirma = cuerpoModal.indexOf("hotelGrupo, foto, info, descripcionPorPaquete, addonsPorPaquete, onClose,");
    assert.notEqual(idxFirma, -1, "la firma debe declarar los 4 props nuevos, en este orden, junto a hotelGrupo/onClose");
    assert.match(cuerpoModal, /descripcionPorPaquete: Record<number, DescripcionPaqueteRaw>;/);
    assert.match(cuerpoModal, /addonsPorPaquete: Map<number, Receptivo\[\]>;/);
  });

  test("header: foto/video, Categoria (estrellas/clasificación), EtiquetasHotel (Adults Only/Pet friendly) y CondicionCompacta — igual que HotelModal, por hotelId físico (info/foto), nunca por oferta", () => {
    assert.match(cuerpoModal, /info\?\.video_url \? \(/);
    assert.match(cuerpoModal, /<BackgroundVideo url=\{info\.video_url\} overlay=\{0\} \/>/);
    assert.match(cuerpoModal, /<Image src=\{foto\} alt=\{hotelGrupo\.hotelNombre\}/);
    assert.match(cuerpoModal, /<Categoria estrellas=\{info\?\.estrellas \?\? null\} clasificacion=\{info\?\.clasificacion \?\? null\}/);
    assert.match(cuerpoModal, /<EtiquetasHotel adultsOnly=\{info\?\.adultsOnly \?\? false\} petFriendly=\{info\?\.petFriendly \?\? false\}/);
    assert.match(cuerpoModal, /info\?\.tieneCondicion !== undefined && <CondicionCompacta activo=\{info\.tieneCondicion\}/);
    // Corrección visual (Vercel Preview): la descripción ya no se renderiza
    // inline — usa el componente compartido expandible.
    assert.match(cuerpoModal, /<DescripcionHotelExpandible texto=\{info\?\.descripcion\} \/>/);
  });

  // Auditoría de "tarjeta completa en el motor externo" (ronda posterior):
  // ubicación/Incluye/add-ons se extrajeron a componentes compartidos
  // (`UbicacionHotel`/`SeccionesIncluye`/`AddonsPaquete`,
  // app/tarifario/tarjetaHotelCompartida.tsx) — reutilizados también por
  // `Resultado`/`TarjetaUnidadBusqueda` (resultados de "Buscar alojamiento").
  // El comportamiento (gateado a contenido real, sin precio/disponibilidad)
  // se prueba UNA vez ahí (pruebas/tarjetaHotelCompartida.test.ts); acá solo
  // se verifica el WIRING: que HotelBernaloCotizarModal los invoca con los
  // datos correctos.
  test("ubicación: usa el componente compartido UbicacionHotel, con info?.ubicacion del hotel FÍSICO (nunca de la oferta)", () => {
    assert.match(cuerpoModal, /<UbicacionHotel hotelNombre=\{hotelGrupo\.hotelNombre\} ubicacion=\{info\?\.ubicacion\} \/>/);
  });

  test("Incluye/No incluye y add-ons dependen de LA OFERTA elegida (hotel.paqueteId), nunca de un paqueteId fijo ni de precio/disponibilidad — usan los componentes compartidos SeccionesIncluye/AddonsPaquete", () => {
    assert.match(cuerpoModal, /const descripcionOferta = hotel \? descripcionPorPaquete\[hotel\.paqueteId\] : undefined;/);
    assert.match(cuerpoModal, /const addons: Receptivo\[\] = hotel \? \(addonsPorPaquete\.get\(hotel\.paqueteId\) \?\? \[\]\) : \[\];/);
    assert.match(cuerpoModal, /<SeccionesIncluye descripcion=\{descripcionOferta\} \/>/);
    // Corrección visual (Vercel Preview): AddonsPaquete recibe además
    // `paqueteId={hotel?.paqueteId ?? null}` — cierra la lista sola si se
    // elige otra oferta (mismo hotel, paquete distinto).
    assert.match(cuerpoModal, /<AddonsPaquete addons=\{addons\} onAbrir=\{setAddonAbierto\} paqueteId=\{hotel\?\.paqueteId \?\? null\} \/>/);
  });

  test("los add-on abren el mismo ReceptivoModal (solo información, sin fuente de precio alterna) — estado propio addonAbierto", () => {
    assert.match(cuerpoModal, /const \[addonAbierto, setAddonAbierto\] = useState<ReceptivoModalInfo \| null>\(null\);/);
    assert.match(cuerpoModal, /<ReceptivoModal receptivo=\{addonAbierto\} onClose=\{\(\) => setAddonAbierto\(null\)\} \/>/);
  });

  test("orden dentro del modal: header/ubicación -> elegir oferta -> EditorPax (motor externo) -> Incluye -> add-ons — EditorPax/cotización nunca se desplaza", () => {
    const idxUbicacion = cuerpoModal.indexOf("<UbicacionHotel");
    const idxOferta = cuerpoModal.indexOf("ofertas.length > 1 &&");
    const idxEditor = cuerpoModal.indexOf("<EditorPax");
    const idxIncluye = cuerpoModal.indexOf("<SeccionesIncluye");
    const idxAddon = cuerpoModal.indexOf("<AddonsPaquete");
    assert.notEqual(idxUbicacion, -1);
    assert.notEqual(idxOferta, -1);
    assert.notEqual(idxEditor, -1);
    assert.notEqual(idxIncluye, -1);
    assert.notEqual(idxAddon, -1);
    assert.ok(idxUbicacion < idxOferta);
    assert.ok(idxOferta < idxEditor);
    assert.ok(idxEditor < idxIncluye);
    assert.ok(idxIncluye < idxAddon);
  });

  test("precio/disponibilidad de Bernalo siguen siendo EXCLUSIVOS de EditorPax/cotizarAlojamientoBernaloPublico — los props nuevos son puramente informativos, nunca tocan agregarBernalo/cotizarBernalo", () => {
    assert.doesNotMatch(cuerpoModal, /foto\.precio|info\.precio|info\.moneda/, "foto/info no deben usarse como fuente de precio");
    assert.match(cuerpoModal, /onAgregarBernalo=\{agregarBernalo\}/);
    // agregarBernalo sigue construyendo el ítem SOLO con datos de `hotel` (la
    // oferta) y del payload que ya cotizó EditorPax — nunca con `foto`/`info`.
    const idxAgregarBernalo = cuerpoModal.indexOf("function agregarBernalo(item:");
    const idxFinAgregarBernalo = cuerpoModal.indexOf("return (", idxAgregarBernalo);
    const cuerpoAgregarBernalo = cuerpoModal.slice(idxAgregarBernalo, idxFinAgregarBernalo);
    assert.doesNotMatch(cuerpoAgregarBernalo, /\bfoto\b|\binfo\b/);
  });
});

describe("EditorPax — identidad real hasta el componente (regla 9: sin placeholders)", () => {
  test("los 2 call sites EXISTENTES (hoteles persona) no pasan modeloTarifario — comportamiento anterior intacto", () => {
    const llamadas = [...fuenteVista.matchAll(/<EditorPax\s/g)];
    // 2 originales (persona) + 1 nueva (HotelBernaloCotizarModal) = 3 en total.
    assert.equal(llamadas.length, 3);
    let sinModelo = 0;
    for (const m of llamadas) {
      const bloque = fuenteVista.slice(m.index, m.index + 400);
      if (!/modeloTarifario=/.test(bloque)) sinModelo++;
    }
    assert.equal(sinModelo, 2, "deben quedar exactamente 2 call sites sin modeloTarifario (el flujo persona intacto)");
  });

  test("hotelId/paqueteId/categoriasDisponibles/alimentacionesDisponibles son props reales, no hay ningún valor hardcodeado como \"estandar\"", () => {
    assert.doesNotMatch(codigoVista, /categoria:\s*"estandar"/i);
    assert.doesNotMatch(codigoVista, /alimentacion:\s*"estandar"/i);
    assert.match(cuerpoEditorPax, /categoriasDisponibles = \[\]/);
    assert.match(cuerpoEditorPax, /alimentacionesDisponibles = \[\]/);
  });

  test("el selector de categoría/alimentación usa las opciones REALES recibidas por prop (no una lista fija)", () => {
    assert.match(cuerpoEditorPax, /categoriasDisponibles\.map\(\(c\) => <option key=\{c\} value=\{c\}>\{c\}<\/option>\)/);
    assert.match(cuerpoEditorPax, /alimentacionesDisponibles\.map\(\(r\) => <option key=\{r\} value=\{r\}>\{r\}<\/option>\)/);
  });
});

describe("EditorPax — el selector de habitaciones ya no depende de un PVP inexistente para Bernalo", () => {
  test("el conteo de habitaciones/hayHabBernalo se calcula independiente de `pvp` para Bernalo", () => {
    assert.match(cuerpoEditorPax, /const totalHabBernalo = ACOM_ROOMS\.reduce\(\(s, a\) => s \+ \(habs\[a\] \?\? 0\), 0\);/);
    assert.match(cuerpoEditorPax, /const hayHabBernalo = totalHabBernalo > 0;/);
  });

  test("el input de conteo por tipo de habitación queda HABILITADO en modo Bernalo aunque pvp[a] sea undefined", () => {
    assert.match(cuerpoEditorPax, /const habilitada = esBernalo \|\| pvp\[a\] != null;/);
    assert.match(cuerpoEditorPax, /disabled=\{!habilitada\}/);
  });
});

describe("EditorPax — sin 'Agregar al carrito' en modo Bernalo (regla 19)", () => {
  test("la rama esBernalo del botón final nunca llama onAgregar/agregar()", () => {
    // Hay DOS ramas `esBernalo ? (` en el componente (el bloque de menores
    // por habitación y la barra de acción final) — la del botón es la
    // ÚLTIMA.
    const idxBoton = cuerpoEditorPax.lastIndexOf("esBernalo ? (");
    const idxFinBoton = cuerpoEditorPax.indexOf(") : (", idxBoton);
    const ramaBernalo = cuerpoEditorPax.slice(idxBoton, idxFinBoton);
    assert.doesNotMatch(ramaBernalo, /onClick=\{agregar\}/);
    assert.doesNotMatch(ramaBernalo, /onAgregar\(/);
    assert.match(ramaBernalo, /onClick=\{cotizarBernalo\}/);
  });

  test("cotizarBernalo llama cotizarAlojamientoBernaloPublico (nunca crearCotizacionCarrito/checkout)", () => {
    assert.match(cuerpoEditorPax, /await cotizarAlojamientoBernaloPublico\(\{/);
    assert.doesNotMatch(codigoVista, /crearCotizacionCarrito|crearSolicitudReserva/);
  });

  test("el total mostrado (pvp) es la autoridad; el promedio por viajero se etiqueta como referencia (regla 18)", () => {
    assert.match(cuerpoEditorPax, /Total solicitado/);
    assert.match(cuerpoEditorPax, /promedioPorViajero/);
    assert.match(cuerpoEditorPax, /por viajero \(referencia\)/);
  });
});

describe("EditorPax — cambiar/quitar una habitación limpia sus propias edades (regla 5, sigue vigente en 3E)", () => {
  test("setHab sincroniza edadesPorHabitacion con los ids vigentes, solo cuando esBernalo", () => {
    assert.match(cuerpoEditorPax, /setEdadesPorHabitacion\(\(ep\) => sincronizarHabitaciones\(ep, idsHabitacionesPorConteo\(next\)\)\)/);
  });
});

describe("HotelBernaloCotizarModal — B1.18: configuración incompleta muestra mensaje genérico, nunca monta el editor", () => {
  const cuerpoModal = cuerpoFuncion(fuenteVista, "function HotelBernaloCotizarModal({");

  test("gatea por categorias/regimenes vacíos ANTES de renderizar EditorPax", () => {
    assert.match(cuerpoModal, /hotel\.categorias\.length === 0 \|\| hotel\.regimenes\.length === 0/);
    assert.match(cuerpoModal, /configuracionIncompleta \?/);
  });

  test("pasa `salidas` real al EditorPax (identidad de la salida, nunca inventada)", () => {
    assert.match(cuerpoModal, /salidas=\{hotel\.salidas\}/);
  });
});

describe("EditorPax — B1.17: sin texto libre para categoría/alimentación (auditoría DeepSeek)", () => {
  test("ya no existe ningún <input type=\"text\"> de respaldo para categoría/alimentación en el bloque Bernalo", () => {
    assert.doesNotMatch(cuerpoEditorPax, /type="text" value=\{categoriaSel\}/);
    assert.doesNotMatch(cuerpoEditorPax, /type="text" value=\{alimentacionSel\}/);
    assert.doesNotMatch(cuerpoEditorPax, /placeholder="Categoría"/);
    assert.doesNotMatch(cuerpoEditorPax, /placeholder="Alimentación"/);
  });

  test("los <select> de categoría/alimentación quedan deshabilitados cuando no hay opciones reales (nunca se abren a adivinar)", () => {
    assert.match(cuerpoEditorPax, /disabled=\{!categoriasDisponibles\.length\}/);
    assert.match(cuerpoEditorPax, /disabled=\{!alimentacionesDisponibles\.length\}/);
  });
});

describe("EditorPax — A1.2/A1.3/A1.6: selección de salida, nunca [0]", () => {
  test("con 0 salidas, se muestran los inputs de fecha manual (porción terrestre)", () => {
    assert.match(cuerpoEditorPax, /salidas\.length === 0 \?/);
    assert.match(cuerpoEditorPax, /id=\{`\$\{idBase\}-fecha-ida`\}/);
  });

  test("con 1 salida, se autoselecciona y se muestra como información (no editable)", () => {
    assert.match(cuerpoEditorPax, /salidas\.length === 1 \?/);
  });

  test("con más de 1 salida, la UI exige clic explícito — nunca autocompleta ni toma la primera", () => {
    assert.match(cuerpoEditorPax, /salidas\.length > 1 &&/);
    assert.match(cuerpoEditorPax, /onClick=\{\(\) => \{ setSalidaElegidaKey\(key\); setResultadoCotizacion\(null\); \}\}/);
  });

  test("el payload de cotización envía `salida` como identidad {tipo,id}/sin_vuelo — nunca fechaIda/fechaRegreso sueltos", () => {
    assert.match(cuerpoEditorPax, /salida: salidaPayload/);
    assert.doesNotMatch(cuerpoEditorPax, /fechaIda: fechaIdaBernalo, fechaRegreso: fechaRegresoBernalo,\s*\n\s*habitaciones: payloadBernalo/);
  });

  test("salidaPayload nunca se arma indexando `salidas[0]` de forma incondicional (solo dentro de la rama length===1)", () => {
    const idxDecl = cuerpoEditorPax.indexOf("const salidaPayload");
    assert.notEqual(idxDecl, -1);
    // La única ocurrencia de `salidas[0]` en todo el componente debe estar
    // dentro de la derivación `salidaElegidaKeyEfectiva` (autoselección
    // legítima cuando length===1) o en el bloque informativo JSX — nunca en
    // `salidaPayload` mismo, que siempre pasa por `salidaElegida` (buscado
    // por identidad).
    assert.doesNotMatch(cuerpoEditorPax.slice(idxDecl, idxDecl + 400), /salidas\[0\]/);
  });
});

describe("TarifarioPublic.tsx / page.tsx — hilo completo de props hasta VistaBooking", () => {
  test("TarifarioPublic recibe hotelesBernalo y aplica el MISMO filtro de texto/categoría/alimentación que a los hoteles persona antes de pasarlo a VistaBooking (búsqueda unificada)", () => {
    assert.match(fuentePublic, /hotelesBernalo = \[\]/);
    assert.match(fuentePublic, /const hotelesBernaloFiltrados = useMemo\(/);
    assert.match(fuentePublic, /<VistaBooking[^>]*hotelesBernalo=\{fAcom \? \[\] : hotelesBernaloFiltrados\}/);
  });

  test("las opciones de categoría/alimentación del filtro incluyen las de hotelesBernalo, no solo las de `filas`", () => {
    const idxCats = fuentePublic.indexOf("const cats = useMemo(");
    const bloque = fuentePublic.slice(idxCats, idxCats + 400);
    assert.match(bloque, /hotelesBernalo\.flatMap\(\(h\) => h\.categorias\)/);
    const idxRegs = fuentePublic.indexOf("const regs = useMemo(");
    const bloqueRegs = fuentePublic.slice(idxRegs, idxRegs + 400);
    assert.match(bloqueRegs, /hotelesBernalo\.flatMap\(\(h\) => h\.regimenes\)/);
  });

  test("page.tsx carga el descubrimiento Bernalo en PARALELO (Promise.all) con la carga principal, nunca la bloquea", () => {
    assert.match(fuentePage, /Promise\.all\(\[/);
    assert.match(fuentePage, /cargarHotelesBernaloDescubiertos\(\)/);
  });

  test("un fallo en el descubrimiento Bernalo degrada a lista vacía, nunca rompe la página (best-effort)", () => {
    assert.match(fuentePage, /\.catch\(\(\) => \(\{ ok: false as const/);
    assert.match(fuentePage, /const hotelesBernalo = resultadoBernalo\.ok \? resultadoBernalo\.hoteles : \[\];/);
  });

  // P1 (ronda 2): page.tsx lee el canal separado `hotelIdsUnidadAutoritativos`
  // del mismo resultado de `cargarHotelesBernaloDescubiertos()` y lo pasa
  // TAL CUAL a TarifarioPublic — nunca derivado de `hotelesBernalo` (que sí
  // se filtra más abajo, dentro de TarifarioPublic).
  test("P1 (ronda 2): page.tsx propaga hotelIdsUnidadAutoritativos del resultado de cargarHotelesBernaloDescubiertos hacia TarifarioPublic, sin filtrarlo", () => {
    assert.match(fuentePage, /const hotelIdsUnidadAutoritativos = resultadoBernalo\.ok \? resultadoBernalo\.hotelIdsUnidadAutoritativos : \[\];/);
    const idxTP = fuentePage.indexOf("<TarifarioPublic");
    const idxFinTP = fuentePage.indexOf("/>", idxTP);
    assert.notEqual(idxTP, -1);
    const propsTP = fuentePage.slice(idxTP, idxFinTP);
    assert.match(propsTP, /hotelIdsUnidadAutoritativos=\{hotelIdsUnidadAutoritativos\}/);
  });

  // P2 (hallazgo confirmado): la búsqueda de texto para hoteles unidad solo
  // comparaba contra el nombre del hotel — un cliente buscando por ciudad/
  // destino ("Cartagena", "San Andrés") no encontraba hoteles unidad de esa
  // ciudad aunque sí encontrara hoteles persona (que sí comparan destino vía
  // `coincideFiltro`).
  test("P2: la búsqueda de texto para hoteles unidad compara nombre DE HOTEL Y destino/ciudad — no solo el nombre", () => {
    const idxFiltrados = fuentePublic.indexOf("const hotelesBernaloFiltrados = useMemo(");
    const idxFin = fuentePublic.indexOf("const hayFiltro =", idxFiltrados);
    const cuerpo = fuentePublic.slice(idxFiltrados, idxFin);
    assert.match(cuerpo, /const hay = `\$\{h\.hotelNombre\} \$\{h\.destinoNombre \?\? ""\}`\.toLowerCase\(\);/);
    assert.match(cuerpo, /if \(!hay\.includes\(q\.trim\(\)\.toLowerCase\(\)\)\) return false;/);
  });

  // P2 (hallazgo confirmado): Pet friendly/Adults Only ocultaban TODOS los
  // hoteles unidad incondicionalmente ("no están configurados hoy para este
  // modelo") — un texto falso, porque esos son atributos REALES del hotel
  // (`hoteles.pet_friendly`/`adults_only`), no del modelo tarifario.
  test("P2: los filtros Pet friendly/Adults Only para hoteles unidad usan el valor REAL de infoPorHotel — nunca ocultan el catálogo unidad completo por defecto", () => {
    assert.doesNotMatch(codigoVista, /no están configurados hoy para este modelo/);
    assert.match(codigoVista, /if \(soloPetFriendly\) arr = arr\.filter\(\(h\) => infoPorHotel\[h\.hotelId\]\?\.petFriendly === true\);/);
    assert.match(codigoVista, /if \(soloAdultsOnly\) arr = arr\.filter\(\(h\) => infoPorHotel\[h\.hotelId\]\?\.adultsOnly === true\);/);
  });

  // P2 (hallazgo confirmado): `fotosPorHotel`/`infoPorHotel` solo se
  // armaban a partir de `filasVisibles` (hoteles persona) — un hotel unidad
  // nunca tenía foto/estrellas/badges reales aunque el hotel SÍ los tuviera
  // configurados en el catálogo.
  test("P2: page.tsx carga cargarInfoHotelesBernalo con los hotelId de unidad y fusiona el resultado en fotosPorHotel/infoPorHotel antes de pasarlos a TarifarioPublic", () => {
    assert.match(fuentePage, /cargarInfoHotelesBernalo/);
    assert.match(fuentePage, /const hotelIdsBernalo = \[\.\.\.new Set\(hotelesBernalo\.map\(\(h\) => h\.hotelId\)\)\];/);
    assert.match(fuentePage, /const fotosPorHotel = \{ \.\.\.fotosPorHotelLegacy, \.\.\.resultadoInfoBernalo\.fotosPorHotel \};/);
    assert.match(fuentePage, /const infoPorHotel = \{ \.\.\.infoPorHotelLegacy, \.\.\.resultadoInfoBernalo\.infoPorHotel \};/);
  });

  // P5 (hallazgo confirmado, validación final): `cargarInfoHotelesBernalo`
  // ya NO devuelve un `ok` único para las dos consultas — cada una
  // (`errorFotos`/`errorInfo`) es independiente, así que el merge en
  // page.tsx es SIEMPRE incondicional (el loader ya entrega `{}` en la
  // pieza que falló, nunca ausente) — un fallo de fotos no debe borrar la
  // metadata que sí llegó bien, y viceversa.
  test("P2/P5: el merge de fotosPorHotel/infoPorHotel es incondicional — un fallo en una consulta (fotos o metadata) nunca descarta la otra que sí resolvió", () => {
    assert.doesNotMatch(fuentePage, /resultadoInfoBernalo\.ok/);
    // Auditoría posterior: `cargarInfoHotelesBernalo` ahora se lanza junto a
    // `cargarDescripcionPaquetesBernalo` en un único `Promise.all` (ver
    // pruebas/descripcionPaquetesBernaloWiring.test.ts, guarda de
    // concurrencia) — el ancla de arranque del bloque es esa desestructuración.
    const idxCall = fuentePage.indexOf("const [resultadoInfoBernalo, resultadoDescripcionBernalo] = await Promise.all([");
    const idxFin = fuentePage.indexOf("const infoPorHotel =", idxCall);
    assert.notEqual(idxCall, -1);
    assert.notEqual(idxFin, -1);
    const bloque = fuentePage.slice(idxCall, idxFin);
    assert.match(bloque, /if \(resultadoInfoBernalo\.errorFotos\)/);
    assert.match(bloque, /if \(resultadoInfoBernalo\.errorInfo\)/);
  });
});

// P3 (hallazgo confirmado): los destinos del selector de Paquetes
// (`destinosBloqueo`) salían SOLO de `salidasBloqueo` (hoteles persona) — un
// destino que solo existe en un hotel por unidad quedaba inalcanzable desde
// el dropdown, aunque `hotelesUnidadVisibles` SÍ sepa filtrar por
// `destinoSel` cuando coincide. Se agregan los destinos de `hotelesBernalo`
// tipo "bloqueo", deduplicados y ordenados — nunca se inventa origen/salida
// aérea.
//
// ⚠️ Hallazgo confirmado (validación real, ronda 2): una corrección previa
// aplicó el MISMO tratamiento a `destinos` (el que alimenta el mini-motor
// legacy `BuscadorBooking`, para Porción terrestre) — pero ese buscador solo
// sabe devolver hoteles PERSONA (`cotizarPorFechas`, 100% legacy). Anunciar
// ahí un destino "solo unidad" era una promesa vacía: se elegía, se buscaba
// por fechas, y el motor no tenía nada que devolver. Se revirtió: `destinos`
// (renombrado `destinosBuscador`) vuelve a ser SOLO legacy; los destinos
// unidad siguen disponibles donde SÍ hay un filtro real que los usa
// (`destinosBloqueo`, que filtra `hotelesUnidadVisibles` reactivamente, sin
// ningún buscador/consulta de por medio).
describe("VistaBooking.tsx — P3: destinos de hoteles unidad SOLO en el filtro real de tarjetas (destinosBloqueo) — nunca en el buscador legacy", () => {
  test("destinosBloqueo agrega los destinos de ofertas unidad tipo 'bloqueo' — deduplicados con `new Set` y ordenados con `.sort()`, SIN filtrar por origenSel", () => {
    const idxDecl = fuenteVista.indexOf("const destinosBloqueo = useMemo(() => {");
    const idxFin = fuenteVista.indexOf("}, [salidasBloqueo, origenSel, hotelesBernalo]);", idxDecl);
    assert.notEqual(idxDecl, -1);
    assert.notEqual(idxFin, -1);
    const cuerpo = fuenteVista.slice(idxDecl, idxFin);
    assert.match(cuerpo, /hotelesBernalo\.filter\(\(h\) => h\.tipo === "bloqueo" && h\.destinoNombre\)\.map\(\(h\) => h\.destinoNombre as string\)/);
    assert.match(cuerpo, /return \[\.\.\.new Set\(\[\.\.\.legacy, \.\.\.unidad\]\)\]\.filter\(Boolean\)\.sort\(\);/);
    // Los destinos unidad NO deben depender de `origenSel` — un hotel unidad
    // no tiene concepto de origen/salida aérea (esa integración no existe
    // todavía).
    const idxUnidad = cuerpo.indexOf("const unidad =");
    const idxFinUnidad = cuerpo.indexOf(";", idxUnidad);
    const lineaUnidad = cuerpo.slice(idxUnidad, idxFinUnidad);
    assert.doesNotMatch(lineaUnidad, /origenSel/);
  });

  test("un destino que SOLO existe en un hotel unidad aparece en destinosBloqueo (el filtro REAL de tarjetas) y, al seleccionarlo, hotelesUnidadVisibles mantiene la tarjeta visible", () => {
    // El filtro de destino sobre la grilla unidad (`hotelesUnidadVisibles`)
    // compara contra `h.destinoNombre` — un campo que viene ÍNTEGRAMENTE de
    // `hotelesBernalo` (armado_paquetes.destino_id), nunca de `filas`. Así,
    // una vez que `destinosBloqueo` ofrece la opción (test de arriba), elegir
    // ese destino filtra `hotelesUnidadVisibles` sin que la lista dependa en
    // ningún punto de `filas`/`hoteles` (persona) — nunca queda vacía por
    // depender de datos legacy que no existen para ese destino.
    const idxDecl = fuenteVista.indexOf("const hotelesUnidadVisibles = useMemo(() => {");
    const idxFin = fuenteVista.indexOf("}, [hotelesBernalo, sub, destinoSel, destinoPorcionBusqueda, soloPetFriendly, soloAdultsOnly, infoPorHotel]);", idxDecl);
    assert.notEqual(idxDecl, -1);
    assert.notEqual(idxFin, -1);
    const cuerpo = fuenteVista.slice(idxDecl, idxFin);
    assert.match(cuerpo, /if \(sub === "bloqueo" && destinoSel\) arr = arr\.filter\(\(h\) => \(h\.destinoNombre \?\? ""\) === destinoSel\);/);
    assert.doesNotMatch(cuerpo, /\bfilas\b/, "el filtro de destino de la grilla unidad nunca debe depender de `filas` (legacy)");
  });

  test("hay UNA sola lista de destinos de Porción terrestre: la vieja lista sólo-persona del motor ya no existe", () => {
    // La lista propia del mini-motor (`destinosBuscador`) se eliminó: un
    // destino que sólo existía por hoteles unidad quedaba fuera de su
    // desplegable, así que el motor —que sí sabe resolverlos— no se podía
    // invocar para ese destino desde la UI (ver
    // `pruebas/destinosPorcionPublica.test.ts`).
    assert.doesNotMatch(fuenteVista, /destinosBuscador/);
    assert.match(fuenteVista, /const destinosPorcion = useMemo\(/);
    assert.match(fuenteVista, /destinosPorcionPublica\(filas, hotelesBernalo\)/);
  });

  test("BuscadorBooking recibe `destinosPorcion` — la UNIÓN real (persona + unidad) — y no una lista propia", () => {
    // El mini-motor comunica hacia arriba el estado de la búsqueda
    // (`onBusqueda`); `sugerenciaPedida` es el canal de vuelta (las fechas
    // alternativas que ofrece en el estado vacío se vuelven a pedir desde acá).
    assert.match(
      fuenteVista,
      /<BuscadorBooking destinos=\{destinosPorcion\} onBusqueda=\{setBusquedaPorcion\} sugerenciaPedida=\{sugerenciaPedida\} \/>/
    );
    // Ya no debe existir ninguna variable `destinos` (el nombre viejo,
    // ambiguo sobre si mezclaba o no unidad) — solo `destinosBloqueo`/
    // `destinosPorcion`/`destinosServicios`, cada uno con su alcance claro.
    assert.doesNotMatch(fuenteVista, /const destinos = useMemo/);
    // Esa lista es la ÚNICA que elige destino en Porción terrestre: se
    // consume en el buscador real, y ya no se pinta en ningún otro
    // desplegable de la vista (el selector de exploración se eliminó).
    assert.equal(
      [...fuenteVista.matchAll(/destinosPorcion\.map\(/g)].length,
      0,
      "la lista de destinos ya no se pinta en la grilla — solo la consume el buscador"
    );
    assert.equal(
      [...fuenteVista.matchAll(/destinos=\{destinosPorcion\}/g)].length,
      1,
      "el buscador real es el único consumidor de la lista de destinos"
    );
  });

  // Residual confirmado (validación real, ronda 3): Porción terrestre no
  // tenía NINGÚN selector de destino sobre su propia grilla — a diferencia
  // de Bloqueo (`destinoSel`/`destinosBloqueo`), los destinos unidad `tipo:
  // "porcion_terrestre"` quedaban fuera de cualquier filtro real.
  // `destinosPorcion` + un selector de exploración con estado PROPIO cerraron
  // ese hueco.
  //
  // ⚠️ HALLAZGO 1 (invierte ese comportamiento): ese selector YA NO acotaba la
  // grilla. Con recomendados por paquete, filtrar los candidatos por él hacía
  // que ELEGIR un destino sin pulsar Buscar recortara el universo (los
  // recomendados de paquetes de otros destinos desaparecían antes de que
  // existiera una búsqueda), contra la regla del estado global inicial (top 2
  // de CADA paquete). El único destino que acota la grilla de Porción terrestre
  // es el de una búsqueda EJECUTADA (`destinoPorcionBusqueda`).
  //
  // ⚠️ CORRECCIÓN FINAL: el selector se ELIMINÓ. Sin poder acotar (eso viola la
  // regla del universo), un `<select>` que solo cambia estado sin producir
  // efecto no tiene razón de existir. Lo que sigue siendo cierto se conserva y
  // se verifica: `destinosPorcion` es la unión persona+unidad y alimenta el
  // selector REAL (el de `BuscadorBooking`); ningún candidato se acota por un
  // control de exploración.
  describe("destinosPorcion — alimenta el buscador REAL; la grilla no se acota por ningún control de exploración", () => {
    test("destinosPorcion es la unión persona + unidad y delega en la función pura (una sola definición del criterio)", () => {
      assert.match(
        fuenteVista,
        /const destinosPorcion = useMemo\(\s*\n\s*\(\) => destinosPorcionPublica\(filas, hotelesBernalo\),\s*\n\s*\[filas, hotelesBernalo\]\s*\n\s*\);/
      );
      // El criterio (qué fila cuenta como destino de porción, dedup y orden) NO
      // se re-implementa acá: vive en `destinosPorcionPublica`, donde se prueba
      // con catálogo de fixture.
      const idxDecl = fuenteVista.indexOf("const destinosPorcion = useMemo(");
      const idxFin = fuenteVista.indexOf(");", idxDecl);
      assert.notEqual(idxDecl, -1);
      assert.notEqual(idxFin, -1);
      const cuerpo = fuenteVista.slice(idxDecl, idxFin + 2);
      assert.doesNotMatch(cuerpo, /\.filter\(/);
      assert.doesNotMatch(cuerpo, /new Set/);
      // La lista alimenta el selector REAL: el del buscador de Porción
      // terrestre, que es quien ejecuta la búsqueda.
      assert.match(fuenteVista, /<BuscadorBooking destinos=\{destinosPorcion\} onBusqueda=\{setBusquedaPorcion\}/);
    });

    test("el selector de exploración de destino se eliminó por completo: sin estado, sin setter y sin control en la barra", () => {
      assert.doesNotMatch(fuenteVista, /destinoPorcionSel/, "no queda el estado del selector eliminado");
      assert.doesNotMatch(fuenteVista, /setDestinoPorcionSel/, "no queda su setter");
      // Un `useState` con ese rol tampoco puede sobrevivir con otro nombre: la
      // barra de exploración de Porción no tiene ningún desplegable de destino.
      const idxBarra = codigoVista.indexOf('flex flex-wrap items-center gap-3 text-xs text-gray-600');
      assert.ok(idxBarra > -1);
      const barra = codigoVista.slice(idxBarra, idxBarra + 600);
      assert.doesNotMatch(barra, /<select/, "la barra de exploración no puede tener desplegables");
      // El estado de Bloqueo queda intacto (no se tocó esa pestaña).
      assert.match(codigoVista, /<select value=\{destinoSel\}/);
    });

    test("el destino que acota la grilla de Porción es UN valor DERIVADO y sale EXCLUSIVAMENTE de la búsqueda ejecutada — nunca de un control de exploración", () => {
      // Hallazgo 1: antes valía `busquedaPorcion ? busquedaPorcion.destino :
      // <selector de exploración>` ("destino efectivo"), así que elegir un
      // destino sin pulsar Buscar ya recortaba el universo de candidatos.
      // Ahora, sin búsqueda vigente, el valor es "" y no acota NADA.
      assert.match(
        fuenteVista,
        /const destinoPorcionBusqueda = busquedaPorcion \? busquedaPorcion\.destino : "";/
      );
      const derivaciones = [...fuenteVista.matchAll(/const destinoPorcionBusqueda =/g)];
      assert.equal(derivaciones.length, 1, "una sola derivación del destino que acota");
      assert.match(codigoVista, /const destinoActivoSub = sub === "bloqueo"\s*\n\s*\? destinoSel\s*\n\s*: sub === "porcion_terrestre"\s*\n\s*\? destinoPorcionBusqueda\s*\n\s*: "";/);
    });

    test("NINGÚN candidato (persona ni unidad) menciona destinoPorcionSel: el selector no puede volver a acotar el universo", () => {
      // Sobre el código SIN comentarios: los comentarios de estos memos
      // explican la historia (`destinoPorcionSel` fue el filtro), y lo que se
      // verifica acá es el CÓDIGO.
      const idxHoteles = codigoVista.indexOf("const hoteles = useMemo<HotelCard[]>(() => {");
      const idxFinHoteles = codigoVista.indexOf("const hotelesUnidadVisibles = useMemo(() => {", idxHoteles);
      const idxFinUnidad = codigoVista.indexOf("}, [hotelesBernalo, sub, destinoSel, destinoPorcionBusqueda, soloPetFriendly, soloAdultsOnly, infoPorHotel]);", idxFinHoteles);
      assert.ok(idxHoteles > -1 && idxFinHoteles > idxHoteles && idxFinUnidad > idxFinHoteles, "no se encontraron los dos memos de candidatos");
      const memoHoteles = codigoVista.slice(idxHoteles, idxFinHoteles);
      const memoUnidad = codigoVista.slice(idxFinHoteles, idxFinUnidad);
      assert.doesNotMatch(memoHoteles, /destinoPorcionSel/, "los candidatos persona no pueden acotarse por el selector de exploración");
      assert.doesNotMatch(memoUnidad, /destinoPorcionSel/, "los candidatos unidad no pueden acotarse por el selector de exploración");
    });

    test("el filtro de destino de Porción terrestre en `hoteles` (persona) está gateado por mod === 'porcion_terrestre', nunca por sub === 'bloqueo'", () => {
      assert.match(codigoVista, /if \(mod === "porcion_terrestre" && destinoPorcionBusqueda && \(f\.destino_nombre \?\? ""\) !== destinoPorcionBusqueda\) return false;/);
    });

    test("hotelesUnidadVisibles filtra por el destino BUSCADO solo cuando sub === 'porcion_terrestre' — igual patrón que destinoSel/bloqueo", () => {
      const idxDecl = fuenteVista.indexOf("const hotelesUnidadVisibles = useMemo(() => {");
      const idxFin = fuenteVista.indexOf("}, [hotelesBernalo, sub, destinoSel, destinoPorcionBusqueda, soloPetFriendly, soloAdultsOnly, infoPorHotel]);", idxDecl);
      assert.notEqual(idxDecl, -1);
      assert.notEqual(idxFin, -1);
      const cuerpo = fuenteVista.slice(idxDecl, idxFin);
      assert.match(cuerpo, /if \(sub === "porcion_terrestre" && destinoPorcionBusqueda\) arr = arr\.filter\(\(h\) => \(h\.destinoNombre \?\? ""\) === destinoPorcionBusqueda\);/);
    });

    test("el selector de destino de la grilla de Porción NO existe: la única forma de elegir destino es el buscador real de arriba", () => {
      // Era un `<select>` que solo podía ocultar tarjetas (violando la regla del
      // estado global inicial), así que se eliminó en vez de dejarlo inerte: un
      // control visible que cambia estado sin producir efecto es un defecto.
      assert.equal(fuenteVista.indexOf("sub === \"porcion_terrestre\" && !enBusquedaPorcion && destinosPorcion.length > 0 && ("), -1, "no debe quedar el bloque JSX del selector eliminado");
      assert.doesNotMatch(fuenteVista, /destinosPorcion\.map\(/, "la lista de destinos ya no se pinta en la grilla — solo la consume el buscador");
      // Y el buscador real (que sí ejecuta la búsqueda) sigue recibiéndola.
      assert.match(fuenteVista, /<BuscadorBooking destinos=\{destinosPorcion\}/);
      // La vista no gana ninguna llamada al motor por su cuenta en la barra de
      // filtros: las que existen son de las tarjetas (revalidar al agregar al
      // carrito), nunca de un control de exploración.
      const idxHoteles = codigoVista.indexOf("const hoteles = useMemo<HotelCard[]>(() => {");
      assert.doesNotMatch(codigoVista.slice(0, idxHoteles), /buscarHoteles\(|cotizarPorFechas\(/, "ningún control de estado de la vista puede disparar el motor");
    });

    // Escenarios explícitos pedidos — estructurales (wiring), ya que este
    // componente no es ejecutable bajo `node --test` (JSX/Next): cada uno
    // verifica la pieza de código que GARANTIZA el comportamiento descrito.
    test("catálogo solo-unidad de Porción terrestre: destinosPorcion no exige NINGUNA fila persona — un destino que solo existe en hotelesBernalo aparece igual", () => {
      // Antes esto sólo se podía verificar por la FORMA del memo (dos ramas,
      // `legacy` y `unidad`, calculadas por separado). Ahora la unión es una
      // función pura, así que el escenario se corre DE VERDAD con el catálogo
      // del caso: CERO filas persona y un hotel unidad en CARTAGENA.
      assert.deepEqual(
        destinosPorcionPublica([], [{ tipo: "porcion_terrestre", destinoNombre: "CARTAGENA", destinoId: 6 }]),
        [{ id: 6, nombre: "CARTAGENA" }],
        "un destino que sólo existe por hoteles unidad tiene que seguir apareciendo en el selector"
      );
      // Y `VistaBooking` consume ESA función — no una segunda copia del criterio
      // que pueda divergir de la que se acaba de probar.
      assert.match(fuenteVista, /destinosPorcionPublica\(filas, hotelesBernalo\)/);
    });

    test("un destino exclusivamente unidad entra al universo de la búsqueda: el filtro de hotelesUnidadVisibles compara SOLO h.destinoNombre (de hotelesBernalo), nunca contra `hoteles`/`filas` (persona)", () => {
      const idxDecl = fuenteVista.indexOf("const hotelesUnidadVisibles = useMemo(() => {");
      const idxFin = fuenteVista.indexOf("}, [hotelesBernalo, sub, destinoSel, destinoPorcionBusqueda, soloPetFriendly, soloAdultsOnly, infoPorHotel]);", idxDecl);
      const cuerpo = fuenteVista.slice(idxDecl, idxFin);
      assert.match(cuerpo, /let arr = hotelesBernalo\.filter\(\(h\) => h\.tipo === sub\);/);
      assert.match(cuerpo, /if \(sub === "porcion_terrestre" && destinoPorcionBusqueda\) arr = arr\.filter\(\(h\) => \(h\.destinoNombre \?\? ""\) === destinoPorcionBusqueda\);/);
      assert.doesNotMatch(cuerpo, /\bfilas\b|\bhoteles\b/, "el filtro de la grilla unidad nunca debe depender de datos persona");
    });

    test("dos destinos unidad distintos: el filtro del destino BUSCADO es una comparación de IGUALDAD exacta — buscar uno excluye estrictamente el otro", () => {
      // `(h.destinoNombre ?? "") === destinoPorcionBusqueda` es una comparación
      // de IGUALDAD (no `.includes`/prefijo/substring) — con el destino buscado
      // fijo en "A", una oferta con destinoNombre "B" evalúa false y se
      // excluye, mientras que CUALQUIER oferta con destinoNombre "A" (sin
      // importar cuántas haya) evalúa true y permanece. Nunca se excluyen
      // "de más" ni "de menos".
      assert.match(codigoVista, /if \(sub === "porcion_terrestre" && destinoPorcionBusqueda\) arr = arr\.filter\(\(h\) => \(h\.destinoNombre \?\? ""\) === destinoPorcionBusqueda\);/);
    });

    test("destino compartido persona/unidad: hoteles (persona) y hotelesUnidadVisibles (unidad) filtran por el MISMO valor buscado — ambos modelos responden a la misma búsqueda, nunca dos estados distintos", () => {
      // Un único valor derivado alimenta AMBOS filtros — el de `hoteles`
      // (mod === "porcion_terrestre") y el de `hotelesUnidadVisibles`
      // (sub === "porcion_terrestre") — así que buscar un destino presente en
      // ambas fuentes deja visibles las tarjetas de los dos modelos a la vez.
      const usosEnHoteles = [...codigoVista.matchAll(/mod === "porcion_terrestre" && destinoPorcionBusqueda/g)];
      const usosEnUnidadVisibles = [...codigoVista.matchAll(/sub === "porcion_terrestre" && destinoPorcionBusqueda/g)];
      assert.equal(usosEnHoteles.length, 1, "hoteles (persona) debe filtrar por el destino buscado exactamente una vez");
      assert.equal(usosEnUnidadVisibles.length, 1, "hotelesUnidadVisibles debe filtrar por el destino buscado exactamente una vez");
      // Ningún estado de destino de Porción sobrevive (paralelo o no): el
      // selector se eliminó por completo, así que no puede reaparecer con otro
      // nombre alimentando la grilla.
      const declaraciones = [...fuenteVista.matchAll(/const \[destinoPorcion\w*,/g)];
      assert.equal(declaraciones.length, 0, "no debe quedar ningún estado de destino de Porción terrestre");
      assert.doesNotMatch(fuenteVista, /destinoPorcionSel/);
    });

    test("destino persona continúa funcionando exactamente igual: el filtro de mod==='porcion_terrestre' en `hoteles` es aditivo (misma condición general del filter, no reemplaza ninguna lógica previa de bloqueo)", () => {
      const idxHoteles = fuenteVista.indexOf("const hoteles = useMemo<HotelCard[]>(() => {");
      const idxFinHoteles = fuenteVista.indexOf("const conHotel = filas.filter", idxHoteles);
      assert.notEqual(idxHoteles, -1);
      // El filtro de bloqueo (cupos/origen/destino/salida) sigue intacto,
      // gateado por `mod === "bloqueo"` — el filtro de porción terrestre no lo
      // toca ni lo reemplaza, solo agrega su propia rama.
      assert.match(codigoVista, /if \(mod === "bloqueo" && f\.bloqueo_id != null\) \{/);
      assert.match(codigoVista, /if \(mod === "porcion_terrestre" && destinoPorcionBusqueda && \(f\.destino_nombre \?\? ""\) !== destinoPorcionBusqueda\) return false;/);
    });
  });
});
