// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// #126-B (cargo explícito de menores en alojamiento por unidad) y #126-D (etiqueta de promoción) en los COMPONENTES REALES, jsdom.
//  · B: Vista tabla por unidad — edad/clase de cada menor y si va incluido / cargo propio / paga como adulto; el total de la unidad no cambia ni se reparte por persona.
//  · D: el motor real (`evaluarComposicionHotel`) trae `promocion` desde `promosPorAcom`; la tabla y la tarjeta de Booking solo la pintan si ganó.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createElement as hh, type ComponentType } from "react";
import type { AcomConfig } from "../lib/acomodaciones.ts";
import type { ComboCotizado } from "../lib/reservar/liquidacionHotel.ts";
import { evaluarComposicionHotel, type ComboEvaluado, type EntradaComposicion } from "../lib/reservar/composicionHotelBusqueda.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
// @ts-expect-error -- asignación deliberada de globals de jsdom.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle;
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.getBoundingClientRect = function () { return { width: 900, height: 40, top: 0, left: 0, right: 900, bottom: 40, x: 0, y: 0, toJSON() {} }; };
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
after(() => dom.window.close());

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { renderToStaticMarkup } = await import("react-dom/server");
const { act } = React;
const { TablaResultadosBusqueda } = await import("../app/tarifario/TablaResultadosBusqueda.tsx");
const { Resultado } = await import("../app/tarifario/BuscadorBooking.tsx");
const { CartProvider } = await import("../lib/cart/CartContext.tsx");
const h = React.createElement;

async function montar(el: unknown) {
  const cont = document.createElement("div"); document.body.appendChild(cont);
  const root = createRoot(cont);
  await act(async () => { root.render(el as never); });
  return { cont, cerrar: async () => { await act(async () => root.unmount()); cont.remove(); } };
}
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

// ═══ B · alojamiento por unidad ═══════════════════════════════════════════════════════════════════════════
const opcion = (over: Record<string, unknown> = {}) => ({
  hotelId: 10311, hotelNombre: "U1 · Hotel por unidad", paqueteId: 10311, paqueteNombre: "Porción U1", destinoNombre: "CARTAGENA U1", categoria: "Estandar", alimentacion: "PAM",
  moneda: "COP", precioVenta: 1_518_750, paxTotal: 3, fechaIda: "2030-06-10", fechaRegreso: "2030-06-13",
  ocupacion: [{ id: "h1", acom: "doble" as const, adultos: 2, edadesMenores: [8] as number[] }], ...over,
});
const estadoUnidad = (o: unknown) => ({
  destino: "CARTAGENA U1", fechaIda: "2030-06-10", fechaRegreso: "2030-06-13", resultados: [], diagnostico: "x", sugerenciasFecha: [],
  unidad: [{ hotelId: 10311, estado: "disponible", opciones: [o] }], avisoUnidad: null, enRevision: [], ocupacion: { numHabitaciones: 1, adultos: 2, edadesMenores: [8] },
});

describe("#126-B — Vista tabla por unidad: cada menor con su edad/clase y su cargo", () => {
  test("niño con cargo propio: edad, importe y base (por noche, incluido en el total); el total de la unidad es el mismo y no se reparte por persona", async () => {
    const o = opcion({ menores: [{ habitacion: 1, edad: 8, clase: "nino", cobro: "por_noche", cargoVenta: 168_750, noches: 3 }] });
    const m = await montar(h(TablaResultadosBusqueda, { estado: estadoUnidad(o) as never }));
    const li = [...m.cont.querySelectorAll('[data-testid="menor-unidad"]')];
    assert.equal(li.length, 1);
    assert.match(norm(li[0].textContent), /^Niño de 8 años: cargo propio \$\s?168\.750 en total \(se cobra por noche, 3 noches; ya incluido en el total\)$/);
    assert.equal(li[0].getAttribute("data-cobro"), "por_noche");
    const t = norm(m.cont.querySelector('[data-testid="tabla-unidad"]')!.textContent);
    assert.match(t, /\$\s?1\.518\.750/, "el total autoritativo de la unidad no cambia");
    // O-2: el equivalente por adulto existe, pero SOLO como lectura informativa de la base de la unidad (1.518.750 − 168.750 = 1.350.000 ÷ 2 = 675.000); nunca una tarifa de adulto vendible.
    assert.doesNotMatch(t, /Tarifa de adulto/, "nunca una tarifa por persona inventada");
    assert.match(t, /Base de la unidad\s*\$\s?1\.350\.000/);
    assert.match(t, /equivalente informativo ≈ \$\s?675\.000 c\/u \(base ÷ 2; el precio real es por unidad, no por persona\)/);
    assert.match(t, /Total de la reserva\s*\$\s?1\.518\.750/);
    await m.cerrar();
  });

  test("niño incluido, infante con cargo por estadía y menor que paga como adulto: tres formas distintas y honestas", async () => {
    const o = opcion({
      ocupacion: [{ id: "h1", acom: "doble" as const, adultos: 2, edadesMenores: [8, 2, 14] }], paxTotal: 5,
      menores: [
        { habitacion: 1, edad: 8, clase: "nino", cobro: "incluido", cargoVenta: null, noches: 3 },
        { habitacion: 1, edad: 2, clase: "infante", cobro: "por_estadia", cargoVenta: 30_000, noches: 3 },
        { habitacion: 1, edad: 14, clase: "como_adulto", cobro: "como_adulto", cargoVenta: null, noches: 3 },
      ],
    });
    const m = await montar(h(TablaResultadosBusqueda, { estado: estadoUnidad(o) as never }));
    const textos = [...m.cont.querySelectorAll('[data-testid="menor-unidad"]')].map((l) => norm(l.textContent));
    assert.equal(textos.length, 3);
    assert.match(textos[1], /^Infante de 2 años: cargo propio \$\s?30\.000 una sola vez por toda la estadía \(ya incluido en el total\)$/);
    assert.match(textos[0], /incluido en la unidad, sin cargo propio/);
    assert.match(textos[2], /paga como adulto/);
    await m.cerrar();
  });

  test("sin menores no hay lista; una opción sin el campo (histórica) tampoco rompe ni inventa nada", async () => {
    const m = await montar(h(TablaResultadosBusqueda, { estado: estadoUnidad(opcion({ ocupacion: [{ id: "h1", acom: "doble" as const, adultos: 2, edadesMenores: [] }], paxTotal: 2 })) as never }));
    assert.equal(m.cont.querySelectorAll('[data-testid="menores-unidad"]').length, 0);
    await m.cerrar();
  });

  test("varias habitaciones: cada menor lleva su número de habitación", async () => {
    const o = opcion({ menores: [
      { habitacion: 1, edad: 8, clase: "nino", cobro: "incluido", cargoVenta: null, noches: 3 },
      { habitacion: 2, edad: 5, clase: "nino", cobro: "por_noche", cargoVenta: 90_000, noches: 3 },
    ] });
    const m = await montar(h(TablaResultadosBusqueda, { estado: estadoUnidad(o) as never }));
    const textos = [...m.cont.querySelectorAll('[data-testid="menor-unidad"]')].map((l) => norm(l.textContent));
    assert.match(textos[0], /^Hab\. 1 · Niño de 8 años/);
    assert.match(textos[1], /^Hab\. 2 · Niño de 5 años: cargo propio/);
    await m.cerrar();
  });
});

// ═══ D · etiqueta de promoción con el motor real ══════════════════════════════════════════════════════════
const CFG: AcomConfig[] = [{ acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 2, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 }];
const BASE = { pctMk: 0.2, impuesto: 0, vuelo: 0, vueloNeto: null, feeInfante: 0, servicios: [] };
function comboCotizado(over: Partial<ComboCotizado>): ComboCotizado {
  return { categoria: "Estandar", regimen: "PAM", temporadasTarifaPorAcom: {}, precios: { doble: 125_000 }, netos: { doble: 100_000 }, ...over } as ComboCotizado;
}
function motor(c: ComboCotizado): ComboEvaluado {
  const e: EntradaComposicion = {
    res: { combos: [c], serviciosGrupoIncluidos: [], composicionBase: BASE as never, moneda: "COP" } as never,
    filasTarifa: [], pctMk: 0.2, numNoches: 3, adultos: 2, edades: [], reglasAcom: CFG, generalEdad: { infanteMin: 0, infanteMax: 2, ninoMin: 3, ninoMax: 10 }, numHabitaciones: 1,
  };
  const r = evaluarComposicionHotel(e);
  assert.equal(r.combos.length, 1, `el motor debe ofrecer el combo (${r.rechazos.join(" | ")})`);
  return r.combos[0];
}
function estadoPersona(c: ComboEvaluado) {
  const r = {
    hotelId: 912503, hotelNombre: "Hotel PRE BF", destino: "DEMO", paqueteId: 912503, paqueteNombre: "Paquete", categoria: c.categoria, regimen: c.regimen, total: c.total, noches: 3, moneda: "COP",
    fechaIda: "2026-12-04", fechaRegreso: "2026-12-07", habitaciones: c.habitaciones, menores: c.menores, edadesMenores: c.edadesMenores, edadesComoAdulto: c.edadesComoAdulto, pax: c.pax, combos: [c], condicion: null,
  };
  return { destino: "DEMO", fechaIda: "2026-12-04", fechaRegreso: "2026-12-07", resultados: [r], diagnostico: null, sugerenciasFecha: [], unidad: [], avisoUnidad: null, enRevision: [], ocupacion: { numHabitaciones: 1, adultos: 2, edadesMenores: [] as number[] } };
}
const etiquetaPromo = (cont: ParentNode) => [...cont.querySelectorAll('[data-testid="etiqueta-promocion-hotel"]')].map((e) => norm(e.textContent));

describe("#126-D — la tabla pinta la promoción que ganó, con su alcance, y nada más", () => {
  test("promoción que cubre toda la estadía: una etiqueta «Promoción PRE BF» junto al total", async () => {
    const c = motor(comboCotizado({ promosPorAcom: { doble: [{ nombre: "PRE BF", alcance: "toda" }] } }));
    assert.equal(c.promocion?.etiqueta, "Promoción PRE BF");
    const m = await montar(h(TablaResultadosBusqueda, { estado: estadoPersona(c) as never }));
    assert.deepEqual(etiquetaPromo(m.cont), ["Promoción PRE BF"]);
    await m.cerrar();
  });

  test("promoción solo en algunas noches: lo dice (nunca sugiere que toda la estadía está descontada)", async () => {
    const c = motor(comboCotizado({ promosPorAcom: { doble: [{ nombre: "PRE BF", alcance: "algunas_noches" }] } }));
    const m = await montar(h(TablaResultadosBusqueda, { estado: estadoPersona(c) as never }));
    assert.deepEqual(etiquetaPromo(m.cont), ["Promoción PRE BF · solo en algunas noches"]);
    await m.cerrar();
  });

  test("promoción configurada pero que no ganó (sin promosPorAcom o lista vacía): sin etiqueta y sin contenedor de etiquetas", async () => {
    for (const promos of [undefined, { doble: [] }]) {
      const c = motor(comboCotizado(promos ? { promosPorAcom: promos } : {}));
      assert.equal(c.promocion ?? null, null);
      const m = await montar(h(TablaResultadosBusqueda, { estado: estadoPersona(c) as never }));
      assert.equal(etiquetaPromo(m.cont).length, 0);
      assert.equal(m.cont.querySelectorAll('[data-testid="etiquetas-oferta"]').length, 0);
      await m.cerrar();
    }
  });

  test("EBB / Long Stay y promoción conviven sin mezclarse: dos etiquetas, cada una con su texto", async () => {
    const c = motor(comboCotizado({ promosPorAcom: { doble: [{ nombre: "PRE BF", alcance: "toda" }] } }));
    (c as { descuento?: unknown }).descuento = { etiqueta: "EBB 1 · 30+ días · 18 %", tipo: "ebb", umbral: 30, pct: 18 };
    const m = await montar(h(TablaResultadosBusqueda, { estado: estadoPersona(c) as never }));
    assert.deepEqual([...m.cont.querySelectorAll('[data-testid="etiqueta-descuento-hotel"]')].map((e) => norm(e.textContent)), ["EBB 1 · 30+ días · 18 %"]);
    assert.deepEqual(etiquetaPromo(m.cont), ["Promoción PRE BF"]);
    await m.cerrar();
  });

  test("la etiqueta nunca habla de niños: un niño que paga no se anuncia como gratis", () => {
    const c = motor(comboCotizado({ promosPorAcom: { doble: [{ nombre: "PRE BF", alcance: "toda" }] } }));
    assert.doesNotMatch(c.promocion?.etiqueta ?? "", /niñ|gratis/i);
  });
});

describe("#126-D — tarjeta de Booking: la etiqueta es la del combo SELECCIONADO, no la del más barato", () => {
  const html = (r: unknown) => renderToStaticMarkup(hh(CartProvider as ComponentType<{ children: unknown }>, null, hh(Resultado as ComponentType<Record<string, unknown>>, {
    r, foto: null, info: { estrellas: 4, clasificacion: null, descripcion: null, ubicacion: null, adultsOnly: false, petFriendly: false }, descripcionPorPaquete: {}, addonsPorPaquete: new Map(),
  })));
  const doc = (s: string) => new JSDOM(`<body>${s}</body>`).window.document;
  const combo = (categoria: string, total: number, extra: Record<string, unknown>) => ({ categoria, regimen: "PAM", total, pax: 2, menores: { infantes: 0, nino: 0, nino2: 0 }, ...extra });
  const r = (combos: unknown[], extra: Record<string, unknown> = {}) => ({
    hotelId: 72, hotelNombre: "Hotel Booking", destino: "San Andrés", paqueteId: 61, categoria: "Estandar", regimen: "PAM", paqueteNombre: "Paquete", total: 800_000, noches: 3, moneda: "COP",
    fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", habitaciones: { doble: 1 }, menores: { infantes: 0, nino: 0, nino2: 0 }, edadesMenores: [], pax: 2, combos, condicion: null, ...extra,
  });

  test("combo más barato con promoción: la tarjeta (que arranca en él) la muestra con su alcance", () => {
    const d = doc(html(r([combo("Estandar", 800_000, { promocion: { etiqueta: "Promoción PRE BF", promociones: [] } }), combo("Superior", 1_000_000, {})])));
    assert.deepEqual([...d.querySelectorAll('[data-testid="etiqueta-promocion-hotel"]')].map((e) => norm(e.textContent)), ["Promoción PRE BF"]);
  });

  test("sin promoción ganadora en el combo seleccionado: ninguna etiqueta aunque otro combo la tenga", () => {
    const d = doc(html(r([combo("Estandar", 800_000, { promocion: null }), combo("Superior", 1_000_000, { promocion: { etiqueta: "Promoción PRE BF", promociones: [] } })])));
    assert.equal(d.querySelectorAll('[data-testid="etiqueta-promocion-hotel"]').length, 0);
  });
});
