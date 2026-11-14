import { test, describe, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";
import { readFileSync } from "node:fs";

// #43/#60 entrega 4 — acciones del servidor con cliente simulado (solicitudes contadas) y cableado de los cargadores.
type Est = { rpc: [string, Record<string, unknown>][]; from: string[]; revalida: string[]; regen: number; resp: unknown; insertados: unknown[]; vigs: unknown[]; acoms: unknown[] };
const est: Est = { rpc: [], from: [], revalida: [], regen: 0, resp: null, insertados: [], vigs: [], acoms: [] };
(globalThis as unknown as { __g300: Est }).__g300 = est;
type ResolveHook = (s: string, c: { parentURL?: string }, n: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
registerHooks({
  resolve(s, c, n) {
    if (s === "server-only") return { url: datos("export {}"), shortCircuit: true };
    if (s === "next/cache") return { url: datos("export function revalidatePath(p){globalThis.__g300.revalida.push(p)} export function revalidateTag(){}"), shortCircuit: true };
    if (s.endsWith("paquetes/actions") && /producto\/hoteles\/actions\.ts$/.test(c.parentURL ?? "")) {
      return { url: datos("export async function regenerarTarifariosDeHotel(){ globalThis.__g300.regen++ }"), shortCircuit: true };
    }
    return n(s, c);
  },
});
function consulta(tabla: string) {
  est.from.push(tabla);
  let insert: unknown = null;
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, in: () => b, order: () => b, maybeSingle: () => b,
    insert: (d: unknown) => { insert = d; est.insertados.push(d); return b; },
    then(res: (v: unknown) => unknown) {
      if (tabla === "hotel_acomodaciones") return Promise.resolve({ data: est.acoms, error: null }).then(res);
      if (tabla === "hotel_temporadas" && !insert) return Promise.resolve({ data: est.vigs, error: null }).then(res);
      return Promise.resolve({ data: null, error: null }).then(res);
    },
  };
  return b;
}
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({
  rpc: async (fn: string, args: Record<string, unknown>) => { est.rpc.push([fn, args]); return est.resp ?? { data: { base: 1, reglas: 1 }, error: null }; },
  from: (t: string) => consulta(t),
}) } });
const hot = await import("../app/(dashboard)/dashboard/producto/hoteles/actions.ts");
beforeEach(() => { est.rpc.length = 0; est.from.length = 0; est.revalida.length = 0; est.regen = 0; est.resp = null; est.insertados.length = 0; est.vigs = []; est.acoms = []; });

const vigencia = { hotelId: 9, nombre: "PROMO", inicio: "2027-01-01", fin: "2027-01-31", prioridad: 2, compraInicio: "", compraFin: "", minNoches: 3 };

describe("crear una promoción NUEVA: elegir es obligatorio también en el servidor", () => {
  test("noche gratis sin regla ⇒ rechazo, 0 solicitudes", async () => {
    const r = await hot.crearTemporada({ ...vigencia, tipo: "promo_noche_gratis" });
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /Elige qué noche se bonifica/);
    assert.equal(est.from.length + est.rpc.length, 0);
  });
  test("noche gratis con regla y días ⇒ 1 insert con las columnas nuevas, 1 revalidación, 1 regeneración", async () => {
    const r = await hot.crearTemporada({ ...vigencia, tipo: "promo_noche_gratis", nocheGratisRegla: "mas_barata", diasPromo: [4, 1] });
    assert.equal(r.ok, true);
    const ins = est.insertados[0] as Record<string, unknown>;
    assert.equal(ins.noche_gratis_regla, "mas_barata");
    assert.deepEqual(ins.dias_promo, [1, 4]);
    assert.equal(ins.descuento_unidad, null);
    assert.deepEqual(est.from, ["hotel_temporadas"]);
    assert.equal(est.regen, 1);
  });
  test("monto sin unidad ⇒ rechazo; persona/estadía «todos» ⇒ días null", async () => {
    assert.equal((await hot.crearTemporada({ ...vigencia, tipo: "descuento_monto", descuentoValor: 20000 })).ok, false);
    const r = await hot.crearTemporada({ ...vigencia, tipo: "descuento_monto", descuentoValor: 20000, descuentoUnidad: "persona_estadia", diasPromo: "todos" });
    assert.equal(r.ok, true);
    const ins = est.insertados[0] as Record<string, unknown>;
    assert.equal(ins.descuento_unidad, "persona_estadia");
    assert.equal(ins.dias_promo, null);
  });
  test("por habitación: se guarda aunque el hotel tarife habitaciones con otra ocupación (el motor usa la del hotel); 0 lecturas extra", async () => {
    est.acoms = [{ acomodacion: "doble", pax_tarifa: 3 }];
    assert.equal((await hot.crearTemporada({ ...vigencia, tipo: "descuento_monto", descuentoValor: 20000, descuentoUnidad: "habitacion_noche" })).ok, true);
    assert.deepEqual(est.from, ["hotel_temporadas"]);
  });
});

describe("guardar reglas por grupo: 1 RPC transaccional", () => {
  const entrada = { hotelId: 9, promocionId: 10, baseId: 1, reglas: [{ grupo_id: "g", valor: 10, dias: [1, 2, 3] }], previas: { base: null, reglas: [] } };
  test("1 RPC con la foto; revalida la ficha y regenera una vez", async () => {
    const r = await hot.guardarReglasPromocion(entrada);
    assert.equal(r.ok, true);
    assert.deepEqual(est.rpc, [["promocion_guardar_reglas", { p_promocion_id: 10, p_base_id: 1, p_reglas: entrada.reglas, p_previas: entrada.previas }]]);
    assert.deepEqual(est.revalida, ["/dashboard/producto/hoteles/9"]);
    assert.equal(est.regen, 1);
  });
  test("foto desactualizada (PT409) ⇒ pide recargar, sin reintento ni regeneración", async () => {
    est.resp = { data: null, error: { code: "PT409", message: "La promoción cambió…" } };
    const r = await hot.guardarReglasPromocion(entrada);
    assert.match((r as { error: string }).error, /recarga la página/);
    assert.equal(est.rpc.length, 1);
    assert.equal(est.regen + est.revalida.length, 0);
  });
  test("valor no positivo o «elegir días» vacío ⇒ 0 RPC", async () => {
    assert.equal((await hot.guardarReglasPromocion({ ...entrada, reglas: [{ grupo_id: "g", valor: 0, dias: null }] })).ok, false);
    assert.equal((await hot.guardarReglasPromocion({ ...entrada, reglas: [{ grupo_id: "g", valor: 5, dias: [] }] })).ok, false);
    assert.equal(est.rpc.length, 0);
  });
});

describe("copiar vigencias de otro hotel", () => {
  test("la elección viaja; el vínculo y las reglas (ids de ese hotel) no, y se avisa", async () => {
    est.vigs = [{ nombre: "P", fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", rangos: [], blackouts: [], compra_inicio: null, compra_fin: null,
      tipo: "descuento_pct", promo_base_id: 5, noche_gratis_regla: null, descuento_unidad: null, dias_promo: null }];
    const r = await hot.copiarTemporadasDesdeHotel(9, 8);
    assert.equal(r.ok, true);
    assert.match(((r as { avisos?: string[] }).avisos ?? []).join(), /sin sus reglas por grupo/);
    const ins = (est.insertados[0] as Record<string, unknown>[])[0];
    assert.equal("promo_base_id" in ins, false);
    assert.equal(ins.hotel_id, 9);
  });
});

describe("cableado: los cargadores pasan el vínculo de promociones y la acomodación al motor", () => {
  const leer = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  test("cada llamada a un liquidador en los cargadores lleva basePromoPorClave y acomodacion", () => {
    for (const f of ["lib/reservar/liquidacionHotel.ts", "lib/reservar/computo.ts", "lib/tarifario/vigencia.ts", "app/(dashboard)/dashboard/paquetes/actions.ts"]) {
      // Entrega 5: la cotización y el costo de la reserva liquidan con la precedencia (liquidarConPrecedencia / costoConPrecedencia).
      const llamadas = [...leer(f).matchAll(/(?:liquidarHotel(?:Noches|NochesConTemporadas|MasBarato|MasBaratoConTemporada)|liquidarConPrecedencia|costoConPrecedencia)\(\{([^}]*)\}/g)];
      assert.ok(llamadas.length > 0, f);
      for (const m of llamadas) assert.match(m[1], /basePromoPorClave[^,]*, acomodacion: /, `${f}: ${m[0].slice(0, 80)}`);
    }
  });
  test("las tarifas que leen los cargadores traen temporada_base (con «*» o explícito)", () => {
    assert.match(leer("lib/reservar/computo.ts"), /notas, precio_final_autoritativo, grupo_id, temporada_base"\)/);
    assert.match(leer("lib/tarifario/vigencia.ts"), /neto_multiple, grupo_id, temporada_base"\)/);
    assert.match(leer("lib/reservar/cotizar.ts"), /from\("tarifa_hotel"\)\.select\("\*"\)/);
    assert.match(leer("app/(dashboard)/dashboard/paquetes/actions.ts"), /sb\.from\("tarifa_hotel"\)\.select\("\*"\)/);
  });
  test("la calculadora Mixta no deriva filas de una promoción con reglas (no tiene filas propias)", () => {
    assert.match(leer("lib/calc/calculadoras.ts"), /=== "descuento_pct" && v\.promo_base_id == null\)/);
    assert.match(leer("lib/hoteles/contextoGeneracionTarifas.ts"), /hotel_temporada_grupos\(id, dias, activo\), promo_base_id"\)/);
  });
});
