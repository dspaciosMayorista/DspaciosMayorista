import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ejecutarConcurrentes, orquestarCargaReservar, orquestarCargaPublica, orquestarCargaInterna } from "../lib/tarifario/orquestacion.ts";

// EJECUCIÓN REAL (no grep) — revisión posterior, defecto "PRUEBA REAL DE
// CONCURRENCIA" confirmado: pruebas/tarifarioCargaWiring.test.ts solo
// inspeccionaba texto (que el código contuviera `Promise.all`), lo que
// nunca prueba que dos tareas de verdad se ejecutan solapadas. Aquí se usan
// PROMESAS DIFERIDAS (deferred): cada tarea de prueba se resuelve
// manualmente cuando el test lo decide, así que se puede observar el orden
// EXACTO de invocación y resolución.
function diferida<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>((r) => { resolver = r; });
  return { promesa, resolver };
}

describe("ejecutarConcurrentes() — todas las tareas se invocan ANTES de esperar cualquier resultado", () => {
  test("dos tareas diferidas: ambas están 'en vuelo' antes de que cualquiera resuelva — ninguna espera a la otra para ARRANCAR", async () => {
    const a = diferida<number>();
    const b = diferida<number>();
    const invocadas: string[] = [];

    const promesa = ejecutarConcurrentes({
      a: () => { invocadas.push("a"); return a.promesa; },
      b: () => { invocadas.push("b"); return b.promesa; },
    });

    // Sin haber resuelto NADA todavía, las dos ya deben haberse invocado —
    // la prueba de concurrencia real: la invocación de "b" no depende de
    // que "a" haya resuelto.
    assert.deepEqual(invocadas, ["a", "b"]);

    // Resuelve en orden INVERSO al de invocación — si hubiera dependencia
    // oculta (secuencial disfrazada), esto se comportaría distinto.
    b.resolver(2);
    a.resolver(1);
    const r = await promesa;
    assert.deepEqual(r, { a: 1, b: 2 });
  });

  test("un rechazo de una de las tareas: la función completa se rechaza (no queda 'b' resuelto en silencio, ni éxito parcial)", async () => {
    let capturado: unknown = null;
    const a = diferida<number>();
    const b = diferida<number>();
    const promesa = ejecutarConcurrentes({ a: () => a.promesa, b: () => b.promesa });
    promesa.catch((e) => { capturado = e; });
    const ERROR = new Error("b falló");
    b.resolver(Promise.reject(ERROR) as unknown as number);
    a.resolver(1);
    await assert.rejects(promesa, ERROR);
    await Promise.resolve();
    assert.equal(capturado, ERROR);
  });

  test("3 tareas: todas se invocan sincrónicamente antes del primer await, sin importar el orden de resolución", async () => {
    const invocadas: string[] = [];
    const d1 = diferida<string>();
    const d2 = diferida<string>();
    const d3 = diferida<string>();
    const promesa = ejecutarConcurrentes({
      x: () => { invocadas.push("x"); return d1.promesa; },
      y: () => { invocadas.push("y"); return d2.promesa; },
      z: () => { invocadas.push("z"); return d3.promesa; },
    });
    assert.deepEqual(invocadas, ["x", "y", "z"]);
    d3.resolver("Z"); d1.resolver("X"); d2.resolver("Y");
    assert.deepEqual(await promesa, { x: "X", y: "Y", z: "Z" });
  });
});

describe("orquestarCargaReservar() — liberarVencidas TERMINA antes de que cargarTarifario/cargarProgramas siquiera se INVOQUEN", () => {
  test("cargarTarifario/cargarProgramas no se llaman mientras liberarVencidas sigue pendiente", async () => {
    const invocadas: string[] = [];
    const dLiberar = diferida<{ ok: boolean; liberadas: number }>();
    const dDatos = diferida<{ cupos: number }>();
    const dProgramas = diferida<{ n: number }>();

    const promesa = orquestarCargaReservar({
      liberarVencidas: () => { invocadas.push("liberarVencidas"); return dLiberar.promesa; },
      cargarTarifario: () => { invocadas.push("cargarTarifario"); return dDatos.promesa; },
      cargarProgramas: () => { invocadas.push("cargarProgramas"); return dProgramas.promesa; },
    });

    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(invocadas, ["liberarVencidas"], "cargarTarifario/cargarProgramas NO deben invocarse todavía");

    dLiberar.resolver({ ok: true, liberadas: 2 });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(invocadas, ["liberarVencidas", "cargarTarifario", "cargarProgramas"], "una vez liberarVencidas resuelve, las dos arrancan JUNTAS");

    dProgramas.resolver({ n: 3 });
    dDatos.resolver({ cupos: 5 });
    const r = await promesa;
    assert.deepEqual(r, { liberado: { ok: true, liberadas: 2 }, datos: { cupos: 5 }, programas: { n: 3 } });
  });

  test("cargarTarifario y cargarProgramas SÍ arrancan concurrentes entre sí (una vez pasada la barrera de liberarVencidas)", async () => {
    const invocadas: string[] = [];
    const dLiberar = diferida<{ ok: boolean; liberadas: number }>();
    const dDatos = diferida<number>();
    const dProgramas = diferida<number>();
    const promesa = orquestarCargaReservar({
      liberarVencidas: () => dLiberar.promesa,
      cargarTarifario: () => { invocadas.push("tarifario"); return dDatos.promesa; },
      cargarProgramas: () => { invocadas.push("programas"); return dProgramas.promesa; },
    });
    dLiberar.resolver({ ok: true, liberadas: 0 });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(invocadas, ["tarifario", "programas"], "ambas invocadas antes de que cualquiera resuelva");
    dProgramas.resolver(1); dDatos.resolver(2);
    await promesa;
  });
});

describe("orquestarCargaPublica() — sesión resuelve ANTES de que datos/programas/config_sitio se invoquen; las 3 arrancan juntas", () => {
  test("datos/programas/configSitio no se invocan mientras la sesión sigue pendiente", async () => {
    const invocadas: string[] = [];
    const dSesion = diferida<{ user: null }>();
    const dDatos = diferida<number>();
    const dProgramas = diferida<number>();
    const dConfig = diferida<number>();

    const promesa = orquestarCargaPublica({
      resolverSesion: () => { invocadas.push("sesion"); return dSesion.promesa; },
      cargarTarifario: () => { invocadas.push("datos"); return dDatos.promesa; },
      cargarProgramas: () => { invocadas.push("programas"); return dProgramas.promesa; },
      cargarConfigSitio: () => { invocadas.push("config"); return dConfig.promesa; },
    });

    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(invocadas, ["sesion"]);

    dSesion.resolver({ user: null });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(invocadas, ["sesion", "datos", "programas", "config"], "las 3 cargas de datos deben arrancar JUNTAS después de la sesión");

    dConfig.resolver(1); dDatos.resolver(2); dProgramas.resolver(3);
    const r = await promesa;
    assert.deepEqual(r, { sesion: { user: null }, datos: 2, programas: 3, configSitio: 1 });
  });
});

describe("orquestarCargaInterna() — /dashboard/tarifario: tarifario y programas arrancan juntos, sin paso previo", () => {
  test("ambas se invocan sincrónicamente, sin depender una de la otra", async () => {
    const invocadas: string[] = [];
    const dTarifario = diferida<number>();
    const dProgramas = diferida<number>();
    const promesa = orquestarCargaInterna({
      cargarTarifario: () => { invocadas.push("tarifario"); return dTarifario.promesa; },
      cargarProgramas: () => { invocadas.push("programas"); return dProgramas.promesa; },
    });
    assert.deepEqual(invocadas, ["tarifario", "programas"]);
    dProgramas.resolver(1); dTarifario.resolver(2);
    assert.deepEqual(await promesa, { tarifario: 2, programas: 1 });
  });
});
