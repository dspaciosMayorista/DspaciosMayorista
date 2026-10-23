import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import {
  agruparSalidasDinamicas, desdeSalidaDinamica, destinosDinamicos, esOfertaDinamica, filaDinamicaVisibleEnPaquetes, reservarHrefDinamico, salidaIdsDinamicas,
} from "../lib/tarifario/dinamicoBooking.ts";

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";
const { cargarResumenTarifario } = await import("../lib/tarifario/resumen.ts");
const { claveOferta } = await import("../lib/tarifario/recomendados.ts");

// Paquetes DINÁMICOS dentro de "Paquetes" (Vista Booking): lógica pura + carga del resumen (Recomendados/descripción/condición).

const LIBRE = { puedeReservar: true, origenSel: "", salidaSel: "" as number | "", destinoSel: "" };
const fila = (o: Record<string, unknown> = {}) => ({ modulo: "dinamico", paquete_id: 54, hotel_id: 2540, salida_id: 540, destino_nombre: "CARTAGENA", ...o });

describe("filaDinamicaVisibleEnPaquetes", () => {
  test("solo filas dinámicas y solo para quien puede reservar", () => {
    assert.equal(filaDinamicaVisibleEnPaquetes(fila(), LIBRE), true);
    assert.equal(filaDinamicaVisibleEnPaquetes(fila(), { ...LIBRE, puedeReservar: false }), false, "el carrito público no soporta salidas dinámicas");
    assert.equal(filaDinamicaVisibleEnPaquetes(fila({ modulo: "bloqueo" }), LIBRE), false);
  });
  test("el destino es el del PAQUETE (destino_nombre de la fila), nunca el del vuelo", () => {
    assert.equal(filaDinamicaVisibleEnPaquetes(fila(), { ...LIBRE, destinoSel: "CARTAGENA" }), true);
    assert.equal(filaDinamicaVisibleEnPaquetes(fila(), { ...LIBRE, destinoSel: "SAN ANDRES" }), false);
    assert.equal(filaDinamicaVisibleEnPaquetes(fila({ destino_nombre: null }), { ...LIBRE, destinoSel: "CARTAGENA" }), false);
  });
  test("origen o salida (vuelo) de Bloqueo elegidos: el Dinámico no aplica", () => {
    assert.equal(filaDinamicaVisibleEnPaquetes(fila(), { ...LIBRE, origenSel: "BOG" }), false);
    assert.equal(filaDinamicaVisibleEnPaquetes(fila(), { ...LIBRE, salidaSel: 111 }), false);
  });
});

describe("destinos, salidas y oferta", () => {
  test("destinosDinamicos: únicos, solo con permiso, ignora otros módulos y destinos vacíos", () => {
    const filas = [fila(), fila({ salida_id: 541 }), fila({ destino_nombre: "SAN ANDRES", paquete_id: 55 }), fila({ destino_nombre: null }), fila({ modulo: "bloqueo", destino_nombre: "MIAMI" })];
    assert.deepEqual(destinosDinamicos(filas, true).sort(), ["CARTAGENA", "SAN ANDRES"]);
    assert.deepEqual(destinosDinamicos(filas, false), []);
  });
  test("salidaIdsDinamicas y esOfertaDinamica", () => {
    assert.deepEqual(salidaIdsDinamicas([fila({ salida_id: 541 }), fila(), fila(), fila({ modulo: "bloqueo", salida_id: 9 })]), [540, 541]);
    assert.equal(esOfertaDinamica([fila(), fila({ salida_id: 541 })]), true);
    assert.equal(esOfertaDinamica([fila(), fila({ modulo: "bloqueo" })]), false);
    assert.equal(esOfertaDinamica([]), false);
  });
  test("reservarHrefDinamico: la misma ruta de Vista tabla para una salida dinámica", () => {
    assert.equal(reservarHrefDinamico({ paqueteId: 54, hotelId: 2540, salidaId: 541 }), "/dashboard/reservar/nuevo?paquete=54&hotel=2540&salida=541&modulo=dinamico");
  });
});

describe("agruparSalidasDinamicas / desdeSalidaDinamica", () => {
  const det = (salida: number, ida: string, acomodacion: string, precio: number, over: Record<string, unknown> = {}) => ({
    modulo: "dinamico", salida_id: salida, fecha_ida: ida, fecha_regreso: ida, noches: 3, moneda: "COP", categoria: "Estándar", regimen: "PAE", acomodacion, precio_pvp: precio, precio_pvp_menor2: null, ...over,
  });
  const filas = [
    det(541, "2030-02-10", "doble", 1100000), det(541, "2030-02-10", "sencilla", 1400000),
    det(540, "2030-01-10", "doble", 900000), det(540, "2030-01-10", "infante", 0, { precio_pvp_menor2: 150000 }), det(540, "2030-01-10", "nino", 500000),
    det(540, "2030-01-10", "doble", 950000, { categoria: "Suite", regimen: "PC" }),
    { ...det(9, "2030-03-01", "doble", 1), modulo: "bloqueo" },
  ];
  test("la salida más cercana primero; combos por categoría/alimentación; el bloqueo se ignora", () => {
    const s = agruparSalidasDinamicas(filas);
    assert.deepEqual(s.map((x) => x.salidaId), [540, 541]);
    assert.deepEqual(s[0].combos.map((c) => `${c.categoria}|${c.regimen}`), ["Estándar|PAE", "Suite|PC"]);
  });
  test("el infante usa el precio del menor de 2 años; el niño su propia tarifa", () => {
    const [s] = agruparSalidasDinamicas(filas);
    assert.equal(s.combos[0].precios.infante, 150000);
    assert.equal(s.combos[0].precios.nino, 500000);
  });
  test("'desde' = el menor precio de habitación adulta > 0 (no toma niño ni infante)", () => {
    const [s0, s1] = agruparSalidasDinamicas(filas);
    assert.equal(desdeSalidaDinamica(s0), 900000);
    assert.equal(desdeSalidaDinamica(s1), 1100000);
    assert.equal(desdeSalidaDinamica({ ...s0, combos: [{ categoria: "x", regimen: "y", precios: { nino: 1, infante: 0 } }] }), null);
  });
});

// ── Carga del resumen: Recomendados / descripción / condición también para el paquete Dinámico ──────────────
type Cfg = { data: unknown; error: unknown };
function cliente(tablas: Record<string, Cfg>, resumen: unknown[]) {
  const builder = (tabla: string) => {
    let rango: [number, number] | null = null;
    return {
      select() { return this; }, eq() { return this; }, in() { return this; }, not() { return this; }, order() { return this; },
      range(f: number, t: number) { rango = [f, t]; return this; },
      then(res: (v: Cfg) => void) {
        if (tabla === "tarifario_resumen") { const [f, t] = rango ?? [0, 999]; return res({ data: resumen.slice(f, t + 1), error: null }); }
        const c = tablas[tabla] ?? { data: [], error: null };
        const [f, t] = rango ?? [0, Number.MAX_SAFE_INTEGER];
        return res({ data: Array.isArray(c.data) ? c.data.slice(f, t + 1) : c.data, error: c.error });
      },
    };
  };
  return { from: builder } as unknown as SupabaseClient<Database>;
}
const hoy = (d: number) => new Date(Date.now() + d * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

describe("cargarResumenTarifario con un paquete Dinámico", () => {
  const filaResumen = {
    modulo: "dinamico", paquete_id: 54, paquete_nombre: "Nacional 54", bloqueo_id: null, bloqueo_label: "BOG-CTG", empaquetado_id: null, salida_id: 540,
    hotel_id: 2540, hotel_nombre: "Hotel Nacional 54", servicio_id: null, servicio_nombre: null, destino_id: 7, destino_nombre: "CARTAGENA", categoria: "Estándar", regimen: "PAE",
    fecha_ida: hoy(30), fecha_regreso: hoy(33), noches: 3, moneda: "COP", precio_sencilla: null, precio_doble: 900000, precio_triple: null, precio_multiple: null,
    precio_nino: null, precio_nino2: null, precio_infante: null, desde_adulto: 900000, desde_general: 900000, descripcion: null, recargo_individual: null, tipo_tarifa: null,
  };
  const tablas = (): Record<string, Cfg> => ({
    salidas_dinamicas: { data: [{ id: 540, activo: true, compra_inicio: null, compra_fin: null, fecha_ida: hoy(30) }], error: null },
    armado_hoteles: { data: [{ paquete_id: 54, hotel_id: 2540, prioridad: 1 }], error: null },
    armado_paquetes: { data: [{ id: 54, programa_incluye: "Desayuno\nPiscina", programa_no_incluye: null, programa_tarifas_especiales: null, programa_condiciones_comerciales: null, condicion_pago_tipo: null, restriccion_comercial: null }], error: null },
  });

  test("la prioridad del hotel en el paquete Dinámico llega a Recomendados y su descripción manual (Incluye) al detalle", async () => {
    const sb = cliente(tablas(), [filaResumen]);
    const r = await cargarResumenTarifario(sb, "test", "dinbk", sb);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.datos.filasVisibles.map((f) => `${f.modulo}:${f.paquete_id}`), ["dinamico:54"]);
    assert.equal(r.datos.prioridadesRecomendados[claveOferta(2540, 54)], 1);
    assert.match(String(r.datos.descripcionPorPaquete[54]?.incluye ?? ""), /Piscina/);
  });
});
