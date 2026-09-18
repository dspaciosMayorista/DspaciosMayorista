import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// "Precio final autoritativo" (promoción Dubai, migración 179) — verificación
// por inspección de fuente de los puntos de I/O que no son testeables como
// función pura (Supabase, JSX/React sin testing-library en este repo). Mismo
// criterio que el resto de "wiring tests" del proyecto.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const computo = readFileSync(join(raiz, "lib/reservar/computo.ts"), "utf8");
const liquidacionHotel = readFileSync(join(raiz, "lib/reservar/liquidacionHotel.ts"), "utf8");
const paquetesActions = readFileSync(join(raiz, "app/(dashboard)/dashboard/paquetes/actions.ts"), "utf8");
const hotelesActions = readFileSync(join(raiz, "app/(dashboard)/dashboard/producto/hoteles/actions.ts"), "utf8");
const hotelDetalle = readFileSync(join(raiz, "app/(dashboard)/dashboard/producto/hoteles/[id]/HotelDetalleClient.tsx"), "utf8");
const types = readFileSync(join(raiz, "types/database.ts"), "utf8");
const migracion179 = readFileSync(join(raiz, "supabase/migrations/20260601000179_tarifa_hotel_precio_final_autoritativo.sql"), "utf8");
const migracion180 = readFileSync(join(raiz, "supabase/migrations/20260601000180_tarifario_resultado_procedencia.sql"), "utf8");
const preflight180 = readFileSync(join(raiz, "supabase/scripts/preflight_180_tarifario_resultado_procedencia.sql"), "utf8");
const postcheck179 = readFileSync(join(raiz, "supabase/scripts/postcheck_179_tarifa_hotel_precio_final_autoritativo.sql"), "utf8");
const postcheck180 = readFileSync(join(raiz, "supabase/scripts/postcheck_180_tarifario_resultado_procedencia.sql"), "utf8");
const rollback180 = readFileSync(join(raiz, "supabase/scripts/rollback_180_tarifario_resultado_procedencia.sql"), "utf8");
const calculadoraEditor = readFileSync(join(raiz, "app/(dashboard)/dashboard/producto/hoteles/[id]/CalculadoraEditor.tsx"), "utf8");
const calculadorasTs = readFileSync(join(raiz, "lib/calc/calculadoras.ts"), "utf8");
const paquetesTs = readFileSync(join(raiz, "lib/calc/paquetes.ts"), "utf8");

// Igual que la variante usada en otros wiring tests del repo, pero cae al
// FINAL del archivo cuando la función es la última declaración exportada
// (no hay "siguiente export" que marque el cierre) — nunca lanza en ese caso.
function cuerpoFuncionPorSiguienteExport(fuenteCompleta: string, ancla: string): string {
  const idx = fuenteCompleta.indexOf(ancla);
  assert.ok(idx > -1, `no se encontró "${ancla}"`);
  const resto = fuenteCompleta.slice(idx + ancla.length);
  const m = resto.match(/\nexport (async function|function|const) /);
  const fin = m ? idx + ancla.length + (m as RegExpMatchArray).index! : fuenteCompleta.length;
  return fuenteCompleta.slice(idx, fin);
}

describe("computo.ts — selecciona precio_final_autoritativo y lo propaga a los 4 liquidadores", () => {
  test("el select de tarifa_hotel que trae los netos (neto_sencilla...) incluye precio_final_autoritativo", () => {
    const anclaSelect = 'admin.from("tarifa_hotel").select("tipo_habitacion, alimentacion, temporada, neto_sencilla';
    const posSelect = computo.indexOf(anclaSelect);
    assert.notEqual(posSelect, -1);
    const posCierre = computo.indexOf('")', posSelect + anclaSelect.length);
    assert.match(computo.slice(posSelect, posCierre), /precio_final_autoritativo/);
  });

  test("precioFinalTemporadasDe existe y filtra por r.precio_final_autoritativo", () => {
    assert.match(computo, /const precioFinalTemporadasDe = \(rows: TarRow\[\]\): Set<string> => \{/);
    const pos = computo.indexOf("const precioFinalTemporadasDe");
    const cuerpo = computo.slice(pos, pos + 300);
    assert.match(cuerpo, /r\.precio_final_autoritativo/);
  });

  test("las 4 llamadas a los liquidadores (habitación, niño, niño2, infante) reciben precioFinalTemporadas", () => {
    assert.match(computo, /liquidarHotelNochesConTemporadas\(\{[^}]*precioFinalTemporadas: precioFinalTemporadasVig/);
    const ocurrencias = computo.match(/precioFinalTemporadas: precioFinalTemporadasMenores/g) ?? [];
    assert.equal(ocurrencias.length, 3, "niño, niño2 e infante deben pasar precioFinalTemporadas: precioFinalTemporadasMenores");
  });
});

describe("liquidacionHotel.ts (evaluarHotelPorFechas) — construye y propaga precioFinalTemporadas por combo", () => {
  test("construye el set filtrando row.precio_final_autoritativo === true de tempMap", () => {
    const pos = liquidacionHotel.indexOf("const precioFinalTemporadas = new Set<string>();");
    assert.notEqual(pos, -1);
    const cuerpo = liquidacionHotel.slice(pos, pos + 200);
    assert.match(cuerpo, /row\.precio_final_autoritativo === true/);
  });

  test("liquidarHotelNochesConTemporadas y liquidarHotelNoches (dentro del mismo combo) reciben precioFinalTemporadas", () => {
    assert.match(liquidacionHotel, /liquidarHotelNochesConTemporadas\(\{[^}]*precioFinalTemporadas \}\)/);
    assert.match(liquidacionHotel, /liquidarHotelNoches\(\{[^}]*precioFinalTemporadas \}\)/);
  });
});

describe("paquetes/actions.ts (filasHoteles, generación del tarifario) — el PVP congelado usa el precio final de la promoción", () => {
  test("construye precioFinalTemporadas por combo desde tempMap, igual criterio que liquidacionHotel.ts", () => {
    const pos = paquetesActions.indexOf("const precioFinalTemporadas = new Set<string>();");
    assert.notEqual(pos, -1);
    const cuerpo = paquetesActions.slice(pos, pos + 200);
    assert.match(cuerpo, /row\.precio_final_autoritativo === true/);
  });

  test("liquidarHotelMasBaratoConTemporada (tarifario 'desde') Y liquidarHotelNochesConTemporadas (fecha fija) reciben precioFinalTemporadas — las variantes CON identidad, no las simples", () => {
    assert.match(paquetesActions, /liquidarHotelMasBaratoConTemporada\(\{[^}]*precioFinalTemporadas \}\)/);
    assert.match(paquetesActions, /liquidarHotelNochesConTemporadas\(\{[^}]*precioFinalTemporadas \}\)/);
  });

  test("el select de tarifa_hotel para el tarifario sigue siendo select(\"*\") — precio_final_autoritativo llega sin query adicional", () => {
    assert.match(paquetesActions, /sb\.from\("tarifa_hotel"\)\.select\("\*"\)/);
  });
});

describe("types/database.ts — tarifa_hotel declara precio_final_autoritativo/temporada_base", () => {
  test("Row declara ambos campos (no opcionales en Row, boolean + string|null)", () => {
    const posTabla = types.indexOf("tarifa_hotel: {");
    const posSiguiente = types.indexOf("hotel_tarifas_unidad:", posTabla);
    const bloque = types.slice(posTabla, posSiguiente);
    assert.match(bloque, /precio_final_autoritativo: boolean;/);
    assert.match(bloque, /temporada_base: string \| null;/);
  });

  test("Insert declara ambos campos como opcionales", () => {
    const posTabla = types.indexOf("tarifa_hotel: {");
    const posInsert = types.indexOf("Insert:", posTabla);
    const posSiguiente = types.indexOf("Update:", posInsert);
    const bloque = types.slice(posInsert, posSiguiente);
    assert.match(bloque, /precio_final_autoritativo\?: boolean;/);
    assert.match(bloque, /temporada_base\?: string \| null;/);
  });
});

describe("Migración 179 — columna aditiva, idempotente, con CHECK guardado por conrelid, sin backfill", () => {
  test("agrega ambas columnas con IF NOT EXISTS y default false/null", () => {
    assert.match(migracion179, /add column if not exists precio_final_autoritativo boolean not null default false/);
    assert.match(migracion179, /add column if not exists temporada_base text/);
  });

  test("el CHECK está guardado por conrelid (filtrado a tarifa_hotel, no solo por nombre)", () => {
    assert.match(migracion179, /conrelid = 'public\.tarifa_hotel'::regclass/);
  });

  test("no contiene ningún INSERT/UPDATE de datos FUERA del cuerpo de la función (sin backfill) — el RPC define un insert/delete que solo corre si ALGUIEN lo invoca, nunca se ejecuta al aplicar la migración", () => {
    // Quita el cuerpo `as $$ ... $$` de la función (donde SÍ hay un insert/
    // delete legítimos — son el propio RPC, no una mutación de la migración)
    // y confirma que fuera de eso no queda ningún insert/update de datos.
    const sinCuerposDeFuncion = migracion179.replace(/as \$\$[\s\S]*?\$\$;/g, "");
    assert.doesNotMatch(sinCuerposDeFuncion.toLowerCase(), /\binsert into\b/);
    assert.doesNotMatch(sinCuerposDeFuncion.toLowerCase(), /\bupdate public\.tarifa_hotel set\b/);
  });

  test("documenta que 177 y 178 YA están aplicadas remotamente — el orden pendiente es SOLO preflight 179 → 179 → postcheck 179 → código", () => {
    assert.match(migracion179, /177 y 178 YA ESTÁN APLICADAS Y VERIFICADAS/);
    assert.doesNotMatch(migracion179, /aplicar 177, luego 178, luego ESTA migración/);
  });
});

describe("Migración 179 — RPC transaccional reemplazar_tarifas_hotel_calculadora", () => {
  const posFn = migracion179.indexOf("create or replace function public.reemplazar_tarifas_hotel_calculadora(");
  const posFnEnd = migracion179.indexOf("$$;", migracion179.indexOf("as $$", posFn));
  const cuerpoFn = migracion179.slice(posFn, posFnEnd);

  test("es SECURITY DEFINER con candado de rol propio (mismo set que la policy RLS de tarifa_hotel de la migración 016)", () => {
    assert.notEqual(posFn, -1);
    assert.match(migracion179, /security definer/);
    assert.match(cuerpoFn, /coalesce\(public\.mi_rol\(\)::text, ''\) not in \('superadmin', 'gerencia', 'administracion', 'operaciones'\)/);
  });

  test("HALLAZGO CORREGIDO: usa coalesce(mi_rol()::text, '') — nunca mi_rol() not in (...) a secas (con NULL, 'not in' evalúa a NULL y el IF de PL/pgSQL lo trata como falso, dejando pasar sin autorización)", () => {
    assert.doesNotMatch(cuerpoFn, /if public\.mi_rol\(\) not in/);
  });

  test("delete + insert viven en el MISMO cuerpo de función (misma transacción que el caller) — nunca en llamadas HTTP separadas", () => {
    assert.match(cuerpoFn, /delete from public\.tarifa_hotel where hotel_id = p_hotel_id/);
    assert.match(cuerpoFn, /insert into public\.tarifa_hotel \(/);
  });

  test("p_regimenes null/vacío = modo reemplazar (borra todo el hotel); con valores = modo agregar (solo esos regímenes)", () => {
    assert.match(migracion179, /if p_regimenes is null or array_length\(p_regimenes, 1\) is null then/);
    assert.match(migracion179, /alimentacion = any\(p_regimenes\)/);
  });

  test("solo `authenticated` tiene EXECUTE — revocado de public/anon", () => {
    assert.match(migracion179, /revoke all on function public\.reemplazar_tarifas_hotel_calculadora\(bigint, text\[\], jsonb\) from public, anon;/);
    assert.match(migracion179, /grant execute on function public\.reemplazar_tarifas_hotel_calculadora\(bigint, text\[\], jsonb\) to authenticated;/);
  });
});

describe("Migración 179 — RPC endurecido: rechaza p_filas vacío/no-array y valida hotel_id por fila, ANTES del delete", () => {
  const posFn = migracion179.indexOf("create or replace function public.reemplazar_tarifas_hotel_calculadora(");
  const posFnEnd = migracion179.indexOf("$$;", migracion179.indexOf("as $$", posFn));
  const cuerpoFn = migracion179.slice(posFn, posFnEnd);
  const posDelete = cuerpoFn.indexOf("delete from public.tarifa_hotel where hotel_id = p_hotel_id");

  test("rechaza p_filas que no sea un arreglo jsonb", () => {
    assert.match(cuerpoFn, /if p_filas is null or jsonb_typeof\(p_filas\) <> 'array' then/);
  });

  test("HALLAZGO CORREGIDO: rechaza un arreglo VACÍO (antes se aceptaba y borraba el hotel sin insertar nada a cambio)", () => {
    assert.match(cuerpoFn, /if jsonb_array_length\(p_filas\) = 0 then/);
    assert.match(cuerpoFn, /p_filas no puede ser un arreglo vacío/);
  });

  test("HALLAZGO CORREGIDO: valida que cada elemento sea un objeto Y que, si declara hotel_id, coincida con p_hotel_id — TODO antes del primer delete", () => {
    assert.match(cuerpoFn, /if jsonb_typeof\(v_fila\) <> 'object' then/);
    assert.match(cuerpoFn, /if v_fila \? 'hotel_id' and v_fila->>'hotel_id' is not null then/);
    assert.match(cuerpoFn, /if v_hotel_fila <> p_hotel_id then/);
  });

  test("las 4 validaciones (array, no-vacío, es-objeto, hotel_id coincide) están TODAS antes del primer DELETE — un lote inválido nunca borra ni una fila", () => {
    const posValidacionArray = cuerpoFn.indexOf("jsonb_typeof(p_filas) <> 'array'");
    const posValidacionVacio = cuerpoFn.indexOf("jsonb_array_length(p_filas) = 0");
    const posValidacionObjeto = cuerpoFn.indexOf("jsonb_typeof(v_fila) <> 'object'");
    const posValidacionHotelId = cuerpoFn.indexOf("v_hotel_fila <> p_hotel_id");
    for (const [nombre, pos] of [["array", posValidacionArray], ["vacío", posValidacionVacio], ["objeto", posValidacionObjeto], ["hotel_id", posValidacionHotelId]] as const) {
      assert.notEqual(pos, -1, `no se encontró la validación "${nombre}"`);
      assert.ok(pos < posDelete, `la validación "${nombre}" (pos ${pos}) debe estar ANTES del delete (pos ${posDelete})`);
    }
  });
});

describe("Migración 179 — CHECK de procedencia FORTALECIDO: exige temporada_base con contenido real (trim, no vacío)", () => {
  test("precio_final_autoritativo=true exige temporada_base no nulo Y con btrim() no vacío", () => {
    assert.match(migracion179, /precio_final_autoritativo = true and temporada_base is not null and btrim\(temporada_base\) <> ''/);
  });

  test("precio_final_autoritativo=false exige temporada_base NULL exacto", () => {
    assert.match(migracion179, /precio_final_autoritativo = false and temporada_base is null/);
  });

  test("el CHECK real (dentro de check(...), no los comentarios que documentan la historia) ya NO usa la forma biconditional simple sin btrim", () => {
    const posCheck = migracion179.indexOf("alter table public.tarifa_hotel add constraint tarifa_hotel_temporada_base_solo_si_final_check");
    const posCheckEnd = migracion179.indexOf("end $$;", posCheck);
    const cuerpoCheck = migracion179.slice(posCheck, posCheckEnd);
    assert.doesNotMatch(cuerpoCheck, /\(temporada_base is not null\) = precio_final_autoritativo/);
  });
});

describe("Atomicidad real — generarTarifasCalculadora delega TODO el reemplazo al RPC transaccional (hoteles/actions.ts)", () => {
  const cuerpo = cuerpoFuncionPorSiguienteExport(hotelesActions, "export async function generarTarifasCalculadora(");

  test("llama sb.rpc('reemplazar_tarifas_hotel_calculadora', ...) con hotel_id/regimenes/filas — nunca un select/delete/insert manual", () => {
    assert.match(cuerpo, /sb\.rpc\("reemplazar_tarifas_hotel_calculadora", \{/);
    assert.match(cuerpo, /p_hotel_id: hotelId,/);
    assert.match(cuerpo, /p_regimenes: regimenes,/);
    assert.match(cuerpo, /p_filas: filas as unknown as Json,/);
  });

  test("YA NO reimplementa select→delete→insert→restaurar en JS — ese patrón (nunca atómico de verdad, IDs nuevos en la restauración) desapareció por completo", () => {
    assert.doesNotMatch(cuerpo, /\.select\("\*"\)\.eq\("hotel_id", hotelId\)/);
    assert.doesNotMatch(cuerpo, /\.delete\(\)\.eq\("hotel_id", hotelId\)/);
    assert.doesNotMatch(cuerpo, /filasRespaldo/);
    assert.doesNotMatch(cuerpo, /const restaurar/);
    assert.doesNotMatch(cuerpo, /TAMBIÉN falló/);
  });

  test("modo 'reemplazar' pasa p_regimenes: null (borra todo el hotel); modo 'agregar' pasa el arreglo de regímenes generados", () => {
    assert.match(cuerpo, /const regimenes = modo === "reemplazar" \? null : \[\.\.\.new Set\(filas\.map\(\(f\) => f\.alimentacion\)\.filter\(Boolean\)\)\];/);
  });

  test("propaga el error del RPC tal cual (sin intentar ninguna recuperación en JS — la atomicidad ya la garantiza Postgres)", () => {
    const posRpc = cuerpo.indexOf("sb.rpc(");
    const posIfError = cuerpo.indexOf("if (error)", posRpc);
    assert.notEqual(posIfError, -1);
    const bloque = cuerpo.slice(posIfError, posIfError + 100);
    assert.match(bloque, /return \{ ok: false, error: error\.message \};/);
  });
});

describe("Robustez — regenerarTarifariosDeHotel reporta (no oculta) los fallos de Promise.allSettled", () => {
  const cuerpo = cuerpoFuncionPorSiguienteExport(paquetesActions, "export async function regenerarTarifariosDeHotel(");

  test("sigue siendo best-effort (Promise.allSettled, nunca bloquea) pero ahora recorre los resultados", () => {
    assert.match(cuerpo, /const resultados = await Promise\.allSettled\(ids\.map/);
    assert.match(cuerpo, /resultados\.forEach\(\(r, i\) => \{/);
  });

  test("loguea cada rechazo (promesa RECHAZADA) con el id del paquete y el motivo — ya no se descarta el array completo", () => {
    assert.match(cuerpo, /if \(r\.status === "rejected"\) \{/);
    assert.match(cuerpo, /console\.error\(`regenerarTarifariosDeHotel:/);
  });

  test("HALLAZGO CORREGIDO: también detecta la promesa CUMPLIDA con {ok:false} — generarTarifario nunca lanza por error de negocio, lo devuelve como valor resuelto", () => {
    assert.match(cuerpo, /\} else if \(!r\.value\.ok\) \{/);
    assert.match(cuerpo, /devolvió ok:false: \$\{r\.value\.error\}/);
  });

  test("sigue envuelta en try/catch best-effort — un fallo acá nunca bloquea la edición del hotel", () => {
    assert.match(cuerpo, /\} catch \(err\) \{/);
  });

  test("HALLAZGO CORREGIDO: el catch EXTERIOR ya no está silencioso — loguea hotel_id y el error técnico (antes: comentario vacío, un fallo ANTES de Promise.allSettled —ej. la consulta a armado_hoteles— desaparecía sin ningún rastro)", () => {
    const posCatch = cuerpo.indexOf("} catch (err) {");
    assert.notEqual(posCatch, -1);
    const cuerpoCatch = cuerpo.slice(posCatch, posCatch + 500);
    assert.match(cuerpoCatch, /console\.error\(`regenerarTarifariosDeHotel: fallo técnico para hotel_id=\$\{hotelId\}:`, err\)/);
  });
});

describe("HALLAZGO CORREGIDO — caso real generarTarifario() → Promise resuelta {ok:false} (no rechazada)", () => {
  // generarTarifario() (app/(dashboard)/dashboard/paquetes/actions.ts) tiene
  // más de 15 `return { ok: false, error: ... }` — ninguno es un `throw`. Un
  // paquete sin destino, sin hoteles válidos, etc. resuelve la promesa con
  // {ok:false}; Promise.allSettled la reporta como "fulfilled", nunca
  // "rejected". Confirma que el tipo de retorno declarado es efectivamente
  // ese molde (no una función que solo lanza), y que regenerarTarifariosDeHotel
  // itera exactamente ese `.value.ok`.
  test("generarTarifario devuelve Promise<Result> = {ok:true,...} | {ok:false,error:string} — nunca Promise<void>/throw-only", () => {
    assert.match(paquetesActions, /export async function generarTarifario\(paqueteId: number\): Promise<Result>/);
  });

  test("generarTarifario tiene múltiples caminos ok:false, todos por `return` (literal o vía fallar()/fallarTecnico()), ninguno por `throw`", () => {
    const posFn = paquetesActions.indexOf("export async function generarTarifario(paqueteId: number): Promise<Result>");
    const posSiguiente = paquetesActions.indexOf("\nexport async function", posFn + 10);
    const cuerpoFn = paquetesActions.slice(posFn, posSiguiente);
    // Auditoría de Fase 1 (rondas 2-3): la mayoría de los `return { ok:
    // false, error: ... }` literales se reemplazaron por `return await
    // fallar(...)`/`return await fallarTecnico(...)` (que internamente SÍ
    // resuelven con `{ ok: false, error }`, nunca lanzan) para poder marcar
    // el intento de generación como fallido antes de reportar el error. El
    // conteo debe sumar las 3 formas para seguir reflejando la MISMA
    // garantía: múltiples caminos, todos por `return`, ninguno por `throw`.
    const returnsLiteral = (cuerpoFn.match(/return \{ ok: false, error:/g) ?? []).length;
    const returnsFallar = (cuerpoFn.match(/return await fallar\(/g) ?? []).length;
    const returnsFallarTecnico = (cuerpoFn.match(/return await fallarTecnico\(/g) ?? []).length;
    const totalCaminos = returnsLiteral + returnsFallar + returnsFallarTecnico;
    assert.ok(totalCaminos >= 5, `generarTarifario debe tener varios caminos ok:false por return (literal=${returnsLiteral}, fallar=${returnsFallar}, fallarTecnico=${returnsFallarTecnico}, total=${totalCaminos})`);
    assert.doesNotMatch(cuerpoFn, /\bthrow\b/, "generarTarifario no debe lanzar por errores de negocio — siempre resuelve {ok:false}");
  });

  test("regenerarTarifariosDeHotel lee r.value.ok del resultado CUMPLIDO de exactamente esa función (generarTarifario(id))", () => {
    const cuerpo = cuerpoFuncionPorSiguienteExport(paquetesActions, "export async function regenerarTarifariosDeHotel(");
    assert.match(cuerpo, /Promise\.allSettled\(ids\.map\(\(id\) => generarTarifario\(id\)\)\)/);
    assert.match(cuerpo, /!r\.value\.ok/);
  });
});

describe("HotelDetalleClient.tsx — UI distingue Base/Promoción y muestra la condición de la tarifa", () => {
  test("el tipo Tarifa declara precio_final_autoritativo, temporada_base y notas", () => {
    assert.match(hotelDetalle, /precio_final_autoritativo\?: boolean;/);
    assert.match(hotelDetalle, /temporada_base\?: string \| null;/);
    assert.match(hotelDetalle, /notas\?: string \| null;/);
  });

  test("la fila muestra el badge 'Promoción' cuando precio_final_autoritativo, y 'Base' en caso contrario", () => {
    assert.match(hotelDetalle, /t\.precio_final_autoritativo \? \(/);
    assert.match(hotelDetalle, /\bPromoción\b/);
    assert.match(hotelDetalle, />Base</);
  });

  test("muestra t.notas (condición de la TARIFA) cuando está presente — no se confunde con condición de PAGO", () => {
    assert.match(hotelDetalle, /t\.notas\?\.trim\(\) && \(/);
    assert.match(hotelDetalle, /[Cc]ondici[oó]n de la TARIFA/);
  });

  test("cada fila sigue siendo UNA combinación categoría+alimentación+temporada con las acomodaciones como COLUMNAS (sencilla/doble/triple/multiple/niño/niño2/infante), nunca filas independientes", () => {
    // Una sola <tr> por fila de datos (filaTarifa), con las 7 acomodaciones
    // como <td> dentro de esa misma fila — confirma que no se propuso (ni se
    // implementó) una fila por acomodación.
    const posFn = hotelDetalle.indexOf("const filaTarifa = (t: Tarifa) => (");
    assert.notEqual(posFn, -1);
    const posCierre = hotelDetalle.indexOf("const tablaTarifas = (rows: Tarifa[])", posFn);
    const cuerpoFila = hotelDetalle.slice(posFn, posCierre);
    const trAbre = (cuerpoFila.match(/<tr /g) ?? []).length;
    assert.equal(trAbre, 1, "filaTarifa debe renderizar exactamente UNA <tr> por combinación categoría/alimentación/temporada");
  });

  test("regla definitiva (corrección posterior): NO recalcula ni muestra un segundo valor derivado de descuento_valor — la fila materializada es el único precio", () => {
    // Antes, `conDescuento` aplicaba `base × (1 − descuento_valor/100)` sobre
    // CUALQUIER fila cuya temporada coincidiera con una vigencia de
    // descuento — incluida la propia fila YA materializada de una promoción
    // (ej. mostrar "180.000 (162.000)" sobre una fila que YA es 180.000
    // final). Retirado por completo: una vigencia nunca deriva un precio.
    assert.doesNotMatch(hotelDetalle, /conDescuento/, "no debe quedar ninguna función que recalcule un precio desde descuento_valor");
    assert.doesNotMatch(hotelDetalle, /cfgTemporada/, "no debe quedar código que busque la vigencia de una fila para derivar su precio");
  });
});

describe("Hallazgo 1 corregido — paquetes/actions.ts (filasHoteles) persiste la procedencia EXACTA en tarifario_resultado", () => {
  test("importa liquidarHotelMasBaratoConTemporada/liquidarHotelNochesConTemporadas — nunca solo las variantes sin identidad para el insert", () => {
    assert.match(paquetesActions, /liquidarHotelMasBaratoConTemporada,/);
    assert.match(paquetesActions, /liquidarHotelNochesConTemporadas,/);
  });

  test("costoHotel sale de `resultado.total` — resultado viene de la MISMA búsqueda que produce la identidad, nunca de un cálculo aparte por fecha_ida", () => {
    assert.match(paquetesActions, /const resultado = masBarato\s*\n\s*\? liquidarHotelMasBaratoConTemporada\(/);
    assert.match(paquetesActions, /: liquidarHotelNochesConTemporadas\(/);
    assert.match(paquetesActions, /const costoHotel = resultado\?\.total \?\? null;/);
  });

  test("la fila insertada en tarifario_resultado lleva temporada_ganadora/es_promocion/precio_final_autoritativo/procedencia_temporadas/procedencia_mixta, tomados de `columnasProcedencia(resultado?.procedencia)` (nunca de fecha_ida)", () => {
    assert.match(paquetesActions, /import \{ columnasProcedencia \} from "@\/lib\/tarifario\/procedenciaTarifario";/);
    assert.match(paquetesActions, /const procedencia = columnasProcedencia\(resultado\?\.procedencia\);/);
    assert.match(paquetesActions, /temporada_ganadora: procedencia\.temporada_ganadora,/);
    assert.match(paquetesActions, /es_promocion: procedencia\.es_promocion,/);
    assert.match(paquetesActions, /precio_final_autoritativo: procedencia\.precio_final_autoritativo,/);
    assert.match(paquetesActions, /procedencia_temporadas: procedencia\.procedencia_temporadas as unknown as Json,/);
    assert.match(paquetesActions, /procedencia_mixta: procedencia\.procedencia_mixta,/);
  });
});

describe("Hallazgo 1 corregido — lib/calc/paquetes.ts: la identidad de la ventana 'más barato' viene de la MISMA noche que ganó, nunca de `desde`", () => {
  test("buscarNocheMasBarata es la ÚNICA búsqueda — liquidarHotelMasBarato y liquidarHotelMasBaratoConTemporada la reusan (no hay dos implementaciones del recorrido)", () => {
    const ocurrencias = paquetesTs.match(/buscarNocheMasBarata\(args\)/g) ?? [];
    assert.equal(ocurrencias.length, 2, "liquidarHotelMasBarato y liquidarHotelMasBaratoConTemporada deben llamar a la MISMA función interna");
  });

  test("buscarNocheMasBarata compara por r.neto en cada noche candidata (no por fecha) y devuelve la resolución DETALLADA completa (con temporadaGanadora)", () => {
    assert.match(paquetesTs, /if \(r != null && \(mejor == null \|\| r\.neto < mejor\.neto\)\) mejor = r;/);
  });

  test("liquidarHotelNochesConTemporadas expone `procedencia: ProcedenciaNoche[]` agregando TODAS las noches (nunca solo el check-in), SIN perder temporadasTarifa (el set completo, usado por edad/condiciones)", () => {
    assert.match(paquetesTs, /temporadasTarifa: string\[\];/);
    assert.match(paquetesTs, /procedencia: ProcedenciaNoche\[\];/);
    assert.match(paquetesTs, /export type ProcedenciaNoche = \{\s*\n\s*temporadaGanadora: string;\s*\n\s*esPromocion: boolean;\s*\n\s*precioFinalAutoritativo: boolean;\s*\n\};/);
  });

  test("deduplicarProcedencia deduplica por la TUPLA completa [temporadaGanadora, esPromocion, precioFinalAutoritativo] — un mapa anidado real, nunca concatenación de string ambigua (`\\`\\${a}|\\${b}\\``)", () => {
    assert.match(paquetesTs, /function deduplicarProcedencia\(entradas: ProcedenciaNoche\[\]\): ProcedenciaNoche\[\] \{/);
    const posFn = paquetesTs.indexOf("function deduplicarProcedencia(");
    const posFnEnd = paquetesTs.indexOf("\n}", posFn);
    const cuerpoFn = paquetesTs.slice(posFn, posFnEnd);
    assert.match(cuerpoFn, /vistos = new Map<string, Map<boolean, Set<boolean>>>\(\);/, "clave estructurada anidada (temporada → esPromocion → Set de precioFinalAutoritativo), no un string concatenado");
    assert.doesNotMatch(cuerpoFn, /`\$\{.*\|.*\}`/, "no debe deduplicar concatenando un string tipo `${a}|${b}` — es ambiguo si un nombre de temporada trae '|' literal");
    assert.match(cuerpoFn, /e\.temporadaGanadora/);
    assert.match(cuerpoFn, /e\.esPromocion/);
    assert.match(cuerpoFn, /e\.precioFinalAutoritativo/);
  });

  test("la captura de procedencia vive DENTRO del loop de noches (fuera de cualquier `if (n === 0)`), para que aporten TODAS las noches, no solo la de check-in", () => {
    assert.match(paquetesTs, /const procedenciaCruda: ProcedenciaNoche\[\] = \[\];/);
    assert.match(paquetesTs, /procedencia: deduplicarProcedencia\(procedenciaCruda\),/);
    const posLoop = paquetesTs.indexOf("const procedenciaCruda: ProcedenciaNoche[] = [];");
    const posReturn = paquetesTs.indexOf("procedencia: deduplicarProcedencia(procedenciaCruda),");
    const cuerpoLoop = paquetesTs.slice(posLoop, posReturn);
    assert.doesNotMatch(cuerpoLoop, /if \(n === 0\)/, "la captura de procedencia no debe estar condicionada a la noche de check-in");
  });

  test("liquidarHotelMasBaratoConTemporada también devuelve `procedencia: ProcedenciaNoche[]` (la noche ganadora, deduplicada con la eventual entrada de noche gratis) — mismo contrato que la variante de fechas fijas", () => {
    assert.match(paquetesTs, /procedenciaCruda: ProcedenciaNoche\[\] = \[\s*\n\s*\{ temporadaGanadora: mejor\.temporadaGanadora, esPromocion: mejor\.esPromocion, precioFinalAutoritativo: mejor\.precioFinalAutoritativo \},\s*\n\s*\];/);
    assert.match(paquetesTs, /if \(nocheGratis\) procedenciaCruda\.push\(nocheGratis\.procedencia\);/);
  });
});

describe("promo_noche_gratis forma parte de la procedencia — resolverNocheGratisDetallado es la ÚNICA fuente, reusada por los 4 liquidadores", () => {
  test("resolverNocheGratisDetallado existe, devuelve `{ factor, procedencia }` con esPromocion:true/precioFinalAutoritativo:false ya armados — ningún llamador reconstruye esos booleanos a mano", () => {
    assert.match(paquetesTs, /export function resolverNocheGratisDetallado\(/);
    assert.match(paquetesTs, /\): \{ factor: number; procedencia: ProcedenciaNoche \} \| null \{/);
    assert.match(paquetesTs, /procedencia: \{ temporadaGanadora: top\.nombre, esPromocion: true, precioFinalAutoritativo: false \},/);
  });

  test("promoNocheGratisFactor es un envoltorio DELGADO sobre resolverNocheGratisDetallado — nunca vuelve a implementar la búsqueda/el criterio de selección", () => {
    const posFn = paquetesTs.indexOf("export function promoNocheGratisFactor(");
    assert.notEqual(posFn, -1);
    const posFnEnd = paquetesTs.indexOf("\n}", posFn);
    const cuerpoFn = paquetesTs.slice(posFn, posFnEnd);
    assert.match(cuerpoFn, /resolverNocheGratisDetallado\(temporadas, fechaIda, numNoches, hoy, regimen\)\?\.factor \?\? 1;/);
    assert.doesNotMatch(cuerpoFn, /entradasNoche\(/, "no debe volver a llamar entradasNoche directo — debe delegar TODO en resolverNocheGratisDetallado");
  });

  test("los 4 liquidadores (liquidarHotelNoches/liquidarHotelNochesConTemporadas/liquidarHotelMasBarato/liquidarHotelMasBaratoConTemporada) llaman a resolverNocheGratisDetallado — nunca a promoNocheGratisFactor ni reimplementan el criterio, así que cálculo y procedencia nunca pueden divergir", () => {
    // Excluye la propia declaración (`export function resolverNocheGratisDetallado(`).
    const ocurrencias = paquetesTs.match(/(?<!function )resolverNocheGratisDetallado\(/g) ?? [];
    // 1 en la propia definición de promoNocheGratisFactor (delegación) + 4 en
    // los liquidadores = 5 llamadas totales a la función.
    assert.equal(ocurrencias.length, 5, "debe haber exactamente 5 llamadas: 1 en promoNocheGratisFactor + 1 por cada uno de los 4 liquidadores");
    assert.doesNotMatch(paquetesTs, /liquidarHotelNoches\([^)]*\)[\s\S]{0,400}promoNocheGratisFactor\(/, "liquidarHotelNoches no debe llamar promoNocheGratisFactor (debe usar el resolver detallado directo)");
  });

  test("resolverNetoNocheDetallado sigue excluyendo explícitamente 'promo_noche_gratis' de la resolución noche-por-noche (no es un precio por noche, no cabe ahí)", () => {
    assert.match(paquetesTs, /filter\(\(t\) => \(t\.tipo \?\? "tarifa"\) !== "promo_noche_gratis"\)/);
  });
});

describe("Migración 180 — tarifario_resultado.temporada_ganadora/es_promocion/precio_final_autoritativo/procedencia_temporadas/procedencia_mixta", () => {
  test("agrega las 5 columnas (3 nullable + jsonb + boolean not null default false), sin backfill, idempotente", () => {
    assert.match(migracion180, /add column if not exists temporada_ganadora text/);
    assert.match(migracion180, /add column if not exists es_promocion boolean/);
    assert.match(migracion180, /add column if not exists precio_final_autoritativo boolean/);
    assert.match(migracion180, /add column if not exists procedencia_temporadas jsonb/);
    assert.match(migracion180, /add column if not exists procedencia_mixta boolean not null default false/);
  });

  test("explica el defecto de fecha_ida en Porción terrestre (masBarato) Y el defecto de persistir solo el check-in en estadías fijas, explícitamente en la cabecera", () => {
    assert.match(migracion180, /`fecha_ida` puede pertenecer a una temporada\s*\n?-- ?BASE/);
    assert.match(migracion180, /checkin/i);
  });

  test("procedencia_temporadas nunca serializa listas como texto — CHECK 1 exige jsonb_typeof = 'array'", () => {
    assert.match(migracion180, /tarifario_resultado_procedencia_es_arreglo_check/);
    assert.match(migracion180, /jsonb_typeof\(procedencia_temporadas\) = 'array'/);
  });

  test("CHECK 2 (elementos_validos) delega en la función helper _procedencia_temporadas_elementos_validos — nunca repite la validación inline en el CHECK de la tabla", () => {
    assert.match(migracion180, /tarifario_resultado_procedencia_elementos_validos_check/);
    assert.match(migracion180, /check \(\s*\n\s*public\._procedencia_temporadas_elementos_validos\(procedencia_temporadas\)\s*\n\s*\);/);
  });

  test("_procedencia_temporadas_elementos_validos valida objeto + temporada string no vacío (btrim) + es_promocion boolean + precio_final_autoritativo boolean — SOLO tras confirmar que es un arreglo (jsonb_array_elements nunca se llama sobre un no-arreglo)", () => {
    const posFn = migracion180.indexOf("create or replace function public._procedencia_temporadas_elementos_validos(");
    assert.notEqual(posFn, -1);
    const posFnEnd = migracion180.indexOf("$$;", posFn);
    const cuerpoFn = migracion180.slice(posFn, posFnEnd);
    assert.match(cuerpoFn, /language sql\s*\n\s*immutable/);
    assert.match(cuerpoFn, /when jsonb_typeof\(p\) <> 'array' then false/, "debe rechazar el no-arreglo ANTES de intentar iterar sus elementos");
    assert.match(cuerpoFn, /jsonb_array_elements\(p\) as elem/);
    assert.match(cuerpoFn, /jsonb_typeof\(elem\) is distinct from 'object'/);
    assert.match(cuerpoFn, /jsonb_typeof\(elem->'temporada'\) is distinct from 'string'/);
    assert.match(cuerpoFn, /btrim\(coalesce\(elem->>'temporada', ''\)\) = ''/);
    assert.match(cuerpoFn, /jsonb_typeof\(elem->'es_promocion'\) is distinct from 'boolean'/);
    assert.match(cuerpoFn, /jsonb_typeof\(elem->'precio_final_autoritativo'\) is distinct from 'boolean'/);
  });

  test("HALLAZGO CORREGIDO: las 4 comparaciones de tipo usan `IS DISTINCT FROM`, NUNCA `<>` — con una clave AUSENTE, `elem->'campo'` es SQL NULL, `jsonb_typeof(NULL)` es NULL, y `NULL <> 'tipo'` es NULL (no rechaza) mientras `NULL IS DISTINCT FROM 'tipo'` siempre es `true` (rechaza)", () => {
    const posFn = migracion180.indexOf("create or replace function public._procedencia_temporadas_elementos_validos(");
    const posFnEnd = migracion180.indexOf("$$;", posFn);
    const cuerpoFn = migracion180.slice(posFn, posFnEnd);
    assert.doesNotMatch(cuerpoFn, /jsonb_typeof\(elem\) <> 'object'/, "no debe quedar ninguna comparación de tipo con <> (produce NULL, no rechaza, con clave ausente)");
    assert.doesNotMatch(cuerpoFn, /jsonb_typeof\(elem->'temporada'\) <> 'string'/);
    assert.doesNotMatch(cuerpoFn, /jsonb_typeof\(elem->'es_promocion'\) <> 'boolean'/);
    assert.doesNotMatch(cuerpoFn, /jsonb_typeof\(elem->'precio_final_autoritativo'\) <> 'boolean'/);
    // El btrim de `temporada` también debe ser inmune a NULL por su cuenta
    // (defensa en profundidad, no debe depender de que la comparación de
    // tipo de arriba ya haya rechazado la clave ausente/JSON null).
    assert.doesNotMatch(cuerpoFn, /btrim\(elem->>'temporada'\) = ''/, "sin coalesce, btrim(NULL) = '' también es NULL (no rechaza) con clave ausente");
  });

  test("CHECK 3 (no_vacia): un arreglo `[]` no es ninguno de los 3 estados válidos — se rechaza, sin llamar jsonb_array_length sobre un no-arreglo", () => {
    assert.match(migracion180, /tarifario_resultado_procedencia_no_vacia_check/);
    const posFn = migracion180.indexOf("tarifario_resultado_procedencia_no_vacia_check");
    const cuerpo = migracion180.slice(posFn, posFn + 700);
    assert.match(cuerpo, /when jsonb_typeof\(procedencia_temporadas\) <> 'array' then true/, "debe dejar pasar el no-arreglo (lo cubre el CHECK 1) antes de llamar jsonb_array_length");
    assert.match(cuerpo, /jsonb_array_length\(procedencia_temporadas\) > 0/);
  });

  test("CHECK 4 (estado): delega en _tarifario_resultado_procedencia_valida — el estado-máquina completo de los 3 estados exactos (sin procedencia / uniforme / mixta), nunca duplicado inline", () => {
    assert.match(migracion180, /tarifario_resultado_procedencia_estado_check/);
    assert.match(migracion180, /check \(\s*\n\s*public\._tarifario_resultado_procedencia_valida\(\s*\n\s*temporada_ganadora, es_promocion, precio_final_autoritativo,\s*\n\s*procedencia_temporadas, procedencia_mixta\s*\n\s*\)\s*\n\s*\);/);
  });

  test("_tarifario_resultado_procedencia_valida: estado UNIFORME exige columnas planas pobladas Y EXACTAMENTE IGUALES al único objeto del arreglo (comparación jsonb=jsonb, nunca `::boolean` sobre texto que pudiera lanzar con datos malformados)", () => {
    const posFn = migracion180.indexOf("create or replace function public._tarifario_resultado_procedencia_valida(");
    assert.notEqual(posFn, -1);
    const posFnEnd = migracion180.indexOf("$$;", posFn);
    const cuerpoFn = migracion180.slice(posFn, posFnEnd);
    assert.match(cuerpoFn, /language sql\s*\n\s*immutable/);
    assert.match(cuerpoFn, /\(p_procedencia_temporadas->0->>'temporada'\) = p_temporada_ganadora/);
    assert.match(cuerpoFn, /\(p_procedencia_temporadas->0->'es_promocion'\) = to_jsonb\(p_es_promocion\)/);
    assert.match(cuerpoFn, /\(p_procedencia_temporadas->0->'precio_final_autoritativo'\) = to_jsonb\(p_precio_final_autoritativo\)/);
    assert.doesNotMatch(cuerpoFn, /::boolean/, "no debe castear texto a boolean — un cast sobre datos malformados podría lanzar en vez de simplemente rechazar");
  });

  test("_tarifario_resultado_procedencia_valida: estado MIXTA exige columnas planas en NULL (nunca una identidad representante elegida arbitrariamente), y el resultado se envuelve en `coalesce(..., false)` para que un NULL accidental NUNCA se trate como CHECK satisfecho", () => {
    const posFn = migracion180.indexOf("create or replace function public._tarifario_resultado_procedencia_valida(");
    const posFnEnd = migracion180.indexOf("$$;", posFn);
    const cuerpoFn = migracion180.slice(posFn, posFnEnd);
    assert.match(cuerpoFn, /p_procedencia_mixta = true\s*\n\s*and p_temporada_ganadora is null\s*\n\s*and p_es_promocion is null\s*\n\s*and p_precio_final_autoritativo is null/);
    assert.match(cuerpoFn, /select coalesce\(\s*\n\s*case/, "el resultado del case debe envolverse en coalesce(..., false) — Postgres trata un CHECK que da NULL como satisfecho");
  });

  test("todo `case` de las 2 funciones helper guarda jsonb_array_length/jsonb_array_elements DETRÁS de un `when jsonb_typeof(...) = 'array'` — nunca AND/OR sueltos (Postgres no garantiza su orden de evaluación, a diferencia de CASE)", () => {
    assert.doesNotMatch(migracion180, /procedencia_temporadas is not null and jsonb_array_length/, "no debe volver al patrón viejo (AND suelto) que puede evaluar jsonb_array_length sobre un no-arreglo");
    const ocurrenciasCase = migracion180.match(/\bcase\b/g) ?? [];
    assert.ok(ocurrenciasCase.length >= 3, "las funciones helper y el CHECK 3 deben usar CASE (no AND/OR) para garantizar el orden de evaluación");
  });

  test("las 4 constraints y las 2 funciones helper están guardadas/creadas de forma idempotente (pg_constraint filtrado por conrelid; create or replace function)", () => {
    const nombresConstraint = [
      "tarifario_resultado_procedencia_es_arreglo_check",
      "tarifario_resultado_procedencia_elementos_validos_check",
      "tarifario_resultado_procedencia_no_vacia_check",
      "tarifario_resultado_procedencia_estado_check",
    ];
    for (const nombre of nombresConstraint) {
      const regex = new RegExp(`where conname = '${nombre}'\\s*\\n\\s*and conrelid = 'public\\.tarifario_resultado'::regclass`);
      assert.match(migracion180, regex, `${nombre} debe estar guardado con conrelid`);
    }
    assert.match(migracion180, /create or replace function public\._procedencia_temporadas_elementos_validos\(p jsonb\)/);
    assert.match(migracion180, /create or replace function public\._tarifario_resultado_procedencia_valida\(/);
  });

  test("las funciones helper son `immutable`, nunca `security definer` (no tocan tablas, no hay privilegio que elevar)", () => {
    for (const nombreFn of ["_procedencia_temporadas_elementos_validos", "_tarifario_resultado_procedencia_valida"]) {
      const posFn = migracion180.indexOf(`create or replace function public.${nombreFn}(`);
      assert.notEqual(posFn, -1);
      const posFnEnd = migracion180.indexOf("$$;", posFn);
      const cuerpoFn = migracion180.slice(posFn, posFnEnd);
      assert.doesNotMatch(cuerpoFn, /security definer/, `${nombreFn} no debe ser security definer`);
    }
  });

  test("no contiene ningún INSERT/UPDATE de datos (sin backfill — solo columnas, funciones y constraints)", () => {
    assert.doesNotMatch(migracion180.toLowerCase(), /\binsert into\b/);
    assert.doesNotMatch(migracion180.toLowerCase(), /\bupdate public\.tarifario_resultado set\b/);
  });

  test("preflight/postcheck/rollback existen y referencian las 5 columnas", () => {
    for (const [nombre, contenido] of [["preflight", preflight180], ["postcheck", postcheck180], ["rollback", rollback180]] as const) {
      assert.match(contenido, /temporada_ganadora/, `${nombre} debe referenciar temporada_ganadora`);
      assert.match(contenido, /es_promocion/, `${nombre} debe referenciar es_promocion`);
      assert.match(contenido, /procedencia_temporadas/, `${nombre} debe referenciar procedencia_temporadas`);
      assert.match(contenido, /procedencia_mixta/, `${nombre} debe referenciar procedencia_mixta`);
    }
  });

  test("postcheck ejercita mutantes de los 4 CHECK dentro de begin/rollback, sobre una fila real existente — incluye JSON malformado, arreglo vacío y discrepancia JSON↔columnas planas", () => {
    assert.match(postcheck180, /begin;/);
    assert.match(postcheck180, /rollback;/);
    assert.match(postcheck180, /check_violation/);
    // JSON malformado: elemento no-objeto, tipo equivocado, string vacío.
    assert.match(postcheck180, /'\["BAJA"\]'::jsonb/, "debe probar un elemento que no es un objeto");
    assert.match(postcheck180, /"temporada":123/, "debe probar `temporada` de tipo numérico en vez de string");
    assert.match(postcheck180, /"temporada":"   "/, "debe probar `temporada` vacío después de btrim");
    assert.match(postcheck180, /"es_promocion":"true"/, "debe probar `es_promocion` como string en vez de boolean jsonb");
    // Arreglo vacío.
    assert.match(postcheck180, /'\[\]'::jsonb/, "debe probar procedencia_temporadas = []");
    // Discrepancia JSON↔columnas planas en el caso uniforme.
    assert.match(postcheck180, /temporada_ganadora = 'OTRA'/, "debe probar temporada_ganadora que no coincide con el único objeto del arreglo");
    assert.match(postcheck180, /es_promocion = true, precio_final_autoritativo = false\s*\n\s*where id = v_id;\s*\n\s*raise exception 'FALLO POSTCHECK: se aceptó es_promocion=true/, "debe probar es_promocion que no coincide con el único objeto del arreglo");
  });

  test("postcheck prueba arreglos MIXTOS (2 elementos) con el SEGUNDO elemento malformado — las 3 claves ausentes y las 3 mismas claves en JSON null (el hallazgo que motivó IS DISTINCT FROM: el CHECK de estado no inspecciona cada objeto del arreglo, solo el de elementos lo hace)", () => {
    // 3 claves ausentes en el segundo elemento de un arreglo de 2.
    assert.match(postcheck180, /'\[\{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false\},\{"es_promocion":true,"precio_final_autoritativo":false\}\]'::jsonb/, "debe probar un arreglo mixto con el segundo elemento sin `temporada`");
    assert.match(postcheck180, /'\[\{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false\},\{"temporada":"PROMO","precio_final_autoritativo":false\}\]'::jsonb/, "debe probar un arreglo mixto con el segundo elemento sin `es_promocion`");
    assert.match(postcheck180, /'\[\{"temporada":"BAJA","es_promocion":false,"precio_final_autoritativo":false\},\{"temporada":"PROMO","es_promocion":true\}\]'::jsonb/, "debe probar un arreglo mixto con el segundo elemento sin `precio_final_autoritativo`");
    // 3 claves en JSON null explícito en el segundo elemento.
    assert.match(postcheck180, /"temporada":null,"es_promocion":true,"precio_final_autoritativo":false/, "debe probar `temporada` en JSON null dentro de un arreglo mixto");
    assert.match(postcheck180, /"temporada":"PROMO","es_promocion":null,"precio_final_autoritativo":false/, "debe probar `es_promocion` en JSON null dentro de un arreglo mixto");
    assert.match(postcheck180, /"temporada":"PROMO","es_promocion":true,"precio_final_autoritativo":null/, "debe probar `precio_final_autoritativo` en JSON null dentro de un arreglo mixto");
  });

  test("postcheck también confirma que las 2 funciones helper existen, immutable y NUNCA security definer", () => {
    assert.match(postcheck180, /_procedencia_temporadas_elementos_validos/);
    assert.match(postcheck180, /_tarifario_resultado_procedencia_valida/);
    assert.match(postcheck180, /provolatile, prosecdef/);
  });

  test("rollback elimina primero los 4 constraints, luego las 2 funciones helper, y por último las 5 columnas (orden seguro — una función no se puede soltar mientras un CHECK la referencia)", () => {
    const posConstraints = rollback180.indexOf("drop constraint if exists tarifario_resultado_procedencia_estado_check");
    const posFunciones = rollback180.indexOf("drop function if exists public._tarifario_resultado_procedencia_valida");
    const posColumnas = rollback180.indexOf("drop column if exists procedencia_mixta");
    assert.notEqual(posConstraints, -1);
    assert.notEqual(posFunciones, -1);
    assert.notEqual(posColumnas, -1);
    assert.ok(posConstraints < posFunciones, "los constraints deben eliminarse antes que las funciones que referencian");
    assert.ok(posFunciones < posColumnas, "las funciones deben eliminarse antes que las columnas");
  });
});

describe("types/database.ts — tarifario_resultado declara temporada_ganadora/es_promocion/precio_final_autoritativo/procedencia_temporadas/procedencia_mixta", () => {
  test("Row y Insert declaran las 5 columnas (procedencia_mixta no-nullable, el resto nullable)", () => {
    const posTabla = types.indexOf("tarifario_resultado: {");
    const posSiguiente = types.indexOf("programas: {", posTabla);
    const bloque = types.slice(posTabla, posSiguiente);
    assert.match(bloque, /temporada_ganadora: string \| null;/);
    assert.match(bloque, /es_promocion: boolean \| null;/);
    assert.match(bloque, /precio_final_autoritativo: boolean \| null;/);
    assert.match(bloque, /procedencia_temporadas: Json \| null;/);
    assert.match(bloque, /procedencia_mixta: boolean;/);
    assert.match(bloque, /temporada_ganadora\?: string \| null;/);
    assert.match(bloque, /es_promocion\?: boolean \| null;/);
    assert.match(bloque, /precio_final_autoritativo\?: boolean \| null;/);
    assert.match(bloque, /procedencia_temporadas\?: Json \| null;/);
    assert.match(bloque, /procedencia_mixta\?: boolean;/);
  });
});

describe("Condiciones de BASE (DubaiBase) — motor + UI del editor de calculadora", () => {
  test("lib/calc/calculadoras.ts: DubaiBase declara condicionesPropias, y el bucle de bases[] lo escribe en `notas` de cada fila (notasBase, independiente de notasPromo)", () => {
    assert.match(calculadorasTs, /condicionesPropias\?: string;/);
    assert.match(calculadorasTs, /const notasBase = b\.condicionesPropias\?\.trim\(\) \|\| undefined;/);
    const posBucleBases = calculadorasTs.indexOf("for (const b of p.bases ?? []) {");
    const posBucleBasesEnd = calculadorasTs.indexOf("// Promociones:", posBucleBases);
    const cuerpoBases = calculadorasTs.slice(posBucleBases, posBucleBasesEnd);
    assert.match(cuerpoBases, /notas: notasBase,/);
    assert.doesNotMatch(cuerpoBases, /const notasPromo/, "el bucle de bases nunca debe DECLARAR ni leer la variable de condición de la promo (solo se menciona en un comentario explicativo)");
    assert.doesNotMatch(cuerpoBases, /notas: notasPromo/, "el bucle de bases nunca debe asignar notasPromo a una fila que genera");
  });

  test("CalculadoraEditor.tsx: el formulario de cada base incluye un campo de condición propia, guardado en basesExtra (misma clave categoria|temporada que el precio)", () => {
    assert.match(calculadoraEditor, /condicionesPropias: b\.condicionesPropias,/);
    assert.match(calculadoraEditor, /onChange=\{\(e\) => setBaseExtra\(clave, \{ condicionesPropias: e\.target\.value \}\)\}/);
  });
});

describe("Hallazgo 2 corregido — postcheck_179: la prueba de atomicidad del RPC corre bajo un contexto AUTENTICADO real, nunca bajo el bypass del superusuario", () => {
  test("simula la sesión con request.jwt.claims + set local role authenticated — mismo mecanismo que usa PostgREST/auth.uid()", () => {
    assert.match(postcheck179, /perform set_config\('request\.jwt\.claims', json_build_object\('sub', v_usuario_id::text, 'role', 'authenticated'\)::text, true\);/);
    assert.match(postcheck179, /execute 'set local role authenticated';/);
  });

  test("confirma que mi_rol() resuelve al rol esperado BAJO el contexto simulado antes de mandar el lote inválido — nunca asume que la simulación funcionó", () => {
    assert.match(postcheck179, /if coalesce\(public\.mi_rol\(\)::text, '<null>'\) <> v_rol then/);
  });

  test("usa un usuario REAL de `usuarios` (activo, rol permitido) — nunca un id inventado", () => {
    assert.match(postcheck179, /select id, rol::text into v_usuario_id, v_rol\s*\n\s*from public\.usuarios\s*\n\s*where activo and rol in \('superadmin', 'gerencia', 'administracion', 'operaciones'\)/);
  });

  test("HALLAZGO CORREGIDO: distingue EXPLÍCITAMENTE un rechazo por AUTORIZACIÓN de la prueba de la fila inválida — un rechazo por 'rol sin permiso' en la sección de atomicidad hace FALLAR el postcheck (nunca se acepta como si fuera la prueba)", () => {
    assert.match(postcheck179, /if v_mensaje like '%rol sin permiso%' then\s*\n\s*raise exception 'FALLO POSTCHECK: el RPC rechazó por AUTORIZACIÓN/);
  });

  test("espera específicamente check_violation — cualquier OTRO error (incluida la autorización) se reporta como FALLO, no como éxito", () => {
    assert.match(postcheck179, /when check_violation then\s*\n\s*v_abortado_por_check := true;/);
    assert.match(postcheck179, /when others then/);
  });
});

describe("Hallazgo 2 corregido — postcheck_179: rechazo de usuarios NO autorizados probado por SEPARADO (sección 7, no mezclado con la atomicidad)", () => {
  test("7a: usuario autenticado real con rol SIN permiso es rechazado", () => {
    assert.match(postcheck179, /where activo and rol not in \('superadmin', 'gerencia', 'administracion', 'operaciones'\)/);
    assert.match(postcheck179, /FALLO POSTCHECK 7a: el RPC NO rechazó a un usuario autenticado con rol sin permiso/);
  });

  test("7b: sesión con mi_rol()=NULL (usuario inexistente/borrado) es rechazada — prueba directa del fix de coalesce()", () => {
    assert.match(postcheck179, /v_usuario_fantasma\s+uuid := gen_random_uuid\(\); -- no existe en `usuarios`/);
    assert.match(postcheck179, /if public\.mi_rol\(\) is not null then/);
    assert.match(postcheck179, /FALLO POSTCHECK 7b: el RPC NO rechazó a una sesión con mi_rol\(\)=NULL/);
  });

  test("ambas secciones (6 y 7) terminan en ROLLBACK — ninguna deja datos ni configuración de sesión modificados", () => {
    const ocurrenciasRollback = postcheck179.match(/^rollback;$/gm) ?? [];
    assert.ok(ocurrenciasRollback.length >= 3, `se esperaban al menos 3 ROLLBACK (secciones 5, 6, 7) — encontrados: ${ocurrenciasRollback.length}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GUARDA DE REGRESIÓN — alcance de PR #302 recortado a lo acordado (fix/pr302-
// scope-cleanup): la procedencia Base/Promoción (migración 180) SOLO vive en
// administración (ArmadoClient.tsx/paquetes/actions.ts) y en persistencia
// (tarifario_resultado) — nunca en el tarifario público. Si alguien vuelve a
// agregar `precio_final_autoritativo`/`precioFinalTemporadas` a vigencia.ts, o
// reintroduce las 3 columnas de procedencia en COLUMNAS_DETALLE/FilaTarifario/
// VistaBooking (el badge público de identidad que se retiró), esta prueba
// debe fallar — es la única guarda dedicada a que ese alcance no reaparezca
// por accidente en un merge futuro.
// ─────────────────────────────────────────────────────────────────────────
describe("Guarda de regresión — procedencia Base/Promoción solo en administración, nunca en vigencia/tarifario público", () => {
  const vigenciaSrc = readFileSync(join(raiz, "lib/tarifario/vigencia.ts"), "utf8");
  const detalleActionsSrc = readFileSync(join(raiz, "app/tarifario/detalle-actions.ts"), "utf8");
  const tarifarioPublicSrc = readFileSync(join(raiz, "app/tarifario/TarifarioPublic.tsx"), "utf8");
  const vistaBookingSrc = readFileSync(join(raiz, "app/tarifario/VistaBooking.tsx"), "utf8");

  test("lib/tarifario/vigencia.ts no vuelve a filtrar por precio_final_autoritativo/precioFinalTemporadas", () => {
    assert.doesNotMatch(vigenciaSrc, /precio_final_autoritativo/, "vigencia.ts (público) no debe seleccionar ni usar precio_final_autoritativo");
    assert.doesNotMatch(vigenciaSrc, /precioFinalTemporadas/, "vigencia.ts (público) no debe construir ni propagar precioFinalTemporadas");
  });

  test("COLUMNAS_DETALLE (app/tarifario/detalle-actions.ts) no vuelve a exponer temporada_ganadora/es_promocion/procedencia_mixta", () => {
    const posColumnas = detalleActionsSrc.indexOf("COLUMNAS_DETALLE");
    assert.notEqual(posColumnas, -1, "no se encontró COLUMNAS_DETALLE");
    const posFinLista = detalleActionsSrc.indexOf(";", posColumnas);
    const bloque = detalleActionsSrc.slice(posColumnas, posFinLista);
    assert.doesNotMatch(bloque, /temporada_ganadora/, "COLUMNAS_DETALLE no debe seleccionar temporada_ganadora");
    assert.doesNotMatch(bloque, /es_promocion/, "COLUMNAS_DETALLE no debe seleccionar es_promocion");
    assert.doesNotMatch(bloque, /procedencia_mixta/, "COLUMNAS_DETALLE no debe seleccionar procedencia_mixta");
  });

  test("FilaTarifario (app/tarifario/TarifarioPublic.tsx) no vuelve a declarar temporada_ganadora/es_promocion/procedencia_mixta", () => {
    assert.doesNotMatch(tarifarioPublicSrc, /temporada_ganadora\?:/, "FilaTarifario no debe declarar temporada_ganadora");
    assert.doesNotMatch(tarifarioPublicSrc, /es_promocion\?:/, "FilaTarifario no debe declarar es_promocion");
    assert.doesNotMatch(tarifarioPublicSrc, /procedencia_mixta\?:/, "FilaTarifario no debe declarar procedencia_mixta");
  });

  test("VistaBooking.tsx no vuelve a traer el badge público de identidad (IdentidadTemporadaBadge/mixta_estadia/mixta_acomodacion/textos)", () => {
    assert.doesNotMatch(vistaBookingSrc, /IdentidadTemporadaBadge/, "VistaBooking.tsx no debe declarar/renderizar IdentidadTemporadaBadge");
    assert.doesNotMatch(vistaBookingSrc, /mixta_estadia/, "VistaBooking.tsx no debe distinguir el caso mixta_estadia");
    assert.doesNotMatch(vistaBookingSrc, /mixta_acomodacion/, "VistaBooking.tsx no debe distinguir el caso mixta_acomodacion");
    assert.doesNotMatch(vistaBookingSrc, /Varias tarifas durante la estadía/, "VistaBooking.tsx no debe mostrar el texto público de mezcla dentro de la estadía");
    assert.doesNotMatch(vistaBookingSrc, /Varias tarifas según acomodación/, "VistaBooking.tsx no debe mostrar el texto público de mezcla entre acomodaciones");
    assert.doesNotMatch(vistaBookingSrc, /Promoción · \$\{temporada\}/, "VistaBooking.tsx no debe mostrar el texto público 'Promoción · <temporada>'");
    assert.doesNotMatch(vistaBookingSrc, /"Tarifa base"/, "VistaBooking.tsx no debe mostrar el texto público 'Tarifa base'");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// HOTFIX — `null value in column "procedencia_mixta" ... violates not-null
// constraint` en producción. Causa: el `.insert(filas)` de generarTarifario
// es UN SOLO lote heterogéneo (filas de hotel + filas de servicio). Las
// filas de hotel llenan las 5 columnas de procedencia desde
// `columnasProcedencia(...)`, pero el objeto `comun` de las filas de
// servicio no las declaraba — en Postgres, una columna AUSENTE en una fila
// de un insert multi-fila no cae al DEFAULT de la tabla (eso solo aplica
// col-por-col cuando el INSERT no la menciona en absoluto para NINGUNA
// fila); con otras filas del mismo INSERT sí mencionándola, PostgREST la
// serializa como NULL para las filas que no la traen. La migración 180 puso
// `procedencia_mixta` NOT NULL — nunca se pensó para un insert heterogéneo
// hotel+servicio en el mismo lote.
// ─────────────────────────────────────────────────────────────────────────
describe("HOTFIX — filas de servicio en generarTarifario declaran las 5 columnas de procedencia (nunca ausentes en el insert heterogéneo)", () => {
  test("el objeto `comun` de las filas de servicio fija explícitamente las 5 columnas (procedencia_mixta: false; las otras 4 en null)", () => {
    const posComun = paquetesActions.indexOf("const comun = {");
    assert.notEqual(posComun, -1, "no se encontró el objeto `comun` de las filas de servicio");
    const posCierre = paquetesActions.indexOf("};", posComun);
    const cuerpoComun = paquetesActions.slice(posComun, posCierre);
    assert.match(cuerpoComun, /temporada_ganadora: null,/);
    assert.match(cuerpoComun, /es_promocion: null,/);
    assert.match(cuerpoComun, /precio_final_autoritativo: null,/);
    assert.match(cuerpoComun, /procedencia_temporadas: null,/);
    assert.match(cuerpoComun, /procedencia_mixta: false,/);
  });

  test("las dos filas de servicio (`filas.push({ ...comun, ... })`, modo grupo y modo persona) heredan las 5 columnas por spread de `comun` — ninguna las sobreescribe", () => {
    const pushesServicio = paquetesActions.match(/filas\.push\(\{ \.\.\.comun,[^}]*\}\);/g) ?? [];
    assert.equal(pushesServicio.length, 2, "deben existir exactamente 2 `filas.push({ ...comun, ... })` (modo grupo y modo persona)");
    for (const push of pushesServicio) {
      for (const col of ["temporada_ganadora", "es_promocion", "precio_final_autoritativo", "procedencia_temporadas", "procedencia_mixta"]) {
        assert.doesNotMatch(push, new RegExp(`\\b${col}\\s*:`), `el push de servicio no debe sobreescribir ${col} (debe heredarlo tal cual de \`comun\`)`);
      }
    }
  });

  test("la fila de hotel (`filas.push({ ... })` fuera del spread de comun) sigue llenando las 5 columnas desde `columnasProcedencia`, no desde un literal fijo", () => {
    const posPushHotel = paquetesActions.indexOf("filas.push({", paquetesActions.indexOf("procedencia = columnasProcedencia"));
    assert.notEqual(posPushHotel, -1, "no se encontró el push de la fila de hotel");
    const posCierre = paquetesActions.indexOf("});", posPushHotel);
    const cuerpoPush = paquetesActions.slice(posPushHotel, posCierre);
    assert.match(cuerpoPush, /temporada_ganadora: procedencia\.temporada_ganadora,/);
    assert.match(cuerpoPush, /procedencia_mixta: procedencia\.procedencia_mixta,/);
  });
});
