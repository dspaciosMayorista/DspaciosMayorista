import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getProgramaDetalle, getProgramaDetalleSeguro } from "../lib/programas.ts";
import { calcularPvpAcomodacionSalida, pvpPrograma } from "../lib/calc/programaPrecio.ts";
import { aDetalleConsulta, detalleConsultable } from "../lib/salesbot/consulta.ts";
import { clavesProhibidasEn } from "../lib/salesbot/contrato.ts";

// #56 — detalle de un programa: la extracción de `armarDetallePrograma` no
// cambia lo que calcula `getProgramaDetalle`, el lector seguro arma lo mismo,
// propaga los errores y filtra por programa, y la lista blanca no deja salir
// ningún costo.

type Fila = Record<string, unknown>;
type Llamada = { tabla: string; metodo: string; args: unknown[] };

/** Copia de una fila sin una clave. */
const sinClave =
  (clave: string) =>
  <T extends object>(fila: T): T => {
    const copia = { ...fila } as Record<string, unknown>;
    delete copia[clave];
    return copia as T;
  };

/** Cliente de Supabase simulado en memoria: solo lo que usan estas lecturas. */
function clienteSimulado(db: Record<string, Fila[]>, errores: Record<string, unknown> = {}) {
  const llamadas: Llamada[] = [];
  const from = (tabla: string) => {
    let filas = [...(db[tabla] ?? [])];
    let unica = false;
    const anota = (metodo: string, args: unknown[]) => llamadas.push({ tabla, metodo, args });
    const b = {
      select: (...a: unknown[]) => {
        anota("select", a);
        // Como PostgREST: una relación embebida solo llega si el select la pide,
        // con o sin pista de FK (`proveedores!fk(...)`); la clave sigue siendo `proveedores`.
        if (tabla === "programas" && !/\bproveedores(![\w]+)?\(/.test(String(a[0]))) filas = filas.map(sinClave("proveedores"));
        return b;
      },
      eq: (col: string, v: unknown) => (anota("eq", [col, v]), (filas = filas.filter((f) => f[col] === v)), b),
      in: (col: string, vs: unknown[]) => (anota("in", [col, vs]), (filas = filas.filter((f) => vs.includes(f[col]))), b),
      order: (col: string) => (anota("order", [col]), (filas = [...filas].sort((x, y) => Number(x[col] ?? 0) - Number(y[col] ?? 0))), b),
      range: (d: number, h: number) => (anota("range", [d, h]), (filas = filas.slice(d, h + 1)), b),
      maybeSingle: () => ((unica = true), b),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const error = errores[tabla];
        const res = error ? { data: null, error } : { data: unica ? (filas[0] ?? null) : filas, error: null };
        return Promise.resolve(res).then(ok, ko);
      },
    };
    return b;
  };
  return { cliente: { from } as unknown as Parameters<typeof getProgramaDetalle>[0], llamadas };
}

const PROGRAMA = {
  id: 10,
  nombre: "Turquía Mágica",
  subtitulo: "Estambul y Capadocia",
  dias: 9,
  noches: 8,
  moneda: "USD",
  salidas: "Lunes",
  vigencia_desde: "2027-01-01",
  vigencia_hasta: "2027-12-31",
  pct_mk: 0.2,
  pct_fee_tarjeta: 0.03,
  asistencia_medica_dia: 2,
  modo_precio: "salida",
  regla_comisionable: true,
  regla_comisionable_modo: "impuesto",
  regla_comisionable_valor: 200,
  regla_comisionable_pct_comision: 10,
  regla_comisionable_modalidad_mk: "base_neta_impuestos_al_final",
  regla_comisionable_impuesto_por_acomodacion: false,
  proveedor_id: 3,
  notas: "nota interna",
  nino_valor_servicios: null,
  edad_nino_min: 2,
  edad_nino_max: 11,
  edad_infante_max: 1,
  texto_condiciones: "Condiciones",
  texto_cancelacion: null,
  texto_pagos: null,
  condicion_pago_tipo: "anticipo_saldo",
  condicion_pago_pct_inicial: 30,
  condicion_pago_dias_saldo: 30,
  restriccion_comercial: "normal",
  highlights: ["Globo en Capadocia"],
  tipo_transporte: "aereo",
  incluye_aereo: true,
  activo: true,
  publicado: true,
  destino_fijo_id: 5,
  min_pax: 2,
  max_pax: 19,
  proveedores: { nombre: "Proveedor X" },
  programa_destinos_fijos: { id: 5, nombre: "Turquía", es_provisional: false },
};

// Filas de DOS programas: el lector viejo lee precios y hoteles de todos; el seguro, solo los suyos.
const DB = (): Record<string, Fila[]> => ({
  programas: [PROGRAMA],
  programa_ciudades: [
    { id: 1, programa_id: 10, nombre: "Estambul", codigo_iata: "IST", noches: 3, alojamiento_previsto: "Hotel A", orden: 1 },
    { id: 2, programa_id: 10, nombre: "Capadocia", codigo_iata: null, noches: 2, alojamiento_previsto: null, orden: 2 },
  ],
  programa_dias: [{ programa_id: 10, dia: 1, titulo: "Llegada", desayuno: false, almuerzo: false, cena: true, descripcion: "Traslado" }],
  programa_categorias: [
    { id: 100, programa_id: 10, nombre: "Primera", orden: 1 },
    { id: 900, programa_id: 99, nombre: "Ajena", orden: 1 },
  ],
  programa_categoria_hoteles: [
    { categoria_id: 100, ciudad: "Estambul", hotel: "Hotel A", orden: 1 },
    { categoria_id: 900, ciudad: "Otra", hotel: "Hotel ajeno", orden: 1 },
  ],
  programa_precios: [
    { categoria_id: 100, acomodacion: "doble", neto: 800, bajo_solicitud: false },
    { categoria_id: 100, acomodacion: "sencilla", neto: 0, bajo_solicitud: false },
    { categoria_id: 100, acomodacion: "triple", neto: null, bajo_solicitud: true },
    { categoria_id: 900, acomodacion: "doble", neto: 5, bajo_solicitud: false },
  ],
  programa_salidas: [
    {
      id: 1, programa_id: 10, orden: 1, etiqueta: "Octubre", fecha_desde: "2027-10-04", fecha_hasta: "2027-10-12", noches: 8, columna: null,
      neto_sencilla: 1300, neto_doble: 920, neto_triple: null, neto_multiple: null, neto_nino: 500, bajo_solicitud: false,
      tarifa_sencilla: 1400, tarifa_doble: 1000, tarifa_triple: null, tarifa_multiple: null,
      impuesto_sencilla: null, impuesto_doble: null, impuesto_triple: null, impuesto_multiple: null,
    },
    {
      id: 2, programa_id: 10, orden: 2, etiqueta: "Noviembre", fecha_desde: "2027-11-08", fecha_hasta: null, noches: null, columna: "Hotel B",
      neto_sencilla: null, neto_doble: 900, neto_triple: null, neto_multiple: null, neto_nino: null, bajo_solicitud: false,
      tarifa_sencilla: null, tarifa_doble: null, tarifa_triple: null, tarifa_multiple: null,
      impuesto_sencilla: null, impuesto_doble: null, impuesto_triple: null, impuesto_multiple: null,
    },
    {
      id: 3, programa_id: 10, orden: 3, etiqueta: "Diciembre", fecha_desde: "2027-12-06", fecha_hasta: null, noches: 8, columna: null,
      neto_sencilla: null, neto_doble: 950, neto_triple: null, neto_multiple: null, neto_nino: null, bajo_solicitud: true,
      tarifa_sencilla: null, tarifa_doble: null, tarifa_triple: null, tarifa_multiple: null,
      impuesto_sencilla: null, impuesto_doble: null, impuesto_triple: null, impuesto_multiple: null,
    },
  ],
  programa_inclusiones: [
    { programa_id: 10, ciudad: null, tipo: "incluye", texto: "Desayunos", orden: 1 },
    { programa_id: 10, ciudad: null, tipo: "no_incluye", texto: "Propinas", orden: 2 },
  ],
  programa_tours: [{ programa_id: 10, ciudad: "Capadocia", nombre: "Globo", precio: 200, min_pax: 2, dias_operacion: "Diario", descripcion: null, orden: 1 }],
  programa_blackouts: [{ id: 1, programa_id: 10, fecha_inicio: "2027-12-24", fecha_fin: "2027-12-26", motivo: "Navidad", ciudad: null }],
});

const OPT = { pctMk: 0.2, asistenciaDia: 2, dias: 9, pctFee: 0.03, moneda: "USD" };

describe("armarDetallePrograma: mismo cálculo que antes de la extracción", () => {
  test("modo salida con regla 161 y tarifa: usa calcularPvpAcomodacionSalida con las noches de la salida", async () => {
    const { cliente } = clienteSimulado(DB());
    const det = await getProgramaDetalle(cliente, 10);
    assert.ok(det);
    const octubre = det.salidas.find((s) => s.id === 1)!;
    const esperadoDoble = calcularPvpAcomodacionSalida({
      neto: 920, tarifa: 1000, reglaActiva: true, reglaModo: "impuesto", reglaValor: 200, reglaPctComision: 10,
      modalidadMk: "base_neta_impuestos_al_final", opt: { ...OPT, dias: 8 },
    });
    assert.equal(octubre.precios.find((p) => p.acomodacion === "doble")!.pvp, esperadoDoble);
    // El niño nunca pasa por la modalidad: neto directo.
    assert.equal(octubre.precios.find((p) => p.acomodacion === "nino")!.pvp, pvpPrograma(500, { ...OPT, dias: 8 }));
  });

  test("salida sin noches: el detalle usa los días de cabecera (lo que #57 debe alinear en la reserva)", async () => {
    const { cliente } = clienteSimulado(DB());
    const det = await getProgramaDetalle(cliente, 10);
    const noviembre = det!.salidas.find((s) => s.id === 2)!;
    assert.equal(noviembre.precios.find((p) => p.acomodacion === "doble")!.pvp, pvpPrograma(900, { ...OPT, dias: 9 }));
  });

  test("categorías: descarta netos en 0, conserva 'a solicitud' sin precio y no mezcla otro programa", async () => {
    const { cliente } = clienteSimulado(DB());
    const det = await getProgramaDetalle(cliente, 10);
    const primera = det!.categorias.find((c) => c.id === 100)!;
    assert.deepEqual(primera.precios.map((p) => p.acomodacion).sort(), ["doble", "triple"]);
    assert.equal(primera.precios.find((p) => p.acomodacion === "doble")!.pvp, pvpPrograma(800, OPT));
    assert.equal(primera.precios.find((p) => p.acomodacion === "triple")!.pvp, null);
    assert.deepEqual(primera.hoteles, [{ ciudad: "Estambul", hotel: "Hotel A" }]);
  });

  test("tours con markup y fee, sin asistencia", async () => {
    const { cliente } = clienteSimulado(DB());
    const det = await getProgramaDetalle(cliente, 10);
    assert.equal(det!.tours[0].precio, pvpPrograma(200, { ...OPT, asistenciaDia: 0, dias: 0 }));
  });
});

describe("getProgramaDetalleSeguro", () => {
  test("arma exactamente lo mismo que getProgramaDetalle (salvo el proveedor, que no lee)", async () => {
    const viejo = await getProgramaDetalle(clienteSimulado(DB()).cliente, 10);
    const seguro = await getProgramaDetalleSeguro(clienteSimulado(DB()).cliente, 10);
    assert.ok(viejo && seguro.ok);
    assert.equal(viejo.proveedorNombre, "Proveedor X");
    assert.equal(seguro.detalle.proveedorNombre, null);
    const sinProveedor = (d: typeof viejo) => ({ ...d, proveedorNombre: null, programa: sinClave("proveedores")(d.programa) });
    assert.deepEqual(sinProveedor(seguro.detalle), sinProveedor(viejo));
  });

  test("filtra hoteles y precios por las categorías del programa", async () => {
    const { cliente, llamadas } = clienteSimulado(DB());
    await getProgramaDetalleSeguro(cliente, 10);
    for (const tabla of ["programa_categoria_hoteles", "programa_precios"]) {
      const filtro = llamadas.find((l) => l.tabla === tabla && l.metodo === "in");
      assert.deepEqual(filtro?.args, ["categoria_id", [100]], tabla);
    }
  });

  test("cualquier consulta fallida es error_tecnico, nunca un detalle incompleto", async () => {
    for (const tabla of ["programas", "programa_ciudades", "programa_dias", "programa_categorias", "programa_salidas", "programa_inclusiones", "programa_tours", "programa_blackouts", "programa_categoria_hoteles", "programa_precios"]) {
      const r = await getProgramaDetalleSeguro(clienteSimulado(DB(), { [tabla]: { message: "fallo" } }).cliente, 10);
      assert.equal(r.ok, false, tabla);
      assert.ok(!r.ok && r.motivo === "error_tecnico" && r.consulta === tabla, tabla);
    }
  });

  test("programa inexistente: no_encontrado", async () => {
    const r = await getProgramaDetalleSeguro(clienteSimulado(DB()).cliente, 404);
    assert.deepEqual(r, { ok: false, motivo: "no_encontrado" });
  });
});

describe("lista blanca del detalle (aDetalleConsulta)", () => {
  test("no deja salir ninguna clave prohibida ni el mínimo/máximo de pax del programa", async () => {
    const r = await getProgramaDetalleSeguro(clienteSimulado(DB()).cliente, 10);
    assert.ok(r.ok);
    const d = aDetalleConsulta(r.detalle, true);
    assert.deepEqual(clavesProhibidasEn(d), []);
    assert.equal(JSON.stringify(d).includes("nota interna"), false);
    assert.equal(JSON.stringify(d).includes("Proveedor X"), false);
    assert.equal(d.precio_en_revision, true);
  });

  test("precios por persona como referencia y 'a solicitud' explícito", async () => {
    const r = await getProgramaDetalleSeguro(clienteSimulado(DB()).cliente, 10);
    assert.ok(r.ok);
    const d = aDetalleConsulta(r.detalle, false);
    assert.deepEqual(d.categorias[0].precios.find((p) => p.acomodacion === "triple"), { acomodacion: "triple", a_solicitud: true });
    const diciembre = d.salidas.find((s) => s.id === 3)!;
    assert.equal(diciembre.a_solicitud, true);
    assert.deepEqual(diciembre.precios, []);
    assert.deepEqual(d.tours[0], { nombre: "Globo", ciudad: "Capadocia", pvp_por_persona: r.detalle.tours[0].precio, min_pax_tour: 2, dias_operacion: "Diario", descripcion: null });
    assert.deepEqual(d.incluye, [{ ciudad: null, texto: "Desayunos" }]);
    assert.deepEqual(d.itinerario[0].comidas, ["cena"]);
  });
});

describe("detalleConsultable", () => {
  const base = { activo: true, publicado: true, destino_fijo_id: 5 };
  test("activo, publicado y con destino fijo", () => assert.equal(detalleConsultable(base), true));
  test("inactivo, borrador o sin destino: no se consulta", () => {
    assert.equal(detalleConsultable({ ...base, activo: false }), false);
    assert.equal(detalleConsultable({ ...base, activo: null }), false);
    assert.equal(detalleConsultable({ ...base, publicado: false }), false);
    assert.equal(detalleConsultable({ ...base, destino_fijo_id: null }), false);
  });
});
