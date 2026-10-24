import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// 226 — TARIFA DE INFANTE (0 a 1,99 años). EJECUCIÓN REAL de:
//   • lib/reservar/menoresDeDos.ts            (cuenta y tarifa de menores — módulo puro)
//   • lib/calc/paquetes.ts::precioMenorDeDos  (regla B: techo al mil de hotel + servicios, fee EXACTO)
//   • lib/reservar/serviciosPaquete.ts        (costo neto de servicios incluidos con infantes)
//   • lib/reservar/liquidacionHotel.ts        (evaluador por fechas: preciosMenor2)
//   • generarTarifario()  (Server Action real, con cliente falso) — filas publicadas
//   • computarReserva()   (motor real, con cliente falso) — rama cacheada del tarifario
//
// Reglas del dueño que se prueban: menor de 2 años (edad < 2) paga solo el fee del vuelo (puede ser $0) y el precio
// de infante de cada servicio (puede ser $0); desde los 2 años paga como adulto en vuelo y servicios; el HOTEL
// conserva su propia clase de infante (V8: un niño de 2 años con hotel de infante hasta 2 años paga hotel infante +
// vuelo y servicios de adulto); fee = precio = costo (sin MK ni TA); NULL ≠ $0 (servicio sin precio de infante: paga como
// adulto); servicios por GRUPO: el infante ni cuenta para el rango ni paga extra (4 adultos + 1 infante = rango de 4).

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

type Fila = Record<string, unknown>;
type Tablas = Record<string, Fila[]>;
type Rpc = { nombre: string; args: Record<string, unknown> };

// Cliente falso mínimo (select/eq/in/is/not/order/range/limit/single/maybeSingle + thenable) y rpc.
function cliente(tablas: Tablas) {
  const rpcs: Rpc[] = [];
  function from(tabla: string) {
    const filtros: ((r: Fila) => boolean)[] = [];
    let uno = false;
    const b: Record<string, unknown> = {};
    b.select = () => b; b.order = () => b; b.range = () => b; b.limit = () => b; b.not = () => b;
    b.eq = (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return b; };
    b.in = (c: string, v: unknown[]) => { filtros.push((r) => v.includes(r[c])); return b; };
    b.is = (c: string, v: unknown) => { filtros.push((r) => (r[c] ?? null) === v); return b; };
    b.single = () => { uno = true; return b; };
    b.maybeSingle = () => { uno = true; return b; };
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (tablas[tabla] === undefined) throw new Error(`fixture incompleto: falta la tabla "${tabla}"`);
      const filas = tablas[tabla].filter((r) => filtros.every((f) => f(r)));
      return Promise.resolve({ data: uno ? (filas[0] ?? null) : filas, error: null }).then(res, rej);
    };
    return b;
  }
  async function rpc(nombre: string, args: Record<string, unknown>) {
    rpcs.push({ nombre, args });
    if (nombre === "iniciar_generacion_tarifario") return { data: [{ generacion: 3, revision_capturada: 5 }], error: null };
    if (nombre === "publicar_tarifario_resultado") return { data: true, error: null };
    return { data: null, error: null };
  }
  return { sb: { from, rpc, auth: { getUser: async () => ({ data: { user: null }, error: null }) } }, rpcs };
}

let adminActual: ReturnType<typeof cliente>["sb"] | null = null;
let sbServidor: unknown = null;
mock.module("@/lib/supabase/admin", {
  namedExports: { createAdminClient: () => { if (!adminActual) throw new Error("admin no preparado"); return adminActual; } },
});
mock.module("@/lib/supabase/server", {
  namedExports: { createClient: async () => { if (sbServidor == null) throw new Error("createClient() real NUNCA debe invocarse aquí"); return sbServidor; } },
});
register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, n) {
     if (s === "next/cache") return { url: "data:text/javascript,export const revalidatePath=()=>{};export const revalidateTag=()=>{};", shortCircuit: true };
     return n(s, c);
   }`
));

const { contarMenoresDeDos, tarifarMenores, esMenorDeDos, descripcionLineaMenor, ordenLineaMenor, serviciosSinPrecioInfante, menoresDelComputo, MENSAJE_TARIFARIO_SIN_INFANTE } =
  await import("../lib/reservar/menoresDeDos.ts");
const { precioMenorDeDos, redondearVenta } = await import("../lib/calc/paquetes.ts");
const { costoNetoServicioIncluido, cargoGrupoIncluido } = await import("../lib/reservar/serviciosPaquete.ts");
const { evaluarHotelPorFechas } = await import("../lib/reservar/liquidacionHotel.ts");
const { calcularResidualServiciosIncluidosPorGrupo } = await import("../lib/reservar/desglosePersonaCotizacion.ts");
const { computarReserva } = await import("@/lib/reservar/computo.ts");
const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");

function fechaBogota(offsetDias: number): string {
  return new Date(Date.now() + offsetDias * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
const EN_30 = fechaBogota(30);
const EN_31 = fechaBogota(31);

// ─── A · cuenta de menores de 2 años ────────────────────────────────────────────────────────
describe("menores de 2 años: cuenta por edad", () => {
  test("esMenorDeDos: 0 y 1 año sí; 2 años no (0 a 1,99)", () => {
    assert.deepEqual([0, 1, 2, 3].map(esMenorDeDos), [true, true, false, false]);
    assert.equal(esMenorDeDos(null), false);
  });
  test("con edades: hotel infante hasta 2 años — un niño de 1 año es infante M2; uno de 2 años NO es menor de 2", () => {
    const m = contarMenoresDeDos([1, 2], 2, { infante: 2, nino: 0, nino2: 0 });
    assert.deepEqual(m, { infante: 1, nino: 0, nino2: 0 });
  });
  test("hotel con infante solo hasta 0 años: un menor de 1 año es niño del hotel pero MENOR DE 2 (toma Niño 1 primero)", () => {
    const m = contarMenoresDeDos([1, 1, 5], 0, { infante: 0, nino: 1, nino2: 1 });
    assert.deepEqual(m, { infante: 0, nino: 1, nino2: 1 });
  });
  test("nunca devuelve más de lo que hay en los totales", () => {
    const m = contarMenoresDeDos([0, 0, 0], 2, { infante: 1, nino: 0, nino2: 0 });
    assert.deepEqual(m, { infante: 1, nino: 0, nino2: 0 });
  });
  test("flujo legado por conteo: los infantes declarados SON menores de 2 años; los niños no", () => {
    assert.deepEqual(contarMenoresDeDos(null, 2, { infante: 2, nino: 3, nino2: 1 }), { infante: 2, nino: 0, nino2: 0 });
  });
});

describe("menoresDelComputo: cómputo sin los campos de la 226 se comporta como antes", () => {
  test("con lineasMenores las devuelve y cuenta los menores de 2 años de ellas", () => {
    const r = menoresDelComputo({ lineasMenores: [{ clase: "infante", cantidad: 2, tarifa: 5, menorDeDos: true }, { clase: "infante", cantidad: 1, tarifa: 9, menorDeDos: false }], numInfantes: 3 });
    assert.equal(r.numMenoresDeDos, 2);
    assert.equal(r.numInfantes, 3);
    assert.equal(r.lineasMenores.length, 2);
  });
  test("sin ellas (cómputo viejo): arma las filas desde pvpPorAcom y trata a los infantes declarados como menores de 2 años", () => {
    const r = menoresDelComputo({ pvpPorAcom: { nino: 100, nino2: 80, infante: 50 }, numNinos: 1, numNinos2: 1, numInfantes: 2 });
    assert.deepEqual(r.lineasMenores.map((l) => [l.clase, l.cantidad, l.tarifa, l.menorDeDos]), [["nino", 1, 100, false], ["nino2", 1, 80, false], ["infante", 2, 50, true]]);
    assert.equal(r.numMenoresDeDos, 2);
  });
  test("sin numInfantes usa los infantes declarados por el llamador", () => {
    const r = menoresDelComputo({ pvpPorAcom: { infante: 50 } }, { infantesDeclarados: 3 });
    assert.deepEqual(r.lineasMenores, [{ clase: "infante", cantidad: 3, tarifa: 50, menorDeDos: true }]);
    assert.equal(r.numInfantes, 3);
  });
});

// ─── B · tarifar menores y regla de redondeo B ──────────────────────────────────────────────
describe("tarifarMenores: precio de cada menor por clase del hotel y por edad", () => {
  const pvp = { doble: 1730000, infante: 1305000, nino: 1418000 };
  const pvpMenor2 = { infante: 205000, nino: 318000 };
  test("V3: 1 infante de 1 año = fee + servicio de infante + hotel infante (205.000); no ocupa silla", () => {
    const r = tarifarMenores({ totales: { infante: 1, nino: 0, nino2: 0 }, menoresDeDos: { infante: 1, nino: 0, nino2: 0 }, pvp, pvpMenor2 });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.total, 205000);
      assert.equal(r.paxConSilla, 0);
      assert.equal(r.menoresDeDos, 1);
      assert.deepEqual(r.lineas, [{ clase: "infante", cantidad: 1, tarifa: 205000, menorDeDos: true }]);
    }
  });
  test("V8: niño de 2 años con hotel de infante hasta 2 = hotel infante + vuelo y servicios de ADULTO (1.305.000); ocupa silla", () => {
    const r = tarifarMenores({ totales: { infante: 1, nino: 0, nino2: 0 }, menoresDeDos: { infante: 0, nino: 0, nino2: 0 }, pvp, pvpMenor2 });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.total, 1305000);
      assert.equal(r.paxConSilla, 1);
      assert.equal(r.menoresDeDos, 0);
    }
  });
  test("V6: niño de 3+ años paga la clase niño con vuelo y servicios de adulto (1.418.000)", () => {
    const r = tarifarMenores({ totales: { infante: 0, nino: 1, nino2: 0 }, menoresDeDos: { infante: 0, nino: 0, nino2: 0 }, pvp, pvpMenor2 });
    assert.ok(r.ok);
    if (r.ok) { assert.equal(r.total, 1418000); assert.equal(r.paxConSilla, 1); }
  });
  test("mezcla: infante de 1 año + niño de 2 años (hotel infante) + niño de 5 en la misma reserva", () => {
    const r = tarifarMenores({ totales: { infante: 2, nino: 1, nino2: 0 }, menoresDeDos: { infante: 1, nino: 0, nino2: 0 }, pvp, pvpMenor2 });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.total, 205000 + 1305000 + 1418000);
      assert.equal(r.paxConSilla, 2);
      assert.equal(r.menoresDeDos, 1);
      assert.equal(r.lineas.length, 3);
    }
  });
  test("tarifario anterior a la 226 (sin precio de menor de 2): rechaza con el mensaje de regenerar, NUNCA cobra el vuelo de adulto", () => {
    const r = tarifarMenores({ totales: { infante: 1, nino: 0, nino2: 0 }, menoresDeDos: { infante: 1, nino: 0, nino2: 0 }, pvp, pvpMenor2: {} });
    assert.deepEqual(r, { ok: false, error: MENSAJE_TARIFARIO_SIN_INFANTE });
    assert.match(MENSAJE_TARIFARIO_SIN_INFANTE, /Regenera el tarifario/);
  });
  test("niño sin tarifa publicada: comportamiento histórico (no se suma) — no se rechaza", () => {
    const r = tarifarMenores({ totales: { infante: 0, nino: 1, nino2: 0 }, menoresDeDos: { infante: 0, nino: 0, nino2: 0 }, pvp: { doble: 1 }, pvpMenor2: {} });
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.total, 0);
  });
  test("descripciones y orden de las líneas del contrato", () => {
    assert.equal(descripcionLineaMenor({ clase: "infante", menorDeDos: true }, "Estándar", "PC"), "Infante · Estándar / PC");
    assert.equal(descripcionLineaMenor({ clase: "nino", menorDeDos: true }, "Estándar", "PC"), "Niño 1 (menor de 2 años) · Estándar / PC");
    assert.equal(descripcionLineaMenor({ clase: "infante", menorDeDos: false }, "Estándar", "PC"), "Infante (2 años) · Estándar / PC");
    assert.equal(descripcionLineaMenor({ clase: "nino", menorDeDos: false }, "Estándar", "PC"), "Niño 1 · Estándar / PC");
    assert.equal(ordenLineaMenor({ clase: "nino", menorDeDos: false }), 50);
    assert.equal(ordenLineaMenor({ clase: "nino2", menorDeDos: false }), 51);
    assert.equal(ordenLineaMenor({ clase: "infante", menorDeDos: true }), 52);
    assert.equal(ordenLineaMenor({ clase: "infante", menorDeDos: false }), 53);
  });
});

describe("precioMenorDeDos: regla B (techo al mil/dólar de hotel + servicios; fee EXACTO)", () => {
  test("V5: hotel 76.250 + fee 80.500 = 77.000 + 80.500 = 157.500 (la regla A habría dado 157.000)", () => {
    assert.equal(precioMenorDeDos({ aporteHotel: 76250, aporteServiciosMenor: 0, feeInfante: 80500, moneda: "COP" }), 157500);
    assert.equal(redondearVenta(76250 + 80500, "COP"), 157000);
  });
  test("V1: fee 0 y servicio de infante $0 → solo el hotel (75.000)", () => {
    assert.equal(precioMenorDeDos({ aporteHotel: 75000, aporteServiciosMenor: 0, feeInfante: 0, moneda: "COP" }), 75000);
  });
  test("V3: 75.000 + 50.000 → 125.000 y + fee 80.000 = 205.000", () => {
    assert.equal(precioMenorDeDos({ aporteHotel: 75000, aporteServiciosMenor: 50000, feeInfante: 80000, moneda: "COP" }), 205000);
  });
  test("V11 USD: hotel 18,75 + servicio 12,5 → techo 32 + fee 25 = USD 57", () => {
    assert.equal(precioMenorDeDos({ aporteHotel: 18.75, aporteServiciosMenor: 12.5, feeInfante: 25, moneda: "USD" }), 57);
  });
  test("fee inválido (negativo, NaN) cuenta como 0", () => {
    assert.equal(precioMenorDeDos({ aporteHotel: 1000, aporteServiciosMenor: 0, feeInfante: -5, moneda: "COP" }), 1000);
    assert.equal(precioMenorDeDos({ aporteHotel: 1000, aporteServiciosMenor: 0, feeInfante: Number.NaN, moneda: "COP" }), 1000);
  });
});

// ─── C · costo neto de servicios (CxP) con infantes ─────────────────────────────────────────
describe("costo neto de servicios incluidos con menores de 2 años", () => {
  test("V3c: persona — 2 adultos × 80.000 + 1 infante × 40.000 = 200.000 (antes 240.000)", () => {
    assert.equal(costoNetoServicioIncluido("persona", 80000, [], 2, "paquete", 1, { cantidad: 1, precioInfanteNeto: 40000 }), 200000);
  });
  test("NULL ≠ $0: sin precio de infante el infante cuesta como adulto (240.000); con $0 no cuesta (160.000)", () => {
    assert.equal(costoNetoServicioIncluido("persona", 80000, [], 2, "paquete", 1, { cantidad: 1, precioInfanteNeto: null }), 240000);
    assert.equal(costoNetoServicioIncluido("persona", 80000, [], 2, "paquete", 1, { cantidad: 1, precioInfanteNeto: 0 }), 160000);
  });
  test("liquidación por noche: el infante también se multiplica por las noches (V9)", () => {
    assert.equal(costoNetoServicioIncluido("persona", 80000, [], 2, "noche", 3, { cantidad: 1, precioInfanteNeto: 20000 }), (160000 + 20000) * 3);
  });
  test("sin menores el resultado es el de siempre", () => {
    assert.equal(costoNetoServicioIncluido("persona", 80000, [], 3, "paquete", 1), 240000);
  });
  test("grupo: 4 adultos + 1 infante = rango de 4, sin cargo de infante (el infante no se pasa al rango)", () => {
    const rangos = [{ pax_desde: 1, pax_hasta: 2, precio: 500000 }, { pax_desde: 3, pax_hasta: 4, precio: 600000 }];
    assert.equal(costoNetoServicioIncluido("grupo", null, rangos, 4, "paquete", 1, { cantidad: 1, precioInfanteNeto: 40000 }), 600000);
    // Si el infante contara, serían 5 pax y no habría rango que cubra → null (configuración incompleta).
    assert.equal(costoNetoServicioIncluido("grupo", null, rangos, 5, "paquete", 1), null);
    const c = cargoGrupoIncluido([{ servicioId: 1, nombre: "Tour grupo", categoria: "tour_traslado", liquidacion: "paquete", proveedorId: null, rangos }], 4, 0.2, 1);
    assert.ok(c.ok);
    if (c.ok) assert.equal(c.pvp, 750000);
  });
});

// ─── D · evaluador por fechas (porción terrestre / dinámico por fechas) ─────────────────────
describe("evaluarHotelPorFechas: preciosMenor2 e infante con hotel $0", () => {
  function datos(tarifa: Record<string, unknown>, extra: { adultsOnly?: boolean; servicios?: unknown[] } = {}) {
    return {
      paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "CARTAGENA", fecha_viaje_inicio: null, fecha_viaje_fin: null },
      armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "H", hotel_moneda: "COP", hotel_adults_only: extra.adultsOnly ?? false },
      temporadas: [{ nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null }],
      tarifas: [{ tipo_habitacion: "Estándar", alimentacion: "PC", temporada: "Base", neto_sencilla: null, neto_doble: 400000, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, precio_final_autoritativo: false, ...tarifa }],
      serviciosIncluidos: (extra.servicios ?? []) as never,
      blackouts: [],
    };
  }
  const tour = (precio_infante: number | null) => ({
    incluido: true, precio_persona: 80000, precio_infante, liquidacion: "paquete", servicio_id: 1, modo: "persona",
    nombre: "Tour", categoria: "tour_traslado", proveedor_id: null, rangos_grupo: [],
  });
  test("infante con tarifa de hotel y tour con precio de infante: pvp de adulto + preciosMenor2", () => {
    const r = evaluarHotelPorFechas(datos({ neto_infante: 60000, neto_nino: 150000 }, { servicios: [tour(40000)] }), EN_30, 1);
    assert.ok(r && r.combos.length === 1);
    const c = r!.combos[0];
    assert.equal(c.precios.doble, 600000);        // 500.000 hotel + 100.000 tour
    assert.equal(c.precios.infante, 175000);      // 75.000 + 100.000 (servicio de ADULTO, pvp conserva su significado)
    assert.equal(c.preciosMenor2?.infante, 125000); // 75.000 + 50.000 (precio de infante, sin vuelo → fee 0)
    assert.equal(c.preciosMenor2?.nino, 238000);  // ceil(187.500 + 50.000)
    assert.equal(c.preciosMenor2?.doble, undefined);
  });
  test("tour sin precio de infante (NULL): el menor de 2 paga como adulto en el servicio", () => {
    const r = evaluarHotelPorFechas(datos({ neto_infante: 60000 }, { servicios: [tour(null)] }), EN_30, 1);
    assert.equal(r!.combos[0].preciosMenor2?.infante, 175000);
  });
  test("tour con precio de infante $0: el menor de 2 no paga el tour (solo el hotel, 75.000)", () => {
    const r = evaluarHotelPorFechas(datos({ neto_infante: 60000 }, { servicios: [tour(0)] }), EN_30, 1);
    assert.equal(r!.combos[0].preciosMenor2?.infante, 75000);
  });
  test("hotel SIN tarifa de infante: se publica la fila con hotel $0 (antes el infante salía gratis en silencio)", () => {
    const r = evaluarHotelPorFechas(datos({}, { servicios: [tour(40000)] }), EN_30, 1);
    const c = r!.combos[0];
    assert.equal(c.precios.infante, 100000);        // 0 hotel + 100.000 tour de adulto
    assert.equal(c.preciosMenor2?.infante, 50000);  // 0 hotel + 50.000 tour de infante
    assert.equal(c.netos?.infante, 0);
  });
  test("Adults Only: no hay fila de infante", () => {
    const r = evaluarHotelPorFechas(datos({}, { adultsOnly: true }), EN_30, 1);
    assert.equal(r!.combos[0].precios.infante, undefined);
  });
});

// ─── E · generarTarifario REAL ──────────────────────────────────────────────────────────────
const PAQUETE_ID = 226;
const HOTEL_A = 1; // con tarifa de infante y niño
const HOTEL_B = 2; // sin tarifa de infante
const HOTEL_C = 3; // Adults Only (sin tarifas de menores)

type SrvFx = { id: number; incluido: boolean; modo?: "persona" | "grupo"; nombre?: string; precio_persona: number | null; precio_infante?: number | null; liquidacion?: string; moneda?: string };
function armadoServicio(s: SrvFx): Fila {
  return {
    paquete_id: PAQUETE_ID, servicio_id: s.id, modo: s.modo ?? "persona", incluido: s.incluido,
    servicios_adicionales: {
      nombre: s.nombre ?? `Servicio ${s.id}`, precio_persona: s.precio_persona, precio_infante: s.precio_infante ?? null,
      liquidacion: s.liquidacion ?? "paquete", descripcion: null, recargo_individual: null, moneda: s.moneda ?? "COP",
    },
  };
}

function tablasGenerar(o: {
  fee?: number; ticket?: number; moneda?: "COP" | "USD"; mk?: number; servicios?: SrvFx[]; hoteles?: number[];
  netos?: { doble: number; nino?: number; infante?: number };
  grupos?: Fila[];
} = {}): Tablas {
  const moneda = o.moneda ?? "COP";
  const netos = o.netos ?? { doble: 400000, nino: 150000, infante: 60000 };
  const hoteles = o.hoteles ?? [HOTEL_A];
  const tarifa = (hotel_id: number, extra: Fila): Fila => ({
    hotel_id, tipo_habitacion: "Estándar", alimentacion: "PC", temporada: "Base", neto_sencilla: null, neto_doble: netos.doble,
    neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, precio_final_autoritativo: false, ...extra,
  });
  return {
    armado_paquetes: [{
      id: PAQUETE_ID, nombre: "Dinámico 226", activo: true, destino_id: 1, pct_mk: o.mk ?? 0.2, tipo: "dinamico",
      impuesto_tipo: "fijo", impuesto_fijo: 0, noches: 1, destinos: { nombre: "CARTAGENA" }, moneda_publicacion: moneda,
    }],
    armado_vuelos: [], armado_empaquetados: [],
    armado_servicios: (o.servicios ?? []).map(armadoServicio),
    servicio_tarifa_pax: o.grupos ?? [],
    armado_hoteles: hoteles.map((h) => ({
      paquete_id: PAQUETE_ID, hotel_id: h, categorias: null, regimenes: null,
      hoteles: { nombre: `Hotel ${h}`, moneda, modelo_tarifario: "persona", adults_only: h === HOTEL_C },
    })),
    hotel_temporadas: hoteles.map((h) => ({
      hotel_id: h, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1,
      compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, regimen_restringido: null,
    })),
    tarifa_hotel: [
      ...(hoteles.includes(HOTEL_A) ? [tarifa(HOTEL_A, { neto_nino: netos.nino ?? null, neto_infante: netos.infante ?? null })] : []),
      ...(hoteles.includes(HOTEL_B) ? [tarifa(HOTEL_B, {})] : []),
      ...(hoteles.includes(HOTEL_C) ? [tarifa(HOTEL_C, {})] : []),
    ],
    salidas_dinamicas: [{
      id: 9, paquete_id: PAQUETE_ID, activo: true, compra_inicio: null, compra_fin: null, fecha_ida: EN_30, fecha_regreso: EN_31,
      ruta: "BOG - CTG - BOG", valor_tiquete: o.ticket ?? 904000, aplica_mk: true, ta: 0, fee_infante: o.fee ?? 80000,
    }],
  };
}

type FilaPub = { acomodacion: string | null; modulo: string; hotel_id: number | null; servicio_id: number | null; tipo_tarifa: string | null; precio_pvp: number; precio_pvp_menor2?: number | null; moneda: string };
async function generar(o: Parameters<typeof tablasGenerar>[0] = {}) {
  const c = cliente(tablasGenerar(o));
  sbServidor = c.sb;
  const prevError = console.error;
  console.error = () => {};
  try {
    const r = await generarTarifario(PAQUETE_ID);
    const pub = c.rpcs.find((x) => x.nombre === "publicar_tarifario_resultado");
    return { r, filas: ((pub?.args.p_filas ?? []) as FilaPub[]) };
  } finally {
    console.error = prevError;
    sbServidor = null;
  }
}
const fila = (filas: FilaPub[], acom: string, hotel = HOTEL_A) => filas.find((f) => f.hotel_id === hotel && f.acomodacion === acom);
const TOUR_40 = (extra: Partial<SrvFx> = {}): SrvFx => ({ id: 11, incluido: true, nombre: "Tour incluido", precio_persona: 80000, precio_infante: 40000, ...extra });

describe("generarTarifario() REAL — precio del menor de 2 años por fila", () => {
  test("V0/V3/V6: adulto 1.730.000; infante pvp 1.305.000 y menor2 205.000; niño pvp 1.418.000 y menor2 318.000", async () => {
    const g = await generar({ servicios: [TOUR_40()] });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(fila(g.filas, "doble")!.precio_pvp, 1730000);
    assert.equal(fila(g.filas, "doble")!.precio_pvp_menor2, null, "la habitación adulta no lleva precio de menor de 2");
    assert.equal(fila(g.filas, "infante")!.precio_pvp, 1305000, "pvp conserva su significado: vuelo y servicios de adulto");
    assert.equal(fila(g.filas, "infante")!.precio_pvp_menor2, 205000);
    assert.equal(fila(g.filas, "nino")!.precio_pvp, 1418000);
    assert.equal(fila(g.filas, "nino")!.precio_pvp_menor2, 318000);
    // El total de 2 adultos + 1 infante de 1 año (V3) = 3.665.000 (hoy, con el defecto: 4.765.000)
    assert.equal(2 * fila(g.filas, "doble")!.precio_pvp + fila(g.filas, "infante")!.precio_pvp_menor2!, 3665000);
  });
  test("V1: fee 0 y servicio de infante $0 → el infante de 1 año paga solo el hotel (75.000)", async () => {
    const g = await generar({ fee: 0, servicios: [TOUR_40({ precio_infante: 0 })] });
    assert.equal(fila(g.filas, "infante")!.precio_pvp_menor2, 75000);
  });
  test("V2: fee 80.000 y servicio de infante $0 → 155.000", async () => {
    const g = await generar({ fee: 80000, servicios: [TOUR_40({ precio_infante: 0 })] });
    assert.equal(fila(g.filas, "infante")!.precio_pvp_menor2, 155000);
  });
  test("V4: servicio con precio_infante NULL → el infante paga como ADULTO en el servicio (255.000) y la app avisa", async () => {
    const g = await generar({ servicios: [TOUR_40({ precio_infante: null, nombre: "Tour sin precio de infante" })] });
    assert.equal(fila(g.filas, "infante")!.precio_pvp_menor2, 255000);
    assert.ok(g.r.ok);
    if (g.r.ok) assert.match(g.r.aviso ?? "", /Tour sin precio de infante.*no tiene precio de infante.*pagar[aá]n como adulto/);
  });
  test("con precio de infante configurado (incluso $0) no hay aviso de servicios sin precio", async () => {
    const g = await generar({ servicios: [TOUR_40({ precio_infante: 0 })] });
    assert.ok(g.r.ok);
    if (g.r.ok) assert.doesNotMatch(g.r.aviso ?? "", /precio de infante/);
  });
  test("V5: redondeo regla B — hotel infante neto 61.000 (76.250) + fee 80.500 = 157.500", async () => {
    const g = await generar({ fee: 80500, servicios: [TOUR_40({ precio_infante: 0 })], netos: { doble: 400000, nino: 150000, infante: 61000 } });
    assert.equal(fila(g.filas, "infante")!.precio_pvp_menor2, 157500);
  });
  test("V12: hotel SIN tarifa de infante — se publica la fila (hotel $0): pvp 1.230.000, menor2 130.000", async () => {
    const g = await generar({ hoteles: [HOTEL_B], servicios: [TOUR_40()] });
    assert.equal(fila(g.filas, "infante", HOTEL_B)!.precio_pvp, 1230000);
    assert.equal(fila(g.filas, "infante", HOTEL_B)!.precio_pvp_menor2, 130000);
  });
  test("hotel Adults Only: NO se publica fila de infante", async () => {
    const g = await generar({ hoteles: [HOTEL_C], servicios: [TOUR_40()] });
    assert.ok(fila(g.filas, "doble", HOTEL_C));
    assert.equal(fila(g.filas, "infante", HOTEL_C), undefined);
  });
  test("V11 USD: adulto USD 563; infante pvp 457 y menor2 USD 57 (techo al dólar de hotel+servicio, fee 25 exacto)", async () => {
    const g = await generar({
      moneda: "USD", ticket: 300, fee: 25, netos: { doble: 100, nino: 0, infante: 15 },
      servicios: [{ id: 11, incluido: true, precio_persona: 50, precio_infante: 10, moneda: "USD" }],
    });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(fila(g.filas, "doble")!.precio_pvp, 563);
    assert.equal(fila(g.filas, "infante")!.precio_pvp, 457);
    assert.equal(fila(g.filas, "infante")!.precio_pvp_menor2, 57);
    assert.equal(fila(g.filas, "infante")!.moneda, "USD");
  });
  test("servicios opcionales por persona: la fila publica el PVP del infante; sin precio de infante queda NULL (paga como adulto)", async () => {
    const g = await generar({
      servicios: [
        { id: 21, incluido: false, precio_persona: 80000, precio_infante: 20000, nombre: "Tour opcional" },
        { id: 22, incluido: false, precio_persona: 80000, precio_infante: null, nombre: "Tour opcional sin infante" },
        { id: 23, incluido: false, precio_persona: 80000, precio_infante: 0, nombre: "Tour opcional gratis infante" },
      ],
    });
    const s = (id: number) => g.filas.find((f) => f.servicio_id === id)!;
    assert.equal(s(21).precio_pvp, 100000);
    assert.equal(s(21).precio_pvp_menor2, 25000);
    assert.equal(s(22).precio_pvp_menor2, null);
    assert.equal(s(23).precio_pvp_menor2, 0, "$0 es distinto de NULL");
  });
  test("servicio por GRUPO: ninguna fila lleva precio de infante (el infante no cuenta para el rango ni paga extra)", async () => {
    const g = await generar({
      servicios: [{ id: 31, incluido: false, modo: "grupo", precio_persona: null, precio_infante: 30000, nombre: "Tour grupo" }],
      grupos: [
        { servicio_id: 31, pax_desde: 1, pax_hasta: 2, precio: 500000, temporada: "GENERAL" },
        { servicio_id: 31, pax_desde: 3, pax_hasta: 4, precio: 600000, temporada: "GENERAL" },
      ],
    });
    const filasGrupo = g.filas.filter((f) => f.servicio_id === 31);
    assert.equal(filasGrupo.length, 2);
    assert.ok(filasGrupo.every((f) => f.precio_pvp_menor2 == null));
    assert.deepEqual(filasGrupo.map((f) => f.precio_pvp).sort((a, b) => a - b), [625000, 750000]);
  });
  test("aviso: servicios por persona sin precio de infante se listan; los de grupo no", () => {
    assert.deepEqual(serviciosSinPrecioInfante([
      { nombre: "A", modo: "persona", precioPersona: 1, precioInfante: null },
      { nombre: "B", modo: "persona", precioPersona: 1, precioInfante: 0 },
      { nombre: "C", modo: "grupo", precioPersona: null, precioInfante: null },
      { nombre: "D", modo: "persona", precioPersona: null, precioInfante: null },
    ]), ["A"]);
  });
});

// ─── F · computarReserva REAL (rama cacheada del tarifario) ─────────────────────────────────
const HOTEL = 217;
const CATEGORIA = "Estándar";
const REGIMEN = "PC";

function tablasReserva(o: { menor2?: boolean; conServicios?: boolean; temporadas?: Fila[] } = {}): Tablas {
  const con = o.menor2 !== false;
  const comun = { paquete_id: PAQUETE_ID, hotel_id: HOTEL, categoria: CATEGORIA, regimen: REGIMEN, salida_id: null, empaquetado_id: null, bloqueo_id: null, hotel_nombre: "Hotel 226", destino_nombre: "CARTAGENA", fecha_ida: EN_30, fecha_regreso: EN_31, moneda: "COP", modulo: "porcion_terrestre" };
  return {
    hoteles: [{
      id: HOTEL, modelo_tarifario: "persona", nombre: "Hotel 226", moneda: "COP",
      edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12,
      pax_min: 1, pax_max: 6, nino_nota: null, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null, adults_only: false, pet_friendly: false,
    }],
    armado_paquetes: [{ id: PAQUETE_ID, pct_mk: 0.2, impuesto_fijo: 0, destino_id: 1, tipo: "porcion_terrestre" }],
    tarifario_resultado_publicable: [
      { ...comun, acomodacion: "doble", precio_pvp: 1730000, precio_pvp_menor2: null },
      { ...comun, acomodacion: "nino", precio_pvp: 1418000, precio_pvp_menor2: con ? 318000 : null },
      { ...comun, acomodacion: "infante", precio_pvp: 1305000, precio_pvp_menor2: con ? 205000 : null },
      ...(o.conServicios ? [
        { paquete_id: PAQUETE_ID, modulo: "servicios", servicio_id: 21, servicio_nombre: "Tour persona", tipo_tarifa: "persona", pax_desde: null, pax_hasta: null, precio_pvp: 100000, precio_pvp_menor2: 25000, recargo_individual: 0 },
        { paquete_id: PAQUETE_ID, modulo: "servicios", servicio_id: 22, servicio_nombre: "Tour persona sin infante", tipo_tarifa: "persona", pax_desde: null, pax_hasta: null, precio_pvp: 100000, precio_pvp_menor2: null, recargo_individual: 0 },
        { paquete_id: PAQUETE_ID, modulo: "servicios", servicio_id: 31, servicio_nombre: "Tour grupo", tipo_tarifa: "grupo", pax_desde: 1, pax_hasta: 2, precio_pvp: 625000, precio_pvp_menor2: null, recargo_individual: null },
        { paquete_id: PAQUETE_ID, modulo: "servicios", servicio_id: 31, servicio_nombre: "Tour grupo", tipo_tarifa: "grupo", pax_desde: 3, pax_hasta: 4, precio_pvp: 750000, precio_pvp_menor2: null, recargo_individual: null },
      ] : []),
    ],
    hotel_acomodaciones: [{ hotel_id: HOTEL, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 }],
    hotel_temporadas: [{
      hotel_id: HOTEL, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1,
      compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null,
    }],
    tarifa_hotel: [{
      hotel_id: HOTEL, tipo_habitacion: CATEGORIA, alimentacion: REGIMEN, temporada: "Base",
      neto_sencilla: null, neto_doble: 400000, neto_triple: null, neto_multiple: null, neto_nino: 150000, neto_nino2: null, neto_infante: 60000,
      edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null, notas: null, precio_final_autoritativo: false,
    }],
    armado_servicios: [],
    servicios_adicionales: [
      { id: 21, precio_persona: 80000, precio_infante: 20000, categoria: "tour_traslado", proveedor_id: null },
      { id: 22, precio_persona: 80000, precio_infante: null, categoria: "tour_traslado", proveedor_id: null },
      { id: 31, precio_persona: null, precio_infante: 30000, categoria: "tour_traslado", proveedor_id: null },
    ],
    servicio_temporadas: o.temporadas ?? [],
    servicio_tarifa_pax: [],
  };
}

type EntradaReserva = Parameters<typeof computarReserva>[1];
function entrada(o: Partial<EntradaReserva> & { habitaciones: Record<string, number> }): EntradaReserva {
  return {
    paqueteId: PAQUETE_ID, bloqueoId: null, modulo: "porcion_terrestre", hotelId: HOTEL, categoria: CATEGORIA, regimen: REGIMEN,
    ninos: 0, ninos2: 0, infantes: 0,
    cliente: { nombres: "A", apellidos: "B", tipoDoc: "CC", numeroDoc: "1", telefono: "1", email: "a@b.co" },
    tipoAsesor: "interno", asesorInterno: "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: [],
    ...o,
  } as EntradaReserva;
}
async function reservar(tablas: Tablas, input: EntradaReserva) {
  const c = cliente(tablas);
  adminActual = c.sb;
  try {
    const r = await computarReserva(c.sb as never, input);
    return r;
  } finally {
    adminActual = null;
  }
}

describe("computarReserva() REAL — menores de 2 años", () => {
  test("V3: 2 adultos (1 doble) + 1 infante de 1 año: 3.665.000; paxConSilla 2 (el infante no ocupa silla); totalPax 3", async () => {
    const r = await reservar(tablasReserva(), entrada({ habitaciones: { doble: 1 }, edadesMenores: [1], cantidadMenores: 1 }));
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (r.ok) {
      assert.equal(r.data.precioVenta, 3665000);
      assert.equal(r.data.paxConSilla, 2);
      assert.equal(r.data.totalPax, 3);
      assert.equal(r.data.numMenoresDeDos, 1);
      assert.deepEqual(r.data.menoresDeDos, { infante: 1, nino: 0, nino2: 0 });
      assert.deepEqual(r.data.lineasMenores, [{ clase: "infante", cantidad: 1, tarifa: 205000, menorDeDos: true }]);
    }
  });
  test("V8: niño de 2 años (hotel infante hasta 2 años) paga hotel infante + vuelo y servicios de ADULTO y ocupa silla", async () => {
    const r = await reservar(tablasReserva(), entrada({ habitaciones: { doble: 1 }, edadesMenores: [2], cantidadMenores: 1 }));
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (r.ok) {
      assert.equal(r.data.precioVenta, 2 * 1730000 + 1305000);
      assert.equal(r.data.paxConSilla, 3);
      assert.equal(r.data.totalPax, 3);
      assert.equal(r.data.numMenoresDeDos, 0);
      assert.equal(r.data.numInfantes, 1, "numInfantes sigue siendo la clase del hotel");
      assert.deepEqual(r.data.lineasMenores, [{ clase: "infante", cantidad: 1, tarifa: 1305000, menorDeDos: false }]);
    }
  });
  test("V6: niño de 5 años = clase niño con vuelo y servicios de adulto", async () => {
    const r = await reservar(tablasReserva(), entrada({ habitaciones: { doble: 1 }, edadesMenores: [5], cantidadMenores: 1 }));
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (r.ok) { assert.equal(r.data.precioVenta, 2 * 1730000 + 1418000); assert.equal(r.data.paxConSilla, 3); }
  });
  test("mezcla: infante de 1 año + niño de 2 + niño de 5", async () => {
    const r = await reservar(tablasReserva(), entrada({ habitaciones: { doble: 1 }, edadesMenores: [1, 2, 5], cantidadMenores: 3 }));
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (r.ok) {
      assert.equal(r.data.precioVenta, 2 * 1730000 + 205000 + 1305000 + 1418000);
      assert.equal(r.data.paxConSilla, 4);
      assert.equal(r.data.totalPax, 5);
    }
  });
  test("flujo legado por conteo (sin edades): los infantes declarados son menores de 2 años", async () => {
    const r = await reservar(tablasReserva(), entrada({ habitaciones: { doble: 1 }, infantes: 1 }));
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (r.ok) { assert.equal(r.data.precioVenta, 2 * 1730000 + 205000); assert.equal(r.data.paxConSilla, 2); assert.equal(r.data.numMenoresDeDos, 1); }
  });
  test("tarifario anterior a la 226 (filas sin precio_pvp_menor2) + infante: pide REGENERAR, no cobra el vuelo de adulto", async () => {
    const r = await reservar(tablasReserva({ menor2: false }), entrada({ habitaciones: { doble: 1 }, edadesMenores: [1], cantidadMenores: 1 }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, MENSAJE_TARIFARIO_SIN_INFANTE);
  });
  test("tarifario anterior a la 226 SIN menores: se reserva normal (no pide regenerar)", async () => {
    const r = await reservar(tablasReserva({ menor2: false }), entrada({ habitaciones: { doble: 1 }, edadesMenores: [], cantidadMenores: 0 }));
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (r.ok) assert.equal(r.data.precioVenta, 2 * 1730000);
  });
  test("servicio opcional POR PERSONA: 2 adultos × 100.000 + infante a su precio (25.000) = 225.000; sin precio de infante paga adulto = 300.000", async () => {
    const r = await reservar(tablasReserva({ conServicios: true }), entrada({ habitaciones: { doble: 1 }, edadesMenores: [1], cantidadMenores: 1, servicios: [21, 22] }));
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (r.ok) {
      const p = (id: number) => r.data.serviciosItems.find((s) => s.servicioId === id)!.precio;
      assert.equal(p(21), 2 * 100000 + 25000);
      assert.equal(p(22), 3 * 100000, "NULL ≠ $0: el infante paga como adulto");
      assert.equal(r.data.precioVenta, 2 * 1730000 + 205000 + 225000 + 300000);
    }
  });
  test("servicio POR GRUPO: 4 adultos + 1 infante = rango de 4 (750.000), sin cargo de infante", async () => {
    const r = await reservar(tablasReserva({ conServicios: true }), entrada({ habitaciones: { doble: 2 }, edadesMenores: [1], cantidadMenores: 1, servicios: [31] }));
    assert.ok(r.ok, r.ok ? "" : r.error);
    if (r.ok) {
      assert.equal(r.data.paxConSilla, 4);
      assert.equal(r.data.totalPax, 5);
      assert.equal(r.data.serviciosItems.find((s) => s.servicioId === 31)!.precio, 750000);
      assert.equal(r.data.precioVenta, 4 * 1730000 + 205000 + 750000);
    }
  });
});

describe("computarReserva() REAL — precio de infante por temporada del servicio", () => {
  const temp = (extra: Fila): Fila => ({
    servicio_id: 21, nombre: "ALTA", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", compra_inicio: null, compra_fin: null, prioridad: 5,
    precio_persona: 100000, precio_infante: null, recargo_individual: null, ...extra,
  });
  const precio = async (temporadas: Fila[], id: number) => {
    const r = await reservar(tablasReserva({ conServicios: true, temporadas }), entrada({ habitaciones: { doble: 1 }, edadesMenores: [1], cantidadMenores: 1, servicios: [id] }));
    assert.ok(r.ok, r.ok ? "" : r.error);
    return r.ok ? r.data.serviciosItems.find((x) => x.servicioId === id)!.precio : -1;
  };
  test("la temporada define precio_persona e precio_infante: ambos se escalan contra la tarifa general (adulto ×1,25; infante ×2)", async () => {
    // general: adulto 80.000 → pvp 100.000, infante 20.000 → pvp 25.000. Temporada: adulto 100.000 (×1,25 = 125.000), infante 40.000 (×2 = 50.000).
    assert.equal(await precio([temp({ precio_infante: 40000 })], 21), 2 * 125000 + 50000);
  });
  test("temporada SIN precio_infante: el infante conserva el de la tarifa general (hereda), solo el adulto sube", async () => {
    assert.equal(await precio([temp({ precio_infante: null })], 21), 2 * 125000 + 25000);
  });
  test("servicio sin precio de infante general y temporada CON precio_infante: se usa el de la temporada (30.000 × 1,25 = 37.500)", async () => {
    assert.equal(await precio([temp({ servicio_id: 22, precio_infante: 30000 })], 22), 2 * 125000 + 37500);
  });
  test("servicio sin precio de infante en ningún lado: el infante paga como el adulto de la temporada", async () => {
    assert.equal(await precio([temp({ servicio_id: 22, precio_infante: null })], 22), 3 * 125000);
  });
});

// ─── G · desglose del contrato / cotización ─────────────────────────────────────────────────
describe("calcularResidualServiciosIncluidosPorGrupo con líneas de menores", () => {
  test("las líneas de menores (dos tarifas distintas) reemplazan a los pares numNinos/numInfantes", () => {
    const r = calcularResidualServiciosIncluidosPorGrupo({
      precioVenta: 1730000 + 205000 + 1305000 + 750000,
      lineasHab: [{ pax: 1, pvp: 1730000 }],
      numNinos: 0, tarifaNino: null, numNinos2: 0, tarifaNino2: null, numInfantes: 0, tarifaInfante: null,
      lineasMenores: [{ cantidad: 1, tarifa: 205000 }, { cantidad: 1, tarifa: 1305000 }],
    });
    assert.deepEqual(r, { ok: true, residual: 750000 });
  });
  test("sin lineasMenores conserva el comportamiento de siempre", () => {
    const r = calcularResidualServiciosIncluidosPorGrupo({
      precioVenta: 1000, lineasHab: [{ pax: 1, pvp: 400 }], numNinos: 1, tarifaNino: 100, numNinos2: 0, tarifaNino2: null, numInfantes: 1, tarifaInfante: 50,
    });
    assert.deepEqual(r, { ok: true, residual: 450 });
  });
});
