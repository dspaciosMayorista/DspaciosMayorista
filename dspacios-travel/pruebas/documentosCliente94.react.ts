// Se ejecuta con npm run test:react (loader del arnés).
//
// #94/#52 — lo que VE EL CLIENTE. Se renderiza el componente real `ContratoDocumento` con un resumen de precios estructurado (el mismo objeto JSON que se guarda al
// cotizar): grupos de pasajeros con precio completo por persona y subtotal, el total y NINGÚN importe por servicio. Si el resumen no coincide con el acuerdo
// (modalidad, moneda, total) el documento no lo usa. #17 (vuelos en cotización vs contrato) se conserva al final.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { formatMoneda } = await import("../lib/utils.ts");
const { resumenUnidad, resumenCotizacion } = await import("../lib/cotizacion/resumenPrecios.ts");
const { validarServicioManual, descripcionCotizacionManual, descripcionContratoManual } = await import("../lib/cart/servicioManual.ts");

const venta = {
  numero_contrato: "00-0999", cliente: "Cliente Prueba", cliente_documento: "1000", cliente_direccion: null, cliente_telefono: null, asesor: "Asesora", asesor_firma_nombre: "Asesora",
  asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "pendiente", fecha_emision: "2030-10-01", fecha_salida: "2030-10-15", fecha_regreso: "2030-10-18",
  destino: "CARTAGENA", pax: 3, plan_nombre: "Estándar · PC", tours_traslados: null, asistencia_medica: null, moneda: "COP", tenant: "mayorista", tipo_asesor: null, agencia_nombre: null, freelance_nombre: null,
};
const HOTELES = [{ id: 1, nombre: "Hotel Almirante", categoria: "Estándar", ciudad: "Cartagena", alimentacion: "PC", acomodacion: "Triple", fecha_ingreso: "2030-10-15", fecha_salida: "2030-10-18" }];
const it = (id: number, descripcion: string, extra: Record<string, unknown> = {}) => ({ id, numero_contrato: "", descripcion, adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0, orden: id, modo_precio: "por_persona", valor_total: null, ...extra });
const manual = (raw: unknown) => { const r = validarServicioManual(raw); assert.ok(r.ok); return (r as { valor: Parameters<typeof descripcionCotizacionManual>[0] }).valor; };
const vuelo = manual({ clase: "vuelo", nombre: "Tiquete Avianca", pax: 2, precio: 1_200_000, moneda: "COP", impuestoNoComisionable: 0, hotelRef: "item-0", origen: "BOG", destino: "CTG", tramo: "ida_regreso", fechaIda: "2030-10-15", fechaRegreso: "2030-10-18" });
const tour = manual({ clase: "otro", nombre: "Tour Islas del Rosario", pax: 2, precio: 200_000, moneda: "COP", impuestoNoComisionable: 0 });
const lineas = (d: (m: typeof vuelo) => string) => [
  it(1, "1 hab Triple (3 pax) · Estándar / PC", { adultos: 3, tarifa_adulto: 300_000 }),
  it(2, d(vuelo), { modo_precio: "total", valor_total: 1_200_000 }),
  it(3, d(tour), { modo_precio: "total", valor_total: 200_000 }),
];
const TOTAL = 2_300_000;
const meta = { ref: "item-0", paquete: { id: 7, nombre: "Cartagena Esencial" }, hotel: "Hotel Almirante", categoria: "Estándar", regimen: "PC" };
const cupos = ["a1", "a2", "a3"].map((id) => ({ id, tipo: "adulto" as const, baseCentavos: 30_000_000 }));
const servicio = (id: string, nombre: string, precio: number, cubre: string[]) => ({ id, nombre, modo: "total" as const, precioCentavos: precio * 100, cubre });
const unidadOk = (r: ReturnType<typeof resumenUnidad>) => { assert.ok(r.ok, r.ok ? "" : r.error); return (r as Extract<typeof r, { ok: true }>).valor; };
const resumenDe = (cubreVuelo: string[], cubreTour: string[], opts: { modalidad?: "pvp" | "neto"; moneda?: string } = {}) => {
  const r = resumenUnidad({ ...meta, cupos, servicios: [servicio("v", "Vuelo", 1_200_000, cubreVuelo), servicio("t", "Tour Islas del Rosario", 200_000, cubreTour)] });
  return JSON.parse(JSON.stringify(resumenCotizacion({ modalidad: opts.modalidad ?? "pvp", moneda: opts.moneda ?? "COP", unidades: [unidadOk(r)] })));
};

function render(items: unknown[], extra: Record<string, unknown> = {}, v: Record<string, unknown> = {}) {
  const props = { venta: { ...venta, ...v }, pasajeros: [], hoteles: HOTELES, vuelos: [], items, totalPagado: 0, agencia: null, condiciones: null, habitacionesBernalo: [], esCotizacion: true, codigo: "COT-1", vigenciaHasta: "2030-10-10", netoTotalExigible: null, ...extra };
  return renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, props));
}
const texto = (items: unknown[], extra: Record<string, unknown> = {}, v: Record<string, unknown> = {}) =>
  render(items, extra, v).replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const $ = (n: number, m = "COP") => formatMoneda(n, m).replace(/\s+/g, "");
const plano = (t: string) => t.replace(/\s+/g, "");
const tiene = (t: string, frag: string) => plano(t).includes(plano(frag));
const veces = (t: string, frag: string) => plano(t).split(plano(frag)).length - 1;

describe("#94 · cotización del carrito con resumen: grupos de pasajeros, precio completo por persona y total", () => {
  const items = lineas(descripcionCotizacionManual);
  test("Caso A (los mismos 2 pasajeros tienen vuelo y tour): dos grupos y el total", () => {
    const t = texto(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a1", "a2"]) });
    assert.ok(tiene(t, `Adultos Alojamiento · Vuelo · Tour Islas del Rosario 2 ${$(1_000_000)} ${$(2_000_000)}`), "2 adultos a 1.000.000");
    assert.ok(tiene(t, `Adulto Alojamiento 1 ${$(300_000)} ${$(300_000)}`), "1 adulto solo alojamiento");
    assert.ok(tiene(t, `Total del contrato ${$(TOTAL)}`));
  });
  test("Caso B (pasajeros distintos): tres grupos, cada uno con su precio completo", () => {
    const t = texto(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a2", "a3"]) });
    assert.ok(tiene(t, `Adulto Alojamiento · Vuelo · Tour Islas del Rosario 1 ${$(1_000_000)}`));
    assert.ok(tiene(t, `Adulto Alojamiento · Vuelo 1 ${$(900_000)}`));
    assert.ok(tiene(t, `Adulto Alojamiento · Tour Islas del Rosario 1 ${$(400_000)}`));
  });
  test("ningún servicio lleva su propio importe y las descripciones de lo incluido se conservan", () => {
    const t = texto(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a2", "a3"]) });
    assert.equal(veces(t, $(1_200_000)), 0, "sin el precio del vuelo");
    assert.equal(veces(t, $(200_000)), 0, "sin el precio del tour");
    assert.doesNotMatch(t, /Servicios adicionales|Valor total del paquete|Tu asesor te detalla/);
    assert.match(t, /Vuelo/);
    assert.match(t, /Tour Islas del Rosario/);
  });
  test("#52: el nombre comercial del paquete sale en «Servicio / Plan» y la categoría y el régimen, separados", () => {
    const t = texto(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a1", "a2"]) });
    assert.match(t, /Servicio \/ Plan Cartagena Esencial/);
    assert.match(t, /Cartagena Esencial · Hotel Almirante Categoría: Estándar Alimentación: PC/);
  });
});

describe("#94 · el documento conserva el acuerdo: un resumen que no coincide no se usa", () => {
  const items = lineas(descripcionCotizacionManual);
  const sinResumen = (t: string) => assert.ok(!/Cartagena Esencial/.test(t) && !/Categoría: Estándar/.test(t));
  test("NETO: solo con modalidad neto y el total exigible; un resumen PVP en un documento NETO se ignora", () => {
    const neto = resumenDe(["a1", "a2"], ["a1", "a2"], { modalidad: "neto" });
    assert.match(texto(items, { resumenPrecios: neto, netoTotalExigible: TOTAL }), /Tarifa por persona NETO/);
    sinResumen(texto(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a1", "a2"]), netoTotalExigible: TOTAL }));
    sinResumen(texto(items, { resumenPrecios: neto })); // documento PVP con resumen NETO
  });
  test("moneda: el resumen debe estar en la moneda de la oferta; en USD se muestra en USD", () => {
    const usd = resumenDe(["a1", "a2"], ["a1", "a2"], { moneda: "USD" });
    sinResumen(texto(items, { resumenPrecios: usd })); // documento COP
    assert.ok(tiene(texto(items, { resumenPrecios: usd }, { moneda: "USD" }), $(1_000_000, "USD")));
  });
  test("si el total vigente cambió (precio corregido), el resumen anterior no se muestra", () => {
    const corregidos = [items[0], items[1], { ...items[2], valor_total: 250_000 }];
    sinResumen(texto(corregidos, { resumenPrecios: resumenDe(["a1", "a2"], ["a1", "a2"]) }));
  });
  test("un resumen alterado (la tarifa ya no multiplica a su subtotal) se ignora", () => {
    const r = resumenDe(["a1", "a2"], ["a1", "a2"]);
    r.unidades[0].grupos[0].tarifaCentavos += 1;
    sinResumen(texto(items, { resumenPrecios: r }));
  });
  test("el contrato convertido usa el mismo resumen (líneas con la descripción del contrato) y el mismo total", () => {
    const contrato = lineas(descripcionContratoManual);
    const t = texto(contrato, { esCotizacion: false, resumenPrecios: resumenDe(["a1", "a2"], ["a2", "a3"]) }, { estado: "confirmado" });
    assert.ok(tiene(t, `Adulto Alojamiento · Vuelo 1 ${$(900_000)}`));
    assert.ok(tiene(t, `Total del contrato ${$(TOTAL)}`));
    assert.equal(veces(t, $(1_200_000)), 0);
  });
  test("sin resumen el documento queda como antes (no hay tabla de grupos)", () => {
    assert.ok(!render(items).includes('data-testid="resumen-precios"'));
  });
});

describe("#94 · varias unidades (cotización múltiple): cada una con su paquete, su hotel y sus grupos", () => {
  test("dos unidades suman el total general", () => {
    const u = (ref: string, hotel: string, paquete: string, base: number) => {
      return unidadOk(resumenUnidad({ ref, paquete: { id: 1, nombre: paquete }, hotel, categoria: "Superior", regimen: "PAM", cupos: [{ id: "a1", tipo: "adulto", baseCentavos: base }], servicios: [] }));
    };
    const resumen = JSON.parse(JSON.stringify(resumenCotizacion({ modalidad: "pvp", moneda: "COP", unidades: [u("item-0", "Hotel Sol", "Paquete Sol", 40_000_000), u("item-1", "Hotel Luna", "Paquete Luna", 50_000_000)] })));
    const items = [it(1, "Sol", { adultos: 1, tarifa_adulto: 400_000 }), it(2, "Luna", { adultos: 1, tarifa_adulto: 500_000 })];
    const t = texto(items, { resumenPrecios: resumen });
    assert.match(t, /Paquete Sol · Hotel Sol/);
    assert.match(t, /Paquete Luna · Hotel Luna/);
    assert.ok(tiene(t, `Total del contrato ${$(900_000)}`));
  });
});

// ── #17 (se conserva): la cotización muestra número de vuelo y horas; el contrato, no ──
describe("#17 · el contrato no muestra horarios ni número de vuelo; la cotización sí", () => {
  const tramo = { id: 10, numero_contrato: "00-0999", aerolinea: "Avianca", record: null, direccion: "ida", numero_vuelo: "AV9123", hora_salida: "05:10", hora_llegada: "06:25", origen_codigo: "BOG", origen_ciudad: "Bogotá", destino_codigo: "CTG", destino_ciudad: "Cartagena", servicios: "Equipaje de mano", fecha_salida: "2030-10-15" };
  const legacy = { id: 11, numero_contrato: "00-0999", aerolinea: "Avianca", record: "ABC123", origen_codigo: "BOG", destino_codigo: "CTG", servicios: "BOG - CTG - BOG", fecha_salida: "2030-10-15", fecha_regreso: "2030-10-18", vuelo_ida: "AV9123", hora_salida_ida: "05:10", hora_llegada_ida: "06:25", vuelo_regreso: "AV9124", hora_salida_reg: "18:20", hora_llegada_reg: "19:35" };
  const hotel = [it(1, "1 hab Triple (3 pax) · Estándar / PC", { adultos: 3, tarifa_adulto: 300_000 })];
  test("contrato", () => assert.doesNotMatch(texto(hotel, { vuelos: [tramo], esCotizacion: false }), /AV9123|05:10|06:25/));
  test("cotización", () => assert.match(texto(hotel, { vuelos: [tramo] }), /AV9123/));
  test("contratos históricos (ida y regreso en una fila): el contrato no los muestra", () => {
    const t = texto(hotel, { vuelos: [legacy], esCotizacion: false });
    assert.doesNotMatch(t, /AV912|05:10|06:25|18:20|19:35|ABC123/);
    assert.match(t, /Ida:.*15 de octubre de 2030/);
    assert.match(t, /Regreso:.*18 de octubre de 2030/);
  });
  test("cotización con histórico: conserva número de vuelo y horarios de ida y regreso", () => {
    const t = texto(hotel, { vuelos: [legacy] });
    assert.match(t, /vuelo AV9123/);
    assert.match(t, /05:10–06:25/);
    assert.match(t, /vuelo AV9124/);
    assert.doesNotMatch(t, /ABC123/);
  });
});
