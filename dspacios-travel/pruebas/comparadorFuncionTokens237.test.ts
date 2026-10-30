import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tokenizar, diffTokens, cuerpoMigracion, cuerpoRemoto, md5 } from "../supabase/scripts/pruebas_237/comparar_funcion_tokens.mjs";

// #5 D8/D9 — reemplazar_tarifas_hotel_calculadora: la definición VIGENTE en Producción (fixture, md5 observado
// d7e05c96…) tiene los MISMOS tokens que la migración 179; la 237 solo le agrega la guarda de Mayorista.
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (r: string) => readFileSync(join(raiz, r), "utf8");
const NOMBRE = "reemplazar_tarifas_hotel_calculadora";
const fx = JSON.parse(leer("supabase/scripts/pruebas_237/fixtures/reemplazar_tarifas_hotel_calculadora.remota.json"));
const remota = cuerpoRemoto(fx.definicion);
const m179 = cuerpoMigracion(leer("supabase/migrations/20260601000179_tarifa_hotel_precio_final_autoritativo.sql"), NOMBRE);
const m237 = cuerpoMigracion(leer("supabase/migrations/20260601000237_catalogos_globales_frontera_mayorista.sql"), NOMBRE);

describe("fixture de Producción", () => {
  test("el md5 del cuerpo remoto (prosrc) es el observado en Producción", () => {
    assert.equal(md5(remota.cuerpo), fx.md5_observado);
    assert.equal(fx.md5_observado, "d7e05c96e1260a76fbad22784e881c77");
  });
  test("el md5 de la migración 179 NO coincide con el remoto: la diferencia hay que explicarla por tokens, no por huella", () => {
    assert.notEqual(md5(m179.cuerpo), fx.md5_observado);
  });
});

describe("remota vs migración 179", () => {
  test("cero diferencias de tokens (lógica idéntica; solo cambia el formato)", () => {
    const dif = diffTokens(tokenizar(m179.cuerpo), tokenizar(remota.cuerpo));
    assert.deepEqual(dif, []);
    assert.equal(tokenizar(m179.cuerpo).length, tokenizar(remota.cuerpo).length);
  });
});

describe("el comparador detecta diferencias de lógica (controles negativos)", () => {
  const base = remota.cuerpo as string;
  const mutaciones: [string, string, string][] = [
    ["operador", "v_hotel_fila <> p_hotel_id", "v_hotel_fila = p_hotel_id"],
    ["any -> all", "alimentacion = any(p_regimenes)", "alimentacion = all(p_regimenes)"],
    ["literal (mensaje)", "hotel_id requerido", "hotel_id necesario"],
    ["espacio dentro de un literal", "p_filas debe ser un arreglo jsonb", "p_filas  debe ser un arreglo jsonb"],
    ["rol retirado", "    'operaciones'\r\n", ""],
    ["columna", "temporada_base\r\n    )\r\n    values", "temporada_bas\r\n    )\r\n    values"],
    ["delete sin filtro", "    delete from public.tarifa_hotel\r\n    where hotel_id = p_hotel_id;", "    delete from public.tarifa_hotel;"],
  ];
  for (const [nombre, de, a] of mutaciones) {
    test(`detecta: ${nombre}`, () => {
      assert.ok(base.includes(de), `la mutación ${nombre} no aplica`);
      const dif = diffTokens(tokenizar(m179.cuerpo), tokenizar(base.replace(de, a)));
      assert.ok(dif.length > 0, nombre);
    });
  }
  test("no se confunde con el formato: espacios, saltos, comentarios y mayúsculas de palabras clave no cuentan", () => {
    const reformateado = base.replace(/\r\n/g, "\n").replace(/^ +/gm, (m: string) => m + m).replace(/\bif\b/g, "IF").replace(/\n/g, "\n-- comentario\n");
    assert.deepEqual(diffTokens(tokenizar(base), tokenizar(reformateado)), []);
  });
});

describe("la 237 = definición vigente + SOLO la guarda de Mayorista", () => {
  const GUARDA = tokenizar(
    "if not public.puede_escribir_catalogo_global() then raise exception 'Los catalogos globales solo se editan desde la agencia Mayorista.' using errcode = '42501'; end if;"
  );
  test("quitando la guarda, los tokens de la 237 son exactamente los de la remota", () => {
    const t237 = tokenizar(m237.cuerpo).map((x: { v: string }) => x.v);
    const g = GUARDA.map((x: { v: string }) => x.v);
    let idx = -1;
    for (let i = 0; i + g.length <= t237.length; i++) if (g.every((v: string, k: number) => t237[i + k] === v)) { idx = i; break; }
    assert.ok(idx >= 0, "la guarda no está en la 237");
    const sinGuarda = [...t237.slice(0, idx), ...t237.slice(idx + g.length)];
    assert.deepEqual(sinGuarda, tokenizar(remota.cuerpo).map((x: { v: string }) => x.v));
  });
  test("la guarda va DESPUÉS del chequeo de rol y ANTES de cualquier acceso a datos", () => {
    const c = m237.cuerpo as string;
    const iRol = c.indexOf("mi_rol()"), iGuarda = c.indexOf("puede_escribir_catalogo_global()"), iDelete = c.search(/delete\s+from/i);
    assert.ok(iRol >= 0 && iRol < iGuarda && iGuarda < iDelete);
  });
});

describe("rollback, preflight y respaldo", () => {
  const sql237 = leer("supabase/migrations/20260601000237_catalogos_globales_frontera_mayorista.sql");
  const rollback = leer("supabase/scripts/rollback_237_catalogos_globales_frontera.sql");
  const preflight = leer("supabase/scripts/preflight_237_catalogos_globales.sql");
  test("la 237 respalda las 4 funciones ANTES de reemplazarlas", () => {
    assert.ok(sql237.indexOf("insert into public.catalogos_funciones_previas_237") < sql237.indexOf("CREATE OR REPLACE FUNCTION public.fn_fusionar_destino"));
    assert.match(sql237, /pg_get_functiondef\(p\.oid\)/);
  });
  test("el rollback restaura desde el respaldo y VERIFICA el md5; no embebe definiciones a mano", () => {
    assert.match(rollback, /execute r\.definicion/);
    assert.match(rollback, /v_md5 is distinct from r\.md5_prosrc/);
    assert.doesNotMatch(rollback, /CREATE OR REPLACE FUNCTION/i);
    assert.ok(rollback.indexOf("drop table if exists public.catalogos_funciones_previas_237") > rollback.indexOf("execute r.definicion"));
  });
  test("el preflight acepta los dos md5 conocidos de reemplazar_tarifas_hotel_calculadora y compara por lista", () => {
    assert.match(preflight, /d7e05c96e1260a76fbad22784e881c77 \| 632146aba910eb17f2572273567de091/);
    assert.match(preflight, /any \(string_to_array\(esperado, ' \| '\)\)/);
  });
});
