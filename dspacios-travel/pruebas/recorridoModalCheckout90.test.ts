import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// #90 / #436 · RECORRIDO tarjeta → modal → carrito → checkout con el código REAL (generarTarifario, computarReserva, cotizarTarjetaHotel, crearSolicitudReserva).
// Solo se simula la frontera externa (Supabase, next/headers) y el precio de UN servicio opcional (liquidarServicioPuntual). En cada paso se compara el importe:
//   1 tarjeta  = cotizarTarjetaHotel (lo que muestra la tarjeta y entrega al modal)
//   2 modal    = lo que arma el modal con ESOS datos (hotel por acomodación + infante con la regla de servicios opcionales, la misma función pura)
//   3 carrito  = item.precio que viaja desde el navegador (aquí a propósito el importe PUBLICADO/viejo: el servidor no debe creerle)
//   4 checkout = crearSolicitudReserva re-liquida con computarReserva y guarda su total
// Con y sin promoción (EBB 1 a 30 días), solo adultos y con infante (+ servicio opcional que sí le cobra).

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

type Fila = Record<string, unknown>;
type Tablas = Record<string, Fila[]>;
type Rpc = { nombre: string; args: Record<string, unknown> };
const inserts: { tabla: string; fila: Fila }[] = [];

const GENERACION = 3, PAQUETE_ID = 273, HOTEL = 1, SALIDA = 9;
const CATEGORIA = "Estándar", REGIMEN = "PC";
const FIJO_INFANTE = 150_000;

function cliente(tablas: Tablas) {
  const rpcs: Rpc[] = [];
  function from(tabla: string) {
    const filtros: ((r: Fila) => boolean)[] = [];
    let uno = false;
    let esInsert = false;
    const b: Record<string, unknown> = {};
    b.select = () => b; b.order = () => b; b.range = () => b; b.limit = () => b; b.not = () => b;
    b.eq = (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return b; };
    b.in = (c: string, v: unknown[]) => { filtros.push((r) => v.includes(r[c])); return b; };
    b.is = (c: string, v: unknown) => { filtros.push((r) => (r[c] ?? null) === v); return b; };
    b.single = () => { uno = true; return b; };
    b.maybeSingle = () => { uno = true; return b; };
    b.insert = (fila: Fila) => { inserts.push({ tabla, fila }); esInsert = true; return b; };
    b.upsert = (filas: Fila[]) => {
      const t = (tablas[tabla] ??= []);
      for (const f of filas) {
        const i = t.findIndex((x) => x.paquete_id === f.paquete_id && x.generacion === f.generacion && x.clave === f.clave);
        if (i >= 0) t[i] = f; else t.push(f);
      }
      return Promise.resolve({ error: null });
    };
    b.delete = () => ({ eq: (c: string, v: unknown) => ({ lt: (c2: string, v2: unknown) => { tablas[tabla] = (tablas[tabla] ?? []).filter((r) => !(r[c] === v && Number(r[c2]) < Number(v2))); return Promise.resolve({ error: null }); } }) });
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (esInsert) return Promise.resolve({ data: { id: 77, codigo: "COT-77", share_token: "tok" }, error: null }).then(res, rej);
      const filas = (tablas[tabla] ?? []).filter((r) => filtros.every((f) => f(r)));
      return Promise.resolve({ data: uno ? (filas[0] ?? null) : filas, error: null }).then(res, rej);
    };
    return b;
  }
  async function rpc(nombre: string, args: Record<string, unknown>) {
    rpcs.push({ nombre, args });
    if (nombre === "iniciar_generacion_tarifario") return { data: [{ generacion: GENERACION, revision_capturada: 5 }], error: null };
    if (nombre === "publicar_tarifario_resultado" || nombre === "publicar_tarifario_resultado_63") return { data: true, error: null };
    return { data: null, error: null };
  }
  return { sb: { from, rpc, auth: { getUser: async () => ({ data: { user: null }, error: null }) } }, rpcs };
}

let actual: ReturnType<typeof cliente>["sb"] | null = null;
const usar = () => { if (!actual) throw new Error("cliente no preparado"); return actual; };
// Precio del servicio opcional que "cotiza" el servidor.
let TOTAL_SERVICIO = 0;
const real = await import("../lib/reservar/cotizar.ts");
mock.module("@/lib/reservar/cotizar", {
  namedExports: {
    ...real,
    liquidarServicioPuntual: async (t: { paqueteId: number; servicioId: number; pax: number }) => ({
      ok: true,
      resultado: { servicioId: t.servicioId, paqueteId: t.paqueteId, nombre: "Tour opcional", destino: "CARTAGENA", descripcion: null, total: TOTAL_SERVICIO, pax: t.pax, noches: 1, moneda: "COP", categoria: "tour" },
    }),
  },
});
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: usar } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => usar() } });
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]) } });
register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, n) {
     if (s === "next/cache") return { url: "data:text/javascript,export const revalidatePath=()=>{};export const revalidateTag=()=>{};", shortCircuit: true };
     return n(s, c);
   }`
));

const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const { cotizarTarjetaHotel } = await import("../app/tarifario/cotizarTarjetaActions.ts");
const { crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");
const { precioInfanteConServiciosOpcionales } = await import("../lib/paquetes/pvpInfanteFijo.ts");
const { computarReserva } = await import("../lib/reservar/computo.ts");
const { costoHotelPersona } = await import("../lib/reservar/costosObligacionesCarrito.ts");
const { aplicarDescuentoNeta } = await import("../lib/calc/descuentoHotel.ts");
const { marcar, redondearVenta } = await import("../lib/calc/paquetes.ts");
const { REGLA_COMPOSICION_PUBLICADA } = await import("../lib/reservar/composicionPublicada.ts");

const fechaBogota = (d: number) => new Date(Date.now() + d * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const IDA = fechaBogota(30), REG = fechaBogota(31);
const TICKET = 904_000, NETO_DOBLE = 400_000, NETO_SENCILLA = 520_000, NETO_INFANTE = 50_000;
const REGLAS = [{ hotel_id: HOTEL, tipo: "ebb", umbral: 30, pct: 18, activa: true }];

function tablasGenerar(): Tablas {
  return {
    armado_paquetes: [{ id: PAQUETE_ID, nombre: "Dinámico 273", activo: true, destino_id: 1, pct_mk: 0.2, tipo: "dinamico", impuesto_tipo: "fijo", impuesto_fijo: 0, noches: 1, destinos: { nombre: "CARTAGENA" }, moneda_publicacion: "COP", destinos_aereos_alternativos: false, pvp_infante_fijo: FIJO_INFANTE }],
    armado_vuelos: [], armado_empaquetados: [], armado_servicios: [], servicio_temporadas: [], servicio_tarifa_pax: [], servicios_adicionales: [],
    armado_hoteles: [{ paquete_id: PAQUETE_ID, hotel_id: HOTEL, categorias: null, regimenes: null, hoteles: { nombre: "Hotel 273", moneda: "COP", modelo_tarifario: "persona", adults_only: false } }],
    hotel_temporadas: [{ hotel_id: HOTEL, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, regimen_restringido: null }],
    tarifa_hotel: [{ hotel_id: HOTEL, tipo_habitacion: CATEGORIA, alimentacion: REGIMEN, temporada: "Base", neto_sencilla: NETO_SENCILLA, neto_doble: NETO_DOBLE, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: NETO_INFANTE, precio_final_autoritativo: false }],
    salidas_dinamicas: [{ id: SALIDA, paquete_id: PAQUETE_ID, activo: true, compra_inicio: null, compra_fin: null, fecha_ida: IDA, fecha_regreso: REG, ruta: "BOG - CTG - BOG", valor_tiquete: TICKET, aplica_mk: true, ta: 0, fee_infante: 0, empaquetado_id: null }],
    tarifario_resultado_composicion: [], bloqueos_vuelo: [], empaquetados: [],
  };
}

type Publicado = { publicadas: Fila[]; composiciones: Fila[] };
async function publicar(): Promise<Publicado> {
  const tablas = tablasGenerar();
  const g = cliente(tablas);
  actual = g.sb;
  const prev = console.error; console.error = () => {};
  try {
    const r = await generarTarifario(PAQUETE_ID);
    assert.ok(r.ok, r.ok ? "" : String((r as { error?: string }).error));
    return { publicadas: (g.rpcs.find((x) => x.nombre.startsWith("publicar_tarifario_resultado"))?.args.p_filas ?? []) as Fila[], composiciones: tablas.tarifario_resultado_composicion };
  } finally { console.error = prev; actual = null; }
}

function tablasReserva(p: Publicado, reglas: readonly Fila[]): Tablas {
  return {
    hoteles: [{ id: HOTEL, modelo_tarifario: "persona", tarifa_bajo_solicitud: false, nombre: "Hotel 273", moneda: "COP", edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12, pax_min: 1, pax_max: 6, nino_nota: null, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null, adults_only: false, pet_friendly: false }],
    armado_paquetes: [{ id: PAQUETE_ID, pct_mk: 0.2, impuesto_fijo: 0, destino_id: 1, tipo: "dinamico", tarifario_generacion_publicada: GENERACION, tarifario_revision_publicada: 5, pvp_infante_fijo: FIJO_INFANTE }],
    tarifario_resultado_publicable: p.publicadas.map((f) => ({ paquete_id: PAQUETE_ID, bloqueo_id: null, empaquetado_id: null, salida_id: null, ...f, precio_pvp_menor2: f.precio_pvp_menor2 ?? null })),
    tarifario_resultado_composicion: p.composiciones,
    tarifario_composicion_publicada: [{ paquete_id: PAQUETE_ID, fecha_ida: IDA, generacion: GENERACION, regla: REGLA_COMPOSICION_PUBLICADA, servicios_incluidos: [] }],
    salidas_dinamicas: [{ id: SALIDA, paquete_id: PAQUETE_ID, activo: true, compra_inicio: null, compra_fin: null, fecha_ida: IDA, fecha_regreso: REG, ruta: "BOG - CTG - BOG", valor_tiquete: TICKET, aplica_mk: true, ta: 0, fee_infante: 0, empaquetado_id: null }],
    armado_hoteles: [{ paquete_id: PAQUETE_ID, hotel_id: HOTEL, categorias: null, regimenes: null, hoteles: { nombre: "Hotel 273", moneda: "COP", modelo_tarifario: "persona", adults_only: false } }],
    armado_vuelos: [], armado_empaquetados: [], armado_servicios: [], servicios_adicionales: [], servicio_temporadas: [], servicio_tarifa_pax: [],
    hotel_reglas_descuento: [...reglas], bloqueos_vuelo: [], empaquetados_basica: [], empaquetados: [],
    hotel_acomodaciones: [
      { hotel_id: HOTEL, acomodacion: "sencilla", pax_tarifa: 1, pax_max: 2, adt_min: 1, adt_max: 1, chd_min: 0, chd_max: 1, inf_min: 0, inf_max: 1 },
      { hotel_id: HOTEL, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 },
    ],
    hotel_temporadas: [{ hotel_id: HOTEL, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null }],
    tarifa_hotel: [{ hotel_id: HOTEL, tipo_habitacion: CATEGORIA, alimentacion: REGIMEN, temporada: "Base", neto_sencilla: NETO_SENCILLA, neto_doble: NETO_DOBLE, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: NETO_INFANTE, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null, notas: null, precio_final_autoritativo: false }],
  };
}

const entradaTarjeta = { modulo: "dinamico", paqueteId: PAQUETE_ID, hotelId: HOTEL, salidaId: SALIDA, combos: [{ categoria: CATEGORIA, regimen: REGIMEN }] };
const clienteCk = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };

type Doc = { adultos: number; ninos: number; tarifa_adulto: number; tarifa_nino: number; descripcion: string };
const sumaDoc = (items: Doc[]) => items.reduce((s, i) => s + i.adultos * i.tarifa_adulto + i.ninos * i.tarifa_nino, 0);

async function recorrido(p: Publicado, reglas: readonly Fila[], opts: { infante: boolean; servicio: number }) {
  actual = cliente(tablasReserva(p, reglas)).sb;
  inserts.length = 0; TOTAL_SERVICIO = opts.servicio;
  const prev = console.error; console.error = () => {};
  try {
    // 1 · tarjeta
    const t = await cotizarTarjetaHotel(entradaTarjeta);
    assert.ok(t.ok, t.ok ? "" : t.error);
    if (!t.ok) throw new Error("tarjeta");
    const combo = t.combos[0];
    // 2 · modal con los datos de la tarjeta (hotel + infante con la misma función pura que EditorPax)
    const opcionales = opts.servicio > 0 ? [{ categoria: "tour", modo: "persona" as const, personaPvp: opts.servicio, infantePvp: null }] : [];
    const tarifaInfante = combo.preciosMenor2.infante ?? combo.precios.infante;
    const infanteModal = opts.infante ? precioInfanteConServiciosOpcionales(tarifaInfante, combo.infanteSinFijo.menor2, opcionales, true) : 0;
    const modal = 2 * combo.precios.doble + infanteModal;
    // 3 · carrito: el navegador manda un importe VIEJO a propósito (publicado); el servidor no debe usarlo.
    const publicado = Number(p.publicadas.find((f) => f.acomodacion === "doble")!.precio_pvp);
    const item = {
      modulo: "dinamico", paqueteId: PAQUETE_ID, hotelId: HOTEL, bloqueoId: null, salidaId: SALIDA, itemId: "hA", hotelNombre: "Hotel 273", destino: "CARTAGENA",
      categoria: CATEGORIA, regimen: REGIMEN, fechaIda: IDA, fechaRegreso: REG, noches: 1, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0,
      pax: opts.infante ? 3 : 2, precio: 2 * publicado, edadesMenores: opts.infante ? [1] : [], cantidadMenores: opts.infante ? 1 : 0,
    };
    const tours = opts.servicio > 0 ? [{ servicioId: 55, paqueteId: PAQUETE_ID, fechaIda: IDA, fechaRegreso: REG, pax: opts.infante ? 3 : 2, hotelItemId: "hA" }] : [];
    // 4 · checkout
    const r = await crearSolicitudReserva({ items: [item], tours, cliente: clienteCk }) as { ok: boolean; error?: string };
    assert.ok(r.ok, r.error);
    const cot = inserts.filter((i) => i.tabla === "cotizaciones").map((i) => i.fila)[0];
    const items = (cot.detalle as { items: Doc[] }).items;
    // Costo del contrato y CxP del hotel: las funciones que usa la conversión del carrito, sobre el mismo cómputo que el checkout.
    const comp = await computarReserva(usar() as never, {
      paqueteId: PAQUETE_ID, bloqueoId: null, empaquetadoId: null, salidaId: SALIDA, modulo: "dinamico", hotelId: HOTEL, categoria: CATEGORIA, regimen: REGIMEN,
      habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: item.edadesMenores, cantidadMenores: item.cantidadMenores,
      cliente: { nombres: "A", apellidos: "B", tipoDoc: "CC", numeroDoc: "1", telefono: "1", email: "a@b.co" },
      tipoAsesor: "interno", asesorInterno: "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", aliadoId: null, plazo: "", pasajeros: [], servicios: [],
      opcionalesInfante: opcionales,
    } as never);
    assert.ok(comp.ok, comp.ok ? "" : comp.error);
    const costoHotel = comp.ok ? costoHotelPersona(comp.data, comp.data.numInfantes) : NaN;
    return { tarjeta: t, combo, costoHotel, modal, infanteModal, servicio: opts.servicio, publicadoDoble: publicado, hotelCheckout: sumaDoc(items), items };
  } finally { console.error = prev; actual = null; }
}

describe("recorrido tarjeta → modal → carrito → checkout (código real)", () => {
  for (const [nombre, reglas, conPromo] of [["con promoción EBB 1", REGLAS, true], ["sin promoción", [], false]] as const) {
    test(`solo adultos · ${nombre}: tarjeta = modal = checkout; el carrito viejo (publicado) no se cree`, async () => {
      const p = await publicar();
      const x = await recorrido(p, reglas, { infante: false, servicio: 0 });
      assert.equal(x.tarjeta.descuentoHotel?.etiqueta ?? null, conPromo ? "EBB 1 · 30+ días · 18 %" : null);
      assert.equal(2 * x.tarjeta.precio, x.modal, "modal = 2 × precio de la tarjeta");
      assert.equal(x.hotelCheckout, x.modal, "checkout re-liquida y coincide con el modal");
      if (conPromo) assert.ok(x.modal < 2 * x.publicadoDoble, "con promoción el importe es menor al publicado");
      else assert.equal(x.modal, 2 * x.publicadoDoble, "sin promoción es exactamente el publicado");
    });

    test(`con infante (fijo) · ${nombre}: sin servicio opcional el infante conserva el fijo en los 4 pasos`, async () => {
      const p = await publicar();
      const x = await recorrido(p, reglas, { infante: true, servicio: 0 });
      assert.equal(x.modal, 2 * x.tarjeta.precio + x.combo.preciosMenor2.infante, "modal: doble × 2 + infante");
      assert.equal(x.hotelCheckout, x.modal);
    });

    test(`con infante + servicio opcional que le cobra · ${nombre}: vuelve a la fórmula normal; modal = checkout`, async () => {
      const p = await publicar();
      const x = await recorrido(p, reglas, { infante: true, servicio: 90_000 });
      assert.notEqual(x.combo.infanteSinFijo.menor2, null, "el fijo estaba aplicado: existe la fórmula normal");
      assert.notEqual(x.infanteModal, x.combo.preciosMenor2.infante, "el servicio le cobra: ya no es el fijo");
      assert.equal(x.infanteModal, x.combo.infanteSinFijo.menor2);
      // La fila del infante en el documento es exactamente la que mostró el modal; el servicio opcional se suma aparte.
      assert.equal(x.items.find((i) => i.ninos > 0 && /Infante/.test(i.descripcion))?.tarifa_nino, x.infanteModal);
      assert.equal(x.hotelCheckout - x.servicio, x.modal, `checkout sin el servicio (${x.hotelCheckout - x.servicio}) vs modal (${x.modal})`);
      console.log(`[${nombre}] doble=${x.tarjeta.precio} publicadoDoble=${x.publicadoDoble} infanteFijo=${x.combo.preciosMenor2.infante} infanteNormal=${x.combo.infanteSinFijo.menor2}`);
    });
  }
});

// ─── Precio normal del infante con la promoción (independiente del código bajo prueba) ──────────────────────────────────────────────────────────────────
// Menor de 2 años: hotel marcado sobre la neta (descontada) + servicios del infante (ninguno aquí), redondeo de venta, y el fee de infante exacto (0 aquí).
const normalEsperado = (conPromo: boolean) => {
  const neto = conPromo ? aplicarDescuentoNeta(NETO_INFANTE, { tipo: "ebb", umbral: 30, pct: 18 }, "COP") : NETO_INFANTE;
  return redondearVenta(marcar(neto, 0.2), "COP");
};

describe("precio normal del infante (servicio opcional que le cobra): lleva el EBB / Long Stay; el fijo no", () => {
  test("valores esperados con neta de hotel del infante positiva", () => {
    assert.equal(normalEsperado(false), 63_000);
    assert.equal(normalEsperado(true), 52_000);
  });
  for (const [nombre, reglas, conPromo] of [["con promoción", REGLAS, true], ["sin promoción", [], false]] as const) {
    test(`${nombre}: el normal descontado es el que ve el modal, el que cobra el checkout, y el costo del contrato / CxP lleva la misma neta descontada`, async () => {
      const p = await publicar();
      const con = await recorrido(p, reglas, { infante: true, servicio: 90_000 });
      const sin = await recorrido(p, reglas, { infante: true, servicio: 0 });
      const nd = (n: number) => (conPromo ? aplicarDescuentoNeta(n, { tipo: "ebb", umbral: 30, pct: 18 }, "COP") : n);
      // Con servicio que le cobra: fórmula normal (con promoción si hay); modal = documento del checkout.
      assert.equal(con.combo.infanteSinFijo.menor2, normalEsperado(conPromo));
      assert.equal(con.infanteModal, normalEsperado(conPromo));
      assert.equal(con.items.find((i) => i.ninos > 0)?.tarifa_nino, normalEsperado(conPromo), "checkout cobra el normal recompuesto");
      // Sin servicio (o con uno gratuito): el PVP fijo queda INTACTO, con y sin promoción.
      assert.equal(sin.infanteModal, FIJO_INFANTE);
      assert.equal(sin.items.find((i) => i.ninos > 0)?.tarifa_nino, FIJO_INFANTE);
      assert.equal(sin.combo.preciosMenor2.infante, FIJO_INFANTE);
      // Costo del contrato / CxP del hotel: neta descontada de la doble × 2 pax + neta del infante; no depende de qué fórmula de PVP rija.
      const costoEsperado = 2 * nd(NETO_DOBLE) + nd(NETO_INFANTE);
      assert.equal(con.costoHotel, costoEsperado);
      assert.equal(sin.costoHotel, costoEsperado);
    });
  }

  test("sin ninguna regla vigente el normal es exactamente el publicado (63.000)", async () => {
    const p = await publicar();
    const x = await recorrido(p, [], { infante: true, servicio: 90_000 });
    assert.equal(x.combo.infanteSinFijo.menor2, Number(p.publicadas.find((f) => f.acomodacion === "infante")!.precio_pvp_menor2_sin_fijo));
  });

  test("si la composición no reproduce el normal publicado, la cotización falla cerrada (no inventa un precio)", async () => {
    const p = await publicar();
    const alterada: Publicado = { ...p, publicadas: p.publicadas.map((f) => (f.acomodacion === "infante" ? { ...f, precio_pvp_menor2_sin_fijo: Number(f.precio_pvp_menor2_sin_fijo) + 1000 } : f)) };
    actual = cliente(tablasReserva(alterada, REGLAS)).sb;
    const r = await cotizarTarjetaHotel(entradaTarjeta);
    actual = null;
    assert.equal(r.ok, false);
  });

  // Camino por fechas (porción terrestre): se liquida en vivo con la neta ya descontada; el normal debe coincidir con el del camino publicado para el menor de 2 años.
  for (const [nombre, reglas, conPromo] of [["con promoción", REGLAS, true], ["sin promoción", [], false]] as const) {
    test(`porción terrestre por fechas · ${nombre}: infanteSinFijo ya trae la promoción y coincide con el camino publicado`, async () => {
      const p = await publicar();
      const t = tablasReserva(p, reglas);
      t.hotel_blackouts = [];
      t.armado_paquetes = [{ id: PAQUETE_ID, pct_mk: 0.2, impuesto_fijo: 0, destino_id: 1, tipo: "porcion_terrestre", tarifario_generacion_publicada: GENERACION, fecha_viaje_inicio: IDA, fecha_viaje_fin: REG, pvp_infante_fijo: FIJO_INFANTE }];
      actual = cliente(t).sb;
      const prev = console.error; console.error = () => {};
      try {
        const r = await computarReserva(usar() as never, {
          paqueteId: PAQUETE_ID, bloqueoId: null, empaquetadoId: null, salidaId: null, modulo: "porcion_terrestre", hotelId: HOTEL, categoria: CATEGORIA, regimen: REGIMEN, fechaIda: IDA, fechaRegreso: REG,
          habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: [1], cantidadMenores: 1,
          cliente: { nombres: "A", apellidos: "B", tipoDoc: "CC", numeroDoc: "1", telefono: "1", email: "a@b.co" },
          tipoAsesor: "interno", asesorInterno: "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", aliadoId: null, plazo: "", pasajeros: [], servicios: [],
        } as never);
        assert.ok(r.ok, r.ok ? "" : r.error);
        if (!r.ok) return;
        assert.equal(r.data.pvpInfanteSinFijo.menor2, normalEsperado(conPromo));
        assert.equal(r.data.pvpMenor2PorAcom.infante, FIJO_INFANTE, "el fijo no cambia");
      } finally { console.error = prev; actual = null; }
    });
  }
});
