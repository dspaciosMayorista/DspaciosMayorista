import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Wiring de TEXTO (mismo patrón que pruebas/numeracionOrdenWiring.test.ts y
// pruebas/contratoContexto.test.ts) sobre crearContrato/reservarPrograma —
// revisión posterior al PR #275 ("Corrige únicamente la observabilidad"):
//   1) medición TOTAL de la Server Action (éxito, rechazo temprano, excepción);
//   2) el mismo flujo_id ata la etapa "contexto" con el resto de las etapas;
//   3) reservarPrograma mide más allá del contexto (antes solo medía eso);
//   4) ningún console.error/registrarEtapa/medir puede filtrar PII o el
//      payload — se verifica que sus argumentos sean literales/`.message`,
//      nunca `input`/`cliente`/`numero`/el objeto `error` completo.
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

describe("crearContrato/reservarPrograma — medición TOTAL en éxito, rechazo y excepción", () => {
  for (const [archivo, wrapper, interno, flujo] of [
    ["app/(dashboard)/dashboard/contratos/actions.ts", "crearContrato", "crearContratoInterno", "crear_contrato"],
    ["app/(dashboard)/dashboard/reservar/actions.ts", "reservarPrograma", "reservarProgramaInterno", "reservar_programa"],
  ] as const) {
    describe(`${wrapper} (${archivo})`, () => {
      const cuerpo = cuerpoDeFuncion(leer(archivo), wrapper);

      test("genera un flujo_id propio con generarFlujoId()", () => {
        assert.match(cuerpo, /const\s+flujoId\s*=\s*generarFlujoId\(\)/);
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
        // El catch debe marcar error y volver a lanzar (no tragarse la excepción).
        const idxCatch = cuerpo.search(/\}\s*catch\s*\(/);
        const cuerpoCatch = cuerpo.slice(idxCatch, cuerpo.indexOf("finally", idxCatch));
        assert.match(cuerpoCatch, /_resultadoTotal\s*=\s*"error"/, "el catch debe marcar el total como error");
        assert.match(cuerpoCatch, /throw\s+err\s*;/, "el catch debe volver a lanzar la excepción (no debe tragársela)");
      });

      test("el finally registra la etapa 'total' con el mismo flujo_id, usando registrarEtapa()", () => {
        const idxFinally = cuerpo.search(/\}\s*finally\s*\{/);
        const cuerpoFinally = cuerpo.slice(idxFinally);
        assert.match(cuerpoFinally, new RegExp(`registrarEtapa\\(\\s*"${flujo}"\\s*,\\s*flujoId\\s*,\\s*"total"`));
      });

      test(`llama a ${interno}(input, flujoId, medir) — el flujo_id generado se propaga a la lógica real`, () => {
        assert.match(cuerpo, new RegExp(`${interno}\\(\\s*input\\s*,\\s*flujoId\\s*,\\s*medir\\s*\\)`));
      });

      test("el wrapper NO reimplementa la lógica real (ninguna llamada a contextoCrearContrato ni a siguienteNumeroContrato aquí)", () => {
        assert.doesNotMatch(cuerpo, /contextoCrearContrato\(/);
        assert.doesNotMatch(cuerpo, /siguienteNumeroContrato\(/);
      });
    });
  }
});

describe("reservarPrograma mide MÁS ALLÁ del contexto (antes de esta ronda solo medía 'contexto')", () => {
  const cuerpo = cuerpoDeFuncion(leer("app/(dashboard)/dashboard/reservar/actions.ts"), "reservarProgramaInterno");

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
    const etapas = [...cuerpo.matchAll(/etapa=?["']?\s*"([a-z_]+)"/g)];
    // Cuenta ocurrencias de registrarEtapa/medir con nombre de etapa distinto de "contexto".
    const nombres = new Set<string>();
    for (const m of cuerpo.matchAll(/(?:registrarEtapa\(\s*"reservar_programa"\s*,\s*flujoId\s*,\s*|medir\(\s*)"([a-z_]+)"/g)) {
      nombres.add(m[1]);
    }
    nombres.delete("contexto");
    assert.ok(nombres.size >= 5, `se esperaban al menos 5 etapas propias, hubo ${nombres.size}: ${[...nombres].join(", ")}`);
    void etapas;
  });
});

describe("No PII/payload en los logs de medición — crearContratoInterno/reservarProgramaInterno", () => {
  for (const [archivo, interno] of [
    ["app/(dashboard)/dashboard/contratos/actions.ts", "crearContratoInterno"],
    ["app/(dashboard)/dashboard/reservar/actions.ts", "reservarProgramaInterno"],
  ] as const) {
    describe(interno, () => {
      const cuerpo = cuerpoDeFuncion(leer(archivo), interno);

      test("ninguna llamada a registrarEtapa() usa un nombre de etapa DINÁMICO — siempre un literal de texto", () => {
        for (const args of llamadasA(cuerpo, "registrarEtapa")) {
          // args: flujo, flujoId, etapa, duracionMs, resultado
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

      test("ninguna llamada a console.error() incluye el objeto `input`, `cliente`, `numero`, ni un `error` crudo sin `.message` — solo strings/`.message`/`String(...)`", () => {
        const prohibidos = /\b(input|cliente|numero|precioVenta|documento|correo|payload)\b(?!\.)/;
        for (const args of llamadasA(cuerpo, "console.error")) {
          // El primer argumento es siempre el prefijo `[medicion] ...` (template
          // literal fijo); lo que importa es que NINGÚN argumento (ni el
          // primero ni los siguientes) referencie una variable de datos de
          // negocio directamente. Los argumentos válidos son: template
          // literals con flujo/flujoId/etapa, `.message` de un error, o
          // `String(...)`/`instanceof Error ? ... : ...`.
          assert.doesNotMatch(args, prohibidos, `console.error con posible dato de negocio: ${args}`);
          // Si se pasa una variable llamada exactamente "error"/"e" a secas
          // (el objeto completo, no su `.message`), se considera fuga —
          // debe aparecer siempre como `.message` o dentro de un `String(...)`/
          // ternario `instanceof Error`.
          const segundoArg = args.split(/,(?![^(]*\))/).slice(1).join(",").trim();
          if (segundoArg) {
            // Acepta un acceso a propiedad (`.message`, `.error` — este
            // último ya es un `string` por el tipo `PResult` de
            // lib/contabilidad/asientos.ts, nunca el objeto Error crudo),
            // el manejo estándar `instanceof Error ? ... : String(...)`, o
            // un literal de texto. Lo que NUNCA debe pasar es la variable
            // del error/resultado A SECAS (el objeto completo).
            const esMensaje = /\.(message|error)\b/.test(segundoArg) || /instanceof\s+Error/.test(segundoArg) || /^"/.test(segundoArg);
            assert.ok(esMensaje, `el detalle de console.error debe ser una propiedad de texto (.message/.error) o un manejo equivalente de Error, no el objeto crudo: ${segundoArg}`);
          }
        }
      });
    });
  }
});
