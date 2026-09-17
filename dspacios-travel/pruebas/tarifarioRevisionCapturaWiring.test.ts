import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Migración 181 (publicación atómica del tarifario) — rondas 2 y 3 de
// auditoría.
//
// Ronda 2, hallazgo P1 "la revisión se captura demasiado tarde":
// `generarTarifario` leía armado_paquetes, armado_vuelos, armado_empaquetados,
// armado_hoteles, armado_servicios y servicio_tarifa_pax ANTES de llamar
// `iniciar_generacion_tarifario` — un cambio concurrente entre esa lectura y
// la captura de la revisión podía dejar el cálculo usando datos viejos bajo
// una revisión NUEVA, que `publicar_tarifario_resultado` acepta por coincidir.
//
// Ronda 3, hallazgo P1 "carrera entre moneda preliminar y autoritativa": la
// corrección de la ronda 2 introdujo una fase "preliminar" que leía y
// escribía `armado_paquetes.moneda` ANTES del token, precisamente para poder
// escribirla sin invalidar el snapshot que se iba a publicar. Pero esa
// escritura preliminar podía quedar desactualizada si una fuente cambiaba
// justo entre esa lectura y la captura del token (la revisión ya reflejaría
// el cambio, así que la publicación no se rechazaba, pero la CACHÉ de moneda
// seguía con el valor viejo). La corrección final: moneda es un dato
// DERIVADO del mismo cálculo que produce `filas` — se resuelve UNA sola vez
// con las lecturas autoritativas y se persiste DENTRO de
// `publicar_tarifario_resultado` (mismo commit que las filas). Ya no hace
// falta ninguna fase preliminar: el token se captura como la PRIMERA
// operación de toda la función, sin ninguna lectura antes.
//
// Se verifica por inspección del código FUENTE real (mismo criterio que
// `pruebas/bernaloIntegracionGuardWiring.test.ts`: `computo.ts`/
// `paquetes/actions.ts` requieren Supabase real, "use server", next/headers).
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const paqueteActions = readFileSync(join(raiz, "app/(dashboard)/dashboard/paquetes/actions.ts"), "utf8");

// Mismo extractor de cuerpo balanceando llaves que el resto del wiring de
// este proyecto.
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

describe("generarTarifario — NINGUNA lectura ocurre antes de capturar el token de generación (ronda 3: ni siquiera la moneda)", () => {
  const cuerpo = cuerpoFuncion(paqueteActions, "export async function generarTarifario(paqueteId: number): Promise<Result> {");
  const idxIniciar = cuerpo.indexOf('sb.rpc("iniciar_generacion_tarifario"');

  test('existe exactamente UNA llamada a iniciar_generacion_tarifario dentro de generarTarifario', () => {
    assert.notEqual(idxIniciar, -1, "no se encontró la llamada a iniciar_generacion_tarifario");
    const ultima = cuerpo.lastIndexOf('sb.rpc("iniciar_generacion_tarifario"');
    assert.equal(idxIniciar, ultima, "debe haber una sola llamada a iniciar_generacion_tarifario en toda la función");
  });

  test("iniciar_generacion_tarifario es la PRIMERA operación de Supabase — cero lecturas de cualquier fuente antes (ronda 3: ni siquiera la moneda preliminar)", () => {
    const antesDelToken = cuerpo.slice(0, idxIniciar);
    // Ninguna tabla fuente del cálculo debe aparecer ANTES del token — ni
    // siquiera acotada a columnas de moneda (eso era la fase preliminar de
    // la ronda 2, retirada en la ronda 3).
    for (const tabla of [
      "armado_paquetes", "armado_vuelos", "armado_empaquetados", "armado_hoteles",
      "armado_servicios", "servicio_tarifa_pax", "hotel_temporadas", "tarifa_hotel", "hotel_tarifas_unidad",
    ]) {
      assert.doesNotMatch(antesDelToken, new RegExp(`\\.from\\("${tabla}"\\)`), `${tabla} no debe leerse antes de capturar el token de generación`);
    }
    // Sin identificadores de código de la fase preliminar de moneda (ronda 2,
    // retirada en la ronda 3) — busca los NOMBRES DE VARIABLE exactos, no la
    // palabra "preliminar" en prosa (que sí puede aparecer en comentarios
    // explicando por qué ya no existe esa fase).
    for (const identificador of ["paqueteMonedaPrelim", "hotelesMonedaPrelim", "serviciosMonedaPrelim", "monedaDePrelim"]) {
      assert.doesNotMatch(antesDelToken, new RegExp(`\\b${identificador}\\b`), `no debe quedar el identificador "${identificador}" de la fase preliminar retirada`);
    }
  });

  test("la lectura completa de armado_paquetes (pq, con destinos) ocurre DESPUÉS de iniciar_generacion_tarifario", () => {
    const idxPq = cuerpo.indexOf('.select("*, destinos(nombre)")');
    assert.notEqual(idxPq, -1, "no se encontró la lectura completa de armado_paquetes");
    assert.ok(idxIniciar < idxPq, "la lectura autoritativa de armado_paquetes debe ocurrir DESPUÉS de capturar el token");
  });

  test("las lecturas de armado_vuelos, armado_empaquetados, armado_hoteles y armado_servicios (el Promise.all autoritativo) ocurren DESPUÉS de iniciar_generacion_tarifario, y cada tabla se lee UNA sola vez", () => {
    for (const tabla of ["armado_vuelos", "armado_empaquetados", "armado_hoteles", "armado_servicios"]) {
      const ocurrencias = [...cuerpo.matchAll(new RegExp(`\\.from\\("${tabla}"\\)`, "g"))];
      assert.equal(ocurrencias.length, 1, `${tabla} debe leerse EXACTAMENTE una vez en toda la función (ya no hay fase preliminar) — se encontraron ${ocurrencias.length}`);
      assert.ok(idxIniciar < ocurrencias[0].index!, `la lectura de ${tabla} debe ocurrir DESPUÉS de capturar el token`);
    }
  });

  test("la lectura de servicio_tarifa_pax (gruposPorServicio) ocurre DESPUÉS de iniciar_generacion_tarifario", () => {
    const idxGrupos = cuerpo.indexOf('.from("servicio_tarifa_pax")');
    assert.notEqual(idxGrupos, -1, "no se encontró la lectura de servicio_tarifa_pax (gruposPorServicio)");
    assert.ok(idxIniciar < idxGrupos, "la lectura de servicio_tarifa_pax debe ocurrir DESPUÉS de capturar el token");
  });

  test("la validación ESTRICTA de consistencia de moneda (monedasHotel.length > 1, mensajes de error) ocurre DESPUÉS de iniciar_generacion_tarifario — usa los datos autoritativos", () => {
    const idxValidacion = cuerpo.indexOf("Los hoteles del paquete tienen monedas distintas");
    assert.notEqual(idxValidacion, -1);
    assert.ok(idxIniciar < idxValidacion, "la validación estricta de moneda debe ejecutarse sobre datos autoritativos, después del token");
  });

  test("la guardia de dinámico 100% unidad (hotelIds.length === 0 && hotelesBernaloFilas.length > 0) ocurre DESPUÉS de iniciar_generacion_tarifario — usa hotelIds derivado de la lectura autoritativa", () => {
    const idxGuardia = cuerpo.indexOf('if (tipo === "dinamico" && hotelIds.length === 0 && hotelesBernaloFilas.length > 0) {');
    assert.notEqual(idxGuardia, -1);
    assert.ok(idxIniciar < idxGuardia, "la guardia dinámico/Bernalo debe evaluarse sobre hotelIds autoritativo, después del token");
  });
});

describe("generarTarifario — moneda es un dato DERIVADO, persistido DENTRO de publicar_tarifario_resultado (auditoría de Fase 1, ronda 3)", () => {
  const cuerpo = cuerpoFuncion(paqueteActions, "export async function generarTarifario(paqueteId: number): Promise<Result> {");

  test("no existe ninguna escritura directa de armado_paquetes.moneda desde generarTarifario — la única vía es p_moneda del RPC de publicación", () => {
    assert.doesNotMatch(cuerpo, /\.from\("armado_paquetes"\)\.update\(\{\s*moneda/, "no debe haber un UPDATE directo de moneda — ahora se persiste dentro del RPC de publicación");
  });

  test("publicar_tarifario_resultado recibe p_moneda: paqueteMoneda (el valor autoritativo)", () => {
    const idxPublicar = cuerpo.indexOf('sb.rpc("publicar_tarifario_resultado"');
    assert.notEqual(idxPublicar, -1);
    const bloque = cuerpo.slice(idxPublicar, idxPublicar + 400);
    assert.match(bloque, /p_moneda: paqueteMoneda,/, "el RPC de publicación debe recibir la moneda autoritativa calculada en esta misma función");
  });
});

describe("generarTarifario — mensajes técnicos NUNCA se persisten crudos en tarifario_error (auditoría de Fase 1, hallazgos P2 de las rondas 2 y 3)", () => {
  const cuerpo = cuerpoFuncion(paqueteActions, "export async function generarTarifario(paqueteId: number): Promise<Result> {");

  test("existe un mensaje FIJO de módulo para errores técnicos (ronda 3: compartido también por el fallo de iniciar_generacion_tarifario, ANTES de que exista token)", () => {
    // Ronda 3: MENSAJE_ERROR_TECNICO_TARIFARIO se movió a nivel de MÓDULO
    // (fuera de la función) para poder usarse también en el fallo de
    // `iniciar_generacion_tarifario`, que ocurre antes de que exista
    // `generacion`/`fallarTecnico`. Por eso se busca en el archivo COMPLETO,
    // no solo en `cuerpo` (el cuerpo de la función ya no lo declara).
    assert.match(paqueteActions, /^const MENSAJE_ERROR_TECNICO_TARIFARIO =/m);
    // Y NO debe quedar una segunda declaración local (duplicada) dentro de
    // la función — una sola fuente de verdad para el mensaje.
    assert.doesNotMatch(cuerpo, /const MENSAJE_ERROR_TECNICO_TARIFARIO =/);
  });

  test("fallarTecnico() usa el mensaje de módulo tanto para persistir como para devolver — nunca el .message crudo", () => {
    const idxFallarTecnico = cuerpo.indexOf("const fallarTecnico = async (detalleCrudo: string)");
    assert.notEqual(idxFallarTecnico, -1, "no se encontró fallarTecnico()");
    const cuerpoFallarTecnico = cuerpo.slice(idxFallarTecnico, cuerpo.indexOf("};", idxFallarTecnico) + 2);
    assert.match(cuerpoFallarTecnico, /console\.error\(/, "el detalle crudo debe registrarse server-side");
    assert.match(cuerpoFallarTecnico, /marcarFallo\(MENSAJE_ERROR_TECNICO_TARIFARIO\)/, "debe persistir el mensaje FIJO, nunca el detalle crudo");
    assert.match(cuerpoFallarTecnico, /return \{ ok: false, error: MENSAJE_ERROR_TECNICO_TARIFARIO \}/, "debe devolver el mensaje FIJO, nunca el detalle crudo");
    assert.doesNotMatch(cuerpoFallarTecnico, /marcarFallo\(detalleCrudo\)/, "fallarTecnico NUNCA debe pasar el detalle crudo a marcarFallo");
  });

  test("los .message crudos de errores de Supabase/Postgres (ePq, eTarifasBernalo, ePublicar, y los 5 de la lectura/cálculo autoritativo) pasan por fallarTecnico(), nunca por fallar() directo", () => {
    for (const variable of ["ePq", "eTarifasBernalo", "ePublicar", "eVuelosSel", "eEmpaquetadosSel", "eHotelesSel", "eServiciosSel", "eGrupos"]) {
      const patronCrudo = new RegExp(`return await fallar\\(${variable}\\.message\\)`);
      assert.doesNotMatch(cuerpo, patronCrudo, `${variable}.message no debe pasarse a fallar() directo — debe ir por fallarTecnico()`);
      const patronTecnico = new RegExp(`return await fallarTecnico\\(${variable}\\.message\\)`);
      assert.match(cuerpo, patronTecnico, `${variable}.message debe pasarse a fallarTecnico()`);
    }
  });

  test("ronda 3: el fallo de iniciar_generacion_tarifario (eGen) nunca expone .message ni intenta marcar la generación como fallida — todavía no existe ningún token que marcar", () => {
    const idxIniciar = cuerpo.indexOf('sb.rpc("iniciar_generacion_tarifario"');
    const idxSiguienteConst = cuerpo.indexOf("const generacion =", idxIniciar);
    assert.notEqual(idxSiguienteConst, -1);
    const bloqueFalloInicio = cuerpo.slice(idxIniciar, idxSiguienteConst);
    assert.doesNotMatch(bloqueFalloInicio, /return \{ ok: false, error: eGen/, "eGen.message no debe devolverse directo");
    assert.doesNotMatch(bloqueFalloInicio, /marcarFallo\(/, "no puede llamarse marcarFallo() antes de que exista generacion/revisionCapturada");
    assert.match(bloqueFalloInicio, /return \{ ok: false, error: MENSAJE_ERROR_TECNICO_TARIFARIO \};/, "debe devolver el mensaje fijo de módulo");
    assert.match(bloqueFalloInicio, /console\.error\(/, "el detalle de eGen debe registrarse server-side");
  });
});
