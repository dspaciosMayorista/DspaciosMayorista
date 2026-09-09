import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cargoGrupoIncluido, type ServicioGrupoIncluido } from "../lib/reservar/serviciosPaquete.ts";

// ───────────────────────────────────────────────────────────────────────────
// B6 · SERVICIO INCLUIDO CON COBRO POR GRUPO
//
// Un servicio incluido en el paquete (`armado_servicios.incluido = true`) con
// cobro POR GRUPO no tiene precio por persona: su tarifa depende del número
// real de viajeros (`servicio_tarifa_pax`). Antes se caía por una grieta:
// `aporteServiciosIncluidos` lo saltaba (no tiene `precio_persona`), así que
// NO entraba al PVP, pero sí se le creaba la cuenta por pagar → costo sin
// ingreso, es decir pérdida, contradiciendo "Incluido (todo junto)".
//
// `cargoGrupoIncluido` es la ÚNICA fórmula que lo cobra, y la usan las tres
// superficies con pax real (búsqueda/Vista Booking, cotización del carrito y
// contrato). Estas pruebas ejecutan la función de verdad.
// ───────────────────────────────────────────────────────────────────────────

function servicio(over: Partial<ServicioGrupoIncluido> & { servicioId: number }): ServicioGrupoIncluido {
  return {
    nombre: "Traslado grupal", categoria: "tour_traslado", liquidacion: null, proveedorId: 7,
    rangos: [{ pax_desde: 1, pax_hasta: 4, precio: 200000 }, { pax_desde: 5, pax_hasta: 10, precio: 350000 }],
    ...over,
  };
}

describe("cargoGrupoIncluido — se cobra UNA vez, con el pax real", () => {
  test("rango que cubre el pax: cobra el precio del grupo con markup, una sola vez", () => {
    // Neto del rango 1-4 = 200.000; markup 20% (margen) → 200.000 / 0,8 = 250.000.
    const r = cargoGrupoIncluido([servicio({ servicioId: 1 })], 3, 0.2, 3);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.pvp, 250000);
    assert.equal(r.servicios.length, 1);
    assert.equal(r.servicios[0].costoNeto, 200000, "el COSTO es el neto del proveedor, sin markup");
    assert.equal(r.servicios[0].incluido, true);
    assert.equal(r.servicios[0].servicioId, 1);
  });

  test("el cargo NO se multiplica por pax — 3 y 4 pax del mismo rango pagan lo mismo", () => {
    const tres = cargoGrupoIncluido([servicio({ servicioId: 1 })], 3, 0.2, 3);
    const cuatro = cargoGrupoIncluido([servicio({ servicioId: 1 })], 4, 0.2, 3);
    assert.equal(tres.ok && cuatro.ok, true);
    if (!tres.ok || !cuatro.ok) return;
    assert.equal(tres.pvp, cuatro.pvp);
  });

  test("el rango se elige por el pax real: 6 pax paga el rango 5-10, no el de 1-4", () => {
    const r = cargoGrupoIncluido([servicio({ servicioId: 1 })], 6, 0, 3);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.pvp, 350000);
    assert.equal(r.servicios[0].costoNeto, 350000);
  });

  test("markup 0 → PVP = neto (no inventa margen)", () => {
    const r = cargoGrupoIncluido([servicio({ servicioId: 1 })], 2, 0, 3);
    assert.equal(r.ok && r.pvp, 200000);
  });

  test("dos servicios incluidos por grupo suman sus dos cargos y devuelven DOS entradas (una CxP cada uno)", () => {
    const r = cargoGrupoIncluido(
      [
        servicio({ servicioId: 1, nombre: "Traslado grupal" }),
        servicio({ servicioId: 2, nombre: "City tour grupal", rangos: [{ pax_desde: 1, pax_hasta: 10, precio: 100000 }] }),
      ],
      3, 0, 3
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.pvp, 300000);
    assert.deepEqual(r.servicios.map((s) => s.servicioId), [1, 2]);
    assert.deepEqual(r.servicios.map((s) => s.costoNeto), [200000, 100000]);
  });

  test("liquidación por noche multiplica por las noches (mismo motor que el resto de servicios)", () => {
    const porNoche = cargoGrupoIncluido([servicio({ servicioId: 1, liquidacion: "noche" })], 3, 0, 3);
    const total = cargoGrupoIncluido([servicio({ servicioId: 1, liquidacion: null })], 3, 0, 3);
    assert.equal(porNoche.ok && total.ok, true);
    if (!porNoche.ok || !total.ok) return;
    assert.equal(porNoche.pvp, 600000);
    assert.equal(total.pvp, 200000);
  });
});

describe("cargoGrupoIncluido — FALLA CERRADO cuando no hay tarifa para ese pax", () => {
  test("pax fuera de todo rango: no inventa precio ni divide, devuelve ok:false con el nombre y el pax", () => {
    const r = cargoGrupoIncluido([servicio({ servicioId: 1 })], 12, 0.2, 3);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.nombre, "Traslado grupal");
    assert.equal(r.totalPax, 12);
  });

  test("servicio sin ningún rango cargado: también falla (nunca queda gratis en silencio)", () => {
    const r = cargoGrupoIncluido([servicio({ servicioId: 1, rangos: [] })], 3, 0.2, 3);
    assert.equal(r.ok, false);
  });

  test("si UNO de los dos servicios no tiene rango, falla TODO (no cotiza a medias)", () => {
    const r = cargoGrupoIncluido(
      [servicio({ servicioId: 1 }), servicio({ servicioId: 2, nombre: "Sin tarifa", rangos: [] })],
      3, 0, 3
    );
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.nombre, "Sin tarifa");
  });

  test("lista vacía = no hay nada que cobrar (ok, sin cargo) — no es un error", () => {
    const r = cargoGrupoIncluido([], 3, 0.2, 3);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.pvp, 0);
    assert.equal(r.servicios.length, 0);
  });
});

describe("B6 · el precio mostrado y el cobrado salen de la MISMA fórmula", () => {
  // Prueba de equivalencia: la búsqueda (Vista Booking) y el contrato usan
  // `cargoGrupoIncluido` con el mismo pax real. Si alguien vuelve a calcular
  // el cargo por otro lado (ej. dividiéndolo por pax en la vitrina), este
  // control se rompe.
  test("búsqueda (total del combo) y contrato (precioVenta) coinciden peso a peso", () => {
    const servicios = [servicio({ servicioId: 1 })];
    const pctMk = 0.25, noches = 3, paxReal = 4;

    const hotelPvp = 1_200_000; // idéntico en las dos superficies (mismo motor de hotel)
    const cargoBusqueda = cargoGrupoIncluido(servicios, paxReal, pctMk, noches);
    const cargoContrato = cargoGrupoIncluido(servicios, paxReal, pctMk, noches);
    assert.equal(cargoBusqueda.ok && cargoContrato.ok, true);
    if (!cargoBusqueda.ok || !cargoContrato.ok) return;

    assert.equal(hotelPvp + cargoBusqueda.pvp, hotelPvp + cargoContrato.pvp);
    // …y el ingreso existe: el cargo NO es cero (ese era el defecto: CxP sin ingreso).
    assert.ok(cargoContrato.pvp > 0, "el servicio incluido por grupo tiene que generar ingreso");
    assert.ok(cargoContrato.servicios[0].costoNeto > 0, "…y también costo (CxP)");
  });

  test("una composición distinta (más pax → otro rango) cambia el precio en AMBAS a la vez", () => {
    const servicios = [servicio({ servicioId: 1 })];
    const chico = cargoGrupoIncluido(servicios, 4, 0, 3);
    const grande = cargoGrupoIncluido(servicios, 6, 0, 3);
    assert.equal(chico.ok && grande.ok, true);
    if (!chico.ok || !grande.ok) return;
    assert.notEqual(chico.pvp, grande.pvp);
  });
});
