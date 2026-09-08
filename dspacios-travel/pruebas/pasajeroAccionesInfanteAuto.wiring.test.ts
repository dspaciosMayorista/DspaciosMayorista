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
    assert.match(src, /import \{ esInfantePorEdad, sillaTieneDatosDePasajero \} from "@\/lib\/vuelos\/infanteVuelo";/);
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
    const bloque = src.slice(inicio, inicio + 1600);
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

  // ── Alcance mínimo: la conversión automática a INF solo aplica en el ALTA
  // sobre una silla VACÍA — nunca al editar una silla que ya tenía un
  // pasajero (evita el duplicado reportado: corregir la fecha de un
  // pasajero existente a <2 años NO debe crear un infante nuevo dejando al
  // original ocupando la silla). ──────────────────────────────────────────
  test("sillaVacia se decide sobre `inicial` (estado ORIGINAL al abrir el modal) vía sillaTieneDatosDePasajero, nunca sobre `form` (que cambia mientras se escribe)", () => {
    assert.match(
      src,
      /import \{ esInfantePorEdad, sillaTieneDatosDePasajero \} from "@\/lib\/vuelos\/infanteVuelo";/,
      "debe reutilizar el predicado puro de lib/vuelos/infanteVuelo — nunca reimplementarlo inline"
    );
    const inicio = src.indexOf("const sillaVacia =");
    assert.ok(inicio > -1, "no define sillaVacia");
    const linea = src.slice(inicio, inicio + 100);
    assert.match(linea, /sillaTieneDatosDePasajero\(inicial\)/, "debe evaluar el predicado sobre `inicial`, nunca sobre `form`");
    assert.doesNotMatch(linea, /\bform\./, "sillaVacia NO debe depender de form (que cambia con cada tecla)");
  });

  test("bloqueadaPorSillaOcupada = esInfante && !sillaVacia (edición de silla ocupada hacia INF queda bloqueada, alta en silla vacía no)", () => {
    assert.match(src, /const bloqueadaPorSillaOcupada = esInfante && !sillaVacia;/);
  });

  test("REQUERIDO: si la silla YA estaba ocupada y la fecha corregida clasifica INF, guardar() bloquea con mensaje ANTES de llegar a cualquier llamada de guardado — no inserta el infante ni toca la silla", () => {
    const inicio = src.indexOf("function guardar()");
    const bloque = src.slice(inicio, inicio + 1500);
    const idxSiInfante = bloque.indexOf("if (esInfante)");
    const idxBloqueo = bloque.indexOf("if (bloqueadaPorSillaOcupada)", idxSiInfante);
    const idxSetErrBloqueo = bloque.indexOf("setErr(", idxBloqueo);
    const idxReturnBloqueo = bloque.indexOf("return;", idxSetErrBloqueo);
    const idxResponsableCheck = bloque.indexOf('responsableId === ""', idxReturnBloqueo);
    const idxGuardarInfanteVuelo = bloque.indexOf("guardarInfanteVuelo(", idxReturnBloqueo);
    const idxEditarPasajeroSilla = bloque.indexOf("editarPasajeroSilla(");
    assert.ok(idxSiInfante > -1 && idxBloqueo > idxSiInfante, "debe comprobar bloqueadaPorSillaOcupada dentro de la rama esInfante");
    assert.ok(idxReturnBloqueo > idxBloqueo, "debe hacer return inmediatamente tras detectar la silla ocupada");
    assert.ok(
      idxResponsableCheck > idxReturnBloqueo && idxGuardarInfanteVuelo > idxResponsableCheck,
      "el chequeo de silla ocupada debe ejecutarse ANTES de pedir/usar el responsable o llamar guardarInfanteVuelo — ninguna de las dos rutas de guardado se alcanza si la silla está ocupada"
    );
    assert.ok(idxEditarPasajeroSilla > idxGuardarInfanteVuelo, "editarPasajeroSilla tampoco debe alcanzarse desde la rama esInfante");
  });

  test("el botón Guardar queda deshabilitado cuando bloqueadaPorSillaOcupada (no solo un mensaje visual — el clic no dispara nada)", () => {
    assert.match(src, /disabled=\{pending \|\| bloqueadaPorSillaOcupada\}/);
  });

  test("el selector de adulto responsable SOLO se renderiza en el alta sobre silla vacía (esInfante && sillaVacia) — nunca al editar una silla ocupada", () => {
    const inicio = src.indexOf("{esInfante && sillaVacia && (");
    assert.ok(inicio > -1, "el selector de responsable debe estar condicionado a esInfante && sillaVacia, no solo esInfante");
  });

  test("hay un banner de bloqueo DISTINTO (nunca el mismo selector de alta) cuando la silla está ocupada", () => {
    const inicio = src.indexOf("{bloqueadaPorSillaOcupada && (");
    assert.ok(inicio > -1, "no renderiza un aviso específico para el caso bloqueado");
    const bloque = src.slice(inicio, inicio + 400);
    assert.doesNotMatch(bloque, /candidatosResponsable\.map\(/, "el banner de bloqueo no debe incluir el selector de responsable — no se puede convertir aquí, no se ofrece elegir a quién");
  });
});

describe("vuelos/[id]/page.tsx — construye candidatosResponsable desde las sillas reales de ESTE vuelo", () => {
  const src = leer(RUTA_BLOQUEO);

  test("candidatosResponsable exige documento propio, fecha de nacimiento válida y excluye sillas en 'cambio' (mismo criterio que el trigger directo Infante)", () => {
    const inicio = src.indexOf("const candidatosResponsable");
    assert.ok(inicio > -1);
    const bloque = src.slice(inicio, inicio + 500);
    assert.match(bloque, /s\.estado !== "cambio" && s\.tipo_doc && s\.numero_doc && s\.nacimiento/);
  });

  test("REQUERIDO: candidatosResponsable excluye MENORES DE EDAD — calcula edad real (calcularEdad) contra fecha_ida y exige >= 18, nunca solo 'tiene documento'", () => {
    const inicio = src.indexOf("const candidatosResponsable");
    const bloque = src.slice(inicio, inicio + 700);
    assert.match(bloque, /calcularEdad\(s\.nacimiento, b\.fecha_ida\)/);
    assert.match(bloque, /edad != null && edad >= 18/, "debe exigir mayoría de edad real (>=18), no solo tener documento");
  });

  test("importa calcularEdad de lib/utils (nunca reimplementa el cálculo de edad)", () => {
    assert.match(src, /import \{ formatCOP, formatFechaLarga, calcularEdad \} from "@\/lib\/utils";/);
  });

  test("PasajeroAcciones recibe fechaIdaBloqueo y candidatosResponsable EXCLUYENDO la propia silla de la fila", () => {
    const inicio = src.indexOf("<PasajeroAcciones");
    assert.ok(inicio > -1);
    const bloque = src.slice(inicio, inicio + 500);
    assert.match(bloque, /fechaIdaBloqueo=\{b\.fecha_ida\}/);
    assert.match(bloque, /candidatosResponsable=\{candidatosResponsable\.filter\(\(c\) => c\.sillaId !== s\.id\)\}/);
  });
});
