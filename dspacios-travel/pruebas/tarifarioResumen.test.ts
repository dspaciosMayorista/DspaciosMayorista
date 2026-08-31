import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { cargarResumenTarifario, expandirResumenAFilas, type FilaResumen } from "../lib/tarifario/resumen.ts";
import { hoyISO } from "../lib/calc/paquetes.ts";
import type { FilaTarifario } from "../app/tarifario/TarifarioPublic.tsx";
import { ACOM_ROOMS, type AcomRoom } from "../lib/acomodaciones.ts";

// ── EJECUCIÓN REAL de expandirResumenAFilas() y cargarResumenTarifario() ───
//
// Defecto que se está evitando ("EQUIVALENCIA FUNCIONAL", ronda 4/tarea del
// dueño): la carga en dos niveles NO debe cambiar qué hoteles se muestran,
// cuál es su "desde" (mínimo de acomodaciones de ADULTO, nunca niño/niño2/
// infante — mismo criterio que `minRoomPvp()` en VistaBooking.tsx), ni el
// resultado de los filtros de categoría/régimen/acomodación. Estas pruebas
// comparan, con fixtures representativos, el resultado de calcular "desde"
// sobre las filas RAW (como hacía el catálogo completo) contra el resultado
// de calcular "desde" sobre las filas SINTÉTICAS que produce
// `expandirResumenAFilas()` a partir de un resumen agregado manualmente (la
// misma agregación que hace la vista SQL `tarifario_resumen`, migración 161)
// — sin depender de una base de datos real.

function minRoomPvp(filas: { acomodacion: string | null; precio_pvp: number }[]): number | null {
  const precios = filas
    .filter((f) => ACOM_ROOMS.includes(f.acomodacion as AcomRoom) && f.precio_pvp > 0)
    .map((f) => f.precio_pvp);
  return precios.length ? Math.min(...precios) : null;
}

// Agrega manualmente un set de FilaTarifario "raw" al mismo grano que la
// vista SQL: (modulo, paquete, bloqueo, hotel, servicio, categoria, regimen,
// fecha_ida, fecha_regreso, noches) → min por acomodación. Réplica en JS de
// la sentencia `group by` + `filter (where acomodacion = 'x')` de la
// migración 161 — sirve para construir fixtures de resumen sin tener que
// escribirlos ya agregados a mano (fácil de desalinear con el código real).
function agregarComoVistaSQL(raw: FilaTarifario[]): FilaResumen[] {
  const grupos = new Map<string, FilaTarifario[]>();
  for (const f of raw) {
    const key = [f.modulo, f.paquete_id, f.bloqueo_id, f.hotel_id, f.servicio_id, f.categoria, f.regimen, f.fecha_ida, f.fecha_regreso, f.noches].join("|||");
    (grupos.get(key) ?? grupos.set(key, []).get(key)!).push(f);
  }
  const out: FilaResumen[] = [];
  for (const filas of grupos.values()) {
    const f0 = filas[0];
    const porAcom = (a: string) => {
      const vals = filas.filter((f) => f.acomodacion === a && f.precio_pvp > 0).map((f) => f.precio_pvp);
      return vals.length ? Math.min(...vals) : null;
    };
    const general = filas.filter((f) => f.precio_pvp > 0).map((f) => f.precio_pvp);
    out.push({
      modulo: f0.modulo, paquete_id: f0.paquete_id ?? 1, paquete_nombre: f0.paquete_nombre,
      bloqueo_id: f0.bloqueo_id ?? null, bloqueo_label: f0.bloqueo_label, empaquetado_id: f0.empaquetado_id ?? null,
      salida_id: f0.salida_id ?? null, hotel_id: f0.hotel_id ?? null, hotel_nombre: f0.hotel_nombre,
      servicio_id: f0.servicio_id ?? null, servicio_nombre: f0.servicio_nombre ?? null,
      destino_id: null, destino_nombre: f0.destino_nombre,
      categoria: f0.categoria, regimen: f0.regimen, fecha_ida: f0.fecha_ida, fecha_regreso: f0.fecha_regreso,
      noches: f0.noches, moneda: f0.moneda ?? "COP",
      precio_sencilla: porAcom("sencilla"), precio_doble: porAcom("doble"), precio_triple: porAcom("triple"), precio_multiple: porAcom("multiple"),
      desde_adulto: minRoomPvp(filas), desde_general: general.length ? Math.min(...general) : null,
      descripcion: f0.descripcion ?? null, recargo_individual: f0.recargo_individual ?? null, tipo_tarifa: f0.tipo_tarifa ?? null,
    });
  }
  return out;
}

describe("expandirResumenAFilas() — equivalencia con el 'desde' calculado sobre las filas RAW completas", () => {
  test("hotel con las 4 acomodaciones de adulto + niño + infante: 'desde' ignora niño/infante, igual que hoy", () => {
    const raw: FilaTarifario[] = [
      { modulo: "bloqueo", bloqueo_label: "L1", bloqueo_id: 1, paquete_id: 1, hotel_id: 10, fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", noches: 3, destino_nombre: "Cartagena", paquete_nombre: "P1", hotel_nombre: "Hotel Uno", categoria: "Estandar", regimen: "PC", acomodacion: "sencilla", precio_pvp: 900000, moneda: "COP" },
      { modulo: "bloqueo", bloqueo_label: "L1", bloqueo_id: 1, paquete_id: 1, hotel_id: 10, fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", noches: 3, destino_nombre: "Cartagena", paquete_nombre: "P1", hotel_nombre: "Hotel Uno", categoria: "Estandar", regimen: "PC", acomodacion: "doble", precio_pvp: 500000, moneda: "COP" },
      { modulo: "bloqueo", bloqueo_label: "L1", bloqueo_id: 1, paquete_id: 1, hotel_id: 10, fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", noches: 3, destino_nombre: "Cartagena", paquete_nombre: "P1", hotel_nombre: "Hotel Uno", categoria: "Estandar", regimen: "PC", acomodacion: "triple", precio_pvp: 450000, moneda: "COP" },
      { modulo: "bloqueo", bloqueo_label: "L1", bloqueo_id: 1, paquete_id: 1, hotel_id: 10, fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", noches: 3, destino_nombre: "Cartagena", paquete_nombre: "P1", hotel_nombre: "Hotel Uno", categoria: "Estandar", regimen: "PC", acomodacion: "multiple", precio_pvp: 400000, moneda: "COP" },
      // Infante: precio MÁS BARATO de todos — no debe colarse como "desde".
      { modulo: "bloqueo", bloqueo_label: "L1", bloqueo_id: 1, paquete_id: 1, hotel_id: 10, fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", noches: 3, destino_nombre: "Cartagena", paquete_nombre: "P1", hotel_nombre: "Hotel Uno", categoria: "Estandar", regimen: "PC", acomodacion: "infante", precio_pvp: 19000, moneda: "COP" },
      { modulo: "bloqueo", bloqueo_label: "L1", bloqueo_id: 1, paquete_id: 1, hotel_id: 10, fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", noches: 3, destino_nombre: "Cartagena", paquete_nombre: "P1", hotel_nombre: "Hotel Uno", categoria: "Estandar", regimen: "PC", acomodacion: "nino", precio_pvp: 250000, moneda: "COP" },
    ];
    const desdeRaw = minRoomPvp(raw);
    assert.equal(desdeRaw, 400000, "desde esperado sobre filas raw: min(sencilla,doble,triple,multiple)=400000, ignora infante(19000)/nino(250000)");

    const resumen = agregarComoVistaSQL(raw);
    const sintetico = expandirResumenAFilas(resumen);
    const desdeSintetico = minRoomPvp(sintetico);
    assert.equal(desdeSintetico, desdeRaw, "el resumen expandido debe dar EXACTAMENTE el mismo 'desde' que las filas raw");
    // Las filas sintéticas NUNCA deben traer una fila de infante/niño con
    // acomodacion="infante"/"nino" — esas quedan solo en el detalle bajo demanda.
    assert.ok(sintetico.every((f) => f.acomodacion == null || (ACOM_ROOMS as string[]).includes(f.acomodacion)));
  });

  test("hotel SIN ninguna acomodación de adulto con precio (solo niño/infante configurados): 1 fila de fallback, desde=null (\"Consultar\")", () => {
    const raw: FilaTarifario[] = [
      { modulo: "porcion_terrestre", bloqueo_label: null, bloqueo_id: null, paquete_id: 2, hotel_id: 11, fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", noches: 3, destino_nombre: "Cartagena", paquete_nombre: "P2", hotel_nombre: "Hotel Dos", categoria: "Estandar", regimen: "PC", acomodacion: "infante", precio_pvp: 0, moneda: "COP" },
    ];
    const resumen = agregarComoVistaSQL(raw);
    const sintetico = expandirResumenAFilas(resumen);
    assert.equal(sintetico.length, 1, "debe emitir 1 fila de fallback para que el hotel siga generando su tarjeta");
    assert.equal(sintetico[0].hotel_id, 11);
    assert.equal(minRoomPvp(sintetico), null, "sin acomodación de adulto, desde debe ser null (\"Consultar\"), no 0 ni inventado");
  });

  test("múltiples categorías/regímenes del mismo hotel: cada combo produce su propio grupo de filas sintéticas (soporta el filtro de categoría/régimen)", () => {
    const raw: FilaTarifario[] = [
      { modulo: "bloqueo", bloqueo_label: "L1", bloqueo_id: 1, paquete_id: 1, hotel_id: 10, fecha_ida: "2026-12-01", fecha_regreso: null, noches: 3, destino_nombre: "X", paquete_nombre: "P1", hotel_nombre: "Hotel Uno", categoria: "Estandar", regimen: "PC", acomodacion: "doble", precio_pvp: 500000, moneda: "COP" },
      { modulo: "bloqueo", bloqueo_label: "L1", bloqueo_id: 1, paquete_id: 1, hotel_id: 10, fecha_ida: "2026-12-01", fecha_regreso: null, noches: 3, destino_nombre: "X", paquete_nombre: "P1", hotel_nombre: "Hotel Uno", categoria: "Suite", regimen: "PAM", acomodacion: "doble", precio_pvp: 800000, moneda: "COP" },
    ];
    const resumen = agregarComoVistaSQL(raw);
    assert.equal(resumen.length, 2, "un grupo distinto por (categoria,regimen)");
    const sintetico = expandirResumenAFilas(resumen);
    const soloEstandarPC = sintetico.filter((f) => f.categoria === "Estandar" && f.regimen === "PC");
    const soloSuitePAM = sintetico.filter((f) => f.categoria === "Suite" && f.regimen === "PAM");
    assert.equal(minRoomPvp(soloEstandarPC), 500000);
    assert.equal(minRoomPvp(soloSuitePAM), 800000);
    // Cruzar categoria=Estandar con regimen=PAM (una combinación que NO existe
    // en el catálogo) no debe devolver ninguna fila — el filtro real (join
    // categoria+regimen) sigue funcionando igual que sobre las filas raw.
    assert.equal(sintetico.filter((f) => f.categoria === "Estandar" && f.regimen === "PAM").length, 0);
  });

  test("servicios: 1 fila sintética por combo con precio_pvp = desde_general (mínimo real, no un valor inventado)", () => {
    const raw: FilaTarifario[] = [
      { modulo: "servicios", bloqueo_label: null, paquete_id: 3, hotel_id: null, hotel_nombre: null, servicio_id: 5, servicio_nombre: "City tour", fecha_ida: null, fecha_regreso: null, noches: null, destino_nombre: "Cartagena", paquete_nombre: "Servicios", categoria: null, regimen: null, acomodacion: null, precio_pvp: 80000, descripcion: "Recorrido por la ciudad", recargo_individual: 5000, moneda: "COP", tipo_tarifa: "persona" },
    ];
    const resumen = agregarComoVistaSQL(raw);
    const sintetico = expandirResumenAFilas(resumen);
    assert.equal(sintetico.length, 1);
    assert.equal(sintetico[0].precio_pvp, 80000);
    assert.equal(sintetico[0].modulo, "servicios");
    assert.equal(sintetico[0].servicio_nombre, "City tour");
  });
});

// ── cargarResumenTarifario() — ejecución real con cliente Supabase falso ────
// Mismo patrón de fixtures/cliente falso que pruebas/tarifarioDatos.test.ts,
// apuntando a la vista `tarifario_resumen` en vez de `tarifario_resultado`.

type Fila = { data: unknown[] | null; error: unknown };

function clienteFalso(tablas: Record<string, Fila>, datasetResumen: FilaResumen[]) {
  function builder(tabla: string) {
    let rangeArgs: [number, number] | null = null;
    const b = {
      select() { return this; },
      eq() { return this; },
      in() { return this; },
      not() { return this; },
      order() { return this; },
      range(from: number, to: number) { rangeArgs = [from, to]; return this; },
      then(resolve: (v: { data: unknown; error: unknown }) => void) {
        if (tabla === "tarifario_resumen") {
          const [from, to] = rangeArgs ?? [0, 999];
          resolve({ data: datasetResumen.slice(from, to + 1), error: null });
        } else {
          const cfg = tablas[tabla] ?? { data: [], error: null };
          resolve({ data: cfg.data, error: cfg.error });
        }
      },
    };
    return b;
  }
  return { from: builder } as unknown as SupabaseClient<Database>;
}

const HOY = hoyISO();
function fechaEnBogota(offsetDias: number): string {
  const ms = Date.now() + offsetDias * 86400000;
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
const AYER = fechaEnBogota(-1);
const MANIANA = fechaEnBogota(1);
void HOY;

function resumenBase(overrides: Partial<FilaResumen>): FilaResumen {
  return {
    modulo: "bloqueo", paquete_id: 1, paquete_nombre: "P1", bloqueo_id: 1, bloqueo_label: "L1",
    empaquetado_id: null, salida_id: null, hotel_id: 10, hotel_nombre: "Hotel Uno",
    servicio_id: null, servicio_nombre: null, destino_id: null, destino_nombre: "Cartagena",
    categoria: "Estandar", regimen: "PC", fecha_ida: MANIANA, fecha_regreso: null, noches: 3, moneda: "COP",
    precio_sencilla: null, precio_doble: 500000, precio_triple: null, precio_multiple: null,
    desde_adulto: 500000, desde_general: 500000, descripcion: null, recargo_individual: null, tipo_tarifa: null,
    ...overrides,
  };
}

function tablasBase(overrides: Record<string, Fila> = {}): Record<string, Fila> {
  return {
    cupos_por_bloqueo: { data: [], error: null },
    bloqueos_vuelo: { data: [], error: null },
    hotel_temporadas: { data: [], error: null },
    tarifa_hotel: { data: [], error: null },
    empaquetados: { data: [], error: null },
    armado_paquetes: { data: [], error: null },
    hotel_fotos: { data: [], error: null },
    hoteles: { data: [], error: null },
    hotel_acomodaciones: { data: [], error: null },
    servicios_adicionales: { data: [], error: null },
    planes_alimentacion: { data: [], error: null },
    armado_servicios: { data: [], error: null },
    ...overrides,
  };
}

describe("cargarResumenTarifario() — consulta la vista de resumen, no tarifario_resultado paginado", () => {
  test("caso feliz: consulta tarifario_resumen, expande a FilaTarifario[], cuenta filasResumen (magnitud del RESUMEN, no de las filas expandidas)", async () => {
    const resumen = [resumenBase({}), resumenBase({ hotel_id: 20, hotel_nombre: "Hotel Dos", desde_adulto: 300000, precio_doble: 300000 })];
    const sb = clienteFalso(tablasBase(), resumen);
    const r = await cargarResumenTarifario(sb, "test", "flujo1", null);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasResumen, 2, "filasResumen debe reflejar el TAMAÑO DEL RESUMEN (2), no el de las filas expandidas");
    assert.equal(r.datos.filasVisibles.length, 2, "cada resumen sin admin (sin filtro vigencia) expande a 1 fila sintética (una sola acomodación con precio)");
    const hoteles = new Set(r.datos.filasVisibles.map((f) => f.hotel_id));
    assert.deepEqual([...hoteles].sort(), [10, 20]);
  });

  test("error técnico en tarifario_resumen: falla cerrado con el mensaje público fijo, nunca 'no hay tarifas'", async () => {
    const tablas = tablasBase();
    function builder(tabla: string) {
      return {
        select() { return this; }, eq() { return this; }, order() { return this; },
        range() { return this; },
        then(resolve: (v: { data: unknown; error: unknown }) => void) {
          if (tabla === "tarifario_resumen") resolve({ data: null, error: { message: "conexión perdida" } });
          else resolve({ data: (tablas[tabla] ?? { data: [] }).data, error: null });
        },
      };
    }
    const sb = { from: builder } as unknown as SupabaseClient<Database>;
    const r = await cargarResumenTarifario(sb, "test", "flujo1", null);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /No fue posible cargar el tarifario/);
    assert.doesNotMatch(r.error, /conexión perdida/, "el error crudo de Supabase nunca debe llegar al mensaje público");
  });

  test("bloqueo con fecha_ida de AYER: se oculta (mismo criterio que cargarDatosTarifario, aplicado al resumen)", async () => {
    const resumen = [resumenBase({ modulo: "bloqueo", fecha_ida: AYER })];
    const sb = clienteFalso(tablasBase(), resumen);
    const r = await cargarResumenTarifario(sb, "test", "flujo1", null);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 0, "una salida de bloqueo vencida debe ocultarse igual que en el catálogo completo");
  });

  test("módulo servicios: solo se publica si el paquete es de tipo 'servicios' (mismo recorte que cargarDatosTarifario) — con cliente admin FALSO", async () => {
    const resumen = [resumenBase({ modulo: "servicios", hotel_id: null, servicio_id: 7, servicio_nombre: "Tour", categoria: null, regimen: null, desde_general: 90000, paquete_id: 9 })];
    const tablas = tablasBase({ armado_paquetes: { data: [{ id: 9 }], error: null } });
    function builder(tabla: string) {
      let rangeArgs: [number, number] | null = null;
      return {
        select() { return this; }, eq() { return this; }, in() { return this; }, not() { return this; }, order() { return this; },
        range(from: number, to: number) { rangeArgs = [from, to]; return this; },
        then(resolve: (v: { data: unknown; error: unknown }) => void) {
          if (tabla === "tarifario_resumen") { const [from, to] = rangeArgs ?? [0, 999]; resolve({ data: resumen.slice(from, to + 1), error: null }); }
          else resolve({ data: (tablas[tabla] ?? { data: [] }).data, error: (tablas[tabla] ?? { error: null }).error });
        },
      };
    }
    const sb = { from: builder } as unknown as SupabaseClient<Database>;
    const admin = sb; // el "admin" falso reusa el mismo builder — solo importan las tablas que consulta
    const r = await cargarResumenTarifario(sb, "test", "flujo1", admin);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 1, "el servicio SÍ se publica: su paquete_id=9 está en armado_paquetes con tipo='servicios'");
    assert.equal(r.datos.filasVisibles[0].precio_pvp, 90000);
  });
});
