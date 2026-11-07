// #94 — identidad estable de los cupos durante la edición del carrito: insertar, eliminar y cambiar de acomodación no trasladan servicios en silencio.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reconciliarCupos, coberturasInvalidas, type EstadoCupos } from "../lib/cotizacion/cuposEstables.ts";

const vuelo = (cubre: string[] | "todos") => ({ id: "vuelo", cubre });

describe("inserción", () => {
  test("agregar una habitación crea cupos con ordinales NUEVOS y no toca los existentes", () => {
    const a = reconciliarCupos(null, { doble: 2 });
    assert.deepEqual(a.ids, ["doble#1", "doble#2"]);
    const b = reconciliarCupos(a.estado, { doble: 4 });
    assert.deepEqual(b.ids, ["doble#1", "doble#2", "doble#3", "doble#4"]);
    assert.deepEqual(b.nuevos, ["doble#3", "doble#4"]);
  });
  test("un servicio de selección NO cubre al cupo agregado; uno de cobertura total sí (es lo que significa «todos»)", () => {
    const b = reconciliarCupos(reconciliarCupos(null, { doble: 2 }).estado, { doble: 4 });
    const seleccion = vuelo(["doble#1", "doble#2"]);
    assert.deepEqual(coberturasInvalidas([seleccion], b.ids), []);
    assert.deepEqual(seleccion.cubre, ["doble#1", "doble#2"]); // sin cambios
  });
  test("agregar una clave nueva no corre las demás", () => {
    const a = reconciliarCupos(null, { doble: 2 });
    const b = reconciliarCupos(a.estado, { doble: 2, sencilla: 1 });
    assert.deepEqual(b.ids.sort(), ["doble#1", "doble#2", "sencilla#1"]);
  });
});

describe("eliminación", () => {
  const base = reconciliarCupos(reconciliarCupos(null, { doble: 2 }).estado, { doble: 4 });
  test("quitar una habitación retira los cupos de ordinal más alto; los demás conservan su identidad", () => {
    const c = reconciliarCupos(base.estado, { doble: 2 });
    assert.deepEqual(c.ids, ["doble#1", "doble#2"]);
    assert.deepEqual(c.retirados.sort(), ["doble#3", "doble#4"]);
  });
  test("el servicio que cubría un cupo retirado queda inválido: se exige volver a seleccionar, no se reasigna", () => {
    const c = reconciliarCupos(base.estado, { doble: 2 });
    const malos = coberturasInvalidas([vuelo(["doble#2", "doble#4"])], c.ids);
    assert.equal(malos.length, 1);
    assert.deepEqual(malos[0].faltantes, ["doble#4"]);
  });
  test("volver a agregar la habitación crea ids NUEVOS: el servicio que cubría el cupo retirado NO recupera la cobertura", () => {
    const sin = reconciliarCupos(base.estado, { doble: 2 });
    const otra = reconciliarCupos(sin.estado, { doble: 4 });
    assert.deepEqual(otra.nuevos, ["doble#5", "doble#6"]);
    assert.equal(coberturasInvalidas([vuelo(["doble#4"])], otra.ids).length, 1);
  });
  test("quitar todo y volver a cero no reutiliza ordinales", () => {
    const cero = reconciliarCupos(base.estado, { doble: 0 });
    assert.deepEqual(cero.ids, []);
    assert.deepEqual(reconciliarCupos(cero.estado, { doble: 1 }).ids, ["doble#5"]);
  });
});

describe("cambio de acomodación", () => {
  test("doble → triple: los cupos de la doble se retiran y los de la triple son nuevos; ningún servicio se traslada", () => {
    const a = reconciliarCupos(null, { doble: 2 });
    const b = reconciliarCupos(a.estado, { doble: 0, triple: 3 });
    assert.deepEqual(b.retirados.sort(), ["doble#1", "doble#2"]);
    assert.deepEqual(b.ids, ["triple#1", "triple#2", "triple#3"]);
    const malos = coberturasInvalidas([vuelo(["doble#1", "doble#2"]), vuelo("todos")], b.ids);
    assert.equal(malos.length, 1, "solo el de selección queda por revisar");
  });
  test("triple → doble en la misma habitación (3 → 2 personas): se retira el cupo de ordinal más alto", () => {
    const a = reconciliarCupos(null, { triple: 3 });
    const b = reconciliarCupos(a.estado, { triple: 2 });
    assert.deepEqual(b.retirados, ["triple#3"]);
  });
});

describe("menores y pureza", () => {
  test("cambiar la edad de un menor (mismo conteo) no cambia su identidad", () => {
    const a = reconciliarCupos(null, { doble: 2, menor: 1 });
    const b = reconciliarCupos(a.estado, { doble: 2, menor: 1 });
    assert.deepEqual(b.ids, a.ids);
    assert.deepEqual(b.nuevos, []);
  });
  test("el orden de las claves de entrada no cambia el resultado y el estado previo no se muta", () => {
    const a = reconciliarCupos(null, { doble: 2, sencilla: 1 });
    const copia: EstadoCupos = JSON.parse(JSON.stringify(a.estado));
    const x = reconciliarCupos(a.estado, { sencilla: 2, doble: 2 });
    const y = reconciliarCupos(a.estado, { doble: 2, sencilla: 2 });
    assert.deepEqual(x.ids, y.ids);
    assert.deepEqual(a.estado, copia);
  });
  test("conteos inválidos (negativos, NaN) se tratan como cero", () => {
    assert.deepEqual(reconciliarCupos(null, { doble: -3, triple: Number.NaN }).ids, []);
  });
});
