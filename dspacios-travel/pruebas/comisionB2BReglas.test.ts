// #38 · Comisiones B2B — reglas puras (lib/finanzas/comisionB2B.ts) y guardas
// de cableado. Las Server Actions reales contra la BD en memoria viven en
// pruebas/comisionB2BAlta.react.ts; la base (triggers/RLS de la 205) en
// supabase/scripts/test_205_comisiones_b2b.sql y test_205_carrera_abonos.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseComisionableB2B, calcComisionB2B, calcRentabilidad } from "@/lib/calc/finanzas";
import {
  autorizarComisionB2B,
  calcularComisionFila,
  comisionParaRentabilidad,
  elegirFilaCobro,
  esComisionDescontada,
  estadoComisionFila,
  filasCobrables,
  normalizarNombreAliado,
  normalizarDocumento,
  evidenciaSinFicha,
  comisionVisibleAliado,
  pctComisionAliado,
  permisosComisionContrato,
  autorizarCorreccionAsesor,
  prepararEdicionComision,
  ROLES_ALTA_COMISION,
  ROLES_GESTION_COMISION,
  type FilaComisionB2B,
} from "@/lib/finanzas/comisionB2B";
import { planComisionReserva } from "@/lib/reservar/comisionReserva";

const leer = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const PVP = 1_000_000;
const fila = (extra: Partial<FilaComisionB2B> = {}): FilaComisionB2B => ({
  id: 1, numero_contrato: "DTM-0001", precio_venta: PVP, base_comision: 800_000, base_explicita: true,
  comision_valor: null, pct_comision: 0.1, recobro_total: 0, pct_recobro_aliado: 0,
  aplica_retencion: false, pct_retencion: 0, estado: "pendiente", descontada_en_precio: false, aliado_id: null, ...extra,
});
const total = (f: FilaComisionB2B) => calcularComisionFila(f).totalPagar;

// ── 1. Base nueva y lectura legado ─────────────────────────────────────────
test("base nueva = max(0, PVP − impuesto): positiva, 0 y sin impuesto", () => {
  assert.equal(baseComisionableB2B(PVP, 200_000), 800_000);
  assert.equal(baseComisionableB2B(PVP, PVP), 0);
  assert.equal(baseComisionableB2B(PVP, PVP + 1), 0);
  assert.equal(baseComisionableB2B(PVP, null), PVP);
});

test("filas históricas (base_explicita NULL): misma lectura que antes de la 205", () => {
  const legado = (base: number | null) => fila({ base_comision: base, base_explicita: null });
  assert.equal(total(legado(0)), 100_000, "base 0 sigue cayendo al PVP");
  assert.equal(total(legado(null)), 100_000, "base NULL sigue cayendo al PVP");
  assert.equal(total(legado(PVP)), 100_000, "base = PVP con % ajustado a mano: idéntico");
  assert.equal(total(legado(800_000)), 80_000);
  // Y calcComisionB2B, sin la marca, conserva el `||` legado.
  assert.equal(calcComisionB2B({ precioVenta: PVP, baseComisionable: 0, pctComision: 0.1 }).comisionBase, 100_000);
});

test("filas nuevas (base explícita): 0 vale 0; vacía (NULL) = sin base definida → PVP", () => {
  assert.equal(total(fila({ base_comision: 0 })), 0);
  assert.equal(total(fila({ base_comision: null })), 100_000);
  assert.equal(total(fila({ base_comision: 0, recobro_total: 50_000, pct_recobro_aliado: 0.5 })), 25_000, "base 0 conserva el recobro");
});

test("por valor: 3.250.000 / 300.000 se conserva al peso (con % redondeado daría 299.975)", () => {
  const f = fila({ precio_venta: 4_000_000, base_comision: 3_250_000, comision_valor: 300_000, pct_comision: 0.0923 });
  assert.equal(total(f), 300_000);
  assert.equal(total({ ...f, comision_valor: null }), 299_975);
});

test("los mismos casos que verifica el SQL de la 205 (espejo comision_b2b_total)", () => {
  // test_205_comisiones_b2b.sql L1–L5: si este número cambia, cambia también la función SQL.
  assert.deepEqual(
    [fila({ base_comision: 0, base_explicita: null }), fila({ base_comision: null, base_explicita: null }),
     fila({ base_comision: 0 }), fila({ base_comision: null }),
     fila({ precio_venta: 4_000_000, base_comision: 3_250_000, comision_valor: 300_000, pct_comision: 0.0923 })].map(total),
    [100_000, 100_000, 0, 100_000, 300_000],
  );
});

// ── 2. NETO ────────────────────────────────────────────────────────────────
test("descontada: marca nueva o firma legado de reservar (comision_estado 'descontada' + estado 'pagada')", () => {
  assert.equal(esComisionDescontada({ descontada_en_precio: true, estado: "pagada" }, "descontada"), true);
  assert.equal(esComisionDescontada({ descontada_en_precio: false, estado: "pagada" }, "descontada"), true, "NETO anterior a la 205");
  assert.equal(esComisionDescontada({ descontada_en_precio: false, estado: "pendiente" }, "descontada"), false, "otra comisión en un contrato NETO");
  assert.equal(esComisionDescontada({ descontada_en_precio: false, estado: "pagada" }, "pendiente"), false, "comisionable marcada pagada antes de la 131");
  assert.equal(esComisionDescontada({ descontada_en_precio: false, estado: "pagada" }, null), false);
});

test("NETO sin abonos ya no aparece 'pendiente'; con el abono sintético de la 131 se ve como siempre", () => {
  assert.equal(estadoComisionFila(80_000, 0, true), "descontada");
  assert.equal(estadoComisionFila(80_000, 80_000, true), "pagada", "pago sintético: no se reinterpreta");
  assert.equal(estadoComisionFila(80_000, 0, false), "pendiente");
  assert.equal(estadoComisionFila(80_000, 30_000, false), "parcial");
});

test("Rentabilidad: la comisión NETO ya no se resta dos veces (según los importes guardados)", () => {
  const costo = 600_000;
  const neta = fila({ estado: "pagada", descontada_en_precio: true });
  const comisionable = fila();
  // reservar guarda ventas.precio_venta = PVP − comisión en NETO.
  const rNeta = calcRentabilidad({ precioVenta: PVP - 80_000, costoDirecto: costo, comB2B: comisionParaRentabilidad(neta, "descontada"), comAsesor: 0 });
  const rCom = calcRentabilidad({ precioVenta: PVP, costoDirecto: costo, comB2B: comisionParaRentabilidad(comisionable, "pendiente"), comAsesor: 0 });
  assert.equal(rNeta.utilBruta - rNeta.comB2B, 320_000);
  assert.equal(rCom.utilBruta - rCom.comB2B, 320_000);
  // Firma legado también (las NETO anteriores a la 205).
  assert.equal(comisionParaRentabilidad(fila({ estado: "pagada" }), "descontada"), 0);
});

// ── 3. Edición ─────────────────────────────────────────────────────────────
const edicion = (e: Partial<Parameters<typeof prepararEdicionComision>[1]>) => ({
  base: null, modo: "pct" as const, pct: 0.1, valor: null, recobroTotal: 0, pctRecobroAliado: null, ...e,
});

test("legado base 0: dejar la casilla vacía NO toca la base ni el total", () => {
  const f = fila({ base_comision: 0, base_explicita: null });
  const r = prepararEdicionComision(f, edicion({ base: null, pct: 0.1 }));
  assert.ok(r.ok);
  assert.equal("base_comision" in r.cambios, false);
  assert.equal(total({ ...f, ...r.cambios }), 100_000);
});

test("legado base 0: escribir 0 a propósito la vuelve explícita → comisión base 0", () => {
  const f = fila({ base_comision: 0, base_explicita: null });
  const r = prepararEdicionComision(f, edicion({ base: 0 }));
  assert.ok(r.ok);
  assert.equal(r.cambios.base_comision, 0);
  assert.equal(r.cambios.base_explicita, true);
  assert.equal(total({ ...f, ...r.cambios }), 0);
});

test("fila nueva: vaciar la base = sin base definida (cae al PVP)", () => {
  const f = fila({ base_comision: 800_000 });
  const r = prepararEdicionComision(f, edicion({ base: null }));
  assert.ok(r.ok);
  assert.equal(r.cambios.base_comision, null);
  assert.equal(total({ ...f, ...r.cambios }), 100_000);
});

test("base mayor que el PVP se rechaza; base negativa también", () => {
  assert.equal(prepararEdicionComision(fila(), edicion({ base: PVP + 1 })).ok, false);
  assert.equal(prepararEdicionComision(fila(), edicion({ base: -1 })).ok, false);
  assert.equal(prepararEdicionComision(fila(), edicion({ base: PVP })).ok, true);
});

test("% 0 es legítimo; % vacío es un dato que falta", () => {
  const cero = prepararEdicionComision(fila(), edicion({ pct: 0 }));
  assert.ok(cero.ok);
  assert.equal(cero.cambios.pct_comision, 0);
  const vacio = prepararEdicionComision(fila(), edicion({ pct: null }));
  assert.equal(vacio.ok, false);
  assert.match((vacio as { error: string }).error, /escribe 0/);
});

test("por valor: se guarda el importe al peso; 0 vale; vacío falta; no puede superar la base", () => {
  const f = fila({ precio_venta: 4_000_000, base_comision: 3_250_000 });
  const r = prepararEdicionComision(f, edicion({ base: 3_250_000, modo: "valor", valor: 300_000, pct: null }));
  assert.ok(r.ok);
  assert.equal(r.cambios.comision_valor, 300_000);
  assert.equal(r.cambios.pct_comision, 0.0923, "el % queda informativo");
  assert.equal(total({ ...f, ...r.cambios }), 300_000);
  const cero = prepararEdicionComision(f, edicion({ base: 3_250_000, modo: "valor", valor: 0 }));
  assert.ok(cero.ok);
  assert.equal(total({ ...f, ...cero.cambios }), 0);
  assert.equal(prepararEdicionComision(f, edicion({ base: 3_250_000, modo: "valor", valor: null })).ok, false);
  assert.equal(prepararEdicionComision(f, edicion({ base: 3_250_000, modo: "valor", valor: 3_250_001 })).ok, false);
});

test("volver a % borra el valor fijo; el % del recobro vacío conserva el guardado", () => {
  const f = fila({ comision_valor: 77_777, pct_recobro_aliado: 0.4 });
  const r = prepararEdicionComision(f, edicion({ base: 800_000, pct: 0.1 }));
  assert.ok(r.ok);
  assert.equal(r.cambios.comision_valor, null);
  assert.equal("pct_recobro_aliado" in r.cambios, false);
});

// ── 4. Varias comisiones: quién cobra cuál ─────────────────────────────────
const filas = [
  fila({ id: 1, aliado_id: 7 }),
  fila({ id: 2, aliado_id: 9 }),
  fila({ id: 3, aliado_id: null }),
  fila({ id: 4, aliado_id: 7, estado: "pagada", descontada_en_precio: true }),
];

test("interno: todas las cobrables (nunca la descontada) y debe elegir", () => {
  const c = filasCobrables(filas, null, { esInterno: true, aliadoId: null });
  assert.deepEqual(c.map((f) => f.id), [1, 2, 3]);
  assert.equal(elegirFilaCobro(c, null).tipo, "elegir", "no elige en silencio la más reciente");
  const e = elegirFilaCobro(c, 2);
  assert.equal(e.tipo === "fila" && e.fila.id, 2);
});

test("aliado: solo las suyas; nunca las enlazadas a otro aliado", () => {
  assert.deepEqual(filasCobrables(filas, null, { esInterno: false, aliadoId: 7 }).map((f) => f.id), [1]);
  assert.deepEqual(filasCobrables(filas, null, { esInterno: false, aliadoId: 9 }).map((f) => f.id), [2]);
  // Una fila sin ficha NO se ofrece solo por abrir el contrato (#38): sin un
  // nombre propio probado, falla cerrado.
  assert.deepEqual(filasCobrables(filas, null, { esInterno: false, aliadoId: null }).map((f) => f.id), []);
  assert.deepEqual(filasCobrables(filas, null, { esInterno: false, aliadoId: 55 }).map((f) => f.id), []);
  // Un id ajeno por URL no se abre.
  assert.equal(elegirFilaCobro(filasCobrables(filas, null, { esInterno: false, aliadoId: 7 }), 2).tipo, "ninguna");
});

test("aliado: una fila sin ficha solo con SU documento; el texto del beneficiario no prueba nada (homónimo)", () => {
  const sinFicha = [
    fila({ id: 10, aliado_id: null, aliado: "Viajes Andinos", nit: "900.111.222-3" }), // su documento
    fila({ id: 11, aliado_id: null, aliado: "Viajes Andinos", nit: "800999000" }),     // homónimo: mismo texto, otro documento
    fila({ id: 12, aliado_id: null, aliado: "Viajes Andinos", nit: null }),            // solo texto
    fila({ id: 13, aliado_id: 7, aliado: "Otro texto", nit: null }),                   // enlazada a su ficha
    fila({ id: 14, aliado_id: 9, aliado: "Viajes Andinos", nit: "900111222" }),        // enlazada a OTRA ficha: nunca
  ];
  const ve = (u: Parameters<typeof filasCobrables>[2]) => filasCobrables(sinFicha, null, u).map((f) => f.id);
  assert.deepEqual(ve({ esInterno: false, aliadoId: 7, documento: "900111222-3" }), [10, 13]);
  assert.deepEqual(ve({ esInterno: false, aliadoId: 7, documento: "9001112223" }), [13], "con el DV pegado no es el mismo: falla cerrado");
  // Sin documento, el nombre de su ficha o de ventas ya no cuenta (no se pasa).
  assert.deepEqual(ve({ esInterno: false, aliadoId: 7, documento: null }), [13]);
  // Documentos vacíos nunca empatan.
  assert.deepEqual(ve({ esInterno: false, aliadoId: null, documento: " - " }), []);
  assert.deepEqual(ve({ esInterno: true, aliadoId: null }), [10, 11, 12, 13, 14]);
  assert.equal(normalizarDocumento("900.111.222-3"), "900111222");
  assert.equal(normalizarDocumento(" cc 1.020.304 "), "CC1020304");
  assert.equal(normalizarDocumento("-"), null);
});

test("aliado legacy por nombre (193): la fila sin ficha a SU nombre sí; solo con esa vía", () => {
  const filasL = [
    fila({ id: 20, aliado_id: null, aliado: "  VIAJES   Ándinos " }),
    fila({ id: 21, aliado_id: null, aliado: "Otro Nombre" }),
  ];
  const legacy = evidenciaSinFicha({ via: "nombre_legacy", documentoFicha: null, nombreUsuario: "Viajes Andinos" });
  assert.deepEqual(filasCobrables(filasL, null, { esInterno: false, aliadoId: null, ...legacy }).map((f) => f.id), [20]);
  for (const via of ["b2b_usuario_id", "aliado_id", "interno_mismo_tenant"]) {
    const e = evidenciaSinFicha({ via, documentoFicha: null, nombreUsuario: "Viajes Andinos" });
    assert.equal(e.nombreLegacy, null, via);
    assert.deepEqual(filasCobrables(filasL, null, { esInterno: false, aliadoId: 7, ...e }), [], `${via}: el nombre no cuenta`);
  }
  assert.equal(normalizarNombreAliado("  JUAN   Pérez "), "juan perez");
  assert.equal(normalizarNombreAliado("   "), null);
});

test("NETO: la descontada nunca es cobrable, ni pidiéndola por id", () => {
  const c = filasCobrables(filas, null, { esInterno: true, aliadoId: null });
  assert.equal(elegirFilaCobro(c, 4).tipo, "ninguna");
  const soloNeto = [fila({ id: 8, estado: "pagada" })];
  assert.deepEqual(filasCobrables(soloNeto, "descontada", { esInterno: true, aliadoId: null }), []);
});

test("NETO mixto: con el contrato vendido neto, una segunda fila NO descontada tampoco es cobrable; portal y cuenta de cobro coinciden", () => {
  const mixto = [
    fila({ id: 55, aliado_id: 7, estado: "pagada", descontada_en_precio: true }),
    fila({ id: 56, aliado_id: 7, pct_comision: 0.05 }),          // segunda fila, mismo aliado
    fila({ id: 57, aliado_id: null, nit: "900111222" }),        // sin ficha, con su documento
  ];
  assert.deepEqual(filasCobrables(mixto, "descontada", { esInterno: false, aliadoId: 7, documento: "900111222" }), []);
  assert.deepEqual(filasCobrables(mixto, "descontada", { esInterno: true, aliadoId: null }), [], "tampoco para un interno");
  assert.equal(elegirFilaCobro(filasCobrables(mixto, "descontada", { esInterno: false, aliadoId: 7 }), 56).tipo, "ninguna");
  const vis = comisionVisibleAliado(mixto, { comision_estado: "descontada", comision_b2b: 80_000, modo_compra: "neta" },
    { aliadoId: 7, documento: "900111222", nombreLegacy: null });
  assert.deepEqual([vis.fuente, vis.total, vis.cobrable, vis.ids], ["descontada", 80_000, false, []]);
  // El mismo contrato en modo comisionable sí ofrece sus filas vivas.
  assert.deepEqual(filasCobrables(mixto, "pendiente", { esInterno: false, aliadoId: 7, documento: "900111222" }).map((f) => f.id), [56, 57]);
});

// ── 5. Permisos (espejo de la RLS de la 205) ───────────────────────────────
test("editar/borrar/abonar: superadmin, gerencia y administración según tenant", () => {
  const p = (rol: string, tenant = "mayorista", activo = true) => ({ rol, tenant, activo });
  const g = (perfil: ReturnType<typeof p> | null, t: string) => autorizarComisionB2B(perfil, t, ROLES_GESTION_COMISION).permitido;
  assert.equal(g(p("administracion"), "mayorista"), true);
  assert.equal(g(p("administracion", "mayorista"), "minorista"), false, "otra agencia");
  assert.equal(g(p("gerencia", "minorista"), "mayorista"), true, "puede_ver_tenant: gerencia en las dos");
  assert.equal(g(p("superadmin", "minorista"), "mayorista"), true);
  assert.equal(g(p("operaciones"), "mayorista"), false);
  assert.equal(g(p("venta"), "mayorista"), false);
  assert.equal(g(p("agencia"), "mayorista"), false);
  assert.equal(g(p("administracion", "mayorista", false), "mayorista"), false, "inactivo");
  assert.equal(g(null, "mayorista"), false);
  // Alta desde la pestaña: operaciones sí.
  assert.equal(autorizarComisionB2B(p("operaciones"), "mayorista", ROLES_ALTA_COMISION).permitido, true);
});

// ── 6. % con el que nace una comisión automática ───────────────────────────
test("% del aliado: 0 explícito se respeta; sin dato cae al parámetro y luego al default (sin NaN)", () => {
  assert.equal(pctComisionAliado(0, "0.12", "agencia"), 0);
  assert.equal(pctComisionAliado(null, "0.08", "agencia"), 0.08);
  assert.equal(pctComisionAliado(null, 0, "agencia"), 0, "parámetro en 0");
  assert.equal(pctComisionAliado(null, undefined, "agencia"), 0.12);
  assert.equal(pctComisionAliado(null, undefined, "freelance"), 0.11);
  assert.equal(pctComisionAliado(undefined, "x", "freelance"), 0.11);
});

// ── 7. Guardas de cableado ─────────────────────────────────────────────────
test("la migración 205 no modifica filas existentes (sin UPDATE/DELETE/INSERT fuera de funciones)", () => {
  const sql = leer("supabase/migrations/20260601000205_comisiones_b2b_integridad.sql")
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
    // Los cuerpos de función ($$ … $$) solo corren cuando alguien los llama.
    .replace(/\$\$[\s\S]*?\$\$/g, "");
  assert.doesNotMatch(sql, /^\s*update\s+public\./im);
  assert.doesNotMatch(sql, /^\s*delete\s+from\s+public\./im);
  assert.doesNotMatch(sql, /^\s*insert\s+into\s+public\./im);
});

test("la 205 NO da default a base_explicita: un insert del código viejo queda legado (NULL)", () => {
  const sql = leer("supabase/migrations/20260601000205_comisiones_b2b_integridad.sql");
  assert.doesNotMatch(sql, /base_explicita\s+set\s+default/i);
  assert.match(sql, /alter column base_explicita drop default;/);
  assert.match(sql, /add column if not exists base_explicita boolean;/);
});

test("altas nuevas: solo por funciones de la base, que marcan base_explicita = true (no hay default)", () => {
  const manual = leer("app/(dashboard)/dashboard/contratos/actions.ts");
  const pestana = leer("app/(dashboard)/dashboard/contratos/[numero]/gestion-actions.ts");
  const sql = leer("supabase/migrations/20260601000205_comisiones_b2b_integridad.sql");
  // Contrato manual: ya no crea comisión (nace "Por definir").
  assert.doesNotMatch(manual, /from\("aliados_b2b"\)/);
  // Pestaña: registrar_comision_b2b_manual, nunca insert directo.
  assert.doesNotMatch(pestana, /from\("aliados_b2b"\)\.insert/);
  assert.match(pestana, /sb\.rpc\("registrar_comision_b2b_manual"/);
  // Las dos funciones insertan con base explícita.
  assert.match(sql, /v_bruto, v_base, true, v_pct,/, "reservar");
  assert.match(sql, /greatest\(0, coalesce\(v\.precio_venta, 0\) - coalesce\(v\.impuesto, 0\)\), true, p_pct,/, "manual");
});

test("permisos de comisión por rol en la pestaña del contrato", () => {
  const p = permisosComisionContrato;
  // Ver: todos los internos con tenant, salvo control_vuelo; los externos no.
  for (const rol of ["superadmin", "gerencia", "administracion", "operaciones", "venta"]) assert.equal(p(rol, false).ver, true, rol);
  for (const rol of ["control_vuelo", "agencia", "freelance", "cliente_final", null]) {
    assert.deepEqual(p(rol, true), { ver: false, registrar: false, editar: false, borrar: false, soloAliadoDelContrato: false }, String(rol));
  }
  // venta: en SU contrato registra y corrige (base, %, valor); nunca borra; el de un colega solo lo ve.
  assert.deepEqual(p("venta", true), { ver: true, registrar: true, editar: true, borrar: false, soloAliadoDelContrato: true });
  assert.deepEqual(p("venta", false), { ver: true, registrar: false, editar: false, borrar: false, soloAliadoDelContrato: true });
  // operaciones registra (cualquier contrato de su tenant) pero no corrige ni borra.
  assert.deepEqual(p("operaciones", false), { ver: true, registrar: true, editar: false, borrar: false, soloAliadoDelContrato: false });
  assert.deepEqual(p("administracion", false), { ver: true, registrar: true, editar: true, borrar: true, soloAliadoDelContrato: false });
});

test("corrección del asesor: solo venta, activa, de la agencia de la comisión y en SU contrato", () => {
  const v = (extra = {}) => ({ rol: "venta", activo: true, tenant: "mayorista", ...extra });
  assert.equal(autorizarCorreccionAsesor(v(), "mayorista", true).permitido, true);
  const motivo = (r: ReturnType<typeof autorizarCorreccionAsesor>) => (r.permitido ? "" : r.error);
  assert.match(motivo(autorizarCorreccionAsesor(v(), "mayorista", false)), /tus propios contratos/, "contrato de un colega");
  assert.equal(autorizarCorreccionAsesor(v({ tenant: "minorista" }), "mayorista", true).permitido, false, "otra agencia");
  assert.equal(autorizarCorreccionAsesor(v({ activo: false }), "mayorista", true).permitido, false, "inactivo");
  assert.equal(autorizarCorreccionAsesor(v({ rol: "control_vuelo" }), "mayorista", true).permitido, false, "control_vuelo");
  assert.equal(autorizarCorreccionAsesor(v({ rol: "operaciones" }), "mayorista", true).permitido, false, "operaciones no corrige");
  assert.equal(autorizarCorreccionAsesor(null, "mayorista", true).permitido, false);
});

test("RLS de la 205: venta lee su agencia y corrige SOLO su contrato; no borra ni abona; control_vuelo nada", () => {
  const sql = leer("supabase/migrations/20260601000205_comisiones_b2b_integridad.sql");
  const lectura = /create policy "aliados_b2b: lectura contable"[\s\S]*?;/.exec(sql)?.[0] ?? "";
  assert.match(lectura, /'venta'/);
  assert.doesNotMatch(lectura, /control_vuelo/);
  const asesor = /create policy "aliados_b2b: edicion asesor"[\s\S]*?;/.exec(sql)?.[0] ?? "";
  assert.match(asesor, /mi_rol\(\) = 'venta'/);
  assert.equal((asesor.match(/soy_asesor_del_contrato\(numero_contrato\)/g) ?? []).length, 2, "en using y en with check");
  // El trigger limita qué corrige y cuándo.
  assert.match(sql, /if public\.mi_rol\(\) = 'venta' then\s*\n\s*if v_con_abonos then/);
  assert.match(sql, /El asesor solo puede corregir la base, el porcentaje, el valor y el recobro de su comisión\./);
  for (const nombre of ["alta contable", "edicion contable", "borrado contable"]) {
    const pol = new RegExp(`create policy "aliados_b2b: ${nombre}"[\\s\\S]*?;`).exec(sql)?.[0] ?? "";
    assert.ok(pol, nombre);
    assert.doesNotMatch(pol, /'venta'/, `${nombre} no incluye venta`);
  }
  assert.doesNotMatch(sql, /comision_b2b_pagos[^;]*'venta'/, "los abonos no se tocan para venta");
});

test("la página del contrato y la pestaña usan los permisos por rol (no verFinanzas) para Comisiones", () => {
  const page = leer("app/(dashboard)/dashboard/contratos/[numero]/page.tsx");
  assert.match(page, /permisosComisionContrato\(perfil\?\.rol, esAsesorDelContrato === true\)/);
  const tabs = leer("app/(dashboard)/dashboard/contratos/[numero]/GestionTabs.tsx");
  assert.match(tabs, /p\.permisosComision\?\.ver && tab === "comisiones"/);
  assert.doesNotMatch(tabs, /p\.verFinanzas && tab === "comisiones"/);
});

test("reservar: aliado obligatorio ANTES de numerar; la comisión la crea la base y si falla se revierte", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const ini = src.indexOf("async function reservarDesdeTarifarioInterno");
  const fin = src.indexOf("\nexport async function", ini);
  const cuerpo = src.slice(ini, fin);
  assert.doesNotMatch(cuerpo, /from\("aliados_b2b"\)/, "ya no inserta aliados_b2b directo (la RLS lo rechazaba y el error se perdía)");
  const iAliado = cuerpo.indexOf("resolverAliadoReserva(sb, input.tipoAsesor, input.aliadoId)");
  const iNumero = cuerpo.indexOf("siguienteNumeroContrato(tenant)");
  assert.ok(iAliado > 0 && iNumero > 0 && iAliado < iNumero, "el aliado se valida antes de numerar");
  assert.match(cuerpo, /const com = await registrarComisionReserva\(sb, numero, aliadoB2B\);\s*\n\s*if \(!com\.ok\) return fallarYRevertir\(com\.error\);/);
  assert.doesNotMatch(cuerpo, /createAdminClient\(\)[^\n]*\n[^\n]*registrar_comision_b2b_reserva/, "sin service-role para la comisión");
});

test("plan de comisión de reserva: comisionable, neta, sin modo, base 0 y modo inválido", () => {
  const p = (modoCompra: string | null, impuesto = 200_000) => planComisionReserva({ modoCompra, precioVenta: 1_000_000, impuesto, pct: 0.1 });
  const com = p("comisionable");
  assert.ok(com.ok);
  assert.deepEqual(com.plan, { pct: 0.1, base: 800_000, comision: 80_000, modoCompra: "comisionable", comisionEstado: "pendiente", precioFinal: 1_000_000 });
  const neta = p("neta");
  assert.ok(neta.ok);
  assert.equal(neta.plan.precioFinal, 920_000);
  assert.equal(neta.plan.comisionEstado, "descontada");
  const sinModo = p(null);
  assert.ok(sinModo.ok);
  assert.equal(sinModo.plan.comision, null);
  const cero = p("comisionable", 1_000_000);
  assert.ok(cero.ok);
  assert.equal(cero.plan.comision, 0);
  assert.equal(p("regalada").ok, false);
});

test("todas las pantallas leen la comisión con la MISMA función por fila", () => {
  for (const archivo of [
    "app/(dashboard)/dashboard/comisiones/page.tsx",
    "app/(dashboard)/dashboard/contratos/[numero]/GestionTabs.tsx",
    "lib/finanzas/rentabilidad.ts",
    "lib/finanzas/comisionResolver.ts",
  ]) {
    const src = leer(archivo);
    assert.doesNotMatch(src, /calcComisionB2B\(/, `${archivo} volvió a armar calcComisionB2B a mano (sin base_explicita/comision_valor)`);
    assert.match(src, /calcularComisionFila|comisionParaRentabilidad/, `${archivo} no usa la lectura compartida`);
  }
});

test("la cuenta de cobro ya no elige en silencio la comisión más reciente", () => {
  const src = leer("lib/finanzas/comisionResolver.ts");
  assert.doesNotMatch(src, /from\("aliados_b2b"\)[\s\S]{0,400}\.limit\(1\)/);
  assert.match(src, /filasCobrables\(/);
  assert.match(src, /elegirFilaCobro\(/);
});
