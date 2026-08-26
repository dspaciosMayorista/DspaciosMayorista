import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generarFlujoId, crearMedidor, registrarEtapa } from "../lib/observabilidad/medicion.ts";

// EJECUCIÓN REAL (no grep) de lib/observabilidad/medicion.ts — revisión
// posterior al PR #275 (corrección de observabilidad): el `flujo_id` debe
// ser aleatorio por ejecución, sin PII, y compartido entre todas las etapas
// de una misma ejecución. Se intercepta `console.log`/`console.error`
// temporalmente para inspeccionar las líneas reales que produce el módulo.
function interceptarConsola<T>(fn: () => T): { resultado: T; logs: string[]; errores: unknown[][] } {
  const logs: string[] = [];
  const errores: unknown[][] = [];
  const logOriginal = console.log;
  const errorOriginal = console.error;
  console.log = (...args: unknown[]) => { logs.push(String(args[0])); };
  console.error = (...args: unknown[]) => { errores.push(args); };
  try {
    const resultado = fn();
    return { resultado, logs, errores };
  } finally {
    console.log = logOriginal;
    console.error = errorOriginal;
  }
}

async function interceptarConsolaAsync<T>(fn: () => Promise<T>): Promise<{ resultado: T; logs: string[]; errores: unknown[][] }> {
  const logs: string[] = [];
  const errores: unknown[][] = [];
  const logOriginal = console.log;
  const errorOriginal = console.error;
  console.log = (...args: unknown[]) => { logs.push(String(args[0])); };
  console.error = (...args: unknown[]) => { errores.push(args); };
  try {
    const resultado = await fn();
    return { resultado, logs, errores };
  } finally {
    console.log = logOriginal;
    console.error = errorOriginal;
  }
}

describe("generarFlujoId()", () => {
  test("devuelve un string no vacío", () => {
    const id = generarFlujoId();
    assert.equal(typeof id, "string");
    assert.ok(id.length > 0);
  });

  test("dos llamadas devuelven ids DIFERENTES (para poder distinguir dos reservas simultáneas)", () => {
    const a = generarFlujoId();
    const b = generarFlujoId();
    assert.notEqual(a, b);
  });

  test("no tiene forma de numero_contrato (DTM-####/MIN-...) ni de ningún dato de negocio — es un UUID", () => {
    const id = generarFlujoId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.doesNotMatch(id, /^DTM-|^MIN-/);
  });
});

describe("crearMedidor() — todas las etapas de UNA ejecución comparten el mismo flujo_id", () => {
  test("dos etapas medidas con el MISMO medidor emiten el mismo flujo_id en la línea de log", async () => {
    const flujoId = generarFlujoId();
    const medir = crearMedidor("crear_contrato", flujoId);
    const { logs } = await interceptarConsolaAsync(async () => {
      await medir("etapa_uno", async () => "x");
      await medir("etapa_dos", async () => "y");
    });
    assert.equal(logs.length, 2);
    for (const linea of logs) {
      assert.match(linea, new RegExp(`flujo_id=${flujoId}\\b`));
    }
  });

  test("dos EJECUCIONES distintas (dos medidores, cada uno con su propio flujo_id) nunca comparten flujo_id", async () => {
    const flujoIdA = generarFlujoId();
    const flujoIdB = generarFlujoId();
    const medirA = crearMedidor("crear_contrato", flujoIdA);
    const medirB = crearMedidor("crear_contrato", flujoIdB);
    const { logs: logsA } = await interceptarConsolaAsync(async () => { await medirA("etapa", async () => 1); });
    const { logs: logsB } = await interceptarConsolaAsync(async () => { await medirB("etapa", async () => 1); });
    assert.match(logsA[0], new RegExp(`flujo_id=${flujoIdA}\\b`));
    assert.match(logsB[0], new RegExp(`flujo_id=${flujoIdB}\\b`));
    assert.doesNotMatch(logsA[0], new RegExp(`flujo_id=${flujoIdB}\\b`));
  });

  test("línea de log trae el formato completo: flujo, flujo_id, etapa, duracion_ms, resultado", async () => {
    const flujoId = generarFlujoId();
    const medir = crearMedidor("reservar_programa", flujoId);
    const { logs } = await interceptarConsolaAsync(async () => {
      await medir("mi_etapa", async () => 42, () => "ok");
    });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^\[medicion\] flujo=reservar_programa flujo_id=[0-9a-f-]+ etapa=mi_etapa duracion_ms=\d+ resultado=ok$/);
  });

  test("resultadoDe() decide la clasificación — ok/error/parcial/rechazado, ejecución real", async () => {
    const flujoId = generarFlujoId();
    const medir = crearMedidor("crear_contrato", flujoId);
    for (const esperado of ["ok", "error", "parcial", "rechazado"] as const) {
      const { logs } = await interceptarConsolaAsync(async () => {
        await medir("etapa", async () => ({ marca: esperado }), (v) => v.marca);
      });
      assert.match(logs[0], new RegExp(`resultado=${esperado}$`));
    }
  });

  test("un error de Supabase (fn resuelve con {error}) clasifica como 'error', NUNCA 'ok', si resultadoDe lo revisa", async () => {
    const flujoId = generarFlujoId();
    const medir = crearMedidor("crear_contrato", flujoId);
    const { logs } = await interceptarConsolaAsync(async () => {
      await medir(
        "consulta",
        async () => ({ data: null, error: { message: "permission denied for table x" } }),
        (r) => (r.error ? "error" : "ok")
      );
    });
    assert.match(logs[0], /resultado=error$/);
    assert.doesNotMatch(logs[0], /resultado=ok$/);
  });

  test("si fn() LANZA una excepción, el medidor registra resultado=error y RE-LANZA (no se traga el error)", async () => {
    const flujoId = generarFlujoId();
    const medir = crearMedidor("crear_contrato", flujoId);
    let lanzo = false;
    const { logs } = await interceptarConsolaAsync(async () => {
      try {
        await medir("etapa_que_falla", async () => {
          throw new Error("fallo real de red");
        });
      } catch {
        lanzo = true;
      }
    });
    assert.ok(lanzo, "el medidor debía re-lanzar la excepción");
    assert.match(logs[0], /etapa=etapa_que_falla duracion_ms=\d+ resultado=error$/);
  });
});

describe("registrarEtapa() — para etapas con retorno anticipado propio (no medibles con un solo fn)", () => {
  test("emite exactamente la línea con flujo/flujo_id/etapa/duracion/resultado dados", () => {
    const flujoId = generarFlujoId();
    const { logs } = interceptarConsola(() => {
      registrarEtapa("crear_contrato", flujoId, "insert_hijas", 123, "parcial");
    });
    assert.equal(logs.length, 1);
    assert.equal(logs[0], `[medicion] flujo=crear_contrato flujo_id=${flujoId} etapa=insert_hijas duracion_ms=123 resultado=parcial`);
  });

  test("nunca escribe a console.error (eso es responsabilidad del caller, con el detalle técnico aparte)", () => {
    const flujoId = generarFlujoId();
    const { errores } = interceptarConsola(() => {
      registrarEtapa("crear_contrato", flujoId, "etapa", 1, "error");
    });
    assert.equal(errores.length, 0);
  });
});
