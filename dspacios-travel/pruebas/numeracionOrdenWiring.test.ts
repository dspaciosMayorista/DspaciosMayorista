import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Wiring de ORDEN (revisión posterior al PR #274, ítem 4 "CONSUMO PREMATURO
// DE CONSECUTIVOS"): en cada uno de los 5 caminos que generan numero_contrato,
// la llamada a siguienteNumeroContrato() debe quedar DESPUÉS de toda
// validación que pueda fallar y sea barata de detectar antes — para no gastar
// un consecutivo DTM/MIN por un formulario inválido. No promete ausencia
// absoluta de huecos (un fallo DESPUÉS de nextval() sigue siendo posible y es
// comportamiento normal de una secuencia Postgres — ver
// test_concurrencia_dtm_mayorista.sh) — solo que la generación no sea lo
// PRIMERO que hace la función.
//
// Estas pruebas son de TEXTO (leen el archivo fuente y comparan posiciones de
// índice), el mismo patrón que ya usa este repo para wiring
// (pruebas/editorVuelosContrato.test.ts, pruebas/cotizacionesTenant.wiring.test.ts)
// — no ejecutan el código, así que un refactor que reordene sin cambiar estos
// marcadores de texto podría no detectarse; se mantienen marcadores
// suficientemente específicos y únicos por archivo para reducir ese riesgo.

function leer(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

// Extrae el cuerpo de una función top-level (declarada como
// `export (async )?function NOMBRE(` ... balanceando llaves) para poder
// verificar el orden de marcadores DENTRO de esa función únicamente — el
// archivo tiene varias funciones y un marcador de una no debe "prestarle"
// orden a otra.
function cuerpoDeFuncion(src: string, nombre: string): string {
  // `reservarDesdeTarifarioInterno` deliberadamente NO se exporta (ver su
  // propio comentario en reservar/actions.ts) — el patrón acepta con o sin
  // `export` para cubrir ambos casos sin dos helpers.
  const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${nombre}\\s*\\(`);
  const m = re.exec(src);
  assert.ok(m, `no se encontró la función ${nombre}`);

  // 1) Encuentra el `)` que cierra la lista de parámetros balanceando
  //    paréntesis (los tipos de los parámetros pueden traer objetos `{...}`
  //    embebidos — ej. `opts: { agrupar: ... }` — pero eso no afecta el
  //    balance de PARÉNTESIS, solo de llaves, así que este paso es seguro).
  let i = src.indexOf("(", m!.index);
  let profParen = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") profParen++;
    else if (src[i] === ")") {
      profParen--;
      if (profParen === 0) { i++; break; }
    }
  }
  assert.ok(profParen === 0, `no se pudo balancear los paréntesis de ${nombre}`);

  // 2) Desde ahí viene el tipo de retorno (ej. `: Promise<{ ok: true } | {
  //    ok: false; error: string }>`), que puede traer sus PROPIAS llaves de
  //    tipo literal anidadas dentro de `<...>` — se ignoran mientras la
  //    profundidad de `<>` sea > 0. La `{` real del cuerpo de la función es
  //    la primera que aparece con profundidad de `<>` en 0.
  let profAngulo = 0;
  for (; i < src.length; i++) {
    if (src[i] === "<") profAngulo++;
    else if (src[i] === ">") profAngulo--;
    else if (src[i] === "{" && profAngulo === 0) break;
  }
  assert.ok(src[i] === "{", `no se encontró la '{' del cuerpo de ${nombre}`);

  // 3) Balancea llaves desde ahí para obtener el cuerpo completo.
  let depth = 0;
  const inicio = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(inicio, i + 1);
    }
  }
  throw new Error(`no se pudo balancear las llaves de ${nombre}`);
}

// Todas las posiciones (una por marcador) deben aparecer, en ese orden, antes
// del índice de `siguienteNumeroContrato(`.
function assertOrdenAntesDeGenerar(cuerpo: string, marcadores: string[], etiqueta: string) {
  const idxGen = cuerpo.indexOf("siguienteNumeroContrato(");
  assert.ok(idxGen > -1, `${etiqueta}: no se encontró la llamada a siguienteNumeroContrato`);
  let ultimo = -1;
  for (const marcador of marcadores) {
    const idx = cuerpo.indexOf(marcador);
    assert.ok(idx > -1, `${etiqueta}: no se encontró el marcador "${marcador}"`);
    assert.ok(idx > ultimo, `${etiqueta}: el marcador "${marcador}" está fuera de orden`);
    assert.ok(idx < idxGen, `${etiqueta}: el marcador "${marcador}" aparece DESPUÉS de generar el número (consumo prematuro)`);
    ultimo = idx;
  }
}

describe("crearContrato (contratos/actions.ts) — genera el número después de validar", () => {
  const cuerpo = cuerpoDeFuncion(leer("app/(dashboard)/dashboard/contratos/actions.ts"), "crearContrato");

  test("orden: contexto fail-closed → tarifas del negociado → ítems → BNC → margen → aliado → NÚMERO", () => {
    assertOrdenAntesDeGenerar(cuerpo, [
      "contextoCrearContrato()",
      "El paquete negociado no tiene tarifas configuradas",
      "Cantidades o tarifas inválidas en los ítems",
      "La BNC fija no puede ser menor",
      "La BNC no puede ser mayor",
      "margenInsuficiente: true",
      "del catálogo.",
    ], "crearContrato");
  });
});

describe("reservarDesdeTarifarioInterno (reservar/actions.ts) — genera después de computar y validar cupos", () => {
  const cuerpo = cuerpoDeFuncion(leer("app/(dashboard)/dashboard/reservar/actions.ts"), "reservarDesdeTarifarioInterno");
  test("orden: computarReserva → resolver/validar origen del vuelo → cupos → NÚMERO", () => {
    assertOrdenAntesDeGenerar(cuerpo, [
      "if (!comp.ok) return",
      "No se pudo resolver el origen del vuelo",
      "No hay cupos suficientes en este vuelo",
    ], "reservarDesdeTarifarioInterno");
  });
});

describe("reservarPrograma (reservar/actions.ts) — genera después de validar programa/vigencia/precios/edades", () => {
  const cuerpo = cuerpoDeFuncion(leer("app/(dashboard)/dashboard/reservar/actions.ts"), "reservarPrograma");
  test("orden: sesión → programa → vigencia/blackouts → precios → habitaciones → edades → NÚMERO", () => {
    assertOrdenAntesDeGenerar(cuerpo, [
      "contextoCrearContrato()",
      "Programa no encontrado.",
      "La fecha de salida es anterior a la vigencia",
      "Indica cuántas habitaciones reservas",
      "Debe haber al menos un pasajero.",
    ], "reservarPrograma");
  });
});

describe("manual-actions.ts: convertirCotizacionManualAContrato — genera después de validar el titular", () => {
  const cuerpo = cuerpoDeFuncion(leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts"), "convertirCotizacionManualAContrato");
  test("orden: tenant autorizado → datos del titular completos → NÚMERO", () => {
    assertOrdenAntesDeGenerar(cuerpo, [
      "autorizaTenant(ctx, cot.tenant)",
      "Completa los datos del titular antes de generar el contrato",
    ], "convertirCotizacionManualAContrato");
  });
});

describe("convertirCotizacionCarrito (reservar/actions.ts) — cada número se genera después de validar TODO el carrito", () => {
  const cuerpo = cuerpoDeFuncion(leer("app/(dashboard)/dashboard/reservar/actions.ts"), "convertirCotizacionCarrito");
  test("orden: tenant autorizado → ítems/pasajeros → validación de precio y cupos (Paso 1) → NÚMERO (Paso 2, por grupo)", () => {
    assertOrdenAntesDeGenerar(cuerpo, [
      "autorizaTenant(ctx, cot.tenant)",
      "La cotización no tiene ítems.",
      "Captura los pasajeros antes de generar el contrato.",
      "no hay cupos suficientes",
    ], "convertirCotizacionCarrito");
  });
});

// ── Los 5 caminos usan el helper CENTRAL, ninguno vuelve a anteponer prefijo ─
describe("los 5 caminos usan siguienteNumeroContrato() y no re-aplican prefijo", () => {
  const reservar = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const contratos = leer("app/(dashboard)/dashboard/contratos/actions.ts");
  const manual = leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");

  test("reservar/actions.ts tiene exactamente 3 llamadas a siguienteNumeroContrato", () => {
    const n = [...reservar.matchAll(/siguienteNumeroContrato\(/g)].length;
    assert.equal(n, 3);
  });

  test("contratos/actions.ts y manual-actions.ts tienen 1 cada uno", () => {
    assert.equal([...contratos.matchAll(/siguienteNumeroContrato\(/g)].length, 1);
    assert.equal([...manual.matchAll(/siguienteNumeroContrato\(/g)].length, 1);
  });

  test("ningún camino vuelve a usar numeroConTenant() (eso quedó solo para el importador histórico)", () => {
    for (const src of [reservar, contratos, manual]) {
      assert.doesNotMatch(src, /numeroConTenant\(/);
    }
  });

  test("crearContrato ya no usa getTenant() a secas para resolver el tenant del contrato", () => {
    assert.doesNotMatch(contratos, /getTenant\(\)/);
  });
});
