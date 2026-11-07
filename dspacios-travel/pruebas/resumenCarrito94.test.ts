// #94/#52 — resumen del carrito: un infante con alojamiento en $0 es un pasajero y puede quedar cubierto por un servicio sin que se invente una tarifa
// distinta de la que el servicio ofrece (el precio TOTAL declarado se reparte por igual entre quienes cubre; no existe tarifa por tipo en la fuente).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { construirResumenCarrito, cuposDeUnidad, type UnidadBase, type PersonaBase } from "../lib/cotizacion/resumenCarrito.ts";

const adultos: PersonaBase = { clave: "adulto:doble", etiqueta: "Adulto · Doble", tipo: "adulto", cantidad: 2, tarifa: 300_000 };
const infante: PersonaBase = { clave: "infante:menor2", etiqueta: "Infante", tipo: "infante", cantidad: 1, tarifa: 0 };
const unidad = (personas: PersonaBase[], extra: Partial<UnidadBase> = {}): UnidadBase => ({
  ref: "item-0", paquete: { id: 1, nombre: "Paquete" }, hotel: "Hotel", categoria: "Estándar", regimen: "PC",
  paxTotal: personas.reduce((s, p) => s + p.cantidad, 0), infantes: personas.filter((p) => p.tipo === "infante").reduce((s, p) => s + p.cantidad, 0),
  personas, cuposActivos: null, grupoIncluido: 0, ...extra,
});
const servicio = (id: string, nombre: string, precio: number, pax: number, cubre?: string[]) => ({ id, nombre, precio, pax, hotelRef: "item-0", ...(cubre ? { cubre } : {}) });
const ok = (r: ReturnType<typeof construirResumenCarrito>) => { assert.ok(r.ok, r.ok ? "" : r.motivo); return (r as Extract<typeof r, { ok: true }>).resumen; };

describe("infante gratuito como pasajero", () => {
  test("cupos: el infante en $0 aparece con su cantidad aunque no cueste nada", () => {
    const c = cuposDeUnidad([adultos, infante]);
    assert.ok(c.ok);
    assert.deepEqual((c as Extract<typeof c, { ok: true }>).cupos.map((x) => [x.clave, x.cantidad]), [["adulto:doble", 2], ["infante:menor2", 1]]);
  });

  test("servicio para TODOS: el infante paga la misma parte del total del servicio que cada adulto (no una tarifa inventada)", () => {
    const r = ok(construirResumenCarrito({ unidades: [unidad([adultos, infante])], servicios: [servicio("t", "Tour", 300_000, 3)], modalidad: "pvp", moneda: "COP", total: 900_000 }));
    const g = r.unidades[0].grupos.map((x) => [x.tipo, x.cantidad, x.tarifaCentavos / 100, x.incluye]);
    assert.deepEqual(g, [["adulto", 2, 400_000, ["Tour"]], ["infante", 1, 100_000, ["Tour"]]], "infante: 0 de alojamiento + 100.000 del servicio");
    assert.equal(r.totalCentavos, 90_000_000);
  });

  test("servicio PARCIAL que cubre al infante y a un adulto: se reparte el total entre los dos cubiertos; el otro adulto queda sin servicio", () => {
    const r = ok(construirResumenCarrito({
      unidades: [unidad([adultos, infante], { cuposActivos: { "adulto:doble": [1, 2], "infante:menor2": [1] } })],
      servicios: [servicio("t", "Tour", 100_000, 2, ["adulto:doble#2", "infante:menor2#1"])], modalidad: "pvp", moneda: "COP", total: 600_000 + 100_000,
    }));
    const g = r.unidades[0].grupos.map((x) => [x.tipo, x.cantidad, x.tarifaCentavos / 100, x.incluye]);
    assert.deepEqual(g, [["adulto", 1, 350_000, ["Tour"]], ["adulto", 1, 300_000, []], ["infante", 1, 50_000, ["Tour"]]]);
    assert.equal(r.totalCentavos, 70_000_000);
  });

  test("sin servicios que lo cubran, el infante cuesta lo que la liquidación dice (cero): no se le asigna nada", () => {
    const r = ok(construirResumenCarrito({
      unidades: [unidad([adultos, infante], { cuposActivos: { "adulto:doble": [1, 2], "infante:menor2": [1] } })],
      servicios: [servicio("t", "Tour", 200_000, 2, ["adulto:doble#1", "adulto:doble#2"])], modalidad: "pvp", moneda: "COP", total: 600_000 + 200_000,
    }));
    const inf = r.unidades[0].grupos.find((x) => x.tipo === "infante")!;
    assert.equal(inf.tarifaCentavos, 0);
    assert.deepEqual(inf.incluye, []);
  });

  test("infante sin línea de precio (clave sin_cargo): sigue siendo cupo; si falta identificar a alguien no se reparte", () => {
    const sinLinea: PersonaBase = { clave: "infante:sin_cargo", etiqueta: "Infante · alojamiento sin cargo", tipo: "infante", cantidad: 1, tarifa: 0 };
    const r = ok(construirResumenCarrito({ unidades: [unidad([adultos, sinLinea])], servicios: [servicio("t", "Tour", 300_000, 3)], modalidad: "pvp", moneda: "COP", total: 600_000 + 300_000 }));
    assert.equal(r.unidades[0].grupos.reduce((s, g) => s + g.cantidad, 0), 3);
    // Un pasajero que nadie identificó (paxTotal mayor que los cupos) falla cerrado.
    const incompleta = construirResumenCarrito({ unidades: [unidad([adultos], { paxTotal: 3 })], servicios: [servicio("t", "Tour", 300_000, 3)], modalidad: "pvp", moneda: "COP", total: 900_000 });
    assert.equal(incompleta.ok, false);
    assert.match((incompleta as { motivo: string }).motivo, /identificar a todos los pasajeros/);
  });
});

describe("el servidor sigue validando lo que declara el carrito", () => {
  const u = () => unidad([adultos, infante], { cuposActivos: { "adulto:doble": [1, 2], "infante:menor2": [1] } });
  test("seleccionar más o menos pasajeros que el `pax` del servicio se rechaza", () => {
    const r = construirResumenCarrito({ unidades: [u()], servicios: [servicio("t", "Tour", 100_000, 2, ["adulto:doble#1"])], modalidad: "pvp", moneda: "COP", total: 700_000 });
    assert.equal(r.ok, false);
    assert.match((r as { motivo: string }).motivo, /cubre 2 pasajeros y se seleccionaron 1/);
  });
  test("un pasajero repetido o inexistente en la selección se rechaza", () => {
    const rep = construirResumenCarrito({ unidades: [u()], servicios: [servicio("t", "Tour", 100_000, 2, ["adulto:doble#1", "adulto:doble#1"])], modalidad: "pvp", moneda: "COP", total: 700_000 });
    assert.equal(rep.ok, false);
    const fantasma = construirResumenCarrito({ unidades: [u()], servicios: [servicio("t", "Tour", 100_000, 2, ["adulto:doble#1", "adulto:doble#9"])], modalidad: "pvp", moneda: "COP", total: 700_000 });
    assert.equal(fantasma.ok, false);
    assert.match((fantasma as { motivo: string }).motivo, /no existe en la cotización/);
  });
  test("ordinales activos que no cuadran con la cantidad liquidada (carrito desfasado) piden volver a seleccionar", () => {
    const r = construirResumenCarrito({ unidades: [unidad([adultos, infante], { cuposActivos: { "adulto:doble": [1], "infante:menor2": [1] } })], servicios: [servicio("t", "Tour", 100_000, 2, ["adulto:doble#1", "infante:menor2#1"])], modalidad: "pvp", moneda: "COP", total: 700_000 });
    assert.equal(r.ok, false);
    assert.match((r as { motivo: string }).motivo, /cambiaron/);
  });
  test("un servicio sin hotel declarado no se asigna al único hotel", () => {
    const r = construirResumenCarrito({ unidades: [u()], servicios: [{ id: "t", nombre: "Tour", precio: 300_000, pax: 3, hotelRef: null }], modalidad: "pvp", moneda: "COP", total: 900_000 });
    assert.equal(r.ok, false);
    assert.match((r as { motivo: string }).motivo, /no está asignado a un hotel/);
  });
});
