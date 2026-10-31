// Referencia de PUBLICACIÓN de un traslado por alcance (262): sale de los precios propios de «un trayecto», no de precio_persona ni de servicio_tarifa_pax.
// Defecto hallado en la prueba real: en modo grupo un traslado con rangos solo en servicio_precio_alcance no se publicaba.
import { test } from "node:test";
import assert from "node:assert/strict";
import { referenciaPublicacion, incluidoEnEstadia, type VigenciasServicio } from "../lib/calc/servicioVigencias.ts";

const ALTA = { id: 5, servicio_id: 10, nombre: "ALTA", fecha_inicio: "2030-01-01", fecha_fin: "2030-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: null, precio_infante: null, recargo_individual: 0 };
const base = (extra: Partial<VigenciasServicio>): VigenciasServicio => ({ servicioId: 10, nombre: "Traslado aeropuerto", temporadas: [ALTA as never], grupos: [], conFranjas: new Set(), ...extra });
const ventana = { desde: "2030-05-01", hasta: "2030-05-10" };

test("modo grupo: publica con los rangos de un trayecto aunque servicio_tarifa_pax esté vacío", () => {
  const r = referenciaPublicacion(base({ usaAlcance: true, gruposAlcance: [
    { pax_desde: 1, pax_hasta: 4, precio: 200000, temporada: "ALTA" }, { pax_desde: 5, pax_hasta: 8, precio: 300000, temporada: "ALTA" },
  ] }), "grupo", ventana, "2029-01-01");
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.rangos, [{ pax_desde: 1, pax_hasta: 4, precio: 200000 }, { pax_desde: 5, pax_hasta: 8, precio: 300000 }]);
});

test("modo grupo: sin rangos de un trayecto NO se publica (ida y regreso no sustituye) y el mensaje lo dice", () => {
  const r = referenciaPublicacion(base({ usaAlcance: true, gruposAlcance: [] }), "grupo", ventana, "2029-01-01");
  assert.equal(r.ok, false); assert.match(!r.ok ? r.error : "", /rangos de pasajeros de un trayecto/);
});

test("modo grupo: los rangos legados de servicio_tarifa_pax NO se usan en un traslado por alcance", () => {
  const r = referenciaPublicacion(base({ usaAlcance: true, gruposAlcance: [], grupos: [{ pax_desde: 1, pax_hasta: 4, precio: 1, temporada: "ALTA" }] }), "grupo", ventana, "2029-01-01");
  assert.equal(r.ok, false);
});

test("modo persona: la referencia es el precio por persona de un trayecto (aunque precio_persona sea nulo); sin él no se publica", () => {
  const ok = referenciaPublicacion(base({ usaAlcance: true, personaAlcance: new Map([["ALTA", 100000]]) }), "persona", ventana, "2029-01-01");
  assert.equal(ok.ok && ok.netoPersona, 100000);
  const no = referenciaPublicacion(base({ usaAlcance: true, personaAlcance: new Map() }), "persona", ventana, "2029-01-01");
  assert.equal(no.ok, false); assert.match(!no.ok ? no.error : "", /un trayecto/);
});

test("servicio sin la modalidad nueva: comportamiento anterior (precio_persona / servicio_tarifa_pax)", () => {
  const persona = referenciaPublicacion(base({ temporadas: [{ ...ALTA, precio_persona: 50000 } as never] }), "persona", ventana, "2029-01-01");
  assert.equal(persona.ok && persona.netoPersona, 50000);
  const sinPrecio = referenciaPublicacion(base({}), "persona", ventana, "2029-01-01");
  assert.equal(sinPrecio.ok, false);
  const grupo = referenciaPublicacion(base({ grupos: [{ pax_desde: 1, pax_hasta: 4, precio: 90000, temporada: "ALTA" }] }), "grupo", ventana, "2029-01-01");
  assert.equal(grupo.ok && grupo.rangos[0].precio, 90000);
});

test("un traslado por alcance no puede ir incluido en el hotel (no hay un precio único)", () => {
  const r = incluidoEnEstadia(base({ usaAlcance: true, personaAlcance: new Map([["ALTA", 1]]) }), "persona", "2030-05-01", "2030-05-04");
  assert.equal(r.ok, false); assert.match(!r.ok ? r.error : "", /no puede ir incluido/);
});
