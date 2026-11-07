// #94/#52 — INTEGRACIÓN entre `cuposDeCarrito` (REAL, sin stub) y la liquidación REAL: `generarTarifario` publica las filas, `computarReserva` las lee y la acción
// reparte a los pasajeros del hotel (adultos de cada acomodación, niños, infante con y sin tarifa). Solo el cliente de Supabase es simulado (tablas en memoria,
// sin red ni SQL). Se compara cada resultado contra la liquidación misma (`computarReserva`): mismos pasajeros, mismo total.
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
const { cuposDeCarrito } = await import("../app/tarifario/checkout/actions.ts");

const fechaBogota = (d: number) => new Date(Date.now() + d * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const EN_30 = fechaBogota(30);
const EN_31 = fechaBogota(31);

type Origen = "salida" | "bloqueo" | "empaquetado";
const ID_FUENTE = 7;
type Opc = { netoNino?: number; netoInfanteHotel?: number; conv?: { trm: number }; origen?: Origen; moneda: "COP" | "USD"; mk?: number; ticket: number; fee: number; netoDoble: number; netoSencilla: number; servicios: { id: number; nombre: string; neto: number; netoInfante: number | null }[] };

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
    tarifa_hotel: [{ hotel_id: HOTEL, tipo_habitacion: CATEGORIA, alimentacion: REGIMEN, temporada: "Base", neto_sencilla: o.netoSencilla, neto_doble: o.netoDoble, neto_triple: null, neto_multiple: null, neto_nino: o.netoNino ?? null, neto_nino2: null, neto_infante: o.netoInfanteHotel ?? null, precio_final_autoritativo: false }],
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
    tarifa_hotel: [{ hotel_id: HOTEL, tipo_habitacion: CATEGORIA, alimentacion: REGIMEN, temporada: "Base", neto_sencilla: o.netoSencilla, neto_doble: o.netoDoble, neto_triple: null, neto_multiple: null, neto_nino: o.netoNino ?? null, neto_nino2: null, neto_infante: o.netoInfanteHotel ?? null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null, notas: null, precio_final_autoritativo: false }],
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

const BASE: Opc = { moneda: "COP", ticket: 904_000, fee: 80_000, netoDoble: 400_000, netoSencilla: 520_000, netoNino: 300_000, servicios: [] };
type Pers = { clave: string; tipo: string; cantidad: number };

async function cuposReales(o: Opc, entrada: { habitaciones: Record<string, number>; ninos?: number; infantes?: number; edades?: number[]; sinFilaInfante?: boolean }) {
  const g = await generar(o);
  // Tarifa de infante no publicada: la fila no existe (no es lo mismo que una fila en $0).
  if (entrada.sinFilaInfante) g.publicadas = g.publicadas.filter((f) => f.acomodacion !== "infante");
  const tablas = { ...tablasReserva(o, g), tarifario_resumen: [], cupos_por_bloqueo: [], hotel_fotos: [] } as Tablas;
  const c = cliente(tablas);
  sbServidor = c.sb; adminActual = c.sb;
  try {
    const adultos = Object.entries(entrada.habitaciones).reduce((s, [a, n]) => s + n * (a === "doble" ? 2 : 1), 0);
    const ninos = entrada.ninos ?? 0, infantes = entrada.infantes ?? 0, edades = entrada.edades ?? [];
    const item = {
      modulo: "dinamico", salidaId: 9, paqueteId: PAQUETE_ID, hotelId: HOTEL, bloqueoId: null, hotelNombre: "Hotel 273", destino: "CARTAGENA",
      categoria: CATEGORIA, regimen: REGIMEN, fechaIda: EN_30, fechaRegreso: EN_31, noches: 1, habitaciones: entrada.habitaciones,
      ninos, ninos2: 0, infantes, pax: adultos + ninos + infantes, precio: 1, edadesMenores: edades, cantidadMenores: edades.length,
    };
    const prev = console.error; console.error = () => {};
    try {
      const real = await cuposDeCarrito({ items: [item], tours: [] }); // REAL: sin stub
      const liquidacion = await computarReserva(c.sb as never, {
        paqueteId: PAQUETE_ID, bloqueoId: null, empaquetadoId: null, salidaId: 9, modulo: "dinamico", hotelId: HOTEL, categoria: CATEGORIA, regimen: REGIMEN,
        fechaIda: EN_30, fechaRegreso: EN_31, habitaciones: entrada.habitaciones, ninos, ninos2: 0, infantes, edadesMenores: edades, cantidadMenores: edades.length,
        cliente: { nombres: "A", apellidos: "B", tipoDoc: "CC", numeroDoc: "1", telefono: "1", email: "a@b.co" },
        tipoAsesor: "interno", asesorInterno: "", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: [],
      } as never);
      return { real, liquidacion };
    } finally { console.error = prev; }
  } finally { sbServidor = null; adminActual = null; }
}

describe("cuposDeCarrito REAL sobre la liquidación REAL", () => {
  test("adultos en acomodaciones distintas + niño: un pasajero por plaza, mismo total que la liquidación", async () => {
    const { real, liquidacion } = await cuposReales(BASE, { habitaciones: { doble: 1, sencilla: 1 }, ninos: 1, edades: [6] });
    assert.ok(liquidacion.ok, liquidacion.ok ? "" : liquidacion.error);
    assert.equal(real.ok, true, (real as { error?: string }).error);
    if (!real.ok || !liquidacion.ok) return;
    const h = real.hoteles[0];
    assert.equal(h.paxTotal, liquidacion.data.totalPax, "el total de pasajeros es el de la liquidación");
    assert.equal(h.cupos.reduce((s, c) => s + c.cantidad, 0), h.paxTotal, "todos identificados");
    const porClave = Object.fromEntries(h.cupos.map((c: Pers) => [c.clave, c.cantidad]));
    assert.equal(porClave["adulto:doble"], 2);
    assert.equal(porClave["adulto:sencilla"], 1);
    assert.equal(h.cupos.filter((c: Pers) => c.tipo === "nino").reduce((s, c) => s + c.cantidad, 0), 1);
    assert.ok(!/neto|tarifa|pvp|precio|\d{4,}/i.test(JSON.stringify(real)), "sin importes ni netos");
    assert.ok(h.cupos.every((c: Pers) => !/\d{4,}/.test(c.clave)), "la clave del pasajero no lleva el precio");
  });

  test("infante CON tarifa configurada: es un pasajero y su clave sale de la línea de la liquidación", async () => {
    const { real, liquidacion } = await cuposReales({ ...BASE, netoInfanteHotel: 50_000 }, { habitaciones: { doble: 1 }, infantes: 1, edades: [1] });
    assert.ok(liquidacion.ok, liquidacion.ok ? "" : liquidacion.error);
    assert.equal(real.ok, true, (real as { error?: string }).error);
    if (!real.ok || !liquidacion.ok) return;
    const h = real.hoteles[0];
    assert.equal(h.paxTotal, 3);
    assert.equal(h.cupos.filter((c: Pers) => c.tipo === "infante").reduce((s, c) => s + c.cantidad, 0), 1);
  });

  test("infante GRATIS (alojamiento en $0): la liquidación lo cobra en cero y sigue siendo un pasajero identificable", async () => {
    const { real, liquidacion } = await cuposReales({ ...BASE, fee: 0, netoInfanteHotel: 0 }, { habitaciones: { doble: 1 }, infantes: 1, edades: [1] });
    assert.ok(liquidacion.ok, liquidacion.ok ? "" : liquidacion.error);
    assert.equal(real.ok, true, (real as { error?: string }).error);
    if (!real.ok || !liquidacion.ok) return;
    const lineaInfante = liquidacion.data.lineasMenores.filter((l: { clase: string }) => l.clase === "infante");
    assert.deepEqual(lineaInfante.map((l: { tarifa: number }) => l.tarifa), [0], "alojamiento del infante en cero");
    const h = real.hoteles[0];
    assert.equal(liquidacion.data.totalPax, 3);
    assert.equal(h.paxTotal, 3);
    assert.deepEqual(h.cupos.filter((c: Pers) => c.tipo === "infante").map((c: Pers) => [c.clave, c.cantidad]), [["infante:menor2", 1]]);
    assert.equal(h.cupos.reduce((s, c) => s + c.cantidad, 0), 3, "adultos + infante");
  });

  test("sin tarifa de infante publicada la liquidación NO continúa y cuposDeCarrito lo dice (no inventa un pasajero ni lo omite)", async () => {
    const { real, liquidacion } = await cuposReales(BASE, { habitaciones: { doble: 1 }, infantes: 1, edades: [1], sinFilaInfante: true });
    assert.equal(liquidacion.ok, false);
    assert.equal(real.ok, false);
    assert.match((real as { error: string }).error, /Regenera el tarifario/);
  });

  test("infante con línea $0 o configurada: la identidad no cambia (solo cambia lo que cuesta)", async () => {
    const a = await cuposReales(BASE, { habitaciones: { doble: 1 }, infantes: 1, edades: [1] });
    const b = await cuposReales({ ...BASE, netoInfanteHotel: 50_000 }, { habitaciones: { doble: 1 }, infantes: 1, edades: [1] });
    assert.ok(a.real.ok && b.real.ok);
    if (!a.real.ok || !b.real.ok) return;
    assert.deepEqual(a.real.hoteles[0].cupos, b.real.hoteles[0].cupos);
  });

  test("la identidad del pasajero NO cambia cuando cambia el precio de su tarifa", async () => {
    const a = await cuposReales(BASE, { habitaciones: { doble: 1 }, ninos: 1, edades: [6] });
    const b = await cuposReales({ ...BASE, netoNino: 350_000, netoDoble: 450_000 }, { habitaciones: { doble: 1 }, ninos: 1, edades: [6] });
    assert.ok(a.real.ok && b.real.ok);
    if (!a.real.ok || !b.real.ok) return;
    assert.deepEqual(a.real.hoteles[0].cupos, b.real.hoteles[0].cupos, "mismas claves y cantidades con otras tarifas");
  });
});
