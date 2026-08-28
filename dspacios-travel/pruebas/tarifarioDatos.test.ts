import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { cargarDatosTarifario } from "../lib/tarifario/datos.ts";
import { hoyISO } from "../lib/calc/paquetes.ts";
import type { FilaTarifario } from "../app/tarifario/TarifarioPublic.tsx";

// EJECUCIÓN REAL (no grep) de cargarDatosTarifario() — revisión posterior,
// defecto "EQUIVALENCIA FUNCIONAL" confirmado: la reorganización de
// concurrencia (item 6 de la revisión) y el manejo de errores explícito
// (item 5) NO deben cambiar qué filas quedan visibles, qué precios/cupos se
// calculan, ni las reglas de negocio ya existentes (fail-closed de
// vigencia/empaquetados, recorte de "servicios", enriquecimiento de hotel).
// No hay una copia separada del código "viejo" retenida en el repo para
// diffear — el propio código documenta con comentarios que la lógica de
// filtrado es la MISMA, solo reordenada; estas pruebas ejecutan esa lógica
// contra fixtures representativos y verifican el resultado exacto esperado
// según las reglas de negocio documentadas (bloqueo con fecha vencida se
// oculta, empaquetado sin vigencia se oculta, servicios sueltos solo si el
// paquete es tipo 'servicios', etc.) — el mismo criterio que un test de
// regresión visual/funcional cuando no queda una implementación anterior
// separada para comparar bit a bit.
//
// Nota de alcance: `cargarDatosTarifario` ahora acepta un 4º parámetro
// opcional `admin` (con el MISMO valor por defecto que antes calculaba
// internamente — ninguna de las 3 páginas reales lo pasa) — existe
// exclusivamente para poder inyectar aquí un cliente admin FALSO, mismo
// patrón que `filtrarTarifarioVencidas(admin, filas)`.

type Fila = { data: unknown[] | null; error: unknown };

function clienteFalso(tablas: Record<string, Fila>, datasetTarifario: FilaTarifario[]) {
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
        if (tabla === "tarifario_resultado") {
          const [from, to] = rangeArgs ?? [0, 999];
          resolve({ data: datasetTarifario.slice(from, to + 1), error: null });
        } else {
          const cfg = tablas[tabla] ?? { data: [], error: null };
          resolve({ data: cfg.data, error: cfg.error });
        }
      },
    };
    return b;
  }
  const sb = { from: builder };
  return sb as unknown as SupabaseClient<Database>;
}

// Mismo huso horario que hoyISO() (America/Bogota) — construir AYER/MAÑANA
// en UTC podía desalinearse con la comparación real de la función cerca de
// la medianoche, dando falsos negativos/positivos según la hora del run.
const HOY = hoyISO();
function fechaEnBogota(offsetDias: number): string {
  const ms = Date.now() + offsetDias * 86400000;
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
const AYER = fechaEnBogota(-1);
const MANIANA = fechaEnBogota(1);
void HOY;

function filaBase(overrides: Partial<FilaTarifario>): FilaTarifario {
  return {
    modulo: "bloqueo",
    bloqueo_label: "L1",
    bloqueo_id: 1,
    paquete_id: 1,
    hotel_id: 10,
    fecha_ida: MANIANA,
    fecha_regreso: null,
    noches: 3,
    destino_nombre: "Cartagena",
    paquete_nombre: "Paquete 1",
    hotel_nombre: "Hotel Uno",
    categoria: "Estandar",
    regimen: "PC",
    acomodacion: "doble",
    precio_pvp: 500000,
    moneda: "COP",
    ...overrides,
  };
}

// Tablas vacías por defecto — cada test las sobrescribe según necesite.
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

describe("cargarDatosTarifario() — filas de módulo 'bloqueo': fecha_ida vencida se oculta, futura se conserva", () => {
  test("bloqueo con fecha_ida de AYER: se oculta", async () => {
    const filas = [filaBase({ modulo: "bloqueo", fecha_ida: AYER })];
    const sb = clienteFalso(tablasBase(), filas);
    const r = await cargarDatosTarifario(sb, "test", "flujo1", null);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 0, "una fila de bloqueo vencida debe ocultarse");
  });

  test("bloqueo con fecha_ida de MAÑANA: se conserva", async () => {
    const filas = [filaBase({ modulo: "bloqueo", fecha_ida: MANIANA })];
    const sb = clienteFalso(tablasBase(), filas);
    const r = await cargarDatosTarifario(sb, "test", "flujo1", null);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 1);
  });
});

describe("cargarDatosTarifario() — módulo 'dinamico': misma regla de fecha que bloqueo", () => {
  test("dinamico con fecha_ida vencida: se oculta (mismo criterio que bloqueo)", async () => {
    const filas = [filaBase({ modulo: "dinamico", fecha_ida: AYER })];
    const sb = clienteFalso(tablasBase(), filas);
    const r = await cargarDatosTarifario(sb, "test", "flujo1", null);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 0);
  });

  test("dinamico con fecha_ida futura: se conserva", async () => {
    const filas = [filaBase({ modulo: "dinamico", fecha_ida: MANIANA })];
    const sb = clienteFalso(tablasBase(), filas);
    const r = await cargarDatosTarifario(sb, "test", "flujo1", null);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 1);
  });
});

describe("cargarDatosTarifario() — módulo 'porcion_terrestre': NO se filtra por fecha_ida vencida (a diferencia de bloqueo/dinamico)", () => {
  test("porcion_terrestre con fecha_ida de AYER: se conserva (la regla de fecha vencida solo aplica a bloqueo/dinamico)", async () => {
    const filas = [filaBase({ modulo: "porcion_terrestre", fecha_ida: AYER, bloqueo_id: null, bloqueo_label: null })];
    const sb = clienteFalso(tablasBase(), filas);
    const r = await cargarDatosTarifario(sb, "test", "flujo1", null);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 1, "porcion_terrestre no se oculta por fecha vencida en esta función (vigencia de compra es un filtro aparte)");
  });
});

describe("cargarDatosTarifario() — empaquetados: fail-closed cuando no está activo/vigente", () => {
  test("empaquetado_id presente, activo=true y vigente: la fila se conserva", async () => {
    const filas = [filaBase({ modulo: "dinamico", empaquetado_id: 5, fecha_ida: MANIANA })];
    const sb = clienteFalso(
      tablasBase({ empaquetados: { data: [{ id: 5, activo: true, compra_inicio: null, compra_fin: null }], error: null } }),
      filas
    );
    const r = await cargarDatosTarifario(sb, "test", "flujo1", sb); // admin = mismo cliente falso
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 1);
  });

  test("empaquetado_id presente, activo=false: la fila se OCULTA (fail-closed de negocio)", async () => {
    const filas = [filaBase({ modulo: "dinamico", empaquetado_id: 5, fecha_ida: MANIANA })];
    const sb = clienteFalso(
      tablasBase({ empaquetados: { data: [{ id: 5, activo: false, compra_inicio: null, compra_fin: null }], error: null } }),
      filas
    );
    const r = await cargarDatosTarifario(sb, "test", "flujo1", sb);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 0);
  });

  test("empaquetado_id presente pero SIN admin (sin service role): también se oculta (fail-closed, mismo criterio que error de consulta)", async () => {
    const filas = [filaBase({ modulo: "dinamico", empaquetado_id: 5, fecha_ida: MANIANA })];
    const sb = clienteFalso(tablasBase(), filas);
    const r = await cargarDatosTarifario(sb, "test", "flujo1", null);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 0);
  });

  test("error técnico en la consulta de empaquetados: fail-closed (oculta), NUNCA se publica sin verificar", async () => {
    const filas = [filaBase({ modulo: "dinamico", empaquetado_id: 5, fecha_ida: MANIANA })];
    const sb = clienteFalso(
      tablasBase({ empaquetados: { data: null, error: { code: "42501" } } }),
      filas
    );
    const r = await cargarDatosTarifario(sb, "test", "flujo1", sb);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 0);
  });
});

describe("cargarDatosTarifario() — servicios: solo visibles como producto suelto si el paquete es tipo 'servicios'; SIEMPRE en filasAddon", () => {
  test("fila de servicios cuyo paquete_id SÍ es tipo 'servicios': visible en filasVisibles Y en filasAddon", async () => {
    const filas = [filaBase({ modulo: "servicios", paquete_id: 7, bloqueo_id: null, bloqueo_label: null, hotel_id: null })];
    const sb = clienteFalso(
      tablasBase({ armado_paquetes: { data: [{ id: 7 }], error: null } }),
      filas
    );
    const r = await cargarDatosTarifario(sb, "test", "flujo1", sb);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 1);
    assert.equal(r.datos.filasAddon.length, 1);
  });

  test("fila de servicios cuyo paquete_id NO es tipo 'servicios' (es un add-on de un paquete de hotel): oculta de filasVisibles, SIGUE en filasAddon", async () => {
    const filas = [filaBase({ modulo: "servicios", paquete_id: 8, bloqueo_id: null, bloqueo_label: null, hotel_id: null })];
    const sb = clienteFalso(
      tablasBase({ armado_paquetes: { data: [], error: null } }), // paquete 8 NO es tipo 'servicios'
      filas
    );
    const r = await cargarDatosTarifario(sb, "test", "flujo1", sb);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 0, "no debe publicarse como producto suelto");
    assert.equal(r.datos.filasAddon.length, 1, "pero SÍ debe seguir disponible como add-on scoped al paquete de hotel");
  });
});

describe("cargarDatosTarifario() — enriquecimiento de hotel: capacidades, infoPorHotel y tarifa de infante", () => {
  // `filtrarTarifarioVencidas` (filtro_vigencia) exige que exista una
  // temporada+tarifa real que "liquide" para hotel_id/categoria/regimen —
  // si no, la fila queda fail-closed (oculta) ANTES de llegar al
  // enriquecimiento que prueban estos dos tests, así que cada fixture debe
  // incluir hotel_temporadas + tarifa_hotel (neto_doble, la acomodación de
  // filaBase) suficientes para que la fila sobreviva ese filtro.
  const TEMPORADA_VIGENTE = { nombre: "GENERAL", fecha_inicio: "2020-01-01", fecha_fin: "2030-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null };

  test("un hotel con hotel_acomodaciones + tarifa de infante: capPorHotel/infoPorHotel quedan poblados correctamente", async () => {
    const filas = [filaBase({ modulo: "bloqueo", hotel_id: 20, fecha_ida: MANIANA })];
    const sb = clienteFalso(
      tablasBase({
        hotel_temporadas: { data: [{ hotel_id: 20, ...TEMPORADA_VIGENTE }], error: null },
        tarifa_hotel: {
          data: [
            { hotel_id: 20, tipo_habitacion: "Estandar", alimentacion: "PC", temporada: "GENERAL", neto_sencilla: 400000, neto_doble: 350000, neto_triple: 300000, neto_multiple: 280000, neto_infante: 50000, nota_infante: "Comparte cama" },
          ],
          error: null,
        },
        hoteles: {
          data: [{ id: 20, estrellas: 4, clasificacion: "Resort", descripcion: "Lindo", ubicacion: "Playa", video_url: null, pax_min: 1, pax_max: 6, edad_nino_min: 2, edad_nino_max: 11, edad_infante_min: 0, edad_infante_max: 1, nino_nota: null, adults_only: false, pet_friendly: false, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null }],
          error: null,
        },
        hotel_acomodaciones: {
          data: [{ hotel_id: 20, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 1 }],
          error: null,
        },
      }),
      filas
    );
    const r = await cargarDatosTarifario(sb, "test", "flujo1", sb);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 1, "la fila debe sobrevivir el filtro de vigencia (temporada+tarifa configuradas)");
    assert.equal(r.datos.capPorHotel[20]?.acom.length, 1, "capPorHotel debe traer la acomodación cargada");
    assert.equal(r.datos.capPorHotel[20]?.paxMax, 6);
    assert.equal(r.datos.infoPorHotel[20]?.estrellas, 4);
    assert.equal(r.datos.infoPorHotel[20]?.infanteCargo, true, "neto_infante > 0 debe marcar infanteCargo=true");
    assert.equal(r.datos.infoPorHotel[20]?.infanteNota, "Comparte cama");
  });

  test("un hotel SIN tarifa de infante configurada (neto_infante ausente/0): infanteCargo=false (infante gratis, asimetría deliberada documentada en CLAUDE.md)", async () => {
    const filas = [filaBase({ modulo: "bloqueo", hotel_id: 21, fecha_ida: MANIANA })];
    const sb = clienteFalso(
      tablasBase({
        hotel_temporadas: { data: [{ hotel_id: 21, ...TEMPORADA_VIGENTE }], error: null },
        tarifa_hotel: {
          data: [{ hotel_id: 21, tipo_habitacion: "Estandar", alimentacion: "PC", temporada: "GENERAL", neto_sencilla: 300000, neto_doble: 250000, neto_triple: 220000, neto_multiple: 200000 }],
          error: null,
        },
        hoteles: { data: [{ id: 21, estrellas: 3, clasificacion: null, descripcion: null, ubicacion: null, video_url: null, pax_min: 1, pax_max: 4, edad_nino_min: null, edad_nino_max: null, edad_infante_min: null, edad_infante_max: null, nino_nota: null, adults_only: false, pet_friendly: false, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null }], error: null },
      }),
      filas
    );
    const r = await cargarDatosTarifario(sb, "test", "flujo1", sb);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 1, "la fila debe sobrevivir el filtro de vigencia (temporada+tarifa configuradas, sin neto_infante)");
    assert.equal(r.datos.infoPorHotel[21]?.infanteCargo, false);
  });
});

describe("cargarDatosTarifario() — cupos_por_bloqueo y bloqueos_vuelo (origen) se conservan de forma INDEPENDIENTE ante error de la otra", () => {
  // ⚠️ Defecto confirmado: antes un `error: e1 ?? e2 ?? null` combinado
  // descartaba AMBOS resultados si CUALQUIERA de las dos consultas fallaba
  // — un fallo puntual de `bloqueos_vuelo` (origen) borraba también los
  // cupos ya obtenidos correctamente, y viceversa. VistaBooking.tsx/
  // TarifarioPublic.tsx tratan `cuposPorBloqueo[id] === undefined` como
  // "disponibilidad desconocida" y pueden mostrar una salida como agotada
  // sin estarlo — así que cada consulta debe sobrevivir por separado.
  test("falla SOLO bloqueos_vuelo (origen): los cupos válidos de cupos_por_bloqueo se conservan", async () => {
    const filas = [filaBase({ modulo: "bloqueo", bloqueo_id: 1, hotel_id: null, fecha_ida: MANIANA })];
    const sb = clienteFalso(
      tablasBase({
        cupos_por_bloqueo: { data: [{ id: 1, cupos_disponibles: 7 }], error: null },
        bloqueos_vuelo: { data: null, error: { code: "XX000" } },
      }),
      filas
    );
    const r = await cargarDatosTarifario(sb, "test", "flujo1", sb);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.cuposPorBloqueo[1], 7, "los cupos válidos NO deben perderse por un fallo ajeno en bloqueos_vuelo");
    assert.equal(r.datos.origenPorBloqueo[1], undefined, "sin origen: bloqueos_vuelo sí falló");
  });

  test("falla SOLO cupos_por_bloqueo: el origen válido de bloqueos_vuelo se conserva", async () => {
    const filas = [filaBase({ modulo: "bloqueo", bloqueo_id: 1, hotel_id: null, fecha_ida: MANIANA })];
    const sb = clienteFalso(
      tablasBase({
        cupos_por_bloqueo: { data: null, error: { code: "XX000" } },
        bloqueos_vuelo: { data: [{ id: 1, origen: "BOG", ruta: "BOG-SMR" }], error: null },
      }),
      filas
    );
    const r = await cargarDatosTarifario(sb, "test", "flujo1", sb);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.cuposPorBloqueo[1], undefined, "sin cupos: cupos_por_bloqueo sí falló");
    assert.equal(r.datos.origenPorBloqueo[1], "BOG", "el origen válido NO debe perderse por un fallo ajeno en cupos_por_bloqueo");
  });
});

describe("cargarDatosTarifario() — hotel_acomodaciones y tarifa de infante se conservan de forma INDEPENDIENTE ante error de la otra", () => {
  // Mismo defecto que cupos/origen, en el segundo par de consultas
  // combinadas de esta función. Se usa modulo 'dinamico' (en vez de
  // 'bloqueo') a propósito: `esFilaHotelVerificable` (lib/tarifario/
  // vigencia.ts) solo exige vigencia de hotel para 'bloqueo'/
  // 'porcion_terrestre' — así esta fila NO dispara `filtrarTarifarioVencidas`
  // contra `hotel_temporadas`/`tarifa_hotel` (hIds queda vacío), dejando
  // limpio el mock de `tarifa_hotel` para aislar exclusivamente la consulta
  // de tarifa de infante que sí prueban estos dos tests.
  test("falla SOLO la tarifa de infante (tarifa_hotel): las acomodaciones válidas se conservan", async () => {
    const filas = [filaBase({ modulo: "dinamico", hotel_id: 22, fecha_ida: MANIANA })];
    const sb = clienteFalso(
      tablasBase({
        hoteles: { data: [{ id: 22, estrellas: 3, clasificacion: null, descripcion: null, ubicacion: null, video_url: null, pax_min: 1, pax_max: 4, edad_nino_min: null, edad_nino_max: null, edad_infante_min: null, edad_infante_max: null, nino_nota: null, adults_only: false, pet_friendly: false, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null }], error: null },
        hotel_acomodaciones: { data: [{ hotel_id: 22, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 1 }], error: null },
        tarifa_hotel: { data: null, error: { code: "XX000" } },
      }),
      filas
    );
    const r = await cargarDatosTarifario(sb, "test", "flujo1", sb);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.capPorHotel[22]?.acom.length, 1, "la acomodación válida NO debe perderse por un fallo ajeno en tarifa_hotel");
    assert.equal(r.datos.infoPorHotel[22]?.infanteCargo, false, "sin tarifa de infante: tarifa_hotel sí falló, queda gratis (fail-closed de negocio, no error silenciado)");
  });

  test("falla SOLO hotel_acomodaciones: la tarifa de infante válida se conserva", async () => {
    const filas = [filaBase({ modulo: "dinamico", hotel_id: 22, fecha_ida: MANIANA })];
    const sb = clienteFalso(
      tablasBase({
        hoteles: { data: [{ id: 22, estrellas: 3, clasificacion: null, descripcion: null, ubicacion: null, video_url: null, pax_min: 1, pax_max: 4, edad_nino_min: null, edad_nino_max: null, edad_infante_min: null, edad_infante_max: null, nino_nota: null, adults_only: false, pet_friendly: false, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null }], error: null },
        hotel_acomodaciones: { data: null, error: { code: "XX000" } },
        tarifa_hotel: { data: [{ hotel_id: 22, neto_infante: 50000, nota_infante: "Comparte cama" }], error: null },
      }),
      filas
    );
    const r = await cargarDatosTarifario(sb, "test", "flujo1", sb);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.capPorHotel[22]?.acom.length, 0, "sin acomodaciones: hotel_acomodaciones sí falló (capPorHotel existe por la consulta hoteles, pero sin acom)");
    assert.equal(r.datos.infoPorHotel[22]?.infanteCargo, true, "la tarifa de infante válida NO debe perderse por un fallo ajeno en hotel_acomodaciones");
    assert.equal(r.datos.infoPorHotel[22]?.infanteNota, "Comparte cama");
  });
});

describe("cargarDatosTarifario() — más de 1.000 filas cargan completas, sin duplicar ni perder ninguna (equivalencia a escala)", () => {
  test("1500 filas de bloqueo (todas con fecha futura, sin hotel/servicio/empaquetado): todas quedan visibles, ningún id duplicado", async () => {
    const filas: FilaTarifario[] = Array.from({ length: 1500 }, (_, i) =>
      filaBase({ modulo: "bloqueo", bloqueo_id: i, hotel_id: null, fecha_ida: MANIANA, paquete_nombre: `Paquete ${i}` })
    );
    const sb = clienteFalso(tablasBase(), filas);
    const r = await cargarDatosTarifario(sb, "test", "flujo1", null);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 1500);
    const nombres = new Set(r.datos.filasVisibles.map((f) => f.paquete_nombre));
    assert.equal(nombres.size, 1500, "ningún paquete duplicado ni perdido a la escala de >1000 filas");
  });
});

describe("cargarDatosTarifario() — error crítico de paginación: aborta con {ok:false}, NUNCA con 0 filas disfrazadas de 'sin tarifas'", () => {
  test("un error en la paginación de tarifario_resultado propaga ok:false con el mensaje público fijo", async () => {
    const sbConError = {
      from(tabla: string) {
        if (tabla !== "tarifario_resultado") return { select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, then(r: (v: unknown) => void) { r({ data: [], error: null }); } };
        return {
          select() { return this; },
          eq() { return this; },
          order() { return this; },
          range() { return Promise.resolve({ data: null, error: { code: "57014" } }); },
        };
      },
    };
    const r = await cargarDatosTarifario(sbConError as unknown as SupabaseClient<Database>, "test", "flujo1", null);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error, "No fue posible cargar el tarifario en este momento. Intenta nuevamente en unos segundos.");
  });
});
