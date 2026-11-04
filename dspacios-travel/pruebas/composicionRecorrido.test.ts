import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// RECORRIDO COMPLETO de la composición del precio de un tarifario publicado, con el código REAL:
//   generarTarifario()  → guarda la composición (tabla privada 273) y publica las filas
//   computarReserva()   → lee la fila publicada + la composición de la generación publicada → `data.composicion`
// Se verifica que la suma de ventas de cada línea coincida con el precio de su fila de habitación y que el total de las líneas coincida con el total de la cotización,
// en COP y USD. Cliente de Supabase falso (sin red ni SQL).

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

type Fila = Record<string, unknown>;
type Tablas = Record<string, Fila[]>;
type Rpc = { nombre: string; args: Record<string, unknown> };

const GENERACION = 3;
const PAQUETE_ID = 273;
const HOTEL = 1;
const CATEGORIA = "Estándar";
const REGIMEN = "PC";

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
    // Escrituras que usa la composición: upsert por (paquete_id, generacion, clave) y delete de generaciones anteriores.
    b.upsert = (filas: Fila[]) => {
      const t = (tablas[tabla] ??= []);
      for (const f of filas) {
        const i = t.findIndex((x) => x.paquete_id === f.paquete_id && x.generacion === f.generacion && x.clave === f.clave);
        if (i >= 0) t[i] = f; else t.push(f);
      }
      return Promise.resolve({ error: null });
    };
    b.delete = () => ({
      eq: (c: string, v: unknown) => ({
        lt: (c2: string, v2: unknown) => {
          tablas[tabla] = (tablas[tabla] ?? []).filter((r) => !(r[c] === v && Number(r[c2]) < Number(v2)));
          return Promise.resolve({ error: null });
        },
      }),
    });
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (tablas[tabla] === undefined) throw new Error(`fixture incompleto: falta la tabla "${tabla}"`);
      const filas = tablas[tabla].filter((r) => filtros.every((f) => f(r)));
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

const { computarReserva } = await import("@/lib/reservar/computo.ts");
const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const { REGLA_COMPOSICION_PUBLICADA } = await import("../lib/reservar/composicionPublicada.ts");
const { cotizarTarjetaHotel } = await import("../app/tarifario/cotizarTarjetaActions.ts");

const fechaBogota = (d: number) => new Date(Date.now() + d * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const EN_30 = fechaBogota(30);
const EN_31 = fechaBogota(31);

type Origen = "salida" | "bloqueo" | "empaquetado";
const ID_FUENTE = 7;
type Opc = { conv?: { trm: number }; origen?: Origen; moneda: "COP" | "USD"; mk?: number; ticket: number; fee: number; netoDoble: number; netoSencilla: number; servicios: { id: number; nombre: string; neto: number; netoInfante: number | null }[] };

function fuenteVuelo(o: Opc) {
  return { id: ID_FUENTE, destino_id: 1, record: "ABC123", ruta: "BOG - CTG - BOG", fecha_ida: EN_30, fecha_regreso: EN_31, tarifa_para_empaquetar: o.ticket, fee_infante: o.fee, moneda: o.moneda };
}

function tablasGenerar(o: Opc): Tablas {
  const sv = o.servicios;
  return {
    armado_paquetes: [{ id: PAQUETE_ID, nombre: "Dinámico 273", activo: true, destino_id: 1, pct_mk: o.mk ?? 0.2, tipo: o.origen === "salida" || !o.origen ? "dinamico" : "bloqueo", impuesto_tipo: "fijo", impuesto_fijo: 0, noches: 1, destinos: { nombre: "CARTAGENA" }, moneda_publicacion: o.moneda, destinos_aereos_alternativos: false, ...(o.conv ? { modo_oferta: "cop_trm_63", trm_oferta: o.conv.trm } : {}) }],
    armado_vuelos: o.origen === "bloqueo" ? [{ paquete_id: PAQUETE_ID, bloqueo_id: ID_FUENTE, aplica_mk: true, ta: 0, bloqueos_vuelo: fuenteVuelo(o) }] : [],
    armado_empaquetados: o.origen === "empaquetado" ? [{ paquete_id: PAQUETE_ID, empaquetado_id: ID_FUENTE, aplica_mk: true, ta: 0, empaquetados: { ...fuenteVuelo(o), activo: true, compra_inicio: null, compra_fin: null } }] : [],
    armado_servicios: sv.map((s) => ({
      paquete_id: PAQUETE_ID, servicio_id: s.id, modo: "persona", incluido: true,
      servicios_adicionales: { nombre: s.nombre, precio_persona: s.neto, precio_infante: s.netoInfante, liquidacion: "paquete", descripcion: null, recargo_individual: null, moneda: o.conv ? "USD" : o.moneda },
    })),
    servicio_temporadas: sv.map((s) => ({ servicio_id: s.id, nombre: "VIG", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: s.neto, precio_infante: s.netoInfante, recargo_individual: null })),
    servicio_tarifa_pax: [],
    servicios_adicionales: sv.map((s) => ({ id: s.id, tipo_receptivo: null, combo_incluye_traslado: null, combo_traslado_alcance: null })),
    armado_hoteles: [{ paquete_id: PAQUETE_ID, hotel_id: HOTEL, categorias: null, regimenes: null, hoteles: { nombre: "Hotel 273", moneda: o.conv ? "USD" : o.moneda, modelo_tarifario: "persona", adults_only: false } }],
    hotel_temporadas: [{ hotel_id: HOTEL, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, regimen_restringido: null }],
    tarifa_hotel: [{ hotel_id: HOTEL, tipo_habitacion: CATEGORIA, alimentacion: REGIMEN, temporada: "Base", neto_sencilla: o.netoSencilla, neto_doble: o.netoDoble, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, precio_final_autoritativo: false }],
    salidas_dinamicas: !o.origen || o.origen === "salida" ? [{ id: 9, paquete_id: PAQUETE_ID, activo: true, compra_inicio: null, compra_fin: null, fecha_ida: EN_30, fecha_regreso: EN_31, ruta: "BOG - CTG - BOG", valor_tiquete: o.ticket, aplica_mk: true, ta: 0, fee_infante: o.fee, empaquetado_id: null, ...(o.conv ? { moneda: "USD" } : {}) }] : [],
    tarifario_resultado_composicion: [],
    bloqueos_vuelo: o.origen === "bloqueo" ? [fuenteVuelo(o)] : [],
    empaquetados: o.origen === "empaquetado" ? [{ ...fuenteVuelo(o), activo: true, compra_inicio: null, compra_fin: null }] : [],
  };
}

type Resultado = { publicadas: Fila[]; composiciones: Fila[] };
async function generar(o: Opc): Promise<Resultado> {
  const tablas = tablasGenerar(o);
  const g = cliente(tablas);
  sbServidor = g.sb; adminActual = g.sb;
  const prev = console.error; console.error = () => {};
  try {
    const r = await generarTarifario(PAQUETE_ID);
    assert.ok(r.ok, r.ok ? "" : String((r as { error?: string }).error));
    return { publicadas: (g.rpcs.find((x) => x.nombre.startsWith("publicar_tarifario_resultado"))?.args.p_filas ?? []) as Fila[], composiciones: tablas.tarifario_resultado_composicion };
  } finally { console.error = prev; sbServidor = null; adminActual = null; }
}

function tablasReserva(o: Opc, r: Resultado): Tablas {
  const sv = o.servicios;
  return {
    hoteles: [{ id: HOTEL, modelo_tarifario: "persona", tarifa_bajo_solicitud: false, nombre: "Hotel 273", moneda: o.conv ? "USD" : o.moneda, edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12, pax_min: 1, pax_max: 6, nino_nota: null, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null, adults_only: false, pet_friendly: false }],
    armado_paquetes: [{ id: PAQUETE_ID, pct_mk: o.mk ?? 0.2, impuesto_fijo: 0, destino_id: 1, tipo: o.origen === "salida" || !o.origen ? "dinamico" : "bloqueo", tarifario_generacion_publicada: GENERACION, tarifario_revision_publicada: 5, ...(o.conv ? { modo_oferta: "cop_trm_63", trm_oferta: o.conv.trm, moneda_publicacion: o.moneda, impuesto_tipo: "fijo" } : {}) }],
    tarifario_resultado_publicable: r.publicadas.map((f) => ({ paquete_id: PAQUETE_ID, bloqueo_id: null, empaquetado_id: null, salida_id: null, ...f, precio_pvp_menor2: f.precio_pvp_menor2 ?? null })),
    tarifario_resultado_composicion: r.composiciones,
    tarifario_composicion_publicada: [{ paquete_id: PAQUETE_ID, fecha_ida: EN_30, generacion: GENERACION, regla: REGLA_COMPOSICION_PUBLICADA, servicios_incluidos: sv.map((s) => s.id).sort((a, b) => a - b) }],
    salidas_dinamicas: !o.origen || o.origen === "salida" ? [{ id: 9, paquete_id: PAQUETE_ID, activo: true, compra_inicio: null, compra_fin: null, fecha_ida: EN_30, fecha_regreso: EN_31, ruta: "BOG - CTG - BOG", valor_tiquete: o.ticket, aplica_mk: true, ta: 0, fee_infante: o.fee, empaquetado_id: null, ...(o.conv ? { moneda: "USD" } : {}) }] : [],
    armado_hoteles: [{ paquete_id: PAQUETE_ID, hotel_id: HOTEL, categorias: null, regimenes: null, hoteles: { nombre: "Hotel 273", moneda: o.conv ? "USD" : o.moneda, modelo_tarifario: "persona", adults_only: false } }],
    armado_vuelos: [], armado_empaquetados: [], hotel_reglas_descuento: [],
    bloqueos_vuelo: o.origen === "bloqueo" ? [fuenteVuelo(o)] : [],
    empaquetados_basica: o.origen === "empaquetado" ? [{ id: ID_FUENTE, activo: true, compra_inicio: null, compra_fin: null }] : [],
    empaquetados: o.origen === "empaquetado" ? [{ ...fuenteVuelo(o), activo: true, compra_inicio: null, compra_fin: null }] : [],
    hotel_acomodaciones: [
      { hotel_id: HOTEL, acomodacion: "sencilla", pax_tarifa: 1, pax_max: 2, adt_min: 1, adt_max: 1, chd_min: 0, chd_max: 1, inf_min: 0, inf_max: 1 },
      { hotel_id: HOTEL, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 },
    ],
    hotel_temporadas: [{ hotel_id: HOTEL, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null }],
    tarifa_hotel: [{ hotel_id: HOTEL, tipo_habitacion: CATEGORIA, alimentacion: REGIMEN, temporada: "Base", neto_sencilla: o.netoSencilla, neto_doble: o.netoDoble, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null, notas: null, precio_final_autoritativo: false }],
    armado_servicios: sv.map((s) => ({ paquete_id: PAQUETE_ID, servicio_id: s.id, modo: "persona", incluido: true, servicios_adicionales: { nombre: s.nombre, categoria: "otro", precio_persona: s.neto, precio_infante: s.netoInfante, liquidacion: "paquete", proveedor_id: null } })),
    servicios_adicionales: sv.map((s) => ({ id: s.id, nombre: s.nombre, precio_persona: s.neto, precio_infante: s.netoInfante, categoria: "otro", proveedor_id: null, moneda: o.conv ? "USD" : o.moneda })),
    servicio_temporadas: sv.map((s) => ({ servicio_id: s.id, nombre: "VIG", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: s.neto, precio_infante: s.netoInfante, recargo_individual: null })),
    servicio_tarifa_pax: [],
  };
}

async function cotizar(o: Opc, r: Resultado, habitaciones: Record<string, number>) {
  const c = cliente(tablasReserva(o, r));
  adminActual = c.sb;
  try {
    return await computarReserva(c.sb as never, {
      paqueteId: PAQUETE_ID, bloqueoId: o.origen === "bloqueo" ? ID_FUENTE : null, empaquetadoId: o.origen === "empaquetado" ? ID_FUENTE : null, salidaId: !o.origen || o.origen === "salida" ? 9 : null, modulo: !o.origen || o.origen === "salida" ? "dinamico" : "bloqueo", hotelId: HOTEL, categoria: CATEGORIA, regimen: REGIMEN, fechaIda: EN_30, fechaRegreso: EN_31,
      habitaciones, ninos: 0, ninos2: 0, infantes: 0,
      cliente: { nombres: "A", apellidos: "B", tipoDoc: "CC", numeroDoc: "1", telefono: "1", email: "a@b.co" },
      tipoAsesor: "interno", asesorInterno: "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: [],
    } as never);
  } finally { adminActual = null; }
}

const COP: Opc = { moneda: "COP", ticket: 904_000, fee: 80_000, netoDoble: 400_000, netoSencilla: 520_000, servicios: [{ id: 11, nombre: "Tour incluido", neto: 80_000, netoInfante: 40_000 }, { id: 12, nombre: "Asistencia", neto: 41_000, netoInfante: 0 }] };
const USD: Opc = { moneda: "USD", ticket: 211, fee: 19, netoDoble: 101, netoSencilla: 133, servicios: [{ id: 11, nombre: "Tour incluido", neto: 23, netoInfante: 11 }] };

const CASOS = (["salida", "bloqueo", "empaquetado"] as const).flatMap((origen) => [["COP", { ...COP, origen }], ["USD", { ...USD, origen }]] as const);
for (const [nombre, o] of CASOS) {
  describe(`recorrido ${o.origen} (tarifario publicado) · ${nombre}`, () => {
    test("genera y guarda la composición; la cotización la lee y cada línea y el total cuadran", async () => {
      const r = await generar(o);
      assert.ok(r.composiciones.length >= 1, "el generador guardó composición");
      const res = await cotizar(o, r, { sencilla: 1, doble: 2 });
      assert.ok(res.ok, res.ok ? "" : res.error);
      if (!res.ok) return;
      const c = res.data.composicion;
      assert.ok(c, "la cotización lleva composición");
      assert.equal(c!.moneda, nombre);
      assert.ok(c!.cuadra, "líneas + adicionales = total");
      assert.equal(c!.total, res.data.precioVenta);
      assert.equal(c!.lineas.length, 2);
      for (const l of c!.lineas) {
        assert.ok(l.componentes, l.clave);
        const suma = l.componentes!.reduce((t, x) => t + x.venta, 0);
        assert.ok(Math.abs(suma - l.pvpPorPersona) < 0.01, `${l.clave}: ventas ${suma} vs fila ${l.pvpPorPersona}`);
        const fila: { acom: string; pax: number; pvp: number } = res.data.lineasHab.find((x: { acom: string }) => x.acom === l.clave)!;
        assert.equal(l.pvpPorPersona, fila.pvp);
        assert.equal(l.total, fila.pax * fila.pvp);
        const vuelo = l.componentes!.find((x) => x.tipo === "vuelo")!;
        assert.equal(vuelo.neto, o.ticket, "neto del vuelo = costo real del tiquete");
        const servs = l.componentes!.filter((x) => x.tipo === "servicio");
        assert.deepEqual(servs.map((x) => x.nombre), o.servicios.map((s) => s.nombre));
        assert.ok(servs.every((x, i) => x.neto === o.servicios[i].neto));
      }
      assert.equal(c!.lineas.reduce((t, l) => t + l.total, 0), res.data.precioVenta);
    });
    test("si el precio publicado cambió respecto a la composición guardada, la línea NO se descompone", async () => {
      const r = await generar(o);
      const alterada: Resultado = { ...r, publicadas: r.publicadas.map((f) => (f.acomodacion === "doble" ? { ...f, precio_pvp: Number(f.precio_pvp) + 1000 } : f)) };
      const res = await cotizar(o, alterada, { doble: 1 });
      assert.ok(res.ok, res.ok ? "" : res.error);
      if (res.ok) assert.equal(res.data.composicion?.lineas[0].componentes ?? null, null);
    });
    test("sin composición guardada (tarifario anterior): la cotización no inventa nada", async () => {
      const r = await generar(o);
      const res = await cotizar(o, { ...r, composiciones: [] }, { doble: 1 });
      assert.ok(res.ok, res.ok ? "" : res.error);
      if (res.ok) assert.equal(res.data.composicion, null);
    });
    test("la composición de OTRA generación (no la publicada) no se usa", async () => {
      const r = await generar(o);
      const res = await cotizar(o, { ...r, composiciones: r.composiciones.map((c) => ({ ...c, generacion: GENERACION - 1 })) }, { doble: 1 });
      assert.ok(res.ok, res.ok ? "" : res.error);
      if (res.ok) assert.equal(res.data.composicion, null);
    });
  });
}

// ─── Oferta con conversión de moneda: hotel, servicios y tiquete en USD; oferta en COP con TRM ───────────────────────────────────────────
const TRM = 4_000;
const CONV: Opc = { origen: "salida", conv: { trm: TRM }, moneda: "COP", ticket: 200, fee: 20, netoDoble: 100, netoSencilla: 130, servicios: [{ id: 11, nombre: "Tour incluido", neto: 20, netoInfante: 10 }] };

describe("recorrido con conversión de moneda (USD → COP con TRM)", () => {
  test("la composición conserva moneda COP, la TRM, el importe de origen en USD y cuadra con el precio publicado y el total", async () => {
    const r = await generar(CONV);
    assert.ok(r.composiciones.length >= 1, "el generador guardó composición");
    const res = await cotizar(CONV, r, { sencilla: 1, doble: 2 });
    assert.ok(res.ok, res.ok ? "" : res.error);
    if (!res.ok) return;
    const c = res.data.composicion;
    assert.ok(c, "la cotización con conversión lleva composición");
    assert.equal(c!.moneda, "COP");
    assert.equal(c!.trm, TRM);
    assert.ok(c!.cuadra);
    assert.equal(c!.total, res.data.precioVenta);
    for (const l of c!.lineas) {
      assert.ok(l.componentes, l.clave);
      assert.ok(Math.abs(l.componentes!.reduce((t, x) => t + x.venta, 0) - l.pvpPorPersona) < 0.01, l.clave);
      const hotel = l.componentes!.find((x) => x.tipo === "hotel")!;
      assert.equal(hotel.origen?.moneda, "USD");
      assert.equal(hotel.neto, (hotel.origen!.monto) * TRM, "neto en COP = origen USD × TRM");
      const tour = l.componentes!.find((x) => x.tipo === "servicio")!;
      assert.deepEqual(tour.origen, { monto: 20, moneda: "USD" });
      assert.equal(tour.neto, 20 * TRM);
    }
  });
  test("si la TRM de la cotización no es la de la composición guardada, no se compone (nunca se mezcla)", async () => {
    const r = await generar(CONV);
    const res = await cotizar({ ...CONV, conv: { trm: TRM + 100 } }, r, { doble: 1 });
    if (res.ok) assert.equal(res.data.composicion, null);
  });
});

// ─── Porción terrestre cotizada por fechas (se liquida en vivo con el motor; la fila «desde» publicada solo se muestra) ───────────────────────
describe("porción terrestre por fechas: composición del motor en vivo", () => {
  test("hotel y servicios incluidos; sin vuelo; cada línea y el total cuadran (COP y USD)", async () => {
    for (const o of [COP, USD]) {
      const t = tablasReserva({ ...o, origen: "salida" }, { publicadas: [], composiciones: [] });
      t.hotel_blackouts = [];
      t.hotel_reglas_descuento = [];
      t.armado_paquetes = [{ id: PAQUETE_ID, pct_mk: 0.2, impuesto_fijo: 0, destino_id: 1, tipo: "porcion_terrestre", tarifario_generacion_publicada: GENERACION, fecha_viaje_inicio: EN_30, fecha_viaje_fin: EN_31 }];
      const c = cliente(t);
      adminActual = c.sb;
      try {
        const res = await computarReserva(c.sb as never, {
          paqueteId: PAQUETE_ID, bloqueoId: null, empaquetadoId: null, salidaId: null, modulo: "porcion_terrestre", hotelId: HOTEL, categoria: CATEGORIA, regimen: REGIMEN, fechaIda: EN_30, fechaRegreso: EN_31,
          habitaciones: { sencilla: 1, doble: 2 }, ninos: 0, ninos2: 0, infantes: 0,
          cliente: { nombres: "A", apellidos: "B", tipoDoc: "CC", numeroDoc: "1", telefono: "1", email: "a@b.co" },
          tipoAsesor: "interno", asesorInterno: "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: [],
        } as never);
        assert.ok(res.ok, res.ok ? "" : res.error);
        if (!res.ok) return;
        const comp = res.data.composicion;
        assert.ok(comp, `${o.moneda}: lleva composición`);
        assert.equal(comp!.moneda, o.moneda);
        assert.ok(comp!.cuadra);
        assert.equal(comp!.total, res.data.precioVenta);
        for (const l of comp!.lineas) {
          assert.ok(l.componentes, l.clave);
          assert.ok(!l.componentes!.some((x) => x.tipo === "vuelo"), "porción terrestre: sin vuelo");
          assert.ok(Math.abs(l.componentes!.reduce((s, x) => s + x.venta, 0) - l.pvpPorPersona) < 0.01, l.clave);
        }
      } finally { adminActual = null; }
    }
  });
});

// #90 · Tarjeta pública de bloqueo, empaquetado y salida con fecha concreta (30 días de anticipo): precio y etiqueta salen del MISMO cómputo, para cada origen.
describe("tarjeta pública por origen publicado: EBB 1 a 30 días y sin reglas", () => {
  const REGLAS_HOTEL = [{ hotel_id: HOTEL, tipo: "ebb", umbral: 30, pct: 18, activa: true }, { hotel_id: HOTEL, tipo: "ebb", umbral: 60, pct: 23, activa: true }, { hotel_id: HOTEL, tipo: "long_stay", umbral: 4, pct: 25, activa: true }];
  for (const origen of ["salida", "bloqueo", "empaquetado"] as const) {
    test(origen, async () => {
      const o: Opc = { ...COP, origen, servicios: [] };
      const r = await generar(o);
      const base = Number(r.publicadas.find((f) => f.acomodacion === "doble")!.precio_pvp);
      const entrada = { modulo: origen === "salida" ? "dinamico" : "bloqueo", paqueteId: PAQUETE_ID, hotelId: HOTEL, combos: [{ categoria: CATEGORIA, regimen: REGIMEN }],
        ...(origen === "bloqueo" ? { bloqueoId: ID_FUENTE } : origen === "empaquetado" ? { empaquetadoId: ID_FUENTE } : { salidaId: 9 }) };
      const correr = async (reglas: Fila[]) => {
        const t = tablasReserva(o, r); t.hotel_reglas_descuento = reglas;
        const c = cliente(t); adminActual = c.sb; sbServidor = c.sb;
        try { return await cotizarTarjetaHotel(entrada); } finally { adminActual = null; sbServidor = null; }
      };
      const con = await correr(REGLAS_HOTEL);
      assert.ok(con.ok, con.ok ? "" : con.error);
      if (!con.ok) return;
      assert.equal(con.descuentoHotel?.etiqueta, "EBB 1 · 30+ días · 18 %");
      assert.ok(con.precio < base, "el precio visible ya trae el descuento");
      // Es exactamente el precio que cotizaría computarReserva para esa reserva, con las mismas reglas.
      const t = tablasReserva(o, r); t.hotel_reglas_descuento = REGLAS_HOTEL;
      const c2 = cliente(t); adminActual = c2.sb;
      const comp = await computarReserva(c2.sb as never, { paqueteId: PAQUETE_ID, bloqueoId: origen === "bloqueo" ? ID_FUENTE : null, empaquetadoId: origen === "empaquetado" ? ID_FUENTE : null, salidaId: origen === "salida" ? 9 : null, modulo: origen === "salida" ? "dinamico" : "bloqueo", hotelId: HOTEL, categoria: CATEGORIA, regimen: REGIMEN, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, cliente: { nombres: "A", apellidos: "B", tipoDoc: "CC", numeroDoc: "1", telefono: "1", email: "a@b.co" }, tipoAsesor: "interno", asesorInterno: "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: [] } as never);
      adminActual = null;
      assert.ok(comp.ok && comp.data.pvpPorAcom.doble === con.precio);
      const sin = await correr([]);
      assert.ok(sin.ok);
      if (sin.ok) { assert.equal(sin.descuentoHotel, null, "sin reglas no hay etiqueta"); assert.equal(sin.precio, base, "sin descuento el precio es el publicado"); }
    });
  }
});
