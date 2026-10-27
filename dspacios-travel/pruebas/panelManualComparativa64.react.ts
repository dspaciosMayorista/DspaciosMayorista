// Se ejecuta con npm run test:react.
// #64 (ronda 12) — «Agregar» en la COMPARATIVA con el botón real del panel: (1) «Otro servicio» además de «Vuelo», asociado a su grupo (destino + fechas) y sumado UNA vez a cada opción afectada;
// (2) grupos de vuelo ya cubiertos (ida y regreso para todos los pasajeros) fuera del selector, cobertura parcial y ida sola que admite regreso, edición, aviso si todos están cubiertos;
// (3) horas de ida/regreso (HH:mm, hora local de salida), opcionales; (4) acomodaciones: solo la elegida salvo elección expresa.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/tarifario/checkout?modo=comparativa", pretendToBeVisual: true });
// @ts-expect-error -- asignación deliberada de globals de jsdom.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.localStorage = dom.window.localStorage;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
global.cancelAnimationFrame = (id: number) => clearTimeout(id);
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { default: CheckoutPage } = await import("../app/tarifario/checkout/page.tsx");
const { CartProvider, useCart } = await import("../lib/cart/CartContext.tsx");
const stub = await import("./support/stubs/checkoutActionsStub.mjs");
const h = React.createElement;

const CLAVE_CARRITO = "dspacios_cart_v1";
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const sinEspacios = (s: string) => s.replace(/\s+/g, " ");
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const boton = (texto: RegExp | string, raiz: ParentNode = document) =>
  [...raiz.querySelectorAll("button")].find((b) => (typeof texto === "string" ? b.textContent === texto : texto.test(b.textContent ?? ""))) as HTMLButtonElement | undefined;
const porId = (raiz: ParentNode, id: string) => raiz.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement | null;
const todos = (raiz: ParentNode, id: string) => [...raiz.querySelectorAll(`[data-testid="${id}"]`)];

const hotel = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({ id, tipo: "hotel", modulo: "porcion_terrestre", paqueteId: 10 + id.charCodeAt(0), hotelId: id.charCodeAt(0), bloqueoId: null, hotelNombre: nombre, destino: "CARTAGENA", fotoUrl: null, categoria: "Marina Suite", regimen: "Desayuno", fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: 2, precio: 1_200_000, edadesMenores: [], moneda: "COP", ...extra });
const CTG = () => [hotel("a", "Hotel A"), hotel("b", "Hotel B"), hotel("c", "Hotel C")];
const SMR = hotel("s", "Hotel Rodadero", { destino: "SANTA MARTA", fechaIda: "2030-10-20", fechaRegreso: "2030-10-24", precio: 900_000 });
const G_CTG = "grupo:CTG|2030-10-15|2030-10-18", G_SMR = "grupo:SMR|2030-10-20|2030-10-24";
const vuelo = (id: string, hotelRef: string, destino: string, tramo: string, pax: number, extra: Record<string, unknown> = {}) => ({
  id, tipo: "manual", clase: "vuelo", nombre: `Vuelo ${id}`, origen: tramo === "regreso" ? destino : "BOG", destino: tramo === "regreso" ? "BOG" : destino, tramo, hotelRef, hotelEtiqueta: null, pax, precio: 800_000, impuestoNoComisionable: 0, moneda: "COP", fotoUrl: null, noches: null,
  fechaIda: tramo === "regreso" ? null : (destino === "CTG" ? "2030-10-15" : "2030-10-20"), fechaRegreso: tramo === "ida" ? null : (destino === "CTG" ? "2030-10-18" : "2030-10-24"), ...extra,
});

async function montar(items: unknown[]) {
  localStorage.setItem(CLAVE_CARRITO, JSON.stringify(items));
  const container = document.createElement("div");
  document.body.appendChild(container);
  let carrito!: ReturnType<typeof useCart>;
  function Espia() { carrito = useCart(); return null; }
  const root = createRoot(container);
  await act(async () => { root.render(h(CartProvider, null, h(CheckoutPage), h(Espia, null))); await espera(); });
  return { container, carrito: () => carrito, texto: () => sinEspacios(container.textContent ?? ""), desmontar: () => { act(() => root.unmount()); container.remove(); localStorage.clear(); } };
}
type M = Awaited<ReturnType<typeof montar>>;
async function escribir(el: HTMLInputElement | HTMLSelectElement, valor: string) {
  await act(async () => {
    const esSelect = el instanceof window.HTMLSelectElement;
    Object.getOwnPropertyDescriptor(esSelect ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new window.Event(esSelect ? "change" : "input", { bubbles: true }));
    await espera(5);
  });
}
const abrir = async (m: M) => { await act(async () => { click(boton(/^\s*Agregar\s*$/, m.container)!); await espera(); }); };
const guardar = async (m: M) => { await act(async () => { click(boton(/Agregar al carrito|Guardar cambios/, m.container)!); await espera(); }); };
const alerta = (m: M) => m.container.querySelector('section [role="alert"]')?.textContent ?? "";
const manuales = (m: M) => m.carrito().items.filter((i) => i.tipo === "manual") as unknown as Record<string, unknown>[];
const pvps = (m: M) => todos(m.container, "pvp-opcion").map((x) => x.textContent?.replace(/\D/g, ""));
async function agregarVuelo(m: M, v: { tramo?: string; pax?: string; precio?: string; grupo?: string; horaIda?: string; horaRegreso?: string }) {
  await abrir(m);
  if (v.tramo) await escribir(porId(m.container, "man-tramo")!, v.tramo);
  if (v.grupo) await escribir(porId(m.container, "man-hotel")!, v.grupo);
  await escribir(porId(m.container, "man-nombre") as HTMLInputElement, "Tiquete Avianca");
  await escribir(porId(m.container, "man-otra") as HTMLInputElement, "BOG");
  if (v.pax) await escribir(porId(m.container, "man-pax") as HTMLInputElement, v.pax);
  await escribir(porId(m.container, "man-precio") as HTMLInputElement, v.precio ?? "800000");
  if (v.horaIda) await escribir(porId(m.container, "man-hora-ida") as HTMLInputElement, v.horaIda);
  if (v.horaRegreso) await escribir(porId(m.container, "man-hora-regreso") as HTMLInputElement, v.horaRegreso);
  await guardar(m);
}
async function agregarOtro(m: M, v: { grupo?: string; precio?: string; imp?: string; pax?: string } = {}) {
  await abrir(m);
  await escribir(porId(m.container, "man-clase")!, "otro");
  if (v.grupo) await escribir(porId(m.container, "man-hotel")!, v.grupo);
  await escribir(porId(m.container, "man-nombre") as HTMLInputElement, "Traslado privado");
  if (v.pax) await escribir(porId(m.container, "man-pax") as HTMLInputElement, v.pax);
  await escribir(porId(m.container, "man-precio") as HTMLInputElement, v.precio ?? "90000");
  await escribir(porId(m.container, "man-imp") as HTMLInputElement, v.imp ?? "25000");
  await guardar(m);
}
async function llenarCliente(m: M) {
  await act(async () => {
    const set = (label: string, v: string) => {
      const l = [...m.container.querySelectorAll("label")].find((x) => x.textContent === label)!;
      const i = l.parentElement!.querySelector("input") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(i, v);
      i.dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    set("Nombres *", "Ana"); set("Apellidos *", "Pérez"); set("Teléfono / WhatsApp *", "300");
    await espera();
  });
}

describe("Panel «Agregar» de la comparativa", () => {
  before(() => stub.__setContextoAsistencia({ puede: true, aliados: [] }));
  after(() => { stub.__setContextoAsistencia({ puede: false }); stub.__setCrearComparativaCarrito(null); });
  beforeEach(() => { localStorage.clear(); window.history.pushState({}, "", "/tarifario/checkout?modo=comparativa"); stub.__setCrearComparativaCarrito(async () => ({ ok: false, error: "stub" })); });

  describe("«Otro servicio» en una comparativa", () => {
    test("el tipo ofrece Vuelo y Otro servicio; con UN grupo se aplica a todas sus opciones, sin elegir y sumado UNA vez a cada una (sin total global)", async () => {
      const m = await montar(CTG());
      await abrir(m);
      const tipo = porId(m.container, "man-clase") as HTMLSelectElement;
      assert.equal(tipo.disabled, false);
      assert.deepEqual([...tipo.options].map((o) => o.value), ["vuelo", "otro"]);
      await escribir(tipo, "otro");
      assert.equal(porId(m.container, "man-hotel")!.tagName, "P", "un solo grupo: no se pide elegir");
      assert.match(sinEspacios(porId(m.container, "man-hotel")!.textContent ?? ""), /Todas las opciones · CTG/);
      assert.equal(porId(m.container, "man-tramo"), null, "un servicio no tiene tramos");
      assert.equal(porId(m.container, "man-hora-ida"), null, "ni horas");
      await escribir(porId(m.container, "man-nombre") as HTMLInputElement, "Traslado privado");
      await escribir(porId(m.container, "man-precio") as HTMLInputElement, "90000");
      await escribir(porId(m.container, "man-imp") as HTMLInputElement, "25000");
      await guardar(m);
      const [s] = manuales(m);
      assert.deepEqual([s.clase, s.hotelRef, s.pax, s.precio, s.impuestoNoComisionable, s.moneda], ["otro", G_CTG, 2, 90_000, 25_000, "COP"]);
      assert.deepEqual(pvps(m), ["1290000", "1290000", "1290000"], "+90.000 UNA vez a cada opción (1.200.000 + 90.000)");
      assert.doesNotMatch(m.texto(), /Total estimado|Total \(PVP\)|Total del carrito|3\.870\.000/);
      m.desmontar();
    });

    test("con VARIOS grupos se elige el grupo; solo sus opciones lo suman y el servidor recibe el grupo elegido", async () => {
      const m = await montar([CTG()[0], CTG()[1], SMR]);
      await abrir(m);
      await escribir(porId(m.container, "man-clase")!, "otro");
      const sel = porId(m.container, "man-hotel")!;
      assert.equal(sel.tagName, "SELECT", "dos destinos: hay que elegir");
      await escribir(porId(m.container, "man-nombre") as HTMLInputElement, "Entrada parque");
      await escribir(porId(m.container, "man-precio") as HTMLInputElement, "60000");
      await escribir(porId(m.container, "man-imp") as HTMLInputElement, "0");
      await guardar(m);
      assert.match(alerta(m), /Elige a qué grupo/);
      assert.equal(manuales(m).length, 0);
      await escribir(porId(m.container, "man-hotel")!, "s");
      await guardar(m);
      assert.equal(manuales(m)[0].hotelRef, G_SMR);
      const t = todos(m.container, "opcion-comparativa").map((x) => x.textContent?.replace(/\D/g, ""));
      assert.ok(t.at(-1)!.includes("960000"), "la opción de Santa Marta suma el servicio (900.000 + 60.000)");
      assert.ok(t.slice(0, 3).every((x) => !x!.includes("1260000")), "las de Cartagena no lo suman");
      await llenarCliente(m);
      const n0 = stub.__comparativas.length;
      await act(async () => { click(boton(/Generar cotización comparativa/, m.container)!); await espera(80); });
      const enviado = stub.__comparativas[n0] as { manuales: { clase: string; hotelRef: string }[] };
      assert.deepEqual(enviado.manuales.map((x) => [x.clase, x.hotelRef]), [["otro", G_SMR]]);
      m.desmontar();
    });
  });

  describe("grupos de vuelo ya cubiertos", () => {
    test("ida y regreso cubiertos para TODOS los pasajeros: el grupo sale del selector; con uno solo restante se aplica a ese; cubiertos todos, aviso claro y no se puede guardar", async () => {
      const m = await montar([...CTG(), SMR]);
      await agregarVuelo(m, { grupo: "a" });
      assert.equal(manuales(m).length, 1);
      await abrir(m);
      const g = porId(m.container, "man-hotel")!;
      assert.equal(g.tagName, "P", "queda un solo grupo disponible: se aplica sin elegir");
      assert.match(sinEspacios(g.textContent ?? ""), /Todas las opciones · SMR/);
      await act(async () => { click(boton("Cancelar", m.container)!); await espera(); });
      await agregarVuelo(m, {});
      assert.equal(manuales(m).length, 2);
      await abrir(m);
      assert.match(m.container.querySelector('[data-testid="aviso-grupos-cubiertos"]')?.textContent ?? "", /ya tienen cubiertas la ida y el regreso para todos los pasajeros/);
      assert.equal(porId(m.container, "man-hotel"), null, "no hay un selector vacío");
      assert.equal(boton("Agregar al carrito", m.container)!.disabled, true);
      m.desmontar();
    });

    test("cobertura PARCIAL: el grupo sigue disponible para completar los restantes con otra aerolínea; al completarlos sale; un exceso se rechaza", async () => {
      const m = await montar(CTG());
      await agregarVuelo(m, { pax: "1" });
      await abrir(m);
      assert.ok(porId(m.container, "man-hotel"), "el grupo conserva su lugar: falta 1 pasajero");
      assert.equal(m.container.querySelector('[data-testid="aviso-grupos-cubiertos"]'), null);
      await act(async () => { click(boton("Cancelar", m.container)!); await espera(); });
      // Un pasajero más cabe; dos más NO (ya hay 1 de 2).
      await agregarVuelo(m, { pax: "2" });
      assert.match(alerta(m), /cubriría 3 pasajeros y solo viajan 2/);
      assert.equal(manuales(m).length, 1);
      await escribir(porId(m.container, "man-pax") as HTMLInputElement, "1");
      await guardar(m);
      assert.equal(manuales(m).length, 2);
      await abrir(m);
      assert.ok(m.container.querySelector('[data-testid="aviso-grupos-cubiertos"]'), "con 1 + 1 de 2 pasajeros el grupo queda cubierto");
      m.desmontar();
    });

    test("una IDA sola deja el grupo disponible para añadir el REGRESO; un duplicado de ida se rechaza", async () => {
      const m = await montar(CTG());
      await agregarVuelo(m, { tramo: "ida" });
      await abrir(m);
      assert.ok(porId(m.container, "man-hotel"), "la ida no cubre el regreso");
      await escribir(porId(m.container, "man-tramo")!, "ida");
      await escribir(porId(m.container, "man-nombre") as HTMLInputElement, "Otra ida");
      await escribir(porId(m.container, "man-otra") as HTMLInputElement, "MDE");
      await escribir(porId(m.container, "man-precio") as HTMLInputElement, "500000");
      await guardar(m);
      assert.match(alerta(m), /el tramo de ida ya está cubierto/);
      await escribir(porId(m.container, "man-tramo")!, "regreso");
      await guardar(m);
      assert.equal(manuales(m).length, 2);
      assert.deepEqual(manuales(m).map((x) => x.tramo), ["ida", "regreso"]);
      m.desmontar();
    });

    test("al EDITAR un vuelo su propio grupo sigue disponible aunque esté cubierto; se puede guardar el cambio", async () => {
      const m = await montar(CTG());
      await agregarVuelo(m, {});
      await abrir(m);
      assert.ok(m.container.querySelector('[data-testid="aviso-grupos-cubiertos"]'), "cubierto: no se ofrece otro");
      await act(async () => { click(boton("Cancelar", m.container)!); await espera(); });
      await act(async () => { click(m.container.querySelector('button[aria-label^="Editar "]')!); await espera(); });
      assert.equal(m.container.querySelector('[data-testid="aviso-grupos-cubiertos"]'), null, "editando, su grupo está disponible");
      assert.match(sinEspacios(porId(m.container, "man-hotel")!.textContent ?? ""), /Todas las opciones · CTG/);
      await escribir(porId(m.container, "man-precio") as HTMLInputElement, "950000");
      await guardar(m);
      assert.equal(manuales(m).length, 1);
      assert.equal(manuales(m)[0].precio, 950_000);
      m.desmontar();
    });

    test("un «otro servicio» no cuenta como vuelo: no cubre el grupo ni lo oculta", async () => {
      const m = await montar(CTG());
      await agregarOtro(m);
      await abrir(m);
      assert.equal(m.container.querySelector('[data-testid="aviso-grupos-cubiertos"]'), null);
      assert.ok(porId(m.container, "man-hotel"));
      m.desmontar();
    });
  });

  describe("horas de los vuelos", () => {
    test("«Hora de ida» y «Hora de regreso» según los tramos (HH:mm local de salida); opcionales; se conservan en el carrito", async () => {
      const m = await montar(CTG());
      await abrir(m);
      assert.ok(porId(m.container, "man-hora-ida") && porId(m.container, "man-hora-regreso"), "ida y regreso: las dos");
      await escribir(porId(m.container, "man-tramo")!, "ida");
      assert.ok(porId(m.container, "man-hora-ida"));
      assert.equal(porId(m.container, "man-hora-regreso"), null);
      await escribir(porId(m.container, "man-tramo")!, "regreso");
      assert.equal(porId(m.container, "man-hora-ida"), null);
      assert.ok(porId(m.container, "man-hora-regreso"));
      assert.match(m.texto(), /hora local de salida del aeropuerto de/);
      await act(async () => { click(boton("Cancelar", m.container)!); await espera(); });

      await agregarVuelo(m, { tramo: "ida_regreso", pax: "1", horaIda: "06:45", horaRegreso: "18:20" });
      await agregarVuelo(m, { tramo: "ida_regreso", pax: "1" });
      const [a, b] = manuales(m);
      assert.deepEqual([a.horaIda, a.horaRegreso], ["06:45", "18:20"]);
      assert.deepEqual([b.horaIda ?? null, b.horaRegreso ?? null], [null, null], "vacías = horario sin confirmar");
      assert.match(m.texto(), /ida 06:45 · regreso 18:20/);
      m.desmontar();
    });
  });

  describe("acomodaciones", () => {
    test("por defecto NO se piden alternativas; «Ofrecer también otras acomodaciones» es una elección expresa que viaja al servidor", async () => {
      const m = await montar(CTG());
      await llenarCliente(m);
      const n0 = stub.__comparativas.length;
      await act(async () => { click(boton(/Generar cotización comparativa/, m.container)!); await espera(80); });
      assert.equal("otrasAcomodaciones" in (stub.__comparativas[n0] as object), false);
      const casilla = m.container.querySelector('[data-testid="otras-acomodaciones"]') as HTMLInputElement;
      assert.ok(casilla && !casilla.checked);
      await act(async () => { click(casilla); await espera(); });
      await act(async () => { click(boton(/Generar cotización comparativa/, m.container)!); await espera(80); });
      assert.equal((stub.__comparativas[n0 + 1] as { otrasAcomodaciones?: boolean }).otrasAcomodaciones, true);
      m.desmontar();
    });
  });

  describe("límite de pasajeros del grupo = el de la opción con MENOS pasajeros (el que valida el servidor)", () => {
    const A2 = () => hotel("a", "Hotel A", { pax: 2, habitaciones: { doble: 1 } });
    const B4 = () => hotel("b", "Hotel B", { pax: 4, habitaciones: { doble: 2 }, precio: 2_400_000 });

    test("grupo con opciones de 2 y 4 pasajeros: tras cubrir ida y regreso para 2 el grupo SALE del selector (el servidor rechazaría cualquier otro vuelo)", async () => {
      const m = await montar([A2(), B4()]);
      await abrir(m);
      assert.equal(porId(m.container, "man-pax")!.value, "2", "se sugiere el límite del grupo: 2, no 4");
      await act(async () => { click(boton("Cancelar", m.container)!); await espera(); });
      await agregarVuelo(m, {});
      assert.equal(manuales(m).length, 1);
      assert.equal(manuales(m)[0].pax, 2);
      await abrir(m);
      assert.ok(m.container.querySelector('[data-testid="aviso-grupos-cubiertos"]'), "con 2 pasajeros cubiertos el grupo ya no se ofrece");
      assert.equal(porId(m.container, "man-hotel"), null);
      assert.equal(boton("Agregar al carrito", m.container)!.disabled, true);
      m.desmontar();
    });

    test("cobertura parcial en ese grupo (1 de 2) sigue disponible y se completa con otra aerolínea; un vuelo de más pasajeros que el límite se rechaza en pantalla", async () => {
      const m = await montar([A2(), B4()]);
      await agregarVuelo(m, { pax: "1" });
      await abrir(m);
      assert.ok(porId(m.container, "man-hotel"), "falta 1 pasajero (límite 2)");
      await escribir(porId(m.container, "man-nombre") as HTMLInputElement, "Otra aerolínea");
      await escribir(porId(m.container, "man-otra") as HTMLInputElement, "MDE");
      await escribir(porId(m.container, "man-pax") as HTMLInputElement, "3");
      await escribir(porId(m.container, "man-precio") as HTMLInputElement, "700000");
      await guardar(m);
      assert.match(alerta(m), /solo 2|cubriría 4 pasajeros y solo viajan 2/, "3 pasajeros no caben en la opción de 2");
      await escribir(porId(m.container, "man-pax") as HTMLInputElement, "1");
      await guardar(m);
      assert.equal(manuales(m).length, 2);
      await abrir(m);
      assert.ok(m.container.querySelector('[data-testid="aviso-grupos-cubiertos"]'), "1 + 1 = 2: cubierto");
      m.desmontar();
    });

    test("al elegir otro grupo se sugieren SUS pasajeros; una cantidad editada expresamente no se sobrescribe", async () => {
      const S3 = hotel("s", "Hotel Rodadero", { destino: "SANTA MARTA", fechaIda: "2030-10-20", fechaRegreso: "2030-10-24", pax: 3, habitaciones: { triple: 1 }, precio: 900_000 });
      const m = await montar([A2(), B4(), S3]);
      await abrir(m);
      const sel = porId(m.container, "man-hotel") as HTMLSelectElement;
      assert.equal(sel.tagName, "SELECT");
      await escribir(sel, "s");
      assert.equal(porId(m.container, "man-pax")!.value, "3", "grupo Santa Marta: 3");
      await escribir(sel, "a");
      assert.equal(porId(m.container, "man-pax")!.value, "2", "grupo Cartagena: el menor de 2 y 4");
      await escribir(porId(m.container, "man-pax") as HTMLInputElement, "1");
      await escribir(sel, "s");
      assert.equal(porId(m.container, "man-pax")!.value, "1", "lo que el usuario editó no se pisa");
      await act(async () => { click(boton("Cancelar", m.container)!); await espera(); });
      await abrir(m);
      await escribir(porId(m.container, "man-hotel") as HTMLSelectElement, "s");
      assert.equal(porId(m.container, "man-pax")!.value, "3", "un formulario nuevo vuelve a sugerir");
      m.desmontar();
    });
  });
});
