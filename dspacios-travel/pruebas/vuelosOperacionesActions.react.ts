// Se ejecuta con npm run test:react (loader TSX/esbuild), no con test:unit.
// Ejecuta las Server Actions REALES de inventario de Vuelos
// (app/(dashboard)/dashboard/vuelos/actions.ts) contra un cliente de Supabase
// simulado que registra cada llamada. Comprueba que:
//   - trasladar, mover, retirar, cambiar estado, contrato manual, liberar y
//     editar delegan en UNA función de la base (migración 194) con los
//     argumentos exactos, sin escribir tablas directamente;
//   - una llamada directa sin modo, con un modo inventado o sin identificador
//     de operación NO llega a la base;
//   - los errores de la base se traducen (bloqueo ocupado, tarifa distinta,
//     migración faltante) y no se revalida nada si fallan;
//   - crear, cargar por CSV y eliminar un record pasan por crear_bloqueo /
//     eliminar_bloqueo (migración 195): ningún INSERT/DELETE directo de
//     sillas o records; la carga masiva no ignora errores de ninguna fila.
// Stubs vía reactLoader: "@/lib/supabase/server", "next/cache" y
// "../paquetes/actions".
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const acciones = await import("../app/(dashboard)/dashboard/vuelos/actions.ts");
const { __setClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { __revalidadas, __resetRevalidadas } = await import("./support/stubs/nextCacheStub.mjs");
const paquetesStub = await import("./support/stubs/paquetesActionsStub.mjs");
const regenerados: unknown[] = [];
paquetesStub.__setImpls({ generarTarifario: async (pid: unknown) => { regenerados.push(pid); return { ok: true }; } });

type Rpc = { fn: string; args: Record<string, unknown> };
type Op = { tabla: string; op: string; detalle: unknown[] };
let rpcs: Rpc[] = [];
let ops: Op[] = [];
let rpcRespuesta: { data: unknown; error: { code?: string; message: string } | null } = { data: { ok: true }, error: null };
let historialCount = 0;
// Respuestas por llamada (carga masiva); si la cola está vacía se usa rpcRespuesta.
let rpcCola: (typeof rpcRespuesta)[] = [];
let paquetesUsados: number[] = [];

// Cadena PostgREST mínima: registra la operación y resuelve al final.
function cadena(tabla: string, op: string, resultado: () => unknown) {
  const detalle: unknown[] = [];
  ops.push({ tabla, op, detalle });
  const c: Record<string, unknown> = {};
  for (const m of ["eq", "in", "or", "order", "limit", "select"]) c[m] = (...a: unknown[]) => { detalle.push([m, ...a]); return c; };
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resultado()).then(ok, ko);
  return c;
}

__setClient({
  rpc(fn: string, args: Record<string, unknown>) {
    rpcs.push({ fn, args });
    return Promise.resolve(rpcCola.shift() ?? rpcRespuesta);
  },
  from(tabla: string) {
    return {
      select(_cols: string, opts?: { count?: string; head?: boolean }) {
        if (tabla === "movimientos_silla" && opts?.head) return cadena(tabla, "count", () => ({ count: historialCount, error: null }));
        if (tabla === "sillas") return cadena(tabla, "select", () => ({ data: [{ id: 501 }, { id: 502 }], error: null }));
        if (tabla === "armado_vuelos") return cadena(tabla, "select", () => ({ data: paquetesUsados.map((p) => ({ paquete_id: p })), error: null }));
        if (tabla === "destinos") return cadena(tabla, "select", () => ({ data: [{ id: 7, nombre: "San Andrés" }], error: null }));
        if (tabla === "proveedores") return cadena(tabla, "select", () => ({ data: [{ id: 8, nombre: "Avianca SAS" }], error: null }));
        if (tabla === "rangos_edad") return cadena(tabla, "select", () => ({ data: [{ id: 9, denominacion: "Adulto" }], error: null }));
        return cadena(tabla, "select", () => ({ data: [], error: null }));
      },
      delete() { return cadena(tabla, "delete", () => ({ error: null })); },
      update() { return cadena(tabla, "update", () => ({ error: null })); },
      insert() { return cadena(tabla, "insert", () => ({ error: null })); },
    };
  },
});

const OP = "6f1c1f8e-2b0a-4c1e-9d2a-0b1c2d3e4f50";

beforeEach(() => {
  rpcs = []; ops = []; historialCount = 0; rpcCola = []; paquetesUsados = []; regenerados.length = 0;
  rpcRespuesta = { data: { ok: true }, error: null };
  __resetRevalidadas();
});

// ── Trasladar cupos libres ──────────────────────────────────────────────────
test("cambiarSillas llama a trasladar_cupos con los argumentos exactos y revalida los dos records", async () => {
  rpcRespuesta = { data: { ok: true, repetida: false, movidas: 2 }, error: null };
  const r = await acciones.cambiarSillas({ origenId: 10, destinoId: 6, cantidad: 2, motivo: "  cambio de fecha ", operacionId: OP });
  assert.deepEqual(r, { ok: true, repetida: false, movidas: 2 });
  assert.deepEqual(rpcs, [{ fn: "trasladar_cupos", args: { p_origen: 10, p_destino: 6, p_cantidad: 2, p_motivo: "cambio de fecha", p_operacion_id: OP } }]);
  assert.deepEqual(ops, [], "no escribe ni lee tablas directamente");
  assert.deepEqual(__revalidadas(), ["/dashboard/vuelos/10", "/dashboard/vuelos/6", "/dashboard/vuelos"]);
});

test("cambiarSillas: un reintento ya aplicado se informa como repetida", async () => {
  rpcRespuesta = { data: { ok: true, repetida: true }, error: null };
  const r = await acciones.cambiarSillas({ origenId: 10, destinoId: 6, cantidad: 2, motivo: "", operacionId: OP });
  assert.equal(r.ok && r.repetida, true);
});

test("cambiarSillas rechaza sin llamar a la base: mismo record, cantidad inválida o sin operación", async () => {
  const casos = [
    { origenId: 10, destinoId: 10, cantidad: 1, motivo: "", operacionId: OP },
    { origenId: 10, destinoId: 6, cantidad: 0, motivo: "", operacionId: OP },
    { origenId: 10, destinoId: 6, cantidad: 1.5, motivo: "", operacionId: OP },
    { origenId: 10, destinoId: 6, cantidad: 1, motivo: "", operacionId: "no-es-uuid" },
    { origenId: 10, destinoId: 6, cantidad: 1, motivo: "" } as never,
  ];
  for (const c of casos) assert.equal((await acciones.cambiarSillas(c)).ok, false, JSON.stringify(c));
  assert.deepEqual(rpcs, []);
});

// ── Mover pasajero ──────────────────────────────────────────────────────────
test("moverPasajeroSilla sin modo, con modo inventado o sin opciones NO llega a la base", async () => {
  const sinModo = [
    undefined,
    { operacionId: OP },
    { modo: "auto", operacionId: OP },
    { modo: "", operacionId: OP },
    { modo: "SOLO_DATOS", operacionId: OP },
  ];
  for (const o of sinModo) {
    const r = await acciones.moverPasajeroSilla(7, 3, 4, o as never);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Elige cómo recibirá/);
  }
  const sinOp = await acciones.moverPasajeroSilla(7, 3, 4, { modo: "con_cupo", operacionId: "" });
  assert.equal(sinOp.ok, false);
  assert.equal((await acciones.moverPasajeroSilla(7, 3, 3, { modo: "con_cupo", operacionId: OP })).ok, false, "mismo record");
  assert.deepEqual(rpcs, []);
});

for (const modo of ["solo_datos", "con_cupo"] as const) {
  test(`moverPasajeroSilla modo ${modo}: una sola RPC mover_pasajero, sin inserts`, async () => {
    rpcRespuesta = {
      data: { ok: true, repetida: false, modo, movidas: 2, contrato: "DTM-0451", aviso_tarifa_distinta: false, aviso_record_contrato: false,
              tramos_actualizados: 2, contrato_manual: false },
      error: null,
    };
    const r = await acciones.moverPasajeroSilla(7, 3, 4, { modo, motivo: " x ", operacionId: OP });
    assert.deepEqual(r, { ok: true, repetida: false, movidas: 2, contrato: "DTM-0451", avisoTarifaDistinta: false, avisoRecordContrato: false,
                          tramosActualizados: 2, contratoManual: false });
    assert.deepEqual(rpcs, [{ fn: "mover_pasajero", args: {
      p_silla_id: 7, p_destino: 4, p_modo: modo, p_acepta_tarifa_distinta: false, p_motivo: "x", p_operacion_id: OP,
    } }]);
    assert.deepEqual(ops, []);
    assert.deepEqual(__revalidadas(), ["/dashboard/vuelos/3", "/dashboard/vuelos/4", "/dashboard/vuelos"]);
  });
}

test("tarifa distinta: la base pide confirmación; la acción lo marca y no revalida", async () => {
  rpcRespuesta = { data: null, error: { code: "P0001", message: "TARIFA_DISTINTA: La tarifa neta del record destino es distinta. Confirma para continuar; el costo del contrato no se recalcula." } };
  const r = await acciones.moverPasajeroSilla(7, 3, 4, { modo: "con_cupo", operacionId: OP });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.requiereConfirmarTarifa, true);
    assert.match(r.error, /^La tarifa neta del record destino es distinta/);
  }
  assert.deepEqual(__revalidadas(), []);
  await acciones.moverPasajeroSilla(7, 3, 4, { modo: "con_cupo", aceptaTarifaDistinta: true, operacionId: OP });
  assert.equal(rpcs[1]!.args.p_acepta_tarifa_distinta, true);
});

test("errores de la base: bloqueo ocupado (55P03), migración faltante y mensaje de negocio", async () => {
  rpcRespuesta = { data: null, error: { code: "55P03", message: "canceling statement due to lock timeout" } };
  let r = await acciones.cambiarSillas({ origenId: 10, destinoId: 6, cantidad: 1, motivo: "", operacionId: OP });
  assert.ok(!r.ok && /Otra persona está modificando este record/.test(r.error));
  rpcRespuesta = { data: null, error: { code: "PGRST202", message: "Could not find the function public.trasladar_cupos" } };
  r = await acciones.cambiarSillas({ origenId: 10, destinoId: 6, cantidad: 1, motivo: "", operacionId: OP });
  assert.ok(!r.ok && /migración de base de datos \(194 a 197\)/.test(r.error));
  rpcRespuesta = { data: null, error: { code: "P0001", message: "El record PFX001 no tiene cupo libre suficiente (necesita 1, tiene 0)." } };
  const m = await acciones.moverPasajeroSilla(7, 3, 4, { modo: "solo_datos", operacionId: OP });
  assert.ok(!m.ok && m.error.startsWith("El record PFX001 no tiene cupo libre"));
  assert.deepEqual(__revalidadas(), []);
});

// ── Retirar cupo / estados / contrato manual / liberar / editar ─────────────
test("retirarCupo llama a retirar_cupo y nunca borra filas", async () => {
  const r = await acciones.retirarCupo(41, 3, " devolución ", OP);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(rpcs, [{ fn: "retirar_cupo", args: { p_silla_id: 41, p_motivo: "devolución", p_operacion_id: OP } }]);
  assert.deepEqual(ops, []);
  assert.equal((await acciones.retirarCupo(41, 3, "", "x")).ok, false, "sin operación válida no llama");
  assert.equal(rpcs.length, 1);
});

test("cambiarEstadoSilla: solo estados manuales de la matriz y con motivo", async () => {
  for (const e of ["confirmada", "en_plazo", "retirada", "cambio"]) {
    assert.equal((await acciones.cambiarEstadoSilla(41, e as never, 3, "motivo")).ok, false, e);
  }
  assert.equal((await acciones.cambiarEstadoSilla(41, "no_vendida", 3, "   ")).ok, false, "sin motivo");
  assert.deepEqual(rpcs, []);
  await acciones.cambiarEstadoSilla(41, "devuelta", 3, " cierre ", true);
  await acciones.cambiarEstadoSilla(41, "no_vendida", 3, "cierre");
  assert.deepEqual(rpcs, [
    { fn: "cambiar_estado_silla", args: { p_silla_id: 41, p_estado: "devuelta", p_motivo: "cierre", p_devolucion_real: true } },
    { fn: "cambiar_estado_silla", args: { p_silla_id: 41, p_estado: "no_vendida", p_motivo: "cierre", p_devolucion_real: false } },
  ]);
});

test("contrato manual, liberar y editar delegan en su RPC", async () => {
  await acciones.asignarContratoManual(41, "\t00-0541\n", 3, "V9");
  await acciones.quitarContratoManual(41, 3, "V9", "2026-10-10");
  await acciones.borrarPasajeroSilla(41, 3, "V9");
  await acciones.editarPasajeroSilla(41, 3, {
    pasajero_nombres: "ANA", pasajero_apellidos: "", tipo_doc: "CC", numero_doc: "1", nacimiento: "1990-01-02",
    asesor: "", hotel: "", acomodacion: "", plazo: "",
  }, { numero_contrato: null, contrato_manual: "EXT-9", updated_at: "V9" });
  assert.deepEqual(rpcs.map((r) => r.fn), ["asignar_contrato_manual", "quitar_contrato_manual", "liberar_silla", "editar_pasajero_silla"]);
  assert.equal(rpcs[0]!.args.p_referencia, "\t00-0541\n", "el recorte y la resolución los hace la base");
  assert.deepEqual(rpcs[0]!.args.p_esperado, { updated_at: "V9" }, "201: asignar manda la versión vista (firma con versión)");
  assert.deepEqual(rpcs[2]!.args, { p_silla_id: 41, p_esperado: { updated_at: "V9" } }, "201: liberar manda la versión vista (firma con versión)");
  assert.deepEqual(rpcs[1]!.args, { p_silla_id: 41, p_plazo: "2026-10-10", p_esperado: { updated_at: "V9" } },
    "201: quitar manda la versión vista y el plazo de la retención en la misma acción");
  assert.equal((rpcs[3]!.args.p_datos as Record<string, string>).nacimiento, "1990-01-02");
  assert.deepEqual((rpcs[3]!.args.p_datos as Record<string, unknown>).esperado, { numero_contrato: null, contrato_manual: "EXT-9", updated_at: "V9" },
    "201: la edición manda el contrato y la versión que la pantalla mostraba, para que la base rechace si cambió");
  assert.deepEqual(ops, []);
});

test("editarPasajeroSilla: sin el contrato visto no llega a la base; el rechazo por silla cambiada se devuelve tal cual", async () => {
  const datos = { pasajero_nombres: "ANA", pasajero_apellidos: "", tipo_doc: "", numero_doc: "", nacimiento: "", asesor: "", hotel: "", acomodacion: "", plazo: "" };
  const sinVisto = await (acciones.editarPasajeroSilla as (...a: unknown[]) => Promise<unknown>)(41, 3, datos);
  assert.equal((sinVisto as { ok: boolean }).ok, false);
  assert.deepEqual(rpcs, [], "sin estado esperado no se edita a ciegas");
  rpcRespuesta = { data: null, error: { code: "P0001", message: "La silla cambió mientras la editabas: ahora es del contrato DTM-0451. No se guardó nada; recarga la página." } };
  const r = await acciones.editarPasajeroSilla(41, 3, datos, { numero_contrato: null, contrato_manual: null, updated_at: "V9" });
  assert.deepEqual(r, { ok: false, error: "La silla cambió mientras la editabas: ahora es del contrato DTM-0451. No se guardó nada; recarga la página." });
  assert.deepEqual(__revalidadas(), []);
});

test("liberar y asignar sin la versión vista no llegan a la base (nunca a ciegas)", async () => {
  const a = acciones as unknown as Record<string, (...x: unknown[]) => Promise<{ ok: boolean }>>;
  assert.equal((await a.borrarPasajeroSilla(41, 3)).ok, false);
  assert.equal((await a.asignarContratoManual(41, "EXT-1", 3)).ok, false);
  assert.equal((await a.borrarPasajeroSilla(41, 3, "  ")).ok, false);
  assert.deepEqual(rpcs, [], "sin versión no se llama a ninguna RPC");
});

test("un error al liberar se devuelve y no revalida", async () => {
  rpcRespuesta = { data: null, error: { code: "42501", message: "Sin permiso sobre el contrato de esta silla." } };
  const r = await acciones.borrarPasajeroSilla(41, 3, "V9");
  assert.deepEqual(r, { ok: false, error: "Sin permiso sobre el contrato de esta silla." });
  assert.deepEqual(__revalidadas(), []);
});

// ── Crear, cargar por CSV y eliminar un record (migración 195) ────────────
const BLOQUEO = {
  record: " pnr123 ", aerolinea: "AVIANCA", proveedorId: 8, destinoId: 7, ruta: "BOG-ADZ", origen: "BOG", tarifaNeta: 400000,
  vueloIda: "AV10", fechaIda: "2026-12-01", horaSalidaIda: "06:00", horaLlegadaIda: "07:55",
  vueloRegreso: "AV11", fechaRegreso: "2026-12-05", horaSalidaReg: "18:00", horaLlegadaReg: "19:55",
  cuposTotal: 4, tarifaParaEmpaquetar: 480000, fechaDevolucion: "", fechaEmision: "", notas: "", rangosEdad: [9],
  modalidadEmision: "serie" as const,
};

test("crearBloqueo: una sola RPC crear_bloqueo con los datos y los cupos; ningún insert directo", async () => {
  rpcRespuesta = { data: { ok: true, id: 55, record: "PNR123", cupos: 4 }, error: null };
  const r = await acciones.crearBloqueo(BLOQUEO);
  assert.deepEqual(r, { ok: true, id: 55 });
  assert.equal(rpcs.length, 1);
  assert.equal(rpcs[0]!.fn, "crear_bloqueo");
  assert.equal(rpcs[0]!.args.p_cupos, 4);
  const d = rpcs[0]!.args.p_datos as Record<string, unknown>;
  assert.deepEqual([d.record, d.modalidad_emision, d.estado_emision, d.estado_pago, d.fecha_devolucion, d.rangos_edad, d.proveedor_id],
                   ["PNR123", "serie", "pendiente", "pendiente", null, [9], 8]);
  assert.deepEqual(ops, [], "no escribe tablas directamente");
});

test("crearBloqueo: sin modalidad, sin record o con cupos inválidos no llega a la base", async () => {
  for (const malo of [{ ...BLOQUEO, modalidadEmision: "" }, { ...BLOQUEO, record: "  " }, { ...BLOQUEO, cuposTotal: -1 }, { ...BLOQUEO, cuposTotal: 2.5 }]) {
    assert.equal((await acciones.crearBloqueo(malo as never)).ok, false);
  }
  assert.deepEqual(rpcs, []);
});

test("crearBloqueo: el error de la base se devuelve (p. ej. migración 195 sin aplicar) y no revalida", async () => {
  rpcRespuesta = { data: null, error: { code: "PGRST202", message: "Could not find the function public.crear_bloqueo" } };
  const r = await acciones.crearBloqueo(BLOQUEO);
  assert.ok(!r.ok && /migración de base de datos \(194 a 197\)/.test(r.error), "explica que falta la migración; no cae a un insert directo");
  assert.deepEqual(ops, []);
  assert.deepEqual(__revalidadas(), []);
});

test("cargarBloqueosMasivo: cada fila válida va por crear_bloqueo; errores de la base y de forma se reportan por fila", async () => {
  rpcCola = [
    { data: { ok: true, id: 1 }, error: null },
    { data: null, error: { code: "P0001", message: "No se crearon todas las sillas del bloqueo; no se guardó nada." } },
    { data: { ok: true, id: 3 }, error: null },
  ];
  const filas: Record<string, string>[] = [
    { record: "aaa111", modalidad_emision: "serie", cupos_total: "3", destino: "san andrés", proveedor: "avianca sas", rangos_edad: "Adulto", fecha_ida: "01/12/26" },
    { record: "BBB222", modalidad_emision: "grupo", cupos_total: "5" },
    { record: "CCC333", modalidad_emision: "mensual", cupos_total: "2" },          // modalidad inválida: ni llega a la base
    { record: "", modalidad_emision: "serie", cupos_total: "2" },                   // sin record
    { record: "DDD444", modalidad_emision: "serie", cupos_total: "0" },
  ];
  const r = await acciones.cargarBloqueosMasivo(filas);
  assert.equal(r.insertados, 2, "solo cuentan las filas que la base creó");
  assert.equal(r.ok, false);
  assert.equal(r.errores.length, 3);
  assert.match(r.errores.join("\n"), /Fila 3 \(BBB222\): No se crearon todas las sillas/);
  assert.match(r.errores.join("\n"), /Fila 4 \(CCC333\): modalidad_emision/);
  assert.match(r.errores.join("\n"), /Fila 5: falta record/);
  assert.deepEqual(rpcs.map((x) => [x.fn, (x.args.p_datos as Record<string, unknown>).record, x.args.p_cupos]),
    [["crear_bloqueo", "AAA111", 3], ["crear_bloqueo", "BBB222", 5], ["crear_bloqueo", "DDD444", 0]]);
  const d0 = rpcs[0]!.args.p_datos as Record<string, unknown>;
  assert.deepEqual([d0.destino_id, d0.proveedor_id, d0.rangos_edad, d0.fecha_ida], [7, 8, [9], "2026-12-01"]);
  assert.ok(!ops.some((o) => o.op === "insert"), "ningún insert directo de record ni sillas");
});

test("eliminarBloqueo: una sola RPC eliminar_bloqueo; luego regenera los paquetes que lo usaban", async () => {
  paquetesUsados = [21, 21, 22];
  rpcRespuesta = { data: { ok: true, record: "PNR123", sillas_borradas: 4 }, error: null };
  const r = await acciones.eliminarBloqueo(9);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(rpcs, [{ fn: "eliminar_bloqueo", args: { p_bloqueo_id: 9 } }]);
  assert.ok(!ops.some((o) => o.op === "delete"), "no borra directamente");
  assert.deepEqual(regenerados, [21, 22]);
});

test("eliminarBloqueo: el rechazo de la base se devuelve tal cual y no regenera nada", async () => {
  paquetesUsados = [21];
  rpcRespuesta = { data: null, error: { code: "P0001", message: "No se puede eliminar el bloqueo PNR123: 3 movimiento(s) en su historial. No se borró nada." } };
  const r = await acciones.eliminarBloqueo(9);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /3 movimiento\(s\) en su historial/);
  assert.deepEqual(regenerados, []);
  assert.equal((await acciones.eliminarBloqueo(0)).ok, false, "id inválido no llega a la base");
  assert.equal(rpcs.length, 1);
});

// ── Guardas de cableado ─────────────────────────────────────────────────────
test("actions.ts ya no escribe sillas ni historial directamente en las operaciones de inventario", () => {
  const src = readFileSync(new URL("../app/(dashboard)/dashboard/vuelos/actions.ts", import.meta.url), "utf8");
  const cuerpo = (nombre: string) => {
    const i = src.indexOf(`export async function ${nombre}(`);
    assert.ok(i >= 0, nombre);
    const j = src.indexOf("\nexport ", i + 10);
    return src.slice(i, j < 0 ? undefined : j);
  };
  for (const n of ["cambiarSillas", "moverPasajeroSilla", "retirarCupo", "cambiarEstadoSilla", "asignarContratoManual",
                   "quitarContratoManual", "editarContratoManual", "borrarPasajeroSilla", "editarPasajeroSilla"]) {
    const c = cuerpo(n);
    assert.doesNotMatch(c, /\.from\(/, `${n} no debe tocar tablas directamente`);
    assert.match(c, /sb\.rpc\("/, `${n} debe usar una RPC`);
  }
  assert.doesNotMatch(src, /from\("movimientos_silla"\)\.(insert|update|delete)/, "nadie escribe el historial desde la app");
  // Fase B-bis (195): ningún INSERT/DELETE directo de sillas o records.
  assert.doesNotMatch(src, /from\("sillas"\)\s*\.(insert|delete|upsert)\(/, "nadie inserta ni borra sillas desde la app");
  assert.doesNotMatch(src, /from\("bloqueos_vuelo"\)\s*\.(insert|delete|upsert)\(/, "nadie inserta ni borra records desde la app");
  for (const n of ["crearBloqueo", "cargarBloqueosMasivo", "eliminarBloqueo"]) {
    const c = cuerpo(n);
    assert.match(c, /sb\.rpc\("(crear_bloqueo|eliminar_bloqueo)"/, `${n} debe usar crear_bloqueo/eliminar_bloqueo`);
  }
  assert.ok(!("eliminarCupo" in acciones), "la acción de borrado duro de cupos ya no existe");
});

// Migración 201: quitar pide el plazo en la misma acción y editar reemplaza la
// referencia manual en una sola RPC; ambas con la versión que vio la pantalla.
test("quitar y editar el contrato manual: versión, plazo y referencia; validan antes de llamar a la base", async () => {
  await acciones.quitarContratoManual(41, 3, "V9", null);
  await acciones.editarContratoManual(41, " EXT-NUEVO ", 3, "V9");
  assert.deepEqual(rpcs, [
    { fn: "quitar_contrato_manual", args: { p_silla_id: 41, p_plazo: null, p_esperado: { updated_at: "V9" } } },
    { fn: "editar_contrato_manual", args: { p_silla_id: 41, p_referencia: " EXT-NUEVO ", p_esperado: { updated_at: "V9" } } },
  ]);
  rpcs.length = 0;
  assert.equal((await acciones.quitarContratoManual(41, 3, "", "2026-10-10")).ok, false, "sin versión");
  assert.equal((await acciones.quitarContratoManual(41, 3, "V9", "10/10/2026")).ok, false, "plazo con formato inválido");
  assert.equal((await acciones.editarContratoManual(41, "   ", 3, "V9")).ok, false, "referencia vacía");
  assert.equal((await acciones.editarContratoManual(41, "EXT-1", 3, "")).ok, false, "sin versión");
  assert.deepEqual(rpcs, [], "ninguna llamada a la base con datos inválidos");
});
