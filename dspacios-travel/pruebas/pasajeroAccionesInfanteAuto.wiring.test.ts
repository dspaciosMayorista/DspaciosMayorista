// PasajeroAcciones.tsx — alta manual existente: al escribir una fecha de
// nacimiento que da menos de 2 años en la fecha REAL del vuelo, el
// formulario debe cambiar automáticamente a modo infante (no ocupar la
// silla vacía, pedir un adulto responsable entre los pasajeros del vuelo) en
// vez de escribir esos datos en la silla que se está editando. El servidor
// (guardar_infante_vuelo, migración 168) sigue siendo la única autoridad —
// este formulario solo adelanta el cambio de flujo.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function leer(ruta: string): string {
  return readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
}

const RUTA_COMPONENTE = "app/(dashboard)/dashboard/vuelos/[id]/PasajeroAcciones.tsx";
const RUTA_BLOQUEO = "app/(dashboard)/dashboard/vuelos/[id]/page.tsx";

describe("PasajeroAcciones.tsx — detección en vivo de infante en el alta manual", () => {
  const src = leer(RUTA_COMPONENTE);

  test("reutiliza esInfantePorEdad de lib/vuelos/infanteVuelo — nunca reimplementa el umbral", () => {
    assert.match(src, /import \{ esInfantePorEdad \} from "@\/lib\/vuelos\/infanteVuelo";/);
  });

  test("recibe fechaIdaBloqueo y candidatosResponsable como props", () => {
    assert.match(src, /fechaIdaBloqueo:\s*string \| null;/);
    assert.match(src, /candidatosResponsable:\s*CandidatoResponsable\[\];/);
  });

  test("calcula esInfante contra fechaIdaBloqueo (la fecha REAL del vuelo, nunca una fecha fija ni la del contrato)", () => {
    const inicio = src.indexOf("const esInfante = useMemo");
    assert.ok(inicio > -1, "no calcula esInfante");
    const bloque = src.slice(inicio, inicio + 300);
    assert.match(bloque, /esInfantePorEdad\(form\.nacimiento, fechaIdaBloqueo\)/);
  });

  test("en modo infante NO llama a editarPasajeroSilla — nunca ocupa la silla que se está editando", () => {
    const inicio = src.indexOf("function guardar()");
    assert.ok(inicio > -1);
    const bloque = src.slice(inicio, inicio + 1200);
    const idxSiInfante = bloque.indexOf("if (esInfante)");
    const idxReturn = bloque.indexOf("return;", idxSiInfante);
    const idxEditar = bloque.indexOf("editarPasajeroSilla(");
    assert.ok(idxSiInfante > -1 && idxReturn > idxSiInfante, "no hace return temprano dentro de la rama esInfante");
    assert.ok(idxEditar > idxReturn, "editarPasajeroSilla debe quedar DESPUÉS del return de la rama esInfante — nunca se llama en modo infante");
  });

  test("en modo infante exige elegir un responsable antes de guardar (no manda responsableId vacío al server)", () => {
    const inicio = src.indexOf("if (esInfante)");
    const bloque = src.slice(inicio, inicio + 300);
    assert.match(bloque, /if \(responsableId === ""\)/, "debe bloquear el guardado si no se eligió responsable");
  });

  test("en modo infante llama a guardarInfanteVuelo con (bloqueoId, sillaResponsableId elegida, null, datos) — nunca un p_infante_id inventado para alta nueva", () => {
    const inicio = src.indexOf("await guardarInfanteVuelo(");
    assert.ok(inicio > -1);
    const linea = src.slice(inicio, inicio + 200);
    assert.match(linea, /guardarInfanteVuelo\(bloqueoId, Number\(responsableId\), null, \{/);
  });

  test("el selector de responsable se llena desde candidatosResponsable (nunca una lista hardcodeada ni resuelta por nombre)", () => {
    const inicio = src.indexOf("candidatosResponsable.map(");
    assert.ok(inicio > -1, "no renderiza el <select> desde candidatosResponsable");
  });

  test("los campos asesor/hotel/acomodación/plazo (irrelevantes para un infante) se ocultan cuando esInfante es true", () => {
    const inicio = src.indexOf("{!esInfante && (");
    assert.ok(inicio > -1, "no oculta los campos de silla cuando el pasajero es infante");
  });
});

describe("vuelos/[id]/page.tsx — construye candidatosResponsable desde las sillas reales de ESTE vuelo", () => {
  const src = leer(RUTA_BLOQUEO);

  test("candidatosResponsable exige documento propio y excluye sillas en 'cambio' (mismo criterio que el trigger directo Infante)", () => {
    const inicio = src.indexOf("const candidatosResponsable");
    assert.ok(inicio > -1);
    const bloque = src.slice(inicio, inicio + 400);
    assert.match(bloque, /s\.estado !== "cambio" && s\.tipo_doc && s\.numero_doc/);
  });

  test("PasajeroAcciones recibe fechaIdaBloqueo y candidatosResponsable EXCLUYENDO la propia silla de la fila", () => {
    const inicio = src.indexOf("<PasajeroAcciones");
    assert.ok(inicio > -1);
    const bloque = src.slice(inicio, inicio + 500);
    assert.match(bloque, /fechaIdaBloqueo=\{b\.fecha_ida\}/);
    assert.match(bloque, /candidatosResponsable=\{candidatosResponsable\.filter\(\(c\) => c\.sillaId !== s\.id\)\}/);
  });
});
