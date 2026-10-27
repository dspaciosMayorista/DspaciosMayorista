import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validarServicioManual, tramosVueloManual, coberturaVuelos, objetivoCubierto, validarCoberturaVuelos, vuelosComunesCompatibles, verificarManualesCotizados,
  descripcionCotizacionManual, type ServicioManual,
} from "../lib/cart/servicioManual.ts";

// #64 (ronda 12) — horas de los vuelos manuales, «otro servicio» por grupo y cobertura de tramos (lógica pura; el servidor y la pantalla comparten estas funciones).
const G = "grupo:CTG|2030-10-15|2030-10-18";
const base = { clase: "vuelo", nombre: "Tiquete Avianca", pax: 2, precio: 1_800_000, moneda: "COP", impuestoNoComisionable: 200_000, hotelRef: G, origen: "BOG", destino: "CTG", tramo: "ida_regreso", fechaIda: "2030-10-15", fechaRegreso: "2030-10-18" };
const v = (o: Record<string, unknown> = {}): ServicioManual => { const r = validarServicioManual({ ...base, ...o }); assert.ok(r.ok, r.ok ? "" : r.error); return (r as { valor: ServicioManual }).valor; };
const falla = (o: Record<string, unknown>) => { const r = validarServicioManual({ ...base, ...o }); assert.equal(r.ok, false); return r.ok ? "" : r.error; };

describe("horas del vuelo manual (HH:mm, hora local de salida, opcionales)", () => {
  test("válidas: 00:00, 06:45, 23:59; vacías o ausentes = null (horario sin confirmar)", () => {
    for (const h of ["00:00", "06:45", "12:00", "23:59"]) assert.equal(v({ horaIda: h }).horaIda, h);
    assert.deepEqual([v().horaIda, v().horaRegreso], [null, null]);
    const vacias = v({ horaIda: "", horaRegreso: null });
    assert.deepEqual([vacias.horaIda, vacias.horaRegreso], [null, null]);
  });
  test("formato inválido se rechaza con un mensaje claro (sin cero a la izquierda, 24:00, minutos 60, AM/PM, segundos, texto, número)", () => {
    for (const h of ["6:45", "24:00", "12:60", "6:45 PM", "06:45:10", "mañana", "0645", 645]) assert.match(falla({ horaIda: h }), /HH:mm de 24 horas/, String(h));
  });
  test("la hora solo existe para un tramo que el vuelo lleva", () => {
    assert.match(falla({ tramo: "ida", fechaRegreso: null, horaRegreso: "10:00" }), /solo ida no lleva la hora de regreso/);
    assert.match(falla({ tramo: "regreso", fechaIda: null, origen: "CTG", destino: "BOG", horaIda: "10:00" }), /solo regreso no lleva la hora de ida/);
    assert.equal(v({ tramo: "ida", fechaRegreso: null, horaIda: "10:00" }).horaIda, "10:00");
  });
  test("cada tramo del cuadro de vuelos lleva SU hora local de salida; no hay hora de llegada ni número de vuelo inventados", () => {
    const t = tramosVueloManual(v({ horaIda: "06:45", horaRegreso: "18:20" }), true);
    assert.deepEqual(t.map((x) => [x.direccion, x.hora_salida, x.numero_vuelo]), [["ida", "06:45", null], ["regreso", "18:20", null]]);
    assert.ok(t.every((x) => !("hora_llegada" in x)));
    assert.deepEqual(tramosVueloManual(v({ tramo: "regreso", fechaIda: null, origen: "CTG", destino: "BOG", horaRegreso: "09:05" }), false).map((x) => x.hora_salida), ["09:05"]);
    assert.deepEqual(tramosVueloManual(v(), true).map((x) => x.hora_salida), [null, null]);
  });
  test("la hora está congelada: la cotización guardada debe coincidir con las filas pintadas (cambiarla se detecta)", () => {
    const m = v({ horaIda: "06:45" });
    const detalle = tramosVueloManual(m, true);
    const doc = [{ descripcion: descripcionCotizacionManual(m), valor_total: m.precio }];
    assert.equal(verificarManualesCotizados({ payload: { manuales: [m] }, detalleItems: doc, detalleVuelos: detalle, plan: null, moneda: "COP" }).ok, true);
    const alterado = detalle.map((t, i) => (i === 0 ? { ...t, hora_salida: "07:45" } : t));
    const r = verificarManualesCotizados({ payload: { manuales: [m] }, detalleItems: doc, detalleVuelos: alterado, plan: null, moneda: "COP" });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /hora_salida/);
  });
  test("una cotización anterior (sin horas) sigue siendo consistente", () => {
    const m = v();
    const { horaIda: _a, horaRegreso: _b, ...viejo } = m;
    void _a; void _b;
    const detalle = tramosVueloManual(m, true).map(({ hora_salida: _h, ...resto }) => { void _h; return resto; });
    const doc = [{ descripcion: descripcionCotizacionManual(m), valor_total: m.precio }];
    assert.equal(verificarManualesCotizados({ payload: { manuales: [viejo] }, detalleItems: doc, detalleVuelos: detalle, plan: null, moneda: "COP" }).ok, true);
  });
});

describe("«otro servicio» en una comparativa", () => {
  const otro = (o: Record<string, unknown> = {}) => ({ clase: "otro", nombre: "Traslado privado", pax: 2, precio: 90_000, moneda: "COP", impuestoNoComisionable: 25_000, origen: null, destino: null, fechaIda: null, fechaRegreso: null, hotelRef: G, ...o });
  const hoteles = [
    { ref: "a", id: "a", nombre: "A", destino: "CARTAGENA", destinoIata: "CTG", fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", pax: 2 },
    { ref: "b", id: "b", nombre: "B", destino: "CARTAGENA", destinoIata: "CTG", fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", pax: 2 },
  ];
  test("conserva su grupo; sin tramo, sin horas; moneda e impuesto como cualquier manual", () => {
    const r = validarServicioManual(otro({ horaIda: "06:00", tramo: "ida" }));
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual([r.valor.hotelRef, r.valor.tramo, r.valor.horaIda, r.valor.impuestoNoComisionable, r.valor.moneda], [G, null, null, 25_000, "COP"]);
  });
  test("se admite en la comparativa: por grupo o «comun» con un solo grupo; un grupo inexistente o «comun» con varios se rechaza; no supera los pasajeros de ninguna opción", () => {
    const m = (o?: Record<string, unknown>) => (validarServicioManual(otro(o)) as { valor: ServicioManual }).valor;
    assert.equal(vuelosComunesCompatibles([m()], hoteles).ok, true);
    assert.equal(vuelosComunesCompatibles([m({ hotelRef: "comun" })], hoteles).ok, true);
    assert.match((vuelosComunesCompatibles([m({ hotelRef: "grupo:ZZZ|2031-01-01|2031-01-02" })], hoteles) as { error: string }).error, /no pertenece a ningún grupo/);
    assert.match((vuelosComunesCompatibles([m({ pax: 3 })], hoteles) as { error: string }).error, /solo 2/);
    const dos = [...hoteles, { ...hoteles[0], ref: "s", id: "s", destino: "SANTA MARTA", destinoIata: "SMR", fechaIda: "2030-10-20", fechaRegreso: "2030-10-24" }];
    assert.match((vuelosComunesCompatibles([m({ hotelRef: "comun" })], dos) as { error: string }).error, /elige a qué grupo/);
  });
});

describe("cobertura de tramos por grupo", () => {
  const f = (tramo: string, pax: number, hotelRef = G): ServicioManual => v({ tramo, pax, hotelRef, ...(tramo === "ida" ? { fechaRegreso: null } : tramo === "regreso" ? { fechaIda: null, origen: "CTG", destino: "BOG" } : {}) });
  const objetivo = (m: ServicioManual) => m.hotelRef;
  test("ida_regreso cubre los dos tramos; una ida sola deja el regreso por cubrir; la cobertura parcial deja el grupo disponible", () => {
    assert.equal(objetivoCubierto(coberturaVuelos([f("ida_regreso", 2)], objetivo).get(G), 2), true);
    assert.equal(objetivoCubierto(coberturaVuelos([f("ida", 2)], objetivo).get(G), 2), false, "falta el regreso");
    assert.equal(objetivoCubierto(coberturaVuelos([f("ida_regreso", 1)], objetivo).get(G), 2), false, "falta 1 pasajero");
    assert.equal(objetivoCubierto(coberturaVuelos([f("ida", 2), f("regreso", 2)], objetivo).get(G), 2), true);
    assert.equal(objetivoCubierto(coberturaVuelos([f("ida_regreso", 1), f("ida_regreso", 1)], objetivo).get(G), 2), true);
    assert.equal(objetivoCubierto(undefined, 2), false);
    assert.equal(objetivoCubierto({ ida: 2, regreso: 2 }, 0), false, "sin pasajeros no hay nada cubierto");
  });
  test("al editar un vuelo se excluye de la cobertura: su propio grupo sigue disponible", () => {
    const lista = [f("ida_regreso", 2)];
    assert.equal(objetivoCubierto(coberturaVuelos(lista, objetivo, null).get(G), 2), true);
    assert.equal(objetivoCubierto(coberturaVuelos(lista, objetivo, 0).get(G), 2), false);
  });
  test("un «otro servicio» no cuenta como cobertura", () => {
    const o = validarServicioManual({ clase: "otro", nombre: "Traslado privado", pax: 2, precio: 1, moneda: "COP", impuestoNoComisionable: 0, hotelRef: G }) as { valor: ServicioManual };
    assert.equal(coberturaVuelos([o.valor], objetivo).size, 0);
  });
  test("validarCoberturaVuelos: duplicado, exceso y mensajes; cada grupo por separado; sin pasajeros conocidos no rechaza", () => {
    const pax = () => 2;
    assert.equal(validarCoberturaVuelos([f("ida_regreso", 1), f("ida_regreso", 1)], objetivo, pax).ok, true);
    const dup = validarCoberturaVuelos([f("ida_regreso", 2), f("ida_regreso", 2)], objetivo, pax);
    assert.match(dup.ok ? "" : dup.error, /el tramo de ida ya está cubierto para los 2 pasajeros/);
    const exc = validarCoberturaVuelos([f("ida", 1), f("ida", 2)], objetivo, pax);
    assert.match(exc.ok ? "" : exc.error, /el tramo de ida cubriría 3 pasajeros y solo viajan 2 \(ya hay 1 cubiertos; faltan 1\)/);
    const otroGrupo = "grupo:SMR|2030-10-20|2030-10-24";
    assert.equal(validarCoberturaVuelos([f("ida_regreso", 2), f("ida_regreso", 2, otroGrupo)], objetivo, pax).ok, true, "otro grupo, otra cobertura");
    assert.equal(validarCoberturaVuelos([f("ida_regreso", 2), f("ida_regreso", 2)], objetivo, () => null).ok, true);
    assert.equal(validarCoberturaVuelos([f("ida_regreso", 2), f("ida_regreso", 2)], () => null, pax).ok, true, "sin objetivo no cuenta");
  });
});

describe("límite del grupo: la opción con MENOS pasajeros (el mismo que usa la pantalla)", () => {
  const hoteles = [
    { ref: "a", id: "a", nombre: "A", destino: "CARTAGENA", destinoIata: "CTG", fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", pax: 2 },
    { ref: "b", id: "b", nombre: "B", destino: "CARTAGENA", destinoIata: "CTG", fechaIda: "2030-10-15", fechaRegreso: "2030-10-18", pax: 4 },
  ];
  const vuelo = (pax: number, nombre = "Vuelo"): ServicioManual => v({ pax, nombre });
  test("un vuelo de 2 cabe; de 3 o 4 se rechaza (la opción de 2 no los admite); 2 + 2 duplica la ida", () => {
    assert.equal(vuelosComunesCompatibles([vuelo(2)], hoteles).ok, true);
    for (const n of [3, 4]) assert.match((vuelosComunesCompatibles([vuelo(n)], hoteles) as { error: string }).error, /solo 2/);
    const dos = vuelosComunesCompatibles([vuelo(2), vuelo(2, "Otro")], hoteles);
    assert.equal(dos.ok, false);
    assert.match((dos as { error: string }).error, /ya está cubierto para los 2 pasajeros/);
  });
  test("cobertura parcial con otra aerolínea: 1 + 1 cabe y 1 + 2 no", () => {
    assert.equal(vuelosComunesCompatibles([vuelo(1), vuelo(1, "Otra aerolínea")], hoteles).ok, true);
    assert.equal(vuelosComunesCompatibles([vuelo(1), vuelo(2, "Otra")], hoteles).ok, false);
  });
});
