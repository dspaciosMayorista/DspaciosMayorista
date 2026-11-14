// Se ejecuta con npm run test:react (loader del arnés).
//
// Cotizaciones con vuelos: horas en 24 h «HH:mm» sin segundos y aviso de itinerarios UNA vez bajo la sección de vuelos.
// Contrato: no muestra horarios ni aviso. Sin vuelos: sin aviso. Sin hora: no se inventa. Datos sintéticos.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { VuelosOpcion } = await import("../components/cotizacion/ListasIncluye.tsx");
const { AVISO_ITINERARIOS_VUELOS } = await import("../components/cotizacion/AvisoItinerariosVuelos.tsx");
const { formatHora24 } = await import("../lib/utils.ts");
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";

const AVISO = "Itinerarios de vuelos sujetos a cambio sin previo aviso. Recuerde confirmarlos un día antes de su fecha y hora de viaje.";
const venta = {
  numero_contrato: "", cliente: "Cliente Prueba", cliente_documento: "1000", cliente_direccion: null, cliente_telefono: null, asesor: "Asesora", asesor_firma_nombre: "Asesora",
  asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "pendiente", fecha_emision: "2030-10-01", fecha_salida: "2030-10-15",
  pax: 2, plan_nombre: null, tours_traslados: null, asistencia_medica: null, moneda: "COP", tenant: "mayorista", tipo_asesor: null, agencia_nombre: null, freelance_nombre: null,
};
const tramo = (id: number, direccion: "ida" | "regreso", hora_salida: string | null, hora_llegada: string | null) => ({
  id, numero_contrato: "", aerolinea: "Aerolínea Sintética", origen_codigo: direccion === "ida" ? "BOG" : "CTG", destino_codigo: direccion === "ida" ? "CTG" : "BOG",
  fecha_salida: direccion === "ida" ? "2030-10-15" : "2030-10-18", direccion, numero_vuelo: "XX123", hora_salida, hora_llegada, servicios: null,
});
function documento(vuelos: unknown[], esCotizacion: boolean) {
  const props = { venta, pasajeros: [], hoteles: [], vuelos, items: [], totalPagado: 0, agencia: AGENCIA_PRUEBA, condiciones: null, habitacionesBernalo: [], esCotizacion, codigo: "COT-1", vigenciaHasta: "2030-10-10" };
  const html = renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, props));
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");
}
const veces = (t: string, s: string) => t.split(s).length - 1;

describe("formatHora24", () => {
  test("quita segundos, rellena a dos dígitos y no inventa", () => {
    assert.equal(formatHora24("13:10:00"), "13:10");
    assert.equal(formatHora24("7:05"), "07:05");
    assert.equal(formatHora24("01:30 pm"), "13:30");
    assert.equal(formatHora24("00:00:00"), "00:00");
    assert.equal(formatHora24(null), null);
    assert.equal(formatHora24(""), null);
    assert.equal(formatHora24("  "), null);
    assert.equal(formatHora24("mediodía"), "mediodía");
  });
});

describe("documento de cotización (ContratoDocumento esCotizacion)", () => {
  const vuelos = [tramo(1, "ida", "06:05:00", "07:30:00"), tramo(2, "regreso", "18:40:00", "20:10:00")];
  const t = documento(vuelos, true);
  const seccion = t.slice(t.indexOf("Vuelos"), t.indexOf("Hoteles y Servicios"));

  test("ida y regreso en HH:mm sin segundos", () => {
    assert.match(seccion, /06:05–07:30/);
    assert.match(seccion, /18:40–20:10/);
    assert.doesNotMatch(seccion, /:\d\d:\d\d/);
  });
  test("el aviso sale una sola vez, dentro de la sección y después de todos los tramos", () => {
    assert.equal(veces(t, AVISO), 1);
    assert.equal(AVISO_ITINERARIOS_VUELOS, AVISO);
    assert.ok(seccion.includes(AVISO));
    assert.ok(seccion.indexOf(AVISO) > seccion.indexOf("Regreso:"));
  });
  test("sin hora no se inventa 00:00 pero el aviso se mantiene (hay vuelo)", () => {
    const s = documento([tramo(1, "ida", null, null)], true);
    assert.doesNotMatch(s, /00:00/);
    assert.equal(veces(s, AVISO), 1);
  });
  test("sin vuelos no hay aviso", () => {
    assert.equal(veces(documento([], true), AVISO), 0);
  });
});

describe("contrato (no cotización): conserva horarios y aviso ocultos", () => {
  const t = documento([tramo(1, "ida", "06:05:00", "07:30:00")], false);
  test("sin horario, sin número de vuelo y sin aviso", () => {
    assert.doesNotMatch(t, /06:05|07:30|XX123/);
    assert.equal(veces(t, AVISO), 0);
  });
});

describe("vuelos de la comparativa (VuelosOpcion)", () => {
  const render = (tiquetes: unknown) => renderToStaticMarkup(createElement(VuelosOpcion as ComponentType<Record<string, unknown>>, { tiquetes })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  test("dos tramos de un tiquete: hora HH:mm y un solo aviso al final", () => {
    const s = render([{ pax: 2, aviso: null, tramos: [
      { direccion: "ida", origen: "BOG", destino: "CTG", fecha: "2030-10-15", hora: "06:05:00" },
      { direccion: "regreso", origen: "CTG", destino: "BOG", fecha: "2030-10-18", hora: null },
    ] }]);
    assert.match(s, /salida 06:05 \(hora local\)/);
    assert.equal(veces(s, "(hora local)"), 1);
    assert.equal(veces(s, AVISO), 1);
    assert.ok(s.indexOf(AVISO) > s.indexOf("Regreso"));
  });
  test("varios tiquetes en la misma opción: el aviso sigue una sola vez", () => {
    const tq = { pax: 1, aviso: null, tramos: [{ direccion: "ida", origen: "BOG", destino: "MDE", fecha: "2030-10-15", hora: "09:00" }] };
    assert.equal(veces(render([tq, tq]), AVISO), 1);
  });
  test("sin tiquetes no renderiza nada ni aviso", () => {
    assert.equal(render([]).trim(), "");
    assert.equal(render(undefined).trim(), "");
  });
});
