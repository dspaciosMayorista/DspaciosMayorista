import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Cableado de la corrección permanente de ocupación con menores en hoteles
// `modelo_tarifario = "unidad"` (Objetivo 1) y del resumen del carrito
// (Objetivo 2). La lógica en sí corre de verdad en:
//   · pruebas/distribucionOcupacionUnidad.test.ts (adaptador)
//   · pruebas/capacidadTarifaUnidad.test.ts (resolución de capacidad)
//   · pruebas/evaluarDisponibilidadUnidad.test.ts (integración, incl. el
//     caso obligatorio del encargo)
//   · pruebas/composicionHabitacionBernalo.test.ts (composición pública)
//   · pruebas/resumenHabitacionBernalo.test.ts (formato del resumen)
// Este archivo solo confirma que los archivos "use server"/JSX (no
// ejecutables bajo `node --test`) de verdad LLAMAN a esos módulos — mismo
// criterio que el resto de wiring tests del proyecto.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuenteEvaluar = readFileSync(join(raiz, "lib/tarifario/evaluarDisponibilidadUnidad.ts"), "utf8");
const fuenteBusqueda = readFileSync(join(raiz, "app/tarifario/busquedaUnidadActions.ts"), "utf8");
const fuenteCotizar = readFileSync(join(raiz, "app/tarifario/cotizacionBernaloActions.ts"), "utf8");
const fuenteVista = readFileSync(join(raiz, "app/tarifario/VistaBooking.tsx"), "utf8");
const fuenteDrawer = readFileSync(join(raiz, "app/tarifario/CartDrawer.tsx"), "utf8");
const fuenteCartContext = readFileSync(join(raiz, "lib/cart/CartContext.tsx"), "utf8");
const fuenteIdentidad = readFileSync(join(raiz, "lib/tarifario/identidadReservaUnidad.ts"), "utf8");

function sinComentarios(fuente: string): string {
  return fuente.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l)).join("\n");
}
const codigoEvaluar = sinComentarios(fuenteEvaluar);
const codigoBusqueda = sinComentarios(fuenteBusqueda);
const codigoCotizar = sinComentarios(fuenteCotizar);

describe("Objetivo 1 — evaluarDisponibilidadUnidad.ts ya NO usa el fallback persona (hotel_acomodaciones/defaultAcomConfig)", () => {
  test("no importa defaultAcomConfig ni repartirMenoresEnHabitaciones/distribuirPorHabitaciones", () => {
    assert.doesNotMatch(codigoEvaluar, /defaultAcomConfig/);
    assert.doesNotMatch(codigoEvaluar, /repartirMenoresEnHabitaciones/);
    assert.doesNotMatch(codigoEvaluar, /distribuirPorHabitaciones/);
  });

  test("usa distribuirOcupacionUnidad + resolverCapacidadTarifaUnidad, resueltos POR COMBINACIÓN dentro del bucle de combos", () => {
    assert.match(codigoEvaluar, /import \{ distribuirOcupacionUnidad \} from "\.\/distribucionOcupacionUnidad\.ts"/);
    assert.match(codigoEvaluar, /import \{ resolverCapacidadTarifaUnidad \} from "\.\/capacidadTarifaUnidad\.ts"/);
    const idxForCombo = codigoEvaluar.indexOf("for (const combo of combos)");
    const idxCapacidad = codigoEvaluar.indexOf("resolverCapacidadTarifaUnidad(");
    const idxReparto = codigoEvaluar.indexOf("distribuirOcupacionUnidad(");
    assert.ok(idxForCombo !== -1 && idxCapacidad !== -1 && idxReparto !== -1);
    assert.ok(idxForCombo < idxCapacidad, "la capacidad se resuelve DENTRO del bucle de combos, no antes");
    assert.ok(idxCapacidad < idxReparto, "el reparto usa la capacidad YA resuelta de esa combinación");
  });

  test("sin capacidad resuelta, el fallback es SIN COTA (nunca inventa una capacidad restrictiva)", () => {
    assert.match(codigoEvaluar, /\{ minPax: 1, maxPax: null \}/);
  });

  test("EntradaEvaluarHotelUnidad ya NO declara 'reglas' (AcomConfig) — declara temporadasRaw/filasTarifas/hoy", () => {
    const idxTipo = codigoEvaluar.indexOf("export type EntradaEvaluarHotelUnidad");
    const cuerpoTipo = codigoEvaluar.slice(idxTipo, idxTipo + 1500);
    assert.doesNotMatch(cuerpoTipo, /reglas:\s*AcomConfig/);
    assert.match(cuerpoTipo, /temporadasRaw:\s*unknown\[\]/);
    assert.match(cuerpoTipo, /filasTarifas:\s*unknown\[\]/);
    assert.match(cuerpoTipo, /hoy:\s*string/);
  });
});

describe("Objetivo 1 — busquedaUnidadActions.ts ya NO consulta hotel_acomodaciones para unidad", () => {
  test("no hay ninguna consulta a la tabla hotel_acomodaciones", () => {
    assert.doesNotMatch(codigoBusqueda, /from\("hotel_acomodaciones"\)/);
  });

  test("la búsqueda es SOLO LECTURA: sin .insert()/.update()/.upsert()/.delete() en ninguna tabla — nunca escribe hotel_acomodaciones ni tarifario_resultado para hoteles nuevos", () => {
    for (const fuente of [codigoBusqueda, codigoEvaluar]) {
      assert.doesNotMatch(fuente, /\.insert\(/);
      assert.doesNotMatch(fuente, /\.update\(/);
      assert.doesNotMatch(fuente, /\.upsert\(/);
      assert.doesNotMatch(fuente, /\.delete\(/);
    }
  });

  test("consulta hotel_temporadas y hotel_tarifas_unidad (estado=publicada) en lote, por destino", () => {
    assert.match(codigoBusqueda, /from\("hotel_temporadas"\)/);
    assert.match(codigoBusqueda, /from\("hotel_tarifas_unidad"\)/);
    assert.match(codigoBusqueda, /\.eq\("estado", "publicada"\)/);
  });

  test("pasa temporadasRaw/filasTarifas/hoy a evaluarDisponibilidadHotelUnidad (nunca 'reglas')", () => {
    const idxLlamada = codigoBusqueda.indexOf("veredictos[i] = await evaluarDisponibilidadHotelUnidad({");
    const cuerpoLlamada = codigoBusqueda.slice(idxLlamada, idxLlamada + 500);
    assert.match(cuerpoLlamada, /temporadasRaw:\s*temporadasPorHotel\.get\(hotelId\)/);
    assert.match(cuerpoLlamada, /filasTarifas:\s*tarifasPorHotel\.get\(hotelId\)/);
    assert.match(cuerpoLlamada, /hoy,/);
    assert.doesNotMatch(cuerpoLlamada, /reglas:/);
  });
});

describe("Objetivo 2 — composición pública sale del resultado AUTORITATIVO de computarReservaBernalo", () => {
  test("cotizacionBernaloActions.ts construye composicionHabitaciones con construirComposicionHabitacionesPublica(resultado.habitaciones) — nunca un objeto armado a mano", () => {
    assert.match(
      fuenteCotizar,
      /import\s*\{\s*construirComposicionHabitacionesPublica,\s*type ComposicionHabitacionPublica,?\s*\}\s*from\s*"@\/lib\/reservar\/composicionHabitacionBernalo"/
    );
    assert.match(codigoCotizar, /composicionHabitaciones:\s*construirComposicionHabitacionesPublica\(resultado\.habitaciones\)/);
  });

  test("el tipo público ResultadoCotizarAlojamientoBernaloPublicoOk declara composicionHabitaciones", () => {
    const idx = fuenteCotizar.indexOf("export type ResultadoCotizarAlojamientoBernaloPublicoOk");
    const cuerpo = fuenteCotizar.slice(idx, idx + 900);
    assert.match(cuerpo, /composicionHabitaciones:\s*ComposicionHabitacionPublica\[\]/);
  });

  test("identidadReservaUnidad.ts propaga composicionHabitaciones en el resultado 'agregar' (revalidarReservaUnidad)", () => {
    const idx = fuenteIdentidad.indexOf('return {\n      estado: "agregar"');
    assert.notEqual(idx, -1);
    const cuerpo = fuenteIdentidad.slice(idx, idx + 250);
    assert.match(cuerpo, /composicionHabitaciones:\s*r\.composicionHabitaciones/);
  });
});

describe("Objetivo 2 — VistaBooking.tsx pasa composicionHabitaciones al carrito en AMBOS caminos de 'Agregar al carrito'", () => {
  test("TarjetaUnidadBusqueda: add({...}) incluye composicionHabitaciones: rev.composicionHabitaciones", () => {
    const idx = fuenteVista.lastIndexOf("precio: rev.precio,");
    assert.notEqual(idx, -1, "debe existir la llamada add(...) de TarjetaUnidadBusqueda con el precio revalidado");
    const cuerpo = fuenteVista.slice(idx, idx + 150);
    assert.match(cuerpo, /composicionHabitaciones:\s*rev\.composicionHabitaciones/);
  });

  test("agregarBernalo (modal de exploración): add({...}) incluye composicionHabitaciones: item.composicionHabitaciones", () => {
    const idx = fuenteVista.indexOf("function agregarBernalo(item:");
    assert.notEqual(idx, -1);
    const cuerpo = fuenteVista.slice(idx, idx + 900);
    assert.match(cuerpo, /composicionHabitaciones:\s*item\.composicionHabitaciones/);
  });

  test("agregarBernaloClick (EditorPax) pasa resultadoCotizacion.composicionHabitaciones a onAgregarBernalo", () => {
    const idx = fuenteVista.indexOf("function agregarBernaloClick()");
    assert.notEqual(idx, -1);
    const cuerpo = fuenteVista.slice(idx, idx + 600);
    assert.match(cuerpo, /composicionHabitaciones:\s*resultadoCotizacion\.composicionHabitaciones/);
  });
});

describe("Objetivo 2 — CartContext.tsx / CartDrawer.tsx", () => {
  test("HotelCartItemBernalo declara composicionHabitaciones como OPCIONAL (compatibilidad con ítems legacy en localStorage)", () => {
    const idx = fuenteCartContext.indexOf("export type HotelCartItemBernalo");
    const cuerpo = fuenteCartContext.slice(idx, idx + 2500);
    assert.match(cuerpo, /composicionHabitaciones\?:/);
  });

  test("CartDrawer.tsx importa el resumen desde lib/cart/resumenHabitacionBernalo (no reimplementa el formato inline) y lo llama con habitaciones + composicionHabitaciones", () => {
    assert.match(fuenteDrawer, /import\s*\{\s*resumenHabitacionesBernalo\s*\}\s*from\s*"@\/lib\/cart\/resumenHabitacionBernalo"/);
    assert.match(fuenteDrawer, /resumenHabitacionesBernalo\(it\.habitaciones,\s*it\.composicionHabitaciones\)/);
  });
});
