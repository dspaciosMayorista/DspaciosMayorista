import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
  test("la consulta inicial a tarifario_resultado revisa su error antes de construir `pares`", () => {
    assert.match(cuerpo, /const \{ data: filas, error: filasErr \} = await q;/);
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
    const idx = buscadorBooking.indexOf("resultadosFiltrados.length === 0 ?");
    const idxSug = buscadorBooking.indexOf("sugerenciasFecha", idx);
    const idxElse = buscadorBooking.indexOf(") : (", idx);
    assert.ok(idx > -1 && idxSug > idx && idxSug < idxElse, "sugerenciasFecha debe renderizarse dentro de la rama de 0 resultados");
  });
});

