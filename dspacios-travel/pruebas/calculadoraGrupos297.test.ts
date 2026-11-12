// #43/#60 entrega 3b — calculadoras por grupo de días: fórmulas (paridad con los generadores existentes,
// sin promociones), revisión (edades, condiciones, habilitaciones), acción atómica de una sola RPC y
// escritores de hotel_calculadora condicionados a la versión (guardar calculadora y renombrar vigencia).
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";
import { readFileSync } from "node:fs";
import {
  generarTarifasDubai, generarTarifasMixta, generarTarifasCorporativa,
  type DubaiParams, type MixtaParams, type CorporativaParams,
} from "../lib/calc/calculadoras.ts";
import {
  basesDeParams, paramsDelGrupo, calcularGrupo, revisarCalculo, decidirTodas, DECISIONES_VACIAS,
  type BasesGrupo, type Decisiones,
} from "../lib/hoteles/calculadoraGrupos.ts";
import { NETOS_VACIOS, EXTRAS_VACIOS, payloadFilas, type ConfigGrupos } from "../lib/hoteles/alcanceGrupos.ts";

const G1 = "00000000-0000-4000-8000-0000000000a1", G2 = "00000000-0000-4000-8000-0000000000a2";
const DUBAI: DubaiParams = {
  regimen_base: "PAM",
  modificadores: { sencilla_pct: 50, pax3_pct: -20, pax4_pct: -25, nino_pct: -50, nino2_pct: -30, infante_pct: -100 },
  suplementos: [{ regimen: "PC", monto: 45000 }],
  bases: [{ categoria: "Estándar", temporada: "ALTA", precio: 100000 }, { categoria: "Estándar", temporada: "BAJA", precio: 80000 }],
  promos: [{ temporadaBase: "ALTA", temporadaPromo: "PROMO", regimen: "PAM", descuentoPct: 10 }],
  infante_nota: "Comparte cama",
};
const BASES_DUBAI: BasesGrupo = [
  { categoria: "Estándar", precio: 120000, usarEdadesPropias: true, edadesPropias: { infanteMin: 0, infanteMax: 1, ninoMin: 2, ninoMax: 11 },
    usarSuplementosPropios: true, suplementosPropios: [{ regimen: "PC", monto: 50000 }], condicionesPropias: "Fin de semana" },
  { categoria: "Superior", precio: 150000 },
];
const MIXTA: MixtaParams = {
  regimen: "PAM", iva_pct: 19,
  acom: { sencilla: { modo: "pax", iva: true }, doble: { modo: "hab", iva: false }, triple: { modo: "pax", iva: false }, multiple: { modo: "pax", iva: false } },
  nino: { iva: true }, pax: { sencilla: 1, doble: 2, triple: 3, multiple: 4 }, bases: [], infante_nota: "Cuna",
};
const BASES_MIXTA: BasesGrupo = {
  PAM: [{ categoria: "Estándar", sencilla: 200000, doble: 300000, triple: 0, multiple: 0, nino: 50000, nino2: null, infante: 0 }],
  PC: [{ categoria: "Estándar", sencilla: 250000, doble: 360000, triple: 140000, multiple: 0, nino: 60000, nino2: 40000, infante: null }],
};
const CORP: CorporativaParams = {
  regimen_base: "PAM", persona_adicional: 90000, nino_adicional: 40000, impuesto_pct: 0, descuento_pct: 10,
  suplementos_regimen: [{ regimen: "PC", adulto: 30000, nino: 15000 }], bases: [], infante_nota: "Infante cortesía",
};
const BASES_CORP: BasesGrupo = [{ categoria: "Estándar", precio: 400000 }];
const conT = (bs: object[], t = "ALTA") => bs.map((b) => ({ ...b, temporada: t }));

describe("fórmulas: las mismas de cada calculadora, con las bases del grupo y sin promociones", () => {
  test("Dubai: idéntico al generador con edades, suplementos y condiciones propias de cada base; la promo no se calcula", () => {
    const esperado = generarTarifasDubai({ ...DUBAI, bases: conT(BASES_DUBAI as object[]) as DubaiParams["bases"], promos: [] });
    const obtenido = calcularGrupo("dubai", DUBAI, "ALTA", BASES_DUBAI, false);
    assert.deepEqual(obtenido, esperado);
    assert.equal(obtenido.length, 4, "2 bases × 2 regímenes");
    const est = obtenido.find((f) => f.tipo_habitacion === "Estándar" && f.alimentacion === "PC")!;
    assert.equal(est.neto_doble, 170000, "suplemento PROPIO de la base (50.000), no el general");
    assert.equal(est.notas, "Fin de semana");
    assert.deepEqual([est.edad_infante_min, est.edad_infante_max, est.edad_nino_min, est.edad_nino_max], [0, 1, 2, 11]);
    assert.ok(obtenido.every((f) => f.temporada === "ALTA" && !f.precio_final_autoritativo), "ninguna fila de promoción (entrega 4)");
    assert.ok(obtenido.every((f) => f.neto_nino2 != null), "niño 2 configurado en los generales se conserva");
  });
  test("Mixta: un cálculo por régimen con bases, mismo IVA/modo/pax; sin contexto no deriva promociones", () => {
    const por = { PAM: conT((BASES_MIXTA as Record<string, object[]>).PAM), PC: conT((BASES_MIXTA as Record<string, object[]>).PC) };
    const esperado = [
      ...generarTarifasMixta({ ...MIXTA, regimen: "PAM", bases: por.PAM as MixtaParams["bases"] }),
      ...generarTarifasMixta({ ...MIXTA, regimen: "PC", bases: por.PC as MixtaParams["bases"] }),
    ];
    assert.deepEqual(calcularGrupo("mixta", MIXTA, "ALTA", BASES_MIXTA, false), esperado);
    const pam = esperado.find((f) => f.alimentacion === "PAM")!;
    assert.equal(pam.neto_doble, 150000, "doble por habitación ÷ 2 pax");
    assert.equal(pam.neto_sencilla, 238000, "sencilla + IVA 19 %");
  });
  test("Corporativa: idéntico al generador (descuento solo al rack, impuesto 0 ⇒ condición «no incluye impuestos»)", () => {
    const esperado = generarTarifasCorporativa({ ...CORP, bases: conT(BASES_CORP as object[]) as CorporativaParams["bases"] });
    const obtenido = calcularGrupo("corporativa", CORP, "ALTA", BASES_CORP, false);
    assert.deepEqual(obtenido, esperado);
    assert.ok(obtenido.every((f) => f.notas === "Tarifa no incluye impuestos." && f.neto_infante === 0));
  });
  test("Adults Only: niño, niño 2, infante y su nota quedan vacíos, como al generar", () => {
    const f = calcularGrupo("dubai", DUBAI, "ALTA", BASES_DUBAI, true);
    assert.ok(f.every((x) => x.neto_nino === null && x.neto_nino2 === null && x.neto_infante === null && x.nota_infante === null));
  });
  test("ida y vuelta: las bases del formulario del grupo son las guardadas (sin vigencia, con todas sus opciones)", () => {
    for (const [tipo, general, bases] of [["dubai", DUBAI, BASES_DUBAI], ["mixta", MIXTA, BASES_MIXTA], ["corporativa", CORP, BASES_CORP]] as const) {
      assert.deepEqual(basesDeParams(tipo, paramsDelGrupo(tipo, general, "ALTA", bases)), bases, tipo);
    }
    const p = paramsDelGrupo("dubai", DUBAI, "ALTA", BASES_DUBAI) as DubaiParams;
    assert.deepEqual(p.promos, []);
    assert.deepEqual(p.modificadores, DUBAI.modificadores, "generales intactos");
    assert.equal(JSON.stringify(basesDeParams("dubai", p)).includes("temporada"), false, "la vigencia no se guarda en las bases");
  });
  test("paridad «todos los días»: con las mismas bases, el grupo da exactamente lo que da la calculadora hoy", () => {
    const hoy = generarTarifasDubai({ ...DUBAI, promos: [] }).filter((f) => f.temporada === "ALTA");
    const mismas = basesDeParams("dubai", { ...DUBAI, bases: DUBAI.bases.filter((b) => b.temporada === "ALTA") });
    assert.deepEqual(calcularGrupo("dubai", DUBAI, "ALTA", mismas, false), hoy);
  });
});

// ── Revisión ───────────────────────────────────────────────────────────────────────────
const cfg = (over: Partial<ConfigGrupos> = {}): ConfigGrupos => ({
  vigencia: { id: 10, nombre: "ALTA", hotel_id: 5, tipo: "tarifa", nombre_repetido: false },
  hotel: { id: 5, modelo_tarifario: "persona" },
  categorias: ["Estándar", "Superior", "Junior"], regimenes: ["PAM", "PC"],
  grupos: [{ id: G1, nombre: "Fin de semana", dias: [5, 6, 7], activo: false }, { id: G2, nombre: "Semana", dias: [1, 2, 3, 4], activo: false }],
  propuestas: [
    // Estándar/PAM del grupo: triple y niño SIN venta (vacíos), notas y edades propias.
    { id: 1, grupo_id: G1, tipo_habitacion: "Estándar", alimentacion: "PAM", ...NETOS_VACIOS, neto_sencilla: 150000, neto_doble: 100000, neto_multiple: 90000, neto_nino2: 1, neto_infante: 0,
      nota_infante: "Cuna", notas: "Vista al mar", edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12, origen_tarifa_id: 77 },
    // Otro grupo: nunca se toca.
    { id: 2, grupo_id: G2, tipo_habitacion: "Estándar", alimentacion: "PAM", ...NETOS_VACIOS, ...EXTRAS_VACIOS, neto_doble: 1, origen_tarifa_id: null },
  ],
  // Superior/PAM se vende hoy sin triple (0 = no aplica) y sin niño.
  origen: [{ id: 78, tipo_habitacion: "Superior", alimentacion: "PAM", ...NETOS_VACIOS, ...EXTRAS_VACIOS, neto_sencilla: 1, neto_doble: 1, neto_triple: 0, neto_multiple: 1, huella: "h" }],
  promociones: [], huella: "H1", ...over,
});
const calc = calcularGrupo("dubai", DUBAI, "ALTA", BASES_DUBAI, false);
const rev = (d: Decisiones = DECISIONES_VACIAS, c = cfg(), filas = calc, tipo: "dubai" | "mixta" | "corporativa" = "dubai") => revisarCalculo(c, G1, tipo, filas, d);
const combo = (r: ReturnType<typeof rev>, cat: string, reg: string) => r.combos.find((x) => x.categoria === cat && x.regimen === reg)!;

describe("revisión: disponibilidad", () => {
  test("lo que hoy no se vende y el cálculo pondría a la venta queda marcado y SIN decisión (bloquea confirmar)", () => {
    const r = rev();
    assert.deepEqual(combo(r, "Estándar", "PAM").habilitaciones.map((h) => [h.col, h.antes, h.decision]),
      [["neto_triple", null, undefined], ["neto_nino", null, undefined]], "contra la propuesta guardada");
    assert.equal(combo(r, "Estándar", "PAM").referencia, "propuesta");
    assert.deepEqual(combo(r, "Superior", "PAM").habilitaciones.map((h) => [h.col, h.antes]), [["neto_triple", 0], ["neto_nino", null], ["neto_nino2", null]], "contra la tarifa actual (0 = no aplica)");
    assert.equal(combo(r, "Superior", "PAM").referencia, "tarifa_actual");
    // Superior/PC no existe en ningún lado: todas sus acomodaciones son habilitaciones.
    assert.equal(combo(r, "Superior", "PC").referencia, "ninguna");
    assert.equal(combo(r, "Superior", "PC").habilitaciones.length, 6);
    assert.ok(r.pendientes.length >= 10 && r.pendientes.every((p) => typeof p === "string"));
    assert.ok(r.combos.every((c) => c.habilitaciones.every((h) => h.col !== "neto_infante")), "infante vacío = viaja gratis: un precio no es una habilitación");
  });
  test("«mantener sin venta» conserva el valor guardado (vacío); «habilitar» usa el calculado", () => {
    const r0 = rev();
    const kTriple = combo(r0, "Estándar", "PAM").habilitaciones[0].clave, kNino = combo(r0, "Estándar", "PAM").habilitaciones[1].clave;
    const r = rev({ celdas: { [kTriple]: "sin_venta", [kNino]: "habilitar" }, aplicar: {} });
    const f = r.filas.find((x) => x.tipo_habitacion === "Estándar" && x.alimentacion === "PAM")!;
    assert.equal(f.netos.neto_triple, null);
    assert.equal(f.netos.neto_nino, calc.find((x) => x.tipo_habitacion === "Estándar" && x.alimentacion === "PAM")!.neto_nino);
  });
  test("decidir todas es una acción explícita; sin ella nada se preselecciona", () => {
    const r = rev();
    assert.ok(r.combos.every((c) => c.habilitaciones.every((h) => h.decision === undefined)));
    const todas = decidirTodas(r, DECISIONES_VACIAS, "sin_venta");
    const r2 = rev(todas);
    assert.ok(r2.pendientes.every((p) => !/hoy no se vende/.test(p)));
  });
  test("una combinación sin ninguna habitación a la venta no se envía (aunque el infante tenga precio)", () => {
    const r = rev(decidirTodas(rev(), DECISIONES_VACIAS, "sin_venta"));
    assert.equal(r.filas.some((f) => f.tipo_habitacion === "Superior" && f.alimentacion === "PC"), false);
    assert.ok(r.avisos.some((a) => /Superior \/ PC: ninguna habitación queda a la venta/.test(a)));
  });
});

describe("revisión: edades y condiciones", () => {
  test("Dubai fija la regla de edad: si difiere de la guardada, es obligatorio resolverlo", () => {
    const r = rev(decidirTodas(rev(), DECISIONES_VACIAS, "habilitar"));
    const k = combo(r, "Estándar", "PAM").conflictos.find((c) => c.campo === "edades")!;
    assert.equal(k.obligatorio, true);
    assert.equal(k.antes, "infante 0–2 · niño 3–12");
    assert.equal(k.nuevo, "infante 0–1 · niño 2–11");
    assert.ok(r.pendientes.some((p) => /Estándar \/ PAM: el precio se calculó con infante 0–1/.test(p)));
  });
  test("la condición del cálculo frente a una nota existente: se resuelve explícitamente y se ve anterior → nuevo", () => {
    const d0 = decidirTodas(rev(), DECISIONES_VACIAS, "habilitar");
    const kc = combo(rev(d0), "Estándar", "PAM").conflictos;
    const d = { ...d0, aplicar: Object.fromEntries(kc.filter((c) => c.obligatorio).map((c) => [c.clave, true])) };
    const r = rev(d);
    const f = r.filas.find((x) => x.tipo_habitacion === "Estándar" && x.alimentacion === "PAM")!;
    assert.equal(f.extras?.notas, "Fin de semana");
    assert.equal(f.extras?.nota_infante, "Cuna", "la nota de infante es opcional: sin aceptarla se conserva la guardada");
    assert.deepEqual([f.extras?.edad_infante_min, f.extras?.edad_nino_max], [0, 11]);
    assert.ok(r.plan.lineas.some((l) => /Notas: «Vista al mar» → «Fin de semana»/.test(l.texto)));
    assert.equal(r.pendientes.filter((p) => /Estándar \/ PAM:/.test(p)).length, 0);
  });
  test("la regla general en el cálculo frente a un override guardado: aplicarla BORRA el override (visible)", () => {
    const sinEdades = calc.map((f) => ({ ...f, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null, notas: undefined }));
    const k = combo(rev(DECISIONES_VACIAS, cfg(), sinEdades), "Estándar", "PAM").conflictos.find((c) => c.campo === "edades")!;
    assert.equal(k.nuevo, "regla general del hotel");
    const d = { ...decidirTodas(rev(), DECISIONES_VACIAS, "habilitar"), aplicar: { [k.clave]: true } };
    const r = rev(d, cfg(), sinEdades);
    assert.ok(r.plan.lineas.some((l) => /Infante hasta \(edad\): 2 → vacío \(se borra\)/.test(l.texto)));
  });
  test("Mixta no define edades: las guardadas se conservan (no se envían) y no hay conflicto", () => {
    const filas = calcularGrupo("mixta", MIXTA, "ALTA", BASES_MIXTA, false);
    const r = revisarCalculo(cfg(), G1, "mixta", filas, decidirTodas(revisarCalculo(cfg(), G1, "mixta", filas, DECISIONES_VACIAS), DECISIONES_VACIAS, "habilitar"));
    assert.ok(r.combos.every((c) => c.conflictos.every((k) => k.campo !== "edades")));
    const f = r.filas.find((x) => x.tipo_habitacion === "Estándar" && x.alimentacion === "PAM")!;
    assert.equal(f.extras, undefined, "notas y edades omitidas = se conservan");
    assert.equal("edad_infante_min" in payloadFilas([f])[0], false);
  });
  test("Corporativa sin impuesto: la condición «no incluye impuestos» exige aceptación aunque la fila sea nueva", () => {
    const filas = calcularGrupo("corporativa", CORP, "ALTA", BASES_CORP, false);
    const r = revisarCalculo(cfg({ propuestas: [] }), G1, "corporativa", filas, DECISIONES_VACIAS);
    const k = r.combos[0].conflictos.find((c) => c.campo === "notas")!;
    assert.deepEqual([k.antes, k.nuevo, k.obligatorio], ["vacío", "Tarifa no incluye impuestos.", true]);
    assert.ok(r.pendientes.some((p) => /no incluye impuestos/.test(p)));
  });
});

describe("revisión: alcance", () => {
  test("solo filas del grupo, nunca «sugerencia aceptada»; categorías fuera del hotel y sin base, avisadas", () => {
    const fuera = [...calc, { ...calc[0], tipo_habitacion: "Suite" }];
    const r = rev(decidirTodas(rev(), DECISIONES_VACIAS, "habilitar"), cfg(), fuera);
    assert.ok(r.filas.length > 0 && r.filas.every((f) => f.grupo_id === G1 && f.origen_tarifa_id === null));
    assert.ok(r.avisos.some((a) => /Suite \/ PAM: no está configurada/.test(a)));
    assert.ok(r.avisos.some((a) => /Junior: sin base en este grupo/.test(a)));
    assert.ok(r.plan.lineas.every((l) => !l.texto.startsWith("Semana")), "el otro grupo no aparece");
    assert.ok(r.plan.lineas.some((l) => /deja de marcarse como sugerencia aceptada/.test(l.texto)), "si la guardada venía de la sugerencia, se dice");
  });
});

// ── Acciones con cliente simulado ──────────────────────────────────────────────────────
type Llamada = { tabla: string; op: string; datos: unknown; filtros: [string, unknown][] };
const est = {
  rpc: [] as [string, Record<string, unknown>][], resp: null as unknown,
  llamadas: [] as Llamada[], programa: {} as Record<string, unknown | ((l: Llamada) => unknown)>, revalida: [] as string[], regen: 0,
};
(globalThis as unknown as { __c297: typeof est }).__c297 = est;
type ResolveHook = (s: string, c: { parentURL?: string }, n: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
registerHooks({
  resolve(s, c, n) {
    if (s === "server-only") return { url: datos("export {}"), shortCircuit: true };
    if (s === "next/cache") return { url: datos("export function revalidatePath(p){globalThis.__c297.revalida.push(p)} export function revalidateTag(){}"), shortCircuit: true };
    if (s === "../../paquetes/actions" && (c.parentURL ?? "").endsWith("/producto/hoteles/actions.ts")) {
      return { url: datos("export async function regenerarTarifariosDeHotel(){ globalThis.__c297.regen++ }"), shortCircuit: true };
    }
    return n(s, c);
  },
});
function consulta(tabla: string) {
  const l: Llamada = { tabla, op: "select", datos: undefined, filtros: [] };
  const fin = () => {
    est.llamadas.push({ ...l, filtros: [...l.filtros] });
    const p = est.programa[`${tabla}.${l.op}`];
    return typeof p === "function" ? (p as (x: Llamada) => unknown)(l) : p ?? { data: l.op === "select" ? null : [], error: null };
  };
  const b: Record<string, unknown> = {
    select() { return b; }, insert(d: unknown) { l.op = "insert"; l.datos = d; return b; }, update(d: unknown) { l.op = "update"; l.datos = d; return b; },
    eq(k: string, v: unknown) { l.filtros.push([k, v]); return b; },
    maybeSingle() { return Promise.resolve(fin()); }, single() { return Promise.resolve(fin()); },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return Promise.resolve(fin()).then(res, rej); },
  };
  return b;
}
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({
  rpc: async (fn: string, args: Record<string, unknown>) => { est.rpc.push([fn, args]); return est.resp ?? { data: { config: cfg(), nuevas: 1, actualizadas: 1, bases_version: 3 }, error: null }; },
  from: (t: string) => consulta(t),
}) } });
const acc = await import("../app/(dashboard)/dashboard/producto/hoteles/[id]/grupos-actions.ts");
const hot = await import("../app/(dashboard)/dashboard/producto/hoteles/actions.ts");
beforeEach(() => { est.rpc.length = 0; est.resp = null; est.llamadas.length = 0; est.programa = {}; est.revalida.length = 0; est.regen = 0; });

describe("acción guardarCalculoGrupo: una RPC atómica, sin revalidar ni regenerar", () => {
  const filas = rev(decidirTodas(rev(), DECISIONES_VACIAS, "sin_venta")).filas;
  test("envía exactamente propuesta (payloadFilas) + bases + versiones; una sola solicitud", async () => {
    const r = await acc.guardarCalculoGrupo(10, "H1", G1, "dubai", 7, 2, BASES_DUBAI, filas);
    assert.equal(r.ok, true);
    assert.equal((r as { basesVersion: number }).basesVersion, 3);
    assert.deepEqual(est.rpc.map((x) => x[0]), ["grupos_dias_guardar_calculadora"]);
    assert.deepEqual(est.rpc[0][1], { p_temporada_id: 10, p_huella: "H1", p_grupo_id: G1, p_tipo: "dubai", p_calc_version: 7, p_bases_version: 2, p_bases: BASES_DUBAI, p_filas: payloadFilas(filas) });
    assert.equal(est.llamadas.length, 0); assert.equal(est.revalida.length, 0);
  });
  test("datos no válidos: CERO solicitudes (fila de otro grupo, sugerencia, tipo, forma de bases, versión)", async () => {
    const otro = [{ ...filas[0], grupo_id: G2 }], sug = [{ ...filas[0], origen_tarifa_id: 77 }];
    for (const args of [
      [10, "H1", G1, "dubai", 7, null, BASES_DUBAI, otro], [10, "H1", G1, "dubai", 7, null, BASES_DUBAI, sug],
      [10, "H1", G1, "otra", 7, null, BASES_DUBAI, filas], [10, "H1", G1, "mixta", 7, null, BASES_DUBAI, []],
      [10, "H1", G1, "dubai", 0, null, BASES_DUBAI, filas], [10, "H1", "no-uuid", "dubai", 7, null, BASES_DUBAI, filas],
    ] as const) {
      const r = await (acc.guardarCalculoGrupo as (...a: unknown[]) => Promise<{ ok: boolean }>)(...args);
      assert.equal(r.ok, false);
    }
    assert.equal(est.rpc.length, 0);
  });
  test("desactualizada (PT409): dice QUÉ cambió, sin prefijo técnico y sin reintento", async () => {
    est.resp = { data: null, error: { code: "PT409", message: "CONFIG_DESACTUALIZADA: la calculadora del hotel cambió desde que la abriste. Recarga y revisa de nuevo." } };
    const r = await acc.guardarCalculoGrupo(10, "H1", G1, "dubai", 7, 2, BASES_DUBAI, filas) as { ok: false; error: string; desactualizada?: true };
    assert.equal(r.desactualizada, true);
    assert.equal(r.error, "la calculadora del hotel cambió desde que la abriste. Recarga y revisa de nuevo.");
    assert.equal(est.rpc.length, 1);
  });
  test("rechazo de validación de la base: mensaje sin nombres técnicos", async () => {
    est.resp = { data: null, error: { code: "23514", message: 'new row for relation "hotel_grupo_tarifa_propuesta" violates check constraint "hotel_grupo_tarifa_propuesta_edades_rangos"' } };
    const r = await acc.guardarCalculoGrupo(10, "H1", G1, "dubai", 7, 2, BASES_DUBAI, filas) as { ok: false; error: string };
    assert.doesNotMatch(r.error, /hotel_grupo|constraint/);
  });
});

describe("escritores de hotel_calculadora: condicionados a la versión leída, sin reintento", () => {
  test("guardar la calculadora: update con hotel + versión; devuelve la versión nueva", async () => {
    est.programa["hotel_calculadora.update"] = { data: [{ version: 8 }], error: null };
    const r = await hot.guardarCalculadora(5, "dubai", DUBAI, 7);
    assert.deepEqual(r, { ok: true, version: 8 });
    const u = est.llamadas.find((l) => l.op === "update")!;
    assert.deepEqual(u.filtros, [["hotel_id", 5], ["version", 7]]);
    assert.equal("updated_at" in (u.datos as object) || "version" in (u.datos as object), false, "la versión y la fecha las pone el trigger");
  });
  test("versión vieja ⇒ 0 filas: no se escribe nada más y se pide recargar", async () => {
    est.programa["hotel_calculadora.update"] = { data: [], error: null };
    const r = await hot.guardarCalculadora(5, "dubai", DUBAI, 7) as { ok: false; desactualizada?: true; error: string };
    assert.equal(r.desactualizada, true);
    assert.match(r.error, /Recarga/);
    assert.equal(est.llamadas.filter((l) => l.op !== "select").length, 1, "un solo intento");
    assert.equal(est.revalida.length, 0);
  });
  test("primera calculadora del hotel: insert; si otra persona la creó a la vez (23505), recargar", async () => {
    est.programa["hotel_calculadora.insert"] = { data: [{ version: 1 }], error: null };
    assert.deepEqual(await hot.guardarCalculadora(5, "mixta", MIXTA, null), { ok: true, version: 1 });
    est.programa["hotel_calculadora.insert"] = { data: null, error: { code: "23505", message: "duplicate" } };
    assert.equal((await hot.guardarCalculadora(5, "mixta", MIXTA, null) as { desactualizada?: true }).desactualizada, true);
  });
  test("renombrar una vigencia: la cascada a la calculadora va condicionada a la versión y avisa si no pudo", async () => {
    est.programa["hotel_temporadas.select"] = { data: { nombre: "ALTA", hotel_id: 5, fecha_inicio: "2027-01-01", fecha_fin: "2027-01-31", rangos: [], blackouts: [], compra_inicio: null, compra_fin: null }, error: null };
    est.programa["hotel_temporadas.update"] = { data: { hotel_id: 5 }, error: null };
    est.programa["tarifa_hotel.update"] = { data: [], error: null };
    est.programa["hotel_calculadora.select"] = { data: { tipo: "dubai", params: JSON.parse(JSON.stringify(DUBAI)), version: 4 }, error: null };
    est.programa["hotel_calculadora.update"] = { data: [], error: null };   // otra persona la guardó entretanto
    const r = await hot.actualizarTemporada(140, { hotelId: 5, nombre: "ALTA ENERO", inicio: "2027-01-01", fin: "2027-01-31", prioridad: 1, minNoches: 1, tipo: "tarifa", compraInicio: "", compraFin: "", rangos: [], blackouts: [] } as never);
    assert.equal(r.ok, true);
    const u = est.llamadas.find((l) => l.tabla === "hotel_calculadora" && l.op === "update")!;
    assert.deepEqual(u.filtros, [["hotel_id", 5], ["version", 4]]);
    assert.match((r as { aviso?: string }).aviso ?? "", /calculadora del hotel NO se actualizó/);
  });
});

describe("cableado", () => {
  const raiz = new URL("..", import.meta.url);
  const leer = (p: string) => readFileSync(new URL(p, raiz), "utf8");
  test("el motor y la publicación no leen las bases por grupo ni la propuesta", () => {
    for (const f of ["lib/calc/paquetes.ts", "lib/reservar/cotizar.ts", "lib/reservar/computo.ts", "lib/hoteles/contextoGeneracionTarifas.ts"]) {
      assert.doesNotMatch(leer(f), /hotel_calculadora_grupo_bases|hotel_grupo_tarifa_propuesta/, f);
    }
  });
  test("la acción y el panel no revalidan, no sondean ni reintentan; el panel no recarga sola la página", () => {
    const accion = leer("app/(dashboard)/dashboard/producto/hoteles/[id]/grupos-actions.ts");
    assert.doesNotMatch(accion, /revalidatePath\(/);
    const panel = leer("app/(dashboard)/dashboard/producto/hoteles/[id]/CalculoGrupoPanel.tsx");
    assert.doesNotMatch(panel, /setInterval|setTimeout|useEffect|router\.refresh/);
    assert.match(panel, /onClick=\{\(\) => window\.location\.reload\(\)\}/, "recargar solo con un clic explícito");
  });
  test("todos los escritores de la app condicionan por versión (sin upsert ciego)", () => {
    const a = leer("app/(dashboard)/dashboard/producto/hoteles/actions.ts");
    assert.doesNotMatch(a, /from\("hotel_calculadora"\)\s*\.upsert/);
    assert.equal((a.match(/from\("hotel_calculadora"\)\s*\.update\(/g) ?? []).length + (a.match(/\.update\(fila\)\.eq\("hotel_id", hotelId\)\.eq\("version", versionLeida\)/g) ?? []).length >= 2, true);
    assert.match(a, /\.eq\("hotel_id", hotelId\)\.eq\("version", calc\.version\)/);
  });
});

describe("bases: comparación independiente del orden de claves (jsonb lo cambia al guardar)", () => {
  test("mismo contenido con otro orden = mismas bases; un valor distinto = distintas", async () => {
    const { claveBases } = await import("../lib/hoteles/calculadoraGrupos.ts");
    const a = [{ categoria: "Estándar", precio: 1, edadesPropias: { infanteMin: 0, ninoMax: 11 } }];
    const b = [{ precio: 1, edadesPropias: { ninoMax: 11, infanteMin: 0 }, categoria: "Estándar" }];
    assert.equal(claveBases(a), claveBases(b));
    assert.notEqual(claveBases(a), claveBases([{ ...a[0], precio: 2 }]));
    assert.notEqual(claveBases(a), claveBases([...a, ...a]), "el orden de la LISTA sí importa");
  });
});

describe("compra cerrada: el rechazo del servidor llega claro y sin reintento", () => {
  test("mensaje propio de la RPC, una sola llamada", async () => {
    est.resp = { data: null, error: { code: "23514", message: 'La vigencia "CERRADA" tiene la compra cerrada: no se calcula ni se guarda por grupo.' } };
    const r = await acc.guardarCalculoGrupo(10, "H1", G1, "dubai", 7, null, BASES_DUBAI, []) as { ok: false; error: string; desactualizada?: true };
    assert.equal(r.error, 'La vigencia "CERRADA" tiene la compra cerrada: no se calcula ni se guarda por grupo.');
    assert.equal(r.desactualizada, undefined);
    assert.equal(est.rpc.length, 1);
  });
  test("el formulario usa la MISMA regla que «Generar» (nombreVigenciaVencida), no otra interpretación de fechas", () => {
    const fuente = readFileSync(new URL("../app/(dashboard)/dashboard/producto/hoteles/[id]/CalculadoraEditor.tsx", import.meta.url), "utf8");
    assert.match(fuente, /nombreVigenciaVencida\(v\.vigencia, vigencias, hoy\)/);
    assert.match(fuente, /compraCerrada=\{nombreVigenciaVencida\(modoGrupo\.vig\.vigencia, vigencias, hoy\)\}/);
  });
});
