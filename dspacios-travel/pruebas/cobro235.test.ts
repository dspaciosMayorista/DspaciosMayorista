// #90 Entrega F (235) — MONEDA DE COBRO del contrato: reglas puras, recorrido de la aceptación en el servidor y cableado (texto) de la migración,
// las acciones de abono, la cartera, el estado de cuenta y los documentos. La base se prueba en supabase/scripts/test_235_moneda_cobro.sql.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cobroDeVenta, totalCobroConvertido, validarEleccionCobro, MENSAJE_COBRO_INVALIDO, MENSAJE_COBRO_REQUERIDO, MENSAJE_COBRO_SOLO_INTERNO, MENSAJE_TRM_COBRO_INVALIDA, MENSAJE_TRM_COBRO_REQUERIDA,
} from "../lib/finanzas/cobro.ts";
import { leerAceptacion63, leerCobro63, mapearErrorRpc63, MENSAJE_COBRO_CAMBIO_63, MENSAJE_TECNICO_63 } from "../lib/reservar/aceptacion63.ts";
import { aceptarOferta63 } from "../lib/reservar/aceptacionServidor63.ts";

const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("totalCobroConvertido: espejo de p63_total_cobro (una sola conversión, redondeo de venta)", () => {
  test("USD→COP = base × TRM con COP al mil hacia arriba", () => {
    assert.equal(totalCobroConvertido(1200, "USD", "COP", 4100), 4_920_000);
    assert.equal(totalCobroConvertido(1200, "USD", "COP", 4000.5), 4_801_000, "4.800.600 sube al mil");
    assert.equal(totalCobroConvertido(1, "USD", "COP", 4000.01), 5_000, "4.000,01 sube al siguiente mil");
  });
  test("COP→USD = base / TRM con USD al dólar hacia arriba", () => {
    assert.equal(totalCobroConvertido(4_800_000, "COP", "USD", 4000), 1200);
    assert.equal(totalCobroConvertido(4_801_000, "COP", "USD", 4000), 1201, "1.200,25 sube al dólar");
    assert.equal(totalCobroConvertido(3_360_000, "COP", "USD", 4000), 840);
  });
  test("misma moneda o sin TRM válida: no hay total (no se convierte dos veces ni a 1)", () => {
    assert.equal(totalCobroConvertido(1200, "USD", "USD", 4000), null);
    assert.equal(totalCobroConvertido(1200, "COP", "COP", null), null);
    for (const trm of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(totalCobroConvertido(1200, "USD", "COP", trm as never), null);
  });
  test("es determinista ante el ruido de coma flotante (0,1 + 0,2 no sube un mil de más)", () => {
    // 0.1 * 3 = 0.30000000000000004 en coma flotante: a centavos son 0,30 y el total exacto de 3.000 no debe saltar a 4.000.
    assert.equal(totalCobroConvertido(0.1, "USD", "COP", 30_000), 3_000);
    assert.equal(totalCobroConvertido(1234.56, "USD", "COP", 1000), 1_235_000);
  });
});

describe("validarEleccionCobro: elección EXPRESA, solo personal interno, TRM obligatoria cuando difiere", () => {
  const base = { monedaOferta: "USD", esInterno: true };
  test("la elección es OBLIGATORIA: sin moneda (null, undefined o vacía) se rechaza, no hay valor por defecto", () => {
    for (const vacia of [null, undefined, "", "  "]) {
      assert.deepEqual(validarEleccionCobro({ ...base, monedaCobro: vacia, trmCobro: null }), { ok: false, error: MENSAJE_COBRO_REQUERIDO });
      assert.deepEqual(validarEleccionCobro({ ...base, esInterno: false, monedaCobro: vacia, trmCobro: "" }), { ok: false, error: MENSAJE_COBRO_REQUERIDO });
    }
  });
  test("elegir expresamente la misma moneda de la oferta es válido y queda registrado (COP y USD), sin TRM", () => {
    assert.deepEqual(validarEleccionCobro({ monedaOferta: "COP", monedaCobro: "COP", trmCobro: null, esInterno: true }), { ok: true, monedaCobro: "COP", trmCobro: null });
    assert.deepEqual(validarEleccionCobro({ monedaOferta: "USD", monedaCobro: "usd", trmCobro: null, esInterno: false }), { ok: true, monedaCobro: "USD", trmCobro: null });
  });
  test("una TRM sin moneda es ambigua: se rechaza", () => {
    assert.deepEqual(validarEleccionCobro({ ...base, monedaCobro: null, trmCobro: 4100 }), { ok: false, error: MENSAJE_COBRO_INVALIDO });
  });
  test("la misma moneda de la oferta nunca lleva TRM (aunque llegue una)", () => {
    assert.deepEqual(validarEleccionCobro({ ...base, monedaCobro: "USD", trmCobro: 4100 }), { ok: true, monedaCobro: "USD", trmCobro: null });
    assert.deepEqual(validarEleccionCobro({ ...base, monedaCobro: "usd", trmCobro: null }), { ok: true, monedaCobro: "USD", trmCobro: null });
  });
  test("la otra moneda exige TRM de cobro positiva y finita", () => {
    assert.deepEqual(validarEleccionCobro({ ...base, monedaCobro: "COP", trmCobro: 4100 }), { ok: true, monedaCobro: "COP", trmCobro: 4100 });
    assert.deepEqual(validarEleccionCobro({ ...base, monedaCobro: "COP", trmCobro: "4100,5" }), { ok: true, monedaCobro: "COP", trmCobro: 4100.5 });
    assert.deepEqual(validarEleccionCobro({ ...base, monedaCobro: "COP", trmCobro: null }), { ok: false, error: MENSAJE_TRM_COBRO_REQUERIDA });
    for (const mala of [0, -5, "abc", Number.NaN, 100000000000, "1e20", true, 0.00001]) {
      assert.deepEqual(validarEleccionCobro({ ...base, monedaCobro: "COP", trmCobro: mala }), { ok: false, error: MENSAJE_TRM_COBRO_INVALIDA }, `TRM ${String(mala)}`);
    }
  });
  test("una moneda fuera de COP/USD se rechaza", () => {
    assert.deepEqual(validarEleccionCobro({ ...base, monedaCobro: "EUR", trmCobro: 4100 }), { ok: false, error: MENSAJE_COBRO_INVALIDO });
  });
  test("solo el personal interno cobra en una moneda distinta de la de la oferta", () => {
    assert.deepEqual(validarEleccionCobro({ ...base, esInterno: false, monedaCobro: "COP", trmCobro: 4100 }), { ok: false, error: MENSAJE_COBRO_SOLO_INTERNO });
    // Elegir la MISMA moneda no es un privilegio: sigue siendo válido para cualquiera.
    assert.deepEqual(validarEleccionCobro({ ...base, esInterno: false, monedaCobro: "USD", trmCobro: null }), { ok: true, monedaCobro: "USD", trmCobro: null });
  });
});

describe("cobroDeVenta: la única fuente de moneda y total de abonos, saldos y documentos", () => {
  test("contrato anterior (columnas NULL): se cobra en su moneda por su precio de siempre", () => {
    assert.deepEqual(cobroDeVenta({ moneda: "USD", precio_venta: 1200 }), { moneda: "USD", total: 1200, convertido: false, trm: null, monedaOferta: "USD", precioOferta: 1200 });
    assert.deepEqual(cobroDeVenta({ moneda: null, precio_venta: "3360000" }), { moneda: "COP", total: 3_360_000, convertido: false, trm: null, monedaOferta: "COP", precioOferta: 3_360_000 });
    assert.equal(cobroDeVenta(null).total, 0);
  });
  test("sin conversión (cobro = oferta): el precio de la oferta, sin TRM", () => {
    const c = cobroDeVenta({ moneda: "USD", precio_venta: 1200, moneda_cobro: "USD", trm_cobro: null, total_cobro: null });
    assert.equal(c.convertido, false);
    assert.equal(c.total, 1200);
  });
  test("con conversión congelada: la moneda de cobro y el total convertido; la oferta se conserva", () => {
    const c = cobroDeVenta({ moneda: "USD", precio_venta: 1200, moneda_cobro: "COP", trm_cobro: "4100", total_cobro: "4920000" });
    assert.deepEqual(c, { moneda: "COP", total: 4_920_000, convertido: true, trm: 4100, monedaOferta: "USD", precioOferta: 1200 });
  });
  test("una fila incoherente (otra moneda de cobro sin total o sin TRM) NO inventa un importe: cae a la oferta", () => {
    assert.equal(cobroDeVenta({ moneda: "USD", precio_venta: 1200, moneda_cobro: "COP", trm_cobro: null, total_cobro: null }).convertido, false);
    assert.equal(cobroDeVenta({ moneda: "USD", precio_venta: 1200, moneda_cobro: "COP", trm_cobro: 4100, total_cobro: 0 }).total, 1200);
  });
  test("abonos parciales y saldo en la moneda de cobro: nunca se resta una moneda de la otra", () => {
    const c = cobroDeVenta({ moneda: "USD", precio_venta: 1200, moneda_cobro: "COP", trm_cobro: 4100, total_cobro: 4_920_000 });
    const pagos = [1_000_000, 500_000]; // en COP (la moneda de cobro)
    const pagado = pagos.reduce((s, x) => s + x, 0);
    assert.equal(Math.max(c.total - pagado, 0), 3_420_000);
    // Con la resta equivocada (precio de la oferta en USD) el saldo sería 0: el contrato parecería pagado.
    assert.equal(Math.max(c.precioOferta - pagado, 0), 0);
  });
});

describe("aceptación #63: el cobro viaja a la base, vuelve congelado y los errores son de negocio", () => {
  const cliente = (rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>) => ({ rpc }) as never;
  test("aceptarOferta63 manda p_moneda_cobro y p_trm_cobro (null si no se eligió)", async () => {
    const vistos: Array<Record<string, unknown>> = [];
    const rpc = async (_fn: string, a: Record<string, unknown>) => { vistos.push(a); return { data: null, error: { message: "p63_oferta_cambio" } }; };
    const a = { cotizacionId: 5, tenant: "mayorista", usuarioId: "u1", huella: "h", huellaFinanciera: "f" };
    await aceptarOferta63(cliente(rpc), a);
    assert.equal(vistos[0].p_moneda_cobro, null);
    assert.equal(vistos[0].p_trm_cobro, null);
    await aceptarOferta63(cliente(rpc), { ...a, monedaCobro: "COP", trmCobro: 4100, trmProvisional: 4000 });
    assert.equal(vistos[1].p_moneda_cobro, "COP");
    assert.equal(vistos[1].p_trm_cobro, 4100);
    assert.equal(vistos[1].p_trm_provisional, 4000, "la TRM provisional (234) y la de cobro (235) son dos tasas distintas");
  });
  test("leerAceptacion63 trae el cobro congelado; una aceptación anterior a la 235 viene sin cobro", () => {
    const base = { estado: "preparada", aceptacion_id: 7, numero_contrato: "DTM-0451", fecha_negocio: "2026-10-24", snapshot: {}, financiero: { costos: {}, cxp: [] } };
    const conv = leerAceptacion63({ ...base, cobro: { moneda: "COP", trm: "4100", total: "4920000" } });
    assert.ok(conv.ok && conv.aceptacion.estado === "preparada");
    if (conv.ok && conv.aceptacion.estado === "preparada") assert.deepEqual(conv.aceptacion.cobro, { moneda: "COP", trm: 4100, total: 4_920_000 });
    const sin = leerAceptacion63({ ...base, cobro: { moneda: "USD", trm: null, total: null } });
    if (sin.ok && sin.aceptacion.estado === "preparada") assert.deepEqual(sin.aceptacion.cobro, { moneda: "USD", trm: null, total: null });
    const vieja = leerAceptacion63(base);
    if (vieja.ok && vieja.aceptacion.estado === "preparada") assert.equal(vieja.aceptacion.cobro, null);
    assert.equal(leerCobro63({ moneda: "EUR" }), null);
    assert.equal(leerCobro63("x"), null);
  });
  test("mapearErrorRpc63: los errores de cobro son mensajes de negocio y no exponen el detalle técnico", () => {
    assert.deepEqual(mapearErrorRpc63("p63_cobro_trm_requerida: cobrar en COP"), { error: MENSAJE_TRM_COBRO_REQUERIDA, cambio: false });
    assert.deepEqual(mapearErrorRpc63("p63_cobro_trm_invalida: x"), { error: MENSAJE_TRM_COBRO_INVALIDA, cambio: false });
    assert.deepEqual(mapearErrorRpc63("p63_cobro_invalido: x"), { error: MENSAJE_COBRO_INVALIDO, cambio: false });
    assert.deepEqual(mapearErrorRpc63("p63_cobro_cambio: ya quedaron congeladas"), { error: MENSAJE_COBRO_CAMBIO_63, cambio: false });
    assert.equal(mapearErrorRpc63("algo raro").error, MENSAJE_TECNICO_63);
  });
});

describe("cableado: ninguna lectura de abonos o saldo usa la moneda de la oferta por su cuenta", () => {
  const mig = leer("supabase/migrations/20260601000235_moneda_cobro_contrato.sql");
  test("migración 235: columnas, CHECK, fórmula única, firma de 8 argumentos, cabecera y congelado", () => {
    assert.match(mig, /add column moneda_cobro text,\s+add column trm_cobro numeric\(15,4\),\s+add column total_cobro numeric\(18,2\);/);
    assert.match(mig, /ventas_cobro_chk/);
    assert.match(mig, /coalesce\(trm_cobro, 0\) > 0 and coalesce\(total_cobro, 0\) > 0/, "NULL > 0 no es una violación de CHECK: se compara con coalesce");
    assert.match(mig, /create or replace function public\.p63_total_cobro\(/);
    assert.match(mig, /drop function public\.aceptar_oferta_63\(bigint, text, uuid, text, text, numeric\);/);
    assert.match(mig, /p_moneda_cobro      text    default null,\s+p_trm_cobro         numeric default null/);
    assert.match(mig, /grant execute on function public\.aceptar_oferta_63\(bigint, text, uuid, text, text, numeric, text, numeric\) to service_role;/);
    assert.match(mig, /revoke all on function public\.aceptar_oferta_63\(bigint, text, uuid, text, text, numeric, text, numeric\) from public, anon, authenticated;/);
    assert.match(mig, /p63_cobro_cambio/);
    assert.match(mig, /new\.moneda_cobro is distinct from v_a\.moneda_cobro/);
    assert.match(mig, /create trigger trg_ventas_cobro_congelado\s+before update on public\.ventas/);
    assert.match(mig, /create or replace view public\.ventas_basica as/);
    assert.ok(mig.indexOf("v.moneda_cobro, v.trm_cobro, v.total_cobro") > mig.indexOf("v.created_at, v.updated_at,"), "las columnas nuevas van AL FINAL de la vista");
    // (la copia de importes_factura de la 208 conserva SU respaldo en trm_referencia para el PVP de siempre; la TRM de COBRO no: se mira la aceptación)
    const acept = mig.slice(mig.indexOf("create or replace function public.aceptar_oferta_63("), mig.indexOf("-- ═══ 5. La cabecera"));
    assert.ok(!/trm_referencia/.test(acept.replace(/--[^\n]*/g, "")), "la TRM de cobro no tiene respaldo en trm_referencia");
  });
  test("la 235 no edita ninguna migración anterior y no repite el trigger de bandera", () => {
    assert.ok(!/alter table public\.p63_aceptacion drop/.test(mig));
    assert.ok(!/app\.p63_pub/.test(mig));
  });
  test("reservar/actions: valida la elección ANTES de numerar, la manda a la aceptación y estampa la cabecera con lo congelado", () => {
    const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    const iValida = src.indexOf("validarEleccionCobro({ monedaOferta: oferta63.moneda");
    const iAcepta = src.indexOf("const ac63 = await aceptarOferta63(");
    assert.ok(iValida > 0 && iValida < iAcepta, "la elección se valida antes de aceptar (y por tanto antes de numerar)");
    assert.match(src, /esInterno: esInterno63/);
    assert.match(src, /monedaCobro: cobro63\.monedaCobro, trmCobro: cobro63\.trmCobro/);
    assert.match(src, /moneda_cobro: aceptacion63\?\.cobro\?\.moneda \?\? null,\s+trm_cobro: aceptacion63\?\.cobro\?\.trm \?\? null,\s+total_cobro: aceptacion63\?\.cobro\?\.total \?\? null,/);
    assert.match(src, /monedaCobro: monedaCobro \?\? null, trmCobro: trmCobro \?\? null/);
  });
  test("abonos: registrar, editar y recalcular usan la moneda y el total de COBRO", () => {
    const src = leer("app/(dashboard)/dashboard/contratos/actions.ts");
    assert.equal((src.match(/cobroDeVenta\(venta\)/g) ?? []).length >= 3, true);
    assert.match(src, /alcanzaMinimo = totalAbonado >= cobro\.total \* pctMin/);
    assert.ok(!/alcanzaMinimo = totalAbonado >= \(venta\?\.precio_venta/.test(src), "el mínimo para confirmar ya no se mide contra el precio de la oferta");
  });
  test("cartera, estado de cuenta, ficha, portal y documentos del contrato leen el cobro", () => {
    for (const rel of [
      "app/(dashboard)/dashboard/cartera/page.tsx", "lib/cuenta/estado.ts", "app/(dashboard)/dashboard/contratos/[numero]/page.tsx",
      "app/portal/b2b/page.tsx", "app/c/[token]/page.tsx", "app/contrato/[numero]/page.tsx",
    ]) {
      assert.match(leer(rel), /cobroDeVenta\(/, rel);
    }
    assert.match(leer("app/(dashboard)/dashboard/cartera/page.tsx"), /moneda_cobro, trm_cobro, total_cobro/);
    assert.match(leer("lib/cuenta/estado.ts"), /moneda_cobro, trm_cobro, total_cobro/);
    const doc = leer("components/contrato/ContratoDocumento.tsx");
    assert.match(doc, /Math\.max\(cobroConvertido\.total - totalPagado, 0\)/);
    assert.match(doc, /Total a cobrar/);
  });
});

describe("plan de cobro: las cuotas suman el total de COBRO", () => {
  test("generarPlanCobro parte de cobroDeVenta(venta).total y no de precio_venta suelto", () => {
    const src = leer("app/(dashboard)/dashboard/contratos/[numero]/cobros-actions.ts");
    assert.match(src, /precio: cobroDeVenta\(venta\)\.total/);
    assert.match(src, /moneda_cobro, trm_cobro, total_cobro/);
    assert.doesNotMatch(src, /precio: venta\.precio_venta/);
  });
});

describe("elección de cobro obligatoria: ninguna vía numera sin elegir", () => {
  const mig = leer("supabase/migrations/20260601000235_moneda_cobro_contrato.sql");
  test("la RPC rechaza un intento NUEVO sin moneda de cobro ANTES de revalidar y de reservar el número", () => {
    const cuerpo = mig.slice(mig.indexOf("create or replace function public.aceptar_oferta_63("));
    const iRequerido = cuerpo.indexOf("p63_cobro_requerido: elige la moneda de cobro");
    const iReval = cuerpo.indexOf("Revalidación en ESTE instante");
    const iNumero = cuerpo.indexOf("siguiente_numero_contrato_para_tenant");
    assert.ok(iRequerido > 0 && iRequerido < iReval && iReval < iNumero, "el rechazo va antes de revalidar y de numerar");
    assert.doesNotMatch(cuerpo, /v_mc := coalesce\(p_moneda_cobro/, "sin valor por defecto");
    assert.match(cuerpo, /v_mc := p_moneda_cobro;/);
  });
  test("el reintento de un intento existente sale ANTES del rechazo (compatibilidad documentada) y no numera", () => {
    const cuerpo = mig.slice(mig.indexOf("create or replace function public.aceptar_oferta_63("));
    assert.ok(cuerpo.indexOf("Idempotencia: el mismo reintento") < cuerpo.indexOf("p63_cobro_requerido: elige la moneda de cobro"));
    assert.match(mig, /compatibilidad/);
  });
  test("defensa en profundidad: trigger que impide insertar una aceptación nueva sin moneda de cobro, y su rollback", () => {
    assert.match(mig, /create trigger trg_p63_aceptacion_cobro_requerido\s+before insert on public\.p63_aceptacion/);
    assert.match(leer("supabase/scripts/rollback_235_moneda_cobro.sql"), /drop trigger if exists trg_p63_aceptacion_cobro_requerido/);
  });
  test("el error de la base se traduce a un mensaje de negocio", () => {
    assert.deepEqual(mapearErrorRpc63("p63_cobro_requerido: elige la moneda"), { error: MENSAJE_COBRO_REQUERIDO, cambio: false });
  });
  test("el servidor valida la elección ANTES de llamar a la RPC y la UI exige elegir", () => {
    const acc = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    assert.ok(acc.indexOf("const cobro63 = validarEleccionCobro(") < acc.indexOf("await aceptarOferta63(adminAcept"));
    assert.match(acc, /if \(!cobro63\.ok\) return \{ ok: false, error: cobro63\.error \};/);
    const ui = leer("app/(dashboard)/dashboard/cotizaciones/[id]/CotizacionAcciones.tsx");
    assert.match(ui, /<option value="" disabled>Elige la moneda de cobro/);
    assert.doesNotMatch(ui, /otraMoneda/);
  });
});

describe("cartera del dashboard y facturación: nada se calcula en otra moneda que la de cobro", () => {
  const mig = leer("supabase/migrations/20260601000235_moneda_cobro_contrato.sql");
  const rb = leer("supabase/scripts/rollback_235_moneda_cobro.sql");
  test("fn_dashboard_cartera_por_moneda usa moneda y total de cobro SOLO con conversión congelada válida, y lo de siempre en el resto", () => {
    const f = mig.slice(mig.indexOf("create or replace function public.fn_dashboard_cartera_por_moneda"));
    assert.match(f, /v\.moneda_cobro is distinct from coalesce\(v\.moneda, 'COP'\)\s+and coalesce\(v\.total_cobro, 0\) > 0 and coalesce\(v\.trm_cobro, 0\) > 0/);
    assert.match(f, /then v\.total_cobro else coalesce\(v\.precio_venta, 0\) end - coalesce\(ap\.suma, 0\)/);
    assert.match(f, /security invoker/);
  });
  test("la guarda de facturación va en la única fuente de importes de facturar_factura y se respalda con un trigger", () => {
    const f = mig.slice(mig.indexOf("create or replace function f208_priv.importes_factura"));
    assert.ok(f.indexOf("F4451") > 0 && f.indexOf("F4451") < f.indexOf("tenant := v.tenant"), "el rechazo va antes de calcular nada");
    assert.match(mig, /create trigger trg_p235_cf_cobro_guarda before insert or update on public\.contrato_facturacion/);
    const llamadas = leer("supabase/migrations/20260601000208_facturacion_transaccional.sql").match(/f208_priv\.importes_factura\(p_numero\)/g) ?? [];
    assert.equal(llamadas.length, 1, "facturar_factura es el único consumidor");
  });
  test("el rollback restaura la cartera (186) y los importes (208) y quita el trigger ANTES de borrar las columnas", () => {
    assert.ok(rb.indexOf("create or replace function public.fn_dashboard_cartera_por_moneda") < rb.indexOf("drop column if exists moneda_cobro"));
    assert.ok(rb.indexOf("create or replace function f208_priv.importes_factura") < rb.indexOf("drop column if exists moneda_cobro"));
    assert.match(rb, /drop trigger if exists trg_p235_cf_cobro_guarda/);
    assert.doesNotMatch(rb.slice(rb.indexOf("create or replace function f208_priv.importes_factura"), rb.indexOf("drop function if exists public.p63_total_cobro")), /moneda_cobro/);
  });
});

describe("instrucción de despliegue de la 235", () => {
  const mig = leer("supabase/migrations/20260601000235_moneda_cobro_contrato.sql");
  const cab = mig.slice(mig.indexOf("-- ORDEN DE DESPLIEGUE"), mig.indexOf("-- Rollback:"));
  test("dice que el código anterior NO puede crear aceptaciones #63 tras la 235 y que se aplica inmediatamente antes del código nuevo", () => {
    assert.match(cab, /INMEDIATAMENTE ANTES del despliegue del código nuevo/);
    assert.match(cab, /NO puede crear nuevas\s+--\s+aceptaciones #63/);
    assert.match(cab, /p63_cobro_requerido/);
    assert.match(cab, /interrupción BREVE y CONTROLADA/);
    assert.doesNotMatch(cab, /sigue funcionando|la base va ANTES/);
  });
});
