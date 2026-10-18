// #54 — Editar los servicios de un hotel que YA está en el carrito. Reglas
// puras (sin React):
//   · lib/cart/vinculoServicios.ts — `reemplazarConjunto` sustituye hotel +
//     servicios en UNA operación (compare-and-swap por huella), conserva el
//     id del hotel y el de cada servicio que se queda, nunca recrea un hotel
//     ni toca otra reserva; `claveReservaPersona` = identidad COMPLETA.
//   · lib/tarifario/servicioAdicionalPaquete.ts — borrador vs guardado,
//     servicios que el catálogo ya no ofrece y revalidación al confirmar.
// Se ejecuta con test:unit (aliasLoader + strip-types).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  agregarConjunto, claveReservaPersona, firmaConjunto, reemplazarConjunto, serviciosDeHotel,
  type IdentidadReservaPersona, type ReemplazoConjunto,
} from "../lib/cart/vinculoServicios.ts";
import {
  claveConsultaServicios, evaluarEdicionServicios, evaluarServicios, mismaCotizacion, mismaSeleccion, serviciosFueraDeCatalogo,
  MENSAJE_CONJUNTO_CAMBIO, MENSAJE_FUERA_DE_CATALOGO,
  type ConsultaServicios, type HotelParaServicios,
} from "../lib/tarifario/servicioAdicionalPaquete.ts";

type It = {
  id: string; tipo: string; hotelItemId?: string | null; servicioId?: number | null; paqueteId?: number; hotelId?: number;
  modeloTarifario?: string; precio?: number; nombre?: string; categoria?: string; habitaciones?: unknown;
};

const hotelBase = (over: Partial<It> = {}): Omit<It, "id"> =>
  ({ tipo: "hotel", paqueteId: 10, hotelId: 1, categoria: "Estandar", precio: 1_000, habitaciones: { doble: 1 }, ...over });
const tour = (servicioId: number | null, precio: number, over: Partial<It> = {}): Omit<It, "id" | "hotelItemId"> =>
  ({ tipo: "tour", paqueteId: 10, servicioId, nombre: `S${servicioId}`, precio, ...over });

// Carrito: dos reservas del MISMO hotel (h1/h2, otra ocupación), un tour
// independiente y otro hotel (h3) con su servicio.
function carrito(): It[] {
  let items: It[] = [];
  items = agregarConjunto(items, hotelBase(), [tour(55, 100), tour(56, 50)], { hotel: "h1", servicios: ["t55", "t56"] });
  items = agregarConjunto(items, hotelBase({ habitaciones: { doble: 2 } }), [tour(55, 200)], { hotel: "h2", servicios: ["t55b"] });
  items = [...items, { id: "suelto", tipo: "tour", paqueteId: 11, servicioId: 70, precio: 9 }];
  items = agregarConjunto(items, hotelBase({ hotelId: 3, paqueteId: 12 }), [tour(80, 30, { paqueteId: 12 })], { hotel: "h3", servicios: ["t80"] });
  return items;
}
const cambio = (items: It[], over: Partial<ReemplazoConjunto<It>> = {}): ReemplazoConjunto<It> => ({
  hotelItemId: "h1", firmaEsperada: firmaConjunto(items, "h1")!, hotel: hotelBase({ precio: 1_100 }),
  servicios: [tour(56, 55), tour(57, 70)], idsNuevos: ["n1", "n2"], ...over,
});
const ok = <T>(r: { ok: true; items: T[] } | { ok: false; motivo: string }) => { assert.equal(r.ok, true, `esperaba ok, vino ${JSON.stringify(r)}`); return (r as { items: T[] }).items; };

describe("reemplazarConjunto — una sola operación, sin duplicados ni huérfanos", () => {
  test("agregar y quitar a la vez: hotel con el MISMO id, servicio que se queda con su id, nuevo con id nuevo", () => {
    const items = carrito();
    const r = ok(reemplazarConjunto(items, cambio(items)));
    const hotel = r.find((i) => i.id === "h1")!;
    assert.equal(hotel.precio, 1_100, "el hotel se actualiza en su lugar");
    assert.equal(r.filter((i) => i.tipo === "hotel").length, 3, "nunca se duplica un hotel");
    const s = serviciosDeHotel(r, "h1");
    assert.deepEqual(s.map((x) => [x.id, x.servicioId, x.precio, x.hotelItemId]), [["t56", 56, 55, "h1"], ["n2", 57, 70, "h1"]]);
    assert.ok(!r.some((i) => i.id === "t55"), "el servicio quitado sale del carrito");
  });

  test("no toca otra reserva del mismo hotel, el otro hotel ni el tour independiente; el orden se conserva", () => {
    const items = carrito();
    const r = ok(reemplazarConjunto(items, cambio(items)));
    const fuera = (xs: It[]) => xs.filter((i) => i.id !== "h1" && i.hotelItemId !== "h1");
    assert.deepEqual(fuera(r), fuera(items), "todo lo ajeno queda idéntico");
    assert.deepEqual(r.map((i) => i.id), ["h1", "t56", "n2", "h2", "t55b", "suelto", "h3", "t80"]);
  });

  test("retirar todos los servicios deja el hotel solo, sin servicios vinculados", () => {
    const items = carrito();
    const r = ok(reemplazarConjunto(items, cambio(items, { hotel: hotelBase(), servicios: [], idsNuevos: [] })));
    assert.deepEqual(serviciosDeHotel(r, "h1"), []);
    assert.ok(r.some((i) => i.id === "h1"));
    assert.equal(r.length, items.length - 2);
  });

  test("duplicados por servicioId se colapsan (gana el primero)", () => {
    const items = carrito();
    const r = ok(reemplazarConjunto(items, cambio(items, { servicios: [tour(57, 70), tour(57, 99)], idsNuevos: ["n1", "n2"] })));
    assert.deepEqual(serviciosDeHotel(r, "h1").map((x) => [x.id, x.precio]), [["n1", 70]]);
  });

  test("PURA (modo estricto): el mismo cambio sobre el mismo carrito da exactamente el mismo resultado, y no muta la entrada", () => {
    const items = carrito();
    const copia = JSON.stringify(items);
    const c = cambio(items);
    assert.deepEqual(reemplazarConjunto(items, c), reemplazarConjunto(items, c));
    assert.equal(JSON.stringify(items), copia);
  });

  test("aplicado dos veces seguidas (actualizador repetido) la segunda se rechaza por huella y no duplica nada", () => {
    const items = carrito();
    const c = cambio(items);
    const r1 = ok(reemplazarConjunto(items, c));
    assert.deepEqual(reemplazarConjunto(r1, c), { ok: false, motivo: "conjunto_cambio" });
  });
});

describe("reemplazarConjunto — rechazos: el conjunto anterior queda intacto", () => {
  test("hotel eliminado durante la revalidación: no se recrea", () => {
    const items = carrito();
    const c = cambio(items);
    const sinHotel = items.filter((i) => i.id !== "h1" && i.hotelItemId !== "h1");
    assert.deepEqual(reemplazarConjunto(sinHotel, c), { ok: false, motivo: "hotel_no_encontrado" });
  });

  test("el id apunta a un tour, no a un hotel: no encontrado", () => {
    const items = carrito();
    assert.deepEqual(reemplazarConjunto(items, cambio(items, { hotelItemId: "t55" })), { ok: false, motivo: "hotel_no_encontrado" });
  });

  test("el conjunto cambió desde que se preparó (servicio quitado desde el carrito, precio, otra edición)", () => {
    const items = carrito();
    const c = cambio(items);
    assert.deepEqual(reemplazarConjunto(items.filter((i) => i.id !== "t56"), c), { ok: false, motivo: "conjunto_cambio" });
    assert.deepEqual(reemplazarConjunto(items.map((i) => (i.id === "h1" ? { ...i, precio: 2 } : i)), c), { ok: false, motivo: "conjunto_cambio" });
  });

  test("otra reserva: hotel, paquete, modelo tarifario o identidad completa distintos", () => {
    const items = carrito();
    const clave = (h: It) => JSON.stringify(h.habitaciones);
    assert.equal((reemplazarConjunto(items, cambio(items, { hotel: hotelBase({ hotelId: 2 }) })) as { motivo: string }).motivo, "reserva_distinta");
    assert.equal((reemplazarConjunto(items, cambio(items, { hotel: hotelBase({ paqueteId: 11 }) })) as { motivo: string }).motivo, "reserva_distinta");
    assert.equal((reemplazarConjunto(items, cambio(items, { hotel: hotelBase({ modeloTarifario: "unidad" }) })) as { motivo: string }).motivo, "reserva_distinta");
    assert.equal((reemplazarConjunto(items, cambio(items, { hotel: { ...hotelBase(), tipo: "tour" } })) as { motivo: string }).motivo, "reserva_distinta");
    assert.equal((reemplazarConjunto(items, cambio(items, { hotel: hotelBase({ habitaciones: { doble: 2 } }), claveReserva: clave })) as { motivo: string }).motivo, "reserva_distinta");
    ok(reemplazarConjunto(items, cambio(items, { claveReserva: clave })));
  });

  test("un servicio sin servicioId o de otro paquete rechaza TODO el cambio (nunca se descarta en silencio)", () => {
    const items = carrito();
    assert.deepEqual(reemplazarConjunto(items, cambio(items, { servicios: [tour(56, 55), tour(null, 1)] })), { ok: false, motivo: "servicio_invalido" });
    assert.deepEqual(reemplazarConjunto(items, cambio(items, { servicios: [tour(56, 55, { paqueteId: 12 })] })), { ok: false, motivo: "servicio_invalido" });
  });
});

describe("firmaConjunto — huella del conjunto guardado", () => {
  test("cambia con el hotel o con sus servicios; no con otros ítems", () => {
    const items = carrito();
    const f = firmaConjunto(items, "h1");
    assert.equal(typeof f, "string");
    assert.equal(firmaConjunto(items, "nope"), null);
    assert.equal(firmaConjunto(items, "t55"), null, "solo hoteles tienen huella");
    assert.notEqual(firmaConjunto(items.filter((i) => i.id !== "t55"), "h1"), f);
    assert.equal(firmaConjunto(items.filter((i) => i.id !== "suelto" && i.id !== "t55b"), "h1"), f);
  });
});

describe("claveReservaPersona — identidad COMPLETA de la reserva por persona", () => {
  const base: IdentidadReservaPersona = {
    hotelId: 1, paqueteId: 10, modulo: "porcion_terrestre", bloqueoId: null, categoria: "Estandar", regimen: "Desayuno",
    fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", habitaciones: { doble: 1 }, pax: 2, ninos: 1, ninos2: 0, infantes: 1, edadesMenores: [7, 1],
  };
  const k = claveReservaPersona(base);

  test("misma reserva ⇔ misma clave; habitaciones en 0, orden de claves y orden de edades no importan", () => {
    assert.equal(claveReservaPersona({ ...base }), k);
    assert.equal(claveReservaPersona({ ...base, habitaciones: { triple: 0, doble: 1 } }), k);
    assert.equal(claveReservaPersona({ ...base, edadesMenores: [1, 7] }), k);
  });

  test("distingue fechas, categoría, régimen, habitaciones, pax, menores y edades", () => {
    const distintas: Partial<IdentidadReservaPersona>[] = [
      { fechaIda: "2030-10-16" }, { fechaRegreso: "2030-10-19" }, { categoria: "Superior" }, { regimen: "Todo incluido" },
      { habitaciones: { doble: 2 } }, { habitaciones: { sencilla: 1, doble: 1 } }, { pax: 3 },
      { ninos: 0, ninos2: 1 }, { infantes: 0, ninos: 2 }, { edadesMenores: [8, 1] }, { paqueteId: 11 }, { hotelId: 2 },
    ];
    for (const d of distintas) assert.notEqual(claveReservaPersona({ ...base, ...d }), k, JSON.stringify(d));
  });

  test("ítem de una versión anterior sin edades: sin menores equivale a [], con menores no coincide con ninguna búsqueda", () => {
    const sinMenores = { ...base, ninos: 0, infantes: 0, edadesMenores: [] };
    assert.equal(claveReservaPersona({ ...sinMenores, edadesMenores: undefined }), claveReservaPersona(sinMenores));
    assert.notEqual(claveReservaPersona({ ...base, edadesMenores: undefined }), k);
  });
});

// ── Reglas de la edición (servicioAdicionalPaquete.ts) ──────────────────
const hotelS: HotelParaServicios = {
  paqueteId: 10, hotelNombre: "Hotel", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, precio: 1_000_000, moneda: "COP", firma: "x",
};
const disponibles = [{ servicioId: 55, nombre: "Islas" }, { servicioId: 56, nombre: "City" }, { servicioId: null, nombre: "Sin id" }];
const res = (servicioId: number, total: number, moneda = "COP") =>
  ({ servicioId, paqueteId: 10, nombre: `S${servicioId}`, destino: "X", descripcion: null, total, pax: 2, noches: 3, moneda, categoria: "tour" as never });
const consulta = (resultados: ReturnType<typeof res>[]): ConsultaServicios => ({ clave: claveConsultaServicios(hotelS)!, estado: "ok", resultados });
const ev = (seleccion: number[], resultados: ReturnType<typeof res>[]) => evaluarServicios({ hotel: hotelS, seleccion, disponibles, consulta: consulta(resultados) });

describe("serviciosFueraDeCatalogo / mismaSeleccion", () => {
  test("nombra los guardados que el paquete ya no ofrece (sin repetidos)", () => {
    assert.deepEqual(serviciosFueraDeCatalogo([55, 99, 99, 56], disponibles), [99]);
    assert.deepEqual(serviciosFueraDeCatalogo([55], disponibles), []);
  });
  test("mismaSeleccion ignora orden y repetidos", () => {
    assert.equal(mismaSeleccion([55, 56], [56, 55, 55]), true);
    assert.equal(mismaSeleccion([55], [55, 56]), false);
    assert.equal(mismaSeleccion([], []), true);
  });
});

describe("evaluarEdicionServicios — el conjunto solo se confirma completo", () => {
  const listaOk = ev([55, 56], [res(55, 100), res(56, 50)]);
  const vacia = ev([], []);

  test("sin cambios no hay nada que confirmar", () => {
    const e = evaluarEdicionServicios({ guardados: [55], borrador: [55], disponibles, evaluacion: ev([], []), conjuntoVigente: true });
    assert.deepEqual([e.cambios, e.listo], [false, false]);
  });

  test("agregar con todo cotizado: listo", () => {
    const e = evaluarEdicionServicios({ guardados: [55], borrador: [55, 56], disponibles, evaluacion: listaOk, conjuntoVigente: true });
    assert.deepEqual([e.cambios, e.listo, e.bloqueo, e.retiroTotal], [true, true, null, false]);
  });

  test("retirar todos: listo sin cotización", () => {
    const e = evaluarEdicionServicios({ guardados: [55, 56], borrador: [], disponibles, evaluacion: vacia, conjuntoVigente: true });
    assert.deepEqual([e.cambios, e.listo, e.retiroTotal], [true, true, true]);
  });

  test("cotización pendiente o con un servicio sin precio: no se confirma", () => {
    const pendiente = evaluarServicios({ hotel: hotelS, seleccion: [55, 56], disponibles, consulta: null });
    assert.equal(evaluarEdicionServicios({ guardados: [55], borrador: [55, 56], disponibles, evaluacion: pendiente, conjuntoVigente: true }).listo, false);
    const sinPrecio = ev([55, 56], [res(55, 100)]);
    assert.equal(evaluarEdicionServicios({ guardados: [55], borrador: [55, 56], disponibles, evaluacion: sinPrecio, conjuntoVigente: true }).listo, false);
  });

  test("un servicio guardado que el catálogo ya no ofrece NO desaparece en silencio: bloquea hasta quitarlo", () => {
    // `evaluarServicios` lo omite y la evaluación del resto queda «lista»…
    const evaluacion = ev([55, 99], [res(55, 100)]);
    assert.equal(evaluacion.listo, true);
    assert.deepEqual(evaluacion.servicios.map((s) => s.servicioId), [55]);
    // …pero la edición lo nombra y no deja confirmar.
    const e = evaluarEdicionServicios({ guardados: [55, 99], borrador: [55, 99, 56], disponibles, evaluacion, conjuntoVigente: true });
    assert.deepEqual([e.listo, e.fueraDeCatalogo, e.bloqueo], [false, [99], MENSAJE_FUERA_DE_CATALOGO]);
    // Quitarlo a conciencia (y agregar otro) sí se puede confirmar.
    const e2 = evaluarEdicionServicios({ guardados: [55, 99], borrador: [55, 56], disponibles, evaluacion: listaOk, conjuntoVigente: true });
    assert.equal(e2.listo, true);
  });

  test("el carrito cambió desde que empezó el borrador: bloquea aunque todo esté cotizado", () => {
    const e = evaluarEdicionServicios({ guardados: [55], borrador: [55, 56], disponibles, evaluacion: listaOk, conjuntoVigente: false });
    assert.deepEqual([e.listo, e.bloqueo], [false, MENSAJE_CONJUNTO_CAMBIO]);
  });
});

describe("mismaCotizacion — revalidar al confirmar", () => {
  const mostrada = ev([55, 56], [res(55, 100), res(56, 50)]);
  test("idéntica: se puede aplicar", () => {
    assert.equal(mismaCotizacion(mostrada, ev([55, 56], [res(56, 50), res(55, 100)])), true);
  });
  test("precio distinto, servicio sin precio, otra moneda o lista distinta: exige reconfirmar", () => {
    assert.equal(mismaCotizacion(mostrada, ev([55, 56], [res(55, 101), res(56, 50)])), false);
    assert.equal(mismaCotizacion(mostrada, ev([55, 56], [res(55, 100)])), false);
    assert.equal(mismaCotizacion(mostrada, ev([55, 56], [res(55, 100), res(56, 50, "USD")])), false);
    assert.equal(mismaCotizacion(mostrada, ev([55], [res(55, 100)])), false);
  });
});
