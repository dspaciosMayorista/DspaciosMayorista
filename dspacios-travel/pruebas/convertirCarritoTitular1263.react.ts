// Se ejecuta con npm run test:react (loader TSX), no con test:unit.
// O-3 — el titular que el aliado escribió en el checkout llega como pasajero 1 al convertir la cotización del carrito, con SU tipo de documento
// (antes la fila nacía siempre como «CC» aunque el aliado hubiera elegido otro). Un tipo que la reserva no admite para un pasajero (NIT/PPT) deja el
// documento por capturar; sin tipo elegido queda «CC» como siempre. No se inventan pasajeros: las demás filas siguen vacías.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
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
const { ConvertirCarritoBtn } = await import("../app/(dashboard)/dashboard/cotizaciones/[id]/ConvertirCarritoBtn.tsx");
const h = React.createElement;
const espera = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const boton = (texto: RegExp, raiz: ParentNode = document) => [...raiz.querySelectorAll("button")].find((b) => texto.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
after(() => dom.window.close());

const base = {
  id: 1, pax: 2,
  items: [{ hotelNombre: "Hotel Almirante", destino: "CARTAGENA", pax: 2, fechaIda: "2030-03-01" }],
  tours: [], destinos: ["CARTAGENA"],
  esSuperadmin: true, asesores: [], miNombre: "", miRolVenta: false,
};

async function abrirCaptura(cliente: Record<string, string>) {
  const c = document.createElement("div"); document.body.appendChild(c);
  const r = createRoot(c);
  await act(async () => { r.render(h(ConvertirCarritoBtn, { ...base, cliente } as never)); await espera(); });
  await act(async () => { click(boton(/Confirmar → generar contrato/, c)!); await espera(); });
  // Corrección 2: las filas completas llegan compactas (resumen + «Editar»); aquí se reabren para comprobar que reabrir muestra los datos intactos.
  await act(async () => { for (const b of [...c.querySelectorAll('[data-testid="editar-pasajero"]')]) click(b); await espera(); });
  const tipos = [...c.querySelectorAll("select")].filter((s) => [...s.options].some((o) => o.value === "PAS")) as HTMLSelectElement[];
  const docs = [...c.querySelectorAll("label")].filter((l) => /^N° doc$/.test(l.textContent ?? "")).map((l) => l.parentElement!.querySelector("input")).filter(Boolean) as HTMLInputElement[];
  const nombres = [...c.querySelectorAll("label")].filter((l) => l.textContent === "Nombres").map((l) => l.parentElement!.querySelector("input")!) as HTMLInputElement[];
  return { c, r, tipos, docs, nombres };
}

describe("ConvertirCarritoBtn — el titular del checkout llega como pasajero 1", () => {
  test("con tipo CE: la fila 1 trae CE, nombre y número del titular; la fila 2 queda vacía (nadie se inventa)", async () => {
    const { r, tipos, docs, nombres } = await abrirCaptura({ nombres: "Ana", apellidos: "Pérez", numeroDoc: "A123456", tipoDoc: "CE" });
    assert.equal(tipos[0].value, "CE");
    assert.equal(nombres[0].value, "Ana");
    assert.equal(docs[0].value, "A123456");
    assert.equal(tipos[1].value, "CC", "el pasajero 2 no hereda nada del titular");
    assert.equal(nombres[1].value, "");
    await act(async () => r.unmount());
  });
  test("con pasaporte: la fila 1 trae PAS", async () => {
    const { r, tipos } = await abrirCaptura({ nombres: "Ana", apellidos: "Pérez", numeroDoc: "AB123", tipoDoc: "PAS" });
    assert.equal(tipos[0].value, "PAS");
    await act(async () => r.unmount());
  });
  test("con un tipo que la reserva no admite para pasajeros (NIT): el nombre pasa, el documento queda por capturar", async () => {
    const { r, tipos, docs, nombres } = await abrirCaptura({ nombres: "Ana", apellidos: "Pérez", numeroDoc: "900123456", tipoDoc: "NIT" });
    assert.equal(nombres[0].value, "Ana");
    assert.equal(tipos[0].value, "CC");
    assert.equal(docs[0].value, "", "no se copia un NIT como documento de pasajero");
    await act(async () => r.unmount());
  });
  test("sin tipo elegido en el checkout: «CC» con el número escrito, como siempre", async () => {
    const { r, tipos, docs } = await abrirCaptura({ nombres: "Ana", apellidos: "Pérez", numeroDoc: "1032", tipoDoc: "" });
    assert.equal(tipos[0].value, "CC");
    assert.equal(docs[0].value, "1032");
    await act(async () => r.unmount());
  });
});

// Corrección 3 — «Agregar pasajero» según el universo DECLARADO (ver lib/reservar/universoViajeros.ts): una sola unidad ⇒ exacto; dos o más unidades independientes ⇒ ambiguo
// (el tope NO es el máximo ni la suma «como universo»; la suma solo es una cota de seguridad), y un tour vinculado a un hotel no es una unidad aparte.
async function abrirCon(extra: Record<string, unknown>) {
  const c = document.createElement("div"); document.body.appendChild(c);
  const r = createRoot(c);
  await act(async () => { r.render(h(ConvertirCarritoBtn, { ...base, cliente: { nombres: "Ana", apellidos: "Pérez", numeroDoc: "1032", tipoDoc: "CC" }, ...extra } as never)); await espera(); });
  await act(async () => { click(boton(/Confirmar → generar contrato/, c)!); await espera(); });
  return { c, r };
}
const agregar = (c: ParentNode) => c.querySelector('[data-testid="agregar-pasajero"]') as HTMLButtonElement | null;
const nFilas = (c: ParentNode) => c.querySelectorAll('[data-testid="pasajero-resumen"], [data-testid="pasajero-fila"]').length;

describe("ConvertirCarritoBtn — «Agregar pasajero» y el universo declarado", () => {
  test("una sola unidad con 2 viajeros: las 2 filas representan a todos ⇒ no hay botón; al quitar una vuelve; al agregar se oculta otra vez", async () => {
    const { c, r } = await abrirCon({});
    assert.equal(nFilas(c), 2);
    assert.equal(agregar(c), null);
    await act(async () => { click(c.querySelector('[aria-label="Quitar pasajero 1"], [data-testid="pasajero-fila"] button.text-red-500')!); await espera(); });
    assert.equal(nFilas(c), 1);
    assert.ok(agregar(c), "liberado un lugar, el control reaparece");
    await act(async () => { click(agregar(c)!); await espera(); });
    assert.equal(nFilas(c), 2);
    assert.equal(agregar(c), null);
    await act(async () => r.unmount());
  });
  test("dos hoteles de 2 viajeros (pueden ser los mismos o distintos): NO se oculta por el máximo (2); sí al llegar a la cota de la suma (4); la nota lo explica", async () => {
    const dosHoteles = [
      { hotelNombre: "Hotel A", destino: "CARTAGENA", pax: 2, fechaIda: "2030-03-01" },
      { hotelNombre: "Hotel B", destino: "CARTAGENA", pax: 2, fechaIda: "2030-03-05" },
    ];
    const { c, r } = await abrirCon({ items: dosHoteles });
    assert.equal(nFilas(c), 2);
    assert.ok(agregar(c), "con 2 filas todavía se ofrece: el universo no es el máximo de los pax");
    assert.match(c.querySelector('[data-testid="nota-universo"]')!.textContent ?? "", /2 servicios independientes/);
    await act(async () => { click(agregar(c)!); await espera(); });
    await act(async () => { click(agregar(c)!); await espera(); });
    assert.equal(nFilas(c), 4);
    assert.equal(agregar(c), null, "cota de seguridad: la suma de las unidades");
    assert.match(c.querySelector('[data-testid="nota-universo"]')!.textContent ?? "", /cota máxima/);
    await act(async () => r.unmount());
  });
  test("un tour vinculado a su hotel viaja con ese hotel: el universo sigue siendo exacto", async () => {
    const { c, r } = await abrirCon({ tours: [{ nombre: "Tour islas", destino: "CARTAGENA", pax: 2, fechaIda: "2030-03-02", hotelIndice: 0 }] });
    assert.equal(nFilas(c), 2);
    assert.equal(agregar(c), null);
    await act(async () => r.unmount());
  });
});
