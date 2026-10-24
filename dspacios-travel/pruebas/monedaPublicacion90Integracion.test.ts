// #90 Entrega D / #93 — integración del evaluador con el cargador de fuentes, con las funciones de oferta sin TRM y con el cableado de
// panel / generador / cotización (paridad: los tres usan LA MISMA lectura y LA MISMA evaluación).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cargarFuentesMoneda90 } from "../lib/reservar/fuentesMoneda90.ts";
import { fuentesQueAportan90 } from "../lib/reservar/aporteFuentes90.ts";
import { evaluarPublicacion90, mensajeEvaluacion90 } from "../lib/reservar/monedaPublicacion90.ts";
import { aCop63, feeACop63 } from "../lib/reservar/ofertaDinamica63.ts";
import { equivalenteCop63, resolverImporteContable63, validarObligacion63 } from "../lib/reservar/importeObligacion63.ts";
import { camposCxP63, sumaEquivalentesCop63 } from "../lib/reservar/payloadFinanciero63.ts";
import { construirObligaciones63 } from "../lib/reservar/aceptacion63.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

// Cliente en memoria: cada tabla devuelve sus filas (`in("id", ids)` y `eq` filtran de verdad); `error` fuerza el fallo de una tabla.
function cliente(tablas: Record<string, Record<string, unknown>[]>, error?: string) {
  return {
    from(t: string) {
      const filtros: ((f: Record<string, unknown>) => boolean)[] = [];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => (filtros.push((f) => f[col] === val), q),
        in: (col: string, vals: unknown[]) => (filtros.push((f) => vals.includes(f[col])), q),
        then: (res: (v: { data: unknown[] | null; error: { message: string } | null }) => void) =>
          res(error === t ? { data: null, error: { message: "boom" } } : { data: (tablas[t] ?? []).filter((f) => filtros.every((p) => p(f))), error: null }),
      };
      return q;
    },
  } as never;
}

function manana(d: number) {
  return new Date(Date.now() + d * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
const HOY = manana(0);
const AYER = manana(-1);

describe("cargarFuentesMoneda90: las fuentes que REALMENTE aportan, con su moneda real", () => {
  const base = () => ({
    armado_paquetes: [{ id: 1, destino_id: 10, destinos_aereos_alternativos: false }],
    armado_paquete_destinos_aereos: [],
    armado_hoteles: [{ paquete_id: 1, hotel_id: 1 }, { paquete_id: 1, hotel_id: 2 }, { paquete_id: 2, hotel_id: 1 }],
    hoteles: [
      { id: 1, nombre: "Decameron", moneda: "USD", modelo_tarifario: "persona" },
      { id: 2, nombre: "Por unidad", moneda: "USD", modelo_tarifario: "unidad" },
    ],
    armado_servicios: [{ paquete_id: 1, servicio_id: 5 }],
    servicios_adicionales: [{ id: 5, nombre: "Tour", moneda: "COP" }],
    armado_vuelos: [], armado_empaquetados: [], bloqueos_vuelo: [],
    salidas_dinamicas: [
      { id: 10, paquete_id: 1, ruta: "BOG-CTG", fecha_ida: manana(30), fecha_regreso: manana(33), moneda: "COP", empaquetado_id: null, activo: true },
      { id: 11, paquete_id: 1, ruta: "MDE-CTG", fecha_ida: manana(31), fecha_regreso: manana(34), moneda: "USD", empaquetado_id: 77, activo: true, aerolinea: "AV", valor_tiquete: 290, fee_infante: 20 },
      { id: 12, paquete_id: 1, ruta: "INACTIVA", fecha_ida: manana(30), fecha_regreso: manana(33), moneda: "USD", empaquetado_id: null, activo: false },
    ],
    empaquetados: [{ id: 77, ruta: "MDE-CTG", aerolinea: "AV", moneda: "USD", activo: true, record: null as string | null, destino_id: 10, compra_inicio: null, compra_fin: null as string | null, fecha_ida: manana(31), fecha_regreso: manana(34), tarifa_para_empaquetar: 290, fee_infante: 20 }],
  });
  const CTX = { tipo: "dinamico", modo63: true, hoy: HOY };

  test("incluidas: hotel (no por unidad), servicio, salida manual y vinculada (moneda de SU vuelo); la inactiva no cuenta", async () => {
    const r = await cargarFuentesMoneda90(cliente(base()), 1, CTX);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const por = (tipo: string) => r.fuentes.filter((f) => f.tipo === tipo);
    assert.deepEqual(por("hotel").map((f) => [f.nombre, f.moneda]), [["Decameron", "USD"]]);
    assert.deepEqual(por("servicio").map((f) => [f.nombre, f.moneda]), [["Tour", "COP"]]);
    assert.deepEqual(por("salida").map((f) => f.moneda), ["COP", "USD"]);
    assert.equal(r.fuentes.length, 4);
  });

  test("DESCARTADAS: la vinculada con record, inactiva, con la compra vencida, con la copia vieja o sin destino permitido ya no aporta", async () => {
    const variantes: [string, (t: ReturnType<typeof base>) => void][] = [
      ["record", (t) => { t.empaquetados[0].record = "ZZZ999"; }],
      ["inactiva", (t) => { t.empaquetados[0].activo = false; }],
      ["compra vencida", (t) => { t.empaquetados[0].compra_fin = AYER; }],
      ["copia vieja (R)", (t) => { t.empaquetados[0].tarifa_para_empaquetar = 300; }],
      ["destino no permitido", (t) => { t.empaquetados[0].destino_id = 99; }],
      ["fuente inexistente", (t) => { t.empaquetados.length = 0; }],
    ];
    for (const [nombre, aplicar] of variantes) {
      const t = base();
      aplicar(t);
      const r = await cargarFuentesMoneda90(cliente(t), 1, CTX);
      assert.equal(r.ok, true, nombre);
      if (!r.ok) continue;
      assert.deepEqual(r.fuentes.filter((f) => f.tipo === "salida").map((f) => f.moneda), ["COP"], `${nombre}: solo la manual COP aporta`);
      const ev = evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "COP", trm: 4000, fuentes: r.fuentes });
      assert.equal(ev.componentesUsd.some((c) => c.startsWith("Salida")), false, `${nombre}: la salida descartada no cuenta como USD`);
    }
  });

  test("DESCARTADAS (manuales): compra vencida, sin regreso, sin noches o con el viaje pasado no aportan", async () => {
    const variantes: [string, Record<string, unknown>][] = [
      ["compra vencida", { compra_fin: AYER }], ["sin regreso", { fecha_regreso: null }],
      ["sin noches", { fecha_regreso: manana(30) }], ["viaje pasado", { fecha_ida: manana(-5), fecha_regreso: manana(-3) }],
    ];
    for (const [nombre, cambio] of variantes) {
      const t = base();
      t.salidas_dinamicas.push({ id: 20, paquete_id: 1, ruta: "USD", fecha_ida: manana(40), fecha_regreso: manana(43), moneda: "USD", empaquetado_id: null, activo: true, ...cambio } as never);
      const r = await cargarFuentesMoneda90(cliente(t), 1, CTX);
      assert.ok(r.ok);
      if (r.ok) assert.equal(r.fuentes.some((f) => f.tipo === "salida" && f.nombre.startsWith("USD")), false, nombre);
    }
  });

  test("CAMBIO COP→USD: la misma salida manual pasa de no exigir a exigir TRM", async () => {
    const cop = base();
    cop.salidas_dinamicas = [{ id: 30, paquete_id: 1, ruta: "M", fecha_ida: manana(30), fecha_regreso: manana(33), moneda: "COP", empaquetado_id: null, activo: true } as never];
    cop.armado_hoteles = []; cop.armado_servicios = [];
    const usd = structuredClone(cop);
    usd.salidas_dinamicas[0].moneda = "USD";
    const ev = async (t: ReturnType<typeof base>) => {
      const r = await cargarFuentesMoneda90(cliente(t), 1, CTX);
      assert.ok(r.ok);
      return evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: "COP", trm: null, fuentes: r.ok ? r.fuentes : [] });
    };
    assert.equal((await ev(cop)).ok, true);
    const despues = await ev(usd);
    assert.equal(despues.ok, false);
    assert.equal(despues.estadoTrm, "falta");
  });

  test("un error de lectura NO se lee como 'sin fuentes en USD': devuelve error", async () => {
    for (const tabla of ["armado_hoteles", "armado_servicios", "salidas_dinamicas", "armado_vuelos", "armado_empaquetados", "hoteles", "servicios_adicionales", "empaquetados", "armado_paquetes"]) {
      const r = await cargarFuentesMoneda90(cliente(base(), tabla), 1, CTX);
      assert.equal(r.ok, false, tabla);
    }
  });

  test("paridad: panel, generador y cotización reciben el MISMO veredicto de las mismas filas", async () => {
    const r = await cargarFuentesMoneda90(cliente(base()), 1, CTX);
    assert.ok(r.ok);
    if (!r.ok) return;
    const entrada = { modo: "cop_trm_63" as const, monedaPublicacion: "COP", trm: null, fuentes: r.fuentes };
    const panel = evaluarPublicacion90(entrada);
    const generador = evaluarPublicacion90({ ...entrada });
    const cotizacion = evaluarPublicacion90({ ...entrada });
    for (const otro of [generador, cotizacion]) {
      assert.equal(otro.ok, panel.ok);
      assert.equal(otro.estadoTrm, panel.estadoTrm);
      assert.equal(mensajeEvaluacion90(otro), mensajeEvaluacion90(panel));
    }
    assert.equal(panel.ok, false, "hotel y salida vinculada en USD sin TRM");
    assert.match(mensajeEvaluacion90(panel), /Falta la TRM/);
  });
});

describe("fuentesQueAportan90 (puro): predicados compartidos con el generador", () => {
  const permiteTodo = () => true;
  const nada = { hoteles: [], servicios: [], bloqueos: [], empaquetados: [], salidas: [], fuentesVinculadas: new Map(), hoy: HOY, permite: permiteTodo };
  test("Bloqueo: sin fechas o con destino no permitido NO aporta (aunque esté en USD)", () => {
    const f = (b: object, permite = permiteTodo) => fuentesQueAportan90({ ...nada, tipo: "bloqueo", modo63: false, bloqueos: [b as never], permite });
    assert.equal(f({ id: 1, fecha_ida: manana(5), fecha_regreso: manana(8), moneda: "USD" }).length, 1);
    assert.equal(f({ id: 1, fecha_ida: manana(5), fecha_regreso: null, moneda: "USD" }).length, 0);
    assert.equal(f({ id: 1, fecha_ida: manana(5), fecha_regreso: manana(8), moneda: "USD" }, () => false).length, 0);
  });
  test("Empaquetado del armado: inactivo, sin fechas o fuera de compra NO aporta", () => {
    const f = (e: object) => fuentesQueAportan90({ ...nada, tipo: "bloqueo", modo63: false, empaquetados: [e as never] });
    const ok = { id: 2, fecha_ida: manana(5), fecha_regreso: manana(8), moneda: "USD", activo: true, compra_inicio: null, compra_fin: null };
    assert.equal(f(ok).length, 1);
    assert.equal(f({ ...ok, activo: false }).length, 0);
    assert.equal(f({ ...ok, fecha_regreso: null }).length, 0);
    assert.equal(f({ ...ok, compra_fin: AYER }).length, 0);
  });
  test("solo el tipo Dinámico tiene salidas; hoteles por unidad no entran", () => {
    const salida = { id: 1, activo: true, fecha_ida: manana(5), fecha_regreso: manana(8), moneda: "USD", empaquetado_id: null };
    assert.equal(fuentesQueAportan90({ ...nada, tipo: "porcion_terrestre", modo63: false, salidas: [salida] }).length, 0);
    assert.equal(fuentesQueAportan90({ ...nada, tipo: "dinamico", modo63: true, salidas: [salida] }).length, 1);
    assert.equal(fuentesQueAportan90({ ...nada, tipo: "dinamico", modo63: true, hoteles: [{ id: 1, moneda: "USD", modelo_tarifario: "unidad" }] }).length, 0);
  });
});

describe("#93 oferta sin TRM: ningún importe USD se convierte 'a 1' ni a 0", () => {
  test("COP sin TRM pasa tal cual; USD sin TRM es un error de invariante (nunca un importe silencioso)", () => {
    assert.equal(aCop63(1500000, "COP", null), 1500000);
    assert.equal(feeACop63(80500, "COP", null), 80500);
    assert.throws(() => aCop63(250, "USD", null), /exige una TRM positiva/);
    assert.throws(() => aCop63(250, "USD", 0), /exige una TRM positiva/);
    assert.throws(() => equivalenteCop63(210, "USD", null), /exige una TRM positiva/);
    assert.equal(aCop63(250, "USD", 4000), 1000000);
  });
  test("equivalentes y CxP: COP sin TRM lleva trm null y equivalente = valor", () => {
    assert.equal(equivalenteCop63(2080500, "COP", null), 2080500);
    assert.deepEqual(camposCxP63({ valor: 840000, moneda: "COP" }, null), { moneda: "COP", valor_cop: 840000, trm: null });
    assert.equal(sumaEquivalentesCop63([{ valor: 100, moneda: "COP" }, { valor: 50, moneda: "COP" }], null), 150);
    assert.deepEqual(camposCxP63({ valor: 210, moneda: "USD" }, 4000), { moneda: "USD", valor_cop: 840000, trm: 4000 });
  });
  test("validarObligacion63: COP sin TRM válida; USD sin TRM rechazada; COP con equivalente distinto rechazada", () => {
    assert.deepEqual(validarObligacion63({ moneda: "COP", valor_total: 100, valor_cop: 100, trm: null }), { ok: true });
    const usd = validarObligacion63({ moneda: "USD", valor_total: 100, valor_cop: 400000, trm: null });
    assert.equal(usd.ok, false);
    const dist = validarObligacion63({ moneda: "COP", valor_total: 100, valor_cop: 90, trm: null });
    assert.equal(dist.ok, false);
    assert.deepEqual(validarObligacion63({ moneda: "USD", valor_total: 100, valor_cop: 400000, trm: 4000 }), { ok: true });
  });
  test("resolverImporteContable63: COP aceptada sin TRM se devenga por su equivalente; USD sin TRM falla cerrado", () => {
    const ctx = { numeroContrato: "00-1", tenant: "mayorista", valorTotal: 840000 };
    const fila = { numero_contrato: "00-1", tenant: "mayorista", aceptacion_63_id: 9, obligacion_63: "hotel:0", valor_cop_63: 840000, trm_63: null, moneda: "COP" };
    assert.deepEqual(resolverImporteContable63(fila, ctx), { ok: true, importe: 840000 });
    assert.equal(resolverImporteContable63({ ...fila, moneda: "USD" }, ctx).ok, false);
    assert.equal(resolverImporteContable63({ ...fila, valor_cop_63: 800000 }, ctx).ok, false, "equivalente distinto del valor sin TRM");
    assert.equal(resolverImporteContable63({ ...fila, moneda: undefined }, ctx).ok, false, "sin moneda leída no se asume COP");
    assert.deepEqual(resolverImporteContable63({ ...fila, valor_cop_63: 840000, trm_63: 4000, moneda: "USD" }, { ...ctx, valorTotal: 210 }), { ok: true, importe: 840000 });
    assert.equal(resolverImporteContable63(null, ctx).ok, false);
  });
  test("construirObligaciones63 conserva trm null (no cae a 1)", () => {
    const [o] = construirObligaciones63([
      { tipo_proveedor: "hotel", proveedor: "P", servicio: "Hotel", valor_total: 840000, moneda: "COP", valor_cop: 840000, trm: null, aplica_retencion: false, pct_retencion: 0, observaciones: "", servicio_id: null },
    ] as never, null);
    assert.equal(o.trm, null);
    assert.equal(o.valor_cop, 840000);
  });
});

describe("cableado: panel, generador y cotización usan la misma lectura y la misma evaluación", () => {
  const actions = leer("app/(dashboard)/dashboard/paquetes/actions.ts");
  const page = leer("app/(dashboard)/dashboard/paquetes/[id]/page.tsx");
  const oferta = leer("lib/reservar/prepararOferta63.ts");
  const config = leer("app/(dashboard)/dashboard/paquetes/ConfigForm.tsx");

  test("las tres superficies evalúan con evaluarPublicacion90 sobre las fuentes que APORTAN (panel y cotización leen con el cargador; el generador usa las filas que ya tiene)", () => {
    for (const [nombre, src] of [["generador", actions], ["panel", page], ["cotización", oferta]] as const) {
      assert.match(src, /evaluarPublicacion90\(/, nombre);
      assert.match(src, /(cargarFuentesMoneda90|fuentesQueAportan90)\(/, nombre);
    }
    assert.match(page, /cargarFuentesMoneda90\(sb, paqueteId, \{ tipo:/);
    assert.match(oferta, /cargarFuentesMoneda90\(lector, paqueteId, \{ tipo: "dinamico", modo63: true \}\)/);
    assert.match(actions, /fuentesQueAportan90\(\{/);
  });
  test("la moneda ya no se deriva de los hoteles: ni en el generador ni en el panel", () => {
    assert.doesNotMatch(actions, /monedasHotel|monedasServicio/);
    assert.doesNotMatch(page, /hotelesDisp \?\? \[\]\)\.some\(\(h\) => .*moneda === "USD"/);
    assert.doesNotMatch(page, /publicacionDeVinculosGuardados/);
  });
  test("el generador publica con la moneda ELEGIDA y la TRM del paquete (null = no requiere conversión), nunca 0 ni 1", () => {
    assert.match(actions, /paqueteMoneda = ev\.monedaPublicacion;/);
    assert.match(actions, /trm63 = ev\.trm;/);
    assert.match(actions, /let trm63: number \| null = null;/);
    assert.match(actions, /p_trm: trm63,/);
    assert.doesNotMatch(actions, /let trm63 = 0/);
  });
  test("la cotización de la oferta falla cerrado si la evaluación no pasa y toma la TRM de la evaluación", () => {
    assert.match(oferta, /if \(!ev\.ok\) return \{ ok: false, error: mensajeEvaluacion90\(ev\) \}/);
    assert.match(oferta, /const trmOferta = ev\.trm;/);
    assert.doesNotMatch(oferta, /validarTrm63\(/);
  });
  test("la configuración: la moneda se ELIGE (obligatoria fuera del modo 63) y la TRM es opcional", () => {
    assert.match(config, /Elige la moneda de publicación del paquete \(COP o USD\)/);
    assert.match(config, /monedaPublicacion: monedaPub,/);
    assert.doesNotMatch(config, /monedaPub \|\| "COP"/, "ningún COP por omisión en un paquete nuevo");
    assert.match(config, /id != null && initial\?\.modoOferta === "cop_trm_63" \? "COP" : ""/, "solo la LECTURA de un paquete ya guardado interpreta NULL como COP");
    assert.match(config, /trmOferta: modo63 && trmOferta\.trim\(\) !== "" \? Number\(trmOferta\) : null/);
    assert.doesNotMatch(config, /El modo COP exige una TRM positiva/);
  });
});
