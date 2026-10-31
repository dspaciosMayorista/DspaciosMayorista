import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ColaSeleccion, efectivos, estadoFila, bloqueoGenerar, type ResultadoOperacion } from "../lib/paquetes/seleccionOptimista.ts";

type Sel = { bloqueo_id: number; aplica_mk: boolean; ta: number };
const defecto = (id: number): Sel => ({ bloqueo_id: id, aplica_mk: true, ta: 0 });
const servidor: Sel[] = [{ bloqueo_id: 1, aplica_mk: true, ta: 0 }];
const ids = (c: ColaSeleccion, srv: Sel[] = servidor) => [...efectivos(c.instantanea(), "vuelo", srv, "bloqueo_id", defecto).keys()].sort((a, b) => a - b);

/** Acción simulada controlable: la promesa se resuelve a mano y se registra el orden/concurrencia con que el servidor la recibe. */
function servidorFalso() {
  const log: string[] = [];
  let enVuelo = 0, maxEnVuelo = 0;
  const pendientes: { resolver: (r: ResultadoOperacion) => void; nombre: string }[] = [];
  const accion = (nombre: string) => () => {
    log.push(nombre); enVuelo++; maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
    return new Promise<ResultadoOperacion>((res) => pendientes.push({ nombre, resolver: (r) => { enVuelo--; res(r); } }));
  };
  const resolver = async (nombre: string, r: ResultadoOperacion = { ok: true }) => {
    const i = pendientes.findIndex((p) => p.nombre === nombre);
    assert.ok(i >= 0, `no hay una acción en vuelo llamada ${nombre}`);
    pendientes.splice(i, 1)[0].resolver(r);
    await new Promise((x) => setImmediate(x));
  };
  return { accion, resolver, log, get maxEnVuelo() { return maxEnVuelo; } };
}
const marcar = (c: ColaSeleccion, id: number, f: ReturnType<typeof servidorFalso>, nombre: string, valor: Record<string, unknown> | null = {}) =>
  c.solicitar({ tipo: "vuelo", items: [{ id, valor }], ejecutar: f.accion(nombre), coalescible: true });

describe("respuesta inmediata", () => {
  test("al solicitar, el cambio ya es visible y la fila queda «Guardando» antes de que el servidor responda", () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    marcar(c, 2, f, "m2");
    assert.deepEqual(ids(c), [1, 2]);
    assert.equal(estadoFila(c.instantanea(), "vuelo", 2).guardando, true);
    assert.equal(c.instantanea().pendientes, 1);
  });
  test("desmarcar una fila del servidor se ve al instante", () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    marcar(c, 1, f, "d1", null);
    assert.deepEqual(ids(c), []);
  });
  test("al confirmar deja de estar «Guardando», conserva el valor sin recargar y avisa que quedó inactiva con cambios", async () => {
    const llamadas: boolean[] = [];
    const c = new ColaSeleccion({ alQuedarInactiva: (h) => llamadas.push(h) }), f = servidorFalso();
    marcar(c, 2, f, "m2");
    await f.resolver("m2");
    assert.equal(estadoFila(c.instantanea(), "vuelo", 2).guardando, false);
    assert.deepEqual(ids(c), [1, 2]);
    assert.deepEqual(llamadas, [true]);
  });
});

describe("fallo y reversión", () => {
  test("si falla, la fila vuelve al valor del servidor y muestra el error; «Generar» queda bloqueado hasta descartarlo", async () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    marcar(c, 2, f, "m2");
    await f.resolver("m2", { ok: false, error: "El destino no está permitido" });
    assert.deepEqual(ids(c), [1]);
    assert.equal(estadoFila(c.instantanea(), "vuelo", 2).error, "El destino no está permitido");
    assert.match(bloqueoGenerar(c.instantanea()) ?? "", /no se guardaron/);
    c.descartarError("vuelo", 2);
    assert.equal(bloqueoGenerar(c.instantanea()), null);
  });
  test("si falla tras un guardado exitoso previo, vuelve al ÚLTIMO valor confirmado (no al del servidor)", async () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    marcar(c, 2, f, "m2");
    await f.resolver("m2");
    marcar(c, 2, f, "d2", null);
    assert.deepEqual(ids(c), [1]);
    await f.resolver("d2", { ok: false, error: "boom" });
    assert.deepEqual(ids(c), [1, 2]); // sigue marcado: es lo último que el servidor confirmó
  });
  test("una acción que lanza una excepción se trata como fallo", async () => {
    const c = new ColaSeleccion();
    c.solicitar({ tipo: "vuelo", items: [{ id: 2, valor: {} }], ejecutar: async () => { throw new Error("red"); } });
    await new Promise((x) => setImmediate(x));
    assert.deepEqual(ids(c), [1]);
    assert.ok(estadoFila(c.instantanea(), "vuelo", 2).error);
  });
  test("reintentar una fila con error limpia ese error", async () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    marcar(c, 2, f, "m2");
    await f.resolver("m2", { ok: false, error: "x" });
    marcar(c, 2, f, "m2b");
    assert.equal(estadoFila(c.instantanea(), "vuelo", 2).error, null);
    assert.equal(c.instantanea().fallidos, 0);
  });
});

describe("clics rápidos: una respuesta antigua no revierte un clic más reciente", () => {
  test("marcar → desmarcar → marcar con el primero aún en vuelo: se envían EN ORDEN, de a uno, y se ve siempre el último clic", async () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    marcar(c, 2, f, "a_marcar");
    marcar(c, 2, f, "b_desmarcar", null);
    marcar(c, 2, f, "c_marcar");
    assert.deepEqual(ids(c), [1, 2]);                // el último clic manda en pantalla
    assert.deepEqual(f.log, ["a_marcar"]);            // solo uno en vuelo
    await f.resolver("a_marcar");                     // llega la respuesta ANTIGUA
    assert.deepEqual(ids(c), [1, 2]);                // no revierte el clic más reciente
    assert.equal(estadoFila(c.instantanea(), "vuelo", 2).guardando, true);
    assert.deepEqual(f.log, ["a_marcar", "c_marcar"]); // el desmarcar intermedio (aún sin salir) fue reemplazado por el último
    await f.resolver("c_marcar");
    assert.equal(estadoFila(c.instantanea(), "vuelo", 2).guardando, false);
    assert.deepEqual(ids(c), [1, 2]);
    assert.equal(f.maxEnVuelo, 1);
  });
  test("el fallo de un clic viejo NO toca la fila si ya hay un clic más nuevo", async () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    marcar(c, 2, f, "viejo");
    marcar(c, 2, f, "nuevo", null);
    await f.resolver("viejo", { ok: false, error: "falla vieja" });
    assert.deepEqual(ids(c), [1]);                    // se ve lo último clicado
    assert.equal(estadoFila(c.instantanea(), "vuelo", 2).error, null);
    await f.resolver("nuevo");
    assert.deepEqual(ids(c), [1]);
    assert.equal(c.instantanea().fallidos, 0);
  });
  test("filas distintas del mismo tipo también se envían en orden (nunca dos a la vez)", async () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    marcar(c, 2, f, "f2"); marcar(c, 3, f, "f3"); marcar(c, 4, f, "f4");
    assert.deepEqual(ids(c), [1, 2, 3, 4]);
    for (const n of ["f2", "f3", "f4"]) await f.resolver(n);
    assert.deepEqual(f.log, ["f2", "f3", "f4"]);
    assert.equal(f.maxEnVuelo, 1);
    assert.equal(c.instantanea().pendientes, 0);
  });
  test("tipos distintos no se bloquean entre sí", () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    marcar(c, 2, f, "vuelo");
    c.solicitar({ tipo: "hotel", items: [{ id: 9, valor: {} }], ejecutar: f.accion("hotel") });
    assert.deepEqual(f.log, ["vuelo", "hotel"]);
  });
});

describe("selección masiva", () => {
  test("«todos» marca todas las filas al instante, cada una «Guardando», y una sola llamada al servidor", async () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    c.solicitar({ tipo: "vuelo", esLote: true, items: [2, 3, 4, 5].map((id) => ({ id, valor: {} })), ejecutar: f.accion("lote") });
    assert.deepEqual(ids(c), [1, 2, 3, 4, 5]);
    assert.equal(c.instantanea().pendientes, 4);
    assert.deepEqual(f.log, ["lote"]);
    await f.resolver("lote");
    assert.equal(c.instantanea().pendientes, 0);
    assert.deepEqual(ids(c), [1, 2, 3, 4, 5]);
  });
  test("si el lote falla, TODAS las filas vuelven a su valor real y el error queda visible a nivel de lista", async () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    c.solicitar({ tipo: "vuelo", esLote: true, items: [2, 3].map((id) => ({ id, valor: {} })), ejecutar: f.accion("lote") });
    await f.resolver("lote", { ok: false, error: "Sin permiso" });
    assert.deepEqual(ids(c), [1]);
    assert.equal(c.instantanea().erroresLote.get("vuelo"), "Sin permiso");
    assert.equal(c.instantanea().errores.size, 0, "el error del lote se explica UNA vez, no en cada fila");
    assert.ok(bloqueoGenerar(c.instantanea()));
    c.descartarErrorLote("vuelo");                    // un solo descarte libera «Generar tarifario»
    assert.equal(bloqueoGenerar(c.instantanea()), null);
  });
  test("un lote con omitidos: solo esas filas se revierten, con su motivo", async () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    c.solicitar({ tipo: "vuelo", esLote: true, items: [2, 3, 4].map((id) => ({ id, valor: {} })), ejecutar: f.accion("lote") });
    await f.resolver("lote", { ok: true, omitidos: [{ id: 3, motivo: "Sin tarifa vigente" }] });
    assert.deepEqual(ids(c), [1, 2, 4]);
    assert.equal(estadoFila(c.instantanea(), "vuelo", 3).error, "Sin tarifa vigente");
  });
  test("un clic individual durante un lote en vuelo espera su turno y gana en pantalla", async () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    c.solicitar({ tipo: "vuelo", esLote: true, items: [2, 3].map((id) => ({ id, valor: {} })), ejecutar: f.accion("lote") });
    marcar(c, 2, f, "quitar2", null);
    assert.deepEqual(ids(c), [1, 3]);
    await f.resolver("lote");
    assert.deepEqual(ids(c), [1, 3]);                // la respuesta del lote no devuelve el 2
    await f.resolver("quitar2");
    assert.deepEqual(ids(c), [1, 3]);
    assert.deepEqual(f.log, ["lote", "quitar2"]);
  });
});

describe("reconciliación con los datos nuevos del servidor", () => {
  test("lo confirmado ANTES de iniciar el refresco se descarta al terminar (manda el servidor); lo posterior se conserva", async () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    marcar(c, 2, f, "m2");
    await f.resolver("m2");                          // confirmado
    const reqRefresco = c.req;                       // arranca un refresco
    marcar(c, 3, f, "m3");                           // clic posterior, aún guardando
    await f.resolver("m3");                          // confirmado DESPUÉS de iniciado el refresco
    c.reconciliar(reqRefresco);                      // el refresco (anterior al 3) termina con datos que no incluyen el 3
    assert.deepEqual(ids(c, [{ bloqueo_id: 1, aplica_mk: true, ta: 0 }, { bloqueo_id: 2, aplica_mk: true, ta: 0 }]), [1, 2, 3]);
    assert.equal(c.instantanea().entradas.has("vuelo:2"), false);
    assert.equal(c.instantanea().entradas.has("vuelo:3"), true);
  });
  test("un guardado en curso nunca se descarta por un refresco anterior", () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    marcar(c, 2, f, "m2");
    c.reconciliar(c.req + 100);
    assert.equal(c.instantanea().entradas.has("vuelo:2"), true);
  });
  test("la configuración de la fila (TA, mk) se superpone a la del servidor sin perder el resto de sus campos", () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    marcar(c, 1, f, "mk", { aplica_mk: false, ta: 5000 });
    const m = efectivos(c.instantanea(), "vuelo", servidor, "bloqueo_id", defecto);
    assert.deepEqual(m.get(1), { bloqueo_id: 1, aplica_mk: false, ta: 5000 });
  });
});

describe("bloqueo de «Generar tarifario»", () => {
  test("bloquea mientras haya guardados pendientes y se libera al terminar", async () => {
    const c = new ColaSeleccion(), f = servidorFalso();
    assert.equal(bloqueoGenerar(c.instantanea()), null);
    marcar(c, 2, f, "m2");
    assert.match(bloqueoGenerar(c.instantanea()) ?? "", /Guardando 1 cambio/);
    await f.resolver("m2");
    assert.equal(bloqueoGenerar(c.instantanea()), null);
  });
});
