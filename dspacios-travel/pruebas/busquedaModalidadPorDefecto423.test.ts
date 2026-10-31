// La modalidad por defecto de la BÚSQUEDA de receptivos es «ida y regreso»: una URL o un estado antiguos sin modalidad se interpretan así en el servidor. Solo la búsqueda:
// cotizar y convertir siguen exigiendo un alcance explícito, y jamás se cotiza con la tarifa de un trayecto distinto cuando falta la de ida y regreso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALCANCE_BUSQUEDA_POR_DEFECTO, ALCANCES_VENTA } from "../lib/calc/servicioAlcance.ts";
import { construirContextoServicios, calcularResultadoServicio, type FilaTemporadaServicio } from "../lib/reservar/liquidacionServicio.ts";

const leer = (r: string) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8");

test("la modalidad por defecto es ida y regreso y es una modalidad válida", () => {
  assert.equal(ALCANCE_BUSQUEDA_POR_DEFECTO, "ida_regreso");
  assert.ok((ALCANCES_VENTA as readonly string[]).includes(ALCANCE_BUSQUEDA_POR_DEFECTO));
});

test("buscarReceptivos aplica el valor por defecto solo a la búsqueda; la venta (cotizar, convertir, costo, CxP) no lo usa", () => {
  const cotizar = leer("lib/reservar/cotizar.ts");
  assert.equal([...cotizar.matchAll(/ALCANCE_BUSQUEDA_POR_DEFECTO/g)].length, 2, "import + un único uso");
  assert.match(cotizar, /const alcanceBusqueda = vAlcance\.alcance \?\? ALCANCE_BUSQUEDA_POR_DEFECTO;/);
  assert.match(cotizar, /calcularResultadoServicio\(par, ctx, fechaIdaDate, numNoches, pax, input\.horas, alcanceBusqueda\)/);
  // sin la 262 aplicada, una búsqueda SIN modalidad no falla: el chequeo de «alcance no habilitado» mira solo la modalidad explícita
  assert.match(cotizar, /!lecAlc\.disponible && vAlcance\.alcance\)/);
  for (const f of ["lib/reservar/liquidacionServicio.ts", "lib/reservar/costosObligacionesCarrito.ts", "lib/reservar/verificarAlcanceConversion.ts", "lib/calc/servicioTarifa.ts"]) {
    assert.doesNotMatch(leer(f), /ALCANCE_BUSQUEDA_POR_DEFECTO/, `${f} sigue exigiendo un alcance explícito`);
  }
});

const par = { servicioId: 10, paqueteId: 1, nombre: "Traslado aeropuerto", destino: "CARTAGENA", descripcion: null };
const fecha = new Date("2030-05-10T00:00:00");
const vigencia = (precio_persona: number | null): FilaTemporadaServicio => ({ id: 5, servicio_id: 10, nombre: "ALTA", fecha_inicio: "2030-01-01", fecha_fin: "2030-12-31", precio_persona, recargo_individual: 0 });
const ctx = (precioPersona: number | null) => construirContextoServicios({
  paquetes: [{ id: 1, pct_mk: 0.2 }], armado: [{ paquete_id: 1, servicio_id: 10, modo: "persona" }],
  servicios: [{ id: 10, precio_persona: 0, recargo_individual: 0, liquidacion: "paquete", moneda: "COP", categoria: "tour_traslado" }],
  grupos: [], temporadas: [vigencia(precioPersona)], clasificaciones: [{ servicio_id: 10, tipo_receptivo: "traslado" }],
  preciosAlcance: [{ servicio_temporada_id: 5, alcance: "trayecto", pax_desde: null, pax_hasta: null, precio: 100000 }],
});

test("con la modalidad por defecto, un traslado con SOLO precio de un trayecto y sin tarifa vigente no se vende y no usa el del trayecto", () => {
  const r = calcularResultadoServicio(par, ctx(null), fecha, 3, 2, undefined, ALCANCE_BUSQUEDA_POR_DEFECTO)!;
  assert.equal(r.total, 0); assert.ok(r.sinTarifaAlcance); assert.equal(r.alcance, "ida_regreso");
  assert.doesNotMatch(JSON.stringify(r), /100000|125000/);
});

test("con la modalidad por defecto y tarifa vigente, el traslado se cotiza como ida y regreso con esa tarifa (no con el trayecto)", () => {
  const r = calcularResultadoServicio(par, ctx(85000), fecha, 3, 2, undefined, ALCANCE_BUSQUEDA_POR_DEFECTO)!;
  assert.equal(r.alcance, "ida_regreso"); assert.equal(r.sinTarifaAlcance, undefined);
  assert.equal(r.total, Math.ceil((2 * 85000) / 0.8 / 1000) * 1000);
});
