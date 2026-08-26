import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Wiring de TEXTO (mismo patrón que pruebas/numeracionOrdenWiring.test.ts y
// pruebas/contratoContexto.test.ts) sobre crearContrato/reservarPrograma —
// segunda revisión posterior al PR #275 ("quedan dos defectos confirmados en
// la observabilidad"):
//   1) NINGÚN console.error crudo: todo el detalle técnico pasa por el único
//      helper autorizado, `registrarErrorTecnico()` — nunca `.message`/
//      `String(err)`/el objeto de error completo en el propio call site (el
//      saneo real, con datos sintéticos de PII, se prueba con EJECUCIÓN REAL
//      en pruebas/medicion.test.ts — aquí solo se verifica el WIRING: que el
//      call site pasa el error CRUDO al helper, nunca ya "pre-procesado");
//   2) el resultado TOTAL usa el estado técnico interno (`EstadoFlujo`) para
//      distinguir "rechazado" (negocio/sesión) de "error" (fallo técnico
//      bloqueante: RPC de numeración, insert de ventas, insert obligatorio de
//      tabla hija) y de "parcial" (contrato creado, un paso best-effort
//      falló) — nunca más `res.ok ? "ok" : "rechazado"` a secas;
//   3) validacion_negocio/validacion_programa registran "rechazado" en CADA
//      punto de rechazo, sin duplicar el log de éxito ni reordenar nada.
// No ejecuta el código (server-only, next/headers, Supabase) — es la misma
// limitación ya documentada en este repo para estas dos Server Actions.

function leer(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

function cuerpoDeFuncion(src: string, nombre: string): string {
  const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${nombre}\\s*\\(`);
  const m = re.exec(src);
  assert.ok(m, `no se encontró la función ${nombre}`);
  let i = src.indexOf("(", m!.index);
  let profParen = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") profParen++;
    else if (src[i] === ")") { profParen--; if (profParen === 0) { i++; break; } }
  }
  let profAngulo = 0;
  for (; i < src.length; i++) {
    if (src[i] === "<") profAngulo++;
    else if (src[i] === ">") profAngulo--;
    else if (src[i] === "{" && profAngulo === 0) break;
  }
  let depth = 0;
  const inicio = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(inicio, i + 1); }
  }
  throw new Error(`no se pudo balancear las llaves de ${nombre}`);
}

// Extrae los argumentos de TODAS las llamadas a una función dada dentro de
// un cuerpo de texto, balanceando paréntesis (para no cortar en la primera
// coma de un argumento que a su vez es una llamada anidada).
function llamadasA(cuerpo: string, nombreFn: string): string[] {
  const llamadas: string[] = [];
  const marcador = `${nombreFn}(`;
  let desde = 0;
  while (true) {
    const idx = cuerpo.indexOf(marcador, desde);
    if (idx === -1) break;
    // Evita capturar sub-strings de otro identificador (ej. "xregistrarEtapa(")
    const antes = cuerpo[idx - 1];
    if (antes && /[A-Za-z0-9_]/.test(antes)) { desde = idx + marcador.length; continue; }
    let i = idx + marcador.length;
    let depth = 1;
    const inicioArgs = i;
    for (; i < cuerpo.length && depth > 0; i++) {
      if (cuerpo[i] === "(") depth++;
      else if (cuerpo[i] === ")") depth--;
    }
    llamadas.push(cuerpo.slice(inicioArgs, i - 1));
    desde = i;
  }
  return llamadas;
}

// Divide una lista de argumentos en sus partes de TOP LEVEL (ignora comas
// dentro de `(...)`/`{...}`/`[...]`) — para poder inspeccionar cada
// argumento posicional de `registrarErrorTecnico(flujo, flujoId, etapa,
// detalle, error)` por separado.
function dividirArgsTop(argsStr: string): string[] {
  const partes: string[] = [];
  let depth = 0;
  let actual = "";
  for (const c of argsStr) {
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    if (c === "," && depth === 0) { partes.push(actual.trim()); actual = ""; }
    else actual += c;
  }
  partes.push(actual.trim());
  return partes;
}

const CONTRATOS_ARCHIVO = "app/(dashboard)/dashboard/contratos/actions.ts";
const RESERVAR_ARCHIVO = "app/(dashboard)/dashboard/reservar/actions.ts";

describe("crearContrato/reservarPrograma — medición TOTAL en éxito, rechazo y excepción", () => {
  for (const [archivo, wrapper, interno, flujo] of [
    [CONTRATOS_ARCHIVO, "crearContrato", "crearContratoInterno", "crear_contrato"],
    [RESERVAR_ARCHIVO, "reservarPrograma", "reservarProgramaInterno", "reservar_programa"],
  ] as const) {
    describe(`${wrapper} (${archivo})`, () => {
      const cuerpo = cuerpoDeFuncion(leer(archivo), wrapper);

      test("genera un flujo_id propio con generarFlujoId()", () => {
        assert.match(cuerpo, /const\s+flujoId\s*=\s*generarFlujoId\(\)/);
      });

      test("crea el estado técnico interno con crearEstadoFlujo() antes de llamar a la función interna", () => {
        assert.match(cuerpo, /const\s+estado\s*=\s*crearEstadoFlujo\(\)/);
        const idxEstado = cuerpo.indexOf("crearEstadoFlujo()");
        const idxInterno = cuerpo.indexOf(`${interno}(`);
        assert.ok(idxEstado > -1 && idxEstado < idxInterno, "estado debe crearse antes de llamar a la función interna");
      });

      test("mide la duración total con performance.now() antes de llamar a la función interna", () => {
        assert.match(cuerpo, /const\s+_tTotal0\s*=\s*performance\.now\(\)/);
        const idxTotal0 = cuerpo.indexOf("_tTotal0");
        const idxInterno = cuerpo.indexOf(`${interno}(`);
        assert.ok(idxInterno > -1, `no se encontró la llamada a ${interno}(`);
        assert.ok(idxTotal0 < idxInterno, "el cronómetro debe arrancar antes de llamar a la función interna");
      });

      test("usa try/catch/finally: el resultado se decide en try (éxito/rechazo) Y en catch (excepción), y se registra en finally", () => {
        assert.match(cuerpo, /\btry\s*\{/);
        assert.match(cuerpo, /\}\s*catch\s*\(/);
        assert.match(cuerpo, /\}\s*finally\s*\{/);
        const idxCatch = cuerpo.search(/\}\s*catch\s*\(/);
        const cuerpoCatch = cuerpo.slice(idxCatch, cuerpo.indexOf("finally", idxCatch));
        assert.match(cuerpoCatch, /_resultadoTotal\s*=\s*"error"/, "el catch debe marcar el total como error");
        assert.match(cuerpoCatch, /throw\s+err\s*;/, "el catch debe volver a lanzar la excepción (no debe tragársela)");
      });

      test("el catch de la excepción usa registrarErrorTecnico(), NUNCA console.error con .message/String(err) crudo", () => {
        const idxCatch = cuerpo.search(/\}\s*catch\s*\(/);
        const cuerpoCatch = cuerpo.slice(idxCatch, cuerpo.indexOf("finally", idxCatch));
        assert.doesNotMatch(cuerpoCatch, /console\.error\(/, "el catch no debe llamar console.error directo");
        assert.match(cuerpoCatch, new RegExp(`registrarErrorTecnico\\(\\s*"${flujo}"\\s*,\\s*flujoId\\s*,\\s*"total"\\s*,\\s*"excepcion"\\s*,\\s*err\\s*\\)`));
      });

      test("el TOTAL se calcula con resultadoTotal(estado, res.ok) — ya NUNCA con 'res.ok ? \"ok\" : \"rechazado\"' a secas", () => {
        assert.doesNotMatch(cuerpo, /res\.ok\s*\?\s*"ok"\s*:\s*"rechazado"/, "un fallo técnico bloqueante ya no debe poder quedar clasificado como 'rechazado' por este atajo");
        assert.match(cuerpo, /_resultadoTotal\s*=\s*resultadoTotal\(estado,\s*res\.ok\)/);
      });

      test("el finally registra la etapa 'total' con el mismo flujo_id, usando registrarEtapa()", () => {
        const idxFinally = cuerpo.search(/\}\s*finally\s*\{/);
        const cuerpoFinally = cuerpo.slice(idxFinally);
        assert.match(cuerpoFinally, new RegExp(`registrarEtapa\\(\\s*"${flujo}"\\s*,\\s*flujoId\\s*,\\s*"total"`));
      });

      test(`llama a ${interno}(input, flujoId, medir, estado) — el flujo_id y el estado técnico se propagan a la lógica real`, () => {
        assert.match(cuerpo, new RegExp(`${interno}\\(\\s*input\\s*,\\s*flujoId\\s*,\\s*medir\\s*,\\s*estado\\s*\\)`));
      });

      test("el wrapper NO reimplementa la lógica real (ninguna llamada a contextoCrearContrato ni a siguienteNumeroContrato aquí)", () => {
        assert.doesNotMatch(cuerpo, /contextoCrearContrato\(/);
        assert.doesNotMatch(cuerpo, /siguienteNumeroContrato\(/);
      });
    });
  }
});

describe("reservarPrograma mide MÁS ALLÁ del contexto (antes de la ronda 1 solo medía 'contexto')", () => {
  const cuerpo = cuerpoDeFuncion(leer(RESERVAR_ARCHIVO), "reservarProgramaInterno");

  test("mide 'validacion_programa'", () => {
    assert.match(cuerpo, /registrarEtapa\(\s*"reservar_programa"\s*,\s*flujoId\s*,\s*"validacion_programa"/);
  });

  test("mide 'numero_contrato' (con medir(), no una llamada suelta)", () => {
    assert.match(cuerpo, /medir\(\s*"numero_contrato"/);
  });

  test("mide 'insert_venta'", () => {
    assert.match(cuerpo, /registrarEtapa\(\s*"reservar_programa"\s*,\s*flujoId\s*,\s*"insert_venta"/);
  });

  test("mide 'insert_hijas' (pasajeros/items/hoteles)", () => {
    assert.match(cuerpo, /registrarEtapa\(\s*"reservar_programa"\s*,\s*flujoId\s*,\s*"insert_hijas"/);
  });

  test("mide 'cxp_programa' (cuenta por pagar al proveedor)", () => {
    assert.match(cuerpo, /registrarEtapa\(\s*"reservar_programa"\s*,\s*flujoId\s*,\s*"cxp_programa"/);
  });

  test("hay al menos 5 etapas propias además de 'contexto' — el diagnóstico ya no se detiene en el gate de autorización", () => {
    const nombres = new Set<string>();
    for (const m of cuerpo.matchAll(/(?:registrarEtapa\(\s*"reservar_programa"\s*,\s*flujoId\s*,\s*|medir\(\s*)"([a-z_]+)"/g)) {
      nombres.add(m[1]);
    }
    nombres.delete("contexto");
    assert.ok(nombres.size >= 5, `se esperaban al menos 5 etapas propias, hubo ${nombres.size}: ${[...nombres].join(", ")}`);
  });
});

// ── Defecto 1 confirmado: error.message/asiento.error/e.message/String(e)
// crudo en console.error — ahora TODO pasa por registrarErrorTecnico() ──────
describe("registrarErrorTecnico() — reemplaza TODOS los console.error crudos de esta ronda", () => {
  for (const [archivo, interno] of [
    [CONTRATOS_ARCHIVO, "crearContratoInterno"],
    [RESERVAR_ARCHIVO, "reservarProgramaInterno"],
  ] as const) {
    describe(interno, () => {
      const cuerpo = cuerpoDeFuncion(leer(archivo), interno);

      test("no queda NINGÚN console.error( directo — todo el detalle técnico pasa por registrarErrorTecnico()", () => {
        assert.doesNotMatch(cuerpo, /console\.error\(/);
      });

      test("cada llamada a registrarErrorTecnico() tiene 5 argumentos: flujo/etapa como literales, detalle literal (o el parámetro `detalle` de _errorHijas), y el ERROR CRUDO (nunca .message/String(...) pre-procesado — el helper sanea internamente)", () => {
        const llamadas = llamadasA(cuerpo, "registrarErrorTecnico");
        assert.ok(llamadas.length > 0, `${interno} debería tener al menos una llamada a registrarErrorTecnico()`);
        for (const args of llamadas) {
          const partes = dividirArgsTop(args);
          assert.equal(partes.length, 5, `registrarErrorTecnico espera 5 argumentos (flujo, flujoId, etapa, detalle, error): ${args}`);
          const [flujoArg, flujoIdArg, etapaArg, detalleArg, errorArg] = partes;
          assert.match(flujoArg, /^"[a-z_]+"$/, `flujo debe ser un literal de texto fijo: ${flujoArg}`);
          assert.equal(flujoIdArg, "flujoId", `flujoId debe pasarse tal cual: ${flujoIdArg}`);
          assert.match(etapaArg, /^"[a-z0-9_]+"$/, `etapa debe ser un literal de texto fijo: ${etapaArg}`);
          assert.ok(
            /^"[a-z0-9_]+"$/.test(detalleArg) || detalleArg === "detalle",
            `detalle debe ser un literal fijo (o el parámetro \`detalle\` de _errorHijas): ${detalleArg}`
          );
          assert.doesNotMatch(errorArg, /\.message\b/, `NO se debe pre-procesar a .message — pasar el error crudo para que registrarErrorTecnico lo sanee: ${errorArg}`);
          assert.doesNotMatch(errorArg, /^String\(/, `NO se debe pre-procesar con String(...) — pasar el error crudo: ${errorArg}`);
          assert.doesNotMatch(
            errorArg,
            /\b(input|cliente|numero|precioVenta|documento|correo|payload)\b(?!\.)/,
            `posible dato de negocio en el argumento error: ${errorArg}`
          );
        }
      });
    });
  }

  describe("lib/contrato/contexto.ts", () => {
    const cuerpo = cuerpoDeFuncion(leer("lib/contrato/contexto.ts"), "contextoCrearContrato");

    test("no queda NINGÚN console.error( directo", () => {
      assert.doesNotMatch(cuerpo, /console\.error\(/);
    });

    test("usa registrarErrorTecnico() para el detalle técnico de auth.getUser y de la consulta de perfil, con el error CRUDO (res.error, no res.error.message)", () => {
      assert.match(cuerpo, /registrarErrorTecnico\(flujo,\s*flujoId,\s*"contexto_auth_getUser",\s*"error_auth_getUser",\s*res\.error\)/);
      assert.match(cuerpo, /registrarErrorTecnico\(flujo,\s*flujoId,\s*"contexto_perfil_query",\s*"error_consulta_perfil",\s*res\.error\)/);
    });
  });
});

// ── Defecto 2 confirmado: el TOTAL clasificaba cualquier {ok:false} como
// "rechazado", incluso un fallo TÉCNICO bloqueante (RPC de numeración,
// insert de ventas, insert obligatorio de una tabla hija) ──────────────────
describe("elevarEstadoFlujo(estado, \"error\") — fallos técnicos BLOQUEANTES elevan 'error', nunca quedan como 'rechazado'", () => {
  test("crearContratoInterno: numero_contrato / insert_venta / insert_hijas (bloqueante) elevan 'error' antes de devolver el rechazo", () => {
    const cuerpo = cuerpoDeFuncion(leer(CONTRATOS_ARCHIVO), "crearContratoInterno");

    const idxNum = cuerpo.indexOf("if (!numRes.ok)");
    const idxNumRet = cuerpo.indexOf("return { ok: false, error: numRes.error };", idxNum);
    const idxNumElevar = cuerpo.indexOf('elevarEstadoFlujo(estado, "error")', idxNum);
    assert.ok(idxNum > -1 && idxNumRet > -1, "no se encontró el chequeo de numero_contrato");
    assert.ok(idxNumElevar > idxNum && idxNumElevar < idxNumRet, "numero_contrato debe elevar 'error' ANTES de devolver el rechazo");

    const idxVenta = cuerpo.indexOf("if (ve) {");
    const idxVentaRet = cuerpo.indexOf("return { ok: false, error: ve.message };", idxVenta);
    const idxVentaElevar = cuerpo.indexOf('elevarEstadoFlujo(estado, "error")', idxVenta);
    assert.ok(idxVenta > -1 && idxVentaRet > -1, "no se encontró el chequeo de insert_venta");
    assert.ok(idxVentaElevar > idxVenta && idxVentaElevar < idxVentaRet, "insert_venta debe elevar 'error' ANTES de devolver el rechazo");

    const idxErrorHijas = cuerpo.indexOf("const _errorHijas =");
    assert.ok(idxErrorHijas > -1, "no se encontró el helper _errorHijas");
    const cuerpoErrorHijas = cuerpo.slice(idxErrorHijas, cuerpo.indexOf("};", idxErrorHijas) + 2);
    assert.match(cuerpoErrorHijas, /elevarEstadoFlujo\(estado,\s*"error"\)/, "_errorHijas (bloqueante) debe elevar 'error'");
  });

  test("reservarProgramaInterno: numero_contrato / insert_venta / insert_hijas (bloqueante) elevan 'error' antes de devolver el rechazo", () => {
    const cuerpo = cuerpoDeFuncion(leer(RESERVAR_ARCHIVO), "reservarProgramaInterno");

    const idxNum = cuerpo.indexOf("if (!numRes.ok)");
    const idxNumRet = cuerpo.indexOf("return { ok: false, error: numRes.error };", idxNum);
    const idxNumElevar = cuerpo.indexOf('elevarEstadoFlujo(estado, "error")', idxNum);
    assert.ok(idxNum > -1 && idxNumRet > -1, "no se encontró el chequeo de numero_contrato");
    assert.ok(idxNumElevar > idxNum && idxNumElevar < idxNumRet, "numero_contrato debe elevar 'error' ANTES de devolver el rechazo");

    const idxVenta = cuerpo.indexOf("if (ve) {");
    const idxVentaRet = cuerpo.indexOf("return { ok: false, error: ve.message };", idxVenta);
    const idxVentaElevar = cuerpo.indexOf('elevarEstadoFlujo(estado, "error")', idxVenta);
    assert.ok(idxVenta > -1 && idxVentaRet > -1, "no se encontró el chequeo de insert_venta");
    assert.ok(idxVentaElevar > idxVenta && idxVentaElevar < idxVentaRet, "insert_venta debe elevar 'error' ANTES de devolver el rechazo");

    const idxErrorHijas = cuerpo.indexOf("const _errorHijas =");
    assert.ok(idxErrorHijas > -1, "no se encontró el helper _errorHijas");
    const cuerpoErrorHijas = cuerpo.slice(idxErrorHijas, cuerpo.indexOf("};", idxErrorHijas) + 2);
    assert.match(cuerpoErrorHijas, /elevarEstadoFlujo\(estado,\s*"error"\)/, "_errorHijas (bloqueante) debe elevar 'error'");
  });
});

describe("elevarEstadoFlujo(estado, \"parcial\") — pasos BEST-EFFORT caídos elevan 'parcial' (el contrato/reserva SÍ se creó, nunca bloquean, pero el TOTAL ya no dice 'ok' a ciegas)", () => {
  test("crearContratoInterno: cxp_automaticas / negociado_admin / aliado_b2b", () => {
    const cuerpo = cuerpoDeFuncion(leer(CONTRATOS_ARCHIVO), "crearContratoInterno");
    assert.match(cuerpo, /if\s*\(_resultadoCxp\s*!==\s*"ok"\)\s*elevarEstadoFlujo\(estado,\s*"parcial"\)/, "cxp_automaticas");
    const idxAdminBlock = cuerpo.indexOf("if (_huboBloqueAdmin) {");
    assert.ok(idxAdminBlock > -1, "no se encontró el bloque 'if (_huboBloqueAdmin)'");
    const cuerpoAdminBlock = cuerpo.slice(idxAdminBlock, cuerpo.indexOf("}", cuerpo.indexOf("elevarEstadoFlujo", idxAdminBlock)) + 1);
    assert.match(cuerpoAdminBlock, /if\s*\(_resultadoAdmin\s*!==\s*"ok"\)\s*elevarEstadoFlujo\(estado,\s*"parcial"\)/, "negociado_admin");
    const idxAliadoBlock = cuerpo.indexOf("if (aliado) {\n    registrarEtapa(\"crear_contrato\", flujoId, \"aliado_b2b\"");
    assert.ok(idxAliadoBlock > -1, "no se encontró el bloque 'if (aliado)' que registra la etapa aliado_b2b");
    const cuerpoAliadoBlock = cuerpo.slice(idxAliadoBlock, cuerpo.indexOf("}", cuerpo.indexOf("elevarEstadoFlujo", idxAliadoBlock)) + 1);
    assert.match(cuerpoAliadoBlock, /if\s*\(_resultadoAliado\s*!==\s*"ok"\)\s*elevarEstadoFlujo\(estado,\s*"parcial"\)/, "aliado_b2b");
  });

  test("reservarProgramaInterno: insert_hijas (hoteles, no bloqueante) / cxp_programa", () => {
    const cuerpo = cuerpoDeFuncion(leer(RESERVAR_ARCHIVO), "reservarProgramaInterno");
    assert.match(cuerpo, /if\s*\(_resultadoHijas\s*!==\s*"ok"\)\s*elevarEstadoFlujo\(estado,\s*"parcial"\)/, "insert_hijas (hoteles)");
    const idxCxpBlock = cuerpo.indexOf("if (_huboBloqueCxp) {");
    assert.ok(idxCxpBlock > -1, "no se encontró el bloque 'if (_huboBloqueCxp)'");
    const cuerpoCxpBlock = cuerpo.slice(idxCxpBlock, cuerpo.indexOf("}", cuerpo.indexOf("elevarEstadoFlujo", idxCxpBlock)) + 1);
    assert.match(cuerpoCxpBlock, /if\s*\(_resultadoCxp\s*!==\s*"ok"\)\s*elevarEstadoFlujo\(estado,\s*"parcial"\)/, "cxp_programa");
  });
});

// ── Defecto 3 confirmado: validacion_negocio/validacion_programa solo
// emitían su etapa cuando llegaban al final correctamente ──────────────────
describe("validacion_negocio/validacion_programa registran 'rechazado' en CADA return de rechazo, sin duplicar el log de éxito ni reordenar nada", () => {
  test("crearContratoInterno: 7 puntos de rechazo pasan por _rechazarValidacion(); el log de éxito ('ok') aparece UNA sola vez", () => {
    const cuerpo = cuerpoDeFuncion(leer(CONTRATOS_ARCHIVO), "crearContratoInterno");
    const usos = [...cuerpo.matchAll(/return _rechazarValidacion\(/g)];
    assert.equal(usos.length, 7, `se esperaban 7 puntos de rechazo envueltos, hubo ${usos.length}`);
    const logsOk = [...cuerpo.matchAll(/registrarEtapa\("crear_contrato", flujoId, "validacion_negocio", Math\.round\(performance\.now\(\) - _tValidacion0\), "ok"\)/g)];
    assert.equal(logsOk.length, 1, "el log de éxito de validacion_negocio debe aparecer exactamente una vez (al final de la sección)");
    const logsRechazado = [...cuerpo.matchAll(/registrarEtapa\("crear_contrato", flujoId, "validacion_negocio", Math\.round\(performance\.now\(\) - _tValidacion0\), "rechazado"\)/g)];
    assert.equal(logsRechazado.length, 1, "el log de rechazo debe estar UNA sola vez, dentro de la definición de _rechazarValidacion (reutilizada en los 7 returns)");
  });

  test("reservarProgramaInterno: 14 puntos de rechazo pasan por _rechazarValidacionPrograma(); el log de éxito ('ok') aparece UNA sola vez", () => {
    const cuerpo = cuerpoDeFuncion(leer(RESERVAR_ARCHIVO), "reservarProgramaInterno");
    const usos = [...cuerpo.matchAll(/return _rechazarValidacionPrograma\(/g)];
    assert.equal(usos.length, 14, `se esperaban 14 puntos de rechazo envueltos, hubo ${usos.length}`);
    const logsOk = [...cuerpo.matchAll(/registrarEtapa\("reservar_programa", flujoId, "validacion_programa", Math\.round\(performance\.now\(\) - _tValidacionProg0\), "ok"\)/g)];
    assert.equal(logsOk.length, 1, "el log de éxito de validacion_programa debe aparecer exactamente una vez (al final de la sección)");
    const logsRechazado = [...cuerpo.matchAll(/registrarEtapa\("reservar_programa", flujoId, "validacion_programa", Math\.round\(performance\.now\(\) - _tValidacionProg0\), "rechazado"\)/g)];
    assert.equal(logsRechazado.length, 1, "el log de rechazo debe estar UNA sola vez, dentro de la definición de _rechazarValidacionPrograma (reutilizada en los 14 returns)");
  });
});

describe("No PII/payload en los logs de medición — crearContratoInterno/reservarProgramaInterno", () => {
  for (const [archivo, interno] of [
    [CONTRATOS_ARCHIVO, "crearContratoInterno"],
    [RESERVAR_ARCHIVO, "reservarProgramaInterno"],
  ] as const) {
    describe(interno, () => {
      const cuerpo = cuerpoDeFuncion(leer(archivo), interno);

      test("ninguna llamada a registrarEtapa() usa un nombre de etapa DINÁMICO — siempre un literal de texto", () => {
        for (const args of llamadasA(cuerpo, "registrarEtapa")) {
          const partes = args.split(",");
          assert.ok(partes.length >= 3, `registrarEtapa con muy pocos argumentos: ${args}`);
          const etapaArg = partes[2].trim();
          assert.match(etapaArg, /^"[a-z0-9_]+"$/, `la etapa debe ser un literal de texto fijo, no algo dinámico — se encontró: ${etapaArg}`);
        }
      });

      test("ninguna llamada a medir()/crearMedidor() usa un flujo/etapa DINÁMICO — siempre literales", () => {
        for (const args of llamadasA(cuerpo, "medir")) {
          const primerArg = args.split(",")[0]?.trim();
          assert.match(primerArg ?? "", /^"[a-z_]+"$/, `la etapa de medir() debe ser un literal — se encontró: ${primerArg}`);
        }
      });
    });
  }
});
