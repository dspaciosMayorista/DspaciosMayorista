// Se ejecuta con npm run test:react (loader del arnés).
//
// #82 · Verificación en local: el enlace público /cot/[token] de una cotización MANUAL (la de un paquete dinámico) mostraba «$ NaN» y
// «Total del contrato $0», porque la ruta pública renderizaba `ContratoDocumento` con ítems `{cantidad, tarifa_unit, valor}` que ese documento no entiende.
// Aquí se renderizan los componentes REALES a HTML con el snapshot que guarda `crear_cotizacion_din` y se fija la corrección.
import { test, describe } from "node:test";
import { AGENCIA_PRUEBA } from "./support/agenciaPrueba.ts";
import assert from "node:assert/strict";
import { createElement } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { CotizacionManualDocumento } = await import("../components/contrato/CotizacionManualDocumento.tsx");
const { esSnapshotManual, itemsDeManual } = await import("../lib/paqueteDinamico/documentoPublico.ts");
const { construirCotizacionDin } = await import("../lib/paqueteDinamico/cotizacion.ts");

// Snapshot REAL: lo que `construirCotizacionDin` deja en cotizaciones.detalle (netas + markup 20 %, 2 adultos en doble, hotel + vuelo + tour).
const calc = {
  esquema: "neta_markup" as const, pvpModo: null, moneda: "COP", pctMk: 0.2, usaVuelo: true, usaHotel: true, usaServicios: true,
  vuelo: { proveedor: "PROVEEDOR_SECRETO_VUELO", neto: { adulto: 800000, nino: 600000, infante: 100000 }, pvp: { adulto: null, nino: null, infante: null } },
  hotel: { nombre: "Hotel Demo", proveedor: "PROVEEDOR_SECRETO_HOTEL", neto: { sencilla: 900000, doble: 700000, triple: 600000, multiple: 500000, nino: 300000, nino2: 200000, infante: 0 }, pvp: {} },
  servicios: [{ id: "1", nombre: "Tour Islas", proveedor: "PROVEEDOR_SECRETO_TOUR", neto: 100000, pvp: null }],
};
const r = construirCotizacionDin({
  paqueteId: 1, paqueteNombre: "Paq", destino: "CARTAGENA", hotelId: 1, vueloId: 1, calc, composicion: { habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0 },
  cliente: { nombres: "Ana", apellidos: "Prueba", tipoDoc: "CC", numeroDoc: "", telefono: "", email: "ana@x.co" }, fechaIda: "2027-01-10", fechaRegreso: "2027-01-13",
  vigenciaHasta: "2026-12-01", tipoAsesor: "interno", asesorInterno: "Tarifario web", agenciaNombre: "", freelanceNombre: "", fechaEmision: "2026-11-03",
});
assert.ok(r.ok);
const detalle = (r as unknown as { ok: true; cabecera: { detalle: { venta: Record<string, unknown>; items: Record<string, unknown>[]; incluye?: string; noIncluye?: string } } }).cabecera.detalle;
const TOTAL = 4_000_000;

describe("snapshot de la cotización de un paquete dinámico", () => {
  test("tiene la forma de la manual y el total esperado", () => {
    assert.ok(esSnapshotManual(detalle.items));
    assert.equal(detalle.items.reduce((s, i) => s + Number(i.valor), 0), TOTAL);
    assert.equal(detalle.venta.fecha_emision, "2026-11-03");
  });
  test("un ítem del tarifario NO se confunde con uno manual (ni una lista vacía)", () => {
    assert.equal(esSnapshotManual([{ descripcion: "x", adultos: 2, tarifa_adulto: 100, valor_total: 200 }]), false);
    assert.equal(esSnapshotManual([]), false);
    assert.equal(esSnapshotManual(undefined), false);
    assert.equal(esSnapshotManual([{ tarifa_unit: 1, valor: 1 }, { adultos: 1, tarifa_adulto: 1 }]), false);
  });
  test("itemsDeManual nunca produce NaN", () => {
    const it = itemsDeManual([{ descripcion: "a", cantidad: "x", tarifa_unit: null, valor: "abc" }, { descripcion: "b", valor: "1500" }]);
    assert.deepEqual(it.map((i) => i.valor), [0, 1500]);
    assert.ok(it.every((i) => Number.isFinite(i.valor)));
  });
});

describe("render del enlace /cot/[token] con ítems manuales", () => {
  test("PREMISA: el documento del tarifario con estos ítems sí mostraba «$ NaN» (por eso existe la rama manual)", () => {
    const html = renderToStaticMarkup(createElement(ContratoDocumento, { agencia: AGENCIA_PRUEBA,
      venta: detalle.venta as never, pasajeros: [], hoteles: [], vuelos: [], items: detalle.items as never, totalPagado: 0, esCotizacion: true, codigo: "C-0001",
    } as never));
    assert.match(html, /NaN/);
  });

  const html = renderToStaticMarkup(createElement(CotizacionManualDocumento, {
    codigo: "C-0001", venta: detalle.venta as never, items: itemsDeManual(detalle.items), cliente: {}, incluye: detalle.incluye ?? null, noIncluye: detalle.noIncluye ?? null,
    vigenciaHasta: "2026-11-06", fechaEmision: String(detalle.venta.fecha_emision), agencia: AGENCIA_PRUEBA,
  } as never));

  test("la rama manual muestra el total y el concepto, sin NaN y con «Total cotización» (no «Total del contrato $0»)", () => {
    assert.doesNotMatch(html, /NaN/);
    assert.match(html, /Total cotizaci[oó]n/i);
    assert.match(html, /\$\s?4\.000\.000/);
    assert.match(html, /PAQUETE TURÍSTICO A CARTAGENA/);
    assert.match(html, /2 adultos/);
    assert.match(html, /Cotización #: C-0001|C-0001/);
  });
  test("muestra la emisión del snapshot y el cliente", () => {
    assert.match(html, /3 de noviembre de 2026/);
    assert.match(html, /Ana Prueba/);
  });
  test("lo que ve el visitante no trae netas ni proveedores", () => {
    for (const secreto of ["PROVEEDOR_SECRETO", "700.000", "800.000", "1.000.000"]) assert.ok(!html.includes(secreto), secreto);
  });
});
