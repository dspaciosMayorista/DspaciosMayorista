import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3F-3 Bernalo — verificación por inspección de la frontera PÚBLICA de
// cotización (`app/tarifario/cotizacionBernaloActions.ts`) y del loader de
// descubrimiento (`lib/tarifario/datosBernalo.ts`). Ninguno de los dos es
// ejecutable bajo `node --test` (Supabase/Next real) — se verifica el
// código FUENTE, mismo criterio que el resto de wiring tests del repo.
//
// Desde 3F-3, TODA la autorización/resolución/cálculo vive en el servicio
// interno `lib/reservar/computoReservaBernalo.ts` — sus pruebas de wiring
// viven en pruebas/computoReservaBernaloWiring.test.ts. Este archivo prueba
// SOLO lo que le queda a la Server Action: validar forma, llamar al
// servicio UNA vez y sanitizar su respuesta.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuenteAction = readFileSync(join(raiz, "app/tarifario/cotizacionBernaloActions.ts"), "utf8");
const fuenteDiscovery = readFileSync(join(raiz, "lib/tarifario/datosBernalo.ts"), "utf8");

function sinComentarios(fuente: string): string {
  return fuente.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*\*?\s*$/.test(l)).join("\n");
}
const codigoAction = sinComentarios(fuenteAction);
const codigoDiscovery = sinComentarios(fuenteDiscovery);

describe("cotizacionBernaloActions.ts — es la Server Action pública de cotización", () => {
  test('lleva "use server" al inicio del archivo', () => {
    assert.match(fuenteAction.split(/\r?\n/).slice(0, 3).join("\n"), /"use server"/);
  });

  test("YA NO usa createAdminClient/Supabase directamente — todo el acceso a datos se movió al servicio interno (Fase 3F-3)", () => {
    assert.doesNotMatch(codigoAction, /createAdminClient\(\)/);
    assert.doesNotMatch(codigoAction, /createClient\(\)/);
    assert.doesNotMatch(codigoAction, /\.from\(/);
  });

  test("importa y usa computarReservaBernalo como ÚNICA fuente del cálculo (regla 1: no dos implementaciones monetarias)", () => {
    assert.match(codigoAction, /import\s*\{[\s\S]*computarReservaBernalo[\s\S]*\}\s*from\s*"@\/lib\/reservar\/computoReservaBernalo"/);
    const usos = [...codigoAction.matchAll(/computarReservaBernalo\(/g)];
    assert.equal(usos.length, 1, "computarReservaBernalo debe llamarse UNA sola vez");
  });

  test("no reimplementa orquestación/composición de PVP — no importa orquestarCotizacionAlojamientoBernalo/calcularPvpAlojamientoBernalo directo", () => {
    assert.doesNotMatch(codigoAction, /orquestarCotizacionAlojamientoBernalo|calcularPvpAlojamientoBernalo/);
  });
});

describe("cotizacionBernaloActions.ts — valida FORMA antes de llamar al servicio interno", () => {
  test("valida el arreglo de habitaciones con validarHabitacionesOcupacion (Fase 3D) antes de invocar computarReservaBernalo", () => {
    const posValidacion = fuenteAction.indexOf("validarHabitacionesOcupacion(input.habitaciones)");
    const posServicio = fuenteAction.indexOf("await computarReservaBernalo(");
    assert.notEqual(posValidacion, -1);
    assert.notEqual(posServicio, -1);
    assert.ok(posValidacion < posServicio, "la ocupación debe validarse en forma antes de llamar al servicio interno");
  });

  test('valida la salida con validarSalidaSeleccionadaBernalo (Fase 3F-1) — reutilizada, no reimplementada', () => {
    assert.match(codigoAction, /import\s*\{[\s\S]*validarSalidaSeleccionadaBernalo[\s\S]*\}\s*from\s*"@\/lib\/reservar\/solicitudAlojamientoBernalo"/);
    const posValidacion = fuenteAction.indexOf("validarSalidaSeleccionadaBernalo(input.salida)");
    const posServicio = fuenteAction.indexOf("await computarReservaBernalo(");
    assert.notEqual(posValidacion, -1);
    assert.ok(posValidacion < posServicio, "la salida debe validarse en forma antes de llamar al servicio interno");
  });

  test("construye la entrada del servicio con la salida/habitaciones YA VALIDADAS (vSalida.salida / validacionOcupacion.habitaciones), nunca el input crudo", () => {
    const bloqueLlamada = fuenteAction.slice(fuenteAction.indexOf("const resultado = await computarReservaBernalo({"), fuenteAction.indexOf("const resultado = await computarReservaBernalo({") + 400);
    assert.match(bloqueLlamada, /salida: vSalida\.salida,/);
    assert.match(bloqueLlamada, /habitaciones: validacionOcupacion\.habitaciones,/);
  });
});

describe("cotizacionBernaloActions.ts — mensajes públicos con motivo comercial saneado", () => {
  test("MENSAJES_PUBLICOS tiene entradas para servicio_sin_tarifa/servicio_sin_rango_grupal", () => {
    const mapa = fuenteAction.slice(fuenteAction.indexOf("const MENSAJES_PUBLICOS"), fuenteAction.indexOf("function mensajePublico"));
    assert.match(mapa, /servicio_sin_tarifa:/);
    assert.match(mapa, /servicio_sin_rango_grupal:/);
  });

  test("el fallo del servicio interno se traduce con mensajePublico(resultado.codigo, resultado.mensaje) — nunca reenvía el objeto interno completo", () => {
    assert.match(codigoAction, /mensajePublico\(resultado\.codigo, resultado\.mensaje\)/);
    assert.doesNotMatch(codigoAction, /return resultado;/);
    assert.doesNotMatch(codigoAction, /\.\.\.resultado/);
  });

  test("ningún mensaje público fijo en MENSAJES_PUBLICOS interpola una variable (todos son texto fijo, nunca nombres internos)", () => {
    const mapa = fuenteAction.slice(fuenteAction.indexOf("const MENSAJES_PUBLICOS"), fuenteAction.indexOf("function mensajePublico"));
    assert.doesNotMatch(mapa, /\$\{/);
  });

  test("solo los rechazos comerciales pueden adjuntar Motivo y el detalle se limpia de campos/tablas sensibles", () => {
    const fn = fuenteAction.slice(fuenteAction.indexOf("function mensajePublico"), fuenteAction.indexOf("/**", fuenteAction.indexOf("function mensajePublico")));
    for (const codigo of ["no_cotizable", "configuracion_invalida", "ocupacion_no_permitida", "edad_fuera_de_regla", "tarifa_no_encontrada"]) {
      assert.match(fn, new RegExp(codigo));
    }
    assert.match(fn, /Motivo:/);
    for (const sensible of ["snapshot", "totalNeto", "valorComision", "hotel_tarifas_unidad", "armado_hoteles", "armado_paquetes", "servicios_adicionales"]) {
      assert.match(fn, new RegExp(sensible));
    }
  });
});

describe("cotizacionBernaloActions.ts — la respuesta pública conserva ÚNICAMENTE sus 5 claves autorizadas", () => {
  test("el tipo de salida OK declara exactamente ok/pvp/moneda/paxTotal/promedioPorViajero", () => {
    const tipo = fuenteAction.slice(
      fuenteAction.indexOf("export type ResultadoCotizarAlojamientoBernaloPublicoOk"),
      fuenteAction.indexOf("export type ResultadoCotizarAlojamientoBernaloPublico =")
    );
    for (const campo of ["ok: true;", "pvp: number;", "moneda: string;", "paxTotal: number;", "promedioPorViajero: number;"]) {
      assert.match(tipo, new RegExp(campo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  test("el objeto final se construye a mano campo por campo — nunca `return resultado`/spread del objeto interno completo", () => {
    assert.doesNotMatch(codigoAction, /return resultado;/);
    assert.doesNotMatch(codigoAction, /\.\.\.resultado/);
    assert.match(codigoAction, /pvp: resultado\.precioVenta,/);
    assert.match(codigoAction, /moneda: resultado\.moneda,/);
    assert.match(codigoAction, /paxTotal: resultado\.paxTotal,/);
  });

  test("no reenvía ningún campo interno en los objetos de respuesta pública", () => {
    const bloqueOk = codigoAction.slice(codigoAction.indexOf("return {\n    ok: true,"), codigoAction.indexOf("};", codigoAction.indexOf("return {\n    ok: true,")));
    assert.doesNotMatch(bloqueOk, /costoHotelTotal|costoVueloTotal|costoServiciosTotal|aportePvp|proveedorHotel|serviciosIncluidos\b|snapshot|habitaciones/i);
    const rechazo = codigoAction.slice(codigoAction.indexOf("if (!resultado.ok)"), codigoAction.indexOf("return {\n    ok: true,"));
    assert.match(rechazo, /return \{ ok: false, codigo: resultado\.codigo, mensaje: mensajePublico\(resultado\.codigo, resultado\.mensaje\) \};/);
    assert.doesNotMatch(rechazo, /costoHotelTotal|costoVueloTotal|costoServiciosTotal|aportePvp|proveedorHotel|serviciosIncluidos\b|snapshot|habitaciones:/i);
  });
});

describe("cotizacionBernaloActions.ts — nunca confía en el navegador", () => {
  test("el error_interno de forma inválida se devuelve ANTES de tocar el servicio interno", () => {
    const posPaqueteCheck = fuenteAction.indexOf('typeof input.paqueteId !== "number"');
    const posServicio = fuenteAction.indexOf("await computarReservaBernalo(");
    assert.notEqual(posPaqueteCheck, -1);
    assert.ok(posPaqueteCheck < posServicio);
  });
});

describe("cotizacionBernaloActions.ts — reutiliza Fase 3D/3F-1, no reimplementa nada", () => {
  test("importa validarHabitacionesOcupacion (3D) y validarSalidaSeleccionadaBernalo (3F-1)", () => {
    assert.match(codigoAction, /import\s*\{[\s\S]*validarHabitacionesOcupacion[\s\S]*\}\s*from\s*"@\/lib\/reservar\/ocupacionPorHabitacion"/);
    assert.match(codigoAction, /import\s*\{[\s\S]*validarSalidaSeleccionadaBernalo[\s\S]*\}\s*from\s*"@\/lib\/reservar\/solicitudAlojamientoBernalo"/);
  });

  test("no llama ninguna función de carrito/checkout (sin salida hacia carrito/contrato)", () => {
    assert.doesNotMatch(codigoAction, /crearCotizacionCarrito|crearSolicitudReserva|useCart|\.add\(/);
    assert.doesNotMatch(codigoAction, /computarReserva\(/); // el legado persona, distinto de computarReservaBernalo
  });
});

describe("lib/tarifario/datosBernalo.ts — descubrimiento paralelo, sin tarifario_resultado, sin precio", () => {
  test("nunca consulta tarifario_resultado/tarifario_resumen", () => {
    assert.doesNotMatch(codigoDiscovery, /tarifario_resultado|tarifario_resumen/);
  });

  test("filtra por armado_paquetes.activo=true — mismo criterio que el tarifario público", () => {
    assert.match(codigoDiscovery, /\.eq\("activo", true\)/);
  });

  test("filtra por modelo_tarifario === 'unidad' — nunca lista hoteles persona", () => {
    assert.match(codigoDiscovery, /modelo_tarifario !== "unidad"/);
  });

  test("el tipo de salida (hotel descubierto) NO tiene ningún campo de precio (pvp/precio/tarifa/neto/bruto) — tampoco en SalidaAereaBernalo", () => {
    const tipoSalida = fuenteDiscovery.slice(
      fuenteDiscovery.indexOf("export type HotelBernaloDescubierto"),
      fuenteDiscovery.indexOf("export type ResultadoHotelesBernaloDescubiertos")
    );
    assert.doesNotMatch(tipoSalida, /pvp|precio|tarifa|neto|bruto/i);
    const tipoSalidaAerea = fuenteDiscovery.slice(
      fuenteDiscovery.indexOf("export type SalidaAereaBernalo"),
      fuenteDiscovery.indexOf("export type HotelBernaloDescubierto")
    );
    assert.doesNotMatch(tipoSalidaAerea, /pvp|precio|tarifa|neto|bruto/i);
  });

  test("usa createAdminClient (mismo cliente que ya usan los loaders públicos existentes, cargarDatosTarifario/cargarResumenTarifario)", () => {
    assert.match(codigoDiscovery, /createAdminClient\(\)/);
  });

  test("expone la moneda del hotel como nullable (nunca colapsada a COP por defecto)", () => {
    assert.match(codigoDiscovery, /moneda:\s*"COP" \| "USD" \| null/);
  });

  test("las salidas se calculan con los MISMOS filtros exactos que el generador legado (fecha completa; empaquetado activo+vigente)", () => {
    assert.match(codigoDiscovery, /!b\.fecha_ida \|\| !b\.fecha_regreso/);
    assert.match(codigoDiscovery, /!e\.activo \|\| !e\.fecha_ida \|\| !e\.fecha_regreso/);
    assert.match(codigoDiscovery, /empaquetadoVigente\(e\.compra_inicio, e\.compra_fin, hoy\)/);
  });
});
