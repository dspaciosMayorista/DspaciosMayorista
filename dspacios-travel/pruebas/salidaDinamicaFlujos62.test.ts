import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import type { FilaTarifario } from "../app/tarifario/TarifarioPublic.tsx";
import { register } from "node:module";
import { crearClienteFalso, type ClienteFalso, type TablasFalsas, type FilaFalsa } from "./support/fakeSupabase.ts";

// #62 — vigencia y estado de salidas dinámicas, EJECUCIÓN REAL de los
// consumidores (no regex):
//   • computarReserva()        — primer paso compartido de cotizar/reservar/convertir.
//   • cargarDatosTarifario()   — carga de ofertas (cache `tarifario_resultado`).
//   • cargarResumenTarifario() y obtenerDetalle*() — la carga REAL de la
//     vitrina (/tarifario, /dashboard/reservar), vía filtrosPostCarga.ts.
//   • generarTarifario() — ejecución real de la Server Action. Su archivo
//     importa `next/cache`, que NO resuelve bajo `node --test` plano (el
//     aliasLoader solo mapea `next/headers`); sin editar ese loader, la
//     prueba registra DENTRO de sí misma un hook de resolución que sustituye
//     `next/cache` por un stub (ver la sección de generarTarifario).
//
// Todas las fechas se derivan de "hoy en America/Bogota" (mismo criterio del
// motor), nunca de UTC: cerca de la medianoche UTC-5 un offset en UTC daría
// falsos positivos/negativos según la hora del run.

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

let adminActual: ClienteFalso = crearClienteFalso({});
// Cliente de SESIÓN que devuelve createClient() — null = no debe invocarse
// (computarReserva recibe `sb` por parámetro; solo las Server Actions
// generarTarifario()/obtenerDetalle*() lo piden y lo fijan cada prueba).
let sbServidor: unknown = null;
mock.module("@/lib/supabase/admin", {
  namedExports: { createAdminClient: () => adminActual },
});
mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: async () => {
      if (sbServidor == null) throw new Error("createClient() real NUNCA debe invocarse en esta prueba — sb se inyecta como parámetro.");
      return sbServidor;
    },
  },
});

// `next/cache` no resuelve bajo `node --test` plano (mapa de exports de Next
// 16). Sin tocar aliasLoader.mjs, esta prueba registra su PROPIO hook de
// resolución —válido solo para este proceso de prueba— que entrega un stub
// inerte; debe registrarse ANTES del primer import de una Server Action.
register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, n) {
     if (s === "next/cache") return { url: "data:text/javascript,export const revalidatePath=()=>{};export const revalidateTag=()=>{};", shortCircuit: true };
     return n(s, c);
   }`
));

const { computarReserva } = await import("@/lib/reservar/computo.ts");
const { cargarDatosTarifario } = await import("../lib/tarifario/datos.ts");
const { cargarResumenTarifario } = await import("../lib/tarifario/resumen.ts");
const { obtenerDetalleSalida, obtenerDetalleServicios } = await import("../app/tarifario/detalle-actions.ts");
const { generarTarifario } = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");

// ─── Utilidades de fecha (Bogotá) ──────────────────────────────────────────
function fechaBogota(offsetDias: number, base = Date.now()): string {
  return new Date(base + offsetDias * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
const AYER = fechaBogota(-1);
const HOY = fechaBogota(0);
const MANIANA = fechaBogota(1);
const EN_30 = fechaBogota(30);
const EN_33 = fechaBogota(33);

// ─── Espías / clientes con fallo ───────────────────────────────────────────
function espiar(c: ClienteFalso, log: string[]): ClienteFalso {
  return { ...c, from(tabla: string) { log.push(tabla); return c.from(tabla); } };
}
function conErrorEn(c: ClienteFalso, tablaConError: string, message: string): ClienteFalso {
  return {
    ...c,
    from(tabla: string) {
      if (tabla !== tablaConError) return c.from(tabla);
      const err = { message };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data: null, error: err });
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: err }).then(res, rej);
      return b as unknown as ReturnType<ClienteFalso["from"]>;
    },
  };
}

// ─── Fixture de computarReserva (módulo dinámico) ──────────────────────────
const PAQUETE_ID = 70;
const HOTEL_ID = 217;
const SALIDA_ID = 900;
const CATEGORIA = "Estándar";
const REGIMEN = "PAE";

type SalidaFila = {
  id?: number; activo?: boolean | null; compra_inicio?: string | null; compra_fin?: string | null;
  fecha_ida?: string | null; fecha_regreso?: string | null;
};
function salida(o: SalidaFila = {}): FilaFalsa {
  return {
    id: SALIDA_ID, paquete_id: PAQUETE_ID, activo: true, compra_inicio: null, compra_fin: null,
    fecha_ida: EN_30, fecha_regreso: EN_33, ...o,
  };
}

function tablasPrecio(extra: TablasFalsas = {}): TablasFalsas {
  return {
    hoteles: [{
      id: HOTEL_ID, modelo_tarifario: "persona", nombre: "Hotel Dinámico", moneda: "COP",
      edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12,
      pax_min: 1, pax_max: 4, nino_nota: null, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null,
      adults_only: false, pet_friendly: false,
    }],
    armado_paquetes: [{ id: PAQUETE_ID, pct_mk: 0, impuesto_fijo: 0, destino_id: 1, tipo: "dinamico" }],
    tarifario_resultado_publicable: [
      {
        paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID, categoria: CATEGORIA, regimen: REGIMEN,
        salida_id: SALIDA_ID, empaquetado_id: null, bloqueo_id: null, acomodacion: "doble",
        precio_pvp: 600000, hotel_nombre: "Hotel Dinámico", destino_nombre: "CARTAGENA",
        fecha_ida: EN_30, fecha_regreso: EN_33, moneda: "COP",
      },
      {
        paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID, categoria: CATEGORIA, regimen: REGIMEN,
        salida_id: null, empaquetado_id: 5, bloqueo_id: null, acomodacion: "doble",
        precio_pvp: 650000, hotel_nombre: "Hotel Dinámico", destino_nombre: "CARTAGENA",
        fecha_ida: EN_30, fecha_regreso: EN_33, moneda: "COP",
      },
    ],
    hotel_acomodaciones: [{
      hotel_id: HOTEL_ID, acomodacion: "doble", pax_tarifa: 2, pax_max: 4,
      adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2,
    }],
    // Temporada + tarifa neta REALES que cubren cualquier fecha del test:
    // computarReserva re-liquida la vigencia de compra del HOTEL antes de
    // aceptar la fila cacheada del tarifario — sin esto, el caso "todo
    // vigente" fallaría por una razón ajena a la salida.
    hotel_temporadas: [{
      id: 1, hotel_id: HOTEL_ID, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31",
      prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null,
      rangos: null, blackouts: null, min_noches: null, regimen_restringido: null,
      condicion_pago_tipo: null, condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null,
    }],
    tarifa_hotel: [{
      id: 10, hotel_id: HOTEL_ID, tipo_habitacion: CATEGORIA, alimentacion: REGIMEN, temporada: "Base",
      neto_sencilla: null, neto_doble: 300000, neto_triple: null, neto_multiple: null,
      neto_nino: null, neto_nino2: null, neto_infante: null, nota_infante: null,
      notas: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null,
      precio_final_autoritativo: false,
    }],
    hotel_blackouts: [],
    armado_servicios: [], servicios_adicionales: [],
    ...extra,
  };
}

function inputDinamico(over: Record<string, unknown> = {}) {
  return {
    paqueteId: PAQUETE_ID, bloqueoId: null, empaquetadoId: null, salidaId: SALIDA_ID, modulo: "dinamico" as const,
    hotelId: HOTEL_ID, categoria: CATEGORIA, regimen: REGIMEN,
    habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0,
    cliente: { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", telefono: "300", email: "a@a.com" },
    tipoAsesor: "interno" as const, asesorInterno: "Asesor", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
    aliadoId: null, plazo: "24 horas", servicios: [],
    pasajeros: [
      { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", fechaNacimiento: "1990-01-01", nacionalidad: "CO", esInfante: false },
      { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "456", fechaNacimiento: "1992-01-01", nacionalidad: "CO", esInfante: false },
    ],
    ...over,
  };
}

type Escenario = {
  salidas?: FilaFalsa[];                       // filas visibles de salidas_dinamicas (vacío = invisible/eliminada)
  empaquetados?: FilaFalsa[];
  errorEnSalidas?: string;                     // fallo de la consulta de salidas
};
async function reservar(esc: Escenario, over: Record<string, unknown> = {}) {
  const tablasSb = tablasPrecio(esc.empaquetados ? { empaquetados: esc.empaquetados } : {});
  const tablasAdmin = tablasPrecio({ salidas_dinamicas: esc.salidas ?? [], ...(esc.empaquetados ? { empaquetados: esc.empaquetados } : {}) });
  const logSb: string[] = [];
  const logAdmin: string[] = [];
  // sb = cliente de SESIÓN (RLS): NO contiene `salidas_dinamicas` a propósito —
  // esa tabla solo la leen superadmin/gerencia/administracion/operaciones
  // (migración 094), así que un asesor `venta`, una agencia B2B o un visitante
  // anónimo del checkout público jamás podrían validar la salida con él. Si el
  // código la consultara con `sb`, el fake lanzaría "tabla no está en el fixture".
  const sb = espiar(crearClienteFalso(tablasSb), logSb);
  let admin = espiar(crearClienteFalso(tablasAdmin), logAdmin);
  if (esc.errorEnSalidas) admin = conErrorEn(admin, "salidas_dinamicas", esc.errorEnSalidas);
  adminActual = admin;
  const r = await computarReserva(sb as unknown as Parameters<typeof computarReserva>[0], inputDinamico(over));
  return { r, logSb, logAdmin };
}
function msg(r: Awaited<ReturnType<typeof reservar>>["r"]): string {
  return r.ok ? "" : r.error;
}

describe("computarReserva() — salida dinámica: ACEPTA solo lo vigente", () => {
  test("manual activa, sin ventana de compra, viaje futuro: ok y precio del tarifario", async () => {
    const { r } = await reservar({ salidas: [salida()] });
    assert.equal(r.ok, true, msg(r));
    if (r.ok) assert.equal(r.data.precioVenta, 1200000, "1 hab doble = 2 pax × 600.000");
  });

  test("ventana de compra abierta (inicio ayer, fin mañana): ok", async () => {
    const { r } = await reservar({ salidas: [salida({ compra_inicio: AYER, compra_fin: MANIANA })] });
    assert.equal(r.ok, true, msg(r));
  });

  test("límites INCLUSIVOS: compra_inicio = hoy y compra_fin = hoy: ok", async () => {
    const a = await reservar({ salidas: [salida({ compra_inicio: HOY })] });
    assert.equal(a.r.ok, true, msg(a.r));
    const b = await reservar({ salidas: [salida({ compra_fin: HOY })] });
    assert.equal(b.r.ok, true, msg(b.r));
  });

  test("viaje que sale HOY (fecha_ida = hoy): ok — solo el pasado se rechaza", async () => {
    const { r } = await reservar({ salidas: [salida({ fecha_ida: HOY })] });
    assert.equal(r.ok, true, msg(r));
  });
});

describe("computarReserva() — salida dinámica: RECHAZA lo no vigente, sin leer precio ni escribir", () => {
  const casos: { nombre: string; esc: Escenario; patron: RegExp }[] = [
    { nombre: "compra vencida (compra_fin = ayer)", esc: { salidas: [salida({ compra_fin: AYER })] }, patron: /vigencia de compra/i },
    { nombre: "compra aún no iniciada (compra_inicio = mañana)", esc: { salidas: [salida({ compra_inicio: MANIANA })] }, patron: /a[uú]n no|habilitad/i },
    { nombre: "viaje pasado (fecha_ida = ayer)", esc: { salidas: [salida({ fecha_ida: AYER })] }, patron: /ya pas[oó]/i },
    { nombre: "desactivada DESPUÉS de publicar el tarifario (activo=false)", esc: { salidas: [salida({ activo: false })] }, patron: /desactivad/i },
    { nombre: "eliminada / fila invisible por RLS (la consulta no devuelve fila)", esc: { salidas: [] }, patron: /ya no existe|no est[aá] disponible/i },
    { nombre: "error de consulta (nunca se interpreta como disponible)", esc: { errorEnSalidas: "permission denied for table salidas_dinamicas" }, patron: /no se pudo validar/i },
  ];
  for (const c of casos) {
    test(c.nombre, async () => {
      const { r, logSb } = await reservar(c.esc);
      assert.equal(r.ok, false, "debe rechazar");
      assert.match(msg(r), c.patron);
      assert.doesNotMatch(msg(r), /permission denied/i, "el error crudo de Postgres no debe llegar al llamador");
      // Rechazo ANTES de liquidar: ninguna lectura de precio/hotel/tarifa con la sesión.
      assert.deepEqual(logSb, [], `no debe tocar tablas con la sesión tras rechazar; consultó: ${logSb.join(", ")}`);
    });
  }

  test("la validación usa el cliente de servicio (admin), nunca la sesión: solo consulta salidas_dinamicas y nada más", async () => {
    const { r, logAdmin } = await reservar({ salidas: [salida({ activo: false })] });
    assert.equal(r.ok, false);
    assert.deepEqual(logAdmin, ["salidas_dinamicas"]);
  });
});

describe("computarReserva() — cambio de día en Bogotá (UTC-5)", () => {
  // 2026-10-20T04:59:59Z = 2026-10-19 23:59:59 en Bogotá; 05:00:00Z ya es el 20.
  async function conReloj<T>(isoUtc: string, fn: () => Promise<T>): Promise<T> {
    mock.timers.enable({ apis: ["Date"], now: Date.parse(isoUtc) });
    try { return await fn(); } finally { mock.timers.reset(); }
  }
  const SAL = { fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", compra_fin: "2026-10-19" };
  const TAR = {
    tarifario_resultado_publicable: [{
      paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID, categoria: CATEGORIA, regimen: REGIMEN,
      salida_id: SALIDA_ID, empaquetado_id: null, bloqueo_id: null, acomodacion: "doble",
      precio_pvp: 600000, hotel_nombre: "Hotel Dinámico", destino_nombre: "CARTAGENA",
      fecha_ida: "2026-12-01", fecha_regreso: "2026-12-04", moneda: "COP",
    }],
  };
  async function reservarFijo(salidas: FilaFalsa[]) {
    const sb = crearClienteFalso(tablasPrecio(TAR));
    adminActual = crearClienteFalso(tablasPrecio({ ...TAR, salidas_dinamicas: salidas }));
    return computarReserva(sb as unknown as Parameters<typeof computarReserva>[0], inputDinamico());
  }

  test("23:59:59 Bogotá del último día de compra: aún vigente", async () => {
    const r = await conReloj("2026-10-20T04:59:59Z", () => reservarFijo([salida(SAL)]));
    assert.equal(r.ok, true, msg(r));
  });
  test("00:00:00 Bogotá del día siguiente: compra vencida", async () => {
    const r = await conReloj("2026-10-20T05:00:00Z", () => reservarFijo([salida(SAL)]));
    assert.equal(r.ok, false);
    assert.match(msg(r), /vigencia de compra/i);
  });
});

describe("computarReserva() — regresión: empaquetado directo y otros orígenes no consultan salidas_dinamicas", () => {
  const EMP_OK = { id: 5, activo: true, compra_inicio: null, compra_fin: null };

  test("empaquetado vigente (módulo bloqueo): ok y NO consulta salidas_dinamicas", async () => {
    const { r, logAdmin, logSb } = await reservar(
      { salidas: [], empaquetados: [EMP_OK] },
      { modulo: "bloqueo", salidaId: null, empaquetadoId: 5 }
    );
    assert.equal(r.ok, true, msg(r));
    if (r.ok) assert.equal(r.data.precioVenta, 1300000, "2 pax × 650.000 (fila del empaquetado)");
    assert.ok(!logAdmin.includes("salidas_dinamicas") && !logSb.includes("salidas_dinamicas"));
  });

  test("empaquetado desactivado: sigue rechazando con su propio mensaje", async () => {
    const { r } = await reservar(
      { salidas: [], empaquetados: [{ ...EMP_OK, activo: false }] },
      { modulo: "bloqueo", salidaId: null, empaquetadoId: 5 }
    );
    assert.equal(r.ok, false);
    assert.match(msg(r), /empaquetado fue desactivado/i);
  });
});

// ─── cargarDatosTarifario() — carga de ofertas ─────────────────────────────
type Fila = { data: unknown[] | null; error: unknown };

function clienteTarifario(tablas: Record<string, Fila>, dataset: unknown[], vista = "tarifario_resultado_publicable") {
  function builder(tabla: string) {
    let rango: [number, number] | null = null;
    const b = {
      select() { return this; }, eq() { return this; }, in() { return this; }, not() { return this; }, order() { return this; },
      range(from: number, to: number) { rango = [from, to]; return this; },
      then(resolve: (v: { data: unknown; error: unknown }) => void) {
        if (tabla === vista) {
          const [from, to] = rango ?? [0, 999];
          resolve({ data: dataset.slice(from, to + 1), error: null });
        } else {
          const cfg = tablas[tabla] ?? { data: [], error: null };
          const [from, to] = rango ?? [0, Number.MAX_SAFE_INTEGER];
          resolve({ data: Array.isArray(cfg.data) ? cfg.data.slice(from, to + 1) : cfg.data, error: cfg.error });
        }
      },
    };
    return b;
  }
  return { from: builder } as unknown as SupabaseClient<Database>;
}

function tablasCarga(overrides: Record<string, Fila> = {}): Record<string, Fila> {
  return {
    cupos_por_bloqueo: { data: [], error: null }, bloqueos_vuelo: { data: [], error: null },
    hotel_temporadas: { data: [], error: null }, tarifa_hotel: { data: [], error: null },
    empaquetados: { data: [], error: null }, armado_paquetes: { data: [], error: null },
    hotel_fotos: { data: [], error: null }, hoteles: { data: [], error: null },
    hotel_acomodaciones: { data: [], error: null }, servicios_adicionales: { data: [], error: null },
    planes_alimentacion: { data: [], error: null }, armado_servicios: { data: [], error: null },
    salidas_dinamicas: { data: [], error: null },
    ...overrides,
  };
}
function filaDin(overrides: Partial<FilaTarifario> & { salida_id?: number | null }): FilaTarifario {
  return {
    modulo: "dinamico", bloqueo_label: "CTG-BOG", bloqueo_id: null, paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID,
    fecha_ida: EN_30, fecha_regreso: EN_33, noches: 3, destino_nombre: "Cartagena", paquete_nombre: "Dinámico",
    hotel_nombre: "Hotel Dinámico", categoria: CATEGORIA, regimen: REGIMEN, acomodacion: "doble",
    precio_pvp: 600000, moneda: "COP", salida_id: SALIDA_ID, ...overrides,
  } as FilaTarifario;
}
async function cargar(filas: FilaTarifario[], salidas: Fila, adminPresente = true) {
  const sb = clienteTarifario(tablasCarga({ salidas_dinamicas: salidas }), filas);
  return cargarDatosTarifario(sb, "test", "flujo62", adminPresente ? sb : null);
}
const visibles = (r: Awaited<ReturnType<typeof cargar>>) => (r.ok ? r.datos.filasVisibles.map((f) => f.salida_id ?? f.modulo) : ["ERROR"]);

describe("cargarDatosTarifario() — oferta de salida dinámica ya publicada: se oculta si dejó de ser vigente", () => {
  const ok = (s: Partial<SalidaFila> = {}) => ({ data: [{ id: SALIDA_ID, activo: true, compra_inicio: null, compra_fin: null, fecha_ida: EN_30, ...s }], error: null });

  test("vigente: se conserva", async () => {
    assert.deepEqual(visibles(await cargar([filaDin({})], ok())), [SALIDA_ID]);
  });
  test("ventana de compra abierta con límites inclusivos (hoy): se conserva", async () => {
    assert.deepEqual(visibles(await cargar([filaDin({})], ok({ compra_inicio: HOY, compra_fin: HOY }))), [SALIDA_ID]);
  });
  test("desactivada después de publicar: se oculta", async () => {
    assert.deepEqual(visibles(await cargar([filaDin({})], ok({ activo: false }))), []);
  });
  test("compra vencida (compra_fin = ayer): se oculta", async () => {
    assert.deepEqual(visibles(await cargar([filaDin({})], ok({ compra_fin: AYER }))), []);
  });
  test("compra aún no iniciada (compra_inicio = mañana): se oculta", async () => {
    assert.deepEqual(visibles(await cargar([filaDin({})], ok({ compra_inicio: MANIANA }))), []);
  });
  test("viaje pasado según la salida viva (fecha_ida = ayer): se oculta", async () => {
    assert.deepEqual(visibles(await cargar([filaDin({})], ok({ fecha_ida: AYER }))), []);
  });
  test("salida eliminada / invisible (la consulta no la devuelve): se oculta", async () => {
    assert.deepEqual(visibles(await cargar([filaDin({})], { data: [], error: null })), []);
  });
  test("error de consulta: FALLO CERRADO — se ocultan todas las dinámicas, nunca se publican sin verificar", async () => {
    assert.deepEqual(visibles(await cargar([filaDin({}), filaDin({ salida_id: 901 })], { data: null, error: { code: "42501" } })), []);
  });
  test("sin cliente de servicio: fallo cerrado también", async () => {
    assert.deepEqual(visibles(await cargar([filaDin({})], ok(), false)), []);
  });
  test("solo se ocultan las salidas inválidas: la vigente de la misma carga y los demás módulos permanecen", async () => {
    const filas = [
      filaDin({ salida_id: 900 }),
      filaDin({ salida_id: 901 }),
      // hotel_id null: fuera del filtro de vigencia de HOTEL (ajeno a #62), así
      // que solo se mide que las filas sin salida_id no se tocan.
      filaDin({ modulo: "porcion_terrestre", salida_id: null, hotel_id: null, fecha_ida: AYER }),
    ];
    const r = await cargar(filas, { data: [
      { id: 900, activo: true, compra_inicio: null, compra_fin: null, fecha_ida: EN_30 },
      { id: 901, activo: false, compra_inicio: null, compra_fin: null, fecha_ida: EN_30 },
    ], error: null });
    assert.deepEqual(visibles(r), [900, "porcion_terrestre"]);
  });
  test("regresión: sin filas dinámicas NO consulta salidas_dinamicas", async () => {
    const consultadas: string[] = [];
    const base = clienteTarifario(tablasCarga(), [filaDin({ modulo: "porcion_terrestre", salida_id: null })]);
    const sb = { from(t: string) { consultadas.push(t); return (base as unknown as { from(t: string): unknown }).from(t); } } as unknown as SupabaseClient<Database>;
    const r = await cargarDatosTarifario(sb, "test", "flujo62", sb);
    assert.equal(r.ok, true);
    assert.ok(!consultadas.includes("salidas_dinamicas"));
  });
});

// ─── generarTarifario() — rama dinámica (ejecución REAL, ver más abajo) ─────
// Además de ejecutar la acción completa, se prueba por separado la selección
// pura que delega (`seleccionarSalidasVigentes`) y el cableado sobre el fuente.
const { seleccionarSalidasVigentes } = await import("../lib/reservar/salidaDinamicaVigente.ts");
const { readFileSync } = await import("node:fs");

function filaSelectAsterisco(over: Record<string, unknown>) {
  return {
    id: 1, paquete_id: PAQUETE_ID, aerolinea: "AV", ruta: "BOG-CTG", origen: "BOG",
    fecha_ida: EN_30, fecha_regreso: EN_33, hora_salida_ida: null, hora_llegada_ida: null,
    hora_salida_reg: null, hora_llegada_reg: null, valor_tiquete: 400000, aplica_mk: true, ta: 0,
    fee_infante: 0, compra_inicio: null, compra_fin: null, activo: true, notas: null, orden: 0,
    created_at: "2026-01-01T00:00:00Z", ...over,
  };
}

describe("generarTarifario() — rama dinámica: solo se publican salidas vigentes", () => {
  const filas = [
    filaSelectAsterisco({ id: 1 }),                                   // vigente
    filaSelectAsterisco({ id: 2, compra_fin: AYER }),                 // compra vencida
    filaSelectAsterisco({ id: 3, compra_inicio: MANIANA }),           // aún no abre
    filaSelectAsterisco({ id: 4, fecha_ida: AYER, fecha_regreso: HOY }), // viaje pasado
    filaSelectAsterisco({ id: 5, activo: false }),                    // desactivada
    filaSelectAsterisco({ id: 6, compra_inicio: HOY, compra_fin: HOY, fecha_ida: HOY }), // límites inclusivos
  ];

  test("conserva únicamente las elegibles, en el mismo orden, y cuenta las descartadas", () => {
    const r = seleccionarSalidasVigentes(filas);
    assert.deepEqual(r.vigentes.map((s) => s.id), [1, 6]);
    assert.equal(r.descartadas, 4);
  });

  test("ninguna elegible: vigentes vacío y descartadas > 0 (permite el mensaje 'ninguna vigente' en vez de 'agrega una salida')", () => {
    const r = seleccionarSalidasVigentes(filas.filter((f) => f.id === 2 || f.id === 5));
    assert.equal(r.vigentes.length, 0);
    assert.equal(r.descartadas, 2);
  });

  test("sin salidas: descartadas = 0", () => {
    assert.deepEqual(seleccionarSalidasVigentes([]), { vigentes: [], descartadas: 0 });
  });
});

describe("generarTarifario() — cableado verificado sobre el fuente (complemento de la ejecución real)", () => {
  const src = readFileSync(new URL("../app/(dashboard)/dashboard/paquetes/actions.ts", import.meta.url), "utf8");
  const ini = src.indexOf("export async function generarTarifario(paqueteId: number): Promise<Result> {");
  const fin = src.indexOf("export async function regenerarTarifariosDeHotel", ini);
  const cuerpo = src.slice(ini, fin);

  test("se localizó el cuerpo de generarTarifario()", () => {
    assert.ok(ini > 0 && fin > ini);
  });
  test("selecciona las salidas con la regla común (no confía solo en `activo`)", () => {
    assert.match(cuerpo, /seleccionarSalidasVigentes\(salidasRaw \?\? \[\]\)/);
    assert.doesNotMatch(cuerpo, /from\("salidas_dinamicas"\)\.select\("\*"\)[^;]*\.eq\("activo", true\)/);
  });
  test("un error de lectura de salidas aborta la generación como fallo técnico (antes se ignoraba)", () => {
    assert.match(cuerpo, /error: eSalidas/);
    assert.match(cuerpo, /if \(eSalidas\) return await fallarTecnico\(eSalidas\.message\)/);
  });
  test("las filas dinámicas se generan SOLO a partir de las salidas ya filtradas", () => {
    const posSel = cuerpo.indexOf("seleccionarSalidasVigentes(");
    const posLoop = cuerpo.indexOf("for (const sal of salidas)");
    assert.ok(posSel > 0 && posLoop > posSel, "el filtro debe preceder al ciclo que genera las filas");
  });
});

// ─── cargarResumenTarifario() — la carga REAL de la vitrina ────────────────
// /tarifario y /dashboard/reservar NO usan cargarDatosTarifario(): leen
// `tarifario_resumen` y filtran con filtrosPostCarga.ts. Aquí se ejecuta ESA
// ruta completa.
const MSG_CARGA = /No fue posible cargar el tarifario/;
function filaResumenDin(over: Record<string, unknown> = {}) {
  return {
    modulo: "dinamico", paquete_id: PAQUETE_ID, paquete_nombre: "Dinámico", bloqueo_id: null, bloqueo_label: "BOG-CTG",
    empaquetado_id: null, salida_id: SALIDA_ID, hotel_id: HOTEL_ID, hotel_nombre: "Hotel Dinámico",
    servicio_id: null, servicio_nombre: null, destino_id: null, destino_nombre: "Cartagena",
    categoria: CATEGORIA, regimen: REGIMEN, fecha_ida: EN_30, fecha_regreso: EN_33, noches: 3, moneda: "COP",
    precio_sencilla: null, precio_doble: 600000, precio_triple: null, precio_multiple: null,
    precio_nino: null, precio_nino2: null, precio_infante: null,
    desde_adulto: 600000, desde_general: 600000, descripcion: null, recargo_individual: null, tipo_tarifa: null,
    ...over,
  };
}
async function resumir(filas: unknown[], salidas: Fila, adminPresente = true) {
  const sb = clienteTarifario(tablasCarga({ salidas_dinamicas: salidas }), filas, "tarifario_resumen");
  return cargarResumenTarifario(sb, "test", "flujo62", adminPresente ? sb : null);
}
const idsResumen = (r: Awaited<ReturnType<typeof resumir>>) => (r.ok ? r.datos.filasVisibles.map((f) => f.salida_id ?? f.modulo) : ["ERROR"]);
const salidaViva = (id: number, s: Partial<SalidaFila> = {}) => ({ id, activo: true, compra_inicio: null, compra_fin: null, fecha_ida: EN_30, ...s });

describe("cargarResumenTarifario() (vitrina real) — salidas dinámicas no elegibles", () => {
  test("mezcla: vigente se conserva; inactiva, compra vencida, aún no abierta, viaje pasado y eliminada se ocultan", async () => {
    const filas = [900, 901, 902, 903, 904, 905].map((id) => filaResumenDin({ salida_id: id }));
    const r = await resumir(filas, { data: [
      salidaViva(900),
      salidaViva(901, { activo: false }),
      salidaViva(902, { compra_fin: AYER }),
      salidaViva(903, { compra_inicio: MANIANA }),
      salidaViva(904, { fecha_ida: AYER }),
      // 905: eliminada / invisible → no viene en la respuesta
    ], error: null });
    assert.equal(r.ok, true);
    assert.deepEqual(idsResumen(r), [900]);
  });

  test("límites inclusivos (hoy) se conservan", async () => {
    const r = await resumir([filaResumenDin()], { data: [salidaViva(SALIDA_ID, { compra_inicio: HOY, compra_fin: HOY, fecha_ida: HOY })], error: null });
    assert.deepEqual(idsResumen(r), [SALIDA_ID]);
  });

  test("las filas de otros módulos y las dinámicas vigentes no se tocan", async () => {
    const filas = [filaResumenDin({ salida_id: 900 }), filaResumenDin({ salida_id: 901 }), filaResumenDin({ modulo: "porcion_terrestre", salida_id: null, hotel_id: null, fecha_ida: AYER })];
    const r = await resumir(filas, { data: [salidaViva(900), salidaViva(901, { activo: false })], error: null });
    assert.deepEqual(idsResumen(r), [900, "porcion_terrestre"]);
  });

  test("error de consulta de salidas: ok:false con el mensaje público de carga — NO 'sin disponibilidad' ni catálogo parcial", async () => {
    const r = await resumir([filaResumenDin(), filaResumenDin({ modulo: "porcion_terrestre", salida_id: null, hotel_id: null })], { data: null, error: { message: "permission denied for table salidas_dinamicas" } });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, MSG_CARGA);
      assert.doesNotMatch(r.error, /permission denied|salidas_dinamicas/);
    }
  });

  test("sin cliente de servicio y con filas dinámicas: ok:false (fallo cerrado), nunca ok con catálogo parcial", async () => {
    const r = await resumir([filaResumenDin()], { data: [salidaViva(SALIDA_ID)], error: null }, false);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, MSG_CARGA);
  });

  test("sin filas dinámicas: ok y NO consulta salidas_dinamicas", async () => {
    const consultadas: string[] = [];
    const base = clienteTarifario(tablasCarga(), [filaResumenDin({ modulo: "porcion_terrestre", salida_id: null, hotel_id: null })], "tarifario_resumen");
    const sb = { from(t: string) { consultadas.push(t); return (base as unknown as { from(t: string): unknown }).from(t); } } as unknown as SupabaseClient<Database>;
    const r = await cargarResumenTarifario(sb, "test", "flujo62", sb);
    assert.equal(r.ok, true);
    assert.ok(!consultadas.includes("salidas_dinamicas"));
  });
});

// ─── obtenerDetalleSalida() / obtenerDetalleServicios() — detalle bajo demanda ─
const MSG_DETALLE = "No fue posible cargar el detalle en este momento. Intenta nuevamente en unos segundos.";
const COMBO_DIN = {
  modulo: "dinamico", paquete_id: PAQUETE_ID, salida_id: SALIDA_ID, hotel_id: HOTEL_ID,
  categoria: CATEGORIA, regimen: REGIMEN, fecha_ida: EN_30, fecha_regreso: EN_33, moneda: "COP",
};
function filaDetalleDin(over: Record<string, unknown> = {}) {
  return {
    modulo: "dinamico", bloqueo_label: "BOG-CTG", bloqueo_id: null, empaquetado_id: null, salida_id: SALIDA_ID,
    paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID, fecha_ida: EN_30, fecha_regreso: EN_33, noches: 3,
    destino_nombre: "Cartagena", paquete_nombre: "Dinámico", hotel_nombre: "Hotel Dinámico",
    categoria: CATEGORIA, regimen: REGIMEN, acomodacion: "doble", precio_pvp: 600000, moneda: "COP", ...over,
  };
}
async function detalleSalida(salidas: Fila, adminPresente = true, filas: unknown[] = [filaDetalleDin()]) {
  const tablas = tablasCarga({ salidas_dinamicas: salidas });
  sbServidor = clienteTarifario(tablas, filas);
  adminActual = clienteTarifario(tablas, filas) as unknown as ClienteFalso;
  const antes = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!adminPresente) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    return await obtenerDetalleSalida({ modulo: "dinamico", salidaId: SALIDA_ID, combos: [COMBO_DIN] });
  } finally {
    if (antes !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = antes;
    sbServidor = null;
  }
}

describe("obtenerDetalleSalida() (detalle real) — salida dinámica no elegible", () => {
  test("vigente: devuelve la matriz", async () => {
    const r = await detalleSalida({ data: [salidaViva(SALIDA_ID)], error: null });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.filas.length, 1);
  });
  for (const [nombre, salidas] of [
    ["inactiva", salidaViva(SALIDA_ID, { activo: false })],
    ["compra vencida", salidaViva(SALIDA_ID, { compra_fin: AYER })],
    ["compra aún no iniciada", salidaViva(SALIDA_ID, { compra_inicio: MANIANA })],
    ["viaje pasado", salidaViva(SALIDA_ID, { fecha_ida: AYER })],
  ] as const) {
    test(`${nombre}: ok con 0 filas (se ocultó la oferta, no es un error técnico)`, async () => {
      const r = await detalleSalida({ data: [salidas], error: null });
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.filas.length, 0);
    });
  }
  test("eliminada / invisible: ok con 0 filas", async () => {
    const r = await detalleSalida({ data: [], error: null });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.filas.length, 0);
  });
  test("error de consulta: ok:false con el mensaje público existente (nunca 'sin disponibilidad')", async () => {
    const r = await detalleSalida({ data: null, error: { message: "permission denied for table salidas_dinamicas" } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, MSG_DETALLE);
  });
  test("sin cliente de servicio: ok:false con el mensaje público existente", async () => {
    const r = await detalleSalida({ data: [salidaViva(SALIDA_ID)], error: null }, false);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, MSG_DETALLE);
  });
});

describe("obtenerDetalleServicios() — propaga errorSalida (segundo camino que consume el filtro)", () => {
  // Las filas de servicios no llevan `salida_id` en producción; una fila
  // sintética con `salida_id` fuerza el camino para comprobar que el error
  // del filtro se propaga también aquí y no se traga.
  async function servicios(salidas: Fila, filas: unknown[]) {
    const tablas = tablasCarga({ salidas_dinamicas: salidas, armado_paquetes: { data: [{ id: PAQUETE_ID }], error: null } });
    sbServidor = clienteTarifario(tablas, filas);
    adminActual = clienteTarifario(tablas, filas) as unknown as ClienteFalso;
    try { return await obtenerDetalleServicios(); } finally { sbServidor = null; }
  }
  const filaServicio = (over: Record<string, unknown> = {}) => ({
    modulo: "servicios", paquete_id: PAQUETE_ID, hotel_id: null, fecha_ida: null, fecha_regreso: null, noches: null,
    categoria: null, regimen: null, salida_id: null, empaquetado_id: null, bloqueo_id: null,
    servicio_id: 1, servicio_nombre: "Tour", precio_pvp: 100000, moneda: "COP", ...over,
  });

  test("servicios normales (sin salida_id): ok y NO usa el resultado de salidas", async () => {
    const r = await servicios({ data: null, error: { message: "no debe usarse" } }, [filaServicio()]);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.filas.length, 1);
  });
  test("fila con salida_id y error al verificar: ok:false con el mensaje público existente", async () => {
    const r = await servicios({ data: null, error: { message: "boom" } }, [filaServicio({ salida_id: SALIDA_ID })]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, MSG_DETALLE);
  });
});

// ─── generarTarifario() — ejecución REAL de la Server Action ────────────────
type Rpc = { nombre: string; args: Record<string, unknown> };
function clienteGenerar(tablas: Record<string, unknown[]>, opciones: { errorEn?: string } = {}) {
  const rpcs: Rpc[] = [];
  function from(tabla: string) {
    const filtros: ((r: Record<string, unknown>) => boolean)[] = [];
    let uno = false;
    const b: Record<string, unknown> = {};
    b.select = () => b; b.order = () => b; b.range = () => b; b.not = () => b;
    b.eq = (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return b; };
    b.in = (c: string, v: unknown[]) => { filtros.push((r) => v.includes(r[c])); return b; };
    b.single = () => { uno = true; return b; };
    b.maybeSingle = () => { uno = true; return b; };
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (opciones.errorEn === tabla) return Promise.resolve({ data: null, error: { message: `permission denied for table ${tabla}` } }).then(res, rej);
      const filas = (tablas[tabla] ?? []).filter((r) => filtros.every((f) => f(r as Record<string, unknown>)));
      return Promise.resolve({ data: uno ? (filas[0] ?? null) : filas, error: null }).then(res, rej);
    };
    return b;
  }
  async function rpc(nombre: string, args: Record<string, unknown>) {
    rpcs.push({ nombre, args });
    if (nombre === "iniciar_generacion_tarifario") return { data: [{ generacion: 3, revision_capturada: 5 }], error: null };
    if (nombre === "publicar_tarifario_resultado") return { data: true, error: null };
    return { data: null, error: null };
  }
  return { sb: { from, rpc }, rpcs };
}

function tablasGenerar(salidas: FilaFalsa[], paquete: Record<string, unknown> = {}): Record<string, unknown[]> {
  return {
    armado_paquetes: [{
      id: PAQUETE_ID, nombre: "Dinámico Cartagena", activo: true, destino_id: 1, pct_mk: 0, tipo: "dinamico",
      impuesto_tipo: "fijo", impuesto_fijo: 0, noches: 3, destinos: { nombre: "CARTAGENA" }, ...paquete,
    }],
    armado_vuelos: [], armado_empaquetados: [], armado_servicios: [],
    armado_hoteles: [{
      paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID, categorias: null, regimenes: null,
      hoteles: { nombre: "Hotel Dinámico", moneda: "COP", modelo_tarifario: "persona" },
    }],
    hotel_temporadas: [{
      hotel_id: HOTEL_ID, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1,
      compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null,
      blackouts: null, regimen_restringido: null,
    }],
    tarifa_hotel: [{
      hotel_id: HOTEL_ID, tipo_habitacion: CATEGORIA, alimentacion: REGIMEN, temporada: "Base",
      neto_sencilla: 200000, neto_doble: 300000, neto_triple: null, neto_multiple: null,
      neto_nino: null, neto_nino2: null, neto_infante: null, precio_final_autoritativo: false,
    }],
    salidas_dinamicas: salidas,
  };
}
async function generar(salidas: FilaFalsa[], opciones: { errorEn?: string; paquete?: Record<string, unknown> } = {}) {
  const c = clienteGenerar(tablasGenerar(salidas, opciones.paquete), { errorEn: opciones.errorEn });
  sbServidor = c.sb;
  const prevError = console.error;
  console.error = () => {}; // fallarTecnico() registra el detalle crudo con console.error: esperado en estos casos
  try {
    const r = await generarTarifario(PAQUETE_ID);
    const pub = c.rpcs.find((x) => x.nombre === "publicar_tarifario_resultado");
    return {
      r,
      publicado: !!pub,
      filas: ((pub?.args.p_filas ?? []) as { salida_id: number | null; modulo: string; precio_pvp: number }[]),
      marcoFallo: c.rpcs.some((x) => x.nombre === "marcar_generacion_fallida"),
    };
  } finally {
    console.error = prevError;
    sbServidor = null;
  }
}
const salidaGen = (id: number, o: SalidaFila = {}): FilaFalsa => ({ ...salida({ id, ...o }), valor_tiquete: 400000, aplica_mk: true, ta: 0 });
const idsPublicados = (filas: { salida_id: number | null }[]) => [...new Set(filas.map((f) => f.salida_id))].sort();

describe("generarTarifario() REAL — solo se publican salidas elegibles", () => {
  test("mezcla: se publican las filas SOLO de las salidas vigentes (incl. límites inclusivos) y se descartan inactiva, vencida, futura y pasada", async () => {
    const g = await generar([
      salidaGen(1),                                                         // vigente
      salidaGen(2, { activo: false }),                                      // desactivada
      salidaGen(3, { compra_fin: AYER }),                                   // compra vencida
      salidaGen(4, { compra_inicio: MANIANA }),                             // aún no abre
      salidaGen(5, { fecha_ida: AYER, fecha_regreso: HOY }),                // viaje pasado
      salidaGen(6, { compra_inicio: HOY, compra_fin: HOY, fecha_ida: HOY, fecha_regreso: MANIANA }), // límites inclusivos
    ]);
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.publicado, true);
    assert.deepEqual(idsPublicados(g.filas), [1, 6]);
    assert.ok(g.filas.every((f) => f.modulo === "dinamico" && f.precio_pvp > 0));
  });

  test("ninguna elegible: NO publica y reporta 'ninguna salida está vigente' (no 'agrega una salida')", async () => {
    const g = await generar([salidaGen(2, { activo: false }), salidaGen(3, { compra_fin: AYER })]);
    assert.equal(g.r.ok, false);
    if (!g.r.ok) assert.match(g.r.error, /ninguna salida est[aá] vigente/i);
    assert.equal(g.publicado, false);
    assert.equal(g.marcoFallo, true);
  });

  test("sin salidas: NO publica y pide agregar una", async () => {
    const g = await generar([]);
    assert.equal(g.r.ok, false);
    if (!g.r.ok) assert.match(g.r.error, /agrega al menos una salida/i);
    assert.equal(g.publicado, false);
  });

  test("ERROR de lectura de salidas: NO publica y el texto crudo de Postgres no llega al llamador", async () => {
    const g = await generar([salidaGen(1)], { errorEn: "salidas_dinamicas" });
    assert.equal(g.r.ok, false);
    if (!g.r.ok) assert.doesNotMatch(g.r.error, /permission denied|salidas_dinamicas/);
    assert.equal(g.publicado, false, "un error de lectura nunca debe publicar un tarifario con las salidas que 'quedaron'");
    assert.equal(g.marcoFallo, true);
  });

  test("regresión: un paquete que no es dinámico no consulta salidas (aunque esa tabla falle) — no se rompe porción terrestre", async () => {
    const g = await generar([], { errorEn: "salidas_dinamicas", paquete: { tipo: "porcion_terrestre", fecha_viaje_inicio: EN_30, fecha_viaje_fin: EN_33 } });
    assert.equal(g.r.ok, true, g.r.ok ? "" : g.r.error);
    assert.equal(g.publicado, true);
    assert.ok(g.filas.length > 0 && g.filas.every((f) => f.modulo === "porcion_terrestre"));
  });
});
