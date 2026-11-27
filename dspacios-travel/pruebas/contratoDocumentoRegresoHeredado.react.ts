// Se ejecuta con npm run test:react:rc2 (loader del arnés).
//
// RC-2 — el documento del contrato conserva el regreso GUARDADO de un itinerario heredado (una sola fila ida+regreso) cuando el editor operativo de vuelos solo cambió la ida:
// el editor escribe únicamente los campos modernos del tramo (numero_vuelo, hora_salida, direccion) y nunca toca vuelo_regreso / fecha_regreso / horas de regreso.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");

const venta = {
  numero_contrato: "DTM-9807", cliente: "Cliente Heredado", cliente_documento: "1000", cliente_direccion: null, cliente_telefono: null, asesor: "Asesora", asesor_firma_nombre: "Asesora",
  asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "confirmado", fecha_emision: "2027-06-01", fecha_salida: "2027-06-07",
  pax: 2, plan_nombre: null, tours_traslados: null, asistencia_medica: null, moneda: "COP", tenant: "mayorista", tipo_asesor: null, agencia_nombre: null, freelance_nombre: null,
};
const filaHeredada = {
  id: 1, numero_contrato: "DTM-9807", aerolinea: "Avianca", record: "LEGPNR1", direccion: null, origen_codigo: "BOG", origen_ciudad: "Bogotá", destino_codigo: "CTG", destino_ciudad: "Cartagena",
  fecha_salida: "2027-06-07", servicios: null, orden: 0, numero_vuelo: null, hora_salida: null, hora_llegada: null,
  vuelo_ida: "LG100", hora_salida_ida: "08:00", hora_llegada_ida: "09:30", fecha_regreso: "2027-06-10", vuelo_regreso: "LG200", hora_salida_reg: "18:00", hora_llegada_reg: "19:30",
};
function texto(vuelos: unknown[], esCotizacion = false) {
  const props = { venta, pasajeros: [], hoteles: [], vuelos, items: [], totalPagado: 0, agencia: AGENCIA_PRUEBA, condiciones: null, habitacionesBernalo: [], esCotizacion, codigo: "COT-1", vigenciaHasta: "2030-10-15" };
  const html = renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, props));
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}
const seccion = (t: string) => t.slice(t.indexOf("Vuelos"));

describe("documento: itinerario heredado tras editar solo la ida", () => {
  test("fila heredada intacta: ida y regreso (línea de regreso con su fecha)", () => {
    const s = seccion(texto([filaHeredada]));
    assert.match(s, /Ida: /); assert.match(s, /Regreso: .*2027/);
  });
  test("tras editar solo la ida (campos modernos llenos, direccion «ida») el Regreso heredado SIGUE saliendo", () => {
    const editada = { ...filaHeredada, direccion: "ida", numero_vuelo: "LG111", hora_salida: "08:00", hora_llegada: "09:30" };
    const s = seccion(texto([editada]));
    assert.match(s, /Ida: /); assert.match(s, /Regreso: .*10 de junio de 2027/);
    // En la cotización (muestra horarios): el vuelo y las horas de regreso guardados salen con el regreso.
    const c = seccion(texto([editada], true));
    assert.match(c, /vuelo LG111/); assert.match(c, /Regreso: .*vuelo LG200.*18:00–19:30/);
  });
  test("control negativo: un tramo moderno normal (sin columnas heredadas) NO inventa un regreso", () => {
    const moderna = { ...filaHeredada, direccion: "ida", numero_vuelo: "XX1", hora_salida: "07:00", hora_llegada: "08:00", vuelo_ida: null, hora_salida_ida: null, hora_llegada_ida: null, fecha_regreso: null, vuelo_regreso: null, hora_salida_reg: null, hora_llegada_reg: null };
    const s = seccion(texto([moderna]));
    assert.match(s, /Ida: /); assert.doesNotMatch(s, /Regreso: /);
  });
});
