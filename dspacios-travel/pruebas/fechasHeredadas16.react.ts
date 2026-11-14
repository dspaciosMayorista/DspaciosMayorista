// Se ejecuta con npm run test:react (loader del arnés + jsdom).
//
// #16 — Contrato manual: hotel, tramo de vuelo y regreso nuevos parten de las fechas del viaje (editables). Cambiar el viaje después no pisa
// lo ya escrito. (La cotización manual no tiene fechas por servicio: fuera de este alcance.)
import { montar, escribir, clic, botonConTexto, usarBD } from "./support/fechaNegocioArnes.ts";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { NuevoContratoForm } = await import("../app/(dashboard)/dashboard/contratos/NuevoContratoForm.tsx");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; });
after(async () => { (await import("./support/fechaNegocioArnes.ts")).dom.window.close(); });

const input = (raiz: Element, etiqueta: string) => [...raiz.querySelectorAll<HTMLInputElement>(`input[aria-label="${etiqueta}"]`)];

test("#16: hotel nuevo hereda ingreso = salida y salida = regreso del viaje; cambiar el viaje después no lo pisa", async () => {
  usarBD();
  const m = await montar(h(NuevoContratoForm, { asesorDefault: "Asesor" }));
  desmontar = m.desmontar;
  await escribir(input(m.contenedor, "Fecha de salida (viaje)")[0], "2026-10-15");
  await escribir(input(m.contenedor, "Fecha de regreso")[0], "2026-10-18");
  await clic(botonConTexto(m.contenedor, /Agregar hotel/), "Agregar hotel");
  assert.equal(input(m.contenedor, "Ingreso al hotel")[0]?.value, "2026-10-15");
  assert.equal(input(m.contenedor, "Fecha de salida")[0]?.value, "2026-10-18");
  // Editable y sin pisarse: se cambia el viaje y el hotel ya creado conserva su rango.
  await escribir(input(m.contenedor, "Fecha de salida (viaje)")[0], "2026-10-20");
  assert.equal(input(m.contenedor, "Ingreso al hotel")[0]?.value, "2026-10-15");
});

test("#16: tramo nuevo hereda la salida del viaje y «Agregar regreso» hereda el regreso", async () => {
  usarBD();
  const m = await montar(h(NuevoContratoForm, { asesorDefault: "Asesor" }));
  desmontar = m.desmontar;
  await escribir(input(m.contenedor, "Fecha de salida (viaje)")[0], "2026-10-15");
  await escribir(input(m.contenedor, "Fecha de regreso")[0], "2026-10-18");
  await clic(botonConTexto(m.contenedor, /Agregar tramo/), "Agregar tramo");
  assert.equal(input(m.contenedor, "Fecha de este tramo")[0]?.value, "2026-10-15");
  await clic(botonConTexto(m.contenedor, /Agregar regreso/), "Agregar regreso");
  assert.deepEqual(input(m.contenedor, "Fecha de este tramo").map((x) => x.value), ["2026-10-15", "2026-10-18"]);
});

test("#16: sin fechas de viaje, los componentes nuevos nacen vacíos (nada se inventa)", async () => {
  usarBD();
  const m = await montar(h(NuevoContratoForm, { asesorDefault: "Asesor" }));
  desmontar = m.desmontar;
  await clic(botonConTexto(m.contenedor, /Agregar hotel/), "Agregar hotel");
  assert.equal(input(m.contenedor, "Ingreso al hotel")[0]?.value, "");
});
