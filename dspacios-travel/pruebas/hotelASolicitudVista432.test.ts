import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { limitarPorPaquete, itemRestoDeSolicitud, MAX_SOLICITUD_POR_PAQUETE_PORTADA } from "../lib/tarifario/solicitudVista.ts";
import { filtrosVacios, ordenarYFiltrarResto, pasaFiltrosResto, type ItemResto } from "../lib/tarifario/inventarioResto.ts";
import { acreditarSeleccionCatalogo, validarEntradaSolicitudHotel, TEXTO_A_CONFIRMAR } from "../lib/reservar/solicitudHotelEntrada.ts";
import type { HotelBajoSolicitud } from "../lib/tarifario/datosSolicitud.ts";

// #120 (PR #432) — Vista Booking y formulario de solicitud: portada (máx. 2 por paquete), integración en resultados con los mismos filtros,
// «¿Viajan menores?» y selectores acreditados contra el catálogo configurado del hotel. Sin tocar migraciones ni cálculo financiero.

const hotel = (o: Partial<HotelBajoSolicitud> & { hotelId: number; paqueteId: number }): HotelBajoSolicitud => ({
  hotelNombre: `Hotel ${o.hotelId}`, paqueteNombre: `Paquete ${o.paqueteId}`, tipo: "bloqueo", destinoNombre: "CARTAGENA", moneda: "COP", adultsOnly: false, petFriendly: false,
  estrellas: null, zona: null, categorias: [], regimenes: [], foto: null, fotos: [], salidas: [], viaje: null, ...o,
});

describe("portada: máximo 2 por paquete", () => {
  const todos = [hotel({ hotelId: 1, paqueteId: 10 }), hotel({ hotelId: 2, paqueteId: 10 }), hotel({ hotelId: 3, paqueteId: 10 }), hotel({ hotelId: 4, paqueteId: 11 }), hotel({ hotelId: 5, paqueteId: 11 }), hotel({ hotelId: 6, paqueteId: 12 })];
  test("el límite por defecto es 2 y es por paquete, conservando el orden", () => {
    assert.equal(MAX_SOLICITUD_POR_PAQUETE_PORTADA, 2);
    assert.deepEqual(limitarPorPaquete(todos).map((h) => h.hotelId), [1, 2, 4, 5, 6]);
  });
  test("un paquete con uno solo muestra ese uno; un límite distinto se respeta", () => {
    assert.deepEqual(limitarPorPaquete([todos[5]]).map((h) => h.hotelId), [6]);
    assert.deepEqual(limitarPorPaquete(todos, 1).map((h) => h.hotelId), [1, 4, 6]);
    assert.deepEqual(limitarPorPaquete([]), []);
  });
  test("se limita DESPUÉS de filtrar: un filtro no deja a un paquete con menos tarjetas de las que le caben", () => {
    const f = { ...filtrosVacios(), petFriendly: true };
    const conPet = [hotel({ hotelId: 1, paqueteId: 10 }), hotel({ hotelId: 2, paqueteId: 10, petFriendly: true }), hotel({ hotelId: 3, paqueteId: 10, petFriendly: true }), hotel({ hotelId: 4, paqueteId: 10, petFriendly: true })];
    const visibles = limitarPorPaquete(conPet.filter((h) => pasaFiltrosResto(itemRestoDeSolicitud(h), f)));
    assert.deepEqual(visibles.map((h) => h.hotelId), [2, 3]);
  });
});

describe("resultados de búsqueda: los mismos filtros pertinentes", () => {
  const items = (hs: HotelBajoSolicitud[]) => hs.map(itemRestoDeSolicitud);
  test("el ítem no trae precio ni condición/política inventados", () => {
    const it = itemRestoDeSolicitud(hotel({ hotelId: 1, paqueteId: 10, estrellas: 4, zona: "Bocagrande" }));
    assert.equal(it.precio, null);
    assert.equal(it.condicion, "desconocido");
    assert.equal(it.politica, "desconocido");
    assert.equal(it.estrellas, 4);
    assert.equal(it.zona, "Bocagrande");
  });
  test("estrellas, zona, Pet friendly y Adults Only filtran igual que a un hotel tarifado", () => {
    const hs = [
      hotel({ hotelId: 1, paqueteId: 10, estrellas: 5, zona: "Bocagrande", petFriendly: true }),
      hotel({ hotelId: 2, paqueteId: 10, estrellas: 3, zona: "Centro", adultsOnly: true }),
      hotel({ hotelId: 3, paqueteId: 10, estrellas: null, zona: null }),
    ];
    const ids = (f: Partial<ReturnType<typeof filtrosVacios>>) => ordenarYFiltrarResto(items(hs), { orden: "predeterminado", filtros: { ...filtrosVacios(), ...f } }).map((i) => i.hotelId);
    assert.deepEqual(ids({}), [1, 2, 3]);
    assert.deepEqual(ids({ estrellas: new Set([5]) }), [1]);
    assert.deepEqual(ids({ estrellas: new Set(["sin_clasificar"]) }), [3]);
    assert.deepEqual(ids({ petFriendly: true }), [1]);
    assert.deepEqual(ids({ adultsOnly: true }), [2]);
    assert.deepEqual(ids({ zonas: new Set(["centro"]) }), [2]);
  });
  test("«Con condiciones» / «No reembolsable» los excluyen (se desconoce: nunca se afirma)", () => {
    const hs = [hotel({ hotelId: 1, paqueteId: 10 })];
    const f = (p: object) => ordenarYFiltrarResto(items(hs), { orden: "predeterminado", filtros: { ...filtrosVacios(), ...p } }).length;
    assert.equal(f({ condicion: "con" }), 0);
    assert.equal(f({ politica: "no_reembolsable" }), 0);
    assert.equal(f({}), 1);
  });
  test("entre tarifados: sin precio van al final en cualquier orden por precio, y por nombre se intercalan", () => {
    const tarifados: ItemResto[] = [
      { hotelId: 100, paqueteId: 10, nombre: "Zeta", precio: 500, estrellas: 4, zona: null, petFriendly: false, adultsOnly: false, condicion: "sin", politica: "flexible" },
      { hotelId: 101, paqueteId: 10, nombre: "Alfa", precio: 900, estrellas: 4, zona: null, petFriendly: false, adultsOnly: false, condicion: "sin", politica: "flexible" },
    ];
    const mezcla = [...tarifados, ...items([hotel({ hotelId: 1, paqueteId: 10, hotelNombre: "Mar" })])];
    const orden = (o: "precio_asc" | "precio_desc" | "nombre_asc") => ordenarYFiltrarResto(mezcla, { orden: o, filtros: filtrosVacios() }).map((i) => i.hotelId);
    assert.deepEqual(orden("precio_asc"), [100, 101, 1]);
    assert.deepEqual(orden("precio_desc"), [101, 100, 1]);
    assert.deepEqual(orden("nombre_asc"), [101, 1, 100], "por nombre queda entre los demás, no aparte");
  });
});

describe("acreditación del catálogo del hotel (servidor)", () => {
  const cat = { categorias: ["Estándar", "Suite Mar"], regimenes: [{ codigo: "PAM", nombre: "Media pensión" }, { codigo: "PC", nombre: "Pensión completa" }] };
  const base = { categoria: TEXTO_A_CONFIRMAR, regimen: TEXTO_A_CONFIRMAR };
  test("«A confirmar» siempre vale, incluso con el catálogo vacío", () => {
    assert.deepEqual(acreditarSeleccionCatalogo(base, cat), { ok: true, ...base });
    assert.deepEqual(acreditarSeleccionCatalogo(base, { categorias: [], regimenes: [] }), { ok: true, ...base });
  });
  test("un valor del catálogo se acepta y se guarda con el texto canónico (sin tildes ni mayúsculas del navegador)", () => {
    assert.deepEqual(acreditarSeleccionCatalogo({ categoria: "estandar", regimen: "pam" }, cat), { ok: true, categoria: "Estándar", regimen: "PAM" });
    assert.deepEqual(acreditarSeleccionCatalogo({ categoria: "Suite Mar", regimen: "Pensión completa" }, cat), { ok: true, categoria: "Suite Mar", regimen: "PC" });
  });
  test("valores inventados o de OTRO hotel se rechazan", () => {
    const r1 = acreditarSeleccionCatalogo({ categoria: "Penthouse", regimen: TEXTO_A_CONFIRMAR }, cat);
    assert.equal(r1.ok, false);
    assert.match(r1.ok ? "" : r1.error, /Penthouse.*no está configurado para este hotel/);
    const r2 = acreditarSeleccionCatalogo({ categoria: TEXTO_A_CONFIRMAR, regimen: "TODO INCLUIDO" }, cat);
    assert.equal(r2.ok, false);
    const otroHotel = { categorias: ["Junior Suite"], regimenes: [{ codigo: "FULL", nombre: "Full" }] };
    assert.equal(acreditarSeleccionCatalogo({ categoria: "Junior Suite", regimen: TEXTO_A_CONFIRMAR }, cat).ok, false);
    assert.equal(acreditarSeleccionCatalogo({ categoria: "Junior Suite", regimen: "FULL" }, otroHotel).ok, true);
  });
  test("un hotel sin catálogo configurado no acepta ningún texto libre", () => {
    assert.equal(acreditarSeleccionCatalogo({ categoria: "Estándar", regimen: TEXTO_A_CONFIRMAR }, { categorias: [], regimenes: [] }).ok, false);
    assert.equal(acreditarSeleccionCatalogo({ categoria: TEXTO_A_CONFIRMAR, regimen: "PAM" }, { categorias: [], regimenes: [] }).ok, false);
  });
});

describe("«¿Viajan menores?» en la entrada del servidor", () => {
  const crudo = (extra: Record<string, unknown>) => ({
    paqueteId: 1, hotelId: 2, bloqueoId: 3, empaquetadoId: null, fechaIda: "2027-03-10", fechaRegreso: "2027-03-13",
    categoria: "", regimen: "", habitaciones: { sencilla: 0, doble: 1, triple: 0, multiple: 0 },
    cliente: { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "123", telefono: "300", email: "" }, notas: "", ...extra,
  });
  const v = (extra: Record<string, unknown>) => validarEntradaSolicitudHotel(crudo(extra), "2026-11-01");
  test("No + sin edades vale; No + una edad vieja oculta se rechaza (nunca viaja)", () => {
    assert.equal(v({ viajanMenores: false, edadesMenores: [] }).ok, true);
    const mal = v({ viajanMenores: false, edadesMenores: [5] });
    assert.equal(mal.ok, false);
    assert.match(mal.ok ? "" : mal.error, /no viajan menores/);
  });
  test("Sí exige al menos una edad válida", () => {
    assert.equal(v({ viajanMenores: true, edadesMenores: [] }).ok, false);
    assert.equal(v({ viajanMenores: true, edadesMenores: [4, 9] }).ok, true);
    assert.equal(v({ viajanMenores: true, edadesMenores: [40] }).ok, false);
  });
  test("sin la respuesta (cliente anterior) rige el comportamiento de siempre", () => {
    assert.equal(v({ edadesMenores: [5] }).ok, true);
    assert.equal(v({}).ok, true);
  });
  test("categoría y régimen vacíos quedan «A confirmar»", () => {
    const r = v({ viajanMenores: false, edadesMenores: [] });
    assert.ok(r.ok);
    if (r.ok) { assert.equal(r.input.categoria, TEXTO_A_CONFIRMAR); assert.equal(r.input.regimen, TEXTO_A_CONFIRMAR); }
  });
});
