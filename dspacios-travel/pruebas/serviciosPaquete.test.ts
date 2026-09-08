import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarCategoriaServicio,
  deduplicarServicios,
  resumirServiciosContrato,
  tipoProveedorCxpServicio,
  costoNetoServicioIncluido,
  type ServicioEfectivo,
} from "../lib/reservar/serviciosPaquete.ts";

// ───────────────────────────────────────────────────────────────────────────
// Fuente única para clasificar/resumir/deduplicar servicios EFECTIVOS de una
// reserva (incluidos por armado_servicios.incluido=true + opcionales
// realmente seleccionados) — corrige el defecto donde `asistencia_medica`/
// `tours_traslados` se armaban de forma distinta (o hardcodeada) en cada
// camino de creación de cotización/contrato. Estas pruebas cubren los 10
// escenarios mínimos pedidos, a nivel del módulo puro compartido.
// ───────────────────────────────────────────────────────────────────────────

function ef(overrides: Partial<ServicioEfectivo> & { servicioId: number }): ServicioEfectivo {
  return {
    nombre: "Servicio", categoria: "otro", incluido: false, costoNeto: 0, proveedorId: null,
    ...overrides,
  };
}

describe("normalizarCategoriaServicio — nunca inventa asistencia/tour para un dato ausente/desconocido", () => {
  test("valores exactos reconocidos", () => {
    assert.equal(normalizarCategoriaServicio("asistencia"), "asistencia");
    assert.equal(normalizarCategoriaServicio("tour_traslado"), "tour_traslado");
  });
  test("null/undefined/texto desconocido caen a 'otro'", () => {
    assert.equal(normalizarCategoriaServicio(null), "otro");
    assert.equal(normalizarCategoriaServicio(undefined), "otro");
    assert.equal(normalizarCategoriaServicio("otro"), "otro");
    assert.equal(normalizarCategoriaServicio("ASISTENCIA"), "otro"); // case-sensitive a propósito, dato corrupto
    assert.equal(normalizarCategoriaServicio(""), "otro");
    assert.equal(normalizarCategoriaServicio("cualquier-cosa"), "otro");
  });
});

describe("deduplicarServicios — nunca por nombre, incluido SIEMPRE gana sobre opcional duplicado", () => {
  test("mismo servicioId incluido + opcional → queda solo la entrada incluida", () => {
    const items = [
      ef({ servicioId: 5, nombre: "Asistencia Básica", categoria: "asistencia", incluido: true, costoNeto: 12000 }),
      ef({ servicioId: 5, nombre: "Asistencia Básica", categoria: "asistencia", incluido: false, costoNeto: 30000 }),
    ];
    const out = deduplicarServicios(items);
    assert.equal(out.length, 1);
    assert.equal(out[0].incluido, true);
    assert.equal(out[0].costoNeto, 12000);
  });
  test("orden inverso (opcional primero, incluido después) da el mismo resultado — incluido gana sin importar el orden", () => {
    const items = [
      ef({ servicioId: 5, incluido: false, costoNeto: 30000 }),
      ef({ servicioId: 5, incluido: true, costoNeto: 12000 }),
    ];
    const out = deduplicarServicios(items);
    assert.equal(out.length, 1);
    assert.equal(out[0].incluido, true);
  });
  test("dos servicios con el MISMO nombre pero distinto servicioId NUNCA se funden en uno (nunca dedup por nombre)", () => {
    const items = [
      ef({ servicioId: 1, nombre: "City Tour" }),
      ef({ servicioId: 2, nombre: "City Tour" }),
    ];
    const out = deduplicarServicios(items);
    assert.equal(out.length, 2);
  });
  test("servicioId distinto, ninguno incluido → se conserva el último visto (no importa cuál, no hay ambigüedad de identidad)", () => {
    const items = [ef({ servicioId: 9, incluido: false })];
    const out = deduplicarServicios(items);
    assert.equal(out.length, 1);
  });
});

describe("resumirServiciosContrato — escenarios mínimos 1-3 y 6-7 (asistencia/tours/otro)", () => {
  test("Escenario 1: asistencia INCLUIDA → asistenciaMedica=true", () => {
    const r = resumirServiciosContrato([ef({ servicioId: 1, categoria: "asistencia", incluido: true, costoNeto: 15000 })]);
    assert.equal(r.asistenciaMedica, true);
  });
  test("Escenario 2: asistencia OPCIONAL seleccionada → asistenciaMedica=true", () => {
    const r = resumirServiciosContrato([ef({ servicioId: 1, categoria: "asistencia", incluido: false, costoNeto: 15000 })]);
    assert.equal(r.asistenciaMedica, true);
  });
  test("Escenario 3: sin ninguna asistencia (ni incluida ni opcional) → asistenciaMedica=false, nunca se infiere de otra categoría", () => {
    const r = resumirServiciosContrato([ef({ servicioId: 1, categoria: "tour_traslado" }), ef({ servicioId: 2, categoria: "otro" })]);
    assert.equal(r.asistenciaMedica, false);
  });
  test("Escenario 4: tour/traslado INCLUIDO aparece por nombre en toursTraslados", () => {
    const r = resumirServiciosContrato([ef({ servicioId: 1, nombre: "Traslado aeropuerto-hotel", categoria: "tour_traslado", incluido: true })]);
    assert.equal(r.toursTraslados, "Traslado aeropuerto-hotel");
  });
  test("Escenario 5: tour/traslado OPCIONAL seleccionado aparece por nombre en toursTraslados", () => {
    const r = resumirServiciosContrato([ef({ servicioId: 1, nombre: "City Tour", categoria: "tour_traslado", incluido: false })]);
    assert.equal(r.toursTraslados, "City Tour");
  });
  test("tour incluido + tour opcional distintos: ambos aparecen, unidos por coma", () => {
    const r = resumirServiciosContrato([
      ef({ servicioId: 1, nombre: "Traslado", categoria: "tour_traslado", incluido: true }),
      ef({ servicioId: 2, nombre: "City Tour", categoria: "tour_traslado", incluido: false }),
    ]);
    assert.equal(r.toursTraslados, "Traslado, City Tour");
  });
  test("Escenario 6: un servicio 'otro' NUNCA se clasifica como asistencia ni aparece en toursTraslados", () => {
    const r = resumirServiciosContrato([ef({ servicioId: 1, nombre: "Servicio misceláneo", categoria: "otro" })]);
    assert.equal(r.asistenciaMedica, false);
    assert.equal(r.toursTraslados, null);
    assert.deepEqual(r.otros, [{ servicioId: 1, nombre: "Servicio misceláneo" }]);
  });
  test("Escenario 7: el MISMO servicio llega dos veces (incluido + opcional con igual servicioId) → nunca duplicado en el resumen", () => {
    const r = resumirServiciosContrato([
      ef({ servicioId: 1, nombre: "City Tour", categoria: "tour_traslado", incluido: true }),
      ef({ servicioId: 1, nombre: "City Tour", categoria: "tour_traslado", incluido: false }),
    ]);
    assert.equal(r.toursTraslados, "City Tour"); // una sola vez, no "City Tour, City Tour"
  });
  test("sin servicios → todo vacío/null, nunca inventa nada", () => {
    const r = resumirServiciosContrato([]);
    assert.equal(r.asistenciaMedica, false);
    assert.equal(r.toursTraslados, null);
    assert.deepEqual(r.otros, []);
  });
});

describe("tipoProveedorCxpServicio — mapeo fijo para la CxP (mismo criterio que TIPO_PROVEEDOR)", () => {
  test("asistencia → asistencia; tour_traslado → receptivo; otro → otro (nunca 'otro' cae en 'receptivo')", () => {
    assert.equal(tipoProveedorCxpServicio("asistencia"), "asistencia");
    assert.equal(tipoProveedorCxpServicio("tour_traslado"), "receptivo");
    assert.equal(tipoProveedorCxpServicio("otro"), "otro");
  });
});

describe("costoNetoServicioIncluido — Escenario 8 (modo grupo, rango de pax real) + fallo cerrado", () => {
  test("modo persona con neto conocido: costo = neto × pax (liquidación por defecto no multiplica)", () => {
    const c = costoNetoServicioIncluido("persona", 20000, [], 3, null, 1);
    assert.equal(c, 60000);
  });
  test("modo persona sin neto configurado → null (fallo cerrado, nunca $0 disfrazado de dato real)", () => {
    const c = costoNetoServicioIncluido("persona", null, [], 3, null, 1);
    assert.equal(c, null);
  });
  test("Escenario 8: modo grupo con un rango que SÍ cubre el pax real de la reserva → usa ese rango", () => {
    const grupos = [{ pax_desde: 1, pax_hasta: 4, precio: 50000 }, { pax_desde: 5, pax_hasta: 10, precio: 90000 }];
    const c = costoNetoServicioIncluido("grupo", null, grupos, 3, null, 1);
    assert.equal(c, 50000);
    const c2 = costoNetoServicioIncluido("grupo", null, grupos, 7, null, 1);
    assert.equal(c2, 90000);
  });
  test("modo grupo SIN ningún rango que cubra el pax real → null (fallo cerrado, nunca el rango más cercano)", () => {
    const grupos = [{ pax_desde: 1, pax_hasta: 4, precio: 50000 }];
    const c = costoNetoServicioIncluido("grupo", null, grupos, 6, null, 1);
    assert.equal(c, null);
  });
  test("modo grupo sin ningún rango configurado → null", () => {
    const c = costoNetoServicioIncluido("grupo", null, [], 3, null, 1);
    assert.equal(c, null);
  });
  test("totalPax <= 0 → null sin importar el modo (nunca cobra una reserva vacía)", () => {
    assert.equal(costoNetoServicioIncluido("persona", 20000, [], 0, null, 1), null);
    assert.equal(costoNetoServicioIncluido("grupo", null, [{ pax_desde: 0, pax_hasta: 5, precio: 1000 }], -1, null, 1), null);
  });
});

describe("Escenario 9 (cotización y contrato deben coincidir) — resumirServiciosContrato es determinista ante la MISMA lista, sin importar el orden de llegada", () => {
  test("dos listas equivalentes (mismo contenido, distinto orden) producen el mismo resumen", () => {
    const a = [
      ef({ servicioId: 1, nombre: "Asistencia", categoria: "asistencia", incluido: true }),
      ef({ servicioId: 2, nombre: "City Tour", categoria: "tour_traslado", incluido: false }),
    ];
    const b = [a[1], a[0]];
    const ra = resumirServiciosContrato(a);
    const rb = resumirServiciosContrato(b);
    assert.equal(ra.asistenciaMedica, rb.asistenciaMedica);
    assert.equal(ra.toursTraslados, rb.toursTraslados);
  });
});
