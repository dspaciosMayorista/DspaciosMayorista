import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3F-3 Bernalo — verificación por inspección del servicio INTERNO
// autoritativo de cálculo (`lib/reservar/computoReservaBernalo.ts`), donde
// vive ahora TODA la autorización/resolución que hasta 3E vivía en la
// Server Action pública (`app/tarifario/cotizacionBernaloActions.ts`). Ese
// archivo pasó a ser una capa delgada de validación de forma + sanitización
// — sus propias pruebas de wiring viven en
// pruebas/cotizacionBernaloWiring.test.ts.
//
// No ejecutable bajo `node --test` (Supabase real) — se verifica el código
// FUENTE, mismo criterio que el resto de wiring tests del repo.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuente = readFileSync(join(raiz, "lib/reservar/computoReservaBernalo.ts"), "utf8");

function sinComentarios(fuenteCompleta: string): string {
  return fuenteCompleta.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*\*?\s*$/.test(l)).join("\n");
}
const codigo = sinComentarios(fuente);

describe("computoReservaBernalo.ts — servicio interno, no Server Action", () => {
  test('NO lleva "use server" (es una función interna, la invoca la Server Action, no el navegador)', () => {
    assert.doesNotMatch(fuente.split(/\r?\n/).slice(0, 5).join("\n"), /"use server"/);
  });

  test("usa createAdminClient (service role) — la RLS de hotel_tarifas_unidad sigue cerrada", () => {
    assert.match(codigo, /createAdminClient\(\)/);
    assert.doesNotMatch(codigo, /createClient\(\)/);
  });

  test("la entrada reusa DecisionesOcupacionBernalo de Fase 3F-1 — no copia su forma", () => {
    assert.match(codigo, /export type EntradaComputoReservaBernalo = DecisionesOcupacionBernalo;/);
    assert.match(codigo, /import type \{ DecisionesOcupacionBernalo, SalidaSeleccionadaBernaloEntrada \} from "@\/lib\/reservar\/solicitudAlojamientoBernalo"/);
  });
});

describe("computoReservaBernalo.ts — valida ANTES de tocar hotel_tarifas_unidad", () => {
  test("valida paquete activo, hotel vinculado (armado_hoteles) y categoría/alimentación ANTES de consultar hotel_tarifas_unidad", () => {
    const posPaquete = fuente.indexOf('.from("armado_paquetes")');
    const posArmadoHoteles = fuente.indexOf('.from("armado_hoteles")');
    const posCategorias = fuente.indexOf("!categorias.length || !regimenes.length");
    const posVentana = fuente.indexOf("pq.fecha_viaje_inicio && fechaIda");
    const posTarifas = fuente.indexOf('.from("hotel_tarifas_unidad")');
    for (const [nombre, pos] of [["armado_paquetes", posPaquete], ["armado_hoteles", posArmadoHoteles], ["categorias", posCategorias], ["ventana", posVentana]] as const) {
      assert.notEqual(pos, -1, `no se encontró la validación "${nombre}"`);
    }
    assert.notEqual(posTarifas, -1, "no se encontró la consulta a hotel_tarifas_unidad");
    assert.ok(posPaquete < posTarifas, "el paquete debe validarse antes de leer hotel_tarifas_unidad");
    assert.ok(posArmadoHoteles < posTarifas, "el hotel debe validarse antes de leer hotel_tarifas_unidad");
    assert.ok(posCategorias < posTarifas, "la categoría debe validarse antes de leer hotel_tarifas_unidad");
    assert.ok(posVentana < posTarifas, "la ventana de fechas debe validarse antes de leer hotel_tarifas_unidad");
  });

  test("valida hoteles.modelo_tarifario === 'unidad' antes de continuar (no asume por el hotelId recibido)", () => {
    assert.match(codigo, /modeloTarifario !== "unidad"/);
  });
});

describe("computoReservaBernalo.ts — A1: identidad discriminada de salida, nunca [0]", () => {
  test("el código nunca accede a una salida por índice [0] (\"tomar la primera\")", () => {
    assert.doesNotMatch(codigo, /\[0\]/);
  });

  test("la salida elegida se busca por identidad real (find sobre las salidas válidas) — se rechaza si no aparece", () => {
    assert.match(codigo, /salidasValidas\.find\(\(s\)\s*=>\s*s\.tipo === input\.salida\.tipo && s\.id === input\.salida\.id\)/);
    assert.match(codigo, /if \(!salida\) \{/);
    assert.match(codigo, /codigo:\s*"salida_no_vinculada"/);
  });

  test('para "bloqueo"/"empaquetado" las fechas AUTORITATIVAS salen de la salida validada, nunca del llamador', () => {
    assert.match(codigo, /fechaIda = salida\.fechaIda;/);
    assert.match(codigo, /fechaRegreso = salida\.fechaRegreso;/);
  });

  test('"sin_vuelo" se rechaza si el paquete SÍ tiene salidas válidas', () => {
    const bloque = fuente.slice(fuente.indexOf('input.salida.tipo === "sin_vuelo"'), fuente.indexOf('input.salida.tipo === "sin_vuelo"') + 700);
    assert.match(bloque, /salidasValidas\.length > 0/);
    assert.match(bloque, /codigo:\s*"salida_no_vinculada"/);
  });

  test("la salida RESUELTA (para el resultado final) incluye tipo/id/fechas reales, nunca lo que mandó el llamador", () => {
    assert.match(codigo, /salidaResuelta = \{ tipo: salida\.tipo, id: salida\.id, fechaIda, fechaRegreso \};/);
    assert.match(codigo, /salidaResuelta = \{ tipo: "sin_vuelo", fechaIda, fechaRegreso \};/);
  });
});

describe("computoReservaBernalo.ts — A2: mismos filtros del generador legado, fail-closed en disponibilidad", () => {
  test("filtra bloqueo por fechas completas — mismo criterio que generarTarifario", () => {
    assert.match(codigo, /!b\.fecha_ida \|\| !b\.fecha_regreso/);
  });

  test("filtra empaquetado por activo + fechas completas + empaquetadoVigente(...) — mismo criterio que generarTarifario", () => {
    assert.match(codigo, /!e\.activo \|\| !e\.fecha_ida \|\| !e\.fecha_regreso/);
    assert.match(codigo, /empaquetadoVigente\(e\.compra_inicio, e\.compra_fin, hoy\)/);
  });

  test("cero salidas válidas con vuelos configurados bloquea (salidas_no_disponibles) — nunca cae a porción terrestre en silencio", () => {
    assert.match(codigo, /totalConfiguradas > 0 && salidasValidas\.length === 0/);
    assert.match(codigo, /codigo:\s*"salidas_no_disponibles"/);
  });
});

describe("computoReservaBernalo.ts — A3: moneda resuelta desde los componentes reales", () => {
  test("usa resolverMonedaComponentesBernalo — nunca `pq.moneda ?? \"COP\"`", () => {
    assert.match(codigo, /import\s*\{[\s\S]*resolverMonedaComponentesBernalo[\s\S]*\}\s*from\s*"@\/lib\/calc\/pvpAlojamientoBernalo"/);
    assert.match(codigo, /resolverMonedaComponentesBernalo\(hotelMeta\?\.moneda \?\? null, monedasServicios, pq\.moneda \?\? null\)/);
    assert.doesNotMatch(codigo, /moneda:\s*pq\.moneda\s*\?\?\s*"COP"/);
    assert.doesNotMatch(codigo, /pq\.moneda\s*\?\?\s*"COP"/);
  });

  test("si la resolución de moneda falla, bloquea ANTES de construir la entrada del compositor de PVP", () => {
    const posResolucion = fuente.indexOf("resolverMonedaComponentesBernalo(");
    const posEntradaPvp = fuente.indexOf("const entradaPvp: EntradaPvpAlojamientoBernalo");
    assert.notEqual(posResolucion, -1);
    assert.ok(posResolucion < posEntradaPvp, "la moneda debe resolverse antes de armar la entrada del compositor");
    assert.match(codigo, /if \(!resolucionMoneda\.ok\)/);
  });
});

describe("computoReservaBernalo.ts — B1: sin texto libre en categoría/alimentación", () => {
  test("categorias/regimenes VACÍOS bloquean con configuracion_incompleta", () => {
    assert.match(codigo, /if \(!categorias\.length \|\| !regimenes\.length\)/);
    assert.match(codigo, /codigo:\s*"configuracion_incompleta"/);
  });

  test("la categoría/alimentación recibida debe estar en la lista real (includes)", () => {
    assert.match(codigo, /!categorias\.includes\(input\.categoria\)/);
    assert.match(codigo, /!regimenes\.includes\(input\.alimentacion\)/);
  });
});

describe("computoReservaBernalo.ts — resuelve hotel y proveedores REALES server-side (nunca placeholders)", () => {
  test("hotel: nombre y proveedor (nombre/aplica_retencion/pct_retencion) resueltos desde armado_hoteles.hoteles.proveedores", () => {
    assert.match(codigo, /hoteles\(moneda, modelo_tarifario, nombre, proveedores\(nombre, aplica_retencion, pct_retencion\)\)/);
    assert.match(codigo, /const hotelNombre = hotelMeta\?\.nombre \?\? "";/);
    assert.match(codigo, /const proveedorHotel: ProveedorHotelBernalo = hotelMeta\?\.proveedores/);
  });

  test("servicios incluidos (persona Y grupo) resuelven proveedor_id real desde servicios_adicionales.proveedores — nunca null fijo", () => {
    assert.match(codigo, /servicios_adicionales\(nombre, categoria, precio_persona, liquidacion, moneda, proveedor_id, proveedores\(nombre, aplica_retencion, pct_retencion\)\)/);
    assert.match(codigo, /proveedorId: sa\?\.proveedor_id \?\? null,/);
    // Servicios de grupo: antes (Fase 3E) quedaba `proveedorId: null` fijo —
    // ahora se resuelve igual que persona, desde el catálogo real.
    assert.doesNotMatch(codigo, /proveedorId:\s*null,\s*\n\s*rangos:/);
  });

  test("cada servicio incluido resuelto lleva la moneda ÚNICA ya validada del contrato (nunca una moneda distinta por servicio)", () => {
    assert.match(codigo, /serviciosIncluidos: ServicioIncluidoComputoBernalo\[\] = resultadoComposicion\.serviciosIncluidosResueltos\.map\(\(s\) => \(\{/);
    assert.match(codigo, /\.\.\.s,\s*\n\s*moneda,/);
  });
});

describe("computoReservaBernalo.ts — una entrada por habitación con ocupación+resultado+snapshot completos", () => {
  test("zipea porHabitacion con la ocupación de entrada POR habitacionId — nunca aplana ni pierde la asociación", () => {
    assert.match(codigo, /const ocupacionPorId = new Map\(input\.habitaciones\.map\(\(h\) => \[h\.id, h\]\)\);/);
    assert.match(codigo, /ocupacion: ocupacionPorId\.get\(ph\.habitacionId\)!/);
    assert.match(codigo, /resultado: ph\.resultado,/);
    assert.match(codigo, /snapshot: ph\.snapshot,/);
  });
});

describe("computoReservaBernalo.ts — nunca escribe nada (regla 9 del encargo)", () => {
  test("no hay ningún .insert/.update/.upsert/.delete en todo el archivo — solo lecturas", () => {
    assert.doesNotMatch(codigo, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });

  test("no menciona contrato_items, contrato_alojamiento_bernalo, cuentas_por_pagar ni ventas como tabla de escritura", () => {
    assert.doesNotMatch(codigo, /contrato_items|contrato_alojamiento_bernalo|cuentas_por_pagar/);
    assert.doesNotMatch(codigo, /\.from\("ventas"\)/);
  });

  test("no arma un ReservaInput persona ni usa habitaciones: {} — nunca se disfraza de la forma persona", () => {
    assert.doesNotMatch(codigo, /ReservaInput/);
    assert.doesNotMatch(codigo, /habitaciones:\s*\{\}/);
  });

  test("no toca ni importa la guardia de computo.ts (computarReserva) — 3F-4 hará el dispatch", () => {
    assert.doesNotMatch(codigo, /from "@\/lib\/reservar\/computo"/);
    assert.doesNotMatch(codigo, /\bcomputarReserva\(/);
  });
});

describe("computoReservaBernalo.ts — reutiliza los resolvers de fases previas, no reimplementa nada", () => {
  test("importa orquestarCotizacionAlojamientoBernalo (3C) y calcularPvpAlojamientoBernalo (3E/3F-3) — una sola vez cada uno", () => {
    assert.match(codigo, /import\s*\{[\s\S]*orquestarCotizacionAlojamientoBernalo[\s\S]*\}\s*from\s*"@\/lib\/calc\/orquestarCotizacionAlojamientoBernalo"/);
    assert.match(codigo, /import\s*\{[\s\S]*calcularPvpAlojamientoBernalo[\s\S]*\}\s*from\s*"@\/lib\/calc\/pvpAlojamientoBernalo"/);
    const usosOrquestacion = [...codigo.matchAll(/orquestarCotizacionAlojamientoBernalo\(/g)];
    const usosComposicion = [...codigo.matchAll(/calcularPvpAlojamientoBernalo\(/g)];
    assert.equal(usosOrquestacion.length, 1, "el orquestador debe llamarse UNA sola vez (nunca dos implementaciones monetarias)");
    assert.equal(usosComposicion.length, 1, "el compositor de PVP debe llamarse UNA sola vez");
  });
});
