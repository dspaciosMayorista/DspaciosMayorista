// Migración 259 (límite propio y acotado del publicador del tarifario): lo que debe cumplir el ARCHIVO, sin base de datos.
//   node --test --experimental-strip-types pruebas/publicadorLimite259.test.ts
// La prueba con base y PostgREST reales es supabase/scripts/test_259_publicador_limite.sh.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirMig = join(raiz, "supabase/migrations");
const leer = (f: string) => readFileSync(join(dirMig, f), "utf8").replace(/\r\n/g, "\n");
const archivo = readdirSync(dirMig).find((f) => f.startsWith("20260601000259_"));
const sql = archivo ? leer(archivo) : "";
// Sin comentarios: las comprobaciones de «no hace X» no deben tropezar con la explicación.
const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("migración 259", () => {
  test("existe con el número 259 y un solo archivo con ese número", () => {
    assert.ok(archivo, "falta la migración 259");
    assert.equal(readdirSync(dirMig).filter((f) => f.startsWith("20260601000259_")).length, 1);
  });

  test("pone statement_timeout 30 s y lock_timeout 8 s en LAS DOS entradas que llama la app, con su firma exacta", () => {
    const base = /alter function public\.publicar_tarifario_resultado\(bigint, bigint, bigint, text, jsonb\)\s+set statement_timeout = '30s'\s+set lock_timeout = '8s';/;
    const n63 = /alter function public\.publicar_tarifario_resultado_63\(bigint, bigint, bigint, text, jsonb, text, numeric\)\s+set statement_timeout = '30s'\s+set lock_timeout = '8s';/;
    assert.match(codigo, base);
    assert.match(codigo, n63);
  });

  test("solo ALTER FUNCTION … SET: no redefine cuerpos, no toca el interno, roles, grants ni tablas", () => {
    assert.doesNotMatch(codigo, /create\s+(or\s+replace\s+)?function/i);
    assert.doesNotMatch(codigo, /(alter|create)\s+(or\s+replace\s+)?function\s+public\.publicar_tarifario_resultado_interno/i);
    assert.doesNotMatch(codigo, /alter\s+(role|database|system)/i);
    assert.doesNotMatch(codigo, /\b(grant|revoke)\b/i);
    assert.doesNotMatch(codigo, /\b(alter\s+table|drop\s+|delete\s+from|insert\s+into|update\s+)/i);
    assert.doesNotMatch(codigo, /reset\s+all/i, "RESET ALL borraría el search_path de las funciones SECURITY DEFINER");
  });

  test("falla cerrado si faltan las funciones o dejaron de ser SECURITY DEFINER", () => {
    assert.match(codigo, /'public\.publicar_tarifario_resultado\(bigint,bigint,bigint,text,jsonb\)'/);
    assert.match(codigo, /'public\.publicar_tarifario_resultado_63\(bigint,bigint,bigint,text,jsonb,text,numeric\)'/);
    assert.match(codigo, /to_regprocedure\(v_firma\)/);
    assert.match(codigo, /ya no es SECURITY DEFINER/);
    assert.match(codigo, /configuración ajena/);
    assert.match(codigo, /259 ABORTADA \(REVISAR\)/);
  });

  test("pide a PostgREST recargar el esquema y va dentro de una transacción", () => {
    assert.match(codigo, /^begin;/m);
    assert.match(codigo, /^commit;/m);
    assert.match(codigo, /notify pgrst, 'reload schema';/);
  });

  test("el límite de ejecución es acotado (≤ 60 s) y el de espera por candado no supera al del rol (8 s)", () => {
    const st = /statement_timeout = '(\d+)s'/.exec(codigo);
    const lt = /lock_timeout = '(\d+)s'/.exec(codigo);
    assert.ok(st && lt);
    assert.ok(Number(st[1]) > 8 && Number(st[1]) <= 60, `statement_timeout ${st[1]} s fuera de lo acotado`);
    assert.ok(Number(lt[1]) <= 8, `lock_timeout ${lt[1]} s: no debe esperar más candado que el rol`);
  });
});

describe("el límite no se pierde con migraciones posteriores", () => {
  const posteriores = readdirSync(dirMig).filter((f) => /^20260601000(\d{3})_/.test(f) && Number(f.slice(11, 17)) > 259);
  test("toda migración posterior que re-cree una de las dos entradas debe volver a fijar statement_timeout y lock_timeout (CREATE OR REPLACE borra los SET)", () => {
    for (const f of posteriores) {
      const s = leer(f).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
      for (const nombre of ["publicar_tarifario_resultado", "publicar_tarifario_resultado_63"]) {
        const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${nombre}\\s*\\(`, "i");
        if (re.test(s)) {
          assert.match(s, /statement_timeout/, `${f} re-crea ${nombre} sin conservar statement_timeout (perdería el límite de la 259)`);
          assert.match(s, /lock_timeout/, `${f} re-crea ${nombre} sin conservar lock_timeout`);
        }
      }
    }
  });
  test("las migraciones ANTERIORES a la 259 no fijan estos límites (la 259 es la única fuente)", () => {
    for (const f of readdirSync(dirMig).filter((x) => Number(x.slice(11, 17)) < 259 && /^20260601000\d{3}_/.test(x))) {
      const s = leer(f).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
      assert.doesNotMatch(s, /alter\s+function\s+public\.publicar_tarifario_resultado[^;]*statement_timeout/i, f);
    }
  });
});
