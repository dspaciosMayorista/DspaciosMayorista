// Se ejecuta con npm run test:react (loader del arnés).
//
// Tarifa del PAQUETE por pasajero: una sola fila comercial con el vuelo y los servicios repartidos entre los pasajeros que cubren (centavos, residuo determinista),
// en el documento REAL de la cotización (PVP y NETO) y en cada opción de la comparativa (PVP y NETO desde el plan B2B congelado). Nada se muestra dos veces.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { TarifaPaqueteOpcion } = await import("../components/cotizacion/ListasIncluye.tsx");
const { validarServicioManual, tramosVueloManual, descripcionCotizacionManual } = await import("../lib/cart/servicioManual.ts");
const { tarifaPaquete, tarifaPaqueteOpcion, snapshotPaqueteDePayload, netoDePlan } = await import("../lib/cotizacion/tarifaPaquete.ts");
const { construirPlanB2B } = await import("../lib/cotizacion/asistidaB2B.ts");
const { incluyeParaMostrar, sugerirIncluyeCarrito } = await import("../lib/cotizacion/incluye.ts");
const { formatoExacto } = await import("../lib/contrato/repartoTarifa.ts");

const cent = (n: number) => Math.round(n * 100);
const valido = (raw: unknown) => { const r = validarServicioManual(raw); assert.ok(r.ok, r.ok ? "" : r.error); return (r as { valor: Parameters<typeof tramosVueloManual>[0] }).valor; };
const vueloBase = { clase: "vuelo", nombre: "Tiquete Avianca", pax: 3, precio: 450_000, moneda: "COP", impuestoNoComisionable: 0, hotelRef: "h1", origen: "BOG", destino: "CTG", tramo: "ida", fechaIda: "2030-10-15", fechaRegreso: null };
const servBase = { clase: "otro", nombre: "Traslado privado", pax: 3, precio: 347_000, moneda: "COP", impuestoNoComisionable: 0 };

const venta = {
  numero_contrato: "", cliente: "Cliente Prueba", cliente_documento: "1000", cliente_direccion: null, cliente_telefono: null, asesor: "Asesora", asesor_firma_nombre: "Asesora",
  asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "pendiente", fecha_emision: "2030-10-01", fecha_salida: "2030-10-15",
  pax: 3, plan_nombre: null, tours_traslados: null, asistencia_medica: null, moneda: "COP", tenant: "mayorista", tipo_asesor: null, agencia_nombre: null, freelance_nombre: null,
};
// Alojamiento: 2 adultos × 667.000 = 1.334.000 + 1 niño × 551.000.
const itemHotel = { id: 1, numero_contrato: "", descripcion: "Hotel Almirante · Estándar / PC", adultos: 2, ninos: 1, tarifa_adulto: 667_000, tarifa_nino: 551_000, orden: 0, modo_precio: "por_persona", valor_total: null };
const HOTELES = [{ id: 1, nombre: "Hotel Almirante", categoria: "Estándar", ciudad: "Cartagena", alimentacion: "PC", acomodacion: "Doble", fecha_ingreso: "2030-10-15", fecha_salida: "2030-10-18" }];
const lineaManual = (m: Parameters<typeof tramosVueloManual>[0], id: number) => ({ id, numero_contrato: "", descripcion: descripcionCotizacionManual(m), adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0, orden: id, modo_precio: "total", valor_total: m.precio });
const tramos = (m: Parameters<typeof tramosVueloManual>[0], id: number) => tramosVueloManual(m, true).map((t, i) => ({ id: id * 10 + i, numero_contrato: "", ...t }));

function html(items: unknown[], vuelos: unknown[], netoTotalExigible: number | null = null, paqueteSnapshot: unknown = null) {
  const props = { venta, pasajeros: [], hoteles: HOTELES, vuelos, items, totalPagado: 0, agencia: null, condiciones: null, habitacionesBernalo: [], esCotizacion: true, codigo: "COT-1", vigenciaHasta: "2030-10-10", netoTotalExigible, paqueteSnapshot };
  return renderToStaticMarkup(createElement(ContratoDocumento as ComponentType<Record<string, unknown>>, props));
}
const plano = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const sinEspacios = (t: string) => t.replace(/\s+/g, "");
/** Importes (con centavos) que el documento imprime en un fragmento, en centavos. */
const montos = (t: string) => [...t.matchAll(/\$\s?([0-9.]+(?:,[0-9]{2})?)/g)].map((m) => Math.round(Number(m[1].replace(/\./g, "").replace(",", ".")) * 100));
const fila = (h: string) => { const i = h.indexOf('data-testid="fila-paquete-turistico"'); return h.slice(i, h.indexOf("</tr>", i)); };

describe("tarifaPaquete (puro): reparto en centavos", () => {
  test("caso del dueño: 2 × 932.666,67 + 1 × 816.666,66 = 2.682.000 (vuelo 450.000 y servicio 347.000 para los 3)", () => {
    const r = tarifaPaquete({ adultos: 2, ninos: 1, baseAdultoCentavos: cent(1_334_000), baseNinoCentavos: cent(551_000), adicionales: [{ nombre: "Vuelo", centavos: cent(450_000), pax: 3 }, { nombre: "Traslado", centavos: cent(347_000), pax: 3 }] });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.tarifaAdulto, [{ tarifa: 932_666.67, cantidad: 2 }]);
    assert.deepEqual(r.tarifaNino, [{ tarifa: 816_666.66, cantidad: 1 }]);
    const suma = r.tarifaAdulto.reduce((s, p) => s + cent(p.tarifa) * p.cantidad, 0) + r.tarifaNino.reduce((s, p) => s + cent(p.tarifa) * p.cantidad, 0);
    assert.equal(suma, cent(2_682_000));
    assert.equal(r.totalCentavos, cent(2_682_000));
  });
  test("residuo determinista: va a las primeras personas (adultos primero) y es estable entre llamadas", () => {
    const e = { adultos: 2, ninos: 1, baseAdultoCentavos: 0, baseNinoCentavos: 0, adicionales: [{ nombre: "X", centavos: 1000, pax: 3 }] }; // 10,00 / 3
    const a = tarifaPaquete(e), b = tarifaPaquete(e);
    assert.deepEqual(a, b);
    assert.ok(a.ok);
    if (a.ok) { assert.deepEqual(a.tarifaAdulto, [{ tarifa: 3.34, cantidad: 1 }, { tarifa: 3.33, cantidad: 1 }]); assert.deepEqual(a.tarifaNino, [{ tarifa: 3.33, cantidad: 1 }]); } // 334 + 333 + 333
  });
  test("adicional que cubre MENOS pasajeros, o sin dato: no se inventa; devuelve el total agregado y qué falta", () => {
    const parcial = tarifaPaquete({ adultos: 2, ninos: 1, baseAdultoCentavos: 100, baseNinoCentavos: 50, adicionales: [{ nombre: "el vuelo", centavos: 900, pax: 2 }] });
    assert.equal(parcial.ok, false);
    if (!parcial.ok) { assert.equal(parcial.totalCentavos, 1050); assert.match(parcial.motivo, /el vuelo cubre 2 de los 3 pasajeros/); }
    const sinDato = tarifaPaquete({ adultos: 1, ninos: 0, baseAdultoCentavos: 100, baseNinoCentavos: 0, adicionales: [{ nombre: "«Tour»", centavos: 900, pax: null }] });
    assert.equal(sinDato.ok, false);
    if (!sinDato.ok) assert.match(sinDato.motivo, /no se puede acreditar a cuántos pasajeros cubre «Tour»/);
  });
  test("pasajeros distintos entre adicionales (vuelo 3, servicio 2): no se reparte", () => {
    const r = tarifaPaquete({ adultos: 2, ninos: 1, baseAdultoCentavos: 1, baseNinoCentavos: 1, adicionales: [{ nombre: "Vuelo", centavos: 3, pax: 3 }, { nombre: "Servicio", centavos: 2, pax: 2 }] });
    assert.equal(r.ok, false);
  });
});

const tourPayload = (pax: number | undefined, precio = 400_000) => ({ nombre: "City tour", destino: "CARTAGENA", precio, ...(pax === undefined ? {} : { pax }), categoria: "tour_traslado" });
const lineaTour = (id: number, precio = 400_000) => ({ id, numero_contrato: "", descripcion: "Servicio · City tour — CARTAGENA", adultos: 1, ninos: 0, tarifa_adulto: precio, tarifa_nino: 0, orden: id, modo_precio: null, valor_total: null });

/** Cotización con alojamiento (2 adultos + 1 niño = 1.885.000), un vuelo y un servicio manual; PVP o NETO con su plan B2B congelado. */
function escenario(o: { vueloPax?: number; servPax?: number; impVuelo?: number; neto?: boolean; pct?: number } = {}) {
  const vuelo = valido({ ...vueloBase, pax: o.vueloPax ?? 3, impuestoNoComisionable: o.impVuelo ?? 0 }), serv = valido({ ...servBase, pax: o.servPax ?? 3 });
  const payload: Record<string, unknown> = { items: [{ precio: 1_885_000 }], tours: [], manuales: [vuelo, serv] };
  let exigible: number | null = null;
  if (o.neto) {
    const p = construirPlanB2B({
      aliado: { id: 7, nombre: "Aliado", tipo: "agencia", pctAliado: o.pct ?? 0.1 }, pct: o.pct ?? 0.1, pctOrigen: "aliado", modo: "neta", moneda: "COP",
      lineas: [{ clave: "item-0", pvp: 1_885_000, impuesto: 0 }, { clave: "manual-0", pvp: 450_000, impuesto: o.impVuelo ?? 0 }, { clave: "manual-1", pvp: 347_000, impuesto: 0 }],
      actor: { id: "u", email: null, rol: "venta" }, congeladoEn: "2030-10-01T00:00:00Z",
    });
    assert.ok(p.ok, p.ok ? "" : p.error);
    if (!p.ok) throw new Error("plan");
    payload.b2bAsistido = p.plan;
    exigible = p.plan.total_exigible;
  }
  return { vuelo, serv, payload, exigible, items: [itemHotel, lineaManual(vuelo, 2), lineaManual(serv, 3)], vuelos: tramos(vuelo, 2), snap: snapshotPaqueteDePayload(payload, exigible) };
}
const render = (e: ReturnType<typeof escenario>, over: { snap?: unknown; exigible?: number | null } = {}) =>
  html(e.items, e.vuelos, over.exigible !== undefined ? over.exigible : e.exigible, "snap" in over ? over.snap : e.snap);
/** Importes de la fila del paquete: [tarifas…, total]. */
const tarifasYTotal = (h: string) => { const m = montos(plano(fila(h))); return { tarifas: m.slice(0, -1), total: m[m.length - 1] }; };
/** Suma de tarifas × cantidades para 2 adultos + 1 niño: los adultos salen como una tarifa × 2, o «1 × a» y «1 × b»; «$ 0» no cuenta. */
const sumaPersonas = (tarifas: number[]) => { const t = tarifas.filter((c) => c > 0); return t.length === 2 ? 2 * t[0] + t[1] : t.reduce((s, c) => s + c, 0); };

describe("documento real de la cotización: UNA fila comercial, cobertura del snapshot congelado", () => {
  test("PVP, cobertura completa (vuelo y servicio para los 3): 2 × $932.666,67 + 1 × $816.666,66 = $2.682.000 en una sola fila", () => {
    const e = escenario();
    const h = render(e);
    assert.deepEqual(montos(plano(fila(h))), [cent(932_666.67), cent(816_666.66), cent(2_682_000)]);
    const t = plano(h);
    assert.ok(sinEspacios(t).includes("Totaldelcontrato$2.682.000"));
    assert.equal(sinEspacios(t).split("$450.000").length - 1, 0);
    assert.equal(sinEspacios(t).split("$347.000").length - 1, 0);
    assert.equal(h.split("Valor total").length - 1, 1, "una sola columna de importes");
    assert.match(t, /Origen: .*BOG/);
    assert.match(t, /Traslado privado/);
  });
  test("servicio para 2 de 3 pasajeros: no se inventan tarifas; total agregado y explicación breve", () => {
    const h = render(escenario({ servPax: 2 }));
    assert.deepEqual(montos(plano(fila(h))), [cent(2_682_000)]);
    assert.match(plano(h), /No se muestra la tarifa por pasajero: «Traslado privado» cubre 2 de los 3 pasajeros/);
  });
  test("vuelo para 2 de 3: igual", () => {
    const h = render(escenario({ vueloPax: 2 }));
    assert.deepEqual(montos(plano(fila(h))), [cent(2_682_000)]);
    assert.match(plano(h), /el vuelo cubre 2 de los 3 pasajeros/);
  });
  test("servicio del TARIFARIO (tour) para los 3: la cobertura sale de payload.tours[].pax; para 2 de 3 no se reparte", () => {
    const vuelo = valido(vueloBase);
    const mk = (pax: number | undefined) => {
      const payload = { items: [{ precio: 1_885_000 }], tours: [tourPayload(pax)], manuales: [vuelo] };
      return html([itemHotel, lineaManual(vuelo, 2), lineaTour(3)], tramos(vuelo, 2), null, snapshotPaqueteDePayload(payload, null));
    };
    const completo = tarifasYTotal(mk(3));
    assert.equal(completo.total, cent(2_735_000));
    assert.equal(sumaPersonas(completo.tarifas), cent(2_735_000));
    assert.match(plano(mk(2)), /No se muestra la tarifa por pasajero: «City tour» cubre 2 de los 3 pasajeros/);
    assert.deepEqual(montos(plano(fila(mk(2)))), [cent(2_735_000)]);
  });
  test("línea histórica sin cobertura acreditable (sin snapshot, o su entrada no coincide): total agregado, NO se usa venta.pax ni el texto de la línea", () => {
    const e = escenario();
    const sinSnapshot = render(e, { snap: null });
    assert.deepEqual(montos(plano(fila(sinSnapshot))), [cent(2_682_000)]);
    assert.match(plano(sinSnapshot), /No se muestra la tarifa por pasajero: no se puede acreditar a cuántos pasajeros cubre el vuelo/);
    const otro = escenario();
    otro.snap!.adicionales.forEach((a) => { a.precioCentavos += 1; });
    assert.deepEqual(montos(plano(fila(render(e, { snap: otro.snap })))), [cent(2_682_000)]);
    const vuelo = valido(vueloBase);
    const h = html([itemHotel, lineaManual(vuelo, 2), lineaTour(3)], tramos(vuelo, 2), null, snapshotPaqueteDePayload({ items: [{ precio: 1_885_000 }], tours: [tourPayload(undefined)], manuales: [vuelo] }, null));
    assert.deepEqual(montos(plano(fila(h))), [cent(2_735_000)]);
  });
  test("el resumen que recibe el documento no trae comisión, impuesto ni el plan", () => {
    const e = escenario({ neto: true, impVuelo: 200_000 });
    assert.doesNotMatch(JSON.stringify(e.snap), /comision|impuesto|aliado|lineas/i);
  });

  test("NETO sin parte no comisionable: la fila ES el total exigible, tarifas × cantidades suman exacto y no hay PVP", () => {
    const e = escenario({ neto: true });
    const h = render(e);
    const { tarifas, total } = tarifasYTotal(h);
    assert.equal(total, cent(e.exigible!));
    assert.equal(sumaPersonas(tarifas), total);
    assert.ok(!sinEspacios(plano(h)).includes("$2.682.000"));
  });
  test("NETO con impuesto del vuelo NO comisionable y comisión con centavos: el impuesto queda íntegro y las tarifas suman EXACTAMENTE el exigible", () => {
    const e = escenario({ neto: true, impVuelo: 200_000, pct: 0.1234 });
    const plan = e.payload.b2bAsistido as { comision: number; total_exigible: number; pvp: number };
    assert.equal(cent(plan.pvp) - cent(plan.comision), cent(plan.total_exigible));
    const { tarifas, total } = tarifasYTotal(render(e));
    assert.equal(total, cent(plan.total_exigible));
    assert.equal(sumaPersonas(tarifas), total);
    const r = netoDePlan(e.payload, plan.total_exigible, plan.pvp)!;
    const base = 1_885_000 + (450_000 - 200_000) + 347_000;
    const comisionVuelo = Math.round((cent(plan.comision) * cent(250_000)) / cent(base));
    assert.ok(Math.abs(r.manuales[0] - (cent(450_000) - comisionVuelo)) <= 1, "neto del vuelo = PVP − su parte de comisión (calculada sin el impuesto)");
    assert.ok(r.manuales[0] >= cent(200_000), "el impuesto no comisionable queda íntegro");
    assert.equal(r.hotelNeto + r.manuales[0] + r.manuales[1], cent(plan.total_exigible));
  });
  test("NETO con cobertura parcial: solo el total exigible y la explicación", () => {
    const e = escenario({ neto: true, servPax: 2 });
    const h = render(e);
    assert.deepEqual(montos(plano(fila(h))), [cent(e.exigible!)]);
    assert.match(plano(h), /«Traslado privado» cubre 2 de los 3 pasajeros/);
  });
  test("NETO sin plan congelado (snapshot anterior) o que no cuadra: solo el total exigible", () => {
    const e = escenario();
    const exigible = 2_400_000.35;
    const sinPlan = html(e.items, e.vuelos, exigible, snapshotPaqueteDePayload(e.payload, exigible));
    assert.deepEqual(montos(plano(fila(sinPlan))), [cent(exigible)]);
    assert.match(plano(sinPlan), /falta el plan B2B congelado de esta cotización o no cuadra con su total/);
    const n = escenario({ neto: true });
    const noCuadra = render(n, { exigible: n.exigible! + 5 });
    assert.deepEqual(montos(plano(fila(noCuadra))), [cent(n.exigible! + 5)]);
  });
  test("PVP sin cambios con y sin plan en el snapshot: el mismo documento", () => {
    const base = escenario();
    const conPlan = escenario({ neto: true });
    assert.equal(plano(render(base)), plano(html(base.items, base.vuelos, null, conPlan.snap)));
  });
});

// ── Comparativa: opción de carrito con snapshot congelado ──
const hotelLinea = { descripcion: "Hotel Almirante · Estándar / PC", adultos: 2, ninos: 1, tarifa_adulto: 667_000, tarifa_nino: 551_000, modo_precio: "por_persona" };
function opcion(neto: boolean, over: { pctComision?: number; impuestoVuelo?: number } = {}) {
  const vuelo = valido({ ...vueloBase, impuestoNoComisionable: over.impuestoVuelo ?? 0 }), serv = valido(servBase);
  const payload: Record<string, unknown> = { items: [{ precio: 1_885_000, hotelNombre: "Hotel Almirante" }], tours: [], manuales: [vuelo, serv] };
  const total = 2_682_000;
  const detalle = { items: [hotelLinea, lineaManual(vuelo, 2), lineaManual(serv, 3)] };
  if (!neto) return { resumen: { total } as Record<string, unknown>, plantilla: { payload, detalle }, plan: null, total };
  const p = construirPlanB2B({
    aliado: { id: 7, nombre: "Aliado", tipo: "agencia", pctAliado: over.pctComision ?? 0.1 }, pct: over.pctComision ?? 0.1, pctOrigen: "aliado", modo: "neta", moneda: "COP",
    lineas: [{ clave: "item-0", pvp: 1_885_000, impuesto: 0 }, { clave: "manual-0", pvp: 450_000, impuesto: over.impuestoVuelo ?? 0 }, { clave: "manual-1", pvp: 347_000, impuesto: 0 }],
    actor: { id: "u", email: null, rol: "venta" }, congeladoEn: "2030-10-01T00:00:00Z",
  });
  assert.ok(p.ok, p.ok ? "" : p.error);
  if (!p.ok) throw new Error("plan");
  payload.b2bAsistido = p.plan;
  return { resumen: { total: p.plan.total_exigible, total_exigible: p.plan.total_exigible } as Record<string, unknown>, plantilla: { payload, detalle }, plan: p.plan, total };
}
const sumaTarifas = (r: { tarifaAdulto: { tarifa: number; cantidad: number }[]; tarifaNino: { tarifa: number; cantidad: number }[] }) =>
  [...r.tarifaAdulto, ...r.tarifaNino].reduce((s, p) => s + cent(p.tarifa) * p.cantidad, 0);

describe("comparativa: tarifa del paquete por opción", () => {
  test("PVP: la misma regla; etiqueta del PAQUETE, no solo del alojamiento", () => {
    const o = opcion(false);
    const r = tarifaPaqueteOpcion(o.resumen, o.plantilla, o.total);
    assert.ok(r && r.ok);
    if (!r || !r.ok) return;
    assert.equal(sumaTarifas(r), cent(2_682_000));
    const h = plano(renderToStaticMarkup(createElement(TarifaPaqueteOpcion, { paquete: r, moneda: "COP" })));
    assert.match(h, /Tarifa del paquete por pasajero \(incluye vuelos y servicios\)/);
    assert.match(h, /Adultos \(2\)/);
    assert.match(h, /Niños \(1\)/);
  });
  test("NETO sin parte no comisionable: total exigible exacto, sin PVP, el reparto suma el exigible", () => {
    const o = opcion(true);
    const r = tarifaPaqueteOpcion(o.resumen, o.plantilla, o.total);
    assert.ok(r && r.ok && r.neto);
    if (!r || !r.ok) return;
    assert.equal(r.totalCentavos, cent(o.plan!.total_exigible));
    assert.equal(sumaTarifas(r), cent(o.plan!.total_exigible));
    assert.notEqual(r.totalCentavos, cent(2_682_000));
  });
  test("NETO con impuesto del vuelo NO comisionable: la comisión no recae sobre él (menos comisión que si todo fuera comisionable)", () => {
    const con = opcion(true, { impuestoVuelo: 200_000 });
    const sin = opcion(true);
    const a = tarifaPaqueteOpcion(con.resumen, con.plantilla, con.total);
    const b = tarifaPaqueteOpcion(sin.resumen, sin.plantilla, sin.total);
    assert.ok(a && a.ok && b && b.ok);
    if (!a || !a.ok || !b || !b.ok) return;
    assert.equal(sumaTarifas(a), cent(con.plan!.total_exigible));
    assert.ok(con.plan!.total_exigible > sin.plan!.total_exigible);
  });
  test("opción NETO con un plan que no cuadra con el total: no inventa; explica", () => {
    const o = opcion(true);
    const r = tarifaPaqueteOpcion({ total: 1, total_exigible: o.plan!.total_exigible + 5 }, o.plantilla, o.total);
    assert.ok(r && !r.ok);
  });
  test("cotización guardada ANTES (snapshot sin campos nuevos): el congelado alcanza y no se reescribe nada", () => {
    const o = opcion(false);
    const copia = JSON.stringify(o.plantilla);
    const r = tarifaPaqueteOpcion(o.resumen, o.plantilla, o.total);
    assert.ok(r && r.ok);
    assert.equal(JSON.stringify(o.plantilla), copia, "solo lectura");
  });
  test("una opción PVP sin vuelo ni servicios sigue con la presentación de siempre (null)", () => {
    const o = opcion(false);
    assert.equal(tarifaPaqueteOpcion(o.resumen, { payload: { items: [{}], tours: [], manuales: [] }, detalle: { items: [hotelLinea] } }, 1_885_000), null);
  });
  test("formato con centavos", () => assert.match(formatoExacto(932_666.67, "COP"), /932\.666,67/));
});

describe("Incluye de una opción guardada antes: orden vigente solo si el texto no lo editó un asesor", () => {
  const payload = {
    items: [{ hotelNombre: "Hotel Almirante", categoria: "Estándar", regimen: "PC" }],
    tours: [{ nombre: "City tour", categoria: "tour_traslado" }],
    manuales: [{ clase: "vuelo", nombre: "Avianca" }, { clase: "otro", nombre: "Traslado privado" }],
  };
  const antiguo = "Alojamiento en Hotel Almirante (Estándar, plan PC)\nCity tour\nTiquetes aéreos (Avianca)\nTraslado privado";
  test("el texto antiguo generado se reconoce (idéntico a la propuesta anterior) y se muestra en el orden nuevo", () => {
    const nuevo = incluyeParaMostrar(antiguo, payload);
    assert.equal(nuevo, sugerirIncluyeCarrito(payload));
    assert.ok(nuevo.indexOf("Tiquetes aéreos") < nuevo.indexOf("Alojamiento"));
  });
  test("un texto editado por un asesor conserva SU orden", () => {
    const editado = "Traslado privado\nAlojamiento en Hotel Almirante (Estándar, plan PC)\nTiquetes aéreos (Avianca)\nCity tour";
    assert.equal(incluyeParaMostrar(editado, payload), editado);
    assert.equal(incluyeParaMostrar(antiguo + "\nSeguro", payload), antiguo + "\nSeguro");
    assert.equal(incluyeParaMostrar("", payload), "");
    assert.equal(incluyeParaMostrar(null, payload), null);
  });
});

describe("cableado: el documento público no lee el payload; el resumen viaja en detalle", () => {
  const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  test("el checkout guarda detalle.paqueteSnapshot derivado del payload y del total exigible; las dos páginas solo lo leen de detalle", () => {
    const acciones = leer("app/tarifario/checkout/actions.ts");
    assert.match(acciones, /paqueteSnapshot: snapshotPaqueteDePayload\(payloadCotizacion, planB2B && planB2B\.modo_compra === "neta" \? planB2B\.total_exigible : null\)/);
    for (const p of ["app/cot/[token]/page.tsx", "app/cotizacion/[id]/page.tsx"]) {
      const src = leer(p);
      assert.match(src, /paqueteSnapshot=\{d\.paqueteSnapshot \?\? null\}/, p);
      assert.doesNotMatch(src, /snapshotPaqueteDePayload|leerPlanB2BDePayload|b2bAsistido/, p);
    }
    assert.match(leer("app/cot/[token]/page.tsx"), /\.select\("codigo, detalle, vigencia_hasta, tenant, estado, fecha_salida"\)/);
  });
});

// ── Hotel normal con «Servicios incluidos por grupo» (línea de precio total, NO es Bernalo) + vuelo y servicio manual ──
const lineaGrupo = (id: number, valor = 300_000) => ({ id, numero_contrato: "", descripcion: "Hotel Almirante · Servicios incluidos por grupo", adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0, orden: id, modo_precio: "total", valor_total: valor });
const itemHotelGrupo = { ...itemHotel, tarifa_adulto: 600_000, tarifa_nino: 400_000 }; // 2 × 600.000 + 1 × 400.000 = 1.600.000; + grupo 300.000 = hotel 1.900.000

function escenarioGrupo(o: { neto?: boolean; infantes?: number; sinServicioLigado?: boolean; impVuelo?: number } = {}) {
  const vuelo = valido({ ...vueloBase, impuestoNoComisionable: o.impVuelo ?? 0 }), serv = valido(servBase);
  const payload: Record<string, unknown> = {
    items: [{ ref: "item-0", precio: 1_900_000, pax: 3, ninos: 1, infantes: o.infantes ?? 0 }],
    tours: [], manuales: [vuelo, serv],
    serviciosIncluidos: o.sinServicioLigado ? [] : [{ servicioId: 1, nombre: "Cena grupal", categoria: "otro", incluido: true, paqueteId: 1, ref: "item-0" }],
  };
  let exigible: number | null = null;
  if (o.neto) {
    const p = construirPlanB2B({
      aliado: { id: 7, nombre: "Aliado", tipo: "agencia", pctAliado: 0.1 }, pct: 0.1, pctOrigen: "aliado", modo: "neta", moneda: "COP",
      lineas: [{ clave: "item-0", pvp: 1_900_000, impuesto: 0 }, { clave: "manual-0", pvp: 450_000, impuesto: o.impVuelo ?? 0 }, { clave: "manual-1", pvp: 347_000, impuesto: 0 }],
      actor: { id: "u", email: null, rol: "venta" }, congeladoEn: "2030-10-01T00:00:00Z",
    });
    assert.ok(p.ok, p.ok ? "" : p.error);
    if (!p.ok) throw new Error("plan");
    payload.b2bAsistido = p.plan;
    exigible = p.plan.total_exigible;
  }
  const detalleItems = [itemHotelGrupo, lineaGrupo(4), lineaManual(vuelo, 2), lineaManual(serv, 3)];
  return { payload, exigible, items: detalleItems, vuelos: tramos(vuelo, 2), snap: snapshotPaqueteDePayload(payload, exigible), total: 2_697_000 };
}

describe("hotel normal con servicios incluidos por grupo: no se confunde con Bernalo y no se duplica", () => {
  test("PVP, cobertura acreditada: UN ítem; 2 × $965.666,67 + 1 × $765.666,66 = $2.697.000; la línea de grupo no se muestra aparte", () => {
    const e = escenarioGrupo();
    const copia = JSON.stringify(e.items);
    const h = html(e.items, e.vuelos, null, e.snap);
    assert.equal(JSON.stringify(e.items), copia, "los ítems (contables) no se alteran");
    assert.deepEqual(montos(plano(fila(h))), [cent(965_666.67), cent(765_666.66), cent(2_697_000)]);
    const t = sinEspacios(plano(h));
    assert.equal(t.split("$300.000").length - 1, 0, "el importe del grupo no se repite");
    assert.ok(t.includes("Totaldelcontrato$2.697.000"));
    assert.equal(h.split('data-testid="fila-paquete-turistico"').length - 1, 1);
  });
  test("cobertura NO acreditable (infantes, sin servicio ligado al hotel, sin snapshot): solo el total y la explicación", () => {
    for (const [nombre, h] of [
      ["infantes", (() => { const e = escenarioGrupo({ infantes: 1 }); return html(e.items, e.vuelos, null, e.snap); })()],
      ["sin servicio ligado", (() => { const e = escenarioGrupo({ sinServicioLigado: true }); return html(e.items, e.vuelos, null, e.snap); })()],
      ["sin snapshot", (() => { const e = escenarioGrupo(); return html(e.items, e.vuelos, null, null); })()],
    ] as const) {
      assert.deepEqual(montos(plano(fila(h))), [cent(2_697_000)], nombre);
      assert.match(plano(h), nombre === "sin snapshot" ? /pasajero: no se puede acreditar a cuántos pasajeros cubre el vuelo/ : /pasajero: no se puede acreditar a cuántos pasajeros cubre los servicios incluidos por grupo/, nombre);
      assert.equal(sinEspacios(plano(h)).split("$300.000").length - 1, 0, nombre);
    }
  });
  test("una línea de precio total que NO es de servicios por grupo (Bernalo) sigue impidiendo el ítem único", () => {
    const e = escenarioGrupo();
    const bernalo = { ...lineaGrupo(4), descripcion: "Hotel Bernalo · Habitación doble" };
    const h = html([itemHotelGrupo, bernalo, e.items[2], e.items[3]], e.vuelos, null, e.snap);
    assert.equal(h.includes('data-testid="fila-paquete-turistico"'), false);
  });
  test("NETO con plan: el NETO del hotel se reparte entre adultos, niño y servicio por grupo; tarifas × cantidades = exigible al centavo", () => {
    const e = escenarioGrupo({ neto: true, impVuelo: 100_000 });
    const h = html(e.items, e.vuelos, e.exigible, e.snap);
    const { tarifas, total } = tarifasYTotal(h);
    assert.equal(total, cent(e.exigible!));
    const t = tarifas.filter((c) => c > 0);
    assert.equal(t.length === 2 ? 2 * t[0] + t[1] : t.reduce((s, c) => s + c, 0), total);
    assert.ok(!sinEspacios(plano(h)).includes("$2.697.000"), "no se muestra el PVP como NETO");
  });
  test("NETO con cobertura no acreditable: solo el total exigible", () => {
    const e = escenarioGrupo({ neto: true, infantes: 1 });
    const h = html(e.items, e.vuelos, e.exigible, e.snap);
    assert.deepEqual(montos(plano(fila(h))), [cent(e.exigible!)]);
  });
  test("opción de comparativa PVP: la línea de grupo entra al reparto una sola vez y la suma es el total", () => {
    const e = escenarioGrupo();
    const r = tarifaPaqueteOpcion({ total: e.total }, { payload: e.payload, detalle: { items: e.items } }, e.total);
    assert.ok(r && r.ok);
    if (!r || !r.ok) return;
    assert.equal(r.totalCentavos, cent(e.total));
    assert.equal(sumaTarifas(r), cent(e.total));
  });
  test("opción de comparativa NETO: suma exacta del exigible; sin cobertura acreditable, total con motivo", () => {
    const e = escenarioGrupo({ neto: true });
    const resumen = { total: e.exigible, total_exigible: e.exigible };
    const r = tarifaPaqueteOpcion(resumen, { payload: e.payload, detalle: { items: e.items } }, e.total);
    assert.ok(r && r.ok && r.neto);
    if (!r || !r.ok) return;
    assert.equal(sumaTarifas(r), cent(e.exigible!));
    const sin = escenarioGrupo({ neto: true, infantes: 1 });
    const m = tarifaPaqueteOpcion({ total: sin.exigible, total_exigible: sin.exigible }, { payload: sin.payload, detalle: { items: sin.items } }, sin.total);
    assert.ok(m && !m.ok);
    if (m && !m.ok) { assert.equal(m.totalCentavos, cent(sin.exigible!)); assert.match(m.motivo, /los servicios incluidos por grupo/); }
  });
});
