import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { crearClienteFalso, type TablasFalsas } from "./support/fakeSupabase.ts";
import { leerTemporadasServicio, cargarVigenciasServicios } from "../lib/reservar/temporadasServicio.ts";
import { costoNetoServicio } from "../lib/calc/servicioTarifa.ts";
import { incluidoEnEstadia, referenciaPublicacion } from "../lib/calc/servicioVigencias.ts";
import { vigenciaBasePermanente } from "../lib/calc/tarifaBasePermanente.ts";
import { servicioSeleccionable } from "../lib/paquetes/armadoPestanas.ts";

// Regla: asistencia médica SIN ninguna vigencia → su tarifa base vale en cualquier fecha; con vigencias → solo ellas; otras categorías → siempre vigencia.
// Venta (liquidarServicioPuntual), costo/CxP (costosObligacionesCarrito) y publicación leen por `leerTemporadasServicio`/`cargarVigenciasServicios` y resuelven con
// `costoNetoServicio`/`incluidoEnEstadia`/`referenciaPublicacion`: aquí se comprueba que TODAS ven la misma tarifa.
const ASIST = 1, ASIST_SIN_BASE = 2, TRASLADO = 133, ASIST_CON_VIG = 3, ASIST_VIG_INVERTIDA = 4;
const cat = (id: number, categoria: string, precio: number | null) => ({ id, categoria, precio_persona: precio, precio_infante: null, recargo_individual: null });
const vig = (servicio_id: number, ini: string | null, fin: string | null, precio: number | null) => ({
  id: servicio_id * 100, servicio_id, nombre: "V", fecha_inicio: ini, fecha_fin: fin, compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: precio, precio_infante: null, recargo_individual: null,
});
const tablas: TablasFalsas = {
  servicios_adicionales: [cat(ASIST, "asistencia", 20000), cat(ASIST_SIN_BASE, "asistencia", null), cat(TRASLADO, "tour_traslado", 30000), cat(ASIST_CON_VIG, "asistencia", 20000), cat(ASIST_VIG_INVERTIDA, "asistencia", 20000)],
  servicio_temporadas: [vig(ASIST_CON_VIG, "2026-01-01", "2026-12-31", 55000), vig(ASIST_VIG_INVERTIDA, "2027-12-01", "2027-11-30", 99000)],
  servicio_tarifa_pax: [],
};
const admin = crearClienteFalso(tablas) as unknown as Parameters<typeof leerTemporadasServicio>[0];
const FECHA_LEJANA = new Date("2031-03-10T00:00:00");

describe("tarifa base permanente de la asistencia: lectura única", () => {
  test("solo la asistencia SIN filas de vigencia recibe la vigencia sintética «GENERAL»", async () => {
    const r = await leerTemporadasServicio(admin, [ASIST, ASIST_SIN_BASE, TRASLADO, ASIST_CON_VIG, ASIST_VIG_INVERTIDA]);
    assert.equal(r.error, null);
    const de = (id: number) => r.data.filter((t) => t.servicio_id === id);
    assert.equal(de(ASIST).length, 1);
    assert.equal(de(ASIST)[0].nombre, "GENERAL");
    assert.equal(de(ASIST)[0].precio_persona, 20000);
    assert.equal(de(ASIST_SIN_BASE).length, 1, "se crea igual, con el precio vacío: cada ruta rechaza con mensaje");
    assert.equal(de(ASIST_SIN_BASE)[0].precio_persona, null);
    assert.equal(de(TRASLADO).length, 0, "traslado: sigue exigiendo vigencia");
    assert.deepEqual(de(ASIST_CON_VIG).map((t) => t.nombre), ["V"], "con vigencias no se agrega la base");
    assert.deepEqual(de(ASIST_VIG_INVERTIDA).map((t) => t.nombre), ["V"], "una vigencia inválida sigue siendo una vigencia: la base no la reemplaza");
  });
  test("vigenciaBasePermanente: solo categoría asistencia", () => {
    assert.equal(vigenciaBasePermanente({ id: 1, categoria: "tour_traslado", precio_persona: 5, precio_infante: null, recargo_individual: null }), null);
    assert.equal(vigenciaBasePermanente({ id: 1, categoria: "otro", precio_persona: 5, precio_infante: null, recargo_individual: null }), null);
    assert.equal(vigenciaBasePermanente({ id: 1, categoria: "asistencia", precio_persona: -3, precio_infante: null, recargo_individual: null })?.precio_persona, null);
  });
});

describe("misma tarifa en venta, costo y publicación", () => {
  async function neto(id: number, fecha = FECHA_LEJANA) {
    const r = await leerTemporadasServicio(admin, [id]);
    return costoNetoServicio({ temporadas: r.data, grupos: [], franjasPorTemporada: new Map(), modo: "persona", pax: 2, fecha, liquidacion: null, numNoches: 1 });
  }
  test("asistencia sin vigencias: neto = base × pax en una fecha lejana (venta y costo salen de la misma función)", async () => {
    const r = await neto(ASIST);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.costoNeto, 40000);
  });
  test("asistencia con base ausente: rechaza con «sin precio por persona» (nunca inventa)", async () => {
    const r = await neto(ASIST_SIN_BASE);
    assert.deepEqual(r.ok ? null : r.motivo, "sin_precio_persona");
  });
  test("traslado sin vigencias: rechaza «sin vigencia»", async () => {
    const r = await neto(TRASLADO);
    assert.deepEqual(r.ok ? null : r.motivo, "sin_vigencia");
  });
  test("asistencia con vigencia: dentro usa la vigencia (55.000), fuera NO usa la base", async () => {
    const dentro = await neto(ASIST_CON_VIG, new Date("2026-06-10T00:00:00"));
    assert.equal(dentro.ok && dentro.costoNeto, 110000);
    const fuera = await neto(ASIST_CON_VIG);
    assert.deepEqual(fuera.ok ? null : fuera.motivo, "sin_vigencia");
  });
  test("vigencia invertida: no cubre nada y la base tampoco aplica", async () => {
    const r = await neto(ASIST_VIG_INVERTIDA, new Date("2027-12-15T00:00:00"));
    assert.deepEqual(r.ok ? null : r.motivo, "sin_vigencia");
  });
  test("publicación: incluidoEnEstadia y referenciaPublicacion aceptan la asistencia permanente en cualquier ventana, con el mismo precio", async () => {
    const rv = await cargarVigenciasServicios(admin, [{ id: ASIST, nombre: "Asistencia" }, { id: TRASLADO, nombre: "Traslado" }]);
    assert.equal(rv.ok, true);
    if (!rv.ok) return;
    const a = rv.porServicio.get(ASIST)!;
    const inc = incluidoEnEstadia(a, "persona", "2031-03-10", "2031-03-14");
    assert.equal(inc.ok && inc.netoPersona, 20000);
    const ref = referenciaPublicacion(a, "persona", { desde: "2031-03-10", hasta: "2031-04-30" }, "2026-10-29");
    assert.equal(ref.ok && ref.netoPersona, 20000);
    assert.equal(ref.ok && ref.cobertura?.parcial, false);
    assert.equal(incluidoEnEstadia(rv.porServicio.get(TRASLADO)!, "persona", "2031-03-10", "2031-03-14").ok, false);
  });
});

describe("armado: asistencia permanente se puede seleccionar", () => {
  test("seleccionable sin vigencias con base; no sin base; no traslados; no si tiene vigencias vencidas", () => {
    assert.equal(servicioSeleccionable({ categoria: "asistencia", precio_persona: 20000, servicio_temporadas: [], servicio_tarifa_pax: [] }), true);
    assert.equal(servicioSeleccionable({ categoria: "asistencia", precio_persona: null, servicio_temporadas: [], servicio_tarifa_pax: [] }), false);
    assert.equal(servicioSeleccionable({ categoria: "tour_traslado", precio_persona: 20000, servicio_temporadas: [], servicio_tarifa_pax: [] }), false);
    assert.equal(servicioSeleccionable({ categoria: "asistencia", precio_persona: 20000, servicio_temporadas: [{ nombre: "V", fecha_inicio: "2020-01-01", fecha_fin: "2020-12-31", precio_persona: 1 }], servicio_tarifa_pax: [] }, "2026-10-29"), false);
  });
});
