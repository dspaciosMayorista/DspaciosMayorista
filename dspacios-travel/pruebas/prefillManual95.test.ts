// #95 — precarga EDITABLE de información general del catálogo en los formularios manuales. Valores esperados escritos a mano.
// B95-3: la elección real se identifica por ID; los homónimos no se resuelven por «el primero que coincida».
import test from "node:test";
import assert from "node:assert/strict";
import {
  prefillHotelManual, serviciosParaTipo, prefillServicioManual, vinculoDeTexto, vinculoProveedor, restriccionesHotel, hotelPorId, servicioPorId,
  fuenteNombreCotizacion, entradasFuente, prefillFilaCotizacion, normalizarCatalogo, etiquetasCatalogo, seleccionarCatalogo, entradasHoteles,
  type HotelCatalogoManual, type ServicioCatalogoManual, type CatalogoCotizacion,
} from "../lib/catalogo/prefillManual.ts";

const hotel = (o: Partial<HotelCatalogoManual> = {}): HotelCatalogoManual => ({ id: 1, nombre: "Hotel Caribe", destino: "CARTAGENA", proveedor: "Operadora Mar", adultsOnly: false, petFriendly: false, categorias: ["Estándar"], regimenes: ["PAM"], acomodaciones: ["Doble"], ...o });
const vacia = { nombre: "Hotel Caribe", categoria: "", proveedor: "", alimentacion: "", acomodacion: "" };
const servicios: ServicioCatalogoManual[] = [
  { id: 20, nombre: "Seguro de viaje 30 días", categoria: "asistencia", proveedor: "Asistencia Plus" },
  { id: 21, nombre: "Traslado aeropuerto-hotel", categoria: "tour_traslado", proveedor: "Transportes Sol" },
  { id: 22, nombre: "Cena show", categoria: "otro", proveedor: null },
];

test("selección por nombre único: sin importar mayúsculas, tildes ni espacios; lo parcial o desconocido es texto libre", () => {
  const lista = entradasHoteles([hotel({ id: 7, nombre: "Hotel Cartagena Plaza" })]);
  assert.deepEqual(seleccionarCatalogo(lista, "  hotel  CARTAGENA plaza ", null), { texto: "  hotel  CARTAGENA plaza ", id: 7, estado: "catalogo" });
  assert.equal(seleccionarCatalogo(entradasHoteles([hotel({ id: 8, nombre: "Hotel Océano" })]), "hotel oceano", null).id, 8);
  assert.deepEqual(seleccionarCatalogo(lista, "Hotel Cartagena", null), { texto: "Hotel Cartagena", id: null, estado: "libre" }, "un nombre parcial NO es una elección del catálogo");
  assert.equal(seleccionarCatalogo(lista, "", null).estado, "vacio");
  assert.equal(vinculoDeTexto([{ nombre: "Operadora Mar" }], "operadora mar"), "catalogo");
  assert.equal(normalizarCatalogo("  Áéí  Ñu "), "aei nu");
});

test("HOMÓNIMOS (lo que el probe de la auditoría invirtió): el orden de la lista no decide; sin elegir no hay vínculo ni precarga; elegir por etiqueta fija ESA entrada", () => {
  const A = hotel({ id: 11, nombre: "Hotel Mar", destino: "CARTAGENA", proveedor: "Proveedor A", adultsOnly: true });
  const B = hotel({ id: 12, nombre: "Hotel Mar", destino: "SANTA MARTA", proveedor: "Proveedor B", adultsOnly: false });
  for (const lista of [[A, B], [B, A]]) {
    const ent = entradasHoteles(lista);
    const sinElegir = seleccionarCatalogo(ent, "Hotel Mar", null);
    assert.deepEqual([sinElegir.id, sinElegir.estado], [null, "ambiguo"], "el nombre repetido no elige a ninguno");
    assert.deepEqual(prefillHotelManual(vacia, hotelPorId(lista, sinElegir.id)), {}, "sin elección no se precarga nada");
    const et = etiquetasCatalogo(ent);
    assert.equal(et.get(11), "Hotel Mar — CARTAGENA (#11)");
    assert.equal(et.get(12), "Hotel Mar — SANTA MARTA (#12)");
    const eligeA = seleccionarCatalogo(ent, et.get(11) as string, null);
    const eligeB = seleccionarCatalogo(ent, et.get(12) as string, null);
    assert.deepEqual([eligeA.id, eligeA.texto, eligeB.id, eligeB.texto], [11, "Hotel Mar", 12, "Hotel Mar"]);
    assert.equal(prefillHotelManual(vacia, hotelPorId(lista, eligeA.id)).proveedor, "Proveedor A");
    assert.equal(prefillHotelManual(vacia, hotelPorId(lista, eligeB.id)).proveedor, "Proveedor B");
    assert.equal(hotelPorId(lista, eligeA.id)?.adultsOnly, true);
    assert.equal(hotelPorId(lista, eligeB.id)?.adultsOnly, false);
    // ya elegido: re-escribir el mismo nombre conserva SU id; cambiar el texto lo vuelve texto libre
    assert.equal(seleccionarCatalogo(ent, "Hotel Mar", 12).id, 12);
    assert.deepEqual(seleccionarCatalogo(ent, "Hotel Mar del Sur", 12), { texto: "Hotel Mar del Sur", id: null, estado: "libre" });
  }
});

test("etiquetas: los nombres únicos se ofrecen tal cual (sin ruido); solo los repetidos llevan destino y #id", () => {
  const et = etiquetasCatalogo(entradasHoteles([hotel({ id: 1, nombre: "Hotel Único" }), hotel({ id: 2, nombre: "Hotel Repetido" }), hotel({ id: 3, nombre: "hotel  repetido", destino: null })]));
  assert.equal(et.get(1), "Hotel Único");
  assert.equal(et.get(2), "Hotel Repetido — CARTAGENA (#2)");
  assert.equal(et.get(3), "hotel  repetido (#3)");
});

test("elegir un hotel con UNA opción precarga proveedor, categoría, régimen y acomodación (solo campos vacíos)", () => {
  assert.deepEqual(prefillHotelManual(vacia, hotel()), { proveedor: "Operadora Mar", categoria: "Estándar", alimentacion: "PAM", acomodacion: "Doble" });
});

test("con VARIAS opciones no se adivina: solo el proveedor; las opciones quedan como sugerencias", () => {
  const h = hotel({ categorias: ["Estándar", "Superior"], regimenes: ["PC", "PAM"], acomodaciones: ["Sencilla", "Doble"] });
  assert.deepEqual(prefillHotelManual(vacia, h), { proveedor: "Operadora Mar" });
});

test("jamás pisa lo que el asesor ya escribió (ediciones locales)", () => {
  const editada = { nombre: "Hotel Caribe", categoria: "Suite vista mar", proveedor: "Mi proveedor", alimentacion: "Todo incluido", acomodacion: "Doble" };
  assert.deepEqual(prefillHotelManual(editada, hotel()), {});
});

test("campos faltantes del catálogo: sin proveedor, sin categorías ni regímenes → no inventa nada", () => {
  const pelado = hotel({ proveedor: null, categorias: [], regimenes: [], acomodaciones: [] });
  assert.deepEqual(prefillHotelManual(vacia, pelado), {});
  assert.deepEqual(prefillHotelManual(vacia, null), {});
  assert.deepEqual(prefillHotelManual(vacia, hotel({ proveedor: "   " })), { categoria: "Estándar", alimentacion: "PAM", acomodacion: "Doble" });
});

test("restricciones del hotel visibles: Adults Only y mascotas; ninguna → lista vacía", () => {
  assert.deepEqual(restriccionesHotel(hotel({ adultsOnly: true, petFriendly: true })), ["Solo adultos (Adults Only)", "Acepta mascotas"]);
  assert.deepEqual(restriccionesHotel(hotel()), []);
  assert.deepEqual(restriccionesHotel(null), []);
});

test("servicios: el tipo de la fila filtra el catálogo (asistencia / traslado-tour / otro = todo) sin adivinar", () => {
  assert.deepEqual(serviciosParaTipo(servicios, "asistencia").map((s) => s.nombre), ["Seguro de viaje 30 días"]);
  assert.deepEqual(serviciosParaTipo(servicios, "traslado").map((s) => s.nombre), ["Traslado aeropuerto-hotel"]);
  assert.deepEqual(serviciosParaTipo(servicios, "tour").map((s) => s.nombre), ["Traslado aeropuerto-hotel"]);
  assert.equal(serviciosParaTipo(servicios, "otro").length, 3);
});

test("elegir un servicio precarga SOLO el proveedor y solo si estaba vacío; un servicio de otro tipo no se ofrece", () => {
  const asist = serviciosParaTipo(servicios, "asistencia").map((s) => ({ id: s.id, nombre: s.nombre }));
  const sel = seleccionarCatalogo(asist, "seguro de viaje 30 días", null);
  assert.equal(sel.id, 20);
  assert.deepEqual(prefillServicioManual("", servicioPorId(servicios, sel.id)), { proveedor: "Asistencia Plus" });
  assert.deepEqual(prefillServicioManual("Otro proveedor", servicioPorId(servicios, sel.id)), {});
  const traslados = serviciosParaTipo(servicios, "traslado").map((s) => ({ id: s.id, nombre: s.nombre }));
  assert.equal(seleccionarCatalogo(traslados, "Seguro de viaje 30 días", null).estado, "libre");
  assert.deepEqual(prefillServicioManual("", servicioPorId(servicios, 22)), {}, "sin proveedor en el catálogo no inventa uno");
});

test("proveedor: catálogo vs texto libre", () => {
  assert.equal(vinculoProveedor(["Operadora Mar"], "operadora mar"), "catalogo");
  assert.equal(vinculoProveedor(["Operadora Mar"], "Proveedor nuevo"), "libre");
});

test("el resultado NUNCA lleva campos de precio (solo los tipos de información general)", () => {
  const patch = prefillHotelManual(vacia, hotel());
  assert.deepEqual(Object.keys(patch).sort(), ["alimentacion", "acomodacion", "categoria", "proveedor"].sort());
  const conPrecios = { ...hotel(), tarifa_neta: 999, precio: 1 } as unknown as HotelCatalogoManual;
  assert.ok(!JSON.stringify(prefillHotelManual(vacia, conPrecios)).includes("999"));
});

const cot: CatalogoCotizacion = { hoteles: [hotel()], servicios, aerolineas: ["Avianca", "JetSMART"], proveedores: ["Operadora Mar", "Asistencia Plus"] };

test("cotización manual: cada tipo de fila busca en su catálogo y precarga el proveedor del elemento ELEGIDO (por id) si estaba vacío", () => {
  assert.deepEqual(fuenteNombreCotizacion("hotel", cot).map((f) => f.nombre), ["Hotel Caribe"]);
  assert.deepEqual(fuenteNombreCotizacion("aereo", cot).map((f) => f.nombre), ["Avianca", "JetSMART"]);
  assert.deepEqual(entradasFuente(fuenteNombreCotizacion("aereo", cot)), [], "las aerolíneas no tienen id ni vínculo por id");
  assert.deepEqual(fuenteNombreCotizacion("asistencia", cot).map((f) => f.nombre), ["Seguro de viaje 30 días"]);
  assert.deepEqual(fuenteNombreCotizacion("traslado", cot).map((f) => f.nombre), ["Traslado aeropuerto-hotel"]);
  assert.equal(fuenteNombreCotizacion("otro", cot).length, 3);
  const fh = fuenteNombreCotizacion("hotel", cot);
  assert.deepEqual(prefillFilaCotizacion(fh, 1, ""), { proveedor: "Operadora Mar" });
  assert.deepEqual(prefillFilaCotizacion(fuenteNombreCotizacion("asistencia", cot), 20, ""), { proveedor: "Asistencia Plus" });
  assert.deepEqual(prefillFilaCotizacion(fh, 1, "Mi proveedor"), {}, "no pisa lo escrito");
  assert.deepEqual(prefillFilaCotizacion(fh, null, ""), {}, "sin elección no hay precarga");
  assert.deepEqual(prefillFilaCotizacion(fh, 99, ""), {});
});
