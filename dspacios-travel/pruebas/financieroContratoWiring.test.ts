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

// SQL plpgsql no usa llaves `{}` para el cuerpo — usa `$$ ... $$`. Extrae
// desde el ancla hasta el `$$;` que cierra el `as $$`.
function cuerpoFuncionSql(fuente: string, ancla: string): string {
  const idx = fuente.indexOf(ancla);
  assert.ok(idx > -1, `no se encontró "${ancla}"`);
  const idxDollar = fuente.indexOf("as $$", idx);
  assert.ok(idxDollar > -1, `no se encontró "as $$" tras "${ancla}"`);
  const idxCierre = fuente.indexOf("$$;", idxDollar + 5);
  assert.ok(idxCierre > -1, `no se encontró el "$$;" que cierra "${ancla}"`);
  return fuente.slice(idx, idxCierre + 3);
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

// ───────────────────────────────────────────────────────────────────────────
// B7 · RONDA 2 — la garantía de la ronda 1 era COMPENSATORIA (dependía de
// que el mismo proceso, en la misma request, alcanzara a llamar a revertir
// cuando algo fallaba). Estas pruebas fijan que los dos flujos usan la
// garantía DURABLE (migración 172): estampan financiero_estado='pendiente'
// al nacer y `confirmarVenta` nunca confirma un contrato con eso incompleto.
// El comportamiento de fondo (qué pasa ante cada punto de interrupción) se
// ejecuta de verdad en pruebas/reconciliacionFinanciera.test.ts y en
// Postgres real en supabase/scripts/test_172_financiero_pendiente_durable.sql.
// ───────────────────────────────────────────────────────────────────────────
const migracion172 = leer("supabase/migrations/20260601000172_financiero_pendiente_durable.sql");

describe("B7 R2 · los dos flujos nacen con financiero_estado='pendiente' explícito", () => {
  for (const [nombre, ancla] of [["reservarDesdeTarifarioInterno", ANCLA_TARIFARIO], ["convertirCotizacionCarrito", ANCLA_CARRITO]] as const) {
    test(`${nombre} estampa financiero_estado: "pendiente" en su insert de ventas`, () => {
      const cuerpo = cuerpoFuncion(reservarActions, ancla);
      assert.match(cuerpo, /financiero_estado:\s*"pendiente"/);
    });
  }
  test("el default de la columna es 'completo', nunca 'pendiente' (no puede afectar otros caminos de creación)", () => {
    assert.match(migracion172, /add column if not exists financiero_estado text not null default 'completo'/);
  });

  test("ambos flujos cierran el estado incluso cuando costo y CxP son cero", () => {
    const tarifario = cuerpoFuncion(reservarActions, ANCLA_TARIFARIO);
    const carrito = cuerpoFuncion(reservarActions, ANCLA_CARRITO);
    assert.doesNotMatch(tarifario, /if\s*\(cxp\.length\s*\|\|\s*Object\.keys\(costosContrato\)\.length\)/);
    assert.doesNotMatch(carrito, /if\s*\(cxp\.length\s*\|\|\s*Object\.keys\(costosGrupo\)\.length\)/);
    assert.match(tarifario, /const fin = await registrarFinancieroContrato/);
    assert.match(carrito, /const fin = await registrarFinancieroContrato/);
  });
});

describe("B7 R2 · confirmarVenta se niega a confirmar con la escritura financiera incompleta", () => {
  test("lee financiero_estado ANTES de marcar 'confirmado' y rechaza si sigue 'pendiente'", () => {
    const cuerpo = cuerpoFuncion(reservarActions, "export async function confirmarVenta(numeroContrato: string)");
    const idxLectura = cuerpo.indexOf('select("financiero_estado")');
    const idxConfirma = cuerpo.indexOf('.update({ estado: "confirmado" })');
    assert.ok(idxLectura > -1, "confirmarVenta debe leer financiero_estado");
    assert.ok(idxConfirma > idxLectura, "debe leer financiero_estado ANTES de confirmar, no después");
    assert.match(cuerpo, /financiero_estado === "pendiente"/);
  });
});

describe("B7 R2 · el orquestador persiste la intención ANTES de intentar el RPC (no solo revertir después)", () => {
  test("financieroContrato.ts declara guardarPendiente como dependencia obligatoria", () => {
    const financieroContrato = leer("lib/reservar/financieroContrato.ts");
    assert.match(financieroContrato, /guardarPendiente:/);
    // El orden importa: se llama ANTES del bloque try/rpc.
    const idxGuardar = financieroContrato.indexOf("deps.guardarPendiente(");
    const idxRpc = financieroContrato.indexOf('deps.rpc("registrar_financiero_contrato"');
    assert.ok(idxGuardar > -1 && idxRpc > idxGuardar, "guardarPendiente debe llamarse antes del RPC financiero");
  });
  test("reservar/actions.ts persiste con upsert (un reintento no puede fallar por clave duplicada)", () => {
    assert.match(reservarActions, /contrato_financiero_pendiente"\)\.upsert\(/);
  });
});

describe("B7 R2 · migración 172 corrige los tres bugs reproducidos empíricamente en la reversión", () => {
  test("bug A: usa el MISMO bypass de inmutabilidad que eliminar_contrato (166), no un mecanismo nuevo", () => {
    const revertir = cuerpoFuncionSql(migracion172, "create or replace function public.revertir_contrato_incompleto(");
    assert.match(revertir, /set local app\.eliminando_contrato = 'true';/);
    assert.match(revertir, /set local app\.eliminando_contrato = 'false';/);
  });
  test("bug B: borra aliados_b2b ANTES de borrar ventas (FK sin cascada)", () => {
    const revertir = cuerpoFuncionSql(migracion172, "create or replace function public.revertir_contrato_incompleto(");
    const idxAliados = revertir.indexOf("delete from public.aliados_b2b");
    const idxVentas = revertir.lastIndexOf("delete from public.ventas");
    assert.ok(idxAliados > -1 && idxVentas > idxAliados, "aliados_b2b debe borrarse antes que ventas");
  });
  test("bug C: el reset de sillas limpia asesor/hotel/acomodacion (antes solo limpiaba plazo/pasajero)", () => {
    const revertir = cuerpoFuncionSql(migracion172, "create or replace function public.revertir_contrato_incompleto(");
    assert.match(revertir, /asesor = null, hotel = null, acomodacion = null/);
  });
});

describe("B7 R3 · un pendiente no puede recibir dinero ni confirmarse por la ruta de abonos", () => {
  test("la migración instala un trigger sobre abonos respaldado por el estado de ventas", () => {
    assert.match(migracion172, /create trigger trg_bloquear_abono_financiero_pendiente/);
    assert.match(migracion172, /before insert or update on public\.abonos/);
    assert.match(migracion172, /v\.financiero_estado = 'pendiente'/);
  });

  test("registrarAbono falla temprano y recalcularEstadoAbono tampoco confirma un pendiente", () => {
    const contratosActions = leer("app/(dashboard)/dashboard/contratos/actions.ts");
    const registrar = cuerpoFuncion(contratosActions, "export async function registrarAbono(");
    const recalcular = cuerpoFuncion(contratosActions, "async function recalcularEstadoAbono(");
    assert.match(registrar, /financiero_estado === "pendiente"/);
    assert.match(recalcular, /venta\.financiero_estado !== "pendiente"/);
  });
});

describe("B7 R3 · reconciliación administrativa falla cerrado", () => {
  const accionesReconciliacion = leer("app/(dashboard)/dashboard/reservar/reconciliacion-actions.ts");
  const rutaCron = leer("app/api/cron/reconciliar-financiero/route.ts");

  test("un error leyendo el payload se propaga; nunca se interpreta como fila ausente", () => {
    assert.match(accionesReconciliacion, /if \(error\) throw new Error\(`No se pudo leer el payload financiero/);
  });

  test("la acción manual exige superadmin y el cron exige el secreto", () => {
    const manual = cuerpoFuncion(accionesReconciliacion, "export async function reconciliarFinancieroPendienteAction(");
    const cron = cuerpoFuncion(accionesReconciliacion, "export async function reconciliarFinancieroPendienteCron(");
    assert.match(manual, /sb\.rpc\("mi_rol"\)/);
    assert.match(manual, /rol !== "superadmin"/);
    assert.match(cron, /secretRecibido !== secret/);
    assert.match(rutaCron, /reconciliarFinancieroPendienteCron\(secret\)/);
  });
});

describe("B7 R2 · el estado 'completo' nace ATÓMICAMENTE con los datos que lo justifican", () => {
  test("registrar_financiero_contrato marca completo y limpia el pendiente en el mismo cuerpo que escribe costos/CxP", () => {
    const registrar = cuerpoFuncionSql(migracion172, "create or replace function public.registrar_financiero_contrato(");
    const idxCosto = registrar.indexOf("update public.ventas v set");
    const idxCompleto = registrar.indexOf("financiero_estado = 'completo'");
    const idxReturn = registrar.lastIndexOf("return jsonb_build_object");
    assert.ok(idxCosto > -1 && idxCompleto > idxCosto && idxCompleto < idxReturn, "completo debe quedar DESPUÉS de escribir costos y ANTES de retornar — nunca en una transacción separada");
  });
});
