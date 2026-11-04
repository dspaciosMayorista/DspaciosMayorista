// Referencia de PUBLICACIÓN de un traslado por alcance (262): lo que se puede OFRECER. Un trayecto NO es requisito: «ida y regreso» se ofrece con su precio propio o, si no lo
// hay, con la tarifa que ya tiene la vigencia (precio_persona / servicio_tarifa_pax). Defecto hallado en la prueba real: en modo grupo un traslado con rangos solo en
// servicio_precio_alcance no se publicaba.
import { test } from "node:test";
import assert from "node:assert/strict";
import { referenciaPublicacion, incluidoEnEstadia, incluidoSeOmite, type VigenciasServicio } from "../lib/calc/servicioVigencias.ts";

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
  assert.match(!p.ok ? p.error : "", /«Traslado aeropuerto».*ida y regreso ni tarifa por persona.*«ALTA».*Producto → Servicios/);
  const g = incluidoEnEstadia(base({ usaAlcance: true }), "grupo", ...estadia);
  assert.equal(!g.ok && g.motivo, "traslado_sin_tarifa"); assert.match(!g.ok ? g.error : "", /rangos de pasajeros de ida y regreso/);
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
    assert.match(!r.ok ? r.error : "", /«Traslado aeropuerto» no tiene vigencia de tarifa para el 01[/]05[/]2030.*y tampoco se pudo leer su tarifa base.*completa la tarifa base/);
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
  assert.match(!malo.ok ? malo.error : "", /precios mayores que cero en todos sus rangos base/);
  // los rangos de OTRA vigencia (no GENERAL) no cuentan como base
  const ajenos = incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: null, grupos: [{ ...BASE_GRUPOS[0], temporada: "ALTA" }] } }), "grupo", ...estadia, HOY);
  assert.equal(ajenos.ok, false);
});
test("respaldo base ausente: conserva el bloqueo (no se omite) con diagnóstico que dice qué falta, en persona y en grupo", () => {
  for (const [modo, tb] of [["persona", { precioPersona: null, grupos: [] }], ["persona", { precioPersona: -5, grupos: [] }], ["grupo", { precioPersona: 60000, grupos: [] }]] as [("persona" | "grupo"), { precioPersona: number | null; grupos: never[] }][]) {
    const r = incluidoEnEstadia(conBase({ tarifaBase: tb }), modo, ...estadia, HOY);
    assert.equal(!r.ok && r.motivo, "traslado_sin_vigencia"); assert.equal(incluidoSeOmite(r), false);
    assert.match(!r.ok ? r.error : "", /no tiene vigencia de tarifa para el 01[/]05[/]2030.*tampoco tiene (un precio base por persona mayor que cero|rangos base)/);
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
  assert.deepEqual(g.ok && g.rangos, [{ pax_desde: 1, pax_hasta: 2, precio: 99000 }]);
});
test("una vigencia que cubre la fecha pero está incompleta, o con la compra cerrada, NO cae a la base", () => {
  const incompleta = incluidoEnEstadia(conBase({ temporadas: [ALTA as never] }), "persona", ...estadia, HOY);
  assert.equal(!incompleta.ok && incompleta.motivo, "traslado_sin_tarifa");
  const incompletaG = incluidoEnEstadia(conBase({ temporadas: [ALTA as never] }), "grupo", ...estadia, HOY);
  assert.equal(!incompletaG.ok && incompletaG.motivo, "traslado_sin_tarifa");
  // compra cerrada: la vigencia sigue cubriendo la fecha del viaje; se cobra SU precio, no el de la base
  const cerrada = incluidoEnEstadia(conBase({ temporadas: [{ ...ALTA, precio_persona: 80000, compra_inicio: "2020-01-01", compra_fin: "2020-12-31" } as never] }), "persona", ...estadia, HOY);
  assert.equal(cerrada.ok && cerrada.netoPersona, 80000); assert.equal(cerrada.ok && cerrada.origen, undefined);
  // cobertura PARCIAL de la estadía (precio ambiguo): sigue bloqueando
  const parcial = incluidoEnEstadia(conBase({ temporadas: [{ ...ALTA, fecha_inicio: "2030-05-03", fecha_fin: "2030-12-31", precio_persona: 80000 } as never] }), "persona", ...estadia, HOY);
  assert.equal(!parcial.ok && parcial.motivo, "traslado_sin_vigencia");
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
test("respaldo base, grupo: un rango GENERAL en 0, NULL/vacío o inválido (o uno solo de varios) deja la tarifa base sin configurar y bloquea con el aviso de configurar vigencias o tarifa base", () => {
  const g = (precio: number) => ({ pax_desde: 1, pax_hasta: 4, precio, temporada: "GENERAL" });
  for (const [etiqueta, grupos] of [["0", [g(0)]], ["NULL", [g(Number(null))]], ["NaN", [g(Number.NaN)]], ["negativo", [g(-1)]], ["uno en 0 de varios", [g(200000), { ...g(0), pax_desde: 5, pax_hasta: 8 }]], ["vacíos", []]] as const) {
    const r = incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: 60000, grupos: [...grupos] } }), "grupo", ...estadia, HOY);
    assert.equal(!r.ok && r.motivo, "traslado_sin_vigencia", etiqueta); assert.equal(incluidoSeOmite(r), false, etiqueta);
    assert.match(!r.ok ? r.error : "", /tampoco tiene (rangos base|precios mayores que cero en todos sus rangos base).*Carga o amplía la vigencia, o completa la tarifa base/, etiqueta);
  }
  const ok = incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: 0, grupos: [g(200000)] } }), "grupo", ...estadia, HOY);
  assert.deepEqual(ok.ok && ok.rangos, [{ pax_desde: 1, pax_hasta: 4, precio: 200000 }], "en grupo solo cuentan los rangos GENERAL (el precio_persona base no interviene)");
});
test("respaldo base: precio_persona NULL/vacío/NaN = sin configurar; con base de adulto válida, precio_infante 0 sigue siendo infante gratis", () => {
  for (const p of [null, Number.NaN, 0, -5]) assert.equal(incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: p as never, precioInfante: 0, grupos: [] } }), "persona", ...estadia, HOY).ok, false, String(p));
  const r = incluidoEnEstadia(conBase({ tarifaBase: { precioPersona: 60000, precioInfante: 0, grupos: [] } }), "persona", ...estadia, HOY);
  assert.equal(r.ok && r.netoPersona, 60000); assert.equal(r.ok && r.netoInfante, 0);
});
