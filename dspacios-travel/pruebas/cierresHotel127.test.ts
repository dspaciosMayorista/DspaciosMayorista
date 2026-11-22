// #127 — general hotel closure rule (`hotel_blackouts`): boundaries, partial closures, "from" window, display filter, loader. Expected values are written by hand from the
// business rule (closure endpoints inclusive; the check-out day is not an occupied night), NOT derived from the implementation.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  cargarCierresHoteles, cierreAplica, cierreCubreEstadia, entradaCerrada, estadiaCerrada, resolverCierresEstadia, subventanasEntradaVendible, sumarDiasISO, testigoDesde, ultimaNoche, ventanaSinEntradaVendible, ventanaTocadaPorCierre,
  type CierreHotel,
} from "../lib/tarifario/cierresHotel.ts";
import { filaCerradaPorCierre, filtrarTarifarioVencidas } from "../lib/tarifario/vigencia.ts";

// Owner case: total closure 2026-12-29 → 2027-01-09 (both endpoints are closed nights).
const TOTAL: CierreHotel = { fecha_inicio: "2026-12-29", fecha_fin: "2027-01-09", total: true, acomodaciones: null, categorias: null };
const parcial = (extra: Partial<CierreHotel>): CierreHotel => ({ fecha_inicio: "2026-12-29", fecha_fin: "2027-01-09", total: false, acomodaciones: null, categorias: null, ...extra });

describe("#127 · stay boundaries (any occupied night, inclusive endpoints, check-out is free)", () => {
  const casos: [string, string, number, boolean][] = [
    ["owner stay 30-Dec → 02-Jan (3 nights)", "2026-12-30", 3, true],
    ["check-out exactly on the first closed day (nights 26,27,28)", "2026-12-26", 3, false],
    ["one night enters the closure start (nights 27,28,29)", "2026-12-27", 3, true],
    ["stay of 1 night the day before", "2026-12-28", 1, false],
    ["stay of 2 nights touching the start night", "2026-12-28", 2, true],
    ["last closed night is the first night of the stay", "2027-01-09", 3, true],
    ["first night after the closure", "2027-01-10", 3, false],
    ["stay fully inside", "2026-12-31", 1, true],
    ["stay that wraps the whole closure", "2026-12-20", 30, true],
    ["a long stay that ends the day before the closure starts", "2026-12-20", 9, false],
  ];
  for (const [nombre, ida, noches, cerrada] of casos) {
    test(nombre, () => assert.equal(estadiaCerrada([TOTAL], "Estandar", "doble", ida, noches), cerrada));
  }
  test("one-day closure: only a stay that occupies that night is closed", () => {
    const c: CierreHotel = { fecha_inicio: "2026-12-31", fecha_fin: "2026-12-31", total: true, acomodaciones: null, categorias: null };
    assert.equal(estadiaCerrada([c], "X", "doble", "2026-12-30", 1), false);
    assert.equal(estadiaCerrada([c], "X", "doble", "2026-12-30", 2), true);
    assert.equal(estadiaCerrada([c], "X", "doble", "2026-12-31", 1), true);
    assert.equal(estadiaCerrada([c], "X", "doble", "2027-01-01", 3), false);
  });
  test("date helpers do not depend on the server time zone", () => {
    assert.equal(sumarDiasISO("2026-12-31", 1), "2027-01-01");
    assert.equal(ultimaNoche("2026-12-30", 3), "2027-01-01");
    assert.equal(cierreCubreEstadia(TOTAL, "2026-12-26", 3), false);
  });
  test("no closures or null: never closed", () => {
    assert.equal(estadiaCerrada([], "A", "doble", "2026-12-30", 3), false);
    assert.equal(estadiaCerrada(null, "A", "doble", "2026-12-30", 3), false);
    assert.equal(estadiaCerrada(undefined, "A", null, "2026-12-30", 3), false);
  });
});

describe("#127 · partial closures keep category / accommodation separate", () => {
  const SUITE = parcial({ categorias: ["Suite"] });
  const DOBLE = parcial({ acomodaciones: ["doble"] });
  const SUITE_DOBLE = parcial({ categorias: ["Suite"], acomodaciones: ["doble"] });
  test("category closure: only that category, every accommodation incl. children", () => {
    for (const a of ["sencilla", "doble", "triple", "multiple", "nino", "nino2", "infante"]) {
      assert.equal(estadiaCerrada([SUITE], "Suite", a, "2026-12-30", 3), true, `Suite/${a}`);
      assert.equal(estadiaCerrada([SUITE], "Estandar", a, "2026-12-30", 3), false, `Estandar/${a}`);
    }
  });
  test("accommodation closure: that accommodation in EVERY category; the others stay open", () => {
    assert.equal(estadiaCerrada([DOBLE], "Suite", "doble", "2026-12-30", 3), true);
    assert.equal(estadiaCerrada([DOBLE], "Estandar", "doble", "2026-12-30", 3), true);
    assert.equal(estadiaCerrada([DOBLE], "Estandar", "sencilla", "2026-12-30", 3), false);
    assert.equal(estadiaCerrada([DOBLE], "Estandar", "nino", "2026-12-30", 3), false, "children classes are not closed by a room-accommodation closure");
  });
  test("both lists = intersection", () => {
    assert.equal(estadiaCerrada([SUITE_DOBLE], "Suite", "doble", "2026-12-30", 3), true);
    assert.equal(estadiaCerrada([SUITE_DOBLE], "Suite", "sencilla", "2026-12-30", 3), false);
    assert.equal(estadiaCerrada([SUITE_DOBLE], "Estandar", "doble", "2026-12-30", 3), false);
  });
  test("a non-total closure with both lists empty closes everything (same as the live evaluator)", () => {
    assert.equal(estadiaCerrada([parcial({ acomodaciones: [], categorias: [] })], "Estandar", "doble", "2026-12-30", 3), true);
    assert.equal(cierreAplica({ total: false, acomodaciones: null, categorias: null }, "A", "doble"), true);
  });
  test("unknown accommodation (null) is closed only when EVERY room accommodation is closed for the category", () => {
    assert.equal(estadiaCerrada([DOBLE], "Estandar", null, "2026-12-30", 3), false);
    assert.equal(estadiaCerrada([SUITE], "Suite", null, "2026-12-30", 3), true);
    const union = [parcial({ acomodaciones: ["sencilla", "doble"] }), parcial({ acomodaciones: ["triple", "multiple"] })];
    assert.equal(estadiaCerrada(union, "Estandar", null, "2026-12-30", 3), true, "two closures together close every room");
  });
  test("a partial closure outside the stay does not close it", () => {
    assert.equal(estadiaCerrada([SUITE], "Suite", "doble", "2026-12-26", 3), false);
  });
  test("resolverCierresEstadia exposes totalCerrado separately from partial rules", () => {
    const r = resolverCierresEstadia([SUITE, DOBLE], "2026-12-30", 3);
    assert.equal(r.totalCerrado, false);
    assert.equal(r.cubren.length, 2);
    assert.equal(resolverCierresEstadia([TOTAL], "2026-12-30", 3).totalCerrado, true);
  });
});

describe("#127 · «from» window (porción): closed only when no entry date is sellable", () => {
  test("hand cases (closure 29-Dec → 09-Jan, 3 nights)", () => {
    const v = (d: string, h: string) => ventanaSinEntradaVendible([TOTAL], "E", "doble", d, h, 3);
    assert.equal(v("2026-12-30", "2027-01-05"), true, "every entry inside the closure");
    assert.equal(v("2026-12-28", "2026-12-28"), true, "entry 28-Dec occupies the 29th");
    assert.equal(v("2026-12-26", "2026-12-26"), false, "entry 26-Dec ends on the 28th: sellable");
    assert.equal(v("2026-12-30", "2027-01-10"), false, "10-Jan is a sellable entry");
    assert.equal(v("2026-12-01", "2027-03-31"), false, "plenty of sellable entries");
    assert.equal(v("2027-01-10", "2027-02-01"), false);
  });
  test("agrees with a day-by-day scan on every window/length/closure combination of a small calendar", () => {
    const inicio = "2026-12-20";
    const dia = (n: number) => sumarDiasISO(inicio, n);
    const cierres: CierreHotel[][] = [
      [TOTAL], [parcial({ acomodaciones: ["doble"] })],
      [{ ...TOTAL, fecha_inicio: "2026-12-24", fecha_fin: "2026-12-26" }, { ...TOTAL, fecha_inicio: "2026-12-28", fecha_fin: "2026-12-30" }],
      [{ ...TOTAL, fecha_inicio: "2026-12-22", fecha_fin: "2026-12-22" }],
    ];
    let comparados = 0;
    for (const cs of cierres) for (const noches of [1, 2, 3, 5]) for (let a = 0; a < 30; a++) for (let b = a; b < 30; b++) {
      let hayEntrada = false;
      for (let e = a; e <= b; e++) if (!entradaCerrada(cs, "E", "doble", dia(e), noches)) { hayEntrada = true; break; }
      assert.equal(ventanaSinEntradaVendible(cs, "E", "doble", dia(a), dia(b), noches), !hayEntrada, `${noches} nights window ${dia(a)}..${dia(b)}`);
      comparados++;
    }
    assert.ok(comparados > 1000);
  });
  test("invalid window (end before start) is never reported closed", () => {
    assert.equal(ventanaSinEntradaVendible([TOTAL], "E", "doble", "2027-01-05", "2027-01-01", 3), false);
  });
});

describe("#127 · G1 — «from» windows: touched = every stay of the window, witness = the entry that reproduces the price", () => {
  test("ventanaTocadaPorCierre: a window is touched iff the closure intersects [desde, hasta + noches − 1]", () => {
    const t = (d: string, h: string, n = 3) => ventanaTocadaPorCierre([TOTAL], "E", "doble", d, h, n);
    assert.equal(t("2026-12-01", "2027-03-31"), true);
    assert.equal(t("2026-12-01", "2026-12-26"), false, "last entry 26-Dec ends on the 28th: never reaches the 29th");
    assert.equal(t("2026-12-01", "2026-12-27"), true, "entry 27-Dec occupies the 29th");
    assert.equal(t("2027-01-10", "2027-03-31"), false);
    assert.equal(t("2027-01-09", "2027-01-09"), true, "entry on the last closed night");
    assert.equal(ventanaTocadaPorCierre([], "E", "doble", "2026-12-01", "2027-03-31", 3), false);
  });
  test("testigoDesde: the earliest sellable entry that reproduces the total; none reproduces → null (the row is not published)", () => {
    const precio = (e: string) => (e >= "2026-12-29" && e <= "2027-01-09" ? 225000 : 375000);
    const tramos: [string, string][] = [["2026-12-01", "2026-12-26"], ["2027-01-10", "2027-01-12"]];
    assert.equal(testigoDesde(tramos, precio, 375000), "2026-12-01", "earliest entry wins the tie");
    assert.equal(testigoDesde(tramos, precio, 225000), null, "225.000 only exists on closed entries: no sellable witness");
    assert.equal(testigoDesde([], precio, 375000), null);
    assert.equal(testigoDesde(tramos, () => null, 375000), null, "an entry the engine cannot price is not a witness");
  });
});

describe("#127 · sellable sub-windows feed the «from» search (price engine untouched)", () => {
  test("hand case: closure 29-Dec → 09-Jan, 3 nights, window of entries 01-Dec → 31-Mar leaves two sellable intervals", () => {
    assert.deepEqual(subventanasEntradaVendible([TOTAL], "E", "doble", "2026-12-01", "2027-03-31", 3), [["2026-12-01", "2026-12-26"], ["2027-01-10", "2027-03-31"]]);
  });
  test("no applicable closure = the whole window as ONE interval (unchanged behaviour); everything closed = none; invalid window = none", () => {
    assert.deepEqual(subventanasEntradaVendible([], "E", "doble", "2026-12-01", "2026-12-31", 3), [["2026-12-01", "2026-12-31"]]);
    assert.deepEqual(subventanasEntradaVendible([parcial({ categorias: ["Suite"] })], "Estandar", "doble", "2026-12-01", "2026-12-31", 3), [["2026-12-01", "2026-12-31"]]);
    assert.deepEqual(subventanasEntradaVendible([TOTAL], "E", "doble", "2026-12-30", "2027-01-05", 3), []);
    assert.deepEqual(subventanasEntradaVendible([TOTAL], "E", "doble", "2027-01-05", "2027-01-01", 3), []);
  });
  test("the union of the intervals is EXACTLY the set of entries a day-by-day scan finds sellable", () => {
    const dia = (n: number) => sumarDiasISO("2026-12-20", n);
    const cierres: CierreHotel[][] = [[TOTAL], [{ ...TOTAL, fecha_inicio: "2026-12-24", fecha_fin: "2026-12-26" }, { ...TOTAL, fecha_inicio: "2026-12-28", fecha_fin: "2026-12-30" }], [{ ...TOTAL, fecha_inicio: "2026-12-22", fecha_fin: "2026-12-22" }], [parcial({ acomodaciones: ["doble"] })]];
    let casos = 0;
    for (const cs of cierres) for (const n of [1, 2, 3, 5]) for (let a = 0; a < 30; a += 3) for (let b = a; b < 30; b += 2) {
      const esperadas: string[] = [];
      for (let e = a; e <= b; e++) if (!entradaCerrada(cs, "E", "doble", dia(e), n)) esperadas.push(dia(e));
      const obtenidas: string[] = [];
      for (const [d, h] of subventanasEntradaVendible(cs, "E", "doble", dia(a), dia(b), n)) for (let e = 0; sumarDiasISO(d, e) <= h; e++) obtenidas.push(sumarDiasISO(d, e));
      assert.deepEqual(obtenidas, esperadas, `${n} nights, entries ${dia(a)}..${dia(b)}`);
      casos++;
    }
    assert.ok(casos > 300);
  });
});

describe("#127 · display filter rule for published rows", () => {
  const bloqueo = (extra: Record<string, unknown> = {}) => ({ modulo: "bloqueo", hotel_id: 62, categoria: "Estandar", regimen: "PAM", acomodacion: "doble", fecha_ida: "2026-12-30", fecha_regreso: "2027-01-02", noches: 3, ...extra });
  test("bloqueo row of the owner case is hidden; the same hotel on another stay is not", () => {
    assert.equal(filaCerradaPorCierre(bloqueo(), [TOTAL]), true);
    assert.equal(filaCerradaPorCierre(bloqueo({ fecha_ida: "2026-12-26", fecha_regreso: "2026-12-29" }), [TOTAL]), false);
  });
  test("row of an unaffected hotel is not touched (no closures for it)", () => {
    assert.equal(filaCerradaPorCierre(bloqueo({ hotel_id: 99 }), undefined), false);
    assert.equal(filaCerradaPorCierre(bloqueo({ hotel_id: 99 }), []), false);
  });
  test("accommodation-specific rows follow their own accommodation", () => {
    const c = [parcial({ acomodaciones: ["doble"] })];
    assert.equal(filaCerradaPorCierre(bloqueo({ acomodacion: "doble" }), c), true);
    assert.equal(filaCerradaPorCierre(bloqueo({ acomodacion: "sencilla" }), c), false);
  });
  test("porción «from» row: WITH a sellable witness it lives or dies with that stay; WITHOUT one, any closure touching the window hides it (G1)", () => {
    const porcion = (extra: Record<string, unknown>) => ({ modulo: "porcion_terrestre", hotel_id: 62, categoria: "Estandar", acomodacion: "doble", fecha_ida: "2026-12-01", fecha_regreso: "2027-03-31", noches: 3, ...extra });
    assert.equal(filaCerradaPorCierre(porcion({}), [TOTAL]), true, "no witness + a closure inside the window: an old cheap price cannot be proven, hidden until verified regeneration");
    assert.equal(filaCerradaPorCierre(porcion({ desde_entrada: "2027-01-10" }), [TOTAL]), false, "a regenerated row whose witness stay (10-Jan) is still sellable stays visible");
    assert.equal(filaCerradaPorCierre(porcion({ desde_entrada: "2026-12-30" }), [TOTAL]), true, "the witness stay itself is inside the closure");
    assert.equal(filaCerradaPorCierre(porcion({ desde_entrada: "2026-12-10" }), [TOTAL]), false);
    assert.equal(filaCerradaPorCierre(porcion({ fecha_ida: "2026-12-30", fecha_regreso: "2027-01-05" }), [TOTAL]), true, "a short window entirely inside");
    assert.equal(filaCerradaPorCierre(porcion({ fecha_ida: "2027-02-01", fecha_regreso: "2027-03-31" }), [TOTAL]), false, "a window the closure never touches is unaffected");
    assert.equal(filaCerradaPorCierre(porcion({ categoria: "Suite" }), [parcial({ categorias: ["Estandar"] })]), false, "another category is unaffected");
  });
  test("a row without stay data (services, no dates) is never hidden by this rule", () => {
    assert.equal(filaCerradaPorCierre({ modulo: "servicios", hotel_id: null, fecha_ida: null }, [TOTAL]), false);
    assert.equal(filaCerradaPorCierre(bloqueo({ noches: null }), [TOTAL]), false);
  });
});

// ── Loader and display filter against a fake admin client (counts requests, can fail) ──────────────────────────────────────────────────────────────────────
type Llamada = { tabla: string; filtros: Record<string, unknown>; rango: [number, number] | null };
function adminFalso(opciones: { cierres?: Record<string, unknown>[]; errorCierres?: boolean; pagina?: number }) {
  const llamadas: Llamada[] = [];
  const pagina = opciones.pagina ?? 1000;
  const admin = {
    from(tabla: string) {
      const filtros: Record<string, unknown> = {};
      let rango: [number, number] | null = null;
      const q: Record<string, unknown> = {
        select: () => q, order: () => q,
        in: (c: string, v: unknown) => { filtros[`in:${c}`] = v; return q; },
        gte: (c: string, v: unknown) => { filtros[`gte:${c}`] = v; return q; },
        range: (a: number, b: number) => { rango = [a, b]; return q; },
        then(res: (v: unknown) => unknown) {
          llamadas.push({ tabla, filtros: { ...filtros }, rango });
          if (tabla === "hotel_blackouts") {
            if (opciones.errorCierres) return Promise.resolve({ data: null, error: new Error("boom") }).then(res);
            const todas = opciones.cierres ?? [];
            const [a] = rango ?? [0, 0];
            return Promise.resolve({ data: todas.slice(a, a + pagina), error: null }).then(res);
          }
          return Promise.resolve({ data: [], error: null }).then(res); // hotel_temporadas / tarifa_hotel: empty
        },
      };
      return q;
    },
  };
  return { admin: admin as never, llamadas };
}

describe("#127 · cargarCierresHoteles", () => {
  test("ONE read for many hotels, restricted to closures that have not ended; none when there are no hotels", async () => {
    const f = adminFalso({ cierres: [{ hotel_id: 1, ...TOTAL }, { hotel_id: 2, ...TOTAL }] });
    const r = await cargarCierresHoteles(f.admin, [1, 2, 2, 3], "2026-11-19");
    assert.equal(r.error, null);
    assert.deepEqual([...r.porHotel.keys()].sort(), [1, 2]);
    const lecturas = f.llamadas.filter((l) => l.tabla === "hotel_blackouts");
    assert.equal(lecturas.length, 2, "page 1 with rows + the empty page that ends the pagination");
    assert.deepEqual(lecturas[0].filtros["in:hotel_id"], [1, 2, 3]);
    assert.equal(lecturas[0].filtros["gte:fecha_fin"], "2026-11-19");
    const vacio = adminFalso({});
    assert.equal((await cargarCierresHoteles(vacio.admin, [], "2026-11-19")).porHotel.size, 0);
    assert.equal(vacio.llamadas.length, 0, "no hotels → no request");
  });
  test("paginates by the REAL number of rows received (server may return fewer than a full page)", async () => {
    const cierres = Array.from({ length: 5 }, (_, i) => ({ hotel_id: 7, ...TOTAL, fecha_inicio: `2027-02-0${i + 1}`, fecha_fin: `2027-02-0${i + 1}` }));
    const f = adminFalso({ cierres, pagina: 2 });
    const r = await cargarCierresHoteles(f.admin, [7], "2026-11-19");
    assert.equal(r.porHotel.get(7)?.length, 5);
  });
  test("a read error is returned (callers must fail closed), never an empty map presented as success", async () => {
    const r = await cargarCierresHoteles(adminFalso({ errorCierres: true }).admin, [1], "2026-11-19");
    assert.ok(r.error);
    assert.equal(r.porHotel.size, 0);
  });
});

describe("#127 · filtrarTarifarioVencidas (display filter) with closures", () => {
  const fila = (extra: Record<string, unknown>) => ({ modulo: "bloqueo", hotel_id: 62, categoria: "Estandar", regimen: "PAM", acomodacion: "doble", fecha_ida: "2026-12-30", fecha_regreso: "2027-01-02", noches: 3, ...extra });
  test("only dynamic rows (no season check) still go through the closure read and are hidden when closed", async () => {
    const f = adminFalso({ cierres: [{ hotel_id: 62, ...TOTAL }] });
    const r = await filtrarTarifarioVencidas(f.admin, [fila({ modulo: "dinamico" }), fila({ modulo: "dinamico", fecha_ida: "2026-12-26" }), { modulo: "servicios", hotel_id: null }] as never);
    assert.equal(r.error, null);
    assert.deepEqual(r.filas.map((x) => (x as { modulo: string; fecha_ida?: string }).fecha_ida ?? "servicio"), ["2026-12-26", "servicio"]);
  });
  test("a failure reading closures fails CLOSED: hotel rows hidden, error reported, services untouched", async () => {
    const f = adminFalso({ errorCierres: true });
    const r = await filtrarTarifarioVencidas(f.admin, [fila({ modulo: "dinamico" }), fila({}), { modulo: "servicios", hotel_id: null }] as never);
    assert.ok(r.error);
    assert.equal(r.filas.length, 1);
  });
  test("one closure read for the whole row set, however many rows/hotels (no per-card fan-out)", async () => {
    const f = adminFalso({ cierres: [{ hotel_id: 62, ...TOTAL }] });
    const filas = Array.from({ length: 200 }, (_, i) => fila({ modulo: "dinamico", hotel_id: 60 + (i % 5), fecha_ida: sumarDiasISO("2026-12-01", i % 40) }));
    await filtrarTarifarioVencidas(f.admin, filas as never);
    assert.equal(f.llamadas.filter((l) => l.tabla === "hotel_blackouts").length, 2, "1 page with rows + 1 empty page, regardless of the 200 rows");
  });
});
