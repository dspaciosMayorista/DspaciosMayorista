// F6 (revisión del dueño 2026-11-26) — reglas puras de los formularios manuales. Los valores esperados están calculados a mano (no salen de la función probada).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  hotelesDeDestino, errorHotelFueraDeDestino, resolverCompraHotel, validarAcomodacionHotel, textoHabitaciones, normalizarHabitaciones, totalHabitaciones, contarEntero, errorInfantesSinAdulto,
} from "../lib/catalogo/validacionManual.ts";
import { errorOrdenFechas, validarFechasViaje, validarFechasAlEditar, validarNochesViaje, MENSAJE_REGRESO_ANTERIOR } from "../lib/reglas/duracionViaje.ts";

const HOTELES = [
  { id: 1, nombre: "Hotel Mar", destinoId: 10 },
  { id: 2, nombre: "Hotel Capilla del Mar", destinoId: 20 },
  { id: 3, nombre: "Hotel Sin Destino", destinoId: null },
  { id: 4, nombre: "Hotel Mar", destinoId: 20 }, // homónimo en otro destino
];

describe("B95-13 destino ↔ hotel por destino_id guardado", () => {
  test("solo se ofrecen los hoteles del destino elegido; sin destino no se ofrece ninguno; el hotel sin destino guardado nunca entra", () => {
    assert.deepEqual(hotelesDeDestino(HOTELES, 10).map((h) => h.id), [1]);
    assert.deepEqual(hotelesDeDestino(HOTELES, 20).map((h) => h.id), [2, 4]);
    assert.deepEqual(hotelesDeDestino(HOTELES, null), []);
    assert.deepEqual(hotelesDeDestino(HOTELES, 99), []);
  });
  test("un hotel del catálogo de otro destino se rechaza (texto libre = null no se compara)", () => {
    assert.match(errorHotelFueraDeDestino(HOTELES[1], 10) ?? "", /no pertenece al destino elegido/);
    assert.match(errorHotelFueraDeDestino(HOTELES[2], 10) ?? "", /no pertenece/);
    assert.match(errorHotelFueraDeDestino(HOTELES[0], null) ?? "", /Elige primero el destino/);
    assert.equal(errorHotelFueraDeDestino(HOTELES[0], 10), null);
    assert.equal(errorHotelFueraDeDestino(null, 10), null);
  });
});

describe("B95-14 regreso anterior a la salida", () => {
  test("el validador compartido rechaza -1 noche, acepta 0 y 3, y conserva el máximo de 30", () => {
    assert.equal(errorOrdenFechas("2027-03-10", "2027-03-09"), MENSAJE_REGRESO_ANTERIOR);
    assert.equal(errorOrdenFechas("2027-03-10", "2027-03-10"), null);
    assert.equal(errorOrdenFechas("2027-03-10", "2027-03-13"), null);
    assert.equal(errorOrdenFechas("", "2027-03-13"), null);
    assert.deepEqual(validarFechasViaje("2027-03-10", "2027-03-09"), { ok: false, error: MENSAJE_REGRESO_ANTERIOR });
    assert.deepEqual(validarFechasViaje("2027-03-10", "2027-03-13"), { ok: true });
    assert.equal(validarFechasViaje("2027-03-01", "2027-04-01").ok, false); // 31 noches: la regla anterior sigue
    assert.equal(validarNochesViaje(-1).ok, false);
    assert.equal(validarNochesViaje(0).ok, true);
  });
  test("al editar: un producto antiguo YA invertido se conserva si no cambia; cambiarlo a otra inversión se rechaza", () => {
    assert.deepEqual(validarFechasAlEditar("2027-05-10", "2027-05-08", "2027-05-10", "2027-05-08"), { ok: true });
    assert.deepEqual(validarFechasAlEditar("2027-05-10", "2027-05-07", "2027-05-10", "2027-05-08"), { ok: false, error: MENSAJE_REGRESO_ANTERIOR });
    assert.deepEqual(validarFechasAlEditar("2027-05-10", "2027-05-12", "2027-05-10", "2027-05-08"), { ok: true }); // se corrige: válido
  });
});

describe("B95-15 compra directa vs por plataforma", () => {
  test("plataforma: el proveedor a pagar ES la plataforma (no el proveedor del hotel); sin nombre se rechaza", () => {
    const r = resolverCompraHotel({ compra: "plataforma", plataforma: " Despegar ", proveedor: "Proveedor del hotel SAS", proveedorCatalogo: "Proveedor del hotel SAS", nombreHotel: "Hotel Mar" });
    assert.deepEqual(r, { ok: true, compra: "plataforma", proveedor: "Despegar", plataforma: "Despegar", aviso: null });
    assert.equal(resolverCompraHotel({ compra: "plataforma", plataforma: "  ", nombreHotel: "Hotel Mar" }).ok, false);
  });
  test("directa: usa el proveedor configurado del hotel; uno escrito distinto avisa; sin ninguno se rechaza y NO cae a la plataforma", () => {
    const base = { compra: "directa", nombreHotel: "Hotel Mar" } as const;
    assert.deepEqual(resolverCompraHotel({ ...base, proveedor: "", proveedorCatalogo: "Hoteles del Caribe", plataforma: "Despegar" }), { ok: true, compra: "directa", proveedor: "Hoteles del Caribe", plataforma: null, aviso: null });
    const distinto = resolverCompraHotel({ ...base, proveedor: "Otro SAS", proveedorCatalogo: "Hoteles del Caribe" });
    assert.ok(distinto.ok && /distinto del configurado/.test(distinto.aviso ?? "") && distinto.proveedor === "Otro SAS");
    const manual = resolverCompraHotel({ ...base, proveedor: "Escrito a mano", proveedorCatalogo: null });
    assert.ok(manual.ok && /no tiene proveedor configurado/.test(manual.aviso ?? ""));
    const vacio = resolverCompraHotel({ ...base, proveedor: "", proveedorCatalogo: null, plataforma: "Despegar" });
    assert.equal(vacio.ok, false);
    assert.match(vacio.ok ? "" : vacio.error, /no hay proveedor/);
  });
  test("sin elegir el origen no hay valor por defecto", () => {
    assert.equal(resolverCompraHotel({ proveedor: "X" }).ok, false);
    assert.equal(resolverCompraHotel({ compra: "otra", proveedor: "X" }).ok, false);
  });
});

describe("B95-20 acomodación estructurada vs ocupación", () => {
  const dobleCfg = { acomodacion: "doble" as const, pax_tarifa: 2, pax_max: 4, adt_min: 0, adt_max: 0, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 1 }; // adt_min/adt_max en 0: así vienen las filas sin configurar y NO deben producir errores
  test("texto derivado: cantidades por tipo, en orden fijo; lo no numérico se descarta", () => {
    assert.equal(textoHabitaciones({ doble: 1, sencilla: 2 }), "2 hab Sencilla · 1 hab Doble");
    assert.deepEqual(normalizarHabitaciones({ doble: "2", triple: -1, multiple: 1.9, x: 5 }), { sencilla: 0, doble: 2, triple: 0, multiple: 1 });
    assert.equal(totalHabitaciones({}), 0);
  });
  test("«1 doble» con 3 adultos NO cuadra (una Doble aloja 2 adultos); con 2 adultos sí", () => {
    const e3 = validarAcomodacionHotel({ doble: 1 }, { adultos: 3, ninos: 0, infantes: 0 }, { nombre: "Hotel Mar" });
    assert.equal(e3.length, 1);
    assert.match(e3[0], /alojan 2 adulto\(s\); el viaje tiene 3/);
    assert.deepEqual(validarAcomodacionHotel({ doble: 1 }, { adultos: 2, ninos: 0, infantes: 0 }, { nombre: "Hotel Mar" }), []);
  });
  test("1 adulto en una Doble: faltan adultos (se necesitan 2); sin ninguna habitación se pide la estructura", () => {
    assert.match(validarAcomodacionHotel({ doble: 1 }, { adultos: 1, ninos: 0, infantes: 0 })[0], /necesitan 2 adulto/);
    assert.match(validarAcomodacionHotel({}, { adultos: 2, ninos: 0, infantes: 0 })[0], /Indica las habitaciones/);
  });
  test("mezcla de habitaciones: 1 Doble + 1 Sencilla = exactamente 3 adultos", () => {
    assert.deepEqual(validarAcomodacionHotel({ doble: 1, sencilla: 1 }, { adultos: 3, ninos: 0, infantes: 0 }), []);
    assert.equal(validarAcomodacionHotel({ doble: 1, sencilla: 1 }, { adultos: 4, ninos: 0, infantes: 0 }).length, 1);
  });
  test("niños e infantes: usan su capacidad, no plaza de adulto; con la regla del hotel (Doble: 2 niños y 1 infante) 3 niños se rechazan", () => {
    const hotel = { nombre: "Hotel Mar", reglas: [dobleCfg] };
    assert.deepEqual(validarAcomodacionHotel({ doble: 1 }, { adultos: 2, ninos: 2, infantes: 1 }, hotel), []);
    const mal = validarAcomodacionHotel({ doble: 1 }, { adultos: 2, ninos: 3, infantes: 0 }, hotel);
    assert.ok(mal.some((x) => /máximo 2 niño\(s\); seleccionaste 3/.test(x)), mal.join("|"));
    const infMal = validarAcomodacionHotel({ doble: 1 }, { adultos: 2, ninos: 0, infantes: 2 }, hotel);
    assert.ok(infMal.some((x) => /máximo 1 infante\(s\); seleccionaste 2/.test(x)), infMal.join("|"));
  });
  test("hotel SIN reglas configuradas (escrito a mano): no se inventa un tope de capacidad; 2 adultos + 1 niño + 1 infante en una Doble pasan, pero los adultos siguen contando", () => {
    assert.deepEqual(validarAcomodacionHotel({ doble: 1 }, { adultos: 2, ninos: 1, infantes: 1 }, { nombre: "Posada manual" }), []);
    assert.equal(validarAcomodacionHotel({ doble: 1 }, { adultos: 3, ninos: 1, infantes: 0 }, { nombre: "Posada manual" }).length, 1);
  });
  test("mín/máx del hotel y tipo no ofrecido", () => {
    assert.ok(validarAcomodacionHotel({ doble: 1 }, { adultos: 2, ninos: 0, infantes: 0 }, { paxMax: 1 }).some((x) => /máximo 1 pax por reserva/.test(x)));
    assert.ok(validarAcomodacionHotel({ triple: 1 }, { adultos: 3, ninos: 0, infantes: 0 }, { nombre: "Hotel Mar", tiposOfrecidos: ["doble"] }).some((x) => /no ofrece habitación Triple/.test(x)));
  });
  test("conteos de formulario: vacío = 0, decimal/negativo = inválido; infante sin adulto", () => {
    assert.equal(contarEntero(""), 0);
    assert.equal(contarEntero("2"), 2);
    assert.equal(contarEntero("1.5"), null);
    assert.equal(contarEntero("-1"), null);
    assert.equal(errorInfantesSinAdulto(0, 1) !== null, true);
    assert.equal(errorInfantesSinAdulto(2, 1), null);
  });
});
