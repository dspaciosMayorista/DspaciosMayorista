// Referencia de PUBLICACIÓN de un traslado por alcance (262): lo que se puede OFRECER. Un trayecto NO es requisito: «ida y regreso» se ofrece con su precio propio o, si no lo
// hay, con la tarifa que ya tiene la vigencia (precio_persona / servicio_tarifa_pax). Defecto hallado en la prueba real: en modo grupo un traslado con rangos solo en
// servicio_precio_alcance no se publicaba.
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

test("modo grupo: sin rangos de un trayecto, de ida y regreso ni de la tarifa de la vigencia NO se publica y el mensaje lo dice", () => {
  const r = referenciaPublicacion(base({ usaAlcance: true, gruposAlcance: [] }), "grupo", ventana, "2029-01-01");
  assert.equal(r.ok, false); assert.match(!r.ok ? r.error : "", /rangos de pasajeros \(de un trayecto, de ida y regreso ni de la tarifa de la vigencia\)/);
  const enCero = referenciaPublicacion(base({ usaAlcance: true, gruposAlcance: [], grupos: [{ pax_desde: 1, pax_hasta: 4, precio: 0, temporada: "ALTA" }] }), "grupo", ventana, "2029-01-01");
  assert.equal(enCero.ok, true, "un rango en 0 ES una tarifa válida"); assert.deepEqual(enCero.ok && enCero.rangos, [{ pax_desde: 1, pax_hasta: 4, precio: 0 }]);
  const invalido = referenciaPublicacion(base({ usaAlcance: true, gruposAlcance: [], grupos: [{ pax_desde: 1, pax_hasta: 4, precio: Number.NaN, temporada: "ALTA" }] }), "grupo", ventana, "2029-01-01");
  assert.equal(invalido.ok, false, "un rango inválido no es tarifa");
});

const RANGOS_CAPTURA = [
  { pax_desde: 1, pax_hasta: 4, precio: 120000, temporada: "ALTA" }, { pax_desde: 5, pax_hasta: 12, precio: 200000, temporada: "ALTA" },
  { pax_desde: 13, pax_hasta: 19, precio: 280000, temporada: "ALTA" }, { pax_desde: 20, pax_hasta: 40, precio: 400000, temporada: "ALTA" },
];
test("modo grupo SIN precios de un trayecto: se publica con los rangos de la tarifa vigente (1–4, 5–12, 13–19, 20–40); el precio propio de ida y regreso manda donde coincide", () => {
  const soloTarifa = referenciaPublicacion(base({ usaAlcance: true, gruposAlcance: [], grupos: RANGOS_CAPTURA }), "grupo", ventana, "2029-01-01");
  assert.equal(soloTarifa.ok, true);
  assert.deepEqual(soloTarifa.ok && soloTarifa.rangos.map((r) => `${r.pax_desde}-${r.pax_hasta}:${r.precio}`), ["1-4:120000", "5-12:200000", "13-19:280000", "20-40:400000"]);
  const conPropio = referenciaPublicacion(base({ usaAlcance: true, grupos: RANGOS_CAPTURA, gruposIdaRegreso: [{ pax_desde: 5, pax_hasta: 12, precio: 190000, temporada: "ALTA" }] }), "grupo", ventana, "2029-01-01");
  assert.deepEqual(conPropio.ok && conPropio.rangos.map((r) => r.precio), [120000, 190000, 280000, 400000]);
  const conTrayecto = referenciaPublicacion(base({ usaAlcance: true, grupos: RANGOS_CAPTURA, gruposAlcance: [{ pax_desde: 1, pax_hasta: 8, precio: 70000, temporada: "ALTA" }] }), "grupo", ventana, "2029-01-01");
  assert.deepEqual(conTrayecto.ok && conTrayecto.rangos, [{ pax_desde: 1, pax_hasta: 8, precio: 70000 }], "con precios de un trayecto la referencia es la de siempre (sin cambio)");
});

test("modo persona: la referencia es el menor precio que se ofrece (un trayecto propio, ida y regreso propio o la tarifa de la vigencia); sin ninguno no se publica", () => {
  const ok = referenciaPublicacion(base({ usaAlcance: true, personaAlcance: new Map([["ALTA", 100000]]) }), "persona", ventana, "2029-01-01");
  assert.equal(ok.ok && ok.netoPersona, 100000, "solo un trayecto (aunque precio_persona sea nulo)");
  const soloTarifa = referenciaPublicacion(base({ usaAlcance: true, temporadas: [{ ...ALTA, precio_persona: 80000 } as never] }), "persona", ventana, "2029-01-01");
  assert.equal(soloTarifa.ok && soloTarifa.netoPersona, 80000, "sin precios nuevos de un trayecto: ida y regreso se ofrece con la tarifa vigente");
  const min = referenciaPublicacion(base({ usaAlcance: true, personaAlcance: new Map([["ALTA", 100000]]), temporadas: [{ ...ALTA, precio_persona: 80000 } as never] }), "persona", ventana, "2029-01-01");
  assert.equal(min.ok && min.netoPersona, 80000, "el menor de lo que se ofrece");
  const propio = referenciaPublicacion(base({ usaAlcance: true, personaIdaRegreso: new Map([["ALTA", 120000]]), temporadas: [{ ...ALTA, precio_persona: 80000 } as never] }), "persona", ventana, "2029-01-01");
  assert.equal(propio.ok && propio.netoPersona, 120000, "con precio propio de ida y regreso, la tarifa vigente ya no es la referencia");
  for (const precio_persona of [null, Number.NaN, -3]) {
    const no = referenciaPublicacion(base({ usaAlcance: true, personaAlcance: new Map(), temporadas: [{ ...ALTA, precio_persona } as never] }), "persona", ventana, "2029-01-01");
    assert.equal(no.ok, false, `${precio_persona}`); assert.match(!no.ok ? no.error : "", /ni tarifa de la vigencia/);
  }
  const cero = referenciaPublicacion(base({ usaAlcance: true, personaAlcance: new Map(), temporadas: [{ ...ALTA, precio_persona: 0 } as never] }), "persona", ventana, "2029-01-01");
  assert.equal(cero.ok && cero.netoPersona, 0, "una tarifa de 0 es una tarifa: el servicio se ofrece");
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
