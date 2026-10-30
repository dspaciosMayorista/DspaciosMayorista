import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// #90 · #63 (234) — generarTarifario() REAL (la Server Action, no una copia) para un Dinámico en modo `cop_trm_63` PUBLICADO EN USD:
//   · USD→USD: el vuelo de Empaquetados (R, F) y los netos en USD entran SIN conversión (la TRM no mueve el precio);
//   · COP→USD: lo que esté en COP (vuelo, hotel, servicio, salida manual) se convierte COP / TRM UNA vez, antes del markup;
//   · USD→COP: el modo de siempre (USD × TRM), sin cambios;
//   · R sin markup ni TA, F exacto al menor de 2 años; publicación por el envoltorio de la 227/234 con p_moneda = la elegida y su TRM;
//   · publicar en USD sin TRM no publica (aunque todo esté en USD); una vinculada inelegible no se publica;
//   · un modo 63 sin moneda elegida (anteriores a la 233) sigue publicando en COP.
// El SQL (envoltorio, CHECK, triggers) se prueba en Postgres: supabase/scripts/test_234_oferta_usd.sql.

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

type Fila = Record<string, unknown>;
type Rpc = { nombre: string; args: Record<string, unknown> };

// Vuelo: USD → N 250 / R 290 / F 20 ; COP → N 1.000.000 / R 1.130.000 / F 80.500.
const VUELO = { USD: { N: 250, R: 290, F: 20 }, COP: { N: 1_000_000, R: 1_130_000, F: 80_500 } } as const;

function clienteGenerar(tablas: Record<string, Fila[]>) {
  const rpcs: Rpc[] = [];
  function from(tabla: string) {
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
  return { sb: { from, rpc }, rpcs };
}

function salidaVinculada(vuelo: "COP" | "USD", o: Fila = {}): Fila {
  const v = VUELO[vuelo];
  return {
    id: SALIDA_ID, paquete_id: PAQUETE_ID, empaquetado_id: EMPAQUETADO_ID, activo: true, compra_inicio: null, compra_fin: null,
    fecha_ida: IDA, fecha_regreso: REG, ruta: "BOG - CTG - BOG", aerolinea: "JetSMART", valor_tiquete: v.R, fee_infante: v.F,
    aplica_mk: false, ta: 0, moneda: vuelo, ...o,
  };
}
function salidaManual(o: Fila = {}): Fila {
  return {
    id: 12, paquete_id: PAQUETE_ID, empaquetado_id: null, activo: true, compra_inicio: null, compra_fin: null,
    fecha_ida: IDA, fecha_regreso: REG, ruta: "MDE - MIA - MDE", aerolinea: "Avianca", valor_tiquete: 0, fee_infante: 0,
    aplica_mk: false, ta: 0, moneda: "COP", ...o,
  };
}
function fuente(vuelo: "COP" | "USD", o: Fila = {}): Fila {
  const v = VUELO[vuelo];
  return {
    id: EMPAQUETADO_ID, activo: true, record: null, compra_inicio: null, compra_fin: null, fecha_ida: IDA, fecha_regreso: REG,
    ruta: "BOG - CTG - BOG", aerolinea: "JetSMART", destino_id: 1, moneda: vuelo, tarifa_proveedor: v.N,
    tarifa_para_empaquetar: v.R, fee_infante: v.F, ...o,
  };
}

type Opciones = {
  paquete?: Fila; hotelMoneda?: "COP" | "USD"; netoAdulto?: number; netoInfante?: number | null;
  servicios?: Fila[]; salidas: Fila[]; fuentes?: Fila[];
};
function tablas(o: Opciones): Record<string, Fila[]> {
  const hotelMoneda = o.hotelMoneda ?? "USD";
  return {
    armado_paquetes: [{
      id: PAQUETE_ID, nombre: "Dinámico Cartagena", activo: true, destino_id: 1, pct_mk: 0.2, tipo: "dinamico", impuesto_tipo: "tiquete",
      impuesto_fijo: 0, noches: 1, destinos: { nombre: "CARTAGENA" }, destinos_aereos_alternativos: false,
      modo_oferta: "cop_trm_63", trm_oferta: 4000, moneda_publicacion: "USD", ...(o.paquete ?? {}),
    }],
    armado_vuelos: [], armado_empaquetados: [],
    armado_servicios: o.servicios ?? [],
    armado_hoteles: [{
      paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID, categorias: null, regimenes: null,
      hoteles: { nombre: "Hotel Dinámico", moneda: hotelMoneda, modelo_tarifario: "persona", adults_only: false },
    }],
    hoteles: [{ id: HOTEL_ID, nombre: "Hotel Dinámico", moneda: hotelMoneda, modelo_tarifario: "persona" }],
    servicios_adicionales: (o.servicios ?? []).map((s) => ({
      id: s.servicio_id, nombre: (s.servicios_adicionales as Fila).nombre, moneda: (s.servicios_adicionales as Fila).moneda,
    })),
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
    empaquetados: o.fuentes ?? [fuente("USD")],
    destinos: [{ id: 1, nombre: "CARTAGENA", codigo_iata: "CTG", pais: "Colombia", activo: true }],
    armado_paquete_destinos_aereos: [],
    servicio_tarifa_pax: [],
  };
}

type FilaPub = { salida_id: number | null; modulo: string; acomodacion: string; precio_pvp: number; precio_pvp_menor2: number | null; impuesto: number; base_comisionable: number; moneda: string };
async function generar(o: Opciones) {
  const c = clienteGenerar(tablas(o));
  sbServidor = c.sb;
  const prev = console.error;
  console.error = () => {};
  try {
    const r = await generarTarifario(PAQUETE_ID);
    const pub = c.rpcs.find((x) => x.nombre === "publicar_tarifario_resultado_63" || x.nombre === "publicar_tarifario_resultado");
    const filas = (pub?.args.p_filas ?? []) as FilaPub[];
    return { r, pub, filas, rpcs: c.rpcs };
  } finally {
    console.error = prev;
    sbServidor = null;
  }
}
const fila = (filas: FilaPub[], acom: string, salidaId = SALIDA_ID) => filas.find((f) => f.salida_id === salidaId && f.acomodacion === acom);
const tourUsd = (precioPersona: number, precioInfante: number | null): Fila => ({
  paquete_id: PAQUETE_ID, servicio_id: 900, modo: "persona", incluido: true,
  servicios_adicionales: { nombre: "Tour", precio_persona: precioPersona, precio_infante: precioInfante, liquidacion: "paquete", descripcion: null, recargo_individual: null, moneda: "USD" },
});
const tourCop = (precioPersona: number, precioInfante: number | null): Fila => ({
  paquete_id: PAQUETE_ID, servicio_id: 901, modo: "persona", incluido: true,
  servicios_adicionales: { nombre: "Tour COP", precio_persona: precioPersona, precio_infante: precioInfante, liquidacion: "paquete", descripcion: null, recargo_individual: null, moneda: "COP" },
});

describe("generarTarifario() REAL · modo cop_trm_63 PUBLICADO EN USD", () => {
  test("USD→USD: R 290 entra exacto (sin conversión): adulto 428, niño de 2 años 315, menor de 2 años 13 + F 20 = 33; publicado en USD con la TRM", async () => {
    const g = await generar({ salidas: [salidaVinculada("USD")], servicios: [tourUsd(10, 0)] });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.pub?.nombre, "publicar_tarifario_resultado_63");
    assert.equal(g.pub?.args.p_moneda, "USD");
    assert.equal(g.pub?.args.p_modo, "cop_trm_63");
    assert.equal(g.pub?.args.p_trm, 4000, "la TRM va aunque todo esté en USD: se congela en la oferta para el equivalente contable");
    // 100/0,8 = 125 + tour 10/0,8 = 12,5 + R 290 = 427,5 → techo al dólar
    assert.equal(fila(g.filas, "doble")?.precio_pvp, 428);
    assert.equal(fila(g.filas, "infante")?.precio_pvp, 315, "hotel infante 12,5 + tour adulto 12,5 + R 290");
    assert.equal(fila(g.filas, "infante")?.precio_pvp_menor2, 33, "hotel 12,5 + tour de infante gratis → techo 13, más F 20 exacto");
    assert.ok(g.filas.filter((f) => f.salida_id === SALIDA_ID).every((f) => f.moneda === "USD" && f.modulo === "dinamico"));
  });

  test("USD→USD: el impuesto por persona es R (290) y la base comisionable PVP − R, sin ninguna conversión", async () => {
    const g = await generar({ salidas: [salidaVinculada("USD")], servicios: [tourUsd(10, 0)] });
    const doble = fila(g.filas, "doble");
    assert.equal(doble?.impuesto, 290);
    assert.equal(doble?.base_comisionable, 428 - 290);
  });

  test("USD→USD: cambiar la TRM NO mueve el precio (nada se convierte); sí viaja a la publicación", async () => {
    const a = await generar({ salidas: [salidaVinculada("USD")], servicios: [tourUsd(10, 0)], paquete: { trm_oferta: 4000 } });
    const b = await generar({ salidas: [salidaVinculada("USD")], servicios: [tourUsd(10, 0)], paquete: { trm_oferta: 5321.5 } });
    assert.equal(fila(a.filas, "doble")?.precio_pvp, fila(b.filas, "doble")?.precio_pvp);
    assert.equal(fila(a.filas, "infante")?.precio_pvp_menor2, fila(b.filas, "infante")?.precio_pvp_menor2);
    assert.equal(b.pub?.args.p_trm, 5321.5);
  });

  test("COP→USD: el vuelo en COP se expresa COP / TRM: R 1.130.000 → 282,5; adulto 420; F 80.500 → 20,13 exacto con centavos", async () => {
    const g = await generar({ salidas: [salidaVinculada("COP")], fuentes: [fuente("COP")], servicios: [tourUsd(10, 0)] });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.pub?.args.p_moneda, "USD");
    assert.equal(fila(g.filas, "doble")?.precio_pvp, 420, "125 + 12,5 + 282,5");
    assert.equal(fila(g.filas, "infante")?.precio_pvp_menor2, 33.13, "13 + (80.500 / 4.000 = 20,125 → 20,13)");
    // La fila publicada redondea el impuesto al entero de la moneda (convención de componerTarifa); el BNC EXACTO del contrato (282,5 × pax) se prueba de punta a punta.
    assert.equal(fila(g.filas, "doble")?.impuesto, 283);
  });

  test("COP→USD: cambiar la TRM SÍ mueve el precio (R / TRM): TRM 5.000 → R 226 → adulto 364", async () => {
    const g = await generar({ salidas: [salidaVinculada("COP")], fuentes: [fuente("COP")], servicios: [tourUsd(10, 0)], paquete: { trm_oferta: 5000 } });
    assert.equal(fila(g.filas, "doble")?.precio_pvp, 364, "125 + 12,5 + 226 = 363,5 → 364");
  });

  test("hotel y servicio en COP en un paquete USD: también se convierten COP / TRM (hotel 400.000 → 100 USD; tour 40.000 → 10 USD)", async () => {
    const g = await generar({ salidas: [salidaVinculada("USD")], hotelMoneda: "COP", netoAdulto: 400_000, netoInfante: 40_000, servicios: [tourCop(40_000, 0)] });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(fila(g.filas, "doble")?.precio_pvp, 428, "mismo resultado que con hotel y tour en USD");
    assert.equal(fila(g.filas, "infante")?.precio_pvp_menor2, 33);
  });

  test("USD→COP (el modo de siempre) sigue igual: adulto 1.710.000, F 20 × 4.000 = 80.000, publicado en COP", async () => {
    const g = await generar({ salidas: [salidaVinculada("USD")], servicios: [tourUsd(10, 0)], paquete: { moneda_publicacion: "COP" } });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.pub?.args.p_moneda, "COP");
    assert.equal(fila(g.filas, "doble")?.precio_pvp, 1_710_000, "500.000 + 50.000 + 290 × 4.000");
    assert.equal(fila(g.filas, "infante")?.precio_pvp_menor2, 130_000, "hotel 50.000 + F 80.000");
    assert.equal(fila(g.filas, "doble")?.impuesto, 1_160_000);
  });

  test("modo 63 sin moneda elegida (anterior a la 233) sigue publicando en COP", async () => {
    const g = await generar({ salidas: [salidaVinculada("COP")], fuentes: [fuente("COP")], hotelMoneda: "COP", netoAdulto: 413_700, netoInfante: 20_000, paquete: { moneda_publicacion: null, trm_oferta: null } });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.pub?.args.p_moneda, "COP");
    assert.equal(g.pub?.args.p_trm, null);
    assert.equal(fila(g.filas, "doble")?.precio_pvp, 1_648_000);
  });

  test("una salida MANUAL en COP en un paquete USD: tiquete 1.000.000 + TA 100.000 → 250 + 25 USD; fee 80.000 → 20", async () => {
    const g = await generar({
      salidas: [salidaManual({ id: 12, valor_tiquete: 1_000_000, ta: 100_000, fee_infante: 80_000, aplica_mk: false, moneda: "COP" })],
      fuentes: [], servicios: [tourUsd(10, 0)],
    });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(fila(g.filas, "doble", 12)?.precio_pvp, 413, "125 + 12,5 + 275 = 412,5 → 413");
    assert.equal(fila(g.filas, "infante", 12)?.precio_pvp_menor2, 33);
  });

  test("USD con TODAS las fuentes en USD y SIN TRM publica igual (sin TRM, precio idéntico): la provisional se congela al contratar", async () => {
    const con = await generar({ salidas: [salidaVinculada("USD")], servicios: [tourUsd(10, 0)] });
    for (const trm of [null, 0, -4000]) {
      const g = await generar({ salidas: [salidaVinculada("USD")], servicios: [tourUsd(10, 0)], paquete: { trm_oferta: trm } });
      assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
      assert.equal(g.pub?.args.p_moneda, "USD");
      assert.equal(g.pub?.args.p_trm, null, "no viaja ninguna TRM (nunca 1)");
      assert.equal(fila(g.filas, "doble")?.precio_pvp, fila(con.filas, "doble")?.precio_pvp);
      assert.equal(fila(g.filas, "infante")?.precio_pvp_menor2, 33);
    }
  });

  test("USD con una fuente en COP y SIN TRM válida NO publica (hay que convertir): vuelo, hotel o servicio en COP", async () => {
    const casos: Opciones[] = [
      { salidas: [salidaVinculada("COP")], fuentes: [fuente("COP")], servicios: [tourUsd(10, 0)] },
      { salidas: [salidaVinculada("USD")], hotelMoneda: "COP", netoAdulto: 400_000, netoInfante: 40_000, servicios: [tourUsd(10, 0)] },
      { salidas: [salidaVinculada("USD")], servicios: [tourCop(40_000, 0)] },
    ];
    for (const caso of casos) for (const trm of [null, 0, -4000]) {
      const g = await generar({ ...caso, paquete: { trm_oferta: trm } });
      assert.equal(g.r.ok, false, JSON.stringify(trm));
      if (!g.r.ok) assert.match(g.r.error, /TRM/i);
      assert.equal(g.pub, undefined, `no se publicó nada con TRM ${trm}`);
    }
  });

  test("una vinculada con record (inelegible) NO se publica y se dice por qué", async () => {
    const g = await generar({ salidas: [salidaVinculada("USD")], fuentes: [fuente("USD", { record: "ABC123" })], servicios: [tourUsd(10, 0)] });
    assert.equal(g.r.ok, false);
    if (!g.r.ok) assert.match(g.r.error, /ninguna salida quedó disponible|record/i);
    assert.equal(g.pub, undefined);
  });

  test("una vinculada desactivada o con la compra cerrada (inelegible) NO se publica", async () => {
    for (const cambio of [{ activo: false }, { compra_fin: fechaBogota(-1) }]) {
      const g = await generar({ salidas: [salidaVinculada("USD")], fuentes: [fuente("USD", cambio)], servicios: [tourUsd(10, 0)] });
      assert.equal(g.r.ok, false, JSON.stringify(cambio));
      assert.equal(g.pub, undefined);
    }
  });

  test("la copia de la salida vencida frente a su fuente (tarifa o moneda cambiadas) NO se publica", async () => {
    for (const cambio of [{ tarifa_para_empaquetar: 300 }, { moneda: "COP" }, { fee_infante: 25 }]) {
      const g = await generar({ salidas: [salidaVinculada("USD")], fuentes: [fuente("USD", cambio)], servicios: [tourUsd(10, 0)] });
      assert.equal(g.r.ok, false, JSON.stringify(cambio));
      assert.equal(g.pub, undefined);
    }
  });

  test("dos vinculadas, una en USD y otra en COP, en el mismo paquete USD: ambas se publican, cada una con su R sin duplicar markup", async () => {
    const g = await generar({
      salidas: [salidaVinculada("USD"), salidaVinculada("COP", { id: 13, empaquetado_id: 6 })],
      fuentes: [fuente("USD"), fuente("COP", { id: 6 })],
      servicios: [tourUsd(10, 0)],
    });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(fila(g.filas, "doble", SALIDA_ID)?.precio_pvp, 428);
    assert.equal(fila(g.filas, "doble", 13)?.precio_pvp, 420);
  });
});
