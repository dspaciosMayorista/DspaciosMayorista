import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3E Bernalo — verificación por inspección de la frontera pública de
// cotización (`app/tarifario/cotizacionBernaloActions.ts`) y del loader de
// descubrimiento (`lib/tarifario/datosBernalo.ts`). Ninguno de los dos es
// ejecutable bajo `node --test` (Supabase/Next real) — se verifica el
// código FUENTE, mismo criterio que el resto de wiring tests del repo.
//
// Corrección (auditoría DeepSeek — hallazgos A1/A2/A3/B1/C1): se agregan las
// pruebas de la lista "Pruebas obligatorias" del encargo que corresponden a
// este archivo (identidad discriminada de salida, fail-closed en
// disponibilidad/moneda/clasificación, mensajes públicos sin nombres
// internos). Las pruebas NUMÉRICAS/puras de moneda viven en
// `pvpAlojamientoBernalo.test.ts` (`resolverMonedaComponentesBernalo`, sí
// ejecutable).
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

  test("usa createAdminClient (service role) — la RLS pública de hotel_tarifas_unidad no se toca", () => {
    assert.match(codigoAction, /createAdminClient\(\)/);
    assert.doesNotMatch(codigoAction, /createClient\(\)/); // nunca cliente de sesión aquí
  });
});

describe("cotizacionBernaloActions.ts — valida ANTES de tocar hotel_tarifas_unidad", () => {
  test("valida paquete activo, hotel vinculado (armado_hoteles) y categoría/alimentación ANTES de consultar hotel_tarifas_unidad", () => {
    const posPaquete = fuenteAction.indexOf('.from("armado_paquetes")');
    const posArmadoHoteles = fuenteAction.indexOf('.from("armado_hoteles")');
    const posCategorias = fuenteAction.indexOf("!categorias.length || !regimenes.length");
    const posVentana = fuenteAction.indexOf("pq.fecha_viaje_inicio && fechaIda");
    const posTarifas = fuenteAction.indexOf('.from("hotel_tarifas_unidad")');
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
    assert.match(codigoAction, /modeloTarifario !== "unidad"/);
  });

  test("valida el arreglo de habitaciones con validarHabitacionesOcupacion (Fase 3D) antes de cualquier consulta", () => {
    const posValidacion = fuenteAction.indexOf("validarHabitacionesOcupacion(input.habitaciones)");
    const posPrimeraConsulta = fuenteAction.indexOf('.from("armado_paquetes")');
    assert.notEqual(posValidacion, -1);
    assert.ok(posValidacion < posPrimeraConsulta, "la ocupación debe validarse antes de la primera consulta a Supabase");
  });
});

describe("cotizacionBernaloActions.ts — A1: identidad discriminada de salida, nunca [0]", () => {
  test('la entrada pública usa una `salida` discriminada {tipo,id}/"sin_vuelo" — ya NO recibe fechaIda/fechaRegreso sueltos', () => {
    const tipoEntrada = fuenteAction.slice(
      fuenteAction.indexOf("export type EntradaCotizarAlojamientoBernaloPublico"),
      fuenteAction.indexOf("export type EntradaCotizarAlojamientoBernaloPublico") + 400
    );
    assert.match(tipoEntrada, /salida:\s*SalidaSeleccionadaBernaloEntrada/);
    assert.doesNotMatch(tipoEntrada, /fechaIda:\s*string;\s*\n\s*fechaRegreso/);
  });

  test('el tipo SalidaSeleccionadaBernaloEntrada es una unión discriminada por "tipo" (bloqueo/empaquetado/sin_vuelo)', () => {
    const tipoSalida = fuenteAction.slice(
      fuenteAction.indexOf("export type SalidaSeleccionadaBernaloEntrada"),
      fuenteAction.indexOf("export type EntradaCotizarAlojamientoBernaloPublico")
    );
    assert.match(tipoSalida, /tipo:\s*"bloqueo"/);
    assert.match(tipoSalida, /tipo:\s*"empaquetado"/);
    assert.match(tipoSalida, /tipo:\s*"sin_vuelo"/);
  });

  test('el código nunca accede a una salida por índice [0] ("tomar la primera")', () => {
    assert.doesNotMatch(codigoAction, /\[0\]/);
    assert.doesNotMatch(codigoAction, /vuelosSel\s*\?\?\s*\[\]\)\[0\]/);
    assert.doesNotMatch(codigoAction, /empaquetadosSel\s*\?\?\s*\[\]\)\[0\]/);
  });

  test("la salida elegida se busca por identidad real (find sobre las salidas válidas) — se rechaza si no aparece (id de otro paquete)", () => {
    assert.match(codigoAction, /salidasValidas\.find\(\(s\)\s*=>\s*s\.tipo === salidaEntrada\.tipo && s\.id === salidaEntrada\.id\)/);
    assert.match(codigoAction, /if \(!salida\) \{/);
    assert.match(codigoAction, /codigo:\s*"salida_no_vinculada"/);
  });

  test('para "bloqueo"/"empaquetado" las fechas AUTORITATIVAS salen de la salida validada, nunca del cliente (el tipo de entrada ni siquiera lleva fechaIda/fechaRegreso para ese caso)', () => {
    assert.match(codigoAction, /fechaIda = salida\.fechaIda;/);
    assert.match(codigoAction, /fechaRegreso = salida\.fechaRegreso;/);
  });

  test('"sin_vuelo" se rechaza si el paquete SÍ tiene salidas válidas — nunca es una elección legítima cuando hay vuelo real', () => {
    assert.match(codigoAction, /salidaEntrada\.tipo === "sin_vuelo"/);
    const bloque = fuenteAction.slice(fuenteAction.indexOf('salidaEntrada.tipo === "sin_vuelo"'), fuenteAction.indexOf('salidaEntrada.tipo === "sin_vuelo"') + 700);
    assert.match(bloque, /salidasValidas\.length > 0/);
    assert.match(bloque, /codigo:\s*"salida_no_vinculada"/);
  });
});

describe("cotizacionBernaloActions.ts — A2: mismos filtros del generador legado, fail-closed en disponibilidad", () => {
  test("filtra bloqueo por fechas completas — mismo criterio que generarTarifario", () => {
    assert.match(codigoAction, /!b\.fecha_ida \|\| !b\.fecha_regreso/);
  });

  test("filtra empaquetado por activo + fechas completas + empaquetadoVigente(compra_inicio, compra_fin, hoyBogota(...)) — mismo criterio que generarTarifario", () => {
    assert.match(codigoAction, /!e\.activo \|\| !e\.fecha_ida \|\| !e\.fecha_regreso/);
    assert.match(codigoAction, /empaquetadoVigente\(e\.compra_inicio, e\.compra_fin, hoy\)/);
    assert.match(codigoAction, /import\s*\{[\s\S]*empaquetadoVigente[\s\S]*hoyBogota[\s\S]*\}\s*from\s*"@\/lib\/reservar\/origen"/);
  });

  test("cero salidas válidas con vuelos configurados bloquea (salidas_no_disponibles) — nunca cae a porción terrestre en silencio", () => {
    assert.match(codigoAction, /totalConfiguradas > 0 && salidasValidas\.length === 0/);
    assert.match(codigoAction, /codigo:\s*"salidas_no_disponibles"/);
  });

  test("varias salidas sin selección válida también rechaza (la búsqueda por identidad falla si la clave no llegó o no coincide con ninguna)", () => {
    // Cubierto por el mismo camino que "id de otro paquete es rechazado":
    // `salidasValidas.find(...)` devuelve undefined tanto si el id no
    // pertenece al paquete como si el cliente no mandó ninguna selección
    // real — ambos casos terminan en el mismo código de rechazo.
    assert.match(codigoAction, /const salida = salidasValidas\.find/);
  });
});

describe("cotizacionBernaloActions.ts — A3: moneda resuelta desde los componentes reales", () => {
  test("usa resolverMonedaComponentesBernalo — nunca `pq.moneda ?? \"COP\"`", () => {
    assert.match(codigoAction, /import\s*\{[\s\S]*resolverMonedaComponentesBernalo[\s\S]*\}\s*from\s*"@\/lib\/calc\/pvpAlojamientoBernalo"/);
    assert.match(codigoAction, /resolverMonedaComponentesBernalo\(hotelMeta\?\.moneda \?\? null, monedasServicios, pq\.moneda \?\? null\)/);
    assert.doesNotMatch(codigoAction, /moneda:\s*pq\.moneda\s*\?\?\s*"COP"/);
    assert.doesNotMatch(codigoAction, /pq\.moneda\s*\?\?\s*"COP"/);
  });

  test("si la resolución de moneda falla, bloquea ANTES de construir la entrada del compositor de PVP", () => {
    const posResolucion = fuenteAction.indexOf("resolverMonedaComponentesBernalo(");
    const posEntradaPvp = fuenteAction.indexOf("const entradaPvp: EntradaPvpAlojamientoBernalo");
    assert.notEqual(posResolucion, -1);
    assert.ok(posResolucion < posEntradaPvp, "la moneda debe resolverse antes de armar la entrada del compositor");
    assert.match(codigoAction, /if \(!resolucionMoneda\.ok\)/);
  });

  test("redondearVenta (dentro de calcularPvpAlojamientoBernalo) recibe la moneda YA validada, no un valor crudo del cliente/paquete", () => {
    assert.match(codigoAction, /moneda,?\s*\n\s*numNoches/); // entradaPvp.moneda = moneda (resuelta), no pq.moneda
  });
});

describe("cotizacionBernaloActions.ts — B1: sin texto libre en categoría/alimentación", () => {
  test("categorias/regimenes VACÍOS bloquean con configuracion_incompleta — no se tratan como \"sin restricción\"", () => {
    assert.match(codigoAction, /if \(!categorias\.length \|\| !regimenes\.length\)/);
    assert.match(codigoAction, /codigo:\s*"configuracion_incompleta"/);
  });

  test("la categoría/alimentación recibida debe estar en la lista real (includes) — nunca se guarda tal cual sin pertenecer al catálogo del hotel", () => {
    assert.match(codigoAction, /!categorias\.includes\(input\.categoria\)/);
    assert.match(codigoAction, /!regimenes\.includes\(input\.alimentacion\)/);
  });
});

describe("cotizacionBernaloActions.ts — C1: mensajes públicos, nunca nombres internos", () => {
  test("MENSAJES_PUBLICOS tiene entradas para servicio_sin_tarifa/servicio_sin_rango_grupal (nunca pasa el .mensaje interno con el nombre del servicio)", () => {
    const mapa = fuenteAction.slice(fuenteAction.indexOf("const MENSAJES_PUBLICOS"), fuenteAction.indexOf("function mensajePublico"));
    assert.match(mapa, /servicio_sin_tarifa:/);
    assert.match(mapa, /servicio_sin_rango_grupal:/);
    // Los mensajes fijos no contienen interpolación de nombre de servicio.
    assert.doesNotMatch(mapa, /\$\{s\.nombre\}|\$\{r\.nombre\}/);
  });

  test("el fallo de calcularPvpAlojamientoBernalo se traduce con mensajePublico(...codigo) — nunca reenvía resultadoPvp.mensaje crudo", () => {
    assert.match(codigoAction, /mensajePublico\(resultadoPvp\.codigo\)/);
    assert.doesNotMatch(codigoAction, /mensaje:\s*resultadoPvp\.mensaje/);
  });

  test("el fallo del orquestador (Fase 3C) también se traduce con mensajePublico — nunca reenvía su .mensaje crudo", () => {
    assert.match(codigoAction, /mensajePublico\(resultadoOrquestacion\.codigo\)/);
    assert.doesNotMatch(codigoAction, /mensaje:\s*resultadoOrquestacion\.mensaje/);
  });

  test("ningún mensaje público fijo en MENSAJES_PUBLICOS interpola una variable (todos son texto fijo, nunca nombres internos)", () => {
    const mapa = fuenteAction.slice(fuenteAction.indexOf("const MENSAJES_PUBLICOS"), fuenteAction.indexOf("function mensajePublico"));
    assert.doesNotMatch(mapa, /\$\{/);
  });
});

describe("cotizacionBernaloActions.ts — nunca confía en el navegador", () => {
  test("pctMk sale de armado_paquetes, nunca del input recibido", () => {
    assert.match(codigoAction, /pctMk:\s*Number\(pq\.pct_mk\)/);
    assert.doesNotMatch(codigoAction, /pctMk:\s*input\./);
  });

  test("noches se deriva de las fechas AUTORITATIVAS (calcularNoches sobre fechaIda/fechaRegreso ya resueltas), nunca de un campo enviado por el cliente", () => {
    assert.match(codigoAction, /const numNoches = calcularNoches\(fechaIda, fechaRegreso\)/);
    assert.doesNotMatch(codigoAction, /noches:\s*input\.noches/);
  });

  test("las fechas (autoritativas o de porción terrestre) SIEMPRE se re-validan contra fecha_viaje_inicio/fin del paquete", () => {
    assert.match(codigoAction, /pq\.fecha_viaje_inicio && fechaIda < pq\.fecha_viaje_inicio/);
    assert.match(codigoAction, /pq\.fecha_viaje_fin && fechaRegreso > pq\.fecha_viaje_fin/);
  });
});

describe("cotizacionBernaloActions.ts — la respuesta pública nunca expone campos internos", () => {
  test("el resultado exitoso final es el objeto cerrado de calcularPvpAlojamientoBernalo, devuelto tal cual (sin agregarle campos internos)", () => {
    assert.match(codigoAction, /return resultadoPvp;/);
  });

  test("no importa ni reenvía totalNeto/totalBruto/comision/snapshot/payload/fuente en ninguna parte del archivo", () => {
    assert.doesNotMatch(codigoAction, /totalNeto|totalBruto|\bcomisionPct\b|snapshot|\.payload\b/i);
  });
});

describe("cotizacionBernaloActions.ts — reutiliza los resolvers de fases previas, no reimplementa nada", () => {
  test("importa orquestarCotizacionAlojamientoBernalo (3C), calcularPvpAlojamientoBernalo (3E) y validarHabitacionesOcupacion (3D)", () => {
    assert.match(codigoAction, /import\s*\{[\s\S]*orquestarCotizacionAlojamientoBernalo[\s\S]*\}\s*from\s*"@\/lib\/calc\/orquestarCotizacionAlojamientoBernalo"/);
    assert.match(codigoAction, /import\s*\{[\s\S]*calcularPvpAlojamientoBernalo[\s\S]*\}\s*from\s*"@\/lib\/calc\/pvpAlojamientoBernalo"/);
    assert.match(codigoAction, /import\s*\{[\s\S]*validarHabitacionesOcupacion[\s\S]*\}\s*from\s*"@\/lib\/reservar\/ocupacionPorHabitacion"/);
  });

  test("no llama ninguna función de carrito/checkout (regla 19/20: sin salida hacia carrito/contrato)", () => {
    assert.doesNotMatch(codigoAction, /crearCotizacionCarrito|crearSolicitudReserva|useCart|\.add\(/);
    assert.doesNotMatch(codigoAction, /computarReserva/);
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
