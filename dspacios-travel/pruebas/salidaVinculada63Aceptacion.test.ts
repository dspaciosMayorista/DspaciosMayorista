import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  armarItems63, armarTramos63, construirObligaciones63, construirPlanB2b63, construirSnapshot63, detalleAcomodacion63, huellaFinanciera63, jsonCanonico63,
  normalizarVigencias63,
  leerAceptacion63, mapearErrorRpc63, MENSAJE_CAMBIO_ACEPTACION_63, MENSAJE_OFERTA_CERRADA_63, MENSAJE_TECNICO_63,
} from "../lib/reservar/aceptacion63.ts";
import { aceptarOferta63, crearCotizacionOferta63, leerRevisiones63, ventaExiste63 } from "../lib/reservar/aceptacionServidor63.ts";
import { resolverImporteContable63 } from "../lib/reservar/importeObligacion63.ts";
import { camposCxP63 } from "../lib/reservar/payloadFinanciero63.ts";

// #63 (E/F/G) · piezas PURAS de la aceptación: snapshot, huellas, claves de obligación, lectura/mapeo de las RPC y el importe contable.
// La base (candados, triggers, ACL, reloj) se prueba en supabase/scripts/test_227_salida_vinculada.sql; el orquestador, en
// salidaVinculada63Reserva.react.ts con las RPC simuladas de forma estricta.

const TRM = 4000;
const cxp = (over: Record<string, unknown> = {}) => ({
  proveedor: "Hotel SAS", tipo_proveedor: "hotel", servicio: "Hotel X", valor_total: 210, fecha_obligacion: "2030-01-01", aplica_retencion: true,
  pct_retencion: 0.035, observaciones: "Generado automáticamente desde el tarifario", servicio_id: null, ...camposCxP63({ valor: 210, moneda: "USD" }, TRM), ...over,
});

describe("claves estables de obligación y snapshot", () => {
  test("hotel y aéreo van por orden de aparición del tipo; los servicios del catálogo, por su servicio_id", () => {
    const o = construirObligaciones63([
      cxp(), cxp({ tipo_proveedor: "aereo", servicio: "Aéreo", proveedor: "AERO", valor_total: 2080500, ...camposCxP63({ valor: 2080500, moneda: "COP" }, TRM) }),
      cxp({ tipo_proveedor: "receptivo", servicio_id: 900, servicio: "Tour" }), cxp({ tipo_proveedor: "receptivo", servicio_id: 901, servicio: "Tour 2" }),
    ], TRM);
    assert.deepEqual(o.map((x) => x.obligacion), ["hotel:0", "aereo:0", "receptivo:s900", "receptivo:s901"]);
  });
  test("dos obligaciones del MISMO proveedor y tipo con moneda distinta no se mezclan (claves distintas)", () => {
    const o = construirObligaciones63([cxp(), cxp({ ...camposCxP63({ valor: 210, moneda: "COP" }, TRM) })], TRM);
    assert.equal(new Set(o.map((x) => x.obligacion)).size, 2);
    assert.deepEqual(o.map((x) => x.moneda), ["USD", "COP"]);
    assert.deepEqual(o.map((x) => x.valor_cop), [840000, 210], "USD × TRM y COP tal cual: nunca se suman nominalmente");
  });
  test("una clave repetida se desambigua (sin colisión)", () => {
    const o = construirObligaciones63([cxp({ servicio_id: 5 }), cxp({ servicio_id: 5 })], TRM);
    assert.deepEqual(o.map((x) => x.obligacion), ["hotel:s5", "hotel:s5#1"]);
  });
  test("la obligación del snapshot NO lleva fecha de obligación (la pone la base con la fecha de negocio de la aceptación)", () => {
    const [o] = construirObligaciones63([cxp()], TRM);
    assert.equal("fecha_obligacion" in o, false);
    assert.equal("fecha_vencimiento" in o, false);
  });
  test("el snapshot cuenta los hijos que la base exigirá antes de aceptar el pendiente", () => {
    const s = construirSnapshot63({
      paqueteId: 1, salidaId: 2, empaquetadoId: 3, trm: TRM,
      cabecera: { tipo_paquete: "dinamico", moneda: "COP", fecha_salida: "2030-01-10", fecha_regreso: "2030-01-13", pax: 2, destino: "CARTAGENA", hotel: "H", precio_venta: 3360000, impuesto: 2260000, costo_aereo: 2080500, aerolinea: "A", plan_nombre: "E · PC", paquete_armado_id: 1, tipo_asesor: "interno", canal: "B2C" },
      b2b: null, vigencias: [],
      hotel: { nombre: "H", categoria: "E", proveedor: "P", ciudad: "CARTAGENA", alimentacion: "PC", acomodacion: "E", detalle_acomodacion: "1 hab Doble (2 pax)", fecha_ingreso: "2030-01-10", fecha_salida: "2030-01-13", orden: 0 },
      tramos: armarTramos63({ aerolinea: "A", record: null, ruta: "BOG - CTG - BOG", fecha_ida: "2030-01-10", fecha_regreso: "2030-01-13", vuelo_ida: null, vuelo_regreso: null, hora_salida_ida: null, hora_llegada_ida: null, hora_salida_reg: null, hora_llegada_reg: null }),
      items: armarItems63({ categoria: "E", regimen: "PC", lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: 1680000 }], lineasMenores: [], serviciosItems: [{ nombre: "Tour", precio: 50000 }], cargoMascota: null }),
      costos: { costo_hotel: 840000 }, cxp: [cxp()], resumen: { tours_traslados: null, asistencia_medica: false },
    });
    assert.deepEqual([s.cabecera.n_tramos, s.cabecera.n_items, s.cabecera.n_hoteles], [2, 2, 1]);
    assert.equal(s.moneda, "COP");
    assert.deepEqual(s.tramos.map((t) => t.direccion), ["ida", "regreso"]);
    assert.deepEqual([s.tramos[1].origen_codigo, s.tramos[1].destino_codigo], ["CTG", "BOG"], "el regreso invierte origen y destino");
    assert.deepEqual(s.items.map((i) => i.orden), [0, 100]);
  });
  test("un paquete tipo servicios (sin hotel) no espera fila de hotel", () => {
    const s = construirSnapshot63({
      paqueteId: 1, salidaId: null, empaquetadoId: null, trm: TRM,
      cabecera: { tipo_paquete: "servicios", moneda: "COP", fecha_salida: null, fecha_regreso: null, pax: 1, destino: null, hotel: null, precio_venta: 1, impuesto: 0, costo_aereo: 0, aerolinea: null, plan_nombre: "x", paquete_armado_id: 1, tipo_asesor: "interno", canal: "B2C" },
      b2b: null, vigencias: [],
      hotel: null, tramos: [], items: [], costos: {}, cxp: [], resumen: { tours_traslados: null, asistencia_medica: false },
    });
    assert.deepEqual([s.cabecera.n_tramos, s.cabecera.n_items, s.cabecera.n_hoteles], [0, 0, 0]);
  });
  test("detalleAcomodacion63 repite el texto legible de siempre", () => {
    assert.equal(
      detalleAcomodacion63({ lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2 }], numNinos: 1, numNinos2: 0, infantes: 1, mascotas: 2 }),
      "1 hab Doble (2 pax), 1 Niño 1, 1 Infante(s), 2 Mascota(s)",
    );
  });
});

describe("huella financiera: cualquier cambio de costo, proveedor, retención o moneda con el PVP igual la mueve", () => {
  const base = () => ({ costos: { costo_hotel: 840000 }, cxp: construirObligaciones63([cxp()], TRM) });
  const h0 = huellaFinanciera63(base());
  test("es determinista y no depende del orden de las claves", () => {
    assert.equal(huellaFinanciera63(base()), h0);
    assert.equal(jsonCanonico63({ b: 1, a: { d: 2, c: undefined } }), jsonCanonico63({ a: { d: 2 }, b: 1 }));
  });
  for (const [que, cambio] of [
    ["el costo", (f: ReturnType<typeof base>) => { f.costos.costo_hotel = 840001; }],
    ["el valor de la obligación", (f: ReturnType<typeof base>) => { f.cxp[0].valor_total = 211; }],
    ["el proveedor", (f: ReturnType<typeof base>) => { f.cxp[0].proveedor = "Otro"; }],
    ["la retención", (f: ReturnType<typeof base>) => { f.cxp[0].pct_retencion = 0.11; }],
    ["aplica retención", (f: ReturnType<typeof base>) => { f.cxp[0].aplica_retencion = false; }],
    ["la moneda de origen", (f: ReturnType<typeof base>) => { f.cxp[0].moneda = "COP"; }],
    ["el equivalente en COP", (f: ReturnType<typeof base>) => { f.cxp[0].valor_cop = 840000.01; }],
    ["una obligación de más", (f: ReturnType<typeof base>) => { f.cxp.push(...construirObligaciones63([cxp({ tipo_proveedor: "aereo" })], TRM)); }],
  ] as const) {
    test(`cambiar ${que} cambia la huella`, () => {
      const f = base();
      cambio(f);
      assert.notEqual(huellaFinanciera63(f), h0);
    });
  }
});

describe("plan B2B congelado y vigencias de compra en el snapshot (ciclo 5)", () => {
  const plan = (pct: number) => construirPlanB2b63({
    aliadoId: 227800, tipoAsesor: "agencia",
    plan: { pct, base: 1100000, comision: Math.round(1100000 * pct), modoCompra: "neta", comisionEstado: "descontada", precioFinal: 3360000 - Math.round(1100000 * pct) },
  });
  const fin = () => ({ costos: { costo_hotel: 840000 }, cxp: construirObligaciones63([cxp()], TRM) });
  test("con el PVP IGUAL, un cambio del % del aliado cambia la huella financiera (la aceptación se rechaza antes de numerar)", () => {
    const aceptada = huellaFinanciera63({ ...fin(), b2b: plan(0.1) });
    assert.notEqual(huellaFinanciera63({ ...fin(), b2b: plan(0.12) }), aceptada);
    assert.equal(huellaFinanciera63({ ...fin(), b2b: plan(0.1) }), aceptada, "el mismo plan da la misma huella");
  });
  test("cualquier campo del plan mueve la huella: aliado, modo de compra, comisión, estado y precio final", () => {
    const h0 = huellaFinanciera63({ ...fin(), b2b: plan(0.1) });
    for (const cambio of [{ aliado_id: 227801 }, { modo_compra: "comisionable" as const }, { comision: 1 }, { comision_estado: "pendiente" as const }, { precio_final: 1 }, { tipo_asesor: "freelance" as const }]) {
      assert.notEqual(huellaFinanciera63({ ...fin(), b2b: { ...plan(0.1), ...cambio } }), h0, JSON.stringify(cambio));
    }
  });
  test("una oferta interna (sin plan B2B) conserva la huella de siempre: la clave b2b no entra al texto canónico", () => {
    assert.equal(huellaFinanciera63({ ...fin(), b2b: null }), huellaFinanciera63(fin()));
    assert.notEqual(huellaFinanciera63({ ...fin(), b2b: plan(0.1) }), huellaFinanciera63(fin()), "pasar de interna a B2B también cambia la huella");
  });
  test("construirPlanB2b63 copia la cifra del plan puro: comisión, base y precio final de la cabecera", () => {
    const p = plan(0.1);
    assert.deepEqual([p.aliado_id, p.tipo_asesor, p.pct, p.base, p.comision, p.modo_compra, p.comision_estado, p.precio_final], [227800, "agencia", 0.1, 1100000, 110000, "neta", "descontada", 3250000]);
  });
  test("las vigencias se deduplican por origen y referencia y salen en orden estable (el snapshot no depende del orden de lectura)", () => {
    const v = normalizarVigencias63([
      { origen: "servicio", ref: "9|Alta", compra_inicio: null, compra_fin: "2030-01-31" },
      { origen: "hotel", ref: "Base", compra_inicio: "2030-01-01", compra_fin: null },
      { origen: "hotel", ref: "Base", compra_inicio: "2030-01-01", compra_fin: null },
    ]);
    assert.deepEqual(v.map((x) => `${x.origen}|${x.ref}`), ["hotel|Base", "servicio|9|Alta"]);
    assert.deepEqual(normalizarVigencias63([...v].reverse()), v);
  });
  test("construirSnapshot63 guarda el plan B2B y las vigencias normalizadas", () => {
    const s = construirSnapshot63({
      paqueteId: 1, salidaId: null, empaquetadoId: null, trm: TRM,
      cabecera: { tipo_paquete: "dinamico", moneda: "COP", fecha_salida: null, fecha_regreso: null, pax: 1, destino: null, hotel: null, precio_venta: 3360000, impuesto: 2260000, costo_aereo: 0, aerolinea: null, plan_nombre: "x", paquete_armado_id: 1, tipo_asesor: "agencia", canal: "B2B" },
      b2b: plan(0.1), vigencias: [{ origen: "hotel", ref: "Base", compra_inicio: null, compra_fin: "2030-01-31" }, { origen: "hotel", ref: "Base", compra_inicio: null, compra_fin: "2030-01-31" }],
      hotel: null, tramos: [], items: [], costos: {}, cxp: [], resumen: { tours_traslados: null, asistencia_medica: false },
    });
    assert.equal(s.b2b?.comision, 110000);
    assert.equal(s.vigencias.length, 1);
    assert.deepEqual([s.cabecera.tipo_asesor, s.cabecera.canal], ["agencia", "B2B"]);
  });
});

describe("lectura y errores de las RPC de la aceptación", () => {
  test("mapearErrorRpc63: el detalle técnico nunca llega al navegador", () => {
    assert.deepEqual(mapearErrorRpc63("P0001 p63_oferta_cambio: la TRM cambió"), { error: MENSAJE_CAMBIO_ACEPTACION_63, cambio: true });
    assert.deepEqual(mapearErrorRpc63("p63_oferta_cerrada: ya convertida"), { error: MENSAJE_OFERTA_CERRADA_63, cambio: false });
    assert.equal(mapearErrorRpc63("destino_aereo_no_permitido: vuelo X").cambio, true);
    assert.deepEqual(mapearErrorRpc63("duplicate key value violates unique constraint p63_aceptacion_numero_contrato_key"), { error: MENSAJE_TECNICO_63, cambio: false });
    assert.deepEqual(mapearErrorRpc63(undefined), { error: MENSAJE_TECNICO_63, cambio: false });
  });
  test("leerAceptacion63: preparada trae snapshot y payload; en curso / completa solo el número", () => {
    const snap = { v: 1 };
    const ok = leerAceptacion63({ estado: "preparada", aceptacion_id: 7, numero_contrato: "DTM-0451", fecha_negocio: "2030-01-01", snapshot: snap, financiero: { costos: {}, cxp: [] } });
    assert.equal(ok.ok && ok.aceptacion.estado, "preparada");
    assert.deepEqual(leerAceptacion63({ estado: "materializando", aceptacion_id: 7, numero_contrato: "DTM-0451" }), { ok: true, aceptacion: { estado: "materializando", aceptacion_id: 7, numero_contrato: "DTM-0451" } });
    assert.deepEqual(leerAceptacion63({ estado: "completa", aceptacion_id: 7, numero_contrato: "DTM-0451" }), { ok: true, aceptacion: { estado: "completa", aceptacion_id: 7, numero_contrato: "DTM-0451" } });
  });
  test("leerAceptacion63 falla CERRADO ante cualquier respuesta rara (sin snapshot, sin número, estado desconocido, sin payload)", () => {
    for (const d of [null, {}, { estado: "preparada" }, { estado: "otra", aceptacion_id: 1, numero_contrato: "X" }, { estado: "preparada", aceptacion_id: 1, numero_contrato: "X", snapshot: {} },
      { estado: "preparada", aceptacion_id: 1, numero_contrato: "X", snapshot: {}, financiero: { costos: {} } }, { estado: "completa", aceptacion_id: "no", numero_contrato: "X" }]) {
      assert.equal(leerAceptacion63(d).ok, false, JSON.stringify(d));
    }
  });
});

describe("adaptadores del servidor (cliente inyectado)", () => {
  const cliente = (rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>, tabla?: (t: string) => unknown) =>
    ({ rpc, from: (t: string) => tabla?.(t) }) as never;
  test("leerRevisiones63: lee las 4 revisiones de T0; un error o una fila ausente NO es 'sin cambios'", async () => {
    const q = (res: { data: unknown; error: unknown }) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => res }) }) });
    const ok = await leerRevisiones63(cliente(async () => ({ data: null, error: null }), () => q({ data: { tarifario_revision_fuente: 5, tarifario_revision_publicada: 5, tarifario_generacion_publicada: 3, p63_rev_costos: 2 }, error: null })), 9);
    assert.deepEqual(ok, { ok: true, revisiones: { rev_fuente: 5, rev_publicada: 5, gen_publicada: 3, rev_costos: 2 } });
    for (const res of [{ data: null, error: { message: "boom" } }, { data: null, error: null }, { data: { tarifario_revision_fuente: null, p63_rev_costos: 0 }, error: null }]) {
      assert.equal((await leerRevisiones63(cliente(async () => ({ data: null, error: null }), () => q(res)), 9)).ok, false);
    }
  });
  test("crearCotizacionOferta63: manda el snapshot y las revisiones de T0 a la RPC; un cambio de T0 se traduce a negocio", async () => {
    const vistos: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const args = { usuarioId: "u1", tenant: "mayorista", cotizacion: { cliente: "C" }, snapshot: { v: 1 } as never, huella: "h", huellaFinanciera: "f", revisiones: { rev_fuente: 1, rev_publicada: 1, gen_publicada: 1, rev_costos: 0 } };
    const ok = await crearCotizacionOferta63(cliente(async (fn, a) => { vistos.push({ fn, args: a }); return { data: 41, error: null }; }), args);
    assert.deepEqual(ok, { ok: true, id: 41 });
    assert.equal(vistos[0].fn, "crear_cotizacion_oferta_63");
    assert.deepEqual(Object.keys(vistos[0].args).sort(), ["p_cotizacion", "p_huella", "p_huella_financiera", "p_snapshot", "p_t0", "p_tenant", "p_usuario"]);
    const cambio = await crearCotizacionOferta63(cliente(async () => ({ data: null, error: { message: "p63_oferta_cambio: x" } })), args);
    assert.equal(cambio.ok === false && cambio.cambio, true);
    assert.match((cambio as { error: string }).error, /cambi[oó] mientras se cotizaba/i);
    const raro = await crearCotizacionOferta63(cliente(async () => ({ data: "no", error: null })), args);
    assert.equal(raro.ok, false);
    const lanza = await crearCotizacionOferta63(cliente(async () => { throw new Error("red"); }), args);
    assert.equal(lanza.ok, false);
  });
  test("aceptarOferta63: nunca manda datos financieros del navegador (solo ids y huellas) y traduce errores", async () => {
    const vistos: Array<Record<string, unknown>> = [];
    await aceptarOferta63(cliente(async (_fn, a) => { vistos.push(a); return { data: null, error: { message: "p63_oferta_cambio" } }; }), { cotizacionId: 5, tenant: "mayorista", usuarioId: "u1", huella: "h", huellaFinanciera: "f" });
    assert.deepEqual(Object.keys(vistos[0]).sort(), ["p_cotizacion", "p_huella", "p_huella_financiera", "p_tenant", "p_usuario"]);
    const r = await aceptarOferta63(cliente(async () => ({ data: null, error: { message: "p63_oferta_cambio" } })), { cotizacionId: 5, tenant: "mayorista", usuarioId: "u1", huella: "h", huellaFinanciera: "f" });
    assert.deepEqual(r, { ok: false, error: MENSAJE_CAMBIO_ACEPTACION_63, cambio: true });
    const lanza = await aceptarOferta63(cliente(async () => { throw new Error("red"); }), { cotizacionId: 5, tenant: "mayorista", usuarioId: "u1", huella: "h", huellaFinanciera: "f" });
    assert.deepEqual(lanza, { ok: false, error: MENSAJE_TECNICO_63, cambio: false });
  });
  test("ventaExiste63: distingue 'no existe' de 'no se pudo leer'", async () => {
    const q = (res: { data: unknown; error: unknown }) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => res }) }) });
    assert.deepEqual(await ventaExiste63(cliente(async () => ({ data: null, error: null }), () => q({ data: { numero_contrato: "X" }, error: null })), "X"), { ok: true, existe: true });
    assert.deepEqual(await ventaExiste63(cliente(async () => ({ data: null, error: null }), () => q({ data: null, error: null })), "X"), { ok: true, existe: false });
    assert.deepEqual(await ventaExiste63(cliente(async () => ({ data: null, error: null }), () => q({ data: null, error: { message: "x" } })), "X"), { ok: false });
  });
});

describe("importe CONTABLE de una CxP: fail-closed (jamás cae al nominal)", () => {
  const ctx = { numeroContrato: "DTM-0451", tenant: "mayorista", valorTotal: 210 };
  test("una obligación de siempre se devenga por su valor de siempre", () => {
    assert.deepEqual(resolverImporteContable63({ numero_contrato: "DTM-0451", tenant: "mayorista", valor_cop_63: null, aceptacion_63_id: null }, ctx), { ok: true, importe: 210 });
  });
  test("una obligación aceptada en USD se devenga por su equivalente en COP, no por los 210 dólares", () => {
    assert.deepEqual(resolverImporteContable63({ numero_contrato: "DTM-0451", tenant: "mayorista", aceptacion_63_id: 7, obligacion_63: "hotel:0", valor_cop_63: "840000.00", trm_63: 4000 }, ctx), { ok: true, importe: 840000 });
  });
  for (const [que, fila] of [
    ["fila ausente (error de lectura o borrada)", null],
    ["marca sin equivalente", { aceptacion_63_id: 7, obligacion_63: "hotel:0", valor_cop_63: null, trm_63: null }],
    ["equivalente sin marca", { valor_cop_63: 840000, trm_63: 4000, aceptacion_63_id: null }],
    ["marca y equivalente sin TRM", { aceptacion_63_id: 7, obligacion_63: "hotel:0", valor_cop_63: 840000, trm_63: null }],
    ["equivalente negativo", { aceptacion_63_id: 7, obligacion_63: "hotel:0", valor_cop_63: -1, trm_63: 4000 }],
    ["TRM no positiva", { aceptacion_63_id: 7, obligacion_63: "hotel:0", valor_cop_63: 840000, trm_63: 0 }],
    ["otro contrato", { numero_contrato: "DTM-0999", aceptacion_63_id: 7, obligacion_63: "hotel:0", valor_cop_63: 840000, trm_63: 4000 }],
    ["otra agencia", { numero_contrato: "DTM-0451", tenant: "minorista", aceptacion_63_id: 7, obligacion_63: "hotel:0", valor_cop_63: 840000, trm_63: 4000 }],
  ] as const) {
    test(`${que}: ERROR, nunca el nominal`, () => {
      const r = resolverImporteContable63(fila as never, ctx);
      assert.equal(r.ok, false);
    });
  }
});
