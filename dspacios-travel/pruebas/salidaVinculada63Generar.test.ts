import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// #63 — generarTarifario() REAL (la Server Action, no una copia) para un paquete Dinámico en modo `cop_trm_63`:
//   · una salida VINCULADA a un Empaquetado sin record: R entra al PVP SIN markup ni TA, F se suma exacto al menor de 2 años;
//   · netos USD de hotel y servicios × TRM del paquete ANTES del markup; publicación en COP por el envoltorio de la 227;
//   · una salida MANUAL con fee USD (R1): centavos exactos;
//   · una vinculada que ya no es elegible (record, inactiva, copia vieja, destino aéreo) NO se publica y se dice por qué.
// El SQL (envoltorio, CHECK, triggers) se prueba en Postgres: supabase/scripts/test_227_salida_vinculada.sql.

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
const { cargarFuentesMoneda90 } = await import("../lib/reservar/fuentesMoneda90.ts");
const { evaluarPublicacion90, mensajeEvaluacion90 } = await import("../lib/reservar/monedaPublicacion90.ts");

function fechaBogota(offsetDias: number): string {
  return new Date(Date.now() + offsetDias * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
const IDA = fechaBogota(30);
const REG = fechaBogota(31); // 1 noche: el neto por noche ES el neto de la estadía
const AYER = fechaBogota(-1);

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
function salidaManual(o: Fila = {}): Fila {
  return {
    id: 12, paquete_id: PAQUETE_ID, empaquetado_id: null, activo: true, compra_inicio: null, compra_fin: null,
    fecha_ida: IDA, fecha_regreso: REG, ruta: "MDE - MIA - MDE", aerolinea: "Avianca", valor_tiquete: 0, fee_infante: 0,
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
    // #90 D: el cargador de fuentes de moneda lee estas tablas por id (misma moneda que los joins de arriba).
    hoteles: [{ id: HOTEL_ID, nombre: "Hotel Dinámico", moneda: o.hotelMoneda ?? "USD", modelo_tarifario: "persona" }],
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
    empaquetados: o.fuentes ?? [fuente()],
    destinos: [{ id: 1, nombre: "CARTAGENA", codigo_iata: "CTG", pais: "Colombia", activo: true }],
    armado_paquete_destinos_aereos: [],
    servicio_tarifa_pax: [],
    // SIN «GENERAL»: cada servicio del fixture se vende desde una vigencia que cubre todo el rango (mismos netos que su precio base de antes).
    servicio_temporadas: (o.servicios ?? []).map((s) => ({ servicio_id: s.servicio_id, nombre: "VIG", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: (s.servicios_adicionales as Fila).precio_persona ?? null, precio_infante: (s.servicios_adicionales as Fila).precio_infante ?? null, recargo_individual: null })),
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
const servicioIncluido = (precioPersona: number, precioInfante: number | null, moneda = "USD"): Fila => ({
  paquete_id: PAQUETE_ID, servicio_id: 900, modo: "persona", incluido: true,
  servicios_adicionales: { nombre: "Tour", precio_persona: precioPersona, precio_infante: precioInfante, liquidacion: "paquete", descripcion: null, recargo_individual: null, moneda },
});

describe("generarTarifario() REAL · salida VINCULADA en modo cop_trm_63", () => {
  test("FX1: adulto 1.680.000, infante de 1 año 130.500, niño de 2 años 1.230.000; publicado en COP por el envoltorio de la 227", async () => {
    const g = await generar({ salidas: [salidaVinculada()], servicios: [servicioIncluido(10, 0)] });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.pub?.nombre, "publicar_tarifario_resultado_63", "un paquete en modo 63 publica por el envoltorio, no por el publicador de siempre");
    assert.equal(g.pub?.args.p_modo, "cop_trm_63");
    assert.equal(g.pub?.args.p_trm, 4000);
    assert.equal(g.pub?.args.p_moneda, "COP");
    assert.equal(fila(g.filas, "doble")?.precio_pvp, 1_680_000);
    assert.equal(fila(g.filas, "infante")?.precio_pvp_menor2, 130_500, "hotel infante 50.000 + tour de infante gratis + F exacto");
    assert.equal(fila(g.filas, "infante")?.precio_pvp, 1_230_000, "el niño de 2 años (adulto en vuelo y servicios) paga R");
    assert.ok(g.filas.filter((f) => f.salida_id === SALIDA_ID).every((f) => f.moneda === "COP" && f.modulo === "dinamico"));
  });

  test("el impuesto por persona de una vinculada con impuesto_tipo = tiquete es R (no el fijo) y la base es PVP − R", async () => {
    const g = await generar({ salidas: [salidaVinculada()], servicios: [servicioIncluido(10, 0)] });
    const doble = fila(g.filas, "doble");
    assert.equal(doble?.impuesto, R);
    assert.equal(doble?.base_comisionable, 1_680_000 - R);
  });

  test("impuesto_tipo = fijo: el importe configurado (en COP en modo 63)", async () => {
    const g = await generar({ salidas: [salidaVinculada()], servicios: [servicioIncluido(10, 0)], paquete: { impuesto_tipo: "fijo", impuesto_fijo: 100_000 } });
    assert.equal(fila(g.filas, "doble")?.impuesto, 100_000);
  });

  test("tour de infante sin precio (NULL ≠ $0): el menor de 2 años paga como adulto en el tour → 180.500", async () => {
    const g = await generar({ salidas: [salidaVinculada()], servicios: [servicioIncluido(10, null)] });
    assert.equal(fila(g.filas, "infante")?.precio_pvp_menor2, 180_500);
  });

  test("sin tarifa de infante del hotel se publica la fila con hotel $0: queda solo F (80.500)", async () => {
    const g = await generar({ salidas: [salidaVinculada()], netoInfante: null });
    assert.equal(fila(g.filas, "infante")?.precio_pvp_menor2, 80_500);
  });

  test("hotel en COP y servicio en USD en el mismo paquete: en modo 63 NO es 'monedas distintas' (todo se convierte a COP)", async () => {
    const g = await generar({ salidas: [salidaVinculada()], hotelMoneda: "COP", netoAdulto: 413_700, netoInfante: 20_000, servicios: [servicioIncluido(10, 0, "USD")] });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    // hotel 413.700/0,8 = 517.125 + tour USD 10 → 50.000 + R 1.130.000 = 1.697.125 → techo al mil
    assert.equal(fila(g.filas, "doble")?.precio_pvp, 1_698_000);
  });

  test("FX2: COP puro, el redondeo cae una vez sobre el total (1.648.000) y el infante es 25.000 + F = 105.500", async () => {
    const g = await generar({ salidas: [salidaVinculada()], hotelMoneda: "COP", netoAdulto: 413_700, netoInfante: 20_000 });
    assert.equal(fila(g.filas, "doble")?.precio_pvp, 1_648_000);
    assert.equal(fila(g.filas, "infante")?.precio_pvp_menor2, 105_500);
  });

  test("FX3: TRM 3.987,65 → adulto 1.646.000 e infante 52.000 + F = 132.500", async () => {
    const g = await generar({ salidas: [salidaVinculada()], paquete: { trm_oferta: 3987.65 }, netoAdulto: 103.5, netoInfante: 10.35 });
    assert.equal(fila(g.filas, "doble")?.precio_pvp, 1_646_000);
    assert.equal(fila(g.filas, "infante")?.precio_pvp_menor2, 132_500);
    assert.equal(g.pub?.args.p_trm, 3987.65);
  });
});

describe("generarTarifario() REAL · salida MANUAL en modo cop_trm_63 (R1)", () => {
  test("fee USD 25 con TRM 3.987,65: el infante es 52.000 + 99.691,25 = 151.691,25 (centavos exactos, ni peso ni mil)", async () => {
    const g = await generar({
      salidas: [salidaManual({ moneda: "USD", valor_tiquete: 100, fee_infante: 25 })],
      paquete: { trm_oferta: 3987.65 }, netoAdulto: 103.5, netoInfante: 10.35,
    });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(fila(g.filas, "infante", 12)?.precio_pvp_menor2, 151_691.25);
  });

  test("el tiquete manual USD se convierte × TRM y luego lleva el markup (aplica_mk): 100 USD → 400.000 → 500.000", async () => {
    const g = await generar({ salidas: [salidaManual({ moneda: "USD", valor_tiquete: 100, aplica_mk: true })], hotelMoneda: "COP", netoAdulto: 400_000 });
    // hotel 400.000/0,8 = 500.000 + vuelo 100 USD × 4.000 / 0,8 = 500.000 → 1.000.000
    assert.equal(fila(g.filas, "doble", 12)?.precio_pvp, 1_000_000);
  });
});

describe("generarTarifario() REAL · vinculada que NO se publica", () => {
  async function sinPublicar(o: Opciones, patron: RegExp) {
    const g = await generar(o);
    assert.equal(g.r.ok, false, "debe rechazar");
    if (!g.r.ok) assert.match(g.r.error, patron);
    assert.equal(g.pub, undefined, "no publica nada: ni el publicador de siempre ni el envoltorio");
  }
  test("la fuente ya tiene record (PNR): ya no es una salida de sistema sin record", () =>
    sinPublicar({ salidas: [salidaVinculada()], fuentes: [fuente({ record: "L93FYZ" })] }, /ya tiene record/i));
  test("un texto cualquiera en el record (PROMOCION) también cuenta como record", () =>
    sinPublicar({ salidas: [salidaVinculada()], fuentes: [fuente({ record: "PROMOCION" })] }, /ya tiene record/i));
  test("la fuente fue desactivada", () => sinPublicar({ salidas: [salidaVinculada()], fuentes: [fuente({ activo: false })] }, /desactivado/i));
  test("la ventana de compra de la fuente venció", () => sinPublicar({ salidas: [salidaVinculada()], fuentes: [fuente({ compra_fin: AYER })] }, /vigencia de compra/i));
  test("la copia guardada en la salida quedó vieja (la tarifa de la fuente cambió): se pide actualizar y regenerar", () =>
    sinPublicar({ salidas: [salidaVinculada()], fuentes: [fuente({ tarifa_para_empaquetar: 1_200_000 })] }, /cambi[oó].*tarifa para empaquetar|Actualiza la salida/i));
  test("el destino de llegada del vuelo no está entre los destinos aéreos permitidos del paquete (#67/220)", () =>
    sinPublicar({ salidas: [salidaVinculada()], fuentes: [fuente({ destino_id: 2 })] }, /destino a[eé]reo no est[aá] permitido/i));
  test("la fuente ya no existe (error de integridad): se rechaza, no se publica", () =>
    sinPublicar({ salidas: [salidaVinculada()], fuentes: [] }, /ya no existe/i));

  test("con una vinculada válida y otra con record: se publica la válida y se avisa de la otra", async () => {
    const g = await generar({
      salidas: [salidaVinculada(), salidaVinculada({ id: 13, empaquetado_id: 6 })],
      fuentes: [fuente(), fuente({ id: 6, record: "ZZZ999" })],
    });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.deepEqual([...new Set(g.filas.map((f) => f.salida_id))], [SALIDA_ID]);
    if (g.r.ok) assert.match(g.r.aviso ?? "", /vinculada.*no se publicaron/i);
  });

  test("una vinculada en un paquete SIN modo 63 se rechaza (R en COP no se mezcla con un paquete en la moneda del hotel)", async () => {
    const g = await generar({ salidas: [salidaVinculada()], paquete: { modo_oferta: "legacy", trm_oferta: null, moneda_publicacion: "USD" } });
    assert.equal(g.r.ok, false);
    if (!g.r.ok) assert.match(g.r.error, /modo con conversión por TRM/i);
    assert.equal(g.pub, undefined);
  });

  test("modo 63 sin TRM válida: no se publica (nunca se usa 1)", async () => {
    for (const trm of [null, 0, -3]) {
      const g = await generar({ salidas: [salidaVinculada()], paquete: { trm_oferta: trm } });
      assert.equal(g.r.ok, false, `TRM ${trm}`);
      if (!g.r.ok) assert.match(g.r.error, /Falta la TRM|TRM no es v[aá]lida/i);
      assert.equal(g.pub, undefined);
    }
  });
  test("#93 modo 63 con TODO en COP y sin TRM: sí se publica (null, nunca 1) y dice que no requiere conversión", async () => {
    const g = await generar({ salidas: [salidaVinculada()], hotelMoneda: "COP", paquete: { trm_oferta: null } });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.pub?.nombre, "publicar_tarifario_resultado_63");
    assert.equal(g.pub?.args.p_trm, null, "sin TRM: el envoltorio recibe null, nunca 0 ni 1");
    assert.equal(g.pub?.args.p_moneda, "COP");
    assert.ok(g.filas.length > 0 && g.filas.every((f) => f.moneda === "COP"));
  });
  test("#93 cambio posterior COP→USD: el mismo paquete sin TRM deja de poder generarse", async () => {
    const todoCop = await generar({ salidas: [salidaVinculada()], hotelMoneda: "COP", paquete: { trm_oferta: null } });
    assert.equal(todoCop.r.ok, true);
    const conUsd = await generar({ salidas: [salidaVinculada()], hotelMoneda: "COP", paquete: { trm_oferta: null }, servicios: [servicioIncluido(10, 0, "USD")] });
    assert.equal(conUsd.r.ok, false);
    if (!conUsd.r.ok) assert.match(conUsd.r.error, /Falta la TRM.*Servicio Tour/i);
    assert.equal(conUsd.pub, undefined);
  });
  test("#93 modo 63 con USD y TRM positiva: publica con esa TRM", async () => {
    const g = await generar({ salidas: [salidaVinculada()], hotelMoneda: "USD", paquete: { trm_oferta: 3987.65 } });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.pub?.args.p_trm, 3987.65);
  });
  test("#90 D un paquete sin moneda de publicación elegida no se genera (no se deduce de los hoteles)", async () => {
    const g = await generar({ salidas: [salidaManual({ valor_tiquete: 400 })], paquete: { modo_oferta: "legacy", trm_oferta: null, moneda_publicacion: null } });
    assert.equal(g.r.ok, false);
    if (!g.r.ok) assert.match(g.r.error, /Elige la moneda de publicaci[oó]n/i);
    assert.equal(g.pub, undefined);
  });
});

// #90 D: solo cuentan las fuentes que REALMENTE aportan al precio. El generador, el panel y la cotización (cargarFuentesMoneda90 + evaluarPublicacion90)
// deben dar el MISMO veredicto sobre las mismas filas.
describe("#90 D · fuentes incluidas vs descartadas: generador = panel/cotización", () => {
  async function veredictos(o: Opciones) {
    const g = await generar(o);
    const c = clienteGenerar(tablas(o));
    const fuentes = await cargarFuentesMoneda90(c.sb as never, PAQUETE_ID, { tipo: "dinamico", modo63: true });
    assert.equal(fuentes.ok, true);
    const pq = tablas(o).armado_paquetes[0];
    const ev = fuentes.ok ? evaluarPublicacion90({ modo: "cop_trm_63", monedaPublicacion: pq.moneda_publicacion, trm: pq.trm_oferta, fuentes: fuentes.fuentes }) : null;
    return { g, ev };
  }
  const sinTrm = { trm_oferta: null };

  test("INCLUIDA: una salida manual USD vigente exige TRM en el generador Y en el panel/cotización", async () => {
    const { g, ev } = await veredictos({ salidas: [salidaVinculada(), salidaManual({ moneda: "USD", valor_tiquete: 100 })], hotelMoneda: "COP", paquete: sinTrm });
    assert.equal(g.r.ok, false);
    assert.equal(ev?.ok, false);
    if (!g.r.ok && ev) assert.equal(g.r.error, mensajeEvaluacion90(ev), "el mismo mensaje en las tres superficies");
    assert.equal(g.pub, undefined);
  });
  test("DESCARTADA (compra vencida): la misma salida USD no exige TRM; el generador publica y el panel/cotización también aprueban", async () => {
    const { g, ev } = await veredictos({ salidas: [salidaVinculada(), salidaManual({ moneda: "USD", valor_tiquete: 100, compra_fin: AYER })], hotelMoneda: "COP", paquete: sinTrm });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.pub?.args.p_trm, null);
    assert.equal(ev?.ok, true);
    assert.equal(ev?.requiereTrm, false);
  });
  test("DESCARTADA (inactiva, viaje pasado, sin regreso o sin noches): no exige TRM", async () => {
    const casos: Fila[] = [{ activo: false }, { fecha_ida: fechaBogota(-5), fecha_regreso: fechaBogota(-3) }, { fecha_regreso: null }, { fecha_regreso: IDA, fecha_ida: IDA }];
    for (const c of casos) {
      const { g, ev } = await veredictos({ salidas: [salidaVinculada(), salidaManual({ moneda: "USD", valor_tiquete: 100, ...c })], hotelMoneda: "COP", paquete: sinTrm });
      assert.equal(g.r.ok, true, JSON.stringify(c) + " " + (g.r.ok ? "" : g.r.error));
      assert.equal(ev?.ok, true, JSON.stringify(c));
    }
  });
  test("DESCARTADA (vinculada USD cuya fuente ya tiene record): no exige TRM y el generador la reporta como omitida", async () => {
    const usd = { id: 6, moneda: "USD", record: "ZZZ999", tarifa_para_empaquetar: 290, fee_infante: 20 };
    const { g, ev } = await veredictos({
      salidas: [salidaVinculada(), salidaVinculada({ id: 13, empaquetado_id: 6, moneda: "USD", valor_tiquete: 290, fee_infante: 20 })],
      fuentes: [fuente(), fuente(usd)], hotelMoneda: "COP", paquete: sinTrm,
    });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    if (g.r.ok) assert.match(g.r.aviso ?? "", /vinculada.*no se publicaron/i);
    assert.equal(ev?.ok, true);
    assert.equal(ev?.requiereTrm, false);
  });
  test("DESCARTADA (vinculada USD con la copia vieja): no exige TRM; INCLUIDA con la copia al día: sí", async () => {
    const vieja = await veredictos({
      salidas: [salidaVinculada(), salidaVinculada({ id: 13, empaquetado_id: 6, moneda: "USD", valor_tiquete: 280, fee_infante: 20 })],
      fuentes: [fuente(), fuente({ id: 6, moneda: "USD", tarifa_para_empaquetar: 290, fee_infante: 20 })], hotelMoneda: "COP", paquete: sinTrm,
    });
    assert.equal(vieja.g.r.ok, true, vieja.g.r.ok ? "" : vieja.g.r.error);
    assert.equal(vieja.ev?.ok, true);
    const alDia = await veredictos({
      salidas: [salidaVinculada(), salidaVinculada({ id: 13, empaquetado_id: 6, moneda: "USD", valor_tiquete: 290, fee_infante: 20 })],
      fuentes: [fuente(), fuente({ id: 6, moneda: "USD", tarifa_para_empaquetar: 290, fee_infante: 20 })], hotelMoneda: "COP", paquete: sinTrm,
    });
    assert.equal(alDia.g.r.ok, false);
    assert.equal(alDia.ev?.ok, false);
    if (!alDia.g.r.ok && alDia.ev) assert.equal(alDia.g.r.error, mensajeEvaluacion90(alDia.ev));
  });
  test("CAMBIO COP→USD después de cotizar: la misma salida pasa de no exigir a exigir TRM (la oferta anterior queda obsoleta)", async () => {
    const antes = await veredictos({ salidas: [salidaVinculada(), salidaManual({ moneda: "COP", valor_tiquete: 100 })], hotelMoneda: "COP", paquete: sinTrm });
    const despues = await veredictos({ salidas: [salidaVinculada(), salidaManual({ moneda: "USD", valor_tiquete: 100 })], hotelMoneda: "COP", paquete: sinTrm });
    assert.equal(antes.g.r.ok, true);
    assert.equal(antes.ev?.requiereTrm, false);
    assert.equal(despues.g.r.ok, false);
    assert.equal(despues.ev?.requiereTrm, true);
  });
});

describe("generarTarifario() REAL · el modo de siempre NO cambia", () => {
  test("un paquete legacy publica por publicar_tarifario_resultado (sin envoltorio) y en la moneda del hotel", async () => {
    const g = await generar({
      salidas: [salidaManual({ valor_tiquete: 400, aplica_mk: true })],
      paquete: { modo_oferta: "legacy", trm_oferta: null, impuesto_tipo: "fijo", impuesto_fijo: 0, moneda_publicacion: "USD" },
      netoAdulto: 100, netoInfante: 10,
    });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.pub?.nombre, "publicar_tarifario_resultado");
    assert.equal(g.pub?.args.p_moneda, "USD");
    assert.equal("p_modo" in (g.pub?.args ?? {}), false);
    assert.ok(g.filas.every((f) => f.moneda === "USD"));
  });
});
