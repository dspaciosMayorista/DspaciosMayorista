import { test, describe, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";

// #125 — Server Action `guardarReglasPromocion` con el modo «seguir la base ganadora» y «un niño gratis por habitación» (cliente simulado, solicitudes contadas).
type Est = { rpc: [string, Record<string, unknown>][]; from: string[]; revalida: string[]; regen: number; resp: unknown; fila: unknown; vigs: unknown[]; insertados: unknown[] };
const est: Est = { rpc: [], from: [], revalida: [], regen: 0, resp: null, fila: null, vigs: [], insertados: [] };
(globalThis as unknown as { __g125: Est }).__g125 = est;
type ResolveHook = (s: string, c: { parentURL?: string }, n: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
registerHooks({
  resolve(s, c, n) {
    if (s === "server-only") return { url: datos("export {}"), shortCircuit: true };
    if (s === "next/cache") return { url: datos("export function revalidatePath(p){globalThis.__g125.revalida.push(p)} export function revalidateTag(){}"), shortCircuit: true };
    if (s.endsWith("paquetes/actions") && /producto\/hoteles\/actions\.ts$/.test(c.parentURL ?? "")) {
      return { url: datos("export async function regenerarTarifariosDeHotel(){ globalThis.__g125.regen++ }"), shortCircuit: true };
    }
    return n(s, c);
  },
});
function consulta(tabla: string) {
  est.from.push(tabla);
  let insert = false;
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, in: () => b, order: () => b,
    maybeSingle: () => Promise.resolve({ data: est.fila, error: null }),
    insert: (d: unknown) => { insert = true; est.insertados.push(d); return b; },
    then(res: (v: unknown) => unknown) {
      return Promise.resolve({ data: tabla === "hotel_temporadas" && !insert ? est.vigs : null, error: null }).then(res);
    },
  };
  return b;
}
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({
  rpc: async (fn: string, args: Record<string, unknown>) => { est.rpc.push([fn, args]); return est.resp ?? { data: { base: null, reglas: 1 }, error: null }; },
  from: (t: string) => consulta(t),
}) } });
const hot = await import("../app/(dashboard)/dashboard/producto/hoteles/actions.ts");
beforeEach(() => { est.rpc.length = 0; est.from.length = 0; est.revalida.length = 0; est.regen = 0; est.resp = null; est.fila = null; est.vigs = []; est.insertados.length = 0; });

const SIN = { activo: false, edadMin: null, edadMax: null };
const seguir = { hotelId: 9, promocionId: 10, baseId: null, reglas: [{ grupo_id: null, valor: 10, dias: null }], previas: { base: null, reglas: [], sigueBase: false, ninoGratis: SIN }, sigueBase: true, ninoGratis: SIN };
const vinculada = { hotelId: 9, promocionId: 10, baseId: 1, reglas: [{ grupo_id: "g", valor: 10, dias: [1, 2, 3] }], previas: { base: null, reglas: [] } };

describe("compatibilidad: sin los campos nuevos la llamada es la de siempre", () => {
  test("RPC con exactamente 4 parámetros, foto con base y reglas, 0 lecturas extra", async () => {
    assert.equal((await hot.guardarReglasPromocion(vinculada)).ok, true);
    assert.deepEqual(est.rpc, [["promocion_guardar_reglas", { p_promocion_id: 10, p_base_id: 1, p_reglas: vinculada.reglas, p_previas: { base: null, reglas: [] } }]]);
    assert.deepEqual(est.from, []);
  });
});

describe("seguir la base ganadora", () => {
  test("sin base y UNA regla con grupo nulo: la RPC recibe el modo, la foto con las claves nuevas y la edad vacía", async () => {
    assert.equal((await hot.guardarReglasPromocion(seguir)).ok, true);
    const [fn, a] = est.rpc[0];
    assert.equal(fn, "promocion_guardar_reglas");
    assert.equal(a.p_base_id, null);
    assert.deepEqual(a.p_reglas, [{ grupo_id: null, valor: 10, dias: null }]);
    assert.equal(a.p_sigue_base, true); assert.equal(a.p_nino_gratis, false);
    assert.equal(a.p_nino_edad_min, null); assert.equal(a.p_nino_edad_max, null);
    assert.deepEqual(a.p_previas, { base: null, reglas: [], sigue_base: false, nino_gratis: false, nino_edad_min: null, nino_edad_max: null });
    assert.equal(est.regen, 1);
    assert.deepEqual(est.revalida, ["/dashboard/producto/hoteles/9"]);
  });
  test("con base vinculada, con dos reglas o con una regla de grupo ⇒ rechazo y 0 RPC", async () => {
    for (const mala of [
      { ...seguir, baseId: 1 },
      { ...seguir, reglas: [...seguir.reglas, { grupo_id: null, valor: 5, dias: null }] },
      { ...seguir, reglas: [{ grupo_id: "g", valor: 10, dias: null }] },
      { ...seguir, reglas: [] },
    ]) {
      const r = await hot.guardarReglasPromocion(mala);
      assert.equal(r.ok, false);
      assert.match((r as { error: string }).error, /UNA sola regla/);
    }
    assert.equal(est.rpc.length, 0);
  });
  test("dejar el modo: desvincular manda sigueBase=false y la foto previa en modo seguir", async () => {
    await hot.guardarReglasPromocion({ hotelId: 9, promocionId: 10, baseId: null, reglas: [], sigueBase: false, ninoGratis: SIN,
      previas: { base: null, reglas: [{ grupo_id: null, valor: 10, dias: null }], sigueBase: true, ninoGratis: SIN } });
    const a = est.rpc[0][1];
    assert.equal(a.p_sigue_base, false);
    assert.equal((a.p_previas as Record<string, unknown>).sigue_base, true);
  });
  test("el rechazo de la base por la restricción de la 310 sale en español claro", async () => {
    est.resp = { data: null, error: { code: "23514", message: 'new row violates check constraint "hotel_temporadas_promo_125"' } };
    const r = await hot.guardarReglasPromocion(seguir);
    assert.match((r as { error: string }).error, /solo valen en una promoción de porcentaje con reglas/);
    assert.equal(est.regen, 0);
  });
});

describe("un niño gratis por habitación", () => {
  const con = (n: unknown, base = seguir) => ({ ...base, ninoGratis: n as typeof SIN });
  test("promoción de porcentaje, sin edad propia: viaja p_nino_gratis=true con edades nulas; el tipo se lee de la base (1 consulta)", async () => {
    est.fila = { tipo: "descuento_pct" };
    assert.equal((await hot.guardarReglasPromocion(con({ activo: true, edadMin: null, edadMax: null }))).ok, true);
    assert.deepEqual(est.from, ["hotel_temporadas"]);
    const a = est.rpc[0][1];
    assert.equal(a.p_nino_gratis, true); assert.equal(a.p_nino_edad_min, null); assert.equal(a.p_nino_edad_max, null);
  });
  test("con edad propia 3–12: viaja tal cual; también con una base vinculada", async () => {
    est.fila = { tipo: "descuento_pct" };
    await hot.guardarReglasPromocion(con({ activo: true, edadMin: 3, edadMax: 12 }));
    assert.equal(est.rpc[0][1].p_nino_edad_min, 3); assert.equal(est.rpc[0][1].p_nino_edad_max, 12);
    est.rpc.length = 0;
    assert.equal((await hot.guardarReglasPromocion({ ...vinculada, sigueBase: false, ninoGratis: { activo: true, edadMin: 2, edadMax: 11 }, previas: { base: null, reglas: [], sigueBase: false, ninoGratis: SIN } })).ok, true);
    assert.equal(est.rpc[0][1].p_sigue_base, false); assert.equal(est.rpc[0][1].p_nino_gratis, true);
  });
  test("promoción de monto ⇒ rechazo, 0 RPC (el tipo sale de la base, no del navegador)", async () => {
    est.fila = { tipo: "descuento_monto" };
    const r = await hot.guardarReglasPromocion(con({ activo: true, edadMin: null, edadMax: null }));
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /solo se combina con una promoción de porcentaje/);
    assert.equal(est.rpc.length, 0);
  });
  test("edades inválidas ⇒ rechazo, 0 RPC: solo una, mínimo > máximo, fuera de 0–17, no entera", async () => {
    est.fila = { tipo: "descuento_pct" };
    for (const e of [{ edadMin: 3, edadMax: null }, { edadMin: null, edadMax: 12 }, { edadMin: 12, edadMax: 3 }, { edadMin: 0, edadMax: 18 }, { edadMin: -1, edadMax: 5 }, { edadMin: 2.5, edadMax: 8 }]) {
      assert.equal((await hot.guardarReglasPromocion(con({ activo: true, ...e }))).ok, false, JSON.stringify(e));
    }
    assert.equal(est.rpc.length, 0);
  });
  test("límites inclusivos 0 y 17 se aceptan; edad con el niño gratis apagado ⇒ rechazo", async () => {
    est.fila = { tipo: "descuento_pct" };
    assert.equal((await hot.guardarReglasPromocion(con({ activo: true, edadMin: 0, edadMax: 17 }))).ok, true);
    assert.equal((await hot.guardarReglasPromocion(con({ activo: false, edadMin: 3, edadMax: 12 }))).ok, false);
  });
  test("sin reglas (desvincular) no se puede dejar el niño gratis activo", async () => {
    est.fila = { tipo: "descuento_pct" };
    const r = await hot.guardarReglasPromocion({ hotelId: 9, promocionId: 10, baseId: null, reglas: [], sigueBase: false,
      ninoGratis: { activo: true, edadMin: null, edadMax: null }, previas: { base: 1, reglas: [] } });
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /exige que la promoción tenga reglas/);
  });
});

describe("copiar vigencias a otro hotel", () => {
  test("el modo seguir-base y el niño gratis no viajan (viven en reglas de ESE hotel) y se avisa", async () => {
    est.vigs = [{ nombre: "P", fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", rangos: [], blackouts: [], compra_inicio: null, compra_fin: null,
      tipo: "descuento_pct", promo_base_id: null, promo_sigue_base: true, nino_gratis: true, noche_gratis_regla: null, descuento_unidad: null, dias_promo: null }];
    const r = await hot.copiarTemporadasDesdeHotel(9, 8);
    assert.equal(r.ok, true);
    assert.match(((r as { avisos?: string[] }).avisos ?? []).join(), /sin seguir la base ganadora ni niño gratis/);
    const ins = (est.insertados[0] as Record<string, unknown>[])[0];
    assert.equal("promo_sigue_base" in ins, false);
    assert.equal("nino_gratis" in ins, false);
  });
});
