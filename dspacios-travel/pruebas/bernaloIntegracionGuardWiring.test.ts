import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3 Bernalo — guardia fail-closed (ver el informe entregado con esta
// tarea para el análisis completo de por qué el alcance quedó acotado a
// esto). Un hotel con `hoteles.modelo_tarifario = 'unidad'` administra su
// tarifa en `hotel_tarifas_unidad` (fase 2), NO en `tarifa_hotel`. Antes de
// este cambio, NADA en Reservar ni en el armado de paquetes comprobaba
// `modelo_tarifario`: un hotel migrado a Bernalo seguía silenciosamente
// costeado por `tarifa_hotel`/`tarifario_resultado` — vacío (precio $0
// invisible) o, peor, con datos VIEJOS de antes de la migración si el hotel
// usó el editor por persona primero.
//
// `computo.ts`/`paquetes/actions.ts` requieren Supabase real (`"use server"`,
// `next/headers`) — igual que el resto del wiring de este proyecto (ver
// `pruebas/serviciosPaqueteWiring.test.ts`), se verifica por inspección del
// código FUENTE real: que el chequeo ocurre ANTES de tocar cualquier tabla
// de tarifa, no solo que existe en alguna parte del archivo.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

// Extrae el cuerpo de una función balanceando llaves reales (ignora las que
// aparecen dentro de paréntesis/genéricos de la firma) — mismo criterio que
// `pruebas/serviciosPaqueteWiring.test.ts`.
function cuerpoFuncion(fuenteCompleta: string, firmaOAncla: string): string {
  const idx = fuenteCompleta.indexOf(firmaOAncla);
  assert.ok(idx > -1, `no se encontró "${firmaOAncla}" en el archivo`);
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
  throw new Error(`no se encontró el cierre del cuerpo de "${firmaOAncla}"`);
}

const computo = leer("lib/reservar/computo.ts");
const paqueteActions = leer("app/(dashboard)/dashboard/paquetes/actions.ts");

describe("computo.ts (computarReserva) — guardia modelo_tarifario ANTES de leer tarifa_hotel/tarifario_resultado", () => {
  const cuerpo = cuerpoFuncion(computo, "export async function computarReserva(");

  test("consulta hoteles.modelo_tarifario con el cliente recibido (sesión), no un cliente propio", () => {
    assert.match(cuerpo, /\.from\("hoteles"\)\s*\.select\("modelo_tarifario"\)/);
    assert.doesNotMatch(cuerpo, /createAdminClient\(\)[\s\S]{0,80}modelo_tarifario/);
  });

  test("un error de Supabase al validar el modelo falla cerrado (nunca sigue de largo)", () => {
    assert.match(cuerpo, /if \(modeloError\) return \{ ok: false,/);
  });

  test("modelo_tarifario === 'unidad' bloquea con un mensaje explícito, antes de calcular ningún precio", () => {
    assert.match(cuerpo, /modeloRow\?\.modelo_tarifario === "unidad"/);
    assert.match(cuerpo, /hotel_tarifas_unidad/);
    assert.match(cuerpo, /todavía no está integrada en Reservar/);
  });

  test("la guardia corre ANTES de usarFechas/liquidarHotelPaquete y ANTES de leer tarifario_resultado para el hotel", () => {
    const posGuardia = cuerpo.indexOf('modeloRow?.modelo_tarifario === "unidad"');
    const posUsarFechas = cuerpo.indexOf("const usarFechas =");
    const posLiquidar = cuerpo.indexOf("liquidarHotelPaquete(");
    const posTarifarioResultado = cuerpo.indexOf('.from("tarifario_resultado")\r\n      .select("acomodacion, precio_pvp');
    assert.notEqual(posGuardia, -1);
    assert.notEqual(posUsarFechas, -1);
    assert.notEqual(posLiquidar, -1);
    assert.notEqual(posTarifarioResultado, -1);
    assert.ok(posGuardia < posUsarFechas, "la guardia debe resolverse antes de decidir la rama usarFechas");
    assert.ok(posGuardia < posLiquidar, "la guardia debe resolverse antes de liquidarHotelPaquete (tarifa_hotel en vivo)");
    assert.ok(posGuardia < posTarifarioResultado, "la guardia debe resolverse antes de leer el PVP de tarifario_resultado");
  });

  test("la guardia NO corre para módulo 'servicios' (sin hotel, no hay modelo_tarifario que validar)", () => {
    const posGuardia = cuerpo.indexOf('modeloRow?.modelo_tarifario === "unidad"');
    const bloque = cuerpo.slice(cuerpo.indexOf("const esServicios = input.modulo"), posGuardia + 200);
    assert.match(bloque, /if \(!esServicios\) \{/);
  });
});

describe("paquetes/actions.ts (generarTarifario) — hoteles 'unidad' se EXCLUYEN, nunca leen tarifa_hotel", () => {
  const cuerpo = cuerpoFuncion(paqueteActions, "export async function generarTarifario(paqueteId: number): Promise<Result> {");

  test("selecciona modelo_tarifario del hotel junto con nombre/moneda", () => {
    assert.match(cuerpo, /hoteles\(nombre, moneda, modelo_tarifario\)/);
  });

  test("hotelIds (usado para consultar hotel_temporadas/tarifa_hotel) EXCLUYE los hoteles con modelo_tarifario === 'unidad'", () => {
    const posExcluidos = cuerpo.indexOf("const hotelesBernaloExcluidos = hoteles");
    const posHotelIds = cuerpo.indexOf("const hotelIds = hoteles");
    const posTarifaHotel = cuerpo.indexOf('.from("tarifa_hotel").select("*").in("hotel_id", hotelIds)');
    assert.notEqual(posExcluidos, -1);
    assert.notEqual(posHotelIds, -1);
    assert.notEqual(posTarifaHotel, -1);
    assert.ok(posExcluidos < posHotelIds, "los excluidos deben calcularse antes de construir hotelIds");
    assert.ok(posHotelIds < posTarifaHotel, "hotelIds (ya filtrado) debe existir antes de consultar tarifa_hotel");
    // La condición de exclusión es explícita: modelo_tarifario === 'unidad'
    // (nunca al revés — un hotel sin el campo, o en 'persona', debe seguir
    // en hotelIds).
    assert.match(cuerpo, /modelo_tarifario === "unidad"/);
    const finFiltro = posHotelIds + cuerpo.slice(posHotelIds).indexOf(".map((h) => h.hotel_id)");
    const filtroHotelIds = cuerpo.slice(posHotelIds, cuerpo.indexOf(";", finFiltro));
    assert.match(filtroHotelIds, /!== "unidad"/);
  });

  test("el resultado final avisa (no falla en silencio) cuántos hoteles quedaron sin filas legacy por ser modelo por unidad, y distingue explícitamente las tarifas persona publicadas de los hoteles disponibles por cotización dinámica — nunca dice que la integración 'no está disponible'", () => {
    assert.match(cuerpo, /hotelesBernaloExcluidos/);
    assert.match(cuerpo, /aviso:/);
    assert.match(cuerpo, /el modelo tarifario por unidad/);
    assert.match(cuerpo, /tarifa\(s\) persona publicada\(s\)/);
    assert.match(cuerpo, /cotización dinámica por ocupación/);
    assert.doesNotMatch(cuerpo, /la integración con el tarifario aún no está disponible/);
  });

  // P1-3 (hallazgo confirmado): "excluido de tarifario_resultado" (todo hotel
  // Bernalo, publicado o no) NO es lo mismo que "disponible para cotización
  // dinámica" (solo los que tienen tarifa publicada cubriendo TODO su
  // cartesiano configurado). El aviso/guardia deben usar `hotelesBernaloValidos`
  // — nunca `hotelesBernaloExcluidos` a secas, que sobre-cuenta.
  //
  // P4 (hallazgo confirmado, validación final): la clasificación (válido/
  // sin publicar/no compatible) se hace por `hotel_id` — un `Set<number>`
  // por categoría, nunca comparando NOMBRES. Antes se armaba
  // `hotelesBernaloValidosSet` (Set de NOMBRES) y se filtraba
  // `hotelesBernaloExcluidos` (también nombres) por "no está en el set de
  // válidos" — dos hoteles DISTINTOS con el mismo nombre (uno válido, otro
  // sin publicar) se clasificaban mal, porque el nombre compartido
  // "contaminaba" al otro. El nombre solo se resuelve al final
  // (`nombresDeIdsBernalo`), para el texto del aviso.
  test("P1-3/P4: la clasificación usa Sets de `hotel_id` (idsBernaloValidos/idsBernaloSinPublicar/idsBernaloNoCompatibles) — nunca compara por nombre", () => {
    assert.match(cuerpo, /const idsBernaloValidos = new Set<number>\(\);/);
    assert.match(cuerpo, /const idsBernaloSinPublicar = new Set<number>\(\);/);
    assert.match(cuerpo, /const idsBernaloNoCompatibles = new Set<number>\(\);/);
    assert.match(cuerpo, /todosLosParesConfiguradosPublicados\(categorias, regimenes, paresPublicados\)/);
    assert.match(cuerpo, /idsBernaloValidos\.add\(h\.hotel_id\)/);
    assert.match(cuerpo, /idsBernaloSinPublicar\.add\(h\.hotel_id\)/);
    // El helper compartido de pares publicados es el mismo que usan
    // setHotelFiltros/cargarHotelesBernaloDescubiertos — sin reglas duplicadas.
    assert.match(paqueteActions, /from "@\/lib\/calc\/paresPublicadosUnidad"/);
    // El nombre se resuelve SOLO al final, vía un mapa hotel_id -> nombre —
    // nunca comparando strings de nombre entre sí.
    assert.match(cuerpo, /const nombrePorHotelBernalo = new Map<number, string>\(/);
    assert.match(cuerpo, /const nombresDeIdsBernalo = \(ids: Set<number>\) => \[\.\.\.ids\]\.map\(\(id\) => nombrePorHotelBernalo\.get\(id\) \?\? `#\$\{id\}`\);/);
    // (el nombre `hotelesBernaloValidosSet` puede seguir mencionado en un
    // comentario explicando el bug viejo — lo que no debe existir es el
    // CÓDIGO que lo construía como Set de nombres).
    assert.doesNotMatch(cuerpo, /new Set\(hotelesBernaloValidos\)/, "ya no debe existir un Set de NOMBRES válidos");
    assert.match(cuerpo, /no tiene\$\{.*una tarifa publicada que cubra su configuración/);
  });

  test("P4: dos hoteles Bernalo DISTINTOS con el MISMO nombre (uno válido, otro sin publicar) se clasifican por su propio hotel_id, no por el nombre compartido", () => {
    // La clasificación recorre `hotelesBernaloFilas` UNA fila a la vez y
    // decide con el `hotel_id` de ESA fila (`h.hotel_id`) — nunca agrupando
    // ni comparando por `h.hoteles.nombre`. Dos filas con el mismo nombre
    // pero distinto `hotel_id` pasan por el `for` de forma completamente
    // independiente: el resultado de una no puede "contagiar" a la otra
    // porque no hay ningún punto donde se comparen entre sí por nombre.
    const idxFor = cuerpo.indexOf("for (const h of hotelesBernaloFilas) {");
    assert.notEqual(idxFor, -1);
    const idxFinFor = cuerpo.indexOf("const nombresDeIdsBernalo", idxFor);
    assert.notEqual(idxFinFor, -1);
    const cuerpoFor = cuerpo.slice(idxFor, idxFinFor);
    assert.doesNotMatch(cuerpoFor, /\.nombre/, "el bucle de clasificación no debe leer/comparar el nombre del hotel en absoluto");
    assert.match(cuerpoFor, /h\.hotel_id/);
  });

  test("P1-3: un error técnico consultando hotel_tarifas_unidad se propaga (fail-closed) — nunca se disfraza de catálogo Bernalo vacío", () => {
    assert.match(cuerpo, /if \(eTarifasBernalo\) return \{ ok: false, error: eTarifasBernalo\.message \};/);
  });

  // P2 (hallazgo confirmado, validación final): el motor Bernalo no soporta
  // `salidas_dinamicas` (paquetes "dinamico") y "servicios" no tiene
  // concepto de hotel cotizable — un hotel unidad de un paquete de ese tipo
  // NUNCA debe contarse como válido/disponible, sin importar publicación.
  test("P2: `tipoCompatibleConVistaBooking` (solo bloqueo/porcion_terrestre) decide si un hotel Bernalo puede llegar a 'válido' — dinamico/servicios van directo a 'no compatible'", () => {
    assert.match(cuerpo, /const tipoCompatibleConVistaBooking = tipo === "bloqueo" \|\| tipo === "porcion_terrestre";/);
    assert.match(cuerpo, /if \(!tipoCompatibleConVistaBooking\) \{ idsBernaloNoCompatibles\.add\(h\.hotel_id\); continue; \}/);
    // Ni siquiera se consulta hotel_tarifas_unidad para un paquete no
    // compatible — sería una llamada desperdiciada, el hotel jamás podrá
    // contarse como válido sin importar el resultado.
    assert.match(cuerpo, /if \(hotelesBernaloFilas\.length && tipoCompatibleConVistaBooking\) \{/);
  });

  test("P2: un paquete 'dinamico' cuyos hoteles son TODOS Bernalo (hotelIds vacío) devuelve un ERROR claro — nunca ok:true con un catálogo vacío disfrazado de éxito", () => {
    const idxDinamico = cuerpo.indexOf('tipo === "dinamico" && hotelIds.length === 0 && hotelesBernaloFilas.length > 0');
    assert.notEqual(idxDinamico, -1);
    const idxLlave = cuerpo.indexOf("{", idxDinamico);
    const bloque = cuerpo.slice(idxLlave, cuerpo.indexOf("}", idxLlave) + 1);
    assert.match(bloque, /ok: false/);
    assert.match(bloque, /no soporta salidas dinámicas/);
  });

  test("tarifa_hotel/hotel_temporadas nunca se consultan directamente con hotelIds sin filtrar (no queda un segundo camino sin la exclusión)", () => {
    // Todo `.in("hotel_id", hotelIds)` de este archivo debe usar la variable
    // YA filtrada `hotelIds` (no una lista cruda de `hoteles.map(...)` suelta
    // en otra parte del cuerpo de la función).
    const usosHotelIdsCrudos = [...cuerpo.matchAll(/hoteles\.map\(\(h\) => h\.hotel_id\)/g)];
    // Debe existir EXACTAMENTE uno: el que arma `hotelesBernaloExcluidos`
    // aparte no usa este patrón (usa .filter().map()) — así que el único
    // `.map((h) => h.hotel_id)` sin filtro previo es el de `hotelIds` mismo,
    // que YA está detrás de un `.filter(...)` en la misma expresión.
    for (const m of usosHotelIdsCrudos) {
      const inicioLinea = cuerpo.lastIndexOf("\n", m.index) + 1;
      const linea = cuerpo.slice(inicioLinea, cuerpo.indexOf("\n", m.index));
      assert.match(linea, /\.filter\(/, `un .map((h) => h.hotel_id) sin .filter() previo dejaría pasar hoteles Bernalo: "${linea.trim()}"`);
    }
  });
});

// ── Hallazgo confirmado: paquete SOLO Bernalo no debe caer en el error
// legacy "No se generaron tarifas" — filas.length=0 es esperado y correcto
// para ese caso (el modelo por unidad no escribe tarifario_resultado), no
// una señal de paquete roto. ─────────────────────────────────────────────
describe("paquetes/actions.ts (generarTarifario) — hallazgo confirmado: filas.length=0 por Bernalo NUNCA es el error legacy", () => {
  const cuerpo = cuerpoFuncion(paqueteActions, "export async function generarTarifario(paqueteId: number): Promise<Result> {");

  test('el error legacy "No se generaron tarifas" solo se devuelve si hotelesBernaloValidos.length === 0 (nunca cuando SÍ hay hoteles Bernalo con tarifa publicada compatible)', () => {
    const idxError = cuerpo.indexOf("No se generaron tarifas");
    assert.notEqual(idxError, -1);
    // La condición completa del `else if` que envuelve el error legacy debe
    // incluir explícitamente `hotelesBernaloValidos.length === 0` — nunca
    // solo `tipo === "bloqueo" || tipo === "porcion_terrestre"` a secas, y
    // NUNCA `hotelesBernaloExcluidos` (que sobre-cuenta hoteles sin publicar,
    // P1-3).
    const idxElseIf = cuerpo.lastIndexOf("} else if (", idxError);
    assert.notEqual(idxElseIf, -1);
    const condicion = cuerpo.slice(idxElseIf, cuerpo.indexOf("{", idxElseIf) + 1);
    assert.match(condicion, /hotelesBernaloValidos\.length === 0/, `la condición del error legacy debe excluir el caso Bernalo VÁLIDO: "${condicion}"`);
  });

  test("un paquete SOLO Bernalo con tarifa publicada compatible (filas.length=0, hotelesBernaloValidos.length>0) llega al return final ok:true — nunca al return de error", () => {
    const idxErrorReturn = cuerpo.indexOf("No se generaron tarifas");
    const idxElseIf = cuerpo.lastIndexOf("} else if (", idxErrorReturn);
    const condicion = cuerpo.slice(idxElseIf, cuerpo.indexOf("{", idxElseIf) + 1);
    // Simula la evaluación: con hotelesBernaloValidos.length>0 la
    // condición completa (que exige === 0) debe evaluar false, así que el
    // `else if` no dispara y el control cae al return final.
    assert.match(condicion, /&&/, "la condición debe combinar el tipo Y la ausencia de Bernalo válidos (AND), no evaluarlos por separado");
  });

  test("un paquete con hoteles Bernalo EXCLUIDOS pero SIN tarifa publicada (hotelesBernaloValidos.length===0, hotelesBernaloExcluidos.length>0) SÍ cae en el error legacy — 'excluido de tarifario_resultado' no implica 'disponible en Vista Booking'", () => {
    const idxError = cuerpo.indexOf("No se generaron tarifas");
    const idxElseIf = cuerpo.lastIndexOf("} else if (", idxError);
    const condicion = cuerpo.slice(idxElseIf, cuerpo.indexOf("{", idxElseIf) + 1);
    assert.doesNotMatch(condicion, /hotelesBernaloExcluidos\.length === 0/, "la guardia nunca debe leer 'sin publicar' como 'disponible'");
  });

  test("nunca se insertan filas ficticias en tarifario_resultado para Bernalo — el insert solo corre si filas.length es verdadero", () => {
    const idxIf = cuerpo.indexOf("if (filas.length) {");
    const idxInsert = cuerpo.indexOf('.from("tarifario_resultado").insert(filas)');
    assert.notEqual(idxIf, -1);
    assert.notEqual(idxInsert, -1);
    assert.ok(idxIf < idxInsert && idxInsert < idxIf + 150, "el insert debe estar DENTRO del if (filas.length), nunca fuera ni con un array rellenado a mano");
  });

  test("el return final sigue devolviendo id: filas.length (0 para un paquete solo Bernalo) y el aviso Bernalo (basado en hotelesBernaloValidos), sin cambios", () => {
    assert.match(cuerpo, /id: filas\.length,/);
    assert.match(cuerpo, /const avisoValidos = hotelesBernaloValidos\.length[\s\S]{0,40}\?/);
  });

  test("paquete mixto (persona + Bernalo): filas.length>0 sigue insertando SOLO las filas persona — el aviso Bernalo (avisoValidos/avisoSinPublicar) no depende de si hubo filas persona", () => {
    // El `if (filas.length)` inserta sin mirar hotelesBernaloValidos/
    // hotelesBernaloExcluidos — las dos ramas (insertar filas persona, armar
    // el aviso Bernalo) son independientes entre sí, así que un paquete
    // mixto hace ambas cosas.
    const idxIf = cuerpo.indexOf("if (filas.length) {");
    const idxAvisoValidos = cuerpo.indexOf("const avisoValidos = hotelesBernaloValidos.length");
    assert.notEqual(idxIf, -1);
    assert.notEqual(idxAvisoValidos, -1);
    assert.ok(idxIf < idxAvisoValidos, "el insert de filas persona y el armado del aviso Bernalo deben ser ramas independientes, ambas alcanzables en el mismo llamado");
    // El aviso se construye SIEMPRE (nunca detrás de un `if (filas.length)`
    // ni de un `if (!filas.length)`) — es información del paquete completo,
    // no condicionada a si hubo filas persona.
    const idxCierreIf = cuerpo.indexOf("\n  }", idxIf);
    assert.ok(idxAvisoValidos > idxCierreIf, "el aviso debe calcularse DESPUÉS de cerrar el bloque if/else-if de inserción, no adentro de él");
  });
});

// P3 (hallazgo confirmado, validación final): los servicios opcionales
// SIEMPRE suman `filas.push(...)` (ver el loop "SERVICIOS: se publican
// siempre", más abajo del punto donde se generan las filas de hotel) — así
// que un paquete "dinamico" 100% Bernalo CON al menos un servicio opcional
// terminaba con `filas.length > 0` y se colaba por la rama `if (filas.length)`
// del insert, en vez de caer en el `else if` que rechaza el caso. Se
// guardaba `ok:true` con un snapshot que son SOLO servicios (sin ningún
// alojamiento real) y sin aviso de que el paquete no sirve. La
// prevalidación ahora vive ANTES de tocar `armado_servicios`/
// `servicio_tarifa_pax`, ANTES del `delete()` y ANTES de cualquier
// `insert()` — independiente de `filas.length` por completo.
describe("paquetes/actions.ts (generarTarifario) — P3: prevalidación de dinámico 100% unidad ANTES de publicar servicios/borrar/insertar", () => {
  const cuerpo = cuerpoFuncion(paqueteActions, "export async function generarTarifario(paqueteId: number): Promise<Result> {");

  test("la guardia de dinámico 100% unidad es un `if` temprano e INDEPENDIENTE de `filas.length` — no vive dentro del if/else-if de inserción", () => {
    const idxGuardia = cuerpo.indexOf('if (tipo === "dinamico" && hotelIds.length === 0 && hotelesBernaloFilas.length > 0) {');
    assert.notEqual(idxGuardia, -1);
    const bloque = cuerpo.slice(idxGuardia, cuerpo.indexOf("}", idxGuardia) + 1);
    assert.match(bloque, /ok: false/);
    assert.match(bloque, /no soporta salidas dinámicas/);
    // Nunca debe estar precedida por un `} else if (` — sería parte de la
    // cadena de inserción (que SÍ depende de filas.length), no una
    // prevalidación independiente.
    const posiblePrefijoElseIf = cuerpo.slice(Math.max(0, idxGuardia - 20), idxGuardia);
    assert.doesNotMatch(posiblePrefijoElseIf, /\} else if \($/);
  });

  test("la guardia corre ANTES de declarar `filas` — imposible que dependa de servicios/filas.length, porque `filas` ni existe todavía en ese punto", () => {
    const idxGuardia = cuerpo.indexOf('if (tipo === "dinamico" && hotelIds.length === 0 && hotelesBernaloFilas.length > 0) {');
    const idxDeclFilas = cuerpo.indexOf("const filas: ResultadoInsert[] = [];");
    assert.notEqual(idxGuardia, -1);
    assert.notEqual(idxDeclFilas, -1);
    assert.ok(idxGuardia < idxDeclFilas, "la guardia debe correr antes de que `filas` siquiera exista — nunca puede verse afectada por servicios opcionales que la llenen después");
  });

  test("la guardia corre ANTES del loop de servicios opcionales (SERVICIOS: se publican siempre) — nunca se publica un snapshot parcial de solo-servicios", () => {
    const idxGuardia = cuerpo.indexOf('if (tipo === "dinamico" && hotelIds.length === 0 && hotelesBernaloFilas.length > 0) {');
    const idxServicios = cuerpo.indexOf("SERVICIOS: se publican siempre");
    assert.notEqual(idxGuardia, -1);
    assert.notEqual(idxServicios, -1);
    assert.ok(idxGuardia < idxServicios, "la guardia debe correr antes de publicar servicios opcionales");
  });

  test("la guardia corre ANTES del delete de tarifario_resultado — nunca borra un snapshot previo válido al rechazar", () => {
    const idxGuardia = cuerpo.indexOf('if (tipo === "dinamico" && hotelIds.length === 0 && hotelesBernaloFilas.length > 0) {');
    const idxDelete = cuerpo.indexOf('.from("tarifario_resultado").delete().eq("paquete_id", paqueteId)');
    assert.notEqual(idxGuardia, -1);
    assert.notEqual(idxDelete, -1);
    assert.ok(idxGuardia < idxDelete, "la guardia debe correr antes del delete — un rechazo nunca debe borrar el snapshot previo");
  });

  test("la guardia corre ANTES del insert de tarifario_resultado — nunca inserta filas para un paquete dinámico 100% unidad", () => {
    const idxGuardia = cuerpo.indexOf('if (tipo === "dinamico" && hotelIds.length === 0 && hotelesBernaloFilas.length > 0) {');
    const idxInsert = cuerpo.indexOf('.from("tarifario_resultado").insert(filas)');
    assert.notEqual(idxGuardia, -1);
    assert.notEqual(idxInsert, -1);
    assert.ok(idxGuardia < idxInsert, "la guardia debe correr antes del insert");
  });

  test("la condición exige hotelIds.length === 0 (CERO hoteles persona) — un dinámico con AL MENOS un hotel persona nunca entra aquí, sigue el flujo normal", () => {
    assert.match(cuerpo, /tipo === "dinamico" && hotelIds\.length === 0 && hotelesBernaloFilas\.length > 0/);
    // hotelIds ya excluye los hoteles unidad (ver su propia declaración) —
    // con al menos un hotel persona, hotelIds.length sería >= 1 y la
    // condición evalúa false sin tocar el resto del AND.
    assert.match(cuerpo, /const hotelIds = hoteles\s*\n\s*\.filter\(\(h\) => \(h\.hoteles as unknown as \{ modelo_tarifario\?: string \| null \} \| null\)\?\.modelo_tarifario !== "unidad"\)/);
  });

  test("la condición exige tipo === 'dinamico' explícitamente — bloqueo y porción terrestre nunca pasan por esta guardia (su disponibilidad unidad sigue decidida por hotelesBernaloValidos, más abajo)", () => {
    const idxGuardia = cuerpo.indexOf('if (tipo === "dinamico" && hotelIds.length === 0 && hotelesBernaloFilas.length > 0) {');
    assert.notEqual(idxGuardia, -1);
    const bloque = cuerpo.slice(idxGuardia, idxGuardia + 40);
    assert.match(bloque, /^if \(tipo === "dinamico"/);
  });

  test("no queda una segunda copia de esta guardia después del insert/delete (la vieja ubicación, ahora inalcanzable, se retiró — nunca dos fuentes de verdad para la misma regla)", () => {
    const ocurrencias = [...cuerpo.matchAll(/tipo === "dinamico" && hotelIds\.length === 0 && hotelesBernaloFilas\.length > 0/g)];
    assert.equal(ocurrencias.length, 1, "la condición de dinámico 100% unidad debe existir en UN solo lugar del código");
  });
});

describe("ArmadoClient.tsx — el aviso de hoteles Bernalo excluidos se muestra al generar el tarifario", () => {
  const armadoClient = leer("app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx");
  test("el mensaje de éxito incluye r.aviso cuando viene presente", () => {
    assert.match(armadoClient, /r\.aviso \? ` \$\{r\.aviso\}` : ""/);
  });
});
