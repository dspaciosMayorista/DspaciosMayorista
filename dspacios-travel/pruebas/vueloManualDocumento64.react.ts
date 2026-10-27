// Se ejecuta con npm run test:react (loader del arnés).
//
// #64 (ronda 3) — presentación del vuelo manual en la cotización: sale en el cuadro de vuelos (ruta, tramo, fecha, pasajeros y aviso «sujeto a
// confirmación»), NO como línea suelta bajo «Valores y Pagos», y su precio queda en el total exactamente una vez. Se renderiza el componente REAL
// del documento interno y del enlace público (mismo componente) con lo que escribe `crearCotizacionCarrito`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const RUTA_DOC = process.env.DOC_MANUAL_RUTA ?? "../components/contrato/ContratoDocumento.tsx";
const { ContratoDocumento } = await import(RUTA_DOC);
const { validarServicioManual, validarVueloContraHotel, tramosVueloManual, descripcionCotizacionManual } = await import("../lib/cart/servicioManual.ts");
const { formatMoneda } = await import("../lib/utils.ts");

const valido = (raw: unknown) => { const r = validarServicioManual(raw); assert.ok(r.ok); return (r as { valor: Parameters<typeof tramosVueloManual>[0] }).valor; };
const HOTEL = { ref: "item-0", nombre: "Hotel Almirante", destino: "Cartagena", destinoIata: "CTG", fechaIda: "2030-10-15", fechaRegreso: "2030-10-18" };
const conHotel = (raw: unknown) => { const r = validarVueloContraHotel(valido(raw), HOTEL); assert.ok(r.ok, r.ok ? "" : r.error); return (r as { valor: Parameters<typeof tramosVueloManual>[0] }).valor; };

const base = { clase: "vuelo", nombre: "Tiquete Avianca", pax: 2, precio: 1_800_000, moneda: "COP", impuestoNoComisionable: 200_000, hotelRef: "h1", origen: "BOG", destino: "CTG", tramo: "ida_regreso", fechaIda: "2030-10-15", fechaRegreso: "2030-10-18" };
const venta = {
  numero_contrato: "", cliente: "Cliente Prueba", cliente_documento: "1000", cliente_direccion: null, cliente_telefono: null, asesor: "Asesora", asesor_firma_nombre: "Asesora",
  asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "pendiente", fecha_emision: "2030-10-01", fecha_salida: "2030-10-15",
  pax: 4, plan_nombre: null, tours_traslados: null, asistencia_medica: null, moneda: "COP", tenant: "mayorista", tipo_asesor: null, agencia_nombre: null, freelance_nombre: null,
};
const itemHotel = { id: 1, numero_contrato: "", descripcion: "Hotel Almirante · Estándar / PC", adultos: 4, ninos: 0, tarifa_adulto: 300_000, tarifa_nino: 0, orden: 0, modo_precio: "por_persona", valor_total: null };
const HOTELES = [{ id: 1, nombre: "Hotel Almirante", categoria: "Estándar", ciudad: "Cartagena", alimentacion: "PC", acomodacion: "Doble", fecha_ingreso: "2030-10-15", fecha_salida: "2030-10-18" }];

function lineaYTramos(m: Parameters<typeof tramosVueloManual>[0], id: number) {
  return {
    item: { id, numero_contrato: "", descripcion: descripcionCotizacionManual(m), adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0, orden: id, modo_precio: "total", valor_total: m.precio },
    vuelos: tramosVueloManual(m, true).map((t, i) => ({ id: id * 10 + i, numero_contrato: "", ...t })),
  };
}
function texto(items: unknown[], vuelos: unknown[], netoTotalExigible: number | null = null) {
  const props = { venta, pasajeros: [], hoteles: HOTELES, vuelos, items, totalPagado: 0, agencia: null, condiciones: null, habitacionesBernalo: [], esCotizacion: true, codigo: "COT-1", vigenciaHasta: "2030-10-10", netoTotalExigible };
  const html = renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, props));
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}
const $ = (n: number) => formatMoneda(n, "COP").replace(/\s+/g, "");
const plano = (t: string) => t.replace(/\s+/g, "");
const tiene = (t: string, frag: string) => plano(t).includes(plano(frag));
const veces = (t: string, s: string) => plano(t).split(s).length - 1;

describe("el vuelo manual en el documento de la cotización", () => {
  const m = conHotel(base);
  const { item, vuelos } = lineaYTramos(m, 2);
  const t = texto([itemHotel, item], vuelos);

  test("sale en el cuadro de vuelos con ida y regreso, ruta, fecha, pasajeros y el aviso de confirmación", () => {
    const seccion = t.slice(t.indexOf("Vuelos"), t.indexOf("Hoteles y Servicios"));
    assert.match(seccion, /Ida:/);
    assert.match(seccion, /Regreso:/);
    assert.match(seccion, /Origen: .*BOG/);
    assert.match(seccion, /Destino: Cartagena \(CTG\)/);
    assert.match(seccion, /pasajeros en este vuelo: 2/);
    assert.match(seccion, /sujeto a confirmación de disponibilidad y tarifa/);
    assert.doesNotMatch(seccion, /record|PNR|silla/i);
  });
  test("NO hay línea suelta del vuelo bajo «Valores y Pagos»", () => {
    const valores = t.slice(t.indexOf("Valores y Pagos"));
    assert.doesNotMatch(valores, /Vuelo · Tiquete Avianca/);
    assert.doesNotMatch(valores, /Tiquete Avianca/);
  });
  test("el precio queda en el total exactamente una vez (hotel 1.200.000 + vuelo 1.800.000) y no se repite en ninguna tabla", () => {
    assert.ok(tiene(t, `Total del contrato ${$(3_000_000)}`), "total = hotel + vuelo");
    assert.equal(veces(t, $(1_800_000)), 0, "el precio del vuelo no aparece suelto en ninguna parte");
    assert.equal(veces(t, "Totaldelcontrato" + $(3_000_000)), 1, "el total del contrato aparece una vez");
  });
  test("no afirma que el vuelo cubre a todos: dice los pasajeros reales de ese vuelo (2 de 4)", () => {
    assert.match(t, /pasajeros en este vuelo: 2/);
    assert.doesNotMatch(t, /todos los pasajeros|cubre a todos/i);
  });
  test("solo ida y solo regreso pintan un único tramo con su etiqueta", () => {
    const ida = lineaYTramos(conHotel({ ...base, tramo: "ida", fechaRegreso: null }), 2);
    const r = texto([itemHotel, ida.item], ida.vuelos);
    assert.match(r, /Ida:/);
    assert.doesNotMatch(r, /Regreso:/);
    const reg = lineaYTramos(conHotel({ ...base, tramo: "regreso", origen: "CTG", destino: "BOG", fechaIda: null }), 2);
    const g = texto([itemHotel, reg.item], reg.vuelos);
    assert.match(g, /Regreso:/);
    assert.doesNotMatch(g, /Ida:/);
  });
  test("dos vuelos separados, con pasajeros distintos, salen cada uno con los suyos y suman cada uno una vez", () => {
    const a = lineaYTramos(conHotel({ ...base, tramo: "ida", fechaRegreso: null, pax: 2, precio: 900_000, impuestoNoComisionable: 0 }), 2);
    const b = lineaYTramos(conHotel({ ...base, nombre: "Tiquete Latam", tramo: "ida", fechaRegreso: null, pax: 3, precio: 1_100_000, impuestoNoComisionable: 0 }), 3);
    const r = texto([itemHotel, a.item, b.item], [...a.vuelos, ...b.vuelos]);
    assert.match(r, /pasajeros en este vuelo: 2/);
    assert.match(r, /pasajeros en este vuelo: 3/);
    assert.ok(tiene(r, `Total del contrato ${$(1_200_000 + 900_000 + 1_100_000)}`));
  });
  test("NETO: tampoco hay línea suelta y el total es el exigible", () => {
    const r = texto([itemHotel, item], vuelos, 2_700_000);
    assert.doesNotMatch(r.slice(r.indexOf("Valores y Pagos")), /Tiquete Avianca/);
    assert.ok(tiene(r, `Total del contrato ${$(2_700_000)}`));
  });
  test("un «otro servicio» conserva su comportamiento: sigue en la tabla de servicios", () => {
    const o = valido({ clase: "otro", nombre: "Traslado privado", pax: 2, precio: 90_000, moneda: "COP", impuestoNoComisionable: 0 });
    const it = { id: 2, numero_contrato: "", descripcion: descripcionCotizacionManual(o), adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0, orden: 2, modo_precio: "total", valor_total: 90_000 };
    const r = texto([itemHotel, it], []);
    assert.match(r, /Traslado privado/);
    assert.doesNotMatch(r, /incluye el valor de los vuelos/, "sin vuelo manual no hay aclaración");
  });
});

// ── Ronda 12 · horarios: la COTIZACIÓN muestra la hora local de salida; el CONTRATO no muestra horarios ni número de vuelo (#47) ──
describe("horas del vuelo manual y #47 (ningún horario ni número de vuelo en el contrato)", () => {
  const m = conHotel({ ...base, horaIda: "06:45", horaRegreso: "18:20" });
  const { item, vuelos } = lineaYTramos(m, 2);
  const conDatosOperativos = [
    ...vuelos,
    // Un vuelo de Sistema con número de vuelo y horas (también operativos): en el contrato tampoco se muestran.
    { id: 99, numero_contrato: "", aerolinea: "Avianca", record: null, direccion: "ida", numero_vuelo: "AV9123", hora_salida: "05:10", hora_llegada: "06:25", origen_codigo: "BOG", origen_ciudad: "Bogotá", destino_codigo: "CTG", destino_ciudad: "Cartagena", servicios: "Equipaje", fecha_salida: "2030-10-15" },
  ];
  const texto2 = (esCotizacion: boolean) => {
    const props = { venta, pasajeros: [], hoteles: HOTELES, vuelos: conDatosOperativos, items: [itemHotel, item], totalPagado: 0, agencia: null, condiciones: null, habitacionesBernalo: [], esCotizacion, codigo: "COT-1", vigenciaHasta: "2030-10-10", netoTotalExigible: null };
    return renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, props)).replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  };
  test("COTIZACIÓN: cada tramo muestra «salida HH:mm (hora local)»; sin hora de llegada inventada", () => {
    const t = texto2(true);
    assert.match(t, /Ida: .*15 de octubre de 2030 · salida 06:45 \(hora local\)/);
    assert.match(t, /Regreso: .*18 de octubre de 2030 · salida 18:20 \(hora local\)/);
    assert.doesNotMatch(t.slice(t.indexOf("Vuelos"), t.indexOf("Hoteles y Servicios")), /llegada/i);
  });
  test("una hora sin confirmar no muestra nada (ni «salida —»)", () => {
    const sinHora = lineaYTramos(conHotel(base), 2);
    const props = { venta, pasajeros: [], hoteles: HOTELES, vuelos: sinHora.vuelos, items: [itemHotel, sinHora.item], totalPagado: 0, agencia: null, condiciones: null, habitacionesBernalo: [], esCotizacion: true, codigo: "COT-1", vigenciaHasta: "2030-10-10", netoTotalExigible: null };
    const t = renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, props)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert.doesNotMatch(t, /salida \d|hora local/);
  });
  test("CONTRATO (#47): ningún horario ni número de vuelo, ni del vuelo manual ni de uno de Sistema; la fecha y la ruta siguen", () => {
    const t = texto2(false);
    const seccion = t.slice(t.indexOf("Vuelos"), t.indexOf("Hoteles y Servicios"));
    assert.doesNotMatch(seccion, /06:45|18:20|05:10|06:25|AV9123|vuelo AV|hora local|salida \d/);
    assert.match(seccion, /Origen: .*BOG/);
    assert.match(seccion, /Ida: .*15 de octubre de 2030/);
  });
});
