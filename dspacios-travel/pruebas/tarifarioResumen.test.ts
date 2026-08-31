import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { cargarResumenTarifario, cargarFilasResumenPaginado, type FilaResumen } from "../lib/tarifario/resumen.ts";
import { minRoomPvpResumen, tieneAcomodacionResumen } from "../lib/tarifario/resumenCliente.ts";
import { hoyISO } from "../lib/calc/paquetes.ts";
import type { FilaTarifario } from "../app/tarifario/TarifarioPublic.tsx";
import { ACOM_ROOMS, type AcomRoom } from "../lib/acomodaciones.ts";

// ── EJECUCIÓN REAL de la carga en dos niveles del tarifario, SIN expansión
// sintética (revisión posterior: la ronda anterior llamaba
// `expandirResumenAFilas()` antes de transportar el resumen al cliente,
// volviendo a multiplicar cada fila hasta 4× — exactamente el defecto que
// esta ronda corrige). `cargarResumenTarifario()` ahora entrega el DTO de
// resumen (`FilaResumen[]`) TAL CUAL; `FilaTarifario` (matriz completa) solo
// existe como resultado de una consulta de detalle bajo demanda.

function minRoomPvpRaw(filas: { acomodacion: string | null; precio_pvp: number }[]): number | null {
  const precios = filas
    .filter((f) => ACOM_ROOMS.includes(f.acomodacion as AcomRoom) && f.precio_pvp > 0)
    .map((f) => f.precio_pvp);
  return precios.length ? Math.min(...precios) : null;
}

// Agrega manualmente un set de FilaTarifario "raw" al mismo grano que la
// vista SQL: (modulo, paquete, bloqueo, hotel, servicio, categoria, regimen,
// fecha_ida, fecha_regreso, noches) → min por acomodación. Réplica en JS de
// la sentencia `group by` + `filter (where acomodacion = 'x')` de la
// migración 161 (incluida la nueva versión sin filtro de precio>0 para
// nino/nino2/infante) — sirve para construir fixtures de resumen sin tener
// que escribirlos ya agregados a mano (fácil de desalinear con el código real).
function agregarComoVistaSQL(raw: FilaTarifario[]): FilaResumen[] {
  const grupos = new Map<string, FilaTarifario[]>();
  for (const f of raw) {
    const key = [f.modulo, f.paquete_id, f.bloqueo_id, f.hotel_id, f.servicio_id, f.categoria, f.regimen, f.fecha_ida, f.fecha_regreso, f.noches].join("|||");
    (grupos.get(key) ?? grupos.set(key, []).get(key)!).push(f);
  }
  const out: FilaResumen[] = [];
  for (const filas of grupos.values()) {
    const f0 = filas[0];
    const porAcomConPrecio = (a: string) => {
      const vals = filas.filter((f) => f.acomodacion === a && f.precio_pvp > 0).map((f) => f.precio_pvp);
      return vals.length ? Math.min(...vals) : null;
    };
    // Chd1/Chd2/infante: SIN el filtro precio_pvp>0 (0 es un precio válido,
    // "gratis") — mismo criterio que la migración 161.
    const porAcomSinFiltroPrecio = (a: string) => {
      const vals = filas.filter((f) => f.acomodacion === a).map((f) => f.precio_pvp);
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
      precio_sencilla: porAcomConPrecio("sencilla"), precio_doble: porAcomConPrecio("doble"), precio_triple: porAcomConPrecio("triple"), precio_multiple: porAcomConPrecio("multiple"),
      precio_nino: porAcomSinFiltroPrecio("nino"), precio_nino2: porAcomSinFiltroPrecio("nino2"), precio_infante: porAcomSinFiltroPrecio("infante"),
      desde_adulto: minRoomPvpRaw(filas), desde_general: general.length ? Math.min(...general) : null,
      descripcion: f0.descripcion ?? null, recargo_individual: f0.recargo_individual ?? null, tipo_tarifa: f0.tipo_tarifa ?? null,
    });
  }
  return out;
}

const MANIANA = (() => {
  const ms = Date.now() + 86400000;
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
})();

function filaHotelBase(overrides: Partial<FilaTarifario>): FilaTarifario {
  return {
    modulo: "bloqueo", bloqueo_label: "L1", bloqueo_id: 1, paquete_id: 1, hotel_id: 10,
    fecha_ida: MANIANA, fecha_regreso: null, noches: 3, destino_nombre: "Cartagena",
    paquete_nombre: "P1", hotel_nombre: "Hotel Uno", categoria: "Estandar", regimen: "PC",
    acomodacion: "doble", precio_pvp: 500000, moneda: "COP",
    ...overrides,
  };
}

describe("Item 1 — el resumen ya NO se re-expande a miles de filas antes del transporte", () => {
  test("⚠️ prueba a gran escala: 17.197 filas RAW → el resumen entregado NO se multiplica ×4 ni se acerca a 10.000–17.000 filas", () => {
    const ACOMS = ["sencilla", "doble", "triple", "multiple", "nino", "nino2", "infante"];
    const HOTELES = 58;
    const TOTAL_RAW = 17197;
    const raw: FilaTarifario[] = [];
    let comboIdx = 0;
    while (raw.length < TOTAL_RAW) {
      const hotelId = (comboIdx % HOTELES) + 1;
      const categoria = `Cat${Math.floor(comboIdx / HOTELES)}`;
      const regimen = comboIdx % 2 === 0 ? "PC" : "PAM";
      for (const acom of ACOMS) {
        if (raw.length >= TOTAL_RAW) break;
        raw.push(filaHotelBase({
          hotel_id: hotelId, hotel_nombre: `Hotel ${hotelId}`, categoria, regimen,
          acomodacion: acom, precio_pvp: acom === "infante" ? 19000 : acom === "nino" || acom === "nino2" ? 90000 : 400000 + comboIdx,
        }));
      }
      comboIdx++;
    }
    assert.equal(raw.length, TOTAL_RAW, "fixture de control: exactamente 17.197 filas raw (magnitud real reportada por el dueño)");

    const resumen = agregarComoVistaSQL(raw);
    // El "combo count" real (grupos distintos hotel×categoría×régimen) —
    // sigue siendo mucho menor que 17.197 (colapsa la dimensión acomodación,
    // hasta 7×), pero NO llega a la magnitud de 58 hoteles (tradeoff
    // documentado en la migración 161).
    assert.ok(resumen.length < TOTAL_RAW / 4, `el resumen (${resumen.length}) debe ser MENOS de 1/4 de las filas raw (${TOTAL_RAW})`);
    assert.ok(resumen.length < 3000, `el resumen (${resumen.length}) debe estar muy lejos de la magnitud de 10.000–17.000`);

    // El punto central de esta ronda: `cargarResumenTarifario()` entrega EXACTAMENTE
    // el resumen, sin re-expandir — nunca ×4, nunca cerca de 10.000-17.000.
    return cargarFilasResumenPaginado(clienteSoloResumen(resumen)).then((pag) => {
      assert.equal(pag.ok, true);
      if (!pag.ok) return;
      assert.equal(pag.filas.length, resumen.length, "cargarFilasResumenPaginado no transforma ni multiplica las filas de la vista");
      assert.ok(pag.filas.length < 3000);
    });
  });

  test("cargarResumenTarifario(): filasVisibles/filasAddon vienen SIN expandir — 1 fila de resumen entra, 1 fila sale (nunca hasta 4)", async () => {
    const resumen = [
      resumenBase({ hotel_id: 10, categoria: "Estandar", regimen: "PC", precio_sencilla: 900000, precio_doble: 500000, precio_triple: 450000, precio_multiple: 400000, desde_adulto: 400000 }),
      resumenBase({ hotel_id: 20, hotel_nombre: "Hotel Dos", categoria: "Suite", regimen: "PAM", precio_doble: 300000, desde_adulto: 300000 }),
    ];
    const tablas = tablasBase({
      hotel_temporadas: { data: [temporadaVigente(10), temporadaVigente(20)], error: null },
      tarifa_hotel: { data: [tarifaVigente(10, "Estandar", "PC"), tarifaVigente(20, "Suite", "PAM")], error: null },
    });
    const sb = clienteFalso(tablas, resumen);
    const r = await cargarResumenTarifario(sb, "test", "flujo1", sb);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 2, "2 filas de resumen entran → 2 filas salen, nunca 8 (2×4 acomodaciones)");
    assert.ok("desde_adulto" in r.datos.filasVisibles[0], "las filas entregadas son FilaResumen, no FilaTarifario expandida");
    assert.ok(!("acomodacion" in r.datos.filasVisibles[0]), "FilaResumen no tiene columna 'acomodacion' por fila — esa granularidad solo existe en el detalle bajo demanda");
  });
});

describe("Item 3 — Chd1/Chd2/infante viajan en el resumen, pero NUNCA entran al 'desde'", () => {
  test("hotel con las 4 acomodaciones de adulto + niño + infante: 'desde' ignora niño/infante, igual que hoy", () => {
    const raw: FilaTarifario[] = [
      filaHotelBase({ acomodacion: "sencilla", precio_pvp: 900000 }),
      filaHotelBase({ acomodacion: "doble", precio_pvp: 500000 }),
      filaHotelBase({ acomodacion: "triple", precio_pvp: 450000 }),
      filaHotelBase({ acomodacion: "multiple", precio_pvp: 400000 }),
      // Infante: precio MÁS BARATO de todos — no debe colarse como "desde".
      filaHotelBase({ acomodacion: "infante", precio_pvp: 19000 }),
      filaHotelBase({ acomodacion: "nino", precio_pvp: 250000 }),
    ];
    const desdeRaw = minRoomPvpRaw(raw);
    assert.equal(desdeRaw, 400000, "desde esperado sobre filas raw: min(sencilla,doble,triple,multiple)=400000, ignora infante(19000)/nino(250000)");

    const resumen = agregarComoVistaSQL(raw);
    assert.equal(resumen.length, 1);
    assert.equal(resumen[0].desde_adulto, desdeRaw, "el resumen debe dar EXACTAMENTE el mismo 'desde' que las filas raw");
    assert.equal(resumen[0].precio_nino, 250000, "Chd1 SÍ viaja en el resumen (para el filtro), aunque nunca en 'desde'");
    assert.equal(resumen[0].precio_infante, 19000);
    assert.equal(minRoomPvpResumen(resumen), desdeRaw, "minRoomPvpResumen() (usado por la tarjeta de VistaBooking) da el mismo 'desde'");
  });

  test("⚠️ control negativo: hotel con SOLO Chd1 (nino) configurado — Chd2 debe ser null, nunca 0 ni heredar el valor de Chd1", () => {
    const raw: FilaTarifario[] = [
      filaHotelBase({ hotel_id: 30, acomodacion: "doble", precio_pvp: 500000 }),
      filaHotelBase({ hotel_id: 30, acomodacion: "nino", precio_pvp: 100000 }),
    ];
    const resumen = agregarComoVistaSQL(raw)[0];
    assert.equal(resumen.precio_nino, 100000);
    assert.equal(resumen.precio_nino2, null, "sin ninguna fila nino2, el resumen debe dar null — nunca inventar 0 ni copiar nino");
    assert.equal(tieneAcomodacionResumen(resumen, "nino"), true);
    assert.equal(tieneAcomodacionResumen(resumen, "nino2"), false, "el filtro Chd2 no debe ofrecer este hotel");
  });

  test("⚠️ control negativo: hotel con SOLO Chd2 (nino2) configurado — Chd1 debe ser null", () => {
    const raw: FilaTarifario[] = [
      filaHotelBase({ hotel_id: 31, acomodacion: "doble", precio_pvp: 500000 }),
      filaHotelBase({ hotel_id: 31, acomodacion: "nino2", precio_pvp: 120000 }),
    ];
    const resumen = agregarComoVistaSQL(raw)[0];
    assert.equal(resumen.precio_nino2, 120000);
    assert.equal(resumen.precio_nino, null);
    assert.equal(tieneAcomodacionResumen(resumen, "nino2"), true);
    assert.equal(tieneAcomodacionResumen(resumen, "nino"), false, "el filtro Chd1 no debe ofrecer este hotel");
  });

  test("Chd1/Chd2 en $0 (gratis) SÍ cuenta como 'tiene esa acomodación' — 0 no es 'no configurada' para menores", () => {
    const raw: FilaTarifario[] = [
      filaHotelBase({ hotel_id: 32, acomodacion: "doble", precio_pvp: 500000 }),
      filaHotelBase({ hotel_id: 32, acomodacion: "nino", precio_pvp: 0 }),
    ];
    const resumen = agregarComoVistaSQL(raw)[0];
    assert.equal(resumen.precio_nino, 0);
    assert.equal(tieneAcomodacionResumen(resumen, "nino"), true, "Chd1 gratis ($0) sigue siendo una acomodación ofrecida — no debe desaparecer del filtro");
  });

  test("⚠️ prueba de equivalencia central del defecto: el filtro Chd1/Chd2 devuelve el MISMO conjunto de hoteles que consultar la matriz completa directamente", () => {
    const raw: FilaTarifario[] = [
      // Hotel 40: tiene Chd1 y Chd2.
      filaHotelBase({ hotel_id: 40, acomodacion: "doble", precio_pvp: 500000 }),
      filaHotelBase({ hotel_id: 40, acomodacion: "nino", precio_pvp: 100000 }),
      filaHotelBase({ hotel_id: 40, acomodacion: "nino2", precio_pvp: 110000 }),
      // Hotel 41: solo Chd1.
      filaHotelBase({ hotel_id: 41, acomodacion: "doble", precio_pvp: 500000 }),
      filaHotelBase({ hotel_id: 41, acomodacion: "nino", precio_pvp: 100000 }),
      // Hotel 42: sin niños configurados.
      filaHotelBase({ hotel_id: 42, acomodacion: "doble", precio_pvp: 500000 }),
    ];
    // "Antes" — matriz completa: hoteles con al menos una fila nino/nino2 con
    // acomodacion presente (mismo criterio de disponibilidad, sin exigir >0).
    const hotelesConChd1Raw = new Set(raw.filter((f) => f.acomodacion === "nino").map((f) => f.hotel_id));
    const hotelesConChd2Raw = new Set(raw.filter((f) => f.acomodacion === "nino2").map((f) => f.hotel_id));

    // "Ahora" — resumen + tieneAcomodacionResumen().
    const resumen = agregarComoVistaSQL(raw);
    const hotelesConChd1Resumen = new Set(resumen.filter((f) => tieneAcomodacionResumen(f, "nino")).map((f) => f.hotel_id));
    const hotelesConChd2Resumen = new Set(resumen.filter((f) => tieneAcomodacionResumen(f, "nino2")).map((f) => f.hotel_id));

    assert.deepEqual([...hotelesConChd1Resumen].sort(), [...hotelesConChd1Raw].sort());
    assert.deepEqual([...hotelesConChd2Resumen].sort(), [...hotelesConChd2Raw].sort());
    assert.deepEqual([...hotelesConChd1Resumen].sort(), [40, 41]);
    assert.deepEqual([...hotelesConChd2Resumen].sort(), [40]);
  });
});

describe("Item 9 — equivalencia: categoría/régimen, servicios/escalas, conjunto de hoteles sin acomodación de adulto", () => {
  test("hotel SIN ninguna acomodación de adulto con precio (solo niño/infante configurados): sigue apareciendo en el resumen, desde=null (\"Consultar\")", () => {
    const raw: FilaTarifario[] = [
      filaHotelBase({ modulo: "porcion_terrestre", bloqueo_label: null, bloqueo_id: null, paquete_id: 2, hotel_id: 11, hotel_nombre: "Hotel Dos", acomodacion: "infante", precio_pvp: 0 }),
    ];
    const resumen = agregarComoVistaSQL(raw);
    assert.equal(resumen.length, 1, "el hotel sigue generando UNA fila de resumen (nunca desaparece)");
    assert.equal(resumen[0].hotel_id, 11);
    assert.equal(minRoomPvpResumen(resumen), null, "sin acomodación de adulto, desde debe ser null (\"Consultar\"), no 0 ni inventado");
  });

  test("múltiples categorías/regímenes del mismo hotel: cada combo produce su propia fila de resumen (soporta el filtro de categoría/régimen)", () => {
    const raw: FilaTarifario[] = [
      filaHotelBase({ fecha_regreso: null, categoria: "Estandar", regimen: "PC", acomodacion: "doble", precio_pvp: 500000 }),
      filaHotelBase({ fecha_regreso: null, categoria: "Suite", regimen: "PAM", acomodacion: "doble", precio_pvp: 800000 }),
    ];
    const resumen = agregarComoVistaSQL(raw);
    assert.equal(resumen.length, 2, "un grupo distinto por (categoria,regimen)");
    const estandarPC = resumen.find((f) => f.categoria === "Estandar" && f.regimen === "PC");
    const suitePAM = resumen.find((f) => f.categoria === "Suite" && f.regimen === "PAM");
    assert.equal(estandarPC?.desde_adulto, 500000);
    assert.equal(suitePAM?.desde_adulto, 800000);
    // Cruzar categoria=Estandar con regimen=PAM (una combinación que NO existe
    // en el catálogo) no debe devolver ninguna fila.
    assert.equal(resumen.filter((f) => f.categoria === "Estandar" && f.regimen === "PAM").length, 0);
  });

  test("servicios: 1 fila de resumen por combo con desde_general = mínimo real (no un valor inventado)", () => {
    const raw: FilaTarifario[] = [
      { modulo: "servicios", bloqueo_label: null, paquete_id: 3, hotel_id: null, hotel_nombre: null, servicio_id: 5, servicio_nombre: "City tour", fecha_ida: null, fecha_regreso: null, noches: null, destino_nombre: "Cartagena", paquete_nombre: "Servicios", categoria: null, regimen: null, acomodacion: null, precio_pvp: 80000, descripcion: "Recorrido por la ciudad", recargo_individual: 5000, moneda: "COP", tipo_tarifa: "persona" },
    ];
    const resumen = agregarComoVistaSQL(raw);
    assert.equal(resumen.length, 1);
    assert.equal(resumen[0].desde_general, 80000);
    assert.equal(resumen[0].modulo, "servicios");
    assert.equal(resumen[0].servicio_nombre, "City tour");
    assert.equal(resumen[0].descripcion, "Recorrido por la ciudad");
    assert.equal(resumen[0].recargo_individual, 5000);
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

function clienteSoloResumen(datasetResumen: FilaResumen[]) {
  return clienteFalso({}, datasetResumen);
}

const HOY = hoyISO();
function fechaEnBogota(offsetDias: number): string {
  const ms = Date.now() + offsetDias * 86400000;
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
const AYER = fechaEnBogota(-1);
void HOY;

function resumenBase(overrides: Partial<FilaResumen>): FilaResumen {
  return {
    modulo: "bloqueo", paquete_id: 1, paquete_nombre: "P1", bloqueo_id: 1, bloqueo_label: "L1",
    empaquetado_id: null, salida_id: null, hotel_id: 10, hotel_nombre: "Hotel Uno",
    servicio_id: null, servicio_nombre: null, destino_id: null, destino_nombre: "Cartagena",
    categoria: "Estandar", regimen: "PC", fecha_ida: MANIANA, fecha_regreso: null, noches: 3, moneda: "COP",
    precio_sencilla: null, precio_doble: 500000, precio_triple: null, precio_multiple: null,
    precio_nino: null, precio_nino2: null, precio_infante: null,
    desde_adulto: 500000, desde_general: 500000, descripcion: null, recargo_individual: null, tipo_tarifa: null,
    ...overrides,
  };
}

// Fixture mínimo de vigencia "siempre vigente" (mismo patrón ya validado en
// pruebas/tarifarioVigencia.test.ts) — rango de fechas 2020-2030 cubre
// cualquier fecha que use este archivo (MANIANA/AYER), así que una fila de
// hotel con este par temporada+tarifa SIEMPRE liquida (neto>0), sin importar
// la fecha de la fila. Se usa para poder pasar un admin REAL (no null) en las
// pruebas que no están probando vigencia en sí — necesario desde la ronda 6
// (ítem 3): `cargarResumenTarifario()` ahora falla cerrado si hay filas de
// hotel verificables y no hay admin.
function temporadaVigente(hotelId: number) {
  return { hotel_id: hotelId, nombre: "ALTA", fecha_inicio: "2020-01-01", fecha_fin: "2030-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null };
}
function tarifaVigente(hotelId: number, categoria: string, regimen: string) {
  return { hotel_id: hotelId, tipo_habitacion: categoria, alimentacion: regimen, temporada: "ALTA", neto_sencilla: 100000, neto_doble: 90000, neto_triple: 80000, neto_multiple: 70000 };
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

describe("cargarResumenTarifario() — consulta la vista de resumen, entrega FilaResumen[] SIN expandir", () => {
  test("caso feliz: consulta tarifario_resumen, entrega exactamente esas filas (magnitud del RESUMEN, no de una expansión)", async () => {
    const resumen = [resumenBase({}), resumenBase({ hotel_id: 20, hotel_nombre: "Hotel Dos", desde_adulto: 300000, precio_doble: 300000 })];
    const tablas = tablasBase({
      hotel_temporadas: { data: [temporadaVigente(10), temporadaVigente(20)], error: null },
      tarifa_hotel: { data: [tarifaVigente(10, "Estandar", "PC"), tarifaVigente(20, "Estandar", "PC")], error: null },
    });
    const sb = clienteFalso(tablas, resumen);
    const r = await cargarResumenTarifario(sb, "test", "flujo1", sb);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 2, "2 filas de resumen entran → 2 filas de resumen salen");
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

  test("bloqueo con fecha_ida de AYER: se oculta (mismo criterio que cargarDatosTarifario, aplicado al resumen) — con vigencia REAL vigente, para aislar específicamente el filtro de fecha pasada", async () => {
    const resumen = [resumenBase({ modulo: "bloqueo", hotel_id: 10, fecha_ida: AYER })];
    // Vigencia de compra VÁLIDA (2020-2030, cubre AYER) — así la fila se
    // oculta ÚNICAMENTE por el filtro explícito de "salida ya pasada", no
    // porque además le faltara vigencia (que la escondería igual, pero por
    // otra razón, sin probar lo que este caso dice probar).
    const tablas = tablasBase({
      hotel_temporadas: { data: [temporadaVigente(10)], error: null },
      tarifa_hotel: { data: [tarifaVigente(10, "Estandar", "PC")], error: null },
    });
    const sb = clienteFalso(tablas, resumen);
    const r = await cargarResumenTarifario(sb, "test", "flujo1", sb);
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
    assert.equal(r.datos.filasVisibles[0].desde_general, 90000);
  });

  test("⚠️ ronda 6, ítem 3 — REPRODUCCIÓN del defecto (antes de esta ronda daba ok:true): un error TÉCNICO de vigencia ahora hace fallar TODA la función, no solo oculta la fila afectada", async () => {
    const resumen = [resumenBase({ hotel_id: 12 })];
    const tablas = tablasBase({ hotel_temporadas: { data: null, error: { message: "timeout" } } });
    const sb = clienteFalso(tablas, resumen);
    const admin = sb;
    const r = await cargarResumenTarifario(sb, "test", "flujo1", admin);
    // Antes de esta ronda: `ok:true` con `filasVisibles.length === 0` — un
    // catálogo parcial (vacío) disfrazado de "esto es todo lo disponible".
    // Ahora: la función entera falla cerrada — nunca entrega catálogo
    // parcial como disponibilidad válida.
    assert.equal(r.ok, false, "un error técnico de vigencia debe fallar TODA la carga, no solo ocultar la fila afectada");
    if (r.ok) return;
    assert.match(r.error, /No fue posible cargar el tarifario/);
  });

  test("⚠️ ronda 6, ítem 3 — REPRODUCCIÓN del defecto: falta SUPABASE_SERVICE_ROLE_KEY (admin=null) con filas de hotel verificables presentes — antes daba ok:true con catálogo parcial, ahora falla cerrado", async () => {
    const resumen = [resumenBase({ modulo: "bloqueo", hotel_id: 10 })]; // bloqueo + hotel_id + fecha_ida ⇒ esFilaHotelVerificable() = true
    const sb = clienteFalso(tablasBase(), resumen);
    const r = await cargarResumenTarifario(sb, "test", "flujo1", null);
    assert.equal(r.ok, false, "sin service-role y con filas de hotel verificables, la carga entera debe fallar — nunca publicar un catálogo sin poder confirmar su vigencia");
    if (r.ok) return;
    assert.match(r.error, /No fue posible cargar el tarifario/);
  });

  test("admin=null es válido cuando NO hay ninguna fila de hotel verificable (solo servicios) — ok:true", async () => {
    const resumen = [resumenBase({ modulo: "servicios", hotel_id: null, servicio_id: 7, servicio_nombre: "Tour", categoria: null, regimen: null, desde_general: 90000, paquete_id: 9 })];
    // Sin admin, `aplicarFiltrosPostCarga` no puede resolver `armado_paquetes`
    // (necesita admin) — por eso el módulo `servicios` con `admin=null` no se
    // publica (mismo criterio ya existente, no relacionado con este ítem):
    // `filasVisibles` se filtra en el bloque `if (admin && ...)`.
    const sb = clienteFalso(tablasBase(), resumen);
    const r = await cargarResumenTarifario(sb, "test", "flujo1", null);
    assert.equal(r.ok, true, "sin filas de hotel verificables, admin=null no debe hacer fallar la carga");
  });

  test("admin presente + hotel-verificable presente: sigue funcionando igual que antes de esta ronda (caso feliz no afectado)", async () => {
    const resumen = [resumenBase({ hotel_id: 15 })];
    const tablas = tablasBase({
      hotel_temporadas: { data: [temporadaVigente(15)], error: null },
      tarifa_hotel: { data: [tarifaVigente(15, "Estandar", "PC")], error: null },
    });
    const sb = clienteFalso(tablas, resumen);
    const r = await cargarResumenTarifario(sb, "test", "flujo1", sb);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 1);
  });
});

// ── Ronda 6, Item 1 — paginación robusta de `cargarFilasResumenPaginado()` ──
//
// Defecto reportado: la versión anterior terminaba con `page.length < PAGE`
// y avanzaba `from` por `PAGE` fijo. PostgREST puede recortar la respuesta a
// MENOS filas de las pedidas por `.range()` (límite "Max Rows" del proyecto)
// aunque queden más filas después — ese recorte no significa "no hay más".
// Corrección: orden TOTAL determinista (todas las columnas del `group by` de
// la migración 161 salvo `paquete_activo`, siempre `true`), avance por la
// cantidad REAL de filas recibidas, término SOLO con página vacía, y una
// guardia explícita de páginas máximas contra falta de progreso.
describe("Ronda 6, Item 1 — paginación robusta ante recorte de PostgREST (Max Rows) y orden total determinista", () => {
  // 12 filas en 3 grupos de 4: cada grupo comparte destino_nombre/
  // bloqueo_label/hotel_nombre/categoria/regimen (EMPATAN bajo el orden
  // ANTERIOR de 5 columnas) pero difieren en hotel_id/paquete_id/fecha_ida
  // (se DESAMBIGUAN bajo el orden nuevo de 19 columnas).
  function fixtureConEmpates(): FilaResumen[] {
    const filas: FilaResumen[] = [];
    let hotelId = 1;
    for (const grupo of ["Cartagena", "San Andres", "Santa Marta"]) {
      for (let i = 0; i < 4; i++) {
        filas.push(resumenBase({
          hotel_id: hotelId, paquete_id: hotelId, hotel_nombre: "Hotel Igual",
          destino_nombre: grupo, bloqueo_label: "L1", categoria: "Est", regimen: "PC",
          fecha_ida: fechaEnBogota(i + 1), desde_adulto: 400000 + hotelId,
        }));
        hotelId++;
      }
    }
    return filas;
  }

  const ORDEN_VIEJO = ["destino_nombre", "bloqueo_label", "hotel_nombre", "categoria", "regimen"] as const;
  const ORDEN_NUEVO = [
    "modulo", "paquete_id", "paquete_nombre", "bloqueo_id", "bloqueo_label",
    "empaquetado_id", "salida_id", "hotel_id", "hotel_nombre", "servicio_id",
    "servicio_nombre", "destino_id", "destino_nombre", "categoria", "regimen",
    "fecha_ida", "fecha_regreso", "noches", "moneda",
  ] as const;

  function claveOrden(f: FilaResumen, cols: readonly string[]): string {
    return cols.map((c) => String((f as unknown as Record<string, unknown>)[c] ?? "∅")).join("|||");
  }

  test("el orden ANTERIOR (5 columnas) deja empates reales en este catálogo — no era un orden total", () => {
    const claves = fixtureConEmpates().map((f) => claveOrden(f, ORDEN_VIEJO));
    assert.ok(new Set(claves).size < claves.length, "debe haber al menos una clave repetida bajo el orden anterior de 5 columnas");
  });

  test("el orden NUEVO (19 columnas — todo el group by de la migración 161 salvo paquete_activo) desambigua TODAS las filas del mismo catálogo", () => {
    const claves = fixtureConEmpates().map((f) => claveOrden(f, ORDEN_NUEVO));
    assert.equal(new Set(claves).size, claves.length, "cada fila debe tener una clave única bajo el orden total nuevo");
  });

  type FakeBuilder = {
    select(cols: string): FakeBuilder;
    order(col: string): FakeBuilder;
    range(from: number, to: number): Promise<{ data: FilaResumen[] | null; error: unknown }>;
  };

  // Servidor simulado: ordena por las columnas realmente pedidas (`.order`) y
  // SIEMPRE recorta la respuesta a un máximo fijo de filas, sin importar
  // cuántas se pidieron por `.range()` — reproduce el límite "Max Rows" de un
  // proyecto Supabase real (Settings → API), que trunca la respuesta sin error.
  function servidorSimuladoMaxRows(dataset: FilaResumen[], maxFilasPorPagina: number) {
    function builder(tabla: string) {
      const ordenCols: string[] = [];
      let rangeArgs: [number, number] = [0, 999];
      const b = {
        select() { return this; },
        order(col: string) { ordenCols.push(col); return this; },
        range(from: number, to: number) { rangeArgs = [from, to]; return this; },
        then(resolve: (v: { data: unknown; error: unknown }) => void) {
          if (tabla !== "tarifario_resumen") { resolve({ data: [], error: null }); return; }
          const ordenado = [...dataset].sort((a, b2) => {
            for (const col of ordenCols) {
              const av = (a as unknown as Record<string, unknown>)[col];
              const bv = (b2 as unknown as Record<string, unknown>)[col];
              if (av === bv) continue;
              if (av == null) return -1;
              if (bv == null) return 1;
              if (av < bv) return -1;
              if (av > bv) return 1;
            }
            return 0;
          });
          const [from, to] = rangeArgs;
          const pedida = ordenado.slice(from, to + 1);
          // El recorte tipo "Max Rows": nunca más de `maxFilasPorPagina`,
          // aunque `to - from + 1` (lo pedido) sea mucho mayor.
          resolve({ data: pedida.slice(0, maxFilasPorPagina), error: null });
        },
      };
      return b;
    }
    return { from: builder } as unknown as SupabaseClient<Database>;
  }

  // Reimplementación LOCAL de la versión ANTERIOR (con el defecto reportado)
  // de `cargarFilasResumenPaginado` — orden de 5 columnas, termina con
  // `page.length < PAGE`, avanza `from` por `PAGE` fijo — usada SOLO para
  // demostrar el defecto como control negativo (la función real ya no existe
  // en este código; el código de producción actual es el corregido de arriba).
  async function paginarViejoBuggy(sb: SupabaseClient<Database>): Promise<FilaResumen[]> {
    const PAGE_VIEJO = 1000;
    const filas: FilaResumen[] = [];
    for (let from = 0; ; from += PAGE_VIEJO) {
      let q = (sb.from("tarifario_resumen") as unknown as FakeBuilder).select("*");
      for (const col of ORDEN_VIEJO) q = q.order(col);
      const { data: page } = await q.range(from, from + PAGE_VIEJO - 1);
      if (!page || page.length === 0) break;
      filas.push(...page);
      if (page.length < PAGE_VIEJO) break;
    }
    return filas;
  }

  test("⚠️ REPRODUCCIÓN del defecto: contra un servidor que recorta a máximo 2 filas por pedido, el algoritmo ANTERIOR pierde la mayoría del catálogo (termina en la primera página)", async () => {
    const dataset = fixtureConEmpates();
    const sb = servidorSimuladoMaxRows(dataset, 2);
    const recibidas = await paginarViejoBuggy(sb);
    assert.ok(recibidas.length < dataset.length, `el algoritmo anterior debe truncar (recibió ${recibidas.length} de ${dataset.length} filas)`);
    assert.equal(recibidas.length, 2, "termina exactamente en la primera página recortada por el servidor (2 < PAGE=1000 dispara el `break` viejo)");
  });

  test("cargarFilasResumenPaginado() corregido: contra el MISMO servidor recortado a 2 filas por pedido, recupera TODO el catálogo — más de 3 páginas, sin perder, duplicar ni cortar filas", async () => {
    const dataset = fixtureConEmpates();
    const sb = servidorSimuladoMaxRows(dataset, 2);
    const pag = await cargarFilasResumenPaginado(sb);
    assert.equal(pag.ok, true);
    if (!pag.ok) return;
    assert.equal(pag.filas.length, dataset.length, "debe recuperar las 12 filas completas, no solo la primera página recortada");
    assert.ok(pag.paginasConsultadas > 3, `debe haber necesitado más de 3 páginas (12 filas / 2 por página = 6) — hubo ${pag.paginasConsultadas}`);
    const idsRecibidos = pag.filas.map((f) => f.hotel_id as number);
    assert.equal(new Set(idsRecibidos).size, dataset.length, "ningún hotel_id debe repetirse — sin duplicados");
    assert.deepEqual(
      [...idsRecibidos].sort((a, b) => a - b),
      dataset.map((f) => f.hotel_id as number).sort((a, b) => a - b),
      "el conjunto de hoteles recuperados debe ser EXACTAMENTE el del catálogo completo — sin faltantes"
    );
  });

  test("guardia explícita contra falta de progreso: un servidor que nunca entrega una página vacía falla cerrado (ok:false), no hace un loop sin fin", async () => {
    // Servidor patológico: SIEMPRE devuelve 1 fila, nunca una página vacía —
    // simula un backend roto/mal configurado que jamás señala "fin".
    function builder() {
      return {
        select() { return this; },
        order() { return this; },
        range() { return this; },
        then(resolve: (v: { data: unknown; error: unknown }) => void) {
          resolve({ data: [resumenBase({ hotel_id: 1 })], error: null });
        },
      };
    }
    const sb = { from: builder } as unknown as SupabaseClient<Database>;
    const pag = await cargarFilasResumenPaginado(sb);
    assert.equal(pag.ok, false, "debe fallar cerrado en vez de continuar indefinidamente");
    if (pag.ok) return;
    const msg = pag.error instanceof Error ? pag.error.message : String(pag.error);
    assert.match(msg, /límite de \d+ páginas/, "el error debe explicar que se alcanzó el límite de páginas, no un error de red genérico");
  });
});
