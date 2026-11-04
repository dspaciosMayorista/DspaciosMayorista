import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { crearClienteFalso, type ClienteFalso, type FilaFalsa, type TablasFalsas } from "./support/fakeSupabase.ts";

// #90 — De punta a punta (computarReserva REAL + los helpers financieros REALES que usa el alta del contrato): hotel en USD y paquete publicado en COP con TRM.
// EBB/Long Stay sobre una salida PUBLICADA: PVP, neta, costo del contrato y CxP parten del MISMO importe (descontado en la moneda del hotel, a centavos, y luego convertido).
// Las netas y temporadas base (tarifa_hotel / hotel_temporadas) no se modifican: el descuento nunca se escribe ahí.

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

let adminActual: ClienteFalso = crearClienteFalso({});
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => adminActual } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => { throw new Error("createClient() no debe invocarse: sb se inyecta"); } } });

const { computarReserva } = await import("@/lib/reservar/computo.ts");
const { claveComposicion } = await import("@/lib/tarifario/composicionTarifario.ts");
const { camposCxP63, sumaEquivalentesOferta63 } = await import("@/lib/reservar/payloadFinanciero63.ts");

const fechaBogota = (d: number) => new Date(Date.now() + d * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const PAQUETE_ID = 70, HOTEL_ID = 217, SALIDA_ID = 11, EMPAQUETADO_ID = 5, CAT = "Estándar", REGIMEN = "PAE", TRM = 4000;
const R = 1_130_000, F = 80_500;
// Neta USD por persona y noche 100,55 → 3 noches = 301,65 USD; en COP a TRM 4000 = 1.206.600.
const NETO_USD_NOCHE = 100.55;
const REGLAS = [{ tipo: "ebb", umbral: 30, pct: 18, activa: true }, { tipo: "ebb", umbral: 60, pct: 23, activa: true }, { tipo: "ebb", umbral: 90, pct: 28, activa: true }, { tipo: "long_stay", umbral: 4, pct: 25, activa: true }];

function tablas(diasAnticipo: number, noches: number, reglas: FilaFalsa[] = REGLAS): TablasFalsas {
  const IDA = fechaBogota(diasAnticipo), REG = fechaBogota(diasAnticipo + noches);
  const netoUsd = Math.round(NETO_USD_NOCHE * noches * 100) / 100;
  const netoCop = netoUsd * TRM;
  const pvpBase = Math.ceil((netoCop / 0.8 + R) / 1000) * 1000; // publicado SIN descuento
  const clave = claveComposicion({ origen: "s", origenId: SALIDA_ID, hotelId: HOTEL_ID, categoria: CAT, regimen: REGIMEN, fechaIda: IDA, noches });
  const hotel = { id: HOTEL_ID, modelo_tarifario: "persona", nombre: "Hotel USD", moneda: "USD", edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12, pax_min: 1, pax_max: 4, nino_nota: null, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null, adults_only: false, pet_friendly: false };
  const paquete = { id: PAQUETE_ID, pct_mk: 0.2, impuesto_tipo: "tiquete", impuesto_fijo: 100_000, destino_id: 1, tipo: "dinamico", destinos_aereos_alternativos: false, modo_oferta: "cop_trm_63", trm_oferta: TRM, tarifario_generacion_publicada: 3, tarifario_revision_publicada: 5 };
  return {
    hoteles: [hotel],
    armado_paquetes: [paquete],
    tarifario_resultado_publicable: [{ paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID, categoria: CAT, regimen: REGIMEN, salida_id: SALIDA_ID, empaquetado_id: null, bloqueo_id: null, acomodacion: "doble", precio_pvp: pvpBase, precio_pvp_menor2: null, hotel_nombre: "Hotel USD", destino_nombre: "CARTAGENA", fecha_ida: IDA, fecha_regreso: REG, noches, moneda: "COP" }],
    tarifario_resultado_composicion: [{ paquete_id: PAQUETE_ID, generacion: 3, clave, composicion: {
      pctMk: 0.2, impuesto: 0, vuelo: R, vueloNeto: null, feeInfante: F, servicios: [], netos: { doble: netoCop }, netosOrigen: { doble: { monto: netoUsd, moneda: "USD" } }, trm: TRM,
      pvps: { doble: { pvp: pvpBase, pvpMenor2: null } }, fijo: { mayor2: false, menor2: false },
    } }],
    hotel_acomodaciones: [{ hotel_id: HOTEL_ID, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 }],
    salidas_dinamicas: [{ id: SALIDA_ID, paquete_id: PAQUETE_ID, empaquetado_id: EMPAQUETADO_ID, activo: true, compra_inicio: null, compra_fin: null, fecha_ida: IDA, fecha_regreso: REG, ruta: "BOG - CTG - BOG", aerolinea: "JetSMART", valor_tiquete: R, fee_infante: F, aplica_mk: false, ta: 0, moneda: "COP" }],
    empaquetados: [{ id: EMPAQUETADO_ID, activo: true, record: null, compra_inicio: null, compra_fin: null, fecha_ida: IDA, fecha_regreso: REG, ruta: "BOG - CTG - BOG", aerolinea: "JetSMART", destino_id: 1, moneda: "COP", tarifa_proveedor: 1_000_000, tarifa_para_empaquetar: R, fee_infante: F }],
    destinos: [{ id: 1, nombre: "CARTAGENA", codigo_iata: "CTG", pais: "Colombia", activo: true }],
    armado_paquete_destinos_aereos: [],
    hotel_temporadas: [{ id: 1, hotel_id: HOTEL_ID, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null }],
    tarifa_hotel: [{ id: 10, hotel_id: HOTEL_ID, tipo_habitacion: CAT, alimentacion: REGIMEN, temporada: "Base", neto_sencilla: null, neto_doble: NETO_USD_NOCHE, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: 10, nota_infante: null, notas: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null, precio_final_autoritativo: false }],
    hotel_reglas_descuento: reglas.map((r) => ({ hotel_id: HOTEL_ID, ...r })),
    armado_servicios: [], servicios_adicionales: [], servicio_temporadas: [], servicio_tarifa_pax: [],
    armado_hoteles: [{ paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID }], armado_vuelos: [], armado_empaquetados: [],
    tarifario_composicion_publicada: [{ paquete_id: PAQUETE_ID, fecha_ida: IDA, generacion: 3, regla: 1, servicios_incluidos: [] }],
  };
}
const sesion = (t: TablasFalsas): TablasFalsas => ({ hoteles: t.hoteles, armado_paquetes: t.armado_paquetes, tarifario_resultado_publicable: t.tarifario_resultado_publicable, hotel_acomodaciones: t.hotel_acomodaciones });

function conErrorEn(c: ClienteFalso, tabla: string): ClienteFalso {
  return { ...c, from(t: string) {
    if (t !== tabla) return c.from(t);
    const err = { message: "permission denied" };
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null, error: err });
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: err }).then(res, rej);
    return b as unknown as ReturnType<ClienteFalso["from"]>;
  } };
}
const input = () => ({
  paqueteId: PAQUETE_ID, bloqueoId: null, empaquetadoId: null, salidaId: SALIDA_ID, modulo: "dinamico" as const, hotelId: HOTEL_ID, categoria: CAT, regimen: REGIMEN,
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, cliente: { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", telefono: "300", email: "a@a.com" },
  tipoAsesor: "interno" as const, asesorInterno: "Asesor", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", aliadoId: null, plazo: "24 horas", servicios: [],
  pasajeros: [
    { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", fechaNacimiento: "1990-01-01", nacionalidad: "CO", esInfante: false },
    { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "456", fechaNacimiento: "1992-01-01", nacionalidad: "CO", esInfante: false },
  ],
});
async function cotizar(t: TablasFalsas, tablaConError?: string) {
  let ad = crearClienteFalso(t);
  if (tablaConError) ad = conErrorEn(ad, tablaConError);
  adminActual = ad;
  return computarReserva(crearClienteFalso(sesion(t)) as unknown as Parameters<typeof computarReserva>[0], input());
}

describe("hotel USD + paquete publicado COP con TRM: EBB 18 % (30 días, 3 noches)", () => {
  test("PVP, neta, costo del contrato y CxP parten del mismo importe descontado", async () => {
    const t = tablas(30, 3);
    const baseAntes = JSON.stringify([t.tarifa_hotel, t.hotel_temporadas]);
    const r = await cotizar(t);
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    if (!r.ok) return;
    // Neta por persona: 301,65 USD × 0,82 = 247,353 → 247,35 USD (centavos del hotel), nunca 989.412 COP descontando la neta ya convertida.
    assert.equal(r.data.netoPorAcom.doble, 247.35);
    // PVP por persona: 247,35 × 4000 = 989.400 COP → /0,8 = 1.236.750 + R 1.130.000 = 2.366.750 → 2.367.000 (techo al mil). 2 pax.
    assert.equal(r.data.pvpPorAcom.doble, 2_367_000);
    assert.equal(r.data.precioVenta, 4_734_000);
    // La composición del contrato usa la MISMA neta que el costo: 989.400 COP = 247,35 USD × 4000.
    const hotelComp = r.data.composicion?.lineas[0]?.componentes?.find((c) => c.tipo === "hotel");
    assert.equal(hotelComp?.neto, 989_400);
    assert.equal(hotelComp?.venta, 1_236_750);
    // Costo del contrato y CxP (mismos helpers que el alta): 2 pax × 247,35 = 494,70 USD; equivalente COP a TRM 4000 = 1.978.800 = 2 × 989.400.
    const costoUsd = r.data.lineasHab.reduce((s, l) => s + r.data.netoPorAcom[l.acom] * l.pax, 0);
    assert.equal(Math.round(costoUsd * 100) / 100, 494.7);
    const cxp = camposCxP63({ valor: costoUsd, moneda: r.data.oferta63!.monedaHotel }, r.data.oferta63!.trm);
    assert.deepEqual(cxp, { moneda: "USD", valor_cop: 1_978_800, trm: TRM });
    assert.equal(sumaEquivalentesOferta63([{ valor: costoUsd, moneda: "USD" }], "COP", TRM), 1_978_800, "costo_hotel del contrato == equivalente de la CxP");
    assert.equal(cxp.valor_cop, 2 * (hotelComp?.neto ?? 0), "CxP == neta que respalda el PVP");
    assert.equal(JSON.stringify([t.tarifa_hotel, t.hotel_temporadas]), baseAntes, "netas y temporadas originales intactas");
  });

  test("29 días: sin descuento, el publicado queda tal cual y la neta es la base (301,65 USD)", async () => {
    const r = await cotizar(tablas(29, 3));
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    if (!r.ok) return;
    assert.equal(r.data.netoPorAcom.doble, 301.65);
    assert.equal(r.data.pvpPorAcom.doble, 2_639_000);
  });

  test("4 noches y 10 días de anticipo: Long Stay 25 % (sin EBB) sobre 402,20 USD → 301,65 USD", async () => {
    const r = await cotizar(tablas(10, 4));
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    if (!r.ok) return;
    assert.equal(r.data.netoPorAcom.doble, 301.65);
    assert.equal(r.data.pvpPorAcom.doble, Math.ceil((301.65 * TRM / 0.8 + R) / 1000) * 1000);
  });

  test("90 días y 4 noches: gana el 28 % de EBB, no el 25 % de Long Stay ni la suma", async () => {
    const r = await cotizar(tablas(90, 4));
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    if (r.ok) assert.equal(r.data.netoPorAcom.doble, 289.58); // 402,20 × 0,72 = 289,584
  });
});

describe("falla cerrado: nunca se continúa a precio base", () => {
  test("no se pueden consultar las reglas (error de lectura)", async () => {
    const r = await cotizar(tablas(30, 3), "hotel_reglas_descuento");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /promociones del hotel/);
  });
  test("falta la clave de servicio", async () => {
    const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const r = await cotizar(tablas(30, 3));
      assert.equal(r.ok, false);
    } finally { process.env.SUPABASE_SERVICE_ROLE_KEY = k; }
  });
  test("la tabla de reglas no existe (42P01 / PGRST205, migración 278 sin aplicar): el cargador devuelve error, no «sin reglas»", async () => {
    const { cargarReglasDescuentoHotel } = await import("@/lib/reservar/reglasDescuentoHotel.ts");
    for (const code of ["42P01", "PGRST205"]) {
      const falso = { from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: null, error: { code, message: "relation does not exist" } }) }) }) }) };
      assert.equal((await cargarReglasDescuentoHotel(falso, HOTEL_ID)).ok, false, code);
    }
  });
  test("hay descuento aplicable pero la composición publicada no existe: se rechaza", async () => {
    const t = tablas(30, 3); t.tarifario_resultado_composicion = [];
    const r = await cotizar(t);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /regenera el tarifario/);
  });
  test("sin reglas cargadas para el hotel: precio publicado intacto", async () => {
    const r = await cotizar(tablas(30, 3, []));
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    if (r.ok) assert.equal(r.data.pvpPorAcom.doble, 2_639_000);
  });
});
