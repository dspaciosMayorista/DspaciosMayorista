import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extraerCuerpoMigracion, verificarEspejo } from "../supabase/scripts/lib/espejo164.mjs";

// ─────────────────────────────────────────────────────────────────────────
// Controles negativos reproducibles del guard de espejo de la migración 164
// (R1, Commit 7). No requieren Docker ni base de datos: ejercitan la MISMA
// función pura (`verificarEspejo`/`extraerCuerpoMigracion`) que usa
// `test_164_espejo.sh` en producción vía `verificar_espejo_cli.mjs` — un
// cambio futuro en esa lógica no puede reintroducir el falso positivo
// original sin romper alguna de estas pruebas.
//
// El bug corregido: la versión anterior comparaba con `mig.includes(body)`.
// Como `"".includes("")` es `true` en JavaScript, una extracción vacía o
// fallida (prosrc NULL/"" en la BD, o el bloque no encontrado en la
// migración) reportaba "OK" sin comparar nada de verdad. Cada prueba de
// abajo corresponde a uno de los 6 modos de falla pedidos.
// ─────────────────────────────────────────────────────────────────────────

const MIG_REAL = readFileSync("supabase/migrations/20260601000164_condiciones_pago_componente.sql", "utf8");

const ARGS_REGISTRAR = "bigint, numeric, text, numeric, text, text, date, uuid, text, jsonb, numeric, numeric";
const ARGS_ANULAR = "bigint, uuid, text";
const ARGS_HUELLA = "bigint, numeric, text, text, text, date";

describe("espejo164: regresión directa del bug original ('' .includes('') === true)", () => {
  test("prosrc vacío + migración vacía (el caso exacto del bug) NO pasa", () => {
    const r = verificarEspejo({ nombre: "x", args: "", cnt: 1, cntCualquierFirma: 1, prosrc: "", migSrc: "" });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /NULL o vacío/);
  });

  test("prosrc null + migración vacía NO pasa", () => {
    const r = verificarEspejo({ nombre: "x", args: "", cnt: 1, cntCualquierFirma: 1, prosrc: null, migSrc: "" });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /NULL o vacío/);
  });
});

describe("espejo164: modo 1 — la función esperada no existe", () => {
  test("cnt=0 y cntCualquierFirma=0 -> FALLA reportando que no existe", () => {
    const r = verificarEspejo({
      nombre: "fn_no_existe",
      args: ARGS_REGISTRAR,
      cnt: 0,
      cntCualquierFirma: 0,
      prosrc: "select 1;",
      migSrc: MIG_REAL,
    });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /NO EXISTE/);
  });
});

describe("espejo164: modo 2 — la firma no coincide", () => {
  test("cnt=0 pero cntCualquierFirma>0 -> FALLA distinguiendo 'firma no coincide' de 'no existe'", () => {
    const r = verificarEspejo({
      nombre: "registrar_pago_previo",
      args: "text",
      cnt: 0,
      cntCualquierFirma: 1,
      prosrc: "select 1;",
      migSrc: MIG_REAL,
    });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /NINGUNA con la firma exacta/);
    assert.doesNotMatch(r.motivo, /NO EXISTE/);
  });
});

describe("espejo164: modo 3 — prosrc NULL o vacío en la BD", () => {
  test("prosrc null con firma correcta y migración real -> FALLA (no compara nada)", () => {
    const r = verificarEspejo({
      nombre: "registrar_pago_previo",
      args: ARGS_REGISTRAR,
      cnt: 1,
      cntCualquierFirma: 1,
      prosrc: null,
      migSrc: MIG_REAL,
    });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /NULL o vacío/);
  });

  test("prosrc cadena vacía -> FALLA", () => {
    const r = verificarEspejo({
      nombre: "registrar_pago_previo",
      args: ARGS_REGISTRAR,
      cnt: 1,
      cntCualquierFirma: 1,
      prosrc: "",
      migSrc: MIG_REAL,
    });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /NULL o vacío/);
  });

  test("prosrc solo espacios/whitespace -> FALLA (no basta con no-string-vacío)", () => {
    const r = verificarEspejo({
      nombre: "registrar_pago_previo",
      args: ARGS_REGISTRAR,
      cnt: 1,
      cntCualquierFirma: 1,
      prosrc: "   \n\t  ",
      migSrc: MIG_REAL,
    });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /NULL o vacío/);
  });
});

describe("espejo164: modo 4 — más o menos de una función con esa firma exacta", () => {
  test("cnt=2 (overload inesperado) -> FALLA aunque cntCualquierFirma también sea 2", () => {
    const r = verificarEspejo({
      nombre: "registrar_pago_previo",
      args: ARGS_REGISTRAR,
      cnt: 2,
      cntCualquierFirma: 2,
      prosrc: "cualquier cosa",
      migSrc: MIG_REAL,
    });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /EXACTAMENTE 1 función/);
  });

  test("cnt=0 explícito (no confundir con éxito) -> FALLA", () => {
    const r = verificarEspejo({
      nombre: "registrar_pago_previo",
      args: ARGS_REGISTRAR,
      cnt: 0,
      cntCualquierFirma: 3,
      prosrc: "",
      migSrc: MIG_REAL,
    });
    assert.equal(r.ok, false);
  });

  test("cnt no numérico/NaN nunca se trata como 1 -> FALLA", () => {
    const r = verificarEspejo({
      nombre: "registrar_pago_previo",
      args: ARGS_REGISTRAR,
      cnt: Number("no-es-un-numero"),
      cntCualquierFirma: 1,
      prosrc: "algo",
      migSrc: MIG_REAL,
    });
    assert.equal(r.ok, false);
  });
});

describe("espejo164: modo 6 — la extracción de la migración no encuentra el bloque esperado", () => {
  test("extraerCuerpoMigracion: nombre que no aparece en el texto -> ok:false", () => {
    const r = extraerCuerpoMigracion(MIG_REAL, "funcion_que_no_existe_en_la_164");
    assert.equal(r.ok, false);
    assert.ok(r.motivo, "un resultado ok:false siempre debe traer un motivo");
    assert.match(r.motivo, /no se encontró/);
  });

  test("extraerCuerpoMigracion: DDL presente pero SIN delimitador $$ de apertura -> ok:false", () => {
    const migTruncada = "create or replace function public.registrar_pago_previo(a int) returns void as ";
    const r = extraerCuerpoMigracion(migTruncada, "registrar_pago_previo");
    assert.equal(r.ok, false);
    assert.ok(r.motivo, "un resultado ok:false siempre debe traer un motivo");
    assert.match(r.motivo, /apertura/);
  });

  test("extraerCuerpoMigracion: $$ de apertura sin $$ de cierre (archivo cortado) -> ok:false", () => {
    const migCortada = "create or replace function public.registrar_pago_previo(a int) returns void as $$\nbegin\n  return;\nend;\n-- falta el cierre";
    const r = extraerCuerpoMigracion(migCortada, "registrar_pago_previo");
    assert.equal(r.ok, false);
    assert.ok(r.motivo, "un resultado ok:false siempre debe traer un motivo");
    assert.match(r.motivo, /cierre/);
  });

  test("extraerCuerpoMigracion: bloque vacío ($$$$) -> ok:false", () => {
    const migVacia = "create or replace function public.registrar_pago_previo(a int) returns void as $$$$;";
    const r = extraerCuerpoMigracion(migVacia, "registrar_pago_previo");
    assert.equal(r.ok, false);
    assert.ok(r.motivo, "un resultado ok:false siempre debe traer un motivo");
    assert.match(r.motivo, /quedó vacío/);
  });

  test("verificarEspejo end-to-end: migración sin el bloque -> FALLA (no 'OK' vacío)", () => {
    const r = verificarEspejo({
      nombre: "registrar_pago_previo",
      args: ARGS_REGISTRAR,
      cnt: 1,
      cntCualquierFirma: 1,
      prosrc: "cualquier cuerpo vivo",
      migSrc: "-- migración sin ninguna función de dinero",
    });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /no se encontró/);
  });
});

describe("espejo164: modo 5 — el cuerpo no está realmente contenido en la migración", () => {
  test("prosrc distinto (un carácter) del cuerpo real extraído -> FALLA, no pasa por contención parcial", () => {
    const real = extraerCuerpoMigracion(MIG_REAL, "_huella_pago_previo");
    assert.equal(real.ok, true);
    const prosrcMutado = real.cuerpo.replace("md5(", "md6(");
    assert.notEqual(prosrcMutado, real.cuerpo, "la mutación debe cambiar realmente el texto");
    const r = verificarEspejo({
      nombre: "_huella_pago_previo",
      args: ARGS_HUELLA,
      cnt: 1,
      cntCualquierFirma: 1,
      prosrc: prosrcMutado,
      migSrc: MIG_REAL,
    });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /DIFIERE/);
  });

  test("prosrc que es una SUBCADENA real del cuerpo (no igual) tampoco pasa — igualdad, no contención", () => {
    const real = extraerCuerpoMigracion(MIG_REAL, "_huella_pago_previo");
    assert.equal(real.ok, true);
    const prosrcParcial = real.cuerpo.slice(0, Math.floor(real.cuerpo.length / 2));
    const r = verificarEspejo({
      nombre: "_huella_pago_previo",
      args: ARGS_HUELLA,
      cnt: 1,
      cntCualquierFirma: 1,
      prosrc: prosrcParcial,
      migSrc: MIG_REAL,
    });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /DIFIERE/);
  });

  test("prosrc con texto ajeno pero que SÍ aparece en algún otro lugar de la migración -> FALLA (el bug de includes() ya no puede colarse)", () => {
    // Cualquier fragmento común (ej. "begin") aparece decenas de veces en la
    // migración; con el bug viejo `mig.includes(body)` esto habría pasado
    // como "OK" con un prosrc que no tiene nada que ver con la función real.
    const r = verificarEspejo({
      nombre: "_huella_pago_previo",
      args: ARGS_HUELLA,
      cnt: 1,
      cntCualquierFirma: 1,
      prosrc: "begin",
      migSrc: MIG_REAL,
    });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /DIFIERE/);
  });
});

describe("espejo164: control positivo — debe pasar cuando de verdad es idéntico", () => {
  for (const [nombre, args] of [
    ["registrar_pago_previo", ARGS_REGISTRAR],
    ["anular_pago_previo", ARGS_ANULAR],
    ["_huella_pago_previo", ARGS_HUELLA],
  ] as const) {
    test(`${nombre}: prosrc igual (tras trim) al bloque real de la migración -> OK`, () => {
      const real = extraerCuerpoMigracion(MIG_REAL, nombre);
      assert.equal(real.ok, true, `la extracción real de ${nombre} debe tener éxito`);
      const r = verificarEspejo({
        nombre,
        args,
        cnt: 1,
        cntCualquierFirma: 1,
        prosrc: real.cuerpo,
        migSrc: MIG_REAL,
      });
      assert.equal(r.ok, true, r.motivo);
    });

    test(`${nombre}: espacio en blanco extra alrededor del prosrc no rompe la igualdad (se compara tras trim)`, () => {
      const real = extraerCuerpoMigracion(MIG_REAL, nombre);
      assert.equal(real.ok, true);
      const r = verificarEspejo({
        nombre,
        args,
        cnt: 1,
        cntCualquierFirma: 1,
        prosrc: `\n  ${real.cuerpo.trim()}  \n`,
        migSrc: MIG_REAL,
      });
      assert.equal(r.ok, true, r.motivo);
    });
  }
});

describe("espejo164: extracción real contra la migración 164 (sin fixtures, cruce con producción)", () => {
  test("registrar_pago_previo: el bloque extraído contiene marcadores reales reconocibles de la función", () => {
    const r = extraerCuerpoMigracion(MIG_REAL, "registrar_pago_previo");
    assert.equal(r.ok, true);
    assert.match(r.cuerpo, /v_rol text := public\._autorizado_pago_previo\(p_usuario_id\)/);
  });

  test("anular_pago_previo: el bloque extraído contiene marcadores reales reconocibles de la función", () => {
    const r = extraerCuerpoMigracion(MIG_REAL, "anular_pago_previo");
    assert.equal(r.ok, true);
    assert.match(r.cuerpo, /v_rol text := public\._autorizado_pago_previo\(p_usuario_id\)/);
  });

  test("_huella_pago_previo: el bloque extraído contiene marcadores reales reconocibles de la función", () => {
    const r = extraerCuerpoMigracion(MIG_REAL, "_huella_pago_previo");
    assert.equal(r.ok, true);
    assert.match(r.cuerpo, /select md5\(/);
  });
});
