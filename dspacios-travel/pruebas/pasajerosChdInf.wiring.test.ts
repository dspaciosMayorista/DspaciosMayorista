import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// GUARDA CONTRA LA DIVERGENCIA — pendiente CHD/INF en inventario de vuelos.
//
// Antes de este cambio existían TRES criterios distintos y no sincronizados
// para decidir "es infante"/"consume silla" en los puntos donde se crean o
// editan pasajeros de un contrato:
//   1. Posicional/por conteo (ReservaForm.tsx/ProgramaReservaForm.tsx):
//      `esInfante: idx >= cortePax` — nunca mira la fecha de nacimiento.
//   2. Manual (NuevoContratoForm.tsx): checkbox "Es infante" tal cual lo
//      manda el cliente.
//   3. Por edad real (editar-contrato-actions.ts, ya existía): la única
//      correcta, pero nunca se propagó a los flujos de creación.
// Y dos motores de conteo de "pax que ocupan silla" totalmente
// independientes: `lib/reservar/computo.ts` (paxConSilla) y
// `contratos/actions.ts` (holders.length || pax) — cada uno con su propio
// `!esInfante` inline.
//
// `lib/reservar/pasajeros.ts` es ahora la fuente de verdad única. Estas
// comprobaciones miran el CÓDIGO FUENTE de cada punto de creación/edición de
// pasajeros: no demuestran que el cálculo sea correcto (de eso se encargan
// las pruebas de comportamiento en reservarPasajeros.test.ts), sino que
// todos siguen decidiendo por el mismo sitio y que el criterio viejo
// (checkbox/flag del cliente sin recalcular, o un `!esInfante`/`!p.esInfante`
// inline reintroducido) no vuelve a colarse silenciosamente.
// ───────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

// `editar-contrato-actions.ts` YA NO está en esta lista: tras la revisión de
// alto riesgo (B3), delegó todo el cálculo (es_infante, vínculo responsable,
// reconciliación de sillas) al RPC `guardar_pasajeros_contrato` — no importa
// `esInfantePorEdad`/`pasajeroConsumeSilla` directamente. Ver las pruebas
// dedicadas más abajo.
const ARCHIVOS_ESCRITURA = [
  "app/(dashboard)/dashboard/reservar/actions.ts",
  "app/(dashboard)/dashboard/contratos/actions.ts",
];

for (const archivo of ARCHIVOS_ESCRITURA) {
  test(`${archivo} importa la fuente de verdad compartida de pasajeros/sillas`, () => {
    const src = leer(archivo);
    assert.match(
      src,
      /import\s*\{[^}]*esInfantePorEdad[^}]*\}\s*from\s*["']@\/lib\/reservar\/pasajeros["']/,
      "no importa esInfantePorEdad desde lib/reservar/pasajeros"
    );
    assert.match(
      src,
      /import\s*\{[^}]*pasajeroConsumeSilla[^}]*\}\s*from\s*["']@\/lib\/reservar\/pasajeros["']/,
      "no importa pasajeroConsumeSilla desde lib/reservar/pasajeros"
    );
  });

  test(`${archivo} recalcula es_infante con esInfantePorEdad y lo pasa al RPC de creación`, () => {
    const src = leer(archivo);
    assert.match(src, /esInfantePorEdad\(/, "no llama esInfantePorEdad");
    // Segunda revisión de alto riesgo (B1/B5): la creación YA NO inserta
    // contrato_pasajeros directamente (eso era, precisamente, el hueco que
    // dejaba colar infantes sin responsable) — pasa por crear_pasajeros_
    // contrato, que recalcula es_infante server-side en SQL.
    assert.match(src, /admin\.rpc\(\s*["']crear_pasajeros_contrato["']/, "no llama al RPC atómico crear_pasajeros_contrato");
  });

  test(`${archivo} decide sillas con pasajeroConsumeSilla, no con !esInfante/!p.esInfante inline`, () => {
    const src = leer(archivo);
    assert.match(src, /pasajeroConsumeSilla\(/, "no llama pasajeroConsumeSilla para filtrar holders");
    // El defecto original exacto: filtrar holders con la negación directa del
    // flag del cliente en vez de con el resultado recalculado server-side.
    assert.doesNotMatch(
      src,
      /filter\(\s*\(?p\)?\s*=>\s*!p\.esInfante\s*\)/,
      "volvió el filtro `!p.esInfante` sin pasar por pasajeroConsumeSilla"
    );
  });

  test(`${archivo} construye el payload de creación con payloadGuardarPasajeros (incluye responsableIndex)`, () => {
    const src = leer(archivo);
    assert.match(
      src,
      /import\s*\{[^}]*payloadGuardarPasajeros[^}]*\}\s*from\s*["']@\/lib\/reservar\/pasajerosEdicion["']/,
      "no importa payloadGuardarPasajeros para construir el payload de creación"
    );
    assert.match(src, /responsableIndex:\s*p\.responsableIndex\s*\?\?\s*null/, "no propaga responsableIndex al payload del RPC");
  });
}

test("reservar/actions.ts: reservarDesdeTarifarioInterno y reservarProgramaInterno ya NO insertan contrato_pasajeros directo (solo crear_pasajeros_contrato)", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const inicioReservar = src.indexOf("async function reservarDesdeTarifarioInterno");
  const finReservar = src.indexOf("export async function crearCotizacion");
  const bloqueReservar = src.slice(inicioReservar, finReservar);
  assert.ok(inicioReservar > 0 && finReservar > inicioReservar, "no delimitó reservarDesdeTarifarioInterno");
  assert.doesNotMatch(
    bloqueReservar,
    /await sb\.from\(\s*["']contrato_pasajeros["']\s*\)\s*\.insert\(/,
    "reservarDesdeTarifarioInterno volvió a insertar contrato_pasajeros directo — se salta la autoridad SQL del vínculo responsable"
  );

  const inicioPrograma = src.indexOf("async function reservarProgramaInterno");
  const finPrograma = src.length;
  const bloquePrograma = src.slice(inicioPrograma, finPrograma);
  assert.ok(inicioPrograma > 0, "no delimitó reservarProgramaInterno");
  assert.doesNotMatch(
    bloquePrograma,
    /await (sb|admin)\.from\(\s*["']contrato_pasajeros["']\s*\)\s*\.insert\(/,
    "reservarProgramaInterno volvió a insertar contrato_pasajeros directo — se salta la autoridad SQL del vínculo responsable"
  );

  // Residual documentado (fuera de alcance): convertirCotizacionCarrito SÍ
  // sigue insertando contrato_pasajeros directo (un solo numero_contrato no
  // puede representar más de un bloqueo_ref_id) — pero rechaza infantes con
  // mensaje claro ANTES de insertar (ver prueba dedicada más abajo).
});

test("reservar/actions.ts: convertirCotizacionCarrito crea pasajeros+responsables+sillas de TODOS los bloqueos del grupo en UNA sola llamada atómica (B6, ronda 3)", () => {
  // Ronda 3 (B6): el hard-block "este checkout todavía no admite infantes"
  // era una regresión real frente a los otros 3 flujos de creación (todos
  // migrados a un RPC atómico en la ronda anterior) — este carrito puede
  // agrupar VARIOS ítems tipo bloqueo (records de vuelo distintos) bajo un
  // mismo numero_contrato, algo que `crear_pasajeros_contrato` (un solo
  // bloqueo) no podía cubrir. `crear_pasajeros_contrato_multi` generaliza
  // el mismo núcleo a varios bloqueos EXPLÍCITOS (nunca los descubre) — ver
  // supabase/migrations/20260601000167_contrato_pasajero_responsable_
  // infante.sql, sección E.
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const inicio = src.indexOf("export async function convertirCotizacionCarrito");
  const bloque = src.slice(inicio, src.indexOf("export async function actualizarVigenciaCotizacion"));
  assert.ok(inicio > 0, "no delimitó convertirCotizacionCarrito");

  assert.doesNotMatch(
    bloque,
    /todavía no admite pasajeros infantes/,
    "el hard-block que rechazaba cualquier infante sigue presente — regresión frente a los otros 3 flujos de creación"
  );
  assert.doesNotMatch(
    bloque,
    /await sb\.from\("contrato_pasajeros"\)\.insert\(/,
    "sigue insertando contrato_pasajeros directo en vez de por el RPC atómico"
  );
  assert.match(
    bloque,
    /admin\.rpc\(\s*["']crear_pasajeros_contrato_multi["']/,
    "no llama al RPC atómico multi-bloqueo crear_pasajeros_contrato_multi"
  );
  // El payload de reservas de sillas debe declarar cada bloqueoId EXPLÍCITO
  // (nunca descubrirlo) — mismo criterio que el resto de la migración 167.
  assert.match(bloque, /bloqueoId:\s*v\.item\.bloqueoId/, "no arma bloqueoId explícito por ítem de bloqueo");
  assert.match(bloque, /holdersMin:\s*v\.comp\.paxConSilla/, "no arma el piso de sillas (holdersMin) desde la composición ya validada");
  assert.match(bloque, /posiciones:/, "no arma las posiciones (1-based) de cada reserva de sillas");

  // Sin usuario real y activo, la creación debe fallar ANTES de crear
  // ningún contrato — mismo candado que crear_pasajeros_contrato de un
  // solo bloqueo (nunca queda una creación "sin autor").
  const idxGuardia = bloque.indexOf("usuarioCond");
  const idxLoopGrupos = bloque.indexOf("for (const { grupo, validados } of gruposValidados)");
  assert.match(bloque, /if\s*\(!usuarioCond\)\s*\{\s*\n\s*return \{ ok: false, error:/, "no exige un usuario real antes de crear los contratos");
  assert.ok(idxGuardia > 0 && idxLoopGrupos > idxGuardia, "la guardia de usuario real debe ir ANTES del loop de creación de contratos");
});

test("reservar/actions.ts: convertirCotizacionCarrito normaliza responsableIndex por GRUPO antes de armar el payload (B10, ronda 3)", () => {
  // La UI (ConvertirCarritoBtn.tsx) usa una fecha de referencia conservadora
  // (la más temprana de TODO el carrito) para decidir quién es infante y
  // capturar su responsable — la fecha REAL de un grupo/contrato específico
  // puede ser posterior, y la edad de un pasajero solo AVANZA con una fecha
  // posterior. Un `responsableIndex` capturado para alguien que YA DEJÓ de
  // ser infante para la fecha real de ESTE grupo quedaría "sobrante" — el
  // propio trigger de la 167 lo rechazaría con un mensaje que no describe
  // el problema real. `normalizarResponsablesPorGrupo` debe limpiarlo ANTES
  // de construir el payload de cada grupo.
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  assert.match(
    src,
    /import\s*\{[^}]*normalizarResponsablesPorGrupo[^}]*\}\s*from\s*["']@\/lib\/reservar\/pasajerosFilas["']/,
    "no importa normalizarResponsablesPorGrupo desde el módulo puro compartido"
  );
  const inicio = src.indexOf("export async function convertirCotizacionCarrito");
  const bloque = src.slice(inicio, src.indexOf("export async function actualizarVigenciaCotizacion"));
  const idxFechaRef = bloque.indexOf("fechaRefGrupo");
  const idxNormaliza = bloque.indexOf("normalizarResponsablesPorGrupo(opts.pasajeros, fechaRefGrupo)");
  const idxPayload = bloque.indexOf("payloadGuardarPasajeros(");
  const idxRpcMulti = bloque.indexOf('admin.rpc("crear_pasajeros_contrato_multi"');
  assert.ok(idxFechaRef > 0, "no calcula fechaRefGrupo (la fecha real de este grupo)");
  assert.ok(idxNormaliza > 0, "no llama normalizarResponsablesPorGrupo con la fecha real de este grupo");
  assert.ok(idxNormaliza < idxPayload && idxPayload < idxRpcMulti, "la normalización debe ocurrir ANTES de armar el payload y ANTES de llamar al RPC");
});

test("reservar/actions.ts: convertirCotizacionCarrito valida `opts.asignaciones` explícita por ítem — nunca adivina por posición/conteo (B11, ronda 3)", () => {
  // El carrito (lib/cart/CartContext.tsx) agrega cada ítem de forma
  // INDEPENDIENTE, cada uno con su propio `pax` — dos ítems pueden
  // representar grupos de viajeros distintos. Antes, cada ítem usaba
  // SIEMPRE el prefijo 1..item.pax de `opts.pasajeros` — una suposición
  // nunca demostrada. Ahora el llamador declara explícitamente qué
  // posiciones corresponden a cada ítem.
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  assert.doesNotMatch(
    src,
    /pasajeros:\s*opts\.pasajeros\.slice\(0,\s*it\.pax/,
    "sigue usando un prefijo adivinado por conteo (opts.pasajeros.slice(0, it.pax)) en vez de la asignación explícita"
  );
  const inicio = src.indexOf("export async function convertirCotizacionCarrito");
  const bloque = src.slice(inicio, src.indexOf("export async function actualizarVigenciaCotizacion"));
  assert.match(bloque, /asignaciones:\s*number\[\]\[\]/, "opts ya no declara `asignaciones` (una entrada por ítem)");
  assert.match(bloque, /opts\.asignaciones\.length\s*!==\s*itemsCrudos\.length/, "no valida que asignaciones tenga una entrada por ítem");
  assert.match(bloque, /__posiciones/, "no propaga las posiciones asignadas por ítem (__posiciones)");
  assert.match(
    bloque,
    /pasajeros:\s*it\.__posiciones\.map\(\(pos\)\s*=>\s*opts\.pasajeros\[pos\s*-\s*1\]\)/,
    "computarReserva por ítem debe usar EXACTAMENTE las posiciones asignadas, no un prefijo"
  );
  // Sin duplicados DENTRO del mismo ítem (asignar la misma persona dos veces
  // a un solo ítem contaría dos sillas para ella).
  assert.match(bloque, /un mismo pasajero está asignado dos veces al mismo ítem/, "no rechaza posiciones repetidas dentro del mismo ítem");
});

test("migración 167: crear_pasajeros_contrato_multi rechaza una posición repetida DENTRO de la misma reserva de bloqueo (B11, ronda 3)", () => {
  const src = leer("supabase/migrations/20260601000167_contrato_pasajero_responsable_infante.sql");
  assert.match(
    src,
    /if v_pos = any\(v_pos_vistos\) then\s*\n\s*raise exception 'La posición % aparece repetida dentro de la misma reserva de sillas\.'/,
    "no rechaza una posición repetida dentro de la misma entrada de p_reservas_sillas"
  );
});

test("reservar/actions.ts no vuelve a confiar en el esInfante posicional del cliente para holders", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  // El patrón viejo (input.pasajeros.filter((p) => !p.esInfante)) filtraba
  // directo sobre el flag que manda el formulario, sin recalcular por edad.
  assert.doesNotMatch(
    src,
    /input\.pasajeros\.filter\(\s*\(?p\)?\s*=>\s*!p\.esInfante\s*\)/,
    "reintrodujo el filtro de holders sobre el flag del cliente sin recalcular"
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Revisión de alto riesgo — B3: `actualizarPasajerosContrato` dejó de hacer
// DELETE+INSERT+N UPDATE+1 llamada RPC aparte (4+ viajes de red, sin
// atomicidad real) y pasó a delegar TODO en una única llamada al RPC
// `guardar_pasajeros_contrato` (migración 167) — recalcular es_infante,
// exigir/validar el vínculo responsable, y reconciliar sillas viven ahora en
// SQL, dentro de una sola transacción implícita. Estas pruebas verifican que
// la acción TS es un delgado traductor de forma (PasajeroEdit[] → jsonb) y
// NUNCA vuelve a reimplementar esa lógica en JavaScript.
// ───────────────────────────────────────────────────────────────────────────
test("editar-contrato-actions.ts delega TODO en una sola llamada a guardar_pasajeros_contrato", () => {
  const src = leer("app/(dashboard)/dashboard/contratos/[numero]/editar-contrato-actions.ts");
  assert.match(
    src,
    /import\s*\{[^}]*payloadGuardarPasajeros[^}]*\}\s*from\s*["']@\/lib\/reservar\/pasajerosEdicion["']/,
    "no importa payloadGuardarPasajeros desde lib/reservar/pasajerosEdicion"
  );
  assert.match(
    src,
    /sb\.rpc\(\s*["']guardar_pasajeros_contrato["']/,
    "no llama al RPC guardar_pasajeros_contrato"
  );
  // El defecto original exacto (B3): reemplazo manual en varios pasos.
  assert.doesNotMatch(src, /\.from\(\s*["']contrato_pasajeros["']\s*\)\s*\.delete\(/, "volvió a hacer DELETE manual de contrato_pasajeros");
  assert.doesNotMatch(src, /\.from\(\s*["']contrato_pasajeros["']\s*\)\s*\.insert\(/, "volvió a hacer INSERT manual de contrato_pasajeros");
  assert.doesNotMatch(src, /\.from\(\s*["']contrato_pasajeros["']\s*\)\s*\.update\(\s*\{\s*responsable_id/, "volvió a actualizar responsable_id manualmente en vez de dejarlo al RPC");
  assert.doesNotMatch(
    src,
    /sb\.rpc\(\s*["']ajustar_sillas_por_pasajeros["']/,
    "volvió a llamar ajustar_sillas_por_pasajeros por separado — eso rompe la atomicidad de un solo guardado"
  );
});

test("editar-contrato-actions.ts remapea responsableIndex al descartar filas vacías (no desincroniza posiciones)", () => {
  const src = leer("app/(dashboard)/dashboard/contratos/[numero]/editar-contrato-actions.ts");
  assert.match(src, /nuevaPosicionPorOriginal/, "no remapea responsableIndex tras filtrar filas vacías");
  assert.match(src, /filasRemapeadas/, "no usa las filas remapeadas para construir el payload");
});

// ───────────────────────────────────────────────────────────────────────────
// El vínculo INF→responsable, su obligatoriedad (con excepción de abuelo
// para históricos) y la validación "no puede ser infante/no puede ser un
// CHD/debe ser mayor de edad" ahora viven en SQL (migración 167:
// guardar_pasajeros_contrato + fn_validar_responsable_infante) — se
// verifican con pruebas de EJECUCIÓN REAL en
// supabase/scripts/postcheck_167_contrato_pasajero_responsable.sql, no con
// regex sobre TypeScript.
// ───────────────────────────────────────────────────────────────────────────
test("migración 167: responsable_id es ON DELETE RESTRICT (nunca se puede des-vincular un infante en silencio borrando al adulto)", () => {
  const src = leer("supabase/migrations/20260601000167_contrato_pasajero_responsable_infante.sql");
  assert.match(src, /responsable_id\s+bigint\s+references\s+public\.contrato_pasajeros\(id\)\s+on\s+delete\s+restrict/i, "responsable_id ya no es ON DELETE RESTRICT");
  assert.doesNotMatch(src, /responsable_id\s+bigint\s+references\s+public\.contrato_pasajeros\(id\)\s+on\s+delete\s+set\s+null/i, "volvió ON DELETE SET NULL — permite orfandad silenciosa del vínculo");
});

test("migración 167: el trigger exige mayoría de edad real del responsable, no solo 'no ser infante' (un CHD tampoco puede ser responsable)", () => {
  const src = leer("supabase/migrations/20260601000167_contrato_pasajero_responsable_infante.sql");
  assert.match(src, /edad_anios\(v_resp\.fecha_nacimiento,\s*v_fecha_ref\)/, "el trigger no calcula la edad real del responsable");
  assert.match(src, /v_edad_resp\s*<\s*18/, "el trigger no exige mayoría de edad (18) del responsable");
});

test("migración 167: ajustar_sillas_por_pasajeros no repite la lista de roles ya codificada en puede_ver_contrato", () => {
  const src = leer("supabase/migrations/20260601000167_contrato_pasajero_responsable_infante.sql");
  assert.doesNotMatch(
    src,
    /mi_rol\(\)\s*not\s*in\s*\(\s*'superadmin'/,
    "volvió el array hardcodeado de roles — puede_ver_contrato() ya decide ese conjunto"
  );
});

test("migración 167 (segunda revisión de alto riesgo): la creación usa crear_pasajeros_contrato (service_role) que exige un actor real, no un rol interno", () => {
  const src = leer("supabase/migrations/20260601000167_contrato_pasajero_responsable_infante.sql");
  assert.match(src, /create or replace function public\.crear_pasajeros_contrato/, "no existe el wrapper de creación");
  assert.match(src, /grant execute on function public\.crear_pasajeros_contrato\([^)]*\)\s*to\s*service_role;/, "crear_pasajeros_contrato no está limitado a service_role");
  assert.doesNotMatch(
    src,
    /grant execute on function public\.crear_pasajeros_contrato\([^)]*\)\s*to\s*authenticated;/,
    "crear_pasajeros_contrato no debe ser invocable directo por una sesión autenticada normal"
  );
  // El viejo asignar_sillas_creacion (solo sillas) queda absorbido: ahora un
  // solo RPC hace pasajeros+responsables+sillas juntos (cierra B5).
  assert.doesNotMatch(src, /public\.asignar_sillas_creacion/, "quedó un rastro del wrapper viejo (solo sillas), ya reemplazado por crear_pasajeros_contrato");
});

test("migración 167 (segunda revisión de alto riesgo — B1): fn_validar_responsable_infante rechaza SIEMPRE un infante nuevo sin responsable, salvo un id congelado en _pasajeros_exentos_167", () => {
  const src = leer("supabase/migrations/20260601000167_contrato_pasajero_responsable_infante.sql");
  assert.match(
    src,
    /if coalesce\(new\.es_infante, false\) and new\.responsable_id is null then/,
    "el trigger no distingue el caso infante+sin responsable como el que debe rechazar"
  );
  assert.match(
    src,
    /select exists\(\s*\n\s*select 1 from public\._pasajeros_exentos_167 e where e\.pasajero_id = new\.id\s*\n\s*\) into v_exento;/,
    "el trigger no consulta la foto congelada de exención"
  );
  assert.match(src, /raise exception 'Todo infante debe tener un adulto responsable vinculado\.';/, "el trigger no rechaza con un mensaje claro");
});

test("migración 167 (B1): _pasajeros_exentos_167 es una foto INMUTABLE — sin GRANT de escritura para ningún rol de aplicación", () => {
  const src = leer("supabase/migrations/20260601000167_contrato_pasajero_responsable_infante.sql");
  assert.match(src, /create table if not exists public\._pasajeros_exentos_167/, "no existe la tabla de exención histórica");
  assert.match(
    src,
    /revoke all on public\._pasajeros_exentos_167 from public, anon, authenticated, service_role;/,
    "la foto de exención sigue teniendo GRANT para algún rol de aplicación — un INSERT nuevo podría auto-exentarse"
  );
  // Se llena UNA sola vez, a partir de lo que YA existía al aplicar la
  // migración — nunca desde un valor que decida la aplicación en caliente.
  assert.match(
    src,
    /insert into public\._pasajeros_exentos_167 \(pasajero_id\)\s*\nselect id from public\.contrato_pasajeros\s*\n where coalesce\(es_infante, false\) and responsable_id is null/,
    "el snapshot no se llena desde el estado real de contrato_pasajeros al aplicar la migración"
  );
});

test("migración 167 (B1): guardar_pasajeros_contrato/crear_pasajeros_contrato comparten un solo núcleo transaccional (_guardar_pasajeros_nucleo) — nunca reimplementan la validación dos veces", () => {
  const src = leer("supabase/migrations/20260601000167_contrato_pasajero_responsable_infante.sql");
  assert.match(src, /create or replace function public\._guardar_pasajeros_nucleo/, "no existe el núcleo compartido");
  assert.match(
    src,
    /return query select \* from public\._guardar_pasajeros_nucleo\(p_numero_contrato, p_pasajeros, 0, 1, null\);/,
    "guardar_pasajeros_contrato (edición) no delega en el núcleo compartido"
  );
  assert.match(
    src,
    /return query select \* from public\._guardar_pasajeros_nucleo\(p_numero_contrato, p_pasajeros, p_holders_min, 0, p_usuario_id\);/,
    "crear_pasajeros_contrato (creación) no delega en el núcleo compartido"
  );
  assert.match(src, /revoke all on function public\._guardar_pasajeros_nucleo/, "el núcleo compartido debe estar bloqueado para toda sesión externa");
});

test("migración 167 (B1/B3): el reemplazo de pasajeros hace DOS PASADAS (no-infantes primero, luego infantes con responsable_id ya resuelto) — nunca un null transitorio con blanket-clear", () => {
  const src = leer("supabase/migrations/20260601000167_contrato_pasajero_responsable_infante.sql");
  // El diseño anterior limpiaba responsable_id de TODAS las filas antes de
  // borrar/insertar — eso obligaba al trigger a aceptar null sin condición
  // (el propio hueco de B1). Ya no debe existir ese paso.
  assert.doesNotMatch(
    src,
    /update public\.contrato_pasajeros set responsable_id = null where numero_contrato = p_numero_contrato;/,
    "volvió el blanket-clear de responsable_id — reintroduce la necesidad de que el trigger acepte null sin condición"
  );
  assert.match(src, /if v_es_infante\[v_i\] then continue; end if;/, "no existe la pasada de no-infantes (salta infantes)");
  assert.match(src, /if not v_es_infante\[v_i\] then continue; end if;/, "no existe la pasada de infantes (salta no-infantes)");
  // El DELETE va al final y excluye por `v_orden_a_id` (ids FINALES, ya
  // incluyendo los recién insertados) — nunca por `v_ids_mantener` (solo los
  // que ya existían), que borraría las filas recién creadas en el mismo guardado.
  assert.match(
    src,
    /delete from public\.contrato_pasajeros\s*\n\s*where contrato_pasajeros\.numero_contrato = p_numero_contrato\s*\n\s*and not \(contrato_pasajeros\.id = any\(v_orden_a_id\)\);/,
    "el DELETE final no excluye por v_orden_a_id (los ids ya resueltos, incluidos los nuevos)"
  );
});

test("migración 167 (B5): p_holders_min es un PISO — nunca reserva menos que la composición declarada, ni menos que los pasajeros reales no-infante del payload", () => {
  const src = leer("supabase/migrations/20260601000167_contrato_pasajero_responsable_infante.sql");
  assert.match(
    src,
    /v_holders_final := greatest\(coalesce\(p_holders_min, 0\), v_holders_reales\);/,
    "el piso de sillas ya no es GREATEST(p_holders_min, holders reales) — puede volver a sub-reservar"
  );
});

test("EditarAsesorPasajeros.tsx reindexa responsableIndex al quitar una fila (usa la operación pura compartida, no lógica inline duplicada)", () => {
  // Ronda 3 (B7): la reindexación/limpieza de vínculos se centralizó en
  // `lib/reservar/pasajerosFilas.ts` (con pruebas de ejecución real propias
  // en `pruebas/pasajerosFilas.test.ts`) para que los 4 formularios que
  // capturan pasajeros compartan la MISMA lógica en vez de reimplementarla
  // cada uno (el bug original de B7 era justo eso: `NuevoContratoForm.tsx`
  // ni siquiera tenía la lógica). Esta prueba de wiring solo verifica que
  // el componente delega en la función compartida — el comportamiento en
  // sí (reindexar, limpiar el vínculo del quitado, nunca reasignar) ya se
  // prueba con datos reales en `pasajerosFilas.test.ts`.
  const src = leer("app/(dashboard)/dashboard/contratos/[numero]/EditarAsesorPasajeros.tsx");
  assert.match(
    src,
    /import\s*\{[^}]*quitarPasajero[^}]*\}\s*from\s*["']@\/lib\/reservar\/pasajerosFilas["']/,
    "no importa quitarPasajero desde el módulo puro compartido"
  );
  assert.match(src, /const\s+quitarFila\s*=[\s\S]{0,80}quitarPasajero\(/, "quitarFila ya no delega en quitarPasajero");
});

test("lib/reservar/pasajeros.ts es la única fuente de la constante de edad de infante (EDAD_INFANTE_MAX_VUELO)", () => {
  const src = leer("lib/reservar/pasajeros.ts");
  assert.match(src, /export const EDAD_INFANTE_MAX_VUELO\s*=\s*2/, "cambió el umbral sin que el resto del código lo sepa");
});

// ───────────────────────────────────────────────────────────────────────────
// "Los INF deben seguir apareciendo en todos los listados y documentos."
// Los dos manifiestos/listados de vuelo (búsqueda global de pasajeros, y el
// detalle de un record) se leen exclusivamente de `sillas` — por diseño, un
// infante nunca tiene fila propia ahí. Sin un paso adicional quedarían
// invisibles en estos dos listados aunque sí aparezcan en el documento del
// contrato. Estas pruebas verifican que ese paso adicional sigue existiendo.
// ───────────────────────────────────────────────────────────────────────────
test("vuelos/pasajeros/page.tsx trae infantes de contrato_pasajeros y los agrega al listado (no solo sillas)", () => {
  const src = leer("app/(dashboard)/dashboard/vuelos/pasajeros/page.tsx");
  assert.match(src, /from\(\s*["']contrato_pasajeros["']\s*\)/, "no consulta contrato_pasajeros en absoluto");
  assert.match(src, /\.eq\(\s*["']es_infante["']\s*,\s*true\s*\)/, "no filtra por es_infante=true");
  assert.match(src, /\[\.\.\.filasSillas,\s*\.\.\.filasInfantes\]/, "no combina las filas de sillas con las de infantes");
});

test("PasajerosBuscador.tsx admite filas sin silla (infante) sin romper la clave de fila", () => {
  const src = leer("app/(dashboard)/dashboard/vuelos/pasajeros/PasajerosBuscador.tsx");
  assert.match(src, /sillaId:\s*number\s*\|\s*null/, "sillaId debe aceptar null: una fila de infante no tiene silla real");
  assert.match(src, /key=\{p\.id\}/, "la fila debe usar el id sintético, no sillaId — colisiona si un infante tiene sillaId null duplicado");
});

test("vuelos/[id]/page.tsx (detalle de un record) también trae los infantes de los contratos del bloqueo", () => {
  const src = leer("app/(dashboard)/dashboard/vuelos/[id]/page.tsx");
  assert.match(src, /from\(\s*["']contrato_pasajeros["']\s*\)/, "no consulta contrato_pasajeros en absoluto");
  assert.match(src, /\.eq\(\s*["']es_infante["']\s*,\s*true\s*\)/, "no filtra por es_infante=true");
  assert.match(src, /infantesBloqueo/, "no expone los infantes del bloqueo a la vista");
});

test("vuelos/[id]/page.tsx NO inyecta infantes dentro de la tabla de sillas (evita exponer acciones de silla sobre una fila que no tiene silla real)", () => {
  const src = leer("app/(dashboard)/dashboard/vuelos/[id]/page.tsx");
  // La tabla de sillas sigue mapeando exclusivamente `(sillas ?? [])`, nunca
  // una lista combinada con infantes — PasajeroAcciones/SillaEstado/
  // SillaContrato operan sobre un sillaId real.
  assert.match(src, /\{\(sillas \?\? \[\]\)\.map\(\(s\) => \(/, "la tabla de sillas ya no mapea directo sobre `sillas`");
});

// ───────────────────────────────────────────────────────────────────────────
// Segunda revisión de alto riesgo — B5 (creación solo parcialmente atómica):
// `reservarDesdeTarifarioInterno` asignaba sillas y LUEGO insertaba
// contrato_pasajeros en una llamada Supabase aparte; `crearContratoInterno`
// insertaba pasajeros y solo DESPUÉS intentaba las sillas (best-effort: un
// fallo de capacidad quedaba "parcial" pero la función igual devolvía
// `ok: true`). Ahora pasajeros + responsables + sillas son UNA sola llamada
// a `crear_pasajeros_contrato` (una sola transacción Postgres): un fallo de
// capacidad revierte TODO y BLOQUEA la Server Action completa.
// ───────────────────────────────────────────────────────────────────────────
test("reservar/actions.ts: pasajeros+sillas en creación es UNA sola llamada atómica a crear_pasajeros_contrato, con p_holders_min = paxConSilla (piso, nunca menos)", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const inicio = src.indexOf("async function reservarDesdeTarifarioInterno");
  const bloque = src.slice(inicio, src.indexOf("export async function crearCotizacion"));
  assert.match(bloque, /admin\.rpc\(\s*["']crear_pasajeros_contrato["']/, "no llama al RPC atómico crear_pasajeros_contrato");
  assert.match(bloque, /p_holders_min:\s*paxConSilla,/, "no usa paxConSilla como piso de sillas (necesario cuando la lista de pasajeros viene vacía)");
  assert.match(bloque, /p_usuario_id:\s*actorPasajeros\.id,/, "no pasa un usuario real y activo al RPC");
  // El defecto original exacto: pedir sillas con un `select`+`update` en
  // paralelo sin candado, separado del insert de pasajeros.
  assert.doesNotMatch(bloque, /admin\.rpc\(\s*["']asignar_sillas_creacion["']/, "volvió a usar el wrapper viejo, solo-sillas");
});

test("reservar/actions.ts: un fallo de crear_pasajeros_contrato detiene la reserva ENTERA (return temprano, nunca continúa a insertar hoteles/vuelos)", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const inicio = src.indexOf("async function reservarDesdeTarifarioInterno");
  const bloque = src.slice(inicio, src.indexOf("export async function crearCotizacion"));
  const idxLlamada = bloque.indexOf('admin.rpc("crear_pasajeros_contrato"');
  const idxReturn = bloque.indexOf("if (pasajerosErr) return { ok: false, error: pasajerosErr.message };");
  assert.ok(idxLlamada > 0 && idxReturn > idxLlamada, "no detiene la reserva con un return inmediato si crear_pasajeros_contrato falla");
});

test("contratos/actions.ts: pasajeros+sillas en creación es UNA sola llamada atómica a crear_pasajeros_contrato — ya NO es best-effort dentro de negociado_admin", () => {
  const src = leer("app/(dashboard)/dashboard/contratos/actions.ts");
  assert.match(src, /admin\.rpc\(\s*["']crear_pasajeros_contrato["']/, "no llama al RPC atómico crear_pasajeros_contrato");
  assert.doesNotMatch(src, /admin\.rpc\(\s*["']asignar_sillas_creacion["']/, "volvió a usar el wrapper viejo, solo-sillas");
  // El defecto original exacto (B5): un fallo de sillas quedaba "parcial"
  // dentro del bloque best-effort `negociado_admin` (try/catch que nunca
  // bloquea) y la función terminaba devolviendo `ok: true` de todas formas.
  assert.doesNotMatch(
    src,
    /const \{ data: sillasRes, error: sillasError \} = await admin\.rpc\("asignar_sillas_creacion"/,
    "volvió a meter la asignación de sillas dentro del bloque try/catch best-effort"
  );
  assert.match(
    src,
    /if \(pasajerosErr\) return _errorHijas\("pasajeros_y_sillas", pasajerosErr\);/,
    "un fallo de pasajeros+sillas ya no bloquea la creación con _errorHijas (ok:false)"
  );
});

test("contratos/actions.ts: holdersMinPiso solo cae a `pax` (total) cuando NO hay pasajeros nombrados — nunca `holders.length || pax`", () => {
  const src = leer("app/(dashboard)/dashboard/contratos/actions.ts");
  assert.match(
    src,
    /holdersMinPiso = input\.pasajeros\.length \? holdersPiso\.length : pax;/,
    "no corrigió la caída semánticamente incorrecta a `pax` (total CON infantes)"
  );
  // El defecto original exacto (B5): `holders.length || pax` caía a `pax`
  // (total con infantes) cada vez que holders.length era 0 — incluso con
  // pasajeros nombrados donde TODOS resultaban infantes.
  assert.doesNotMatch(
    src,
    /holdersMinPiso = holdersPiso\.length \|\| pax;/,
    "volvió `holders.length || pax` — infla sillas a pedir cuando todos los pasajeros nombrados son infantes"
  );
});

test("reservar/actions.ts: reservarProgramaInterno también pasa por crear_pasajeros_contrato (nunca confía en p.esInfante del cliente)", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const inicio = src.indexOf("async function reservarProgramaInterno");
  const bloque = src.slice(inicio);
  assert.match(bloque, /admin\.rpc\(\s*["']crear_pasajeros_contrato["']/, "reservarProgramaInterno no llama a crear_pasajeros_contrato");
  assert.match(bloque, /p_holders_min:\s*0,/, "un programa no usa sillas propias — debe pasar 0, no inventar un piso");
});

test("migración 167: crear_pasajeros_contrato valida un usuario real y activo (nunca confía ciegamente en service_role)", () => {
  const src = leer("supabase/migrations/20260601000167_contrato_pasajero_responsable_infante.sql");
  assert.match(src, /select activo into v_activo from public\.usuarios where usuarios\.id = p_usuario_id;/, "no valida que el usuario exista");
  assert.match(src, /if not v_activo then\s*\n\s*raise exception 'El usuario está desactivado\.';/, "no rechaza un usuario desactivado");
});

