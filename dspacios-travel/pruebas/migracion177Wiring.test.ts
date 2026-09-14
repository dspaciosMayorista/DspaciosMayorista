import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Auditoría Dubai — hallazgos finales sobre la migración 177 (edades propias
// de `tarifa_hotel`) y sus scripts de preflight/postcheck/rollback. No es
// SQL ejecutable bajo `node --test` (requiere Postgres real) — se verifica
// el TEXTO de los scripts, mismo criterio que el resto de "wiring tests"
// del repo (ver pruebas/reglaEdadErrorSupabaseWiring.test.ts). La ejecución
// real contra Postgres se hizo manualmente esta ronda (Docker desechable,
// ver el informe) — este archivo solo evita que el texto de los scripts
// regrese a un estado ya corregido.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const migracion = readFileSync(join(raiz, "supabase/migrations/20260601000177_tarifa_hotel_edades_propias.sql"), "utf8");
const preflight = readFileSync(join(raiz, "supabase/scripts/preflight_177_tarifa_hotel_edades_propias.sql"), "utf8");
const postcheck = readFileSync(join(raiz, "supabase/scripts/postcheck_177_tarifa_hotel_edades_propias.sql"), "utf8");
const rollback = readFileSync(join(raiz, "supabase/scripts/rollback_177_tarifa_hotel_edades_propias.sql"), "utf8");

describe("Hallazgo #1 — postcheck usa una fila REAL (fixture por UPDATE+ROLLBACK), nunca hotel_id=-1", () => {
  test("postcheck NO contiene ninguna referencia a hotel_id=-1 ni a un insert con hotel_id -1", () => {
    assert.doesNotMatch(postcheck, /hotel_id\s*=\s*-1/);
    assert.doesNotMatch(postcheck, /\(-1,/, "no debe quedar ningún literal -1 posicional (ej. insert ... values (-1, ...))");
  });

  test("postcheck NO inserta ninguna fila ficticia (sin INSERT INTO tarifa_hotel)", () => {
    assert.doesNotMatch(postcheck, /insert\s+into\s+public\.tarifa_hotel/i);
  });

  test("postcheck selecciona un id REAL de tarifa_hotel (LIMIT 1) antes de mutarlo", () => {
    assert.match(postcheck, /select\s+id\s+into\s+v_id\s+from\s+public\.tarifa_hotel\s+limit\s+1/i);
  });

  test("si no hay ninguna fila, avisa explícitamente y NO produce un falso éxito (usa `return` para saltar las pruebas mutantes)", () => {
    const posCheckNull = postcheck.indexOf("if v_id is null then");
    assert.notEqual(posCheckNull, -1);
    const bloque = postcheck.slice(posCheckNull, posCheckNull + 400);
    assert.match(bloque, /raise notice 'AVISO:/);
    assert.match(bloque, /NO se pudieron ejecutar/);
    assert.match(bloque, /return;/, "debe saltar las pruebas mutantes con `return`, nunca seguir como si hubiera pasado");
  });

  test("los casos inválidos usan UPDATE (no INSERT) envuelto en `begin ... exception when check_violation`", () => {
    const updates = postcheck.match(/update public\.tarifa_hotel/g) ?? [];
    assert.ok(updates.length >= 4, "debe haber al menos 4 UPDATE: 3 casos inválidos + 1 caso válido");
    const excepciones = postcheck.match(/exception when check_violation then/g) ?? [];
    assert.equal(excepciones.length, 3, "exactamente 3 casos inválidos deben atrapar check_violation (override parcial, infante_min<>0, nino_max>17)");
  });

  test("el caso válido usa UPDATE con exactamente 0,2,3,10 y confirma que se aceptó (sin exception)", () => {
    const posValido = postcheck.indexOf("Regla completa y válida (0,2,3,10)");
    assert.notEqual(posValido, -1);
    const bloque = postcheck.slice(posValido, posValido + 500);
    assert.match(bloque, /edad_infante_min = 0, edad_infante_max = 2, edad_nino_min = 3, edad_nino_max = 10/);
    assert.match(bloque, /if not found then/, "debe confirmar explícitamente que el UPDATE afectó la fila");
    assert.match(bloque, /raise notice 'OK: el UPDATE con una regla completa y válida/);
  });

  test("toda la sección de pruebas mutantes está envuelta en BEGIN ... ROLLBACK (transacción de prueba, nunca deja datos modificados)", () => {
    const posBegin = postcheck.search(/^begin;/m);
    const posDoBlock = postcheck.indexOf("do $$");
    const posRollback = postcheck.search(/^rollback;/m);
    assert.ok(posBegin > -1 && posDoBlock > posBegin && posRollback > posDoBlock, "el orden debe ser BEGIN → DO (mutaciones) → ROLLBACK");
  });
});

describe("Hallazgo #2 — constraints ligados a la tabla (conrelid) en migración/preflight/postcheck", () => {
  test("migración 177: ambos guards 'if not exists' filtran por conrelid = 'public.tarifa_hotel'::regclass", () => {
    const ocurrencias = migracion.match(/conrelid = 'public\.tarifa_hotel'::regclass/g) ?? [];
    assert.equal(ocurrencias.length, 2, "debe haber exactamente 2 guards (uno por CHECK) filtrados por conrelid");
    // Cada guard debe combinar conname + conrelid en el mismo `where`.
    const posGuard1 = migracion.indexOf("conname = 'tarifa_hotel_edades_todas_o_ninguna_check'");
    const posGuard2 = migracion.indexOf("conname = 'tarifa_hotel_edades_rangos_check'");
    assert.notEqual(posGuard1, -1);
    assert.notEqual(posGuard2, -1);
    assert.match(migracion.slice(posGuard1, posGuard1 + 150), /conrelid = 'public\.tarifa_hotel'::regclass/);
    assert.match(migracion.slice(posGuard2, posGuard2 + 150), /conrelid = 'public\.tarifa_hotel'::regclass/);
  });

  test("preflight: la consulta de constraints previos filtra por conrelid", () => {
    assert.match(preflight, /conrelid = 'public\.tarifa_hotel'::regclass/);
    const posSelect = preflight.indexOf("select conname");
    const posWhere = preflight.indexOf("where", posSelect);
    assert.ok(posWhere > -1 && preflight.slice(posWhere, posWhere + 200).includes("conrelid"), "el filtro conrelid debe estar en el mismo WHERE que la consulta de constraints");
  });

  test("postcheck: la consulta que confirma los 2 CHECK existentes filtra por conrelid", () => {
    const posSelect = postcheck.indexOf("select conname, pg_get_constraintdef");
    assert.notEqual(posSelect, -1);
    const bloque = postcheck.slice(posSelect, posSelect + 250);
    assert.match(bloque, /conrelid = 'public\.tarifa_hotel'::regclass/);
  });
});

describe("Hallazgo #4 — riesgo de despliegue explícito en la cabecera de la migración", () => {
  test("la migración menciona computarReserva y que aplica a CUALQUIER hotel persona (no solo Dubai)", () => {
    assert.match(migracion, /computarReserva/);
    assert.match(migracion, /modelo_tarifario = 'persona'/);
    assert.match(migracion, /no solo los que configuraron/);
  });

  test("la migración advierte que desplegar código antes de la SQL rompe TODAS las reservas/búsquedas de hotel persona", () => {
    assert.match(migracion, /rompe TODAS las reservas y búsquedas de hotel/);
  });

  test("la migración deja explícito el orden obligatorio de 4 pasos: preflight remoto → migración remota → postcheck remoto → desplegar código", () => {
    const posOrden = migracion.indexOf("ORDEN OBLIGATORIO");
    assert.notEqual(posOrden, -1);
    const bloque = migracion.slice(posOrden, posOrden + 900);
    assert.match(bloque, /preflight_177_tarifa_hotel_edades_propias\.sql[\s\S]*REMOTO/);
    assert.match(bloque, /aplicar ESTA migración \(177\) en el entorno REMOTO/);
    assert.match(bloque, /postcheck_177_tarifa_hotel_edades_propias\.sql[\s\S]*REMOTO/);
    assert.match(bloque, /desplegar el código/);
  });

  test("la migración deja explícito que NO se implementó un fallback runtime que oculte la columna faltante", () => {
    assert.match(migracion, /NO se implementó un fallback\s*\n?\s*--\s*en runtime/);
  });

  test("preflight y postcheck referencian el orden obligatorio (paso 1 de 4 / paso 3 de 4)", () => {
    assert.match(preflight, /Paso 1 de 4/);
    assert.match(postcheck, /Paso 3 de 4/);
  });

  test("computo.ts realmente selecciona las 4 columnas de edad para AMBAS ramas (confirma que la advertencia de la migración es cierta, no aspiracional)", () => {
    const computo = readFileSync(join(raiz, "lib/reservar/computo.ts"), "utf8");
    const ocurrencias = computo.match(/edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max/g) ?? [];
    assert.ok(ocurrencias.length >= 2, "ambas ramas de computarReserva deben seleccionar las 4 columnas de edad");
  });
});

describe("rollback_177 — sin cambios de alcance, sigue revirtiendo columnas + constraints", () => {
  test("el rollback sigue existiendo y dropea constraints antes que columnas", () => {
    const posConstraints = rollback.indexOf("drop constraint");
    const posColumns = rollback.indexOf("drop column");
    assert.ok(posConstraints > -1 && posColumns > posConstraints, "los CHECK deben eliminarse antes que las columnas de las que dependen");
  });
});
