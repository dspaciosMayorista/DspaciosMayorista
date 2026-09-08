import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// B7 · GARANTÍAS ESTRUCTURALES de la escritura financiera del contrato.
//
// El comportamiento (qué pasa cuando la escritura falla) se ejecuta de verdad
// en `pruebas/financieroContrato.test.ts` y en Postgres real en
// `supabase/scripts/test_171_financiero_atomico.sql`. Lo que se verifica acá
// es lo que ninguna de las dos puede ver: que los DOS flujos de creación
// afectados por este PR pasen por ese camino y no queden restos del viejo
// "best-effort" (insertar CxP dentro de un `try/catch` que se traga el
// error), porque un flujo que no llame al orquestador seguiría teniendo el
// defecto aunque el orquestador esté perfecto.
// ───────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

function cuerpoFuncion(fuente: string, ancla: string): string {
  const idx = fuente.indexOf(ancla);
  assert.ok(idx > -1, `no se encontró "${ancla}"`);
  let paren = 0, angulo = 0, inicio = -1;
  for (let i = idx; i < fuente.length; i++) {
    const ch = fuente[i];
    if (ch === "(") paren++;
    else if (ch === ")") paren--;
    else if (ch === "<") angulo++;
    else if (ch === ">") angulo--;
    else if (ch === "{" && paren === 0 && angulo === 0) { inicio = i; break; }
  }
  assert.ok(inicio > -1, `no se encontró el cuerpo de "${ancla}"`);
  let prof = 0;
  for (let i = inicio; i < fuente.length; i++) {
    if (fuente[i] === "{") prof++;
    else if (fuente[i] === "}") { prof--; if (prof === 0) return fuente.slice(idx, i + 1); }
  }
  throw new Error(`no se encontró el cierre de "${ancla}"`);
}

const reservarActions = leer("app/(dashboard)/dashboard/reservar/actions.ts");
const migracion = leer("supabase/migrations/20260601000171_financiero_contrato_atomico.sql");

const ANCLA_TARIFARIO = "async function reservarDesdeTarifarioInterno(input: ReservaInput";
const ANCLA_CARRITO = "export async function convertirCotizacionCarrito(";

describe("B7 · los dos flujos escriben lo financiero por la transacción, no por inserts sueltos", () => {
  for (const [nombre, ancla] of [["reservarDesdeTarifarioInterno", ANCLA_TARIFARIO], ["convertirCotizacionCarrito", ANCLA_CARRITO]] as const) {
    test(`${nombre} llama registrarFinancieroContrato`, () => {
      const cuerpo = cuerpoFuncion(reservarActions, ancla);
      assert.match(cuerpo, /registrarFinancieroContrato\(/);
    });
    test(`${nombre} ya no inserta cuentas_por_pagar por su cuenta`, () => {
      const cuerpo = cuerpoFuncion(reservarActions, ancla);
      assert.doesNotMatch(cuerpo, /from\("cuentas_por_pagar"\)\.insert/,
        "un insert directo vuelve a poder fallar en silencio, fuera de la transacción");
    });
    test(`${nombre} no reporta éxito si la escritura financiera falló`, () => {
      const cuerpo = cuerpoFuncion(reservarActions, ancla);
      assert.match(cuerpo, /if \(!fin\.ok\)/, "el resultado de la escritura financiera tiene que revisarse");
    });
  }

  test("reservarDesdeTarifarioInterno ya no actualiza costos con updates sueltos best-effort", () => {
    const cuerpo = cuerpoFuncion(reservarActions, ANCLA_TARIFARIO);
    assert.doesNotMatch(cuerpo, /update\(\{ costo_hotel: costoHotel \}\)/);
    assert.doesNotMatch(cuerpo, /update\(\{ costo_receptivo: costoServiciosTotal \}\)/);
  });

  test("convertirCotizacionCarrito ya no actualiza costos con un update suelto sin revisar el error", () => {
    const cuerpo = cuerpoFuncion(reservarActions, ANCLA_CARRITO);
    assert.doesNotMatch(cuerpo, /update\(\{\s*\n?\s*costo_aereo: costoAereoTotal/);
  });
});

describe("B7 · ninguna salida por error deja un contrato fantasma", () => {
  test("reservarDesdeTarifarioInterno exige service-role ANTES de insertar la venta", () => {
    const cuerpo = cuerpoFuncion(reservarActions, ANCLA_TARIFARIO);
    const idxChequeo = cuerpo.indexOf("No se pudo crear la reserva (configuración del servidor incompleta)");
    const idxInsert = cuerpo.indexOf('from("ventas").insert');
    assert.ok(idxChequeo > -1, "debe seguir existiendo el chequeo de service-role");
    assert.ok(idxInsert > -1);
    assert.ok(idxChequeo < idxInsert, "chequear después de insertar la venta es justo lo que crea el contrato fantasma");
  });

  test("los fallos posteriores al insert revierten (no hay `return { ok: false }` pelado tras crear el contrato)", () => {
    const cuerpo = cuerpoFuncion(reservarActions, ANCLA_TARIFARIO);
    // Se excluye el cuerpo del propio `fallarYRevertir` (su `return` final ES
    // la salida ya revertida) para no confundirlo con una salida pelada.
    const iniHelper = cuerpo.indexOf("const fallarYRevertir = async (motivo: string)");
    assert.ok(iniHelper > -1, "debe existir el helper de reversión");
    const finHelper = cuerpo.indexOf("\n  };", iniHelper);
    const helper = cuerpo.slice(iniHelper, finHelper);
    const desdeInsert = cuerpo.slice(cuerpo.indexOf('from("ventas").insert')).replace(helper, "");
    // La única salida por error permitida sin revertir es la del propio
    // insert fallido (ahí no se creó nada) y la que ya viene revertida por
    // `registrarFinancieroContrato` (fin.error).
    const salidas = desdeInsert.match(/return \{ ok: false, error: [^}]*\}/g) ?? [];
    for (const s of salidas) {
      assert.ok(
        /ve\.message/.test(s) || /fin\.error/.test(s),
        `salida sin reversión tras crear el contrato: ${s}`
      );
    }
    assert.match(desdeInsert, /fallarYRevertir\(/);
  });

  test("convertirCotizacionCarrito revierte el contrato del grupo que falló", () => {
    const cuerpo = cuerpoFuncion(reservarActions, ANCLA_CARRITO);
    assert.match(cuerpo, /fallarYRevertirGrupo\(/);
    assert.match(cuerpo, /revertirContratoIncompleto\(\{ rpc: rpcFinanciero \}, numero, tenantCotizacion\)/);
  });

  test("los costos ya no se calculan dentro de un catch que se los traga", () => {
    const cuerpo = cuerpoFuncion(reservarActions, ANCLA_TARIFARIO);
    assert.doesNotMatch(cuerpo, /El costo neto es informativo para rentabilidad; no bloquea la reserva/);
    assert.doesNotMatch(cuerpo, /No bloquear la reserva si falla la creación automática de CxP/);
    assert.doesNotMatch(cuerpo, /Costo neto\/CxP informativo para el servicio incluido/);
  });
});

describe("B7 · la migración 171 respeta las reglas del proyecto", () => {
  test("las dos funciones son SECURITY DEFINER, con search_path fijo y solo para service_role", () => {
    for (const fn of ["registrar_financiero_contrato", "revertir_contrato_incompleto"]) {
      assert.match(migracion, new RegExp(`revoke all on function public\\.${fn}[^;]*from public, anon, authenticated;`));
      assert.match(migracion, new RegExp(`grant execute on function public\\.${fn}[^;]*to service_role;`));
    }
    const definers = migracion.match(/security definer/g) ?? [];
    assert.equal(definers.length, 2);
    const paths = migracion.match(/set search_path = public, pg_temp/g) ?? [];
    assert.equal(paths.length, 2, "pg_temp siempre al final, igual que el resto de funciones del proyecto");
  });

  test("la reconciliación es por servicio_id (nunca por nombre)", () => {
    assert.match(migracion, /servicio_id/);
    assert.doesNotMatch(migracion, /where[\s\S]{0,80}servicio\s*=\s*v_item->>'servicio'/i);
  });

  test("el reintento nunca borra una CxP manual ni una con dinero movido", () => {
    assert.match(migracion, /observaciones like public\.marca_cxp_automatica\(\)/);
    assert.match(migracion, /not exists \(select 1 from public\.cxp_pagos/);
    assert.match(migracion, /not exists \(select 1 from public\.retenciones_cxp/);
  });

  test("la reversión falla cerrado si ya hubo dinero real", () => {
    const fn = migracion.slice(migracion.indexOf("create or replace function public.revertir_contrato_incompleto"));
    assert.match(fn, /from public\.abonos/);
    assert.match(fn, /no se revierte automáticamente/);
  });

  test("devuelve los ids reemplazados para poder borrar sus asientos (que viven fuera de la transacción)", () => {
    assert.match(migracion, /returning c\.id/);
    assert.match(migracion, /jsonb_build_object\('creadas', v_ids, 'eliminadas', v_eliminadas\)/);
  });
});
