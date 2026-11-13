// #43/#60 entrega 3c (migración 299): revisión de «Aplicar a la venta» y «Volver a todos los días» (puras), acciones
// (una RPC cada una; revalidan y regeneran SOLO cuando cambia lo que se vende) y carga CSV con grupo (al borrador).
import { test, describe, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";
import {
  planActivacion, puedeAplicar, payloadHabilitaciones, planVolver, payloadVolver, claveComboVolver, textoEmpate, type AlcanceGrupos,
} from "../lib/hoteles/activacionGrupos.ts";
import { textoBorrado, NETOS_VACIOS, EXTRAS_VACIOS, type ConfigGrupos } from "../lib/hoteles/alcanceGrupos.ts";
import { separarFilasConGrupos, vigenciasConGrupos } from "../lib/calc/promoCalculadora.ts";
import { toTemporadaRango } from "../lib/calc/paquetes.ts";

const S = "00000000-0000-4000-8000-0000000c0001", F = "00000000-0000-4000-8000-0000000c0002";
const fila = (netos: Partial<typeof NETOS_VACIOS>, extra: Record<string, unknown> = {}) => ({ ...NETOS_VACIOS, ...EXTRAS_VACIOS, ...netos, ...extra });
function base(): AlcanceGrupos {
  return {
    vigencia: { id: 1, nombre: "ALTA", hotel_id: 9, tipo: "tarifa", nombre_repetido: false },
    hotel: { id: 9, modelo_tarifario: "persona" },
    categorias: ["Estándar"], regimenes: ["PAM"],
    grupos: [{ id: S, nombre: "Semana", dias: [1, 2, 3, 4], activo: false }, { id: F, nombre: "Finde", dias: [5, 6, 7], activo: false }],
    propuestas: [
      { ...fila({ neto_sencilla: 150000, neto_doble: 95000, neto_triple: 80000 }), id: 1, grupo_id: S, tipo_habitacion: "Estándar", alimentacion: "PAM", origen_tarifa_id: null },
      { ...fila({ neto_doble: 130000 }), id: 2, grupo_id: F, tipo_habitacion: "Estándar", alimentacion: "PAM", origen_tarifa_id: null },
    ],
    origen: [{ ...fila({ neto_sencilla: 150000, neto_doble: 100000 }), id: 11, tipo_habitacion: "Estándar", alimentacion: "PAM", huella: "h" }],
    vigentes: [], promociones: [{ temporada: "PROMO-ALTA", filas: 1 }], huella: "H1",
    estado: "preparado", compra_cerrada: false,
    habilitaciones: [{ grupo_id: S, grupo: "Semana", tipo_habitacion: "Estándar", alimentacion: "PAM", acomodacion: "triple", nuevo: 80000, hoy: null }],
    empates: [], edades_conflicto: [], obsoletas: [], dias_sin_grupo: [], pendientes: 3, otras_con_grupos: 0,
  };
}

describe("entrega 4 (300): la revisión nombra las promociones por grupo vinculadas, sus reglas y sus conflictos", () => {
  const promo = { id: 10, nombre: "PROMO SEMANA", tipo: "descuento_pct", unidad: null, prioridad: 2,
    reglas: [{ grupo_id: S, grupo: "Semana", valor: 10, dias: [1, 2, 3] }] };
  test("primera aplicación: EMPIEZAN a aplicarse, con grupo, días y valor; el grupo sin regla conserva la base", () => {
    const p = planActivacion({ ...base(), promociones_reglas: [promo] });
    const t = p.avisos.find((x) => /promociones por grupo/.test(x)) ?? "";
    assert.match(t, /Al confirmar EMPIEZAN a aplicarse/);
    assert.match(t, /«PROMO SEMANA» \(prioridad 2\): Semana −10 % \(solo L M X\); Finde sin regla: conserva la base\./);
  });
  test("actualización de una vigencia que ya se vende: «siguen aplicándose»", () => {
    const p = planActivacion({ ...base(), estado: "activo", grupos: base().grupos.map((g) => ({ ...g, activo: true })), promociones_reglas: [promo] });
    assert.ok(p.avisos.some((x) => /Siguen aplicándose las promociones por grupo/.test(x)));
  });
  test("un conflicto de prioridad entre promociones vinculadas BLOQUEA la aplicación, sin elegir ninguna", () => {
    const p = planActivacion({ ...base(), promociones_reglas: [promo],
      promociones_conflictos: [{ tipo: "conflicto", a: "PROMO SEMANA", b: "PROMO MONTO", prioridad: 3, base: "ALTA", noche: "2027-01-06", grupo: "Semana" }] });
    assert.ok(p.bloqueos.some((x) => /«PROMO SEMANA» y «PROMO MONTO» tienen la misma prioridad \(3\).*06\/01\/2027, Semana/.test(x)));
    assert.equal(puedeAplicar(p, new Set(p.habilitaciones.map((h) => h.clave))), false);
  });
  test("sin promociones vinculadas no aparece el aviso", () => {
    assert.equal(planActivacion(base()).avisos.some((x) => /promociones por grupo de/.test(x)), false);
  });
  test("volver a todos los días: avisa que las promociones por grupo DEJAN DE APLICAR (quedan guardadas)", () => {
    const pv = planVolver({ ...base(), estado: "activo", grupos: base().grupos.map((g) => ({ ...g, activo: true })), vigentes: [],
      promociones_reglas: [promo] } as never);
    assert.ok(pv.avisos.some((x) => /DEJAN DE APLICAR.*«PROMO SEMANA».*Quedan guardadas/.test(x)));
  });
});

describe("planActivacion: lo que se verá antes de aplicar a la venta", () => {
  test("primera aplicación: compara cada grupo con la tarifa «todos los días» y dice que esta deja de venderse", () => {
    const p = planActivacion(base());
    assert.equal(p.primera, true);
    const t = p.lineas.map((l) => l.texto);
    assert.ok(t.some((x) => /tarifa\(s\) «todos los días» de ALTA dejan de venderse/.test(x)));
    assert.ok(t.some((x) => /Pasan a venderse los grupos: Semana \(L M X J\), Finde \(V S D\)/.test(x)));
    assert.ok(t.includes("Semana (L M X J) · Estándar / PAM · Doble: 100.000 → 95.000"));
    assert.ok(t.includes("Semana (L M X J) · Estándar / PAM · Triple: vacío → 80.000"));
    // El Finde no trae sencilla: se dice que esa habitación no se venderá esos días.
    assert.ok(t.some((x) => /^Finde \(V S D\) · Estándar \/ PAM · Sencilla: 150\.000 → vacío — Sin precio/.test(x)));
    assert.equal(t.filter((x) => /Sencilla/.test(x) && /Semana/.test(x)).length, 0, "sin cambio, sin línea");
  });
  test("avisos: promociones conservan sus precios, «Desde» deja de mostrarse (primer hotel con grupos), regeneración", () => {
    const p = planActivacion(base());
    assert.ok(p.avisos.some((a) => /PROMO-ALTA.*conservan sus precios actuales/.test(a)));
    assert.ok(p.avisos.some((a) => /«Desde» publicado de la porción terrestre.*deja de mostrarse/.test(a)));
    assert.ok(p.avisos.some((a) => /se regeneran los tarifarios/.test(a)));
    assert.equal(planActivacion({ ...base(), otras_con_grupos: 1 }).avisos.some((a) => /«Desde»/.test(a)), false, "si el hotel ya vendía por grupos, ya no tenía «Desde»");
    assert.ok(planActivacion({ ...base(), dias_sin_grupo: [6, 7] }).avisos.some((a) => /Los sábado, domingo no los cubre ningún grupo/.test(a)));
    // Medido (medir_299_recorrido.sh): con grupos activos los paquetes de porción no se regeneran y conservan lo publicado antes.
    assert.ok(planActivacion({ ...base(), paquetes_porcion: 3 }).avisos.some((a) => /3 paquete\(s\) de porción terrestre.*NO se podrán regenerar.*DEJARÁN DE MOSTRARSE.*no se venden precios viejos/.test(a)));
    assert.equal(planActivacion({ ...base(), paquetes_porcion: 0 }).avisos.some((a) => /porción terrestre activo/.test(a)), false);
  });
  test("habilitaciones: nada confirmado ⇒ no se puede aplicar; confirmadas TODAS ⇒ payload exacto", () => {
    const p = planActivacion(base());
    assert.equal(p.habilitaciones.length, 1);
    assert.match(p.habilitaciones[0].texto, /Semana · Estándar \/ PAM · Triple: hoy no se vende \(sin tarifa\) → se venderá a 80\.000/);
    assert.equal(puedeAplicar(p, new Set()), false);
    const todas = new Set(p.habilitaciones.map((h) => h.clave));
    assert.equal(puedeAplicar(p, todas), true);
    assert.deepEqual(payloadHabilitaciones(p, todas), [{ grupo_id: S, tipo_habitacion: "Estándar", alimentacion: "PAM", acomodacion: "triple" }]);
  });
  test("bloqueos de la base (empate, edades, sugerencia obsoleta, compra cerrada, sin propuesta, sin cambios) impiden aplicar", () => {
    const e = { a: { id: 1, nombre: "ALTA", con_grupos: true }, b: { id: 2, nombre: "PUENTE", con_grupos: false }, prioridad: 1,
      tipo_habitacion: "Estándar", alimentacion: "PAM", acomodacion: "doble", desde: "2027-01-10", hasta: "2027-01-12", noches: 3 };
    assert.equal(textoEmpate(e), "Empate de prioridad entre ALTA y PUENTE (las dos con prioridad 1): Estándar / PAM · Doble, del 10/01/2027 al 12/01/2027. Cambia la prioridad, las fechas, los días o el régimen de una de las dos.");
    // Horizonte: un cruce no verificado se dice como tal (nunca «sin conflictos») y bloquea; la lista recortada se avisa.
    const nv = { ...e, tipo: "no_verificable" as const, tipo_habitacion: null, alimentacion: null, acomodacion: null, desde: "2027-01-01", hasta: "2030-12-31", noches: 1461 };
    assert.match(textoEmpate(nv), /No se pueden verificar empates entre ALTA y PUENTE .*comparten 1\.461 noches del 01\/01\/2027 al 31\/12\/2030, más de las 1\.096/);
    assert.match(textoEmpate({ tipo: "truncado", total: 230, mostrados: 200 }), /30 conflicto\(s\) más que no se listan/);
    for (const x of [nv, { tipo: "truncado" as const, total: 230, mostrados: 200 }]) {
      const p = planActivacion({ ...base(), empates: [x] });
      assert.equal(p.bloqueos.length, 1); assert.equal(puedeAplicar(p, new Set(p.habilitaciones.map((h) => h.clave))), false);
    }
    const casos: Partial<AlcanceGrupos>[] = [
      { empates: [e] },
      { edades_conflicto: [{ tipo_habitacion: "Estándar", alimentacion: "PAM", reglas: [{ grupo: "Finde", regla: "0-1 / 2-11" }, { grupo: "Semana", regla: "0-2 / 3-10" }] }] },
      { obsoletas: [{ grupo: "Semana", tipo_habitacion: "Estándar", alimentacion: "PAM" }] },
      { compra_cerrada: true }, { propuestas: [] }, { estado: "activo", pendientes: 0 },
    ];
    for (const c of casos) {
      const p = planActivacion({ ...base(), ...c });
      assert.ok(p.bloqueos.length >= 1, JSON.stringify(c).slice(0, 60));
      assert.equal(puedeAplicar(p, new Set(p.habilitaciones.map((h) => h.clave))), false);
    }
  });
  test("re-aplicación: compara con lo que el grupo vende hoy (no con «todos los días»)", () => {
    const a: AlcanceGrupos = {
      ...base(), estado: "activo", origen: [], habilitaciones: [],
      grupos: base().grupos.map((g) => ({ ...g, activo: true })),
      vigentes: [
        { ...fila({ neto_sencilla: 150000, neto_doble: 95000, neto_triple: 80000 }), id: 21, grupo_id: S, tipo_habitacion: "Estándar", alimentacion: "PAM" },
        { ...fila({ neto_doble: 125000 }), id: 22, grupo_id: F, tipo_habitacion: "Estándar", alimentacion: "PAM" },
      ],
    };
    const p = planActivacion(a);
    assert.equal(p.primera, false);
    assert.deepEqual(p.lineas.map((l) => l.texto), ["Finde (V S D) · Estándar / PAM · Doble: 125.000 → 130.000"]);
    assert.match(p.confirmacion, /Se aplicarán a la venta 1 cambio\(s\) de ALTA/);
  });
});

describe("volver a «todos los días» y borrar un grupo que se vende", () => {
  const activo = (): ConfigGrupos => ({
    ...base(), estado: "activo", grupos: base().grupos.map((g) => ({ ...g, activo: true })),
    vigentes: [
      { ...fila({ neto_doble: 95000 }), id: 21, grupo_id: S, tipo_habitacion: "Estándar", alimentacion: "PAM" },
      { ...fila({ neto_doble: 130000 }), id: 22, grupo_id: F, tipo_habitacion: "Estándar", alimentacion: "PAM" },
    ],
  });
  test("una elección por combinación, nada preelegido; «No conservar» es una elección válida", () => {
    const p = planVolver(activo());
    assert.equal(p.combos.length, 1);
    assert.deepEqual(p.combos[0].opciones.map((o) => o.texto), ["La de Semana (L M X J): Doble 95.000", "La de Finde (V S D): Doble 130.000"]);
    assert.equal(payloadVolver(p, {}), null);
    const k = claveComboVolver(p.combos[0]);
    assert.deepEqual(payloadVolver(p, { [k]: S }), [{ tipo_habitacion: "Estándar", alimentacion: "PAM", grupo_id: S }]);
    assert.deepEqual(payloadVolver(p, { [k]: null }), [{ tipo_habitacion: "Estándar", alimentacion: "PAM", grupo_id: null }]);
  });
  test("borrar un grupo que se vende: lista sus tarifas y que sus días salen de la cobertura; el último no se borra", () => {
    const t = textoBorrado(activo(), F).join(" ");
    assert.match(t, /HOY SE VENDE en ALTA.*dejan de venderse sus 1 tarifa/);
    assert.match(t, /viernes, sábado, domingo salen de la cobertura/);
    assert.match(t, /No se afirma que se cierren las ventas/);
    const solo = { ...activo(), grupos: [{ ...activo().grupos[0] }, { ...activo().grupos[1], activo: false }] };
    assert.match(textoBorrado(solo, S)[0], /único grupo que se vende.*Volver a todos los días/);
  });
});

describe("calculadora general: las vigencias que se venden por grupos se conservan", () => {
  test("filas de la vigencia y de promociones calculadas desde ella quedan fuera; las demás se generan", () => {
    const vigs = [
      toTemporadaRango({ nombre: "ALTA", fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", hotel_temporada_grupos: [{ id: S, dias: [1, 2, 3, 4], activo: true }] }),
      toTemporadaRango({ nombre: "BAJA", fecha_inicio: "2027-02-01", fecha_fin: "2027-02-28", hotel_temporada_grupos: [{ id: F, dias: [1], activo: false }] }),
    ];
    assert.deepEqual([...vigenciasConGrupos(vigs)], ["ALTA"], "solo cuentan los grupos ACTIVOS");
    const r = separarFilasConGrupos([
      { temporada: "ALTA" }, { temporada: "BAJA" }, { temporada: "PROMO", temporada_base: "ALTA" }, { temporada: "OTRA", temporada_base: "BAJA" },
    ], vigs);
    assert.deepEqual(r.generables.map((f) => f.temporada), ["BAJA", "OTRA"]);
    assert.deepEqual(r.conGrupos, ["ALTA", "PROMO (desde ALTA)"]);
  });
});

// ── Acciones con cliente simulado ──────────────────────────────────────────────────────────────────────────
type Est = { rpc: [string, Record<string, unknown>][]; from: string[]; revalida: string[]; regen: number; resp: unknown; insertados: unknown[]; vigs: unknown[] };
const est: Est = { rpc: [], from: [], revalida: [], regen: 0, resp: null, insertados: [], vigs: [] };
(globalThis as unknown as { __g299: Est }).__g299 = est;
type ResolveHook = (s: string, c: { parentURL?: string }, n: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
registerHooks({
  resolve(s, c, n) {
    if (s === "server-only") return { url: datos("export {}"), shortCircuit: true };
    if (s === "next/cache") return { url: datos("export function revalidatePath(p){globalThis.__g299.revalida.push(p)} export function revalidateTag(){}"), shortCircuit: true };
    if (s.endsWith("paquetes/actions") && /\/(grupos-actions|producto\/hoteles\/actions)\.ts$/.test(c.parentURL ?? "")) {
      return { url: datos("export async function regenerarTarifariosDeHotel(){ globalThis.__g299.regen++ } export async function regenerarTarifariosDeHotelAcotado(){ globalThis.__g299.regen = (globalThis.__g299.regen ?? 0) + 1; return globalThis.__g299.regenResultado ?? { paquetes: 1, actualizados: 1, enCurso: 0, fallidos: [] }; }"), shortCircuit: true };
    }
    return n(s, c);
  },
});
const cfgResp = (extra: Record<string, unknown> = {}) => ({ config: { ...base(), vigencia: { ...base().vigencia, hotel_id: 9 } }, ...extra });
// Consulta encadenable mínima: resuelve con lo que corresponda a la tabla.
function consulta(tabla: string) {
  est.from.push(tabla);
  let insert: unknown = null;
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, in: () => b, order: () => b, maybeSingle: () => b,
    insert: (d: unknown) => { insert = d; est.insertados.push(d); return b; },
    then(res: (v: unknown) => unknown) {
      if (tabla === "hoteles") return Promise.resolve({ data: [{ id: 9, nombre: "Hotel T", destino_id: 1, destinos: { nombre: "D" } }], error: null }).then(res);
      if (tabla === "hotel_temporadas") return Promise.resolve({ data: est.vigs, error: null }).then(res);
      if (tabla === "tarifa_hotel" && insert) {
        const t = (insert as { temporada?: string }).temporada;
        return Promise.resolve({ data: null, error: t === "ALTA" ? { message: "La vigencia \"ALTA\" del hotel 9 ya tiene tarifas por grupo de días; no admite tarifas de todos los días." } : null }).then(res);
      }
      return Promise.resolve({ data: [], error: null }).then(res);
    },
  };
  return b;
}
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({
  rpc: async (fn: string, args: Record<string, unknown>) => {
    est.rpc.push([fn, args]);
    if (fn === "grupos_dias_config") return { data: { huella: "HC" }, error: null };
    return est.resp ?? { data: cfgResp({ por_grupo_quitadas: 2, todos_los_dias_nuevas: 1, tarifas_eliminadas: 0 }), error: null };
  },
  from: (t: string) => consulta(t),
}) } });
const acc = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/grupos-actions.ts");
const hot = await import("../app/(dashboard)/dashboard/producto/hoteles/actions.ts");
beforeEach(() => { est.rpc.length = 0; est.from.length = 0; est.revalida.length = 0; est.regen = 0; est.resp = null; est.insertados.length = 0; est.vigs = []; });

describe("acciones de la venta: una RPC; revalidan y regeneran solo si cambia lo que se vende", () => {
  test("leer el alcance: 1 RPC, sin revalidar", async () => {
    est.resp = { data: base(), error: null };
    const r = await acc.leerAlcanceGrupos(1);
    assert.equal(r.ok, true);
    assert.deepEqual(est.rpc.map((x) => x[0]), ["grupos_dias_alcance"]);
    assert.equal(est.revalida.length + est.regen + est.from.length, 0);
  });
  test("aplicar: 1 RPC con las habilitaciones tal cual; 1 revalidación de la ficha y 1 regeneración", async () => {
    const h = [{ grupo_id: S, tipo_habitacion: "Estándar", alimentacion: "PAM", acomodacion: "triple" }];
    const r = await acc.aplicarGruposVenta(1, "H1", h);
    assert.equal(r.ok, true);
    assert.deepEqual(est.rpc, [["grupos_dias_activar", { p_temporada_id: 1, p_huella: "H1", p_habilitaciones: h }]]);
    assert.deepEqual(est.revalida, ["/dashboard/producto/hoteles/9"]);
    assert.equal(est.regen, 1);
  });
  test("aplicar con datos no válidos: 0 RPC", async () => {
    assert.equal((await acc.aplicarGruposVenta(1, "H1", [{ grupo_id: "x" } as never])).ok, false);
    assert.equal((await acc.aplicarGruposVenta(0, "H1", [])).ok, false);
    assert.equal(est.rpc.length, 0);
  });
  test("rechazos: obsoleta = desactualizada con el motivo sin prefijo; empate = mensaje sin prefijo; sin reintento", async () => {
    est.resp = { data: null, error: { code: "PT409", message: "HABILITACIONES_SIN_CONFIRMAR: confirma una por una las acomodaciones." } };
    const a = await acc.aplicarGruposVenta(1, "H1", []);
    assert.deepEqual(a, { ok: false, desactualizada: true, error: "confirma una por una las acomodaciones." });
    est.resp = { data: null, error: { code: "23514", message: "EMPATE_PRIORIDAD: Empate de prioridad entre ALTA y PUENTE (prioridad 1)." } };
    const b = await acc.aplicarGruposVenta(1, "H1", []);
    assert.deepEqual(b, { ok: false, error: "Empate de prioridad entre ALTA y PUENTE (prioridad 1)." });
    assert.equal(est.rpc.length, 2, "una llamada por intento del usuario, ninguna automática");
    assert.equal(est.revalida.length + est.regen, 0);
  });
  test("descartar el borrador: 1 RPC, no cambia precios (sin revalidar ni regenerar)", async () => {
    assert.equal((await acc.descartarBorradorGrupos(1, "H1")).ok, true);
    assert.deepEqual(est.rpc.map((x) => x[0]), ["grupos_dias_descartar"]);
    assert.equal(est.revalida.length + est.regen, 0);
  });
  test("volver a todos los días: exige elecciones; 1 RPC; revalida y regenera", async () => {
    assert.equal((await acc.volverATodosLosDias(1, "H1", [])).ok, false);
    assert.equal(est.rpc.length, 0);
    const e = [{ tipo_habitacion: "Estándar", alimentacion: "PAM", grupo_id: S }];
    const r = await acc.volverATodosLosDias(1, "H1", e);
    assert.equal(r.ok && r.nuevas === 1 && r.quitadas === 2, true);
    assert.deepEqual(est.rpc, [["grupos_dias_volver_todos", { p_temporada_id: 1, p_huella: "H1", p_elecciones: e }]]);
    assert.equal(est.revalida.length, 1); assert.equal(est.regen, 1);
  });
  test("borrar: un grupo preparado no regenera; uno que se vendía (tarifas quitadas) sí, una vez", async () => {
    assert.equal((await acc.borrarGrupoDias(F, "H1", [])).ok, true);
    assert.equal(est.revalida.length + est.regen, 0);
    est.resp = { data: cfgResp({ propuestas_eliminadas: 1, bases_eliminadas: 0, tarifas_eliminadas: 2 }), error: null };
    assert.equal((await acc.borrarGrupoDias(F, "H1", [])).ok, true);
    assert.equal(est.revalida.length, 1); assert.equal(est.regen, 1);
  });
});

describe("carga CSV con grupo: al BORRADOR, nunca directo a la venta", () => {
  const fila = (x: Record<string, string>) => ({ hotel: "Hotel T", categoria: "Estándar", regimen: "PAM", temporada: "ALTA", ...x });
  test("filas con grupo: 1 lectura de vigencias + 1 lectura y 1 RPC «actualizar» por vigencia; no se insertan en tarifa_hotel", async () => {
    est.vigs = [{ id: 1, hotel_id: 9, nombre: "ALTA", tipo: "tarifa", hotel_temporada_grupos: [{ id: S, nombre: "Semana" }, { id: F, nombre: "Finde" }] }];
    const r = await hot.cargarTarifasMasivo([fila({ grupo: "semana", neto_doble: "95000" }), fila({ grupo: "Finde", neto_doble: "130000" })]);
    assert.equal(r.ok, true);
    assert.equal(r.insertados, 2);
    assert.match(r.errores.join(" "), /^Aviso: 2 fila\(s\) fueron al borrador de sus grupos/);
    assert.deepEqual(est.rpc.map((x) => x[0]), ["grupos_dias_config", "grupos_dias_guardar_propuesta"]);
    const args = est.rpc[1][1];
    assert.equal(args.p_modo, "actualizar"); assert.equal(args.p_huella, "HC");
    assert.deepEqual((args.p_filas as { grupo_id: string; neto_doble: number }[]).map((f) => [f.grupo_id, f.neto_doble]), [[S, 95000], [F, 130000]]);
    assert.equal(est.insertados.length, 0, "ninguna fila directa a tarifa_hotel");
    assert.equal(est.regen, 0, "el borrador no cambia precios");
  });
  test("grupo inexistente o fila sin netos: la vigencia entera se rechaza (atómico), sin RPC", async () => {
    est.vigs = [{ id: 1, hotel_id: 9, nombre: "ALTA", tipo: "tarifa", hotel_temporada_grupos: [{ id: S, nombre: "Semana" }] }];
    const r = await hot.cargarTarifasMasivo([fila({ grupo: "Semana", neto_doble: "1" }), fila({ grupo: "Fiesta", neto_doble: "1" })]);
    assert.equal(r.ok, false);
    assert.match(r.errores.join(" "), /no tiene el grupo "Fiesta"/);
    const s = await hot.cargarTarifasMasivo([fila({ grupo: "Semana" })]);
    assert.match(s.errores.join(" "), /no trae ningún neto/);
    assert.equal(est.rpc.length, 0);
  });
  test("fila SIN grupo para una vigencia que se vende por grupos: mensaje claro (la base la rechaza)", async () => {
    const r = await hot.cargarTarifasMasivo([fila({ neto_doble: "1" })]);
    assert.equal(r.ok, false);
    assert.match(r.errores[0], /se vende por grupos de días: indica en la columna «grupo»/);
  });
});

describe("regeneración acotada de los tarifarios del hotel (recorrido de la venta por grupos)", async () => {
  const { ejecutarAcotado, clasificarRegeneracion } = await import("../lib/tarifario/regeneracionHotel.ts");
  const { textoRegeneracion } = await import("../lib/hoteles/activacionGrupos.ts");
  test("como mucho 2 a la vez, en orden, sin lanzar: 6 paquetes, uno falla", async () => {
    let enVuelo = 0, maximo = 0;
    const r = await ejecutarAcotado([1, 2, 3, 4, 5, 6], 2, async (id) => {
      enVuelo++; maximo = Math.max(maximo, enVuelo);
      await new Promise((ok) => setTimeout(ok, 5));
      enVuelo--;
      if (id === 4) throw new Error("red");
      return { ok: true as const, ...(id === 5 ? { pendiente: { faltan: 1, total: 2, automatica: true } } : {}) };
    });
    assert.equal(maximo, 2, "nunca más de 2 paquetes regenerando a la vez");
    assert.deepEqual(r.map((x) => x.status), ["fulfilled", "fulfilled", "fulfilled", "rejected", "fulfilled", "fulfilled"]);
    const c = clasificarRegeneracion([1, 2, 3, 4, 5, 6], r);
    assert.deepEqual(c, { paquetes: 6, actualizados: 4, enCurso: 1, fallidos: [{ paqueteId: 4, error: "fallo técnico al regenerar" }] });
    const t = textoRegeneracion(c);
    assert.equal(t.ok, false, "con un fallo no se dice que todo quedó actualizado");
    assert.match(t.texto, /4 tarifario\(s\) regenerado\(s\); 1 en publicación por lotes.*; 1 NO se pudieron regenerar \(paquete #4\)/);
  });
  test("hotel sin paquetes: 0 trabajo, y lo dice; consulta fallida: no se afirma nada", async () => {
    let llamadas = 0;
    const r = await ejecutarAcotado([], 2, async () => { llamadas++; return { ok: true as const }; });
    assert.equal(llamadas, 0);
    const c = clasificarRegeneracion([], r);
    assert.deepEqual(textoRegeneracion(c), { ok: true, texto: "Este hotel no está en ningún paquete activo: no había tarifarios que regenerar." });
    assert.equal(textoRegeneracion({ paquetes: null, actualizados: 0, enCurso: 0, fallidos: [] }).ok, false);
    assert.equal(textoRegeneracion(undefined).ok, false);
  });
  test("un resultado ok:false de generarTarifario también es un fallo (no solo las excepciones)", () => {
    const c = clasificarRegeneracion([7], [{ status: "fulfilled", value: { ok: false, error: "sin hoteles" } }]);
    assert.deepEqual(c.fallidos, [{ paqueteId: 7, error: "sin hoteles" }]);
  });
  test("cableado: el recorrido usa la regeneración ACOTADA; las demás regeneraciones no cambian", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/(dashboard)/dashboard/paquetes/actions.ts", "utf8");
    const i = src.indexOf("export async function regenerarTarifariosDeHotelAcotado(");
    const cuerpo = src.slice(i, src.indexOf("\nexport async function", i + 1));
    assert.match(cuerpo, /paquetesActivosDeHotel\(sb, hotelId\)/);
    assert.match(cuerpo, /ejecutarAcotado\(ids, concurrencia,/);
    assert.match(src, /export async function regenerarTarifariosDeHotel\(hotelId: number, inicioMs\?: number\): Promise<void>/);
    // #43/#60: las regeneraciones por hotel/bloqueo/servicio pasaron de «todas en paralelo» a ACOTADAS (CONCURRENCIA_REGENERACION a la vez,
    // con resultados como allSettled: un paquete que falla no detiene a los demás).
    assert.match(src, /ejecutarAcotado\(ids, CONCURRENCIA_REGENERACION, \(id\) => generarTarifario\(id, enSegundoPlano\(inicioMs\)\)\)/, "la regeneración existente queda acotada para sus demás llamadores");
  });
});
