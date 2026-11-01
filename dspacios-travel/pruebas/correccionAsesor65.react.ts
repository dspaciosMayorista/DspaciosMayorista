// Se ejecuta con npm run test:react (loader del arnés).
//
// #65 — Regla confirmada por el dueño: en 10 ventas la línea de COMISIÓN y la de RECOBRO pertenecen al mismo asesor.
// Esta prueba NO cambia el portal: fija que, una vez corregida la ficha de las filas mal atribuidas, el portal agrupa ambas líneas
// en UNA participación por contrato del asesor correcto y que quien figuraba por error (Javier en 0519) deja de verla.
// REGLA DE LA LÍNEA 1 (dueño, 1-nov-2026): la comisión se paga a la persona de la línea 1; Javier figura en la línea 2 porque asistió. Por eso en 0462 el asesor es
// Tatiana (ficha 3, real) y NO Javier, y #80 (línea 2 de 0462, total y abono registrado de $142.494) → ficha 3 es asignación CONFIRMADA pero EXCLUIDA del UPDATE hasta conciliar a quién se pagó; aquí solo se simula el estado posterior.
// Los escenarios «CORREGIDO»/«DESPUÉS» de abajo suponen corregidas TAMBIÉN #80, #135 y #137 (excluidas por conciliación). Con solo las siete filas del UPDATE, 0462 y 0519
// siguen PENDIENTE (como el postcheck del plan): lo fija la prueba «SOLO las siete filas».
// Los datos son sintéticos (importes inventados, fichas ilustrativas); lo real sale de supabase/scripts/conciliacion_asesor_comision_65_solo_lectura.sql.
// ⚠️ Estas pruebas describen el estado POSTERIOR a una corrección que HOY NO PUEDE EJECUTARSE: el precheck real marca las siete filas
// objetivo (1, 81, 82, 83, 85, 89, 107; la 79 se retiró por la regla de la línea 1) como REVISION_CONTABLE (tienen abonos registrados) y la 137 y la 135 como EXCLUIDAS por
// conciliación (abonos registrados reales de $139.000 y $351.852,16). No prueban que la corrección esté hecha ni autorizada; solo que,
// SI se hiciera, el portal agrupa bien. Distinguir: ASIGNACIÓN (confirmada, incluida 135→37) ≠ ABONO REGISTRADO ≠ DESTINATARIO DEL
// PAGO (desconocido: mover una fila de ficha no corrige ni prueba a quién se pagó). Los abonos de 39.000/10.000 de aquí son inventados,
// y la 135 real tiene ficha NULL (aquí figura con la 37 como escenario posterior).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { cargarConjuntoPortal } = await import("../lib/portal/b2bPortalServidor.ts");
const { supabaseEnMemoria } = await import("./support/memoriaSupabase.ts");
const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { __setAdmin, __resetAdmin } = await import("./support/stubs/supabaseAdminStub.mjs");

type Fila = Record<string, unknown>;
afterEach(() => { __resetClient(); __resetAdmin(); });

// Asesor confirmado por contrato → ficha (ilustrativa salvo 8 = Javier y 37 = Yaqueline, que sí vienen de los datos reales).
const ASESOR: Record<string, { ficha: number; nombre: string }> = {
  "MIN-00-0422": { ficha: 40, nombre: "Paola" },
  "MIN-00-0432": { ficha: 41, nombre: "Katherine Colorado" },
  "MIN-00-0433": { ficha: 41, nombre: "Katherine Colorado" },
  "MIN-00-0439": { ficha: 42, nombre: "Juliana" },
  "MIN-00-0462": { ficha: 3, nombre: "Tatiana" },
  "MIN-00-0463": { ficha: 43, nombre: "Marcela" },
  "MIN-00-0476": { ficha: 8, nombre: "Javier" },
  "MIN-00-0484": { ficha: 44, nombre: "Sebastián" },
  "MIN-00-0498": { ficha: 8, nombre: "Javier" },
  "MIN-00-0519": { ficha: 37, nombre: "Yaqueline" },
};
const NUMEROS = Object.keys(ASESOR);
const COMISION = 100_000;  // 1.000.000 × 10 %
const RECOBRO = 50_000;    // 100.000 × 50 %

const venta = (numero: string, aliadoId: number | null): Fila => ({
  numero_contrato: numero, tenant: "minorista", cliente: `Cliente ${numero}`, destino: "SMR", fecha_salida: "2026-12-01",
  estado: "confirmado", precio_venta: 2_000_000, moneda: "COP", b2b_usuario_id: null, aliado_id: aliadoId,
  agencia_nombre: null, freelance_nombre: null, tipo_asesor: "freelance", modo_compra: "comisionable", comision_b2b: null, comision_estado: null,
});
const linea = (id: number, numero: string, fichaId: number | null, extra: Fila): Fila => ({
  id, numero_contrato: numero, tenant: "minorista", aliado: fichaId == null ? "JAVIER VIEIRA" : `Ficha ${fichaId}`, tipo_aliado: "freelance", aliado_id: fichaId,
  precio_venta: 2_000_000, base_comision: 0, base_explicita: true, comision_valor: null, pct_comision: 0,
  recobro_total: 0, pct_recobro_aliado: 0, aplica_retencion: false, pct_retencion: 0, estado: "pendiente", descontada_en_precio: false, ...extra,
});
const lineaComision = (id: number, n: string, ficha: number | null) => linea(id, n, ficha, { base_comision: 1_000_000, pct_comision: 0.1 });
const lineaRecobro = (id: number, n: string, ficha: number | null) => linea(id, n, ficha, { recobro_total: 100_000, pct_recobro_aliado: 0.5 });
const usuario = (id: string, nombre: string, aliadoId: number): Fila =>
  ({ id, nombre, rol: "freelance", activo: true, tenant: "minorista", agencia_id: null, pct_comision: null, aliado_id: aliadoId, acceso_legacy_nombre: false });
const FICHAS = [3, 8, 37, 40, 41, 42, 43, 44];

/** `atribucion(n)` devuelve la ficha de la línea de RECOBRO de cada contrato: la del asesor (corregido) o la equivocada (antes). */
function tablas(atribucionRecobro: (n: string) => number | null, extra: Record<string, Fila[]> = {}): Record<string, Fila[]> {
  const comisiones: Fila[] = [];
  let id = 1000;
  for (const n of NUMEROS) {
    comisiones.push(lineaComision(id++, n, ASESOR[n].ficha), lineaRecobro(id++, n, atribucionRecobro(n)));
  }
  return {
    usuarios: FICHAS.map((f) => usuario(`u-${f}`, `Aliado ${f}`, f)),
    aliados: FICHAS.map((f) => ({ id: f, nombre: `Ficha ${f}`, nit: String(f) })),
    ventas: NUMEROS.map((n) => venta(n, ASESOR[n].ficha)),
    aliados_b2b: comisiones,
    comision_b2b_pagos: [],
    ...extra,
  };
}
const ctx = (aliadoId: number) => ({
  estado: "ok" as const, userId: `u-${aliadoId}`, email: `u${aliadoId}@t.test`, nombre: `Aliado ${aliadoId}`, rol: "freelance" as const, tenant: "minorista",
  aliadoId, accesoLegacyNombre: false, agenciaId: null, pctPerfil: null, esTitularAgencia: false,
});
const montar = (t: Record<string, Fila[]>, sesion: string) => { __setAdmin(supabaseEnMemoria(t)); __setClient(supabaseEnMemoria(t, {}, sesion)); };
const conjunto = async (t: Record<string, Fila[]>, ficha: number) => { montar(t, `u-${ficha}`); return cargarConjuntoPortal(ctx(ficha) as never); };
const nums = (c: { ventas: { numero_contrato: string; relacion: string }[] }, rel: string) => c.ventas.filter((v) => v.relacion === rel).map((v) => v.numero_contrato).sort();

test("CORREGIDO: cada asesor ve SUS contratos y, en cada uno, comisión + recobro agrupados en una sola participación del asesor correcto", async () => {
  const t = tablas((n) => ASESOR[n].ficha);
  for (const ficha of [...new Set(Object.values(ASESOR).map((a) => a.ficha))]) {
    const suyos = NUMEROS.filter((n) => ASESOR[n].ficha === ficha).sort();
    const c = await conjunto(t, ficha);
    assert.deepEqual(nums(c, "propio"), suyos, `ficha ${ficha}: contratos propios`);
    assert.deepEqual(nums(c, "participacion"), [], `ficha ${ficha}: no hay participación ajena`);
    for (const n of suyos) {
      const com = c.comisiones.get(n);
      assert.equal(com?.ids.length, 2, `${n}: dos líneas agrupadas en una sola participación`);
      assert.equal(com?.importe, COMISION + RECOBRO, `${n}: suma de comisión y recobro`);
    }
    // Y nada de contratos de otros asesores.
    assert.ok(!c.comisiones.has(NUMEROS.find((n) => ASESOR[n].ficha !== ficha) as string));
  }
});

test("ANTES de corregir: la línea de recobro de 0519 atribuida a Javier (ficha 8) le da participación a Javier; DESPUÉS, no", async () => {
  const antes = tablas((n) => (n === "MIN-00-0519" || n === "MIN-00-0462" ? 8 : ASESOR[n].ficha));
  const jAntes = await conjunto(antes, 8);
  assert.ok(nums(jAntes, "participacion").includes("MIN-00-0519"), "caso real: hoy Javier la ve por la fila 137");
  assert.ok(nums(jAntes, "participacion").includes("MIN-00-0462"), "caso real: hoy Javier ve 0462 por su línea 2 (#80); la línea 1 es de Tatiana");
  const yAntes = await conjunto(antes, 37);
  assert.equal(yAntes.comisiones.get("MIN-00-0519")?.ids.length, 1, "Yaqueline solo ve su línea de comisión: el recobro está en otra ficha");

  const despues = tablas((n) => ASESOR[n].ficha);
  const jDespues = await conjunto(despues, 8);
  assert.ok(!jDespues.ventas.some((v) => v.numero_contrato === "MIN-00-0519"), "Javier ya no ve 0519");
  assert.ok(!jDespues.ventas.some((v) => v.numero_contrato === "MIN-00-0462"), "ni 0462 (escenario posterior: #80→3 confirmada, EXCLUIDA hasta conciliar el destinatario del abono)");
  assert.ok(!jDespues.comisiones.has("MIN-00-0519"));
  assert.deepEqual(nums(jDespues, "propio"), ["MIN-00-0476", "MIN-00-0498"], "0462 no es de Javier: su línea 1 es de Tatiana");
  const yDespues = await conjunto(despues, 37);
  assert.equal(yDespues.comisiones.get("MIN-00-0519")?.ids.length, 2);
  assert.equal(yDespues.comisiones.get("MIN-00-0519")?.importe, COMISION + RECOBRO);
});

test("0498: la línea sin ficha (fila 1) no cuenta hasta que se enlaza; ya enlazada a la ficha 8 se agrupa con la 121", async () => {
  // Antes: fila 1 sin ficha → no se agrupa (el portal no empareja por nombre). Después: ficha 8.
  const base = tablas((n) => ASESOR[n].ficha);
  const sinFicha = { ...base, aliados_b2b: base.aliados_b2b.map((f) => (f.numero_contrato === "MIN-00-0498" && f.recobro_total ? { ...f, aliado_id: null } : f)) };
  assert.equal((await conjunto(sinFicha, 8)).comisiones.get("MIN-00-0498")?.ids.length, 1, "sin ficha: solo la línea con ficha");
  assert.equal((await conjunto(base, 8)).comisiones.get("MIN-00-0498")?.ids.length, 2, "con ficha: ambas líneas, un solo contrato");
});

test("SOLO las siete filas del UPDATE corregidas: 0462 y 0519 siguen divididos (#80, #135 y #137 excluidas); los otros ocho contratos quedan en una sola ficha", async () => {
  // Estado intermedio: #80 (recobro de 0462) y #137 (recobro de 0519) siguen en la ficha 8 y #135 (comisión de 0519) sigue SIN ficha; el resto, corregido.
  const base = tablas((n) => (n === "MIN-00-0462" || n === "MIN-00-0519" ? 8 : ASESOR[n].ficha));
  const t = { ...base, aliados_b2b: base.aliados_b2b.map((f) => (f.numero_contrato === "MIN-00-0519" && f.aliado_id === 37 ? { ...f, aliado_id: null } : f)) };
  // Postcheck (misma regla que el bloque C): PENDIENTE si hay filas positivas de más de una ficha o sin ficha.
  const pendientes = NUMEROS.filter((n) => {
    const pos = t.aliados_b2b.filter((f) => f.numero_contrato === n);
    return new Set(pos.map((f) => f.aliado_id)).size > 1 || pos.some((f) => f.aliado_id == null);
  }).sort();
  assert.deepEqual(pendientes, ["MIN-00-0462", "MIN-00-0519"]);
  // Portal en ese estado: Javier sigue viendo 0462 y 0519 por sus líneas 2; Tatiana solo su línea 1; Yaqueline no ve comisión (la 135 no tiene ficha).
  const jav = await conjunto(t, 8);
  assert.deepEqual(nums(jav, "participacion"), ["MIN-00-0462", "MIN-00-0519"]);
  const tat = await conjunto(t, 3);
  assert.equal(tat.comisiones.get("MIN-00-0462")?.ids.length, 1);
  const yaq = await conjunto(t, 37);
  assert.equal(yaq.comisiones.get("MIN-00-0519")?.importe ?? null, null);
  for (const n of NUMEROS.filter((x) => !pendientes.includes(x))) {
    const dueno = await conjunto(t, ASESOR[n].ficha);
    assert.equal(dueno.comisiones.get(n)?.ids.length, 2, `${n}: comisión y recobro ya en una sola ficha`);
  }
});

test("las comisiones INTERNAS (liquidación del asesor) no se mezclan con la participación B2B del portal", async () => {
  const interna = [{ id: 1, numero_contrato: "MIN-00-0519", asesor: "Yaqueline", mes_liquidacion: "2026-10", com_b2b_pagada: 777_000, estado: "pendiente" }];
  const t = tablas((n) => ASESOR[n].ficha, { liquidacion_comisiones: interna, rentabilidad: [{ numero_contrato: "MIN-00-0519", com_asesor: 888_000 }] });
  const c = await conjunto(t, 37);
  assert.equal(c.comisiones.get("MIN-00-0519")?.importe, COMISION + RECOBRO, "el importe B2B no suma lo interno ni lo de rentabilidad");
});

test("los diez contratos: cada uno aparece exactamente una vez entre todos los aliados y nadie ve contratos ajenos", async () => {
  const t = tablas((n) => ASESOR[n].ficha);
  const vistos: string[] = [];
  for (const ficha of FICHAS) {
    const c = await conjunto(t, ficha);
    vistos.push(...c.ventas.map((v) => v.numero_contrato));
    for (const v of c.ventas) assert.equal(ASESOR[v.numero_contrato].ficha, ficha, `${v.numero_contrato} no es de la ficha ${ficha}`);
  }
  assert.deepEqual([...vistos].sort(), [...NUMEROS].sort());
});

test("corregir la ficha de una línea NO cambia importes, abonos ni propietario de la venta (los diez contratos, con abonos)", async () => {
  const pagos = [{ id: 1, aliado_b2b_id: 1019, valor: 39_000, fecha: "2026-10-05" }, { id: 2, aliado_b2b_id: 1005, valor: 10_000, fecha: "2026-10-06" }];
  const antes = tablas((n) => (n === "MIN-00-0519" || n === "MIN-00-0422" ? 8 : ASESOR[n].ficha), { comision_b2b_pagos: pagos });
  const foto = JSON.stringify({ v: antes.ventas, p: antes.comision_b2b_pagos });
  const importes = (t: Record<string, Fila[]>) => t.aliados_b2b.map((f) => `${f.id}:${f.base_comision}:${f.pct_comision}:${f.recobro_total}:${f.pct_recobro_aliado}:${f.aplica_retencion}:${f.estado}`);
  // La corrección del plan: solo aliado_id / aliado de las líneas mal atribuidas.
  const despues: Record<string, Fila[]> = {
    ...antes,
    aliados_b2b: antes.aliados_b2b.map((f) => (f.aliado_id !== ASESOR[f.numero_contrato as string].ficha ? { ...f, aliado_id: ASESOR[f.numero_contrato as string].ficha, aliado: `Ficha ${ASESOR[f.numero_contrato as string].ficha}` } : f)),
  };
  assert.notDeepEqual(antes.aliados_b2b.map((f) => f.aliado_id), despues.aliados_b2b.map((f) => f.aliado_id), "la corrección sí movió fichas");
  assert.deepEqual(importes(despues), importes(antes), "ningún importe ni retención cambia");
  assert.equal(JSON.stringify({ v: despues.ventas, p: despues.comision_b2b_pagos }), foto, "ventas (propietario) y abonos idénticos");
  // Las dos líneas con abono siguen colgando de la MISMA fila (id) aunque cambie su ficha: el historial no se re-asigna.
  assert.deepEqual(despues.comision_b2b_pagos.map((p) => p.aliado_b2b_id), [1019, 1005]);
  const y = await conjunto(despues, 37);
  assert.equal(y.comisiones.get("MIN-00-0519")?.importe, COMISION + RECOBRO - 39_000, "el abono de la línea sigue descontándose de su saldo");
});
