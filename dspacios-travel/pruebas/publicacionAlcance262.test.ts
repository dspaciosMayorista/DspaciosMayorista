// Referencia de PUBLICACIÓN de un traslado por alcance (262): lo que se puede OFRECER. Un trayecto NO es requisito: «ida y regreso» se ofrece con su precio propio o, si no lo
// hay, con la tarifa que ya tiene la vigencia (precio_persona / servicio_tarifa_pax). Defecto hallado en la prueba real: en modo grupo un traslado con rangos solo en
// servicio_precio_alcance no se publicaba.
import { test } from "node:test";
import assert from "node:assert/strict";
import { referenciaPublicacion, incluidoEnEstadia, incluidoSeOmite, type VigenciasServicio } from "../lib/calc/servicioVigencias.ts";
import { costoNetoServicioIncluido, cargoGrupoIncluido, mensajeGrupoSinCobertura } from "../lib/reservar/serviciosPaquete.ts";

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
  assert.equal(enCero.ok, false, "un rango en 0 es AUSENCIA de tarifa (nunca gratis): no se publica"); assert.match(!enCero.ok ? enCero.error : "", /rangos de pasajeros/);
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
  for (const precio_persona of [null, 0]) {
    const no = referenciaPublicacion(base({ usaAlcance: true, personaAlcance: new Map(), temporadas: [{ ...ALTA, precio_persona } as never] }), "persona", ventana, "2029-01-01");
    assert.equal(no.ok, false, `${precio_persona}`); assert.match(!no.ok ? no.error : "", /ni tarifa de la vigencia/);
  }
  for (const precio_persona of [Number.NaN, -3]) {
    const no = referenciaPublicacion(base({ usaAlcance: true, personaAlcance: new Map(), temporadas: [{ ...ALTA, precio_persona } as never] }), "persona", ventana, "2029-01-01");
    assert.equal(no.ok, false, `${precio_persona}`); assert.match(!no.ok ? no.error : "", /no válido/);
  }
  const cero = referenciaPublicacion(base({ usaAlcance: true, personaAlcance: new Map(), temporadas: [{ ...ALTA, precio_persona: 0 } as never] }), "persona", ventana, "2029-01-01");
  assert.equal(cero.ok, false, "en un traslado, 0 es ausencia de tarifa: no se ofrece como gratis");
  // el 0 sigue siendo un precio válido en servicios que NO son traslado
  const otro0 = referenciaPublicacion(base({ temporadas: [{ ...ALTA, precio_persona: 0 } as never] }), "persona", ventana, "2029-01-01");
  assert.equal(otro0.ok && otro0.netoPersona, 0);
});

test("servicio sin la modalidad nueva: comportamiento anterior (precio_persona / servicio_tarifa_pax)", () => {
  const persona = referenciaPublicacion(base({ temporadas: [{ ...ALTA, precio_persona: 50000 } as never] }), "persona", ventana, "2029-01-01");
  assert.equal(persona.ok && persona.netoPersona, 50000);
  const sinPrecio = referenciaPublicacion(base({}), "persona", ventana, "2029-01-01");
  assert.equal(sinPrecio.ok, false);
  const grupo = referenciaPublicacion(base({ grupos: [{ pax_desde: 1, pax_hasta: 4, precio: 90000, temporada: "ALTA" }] }), "grupo", ventana, "2029-01-01");
  assert.equal(grupo.ok && grupo.rangos[0].precio, 90000);
});

// Un traslado incluido en el hotel se cobra por ida y regreso: precio propio si existe; si no, la tarifa vigente; sin ninguna, motivo concreto (se omite como cualquier incluido sin tarifa).
const estadia = ["2030-05-01", "2030-05-04"] as const;
test("traslado incluido, persona: usa la tarifa vigente de la vigencia cuando no hay precio propio de ida y regreso", () => {
  const r = incluidoEnEstadia(base({ usaAlcance: true, personaAlcance: new Map([["ALTA", 1]]), temporadas: [{ ...ALTA, precio_persona: 80000, precio_infante: 0 } as never] }), "persona", ...estadia);
  assert.equal(r.ok, true); assert.equal(r.ok && r.netoPersona, 80000, "el precio de un trayecto no se usa"); assert.equal(r.ok && r.netoInfante, 0, "regla de infante intacta");
});
test("traslado incluido, persona: el precio específico de ida y regreso gana sobre la tarifa vigente", () => {
  const r = incluidoEnEstadia(base({ usaAlcance: true, personaIdaRegreso: new Map([["ALTA", 120000]]), temporadas: [{ ...ALTA, precio_persona: 80000 } as never] }), "persona", ...estadia);
  assert.equal(r.ok && r.netoPersona, 120000);
  const sinTarifaPropio = incluidoEnEstadia(base({ usaAlcance: true, personaIdaRegreso: new Map([["ALTA", 120000]]) }), "persona", ...estadia);
  assert.equal(sinTarifaPropio.ok && sinTarifaPropio.netoPersona, 120000);
});
test("traslado incluido, grupo: rangos propios de ida y regreso mandan; los de la tarifa vigente completan los que no se cruzan", () => {
  const r = incluidoEnEstadia(base({ usaAlcance: true,
    gruposIdaRegreso: [{ pax_desde: 1, pax_hasta: 4, precio: 200000, temporada: "ALTA" }],
    grupos: [{ pax_desde: 1, pax_hasta: 4, precio: 90000, temporada: "ALTA" }, { pax_desde: 5, pax_hasta: 8, precio: 150000, temporada: "ALTA" }] }), "grupo", ...estadia);
  assert.deepEqual(r.ok && r.rangos, [{ pax_desde: 1, pax_hasta: 4, precio: 200000 }, { pax_desde: 5, pax_hasta: 8, precio: 150000 }]);
});
test("traslado incluido sin tarifa válida de ida y regreso: NO se omite, bloquea con motivo concreto (traslado_sin_tarifa)", () => {
  const p = incluidoEnEstadia(base({ usaAlcance: true, personaAlcance: new Map([["ALTA", 1]]) }), "persona", ...estadia);
  assert.equal(p.ok, false); assert.equal(!p.ok && p.motivo, "traslado_sin_tarifa"); assert.equal(incluidoSeOmite(p), false, "no se omite: el paquete no puede prometer un traslado que no se cobra");
  assert.match(!p.ok ? p.error : "", /«Traslado aeropuerto».*tarifa por persona en su vigencia «ALTA».*Crea una vigencia con tarifa o configura la tarifa base en Producto → Servicios/);
  const g = incluidoEnEstadia(base({ usaAlcance: true }), "grupo", ...estadia);
  assert.equal(!g.ok && g.motivo, "traslado_sin_tarifa"); assert.match(!g.ok ? g.error : "", /tarifa por grupo en su vigencia «ALTA».*Crea una vigencia con tarifa o configura la tarifa base/);
});
test("un servicio que NO es traslado sin tarifa vigente sigue omitiéndose (regla de disponibilidad por fecha)", () => {
  const r = incluidoEnEstadia(base({}), "persona", ...estadia);
  assert.equal(!r.ok && r.motivo, "sin_tarifa"); assert.equal(incluidoSeOmite(r), true);
  const sinVigencia = incluidoEnEstadia(base({ temporadas: [] }), "persona", ...estadia);
  assert.equal(!sinVigencia.ok && sinVigencia.motivo, "sin_tarifa"); assert.equal(incluidoSeOmite(sinVigencia), true, "un tour/otro servicio sin vigencia para la fecha se omite como siempre");
});
test("traslado incluido SIN vigencia para la fecha: NO se omite, bloquea con un motivo distinto al de «sin tarifa de ida y regreso»", () => {
  for (const modo of ["persona", "grupo"] as const) {
    const r = incluidoEnEstadia(base({ usaAlcance: true, temporadas: [], personaIdaRegreso: new Map([["ALTA", 1]]) }), modo, ...estadia);
    assert.equal(!r.ok && r.motivo, "traslado_sin_vigencia"); assert.equal(incluidoSeOmite(r), false);
    assert.match(!r.ok ? r.error : "", /«Traslado aeropuerto» no tiene tarifa vigente para el 01[/]05[/]2030.*y tampoco se pudo leer su tarifa base.*Crea una vigencia con tarifa o configura la tarifa base en Producto → Servicios/);
    assert.doesNotMatch(!r.ok ? r.error : "", /ida y regreso ni tarifa/, "no se confunde con la falta de tarifa");
  }
  const fuera = incluidoEnEstadia(base({ usaAlcance: true, temporadas: [{ ...ALTA, fecha_inicio: "2030-06-01", fecha_fin: "2030-06-30", precio_persona: 80000 } as never] }), "persona", ...estadia);
  assert.equal(!fuera.ok && fuera.motivo, "traslado_sin_vigencia", "con vigencia, pero de otras fechas");
});
test("el motivo «sin vigencia» y el de «sin tarifa de ida y regreso» son distintos y la tarifa vigente basta (sin precios por trayecto)", () => {
  const sinTarifa = incluidoEnEstadia(base({ usaAlcance: true }), "persona", ...estadia);
  assert.equal(!sinTarifa.ok && sinTarifa.motivo, "traslado_sin_tarifa");
  const ok = incluidoEnEstadia(base({ usaAlcance: true, temporadas: [{ ...ALTA, precio_persona: 80000 } as never] }), "persona", ...estadia);
  assert.equal(ok.ok && ok.netoPersona, 80000);
});
test("traslado incluido con suplemento por horario: sigue pidiendo la hora (motivo franjas)", () => {
  const r = incluidoEnEstadia(base({ usaAlcance: true, conFranjas: new Set(["ALTA"]), temporadas: [{ ...ALTA, precio_persona: 80000 } as never] }), "persona", ...estadia);
  assert.equal(!r.ok && r.motivo, "franjas"); assert.match(!r.ok ? r.error : "", /hora/);
});

// Salidas vencidas: el bloqueo del traslado incluido NO aplica a una salida anterior al día de negocio (Bogotá) ni frena las futuras; hoy y mañana SÍ bloquean.
test("salida pasada: un traslado sin vigencia o sin tarifa de ida y regreso se omite (como antes) y no bloquea; hoy y mañana bloquean", () => {
  const HOY = "2026-11-03";
  const sinVigencia = (f: string, hoy = HOY) => incluidoEnEstadia(base({ usaAlcance: true, temporadas: [{ ...ALTA, fecha_inicio: "2030-01-01", fecha_fin: "2030-12-31", precio_persona: 80000 } as never] }), "persona", f, f, hoy);
  const sinTarifa = (f: string, hoy = HOY) => incluidoEnEstadia(base({ usaAlcance: true, temporadas: [{ ...ALTA, fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", precio_persona: null } as never] }), "persona", f, f, hoy);
  for (const [nombre, fn] of [["sin vigencia", sinVigencia], ["sin tarifa", sinTarifa]] as const) {
    const ayer = fn("2026-11-02"); const sep = fn("2026-09-04"); const hoy = fn("2026-11-03"); const manana = fn("2026-11-04"); const lejos = fn("2026-12-20");
    assert.equal(incluidoSeOmite(ayer), true, `${nombre}: ayer se omite`); assert.equal(incluidoSeOmite(sep), true, `${nombre}: 04/09/2026 se omite`);
    for (const [etiqueta, r] of [["hoy", hoy], ["mañana", manana], ["futura", lejos]] as const) {
      assert.equal(r.ok, false, `${nombre}: ${etiqueta} bloquea`); assert.equal(incluidoSeOmite(r), false, `${nombre}: ${etiqueta} no se omite`);
      assert.match(!r.ok ? r.motivo : "", /^traslado_sin_(vigencia|tarifa)$/);
    }
  }
  // el motivo sigue distinguiendo ambos casos en fechas futuras
  assert.equal(!sinVigencia("2026-12-20").ok && (sinVigencia("2026-12-20") as { motivo: string }).motivo, "traslado_sin_vigencia");
  assert.equal(!sinTarifa("2026-12-20").ok && (sinTarifa("2026-12-20") as { motivo: string }).motivo, "traslado_sin_tarifa");
});
test("salida pasada con tarifa válida y salida futura válida: se cobran normal; el 'hoy' por defecto es la fecha de negocio de Bogotá", () => {
  const sv = base({ usaAlcance: true, temporadas: [{ ...ALTA, fecha_inicio: "2020-01-01", fecha_fin: "2040-12-31", precio_persona: 80000 } as never] });
  assert.equal(incluidoEnEstadia(sv, "persona", "2026-09-04", "2026-09-04", "2026-11-03").ok, true);
  assert.equal(incluidoEnEstadia(sv, "persona", "2026-12-20", "2026-12-20", "2026-11-03").ok, true);
  const sinTarifa = base({ usaAlcance: true, temporadas: [{ ...ALTA, fecha_inicio: "2020-01-01", fecha_fin: "2040-12-31", precio_persona: null } as never] });
  assert.equal(incluidoEnEstadia(sinTarifa, "persona", "2020-03-01", "2020-03-01").ok, false, "una fecha muy pasada con el 'hoy' real: no aplica bloqueo");
  assert.equal(incluidoSeOmite(incluidoEnEstadia(sinTarifa, "persona", "2020-03-01", "2020-03-01")), true);
  assert.equal(incluidoSeOmite(incluidoEnEstadia(sinTarifa, "persona", "2099-03-01", "2099-03-01")), false, "una fecha futura con el 'hoy' real bloquea");
});

// ── Respaldo: tarifa base para un traslado incluido SIN vigencia en la fecha ─────────────────────────────────────────────────────────────────────────────────────────────
const HOY = "2026-11-03";
const BASE_GRUPOS = [{ pax_desde: 1, pax_hasta: 4, precio: 200000, temporada: "GENERAL" }, { pax_desde: 5, pax_hasta: 10, precio: 150000, temporada: "GENERAL" }];
const conBase = (extra: Partial<VigenciasServicio> = {}) => base({ usaAlcance: true, temporadas: [], tarifaBase: { precioPersona: 60000, grupos: BASE_GRUPOS }, ...extra });
test("respaldo base, persona: sin vigencia para la fecha cobra precio_persona base (sin precios por trayecto) y el traslado sigue siendo cobrable", () => {
  const r = incluidoEnEstadia(conBase(), "persona", ...estadia, HOY);
  assert.equal(r.ok && r.netoPersona, 60000); assert.equal(r.ok && r.origen, "base"); assert.equal(r.ok && r.vigencia, "GENERAL");
  // con vigencia propia de OTRAS fechas (hueco) también cae a la base
  const hueco = incluidoEnEstadia(conBase({ temporadas: [{ ...ALTA, fecha_inicio: "2030-06-01", fecha_fin: "2030-06-30", precio_persona: 80000 } as never] }), "persona", ...estadia, HOY);
  assert.equal(hueco.ok && hueco.netoPersona, 60000);
});
test("respaldo base, grupo: usa los rangos GENERAL; un rango inválido o ausente bloquea con el diagnóstico de qué falta", () => {
  const r = incluidoEnEstadia(conBase(), "grupo", ...estadia, HOY);
  assert.deepEqual(r.ok && r.rangos, [{ pax_desde: 1, pax_hasta: 4, precio: 200000 }, { pax_desde: 5, pax_hasta: 10, precio: 150000 }]); assert.equal(r.ok && r.origen, "base");
  const sin = incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: 60000, grupos: [] } }), "grupo", ...estadia, HOY);
  assert.equal(!sin.ok && sin.motivo, "traslado_sin_vigencia"); assert.match(!sin.ok ? sin.error : "", /tampoco tiene rangos base [(]GENERAL[)]/);
  const malo = incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: null, grupos: [{ ...BASE_GRUPOS[0], precio: -1 }] } }), "grupo", ...estadia, HOY);
  assert.equal(!malo.ok && malo.motivo, "dato_invalido"); assert.match(!malo.ok ? malo.error : "", /precio no válido en un rango base/);
  // los rangos de OTRA vigencia (no GENERAL) no cuentan como base
  const ajenos = incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: null, grupos: [{ ...BASE_GRUPOS[0], temporada: "ALTA" }] } }), "grupo", ...estadia, HOY);
  assert.equal(ajenos.ok, false);
});
test("respaldo base ausente: conserva el bloqueo (no se omite) con diagnóstico que dice qué falta, en persona y en grupo", () => {
  for (const [modo, tb] of [["persona", { precioPersona: null, grupos: [] }], ["persona", { precioPersona: -5, grupos: [] }], ["grupo", { precioPersona: 60000, grupos: [] }]] as [("persona" | "grupo"), { precioPersona: number | null; grupos: never[] }][]) {
    const r = incluidoEnEstadia(conBase({ tarifaBase: tb }), modo, ...estadia, HOY);
    assert.equal(!r.ok && r.motivo, "traslado_sin_vigencia"); assert.equal(incluidoSeOmite(r), false);
    assert.match(!r.ok ? r.error : "", /no tiene tarifa vigente para el 01[/]05[/]2030.*tampoco tiene (un precio base por persona mayor que cero|rangos base)/);
  }
  const sinDato = incluidoEnEstadia(conBase({ tarifaBase: undefined }), "persona", ...estadia, HOY);
  assert.match(!sinDato.ok ? sinDato.error : "", /tampoco se pudo leer su tarifa base/);
});
test("una tarifa específica vigente gana sobre la base (precio propio de ida y regreso, o la tarifa de la vigencia)", () => {
  const propio = incluidoEnEstadia(conBase({ temporadas: [ALTA as never], personaIdaRegreso: new Map([["ALTA", 120000]]) }), "persona", ...estadia, HOY);
  assert.equal(propio.ok && propio.netoPersona, 120000); assert.equal(propio.ok && propio.origen, undefined);
  const vig = incluidoEnEstadia(conBase({ temporadas: [{ ...ALTA, precio_persona: 80000 } as never] }), "persona", ...estadia, HOY);
  assert.equal(vig.ok && vig.netoPersona, 80000);
  const g = incluidoEnEstadia(conBase({ temporadas: [ALTA as never], gruposIdaRegreso: [{ pax_desde: 1, pax_hasta: 2, precio: 99000, temporada: "ALTA" }] }), "grupo", ...estadia, HOY);
  assert.deepEqual(g.ok && g.rangos, [{ pax_desde: 1, pax_hasta: 2, precio: 99000 }, { pax_desde: 3, pax_hasta: 4, precio: 200000 }, { pax_desde: 5, pax_hasta: 10, precio: 150000 }], "propio 1–2 gana; la base solo completa 3–4 (recortada) y 5–10");
});
test("vigencia que cubre la fecha SIN tarifa para la modalidad → cae a la base (persona y grupo); sin ninguna tarifa, error orientativo", () => {
  const incompleta = incluidoEnEstadia(conBase({ temporadas: [ALTA as never] }), "persona", ...estadia, HOY);
  assert.equal(incompleta.ok && incompleta.netoPersona, 60000); assert.equal(incompleta.ok && incompleta.origen, "base");
  const incompletaG = incluidoEnEstadia(conBase({ temporadas: [ALTA as never] }), "grupo", ...estadia, HOY);
  assert.deepEqual(incompletaG.ok && incompletaG.rangos, [{ pax_desde: 1, pax_hasta: 4, precio: 200000 }, { pax_desde: 5, pax_hasta: 10, precio: 150000 }]);
  // la vigencia tiene tarifa de OTRA modalidad (grupo) pero no de persona: para persona se usa la base; para grupo, SU rango
  const soloGrupo = conBase({ temporadas: [ALTA as never], grupos: [{ pax_desde: 1, pax_hasta: 2, precio: 99000, temporada: "ALTA" }] });
  assert.equal(incluidoEnEstadia(soloGrupo, "persona", ...estadia, HOY).ok && (incluidoEnEstadia(soloGrupo, "persona", ...estadia, HOY) as { netoPersona: number }).netoPersona, 60000);
  const g = incluidoEnEstadia(soloGrupo, "grupo", ...estadia, HOY);
  assert.deepEqual(g.ok && g.rangos, [{ pax_desde: 1, pax_hasta: 2, precio: 99000 }, { pax_desde: 3, pax_hasta: 4, precio: 200000 }, { pax_desde: 5, pax_hasta: 10, precio: 150000 }]); assert.equal(g.ok && g.origen, undefined);
  // sin base válida: bloquea (no se omite) con el mensaje orientativo
  for (const modo of ["persona", "grupo"] as const) {
    const r = incluidoEnEstadia(conBase({ temporadas: [ALTA as never], tarifaBase: { precioPersona: null, grupos: [] } }), modo, ...estadia, HOY);
    assert.equal(!r.ok && r.motivo, "traslado_sin_tarifa"); assert.equal(incluidoSeOmite(r), false);
    assert.match(!r.ok ? r.error : "", /Crea una vigencia con tarifa o configura la tarifa base en Producto → Servicios/);
  }
  // dato corrupto en la vigencia: NO se oculta con la base
  for (const precio_persona of [Number.NaN, -5]) {
    const c = incluidoEnEstadia(conBase({ temporadas: [{ ...ALTA, precio_persona } as never] }), "persona", ...estadia, HOY);
    assert.equal(!c.ok && c.motivo, "dato_invalido");
  }
  const cg = incluidoEnEstadia(conBase({ temporadas: [ALTA as never], grupos: [{ pax_desde: 1, pax_hasta: 4, precio: Number.NaN, temporada: "ALTA" }] }), "grupo", ...estadia, HOY);
  assert.equal(!cg.ok && cg.motivo, "dato_invalido");
  // compra cerrada: la vigencia sigue cubriendo la fecha del viaje; se cobra SU precio, no el de la base
  const cerrada = incluidoEnEstadia(conBase({ temporadas: [{ ...ALTA, precio_persona: 80000, compra_inicio: "2020-01-01", compra_fin: "2020-12-31" } as never] }), "persona", ...estadia, HOY);
  assert.equal(cerrada.ok && cerrada.netoPersona, 80000); assert.equal(cerrada.ok && cerrada.origen, undefined);
  // estadía que arranca ANTES de la vigencia: manda la fecha de llegada (sin vigencia ese día → base), no la cobertura de toda la estadía
  const parcial = incluidoEnEstadia(conBase({ temporadas: [{ ...ALTA, fecha_inicio: "2030-05-03", fecha_fin: "2030-12-31", precio_persona: 80000 } as never] }), "persona", ...estadia, HOY);
  assert.equal(parcial.ok && parcial.netoPersona, 60000); assert.equal(parcial.ok && parcial.origen, "base");
});
test("salida pasada con hueco: se omite como antes (no usa la base); hoy y futura sí usan la base", () => {
  const ayer = incluidoEnEstadia(conBase(), "persona", "2026-11-02", "2026-11-02", HOY);
  assert.equal(incluidoSeOmite(ayer), true);
  for (const f of ["2026-11-03", "2026-12-20"]) { const r = incluidoEnEstadia(conBase(), "persona", f, f, HOY); assert.equal(r.ok && r.netoPersona, 60000, f); }
});
test("un servicio que NO es traslado nunca usa la base aunque la tenga", () => {
  const r = incluidoEnEstadia(base({ temporadas: [], tarifaBase: { precioPersona: 60000, grupos: [] } }), "persona", ...estadia, HOY);
  assert.equal(incluidoSeOmite(r), true);
});
test("respaldo base: precio_infante 0 = gratis, NULL = paga como adulto, valor inválido falla cerrado (dato_invalido); una vigencia específica no lo toca", () => {
  const inf = (precioInfante: number | null | undefined) => incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: 60000, precioInfante, grupos: [] } }), "persona", ...estadia, HOY);
  const gratis = inf(0); assert.equal(gratis.ok && gratis.netoInfante, 0); assert.equal(gratis.ok && gratis.netoPersona, 60000);
  const comoAdulto = inf(null); assert.equal(comoAdulto.ok && comoAdulto.netoInfante, null);
  assert.equal(inf(undefined).ok && (inf(undefined) as { netoInfante: number | null }).netoInfante, null);
  assert.equal(inf(25000).ok && (inf(25000) as { netoInfante: number | null }).netoInfante, 25000);
  for (const malo of [-1, Number.NaN, Number.POSITIVE_INFINITY]) { const r = inf(malo); assert.equal(!r.ok && r.motivo, "dato_invalido", String(malo)); assert.equal(incluidoSeOmite(r), false); assert.match(!r.ok ? r.error : "", /precio de infante base no válido/); }
  // con una vigencia que cubre la fecha, el infante base ni se mira (aunque sea inválido)
  const vig = incluidoEnEstadia(conBase({ temporadas: [{ ...ALTA, precio_persona: 80000, precio_infante: 5000 } as never], tarifaBase: { precioPersona: 60000, precioInfante: Number.NaN, grupos: [] } }), "persona", ...estadia, HOY);
  assert.equal(vig.ok && vig.netoInfante, 5000);
});
test("respaldo base: un precio base por persona 0 (valor por defecto de un servicio solo por vigencias) NO se toma como traslado gratis", () => {
  const r = incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: 0, grupos: [] } }), "persona", ...estadia, HOY);
  assert.equal(!r.ok && r.motivo, "traslado_sin_vigencia"); assert.match(!r.ok ? r.error : "", /precio base por persona mayor que cero/);
});
test("respaldo base, grupo: rangos GENERAL en 0/NULL son ausencia y no bloquean los válidos; sin ninguno válido bloquea; NaN/negativo es dato corrupto", () => {
  const g = (precio: number) => ({ pax_desde: 1, pax_hasta: 4, precio, temporada: "GENERAL" });
  for (const [etiqueta, grupos] of [["0", [g(0)]], ["NULL", [g(Number(null))]], ["vacíos", []]] as const) {
    const r = incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: 60000, grupos: [...grupos] } }), "grupo", ...estadia, HOY);
    assert.equal(!r.ok && r.motivo, "traslado_sin_vigencia", etiqueta); assert.equal(incluidoSeOmite(r), false, etiqueta);
    assert.match(!r.ok ? r.error : "", /tampoco tiene rangos base.*Crea una vigencia con tarifa o configura la tarifa base en Producto → Servicios/, etiqueta);
  }
  for (const [etiqueta, malo] of [["NaN", Number.NaN], ["negativo", -1]] as const) {
    const r = incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: 60000, grupos: [g(malo), { ...g(100000), pax_desde: 5, pax_hasta: 8 }] } }), "grupo", ...estadia, HOY);
    assert.equal(!r.ok && r.motivo, "dato_invalido", etiqueta);
  }
  const mixto = incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: 0, grupos: [g(0), { ...g(100000), pax_desde: 5, pax_hasta: 8 }] } }), "grupo", ...estadia, HOY);
  assert.deepEqual(mixto.ok && mixto.rangos, [{ pax_desde: 5, pax_hasta: 8, precio: 100000 }], "el rango 1–4 vacío no bloquea el 5–8 ni se cubre con él");
  const ok = incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: 0, grupos: [g(200000)] } }), "grupo", ...estadia, HOY);
  assert.deepEqual(ok.ok && ok.rangos, [{ pax_desde: 1, pax_hasta: 4, precio: 200000 }], "en grupo solo cuentan los rangos GENERAL (el precio_persona base no interviene)");
});

test("respaldo base: precio_persona NULL/vacío/NaN = sin configurar; con base de adulto válida, precio_infante 0 sigue siendo infante gratis", () => {
  for (const p of [null, Number.NaN, 0, -5]) assert.equal(incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: p as never, precioInfante: 0, grupos: [] } }), "persona", ...estadia, HOY).ok, false, String(p));
  const r = incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: 60000, precioInfante: 0, grupos: [] } }), "persona", ...estadia, HOY);
  assert.equal(r.ok && r.netoPersona, 60000); assert.equal(r.ok && r.netoInfante, 0);
});

// ── Traslado incluido: se tarifa por la fecha de LLEGADA (el regreso puede quedar fuera de la vigencia) ──────────────────────────────────────────────────────────────────
const V1 = { ...ALTA, nombre: "V1", fecha_inicio: "2030-05-01", fecha_fin: "2030-05-31", precio_persona: 80000 };
const V2 = { ...ALTA, id: 6, nombre: "V2", fecha_inicio: "2030-06-01", fecha_fin: "2030-06-30", precio_persona: 120000 };
test("llegada dentro de la vigencia y regreso fuera: se cobra la tarifa de la llegada (persona y grupo)", () => {
  const sv = conBase({ temporadas: [V1 as never], grupos: [{ pax_desde: 1, pax_hasta: 4, precio: 90000, temporada: "V1" }] });
  const p = incluidoEnEstadia(sv, "persona", "2030-05-30", "2030-06-04", HOY);
  assert.equal(p.ok && p.netoPersona, 80000); assert.equal(p.ok && p.vigencia, "V1"); assert.equal(p.ok && p.origen, undefined);
  const g = incluidoEnEstadia(sv, "grupo", "2030-05-30", "2030-06-04", HOY);
  assert.deepEqual(g.ok && g.rangos, [{ pax_desde: 1, pax_hasta: 4, precio: 90000 }, { pax_desde: 5, pax_hasta: 10, precio: 150000 }], "la vigencia cubre 1–4; la base solo completa 5–10");
});
test("estadía que cruza dos vigencias: usa solo la de la llegada, sin sumar ni prorratear", () => {
  const sv = conBase({ temporadas: [V1 as never, V2 as never] });
  const a = incluidoEnEstadia(sv, "persona", "2030-05-29", "2030-06-03", HOY);
  assert.equal(a.ok && a.netoPersona, 80000); assert.equal(a.ok && a.vigencia, "V1");
  const b = incluidoEnEstadia(sv, "persona", "2030-06-02", "2030-06-05", HOY);
  assert.equal(b.ok && b.netoPersona, 120000); assert.equal(b.ok && b.vigencia, "V2");
});
test("llegada sin tarifa de vigencia (hueco o vigencia sin precio): usa la base aunque el regreso caiga en una vigencia con tarifa", () => {
  const hueco = incluidoEnEstadia(conBase({ temporadas: [V2 as never] }), "persona", "2030-05-29", "2030-06-03", HOY);
  assert.equal(hueco.ok && hueco.netoPersona, 60000); assert.equal(hueco.ok && hueco.origen, "base");
  const sinPrecio = incluidoEnEstadia(conBase({ temporadas: [{ ...V1, precio_persona: null } as never, V2 as never] }), "persona", "2030-05-29", "2030-06-03", HOY);
  assert.equal(sinPrecio.ok && sinPrecio.origen, "base");
});
test("sin tarifa de vigencia ni base en la fecha de llegada: bloquea con el mensaje orientativo (el regreso no lo salva)", () => {
  for (const modo of ["persona", "grupo"] as const) {
    const r = incluidoEnEstadia(conBase({ temporadas: [V2 as never], tarifaBase: { precioPersona: null, grupos: [] } }), modo, "2030-05-29", "2030-06-03", HOY);
    assert.equal(!r.ok && r.motivo, "traslado_sin_vigencia"); assert.equal(incluidoSeOmite(r), false);
    assert.match(!r.ok ? r.error : "", /Crea una vigencia con tarifa o configura la tarifa base en Producto → Servicios/);
  }
});
test("paridad: publicación (ventana de la estadía) y Reservar/carrito (fecha de ida) dan el mismo resultado; otros servicios conservan la cobertura de la estadía", () => {
  const sv = conBase({ temporadas: [V1 as never, V2 as never] });
  for (const [d, h] of [["2030-05-29", "2030-06-03"], ["2030-05-01", "2030-05-31"], ["2030-04-28", "2030-05-02"], ["2030-06-28", "2030-07-03"]] as const) {
    for (const modo of ["persona", "grupo"] as const) assert.deepEqual(incluidoEnEstadia(sv, modo, d, h, HOY), incluidoEnEstadia(sv, modo, d, d, HOY), `${modo} ${d}`);
  }
  // un servicio que NO es traslado sigue exigiendo una sola vigencia en toda la estadía
  const otro = base({ temporadas: [V1 as never, V2 as never] });
  const r = incluidoEnEstadia(otro, "persona", "2030-05-29", "2030-06-03", HOY);
  assert.equal(!r.ok && r.motivo, "ambiguo");
});

// ── Traslado: 0 y NULL = AUSENCIA de tarifa (nunca gratis); cascada propia ida y regreso > general de la vigencia > base ─────────────────────────────────────────────
const MSG = /Crea una vigencia con tarifa o configura la tarifa base en Producto → Servicios/;
const tarifa = (ir: number | null | undefined, gen: number | null, bas: number | null, extra: Partial<VigenciasServicio> = {}) => conBase({
  temporadas: [{ ...ALTA, precio_persona: gen } as never], tarifaBase: { precioPersona: bas, grupos: [] },
  ...(ir === undefined ? {} : { personaIdaRegreso: new Map([["ALTA", ir as number]]) }), ...extra,
});
const persona = (sv: VigenciasServicio) => incluidoEnEstadia(sv, "persona", ...estadia, HOY);
test("persona: 0 y NULL en cada nivel son ausencia y bajan al siguiente nivel; nunca dan un traslado gratis", () => {
  for (const vacio of [0, null]) {
    // propia de ida y regreso vacía → general de la vigencia
    const aGeneral = persona(tarifa(vacio, 80000, 60000)); assert.equal(aGeneral.ok && aGeneral.netoPersona, 80000); assert.equal(aGeneral.ok && aGeneral.origen, undefined);
    // propia y general vacías → base
    const aBase = persona(tarifa(vacio, vacio, 60000)); assert.equal(aBase.ok && aBase.netoPersona, 60000); assert.equal(aBase.ok && aBase.origen, "base");
    // sin propia: general vacía → base
    const sinPropia = persona(tarifa(undefined, vacio, 60000)); assert.equal(sinPropia.ok && sinPropia.origen, "base");
    // todo vacío (propia, general y base) → bloquea con el mensaje acordado
    const nada = persona(tarifa(vacio, vacio, vacio)); assert.equal(nada.ok, false); assert.equal(incluidoSeOmite(nada), false); assert.match(!nada.ok ? nada.error : "", MSG);
  }
  // prioridad: la propia > 0 manda sobre general y base
  const propia = persona(tarifa(120000, 80000, 60000)); assert.equal(propia.ok && propia.netoPersona, 120000);
});
test("persona: NaN/negativo en cualquier nivel son datos corruptos y NO se ocultan con el respaldo", () => {
  for (const malo of [Number.NaN, -5]) {
    for (const sv of [tarifa(malo, 80000, 60000), tarifa(undefined, malo, 60000), tarifa(undefined, malo, null)]) {
      const r = persona(sv); assert.equal(!r.ok && r.motivo, "dato_invalido");
    }
    // base corrupta con todo lo demás vacío: no cobra, bloquea
    assert.equal(persona(tarifa(null, null, malo)).ok, false);
  }
});
test("grupo: rangos en 0/NULL son ausencia, bajan por nivel (propio > general de la vigencia > base); todos vacíos → error; NaN/negativo → dato corrupto", () => {
  const R = (precio: number | null, pax_desde = 1, pax_hasta = 4, temporada = "ALTA") => ({ pax_desde, pax_hasta, precio: precio as number, temporada });
  const BASE = [{ pax_desde: 1, pax_hasta: 4, precio: 50000, temporada: "GENERAL" }];
  const g = (extra: Partial<VigenciasServicio>) => incluidoEnEstadia(conBase({ temporadas: [ALTA as never], tarifaBase: { precioPersona: null, grupos: BASE }, ...extra }), "grupo", ...estadia, HOY);
  for (const vacio of [0, null]) {
    const aGeneral = g({ gruposIdaRegreso: [R(vacio)], grupos: [R(80000)] }); assert.deepEqual(aGeneral.ok && aGeneral.rangos, [{ pax_desde: 1, pax_hasta: 4, precio: 80000 }]);
    const aBase = g({ gruposIdaRegreso: [R(vacio)], grupos: [R(vacio)] }); assert.deepEqual(aBase.ok && aBase.rangos, [{ pax_desde: 1, pax_hasta: 4, precio: 50000 }]); assert.equal(aBase.ok && aBase.origen, "base");
    const nada = incluidoEnEstadia(conBase({ temporadas: [ALTA as never], tarifaBase: { precioPersona: null, grupos: [{ ...BASE[0], precio: vacio as number }] }, grupos: [R(vacio)] }), "grupo", ...estadia, HOY);
    assert.equal(nada.ok, false); assert.match(!nada.ok ? nada.error : "", MSG);
  }
  // un rango propio en 0 deja caer a la general solo los pax que cubría; el propio > 0 de otro rango se conserva
  const mixto = g({ gruposIdaRegreso: [R(0, 1, 4), R(90000, 5, 8)], grupos: [R(80000, 1, 4)] });
  assert.deepEqual(mixto.ok && mixto.rangos, [{ pax_desde: 1, pax_hasta: 4, precio: 80000 }, { pax_desde: 5, pax_hasta: 8, precio: 90000 }]);
  for (const malo of [Number.NaN, -5]) {
    assert.equal(!g({ gruposIdaRegreso: [R(malo)], grupos: [R(80000)] }).ok, true);
    const c = g({ grupos: [R(malo)] }); assert.equal(!c.ok && c.motivo, "dato_invalido");
  }
});
test("una tarifa exclusiva de llegada o salida NO se convierte en ida y regreso; otros servicios conservan su 0 permitido", () => {
  // solo precio de un trayecto (personaAlcance) y nada de ida y regreso: se ignora y baja a la base
  const soloLlegada = persona(conBase({ temporadas: [{ ...ALTA, precio_persona: null } as never], personaAlcance: new Map([["ALTA", 40000]]) }));
  assert.equal(soloLlegada.ok && soloLlegada.netoPersona, 60000); assert.equal(soloLlegada.ok && soloLlegada.origen, "base");
  const sinBase = persona(conBase({ temporadas: [{ ...ALTA, precio_persona: null } as never], personaAlcance: new Map([["ALTA", 40000]]), tarifaBase: { precioPersona: null, grupos: [] } }));
  assert.equal(sinBase.ok, false);
  // servicio sin alcance: 0 sigue siendo un precio válido
  const otro = incluidoEnEstadia(base({ temporadas: [{ ...ALTA, precio_persona: 0 } as never] }), "persona", ...estadia, HOY);
  assert.equal(otro.ok && otro.netoPersona, 0);
});
test("referenciaPublicacion, grupo traslado: un rango en 0/NULL no existe ni se sustituye; los demás rangos válidos se publican; NaN/negativo es corrupto; rangos distintos entre vigencias siguen siendo error estructural", () => {
  const R = (precio: number | null, d: number, h: number, temporada = "ALTA") => ({ pax_desde: d, pax_hasta: h, precio: precio as number, temporada });
  const pub = (extra: Partial<VigenciasServicio>, temporadas = [ALTA as never]) => referenciaPublicacion(base({ usaAlcance: true, temporadas, ...extra }), "grupo", ventana, "2029-01-01");
  for (const vacio of [0, null]) {
    const r = pub({ gruposIdaRegreso: [R(vacio, 1, 4)], grupos: [R(90000, 5, 8)] });
    assert.deepEqual(r.ok && r.rangos, [{ pax_desde: 5, pax_hasta: 8, precio: 90000 }], "el 1–4 vacío no se cubre con el 5–8");
    assert.equal(pub({ gruposIdaRegreso: [R(vacio, 1, 4)], grupos: [R(vacio, 1, 4)] }).ok, false, "todo vacío: no se publica");
  }
  for (const malo of [Number.NaN, -5]) assert.equal(pub({ grupos: [R(malo, 1, 4)] }).ok, false);
  // validación estructural independiente (conservada): si los rangos válidos difieren entre las vigencias del viaje, no se publica un precio ambiguo
  const V = (nombre: string, id: number, ini: string, fin: string) => ({ ...ALTA, id, nombre, fecha_inicio: ini, fecha_fin: fin }) as never;
  const dosVig = [V("A", 11, "2030-05-01", "2030-05-05"), V("B", 12, "2030-05-06", "2030-05-10")];
  const dist = pub({ grupos: [R(100, 1, 4, "A"), R(0, 5, 8, "A"), R(100, 1, 4, "B"), R(100, 5, 8, "B")] }, dosVig);
  assert.equal(dist.ok, false); assert.match(!dist.ok ? dist.error : "", /rangos de pasajeros distintos/);
});

// ── Respaldo por CANTIDAD en traslados incluidos de grupo (G1–G4): propio > general de vigencia > base; cada nivel > 0 y solo para los pasajeros que cubre ───────────────
const BG = (d: number, h: number, precio: number | null) => ({ pax_desde: d, pax_hasta: h, precio: precio as number, temporada: "GENERAL" });
const VG = (d: number, h: number, precio: number | null) => ({ pax_desde: d, pax_hasta: h, precio: precio as number, temporada: "ALTA" });
const grupoCosto = (sv: VigenciasServicio, pax: number) => { const r = incluidoEnEstadia(sv, "grupo", "2030-03-01", "2030-03-01", HOY); return r.ok ? costoNetoServicioIncluido("grupo", r.netoPersona, r.rangos, pax, "paquete", 3, undefined) : r; };
test("G1 sin vigencia, base [1–4: 0, 5–8: 100.000]: 6 pasajeros usan la base; 3 NO tienen tarifa (ni gratis ni con el 5–8)", () => {
  const sv = conBase({ tarifaBase: { precioPersona: null, grupos: [BG(1, 4, 0), BG(5, 8, 100000)] } });
  assert.equal(grupoCosto(sv, 6), 100000); assert.equal(grupoCosto(sv, 3), null); assert.equal(grupoCosto(sv, 9), null);
});
test("G2 vigencia [1–4: 90.000], base [5–8: 100.000]: 3 → vigencia, 6 → base, 9 → rechazo", () => {
  const sv = conBase({ temporadas: [ALTA as never], grupos: [VG(1, 4, 90000)], tarifaBase: { precioPersona: null, grupos: [BG(5, 8, 100000)] } });
  assert.equal(grupoCosto(sv, 3), 90000); assert.equal(grupoCosto(sv, 6), 100000); assert.equal(grupoCosto(sv, 9), null);
});
test("G3 vigencia [1–4: 0, 5–8: 90.000], base [1–4: 50.000, 5–8: 100.000]: 3 → base (la vigencia en 0 es ausencia), 6 → vigencia (prevalece sobre la base)", () => {
  const sv = conBase({ temporadas: [ALTA as never], grupos: [VG(1, 4, 0), VG(5, 8, 90000)], tarifaBase: { precioPersona: null, grupos: [BG(1, 4, 50000), BG(5, 8, 100000)] } });
  assert.equal(grupoCosto(sv, 3), 50000); assert.equal(grupoCosto(sv, 6), 90000);
});
test("G4 vigencia sin rangos, base [1–4: 50.000, 5–8: 0]: 3 → base; 6 → rechazo (el 5–8 vacío no bloquea el 1–4 ni se cubre con otro)", () => {
  const sv = conBase({ temporadas: [ALTA as never], grupos: [], tarifaBase: { precioPersona: null, grupos: [BG(1, 4, 50000), BG(5, 8, 0)] } });
  assert.equal(grupoCosto(sv, 3), 50000); assert.equal(grupoCosto(sv, 6), null);
  const nada = incluidoEnEstadia(conBase({ temporadas: [ALTA as never], grupos: [VG(1, 4, 0)], tarifaBase: { precioPersona: null, grupos: [BG(1, 4, 0)] } }), "grupo", "2030-03-01", "2030-03-01", HOY);
  assert.equal(nada.ok, false); assert.match(!nada.ok ? nada.error : "", /Crea una vigencia con tarifa o configura la tarifa base en Producto → Servicios/);
});
test("solapamiento: los niveles se combinan por PRIORIDAD recortando, sin dos precios para un mismo tamaño; NaN/negativo en cualquier nivel no se oculta", () => {
  const sv = conBase({ temporadas: [ALTA as never], gruposIdaRegreso: [VG(3, 5, 70000)], grupos: [VG(1, 8, 90000)], tarifaBase: { precioPersona: null, grupos: [BG(1, 12, 100000)] } });
  const r = incluidoEnEstadia(sv, "grupo", "2030-03-01", "2030-03-01", HOY);
  assert.deepEqual(r.ok && r.rangos, [{ pax_desde: 1, pax_hasta: 2, precio: 90000 }, { pax_desde: 3, pax_hasta: 5, precio: 70000 }, { pax_desde: 6, pax_hasta: 8, precio: 90000 }, { pax_desde: 9, pax_hasta: 12, precio: 100000 }]);
  assert.equal(r.ok && r.origen, undefined);
  for (const malo of [Number.NaN, -1]) {
    assert.equal((incluidoEnEstadia(conBase({ temporadas: [ALTA as never], grupos: [VG(1, 4, malo)], tarifaBase: { precioPersona: null, grupos: [BG(1, 4, 50000)] } }), "grupo", "2030-03-01", "2030-03-01", HOY) as { motivo?: string }).motivo, "dato_invalido");
    assert.equal((incluidoEnEstadia(conBase({ temporadas: [ALTA as never], grupos: [VG(1, 4, 90000)], tarifaBase: { precioPersona: null, grupos: [BG(1, 4, malo)] } }), "grupo", "2030-03-01", "2030-03-01", HOY) as { motivo?: string }).motivo, "dato_invalido");
  }
  const pasada = incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: null, grupos: [BG(1, 4, 50000)] } }), "grupo", "2026-11-02", "2026-11-02", HOY);
  assert.equal(incluidoSeOmite(pasada), true);
});

test("cantidad sin cobertura: el mensaje nombra el traslado y los pasajeros e indica configurar una vigencia con tarifa o una base que cubra esa cantidad", () => {
  const m = mensajeGrupoSinCobertura("Traslado aeropuerto", 9);
  assert.match(m, /«Traslado aeropuerto»/); assert.match(m, /cubra 9 pasajeros/); assert.match(m, /vigencia con tarifa por grupo/); assert.match(m, /tarifa base \(GENERAL\)/); assert.doesNotMatch(m, /No se pudo calcular el costo/);
  assert.match(mensajeGrupoSinCobertura("T", 1), /cubra 1 pasajero\./);
  // el cargo real que alimenta ese mensaje: una cantidad sin rango válido en ningún nivel
  const sv = conBase({ temporadas: [ALTA as never], grupos: [{ pax_desde: 1, pax_hasta: 4, precio: 90000, temporada: "ALTA" }], tarifaBase: { precioPersona: null, grupos: [] } });
  const r = incluidoEnEstadia(sv, "grupo", "2030-03-01", "2030-03-01", HOY);
  const cargo = cargoGrupoIncluido([{ servicioId: 10, nombre: "Traslado aeropuerto", categoria: "otro", liquidacion: "paquete", proveedorId: null, rangos: r.ok ? r.rangos : [] }], 9, 0.2, 3);
  assert.equal(cargo.ok, false); assert.equal(!cargo.ok && cargo.totalPax, 9);
});
