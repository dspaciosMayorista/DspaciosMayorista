import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import {
  accesoCotizacionDinamica, agruparSalidasDinamicas, desdeDobleResumen, desdeSalidaDinamica, destinosDinamicos, esOfertaDinamica, filaDinamicaVisibleEnPaquetes,
  reservarHrefDinamico, salidaIdsDinamicas,
} from "../lib/tarifario/dinamicoBooking.ts";

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";
const { cargarResumenTarifario } = await import("../lib/tarifario/resumen.ts");
const { claveOferta } = await import("../lib/tarifario/recomendados.ts");

// Paquetes DINÁMICOS dentro de "Paquetes" (Vista Booking): lógica pura + carga del resumen (Recomendados/descripción/condición).

const LIBRE = { origenSel: "", salidaSel: "" as number | "", destinoSel: "" };
const fila = (o: Record<string, unknown> = {}) => ({ modulo: "dinamico", paquete_id: 54, hotel_id: 2540, salida_id: 540, destino_nombre: "CARTAGENA", ...o });

describe("filaDinamicaVisibleEnPaquetes", () => {
  test("solo filas dinámicas, y visibles para TODOS: el permiso decide la acción, no la visibilidad", () => {
    assert.equal(filaDinamicaVisibleEnPaquetes(fila(), LIBRE), true);
    assert.equal(filaDinamicaVisibleEnPaquetes(fila({ modulo: "bloqueo" }), LIBRE), false);
    assert.equal(filaDinamicaVisibleEnPaquetes(fila(), { ...LIBRE, puedeReservar: false } as never), true, "un permiso falso ya no oculta nada");
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
  test("destinosDinamicos: únicos, para todos, ignora otros módulos y destinos vacíos", () => {
    const filas = [fila(), fila({ salida_id: 541 }), fila({ destino_nombre: "SAN ANDRES", paquete_id: 55 }), fila({ destino_nombre: null }), fila({ modulo: "bloqueo", destino_nombre: "MIAMI" })];
    assert.deepEqual(destinosDinamicos(filas).sort(), ["CARTAGENA", "SAN ANDRES"]);
  });
  test("accesoCotizacionDinamica: cotiza quien puede reservar; el visitante ingresa; la cuenta sin permiso solo ve el aviso", () => {
    assert.equal(accesoCotizacionDinamica({ puedeReservar: true, hayUsuario: true }), "cotizar");
    assert.equal(accesoCotizacionDinamica({ puedeReservar: true, hayUsuario: false }), "cotizar");
    assert.equal(accesoCotizacionDinamica({ puedeReservar: false, hayUsuario: false }), "ingresar");
    assert.equal(accesoCotizacionDinamica({ puedeReservar: false, hayUsuario: true }), "sin_permiso");
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
  test("'desde' = el menor precio DOBLE de la salida (no toma niño, infante ni otra acomodación)", () => {
    const [s0, s1] = agruparSalidasDinamicas(filas);
    assert.equal(desdeSalidaDinamica(s0), 900000, "la menor doble entre Estándar (900.000) y Suite (950.000)");
    assert.equal(desdeSalidaDinamica(s1), 1100000);
    assert.equal(desdeSalidaDinamica({ ...s0, combos: [{ categoria: "x", regimen: "y", precios: { nino: 1, infante: 0 } }] }), null);
  });
  test("una SENCILLA más barata que la DOBLE no cambia el 'desde': la referencia es siempre la doble", () => {
    const f2 = [det(700, "2030-04-01", "sencilla", 700000), det(700, "2030-04-01", "doble", 900000), det(700, "2030-04-01", "triple", 650000)];
    const [s] = agruparSalidasDinamicas(f2);
    assert.equal(desdeSalidaDinamica(s), 900000);
  });
  test("sin tarifa doble no hay 'desde' (nunca se cae a otra acomodación en silencio)", () => {
    const [s] = agruparSalidasDinamicas([det(701, "2030-04-01", "sencilla", 700000), det(701, "2030-04-01", "doble", 0)]);
    assert.equal(desdeSalidaDinamica(s), null);
  });
  test("desdeDobleResumen (tarjeta): el menor precio_doble > 0 entre todas las salidas, ignorando la sencilla", () => {
    // Filas de RESUMEN reales: traen también precio_sencilla (más barata aquí) — no debe influir.
    const filas = [{ precio_doble: 1100000, precio_sencilla: 500000 }, { precio_doble: 900000, precio_sencilla: 700000 }, { precio_doble: null, precio_sencilla: 100000 }, { precio_doble: 0, precio_sencilla: 100000 }];
    assert.equal(desdeDobleResumen(filas), 900000);
    assert.equal(desdeDobleResumen([{ precio_doble: null }]), null);
    assert.equal(desdeDobleResumen([]), null);
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

describe("cableado del acceso (la página decide si hay sesión; el modal decide la acción)", () => {
  const leer = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  test("app/tarifario/page.tsx pasa la sesión real (`!!user`) a TarifarioPublic, junto a puedeReservar", () => {
    assert.match(leer("app/tarifario/page.tsx"), /<TarifarioPublic [^>]*puedeReservar=\{puedeReservar\} hayUsuario=\{!!user\} /);
  });
  test("VistaBooking deriva la acción con accesoCotizacionDinamica y ya no oculta Dinámicos por permiso", () => {
    const vb = leer("app/tarifario/VistaBooking.tsx");
    assert.match(vb, /acceso=\{accesoCotizacionDinamica\(\{ puedeReservar, hayUsuario \}\)\}/);
    assert.doesNotMatch(vb, /\(f\.modulo === "dinamico" && puedeReservar\)/);
  });
});
