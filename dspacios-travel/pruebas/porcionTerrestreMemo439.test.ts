import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBd, tablasBase, JOINS_ARMADO, PAQUETE_ID, type Fila, type Tablas } from "./destinosAereos67Soporte.ts";

// #439 — PORCIÓN TERRESTRE con lecturas compartidas (memo) — recorrido REAL de computarReserva/cotizarTarjetaHotel (cliente falso, sin red).
// A diferencia de bloqueo/dinámico, aquí el precio NO sale de una fila publicada: cada combinación liquida las noches elegidas EN VIVO con `liquidarHotelPaquete`
// (todas las categorías×regímenes del hotel en UNA liquidación). El memo comparte esa liquidación entre las combinaciones de la MISMA llamada, con clave paquete+hotel+ida+noches.
// Se prueba: varias categorías y regímenes con resultados distintos, igualdad completa con y sin memo, el más barato al final, cambio de fechas/noches (incluida una estadía que cruza
// dos temporadas) sin reutilizar una liquidación ajena, y un fallo de liquidación que conserva el comportamiento esperado.

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

let clienteActual: unknown = null;
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteActual } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteActual } });

const { computarReserva } = await import("@/lib/reservar/computo.ts");
const { cotizarTarjetaHotel } = await import("../app/tarifario/cotizarTarjetaActions.ts");
const { crearLecturasCompartidas } = await import("../lib/reservar/lecturasCompartidas.ts");

const HOTEL = 217;
type Combo = { categoria: string; regimen: string };
const CATS = ["Estándar", "Superior", "Suite"], REGS = ["PC", "PAM"];
const COMBOS: Combo[] = CATS.flatMap((categoria) => REGS.map((regimen) => ({ categoria, regimen })));
/** Neto por combo y temporada: todos distintos; el más barato (el último) en ambas temporadas. */
const netoBaja = (i: number) => (i === COMBOS.length - 1 ? 200_000 : 250_000 + i * 10_000);
const netoAlta = (i: number) => Math.round(netoBaja(i) * 1.5);

const JOINS = { ...JOINS_ARMADO, armado_servicios: { servicios_adicionales: { fk: "servicio_id", tabla: "servicios_adicionales" } } };

function tablas(): Tablas {
  const vig = (id: number, nombre: string, ini: string, fin: string): Fila => ({
    id, hotel_id: HOTEL, nombre, fecha_inicio: ini, fecha_fin: fin, prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null,
    rangos: null, blackouts: null, min_noches: null, regimen_restringido: null, orden: id, condicion_pago_tipo: null, condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null,
  });
  const tarifa = (id: number, c: Combo, temporada: string, neto: number): Fila => ({
    id, hotel_id: HOTEL, tipo_habitacion: c.categoria, alimentacion: c.regimen, temporada, neto_sencilla: null, neto_doble: neto, neto_triple: null, neto_multiple: null,
    neto_nino: null, neto_nino2: null, neto_infante: null, nota_infante: null, notas: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null, precio_final_autoritativo: false,
  });
  return {
    ...tablasBase({ check: false }),
    armado_paquetes: [{ id: PAQUETE_ID, nombre: "Porción", tipo: "porcion_terrestre", noches: null, activo: true, destino_id: 1, pct_mk: 0.2, pvp_infante_fijo: null, impuesto_tipo: "fijo", impuesto_fijo: 0,
      fecha_viaje_inicio: "2031-01-01", fecha_viaje_fin: "2031-12-31", destinos_aereos_alternativos: false, moneda_publicacion: "COP" }],
    armado_hoteles: [{ paquete_id: PAQUETE_ID, hotel_id: HOTEL, categorias: null, regimenes: null }],
    hoteles: [{ id: HOTEL, modelo_tarifario: "persona", tarifa_bajo_solicitud: false, nombre: "Hotel porción", moneda: "COP", edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12,
      pax_min: 1, pax_max: 4, nino_nota: null, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null, adults_only: false, pet_friendly: false }],
    hotel_acomodaciones: [{ hotel_id: HOTEL, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 }],
    // Dos temporadas: BAJA hasta el 30/06 y ALTA desde el 01/07 (una estadía del 29/06 al 02/07 cruza las dos).
    hotel_temporadas: [vig(1, "Baja", "2031-01-01", "2031-06-30"), vig(2, "Alta", "2031-07-01", "2031-12-31")],
    tarifa_hotel: COMBOS.flatMap((c, i) => [tarifa(100 + i, c, "Baja", netoBaja(i)), tarifa(200 + i, c, "Alta", netoAlta(i))]),
    hotel_blackouts: [], hotel_reglas_descuento: [{ hotel_id: HOTEL, tipo: "ebb", umbral: 10, pct: 15, activa: true }],
    // Un servicio INCLUIDO: forma parte del precio horneado en la liquidación en vivo.
    armado_servicios: [{ paquete_id: PAQUETE_ID, servicio_id: 11, modo: "persona", incluido: true }],
    servicios_adicionales: [{ id: 11, nombre: "Asistencia", categoria: "otro", precio_persona: 41_000, precio_infante: 0, liquidacion: "paquete", proveedor_id: null, moneda: "COP", recargo_individual: null, tipo_receptivo: null, combo_incluye_traslado: null, combo_traslado_alcance: null }],
    servicio_temporadas: [{ id: 111, servicio_id: 11, nombre: "VIG", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: 41_000, precio_infante: 0, recargo_individual: null }],
    servicio_tarifa_pax: [],
  };
}

const FECHAS = {
  baja3: { fechaIda: "2031-03-10", fechaRegreso: "2031-03-13" },
  baja4: { fechaIda: "2031-03-10", fechaRegreso: "2031-03-14" },
  alta3: { fechaIda: "2031-07-10", fechaRegreso: "2031-07-13" },
  cruce: { fechaIda: "2031-06-29", fechaRegreso: "2031-07-02" },
  sinCobertura: { fechaIda: "2033-03-10", fechaRegreso: "2033-03-13" },
};
type Fechas = { fechaIda: string; fechaRegreso: string };

const reserva = (c: Combo, f: Fechas) => ({
  paqueteId: PAQUETE_ID, bloqueoId: null, modulo: "porcion_terrestre" as const, hotelId: HOTEL, ...f, categoria: c.categoria, regimen: c.regimen,
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [], cantidadMenores: 0,
  cliente: { nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", telefono: "", email: "" },
  tipoAsesor: "interno" as const, asesorInterno: "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", aliadoId: null, plazo: "", pasajeros: [], servicios: [],
});

type Cmp = Awaited<ReturnType<typeof computarReserva>>;
type Memo = ReturnType<typeof crearLecturasCompartidas>;
function preparar(opc: { errorLectura?: Record<string, string> } = {}) {
  const bd = crearBd(tablas(), { joins: JOINS, ...opc });
  clienteActual = bd.cliente;
  return bd;
}
async function computar(f: Fechas, combos: Combo[], memo?: Memo, opc: { errorLectura?: Record<string, string> } = {}) {
  const bd = preparar(opc);
  const prev = console.error; console.error = () => {};
  try {
    const res: Cmp[] = [];
    for (const c of combos) res.push(await computarReserva(bd.cliente as never, reserva(c, f) as never, undefined, memo));
    return { res, lecturas: bd.lecturas };
  } finally { console.error = prev; }
}
const doble = (x: Cmp) => (x.ok ? x.data.pvpPorAcom.doble : NaN);

describe("porción terrestre: varias categorías y regímenes, igualdad completa con y sin memo", () => {
  test("los seis combos dan resultados DISTINTOS y EXACTAMENTE iguales con y sin memo; el más barato es el último", async () => {
    const sin = await computar(FECHAS.baja3, COMBOS);
    const con = await computar(FECHAS.baja3, COMBOS, crearLecturasCompartidas());
    assert.ok(sin.res.every((x) => x.ok), sin.res.map((x) => (x.ok ? "" : x.error)).join(" | "));
    assert.deepEqual(con.res, sin.res, "resultado completo idéntico, combinación por combinación");
    const precios = sin.res.map(doble);
    assert.equal(new Set(precios).size, COMBOS.length, `cada combinación tiene su propio precio: ${precios.join(", ")}`);
    assert.equal(Math.min(...precios), precios[COMBOS.length - 1], "el más barato está al final");
    assert.ok(sin.res.every((x) => x.ok && x.data.descuentoHotel), "la regla EBB se aplicó en vivo");
    assert.ok(con.lecturas.length < sin.lecturas.length, `con memo ${con.lecturas.length} < sin memo ${sin.lecturas.length}`);
    console.log(`REPORTE439 porción (6 combos): consultas sin memo=${sin.lecturas.length}, con memo=${con.lecturas.length}`);
  });

  test("la acción de la tarjeta encuentra el más barato (el último) y entrega los 6 combos", async () => {
    const ref = await computar(FECHAS.baja3, COMBOS);
    preparar();
    const r = await cotizarTarjetaHotel({ modulo: "porcion_terrestre", paqueteId: PAQUETE_ID, hotelId: HOTEL, ...FECHAS.baja3, combos: COMBOS });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    if (!r.ok) return;
    assert.equal(r.combos.length, COMBOS.length);
    assert.equal(r.precio, Math.min(...ref.res.map(doble)));
    assert.equal(r.categoria, COMBOS[COMBOS.length - 1].categoria);
    assert.equal(r.regimen, COMBOS[COMBOS.length - 1].regimen);
    r.combos.forEach((c, i) => assert.equal(c.precios.doble, doble(ref.res[i]), `combo ${i}`));
  });
});

describe("porción terrestre: cambio de fechas y noches NO reutiliza una liquidación ajena", () => {
  test("UN memo compartido por error entre estadías distintas (otra noche, otra temporada, una que cruza dos) da lo mismo que memos separados", async () => {
    const escenarios = [FECHAS.baja3, FECHAS.baja4, FECHAS.alta3, FECHAS.cruce];
    const claves = new Set<string>();
    const memo = crearLecturasCompartidas();
    const espia: Memo = { memo: (k, f) => { if (k.includes("liquidarHotelPaquete")) claves.add(k); return memo.memo(k, f); }, estadisticas: () => memo.estadisticas() };
    const compartido: Cmp[][] = [], separado: Cmp[][] = [];
    for (const f of escenarios) {
      compartido.push((await computar(f, COMBOS, espia)).res);
      separado.push((await computar(f, COMBOS, crearLecturasCompartidas())).res);
    }
    assert.deepEqual(compartido, separado);
    assert.equal(claves.size, escenarios.length, `una liquidación por (ida, noches): ${[...claves].join(" | ")}`);
    for (const f of escenarios) assert.ok([...claves].some((k) => k.includes(`:${f.fechaIda}:`)), "la clave lleva la fecha de ida");
    // Las estadías son realmente distintas entre sí para el mismo combo (no se reutilizó ninguna).
    for (let i = 0; i < COMBOS.length; i++) {
      const p = escenarios.map((_, e) => doble(compartido[e][i]));
      assert.equal(new Set(p).size, escenarios.length, `combo ${i}: ${p.join(", ")}`);
    }
    // La estadía que cruza BAJA y ALTA queda entre la 100 % baja y la 100 % alta (3 noches).
    const [baja3, , alta3, cruce] = [0, 1, 2, 3].map((e) => doble(compartido[e][0]));
    assert.ok(cruce > baja3 && cruce < alta3, `cruce ${cruce} entre ${baja3} y ${alta3}`);
  });

  test("las claves llevan paquete, hotel, ida y noches; ninguna lleva categoría ni régimen", async () => {
    const claves: string[] = [];
    const memo = crearLecturasCompartidas();
    const espia: Memo = { memo: (k, f) => { claves.push(k); return memo.memo(k, f); }, estadisticas: () => memo.estadisticas() };
    await computar(FECHAS.baja4, COMBOS.slice(0, 2), espia);
    const liq = claves.find((k) => k.includes("liquidarHotelPaquete"))!;
    assert.equal(liq, `admin:liquidarHotelPaquete:${PAQUETE_ID}:${HOTEL}:${FECHAS.baja4.fechaIda}:4`);
    for (const k of claves) assert.ok(!/Estándar|Superior|Suite|\bPC\b|\bPAM\b/.test(k), `«${k}» no debe depender del combo`);
  });
});

describe("porción terrestre: un fallo de liquidación conserva el comportamiento esperado", () => {
  const SIN_TARIFA = "No hay tarifa para esas fechas / categoría / régimen.";
  for (const tabla of ["hotel_temporadas", "tarifa_hotel", "hotel_blackouts", "armado_hoteles"]) {
    test(`error de lectura en «${tabla}»: mismo resultado con y sin memo, y con memo se lee una sola vez`, async () => {
      const opc = { errorLectura: { [tabla]: "boom" } };
      const sin = await computar(FECHAS.baja3, COMBOS, undefined, opc);
      const con = await computar(FECHAS.baja3, COMBOS, crearLecturasCompartidas(), opc);
      assert.deepEqual(con.res, sin.res);
      assert.ok(sin.res.every((x) => !x.ok), "un fallo técnico nunca vende");
      assert.ok(con.lecturas.filter((t) => t === tabla).length < sin.lecturas.filter((t) => t === tabla).length);
    });
  }

  test("una estadía sin cobertura de temporada: el mismo «No hay tarifa…» con y sin memo", async () => {
    const sin = await computar(FECHAS.sinCobertura, COMBOS);
    const con = await computar(FECHAS.sinCobertura, COMBOS, crearLecturasCompartidas());
    assert.deepEqual(con.res, sin.res);
    assert.ok(sin.res.every((x) => !x.ok && x.error === SIN_TARIFA), sin.res.map((x) => (x.ok ? "ok" : x.error)).join(" | "));
  });

  test("una lectura que LANZA una vez no deja la liquidación guardada: la combinación siguiente la reintenta y calcula igual que la referencia", async () => {
    const ref = await computar(FECHAS.baja3, COMBOS.slice(0, 2));
    const bd = preparar();
    const c = bd.cliente as { from: (t: string) => unknown };
    const original = c.from.bind(c);
    let lanzo = false;
    c.from = (t: string) => { if (t === "hotel_blackouts" && !lanzo) { lanzo = true; throw new Error("fallo transitorio de red"); } return original(t); };
    const memo = crearLecturasCompartidas();
    const prev = console.error; console.error = () => {};
    try {
      await assert.rejects(() => computarReserva(bd.cliente as never, reserva(COMBOS[0], FECHAS.baja3) as never, undefined, memo), /fallo transitorio/);
      const segundo = await computarReserva(bd.cliente as never, reserva(COMBOS[1], FECHAS.baja3) as never, undefined, memo);
      assert.deepEqual(segundo, ref.res[1], "el reintento calcula exactamente lo que la referencia");
    } finally { console.error = prev; }
  });
});
