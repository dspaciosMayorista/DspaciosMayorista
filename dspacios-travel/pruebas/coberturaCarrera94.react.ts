// Se ejecuta con el loader React (jsdom + esbuild), no con test:unit.
//
// #94/#52 — Carreras del hook `useCoberturaNormal` (componente real sobre jsdom, consulta de cupos simulada con PROMESAS DEMORADAS):
//   · una respuesta de cupos solo vale para la entrada exacta que la originó: mientras llega la de la entrada nueva no hay cupos, ni selección, ni cobertura que enviar;
//   · las respuestas fuera de orden se descartan;
//   · en StrictMode (efecto montado → limpiado → montado) la segunda ejecución vuelve a pedir y la respuesta se aplica.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/tarifario/checkout", pretendToBeVisual: true });
// @ts-expect-error -- asignación deliberada de globals de jsdom.
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.localStorage = dom.window.localStorage;
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const { useCoberturaNormal } = await import("../app/tarifario/checkout/CoberturaServicios.tsx");
const stub = await import("./support/stubs/checkoutActionsStub.mjs");
const h = React.createElement;

type Hab = { doble?: number; sencilla?: number };
type Servicio = { id: string; nombre: string; pax: number; tipo: "tour"; indice: number; ligado: boolean };
const espera = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

const entradaDe = (hab: Hab) => ({ items: [{ habitaciones: hab }] });
const paxDe = (hab: Hab) => (hab.doble ?? 0) * 2 + (hab.sencilla ?? 0);
function respuestaDe(hab: Hab) {
  const cupos = [
    ...(hab.doble ? [{ clave: "adulto:doble", tipo: "adulto", etiqueta: "Adulto · Doble", cantidad: hab.doble * 2 }] : []),
    ...(hab.sencilla ? [{ clave: "adulto:sencilla", tipo: "adulto", etiqueta: "Adulto · Sencilla", cantidad: hab.sencilla }] : []),
  ];
  return { ok: true, hoteles: [{ posicion: 0, hotel: "Hotel", paxTotal: paxDe(hab), cupos }] };
}

// Cada llamada queda registrada con su promesa para resolverla a mano y en el orden que se quiera.
type Llamada = { hab: Hab; resolver: () => void };
let llamadas: Llamada[] = [];
let modo: "inmediato" | "demorado" = "demorado";
stub.__setCuposDeCarrito(async (entrada: { items: { habitaciones: Hab }[] }) => {
  const hab = entrada.items[0].habitaciones;
  if (modo === "inmediato") return respuestaDe(hab);
  return new Promise((res) => { llamadas.push({ hab, resolver: () => res(respuestaDe(hab)) }); });
});

const SERVICIO: Servicio = { id: "tB", nombre: "City tour", pax: 2, tipo: "tour", indice: 0, ligado: false };
type Salida = ReturnType<typeof useCoberturaNormal>;
function Arnes(p: { hab: Hab; servicios: Servicio[]; salida: { actual: Salida | null } }) {
  const r = useCoberturaNormal({
    activo: true, hotelId: "h1", huella: "H", hotelesVigentes: ["h1"], entrada: entradaDe(p.hab), servicios: p.servicios, paxHotel: paxDe(p.hab),
  });
  p.salida.actual = r;
  return r.panel;
}

async function montar(hab: Hab, opciones: { estricto?: boolean; servicios?: Servicio[] } = {}) {
  localStorage.clear();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const salida: { actual: Salida | null } = { actual: null };
  const servicios = opciones.servicios ?? [SERVICIO];
  const root = createRoot(container);
  const dibujar = async (nueva: Hab) => {
    const el = h(Arnes, { hab: nueva, servicios, salida });
    await act(async () => { root.render(opciones.estricto ? h(React.StrictMode, null, el) : el); await espera(); });
  };
  await dibujar(hab);
  return { container, salida, dibujar, desmontar: () => { act(() => root.unmount()); container.remove(); localStorage.clear(); } };
}
const casillas = (raiz: HTMLElement) => [...raiz.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const marcar = async (el: HTMLInputElement) => { await act(async () => { click(el); await espera(); }); };
const resolver = async (...ls: Llamada[]) => { for (const l of ls) await act(async () => { l.resolver(); await espera(); }); };

beforeEach(() => { llamadas = []; modo = "demorado"; stub.__cupos.length = 0; });

describe("#94 carreras de la consulta de cupos", () => {
  test("StrictMode: tras limpiar el efecto la segunda ejecución vuelve a pedir y la respuesta se aplica", async () => {
    modo = "inmediato";
    const m = await montar({ doble: 1, sencilla: 1 }, { estricto: true });
    assert.ok(stub.__cupos.length >= 2, `StrictMode monta, limpia y monta de nuevo: ${stub.__cupos.length} peticiones`);
    assert.equal(casillas(m.container).length, 3, "la respuesta se aplicó: aparecen los 3 pasajeros");
    assert.match(m.salida.actual!.bloqueo ?? "", /marca 2/, "ya con cupos, la cobertura parcial exige elegir");
    m.desmontar();
  });

  test("StrictMode con respuestas DEMORADAS: la petición de la primera ejecución se descarta y la segunda es la que vale", async () => {
    const m = await montar({ doble: 1, sencilla: 1 }, { estricto: true });
    assert.ok(llamadas.length >= 2);
    assert.equal(casillas(m.container).length, 0, "nada aplicado mientras no llega");
    assert.match(m.salida.actual!.bloqueo ?? "", /Calculando/);
    await resolver(...llamadas);
    assert.equal(casillas(m.container).length, 3);
    m.desmontar();
  });

  test("editar habitaciones y tratar de emitir ANTES de que llegue la consulta nueva: bloqueado y sin cobertura con cupos anteriores", async () => {
    modo = "inmediato";
    const m = await montar({ doble: 1, sencilla: 2 });
    await marcar(casillas(m.container).find((c) => /Sencilla · pasajero 1/.test(c.getAttribute("aria-label") ?? ""))!);
    await marcar(casillas(m.container).find((c) => /Sencilla · pasajero 2/.test(c.getAttribute("aria-label") ?? ""))!);
    assert.equal(m.salida.actual!.bloqueo, null, "con la entrada 1 resuelta se puede emitir");
    assert.ok(m.salida.actual!.cobertura, "y trae cobertura");

    modo = "demorado";
    await m.dibujar({ doble: 2, sencilla: 2 }); // el carrito cambió; la respuesta nueva aún no llega
    assert.match(m.salida.actual!.bloqueo ?? "", /Calculando los pasajeros/, "no se puede emitir con parcial");
    assert.equal(m.salida.actual!.cobertura, null, "no se declara cobertura con cupos de la entrada anterior");
    assert.equal(casillas(m.container).length, 0, "tampoco se muestran los pasajeros viejos");

    await resolver(llamadas[llamadas.length - 1]);
    assert.equal(m.salida.actual!.bloqueo, null, "con la respuesta nueva reconciliada, la selección se conserva");
    assert.deepEqual((m.salida.actual as Salida).cobertura!.cupos[0], { "adulto:doble": [1, 2, 3, 4], "adulto:sencilla": [1, 2] });
    assert.deepEqual((m.salida.actual as Salida).cobertura!.tours[0], { hotel: 0, cubre: ["adulto:sencilla#1", "adulto:sencilla#2"] });
    m.desmontar();
  });

  test("respuestas FUERA DE ORDEN: la de la entrada vieja llega después de la nueva y se descarta", async () => {
    const m = await montar({ doble: 1, sencilla: 1 }); // petición 1 (entrada A) pendiente
    await m.dibujar({ doble: 2, sencilla: 1 }); //          petición 2 (entrada B) pendiente
    const [a, b] = [llamadas[0], llamadas[llamadas.length - 1]];
    assert.notEqual(a.hab.doble, b.hab.doble);
    await resolver(b); // llega primero la nueva
    assert.equal(casillas(m.container).length, 5, "se muestran los pasajeros de la entrada B");
    await resolver(a); // llega tarde la vieja
    assert.equal(casillas(m.container).length, 5, "la respuesta atrasada no pisa a la vigente");
    assert.deepEqual(m.salida.actual!.cobertura!.cupos[0], { "adulto:doble": [1, 2, 3, 4], "adulto:sencilla": [1] });
    const guardado = JSON.parse(localStorage.getItem("cobertura94") ?? "{}").h1;
    assert.deepEqual(guardado.estado.activos, { "adulto:doble": [1, 2, 3, 4], "adulto:sencilla": [1] }, "lo guardado es lo reconciliado con la vigente");
    m.desmontar();
  });

  test("respuestas fuera de orden en el sentido contrario (la vieja primero, luego la nueva) terminan igual en la entrada vigente", async () => {
    const m = await montar({ doble: 1, sencilla: 1 });
    await m.dibujar({ doble: 2, sencilla: 1 });
    const [a, b] = [llamadas[0], llamadas[llamadas.length - 1]];
    await resolver(a);
    assert.equal(casillas(m.container).length, 0, "la respuesta de la entrada anterior no se usa ni siquiera si llega antes");
    assert.match(m.salida.actual!.bloqueo ?? "", /Calculando/);
    await resolver(b);
    assert.equal(casillas(m.container).length, 5);
    m.desmontar();
  });

  test("si la consulta de la entrada vigente falla, un servicio parcial queda bloqueado (no se usan cupos anteriores)", async () => {
    modo = "inmediato";
    const m = await montar({ doble: 1, sencilla: 1 });
    assert.equal(casillas(m.container).length, 3);
    stub.__setCuposDeCarrito(async () => ({ ok: false, error: "fallo de prueba" }));
    await m.dibujar({ doble: 2, sencilla: 1 });
    assert.match(m.salida.actual!.bloqueo ?? "", /fallo de prueba/);
    assert.equal(m.salida.actual!.cobertura, null);
    m.desmontar();
  });
});
