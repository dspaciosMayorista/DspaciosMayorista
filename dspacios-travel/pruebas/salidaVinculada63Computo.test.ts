import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { crearClienteFalso, type ClienteFalso, type FilaFalsa, type TablasFalsas } from "./support/fakeSupabase.ts";

// #63 — computarReserva() REAL con una salida VINCULADA a un Empaquetado sin record:
//   · se cotiza SIN consultar cupos de Bloqueo ni sillas (el cliente falso lanza si se toca otra tabla);
//   · el BNC de una vinculada con impuesto_tipo = tiquete es R × pax con silla (el menor de 2 años no genera BNC);
//   · se valida contra la fuente VIVA (record, activa, ventana, copia coincidente, destino aéreo de la 220) ANTES de leer precio;
//   · un paquete en modo 63 expone la oferta (TRM, R, F) y la moneda de origen de hotel y servicios para las CxP.

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

let adminActual: ClienteFalso = crearClienteFalso({});
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => adminActual } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => { throw new Error("createClient() no debe invocarse: sb se inyecta"); } } });

const { computarReserva } = await import("@/lib/reservar/computo.ts");

function fechaBogota(offsetDias: number): string {
  return new Date(Date.now() + offsetDias * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
const AYER = fechaBogota(-1);
const IDA = fechaBogota(30);
const REG = fechaBogota(33);

const PAQUETE_ID = 70;
const HOTEL_ID = 217;
const SALIDA_ID = 11;
const EMPAQUETADO_ID = 5;
const CAT = "Estándar";
const REGIMEN = "PAE";
const R = 1_130_000;
const F = 80_500;
const TABLAS_DE_CUPOS = ["cupos_por_bloqueo", "sillas", "bloqueos_vuelo"];

function espiar(c: ClienteFalso, log: string[]): ClienteFalso {
  return {
    ...c,
    from(tabla: string) {
      log.push(tabla);
      if (TABLAS_DE_CUPOS.includes(tabla)) throw new Error(`#63: una salida vinculada NO consulta cupos de Bloqueo (se tocó "${tabla}")`);
      return c.from(tabla);
    },
  };
}
function conErrorEn(c: ClienteFalso, tablaConError: string): ClienteFalso {
  return {
    ...c,
    from(tabla: string) {
      if (tabla !== tablaConError) return c.from(tabla);
      const err = { message: "permission denied" };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data: null, error: err });
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: err }).then(res, rej);
      return b as unknown as ReturnType<ClienteFalso["from"]>;
    },
  };
}

const salidaVinculada = (o: FilaFalsa = {}): FilaFalsa => ({
  id: SALIDA_ID, paquete_id: PAQUETE_ID, empaquetado_id: EMPAQUETADO_ID, activo: true, compra_inicio: null, compra_fin: null,
  fecha_ida: IDA, fecha_regreso: REG, ruta: "BOG - CTG - BOG", aerolinea: "JetSMART", valor_tiquete: R, fee_infante: F,
  aplica_mk: false, ta: 0, moneda: "COP", ...o,
});
const fuente = (o: FilaFalsa = {}): FilaFalsa => ({
  id: EMPAQUETADO_ID, activo: true, record: null, compra_inicio: null, compra_fin: null, fecha_ida: IDA, fecha_regreso: REG,
  ruta: "BOG - CTG - BOG", aerolinea: "JetSMART", destino_id: 1, moneda: "COP", tarifa_proveedor: 1_000_000, tarifa_para_empaquetar: R, fee_infante: F, ...o,
});
const paquete = (o: FilaFalsa = {}): FilaFalsa => ({
  id: PAQUETE_ID, pct_mk: 0.2, impuesto_tipo: "tiquete", impuesto_fijo: 100_000, destino_id: 1, tipo: "dinamico",
  destinos_aereos_alternativos: false, modo_oferta: "cop_trm_63", trm_oferta: 4000,
  tarifario_generacion_publicada: 3, tarifario_revision_publicada: 5, ...o,
});

function tablasSesion(): TablasFalsas {
  return {
    hoteles: [{
      id: HOTEL_ID, modelo_tarifario: "persona", nombre: "Hotel Dinámico", moneda: "USD",
      edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12, pax_min: 1, pax_max: 4,
      nino_nota: null, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null, adults_only: false, pet_friendly: false,
    }],
    armado_paquetes: [paquete()],
    tarifario_resultado_publicable: [
      { paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID, categoria: CAT, regimen: REGIMEN, salida_id: SALIDA_ID, empaquetado_id: null, bloqueo_id: null,
        acomodacion: "doble", precio_pvp: 1_680_000, precio_pvp_menor2: null, hotel_nombre: "Hotel Dinámico", destino_nombre: "CARTAGENA", fecha_ida: IDA, fecha_regreso: REG, moneda: "COP" },
      { paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID, categoria: CAT, regimen: REGIMEN, salida_id: SALIDA_ID, empaquetado_id: null, bloqueo_id: null,
        acomodacion: "infante", precio_pvp: 1_230_000, precio_pvp_menor2: 130_500, hotel_nombre: "Hotel Dinámico", destino_nombre: "CARTAGENA", fecha_ida: IDA, fecha_regreso: REG, moneda: "COP" },
    ],
    hotel_acomodaciones: [{ hotel_id: HOTEL_ID, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 }],
  };
}
function tablasAdmin(o: { salidas?: FilaFalsa[]; fuentes?: FilaFalsa[]; paquete?: FilaFalsa; servicios?: FilaFalsa[]; evidencia?: FilaFalsa[]; vigencias?: FilaFalsa[] } = {}): TablasFalsas {
  return {
    ...tablasSesion(),
    armado_paquetes: [paquete(o.paquete)],
    salidas_dinamicas: o.salidas ?? [salidaVinculada()],
    empaquetados: o.fuentes ?? [fuente()],
    destinos: [{ id: 1, nombre: "CARTAGENA", codigo_iata: "CTG", pais: "Colombia", activo: true }],
    armado_paquete_destinos_aereos: [],
    hotel_temporadas: [{
      id: 1, hotel_id: HOTEL_ID, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null,
      tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null,
    }],
    tarifa_hotel: [{
      id: 10, hotel_id: HOTEL_ID, tipo_habitacion: CAT, alimentacion: REGIMEN, temporada: "Base",
      neto_sencilla: null, neto_doble: 100, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: 10, nota_infante: null,
      notas: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null, precio_final_autoritativo: false,
    }],
    armado_servicios: o.servicios ?? [],
    servicios_adicionales: [{ id: 900, nombre: "Tour", moneda: "USD" }],
    // #90 D: el cargador de fuentes de moneda (TRM condicional) lee el armado del paquete por id.
    armado_hoteles: [{ paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID }],
    armado_vuelos: [],
    armado_empaquetados: [],
    servicio_tarifa_pax: [],
    // 258: evidencia de la composición publicada (generación 3 = la publicada del paquete(), regla 1) con los incluidos del fixture horneados en la fila de la salida.
    tarifario_composicion_publicada: o.evidencia ?? [{ paquete_id: PAQUETE_ID, fecha_ida: IDA, generacion: 3, regla: 1, servicios_incluidos: (o.servicios ?? []).filter((x) => x.incluido).map((x) => x.servicio_id) }],
    // SIN «GENERAL»: cada servicio del fixture se vende desde una vigencia que cubre todo el rango (mismos netos que su precio base de antes).
    servicio_temporadas: o.vigencias ?? (o.servicios ?? []).map((s) => ({ servicio_id: s.servicio_id, nombre: "VIG", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: (s.servicios_adicionales as { precio_persona?: number | null; precio_infante?: number | null }).precio_persona ?? null, precio_infante: (s.servicios_adicionales as { precio_persona?: number | null; precio_infante?: number | null }).precio_infante ?? null, recargo_individual: null })),
  };
}

function input(over: Record<string, unknown> = {}) {
  return {
    paqueteId: PAQUETE_ID, bloqueoId: null, empaquetadoId: null, salidaId: SALIDA_ID, modulo: "dinamico" as const,
    hotelId: HOTEL_ID, categoria: CAT, regimen: REGIMEN, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0,
    cliente: { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", telefono: "300", email: "a@a.com" },
    tipoAsesor: "interno" as const, asesorInterno: "Asesor", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
    aliadoId: null, plazo: "24 horas", servicios: [],
    pasajeros: [
      { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", fechaNacimiento: "1990-01-01", nacionalidad: "CO", esInfante: false },
      { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "456", fechaNacimiento: "1992-01-01", nacionalidad: "CO", esInfante: false },
    ],
    ...over,
  };
}

async function cotizar(admin: TablasFalsas, over: Record<string, unknown> = {}, conError?: string) {
  const logSb: string[] = [];
  const logAdmin: string[] = [];
  const sb = espiar(crearClienteFalso(tablasSesion()), logSb);
  let ad = espiar(crearClienteFalso(admin), logAdmin);
  if (conError) ad = conErrorEn(ad, conError);
  adminActual = ad;
  const r = await computarReserva(sb as unknown as Parameters<typeof computarReserva>[0], input(over));
  return { r, logSb, logAdmin };
}
const msg = (r: Awaited<ReturnType<typeof cotizar>>["r"]) => (r.ok ? "" : r.error);

describe("computarReserva() · salida VINCULADA se cotiza SIN consultar cupos de Bloqueo", () => {
  test("2 adultos: precio del tarifario, oferta 63 expuesta y NINGUNA consulta a cupos/sillas/bloqueos", async () => {
    const { r, logSb, logAdmin } = await cotizar(tablasAdmin());
    assert.equal(r.ok, true, msg(r));
    if (!r.ok) return;
    assert.equal(r.data.precioVenta, 3_360_000, "1 hab doble = 2 pax × 1.680.000");
    assert.equal(r.data.monedaReserva, "COP");
    assert.equal(r.data.paxConSilla, 2);
    assert.equal(r.data.oferta63?.vinculada, true);
    assert.equal(r.data.oferta63?.empaquetadoId, EMPAQUETADO_ID);
    assert.equal(r.data.oferta63?.trm, 4000);
    assert.equal(r.data.oferta63?.tarifaParaEmpaquetar, R);
    assert.equal(r.data.oferta63?.feeInfante, F);
    assert.equal(r.data.oferta63?.monedaHotel, "USD", "el neto del hotel sigue en su moneda de origen: la CxP se debe en USD");
    for (const t of TABLAS_DE_CUPOS) assert.ok(!logSb.includes(t) && !logAdmin.includes(t), `no debe consultar ${t}`);
  });

  test("BNC · impuesto_tipo = tiquete: R × pax con silla (no el fijo)", async () => {
    const { r } = await cotizar(tablasAdmin());
    assert.equal(r.ok && r.data.impuestoTotal, 2 * R);
  });

  test("BNC · impuesto_tipo = fijo: el importe del paquete (COP) × pax con silla", async () => {
    const { r } = await cotizar(tablasAdmin({ paquete: { impuesto_tipo: "fijo", impuesto_fijo: 100_000 } }));
    assert.equal(r.ok && r.data.impuestoTotal, 200_000);
  });

  test("con un menor de 1 año: paga el precio de infante (130.500), no ocupa silla y NO genera BNC (R2: mismo conteo de la 226)", async () => {
    // Sin pasajeros nombrados (cotización preliminar): la validación de edades reales se hace al convertir.
    const { r } = await cotizar(tablasAdmin(), { edadesMenores: [1], cantidadMenores: 1, pasajeros: [] });
    assert.equal(r.ok, true, msg(r));
    if (!r.ok) return;
    assert.equal(r.data.precioVenta, 3_360_000 + 130_500);
    assert.equal(r.data.paxConSilla, 2);
    assert.equal(r.data.numMenoresDeDos, 1);
    assert.equal(r.data.impuestoTotal, 2 * R, "el menor de 2 años no ocupa silla ni genera BNC");
    assert.equal(r.data.lineasMenores[0]?.menorDeDos, true);
  });

  test("un servicio en USD aporta su moneda de origen (para la CxP) sin cambiar el precio del tarifario", async () => {
    const incluido = { paquete_id: PAQUETE_ID, servicio_id: 900, modo: "persona", incluido: true,
      servicios_adicionales: { nombre: "Tour", categoria: "tour_traslado", precio_persona: 10, precio_infante: 0, liquidacion: "paquete", proveedor_id: null } };
    const { r } = await cotizar(tablasAdmin({ servicios: [incluido] }));
    assert.equal(r.ok, true, msg(r));
    if (r.ok) assert.equal(r.data.oferta63?.monedaServicios[900], "USD");
  });
});

describe("computarReserva() · una vinculada que ya no es elegible se RECHAZA antes de leer precio", () => {
  const casos: [string, Parameters<typeof tablasAdmin>[0], RegExp][] = [
    ["la fuente ya tiene record (PNR)", { fuentes: [fuente({ record: "L93FYZ" })] }, /ya tiene record/i],
    ["la fuente fue desactivada", { fuentes: [fuente({ activo: false })] }, /desactivado/i],
    ["la ventana de compra de la fuente venció", { fuentes: [fuente({ compra_fin: AYER })] }, /vigencia de compra/i],
    ["la fuente ya no existe", { fuentes: [] }, /ya no existe/i],
    ["la copia de la salida quedó vieja (cambió la tarifa)", { fuentes: [fuente({ tarifa_para_empaquetar: 1_200_000 })] }, /cambi[oó]/i],
    ["la copia de la salida quedó vieja (cambió el fee de infante)", { fuentes: [fuente({ fee_infante: 90_000 })] }, /fee de infante/i],
    ["el destino de llegada ya no está permitido (#67/220)", { fuentes: [fuente({ destino_id: 2 })] }, /destinos a[eé]reos permitidos/i],
    ["el paquete salió del modo 63 teniendo una salida vinculada", { paquete: { modo_oferta: "legacy", trm_oferta: null } }, /modo con conversión por TRM/i],
    ["el modo 63 perdió su TRM (hay un hotel en USD)", { paquete: { trm_oferta: null } }, /Falta la TRM/i],
    ["la salida pertenece a otro paquete", { salidas: [salidaVinculada({ paquete_id: 99 })] }, /no pertenece/i],
  ];
  for (const [nombre, esc, patron] of casos) {
    test(nombre, async () => {
      const { r, logSb } = await cotizar(tablasAdmin(esc));
      assert.equal(r.ok, false, "debe rechazar");
      assert.match(msg(r), patron);
      assert.deepEqual(logSb, [], `no debe leer precio/hotel con la sesión tras rechazar; consultó: ${logSb.join(", ")}`);
    });
  }
  test("error de lectura de la fuente: rechaza con mensaje de negocio (nunca 'disponible' ni el texto crudo de Postgres)", async () => {
    const { r } = await cotizar(tablasAdmin(), {}, "empaquetados");
    assert.equal(r.ok, false);
    assert.doesNotMatch(msg(r), /permission denied|empaquetados/i);
  });
});

describe("computarReserva() · salida MANUAL", () => {
  test("de un paquete de siempre: sin oferta 63, BNC de siempre (impuesto fijo × pax)", async () => {
    const { r } = await cotizar(tablasAdmin({
      salidas: [salidaVinculada({ empaquetado_id: null, valor_tiquete: 400 })],
      paquete: { modo_oferta: "legacy", trm_oferta: null, impuesto_tipo: "tiquete" },
    }));
    assert.equal(r.ok, true, msg(r));
    if (r.ok) {
      assert.equal(r.data.oferta63 ?? null, null);
      // Comportamiento histórico: lee el impuesto fijo del paquete con la SESIÓN (100.000) × pax (2) e ignora impuesto_tipo.
      assert.equal(r.data.impuestoTotal, 200_000);
    }
  });
  test("de un paquete en modo 63: oferta con el tiquete y el fee ya en COP (USD × TRM, centavos exactos)", async () => {
    const { r } = await cotizar(tablasAdmin({
      salidas: [salidaVinculada({ empaquetado_id: null, moneda: "USD", valor_tiquete: 100, fee_infante: 25 })],
      paquete: { trm_oferta: 3987.65 },
    }));
    assert.equal(r.ok, true, msg(r));
    if (r.ok) {
      assert.equal(r.data.oferta63?.vinculada, false);
      assert.equal(r.data.oferta63?.tarifaParaEmpaquetar, 398_765);
      assert.equal(r.data.oferta63?.feeInfante, 99_691.25);
      assert.equal(r.data.impuestoTotal, 2 * 398_765, "tiquete manual en COP × pax con silla");
    }
  });
});

describe("computarReserva() · fila publicada antigua o desactualizada (migración 258): se rechaza ANTES de cotizar o numerar", () => {
  const incluido = { paquete_id: PAQUETE_ID, servicio_id: 900, modo: "persona", incluido: true,
    servicios_adicionales: { nombre: "Tour", categoria: "tour_traslado", precio_persona: 10, precio_infante: 0, liquidacion: "paquete", proveedor_id: null } };
  const SIN_VIGENCIA_EN_LA_FECHA = [{ servicio_id: 900, nombre: "VIG", fecha_inicio: "2000-01-01", fecha_fin: "2000-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: 10, precio_infante: 0, recargo_individual: null }];
  const REGENERA = /regenera el tarifario/i;

  test("fila ANTIGUA (sin evidencia) con servicio incluido: no hay cotización, contrato ni CxP", async () => {
    const { r, logSb, logAdmin } = await cotizar(tablasAdmin({ servicios: [incluido], evidencia: [] }));
    assert.equal(r.ok, false);
    assert.match(msg(r), REGENERA);
    assert.equal("data" in r, false, "no hay cotización que devolver");
    assert.ok([...logSb, ...logAdmin].every((l) => !/insert|upsert|rpc/i.test(l) || /select/i.test(l)), "ninguna escritura");
  });

  test("fila antigua con servicio incluido y la FECHA hoy DESCUBIERTA: la fila lo traía horneado, la composición viva lo omite → se rechaza (no se cobra su PVP viejo)", async () => {
    const { r } = await cotizar(tablasAdmin({ servicios: [incluido], vigencias: SIN_VIGENCIA_EN_LA_FECHA, evidencia: [{ paquete_id: PAQUETE_ID, fecha_ida: IDA, generacion: 3, regla: 1, servicios_incluidos: [900] }] }));
    assert.equal(r.ok, false);
    assert.match(msg(r), REGENERA);
    assert.match(msg(r), /ya no coinciden/);
  });

  test("evidencia de una generación ANTERIOR a la publicada: se rechaza", async () => {
    const { r } = await cotizar(tablasAdmin({ servicios: [incluido], evidencia: [{ paquete_id: PAQUETE_ID, fecha_ida: IDA, generacion: 2, regla: 1, servicios_incluidos: [900] }] }));
    assert.equal(r.ok, false);
    assert.match(msg(r), REGENERA);
  });

  test("evidencia con una regla de composición distinta de la vigente: se rechaza", async () => {
    const { r } = await cotizar(tablasAdmin({ servicios: [incluido], evidencia: [{ paquete_id: PAQUETE_ID, fecha_ida: IDA, generacion: 3, regla: 0, servicios_incluidos: [900] }] }));
    assert.equal(r.ok, false);
    assert.match(msg(r), REGENERA);
  });

  test("evidencia corrupta (ids que no son enteros): se rechaza", async () => {
    const { r } = await cotizar(tablasAdmin({ servicios: [incluido], evidencia: [{ paquete_id: PAQUETE_ID, fecha_ida: IDA, generacion: 3, regla: 1, servicios_incluidos: ["x"] }] }));
    assert.equal(r.ok, false);
    assert.match(msg(r), REGENERA);
  });

  test("fila REGENERADA con el servicio horneado y cubierto: se cotiza con ese servicio", async () => {
    const { r } = await cotizar(tablasAdmin({ servicios: [incluido] }));
    assert.equal(r.ok, true, msg(r));
    if (r.ok) assert.deepEqual(r.data.serviciosIncluidos.map((x) => x.servicioId), [900]);
  });

  test("fila REGENERADA en una fecha descubierta (el servicio se omitió al publicar): se cotiza SIN el servicio — sin PVP, costo ni CxP del servicio", async () => {
    const { r } = await cotizar(tablasAdmin({ servicios: [incluido], vigencias: SIN_VIGENCIA_EN_LA_FECHA, evidencia: [{ paquete_id: PAQUETE_ID, fecha_ida: IDA, generacion: 3, regla: 1, servicios_incluidos: [] }] }));
    assert.equal(r.ok, true, msg(r));
    if (r.ok) assert.deepEqual(r.data.serviciosIncluidos, []);
  });

  test("falta la tabla de evidencia (migración 258 sin aplicar): se rechaza con mensaje claro (no se vende lo que no se puede acreditar)", async () => {
    const { r } = await cotizar(tablasAdmin({ servicios: [incluido] }), {}, "tarifario_composicion_publicada");
    assert.equal(r.ok, false);
    assert.match(msg(r), /migración 258/);
  });

  test("paquete SIN servicios incluidos: no exige evidencia (el precio no depende de la composición)", async () => {
    const { r } = await cotizar(tablasAdmin({ evidencia: [] }));
    assert.equal(r.ok, true, msg(r));
  });
});

describe("computarReserva() · costo de un servicio incluido: nunca $0 por un cálculo fallido; el cero válido se conserva", () => {
  const incluido = { paquete_id: PAQUETE_ID, servicio_id: 900, modo: "persona", incluido: true,
    servicios_adicionales: { nombre: "Tour", categoria: "tour_traslado", precio_persona: 10, precio_infante: 0, liquidacion: "paquete", proveedor_id: null } };
  const vig = (precio: number, infante: unknown) => [{ servicio_id: 900, nombre: "VIG", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: precio, precio_infante: infante, recargo_individual: null }];

  // Antes: `costoNeto ?? 0`. Con un precio de infante no numérico (numeric 'NaN' en Postgres) el costo salía NaN → null → 0: PVP cobrado, costo y CxP $0, en una reserva SIN infantes.
  for (const [nombre, infante] of [["NaN (número)", Number.NaN], ["'NaN' (numeric de Postgres)", "NaN"], ["negativo", -5]] as [string, unknown][]) {
    test(`precio de infante ${nombre}: se rechaza ANTES de cotizar o numerar, con mensaje legible (no hay costo ni CxP $0)`, async () => {
      const { r } = await cotizar(tablasAdmin({ servicios: [incluido], vigencias: vig(10, infante) }));
      assert.equal(r.ok, false);
      assert.match(msg(r), /Tour/);
      assert.match(msg(r), /precio de infante no válido/);
      assert.equal("data" in r, false, "no queda cotización con el servicio a costo $0");
    });
  }

  test("el cero VÁLIDO se conserva: servicio gratuito (tarifa 0 y infante 0) → costo 0 como dato real, la reserva sale", async () => {
    const { r } = await cotizar(tablasAdmin({ servicios: [incluido], vigencias: vig(0, 0) }));
    assert.equal(r.ok, true, msg(r));
    if (r.ok) {
      assert.deepEqual(r.data.serviciosIncluidos.map((s) => [s.servicioId, s.costoNeto]), [[900, 0]]);
    }
  });

  test("infante con tarifa 0 (gratis) y adultos con tarifa: costo = adultos × tarifa (el infante gratuito no anula nada)", async () => {
    const { r } = await cotizar(tablasAdmin({ servicios: [incluido], vigencias: vig(10, 0) }));
    assert.equal(r.ok, true, msg(r));
    if (r.ok) assert.equal(r.data.serviciosIncluidos[0].costoNeto, 20);
  });

  test("defensa en profundidad: el código ya no convierte un costo null en 0", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../lib/reservar/computo.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /costoNeto:\s*costoNeto\s*\?\?\s*0/);
    assert.match(src, /if \(costoNeto == null\)/);
  });

  test("sin habitaciones (pax con silla 0, el otro camino a un costo null): se rechaza antes de llegar a los servicios", async () => {
    const { r } = await cotizar(tablasAdmin({ servicios: [incluido] }), { habitaciones: {} });
    assert.equal(r.ok, false);
    assert.match(msg(r), /al menos una habitación/);
  });
});
