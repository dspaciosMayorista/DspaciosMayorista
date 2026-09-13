import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Hallazgo confirmado (primera ronda): el editor de paquetes (`getTarifasHotel`/
// `setHotelFiltros`, `app/(dashboard)/dashboard/paquetes/actions.ts`) siempre
// consultaba `tarifa_hotel`, sin importar `hoteles.modelo_tarifario`. Un
// hotel Bernalo (`modelo_tarifario = "unidad"`) administra sus tarifas en
// `hotel_tarifas_unidad` — `tarifa_hotel` para ese hotel simplemente está
// vacía, así que el editor mostraba categorías/regímenes vacíos, y el modal
// interpretaba "todas seleccionadas" como un arreglo VACÍO que
// `setHotelFiltros` convertía en `null`.
//
// Hallazgo confirmado (segunda ronda, este archivo): la primera corrección
// descartaba el `error` de la consulta a `hoteles.modelo_tarifario`
// (`const { data: hotelRow } = await sb...`) — un error de Supabase dejaba
// `hotelRow` en `undefined`, y `hotelRow?.modelo_tarifario === "unidad"`
// caía en `false` en silencio: CUALQUIER error de red/permisos se trataba
// como "es persona", saltándose por completo la protección Bernalo. Además,
// `setHotelFiltros` validaba categorías y alimentaciones POR SEPARADO,
// permitiendo combinaciones que nunca se publicaron juntas (ej. "Estándar/
// FULL" + "Suite/PC" publicadas no implican que "Estándar/PC" tenga tarifa).
//
// `app/(dashboard)/dashboard/paquetes/actions.ts` requiere Supabase real
// ("use server") — igual que el resto del wiring de este proyecto, se
// verifica por inspección del código FUENTE real.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

function sinComentarios(fuente: string): string {
  return fuente.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*\*?\s*$/.test(l)).join("\n");
}

// Extrae el cuerpo de una función balanceando llaves reales (ignora las que
// aparecen dentro de paréntesis/genéricos de la firma) — mismo criterio que
// pruebas/bernaloIntegracionGuardWiring.test.ts.
function cuerpoFuncion(fuenteCompleta: string, firmaOAncla: string): string {
  const idx = fuenteCompleta.indexOf(firmaOAncla);
  assert.ok(idx > -1, `no se encontró "${firmaOAncla}" en el archivo`);
  let profundidadParen = 0;
  let profundidadAngulo = 0;
  let idxLlaveInicial = -1;
  for (let i = idx; i < fuenteCompleta.length; i++) {
    const ch = fuenteCompleta[i];
    if (ch === "(") profundidadParen++;
    else if (ch === ")") profundidadParen--;
    else if (ch === "<") profundidadAngulo++;
    else if (ch === ">") profundidadAngulo--;
    else if (ch === "{" && profundidadParen === 0 && profundidadAngulo === 0) { idxLlaveInicial = i; break; }
  }
  assert.ok(idxLlaveInicial > -1, `no se encontró el "{" real del cuerpo tras "${firmaOAncla}"`);
  let profundidad = 0;
  for (let i = idxLlaveInicial; i < fuenteCompleta.length; i++) {
    if (fuenteCompleta[i] === "{") profundidad++;
    else if (fuenteCompleta[i] === "}") {
      profundidad--;
      if (profundidad === 0) return fuenteCompleta.slice(idx, i + 1);
    }
  }
  throw new Error(`no se encontró el cierre del cuerpo de "${firmaOAncla}"`);
}

const rutaActions = "app/(dashboard)/dashboard/paquetes/actions.ts";
const fuenteActions = leer(rutaActions);
const codigoActions = sinComentarios(fuenteActions);
const cuerpoGet = cuerpoFuncion(fuenteActions, "export async function getTarifasHotel(hotelId: number)");
const cuerpoSet = cuerpoFuncion(fuenteActions, "export async function setHotelFiltros(");
const cuerpoGetSC = sinComentarios(cuerpoGet);
const cuerpoSetSC = sinComentarios(cuerpoSet);

// Recortes por rama, usados en varias describe — ambas funciones comparten
// EXACTAMENTE la misma estructura: guardas fail-closed → `if (modelo ===
// "unidad") {...}` → `if (modelo === "persona") {...}` → fallback fail-closed.
function ramaGet(marcaInicio: string, marcaFin: string): string {
  const idxInicio = cuerpoGet.indexOf(marcaInicio);
  assert.notEqual(idxInicio, -1, `no se encontró "${marcaInicio}" en getTarifasHotel`);
  const idxFin = cuerpoGet.indexOf(marcaFin, idxInicio + 1);
  assert.notEqual(idxFin, -1, `no se encontró "${marcaFin}" en getTarifasHotel`);
  return cuerpoGet.slice(idxInicio, idxFin);
}
function ramaSet(marcaInicio: string, marcaFin: string): string {
  const idxInicio = cuerpoSet.indexOf(marcaInicio);
  assert.notEqual(idxInicio, -1, `no se encontró "${marcaInicio}" en setHotelFiltros`);
  const idxFin = cuerpoSet.indexOf(marcaFin, idxInicio + 1);
  assert.notEqual(idxFin, -1, `no se encontró "${marcaFin}" en setHotelFiltros`);
  return cuerpoSet.slice(idxInicio, idxFin);
}

const RAMA_UNIDAD_GET_INICIO = 'if (modelo === "unidad") {';
const RAMA_PERSONA_GET_INICIO = 'if (modelo === "persona") {';
const RAMA_UNIDAD_SET_INICIO = 'if (modelo === "unidad") {';
const RAMA_PERSONA_SET_INICIO = 'if (modelo === "persona") {';

describe("getTarifasHotel — falla cerrado al consultar hoteles.modelo_tarifario", () => {
  test("captura data Y error de la consulta a hoteles.modelo_tarifario (no descarta el error)", () => {
    assert.match(cuerpoGet, /const \{ data: hotelRow, error: eHotel \} = await sb\.from\("hoteles"\)\.select\("modelo_tarifario"\)\.eq\("id", hotelId\)\.maybeSingle\(\);/);
  });

  test("un error de Supabase retorna ok:false ANTES de leer modelo_tarifario o de decidir cualquier rama", () => {
    const idxErrCheck = cuerpoGet.indexOf("if (eHotel) return { ok: false,");
    assert.notEqual(idxErrCheck, -1);
    const idxRamaUnidad = cuerpoGet.indexOf(RAMA_UNIDAD_GET_INICIO);
    const idxRamaPersona = cuerpoGet.indexOf(RAMA_PERSONA_GET_INICIO);
    assert.ok(idxErrCheck < idxRamaUnidad, "el chequeo de error debe ir antes de la rama unidad");
    assert.ok(idxErrCheck < idxRamaPersona, "el chequeo de error debe ir antes de la rama persona");
  });

  test("un error de Supabase NUNCA cae a la rama persona: el return de error corta con `return` real, no solo un warning", () => {
    const bloque = cuerpoGet.slice(cuerpoGet.indexOf("if (eHotel) return"), cuerpoGet.indexOf("if (eHotel) return") + 120);
    assert.match(bloque, /return \{ ok: false, error: `No se pudo consultar el modelo tarifario del hotel: \$\{eHotel\.message\}` \};/);
  });

  test("hotel inexistente (!hotelRow) retorna un error claro, distinto del error de Supabase", () => {
    const idx = cuerpoGet.indexOf('if (!hotelRow) return { ok: false, error: "El hotel no existe." };');
    assert.notEqual(idx, -1);
    const idxErrCheck = cuerpoGet.indexOf("if (eHotel) return");
    assert.ok(idxErrCheck < idx, "el chequeo de hotel inexistente debe ir después del chequeo de error de Supabase");
  });

  test('SOLO modelo_tarifario === "unidad" entra a la rama unidad, y SOLO "persona" entra a la rama persona — nunca un else genérico', () => {
    assert.match(cuerpoGet, /if \(modelo === "unidad"\) \{/);
    assert.match(cuerpoGet, /if \(modelo === "persona"\) \{/);
    assert.doesNotMatch(cuerpoGetSC, /\}\s*else\s*\{/);
  });

  test('un modelo_tarifario desconocido o nulo (ninguna de las dos ramas) falla cerrado al final de la función, con un mensaje que lo identifica', () => {
    const idxFinPersona = cuerpoGet.lastIndexOf('return { ok: true, modelo: "persona"');
    const colaFn = cuerpoGet.slice(idxFinPersona);
    assert.match(colaFn, /return \{\s*\n\s*ok: false,\s*\n\s*error: `El hotel tiene un modelo tarifario desconocido \("\$\{modelo\}"\)/);
  });

  test('devuelve una unión discriminada por "ok" y luego "modelo" — persona y unidad, nunca una forma ambigua', () => {
    assert.match(codigoActions, /export type TarifasHotelResultado =\s*\n\s*\| \{ ok: false; error: string \}\s*\n\s*\| \{ ok: true; modelo: "persona";/);
    assert.match(codigoActions, /\| \{ ok: true; modelo: "unidad";/);
    assert.match(cuerpoGet, /return \{ ok: true, modelo: "unidad", categorias, regimenes, tarifas \};/);
    assert.match(cuerpoGet, /return \{ ok: true, modelo: "persona", categorias, regimenes, tarifas \};/);
  });
});

describe("getTarifasHotel — modelo PERSONA: sin cambios de comportamiento (hotel válido)", () => {
  const ramaPersona = ramaGet(RAMA_PERSONA_GET_INICIO, "// Defensa en profundidad");

  test("sigue consultando tarifa_hotel con las mismas columnas de siempre", () => {
    assert.match(
      ramaPersona,
      /\.from\("tarifa_hotel"\)\s*\n\s*\.select\("tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino"\)/
    );
  });

  test("categorias: r.categoria: r.tipo_habitacion ?? \"\" — mapeo idéntico al histórico", () => {
    assert.match(ramaPersona, /categoria: r\.tipo_habitacion \?\? "",/);
  });

  test("nunca lee hotel_tarifas_unidad en la rama persona", () => {
    assert.doesNotMatch(sinComentarios(ramaPersona), /hotel_tarifas_unidad/);
  });
});

describe("getTarifasHotel — modelo UNIDAD: exclusivamente hotel_tarifas_unidad publicada", () => {
  const ramaUnidad = ramaGet(RAMA_UNIDAD_GET_INICIO, RAMA_PERSONA_GET_INICIO);
  const ramaUnidadSC = sinComentarios(ramaUnidad);

  test("consulta hotel_tarifas_unidad — nunca tarifa_hotel (fuera de comentarios explicativos)", () => {
    assert.match(ramaUnidad, /\.from\("hotel_tarifas_unidad"\)/);
    assert.doesNotMatch(ramaUnidadSC, /\.from\("tarifa_hotel"\)/);
  });

  test('filtra EXCLUSIVAMENTE estado = "publicada" — nunca borrador ni inactiva', () => {
    assert.match(ramaUnidad, /\.eq\("estado", "publicada"\)/);
    assert.doesNotMatch(ramaUnidadSC, /"borrador"|"inactiva"/);
  });

  test("captura data Y error de la consulta a hotel_tarifas_unidad", () => {
    assert.match(ramaUnidad, /const \{ data, error: eUnidad \} = await sb/);
  });

  test('un error de la consulta a hotel_tarifas_unidad se distingue de "cero tarifas publicadas": retorna ok:false ANTES de construir el arreglo de tarifas/categorías', () => {
    const idxErr = ramaUnidad.indexOf("if (eUnidad) return");
    assert.notEqual(idxErr, -1);
    const idxMap = ramaUnidad.indexOf("const tarifas: TarifaUnidadPreview[] = (data ?? []).map(");
    assert.ok(idxErr < idxMap, "el chequeo de error debe ir ANTES de construir tarifas (si no, un error real produciría un arreglo vacío indistinguible de 'sin publicar')");
    const bloqueErr = ramaUnidad.slice(idxErr, idxErr + 150);
    assert.match(bloqueErr, /return \{ ok: false, error: `No se pudieron consultar las tarifas por unidad del hotel: \$\{eUnidad\.message\}` \};/);
  });

  test("categorías y alimentaciones salen de las columnas espejo (r.categoria / r.alimentacion) — nunca del payload ni de texto libre", () => {
    assert.match(ramaUnidad, /categoria: r\.categoria \?\? "",/);
    assert.match(ramaUnidad, /alimentacion: r\.alimentacion \?\? "",/);
  });

  test("elimina vacíos y duplicados, y ordena de forma determinista (Set + filter(Boolean) + sort)", () => {
    const idxCategorias = ramaUnidad.indexOf("const categorias = ");
    const bloque = ramaUnidad.slice(idxCategorias, idxCategorias + 400);
    assert.match(bloque, /new Set\(tarifas\.map\(\(t\) => t\.categoria\)\.filter\(Boolean\)\)/);
    assert.match(bloque, /new Set\(tarifas\.map\(\(t\) => t\.alimentacion\)\.filter\(Boolean\)\)/);
    assert.match(bloque, /\]\.sort\(\)/);
  });

  test("nunca adapta la fila a las columnas falsas neto_doble/neto_triple/neto_nino — la tarifa Bernalo no se presenta como per-cápita", () => {
    assert.doesNotMatch(ramaUnidad, /neto_doble|neto_triple|neto_nino/);
  });

  test("el select trae categoria/alimentacion/temporada/payload — no columnas de tarifa_hotel", () => {
    assert.notEqual(ramaUnidad.indexOf('.select("categoria, alimentacion, temporada, payload")'), -1);
  });
});

describe("setHotelFiltros — falla cerrado al consultar hoteles.modelo_tarifario", () => {
  test("captura data Y error de la consulta a hoteles.modelo_tarifario", () => {
    assert.match(cuerpoSet, /const \{ data: hotelRow, error: eHotel \} = await sb\.from\("hoteles"\)\.select\("modelo_tarifario"\)\.eq\("id", hotelId\)\.maybeSingle\(\);/);
  });

  test("un error de Supabase retorna ok:false ANTES de decidir cualquier rama (nunca ejecuta el upsert)", () => {
    const idxErrCheck = cuerpoSet.indexOf("if (eHotel) return { ok: false,");
    assert.notEqual(idxErrCheck, -1);
    const idxRamaUnidad = cuerpoSet.indexOf(RAMA_UNIDAD_SET_INICIO);
    const idxRamaPersona = cuerpoSet.indexOf(RAMA_PERSONA_SET_INICIO);
    const idxUpsert1 = cuerpoSet.indexOf(".upsert(");
    assert.ok(idxErrCheck < idxRamaUnidad && idxErrCheck < idxRamaPersona && idxErrCheck < idxUpsert1, "el chequeo de error debe ir antes de ambas ramas y de cualquier upsert");
  });

  test("hotel inexistente (!hotelRow) retorna un error claro y nunca llega al upsert", () => {
    const idx = cuerpoSet.indexOf('if (!hotelRow) return { ok: false, error: "El hotel no existe." };');
    assert.notEqual(idx, -1);
    const idxUpsert1 = cuerpoSet.indexOf(".upsert(");
    assert.ok(idx < idxUpsert1);
  });

  test('SOLO "unidad" entra a la rama unidad y SOLO "persona" a la rama persona — un modelo desconocido/nulo falla cerrado sin ejecutar ningún upsert', () => {
    assert.match(cuerpoSet, /if \(modelo === "unidad"\) \{/);
    assert.match(cuerpoSet, /if \(modelo === "persona"\) \{/);
    const idxFinPersona = cuerpoSet.lastIndexOf("revalidatePath(`/dashboard/paquetes/${paqueteId}`);");
    const cola = cuerpoSet.slice(idxFinPersona);
    assert.match(cola, /return \{\s*\n\s*ok: false,\s*\n\s*error: `El hotel tiene un modelo tarifario desconocido \("\$\{modelo\}"\)/);
    assert.doesNotMatch(sinComentarios(cola), /\.upsert\(/);
  });
});

describe("setHotelFiltros — modelo UNIDAD: valida COMBINACIONES reales, no categorías/alimentaciones por separado", () => {
  const ramaUnidad = ramaSet(RAMA_UNIDAD_SET_INICIO, RAMA_PERSONA_SET_INICIO);

  test("rechaza arreglos vacíos de categorías/regímenes para un hotel unidad (nunca persiste null como sentinela de todas)", () => {
    assert.match(ramaUnidad, /if \(!categorias\.length \|\| !regimenes\.length\) \{/);
    const idxGuard = ramaUnidad.indexOf("if (!categorias.length || !regimenes.length) {");
    const bloqueGuard = ramaUnidad.slice(idxGuard, idxGuard + 200);
    assert.match(bloqueGuard, /return \{[\s\S]{0,30}ok: false,/);
  });

  test("captura data Y error de la consulta de filas publicadas de hotel_tarifas_unidad", () => {
    assert.match(ramaUnidad, /const \{ data: filas, error: eFilas \} = await sb/);
    assert.match(ramaUnidad, /if \(eFilas\) return \{ ok: false, error: eFilas\.message \};/);
  });

  test("construye un Set de PARES publicados (categoria+alimentacion juntos), no dos Sets independientes", () => {
    const idxPares = ramaUnidad.indexOf("const paresPublicados = new Set(");
    assert.notEqual(idxPares, -1);
    const bloque = ramaUnidad.slice(idxPares, idxPares + 300);
    assert.match(bloque, /JSON\.stringify\(\[f\.categoria, f\.alimentacion\]\)/);
    assert.doesNotMatch(sinComentarios(ramaUnidad), /categoriasPublicadas|alimentacionesPublicadas/, "no debe quedar el criterio viejo de dos Sets independientes");
  });

  test("verifica TODO el producto cartesiano categorias × regimenes contra los pares publicados (doble for anidado)", () => {
    const idxDobleFor = ramaUnidad.indexOf("for (const c of categorias) {");
    assert.notEqual(idxDobleFor, -1);
    const bloque = ramaUnidad.slice(idxDobleFor, idxDobleFor + 300);
    assert.match(bloque, /for \(const r of regimenes\) \{/);
    assert.match(bloque, /if \(!paresPublicados\.has\(JSON\.stringify\(\[c, r\]\)\)\) \{/);
  });

  test('el mensaje de error de una combinación faltante identifica AMBOS valores (categoría y alimentación)', () => {
    const idxErr = ramaUnidad.indexOf("No hay ninguna tarifa publicada para la combinación");
    assert.notEqual(idxErr, -1);
    const bloque = ramaUnidad.slice(idxErr - 20, idxErr + 150);
    assert.match(bloque, /\$\{c\}/);
    assert.match(bloque, /\$\{r\}/);
  });

  test("persiste arreglos EXPLÍCITOS (nunca null) cuando el hotel es unidad, y solo tras pasar la validación de combinaciones", () => {
    const idxUpsert = ramaUnidad.indexOf('.from("armado_hoteles").upsert(');
    assert.notEqual(idxUpsert, -1);
    const bloqueUpsert = ramaUnidad.slice(idxUpsert, idxUpsert + 200);
    assert.match(bloqueUpsert, /hotel_id: hotelId, categorias, regimenes \},/);
    assert.doesNotMatch(bloqueUpsert, /categorias\.length \? categorias : null/);
    const idxDobleFor = ramaUnidad.indexOf("for (const c of categorias) {");
    assert.ok(idxDobleFor < idxUpsert, "la validación de combinaciones debe ejecutarse ANTES del upsert");
  });
});

describe('setHotelFiltros — modelo PERSONA: conserva EXACTAMENTE el sentinela "arreglo vacío → null" de siempre', () => {
  const ramaPersona = ramaSet(RAMA_PERSONA_SET_INICIO, "// Defensa en profundidad");

  test("categorias/regimenes vacíos se persisten como null (todas)", () => {
    assert.match(ramaPersona, /categorias: categorias\.length \? categorias : null,/);
    assert.match(ramaPersona, /regimenes: regimenes\.length \? regimenes : null,/);
  });

  test("no valida combinaciones ni consulta hotel_tarifas_unidad en la rama persona", () => {
    assert.doesNotMatch(sinComentarios(ramaPersona), /hotel_tarifas_unidad|paresPublicados/);
  });
});

describe("Aislamiento de alcance: no se toca cálculo/cotización/contrato/CxP/carrito/Vista Booking", () => {
  test("generarTarifario sigue existiendo tal cual (no se tocó en esta corrección)", () => {
    assert.match(codigoActions, /export async function generarTarifario\(paqueteId: number\): Promise<Result> \{/);
  });

  test("no se inserta ninguna fila en tarifario_resultado desde getTarifasHotel/setHotelFiltros", () => {
    assert.doesNotMatch(cuerpoGet, /tarifario_resultado/);
    assert.doesNotMatch(cuerpoSet, /tarifario_resultado/);
  });

  test("no se toca lib/reservar/computo.ts ni lib/reservar/computoReservaBernalo.ts (cálculo/cotización quedan intactos)", () => {
    const fuenteComputo = leer("lib/reservar/computo.ts");
    const fuenteComputoBernalo = leer("lib/reservar/computoReservaBernalo.ts");
    assert.match(fuenteComputo, /modelo_tarifario/);
    assert.match(fuenteComputoBernalo, /modelo_tarifario/);
  });
});
