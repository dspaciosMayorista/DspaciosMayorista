// Se ejecuta con npm run test:react (loader del arnés + jsdom).
//
// Servicio por GRUPO sin rango para los pasajeros (el snapshot solo cubre 1–4 y se piden 5): ni ReservaForm ni ServiciosContratoEditor muestran como estimado el
// precio del rango más alto; muestran un aviso legible, no dejan marcarlo y no dejan guardar/continuar con él marcado. El servidor revalida igual.
import { montar, clic, escribir, usarBD, dom } from "./support/fechaNegocioArnes.ts";
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

usarBD();
const React = await import("react");
const { ReservaForm } = await import("../app/(dashboard)/dashboard/reservar/nuevo/ReservaForm.tsx");
const { ServiciosContratoEditor } = await import("../app/(dashboard)/dashboard/contratos/[numero]/ServiciosContratoEditor.tsx");
const h = React.createElement;
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

const TOUR = { servicioId: 7, nombre: "Tour grupal", modo: "grupo" as const, personaPvp: null, grupos: [{ pax_desde: 1, pax_hasta: 4, precio: 400000 }] };
const TOUR_COBERTURA = { ...TOUR, servicioId: 8, nombre: "Tour con rango", grupos: [{ pax_desde: 1, pax_hasta: 4, precio: 400000 }, { pax_desde: 5, pax_hasta: 6, precio: 500000 }] };
const META = {
  paqueteId: 1, hotelId: 1, bloqueoId: null, modulo: "servicios" as const, moneda: "COP", hotelNombre: "Hotel", destino: "CARTAGENA",
  fechaIda: null, fechaRegreso: null, noches: null, bloqueoLabel: null, edadInfanteMax: 1, edadNinoMax: 11, paxMinHotel: null, paxMaxHotel: null,
  petFriendly: false, petNota: null,
};

let desmontar: (() => Promise<void>) | null = null;
afterEach(async () => { await desmontar?.(); desmontar = null; });

const fila = (raiz: Element, nombre: string) => [...raiz.querySelectorAll("li")].find((l) => txt(l).includes(nombre)) as HTMLLIElement;
const casilla = (li: HTMLLIElement) => li.querySelector("input[type=checkbox]") as HTMLInputElement;

describe("ReservaForm: estimado de un servicio por grupo", () => {
  test("5 pasajeros y el rango publicado llega a 4: aviso legible, sin precio del rango más alto y no se puede marcar", async () => {
    const m = await montar(h(ReservaForm, { meta: META, combos: [], serviciosDisp: [TOUR, TOUR_COBERTURA] }));
    desmontar = m.desmontar;
    const pax = [...m.contenedor.querySelectorAll("input[type=number]")][0] as HTMLInputElement;
    await escribir(pax, "5");
    const sin = fila(m.contenedor, "Tour grupal");
    assert.match(txt(sin), /Sin precio para 5 pasajeros: ningún rango lo cubre, no se puede cotizar/);
    assert.ok(!/400\.000/.test(txt(sin)), "no debe mostrar el precio del rango más alto (400.000) como estimado");
    assert.equal(casilla(sin).disabled, true, "no se ofrece como cotizable");
    const con = fila(m.contenedor, "Tour con rango");
    assert.match(txt(con), /500\.000/, "el servicio con rango que cubre sí muestra su precio");
    assert.equal(casilla(con).disabled, false);
  });

  test("con 4 pasajeros el mismo servicio sí tiene estimado (1–4)", async () => {
    const m = await montar(h(ReservaForm, { meta: META, combos: [], serviciosDisp: [TOUR] }));
    desmontar = m.desmontar;
    await escribir([...m.contenedor.querySelectorAll("input[type=number]")][0] as HTMLInputElement, "4");
    const li = fila(m.contenedor, "Tour grupal");
    assert.match(txt(li), /400\.000/);
    assert.ok(!/Sin precio para/.test(txt(li)));
  });
});

describe("ReservaForm (256): servicio opcional con disponibilidad parcial por fecha", () => {
  const PERSONA = { servicioId: 11, nombre: "Tour parcial", modo: "persona" as const, personaPvp: 100000, grupos: [], fechasDisponibles: [{ desde: "2026-12-01", hasta: "2026-12-10" }] };
  const PERSONA_TODO = { servicioId: 12, nombre: "Tour todo el viaje", modo: "persona" as const, personaPvp: 90000, grupos: [], fechasDisponibles: null };

  test("fecha FUERA de sus tramos: se dice que no está disponible, no se muestra el precio y no se puede marcar", async () => {
    const m = await montar(h(ReservaForm, { meta: { ...META, fechaIda: "2026-12-20", fechaRegreso: "2026-12-22" }, combos: [], serviciosDisp: [PERSONA, PERSONA_TODO] }));
    desmontar = m.desmontar;
    const fuera = fila(m.contenedor, "Tour parcial");
    assert.match(txt(fuera), /No disponible en la fecha elegida/);
    assert.match(txt(fuera), /Disponible solo del 01\/12\/2026 al 10\/12\/2026/);
    assert.ok(!/100\.000/.test(txt(fuera)), "no muestra un precio que no se puede vender");
    assert.equal(casilla(fuera).disabled, true);
    const todo = fila(m.contenedor, "Tour todo el viaje");
    assert.match(txt(todo), /90\.000/);
    assert.equal(casilla(todo).disabled, false);
  });

  test("fecha DENTRO de un tramo: se ofrece con su precio", async () => {
    const m = await montar(h(ReservaForm, { meta: { ...META, fechaIda: "2026-12-05", fechaRegreso: "2026-12-07" }, combos: [], serviciosDisp: [PERSONA] }));
    desmontar = m.desmontar;
    const li = fila(m.contenedor, "Tour parcial");
    assert.match(txt(li), /100\.000/);
    assert.ok(!/No disponible/.test(txt(li)));
    assert.equal(casilla(li).disabled, false);
  });
});

describe("ServiciosContratoEditor: estimado de un servicio por grupo", () => {
  test("5 pax y el rango llega a 4: aviso, sin precio aproximado, no se puede marcar", async () => {
    const m = await montar(h(ServiciosContratoEditor, { numero: "00-0001", pax: 5, serviciosDisp: [TOUR, TOUR_COBERTURA], seleccionInicial: [] }));
    desmontar = m.desmontar;
    const sin = fila(m.contenedor, "Tour grupal");
    assert.match(txt(sin), /Sin precio para 5 pasajeros/);
    assert.ok(!/400\.000/.test(txt(sin)));
    assert.equal(casilla(sin).disabled, true);
    assert.match(txt(fila(m.contenedor, "Tour con rango")), /500\.000/);
  });

  test("un servicio ya marcado que quedó sin rango: se puede desmarcar, avisa y NO deja guardar con él marcado", async () => {
    const m = await montar(h(ServiciosContratoEditor, { numero: "00-0001", pax: 5, serviciosDisp: [TOUR], seleccionInicial: [7] }));
    desmontar = m.desmontar;
    const boton = [...m.contenedor.querySelectorAll("button")].find((b) => /Guardar servicios/.test(txt(b))) as HTMLButtonElement;
    assert.equal(boton.disabled, true, "guardar queda bloqueado mientras siga marcado");
    assert.match(txt(m.contenedor), /Desmarca «Tour grupal»: no tiene rango para 5 pax/);
    await clic(casilla(fila(m.contenedor, "Tour grupal")), "casilla");
    assert.equal(boton.disabled, false, "al desmarcarlo se puede guardar");
  });
});

void dom;
