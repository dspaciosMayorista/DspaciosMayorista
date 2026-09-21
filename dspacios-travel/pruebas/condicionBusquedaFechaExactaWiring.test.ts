import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Corrección: en modo BÚSQUEDA la condición/política de una oferta persona
// debe salir de `BusquedaResultado.condicion` — ya calculada por el motor
// para la fecha EXACTA que el usuario buscó (`condicionHotelFechas` sobre
// [fechaIda, fechaRegreso) reales) — NUNCA del cálculo de EXPLORACIÓN
// (`condicionPorOferta`/`politicaPorOferta`, que agrega rangos GENÉRICOS del
// paquete en resumen.ts: salidas reales de bloqueo o ventana de porción
// terrestre, sin relación con lo que el usuario realmente buscó).
//
// Se combina con `restriccionPorPaquete` (SOLO el paquete, un valor de
// catálogo sin fecha) para no perder la restricción comercial propia del
// paquete — pero esa combinación nunca puede contaminarse con OTRAS
// salidas/fechas del mismo paquete, porque `restriccionPorPaquete` no
// depende de fecha en absoluto (es uniforme para todos sus hoteles).
//
// Verificación por inspección de fuente (sin ejecutar React) — el cálculo en
// sí (`condicionHotelFechas`) ya está probado con ejecución real en
// pruebas/liquidacionHotel.test.ts / pruebas/condicionHotelFechas.test.ts;
// esto solo confirma el CABLEADO de cuál fuente alimenta cuál rama.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const vistaBooking = leer("app/tarifario/VistaBooking.tsx");
const resumen = leer("lib/tarifario/resumen.ts");
const tarifarioPublic = leer("app/tarifario/TarifarioPublic.tsx");
const tarifarioPage = leer("app/tarifario/page.tsx");
const cotizar = leer("lib/reservar/cotizar.ts");

describe("resumen.ts — restriccionPorPaquete viaja SOLO (nunca combinada con el hotel)", () => {
  test("se calcula desde armado_paquetes.condicion_pago_tipo/restriccion_comercial, sin ninguna fecha ni hotel_temporadas", () => {
    const inicio = resumen.indexOf("const restriccionPorPaquete = new Map<number, { condicionNoNeutra: boolean; restriccionNoNeutra: boolean }>();");
    assert.ok(inicio > -1, "no se declaró restriccionPorPaquete");
    const finSet = resumen.indexOf("restriccionPorPaquete.set(p.id as number, {");
    assert.ok(finSet > inicio);
    const bloque = resumen.slice(finSet, resumen.indexOf("});", finSet) + 4);
    assert.match(bloque, /condicionNoNeutra: \(\(p\.condicion_pago_tipo as string \| null\) \?\? "normal"\) !== "normal",/);
    assert.match(bloque, /restriccionNoNeutra: esRestriccionComercial\(\(\(p\.restriccion_comercial as string \| null\) \?\? "normal"\) as RestriccionComercial\),/);
    assert.doesNotMatch(bloque, /hotel_temporadas|condicionHotelFechas|fecha_ida|fecha_regreso/, "restriccionPorPaquete no debe depender de fecha ni de hotel_temporadas");
  });

  test("se serializa a Record (paqueteId) y se expone en DatosResumenTarifario, separado de condicionPorOferta/politicaPorOferta", () => {
    assert.match(resumen, /restriccionPorPaquete: Record<number, \{ condicionNoNeutra: boolean; restriccionNoNeutra: boolean \}>;/, "falta el campo en el tipo de retorno");
    assert.match(resumen, /const restriccionPorPaqueteRecord: Record<number, \{ condicionNoNeutra: boolean; restriccionNoNeutra: boolean \}> = \{\};/);
    assert.match(resumen, /for \(const \[paqueteId, valor\] of restriccionPorPaquete\) restriccionPorPaqueteRecord\[paqueteId\] = valor;/);
    assert.match(resumen, /restriccionPorPaquete: restriccionPorPaqueteRecord,/, "no se devuelve en el return final");
  });
});

describe("Props threading — restriccionPorPaquete llega intacto de resumen.ts a VistaBooking", () => {
  test("page.tsx lo destructura y lo reenvía a TarifarioPublic sin transformarlo", () => {
    assert.match(tarifarioPage, /restriccionPorPaquete,\s*\n\s*\}\s*=\s*resDatos\.datos/);
    assert.match(tarifarioPage, /restriccionPorPaquete=\{restriccionPorPaquete\}/);
  });

  test("TarifarioPublic acepta la prop y la reenvía a VistaBooking sin interpretarla", () => {
    assert.match(tarifarioPublic, /restriccionPorPaquete = \{\}/);
    assert.match(tarifarioPublic, /restriccionPorPaquete=\{restriccionPorPaquete\}/);
  });

  test("VistaBooking declara restriccionPorPaquete como prop con default {}", () => {
    assert.match(vistaBooking, /restriccionPorPaquete = \{\},\s*\n\}:\s*\{/);
  });
});

describe("Persona en BÚSQUEDA usa BusquedaResultado.condicion (fecha exacta), NUNCA el cálculo genérico de exploración", () => {
  test("cotizar.ts ya calcula/expone `condicion` en BusquedaResultado a partir de condicionHotelFechas sobre la fecha real buscada", () => {
    assert.match(cotizar, /condicion\?: CondicionHotelFechas \| null;/, "BusquedaResultado no declara condicion");
  });

  test("itemDeBusquedaPersona combina r.condicion con restriccionPorPaquete[r.paqueteId] — nunca condicionDe/politicaDe (el cálculo genérico de exploración)", () => {
    const inicio = vistaBooking.indexOf("const itemDeBusquedaPersona = (r: BusquedaResultado): ItemResto => {");
    assert.ok(inicio > -1, "no se encontró itemDeBusquedaPersona");
    const fin = vistaBooking.indexOf("const itemDeBusquedaUnidad", inicio);
    const cuerpo = vistaBooking.slice(inicio, fin);
    assert.match(cuerpo, /const \{ condicion, politica \} = condicionPoliticaBusqueda\(r\.condicion, r\.paqueteId\);/);
    assert.doesNotMatch(cuerpo, /condicionDe\(r\.hotelId/, "la persona en búsqueda no debe usar el rango genérico de exploración para el hotel");
    assert.doesNotMatch(cuerpo, /politicaDe\(r\.hotelId/, "la persona en búsqueda no debe usar el rango genérico de exploración para el hotel");
  });

  test("itemDeBusquedaUnidad combina SOLO el paquete (hotel siempre desconocido para Bernalo) — nunca inventa condición de hotel", () => {
    const inicio = vistaBooking.indexOf("const itemDeBusquedaUnidad = (g: GrupoOfertaUnidad<OpcionUnidadConfirmada>): ItemResto => {");
    assert.ok(inicio > -1, "no se encontró itemDeBusquedaUnidad");
    const fin = vistaBooking.indexOf("// ── Modo búsqueda:", inicio);
    const cuerpo = vistaBooking.slice(inicio, fin);
    assert.match(cuerpo, /const \{ condicion, politica \} = condicionPoliticaBusqueda\(undefined, g\.paqueteId\);/, "el lado hotel de unidad debe pasar undefined explícito (nunca inventado)");
  });

  test("itemDePersona/itemDeUnidadExploracion (EXPLORACIÓN) siguen usando condicionDe/politicaDe — el rango genérico del paquete sigue permitido ahí", () => {
    const inicioPersona = vistaBooking.indexOf("const itemDePersona = (c: HotelCard): ItemResto => ({");
    const finPersona = vistaBooking.indexOf("});", inicioPersona);
    const cuerpoPersona = vistaBooking.slice(inicioPersona, finPersona);
    assert.match(cuerpoPersona, /condicion: condicionDe\(c\.hotelId, c\.paqueteId as number\),/);
    assert.match(cuerpoPersona, /politica: politicaDe\(c\.hotelId, c\.paqueteId as number\),/);
  });

  test("condicionPoliticaBusqueda delega la combinación ternaria en combinarTernario (lib/tarifario/condicionOferta.ts) — nunca reimplementa la regla inline", () => {
    const inicio = vistaBooking.indexOf("const condicionPoliticaBusqueda = (");
    assert.ok(inicio > -1, "no se encontró condicionPoliticaBusqueda");
    const fin = vistaBooking.indexOf("const itemDePersona", inicio);
    const cuerpo = vistaBooking.slice(inicio, fin);
    assert.match(cuerpo, /const hotelCondTri: EvidenciaTernaria = condicionHotel \? !esNeutra\(condicionHotel\.condicionPagoTipo\) : null;/);
    // La restricción del hotel viene de `condicionHotel.restringido` (ya
    // resuelta por el motor para la fecha exacta) — nunca se recalcula acá.
    assert.match(cuerpo, /const hotelRestrTri: EvidenciaTernaria = condicionHotel \? condicionHotel\.restringido : null;/);
    assert.match(cuerpo, /const paqueteCondTri: EvidenciaTernaria = paquete \? paquete\.condicionNoNeutra : null;/);
    assert.match(cuerpo, /const paqueteRestrTri: EvidenciaTernaria = paquete \? paquete\.restriccionNoNeutra : null;/);
    assert.match(cuerpo, /condicion: etiquetaCondicion\(combinarTernario\(hotelCondTri, paqueteCondTri\)\),/);
    assert.match(cuerpo, /politica: etiquetaPolitica\(combinarTernario\(hotelRestrTri, paqueteRestrTri\)\),/);
    assert.match(vistaBooking, /import \{ combinarTernario, etiquetaCondicion, etiquetaPolitica, type EvidenciaTernaria \} from "@\/lib\/tarifario\/condicionOferta";/);
  });
});
