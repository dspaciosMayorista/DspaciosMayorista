// #90 Entrega B / migración 231 — moneda de las tarifas de los Bloqueos.
// Puras (validación y regla contra el paquete) + cableado de los archivos que no tienen otra prueba de ejecución.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  camposTarifaBloqueo,
  mensajeErrorMonedaBloqueo,
  motivoMonedaBloqueoVsPaquete,
  validarMonedaBloqueo,
  validarMonedaBloqueoEdicion,
} from "../lib/vuelos/monedaBloqueo.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

describe("validarMonedaBloqueo (crear): la moneda se elige y COP < 1.000 se rechaza", () => {
  test("sin moneda, vacía o inválida: error; nunca se supone COP", () => {
    for (const m of [undefined, null, "", "EUR", "cop", 1]) {
      const r = validarMonedaBloqueo(m, { tarifaNeta: 200000 });
      assert.equal(r.ok, false, String(m));
      if (!r.ok) assert.match(r.error, /Elige la moneda de las tarifas del Bloqueo/);
    }
  });
  test("COP con un importe positivo menor a 1.000 en neta, reventa o fee: '¿Este valor está en USD?' nombrando el campo", () => {
    const r1 = validarMonedaBloqueo("COP", { tarifaNeta: 380, tarifaParaEmpaquetar: 242022 });
    assert.equal(r1.ok, false);
    if (!r1.ok) assert.match(r1.error, /¿Este valor está en USD\? Tarifa neta \(pago aerolínea\) está en COP/);
    const r2 = validarMonedaBloqueo("COP", { tarifaNeta: 200000, tarifaParaEmpaquetar: "415" });
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.match(r2.error, /Tarifa empaquetar \(reventa\)/);
    const r3 = validarMonedaBloqueo("COP", { tarifaNeta: 200000, tarifaParaEmpaquetar: 242022, feeInfante: 45 });
    assert.equal(r3.ok, false);
    if (!r3.ok) assert.match(r3.error, /Fee de infante/);
    const varios = validarMonedaBloqueo("COP", { tarifaNeta: 380, tarifaParaEmpaquetar: 415, feeInfante: 45 });
    assert.equal(varios.ok, false);
    if (!varios.ok) assert.match(varios.error, /Tarifa neta.*Tarifa empaquetar.*Fee de infante/);
  });
  test("el umbral es 1.000 exclusivo; cero, vacío, nulo y NaN no son sospechosos; USD nunca lo es", () => {
    assert.equal(validarMonedaBloqueo("COP", { tarifaNeta: 999 }).ok, false);
    assert.equal(validarMonedaBloqueo("COP", { tarifaNeta: 999.99 }).ok, false);
    assert.equal(validarMonedaBloqueo("COP", { tarifaNeta: 1000 }).ok, true);
    assert.equal(validarMonedaBloqueo("COP", { tarifaNeta: 0, tarifaParaEmpaquetar: "", feeInfante: null }).ok, true);
    assert.equal(validarMonedaBloqueo("COP", { tarifaNeta: Number.NaN }).ok, true);
    assert.equal(validarMonedaBloqueo("USD", { tarifaNeta: 380, tarifaParaEmpaquetar: 415, feeInfante: 45 }).ok, true);
  });
  test("devuelve la moneda validada", () => {
    assert.deepEqual(validarMonedaBloqueo("USD", {}), { ok: true, moneda: "USD" });
    assert.deepEqual(validarMonedaBloqueo("COP", { tarifaNeta: 200000 }), { ok: true, moneda: "COP" });
  });
  test("camposTarifaBloqueo usa las etiquetas del formulario", () => {
    assert.deepEqual(camposTarifaBloqueo({ tarifaNeta: 1, tarifaParaEmpaquetar: 2, feeInfante: 3 }).map((c) => c.etiqueta),
      ["Tarifa neta (pago aerolínea)", "Tarifa empaquetar (reventa)", "Fee de infante"]);
  });
});

describe("validarMonedaBloqueoEdicion: opcional al editar", () => {
  test("sin moneda (undefined, null, vacía) no se toca la acreditada ni se valida el importe", () => {
    for (const m of [undefined, null, ""]) assert.deepEqual(validarMonedaBloqueoEdicion(m, { feeInfante: 45 }), { ok: true, moneda: null });
  });
  test("con moneda: inválida o COP < 1.000 se rechaza; válida pasa", () => {
    assert.equal(validarMonedaBloqueoEdicion("EUR", {}).ok, false);
    assert.equal(validarMonedaBloqueoEdicion("COP", { feeInfante: 45 }).ok, false);
    assert.deepEqual(validarMonedaBloqueoEdicion("USD", { feeInfante: 45 }), { ok: true, moneda: "USD" });
  });
});

describe("motivoMonedaBloqueoVsPaquete (regla D8, fuera del modo 63)", () => {
  test("misma moneda: no hay motivo", () => {
    assert.equal(motivoMonedaBloqueoVsPaquete("COP", "COP", "L93FYZ"), null);
    assert.equal(motivoMonedaBloqueoVsPaquete("USD", "USD", "L93FYZ"), null);
  });
  test("moneda distinta: rechaza con mensaje claro que nombra el Bloqueo y las dos monedas", () => {
    const m1 = motivoMonedaBloqueoVsPaquete("USD", "COP", "L93FYZ")!;
    assert.match(m1, /Bloqueo L93FYZ está en USD pero este paquete se publica en COP/);
    assert.match(m1, /una sola moneda/);
    const m2 = motivoMonedaBloqueoVsPaquete("COP", "USD", "L93FYZ")!;
    assert.match(m2, /Bloqueo L93FYZ está en COP pero este paquete se publica en USD/);
  });
  test("sin acreditar se lee como COP: pasa en un paquete COP y se rechaza en uno USD", () => {
    for (const m of [null, undefined, ""]) {
      assert.equal(motivoMonedaBloqueoVsPaquete(m, "COP", "L93FYZ"), null);
      assert.match(motivoMonedaBloqueoVsPaquete(m, "USD", "L93FYZ")!, /no tiene la moneda de sus tarifas acreditada y este paquete se publica en USD/);
    }
  });
  test("una moneda inválida guardada se rechaza (defensa en profundidad)", () => {
    assert.match(motivoMonedaBloqueoVsPaquete("EUR", "COP", "L93FYZ")!, /moneda inválida \(EUR\)/);
  });
});

test("mensajeErrorMonedaBloqueo quita el prefijo técnico de la base y respeta los demás mensajes", () => {
  assert.equal(mensajeErrorMonedaBloqueo("MONEDA_BLOQUEO: elige la moneda."), "elige la moneda.");
  assert.equal(mensajeErrorMonedaBloqueo("Ya existe un bloqueo con el record X."), "Ya existe un bloqueo con el record X.");
  assert.equal(mensajeErrorMonedaBloqueo(null), "");
});

describe("cableado", () => {
  const generador = leer("app/(dashboard)/dashboard/paquetes/actions.ts");
  test("generarTarifario lee la moneda del Bloqueo y rechaza una moneda distinta fuera del modo 63", () => {
    assert.match(generador, /bloqueos_vuelo\(id, record, ruta, fecha_ida, fecha_regreso, tarifa_para_empaquetar, fee_infante, moneda\)/);
    const i = generador.indexOf("231 (#90 Entrega B, regla D8)");
    assert.ok(i > 0, "falta el bloque de la 231");
    const bloque = generador.slice(i, i + 900);
    assert.match(bloque, /if \(!modo63\)/);
    assert.match(bloque, /motivoMonedaBloqueoVsPaquete\(v\.b\.moneda/);
    assert.match(bloque, /return await fallar\(motivo\)/);
  });
  test("la guarda de Bloqueos va antes que la de Empaquetados y después de calcular la moneda del paquete", () => {
    assert.ok(generador.indexOf("paqueteMoneda = monedasHotel[0]") < generador.indexOf("231 (#90 Entrega B, regla D8)"));
    assert.ok(generador.indexOf("231 (#90 Entrega B, regla D8)") < generador.indexOf("230 (regla D8): fuera del modo cop_trm_63"));
  });
  test("la acción de crear exige y manda la moneda; editar la manda solo si viene; el CSV la exige por fila", () => {
    const a = leer("app/(dashboard)/dashboard/vuelos/actions.ts");
    assert.match(a, /moneda: MonedaVuelo;/);
    assert.match(a, /validarMonedaBloqueo\(input\.moneda, input\)/);
    assert.match(a, /moneda: input\.moneda,/);
    assert.match(a, /\.\.\.\(monedaOk\.moneda \? \{ moneda: monedaOk\.moneda \} : \{\}\)/);
    assert.match(a, /moneda debe ser "COP" o "USD" \(columna obligatoria\)/);
  });
  test("el listado muestra la columna Moneda (también en el histórico) y la plantilla CSV la incluye", () => {
    assert.match(leer("app/(dashboard)/dashboard/vuelos/BloqueosTabla.tsx"), /<th className="px-3 py-2">Moneda<\/th>/);
    assert.match(leer("app/(dashboard)/dashboard/vuelos/page.tsx"), /moneda: b\.moneda \?\? null/);
    assert.match(leer("app/(dashboard)/dashboard/vuelos/historico/page.tsx"), /moneda: b\.moneda \?\? null/);
    assert.match(leer("app/(dashboard)/dashboard/vuelos/page.tsx"), /key: "moneda", label: "Moneda de las tarifas \(COP\/USD, obligatoria\)"/);
  });
  test("los dos formularios reutilizan MonedaTarifas", () => {
    for (const f of ["app/(dashboard)/dashboard/vuelos/NuevoBloqueoForm.tsx", "app/(dashboard)/dashboard/vuelos/[id]/EditarBloqueoForm.tsx"]) {
      assert.match(leer(f), /import \{ MonedaTarifas \} from "@\/components\/vuelos\/MonedaTarifas"/, f);
      assert.match(leer(f), /<MonedaTarifas/, f);
    }
  });
});

describe("migración 231 y scripts", () => {
  const migraciones = readdirSync(new URL("../supabase/migrations/", import.meta.url)).sort();
  const f231 = migraciones.filter((n) => /^20260601000231_/.test(n));
  test("hay exactamente una migración 231 y es la siguiente a la 230", () => {
    assert.deepEqual(f231, ["20260601000231_moneda_bloqueos.sql"]);
    assert.equal(migraciones.filter((n) => /^20260601000230_/.test(n)).length, 1);
  });
  const sql = leer("supabase/migrations/20260601000231_moneda_bloqueos.sql");
  test("agrega la moneda con CHECK COP/USD, la constancia y el invariante moneda <-> constancia", () => {
    assert.match(sql, /add column moneda text/);
    assert.match(sql, /check \(moneda is null or moneda in \('COP', 'USD'\)\)/);
    assert.match(sql, /add column moneda_acreditada_en timestamptz/);
    assert.match(sql, /bloqueos_vuelo_moneda_constancia_chk check \(\(moneda is null\) = \(moneda_acreditada_en is null\)\)/);
  });
  test("la constancia la escribe el trigger (servidor), no es reversible a NULL y rechaza COP < 1.000", () => {
    assert.match(sql, /NEW\.moneda_acreditada_por := auth\.uid\(\)/);
    assert.match(sql, /current_setting\('p90\.moneda_ref', true\)/);
    assert.match(sql, /una moneda ya acreditada no se puede dejar en blanco/);
    assert.match(sql, /¿Este valor está en USD\?/);
  });
  test("el interruptor estricto nace APAGADO y está en un esquema privado", () => {
    assert.match(sql, /exigir_moneda_bloqueo boolean not null default false/);
    assert.match(sql, /revoke all on schema p90_priv from public, anon, authenticated/);
  });
  test("la invalidación del tarifario vigila la moneda y exceptúa solo NULL -> COP", () => {
    assert.match(sql, /update of tarifa_para_empaquetar, fee_infante, fecha_ida, fecha_regreso, ruta, moneda/);
    assert.match(sql, /OLD\.moneda is null and NEW\.moneda = 'COP'/);
  });
  test("crear_bloqueo recibe la moneda y no la supone", () => {
    assert.match(sql, /v_moneda := nullif\(upper\(btrim\(coalesce\(p_datos ->> 'moneda', ''\)\)\), ''\)/);
    assert.doesNotMatch(sql, /coalesce\(v_moneda, 'COP'\)/);
  });
  test("la migración no actualiza ni borra datos de negocio (los inserts son solo de crear_bloqueo y de la fila del interruptor)", () => {
    assert.doesNotMatch(sql, /\b(update|delete)\s+(from\s+)?public\./i);
  });
  test("existen preflight/postcheck integral, acreditación en bloque y rollbacks de estructura y datos", () => {
    const scripts = readdirSync(new URL("../supabase/scripts/", import.meta.url));
    for (const n of [
      "preflight_postcheck_231_moneda_bloqueos.sql",
      "acreditar_231_bloqueos_cop.sql",
      "rollback_231_moneda_bloqueos.sql",
      "rollback_231_acreditacion_datos.sql",
      "encender_231_moneda_obligatoria.sql",
    ]) assert.ok(scripts.includes(n), `falta ${n}`);
  });
  test("la acreditación en bloque aborta si hay neta o reventa positiva < 1.000 y deja constancia de la decisión D2", () => {
    const s = leer("supabase/scripts/acreditar_231_bloqueos_cop.sql");
    assert.match(s, /< 1000/);
    assert.match(s, /raise exception/);
    assert.match(s, /D2/);
    assert.match(s, /set_config\('p90\.moneda_ref'/);
    assert.match(s, /moneda is null/);
  });
  test("control 20: paquetes activos en USD con Bloqueo sin acreditar o no USD; lee la moneda por jsonb (sirve antes y después de la 231)", () => {
    const s = leer("supabase/scripts/preflight_postcheck_231_moneda_bloqueos.sql");
    assert.match(s, /join bm on bm\.id = av\.bloqueo_id/);
    assert.match(s, /p\.moneda = 'USD' and bm\.moneda is distinct from 'USD'/);
    assert.match(s, /'paquetes_activos_en_usd_con_bloqueo_sin_acreditar_o_no_usd'/);
    assert.doesNotMatch(s, /'paquetes_activos_en_usd_con_bloqueo'/, "el nombre viejo del control ya no existe");
    assert.match(s, /j ->> 'moneda' as moneda/, "bm lee la moneda con to_jsonb: la columna puede no existir todavía");
    assert.doesNotMatch(s, /\bb\.moneda\b|\bx\.moneda\b/, "ninguna referencia directa a la columna moneda de bloqueos_vuelo");
  });
  test("el interruptor estricto es un paso OBLIGATORIO: el postcheck lo exige OK y solo es INFO mientras falte acreditar", () => {
    const s = leer("supabase/scripts/preflight_postcheck_231_moneda_bloqueos.sql");
    assert.match(s, /'encendido \(paso OBLIGATORIO tras acreditar los 95\)'/);
    assert.match(s, /when \(select v from estricto\) = 'true' then 'OK'/);
    assert.match(s, /when \(select count\(\*\) from bm where moneda is null\) > 0 then 'INFO'\s+else 'REVISAR' end/);
    for (const f of [
      "supabase/scripts/encender_231_moneda_obligatoria.sql",
      "supabase/scripts/acreditar_231_bloqueos_cop.sql",
      "supabase/migrations/20260601000231_moneda_bloqueos.sql",
      "docs/tecnico/vuelos-inventario.md",
    ]) {
      const t = leer(f);
      assert.match(t, /OBLIGATORIO|obligatorio/, f);
      assert.doesNotMatch(t, /\(opcional\) encender|paso OPCIONAL|paso opcional/i, `${f} aún llama opcional al interruptor`);
    }
  });
  test("las fases cubren el control 20 (USD válido, NULL, COP, antes de la 231) y el postcheck FINAL con el interruptor encendido", () => {
    const f = leer("supabase/scripts/test_231_fases.sh");
    for (const marca of ["F1.4", "F3.1", "F3.2", "F3.3", "F3.4", "F7.2b"]) assert.ok(f.includes(`"${marca} `), `falta ${marca}`);
    assert.match(f, /\$C20\|0\|0\|OK/);
    assert.match(f, /\$C20\|1\|0\|REVISAR/);
    assert.match(f, /interruptor_estricto\\\|encendido/);
  });
  test("preflight y postcheck son UNA consulta con control, valor, esperado y estado", () => {
    const s = leer("supabase/scripts/preflight_postcheck_231_moneda_bloqueos.sql");
    assert.match(s, /select control, valor, esperado, estado/);
    // Una sola sentencia: un único punto y coma final.
    const sinComentarios = s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    assert.equal((sinComentarios.match(/;/g) ?? []).length, 1);
  });
});
