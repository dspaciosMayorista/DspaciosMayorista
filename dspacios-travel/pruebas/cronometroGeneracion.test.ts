// Medición por etapas de generarTarifario (solo diagnóstico).
//   node --test --experimental-strip-types pruebas/cronometroGeneracion.test.ts
// Parte 1: el módulo puro. Parte 2: el cableado en generarTarifario, por inspección del código FUENTE (mismo criterio que
// tarifarioRevisionCapturaWiring.test.ts): la medición no cambia el cálculo ni la publicación y no registra datos sensibles.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { contarPorModulo, crearCronometro, esTimeoutPostgres, lineaMedicionGeneracion } from "../lib/tarifario/cronometroGeneracion.ts";

describe("cronómetro por etapas", () => {
  test("acumula el tiempo de cada etapa cerrada y mide la etapa en curso", () => {
    let t = 1000;
    const c = crearCronometro(() => t);
    t += 5; c.etapa("lectura_fuentes");
    t += 120; c.etapa("calculo");
    t += 30; c.etapa("publicar");
    t += 7000;
    assert.equal(c.cerradasTexto(), "inicio=5ms,lectura_fuentes=120ms,calculo=30ms");
    assert.deepEqual(c.actual(), { etapa: "publicar", msEtapa: 7000, msTotal: 7155 });
  });
});

describe("esTimeoutPostgres", () => {
  test("reconoce statement/lock timeout por mensaje, SQLSTATE y objeto", () => {
    assert.equal(esTimeoutPostgres("canceling statement due to statement timeout"), true);
    assert.equal(esTimeoutPostgres("canceling statement due to lock timeout"), true);
    assert.equal(esTimeoutPostgres({ code: "57014" }), true);
    assert.equal(esTimeoutPostgres({ code: "55P03" }), true);
    assert.equal(esTimeoutPostgres({ message: "canceling statement due to statement timeout" }), true);
  });
  test("no confunde otros errores ni valores vacíos", () => {
    assert.equal(esTimeoutPostgres("duplicate key value violates unique constraint"), false);
    assert.equal(esTimeoutPostgres({ code: "23505", message: "x" }), false);
    assert.equal(esTimeoutPostgres(null), false);
    assert.equal(esTimeoutPostgres(undefined), false);
  });
});

describe("contarPorModulo", () => {
  test("cuenta por módulo y manda a «otro» lo que no es un nombre fijo", () => {
    const filas = [{ modulo: "bloqueo" }, { modulo: "bloqueo" }, { modulo: "servicios" }, { modulo: "Texto libre con espacios" }, {}];
    assert.deepEqual(contarPorModulo(filas), { bloqueo: 2, servicios: 1, otro: 2 });
  });
});

describe("lineaMedicionGeneracion", () => {
  const base = { paqueteId: 33, generacion: 7, resultado: "timeout" as const, etapa: "publicar", msEtapa: 8003, msTotal: 11400, etapasCerradas: "inicio=2ms,calculo=2100ms", filas: 22400, filasPorModulo: { bloqueo: 22000, servicios: 400 } };
  test("trae paquete, generación, resultado, etapa, duraciones y filas en una sola línea", () => {
    const l = lineaMedicionGeneracion(base);
    assert.equal(l.includes("\n"), false);
    for (const parte of ["paquete_id=33", "generacion=7", "resultado=timeout", "etapa=publicar", "ms_etapa=8003", "ms_total=11400", "filas_calculadas=22400", "filas_por_modulo=[bloqueo:22000,servicios:400]", "etapas_previas=[inicio=2ms,calculo=2100ms]"]) {
      assert.ok(l.includes(parte), `falta ${parte} en: ${l}`);
    }
  });
  test("sin generación o sin filas aún, lo dice con «?» en vez de inventar", () => {
    const l = lineaMedicionGeneracion({ ...base, generacion: null, filas: null, filasPorModulo: null });
    assert.ok(l.includes("generacion=?") && l.includes("filas_calculadas=?") && l.includes("filas_por_modulo=[?]"));
  });
});

describe("cableado en generarTarifario (código fuente)", () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
  const todo = readFileSync(join(raiz, "app/(dashboard)/dashboard/paquetes/actions.ts"), "utf8").replace(/\r\n/g, "\n");
  const ini = todo.indexOf("export async function generarTarifario(paqueteId: number): Promise<Result> {");
  const fin = todo.indexOf("\nexport async function ", ini + 10);
  const cuerpo = todo.slice(ini, fin);

  test("las etapas se marcan en orden y la publicación va al final", () => {
    const orden = ["iniciar_generacion", "lectura_paquete", "lectura_fuentes", "lectura_grupos_servicio", "lectura_bernalo", "lectura_hoteles",
      "lectura_destinos_aereos", "lectura_salidas", "evaluacion_publicacion", "calculo", "publicar"];
    let desde = 0;
    for (const e of orden) {
      const i = cuerpo.indexOf(`cron.etapa("${e}")`, desde);
      assert.ok(i >= 0, `falta cron.etapa("${e}") o está fuera de orden`);
      desde = i + 1;
    }
  });

  test("todas las salidas registran la medición: fallos de negocio y técnicos, descartado, éxito y fallo de iniciar", () => {
    assert.match(cuerpo, /const fallar = async[^\n]*\n\s*medir\("fallo_negocio"\);/);
    assert.match(cuerpo, /medir\(esTimeoutPostgres\(detalleCrudo\) \? "timeout" : "fallo_tecnico"\);/);
    assert.match(cuerpo, /medir\(esTimeoutPostgres\(eGen\) \? "timeout" : "fallo_tecnico"\);/);
    assert.match(cuerpo, /medir\("descartado"\);\s*\n\s*return \{/);
    assert.match(cuerpo, /medir\("ok"\);\s*\n\s*revalidatePath/);
  });

  test("la medición va ANTES de marcar el fallo (no suma el tiempo de marcar_generacion_fallida) y nunca lanza", () => {
    assert.ok(cuerpo.indexOf('medir("fallo_negocio")') < cuerpo.indexOf("await marcarFallo(mensaje)"));
    const m = cuerpo.indexOf("const medir = ");
    assert.match(cuerpo.slice(m, m + 1200), /try \{[\s\S]*\} catch \{/);
  });

  test("el usuario y la base siguen recibiendo exactamente lo mismo: mensajes y llamadas de publicación intactos", () => {
    assert.ok(cuerpo.includes("return { ok: false, error: MENSAJE_ERROR_TECNICO_TARIFARIO };"));
    assert.ok(cuerpo.includes('sb.rpc("publicar_tarifario_resultado_63"'));
    assert.ok(cuerpo.includes('sb.rpc("publicar_tarifario_resultado"'));
    assert.ok(cuerpo.includes("p_filas: filas as unknown as Json"));
    assert.equal((cuerpo.match(/sb\.rpc\("iniciar_generacion_tarifario"/g) ?? []).length, 1);
  });

  test("la línea de medición no incluye texto de Postgres ni datos de personas", () => {
    const m = cuerpo.indexOf("const medir = ");
    const bloque = cuerpo.slice(m, cuerpo.indexOf("};", m));
    assert.doesNotMatch(bloque, /detalleCrudo|\.message|nombre|email|cliente/i);
  });
});
