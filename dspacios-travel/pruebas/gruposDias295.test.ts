// #43/#60 incremento 3 — editor de grupos (preparación inactiva): funciones puras de vista previa,
// acciones del servidor con un cliente simulado (una RPC por acción, sin revalidar ni regenerar) y
// cableado (el motor no lee las propuestas; el panel no sondea).
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";
import { readFileSync } from "node:fs";
import {
  explicarCelda, sugerencia, planPropuesta, planGrupos, coberturaPrevista, textoBorrado, leerNeto, formatNeto, leerEdad,
  validarEdades, payloadFilas, esDesactualizada, mensajeBorrarVigenciaConGrupos, NETOS_VACIOS, EXTRAS_VACIOS,
  type ConfigGrupos, type FilaPropuesta, type Extras,
} from "../lib/hoteles/alcanceGrupos.ts";

const G1 = "00000000-0000-4000-8000-0000000000a1", G2 = "00000000-0000-4000-8000-0000000000a2";
const EXTRAS: Extras = { nota_infante: "Cuna", notas: "Vista al mar", edad_infante_min: 0, edad_infante_max: 1, edad_nino_min: 2, edad_nino_max: 11 };
const cfg = (over: Partial<ConfigGrupos> = {}): ConfigGrupos => ({
  vigencia: { id: 10, nombre: "ALTA", hotel_id: 5, tipo: "tarifa", nombre_repetido: false },
  hotel: { id: 5, modelo_tarifario: "persona" },
  categorias: ["Estándar", "Superior"], regimenes: ["PAM"],
  grupos: [{ id: G1, nombre: "Semana", dias: [1, 2, 3, 4], activo: false }, { id: G2, nombre: "Fin de semana", dias: [5, 6, 7], activo: false }],
  propuestas: [{ id: 1, grupo_id: G1, tipo_habitacion: "Estándar", alimentacion: "PAM", ...NETOS_VACIOS, ...EXTRAS, neto_doble: 123.45, neto_nino: 0, origen_tarifa_id: null }],
  origen: [{ id: 77, tipo_habitacion: "Estándar", alimentacion: "PAM", ...NETOS_VACIOS, ...EXTRAS_VACIOS, neto_doble: 120000, huella: "h" }],
  promociones: [{ temporada: "PROMO-ALTA", filas: 1 }],
  huella: "abc", ...over,
});
const fila = (g: string, cat: string, netos: Partial<typeof NETOS_VACIOS>, origen: number | null = null, extras?: Extras): FilaPropuesta =>
  ({ grupo_id: g, tipo_habitacion: cat, alimentacion: "PAM", netos: { ...NETOS_VACIOS, ...netos }, origen_tarifa_id: origen, ...(extras ? { extras } : {}) });

describe("importes: un solo formato, sin ambigüedad", () => {
  test("formatNeto y leerNeto son inversas exactas (decimales, enteros, cero)", () => {
    for (const n of [123.45, 0.5, 0, 120000, 1234567.891, 99]) {
      const t = formatNeto(n);
      assert.deepEqual(leerNeto(t), { ok: true, valor: n }, `${n} → «${t}»`);
    }
    assert.equal(formatNeto(123.45), "123,45");
    assert.equal(formatNeto(120000), "120.000");
    assert.equal(formatNeto(null), "");
  });
  test("«123.45» (punto decimal) se rechaza en vez de leerse como 12345; vacío = sin precio; negativos y texto = error", () => {
    assert.equal(leerNeto("123.45").ok, false);
    assert.deepEqual(leerNeto("123,45"), { ok: true, valor: 123.45 });
    assert.deepEqual(leerNeto("120000"), { ok: true, valor: 120000 });
    assert.deepEqual(leerNeto("1.234,5"), { ok: true, valor: 1234.5 });
    assert.deepEqual(leerNeto(""), { ok: true, valor: null });
    assert.equal(leerNeto("-1").ok, false);
    assert.equal(leerNeto("abc").ok, false);
  });
  test("edades: enteros 0–17 y todas o ninguna", () => {
    assert.deepEqual(leerEdad("11"), { ok: true, valor: 11 });
    assert.equal(leerEdad("18").ok, false);
    assert.equal(validarEdades({ ...EXTRAS_VACIOS, edad_infante_min: 0 }) != null, true);
    assert.equal(validarEdades(EXTRAS), null);
  });
});

describe("mensajes de disponibilidad (reglas de gratuidad actuales, §3.4)", () => {
  test("habitación sin precio y en 0: no se vende", () => {
    assert.equal(explicarCelda("habitacion", null).vende, false);
    assert.match(explicarCelda("habitacion", 0).texto, /no aplica/);
  });
  test("niño nulo no se vende; niño en 0 es gratis; infante sin tarifa viaja gratis", () => {
    assert.equal(explicarCelda("nino", null).vende, false);
    assert.match(explicarCelda("nino", 0).texto, /gratis/);
    assert.match(explicarCelda("infante", null).texto, /viaja gratis/);
  });
  test("sugerencia: una sola tarifa de origen; con duplicadas no se elige ninguna", () => {
    assert.equal(sugerencia(cfg(), "Estándar", "PAM").fila?.id, 77);
    const c = cfg({ origen: [...cfg().origen, { ...cfg().origen[0], id: 78 }] });
    assert.deepEqual(sugerencia(c, "Estándar", "PAM"), { fila: null, duplicada: true });
  });
});

describe("planPropuesta: la vista previa describe EXACTAMENTE lo que se envía", () => {
  const textos = (p: ReturnType<typeof planPropuesta>) => p.lineas.map((l) => l.texto);
  test("cambio de un neto con decimales: anterior → nuevo, celda por celda; notas y edades omitidas no aparecen ni se envían", () => {
    const p = planPropuesta(cfg(), "actualizar", null, [fila(G1, "Estándar", { neto_doble: 130.5, neto_nino: 0 })]);
    assert.deepEqual(textos(p), ["Semana · Estándar / PAM · Doble: 123,45 → 130,5"]);
    assert.equal(p.filas.length, 1);
    assert.equal("nota_infante" in payloadFilas(p.filas)[0], false, "omitidas = se conservan");
  });
  test("celdas que pasan a vacío o a cero llevan su efecto según el tipo", () => {
    const p = planPropuesta(cfg(), "actualizar", null, [fila(G1, "Estándar", { neto_doble: 0, neto_nino: null, neto_infante: null, neto_sencilla: 5 })]);
    const t = textos(p).join("\n");
    assert.match(t, /Doble: 123,45 → 0 — 0 en habitación significa «no aplica»: no se venderá\./);
    assert.match(t, /Niño 1: 0 → vacío — Sin tarifa de niño: no se venderá con niños/);
    assert.match(t, /Sencilla: vacío → 5/);
  });
  test("borrado intencional de notas y edades: se ve en la revisión y se envía como null", () => {
    const p = planPropuesta(cfg(), "actualizar", null, [fila(G1, "Estándar", { neto_doble: 123.45, neto_nino: 0 }, null, EXTRAS_VACIOS)]);
    assert.match(textos(p).join("\n"), /Notas: «Vista al mar» → vacío \(se borra\)/);
    assert.match(textos(p).join("\n"), /Niño hasta \(edad\): 11 → vacío \(se borra\)/);
    assert.equal(payloadFilas(p.filas)[0].notas, null);
  });
  test("fila nueva: lista cada celda con precio", () => {
    const p = planPropuesta(cfg(), "actualizar", null, [fila(G2, "Estándar", { neto_doble: 180000 }, 77)]);
    assert.deepEqual(textos(p), ["Fin de semana · Estándar / PAM · Doble: sin propuesta → 180.000",
      "Fin de semana · Estándar / PAM: se marca como sugerencia aceptada de la tarifa actual"]);
  });
  test("actualizar sin cambios reales ⇒ sinCambios y nada que enviar", () => {
    const p = planPropuesta(cfg(), "actualizar", null, [fila(G1, "Estándar", { neto_doble: 123.45, neto_nino: 0 })]);
    assert.equal(p.sinCambios, true);
    assert.equal(p.filas.length, 0);
  });
  test("actualizar con una fila vacía: «Se elimina…» con sus precios anteriores y payload con los siete netos en null", () => {
    const p = planPropuesta(cfg(), "actualizar", null, [fila(G1, "Estándar", {})]);
    assert.match(textos(p)[0], /Se elimina la propuesta Semana · Estándar \/ PAM \(antes: Doble 123,45, Niño 1 0\) y sus notas\/edades\./);
    assert.deepEqual(Object.entries(payloadFilas(p.filas)[0]).filter(([k]) => k.startsWith("neto_")).map(([, v]) => v), [null, null, null, null, null, null, null]);
  });
  test("reemplazar un grupo: detalla lo eliminado de ESE grupo y no toca el otro", () => {
    const p = planPropuesta(cfg(), "reemplazar_grupo", G1, [fila(G1, "Superior", { neto_doble: 1 }, null, EXTRAS_VACIOS), fila(G2, "Estándar", { neto_doble: 2 }, null, EXTRAS_VACIOS)]);
    assert.deepEqual(p.filas.map((f) => f.grupo_id), [G1]);
    assert.match(textos(p).join("\n"), /Se elimina la propuesta Semana · Estándar \/ PAM \(antes: Doble 123,45, Niño 1 0\)/);
  });
  test("reemplazar la vigencia: detalla todo lo eliminado", () => {
    const p = planPropuesta(cfg(), "reemplazar_vigencia", null, []);
    assert.equal(p.quitadas, 1);
    assert.equal(p.filas.length, 0);
    assert.match(textos(p)[0], /Se elimina la propuesta/);
  });
  test("en un reemplazo, una fila igual se reescribe (contada, no silenciosa)", () => {
    const p = planPropuesta(cfg(), "reemplazar_grupo", G1, [fila(G1, "Estándar", { neto_doble: 123.45, neto_nino: 0 }, null, EXTRAS)]);
    assert.equal(p.reescritasSinCambio, 1);
    assert.equal(p.filas.length, 1);
    assert.equal(p.lineas.length, 0);
  });
  test("payload: netos y origen siempre presentes; extras solo si la fila los trae", () => {
    const [a, b] = payloadFilas([fila(G1, "Estándar", { neto_doble: 1 }), fila(G2, "Estándar", { neto_doble: 2 }, 77, EXTRAS)]);
    assert.equal(a.origen_tarifa_id, null);
    assert.equal("notas" in a, false);
    assert.equal(b.notas, "Vista al mar");
    assert.equal(b.edad_nino_max, 11);
  });
});

describe("planGrupos, cobertura y borrado", () => {
  test("días repetidos, sin días y nombres repetidos se señalan antes de enviar", () => {
    const p = planGrupos(cfg(), [{ id: G1, nombre: "Semana", dias: [1, 2, 3, 4] }, { nombre: "semana", dias: [4] }, { nombre: "Vacío", dias: [] }]);
    assert.ok(p.errores.some((e) => /repetido/.test(e)));
    assert.ok(p.errores.some((e) => /jueves/.test(e)));
    assert.ok(p.errores.some((e) => /no tiene días/.test(e)));
  });
  test("cobertura prevista: días sin grupo y combinaciones sin habitación", () => {
    const c = coberturaPrevista(cfg(), [{ id: G1, nombre: "Semana", dias: [1, 2, 3, 4] }], [{ grupo_id: G1, tipo_habitacion: "Estándar", alimentacion: "PAM", netos: { ...NETOS_VACIOS, neto_doble: 1 } }]);
    assert.deepEqual(c.diasSinGrupo, ["viernes", "sábado", "domingo"]);
    assert.deepEqual(c.porGrupo, [{ grupo: "Semana", combinaciones: 2, sinHabitacion: 1 }]);
  });
  test("el texto de borrado enumera las propuestas y dice que nada comercial se toca", () => {
    const t = textoBorrado(cfg(), G1).join(" ");
    assert.match(t, /su única propuesta/);
    assert.match(t, /Estándar \/ PAM: Doble 123,45, Niño 1 0 \(con notas\/edades\)/);
    assert.match(t, /No se borran ni se modifican promociones, tarifas vigentes/);
    assert.match(t, /PROMO-ALTA.*No se tocan/);
  });
  test("errores de la base: PT409 = desactualizada; FK de grupos al borrar vigencia = mensaje claro", () => {
    assert.equal(esDesactualizada({ code: "PT409", message: "x" }), true);
    assert.equal(esDesactualizada({ code: "23514", message: "otro" }), false);
    assert.match(mensajeBorrarVigenciaConGrupos({ message: 'violates foreign key constraint "hotel_temporada_grupos_temporada_id_fkey"' }) ?? "", /grupos de días preparados/);
  });
});

// ── Acciones del servidor con cliente simulado ─────────────────────────────────────
const est = { rpc: [] as [string, Record<string, unknown>][], from: [] as string[], revalida: [] as string[], resp: null as unknown };
(globalThis as unknown as { __g295: typeof est }).__g295 = est;
type ResolveHook = (s: string, c: { parentURL?: string }, n: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(s, c, n) {
    if (s === "next/cache") return { url: `data:text/javascript,${encodeURIComponent("export function revalidatePath(p){globalThis.__g295.revalida.push(p)} export function revalidateTag(){}")}`, shortCircuit: true };
    return n(s, c);
  },
});
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({
  rpc: async (fn: string, args: Record<string, unknown>) => { est.rpc.push([fn, args]); return est.resp ?? { data: { config: cfg(), altas: 1, cambios: 0, nuevas: 1, actualizadas: 0, eliminadas: 0, propuestas_eliminadas: 1, ...cfg() }, error: null }; },
  from: (t: string) => { est.from.push(t); throw new Error("no se esperaba una lectura de tabla"); },
}) } });
const acc = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/grupos-actions.ts");
beforeEach(() => { est.rpc.length = 0; est.from.length = 0; est.revalida.length = 0; est.resp = null; });
const unaRpc = (nombre: string) => {
  assert.deepEqual(est.rpc.map((r) => r[0]), [nombre]);
  assert.equal(est.from.length, 0);
  assert.equal(est.revalida.length, 0, "sin revalidatePath (no hay recarga de la página)");
};

describe("acciones: exactamente una RPC, sin revalidar ni regenerar", () => {
  test("leer", async () => { assert.equal((await acc.leerConfigGrupos(10)).ok, true); unaRpc("grupos_dias_config"); });
  test("guardar grupos (nombres recortados)", async () => {
    await acc.guardarGruposVigencia(10, "abc", [{ nombre: " Semana ", dias: [1, 2] }, { id: G2, nombre: "FS", dias: [5] }]);
    unaRpc("grupos_dias_guardar");
    assert.deepEqual(est.rpc[0][1].p_grupos, [{ nombre: "Semana", dias: [1, 2] }, { id: G2, nombre: "FS", dias: [5] }]);
  });
  test("guardar propuesta: el payload es payloadFilas(plan.filas), sin transformaciones", async () => {
    const filas = [fila(G1, "Estándar", { neto_doble: 123.45 }), fila(G2, "Estándar", { neto_doble: 2 }, 77, EXTRAS)];
    await acc.guardarPropuestaGrupos(10, "abc", "actualizar", G1, filas);
    unaRpc("grupos_dias_guardar_propuesta");
    assert.equal(est.rpc[0][1].p_grupo_id, null);
    assert.deepEqual(est.rpc[0][1].p_filas, payloadFilas(filas));
  });
  test("borrar", async () => { await acc.borrarGrupoDias(G1, "abc"); unaRpc("grupos_dias_borrar"); });
  test("confirmación obsoleta (PT409): desactualizada, mensaje claro y SIN reintento", async () => {
    est.resp = { data: null, error: { code: "PT409", message: "CONFIG_DESACTUALIZADA: cambió" } };
    const r = await acc.guardarPropuestaGrupos(10, "vieja", "actualizar", null, []);
    assert.equal(r.ok, false);
    assert.equal((r as { desactualizada?: true }).desactualizada, true);
    assert.match((r as { error: string }).error, /Recarga/);
    assert.equal(est.rpc.length, 1);
  });
  test("entradas no válidas: ninguna llamada", async () => {
    await acc.leerConfigGrupos(0);
    await acc.guardarPropuestaGrupos(10, "abc", "borrar_todo" as never, null, []);
    assert.equal(est.rpc.length, 0);
  });
});

describe("cableado", () => {
  const leer = (f: string) => readFileSync(f, "utf8");
  test("el motor y sus cargadores nunca leen la propuesta", () => {
    for (const f of ["lib/calc/paquetes.ts", "lib/reservar/cotizar.ts", "lib/reservar/computo.ts", "lib/reservar/liquidacionHotel.ts",
      "lib/tarifario/vigencia.ts", "app/(dashboard)/dashboard/paquetes/actions.ts"]) {
      assert.doesNotMatch(leer(f), /hotel_grupo_tarifa_propuesta|grupos_dias_/, f);
    }
  });
  test("las acciones no revalidan, no regeneran ni escriben tablas directamente", () => {
    const src = leer("app/(dashboard)/dashboard/producto/hoteles/[id]/grupos-actions.ts").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /revalidatePath\(|regenerarTarifarios|\.from\(/);
  });
  test("el panel no sondea, no reintenta solo y no formatea importes con String()", () => {
    const src = leer("app/(dashboard)/dashboard/producto/hoteles/[id]/GruposDiasPanel.tsx");
    assert.doesNotMatch(src, /setInterval|setTimeout|requestAnimationFrame/);
    assert.doesNotMatch(src, /String\(Number\(p\[a\.col\]\)\)|String\(netos\[a\.col\]\)|String\(fila\[a\.col\]\)/);
  });
});
