import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// #75 · migración 287 — cableado entre la base y la aplicación. Las garantías de comportamiento (carreras,
// bloqueos, fallo de creación…) se prueban contra Postgres real en supabase/scripts/test_287_reuso_consecutivos_dtm.sh.
function leer(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

describe("numeracion.ts usa la reserva con ticket (287)", () => {
  const src = leer("lib/contrato/numeracion.ts");
  test("llama a reservar_numero_contrato con service_role y devuelve el ticket", () => {
    assert.match(src, /rpc\("reservar_numero_contrato"/);
    assert.match(src, /createAdminClient/);
    assert.doesNotMatch(src, /rpc\("siguiente_numero_contrato_para_tenant"/);
  });
});

describe("los 4 creadores de contratos envían el ticket en el INSERT de ventas", () => {
  const archivos = ["app/(dashboard)/dashboard/contratos/actions.ts", "app/(dashboard)/dashboard/reservar/actions.ts"];
  test("cada INSERT con numero_contrato: numero lleva reserva_token", () => {
    let inserts = 0;
    for (const a of archivos) {
      const src = leer(a);
      const re = /from\("ventas"\)\.insert\(\{\n(\s*)numero_contrato: numero,\n/g;
      for (const m of src.matchAll(re)) {
        inserts++;
        const sig = src.slice(m.index! + m[0].length, m.index! + m[0].length + 80);
        assert.match(sig, /^\s*reserva_token: reservaToken,/, `${a}: el INSERT de ventas no envía reserva_token`);
      }
    }
    assert.equal(inserts, 4, "se esperaban 4 INSERT de ventas con numero_contrato: numero (contratos/actions + 3 en reservar/actions)");
  });
  test("el ticket sale de la reserva (numRes.reservaToken), nunca del navegador", () => {
    for (const a of archivos) {
      const src = leer(a);
      assert.match(src, /reservaToken = numRes\.reservaToken \?\? null/);
      assert.doesNotMatch(src, /reserva_token: input\./);
    }
  });
});

describe("migración 287 — garantías declaradas en el SQL", () => {
  const sql = leer("supabase/migrations/20260601000287_reuso_consecutivos_dtm.sql");
  test("no toca la 281 ni fn_renumerar_contrato ni el pool de Minorista", () => {
    assert.doesNotMatch(sql, /create (or replace )?function public\.fn_renumerar_contrato/i);
    assert.doesNotMatch(sql, /alter table public\.numeros_contrato_liberados/i);
    assert.doesNotMatch(sql, /(delete|update) (from )?public\.auditoria/i);
  });
  test("la elegibilidad falla cerrado y escanea relaciones de forma dinámica", () => {
    assert.match(sql, /LECTURA_FALLIDA/);
    assert.match(sql, /exception when others then/);
    assert.match(sql, /contrato_numero/);
    assert.match(sql, /confrelid = 'public\.ventas'::regclass/);
  });
  test("eliminar_contrato bloquea la venta, evalúa ANTES de borrar y libera en la misma función", () => {
    const cuerpo = sql.slice(sql.indexOf("create or replace function public.eliminar_contrato"));
    const iFor = cuerpo.indexOf("for update");
    const iEval = cuerpo.indexOf("dtm_reuso_bloqueos(p_numero, true)");
    const iBorra = cuerpo.indexOf("delete from public.ventas where numero_contrato = p_numero");
    const iPool = cuerpo.indexOf("insert into public.numeros_dtm_liberados");
    assert.ok(iFor > -1 && iFor < iEval && iEval < iBorra && iBorra < iPool, "orden esperado: for update → elegibilidad → delete ventas → insert en el pool");
  });
  test("el generador usa SKIP LOCKED, re-verifica y la reserva vence a los 30 minutos", () => {
    assert.match(sql, /for update skip locked/);
    assert.match(sql, /dtm_reuso_bloqueos\(r\.numero, false\)/);
    assert.match(sql, /interval '30 minutes'/);
  });
  test("el reuso nace DESHABILITADO y la cabecera NO da por aceptado el riesgo de escrituras antiguas", () => {
    assert.match(sql, /insert into public\.dtm_reuso_config\(habilitado, nota\)\s+values \(false,/);
    assert.match(sql, /REUSO_DESHABILITADO/);
    assert.match(sql, /RIESGO ABIERTO/);
    assert.doesNotMatch(sql, /aceptado al no separar vidas/);
    assert.doesNotMatch(sql, /\(aceptado por el dueño o documentados\)/);
  });
  test("el pool se recorre por consecutivo NUMÉRICO (DTM-9999 antes que DTM-10000), no por texto", () => {
    assert.match(sql, /order by substring\(p\.numero from '\[0-9\]\+\$'\)::bigint, p\.numero/);
    assert.doesNotMatch(sql, /order by p\.numero\s*\n\s*limit 1/);
  });
  test("el pool no es accesible a anon/authenticated para escribir y reservar es solo service_role", () => {
    assert.match(sql, /revoke all on public\.numeros_dtm_liberados from public, anon, authenticated/);
    assert.match(sql, /grant execute on function public\.reservar_numero_contrato\(text\) to service_role/);
    assert.doesNotMatch(sql, /grant execute on function public\.(reservar_numero_contrato|dtm_reuso_bloqueos)\(.*\) to (anon|authenticated)/);
  });
});
