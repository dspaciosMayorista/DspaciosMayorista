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

  test(`${archivo} recalcula es_infante con esInfantePorEdad antes de insertar`, () => {
    const src = leer(archivo);
    assert.match(src, /esInfantePorEdad\(/, "no llama esInfantePorEdad");
    assert.match(src, /es_infante:\s*esInfante/, "el insert de contrato_pasajeros no usa el resultado recalculado");
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
}

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

test("migración 167: la creación usa un wrapper service_role separado (asignar_sillas_creacion) que exige un actor real, no un rol interno", () => {
  const src = leer("supabase/migrations/20260601000167_contrato_pasajero_responsable_infante.sql");
  assert.match(src, /create or replace function public\.asignar_sillas_creacion/, "no existe el wrapper de creación");
  assert.match(src, /grant execute on function public\.asignar_sillas_creacion\([^)]*\)\s*to\s*service_role;/, "asignar_sillas_creacion no está limitado a service_role");
  assert.doesNotMatch(
    src,
    /grant execute on function public\.asignar_sillas_creacion\([^)]*\)\s*to\s*authenticated;/,
    "asignar_sillas_creacion no debe ser invocable directo por una sesión autenticada normal"
  );
});

test("EditarAsesorPasajeros.tsx reindexa responsableIndex al quitar una fila (nunca deja un vínculo apuntando a la persona equivocada)", () => {
  const src = leer("app/(dashboard)/dashboard/contratos/[numero]/EditarAsesorPasajeros.tsx");
  assert.match(src, /const\s+quitarFila\s*=/, "no existe el handler quitarFila");
  assert.match(
    src,
    /r\.responsableIndex\s*===\s*i\s*\)\s*return\s*\{\s*\.\.\.r,\s*responsableIndex:\s*null\s*\}/,
    "no limpia el vínculo de quien apuntaba exactamente a la fila quitada"
  );
  assert.match(
    src,
    /r\.responsableIndex\s*>\s*i\s*\)\s*return\s*\{\s*\.\.\.r,\s*responsableIndex:\s*r\.responsableIndex\s*-\s*1\s*\}/,
    "no reindexa los vínculos posteriores a la fila quitada"
  );
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
// Revisión de alto riesgo — B5: auditoría de CREACIÓN. Los dos flujos que
// asignan sillas al crear un contrato usaban un conteo agregado
// (`paxConSilla`, de la configuración de habitaciones, o `pax`, el total
// CON infantes — ver comentario en contratos/actions.ts) para decidir
// cuántas sillas tomar, en vez del conteo REAL de pasajeros nombrados que sí
// ocupan silla (`holders.length`, por edad real) — podían divergir si un
// pasajero nombrado resultaba infante y la configuración no lo reflejaba.
// Además, la asignación era un `select` + `update` en paralelo SIN candado:
// dos reservas concurrentes contra el MISMO bloqueo podían tomar la misma
// silla "libre" antes de que ninguna confirmara, y los errores se ignoraban
// o solo se registraban sin bloquear el contrato. Se corrige reservando por
// el RPC atómico `asignar_sillas_creacion` (migración 167, candado
// `for update` sobre el pool completo del bloqueo) con el conteo real.
// ───────────────────────────────────────────────────────────────────────────
test("reservar/actions.ts: la reserva de sillas en creación usa el RPC atómico asignar_sillas_creacion, con holders.length real (nunca paxConSilla)", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  assert.match(src, /admin\.rpc\(\s*["']asignar_sillas_creacion["']/, "no llama al RPC atómico asignar_sillas_creacion");
  assert.match(src, /p_holders_nuevo:\s*holdersCreacion\.length/, "no usa el conteo real (holdersCreacion.length) para reservar sillas");
  // El defecto original exacto: `.limit(paxConSilla)` para la asignación de
  // sillas de la reserva individual (fuera del alcance: el motor de
  // COSTO aéreo sí puede seguir usando paxConSilla, eso es otro cálculo).
  assert.doesNotMatch(
    src,
    /\.order\(\s*["']numero_silla["']\s*\)\s*\n?\s*\.limit\(paxConSilla\)/,
    "volvió a usar paxConSilla como límite de sillas a asignar en la reserva individual"
  );
});

test("reservar/actions.ts: la reserva de sillas en creación ocurre ANTES de insertar contrato_pasajeros (evita pasajeros guardados con inventario incompleto)", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const idxSillas = src.indexOf("admin.rpc(\"asignar_sillas_creacion\"");
  const idxPasajeros = src.indexOf('await sb.from("contrato_pasajeros").insert(');
  assert.ok(idxSillas > 0, "no encontró la llamada a asignar_sillas_creacion");
  assert.ok(idxPasajeros > 0, "no encontró el insert de contrato_pasajeros");
  assert.ok(idxSillas < idxPasajeros, "la reserva de sillas debe ocurrir ANTES de insertar los pasajeros, para que un fallo de cupo no deje pasajeros guardados con inventario incompleto");
});

test("contratos/actions.ts: la asignación de sillas en creación usa el RPC atómico, y 'adultos' solo cae a pax cuando NO hay pasajeros nombrados", () => {
  const src = leer("app/(dashboard)/dashboard/contratos/actions.ts");
  assert.match(src, /admin\.rpc\(\s*["']asignar_sillas_creacion["']/, "no llama al RPC atómico asignar_sillas_creacion");
  assert.match(src, /const adultos = input\.pasajeros\.length \? holders\.length : pax;/, "no corrigió la caída semánticamente incorrecta a `pax` (total CON infantes)");
  // El defecto original exacto (B5): `holders.length || pax` caía a `pax`
  // (total con infantes) cada vez que holders.length era 0 — incluso con
  // pasajeros nombrados donde TODOS resultaban infantes.
  assert.doesNotMatch(
    src,
    /const adultos = holders\.length \|\| pax;/,
    "volvió `holders.length || pax` — infla sillas a pedir cuando todos los pasajeros nombrados son infantes"
  );
});

test("migración 167: asignar_sillas_creacion valida un usuario real y activo (nunca confía ciegamente en service_role)", () => {
  const src = leer("supabase/migrations/20260601000167_contrato_pasajero_responsable_infante.sql");
  assert.match(src, /select activo into v_activo from public\.usuarios where id = p_usuario_id;/, "no valida que el usuario exista");
  assert.match(src, /if not v_activo then\s*\n\s*raise exception 'El usuario está desactivado\.';/, "no rechaza un usuario desactivado");
});

