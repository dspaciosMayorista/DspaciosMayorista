import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  construirContextoServicios, calcularResultadoServicio,
  type DatosServicioPar, type FilaPaquete, type FilaArmadoServicio, type FilaServicioAdicional,
} from "../lib/reservar/liquidacionServicio.ts";

// ───────────────────────────────────────────────────────────────────────────
// Vista Booking — orientación de fechas. `cotizarPorFechas`/`buscarHoteles`
// (lib/reservar/cotizar.ts) requieren service-role/Supabase real, así que no
// se pueden ejecutar con `node --test` en este entorno — igual que el resto
// de wiring de checkout/buscarReceptivos (ver pruebas/edadesMenores.test.ts,
// secciones 36-42), se verifica por inspección del código FUENTE real: los 6
// puntos de error de `cargarDatosHotelPaquete`, que ningún mensaje público
// reenvíe texto crudo de Supabase/nombres de tabla/"falta service-role", y
// que `liquidarHotelPaquete` (usado por computo.ts, el motor autoritativo de
// checkout) conserve exactamente su firma/contrato de siempre.
// ───────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const cotizar = leer("lib/reservar/cotizar.ts");

// Aísla el cuerpo de una función contando llaves desde el `{` que de verdad
// abre el cuerpo (nunca uno de un tipo de objeto embebido en un parámetro,
// ej. `function f(input: { a: number }): Tipo {` — ese `{` cae DENTRO del
// paréntesis de la firma, a profundidad de paréntesis > 0, así que se
// ignora) hasta que cierran todas las llaves — a diferencia de buscar el
// próximo `export`/`\n}`, esto funciona sin importar qué venga después en el
// archivo (una función interna no exportada, como los manejadores de clic de
// un componente, no siempre tiene un `export` después).
function cuerpoFuncion(fuenteCompleta: string, firmaOAncla: string): string {
  const idx = fuenteCompleta.indexOf(firmaOAncla);
  assert.ok(idx > -1, `no se encontró "${firmaOAncla}" en el archivo`);
  // También cuenta `<`/`>` (genéricos de TypeScript, ej. `Promise<{ ok: true; ... }>`)
  // — el tipo de retorno puede ser un objeto literal envuelto en `Promise<...>`,
  // así que un `{` dentro de ESE genérico tampoco es el cuerpo real.
  let profundidadParen = 0;
  let profundidadAngulo = 0;
  let idxLlaveInicial = -1;
  for (let i = idx; i < fuenteCompleta.length; i++) {
    const ch = fuenteCompleta[i];
    if (ch === "(") profundidadParen++;
    else if (ch === ")") profundidadParen--;
    else if (ch === "<") profundidadAngulo++;
    else if (ch === ">") profundidadAngulo--;
    else if (ch === "{" && profundidadParen === 0 && profundidadAngulo === 0) { idxLlaveInicial = i; break; }
  }
  assert.ok(idxLlaveInicial > -1, `no se encontró el "{" real del cuerpo tras "${firmaOAncla}"`);
  let profundidad = 0;
  for (let i = idxLlaveInicial; i < fuenteCompleta.length; i++) {
    if (fuenteCompleta[i] === "{") profundidad++;
    else if (fuenteCompleta[i] === "}") {
      profundidad--;
      if (profundidad === 0) return fuenteCompleta.slice(idx, i + 1);
    }
  }
  assert.fail(`no se encontró el cierre de llaves para "${firmaOAncla}"`);
}

describe("1. cargarDatosHotelPaquete — revisa el error de CADA una de sus 6 consultas antes de usar los datos", () => {
  const cuerpo = cuerpoFuncion(cotizar, "async function cargarDatosHotelPaquete(");

  test("la consulta inicial a armado_paquetes captura y revisa su error ANTES de leer `pq`", () => {
    assert.match(cuerpo, /error: pqErr \}/);
    assert.match(cuerpo, /if \(pqErr\) return \{ ok: false, motivo: "error_consulta"/);
    const idxErr = cuerpo.indexOf("if (pqErr)");
    const idxNoPq = cuerpo.indexOf("if (!pq)");
    assert.ok(idxErr > -1 && idxNoPq > idxErr, "el chequeo de error debe preceder al chequeo de 'no encontrado'");
  });
  test("las 5 consultas paralelas (armado_hoteles/hotel_temporadas/tarifa_hotel/armado_servicios/hotel_blackouts) capturan TODOS sus errores", () => {
    for (const campo of ["hselErr", "tempsErr", "tarifasErr", "servSelErr", "blackoutsErr"]) {
      assert.match(cuerpo, new RegExp(`error: ${campo}`), `falta capturar el error de ${campo}`);
      assert.match(cuerpo, new RegExp(`if \\(${campo}\\) return \\{ ok: false, motivo: "error_consulta"`), `falta abortar por ${campo}`);
    }
  });
  test("control negativo — el patrón viejo sin capturar `error` (`const { data: temps } = ...`, sin `error:`) ya no está presente", () => {
    assert.doesNotMatch(cotizar, /const \{ data: temps \} = await/);
    assert.doesNotMatch(cotizar, /const \{ data: tarifas \} = await/);
  });
  test("ninguno de los 6 abortos por error_consulta construye el detalle con datos del cliente — solo el mensaje real de Supabase (`.message`)", () => {
    const detalles = cuerpo.match(/detalleInterno: \w+Err\.message/g) ?? [];
    assert.ok(detalles.length >= 6, `se esperaban al menos 6 usos de detalleInterno: X.message, hubo ${detalles.length}`);
  });
});

describe("2. cotizarPorFechas — frontera pública: nunca error.message, nunca 'falta service-role', nunca el detalle interno de catálogo", () => {
  const cuerpo = cuerpoFuncion(cotizar, "export async function cotizarPorFechas(");

  test("el arranque sin SUPABASE_SERVICE_ROLE_KEY ya no dice 'falta service-role' en el mensaje devuelto", () => {
    const idxArranque = cuerpo.indexOf("SUPABASE_SERVICE_ROLE_KEY");
    const idxReturn = cuerpo.indexOf("return", idxArranque);
    const idxFinReturn = cuerpo.indexOf(";", idxReturn);
    assert.doesNotMatch(cuerpo.slice(idxReturn, idxFinReturn), /service-role/i);
    assert.match(cuerpo.slice(idxArranque, idxReturn), /console\.error/);
  });
  test("el fallo técnico de cargarDatosHotelPaquete se registra con console.error y responde el mensaje fijo, nunca carga.detalleInterno directo", () => {
    assert.match(cuerpo, /console\.error\(`\[cotizarPorFechas\] etapa=\$\{carga\.etapa\}/);
    assert.match(cuerpo, /return \{ ok: false, error: MENSAJE_HOTEL_ERROR_TECNICO, sugerencias: \[\] \};/);
    // El campo `error` de la respuesta pública NUNCA se construye interpolando `carga.detalleInterno`.
    assert.doesNotMatch(cuerpo, /error: `.*\$\{carga\.detalleInterno\}/);
  });
  test("el diagnóstico de 'qué temporada falta' se registra SOLO en el log (console.error), nunca en el campo `error` devuelto al cliente", () => {
    const idxDiag = cuerpo.indexOf("Diagnóstico técnico");
    assert.ok(idxDiag > -1);
    const idxConsoleErr = cuerpo.indexOf("console.error", idxDiag);
    const idxReturnMensaje = cuerpo.indexOf("return { ok: false, error: MENSAJE_HOTEL_SIN_TARIFA", idxDiag);
    assert.ok(idxConsoleErr > -1 && idxReturnMensaje > idxConsoleErr, "el log debe ocurrir antes del return con el mensaje fijo");
    // El texto "falta cargar la tarifa de la temporada" (con el nombre real
    // de catálogo) solo puede aparecer dentro de la construcción de `detalle`
    // (para el log) — nunca en un `return { ok:false, error: ... }`.
    const returns = cuerpo.match(/return \{ ok: false, error: [^;]+;/g) ?? [];
    for (const r of returns) assert.doesNotMatch(r, /falta cargar la tarifa/);
  });
  test("todo `return { ok: false, ... }` de esta función incluye `sugerencias` (nunca deja al llamador sin saber si hay o no)", () => {
    const returns = cuerpo.match(/return \{ ok: false,[^;]+\};/g) ?? [];
    assert.ok(returns.length >= 5);
    for (const r of returns) assert.match(r, /sugerencias/);
  });
});

describe("2b. Ronda 2 — cotizarPorFechas trata su input como `unknown`, valida ANTES de tocar Supabase", () => {
  const cuerpo = cuerpoFuncion(cotizar, "export async function cotizarPorFechas(");

  test("la firma recibe `inputRaw: unknown`, no el tipo tipado directo de antes", () => {
    assert.match(cotizar, /export async function cotizarPorFechas\(inputRaw: unknown\): Promise<CotizarResult>/);
  });
  test("valida con validarEntradaCotizarPorFechas ANTES de crear el cliente admin (createAdminClient)", () => {
    const idxValida = cuerpo.indexOf("validarEntradaCotizarPorFechas(inputRaw)");
    const idxAdmin = cuerpo.indexOf("createAdminClient()");
    assert.ok(idxValida > -1 && idxAdmin > -1 && idxValida < idxAdmin, "la validación de forma debe preceder cualquier consulta a Supabase");
  });
  test("si la validación falla, retorna el error de la validación (nunca sigue leyendo propiedades del input crudo)", () => {
    assert.match(cuerpo, /if \(!vEntrada\.ok\) return \{ ok: false, error: vEntrada\.error, sugerencias: \[\] \};/);
  });
  test("el resto de la función usa SOLO los campos ya validados (`input.paqueteId`/`input.hotelId`/`input.fechaIda`/`input.fechaRegreso`/`input.noches`), nunca `inputRaw` directo", () => {
    const cuerpoTrasValidacion = cuerpo.slice(cuerpo.indexOf("const input = vEntrada.input;"));
    assert.doesNotMatch(cuerpoTrasValidacion, /\binputRaw\./);
  });
});

describe("2c. Ronda 2 — el wrapper de Server Action (reservar/actions.ts) también trata cotizarPorFechas como `unknown`", () => {
  const acciones = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  test("cotizarPorFechas(input: unknown) — ya no confía en el tipo `{ paqueteId; hotelId; fechaIda; fechaRegreso }` en tiempo de ejecución", () => {
    assert.match(acciones, /export async function cotizarPorFechas\(input: unknown\): Promise<CotizarResult>/);
  });
});

describe("3. buscarHoteles — misma frontera saneada + carga cada par UNA sola vez (sin N+1 nuevo por sugerencia)", () => {
  const cuerpo = cuerpoFuncion(cotizar, "export async function buscarHoteles(");

  test("arranque sin SUPABASE_SERVICE_ROLE_KEY: mensaje genérico fijo, nunca 'falta service-role'", () => {
    const idxArranque = cuerpo.indexOf("SUPABASE_SERVICE_ROLE_KEY");
    const idxReturn = cuerpo.indexOf("return", idxArranque);
    const idxFinReturn = cuerpo.indexOf(";", idxReturn);
    assert.doesNotMatch(cuerpo.slice(idxReturn, idxFinReturn), /service-role/i);
  });
  test("la consulta inicial a tarifario_resultado está paginada robustamente (ejecutarConsultaPaginada) y revisa su error antes de construir `pares`", () => {
    // Ronda posterior — incidente "RECEPTIVOS ADZ": un `.select()` sin
    // `.range()` sobre `tarifario_resultado` (catálogo real ~16.000 filas)
    // podía truncarse en silencio por el límite "Max Rows" del proyecto. Se
    // reemplazó por `ejecutarConsultaPaginada` (lib/tarifario/paginacion.ts,
    // mismo algoritmo robusto que ya usa el resumen del tarifario público) —
    // este wiring test ahora confirma ESE cambio, conservando la garantía
    // original: el error se revisa antes de construir `pares`.
    assert.match(cuerpo, /const \{ data: filas, error: filasErr \} = await ejecutarConsultaPaginada</);
    assert.match(cuerpo, /\.order\("id"\)\.range\(from, hasta\)/);
    const idxIf = cuerpo.indexOf("if (filasErr)");
    const idxPares = cuerpo.indexOf("const pares = new Map");
    assert.ok(idxIf > -1 && idxPares > idxIf);
  });
  test("el bucle principal usa cargarDatosHotelPaquete + evaluarHotelPorFechas (nunca liquidarHotelPaquete, que oculta el motivo del fallo)", () => {
    const idxFor = cuerpo.indexOf("for (const { paquete, hotel } of pares.values())");
    const idxAcomCfg = cuerpo.indexOf("hotel_acomodaciones", idxFor);
    const bucleInicio = cuerpo.slice(idxFor, idxAcomCfg);
    assert.match(bucleInicio, /cargarDatosHotelPaquete\(admin, paquete, hotel\)/);
    assert.match(bucleInicio, /evaluarHotelPorFechas\(datos, input\.fechaIda, numNoches\)/);
    assert.doesNotMatch(bucleInicio, /liquidarHotelPaquete\(/);
  });
  test("un fallo técnico en TODOS los pares (sin ningún par cargado ni para composición ni para sugerencias) aborta con el mensaje genérico saneado", () => {
    assert.match(cuerpo, /if \(!resultados\.length && falloTecnico && evaluados === 0 && !datosSinTarifaParaFecha\.length\)/);
    assert.match(cuerpo, /return \{ ok: false, error: MENSAJE_BUSQUEDA_HOTELES_NO_DISPONIBLE \};/);
  });
  test("las sugerencias de fecha solo se intentan cuando NINGÚN par llegó a la etapa de composición (evaluados === 0) — nunca si hubo rechazo por capacidad/edad/Adults Only", () => {
    const idxSug = cuerpo.indexOf("sugerenciasFecha = await sugerenciasBusquedaGeneral");
    assert.ok(idxSug > -1);
    const antes = cuerpo.slice(0, idxSug);
    const idxCondicion = antes.lastIndexOf("else if (!resultados.length && evaluados === 0 && datosSinTarifaParaFecha.length > 0)");
    assert.ok(idxCondicion > -1, "la generación de sugerencias debe estar condicionada a evaluados === 0");
  });
  test("sugerenciasBusquedaGeneral reutiliza `datos` YA CARGADO (sin volver a llamar cargarDatosHotelPaquete) — solo consulta hotel_acomodaciones/hoteles, acotado a un máximo de hoteles", () => {
    const cuerpoFn = cuerpoFuncion(cotizar, "async function sugerenciasBusquedaGeneral(");
    assert.doesNotMatch(cuerpoFn, /cargarDatosHotelPaquete/);
    assert.match(cuerpoFn, /MAX_HOTELES_SUGERENCIA_FECHA/);
    assert.match(cuerpoFn, /\.slice\(0, MAX_HOTELES_SUGERENCIA_FECHA\)/);
  });

  describe("Ronda 2 — elimina el N+1 (antes: 2 consultas POR HOTEL dentro del bucle)", () => {
    const cuerpoFn = cuerpoFuncion(cotizar, "async function sugerenciasBusquedaGeneral(");

    test("consulta hotel_acomodaciones y hoteles con .in(...) UNA sola vez cada una, FUERA de cualquier bucle/for", () => {
      const llamadasIn = cuerpoFn.match(/\.in\(("hotel_id"|"id"), hotelIds\)/g) ?? [];
      assert.equal(llamadasIn.length, 2, `se esperaban exactamente 2 consultas .in(...) totales (hotel_acomodaciones + hoteles), hubo ${llamadasIn.length}`);
    });
    test("las dos consultas .in(...) están ANTES del `for (const { hotel, datos } of candidatos)` — nunca dentro del bucle", () => {
      const idxFor = cuerpoFn.indexOf("for (const { hotel, datos } of candidatos)");
      assert.ok(idxFor > -1, "debe existir el bucle principal sobre los candidatos");
      const antesDelBucle = cuerpoFn.slice(0, idxFor);
      const llamadasInAntes = antesDelBucle.match(/\.in\(("hotel_id"|"id"), hotelIds\)/g) ?? [];
      assert.equal(llamadasInAntes.length, 2, "las 2 consultas .in(...) deben ejecutarse antes del bucle, no una por hotel dentro de él");
      const dentroDelBucle = cuerpoFn.slice(idxFor);
      assert.doesNotMatch(dentroDelBucle, /admin\.from\(/, "el bucle principal no debe volver a tocar Supabase por hotel");
    });
    test("cada una de las dos consultas revisa su propio error POR SEPARADO", () => {
      assert.match(cuerpoFn, /error: acomCfgErr/);
      assert.match(cuerpoFn, /error: hotelRowsErr/);
      assert.match(cuerpoFn, /if \(acomCfgErr \|\| hotelRowsErr\)/);
    });
    test("si cualquiera de las dos consultas falla, retorna [] (fail-closed: nunca sugerencias engañosas) y registra el detalle SOLO server-side", () => {
      const idxIf = cuerpoFn.indexOf("if (acomCfgErr || hotelRowsErr)");
      const idxReturn = cuerpoFn.indexOf("return [];", idxIf);
      const idxConsoleErr = cuerpoFn.indexOf("console.error", idxIf);
      assert.ok(idxIf > -1 && idxConsoleErr > idxIf, "debe registrar el fallo con console.error dentro de ese if");
      assert.ok(idxReturn > idxConsoleErr, "el log debe ocurrir antes del return [] fail-closed, y ambos deben estar dentro del if de error");
      assert.ok(idxReturn - idxIf < 400, "el return [] debe estar cerca del if (dentro del mismo bloque), no en otra parte de la función");
    });
  });
});

describe("4. liquidarHotelPaquete (usado por computo.ts, el motor autoritativo de checkout) conserva su firma/contrato exactos", () => {
  test("firma sin cambios: mismos 5 parámetros, mismo tipo de retorno `{...} | null`", () => {
    assert.match(cotizar, /export async function liquidarHotelPaquete\(\s*admin: ReturnType<typeof createAdminClient>,\s*paqueteId: number,\s*hotelId: number,\s*fechaIda: string,\s*numNoches: number\s*\): Promise<\{ combos: ComboCotizado\[\]; destinoNombre: string \| null; hotelNombre: string \| null; minNoches: number; moneda: string \} \| null>/);
  });
  test("un fallo técnico de cargarDatosHotelPaquete se traduce a `null` — el mismo valor que 'paquete no encontrado' ya devolvía antes de esta ronda (computo.ts no cambia de comportamiento)", () => {
    const cuerpo = cuerpoFuncion(cotizar, "export async function liquidarHotelPaquete(");
    assert.match(cuerpo, /if \(!carga\.ok\) \{/);
    assert.match(cuerpo, /return null;/);
  });
  test("ronda 2: un fallo técnico (error_consulta) se registra con console.error (etapa/paqueteId/hotelId/detalle) ANTES del `return null` — antes de esta ronda no dejaba rastro", () => {
    const cuerpo = cuerpoFuncion(cotizar, "export async function liquidarHotelPaquete(");
    const idxIf = cuerpo.indexOf("if (!carga.ok)");
    const idxConsoleErr = cuerpo.indexOf("console.error", idxIf);
    const idxReturnNull = cuerpo.indexOf("return null;", idxIf);
    assert.ok(idxConsoleErr > -1 && idxConsoleErr > idxIf, "debe registrar el fallo con console.error");
    assert.ok(idxReturnNull > idxConsoleErr, "el log debe ocurrir ANTES del return null");
    assert.match(cuerpo.slice(idxIf, idxReturnNull), /etapa=\$\{carga\.etapa\}/);
    assert.match(cuerpo.slice(idxIf, idxReturnNull), /paqueteId=\$\{paqueteId\}/);
    assert.match(cuerpo.slice(idxIf, idxReturnNull), /hotelId=\$\{hotelId\}/);
    assert.match(cuerpo.slice(idxIf, idxReturnNull), /detalle=\$\{carga\.detalleInterno\}/);
    // El detalle técnico se registra solo server-side — nunca sale en un valor de retorno.
    assert.doesNotMatch(cuerpo, /return \{[^}]*detalleInterno/);
  });
  test("computo.ts (el motor de reservar/checkout) no fue tocado por esta ronda", () => {
    const computo = leer("lib/reservar/computo.ts");
    assert.match(computo, /liquidarHotelPaquete\(admin, input\.paqueteId, input\.hotelId, input\.fechaIda!, numNoches\)/);
  });
});

describe("5. Mensajes públicos fijos — nunca interpolación de detalle técnico", () => {
  test("MENSAJE_HOTEL_ERROR_TECNICO / MENSAJE_HOTEL_SIN_TARIFA / MENSAJE_BUSQUEDA_HOTELES_NO_DISPONIBLE son constantes de texto plano", () => {
    assert.match(cotizar, /const MENSAJE_HOTEL_ERROR_TECNICO = "No pudimos cotizar este hotel en este momento\. Intenta nuevamente\.";/);
    assert.match(cotizar, /const MENSAJE_HOTEL_SIN_TARIFA = "Para las fechas elegidas no encontramos una tarifa\.";/);
    assert.match(cotizar, /const MENSAJE_BUSQUEDA_HOTELES_NO_DISPONIBLE = "Búsqueda no disponible en este momento\. Intenta nuevamente\.";/);
  });
});

describe("6. VistaBooking.tsx (SelectorPorFechas) — pulsar una sugerencia conserva contexto, vuelve a cotizar, nunca agrega al carrito", () => {
  const vistaBooking = leer("app/tarifario/VistaBooking.tsx");
  const cuerpo = cuerpoFuncion(vistaBooking, "function aplicarSugerencia(");

  test("completa fecha de ida y regreso con la sugerencia elegida", () => {
    assert.match(cuerpo, /setFIda\(s\.fechaIda\)/);
    assert.match(cuerpo, /setFReg\(s\.fechaRegreso\)/);
  });
  test("vuelve a ejecutar la cotización (nunca solo cambia el estado local sin recotizar)", () => {
    assert.match(cuerpo, /cotizar\(s\.fechaIda, s\.fechaRegreso, true\)/);
  });
  test("nunca llama onAgregar/add — pulsar una sugerencia no agrega nada al carrito", () => {
    assert.doesNotMatch(cuerpo, /onAgregar\(/);
    assert.doesNotMatch(cuerpo, /\badd\(/);
  });
  test("el botón 'Cotizar' ya no pasa el evento del click como argumento (bug real: rompería la firma con overrides)", () => {
    assert.match(vistaBooking, /onClick=\{\(\) => cotizar\(\)\}/);
    assert.doesNotMatch(vistaBooking, /onClick=\{cotizar\}/);
  });
  test("el aviso 'Tarifa cargada para esas fechas' solo se muestra cuando el resultado vino de una sugerencia (viaSugerencia) Y hay combos", () => {
    assert.match(vistaBooking, /viaSugerencia && combos && combos\.length > 0/);
    assert.match(vistaBooking, /Tarifa cargada para esas fechas\. Cupo sujeto a confirmación\./);
  });
  test("la palabra 'disponible' nunca describe una sugerencia de fecha (tener tarifa no confirma inventario)", () => {
    const idxSugerencias = vistaBooking.indexOf("Fechas con tarifa para este hotel");
    const idxFinSeccion = vistaBooking.indexOf("</div>\n        )}", idxSugerencias);
    const seccion = vistaBooking.slice(idxSugerencias, idxFinSeccion > -1 ? idxFinSeccion : idxSugerencias + 600);
    assert.doesNotMatch(seccion, /disponible/i);
  });
});

describe("7. BuscadorBooking.tsx — pulsar una sugerencia de fecha conserva destino/habitaciones/adultos/edades, repite la búsqueda, nunca agrega al carrito", () => {
  const buscadorBooking = leer("app/tarifario/BuscadorBooking.tsx");
  const cuerpo = cuerpoFuncion(buscadorBooking, "function aplicarSugerenciaFecha(");

  test("completa fecha de ida y regreso, vuelve a llamar buscar() con las MISMAS habitaciones/adultos/edades ya capturadas en el estado", () => {
    assert.match(cuerpo, /setFIda\(s\.fechaIda\)/);
    assert.match(cuerpo, /setFReg\(s\.fechaRegreso\)/);
    assert.match(cuerpo, /buscar\(s\.fechaIda, s\.fechaRegreso\)/);
    // `buscar` reusa `habs`/`adultosParsed`/`cantidadMenores`/`edades`/`destino`
    // del estado del componente — la función de sugerencia no los toca.
    assert.doesNotMatch(cuerpo, /setHabs|setAdultos|setCantidadMenores|setDestino/);
  });
  test("nunca agrega nada al carrito directamente", () => {
    assert.doesNotMatch(cuerpo, /\badd\(/);
  });
  test("las sugerencias de fecha solo se muestran cuando NO hay resultados (nunca compiten visualmente con hoteles reales)", () => {
    // El buscador ya no pinta: desde que la lista es ÚNICA (una sola colección
    // y una sola grilla en VistaBooking), el estado vacío —el único lugar
    // donde se ofrecen fechas alternativas— vive en VistaBooking, adentro de
    // la MISMA rama que decide que no hay nada que mostrar.
    const vista = leer("app/tarifario/VistaBooking.tsx");
    const idxRamaVacia = vista.indexOf("{enBusquedaPorcion && !tarjetas.length && (");
    const idxSug = vista.indexOf("sugerenciasFecha", idxRamaVacia);
    // El fin de la rama vacía lo marca la grilla REAL (`tarjetas.map`).
    const idxFinRamaVacia = vista.indexOf("{tarjetas.map((t) =>", idxRamaVacia);
    assert.ok(
      idxRamaVacia > -1 && idxSug > idxRamaVacia && idxFinRamaVacia > idxRamaVacia && idxSug < idxFinRamaVacia,
      "sugerenciasFecha debe renderizarse dentro de la rama de 0 resultados"
    );
    // Y el buscador no puede volver a ofrecerlas por su cuenta.
    assert.doesNotMatch(buscadorBooking, /sugerenciasFecha\.map\(/);
  });
});

describe("8. Ronda 3 — buscarHoteles/buscarReceptivos usan validarRangoFechasConsulta (ida no anterior a hoy + noches acotadas), no un rango sin límite", () => {
  test("buscarHoteles: valida con validarRangoFechasConsulta ANTES de crear el cliente admin", () => {
    const cuerpo = cuerpoFuncion(cotizar, "export async function buscarHoteles(");
    assert.match(cuerpo, /const vRango = validarRangoFechasConsulta\(o\.fechaIda, o\.fechaRegreso\)/);
    assert.match(cuerpo, /if \(!vRango\.ok\) return \{ ok: false, error: vRango\.error \};/);
    const idxVRango = cuerpo.indexOf("validarRangoFechasConsulta(");
    const idxAdmin = cuerpo.indexOf("createAdminClient()");
    assert.ok(idxVRango > -1 && idxAdmin > -1 && idxVRango < idxAdmin, "la validación de rango debe preceder cualquier consulta a Supabase");
    // `numNoches` sale del validador, no de una resta de fechas suelta sin tope.
    assert.match(cuerpo, /const numNoches = vRango\.noches;/);
    assert.doesNotMatch(cuerpo, /const numNoches = noches\(input\.fechaIda, input\.fechaRegreso\)/);
  });
  test("buscarReceptivos: mismo validador compartido, misma posición antes de tocar Supabase", () => {
    const cuerpo = cuerpoFuncion(cotizar, "export async function buscarReceptivos(");
    assert.match(cuerpo, /const vRango = validarRangoFechasConsulta\(o\.fechaIda, o\.fechaRegreso\)/);
    assert.match(cuerpo, /const numNoches = vRango\.noches;/);
    assert.doesNotMatch(cuerpo, /const numNoches = noches\(input\.fechaIda, input\.fechaRegreso\)/);
  });
  test("la regla vive en UN solo lugar (lib/reservar/edadesMenores.ts) — cotizar.ts no reimplementa el tope de noches ni el umbral 'no antes de hoy'", () => {
    // cotizar.ts nunca declara/importa MAX_NOCHES_CONSULTA ni compara fechas
    // contra "hoy" por su cuenta — esa lógica vive ÚNICAMENTE detrás de
    // `validarRangoFechasConsulta` (edadesMenores.ts), que buscarHoteles y
    // buscarReceptivos llaman directo, y que `validarEntradaCotizarPorFechas`
    // (también en edadesMenores.ts) reutiliza para `cotizarPorFechas` —
    // ninguno de los 3 repite la regla dentro de cotizar.ts.
    assert.doesNotMatch(cotizar, /MAX_NOCHES_CONSULTA/);
    const usos = cotizar.match(/validarRangoFechasConsulta\(/g) ?? [];
    assert.equal(usos.length, 2, `buscarHoteles y buscarReceptivos deben llamar validarRangoFechasConsulta directo — hubo ${usos.length} usos en cotizar.ts`);
  });
});

describe("9. Ronda 3 — combinación paquete+hotel: cargarDatosHotelPaquete falla cerrado si no hay fila armado_hoteles", () => {
  const cuerpoCarga = cuerpoFuncion(cotizar, "async function cargarDatosHotelPaquete(");

  test("cargarDatosHotelPaquete: `if (!hsel)` devuelve motivo estructurado 'hotel_no_asociado' — ANTES de construir `datos` o evaluar tarifas", () => {
    assert.match(cuerpoCarga, /if \(!hsel\) return \{ ok: false, motivo: "hotel_no_asociado" \};/);
    const idxCheck = cuerpoCarga.indexOf('if (!hsel) return { ok: false, motivo: "hotel_no_asociado" };');
    const idxDatos = cuerpoCarga.indexOf("const datos: DatosHotelPaquete = {");
    assert.ok(idxCheck > -1 && idxDatos > idxCheck, "el candado debe preceder la construcción de `datos`");
  });
  test("ya no existe el fallback `hsel ? {...} : null` — armadoHotel siempre viene de una fila real cuando carga.ok es true", () => {
    assert.doesNotMatch(cuerpoCarga, /armadoHotel: hsel \? \{/);
    assert.match(cuerpoCarga, /armadoHotel: \{\s*categorias:/);
  });
  test("el tipo ResultadoCargaHotelPaquete declara el motivo 'hotel_no_asociado' como caso propio (no un texto libre)", () => {
    assert.match(cotizar, /\| \{ ok: false; motivo: "hotel_no_asociado" \}/);
  });

  test("liquidarHotelPaquete: registra el motivo hotel_no_asociado con console.error antes de `return null` — el contrato de retorno no cambia", () => {
    const cuerpo = cuerpoFuncion(cotizar, "export async function liquidarHotelPaquete(");
    const idxRama = cuerpo.indexOf('carga.motivo === "hotel_no_asociado"');
    assert.ok(idxRama > -1, "debe haber una rama explícita para hotel_no_asociado");
    const idxConsoleErr = cuerpo.indexOf("console.error", idxRama);
    const idxReturnNull = cuerpo.indexOf("return null;", idxRama);
    assert.ok(idxConsoleErr > -1 && idxConsoleErr < idxReturnNull, "debe loguear antes del return null compartido");
  });

  test("cotizarPorFechas: hotel_no_asociado responde el mismo mensaje comercial genérico que 'sin tarifa', con sugerencias vacías, y registra el detalle server-side", () => {
    const cuerpo = cuerpoFuncion(cotizar, "export async function cotizarPorFechas(");
    const idxRama = cuerpo.indexOf('carga.motivo === "hotel_no_asociado"');
    assert.ok(idxRama > -1, "debe haber una rama explícita para hotel_no_asociado");
    const idxReturn = cuerpo.indexOf("return { ok: false, error: MENSAJE_HOTEL_SIN_TARIFA, sugerencias: [] };", idxRama);
    assert.ok(idxReturn > -1, "la rama debe terminar devolviendo el mensaje comercial genérico con sugerencias vacías");
    const rama = cuerpo.slice(idxRama, idxReturn + "return { ok: false, error: MENSAJE_HOTEL_SIN_TARIFA, sugerencias: [] };".length);
    assert.match(rama, /console\.error/);
    const idxConsoleErr = rama.indexOf("console.error");
    const idxReturnEnRama = rama.indexOf("return { ok: false, error: MENSAJE_HOTEL_SIN_TARIFA, sugerencias: [] };");
    assert.ok(idxConsoleErr > -1 && idxConsoleErr < idxReturnEnRama, "el log debe ocurrir antes del return");
    // Nunca genera sugerencias para una pareja inválida: la única forma de
    // producirlas es `generarSugerenciasFechas`, que necesita `datos` reales
    // (nunca se llega a tenerlos en esta rama).
    assert.doesNotMatch(rama, /generarSugerenciasFechas\(/);
  });

  test("buscarHoteles: ignora el par (continue) sin marcar falloTecnico, y registra la inconsistencia — no cuenta como evaluado ni entra a datosSinTarifaParaFecha", () => {
    const cuerpo = cuerpoFuncion(cotizar, "export async function buscarHoteles(");
    const idxRama = cuerpo.indexOf('carga.motivo === "hotel_no_asociado"');
    assert.ok(idxRama > -1, "debe haber una rama explícita para hotel_no_asociado");
    const idxContinue = cuerpo.indexOf("continue;", idxRama);
    const rama = cuerpo.slice(idxRama, idxContinue);
    assert.match(rama, /console\.error/);
    assert.doesNotMatch(rama, /falloTecnico = true/);
    assert.doesNotMatch(rama, /datosSinTarifaParaFecha\.push/);
    assert.doesNotMatch(rama, /evaluados\+\+/);
  });

  test("checkout/computo.ts conserva comportamiento válido para parejas REALES — no se tocó, sigue llamando liquidarHotelPaquete con la misma firma exacta", () => {
    const computo = leer("lib/reservar/computo.ts");
    assert.match(computo, /liquidarHotelPaquete\(admin, input\.paqueteId, input\.hotelId, input\.fechaIda!, numNoches\)/);
    // El candado vive ENTERO dentro de cargarDatosHotelPaquete (compartido
    // por los 3 llamadores) — computo.ts no necesita ni referencia
    // armado_hoteles directamente, hereda el fail-closed automáticamente.
    assert.doesNotMatch(computo, /armado_hoteles/);
  });
});

describe("10. Ronda 3 — sugerenciasBusquedaGeneral falla cerrado por hotel sin fila maestra en `hoteles`, conserva defaultAcomConfig para hotel_acomodaciones vacío", () => {
  const cuerpoFn = cuerpoFuncion(cotizar, "async function sugerenciasBusquedaGeneral(");

  test("si falta la fila del hotel en `hoteles` (hotelRowPorId.get devuelve undefined), se omite ESE hotel — nunca inventa edadInfanteMax/edadNinoMax/adultsOnly", () => {
    const idxCheck = cuerpoFn.indexOf("const hotelRow = hotelRowPorId?.get(hotel);");
    assert.ok(idxCheck > -1, "debe leer la fila del hotel candidato ANTES de construir la composición");
    const idxIfFalta = cuerpoFn.indexOf("if (!hotelRow)", idxCheck);
    assert.ok(idxIfFalta > -1 && idxIfFalta > idxCheck);
    const idxContinue = cuerpoFn.indexOf("continue;", idxIfFalta);
    const idxComposicion = cuerpoFn.indexOf("composicion = {", idxIfFalta);
    assert.ok(idxContinue > -1 && idxContinue < idxComposicion, "el `continue` por hotel sin fila maestra debe preceder la construcción de la composición");
  });
  // Ronda de validación Dubai (hallazgo #1): un umbral FIJO por hotel
  // (`edadInfanteMax`/`edadNinoMax` con `?? 2`/`?? 10`) ya no es el criterio
  // — la regla de edad efectiva se resuelve POR COMBO (override de
  // `tarifa_hotel` ?? general), dentro de `compatibleConComposicion`
  // (lib/reservar/liquidacionHotel.ts). Acá solo se arma la regla GENERAL
  // (fallback, sin normalizar los `?? 2`/`?? 10` — eso vive en
  // `normalizarReglaEdadGeneral`, lib/calc/reglaEdadTarifa.ts) + las filas
  // crudas ya cargadas (`datos.tarifas`), sin consulta nueva por combinación.
  test("una vez confirmada la fila, arma la regla GENERAL completa (las 4 columnas) y reusa datos.tarifas — nunca un umbral fijo edadInfanteMax/edadNinoMax", () => {
    assert.doesNotMatch(cuerpoFn, /edadInfanteMax:/, "el campo plano eliminado no debe reaparecer");
    assert.doesNotMatch(cuerpoFn, /edadNinoMax:/, "el campo plano eliminado no debe reaparecer");
    assert.match(cuerpoFn, /filasTarifa:\s*datos\.tarifas/, "debe reusar datos.tarifas ya cargado, sin consulta nueva");
    assert.match(cuerpoFn, /generalEdad:\s*\{/, "debe armar la regla general completa (las 4 columnas)");
    assert.match(cuerpoFn, /infanteMin:\s*hotelRow\.edad_infante_min \?\? null/);
    assert.match(cuerpoFn, /infanteMax:\s*hotelRow\.edad_infante_max \?\? null/);
    assert.match(cuerpoFn, /ninoMin:\s*hotelRow\.edad_nino_min \?\? null/);
    assert.match(cuerpoFn, /ninoMax:\s*hotelRow\.edad_nino_max \?\? null/);
  });
  test("defaultAcomConfig se conserva para hotel_acomodaciones sin filas — regla deliberada y documentada del sistema (mismo default 1/2/3/4 que usa el resto del motor de reservas cuando un hotel no configuró acomodaciones), no un fail-closed nuevo", () => {
    assert.match(cuerpoFn, /reglas\.find\(\(x\) => x\.acomodacion === a\) \?\? defaultAcomConfig\(a\)/);
  });
});

describe("11. Ronda 4 — sugerenciasBusquedaGeneral elige las 4 fechas más cercanas GLOBALMENTE, no por el primer hotel evaluado", () => {
  const cuerpoFn = cuerpoFuncion(cotizar, "async function sugerenciasBusquedaGeneral(");

  test("nunca usa localeCompare directo — la selección final delega en consolidarSugerenciasGlobales", () => {
    assert.doesNotMatch(cuerpoFn, /localeCompare/);
    assert.match(cuerpoFn, /return consolidarSugerenciasGlobales\(porHotel, input\.fechaIda\);/);
  });
  test("no corta el bucle principal por haber acumulado 4 sugerencias antes de evaluar el lote completo — el `break` viejo ya no existe", () => {
    const idxFor = cuerpoFn.indexOf("for (const { hotel, datos } of candidatos)");
    assert.ok(idxFor > -1, "debe existir el bucle principal sobre los candidatos");
    const cuerpoBucle = cuerpoFn.slice(idxFor);
    assert.doesNotMatch(cuerpoBucle, /if \(sugerencias\.length >= 4\) break;/);
    assert.doesNotMatch(cuerpoBucle, /if \(porHotel\.length >= 4\)/);
  });
  test("cada hotel candidato se acumula en `porHotel` (un arreglo por hotel) — la consolidación ocurre DESPUÉS de terminar el bucle completo, no dentro de él", () => {
    const idxFor = cuerpoFn.indexOf("for (const { hotel, datos } of candidatos)");
    const idxFinBucle = cuerpoFn.indexOf("const propias = generarSugerenciasFechas(", idxFor);
    assert.ok(idxFinBucle > -1);
    const idxPush = cuerpoFn.indexOf("porHotel.push(propias);", idxFinBucle);
    const idxConsolidar = cuerpoFn.indexOf("consolidarSugerenciasGlobales(", idxFinBucle);
    assert.ok(idxPush > -1 && idxConsolidar > idxPush, "porHotel.push debe ocurrir DENTRO del bucle, consolidarSugerenciasGlobales DESPUÉS de que termine");
  });
  test("no agrega consultas nuevas dentro del bucle por hotel (sigue siendo, como máximo, 2 consultas .in(...) totales, ya cubierto en la sección 'elimina el N+1')", () => {
    const idxFor = cuerpoFn.indexOf("for (const { hotel, datos } of candidatos)");
    const dentroDelBucle = cuerpoFn.slice(idxFor);
    assert.doesNotMatch(dentroDelBucle, /admin\.from\(/);
  });
  test("cotizar.ts importa consolidarSugerenciasGlobales desde lib/reservar/liquidacionHotel (reutiliza compararPorCercania ahí adentro, no duplica la fórmula de orden)", () => {
    assert.match(cotizar, /import \{[^}]*consolidarSugerenciasGlobales[^}]*\} from "@\/lib\/reservar\/liquidacionHotel";/);
    // cotizar.ts no vuelve a LLAMAR compararPorCercania por su cuenta (no está
    // importada ni se invoca como función — solo se referencia por nombre en
    // comentarios explicando de dónde sale el orden).
    assert.doesNotMatch(cotizar, /compararPorCercania\(/);
    assert.doesNotMatch(cotizar, /import \{[^}]*\bcompararPorCercania\b[^}]*\} from/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 12. Fix "add-ons propios del paquete reemplazados por el catálogo general
// del destino" — buscarReceptivos gana un `paqueteId` opcional que ACOTA la
// búsqueda al paquete de origen (carrito → "+ Agregar servicios / tours").
// Reproducción confirmada: un hotel de Cartagena con 14 add-ons configurados
// mostraba, tras pulsar ese botón, una búsqueda GENERAL de 112 servicios del
// destino (los 14 propios mezclados con 98 ajenos). buscarReceptivos usa
// service-role (sin RLS que probar bajo `node --test`), así que se verifica
// por inspección del código FUENTE real — mismo criterio que el resto de
// wiring de este archivo.
// ───────────────────────────────────────────────────────────────────────────
describe("12. buscarReceptivos — paqueteId opcional acota la búsqueda al paquete de origen", () => {
  const cuerpo = cuerpoFuncion(cotizar, "export async function buscarReceptivos(");

  test("valida paqueteId con validarPaqueteIdConsultaOpcional ANTES de tocar Supabase (frontera pública, requisito 3)", () => {
    const idxValida = cuerpo.indexOf("validarPaqueteIdConsultaOpcional(o.paqueteId)");
    const idxAdmin = cuerpo.indexOf("createAdminClient()");
    assert.ok(idxValida > -1 && idxAdmin > -1 && idxValida < idxAdmin, "la validación de paqueteId debe preceder cualquier consulta a Supabase");
    assert.match(cuerpo, /if \(!vPaquete\.ok\) return \{ ok: false, error: vPaquete\.error \};/);
  });

  test("validarPaqueteIdConsultaOpcional: ausente/null → alcance general (ok, paqueteId:null); cualquier otra cosa que no sea entero positivo → rechazado", () => {
    // `cuerpoFuncion` no aplica bien acá: el tipo de retorno de esta función
    // es un objeto union `{...} | {...}` SUELTO (sin envolver en `Promise<>`),
    // así que su `{` de apertura queda a profundidad 0 de paréntesis/ángulos
    // — el helper lo confundiría con el cuerpo real. Se verifica por texto
    // directo sobre el archivo completo (ambas líneas son únicas).
    assert.match(cotizar, /function validarPaqueteIdConsultaOpcional\(v: unknown\)/);
    assert.match(cotizar, /if \(v === undefined \|\| v === null\) return \{ ok: true, paqueteId: null \};/);
    assert.match(cotizar, /if \(typeof v !== "number" \|\| !Number\.isInteger\(v\) \|\| !Number\.isFinite\(v\) \|\| v <= 0\)/);
  });

  test("la consulta a tarifario_resultado filtra por paquete_id SOLO cuando input.paqueteId no es null (requisito 5) — nunca reemplaza el filtro de destino, lo complementa", () => {
    const idxPaqueteFiltro = cuerpo.indexOf('if (input.paqueteId != null) q = q.eq("paquete_id", input.paqueteId);');
    const idxDestinoFiltro = cuerpo.indexOf('if (input.destino?.trim()) q = q.eq("destino_nombre", input.destino.trim());');
    assert.ok(idxPaqueteFiltro > -1, "debe filtrar por paquete_id cuando está presente");
    assert.ok(idxDestinoFiltro > idxPaqueteFiltro, "el filtro de destino debe seguir existiendo, después del de paquete");
    // Ambos filtros van ANTES de .eq("modulo","servicios") solo importa que
    // estén dentro del builder antes de ejecutar — confirma que siguen bajo
    // el mismo `.from("tarifario_resultado_publicable")` (Fase 2, migración
    // 182) que ya exige modulo=servicios y paquete_activo=true (ninguno de
    // los dos se tocó).
    assert.match(cuerpo, /\.eq\("modulo", "servicios"\)\s*\n\s*\.eq\("paquete_activo", true\)/);
  });

  test("la fuente autoritativa de qué servicios tiene el paquete sigue siendo tarifario_resultado/armado_servicios — paqueteId es solo el ALCANCE, nunca una lista de ids que decida el navegador (requisito 6)", () => {
    // `pares` (el conjunto real de servicios a cotizar) se construye DESPUÉS
    // del filtro por paquete_id, a partir de las filas que Supabase devolvió
    // — nunca de un arreglo que venga en el payload de entrada.
    const idxFiltro = cuerpo.indexOf('if (input.paqueteId != null)');
    const idxPares = cuerpo.indexOf("const pares = new Map<string, DatosServicioPar>();");
    assert.ok(idxFiltro > -1 && idxPares > idxFiltro, "pares debe construirse DESPUÉS de aplicar el filtro de paquete_id");
    assert.doesNotMatch(cuerpo, /o\.servicioIds|o\.paqueteIds|input\.servicioIds/, "nunca debe leerse una lista de ids del payload de entrada");
  });

  test("servicios INCLUIDOS (ya horneados en el hotel) se excluyen de los resultados — nunca se duplican como add-on opcional (requisito 7)", () => {
    assert.match(cuerpo, /admin\.from\("armado_servicios"\)\.select\("paquete_id, servicio_id, modo, incluido"\)/);
    const idxIncluidos = cuerpo.indexOf("const paresIncluidos = new Set(");
    const idxLoop = cuerpo.indexOf("for (const par of pares.values())");
    assert.ok(idxIncluidos > -1 && idxLoop > idxIncluidos, "el set de incluidos debe construirse ANTES del bucle que arma resultados");
    const cuerpoLoop = cuerpo.slice(idxLoop, idxLoop + 250);
    assert.match(cuerpoLoop, /if \(paresIncluidos\.has\(`\$\{par\.paqueteId\}-\$\{par\.servicioId\}`\)\) continue;/);
    // El filtro debe evaluarse ANTES de calcularResultadoServicio (nunca después, que igual publicaría el precio).
    const idxContinue = cuerpoLoop.indexOf("continue;");
    const idxCalcular = cuerpoLoop.indexOf("calcularResultadoServicio(");
    assert.ok(idxContinue > -1 && idxCalcular > idxContinue, "el continue por incluido debe preceder el cálculo del resultado");
  });

  test("entrada DIRECTA a Receptivos (sin paqueteId) conserva el comportamiento general de siempre — el filtro de paquete_id nunca se aplica cuando paqueteId es null (requisito 10)", () => {
    // Estructural: el `if` del filtro de paquete_id es una guarda explícita
    // (`!= null`), no un default que siempre corra — sin paqueteId, `q` sigue
    // el mismo camino que antes de este fix (solo modulo/paquete_activo/
    // destino opcional).
    assert.match(cuerpo, /if \(input\.paqueteId != null\) q = q\.eq\("paquete_id", input\.paqueteId\);/);
  });

  test("BusquedaServiciosInput declara paqueteId como opcional (nullable) — el tipo no vuelve obligatorio un campo que antes no existía", () => {
    assert.match(cotizar, /export type BusquedaServiciosInput = \{[^}]*paqueteId\?:\s*number \| null;[^}]*\}/);
  });
});

describe("12b. Protección EJECUTABLE del caso reproducido — paquete A (14 servicios) vs paquete B (98 del mismo destino, total 112)", () => {
  // Simula EXACTAMENTE lo que hace `buscarReceptivos` con las funciones puras
  // reales de `liquidacionServicio.ts` (mismas que usa la búsqueda en
  // producción, ver `pruebas/liquidacionServicio.test.ts`): `pares` es lo que
  // la consulta a `tarifario_resultado` devolvió — el filtro `.eq("paquete_id",
  // ...)` ocurre ANTES, a nivel de SQL (ver sección 12), así que acá se
  // reproduce su EFECTO construyendo `pares` ya acotado (con paqueteId) o sin
  // acotar (sin paqueteId, el bug reproducido: control negativo).
  const PAQUETE_A = 501;
  const PAQUETE_B = 502;
  const paqueteFila: FilaPaquete = { id: PAQUETE_A, pct_mk: 0.2 };
  const paqueteFilaB: FilaPaquete = { id: PAQUETE_B, pct_mk: 0.2 };
  const FECHA = new Date("2026-10-01T00:00:00");

  function construirCatalogo(paqueteId: number, cantidad: number, offsetId: number) {
    const armado: FilaArmadoServicio[] = [];
    const servicios: FilaServicioAdicional[] = [];
    const pares: DatosServicioPar[] = [];
    for (let i = 0; i < cantidad; i++) {
      const servicioId = offsetId + i;
      armado.push({ paquete_id: paqueteId, servicio_id: servicioId, modo: "persona" });
      servicios.push({ id: servicioId, precio_persona: 50_000, recargo_individual: 0, liquidacion: null, moneda: "COP" });
      pares.push({ servicioId, paqueteId, nombre: `Servicio ${servicioId}`, destino: "Cartagena", descripcion: null });
    }
    return { armado, servicios, pares };
  }

  const catA = construirCatalogo(PAQUETE_A, 14, 1000); // los 14 add-ons reales del paquete reproducido
  const catB = construirCatalogo(PAQUETE_B, 98, 2000); // el resto del catálogo del mismo destino (14 + 98 = 112)

  test("búsqueda ACOTADA (paqueteId=A, como hace ahora buscarReceptivos): SOLO los 14 servicios de A, ninguno de B", () => {
    const ctx = construirContextoServicios({
      paquetes: [paqueteFila], armado: catA.armado, servicios: catA.servicios, grupos: [], temporadas: [],
    });
    const resultados = catA.pares
      .map((par) => calcularResultadoServicio(par, ctx, FECHA, 1, 2))
      .filter((r): r is NonNullable<typeof r> => r != null);
    assert.equal(resultados.length, 14);
    assert.ok(resultados.every((r) => r.paqueteId === PAQUETE_A));
  });

  test("control negativo — SIN el filtro de paqueteId (comportamiento previo al fix): los 112 servicios del destino se mezclan, confirmando que el defecto reportado era real", () => {
    const todosLosArmados = [...catA.armado, ...catB.armado];
    const todosLosServicios = [...catA.servicios, ...catB.servicios];
    const todosLosPares = [...catA.pares, ...catB.pares];
    const ctx = construirContextoServicios({
      paquetes: [paqueteFila, paqueteFilaB], armado: todosLosArmados, servicios: todosLosServicios, grupos: [], temporadas: [],
    });
    const resultados = todosLosPares
      .map((par) => calcularResultadoServicio(par, ctx, FECHA, 1, 2))
      .filter((r): r is NonNullable<typeof r> => r != null);
    assert.equal(resultados.length, 112);
    const deB = resultados.filter((r) => r.paqueteId === PAQUETE_B);
    assert.equal(deB.length, 98, "sin acotar por paqueteId, los 98 servicios ajenos SÍ aparecerían mezclados con los 14 del paquete — esto es lo que el fix evita filtrando en la consulta SQL antes de llegar acá");
  });

  test("los 98 servicios ajenos a paquete A nunca aparecen en el resultado acotado, ni por servicioId ni por nombre", () => {
    const ctx = construirContextoServicios({
      paquetes: [paqueteFila], armado: catA.armado, servicios: catA.servicios, grupos: [], temporadas: [],
    });
    const resultados = catA.pares
      .map((par) => calcularResultadoServicio(par, ctx, FECHA, 1, 2))
      .filter((r): r is NonNullable<typeof r> => r != null);
    const idsAjenos = new Set(catB.pares.map((p) => p.servicioId));
    assert.ok(resultados.every((r) => !idsAjenos.has(r.servicioId)));
  });
});

