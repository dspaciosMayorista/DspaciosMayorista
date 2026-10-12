// Guarda de los scripts preparados (NO ejecutados) de #14 / PR #353:
//   · conteo_payload_costos_incluidos.sql — cotizaciones con costos en el payload;
//   · conteo_incluidos_sin_proveedor.sql — incluidos con costo y sin proveedor.
// Ambos: solo lectura, solo conteos agregados, sin PII, importes ni payloads.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const leer = (rel: string) => readFileSync(join(import.meta.dirname, "..", rel), "utf8")
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

/** Columnas de salida de cada SELECT de primer nivel (líneas que empiezan con `select`). */
function columnasDeSalida(codigo: string, desde: string): string[][] {
  const bloques = codigo.split(/^select$/m).slice(1);
  return bloques.map((b) => b.slice(0, b.indexOf(desde)).split(/,\s*\n/).map((c) => c.trim().replace(/\s+/g, " ")));
}

const PROHIBIDO = /cliente|documento|email|creado_por|telefono|nombre|precio_venta|valor_total|monto|->>\s*'(costoNeto|proveedorId)'|payload\s*(,|$)/i;

describe("conteo_payload_costos_incluidos.sql", () => {
  const codigo = leer("supabase/scripts/conteo_payload_costos_incluidos.sql");

  test("transacción de solo lectura que termina en rollback", () => {
    assert.match(codigo, /^begin read only;$/m);
    assert.match(codigo, /^rollback;$/m);
    assert.doesNotMatch(codigo, /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke)\b/i);
  });

  test("dos consultas de conteos por agencia, (estado) y mes — sin PII, importes ni payloads", () => {
    const salidas = columnasDeSalida(codigo, "from public.cotizaciones");
    assert.equal(salidas.length, 2);
    for (const cols of salidas) {
      assert.ok(cols.every((c) => /^c\.tenant$|^c\.estado$|^date_trunc\('month', c\.created_at\)::date as mes$|^count\(\*\)/.test(c)), `columnas inesperadas: ${cols.join(" | ")}`);
      assert.doesNotMatch(cols.join(" "), PROHIBIDO);
    }
  });

  test("todo acceso a payload está protegido contra formas inesperadas (sin errores de cast ni de arreglo)", () => {
    for (const m of codigo.matchAll(/jsonb_array_(elements|length)\(([^)]*)/g)) {
      assert.match(m[2], /^case when jsonb_typeof\(/, `acceso sin guarda: ${m[0]}`);
    }
    // Sin casts sobre valores del payload: un paqueteId fuera del rango de
    // bigint abortaría la consulta aunque "solo tenga dígitos".
    assert.doesNotMatch(codigo, /::\s*(bigint|int|integer|numeric)\b/i);
    assert.match(codigo, /a\.paquete_id::text = it ->> 'paqueteId'/);
  });
});

describe("conteo_incluidos_sin_proveedor.sql", () => {
  const codigo = leer("supabase/scripts/conteo_incluidos_sin_proveedor.sql");

  test("transacción de solo lectura que termina en rollback", () => {
    assert.match(codigo, /^begin read only;$/m);
    assert.match(codigo, /^rollback;$/m);
    assert.doesNotMatch(codigo, /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke)\b/i);
  });

  test("devuelve id de paquete, si está activo y conteos — sin nombres, PII ni importes", () => {
    const [cols] = columnasDeSalida(codigo, "from incluidos i");
    assert.ok(cols.every((c) => /^i\.paquete_id$|^p\.activo as paquete_activo$|^count\(\*\)/.test(c)), `columnas inesperadas: ${cols.join(" | ")}`);
    assert.doesNotMatch(cols.join(" "), /nombre|precio|proveedor_id\b|valor|monto/i);
  });

  test("replica la regla de costo de la conversión: persona por precio_persona, grupo por rangos GENERAL", () => {
    assert.match(codigo, /when a\.modo = 'persona' then coalesce\(s\.precio_persona, 0\) > 0/);
    assert.match(codigo, /t\.temporada = 'GENERAL' and t\.precio > 0/);
    assert.match(codigo, /s\.proveedor_id is null as sin_proveedor/);
    assert.match(codigo, /where a\.incluido = true/);
  });

  test("modo NULL cuenta como no válido en el conteo y en el HAVING (nunca `not in`, que con NULL da NULL)", () => {
    assert.match(codigo, /coalesce\(a\.modo in \('persona', 'grupo'\), false\) as modo_valido/);
    assert.equal((codigo.match(/where not i\.modo_valido/g) ?? []).length, 2, "select y having");
    assert.doesNotMatch(codigo, /modo\s+not\s+in/i);
  });
});

describe("test_conteos_incluidos.sh (prueba local con Docker)", () => {
  const sh = readFileSync(join(import.meta.dirname, "..", "supabase/scripts/test_conteos_incluidos.sh"), "utf8");
  test("solo base local desechable: contenedor propio, sin hosts ni llaves remotas", () => {
    assert.match(sh, /docker run -d --rm --name "\$CT"/);
    assert.match(sh, /trap 'docker rm -f "\$CT"/);
    assert.doesNotMatch(sh, /supabase\.co|SUPABASE_|DATABASE_URL|PGHOST=|--host(?!=127)/i);
  });
  test("cubre los bordes: modo NULL y paqueteId fuera del rango de bigint (texto y número JSON)", () => {
    assert.match(sh, /\(38, 14, null, true\)/);
    assert.match(sh, /"paqueteId":"99999999999999999999"/);
    assert.match(sh, /"paqueteId":99999999999999999999/);
    assert.match(sh, /un error SQL se reporta como FALLO/);
  });
});
