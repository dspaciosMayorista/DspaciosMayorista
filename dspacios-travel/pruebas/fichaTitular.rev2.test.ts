// B2-11 / B2-12a — ficha del titular de una cotización: solo lo guardado, nunca inferido. Datos sintéticos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fichaTitularCotizacion, enmascararDocumento } from "../lib/cotizacion/fichaTitular.ts";

const cli = { nombres: "Ana", apellidos: "Perez", tipoDoc: "CC", numeroDoc: "1010101010", nacimiento: "1990-05-04", telefono: "3001112233", email: "ana@x.test" };
const base = { id: 1, tenant: "mayorista", tipo: "manual", estado: "abierta", cliente: "Ana Perez", pax: 2, creado_por_id: "u1", payload: { cliente: cli } };
const puesto = (rol: string, activo = true) => ({ id: "p-" + rol, rol, activo });

test("titular completo: nombre, «CC número», nacimiento, teléfono y correo; lo ausente es null (No registrado)", () => {
  const f = fichaTitularCotizacion(base as never);
  assert.deepEqual([f.nombre, f.documento, f.nacimiento, f.telefono, f.email, f.identificado], ["Ana Perez", "CC 1010101010", "1990-05-04", "3001112233", "ana@x.test", true]);
  const parcial = fichaTitularCotizacion({ ...base, payload: { cliente: { nombres: "Ana", apellidos: "", numeroDoc: "", tipoDoc: "CC" } } } as never);
  assert.deepEqual([parcial.nombre, parcial.documento, parcial.nacimiento, parcial.telefono, parcial.email], ["Ana", null, null, null, null]);
});

test("documento sin tipo guardado: no se supone «CC»", () => {
  const f = fichaTitularCotizacion({ ...base, payload: { cliente: { ...cli, tipoDoc: "" } } } as never);
  assert.equal(f.documento, "1010101010 (tipo no registrado)");
});

test("titular de relleno del motor («Cliente» sin documento) no es una persona; sin payload.cliente queda solo el texto de la columna", () => {
  const relleno = fichaTitularCotizacion({ ...base, cliente: "Cliente", payload: { cliente: { nombres: "Cliente", apellidos: "", numeroDoc: "" } } } as never, { puestos: [] });
  assert.deepEqual([relleno.nombre, relleno.identificado, relleno.registro], [null, false, "sin_titular"]);
  const sinPayload = fichaTitularCotizacion({ ...base, cliente: "Solo Columna", payload: {} } as never);
  assert.deepEqual([sinPayload.nombre, sinPayload.documento, sinPayload.identificado], ["Solo Columna", null, false]);
});

test("composición: manual = adultos + niños + infantes guardados; carrito = total; solicitud de hotel = adultos/menores y edades", () => {
  const m = fichaTitularCotizacion({ ...base, payload: { cliente: cli, ninos: 2, infantes: 1 } } as never);
  assert.deepEqual(m.composicion, [{ etiqueta: "Adultos", valor: "2" }, { etiqueta: "Niños", valor: "2" }, { etiqueta: "Infantes", valor: "1" }]);
  const sinMenores = fichaTitularCotizacion(base as never);
  assert.deepEqual(sinMenores.composicion, [{ etiqueta: "Adultos", valor: "2" }]); // lo no guardado no se rotula 0
  const car = fichaTitularCotizacion({ ...base, tipo: "carrito", pax: 3 } as never);
  assert.deepEqual(car.composicion, [{ etiqueta: "Pasajeros (total)", valor: "3" }]);
  const sol = fichaTitularCotizacion({ ...base, tipo: "tarifario", estado: "pendiente_tarifa", creado_por_id: null, pax: 3,
    detalle: { solicitudHotel: { adultos: 2, menores: 1 } }, payload: { cliente: cli, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [7] } } as never);
  assert.deepEqual(sol.composicion, [{ etiqueta: "Adultos", valor: "2" }, { etiqueta: "Menores", valor: "1" }, { etiqueta: "Niños", valor: "0" }, { etiqueta: "Infantes", valor: "0" }, { etiqueta: "Edades de los menores", valor: "7" }]);
  assert.match(sol.origen, /Solicitud de hotel bajo solicitud/);
});

test("viajeros: los de la cotización y los que indicó el aliado, rotulados por fuente; una fila vacía no cuenta", () => {
  const f = fichaTitularCotizacion(
    { ...base, tipo: "carrito", payload: { cliente: cli, pasajeros: [{ nombres: "Beto", apellidos: "P", tipoDoc: "TI", numeroDoc: "2020" }, { nombres: " ", apellidos: "", numeroDoc: "" }] } } as never,
    { pasajerosAliado: [{ nombres: "Carla", apellidos: "Q", tipoDoc: "CC", numeroDoc: "3030", fechaNacimiento: "1985-02-02" }, { nombres: "", apellidos: "", numeroDoc: "" }] },
  );
  assert.deepEqual(f.pasajeros.map((p) => [p.nombre, p.documento, p.nacimiento, p.fuente]), [["Beto P", "TI 2020", null, "cotizacion"], ["Carla Q", "CC 3030", "1985-02-02", "aliado"]]);
});

test("origen: visitante público, aliado B2B (viajero ≠ aliado) o personal interno con su asesor", () => {
  const visitante = fichaTitularCotizacion({ ...base, tipo: "carrito", creado_por_id: null, propietario_id: null, aliado_id: null } as never);
  assert.match(visitante.origen, /Carrito del tarifario · visitante del tarifario público \(sin sesión\)/);
  const b2b = fichaTitularCotizacion({ ...base, payload: { cliente: cli, tipoAsesor: "agencia", agenciaNombre: "Agencia Humo" } } as never);
  assert.deepEqual(b2b.aliado, { tipo: "agencia", nombre: "Agencia Humo" });
  assert.match(b2b.origen, /aliado B2B \(agencia: Agencia Humo\)/);
  assert.equal(b2b.nombre, "Ana Perez"); // el titular sigue siendo el viajero
  const interno = fichaTitularCotizacion({ ...base, asesor: "Rev Venta" } as never);
  assert.match(interno.origen, /Cotización dinámica · personal interno · asesor Rev Venta/);
  assert.equal(interno.aliado, null);
  const madre = fichaTitularCotizacion({ ...base, modo: "comparativa" } as never);
  assert.match(madre.origen, /^Comparativa de opciones/);
});

test("registro en Personas de cotización: derivado de los puestos reales; sin lectura de puestos no se afirma nada", () => {
  assert.equal(fichaTitularCotizacion(base as never).registro, "desconocido");
  assert.equal(fichaTitularCotizacion(base as never, { puestos: [puesto("titular")] }).registro, "registrado");
  assert.equal(fichaTitularCotizacion(base as never, { puestos: [] }).registro, "pendiente");
  // abierta con un puesto inactivo: sigue pendiente de registrar; convertida/descartada sin puesto: NO es «pendiente» (ya no se reintenta), solo «sin puesto».
  assert.equal(fichaTitularCotizacion(base as never, { puestos: [puesto("titular", false)] }).registro, "pendiente");
  assert.equal(fichaTitularCotizacion({ ...base, estado: "convertida" } as never, { puestos: [] }).registro, "sin_puesto");
  assert.equal(fichaTitularCotizacion({ ...base, estado: "descartada" } as never, { puestos: [puesto("titular")] }).registro, "registrado");
  assert.equal(fichaTitularCotizacion({ ...base, payload: {} } as never, { puestos: [] }).registro, "sin_titular");
});

test("documento enmascarado en listas: solo los últimos 4; documentos cortos o vacíos", () => {
  assert.equal(enmascararDocumento("1010101010"), "••••1010");
  assert.equal(enmascararDocumento("123"), "••••");
  assert.equal(enmascararDocumento("  "), null);
  assert.equal(enmascararDocumento(null), null);
});
