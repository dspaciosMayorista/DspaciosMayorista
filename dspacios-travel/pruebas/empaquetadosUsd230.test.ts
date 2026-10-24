import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// #90 / migración 230 — generarTarifario() REAL (la Server Action) con un Empaquetado y su salida vinculada en USD:
//   · el tiquete R (415 USD) y el fee F (45 USD) se convierten × TRM del paquete UNA sola vez, sin markup ni TA, y el
//     tarifario se publica en COP por el envoltorio de la 227;
//   · una fuente en COP con el equivalente exacto da EXACTAMENTE los mismos precios (equivalencia COP/USD);
//   · una salida cuya moneda no coincide con la de su fuente NO se publica;
//   · fuera del modo 63 (Bloqueo/Porción) un Empaquetado en USD en un paquete en COP NO se genera (regla D8).
// El SQL (CHECK, triggers, aceptación) se prueba en Postgres: supabase/scripts/test_230_empaquetados_usd.sql.

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

let sbServidor: unknown = null;
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => { throw new Error("generarTarifario no debe usar service-role"); } } });
mock.module("@/lib/supabase/server", {
  namedExports: { createClient: async () => { if (sbServidor == null) throw new Error("createClient() sin cliente"); return sbServidor; } },
});
register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, n) {
     if (s === "next/cache") return { url: "data:text/javascript,export const revalidatePath=()=>{};export const revalidateTag=()=>{};", shortCircuit: true };
     return n(s, c);
   }`
));

const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");

function fechaBogota(offsetDias: number): string {
  return new Date(Date.now() + offsetDias * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
const IDA = fechaBogota(30);
const REG = fechaBogota(31); // 1 noche: el neto por noche ES el neto de la estadía

const PAQUETE_ID = 70;
const HOTEL_ID = 217;
const SALIDA_ID = 11;
const EMPAQUETADO_ID = 5;
const CAT = "Estándar";
const REG_ALIM = "PAE";
const R = 1_130_000;
const F = 80_500;

type Fila = Record<string, unknown>;
type Rpc = { nombre: string; args: Record<string, unknown> };

function clienteGenerar(tablas: Record<string, Fila[]>) {
  const rpcs: Rpc[] = [];
  const consultadas: string[] = [];
  function from(tabla: string) {
    consultadas.push(tabla);
    const filtros: ((r: Fila) => boolean)[] = [];
    let uno = false;
    const b: Record<string, unknown> = {};
    b.select = () => b; b.order = () => b; b.range = () => b; b.not = () => b;
    b.eq = (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return b; };
    b.in = (c: string, v: unknown[]) => { filtros.push((r) => v.includes(r[c])); return b; };
    b.single = () => { uno = true; return b; };
    b.maybeSingle = () => { uno = true; return b; };
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (tablas[tabla] === undefined) throw new Error(`fixture sin la tabla "${tabla}"`);
      const filas = tablas[tabla].filter((r) => filtros.every((f) => f(r)));
      return Promise.resolve({ data: uno ? (filas[0] ?? null) : filas, error: null }).then(res, rej);
    };
    return b;
  }
  async function rpc(nombre: string, args: Record<string, unknown>) {
    rpcs.push({ nombre, args });
    if (nombre === "iniciar_generacion_tarifario") return { data: [{ generacion: 3, revision_capturada: 5 }], error: null };
    if (nombre === "publicar_tarifario_resultado" || nombre === "publicar_tarifario_resultado_63") return { data: true, error: null };
    return { data: null, error: null };
  }
  return { sb: { from, rpc }, rpcs, consultadas };
}

function salidaVinculada(o: Fila = {}): Fila {
  return {
    id: SALIDA_ID, paquete_id: PAQUETE_ID, empaquetado_id: EMPAQUETADO_ID, activo: true, compra_inicio: null, compra_fin: null,
    fecha_ida: IDA, fecha_regreso: REG, ruta: "BOG - CTG - BOG", aerolinea: "JetSMART", valor_tiquete: R, fee_infante: F,
    aplica_mk: false, ta: 0, moneda: "COP", ...o,
  };
}
function fuente(o: Fila = {}): Fila {
  return {
    id: EMPAQUETADO_ID, activo: true, record: null, compra_inicio: null, compra_fin: null, fecha_ida: IDA, fecha_regreso: REG,
    ruta: "BOG - CTG - BOG", aerolinea: "JetSMART", destino_id: 1, moneda: "COP", tarifa_proveedor: 1_000_000,
    tarifa_para_empaquetar: R, fee_infante: F, ...o,
  };
}

type Opciones = {
  paquete?: Fila; hotelMoneda?: string; netoAdulto?: number; netoInfante?: number | null;
  servicios?: Fila[]; salidas: Fila[]; fuentes?: Fila[];
};
function tablas(o: Opciones): Record<string, Fila[]> {
  return {
    armado_paquetes: [{
      id: PAQUETE_ID, nombre: "Dinámico Cartagena", activo: true, destino_id: 1, pct_mk: 0.2, tipo: "dinamico", impuesto_tipo: "tiquete",
      impuesto_fijo: 100_000, noches: 1, destinos: { nombre: "CARTAGENA" }, destinos_aereos_alternativos: false,
      modo_oferta: "cop_trm_63", trm_oferta: 4000, ...(o.paquete ?? {}),
    }],
    armado_vuelos: [], armado_empaquetados: [],
    armado_servicios: o.servicios ?? [],
    armado_hoteles: [{
      paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID, categorias: null, regimenes: null,
      hoteles: { nombre: "Hotel Dinámico", moneda: o.hotelMoneda ?? "USD", modelo_tarifario: "persona", adults_only: false },
    }],
    hotel_temporadas: [{
      hotel_id: HOTEL_ID, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null,
      tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, regimen_restringido: null,
    }],
    tarifa_hotel: [{
      hotel_id: HOTEL_ID, tipo_habitacion: CAT, alimentacion: REG_ALIM, temporada: "Base",
      neto_sencilla: null, neto_doble: o.netoAdulto ?? 100, neto_triple: null, neto_multiple: null,
      neto_nino: null, neto_nino2: null, neto_infante: o.netoInfante === undefined ? 10 : o.netoInfante, precio_final_autoritativo: false,
    }],
    salidas_dinamicas: o.salidas,
    empaquetados: o.fuentes ?? [fuente()],
    destinos: [{ id: 1, nombre: "CARTAGENA", codigo_iata: "CTG", pais: "Colombia", activo: true }],
    armado_paquete_destinos_aereos: [],
    servicio_tarifa_pax: [],
  };
}

async function generar(o: Opciones) {
  const c = clienteGenerar(tablas(o));
  sbServidor = c.sb;
  const prev = console.error;
  console.error = () => {};
  try {
    const r = await generarTarifario(PAQUETE_ID);
    const pub = c.rpcs.find((x) => x.nombre === "publicar_tarifario_resultado_63" || x.nombre === "publicar_tarifario_resultado");
    const filas = (pub?.args.p_filas ?? []) as { salida_id: number | null; modulo: string; acomodacion: string; precio_pvp: number; precio_pvp_menor2: number | null; impuesto: number; base_comisionable: number; moneda: string }[];
    return { r, pub, filas, rpcs: c.rpcs };
  } finally {
    console.error = prev;
    sbServidor = null;
  }
}
const fila = (filas: Awaited<ReturnType<typeof generar>>["filas"], acom: string, salidaId = SALIDA_ID) =>
  filas.find((f) => f.salida_id === salidaId && f.acomodacion === acom);


const R_USD = 415;
const F_USD = 45;
const TRM = 3200;
const servicioUsd = (): Fila => ({
  paquete_id: PAQUETE_ID, servicio_id: 901, modo: "persona", incluido: true,
  servicios_adicionales: { nombre: "Tour", precio_persona: 10, precio_infante: 0, liquidacion: "paquete", descripcion: null, recargo_individual: null, moneda: "USD" },
});
void servicioUsd;
const fuenteUsd = (o: Fila = {}) => fuente({ moneda: "USD", tarifa_proveedor: 380, tarifa_para_empaquetar: R_USD, fee_infante: F_USD, ...o });
const salidaUsd = (o: Fila = {}) => salidaVinculada({ moneda: "USD", valor_tiquete: R_USD, fee_infante: F_USD, ...o });

describe("generarTarifario() REAL · vinculada a un Empaquetado en USD (modo cop_trm_63)", () => {
  test("415 USD × TRM 3.200 = 1.328.000 entran UNA vez al PVP: doble = hotel 400.000 + 1.328.000 = 1.728.000, publicado en COP", async () => {
    const g = await generar({ salidas: [salidaUsd()], fuentes: [fuenteUsd()], paquete: { trm_oferta: TRM } });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.pub?.nombre, "publicar_tarifario_resultado_63");
    assert.equal(g.pub?.args.p_moneda, "COP");
    assert.equal(g.pub?.args.p_trm, TRM);
    // hotel 100 USD × 3.200 = 320.000 / 0,8 = 400.000; R = 1.328.000 sin markup ni TA.
    assert.equal(fila(g.filas, "doble")?.precio_pvp, 1_728_000);
    assert.ok(g.filas.filter((f) => f.salida_id === SALIDA_ID).every((f) => f.moneda === "COP"), "nada queda en USD en el tarifario");
  });

  test("el fee de infante 45 USD se convierte exacto (144.000) y se suma sin markup; el niño de 2 años paga R convertido", async () => {
    const g = await generar({ salidas: [salidaUsd()], fuentes: [fuenteUsd()], paquete: { trm_oferta: TRM } });
    // infante hotel 10 USD × 3.200 = 32.000 / 0,8 = 40.000 (sin servicios) → menor de 2 = 40.000 + F 144.000
    assert.equal(fila(g.filas, "infante")?.precio_pvp_menor2, 184_000);
    assert.equal(fila(g.filas, "infante")?.precio_pvp, 40_000 + 1_328_000);
  });

  test("el impuesto por persona con impuesto_tipo = tiquete es R convertido (1.328.000) y la base es PVP − R", async () => {
    const g = await generar({ salidas: [salidaUsd()], fuentes: [fuenteUsd()], paquete: { trm_oferta: TRM } });
    const doble = fila(g.filas, "doble");
    assert.equal(doble?.impuesto, 1_328_000);
    assert.equal(doble?.base_comisionable, 1_728_000 - 1_328_000);
  });

  test("equivalencia: una fuente en COP con 1.328.000 y fee 144.000 publica EXACTAMENTE los mismos precios", async () => {
    const usd = await generar({ salidas: [salidaUsd()], fuentes: [fuenteUsd()], paquete: { trm_oferta: TRM } });
    const cop = await generar({
      salidas: [salidaVinculada({ valor_tiquete: 1_328_000, fee_infante: 144_000 })],
      fuentes: [fuente({ tarifa_para_empaquetar: 1_328_000, fee_infante: 144_000 })],
      paquete: { trm_oferta: TRM },
    });
    for (const acom of ["doble", "infante"]) {
      assert.equal(fila(usd.filas, acom)?.precio_pvp, fila(cop.filas, acom)?.precio_pvp, acom);
      assert.equal(fila(usd.filas, acom)?.precio_pvp_menor2, fila(cop.filas, acom)?.precio_pvp_menor2, acom + " menor 2");
    }
  });

  test("cambiar la TRM cambia el precio del tiquete USD: 3.500 → R = 1.452.500", async () => {
    const g = await generar({ salidas: [salidaUsd()], fuentes: [fuenteUsd()], paquete: { trm_oferta: 3500 } });
    // hotel 350.000 / 0,8 = 437.500 + 1.452.500 = 1.890.000
    assert.equal(fila(g.filas, "doble")?.precio_pvp, 1_890_000);
  });

  test("la salida en COP con la fuente en USD (moneda distinta) NO se publica: se pide actualizarla desde la fuente", async () => {
    const g = await generar({ salidas: [salidaVinculada({ valor_tiquete: R_USD, fee_infante: F_USD, moneda: "COP" })], fuentes: [fuenteUsd()], paquete: { trm_oferta: TRM } });
    assert.equal(g.r.ok, false);
    if (!g.r.ok) assert.match(g.r.error, /moneda|Actualiza la salida/i);
    assert.equal(g.pub, undefined);
  });

  test("una fuente con moneda inválida (EUR) se rechaza", async () => {
    const g = await generar({ salidas: [salidaUsd()], fuentes: [fuenteUsd({ moneda: "EUR" })], paquete: { trm_oferta: TRM } });
    assert.equal(g.r.ok, false);
    if (!g.r.ok) assert.match(g.r.error, /moneda v[aá]lida/i);
    assert.equal(g.pub, undefined);
  });
});

describe("generarTarifario() REAL · Empaquetado en Bloqueo/Porción (fuera del modo 63): regla D8, no mezclar monedas", () => {
  function tablasBloqueo(monedaVuelo: string, monedaHotel: string): Record<string, Fila[]> {
    const t = tablas({ salidas: [], hotelMoneda: monedaHotel, paquete: { tipo: "bloqueo", modo_oferta: "legacy", trm_oferta: null, impuesto_tipo: "fijo", impuesto_fijo: 0 } });
    t.armado_empaquetados = [{
      paquete_id: PAQUETE_ID, empaquetado_id: EMPAQUETADO_ID, aplica_mk: true, ta: 0,
      empaquetados: { id: EMPAQUETADO_ID, record: null, ruta: "MDE - SDQ - MDE", fecha_ida: IDA, fecha_regreso: REG, tarifa_para_empaquetar: R_USD, fee_infante: F_USD, moneda: monedaVuelo, activo: true, compra_inicio: null, compra_fin: null },
    }];
    return t;
  }
  async function generarBloqueo(monedaVuelo: string, monedaHotel: string) {
    const c = clienteGenerar(tablasBloqueo(monedaVuelo, monedaHotel));
    sbServidor = c.sb;
    const prev = console.error;
    console.error = () => {};
    try {
      const r = await generarTarifario(PAQUETE_ID);
      return { r, pub: c.rpcs.find((x) => x.nombre === "publicar_tarifario_resultado") };
    } finally {
      console.error = prev;
      sbServidor = null;
    }
  }

  test("vuelo en USD y hotel en COP: NO se genera y el mensaje dice las dos monedas", async () => {
    const g = await generarBloqueo("USD", "COP");
    assert.equal(g.r.ok, false);
    if (!g.r.ok) assert.match(g.r.error, /USD.*COP|una sola moneda/i);
    assert.equal(g.pub, undefined, "no publica nada");
  });

  test("vuelo en COP y hotel en USD: NO se genera", async () => {
    const g = await generarBloqueo("COP", "USD");
    assert.equal(g.r.ok, false);
    assert.equal(g.pub, undefined);
  });

  test("vuelo en USD y hotel en USD: se genera en USD (mismo comportamiento de siempre)", async () => {
    const g = await generarBloqueo("USD", "USD");
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.pub?.args.p_moneda, "USD");
  });
});
