import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAMPOS_OBSERVACION,
  FUENTES_PERSONA,
  NIVELES_CAPTURA,
  ROLES_AMBOS_TENANTS,
  ROLES_CONSULTA_PERSONAS,
} from "../lib/personas/fuentes.ts";
import { TIPOS_DOC_PERSONA, NUMERO_MAX, NUMERO_MIN, ORIGINAL_MAX_PUNTOS } from "../lib/personas/identidad.ts";

// #32 / migración 214 — cableado estático entre el código TS, la migración y los scripts.
// No reemplaza a las pruebas de comportamiento (vectores, SQL y runner): detecta que una pieza
// diverja de las otras sin que nadie lo note.

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");
const identidad = leer("../lib/personas/identidad.ts");
const consulta = leer("../lib/personas/consulta.ts");
const migracion = leer("../supabase/migrations/20260601000214_personas_identidad.sql");
const testSql = leer("../supabase/scripts/test_214_personas_identidad.sql");
const runner = leer("../supabase/scripts/test_214_personas_carreras.sh");
const tipos = leer("../types/database.ts");

/** Código SQL sin comentarios de línea (los comentarios pueden nombrar lo que el código NO usa). */
const sqlSinComentarios = migracion
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

/** Lista de literales de `campo in ('a', 'b', ...)` dentro de un fragmento. */
function listaIn(fragmento: string, columna: string): string[] {
  const m = fragmento.match(new RegExp(`${columna} in \\(([^)]*)\\)`));
  assert.ok(m, `no se encontró "${columna} in (...)"`);
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}

/** Bloque `create table if not exists public.<tabla> ( ... );`. */
function bloqueTabla(tabla: string): string {
  const inicio = migracion.indexOf(`create table if not exists public.${tabla} (`);
  assert.ok(inicio >= 0, `no está la tabla ${tabla}`);
  return migracion.slice(inicio, migracion.indexOf("\n);", inicio));
}

describe("gramática TypeScript: solo ASCII explícito", () => {
  test("sin trim, cambios de caja por locale, normalización Unicode ni RegExp dinámicas", () => {
    for (const prohibido of [".trim(", "toUpperCase(", "toLowerCase(", "normalize(", "localeCompare(", "new RegExp("]) {
      assert.ok(!identidad.includes(prohibido), `lib/personas/identidad.ts contiene ${prohibido}`);
    }
  });

  test("sin clases de dígito, espacio o palabra con barra invertida", () => {
    for (const clase of ["\\d", "\\s", "\\w", "\\D", "\\S", "\\W"]) {
      assert.ok(!identidad.includes(clase), `lib/personas/identidad.ts contiene ${clase}`);
    }
  });

  test("las expresiones regulares no usan banderas i, u ni v", () => {
    // Solo código (sin comentarios) y solo literales que empiezan con /^ o /[ (las de la gramática).
    const codigo = identidad
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l))
      .join("\n");
    const literales = codigo.match(/\/(?:\^|\[)(?:\\.|[^/\n])*\/[a-z]*/g) ?? [];
    assert.ok(literales.length >= 6, "se esperaban las expresiones de la gramática");
    for (const lit of literales) {
      const banderas = lit.slice(lit.lastIndexOf("/") + 1);
      assert.ok(!/[iuv]/.test(banderas), `expresión con banderas no permitidas: ${lit}`);
    }
  });
});

describe("catálogos: TS y CHECK de la migración son los mismos", () => {
  test("tipos de documento (norm_documento)", () => {
    assert.deepEqual(listaIn(sqlSinComentarios, "v_t not"), [...TIPOS_DOC_PERSONA]);
  });

  test("fuentes y niveles de persona_capturas", () => {
    const capturas = bloqueTabla("persona_capturas");
    assert.deepEqual(listaIn(capturas, "check \\(fuente"), [...FUENTES_PERSONA]);
    assert.deepEqual(listaIn(capturas, "check \\(nivel"), [...NIVELES_CAPTURA]);
  });

  test("campos de persona_observaciones", () => {
    const obs = bloqueTabla("persona_observaciones");
    assert.deepEqual(listaIn(obs, "check \\(campo"), [...CAMPOS_OBSERVACION]);
  });

  test("roles de la consulta y roles con ambos tenants", () => {
    const rpc = sqlSinComentarios.slice(sqlSinComentarios.indexOf("create or replace function public.buscar_personas_documento"));
    assert.deepEqual(listaIn(rpc, "v_rol not"), [...ROLES_CONSULTA_PERSONAS]);
    assert.deepEqual(listaIn(rpc, "if v_rol"), [...ROLES_AMBOS_TENANTS]);
  });

  test("límites de la gramática: 3-20 normalizados y 64 puntos de código por original", () => {
    assert.equal(NUMERO_MIN, 3);
    assert.equal(NUMERO_MAX, 20);
    assert.equal(ORIGINAL_MAX_PUNTOS, 64);
    assert.ok(sqlSinComentarios.includes("char_length(v_c) < 3 or char_length(v_c) > 20"));
    assert.ok(sqlSinComentarios.includes("char_length(tipo_doc_original) <= 64"));
  });
});

describe("migración 214: estructura que el contrato exige", () => {
  test("las cuatro generadas se calculan SOLO desde columnas base", () => {
    for (const campo of ["tipo_doc", "numero_norm", "estado", "motivo"]) {
      assert.ok(
        migracion.includes(`((p214_priv.norm_documento(tipo_doc_original, documento_original, nit_dv_estructurado, 'alta')).${campo})`),
        `la generada de ${campo} no usa exactamente las tres columnas base`
      );
    }
  });

  test("persona_observaciones no tiene columnas de fuente ni de origen (viven en la captura)", () => {
    const obs = bloqueTabla("persona_observaciones");
    for (const columna of ["fuente ", "contrato_numero", "nivel ", "actor_id", "contrato_pasajero_id"]) {
      assert.ok(!obs.includes(columna), `persona_observaciones declara ${columna.trim()}`);
    }
    assert.ok(obs.includes("unique (captura_id, campo, valor)"), "falta la idempotencia por captura");
    assert.ok(!/unique \([^)]*coalesce/.test(sqlSinComentarios), "una expresión no cabe en un UNIQUE de tabla");
  });

  test("el código SQL no usa los helpers globales con deuda ni soy_asesor_del_contrato", () => {
    for (const prohibido of ["soy_asesor_del_contrato", "mi_rol(", "mi_tenant(", "puede_ver_tenant("]) {
      assert.ok(!sqlSinComentarios.includes(prohibido), `la 214 usa ${prohibido}`);
    }
    assert.ok(sqlSinComentarios.includes("public.soy_ese_asesor(v.asesor)"), "el asesor debe compararse en la misma fila (v.asesor)");
  });

  test("toda función fija search_path = pg_catalog, pg_temp", () => {
    const funciones = (sqlSinComentarios.match(/create or replace function/g) ?? []).length;
    const fijadas = (sqlSinComentarios.match(/set search_path = pg_catalog, pg_temp/g) ?? []).length;
    assert.equal(funciones, 16);
    assert.equal(fijadas, funciones);
  });

  test("la consulta es SECURITY DEFINER y solo authenticated la ejecuta", () => {
    assert.ok(/function public\.buscar_personas_documento[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog, pg_temp/.test(sqlSinComentarios));
    assert.ok(sqlSinComentarios.includes("from public, anon, authenticated, service_role;\ngrant execute on function public.buscar_personas_documento(text, text, text, integer, integer) to authenticated;"));
  });

  test("las tablas no se conceden a anon ni authenticated", () => {
    assert.ok(sqlSinComentarios.includes("revoke all on table public.personas, public.persona_capturas, public.persona_observaciones\n  from public, anon, authenticated, service_role;"));
    assert.ok(!/grant [^;]* on table public\.persona[^;]* to [^;]*(anon|authenticated)/.test(sqlSinComentarios));
  });

  test("paginación efectiva: 50 observaciones y 10 valores por campo, iguales en la RPC y en el cliente", () => {
    assert.ok(sqlSinComentarios.includes("p_limite < 1 or p_limite > 50"));
    assert.ok(sqlSinComentarios.includes("m.rn <= 10"));
    assert.ok(sqlSinComentarios.includes("greatest(pc.n_valores - 10, 0)"));
    assert.ok(consulta.includes("LIMITE_MAX_OBSERVACIONES = 50"));
    assert.ok(consulta.includes("VALORES_POR_CAMPO_MAX = 10"));
  });
});

describe("cliente y scripts", () => {
  test("consulta.ts solo llama a la RPC y nunca lee las tablas", () => {
    assert.ok(consulta.includes('sb.rpc("buscar_personas_documento"'));
    assert.ok(!consulta.includes(".from("), "consulta.ts no debe leer tablas");
  });

  test("types/database.ts declara solo la RPC nueva", () => {
    assert.ok(tipos.includes("buscar_personas_documento: {"));
    assert.ok(!/\n {6}personas: \{/.test(tipos), "no se tipan las tablas: la app no las lee");
  });

  test("la prueba SQL y el runner usan el MISMO archivo de vectores", () => {
    assert.ok(testSql.includes("/tmp/personasIdentidad.vectores.json"));
    assert.ok(runner.includes('VECTORES="$APP/pruebas/fixtures/personasIdentidad.vectores.json"'));
    assert.ok(runner.includes("cat > /tmp/personasIdentidad.vectores.json"));
  });
});
