// Se ejecuta con npm run test:react (loader del arnés).
//
// #65 — Filas de comisión B2B EN REVISIÓN CONTABLE (migración 268). El dueño aplazó la conciliación de #1, #80, #81, #82, #83, #85, #89, #107, #135 y #137:
// mientras estén en la tabla de retención, el portal no las atribuye a nadie (ni participación, ni importe, ni «Pagada», ni cuenta de cobro). El código no conoce ids:
// la lista es DATO (`comision_b2b_revision`). Las tablas de datos reales (20 líneas, totales y abonos) son las del precheck del 1-nov-2026; cuentas, ventas y
// titulares son sintéticos. Nada se modifica: los registros quedan intactos. No hay cierre en esta entrega: quitar una fila de la tabla (tarea posterior) devolvería el comportamiento anterior.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { contratosPorParticipacion } = await import("../lib/auth/participacionComisionB2B.ts");
const { cargarConjuntoPortal } = await import("../lib/portal/b2bPortalServidor.ts");
const { resolverComisionB2B } = await import("../lib/finanzas/comisionResolver.ts");
const { supabaseEnMemoria } = await import("./support/memoriaSupabase.ts");
const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { __setAdmin, __resetAdmin } = await import("./support/stubs/supabaseAdminStub.mjs");

type Fila = Record<string, unknown>;
afterEach(() => { __resetClient(); __resetAdmin(); });

// [contrato, fila, ficha ACTUAL, total, abonos registrados]
const LINEAS: [string, number, number | null, number, number][] = [
  ["MIN-00-0422", 44, 33, 857_197, 857_197], ["MIN-00-0422", 81, 8, 599_964, 600_000],
  ["MIN-00-0432", 53, 1, 768_949.2, 768_949.2], ["MIN-00-0432", 82, 8, 141_360, 141_360],
  ["MIN-00-0433", 54, 1, 1_808_519.68, 1_808_519.68], ["MIN-00-0433", 83, 8, 541_036, 541_036],
  ["MIN-00-0439", 59, 24, 693_266.64, 693_266.64], ["MIN-00-0439", 85, 8, 140_180, 140_180],
  ["MIN-00-0462", 79, 3, 191_224, 191_224], ["MIN-00-0462", 80, 8, 142_494, 142_494],
  ["MIN-00-0463", 88, 28, 172_629.6, 172_629.6], ["MIN-00-0463", 89, 8, 207_831, 207_831],
  ["MIN-00-0476", 100, 8, 484_747.56, 484_748], ["MIN-00-0476", 101, 8, 349_782, 350_000],
  ["MIN-00-0484", 106, 7, 125_468.2, 125_469], ["MIN-00-0484", 107, 8, 71_296.5, 71_297],
  ["MIN-00-0498", 1, null, 1_260_903.68, 1_617_580], ["MIN-00-0498", 121, 8, 137_747, 137_747],
  ["MIN-00-0519", 135, null, 351_852.16, 351_852.16], ["MIN-00-0519", 137, 8, 139_000, 139_000],
];
/** Las diez filas cuya conciliación se aplazó. */
const EN_REVISION = [1, 80, 81, 82, 83, 85, 89, 107, 135, 137];
/** Titular (persona de la línea 1) de cada venta. */
const DUENO: Record<string, number> = {
  "MIN-00-0422": 33, "MIN-00-0432": 1, "MIN-00-0433": 1, "MIN-00-0439": 24, "MIN-00-0462": 3,
  "MIN-00-0463": 28, "MIN-00-0476": 8, "MIN-00-0484": 7, "MIN-00-0498": 8, "MIN-00-0519": 37,
};
const FICHAS = [1, 3, 7, 8, 24, 28, 33, 37];

const venta = (numero: string, aliadoId: number): Fila => ({
  numero_contrato: numero, tenant: "minorista", cliente: `Cliente ${numero}`, destino: "SMR", fecha_salida: "2026-12-01",
  estado: "confirmado", precio_venta: 2_000_000, moneda: "COP", b2b_usuario_id: null, aliado_id: aliadoId,
  agencia_nombre: null, freelance_nombre: null, tipo_asesor: "freelance", modo_compra: "comisionable", comision_b2b: null, comision_estado: null,
});
const usuario = (ficha: number): Fila => ({
  id: `u-${ficha}`, nombre: `Ficha ${ficha}`, rol: "freelance", activo: true, tenant: "minorista", agencia_id: null, pct_comision: null, aliado_id: ficha, acceso_legacy_nombre: false,
});

function tablas(revision: Fila[]): Record<string, Fila[]> {
  return {
    usuarios: FICHAS.map(usuario),
    aliados: FICHAS.map((id) => ({ id, nombre: `Ficha ${id}`, nit: String(id) })),
    ventas: Object.entries(DUENO).map(([n, d]) => venta(n, d)),
    aliados_b2b: LINEAS.map(([n, id, ficha, total]) => ({
      id, numero_contrato: n, tenant: "minorista", aliado: `Ficha ${ficha}`, tipo_aliado: "freelance", aliado_id: ficha,
      precio_venta: 2_000_000, base_comision: 0, base_explicita: false, comision_valor: total, pct_comision: 0,
      recobro_total: 0, pct_recobro_aliado: 0, aplica_retencion: false, pct_retencion: 0, estado: "pendiente", descontada_en_precio: false,
    })),
    comision_b2b_pagos: LINEAS.map(([, id, , , abonado], i) => ({ id: i + 1, aliado_b2b_id: id, valor: abonado, fecha: "2026-10-05" })),
    comision_b2b_revision: revision,
  };
}
const abiertas = () => EN_REVISION.map((id) => ({ aliado_b2b_id: id }));
const ctx = (ficha: number) => ({
  estado: "ok" as const, userId: `u-${ficha}`, email: `u-${ficha}@t.test`, nombre: `Ficha ${ficha}`, rol: "freelance" as const, tenant: "minorista",
  aliadoId: ficha, accesoLegacyNombre: false, agenciaId: null, pctPerfil: null, esTitularAgencia: false,
});
const montar = (t: Record<string, Fila[]>, ficha: number) => { __setAdmin(supabaseEnMemoria(t)); __setClient(supabaseEnMemoria(t, {}, `u-${ficha}`)); };
const nums = (c: { ventas: { numero_contrato: string; relacion: string }[] }, rel: string) => c.ventas.filter((v) => v.relacion === rel).map((v) => v.numero_contrato).sort();
const ver = async (t: Record<string, Fila[]>, ficha: number) => { montar(t, ficha); return cargarConjuntoPortal(ctx(ficha) as never); };

test("CON las diez filas retenidas: Javier (ficha 8) ya no ve participación ni contratos ajenos; solo lo suyo sin marca (0476 y 0498)", async () => {
  const jav = await ver(tablas(abiertas()), 8);
  assert.deepEqual(nums(jav, "participacion"), [], "ninguna de sus líneas 2 marcadas da participación");
  assert.deepEqual(nums(jav, "propio"), ["MIN-00-0476", "MIN-00-0498"]);
  assert.deepEqual(jav.comisiones.get("MIN-00-0476")?.ids, [100, 101]);
  assert.deepEqual(jav.comisiones.get("MIN-00-0476")?.estado, "pagada", "lo sin marca conserva su estado");
  assert.deepEqual(jav.comisiones.get("MIN-00-0498")?.ids, [121], "la fila 1 (marcada) no se suma a su contrato");
  for (const n of ["MIN-00-0422", "MIN-00-0432", "MIN-00-0433", "MIN-00-0439", "MIN-00-0462", "MIN-00-0463", "MIN-00-0484", "MIN-00-0519"]) {
    assert.ok(!jav.ventas.some((v) => v.numero_contrato === n), `${n}: Javier no lo ve`);
    assert.equal(jav.comisiones.get(n) ?? null, null, `${n}: sin comisión atribuida`);
  }
});

test("CON las filas retenidas: la ficha 3 (Tatiana) ve solo su línea 1 de 0462 (#79) y nunca la #80; cada línea 1 ve lo suyo y Yaqueline nada de 0519", async () => {
  const t = tablas(abiertas());
  const tat = await ver(t, 3);
  assert.deepEqual(nums(tat, "propio"), ["MIN-00-0462"]);
  assert.deepEqual(nums(tat, "participacion"), []);
  assert.deepEqual(tat.comisiones.get("MIN-00-0462")?.ids, [79]);
  for (const [ficha, n, id] of [[33, "MIN-00-0422", 44], [1, "MIN-00-0432", 53], [24, "MIN-00-0439", 59], [28, "MIN-00-0463", 88], [7, "MIN-00-0484", 106]] as const) {
    const c = await ver(t, ficha);
    assert.deepEqual(c.comisiones.get(n)?.ids, [id], `ficha ${ficha}: solo su línea 1 de ${n}`);
    assert.deepEqual(nums(c, "participacion"), []);
  }
  const yaq = await ver(t, 37);
  assert.equal(yaq.comisiones.get("MIN-00-0519")?.importe ?? null, null, "la #135 no tiene ficha y la #137 está marcada: Yaqueline no ve comisión");
});

test("una fila retenida que habría sido SUYA muestra el contrato «en revisión», sin importe ni «Pagada»", async () => {
  // Estado hipotético posterior a asignar #80→3 sin levantar la retención: Tatiana tendría #79 y #80; el contrato no debe verse pagado.
  const t = tablas(abiertas());
  t.aliados_b2b = t.aliados_b2b.map((f) => (f.id === 80 ? { ...f, aliado_id: 3 } : f));
  const tat = await ver(t, 3);
  const com = tat.comisiones.get("MIN-00-0462");
  assert.equal(com?.estado, "en_revision");
  assert.equal(com?.importe, null);
  assert.equal(com?.cobrable, false);
  assert.deepEqual(com?.ids, []);
});

test("la retención es solo la tabla: sin la fila 81 en ella vuelve a contar, y el registro no cambió", async () => {
  const t = tablas(EN_REVISION.filter((id) => id !== 81).map((id) => ({ aliado_b2b_id: id })));
  const antes = JSON.stringify(t.aliados_b2b) + JSON.stringify(t.comision_b2b_pagos);
  const jav = await ver(t, 8);
  assert.deepEqual(nums(jav, "participacion"), ["MIN-00-0422"], "solo la fila 81 (sin retención) vuelve a contar");
  assert.equal(JSON.stringify(t.aliados_b2b) + JSON.stringify(t.comision_b2b_pagos), antes);
});

test("CUENTA DE COBRO por URL: con la fila retenida Javier no abre 0422 (#81); sin retenciones la abriría", async () => {
  montar(tablas(abiertas()), 8);
  assert.equal(await resolverComisionB2B("MIN-00-0422"), null);
  montar(tablas([]), 8);
  assert.notEqual(await resolverComisionB2B("MIN-00-0422"), null, "control: sin retenciones, la fila #81 sí lo dejaba entrar");
});

test("FALLA CERRADO: si no se puede leer la tabla de marcas (p. ej. migración sin correr) no se muestra participación, comisión ni cuenta de cobro", async () => {
  const t = tablas(abiertas());
  const fallar = (c: { tabla: string }) => (c.tabla === "comision_b2b_revision" ? ("error" as const) : null);
  assert.deepEqual(await contratosPorParticipacion(supabaseEnMemoria(t, { fallar }) as never, 8, "numero_contrato", new Set()), { filas: [], completa: false });
  __setAdmin(supabaseEnMemoria(t, { fallar })); __setClient(supabaseEnMemoria(t, {}, "u-8"));
  const jav = await cargarConjuntoPortal(ctx(8) as never);
  assert.equal(jav.participacionCompleta, false);
  assert.equal(jav.comisiones.get("MIN-00-0476") ?? null, null, "tampoco muestra importes propios sin poder verificar las marcas");
  assert.equal(await resolverComisionB2B("MIN-00-0422"), null);
});

test("LAS DIEZ FILAS, para TODA ficha: ninguna aparece en participación, importe, estado ni suma de ids, y ninguna cuenta de cobro se abre por ellas", async () => {
  const t = tablas(abiertas());
  const CONTRATO = new Map(LINEAS.map(([n, id]) => [id, n]));
  for (const ficha of FICHAS) {
    const c = await ver(t, ficha);
    const ids = [...c.comisiones.values()].flatMap((v) => v?.ids ?? []);
    for (const id of EN_REVISION) assert.ok(!ids.includes(id), `ficha ${ficha}: la fila ${id} no suma en ningún contrato`);
    for (const v of c.ventas.filter((x) => x.relacion === "participacion")) {
      const propias = LINEAS.filter(([n, , f]) => n === v.numero_contrato && f === ficha).map(([, id]) => id);
      assert.ok(propias.some((id) => !EN_REVISION.includes(id)), `ficha ${ficha}: ${v.numero_contrato} no es participación por una fila retenida`);
    }
    // Un contrato que SÍ se muestra no puede llevar importe/estado «pagada» de una fila retenida: o sus ids son no retenidos, o sale «en_revision» sin importe.
    for (const [n, com] of c.comisiones) {
      if (com?.estado === "en_revision") assert.equal(com.importe, null, `ficha ${ficha}: ${n} en revisión sin importe`);
      else for (const id of com?.ids ?? []) assert.ok(!EN_REVISION.includes(id));
    }
    // Cuenta de cobro por URL: ninguna de las diez, pedida explícitamente, la abre.
    for (const id of EN_REVISION) {
      montar(t, ficha);
      assert.equal(await resolverComisionB2B(CONTRATO.get(id) as string, id), null, `ficha ${ficha}: cuenta de cobro de la fila ${id}`);
    }
  }
});
