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
  // La Server Action exportada `crearContrato` es, desde la ronda de
  // observabilidad, un wrapper delgado (genera flujo_id, mide el total en
  // `finally`) que delega TODA la lógica real —incluida la generación del
  // número— en `crearContratoInterno`. El orden de validación que importa
  // aquí (evitar consumo prematuro de consecutivos) vive en esa función.
  const cuerpo = cuerpoDeFuncion(leer("app/(dashboard)/dashboard/contratos/actions.ts"), "crearContratoInterno");

  test("orden: contexto fail-closed → tarifas del negociado → ítems → BNC → margen → aliado → NÚMERO", () => {
    assertOrdenAntesDeGenerar(cuerpo, [
      "contextoCrearContrato(",
      "El paquete negociado no tiene tarifas configuradas",
      "Cantidades o tarifas inválidas en los ítems",
      "La BNC fija no puede ser menor",
      "La BNC no puede ser mayor",
      "margenInsuficiente: true",
      "del catálogo.",
    ], "crearContratoInterno");
  });

  test("crearContrato (wrapper exportado) delega en crearContratoInterno — no reimplementa la lógica de validación/generación por separado", () => {
    const cuerpoWrapper = cuerpoDeFuncion(leer("app/(dashboard)/dashboard/contratos/actions.ts"), "crearContrato");
    assert.match(cuerpoWrapper, /crearContratoInterno\(/);
    assert.doesNotMatch(cuerpoWrapper, /siguienteNumeroContrato\(/);
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
  // Mismo patrón que crearContrato: la Server Action exportada es un
  // wrapper delgado (flujo_id + medición total) que delega en
  // `reservarProgramaInterno`, donde vive el orden real de validación.
  const cuerpo = cuerpoDeFuncion(leer("app/(dashboard)/dashboard/reservar/actions.ts"), "reservarProgramaInterno");
  test("orden: sesión → programa → vigencia/blackouts → precios → habitaciones → edades → NÚMERO", () => {
    assertOrdenAntesDeGenerar(cuerpo, [
      "contextoCrearContrato(",
      "Programa no encontrado.",
      "La fecha de salida es anterior a la vigencia",
      "Indica cuántas habitaciones reservas",
      "Debe haber al menos un pasajero.",
    ], "reservarProgramaInterno");
  });

  test("reservarPrograma (wrapper exportado) delega en reservarProgramaInterno — no reimplementa la lógica de validación/generación por separado", () => {
    const cuerpoWrapper = cuerpoDeFuncion(leer("app/(dashboard)/dashboard/reservar/actions.ts"), "reservarPrograma");
    assert.match(cuerpoWrapper, /reservarProgramaInterno\(/);
    assert.doesNotMatch(cuerpoWrapper, /siguienteNumeroContrato\(/);
  });
});

// Extrae el cuerpo de una función SQL `language plpgsql` definida como
// `create or replace function public.NOMBRE(...) ... as $$ ... $$;` — el
// delimitador de dólar ($$) es el que usa PostgreSQL mismo para el cuerpo
// de la función, así que es un límite estructural estable, no un número de
// caracteres arbitrario. Ancla en la sentencia DDL completa
// (`create or replace function public.<nombre>(`) para no confundirse con
// una mención del nombre en un comentario o en otra función.
//
// Asume que la función no contiene un segundo par de `$$` anidado (SQL
// dinámico tipo `execute format($$...$$)`) — cierto hoy para
// `convertir_cotizacion_a_contrato`; si eso cambiara, revisar este extractor.
function cuerpoDeFuncionSql(src: string, nombre: string): string {
  const marcaDDL = `create or replace function public.${nombre}(`;
  const inicioDDL = src.indexOf(marcaDDL);
  assert.ok(inicioDDL > -1, `no se encontró "${marcaDDL}" en la migración`);
  const abre = src.indexOf("$$", inicioDDL);
  assert.ok(abre > -1, `no se encontró el delimitador $$ de apertura de ${nombre}`);
  const cierra = src.indexOf("$$", abre + 2);
  assert.ok(cierra > -1, `no se encontró el delimitador $$ de cierre de ${nombre}`);
  return src.slice(abre, cierra + 2);
}

// Variante SQL de assertOrdenAntesDeGenerar: todos los marcadores deben
// aparecer, en ese orden, antes de la llamada a
// `siguiente_numero_contrato_para_tenant(` (el equivalente en SQL de
// `siguienteNumeroContrato(` para el camino de conversión manual, que desde
// el Commit 5 vive DENTRO del RPC atómico, no en TypeScript).
function assertOrdenSqlAntesDeGenerar(cuerpo: string, marcadores: string[], etiqueta: string) {
  const idxGen = cuerpo.indexOf("siguiente_numero_contrato_para_tenant(");
  assert.ok(idxGen > -1, `${etiqueta}: no se encontró la llamada a siguiente_numero_contrato_para_tenant`);
  let ultimo = -1;
  for (const marcador of marcadores) {
    const idx = cuerpo.indexOf(marcador);
    assert.ok(idx > -1, `${etiqueta}: no se encontró el marcador "${marcador}"`);
    assert.ok(idx > ultimo, `${etiqueta}: el marcador "${marcador}" está fuera de orden`);
    assert.ok(idx < idxGen, `${etiqueta}: el marcador "${marcador}" aparece DESPUÉS de generar el número (consumo prematuro)`);
    ultimo = idx;
  }
}

describe("manual-actions.ts: convertirCotizacionManualAContrato — genera después de validar el titular", () => {
  // Desde el Commit 5 la conversión manual es ATÓMICA: la Server Action TS
  // ya no llama a `siguienteNumeroContrato()` (delega todo, incluida la
  // numeración, al RPC `convertir_cotizacion_a_contrato` de la migración
  // 164) — el orden que antes vivía en TypeScript ahora vive DENTRO de ese
  // RPC de SQL, y es ahí donde hay que auditarlo.
  const cuerpo = cuerpoDeFuncionSql(
    leer("supabase/migrations/20260601000164_condiciones_pago_componente.sql"),
    "convertir_cotizacion_a_contrato"
  );

  test("orden: autorización del actor → tenant → replay (ventas.cotizacion_id, sin consumir número) → tipo → estado → congelado → titular → mínimo → NÚMERO", () => {
    assertOrdenSqlAntesDeGenerar(cuerpo, [
      "v_rol := public._autorizado_pago_previo(p_usuario_id);",
      "if v_rol <> 'superadmin' and v_actor_tenant is distinct from v_tenant then",
      // Idempotencia: un replay se resuelve leyendo `ventas.cotizacion_id`
      // y devolviendo la venta ya creada — SIN llegar nunca a la llamada de
      // numeración (si esto se rompiera, un replay consumiría un
      // consecutivo nuevo cada vez, exactamente el bug que este archivo
      // vigila para los otros 4 caminos).
      "from public.ventas where cotizacion_id = p_cotizacion_id;",
      "return v_existente;",
      "perform public._tipo_cotizacion_convertible(v_tipo);",
      "if v_estado <> 'abierta' then",
      "no está congelada",
      "Completa los datos del titular antes de generar el contrato",
      "no alcanza el mínimo exigido",
    ], "convertir_cotizacion_a_contrato");
  });

  test("la numeración usa la MISMA función real (siguiente_numero_contrato_para_tenant) exactamente una vez, sin re-anteponer DTM/MIN a mano", () => {
    const llamadas = [...cuerpo.matchAll(/siguiente_numero_contrato_para_tenant\(/g)];
    assert.equal(llamadas.length, 1, "convertir_cotizacion_a_contrato debe llamar a siguiente_numero_contrato_para_tenant EXACTAMENTE una vez");
    assert.doesNotMatch(cuerpo, /'DTM-'\s*\|\|/, "no debe re-anteponer 'DTM-' al número — ya lo hace la función de numeración");
    assert.doesNotMatch(cuerpo, /'MIN-'\s*\|\|/, "no debe re-anteponer 'MIN-' al número — ya lo hace la función de numeración");
  });
});

describe("convertirCotizacionCarrito (reservar/actions.ts) — cada número se genera después de validar TODO el carrito", () => {
  const cuerpo = cuerpoDeFuncion(leer("app/(dashboard)/dashboard/reservar/actions.ts"), "convertirCotizacionCarrito");
  test("orden: tenant autorizado → ítems/pasajeros → validación de precio y cupos (Paso 1) → NÚMERO (Paso 2, por grupo)", () => {
    assertOrdenAntesDeGenerar(cuerpo, [
      "autorizaTenant(ctx, cot.tenant)",
      "La cotización no tiene ítems.",
      "Captura los pasajeros antes de generar el contrato.",
      // B21 (ronda 8): la capacidad se valida CONSOLIDADA (unión por bloqueo de
      // TODA la operación), no por ítem, y sigue ocurriendo ANTES de generar el
      // número — ver el chequeo de faltanteDeCupos en la pre-validación.
      "No hay cupos suficientes en el bloqueo",
    ], "convertirCotizacionCarrito");
  });
});

// ── Los 5 caminos usan el helper CENTRAL, ninguno vuelve a anteponer prefijo ─
describe("los 5 caminos generan el número con la función real (4 en TypeScript, 1 en el RPC de SQL) y ninguno re-aplica prefijo", () => {
  const reservar = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const contratos = leer("app/(dashboard)/dashboard/contratos/actions.ts");
  const manual = leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
  const migracion164 = leer("supabase/migrations/20260601000164_condiciones_pago_componente.sql");

  test("reservar/actions.ts tiene exactamente 3 llamadas a siguienteNumeroContrato", () => {
    const n = [...reservar.matchAll(/siguienteNumeroContrato\(/g)].length;
    assert.equal(n, 3);
  });

  test("contratos/actions.ts tiene exactamente 1 llamada a siguienteNumeroContrato", () => {
    assert.equal([...contratos.matchAll(/siguienteNumeroContrato\(/g)].length, 1);
  });

  test("manual-actions.ts (TS) ya NO llama a siguienteNumeroContrato — la conversión manual delega la numeración, junto con el resto de la lógica, al RPC atómico de SQL", () => {
    // Ver el describe "convertirCotizacionManualAContrato — genera después
    // de validar el titular" más arriba: ahí se audita que el RPC SQL llama
    // a `siguiente_numero_contrato_para_tenant` exactamente una vez, en el
    // lugar correcto del orden de validación.
    assert.equal([...manual.matchAll(/siguienteNumeroContrato\(/g)].length, 0, "manual-actions.ts volvió a llamar a siguienteNumeroContrato() en TS — la numeración debe vivir únicamente dentro del RPC atómico");
    assert.equal(
      [...migracion164.matchAll(/siguiente_numero_contrato_para_tenant\(/g)].length,
      1,
      "la migración 164 debe llamar a siguiente_numero_contrato_para_tenant EXACTAMENTE una vez en total (dentro de convertir_cotizacion_a_contrato)"
    );
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
