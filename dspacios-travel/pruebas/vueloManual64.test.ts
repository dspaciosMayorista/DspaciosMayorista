import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validarServicioManual, validarVueloContraHotel, tramosVueloManual, descripcionCotizacionManual, esLineaVueloManual,
  esTramoVueloManual, resolverHotelDeManuales, vuelosComunesCompatibles, verificarManualesCotizados, leerManualesEntrada,
  agruparHotelesPorViaje, claveGrupoViaje, fechasDeVuelo,
  type ServicioManual,
} from "../lib/cart/servicioManual.ts";
import { codigoIataDeCiudad } from "../lib/iata.ts";
import { resumirOpcionesComparativa, grupoDeVuelo, type HotelComparativa } from "../lib/cart/opcionesComparativa.ts";
import { resumirMonedas } from "../lib/cart/monedaCarrito.ts";

// #64 — el vuelo manual del carrito: ida / regreso / ida y regreso, códigos IATA del catálogo, fechas del plan del hotel y grupos de alternativas.

const base = { clase: "vuelo", nombre: "Tiquete Avianca", pax: 2, precio: 1_800_000, moneda: "COP", impuestoNoComisionable: 200_000, hotelRef: "h1" };
const ida = { ...base, tramo: "ida", origen: "BOG", destino: "CTG", fechaIda: "2030-02-28", fechaRegreso: null };
const regreso = { ...base, tramo: "regreso", origen: "CTG", destino: "BOG", fechaIda: null, fechaRegreso: "2030-03-04" };
const idaRegreso = { ...base, tramo: "ida_regreso", origen: "BOG", destino: "CTG", fechaIda: "2030-02-28", fechaRegreso: "2030-03-04" };
const HOTEL = { ref: "item-0", nombre: "Hotel Uno", destino: "CARTAGENA", destinoIata: "CTG", fechaIda: "2030-02-28", fechaRegreso: "2030-03-04" };

const ok = (raw: unknown): ServicioManual => { const r = validarServicioManual(raw); assert.ok(r.ok, r.ok ? "" : r.error); return (r as { valor: ServicioManual }).valor; };

describe("catálogo IATA: el código sale del catálogo, nunca del nombre del hotel", () => {
  test("Cartagena es CTG (con o sin tildes, mayúsculas o espacios)", () => {
    for (const n of ["Cartagena", "CARTAGENA", " cartagena ", "Cartagéna"]) assert.equal(codigoIataDeCiudad(n), "CTG", n);
    assert.equal(codigoIataDeCiudad("Santa Marta"), "SMR");
    assert.equal(codigoIataDeCiudad("BOGOTÁ"), "BOG");
  });
  test("un nombre que no está en el catálogo, parcial o ambiguo NO produce código (se pide corregir el dato)", () => {
    for (const n of ["Cartagena de Indias", "Hotel Almirante Cartagena", "Narnia", "", null, undefined]) assert.equal(codigoIataDeCiudad(n as string), null, String(n));
  });
});

describe("tramos de un vuelo manual", () => {
  test("acepta ida, regreso e ida y regreso con códigos IATA", () => {
    for (const v of [ida, regreso, idaRegreso]) assert.ok(validarServicioManual(v).ok, String(v.tramo));
  });
  test("origen y destino van como código IATA de 3 letras: nombres de ciudad o textos libres se rechazan", () => {
    for (const mal of [{ destino: "Cartagena" }, { origen: "Bogotá" }, { origen: "BO" }, { destino: "CTGX" }, { origen: "B0G" }, { origen: "" }]) {
      assert.equal(validarServicioManual({ ...ida, ...mal }).ok, false, JSON.stringify(mal));
    }
    const r = validarServicioManual({ ...ida, origen: "bog", destino: "ctg" });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual([r.valor.origen, r.valor.destino], ["BOG", "CTG"], "se normaliza a mayúsculas");
  });
  test("exige el tramo y el hotel/grupo al que pertenece", () => {
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
    assert.equal(validarServicioManual({ ...ida, origen: "ctg", destino: "CTG" }).ok, false);
  });
  test("otro servicio: sin tramo ni IATA ni horas; conserva el grupo/hotel solo para la comparativa (el servidor lo anula en el carrito normal)", () => {
    const r = validarServicioManual({ clase: "otro", nombre: "Traslado privado", pax: 2, precio: 90_000, moneda: "COP", impuestoNoComisionable: 0, tramo: "ida", hotelRef: "h1", horaIda: "06:30" });
    assert.ok(r.ok);
    if (r.ok) { assert.equal(r.valor.tramo, null); assert.equal(r.valor.hotelRef, "h1"); assert.equal(r.valor.horaIda, null); assert.equal(r.valor.origen, null); }
    const sin = validarServicioManual({ clase: "otro", nombre: "Traslado privado", pax: 2, precio: 90_000, moneda: "COP", impuestoNoComisionable: 0 });
    assert.ok(sin.ok && sin.valor.hotelRef === null);
  });
  test("ida y regreso: dos tramos con el regreso invertido; el cuadro dice CTG (Cartagena) y nunca inventa record", () => {
    assert.deepEqual(tramosVueloManual(ok(ida), true).map((t) => [t.direccion, t.origen_codigo, t.destino_codigo, t.destino_ciudad, t.fecha_salida]), [["ida", "BOG", "CTG", "Cartagena", "2030-02-28"]]);
    const t = tramosVueloManual(ok(idaRegreso), true);
    assert.equal(t.length, 2);
    assert.deepEqual([t[1].direccion, t[1].origen_codigo, t[1].destino_codigo, t[1].fecha_salida], ["regreso", "CTG", "BOG", "2030-03-04"]);
    assert.equal(tramosVueloManual(ok(regreso), true).length, 1);
    for (const x of t) { assert.equal(x.record, null); assert.equal(x.aerolinea, null); assert.ok(esTramoVueloManual(x)); assert.match(String(x.servicios), /pasajeros en este vuelo: 2 · sujeto a confirmación/); }
    assert.doesNotMatch(String(tramosVueloManual(ok(idaRegreso), false)[0].servicios), /sujeto a confirmación/);
  });
  test("la descripción usa los códigos y la línea suelta se reconoce para ocultarla", () => {
    const d = descripcionCotizacionManual(ok(regreso));
    assert.match(d, /CTG → BOG \(solo regreso\)/);
    assert.ok(esLineaVueloManual(d));
    assert.equal(esLineaVueloManual("Hotel Uno · Estándar / PC"), false);
  });
});

describe("las fechas del vuelo salen del PLAN del hotel", () => {
  const plan = { fechaIda: "2030-02-28", fechaRegreso: "2030-03-04" };
  test("ida y vuelta: ambas; solo ida: únicamente la ida; solo regreso: únicamente el regreso", () => {
    assert.deepEqual(fechasDeVuelo("ida_regreso", plan), { fechaIda: "2030-02-28", fechaRegreso: "2030-03-04" });
    assert.deepEqual(fechasDeVuelo("ida", plan), { fechaIda: "2030-02-28", fechaRegreso: null });
    assert.deepEqual(fechasDeVuelo("regreso", plan), { fechaIda: null, fechaRegreso: "2030-03-04" });
  });
  test("el servidor las exige: una fecha distinta a la del plan (aunque esté dentro de la estadía) se rechaza", () => {
    assert.ok(validarVueloContraHotel(ok(idaRegreso), HOTEL).ok);
    assert.ok(validarVueloContraHotel(ok(ida), HOTEL).ok);
    assert.ok(validarVueloContraHotel(ok(regreso), HOTEL).ok);
    assert.equal(validarVueloContraHotel(ok({ ...ida, fechaIda: "2030-03-01" }), HOTEL).ok, false, "dentro de la estadía pero no es la del plan");
    assert.equal(validarVueloContraHotel(ok({ ...ida, fechaIda: "2030-02-27" }), HOTEL).ok, false, "un día antes de la entrada");
    assert.equal(validarVueloContraHotel(ok({ ...regreso, fechaRegreso: "2030-03-05" }), HOTEL).ok, false, "un día después de la salida");
    assert.equal(validarVueloContraHotel(ok({ ...idaRegreso, fechaRegreso: "2030-03-03" }), HOTEL).ok, false);
  });
  test("si el plan cambia, el mismo vuelo deja de valer hasta actualizar sus fechas", () => {
    const m = ok(idaRegreso);
    assert.equal(validarVueloContraHotel(m, { ...HOTEL, fechaIda: "2030-03-02" }).ok, false);
    assert.equal(validarVueloContraHotel({ ...m, ...fechasDeVuelo("ida_regreso", { fechaIda: "2030-03-02", fechaRegreso: "2030-03-04" }) }, { ...HOTEL, fechaIda: "2030-03-02" }).ok, true);
  });
});

describe("el vuelo contra el hotel por CÓDIGO IATA", () => {
  test("el lado del hotel se fija con el código del catálogo", () => {
    const r = validarVueloContraHotel(ok(ida), HOTEL);
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (r.ok) { assert.equal(r.valor.destino, "CTG"); assert.equal(r.valor.hotelRef, "item-0"); assert.equal(r.valor.hotelEtiqueta, "Hotel Uno"); }
  });
  test("un código distinto al del hotel (dato manipulado) se rechaza, en ida y en regreso", () => {
    assert.equal(validarVueloContraHotel(ok({ ...ida, destino: "SMR" }), HOTEL).ok, false);
    assert.equal(validarVueloContraHotel(ok({ ...regreso, origen: "SMR" }), HOTEL).ok, false);
  });
  test("sin código IATA confiable en el catálogo se pide corregir el dato: no se infiere del nombre", () => {
    for (const destinoIata of [null, undefined, "", "CART", "Cartagena"]) {
      const r = validarVueloContraHotel(ok(ida), { ...HOTEL, destinoIata });
      assert.equal(r.ok, false, String(destinoIata));
      assert.match(r.ok ? "" : r.error, /código IATA confiable.*Producto → Destinos/);
    }
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
      ["ruta en el cuadro", (c) => { c.detalleVuelos[0].destino_codigo = "SMR"; }],
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

describe("grupos de alternativas: destino IATA + fechas", () => {
  const h = (id: string, nombre: string, iata: string | null, ida: string | null, reg: string | null, pax = 2): HotelDeVueloConPax =>
    ({ id, ref: id, nombre, destino: iata, destinoIata: iata, fechaIda: ida, fechaRegreso: reg, pax });
  type HotelDeVueloConPax = Parameters<typeof vuelosComunesCompatibles>[1][number] & { id: string };
  const tres = [h("a", "Hotel A", "CTG", "2030-03-01", "2030-03-04"), h("b", "Hotel B", "CTG", "2030-03-01", "2030-03-04"), h("c", "Hotel C", "CTG", "2030-03-01", "2030-03-04")];
  const vuelo = (o: Record<string, unknown> = {}) => ok({ ...base, tramo: "ida_regreso", origen: "BOG", destino: "CTG", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", hotelRef: "comun", ...o });

  test("tres hoteles del mismo destino y fechas son UN grupo; un vuelo de 2 pasajeros vale para los tres (no 6)", () => {
    const { grupos } = agruparHotelesPorViaje(tres);
    assert.equal(grupos.length, 1);
    assert.equal(grupos[0].clave, claveGrupoViaje("CTG", "2030-03-01", "2030-03-04"));
    assert.equal(grupos[0].hoteles.length, 3);
    const r = vuelosComunesCompatibles([vuelo()], tres);
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.equal(vuelosComunesCompatibles([vuelo({ pax: 3 })], tres).ok, false, "3 pasajeros no caben en opciones de 2");
    assert.equal(vuelosComunesCompatibles([vuelo({ pax: 6 })], tres).ok, false, "los pasajeros de las alternativas no se suman (2+2+2)");
  });
  test("dos destinos: 'comun' no vale; cada vuelo nombra su grupo y solo afecta a sus hoteles", () => {
    const hs = [h("a", "Hotel A", "CTG", "2030-03-01", "2030-03-04"), h("s", "Hotel S", "SMR", "2030-03-10", "2030-03-14")];
    assert.equal(vuelosComunesCompatibles([vuelo()], hs).ok, false, "comun con dos grupos");
    const clCTG = claveGrupoViaje("CTG", "2030-03-01", "2030-03-04"), clSMR = claveGrupoViaje("SMR", "2030-03-10", "2030-03-14");
    const r = vuelosComunesCompatibles([vuelo({ hotelRef: clCTG }), vuelo({ hotelRef: clSMR, destino: "SMR", fechaIda: "2030-03-10", fechaRegreso: "2030-03-14" })], hs);
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (r.ok) assert.deepEqual(r.grupoDe, [clCTG, clSMR]);
    // un vuelo a SMR con las fechas de CTG no encaja en ningún hotel de su grupo
    assert.equal(vuelosComunesCompatibles([vuelo({ hotelRef: clSMR })], hs).ok, false);
  });
  test("un destino con dos fechas son dos grupos: los vuelos van separados por fecha", () => {
    const hs = [h("a", "Hotel A", "CTG", "2030-03-01", "2030-03-04"), h("b", "Hotel B", "CTG", "2030-03-08", "2030-03-11")];
    const { grupos } = agruparHotelesPorViaje(hs);
    assert.equal(grupos.length, 2);
    assert.equal(vuelosComunesCompatibles([vuelo()], hs).ok, false, "comun con dos grupos de fechas");
    const clB = claveGrupoViaje("CTG", "2030-03-08", "2030-03-11");
    const r = vuelosComunesCompatibles([vuelo({ hotelRef: clB, fechaIda: "2030-03-08", fechaRegreso: "2030-03-11" })], hs);
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (r.ok) assert.deepEqual(r.grupoDe, [clB]);
  });
  test("un hotel sin código IATA o sin fechas no entra en ningún grupo y bloquea los vuelos con un mensaje que pide corregir el dato", () => {
    const hs = [...tres.slice(0, 2), h("x", "Hotel X", null, "2030-03-01", "2030-03-04")];
    assert.equal(agruparHotelesPorViaje(hs).sinDato.length, 1);
    const r = vuelosComunesCompatibles([vuelo()], hs);
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /código IATA confiable/);
  });
  test("solo vuelos: un 'otro servicio' no se asocia a un grupo", () => {
    const o = ok({ clase: "otro", nombre: "Traslado", pax: 2, precio: 90_000, moneda: "COP", impuestoNoComisionable: 0 });
    assert.equal(vuelosComunesCompatibles([o], tres).ok, false);
  });
});

describe("cada alternativa se cotiza por separado (nunca un total global del carrito)", () => {
  const hotel = (id: string, nombre: string, iata: string, ida: string, reg: string, precio = 1_200_000): HotelComparativa =>
    ({ id, ref: id, nombre, destino: iata, destinoIata: iata, fechaIda: ida, fechaRegreso: reg, pax: 2, precio, moneda: "COP" });
  const vuelo = (hotelRef: string, precio = 1_800_000, impuesto = 200_000) => ({ id: `v-${hotelRef}`, nombre: "Tiquete", tramo: "ida_regreso" as const, pax: 2, precio, impuestoNoComisionable: impuesto, moneda: "COP", hotelRef });
  const tres = [hotel("a", "A", "CTG", "2030-03-01", "2030-03-04"), hotel("b", "B", "CTG", "2030-03-01", "2030-03-04"), hotel("c", "C", "CTG", "2030-03-01", "2030-03-04")];

  // Cálculo por opción (el que usa la pantalla). USAR_TOTAL_GLOBAL=1 lo cambia por la SUMA del carrito que se mostraba antes (la captura): la prueba debe FALLAR así.
  const pvpPorOpcion = (hoteles: HotelComparativa[], vuelos: ReturnType<typeof vuelo>[]): number[] => {
    if (process.env.USAR_TOTAL_GLOBAL === "1") {
      const global = hoteles.reduce((s, x) => s + x.precio, 0) + vuelos.reduce((s, x) => s + x.precio, 0);
      return hoteles.map(() => global);
    }
    return resumirOpcionesComparativa(hoteles, [], vuelos).grupos.flatMap((g) => g.opciones.map((o) => o.pvp));
  };

  test("tres hoteles dobles del mismo destino y fechas con un vuelo de 2 pasajeros: cada opción vale hotel + vuelo (3.000.000), no la suma de todo (5.400.000)", () => {
    const pvps = pvpPorOpcion(tres, [vuelo("comun")]);
    assert.deepEqual(pvps, [3_000_000, 3_000_000, 3_000_000]);
    const global = resumirMonedas([...tres.map((x) => ({ tipo: "hotel", precio: x.precio, moneda: "COP" })), { tipo: "manual", precio: 1_800_000, moneda: "COP" }] as never);
    assert.equal(global.unica?.monto, 5_400_000, "lo que mostraba el carrito: una suma de alternativas que compiten");
    assert.ok(!pvps.includes(5_400_000));
  });
  test("el vuelo entra UNA vez en cada opción y las opciones no se suman entre sí", () => {
    const r = resumirOpcionesComparativa(tres, [], [vuelo("comun")]);
    for (const o of r.grupos[0].opciones) { assert.equal(o.vuelos.length, 1); assert.equal(o.impuestoNoComisionableVuelos, 200_000); assert.equal(o.pax, 2); }
  });
  test("dos destinos con vuelos diferentes: cada opción lleva solo el vuelo de SU grupo", () => {
    const hs = [hotel("a", "A", "CTG", "2030-03-01", "2030-03-04"), hotel("s", "S", "SMR", "2030-03-10", "2030-03-14", 900_000)];
    const clCTG = claveGrupoViaje("CTG", "2030-03-01", "2030-03-04"), clSMR = claveGrupoViaje("SMR", "2030-03-10", "2030-03-14");
    const r = resumirOpcionesComparativa(hs, [], [vuelo(clCTG, 1_800_000), vuelo(clSMR, 1_000_000, 0)]);
    assert.deepEqual(r.grupos.map((g) => [g.destinoIata, g.opciones[0].pvp]), [["CTG", 3_000_000], ["SMR", 1_900_000]]);
    // el vuelo también se puede señalar por el id de un hotel del grupo
    assert.equal(grupoDeVuelo({ hotelRef: "s" }, [{ clave: clSMR, hoteles: [{ id: "s" }] }]), clSMR);
  });
  test("un destino con dos fechas: dos grupos, cada vuelo en el suyo", () => {
    const hs = [hotel("a", "A", "CTG", "2030-03-01", "2030-03-04"), hotel("b", "B", "CTG", "2030-03-08", "2030-03-11")];
    const clB = claveGrupoViaje("CTG", "2030-03-08", "2030-03-11");
    const r = resumirOpcionesComparativa(hs, [], [vuelo(clB, 500_000, 0)]);
    assert.deepEqual(r.grupos.map((g) => g.opciones[0].pvp), [1_200_000, 1_700_000]);
  });
  test("servicio compartido por el grupo y servicio exclusivo de un hotel", () => {
    const servicios = [{ nombre: "Islas del Rosario", precio: 180_000, hotelItemId: "a" }, { nombre: "Islas del Rosario", precio: 180_000, hotelItemId: "b" }, { nombre: "Cena exclusiva", precio: 90_000, hotelItemId: "c" }];
    const r = resumirOpcionesComparativa(tres, servicios, [vuelo("comun")]);
    assert.deepEqual(r.grupos[0].opciones.map((o) => o.pvp), [3_180_000, 3_180_000, 3_090_000]);
  });
  test("un vuelo que no pertenece a ningún grupo se señala y no se suma a nadie", () => {
    const r = resumirOpcionesComparativa(tres, [], [vuelo("grupo:SMR|2030-03-10|2030-03-14")]);
    assert.equal(r.vuelosSinGrupo.length, 1);
    assert.deepEqual(r.grupos[0].opciones.map((o) => o.pvp), [1_200_000, 1_200_000, 1_200_000]);
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
