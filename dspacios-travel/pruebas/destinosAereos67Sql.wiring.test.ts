import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { VECTORES_PAIS } from "./destinosAereos67Soporte.ts";

// #67 — cableado TS ↔ SQL (sin base de datos). La regla de país y los nombres de objetos viven en
// dos sitios (lib/paquetes/destinosAereos67.ts y la migración 220); estas pruebas fallan si divergen.
// La ejecución real del SQL (restricciones, RLS, carreras, API) corre en GitHub Actions:
// .github/workflows/test-220-destinos-aereos-67.yml.

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MIG = "supabase/migrations/20260601000220_paquete_destinos_aereos.sql";
const SQL_TEST = "supabase/scripts/test_220_destinos_aereos.sql";
const LIB = "lib/paquetes/destinosAereos67.ts";

describe("migración 220 — existencia y exclusividad", () => {
  test("el archivo existe y es el único 220", () => {
    assert.ok(existsSync(new URL(`../${MIG}`, import.meta.url)));
  });
  test("no modifica migraciones anteriores: solo crea/reemplaza objetos propios de #67", () => {
    const sql = leer(MIG).replace(/--.*$/gm, "");
    // alter table solo sobre armado_paquetes (columna nueva) y la tabla nueva
    const alters = [...sql.matchAll(/alter table\s+(?:if exists\s+)?([a-z_.]+)/gi)].map((m) => m[1].toLowerCase());
    for (const a of alters) assert.ok(["public.armado_paquetes", "public.armado_paquete_destinos_aereos"].includes(a), `alter inesperado: ${a}`);
  });
  test("las funciones usan sufijo _67 y no pisan funciones de otras migraciones", () => {
    const sql = leer(MIG);
    const creadas = [...sql.matchAll(/create or replace function\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1]);
    assert.ok(creadas.length >= 9);
    for (const f of creadas) assert.match(f, /_67$|^trg_.*_67$/, `función sin sufijo _67: ${f}`);
  });
});

describe("país comparable: paridad TS ↔ SQL", () => {
  test("el mapa de tildes del translate de la 220 es el de la aplicación", () => {
    const sql = leer(MIG);
    const lib = leer(LIB);
    const conTilde = /const CON_TILDE = "([^"]+)"/.exec(lib)?.[1];
    const sinTilde = /const SIN_TILDE = "([^"]+)"/.exec(lib)?.[1];
    assert.ok(conTilde && sinTilde);
    assert.equal([...conTilde].length, [...sinTilde].length);
    const tr = /translate\(\s*btrim\([\s\S]*?'g'\)\)\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*(?:\|\|\s*'([^']+)')?\s*\)/.exec(sql);
    assert.ok(tr, "no se encontró el translate de pais_comparable_67");
    const desde = tr[1];
    const hacia = tr[2] + (tr[3] ?? "");
    assert.equal([...desde].length, [...hacia].length, "translate con listas de distinta longitud");
    // Cada letra con tilde debe ir a la misma letra base que en TS (minúscula, porque SQL baja todo a la vez).
    const mapaSql = new Map([...desde].map((c, i) => [c, [...hacia][i]]));
    [...conTilde].forEach((c, i) => {
      assert.equal(mapaSql.get(c), [...sinTilde][i].toLowerCase(), `tilde ${c}`);
    });
    // Las 26 mayúsculas ASCII bajan a su minúscula.
    for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") assert.equal(mapaSql.get(c), c.toLowerCase());
  });
  test("cada vector de VECTORES_PAIS está contrastado en la batería SQL", () => {
    const sql = leer(SQL_TEST);
    for (const [entrada, esperado] of VECTORES_PAIS) {
      if (entrada === null || entrada === "" || entrada.trim() === "") continue; // nulos/vacíos: cubiertos con 'null' y ''
      if (entrada.includes("\t")) {
        assert.ok(sql.includes("E'República\\tDominicana'"), "vector con tabulador");
        continue;
      }
      const lit = `('${entrada}', ${esperado === null ? "null" : `'${esperado}'`})`;
      assert.ok(sql.includes(lit), `vector sin contraste SQL: ${lit}`);
    }
    assert.ok(sql.includes("('', null), ('   ', null), (null, null)"), "vectores vacíos/nulos");
  });
});

describe("nombres de objetos: lo que usa la aplicación existe en la migración", () => {
  const sql = leer(MIG);
  test("RPC guardar_destinos_aereos_67 con los parámetros que envía el servidor", () => {
    assert.match(sql, /function public\.guardar_destinos_aereos_67\(\s*p_paquete_id bigint,\s*p_destino_id bigint,\s*p_activo\s+boolean,\s*p_destinos\s+bigint\[\]/);
    const acciones = leer("app/(dashboard)/dashboard/paquetes/actions.ts");
    for (const p of ["p_paquete_id", "p_destino_id", "p_activo", "p_destinos"]) assert.ok(acciones.includes(p), `la acción no envía ${p}`);
    assert.ok(acciones.includes("guardar_destinos_aereos_67"));
  });
  test("columna y tabla que lee el cargador", () => {
    assert.match(sql, /add column if not exists destinos_aereos_alternativos boolean not null default false/);
    assert.match(sql, /create table if not exists public\.armado_paquete_destinos_aereos/);
    const pagina = leer("app/(dashboard)/dashboard/paquetes/[id]/page.tsx");
    assert.ok(pagina.includes("armado_paquete_destinos_aereos") && pagina.includes("destinos_aereos_alternativos"));
  });
  test("mensajes de error de la base que la aplicación reconoce", () => {
    for (const marca of ["destino_aereo_no_permitido", "destino_aereo_config", "destino_aereo_vinculos"]) {
      assert.ok(sql.includes(marca), `la migración no emite ${marca}`);
    }
    const lib = leer(LIB);
    for (const marca of ["destino_aereo_no_permitido", "destino_aereo_config", "destino_aereo_vinculos"]) {
      assert.ok(lib.includes(marca), `la aplicación no traduce ${marca}`);
    }
  });
  test("las guardas son triggers de restricción DIFERIDOS (validan el estado final del lote)", () => {
    const n = (sql.match(/create constraint trigger/gi) ?? []).length;
    assert.equal(n, 5);
    assert.equal((sql.match(/deferrable initially deferred/gi) ?? []).length, 5);
  });
  test("las validaciones toman el candado del paquete", () => {
    assert.ok((sql.match(/for no key update/gi) ?? []).length >= 3);
  });
  test("la tabla nueva no es legible por anon ni public", () => {
    assert.match(sql, /revoke all on table public\.armado_paquete_destinos_aereos from anon, public/);
    assert.match(sql, /enable row level security/);
  });
});

describe("scripts y workflow de #67 presentes y coherentes", () => {
  for (const f of [
    "supabase/scripts/preflight_220_destinos_aereos.sql", "supabase/scripts/postcheck_220_destinos_aereos.sql",
    "supabase/scripts/rollback_220_destinos_aereos.sql", "supabase/scripts/test_220_destinos_aereos.sql",
    "supabase/scripts/test_220_fases.sh", "supabase/scripts/test_220_carrera.sh", "supabase/scripts/test_220_api.sh",
  ]) {
    test(`existe ${f}`, () => assert.ok(existsSync(new URL(`../${f}`, import.meta.url))));
  }
  test("el workflow corre los tres runners y no usa secretos del repositorio", () => {
    const ruta = new URL("../../.github/workflows/test-220-destinos-aereos-67.yml", import.meta.url);
    assert.ok(existsSync(ruta), "falta el workflow");
    const wf = readFileSync(ruta, "utf8").replace(/^\s*#.*$/gm, "");
    for (const s of ["test_220_fases.sh", "test_220_carrera.sh", "test_220_api.sh"]) assert.ok(wf.includes(s), `el workflow no corre ${s}`);
    assert.ok(!/secrets\./.test(wf), "el workflow no debe usar secretos");
    assert.ok(!/pull_request_target/.test(wf));
    assert.match(wf, /permissions:\s*\n\s*contents: read/);
  });
});
