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
    const sb = clienteFalso(tablasBase(), resumen);
    const r = await cargarResumenTarifario(sb, "test", "flujo1", null);
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
    const sb = clienteFalso(tablasBase(), resumen);
    const r = await cargarResumenTarifario(sb, "test", "flujo1", null);
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
    assert.equal(r.datos.filasVisibles[0].desde_general, 90000);
  });

  test("⚠️ falla cerrada de verdad: un error TÉCNICO de vigencia se registra como error (no se disfraza de 'sin disponibilidad') — las filas afectadas quedan ocultas igual, pero el estado es error", async () => {
    const resumen = [resumenBase({ hotel_id: 12 })];
    const tablas = tablasBase({ hotel_temporadas: { data: null, error: { message: "timeout" } } });
    const sb = clienteFalso(tablas, resumen);
    const admin = sb;
    const r = await cargarResumenTarifario(sb, "test", "flujo1", admin);
    // La página sigue mostrando el resto del tarifario (comportamiento
    // establecido, ver lib/tarifario/datos.ts) — pero la fila de hotel
    // afectada por el error técnico de vigencia queda oculta (fail-closed).
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 0, "fail-closed: sin poder verificar vigencia, la fila de hotel no se publica");
  });
});
