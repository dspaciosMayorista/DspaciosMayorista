import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validarServicioManual, validarVueloContraHotel, tramosVueloManual, descripcionCotizacionManual, esLineaVueloManual,
  esTramoVueloManual, resolverHotelDeManuales, vuelosComunesCompatibles, verificarManualesCotizados, leerManualesEntrada,
  type ServicioManual,
} from "../lib/cart/servicioManual.ts";

// #64 (ronda 3) — el vuelo manual del carrito: ida / regreso / ida y regreso, ligado al hotel del carrito.

const base = { clase: "vuelo", nombre: "Tiquete Avianca", pax: 2, precio: 1_800_000, moneda: "COP", impuestoNoComisionable: 200_000, hotelRef: "h1" };
const ida = { ...base, tramo: "ida", origen: "BOG", destino: "Cartagena", fechaIda: "2030-02-28", fechaRegreso: null };
const regreso = { ...base, tramo: "regreso", origen: "Cartagena", destino: "BOG", fechaIda: null, fechaRegreso: "2030-03-04" };
const idaRegreso = { ...base, tramo: "ida_regreso", origen: "BOG", destino: "Cartagena", fechaIda: "2030-02-28", fechaRegreso: "2030-03-04" };
const HOTEL = { ref: "item-0", nombre: "Hotel Uno", destino: "CARTAGENA", fechaIda: "2030-02-28", fechaRegreso: "2030-03-04" };

const ok = (raw: unknown): ServicioManual => { const r = validarServicioManual(raw); assert.ok(r.ok, r.ok ? "" : r.error); return (r as { valor: ServicioManual }).valor; };

describe("tramos de un vuelo manual", () => {
  test("acepta ida, regreso e ida y regreso", () => {
    for (const v of [ida, regreso, idaRegreso]) assert.ok(validarServicioManual(v).ok, String(v.tramo));
  });
  test("exige el tramo y el hotel al que pertenece", () => {
    assert.equal(validarServicioManual({ ...ida, tramo: undefined }).ok, false);
    assert.equal(validarServicioManual({ ...ida, tramo: "vuelta" }).ok, false);
    assert.equal(validarServicioManual({ ...ida, hotelRef: "" }).ok, false);
    assert.equal(validarServicioManual({ ...ida, hotelRef: undefined }).ok, false);
  });
  test("cada tramo lleva SOLO sus fechas", () => {
    assert.equal(validarServicioManual({ ...ida, fechaRegreso: "2030-03-04" }).ok, false, "ida con fecha de regreso");
    assert.equal(validarServicioManual({ ...regreso, fechaIda: "2030-02-28" }).ok, false, "regreso con fecha de ida");
    assert.equal(validarServicioManual({ ...regreso, fechaRegreso: null }).ok, false, "regreso sin fecha");
    assert.equal(validarServicioManual({ ...idaRegreso, fechaRegreso: null }).ok, false, "ida y regreso sin regreso");
    assert.equal(validarServicioManual({ ...idaRegreso, fechaRegreso: "2030-02-01" }).ok, false, "regreso antes de la ida");
  });
  test("origen y destino distintos", () => {
    assert.equal(validarServicioManual({ ...ida, origen: "cartagena" , destino: "CARTAGENA" }).ok, false);
  });
  test("otro servicio conserva su comportamiento: sin tramo ni hotel", () => {
    const r = validarServicioManual({ clase: "otro", nombre: "Traslado privado", pax: 2, precio: 90_000, moneda: "COP", impuestoNoComisionable: 0, tramo: "ida", hotelRef: "h1" });
    assert.ok(r.ok);
    if (r.ok) { assert.equal(r.valor.tramo, null); assert.equal(r.valor.hotelRef, null); }
  });
  test("ida: dos tramos solo en ida y regreso, con el regreso invertido", () => {
    assert.deepEqual(tramosVueloManual(ok(ida), true).map((t) => [t.direccion, t.origen_codigo ?? t.origen_ciudad, t.destino_ciudad, t.fecha_salida]), [["ida", "BOG", "Cartagena", "2030-02-28"]]);
    const t = tramosVueloManual(ok(idaRegreso), true);
    assert.equal(t.length, 2);
    assert.equal(t[1].direccion, "regreso");
    assert.equal(t[1].origen_ciudad, "Cartagena");
    assert.equal(t[1].fecha_salida, "2030-03-04");
    assert.equal(tramosVueloManual(ok(regreso), true).length, 1);
  });
  test("el tramo no inventa record, aerolínea ni sillas y dice los pasajeros reales", () => {
    for (const t of tramosVueloManual(ok(idaRegreso), true)) {
      assert.equal(t.record, null);
      assert.equal(t.aerolinea, null);
      assert.ok(esTramoVueloManual(t));
      assert.match(String(t.servicios), /pasajeros en este vuelo: 2/);
      assert.match(String(t.servicios), /sujeto a confirmación de disponibilidad y tarifa/);
    }
    assert.doesNotMatch(String(tramosVueloManual(ok(idaRegreso), false)[0].servicios), /sujeto a confirmación/);
  });
  test("la descripción dice el tramo y la línea suelta se reconoce para ocultarla", () => {
    const d = descripcionCotizacionManual(ok(regreso));
    assert.match(d, /regreso/);
    assert.ok(esLineaVueloManual(d));
    assert.equal(esLineaVueloManual("Servicio · Traslado — sujeto a confirmación de disponibilidad y tarifa"), false);
    assert.equal(esLineaVueloManual("Hotel Uno · Estándar / PC"), false);
  });
});

describe("el vuelo contra el hotel del carrito", () => {
  test("el lado del hotel sale del hotel, no se escribe libremente", () => {
    const r = validarVueloContraHotel(ok(ida), HOTEL);
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (r.ok) { assert.equal(r.valor.destino, "CARTAGENA"); assert.equal(r.valor.hotelRef, "item-0"); assert.equal(r.valor.hotelEtiqueta, "Hotel Uno"); }
    const rr = validarVueloContraHotel(ok(regreso), HOTEL);
    assert.ok(rr.ok);
    if (rr.ok) assert.equal(rr.valor.origen, "CARTAGENA");
  });
  test("un destino distinto al del hotel (dato manipulado) se rechaza", () => {
    assert.equal(validarVueloContraHotel(ok({ ...ida, destino: "Santa Marta" }), HOTEL).ok, false);
    assert.equal(validarVueloContraHotel(ok({ ...regreso, origen: "Santa Marta" }), HOTEL).ok, false);
  });
  test("límites de fecha: la ida no antes de la entrada, el regreso no después de la salida", () => {
    assert.ok(validarVueloContraHotel(ok(ida), HOTEL).ok, "ida el mismo día de la entrada");
    assert.equal(validarVueloContraHotel(ok({ ...ida, fechaIda: "2030-02-27" }), HOTEL).ok, false, "un día antes de la entrada");
    assert.ok(validarVueloContraHotel(ok(regreso), HOTEL).ok, "regreso el día de la salida");
    assert.equal(validarVueloContraHotel(ok({ ...regreso, fechaRegreso: "2030-03-05" }), HOTEL).ok, false, "un día después de la salida");
    assert.equal(validarVueloContraHotel(ok({ ...idaRegreso, fechaRegreso: "2030-03-05" }), HOTEL).ok, false);
    assert.equal(validarVueloContraHotel(ok({ ...ida, fechaIda: "2030-03-05" }), HOTEL).ok, false, "ida después de la salida");
  });
  test("un hotel sin fechas o sin destino confirmados no admite vuelo", () => {
    assert.equal(validarVueloContraHotel(ok(ida), { ...HOTEL, fechaIda: null }).ok, false);
    assert.equal(validarVueloContraHotel(ok(ida), { ...HOTEL, destino: null }).ok, false);
  });
});

describe("resolver el hotel de cada vuelo (varios destinos)", () => {
  const itemsRaw = [{ itemId: "a" }, { itemId: "b" }];
  test("resuelve por el id del carrito", () => {
    const r = resolverHotelDeManuales(itemsRaw, [{ ...ida, hotelRef: "b" }]);
    assert.deepEqual(r.ok && r.posiciones, [1]);
  });
  test("un vuelo sin hotel, o con un hotel que no está en el carrito, se rechaza (nunca el primero)", () => {
    assert.equal(resolverHotelDeManuales(itemsRaw, [{ ...ida, hotelRef: "zzz" }]).ok, false);
    assert.equal(resolverHotelDeManuales(itemsRaw, [{ ...ida, hotelRef: null }]).ok, false);
  });
  test("otro servicio no necesita hotel", () => {
    const r = resolverHotelDeManuales(itemsRaw, [{ clase: "otro", nombre: "x" }]);
    assert.deepEqual(r.ok && r.posiciones, [null]);
  });
});

describe("verificarManualesCotizados mira también el cuadro de vuelos", () => {
  const cotizado = (m: ServicioManual) => {
    const l = { ...m, hotelRef: "item-0", hotelEtiqueta: "Hotel Uno" };
    return {
      payload: { manuales: [l], items: [{ ref: "item-0" }] },
      detalleItems: [{ descripcion: descripcionCotizacionManual(l), valor_total: l.precio }],
      detalleVuelos: tramosVueloManual(l, true).map((t, i) => ({ id: i + 1, ...t })) as Record<string, unknown>[],
      plan: null, moneda: "COP", refsHoteles: ["item-0"],
    };
  };
  test("lo cotizado tal cual pasa", () => {
    assert.ok(verificarManualesCotizados(cotizado(ok(idaRegreso))).ok);
  });
  test("falla si cambia el precio, la ruta, el tipo, la fecha, los pasajeros o el hotel", () => {
    const m = ok(idaRegreso);
    const cambios: Array<[string, (c: ReturnType<typeof cotizado>) => void]> = [
      ["precio", (c) => { (c.payload.manuales[0] as { precio: number }).precio = 1; }],
      ["ruta en el cuadro", (c) => { c.detalleVuelos[0].destino_ciudad = "Cali"; }],
      ["fecha en el cuadro", (c) => { c.detalleVuelos[1].fecha_salida = "2030-03-06"; }],
      ["pasajeros en el cuadro", (c) => { c.detalleVuelos[0].servicios = String(c.detalleVuelos[0].servicios).replace("2", "9"); }],
      ["tramo borrado del cuadro", (c) => { c.detalleVuelos.pop(); }],
      ["cuadro vacío", (c) => { c.detalleVuelos.length = 0; }],
      ["tipo", (c) => { (c.payload.manuales[0] as { tramo: string }).tramo = "ida"; }],
      ["pasajeros en el bloque", (c) => { (c.payload.manuales[0] as { pax: number }).pax = 3; }],
      ["hotel inexistente", (c) => { (c.payload.manuales[0] as { hotelRef: string }).hotelRef = "item-7"; }],
    ];
    for (const [n, f] of cambios) { const c = cotizado(m); f(c); assert.equal(verificarManualesCotizados(c).ok, false, n); }
  });
  test("no depende de dónde se pinte: la línea suelta puede ocultarse y la verificación sigue igual", () => {
    const c = cotizado(ok(ida));
    assert.equal(c.detalleItems.length, 1);
    assert.ok(verificarManualesCotizados(c).ok);
  });
});

describe("vuelos comunes de una comparativa", () => {
  const h = (n: string, entrada: string, salida: string, destino = "CARTAGENA") => ({ ref: "x", nombre: n, destino, fechaIda: entrada, fechaRegreso: salida });
  test("compatible con todas las opciones", () => {
    const r = vuelosComunesCompatibles([ok(idaRegreso)], [h("A", "2030-02-28", "2030-03-04"), h("B", "2030-02-27", "2030-03-05")]);
    assert.ok(r.ok, r.ok ? "" : r.error);
  });
  test("una opción con fechas incompatibles bloquea la comparativa y la nombra", () => {
    const r = vuelosComunesCompatibles([ok(idaRegreso)], [h("A", "2030-02-28", "2030-03-04"), h("B", "2030-03-01", "2030-03-05")]);
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /B/);
  });
  test("destinos distintos entre opciones bloquean la comparativa", () => {
    assert.equal(vuelosComunesCompatibles([ok(ida)], [h("A", "2030-02-28", "2030-03-04"), h("B", "2030-02-28", "2030-03-04", "SANTA MARTA")]).ok, false);
  });
  test("solo vuelos: un 'otro servicio' no es común", () => {
    const o = ok({ clase: "otro", nombre: "Traslado", pax: 2, precio: 90_000, moneda: "COP", impuestoNoComisionable: 0 });
    assert.equal(vuelosComunesCompatibles([o], [h("A", "2030-02-28", "2030-03-04"), h("B", "2030-02-28", "2030-03-04")]).ok, false);
  });
});

describe("leerManualesEntrada conserva el hotel elegido", () => {
  test("el id del carrito viaja en hotelRef", () => {
    const r = leerManualesEntrada({ manuales: [ida] });
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.manuales[0].hotelRef, "h1");
  });
});

import { madreAdmiteEleccionPublica } from "../lib/cotizacion/comparativa.ts";

describe("elección PÚBLICA de una comparativa: solo anónima o del carrito marcada por un interno", () => {
  const m = (o: Record<string, unknown> = {}) => ({ tipo: "comparativa_carrito", tenant: "mayorista", creado_por_id: "u1", propietario_id: null, aliado_id: null, payload: { comparativa: true }, ...o }) as Parameters<typeof madreAdmiteEleccionPublica>[0];
  test("anónima: sí (como hasta ahora)", () => {
    assert.equal(madreAdmiteEleccionPublica(m({ creado_por_id: null })), true);
  });
  test("interna SIN marca: no", () => {
    assert.equal(madreAdmiteEleccionPublica(m()), false);
  });
  test("interna marcada con compartirPublico = true: sí", () => {
    assert.equal(madreAdmiteEleccionPublica(m({ payload: { compartirPublico: true } })), true);
  });
  test("la marca debe ser el booleano true: 'true', 1, false u objeto no abren", () => {
    for (const v of ["true", 1, false, {}, null]) assert.equal(madreAdmiteEleccionPublica(m({ payload: { compartirPublico: v } })), false, String(v));
  });
  test("marcada pero de un aliado, de otro tipo o de otra agencia: no", () => {
    assert.equal(madreAdmiteEleccionPublica(m({ payload: { compartirPublico: true }, aliado_id: 5 })), false);
    assert.equal(madreAdmiteEleccionPublica(m({ payload: { compartirPublico: true }, propietario_id: "b2b" })), false);
    assert.equal(madreAdmiteEleccionPublica(m({ payload: { compartirPublico: true }, tipo: "comparativa_manual" })), false);
    assert.equal(madreAdmiteEleccionPublica(m({ payload: { compartirPublico: true }, tenant: "minorista" })), false);
  });
  test("payload ausente o no objeto: no", () => {
    for (const p of [null, undefined, "x", [true]]) assert.equal(madreAdmiteEleccionPublica(m({ payload: p })), false);
  });
});
