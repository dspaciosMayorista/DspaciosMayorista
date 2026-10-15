// Se ejecuta con npm run test:react (loader del arnés).
//
// #30 (entrega B) · Contrato MANUAL B2B en PVP o NETO con el código REAL de
// `crearContrato` contra la BD en memoria del arnés. El RPC atómico
// `aplicar_neto_contrato_manual` se simula aquí con su mismo efecto (precio =
// PVP − comisión + fila descontada, todo o nada); la base real —permisos,
// tenant, atomicidad y carreras— se prueba en Postgres con
// supabase/scripts/test_206_contrato_manual_neto.sql, test_206_carrera.sh y
// test_206_app_rpc.sh (crearContrato real → PostgREST → RPC).
//
// Después de crear el contrato se lee con el código REAL de cada superficie:
// documento, estado de cuenta, rentabilidad, facturación, liquidación del
// asesor y la comisión que ve el aliado (portal / cuenta de cobro).
//
// Depende de la entrega A (documento NETO: lib/contrato/presentacionValores.ts,
// netoContrato.server.ts; lib/finanzas/netoB2B.ts).
import { usarBD, type Fila } from "./support/fechaNegocioArnes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";

const { crearContrato, previsualizarNetoContrato } = await import("../app/(dashboard)/dashboard/contratos/actions.ts");
const { netoTotalExigibleDeContrato } = await import("../lib/contrato/netoContrato.server.ts");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { cargarEstadoCuenta } = await import("../lib/cuenta/estado.ts");
const { calcularRentabilidad } = await import("../lib/finanzas/rentabilidad.ts");
const { default: FacturacionPage } = await import("../app/(dashboard)/dashboard/contabilidad/facturacion/page.tsx");
const { default: LiquidacionPage } = await import("../app/(dashboard)/dashboard/liquidacion/page.tsx");
const { comisionVisibleAliado, filasCobrables } = await import("../lib/finanzas/comisionB2B.ts");
const { renderToStaticMarkup } = await import("react-dom/server");
const { formatMoneda } = await import("../lib/utils.ts");

const ALIADO = { id: 7, nombre: "Agencia Prueba", nit: "900", tipo: "agencia", pct_comision: 0.1, aplica_retencion: false, pct_retencion: 0 };
const YO: Fila = { id: "u-arnes", nombre: "Asesor", email: "arnes@dspacios.test", rol: "superadmin", tenant: "mayorista", activo: true, aliado_id: null, acceso_legacy_nombre: false };
const $ = (n: number) => formatMoneda(n, "COP").replace(/ /g, " ");

// PVP 2.000.000 (2 adultos × 1.000.000), BNC 400.000, aliado al 10 %
// → comisión 160.000, total NETO 1.840.000.
function contrato(extra: Record<string, unknown> = {}) {
  return {
    tipoPaquete: "dinamico" as const, paqueteId: null, bloqueoId: null,
    cliente: "Cliente Prueba", clienteDocumento: "", clienteTelefono: "", clienteDireccion: "",
    destino: "CARTAGENA", fechaSalida: "2026-12-01", fechaRegreso: "2026-12-04", fechaEmision: "2026-10-11",
    asistenciaMedica: false, planNombre: "", toursTraslados: "",
    asesorNombre: "Asesor", asesorCargo: "", asesorCc: "", asesorTel: "",
    pasajeros: [],
    hoteles: [{
      nombre: "Hotel Sol", categoria: "Estándar", proveedor: "Operador Sol", ciudad: "Cartagena", alimentacion: "PC",
      acomodacion: "Doble", detalleAcomodacion: "", fechaIngreso: "2026-12-01", fechaSalida: "2026-12-04", costo: 900_000,
    }],
    vuelos: [],
    items: [{ descripcion: "Paquete Cartagena", adultos: 2, ninos: 0, tarifaAdulto: 1_000_000, tarifaNino: 0 }],
    tipoVenta: "agencia" as const,
    aliadoId: 7,
    bncModo: "fijo" as const,
    bncFijo: 400_000,
    ...extra,
  };
}

type BD = ReturnType<typeof usarBD>;
// Efecto del RPC atómico (espejo de la migración 206): se recalcula y se niega si
// la comisión esperada no coincide; si coincide, precio y fila juntos.
function rpcNeto(ref: { bd?: BD; antes?: Fila }, opciones: { falla?: string } = {}) {
  return (args: Record<string, unknown>) => {
    const bd = ref.bd!;
    const v = bd.filas("ventas").find((x) => x.numero_contrato === args.p_numero)!;
    ref.antes = { ...v };
    if (opciones.falla) throw new Error(opciones.falla);
    const base = Math.max(0, Number(v.precio_venta) - Number(v.impuesto));
    const com = Math.round(base * ALIADO.pct_comision);
    if (Math.abs(com - Number(args.p_comision_esperada)) > 1) throw new Error("no coincide con la calculada");
    bd.filas("aliados_b2b").push({
      id: 501, numero_contrato: v.numero_contrato, tenant: v.tenant, aliado: ALIADO.nombre, nit: ALIADO.nit, tipo_aliado: "agencia",
      aliado_id: 7, precio_venta: v.precio_venta, base_comision: base, base_explicita: true, comision_valor: null,
      pct_comision: ALIADO.pct_comision, recobro_total: 0, pct_recobro_aliado: 0, aplica_retencion: false, pct_retencion: 0,
      estado: "pagada", descontada_en_precio: true,
    });
    Object.assign(v, { precio_venta: Number(v.precio_venta) - com, modo_compra: "neta", comision_b2b: com, comision_estado: "descontada" });
    return 501;
  };
}
function revertir(ref: { bd?: BD }, falla?: string) {
  return (args: Record<string, unknown>) => {
    if (falla) throw new Error(falla);
    const bd = ref.bd!;
    for (const t of ["ventas", "contrato_items", "contrato_hoteles", "aliados_b2b", "cuentas_por_pagar"]) {
      bd.tablas.set(t, bd.filas(t).filter((f) => f.numero_contrato !== args.p_numero_contrato));
    }
    return null;
  };
}
// Escritura financiera del contrato manual (#30, CXP-1): `registrar_financiero_contrato`
// (171/172) en memoria — costos + CxP en un paso y `financiero_estado='completo'`.
// La versión real (transacción, idempotencia, RLS) se prueba en
// pruebas/contratoManualNeto206.pg.ts (CXP-1).
function financieroEnMemoria(ref: { bd?: BD }) {
  let id = 900;
  return (args: Record<string, unknown>) => {
    const bd = ref.bd!;
    const v = bd.filas("ventas").find((x) => x.numero_contrato === args.p_numero_contrato)!;
    Object.assign(v, args.p_costos as Record<string, unknown>, { financiero_estado: "completo" });
    const creadas = (args.p_cxp as Record<string, unknown>[]).map((c) => {
      const fila = { id: ++id, numero_contrato: v.numero_contrato, tenant: args.p_tenant, ...c };
      bd.filas("cuentas_por_pagar").push(fila);
      return { id: fila.id, tipo_proveedor: c.tipo_proveedor, proveedor: c.proveedor, servicio: c.servicio, valor_total: c.valor_total };
    });
    return { creadas, eliminadas: [] };
  };
}
function montarBD(rpcs: Record<string, (a: Record<string, unknown>) => unknown> = {}, ref: { bd?: BD } = {}) {
  const bd = usarBD({ aliados: [ALIADO], usuarios: [YO], parametros_tributarios: [] },
    { registrar_financiero_contrato: financieroEnMemoria(ref), ...rpcs });
  ref.bd = bd;
  return bd;
}
const llamadas = (bd: BD, fn: string) => bd.llamadasRpc.filter((l) => l.fn === fn);

// ═══ Creación ════════════════════════════════════════════════════════════

test("NETO: nace PVP 'Por definir', el RPC atómico lo pasa a NETO con su comisión descontada", async () => {
  const ref: { bd?: BD; antes?: Fila } = {};
  const bd = montarBD({ aplicar_neto_contrato_manual: rpcNeto(ref) }, ref);
  const r = await crearContrato(contrato({ modoCompra: "neto", comisionNetoEsperada: 160_000 }));
  assert.equal(r.ok, true, JSON.stringify(r));
  const numero = (r as { numero: string }).numero;
  assert.deepEqual(llamadas(bd, "aplicar_neto_contrato_manual").map((l) => l.args),
    [{ p_numero: numero, p_aliado_id: 7, p_comision_esperada: 160_000 }]);
  // Al llamar el RPC el contrato existía como PVP sin modalidad (estado seguro de #38).
  assert.equal(ref.antes?.precio_venta, 2_000_000);
  assert.equal(ref.antes?.modo_compra ?? null, null);
  assert.equal(ref.antes?.comision_estado ?? null, null);
  const [v] = bd.filas("ventas");
  assert.deepEqual([v.precio_venta, v.modo_compra, v.comision_b2b, v.comision_estado, v.impuesto], [1_840_000, "neta", 160_000, "descontada", 400_000]);
  const filas = bd.filas("aliados_b2b");
  assert.equal(filas.length, 1);
  assert.deepEqual([filas[0].precio_venta, filas[0].base_comision, filas[0].descontada_en_precio], [2_000_000, 1_600_000, true],
    "evidencia: PVP original, base y marca de descontada");
  assert.equal(llamadas(bd, "revertir_contrato_incompleto").length, 0);
});

test("PVP manual: igual que #38 — sin RPC, sin modalidad, comisión 'Por definir'", async () => {
  const ref: { bd?: BD } = {};
  const bd = montarBD({ aplicar_neto_contrato_manual: rpcNeto(ref) }, ref);
  const r = await crearContrato(contrato({ modoCompra: "pvp" }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(llamadas(bd, "aplicar_neto_contrato_manual").length, 0);
  const [v] = bd.filas("ventas");
  assert.equal(v.precio_venta, 2_000_000);
  assert.equal(v.modo_compra ?? null, null);
  assert.equal(v.comision_estado ?? null, null);
  assert.equal(bd.filas("aliados_b2b").length, 0);
  // Sin modoCompra (formulario viejo): mismo resultado.
  const r2 = await crearContrato(contrato());
  assert.equal(r2.ok, true);
  assert.equal(llamadas(bd, "aplicar_neto_contrato_manual").length, 0);
});

test("NETO rechazado ANTES de numerar: comisión distinta a la mostrada, venta directa o modalidad inválida", async () => {
  const ref: { bd?: BD } = {};
  const bd = montarBD({ aplicar_neto_contrato_manual: rpcNeto(ref) }, ref);
  const distinta = await crearContrato(contrato({ modoCompra: "neto", comisionNetoEsperada: 150_000 }));
  assert.equal(distinta.ok, false);
  assert.match((distinta as { error: string }).error, /La comisión del aliado cambió: ahora es .*160\.000.*total NETO .*1\.840\.000/);
  const sinVista = await crearContrato(contrato({ modoCompra: "neto" }));
  assert.equal(sinVista.ok, false);
  const directa = await crearContrato(contrato({ tipoVenta: "interno", aliadoId: null, modoCompra: "neto", comisionNetoEsperada: 0 }));
  assert.equal(directa.ok, false);
  assert.match((directa as { error: string }).error, /venta directa no tiene modalidad NETO/);
  const invalida = await crearContrato(contrato({ modoCompra: "mitad" }));
  assert.equal(invalida.ok, false);
  assert.equal(bd.filas("ventas").length, 0, "no se creó ni numeró nada");
  assert.equal(bd.llamadasRpc.length, 0);
});

test("fallo del RPC: el contrato se revierte completo y el error es visible", async () => {
  const ref: { bd?: BD } = {};
  const bd = montarBD({
    aplicar_neto_contrato_manual: rpcNeto(ref, { falla: "La comisión del contrato no coincide con la calculada (170000)." }),
    revertir_contrato_incompleto: revertir(ref),
  }, ref);
  const r = await crearContrato(contrato({ modoCompra: "neto", comisionNetoEsperada: 160_000 }));
  assert.equal(r.ok, false);
  const error = (r as { error: string }).error;
  assert.match(error, /No se pudo registrar el contrato en NETO \(La comisión del contrato no coincide.*\), así que no se creó/);
  const [rev] = llamadas(bd, "revertir_contrato_incompleto");
  assert.deepEqual(rev?.args, { p_numero_contrato: "DTM-0451", p_tenant: "mayorista" });
  assert.equal(bd.filas("ventas").length, 0);
  assert.equal(bd.filas("aliados_b2b").length, 0);
  assert.equal(bd.filas("cuentas_por_pagar").length, 0, "lo best-effort (CxP) nunca llegó a correr");
});

test("fallo del RPC y de la reversión: nombra el contrato y queda PVP 'Por definir', nunca NETO sin comisión", async () => {
  const ref: { bd?: BD } = {};
  const bd = montarBD({
    aplicar_neto_contrato_manual: rpcNeto(ref, { falla: "fetch failed" }),
    revertir_contrato_incompleto: revertir(ref, "sin conexión"),
  }, ref);
  const r = await crearContrato(contrato({ modoCompra: "neto", comisionNetoEsperada: 160_000 }));
  assert.equal(r.ok, false);
  const error = (r as { error: string }).error;
  assert.match(error, /tampoco se pudo deshacer el contrato DTM-0451 automáticamente \(sin conexión\)/);
  assert.match(error, /Quedó como PVP con la comisión por definir/);
  const [v] = bd.filas("ventas");
  assert.equal(v.precio_venta, 2_000_000);
  assert.equal(v.comision_estado ?? null, null);
  assert.equal(bd.filas("aliados_b2b").length, 0);
});

test("vista previa: el mismo plan que se aplica (sin escribir nada)", async () => {
  const bd = montarBD();
  const r = await previsualizarNetoContrato({ tipoVenta: "agencia", aliadoId: 7, precioVenta: 2_000_000, impuesto: 400_000 });
  assert.deepEqual(r, { ok: true, plan: { pct: 0.1, base: 1_600_000, comision: 160_000, pvp: 2_000_000, totalExigible: 1_840_000 } });
  assert.equal(bd.filas("ventas").length, 0);
  assert.equal(bd.llamadasRpc.length, 0);
});

// ═══ El contrato NETO en cada superficie ═════════════════════════════════

async function contratoNeto() {
  const ref: { bd?: BD } = {};
  const bd = montarBD({ aplicar_neto_contrato_manual: rpcNeto(ref) }, ref);
  const r = await crearContrato(contrato({ modoCompra: "neto", comisionNetoEsperada: 160_000 }));
  assert.equal(r.ok, true, JSON.stringify(r));
  const numero = (r as { numero: string }).numero;
  const v = bd.filas("ventas")[0];
  // La base pone fecha_venta y estado por default; el arnés no tiene defaults.
  Object.assign(v, { fecha_venta: "2026-10-11", estado: "activo" });
  return { bd, numero, v };
}

test("documento: total y saldo del total exigible; ni el PVP ni la comisión aparecen", async () => {
  const { bd, numero, v } = await contratoNeto();
  const neto = await netoTotalExigibleDeContrato(numero);
  assert.equal(neto, 1_840_000);
  const html = renderToStaticMarkup(createElement(ContratoDocumento, {
    venta: v, pasajeros: [], hoteles: [], vuelos: [], items: bd.filas("contrato_items"), totalPagado: 0, netoTotalExigible: neto,
  } as never)).replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
  assert.ok(html.includes(`Total del contrato ${$(1_840_000)}`));
  assert.ok(html.includes(`Saldo pendiente ${$(1_840_000)}`));
  for (const n of [2_000_000, 160_000, 1_000_000]) assert.ok(!html.includes($(n)), `no aparece ${$(n)}`);
});

test("estado de cuenta: valor y saldo = total exigible", async () => {
  const { numero } = await contratoNeto();
  const ec = await cargarEstadoCuenta(numero);
  assert.ok(ec);
  assert.deepEqual([ec!.precio_venta, ec!.saldo], [1_840_000, 1_840_000]);
});

test("rentabilidad: ingreso = total exigible y la comisión descontada no se resta otra vez", async () => {
  const { numero } = await contratoNeto();
  const { filas } = await calcularRentabilidad();
  const f = filas.find((x) => x.numero_contrato === numero)!;
  assert.equal(f.comB2B, 0);
  assert.equal(f.precioVenta, 1_840_000);
});

test("facturación: se factura el total exigible", async () => {
  const { numero } = await contratoNeto();
  const el = await FacturacionPage();
  const buscar = (n: unknown): { numero_contrato: string; precio_venta: number }[] | null => {
    if (!n || typeof n !== "object") return null;
    const p = (n as { props?: { rows?: unknown; children?: unknown } }).props;
    if (p?.rows) return p.rows as never;
    for (const h of Array.isArray(p?.children) ? p!.children as unknown[] : [p?.children]) { const r = buscar(h); if (r) return r; }
    return null;
  };
  const fila = buscar(el)?.find((x) => x.numero_contrato === numero);
  assert.equal(fila?.precio_venta, 1_840_000);
});

test("liquidación del asesor: rango y base sobre el PVP original, separados de la comisión B2B", async () => {
  const { bd } = await contratoNeto();
  bd.filas("usuarios").push({ id: "u-asesor", nombre: "Asesor", rol: "venta", tenant: "mayorista", activo: true, escala_id: 1, aplica_retencion: false });
  bd.filas("escala_rangos").push({ escala_id: 1, pvp_desde: 0, pvp_hasta: null, pct: 5 });
  const el = await LiquidacionPage({ searchParams: Promise.resolve({ mes: "2026-10" }) });
  const buscar = (n: unknown): { nombre: string; pvp: number; base: number; bruta: number }[] | null => {
    if (!n || typeof n !== "object") return null;
    const p = (n as { props?: { filas?: unknown; children?: unknown } }).props;
    if (p?.filas) return p.filas as never;
    for (const h of Array.isArray(p?.children) ? p!.children as unknown[] : [p?.children]) { const r = buscar(h); if (r) return r; }
    return null;
  };
  const a = buscar(el)?.find((x) => x.nombre === "Asesor");
  assert.deepEqual([a?.pvp, a?.base, a?.bruta], [2_000_000, 1_600_000, Math.round(1_600_000 * 0.05)]);
});

test("portal / cuenta de cobro: el aliado ve su comisión como descontada, nada que cobrar", async () => {
  const { bd, v } = await contratoNeto();
  const filas = bd.filas("aliados_b2b") as never[];
  const vis = comisionVisibleAliado(filas, v as never, { aliadoId: 7, documento: null, nombreLegacy: null });
  assert.deepEqual([vis.total, vis.fuente, vis.cobrable], [160_000, "descontada", false]);
  assert.deepEqual(filasCobrables(filas, v as never, { esInterno: false, aliadoId: 7 }), []);
  assert.deepEqual(filasCobrables(filas, v as never, { esInterno: true, aliadoId: null }), [], "ni para un interno");
});

// ═══ Margen mínimo (decisión #30): PVP 20 % sobre el PVP; NETO 6 % sobre el
// total exigible del plan validado. PVP 2.000.000, BNC 400.000, aliado 10 % →
// total NETO 1.840.000. Límites: PVP costo ≤ 1.600.000; NETO costo ≤ 1.729.600.
const conCosto = (costo: number, extra: Record<string, unknown> = {}) => {
  const c = contrato(extra);
  return { ...c, hoteles: [{ ...c.hoteles[0], costo }] };
};
const NETO_OK = { modoCompra: "neto", comisionNetoEsperada: 160_000 };

test("margen PVP 20 %: justo por debajo se rechaza sin numerar; en el límite y por encima se crea", async () => {
  const bd = montarBD();
  const abajo = await crearContrato(conCosto(1_600_001, { modoCompra: "pvp" }));
  assert.equal(abajo.ok, false);
  const r = abajo as { error: string; margenInsuficiente?: boolean; pvpMinimo?: number };
  assert.equal(r.margenInsuficiente, true);
  assert.equal(r.pvpMinimo, 2_000_002);
  assert.match(r.error, /^El PVP .* no cubre el margen mínimo del 20%/);
  assert.equal(bd.filas("ventas").length, 0, "no se numeró ni creó nada");
  for (const costo of [1_600_000, 1_500_000]) {
    const ok = await crearContrato(conCosto(costo, { modoCompra: "pvp" }));
    assert.equal(ok.ok, true, `costo ${costo}: ${JSON.stringify(ok)}`);
  }
  assert.equal(bd.filas("ventas").length, 2);
});

test("margen NETO 6 % sobre el total exigible: justo por debajo se rechaza sin numerar ni llamar al RPC", async () => {
  const ref: { bd?: BD } = {};
  const bd = montarBD({ aplicar_neto_contrato_manual: rpcNeto(ref) }, ref);
  const abajo = await crearContrato(conCosto(1_729_601, NETO_OK));
  assert.equal(abajo.ok, false);
  const r = abajo as { error: string; margenInsuficiente?: boolean; pvpMinimo?: number };
  assert.equal(r.margenInsuficiente, true);
  assert.equal(r.pvpMinimo, 1_840_002, "en NETO es el total exigible mínimo");
  assert.match(r.error, /^El total NETO .*1\.840\.000.* no cubre el margen mínimo del 6%/);
  assert.equal(bd.filas("ventas").length, 0);
  assert.equal(bd.llamadasRpc.length, 0);
});

test("margen NETO 6 %: en el límite y por encima se crea (aunque contra el PVP no llegaría al 20 %)", async () => {
  for (const costo of [1_729_600, 1_700_000]) {
    const ref: { bd?: BD } = {};
    const bd = montarBD({ aplicar_neto_contrato_manual: rpcNeto(ref) }, ref);
    const ok = await crearContrato(conCosto(costo, NETO_OK));
    assert.equal(ok.ok, true, `costo ${costo}: ${JSON.stringify(ok)}`);
    assert.equal(llamadas(bd, "aplicar_neto_contrato_manual").length, 1);
    assert.equal(bd.filas("ventas")[0].precio_venta, 1_840_000);
  }
  // El mismo costo del límite NETO, vendido en PVP, no pasa el 20 %.
  montarBD();
  const enPvp = await crearContrato(conCosto(1_729_600, { modoCompra: "pvp" }));
  assert.equal((enPvp as { margenInsuficiente?: boolean }).margenInsuficiente, true);
});

test("aprobación excepcional (superadmin/administración): crea por debajo del mínimo en PVP y en NETO", async () => {
  // El arnés resuelve el rol como superadmin; quién puede aprobar lo prueba
  // pruebas/margenContrato.test.ts (puedeAprobarMargenBajo).
  montarBD();
  const pvp = await crearContrato({ ...conCosto(1_600_001, { modoCompra: "pvp" }), forzarMargen: true });
  assert.equal(pvp.ok, true, JSON.stringify(pvp));
  const ref: { bd?: BD } = {};
  const bd = montarBD({ aplicar_neto_contrato_manual: rpcNeto(ref) }, ref);
  const neto = await crearContrato({ ...conCosto(1_729_601, NETO_OK), forzarMargen: true });
  assert.equal(neto.ok, true, JSON.stringify(neto));
  assert.equal(bd.filas("ventas")[0].comision_estado, "descontada");
});
