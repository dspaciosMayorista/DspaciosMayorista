// Se ejecuta con npm run test:react (loader del arnés).
//
// #94/#52 — lo que VE EL CLIENTE. Se renderiza el componente real `ContratoDocumento` con un resumen de precios estructurado (el mismo objeto JSON que se guarda al
// cotizar): grupos de pasajeros con precio completo por persona y subtotal, el total y NINGÚN importe por servicio. Si el resumen no coincide con el acuerdo
// (modalidad, moneda, total) el documento no lo usa. #17 (vuelos en cotización vs contrato) se conserva al final.
import { test, describe } from "node:test";
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";
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
  const props = { venta: { ...venta, ...v }, pasajeros: [], hoteles: HOTELES, vuelos: [], items, totalPagado: 0, agencia: AGENCIA_PRUEBA, condiciones: null, habitacionesBernalo: [], esCotizacion: true, codigo: "COT-1", vigenciaHasta: "2030-10-10", netoTotalExigible: null, ...extra };
  return renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, { ...props, agencia: (props as { agencia?: unknown }).agencia ?? AGENCIA_PRUEBA }));
}
const texto = (items: unknown[], extra: Record<string, unknown> = {}, v: Record<string, unknown> = {}) =>
  render(items, extra, v).replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const $ = (n: number, m = "COP") => formatMoneda(n, m).replace(/\s+/g, "");
const plano = (t: string) => t.replace(/\s+/g, "");
const tiene = (t: string, frag: string) => plano(t).includes(plano(frag));
const veces = (t: string, frag: string) => plano(t).split(plano(frag)).length - 1;

// Estructura de siempre de «Valores y Pagos»: Ítem · Adultos · Niños · Tarifa Adulto · Tarifa Niño · Valor total. Una fila por grupo (mismo tipo, tarifa y servicios).
// #52: el fixture trae nombre comercial («Cartagena Esencial»): el Ítem es «Paquete Turístico {nombre}».
const ITEM = "Paquete Turístico Cartagena Esencial";
const filasDe = (html: string) => [...html.matchAll(/<tr[^>]*data-testid="resumen-(?:grupo|ajuste)"[^>]*>(.*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").replace(/&nbsp;| /g, " ").trim()));
const encabezados = (html: string) => [...(html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/)?.[1] ?? "").matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").trim());
const monto = (n: number, m = "COP") => formatMoneda(n, m).replace(/\s+/g, "");
const limpio = (celdas: string[]) => celdas.map((c) => c.replace(/\s+/g, ""));

describe("#94 · cotización del carrito con resumen: estructura de siempre, una fila por grupo y precio completo por pasajero", () => {
  const items = lineas(descripcionCotizacionManual);
  test("columnas en el orden de siempre con Ítem primero (sin Pasajeros/Incluye/Cant./Subtotal)", () => {
    const h = render(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a1", "a2"]) });
    assert.deepEqual(encabezados(h), ["Ítem", "Adultos", "Niños", "Tarifa Adulto", "Tarifa Niño", "Valor total"]);
    assert.doesNotMatch(texto(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a1", "a2"]) }), /Pasajeros Incluye|Incluye Cant|Subtotal/);
  });
  test("Caso A (los mismos 2 pasajeros tienen vuelo y tour): dos filas, 2 adultos a 1.000.000 y 1 adulto a 300.000", () => {
    const filas = filasDe(render(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a1", "a2"]) })).map(limpio);
    assert.deepEqual(filas, [
      [ITEM, "2", "0", monto(1_000_000), monto(0), monto(2_000_000)].map((c) => c.replace(/\s+/g, "")),
      [ITEM, "1", "0", monto(300_000), monto(0), monto(300_000)].map((c) => c.replace(/\s+/g, "")),
    ]);
    assert.ok(tiene(texto(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a1", "a2"]) }), `Total del contrato ${$(TOTAL)}`));
  });
  test("Caso B (pasajeros distintos): tres filas separadas, cada una con su precio completo (1.000.000, 900.000 y 400.000)", () => {
    const filas = filasDe(render(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a2", "a3"]) })).map(limpio);
    assert.deepEqual(filas.map((f) => [f[1], f[3], f[5]]), [["1", monto(1_000_000), monto(1_000_000)], ["1", monto(900_000), monto(900_000)], ["1", monto(400_000), monto(400_000)]]);
    assert.equal(new Set(filas.map((f) => f[0])).size, 1, "el mismo Ítem en todas las filas");
  });
  test("el Ítem es «Paquete Turístico {nombre comercial}» (#52) o el texto editado; nunca el hotel, la categoría ni los servicios", () => {
    const h = texto(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a2", "a3"]) });
    assert.match(h, /Paquete Turístico Cartagena Esencial/);
    const filas = filasDe(render(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a2", "a3"]) }));
    for (const f of filas) assert.doesNotMatch(f[0], /Hotel|Almirante|Estándar|PC|Vuelo|Tour|Alojamiento/);
    const editado = filasDe(render(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a2", "a3"]), tituloPaquete: "Escapada Caribe 2030" }));
    assert.ok(editado.every((f) => f[0] === "Escapada Caribe 2030"));
  });
  test("#52: con nombre comercial del paquete el Ítem es «Paquete Turístico {nombre}»; el texto editado sigue mandando", () => {
    const conNombre = resumenDe(["a1", "a2"], ["a2", "a3"]);
    conNombre.unidades[0].paquete = { id: 7, nombre: "Cartagena Puente Festivo" };
    const filas = filasDe(render(items, { resumenPrecios: conNombre }));
    assert.ok(filas.length > 0 && filas.every((f) => f[0] === "Paquete Turístico Cartagena Puente Festivo"), JSON.stringify(filas.map((f) => f[0])));
    for (const f of filas) assert.doesNotMatch(f[0], /Hotel|Almirante|Estándar|PC|Vuelo|Tour/);
    // Categoría y régimen permanecen en «Servicio / Plan».
    assert.ok(tiene(texto(items, { resumenPrecios: conNombre }), "Estándar · PC"));
    const editado = filasDe(render(items, { resumenPrecios: conNombre, tituloPaquete: "Escapada Caribe 2030" }));
    assert.ok(editado.every((f) => f[0] === "Escapada Caribe 2030"));
  });
  test("ningún servicio lleva su propio importe ni su descripción en la tabla de valores", () => {
    const html = render(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a2", "a3"]) });
    const bloque = html.slice(html.indexOf('data-testid="resumen-precios"'), html.indexOf("</table>", html.indexOf('data-testid="resumen-precios"')));
    const t = bloque.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert.equal(veces(t, $(1_200_000)), 0, "sin el precio del vuelo");
    assert.equal(veces(t, $(200_000)), 0, "sin el precio del tour");
    assert.doesNotMatch(t, /Vuelo|Tour Islas/);
    assert.doesNotMatch(texto(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a2", "a3"]) }), /Servicios adicionales|Valor total del paquete|Tu asesor te detalla/);
  });
  test("niños: van en la columna Niños con su propia tarifa; el infante cuenta como niño", () => {
    const u = unidadOk(resumenUnidad({ ...meta, cupos: [
      { id: "a1", tipo: "adulto", baseCentavos: 30_000_000 }, { id: "a2", tipo: "adulto", baseCentavos: 30_000_000 },
      { id: "n1", tipo: "nino", baseCentavos: 20_000_000 }, { id: "i1", tipo: "infante", baseCentavos: 0 },
    ], servicios: [] }));
    const r = JSON.parse(JSON.stringify(resumenCotizacion({ modalidad: "pvp", moneda: "COP", unidades: [u] })));
    const filas = filasDe(render([it(1, "x", { adultos: 2, tarifa_adulto: 300_000 }), it(2, "y", { ninos: 1, tarifa_nino: 200_000 })], { resumenPrecios: r })).map(limpio);
    assert.deepEqual(filas.map((f) => [f[1], f[2], f[3], f[4], f[5]]), [
      ["2", "0", monto(300_000), monto(0), monto(600_000)], ["0", "1", monto(0), monto(200_000), monto(200_000)], ["0", "1", monto(0), monto(0), monto(0)],
    ]);
  });
  test("el ajuste de redondeo sale como «Ajuste por redondeo» solo con su valor", () => {
    // 1.000,01 entre 3 pasajeros: 333,33 cada uno y un residuo de 2 centavos que se muestra aparte.
    const u = unidadOk(resumenUnidad({ ...meta, cupos, servicios: [{ id: "t", nombre: "Tour", modo: "total" as const, precioCentavos: 100_001, cubre: "todos" as const }] }));
    assert.equal(u.ajusteCentavos, 2);
    const r = JSON.parse(JSON.stringify(resumenCotizacion({ modalidad: "pvp", moneda: "COP", unidades: [u] })));
    const filas = filasDe(render([it(1, "z", { adultos: 3, tarifa_adulto: 300_000 }), it(2, "x", { modo_precio: "total", valor_total: 1000.01 })], { resumenPrecios: r }));
    assert.equal(filas.at(-1)![0], "Ajuste por redondeo");
    assert.deepEqual(filas.at(-1)!.slice(1, 5), ["—", "—", "—", "—"]);
    assert.ok(/0,02|0.02/.test(filas.at(-1)![5]));
  });
});

describe("#94 · el documento conserva el acuerdo: un resumen que no coincide no se usa", () => {
  const items = lineas(descripcionCotizacionManual);
  const sinResumen = (html: string) => assert.ok(!html.includes('data-testid="resumen-precios"'));
  test("NETO: un resumen PVP en un documento NETO se ignora y uno NETO sin el total exigible también", () => {
    const neto = resumenDe(["a1", "a2"], ["a1", "a2"], { modalidad: "neto" });
    assert.ok(render(items, { resumenPrecios: neto, netoTotalExigible: TOTAL }).includes('data-testid="resumen-precios"'));
    assert.match(render(items, { resumenPrecios: neto, netoTotalExigible: TOTAL }), /Tarifa Adulto NETO/);
    sinResumen(render(items, { resumenPrecios: resumenDe(["a1", "a2"], ["a1", "a2"]), netoTotalExigible: TOTAL }));
    sinResumen(render(items, { resumenPrecios: neto })); // documento PVP con resumen NETO
  });
  test("moneda: el resumen debe estar en la moneda de la oferta; en USD se muestra en USD", () => {
    const usd = resumenDe(["a1", "a2"], ["a1", "a2"], { moneda: "USD" });
    sinResumen(render(items, { resumenPrecios: usd })); // documento COP
    assert.ok(tiene(texto(items, { resumenPrecios: usd }, { moneda: "USD" }), $(1_000_000, "USD")));
  });
  test("si el total vigente cambió (precio corregido), el resumen anterior no se muestra", () => {
    const corregidos = [items[0], items[1], { ...items[2], valor_total: 250_000 }];
    sinResumen(render(corregidos, { resumenPrecios: resumenDe(["a1", "a2"], ["a1", "a2"]) }));
  });
  test("un resumen alterado (la tarifa ya no multiplica a su subtotal) se ignora", () => {
    const r = resumenDe(["a1", "a2"], ["a1", "a2"]);
    r.unidades[0].grupos[0].tarifaCentavos += 1;
    sinResumen(render(items, { resumenPrecios: r }));
  });
  test("el contrato convertido usa el mismo resumen y el mismo total", () => {
    const contrato = lineas(descripcionContratoManual);
    const html = render(contrato, { esCotizacion: false, resumenPrecios: resumenDe(["a1", "a2"], ["a2", "a3"]) }, { estado: "confirmado" });
    assert.deepEqual(filasDe(html).map((f) => limpio(f)[5]), [monto(1_000_000), monto(900_000), monto(400_000)]);
    assert.ok(tiene(texto(contrato, { esCotizacion: false, resumenPrecios: resumenDe(["a1", "a2"], ["a2", "a3"]) }, { estado: "confirmado" }), `Total del contrato ${$(TOTAL)}`));
  });
  test("sin resumen el documento queda como antes (no hay tabla de grupos)", () => {
    assert.ok(!render(items).includes('data-testid="resumen-precios"'));
  });
});

describe("#94 · varias unidades (cotización múltiple): sus filas suman el total general", () => {
  test("dos unidades suman el total general", () => {
    const u = (ref: string, hotel: string, paquete: string, base: number) => {
      return unidadOk(resumenUnidad({ ref, paquete: { id: 1, nombre: paquete }, hotel, categoria: "Superior", regimen: "PAM", cupos: [{ id: "a1", tipo: "adulto", baseCentavos: base }], servicios: [] }));
    };
    const resumen = JSON.parse(JSON.stringify(resumenCotizacion({ modalidad: "pvp", moneda: "COP", unidades: [u("item-0", "Hotel Sol", "Paquete Sol", 40_000_000), u("item-1", "Hotel Luna", "Paquete Luna", 50_000_000)] })));
    const items = [it(1, "Sol", { adultos: 1, tarifa_adulto: 400_000 }), it(2, "Luna", { adultos: 1, tarifa_adulto: 500_000 })];
    const filas = filasDe(render(items, { resumenPrecios: resumen })).map(limpio);
    assert.deepEqual(filas.map((f) => f[5]), [monto(400_000), monto(500_000)]);
    assert.ok(tiene(texto(items, { resumenPrecios: resumen }), `Total del contrato ${$(900_000)}`));
  });
});

describe("#94 · adultos y niños en una misma fila: tabla, tarjetas móviles e impresión", () => {
  const cupo = (id: string, tipo: "adulto" | "nino" | "nino2" | "infante", pesos: number) => ({ id, tipo, baseCentavos: pesos * 100 });
  const resumenCon = (cupos: ReturnType<typeof cupo>[], servicios: ReturnType<typeof servicio>[] = []) => {
    const u = unidadOk(resumenUnidad({ ...meta, cupos, servicios }));
    return JSON.parse(JSON.stringify(resumenCotizacion({ modalidad: "pvp", moneda: "COP", unidades: [u] })));
  };
  const movil = (html: string) => {
    const i = html.indexOf('data-testid="resumen-movil"');
    const bloque = html.slice(i, html.indexOf("</div>", html.indexOf("</dl>", i) + 5) + 6);
    return { dl: (html.slice(i).split('data-testid="resumen-movil"')[1] ?? "").split("<dl").length - 1, texto: bloque.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ") };
  };
  const dlCount = (html: string) => {
    const i = html.indexOf('data-testid="resumen-movil"');
    const fin = html.indexOf('<div class="hidden overflow-x-auto', i);
    return (html.slice(i, fin).match(/<dl/g) ?? []).length;
  };
  const itemsDe = (...x: ReturnType<typeof it>[]) => x;

  test("OBLIGATORIA: 2 adultos a 413.000 y 1 niño a 191.000 → una fila con total 1.017.000 (tabla, tarjeta móvil e impresión)", () => {
    const items = itemsDe(it(1, "2 adultos", { adultos: 2, tarifa_adulto: 413_000 }), it(2, "1 niño", { ninos: 1, tarifa_nino: 191_000 }));
    const html = render(items, { resumenPrecios: resumenCon([cupo("a1", "adulto", 413_000), cupo("a2", "adulto", 413_000), cupo("n1", "nino", 191_000)]) });
    // Tabla (también lo que se imprime: `print:block`).
    const filas = filasDe(html).map(limpio);
    assert.deepEqual(filas, [[ITEM, "2", "1", monto(413_000), monto(191_000), monto(1_017_000)].map((c) => c.replace(/\s+/g, ""))]);
    assert.match(html, /hidden overflow-x-auto sm:block print:block/, "la tabla es la que sale al imprimir");
    // Tarjeta móvil: una sola, con ambas cantidades, ambas tarifas y el total sumado; no se imprime.
    assert.match(html, /space-y-2 sm:hidden print:hidden" data-testid="resumen-movil"/);
    assert.equal(dlCount(html), 1);
    const t = movil(html).texto;
    for (const frag of ["Adultos (2)", "Niños (1)", monto(413_000), monto(191_000), monto(1_017_000)]) assert.ok(plano(t).includes(plano(frag)), frag);
    assert.ok(tiene(texto(items, { resumenPrecios: resumenCon([cupo("a1", "adulto", 413_000), cupo("a2", "adulto", 413_000), cupo("n1", "nino", 191_000)]) }), `Total del contrato ${$(1_017_000)}`));
  });

  test("servicio parcial que cubre solo a los adultos: filas separadas en tabla y tarjetas", () => {
    const items = itemsDe(it(1, "2 adultos", { adultos: 2, tarifa_adulto: 400_000 }), it(2, "1 niño", { ninos: 1, tarifa_nino: 200_000 }), it(3, "servicio", { modo_precio: "total", valor_total: 200_000 }));
    const html = render(items, { resumenPrecios: resumenCon([cupo("a1", "adulto", 400_000), cupo("a2", "adulto", 400_000), cupo("n1", "nino", 200_000)], [servicio("t", "Tour", 200_000, ["a1", "a2"])]) });
    assert.deepEqual(filasDe(html).map(limpio).map((f) => [f[1], f[2], f[3], f[4], f[5]]), [
      ["2", "0", monto(500_000), monto(0), monto(1_000_000)], ["0", "1", monto(0), monto(200_000), monto(200_000)],
    ]);
    assert.equal(dlCount(html), 2);
  });

  test("servicio que cubre a adultos y niño por igual: una fila", () => {
    const items = itemsDe(it(1, "2 adultos", { adultos: 2, tarifa_adulto: 400_000 }), it(2, "1 niño", { ninos: 1, tarifa_nino: 200_000 }), it(3, "servicio", { modo_precio: "total", valor_total: 300_000 }));
    const html = render(items, { resumenPrecios: resumenCon([cupo("a1", "adulto", 400_000), cupo("a2", "adulto", 400_000), cupo("n1", "nino", 200_000)], [servicio("t", "Tour", 300_000, ["a1", "a2", "n1"])]) });
    assert.deepEqual(filasDe(html).map(limpio).map((f) => [f[1], f[2], f[3], f[4], f[5]]), [["2", "1", monto(500_000), monto(300_000), monto(1_300_000)]]);
    assert.equal(dlCount(html), 1);
  });

  test("niños con tarifas diferentes (niño 1 y niño 2): filas separadas en tabla y tarjetas, sin promediar", () => {
    const items = itemsDe(it(1, "1 adulto", { adultos: 1, tarifa_adulto: 413_000 }), it(2, "niño 1", { ninos: 1, tarifa_nino: 191_000 }), it(3, "niño 2", { ninos: 1, tarifa_nino: 150_000 }));
    const html = render(items, { resumenPrecios: resumenCon([cupo("a1", "adulto", 413_000), cupo("n1", "nino", 191_000), cupo("n2", "nino2", 150_000)]) });
    assert.deepEqual(filasDe(html).map(limpio).map((f) => [f[1], f[2], f[3], f[4], f[5]]), [
      ["1", "0", monto(413_000), monto(0), monto(413_000)], ["0", "1", monto(0), monto(191_000), monto(191_000)], ["0", "1", monto(0), monto(150_000), monto(150_000)],
    ]);
    assert.equal(dlCount(html), 3);
    assert.ok(!html.includes(monto(170_500)), "no hay promedio de las dos tarifas de niño");
  });

  test("el contrato convertido usa la misma presentación combinada", () => {
    const items = itemsDe(it(1, "2 adultos", { adultos: 2, tarifa_adulto: 413_000 }), it(2, "1 niño", { ninos: 1, tarifa_nino: 191_000 }));
    const html = render(items, { esCotizacion: false, resumenPrecios: resumenCon([cupo("a1", "adulto", 413_000), cupo("a2", "adulto", 413_000), cupo("n1", "nino", 191_000)]) }, { estado: "confirmado" });
    assert.equal(filasDe(html).length, 1);
    assert.equal(dlCount(html), 1);
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
